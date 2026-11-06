# Peer-disabled controls and member allocation presentation

## User-visible change

Unchecked participants show a blank allocation in shared PricingFields; selected zero shares remain0. This changes display only, never participant decisions or stored money.

BudgetCollaborationFrame wraps controls in a native disabled fieldset only when ownerId identifies a peer. Inputs/textareas/select triggers/buttons then cannot receive normal pointer/keyboard focus. Existing per-account outlines/name tooltip remain, while peer controls dim. Disclosures cannot activate through click/Enter/Space when peer held. Idle/unclaimed groups are not disabled or dimmed by the frame.

MenuSelect now respects an inherited disabled fieldset before opening, navigating or choosing. Its layout check closes already-open portaled options when peer ownership arrives; portal content cannot escape the group lock.

Native participant checkboxes stay visually normal outside peer-held groups. First click claims the existing pricing lease and applies the choice to the fresh authorized form. Already-owned fields can buffer changes during autosave; declined/pending authority cannot write controller input. Unavailable excluded members stay disabled. Legacy editors keep their prior acquisition behavior.

## Verification

27 distinct local Chromium cases passed across formalExpensePeerAdmission4, formalExpenseReview2, formalExpensePayerRemoval4, formalExpenseCollaboration11, formalExpensePayers4 and budget-menu-layout2. Final affected6/6 peer/review rerun passed, Build/diff passed. Verified disabled input cannot focus; disabled currency popup cannot open; an existing currency popup closes on expired-own-lease peer takeover; reciprocal group locking, independent notes and release/reload remain; idle checkboxes are enabled with opacity1; excluded allocation blank; first-click participant selection commits. Inspected idle and peer-held desktop screenshots. Browser plugin absent; existing repo Playwright/static maps/PGlite used.

The old menu layout test still expected single-payer label付款人, planning取消,新增實付 and removed Source UI. Updated it to current planning付款人1, category/currency/itinerary menus and currency keyboard navigation; current width/position/scrollbar assertions remain. No removed functionality restored.

No DB/model/controller/lease TTL/financial calculation change. Local QA only for this presentation patch; original feature branch Preview delivery. Production/main and unrelated artifacts untouched.
