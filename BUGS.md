# BUGS.md

Focused audit scope: routing, Realtime, draft autosave, edit locks, Demo containers, Timeline/Budget/Luggage forms, and mobile flow.

This document now separates:

* Confirmed reproducible bugs
* Risk candidates from code analysis
* UX improvement candidates
* Closed / not reproducible issues

---

# Confirmed Bugs

## BUG-017 | Timeline edit state contamination

Priority: P0
Status: Confirmed

Description:
Switching directly from editing one Timeline card to another can keep stale form state from the previous card.

Expected:
When opening edit for another Timeline item, `editingId`, form state, draft key, and `baseUpdatedAt` must all switch to the newly selected item. Unsaved content from the previous item must not be submitted into the newly selected item.

---

## BUG-016 | Timeline invalid time range

Priority: P1
Status: Fixed

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
Run `npm run build`; manually test invalid equal/reversed ranges, valid ranges, empty `end_time`, edit mode, and `/demo/timeline`.

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
