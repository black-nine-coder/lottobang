const $ = (selector) => document.querySelector(selector);

const els = {
  form: $("#storeControls"),
  generatedAt: $("#storesGeneratedAt"),
  coverage: $("#storesCoverage"),
  matchedRounds: $("#matchedRounds"),
  uniqueAddresses: $("#uniqueAddresses"),
  status: $("#storesStatusMessage"),
  mapCanvas: $("#mapCanvas"),
  markerDetail: $("#markerDetail"),
  fitMap: $("#fitMap"),
  rankings: $("#storeRankings"),
  rounds: $("#storeRounds"),
  regions: $("#storeRegions"),
  addresses: $("#storeAddresses"),
  startRound: $("#startRound"),
  endRound: $("#endRound"),
  query: $("#query"),
  selectionType: $("#selectionType"),
  roundsLimit: $("#roundsLimit"),
};

let map = null;
let markerLayer = null;
let markerBounds = null;
let latestMarkers = [];

function setStatus(message = "", tone = "info") {
  els.status.hidden = !message;
  els.status.textContent = message;
  els.status.dataset.tone = tone;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ko-KR");
}

function buildQuery() {
  const data = new FormData(els.form);
  const params = new URLSearchParams();
  params.set("start_round", data.get("start_round") || "1");
  params.set("rounds_limit", data.get("rounds_limit") || "40");
  params.set("selection_type", data.get("selection_type") || "all");
  if (data.get("end_round")) params.set("end_round", data.get("end_round"));
  if (data.get("query")) params.set("query", String(data.get("query")).trim());
  return params;
}

async function loadStoreLab(params = buildQuery()) {
  setStatus("가맹점 데이터를 불러오는 중입니다.");
  let response = await fetch(`api/store-lab?${params.toString()}`).catch(() => null);
  if (!response || !response.ok) response = await fetch("data/store_lab.json");
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "가맹점 데이터를 불러오지 못했습니다.");
  render(payload);
  setStatus("");
}

function ensureMap() {
  if (!window.L) {
    throw new Error("Leaflet 지도 라이브러리를 불러오지 못했습니다. 네트워크 또는 CDN 차단 여부를 확인하세요.");
  }
  if (map) return map;
  map = window.L.map(els.mapCanvas, { preferCanvas: true }).setView([36.35, 127.85], 7);
  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  markerLayer = window.L.layerGroup().addTo(map);
  return map;
}

function render(payload) {
  els.generatedAt.textContent = formatDate(payload.generated_at_utc);
  els.coverage.textContent = payload.statistics.coverage.rounds
    ? `${payload.statistics.coverage.from_round}회부터 ${payload.statistics.coverage.to_round}회까지`
    : "조건에 맞는 회차 없음";
  els.matchedRounds.textContent = `${payload.summary.matched_rounds}회`;
  els.uniqueAddresses.textContent = `${payload.summary.unique_addresses}곳`;
  els.startRound.value = payload.filters.start_round;
  els.endRound.value = payload.filters.end_round;
  els.query.value = payload.filters.query || "";
  els.selectionType.value = payload.filters.selection_type || "all";
  els.roundsLimit.value = payload.filters.rounds_limit;

  renderStats(els.regions, payload.statistics.top_regions, "region");
  renderStats(els.addresses, payload.statistics.top_addresses, "address");
  renderRankings(payload.statistics.top_stores || []);
  renderRounds(payload.rounds || []);
  renderMap(payload.markers || []);
}

function renderStats(container, rows, key) {
  if (!rows?.length) {
    container.innerHTML = `<p class="muted">표시할 통계가 없습니다.</p>`;
    return;
  }
  const max = Math.max(...rows.map((row) => row.count), 1);
  container.innerHTML = rows.map((row) => `
    <div class="signal-row">
      <strong>${escapeHtml(row[key])}</strong>
      <div class="signal-bar"><span style="width:${Math.round((row.count / max) * 100)}%"></span></div>
      <small>${row.count}회</small>
    </div>
  `).join("");
}

function renderMap(markers) {
  latestMarkers = markers.filter((marker) => Number.isFinite(Number(marker.lat)) && Number.isFinite(Number(marker.lon)));
  const leafletMap = ensureMap();
  markerLayer.clearLayers();
  markerBounds = window.L.latLngBounds();

  if (!latestMarkers.length) {
    els.markerDetail.innerHTML = `<p class="muted">좌표가 있는 가맹점이 없습니다. 검색 조건을 조정하세요.</p>`;
    leafletMap.setView([36.35, 127.85], 7);
    return;
  }

  for (const marker of latestMarkers) {
    const latLng = [Number(marker.lat), Number(marker.lon)];
    markerBounds.extend(latLng);
    const leafletMarker = window.L.marker(latLng, { title: marker.name })
      .bindPopup(`<strong>${escapeHtml(marker.name)}</strong><br>${escapeHtml(marker.address)}<br>${marker.count}회 출현`)
      .on("click", () => showMarkerDetail(marker));
    leafletMarker.addTo(markerLayer);
  }

  fitMapToMarkers();
  showMarkerDetail(latestMarkers[0]);
}

function fitMapToMarkers() {
  if (!map || !markerBounds?.isValid()) return;
  map.fitBounds(markerBounds, { padding: [28, 28], maxZoom: 12 });
}

function showMarkerDetail(marker) {
  els.markerDetail.innerHTML = `
    <article class="store-card">
      <div class="store-head">
        <h3>${escapeHtml(marker.name)}</h3>
        <span class="score">${marker.count}회</span>
      </div>
      <p class="muted">${escapeHtml(marker.region || "-")}</p>
      <p>${escapeHtml(marker.address || "-")}</p>
      <p class="muted">구매 유형 ${escapeHtml((marker.selection_types || []).join(", ") || "-")}</p>
      <p class="muted">최근 ${marker.latest_round_no || "-"}회 ${marker.latest_draw_date || ""}</p>
    </article>
  `;
}

function renderRankings(stores) {
  if (!stores.length) {
    els.rankings.innerHTML = `<p class="muted">가맹점 랭킹이 없습니다.</p>`;
    return;
  }
  els.rankings.innerHTML = stores.map((store) => `
    <article class="store-card">
      <div class="store-head">
        <h3>${escapeHtml(store.name)}</h3>
        <span class="score">${store.count}회</span>
      </div>
      <p class="muted">${escapeHtml(store.region || "-")}</p>
      <p>${escapeHtml(store.address || "-")}</p>
      <p class="muted">최근 ${store.latest_round_no}회 ${store.latest_draw_date}</p>
      <button type="button" class="ghost focus-store" data-name="${escapeAttr(store.name)}" data-address="${escapeAttr(store.address)}">지도에서 보기</button>
    </article>
  `).join("");
  bindFocusButtons(els.rankings);
}

function renderRounds(rounds) {
  if (!rounds.length) {
    els.rounds.innerHTML = `<p class="muted">표시할 회차가 없습니다.</p>`;
    return;
  }
  els.rounds.innerHTML = rounds.map((round) => `
    <article class="draw-card">
      <div class="draw-head">
        <h3>${round.round_no}회</h3>
        <span class="muted">${round.draw_date}</span>
      </div>
      <p class="muted">1등 ${round.first_prize_winners ?? "-"}명 · ${round.prize_per_winner || "-"}</p>
      ${(round.stores || []).map((store) => `
        <div class="round-store-item">
          <strong>${escapeHtml(store.name)}</strong>
          <span class="muted">${escapeHtml(store.selection_type || "-")}</span>
          <p>${escapeHtml(store.address || "-")}</p>
          <button type="button" class="ghost focus-store" data-name="${escapeAttr(store.name)}" data-address="${escapeAttr(store.address)}">지도에서 보기</button>
        </div>
      `).join("")}
    </article>
  `).join("");
  bindFocusButtons(els.rounds);
}

function bindFocusButtons(root) {
  root.querySelectorAll(".focus-store").forEach((button) => {
    button.addEventListener("click", () => {
      const marker = latestMarkers.find((item) => item.name === button.dataset.name && item.address === button.dataset.address);
      if (!marker || !map) {
        setStatus("해당 가맹점의 좌표를 찾지 못했습니다.", "error");
        return;
      }
      const latLng = [Number(marker.lat), Number(marker.lon)];
      map.setView(latLng, 15);
      showMarkerDetail(marker);
      setStatus("");
    });
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await loadStoreLab();
  } catch (error) {
    setStatus(error.message || String(error), "error");
  }
});

els.fitMap.addEventListener("click", fitMapToMarkers);

loadStoreLab().catch((error) => setStatus(error.message || String(error), "error"));
