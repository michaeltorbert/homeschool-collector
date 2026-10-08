# Source collection, calendar export and hosting

## Current delivered boundary

Local React/Vite/TypeScript, Node HTTP+SQLite and ical.js serve a loopback-only public Town calendar preview. Public dated fixtures record21 publisher identities/27 memberships/four closures, not the full class/camp universe. Scope/horizon/truncation and durable unattended retrieval remain unknown. Source parts, observations/normalized versions, fences/leases, idempotent receipts, representations/conflicts, private family state and exact changes/acknowledgements are implemented locally. D1-compatible SQL is not a deployed Worker adapter. No protected hosted runtime, scheduler, Muse delivery or calendar export exists.

Keep ordinary retrieval and parser correction provenance distinct. Failed checks preserve last-known data and freshness labels; empty successful response differs from missed/failed check. No missing-row cancellation inference without measured comparable scope/horizon and explicit disappearance policy. Display order does not confer source authority. Incoming source text is data, never executable instructions; preserve rejects and bounded provenance. Public code/fixtures and private runtime data remain separate.

## Coverage and complete catalog milestone

Measure genuine Town response scope/horizon/truncation, UID/overlap/update behavior and source-specific limits; classify observation vs inference. Establish a supported/permitted complete WebTrac class/camp route (API/export or another explicitly allowed method), measured search/filter/pagination scope, stable bookable course/section IDs and age/fee/signup/capacity/required-session semantics. An uploaded/manual search is a labeled observation of its configured scope, not unattended complete collection. Denial stops retrieval; do not mask identity, replay sessions, solve challenges, rotate proxies or work around browser policy. Operator outreach/account provisioning requires its own explicit authorization.

Only after access and semantics are demonstrated, implement the smallest source adapter with fixture/replay/live-runtime proof. Keep course/section/program/occurrence identities distinct. Verify updates/partial/failed/empty checks and allowed intended-runtime access; do not substitute ranking improvements for missing coverage. Wake expansion follows the complete catalog milestone unless the user changes ordering. Additional source adapters each need independent access, scope/identity/provenance/privacy and regression evidence. Queues/routing/push/offline synchronization follow measured need, not speculative scope.

### Bounded calendar evidence candidate

Status: a local candidate for the two existing public Town calendar feeds, implemented and now part of the combined local candidate on `feature/reviewed-preview-integration` (draft pull request; not merged or released). Issue #7 remains open and incomplete. The complete WebTrac class/camp route, its access, and its search, identity, age, fee, signup, capacity and session semantics remain unmet and blocked. The Town's published registration landing page returned HTTP 403 to one ordinary GET on October 7, 2026 (UTC). Retrieval stopped there; no alternative permitted route has been supplied. No catalog or Wake adapter, outreach, account or deployment is part of this candidate, and approving it does not waive the catalog milestone. The October 8, 2026 synthetic browser acceptance of the combined candidate made no source check or external contact. It does not change these gates or the "unknown" publisher scope, horizon and truncation.

October 8, 2026 documentation-only research is recorded in [catalog access evidence](catalog-access-evidence.md). Bounded public Town pages and vendor-labeled documentation did not establish a permitted complete catalog route or measured catalog semantics; that search cannot show none exists. The Town's Programs page points to its online activity database for the updated program list, which is the denied registration system. The vendor API quickstart requires vendor enablement, an API user, permission profiles and authentication; it is not evidence of Town entitlement or authorization. A September–December 2026 brochure was read only as selected page text and is a dated partial observation. No numeric Town ICS horizon or cap was found; RSS retention and UI date ranges are not transferred to ICS. The denied registration host was not requested again, no cached registration text was used, and no robots/terms review was performed. No seven-day series or fresh feed check ran in that cycle. No adapter is justified; the prerequisites for any future catalog adapter are listed in that record.

**Retrieval.** `server/sourceCheck.ts` makes one ordinary identified GET per feed, from the exact two-URL allowlist:
- `redirect:'error'`, no retries;
- one 15-second timeout covering headers and body;
- 2 MB advertised and streamed bounds;
- no new host, credentials or session.

Only a complete VCALENDAR that the current parser accepts is a success. Every failure gets a fixed category and is never stored:
- 401/403 denied, 429 rate-limited, other status;
- transport-error: redirect or network, with no fabricated status;
- timeout: the request signal aborted with TimeoutError, during fetch or streaming;
- too-large, no-body, stream-error, not-calendar, parse-error.

On every early exit the reader or body is cancelled and released.

**Measurement** (`src/sourceEvidence.ts`, revision `source-evidence-v1`). Computed with the current parser when the response arrives, then frozen:
- returned = accepted unique UIDs + parser rejects + duplicates;
- an accepted UID→semantic-hash map, using the existing semantic canonicalizer and sorted keys;
- the range and count of known start instants;
- all-day start dates, measured separately (all-day ends stay exclusive);
- counts of unknown times and recurring masters;
- document order of the accepted known-start subsequence. Zero, one or all-equal starts is n/a. At least one unequal pair, with the whole sequence nondecreasing or nonincreasing, is ascending or descending. Anything else is unsorted.

Publisher horizon, truncation, pagination and catalog completeness are always reported as unknown. Counts or order can document a cap hypothesis but never classify truncation.

**Persistence and replay.**
- `source_attempts` holds one completed acquisition per part per scan fence. Its identity `scan-<fence>-<part>` is derived by the server.
- Each row records: live or archived origin; outcome ok, empty, partial or failed; acquisition metadata; evidence and parser revisions; the frozen measurement; and the frozen comparison.
- Rows are immutable while retained (an UPDATE trigger enforces this) and pruned oldest-first to 100 per part.
- `source_uid_maps` stores the UID maps (FK cascade), kept for the latest 3 successful acquisitions per part.

A success commits in one transaction: the attempt, map, raw observation, the unchanged legacy receipt/normalization, and health. A failure commits its attempt and latest health, leaving the last successful data untouched.

Completion order is:
1. Exact retained replay or conflict.
2. The shared `AcquisitionGuardError` guard: current fence; unexpired lease; sequence; completion time no earlier than the latest attempt and `source_parts.attempted_at`; for a success, `observedAt` no earlier than `source_parts.observed_at`.
3. A refusal if a receipt already exists under the acquisition batch.
4. Unchanged legacy ingestion.

Exact replay is supported only while the attempt is retained. After pruning, the old fence fails the guard with no writes. Legacy `ingest` payload binding, receipts and replay are byte-compatible.

The legacy `failure()` signature ignores caller text and records an `unclassified` failure under the same identity. A differing second completion is a `ConflictError`.

Orchestration never follows a success completion with a failure completion. Its results are non-persisted:
- a typed guard rejection is reported as `superseded`;
- any other completion error is reported as `internal-error`, without its message.

Either way it continues with the other part and always ends the scan.

**Archive import.**
- Dated fixtures are imported with origin archived. `observedAt` stays the original capture time; completion and guard use the actual import time, recorded as import runtime.
- A fixed `initial-fixture-<part>` receipt that matches replays through legacy ingest as non-acquisition evidence, with no writes.
- A mismatched one raises `ArchiveImportConflictError` with no writes, is reported as `archive-import-conflict`, and startup continues.

**Migration and corrections.**
- Migration creates the tables atomically, with no backfill. Legacy successes show "not measured for this earlier check" until the next ordinary check.
- Parser corrections append no attempt and change no acquisition time, health or frozen measurement.

**Comparisons.** Per part, a check is compared only with the nearest previous successful acquisition of the same configured URL and origin. If that acquisition was measured under a different evidence or parser revision, the result is `revision-changed`: differences are unknown and no counts are given. The comparison never searches past it for an older compatible success. Partial and empty successes count as baselines; failures and parser receipts never do. The comparison counts added, not-observed-in-newer, changed-common and unchanged-common listings. A partial input lowers comparability, and publisher scope stays unproved for every pair.

Absence is never a disappearance or cancellation and changes no listing, membership or notice. A pruned map is unavailable, never empty.

Cross-feed overlap and semantic agreement/conflict use only the exact latest successful maps of both parts, with no substitution. If the two were measured under different parser or evidence revisions, overlap is unavailable. The view shows both attempts' IDs, origins and partial flags, and whether they came from the same scan. Each side is labelled as a live response with its read time, or as a dated archive with its original capture time and separate import time. Pairs are always labelled not simultaneous, and an archive is never presented as a new read.

**Current linkage.** The latest success counts as current only while its own provider receipt is the newest provider-cause receipt for the part, and its observation time and origin match the health row. A later direct legacy provider ingest, even with the same timestamp and origin, adds a newer provider receipt and unlinks it (shown as "Not measured: the latest intake has no check record"). Exact legacy replay adds no receipt, and parser corrections add parser-cause receipts, so neither unlinks it.

The latest attempt counts as current only if it is either:
- a failure while health is still failed at its time; or
- that linked success while health is not failed.

A frozen measurement is never rewritten. When the parser revision changes afterwards, the snapshot adds the derived `currentParserRevision`/`revisionCurrent`, and Sources says the figures reflect the earlier reading. Sources dates always include the year.

**Exposure.**
- The snapshot keeps `coverage:'unknown'` and adds a bounded `sourceEvidence` object: latest attempt, latest success, comparison, retained versus latest-response counts, the last 10 attempt summaries, overlap, unknown limits, and the parent-facing catalog label "Classes and camps are not connected; the complete registration listings are unavailable". That label stands for the technical limit above: no permitted complete catalog route has been established, and the registration landing page was denied.
- It carries no bodies or UID maps.
- Source errors are sanitized on read:
  - the partial-rejection sentence is regenerated;
  - current failures are rendered from their structured category/status;
  - other stored text becomes "Failed (legacy detail not shown)" or "Detail not shown". The stored rows are left unchanged.
- `/api/scan` and `lastScan` carry fixed categories, status and counts only. Unexpected scan errors return a fixed message.

**Remaining for #7:**
- C03 (permitted complete catalog access and semantics) is unmet.
- C05 (catalog adapter with replay and intended-runtime proof) is unmet, with Wake expansion after it.
- Publisher horizon and truncation are unverified.
- Per-requirement status (C01–C10) for the October 8 documentation candidate is in [catalog access evidence](catalog-access-evidence.md#requirement-status); none is waived.
- Dated local evidence for this module (historical reuse on an earlier candidate; not integration, production, hosted or catalog proof): on October 7, 2026 at 20:28:59Z the coordinator ran a real two-feed check through `SourceChecker` on Node 25.9.0. Result: 7 Parks/Recreation and 20 Arts listings, 6 shared and 21 unique identities, 0 parser rejects and 0 duplicates. After that run only Sources date formatting changed; the retriever, store, parser and schema were identical. The coordinator's actual Sources view checks at 1280 and 390 px were refreshed on the current application bytes. This run is separate from the 18:30 UTC preflight.

### Public brochure document collector (scope E01, intermediate)

Status: implemented locally on `feature/automatic-public-program-collection`; not reviewed, merged or released at authorship. The author ran no tests, builds or live collection; results belong to the coordinator's run on the exact artifact. This is an explicit, limited **intermediate** collector of published Town brochure PDFs. It does **not** meet C03/C05: no permitted complete class/camp catalog route, measured scope, bookable course/section/occurrence identity, signup, capacity or availability semantics exist. Issue #7 stays open, Wake stays deferred, and nothing here implies release or hosting. Brochure candidates are not fed into listings, age suitability, learning or notices.

**Access boundary.** Automatic, ordinary, identified GETs to the exact host `www.fuquay-varina.org` only. Each admitted run fetches `robots.txt` first, then the fixed seeds `/311/Programs`, `/328/Summer-Camp-Programs` and `/1088/Dance-Class`, then only published `https://www.fuquay-varina.org/DocumentCenter/View/<numeric id>[/<slug>]` links from those pages. There is no generic crawl, sitemap, API guessing, flipbook or registration-host request. The denied registration host stays excluded. Brochure links that are not followed (for example the Dance page's off-host flipbook) are recorded by host or Town path only, so that coverage is reported as unsupported rather than complete. No outreach, account, manual export or AI/model call is involved.

**robots.txt.** RFC 9309 groups for the `HomeschoolCollector-Documents` token, else `*`; longest match wins and Allow wins ties; `*` and `$` patterns; case-sensitive paths. Unknown fields, malformed lines, invalid patterns or a crawl delay over 30 s in the applicable group fail closed. Crawl delays up to 30 s raise the 5 s pacing. A robots 404/other 4xx, wrong type or oversize, an unsupported policy, or a disallowed seed/document makes a sticky Town-lane stop. A robots 5xx/timeout aborts the run without inferring permission.

**Transport** (`server/documents/fetch.ts`, separate from the calendar retriever). `redirect:'error'`, no credentials, cookies or retries, and one 15 s timeout over headers and body. Advertised and streamed caps: 1 MiB for robots, 1 MiB per HTML page and 12 MiB per PDF; the reader is cancelled on every early exit. MIME and `%PDF-` magic are validated. Fixed categories:
- **Sticky Town-lane stop:** 401/403 (denied); a challenge header or interstitial (challenge); HTML instead of a PDF.
- **Backoff:** 429, for the larger of Retry-After and 24 h, capped at 30 days.
- **Transient, retried at the next schedule only:** 5xx, network/redirect failure, timeout or stream failure.
- **Per-document failure, other documents continue:** other statuses, wrong type, not a PDF, too large.

ETag/Last-Modified are kept only when well-formed and bounded. A conditional request is sent only from the latest version whose representation is still retained. A 304 is accepted only for such a request with a matching ETag; otherwise it is `unexpected-not-modified`. There is no HEAD request.

**Scheduling and admission** (`server/documents/store.ts`, ignored `data/documents.sqlite`, independent of the family database).
- Server start runs a due check, and an unref'd hourly timer repeats it. The CLI `run` uses the same persisted gates; there is no force, clear, reset or unblock command.
- Admission commits a fence, a 20-minute lease and the next run time (24 h) before robots is requested. Restarts and a concurrent CLI/server therefore cannot fetch again inside the window.
- Every request first persists a lane-wide pacing reservation (5 s minimum).
- PDFs are due 7 days after their last non-transient attempt; newly linked documents are due immediately. Each run is capped at 6 PDFs and 72 MiB; extra due documents are reported as deferred, with no completeness claim.
- Completions check fence and lease, so a stale completion writes nothing. An identical repeat replays; a differing one conflicts.

**Evidence model.**
- Attempts, versions, blobs, parses and candidates are immutable while retained.
- One document source per numeric DocumentCenter ID. Every published slug URL is a separate link row under the seed that published it, so actual parent relations are kept and nothing is merged across IDs.
- Seed HTML is parsed by parse5 without execution. Only a sanitized link inventory is stored: no scripts, queries, tokens/CSRF or off-host URLs beyond the host name. The original byte hash is kept separately from the stored-representation hash.
- PDF bytes are retained locally (ignored, never in Git) for local reparse and replay.
- Separate pointers are kept for:
  - **latest download** and **latest parse**;
  - **last complete-good parse**: complete traversal, no quarantined page, at least one candidate;
  - **last usable parse**: complete-good, or partial with at least one candidate.
- The displayed fragments are the last complete-good parse, else the last usable partial parse, else the latest parse. A failed, empty or partial new download therefore never hides earlier usable fragments.
- Every list row and source view carries the current status next to what is displayed: `display` (`last-good`, `latest-partial`, `last-known-partial` or `latest-<status>`), whether the shown parse is the latest one, the latest parse status and failure category, the latest attempt and a fixed label. Earlier evidence is never promoted to complete coverage or bookability.
- A first parse with gaps is shown labelled partial rather than hidden.
- Unchanged 200 bytes and accepted 304s are verifications (verified time), with no re-extraction. Acquisition, verification and parser-reprocessing times stay distinct.
- A publisher returning to bytes still retained under an earlier version of the same document (A→B→A) records a new `retained-version` attempt. That earlier immutable version and its parse become current again; fragment identities stay content-bound, so nothing is re-extracted or duplicated, and the rest of the batch continues. If the earlier version was already pruned, the bytes are stored and extracted as a new version.
- Retention per source: the latest 2 good versions (a document version is good when it has a complete-traversal parse; robots and seed representations are good once stored), plus every version referenced by the latest-download, latest-parse, complete-good or usable pointers. Other versions are pruned with their parses. 100 attempts per source.
- Quota: 200 MiB of retained bodies. When the quota would be exceeded, only unprotected evidence is pruned, oldest first. If that is not enough, the new version is refused (`quota-exceeded`) and the transaction rolls back.
- Seed link inventories (revision `link-inventory-v2`) remove duplicate anchors before a 200-link cap; slug aliases of one numeric ID remain distinct links. Overflow sets `truncated` with the reason `document-link-cap` and counts omitted distinct links and numeric IDs. These appear in the seed's status and the run report and make the run partial. Omitted documents cannot be collected or deferred because their URLs are not retained. The six-PDF run cap is separate. Because the stored inventory shape changed, the first check after upgrading records new seed representations.
- Opening an earlier document database upgrades it in one transaction. The attempts table is rebuilt only to admit the `retained-version` outcome: all rows, IDs and the immutability trigger are kept. The usable-parse pointer is added and backfilled from retained parses. No evidence row or time changes and nothing is fetched.
- Absence from a seed page or zero links is reported only (`currentlyLinked:false`) and never cancels or removes anything.

**Extraction** (`server/documents/pdf.ts`, `pdfWorker.mjs`, `layout.ts`).
- pdf.js 5.6.205 (legacy build) runs in a disposable worker thread. Settings: data-only input, `isEvalSupported:false`, `useWorkerFetch:false`, no font faces or system fonts, and no remote font/CMap URLs.
- Limits: 30 s wall clock with termination; an explicit 192 MB old-generation JS heap limit (not a total RSS ceiling); 80 pages, 1,000,000 characters and 100,000 text items. Budget overflow is reported as partial.
- Encrypted, malformed, timeout, heap-limit and crash outcomes are fixed categories. Worker output is discarded.
- Layout is positional: program-code anchors (2–6 capital letters, an optional space, 3–4 digits) define column-start clusters, and items are assigned by their left edge. There is no page-midpoint split.
- The whole page is quarantined, never guessed, when an item reaches across the gutter, when there is unanchored body text far right of a column start, or when there are more than 3 code columns or irregular ones.
- Headings bind by geometry (taller lines directly above a code). Blocks end at the next heading or code, or at a vertical gap over 3.2 body lines.
- Counted, never silently dropped: rotated and off-page items, textless pages (for example blank back covers), pages without codes, items outside columns, orphan lines and continuation lines. Nothing is joined across columns or pages.
- Each candidate is a versioned fragment. Its ID binds source, full document hash, parser revision, page, column and ordinal.
- Each candidate keeps the raw code and a narrow normalized search code; duplicate codes are flagged, never merged. It also keeps the raw heading, age text, description, ordered schedule groups (day/time, location, date lines), instructor and fee, each with line/character spans into the retained block lines, plus page, column, bbox, block text and its hash.
- A missing field is null with a warning, never copied from a neighbor. Backward date text such as `Oct. 29- Oct. 23` stays raw with a flag.
- No year, ISO date, recurrence, eligibility, capacity, section or availability is inferred.

**Access to results.**
- Read-only `GET /api/documents` (filters `q`, `code`, `doc`, `view=display|latest`, `limit` ≤ 100, `cursor`), `/api/documents/status`, `/api/documents/candidates/<id>` and `/api/documents/sources/<documentId>`.
- These routes sit behind the same loopback Host/peer/Origin guards, never trigger a check, and return no file paths, bodies or exception text.
- Every response carries the limits: incomplete, not bookable, availability unknown, registration not connected.
- The CLI (`npm run documents -- run|status|list|search|detail|source|replay|reparse`) gives structured JSON. `reparse` reprocesses retained bytes as new local evidence with no request. `replay` is a read-only comparison with the stored parse.
- The existing app snapshot and its catalog label are unchanged. No UI was added.

**Evidence used for authoring (public, retained outside Git).** One ordinary Node 25.9.0 acquisition on October 8, 2026 (UTC):
- robots.txt, the three seed pages and three brochures (DocumentCenter 16912, 17892 and 13472; 52, 8 and 16 pages, each with a textless last page);
- pdf.js 5.6.205 positional tokens, and page 6 and 9 renderings of 16912.

The author checked the page 6 and 9 pixels against token coordinates. Page 6 has columns at x≈82 and x≈348 with the sidebar on the left; page 9 has columns at x≈19 and x≈279, a gutter of about 13 pt and the sidebar on the right. Content order interleaves columns and separates headings from their codes. A test re-checks those associations against the retained token export when it is present locally and is skipped otherwise. The Summer page links a different DocumentCenter ID (17585) than the Programs page (17892) for the summer brochure; the two remain separate documents.

**Remaining for #7 after E01:** C03 and C05 remain unmet. Publisher catalog completeness, brochure currency against the registration system, and the stability of program codes as identities are unknown. Live intended-runtime collection, replay and review are the coordinator's and reviewer's actions on the exact artifact, and nothing here records them as done.

Muse is independently tracked in issue #1: permitted group/sender capabilities; narrow authenticated receiver/schema/receipt; stable post plus separate activity identities; replay, changed/out-of-order posts, minimal private data and partial/empty/missed reports; actual unattended delivery and permission proof. A synthetic receiver test is not account-specific working integration. Bootstrap receiver design can precede real delivery, but acceptance cannot.

## Optional calendar file

Export only supported time semantics with stable app-namespaced UID and update/cancellation policy, verified timezone/DST and true all-day exclusive end. Unknown clock is not all-day. An explicitly chosen date-only reminder is separate and labeled. Unsupported recurrence/exceptions are not silently exported as invented occurrences. Test hostile text/escaping, identity across changes, timezone and missing-time behavior plus actual intended calendar import where accessible. A file does not prove sync/cancellation delivery and can duplicate an upstream subscription. No private annotations/notes in shared files by default.

## Protected hosted operation

Build a Worker/D1 adapter only after source/runtime feasibility is known; test atomic batch/replay/fencing/lease recovery and rollback, preserving source/decision/notice migrations. Choose approved family identities and verify all reads/mutations including imports protected, unauthenticated/cross-user rejection, no shared private API caching and safe failures. Local labels and loopback Origin controls are not hosted authentication.

Prove actual allowed Worker egress, scheduled success/failed/partial/missed checks, recovery and retained health/receipts. Document storage/retention/quota behavior and restore/backup expectations. Start with app-shell caching; private offline sync is separate. Deployment/account provisioning needs separate authorization. Do not expose the development server. Native-device behavior, long-term reliability, full coverage and usefulness need separate proof beyond synthetic/local checks.
