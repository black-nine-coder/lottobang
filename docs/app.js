const OFFICIAL_URL = "https://www.dhlottery.co.kr/";
const OFFICIAL_MARKING_URL = "https://ol.dhlottery.co.kr/olotto/game/game645.do";
const DEFAULT_BATCH_COUNT = 5;
const TOTAL_LOTTO_COMBINATIONS = 8_145_060;
const CREDENTIAL_STORAGE_KEY = "lottobang.officialCredentials";
const MIN_NUMBER_SPAN = 18;
const IDEAL_SUM = 138;
const SUM_BALANCE_RADIUS = 55;
const MAX_SHARED_NUMBERS_WITH_LATEST_DRAW = 3;
const PROFILE_SCORE_WEIGHT = 0.35;
const state = { payload: null, activeTicket: null, activeScript: "", batchScript: "" };
const $ = (selector) => document.querySelector(selector);
const els = {
  controls: $("#controls"), generatedAt: $("#generatedAt"), latestRound: $("#latestRound"), coverage: $("#coverage"), latestPrize: $("#latestPrize"), latestPrizeMeta: $("#latestPrizeMeta"), tickets: $("#tickets"),
  markingSummary: $("#markingSummary"), markingBoard: $("#markingBoard"), officialScript: $("#officialScript"), openOfficial: $("#openOfficial"),
  officialLoginForm: $("#officialLoginForm"), officialUserId: $("#officialUserId"), officialPassword: $("#officialPassword"), fillOfficialLogin: $("#fillOfficialLogin"), runOfficialFlow: $("#runOfficialFlow"), copyLoginScript: $("#copyLoginScript"),
  autoMarkOfficial: $("#autoMarkOfficial"), copyConsoleScript: $("#copyConsoleScript"), copyBatchScript: $("#copyBatchScript"), copyAllTickets: $("#copyAllTickets"),
  refreshMarkingHistory: $("#refreshMarkingHistory"), markingHistory: $("#markingHistory"),
  rules: $("#rules"), backtestSummary: $("#backtestSummary"), topPairs: $("#topPairs"), topNumbers: $("#topNumbers"), drawHistory: $("#drawHistory"), drawSearch: $("#drawSearch"), statusMessage: $("#statusMessage"),
};
function ballTone(n) { if (n <= 10) return "n1"; if (n <= 20) return "n2"; if (n <= 30) return "n3"; if (n <= 40) return "n4"; return "n5"; }
function normalizeTicketNumbers(numbers) { return [...new Set((numbers || []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 45))].sort((a, b) => a - b); }
function formatNumbers(numbers) { return normalizeTicketNumbers(numbers).map((n) => String(n).padStart(2, "0")).join(", "); }
function renderBalls(numbers) { return `<div class="balls">${normalizeTicketNumbers(numbers).map((n) => `<span class="ball ${ballTone(n)}">${String(n).padStart(2, "0")}</span>`).join("")}</div>`; }
function setStatus(message, tone = "info") { if (!message) { els.statusMessage.hidden = true; els.statusMessage.textContent = ""; return; } els.statusMessage.hidden = false; els.statusMessage.dataset.tone = tone; els.statusMessage.textContent = message; window.setTimeout(() => { if (els.statusMessage.textContent === message) els.statusMessage.hidden = true; }, 4200); }
function buildQuery() {
  const params = new URLSearchParams({ sets: $("#sets").value || "5" });
  params.set("mode", $("#recommendationMode")?.value || "uniform");
  const seed = $("#seed").value.trim();
  if (seed) params.set("seed", seed);
  return params;
}
function loadStoredCredentials() { try { const saved = JSON.parse(localStorage.getItem(CREDENTIAL_STORAGE_KEY) || "{}"); if (saved.userId) els.officialUserId.value = saved.userId; if (saved.password) els.officialPassword.value = saved.password; } catch { localStorage.removeItem(CREDENTIAL_STORAGE_KEY); } }
function saveStoredCredentials() { const userId = els.officialUserId.value.trim(); const password = els.officialPassword.value; if (!userId && !password) { localStorage.removeItem(CREDENTIAL_STORAGE_KEY); return; } localStorage.setItem(CREDENTIAL_STORAGE_KEY, JSON.stringify({ userId, password })); }
function isLocalAutomationAvailable() {
  return !lottoBrowser.isPages && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(location.hostname);
}
async function loadDashboard(params = buildQuery()) {
  setStatus("추천 데이터를 불러오는 중입니다.");
  const response = lottoBrowser.isPages ? null : await fetch(`api/dashboard?${params}`).catch(() => null);
  if (response?.ok) {
    state.payload = await response.json();
  } else {
    if (!state.snapshot) {
      const snapshot = await fetch("data/dashboard.json", { cache: "no-cache" });
      if (!snapshot.ok) throw new Error("로또 추천 데이터를 불러오지 못했습니다.");
      state.snapshot = await snapshot.json();
    }
    state.payload = buildStaticDashboardVariant(state.snapshot, params);
  }
  renderDashboard(state.payload);
  setStatus("");
}
function weightedPick(pool, rng, excluded) { const available = pool.filter((item) => !excluded.has(item.number)); const total = available.reduce((sum, item) => sum + Math.max(Number(item.weight) || 0.01, 0.01), 0); let cursor = rng() * total; for (const item of available) { cursor -= Math.max(Number(item.weight) || 0.01, 0.01); if (cursor <= 0) return item.number; } return available[available.length - 1]?.number || 1; }
function normalizeMapToMean(values) { const entries = [...values.entries()]; const mean = entries.reduce((sum, [, value]) => sum + Number(value || 0), 0) / Math.max(entries.length, 1); return new Map(entries.map(([key, value]) => [key, mean > 0 ? Number(value || 0) / mean : 1])); }
function scoreStaticTicket(numbers, weights, pairWeights = new Map(), latestNumbers = []) { const sorted = normalizeTicketNumbers(numbers); const base = sorted.reduce((sum, number) => sum + (weights.get(number) || 1), 0) / 6; const buckets = new Set(sorted.map((n) => Math.floor((n - 1) / 10))); const spreadBonus = Math.min(buckets.size, 5) * 0.01; const odd = sorted.filter((n) => n % 2).length; const total = sorted.reduce((sum, number) => sum + number, 0); const consecutive = sorted.slice(1).filter((n, i) => n - sorted[i] === 1).length; const endings = sorted.reduce((map, number) => map.set(number % 10, (map.get(number % 10) || 0) + 1), new Map()); const sumFit = Math.max(0, 1 - (Math.abs(total - IDEAL_SUM) / SUM_BALANCE_RADIUS)); const oddBonus = odd === 3 ? 0.015 : 0.008; const spanFit = Math.min(1, Math.max(0, ((sorted[sorted.length - 1] - sorted[0]) - MIN_NUMBER_SPAN) / (45 - 1 - MIN_NUMBER_SPAN))); const bucketBonus = Math.max(0, buckets.size - 3) * 0.006; const consecutivePenalty = consecutive * 0.006; const endingPenalty = Math.max(0, Math.max(...endings.values()) - 2) * 0.006; const latestOverlapPenalty = Math.max(0, sharedCount(sorted, latestNumbers) - 2) * 0.008; let pairScore = 0; let pairCount = 0; for (let i = 0; i < sorted.length; i += 1) { for (let j = i + 1; j < sorted.length; j += 1) { pairScore += pairWeights.get(`${sorted[i]}-${sorted[j]}`) || 1; pairCount += 1; } } const profileScore = (sumFit * 0.02) + oddBonus + (spanFit * 0.012) + bucketBonus - consecutivePenalty - endingPenalty - latestOverlapPenalty; return base + spreadBonus + ((pairScore / Math.max(pairCount, 1)) * 0.06) + (PROFILE_SCORE_WEIGHT * profileScore); }
function isBalancedTicket(numbers) { const sorted = normalizeTicketNumbers(numbers); const odd = sorted.filter((n) => n % 2).length; const sum = sorted.reduce((acc, n) => acc + n, 0); const consecutive = sorted.slice(1).filter((n, i) => n - sorted[i] === 1).length; const low = sorted.filter((n) => n <= 15).length; const high = sorted.filter((n) => n >= 31).length; const buckets = new Set(sorted.map((n) => Math.floor((n - 1) / 10))).size; const span = sorted[sorted.length - 1] - sorted[0]; return sorted.length === 6 && odd >= 2 && odd <= 4 && sum >= 90 && sum <= 200 && span >= MIN_NUMBER_SPAN && consecutive <= 2 && low >= 1 && low <= 3 && high >= 1 && high <= 3 && buckets >= 3; }
function sharedCount(left, right) { const rightSet = new Set(right); return left.filter((number) => rightSet.has(number)).length; }

function sampleUniformNumbers(rng) {
  const numbers = new Set();
  while (numbers.size < 6) numbers.add(1 + Math.floor(rng() * 45));
  return [...numbers].sort((left, right) => left - right);
}

function buildStaticDashboardVariant(basePayload, params) {
  const seed = params.has("seed") ? Number(params.get("seed")) : Date.now();
  const sets = Math.max(1, Math.min(10, Number(params.get("sets")) || basePayload.defaults?.sets_count || 5));
  const rng = lottoBrowser.random(seed);
  const mode = params.get("mode") === "model" ? "model" : "uniform";
  const snapshotBacktest = basePayload.strategy.backtest;
  const backtest = snapshotBacktest?.mode === mode && snapshotBacktest.sets_count === sets
    ? snapshotBacktest : null;
  const strategy = { ...basePayload.strategy, backtest };
  const defaults = { ...basePayload.defaults, sets_count: sets, seed, mode };
  if (mode === "uniform") {
    const tickets = new Map();
    while (tickets.size < sets) {
      const numbers = sampleUniformNumbers(rng);
      const key = numbers.join("-");
      if (!tickets.has(key)) {
        tickets.set(key, { ticket_no: tickets.size + 1, numbers, score: 0, mode });
      }
    }
    return {
      ...basePayload,
      generated_at_utc: new Date().toISOString(),
      defaults,
      strategy: { ...strategy, rules: ["1~45에서 서로 다른 숫자 6개를 균등 추첨", "한 번에 생성한 세트끼리 6개 번호 전체 중복 방지"] },
      tickets: [...tickets.values()],
    };
  }
  const weightSource = basePayload.strategy?.number_weights || basePayload.strategy?.top_numbers || [];
  const weightMap = new Map(weightSource.map((item) => [Number(item.number), Number(item.weight) || 0.05]));
  const pairMap = new Map((basePayload.strategy?.pair_weights || []).map((item) => [normalizeTicketNumbers(item.numbers).join("-"), Number(item.weight) || 0]));
  const scoringWeightMap = normalizeMapToMean(weightMap);
  const scoringPairMap = normalizeMapToMean(pairMap);
  const historicalTickets = new Set((basePayload.all_draws || []).map((draw) => normalizeTicketNumbers(draw.numbers || []).join("-")));
  const latestNumbers = normalizeTicketNumbers(basePayload.latest_draw?.numbers || []);
  const pool = Array.from({ length: 45 }, (_, index) => ({ number: index + 1, weight: weightMap.get(index + 1) || 0.05 }));
  const modelCount = sets > 1 ? sets - 1 : sets;
  const candidates = [];
  const seen = new Set();
  const targetCandidates = Math.max(sets * 120, sets);
  for (let attempt = 0; candidates.length < targetCandidates && attempt < 5000; attempt += 1) {
    const selected = new Set();
    while (selected.size < 6) selected.add(weightedPick(pool, rng, selected));
    const numbers = normalizeTicketNumbers([...selected]);
    const key = numbers.join("-");
    if (seen.has(key) || historicalTickets.has(key) || sharedCount(numbers, latestNumbers) > MAX_SHARED_NUMBERS_WITH_LATEST_DRAW || !isBalancedTicket(numbers)) continue;
    seen.add(key);
    candidates.push({ numbers, score: scoreStaticTicket(numbers, scoringWeightMap, scoringPairMap, latestNumbers) });
  }
  candidates.sort((left, right) => right.score - left.score);
  const tickets = [];
  for (const candidate of candidates) {
    if (tickets.every((ticket) => sharedCount(candidate.numbers, ticket.numbers) <= 2)) tickets.push(candidate);
    if (tickets.length === modelCount) break;
  }
  for (const candidate of candidates) {
    if (tickets.length === modelCount) break;
    if (!tickets.includes(candidate)) tickets.push(candidate);
  }
  if (sets > 1) {
    const selectedKeys = new Set(tickets.map((ticket) => ticket.numbers.join("-")));
    let numbers;
    do {
      numbers = sampleUniformNumbers(rng);
    } while (selectedKeys.has(numbers.join("-")));
    tickets.push({ numbers, score: 0, mode: "exploration" });
  }
  return {
    ...basePayload,
    generated_at_utc: new Date().toISOString(),
    defaults,
    strategy: { ...strategy, rules: ["과거 출현 가중치와 번호 균형을 참고", "두 세트 이상이면 마지막 세트는 균등 추첨"] },
    tickets: tickets.slice(0, sets).map((ticket, index) => ({ ticket_no: index + 1, numbers: ticket.numbers, score: Number(ticket.score.toFixed(4)), mode: ticket.mode || "model" })),
  };
}
function renderDashboard(payload) { const range = payload.strategy.frequency_coverage; const prize = payload.latest_first_prize; const freshness = payload.data_freshness || {}; els.latestRound.textContent = freshness.is_stale ? `${payload.latest_draw.round_no}회 보유` : `${payload.latest_draw.round_no}회`; els.generatedAt.textContent = freshness.is_stale ? `예상 최신 ${freshness.expected_latest_round}회 · ${freshness.missing_rounds}회차 누락 · seed ${payload.defaults.seed}` : `생성 ${new Date(payload.generated_at_utc).toLocaleString("ko-KR")} · seed ${payload.defaults.seed}`; els.coverage.textContent = `${range.from_round}-${range.to_round}회`; if (prize && Number(prize.round_no) === Number(payload.latest_draw.round_no)) { els.latestPrize.textContent = `${prize.first_prize_winners}명`; els.latestPrizeMeta.textContent = `1인당 ${prize.prize_per_winner || "-"} · ${prize.draw_date || ""}`; } else { els.latestPrize.textContent = freshness.is_stale ? "데이터 갱신 필요" : "-"; els.latestPrizeMeta.textContent = freshness.message || "최신 1등 정보 없음"; } $("#sets").value = payload.defaults.sets_count; renderTickets(payload.tickets || []); renderStrategy(payload.strategy); renderDrawHistory(payload.all_draws || []); prepareBatchScript(payload.tickets || []); if (payload.tickets?.length) selectTicket(payload.tickets[0]); }
function renderTickets(tickets) {
  els.copyAllTickets.disabled = !tickets.length;
  els.tickets.innerHTML = tickets.map((ticket, index) => {
    const featured = tickets.length === DEFAULT_BATCH_COUNT && index === DEFAULT_BATCH_COUNT - 1
      && (ticket.mode === "uniform" || ticket.mode === "exploration");
    let label = ticket.mode === "model" ? "참고 점수 " + Number(ticket.score).toFixed(4) : "균등 추첨";
    if (featured) label = "전체 조합 추첨";
    return `
      <article class="ticket-card${featured ? " is-unrestricted" : ""}" data-ticket="${ticket.ticket_no}">
        <div class="ticket-head"><h3>Ticket ${ticket.ticket_no}</h3><span class="score">${label}</span></div>
        ${renderBalls(ticket.numbers)}
        ${featured ? `<p class="ticket-odds">1세트의 본번호 6개 일치 확률 <strong>1 / ${TOTAL_LOTTO_COMBINATIONS.toLocaleString("ko-KR")}</strong></p>` : ""}
        ${lottoBrowser.isPages ? "" : `<button type="button" class="ghost select-ticket" data-ticket="${ticket.ticket_no}">이 번호 사용</button>`}
      </article>
    `;
  }).join("");
  els.tickets.querySelectorAll(".select-ticket").forEach((button) => {
    button.addEventListener("click", () => {
      const ticket = tickets.find((item) => String(item.ticket_no) === button.dataset.ticket);
      if (ticket) selectTicket(ticket);
    });
  });
}

function formatMatchProbability(probability) {
  const percent = probability * 100;
  return percent.toFixed(percent < 0.01 ? 8 : 3) + "%";
}

function renderBacktest(backtest, tickets) {
  const uniqueSets = new Set(tickets.map((ticket) => normalizeTicketNumbers(ticket.numbers).join("-"))).size;
  const jackpot = formatMatchProbability(uniqueSets / TOTAL_LOTTO_COMBINATIONS);
  const headline = `<p>서로 다른 ${uniqueSets}세트 기준 회차당 1등 확률 <strong>${jackpot}</strong></p>`;
  if (!backtest?.rounds || !backtest.uniform_match_probabilities || backtest.sets_count !== uniqueSets) {
    els.backtestSummary.innerHTML = headline + '<p class="muted">현재 설정의 백테스트 결과를 사용할 수 없습니다.</p>';
    return;
  }

  const rows = [
    [3, "3개 이상", backtest.three_plus_count],
    [4, "4개 이상", backtest.four_plus_count],
    [5, "5개 이상", backtest.five_plus_count],
    [6, "6개 일치", backtest.six_match_count],
  ];
  const modeLabel = backtest.mode === "uniform" ? "균등 추첨" : "과거 데이터 참고";
  els.backtestSummary.innerHTML = `
    ${headline}
    <p class="muted">${modeLabel} · ${lottoBrowser.isPages ? "게시 시 집계 · " : ""}${backtest.from_round}~${backtest.to_round}회 중 ${backtest.rounds}회 검증 · 보너스 번호 제외</p>
    <table aria-label="백테스트 적중 횟수와 균등 추첨 확률 비교">
      <thead><tr><th scope="col">일치 기준</th><th scope="col">관측 횟수</th><th scope="col">균등 추첨 확률</th></tr></thead>
      <tbody>${rows.map(([threshold, label, count]) => `
        <tr><th scope="row">${label}</th><td>${count} / ${backtest.rounds}회</td>
        <td>${formatMatchProbability(backtest.uniform_match_probabilities[threshold])}</td></tr>
      `).join("")}</tbody>
    </table>
  `;
}

function renderStrategy(strategy) {
  els.rules.innerHTML = strategy.rules.map((rule) => `<span class="chip">${rule}</span>`).join("");
  renderBacktest(strategy.backtest, state.payload.tickets || []);
  els.topPairs.innerHTML = (strategy.top_pairs || []).map((item) => `<span class="chip">pair ${formatNumbers(item.numbers)} · ${Number(item.weight).toFixed(3)}</span>`).join("");
  const max = Math.max(...strategy.top_numbers.map((item) => item.weight), 1);
  els.topNumbers.innerHTML = strategy.top_numbers.map((item) => `
    <div class="signal-row"><strong>${String(item.number).padStart(2, "0")}</strong>
      <div class="signal-bar"><span style="width:${Math.round((item.weight / max) * 100)}%"></span></div>
      <small>${Number(item.weight).toFixed(3)}</small>
    </div>
  `).join("");
}
function renderDrawHistory(draws) { const q = (els.drawSearch.value || "").trim().toLowerCase(); const filtered = draws.filter((d) => !q || String(d.round_no).includes(q) || String(d.draw_date).toLowerCase().includes(q)).slice(0, 80); els.drawHistory.innerHTML = filtered.map((d) => `<article class="draw-card"><div class="draw-head"><h3>${d.round_no}회</h3><span class="muted">${d.draw_date}</span></div>${renderBalls(d.numbers)}<p class="muted">보너스 ${String(d.bonus).padStart(2, "0")}</p></article>`).join(""); }
async function loadMarkingHistory() { const res = await fetch("api/purchase-history?limit=50"); const payload = await res.json(); if (!res.ok) throw new Error(payload.error || "구매 이력을 불러오지 못했습니다."); renderMarkingHistory(payload.history || []); }
function renderMarkingHistory(history) {
  if (!history.length) {
    els.markingHistory.innerHTML = `<p class="muted">아직 저장된 구매 이력이 없습니다.</p>`;
    return;
  }
  els.markingHistory.innerHTML = history.map((entry) => {
    const markedAt = entry.marked_at_utc ? new Date(entry.marked_at_utc).toLocaleString("ko-KR") : "-";
    const purchasedAt = entry.purchased_at_utc ? new Date(entry.purchased_at_utc).toLocaleString("ko-KR") : "";
    const purchased = entry.status === "purchased";
    const tickets = (entry.tickets || []).map((ticket) => `<div class="history-ticket"><span>Set ${ticket.ticket_no}</span>${renderBalls(ticket.numbers || [])}</div>`).join("");
    const source = entry.source === "official-purchase-flow" ? "로그인 후 5세트 마킹" : "단건 마킹";
    const status = `<span class="history-status ${purchased ? "is-purchased" : ""}">${purchased ? "구매 완료" : "마킹 완료"}</span>`;
    const action = purchased ? `<p class="muted">구매 기록 ${purchasedAt}</p>` : `<div class="history-actions"><button type="button" class="ghost confirm-purchase-history" data-history-id="${entry.id}">실제 구매 완료로 기록</button></div>`;
    return `<article class="marking-history-card"><div class="draw-head"><div><h3>${source}</h3>${status}</div><span class="muted">${markedAt}</span></div>${tickets}${action}</article>`;
  }).join("");
  els.markingHistory.querySelectorAll(".confirm-purchase-history").forEach((button) => {
    button.addEventListener("click", () => confirmPurchaseHistory(button.dataset.historyId).catch((error) => setStatus(error.message || String(error), "error")));
  });
}
async function confirmPurchaseHistory(historyId) {
  if (!historyId || !window.confirm("동행복권에서 실제 구매가 완료되었습니까? 이 항목을 로컬 구매 완료 이력으로 저장합니다.")) return;
  const response = await fetch("api/purchase-history/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ history_id: Number(historyId) }) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "구매 완료 이력을 저장하지 못했습니다.");
  await loadMarkingHistory();
  setStatus("실제 구매 완료 이력을 로컬 SQLite DB에 저장했습니다.");
}
function selectTicket(ticket) { state.activeTicket = { ticketNo: String(ticket.ticket_no), numbers: normalizeTicketNumbers(ticket.numbers) }; state.activeScript = buildOfficialMarkingScript([state.activeTicket]); els.officialScript.value = state.activeScript; els.markingSummary.textContent = `Ticket ${state.activeTicket.ticketNo} · ${formatNumbers(state.activeTicket.numbers)}`; els.autoMarkOfficial.disabled = false; els.copyConsoleScript.disabled = false; renderNumberBoard(state.activeTicket.numbers); document.querySelectorAll(".ticket-card").forEach((card) => card.classList.toggle("is-active", card.dataset.ticket === state.activeTicket.ticketNo)); }
function renderNumberBoard(numbers) { const selected = new Set(normalizeTicketNumbers(numbers)); els.markingBoard.innerHTML = Array.from({ length: 45 }, (_, i) => i + 1).map((n) => `<span class="number-cell ${selected.has(n) ? "is-selected" : ""}">${String(n).padStart(2, "0")}</span>`).join(""); }
function prepareBatchScript(tickets) { const normalized = tickets.slice(0, DEFAULT_BATCH_COUNT).map((t, i) => ({ ticketNo: String(t.ticket_no || i + 1), numbers: normalizeTicketNumbers(t.numbers || []) })).filter((t) => t.numbers.length === 6); state.batchScript = normalized.length ? buildOfficialMarkingScript(normalized) : ""; els.copyBatchScript.disabled = normalized.length === 0; }
function buildOfficialMarkingScript(tickets) {
  const normalized = tickets.map((ticket, index) => ({
    ticketNo: String(ticket.ticketNo || index + 1),
    numbers: normalizeTicketNumbers(ticket.numbers || []),
  })).filter((ticket) => ticket.numbers.length === 6);
  return `(() => {
  const tickets = ${JSON.stringify(normalized)};
  const officialUrl = ${JSON.stringify(OFFICIAL_MARKING_URL)};
  const doc = document;
  const $ = window.jQuery || null;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const fail = (message) => { throw new Error(message + "\\n" + officialUrl); };
  const trigger = (element) => { if (!element) return false; if ($) $(element).trigger("click"); else element.click(); return true; };
  const visible = (element) => { if (!element || element.hidden) return false; const style = getComputedStyle(element); return style.display !== "none" && style.visibility !== "hidden"; };
  const textOf = (element) => (element.innerText || element.textContent || element.value || element.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim();
  const attrsOf = (element) => [element.id, element.name, element.className, element.getAttribute("for"), element.getAttribute("value"), element.getAttribute("title"), element.getAttribute("onclick"), element.getAttribute("aria-label")].filter(Boolean).join(" ");
  const findNumber = (number) => {
    const text = String(number);
    const padded = text.padStart(2, "0");
    const idSelectors = [
      "check645num" + number,
      "num" + number,
      "lotto645num" + number,
      "lottoNum" + number,
    ];
    for (const id of idSelectors) {
      const byId = doc.getElementById(id);
      if (byId) return byId;
      const byFor = doc.querySelector("label[for='" + id + "']");
      if (byFor) return byFor;
    }
    const candidates = Array.from(doc.querySelectorAll("label, button, a, span, li, input[type='button']"))
      .filter(visible)
      .map((element) => {
        let score = 0;
        const label = textOf(element);
        const attrs = attrsOf(element);
        if (label === text || label === padded) score += 100;
        if (attrs.includes("645") || /num|number|ball|lotto/i.test(attrs)) score += 20;
        if (element.tagName.toLowerCase() === "label") score += 15;
        return { element, score };
      })
      .filter((candidate) => candidate.score >= 100)
      .sort((left, right) => right.score - left.score);
    return candidates[0]?.element || null;
  };
  if (!findNumber(1)) {
    const isLottoMarkingPage = location.hostname === "el.dhlottery.co.kr" && location.href.includes("LottoId=LO40");
    if (!isLottoMarkingPage) {
      alert("현재 페이지에는 번호 선택판이 없습니다. 동행복권 LO40 번호 선택 페이지로 이동합니다. 이동 후 로그인/구매 화면이 뜨면 콘솔 스크립트를 다시 실행하세요.");
      location.assign(officialUrl);
      return;
    }
    const gameFrame = Array.from(doc.querySelectorAll("iframe"))
      .map((frame) => frame.src || frame.getAttribute("src") || "")
      .find((src) => src.includes("/olotto/game/game645.do"));
    if (gameFrame) {
      alert("번호판은 하위 구매 화면에 있습니다. 실제 LO40 번호 선택 페이지로 이동합니다. 이동 후 콘솔 스크립트를 다시 실행하세요.");
      location.assign(gameFrame);
      return;
    }
    fail("번호 선택판을 찾지 못했습니다. 로그인 후 LO40 구매 화면에서 번호 선택 단계까지 진입한 뒤 다시 실행하세요.");
  }
  const clearBoard = () => {
    const clearButton = ["#btnReset", "#btnNumberReset", ".btn_reset", ".btn_reset_new", "button[onclick*='reset']", "a[onclick*='reset']", "input[onclick*='reset']"]
      .map((selector) => doc.querySelector(selector))
      .find(Boolean);
    if (clearButton) trigger(clearButton);
  };
  const clickNumber = (number) => {
    const checkbox = doc.getElementById("check645num" + number);
    if (checkbox) { if (!checkbox.checked) trigger(checkbox); return true; }
    return trigger(doc.getElementById("num" + number));
  };
  const amountSelect = doc.getElementById("amoundApply") || doc.getElementById("amountApply");
  const confirmButton = doc.getElementById("btnSelectNum") || doc.querySelector("button[onclick*='SelectNum'], a[onclick*='SelectNum'], input[onclick*='SelectNum']");
  const setAmount = async (value) => {
    if (!amountSelect) return;
    amountSelect.value = String(value);
    amountSelect.dispatchEvent(new Event("change", { bubbles: true }));
    amountSelect.dispatchEvent(new Event("input", { bubbles: true }));
    if ($) $(amountSelect).val(String(value)).trigger("change");
    await sleep(150);
  };
  const lineKeys = ["A", "B", "C", "D", "E"];
  const findLineControl = (lineKey) => {
    const exact = new RegExp("^" + lineKey + "$", "i");
    const contextual = /line|row|sheet|tab|game|paper|manual|auto|semi|num|slot/i;
    const candidates = Array.from(doc.querySelectorAll("label,button,a,li,span,div,input[type='radio'],input[type='button']"))
      .filter(visible)
      .map((element) => {
        let score = 0;
        if (exact.test(textOf(element))) score += 120;
        if (exact.test((element.getAttribute("value") || "").trim())) score += 90;
        if (attrsOf(element).includes(lineKey)) score += 25;
        if (contextual.test(attrsOf(element))) score += 15;
        return { element, score };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score);
    return candidates[0]?.element || null;
  };
  (async () => {
    for (let index = 0; index < tickets.length; index += 1) {
      const ticket = tickets[index];
      await setAmount(1);
      if (tickets.length > 1) {
        const lineControl = findLineControl(lineKeys[index]);
        if (lineControl) { trigger(lineControl); await sleep(160); }
      }
      clearBoard();
      await sleep(100);
      const missing = ticket.numbers.filter((number) => !clickNumber(number));
      if (missing.length) fail("찾지 못한 번호 버튼: " + missing.join(", "));
      await sleep(160);
      if (tickets.length > 1 && confirmButton) { trigger(confirmButton); await sleep(220); }
    }
    if (tickets.length === 1 && confirmButton) trigger(confirmButton);
    alert("번호 마킹 완료: " + tickets.map((ticket) => ticket.ticketNo + " [" + ticket.numbers.join(", ") + "]").join(" / ") + "\\n구매 버튼은 직접 확인 후 누르세요.");
  })().catch((error) => alert(error.message || String(error)));
})();`;
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(message);
  } catch {
    els.officialScript.value = text;
    els.officialScript.focus();
    els.officialScript.select();
    const copied = document.execCommand?.("copy");
    setStatus(copied ? message : "스크립트를 아래 입력창에 준비했습니다. 직접 전체 선택 후 복사하세요.", copied ? "info" : "error");
  }
}
function buildOfficialLoginScript(userId, password) {
  return `(() => {
  const userId = ${JSON.stringify(userId)};
  const password = ${JSON.stringify(password)};
  const byXPath = (xpath) => document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  const setValue = (element, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  };
  const idInput = byXPath('//*[@id="inpUserId"]');
  const passwordInput = byXPath('//*[@id="inpUserPswdEncn"]');
  const loginButton = byXPath('//*[@id="btnLogin"]');
  if (!idInput || !passwordInput || !loginButton) {
    throw new Error("로그인 입력칸 또는 로그인 버튼을 찾지 못했습니다. https://www.dhlottery.co.kr/login 페이지에서 실행하세요.");
  }
  idInput.removeAttribute("readonly");
  passwordInput.removeAttribute("readonly");
  setValue(idInput, userId);
  setValue(passwordInput, password);
  window.setTimeout(() => loginButton.click(), 900);
})();`;
}
els.controls.addEventListener("submit", async (event) => { event.preventDefault(); try { const params = buildQuery(); if (!($("#seed").value || "").trim()) params.set("seed", String(Date.now())); await loadDashboard(params); } catch (error) { setStatus(error.message || String(error), "error"); } });
els.officialLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const userId = els.officialUserId.value.trim();
  const password = els.officialPassword.value;
  if (!userId || !password) {
    setStatus("동행복권 아이디와 비밀번호를 입력하세요.", "error");
    return;
  }
  saveStoredCredentials();
  els.fillOfficialLogin.disabled = true;
  try {
    const response = await fetch("api/official-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, password }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "동행복권 로그인 입력 자동 채움 실패");
    setStatus(payload.message || "동행복권 로그인 입력 후 로그인 버튼을 클릭했습니다.");
  } catch (error) {
    setStatus(error.message || String(error), "error");
  } finally {
    els.fillOfficialLogin.disabled = false;
  }
});
els.copyLoginScript.addEventListener("click", async () => {
  const userId = els.officialUserId.value.trim();
  const password = els.officialPassword.value;
  if (!userId || !password) {
    setStatus("동행복권 아이디와 비밀번호를 입력하세요.", "error");
    return;
  }
  saveStoredCredentials();
  await copyText(buildOfficialLoginScript(userId, password), "로그인 콘솔 스크립트를 복사했습니다. 동행복권 로그인 페이지 콘솔에서 실행하세요.");
});
els.runOfficialFlow.addEventListener("click", async () => {
  const userId = els.officialUserId.value.trim();
  const password = els.officialPassword.value;
  const tickets = (state.payload?.tickets || [])
    .slice(0, DEFAULT_BATCH_COUNT)
    .map((ticket) => normalizeTicketNumbers(ticket.numbers))
    .filter((numbers) => numbers.length === 6);
  if (!userId || !password) {
    setStatus("동행복권 아이디와 비밀번호를 입력하세요.", "error");
    return;
  }
  if (tickets.length !== DEFAULT_BATCH_COUNT) {
    setStatus("로그인 후 자동 마킹은 추천번호 5세트가 필요합니다. 세트 수를 5로 생성하세요.", "error");
    return;
  }
  saveStoredCredentials();
  els.runOfficialFlow.disabled = true;
  try {
    if (!isLocalAutomationAvailable()) {
      if (!state.batchScript) prepareBatchScript(state.payload?.tickets || []);
      if (!state.batchScript) throw new Error("5세트 콘솔 스크립트를 만들지 못했습니다. 추천번호를 다시 생성하세요.");
      els.officialScript.value = state.batchScript;
      await copyText(state.batchScript, "GitHub Pages에서는 로컬 자동화 API를 사용할 수 없어 5세트 콘솔 스크립트를 복사했습니다. 공식 구매 페이지 콘솔에서 실행하세요.");
      window.open(OFFICIAL_MARKING_URL, "_blank", "noopener,noreferrer");
      return;
    }
    const response = await fetch("api/official-purchase-flow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, password, tickets }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "로그인 후 5세트 마킹 실행 실패");
    await loadMarkingHistory();
    setStatus(payload.message || "로그인 후 추천번호 5세트 마킹을 완료했습니다. 구매 버튼은 직접 확인 후 누르세요.");
  } catch (error) {
    setStatus(error.message || String(error), "error");
  } finally {
    els.runOfficialFlow.disabled = false;
  }
});
els.openOfficial.addEventListener("click", () => {
  window.location.assign(OFFICIAL_URL);
});
els.copyConsoleScript.addEventListener("click", async () => { if (state.activeScript) await copyText(state.activeScript, "콘솔 스크립트를 복사했습니다. 공식 LO40 페이지 콘솔에서 실행하세요."); });
els.copyBatchScript.addEventListener("click", async () => { if (state.batchScript) { els.officialScript.value = state.batchScript; await copyText(state.batchScript, "5세트 콘솔 스크립트를 복사했습니다."); } });
els.copyAllTickets.addEventListener("click", async () => {
  const text = (state.payload?.tickets || []).map((ticket) => `${ticket.ticket_no}세트 ${formatNumbers(ticket.numbers)}`).join("\n");
  if (text) {
    const copied = await lottoBrowser.copy(text, $("#ticketCopyText"));
    setStatus(copied ? "전체 추천번호를 복사했습니다." : "선택된 추천번호를 길게 눌러 복사하세요.");
  }
});
els.autoMarkOfficial.addEventListener("click", async () => { if (!state.activeTicket) return; els.autoMarkOfficial.disabled = true; try { const response = await fetch("api/official-marking", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket_no: state.activeTicket.ticketNo, numbers: state.activeTicket.numbers }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "자동 마킹 실행 실패"); await loadMarkingHistory(); setStatus(`Ticket ${payload.ticket_no || state.activeTicket.ticketNo} 자동 마킹 완료`); } catch (error) { setStatus(error.message || String(error), "error"); } finally { els.autoMarkOfficial.disabled = false; } });
els.refreshMarkingHistory.addEventListener("click", async () => { try { await loadMarkingHistory(); setStatus("마킹 이력을 새로고침했습니다."); } catch (error) { setStatus(error.message || String(error), "error"); } });
els.drawSearch.addEventListener("input", () => { if (state.payload) renderDrawHistory(state.payload.all_draws || []); });
if (isLocalAutomationAvailable()) {
  loadStoredCredentials();
  loadMarkingHistory().catch((error) => setStatus(error.message || String(error), "error"));
}
loadDashboard().catch((error) => setStatus(error.message || String(error), "error"));









