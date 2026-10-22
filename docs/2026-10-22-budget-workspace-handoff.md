# Budget Workspace — 2026-10-22

## Local state and authorization

- Branch `codex/budget-page-polish`, based on `main` at `fdd332b`; initial card pass committed as `6d4317b`, superseded by the current workspace changes.
- User approved implementation after desktop image previews. Latest rules override earlier plans: phase is readonly; comparison appears only in Settlement; Traveling prioritizes recording expenses, without budget compliance indicators.
- No production/Staging migration, authenticated data mutation, push, or deployment performed. Do not deploy the UI without coordinating the migration rollout below.

## Implemented UI

- Existing Formal shell retained. Shared Formal/Demo `BudgetWorkspace` replaces the earlier card view.
- Desktop: left grouped compact table, right statistics/detail panel. One toolbar; 36px item rows; no row expansion, repeated category labels or ellipsis actions.
- Columns: Day, item, per-person TWD, total TWD, status `預算` / `實付`. Category subtotal only under total. Day comes from Timeline links, including disjoint days.
- Single click opens readonly detail. Double click title/per-person/total starts the same editor draft used by the right panel. Enter saves, Escape cancels the inline change, blur does not save. Custom amounts open member allocations instead of inventing an average. Original currency is explicitly shown during inline amount editing; entering 1,000 JPY changes TWD by its FX rate, not by 1,000 TWD.
- Right statistics defaults to clearly named full-group average; member viewpoint uses actual item participation/allocations. All-trip total is secondary. A compact proportional category strip and amounts/percentages provide the requested distribution without adding a chart package.
- Budget and actual editors support per-person price, split total and advanced custom shares. Payer and participants remain independent. Zero participants rejected.
- Traveling defaults to actuals; quick entry exposes title, amount, currency and payer, with participation/more settings secondary. Budget remains accessible. Settlement alone adds `對照`.
- Comparison includes all snapshot items, multiple actuals per budget, unrecorded items and expenses outside the snapshot. Missing baseline displays an unavailable state, never a current-data or zero-budget substitute.
- Mobile receives only minimum table horizontal scrolling and a stacked, operable editor, as requested.

## Source map

- `src/components/budget/BudgetWorkspace.jsx`: workspace, two persistent editor controllers, compact table, detail/statistics and inline editing.
- `src/components/budget/budget-page.css`: scoped workspace styles, desktop and minimum mobile adaptation.
- `src/lib/budgetFinance.js`: decimal validation, integer money calculation, deterministic largest-remainder TWD allocation, legacy interpretation, Day, stages, comparison and settlement balances.
- `src/App.jsx`: Formal data load, offline baseline cache, capability-aware Realtime, guarded persistence and Demo local callbacks. Removed old Budget/Actual card/form components and `BudgetPageParts.jsx`.
- `supabase/migrations/20261022090000_budget_workspace_baseline_and_pricing.sql`: **prepared, not applied**.

## Database design awaiting rollout

- Existing `amount` stays ORIGINAL-CURRENCY TOTAL. Legacy records default to `split_total`; existing reserved custom rows remain custom but require real allocations rather than a guessed average.
- Add pricing mode/unit amount, original-currency custom participant shares, and actual category/subcategory/split fields. Actual `budget_origin_id` preserves historical matching when a budget is deleted and its FK becomes null.
- `trip_budget_baselines` contains a JSON copy of budget items, participants, Timeline links/Day metadata and member display names. Member-readable RLS only; clients cannot insert/update/delete baselines.
- Deferred server triggers maintain the final committed planning version before departure. At departure the existing row is logically frozen without cron or a browser visit. Later changes to dates, budgets, members or Timeline cannot replace an expired baseline.
- Cutoff: **00:00 on the trip start date in Asia/Taipei**, consistent with current app date usage. No per-trip timezone exists. Do not silently introduce a different cutoff/timezone.
- Migration seeds only future trips. Trips already underway/finished cannot have a valid departure baseline reconstructed.
- Atomic invoker RPC saves parent + participants + links + optional fixed actual; preserves existing RLS, checks approved members, same-trip links, `updated_at` and other-user edit locks. Fixed actual is created once and never overwritten by later budget changes.
- Delete RPC also checks version and edit lock. Existing RLS remains authoritative.
- Original amounts have 2 decimal places, FX 6. Compute original total × FX, round once to whole TWD, allocate whole TWD using stable UUID-order largest remainders. Member/category amounts derive from the same allocations; payer-paid amounts are separate.
- Settlement balance calculation uses these exact allocations. Unknown legacy custom shares, absent payers or unavailable members suppress transfer suggestions until corrected.

## Existing-database compatibility

- Formal can render the new UI against the current schema. A missing baseline table is detected once per app session; it is never added to the Realtime subscription until available, preserving other table subscriptions.
- Existing split-total CRUD uses the old callbacks before migration. New pricing modes/fixed actual creation fail clearly with the draft retained until the migration is enabled. Snapshot comparison is unavailable until the schema is applied.
- Post-migration all new workspace saves use the atomic RPC; no client-maintained snapshot and no localStorage replacement for server baselines.
- Active Editor Guard, local draft autosave, explicit Save/Discard and existing record locks remain in use. Two controllers stay mounted; panel switching does not lose draft state. Restored drafts retain their original conflict timestamp and reacquire locks safely before save.
- Only Budget/Actual permissions allow settlement corrections. Timeline, trip dates and member settlement locks remain unchanged.
- Existing receipt attachments remain in the actual detail panel using the private bucket and existing metadata/signed-URL callbacks.

## Verification and rollout

- Final full Playwright: **361/361 passed**, including final visual tightening and the missing-baseline regression. Build passed; existing large-bundle advisory remains.
- `tests/budget-page.spec.js`: filtering without changing statistics, click/detail/inline semantics, custom/per-person conversion, participants validation, editor handoff, readonly date stages, frozen comparison, fixed actual idempotence, missing baseline and 390/1280/1440 widths.
- `tests/budget-finance.spec.js`: legacy totals, custom allocations, payer distinction, rounding/reconciliation, multiple actuals, deleted-budget origins and Taipei midnight.
- `tests/budget-database.mjs`: all repository migrations executed in isolated PGlite with Supabase Auth/Storage/role fixture; pricing, RLS, conflict rejection, fixed actual, participant validation rollback, immutable baseline, deletion lock and origin preservation passed. This does not replace hosted Supabase Realtime/Storage QA.
- Run isolated SQL tests with `PGLITE_MODULE` pointing to an externally installed `@electric-sql/pglite/dist/index.js`; the test package is not a production dependency and no runtime package was added to the project.
- Authenticated Formal preview inspected read-only at 1440×900. Actual existing trip has 1 approved member, 9 budget records; image mock's illustrative 3-member/24-item data is not manufactured into Formal data.
- Next authorized rollout requires staging migration + hosted Formal CRUD/lock/Realtime/receipt checks, then production approval. Check a real server cutoff scenario and deferred-trigger cost on bulk Timeline operations in staging. No automatic backfill of historical snapshots.
- Preview: `http://127.0.0.1:5175/#`. Screenshots and visual comparison are in this chat's visualization folder; `design-qa.md` records the final review.

## Home-computer integration

Keep this work isolated on the Budget branch. Merge/rebase any home-computer branch after reviewing overlapping `src/App.jsx` changes. Most new UI and calculations are extracted into Budget-specific files. Preserve unpublished home changes; no remote push was requested in this session.
