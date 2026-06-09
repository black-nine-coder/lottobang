from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from .official_data import load_stats_draws, load_store_archive, resolve_draws_csv, resolve_store_archive_json


def build_mobile_data_bundle(
    draws_csv_path: str | Path | None = None,
    store_archive_path: str | Path | None = None,
) -> dict[str, object]:
    draws = load_stats_draws(draws_csv_path)
    store_archive = load_store_archive(store_archive_path)
    latest_draw = draws[-1]

    return {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "source": {
            "draws_csv": str(resolve_draws_csv(draws_csv_path).resolve()),
            "store_archive_json": str(resolve_store_archive_json(store_archive_path).resolve()),
        },
        "coverage": {
            "draws": {
                "from_round": draws[0].round_no,
                "to_round": latest_draw.round_no,
                "count": len(draws),
            },
            "stores": {
                "from_round": int(store_archive[0]["round_no"]) if store_archive else None,
                "to_round": int(store_archive[-1]["round_no"]) if store_archive else None,
                "count": len(store_archive),
            },
        },
        "latest_draw": {
            "round_no": latest_draw.round_no,
            "draw_date": latest_draw.draw_date,
            "numbers": list(latest_draw.numbers),
            "bonus": latest_draw.bonus,
        },
        "draws": [
            {
                "round_no": draw.round_no,
                "draw_date": draw.draw_date,
                "numbers": list(draw.numbers),
                "bonus": draw.bonus,
            }
            for draw in draws
        ],
        "store_archive": store_archive,
    }


def write_mobile_data_bundle(
    output_dir: str | Path,
    draws_csv_path: str | Path | None = None,
    store_archive_path: str | Path | None = None,
) -> dict[str, object]:
    target_dir = Path(output_dir)
    target_dir.mkdir(parents=True, exist_ok=True)

    bundle = build_mobile_data_bundle(
        draws_csv_path=draws_csv_path,
        store_archive_path=store_archive_path,
    )
    bundle_bytes = json.dumps(bundle, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    bundle_path = target_dir / "data_bundle.json"
    bundle_path.write_bytes(bundle_bytes)

    bundle_hash = hashlib.sha256(bundle_bytes).hexdigest()
    manifest = {
        "generated_at_utc": bundle["generated_at_utc"],
        "version": f"round-{bundle['latest_draw']['round_no']}",
        "latest_draw_round": bundle["latest_draw"]["round_no"],
        "bundle": {
            "file": bundle_path.name,
            "sha256": bundle_hash,
            "bytes": len(bundle_bytes),
        },
        "coverage": bundle["coverage"],
    }
    manifest_path = target_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest
