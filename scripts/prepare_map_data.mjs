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
};

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

function normalizeRows(knaufPayload, gyprockPayload, siniatPayload) {
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

const [knaufPayload, gyprockPayload, siniatPayload] = await Promise.all([
  fs.readFile(sourcePaths.knauf, "utf8").then(JSON.parse),
  fs.readFile(sourcePaths.gyprock, "utf8").then(JSON.parse),
  fs.readFile(sourcePaths.siniat, "utf8").then(JSON.parse),
]);

const distributors = normalizeRows(knaufPayload, gyprockPayload, siniatPayload);
const geocodeStats = await geocodeRows(distributors);

const located = distributors.filter((row) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude));
const missing = distributors.filter((row) => !Number.isFinite(row.latitude) || !Number.isFinite(row.longitude));
const counts = distributors.reduce((acc, row) => {
  acc[row.brandKey] = (acc[row.brandKey] ?? 0) + 1;
  return acc;
}, {});

const payload = {
  generatedAt: new Date().toISOString(),
  boundsHint: [[-44.5, 112.0], [-10.0, 154.5]],
  brandMeta,
  counts,
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
  total: distributors.length,
  located: located.length,
  missing: missing.length,
  counts,
  geocodeStats,
}, null, 2));
