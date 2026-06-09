from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Iterable, Sequence

OFFICIAL_LOTTO_MARKING_URL = "https://ol.dhlottery.co.kr/olotto/game/game645.do"
AUTOMATION_SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "official_marking_edge.mjs"


def normalize_ticket_numbers(raw_numbers: Iterable[object]) -> list[int]:
    numbers = sorted({int(value) for value in raw_numbers})
    if len(numbers) != 6:
        raise ValueError("numbers는 중복 없는 6개 번호여야 합니다.")
    if any(number < 1 or number > 45 for number in numbers):
        raise ValueError("numbers는 1부터 45 사이여야 합니다.")
    return numbers


def parse_official_marking_payload(payload: dict[str, object]) -> dict[str, object]:
    raw_numbers = payload.get("numbers")
    if not isinstance(raw_numbers, Sequence) or isinstance(raw_numbers, (str, bytes)):
        raise ValueError("numbers는 배열이어야 합니다.")

    numbers = normalize_ticket_numbers(raw_numbers)
    ticket_no = str(payload.get("ticket_no") or "1").strip() or "1"
    return {
        "ticket_no": ticket_no,
        "numbers": numbers,
    }


def launch_official_marking(
    *,
    ticket_no: str,
    numbers: Sequence[int],
    timeout_ms: int = 45000,
) -> dict[str, object]:
    node_binary = shutil.which("node")
    if not node_binary:
        raise RuntimeError("Node.js executable was not found.")
    if not AUTOMATION_SCRIPT.exists():
        raise RuntimeError(f"Official marking automation script was not found: {AUTOMATION_SCRIPT}")

    normalized = normalize_ticket_numbers(numbers)
    command = [
        node_binary,
        str(AUTOMATION_SCRIPT),
        "--ticket-no",
        str(ticket_no),
        "--numbers",
        ",".join(str(number) for number in normalized),
        "--timeout-ms",
        str(timeout_ms),
    ]
    completed = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=(timeout_ms / 1000) + 15,
        check=False,
    )

    if completed.returncode != 0:
        message = completed.stderr.strip() or completed.stdout.strip() or "Official site marking failed."
        raise RuntimeError(message)

    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("Could not parse the official marking script result.") from error

    if not payload.get("ok"):
        raise RuntimeError(str(payload.get("message") or "Official site marking failed."))
    return payload
