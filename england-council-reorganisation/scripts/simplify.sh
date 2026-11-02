#!/usr/bin/env bash
# Simplify and dissolve the full-resolution district layer for the web.
# Requires mapshaper (npm i -g mapshaper). Run after build-data.py.
set -euo pipefail
cd "$(dirname "$0")/../data"

# Districts: simplified, with properties kept for split hatching and context lines.
mapshaper districts-full.geojson \
  -simplify 1.2% weighting=0.7 keep-shapes \
  -clean \
  -o format=geojson precision=0.0001 districts.geojson

# Successor units: dissolve districts by proposed unit.
mapshaper districts.geojson \
  -filter 'unit_id !== ""' \
  -dissolve unit_id copy-fields=unit,area,area_id,status,original_status \
  -o format=geojson precision=0.0001 units.geojson

# Reorganisation area outlines.
mapshaper units.geojson -dissolve area_id copy-fields=area,status -o format=geojson precision=0.0001 areas.geojson

# Label points at each unit's interior.
mapshaper units.geojson -points inner -o format=geojson precision=0.0001 unit-labels.geojson

rm districts-full.geojson
ls -la
