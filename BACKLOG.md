# Remaining work — issue index

The central handoff is [docs/ROADMAP.md](docs/ROADMAP.md). Read each live issue and its comments for current status. Specifications distinguish planned behavior from the current local preview.

## Nonblocking cleanup

- [#3](https://github.com/michaeltorbert/homeschool-collector/issues/3) — F9 uncertain delivery/refresh recovery, N2 snapshot ordering, N3 stale reconsideration wording, N4 original SQLite error.
- [#4](https://github.com/michaeltorbert/homeschool-collector/issues/4) — N4 per-source wording and O1–O3 delayed focus, newly mounted inert background, native opening-trigger restoration.

Eight checks are preserved with concrete acceptance in [reliability/accessibility](docs/plans/reliability-and-accessibility.md). N1/F4b were resolved; do not refile historical OPEN text.

## Planned features and gates

- [#1](https://github.com/michaeltorbert/homeschool-collector/issues/1) — Muse-assisted private intake and permitted unattended delivery.
- [#2](https://github.com/michaeltorbert/homeschool-collector/issues/2) — age/evidence/profile precision and reversible fit feedback. Local implementation is part of the combined local candidate on `feature/reviewed-preview-integration` ([delivered implementation](docs/plans/age-suitability.md#delivered-implementation)). AGE-010 measured zero real Town age wording; full browser acceptance is unverified.
- [#5](https://github.com/michaeltorbert/homeschool-collector/issues/5) — Bounded reversible interest learning. Local implementation is part of the combined local candidate ([delivered implementation](docs/plans/interest-learning.md#delivered-implementation)). Current browser acceptance and parent usefulness (#10) are unverified.
- [#6](https://github.com/michaeltorbert/homeschool-collector/issues/6) — Broad concerns/recurring windows.
- [#7](https://github.com/michaeltorbert/homeschool-collector/issues/7) — Town coverage and complete class/camp route. A bounded local calendar-evidence candidate is part of the combined local candidate ([candidate and gates](docs/plans/source-and-hosting.md#bounded-calendar-evidence-candidate)). The complete catalog route and its semantics (C03) and the catalog/Wake adapters (C05) remain unmet, and publisher scope is unverified; the issue stays open.
- [#8](https://github.com/michaeltorbert/homeschool-collector/issues/8) — Optional calendar file.
- [#9](https://github.com/michaeltorbert/homeschool-collector/issues/9) — Protected Worker/D1/scheduling.
- [#10](https://github.com/michaeltorbert/homeschool-collector/issues/10) — Usefulness/public-text extraction choice.
- [#11](https://github.com/michaeltorbert/homeschool-collector/issues/11) — Multiple children/operators.
- [#12](https://github.com/michaeltorbert/homeschool-collector/issues/12) — Wholly unavailable Claude validator handling.

Private family data and raw review packets remain outside Git. Full catalog, hosted scheduling, exports, external extraction and multi-subject operation remain unverified until the applicable issue acceptance is actually met. The workflow-tooling issue is tracking only; global policy repair requires separate authorization.
