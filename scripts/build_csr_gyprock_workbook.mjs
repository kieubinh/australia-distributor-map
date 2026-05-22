import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const workspaceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(workspaceDir, "outputs", "csr_gyprock_suppliers");
const outputPath = path.join(outputDir, "csr_gyprock_suppliers.xlsx");
const apiUrl = "https://www.gyprock.com.au/api/pim/stores/search?fields=FULL&pageSize=2500";
const pageUrl = "https://www.gyprock.com.au/contact-us/find-us/find-a-supplier";

await fs.mkdir(outputDir, { recursive: true });

const response = await fetch(apiUrl, {
  headers: {
    accept: "application/json",
    "user-agent": "Mozilla/5.0",
  },
});

if (!response.ok) {
  throw new Error(`CSR Gyprock API returned ${response.status}`);
}

const payload = await response.json();
const stores = payload?.result?.stores ?? [];
const fetchedAt = new Date();

await fs.writeFile(path.join(outputDir, "csr_gyprock_suppliers_api.json"), JSON.stringify(payload, null, 2), "utf8");

const titleCaseSlug = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "&")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

function openingHourText(day) {
  if (!day) return "";
  if (day.specialMessage) return clean(day.specialMessage);
  const open = day.openingTime?.formattedHour;
  const close = day.closingTime?.formattedHour;
  return open && close ? `${open} - ${close}` : "";
}

function openingHoursByDay(store) {
  const order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const source = store.openingHours?.weekDayOpeningList ?? [];
  const byDay = new Map(source.map((day) => [day.weekDay, openingHourText(day)]));
  return Object.fromEntries(order.map((day) => [day, byDay.get(day) ?? ""]));
}

function detailUrl(store) {
  const slugSource = store.name || store.displayName;
  const slug = titleCaseSlug(slugSource);
  return slug ? `${pageUrl}/${slug}` : pageUrl;
}

function directionsUrl(store) {
  const lat = store.geoPoint?.latitude;
  const lng = store.geoPoint?.longitude;
  return lat && lng ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` : "";
}

function inferState(address) {
  const town = clean(address?.town).toLowerCase();
  const postcode = Number(address?.postalCode);
  if (town.includes("queanbeyan")) return "NSW";
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

const supplierRows = stores
  .map((store, index) => {
    const address = store.address ?? {};
    const region = address.region ?? {};
    const hours = openingHoursByDay(store);
    const state = clean(region.isocodeShort) || inferState(address);
    const fullAddress = [
      address.line1,
      address.town,
      state,
      address.postalCode,
    ].filter(Boolean).join(", ");
    return {
      apiOrder: index + 1,
      distributorType: (store.posLocationType ?? []).join("; "),
      name: clean(store.displayName || store.name),
      apiName: clean(store.name),
      contactPhone: clean(address.phone),
      email: clean(address.email),
      addressLine1: clean(address.line1),
      suburbTown: clean(address.town),
      state,
      postcode: clean(address.postalCode),
      country: clean(address.country?.name || address.country?.isocode),
      fullAddress,
      latitude: store.geoPoint?.latitude ?? null,
      longitude: store.geoPoint?.longitude ?? null,
      mon: hours.Mon,
      tue: hours.Tue,
      wed: hours.Wed,
      thu: hours.Thu,
      fri: hours.Fri,
      sat: hours.Sat,
      sun: hours.Sun,
      productTypes: (store.posProductType ?? []).join("; "),
      websiteUrl: clean(store.websiteUrl),
      detailsUrl: detailUrl(store),
      directionsUrl: directionsUrl(store),
      rawAddressId: clean(address.id),
      sourceApiUrl: apiUrl,
      rawJson: JSON.stringify(store),
    };
  })
  .sort((a, b) =>
    a.distributorType.localeCompare(b.distributorType) ||
    a.state.localeCompare(b.state) ||
    a.name.localeCompare(b.name)
  )
  .map((row, index) => ({ no: index + 1, ...row }));

const countBy = (rows, field) => {
  const counts = new Map();
  for (const row of rows) {
    const key = row[field] || "Not specified";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
};

const typeCounts = countBy(supplierRows, "distributorType");
const stateCounts = countBy(supplierRows, "state");
const emailCount = supplierRows.filter((row) => row.email).length;
const phoneCount = supplierRows.filter((row) => row.contactPhone).length;

const workbook = Workbook.create();
const summary = workbook.worksheets.add("Summary");
const suppliers = workbook.worksheets.add("Suppliers");
const rawApi = workbook.worksheets.add("Raw API");

for (const sheet of [summary, suppliers, rawApi]) {
  sheet.showGridLines = false;
}

const titleFill = "#7B1E24";
const sectionFill = "#F5DADC";
const headerFill = "#B43A42";
const softFill = "#FAF7F7";
const noteFill = "#FFF2CC";
const borderColor = "#E5D7D9";

summary.getRange("A1:H1").merge();
summary.getRange("A1").values = [["CSR Gyprock Supplier Contacts"]];
summary.getRange("A1").format = {
  fill: titleFill,
  font: { bold: true, color: "#FFFFFF", size: 16 },
  horizontalAlignment: "center",
  verticalAlignment: "middle",
};
summary.getRange("A1").format.rowHeightPx = 34;

summary.getRange("A3:B9").values = [
  ["Source page", pageUrl],
  ["Source API", apiUrl],
  ["Fetched at (UTC)", fetchedAt],
  ["Supplier rows", supplierRows.length],
  ["Rows with email", emailCount],
  ["Rows with phone", phoneCount],
  ["Rows missing contact fields", supplierRows.length - Math.min(emailCount, phoneCount)],
];
summary.getRange("A3:A9").format = {
  fill: sectionFill,
  font: { bold: true, color: "#3A1719" },
};
summary.getRange("B3:B9").format = {
  fill: softFill,
  wrapText: true,
};
summary.getRange("B5").format.numberFormat = "yyyy-mm-dd hh:mm:ss \"UTC\"";

summary.getRange("D3:E3").values = [["Suppliers by Type", "Count"]];
summary.getRange(`D4:E${3 + typeCounts.length}`).values = typeCounts.map(([key, count]) => [key, count]);
summary.getRange("G3:H3").values = [["Suppliers by State", "Count"]];
summary.getRange(`G4:H${3 + stateCounts.length}`).values = stateCounts.map(([key, count]) => [key, count]);

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

const noteRow = Math.max(11, 5 + Math.max(typeCounts.length, stateCounts.length));
const noteTextRow = noteRow + 1;
summary.getRange(`A${noteRow}:H${noteRow}`).merge();
summary.getRange(`A${noteTextRow}:H${noteTextRow}`).merge();
summary.getRange(`A${noteRow}`).values = [["Note"]];
summary.getRange(`A${noteTextRow}`).values = [["Data comes from the CSR Gyprock supplier locator API used by the public page. Product type fields are blank in the API for every row, so distributor type is taken from the location type field. One API row had no region code; its state was inferred from Queanbeyan West 2620."]];
summary.getRange(`A${noteRow}`).format = {
  fill: noteFill,
  font: { bold: true, color: "#7A5B00" },
};
summary.getRange(`A${noteTextRow}`).format = {
  fill: "#FFF9E6",
  wrapText: true,
};
summary.getRange(`${noteTextRow}:${noteTextRow}`).format.rowHeightPx = 42;

summary.getRange("A:A").format.columnWidthPx = 205;
summary.getRange("B:B").format.columnWidthPx = 560;
summary.getRange("C:C").format.columnWidthPx = 28;
summary.getRange("D:D").format.columnWidthPx = 230;
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

const supplierHeaders = [
  "No.",
  "Distributor Type",
  "Name",
  "Contact Phone",
  "Email",
  "Address",
  "Address Line 1",
  "Suburb / Town",
  "State",
  "Postcode",
  "Country",
  "Latitude",
  "Longitude",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
  "Product Types",
  "Details URL",
  "Directions URL",
  "Source API URL",
];

const supplierValues = supplierRows.map((row) => [
  row.no,
  row.distributorType,
  row.name,
  row.contactPhone,
  row.email,
  row.fullAddress,
  row.addressLine1,
  row.suburbTown,
  row.state,
  row.postcode,
  row.country,
  row.latitude,
  row.longitude,
  row.mon,
  row.tue,
  row.wed,
  row.thu,
  row.fri,
  row.sat,
  row.sun,
  row.productTypes,
  row.detailsUrl,
  row.directionsUrl,
  row.sourceApiUrl,
]);

suppliers.getRangeByIndexes(0, 0, 1, supplierHeaders.length).values = [supplierHeaders];
suppliers.getRangeByIndexes(1, 0, supplierValues.length, supplierHeaders.length).values = supplierValues;
const suppliersLastRow = supplierValues.length + 1;
suppliers.tables.add(`A1:X${suppliersLastRow}`, true, "CSRGyprockSuppliers");
suppliers.freezePanes.freezeRows(1);

const rawHeaders = [
  "No.",
  "API Order",
  "Distributor Type",
  "Display Name",
  "API Name",
  "Address ID",
  "Phone",
  "Email",
  "Formatted Address",
  "Opening Hours JSON",
  "Raw Store JSON",
];
const rawValues = supplierRows.map((row) => [
  row.no,
  row.apiOrder,
  row.distributorType,
  row.name,
  row.apiName,
  row.rawAddressId,
  row.contactPhone,
  row.email,
  row.fullAddress,
  JSON.stringify({
    Mon: row.mon,
    Tue: row.tue,
    Wed: row.wed,
    Thu: row.thu,
    Fri: row.fri,
    Sat: row.sat,
    Sun: row.sun,
  }),
  row.rawJson,
]);
rawApi.getRangeByIndexes(0, 0, 1, rawHeaders.length).values = [rawHeaders];
rawApi.getRangeByIndexes(1, 0, rawValues.length, rawHeaders.length).values = rawValues;
const rawLastRow = rawValues.length + 1;
rawApi.tables.add(`A1:K${rawLastRow}`, true, "CSRGyprockRawAPI");
rawApi.freezePanes.freezeRows(1);

function styleTableSheet(sheet, lastRow, lastColLetter, isRaw = false) {
  sheet.getRange(`A1:${lastColLetter}1`).format = {
    fill: headerFill,
    font: { bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
    verticalAlignment: "middle",
    wrapText: true,
  };
  sheet.getRange(`A2:${lastColLetter}${lastRow}`).format = {
    borders: {
      insideHorizontal: { color: borderColor },
      insideVertical: { color: borderColor },
    },
    verticalAlignment: "top",
  };
  sheet.getRange(`A2:A${lastRow}`).format.horizontalAlignment = "right";
  sheet.getRange(`I2:J${lastRow}`).format.horizontalAlignment = "center";
  sheet.getRange(`L2:M${lastRow}`).format.numberFormat = "0.000000";
  sheet.getRange(`N2:T${lastRow}`).format.wrapText = true;
  sheet.getRange(`V2:X${lastRow}`).format.wrapText = true;
  sheet.getRange("A:A").format.columnWidthPx = 52;
  sheet.getRange("B:B").format.columnWidthPx = 190;
  sheet.getRange("C:C").format.columnWidthPx = 260;
  sheet.getRange("D:D").format.columnWidthPx = 135;
  sheet.getRange("E:E").format.columnWidthPx = 240;
  sheet.getRange("F:F").format.columnWidthPx = 330;
  sheet.getRange("G:G").format.columnWidthPx = 230;
  sheet.getRange("H:H").format.columnWidthPx = 150;
  sheet.getRange("I:I").format.columnWidthPx = 66;
  sheet.getRange("J:J").format.columnWidthPx = 82;
  sheet.getRange("K:K").format.columnWidthPx = 90;
  sheet.getRange("L:M").format.columnWidthPx = 92;
  sheet.getRange("N:T").format.columnWidthPx = 118;
  sheet.getRange("U:U").format.columnWidthPx = 120;
  sheet.getRange("V:X").format.columnWidthPx = 320;
  sheet.getRange(`A2:${lastColLetter}${lastRow}`).format.rowHeightPx = isRaw ? 52 : 34;
}

styleTableSheet(suppliers, suppliersLastRow, "X");

rawApi.getRange("A1:K1").format = {
  fill: headerFill,
  font: { bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  verticalAlignment: "middle",
  wrapText: true,
};
rawApi.getRange(`A2:K${rawLastRow}`).format = {
  borders: {
    insideHorizontal: { color: borderColor },
    insideVertical: { color: borderColor },
  },
  verticalAlignment: "top",
};
rawApi.getRange("A:A").format.columnWidthPx = 52;
rawApi.getRange("B:B").format.columnWidthPx = 76;
rawApi.getRange("C:C").format.columnWidthPx = 190;
rawApi.getRange("D:E").format.columnWidthPx = 260;
rawApi.getRange("F:F").format.columnWidthPx = 130;
rawApi.getRange("G:G").format.columnWidthPx = 135;
rawApi.getRange("H:H").format.columnWidthPx = 240;
rawApi.getRange("I:I").format.columnWidthPx = 330;
rawApi.getRange("J:K").format.columnWidthPx = 360;
rawApi.getRange(`J2:K${rawLastRow}`).format.wrapText = true;
rawApi.getRange(`A2:K${rawLastRow}`).format.rowHeightPx = 52;

const previews = [
  { sheetName: "Summary", range: `A1:H${noteTextRow}`, fileName: "csr_gyprock_suppliers_summary.png" },
  { sheetName: "Suppliers", range: "A1:X20", fileName: "csr_gyprock_suppliers_table.png" },
  { sheetName: "Raw API", range: "A1:K12", fileName: "csr_gyprock_suppliers_raw.png" },
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
  sourcePage: pageUrl,
  sourceApi: apiUrl,
  supplierRows: supplierRows.length,
  rowsWithEmail: emailCount,
  rowsWithPhone: phoneCount,
}, null, 2));
