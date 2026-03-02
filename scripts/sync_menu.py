#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

from scripts.cnu_parser import (
    merge_language_rows,
    parse_cafeteria_day_entries,
    to_dot_date,
    validate_target_date,
)

BASE_URL = "https://mobileadmin.cnu.ac.kr/food/index.jsp"
LANG_KO = "OCL04.10"
LANG_EN = "OCL04.20"
CAFETERIA_CODES = ["OCL03.01", "OCL03.02", "OCL03.03", "OCL03.04", "OCL03.05"]


def kst_today() -> str:
    kst = timezone(timedelta(hours=9))
    return datetime.now(tz=kst).date().isoformat()


def fetch_html(target_date: str, lang: str, cafeteria_code: str, timeout: int = 20) -> str:
    params = {
        "searchYmd": to_dot_date(target_date),
        "searchLang": lang,
        "searchView": "date",
        "searchCafeteria": cafeteria_code,
    }
    response = requests.get(BASE_URL, params=params, timeout=timeout)
    response.raise_for_status()
    return response.text


def collect_meals(target_date: str) -> list[dict[str, Any]]:
    all_meals: list[dict[str, Any]] = []

    for cafeteria_code in CAFETERIA_CODES:
        ko_html = fetch_html(target_date, LANG_KO, cafeteria_code)
        en_html = fetch_html(target_date, LANG_EN, cafeteria_code)

        ko_rows = parse_cafeteria_day_entries(ko_html, target_date)
        en_rows = parse_cafeteria_day_entries(en_html, target_date)

        merged = merge_language_rows(
            ko_rows=ko_rows,
            en_rows=en_rows,
            target_date=target_date,
            cafeteria_code=cafeteria_code,
        )

        all_meals.extend(merged)

    return all_meals


def send_ingest(worker_url: str, admin_token: str, target_date: str, meals: list[dict[str, Any]], run_type: str) -> dict[str, Any]:
    endpoint = worker_url.rstrip("/") + "/api/admin/ingest"
    payload = {
        "target_date": target_date,
        "run_type": run_type,
        "meals": meals,
    }
    response = requests.post(
        endpoint,
        headers={
            "Authorization": f"Bearer {admin_token}",
            "Content-Type": "application/json",
        },
        data=json.dumps(payload),
        timeout=30,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"ingest failed: status={response.status_code} body={response.text}")
    return response.json()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync CNU meals to Cloudflare Worker API")
    parser.add_argument("--date", dest="target_date", default=os.getenv("TARGET_DATE", ""), help="Target date YYYY-MM-DD")
    parser.add_argument("--worker-url", default=os.getenv("WORKER_URL", ""), help="Worker base URL")
    parser.add_argument("--admin-token", default=os.getenv("SYNC_ADMIN_TOKEN", ""), help="Admin bearer token")
    parser.add_argument("--run-type", default=os.getenv("RUN_TYPE", "scheduled"), help="sync run type label")
    parser.add_argument("--dry-run", action="store_true", help="Print payload summary without ingest call")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    target_date = validate_target_date(args.target_date or kst_today())
    meals = collect_meals(target_date)

    print(f"Collected {len(meals)} meals for {target_date}")

    if args.dry_run:
        sample = meals[:3]
        print(json.dumps({"target_date": target_date, "count": len(meals), "sample": sample}, ensure_ascii=False, indent=2))
        return 0

    if not args.worker_url or not args.admin_token:
        raise RuntimeError("WORKER_URL and SYNC_ADMIN_TOKEN are required unless --dry-run is used")

    result = send_ingest(
        worker_url=args.worker_url,
        admin_token=args.admin_token,
        target_date=target_date,
        meals=meals,
        run_type=args.run_type,
    )
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
