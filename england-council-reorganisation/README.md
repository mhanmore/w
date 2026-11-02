# England council reorganisation map

Status map of England's local government reorganisation programme at 2 November 2026, with a toggle to show the decisions as originally announced (Surrey October 2025; 25 March and 16 July 2026, vesting April 2028).

Live page: https://mhanmore.github.io/w/england-council-reorganisation/

## Data

- `data/areas.json` / `data/areas.csv` — one record per area and proposed council: current status, original announcement, member districts, split districts and sources.
- `data/districts.geojson` — all 296 current English districts and unitaries, tagged with area, status, proposed council and split flag.
- `data/units.geojson`, `data/areas.geojson`, `data/unit-labels.geojson` — proposed councils and area outlines, dissolved from districts.

## Rebuild

```sh
curl -LO https://files.planning.data.gov.uk/dataset/local-authority-district.csv
python3 scripts/build-data.py local-authority-district.csv
bash scripts/simplify.sh   # needs mapshaper
```

## Limits

Districts that proposals split at parish or ward level are drawn whole in the council receiving the remainder and hatched; the transfers are described in the data but not drawn. Structures for withdrawn decisions are kept for reference only. Council names are working names from announcements.

Boundaries: planning.data.gov.uk (ONS), OGL v3; contains OS data © Crown copyright 2026. Basemap: OpenFreeMap.
