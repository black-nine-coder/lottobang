from __future__ import annotations

import json
import random
from collections import Counter
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Sequence

PENSION_DRAW_FILE = Path(__file__).resolve().parent.parent / "data" / "pension720_draws.json"
GROUP_MIN = 1
GROUP_MAX = 5
DIGIT_MIN = 0
DIGIT_MAX = 9
DIGITS_PER_TICKET = 6


@dataclass(frozen=True)
class PensionDraw:
    round_no: int
    draw_date: str
    group: int
    digits: tuple[int, int, int, int, int, int]
    bonus_digits: tuple[int, int, int, int, int, int] | None = None


@dataclass(frozen=True)
class PensionRecommendation:
    ticket_no: int
    group: int
    digits: tuple[int, int, int, int, int, int]
    score: float


def load_pension_draws(path: Path = PENSION_DRAW_FILE) -> list[PensionDraw]:
    if not path.exists():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("pension720_draws.json must be a list.")

    draws: list[PensionDraw] = []
    for item in payload:
        digits = _normalize_digits(item.get("digits"))
        bonus_raw = item.get("bonus_digits")
        draws.append(
            PensionDraw(
                round_no=int(item["round_no"]),
                draw_date=str(item.get("draw_date") or ""),
                group=int(item["group"]),
                digits=digits,
                bonus_digits=_normalize_digits(bonus_raw) if bonus_raw is not None else None,
            )
        )
    return sorted(draws, key=lambda draw: draw.round_no)


def build_pension_dashboard(sets_count: int = 5, seed: int | None = None) -> dict[str, object]:
    if sets_count < 1 or sets_count > 10:
        raise ValueError("sets는 1부터 10 사이여야 합니다.")

    draws = load_pension_draws()
    effective_seed = seed if seed is not None else int(datetime.now(timezone.utc).timestamp())
    recommendations, group_weights, digit_weights = generate_pension_recommendations(
        draws=draws,
        sets_count=sets_count,
        seed=effective_seed,
    )

    latest_draw = draws[-1] if draws else None
    return {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "defaults": {"sets_count": sets_count, "seed": effective_seed},
        "data_status": {
            "has_official_history": bool(draws),
            "message": "공식 연금복권 과거 데이터 파일을 사용 중입니다."
            if draws
            else "data/pension720_draws.json이 없어 균등 가중치 기반 추천만 제공합니다.",
        },
        "latest_draw": asdict(latest_draw) if latest_draw else None,
        "strategy": {
            "description": "Group and per-position digit frequency heuristic",
            "rules": [
                "조는 1-5 범위",
                "6자리 숫자는 0-9 각 자리별 추천",
                "동일 숫자 4개 이상 반복 회피",
                "단조 증가/감소 5자리 이상 회피",
                "과거 데이터가 없으면 균등 가중치 사용",
            ],
            "group_weights": [{"group": group, "weight": round(weight, 4)} for group, weight in group_weights.items()],
            "digit_weights": [
                {
                    "position": position + 1,
                    "digits": [
                        {"digit": digit, "weight": round(weight, 4)}
                        for digit, weight in sorted(weights.items(), key=lambda item: item[1], reverse=True)
                    ],
                }
                for position, weights in enumerate(digit_weights)
            ],
            "coverage": {
                "from_round": draws[0].round_no if draws else None,
                "to_round": draws[-1].round_no if draws else None,
                "draws": len(draws),
            },
        },
        "tickets": [asdict(recommendation) for recommendation in recommendations],
        "all_draws": [asdict(draw) for draw in sorted(draws, key=lambda item: item.round_no, reverse=True)],
    }


def generate_pension_recommendations(
    *,
    draws: list[PensionDraw],
    sets_count: int,
    seed: int,
) -> tuple[list[PensionRecommendation], dict[int, float], list[dict[int, float]]]:
    rng = random.Random(seed)
    group_weights = build_group_weights(draws)
    digit_weights = build_digit_weights(draws)
    recommendations: list[PensionRecommendation] = []
    seen: set[tuple[int, tuple[int, ...]]] = set()

    attempts = 0
    while len(recommendations) < sets_count and attempts < 5000:
        attempts += 1
        group = _weighted_choice(rng, group_weights)
        digits = tuple(_weighted_choice(rng, digit_weights[position]) for position in range(DIGITS_PER_TICKET))
        key = (group, digits)
        if key in seen or not _passes_pension_rules(digits):
            continue
        seen.add(key)
        score = group_weights[group] + sum(digit_weights[index][digit] for index, digit in enumerate(digits))
        recommendations.append(
            PensionRecommendation(
                ticket_no=len(recommendations) + 1,
                group=group,
                digits=digits,  # type: ignore[arg-type]
                score=round(score / (DIGITS_PER_TICKET + 1), 4),
            )
        )

    if len(recommendations) != sets_count:
        raise RuntimeError("연금복권 추천번호를 충분히 생성하지 못했습니다.")
    return recommendations, group_weights, digit_weights


def build_group_weights(draws: list[PensionDraw]) -> dict[int, float]:
    if not draws:
        return {group: 1.0 for group in range(GROUP_MIN, GROUP_MAX + 1)}
    counter = Counter(draw.group for draw in draws)
    return _normalize({group: counter[group] + 1 for group in range(GROUP_MIN, GROUP_MAX + 1)})


def build_digit_weights(draws: list[PensionDraw]) -> list[dict[int, float]]:
    weights: list[dict[int, float]] = []
    for position in range(DIGITS_PER_TICKET):
        if not draws:
            weights.append({digit: 1.0 for digit in range(DIGIT_MIN, DIGIT_MAX + 1)})
            continue
        counter = Counter(draw.digits[position] for draw in draws)
        weights.append(_normalize({digit: counter[digit] + 1 for digit in range(DIGIT_MIN, DIGIT_MAX + 1)}))
    return weights


def _normalize_digits(raw_digits: object) -> tuple[int, int, int, int, int, int]:
    if not isinstance(raw_digits, Sequence) or isinstance(raw_digits, (str, bytes)):
        raise ValueError("digits must be a 6-item list.")
    digits = tuple(int(value) for value in raw_digits)
    if len(digits) != DIGITS_PER_TICKET or any(digit < DIGIT_MIN or digit > DIGIT_MAX for digit in digits):
        raise ValueError("digits must contain exactly six digits from 0 to 9.")
    return digits  # type: ignore[return-value]


def _weighted_choice(rng: random.Random, weights: dict[int, float]) -> int:
    total = sum(weights.values())
    threshold = rng.uniform(0, total)
    cursor = 0.0
    for value, weight in weights.items():
        cursor += weight
        if cursor >= threshold:
            return value
    return next(reversed(weights))


def _passes_pension_rules(digits: tuple[int, ...]) -> bool:
    if max(Counter(digits).values()) >= 4:
        return False
    increasing = sum(1 for left, right in zip(digits, digits[1:]) if right - left == 1)
    decreasing = sum(1 for left, right in zip(digits, digits[1:]) if left - right == 1)
    return increasing < 5 and decreasing < 5


def _normalize(values: dict[int, float]) -> dict[int, float]:
    minimum = min(values.values())
    maximum = max(values.values())
    if maximum == minimum:
        return {key: 1.0 for key in values}
    return {key: 0.1 + ((value - minimum) / (maximum - minimum)) for key, value in values.items()}
