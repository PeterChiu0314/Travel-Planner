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

## Validation

25 distinct Node/SQL tests passed across expensePeerAdmission, expenseLeaseTtl, expenseAutosaveFollowup, expenseReview and expensePayers (24 batch plus added concurrent cross-group case; final5/5 admission rerun).21 Chromium cases passed across formalExpensePeerAdmission, formalExpenseCollaboration, formalExpensePayers and formalExpensePayerRemoval. Covers reciprocal budget/payer readonly, independent notes, release/takeover/reload, delayed and simultaneous acquisition, same-account other-session exclusion, expiry,22s sustained renewal, exact unknown ACK replay and payer deletion autosave. Build/diff passed; existing Vite bundle-size warning remains.

Hosted Chrome/Edge two-account Preview/WebSocket validation pending initial Preview delivery. No DB migration, RPC/trigger changes, Production/main changes or GitHub issue comment/closure. Staging Ledger74 remains installed and immutable.
