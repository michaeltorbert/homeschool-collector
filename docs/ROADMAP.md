# Roadmap and fresh-conversation handoff

Updated October 6, 2026. This is the public planning entry point. Read current repository instructions, this index, the linked specification, and the live issue body **and all comments** before taking an issue. Current source/checks determine implementation status. A planned contract, checkbox, fixture count or review verdict does not prove implementation, source completeness, hosting or usefulness.

## Delivered baseline

The local Town-events preview and reason-aware decision workflow are implemented on React/Vite/TypeScript, Node/SQLite and ical.js. It runs at http://127.0.0.1:4173 and preserves private state in ignored data/preview.sqlite. The public code/dated calendar fixtures are separate from private profiles/settings/decisions/notes. Do not expose the development server or run two instances on the database.

Baseline application source commit `1d63a1f0ee4ee54e4a8bb55d1c37d353dfb676a2` passed 42 tests and TypeScript/Vite build in the October 6 coordinator run. Recheck current status/checks in a new task; this is historical baseline evidence. Only narrow public Town calendars are connected; dated 21 identities/27 memberships/four closures do not prove catalog coverage. Current ranking is explained word matching; reason decisions record intent and do not learn yet. Age remains unknown/gated. Local IDs are not authentication. No Worker/D1 deployment, hosted scheduler, complete class/camp catalog, Muse delivery, calendar export or multi-subject projection is operational.

Independent bookmark/Hide/source review, append-only/idempotent passes and exact Undo, timing reconsideration, conflicts/uncertainty and creation-time critical notices are delivered invariants. [README](../README.md) explains operation and actual proof; [planning notes](PLANNING-NOTES.md) distinguish current, superseded and partial review records.

## Issue inventory and specifications

| Issue | Scope | Status / gate | Specification |
|---|---|---|---|
| [#1](https://github.com/michaeltorbert/homeschool-collector/issues/1) | Muse group observation/private intake | Planned; permitted access and actual unattended delivery unverified | Issue acceptance + [source/hosting](plans/source-and-hosting.md) |
| [#2](https://github.com/michaeltorbert/homeschool-collector/issues/2) | Optional private ages and suitability | Next feature; final Opus recheck unavailable, not consensus | [Age v2](plans/age-suitability.md) |
| [#3](https://github.com/michaeltorbert/homeschool-collector/issues/3) | Decision recovery/current state | Open nonblocking cleanup | [Specification](plans/reliability-and-accessibility.md) |
| [#4](https://github.com/michaeltorbert/homeschool-collector/issues/4) | Source wording/modal accessibility | Open nonblocking cleanup | [Specification](plans/reliability-and-accessibility.md) |
| [#5](https://github.com/michaeltorbert/homeschool-collector/issues/5) | Bounded reversible interest learning | Planned; usefulness unvalidated | [Specification](plans/interest-learning.md) |
| [#6](https://github.com/michaeltorbert/homeschool-collector/issues/6) | Broad concerns/recurring windows | Planned; unsupported occurrences stay unknown | [Specification](plans/constraints-and-recurrence.md) |
| [#7](https://github.com/michaeltorbert/homeschool-collector/issues/7) | Town coverage and complete class/camp route | Open dependency; permitted complete route unproved | [Specification](plans/source-and-hosting.md) |
| [#8](https://github.com/michaeltorbert/homeschool-collector/issues/8) | Optional calendar file | Planned; import/sync/native proof separate | [Specification](plans/source-and-hosting.md) |
| [#9](https://github.com/michaeltorbert/homeschool-collector/issues/9) | Protected Worker/D1/scheduling | Planned; deployment separately authorized | [Specification](plans/source-and-hosting.md) |
| [#10](https://github.com/michaeltorbert/homeschool-collector/issues/10) | Usefulness/public-text extraction choice | Planned; service/data decision before external model | [Specification](plans/pilot-and-extraction.md) |
| [#11](https://github.com/michaeltorbert/homeschool-collector/issues/11) | Multiple children/operators | Deferred; one-subject guard remains | [Specification](plans/multi-subject.md) |
| [#12](https://github.com/michaeltorbert/homeschool-collector/issues/12) | Wholly unavailable Claude validator handling | Reproduced external tooling; tracking only | Issue; separate authorized workflow-policy task |

Every current open cleanup/product/source/hosting finding has a linked issue or is an acceptance check of an existing issue. Do not recreate resolved N1/F4b or file superseded proposals as open work. The external tooling issue is outside app implementation; its existence does not authorize changing global policy.

## Practical order and dependencies

1. Start with [#2](https://github.com/michaeltorbert/homeschool-collector/issues/2) age/evidence contracts, synthetic tests, private migration, then fit/display/reconsideration/notices/UI. All three slices are required for closure. Cleanup [#3](https://github.com/michaeltorbert/homeschool-collector/issues/3) and [#4](https://github.com/michaeltorbert/homeschool-collector/issues/4) can proceed independently.
2. Then [#5](https://github.com/michaeltorbert/homeschool-collector/issues/5) bounded learning; keep explicit settings, provider rules, fit and constraints separate. Implement [#6](https://github.com/michaeltorbert/homeschool-collector/issues/6) broad concerns/recurrence only after its source and intent contracts are defined. Raw recurrence capture is not occurrence expansion proof.
3. Research [#7](https://github.com/michaeltorbert/homeschool-collector/issues/7) complete catalog access independently; missing coverage remains visible and cannot be repaired by ranking. Wake source expansion follows the full catalog milestone unless the user changes the order.
4. [#1](https://github.com/michaeltorbert/homeschool-collector/issues/1) Muse can bootstrap a local test receiver independently; operational private delivery still needs permitted account/group capabilities and protected receiver/runtime proof ([#9](https://github.com/michaeltorbert/homeschool-collector/issues/9) where hosted). [#8](https://github.com/michaeltorbert/homeschool-collector/issues/8) export is optional and restricted to supported calendar semantics.
5. [#9](https://github.com/michaeltorbert/homeschool-collector/issues/9) hosting requires approved identities, all-route protection, actual allowed target-runtime access and scheduler/storage/failure proof. A local success is not hosted proof. [#11](https://github.com/michaeltorbert/homeschool-collector/issues/11) authenticated multi-operator operation depends on this; local multi-subject projections must exist before lifting single-subject guards.
6. [#10](https://github.com/michaeltorbert/homeschool-collector/issues/10) pilot evaluation informs usefulness, future thresholds/recency/fit/exploration and optional semantic services. No external service is required for the current code or initial deterministic learner. [#12](https://github.com/michaeltorbert/homeschool-collector/issues/12) workflow tooling is a separate maintenance task and does not block source-backed app work with honest incomplete-review reporting.

These are planning dependencies, not authorization for deployments, accounts, purchases or messages. Resolve genuine product decisions from the relevant issue rather than guessing private family data.

## How a fresh conversation starts

Use one conversation per issue. Verify origin matches this repository, inspect current branch/status/worktrees and applicable AGENTS.md, then read README, this roadmap, linked specs and all live issue comments. Identify in-scope files, current facts, invariants and acceptance checks before editing; preserve another task's changes and private database. Run checks appropriate to the change and record exact artifact/actor/proof limits. Maintain issue/spec links and finding dispositions as work completes.

The public specs contain the operative accepted contracts and remaining gates; the long original conversation and outside-Git raw model evidence are not required for routine issue implementation. Private settings are supplied locally when actually needed, never copied into public starter preferences or fixtures. Revalidate stale facts. Update this index, issue and relevant spec when scope/status materially changes. Current live issues/comments resolve status changes after this snapshot.
