# BUGS.md

Focused audit scope: routing, Realtime, draft autosave, edit locks, Demo containers, Timeline/Budget/Luggage forms, and mobile flow.

This document now separates:

* Confirmed reproducible bugs
* Risk candidates from code analysis
* UX improvement candidates
* Closed / not reproducible issues

---

# Confirmed Bugs

## BUG-030 | Ordinary JWT Trip cascade loses Budget lease authorization

Priority: P1
Status: Closed — Staging Forward committed / true Auth-PostgREST HTTP7/7 passed
Discovered: 2026-10-31

**Latest 2026-10-31:** explicitly authorized exact20261031140648 Source/wrapper committed on Staging, ledger63→64. Fresh read-only body/attributes/catalog/38functions/28original fingerprints and sevenOFF verified. Ordinary owner JWT Trip DELETE now succeeds with Budget/Actual/participant/Baseline graph; Budget/Actual deletes, peer lease refusal, nonmember/anon isolation and real409/PT409 also pass (7 targeted HTTP cases). Two new and exactly two prior failed-run QA trips normally removed; four QA sync signals retained without forced cleanup, older QA Baseline preserved. Advisor no new unresolved P0/P1. [Deployment and real-service closure](2026-10-31-bug030-staging-deployment.md). Historical failure/local-only evidence follows; it is superseded for this Staging defect.


After approved guard_incomplete_child Forward committed (ledger63), individual Budget/Actual deletes cascade correctly. An approved owner JWT DELETE of a fresh QA Trip still returns403/42501 Forbidden. Managed PostgreSQL context confirms FK DELETE budget_items -> guard_budget_edit_lease line26 -> assert_budget_edit_lease line11 at can_edit_trip; approved_trip_role reads trip_members during the parent/membership cascade. Privileged native cases bypass this when auth.uid is null, so prior15/15 did not cover this real-user boundary. Failed transaction retains both parent/child graphs and Baselines; no orphan rows or forced cleanup. Further Hosted writes stopped; other requested negative/PT409 tests blocked. Only read-only diagnosis done, no extra function/RLS/grant changes. Subsequent local candidate20261031140648 reproduces the ordinary-role42501, then passes22/22 targeted native cases using a private transaction-bound admission and pre-delete permission/lease/row locks. It preserves both existing function attributes and all prior financial/RLS/latch boundaries. No Hosted access in that local follow-up; real Trip HTTP failure remains open pending exact-artifact Review, separate Staging authority and post-deployment HTTP. [Local fix/22case evidence](2026-10-31-budget-b7-trip-cascade-local-repair.md). [Deployment, runtime context and retained QA](2026-10-31-budget-b7-cascade-deployment.md).

---

## BUG-029 | Cold Budget INSERT Realtime delivery absent in Staging service acceptance

Priority: P1
Status: Fixed locally / real Staging service regression passed / frontend not deployed
Discovered: 2026-10-31

The two original failures were caused by treating Phoenix JOIN/SUBSCRIBED as Postgres Changes readiness. Real wire controls show asynchronous system readiness arriving after the first committed insert. Waiting for extension=postgres_changes/status=ok makes both real JWT clients receive RPC/REST INSERT across INSERT/* and filtered/unfiltered variants; six targeted service cases pass, including UPDATE/rejoin/unsubscribe/nonmember isolation. The old Runner now uses this gate; the local product also catches up via its guarded Budget reader when CDC becomes ready. Two local tests and Build pass. No Hosted publication/RLS/Grant or Timeout workaround; no frontend deployment or full UI acceptance claimed. [Root cause and evidence](2026-10-31-budget-b7-p1-repair-review.md).

---

## BUG-028 | Dormant participant Guard rejects normal parent FK cascade

Priority: P1
Status: Closed on Staging — participant Forward plus BUG-030 verified Budget/Actual/Trip HTTP
Discovered: 2026-10-31

Latest: the later separately authorized BUG-030 Forward and ordinary-JWT7/7 regression resolve the downstream Trip authorization failure too; ledger64, guard_incomplete_child body unchanged, original data/protocol fences preserved. Hosted Incomplete negative fixture remains pending; prior native boundary evidence is not called new HTTP. [Final scoped deployment report](2026-10-31-bug030-staging-deployment.md). The next paragraph records the earlier checkpoints.


Deleting a QA trip with a Budget participant returns55000 because the child's BEFORE DELETE trigger queries a parent already removed by the FK cascade, interprets it as incomplete and requires validated Pricing. Both real Staging runs reproduce this with all protocols OFF. A non-auto-apply, exact-body-hash draft restores only DELETE with an absent parent before any financial/lifecycle/receipt activation; existing incomplete parents and activated/paused parent protection remain guarded. Fifteen native cases pass: the original eight plus strict child UPDATE/DELETE, three paused-latch fences, protocol concurrency, full-source ledger/repeat/collision/version and atomic rollback boundaries. New full source preserves exact function hashes and properties. After the authorized21:01 local continuation, official CLI2.106.0 issued 20261031130414 later than head20261031130000; exact full source/wrapper and actual-version15/15 native regression pass. Earlier time-blocked/unfinished CLI attempts remain historical; no clock/version fabrication. Later explicitly authorized Forward committed to Staging (ledger63); Budget/Actual child cascades pass real HTTP. Whole Trip DELETE remains42501 in a different legacy lease/membership guard, tracked as BUG-030; this P1 is not closed. Old sources remain unchanged. [Source, official version and scope](2026-10-31-budget-b7-p1-repair-review.md).

---

## BUG-027 | Transport-aware continuation bypasses the five-minute Timeline ceiling

Priority: P0
Status: Fixed / Production verified / branch unmerged
Discovered: 2026-08-11

Description:
After Phase 6 made normal-pair transportation participate in automatic scheduling, the next destination started at the exact preceding end plus transport duration. For example, `16:10 + 8` produced `16:18` instead of the established five-minute ceiling `16:20`.

Expected:
Only an automatically calculated next-visit start is rounded upward to the next five-minute Timeline boundary. Stored transport duration remains exact, destination duration is preserved, exact boundaries stay unchanged, and explicit user anchors are not rounded.

Fix note:
The JavaScript Planner and authoritative SQL Planner now use the same five-minute ceiling for automatic continuation and earlier-conflict guidance. Migration `20260811133000_timeline_phase_6_restore_five_minute_ceiling.sql` adds a private immutable helper without changing any applied migration or stored transportation duration.

Verification:
Staging and Production authoritative RPC fixtures produced A `15:10-16:10`, B `16:20-17:20`, and C `17:30-18:00` across 8- and 7-minute transports while retaining `[8,7]`. Both fixture transactions rolled back; the Production follow-up query confirmed 0 retained rows. Focused Planner/RPC tests passed 50/50, the broader Phase 6/reorder/Untimed/transport regression passed 100/100, and Production `public/app_private` error-level schema lint passed. Migration history aligns through `20260811133000`; the hotfix branch intentionally remains unmerged to `main`.

---

## BUG-026 | Timeline reorder transport remap can hit a temporary unique-pair collision

Priority: P0
Status: Fixed / Production verified
Discovered: 2026-08-11

Description:
Moving a timed destination to the bottom of a Day with multiple preserved adjacent transport pairs could make the Phase 6 RPC update one transport endpoint pair onto a pair still temporarily occupied by another row. The immediate unique index rejected the intermediate state and rolled back the complete reorder.

Expected:
The atomic reorder may pass through temporary endpoint collisions, but its final transport pairs must remain unique. Failure must never leave a partially applied Day.

Fix note:
Migration `20260811124500_timeline_phase_6_defer_transport_pair_uniqueness.sql` replaces the immediate transport-pair index with a deferred unique constraint. The existing Day advisory lock, deterministic row locks, authoritative server replan, and atomic transaction remain unchanged.

Verification:
Staging and Production authoritative RPC fixtures A/B/C/E with B-to-C and C-to-E passed when A moved to the bottom. Both final pairs were unique, a deliberately duplicated final pair was rejected, and both fixture transactions rolled back with 0 retained rows. Static RPC tests passed 11/11, the focused regression passed 96/96, rendered Demo drag/editor regressions passed 2/2, Production schema lint passed, and the Production build passed.

---

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

## BUG-025 | Timeline foreign drag presence may clear by stale timeout

Priority: Low
Status: Known Issue / does not block Phase 4.8e
Discovered: 2026-07-01

Description:
During collaborative Timeline drag testing, foreign drag presence can still occasionally fail to clear immediately on the remote client after the local user drops or cancels a drag. When this happens, the remote same-day read-only state remains visible until the 12 second stale timeout clears it automatically.

Current impact:
This is a transient collaboration UI/presence issue only. It does not affect data correctness, persisted reorder results, RPC behavior, migrations, or Timeline item contents.

Current mitigation:
Phase 4.8c has already added immediate `onDragEnd` / cancel drag clear behavior, including local drag cleanup and `timeline-drag-clear` broadcast before confirmation or RPC flows. The stale timeout still provides a fallback if the remote client misses the clear.

Next step:
Do not block Phase 4.8e. If the frequency increases, investigate broadcast clear reliability, channel lifecycle, and `dragId` / `sessionId` matching around repeated drag sessions.

---

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

## BUG-024 | npm audit reports vite/esbuild vulnerability

Priority: Security backlog
Status: Backlog

Description:
`npm audit` reports a vite/esbuild vulnerability after Playwright setup.

Decision:
Do not run `npm audit fix --force` during Phase 1.7F because it would upgrade to Vite 8 and may introduce breaking changes.

Next step:
Plan a dedicated dependency upgrade pass with Vite migration testing.

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
