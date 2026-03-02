from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import date
from typing import Any

from bs4 import BeautifulSoup, Tag

CAFETERIA_NAMES: dict[str, tuple[str, str]] = {
    "OCL03.01": ("제1학생회관", "First Student Hall"),
    "OCL03.02": ("제2학생회관", "Second Student Hall"),
    "OCL03.03": ("제3학생회관", "Third Student Hall"),
    "OCL03.04": ("제4학생회관", "Fourth Student Hall"),
    "OCL03.05": ("생활과학대학", "College of Human Ecology"),
}

AUDIENCE_ALIASES: dict[str, str] = {
    "직원": "직원",
    "교직원": "직원",
    "staff": "직원",
    "faculty": "직원",
    "employee": "직원",
    "employees": "직원",
    "worker": "직원",
    "workers": "직원",
    "학생": "학생",
    "student": "학생",
    "students": "학생",
}

MEAL_PERIOD_ALIASES: dict[str, str] = {
    "조식": "조식",
    "breakfast": "조식",
    "중식": "중식",
    "lunch": "중식",
    "석식": "석식",
    "dinner": "석식",
}

CLOSED_TOKENS = ("운영안함", "closed", "not operating", "미운영")


@dataclass
class ParsedMenuEntry:
    menu_name: str
    price_krw: int | None
    is_operating: bool


def to_dot_date(value: str) -> str:
    return value.replace("-", ".")


def clean_text(value: str) -> str:
    return " ".join(value.replace("\xa0", " ").split())


def normalize_audience(value: str) -> str:
    text = clean_text(value)
    return AUDIENCE_ALIASES.get(text.lower(), text)


def normalize_meal_period(value: str) -> str:
    text = clean_text(value)
    return MEAL_PERIOD_ALIASES.get(text.lower(), text)


def is_closed_text(value: str) -> bool:
    normalized = clean_text(value).lower()
    if not normalized:
        return True
    return any(token in normalized for token in CLOSED_TOKENS)


def parse_price_krw(title: str) -> int | None:
    match = re.search(r"\((\d{3,6})\)", title)
    if not match:
        return None
    return int(match.group(1))


def compose_menu_name(title: str, lines: list[str]) -> str:
    if title and lines:
        return f"{title} | {' / '.join(lines)}"
    if title:
        return title
    if lines:
        return " / ".join(lines)
    return "운영안함"


def parse_menu_cell(cell: Tag) -> list[ParsedMenuEntry]:
    raw_text = clean_text(cell.get_text(" ", strip=True))
    if is_closed_text(raw_text):
        return [ParsedMenuEntry(menu_name="운영안함", price_krw=None, is_operating=False)]

    entries: list[ParsedMenuEntry] = []
    for li in cell.select("li"):
        title_node = li.select_one("h3")
        title = clean_text(title_node.get_text(" ", strip=True)) if title_node else ""
        body_node = li.select_one("p") or li
        lines = [clean_text(s) for s in body_node.stripped_strings if clean_text(s)]
        menu_name = compose_menu_name(title, lines)
        entries.append(
            ParsedMenuEntry(menu_name=menu_name, price_krw=parse_price_krw(title), is_operating=True)
        )

    if entries:
        return entries

    return [ParsedMenuEntry(menu_name=raw_text, price_krw=parse_price_krw(raw_text), is_operating=True)]


def find_target_column_index(table: Tag, target_date: str) -> int:
    target_dot = to_dot_date(target_date)
    headers = table.select("thead th")
    date_columns: list[str] = []
    for th in headers:
        text = clean_text(th.get_text(" ", strip=True))
        found = re.search(r"(\d{4}\.\d{2}\.\d{2})", text)
        if found:
            date_columns.append(found.group(1))

    if target_dot not in date_columns:
        raise ValueError(f"target date {target_dot} not found in table headers")

    return date_columns.index(target_dot)


def parse_cafeteria_day_entries(html: str, target_date: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    table = soup.select_one("table.menu-tbl")
    if not table:
        raise ValueError("menu table not found")

    date_column_index = find_target_column_index(table, target_date)

    rows: list[dict[str, Any]] = []
    current_period = ""

    for tr in table.select("tbody tr"):
        tds = tr.find_all("td")
        if not tds:
            continue

        first = tds[0]
        is_period_row = bool(first.get("rowspan")) or "building" in (first.get("class") or [])

        if is_period_row and len(tds) >= 3:
            current_period = normalize_meal_period(tds[0].get_text(" ", strip=True))
            audience = normalize_audience(tds[1].get_text(" ", strip=True))
            day_cells = tds[2:]
        else:
            audience = normalize_audience(tds[0].get_text(" ", strip=True))
            day_cells = tds[1:]

        if date_column_index >= len(day_cells):
            continue

        weekly_entries = [parse_menu_cell(cell) for cell in day_cells]
        entries = weekly_entries[date_column_index]
        has_weekly_operation = any(any(entry.is_operating for entry in cell_entries) for cell_entries in weekly_entries)
        rows.append(
            {
                "meal_period": current_period,
                "audience": audience,
                "entries": entries,
                "has_weekly_operation": has_weekly_operation,
            }
        )

    return rows


def sanitize_english(menu_en: str, menu_ko: str) -> str:
    candidate = clean_text(menu_en)
    lowered = candidate.lower()
    if not candidate or lowered == "null" or "null" in lowered or is_closed_text(candidate):
        return menu_ko
    return candidate


def compute_meal_id(
    *,
    service_date: str,
    cafeteria_code: str,
    meal_period: str,
    audience: str,
    menu_name_ko: str,
    price_krw: int | None,
) -> str:
    raw = "|".join(
        [
            service_date,
            cafeteria_code,
            meal_period,
            audience,
            menu_name_ko,
            str(price_krw or ""),
        ]
    )
    return f"meal_{hashlib.sha256(raw.encode('utf-8')).hexdigest()[:16]}"


def compute_source_hash(menu_name_ko: str, menu_name_en: str) -> str:
    raw = f"{menu_name_ko}|{menu_name_en}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def merge_language_rows(
    *,
    ko_rows: list[dict[str, Any]],
    en_rows: list[dict[str, Any]],
    target_date: str,
    cafeteria_code: str,
) -> list[dict[str, Any]]:
    cafeteria_name_ko, cafeteria_name_en = CAFETERIA_NAMES[cafeteria_code]

    merged: list[dict[str, Any]] = []

    def row_key(row: dict[str, Any]) -> tuple[str, str]:
        meal_period = normalize_meal_period(str(row.get("meal_period", "")))
        audience = normalize_audience(str(row.get("audience", "")))
        return (meal_period, audience)

    ko_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    en_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    ordered_keys: list[tuple[str, str]] = []

    for row in ko_rows:
        key = row_key(row)
        if key not in ko_by_key:
            ordered_keys.append(key)
        ko_by_key[key] = row

    for row in en_rows:
        key = row_key(row)
        if key not in en_by_key:
            if key not in ko_by_key:
                ordered_keys.append(key)
        en_by_key[key] = row

    for key in ordered_keys:
        ko_row = ko_by_key.get(key, {})
        en_row = en_by_key.get(key, {})

        meal_period = key[0]
        audience = key[1]

        ko_entries: list[ParsedMenuEntry] = ko_row.get("entries", [])
        en_entries: list[ParsedMenuEntry] = en_row.get("entries", [])

        has_weekly_operation = bool(ko_row.get("has_weekly_operation", False))
        if not ko_row:
            has_weekly_operation = any(entry.is_operating for entry in en_entries)

        # Drop rows that are closed for all days in the source weekly table.
        if not has_weekly_operation:
            continue

        entry_count = max(len(ko_entries), len(en_entries))
        for entry_idx in range(entry_count):
            if entry_idx < len(ko_entries):
                ko_entry = ko_entries[entry_idx]
            elif entry_idx < len(en_entries):
                fallback = en_entries[entry_idx]
                ko_entry = ParsedMenuEntry(fallback.menu_name, fallback.price_krw, fallback.is_operating)
            else:
                ko_entry = ParsedMenuEntry("운영안함", None, False)

            en_entry = en_entries[entry_idx] if entry_idx < len(en_entries) else ParsedMenuEntry("", None, ko_entry.is_operating)

            menu_ko = clean_text(ko_entry.menu_name)
            menu_en = sanitize_english(en_entry.menu_name, menu_ko)
            is_operating = bool(ko_entry.is_operating or en_entry.is_operating)
            price_krw = ko_entry.price_krw if ko_entry.price_krw is not None else en_entry.price_krw

            meal_id = compute_meal_id(
                service_date=target_date,
                cafeteria_code=cafeteria_code,
                meal_period=meal_period,
                audience=audience,
                menu_name_ko=menu_ko,
                price_krw=price_krw,
            )

            merged.append(
                {
                    "meal_id": meal_id,
                    "service_date": target_date,
                    "cafeteria_code": cafeteria_code,
                    "cafeteria_name_ko": cafeteria_name_ko,
                    "cafeteria_name_en": cafeteria_name_en,
                    "meal_period": meal_period,
                    "audience": audience,
                    "menu_name_ko": menu_ko,
                    "menu_name_en": menu_en,
                    "price_krw": price_krw,
                    "is_operating": is_operating,
                    "source_hash": compute_source_hash(menu_ko, menu_en),
                }
            )

    return merged


def validate_target_date(target: str) -> str:
    parsed = date.fromisoformat(target)
    return parsed.isoformat()
