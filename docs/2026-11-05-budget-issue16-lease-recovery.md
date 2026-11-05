# Issue16 — Budget group lease release/recovery

Issue: https://github.com/PeterChiu0314/Travel-Planner/issues/16 . Branch `codex/budget-collaboration-redesign`, starting after UI-only fix b859845. This functional P1 repair is separate from that appearance change.

## Confirmed client defects

Three new deterministic regressions failed against the original controller before correction:

1. Acquire is pending, blur starts release, then the server definitively refuses the first admission. The early abandoned-admission branch did not clear its never-granted token. Release then required an epoch which could never exist, leaving `releasing` stuck.
2. Concurrent release callers independently sent cleanup transports and could clear state belonging to an immediately refocused acquisition. A release had no shared work slot.
3. `retry()` refused every releasing state, while the rendered Retry button was also disabled by that same flag. After a failed release, the visible retry path could not repair it. Discard remained a different explicit action and is not a substitute for retrying a retained draft.

These are confirmed frontend failure paths, **not evidence that Hosted PostgreSQL granted two effective holders**. The original Staging manual incident's full server-side cause still needs the requested real three-session reproduction.

## Repair

- Serialize release callers through one `releaseWork`; keep new focus waiting for its confirmed outcome, and cancel that focus intent if a later blur occurs.
- Retire a definitely refused *first* admission even after blur. Preserve earlier unknown capabilities; keep PT409 conflict and the user's staged draft.
- Freeze exact session/token/epoch release arguments before awaiting Auth or transport. Late acquisition cleanup uses its original token and returned epoch, cannot overwrite a different current capability, and retains its epoch if cleanup fails so explicit retry remains possible.
- Explicit Retry first completes failed cleanup, then reacquires/saves only through existing checks. Disable Retry while release work is actually in flight, rather than forever while release is uncertain; notify the view when that work settles.
- A confirmed grant immediately replaces a stale peer ownership hint using the actual receipt. Snapshot-only ownership still cannot manufacture authority.

No installed Migration, RPC, RLS, permission or TTL change; no removal of DB exclusion. No automatic stale-base rewrite, draft loss, Undo or Receipt reactivation. The previous normal/peer-only field styling remains intact.

## Validation

- Node:14 cases passed across the new7 release-race cases, existing3 admission-recovery cases and4 snapshot/admission-order cases. Initial3 release-race cases were observed failing before the fix.
- Playwright controller suites:68 passed (metadata, choices, pricing).
- Rendered Chromium suites:67 passed (new3 Issue16 cases, appearance, full metadata, choices and pricing). Final6 directly affected UI cases were rerun after the receipt-hint correction and passed; this is repeat coverage, not6 additional cases. Includes two-user peer denial, immediate refocus, enabled Retry recovery, different groups, same-account tabs, late snapshots, offline, discarded conflicts and original-request replay.
- Isolated PostgreSQL/WASM contract:23 passed. This is PGlite serial SQL, not true parallel Hosted/HTTP certification. It verifies one holder, exact token/epoch release, expiry/takeover, idempotency, RLS and financial preservation against the disposable metadata prototype. No Hosted migration was replayed.
- Build and diff check passed; existing large-bundle advisory retained. Browser plugin skill unavailable; used repository Playwright workflow with mock Supabase and asserted no unexpected Hosted requests. Desktop1440x1000 screenshot inspected; mobile not revalidated.

## Genuine Staging status — incomplete

User reconnected the masked helper; it verified the same two QA identities by admin GET only. Fresh independent READ ONLY at **2026-11-05T02:41:19.328773Z** captured ledger66, installed source/functions/ACL/schema/protocol state and QA fingerprints before any proposed write. It reported QA sessions0 but2 active editing leases. The standard Preflight correctly refused execution; **no Issue16 Auth sessions were minted and no Issue16 business RPC or financial write was dispatched**.

READ ONLY at02:43:01Z identified those leases as the Budget/linked Actual **pricing** group of another manual-test trip, expiring02:47:48Z. They were unrelated to the sealed QA target. They were neither cleared nor taken over; expiry was not changed. Their later state is not claimed.

The next browser observation was automatically rejected because the approval service reported a usage-limit failure. This was not a user rejection or a finding that the SQL was unsafe. The tool explicitly forbade obtaining the same observation by alternate browser surfaces/raw commands, so no workaround was used. Genuine three-session HTTP/SQL observation remains **Blocked**, not Passed. The user-requested five Staging protocols stay ON; Undo/Receipt OFF, no auto-Pause or Worker. No Production/main/Vercel configuration operation in this repair run.

The RAM helper received stop and reported `stopped / credentialsSaved:false`; no test session existed to sign out and no QA lease existed to release. The temporary SQL transfer server was stopped. The local automated test server is stopped after validation; the existing manual5174 frontend remains separate. The unexecuted Hosted harness candidate was quarantined in ignored scratch and its dispatch hook removed; it is not shipped as verified tooling.

Next: after approval/browser service access is restored, reconnect RAM credentials, acquire a fresh truthful Preflight without interfering with manual leases, then run A/B/A true-session same-group focus and independent DB owner/session/token-hash/epoch observation plus release/refresh/late-ACK regressions. Re-capture original rows, financial/history/Origin/Baseline fingerprints and zero owned sessions/leases after cleanup. Keep Issue16 open until that evidence exists; do not substitute mock or PGlite results for Hosted acceptance.
