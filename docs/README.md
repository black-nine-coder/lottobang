# Lottobang

로또6/45와 연금복권720+ 추천번호를 만들고, 동행복권 공식 구매 화면에서 번호 마킹을 보조하는 개인용 웹 도구입니다.

> 이 프로젝트는 당첨을 보장하지 않습니다. 추천 점수는 실제 당첨 확률이 아니라 알고리즘 기준의 추천 적합도입니다.

## 주요 기능

- 로또6/45 추천번호 생성
- 연금복권720+ 조와 6자리 번호 추천
- 과거 로또 1등 번호 목록 표시
- 1등 당첨 가맹점 지도와 검색
- 동행복권 로그인 입력 보조
- 동행복권 로또 구매 화면 번호 마킹 보조
- 마킹 실행 이력 저장
- GitHub Pages용 정적 웹페이지 생성

## 실행 방법

```bash
python serve.py --host 127.0.0.1 --port 8010
```

브라우저에서 아래 주소로 접속합니다.

```text
http://127.0.0.1:8010/
```

## 화면

- 로또 추천: `web/index.html`
- 연금복권 추천: `web/pension.html`
- 가맹점 지도: `web/stores.html`

## GitHub Pages 빌드

GitHub Pages는 `/docs` 폴더를 사용합니다.

```bash
python scripts/build_github_pages.py
```

생성되는 주요 파일:

- `docs/index.html`
- `docs/pension.html`
- `docs/stores.html`
- `docs/data/dashboard.json`
- `docs/data/pension_dashboard.json`
- `docs/data/store_lab.json`

## 데이터

- `data/official_draws.csv`: 로또6/45 회차별 당첨번호
- `data/official_winner_stores.json`: 1등 당첨 가맹점 데이터
- `data/pension720_draws.json`: 연금복권720+ 과거 데이터 파일, 있으면 자동 반영

현재 연금복권 과거 데이터 파일이 없으면 균등 가중치 기반 추천을 제공합니다.

## 보안 메모

동행복권 아이디와 비밀번호는 코드에 하드코딩하지 않습니다. 웹 화면에서 입력한 값은 현재 브라우저의 `localStorage`에만 저장됩니다.

GitHub Pages는 저장소가 public이면 누구나 접근할 수 있습니다. 계정 정보나 민감한 값을 정적 파일에 넣지 마세요.

## 테스트

```bash
python -m unittest discover -s tests
```

## 자동화 범위

자동화는 번호 마킹 보조까지만 수행합니다. 최종 구매 버튼 클릭과 결제 확정은 사용자가 직접 확인해야 합니다.
