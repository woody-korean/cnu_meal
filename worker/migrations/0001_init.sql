CREATE TABLE IF NOT EXISTS meals (
  meal_id TEXT PRIMARY KEY,
  service_date TEXT NOT NULL,
  cafeteria_code TEXT NOT NULL,
  cafeteria_name_ko TEXT NOT NULL,
  cafeteria_name_en TEXT NOT NULL,
  meal_period TEXT NOT NULL,
  audience TEXT NOT NULL,
  menu_name_ko TEXT NOT NULL,
  menu_name_en TEXT NOT NULL,
  price_krw INTEGER,
  is_operating INTEGER NOT NULL DEFAULT 1,
  source_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meals_service_date ON meals(service_date);
CREATE INDEX IF NOT EXISTS idx_meals_cafeteria_date ON meals(cafeteria_code, service_date);

CREATE TABLE IF NOT EXISTS ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meal_id TEXT NOT NULL,
  vote_day_key TEXT NOT NULL,
  device_hash TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  stars INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(meal_id, vote_day_key, device_hash),
  FOREIGN KEY(meal_id) REFERENCES meals(meal_id)
);

CREATE INDEX IF NOT EXISTS idx_ratings_vote_day ON ratings(vote_day_key);
CREATE INDEX IF NOT EXISTS idx_ratings_meal_vote_day ON ratings(meal_id, vote_day_key);

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_type TEXT NOT NULL,
  target_date TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ip_rate_limits (
  key TEXT PRIMARY KEY,
  counter INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ip_rate_limits_expires ON ip_rate_limits(expires_at);
