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

## Demo Kyoto follow-up — 2026-10-22

User requested a complete multi-member Demo because the Formal trip currently has only one approved member. All added amounts are illustrative local test data; no production financial records were populated or altered.

- Open `/demo/budget`, default trip `京都琵琶湖之旅-TEST`, 5 approved test members: Peter, Dennis, 小羊, Chloe, Dora. Existing 6-day Timeline dates are retained.
- `src/demo/budgetFixtures.js` replaces the old two Tokyo budget records and dangling Timeline links. New graph: 32 budgets, 7 categories, 3 pricing modes, totals **TWD 174,851**. Personal planned burdens: Peter 36,883; Dennis 35,301; 小羊 34,157; Chloe 34,509; Dora 34,001. Human average is 34,970 after rounding, intentionally different from named burdens.
- Scenario control is explicitly outside the shared workspace and only exists in Demo. Header phase remains a readonly label; Formal phase behavior is unchanged. `依目前日期` uses the clock, while Planning/Traveling/Settlement selections allow testing without changing travel dates.
- Planning begins with 8 prepaid actuals. Traveling adds 12, reaching 20. Settlement reaches 34: 31 of 32 planned items recorded, fuel split into two payments by different people, two unplanned actuals, and personal shopping left unrecorded. Final actual total **TWD 175,588**, snapshot difference **+737**.
- Entering Traveling or Settlement freezes the current planning graph in memory; subsequent budget changes/deletion cannot change it. Going back to Planning does not unfreeze that departure snapshot. Use `重設預算案例` for a fresh baseline and initial prepaid data. Scenario hydration never overwrites edits, re-adds previously deleted sample actuals, or creates duplicate IDs.
- Budget/actual custom shares, payer separation, fixed-actual idempotence, deleted-source identities, statistics and comparison use the same shared components/calculations as Formal. Receipts use the Formal AttachmentList, accepting local JPEG/PNG/WebP/PDF under 10MB; object URLs are revoked on deletion/reset/unmount. Nothing uploads to Supabase Storage.
- Local finance state is separately retained per trip during the browser session. Other trip fixtures start empty. Save/Discard guards protect view, section, scenario and trip changes; stale/cross-trip local edits are rejected. Reload intentionally restores fixture state, with no draft/localStorage persistence or edit-lock simulation.
- Shared right panel now sticks within the desktop workspace, with bounded scrolling for the longer member/statistics content; mobile stays stacked.
- Sidebar uses the Formal labels/order/icons. Timeline, Budget, Luggage and Settlement operate; Overview/Accommodation/Todo are disabled and labeled unavailable in this Demo. This follow-up does not implement those unrelated modules or hosted collaboration/auth permissions.
- Automated QA: full **367/367** passed. `tests/demo-budget.spec.js` adds graph reconciliation, hydration idempotence, member viewpoint, custom detail, source deletion + frozen comparison, member balances, navigation guards/trip isolation and local receipt upload/open/delete. Existing Budget tests were updated to target Kyoto's 32 rows. Timeline smoke now permits the documented grouped wrap for populated budget tags; Timeline rendering/styles/logic were not modified.
- Browser plugin not available; repository Playwright is used for automated QA, with additional in-app browser inspection at the current 1264×892 desktop viewport. Existing checks also exercise 390/1280/1440 widths. The earlier stopped dev server produced connection errors on the first run; after restarting at port 5175, reload and final app interactions showed no new console errors or framework overlay.
- Screenshots: `demo-kyoto-personal-budget.png`, `demo-kyoto-custom-detail.png`, `demo-kyoto-settlement-comparison.png` in the chat visualization folder. Production migration remains pending as described above.

## Budget editor UX follow-up — 2026-10-22

- Applied the seven browser comments to the shared Formal/Demo Budget UI. Member selection starts collapsed; explicitly choosing Custom Split expands its required inputs. Member rows are approximately 30px, with checkbox minimum height reset so global input styles no longer inflate them.
- Editor and detail use the same per-person / total summary. Custom shares display `依成員`; TWD has no duplicated original-currency total, while foreign totals remain secondary. Custom member inputs are correctly labeled with their input currency.
- Payer label is `付款人`. `這筆已付款` retains the existing create-actual-on-save behavior and explains it when selected. Existing actuals show `已記錄實付` plus the fact that editing a budget does not modify actual amounts; no pricing/persistence changes.
- Timeline picker shows selected links with individual remove buttons. Expand to search, filter by Day, and choose multiple checkboxes; saving retains the existing `linkedItemIds` contract and editor guard.
- At desktop widths above 1100px the active Budget workspace fills the remaining viewport below Header/Demo controls. Table and side panel scroll independently; table header, side tabs and editor actions remain visible. Formal selectors only activate for its visible Budget wrapper, preserving Timeline/other sections. Mobile keeps normal stacked document flow.
- QA: full Playwright **369/369 passed**; focused Budget/Demo tests cover collapsed defaults, row height, summary recalculation, picker save/reopen, prepaid idempotence, and panel/header bounds. Final shared summary refinement was rechecked with the focused suite and build. In-app 1264×892 screenshots: `budget-editor-compact.png`, `budget-itinerary-picker.png` in the chat visualization directory. Browser plugin not available; repository Playwright plus in-app CUA inspection used. No database, migration, dependency or deployment changes.

## Budget density, payment entry and suggestions follow-up — 2026-10-22

- Subsequent six browser comments supersede the previous checkbox wording. Inline inputs have explicit 28px height, number spinners hidden; row height is unchanged on double-click. Editor/filter controls use 32px height, with smaller gaps and compact actions. Table padding moved into cells so separators and category bands span the board; grid gap is zero. Left table, right panel and link results use Timeline's existing 4px rounded thumb / transparent track with no scrollbar arrows.
- Removed the budget editor's payment checkbox. User flow is now: save budget -> detail `登記付款` -> editable actual draft -> `確認付款`. Cancel creates no payment. Existing payments appear in detail with payer and amount, click through to their actual record; the additional-payment action is explicitly `再登記一筆付款`. Budget editing retains original actual records. Existing fixed-record data and backend behavior are not migrated or rewritten; new UI budgets no longer use the implicit create-actual checkbox.
- Link picker adds `建議` / `全部行程`, defaulting to available suggestions. Rules use existing Timeline type plus title keywords: lodging/hotel or check-in, food/meals, transport, flight keywords, attractions/tickets, shopping. Lodging suggestions omit meal/departure-only entries. Date/search filters apply within the selected scope. Unknown categories fall back to all; existing selected links stay visible even outside suggestions. Nothing auto-links and no external API/dependency is used.
- QA: focused **20/20**, full regression **371/371**, production build and diff check passed. New regression checks row-height stability, compact field heights, edge alignment and scrollbar styling, category suggestions with full-list fallback, cancelled payment vs confirmed payment, and preservation of legacy prepaid actual amounts. In-app desktop 1264×892 inspection confirms the rendered layout; existing 390/1280/1440 usability checks pass. Browser plugin not available; repo Playwright and in-app CUA used. No hosted data/schema/deployment changes.

## Budget menu consistency and table polish — 2026-10-22

- `src/components/MenuSelect.jsx` uses existing `timeline-time-menu` / `timeline-type-menu` surface, selected options and scrollbar styling. Applied to Budget filter, editable category, currency, payer, member statistics, link Day, source budget and opt-in Demo scenario. Native Budget selects/datalists removed; category free text remains supported. Header menus and Timeline controls retain their existing implementation.
- Portal popup avoids panel clipping, chooses above/below based on space, follows the anchor on scrolling, restores focus on selection, closes on outside/blur/Escape, and supports arrows/Home/End/Enter. No new dependency or persistence change. Initial UI tests caught inherited CSS `top` conflicting with upward positioning and a delayed anchor scroll; both were corrected before passing.
- Header is one compact row with inline TWD units and a subtle blurred surface instead of a tall opaque block. Table scroller includes 12px bottom padding, equal to side content. Previous follow-ups also removed the outer Board and workspace edge padding; the middle divider reaches Header/bottom and the right scrollbar reaches the viewport edge. Normal Demo tools are hidden; `?budgetTools=1` retains explicit QA access.
- QA: full Playwright **373/373 passed**, build/diff checks passed. Added keyboard/outside dismissal, editable category, payer and source-budget selection, viewport bounds for upward popups, compact table header and bottom inset checks; 390/1280/1440 usability remains covered. In-app 1264×892 screenshots `budget-unified-menu.png` and `budget-table-bottom-padding.png` are saved outside the repo. Browser plugin not available; existing Playwright and CUA used. Production data/schema/deployment unchanged.
