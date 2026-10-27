# Budget issue #9 — Trip exchange-rate loading

Date: 2026-10-27 (Asia/Taipei). Branch: `codex/luggage-workspace-redesign`, based on `2600066`.
Scope: [Issue #9](https://github.com/PeterChiu0314/Travel-Planner/issues/9). Local implementation; not published or deployed.

## Root cause and change

`loadTrips()` selected explicit columns from `trip_members.trips` but omitted `budget_exchange_rates`. Formal `BudgetWorkspace` reads rates from `activeTrip.budget_exchange_rates`; there is no separate Formal rate prop. The missing field disabled `canRefreshRates`, so even an empty JSON rate object could not trigger first initialization. Realtime trip reloads and the offline trip cache inherited the same omission.

The only application change is adding `budget_exchange_rates` to that existing nested SELECT in `src/App.jsx`. Trip mapping, cache serialization, rate fetching, initialization guards, the update RPC and its reloads are reused. No new state source, schema, dependency or subscription changes.

Supabase's [SELECT documentation](https://supabase.com/docs/reference/javascript/select) confirms explicit nested projection. Changelog reviewed; no API change is required for this correction.

## Reproduction and functional verification

The new `tests/formalBudgetRates.spec.js` runs the real App against an isolated shared backend that honors the nested SELECT. Before the fix, both existing-rate and empty-JSON tests failed with the rendered text `旅程統一匯率尚待啟用`. An overpermissive mock returning all columns would miss this bug.

Final tests use the real `/` entry, production CSS and React StrictMode. Eight cases cover:

- Existing quotes after reload and the same quote in new/existing budget editors; no unnecessary quote fetch/RPC.
- Empty JSON initialization exactly once, including its own RPC-triggered trip event, repeated notifications and reload.
- Two separate browser clients sharing a mock DB: A manually updates rates; B's already open Budget receives its real registered trip callback and displays the new quote. Budget events then update both clients' repriced row/totals.
- Offline trip-list restoration retains quotes; a subsequent authoritative trip event updates them after connectivity returns. This does not claim that `online` alone refreshes the trip list.
- Delayed list snapshots cannot overwrite fresh quotes/cache after trip or account A -> B -> A. Tests drain outstanding reads before checking the result.
- Logout clears the old account's rate cache; its in-flight response cannot overwrite the next account.
- A departed empty-rate trip cannot fetch/initialize a quote and has a disabled refresh control.

## QA evidence

Environment: local `http://127.0.0.1:5174/`, Chromium, 1440 x 1000 for the new Formal cases. Browser plugin not available; used the repository's installed Playwright/Chromium. Supabase and public quote responses are mocked; unexpected hosted Auth/REST/Realtime requests fail the new tests.

| Check | Result |
| --- | --- |
| Correct page and meaningful content | Real `/` entry renders the named QA trip and Budget table |
| Framework overlay / console errors | No Vite overlay, page errors or relevant console errors in new cases |
| Interaction | Quote refresh, editor entry, trip/account changes and offline reload verified |
| Screenshot | Visually inspected `issue-9-budget-rates.png` in this chat's visualization folder: JPY 0.25, total TWD 250, each member TWD 125 |
| Budget / Formal / cache regression | 76/76 passed; includes the original eight new cases |
| Final Formal + route smoke | 38/38 passed: eight strengthened Formal cases through `/` plus all 30 `phase-1-7f-smoke.spec.js` cases |
| Offline PostgreSQL | Both `tests/budget-database.mjs` and `tests/budget-safety-database.mjs` passed, including RLS, historical FX/payment protection, locks, idempotency and fault rollback |
| Production build / diff | Passed; existing Vite bundle-size advisory |

Key commands: `npx.cmd playwright test` with the Budget, Formal, cache and smoke specs; `node tests/budget-database.mjs`; `node tests/budget-safety-database.mjs`; `npm.cmd run build`; `git diff --check`. Browser path and base URL were supplied via `PLAYWRIGHT_BROWSERS_PATH` / `PLAYWRIGHT_BASE_URL`. Offline SQL uses the existing external PGlite installation through `PGLITE_MODULE`, without adding dependencies.

## Boundaries

Reliable Formal App mocks verify the application data path; offline PostgreSQL verifies existing server contracts separately. This is not a hosted Supabase two-account Realtime or public exchange-rate provider acceptance test. No Production query/write, migration, main merge, frontend deployment, issue update/closure, commit or push. Issue #10 remains separate.
