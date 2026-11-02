#!/usr/bin/env python3
"""Build the nationwide National Scheme of Delegation map data.

Inputs
  1. planning.data.gov.uk Local Planning Authority CSV
     https://files.planning.data.gov.uk/dataset/local-planning-authority.csv
  2. data/authorities.csv — the research table (created blank if missing;
     existing research rows are preserved).

Outputs (in ../data)
  lpa-full.geojson   current LPA polygons keyed by code (simplify.sh makes lpa.geojson)
  authorities.csv    research table, one row per current LPA, ordered south to north
  authorities.json   research table for the browser

Usage: python3 build-data.py /path/to/local-planning-authority.csv
"""
import csv
import json
import re
import sys
from pathlib import Path

from shapely import wkt
from shapely.geometry import mapping

FIELDS = ["id", "name", "lpa_code", "kind", "south_rank", "status", "status_label", "adopted", "date",
          "confidence", "evidence_type", "evidence_summary", "official_site", "primary_source",
          "secondary_source", "checked_at", "checked_by"]

STATUS_LABELS = {
    "no_data": "No data yet",
    "adopted": "Adoption evidenced",
    "implementation_confirmed_formal_resolution_not_located": "Implemented; resolution not located",
    "pending_formal_adoption": "Formal adoption pending",
    "scheduled_outcome_unconfirmed": "Outcome not yet confirmed",
    "no_evidence_found": "No published evidence found",
}

DATA = Path(__file__).resolve().parent.parent / "data"


def kind(name: str) -> str:
    if "National Park" in name or name == "The Broads Authority":
        return "national_park"
    if "Development Corporation" in name:
        return "development_corporation"
    return "council"


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def main(src: str) -> None:
    csv.field_size_limit(sys.maxsize)
    rows = [r for r in csv.DictReader(open(src, newline="")) if not r["end-date"]]
    lat = lambda r: float(r["point"].split()[2].rstrip(")"))
    rows.sort(key=lat)

    existing = {}
    research = DATA / "authorities.csv"
    if research.exists():
        existing = {r["lpa_code"]: r for r in csv.DictReader(open(research, newline=""))}

    records, features = [], []
    for rank, r in enumerate(rows, start=1):
        name = r["name"].removesuffix(" LPA")
        base = {"id": f"lpa:{slug(name)}", "name": name, "lpa_code": r["reference"], "kind": kind(name),
                "south_rank": str(rank), "status": "no_data"}
        rec = {f: "" for f in FIELDS} | base
        if r["reference"] in existing:
            rec |= {k: v for k, v in existing[r["reference"]].items() if k in FIELDS and v != ""}
            rec["south_rank"] = str(rank)
        if rec["status"] not in STATUS_LABELS:
            raise SystemExit(f"Unknown status {rec['status']} for {name}")
        rec["status_label"] = STATUS_LABELS[rec["status"]]
        records.append(rec)
        features.append({"type": "Feature", "properties": {"code": r["reference"], "name": name},
                         "geometry": mapping(wkt.loads(r["geometry"]))})

    with open(research, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(records)
    (DATA / "authorities.json").write_text(json.dumps(records, indent=1))
    (DATA / "lpa-full.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    done = sum(r["status"] != "no_data" for r in records)
    print(f"{len(records)} LPAs; {done} with research records")


if __name__ == "__main__":
    main(sys.argv[1])
