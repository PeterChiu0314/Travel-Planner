# Desktop Budget page first pass — 2026-10-22

> Superseded UI pass. The card layout below was replaced after user review. Current implementation, departure snapshot rules, pricing modes, test results and pending migration: [Budget Workspace handoff](2026-10-22-budget-workspace-handoff.md).

Branch: `codex/budget-page-polish`. Base: `fdd332b` (remote `main`). Status: implemented and tested locally; awaiting user visual acceptance. No push or deployment.

## References and decisions

Reviewed public official examples, including their visual product illustrations:

- [Wanderlog travel budget](https://wanderlog.com/travel-budget-expense-splitting-app): total-first expense hierarchy, category breakdown, original currency alongside home-currency totals.
- [tricount group expense tracking](https://tricount.com/en-us/features/group-expense-tracking): recognizable expense title, clear amount and payer, member accounting distinct from expense entry.
- [Splitwise expense flow](https://kb.splitwise.com/getting-started/how-do-i-use-splitwise): expense entry and settlement are separate steps.

Applied these patterns to the existing Travel Studio design tokens and planned-to-actual flow. This is a targeted desktop improvement, not a copy of the reference sites. The user explicitly deferred mobile-specific work.

## Changes

- One top summary for planned total, actual total, and their difference, all in TWD; overspend has an explicit label. Difference is not presented as pending payments or settlement balance.
- Category totals remain visible. Planned-budget search covers title/category/subcategory/note/payer and combines with category selection. Filtering never changes whole-trip totals or actual-expense records; clear/empty states are explicit.
- Two-column desktop cards place title and original/converted amounts together, followed by payer, participants, linked itinerary, notes, status, and actions. Actual cards use the same hierarchy.
- Text-plus-icon add controls and labeled Pencil/Trash actions replace ambiguous symbols. Existing lock and permission gates remain in place; absent split metadata no longer renders a misleading custom-split badge.
- Presentation lives in `src/components/budget/BudgetPageParts.jsx` and scoped `budget-page.css`. `src/App.jsx` retains editor state, draft/lock handling and all persistence callbacks. No package, database, RPC or migration change.

## Verification

- Full Playwright: 350/350 passed, including the existing required Map/provider and Demo/Share shell checks.
- Five new Budget checks cover filter intersection/reset and unchanged totals; budget create/edit/convert/delete; direct actual expense and overspend; 1280px and 1440px desktop geometry.
- Production build passed with the pre-existing Vite large-chunk notice. `git diff --check` passed with informational Windows line-ending notices.
- Desktop rendered QA: meaningful page/title, no Vite overlay, no app console error, and no horizontal overflow. Tests changed Demo local state only. Authenticated Formal writes, attachments against real Storage, and multi-client lock behavior were not exercised.
- Screenshots/test artifacts stay outside Git. Existing untracked `test-results/` is preserved.

## Integrating home-computer work later

Fetch the home branch once it is pushed and compare it to `fdd332b` before merging. Prefer reusing the standalone presentation component and scoped stylesheet; resolve overlapping `App.jsx` Budget/Actual blocks intentionally. Keep existing callbacks/data shapes and regression-test conversion and draft save/cancel after resolving conflicts. Do not replace the whole `App.jsx` with either computer's version.
