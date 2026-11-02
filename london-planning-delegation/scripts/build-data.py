#!/usr/bin/env python3
"""Build browser-ready borough data from the London Datastore and research CSV."""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import urllib.parse
import urllib.request
from pathlib import Path


LAYER_URL = (
    "https://gis.london.gov.uk/arcgis/rest/services/apps/"
    "webmap_context_layer/MapServer/3/query"
)

NAME_ALIASES = {
    "Greenwich": "Royal Borough of Greenwich",
    "Hammersmith and Fulham": "Hammersmith and Fulham",
    "Kensington and Chelsea": "Kensington and Chelsea",
    "Westminster": "Westminster",
}

STATUS_LABELS = {
    "adopted": "Adoption evidenced",
    "implementation_confirmed_formal_resolution_not_located": (
        "Implemented; resolution not located"
    ),
    "pending_formal_adoption": "Formal adoption pending",
    "scheduled_outcome_unconfirmed": "Outcome not yet confirmed",
    "not_assessed_supplementary": "Supplementary; implementation not confirmed",
}

CITY_RESEARCH = {
    "id": "city-of-london-corporation",
    "borough": "City of London Corporation",
    "official_site": "https://www.cityoflondon.gov.uk/",
    "status": "not_assessed_supplementary",
    "adopted": "",
    "decision_or_evidence_date": "",
    "confidence": "low",
    "evidence_type": "official_consultation_report",
    "evidence_summary": (
        "The City is not a London borough. Consultation-stage material was located, "
        "but no 2026 implementation decision was confirmed in this AI-only review."
    ),
    "primary_source": (
        "https://democracy.cityoflondon.gov.uk/documents/s213937/"
        "Committee%20report%20-%20Modernising%20Planning%20Committees.pdf"
    ),
    "secondary_source": "",
    "checked_at": "2026-11-02",
}


def sq_distance(point: list[float], start: list[float], end: list[float]) -> float:
    x, y = start
    dx = end[0] - x
    dy = end[1] - y
    if dx or dy:
        t = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy)
        if t > 1:
            x, y = end
        elif t > 0:
            x += dx * t
            y += dy * t
    dx = point[0] - x
    dy = point[1] - y
    return dx * dx + dy * dy


def simplify_line(points: list[list[float]], tolerance: float) -> list[list[float]]:
    if len(points) <= 2:
        return points
    threshold = tolerance * tolerance
    markers = {0, len(points) - 1}
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        furthest = threshold
        index = None
        for i in range(first + 1, last):
            distance = sq_distance(points[i], points[first], points[last])
            if distance > furthest:
                furthest = distance
                index = i
        if index is not None:
            markers.add(index)
            stack.extend(((first, index), (index, last)))
    return [point for i, point in enumerate(points) if i in markers]


def simplify_ring(ring: list[list[float]], tolerance: float) -> list[list[float]]:
    if len(ring) < 5:
        return ring
    open_ring = ring[:-1] if ring[0] == ring[-1] else ring
    # Split at the point furthest from the first so a closed ring has two useful arcs.
    pivot = max(
        range(1, len(open_ring)),
        key=lambda i: sq_distance(open_ring[i], open_ring[0], open_ring[0]),
    )
    first = simplify_line(open_ring[: pivot + 1], tolerance)
    second = simplify_line(open_ring[pivot:] + [open_ring[0]], tolerance)
    result = first[:-1] + second
    if len(result) < 4:
        return ring
    result[-1] = result[0]
    return [[round(x, 5), round(y, 5)] for x, y in result]


def simplify_geometry(geometry: dict, tolerance: float) -> dict:
    if geometry["type"] == "Polygon":
        coordinates = [simplify_ring(ring, tolerance) for ring in geometry["coordinates"]]
    elif geometry["type"] == "MultiPolygon":
        coordinates = [
            [simplify_ring(ring, tolerance) for ring in polygon]
            for polygon in geometry["coordinates"]
        ]
    else:
        raise ValueError(f"Unsupported geometry type: {geometry['type']}")
    return {"type": geometry["type"], "coordinates": coordinates}


def fetch_boundaries() -> dict:
    query = urllib.parse.urlencode(
        {
            "where": "1=1",
            "outFields": "name,gss_code,hectares,ons_inner,sub_2011",
            "returnGeometry": "true",
            "outSR": "4326",
            "f": "geojson",
        }
    )
    request = urllib.request.Request(
        f"{LAYER_URL}?{query}", headers={"User-Agent": "NSD-London-report/1.0"}
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--research-csv", required=True, type=Path)
    parser.add_argument("--knowledge-graph", required=True, type=Path)
    parser.add_argument("--output", default=Path(__file__).parents[1] / "data", type=Path)
    parser.add_argument("--tolerance", default=0.00015, type=float)
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    with args.research_csv.open(newline="", encoding="utf-8") as handle:
        research_rows = list(csv.DictReader(handle))
    research = {row["borough"]: row for row in research_rows}

    source = fetch_boundaries()
    features = []
    matched = set()
    for feature in source["features"]:
        datastore_name = feature["properties"]["name"]
        if datastore_name == "City of London":
            research_name = CITY_RESEARCH["borough"]
            row = CITY_RESEARCH
            excluded_from_denominator = True
        else:
            research_name = NAME_ALIASES.get(datastore_name, datastore_name)
            row = research.get(research_name)
            if not row:
                raise ValueError(f"No research row matched Datastore borough {datastore_name!r}")
            matched.add(research_name)
            excluded_from_denominator = False
        properties = {
            "id": row["id"],
            "name": research_name,
            "map_name": datastore_name,
            "gss_code": feature["properties"]["gss_code"],
            "hectares": feature["properties"]["hectares"],
            "inner_london": feature["properties"]["ons_inner"] == "T",
            "subregion": feature["properties"]["sub_2011"],
            "status": row["status"],
            "status_label": STATUS_LABELS[row["status"]],
            "adopted": row["adopted"].lower() == "true" if row["adopted"] else None,
            "date": row["decision_or_evidence_date"],
            "confidence": row["confidence"],
            "evidence_type": row["evidence_type"],
            "evidence_summary": row["evidence_summary"],
            "official_site": row["official_site"],
            "primary_source": row["primary_source"],
            "secondary_source": row["secondary_source"],
            "checked_at": row["checked_at"],
            "excluded_from_borough_denominator": excluded_from_denominator,
        }
        features.append(
            {
                "type": "Feature",
                "properties": properties,
                "geometry": simplify_geometry(feature["geometry"], args.tolerance),
            }
        )

    missing = set(research) - matched
    if missing or len(features) != 33:
        raise ValueError(f"Boundary join incomplete: {len(features)} features; missing {missing}")

    features.sort(key=lambda item: item["properties"]["name"])
    collection = {
        "type": "FeatureCollection",
        "name": "London local authority National Scheme of Delegation status",
        "source": "London Datastore London Boroughs layer",
        "source_url": "https://data.london.gov.uk/dataset/london-boroughs-e55pw",
        "licence": "Open Government Licence v3.0",
        "features": features,
    }
    geojson_path = args.output / "boroughs.geojson"
    geojson_path.write_text(
        json.dumps(collection, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    shutil.copy2(args.research_csv, args.output / "boroughs.csv")
    shutil.copy2(args.knowledge_graph, args.output / "knowledge-graph.jsonld")
    report_fields = [
        "id", "name", "gss_code", "status", "status_label", "adopted", "date",
        "confidence", "evidence_type", "evidence_summary", "official_site",
        "primary_source", "secondary_source", "checked_at",
        "excluded_from_borough_denominator",
    ]
    with (args.output / "authorities.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=report_fields)
        writer.writeheader()
        writer.writerows(
            {field: feature["properties"].get(field, "") for field in report_fields}
            for feature in features
        )

    print(f"Wrote {len(features)} mapped authorities to {geojson_path}")
    print(f"GeoJSON size: {geojson_path.stat().st_size / 1024:.1f} KiB")


if __name__ == "__main__":
    main()
