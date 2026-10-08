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

Muse is independently tracked in issue #1: permitted group/sender capabilities; narrow authenticated receiver/schema/receipt; stable post plus separate activity identities; replay, changed/out-of-order posts, minimal private data and partial/empty/missed reports; actual unattended delivery and permission proof. A synthetic receiver test is not account-specific working integration. Bootstrap receiver design can precede real delivery, but acceptance cannot.

## Optional calendar file

Export only supported time semantics with stable app-namespaced UID and update/cancellation policy, verified timezone/DST and true all-day exclusive end. Unknown clock is not all-day. An explicitly chosen date-only reminder is separate and labeled. Unsupported recurrence/exceptions are not silently exported as invented occurrences. Test hostile text/escaping, identity across changes, timezone and missing-time behavior plus actual intended calendar import where accessible. A file does not prove sync/cancellation delivery and can duplicate an upstream subscription. No private annotations/notes in shared files by default.

## Protected hosted operation

Build a Worker/D1 adapter only after source/runtime feasibility is known; test atomic batch/replay/fencing/lease recovery and rollback, preserving source/decision/notice migrations. Choose approved family identities and verify all reads/mutations including imports protected, unauthenticated/cross-user rejection, no shared private API caching and safe failures. Local labels and loopback Origin controls are not hosted authentication.

Prove actual allowed Worker egress, scheduled success/failed/partial/missed checks, recovery and retained health/receipts. Document storage/retention/quota behavior and restore/backup expectations. Start with app-shell caching; private offline sync is separate. Deployment/account provisioning needs separate authorization. Do not expose the development server. Native-device behavior, long-term reliability, full coverage and usefulness need separate proof beyond synthetic/local checks.
