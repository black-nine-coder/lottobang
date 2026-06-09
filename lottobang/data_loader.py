from __future__ import annotations

import csv
from pathlib import Path

from .models import Draw

EXPECTED_FIELDS = {
    "round_no",
    "draw_date",
    "n1",
    "n2",
    "n3",
    "n4",
    "n5",
    "n6",
    "bonus",
}


def load_draws(csv_path: str | Path) -> list[Draw]:
    path = Path(csv_path)
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None or not EXPECTED_FIELDS.issubset(reader.fieldnames):
            raise ValueError("CSV header does not match the expected lottery schema.")

        draws: list[Draw] = []
        for row in reader:
            numbers = tuple(sorted(int(row[f"n{idx}"]) for idx in range(1, 7)))
            _validate_numbers(numbers)
            bonus = int(row["bonus"]) if row["bonus"] else None
            draws.append(
                Draw(
                    round_no=int(row["round_no"]),
                    draw_date=row["draw_date"],
                    numbers=numbers,
                    bonus=bonus,
                )
            )

    if not draws:
        raise ValueError("CSV file is empty.")

    draws.sort(key=lambda draw: draw.round_no)
    return draws


def _validate_numbers(numbers: tuple[int, ...]) -> None:
    if len(numbers) != 6:
        raise ValueError("Each draw must contain exactly 6 numbers.")
    if len(set(numbers)) != 6:
        raise ValueError("Lottery numbers must be unique in a draw.")
    if any(number < 1 or number > 45 for number in numbers):
        raise ValueError("Lottery numbers must stay within 1..45.")
