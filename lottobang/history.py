from __future__ import annotations

import json
from pathlib import Path


def load_winner_highlights(json_path: str | Path | None = None) -> list[dict[str, object]]:
    path = Path(json_path) if json_path else Path(__file__).resolve().parent.parent / "data" / "winner_highlights.json"
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)
