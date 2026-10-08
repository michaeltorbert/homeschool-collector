# Bounded interest learning

Issue [#5](https://github.com/michaeltorbert/homeschool-collector/issues/5). The local implementation described in [Delivered implementation](#delivered-implementation) exists in source (`src/learning.ts`, `server/learning.ts`) and is part of the combined local candidate on `feature/reviewed-preview-integration`. Review, browser QA, integration and closure status are tracked on the issue, not asserted here. Recommendation usefulness is a separate parent pilot outcome ([#10](https://github.com/michaeltorbert/homeschool-collector/issues/10)); tests do not establish it. Age behavior is governed by [age-suitability.md](age-suitability.md). Public starter weights remain neutral; each household sets private priorities.

## Keep the judgments separate

Interest, provider admission rules, audience fit, attendance constraints, saving, visibility and review are distinct. Required reason categories and optional private notes remain. A timing conflict, wrong fit, price/travel concern, Hide, source review, exposure or silence cannot create topic dislike. General rejection defaults to this listing; a broad instruction requires one grounded target and deliberate child/household scope. A multi-topic listing cannot transfer a rejection to every tag or its provider.

## Requested behavior (original contract)

- Explicit targeted preference instructions take effect immediately at the selected scope and persist until edited. A child preference layer is separate from household defaults. Behavioral evidence never rewrites baseline Settings weights.
- New Interested intent may create a separately identified weak positive contribution over grounded topic/format features; distribute a fixed contribution across features rather than multiplying it. Saving and its learning contribution remain independent. A later general instruction for the same scoped target supersedes applicable earlier positive learning while retaining bookmark/history.
- Preserve existing bookmarks and old More/Less as known legacy intent only. Do not invent old subject IDs, targets, reasons or learning signals; offer optional clarification.
- Deduplicate retries, versions, repeated actions and supported series/program groups. Three distinct active unreversed opportunities for a subject/feature are an initial guardrail for noticeable weak-signal reordering, not a calibrated confidence claim. Repeated dates/versions from one program count once; uncertain identity is not fabricated independence.
- Use capped averages, at most two points from the explicit baseline on the existing 0–10 scale, with floors/ceilings and the existing capped generic bonus. Preserve ordering of distinct explicit priorities; refine ties without silently promoting a lower explicit priority over a higher one. Explain every allocation and tie rule.
- Opposing targeted evidence acts at the same scope without deleting raw events. Positive signals cannot invent negative interest from silence. No automatic decay; seasonal evidence remains until contradicted/reversed or an explicitly chosen future recency policy is validated.
- Freeze representation/source version, grounded features and spans, extraction/algorithm revision, subject/actor scope and original signal allocation at decision time. Source edits cannot retag a historical save. A correction needs linked old/new attribution, a visible reason and Undo. Undo removes the exact active contribution. Unsave changes the bookmark only; explicit Undo Interested reverses the linked contribution. Hide and source review never reverse learning.
- Learning on is visible and reversible; pause returns to explicit priorities and reset rebuilds the derived profile without deleting immutable history or changing settings. No non-click penalty, invisible blacklist or uncalibrated enjoyment percentage. Critical notices retain their creation-time eligibility and separate acknowledgements.
- Use the current one-child/operator projections; reject additional subjects until [#11](https://github.com/michaeltorbert/homeschool-collector/issues/11). Private notes/profile/history are never model inputs.

Not part of this issue and not implemented: an audience-fit modifier, labeled exploration sampling, automatic recency decay, model or private-note interpretation, automatic source-edit correction, group merging, multiple subjects and hosting.

## Delivered implementation

### Features and explicit priorities

`src/learning.ts` holds the feature registry. Each grounded topic maps to one Settings key: art→art, chess, crafts→craft, hands-on, outdoors, sailing, science. Concert, exhibition, performance and workshop formats have an explicit baseline of 0 outside Settings. Education is Settings-only. Grounding is unchanged: `grounded-words-v1` conservative word spans, never venue text.

Explicit relevance resolves the child instruction, then the household instruction, then Settings (formats: 0). With no instruction, scoring is byte-for-byte the earlier word-match baseline (tested against the public fixtures). A topic instruction replaces that key's Settings value. It matches the earlier baseline word *or* the grounded feature, counted once. So an art instruction reaches a grounded "sculpture" listing that the baseline art words never matched. A format instruction adds its own term over grounded matches. Workshop joins education, hands-on and craft under the combined cap of 8, for both explicit terms and the learned residual.

Instructions are whole numbers 0–10 or Clear (inherit) at child or household scope, entered in **Preferences → Interest learning** for any of the 11 topics/formats. The Settings slider shows when an instruction overrides it. Negative scores and blacklists are never produced.

Each instruction draft pins the identity of the instruction at its topic/scope. Pinning happens when the draft starts, when you choose a topic or scope, or when you press **Review current value**; background polling never re-pins it. If another window changes that instruction, the editor shows the old and new values, keeps your draft value, and disables Set/Clear until you review. The server independently rejects a stale identity with 409.

A **Generally** pass must now carry the `learning-instruction-v2` contract plus the identity of the instruction at its chosen topic/scope that the reason form showed (or none). It sets exactly its chosen feature to 0 at its chosen scope, in the same transaction as the pass. The reason form states the consequence before submit, including the at-floor case ("already 0; blocks learned lift") and a child instruction that still wins over a household 0. Mixed reasons never transfer to other topics or the provider.

The instruction is live only while its exact pass is active:
- Superseding the pass without the same target/scope retracts it, and the reason form previews this.
- Undo of the superseding pass restores it at its original sequence, so a newer independent instruction still wins.
- Undo never clears another instruction.

The same transaction, before any write, checks that the instruction now at that scope/topic is the one reviewed. Otherwise the server returns 409/reload: an independent manual change or another listing's Generally pass is never silently replaced. The reason form pins that identity when you choose the topic or scope. A later change shows the old and new values, keeps your reasons and note, and blocks submission until **Review current value**. A retried stale command stays a 409; it is never turned into a new command. A fresh Generally command without the current version returns 409/reload: a pre-upgrade tab, or an earlier `learning-instruction-v1` tab, which had no reviewed identity. These checks run after exact receipt replay, and the new fields enter the canonical payload only when present. Genuine pre-upgrade and v1 receipts therefore replay unchanged. Pre-upgrade Generally passes stay inert. **Apply as preference** creates a fresh, independent household/child 0 instruction that references the old pass. Undoing the old pass does not remove it.

### Weak signals

Interested (row button or dialog) is one receipted command: it saves the bookmark and appends a frozen signal atomically. The signal holds the shown source version, envelope and representation hashes, grounded features and spans, extraction/algorithm revisions, a Settings provenance hash, the local subject/actor and an integer allocation. Allocation splits exactly 1000 milli-units across the unique grounded features sorted by ID; leftover units go to the first IDs. While learning is off or paused, Interested saves the bookmark and records only `no-signal`. Nothing is backfilled later. Plain Save bookmark on a passed listing, Unsave, Hide, review and passes never create or reverse signals.

Independence is never inferred from titles, dates, digits or differing UIDs. Each signal is deliberately placed:
- **distinct** (new confirmed group; counts);
- **same program as** an earlier group (counts once; another member becomes a visible non-counting `duplicate-group` record); or
- **not sure** (provisional; recorded and inspectable, never counted).

Retries and re-saves of the same listing in one learning period are non-counting `duplicate-item` records. Non-counting status is frozen. A record never becomes counted because another signal later disappears; only a new deliberate intent, regroup or re-record can count.

For each feature, counted groups are the active, unreversed, counted, unsuppressed signals of the current learning period:
- Fewer than 3: no lift, labeled insufficient evidence.
- At 3 or more: lift = min(2, 2 × mean share), clamped so the resolved weight stays at or below 10. Extra groups cannot inflate a fixed average.

Lift is not applied while any instruction for that feature is active. A manual Clear freezes the suppression boundary of the instruction(s) it ended at its scope, recorded on the Clear itself. Signals recorded before that boundary stay set aside, even if the originating Generally pass is later superseded or undone. Signals recorded between the instruction and the Clear are not set aside by it. A Clear row written before this field existed falls back conservatively to every earlier set at its scope, so it never revives evidence. When no manual Clear intervenes, Undo or supersession of the instruction's pass removes its cutoff and restores the evidence. A restored pass instruction keeps its original sequence, so a later Clear or instruction still wins. There is no time decay. Learned terms use the listing's actual current grounded features only.

**Chosen bounded delivery (accepted contract R5).** Learning adds only a nonnegative lift of at most 2. Ranking compares explicit score first, then the learned score, then start time, then stable ID. A learned lift therefore reorders only listings with equal explicit scores and never overtakes a strictly higher explicit score; the tests include a counterexample where effective-score ordering would invert. Opposing intent is expressed through deliberate scoped instructions and exact Undo, not inferred weak negatives. The original "two above/below" wording is treated as a bound, not a mandate to infer dislike. With neutral defaults many listings tie, so learning can visibly order them. Paused or off learning reproduces the explicit baseline ordering, plus a stable ID fallback.

### Replacement, Undo and controls

Source edits never retag a signal: the detail view shows the counted version and a changed-since label. **Regroup** changes only the group/certainty and copies the original frozen attribution byte-for-byte. **Re-record** previews old versus new attribution, then freezes the displayed version; the server rejects a preview that no longer matches. Both are explicit, current-period, learning-on commands that keep a `replaces` link and exact Undo. Neither runs automatically.

**Undo Interested** removes the exact signal; the bookmark is untouched. Undoing a replacement restores its original. If another listing now holds the original's group, the original returns visibly and permanently non-counting, linked to that holder.

Learning starts **off** on fresh installs and migrated databases, with a visible opt-in. Pause stops recording and application but keeps instructions. While paused, Undo works and Regroup/Re-record return 409. **Reset learned evidence** appends a new learning period: lift returns to 0 while Settings, instructions, bookmarks, passes, notices and all history remain. Reset is not deletion. Earlier-period signals stay visible. Their exact Undo cannot affect the new period, and they cannot be replaced; the same listing can be counted again in the new period.

### Persistence and guards

`learning_events` is one append-only log (update/delete triggers) of controls, instructions, signals, replacements and Undo. Its global sequence orders instructions against signals. Every command has strict fields, the one-child/household/operator guard and an idempotency key. Exact replay happens before any state check; a reused key with another payload is rejected. Expected-state guards cover the learning revision, the current signal and the current instruction at that scope, with the pass identity for Generally. Stale state returns 409/reload. Stale source submissions keep the shown version with `staleAtSubmit`. Creating the table is part of the existing all-or-nothing migration.

Source and age notices, Show anyway, reconsiderations and acknowledgements are unchanged. A saved, hidden or passed listing keeps its creation-time notices through learning actions, pause and reset.

### Evidence and limits

37 synthetic tests in `tests/learning*.test.ts` cover:
- **Pure contracts:** allocation, registry and baseline identity on public fixtures, overlay union and caps, threshold/average/ceiling/epoch, layer precedence, Clear versus retraction cutoffs, a frozen Clear boundary surviving pass retraction (including the conservative fallback for pre-repair Clear rows), the P1/Q/P2 sequence, comparator counterexamples, generic residual, frozen restoration, unknown shapes, pinned instruction drafts not rebased by a polled snapshot.
- **Storage:** no backfill, three-versus-two/uncertain/duplicate/program groups, strict explicit order and paused baseline order, timing/fit/concern/Hide/review/exposure leaving learning unchanged, a single scoped Generally effect, pass lifecycle, suppression, scope separation, pre-upgrade receipt replay with 409 for fresh unversioned commands, frozen attribution after source edit, byte-identical regroup, re-record preview, occupied-group restoration, pause/reset isolation, bookmark/notice independence, idempotency, validation, stale windows, injected-failure atomicity, append-only triggers, a Clear of a pass instruction staying in force through supersession and Undo, stale Generally passes against an independent manual change and against another listing's Generally (409 with no writes, a retried stale command never applies), and genuine v1 receipt replay.
- **Restart and migration:** file-backed pre-upgrade migration, restart replay, two connections, migration rollback, Clear boundaries across restart, a pre-repair Clear row.
- **Combined attention:** an eligible provider schedule notice and an eligible local age-extractor correction stay pending, with the same IDs, through Interested, regroup, an explicit instruction, a Generally pass, Hide, Undo, Unsave, reset, pause and restart. Source review clears only its exact change IDs and age attention only its exact key. Changes created while a listing was unsaved and unseen stay ineligible after later Interested; a new change after it is eligible.
- **HTTP:** loopback guards, no-store, 409 reloads (including a stale Generally), no echo and no external fetch.

These tests do not show that recommendations are useful. That remains a parent pilot outcome. A coordinator synthetic two-window browser check of these controls ran on earlier source `e877`; it is historical and does not prove the current combined tree. Current browser acceptance is unverified. Native-device and visual verdicts need their own evidence.
