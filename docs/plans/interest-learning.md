# Bounded interest learning

Proposed; not implemented. The reason-aware decision workflow already records intent without changing ranking. Age behavior is governed by [age-suitability.md](age-suitability.md). Public starter weights remain neutral; each household sets private priorities.

## Keep the judgments separate

Interest, provider admission rules, audience fit, attendance constraints, saving, visibility and review are distinct. Required reason categories and optional private notes remain. A timing conflict, wrong fit, price/travel concern, Hide, source review, exposure or silence cannot create topic dislike. General rejection defaults to this listing; a broad instruction requires one grounded target and deliberate child/household scope. A multi-topic listing cannot transfer a rejection to every tag or its provider.

## Signals and bounded projection

- Explicit targeted preference instructions take effect immediately at the selected scope and persist until edited. A child preference layer is separate from household defaults. Behavioral evidence never rewrites baseline Settings weights.
- New Interested intent may create a separately identified weak positive contribution over grounded topic/format features; distribute a fixed contribution across features rather than multiplying it. Saving and its learning contribution remain independent. A later general instruction for the same scoped target supersedes applicable earlier positive learning while retaining bookmark/history.
- Preserve existing bookmarks and old More/Less as known legacy intent only. Do not invent old subject IDs, targets, reasons or learning signals; offer optional clarification.
- Deduplicate retries, versions, repeated actions and supported series/program groups. Three distinct active unreversed opportunities for a subject/feature are an initial guardrail for noticeable weak-signal reordering, not a calibrated confidence claim. Repeated dates/versions from one program count once; uncertain identity is not fabricated independence.
- Use capped averages, initially at most two points above/below explicit baseline on the existing 0–10 scale, with floors/ceilings and the existing capped generic bonus. Preserve ordering of distinct explicit priorities; refine ties and event-level relevance without silently promoting a lower explicit priority over a higher one. Explain every allocation and tie rule.
- Opposing targeted evidence offsets at the same scope without deleting raw events. Positive signals cannot invent negative interest from silence. No automatic six-month decay in v1; seasonal evidence remains until contradicted/reversed or an explicitly chosen future recency policy is validated.
- Keep any future audience-fit modifier separate, bounded and uncertain. Do not show an uncalibrated enjoyment percentage. Use explained match/uncertainty and insufficient-evidence labels.

## Replay and controls

Freeze representation/source version, grounded features and spans, extraction/algorithm revision, subject/actor scope and original signal allocation at decision time. Source edits cannot retag a historical save. A correction needs its own linked old/new attribution, visible reason and Undo; semantic reassignment requires confirmation. Deterministic correction policy must be documented before automatic replacement. Undo removes the exact active original/corrected contribution. Unsave changes the bookmark only; explicit Undo Interested reverses the linked positive learning contribution. Hide and source review never reverse learning.

Learning on is visible and reversible; pause returns to explicit settings and reset rebuilds the derived profile without deleting immutable history or changing settings. Clarify reset versus deletion. All/Needs checking/Passed remain accessible. Clearly labeled exploration can sample within configured constraints/accessible uncertainty, never across known hard exclusions. No non-click penalty or invisible permanent blacklist. Critical notices retain their creation-time eligibility and separate acknowledgements even after ranking/pass/Hide changes.

## Delivery and meaningful checks

Specify pure signal allocation/order and synthetic cases; add append-only contribution/explicit-layer persistence with migration/idempotency; integrate scoring, explanation/pause/reset/Undo and synthetic browser checks. Use the current one-child/operator projections; reject additional subjects until the multi-subject issue is implemented.

Test targeted topicA rejection leaves topicB unchanged; timing/fit/housekeeping unchanged weights; saved but unavailable retains notices; three distinct weak signals versus one repeated series; explicit instruction precedence, caps/ceilings/tie ordering; immutable historical attribution after source edit; exact Undo/unsave/reset/learning-off; mixed reasons and cross-scope separation; races/restarts/migration. Compare replay against explicit-settings baseline. Full tests/build and parent usefulness evaluation are separate gates; tests/model agreement do not prove useful recommendations. Optional model interpretation belongs to the extraction/evaluation issue; private notes/profile/history are not model inputs.
