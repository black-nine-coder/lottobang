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
  rankingProvince: $("#rankingProvince"),
  rankingLocality: $("#rankingLocality"),
  rankingWard: $("#rankingWard"),
  rankingStatus: $("#rankingStatus"),
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
let archiveRequest;
let boundaryRequest;
let countryBounds;
let storeRequestId = 0;
let rankingRequestId = 0;
let storePayload;

function setRankingStatus(message = "") {
  els.rankingStatus.hidden = !message;
  els.rankingStatus.textContent = message;
}

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
  const requestId = ++storeRequestId;
  ++rankingRequestId;
  setStatus("가맹점 데이터를 불러오는 중입니다.");
  try {
    const payload = await fetchStoreLab(params);
    if (requestId !== storeRequestId) return;
    render(payload);
    setStatus("");
    loadRankings();
    const boundary = await loadCountryBoundary();
    if (requestId === storeRequestId) renderMap(payload.markers || [], boundary);
  } catch (error) {
    if (requestId === storeRequestId) setStatus(error.message || String(error), "error");
  }
}

async function fetchStoreLab(params) {
  const response = lottoBrowser.isPages ? null : await fetch(`api/store-lab?${params}`).catch(() => null);
  if (response?.ok) return response.json();
  if (response?.status === 400) {
    const payload = await response.json();
    throw new Error(payload.error || "가맹점 검색 조건을 확인하세요.");
  }
  archiveRequest ??= fetch("data/store_archive.json", { cache: "no-cache" }).then((snapshot) => {
    if (!snapshot.ok) throw new Error("가맹점 데이터를 불러오지 못했습니다.");
    return snapshot.json();
  }).catch((error) => {
    archiveRequest = undefined;
    throw error;
  });
  return filterStoreArchive(await archiveRequest, params);
}

function storeLocation(store) {
  const [province = "", ...district] = String(store.region || "").trim().split(/\s+/);
  const address = String(store.address || "").trim().split(/\s+/);
  if (!district.length && /[시군구]$/.test(address[1] || "")) district.push(...address.slice(1, 3));
  const [locality = "", subDistrict] = district;
  if (locality === province) return { province, locality: "", ward: "" };
  const candidate = subDistrict ?? (address[1] === locality ? address[2] : "");
  const ward = locality.endsWith("시") && candidate?.endsWith("구") ? candidate : "";
  return { province, locality, ward };
}

function storeRegionOptions(archive) {
  const provinces = new Map();
  const sorted = (items) => [...items].sort((left, right) => left.localeCompare(right, "ko"));
  for (const entry of archive) {
    for (const store of entry.stores) {
      const { province, locality, ward } = storeLocation(store);
      if (!province) continue;
      if (!provinces.has(province)) provinces.set(province, new Map());
      if (!locality) continue;
      const localities = provinces.get(province);
      if (!localities.has(locality)) localities.set(locality, new Set());
      if (ward) localities.get(locality).add(ward);
    }
  }
  return sorted(provinces.keys()).map((province) => ({
    province,
    localities: sorted(provinces.get(province).keys()).map((name) => ({
      name,
      wards: sorted(provinces.get(province).get(name)),
    })),
  }));
}

function filterStoreArchive(archive, params) {
  const startRound = Number(params.get("start_round")) || 1;
  const latestRound = archive.reduce((latest, entry) => Math.max(latest, entry.round_no), 1);
  const endRound = Number(params.get("end_round")) || latestRound;
  const roundsLimit = Number(params.get("rounds_limit")) || 40;
  const selectionType = params.get("selection_type") || "all";
  const query = params.get("query") || "";
  const search = query.toLowerCase();
  const province = params.get("province") || "";
  const locality = params.get("locality") || "";
  const ward = params.get("ward") || "";
  if (endRound < startRound) throw new Error("종료 회차는 시작 회차 이상이어야 합니다.");

  const rounds = [];
  const stores = new Map();
  const regions = new Map();
  const addresses = new Map();
  for (const entry of archive) {
    if (entry.round_no < startRound || entry.round_no > endRound) continue;
    const matches = entry.stores.filter((store) => {
      if (selectionType !== "all" && store.selection_type !== selectionType) return false;
      if (province || locality || ward) {
        const location = storeLocation(store);
        if (province && location.province !== province) return false;
        if (locality && location.locality !== locality) return false;
        if (ward && location.ward !== ward) return false;
      }
      return [store.name, store.region, store.address, store.selection_type].join(" ").toLowerCase().includes(search);
    });
    if (!matches.length) continue;
    rounds.push({ ...entry, stores: matches });
    for (const store of matches) {
      regions.set(store.region, (regions.get(store.region) || 0) + 1);
      addresses.set(store.address, (addresses.get(store.address) || 0) + 1);
      const id = JSON.stringify([store.name, store.address]);
      const previous = stores.get(id);
      const latest = !previous || entry.round_no >= previous.latest_round_no;
      const item = {
        ...previous,
        name: store.name,
        address: store.address,
        region: latest ? store.region : previous.region,
        latest_round_no: latest ? entry.round_no : previous.latest_round_no,
        latest_draw_date: latest ? entry.draw_date : previous.latest_draw_date,
        count: (previous?.count || 0) + 1,
        selection_types: [...new Set([...(previous?.selection_types || []), store.selection_type])],
      };
      if (isStoreCoordinate(store.lat, store.lon)) {
        item.lat = store.lat;
        item.lon = store.lon;
      }
      stores.set(id, item);
    }
  }

  const top = (counts, property) => [...counts.entries()]
    .sort((left, right) => right[1] - left[1]).slice(0, 12)
    .map(([value, count]) => ({ [property]: value, count }));
  const ranked = [...stores.values()].sort((left, right) =>
    right.count - left.count || right.latest_round_no - left.latest_round_no);
  const markers = ranked.filter((item) => isStoreCoordinate(item.lat, item.lon));
  rounds.sort((left, right) => right.round_no - left.round_no);
  return {
    generated_at_utc: null,
    filters: { start_round: startRound, end_round: endRound, rounds_limit: roundsLimit, query, selection_type: selectionType },
    summary: { matched_rounds: rounds.length, unique_addresses: markers.length },
    statistics: {
      coverage: { rounds: rounds.length, from_round: rounds.at(-1)?.round_no, to_round: rounds[0]?.round_no },
      top_regions: top(regions, "region"),
      top_addresses: top(addresses, "address"),
      top_stores: ranked.slice(0, 12),
    },
    markers,
    region_options: storeRegionOptions(archive),
    rounds: rounds.slice(0, roundsLimit),
  };
}

function isStoreCoordinate(lat, lon) {
  return lat != null && lon != null && lat !== "" && lon !== ""
    && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon));
}

function loadCountryBoundary() {
  boundaryRequest ??= fetch("south-korea.geojson").then(async (response) => {
    if (!response.ok) throw new Error("남한 지도 경계를 불러오지 못했습니다.");
    const boundary = await response.json();
    return boundary.coordinates.map(([ring]) => ring);
  }).catch((error) => {
    boundaryRequest = undefined;
    throw error;
  });
  return boundaryRequest;
}

function isInsideCountry(lat, lon, rings) {
  return rings.some((ring) => {
    let inside = false;
    for (let index = 1; index < ring.length; index += 1) {
      const [x1, y1] = ring[index - 1];
      const [x2, y2] = ring[index];
      if ((y1 > lat) !== (y2 > lat) && lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1) {
        inside = !inside;
      }
    }
    return inside;
  });
}

function isDomesticMarker(lat, lon, rings) {
  if (isInsideCountry(lat, lon, rings)) return true;

  // The map-scale coastline can differ from the coordinates of coastal stores.
  const tolerance = 0.018;
  const longitudeScale = Math.cos(lat * Math.PI / 180);
  return rings.some((ring) => {
    for (let index = 1; index < ring.length; index += 1) {
      const [lon1, lat1] = ring[index - 1];
      const [lon2, lat2] = ring[index];
      const startX = (lon1 - lon) * longitudeScale;
      const startY = lat1 - lat;
      const dx = (lon2 - lon1) * longitudeScale;
      const dy = lat2 - lat1;
      const lengthSquared = dx * dx + dy * dy;
      if (!lengthSquared) continue;
      const projection = Math.max(0, Math.min(1, -(startX * dx + startY * dy) / lengthSquared));
      if (Math.hypot(startX + projection * dx, startY + projection * dy) <= tolerance) return true;
    }
    return false;
  });
}

function ensureMap(rings) {
  if (!window.L) {
    throw new Error("Leaflet 지도 라이브러리를 불러오지 못했습니다. 네트워크 또는 CDN 차단 여부를 확인하세요.");
  }
  if (map) return map;
  const L = window.L;
  const countryRings = rings.map((ring) => ring.map(([lon, lat]) => [lat, lon]));
  countryBounds = L.latLngBounds(countryRings.flat());
  map = L.map(els.mapCanvas, {
    preferCanvas: true,
    maxBounds: countryBounds.pad(0.15),
    maxBoundsViscosity: 1,
  });
  const syncMinZoom = () => map.setMinZoom(map.getBoundsZoom(countryBounds, false, [32, 32]));
  syncMinZoom();
  map.fitBounds(countryBounds, { padding: [16, 16] });
  map.on("resize", syncMinZoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    noWrap: true,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/">Natural Earth</a>',
  }).addTo(map);
  map.createPane("countryMask").style.zIndex = "300";
  L.polygon([
    [[-85, -180], [-85, 180], [85, 180], [85, -180]],
    ...countryRings,
  ], {
    pane: "countryMask",
    renderer: L.svg({ pane: "countryMask" }),
    interactive: false,
    stroke: false,
    fillColor: "#e6ebea",
    fillOpacity: 1,
    fillRule: "evenodd",
    smoothFactor: 0,
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  return map;
}

function render(payload) {
  storePayload = payload;
  els.generatedAt.textContent = payload.generated_at_utc ? formatDate(payload.generated_at_utc) : "공개 데이터";
  els.coverage.textContent = payload.statistics.coverage.rounds
    ? `${payload.statistics.coverage.from_round}회부터 ${payload.statistics.coverage.to_round}회까지`
    : "조건에 맞는 회차 없음";
  els.matchedRounds.textContent = `${payload.summary.matched_rounds}회`;
  els.startRound.value = payload.filters.start_round;
  els.endRound.value = payload.filters.end_round;
  els.query.value = payload.filters.query || "";
  els.selectionType.value = payload.filters.selection_type || "all";
  els.roundsLimit.value = payload.filters.rounds_limit;

  renderStats(els.regions, payload.statistics.top_regions, "region");
  renderStats(els.addresses, payload.statistics.top_addresses, "address");
  updateRankingOptions();
  renderRounds(payload.rounds || []);
}

function setRankingOptions(select, placeholder, values) {
  const previous = select.value;
  select.replaceChildren(new Option(placeholder, ""), ...values.map((value) => new Option(value, value)));
  select.value = values.includes(previous) ? previous : "";
  select.disabled = !values.length;
}

function updateRankingOptions() {
  const regions = storePayload?.region_options || [];
  setRankingOptions(els.rankingProvince, "전체 시·도", regions.map((region) => region.province));
  const selected = regions.find((region) => region.province === els.rankingProvince.value);
  const localities = selected?.localities || [];
  setRankingOptions(els.rankingLocality, "전체 시·군·구", localities.map((item) => item.name));
  const locality = localities.find((item) => item.name === els.rankingLocality.value);
  setRankingOptions(els.rankingWard, "전체 구", locality?.wards || []);
}

async function loadRankings() {
  if (!storePayload) return;
  const requestId = ++rankingRequestId;
  if (!els.rankingProvince.value) {
    renderRankings(storePayload.statistics.top_stores || []);
    setRankingStatus();
    return;
  }
  const params = new URLSearchParams();
  for (const field of ["start_round", "end_round", "query", "selection_type", "rounds_limit"]) {
    const value = storePayload.filters[field];
    if (value != null && value !== "") params.set(field, value);
  }
  params.set("province", els.rankingProvince.value);
  if (els.rankingLocality.value) params.set("locality", els.rankingLocality.value);
  if (els.rankingWard.value) params.set("ward", els.rankingWard.value);
  els.rankings.replaceChildren();
  setRankingStatus("선택한 지역의 랭킹을 불러오는 중입니다.");
  try {
    const payload = await fetchStoreLab(params);
    if (requestId !== rankingRequestId) return;
    renderRankings(payload.statistics.top_stores || []);
    setRankingStatus();
  } catch (error) {
    if (requestId !== rankingRequestId) return;
    renderRankings([]);
    setRankingStatus(error.message || String(error));
  }
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

function renderMap(markers, rings) {
  latestMarkers = markers.filter(({ lat, lon }) =>
    isStoreCoordinate(lat, lon) && isDomesticMarker(Number(lat), Number(lon), rings));
  els.uniqueAddresses.textContent = `${latestMarkers.length}곳`;
  ensureMap(rings);
  markerLayer.clearLayers();
  markerBounds = window.L.latLngBounds();

  if (!latestMarkers.length) {
    els.markerDetail.innerHTML = `<p class="muted">남한 경계 안에 표시할 가맹점이 없습니다. 검색 조건을 조정하세요.</p>`;
    fitMapToMarkers();
    return;
  }

  for (const marker of latestMarkers) {
    const latLng = [Number(marker.lat), Number(marker.lon)];
    markerBounds.extend(latLng);
    const leafletMarker = window.L.circleMarker(latLng, {
      radius: 6, color: "#884923", fillColor: "#c7743a", fillOpacity: .8, weight: 1,
    })
      .bindPopup(`<strong>${escapeHtml(marker.name)}</strong><br>${escapeHtml(marker.address)}<br>${marker.count}회 출현`)
      .on("click", () => showMarkerDetail(marker));
    leafletMarker.addTo(markerLayer);
  }

  fitMapToMarkers();
  showMarkerDetail(latestMarkers[0]);
}

function fitMapToMarkers() {
  if (!map) return;
  map.fitBounds(markerBounds?.isValid() ? markerBounds : countryBounds, { padding: [28, 28], maxZoom: 12 });
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
    els.rankings.innerHTML = `<p class="muted">선택한 조건에 맞는 가맹점이 없습니다.</p>`;
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

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  loadStoreLab();
});

els.fitMap.addEventListener("click", fitMapToMarkers);
els.rankingProvince.addEventListener("change", () => {
  els.rankingLocality.value = "";
  els.rankingWard.value = "";
  updateRankingOptions();
  loadRankings();
});
els.rankingLocality.addEventListener("change", () => {
  els.rankingWard.value = "";
  updateRankingOptions();
  loadRankings();
});
els.rankingWard.addEventListener("change", loadRankings);

loadStoreLab();
