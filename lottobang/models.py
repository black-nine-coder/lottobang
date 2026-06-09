from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Draw:
    round_no: int
    draw_date: str
    numbers: tuple[int, int, int, int, int, int]
    bonus: int | None = None


@dataclass(frozen=True)
class TicketRecommendation:
    ticket_no: int
    numbers: tuple[int, int, int, int, int, int]
    score: float
