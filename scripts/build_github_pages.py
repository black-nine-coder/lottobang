from __future__ import annotations

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


def build_pages_site() -> None:
    DOCS_ROOT.mkdir(parents=True, exist_ok=True)
    DOCS_DATA_ROOT.mkdir(parents=True, exist_ok=True)

    for file_name in STATIC_FILES:
        shutil.copy2(WEB_ROOT / file_name, DOCS_ROOT / file_name)

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

    dashboard_payload = build_dashboard_payload(csv_path=resolve_draws_csv())
    dashboard_payload["store_page_url"] = "stores.html"
    (DOCS_DATA_ROOT / "dashboard.json").write_text(
        json.dumps(dashboard_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    pension_payload = build_pension_dashboard()
    (DOCS_DATA_ROOT / "pension_dashboard.json").write_text(
        json.dumps(pension_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    build_readme_page()

    (DOCS_ROOT / ".nojekyll").write_text("", encoding="utf-8")

    print(f"GitHub Pages bundle generated in {DOCS_ROOT}")
    print(f"- copied static files from {WEB_ROOT}")
    print(f"- wrote {DOCS_DATA_ROOT / 'draws.json'}")
    print(f"- wrote {DOCS_DATA_ROOT / 'store_archive.json'}")
    print(f"- wrote {DOCS_DATA_ROOT / 'store_lab.json'}")
    print(f"- wrote {DOCS_DATA_ROOT / 'dashboard.json'}")
    print(f"- wrote {DOCS_DATA_ROOT / 'pension_dashboard.json'}")
    print(f"- wrote {DOCS_ROOT / 'README.md'}")
    print(f"- wrote {DOCS_ROOT / 'readme.html'}")


if __name__ == "__main__":
    build_pages_site()
