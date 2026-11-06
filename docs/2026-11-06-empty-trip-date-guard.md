# Empty trip date change falsely blocked by clean editor guards

## Cause

`updateTripDateRange` used `hasActiveEditorGuard`, meaning any registered guard blocked date changes. Native ExpenseWorkspace and ExpenseRates keep guards registered while mounted, including a clean empty workspace. Registration indicates participation in handoff/cleanup, not unsaved input. Thus an empty trip hit the unsaved-edit refusal before apply_trip_date_change.

## Minimal correction

Date admission now checks the existing `getDirtyActiveEditorGuards` instead. Real dirty Budget input, pending/unknown requests and busy Rates still set isDirty and block. The separate persisted-draft check, owner/settlement checks, date validation, shortening preview/confirmation and transactional apply_trip_date_change path are unchanged. No change to guard registration, handoff, navigation, Timeline drag or database behavior.

## Evidence

Before correction, an empty native workspace with initialized quotes and zero expense rows submitted valid date text but produced0 apply_trip_date_change calls. After the one-line correction, it produced exactly1 call and refreshed the displayed dates. Test input is committed with normal blur before Save, as date drafts require.

12/12 local Chromium cases passed: formalTripDateGuard3, formalExpenseCreation5 and formalExpensePayerRemoval4. New cases cover clean empty workspace success, unnamed substantive draft refusal/input preservation, and unknown create receipt refusal with exact request identity retained. Existing create/autosave/navigation/deletion protection passed. Build/diff Passed; existing bundle warning unchanged.

Date RPC is intercepted by the isolated browser fixture to capture the exact unchanged arguments and project the resulting trip dates. This proves frontend admission and UI refresh, not Hosted database date-change transaction execution. Existing SQL/RPCs/migrations and real trip dates untouched. Original feature-branch Preview delivery only; Production/main untouched.
