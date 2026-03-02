const config = window.CNU_CONFIG || {};
const API_BASE_URL = (config.API_BASE_URL || "").replace(/\/$/, "");

const mealRoot = document.getElementById("meals-root");
const leaderboardRoot = document.getElementById("leaderboard");
const statusEl = document.getElementById("status");
const refreshButton = document.getElementById("refresh-button");

const serviceDateEl = document.getElementById("service-date");
const voteDayKeyEl = document.getElementById("vote-day-key");
const generatedAtEl = document.getElementById("generated-at");

let latestVoteDayKey = "";
let currentMeals = [];
let selectedStarsByMeal = new Map();

const deviceId = getOrCreateDeviceId();

refreshButton.addEventListener("click", () => {
  loadData().catch((error) => {
    setStatus(`Failed to refresh: ${error.message}`, true);
  });
});

loadData().catch((error) => {
  setStatus(`Failed to load: ${error.message}`, true);
});

async function loadData() {
  if (!API_BASE_URL) {
    setStatus("Set API_BASE_URL in frontend/config.js first.", true);
    return;
  }

  setStatus("Loading meals...", false);

  const [mealsData, leaderboardData] = await Promise.all([
    fetchJson("/api/meals"),
    fetchJson("/api/leaderboard?limit=15")
  ]);

  currentMeals = mealsData.meals || [];
  latestVoteDayKey = mealsData.vote_day_key;

  serviceDateEl.textContent = mealsData.service_date || "-";
  voteDayKeyEl.textContent = mealsData.vote_day_key || "-";
  generatedAtEl.textContent = formatDateTime(mealsData.generated_at);

  renderLeaderboard(leaderboardData.leaderboard || []);
  renderMeals(currentMeals);

  setStatus(`Loaded ${currentMeals.length} meals.`, false);
}

function renderLeaderboard(items) {
  if (!items.length) {
    leaderboardRoot.innerHTML = '<p class="status">No ratings yet. Be the first to vote.</p>';
    return;
  }

  leaderboardRoot.innerHTML = "";

  items.forEach((item, index) => {
    const wrapper = document.createElement("article");
    wrapper.className = "leader-item";
    wrapper.innerHTML = `
      <div class="rank-badge">${index + 1}</div>
      <div>
        <div class="rank-title">${escapeHtml(item.menu_name_ko)}</div>
        <div class="rank-sub">${escapeHtml(item.menu_name_en)} · ${escapeHtml(item.cafeteria_name_ko)} (${escapeHtml(item.meal_period)} ${escapeHtml(item.audience)})</div>
      </div>
      <div class="rank-score">⭐ ${Number(item.weighted_score).toFixed(2)}<br/><span class="rank-sub">${item.vote_count} votes</span></div>
    `;
    leaderboardRoot.appendChild(wrapper);
  });
}

function renderMeals(meals) {
  if (!meals.length) {
    mealRoot.innerHTML = '<p class="status">No meals available for today.</p>';
    return;
  }

  const ratedSet = getRatedSet(latestVoteDayKey);
  const grouped = groupBy(meals, (meal) => meal.cafeteria_code);

  mealRoot.innerHTML = "";

  Object.values(grouped).forEach((groupMeals) => {
    const first = groupMeals[0];
    const block = document.createElement("section");
    block.className = "cafeteria-block";

    const head = document.createElement("header");
    head.className = "cafeteria-head";
    head.innerHTML = `
      <div class="cafe-ko">${escapeHtml(first.cafeteria_name_ko)}</div>
      <div class="cafe-en">${escapeHtml(first.cafeteria_name_en)}</div>
    `;

    const grid = document.createElement("div");
    grid.className = "meal-grid";

    groupMeals.forEach((meal) => {
      grid.appendChild(renderMealCard(meal, ratedSet));
    });

    block.appendChild(head);
    block.appendChild(grid);
    mealRoot.appendChild(block);
  });
}

function renderMealCard(meal, ratedSet) {
  const card = document.createElement("article");
  card.className = "meal-card";

  const tag = document.createElement("span");
  tag.className = "meal-tag";
  tag.textContent = `${meal.meal_period} · ${meal.audience}`;

  const koName = document.createElement("div");
  koName.className = "meal-name-ko";
  koName.textContent = meal.menu_name_ko;

  const enName = document.createElement("div");
  enName.className = "meal-name-en";
  enName.textContent = meal.menu_name_en;

  const meta = document.createElement("div");
  meta.className = "rating-meta";
  meta.textContent = `Avg ${Number(meal.avg_stars || 0).toFixed(2)} · ${meal.vote_count || 0} votes`;

  card.append(tag, koName, enName, meta);

  if (!meal.is_operating) {
    const notice = document.createElement("div");
    notice.className = "not-operating";
    notice.textContent = "운영안함 / Not operating";
    card.appendChild(notice);
    return card;
  }

  const alreadyRated = ratedSet.has(meal.meal_id);

  const ratingRow = document.createElement("div");
  ratingRow.className = "rating-row";

  const buttons = [];
  const selected = selectedStarsByMeal.get(meal.meal_id) || 0;

  for (let star = 1; star <= 5; star += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "star-btn";
    button.textContent = "★";
    button.disabled = alreadyRated;
    button.dataset.star = String(star);

    if (star <= selected) {
      button.classList.add("is-active");
    }

    button.addEventListener("click", () => {
      selectedStarsByMeal.set(meal.meal_id, star);
      buttons.forEach((btn, i) => {
        btn.classList.toggle("is-active", i + 1 <= star);
      });
      submitBtn.disabled = false;
    });

    buttons.push(button);
    ratingRow.appendChild(button);
  }

  const submitBtn = document.createElement("button");
  submitBtn.type = "button";
  submitBtn.className = "submit-rating";
  submitBtn.disabled = alreadyRated || selected < 1;
  submitBtn.textContent = alreadyRated ? "Rated" : "Submit";

  submitBtn.addEventListener("click", async () => {
    const stars = selectedStarsByMeal.get(meal.meal_id);
    if (!stars) return;

    submitBtn.disabled = true;
    try {
      await postJson("/api/ratings", {
        meal_id: meal.meal_id,
        stars,
        device_id: deviceId
      });

      rememberRated(meal.meal_id, latestVoteDayKey);
      setStatus("Rating submitted.", false);
      await loadData();
    } catch (error) {
      submitBtn.disabled = false;
      setStatus(error.message, true);
    }
  });

  card.append(ratingRow, submitBtn);
  return card;
}

async function fetchJson(path) {
  const res = await fetch(apiUrl(path), { headers: { Accept: "application/json" } });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload.error || `HTTP ${res.status}`);
  }
  return payload;
}

async function postJson(path, body) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(body)
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload.error || `HTTP ${res.status}`);
  }
  return payload;
}

function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

function setStatus(message, isError) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#be123c" : "#334155";
}

function getOrCreateDeviceId() {
  const key = "cnu_meal_device_id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;

  const created = crypto.randomUUID();
  localStorage.setItem(key, created);
  return created;
}

function ratedStorageKey(voteDayKey) {
  return `cnu_meal_rated_${voteDayKey || "unknown"}`;
}

function getRatedSet(voteDayKey) {
  const raw = localStorage.getItem(ratedStorageKey(voteDayKey));
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function rememberRated(mealId, voteDayKey) {
  const set = getRatedSet(voteDayKey);
  set.add(mealId);
  localStorage.setItem(ratedStorageKey(voteDayKey), JSON.stringify([...set]));
}

function groupBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ko-KR", { hour12: false });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
