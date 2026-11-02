#!/usr/bin/env bash
# Simplify LPA polygons for the web. Requires mapshaper. Run after build-data.py.
set -euo pipefail
cd "$(dirname "$0")/../data"
mapshaper lpa-full.geojson -simplify 1.2% weighting=0.7 keep-shapes -clean \
  -o format=geojson precision=0.0001 lpa.geojson
rm lpa-full.geojson
