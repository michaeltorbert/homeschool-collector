# Local reliability and accessibility follow-ups

Proposed changes; baseline server writes/history are idempotent and fail closed. These eight nonblocking checks are still open, grouped into two issues. Earlier N1/F4b (disable Change reasons during an open draft and restore focus to list/active-tab when a row disappears) were resolved before the first source commit and must not be recreated as bugs.

## Decision recovery and state accuracy

1. F9: a committed decision with lost response or failed refresh needs a recovery action using its immutable receipt. Show the saved choice and preserve any replacement draft until explicit replace/discard. Never mutate a reused command key or overwrite a newer choice. Test commit/lost response/edit/retry and commit/failed snapshot independently; source acknowledgements unchanged.
2. N2: an old in-flight poll must not replace a newer decision projection/counts. Add monotonic request/revision acceptance. Delay old poll, finish decision+refresh, release old poll; display stays current while server stale-decision checks remain.
3. N3: a reconsideration review against older shown facts must say it recorded older facts and current reconsideration is still pending. Test exact pending evidence/notices and accurate status copy.
4. N4 transaction error: when SQLite auto-rolls back (for example storage failure), a later rollback exception must not mask the original failure. Test injected original/rollback errors, initialization close/lock release and no partial data.

## Source wording and modal accessibility

5. N4 wording: nonselected-feed changes must say source attendance facts changed and show the exact part/field, not falsely imply the displayed representation changed.
6. O1: after manually closing an in-flight action, its completion must not steal focus from live Search/another control. Test delayed completion while typing and the ordinary/disconnected-trigger fallback.
7. O2: newly mounted notices/status nodes must remain inert while the dialog is open. Test new nodes with keyboard/pointer accessibility and restore access on close.
8. O3: explicitly retain the opening control in browsers that do not focus clicked buttons; test native mouse+keyboard normal/disconnected triggers. Engine emulation alone is not native-device or assistive-technology proof.

Both issues preserve append-only history, exact receipts/source reviews, required reason semantics, drafts, bookmark/Hide independence, critical notices and no learning. Run relevant tests and full build; synthetic browser exercises where meaningful. Do not invent tests that merely repeat implementation. Retain limitations where native proof is unavailable.
