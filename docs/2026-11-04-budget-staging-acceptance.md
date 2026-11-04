# 2026-11-04 Staging acceptance continuation

Branch `codex/budget-collaboration-redesign`, starting at `ceeb802`. The user authorized completing Staging preparation and genuine acceptance for manual testing, stopping before Production deployment. This supersedes the earlier plan's pending Hosted authorization; no repeated phase approval is required. Production, main, Vercel, Docker and WSL remain outside scope.

## Latest outcome — portable home handoff

The first-attempt account below is historical. The latest [matrix](qa/2026-11-04-budget-staging-acceptance-results.json) supersedes its counts: **22 Passed /1 Failed /11 Blocked**, including two independent closeout checks. Twenty business/catalog/Auth/UI checks passed; D05 and Z01 separately passed original-data protection and safe cleanup. This is incomplete acceptance, **manualTestReady=false / Production activation NO-GO**.

Real ordinary-JWT checks passed initial Auth, account isolation, no custom Undo entry points, native text/numeric input Undo and outside-input saved-graph preservation, pricing/custom splits, title/note autosave, paid→unpaid→paid reuse of the same Actual, and a second current Actual rejected23505 with the graph unchanged. Source first-link/detach retained Origin/cost. Different groups proceeded concurrently; same-group peer/same-user second-session denial, lease renew/release, stale409/PT409 atomic refusal and revoked-member snapshot200/null passed. Empty payment-history prefixes were preserved; nonempty historical events were not demonstrated.

B04 used a real external JPY quote0.20699, dated2026-11-04T00:02:31Z, via the normal Rates lease/RPC. This is not a new changed-quote repricing claim; prior dated changed-quote evidence remains separate. Both new QA trips' Rates/Baseline fingerprints were captured before browser entry. The untouched private QA trip's two fingerprints exactly match initial capture; original Baseline rows remain protected. B07 freeze/transition is still unexecuted; no historical Baseline was restored or rewritten by the tool.

C05 failed because the standalone Node subscriber timed out waiting for postgres_changes. The actual peer browser displayed the new title, but polling could also explain convergence. Root cause is unconfirmed. Candidate tooling now observes actual product-page WebSocket postgres_changes frames and requires the correct trip, actor, newer revision and rendered peer result. Parser/guard coverage passed locally; **this candidate has not been rerun Hosted** because the RAM helper expired. Never promote C05 to Passed based on UI convergence alone.

The11 Blocked rows are A03/B01/B07/C06/C07/C08/C09/D01/D02/D03/D04. D02's exact receipt path was independently hash-matched locally but HTTP removal checks are unexecuted. D03 has no preserved genuine pre-removal signed URL; do not fabricate one, mint a replacement or call a new URL historical. This evidence gap needs explicit Review disposition if no original URL exists.

Final independent READ ONLY **2026-11-04T07:33:37.884887Z**: ledger66/head20261103113253, original installed sources/complete function bodies/attributes/roles/ACLs preserved; all seven/fullUndo OFF, original latches/readiness retained; QA sessions, metadata/edit/Rates leases and receipt jobs0; original metadata1/objects2 unchanged.83 protected relation hashes and exact original signal rows verify, with exactly+10 notification revisions per five-enable/five-Pause cycle. Two owned QA trips, two budgets and two Actuals remain for audit and continuation. No original financial data, Source Origin, history, receipt bytes or Baseline was deleted.

Native audit **07:40:21Z**: owned QA/helper/Vite/query-server process matches0;5189/5190 listeners0. No Worker was started. Agent query/config tabs were closed; the browser policy refused access to one unmarked temporary error-page tab, which is left to automatic tab cleanup. User-owned SQL/API-key tabs remain. Admin credentials are cleared; no key is included in the portable handoff.

## Managed Realtime catalog changes, exactly explained

Managed publication rotation added messages_2026_11_06 and _11_07 to the reserved supabase_realtime_messages_publication. Excluding only those two rows in a READ ONLY projection reproduced the complete previous schema hash179354529fd4f0028b35f79736a928e83665684a994ef89034b68ff838f50760 exactly. Later the service retired the previously observed _2026_10_30 and _10_31 rows. A SELECT-only union of their actual previously captured full JSON reproduced the complete pre-cycle9 hash6ba782d774ee4916901c7effd6a32106d890eb10ebe09f2c222d0b8ece4c5600 exactly. No catalog rows or historical hashes were manufactured or restored in the database.

Final actual global schema hash is b1d4b576fe93de48823ebb9517672ab438589780b81a3152c6d43f615a885084. New captures additionally record actual managed publication rows and stable schema digest86ec97010faad59488accd09efc1849d2bec112085bdc6a0fb73e0b46f961879, excluding only that exact reserved managed publication. All four captured namespaces' relation/RLS/column/constraint/trigger/index definitions, other publications and independent complete function/attribute/role/ACL seals remain guarded. Installed Migration sources are unchanged. Older contracts still require exact complete-schema reconstruction; missing evidence fails closed.

## Tool repairs and local validation

Nine stopped attempts incrementally fixed QA provisioning/membership permissions, retaining a legitimate empty Baseline, canonical quote timestamps, making stale writes truly advance revision, Vite readiness output, selected-row toggle behavior and editable numeric input targeting. These are QA harness corrections, not new product design or proof of a product P0/P1. Each stopped cycle was Paused and independently checked before another deliberate command. Already Passed unaffected cases retain their real execution timestamps and original report hash; unknown writes are never blindly replayed.

Local QA safety/transport/projection/WebSocket parser tests **25/25** pass. Exact Vite readiness probe returned HTTP200 on the real root in approximately300ms, without Auth. Syntax/diff checks pass. No frontend, installed SQL, function or ACL changed; previous unaffected build/full frontend/SQL results are reused as dated evidence. These local tests do not certify the remaining Hosted cases.

Continue with the [home runbook](2026-11-04-budget-staging-home-handoff.md) and tracked non-secret scope/graph/report/fingerprint manifest. Reconnect the masked helper and acquire fresh independent OFF/active captures. The old approval and lastOff observation are not current execution authority.

## Historical first attempt — superseded status

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
