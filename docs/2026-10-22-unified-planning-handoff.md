# Unified planning and simple expense entry — 2026-10-22

User approved the assessment to remove the planning-phase Actual tab, edit paid amounts in the same Budget list, retain records when cancelling paid status, and simplify travel entry to currency + amount. This supersedes the prior issue #1/#3 UI design. Work remains local and uncommitted on `codex/budget-workspaces-integration`.

## Behavior and implementation

- Planning exposes one Budget list. Saved payment cost is projected into the corresponding Budget row in TWD so old FX estimates cannot overwrite known debits. An explicit edit of a single linked payment updates Budget, payment and allocation rows together. Original payment values are retained in `payment_history`; receipt targets keep their IDs.
- Multi-payment legacy budgets keep individual records and receipt/participant identity; the aggregate monetary controls are read-only. Their payment entries remain editable in the existing side panel. Unlinked legacy payments have a separate entry inside that panel, never an inaccessible hidden tab. If old entries have mixed active states, the displayed paid cost uses active entries; all retained entries remain accessible.
- Unpaid toggles set `payment_active=false`. They do not delete payment, participant or attachment rows and do not ask a destructive confirmation. Re-marking paid reuses existing rows. Explicit item deletion remains the existing separately confirmed operation.
- Actual lists/statistics, comparison rows and Settlement exclude inactive payments. Pending Budget totals use retained payment amounts. Missing payers/custom weights continue to block transfer suggestions; no false balancing is introduced.
- Travel forms use one currency and amount. TWD is the known debit; foreign values are converted with the saved/reference quote. Changing currency/amount recalculates the selected value; metadata-only edits retain older authoritative debit values. The dual source switch and second TWD input were removed, while internal source fields protect legacy data.
- Trip quote refresh is centralized in the statistics panel and labelled `更新匯率`. The per-record refresh button is removed. Quotes stay fixed between explicit updates; refresh changes unpaid estimates only, skipping every budget with retained payment records, including temporarily inactive ones. Demo uses fixed local quotes and performs no external requests.

## Database boundary

`20261022120000_unified_planning_payments.sql` adds activity/history columns and invoker RPC `save_budget_workspace_record_v3`. It requires the preceding prepared `20261022110000` migration. Both are local only; older applied migrations were not rewritten.

The v3 RPC checks permissions, exact payment IDs/versions, other-user locks and the request key under a trip advisory transaction lock. It delegates non-payment saves to v2 with `payment_action=keep`, then creates, synchronizes or activates/deactivates payments in the same transaction. A distinct inner request key and outer idempotency result cover retries of the complete operation. All mutations remain subject to existing RLS. Missing v3 fails safely with the draft retained.

## QA

Browser plugin not available; used repository Playwright against `http://127.0.0.1:5174`, with no hosted credentials. Desktop is the acceptance scope. Existing 390px regression coverage was retained; no real mobile-device claim.

| Check | Evidence |
| --- | --- |
| Route/content/overlay | Local Demo Budget and travel phase render meaningful content without framework overlays |
| Console | Shared Demo UI captures page/console errors; all cases passed |
| Interaction | Create paid 12,000 → edit 12,500 → attach receipt → unpaid → paid → Settlement retains 12,500 |
| Simplified entry | Travel JPY 2,800 converts to 616; changing to TWD 625 persists and reopens as 625 |
| Legacy protection | Inactive multi-payments retain rows/receipts; mixed activity uses active totals; known foreign debit survives metadata calculation |
| Regression | Full Playwright 407/407 (48.1s); Budget/safety/unified 36/36 (30.6s); final cost/retention checks 12/12 (6.7s) |
| Database | Both isolated all-migration PostgreSQL suites pass; real v3 synchronization, receipts, status round-trip, idempotency and viewer/outsider/anon denial verified |
| Rollback | Injected actual-update failure after Budget mutation restores the full Budget row and payment amount; earlier insert/second-delete faults still pass |
| Build/diff | Production build and diff check pass; existing bundle-size advisory remains |

Screenshot files outside the repo: `C:\Users\PeterChiu\.codex\visualizations\2026\10\18\01a14c95-d406-7d33-b655-0a2c9de1460d\unified-planning.png` and `unified-travel.png`. Inspected at the local desktop viewport; independent panels and payment footer remain reachable.

No commit, push, main merge, frontend deployment, hosted migration or issue mutation performed. Hosted authenticated concurrency, Realtime and Storage rollout remain unverified. Apply both new migrations before publishing the matching frontend; do not replay the already-applied company migrations.

## Browser-comment polish

- Removed the sole planning Budget tab; search/filter now start directly at the left edge of the toolbar. Travel/settled view tabs remain available.
- Single linked payments no longer render a repeated payment-record heading/button; attachments remain directly in the detail panel. Multi-payment legacy entries retain the necessary individual editors under `既有分筆`.
- Editor FX label/value now share one flex row, with the rate aligned right. Summary refresh button is simply `更新匯率`, with trip-wide scope still explained nearby.
- Local Playwright visual QA at 1492×1119 verified all four comments, nonblank route/title, no overlay or console errors, direct attachment availability, and exact same-row/right-edge FX alignment. Evidence: `budget-comments-editor.png`, `budget-comments-detail.png`, `budget-comments-stats.png` in the existing external QA folder.
- Focused Budget/safety/unified regression and build/diff checks passed. This is a local UI follow-up only; no database or deployment change.

## Independent editor tab

- Added `編輯項目` after Statistics and Details. Clicking it with a selected item opens that item's controller; clicking list rows while it is selected directly opens editing. Add, double-click and the detail pencil explicitly open this tab as well.
- Explicit tab choices are pinned. Deselecting, save/cancel, view or trip changes do not redirect to Statistics. Detail and Edit have separate empty states; after closing an edit, a selected item offers `繼續編輯此項目`.
- Viewing Statistics or Details keeps the editor controller, draft and lock mounted. Switching edited rows still resolves the existing dirty Save/Discard guard. Opening is guarded against concurrent duplicate requests. Viewer and other-user-lock cases cannot open a form and show the appropriate message. Failed saves show errors without overriding an explicit tab choice.
- Existing save/receipt/settlement regressions now explicitly select Details when inspecting saved data, rather than relying on the removed automatic editor/detail swap. Four new tests cover direct editing, retained drafts, sticky deselection across all three tabs, dirty row handoff, and viewer/lock denial.
- Full Playwright **411/411 passed**, 48.9s; build and diff check passed. Browser plugin not available; local Playwright at 1492×1119 checked the meaningful page/title, no overlay or console errors, direct edit, tab-switch draft retention, Save/Discard and both empty states.
- External evidence: `budget-edit-tab.png` and `budget-edit-tab-empty.png` in the existing QA directory. Both were visually inspected. No persistence, SQL, hosted deployment or Git publication change for this follow-up.

## Remove double-click / inline editing

The user requested one editing path because the independent Edit tab already provides direct editing. Removed all table double-click handlers, inline title/amount inputs and their hint/state/styles. Cells now only select; existing sidebar Save/Cancel, draft/lock and permissions remain intact.

This also resolves the reported parking-cost confusion: the table's TWD132 per person no longer becomes a JPY600 inline input. The edit tab shows the unchanged original JPY3,000 total, JPY currency and split-total mode. Entering or cancelling editing does not reprice or switch modes.

Updated prior inline regressions to exercise the approved sidebar path, retaining pricing, frozen-baseline and layout checks. A regression double-clicks parking title/person/total and verifies no table inputs, no editor opening in Details, unchanged TWD132/660 and original JPY3,000 in Edit. Focused tests **40/40 passed** (32.2s), build/diff checks passed. Local 1440×900 browser check confirmed page identity/content, no overlay or console errors. Screenshot `budget-no-double-click.png` was inspected in the existing external QA folder. No database or hosted write.

## Menu and category layout audit

- Audited every Budget MenuSelect: category filter, statistics viewpoint, Demo scenario, editable category, payer, currency, itinerary Day and Actual source Budget. Popups now match the full field border width, including narrow 108px filters and 92px Day fields, rather than forcing a 160px minimum. Long choices wrap inside the menu; no horizontal overflow.
- Reused Timeline menu border/radius/paper/hover/selected styles. Portal menus retain bounded height, viewport placement, Escape/arrow/Home/End/Enter handling and focus behavior. Chromium uses the existing 4px WebKit scrollbar rules, transparent track, rounded muted thumb and no arrows; Firefox keeps the thin scrollbar fallback. Overscroll stays within the popup.
- Status column is 100px, including the smaller desktop breakpoint. Sidebar tabs now occupy 51px plus 8px spacing; adjusted sticky scroll inset/detail height to match and reclaim content area.
- Category identity now determines color, independently of cost ranking. Group-row tint and icon match the distribution bar and legend. Existing initial colors are preserved for named categories; custom labels get a deterministic palette color.
- Two new rendered tests cover all menu widths, viewport bounds, long-source overflow, 4px scrollbar, existing surface radius, keyboard source selection, 100px status width, compact tabs and category consistency after changing member viewpoint. Full Playwright **413/413 passed** (51.4s), production build and diff check pass. Existing bundle advisory remains.
- Browser plugin not available; repository Playwright and local visual QA at 1440×900 verified page identity/content, no framework overlay or console errors, selection interactions and screenshots. Inspected `budget-category-colors.png`, `budget-filter-menu.png`, `budget-currency-menu.png` in the external QA folder. No new financial, database, deployment or publication changes.

## Push checkpoint — 2026-10-22

- User authorized committing and pushing the active integration branch. Main merge, deployment and hosted migration remain outside this request.
- Final UI: three equal-width icon tabs; Day text aligned with category labels; person 120px, total 130px with 24px right padding, status 100px. Category stripes removed. Toolbar controls are 36px; planning uses All / Unpaid / Paid with search intersection and independent trip statistics.
- Two prepared migrations are included as files only; apply them before deploying this frontend. Generated QA output, Supabase CLI temp state and unrelated historical screenshots are excluded.
