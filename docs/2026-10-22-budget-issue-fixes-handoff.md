# Budget issues #1–#4 — local implementation, 2026-10-22

## Scope and state

User requested reading the repository issues and improving the implementation. All four open issues and their comment threads were inspected; none had comments. This work follows integration commit `4086db8` on `codex/budget-workspaces-integration`. Changes are local and uncommitted. Desktop remains the acceptance priority.

| Issue | Implemented behavior |
| --- | --- |
| [#1 Cancel paid status](https://github.com/PeterChiu0314/Travel-Planner/issues/1) | Every cancellation with recorded payments requires confirmation, even one record without receipts. The message includes count, title, TWD, origin and loss/recreation warning. Dismissal does not write. Receipt-bearing cancellations are rejected as a whole. |
| [#2 Legacy foreign budgets](https://github.com/PeterChiu0314/Travel-Planner/issues/2) | A departed foreign budget can edit metadata without trip-wide rates, retaining exact original currency, amount, FX, stored TWD and participant shares. Monetary controls are disabled. New/planning budgets still use shared trip quotes. |
| [#3 Known TWD debit](https://github.com/PeterChiu0314/Travel-Planner/issues/3) | Actual keeps the foreign total while accepting a known integer TWD debit. Allocation and settlement use that debit. Estimated and unknown legacy amounts are labelled separately; legacy TWD is retained. Actual subcategory input is hidden without dropping stored values. |
| [#4 Atomic save](https://github.com/PeterChiu0314/Travel-Planner/issues/4) | Budget, participant rows, itinerary links and paid/unpaid changes commit in one RPC. Snapshot/version/lock conflicts reject the transaction. Repeated identical requests return their recorded result and do not duplicate payments. |

## Persistence and compatibility

- New migration: `supabase/migrations/20261022110000_budget_payment_safety_and_actual_cost.sql`. Previously applied `20261022090000` and `20261022100000` files were not changed.
- The new invoker RPC `save_budget_workspace_record_v2` runs the existing pricing save and payment change in the same PostgreSQL transaction. It uses trip advisory serialization, existing RLS, optimistic versions, other-user edit-lock checks and exact payment IDs/timestamps. Its private idempotency ledger is not directly readable/writable by authenticated clients.
- `actual_expenses` adds `twd_amount_source`, `actual_twd_amount` and `payment_origin`. Existing TWD is backfilled as `legacy`, without recalculation. A trigger protects known/legacy TWD from older clients recomputing it from FX. Missing reference FX remains null; an actual debit does not require a made-up reference rate.
- Historical foreign metadata edits take a path that does not recalculate original amounts, TWD or participant shares. Missing historical participant joins retain their legacy approved-member display fallback. Existing frozen baselines and actual records are not repriced by shared quotes.
- Demo uses a pure in-memory transition and commits state once after validation; it does not call Supabase, Auth, Realtime, Storage or draft persistence. The Formal test harness lives under `tests/harness/` and uses an isolated fake adapter, not a live backend.
- Formal persistence is centralized in `src/lib/budgetWorkspaceService.js`; no sequential payment writes or unsafe fallback follow a failed v2 call. Missing migration/RPC returns a clear failure and retains the draft. A committed save with a failed reload is reported as saved, avoiding duplicate retry writes.
- Receipt handling is deliberately atomic at the database boundary: a Budget cancellation with receipts is blocked before any changes. The user must handle those attachments in Actual details first. No attempt is made to make Storage object deletion part of a PostgreSQL transaction.
- Shared `MenuSelect` now accepts an optional native disabled state, needed for historical monetary controls. Existing callers retain their enabled default.

## Verification

- Full Playwright: **404/404 passed**, 56.6 seconds. Includes all prior 395 tests and 9 new unit/controller/browser cases.
- Final focused UI check: Budget safety + Budget page suite **33/33 passed**, 31.0 seconds. Screenshots of the known-debit editor, saved detail and Settlement were inspected; compact source labels fit the table without changing its layout.
- Isolated PGlite/PostgreSQL suites execute every migration with fake Auth/Storage schemas and authenticated/anon roles. Both `tests/budget-database.mjs` and `tests/budget-safety-database.mjs` passed. No hosted credentials are needed.
- SQL scenarios cover known JPY/TWD and custom shares, missing reference FX, old-client preservation, planning quote authority, missing historical rates/joins, no invented baseline, payment snapshot conflicts, receipts, other-user locks, viewer/outsider/anon denial and private-ledger access denial.
- Fault injection rejects an actual insert after the Budget path starts and a second ordered payment deletion after the first deletion. Tests verify parent/child/baseline/receipt state remains intact; retry produces one payment and the successful clear removes all intended payments together.
- Production build passed with the existing large-chunk advisory. `git diff --check` passed. Browser checks use the local dev server, not hosted Preview or Production. SQL isolation does not prove real multi-session hosted concurrency, Storage behavior or Realtime delivery.

Reproduction (PGlite is an external test dependency, not a new application package):

```powershell
$env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:5174'
npm.cmd run test:e2e
npm.cmd run build
$env:PGLITE_MODULE = '<absolute path to @electric-sql/pglite/dist/index.js>'
node tests/budget-database.mjs
node tests/budget-safety-database.mjs
git diff --check
```

Local QA PNGs are outside the repository in `C:\Users\PeterChiu\.codex\visualizations\2026\10\18\01a14c95-d406-7d33-b655-0a2c9de1460d\`: `actual-debit-editor.png`, `actual-debit-detail.png`, `actual-debit-settlement.png`. Preview: `http://127.0.0.1:5174/demo/budget`.

## Rollout boundary

No commit, push, main merge, deployment, hosted migration, GitHub issue comment or closure was performed. Keep the four issues open pending rollout verification.

For a later authorized rollout, apply **only the new migration** to the intended Supabase environment before deploying the matching frontend; verify RPC grants/RLS, existing amounts and snapshots, repeated request behavior, and authenticated save/cancel flows. Do not replay the two earlier applied migrations. Preserve old actual TWD; do not backfill guessed exchange rates or rebuild missing departure snapshots.
