# BUGS.md

Focused audit scope: routing, Realtime, draft autosave, edit locks, Demo containers, Timeline/Budget/Luggage forms, and mobile flow.

This document now separates:

* Confirmed reproducible bugs
* Risk candidates from code analysis
* UX improvement candidates
* Closed / not reproducible issues

---

# Confirmed Bugs

## BUG-023 | Timeline same-day item times can overlap

Priority: P1
Status: Fixed / user verified
Discovered: 2026-06-09

Location:
Timeline / Day Board / itinerary card time editing

Description:
Timeline currently validates only a single itinerary card's own time range (`end_time > start_time`). It does not check whether different cards on the same day overlap, so one itinerary item's time can cover another item's time.

Example:

```text
A: 07:00 ~ 11:45
B: 07:30 ~ 09:30
```

Expected:
Same-day Timeline itinerary items should not be allowed to save overlapping time ranges.

Fix note:
Timeline visit saves now reject same-day visit overlaps using `newStart < otherEnd && newEnd > otherStart`, excluding transportation cards and the item currently being edited. The Timeline editor keeps the form open and shows the overlapping item label and time range. Demo `/demo/timeline` uses the same overlap check.

Verification:
`npm.cmd run build` passes. User verified BUG-023 is fixed.

---

## BUG-022 | Only one active editor allowed per trip

Priority: P1
Status: Fixed / user verified

Description:
Multiple page editors could remain active inside the same trip after switching sections, making later trip switches, reload restore, draft restore, and save guard behavior ambiguous.

Expected:
Only one active editor context should be allowed per user and trip. Switching pages may keep the existing editor/draft without prompting, but opening another editor in Timeline, Budget, Actual Expense, Accommodation, Todo, Guide, or Luggage must first resolve the existing active editor with Save or Discard.

Fix note:
Scoped editor guards now support same-trip handoff before opening another editor. Section panels stay mounted while hidden so active editor guards remain registered across page switches, and inactive section draft restore is gated to avoid restoring multiple editors at once.

Verification:
`npm.cmd run build` and `git diff --check` pass. User verified BUG-022 is fixed.

---

## BUG-021 | Reload loses active trip/page context

Priority: P1
Status: Fixed / user verified

Description:
Reload/F5 could reopen the app on a different trip, section, Timeline day, or Luggage tab than the user was viewing before refresh.

Expected:
Reload should restore the last available active trip first, then restore the active section, Timeline active day, and Luggage personal/shared tab from local browser session context. If the stored trip no longer exists or is unavailable, the app should fall back to the first available trip.

Fix note:
Added local session context restore for active trip, active section, Timeline day, and Luggage tab without changing draft restore, editor guard, conflict handling, Realtime, or Supabase schema.

Verification:
`npm.cmd run build` and `git diff --check` pass. User verified BUG-021 is fixed.

---

## BUG-020 | Restored edit draft conflict after trip switch

Priority: P1
Status: Fixed / user verified

Description:
Restored edit drafts can lose active guard behavior or keep a stale optimistic-lock baseline after reload and trip switching, causing missing save/discard prompts or false conflict messages when saving unchanged server records.

Expected:
Reload should prefer the trip that owns the latest unfinished edit draft when available. Restored edit drafts must be treated as active unsaved edits, must prompt before trip switching, and must use the current server `updated_at` as the save baseline unless another user actually changed the record.

Fix note:
Restored edit drafts now remain under active editor guard, reuse the current server `updated_at` baseline for existing items, and clear the correct draft after successful save.

Verification:
User verified BUG-020 is fixed.

---

## BUG-019 | Draft restore cross-trip contamination

Priority: P0
Status: Fixed / user verified

Description:
Draft restore and active editor state could survive a trip switch, allowing a draft from trip A to appear in trip B or be saved into the wrong trip.

Expected:
Draft restore must be scoped to the draft key trip id and current active trip. Switching trips must clear active editor state without deleting drafts from the previous trip. Save callbacks must reject cross-trip editing contexts before writing to Supabase.

Fix note:
Draft restore now explicitly validates the draft key user, trip, and entity scope. Timeline, Budget, Actual Expense, Accommodation, Todo, Guide, and Luggage editor state is cleared when the active trip changes without deleting the previous trip draft. Save callbacks now receive trip context and reject mismatches; update mutations also constrain by `trip_id`.

Verification:
`npm.cmd run build` passes. User verified BUG-019 is fixed.

---

## BUG-018 | Active Editor Guard

Priority: P0
Status: Fixed / user verified

Description:
Editing state could be interrupted by opening another record or switching trips, allowing stale form state or drafts to appear in the wrong item or trip.

Expected:
Switching to another record or trip while an editor has unsaved changes must ask whether to save or discard. Page section changes keep draft behavior without forcing a save. Reload and tab close use the browser native leave prompt; if the user still leaves, draft restore on the next visit is allowed and is not considered saved database data.

Fix note:
Added a shared active editor guard for Timeline, Budget, Actual Expense, Luggage personal/shared forms, Accommodation, Todo, and Guide. Guarded transitions now save or discard the active editor before opening another record or switching trips, release edit locks on discard, and replace target form state instead of reusing stale state.

Verification:
Phase 1 and Phase 2 were user verified. `npm.cmd run build` passes.

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
