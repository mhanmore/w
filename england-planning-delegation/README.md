# England planning delegation report (in progress)

Nationwide version of the London National Scheme of Delegation review, covering all 308 current English local planning authorities.

Published path: `https://mhanmore.github.io/w/england-planning-delegation/`

## Data

- `data/authorities.csv` — the research table, one row per current LPA, ordered south to north (`south_rank`). Unresearched rows have status `no_data` and are cross-hatched on the map.
- `data/authorities.json` — the same table for the browser; the map, legend counts, progress count and table are all built from it.
- `data/lpa.geojson` — simplified LPA polygons keyed by `code`.

Statuses: `adopted`, `implementation_confirmed_formal_resolution_not_located`, `pending_formal_adoption`, `scheduled_outcome_unconfirmed`, `no_evidence_found`, `no_data`. `no_evidence_found` means a search found nothing; it is not a finding of non-adoption. `checked_by` records whether a row came from an AI worker and whether its positive finding was re-checked.

The summary figures in the page are deliberately "TBC" until the review is complete.

## Rebuild

```sh
curl -LO https://files.planning.data.gov.uk/dataset/local-planning-authority.csv
python3 scripts/build-data.py local-planning-authority.csv   # preserves research rows in data/authorities.csv
bash scripts/simplify.sh                                      # needs mapshaper
```

Boundaries: planning.data.gov.uk (ONS), OGL v3; contains OS data © Crown copyright 2026. Basemap: OpenFreeMap.
