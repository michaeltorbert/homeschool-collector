# Remaining work

## Low-priority recovery and accessibility

- Recover a committed decision after a lost response or failed snapshot refresh without overwriting a newer choice. Keep the immutable idempotency receipt, show the saved decision, and preserve a replacement draft until deliberately submitted/discarded.
- Prevent an older in-flight snapshot from briefly replacing a newer decision projection. Verify delayed responses cannot reverse displayed state or counts.
- Explain when a stale reconsideration review records only older shown facts and leaves the current reconsideration pending.
- Describe source-specific attendance changes accurately when only a nonselected feed changes.
- Preserve the original SQLite error if rollback discovers the transaction already rolled back; keep initialization fail-closed and release locks.
- Avoid taking focus from a live search field when a decision completes after manual dialog close. Keep newly mounted background notices inert while a dialog is open. Verify mouse and keyboard trigger restoration in native browsers that do not focus clicked buttons.

These are retained nonblocking follow-ups from independent code review. Exact decision writes, source acknowledgments and history remain separate and fail closed.

## Planned phases

1. Provider age rules, audience hints and optional private profile precision, preserving uncertainty and source conflicts.
2. Bounded deterministic interest learning, explicit explanations, undo/reset controls and parent usefulness evaluation.
3. Broader concern and recurring-window controls; optional public-text semantic extraction only after choosing its service and data boundary.
4. Verify source coverage, a permitted complete class/camp source, calendar export, and additional providers.
5. Implement and test a Worker/D1 adapter, protected hosted access and scheduling before deployment. The current development server stays loopback-only.
