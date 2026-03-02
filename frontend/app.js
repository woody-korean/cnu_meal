const config = window.CNU_CONFIG || {};
const API_BASE_URL = (config.API_BASE_URL || "").replace(/\/$/, "");

const mealRoot = document.getElementById("meals-root");
const leaderboardRoot = document.getElementById("leaderboard");
const statusEl = document.getElementById("status");
const refreshButton = document.getElementById("refresh-button");

const serviceDateEl = document.getElementById("service-date");
const voteDayKeyEl = document.getElementById("vote-day-key");
const generatedAtEl = document.getElementById("generated-at");

const dateInput = document.getElementById("filter-date");
const todayButton = document.getElementById("today-button");
const periodFilter = document.getElementById("filter-period");
const audienceFilter = document.getElementById("filter-audience");
const sortMode = document.getElementById("sort-mode");
const englishToggle = document.getElementById("toggle-english");
const mobileJumpRoot = document.getElementById("mobile-cafeteria-jump");

const ALLERGEN_RULES = [
  { label: "난류", keywords: ["계란", "달걀", "egg"] },
  { label: "우유", keywords: ["우유", "치즈", "요거트", "milk", "cheese", "yogurt"] },
  { label: "밀", keywords: ["밀", "빵", "면", "국수", "우동", "파스타", "dumpling", "noodle", "bread", "wheat"] },
  { label: "대두", keywords: ["콩", "두부", "soy", "tofu"] },
  { label: "견과", keywords: ["견과", "땅콩", "호두", "nut", "peanut", "walnut", "almond"] },
  { label: "어류", keywords: ["생선", "고등어", "fish", "mackerel", "salmon", "tuna"] },
  { label: "갑각류", keywords: ["새우", "게", "shrimp", "crab", "lobster"] }
];

const deviceId = getOrCreateDeviceId();

const uiState = {
  selectedDate: "",
  period: "all",
  audience: "all",
  sort: "recommended",
  showEnglish: false
};

let latestVoteDayKey = "";
let currentServiceDate = "";
let currentMeals = [];
let currentLeaderboard = [];
let selectedStarsByMeal = new Map();

refreshButton.addEventListener("click", () => {
  loadData().catch((error) => {
    setStatus(`Failed to refresh: ${error.message}`, true);
  });
});

if (dateInput) {
  dateInput.addEventListener("change", () => {
    uiState.selectedDate = dateInput.value || "";
    loadData().catch((error) => {
      setStatus(`Failed to load date: ${error.message}`, true);
    });
  });
}

if (todayButton) {
  todayButton.addEventListener("click", () => {
    uiState.selectedDate = "";
    if (dateInput) dateInput.value = "";
    loadData().catch((error) => {
      setStatus(`Failed to load today: ${error.message}`, true);
    });
  });
}

if (periodFilter) {
  periodFilter.addEventListener("change", () => {
    uiState.period = periodFilter.value;
    renderAll();
  });
}

if (audienceFilter) {
  audienceFilter.addEventListener("change", () => {
    uiState.audience = audienceFilter.value;
    renderAll();
  });
}

if (sortMode) {
  sortMode.addEventListener("change", () => {
    uiState.sort = sortMode.value;
    renderAll();
  });
}

if (englishToggle) {
  englishToggle.addEventListener("change", () => {
    uiState.showEnglish = englishToggle.checked;
    renderAll();
  });
}

loadData().catch((error) => {
  setStatus(`Failed to load: ${error.message}`, true);
});

async function loadData() {
  if (!API_BASE_URL) {
    setStatus("Set API_BASE_URL in frontend/config.js first.", true);
    return;
  }

  setStatus("Loading meals...", false);

  const dateQuery = uiState.selectedDate ? `?date=${encodeURIComponent(uiState.selectedDate)}` : "";

  const [mealsData, leaderboardData] = await Promise.all([
    fetchJson(`/api/meals${dateQuery}`),
    fetchJson(`/api/leaderboard${dateQuery ? `${dateQuery}&limit=15` : "?limit=15"}`)
  ]);

  currentMeals = mealsData.meals || [];
  currentLeaderboard = leaderboardData.leaderboard || [];
  latestVoteDayKey = mealsData.vote_day_key;
  currentServiceDate = mealsData.service_date || "";
  selectedStarsByMeal = new Map();

  serviceDateEl.textContent = mealsData.service_date || "-";
  voteDayKeyEl.textContent = mealsData.vote_day_key || "-";
  generatedAtEl.textContent = formatDateTime(mealsData.generated_at);

  if (dateInput && !uiState.selectedDate && mealsData.service_date) {
    dateInput.value = mealsData.service_date;
  }

  renderAll();
}

function renderAll() {
  renderLeaderboard(currentLeaderboard);
  renderMeals(currentMeals);
  renderSummary(currentMeals);
}

function renderSummary(meals) {
  const visible = getVisibleMeals(meals);
  const operatingCount = visible.filter((meal) => meal.is_operating).length;
  const dateText = currentServiceDate || uiState.selectedDate || "-";
  setStatus(`${dateText} · ${visible.length} meals shown · ${operatingCount} open`, false);
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

    const koDishes = parseDishList(item.menu_name_ko);
    const enDishes = parseDishList(item.menu_name_en);

    const title = document.createElement("div");
    title.className = "rank-title";
    title.textContent = koDishes[0] || formatMenuDisplay(item.menu_name_ko);

    const info = document.createElement("div");
    info.className = "rank-sub";
    info.textContent = `${item.cafeteria_name_ko} · ${item.meal_period} ${item.audience}`;

    const meta = document.createElement("div");
    meta.className = "rank-sub";
    meta.textContent = `${item.vote_count} votes`;

    const score = document.createElement("div");
    score.className = "rank-score";
    score.textContent = `⭐ ${Number(item.weighted_score).toFixed(2)}`;

    const rank = document.createElement("div");
    rank.className = "rank-badge";
    rank.textContent = String(index + 1);

    const body = document.createElement("div");
    body.className = "rank-body";
    body.append(title, info);

    if (uiState.showEnglish && hasMeaningfulEnglish(item.menu_name_en, item.menu_name_ko)) {
      const en = document.createElement("div");
      en.className = "rank-sub rank-en";
      en.textContent = enDishes[0] || formatMenuDisplay(item.menu_name_en);
      body.appendChild(en);
    }

    const right = document.createElement("div");
    right.append(score, meta);

    wrapper.append(rank, body, right);
    leaderboardRoot.appendChild(wrapper);
  });
}

function renderMeals(meals) {
  const visibleMeals = getVisibleMeals(meals);
  const jumpItems = [];

  if (!visibleMeals.length) {
    mealRoot.innerHTML = '<p class="status">No meals found for current filters.</p>';
    renderMobileJump(jumpItems);
    return;
  }

  const ratedSet = getRatedSet(latestVoteDayKey);
  const grouped = groupBy(visibleMeals, (meal) => meal.cafeteria_code);

  mealRoot.innerHTML = "";

  Object.values(grouped).forEach((groupMeals, index) => {
    const first = groupMeals[0];
    const block = document.createElement("section");
    block.className = "cafeteria-block";
    block.id = buildCafeteriaSectionId(first, index);

    const head = document.createElement("header");
    head.className = "cafeteria-head";

    const ko = document.createElement("div");
    ko.className = "cafe-ko";
    ko.textContent = first.cafeteria_name_ko;

    head.appendChild(ko);
    if (uiState.showEnglish && hasMeaningfulEnglish(first.cafeteria_name_en, first.cafeteria_name_ko)) {
      const en = document.createElement("div");
      en.className = "cafe-en";
      en.textContent = first.cafeteria_name_en;
      head.appendChild(en);
    }

    const grid = document.createElement("div");
    grid.className = "meal-grid";

    const sorted = sortMeals(groupMeals, uiState.sort);
    sorted.forEach((meal) => {
      grid.appendChild(renderMealCard(meal, ratedSet));
    });

    block.append(head, grid);
    mealRoot.appendChild(block);

    jumpItems.push({
      sectionId: block.id,
      koName: first.cafeteria_name_ko,
      enName: first.cafeteria_name_en
    });
  });

  renderMobileJump(jumpItems);
}

function renderMealCard(meal, ratedSet) {
  const card = document.createElement("article");
  card.className = "meal-card";
  const alreadyRated = meal.is_operating ? ratedSet.has(meal.meal_id) : false;
  const ratingState = !meal.is_operating ? "closed" : alreadyRated ? "rated" : "unrated";
  const stateLabel = ratingState === "closed" ? "평가마감" : ratingState === "rated" ? "평가완료" : "평가가능";
  card.classList.add(`state-${ratingState}`);

  const top = document.createElement("div");
  top.className = "primary-line";

  const chips = document.createElement("div");
  chips.className = "chip-row";

  chips.append(
    chip(meal.meal_period, `chip period-${periodClass(meal.meal_period)}`),
    chip(meal.audience, `chip audience-${audienceClass(meal.audience)}`),
    chip(stateLabel, `chip state-${ratingState}`)
  );

  const price = document.createElement("div");
  price.className = "primary-price";
  price.textContent = formatPriceKrw(meal.price_krw) || "₩-";

  top.append(chips, price);

  const koDishes = parseDishList(meal.menu_name_ko);
  const enDishes = parseDishList(meal.menu_name_en);

  const menuList = document.createElement("ul");
  menuList.className = "menu-list";
  koDishes.forEach((dish) => {
    const li = document.createElement("li");
    li.textContent = dish;
    menuList.appendChild(li);
  });

  const allergenTags = detectAllergens(meal);
  const allergenRow = document.createElement("div");
  allergenRow.className = "allergen-row";
  allergenTags.forEach((name) => {
    allergenRow.appendChild(chip(name, "chip allergen"));
  });

  card.append(top, menuList);

  if (uiState.showEnglish && hasMeaningfulEnglishMenu(meal.menu_name_en, meal.menu_name_ko, enDishes, koDishes)) {
    const enWrap = document.createElement("details");
    enWrap.className = "english-block";

    const summary = document.createElement("summary");
    summary.textContent = "English menu (optional)";

    const enList = document.createElement("ul");
    enList.className = "menu-list menu-list-en";
    enDishes.forEach((dish) => {
      const li = document.createElement("li");
      li.textContent = dish;
      enList.appendChild(li);
    });

    enWrap.append(summary, enList);
    card.appendChild(enWrap);
  }

  if (allergenTags.length) {
    card.appendChild(allergenRow);
  }

  if (!meal.is_operating) {
    const notice = document.createElement("div");
    notice.className = "not-operating";
    notice.textContent = "운영 종료로 평가할 수 없습니다.";
    card.appendChild(notice);
    return card;
  }

  const currentRating = document.createElement("div");
  currentRating.className = "rating-current";
  currentRating.textContent = `현재 평점 ⭐${Number(meal.avg_stars || 0).toFixed(2)} (${meal.vote_count || 0}표)`;

  card.appendChild(currentRating);

  if (alreadyRated) {
    const ratedNote = document.createElement("div");
    ratedNote.className = "rated-note";
    ratedNote.textContent = "오늘 평가를 이미 완료했습니다.";
    card.appendChild(ratedNote);
    return card;
  }

  const rateLabel = document.createElement("div");
  rateLabel.className = "rate-label";
  rateLabel.textContent = "내 평가";

  const ratingRow = document.createElement("div");
  ratingRow.className = "rating-row";

  const helper = document.createElement("div");
  helper.className = "rate-helper";
  helper.textContent = "별점을 선택한 뒤 제출하세요.";

  const buttons = [];
  const selected = selectedStarsByMeal.get(meal.meal_id) || 0;

  for (let star = 1; star <= 5; star += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "star-btn";
    button.textContent = "★";
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
      helper.textContent = `${star}점 선택됨`;
    });

    buttons.push(button);
    ratingRow.appendChild(button);
  }

  const submitBtn = document.createElement("button");
  submitBtn.type = "button";
  submitBtn.className = "submit-rating";
  submitBtn.disabled = selected < 1;
  submitBtn.textContent = "평점 제출";

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

  card.append(rateLabel, ratingRow, helper, submitBtn);
  return card;
}

function renderMobileJump(items) {
  if (!mobileJumpRoot) return;

  if (!items.length) {
    mobileJumpRoot.innerHTML = "";
    return;
  }

  mobileJumpRoot.innerHTML = "";

  const label = document.createElement("div");
  label.className = "mobile-jump-label";
  label.textContent = "식당 바로가기";

  const list = document.createElement("div");
  list.className = "mobile-jump-list";

  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mobile-jump-btn";

    const ko = document.createElement("span");
    ko.className = "jump-ko";
    ko.textContent = item.koName || "-";
    button.appendChild(ko);

    if (uiState.showEnglish && hasMeaningfulEnglish(item.enName, item.koName)) {
      const en = document.createElement("span");
      en.className = "jump-en";
      en.textContent = item.enName;
      button.appendChild(en);
    }

    button.addEventListener("click", () => {
      document.getElementById(item.sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    list.appendChild(button);
  });

  mobileJumpRoot.append(label, list);
}

function getVisibleMeals(meals) {
  return meals.filter((meal) => {
    if (uiState.period !== "all" && meal.meal_period !== uiState.period) return false;
    if (uiState.audience !== "all" && meal.audience !== uiState.audience) return false;
    return true;
  });
}

function sortMeals(meals, mode) {
  const copy = [...meals];
  copy.sort((a, b) => {
    if (mode === "price_asc") {
      return comparePrice(a.price_krw, b.price_krw);
    }
    if (mode === "price_desc") {
      return comparePrice(b.price_krw, a.price_krw);
    }
    if (mode === "rating") {
      if ((b.avg_stars || 0) !== (a.avg_stars || 0)) return (b.avg_stars || 0) - (a.avg_stars || 0);
      return (b.vote_count || 0) - (a.vote_count || 0);
    }

    if ((b.weighted_score || 0) !== (a.weighted_score || 0)) return (b.weighted_score || 0) - (a.weighted_score || 0);
    if ((b.vote_count || 0) !== (a.vote_count || 0)) return (b.vote_count || 0) - (a.vote_count || 0);
    return comparePrice(a.price_krw, b.price_krw);
  });
  return copy;
}

function comparePrice(a, b) {
  const ax = Number(a);
  const bx = Number(b);
  const aMissing = !Number.isFinite(ax) || ax <= 0;
  const bMissing = !Number.isFinite(bx) || bx <= 0;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return ax - bx;
}

function parseDishList(value) {
  const source = String(value || "").trim();
  if (!source || source === "운영안함") return [];

  let text = stripMenuPrefix(source);
  if (text.includes("|")) {
    const parts = text
      .split("|")
      .map((part) => part.trim())
      .filter(Boolean);
    text = parts.length > 1 ? parts.slice(1).join(" / ") : parts[0] || "";
  }

  return text
    .split("/")
    .map((dish) => dish.trim())
    .filter(Boolean);
}

function stripMenuPrefix(value) {
  return String(value)
    .replace(/^\s*(정식|세트|set)\s*\(\s*\d{3,6}\s*\)\s*\|?\s*/i, "")
    .trim();
}

function formatMenuDisplay(value) {
  return stripMenuPrefix(String(value || ""));
}

function formatPriceKrw(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return `₩${amount.toLocaleString("ko-KR")}`;
}

function buildCafeteriaSectionId(meal, index) {
  const seed = `${meal.cafeteria_code || "cafeteria"}-${meal.cafeteria_name_ko || ""}-${index}`;
  const slug = String(seed)
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `cafeteria-${slug || index}`;
}

function hasMeaningfulEnglish(valueEn, valueKo) {
  const en = normalizeText(stripMenuPrefix(valueEn || ""));
  const ko = normalizeText(stripMenuPrefix(valueKo || ""));
  if (!en) return false;
  if (!/[a-z]/i.test(en)) return false;
  if (en.toLowerCase() === "closed") return false;
  if (ko && en.toLowerCase() === ko.toLowerCase()) return false;
  return true;
}

function hasMeaningfulEnglishMenu(rawEn, rawKo, enDishes, koDishes) {
  if (!hasMeaningfulEnglish(rawEn, rawKo)) return false;
  if (!enDishes.length) return false;

  const enText = normalizeText(enDishes.join(" / "));
  const koText = normalizeText(koDishes.join(" / "));
  if (koText && enText.toLowerCase() === koText.toLowerCase()) return false;
  return true;
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function detectAllergens(meal) {
  const text = `${meal.menu_name_ko || ""} ${meal.menu_name_en || ""}`.toLowerCase();
  const found = [];

  ALLERGEN_RULES.forEach((rule) => {
    if (rule.keywords.some((keyword) => text.includes(String(keyword).toLowerCase()))) {
      found.push(rule.label);
    }
  });

  return found;
}

function periodClass(value) {
  if (value === "조식") return "breakfast";
  if (value === "중식") return "lunch";
  if (value === "석식") return "dinner";
  return "other";
}

function audienceClass(value) {
  if (value === "학생") return "student";
  if (value === "직원") return "staff";
  return "other";
}

function chip(label, className) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = label;
  return span;
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
  statusEl.style.color = isError ? "var(--danger)" : "var(--ink-soft)";
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
