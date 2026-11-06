# Issue21 Review: dependent field authority and renewal snapshot duplication

Review: https://github.com/PeterChiu0314/Travel-Planner/issues/21#issuecomment-6686733957

## Implementation

The existing budget/paid/payer/payment groups remain separate. Expense editor admission, editable state and existing field owner visuals now recognize another actor/session's valid lease on any of those groups on the same item. Payment action uses the same peer exclusion. Same-session leases, different items and note/category/links remain independent. Snapshot lease expiry is compared using snapshot server time offset; collaboration hints retain their existing expiry handling. Server admission/mutation checks remain authoritative and unchanged.

Pending acquisition no longer grants editable state or accepts controller input. Mode/add/remove actions still await their existing acquire operation, preserving first-click operation from outside the sidebar. Stale snapshots cannot grant authority. Expiry, delayed ACK cleanup, unknown request identity and autosave guards remain intact.

## Measured performance and bounded optimization

Two real local Chromium pages, different actors, existing SQL/PGlite fixture. A held budget, B held note, neither changed input. Actual elapsed22s; actual expense_signals revision delta queried from SQL. Counts are scoped after initial load/focus stabilization, not Hosted measurements.

| Version | Renew RPCs | SQL signal increments | Full financial snapshot reads | Collaboration reads |
| --- | ---: | ---: | ---: | ---: |
| Before (6c48eca) | 8 | 10 | 25 | 20 |
| After | 8 | 10 | 18 | 18 |

A recent validated authoritative snapshot now satisfies the redundant timer fallback read. This reduced measured full reads by7/25 (28%) without changing clean20s/dirty60s, renewal timing or Realtime invalidation. Every5s recovery still processes pending create/write/release work; only its duplicate snapshot call is skipped if a valid snapshot arrived within5s. Failed/cached reads do not advance this timestamp, and no-signal fallback still reads. This is a bounded duplicate-read fix, not elimination of pure-renewal signal traffic: renewal/selection continue emitting signals and financial refreshes. More aggressive signal splitting would require a separately reviewed DB protocol change; none is introduced here.

Reproduce with local Vite/static maps, PGLITE_MODULE and PLAYWRIGHT_BROWSERS_PATH configured:

`node scripts/qa/measure-expense-renewal.mjs current`

Optional PLAYWRIGHT_BASE_URL and EXPENSE_QA_OUTPUT control URL and JSON artifact location. Script creates only isolated SQL fixture data, never Hosted records.

## Hosted discovery and deadline correction

On Preview3548265, Chrome (TNT Chiu) and Edge (Peter Chiu) used their existing ordinary authenticated sessions against uyqdopksfysbobhjcepk. Product WebSocket phx_reply subscriptions included expense_signals and system postgres_changes status was ok on both; actual expense_signals frames arrived. Reciprocal budget/payer peer readonly, independent note save/convergence and release/takeover were observed on a dedicated temporary QA item.

A40s Hosted observation with Chrome holding payer recorded39 clean renew requests,42 full snapshot reads and48 distinct signal revisions; Edge observer recorded41 full reads. This is a separate scenario from the local two-holder22s benchmark. Matching request wallTime to snapshot serverNow showed server clock about6004ms behind the client. Raw server expires_at compared directly to client Date.now made a20s clean lease appear below the15s early-renew threshold, causing1s ticks to renew continuously.

Lease responses now translate the server deadline through the existing snapshot clock offset and cap the local deadline at request-start plus the unchanged clean20s/dirty60s TTL. The cap prevents response latency/offset approximation from extending capability lifetime. Renewal intervals remain measured on the client clock. No server TTL/protocol change; added a6s skew regression. Final Preview41496b5 observation: Chrome held payer continuously for35s, with6 renews/13 full snapshots/13 collaboration reads; Edge observer had0 renews/14 snapshots/13 collaboration reads.15 distinct signal revisions arrived on each; capture was not truncated. Payer stayed editable and peer pricing stayed locked beyond the20s clean TTL. This returns renewal to approximately5s cadence despite the measured clock skew. Durations and external selection traffic differ, so the40s/35s numbers are not a controlled percentage comparison.

## Validation

61/61 Node/SQL tests passed across expensePeerAdmission, expenseLeaseTtl, expenseAutosaveFollowup, expenseReview, expensePayers, expenseRpc, expenseCreation, expenseCollaboration and expenseRates.21 Chromium cases passed across formalExpensePeerAdmission, formalExpenseCollaboration, formalExpensePayers and formalExpensePayerRemoval. Covers reciprocal budget/payer readonly, independent notes, release/takeover/reload, delayed and simultaneous acquisition, same-account other-session exclusion, expiry,22s sustained renewal, exact unknown ACK replay and payer deletion autosave. Build/diff passed; existing Vite bundle-size warning remains.

Hosted final acceptance on exact code41496b5: both ordinary authenticated accounts on the original-branch Preview used Staging only. Product postgres_changes subscription ready and actual expense_signals frames observed on both browsers. Budget→payer and payer→budget readonly/disabled visuals verified; note remained independently editable and saved to the other browser. After payer blur/release, peer acquired budget, changed1000→1200, and both budget/payer totals converged to1200. Reloaded both browsers: amount, payer amount and note matched, no leave guard or framework overlay. Final console warning/error counts0/0. Created only dedicated Issue21 Review QA 20261106 through the normal UI; deleted it through normal lifecycle flow after verification. Both browsers returned to the original5 visible items and19,376 total; no existing item was edited. This is UI-level verification, not a full database seal.

Remaining coverage limits: Hosted forced network-latency/simultaneous races/expired takeover were not artificially injected in user browsers; these passed the isolated controller/SQL/Chromium regressions. Raw Realtime event/header/body data and credentials were not saved; only aggregate counts were retained. No DB migration, RPC/trigger changes, Production/main changes or GitHub issue comment/closure. Staging Ledger74 remains installed and immutable.
