# Overnight evidence-review plan

Drafted 3 November 2026. Implements the redesign in [`../delegation-notes.md`](../delegation-notes.md) as a staged schedule that fits five-hour allowance windows.

## Principle

Models never search, browse or page through portals. A local script does all retrieval for free and leaves compact evidence packets on disk. Models read packets only. Every unit of work is one authority, written to its own file, so a window cut-off loses nothing.

## Budget baseline

Pilot: 23 points of a window for 6 authorities, about 3.8 points each. Doing the remaining 278 that way costs about 1,060 points, over 11 full windows, with a poor hit rate. Target for the packet approach is at most 0.3 points per authority (about 85 points, under one window in total). That target is unproven until Stage 1 gives a measured number.

## Pipeline

| Stage | Who | Cost | Output |
|---|---|---|---|
| 0. Fingerprint | script | 0 | `portal_vendor`, democracy domain, `access_status` for all 308 |
| 1. Harvest | script | 0 | `cache/<code>/` PDFs/HTML, `packets/<code>.json` |
| 2. Classify | cheap model, 40 packets per call | low | provisional status + quoted passage |
| 3. Adjudicate | medium model, only positives, conflicts and unclear outcomes | medium | final status |
| 4. Residual | browser, capped | high per item | WAF-blocked authorities worth a human or browser check |

### Stage 0: fingerprint (one run, minutes)
- Derive the democracy host from the existing rows, then from `moderngov.`/`democracy.`/`committee.`/`modgov.` host patterns on the council domain.
- Classify vendor from response headers and URL signatures: ModernGov (`mgCalendarMonthView.aspx`), Civica CMIS, Jadu, bespoke; record WAF type (Azure, Cloudflare, Imperva) from headers or challenge pages.
- Output a `portal_family` column used for all later batching.

### Stage 1: harvest (unattended, overnight, zero tokens)
- Per authority, in order: reuse known URLs, then ModernGov routes (`mgWebService.asmx` and RSS if enabled, `ieDocSearch.aspx` for the phrase "National Scheme of Delegation", `ieListMeetings`/`mgCalendarMonthView` for Sept to Nov 2026 Full Council, Cabinet and Planning meetings), then constitution pages.
- Download once, `pdftotext`, keep about 400 characters around: "National Scheme of Delegation", "Gateway", "RESOLVED", "31 October", "Chair of Planning Committee".
- Rank documents: minutes with RESOLVED near the phrase beat reports, which beat agendas.
- Throttle one request per second per host; per-host circuit breaker after 3 consecutive 403/429 (log `waf_blocked`, move on, retry in a later night).
- Retry queue, not retry loops: blocked hosts get a second attempt on a different night and with a longer delay.
- Search fallback for authorities with no ModernGov hit: one search-API call per authority from the script (query on authority name plus phrase), URLs only, no model.
- Cache key is the URL hash; the script is idempotent and safe to kill.

### Stage 2: classify (cheap model, headless)
- Input: up to 40 packets (about 1,500 tokens each) per call, fixed decision table from the notes, JSON output only: `status`, `quote`, `source`, `needs_adjudication`.
- No tools given to the model, so no hidden search or browser spend.

### Stage 3: adjudicate
- Only rows where Stage 2 says `adopted`, conflicting documents, or past meeting with no outcome. Expected a minority of rows.
- Tools still off. If a decisive document is missing, send the row back to Stage 1 with a targeted URL hint rather than letting the model search.

### Stage 4: residual
- Authorities still `waf_blocked` after two nights. A short list for you to open manually, or for a browser worker with at most 2 attempts each and a hard stop.

## Schedule (one stage per night; every night ends with a commit of CSV and packets)

| Night | Work | Allowance use |
|---|---|---|
| 1 (interactive, with me) | Write Stage 0 and 1 scripts; validate on the 36 known rows. Pass criteria: reproduces known URLs, no duplicate fetches, packets for the 6 pilot authorities match the pilot findings | about 1 window |
| 2 | Stage 0 across all 308, then Stage 1 on `ModernGov, no WAF` family | scripts only |
| 3 | Stage 1 on remaining families; Stage 1 retries for blocked hosts. Spot-check 15 random packets by eye | scripts only |
| 4 | Stage 2 on batches in family order, 40 packets per call. Gate: stop if cost per authority is above 0.5 points | one window or less |
| 5 | Stage 3 adjudication; Stage 1 re-harvest for any rows sent back | about one window |
| 6 | Stage 4 triage list; update map data, rebuild JSON, publish | small |

Nights 2 and 3 need no allowance, so they can overlap and be driven by `launchd` (you already have a LaunchAgents directory in scope). Stages 2 and 3 can be run by a small driver that calls headless `claude -p` per batch, writes results after each batch, and halts on the first rate-limit error; the next night's run resumes from the state file.

## Files to add
- `scripts/fingerprint.py`, `scripts/harvest.py`, `scripts/make_packets.py`, `scripts/run_batches.sh` (stdlib only; `requests` and Playwright are not installed, `pdftotext` is)
- `data/queue.csv`: per authority: `portal_family, access_status, review_depth, attempts, last_attempt, next_action`
- `cache/` and `packets/`, git-ignored except packets
- New CSV columns per section 5 of the notes, kept separate from `status`

## Risks
- WAF-protected portals may block a script as well as a browser. Your home IP and a plain browser user-agent may fare better than the research environment did; this is the biggest unknown and Night 1 should measure it per family.
- ModernGov web service and RSS are often disabled; the plan assumes a fallback to calendar pages, which is slower.
- Some councils will not have held the relevant meeting by now. Stage 2 must distinguish "no meeting yet" from "no evidence".

## Status log

### 3 November 2026: Stage 0 complete (Night 1, partial)

`scripts/fetch_sites.py` and `scripts/fingerprint.py` written and run over all 308 authorities from a UK VPN exit (Manchester, M247 hosting ASN). Outputs: `data/council-sites.csv` (official homepages from GOV.UK Local Links Manager, 294 of 308 found) and `data/portal-fingerprint.csv`.

| Result | Count |
|---|---|
| ModernGov, accessible | 205 |
| WAF-blocked (Cloudflare, Imperva, Azure) | 26 |
| Host unknown | 72 |
| Reachable but no ModernGov signature | 5 |

Findings:
- Much of the earlier blocking was geofencing. Gosport (Azure) and Dorset were 403 from outside the UK and 200 from a UK exit. Data-centre exits still trip some Cloudflare and Imperva rules.
- `*.moderngov.co.uk` has wildcard DNS through Cloudflare, so a DNS lookup cannot tell a real tenant from a wrong guess. Guessed tenants that return 5xx, 404 or time out are now discarded, not recorded as `broken`.
- Guessing hosts from the authority name was unreliable. Official homepages from GOV.UK, then a second hop through the homepage's committee/councillor pages, resolved most of the rest (for example South Hams to the shared `democracy.swdevon.gov.uk`).
- Most of the 72 unknown hosts are not ModernGov (Civica CMIS, council-built sites) or hide the portal behind unlinked paths. Nine are National Parks, development corporations or the Broads Authority, which may be exempt and need a policy decision.

Next:
1. Stage 1 harvest on the 205 open ModernGov portals (no allowance needed).
2. Playwright cookie capture for the 26 blocked hosts, using one VPN exit throughout.
3. A CMIS probe and hand-entered hosts in `data/domains.csv` for the 72 unknowns.

No model allowance has been used on this stage.
