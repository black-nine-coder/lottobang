import hashlib
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from lottobang.analysis import generate_recommendations
from lottobang.data_loader import load_draws
from lottobang.mobile_data import write_mobile_data_bundle
from lottobang.official_marking import parse_official_marking_payload
from lottobang.official_data import load_store_archive
from lottobang.webapp import (
    build_dashboard_payload,
    build_dashboard_store_archive,
    build_store_statistics,
    build_weekly_seed,
    parse_dashboard_params,
    parse_store_lab_params,
)


class GeneratorTest(unittest.TestCase):
    def test_generate_recommendations_returns_unique_tickets(self) -> None:
        draws = load_draws("data/sample_draws.csv")
        recommendations, weights = generate_recommendations(draws, sets_count=5, seed=42)

        self.assertEqual(len(recommendations), 5)
        self.assertEqual(len(weights), 45)
        self.assertEqual(len({recommendation.numbers for recommendation in recommendations}), 5)
        for recommendation in recommendations:
            self.assertEqual(len(recommendation.numbers), 6)
            self.assertEqual(tuple(sorted(recommendation.numbers)), recommendation.numbers)
            self.assertTrue(all(1 <= number <= 45 for number in recommendation.numbers))

    def test_dashboard_payload_includes_archive_data(self) -> None:
        payload = build_dashboard_payload(csv_path="data/sample_draws.csv", sets_count=3, seed=7)

        self.assertEqual(len(payload["tickets"]), 3)
        self.assertEqual(payload["latest_draw"]["round_no"], 1209)
        self.assertGreaterEqual(len(payload["winner_highlights"]), 3)
        self.assertEqual(payload["defaults"]["seed"], 7)
        self.assertGreaterEqual(len(payload["strategy"]["frequency_stats"]), 1)
        self.assertIn("frequency_coverage", payload["strategy"])
        self.assertEqual(len(payload["strategy"]["number_weights"]), 45)
        self.assertEqual(len(payload["strategy"]["pair_weights"]), 990)
        self.assertGreaterEqual(len(payload["strategy"]["top_pairs"]), 1)
        self.assertIn("backtest", payload["strategy"])
        self.assertEqual(payload["strategy"]["frequency_coverage"]["to_round"], 1209)
        self.assertEqual(Path(payload["source_csv"]).name, "official_draws.csv")
        self.assertEqual(payload["store_page_url"], "/stores.html")
        first_history = payload["winner_highlights"][0]
        self.assertIn("first_prize_winners", first_history)
        self.assertEqual(first_history["round_no"], 1209)

    def test_dashboard_payload_keeps_custom_csv_and_trims_history_range(self) -> None:
        custom_csv = Path(tempfile.gettempdir()) / "lottobang_custom_draws.csv"
        custom_csv.write_text(Path("data/sample_draws.csv").read_text(encoding="utf-8"), encoding="utf-8")
        self.addCleanup(lambda: custom_csv.unlink(missing_ok=True))

        payload = build_dashboard_payload(csv_path=custom_csv, sets_count=2, seed=11)

        self.assertEqual(Path(payload["source_csv"]), custom_csv.resolve())
        self.assertEqual(payload["latest_draw"]["round_no"], 1170)
        self.assertEqual(payload["strategy"]["frequency_coverage"]["to_round"], 1170)
        self.assertTrue(all(item["round_no"] <= 1170 for item in payload["winner_highlights"]))

    def test_weekly_seed_uses_iso_week(self) -> None:
        self.assertEqual(build_weekly_seed(date(2026, 3, 12)), 202611)

    def test_parse_dashboard_params_validates_query_values(self) -> None:
        self.assertEqual(parse_dashboard_params("sets=3&seed=17"), (3, 17))
        self.assertEqual(parse_dashboard_params("sets=5"), (5, None))

        with self.assertRaisesRegex(ValueError, "sets는 1부터 10 사이여야 합니다."):
            parse_dashboard_params("sets=0")

        with self.assertRaisesRegex(ValueError, "sets는 숫자여야 합니다."):
            parse_dashboard_params("sets=abc")

        with self.assertRaisesRegex(ValueError, "seed는 비워 두거나 숫자로 입력해야 합니다."):
            parse_dashboard_params("sets=5&seed=abc")

    def test_parse_store_lab_params_validates_ranges(self) -> None:
        parsed = parse_store_lab_params("start_round=1&end_round=10&selection_type=자동&rounds_limit=20")
        self.assertEqual(parsed["start_round"], 1)
        self.assertEqual(parsed["end_round"], 10)
        self.assertEqual(parsed["selection_type"], "자동")
        self.assertEqual(parsed["rounds_limit"], 20)

        with self.assertRaisesRegex(ValueError, "selection_type은 all, 자동, 수동 중 하나여야 합니다."):
            parse_store_lab_params("selection_type=semi")

        with self.assertRaisesRegex(ValueError, "rounds_limit는 1부터 200 사이여야 합니다."):
            parse_store_lab_params("rounds_limit=0")

    def test_parse_official_marking_payload_validates_ticket_numbers(self) -> None:
        parsed = parse_official_marking_payload({"ticket_no": "3", "numbers": [6, 12, 18, 24, 30, 36]})
        self.assertEqual(parsed["ticket_no"], "3")
        self.assertEqual(parsed["numbers"], [6, 12, 18, 24, 30, 36])

        with self.assertRaisesRegex(ValueError, "numbers는 배열이어야 합니다."):
            parse_official_marking_payload({"numbers": "1,2,3,4,5,6"})

        with self.assertRaisesRegex(ValueError, "numbers는 중복 없는 6개 번호여야 합니다."):
            parse_official_marking_payload({"numbers": [1, 1, 2, 3, 4, 5]})

    def test_build_store_statistics_includes_addresses(self) -> None:
        archive = load_store_archive("data/winner_highlights.json")
        stats = build_store_statistics(archive, limit=5)

        self.assertIn("top_regions", stats)
        self.assertIn("top_stores", stats)
        self.assertIn("top_addresses", stats)
        self.assertGreaterEqual(len(stats["top_addresses"]), 1)
        self.assertEqual(stats["coverage"]["from_round"], 1002)

    def test_build_dashboard_store_archive_trims_future_rounds(self) -> None:
        archive = load_store_archive("data/winner_highlights.json")
        trimmed = build_dashboard_store_archive(archive, latest_round=1100)

        self.assertTrue(trimmed)
        self.assertTrue(all(int(item["round_no"]) <= 1100 for item in trimmed))

    def test_write_mobile_data_bundle_generates_manifest_and_hash(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            manifest = write_mobile_data_bundle(
                output_dir=tmp_dir,
                draws_csv_path="data/sample_draws.csv",
                store_archive_path="data/winner_highlights.json",
            )

            manifest_path = Path(tmp_dir) / "manifest.json"
            bundle_path = Path(tmp_dir) / "data_bundle.json"
            self.assertTrue(manifest_path.exists())
            self.assertTrue(bundle_path.exists())

            bundle_bytes = bundle_path.read_bytes()
            parsed_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            parsed_bundle = json.loads(bundle_bytes.decode("utf-8"))

            self.assertEqual(parsed_manifest, manifest)
            self.assertEqual(parsed_manifest["latest_draw_round"], 1170)
            self.assertEqual(parsed_manifest["version"], "round-1170")
            self.assertEqual(
                parsed_manifest["bundle"]["sha256"],
                hashlib.sha256(bundle_bytes).hexdigest(),
            )
            self.assertEqual(parsed_manifest["bundle"]["bytes"], len(bundle_bytes))
            self.assertEqual(parsed_bundle["coverage"]["draws"]["to_round"], 1170)
            self.assertGreaterEqual(len(parsed_bundle["draws"]), 1)
            self.assertGreaterEqual(len(parsed_bundle["store_archive"]), 1)


if __name__ == "__main__":
    unittest.main()
