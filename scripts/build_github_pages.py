from __future__ import annotations

import argparse
import html
import json
import shutil
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from lottobang.data_loader import load_draws
from lottobang.official_data import load_store_archive, resolve_draws_csv
from lottobang.pension720 import build_pension_dashboard
from lottobang.webapp import build_dashboard_payload, build_store_lab_payload

WEB_ROOT = PROJECT_ROOT / "web"
DOCS_ROOT = PROJECT_ROOT / "docs"
DOCS_DATA_ROOT = DOCS_ROOT / "data"
README_PATH = PROJECT_ROOT / "README.md"
STATIC_FILES = [
    "index.html",
    "stores.html",
    "pension.html",
    "styles.css",
    "browser.js",
    "app.js",
    "stores.js",
    "pension.js",
]


def build_readme_page() -> None:
    readme_text = README_PATH.read_text(encoding="utf-8")
    escaped = html.escape(readme_text)
    readme_html = f"""<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>프로젝트 안내</title>
    <link rel="stylesheet" href="styles.css">
  </head>
  <body>
    <div class="page-shell">
      <header class="hero">
        <div class="hero-copy">
          <p class="eyebrow">project guide</p>
          <p class="hero-title">README</p>
          <div class="hero-badges">
            <span class="hero-badge">github pages</span>
            <span class="hero-badge hero-badge-muted">static docs</span>
          </div>
          <p class="hero-text">저장소 루트 README를 Pages에서 읽을 수 있도록 정적 문서 페이지로 복제한 화면입니다.</p>
        </div>
        <div class="hero-aside">
          <a class="badge-link" href="index.html">대시보드로 돌아가기</a>
          <a class="badge-link" href="stores.html">가맹점 연구 지도</a>
        </div>
      </header>

      <main>
        <section class="panel">
          <div class="panel-head">
            <div>
              <p class="section-kicker">Guide</p>
              <h2>프로젝트 문서</h2>
            </div>
          </div>
          <div class="doc-content">
            <pre>{escaped}</pre>
          </div>
        </section>
      </main>
    </div>
  </body>
</html>
"""
    (DOCS_ROOT / "README.md").write_text(readme_text, encoding="utf-8")
    (DOCS_ROOT / "readme.html").write_text(readme_html, encoding="utf-8")


def build_pages_assets() -> bool:
    if not (WEB_ROOT / "browser.js").is_file():
        # A checkout used solely for publishing can carry the ready-to-serve assets.
        if all((DOCS_ROOT / file_name).is_file() for file_name in STATIC_FILES):
            return False
        raise FileNotFoundError("The mobile Pages assets are missing from web/ and docs/.")
    DOCS_ROOT.mkdir(parents=True, exist_ok=True)
    for file_name in STATIC_FILES:
        source = WEB_ROOT / file_name
        target = DOCS_ROOT / file_name
        if source.suffix == ".html":
            page = source.read_text(encoding="utf-8")
            target.write_text(page.replace('<html lang="ko">', '<html lang="ko" data-hosting="pages">', 1), encoding="utf-8")
        else:
            shutil.copy2(source, target)
    return True


def build_recommendation_snapshots() -> None:
    DOCS_DATA_ROOT.mkdir(parents=True, exist_ok=True)
    dashboard = build_dashboard_payload(csv_path=resolve_draws_csv())
    dashboard.pop("source_csv", None)
    latest = dashboard.get("latest_first_prize")
    if isinstance(latest, dict):
        public_fields = ("round_no", "draw_date", "first_prize_winners", "prize_per_winner")
        dashboard["latest_first_prize"] = {key: latest[key] for key in public_fields if key in latest}
    dashboard["store_page_url"] = "stores.html"
    snapshots = {
        "dashboard.json": dashboard,
        "pension_dashboard.json": build_pension_dashboard(),
    }
    for file_name, payload in snapshots.items():
        (DOCS_DATA_ROOT / file_name).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )


def build_pages_site(*, data_only: bool = False) -> None:
    if not data_only and build_pages_assets():
        print(f"- copied static files from {WEB_ROOT}")
    DOCS_DATA_ROOT.mkdir(parents=True, exist_ok=True)

    draws = load_draws(resolve_draws_csv())
    draws_payload = [
        {
            "round_no": draw.round_no,
            "draw_date": draw.draw_date,
            "numbers": list(draw.numbers),
            "bonus": draw.bonus,
        }
        for draw in draws
    ]
    (DOCS_DATA_ROOT / "draws.json").write_text(
        json.dumps(draws_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    store_archive = load_store_archive()
    (DOCS_DATA_ROOT / "store_archive.json").write_text(
        json.dumps(store_archive, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    latest_store_round = int(store_archive[-1]["round_no"]) if store_archive else 1
    store_lab_payload = build_store_lab_payload(
        start_round=1,
        end_round=latest_store_round,
        rounds_limit=40,
    )
    (DOCS_DATA_ROOT / "store_lab.json").write_text(
        json.dumps(store_lab_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    build_recommendation_snapshots()
    if not data_only:
        build_readme_page()
        (DOCS_ROOT / ".nojekyll").write_text("", encoding="utf-8")
        print(f"- wrote {DOCS_ROOT / 'README.md'}")
        print(f"- wrote {DOCS_ROOT / 'readme.html'}")

    print(f"GitHub Pages data generated in {DOCS_DATA_ROOT}")
    print(f"- wrote {DOCS_DATA_ROOT / 'draws.json'}")
    print(f"- wrote {DOCS_DATA_ROOT / 'store_archive.json'}")
    print(f"- wrote {DOCS_DATA_ROOT / 'store_lab.json'}")
    print(f"- wrote {DOCS_DATA_ROOT / 'dashboard.json'}")
    print(f"- wrote {DOCS_DATA_ROOT / 'pension_dashboard.json'}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build the GitHub Pages site and its lottery data.")
    parser.add_argument("--data-only", action="store_true", help="Refresh JSON snapshots without replacing the site pages or scripts.")
    build_pages_site(data_only=parser.parse_args().data_only)
