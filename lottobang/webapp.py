from __future__ import annotations

import json
import mimetypes
import ssl
from collections import Counter
from dataclasses import asdict
from datetime import date, datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .analysis import generate_recommendations, summarize_frequency_stats, summarize_top_numbers
from .data_loader import load_draws
from .official_data import load_store_archive, resolve_dashboard_draws_csv, resolve_draws_csv
from .official_login import launch_official_login_fill, parse_official_login_payload
from .official_marking import launch_official_marking, parse_official_marking_payload
from .official_purchase_flow import launch_official_purchase_flow, parse_official_purchase_flow_payload
from .pension720 import build_pension_dashboard
from .tls import DEFAULT_CERT_FILE, DEFAULT_KEY_FILE, build_ssl_context

DEFAULT_CSV = resolve_draws_csv()
STATIC_ROOT = Path(__file__).resolve().parent.parent / "web"
DATA_ROOT = Path(__file__).resolve().parent.parent / "data"
MARKING_HISTORY_FILE = DATA_ROOT / "marking_history.json"
MIN_SETS_COUNT = 1
MAX_SETS_COUNT = 10
DEFAULT_HISTORY_LIMIT = 30
DEFAULT_MARKING_HISTORY_LIMIT = 50
DEFAULT_STORE_ROUNDS_LIMIT = 80
VALID_SELECTION_TYPES = {"all", "자동", "수동", "반자동"}


def build_dashboard_payload(
    csv_path: str | Path = DEFAULT_CSV,
    sets_count: int = 5,
    seed: int | None = None,
) -> dict[str, object]:
    effective_csv_path = resolve_dashboard_draws_csv(csv_path)
    draws = load_draws(effective_csv_path)
    effective_seed = seed if seed is not None else build_weekly_seed()
    recommendations, weights = generate_recommendations(draws, sets_count=sets_count, seed=effective_seed)
    latest_draw = draws[-1]
    store_archive = build_dashboard_store_archive(load_store_archive(), latest_draw.round_no)

    return {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "source_csv": str(Path(effective_csv_path).resolve()),
        "defaults": {
            "sets_count": sets_count,
            "seed": effective_seed,
            "refresh_cycle": weekly_cycle_label(),
        },
        "latest_draw": {
            "round_no": latest_draw.round_no,
            "draw_date": latest_draw.draw_date,
            "numbers": list(latest_draw.numbers),
            "bonus": latest_draw.bonus,
        },
        "strategy": {
            "description": "Frequency, recent trend, overdue signal, balance, and portfolio diversification heuristic",
            "rules": [
                "2-4 odd numbers",
                "sum between 90 and 200",
                "1-3 low numbers and 1-3 high numbers",
                "at least 3 decade buckets",
                "max 2 consecutive pairs",
                "unique tickets per generation",
                "max 2 shared numbers between recommended tickets when possible",
            ],
            "top_numbers": [
                {"number": number, "weight": round(weight, 4)}
                for number, weight in summarize_top_numbers(weights, limit=12)
            ],
            "number_weights": [
                {"number": number, "weight": round(weights[number], 4)}
                for number in sorted(weights)
            ],
            "frequency_stats": summarize_frequency_stats(draws, limit=12),
            "frequency_coverage": {
                "from_round": draws[0].round_no,
                "to_round": draws[-1].round_no,
                "draws": len(draws),
            },
        },
        "tickets": [asdict(recommendation) for recommendation in recommendations],
        "winner_highlights": build_recent_history(store_archive),
        "all_draws": build_draw_history(draws),
        "store_page_url": "/stores.html",
        "official_marking_url": "https://www.dhlottery.co.kr/",
    }


def load_marking_history(limit: int = DEFAULT_MARKING_HISTORY_LIMIT) -> list[dict[str, object]]:
    if not MARKING_HISTORY_FILE.exists():
        return []
    try:
        payload = json.loads(MARKING_HISTORY_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    if not isinstance(payload, list):
        return []
    return payload[:limit]


def append_marking_history(
    *,
    source: str,
    tickets: Sequence[dict[str, object]],
    result: dict[str, object],
) -> dict[str, object]:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    history = load_marking_history(limit=200)
    entry = {
        "marked_at_utc": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "tickets": [
            {
                "ticket_no": str(ticket.get("ticket_no") or index + 1),
                "numbers": _history_numbers(ticket.get("numbers")),
            }
            for index, ticket in enumerate(tickets)
        ],
        "result_message": str(result.get("message") or ""),
        "official_url": str(result.get("url") or result.get("target") or ""),
    }
    history.insert(0, entry)
    MARKING_HISTORY_FILE.write_text(
        json.dumps(history[:200], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return entry


def _history_numbers(raw_numbers: object) -> list[int]:
    if not isinstance(raw_numbers, Sequence) or isinstance(raw_numbers, (str, bytes)):
        return []
    return normalize_numbers_for_history(raw_numbers)


def normalize_numbers_for_history(raw_numbers: Sequence[object]) -> list[int]:
    return sorted(
        {
            int(number)
            for number in raw_numbers
            if isinstance(number, int) or str(number).strip().isdigit()
        }
    )


def serve(
    host: str = "127.0.0.1",
    port: int = 8010,
    csv_path: str | Path = DEFAULT_CSV,
    use_https: bool = False,
    cert_file: str | Path | None = None,
    key_file: str | Path | None = None,
) -> None:
    server = ThreadingHTTPServer((host, port), _build_handler(Path(csv_path)))
    scheme = "http"
    if use_https:
        ssl_context = build_ssl_context(
            cert_file=cert_file or DEFAULT_CERT_FILE,
            key_file=key_file or DEFAULT_KEY_FILE,
        )
        server.socket = ssl_context.wrap_socket(server.socket, server_side=True)
        scheme = "https"

    print(f"Lottobang server running at {scheme}://{host}:{port}")
    print(f"Draw data: {Path(csv_path).resolve()}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()


def _build_handler(csv_path: Path) -> type[BaseHTTPRequestHandler]:
    class LottobangHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            if parsed.path == "/api/dashboard":
                self._handle_dashboard(parsed.query)
                return
            if parsed.path == "/api/pension-dashboard":
                self._handle_pension_dashboard(parsed.query)
                return
            if parsed.path == "/api/store-lab":
                self._handle_store_lab(parsed.query)
                return
            if parsed.path == "/api/marking-history":
                self._handle_marking_history(parsed.query)
                return
            if parsed.path == "/health":
                self._send_json({"ok": True})
                return
            self._serve_static(parsed.path)

        def do_POST(self) -> None:
            parsed = urlparse(self.path)
            if parsed.path == "/api/official-marking":
                self._handle_official_marking()
                return
            if parsed.path == "/api/official-login":
                self._handle_official_login()
                return
            if parsed.path == "/api/official-purchase-flow":
                self._handle_official_purchase_flow()
                return
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")

        def do_HEAD(self) -> None:
            parsed = urlparse(self.path)
            if parsed.path in {"/api/dashboard", "/api/store-lab", "/health"}:
                self._send_json({"ok": True}, head_only=True)
                return
            self._serve_static(parsed.path, head_only=True)

        def log_message(self, format: str, *args: object) -> None:
            return

        def _handle_dashboard(self, query: str) -> None:
            try:
                sets_count, seed = parse_dashboard_params(query)
                payload = build_dashboard_payload(csv_path=csv_path, sets_count=sets_count, seed=seed)
            except ValueError as error:
                self._send_error_json(str(error), status=HTTPStatus.BAD_REQUEST)
                return
            except RuntimeError as error:
                self._send_error_json(str(error), status=HTTPStatus.UNPROCESSABLE_ENTITY)
                return
            except Exception as error:
                self._send_error_json(f"Could not build dashboard data: {error}", status=HTTPStatus.INTERNAL_SERVER_ERROR)
                return

            self._send_json(payload)

        def _handle_pension_dashboard(self, query: str) -> None:
            try:
                sets_count, seed = parse_dashboard_params(query)
                payload = build_pension_dashboard(sets_count=sets_count, seed=seed)
            except ValueError as error:
                self._send_error_json(str(error), status=HTTPStatus.BAD_REQUEST)
                return
            except RuntimeError as error:
                self._send_error_json(str(error), status=HTTPStatus.UNPROCESSABLE_ENTITY)
                return
            except Exception as error:
                self._send_error_json(f"Could not build pension dashboard data: {error}", status=HTTPStatus.INTERNAL_SERVER_ERROR)
                return

            self._send_json(payload)

        def _handle_store_lab(self, query: str) -> None:
            try:
                params = parse_store_lab_params(query)
                payload = build_store_lab_payload(**params)
            except ValueError as error:
                self._send_error_json(str(error), status=HTTPStatus.BAD_REQUEST)
                return
            except Exception as error:
                self._send_error_json(f"Could not load store data: {error}", status=HTTPStatus.INTERNAL_SERVER_ERROR)
                return

            self._send_json(payload)

        def _handle_marking_history(self, query: str) -> None:
            try:
                params = parse_qs(query)
                limit = _parse_int_param(params.get("limit", [str(DEFAULT_MARKING_HISTORY_LIMIT)])[0], "limit")
                if limit < 1 or limit > 200:
                    raise ValueError("limit는 1부터 200 사이여야 합니다.")
                self._send_json({"history": load_marking_history(limit=limit)})
            except ValueError as error:
                self._send_error_json(str(error), status=HTTPStatus.BAD_REQUEST)
            except Exception as error:
                self._send_error_json(f"Could not load marking history: {error}", status=HTTPStatus.INTERNAL_SERVER_ERROR)

        def _handle_official_marking(self) -> None:
            try:
                payload = self._read_json_body()
                parsed = parse_official_marking_payload(payload)
                result = launch_official_marking(
                    ticket_no=str(parsed["ticket_no"]),
                    numbers=list(parsed["numbers"]),
                )
                append_marking_history(
                    source="single-marking",
                    tickets=[{"ticket_no": parsed["ticket_no"], "numbers": parsed["numbers"]}],
                    result=result,
                )
            except ValueError as error:
                self._send_error_json(str(error), status=HTTPStatus.BAD_REQUEST)
                return
            except RuntimeError as error:
                self._send_error_json(str(error), status=HTTPStatus.UNPROCESSABLE_ENTITY)
                return
            except Exception as error:
                self._send_error_json(f"Could not run official marking: {error}", status=HTTPStatus.INTERNAL_SERVER_ERROR)
                return

            self._send_json(result)

        def _handle_official_login(self) -> None:
            try:
                payload = self._read_json_body()
                parsed = parse_official_login_payload(payload)
                result = launch_official_login_fill(
                    user_id=parsed["user_id"],
                    password=parsed["password"],
                )
            except ValueError as error:
                self._send_error_json(str(error), status=HTTPStatus.BAD_REQUEST)
                return
            except RuntimeError as error:
                self._send_error_json(str(error), status=HTTPStatus.UNPROCESSABLE_ENTITY)
                return
            except Exception as error:
                self._send_error_json(f"Could not fill official login form: {error}", status=HTTPStatus.INTERNAL_SERVER_ERROR)
                return

            self._send_json(result)

        def _handle_official_purchase_flow(self) -> None:
            try:
                payload = self._read_json_body()
                parsed = parse_official_purchase_flow_payload(payload)
                result = launch_official_purchase_flow(
                    user_id=str(parsed["user_id"]),
                    password=str(parsed["password"]),
                    tickets=parsed["tickets"],
                )
                append_marking_history(
                    source="official-purchase-flow",
                    tickets=[
                        {"ticket_no": index + 1, "numbers": numbers}
                        for index, numbers in enumerate(parsed["tickets"])
                    ],
                    result=result,
                )
            except ValueError as error:
                self._send_error_json(str(error), status=HTTPStatus.BAD_REQUEST)
                return
            except RuntimeError as error:
                self._send_error_json(str(error), status=HTTPStatus.UNPROCESSABLE_ENTITY)
                return
            except Exception as error:
                self._send_error_json(f"Could not run official purchase flow: {error}", status=HTTPStatus.INTERNAL_SERVER_ERROR)
                return

            self._send_json(result)

        def _serve_static(self, request_path: str, head_only: bool = False) -> None:
            relative_path = request_path.lstrip("/") or "index.html"
            target = (STATIC_ROOT / relative_path).resolve()
            static_root = STATIC_ROOT.resolve()
            if not str(target).startswith(str(static_root)) or not target.exists() or not target.is_file():
                self.send_error(HTTPStatus.NOT_FOUND, "Not found")
                return

            mime_type, _ = mimetypes.guess_type(target.name)
            body = target.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", f"{mime_type or 'application/octet-stream'}; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if not head_only:
                self.wfile.write(body)

        def _send_json(
            self,
            payload: dict[str, object],
            head_only: bool = False,
            status: HTTPStatus = HTTPStatus.OK,
        ) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if not head_only:
                self.wfile.write(body)

        def _send_error_json(self, message: str, status: HTTPStatus) -> None:
            self._send_json({"error": message}, status=status)

        def _read_json_body(self) -> dict[str, object]:
            content_length = int(self.headers.get("Content-Length", "0") or "0")
            if content_length <= 0:
                raise ValueError("JSON body is empty.")

            body = self.rfile.read(content_length)
            try:
                payload = json.loads(body.decode("utf-8"))
            except json.JSONDecodeError as error:
                raise ValueError("JSON body is invalid.") from error

            if not isinstance(payload, dict):
                raise ValueError("JSON body must be an object.")
            return payload

    return LottobangHandler


def parse_dashboard_params(query: str) -> tuple[int, int | None]:
    params = parse_qs(query)
    sets_raw = params.get("sets", ["5"])[0]
    seed_raw = params.get("seed", [None])[0]

    try:
        sets_count = int(sets_raw)
    except (TypeError, ValueError) as error:
        raise ValueError("sets는 숫자여야 합니다.") from error

    if not MIN_SETS_COUNT <= sets_count <= MAX_SETS_COUNT:
        raise ValueError(f"sets는 {MIN_SETS_COUNT}부터 {MAX_SETS_COUNT} 사이여야 합니다.")

    if seed_raw in (None, ""):
        return sets_count, None

    try:
        seed = int(seed_raw)
    except (TypeError, ValueError) as error:
        raise ValueError("seed는 비워 두거나 숫자로 입력해야 합니다.") from error

    return sets_count, seed


def parse_store_lab_params(query: str) -> dict[str, object]:
    params = parse_qs(query)
    archive = load_store_archive()
    latest_round = int(archive[-1]["round_no"])

    start_round = _parse_int_param(params.get("start_round", ["1"])[0], "start_round")
    end_round = _parse_int_param(params.get("end_round", [str(latest_round)])[0], "end_round")
    rounds_limit = _parse_int_param(params.get("rounds_limit", [str(DEFAULT_STORE_ROUNDS_LIMIT)])[0], "rounds_limit")
    query_text = (params.get("query", [""])[0] or "").strip()
    region = (params.get("region", [""])[0] or "").strip()
    selection_type = (params.get("selection_type", ["all"])[0] or "all").strip()

    if start_round < 1:
        raise ValueError("start_round must be at least 1.")
    if end_round < start_round:
        raise ValueError("end_round must be greater than or equal to start_round.")
    if rounds_limit < 1 or rounds_limit > 200:
        raise ValueError("rounds_limit는 1부터 200 사이여야 합니다.")
    if selection_type not in VALID_SELECTION_TYPES:
        raise ValueError("selection_type은 all, 자동, 수동 중 하나여야 합니다.")

    return {
        "start_round": start_round,
        "end_round": end_round,
        "query_text": query_text,
        "region": region,
        "selection_type": selection_type,
        "rounds_limit": rounds_limit,
    }


def _parse_int_param(raw: str, name: str) -> int:
    try:
        return int(raw)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{name}는 숫자여야 합니다.") from error


def build_weekly_seed(today: date | None = None) -> int:
    current = today or date.today()
    iso_year, iso_week, _ = current.isocalendar()
    return int(f"{iso_year}{iso_week:02d}")


def weekly_cycle_label(today: date | None = None) -> str:
    current = today or date.today()
    iso_year, iso_week, _ = current.isocalendar()
    return f"{iso_year} week {iso_week}"


def build_dashboard_store_archive(store_archive: list[dict[str, object]], latest_round: int) -> list[dict[str, object]]:
    return [item for item in store_archive if int(item["round_no"]) <= latest_round]


def build_draw_history(draws) -> list[dict[str, object]]:
    return [
        {
            "round_no": draw.round_no,
            "draw_date": draw.draw_date,
            "numbers": list(draw.numbers),
            "bonus": draw.bonus,
        }
        for draw in sorted(draws, key=lambda item: item.round_no, reverse=True)
    ]


def build_recent_history(store_archive: list[dict[str, object]], limit: int = DEFAULT_HISTORY_LIMIT) -> list[dict[str, object]]:
    recent = sorted(store_archive, key=lambda item: int(item["round_no"]), reverse=True)[:limit]
    return [
        {
            "round_no": item["round_no"],
            "draw_date": item["draw_date"],
            "numbers": item["numbers"],
            "bonus": item["bonus"],
            "first_prize_winners": item.get("first_prize_winners"),
            "prize_per_winner": item.get("prize_per_winner"),
        }
        for item in recent
    ]


def build_store_statistics(winner_highlights: list[dict[str, object]], limit: int = 10) -> dict[str, object]:
    region_counter: Counter[str] = Counter()
    store_counter: Counter[str] = Counter()
    address_counter: Counter[str] = Counter()
    store_details: dict[str, dict[str, object]] = {}
    draw_dates = [str(highlight["draw_date"]) for highlight in winner_highlights]

    for highlight in winner_highlights:
        round_no = int(highlight["round_no"])
        draw_date = highlight["draw_date"]
        for store in highlight["stores"]:
            region = str(store.get("region") or "")
            name = str(store.get("name") or "")
            selection_type = str(store.get("selection_type") or "")
            address = str(store.get("address") or "")

            region_counter[region] += 1
            store_counter[name] += 1
            address_counter[address] += 1
            details = store_details.setdefault(
                name,
                {
                    "name": name,
                    "region": region,
                    "address": address,
                    "selection_types": set(),
                    "latest_round_no": round_no,
                    "latest_draw_date": draw_date,
                    "count": 0,
                },
            )
            details["count"] += 1
            details["selection_types"].add(selection_type)
            if round_no > int(details["latest_round_no"]):
                details["latest_round_no"] = round_no
                details["latest_draw_date"] = draw_date
                details["region"] = region
                details["address"] = address

    top_stores = []
    for name, _ in store_counter.most_common(limit):
        details = store_details[name]
        top_stores.append(
            {
                "name": details["name"],
                "region": details["region"],
                "address": details["address"],
                "selection_types": sorted(details["selection_types"]),
                "latest_round_no": details["latest_round_no"],
                "latest_draw_date": details["latest_draw_date"],
                "count": details["count"],
            }
        )

    return {
        "coverage": {
            "from_date": min(draw_dates) if draw_dates else None,
            "to_date": max(draw_dates) if draw_dates else None,
            "from_round": min((int(item["round_no"]) for item in winner_highlights), default=None),
            "to_round": max((int(item["round_no"]) for item in winner_highlights), default=None),
            "rounds": len(winner_highlights),
        },
        "top_regions": [{"region": region, "count": count} for region, count in region_counter.most_common(limit)],
        "top_stores": top_stores,
        "top_addresses": [{"address": address, "count": count} for address, count in address_counter.most_common(limit)],
    }


def build_store_lab_payload(
    start_round: int,
    end_round: int,
    query_text: str = "",
    region: str = "",
    selection_type: str = "all",
    rounds_limit: int = DEFAULT_STORE_ROUNDS_LIMIT,
) -> dict[str, object]:
    archive = load_store_archive()
    filtered_rounds: list[dict[str, object]] = []
    query = query_text.casefold()
    region_query = region.casefold()

    for entry in archive:
        round_no = int(entry["round_no"])
        if round_no < start_round or round_no > end_round:
            continue

        stores = [
            store
            for store in entry["stores"]
            if _matches_store_filters(store, query, region_query, selection_type)
        ]
        if not stores:
            continue

        filtered_rounds.append(
            {
                "round_no": round_no,
                "draw_date": entry["draw_date"],
                "numbers": entry["numbers"],
                "bonus": entry["bonus"],
                "first_prize_winners": entry.get("first_prize_winners"),
                "prize_per_winner": entry.get("prize_per_winner"),
                "stores": stores,
            }
        )

    statistics = build_store_statistics(filtered_rounds, limit=12)
    markers = build_store_markers(filtered_rounds)
    round_cards = sorted(filtered_rounds, key=lambda item: int(item["round_no"]), reverse=True)[:rounds_limit]

    return {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "filters": {
            "start_round": start_round,
            "end_round": end_round,
            "query": query_text,
            "region": region,
            "selection_type": selection_type,
            "rounds_limit": rounds_limit,
        },
        "summary": {
            "matched_rounds": len(filtered_rounds),
            "matched_store_occurrences": sum(len(item["stores"]) for item in filtered_rounds),
            "unique_addresses": len(markers),
        },
        "statistics": statistics,
        "markers": markers,
        "rounds": round_cards,
    }


def build_store_markers(filtered_rounds: list[dict[str, object]]) -> list[dict[str, object]]:
    marker_map: dict[str, dict[str, object]] = {}

    for entry in filtered_rounds:
        for store in entry["stores"]:
            lat = store.get("lat")
            lon = store.get("lon")
            if lat is None or lon is None:
                continue
            address = str(store.get("address") or "")
            key = f"{store.get('name')}::{address}"
            marker = marker_map.setdefault(
                key,
                {
                    "id": key,
                    "name": str(store.get("name") or ""),
                    "region": str(store.get("region") or ""),
                    "address": address,
                    "lat": lat,
                    "lon": lon,
                    "selection_types": set(),
                    "count": 0,
                    "latest_round_no": int(entry["round_no"]),
                    "latest_draw_date": entry["draw_date"],
                },
            )
            marker["count"] += 1
            marker["selection_types"].add(str(store.get("selection_type") or ""))
            if int(entry["round_no"]) > int(marker["latest_round_no"]):
                marker["latest_round_no"] = int(entry["round_no"])
                marker["latest_draw_date"] = entry["draw_date"]

    markers = [{**marker, "selection_types": sorted(marker["selection_types"])} for marker in marker_map.values()]
    markers.sort(key=lambda item: (-int(item["count"]), -int(item["latest_round_no"]), str(item["name"])))
    return markers


def _matches_store_filters(store: dict[str, object], query: str, region_query: str, selection_type: str) -> bool:
    store_selection = str(store.get("selection_type") or "")
    if selection_type != "all" and store_selection != selection_type:
        return False
    store_region = str(store.get("region") or "")
    if region_query and region_query not in store_region.casefold():
        return False
    if not query:
        return True
    haystack = " ".join(
        [
            str(store.get("name") or ""),
            store_region,
            str(store.get("address") or ""),
            store_selection,
        ]
    ).casefold()
    return query in haystack



