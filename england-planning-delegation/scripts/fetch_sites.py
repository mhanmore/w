#!/usr/bin/env python3
"""Fetch each authority's official homepage from GOV.UK Local Links Manager (no model, stdlib only).

Writes data/council-sites.csv (lpa_code,name,homepage_url,slug). Rows that are not found
(National Parks, development corporations, awkward names) are left blank; add them by hand
in data/domains.csv. Resumable: existing non-blank rows are kept.
"""
import csv
import json
import re
import urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
API = "https://local-links-manager.publishing.service.gov.uk/api/local-authority?authority_slug="


def slug_candidates(name):
    base = re.sub(r"\b(, )?(county|city) of\b", "", name, flags=re.I).replace("’", "").replace("'", "")
    base = base.replace(",", " ")
    words = [w for w in re.split(r"[^a-z0-9]+", base.lower()) if w]
    out = ["-".join(words)]
    if "upon" in words:
        out.append("-".join(w for w in words if w != "city"))
    out.append("-".join(words[:2]))
    return list(dict.fromkeys(s for s in out if s))


def lookup(slug):
    try:
        req = urllib.request.Request(API + slug, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=20) as r:
            las = json.load(r).get("local_authorities", [])
            return las[0] if las else None
    except Exception:
        return None


def main():
    out_path = DATA / "council-sites.csv"
    have = {r["lpa_code"]: r for r in csv.DictReader(open(out_path))} if out_path.exists() else {}
    rows = list(csv.DictReader(open(DATA / "authorities.csv")))
    rows.sort(key=lambda r: int(r["south_rank"]))
    for r in rows:
        if have.get(r["lpa_code"], {}).get("homepage_url"):
            continue
        hit = None
        for s in slug_candidates(r["name"]):
            hit = lookup(s)
            if hit:
                break
        have[r["lpa_code"]] = {"lpa_code": r["lpa_code"], "name": r["name"],
                               "homepage_url": hit["homepage_url"] if hit else "", "slug": hit["slug"] if hit else ""}
        print(("ok   " if hit else "MISS ") + r["name"], hit["homepage_url"] if hit else "")
    with open(out_path, "w", newline="") as f:
        w = csv.DictWriter(f, ["lpa_code", "name", "homepage_url", "slug"])
        w.writeheader()
        for r in rows:
            w.writerow(have[r["lpa_code"]])
    print(sum(1 for v in have.values() if v["homepage_url"]), "of", len(rows), "found")


if __name__ == "__main__":
    main()
