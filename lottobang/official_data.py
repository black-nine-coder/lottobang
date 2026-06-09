from __future__ import annotations

import json
from pathlib import Path

from .data_loader import load_draws

DATA_ROOT = Path(__file__).resolve().parent.parent / "data"
SAMPLE_DRAWS_CSV = DATA_ROOT / "sample_draws.csv"
OFFICIAL_DRAWS_CSV = DATA_ROOT / "official_draws.csv"
LEGACY_WINNER_HIGHLIGHTS_JSON = DATA_ROOT / "winner_highlights.json"
OFFICIAL_STORES_JSON = DATA_ROOT / "official_winner_stores.json"


def resolve_draws_csv(preferred: str | Path | None = None) -> Path:
    if preferred:
        return Path(preferred)
    if OFFICIAL_DRAWS_CSV.exists():
        return OFFICIAL_DRAWS_CSV
    return SAMPLE_DRAWS_CSV


def resolve_store_archive_json(preferred: str | Path | None = None) -> Path:
    if preferred:
        return Path(preferred)
    if OFFICIAL_STORES_JSON.exists():
        return OFFICIAL_STORES_JSON
    return LEGACY_WINNER_HIGHLIGHTS_JSON


def resolve_dashboard_draws_csv(preferred: str | Path | None = None) -> Path:
    if preferred is None:
        return resolve_draws_csv()

    preferred_path = Path(preferred)
    if OFFICIAL_DRAWS_CSV.exists() and preferred_path.resolve() == SAMPLE_DRAWS_CSV.resolve():
        return OFFICIAL_DRAWS_CSV
    return preferred_path


def load_stats_draws(csv_path: str | Path | None = None):
    return load_draws(resolve_draws_csv(csv_path))


def load_store_archive(json_path: str | Path | None = None) -> list[dict[str, object]]:
    path = resolve_store_archive_json(json_path)
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)
