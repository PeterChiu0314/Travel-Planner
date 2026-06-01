# BUGS.md

Focused audit scope: routing, Realtime, draft autosave, edit locks, Demo containers, Timeline/Budget/Luggage forms, and mobile flow.

This document now separates:

* Confirmed reproducible bugs
* Risk candidates from code analysis
* UX improvement candidates
* Closed / not reproducible issues

---

# Confirmed Bugs

## BUG-018 | Active Editor Guard

Priority: P0
Status: Fixed

Description:
Editing state could be interrupted by opening another record or switching trips, allowing stale form state or drafts to appear in the wrong item or trip.

Expected:
Switching to another record or trip while an editor has unsaved changes must ask whether to save or discard. Page section changes keep draft behavior without forcing a save. Reload and tab close use the browser native leave prompt; if the user still leaves, draft restore on the next visit is allowed and is not considered saved database data.

Fix note:
Added a shared active editor guard for Timeline, Budget, Actual Expense, Luggage personal/shared forms, Accommodation, Todo, and Guide. Guarded transitions now save or discard the active editor before opening another record or switching trips, release edit locks on discard, and replace target form state instead of reusing stale state.

Verification:
Phase 1 was user verified. `npm.cmd run build` passes after Phase 2.

---

## BUG-017 | Timeline edit state contamination

Priority: P0
Status: Fixed / user verified

Description:
Switching directly from editing one Timeline card to another can keep stale form state from the previous card.

Expected:
When opening edit for another Timeline item, `editingId`, form state, draft key, and `baseUpdatedAt` must all switch to the newly selected item. Unsaved content from the previous item must not be submitted into the newly selected item.

Fix note:
`ItineraryTimeline` now flushes the current draft before switching edit targets, replaces the form state with the newly selected item data, and keeps the submit payload tied to the current form fields. Switching from A to B no longer carries A's stale form state into B.

Verification:
User verified that BUG-017 is fixed.

---

## BUG-016 | Timeline invalid time range

Priority: P1
Status: Fixed / user verified

Description:
Timeline item allows start time later than end time.

Example:

* Start: 14:00
* End: 13:00

Previous behavior:
Save succeeded incorrectly.

Expected:
End time must be later than start time.

Fix note:
The form shows a clear invalid time range message, keeps the editor open, and does not affect items without `end_time`. Invalid Timeline saves are blocked in `ItineraryTimeline.submit`, formal `saveItem`, `applyAlternative`, `reorderItem`, and Demo `saveTimelineItem`. The shared submit path reads the current time input values before calling the save callback, so local React state lag cannot bypass the validation.

Verification:
`npm run build` passes. User verified that `14:00 -> 13:00` is blocked, the editor stays open, and the invalid time range message is shown.

---

# Risk Candidates / Needs Verification

## BUG-001 | Luggage draft restore risk

Priority: P2
Status: Not reproducible currently

Original concern:
Personal/shared luggage draft restore may fail because luggage forms are always open and use `useDraftAutosave` with `isOpen: true`.

Current manual testing:

* Tab switch OK
* App switch OK
* Shared/personal switching OK
* Add/edit flow OK

Reason for keeping:
Complex form lifecycle and always-open draft logic may still contain edge-case restore issues after future refactors.

---

## BUG-002 | Budget/Actual lock release timing

Priority: P2
Status: Not reproduced

Concern:
Lock may release before all child mutations finish.

Risk:
Another collaborator could edit during partial save failure.

Notes:
Needs real multi-user testing.

---

## BUG-003 | Edit lock race condition

Priority: P3
Status: Not reproduced

Concern:
Two users may acquire the same lock during near-simultaneous edit attempts.

Notes:
Likely requires extreme timing or real concurrent sessions.

---

## BUG-004 | Realtime active edit refresh risk

Priority: P2
Status: Partial risk only

Concern:
Realtime broad reloads may create stale editing context.

Current behavior:
Local form state appears preserved during current testing.

Needs:
More multi-user testing.

---

## BUG-005 | Timeline draft restore day mismatch

Priority: P2
Status: Not verified

Concern:
New Timeline drafts are not tied to a specific day.

Needs:
Day-switch + reload testing.

---

## BUG-007 | Demo luggage flow divergence

Priority: P3
Status: Needs observation

Concern:
Demo flow may drift from formal flow over time.

Notes:
No confirmed user-facing issue currently.

---

## BUG-008 | Demo browser history desync

Priority: P3
Status: Not verified

Concern:
Browser Back/Forward may desync Demo route and visible section.

---

## BUG-009 | Demo/Form UI parity drift

Priority: P2
Status: Architectural risk

Concern:
Separate `DemoLuggageView` may drift from formal `LuggagePanel`.

Current behavior:
No major visible divergence yet.

---

## BUG-010 | Edit lock release on browser close

Priority: P3
Status: Known limitation

Current behavior:
Locks depend on timeout after abrupt tab close.

Notes:
May be acceptable during MVP stage.

---

## BUG-011 | Demo mobile nav spacing

Priority: P3
Status: UX improvement

Description:
Demo mobile bottom nav uses 5-column layout with only 3 buttons.

---

## BUG-012 | Luggage draft clearing scope

Priority: P2
Status: Not reproduced

Concern:
Saving one luggage item may clear unrelated luggage drafts.

Needs:
Multiple draft testing.

---

## BUG-013 | Realtime cross-trip reload risk

Priority: P3
Status: Not verified

Concern:
Some listeners are not trip-filtered.

Needs:
Multi-trip session testing.

---

## BUG-014 | Mobile form density

Priority: UX
Status: Improvement candidate

Description:
Timeline/Budget forms are still desktop-heavy on small screens.

---

## BUG-015 | Conflict UX clarity

Priority: UX
Status: Improvement candidate

Description:
"View latest" flow may feel abrupt and lose context.

---

# Closed / Cannot Reproduce

## BUG-006 | Shared luggage blank submit

Status: Cannot reproduce currently

Original concern:
Shared luggage could be submitted with empty title through Enter submit path.

Current testing:

* Empty title
* Enter key submit
* No item created

Result:
Issue not reproducible currently.

Keep observing after future refactors.
