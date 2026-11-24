const PENSION_CREDENTIAL_STORAGE_KEY = "lottobang.pensionOfficialCredentials";
const DEFAULT_PENSION_BATCH_COUNT = 5;

const $ = (selector) => document.querySelector(selector);
const state = { payload: null };
const els = {
  controls: $("#pensionControls"),
  sets: $("#pensionSets"),
  seed: $("#pensionSeed"),
  latestRound: $("#pensionLatestRound"),
  latestFirstPrize: $("#pensionLatestFirstPrize"),
  latestBonus: $("#pensionLatestBonus"),
  generatedAt: $("#pensionGeneratedAt"),
  coverage: $("#pensionCoverage"),
  dataStatus: $("#pensionDataStatus"),
  tickets: $("#pensionTickets"),
  copyTickets: $("#copyPensionTickets"),
  rules: $("#pensionRules"),
  backtestSummary: $("#pensionBacktestSummary"),
  digitSignals: $("#pensionDigitSignals"),
  drawSearch: $("#pensionDrawSearch"),
  drawHistory: $("#pensionDrawHistory"),
  status: $("#pensionStatusMessage"),
  officialLoginForm: $("#pensionOfficialLoginForm"),
  officialUserId: $("#pensionOfficialUserId"),
  officialPassword: $("#pensionOfficialPassword"),
  runOfficialFlow: $("#runPensionOfficialFlow"),
  refreshMarkingHistory: $("#refreshPensionMarkingHistory"),
  markingHistory: $("#pensionMarkingHistory"),
};

function setStatus(message, tone = "info") {
  if (!message) {
    els.status.hidden = true;
    els.status.textContent = "";
    return;
  }
  els.status.hidden = false;
  els.status.dataset.tone = tone;
  els.status.textContent = message;
  window.setTimeout(() => {
    if (els.status.textContent === message) els.status.hidden = true;
  }, 4200);
}

function buildQuery() {
  const params = new URLSearchParams();
  params.set("sets", els.sets.value || "5");
  const seed = (els.seed.value || "").trim();
  if (seed) params.set("seed", seed);
  return params;
}

function formatPensionTicket(ticket) {
  return `${ticket.group}조 ${ticket.digits.map(Number).join("")}`;
}

function formatLatestPensionFirstPrize(draw) {
  if (!draw) return "-";
  return `${draw.group}조 ${draw.digits.map(Number).join("")}`;
}

function renderPensionNumber(ticket) {
  return `
    <div class="pension-ticket">
      <span class="pension-group">${ticket.group}조</span>
      <div class="balls">${ticket.digits.map((digit) => `<span class="ball n${(Number(digit) % 5) + 1}">${digit}</span>`).join("")}</div>
    </div>
  `;
}

function loadStoredCredentials() {
  try {
    const saved = JSON.parse(localStorage.getItem(PENSION_CREDENTIAL_STORAGE_KEY) || "{}");
    if (saved.userId) els.officialUserId.value = saved.userId;
    if (saved.password) els.officialPassword.value = saved.password;
  } catch {
    localStorage.removeItem(PENSION_CREDENTIAL_STORAGE_KEY);
  }
}

function saveStoredCredentials() {
  const userId = els.officialUserId.value.trim();
  const password = els.officialPassword.value;
  if (!userId && !password) {
    localStorage.removeItem(PENSION_CREDENTIAL_STORAGE_KEY);
    return;
  }
  localStorage.setItem(PENSION_CREDENTIAL_STORAGE_KEY, JSON.stringify({ userId, password }));
}

function isLocalAutomationAvailable() {
  return !lottoBrowser.isPages && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(location.hostname);
}

function buildStaticPensionVariant(snapshot, params) {
  const sets = Math.max(1, Math.min(10, Number(params.get("sets")) || 5));
  const seed = params.has("seed") ? Number(params.get("seed")) : Date.now();
  const random = lottoBrowser.random(seed);
  const groupWeights = snapshot.strategy.group_weights || [];
  const digitWeights = snapshot.strategy.digit_weights || [];
  const tickets = [];
  const used = new Set();

  function pick(weights, key, min, size) {
    if (!weights?.length) return min + Math.floor(random() * size);
    const total = weights.reduce((sum, entry) => sum + entry.weight, 0);
    if (total <= 0) return min + Math.floor(random() * size);
    let remaining = random() * total;
    for (const entry of weights) {
      remaining -= entry.weight;
      if (remaining < 0) return entry[key];
    }
    return weights[weights.length - 1][key];
  }

  while (tickets.length < sets) {
    const exploration = sets > 1 && tickets.length === sets - 1;
    const group = pick(exploration ? null : groupWeights, "group", 1, 5);
    const digits = Array.from({ length: 6 }, (_, index) =>
      pick(exploration ? null : digitWeights[index]?.digits, "digit", 0, 10));
    const key = group + digits.join("");
    if (used.has(key)) continue;
    used.add(key);
    const groupWeight = groupWeights.find((entry) => entry.group === group)?.weight ?? 0.2;
    const digitScore = digits.reduce((sum, digit, index) =>
      sum + (digitWeights[index]?.digits.find((entry) => entry.digit === digit)?.weight ?? 0.1), 0);
    tickets.push({
      ticket_no: tickets.length + 1,
      group,
      digits,
      score: (groupWeight + digitScore) / 7,
      mode: exploration ? "exploration" : "model",
    });
  }

  return {
    ...snapshot,
    generated_at_utc: new Date().toISOString(),
    defaults: { sets_count: sets, seed },
    strategy: { ...snapshot.strategy, backtest: null },
    tickets,
  };
}

async function loadPension(params = buildQuery()) {
  setStatus("연금복권 추천 데이터를 불러오는 중입니다.");
  const response = lottoBrowser.isPages ? null : await fetch(`api/pension-dashboard?${params}`).catch(() => null);
  if (response?.ok) {
    state.payload = await response.json();
  } else {
    if (!state.snapshot) {
      const snapshot = await fetch("data/pension_dashboard.json", { cache: "no-cache" });
      if (!snapshot.ok) throw new Error("연금복권 추천 데이터를 불러오지 못했습니다.");
      state.snapshot = await snapshot.json();
    }
    state.payload = buildStaticPensionVariant(state.snapshot, params);
  }
  render(state.payload);
  setStatus("");
}

function render(payload) {
  const coverage = payload.strategy.coverage;
  els.latestRound.textContent = payload.latest_draw ? `${payload.latest_draw.round_no}회` : "-";
  els.latestFirstPrize.textContent = formatLatestPensionFirstPrize(payload.latest_draw);
  els.latestBonus.textContent = payload.latest_draw?.bonus_digits
    ? `보너스 각조 ${payload.latest_draw.bonus_digits.map(Number).join("")}`
    : "보너스 -";
  els.generatedAt.textContent = `생성 ${new Date(payload.generated_at_utc).toLocaleString("ko-KR")} · seed ${payload.defaults.seed}`;
  els.coverage.textContent = coverage.draws ? `${coverage.from_round}-${coverage.to_round}회` : "공식 데이터 없음";
  els.dataStatus.textContent = payload.data_status.message;
  els.sets.value = payload.defaults.sets_count;
  renderTickets(payload.tickets || []);
  renderStrategy(payload.strategy, payload.tickets.length);
  renderDrawHistory(payload.all_draws || []);
}

function renderTickets(tickets) {
  els.copyTickets.disabled = !tickets.length;
  els.tickets.innerHTML = tickets.map((ticket) => `
    <article class="ticket-card">
      <div class="ticket-head">
        <h3>Set ${ticket.ticket_no}</h3>
        <span class="score">${ticket.mode === "exploration" ? "균등 탐색" : `적합도 ${Number(ticket.score).toFixed(4)}`}</span>
      </div>
      ${renderPensionNumber(ticket)}
    </article>
  `).join("");
}

function renderStrategy(strategy, setsCount) {
  els.rules.innerHTML = strategy.rules.map((rule) => `<span class="chip">${rule}</span>`).join("");
  const backtest = strategy.backtest || {};
  const firstPrizePercent = (setsCount / 5_000_000) * 100;
  els.backtestSummary.innerHTML = (backtest.rounds ? `
    <article><strong>${backtest.rounds}회</strong><span>백테스트</span></article>
    <article><strong>${backtest.best_digit_matches || 0}개</strong><span>최고 자리 적중</span></article>
    <article><strong>${backtest.exact_first_prize_count || 0}회</strong><span>조+6자리 적중</span></article>
  ` : "") + `<article><strong>${firstPrizePercent.toFixed(6)}%</strong><span>회차당 이론 1등 확률</span></article>`;
  els.digitSignals.innerHTML = strategy.digit_weights.map((position) => {
    const top = position.digits.slice(0, 4).map((item) => `${item.digit}(${Number(item.weight).toFixed(2)})`).join(", ");
    return `
      <div class="signal-row">
        <strong>${position.position}자리</strong>
        <div class="signal-bar"><span style="width:${Math.min(100, 30 + Number(position.digits[0]?.weight || 0) * 60)}%"></span></div>
        <small>${top}</small>
      </div>
    `;
  }).join("");
}

function renderDrawHistory(draws) {
  const query = (els.drawSearch.value || "").trim().toLowerCase();
  const filtered = draws
    .filter((draw) => !query || String(draw.round_no).includes(query) || String(draw.draw_date).toLowerCase().includes(query))
    .slice(0, 80);

  if (!filtered.length) {
    els.drawHistory.innerHTML = `<p class="muted">연금복권 공식 과거 데이터 파일이 아직 없습니다. data/pension720_draws.json을 추가하면 이 영역에 표시됩니다.</p>`;
    return;
  }
  els.drawHistory.innerHTML = filtered.map((draw) => `
    <article class="draw-card">
      <div class="draw-head">
        <h3>${draw.round_no}회</h3>
        <span class="muted">${draw.draw_date}</span>
      </div>
      ${renderPensionNumber(draw)}
      ${draw.bonus_digits ? `<p class="muted">보너스 ${draw.bonus_digits.join("")}</p>` : ""}
    </article>
  `).join("");
}

async function loadMarkingHistory() {
  const response = await fetch("api/purchase-history?limit=80");
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "구매 이력을 불러오지 못했습니다.");
  renderMarkingHistory((payload.history || []).filter((entry) => entry.source === "official-pension-purchase-flow"));
}

function renderMarkingHistory(history) {
  if (!history.length) {
    els.markingHistory.innerHTML = `<p class="muted">아직 저장된 연금복권 구매 이력이 없습니다.</p>`;
    return;
  }
  els.markingHistory.innerHTML = history.map((entry) => {
    const markedAt = entry.marked_at_utc ? new Date(entry.marked_at_utc).toLocaleString("ko-KR") : "-";
    const purchasedAt = entry.purchased_at_utc ? new Date(entry.purchased_at_utc).toLocaleString("ko-KR") : "";
    const purchased = entry.status === "purchased";
    const tickets = (entry.tickets || []).map((ticket) => {
      const label = ticket.digits?.length === 6 ? `${ticket.group}조 ${ticket.digits.join("")}` : "-";
      return `<div class="history-ticket"><span>Set ${ticket.ticket_no}</span><strong>${label}</strong></div>`;
    }).join("");
    const status = `<span class="history-status ${purchased ? "is-purchased" : ""}">${purchased ? "구매 완료" : "마킹 완료"}</span>`;
    const action = purchased ? `<p class="muted">구매 기록 ${purchasedAt}</p>` : `<div class="history-actions"><button type="button" class="ghost confirm-purchase-history" data-history-id="${entry.id}">실제 구매 완료로 기록</button></div>`;
    return `<article class="marking-history-card"><div class="draw-head"><div><h3>연금복권 5세트 마킹</h3>${status}</div><span class="muted">${markedAt}</span></div>${tickets}${action}</article>`;
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

function buildOfficialTickets() {
  return (state.payload?.tickets || [])
    .slice(0, DEFAULT_PENSION_BATCH_COUNT)
    .map((ticket) => ({
      group: Number(ticket.group),
      digits: (ticket.digits || []).map(Number),
    }))
    .filter((ticket) => Number.isInteger(ticket.group) && ticket.group >= 1 && ticket.group <= 5 && ticket.digits.length === 6);
}

els.controls.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const params = buildQuery();
    if (!(els.seed.value || "").trim()) params.set("seed", String(Date.now()));
    await loadPension(params);
  } catch (error) {
    setStatus(error.message || String(error), "error");
  }
});

els.copyTickets.addEventListener("click", async () => {
  const text = (state.payload?.tickets || [])
    .map((ticket) => `Set ${ticket.ticket_no}: ${formatPensionTicket(ticket)}`)
    .join("\n");
  if (text) {
    const copied = await lottoBrowser.copy(text, $("#pensionCopyText"));
    setStatus(copied ? "연금복권 추천번호를 복사했습니다." : "선택된 추천번호를 길게 눌러 복사하세요.");
  }
});

els.officialLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const userId = els.officialUserId.value.trim();
  const password = els.officialPassword.value;
  const tickets = buildOfficialTickets();

  if (!userId || !password) {
    setStatus("동행복권 아이디와 비밀번호를 입력하세요.", "error");
    return;
  }
  if (tickets.length !== DEFAULT_PENSION_BATCH_COUNT) {
    setStatus("연금복권 공식 마킹은 추천번호 5세트가 필요합니다. 세트 수를 5로 생성하세요.", "error");
    return;
  }
  if (!isLocalAutomationAvailable()) {
    setStatus("연금복권 자동마킹은 로컬 서버에서만 실행할 수 있습니다.", "error");
    return;
  }

  saveStoredCredentials();
  els.runOfficialFlow.disabled = true;
  try {
    const response = await fetch("api/official-pension-purchase-flow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, password, tickets }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "연금복권 로그인 후 5세트 마킹 실행 실패");
    await loadMarkingHistory();
    setStatus(payload.message || "연금복권 5세트 마킹을 완료했습니다. 구매 버튼은 직접 확인 후 누르세요.");
  } catch (error) {
    setStatus(error.message || String(error), "error");
  } finally {
    els.runOfficialFlow.disabled = false;
  }
});

els.refreshMarkingHistory.addEventListener("click", async () => {
  try {
    await loadMarkingHistory();
    setStatus("연금복권 마킹 이력을 새로고침했습니다.");
  } catch (error) {
    setStatus(error.message || String(error), "error");
  }
});

els.drawSearch.addEventListener("input", () => {
  if (state.payload) renderDrawHistory(state.payload.all_draws || []);
});

if (isLocalAutomationAvailable()) {
  loadStoredCredentials();
  loadMarkingHistory().catch((error) => setStatus(error.message || String(error), "error"));
}
loadPension().catch((error) => setStatus(error.message || String(error), "error"));
