# Research delegation notes

Last updated: 2 November 2026

## Decision

Do not continue the nationwide review with the current agent-led workflow.

The six-authority resolution pilot reduced the available five-hour subscription allowance from 92% to 69%: 23 percentage points for six authorities. The visible delegated messages totalled only 3,361 tokens, demonstrating that prompt and return-token counts are a poor proxy for subscription consumption when workers perform repeated searches, fetch documents and launch browsers. Hidden reasoning, search results, page content and tool overhead are not exposed in the visible token count.

Even without assuming that subscription usage scales linearly, this makes an agent-led review of roughly 200 further authorities infeasible within the subscription limits. Expansion should remain paused until most discovery and extraction can be performed deterministically outside model context.

## Current dataset

The national table contains 308 current English LPAs, ordered south to north.

- 30 researched records
- 278 `no_data` records
- 7 `adopted`
- 2 `implementation_confirmed_formal_resolution_not_located`
- 3 `pending_formal_adoption`
- 7 `scheduled_outcome_unconfirmed`
- 9 `no_evidence_found`
- 2 `not_applicable`

The records already contain useful candidate URLs, meeting dates, evidence summaries and access-failure boundaries. Future work must enrich these rows rather than restart searches from authority names.

## Delegation regimes used so far

### Initial low-cost discovery

- Model: `gpt-6-luna`, low reasoning.
- Allocation: three workers handling six or seven authorities each.
- Organisation: contiguous south-to-north batches.
- Instruction: search official authority and democracy sites deeply, prefer minutes and decisions, and return structured records.
- Result: 20 additional rows populated cheaply in visible output terms, but many workers stopped at agendas, indexed snippets or inaccessible portals. The pass did not consistently follow the complete report → recommendation → Council → minutes → constitution chain.

This regime is suitable for finding candidate URLs. It is not sufficiently reliable for final status adjudication.

### Resolution-level pilot

- Model: `gpt-6.1-sol`, medium reasoning.
- Allocation: three workers handling two authorities each.
- Per-authority limits: eight searches and two browser attempts.
- Required evidence chain: agenda/report → item page → minutes/decision → current constitution or operational page.
- Output limit: 1,200 tokens per worker.
- Result: two of six records materially improved. Isles of Scilly moved to `adopted`; Isle of Wight moved to `implementation_confirmed_formal_resolution_not_located`. Four remained access-limited and unresolved, although their sources and failure descriptions improved.
- Observed subscription impact: 23 percentage points of the five-hour allowance.

The detailed pilot ledger is in [`research/pilot-2026-11-02.md`](research/pilot-2026-11-02.md).

## Principal findings

1. Browser use is not a general solution. Azure WAF, Cloudflare and Imperva blocked both direct requests and Chromium/Playwright sessions.
2. Portal discovery is repetitive and should not consume model context. ModernGov routes and document naming conventions are predictable enough to probe with code.
3. Geography is useful for presentation but inefficient for research batching. Authorities should be grouped by portal platform and shared committee system.
4. “No evidence found” must remain distinct from “access blocked.” An incomplete fetch is a research-state problem, not evidence about an authority's constitutional position.
5. Agendas and recommendations must never be promoted to adoption without minutes, a decision record, current constitutional text or explicit official operational confirmation.
6. Visible prompt/return token counts materially understate subscription usage for tool-heavy agents.

## Recommended redesign

### 1. Freeze agent-led expansion

Do not delegate the remaining 278 authorities to research workers. Retain the current south-to-north order in the published data, but stop using geography as the execution batching strategy.

### 2. Build a deterministic evidence harvester

Create a local, resumable script that reads `authorities.csv` and writes candidate evidence to a separate queue. It should:

- identify the authority's official and democracy domains;
- classify the portal vendor;
- reuse every existing source URL before issuing new searches;
- probe common ModernGov routes such as `ieListDocuments.aspx`, `mgAi.aspx`, `mgDecisionDetails.aspx`, `ieDecisionDetails.aspx`, `ieDocSearch.aspx` and `mgCalendarMonthView.aspx`;
- extract linked `documents/s...` reports, appendices and minutes;
- download accessible PDFs once, run `pdftotext`, and retain short passages around terms such as “National Scheme of Delegation”, “RESOLVED”, “Constitution”, “Gateway Test” and “31 October 2026”;
- record HTTP status, WAF type, retrieval time and the exact route attempted;
- cache all successful responses and never fetch the same document twice;
- remain resumable after interruption.

The harvester should not decide adoption. Its output should be compact evidence packets containing metadata, URLs and relevant extracts.

### 3. Batch by portal family

Suggested groups include:

- ModernGov without an active WAF;
- ModernGov behind Azure WAF;
- ModernGov behind Cloudflare;
- ModernGov embedded below a main authority path, such as Southampton;
- Civica and bespoke committee systems;
- shared systems, including Adur/Worthing and Lewes/Eastbourne;
- ordinary planning/news pages with no committee-system dependency.

Portal-specific knowledge and cached sessions can then be reused across many authorities.

### 4. Use models only on compact evidence packets

Proposed tiers:

**Tier 0 — deterministic extraction**

No model. Gather, cache and rank candidate documents.

**Tier 1 — inexpensive classification**

A low-cost worker receives one or more compact evidence packets, not an open web-research assignment. It identifies the document type and recommends a provisional status using a fixed decision table.

**Tier 2 — resolution adjudication**

A medium-strength worker reviews only proposed positive adoptions, conflicting documents and past meetings whose outcomes remain unclear. It should not repeat discovery already present in the packet.

**Tier 3 — exceptional manual/browser review**

Reserve browser work for high-value cases where a known document is likely to exist and no cached or indexed copy is available. Stop after a small fixed number of attempts. WAF-blocked cases should be queued for a later retry or human check rather than repeatedly consuming allowance.

### 5. Extend the research-state model

Add fields separate from the substantive status:

- `access_status`: `accessible`, `partially_accessible`, `waf_blocked`, `broken`, `not_checked`;
- `review_depth`: `discovery`, `document_extracted`, `resolution_checked`, `operationally_checked`;
- `resolution_located`: true/false;
- `portal_vendor`;
- `last_attempted_url`;
- `retrieval_notes`;
- `reviewer_verified`;
- `source_cache_key`.

This prevents research failure from being encoded as a finding about the authority.

### 6. Use a strict decision table

- Explicit Council/committee resolution approving the relevant arrangements: `adopted`.
- Current official constitution or operational page clearly showing the gateway and nominated roles, without the formal resolution: `implementation_confirmed_formal_resolution_not_located`.
- Official report explicitly saying formal approval remains due: `pending_formal_adoption`.
- Agenda or past scheduled item without published outcome: `scheduled_outcome_unconfirmed`.
- Completed accessible search with no relevant document: `no_evidence_found`.
- Search prevented by WAF or broken portal: preserve the last substantive status and record `access_status`; do not infer `no_evidence_found`.
- Statutory exemption: `not_applicable`.

### 7. Introduce cost gates

For every future batch, record:

- subscription percentage before and after;
- elapsed time;
- authorities attempted;
- statuses changed;
- documents newly recovered;
- visible prompt and return tokens;
- search, fetch and browser counts.

Stop a batch when subscription consumption per resolved authority exceeds an agreed threshold, or when repeated access failures produce no new documents. The subscription percentage is the controlling metric; visible token count is diagnostic only.

## Suggested next experiment

Do not run another agent batch yet. First implement the deterministic harvester for the six pilot authorities and the existing first 30 records. A successful harvester should:

1. reproduce the candidate URLs already found;
2. avoid every duplicate fetch recorded in the pilot;
3. create compact evidence packets without an LLM;
4. preserve WAF failures as structured metadata;
5. require no subscription allowance for the extraction phase.

Once it works on the existing records, run it across the 278 `no_data` authorities. Review a small random sample of its evidence packets before estimating the size and cost of the Tier 1 and Tier 2 queues. This separates nationwide collection from expensive adjudication and provides a realistic cost estimate before further subscription allowance is committed.
