from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from .analysis import summarize_top_numbers
from .models import TicketRecommendation


def export_recommendations(
    recommendations: list[TicketRecommendation],
    weights: dict[int, float],
    source_csv: str,
    output_dir: str | Path,
) -> tuple[Path, Path]:
    output_root = Path(output_dir)
    output_root.mkdir(parents=True, exist_ok=True)

    json_path = output_root / "recommendations.json"
    text_path = output_root / "manual_purchase.txt"

    payload = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "source_csv": source_csv,
        "strategy": {
            "description": "frequency-recency heuristic",
            "top_numbers": [
                {"number": number, "weight": round(weight, 4)}
                for number, weight in summarize_top_numbers(weights)
            ],
        },
        "tickets": [
            {
                "ticket_no": recommendation.ticket_no,
                "numbers": list(recommendation.numbers),
                "score": recommendation.score,
            }
            for recommendation in recommendations
        ],
        "manual_purchase_only": True,
    }

    json_path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    text_path.write_text(render_text_report(recommendations), encoding="utf-8")
    return json_path, text_path


def render_text_report(recommendations: list[TicketRecommendation]) -> str:
    lines = [
        "추첨 패턴 연구실 추천 번호",
        "이 파일은 수동 구매 입력용이다.",
        "",
    ]
    for recommendation in recommendations:
        numbers = ", ".join(f"{number:02d}" for number in recommendation.numbers)
        lines.append(f"{recommendation.ticket_no}. {numbers} (score={recommendation.score:.4f})")
    lines.append("")
    return "\n".join(lines)
