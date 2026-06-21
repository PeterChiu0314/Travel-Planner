# Timeline Phase 4 Plan

Date: 2026-06-21

## Phase Name

Timeline Phase 4 - Time Flow, Transportation Pair, and Map-Ready Planning Flow

## Purpose

Timeline Phase 4 focuses on improving the practical planning flow inside the Timeline page.

This phase is not a visual layout phase. Phase 3 already stabilized the Timeline Workspace layout, Day Tabs, Day Boards, Map-expanded / Map-collapsed behavior, and Demo / Formal render parity.

Phase 4 should now improve how users continue planning a day:

- Add a transportation card at the end of a day even before the next destination is known.
- Use that trailing transportation card to suggest the next visit start time.
- Allow users to swap scheduled visit content without moving the time slots.
- Warn users when adding or editing a visit would break an existing transportation pair.
- Support local time continuation without automatically rebuilding the whole day.
- Keep untimed visits available and ordered predictably.
- Prepare the data flow for future Map / route integration without implementing Map APIs yet.

The product direction remains travel-first: the Timeline should help users plan real trips, not feel like a CRUD table or an enterprise schedule editor.

---

## Current Baseline

Previous completed stage:

```text
App Layout Phase 3.3 - Completed / User Verified
```

Known verified baseline:

- Timeline Workspace layout has been accepted in Formal and Demo.
- Map-expanded and Map-collapsed modes are visually stable.
- Day Tabs and Day Boards have working edge controls and scroll behavior.
- Visit and transportation cards share the same formal/demo card system.
- Multiline visit and transportation notes preserve line breaks.
- Demo remains isolated from Supabase, Auth, Realtime, Storage, Draft Autosave, and Edit Lock.
- Build and E2E passed in the previous closeout.

Phase 4 must start from the updated, verified baseline.

---

## Protected Scope

Do not casually modify these areas during Phase 4 unless the specific subphase explicitly requires it and a regression plan is included:

- Auth / Google OAuth
- Supabase RLS or permission helpers
- Share / invite / member flow
- Realtime subscription architecture
- Draft Autosave behavior
- Edit Lock behavior
- Budget data flow
- Attachment / Storage flow
- Broad `src/App.jsx` architecture
- Global `.panel` or `.content-grid` behavior
- Demo route isolation
- Share route privacy behavior

Phase 4 may touch Timeline behavior, but should keep every change small and targeted.

---

## Out of Scope for Phase 4

Do not implement these in Phase 4:

- Google Map API integration
- Map marker interaction
- Automatic route calculation
- Automatic route duration lookup
- AI itinerary generation
- Full-day auto scheduling
- Complex route optimization
- Custom split transportation repair UI
- A new generic drag/drop sorting architecture
- A broad schema redesign unless explicitly approved

---

## Core Timeline Rules for Phase 4

### Visit Ordering

1. Timed visits are ordered by `start_time`.
2. Untimed visits must be preserved.
3. Untimed visits do not join the formal `start_time` ordering.
4. Untimed visits use their own manual order.
5. Untimed visits do not participate in local auto-continuation.

### Transportation Pair Rules

1. Normal transportation cards connect two adjacent visits:

```text
from_item_id = A.id
to_item_id = B.id
```

2. Tail transportation cards are allowed:

```text
from_item_id = A.id
to_item_id = null
```

3. A tail transportation card represents transportation leaving the last known visit before the next destination is created.
4. Transportation duration warnings are warnings only. They must not block save.
5. Transportation cards should not become main sorting units.
6. Transportation cards should not support alternatives or flip-card behavior.

### Drag Rule

Dragging timed visits in Phase 4 does not mean normal list sorting.

For timed visits, drag should swap visit content while keeping the time slots in place:

```text
Before:
09:00 A
10:30 B
13:00 C

Drag C onto A:
09:00 C
10:30 B
13:00 A
```

The time slots stay fixed. The visit contents move.

This avoids fighting the existing `start_time` ordering model and avoids requiring a new `sort_order` field for timed visits.

### Insert / Pair Conflict Rule

If a newly added or edited timed visit would land between an existing transportation pair A -> B, the app must warn the user.

This means the conflict is caused by time ordering, not by a dedicated “insert visit between A and B” UI.

Example:

```text
Before:
09:00 A
transport A -> B
11:00 B

User adds C at 10:20.

After time sorting:
09:00 A
10:20 C
11:00 B
```

The original transportation card A -> B is no longer valid as a direct adjacent pair.

The first version should show only two choices:

- Restore
- Delete

Do not add repair choices in the first version.

### Local Auto-Continuation Rule

Local auto-continuation should only shift later timed visits.

It should:

- Start from the changed visit.
- Shift following timed visits only.
- Preserve the original gaps between visits.
- Skip untimed visits.
- Ask for confirmation.
- Not show a full preview in the first version.

---

# Phase 4.0 - Analysis and Handoff

## Goal

Create a clear working plan before modifying Timeline behavior.

Phase 4 introduces several behavior-level changes that can easily be misunderstood as generic drag/drop sorting, full auto-scheduling, or Map integration. This phase exists to prevent that.

## Scope

- Document the final Phase 4 subphase plan.
- Define the accepted behavior rules.
- Define protected areas.
- Define QA expectations.
- Clarify that Phase 4.1 and later should be implemented one small slice at a time.

## Phase 4.0 Analysis Result

Repository audit completed on 2026-06-21. No Timeline behavior was changed during this audit.

### Current Code Paths

- Shared ordering and transportation helpers are near the top of `src/App.jsx`:
  - `sortScheduleItems`
  - `sortedVisitItems`
  - `buildTransportPairState`
  - `transportPairNeedsReview`
  - `transportTimeShortageMinutes`
- Formal Timeline mutations remain in the authenticated `App` container:
  - `saveItem`
  - `deleteItem`
  - `confirmTransportWarning`
  - the legacy `reorderItem` callback
- Shared Timeline UI and editor state remain in `ItineraryTimeline`.
- Demo equivalents remain local to `DemoApp`, especially `saveTimelineItem` and `confirmTimelineTransportWarning`.
- Formal and Demo both use `sortScheduleItems` and the shared `ItineraryTimeline`, but their persistence callbacks are separate.

### Confirmed Data Findings

- `supabase/migrations/011_add_transport_card_pair_fields.sql` created `from_item_id` and `to_item_id` as nullable foreign keys.
- `supabase/migrations/012_add_transport_review_snapshots.sql` retained nullable pair anchors and changed visit deletion behavior to `on delete set null`.
- The repository schema therefore already permits a tail transportation card with `from_item_id = A.id` and `to_item_id = null`.
- No Phase 4.1 migration is expected from the repository schema alone. Before production rollout, confirm that the deployed database includes migrations 011 and 012; if production differs, add a new migration instead of editing an applied migration.
- The existing partial unique index only covers transportation rows where both pair IDs are non-null. Phase 4.1 must prevent duplicate tail cards in application logic or add a separately approved constraint only if needed.

### Confirmed Behavior Gaps and Risks

- `buildTransportPairState` currently treats every transportation card without both endpoints as invalid, so a valid `A -> null` tail card needs an explicit state and render path instead of falling into the invalid warning stack.
- `renderTransportInsert` currently requires a next visit, so it cannot open a tail transportation editor after the final visit.
- `openNewItem` currently defaults from the final item `end_time`; it does not calculate `previousVisit.end_time + tailTransport.transport_duration_minutes`.
- Both Formal and Demo save paths already normalize nullable pair IDs, but both need equivalent Phase 4.1 behavior and validation.
- `sortScheduleItems` currently places missing `start_time` values after timed visits and then uses `sort_order`. Untimed visits are preserved, but there is no separate untimed group or dedicated manual-order interaction yet.
- The former Formal `reorderItem` callback wrote `sort_order` only and was not suitable for Phase 4.2. Phase 4.2b replaces that path with destination-package swap callbacks and does not use generic sorting.
- `ItineraryTimeline` now owns the shared timed-visit drag interaction while Formal calls the transactional RPC and Demo swaps local state.
- Phase 4.2 must use an explicit allowlist of visit content fields. It must never swap IDs, `trip_id`, `day_index`, `start_time`, `end_time`, `sort_order`, fixed state, lock state, timestamps, or transportation pair anchors.
- Alternatives and linked budgets are separate records keyed by itinerary item ID. Phase 4.2a confirmed that both relationships belong to the destination package and must move with it. Formal therefore requires an approved transactional RPC / migration; do not implement the swap as independent browser updates. See `docs/gpt/2026-06-21-phase-4-2-destination-package-analysis.md`.
- Any Phase 4 action that can change multiple rows must preserve optimistic conflict handling, active editor protection, draft cleanup, and Realtime safety in Formal while keeping Demo local-only.

## Deliverable

This document is the canonical Phase 4 analysis and handoff:

```text
docs/gpt/timeline-phase-4-plan.md
```

Optionally also copy a shorter status summary into `CURRENT_TASK.md` after the plan is accepted.

## Notes for Codex

- Do not start implementing multiple Phase 4 features at once.
- Do not convert drag into normal sorting.
- Do not introduce Google Map or route APIs.
- Do not silently delete transportation cards.
- Keep Demo behavior aligned with Formal behavior.

---

# Phase 4.1 - Tail Transportation Card + New Visit Default Time

## Goal

Allow users to add a transportation card after the last known visit of the day, even before the next destination exists.

This supports real planning behavior: users may know they need 30 minutes of transportation after a stop before they decide the next exact destination.

## Main Behavior

A tail transportation card may exist with:

```text
from_item_id = previousVisit.id
to_item_id = null
```

When the next visit is created after that previous visit, the new visit form should use a default start time:

```text
newVisit.start_time = previousVisit.end_time + transportationDuration
```

Example:

```text
10:00 - 11:00 清水寺
transportation: 25 minutes

New visit default start_time = 11:25
```

## Rules

- Tail transportation is allowed only where there is no known next visit yet.
- `to_item_id` may temporarily be `null`.
- Tail transportation should not block saving.
- Transportation time shortage remains warning-only.
- No route calculation is introduced.
- No Google Map API is introduced.
- New visit default time is a convenience default, not forced.
- Users can still change the suggested time manually.

## UX Requirements

- Tail transportation should be visually treated as transportation, not as a visit.
- It should be quieter than a visit card.
- It should communicate that the destination is not set yet.
- The new visit form should feel assisted, not automated.

## Data / Technical Notes

Repository migrations 011 and 012 already define `to_item_id` as nullable. The implementation must still confirm the deployed database is on that migration baseline.

If schema change is needed:

- Use a new migration.
- Do not edit old applied migrations.
- Update RLS or constraints only as needed.
- Keep Demo local state behavior equivalent.

The first implementation should prefer the existing nullable pair model and should not add a migration unless the deployed schema proves that one is required.

## Validation

- Can create a tail transportation card after the last timed visit.
- Tail transportation remains visible and understandable.
- Creating the next visit suggests the correct `start_time`.
- User can override the suggested start time.
- Demo `/demo/timeline` supports the same flow locally.
- Formal app saves and reloads correctly.
- No Supabase/Auth/Realtime/Draft/Edit Lock calls appear in Demo.

---

# Phase 4.2 - Drag Visit Content Swap

## Goal

Support intuitive rearrangement of timed visit content without moving the time slots.

This is not generic drag/drop sorting.

## Main Behavior

When a user drags one timed visit onto another timed visit, swap the visit contents while preserving the time slots.

Example:

```text
Before:
09:00 - 10:00 A
10:30 - 11:30 B
13:00 - 14:00 C

After dragging C onto A:
09:00 - 10:00 C
10:30 - 11:30 B
13:00 - 14:00 A
```

The `start_time` and `end_time` slots do not move.

## Rules

- Only timed visits participate in this first drag-swap flow.
- Transportation cards are not draggable.
- Dragging does not change time slots.
- Dragging must not update `start_time` or `end_time`.
- Dragging should not cause transportation pair invalidation.
- If transportation card context changes because the upper/lower destinations changed, show a normal transportation warning.
- Fixed visits should not be draggable.
- Fixed visits should not be valid swap targets unless explicitly redesigned.
- Active editor must be resolved before drag-swap.
- If any Timeline editor is active, drag-swap must not begin. The user must save or discard through the existing active-editor guard first.
- Do not implement the old `sort_order` callback as the Phase 4.2 behavior.
- Do not add a new `sort_order` field or a generic drag/drop sorting architecture.

The exact visit-content field allowlist and child relationship behavior are defined in `docs/gpt/2026-06-21-phase-4-2-destination-package-analysis.md`. Alternatives and linked budgets move with the destination package through the approved transaction in `supabase/migrations/019_swap_itinerary_destination_packages.sql`.

## Important Distinction

Do not implement this as:

```text
Move card C before card A while keeping C's original time.
```

That would conflict with `start_time` sorting and may revert on reload.

Implement conceptually as:

```text
Time slots stay. Visit contents swap.
```

## Transportation Handling

The goal is that drag-swap does not create invalid pair state.

If the transportation card remains in the same visual gap but the origin/destination labels change, the card may need a warning such as:

```text
交通資訊可能需要重新確認
```

This is a normal transportation warning, not a hard error.

## Validation

- Timed visit content swaps correctly.
- Time slots remain unchanged.
- Fixed cards are protected.
- Transportation cards do not become draggable.
- Active editor blocks or resolves before swap.
- Demo and Formal behavior match.
- Existing save/edit/delete behavior still works.

---

# Phase 4.3 - Timed Visit Breaks Existing Transportation Pair Prompt

## Goal

Warn users when a newly added or edited timed visit lands between an existing transportation pair.

This protects transportation card meaning when time ordering changes.

## Main Behavior

If a user adds or edits a timed visit and the result places that visit between an existing adjacent transportation pair A -> B, show a prompt.

Example:

```text
Before:
09:00 - 10:00 A
transport A -> B
11:00 - 12:00 B

User adds:
10:20 - 10:50 C

After sorting by time:
09:00 - 10:00 A
10:20 - 10:50 C
11:00 - 12:00 B
```

The existing transportation pair A -> B has been broken by the new time position.

## Prompt Buttons

First version only supports:

- Restore
- Delete

Suggested meaning:

- Restore: cancel the add/edit result that caused the pair break and return to the previous state.
- Delete: keep the visit add/edit result and delete the existing A -> B transportation card.

## Explicitly Not Included

Do not add these in the first version:

- Convert A -> B into A -> C.
- Convert A -> B into C -> B.
- Split into A -> C and C -> B.
- Automatically calculate route duration.
- Show complex repair UI.
- Add a dedicated “insert visit between two cards” UI unless separately approved.

## Validation

- Adding a timed visit between A and B triggers the prompt.
- Editing an existing visit time into A/B also triggers the prompt.
- Restore returns to the previous safe state.
- Delete removes the broken transportation card and keeps the visit change.
- No silent deletion occurs.
- Demo and Formal behavior match.

---

# Phase 4.4 - Local Auto-Continuation Time Adjustment

## Goal

Allow users to locally shift following timed visits after changing a visit time, while preserving the original gaps.

This improves schedule editing without turning Timeline into a full auto-scheduler.

## Main Behavior

When a visit time changes and later timed visits may need to move, ask whether to shift later timed visits.

The shift should preserve original gaps.

Example:

```text
Before:
09:00 - 10:00 A
10:30 - 11:30 B
13:00 - 14:00 C

A changes to:
09:00 - 10:30 A

After local auto-continuation:
09:00 - 10:30 A
11:00 - 12:00 B
13:30 - 14:30 C
```

The original 30-minute gap between A and B is preserved. The original 90-minute gap between B and C is preserved.

## Rules

- Only later timed visits are shifted.
- Untimed visits are not involved.
- The first version must ask for confirmation.
- The first version does not need a full preview.
- Transportation duration shortage is still warning-only.
- Existing time validation must remain active.
- Same-day overlap protection must not be bypassed.

## UX Requirements

The prompt should be simple:

```text
是否要順延後續行程？系統會保留原本行程間隔。
```

Avoid complex scheduling language.

## Validation

- Shifts later timed visits only.
- Preserves original gaps.
- Does not move earlier visits.
- Does not move untimed visits.
- Does not bypass invalid time range validation.
- Does not bypass same-day overlap protection.
- Demo and Formal behavior match.

---

# Phase 4.5 - Untimed Visit Ordering Rules

## Goal

Allow same-day timed and untimed visits to coexist predictably.

Users often know they want to visit a place but have not decided the time yet. Timeline should preserve these visits instead of forcing a time too early.

## Main Behavior

Timed visits and untimed visits use separate ordering rules.

```text
Timed visits:
order by start_time

Untimed visits:
order by manual order
```

Untimed visits should not be mixed into the formal `start_time` order in the first version.

## Recommended Display Model

Use two clear groups inside a Day Board:

```text
Timed itinerary
09:00 A
10:30 B
13:00 C

Untimed / not scheduled yet
D
E
F
```

The exact UI wording can be adjusted, but the behavior should stay clear.

## Rules

- Untimed visits remain visible.
- Untimed visits belong to the selected day.
- Untimed visits are manually ordered within the untimed group.
- Untimed visits do not participate in local auto-continuation.
- Untimed visits should not break transportation pair logic.
- Untimed visits should not be treated as transportation endpoints unless separately designed.

## Data / Technical Notes

Manual order for untimed visits may require checking current data shape.

If a persistent manual order field is needed, do not add it casually. First document the need and migration implications.

A safe first version may use existing stable creation order if no manual order field is approved, but this should be explicitly documented as a limitation.

## Validation

- Timed visits still sort by `start_time`.
- Untimed visits remain visible.
- Untimed visits do not appear randomly among timed visits.
- Untimed visits keep a stable order.
- Untimed visits are skipped by auto-continuation.
- Demo and Formal behavior match.

---

# Phase 4.6 - Map Integration Preparation

## Goal

Prepare Timeline behavior and data meaning for future Map integration without implementing Map APIs.

Phase 4 should make the Timeline data flow map-ready:

- Visit cards represent destinations.
- Transportation cards represent movement between destinations.
- Tail transportation cards represent movement leaving a destination before the next destination is known.

## Future Map-Ready Meaning

Normal pair:

```text
A -> B
```

Future Map can use this to show:

- A marker
- B marker
- route segment
- transport mode
- expected duration

Tail pair:

```text
A -> null
```

Future Map can use this to support:

- choose next destination from map
- create next visit from route context
- carry transportation duration into next visit default time
- show pending route continuation

Untimed visits remain destination candidates for a future Map, but they are not formal route endpoints and do not participate in automatic route sequencing until a later phase explicitly defines that behavior.

Transportation warnings remain Timeline review state. Future Map UI may surface that state, but Phase 4.6 must not calculate, repair, or redraw routes from warnings.

## Explicitly Not Included

Do not implement:

- Google Maps API
- route calculation
- marker selection
- route drawing
- location autocomplete
- map-first route planning

## Deliverable

A short design note may be added after Phase 4.1–4.5 are stable, for example:

```text
docs/gpt/2026-06-21-timeline-phase-4-map-prep.md
```

This is optional unless the project needs a handoff before Phase 5.

## Validation

- Transportation data meaning is clear.
- Tail transportation behavior is documented.
- No Map API code is added.
- Future Phase 5 can build from the established pair model.

---

# Phase 4.7 - QA and Handoff

## Goal

Verify Phase 4 changes do not regress the core Timeline, Demo, Draft, Edit Lock, and collaboration behaviors.

## Required Build / Static Checks

Run:

```bash
npm.cmd run build
```

Run when route, demo, share, app shell, or broad Timeline render paths are touched:

```bash
npx.cmd playwright test
```

Run when practical:

```bash
git diff --check
```

## Formal Timeline Manual QA

Check:

- Add timed visit.
- Add untimed visit.
- Edit visit time.
- Delete visit.
- Add normal transportation card.
- Add tail transportation card.
- Add next visit after tail transportation card.
- Verify suggested start time.
- Edit transportation duration.
- Confirm transportation shortage warning remains warning-only.
- Lock and unlock fixed visit.
- Confirm fixed visit protections remain intact.

## Phase 4 Feature QA

### Tail Transportation

- Tail transportation can exist with no `to_item_id`.
- Tail transportation appears in the right place.
- New visit after tail transportation receives correct default start time.
- User can override suggested time.

### Drag Content Swap

- Dragging timed visits swaps content, not time slots.
- Transportation pair does not become invalid because of drag.
- Transportation warning appears when content context may need review.
- Fixed visits are protected.

### Pair Break Prompt

- Adding a timed visit between A and B prompts Restore / Delete.
- Editing a visit time into A/B prompts Restore / Delete.
- Restore safely cancels the change.
- Delete safely removes the affected transportation card.

### Local Auto-Continuation

- Confirmation appears before shifting later visits.
- Later timed visits shift correctly.
- Original gaps are preserved.
- Untimed visits do not move.
- Time validation remains active.

### Untimed Visits

- Untimed visits remain visible.
- Untimed visits are grouped or otherwise clearly separated from timed ordering.
- Untimed order is stable.
- Untimed visits do not participate in auto-continuation.

## Draft / Edit Lock / Realtime QA

- Active editor blocks risky actions or asks user to resolve edit first.
- Unsaved edits are not lost during tab or section switch.
- Save closes form and clears draft.
- Cancel releases edit lock after confirmed discard.
- Realtime refresh does not overwrite an active form.
- Reload restore still returns to the active trip, section, and Timeline day.

## Demo QA

Demo must remain local-only.

Check:

- `/demo/timeline` loads without login.
- Demo banner remains visible.
- Demo supports the relevant Phase 4 Timeline interactions using local React state.
- Demo refresh resets to mock data.
- Demo does not call Supabase.
- Demo does not use Auth.
- Demo does not use Realtime.
- Demo does not use Storage.
- Demo does not use Draft Autosave.
- Demo does not use Edit Lock.

## Handoff Requirements

At the end of Phase 4, update:

- `CURRENT_TASK.md`
- A final QA / handoff note under `docs/gpt/`

Suggested file:

```text
docs/gpt/2026-06-21-timeline-phase-4-final-qa-handoff.md
```

The handoff should include:

- Completed subphases
- Changed files
- Build / test results
- Demo QA result
- Formal QA result
- Known limitations
- Recommended next step toward Map integration

---

## Recommended Implementation Order

Use this practical branch and dependency order:

1. Phase 4.0 - Analysis and Handoff
2. Phase 4.1 - Tail Transportation Card + New Visit Default Time
3. Phase 4.2 - Drag Visit Content Swap
4. Phase 4.5 - Untimed Visit Ordering Rules
5. Phase 4.3 - Timed Visit Breaks Existing Transportation Pair Prompt
6. Phase 4.4 - Local Auto-Continuation Time Adjustment
7. Phase 4.6 - Map Integration Preparation
8. Phase 4.7 - QA and Handoff

Reason:

- The current branch is intentionally limited to Phase 4.0, Phase 4.1, and Phase 4.2.
- Tail transportation is the foundation of later route flow.
- Drag content swap remains isolated from generic ordering and must not pre-implement Phase 4.3 through Phase 4.5.
- Untimed visit rules must be stabilized before pair-break prompts and local auto-continuation because both depend on formal timed ordering.
- Pair-break prompts should be stable before local time adjustment.
- Map preparation should summarize the stabilized behavior instead of leading implementation.

---

## One-Sentence Phase 4 Definition

Timeline Phase 4 separates scheduled time flow from travel movement: timed visits keep the formal schedule, untimed visits remain as manually ordered planning items, transportation cards describe movement between stops, tail transportation supports the next destination flow, and drag-swap changes visit content without moving time slots.
