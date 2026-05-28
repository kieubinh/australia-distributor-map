import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(workspaceDir, "app", "data");
const cachePath = path.join(workspaceDir, "outputs", "map_app", "geocode_cache.json");
const dataPath = path.join(outputDir, "distributors.json");

const sourcePaths = {
  knauf: path.join(workspaceDir, "outputs", "knauf_distributors", "knauf_distributors.json"),
  gyprock: path.join(workspaceDir, "outputs", "csr_gyprock_suppliers", "csr_gyprock_suppliers_api.json"),
  siniat: path.join(workspaceDir, "outputs", "siniat_distributors", "siniat_distributors.json"),
  hebel: path.join(workspaceDir, "outputs", "hebel_resellers", "hebel_resellers.json"),
};

const brandMeta = {
  knauf: {
    brand: "Knauf",
    color: "#42A5E8",
    sourceUrl: "https://knauf.com/en-AU/knauf-gypsum/about-knauf-gypsum/where-to-buy",
  },
  gyprock: {
    brand: "CSR Gyprock",
    color: "#111111",
    sourceUrl: "https://www.gyprock.com.au/contact-us/find-us/find-a-supplier",
  },
  siniat: {
    brand: "Siniat",
    color: "#D91C8B",
    sourceUrl: "https://www.siniat.com.au/en-au/contact-us/siniat-distributors/",
  },
  hebel: {
    brand: "Hebel",
    color: "#243588",
    sourceUrl: "https://hebel.com.au/find-a-specialist/",
  },
};

const distributorBranding = [
  {
    brandKey: "hebel",
    namePattern: /^BM Sydney Building Materials Pty Ltd - (Cabramatta|Lidcombe)$/i,
    color: "#A89222",
    logoUrl: "./assets/bm-sydney-logo.svg",
    logoAlt: "BM Sydney Building Materials Pty Ltd. logo",
  },
];

const stateCentroids = {
  ACT: [-35.2809, 149.13],
  NSW: [-32.1656, 147.0169],
  NT: [-19.4914, 132.551],
  QLD: [-20.9176, 142.7028],
  SA: [-30.0002, 136.2092],
  TAS: [-41.4545, 145.9707],
  VIC: [-36.9848, 143.3906],
  WA: [-25.0423, 121.6283],
};

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

function contact(phone, email) {
  return {
    phone: clean(phone),
    email: clean(email),
  };
}

function combineRegionState(region, state) {
  const cleanRegion = clean(region);
  const cleanState = clean(state);
  if (!cleanRegion) return cleanState;
  if (!cleanState) return cleanRegion;
  if (cleanRegion.toLowerCase() === cleanState.toLowerCase()) return cleanState;
  return `${cleanRegion} - ${cleanState}`;
}

function inferState(address) {
  const explicit = clean(address?.region?.isocodeShort);
  if (explicit) return explicit;
  const postcode = Number(address?.postalCode);
  if (!Number.isFinite(postcode)) return "";
  if ((postcode >= 1000 && postcode <= 2599) || (postcode >= 2619 && postcode <= 2899) || (postcode >= 2921 && postcode <= 2999)) return "NSW";
  if ((postcode >= 2600 && postcode <= 2618) || (postcode >= 2900 && postcode <= 2920)) return "ACT";
  if ((postcode >= 3000 && postcode <= 3999) || (postcode >= 8000 && postcode <= 8999)) return "VIC";
  if ((postcode >= 4000 && postcode <= 4999) || (postcode >= 9000 && postcode <= 9999)) return "QLD";
  if (postcode >= 5000 && postcode <= 5999) return "SA";
  if (postcode >= 6000 && postcode <= 6999) return "WA";
  if (postcode >= 7000 && postcode <= 7999) return "TAS";
  if (postcode >= 800 && postcode <= 999) return "NT";
  return "";
}

function makeId(brandKey, index, name, address) {
  return `${brandKey}-${index + 1}-${clean(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${clean(address).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}`;
}

function hasCoordinates(row) {
  return Number.isFinite(row.latitude) && Number.isFinite(row.longitude);
}

function distanceMeters(a, b) {
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const earthRadiusMeters = 6371000;
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLon = toRadians(b.longitude - a.longitude);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function sameKnownState(a, b) {
  const aState = clean(a.state).toUpperCase();
  const bState = clean(b.state).toUpperCase();
  return !aState || !bState || aState === bState;
}

function normalizedAddressKey(row) {
  return clean([row.address, row.locality, row.state, row.postcode].filter(Boolean).join(" "))
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/\baust capital terr\b/g, "act")
    .replace(/\baustralian capital territory\b/g, "act")
    .replace(/\bnew south wales\b/g, "nsw")
    .replace(/\bvictoria\b/g, "vic")
    .replace(/\bqueensland\b/g, "qld")
    .replace(/\btasmania\b/g, "tas")
    .replace(/\bstreet\b/g, "st")
    .replace(/\bdrive\b/g, "dr")
    .replace(/\bdrv\b/g, "dr")
    .replace(/\broad\b/g, "rd")
    .replace(/\bavenue\b/g, "ave")
    .replace(/\bclose\b/g, "cl")
    .replace(/\bcrescent\b/g, "cres")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findHebelPrimaryMatch(row, hebelRows) {
  let bestMatch = null;
  let bestDistance = Infinity;
  const rowAddressKey = normalizedAddressKey(row);

  for (const hebelRow of hebelRows) {
    if (!sameKnownState(row, hebelRow)) continue;

    if (hasCoordinates(row) && hasCoordinates(hebelRow)) {
      const distance = distanceMeters(row, hebelRow);
      if (distance <= 60 && distance < bestDistance) {
        bestMatch = hebelRow;
        bestDistance = distance;
      }
    } else if (rowAddressKey && rowAddressKey === normalizedAddressKey(hebelRow)) {
      bestMatch = hebelRow;
      bestDistance = 0;
    }
  }

  return bestMatch ? { row: bestMatch, distanceMeters: bestDistance } : null;
}

function applyPrimaryBrandPreferences(rows) {
  const hebelRows = rows.filter((row) => row.brandKey === "hebel");
  const suppressed = [];
  const filteredRows = [];

  for (const row of rows) {
    row.categoryKeys = [row.brandKey];
    row.categoryBrands = [row.brand];
    row.categoryTypes = [categoryTypeLabel(row)];
  }

  for (const row of rows) {
    if (row.brandKey !== "hebel") {
      const match = findHebelPrimaryMatch(row, hebelRows);
      if (match) {
        mergeCategory(match.row, row);
        suppressed.push({
          duplicateId: row.id,
          duplicateBrandKey: row.brandKey,
          duplicateBrand: row.brand,
          duplicateCompanyName: row.companyName,
          duplicateAddress: row.address,
          primaryId: match.row.id,
          primaryBrandKey: match.row.brandKey,
          primaryBrand: match.row.brand,
          primaryCompanyName: match.row.companyName,
          primaryAddress: match.row.address,
          distanceMeters: Math.round(match.distanceMeters),
        });
        continue;
      }
    }

    filteredRows.push(row);
  }

  return {
    rows: filteredRows,
    stats: {
      rule: "Prefer Hebel over matching non-Hebel distributor locations",
      suppressedCount: suppressed.length,
      suppressedByBrand: suppressed.reduce((acc, row) => {
        acc[row.duplicateBrand] = (acc[row.duplicateBrand] ?? 0) + 1;
        return acc;
      }, {}),
      suppressed,
    },
  };
}

function mergeCategory(primaryRow, duplicateRow) {
  primaryRow.categoryKeys = primaryRow.categoryKeys || [primaryRow.brandKey];
  primaryRow.categoryBrands = primaryRow.categoryBrands || [primaryRow.brand];
  primaryRow.categoryTypes = primaryRow.categoryTypes || [categoryTypeLabel(primaryRow)];
  if (!primaryRow.categoryKeys.includes(duplicateRow.brandKey)) {
    primaryRow.categoryKeys.push(duplicateRow.brandKey);
  }
  if (!primaryRow.categoryBrands.includes(duplicateRow.brand)) {
    primaryRow.categoryBrands.push(duplicateRow.brand);
  }
  const duplicateType = categoryTypeLabel(duplicateRow);
  if (!primaryRow.categoryTypes.includes(duplicateType)) {
    primaryRow.categoryTypes.push(duplicateType);
  }
}

function categoryTypeLabel(row) {
  const type = clean(row.distributorType);
  if (!type) return clean(row.brand);
  if (row.brandKey === "knauf" && type === "Distributor") return "Knauf Plasterboard";
  if (type.toLowerCase().includes(clean(row.brand).toLowerCase())) return type;
  return `${row.brand} ${type}`;
}

function applyDistributorBranding(rows) {
  for (const row of rows) {
    const branding = distributorBranding.find((item) =>
      row.brandKey === item.brandKey && item.namePattern.test(row.companyName)
    );
    if (!branding) continue;
    row.color = branding.color;
    row.logoUrl = branding.logoUrl;
    row.logoAlt = branding.logoAlt;
  }
}

function normalizeRows(knaufPayload, gyprockPayload, siniatPayload, hebelPayload) {
  const rows = [];

  for (const [index, row] of (knaufPayload.rows ?? []).entries()) {
    const name = clean(row.name);
    const address = clean(row.address);
    rows.push({
      id: makeId("knauf", index, name, address),
      brandKey: "knauf",
      brand: brandMeta.knauf.brand,
      color: brandMeta.knauf.color,
      companyName: name,
      distributorType: clean(row.sectionType || "Distributor"),
      ...contact(row.phone, row.email),
      address,
      locality: clean(row.locality),
      postcode: clean(row.postcode),
      state: clean(row.state),
      regionState: combineRegionState(row.region, row.state),
      sourceUrl: clean(row.sourceUrl || brandMeta.knauf.sourceUrl),
      originalOrder: index + 1,
    });
  }

  for (const [index, store] of (gyprockPayload.result?.stores ?? []).entries()) {
    const address = store.address ?? {};
    const state = inferState(address);
    const name = clean(store.displayName || store.name);
    const formattedAddress = clean(address.formattedAddress || [address.line1, address.town, state, address.postalCode].filter(Boolean).join(", "));
    rows.push({
      id: makeId("gyprock", index, name, formattedAddress),
      brandKey: "gyprock",
      brand: brandMeta.gyprock.brand,
      color: brandMeta.gyprock.color,
      companyName: name,
      distributorType: "Supplier",
      ...contact(address.phone, address.email),
      address: formattedAddress,
      locality: clean(address.town),
      postcode: clean(address.postalCode),
      state,
      regionState: state,
      latitude: Number(store.geoPoint?.latitude) || null,
      longitude: Number(store.geoPoint?.longitude) || null,
      locationPrecision: store.geoPoint?.latitude && store.geoPoint?.longitude ? "source coordinates" : "",
      sourceUrl: brandMeta.gyprock.sourceUrl,
      originalOrder: index + 1,
    });
  }

  for (const [index, row] of (siniatPayload.records ?? []).entries()) {
    const name = clean(row.name || row.listingName);
    const address = clean(row.address);
    rows.push({
      id: makeId("siniat", index, name, address),
      brandKey: "siniat",
      brand: brandMeta.siniat.brand,
      color: brandMeta.siniat.color,
      companyName: name,
      distributorType: clean(row.distributorType || "Siniat Distributor"),
      ...contact(row.phone, row.email),
      address,
      locality: clean(row.locality),
      postcode: clean(row.postcode),
      state: clean(row.state),
      regionState: combineRegionState(row.regionGroup, row.state),
      sourceUrl: clean(row.sourceListingUrl || row.sourceUrl || brandMeta.siniat.sourceUrl),
      originalOrder: index + 1,
    });
  }

  for (const [index, row] of (hebelPayload.records ?? []).entries()) {
    const name = clean(row.name);
    const address = clean(row.address);
    const latitude = Number(row.latitude);
    const longitude = Number(row.longitude);
    rows.push({
      id: makeId("hebel", index, name, address),
      brandKey: "hebel",
      brand: brandMeta.hebel.brand,
      color: brandMeta.hebel.color,
      companyName: name,
      distributorType: clean(row.distributorType || "Hebel Reseller"),
      ...contact(row.phone, row.email),
      address,
      locality: clean(row.locality),
      postcode: clean(row.postcode),
      state: clean(row.state),
      regionState: clean(row.state),
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
      locationPrecision: Number.isFinite(latitude) && Number.isFinite(longitude) ? "source coordinates" : "",
      sourceUrl: clean(row.sourceUrl || brandMeta.hebel.sourceUrl),
      originalOrder: index + 1,
    });
  }

  return rows;
}

function buildQueries(row) {
  const queries = [];
  if (row.address) queries.push(`${row.address}, Australia`);
  if (row.locality && row.state && row.postcode) queries.push(`${row.locality}, ${row.state} ${row.postcode}, Australia`);
  if (row.postcode && row.state) queries.push(`${row.postcode}, ${row.state}, Australia`);
  if (row.locality && row.state) queries.push(`${row.locality}, ${row.state}, Australia`);
  return [...new Set(queries.map(clean).filter(Boolean))];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadCache() {
  try {
    return JSON.parse(await fs.readFile(cachePath, "utf8"));
  } catch {
    return {};
  }
}

async function saveCache(cache) {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(cache, null, 2), "utf8");
}

async function geocodeQuery(query) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("q", query);
  url.searchParams.set("countrycodes", "au");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "0");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "distributor-map-builder/1.0 (local data preparation)",
    },
  });

  if (!response.ok) {
    throw new Error(`Geocoder returned ${response.status} for ${query}`);
  }

  const matches = await response.json();
  const first = matches[0];
  if (!first) return null;
  return {
    latitude: Number(first.lat),
    longitude: Number(first.lon),
    displayName: first.display_name ?? "",
    precision: first.addresstype || first.type || "geocoded",
  };
}

async function geocodeRows(rows) {
  const cache = await loadCache();
  let freshLookups = 0;
  let cacheHits = 0;

  for (const row of rows) {
    if (Number.isFinite(row.latitude) && Number.isFinite(row.longitude)) continue;

    const queries = buildQueries(row);
    let result = null;
    let matchedQuery = "";

    for (const query of queries) {
      if (cache[query]) {
        cacheHits += 1;
        result = cache[query];
      } else {
        if (freshLookups > 0) await sleep(1100);
        freshLookups += 1;
        result = await geocodeQuery(query);
        cache[query] = result;
        await saveCache(cache);
      }

      if (result) {
        matchedQuery = query;
        break;
      }
    }

    if (result && Number.isFinite(result.latitude) && Number.isFinite(result.longitude)) {
      row.latitude = result.latitude;
      row.longitude = result.longitude;
      row.locationPrecision = result.precision || "geocoded";
      row.geocodeQuery = matchedQuery;
      row.geocodeDisplayName = result.displayName || "";
    } else {
      const fallback = stateCentroids[row.state];
      if (fallback) {
        row.latitude = fallback[0];
        row.longitude = fallback[1];
        row.locationPrecision = "state centroid fallback";
        row.geocodeQuery = "";
        row.geocodeDisplayName = "";
      }
    }
  }

  await saveCache(cache);
  return { freshLookups, cacheHits };
}

const [knaufPayload, gyprockPayload, siniatPayload, hebelPayload] = await Promise.all([
  fs.readFile(sourcePaths.knauf, "utf8").then(JSON.parse),
  fs.readFile(sourcePaths.gyprock, "utf8").then(JSON.parse),
  fs.readFile(sourcePaths.siniat, "utf8").then(JSON.parse),
  fs.readFile(sourcePaths.hebel, "utf8").then(JSON.parse),
]);

const normalizedDistributors = normalizeRows(knaufPayload, gyprockPayload, siniatPayload, hebelPayload);
applyDistributorBranding(normalizedDistributors);
const geocodeStats = await geocodeRows(normalizedDistributors);
const { rows: distributors, stats: primaryBrandStats } = applyPrimaryBrandPreferences(normalizedDistributors);

const located = distributors.filter((row) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude));
const missing = distributors.filter((row) => !Number.isFinite(row.latitude) || !Number.isFinite(row.longitude));
const counts = distributors.reduce((acc, row) => {
  for (const brandKey of new Set(row.categoryKeys || [row.brandKey])) {
    acc[brandKey] = (acc[brandKey] ?? 0) + 1;
  }
  return acc;
}, {});

const payload = {
  generatedAt: new Date().toISOString(),
  boundsHint: [[-44.5, 112.0], [-10.0, 154.5]],
  brandMeta,
  counts,
  primaryBrandStats,
  geocodeStats,
  locatedCount: located.length,
  missingCount: missing.length,
  distributors: located,
  missing,
};

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(dataPath, JSON.stringify(payload, null, 2), "utf8");

console.log(JSON.stringify({
  dataPath,
  sourceTotal: normalizedDistributors.length,
  total: distributors.length,
  located: located.length,
  missing: missing.length,
  counts,
  primaryBrandStats,
  geocodeStats,
}, null, 2));
