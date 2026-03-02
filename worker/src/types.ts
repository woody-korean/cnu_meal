export interface Env {
  DB: D1Database;
  ALLOWED_ORIGIN?: string;
  SYNC_ADMIN_TOKEN?: string;
  DEVICE_SALT?: string;
  IP_SALT?: string;
  RETENTION_MONTHS?: string;
}

export interface MealRow {
  meal_id: string;
  service_date: string;
  cafeteria_code: string;
  cafeteria_name_ko: string;
  cafeteria_name_en: string;
  meal_period: string;
  audience: string;
  menu_name_ko: string;
  menu_name_en: string;
  price_krw: number | null;
  is_operating: number;
}

export interface RatingStats {
  meal_id: string;
  avg_stars: number;
  vote_count: number;
}

export interface IngestMeal {
  meal_id: string;
  service_date: string;
  cafeteria_code: string;
  cafeteria_name_ko: string;
  cafeteria_name_en: string;
  meal_period: string;
  audience: string;
  menu_name_ko: string;
  menu_name_en: string;
  price_krw?: number | null;
  is_operating: boolean;
  source_hash: string;
}
