# Supporting workspaces desktop UI — local review

> Historical 2026-10-18 implementation record. The home work is preserved at `099ad87`; the Budget portion is superseded by company branch `9ccb890`. The four supporting pages are integrated with that newer Budget implementation on `codex/budget-workspaces-integration`. Current state: [2026-10-22 integration handoff](2026-10-22-budget-workspaces-integration-handoff.md). Old fixture counts, settlement calculations and uncommitted status below describe the earlier state only.

2026-10-18. User requested continuing the redesign through the remaining sidebar pages below Budget. Scope: accommodation, todo/guide, luggage and settlement, desktop only. Work remains uncommitted on `codex/budget-management-redesign`, based on `main` at `fdd332b` and including the earlier DESIGN relocation and budget redesign. No upstream publication, database change or deployment.

## Delivered

- Shared heading, summary strip, search, accessible edit/delete actions and progress components in `src/components/workspace/TravelWorkspace.jsx`; scoped desktop CSS in the same directory.
- Accommodation: summary, search, stay selection and complete detail/editor, including booking code, dates/times, payment, map, budget, notes and existing Formal attachments.
- Todo/guide: preparation progress, search/status filters, completion, assignee/due date/linked guide and independent guide CRUD.
- Luggage: private and shared columns, personal/team packing progress, inline CRUD and shared edit cancellation. Assignee packing and owner confirmation retain separate fields and existing permissions.
- Settlement: explicit TWD summary, member balances labeled receivable/payable, suggested transfers, actual expenses and pending budgets. Existing split/fallback/transfer calculations are unchanged; no payment action is introduced.
- Demo uses the same four Formal components. Added local fixtures/routes for accommodation, todo and settlement; removed the duplicate `DemoLuggageView` renderer. Explicit optional infrastructure flags default to the existing Formal behavior. Demo disables restoration/autosave, locks and Storage; all mutations are local React state.

## Local preview

Vite: `http://127.0.0.1:5174` (separate from other projects on 5173).

- `/demo/accommodation`
- `/demo/todo`
- `/demo/luggage`
- `/demo/settlement`
- `/demo/budget`

Mock data does not persist after refresh. New accommodation/todo fixtures use the initial Kyoto trip dates; the existing budget fixtures remain the original Tokyo example, as documented in the budget handoff. They are preview content, not evidence of bookings or production data. Demo attachments explain that uploads belong to Formal; they do not invoke Storage.

## Verification

- 27 focused Playwright checks passed across `travelWorkspace.spec.js`, `budgetWorkspace.spec.js`, selected smoke checks and member/share/sidebar source guards.
- Covered accommodation CRUD/search/selection and booking fields, todo completion/filter/assignee/guide links and CRUD, guide CRUD, luggage CRUD and cancellation, assignee packing independently of owner confirmation, and settlement propagation after converting the remaining budget.
- Each new page checked at 1280×720, 1440×1000 and 1920×1080: no document horizontal overflow or offscreen form/action controls. Page errors/console errors and Supabase/Auth/Storage/Realtime requests were absent. Edited Demo accommodation/todo/luggage records and waited beyond autosave debounce; no draft/lock localStorage keys were written.
- Native browser inspection used the local UI. Final 1440px screenshots are outside the repository under `C:\Users\PeterChiu\.codex\visualizations\2026\10\18\01a14c95-d406-7d33-b655-0a2c9de1460d\{accommodation,todo,luggage,settlement}-desktop.png`.
- `npm.cmd run build` passed; the existing >500 kB bundle-size warning remains. `git diff --check` passed.

Visual comparison against generated concepts checked: (1) existing sidebar/header retained; (2) warm white, deep green and thin borders; (3) quiet page title and task-level actions; (4) accommodation master/detail hierarchy; (5) todo/guide and personal/team columns; (6) readable settlement balances and transfers. The implementation uses existing app navigation, actual fields and mock counts; concept-only navigation, decorative icons and unimplemented search controls were omitted. Browser inspection caught and fixed legacy fixed-width add buttons, compressed luggage metadata and implicit select/textarea accessible names.

## Boundaries

Formal data callbacks and permission rules remain in the existing container. Local mock browser tests do not verify authenticated Supabase saves, real attachment operations, competing edit locks, Realtime conflict resolution or role behavior against live RLS. These require a separately authorized environment check. Mobile/tablet and PWA are deferred. No new packages, backend calls, schema, migrations or provider services were added.

Keep preexisting `.tmp-phase-expanded-*`, old QA PNGs, `supabase/.temp/` and `test-results/` out of a future scoped commit. Do not treat build output or local screenshots as publication. User review and any later push/merge/deploy request remain separate steps.
