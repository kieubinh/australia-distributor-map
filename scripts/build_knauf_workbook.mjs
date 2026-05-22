import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const workspaceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = path.join(workspaceDir, "outputs", "knauf_distributors", "knauf_distributors.json");
const outputDir = path.join(workspaceDir, "outputs", "knauf_distributors");
const outputPath = path.join(outputDir, "knauf_plasterboard_distributors.xlsx");
const previewPath = path.join(outputDir, "knauf_plasterboard_distributors_preview.png");

const payload = JSON.parse(await fs.readFile(inputPath, "utf8"));
const rows = payload.rows ?? [];

function normalizeKey(row) {
  return [
    row.name,
    row.address,
    row.phone,
    row.email,
  ].map((value) => String(value ?? "").trim().toLowerCase()).join("|");
}

const mergedByKey = new Map();
for (const row of rows) {
  const key = normalizeKey(row);
  const existing = mergedByKey.get(key);
  if (!existing) {
    mergedByKey.set(key, {
      ...row,
      sourceSections: row.section ? [row.section] : [],
      sourceRegions: row.region ? [row.region] : [],
      duplicateCount: 1,
    });
  } else {
    existing.duplicateCount += 1;
    if (row.section && !existing.sourceSections.includes(row.section)) existing.sourceSections.push(row.section);
    if (row.region && !existing.sourceRegions.includes(row.region)) existing.sourceRegions.push(row.region);
    existing.section = existing.sourceSections.join("; ");
    existing.region = existing.sourceRegions.join("; ");
  }
}

const cleanRows = Array.from(mergedByKey.values()).map((row, index) => ({
  no: index + 1,
  type: row.sectionType ?? "",
  section: row.sourceSections?.join("; ") || row.section || "",
  region: row.sourceRegions?.join("; ") || row.region || "",
  name: row.name ?? "",
  phone: row.phone ?? "",
  email: row.email ?? "",
  address: row.address ?? "",
  locality: row.locality ?? "",
  state: row.state ?? "",
  postcode: row.postcode ?? "",
  sourceUrl: row.sourceUrl ?? "",
  duplicateCount: row.duplicateCount ?? 1,
}));

const rawRows = rows.map((row) => ({
  no: row.sourceOrder ?? "",
  type: row.sectionType ?? "",
  section: row.section ?? "",
  region: row.region ?? "",
  name: row.name ?? "",
  phone: row.phone ?? "",
  email: row.email ?? "",
  address: row.address ?? "",
  locality: row.locality ?? "",
  state: row.state ?? "",
  postcode: row.postcode ?? "",
  sourceUrl: row.sourceUrl ?? "",
  rawText: row.rawText ?? "",
}));

const countBy = (field) => {
  const counts = new Map();
  for (const row of cleanRows) {
    const key = row[field] || "Not specified";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
};

function inferStateFromPostcode(postcode) {
  const code = Number(postcode);
  if (!Number.isFinite(code)) return "";
  if ((code >= 1000 && code <= 2599) || (code >= 2619 && code <= 2899) || (code >= 2921 && code <= 2999)) return "NSW";
  if ((code >= 2600 && code <= 2618) || (code >= 2900 && code <= 2920)) return "ACT";
  if ((code >= 3000 && code <= 3999) || (code >= 8000 && code <= 8999)) return "VIC";
  if ((code >= 4000 && code <= 4999) || (code >= 9000 && code <= 9999)) return "QLD";
  if ((code >= 5000 && code <= 5999)) return "SA";
  if ((code >= 6000 && code <= 6999)) return "WA";
  if ((code >= 7000 && code <= 7999)) return "TAS";
  if ((code >= 800 && code <= 999)) return "NT";
  return "";
}

function cleanAddressParts(row) {
  const address = row.address ?? "";
  const stateMatch = address.match(/\b(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\b/i);
  const postcodeMatch = address.match(/\b(\d{4})\b/);
  const postcode = row.postcode || postcodeMatch?.[1] || "";
  const state = row.state || stateMatch?.[1]?.toUpperCase() || inferStateFromPostcode(postcode);
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  const stateOrPostcode = /\b(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\b|\b\d{4}\b/i;
  const stripStatePostcode = (value) => value
    .replace(/\b(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\b/gi, "")
    .replace(/\b\d{4}\b/g, "")
    .trim();
  let locality = "";

  if (parts.length >= 4 && /^\d{4}$/.test(parts.at(-1)) && /\b(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\b/i.test(parts.at(-2))) {
    locality = stripStatePostcode(parts.at(-3));
  } else if (parts.length >= 3 && stateOrPostcode.test(parts.at(-1))) {
    locality = stripStatePostcode(parts.at(-2));
  } else if (parts.length >= 2) {
    const lastWithoutStatePostcode = stripStatePostcode(parts.at(-1));
    locality = /[A-Za-z]/.test(lastWithoutStatePostcode)
      ? lastWithoutStatePostcode
      : stripStatePostcode(parts.at(-2));
  }
  locality = locality || row.locality || "";

  return { locality, state, postcode };
}

for (const row of cleanRows) {
  Object.assign(row, cleanAddressParts(row));
}

for (const row of rawRows) {
  Object.assign(row, cleanAddressParts(row));
}

const stateCounts = countBy("state");
const typeCounts = countBy("type");

const workbook = Workbook.create();
const summary = workbook.worksheets.add("Summary");
const contacts = workbook.worksheets.add("Contacts");
const raw = workbook.worksheets.add("Raw Scrape");

for (const sheet of [summary, contacts, raw]) {
  sheet.showGridLines = false;
}

const titleFill = "#1F4E79";
const sectionFill = "#DCEBF7";
const headerFill = "#5B9BD5";
const softFill = "#F7FAFC";
const noteFill = "#FFF2CC";
const borderColor = "#D9E2EC";

summary.getRange("A1:H1").merge();
summary.getRange("A1").values = [["Knauf Plasterboard Distributor Contacts"]];
summary.getRange("A1").format = {
  fill: titleFill,
  font: { bold: true, color: "#FFFFFF", size: 16 },
  horizontalAlignment: "center",
  verticalAlignment: "middle",
};
summary.getRange("A1").format.rowHeightPx = 34;

summary.getRange("A3:B8").values = [
  ["Source page", payload.rows?.[0]?.sourceUrl ?? "https://knauf.com/en-AU/knauf-gypsum/about-knauf-gypsum/where-to-buy"],
  ["Scraped at (UTC)", payload.scrapedAt ? new Date(payload.scrapedAt) : ""],
  ["Raw cards found", rows.length],
  ["Unique contact rows", cleanRows.length],
  ["Duplicate raw cards merged", rows.length - cleanRows.length],
  ["Workbook created (UTC)", new Date()],
];
summary.getRange("A3:A8").format = {
  fill: sectionFill,
  font: { bold: true, color: "#17324D" },
};
summary.getRange("B3:B8").format = {
  fill: softFill,
  wrapText: true,
};
summary.getRange("B4").format.numberFormat = "yyyy-mm-dd hh:mm:ss \"UTC\"";
summary.getRange("B8").format.numberFormat = "yyyy-mm-dd hh:mm:ss \"UTC\"";

summary.getRange("D3:E3").values = [["Contacts by Type", "Count"]];
summary.getRange("D4:E" + (3 + typeCounts.length)).values = typeCounts.map(([key, count]) => [key, count]);
summary.getRange("G3:H3").values = [["Contacts by State", "Count"]];
summary.getRange("G4:H" + (3 + stateCounts.length)).values = stateCounts.map(([key, count]) => [key, count]);

for (const rangeAddress of ["D3:E3", "G3:H3"]) {
  summary.getRange(rangeAddress).format = {
    fill: headerFill,
    font: { bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
  };
}
for (const rangeAddress of [`D4:E${3 + typeCounts.length}`, `G4:H${3 + stateCounts.length}`]) {
  summary.getRange(rangeAddress).format = {
    fill: softFill,
    borders: { insideHorizontal: { color: borderColor }, insideVertical: { color: borderColor } },
  };
}

summary.getRange("A10:H10").merge();
summary.getRange("A11:H11").merge();
summary.getRange("A10").values = [["Note"]];
summary.getRange("A11").values = [["One duplicate Hobart fulfilment-centre card appeared in the source page and was merged in the Contacts sheet. The Raw Scrape sheet keeps every raw card as captured."]];
summary.getRange("A10:H10").format = {
  fill: noteFill,
  font: { bold: true, color: "#7A5B00" },
};
summary.getRange("A11:H11").format = {
  fill: "#FFF9E6",
  wrapText: true,
};

const contactHeaders = [
  "No.",
  "Type",
  "Source Section(s)",
  "Region",
  "Name",
  "Contact Phone",
  "Email",
  "Address",
  "Locality",
  "State",
  "Postcode",
  "Source URL",
  "Raw Duplicate Count",
];

contacts.getRangeByIndexes(0, 0, 1, contactHeaders.length).values = [contactHeaders];
contacts.getRangeByIndexes(1, 0, cleanRows.length, contactHeaders.length).values = cleanRows.map((row) => [
  row.no,
  row.type,
  row.section,
  row.region,
  row.name,
  row.phone,
  row.email,
  row.address,
  row.locality,
  row.state,
  row.postcode,
  row.sourceUrl,
  row.duplicateCount,
]);
const contactsLastRow = cleanRows.length + 1;
contacts.tables.add(`A1:M${contactsLastRow}`, true, "KnaufContacts");
contacts.freezePanes.freezeRows(1);

const rawHeaders = [
  "Raw No.",
  "Type",
  "Source Section",
  "Region",
  "Name",
  "Contact Phone",
  "Email",
  "Address",
  "Locality",
  "State",
  "Postcode",
  "Source URL",
  "Raw Card Text",
];
raw.getRangeByIndexes(0, 0, 1, rawHeaders.length).values = [rawHeaders];
raw.getRangeByIndexes(1, 0, rawRows.length, rawHeaders.length).values = rawRows.map((row) => [
  row.no,
  row.type,
  row.section,
  row.region,
  row.name,
  row.phone,
  row.email,
  row.address,
  row.locality,
  row.state,
  row.postcode,
  row.sourceUrl,
  row.rawText,
]);
const rawLastRow = rawRows.length + 1;
raw.tables.add(`A1:M${rawLastRow}`, true, "KnaufRawScrape");
raw.freezePanes.freezeRows(1);

function styleDataSheet(sheet, lastRow) {
  sheet.getRange(`A1:M1`).format = {
    fill: headerFill,
    font: { bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
    verticalAlignment: "middle",
    wrapText: true,
  };
  sheet.getRange(`A2:M${lastRow}`).format = {
    borders: {
      insideHorizontal: { color: borderColor },
      insideVertical: { color: borderColor },
    },
    verticalAlignment: "top",
  };
  sheet.getRange(`A2:A${lastRow}`).format.horizontalAlignment = "right";
  sheet.getRange(`K2:K${lastRow}`).format.horizontalAlignment = "center";
  sheet.getRange(`M2:M${lastRow}`).format.horizontalAlignment = "center";
  sheet.getRange(`C2:C${lastRow}`).format.wrapText = true;
  sheet.getRange(`H2:H${lastRow}`).format.wrapText = true;
  sheet.getRange(`L2:L${lastRow}`).format.wrapText = true;
  sheet.getRange("A:A").format.columnWidthPx = 52;
  sheet.getRange("B:B").format.columnWidthPx = 128;
  sheet.getRange("C:C").format.columnWidthPx = 245;
  sheet.getRange("D:D").format.columnWidthPx = 110;
  sheet.getRange("E:E").format.columnWidthPx = 260;
  sheet.getRange("F:F").format.columnWidthPx = 135;
  sheet.getRange("G:G").format.columnWidthPx = 230;
  sheet.getRange("H:H").format.columnWidthPx = 310;
  sheet.getRange("I:I").format.columnWidthPx = 140;
  sheet.getRange("J:J").format.columnWidthPx = 68;
  sheet.getRange("K:K").format.columnWidthPx = 82;
  sheet.getRange("L:L").format.columnWidthPx = 330;
  sheet.getRange("M:M").format.columnWidthPx = 135;
  sheet.getRange(`A2:M${lastRow}`).format.rowHeightPx = 34;
}

styleDataSheet(contacts, contactsLastRow);
styleDataSheet(raw, rawLastRow);
raw.getRange("M:M").format.columnWidthPx = 390;
raw.getRange(`M2:M${rawLastRow}`).format.wrapText = true;

summary.getRange("A:A").format.columnWidthPx = 195;
summary.getRange("B:B").format.columnWidthPx = 525;
summary.getRange("C:C").format.columnWidthPx = 28;
summary.getRange("D:D").format.columnWidthPx = 165;
summary.getRange("E:E").format.columnWidthPx = 80;
summary.getRange("F:F").format.columnWidthPx = 28;
summary.getRange("G:G").format.columnWidthPx = 135;
summary.getRange("H:H").format.columnWidthPx = 80;
summary.getRange("A3:H11").format = {
  borders: {
    insideHorizontal: { color: borderColor },
    insideVertical: { color: borderColor },
  },
};
summary.getRange("A3:H11").format.verticalAlignment = "top";

const previewSpecs = [
  { sheetName: "Summary", range: "A1:H11", fileName: "knauf_plasterboard_distributors_preview.png" },
  { sheetName: "Contacts", range: "A1:M20", fileName: "knauf_plasterboard_distributors_contacts_preview.png" },
  { sheetName: "Raw Scrape", range: "A1:M20", fileName: "knauf_plasterboard_distributors_raw_preview.png" },
];

for (const spec of previewSpecs) {
  const preview = await workbook.render({
    sheetName: spec.sheetName,
    range: spec.range,
    scale: 1,
    format: "png",
  });
  await fs.writeFile(path.join(outputDir, spec.fileName), new Uint8Array(await preview.arrayBuffer()));
}

const overview = await workbook.inspect({
  kind: "workbook,sheet,table",
  maxChars: 5000,
  tableMaxRows: 4,
  tableMaxCols: 6,
});
console.log(overview.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "formula error scan",
});
console.log(errors.ndjson);

const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await fs.mkdir(outputDir, { recursive: true });
await xlsx.save(outputPath);

console.log(JSON.stringify({
  outputPath,
  previewPath,
  rawRows: rows.length,
  uniqueRows: cleanRows.length,
}, null, 2));
