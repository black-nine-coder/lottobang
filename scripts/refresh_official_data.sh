#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$ROOT_DIR/data"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$DATA_DIR"

curl -L -A "Mozilla/5.0" -H "Referer: https://www.dhlottery.co.kr/wnprchsplcsrch/home" -s \
  "https://www.dhlottery.co.kr/lt645/selectLtEpsdInfo.do" > "$TMP_DIR/episodes.json"

python3 - "$TMP_DIR/episodes.json" "$TMP_DIR/latest_round.txt" "$TMP_DIR/centers.txt" <<'PY'
import json
import sys
from pathlib import Path

episodes_path = Path(sys.argv[1])
latest_round_path = Path(sys.argv[2])
centers_path = Path(sys.argv[3])

payload = json.loads(episodes_path.read_text(encoding="utf-8"))
episodes = sorted(payload["data"]["list"], key=lambda item: int(item["ltEpsd"]))
latest_round = int(episodes[-1]["ltEpsd"])
centers = sorted(set(range(5, latest_round + 1, 10)) | {max(5, latest_round - 4)})

latest_round_path.write_text(str(latest_round), encoding="utf-8")
centers_path.write_text("\n".join(str(center) for center in centers), encoding="utf-8")
PY

LATEST_ROUND="$(cat "$TMP_DIR/latest_round.txt")"
echo "최신 회차: $LATEST_ROUND"

while IFS= read -r center; do
  curl -L -A "Mozilla/5.0" -H "Referer: https://www.dhlottery.co.kr/lt645/result" -s \
    "https://www.dhlottery.co.kr/lt645/selectPstLt645InfoNew.do?srchDir=center&srchLtEpsd=${center}" > "$TMP_DIR/draw_${center}.json"
done < "$TMP_DIR/centers.txt"

python3 - "$TMP_DIR" "$DATA_DIR/official_draws.csv" "$TMP_DIR/draw_meta.json" <<'PY'
import csv
import json
import sys
from pathlib import Path

tmp_dir = Path(sys.argv[1])
csv_path = Path(sys.argv[2])
meta_path = Path(sys.argv[3])

draws = {}
for json_path in sorted(tmp_dir.glob("draw_*.json")):
    payload = json.loads(json_path.read_text(encoding="utf-8"))
    for entry in payload["data"]["list"]:
        round_no = int(entry["ltEpsd"])
        draws[round_no] = {
            "round_no": round_no,
            "draw_date": f"{entry['ltRflYmd'][:4]}-{entry['ltRflYmd'][4:6]}-{entry['ltRflYmd'][6:8]}",
            "numbers": sorted([
                int(entry["tm1WnNo"]),
                int(entry["tm2WnNo"]),
                int(entry["tm3WnNo"]),
                int(entry["tm4WnNo"]),
                int(entry["tm5WnNo"]),
                int(entry["tm6WnNo"]),
            ]),
            "bonus": int(entry["bnsWnNo"]),
            "first_prize_winners": int(entry["rnk1WnNope"]),
            "prize_per_winner": f"{int(entry['rnk1WnAmt']):,}원",
        }

latest_round = max(draws)
missing = [round_no for round_no in range(1, latest_round + 1) if round_no not in draws]
if missing:
    raise SystemExit(f"Missing draw rounds: {missing[:10]}")

with csv_path.open("w", encoding="utf-8", newline="") as handle:
    writer = csv.writer(handle)
    writer.writerow(["round_no", "draw_date", "n1", "n2", "n3", "n4", "n5", "n6", "bonus"])
    for round_no in sorted(draws):
        draw = draws[round_no]
        writer.writerow([draw["round_no"], draw["draw_date"], *draw["numbers"], draw["bonus"]])

meta_path.write_text(json.dumps(draws, ensure_ascii=False, indent=2), encoding="utf-8")
PY

echo "당첨번호 저장: $DATA_DIR/official_draws.csv"

for round_no in $(seq 1 "$LATEST_ROUND"); do
  curl -L -A "Mozilla/5.0" -H "Referer: https://www.dhlottery.co.kr/wnprchsplcsrch/home" -s \
    "https://www.dhlottery.co.kr/wnprchsplcsrch/selectLtWnShp.do?srchWnShpRnk=1&srchLtEpsd=${round_no}&srchShpLctn=" > "$TMP_DIR/store_${round_no}.json"
  if (( round_no % 100 == 0 )); then
    echo "가맹점 데이터 수집 중: ${round_no}/${LATEST_ROUND}"
  fi
done

python3 - "$TMP_DIR" "$TMP_DIR/draw_meta.json" "$DATA_DIR/official_winner_stores.json" <<'PY'
import json
import sys
from pathlib import Path

tmp_dir = Path(sys.argv[1])
draw_meta_path = Path(sys.argv[2])
output_path = Path(sys.argv[3])

draws = {int(key): value for key, value in json.loads(draw_meta_path.read_text(encoding="utf-8")).items()}
archive = []

for round_no in range(1, max(draws) + 1):
    payload = json.loads((tmp_dir / f"store_{round_no}.json").read_text(encoding="utf-8"))
    stores = []
    for store in payload["data"]["list"]:
        district = (store.get("tm2ShpLctnAddr") or "").strip()
        region = str(store.get("region") or "").strip()
        region_label = " ".join(part for part in [region, district] if part).strip() or region or district
        stores.append(
            {
                "name": str(store.get("shpNm") or "").strip(),
                "selection_type": str(store.get("atmtPsvYnTxt") or "").strip(),
                "region": region_label,
                "address": " ".join(str(store.get("shpAddr") or "").split()),
                "lat": store.get("shpLat"),
                "lon": store.get("shpLot"),
            }
        )

    draw = draws[round_no]
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

output_path.write_text(json.dumps(archive, ensure_ascii=False, indent=2), encoding="utf-8")
PY

echo "가맹점 저장: $DATA_DIR/official_winner_stores.json"

python3 "$ROOT_DIR/scripts/generate_mobile_data.py"
