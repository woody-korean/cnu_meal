import { weightedScore } from "./ranking";
import { getVoteDayKey, getUtcWindowKey, isValidYmd } from "./time";
import { normalizeEnglish, normalizeText, parseStars } from "./validation";
import type { Env, IngestMeal, MealRow, RatingStats } from "./types";

interface MealsResponseItem extends MealRow {
  avg_stars: number;
  vote_count: number;
  weighted_score: number;
}

interface LeaderboardItem {
  meal_id: string;
  cafeteria_name_ko: string;
  cafeteria_name_en: string;
  meal_period: string;
  audience: string;
  menu_name_ko: string;
  menu_name_en: string;
  avg_stars: number;
  vote_count: number;
  weighted_score: number;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8"
};

const RETENTION_MONTHS_DEFAULT = 12;
const API_BURST_LIMIT = 300;
const RATING_DAILY_LIMIT = 60;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unexpected error";
      return errorResponse(request, env, 500, message);
    }
  }
};

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (!url.pathname.startsWith("/api/")) {
    return errorResponse(request, env, 404, "not found");
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: buildCorsHeaders(request, env, true)
    });
  }

  if (!url.pathname.startsWith("/api/admin/")) {
    const burst = await enforceApiBurstLimit(request, env);
    if (burst) return burst;
  }

  if (url.pathname === "/api/meals") {
    return handleMeals(request, env, url);
  }

  if (url.pathname === "/api/leaderboard") {
    return handleLeaderboard(request, env, url);
  }

  if (url.pathname === "/api/ratings") {
    return handleRatings(request, env);
  }

  if (url.pathname === "/api/admin/ingest") {
    return handleAdminIngest(request, env);
  }

  return errorResponse(request, env, 404, "not found");
}

async function handleMeals(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET") {
    return errorResponse(request, env, 405, "method not allowed");
  }

  const dateParam = url.searchParams.get("date");
  const serviceDate = dateParam ?? getVoteDayKey(new Date());
  if (!isValidYmd(serviceDate)) {
    return errorResponse(request, env, 400, "date must be YYYY-MM-DD");
  }

  const voteDayKey = dateParam ? serviceDate : getVoteDayKey(new Date());

  const meals = await env.DB.prepare(
    `SELECT
      meal_id,
      service_date,
      cafeteria_code,
      cafeteria_name_ko,
      cafeteria_name_en,
      meal_period,
      audience,
      menu_name_ko,
      menu_name_en,
      price_krw,
      is_operating
    FROM meals
    WHERE service_date = ?1
    ORDER BY cafeteria_code, meal_period, audience, meal_id`
  )
    .bind(serviceDate)
    .all<MealRow>();

  const { statsByMealId, globalMean } = await fetchRatingStats(env.DB, voteDayKey);
  const enriched: MealsResponseItem[] = meals.results.map((meal) => {
    const stat = statsByMealId.get(meal.meal_id);
    const avgStars = stat?.avg_stars ?? 0;
    const voteCount = stat?.vote_count ?? 0;
    return {
      ...meal,
      menu_name_en: normalizeEnglish(meal.menu_name_en, meal.menu_name_ko),
      avg_stars: avgStars,
      vote_count: voteCount,
      weighted_score: weightedScore(avgStars, voteCount, globalMean)
    };
  });

  return jsonResponse(request, env, {
    service_date: serviceDate,
    vote_day_key: voteDayKey,
    generated_at: new Date().toISOString(),
    total: enriched.length,
    global_mean: globalMean,
    meals: enriched
  });
}

async function handleLeaderboard(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET") {
    return errorResponse(request, env, 405, "method not allowed");
  }

  const dateParam = url.searchParams.get("date");
  const serviceDate = dateParam ?? getVoteDayKey(new Date());
  if (!isValidYmd(serviceDate)) {
    return errorResponse(request, env, 400, "date must be YYYY-MM-DD");
  }

  const voteDayKey = dateParam ? serviceDate : getVoteDayKey(new Date());
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "20"), 1), 100);

  const meals = await env.DB.prepare(
    `SELECT
      meal_id,
      cafeteria_name_ko,
      cafeteria_name_en,
      meal_period,
      audience,
      menu_name_ko,
      menu_name_en
     FROM meals
     WHERE service_date = ?1
       AND is_operating = 1`
  )
    .bind(serviceDate)
    .all<{
      meal_id: string;
      cafeteria_name_ko: string;
      cafeteria_name_en: string;
      meal_period: string;
      audience: string;
      menu_name_ko: string;
      menu_name_en: string;
    }>();

  const { statsByMealId, globalMean } = await fetchRatingStats(env.DB, voteDayKey);

  const leaderboard = meals.results
    .map((meal): LeaderboardItem | null => {
      const stat = statsByMealId.get(meal.meal_id);
      if (!stat || stat.vote_count <= 0) return null;
      return {
        ...meal,
        menu_name_en: normalizeEnglish(meal.menu_name_en, meal.menu_name_ko),
        avg_stars: stat.avg_stars,
        vote_count: stat.vote_count,
        weighted_score: weightedScore(stat.avg_stars, stat.vote_count, globalMean)
      };
    })
    .filter((item): item is LeaderboardItem => item !== null)
    .sort((a, b) => {
      if (b.weighted_score !== a.weighted_score) return b.weighted_score - a.weighted_score;
      if (b.vote_count !== a.vote_count) return b.vote_count - a.vote_count;
      return a.meal_id.localeCompare(b.meal_id);
    })
    .slice(0, limit);

  return jsonResponse(request, env, {
    service_date: serviceDate,
    vote_day_key: voteDayKey,
    global_mean: globalMean,
    count: leaderboard.length,
    leaderboard
  });
}

async function handleRatings(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return errorResponse(request, env, 405, "method not allowed");
  }

  if (!originAllowedForMutation(request, env)) {
    return errorResponse(request, env, 403, "forbidden origin");
  }

  let payload: {
    meal_id?: unknown;
    stars?: unknown;
    device_id?: unknown;
  };
  try {
    payload = (await parseJson(request)) as {
      meal_id?: unknown;
      stars?: unknown;
      device_id?: unknown;
    };
  } catch {
    return errorResponse(request, env, 400, "invalid JSON body");
  }

  const mealId = normalizeText(payload.meal_id);
  const stars = parseStars(payload.stars);
  const deviceId = normalizeText(payload.device_id);

  if (!mealId || stars === null || deviceId.length < 8 || deviceId.length > 128) {
    return errorResponse(request, env, 400, "invalid rating payload");
  }

  const activeServiceDate = getVoteDayKey(new Date());
  const existingMeal = await env.DB.prepare(
    "SELECT meal_id FROM meals WHERE meal_id = ?1 AND service_date = ?2 AND is_operating = 1"
  )
    .bind(mealId, activeServiceDate)
    .first<{ meal_id: string }>();

  if (!existingMeal) {
    return errorResponse(request, env, 404, "meal not found or not rateable");
  }

  const voteDayKey = getVoteDayKey(new Date());
  const ip = readClientIp(request);
  const ipHash = await sha256Hex(`${env.IP_SALT ?? "ip-salt"}|${ip}`);
  const deviceHash = await sha256Hex(`${env.DEVICE_SALT ?? "device-salt"}|${deviceId}`);

  const allowedByDailyLimit = await incrementRateLimit(
    env.DB,
    `rating:${voteDayKey}:${ipHash}`,
    RATING_DAILY_LIMIT,
    60 * 60 * 36
  );

  if (!allowedByDailyLimit) {
    return errorResponse(request, env, 429, "daily rating attempt limit exceeded");
  }

  try {
    await env.DB.prepare(
      `INSERT INTO ratings (meal_id, vote_day_key, device_hash, ip_hash, stars, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    )
      .bind(mealId, voteDayKey, deviceHash, ipHash, stars, new Date().toISOString())
      .run();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return errorResponse(request, env, 409, "already rated this meal today");
    }
    throw error;
  }

  return jsonResponse(
    request,
    env,
    {
      ok: true,
      meal_id: mealId,
      vote_day_key: voteDayKey,
      stars
    },
    201
  );
}

async function handleAdminIngest(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return errorResponse(request, env, 405, "method not allowed");
  }

  const expectedToken = env.SYNC_ADMIN_TOKEN;
  if (!expectedToken) {
    return errorResponse(request, env, 500, "SYNC_ADMIN_TOKEN not configured");
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  if (authHeader !== `Bearer ${expectedToken}`) {
    return errorResponse(request, env, 401, "unauthorized");
  }

  let body: {
    target_date?: unknown;
    run_type?: unknown;
    meals?: unknown;
  };
  try {
    body = (await parseJson(request)) as {
      target_date?: unknown;
      run_type?: unknown;
      meals?: unknown;
    };
  } catch {
    return errorResponse(request, env, 400, "invalid JSON body");
  }

  const targetDate = normalizeText(body.target_date);
  const runType = normalizeText(body.run_type) || "manual";
  if (!isValidYmd(targetDate)) {
    return errorResponse(request, env, 400, "target_date must be YYYY-MM-DD");
  }

  if (!Array.isArray(body.meals)) {
    return errorResponse(request, env, 400, "meals must be an array");
  }

  const meals = body.meals.map(normalizeIngestMeal).filter((meal): meal is IngestMeal => meal !== null);

  if (meals.length === 0) {
    return errorResponse(request, env, 400, "no valid meals in payload");
  }

  if (meals.some((meal) => meal.service_date !== targetDate)) {
    return errorResponse(request, env, 400, "all meals.service_date must match target_date");
  }

  try {
    await replaceMealsForDate(env.DB, targetDate, meals);
    await cleanupRetention(env.DB, targetDate, retentionMonths(env));
    await logSyncRun(env.DB, runType, targetDate, "ok", `ingested ${meals.length} meals`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ingest failed";
    await logSyncRun(env.DB, runType, targetDate, "fail", message);
    throw error;
  }

  return jsonResponse(request, env, {
    ok: true,
    target_date: targetDate,
    ingested: meals.length
  });
}

async function replaceMealsForDate(db: D1Database, targetDate: string, meals: IngestMeal[]): Promise<void> {
  await upsertMeals(db, meals);

  const ids = [...new Set(meals.map((meal) => meal.meal_id))];
  if (ids.length === 0) return;

  const placeholders = ids.map((_, idx) => `?${idx + 2}`).join(", ");
  const bindings: unknown[] = [targetDate, ...ids];

  await db
    .prepare(`DELETE FROM meals WHERE service_date = ?1 AND meal_id NOT IN (${placeholders})`)
    .bind(...bindings)
    .run();

  await db
    .prepare(`DELETE FROM ratings WHERE vote_day_key = ?1 AND meal_id NOT IN (${placeholders})`)
    .bind(...bindings)
    .run();
}

async function upsertMeals(db: D1Database, meals: IngestMeal[]): Promise<void> {
  const now = new Date().toISOString();
  const statements = meals.map((meal) =>
    db
      .prepare(
        `INSERT INTO meals (
          meal_id,
          service_date,
          cafeteria_code,
          cafeteria_name_ko,
          cafeteria_name_en,
          meal_period,
          audience,
          menu_name_ko,
          menu_name_en,
          price_krw,
          is_operating,
          source_hash,
          updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
        ON CONFLICT(meal_id) DO UPDATE SET
          service_date = excluded.service_date,
          cafeteria_code = excluded.cafeteria_code,
          cafeteria_name_ko = excluded.cafeteria_name_ko,
          cafeteria_name_en = excluded.cafeteria_name_en,
          meal_period = excluded.meal_period,
          audience = excluded.audience,
          menu_name_ko = excluded.menu_name_ko,
          menu_name_en = excluded.menu_name_en,
          price_krw = excluded.price_krw,
          is_operating = excluded.is_operating,
          source_hash = excluded.source_hash,
          updated_at = excluded.updated_at`
      )
      .bind(
        meal.meal_id,
        meal.service_date,
        meal.cafeteria_code,
        meal.cafeteria_name_ko,
        meal.cafeteria_name_en,
        meal.meal_period,
        meal.audience,
        meal.menu_name_ko,
        meal.menu_name_en,
        meal.price_krw ?? null,
        meal.is_operating ? 1 : 0,
        meal.source_hash,
        now
      )
  );

  const chunkSize = 50;
  for (let i = 0; i < statements.length; i += chunkSize) {
    await db.batch(statements.slice(i, i + chunkSize));
  }
}

async function cleanupRetention(db: D1Database, targetDate: string, months: number): Promise<void> {
  const monthExpr = `-${months} months`;
  const nowIso = new Date().toISOString();
  await db.prepare("DELETE FROM ratings WHERE vote_day_key < date(?1, ?2)").bind(targetDate, monthExpr).run();
  await db.prepare("DELETE FROM meals WHERE service_date < date(?1, ?2)").bind(targetDate, monthExpr).run();
  await db.prepare("DELETE FROM ip_rate_limits WHERE expires_at < ?1").bind(nowIso).run();
}

async function fetchRatingStats(
  db: D1Database,
  voteDayKey: string
): Promise<{ statsByMealId: Map<string, RatingStats>; globalMean: number }> {
  const statsRows = await db
    .prepare(
      `SELECT meal_id, AVG(stars) AS avg_stars, COUNT(*) AS vote_count
       FROM ratings
       WHERE vote_day_key = ?1
       GROUP BY meal_id`
    )
    .bind(voteDayKey)
    .all<{ meal_id: string; avg_stars: number; vote_count: number }>();

  const global = await db
    .prepare("SELECT AVG(stars) AS global_mean FROM ratings WHERE vote_day_key = ?1")
    .bind(voteDayKey)
    .first<{ global_mean: number | null }>();

  const statsByMealId = new Map<string, RatingStats>();
  for (const row of statsRows.results) {
    statsByMealId.set(row.meal_id, {
      meal_id: row.meal_id,
      avg_stars: Number(row.avg_stars) || 0,
      vote_count: Number(row.vote_count) || 0
    });
  }

  return {
    statsByMealId,
    globalMean: Number(global?.global_mean ?? 3) || 3
  };
}

async function enforceApiBurstLimit(request: Request, env: Env): Promise<Response | null> {
  const ip = readClientIp(request);
  const ipHash = await sha256Hex(`${env.IP_SALT ?? "ip-salt"}|${ip}`);
  const windowKey = getUtcWindowKey(new Date(), 10);
  const allowed = await incrementRateLimit(env.DB, `api:${windowKey}:${ipHash}`, API_BURST_LIMIT, 60 * 30);
  if (allowed) return null;
  return errorResponse(request, env, 429, "too many requests");
}

async function incrementRateLimit(
  db: D1Database,
  key: string,
  limit: number,
  ttlSeconds: number
): Promise<boolean> {
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresIso = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

  await db
    .prepare(
      `INSERT INTO ip_rate_limits (key, counter, expires_at, updated_at)
       VALUES (?1, 1, ?2, ?3)
       ON CONFLICT(key) DO UPDATE SET
         counter = counter + 1,
         updated_at = excluded.updated_at`
    )
    .bind(key, expiresIso, nowIso)
    .run();

  const row = await db
    .prepare("SELECT counter FROM ip_rate_limits WHERE key = ?1")
    .bind(key)
    .first<{ counter: number }>();

  return Number(row?.counter ?? 0) <= limit;
}

async function logSyncRun(
  db: D1Database,
  runType: string,
  targetDate: string,
  status: "ok" | "fail",
  message: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sync_runs (run_type, target_date, status, message, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`
    )
    .bind(runType, targetDate, status, message.slice(0, 500), new Date().toISOString())
    .run();
}

function normalizeIngestMeal(raw: unknown): IngestMeal | null {
  if (!raw || typeof raw !== "object") return null;
  const meal = raw as Record<string, unknown>;

  const normalized: IngestMeal = {
    meal_id: normalizeText(meal.meal_id),
    service_date: normalizeText(meal.service_date),
    cafeteria_code: normalizeText(meal.cafeteria_code),
    cafeteria_name_ko: normalizeText(meal.cafeteria_name_ko),
    cafeteria_name_en: normalizeText(meal.cafeteria_name_en),
    meal_period: normalizeText(meal.meal_period),
    audience: normalizeText(meal.audience),
    menu_name_ko: normalizeText(meal.menu_name_ko),
    menu_name_en: normalizeEnglish(normalizeText(meal.menu_name_en), normalizeText(meal.menu_name_ko)),
    price_krw:
      meal.price_krw === null || meal.price_krw === undefined || meal.price_krw === ""
        ? null
        : Number(meal.price_krw),
    is_operating: Boolean(meal.is_operating),
    source_hash: normalizeText(meal.source_hash)
  };

  if (
    !normalized.meal_id ||
    !isValidYmd(normalized.service_date) ||
    !normalized.cafeteria_code ||
    !normalized.cafeteria_name_ko ||
    !normalized.cafeteria_name_en ||
    !normalized.meal_period ||
    !normalized.audience ||
    !normalized.menu_name_ko ||
    !normalized.source_hash
  ) {
    return null;
  }

  if (normalized.price_krw !== null && !Number.isFinite(normalized.price_krw)) {
    normalized.price_krw = null;
  }

  return normalized;
}

function retentionMonths(env: Env): number {
  const parsed = Number(env.RETENTION_MONTHS ?? RETENTION_MONTHS_DEFAULT);
  if (!Number.isInteger(parsed)) return RETENTION_MONTHS_DEFAULT;
  if (parsed < 1) return RETENTION_MONTHS_DEFAULT;
  if (parsed > 60) return 60;
  return parsed;
}

function readClientIp(request: Request): string {
  const headerIp = request.headers.get("CF-Connecting-IP") ?? request.headers.get("X-Forwarded-For") ?? "0.0.0.0";
  return headerIp.split(",")[0].trim();
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /UNIQUE constraint failed/i.test(error.message);
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function parseJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new Error("invalid JSON body");
  }
}

function buildCorsHeaders(request: Request, env: Env, includeMethods = false): Headers {
  const headers = new Headers();
  const configured = normalizeText(env.ALLOWED_ORIGIN);
  const origin = request.headers.get("Origin") ?? "";

  if (!configured || configured === "*") {
    headers.set("Access-Control-Allow-Origin", "*");
  } else if (origin === configured) {
    headers.set("Access-Control-Allow-Origin", configured);
    headers.set("Vary", "Origin");
  } else {
    headers.set("Access-Control-Allow-Origin", configured);
    headers.set("Vary", "Origin");
  }

  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (includeMethods) {
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Max-Age", "600");
  }

  return headers;
}

function originAllowedForMutation(request: Request, env: Env): boolean {
  const configured = normalizeText(env.ALLOWED_ORIGIN);
  if (!configured || configured === "*") return true;
  const origin = request.headers.get("Origin") ?? "";
  return origin === configured;
}

function jsonResponse(request: Request, env: Env, body: unknown, status = 200): Response {
  const headers = buildCorsHeaders(request, env);
  for (const [key, value] of Object.entries(JSON_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(request: Request, env: Env, status: number, error: string): Response {
  return jsonResponse(request, env, { error }, status);
}

export { weightedScore, getVoteDayKey };
