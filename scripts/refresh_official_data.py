from __future__ import annotations

import csv
import json
import subprocess
import sys
import time
import urllib.parse
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from lottobang.mobile_data import write_mobile_data_bundle

DATA_ROOT = PROJECT_ROOT / "data"
OFFICIAL_DRAWS_CSV = DATA_ROOT / "official_draws.csv"
OFFICIAL_STORES_JSON = DATA_ROOT / "official_winner_stores.json"
MOBILE_DATA_DIR = PROJECT_ROOT / "flutter_app" / "assets" / "data"

EPISODE_LIST_URL = "https://www.dhlottery.co.kr/lt645/selectLtEpsdInfo.do"
DRAW_RESULT_URL = "https://www.dhlottery.co.kr/lt645/selectPstLt645InfoNew.do"
STORE_RESULT_URL = "https://www.dhlottery.co.kr/wnprchsplcsrch/selectLtWnShp.do"

DRAW_HEADERS = {
    "Referer": "https://www.dhlottery.co.kr/lt645/result",
}
STORE_HEADERS = {
    "Referer": "https://www.dhlottery.co.kr/wnprchsplcsrch/home",
}
EPISODE_HEADERS = {
    "Referer": "https://www.dhlottery.co.kr/wnprchsplcsrch/home",
}


def fetch_json(url: str, headers: dict[str, str]) -> dict[str, object]:
    result = subprocess.run(
        [
            "curl",
            "-L",
            "-A",
            "Mozilla/5.0",
            "-H",
            f"Referer: {headers['Referer']}",
            "-s",
            url,
        ],
        check=True,
        capture_output=True,
    )
    return json.loads(result.stdout.decode("utf-8-sig"))


def format_date(yyyymmdd: str) -> str:
    if len(yyyymmdd) != 8:
        return yyyymmdd
    return f"{yyyymmdd[:4]}-{yyyymmdd[4:6]}-{yyyymmdd[6:8]}"


def format_money(amount: int) -> str:
    return f"{amount:,}원"


def fetch_episode_list() -> list[dict[str, object]]:
    payload = fetch_json(EPISODE_LIST_URL, EPISODE_HEADERS)
    episodes = payload["data"]["list"]
    return sorted(episodes, key=lambda item: int(item["ltEpsd"]))


def build_draw_window_centers(latest_round: int) -> list[int]:
    centers = set(range(5, latest_round + 1, 10))
    centers.add(max(5, latest_round - 4))
    return sorted(centers)


def fetch_draw_window(center_round: int) -> list[dict[str, object]]:
    query = urllib.parse.urlencode({"srchDir": "center", "srchLtEpsd": center_round})
    payload = fetch_json(f"{DRAW_RESULT_URL}?{query}", DRAW_HEADERS)
    return payload["data"]["list"]


def fetch_all_draws(latest_round: int) -> dict[int, dict[str, object]]:
    draws_by_round: dict[int, dict[str, object]] = {}
    centers = build_draw_window_centers(latest_round)
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = {executor.submit(fetch_draw_window, center): center for center in centers}
        for future in as_completed(futures):
            window = future.result()
            for entry in window:
                round_no = int(entry["ltEpsd"])
                draws_by_round[round_no] = {
                    "round_no": round_no,
                    "draw_date": format_date(str(entry["ltRflYmd"])),
                    "numbers": sorted(
                        [
                            int(entry["tm1WnNo"]),
                            int(entry["tm2WnNo"]),
                            int(entry["tm3WnNo"]),
                            int(entry["tm4WnNo"]),
                            int(entry["tm5WnNo"]),
                            int(entry["tm6WnNo"]),
                        ]
                    ),
                    "bonus": int(entry["bnsWnNo"]),
                    "first_prize_winners": int(entry["rnk1WnNope"]),
                    "prize_per_winner": format_money(int(entry["rnk1WnAmt"])),
                }
    missing_rounds = [round_no for round_no in range(1, latest_round + 1) if round_no not in draws_by_round]
    if missing_rounds:
        raise RuntimeError(f"Missing draw rounds: {missing_rounds[:10]}")
    return draws_by_round


def fetch_round_stores(round_no: int) -> list[dict[str, object]]:
    query = urllib.parse.urlencode(
        {
            "srchWnShpRnk": 1,
            "srchLtEpsd": round_no,
            "srchShpLctn": "",
        }
    )
    payload = fetch_json(f"{STORE_RESULT_URL}?{query}", STORE_HEADERS)
    stores = payload["data"]["list"]
    normalized: list[dict[str, object]] = []
    for store in stores:
        district = (store.get("tm2ShpLctnAddr") or "").strip()
        region = str(store.get("region") or "").strip()
        region_label = " ".join(part for part in [region, district] if part).strip() or region or district
        normalized.append(
            {
                "name": str(store.get("shpNm") or "").strip(),
                "selection_type": str(store.get("atmtPsvYnTxt") or "").strip(),
                "region": region_label,
                "address": " ".join(str(store.get("shpAddr") or "").split()),
                "lat": store.get("shpLat"),
                "lon": store.get("shpLot"),
            }
        )
    return normalized


def write_draws_csv(draws_by_round: dict[int, dict[str, object]]) -> None:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    with OFFICIAL_DRAWS_CSV.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["round_no", "draw_date", "n1", "n2", "n3", "n4", "n5", "n6", "bonus"])
        for round_no in sorted(draws_by_round):
            draw = draws_by_round[round_no]
            writer.writerow([draw["round_no"], draw["draw_date"], *draw["numbers"], draw["bonus"]])


def write_store_archive(draws_by_round: dict[int, dict[str, object]], latest_round: int) -> None:
    archive: list[dict[str, object]] = []
    round_numbers = list(range(1, latest_round + 1))
    with ThreadPoolExecutor(max_workers=12) as executor:
        futures = {executor.submit(fetch_round_stores, round_no): round_no for round_no in round_numbers}
        for index, future in enumerate(as_completed(futures), start=1):
            round_no = futures[future]
            draw = draws_by_round[round_no]
            stores = future.result()
            archive.append(
                {
                    "round_no": round_no,
                    "draw_date": draw["draw_date"],
                    "numbers": draw["numbers"],
                    "bonus": draw["bonus"],
                    "first_prize_winners": draw["first_prize_winners"],
                    "prize_per_winner": draw["prize_per_winner"],
                    "stores": stores,
                }
            )
            if index % 100 == 0:
                print(f"가맹점 데이터 수집 중: {index}/{latest_round}", flush=True)
                time.sleep(0.05)

    archive.sort(key=lambda item: int(item["round_no"]))
    with OFFICIAL_STORES_JSON.open("w", encoding="utf-8") as handle:
        json.dump(archive, handle, ensure_ascii=False, indent=2)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Refresh official lottery data.")
    parser.add_argument(
        "--draws-only",
        action="store_true",
        help="Refresh only official draw numbers and skip the slower winner-store archive.",
    )
    args = parser.parse_args(argv)

    episodes = fetch_episode_list()
    latest_round = int(episodes[-1]["ltEpsd"])
    print(f"최신 회차: {latest_round}", flush=True)

    draws_by_round = fetch_all_draws(latest_round)
    write_draws_csv(draws_by_round)
    print(f"당첨번호 저장: {OFFICIAL_DRAWS_CSV}", flush=True)

    if args.draws_only:
        return 0

    write_store_archive(draws_by_round, latest_round)
    print(f"가맹점 저장: {OFFICIAL_STORES_JSON}", flush=True)

    manifest = write_mobile_data_bundle(
        output_dir=MOBILE_DATA_DIR,
        draws_csv_path=OFFICIAL_DRAWS_CSV,
        store_archive_path=OFFICIAL_STORES_JSON,
    )
    print(
        f"모바일 번들 저장: {MOBILE_DATA_DIR} (버전 {manifest['version']})",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
