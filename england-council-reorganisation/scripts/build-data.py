#!/usr/bin/env python3
"""Build the map data for the England council reorganisation page.

Input: the planning.data.gov.uk local-authority-district CSV
  https://files.planning.data.gov.uk/dataset/local-authority-district.csv
Output (in ../data):
  districts.geojson  every current English district/unitary, tagged with its
                     reorganisation area, status and successor unit (if any)
  areas.csv          one row per proposed successor unit

Usage: python3 build-data.py /path/to/local-authority-district.csv
Then run simplify.sh to produce the web layers.

Status is as published by MHCLG at 2 November 2026. Structures shown for areas
whose decisions were withdrawn are the structures announced before withdrawal,
kept for reference only. Districts split at parish or ward level are assigned
whole to the unit that receives the remainder and flagged `split`.
"""
import csv
import json
import sys
from pathlib import Path

from shapely import wkt
from shapely.geometry import mapping

GOV_29_OCT = "https://www.gov.uk/government/news/local-government-reorganisation-moves-forward-in-five-counties"
LETTER_29_OCT = "https://assets.publishing.service.gov.uk/media/6ae36c6ed22fc5fecb3eb7f9/Local_government_reorganisation_-_withdrawn_letter_to_9_areas.pdf"
LETTER_7_SEP = "https://www.gov.uk/government/publications/local-government-reorganisation-programme-review-and-decisions-withdrawal-letter-to-council-leaders"
JULY_SUMMARY = "https://www.capsticks.com/insights/local-government-reorganisation-decisions-for-14-areas-july-update"
WIKI = "https://en.wikipedia.org/wiki/Upcoming_structural_changes_to_local_government_in_England"

STATUS = {
    "confirmed": "Confirmed",
    "minded_to": "Minded to proceed",
    "withdrawn": "Decision withdrawn – under review",
    "awaiting": "Awaiting decision",
}

# area id -> definition. units: name -> list of member districts.
# A member ending in '*' is split; the unit listed receives its remainder.
AREAS = [
    dict(id="surrey", area="Surrey", status="confirmed",
         status_date="2025-10-28", status_note="Decision 28 Oct 2025. Not part of the 2026 review.",
         vesting="1 April 2027", sources=[GOV_29_OCT, WIKI],
         units={"West Surrey": ["Guildford", "Runnymede", "Spelthorne", "Surrey Heath", "Waverley", "Woking"],
                "East Surrey": ["Elmbridge", "Epsom and Ewell", "Mole Valley", "Reigate and Banstead", "Tandridge"]},
         splits={}),

    dict(id="gloucestershire", area="Gloucestershire", status="minded_to",
         status_date="2026-10-29", status_note="July decision withdrawn and replaced by a minded-to decision on 29 Oct 2026; representations of at least three weeks before a final decision.",
         vesting="2029 (expected)", sources=[GOV_29_OCT],
         units={"Gloucestershire": ["Cheltenham", "Cotswold", "Forest of Dean", "Gloucester", "Stroud", "Tewkesbury"]},
         splits={}),
    dict(id="warwickshire", area="Warwickshire", status="minded_to",
         status_date="2026-10-29", status_note="Minded-to decision, 29 Oct 2026.",
         vesting="2029 (expected)", sources=[GOV_29_OCT, JULY_SUMMARY],
         units={"North Warwickshire": ["North Warwickshire", "Nuneaton and Bedworth", "Rugby"],
                "South Warwickshire": ["Stratford-on-Avon", "Warwick"]},
         splits={}),
    dict(id="worcestershire", area="Worcestershire", status="minded_to",
         status_date="2026-10-29", status_note="Minded-to decision, 29 Oct 2026.",
         vesting="2029 (expected)", sources=[GOV_29_OCT, JULY_SUMMARY],
         units={"North Worcestershire": ["Bromsgrove", "Redditch", "Wyre Forest"],
                "South Worcestershire": ["Malvern Hills", "Worcester", "Wychavon"]},
         splits={}),
    dict(id="oxfordshire", area="Oxfordshire and West Berkshire", status="minded_to",
         status_date="2026-10-29", status_note="Minded-to decision, 29 Oct 2026: three unitaries with the boundary changes requested by Oxford City Council, including West Berkshire.",
         vesting="2029 (expected)", sources=[GOV_29_OCT, "https://news.oxfordshire.gov.uk/government-confirms-three-new-unitary-councils/", JULY_SUMMARY],
         units={"Greater Oxford": ["Oxford"],
                "Northern Oxfordshire": ["Cherwell*", "West Oxfordshire"],
                "Ridgeway": ["South Oxfordshire*", "Vale of White Horse*", "West Berkshire"]},
         splits={"Cherwell": "15 parishes to Greater Oxford",
                 "South Oxfordshire": "25 parishes to Greater Oxford",
                 "Vale of White Horse": "9 parishes to Greater Oxford"}),
    dict(id="east-sussex", area="East Sussex and Brighton and Hove", status="minded_to",
         status_date="2026-10-29", status_note="Minded-to decision, 29 Oct 2026: Brighton and Hove boundary extension modified to exclude Falmer parish.",
         vesting="2029 (expected)", sources=[GOV_29_OCT, JULY_SUMMARY],
         units={"Brighton and Hove": ["Brighton and Hove"],
                "East Sussex": ["Eastbourne", "Hastings", "Lewes*", "Rother", "Wealden"]},
         splits={"Lewes": "Four wards to Brighton and Hove, excluding Falmer parish"}),

    dict(id="derbyshire", area="Derbyshire and Derby", status="withdrawn",
         status_date="2026-10-29", status_note="July 2026 decision withdrawn 29 Oct 2026; all options remain under consideration.",
         vesting="Under review", sources=[LETTER_29_OCT, JULY_SUMMARY],
         units={"Northern Derbyshire": ["Bolsover", "Chesterfield", "Derbyshire Dales", "High Peak", "North East Derbyshire", "Amber Valley*"],
                "Southern Derbyshire": ["Derby", "Erewash", "South Derbyshire"]},
         splits={"Amber Valley": "14 parishes to Southern Derbyshire"}),
    dict(id="devon", area="Devon, Plymouth and Torbay", status="withdrawn",
         status_date="2026-10-29", status_note="July 2026 decision withdrawn 29 Oct 2026.",
         vesting="Under review", sources=[LETTER_29_OCT, JULY_SUMMARY],
         units={"Exeter": ["Exeter"], "Plymouth": ["Plymouth"], "Torbay": ["Torbay"],
                "Devon": ["North Devon", "Torridge", "West Devon", "East Devon*", "Mid Devon*", "South Hams*", "Teignbridge*"]},
         splits={"East Devon": "28 parishes to Exeter",
                 "Mid Devon": "6 parishes to Exeter",
                 "South Hams": "13 parishes to Plymouth; further parishes to Torbay",
                 "Teignbridge": "15 parishes to Exeter; further parishes to Torbay"}),
    dict(id="hertfordshire", area="Hertfordshire", status="withdrawn",
         status_date="2026-10-29", status_note="July 2026 decision withdrawn 29 Oct 2026.",
         vesting="Under review", sources=[LETTER_29_OCT, "https://www.watford.gov.uk/news/article/1028/government-announces-four-unitary-authorities-in-hertfordshire"],
         units={"North West Hertfordshire": ["Dacorum", "St Albans"],
                "South West Hertfordshire": ["Hertsmere", "Three Rivers", "Watford"],
                "Central Hertfordshire": ["Stevenage", "North Hertfordshire*", "Welwyn Hatfield*"],
                "Eastern Hertfordshire": ["Broxbourne", "East Hertfordshire"]},
         splits={"North Hertfordshire": "Royston-area wards to Eastern Hertfordshire",
                 "Welwyn Hatfield": "Northaw and Cuffley ward to Eastern Hertfordshire"}),
    dict(id="kent", area="Kent and Medway", status="withdrawn",
         status_date="2026-10-29", status_note="July 2026 decision withdrawn 29 Oct 2026.",
         vesting="Under review", sources=[LETTER_29_OCT, JULY_SUMMARY],
         units={"North Kent": ["Dartford", "Gravesham", "Medway"],
                "West Kent": ["Maidstone", "Sevenoaks", "Tonbridge and Malling", "Tunbridge Wells"],
                "Mid Kent": ["Ashford", "Folkestone and Hythe", "Swale"],
                "East Kent": ["Canterbury", "Dover", "Thanet"]},
         splits={}),
    dict(id="lancashire", area="Lancashire, Blackburn with Darwen and Blackpool", status="withdrawn",
         status_date="2026-10-29", status_note="July 2026 decision withdrawn 29 Oct 2026.",
         vesting="Under review", sources=[LETTER_29_OCT, JULY_SUMMARY],
         units={"North Lancashire": ["Lancaster", "Preston", "Ribble Valley"],
                "South Lancashire": ["Chorley", "South Ribble", "West Lancashire"],
                "Pennine Lancashire": ["Blackburn with Darwen", "Burnley", "Hyndburn", "Pendle", "Rossendale"],
                "Fylde Coast": ["Blackpool", "Fylde", "Wyre"]},
         splits={}),
    dict(id="leicestershire", area="Leicestershire, Leicester and Rutland", status="withdrawn",
         status_date="2026-10-29", status_note="July 2026 decision withdrawn 29 Oct 2026.",
         vesting="Under review", sources=[LETTER_29_OCT, "https://www.leicestershire.gov.uk/news/local-government-reorganisation-update", JULY_SUMMARY],
         units={"Leicester": ["Leicester", "Oadby and Wigston"],
                "Leicestershire and Rutland": ["Blaby*", "Charnwood*", "Harborough*", "Hinckley and Bosworth", "Melton", "North West Leicestershire", "Rutland"]},
         splits={"Blaby": "16 parishes to Leicester",
                 "Charnwood": "11 parishes to Leicester",
                 "Harborough": "7 parishes to Leicester"}),
    dict(id="lincolnshire", area="Lincolnshire, North Lincolnshire and North East Lincolnshire", status="withdrawn",
         status_date="2026-10-29", status_note="July 2026 decision withdrawn 29 Oct 2026.",
         vesting="Under review", sources=[LETTER_29_OCT, JULY_SUMMARY],
         units={"Lincoln": ["Lincoln"],
                "Lincolnshire": ["Boston", "East Lindsey", "North Kesteven*", "South Holland", "South Kesteven", "West Lindsey*"],
                "North Lincolnshire (unchanged)": ["North Lincolnshire"],
                "North East Lincolnshire (unchanged)": ["North East Lincolnshire"]},
         splits={"North Kesteven": "12 wards to Lincoln",
                 "West Lindsey": "7 wards to Lincoln"}),
    dict(id="nottinghamshire", area="Nottinghamshire and Nottingham", status="withdrawn",
         status_date="2026-10-29", status_note="July 2026 decision withdrawn 29 Oct 2026.",
         vesting="Under review", sources=[LETTER_29_OCT, "https://futurenotts.org.uk/news-and-updates/2026/local-government-reorganisation-decision-announcement", JULY_SUMMARY],
         units={"Nottingham (expanded)": ["Nottingham", "Broxtowe*", "Gedling*", "Rushcliffe*"],
                "North and East Nottinghamshire": ["Ashfield", "Bassetlaw", "Mansfield", "Newark and Sherwood"]},
         splits={"Broxtowe": "Some wards to North and East Nottinghamshire",
                 "Gedling": "Some wards to North and East Nottinghamshire",
                 "Rushcliffe": "Some wards to North and East Nottinghamshire"}),
    dict(id="staffordshire", area="Staffordshire and Stoke-on-Trent", status="withdrawn",
         status_date="2026-10-29", status_note="July 2026 decision withdrawn 29 Oct 2026.",
         vesting="Under review", sources=[LETTER_29_OCT, JULY_SUMMARY],
         units={"North Staffordshire": ["Newcastle-under-Lyme", "Staffordshire Moorlands", "Stoke-on-Trent"],
                "Southern and Mid Staffordshire": ["Cannock Chase", "East Staffordshire", "Lichfield", "South Staffordshire", "Stafford", "Tamworth"]},
         splits={}),

    dict(id="essex", area="Essex, Southend-on-Sea and Thurrock", status="withdrawn",
         status_date="2026-09-07", status_note="March 2026 decision withdrawn 7 Sep 2026; under review.",
         vesting="Under review", sources=[LETTER_7_SEP, "https://www.herewise.co.uk/council-changes/essex"],
         units={"West Essex": ["Epping Forest", "Harlow", "Uttlesford"],
                "North East Essex": ["Braintree", "Colchester", "Tendring"],
                "Mid Essex": ["Brentwood", "Chelmsford", "Maldon"],
                "South West Essex": ["Basildon", "Thurrock"],
                "South East Essex": ["Castle Point", "Rochford", "Southend-on-Sea"]},
         splits={}),
    dict(id="hampshire", area="Hampshire, Isle of Wight, Portsmouth and Southampton", status="withdrawn",
         status_date="2026-09-07", status_note="March 2026 decision withdrawn 7 Sep 2026; under review.",
         vesting="Under review", sources=[LETTER_7_SEP, "https://www.herewise.co.uk/council-changes/hampshire"],
         units={"North Hampshire": ["Basingstoke and Deane", "Hart", "Rushmoor"],
                "Mid Hampshire": ["East Hampshire*", "New Forest*", "Test Valley*", "Winchester*"],
                "South West Hampshire": ["Eastleigh", "Southampton"],
                "South East Hampshire": ["Fareham", "Gosport", "Havant", "Portsmouth"],
                "Isle of Wight (unchanged)": ["Isle of Wight"]},
         splits={"East Hampshire": "Parishes to South East Hampshire",
                 "Winchester": "Parish to South East Hampshire",
                 "New Forest": "Parishes to South West Hampshire",
                 "Test Valley": "Parishes to South West Hampshire"}),
    dict(id="norfolk", area="Norfolk", status="withdrawn",
         status_date="2026-09-07", status_note="March 2026 decision withdrawn 7 Sep 2026; under review.",
         vesting="Under review", sources=[LETTER_7_SEP, "https://assets.publishing.service.gov.uk/media/69c3d3d0471d520038d0f59e/SoS_-_Letter_to_Norfolk_Leaders_25.03.26.pdf"],
         units={"West Norfolk": ["Breckland", "King's Lynn and West Norfolk"],
                "Greater Norwich": ["Norwich"],
                "East Norfolk": ["Broadland*", "Great Yarmouth", "North Norfolk", "South Norfolk*"]},
         splits={"Broadland": "19 parishes to Greater Norwich",
                 "South Norfolk": "16 parishes to Greater Norwich; 9 to West Norfolk"}),
    dict(id="suffolk", area="Suffolk", status="withdrawn",
         status_date="2026-09-07", status_note="March 2026 decision withdrawn 7 Sep 2026; under review.",
         vesting="Under review", sources=[LETTER_7_SEP, "https://www.suffolk.gov.uk/council-and-democracy/local-government-reorganisation-in-suffolk", WIKI],
         units={"Western Suffolk": ["West Suffolk", "Babergh*"],
                "Central and Eastern Suffolk": ["East Suffolk*", "Mid Suffolk*"],
                "Ipswich and South Suffolk": ["Ipswich"]},
         splits={"Babergh": "Parishes to Ipswich and South Suffolk",
                 "East Suffolk": "Parishes to Ipswich and South Suffolk",
                 "Mid Suffolk": "Parishes to Western Suffolk and to Ipswich and South Suffolk"}),

    dict(id="cambridgeshire", area="Cambridgeshire and Peterborough", status="awaiting",
         status_date="", status_note="No decision yet; competing options under consideration.",
         vesting="Under review", sources=[LETTER_29_OCT],
         units={"No decision": ["Cambridge", "East Cambridgeshire", "Fenland", "Huntingdonshire", "South Cambridgeshire", "Peterborough"]},
         splits={}),
    dict(id="west-sussex", area="West Sussex", status="awaiting",
         status_date="", status_note="No decision yet.",
         vesting="Under review", sources=[LETTER_29_OCT],
         units={"No decision": ["Adur", "Arun", "Chichester", "Crawley", "Horsham", "Mid Sussex", "Worthing"]},
         splits={}),
]


# As originally announced, before the September 2026 review.
ORIGINAL_LABEL = {
    "decided_2027": "Decided – vesting April 2027",
    "decided_2028": "Decided – vesting April 2028",
    "deferred": "Decision deferred",
}
MARCH_2026 = {"essex", "hampshire", "norfolk", "suffolk"}
JULY_2026 = {"gloucestershire", "warwickshire", "worcestershire", "oxfordshire", "east-sussex", "derbyshire",
             "devon", "hertfordshire", "kent", "lancashire", "leicestershire", "lincolnshire",
             "nottinghamshire", "staffordshire"}
for _a in AREAS:
    if _a["id"] == "surrey":
        _a.update(original_status="decided_2027", original_date="2025-10-28", original_vesting="1 April 2027")
    elif _a["id"] in MARCH_2026:
        _a.update(original_status="decided_2028", original_date="2026-03-25", original_vesting="1 April 2028")
    elif _a["id"] in JULY_2026:
        _a.update(original_status="decided_2028", original_date="2026-07-16", original_vesting="1 April 2028")
    else:
        _a.update(original_status="deferred", original_date="2026-07-16", original_vesting="")
assert len(JULY_2026) == 14


def main(src: str) -> None:
    csv.field_size_limit(sys.maxsize)
    rows = [r for r in csv.DictReader(open(src, newline="")) if not r["end-date"] and r["reference"].startswith("E")]
    by_name = {r["name"]: r for r in rows}

    lookup = {}
    for area in AREAS:
        for unit, members in area["units"].items():
            for member in members:
                name = member.rstrip("*")
                if name not in by_name:
                    raise SystemExit(f"Unknown district: {name}")
                if name in lookup:
                    raise SystemExit(f"Duplicate district: {name}")
                lookup[name] = (area, unit, member.endswith("*"))
        for name in area["splits"]:
            if name not in lookup or not lookup[name][2]:
                raise SystemExit(f"Split note without split flag: {name}")

    features = []
    for r in rows:
        props = {"code": r["reference"], "district": r["name"], "area_id": "", "area": "",
                 "status": "none", "original_status": "none", "unit": "", "unit_id": "", "split": False, "split_note": ""}
        if r["name"] in lookup:
            area, unit, split = lookup[r["name"]]
            props.update(area_id=area["id"], area=area["area"], status=area["status"],
                         original_status=area["original_status"], unit=unit,
                         unit_id=f"{area['id']}--{unit}", split=split,
                         split_note=area["splits"].get(r["name"], ""))
        features.append({"type": "Feature", "properties": props,
                         "geometry": mapping(wkt.loads(r["geometry"]))})

    out = Path(__file__).resolve().parent.parent / "data"
    out.mkdir(exist_ok=True)
    (out / "districts-full.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": features}))

    with open(out / "areas.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["area_id", "area", "status", "status_label", "status_date", "status_note", "expected_vesting",
                    "original_status", "original_date", "original_vesting",
                    "unit", "member_districts", "split_districts", "sources"])
        for area in AREAS:
            for unit, members in area["units"].items():
                names = [m.rstrip("*") for m in members]
                splits = "; ".join(f"{m.rstrip('*')}: {area['splits'].get(m.rstrip('*'), 'split')}" for m in members if m.endswith("*"))
                w.writerow([area["id"], area["area"], area["status"], STATUS[area["status"]], area["status_date"],
                            area["status_note"], area["vesting"], ORIGINAL_LABEL[area["original_status"]],
                            area["original_date"], area["original_vesting"],
                            unit, "; ".join(names), splits, " ".join(area["sources"])])

    (out / "areas.json").write_text(json.dumps([
        {k: area[k] for k in ("id", "area", "status", "status_date", "status_note", "vesting", "sources",
                              "original_status", "original_date", "original_vesting")}
        | {"status_label": STATUS[area["status"]], "original_label": ORIGINAL_LABEL[area["original_status"]],
           "units": [{"name": u, "members": [m.rstrip("*") for m in ms],
                      "splits": [{"district": m.rstrip("*"), "note": area["splits"].get(m.rstrip("*"), "")} for m in ms if m.endswith("*")]}
                     for u, ms in area["units"].items()]}
        for area in AREAS], indent=1))

    print(f"{len(rows)} current districts; {len(lookup)} in reorganisation areas; "
          f"{sum(len(a['units']) for a in AREAS)} units across {len(AREAS)} areas")


if __name__ == "__main__":
    main(sys.argv[1])
