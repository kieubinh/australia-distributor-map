import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const workspaceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(workspaceDir, "outputs", "siniat_distributors");
const inputPath = path.join(outputDir, "siniat_distributors.json");
const outputPath = path.join(outputDir, "siniat_distributors.xlsx");

const payload = JSON.parse(await fs.readFile(inputPath, "utf8"));
const records = payload.records ?? [];
const scrapedAt = payload.scrapedAt ? new Date(payload.scrapedAt) : new Date();
const sourceUrl = payload.sourceUrl || "https://www.siniat.com.au/en-au/contact-us/siniat-distributors/";

const countBy = (field) => {
  const counts = new Map();
  for (const record of records) {
    const key = record[field] || "Not specified";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
};

const distributorRows = records
  .map((record, index) => ({
    no: index + 1,
    sourceOrder: record.sourceOrder ?? index + 1,
    distributorType: record.distributorType || "Siniat Distributor",
    regionGroup: record.regionGroup ?? "",
    state: record.state ?? "",
    name: record.name ?? record.listingName ?? "",
    listingName: record.listingName ?? "",
    phone: record.phone ?? "",
    email: record.email ?? "",
    website: record.website ?? "",
    address: record.address ?? "",
    locality: record.locality ?? "",
    postcode: record.postcode ?? "",
    openingHours: record.openingHours ?? "",
    sourceUrl: record.sourceUrl ?? "",
    sourceListingUrl: record.sourceListingUrl ?? sourceUrl,
    pageTitle: record.pageTitle ?? "",
    rawContactText: record.rawContactText ?? "",
  }))
  .sort((a, b) =>
    a.regionGroup.localeCompare(b.regionGroup) ||
    a.state.localeCompare(b.state) ||
    a.name.localeCompare(b.name)
  )
  .map((row, index) => ({ ...row, no: index + 1 }));

const regionCounts = countBy("regionGroup");
const stateCounts = countBy("state");
const emailCount = records.filter((record) => record.email).length;
const phoneCount = records.filter((record) => record.phone).length;
const websiteCount = records.filter((record) => record.website).length;

const workbook = Workbook.create();
const summary = workbook.worksheets.add("Summary");
const distributors = workbook.worksheets.add("Distributors");
const raw = workbook.worksheets.add("Raw Scrape");

for (const sheet of [summary, distributors, raw]) {
  sheet.showGridLines = false;
}

const titleFill = "#125B5B";
const sectionFill = "#DCEFEF";
const headerFill = "#218080";
const softFill = "#F6FAFA";
const noteFill = "#FFF2CC";
const borderColor = "#D7E6E6";

summary.getRange("A1:H1").merge();
summary.getRange("A1").values = [["Siniat Distributor Contacts"]];
summary.getRange("A1").format = {
  fill: titleFill,
  font: { bold: true, color: "#FFFFFF", size: 16 },
  horizontalAlignment: "center",
  verticalAlignment: "middle",
};
summary.getRange("A1").format.rowHeightPx = 34;

summary.getRange("A3:B9").values = [
  ["Source page", sourceUrl],
  ["Scraped at (UTC)", scrapedAt],
  ["Distributor rows", distributorRows.length],
  ["Rows with email", emailCount],
  ["Rows with phone", phoneCount],
  ["Rows with website", websiteCount],
  ["Rows missing contact fields", records.length - Math.min(emailCount, phoneCount)],
];
summary.getRange("A3:A9").format = {
  fill: sectionFill,
  font: { bold: true, color: "#163B3B" },
};
summary.getRange("B3:B9").format = {
  fill: softFill,
  wrapText: true,
};
summary.getRange("B4").format.numberFormat = "yyyy-mm-dd hh:mm:ss \"UTC\"";

summary.getRange("D3:E3").values = [["Distributors by Region", "Count"]];
summary.getRange(`D4:E${3 + regionCounts.length}`).values = regionCounts.map(([key, count]) => [key, count]);
summary.getRange("G3:H3").values = [["Distributors by State", "Count"]];
summary.getRange(`G4:H${3 + stateCounts.length}`).values = stateCounts.map(([key, count]) => [key, count]);

for (const rangeAddress of ["D3:E3", "G3:H3"]) {
  summary.getRange(rangeAddress).format = {
    fill: headerFill,
    font: { bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
  };
}

for (const rangeAddress of [`D4:E${3 + regionCounts.length}`, `G4:H${3 + stateCounts.length}`]) {
  summary.getRange(rangeAddress).format = {
    fill: softFill,
    borders: {
      insideHorizontal: { color: borderColor },
      insideVertical: { color: borderColor },
    },
  };
}

const noteRow = Math.max(11, 5 + Math.max(regionCounts.length, stateCounts.length));
const noteTextRow = noteRow + 1;
summary.getRange(`A${noteRow}:H${noteRow}`).merge();
summary.getRange(`A${noteTextRow}:H${noteTextRow}`).merge();
summary.getRange(`A${noteRow}`).values = [["Note"]];
summary.getRange(`A${noteTextRow}`).values = [["The source page lists all entries as Siniat distributors and does not publish finer-grained distributor subtypes, so Distributor Type is set to Siniat Distributor for every row."]];
summary.getRange(`A${noteRow}`).format = {
  fill: noteFill,
  font: { bold: true, color: "#7A5B00" },
};
summary.getRange(`A${noteTextRow}`).format = {
  fill: "#FFF9E6",
  wrapText: true,
};
summary.getRange(`${noteTextRow}:${noteTextRow}`).format.rowHeightPx = 34;

summary.getRange("A:A").format.columnWidthPx = 205;
summary.getRange("B:B").format.columnWidthPx = 540;
summary.getRange("C:C").format.columnWidthPx = 28;
summary.getRange("D:D").format.columnWidthPx = 210;
summary.getRange("E:E").format.columnWidthPx = 80;
summary.getRange("F:F").format.columnWidthPx = 28;
summary.getRange("G:G").format.columnWidthPx = 140;
summary.getRange("H:H").format.columnWidthPx = 80;
summary.getRange(`A3:H${noteTextRow}`).format = {
  borders: {
    insideHorizontal: { color: borderColor },
    insideVertical: { color: borderColor },
  },
};
summary.getRange(`A3:H${noteTextRow}`).format.verticalAlignment = "top";

const distributorHeaders = [
  "No.",
  "Distributor Type",
  "Region Group",
  "State",
  "Name",
  "Listing Name",
  "Contact Phone",
  "Email",
  "Website",
  "Address",
  "Locality",
  "Postcode",
  "Opening Hours",
  "Source URL",
  "Source Listing URL",
];

const distributorValues = distributorRows.map((row) => [
  row.no,
  row.distributorType,
  row.regionGroup,
  row.state,
  row.name,
  row.listingName,
  row.phone,
  row.email,
  row.website,
  row.address,
  row.locality,
  row.postcode,
  row.openingHours,
  row.sourceUrl,
  row.sourceListingUrl,
]);

distributors.getRangeByIndexes(0, 0, 1, distributorHeaders.length).values = [distributorHeaders];
distributors.getRangeByIndexes(1, 0, distributorValues.length, distributorHeaders.length).values = distributorValues;
const distributorLastRow = distributorValues.length + 1;
distributors.tables.add(`A1:O${distributorLastRow}`, true, "SiniatDistributors");
distributors.freezePanes.freezeRows(1);

const rawHeaders = [
  "No.",
  "Source Order",
  "Distributor Type",
  "Region Group",
  "State",
  "Name",
  "Listing Name",
  "Phone",
  "Email",
  "Website",
  "Address",
  "Opening Hours",
  "Page Title",
  "Source URL",
  "Raw Contact Text",
];
const rawValues = distributorRows.map((row) => [
  row.no,
  row.sourceOrder,
  row.distributorType,
  row.regionGroup,
  row.state,
  row.name,
  row.listingName,
  row.phone,
  row.email,
  row.website,
  row.address,
  row.openingHours,
  row.pageTitle,
  row.sourceUrl,
  row.rawContactText,
]);
raw.getRangeByIndexes(0, 0, 1, rawHeaders.length).values = [rawHeaders];
raw.getRangeByIndexes(1, 0, rawValues.length, rawHeaders.length).values = rawValues;
const rawLastRow = rawValues.length + 1;
raw.tables.add(`A1:O${rawLastRow}`, true, "SiniatRawScrape");
raw.freezePanes.freezeRows(1);

function styleDataSheet(sheet, lastRow, isRaw = false) {
  sheet.getRange("A1:O1").format = {
    fill: headerFill,
    font: { bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
    verticalAlignment: "middle",
    wrapText: true,
  };
  sheet.getRange(`A2:O${lastRow}`).format = {
    borders: {
      insideHorizontal: { color: borderColor },
      insideVertical: { color: borderColor },
    },
    verticalAlignment: "top",
  };
  sheet.getRange(`A2:A${lastRow}`).format.horizontalAlignment = "right";
  sheet.getRange(`D2:D${lastRow}`).format.horizontalAlignment = "center";
  sheet.getRange(`L2:L${lastRow}`).format.horizontalAlignment = "center";
  sheet.getRange(`J2:J${lastRow}`).format.wrapText = true;
  sheet.getRange(`M2:O${lastRow}`).format.wrapText = true;
  sheet.getRange("A:A").format.columnWidthPx = 52;
  sheet.getRange("B:B").format.columnWidthPx = 150;
  sheet.getRange("C:C").format.columnWidthPx = 120;
  sheet.getRange("D:D").format.columnWidthPx = 70;
  sheet.getRange("E:E").format.columnWidthPx = 250;
  sheet.getRange("F:F").format.columnWidthPx = 250;
  sheet.getRange("G:G").format.columnWidthPx = 135;
  sheet.getRange("H:H").format.columnWidthPx = 250;
  sheet.getRange("I:I").format.columnWidthPx = 240;
  sheet.getRange("J:J").format.columnWidthPx = 330;
  sheet.getRange("K:K").format.columnWidthPx = 135;
  sheet.getRange("L:L").format.columnWidthPx = 80;
  sheet.getRange("M:M").format.columnWidthPx = 260;
  sheet.getRange("N:O").format.columnWidthPx = isRaw ? 330 : 320;
  sheet.getRange(`A2:O${lastRow}`).format.rowHeightPx = isRaw ? 54 : 34;
}

styleDataSheet(distributors, distributorLastRow);
styleDataSheet(raw, rawLastRow, true);

const previews = [
  { sheetName: "Summary", range: `A1:H${noteTextRow}`, fileName: "siniat_distributors_summary.png" },
  { sheetName: "Distributors", range: "A1:O20", fileName: "siniat_distributors_table.png" },
  { sheetName: "Raw Scrape", range: "A1:O12", fileName: "siniat_distributors_raw.png" },
];

for (const spec of previews) {
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
  tableMaxCols: 8,
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
await xlsx.save(outputPath);

console.log(JSON.stringify({
  outputPath,
  sourceUrl,
  distributorRows: distributorRows.length,
  rowsWithEmail: emailCount,
  rowsWithPhone: phoneCount,
  rowsWithWebsite: websiteCount,
}, null, 2));
