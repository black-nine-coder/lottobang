from __future__ import annotations

import argparse
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from lottobang.mobile_data import write_mobile_data_bundle

DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "flutter_app" / "assets" / "data"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate offline mobile data bundle for the Flutter app.",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Directory to write manifest.json and data_bundle.json into.",
    )
    parser.add_argument(
        "--draws-csv",
        default=None,
        help="Optional draws CSV path. Defaults to official_draws.csv when present.",
    )
    parser.add_argument(
        "--stores-json",
        default=None,
        help="Optional winner stores archive path. Defaults to official_winner_stores.json when present.",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    manifest = write_mobile_data_bundle(
        output_dir=args.output_dir,
        draws_csv_path=args.draws_csv,
        store_archive_path=args.stores_json,
    )
    print(f"모바일 번들 저장: {Path(args.output_dir).resolve()}", flush=True)
    print(
        f"최신 회차 {manifest['latest_draw_round']} 기준 manifest.json / data_bundle.json 생성 완료",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
