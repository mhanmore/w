# London planning delegation report

Static, mobile-first report on London borough implementation of the National
Scheme of Delegation of planning functions.

Published path: `https://mhanmore.github.io/w/london-planning-delegation/`

## Data

- `data/boroughs.csv` is the underlying 32-borough research table.
- `data/authorities.csv` is the mapped report table, including the City.
- `data/knowledge-graph.jsonld` is the reusable linked-data version.
- `data/boroughs.geojson` joins that research to the official London Datastore
  borough layer, includes the City polygon, and is simplified for browser delivery.

The City of London is mapped as a separately labelled supplementary authority,
but is excluded from the report denominator because it is not a London borough.
Boundary data is supplied by the Greater London Authority under the Open
Government Licence v3.0.

## Refreshing the map data

From this directory:

```sh
python3 scripts/build-data.py \
  --research-csv /path/to/boroughs.csv \
  --knowledge-graph /path/to/knowledge-graph.jsonld
```

The script uses only the Python standard library. It downloads the current
London Datastore ArcGIS layer, verifies a complete 33-area map join, simplifies
the geometry, and copies the source CSV and JSON-LD into `data/`.

## Stack

Plain HTML, CSS and JavaScript; MapLibre GL JS; OpenFreeMap Liberty basemap. No
build or server runtime is required.
