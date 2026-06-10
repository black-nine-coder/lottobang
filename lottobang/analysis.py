from __future__ import annotations

import random
from collections import Counter
from itertools import combinations

from .models import Draw, TicketRecommendation

NUMBER_MIN = 1
NUMBER_MAX = 45
NUMBERS_PER_TICKET = 6
LOW_NUMBER_MAX = 15
HIGH_NUMBER_MIN = 31
MAX_LOW_NUMBERS = 3
MAX_HIGH_NUMBERS = 3
MIN_LOW_NUMBERS = 1
MIN_HIGH_NUMBERS = 1
MIN_DECADE_BUCKETS = 3
MAX_SHARED_NUMBERS_BETWEEN_TICKETS = 2
CANDIDATE_POOL_MULTIPLIER = 80
RECENT_WINDOWS = (12, 26, 52)
BACKTEST_ROUNDS_LIMIT = 60


def build_number_weights(draws: list[Draw]) -> dict[int, float]:
    frequency_counter: Counter[int] = Counter()
    recent_counters: dict[int, Counter[int]] = {window: Counter() for window in RECENT_WINDOWS}
    last_seen_round: dict[int, int] = {}

    for draw in draws:
        for number in draw.numbers:
            frequency_counter[number] += 1
            last_seen_round[number] = draw.round_no

    for window in RECENT_WINDOWS:
        for draw in draws[-min(len(draws), window) :]:
            recent_counters[window].update(draw.numbers)

    latest_round = draws[-1].round_no
    frequencies = {
        number: frequency_counter[number] / len(draws)
        for number in range(NUMBER_MIN, NUMBER_MAX + 1)
    }
    recent_frequencies = {
        window: {
            number: recent_counters[window][number] / min(len(draws), window)
            for number in range(NUMBER_MIN, NUMBER_MAX + 1)
        }
        for window in RECENT_WINDOWS
    }
    recency_gaps = {
        number: latest_round - last_seen_round.get(number, latest_round - len(draws))
        for number in range(NUMBER_MIN, NUMBER_MAX + 1)
    }

    normalized_frequency = _normalize(frequencies)
    normalized_recent_frequency = {
        window: _normalize(recent_frequencies[window])
        for window in RECENT_WINDOWS
    }
    normalized_recency_gaps = _normalize({
        number: min(gap, 120)
        for number, gap in recency_gaps.items()
    })
    normalized_overdue = normalized_recency_gaps

    return {
        number: (
            (0.35 * normalized_frequency[number])
            + (0.18 * normalized_recent_frequency[12][number])
            + (0.14 * normalized_recent_frequency[26][number])
            + (0.13 * normalized_recent_frequency[52][number])
            + (0.15 * normalized_overdue[number])
            + 0.05
        )
        for number in range(NUMBER_MIN, NUMBER_MAX + 1)
    }


def build_pair_weights(draws: list[Draw]) -> dict[tuple[int, int], float]:
    pair_counter: Counter[tuple[int, int]] = Counter()
    recent_pair_counter: Counter[tuple[int, int]] = Counter()
    recent_window = draws[-min(len(draws), 52) :]

    for draw in draws:
        pair_counter.update(combinations(draw.numbers, 2))

    for draw in recent_window:
        recent_pair_counter.update(combinations(draw.numbers, 2))

    total_pairs = max(len(draws) * 15, 1)
    recent_total_pairs = max(len(recent_window) * 15, 1)
    pair_frequencies = {
        pair: pair_counter[pair] / total_pairs
        for pair in combinations(range(NUMBER_MIN, NUMBER_MAX + 1), 2)
    }
    recent_pair_frequencies = {
        pair: recent_pair_counter[pair] / recent_total_pairs
        for pair in combinations(range(NUMBER_MIN, NUMBER_MAX + 1), 2)
    }
    normalized_pair_frequency = _normalize(pair_frequencies)
    normalized_recent_pair_frequency = _normalize(recent_pair_frequencies)

    return {
        pair: (0.65 * normalized_pair_frequency[pair]) + (0.35 * normalized_recent_pair_frequency[pair])
        for pair in pair_frequencies
    }


def generate_recommendations(
    draws: list[Draw],
    sets_count: int = 5,
    seed: int | None = None,
    max_attempts: int = 5_000,
) -> tuple[list[TicketRecommendation], dict[int, float]]:
    if sets_count < 1:
        raise ValueError("sets_count must be positive.")

    rng = random.Random(seed)
    weights = build_number_weights(draws)
    pair_weights = build_pair_weights(draws)
    candidates: list[tuple[tuple[int, ...], float]] = []
    seen: set[tuple[int, ...]] = set()

    attempts = 0
    target_candidates = max(sets_count * CANDIDATE_POOL_MULTIPLIER, sets_count)
    while len(candidates) < target_candidates and attempts < max_attempts:
        attempts += 1
        numbers = _weighted_sample_without_replacement(rng, weights, NUMBERS_PER_TICKET)
        if numbers in seen:
            continue
        if not _passes_ticket_rules(numbers):
            continue

        seen.add(numbers)
        candidates.append((numbers, _score_ticket(numbers, weights, pair_weights)))

    recommendations = _select_diversified_tickets(candidates, sets_count)
    if len(recommendations) != sets_count:
        raise RuntimeError("Could not generate enough ticket sets with the configured rules.")

    return [
        TicketRecommendation(ticket_no=index + 1, numbers=numbers, score=round(score, 4))
        for index, (numbers, score) in enumerate(recommendations)
    ], weights


def run_backtest(
    draws: list[Draw],
    *,
    sets_count: int = 5,
    rounds_limit: int = BACKTEST_ROUNDS_LIMIT,
) -> dict[str, object]:
    if len(draws) < 20:
        return {
            "rounds": 0,
            "avg_best_matches": 0.0,
            "three_plus_rate": 0.0,
            "four_plus_rate": 0.0,
            "best_match": 0,
        }

    sample = draws[-min(rounds_limit, len(draws) - 10) :]
    best_matches: list[int] = []
    three_plus = 0
    four_plus = 0
    best_match = 0

    for draw in sample:
        history = [candidate for candidate in draws if candidate.round_no < draw.round_no]
        if len(history) < 10:
            continue
        recommendations, _ = generate_recommendations(
            history,
            sets_count=sets_count,
            seed=draw.round_no,
            max_attempts=2_500,
        )
        actual_numbers = set(draw.numbers)
        round_best = max(len(set(recommendation.numbers) & actual_numbers) for recommendation in recommendations)
        best_matches.append(round_best)
        if round_best >= 3:
            three_plus += 1
        if round_best >= 4:
            four_plus += 1
        best_match = max(best_match, round_best)

    rounds = len(best_matches)
    if rounds == 0:
        return {
            "rounds": 0,
            "avg_best_matches": 0.0,
            "three_plus_rate": 0.0,
            "four_plus_rate": 0.0,
            "best_match": 0,
        }

    return {
        "rounds": rounds,
        "avg_best_matches": round(sum(best_matches) / rounds, 3),
        "three_plus_rate": round(three_plus / rounds, 3),
        "four_plus_rate": round(four_plus / rounds, 3),
        "best_match": best_match,
    }


def summarize_top_numbers(weights: dict[int, float], limit: int = 10) -> list[tuple[int, float]]:
    return sorted(weights.items(), key=lambda item: item[1], reverse=True)[:limit]


def summarize_top_pairs(pair_weights: dict[tuple[int, int], float], limit: int = 10) -> list[tuple[tuple[int, int], float]]:
    return sorted(pair_weights.items(), key=lambda item: item[1], reverse=True)[:limit]


def summarize_frequency_stats(draws: list[Draw], limit: int = 10) -> list[dict[str, float]]:
    frequency_counter: Counter[int] = Counter()
    for draw in draws:
        frequency_counter.update(draw.numbers)

    ranked = sorted(
        frequency_counter.items(),
        key=lambda item: (-item[1], item[0]),
    )[:limit]
    total_draws = len(draws)
    return [
        {
            "number": number,
            "count": count,
            "appearance_rate": round(count / total_draws, 4),
        }
        for number, count in ranked
    ]


def _weighted_sample_without_replacement(
    rng: random.Random,
    weights: dict[int, float],
    count: int,
) -> tuple[int, int, int, int, int, int]:
    pool = list(weights.items())
    chosen: list[int] = []

    for _ in range(count):
        total_weight = sum(weight for _, weight in pool)
        threshold = rng.uniform(0, total_weight)
        cursor = 0.0
        for idx, (number, weight) in enumerate(pool):
            cursor += weight
            if cursor >= threshold:
                chosen.append(number)
                pool.pop(idx)
                break

    return tuple(sorted(chosen))


def _passes_ticket_rules(numbers: tuple[int, ...]) -> bool:
    odd_count = sum(number % 2 for number in numbers)
    total_sum = sum(numbers)
    consecutive_pairs = sum(1 for left, right in zip(numbers, numbers[1:]) if right - left == 1)
    low_numbers = sum(1 for number in numbers if number <= LOW_NUMBER_MAX)
    high_numbers = sum(1 for number in numbers if number >= HIGH_NUMBER_MIN)
    decade_buckets = {(number - 1) // 10 for number in numbers}

    if odd_count < 2 or odd_count > 4:
        return False
    if total_sum < 90 or total_sum > 200:
        return False
    if consecutive_pairs > 2:
        return False
    if low_numbers < MIN_LOW_NUMBERS or low_numbers > MAX_LOW_NUMBERS:
        return False
    if high_numbers < MIN_HIGH_NUMBERS or high_numbers > MAX_HIGH_NUMBERS:
        return False
    if len(decade_buckets) < MIN_DECADE_BUCKETS:
        return False
    return True


def _score_ticket(
    numbers: tuple[int, ...],
    weights: dict[int, float],
    pair_weights: dict[tuple[int, int], float] | None = None,
) -> float:
    base_score = sum(weights[number] for number in numbers) / NUMBERS_PER_TICKET
    decade_buckets = {(number - 1) // 10 for number in numbers}
    spread_bonus = min(len(decade_buckets), 5) * 0.01
    pair_score = 0.0
    if pair_weights:
        pairs = list(combinations(numbers, 2))
        pair_score = (sum(pair_weights.get(pair, 0.0) for pair in pairs) / len(pairs)) * 0.06
    return base_score + spread_bonus + pair_score


def _select_diversified_tickets(
    candidates: list[tuple[tuple[int, ...], float]],
    sets_count: int,
) -> list[tuple[tuple[int, ...], float]]:
    selected: list[tuple[tuple[int, ...], float]] = []
    for numbers, score in sorted(candidates, key=lambda item: item[1], reverse=True):
        if all(_shared_count(numbers, existing_numbers) <= MAX_SHARED_NUMBERS_BETWEEN_TICKETS for existing_numbers, _ in selected):
            selected.append((numbers, score))
            if len(selected) == sets_count:
                return selected

    for candidate in sorted(candidates, key=lambda item: item[1], reverse=True):
        if candidate not in selected:
            selected.append(candidate)
            if len(selected) == sets_count:
                return selected
    return selected


def _shared_count(left: tuple[int, ...], right: tuple[int, ...]) -> int:
    return len(set(left) & set(right))


def _normalize(values: dict[int, float]) -> dict[int, float]:
    minimum = min(values.values())
    maximum = max(values.values())
    if maximum == minimum:
        return {number: 1.0 for number in values}
    return {
        number: (value - minimum) / (maximum - minimum)
        for number, value in values.items()
    }
