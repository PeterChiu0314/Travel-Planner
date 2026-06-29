# Timeline Phase 4.6 新聊天室 Handoff corrected

Date: 2026-06-28
Project: 旅程規劃室 / Travel Planner
Next target: Timeline Phase 4.6 — Timed Visit Drag Auto-Continuation

---

## 1. Current status

Timeline has completed Phase 4.5b / 4.5c implementation locally.

Current branch/worktree status reported by user:

- Phase 4.5b Transportation Role Model completed.
- Phase 4.5c Mixed Drag Target / Prompt Cleanup completed.
- Latest known full validation before the final untimed-insertion adjustment:
  - `npm.cmd run build` passed, with only existing Vite large chunk warning.
  - targeted Playwright passed.
  - full E2E passed.
  - `git diff --check` passed, with only Windows LF/CRLF notice.
  - `test-results/` cleaned.
- A final 4.5c adjustment was then completed:
  - Untimed visit can now be dropped into an existing `normal_pair` / `tail_promoted_pair` gap.
  - It shows the same transport removal confirmation as timed drag.
  - On confirm, the untimed card moves and affected transports in `plan.brokenTransportIds` are deleted.
  - Formal and Demo save logic now delete broken transports by `plan.brokenTransportIds`, not only by transports directly connected to the dragged untimed card.
- Unless the user later confirms otherwise, run a quick final validation after this last adjustment before committing.

Suggested final validation before commit:

```text
npm.cmd run build
npx.cmd playwright test phase-4-5-untimed-ordering phase-4-3-transport-conflict
npm.cmd run test:e2e
git diff --check
```

Current changes are not yet committed/pushed unless the user says otherwise.

---

## 2. Key completed implementation notes

### Phase 4.5b — Transportation Role Model

New migration:

```text
supabase/migrations/022_add_transport_role_to_itinerary_items.sql
```

Adds:

```text
transport_role
```

Backfill rule:

```text
to_item_id is null     -> tail_pending
to_item_id is not null -> normal_pair
```

New helper:

```text
src/lib/timelineTransportationRoles.js
```

Transport roles:

```text
normal_pair
tail_pending
tail_promoted_pair
```

Implemented behavior:

- `tail_pending -> tail_promoted_pair`
- `tail_promoted_pair -> tail_pending`
- `normal_pair` only uses Phase 4.3 Restore/Delete conflict prompt.
- `tail_promoted_pair` still protects its gap and can be broken only with confirmation.
- `tail_pending + untimed` is valid; it shows passive warning, not invalid.
- If a timed card already has passive transport after it, do not render the add-tail-transport hover and do not allow opening the add-tail-transport form.
- Tail untimed edit form start time auto-prefill is done:
  - When editing an untimed visit after `tail_pending`, prefill start time as previous timed visit end time + tail transport duration.
  - This is form/draft prefill only; it should not write to DB until user saves complete times.

### Phase 4.5c — Mixed Drag Target / Prompt Cleanup

Implemented behavior:

- Drag/drop target is based on the full mixed visual list, not only the timed list.
- Timed and untimed visits can be dropped above/below each other.
- Untimed visits can exist at head, middle, or tail.
- Time calculation still only uses timed visits.
- No-transport/no-op drag path should not show confirmation.
- If the mixed visual reorder breaks `normal_pair` / `tail_promoted_pair`, show transportation removal confirmation.
- `planMixedTimedVisitReorder` compares before/after mixed visual order and returns `brokenTransportIds`.
- Timeline drop path merges `brokenTransportIds` into reorder confirmation.
- Even if timed-only package order does not change, an untimed slot change that breaks transport must show confirmation.
- Untimed visit insertion into `normal_pair` / `tail_promoted_pair` gap is now allowed with confirmation.
- On confirm, move the card and delete affected `plan.brokenTransportIds`.

Regression covered:

```text
A -transport- B
C untimed
D

Dragging B between C/D detects transport-ab as broken.
```

---

## 3. Important current rules to preserve

### Timed / untimed definition

Formal rule to preserve:

```text
A visit is timed only when both start_time and end_time exist.
If start_time or end_time is missing, the visit is untimed / partial time.
```

This restores the original Phase 4.5 rule. Phase 4.6 duration-preserving drag must only calculate with complete timed visits.

Caution for Phase 4.6:

- The “preserve duration” rule only applies when both start and end exist.
- Start-only or end-only visits have no valid duration and must not enter duration-based auto-continuation.
- Do not silently invent a missing end_time or duration.
- Do not reintroduce `start_time only = timed` as the formal model.
- If existing Demo / legacy data still has start-only final visits, normalize the data or guard that edge case before Phase 4.6 logic runs.

### Transport role rules

`normal_pair`:

- Established A→B transport.
- Endpoint becomes untimed / partial time: keep warning, do not turn into tail.
- Timed endpoint changes and A/B no longer same-direction adjacent: show Restore/Delete or reorder transport removal confirmation.

`tail_pending`:

- Pending next-leg transport.
- Untimed after it does not form a pair.
- Untimed after it can later become timed; if reasonable after the previous timed visit, promote to `tail_promoted_pair`.
- If the candidate time sorts before the previous timed visit, keep `tail_pending`, do not prompt and do not invalid.

`tail_promoted_pair`:

- A pair formed from `tail_pending`.
- If the promoted next endpoint becomes untimed again, demote back to `tail_pending`.
- If a drag breaks it, confirmation is required before deleting it.

### Mixed drag rules

- Use mixed visual order for drop target and broken transport detection.
- Use timed-only sequence for time calculations.
- Untimed can be head/middle/tail.
- Timed/untimed can be inserted into an existing transport gap only with confirmation.
- If user confirms, delete broken transports from `plan.brokenTransportIds`.
- No affected transports = no confirmation.
- No-op drag = no confirmation.

### Fixed card rules before Phase 4.7

- Fixed cards cannot be dragged.
- Fixed cards should not be moved or pushed by auto-continuation.
- Editing a single card and pressing Save may cross a fixed card if there is no overlap.
- Pressing “接續” is disabled if the edit would cross a fixed timed visit.
- Tooltip/copy: `跨越固定行程時無法接續。`
- Advanced fixed-anchor drag belongs to Phase 4.7, not Phase 4.6.

---

## 4. Phase 4.6 target

Phase 4.6 should implement timed visit drag auto-continuation.

Core rule:

```text
Timed drag moves the itinerary intent, not just the content package.
After drag, each moved/reordered timed visit preserves its own original duration.
The system recalculates start_time / end_time according to the new timed order.
Do not swap time slots.
```

Expected base behavior:

1. New first timed visit uses the original first timed visit start time.
2. Each complete timed visit preserves its own original duration.
3. If two timed visits were same-direction adjacent before and remain same-direction adjacent after, preserve their original total gap.
4. If two timed visits are newly adjacent, directly continue: previous end -> next start.
5. If a pair reverses direction, treat as new adjacency and directly continue.
6. Untimed visits do not participate in time continuation.
7. No new transportation cards are automatically created.
8. Existing `normal_pair` / `tail_promoted_pair` is preserved only if endpoints remain same-direction adjacent.
9. Broken transports use existing confirmation + `brokenTransportIds`.
10. Do not implement fixed-anchor drag logic in 4.6; leave that for Phase 4.7.

Important:

```text
Current old behavior may still look like swapping time slots.
Phase 4.6 must replace that with duration-preserving recalculation.
```

---

## 5. Phase 4.6 suggested QA cases

### Basic duration preservation

```text
A 09:00-10:00 duration 60
B 10:30-11:00 duration 30
C 12:00-13:30 duration 90

Drag C above A.
Expected: C remains 90 min, A remains 60 min, B remains 30 min.
Not allowed: C taking A's 60-minute slot.
```

### Preserve same-direction gap

```text
A
B
C

Move A below C.
If B→C remains same-direction adjacent, B→C gap should be preserved.
New adjacencies directly continue.
```

### Direction reversal

```text
A→B before
B→A after
Expected: treat as new adjacency; do not preserve old A→B gap.
```

### Untimed mixed list

```text
A timed
U untimed
B timed
C timed

Drag C above A.
Expected visual: C > A > U > B or according to actual drop target.
Time calculation only uses timed sequence.
U does not create gap or duration.
```

### Transport cleanup

```text
A
transport A→B
B
C

Drag B away.
Expected: show transport removal confirmation.
Confirm: move B, delete A→B.
Cancel: no change.
```

### No affected transport

```text
A
U untimed
B

No transport cards.
Drag B around U.
Expected: no confirmation.
```

### Fixed card guard

```text
A
F fixed
B

Phase 4.6 should not invent advanced fixed-anchor behavior.
Fixed drag/cross-fixed auto-time behavior remains Phase 4.7.
```

---

## 6. Files likely relevant for next work

Likely touched/relevant:

```text
src/App.jsx
src/lib/timelineTransportationRoles.js
src/lib/timelineAutoContinuation.js
src/lib/timelineUntimedOrdering.js
src/lib/timelineTransportationConflicts.js
src/lib/destinationPackages.js
tests/phase-4-5-untimed-ordering.spec.js
tests/phase-4-3-transport-conflict.spec.js
supabase/migrations/022_add_transport_role_to_itinerary_items.sql
```

Also check:

```text
CURRENT_TASK.md
docs/UX_RULES.md
docs/BUGS.md
docs/timeline-phase-4-drag-reorder-rules-draft-v7.md
```

---

## 7. Suggested first task in new chat

Before coding Phase 4.6:

1. Confirm current working tree status.
2. Confirm final tests after the last untimed-insertion adjustment.
3. Apply migration 022 to Supabase remote if not already applied.
4. Commit/push Phase 4.5b/4.5c if QA is complete.
5. Then start Phase 4.6 from a clean working tree.

Recommended first Codex goal:

```text
Implement Timeline Phase 4.6 timed visit drag auto-continuation. Preserve each complete timed visit's own duration after drag, recalculate times by the new timed order, preserve same-direction adjacency gaps, directly continue new/reversed adjacencies, keep untimed visits as mixed visual-only items, and reuse existing brokenTransportIds confirmation/cleanup. Do not implement fixed-anchor drag rules or collaborative presence in this phase.
```
