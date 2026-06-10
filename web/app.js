const OFFICIAL_URL = "https://www.dhlottery.co.kr/";
const OFFICIAL_MARKING_URL = "https://ol.dhlottery.co.kr/olotto/game/game645.do";
const DEFAULT_BATCH_COUNT = 5;
const CREDENTIAL_STORAGE_KEY = "lottobang.officialCredentials";
const state = { payload: null, activeTicket: null, activeScript: "", batchScript: "" };
const $ = (selector) => document.querySelector(selector);
const els = {
  controls: $("#controls"), generatedAt: $("#generatedAt"), latestRound: $("#latestRound"), coverage: $("#coverage"), tickets: $("#tickets"),
  markingSummary: $("#markingSummary"), markingBoard: $("#markingBoard"), officialScript: $("#officialScript"), openOfficial: $("#openOfficial"),
  officialLoginForm: $("#officialLoginForm"), officialUserId: $("#officialUserId"), officialPassword: $("#officialPassword"), fillOfficialLogin: $("#fillOfficialLogin"), runOfficialFlow: $("#runOfficialFlow"), copyLoginScript: $("#copyLoginScript"),
  autoMarkOfficial: $("#autoMarkOfficial"), copyConsoleScript: $("#copyConsoleScript"), copyBatchScript: $("#copyBatchScript"), copyAllTickets: $("#copyAllTickets"),
  refreshMarkingHistory: $("#refreshMarkingHistory"), markingHistory: $("#markingHistory"),
  rules: $("#rules"), topNumbers: $("#topNumbers"), drawHistory: $("#drawHistory"), drawSearch: $("#drawSearch"), statusMessage: $("#statusMessage"),
};
function ballTone(n) { if (n <= 10) return "n1"; if (n <= 20) return "n2"; if (n <= 30) return "n3"; if (n <= 40) return "n4"; return "n5"; }
function normalizeTicketNumbers(numbers) { return [...new Set((numbers || []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 45))].sort((a, b) => a - b); }
function formatNumbers(numbers) { return normalizeTicketNumbers(numbers).map((n) => String(n).padStart(2, "0")).join(", "); }
function renderBalls(numbers) { return `<div class="balls">${normalizeTicketNumbers(numbers).map((n) => `<span class="ball ${ballTone(n)}">${String(n).padStart(2, "0")}</span>`).join("")}</div>`; }
function setStatus(message, tone = "info") { if (!message) { els.statusMessage.hidden = true; els.statusMessage.textContent = ""; return; } els.statusMessage.hidden = false; els.statusMessage.dataset.tone = tone; els.statusMessage.textContent = message; window.setTimeout(() => { if (els.statusMessage.textContent === message) els.statusMessage.hidden = true; }, 4200); }
function buildQuery() { const p = new URLSearchParams(); p.set("sets", $("#sets").value || "5"); const seed = ($("#seed").value || "").trim(); if (seed) p.set("seed", seed); return p; }
function loadStoredCredentials() { try { const saved = JSON.parse(localStorage.getItem(CREDENTIAL_STORAGE_KEY) || "{}"); if (saved.userId) els.officialUserId.value = saved.userId; if (saved.password) els.officialPassword.value = saved.password; } catch { localStorage.removeItem(CREDENTIAL_STORAGE_KEY); } }
function saveStoredCredentials() { const userId = els.officialUserId.value.trim(); const password = els.officialPassword.value; if (!userId && !password) { localStorage.removeItem(CREDENTIAL_STORAGE_KEY); return; } localStorage.setItem(CREDENTIAL_STORAGE_KEY, JSON.stringify({ userId, password })); }
async function loadDashboard(params = buildQuery()) { setStatus("추천 데이터를 불러오는 중입니다."); let res = await fetch(`api/dashboard?${params.toString()}`).catch(() => null); let payload; if (res && res.ok) { payload = await res.json(); } else { res = await fetch("data/dashboard.json"); payload = await res.json(); if (!res.ok) throw new Error(payload.error || "대시보드 데이터를 불러오지 못했습니다."); payload = buildStaticDashboardVariant(payload, params); } state.payload = payload; renderDashboard(payload); setStatus(""); }
function seededRandom(seed) { let value = Number(seed) || Date.now(); return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296; }; }
function weightedPick(pool, rng, excluded) { const available = pool.filter((item) => !excluded.has(item.number)); const total = available.reduce((sum, item) => sum + Math.max(Number(item.weight) || 0.01, 0.01), 0); let cursor = rng() * total; for (const item of available) { cursor -= Math.max(Number(item.weight) || 0.01, 0.01); if (cursor <= 0) return item.number; } return available[available.length - 1]?.number || 1; }
function scoreStaticTicket(numbers, weights) { return normalizeTicketNumbers(numbers).reduce((sum, number) => sum + (weights.get(number) || 0.01), 0) / 6; }
function isBalancedTicket(numbers) { const sorted = normalizeTicketNumbers(numbers); const odd = sorted.filter((n) => n % 2).length; const sum = sorted.reduce((acc, n) => acc + n, 0); const low = sorted.filter((n) => n <= 22).length; const buckets = new Set(sorted.map((n) => Math.floor((n - 1) / 10))).size; return sorted.length === 6 && odd >= 2 && odd <= 4 && sum >= 90 && sum <= 200 && low >= 1 && low <= 5 && buckets >= 3; }
function buildStaticDashboardVariant(basePayload, params) {
  const seed = Number(params.get("seed")) || Date.now();
  const sets = Math.max(1, Math.min(10, Number(params.get("sets")) || basePayload.defaults?.sets_count || 5));
  const rng = seededRandom(seed);
  const topNumbers = basePayload.strategy?.top_numbers || [];
  const weightMap = new Map(topNumbers.map((item) => [Number(item.number), Number(item.weight) || 0.01]));
  const pool = Array.from({ length: 45 }, (_, index) => {
    const number = index + 1;
    return { number, weight: weightMap.get(number) || 0.35 + rng() * 0.2 };
  });
  const tickets = [];
  const seen = new Set();
  for (let ticketNo = 1; ticketNo <= sets; ticketNo += 1) {
    let numbers = [];
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const selected = new Set();
      while (selected.size < 6) selected.add(weightedPick(pool, rng, selected));
      numbers = normalizeTicketNumbers([...selected]);
      const key = numbers.join("-");
      const overlaps = tickets.map((ticket) => ticket.numbers.filter((n) => selected.has(n)).length);
      if (isBalancedTicket(numbers) && !seen.has(key) && overlaps.every((count) => count <= 3)) {
        seen.add(key);
        break;
      }
    }
    tickets.push({ ticket_no: ticketNo, numbers, score: scoreStaticTicket(numbers, weightMap) });
  }
  return {
    ...basePayload,
    generated_at_utc: new Date().toISOString(),
    defaults: { ...(basePayload.defaults || {}), sets_count: sets, seed },
    tickets,
  };
}
function renderDashboard(payload) { const range = payload.strategy.frequency_coverage; els.latestRound.textContent = `${payload.latest_draw.round_no}회`; els.generatedAt.textContent = `생성 ${new Date(payload.generated_at_utc).toLocaleString("ko-KR")} · seed ${payload.defaults.seed}`; els.coverage.textContent = `${range.from_round}-${range.to_round}회`; $("#sets").value = payload.defaults.sets_count; renderTickets(payload.tickets || []); renderStrategy(payload.strategy); renderDrawHistory(payload.all_draws || []); prepareBatchScript(payload.tickets || []); if (payload.tickets?.length) selectTicket(payload.tickets[0]); }
function renderTickets(tickets) { els.copyAllTickets.disabled = !tickets.length; els.tickets.innerHTML = tickets.map((t) => `<article class="ticket-card" data-ticket="${t.ticket_no}"><div class="ticket-head"><h3>Ticket ${t.ticket_no}</h3><span class="score">적합도 ${Number(t.score).toFixed(4)}</span></div>${renderBalls(t.numbers)}<button type="button" class="ghost select-ticket" data-ticket="${t.ticket_no}">이 번호 사용</button></article>`).join(""); els.tickets.querySelectorAll(".select-ticket").forEach((b) => b.addEventListener("click", () => { const t = state.payload.tickets.find((item) => String(item.ticket_no) === b.dataset.ticket); if (t) selectTicket(t); })); }
function renderStrategy(strategy) { els.rules.innerHTML = strategy.rules.map((r) => `<span class="chip">${r}</span>`).join(""); const max = Math.max(...strategy.top_numbers.map((i) => i.weight), 1); els.topNumbers.innerHTML = strategy.top_numbers.map((i) => `<div class="signal-row"><strong>${String(i.number).padStart(2, "0")}</strong><div class="signal-bar"><span style="width:${Math.round((i.weight / max) * 100)}%"></span></div><small>${Number(i.weight).toFixed(3)}</small></div>`).join(""); }
function renderDrawHistory(draws) { const q = (els.drawSearch.value || "").trim().toLowerCase(); const filtered = draws.filter((d) => !q || String(d.round_no).includes(q) || String(d.draw_date).toLowerCase().includes(q)).slice(0, 80); els.drawHistory.innerHTML = filtered.map((d) => `<article class="draw-card"><div class="draw-head"><h3>${d.round_no}회</h3><span class="muted">${d.draw_date}</span></div>${renderBalls(d.numbers)}<p class="muted">보너스 ${String(d.bonus).padStart(2, "0")}</p></article>`).join(""); }
async function loadMarkingHistory() { const res = await fetch("api/marking-history?limit=50"); const payload = await res.json(); if (!res.ok) throw new Error(payload.error || "마킹 이력을 불러오지 못했습니다."); renderMarkingHistory(payload.history || []); }
function renderMarkingHistory(history) {
  if (!history.length) {
    els.markingHistory.innerHTML = `<p class="muted">아직 저장된 마킹 이력이 없습니다.</p>`;
    return;
  }
  els.markingHistory.innerHTML = history.map((entry) => {
    const markedAt = entry.marked_at_utc ? new Date(entry.marked_at_utc).toLocaleString("ko-KR") : "-";
    const tickets = (entry.tickets || []).map((ticket) => `<div class="history-ticket"><span>Set ${ticket.ticket_no}</span>${renderBalls(ticket.numbers || [])}</div>`).join("");
    const source = entry.source === "official-purchase-flow" ? "로그인 후 5세트 마킹" : "단건 마킹";
    return `<article class="marking-history-card"><div class="draw-head"><h3>${source}</h3><span class="muted">${markedAt}</span></div>${tickets}</article>`;
  }).join("");
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

async function copyText(text, message) { await navigator.clipboard.writeText(text); setStatus(message); }
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
  if (!tickets.length) {
    setStatus("마킹할 추천번호가 없습니다. 추천번호를 먼저 생성하세요.", "error");
    return;
  }
  saveStoredCredentials();
  els.runOfficialFlow.disabled = true;
  try {
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
els.copyAllTickets.addEventListener("click", async () => { const text = (state.payload?.tickets || []).map((ticket) => `Ticket ${ticket.ticket_no}: ${formatNumbers(ticket.numbers)}`).join("\n"); if (text) await copyText(text, "전체 추천번호를 복사했습니다."); });
els.autoMarkOfficial.addEventListener("click", async () => { if (!state.activeTicket) return; els.autoMarkOfficial.disabled = true; try { const response = await fetch("api/official-marking", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket_no: state.activeTicket.ticketNo, numbers: state.activeTicket.numbers }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "자동 마킹 실행 실패"); await loadMarkingHistory(); setStatus(`Ticket ${payload.ticket_no || state.activeTicket.ticketNo} 자동 마킹 완료`); } catch (error) { setStatus(error.message || String(error), "error"); } finally { els.autoMarkOfficial.disabled = false; } });
els.refreshMarkingHistory.addEventListener("click", async () => { try { await loadMarkingHistory(); setStatus("마킹 이력을 새로고침했습니다."); } catch (error) { setStatus(error.message || String(error), "error"); } });
els.drawSearch.addEventListener("input", () => { if (state.payload) renderDrawHistory(state.payload.all_draws || []); });
loadStoredCredentials();
loadDashboard().catch((error) => setStatus(error.message || String(error), "error"));
loadMarkingHistory().catch((error) => setStatus(error.message || String(error), "error"));









