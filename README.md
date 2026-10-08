# Town events — local preview

A working, private-on-this-computer inbox for public Town of Fuquay-Varina calendar events. It is a narrow public-events preview, not the full WebTrac class/camp catalog.

For a fresh conversation, start with [the roadmap and planning index](docs/ROADMAP.md), then the selected issue and its linked specification. [BACKLOG.md](BACKLOG.md) maps all open work to GitHub issues. [Planning notes](docs/PLANNING-NOTES.md) explain superseded and incomplete review records.

## Run

Requires Node 25 (tested 25.9.0) and npm. From this directory:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:4173**. The server binds only to loopback. SQLite state lives in ignored `data/preview.sqlite`; stopping and starting the server preserves interest, Hidden, feedback, exact reviews, preferences, learning history, receipts and normalized history. Keep that file to retain decisions. Do not run two servers against it. The initial startup imports the real sanitized public archives, then makes one ordinary check of both feeds. Later restarts reuse stored evidence; use **Check sources** for a new manual check. Responses are bounded to 2 MB; each request has a 15-second timeout. Denial, redirect or challenge response stops that part without bypass or retries.

```sh
npm test
npm run build
```

The source repository is public; the running app and its database stay local. GitHub stores code, tests, documentation and public calendar fixtures, not family settings, decisions, notes or runtime records. Publishing the source does not deploy the app.

## First workflow

1. Read the initial collection scope and freshness labels. New hides known disqualifiers; **Excluded by rules** exposes those records and their reasons. **All upcoming** retains uncertain recurrence/time items and makes all future records available for inspection.
2. Search or filter by category and event dates. Open a row to inspect source evidence, rules, preference reasons, before/after changes and its official listing.
3. Save Interested, Hide and Restore independently. Not interested opens a required reason flow; a neutral Other / not sure category needs no note. Passed items retain visible reasons and an exact Undo. Preference weights remain editable. Only a Generally pass changes ranking, and only for its one chosen topic or format at its scope. Optional interest learning starts off and is described [below](#bounded-interest-learning--issue-5).
4. Review the exact version and change IDs in the open details. A scan racing that review leaves later versions and their changes unreviewed.
5. Check Sources. A failure preserves successful observation times and last-known records. Schedule/status warnings relevant to Interested or actually displayed items at the time of the change remain separately visible even when Hidden or cancelled. Later surfacing alone does not invent historical notice relevance; ordinary changes remain available in Changed.

Source text is rendered by React as text; source HTML tags are stripped, never executed. Official URLs must use HTTPS, the exact Town hostname, no embedded credentials/nonstandard port, and a numeric legacy `calendar.aspx?EID=` or native `/m/calendar/event/detail/` path. The local API rejects cross-site access, unsupported Host values and non-loopback peers; POSTs require an allowed Origin and JSON. This is local protection, not hosted authentication proof. Do not expose or proxy this development server to a network.

## Source evidence

`fixtures/prcr.ics` and `fixtures/arts.ics` are copies of the read-only research captures. Original observation time: **2026-10-04T02:35:33.636296Z** (October 3, New York). These are actual public Town calendar data, not invented opportunities or a new current check. See `fixtures/provenance.json`. `fixtures/current-*.ics` are the successful ordinary local October 6 UTC captures; `fixtures/current-provenance.json` records their exact observation times and body hashes. These public snapshots contain no family settings.

The archives contain 27 category memberships, 21 publisher UIDs, four closures and 17 other entries. Identity is `town:fuquay-varina:<UID>`; same title/different UID remains distinct. Category feeds are memberships. The ordinary local check on **2026-10-06T04:23:34Z** succeeded with 7 Parks/Recreation and 20 Arts VEVENTs, zero rejects, retaining those same 21 identities. This establishes access from this local runtime at that time only. It proves neither complete coverage, fixed horizon, long-term availability nor Worker access.

The fresh feed changed official description URLs from the legacy EID route to the Town’s native mobile event-detail route. Genuine description/URL changes remain in provider change history. An initial allowlist bug rejected that native path; revision 1.1 reprocessed retained public responses with their original acquisition times. Those correction changes are explicitly labeled **Parser correction** and do not claim a fresh source verification. Source-local DTSTAMP/LAST-MODIFIED metadata is surfaced as a warning and is never ordering authority.

## Architecture and tested boundaries

- TypeScript domain: established `ical.js` parser, source-specific extraction, publisher identity, rule assessments, preference evidence and URL validation. VTIMEZONE definitions register for each parse; the registry is reset to avoid cross-response leaks.
- React/Vite UI: cream/ink editorial inbox, one green accent, responsive rows, reduced-motion support, keyboard-trapped details dialog with Escape and focus return.
- Node HTTP/SQLite local runtime: one process, synchronous atomic transactions, source-part health, immutable observations/versions, receipts, source representations, changes, family intentions, exact acknowledgements and feedback.
- `server/schema.sql` uses SQLite/D1-compatible tables and SQL primitives. **Deviation:** the working API currently uses Node’s SQLite adapter, not a Worker/D1 runtime. No deployed D1 batch, Worker egress, authentication or scheduler is tested. A Worker adapter and intended-runtime tests remain before hosting; schema compatibility alone is not deployed proof.

Direct scans reserve an expiring lease and increasing fence. Every ingestion commit checks the current fence and expiry; older trusted observation times cannot overwrite newer evidence. Reusing a batch ID with the identical payload returns its receipt; changing it fails. One failed part does not invalidate the other. Parse rejects and duplicate UIDs are counted in receipts and observations. Malformed calendars fail the part; genuine empty calendars are accepted. Missing rows do not imply cancellation or remove last-known data.

Fact provenance follows the selected representation’s own observation time and kind, with every feed’s provenance exposed. Conflicts retain both representations, stay uncertain and are displayed in stable category order without claiming that order establishes authority. Updates that change a conflicting representation produce an explicit representation change. Schedule/status changes in any representation can be critical; URL-only or generic source-agreement changes are ordinary changes. Notice relevance is frozen from existing family intentions/exposure when the change is created, preventing later display from inventing historical warnings. Migrated pre-notice-eligibility history stays available in Changed without assuming unrecorded prior family relevance. Parser reprocessing updates both representations in one transaction, preventing intermediate parser-only conflicts.

Raw public responses are retained for the latest 40 successful observations per part, bounded to 2 MB each. Older raw observations expire under that policy; hash-linked receipts and normalized versions remain. Failed checks keep fixed categories and known transport fields in the bounded acquisition history described [below](#town-calendar-evidence--issue-7-bounded-local-candidate); failure bodies are never stored. Family state and history are not automatically pruned. This small local pilot has no production storage/quota guarantee.

Date semantics retain known clock/timezone, true all-day exclusive end, and missing/unknown time separately. Fall Saturday rules use event-local calendar dates; rolling upcoming uses New York today. An already-started event with possible ongoing attendance remains uncertain without late-entry evidence. Unsupported VEVENT recurrence remains Needs checking; a historical master does not invent future attendance or exclude all future sessions. Recurrence exceptions are counted as rejected/quarantined observations. VTIMEZONE recurrence is supported and is not mistaken for VEVENT recurrence.

An optional private age profile (see below) is compared only with narrow supported provider age wording. The archived Town feeds contain none, so every current Town listing shows no supported age rule. Fee, capacity and registration remain unverified. Travel, budget and calendar conflicts are explicitly not checked. This preview cannot validate mandatory multi-session course eligibility because no bookable course/section source is connected. Synthetic birth dates appear only in tests. No real family birthday or private origin is stored in public files. Optional decision notes remain in ignored local SQLite storage and are never sent to an external model.

Ranking is transparent word matching, not a validated prediction of usefulness. A fresh install starts with every topic weight at zero and the optional fall-Saturday rule disabled. Set your own priorities in Preferences; existing database preferences survive upgrades unchanged. Generic education/hands-on/craft bonuses are capped at 8 combined; ambiguous standalone “make”/“build” do not establish hands-on activity. Earlier More/Less is preserved as unscoped historical feedback. The new UI records reason-aware Not interested decisions instead; no reasons, child targets or broad preferences are inferred for legacy feedback. Scoped explicit instructions and optional bounded learning (issue #5, below) refine this ranking without rewriting Settings. Parent judgment remains the usefulness gate.

## Validation

157 passing tests (42 baseline, 36 age/suitability, 37 interest-learning and 42 Town calendar evidence tests described below) cover archive counts and links, empty/challenge/invalid responses, timezone registry isolation, DST, all-day end semantics, fall versus December Saturdays, ongoing/unknown attendance, synthetic age uncertainty, recurrence quarantine, hostile URLs/markup, ranking cap, replay/payload conflicts, expired/stale fences, old imports, failure retention, transaction rollback, exact review races, saved/hidden and actually surfaced notices, feed conflict provenance and saved warnings for nonselected conflicting cancellations/schedules, source absence, parser rollback/reprocessing and acquisition-health preservation, raw retention and actual file-backed close/reopen persistence, unchanged-schedule native-URL updates from real saved/current feeds, and creation-time notice relevance. `npm run build` checks types and builds the production client.

The parent agent performed separate desktop and 390-pixel mobile browser QA: actual layout/detail inspection; search, category and date filters; four closures and three known excluded entries; interest persistence across reload/restart; independent Hide/Restore; exact review; keyboard focus trap/Escape/focus return; no mobile horizontal overflow; and an unsaved preference draft surviving a 16-second polling cycle. Six actual API rejection checks passed (cross-origin read/write, absent Origin, non-JSON mutation, cross-site fetch, and a raw unsupported Host); the valid read returned 200 with no-store. These are parent-run checks, not tests executed by the implementation agent. Browser checks used temporary choices and separate synthetic fixtures; runtime test history is excluded from the repository. Unit/replay/browser checks do not establish native calendar import, hosting, catalog completeness, long-term reliability or family usefulness.

## Remaining work

Stages 1–3 now have a usable local path, subject to parent pilot feedback. See [BACKLOG.md](BACKLOG.md) for retained follow-ups and later gates: characterize Town coverage and longitudinal updates; validate descriptive eligibility facts and usefulness; optionally implement correct calendar-file export; build a Worker/D1 adapter and prove protected hosted scheduled behavior; establish a permitted complete WebTrac route; then expand under the original ordering to Wake and separately prove Muse delivery. No production, full-catalog or scheduled-operation claim is made here.

## Implementation provenance

The local preview foundation was implemented under Codex's lead, with independent Claude Opus code review and separate browser QA. Claude wrote the later age (#2), interest-learning (#5) and calendar-evidence (#7) increments, which received independent Sol review before integration. Review of the combined candidate on `feature/reviewed-preview-integration` is recorded on its draft pull request. Reviews and tests establish the stated local behavior, not hosted operation or family usefulness.

Visual thesis: a calm cream-and-ink editorial inbox with a single green action accent. Content plan: scope/freshness, inbox navigation, readable event rows, evidence/rule/change inspector, source health and preferences. Interaction thesis: restrained row entrance, short drawer transition and clear hover/focus affordances; reduced motion removes animations.


## Reason-aware decisions — phase 1

Not interested requires one or more categories: timing, conflict, general disinterest, wrong fit, a price/travel/format/duration/organizer concern, or neutral Other / not sure. Notes are optional, bounded and local. Concern dimensions are explicitly selected and remain listing-specific in this phase. General disinterest defaults to **just this listing**; choosing **generally** requires one supported source-grounded topic/aspect and an explicit child or household scope. Selectable features use conservative literal word patterns with exact quotation/span, extractor revision and uncertainty; venue-only Arts Center text does not establish an art topic. This is grounded textual inference, not a provider audience/eligibility rule.

Phase 1 recorded scoped general preference **intent** without changing ranking. Such pre-upgrade passes stay inert history. A new Generally pass also sets its one chosen topic or format to 0 at its scope (issue #5, below). Baseline weights and source eligibility never change. Broader dimension constraints and repeating schedule windows are later phases. Unsaving, Hide and review create no negative-learning record. A saved timing pass is valid and is shown as saved plus passed.

New excludes active passes through projection; it does not mark them reviewed or acknowledge source changes. Passed, All upcoming, Interested and Changed retain access. Important source notices keep their creation-time eligibility and acknowledgements. Timing/conflict decisions gain a separate Reconsider entry when meaningful displayed attendance facts change, including parser corrections. Source review and reconsideration review have distinct actions. A pass remains active until explicitly changed or undone; ordinary descriptions, identical category memberships and known-time formatting do not reopen it. General-disinterest mixed with timing stays in a counted secondary attendance-change section while critical notices remain independently visible. A future source cancellation remains a source warning; expired or explicitly cancelled items do not prompt a new attendance choice.

Unsupported recurrence creates a **program-level pass against the displayed master schedule**, with “Individual dates need checking.” It invents neither occurrences nor calendar constraints. RRULE/RDATE/EXDATE values are not captured by the current adapter, so rule-only changes cannot be claimed detected; master start/end, cancellation transitions and recurrence-presence changes are supported. Unknown-to-confirmed status alone does not reopen a timing pass. The Reconsider panel shows actual changed start/end, cancellation, recurrence or category-specific evidence, including nonselected conflicting facts; current unsupported recurrence retains its dates-needing-checking caveat even if the original pass had single-event scope. Future recurrence capture and actual occurrence semantics remain separate work.

`decision_events` is append-only and transactionally stores local household/child/operator IDs, the shown source version, representation/envelope hashes, source evidence, feature attribution, attendance facts, reasons, target/scope, optional note, supersession/reversal links and an idempotency receipt. Database triggers reject updates/deletions. Stable local labels are **not authentication**; a second household, child or operator is rejected until multi-subject projections are implemented. The UI keeps the shown source facts stable through polling and decision refresh, labels newer source versions before submission, preserves dirty notes and uses the same retry key after uncertain delivery. Exact duplicate commands return the original receipt; mismatched key reuse and stale active-decision races fail closed. Undo appends an exact reversal and restores any earlier superseded active pass without touching independent bookmarks, Hidden or source-review state.

Migration enables and verifies foreign-key protection before BEGIN, then creates schema, applies ALTERs and seeds defaults in one transaction. Failure rolls everything back and closes the connection; replay preserves known legacy intents and unscoped feedback while adding empty decision history. New decisions freeze what was actually shown; later description or feature changes cannot silently retag them. No model is called, and no private notes or household history enter public artifacts. Successful decision actions deliberately restore keyboard focus to the decision heading or list heading (active tab when no list is present). Closing details restores its original trigger when present; when a pass or review removed that row, focus returns to the list heading or active tab. The Change reasons button is disabled while its form is open, preserving the draft; Undo is disabled while replacement reasons are being edited. An in-flight action cannot open another reason form or overwrite another item’s dialog draft/errors on completion. Explicit Cancel, Escape and backdrop dismissal discard an unsubmitted draft; polling preserves it. The implementation uses the existing tested local Node/SQLite runtime; deployed D1/Worker and hosted authentication remain unverified.

19 additional meaningful tests verify strict reason validation, neutral/multiple reasons, grounded general targets and scopes, concern dimensions, second-subject rejection, unchanged ranking, append-only/idempotent/atomic actions, saved-and-hidden notice preservation, stale-source snapshots, active-decision races, Undo restoration, parser-correction reconsideration, separate source/decision acknowledgements, category/formatting invariance, unsupported recurrence limits, immutable attribution and real close/reopen migration with legacy feedback; additional checks prove migration rollback/replay through both early malformed schema and late seed failure, end-only/nonselected attendance evidence, recurrence scope transitions, cancellation-only timing materiality and required explicit general scope.

## Optional private age and suitability — issue #2

**Preferences → Child age profile** stores one optional private profile in the ignored local database. You can describe the child's age as completed years as of a date (the default; no birthday needed), an exact birthday, a birth month and year, a birth year, or leave it unknown. Names and grades are not collected. Each save appends an immutable revision dated in New York time. A save made from a stale editor is rejected until you explicitly reload; the draft survives polling. Choosing Unknown changes the current profile but does not delete earlier local revisions. Ordinary preference saves cannot change or clear the profile. If an earlier version stored a birthday in preferences, it is held privately as a pending raw value. It is used only after you confirm it in the editor, or removed when you discard it.

Provider age rules are read only from narrow supported wording: age ranges, "and up/under", "must be at least N years old", "for children under N", and explicit cutoffs such as "as of September 1, 2026". The full grammar and limits are in [the age specification](docs/plans/age-suitability.md#delivered-implementation). Each listing shows the provider rule status (meets / outside the stated rule / needs checking / provisional / none), source-described likely audience, supervision conditions and unsupported wording separately, with exact quotes.

Some wording never confirms or excludes:
- negated or qualified clauses ("not for ages…", "recommended for ages…");
- several ranges, and role- or unit-ambiguous ages;
- any other unresolved age wording in any feed.

These keep the listing at "needs checking". Height, weight and count limits are never read as ages.

- "Meets" covers one stated rule, never overall eligibility.
- Without a stated cutoff, the comparison at the event start is only provisional.
- Only a confirmed "outside" moves a listing to **Excluded by rules**. **Show anyway** reverses that age placement for the listing only, with its own history. It lapses visibly if the rule or comparison changes, and stays lapsed even if the change is later undone, until you choose Show anyway again. It never overrides Hide, a pass, cancellation or another failed rule.
- A "wrong fit" pass can optionally say too young / too old / other. This is your judgment, not provider evidence or a readiness assessment.
- If the age rule or comparison later changes, a separate **Reconsider fit (age)** prompt appears. It is acknowledged separately from timing reconsideration and source review.
- Provider age-rule changes are critical source warnings with exact change IDs. Sometimes an app upgrade changes the age reading or comparison of an unchanged stored listing under the same profile. That appears as a separately acknowledged local attention item for saved or seen listings. Profile edits never create such items or source warnings. Ranking is unchanged.

**Measured coverage:** the archived and current public Town feeds (54 VEVENTs) contain no age wording at all, so extraction coverage on real Town listings is zero. Supported phrasing is proven only on synthetic tests.

36 additional tests (Node test runner, synthetic data only) cover:

- civil-date arithmetic across leap centuries, and February 29 interpretations;
- inclusive/exclusive cutoffs on, before and after the birthday;
- age-as-of inverse intervals, month/year wholly in/out/overlapping, and anchor immutability;
- two host-timezone subprocesses and New York DST dates;
- grammar, unsupported wording, supervision and hints;
- negated/qualified clauses, non-age quantities, and unresolved wording in the same or another feed;
- conflicts and silent feeds, recurring fixed cutoffs, and material-vs-audit signatures;
- the public wording measurement;
- atomic legacy migration with injected failure, pending raw preservation and explicit discard/confirm;
- profile races, replay, no-op and receipt redaction, and rejection of unsupported IDs and fields;
- fit validation with exact pre-upgrade receipt replay and Undo;
- age reconsideration key isolation and precision/current-day stability;
- Show anyway placement, revert, and lapse persistence across A→B→A source and profile changes;
- critical age notices, parser cause, evidence loss and newly ambiguous feeds;
- local extractor and comparison-algorithm correction attention across restart, including that profile edits and revision-only changes add none;
- file-backed restart;
- upgrading earlier-revision state (v1 baselines, Show anyway and fit-pass bases, legacy age reviews) with no false correction, lapse or reconsideration, while real changes are still detected;
- loopback HTTP routes: guards, no-store, 409 reloads, no response or log echo, no external `fetch`;
- the ignored/untracked database, WAL and SHM paths.

The implementation agent did not check browser behavior of the profile editor, labels and dialogs. Full synthetic browser acceptance remains unverified.

## Bounded interest learning — issue #5

The full contract and its limits are in [the interest-learning specification](docs/plans/interest-learning.md#delivered-implementation).

**Explicit priorities.** In **Preferences → Interest learning** you can set a whole-number instruction (0–10) or Clear (inherit) for any of 11 grounded topics and formats, at child or household scope. Child wins over household, and household wins over the Settings slider. Sliders are never rewritten; an overridden slider says so. A **Generally** pass sets only its chosen topic or format to 0 at its chosen scope. The form shows the effect before you submit, and Undo or changing reasons removes only that pass's instruction. A Clear keeps learning recorded before the cleared instruction set aside, even if that instruction's pass is later changed or undone. If another window changes the instruction you are editing, or the one a Generally pass would replace, the form keeps your draft. It shows the old and new values and asks you to **Review current value** before submitting; the server also rejects the stale submission. A pre-upgrade Generally pass stays inert; **Apply as preference** turns it into a separate instruction.

**Optional learning.** Learning starts **off**. While it is on, **Interested** saves the bookmark and records one frozen signal:
- the source version shown;
- the grounded words and their spans;
- revisions;
- a fixed 1000-unit split across the listing's topics and formats.

While off or paused, Interested only saves the bookmark and notes that no signal was created; nothing is backfilled. You choose whether a listing is a distinct opportunity, the same program as an earlier signal, or not sure. Only confirmed distinct programs count, once each. A topic or format needs 3 of them before it gets any lift. Lift is nonnegative and at most 2, never above 10, and not applied while an instruction for that topic is active. It breaks ties only between listings with equal explicit scores; it never moves a listing above one with a higher explicit score. There is no decay, no penalty for skipped listings and no enjoyment percentage.

**Changing or removing signals.** Source edits do not retag a signal; Details shows the counted version. Regroup and Re-record (with an old/new preview) are deliberate, linked and undoable. **Undo Interested** removes the exact signal and leaves the bookmark alone; Unsave, Hide, passes and source review never touch learning. Pause returns ranking to explicit priorities. **Reset learned evidence** starts a new learning period without deleting history or changing Settings, instructions, bookmarks, passes or notices. Everything is an append-only, receipted local log with the one-child guard, and nothing is sent to a model or external service.

37 synthetic tests cover:
- allocation and scoring;
- explicit precedence and the counterexample where effective-score ordering would invert;
- grouping, thresholds and suppression, including Clear boundaries that survive pass changes;
- pass lifecycles, stale Generally races and receipt replay;
- source and local-age notices staying pending through every learning action and restart, cleared only by their exact acknowledgements;
- frozen attribution, replacement and Undo;
- pause, reset, notices and bookmarks;
- idempotency, atomic rollback and stale windows;
- file-backed migration, restart and two connections;
- loopback HTTP.

These tests do not establish that recommendations are useful; that is the parent pilot ([#10](https://github.com/michaeltorbert/homeschool-collector/issues/10)). A coordinator synthetic two-window browser check ran on earlier source `e877`; it is historical and does not prove the current tree. Current browser acceptance of these controls is unverified.

## Town calendar evidence — issue #7 (bounded local candidate)

**Status:** a bounded local candidate, now part of the combined local candidate on `feature/reviewed-preview-integration` (draft pull request; not merged or released). Issue [#7](https://github.com/michaeltorbert/homeschool-collector/issues/7) stays open and incomplete. No permitted complete class/camp catalog route is established (C03 unmet), so no catalog or Wake adapter exists (C05 unmet). Publisher scope, horizon and truncation are unverified. The full contract and its limits are in [the source specification](docs/plans/source-and-hosting.md#bounded-calendar-evidence-candidate).

**What a check records.** Each ordinary check of the two Town feeds now leaves one acquisition record per feed:
- the outcome: Successful, Empty, Partial or Failed;
- the start and completion times, Node runtime, HTTP status, media type and byte count, but only when actually known;
- for a failure, a fixed category: access denied (401/403), rate limited (429), another status, network or redirect failure, timeout, too large, no body, stream failure, not a calendar, or unreadable.

The response body is stored only on success, as before. Failure text, remote messages and exception strings are never stored or shown.

**Measurements of a successful response.** These are frozen when the response is received:
- counts: returned = accepted + parser rejects + duplicate UIDs;
- the range and count of start times with a clock time;
- all-day dates, counted separately;
- unknown times and repeating (recurring) masters;
- listing order of the clock-time starts: earliest first, latest first, mixed, or not applicable.

These dates are what one response showed. They are not occurrence expansion, the publisher's date range, a row cap or truncation proof.

**Comparisons.** Each check is compared with the nearest previous successful check of the same feed URL and origin (live or dated archive). It shows how many listings are new, not seen this time, changed and unchanged. "Not seen this time" never means cancelled. It never removes or alters listings, memberships or notices. A partial response weakens the comparison, and publisher scope stays unproved for every pair.

That nearest check is chosen first; if it was read with a different evidence or parser revision, Sources says "Not compared" (revision changed) and the earlier figures are labelled as an earlier reading. No older check with a matching revision is searched for.

The Sources view also shows how many listings appear in both feeds' latest successful responses, and whether they agree. Each side is labelled:
- a live response, with its read time; or
- a dated archive, with its original capture time and separate import time.

The two are never presented as simultaneous reads, and overlap is unavailable when the feeds were read with different parser versions. Overlap does not establish which feed is correct. All Sources dates include the year.

Detailed measurements belong to the exact check behind the current data. A newer intake without a check record shows "Not measured" rather than borrowing older figures.

**Retention and replay.**
- Acquisition records: the latest 100 per feed, immutable while kept.
- Response identity maps (used only for comparisons): the latest 3 successful checks per feed.
- Raw successful responses: still the latest 40 per feed.

Replay of an acquisition works only while its record is kept. An acquisition's identity comes from its scan fence and feed. An exact repeat returns the identical result; a differing one is rejected. After pruning, the old fence is rejected before anything is written. Earlier ingestion receipts replay unchanged.

**Upgrades and corrections.**
- An upgrade adds the new tables in one transaction and backfills nothing. Earlier checks show "Not measured for this earlier check" until the next ordinary check.
- Parser corrections never add a check or change its times, health or frozen measurements.
- An earlier stored error is shown as "Failed (legacy detail not shown)". The stored row is not modified.

**Dated access evidence (not current proof).**
- The coordinator ran an ordinary preflight on October 7, 2026, at 18:30 UTC (Node v25.9.0, coordinator-run, not this module). Both calendar feeds returned HTTP 200:
  - Parks/Recreation: 7 VEVENTs, 7 accepted;
  - Arts: 20 VEVENTs, 20 accepted.
- Neither feed had parser rejects, and the UID sets matched the dated fixtures. Reported body SHA-256s: `ea6d1f5a…0768` (Parks/Recreation) and `ff71cb55…5849` (Arts).
- The dated fixtures list starts latest first. Six listings appear in both feeds, giving 21 identities.
- Whether 7 or 20 is a cap, and the publisher's date range, remain unknown.
- The Town's published registration landing page returned HTTP 403 to one ordinary GET on October 7, 2026 (UTC). Retrieval stopped there, and no further registration requests were made. No bypass, session reuse, proxy, challenge handling, account or outreach was attempted.

**Tests.** 42 synthetic tests (Node test runner; temporary in-memory or file-backed databases; injected fetch, so no network). They cover:
- review-round regressions: a same-time direct legacy ingest unlinking stale measurements, while exact replay and parser corrections keep the link; parser-revision transitions for per-feed comparisons and cross-feed overlap, including not skipping past the nearest incompatible check; and the exact rendered Sources text for archive/archive and live/archive overlap, cross-year dates, revision wording and the plain catalog label;
- pure measurements: timezone/DST, all-day, unknown, recurrence, duplicates, all-rejected, empty and listing order;
- an injected retriever: 200, empty, 401/403/429/other statuses, redirect/network, HTML, missing body, oversize/false/missing length, stream failure and real-signal timeouts. They also check one call with no retry, the exact allowlisted URL, and cancel/release on every early exit;
- atomic rollback and replay/conflict across the retention horizon;
- expired/superseded/stale/older guards for success and failure;
- 100-attempt/3-map/40-raw retention, including more than 100 failures after a success;
- partial and empty baselines, absence that changes no listing, notice or membership, and overlap read at different times;
- parser-correction provenance and error sanitizing;
- pre-feature upgrade with restart, preserving synthetic bookmarks, Hide, a pass, review, notice, age profile and learning;
- early and late migration rollback;
- archive import conflict and receipt handling;
- loopback HTTP redaction.

The implementation agent ran `npm test` (157/157) and `npm run build` at implementation time.

**Dated module run and Sources view (historical reuse, not current proof).** On October 7, 2026 at 20:28:59Z the coordinator ran a real two-feed check through this module's `SourceChecker` (Node v25.9.0) on an earlier candidate: 7 Parks/Recreation and 20 Arts listings, 6 shared and 21 unique identities, 0 parser rejects and 0 duplicates. This is separate from the 18:30 UTC preflight above. After that run only Sources date formatting changed; the retriever, store, parser and schema were identical. The coordinator's actual Sources view checks at 1280 and 390 px were refreshed on the current application bytes. None of this is integration, production, hosted or catalog proof.
