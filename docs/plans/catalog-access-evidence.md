# Catalog access evidence — issue #7 (October 8, 2026)

Status: documentation-only research record. It adds no adapter, schema, test, fixture or UI change. Issue [#7](https://github.com/michaeltorbert/homeschool-collector/issues/7) stays open and incomplete. Complete catalog access and semantics (C03) and the catalog adapter (C05) remain unmet, publisher calendar limits remain unverified, and Wake expansion stays deferred behind the complete catalog milestone. Nothing here implies release readiness, closure or a requirement exception. The operative contract and the bounded calendar candidate remain in [source/hosting](source-and-hosting.md#bounded-calendar-evidence-candidate).

## Conduct and boundaries

- Research was bounded public documentation search and reading of official Town pages and vendor-labeled documentation. No account, login, outreach, registration request, API request, authenticated session, proxy, alternate path or bypass was used.
- The Town registration host that returned HTTP 403 on October 7, 2026 was **not** requested again, by any client or path. An unsolicited search result offering a cached copy of a registration page appeared; it was not opened, adopted or used. No cached registration-system text is evidence in this record.
- No robots.txt or terms-of-use review was performed. Nothing here claims that the Town or its vendor permits automated reading or certifies automation permissions.
- Raw response bodies are not published. URLs and document IDs below are mutable references, not immutable evidence.

## Sources adopted (S1–S7)

Semantics come from web search/open reading, which may use indexed or cached representations. The reading has **no per-source acquisition time, status, byte count or hash**. Its summary was generated at 2026-10-08T04:59:33Z; that is the summary timestamp, not when any source was read.

| ID | Source | What it supports | Limits |
|---|---|---|---|
| S1 | [Town iCalendar subscriptions](https://www.fuquay-varina.org/iCalendar.aspx) | Category subscriptions (including Arts Center and Parks/Recreation) that update as website events are added | No numeric export horizon, cap, pagination or complete class/camp promise found on the inspected page |
| S2 | [Town Programs](https://www.fuquay-varina.org/311/Programs) | Links seasonal brochures; says new programs are always being added and points to the online activity database for the updated list | That database is the WebTrac registration system on the denied host (link not opened). The Town's own designated updated listing is therefore the stopped route; brochures cannot establish current or complete inventory |
| S3 | [Town Registration Info tutorial](https://www.fuquay-varina.org/1887/Registration-Info) | Describes search by category, keyword, class code, age and instructor; descriptions, dates, times, age and pricing; available/unavailable/waitlist labels | Described behavior only. Not measured search/filter/pagination, section identities, capacity or required-session evidence |
| S4 | [RecTrac API documentation (Postman workspace labeled Vermont Systems)](https://www.postman.com/vermontsystems/rectrac-api/collection/ahr2uk6/vermont-systems-rectrac-api-documentation) | Generic vendor API v2 exists; the quickstart says the vendor must enable environment access, then a designated API user, permission profiles and an authenticated session are required | Workspace ownership not independently authenticated. Only the visible quickstart was inspected. Establishes no Town entitlement, authorization, endpoint, scope or measured sections. No API request made |
| S5 | [Town Sept–Dec 2026 brochure (DocumentCenter 16912)](https://www.fuquay-varina.org/DocumentCenter/View/16912/2026-Sept---Dec-Brochure-Online-Version) | Followed from S2 on October 8. Cover says September–December 2026; 52 pages. Selected page 9 text shows program code `CAMPS0042`, ages 7–12, schedule and resident/nonresident fees | Text excerpts of pages 1, 3 and 9 only; no full enumeration, pixel/design review or PDF hash. Search results also showed an older January–April filename for the same document ID, so the ID and bytes may change. `CAMPS0042` is a program code; whether it is a stable bookable section identity is unknown. A dated partial observation, not a catalog |
| S6 | [CivicPlus RSS troubleshooting](https://www.civicplus.help/municipal-websites-central/docs/determine-if-an-rss-issue-is-with-civicplus-or-a-third-party) | Vendor states two-week RSS retention | RSS is a different representation; explicitly **not** transferred to the Town ICS horizon |
| S7 | [CivicPlus Calendar Properties](https://www.civicplus.help/municipal-websites-central/docs/calendar-properties) | Generic administrator display properties | No Town ICS numeric scope or truncation assurance |

### Search queries (verbatim)

Transcribed from the actual search-call arguments, as corrected by the coordinator at 2026-10-08T05:21:56Z; an earlier generated summary had omitted the quotation marks.

```
site.fuquay-varina.org recreation registration catalog WebTrac classes camps
site.fuquay-varina.org calendar iCalendar subscribe date range events
site.fuquay-varina.org RecTrac API export data
site.civicplus.help iCalendar calendar feed future events limit
site.vermontsystems.com "API" "RecTrac"
site.civicplus.help "iCalendar" "future"
site.civicplus.help "iCalendar" "export"
site.civicplus.help "iCalendar" "Subscribe"
site.fuquay-varina.org "export" "RecTrac"
```

The queries ran in batches, and the batched results do not map each result to an individual query, so no source is attributed to a specific query. No adopted source is hosted on `vermontsystems.com`; S4 is hosted on Postman in a vendor-labeled workspace whose ownership was not authenticated. Bounded search cannot show that no other permitted route exists; it only failed to establish one.

## Node runtime metadata for S1–S3 (separate from the text above)

On Node 25.9.0 the coordinator made one ordinary GET per documentation page (`redirect:'error'`, no authentication, cookies or retry). The registration host, API and catalog were not requested.

- **First attempt, 2026-10-08T05:00:36Z:** all three failed within milliseconds in the local sandbox. There is no HTTP status. The recorded category (transport/redirect/timeout) does not say which cause occurred; the underlying local cause was not conclusively exposed. No publisher denial or redirect was observed. Correcting the local network environment afterwards was not a workaround of any publisher denial.
- **Second attempt, corrected network environment, 05:01:26–05:01:28Z:** all three succeeded. Raw HTML was discarded; only acquisition metadata remains.

| Page | Status | Media type | Bytes | SHA-256 of response body |
|---|---|---|---|---|
| S1 iCalendar.aspx | 200 | text/html; charset=utf-8 | 98692 | `8c8a48b4a9adf5d63df65e15711b6067c524761d05604dcfb2c3aedd6f0280ae` |
| S2 311/Programs | 200 | text/html; charset=utf-8 | 102799 | `eb793527a78ecb1d722b71b636056bffb8b8e09e366ae817e8440ab3ed500fc8` |
| S3 1887/Registration-Info | 200 | text/html; charset=utf-8 | 113313 | `71b512147cdcf637b61fe18ffd360f6770cd8e2c6d241a72aa36727ec8a60304` |

These records prove ordinary reachability of three documentation URLs from Node at that time. They do **not** authenticate the indexed text in S1–S3, prove browser rendering or contents, or count as calendar/catalog acquisition, feed collection (C01/C02) or intended-runtime catalog proof (C05).

## Registration page and denied host (historical, unchanged)

| Observation | Time (UTC) | Runtime | Status | Bytes | SHA-256 |
|---|---|---|---|---|---|
| Registration Info page | 2026-10-07T18:26:59Z | earlier retrieval | 200 | 113313 | `71b512147cdcf637b61fe18ffd360f6770cd8e2c6d241a72aa36727ec8a60304` |
| Registration Info page | 2026-10-08T05:01:27Z | Node 25.9.0 | 200 | 113313 | `71b512147cdcf637b61fe18ffd360f6770cd8e2c6d241a72aa36727ec8a60304` |
| Registration landing page `https://ncfuquayvarinaweb.myvscloud.com/webtrac/web/splash.html` | 2026-10-07T18:27:23Z | Python urllib, single ordinary GET, no redirects | 403 | 4548 | `6ad3308618f876b15b7748e49af7f1129674f638ea27cdbcbd7240cf7fa24d91` |

- The identical original-body hashes show the Registration Info page bytes were unchanged between the two reads. The October 8 bytes were discarded, so the link set was not re-extracted from them.
- On October 7 the first link parser failed on a null href after a successful retrieval; the retained response was reparsed without another request. The retained copy is redacted (a token-bearing query variant omitted), so its bytes and hash differ from the original. A later local reading of that retained copy, with no request, confirmed the clean published landing link above survives.
- The 403 came from Python urllib, not Node, and was never retried. Node behavior on that host is unknown and deliberately untested; that unknown is not a reason to request it. The stop covers the exact registration host and any equivalent route that would bypass its denial: alternate paths or hostnames, other clients, session replay, proxies, challenge handling and cached copies. No claim is made about unrelated tenants of the vendor platform.

## Feed evidence this cycle

No seven-day series was run (declined by the coordinator) and no fresh feed check through `SourceChecker` ran in this cycle. Feed evidence remains the dated October 7, 2026 20:28:59Z run described in [source/hosting](source-and-hosting.md#bounded-calendar-evidence-candidate). The Town ICS horizon, cap, pagination and truncation remain unknown: feed counts, document order, RSS retention (S6) and UI search date ranges do not prove them.

## Prerequisites before any future catalog adapter

None of these is satisfied by S1–S7, including the S3 tutorial and the S5 `CAMPS0042` excerpt:

1. A permitted route (supported API/export or another explicitly allowed method) for the Town's classes and camps.
2. Measured complete configured scope, with filter and pagination behavior and terminal-page proof.
3. Stable, distinct identities for course, program, section, occurrence and required sessions, with a mapping for age, fee, availability/signup and capacity semantics.
4. Actual intended Node runtime proof on that route, including recorded failures, plus fixture/replay evidence.

The user may supply an approved export or access arrangement; that would need new evidence and a new conditional adapter plan. No credentials belong in this repository.

## Verification snapshot (October 8, 2026)

Tested artifact: commit `cebb74c8ce374e49a42fc06abd1d38e191b3cbad` plus the first version of this documentation change, identified by the coordinator's working-tree fingerprint `891431c351b9323435ae3ff8d8cf6cbf5342a5ed5c053d089c9a2aef22e72315`. The results below are relayed coordinator results for that artifact; the documentation author ran no checks.

- **Tests:** 157/157 passed, none skipped or cancelled. The suite is synthetic Node only: temporary loopback HTTP servers, isolated temporary databases and injected fetch, with no browser or audio cases and no external feeds. It includes source-check denial/stop categories, count balance, empty/partial/malformed outcomes, retention and pruning, per-part comparison and absence handling, parser-revision boundaries, pre-feature database upgrade with restart, and migration rollback. A first attempt was incomplete because of a local sandbox `listen EPERM`; a corrected full run passed.
- **Build:** TypeScript and Vite build passed.
- **Application equivalence:** `git diff --exit-code 801986536c06ea17633a50654ffa70b1fe06d820 -- src server tests fixtures package.json package-lock.json tsconfig.json vite.config.ts index.html` exited 0 with empty output in the candidate checkout. The coordinator and an independent reviewer each ran it. Since `8019865`, only documentation files have changed.
- **Browser:** not rerun. The historical synthetic browser acceptance at 1280×900 and 390×844 on `8019865` is reused only because application bytes are unchanged. Any application or UI change would invalidate this reuse.
- **Not performed:** no fresh feed or catalog check, and no native, hosted or catalog-runtime proof.

Later edits to this documentation (including this section) postdate that fingerprint. The results above are not claimed for the revised files; the coordinator re-verifies the revised artifact and records final acceptance outside Git.

## Requirement status

Status of the original requirements C01–C10 at this authorship snapshot. Each is reported separately; no exception is proposed. Meeting any row here does not complete #7.

| ID | Requirement (short) | Status |
|---|---|---|
| C01 | Measure Town response scope, range, rejects, duplicates, overlap/update, limits; unknown horizon labeled honestly | Unverified. Historical bounded measurement (October 7) exists and unknowns are labeled honestly; publisher horizon/cap/truncation remain unverified; no fresh feed check |
| C02 | Retain empty/partial/failed/changed evidence; keep archived/manual separate from live collection | Unverified for fresh live collection. Retention code unchanged and covered by the synthetic suite above; brochure and documentation reads are not collection attempts |
| C03 | Permitted complete class/camp access and semantics before that adapter | **Unmet** |
| C04 | Denial stops the registration route; no bypass, accounts, outreach or deployment | Met to date; ongoing |
| C05 | Only demonstrated minimal adapters with replay and intended Node runtime proof; Wake after catalog | **Unmet** for catalog. No adapter; documentation-page reachability is not catalog runtime proof; Wake deferred |
| C06 | Preserve bookmarks, Hide, passes, review, notices, age and learning; no new disappearance inference | Met for preservation by this documentation change: empty application diff plus the passing suite. Other product gates remain separate |
| C07 | Private data outside Git; synthetic proof; preserve visual design | Met for this scoped documentation: public sanitized text only, synthetic isolated tests, unchanged application and visual bytes. No native-device claim |
| C08 | Independent planning, reconciliation, separate writer, review and repair | In progress at this authorship snapshot: review requested changes, this repair is made, revised-artifact review and closeout are pending and recorded outside Git |
| C09 | Report each requirement; #7 incomplete while catalog unavailable; no release implication | Met in this report; ongoing |
| C10 | Full tests/build, source regression/restart/legacy migration and relevant UI proof on the exact fingerprint | Met for the tested artifact identified above, with reused historical synthetic browser proof. No new feed, catalog, native or hosted proof. Revised files need coordinator re-verification |
