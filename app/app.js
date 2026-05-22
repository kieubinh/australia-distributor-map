const australiaBounds = [
  [112.0, -44.5],
  [154.5, -10.0],
];

const brandColors = {
  knauf: "#42A5E8",
  gyprock: "#111111",
  siniat: "#D91C8B",
};

const brandLabels = {
  knauf: "Knauf",
  gyprock: "CSR Gyprock",
  siniat: "Siniat",
};

const state = {
  data: null,
  markersById: new Map(),
  filtered: [],
  visibleMarkerIds: new Set(),
  activePopup: null,
  searchSummary: null,
};

const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/liberty",
  center: [134.5, -25.5],
  zoom: 3.35,
  maxZoom: 17,
  attributionControl: true,
});

map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
map.fitBounds(australiaBounds, { padding: 18, duration: 0 });

const elements = {
  visibleCount: document.querySelector("#visibleCount"),
  countKnauf: document.querySelector("#countKnauf"),
  countGyprock: document.querySelector("#countGyprock"),
  countSiniat: document.querySelector("#countSiniat"),
  searchInput: document.querySelector("#searchInput"),
  fitAllButton: document.querySelector("#fitAllButton"),
  clearSearchButton: document.querySelector("#clearSearchButton"),
  zoomInButton: document.querySelector("#zoomInButton"),
  zoomOutButton: document.querySelector("#zoomOutButton"),
  resetMapButton: document.querySelector("#resetMapButton"),
  distributorList: document.querySelector("#distributorList"),
  listMeta: document.querySelector("#listMeta"),
  mapSummary: document.querySelector("#mapSummary"),
  brandInputs: [...document.querySelectorAll("input[name='brand']")],
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function popupHtml(distributor) {
  const phone = distributor.phone ? `<div class="popup-row"><strong>Phone:</strong> ${escapeHtml(distributor.phone)}</div>` : "";
  const email = distributor.email
    ? `<div class="popup-row"><strong>Email:</strong> <a href="mailto:${escapeHtml(distributor.email)}">${escapeHtml(distributor.email)}</a></div>`
    : "";
  const type = distributor.distributorType ? `<div class="popup-row"><strong>Type:</strong> ${escapeHtml(distributor.distributorType)}</div>` : "";
  const source = distributor.sourceUrl
    ? `<div class="popup-row"><a href="${escapeHtml(distributor.sourceUrl)}" target="_blank" rel="noreferrer">Source listing</a></div>`
    : "";

  return `
    <div class="popup" style="--popup-color:${distributor.color}">
      <span class="popup-brand">${escapeHtml(distributor.brand)}</span>
      <h2 class="popup-name">${escapeHtml(distributor.companyName)}</h2>
      ${type}
      <div class="popup-row"><strong>Address:</strong> ${escapeHtml(distributor.address)}</div>
      <div class="popup-row"><strong>Region/State:</strong> ${escapeHtml(distributor.regionState || distributor.state)}</div>
      ${phone}
      ${email}
      ${source}
    </div>
  `;
}

function markerElement(distributor) {
  const marker = document.createElement("button");
  marker.className = "brand-pin-wrap";
  marker.type = "button";
  marker.title = distributor.companyName;
  marker.style.setProperty("--pin-color", distributor.color);
  marker.innerHTML = `<span class="brand-pin" aria-hidden="true"></span>`;
  marker.addEventListener("click", (event) => {
    event.stopPropagation();
    openDistributor(distributor.id, { moveMap: false });
  });
  return marker;
}

function createMarker(distributor) {
  const marker = new maplibregl.Marker({
    element: markerElement(distributor),
    anchor: "bottom",
  })
    .setLngLat([distributor.longitude, distributor.latitude]);

  return marker;
}

function searchableText(distributor) {
  return [
    distributor.brand,
    distributor.companyName,
    distributor.distributorType,
    distributor.address,
    distributor.locality,
    distributor.postcode,
    distributor.state,
    distributor.regionState,
    distributor.phone,
    distributor.email,
  ].join(" ").toLowerCase();
}

function activeBrands() {
  return new Set(elements.brandInputs.filter((input) => input.checked).map((input) => input.value));
}

function searchTokens(value) {
  return value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function matchesSearch(distributor, tokens) {
  return tokens.every((token) => distributor.searchText.includes(token));
}

function distanceKm(a, b) {
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const earthRadiusKm = 6371;
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLon = toRadians(b.longitude - a.longitude);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function nearestMatchDistance(row, matches) {
  return Math.min(...matches.map((match) => distanceKm(row, match)));
}

function sortDefaultRows(rows) {
  return [...rows].sort((a, b) =>
    (a.state || "").localeCompare(b.state || "") ||
    a.brand.localeCompare(b.brand) ||
    a.companyName.localeCompare(b.companyName)
  );
}

function getFilteredRows() {
  const brands = activeBrands();
  const tokens = searchTokens(elements.searchInput.value);
  const candidates = state.data.distributors.filter((distributor) => brands.has(distributor.brandKey));

  state.searchSummary = null;
  if (!tokens.length) return sortDefaultRows(candidates);

  const matches = candidates.filter((distributor) => matchesSearch(distributor, tokens));
  if (!matches.length) {
    state.searchSummary = { matchCount: 0, nearbyCount: 0, otherCount: candidates.length };
    return sortDefaultRows(candidates).map((distributor) => ({
      ...distributor,
      searchRole: "other",
      distanceKm: null,
    }));
  }

  const matchIds = new Set(matches.map((distributor) => distributor.id));
  const otherRows = candidates
    .filter((distributor) => !matchIds.has(distributor.id))
    .map((distributor) => ({
      ...distributor,
      searchRole: "other",
      distanceKm: nearestMatchDistance(distributor, matches),
    }));

  const matchRows = sortDefaultRows(matches).map((distributor) => ({
    ...distributor,
    searchRole: "match",
    distanceKm: 0,
  }));
  const sortedOtherRows = otherRows.sort((a, b) =>
    a.distanceKm - b.distanceKm ||
    a.brand.localeCompare(b.brand) ||
    a.companyName.localeCompare(b.companyName)
  );

  state.searchSummary = {
    matchCount: matchRows.length,
    nearbyCount: sortedOtherRows.length,
    otherCount: sortedOtherRows.length,
  };
  return [...matchRows, ...sortedOtherRows];
}

function updateCounts(rows) {
  const counts = rows.reduce((acc, distributor) => {
    acc[distributor.brandKey] = (acc[distributor.brandKey] ?? 0) + 1;
    return acc;
  }, {});

  elements.countKnauf.textContent = counts.knauf ?? 0;
  elements.countGyprock.textContent = counts.gyprock ?? 0;
  elements.countSiniat.textContent = counts.siniat ?? 0;
  elements.visibleCount.textContent = state.searchSummary?.matchCount
    ? `${rows.length} visible, ${state.searchSummary.matchCount} search match${state.searchSummary.matchCount === 1 ? "" : "es"}`
    : `${rows.length} visible of ${state.data.distributors.length} distributors`;
  elements.mapSummary.innerHTML = `<strong>${rows.length}</strong><span>visible pins</span>`;
  elements.listMeta.textContent = state.searchSummary?.matchCount
    ? `${state.searchSummary.matchCount} match${state.searchSummary.matchCount === 1 ? "" : "es"} shown first, all ${rows.length} distributors still visible`
    : `${rows.length} distributor${rows.length === 1 ? "" : "s"}`;
}

function renderList(rows) {
  if (!rows.length) {
    elements.distributorList.innerHTML = `<div class="empty-state">No distributors match the current filters.</div>`;
    return;
  }

  elements.distributorList.innerHTML = rows.map((distributor) => {
    const contact = [distributor.phone, distributor.email].filter(Boolean).join("  ");
    const proximity =
      distributor.searchRole === "match"
        ? `<span class="card-pill">Match</span>`
        : distributor.searchRole === "other" && Number.isFinite(distributor.distanceKm)
          ? `<span class="card-pill nearby">${Math.round(distributor.distanceKm)} km nearby</span>`
          : "";
    return `
      <button class="distributor-card" type="button" data-id="${escapeHtml(distributor.id)}" style="--brand-color:${distributor.color}">
        <div class="card-topline">
          <span class="card-brand">${escapeHtml(distributor.brand)}</span>
          ${proximity}
        </div>
        <div class="card-name">${escapeHtml(distributor.companyName)}</div>
        <div class="card-address">${escapeHtml(distributor.address)}</div>
        <div class="card-contact">${escapeHtml(contact || distributor.regionState || distributor.state)}</div>
      </button>
    `;
  }).join("");
}

function updateMap(rows) {
  closeActivePopup();
  const nextIds = new Set(rows.map((distributor) => distributor.id));

  for (const id of state.visibleMarkerIds) {
    if (!nextIds.has(id)) state.markersById.get(id)?.remove();
  }

  for (const distributor of rows) {
    if (!state.visibleMarkerIds.has(distributor.id)) {
      state.markersById.get(distributor.id)?.addTo(map);
    }
  }

  state.visibleMarkerIds = nextIds;
}

function distributorBounds(rows) {
  const bounds = new maplibregl.LngLatBounds();
  for (const distributor of rows) {
    bounds.extend([distributor.longitude, distributor.latitude]);
  }
  return bounds;
}

function fitVisiblePins() {
  if (!state.filtered.length) {
    map.fitBounds(australiaBounds, { padding: 24, duration: 0 });
    return;
  }

  map.fitBounds(distributorBounds(state.filtered), {
    padding: { top: 48, right: 48, bottom: 48, left: 48 },
    maxZoom: 12,
    duration: 450,
  });
}

function showAustralia() {
  elements.searchInput.value = "";
  for (const input of elements.brandInputs) input.checked = true;
  applyFilters();
  map.fitBounds(australiaBounds, { padding: 24, duration: 450 });
}

function zoomBy(delta) {
  map.zoomTo(map.getZoom() + delta, { duration: 250 });
}

function applyFilters({ fit = false } = {}) {
  const rows = getFilteredRows();
  state.filtered = rows;
  updateCounts(rows);
  updateMap(rows);
  renderList(rows);
  if (fit) fitVisiblePins();
}

function closeActivePopup() {
  if (state.activePopup) {
    state.activePopup.remove();
    state.activePopup = null;
  }
}

function showDistributorPopup(distributor) {
  closeActivePopup();
  state.activePopup = new maplibregl.Popup({
    anchor: "bottom",
    closeButton: true,
    closeOnClick: false,
    offset: 32,
    maxWidth: "300px",
  })
    .setLngLat([distributor.longitude, distributor.latitude])
    .setHTML(popupHtml(distributor))
    .addTo(map);
}

function openDistributor(id, { moveMap = true } = {}) {
  const distributor = state.data.distributors.find((item) => item.id === id);
  const marker = state.markersById.get(id);
  if (!distributor || !marker) return;

  marker.addTo(map);
  state.visibleMarkerIds.add(id);
  showDistributorPopup(distributor);
  if (!moveMap) return;

  map.flyTo({
    center: [distributor.longitude, distributor.latitude],
    zoom: Math.max(map.getZoom(), 11),
    duration: 450,
  });
}

async function init() {
  const response = await fetch("./data/distributors.json");
  if (!response.ok) throw new Error(`Could not load distributor data: ${response.status}`);

  const data = await response.json();
  data.distributors = data.distributors.map((distributor) => ({
    ...distributor,
    color: brandColors[distributor.brandKey] || distributor.color || "#555555",
    brand: brandLabels[distributor.brandKey] || distributor.brand,
    searchText: searchableText(distributor),
  }));
  state.data = data;

  for (const distributor of data.distributors) {
    state.markersById.set(distributor.id, createMarker(distributor));
  }

  elements.searchInput.addEventListener("input", () => applyFilters());
  for (const input of elements.brandInputs) {
    input.addEventListener("change", () => applyFilters({ fit: true }));
  }
  elements.fitAllButton.addEventListener("click", fitVisiblePins);
  elements.zoomInButton.addEventListener("click", () => zoomBy(1));
  elements.zoomOutButton.addEventListener("click", () => zoomBy(-1));
  elements.resetMapButton.addEventListener("click", showAustralia);
  elements.clearSearchButton.addEventListener("click", () => {
    elements.searchInput.value = "";
    applyFilters({ fit: true });
    elements.searchInput.focus();
  });
  elements.distributorList.addEventListener("click", (event) => {
    const card = event.target.closest("[data-id]");
    if (card) openDistributor(card.dataset.id);
  });
  window.addEventListener("resize", () => map.resize());

  applyFilters({ fit: true });
  map.once("load", () => {
    map.resize();
    fitVisiblePins();
  });
}

init().catch((error) => {
  console.error(error);
  elements.visibleCount.textContent = "Map data failed to load";
  elements.distributorList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
});
