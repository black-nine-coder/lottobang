from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Sequence

PURCHASE_FLOW_SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "official_purchase_flow_edge.mjs"


def _normalize_ticket(raw_ticket: object) -> list[int]:
    if isinstance(raw_ticket, dict):
        raw_numbers = raw_ticket.get("numbers")
    else:
        raw_numbers = raw_ticket
    if not isinstance(raw_numbers, Sequence) or isinstance(raw_numbers, (str, bytes)):
        raise ValueError("tickets는 번호 배열 목록이어야 합니다.")
    numbers = sorted({int(value) for value in raw_numbers})
    if len(numbers) != 6:
        raise ValueError("각 티켓은 중복 없는 6개 번호여야 합니다.")
    if any(number < 1 or number > 45 for number in numbers):
        raise ValueError("티켓 번호는 1부터 45 사이여야 합니다.")
    return numbers


def parse_official_purchase_flow_payload(payload: dict[str, object]) -> dict[str, object]:
    user_id = str(payload.get("user_id") or "").strip()
    password = str(payload.get("password") or "")
    raw_tickets = payload.get("tickets")
    if not user_id:
        raise ValueError("동행복권 아이디를 입력해야 합니다.")
    if not password:
        raise ValueError("동행복권 비밀번호를 입력해야 합니다.")
    if not isinstance(raw_tickets, Sequence) or isinstance(raw_tickets, (str, bytes)):
        raise ValueError("tickets는 배열이어야 합니다.")
    tickets = [_normalize_ticket(ticket) for ticket in raw_tickets][:5]
    if not tickets:
        raise ValueError("마킹할 추천번호가 없습니다.")
    return {"user_id": user_id, "password": password, "tickets": tickets}


def launch_official_purchase_flow(
    *,
    user_id: str,
    password: str,
    tickets: Sequence[Sequence[int]],
    timeout_ms: int = 90000,
) -> dict[str, object]:
    node_binary = shutil.which("node")
    if not node_binary:
        raise RuntimeError("Node.js executable was not found.")
    if not PURCHASE_FLOW_SCRIPT.exists():
        raise RuntimeError(f"Official purchase flow script was not found: {PURCHASE_FLOW_SCRIPT}")

    completed = subprocess.run(
        [node_binary, str(PURCHASE_FLOW_SCRIPT), "--timeout-ms", str(timeout_ms)],
        input=json.dumps({"user_id": user_id, "password": password, "tickets": tickets}, ensure_ascii=False),
        capture_output=True,
        text=True,
        timeout=(timeout_ms / 1000) + 20,
        check=False,
    )

    if completed.returncode != 0:
        message = completed.stderr.strip() or completed.stdout.strip() or "Official purchase flow failed."
        raise RuntimeError(message)

    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("Could not parse the official purchase flow result.") from error

    if not payload.get("ok"):
        raise RuntimeError(str(payload.get("message") or "Official purchase flow failed."))
    return payload
