from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

LOGIN_AUTOMATION_SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "official_login_edge.mjs"


def parse_official_login_payload(payload: dict[str, object]) -> dict[str, str]:
    user_id = str(payload.get("user_id") or "").strip()
    password = str(payload.get("password") or "")
    if not user_id:
        raise ValueError("동행복권 아이디를 입력해야 합니다.")
    if not password:
        raise ValueError("동행복권 비밀번호를 입력해야 합니다.")
    return {"user_id": user_id, "password": password}


def launch_official_login_fill(
    *,
    user_id: str,
    password: str,
    timeout_ms: int = 45000,
) -> dict[str, object]:
    node_binary = shutil.which("node")
    if not node_binary:
        raise RuntimeError("Node.js executable was not found.")
    if not LOGIN_AUTOMATION_SCRIPT.exists():
        raise RuntimeError(f"Official login automation script was not found: {LOGIN_AUTOMATION_SCRIPT}")

    completed = subprocess.run(
        [node_binary, str(LOGIN_AUTOMATION_SCRIPT), "--timeout-ms", str(timeout_ms)],
        input=json.dumps({"user_id": user_id, "password": password}, ensure_ascii=False),
        capture_output=True,
        text=True,
        timeout=(timeout_ms / 1000) + 15,
        check=False,
    )

    if completed.returncode != 0:
        message = completed.stderr.strip() or completed.stdout.strip() or "Official login fill failed."
        raise RuntimeError(message)

    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("Could not parse the official login script result.") from error

    if not payload.get("ok"):
        raise RuntimeError(str(payload.get("message") or "Official login fill failed."))
    return payload
