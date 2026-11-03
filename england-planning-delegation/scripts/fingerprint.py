#!/usr/bin/env python3
"""Stage 0: fingerprint each authority's committee portal. No model, stdlib only.

For every row in data/authorities.csv this finds the democracy/committee host,
classifies the portal vendor and any WAF, and writes data/portal-fingerprint.csv.
The output drives later batching (portal_family) and the harvester.

Host discovery, in order:
  1. data/domains.csv overrides (columns: lpa_code,host[,path_prefix]) - hand-fixed hosts
  2. hosts in the existing official_site / primary_source / secondary_source URLs
  3. guesses from the authority name (democracy./moderngov./committee./modgov. .gov.uk,
     <slug>.moderngov.co.uk, www.<slug>.gov.uk)

Resumable: rows with an access_status other than not_checked are skipped unless
--force; --retry-blocked re-probes waf_blocked/broken rows only. Output is rewritten
after every row, and raw probe heads are cached in cache/fingerprint/<code>.json.

Usage:
  python3 scripts/fingerprint.py                  # all rows
  python3 scripts/fingerprint.py --limit 20       # first 20 by south_rank
  python3 scripts/fingerprint.py --only "Chichester,Gosport"
  python3 scripts/fingerprint.py --retry-blocked
  python3 scripts/fingerprint.py --selftest       # offline checks of the classifiers
"""
import argparse
import csv
import json
import re
import socket
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CACHE = ROOT / "cache" / "fingerprint"
OUT = DATA / "portal-fingerprint.csv"
FIELDS = ["lpa_code", "name", "democracy_base", "portal_vendor", "portal_family", "waf",
          "access_status", "http_status", "route_tried", "hosts_tried", "fingerprinted_at", "notes"]

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
TIMEOUT = 12
HOST_DELAY = 1.0          # seconds between requests to one host
PROBE_PATH = "/mgCalendarMonthView.aspx"
MG_SIGNATURES = ("mgcalendarmonthview", "ielistmeetings", "mgcommitteedetails", "modern.gov",
                 "moderngov", "mgmemberindex", "mgfindmember")
NAME_NOISE = re.compile(r"\b(borough|city|district|metropolitan|royal|london|council|of|the|county|"
                        r"unitary|authority|national park|development corporation)\b", re.I)

_host_lock = threading.Lock()
_host_last = {}
_write_lock = threading.Lock()


# --- classifiers (pure; covered by --selftest) -------------------------------------

def detect_waf(status, headers, body):
    """Return '' / 'azure' / 'cloudflare' / 'imperva'. Headers are a lowercase-key dict."""
    b = (body or "")[:6000].lower()
    server = headers.get("server", "").lower()
    cookies = headers.get("set-cookie", "").lower()
    if "incapsula" in b or "_incapsula_" in b or "visid_incap" in cookies or "incap_ses" in cookies \
            or "x-iinfo" in headers or "x-cdn" in headers and "imperva" in headers["x-cdn"].lower():
        return "imperva"
    if "cf-ray" in headers or "cloudflare" in server or "just a moment" in b or "cf-chl" in b:
        return "cloudflare" if status in (403, 429, 503) or "just a moment" in b else ""
    if status in (403, 429) and ("x-azure-ref" in headers or "x-azure-fdid" in headers
                                 or "azure" in b or "front door" in b):
        return "azure"
    return ""


def detect_vendor(path, body):
    low = (body or "").lower()
    if any(s in low for s in MG_SIGNATURES):
        return "moderngov"
    if "/cmis5/" in low or "cmis" in low and "committee" in low:
        return "civica_cmis"
    return ""


def classify(status, headers, body, path):
    """-> (vendor, waf, access_status)"""
    waf = detect_waf(status, headers, body)
    vendor = detect_vendor(path, body) if status == 200 else ""
    if status == 200 and vendor:
        return vendor, waf, "accessible"
    if waf or status in (403, 429):
        return vendor, waf, "waf_blocked"
    if status == 200:
        return "", waf, "partially_accessible"     # host answers but no known portal signature
    return vendor, waf, "broken"


def family(vendor, waf, embedded):
    if vendor == "moderngov":
        if embedded:
            return "moderngov_embedded"
        return f"moderngov_{waf}" if waf else "moderngov_open"
    if vendor == "civica_cmis":
        return "civica_cmis"
    return "other_or_unknown"


# --- host discovery --------------------------------------------------------------

def slugs(name):
    base = NAME_NOISE.sub(" ", name.replace("&", " and "))
    words = [w for w in re.split(r"[^a-z0-9]+", base.lower()) if w]
    if not words:
        return []
    out = ["".join(words), "-".join(words)]
    no_and = [w for w in words if w != "and"]
    out += ["".join(no_and), "-".join(no_and)]
    return list(dict.fromkeys(s for s in out if s))


def guess_hosts(name):
    hosts = []
    for s in slugs(name):
        hosts += [f"democracy.{s}.gov.uk", f"moderngov.{s}.gov.uk", f"committee.{s}.gov.uk",
                  f"modgov.{s}.gov.uk", f"{s}.moderngov.co.uk", f"www.{s}.gov.uk"]
    return hosts


def known_candidates(row, mg_only=False):
    """(host, path_prefix) pairs from URLs already in the research row, democracy-looking first."""
    seen, out = set(), []
    for col in ("primary_source", "secondary_source", "official_site"):
        url = (row.get(col) or "").strip()
        if not url.startswith("http"):
            continue
        p = urlparse(url)
        if mg_only and not re.search(r"/(?:ie|mg)[A-Za-z]+\.aspx|/documents/[sg]\d", p.path, re.I):
            continue
        prefix = ""
        m = re.search(r"^(.*?)/(?:ie|mg)[A-Za-z]+\.aspx", p.path, re.I) or \
            re.search(r"^(.*?)/documents/", p.path, re.I)
        if m:
            prefix = m.group(1)
        key = (p.netloc.lower(), prefix)
        if key not in seen:
            seen.add(key)
            out.append(key)
    out.sort(key=lambda k: not re.match(r"(democracy|moderngov|committee|modgov)|moderngov", k[0]))
    return out


def load_overrides():
    path = DATA / "domains.csv"
    out = {}
    if path.exists():
        for r in csv.DictReader(open(path, newline="")):
            out.setdefault(r["lpa_code"], []).append((r["host"].strip().lower(), (r.get("path_prefix") or "").strip()))
    return out


# --- network ---------------------------------------------------------------------

def resolves(host):
    try:
        socket.getaddrinfo(host, 443)
        return True
    except OSError:
        return False


def throttle(host):
    with _host_lock:
        wait = _host_last.get(host, 0) + HOST_DELAY - time.time()
        _host_last[host] = max(time.time(), _host_last.get(host, 0) + HOST_DELAY)
    if wait > 0:
        time.sleep(wait)


def fetch(url, limit=60000):
    """-> (status, headers_lowercase, body_head). status 0 = network failure (body_head holds reason)."""
    throttle(urlparse(url).netloc)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,*/*;q=0.8"})
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read(limit).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        try:
            body = e.read(limit).decode("utf-8", "replace")
        except Exception:
            body = ""
        return e.code, {k.lower(): v for k, v in e.headers.items()}, body
    except Exception as e:  # DNS, TLS, timeout, reset
        return 0, {}, f"{type(e).__name__}: {e}"


def probe(host, prefix, hinted=False):
    url = f"https://{host}{prefix}{PROBE_PATH}"
    status, headers, body = fetch(url)
    vendor, waf, access = classify(status, headers, body, PROBE_PATH)
    if not vendor and access == "waf_blocked" and ("moderngov" in host or hinted):
        vendor = "moderngov"      # body unreadable behind the WAF; host name or known ie*/mg* URLs say ModernGov
    return {"url": url, "host": host, "prefix": prefix, "status": status, "vendor": vendor,
            "waf": waf, "access": access, "head": body[:400]}


PORTAL_LINK = re.compile(
    r"""https?://[^"'\s<>)]*?(?:moderngov|modgov|democracy\.|committees?\.|cmis|meetings\.)[^"'\s<>)]*""", re.I)


def scan_portal_links(body, host, seen):
    found = []
    for m in PORTAL_LINK.finditer(body):
        u = urlparse(m.group(0).rstrip(".,;"))
        if u.path.lower().endswith((".pdf", ".doc", ".docx", ".jpg", ".png", ".css", ".js")):
            continue
        mm = re.search(r"^(.*?)/(?:ie|mg)[A-Za-z]+\.aspx", u.path, re.I)
        key = (u.netloc.lower(), (mm.group(1) if mm else (u.path.rstrip("/") if "modern" in u.path.lower() else "")))
        if key[0] != host and key not in seen:
            seen.add(key)
            found.append(key)
    return found


_sites = None


def official_home(row):
    global _sites
    if _sites is None:
        f = DATA / "council-sites.csv"
        _sites = {r["lpa_code"]: r["homepage_url"] for r in csv.DictReader(open(f))} if f.exists() else {}
    return (_sites.get(row["lpa_code"]) or row.get("official_site") or "").strip()


def domain_guesses(row):
    """Portal host guesses built from the council's real domain (bathnes.gov.uk -> democracy.bathnes.gov.uk)."""
    home = official_home(row)
    host = urlparse(home).netloc.lower().removeprefix("www.") if home.startswith("http") else ""
    if not host:
        return []
    label = host.split(".")[0]
    return [(h, "") for h in (f"democracy.{host}", f"moderngov.{host}", f"committee.{host}", f"committees.{host}",
                              f"modgov.{host}", f"democratic.{host}", f"meetings.{host}", f"{label}.moderngov.co.uk")]


def discover_hosts(row):
    """Read the council homepage and return portal (host, prefix) pairs it links to, plus a note."""
    homes = []
    site = official_home(row)
    if site.startswith("http"):
        homes.append(site)
    for sl in ([] if site else slugs(row["name"])[:4]):
        homes += [f"https://www.{sl}.gov.uk/", f"https://{sl}.gov.uk/"]
    seen, note = set(), "no homepage reachable"
    for home in dict.fromkeys(homes):
        host = urlparse(home).netloc
        if not resolves(host):
            continue
        status, _, body = fetch(home, limit=400000)
        if status != 200:
            note = f"homepage {host} returned {status}"
            continue
        found = scan_portal_links(body, host, seen)
        if not found:       # hop 2: the pages the homepage points at for committees/democracy
            hops = []
            for m in re.finditer(r"""href=["']([^"'#]+)["']""", body, re.I):
                href = m.group(1)
                if re.search(r"committee|councillor|democra|meeting|decision-making", href, re.I) \
                        and not href.lower().endswith((".pdf", ".doc", ".docx")):
                    u = urljoin(home, href)
                    if urlparse(u).netloc == host and u not in hops:
                        hops.append(u)
            for u in hops[:4]:
                st, _, b2 = fetch(u, limit=400000)
                if st == 200:
                    found = scan_portal_links(b2, host, seen)
                    if found:
                        return found, f"discovered from {u}"
        if found:
            return found, f"discovered from {host}"
        note = f"homepage {host} and committee pages had no portal link"
        break
    return [], note


def fingerprint_row(row, overrides):
    code = row["lpa_code"]
    cands = list(overrides.get(code, [])) + known_candidates(row)
    mg_hinted = set(known_candidates(row, mg_only=True))
    tried, probes = [], []
    best, notes = None, []
    rank = {"accessible": 3, "waf_blocked": 2, "partially_accessible": 1, "broken": 0}

    def run(hosts, hinted_set=frozenset(), guess=False):
        nonlocal best
        for host, prefix in hosts:
            if (host, prefix) in tried:
                continue
            tried.append((host, prefix))
            if not resolves(host):
                continue
            p = probe(host, prefix, hinted=(host, prefix) in hinted_set)
            # *.moderngov.co.uk has wildcard DNS: a 5xx/timeout on a guessed tenant means "no such tenant"
            if guess and p["access"] == "broken" and (p["status"] == 0 or p["status"] >= 500 or p["status"] == 404):
                continue
            probes.append(p)
            if best is None or rank[p["access"]] > rank[best["access"]] or (p["vendor"] and not best["vendor"]):
                best = p
            if p["access"] == "accessible":
                return True
        return False

    done = run(cands, mg_hinted)
    if not done and not (best and best["vendor"]):
        found, note = discover_hosts(row)
        notes.append(note)
        done = run(found, set(found))
    if not done and not (best and best["vendor"]):
        run(domain_guesses(row) + [(h, "") for h in guess_hosts(row["name"])], guess=True)
        if best is None:
            notes.append("guessed hosts all unreachable")

    if best is None or (best["access"] == "broken" and not best["vendor"]):
        base = f"https://{best['host']}{best['prefix']}" if best else ""
        return {"lpa_code": code, "name": row["name"], "democracy_base": "", "portal_vendor": "",
                "portal_family": "host_unknown", "waf": "", "access_status": "host_unknown",
                "http_status": best["status"] if best else "", "route_tried": best["url"] if best else "",
                "hosts_tried": ";".join(h for h, _ in tried[:12]), "fingerprinted_at": now(),
                "notes": "; ".join(notes)[:200]}, probes

    embedded = bool(best["prefix"]) and best["host"].split(".")[0] not in ("democracy", "moderngov", "committee", "modgov")
    if best["status"] == 0:
        notes.append(best["head"][:100].replace("\n", " "))
    return {"lpa_code": code, "name": row["name"],
            "democracy_base": f"https://{best['host']}{best['prefix']}",
            "portal_vendor": best["vendor"], "portal_family": family(best["vendor"], best["waf"], embedded),
            "waf": best["waf"], "access_status": best["access"], "http_status": best["status"],
            "route_tried": best["url"], "hosts_tried": ";".join(h for h, _ in tried[:12]),
            "fingerprinted_at": now(), "notes": "; ".join(n for n in notes if n)[:200]}, probes


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# --- driver ----------------------------------------------------------------------

def load_existing():
    if not OUT.exists():
        return {}
    return {r["lpa_code"]: r for r in csv.DictReader(open(OUT, newline=""))}


def write_all(existing, order):
    tmp = OUT.with_suffix(".tmp")
    with open(tmp, "w", newline="") as f:
        w = csv.DictWriter(f, FIELDS)
        w.writeheader()
        for code in order:
            if code in existing:
                w.writerow({k: existing[code].get(k, "") for k in FIELDS})
    tmp.replace(OUT)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int)
    ap.add_argument("--only", help="comma-separated authority names")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--retry-blocked", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()

    rows = list(csv.DictReader(open(DATA / "authorities.csv", newline="")))
    rows.sort(key=lambda r: int(r["south_rank"]))
    order = [r["lpa_code"] for r in rows]
    if a.only:
        wanted = {n.strip().lower() for n in a.only.split(",")}
        rows = [r for r in rows if r["name"].lower() in wanted]
    existing = load_existing()

    def pending(r):
        cur = existing.get(r["lpa_code"])
        if a.force or cur is None:
            return True
        if a.retry_blocked:
            return cur["access_status"] in ("waf_blocked", "broken", "host_unknown", "not_checked")
        return cur["access_status"] == "not_checked"

    todo = [r for r in rows if pending(r)]
    if a.limit:
        todo = todo[:a.limit]
    # kinds with no committee-system expectation still get probed; they just land in other_or_unknown
    overrides = load_overrides()
    CACHE.mkdir(parents=True, exist_ok=True)
    print(f"{len(todo)} to fingerprint ({len(rows) - len(todo)} skipped)", file=sys.stderr)

    done = 0

    def work(r):
        nonlocal done
        res, probes = fingerprint_row(r, overrides)
        (CACHE / f"{r['lpa_code']}.json").write_text(json.dumps(probes, indent=1))
        with _write_lock:
            existing[r["lpa_code"]] = res
            write_all(existing, order)
            done += 1
            print(f"[{done}/{len(todo)}] {r['name']}: {res['portal_family']} {res['access_status']} "
                  f"{res['democracy_base']}", file=sys.stderr)

    try:
        with ThreadPoolExecutor(a.workers) as ex:
            list(ex.map(work, todo))
    except KeyboardInterrupt:
        print("interrupted; progress is saved, rerun to resume", file=sys.stderr)
        return 130
    fam = {}
    for r in existing.values():
        fam[(r["portal_family"], r["access_status"])] = fam.get((r["portal_family"], r["access_status"]), 0) + 1
    for k, v in sorted(fam.items(), key=lambda kv: -kv[1]):
        print(f"{v:4d}  {k[0]:22s} {k[1]}", file=sys.stderr)


def selftest():
    ok = True

    def check(label, got, want):
        nonlocal ok
        if got != want:
            ok = False
            print(f"FAIL {label}: got {got!r} want {want!r}")

    check("slug", slugs("Brighton and Hove")[:2], ["brightonandhove", "brighton-and-hove"])
    check("slug noise", slugs("Chichester District Council")[0], "chichester")
    check("mg open", classify(200, {}, "<a href='mgCalendarMonthView.aspx'>", PROBE_PATH),
          ("moderngov", "", "accessible"))
    check("imperva", classify(403, {"x-iinfo": "1"}, "Request unsuccessful. Incapsula incident", PROBE_PATH)[1:],
          ("imperva", "waf_blocked"))
    check("cloudflare", classify(403, {"cf-ray": "x", "server": "cloudflare"}, "Just a moment...", PROBE_PATH)[1:],
          ("cloudflare", "waf_blocked"))
    check("azure", classify(403, {"x-azure-ref": "z"}, "", PROBE_PATH)[1:], ("azure", "waf_blocked"))
    check("plain 404", classify(404, {}, "", PROBE_PATH), ("", "", "broken"))
    check("cf 200 not blocked", classify(200, {"cf-ray": "x"}, "<html>mgCalendarMonthView", PROBE_PATH),
          ("moderngov", "", "accessible"))
    check("unknown 200", classify(200, {}, "<html>hello</html>", PROBE_PATH), ("", "", "partially_accessible"))
    check("family embedded", family("moderngov", "imperva", True), "moderngov_embedded")
    check("family waf", family("moderngov", "azure", False), "moderngov_azure")
    kc = known_candidates({"primary_source": "https://www.southampton.gov.uk/modernGov/ieListDocuments.aspx?CId=126",
                           "official_site": "https://www.southampton.gov.uk/"})
    check("embedded prefix", kc[0], ("www.southampton.gov.uk", "/modernGov"))
    kc = known_candidates({"primary_source": "https://moderngov.dorsetcouncil.gov.uk/documents/s54563/x.pdf"})
    check("documents prefix", kc[0], ("moderngov.dorsetcouncil.gov.uk", ""))
    m = [x.group(0) for x in PORTAL_LINK.finditer('<a href="https://democracy.example.gov.uk/mgCalendarMonthView.aspx">x</a> <a href="https://www.example.gov.uk/a">')]
    check("portal link regex", m, ["https://democracy.example.gov.uk/mgCalendarMonthView.aspx"])
    print("selftest OK" if ok else "selftest FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
