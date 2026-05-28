import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(workspaceDir, "outputs", "hebel_resellers");
const outputPath = path.join(outputDir, "hebel_resellers.json");
const sourceUrl = "https://hebel.com.au/find-a-specialist/";
const resellerCategoryName = "Resellers";
const fallbackResellerCategoryId = "25";
const requestHeaders = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-AU,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Upgrade-Insecure-Requests": "1",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

function clean(value) {
  return String(value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function parseInlineJson(html, variableName) {
  const pattern = new RegExp(`var\\s+${variableName}\\s*=\\s*(\\{.*?\\});`, "s");
  const match = html.match(pattern);
  if (!match) throw new Error(`Could not find ${variableName} in Hebel locator page`);
  return JSON.parse(match[1]);
}

function categoryIds(value) {
  return String(value ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function categoryNames(ids, categories) {
  return ids.map((id) => clean(categories[id]?.name)).filter(Boolean);
}

function normalizeWebsite(value) {
  const website = clean(value);
  if (!website) return "";
  if (/^https?:\/\//i.test(website)) return website;
  return `https://${website}`;
}

function formattedAddress(row) {
  const street = clean(row.street).replace(/,\s*$/, "");
  const locality = clean(row.city);
  const statePostcode = [clean(row.state).toUpperCase(), clean(row.postal_code)].filter(Boolean).join(" ");
  return [street, locality, statePostcode].filter(Boolean).join(", ");
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: requestHeaders,
  });
  if (!response.ok) throw new Error(`Fetch failed for ${url}: ${response.status}`);
  return response.text();
}

async function fetchStores(remote) {
  const body = new URLSearchParams({
    action: "asl_load_stores",
    nonce: remote.nonce,
    asl_lang: remote.lang || "",
    load_all: "1",
    layout: "0",
  });

  const response = await fetch(remote.ajax_url, {
    method: "POST",
    headers: {
      ...requestHeaders,
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: sourceUrl,
      "X-Requested-With": "XMLHttpRequest",
    },
    body,
  });
  if (!response.ok) throw new Error(`Hebel locator API failed: ${response.status}`);
  return response.json();
}

const html = await fetchText(sourceUrl);
const remote = parseInlineJson(html, "ASL_REMOTE");
const categories = parseInlineJson(html, "asl_categories");
const resellerCategoryId =
  Object.keys(categories).find((id) => clean(categories[id]?.name).toLowerCase() === resellerCategoryName.toLowerCase()) ||
  fallbackResellerCategoryId;

const rawStores = await fetchStores(remote);
const categoryCounts = {};
for (const store of rawStores) {
  for (const id of categoryIds(store.categories)) {
    categoryCounts[id] = (categoryCounts[id] ?? 0) + 1;
  }
}

const records = rawStores
  .filter((store) => categoryIds(store.categories).includes(resellerCategoryId))
  .map((store, index) => {
    const ids = categoryIds(store.categories);
    const latitude = Number(store.lat);
    const longitude = Number(store.lng);
    return {
      sourceOrder: index + 1,
      sourceId: clean(store.id),
      distributorType: "Hebel Reseller",
      name: clean(store.title),
      phone: clean(store.phone),
      fax: clean(store.fax),
      email: clean(store.email),
      website: normalizeWebsite(store.website),
      address: formattedAddress(store),
      street: clean(store.street),
      locality: clean(store.city),
      state: clean(store.state).toUpperCase(),
      postcode: clean(store.postal_code),
      country: clean(store.country),
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
      categoryIds: ids,
      categoryNames: categoryNames(ids, categories),
      sourceUrl,
      sourceSlug: clean(store.slug),
    };
  });

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(
  outputPath,
  JSON.stringify(
    {
      sourceUrl,
      sourceFilter: {
        categoryId: resellerCategoryId,
        categoryName: resellerCategoryName,
      },
      scrapedAt: new Date().toISOString(),
      count: records.length,
      categoryCounts,
      categories,
      records,
    },
    null,
    2,
  ),
  "utf8",
);

const missing = {
  coordinates: records.filter((record) => !Number.isFinite(record.latitude) || !Number.isFinite(record.longitude)).map((record) => record.name),
  phone: records.filter((record) => !record.phone).map((record) => record.name),
  address: records.filter((record) => !record.address).map((record) => record.name),
};

console.log(JSON.stringify({ outputPath, count: records.length, missing }, null, 2));
