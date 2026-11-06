# Pending membership read admission and notification

User screenshot: pending trip membership displayed an inline request banner and raw Forbidden error in Budget.

## Cause and fix

App already knew membership was pending but full-trip loading, budget event/recovery refresh and legacy metadata activation could still attempt approved-only data. The expense snapshot correctly refuses these reads (42501). The error was then passed to the existing global sync Toast.

Confirmed approved membership now gates protected full-trip, Budget and luggage reads. Pending/unknown membership clears in-memory trip data instead of reading/rehydrating private cache. A membership context fences late results when membership changes, in addition to the existing account/trip generation guard. Membership changes rerun the full loader, so approval restores data without reload. Native and legacy Budget activation respect membership; owner/editor/viewer backend permissions remain unchanged.

Removed the inline pending banner. App emits the same message through existing notify.info/Sonner once per account/trip pending transition, using a stable Toast ID. Approval/departure dismisses it; ordinary rerenders/section navigation do not repeat it. Removed the earlier separate invite-success message to avoid two notices for the same event. Sidebar waiting-for-approval status remains.

Actual raw42501 Forbidden/permission-denied copy is translated to Chinese. Existing localized validation/permission messages and real error/recovery behavior remain.

## Validation

31 distinct Chromium cases passed: pending load/focus/online/reload has zero protected expense RPCs and no error Toast; single info Toast/no banner; approval loads data; revocation clears data/stops reads; pre-revocation financial response cannot restore rows. Existing formalExpenseWorkspace, formalBudgetSync, formalLuggageSync and notification suites passed. Initial broad auth-copy translation changed an existing localized message; narrowed translation to raw technical copy, then the affected sync-recovery case passed. Build/diff passed; existing bundle warning unchanged.

Local isolation only at initial delivery. No schema/RPC/migration or membership mutation on Hosted. Preview delivery on original branch; Production/main untouched.
