# Distributor Collection

Static distributor map and supporting data collection outputs for Australian plasterboard distributors across Knauf, CSR Gyprock, and Siniat.

## Contents

- `app/` - MapLibre-based browser app and bundled distributor data.
- `scripts/` - Collection, data preparation, workbook, and local serving scripts.
- `outputs/` - Generated JSON, workbook, and preview artifacts used by the app and reports.

## Run The Map

```powershell
node scripts/serve_map_app.mjs
```

Then open `http://127.0.0.1:5173/`.

## Notes

Local dependency folders, logs, environment files, and deployment metadata are intentionally ignored.
