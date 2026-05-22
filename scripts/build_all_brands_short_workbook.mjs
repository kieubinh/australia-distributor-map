import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const workspaceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(workspaceDir, "outputs", "all_brands_short_distributors");
const outputPath = path.join(outputDir, "all_brands_distributors_short.xlsx");

const paths = {
  knauf: path.join(workspaceDir, "outputs", "knauf_distributors", "knauf_distributors.json"),
  csr: path.join(workspaceDir, "outputs", "csr_gyprock_suppliers", "csr_gyprock_suppliers_api.json"),
  siniat: path.join(workspaceDir, "outputs", "siniat_distributors", "siniat_distributors.json"),
};

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

function combineContact(phone, email) {
  return [
    clean(phone) ? `Phone: ${clean(phone)}` : "",
    clean(email) ? `Email: ${clean(email)}` : "",
  ].filter(Boolean).join("\n");
}

function normalizeKey(row) {
  return [
    row.companyName,
    row.contact,
    row.address,
    row.regionState,
  ].map((value) => clean(value).toLowerCase()).join("|");
}

function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = normalizeKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

function combineRegionState(region, state) {
  const cleanRegion = clean(region);
  const cleanState = clean(state);
  if (!cleanRegion) return cleanState;
  if (!cleanState) return cleanRegion;
  if (cleanRegion.toLowerCase() === cleanState.toLowerCase()) return cleanState;
  return `${cleanRegion} - ${cleanState}`;
}

function sortRows(rows) {
  return [...rows].sort((a, b) =>
    clean(a.regionState).localeCompare(clean(b.regionState)) ||
    clean(a.companyName).localeCompare(clean(b.companyName)) ||
    clean(a.address).localeCompare(clean(b.address))
  );
}

const knaufPayload = JSON.parse(await fs.readFile(paths.knauf, "utf8"));
const csrPayload = JSON.parse(await fs.readFile(paths.csr, "utf8"));
const siniatPayload = JSON.parse(await fs.readFile(paths.siniat, "utf8"));

const knaufRows = sortRows(dedupeRows((knaufPayload.rows ?? []).map((row) => ({
  companyName: clean(row.name),
  contact: combineContact(row.phone, row.email),
  address: clean(row.address),
  regionState: combineRegionState(row.region, row.state),
}))));

const csrRows = sortRows(dedupeRows((csrPayload.result?.stores ?? []).map((store) => {
  const address = store.address ?? {};
  const state = inferState(address);
  return {
    companyName: clean(store.displayName || store.name),
    contact: combineContact(address.phone, address.email),
    address: clean(address.formattedAddress || [address.line1, address.town, state, address.postalCode].filter(Boolean).join(", ")),
    regionState: state,
  };
})));

const siniatRows = sortRows(dedupeRows((siniatPayload.records ?? []).map((row) => ({
  companyName: clean(row.name || row.listingName),
  contact: combineContact(row.phone, row.email),
  address: clean(row.address),
  regionState: combineRegionState(row.regionGroup, row.state),
}))));

const workbook = Workbook.create();
const sheets = [
  { name: "Knauf", title: "Knauf Distributors - Short List", rows: knaufRows, color: "#1F6F5B", light: "#E8F3EF" },
  { name: "CSR Gyprock", title: "CSR Gyprock Suppliers - Short List", rows: csrRows, color: "#1D4F8F", light: "#EAF1FA" },
  { name: "Siniat", title: "Siniat Distributors - Short List", rows: siniatRows, color: "#A3432B", light: "#FAEDEA" },
];

function addBrandSheet({ name, title, rows, color, light }) {
  const sheet = workbook.worksheets.add(name);
  sheet.showGridLines = false;

  sheet.getRange("A1:E1").merge();
  sheet.getRange("A1").values = [[`${title} (${rows.length})`]];
  sheet.getRange("A1").format = {
    fill: color,
    font: { bold: true, color: "#FFFFFF", size: 15 },
    horizontalAlignment: "center",
    verticalAlignment: "middle",
  };
  sheet.getRange("A1").format.rowHeightPx = 34;

  const headers = [["No.", "Company Name", "Contact", "Address", "Region/State"]];
  const values = rows.map((row, index) => [
    index + 1,
    row.companyName,
    row.contact,
    row.address,
    row.regionState,
  ]);

  sheet.getRange("A3:E3").values = headers;
  if (values.length) {
    sheet.getRangeByIndexes(3, 0, values.length, 5).values = values;
  }

  const lastRow = values.length + 3;
  const tableRange = `A3:E${lastRow}`;
  const tableName = `${name.replace(/[^A-Za-z0-9]/g, "")}ShortTable`;
  const table = sheet.tables.add(tableRange, true, tableName);
  table.style = "TableStyleMedium2";
  table.showFilterButton = true;

  sheet.getRange("A3:E3").format = {
    fill: color,
    font: { bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
    verticalAlignment: "middle",
  };

  sheet.getRange(`A4:E${lastRow}`).format = {
    fill: light,
    wrapText: true,
    verticalAlignment: "top",
  };
  sheet.getRange(`A4:A${lastRow}`).format = {
    horizontalAlignment: "center",
    verticalAlignment: "top",
  };

  sheet.getRange("A:A").format.columnWidthPx = 52;
  sheet.getRange("B:B").format.columnWidthPx = 245;
  sheet.getRange("C:C").format.columnWidthPx = 235;
  sheet.getRange("D:D").format.columnWidthPx = 360;
  sheet.getRange("E:E").format.columnWidthPx = 130;
  sheet.getRange(`A3:E${lastRow}`).format.autofitRows();
  sheet.freezePanes.freezeRows(3);
}

for (const sheetConfig of sheets) {
  addBrandSheet(sheetConfig);
}

await fs.mkdir(outputDir, { recursive: true });

for (const sheetConfig of sheets) {
  const preview = await workbook.render({
    sheetName: sheetConfig.name,
    range: "A1:E22",
    scale: 1,
    format: "png",
  });
  await fs.writeFile(
    path.join(outputDir, `${sheetConfig.name.replace(/[^A-Za-z0-9]/g, "_").toLowerCase()}_preview.png`),
    new Uint8Array(await preview.arrayBuffer())
  );
}

const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputPath);

const inspect = await workbook.inspect({
  kind: "sheet,table",
  maxChars: 4000,
  tableMaxRows: 3,
  tableMaxCols: 5,
});
console.log(inspect.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "formula error scan",
});
console.log(errors.ndjson);

console.log(JSON.stringify({
  outputPath,
  counts: {
    knauf: knaufRows.length,
    csrGyprock: csrRows.length,
    siniat: siniatRows.length,
  },
}, null, 2));
