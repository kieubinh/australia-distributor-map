import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDataPath = path.join(workspaceDir, "app", "data", "distributors.json");
const knaufSourcePath = path.join(workspaceDir, "outputs", "knauf_distributors", "knauf_distributors.json");

const newDistributor = {
  id: "knauf-91-bmsydney-lidcombe-27-nyrang-street-lidcombe-nsw-2141",
  brandKey: "knauf",
  brand: "Knauf",
  color: "#42A5E8",
  companyName: "BM Sydney Lidcombe",
  distributorType: "Distributor",
  phone: "(02) 8488 1898",
  email: "sales@bmsydney.com",
  address: "27 Nyrang Street, Lidcombe, NSW 2141",
  locality: "Lidcombe",
  postcode: "2141",
  state: "NSW",
  regionState: "NSW",
  sourceUrl: "Manual update requested by user",
  originalOrder: 91,
  latitude: -33.8518992,
  longitude: 151.0441903,
  locationPrecision: "place",
  geocodeQuery: "27 Nyrang Street, Lidcombe, NSW 2141, Australia",
  geocodeDisplayName: "27, Nyrang Street, Lidcombe, Sydney, New South Wales, 2141, Australia",
};

const sourceRow = {
  address: newDistributor.address,
  email: "",
  locality: newDistributor.locality,
  name: newDistributor.companyName,
  phone: newDistributor.phone,
  postcode: newDistributor.postcode,
  rawText: `${newDistributor.companyName} ${newDistributor.phone} ${newDistributor.address}`,
  region: "NSW",
  section: "Manual update requested by user",
  sectionType: "Distributor",
  sourceOrder: 91,
  sourceUrl: "Manual update requested by user",
  state: "NSW",
};

function sortDistributors(rows) {
  return rows.sort((a, b) =>
    (a.state || "").localeCompare(b.state || "") ||
    (a.brand || "").localeCompare(b.brand || "") ||
    (a.companyName || "").localeCompare(b.companyName || "") ||
    (a.address || "").localeCompare(b.address || "")
  );
}

const appData = JSON.parse(await fs.readFile(appDataPath, "utf8"));
appData.distributors = appData.distributors.filter((row) => row.id !== newDistributor.id);
appData.distributors.push(newDistributor);
sortDistributors(appData.distributors);
appData.generatedAt = new Date().toISOString();
appData.counts = appData.distributors.reduce((counts, row) => {
  counts[row.brandKey] = (counts[row.brandKey] ?? 0) + 1;
  return counts;
}, {});
appData.locatedCount = appData.distributors.filter((row) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude)).length;
appData.missingCount = (appData.missing?.length ?? 0) + appData.distributors.length - appData.locatedCount;

await fs.writeFile(appDataPath, `${JSON.stringify(appData, null, 2)}\n`, "utf8");

const knaufSource = JSON.parse(await fs.readFile(knaufSourcePath, "utf8"));
knaufSource.rows = knaufSource.rows.filter((row) => row.name !== sourceRow.name || row.address !== sourceRow.address);
knaufSource.rows.push(sourceRow);
knaufSource.rows.sort((a, b) => (a.state || "").localeCompare(b.state || "") || (a.name || "").localeCompare(b.name || ""));
knaufSource.count = knaufSource.rows.length;

await fs.writeFile(knaufSourcePath, `${JSON.stringify(knaufSource, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  added: newDistributor,
  counts: appData.counts,
  total: appData.distributors.length,
  sourceKnaufRows: knaufSource.rows.length,
}, null, 2));
