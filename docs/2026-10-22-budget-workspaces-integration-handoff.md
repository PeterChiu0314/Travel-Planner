# Company Budget + four supporting workspaces integration

2026-10-22. User requested combining the home desktop improvements with the newest company branch, keeping the newest Budget page authoritative.

## Git and source priority

- Fetched remote feature branch `origin/codex/budget-page-polish` at `9ccb890` (2026-10-22 17:30 +08:00); `origin/main` remains `fdd332b`. The company branch contains 17 commits beyond main.
- Preserved all intended home changes in local checkpoint `099ad87` on `codex/budget-management-redesign`. Existing unrelated test directories, QA images and Supabase cache were excluded and left untouched.
- Created `codex/budget-workspaces-integration` from `9ccb890`. Ported Accommodation, Todo/Guide, Luggage and Settlement presentation, shared workspace components, tests and root DESIGN relocation. The old home Budget implementation was deliberately not ported.
- `src/components/budget/`, `MenuSelect.jsx`, Budget fixtures, `budgetFinance.js`, `tripBudgetRates.js`, migrations and `src/main.jsx` are identical to the company branch. Formal App controller, Budget editor service wrapper and save/delete/rate callbacks are also unchanged.
- Settlement presentation uses the company `settlementBalances` integer allocations, incomplete-data suppression and valid frozen-baseline conditions. It never substitutes current mutable budgets for departure data and never invents a baseline of zero.

## Integration details

- Shared supporting-page CSS remains scoped to `.travel-workspace` at desktop widths. Company Budget selectors and dense grouped-table layout are untouched.
- Demo sidebar enables Accommodation and Todo/Guide in addition to the company's existing Timeline/Budget/Luggage/Settlement routes. Overview remains unavailable in Demo.
- Demo supporting records are held in memory per trip, matching finance state isolation. Accommodation/Todo/Guide/Luggage share Formal view/controller components with draft persistence, locks and accommodation Storage disabled explicitly; Formal defaults remain unchanged.
- Local dirty comparisons protect supporting-page Save/Discard navigation while autosave remains disabled. Company active-editor dialog and shared autosave implementation are unchanged. CRUD return values now match the shared Luggage controller contract. Reload restores illustrative fixtures.
- Tests use the newer 32-item Kyoto graph and Dennis/member identities, rather than the old two-row Tokyo budget data. New tests retain the company's default navigation behavior, including removal of opt-in `budgetTools=1` when changing section.
- Root DESIGN §9.1 now documents the company Budget implementation; §9.2 records the compatible supporting pages and updated settlement baseline rule. CURRENT_TASK starts with the integrated state and retains the company rollout history below it.

## Verification

- Full Playwright: **395/395 passed**, two workers, 1.3 minutes. This includes all 382 company checks plus 13 supporting-page integration checks.
- Covered company pricing modes, payment capsules, rate sharing, category folding, editor guards, receipt object URLs, snapshots and member balances; supporting CRUD, assignee/guide links, luggage packing separately from owner confirmation, Save-on-navigation, trip isolation and reload reset; and Budget payment changes propagating to Settlement without replacing the frozen departure baseline.
- Supporting pages checked at 1280×720, 1440×1000 and 1920×1080 with no horizontal overflow or offscreen controls. Fresh Demo test contexts emitted no app/console errors or Supabase/Auth/Storage/Realtime requests and wrote no draft/lock localStorage entries after advancing beyond the autosave debounce.
- `npm.cmd run build` passed; existing >500 kB bundle advisory remains. `git diff --check` passed.
- In-app browser inspected company Budget, Accommodation and Todo. Toggling a Todo checkbox changed preparation progress from 1/3 to 2/3. The old retained tab contained earlier HMR-disconnect/expired-auth log entries; a newly opened integration preview showed no errors or warnings. No authentication or storage settings were changed to obtain that result.
- Five desktop screenshots are outside Git in `C:\Users\PeterChiu\.codex\visualizations\2026\10\18\01a14c95-d406-7d33-b655-0a2c9de1460d\integration-2026-10-22\`: `budget-desktop.png`, `accommodation-desktop.png`, `todo-desktop.png`, `luggage-desktop.png`, `settlement-desktop.png`.

Key commands:

```powershell
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:5174'
npx.cmd playwright test --workers=2 --output='<external visualization directory>'
npm.cmd run build
git diff --check
git diff origin/codex/budget-page-polish -- src/components/budget src/components/MenuSelect.jsx src/demo/budgetFixtures.js src/lib/budgetFinance.js src/lib/tripBudgetRates.js supabase src/main.jsx
```

The final command produces no differences. SQL tests were not rerun because no migration/SQL/library change was made; company evidence remains in its handoff.

## Preview and publication boundary

Open `http://127.0.0.1:5174/demo/budget` and use the sidebar for the four supporting pages. This uses local illustrative data. No remote push, main update, deployment, hosted data change or migration replay was performed. The company handoff records already-applied Production migrations; that state was not rechecked against hosted Supabase here. Authenticated CRUD, real receipt Storage, multi-client locks and Realtime remain outside this local integration check. Desktop remains the requested development scope.
