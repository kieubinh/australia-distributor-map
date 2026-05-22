# Australia Distributor Map

Australia Distributor Map is a static browser app for exploring plasterboard distributor locations across Australia. It combines distributor data for Knauf, CSR Gyprock, and Siniat into a searchable MapLibre map with supporting source outputs and workbook exports.

## What Is Included

- `app/` - The map interface, styles, and bundled distributor dataset.
- `scripts/` - Data collection, preparation, workbook generation, and local serving utilities.
- `outputs/` - Generated JSON files, workbook exports, screenshots, and preview artifacts.

## Run The Map

```powershell
node scripts/serve_map_app.mjs
```

Then open `http://127.0.0.1:5173/`.

## Data

The map data is generated from the brand-specific source outputs and written to `app/data/distributors.json`. The generated workbooks and previews are kept in `outputs/` for review and sharing.

## Repository Notes

Local dependency folders, logs, environment files, Python caches, and deployment metadata are intentionally ignored.
