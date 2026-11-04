# 2026-11-04 Staging acceptance continuation

Branch `codex/budget-collaboration-redesign`, starting at `ceeb802`. The user authorized completing Staging preparation and genuine acceptance for manual testing, stopping before Production deployment. This supersedes the earlier plan's pending Hosted authorization; no repeated phase approval is required. Production, main, Vercel, Docker and WSL remain outside scope.

## Current outcome

Acceptance is incomplete. [Current matrix and sanitized HTTP evidence](qa/2026-11-04-budget-staging-acceptance-results.json): 7 Passed /27 Blocked; the run itself **failed during fixture setup**, outside the original per-case recorder. Zero Failed matrix rows does not mean a successful run. Staging is safely Paused: ledger66 / Head20261103113253, seven enabled fields and fullUndo OFF, existing latches/readiness retained. Three verified ordinary QA sessions logged out with HTTP204; independent readback found QA sessions0, active leases0, pending receipts0, unfinished cleanup0 and planned trips0. No QA business graph, browser, Vite or Worker was started in the first attempt.

The previous RAM credential helper exited on failure and cleared its admin-key reference. A new masked connection is needed before the next real Auth/HTTP attempt. Only the existing public key is saved in ignored Vite configuration; management credentials are not saved in files, arguments, browser state or environment variables.

Final independent Pause summary at2026-11-04T02:13:13Z again confirms ledger66, enabled protocols0/fullUndo false, QA sessions/active leases/pending receipts/unfinished cleanup0, metadata1/objects2. Native audit at02:13:59Z confirms owned QA Node processes0 and5189/5190 listeners0; the temporary query-transfer tab/server are closed. Z01 remains Blocked for the future complete acceptance run, rather than treating this safely stopped attempt as full service certification.

## Genuine first attempt and repairs

- Existing two exact QA identities were verified with admin GET. Three distinct sessions (A/B/A) completed generate-link/verify/user requests, all HTTP200. No email was sent, no account/provider/password was changed, and no admin business DML was used.
- The first trip POST returned HTTP403/42501. The QA transport requested `return=representation` before owner membership existed, unlike the product's two-step create flow. The server rejected it and independent readback proved neither planned trip exists. The tool now uses minimal return for trip and initial owner-membership inserts, then separately reads normal canonical state. This correction has local transport coverage but has not yet passed Hosted provisioning.
- Fixture counts now distinguish confirmed creation from an attempted request; the raw first attempt's `createdTrips` entry was recorded before POST and must not be treated as a committed trip.
- Provisioning failures originally occurred outside per-case reporting. The tool now records verified Auth before provisioning and adds a sanitized execution-stopped failure; the first raw report's empty failures list is not evidence of success.
- The first protocol-control SQL was rejected by PL/pgSQL ambiguous `v` resolution. Its transaction rolled back, proven by an identical fresh capture. `#variable_conflict use_column` fixes only the QA wrapper. Corrected enable and Pause each committed successfully; no installed Migration/function/RLS/ACL was changed.

## Exact explanation of the protection-digest difference

The original OFF protection digest was `90d9679d3388093db6c7457518c02f75e7cc526882fed5df530db780e331969f`; after the first enable/Pause cycle it was `929ec80e18c8f239740a708397b6d1d359f46cce39c65963581465a90e9c72b5`.

The existing immutable `signal_budget_metadata_protocol()` increments each existing group-backed trip's `budget_collaboration_signals.revision` whenever an enabled field changes. Five enabled transitions plus five Pause transitions therefore advance those existing notification counters by exactly ten. These are synchronization notifications, separate from financial data.

A real `BEGIN READ ONLY` diagnostic projected **only** those known counters minus ten, without any UPDATE. The complete protected aggregate then exactly equaled the original `90d967…1969f`. This proves the difference is fully accounted for; the live counters were never reset, no original snapshot was replaced, and no missing historical fingerprint was invented. All six preexisting financial projections (Budget, Actual, participants, links, Baseline) also match the earlier inventory, as do receipt metadata and object catalog hashes.

Future captures additionally retain all83 per-relation protection hashes, every original signal row and the exact original group-backed target IDs. After verification checks every other relation unchanged and permits exactly +10 on those target revisions, preserving all other signal rows/fields. Missing relation evidence, row loss, financial drift, unexpected revisions or changed targets fail closed. The original aggregate remains captured; no whole signal table or old financial graph is exempted.

## Managed Storage drift identified before any QA writes

The first fresh capture contains83 relations/673 rows, versus the previous81/668. Supabase Storage migrations75–79 and the two new empty managed lifecycle tables account for this. A read-only projection excluding only those two new tables and Storage migration IDs75–79 reproduced the committed prior complete81-table digest `6ffe02fae3bf9d34abcdab98ed6c27360702f6bf0954132aeba5e96eeed6c7ec` exactly. This was investigated rather than accepted as unexplained application drift.

The managed table definitions are consistent with [Storage migration76](https://raw.githubusercontent.com/supabase/storage/master/migrations/tenant/0076-noncurrent-lifecycle.sql) and [Storage migration79](https://raw.githubusercontent.com/supabase/storage/master/migrations/tenant/0079-lifecycle-writer-coordination.sql). No platform schema was edited or migrations replayed.

## Remaining execution and handoff

1. Reconnect the same masked Staging helper. Re-capture OFF if the15-minute preflight has expired; do not activate while the helper is absent.
2. Validate exact scope and seals; enable only metadata/finance/payment/source/lifecycle, then independently capture fresh active state. Receipt/fullUndo/Undo stay OFF; no Worker or signing secret is needed.
3. Execute genuine HTTP, three-context UI/Realtime and scoped Storage checks. Stop on failure, release owned leases, sign out sessions and Pause before diagnosis. Never retry unknown fixture/payment commits blindly.
4. Use the exact known receipt path, matched to its independent catalog hash. D02 additionally requires ordinary membership visibility; nonmember refusal cannot certify removal. D03 remains an explicit historical-evidence gap when no genuine pre-removal signed URL survives; do not mint a replacement or manufacture expiry.
5. Independently verify Pause, original per-relation data, expected notification increments, latches, functions/RLS/ACL, sessions and queues. Retain owned financial histories for audit and remove only the new ordinary accommodation attachment/object through normal APIs.
6. Prepare the manual-test frontend and document its exact Staging target/state. User manual testing may need the five non-receipt/non-Undo protocols left ON after the verified automated closeout; this is a separate deliberate handoff state, not a claim that seven are OFF. No arbitrary45-minute exclusive window is a product requirement of a test database; the automated runner's bounded deadline limits unattended work.

Local safety/transport/projection tests17/17 and syntax/diff checks pass. These do not certify unexecuted Hosted business/UI/Storage checks. Existing unchanged frontend/build/SQL results remain dated evidence, not new runs. Production activation/deployment remains NO-GO pending real acceptance and Review.
