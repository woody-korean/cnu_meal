from pathlib import Path

from scripts.cnu_parser import merge_language_rows, parse_cafeteria_day_entries

FIXTURE_DIR = Path("fixtures/cnu_html")


def read_fixture(name: str) -> str:
    return (FIXTURE_DIR / name).read_text(encoding="utf-8")


def test_parse_target_date_column_and_rows() -> None:
    rows = parse_cafeteria_day_entries(read_fixture("sample_ko.html"), "2026-03-03")

    assert len(rows) == 4
    assert rows[0]["meal_period"] == "조식"
    assert rows[1]["audience"] == "학생"

    student_breakfast = rows[1]["entries"][0]
    assert student_breakfast.price_krw == 1000
    assert "소고기야채죽" in student_breakfast.menu_name
    assert student_breakfast.is_operating is True


def test_merge_language_rows_with_english_fallback() -> None:
    ko_rows = parse_cafeteria_day_entries(read_fixture("sample_ko.html"), "2026-03-03")
    en_rows = parse_cafeteria_day_entries(read_fixture("sample_en.html"), "2026-03-03")

    merged = merge_language_rows(
        ko_rows=ko_rows,
        en_rows=en_rows,
        target_date="2026-03-03",
        cafeteria_code="OCL03.03",
    )

    assert len(merged) == 4

    lunch_staff = [m for m in merged if m["meal_period"] == "중식" and m["audience"] == "직원"][0]
    assert lunch_staff["menu_name_en"] == lunch_staff["menu_name_ko"]

    breakfast_student = [m for m in merged if m["meal_period"] == "조식" and m["audience"] == "학생"][0]
    assert "Beef rice porridge" in breakfast_student["menu_name_en"]
    assert breakfast_student["meal_id"].startswith("meal_")
