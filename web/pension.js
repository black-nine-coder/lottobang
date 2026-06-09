const $ = (selector) => document.querySelector(selector);
const state = { payload: null };
const els = {
  controls: $("#pensionControls"),
  sets: $("#pensionSets"),
  seed: $("#pensionSeed"),
  latestRound: $("#pensionLatestRound"),
  generatedAt: $("#pensionGeneratedAt"),
  coverage: $("#pensionCoverage"),
  dataStatus: $("#pensionDataStatus"),
  tickets: $("#pensionTickets"),
  copyTickets: $("#copyPensionTickets"),
  rules: $("#pensionRules"),
  digitSignals: $("#pensionDigitSignals"),
  drawSearch: $("#pensionDrawSearch"),
  drawHistory: $("#pensionDrawHistory"),
  status: $("#pensionStatusMessage"),
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

async function loadPension(params = buildQuery()) {
  setStatus("연금복권 추천 데이터를 불러오는 중입니다.");
  let response = await fetch(`api/pension-dashboard?${params.toString()}`).catch(() => null);
  if (!response || !response.ok) response = await fetch("data/pension_dashboard.json");
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "연금복권 추천 데이터를 불러오지 못했습니다.");
  state.payload = payload;
  render(payload);
  setStatus("");
}

function render(payload) {
  const coverage = payload.strategy.coverage;
  els.latestRound.textContent = payload.latest_draw ? `${payload.latest_draw.round_no}회` : "-";
  els.generatedAt.textContent = `생성 ${new Date(payload.generated_at_utc).toLocaleString("ko-KR")} · seed ${payload.defaults.seed}`;
  els.coverage.textContent = coverage.draws ? `${coverage.from_round}-${coverage.to_round}회` : "공식 데이터 없음";
  els.dataStatus.textContent = payload.data_status.message;
  els.sets.value = payload.defaults.sets_count;
  renderTickets(payload.tickets || []);
  renderStrategy(payload.strategy);
  renderDrawHistory(payload.all_draws || []);
}

function renderTickets(tickets) {
  els.copyTickets.disabled = !tickets.length;
  els.tickets.innerHTML = tickets.map((ticket) => `
    <article class="ticket-card">
      <div class="ticket-head">
        <h3>Set ${ticket.ticket_no}</h3>
        <span class="score">적합도 ${Number(ticket.score).toFixed(4)}</span>
      </div>
      ${renderPensionNumber(ticket)}
    </article>
  `).join("");
}

function renderPensionNumber(ticket) {
  return `
    <div class="pension-ticket">
      <span class="pension-group">${ticket.group}조</span>
      <div class="balls">${ticket.digits.map((digit) => `<span class="ball n${(Number(digit) % 5) + 1}">${digit}</span>`).join("")}</div>
    </div>
  `;
}

function renderStrategy(strategy) {
  els.rules.innerHTML = strategy.rules.map((rule) => `<span class="chip">${rule}</span>`).join("");
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
  const filtered = draws.filter((draw) => !query || String(draw.round_no).includes(query) || String(draw.draw_date).toLowerCase().includes(query)).slice(0, 80);
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

async function copyText(text, message) {
  await navigator.clipboard.writeText(text);
  setStatus(message);
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
    .map((ticket) => `Set ${ticket.ticket_no}: ${ticket.group}조 ${ticket.digits.join("")}`)
    .join("\n");
  if (text) await copyText(text, "연금복권 추천번호를 복사했습니다.");
});

els.drawSearch.addEventListener("input", () => {
  if (state.payload) renderDrawHistory(state.payload.all_draws || []);
});

loadPension().catch((error) => setStatus(error.message || String(error), "error"));
