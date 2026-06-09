from __future__ import annotations

import argparse
from pathlib import Path

from lottobang.analysis import generate_recommendations, summarize_top_numbers
from lottobang.data_loader import load_draws
from lottobang.export import export_recommendations


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate heuristic lottery recommendations for local lottery research."
    )
    parser.add_argument("--csv", required=True, help="Path to the draw history CSV file.")
    parser.add_argument("--sets", type=int, default=5, help="Number of ticket sets to generate.")
    parser.add_argument("--seed", type=int, default=None, help="Optional random seed for reproducible output.")
    parser.add_argument(
        "--output-dir",
        default="output",
        help="Directory where JSON and TXT exports will be stored.",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    draws = load_draws(args.csv)
    recommendations, weights = generate_recommendations(draws, sets_count=args.sets, seed=args.seed)
    json_path, text_path = export_recommendations(
        recommendations=recommendations,
        weights=weights,
        source_csv=str(Path(args.csv).resolve()),
        output_dir=args.output_dir,
    )

    print("추첨 패턴 연구실 추천 결과")
    print(f"입력 데이터: {Path(args.csv).resolve()}")
    print("상위 가중치 번호:", ", ".join(f"{number}({weight:.3f})" for number, weight in summarize_top_numbers(weights)))
    for recommendation in recommendations:
        numbers = ", ".join(f"{number:02d}" for number in recommendation.numbers)
        print(f"{recommendation.ticket_no}. {numbers}  score={recommendation.score:.4f}")
    print(f"JSON 저장: {json_path.resolve()}")
    print(f"TXT 저장: {text_path.resolve()}")
    print("구매 자동화는 포함하지 않는다. 결과를 검토한 뒤 수동으로 입력해야 한다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
