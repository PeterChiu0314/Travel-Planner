# Timeline Phase 4.8c Collaborative Drag Presence Handoff

Date: 2026-06-30
Branch: `codex/timeline-phase-4-8`
Target next work: continue **Timeline Phase 4.8c - Collaborative Drag Presence**

---

## Read First

- `AGENT.md`
- `docs/UX_RULES.md`
- `docs/BUGS.md`
- `CURRENT_TASK.md`
- `docs/timeline-phase-4-drag-reorder-rules-draft-v13.md`
- `docs/2026-06-29-phase-4-7-closeout-handoff.md`
- `docs/2026-06-30-phase-4-8b-demo-parity-handoff.md`

Archive rule:

- Do not read `docs/archive/` by default.
- `docs/archive/` is only for historical context when the active docs are not enough.
- `docs/gpt/` no longer exists and must not be recreated.

---

## Latest Commit Context

Recent commits on `codex/timeline-phase-4-8`:

```text
da54f34 Polish timeline drag overlay and docs
c3a927b Handle tail pending untimed promotion bypass
89aebd9 Fix demo transport parity after local reorder
6f02e3b Keep transports in Phase 4.8 drag preview flow
c94d954 Stabilize Timeline Phase 4.8 drag preview
```

Before starting work, run:

```text
git status
git pull
```

Confirm whether this handoff file itself has already been committed/pushed before relying on it as remote state.

---

## Phase 4.8a / 4.8b Completed State

### 4.8a Local Sortable Drag Preview

- Timeline visit cards use dnd-kit Sortable and `DragOverlay`.
- Installed packages:
  - `@dnd-kit/core`
  - `@dnd-kit/sortable`
  - `@dnd-kit/utilities`
- Drag preview is local UI only.
- Dragging does not write `itinerary_items`.
- Dragging does not call reorder RPC.
- Dragging does not update `start_time` / `end_time`.
- Dragging does not convert visits to untimed.
- Dragging does not create, delete, or rewrite transportation cards.
- Drop still goes through the existing Phase 4.7 reorder flow.
- Fixed cards remain non-draggable.
- Timed and untimed existing rules remain preserved.
- Drop-after second animation was removed by custom `animateLayoutChanges`.

### Transportation Visual Attachment

- Transportation cards are not sortable items.
- Transportation cards are not draggable.
- Transportation cards are rendered as visual attachments inside the previous destination sortable wrapper.
- During drag preview, transportation cards move with the visual flow instead of staying static.
- Drop still lets Phase 4.7 formal logic decide whether transportation remains, breaks, confirms, or deletes.

### Demo Timeline Data Parity

- Demo mock transport data now includes Formal-like fields:
  - `transport_role`
  - `from_item_id`
  - `to_item_id`
  - snapshots
  - fixed metadata
  - trip/day/sort fields
- Demo newly added transport cards now include `trip_id`.
- Demo newly added transport cards use pair-adjacent `sort_order`.
- This prevents Demo-added transport rows from being skipped by shared reorder planning.
- Demo and Formal continue to share `ItineraryTimeline` and CSS.

### Tail Pending + Untimed Promotion Bypass

- Shared helper: `planTailPendingPromotionUntimedBypass` in `src/lib/timelineUntimedOrdering.js`.
- Formal and Demo both use this helper.
- Narrow exception only:
  - active transport must be `tail_pending`
  - current save must promote it into `tail_promoted_pair`
  - only untimed visits blocking the promoted `A -> C` adjacency are rebased
  - unrelated untimed visits are not moved
  - `normal_pair` and existing `tail_promoted_pair` do not use this bypass
  - invalid C timing / target order does not trigger the bypass
- No migration or reorder RPC change.

### Overlay / Drag Handle Polish

- Floating overlay is constrained to vertical movement.
- Overlay top bound is the `.timeline` list top, aligned below the day/date header and with the first card position.
- Overlay bottom bound stays inside the active day board.
- Drag activation is limited to the left `.time-block`.
- The rest of the visit card remains clickable for normal card interactions.
- No extra dnd-kit modifier package was installed; a local `DndContext` modifier is used.

---

## Files Most Relevant To 4.8c

- `src/App.jsx`
  - `ItineraryTimeline`
  - `SortableTimelineEntry`
  - `TimelineDragHandle`
  - `TimelineFlowAttachment`
  - `DndContext`
  - `DragOverlay`
  - Formal `saveItem`
  - Demo `saveTimelineItem`
- `src/styles.css`
  - `.timeline`
  - `.timeline-sortable-entry`
  - `.timeline-flow-attachment`
  - `.timeline-drag-overlay-card`
  - `.time-block[data-drag-handle="true"]`
- `src/lib/destinationPackages.js`
  - timed destination package reorder planning
  - fixed-anchor continuation
- `src/lib/timelineUntimedOrdering.js`
  - mixed timed/untimed visual order
  - untimed reorder
  - tail-pending promotion bypass
- `src/lib/timelineTransportationRoles.js`
  - `normal_pair`
  - `tail_pending`
  - `tail_promoted_pair`
- `tests/phase-4-2c-reorder.spec.js`
  - Phase 4.6 / 4.7 / 4.8 regressions
  - tail-pending bypass regressions
  - Demo transport parity regressions

---

## Protected Boundaries For 4.8c

Do not modify unless explicitly approved:

- Supabase migrations.
- Reorder RPCs.
- Phase 4.7 fixed-anchor reorder logic.
- Phase 4.7 `brokenTransportIds` confirmation logic.
- Phase 4.5 untimed mixed-order rules.
- Formal persistence flow for actual reorder/drop.
- Demo isolation from Supabase/Auth/Realtime/Draft/EditLock.

Do not make transportation cards sortable or draggable.

Do not let drag presence write official ordering data.

Do not let drag presence create ghost itinerary rows, transportation rows, or persistent mock rows.

Do not let a remote drag presence interfere with local active editors, draft autosave, edit locks, or the local user's drag operation.

---

## Phase 4.8c Goal

Add collaborative drag presence as a lightweight visual signal when another collaborator is dragging a Timeline visit card.

The feature should help users understand that another person is interacting with the Timeline, without changing official order or blocking normal data flows unless an existing lock/permission rule already does so.

Expected direction:

- Presence-only / preview-only.
- Realtime or presence channel based, not database row based.
- No official reorder until the dragging user drops and existing Phase 4.7 flow succeeds.
- No multi-user ghost card that becomes part of `itinerary_items`.
- No new migration unless explicitly approved.

---

## Suggested 4.8c Design Shape

Prefer Supabase Realtime Presence over database writes.

Possible channel model:

```text
timeline-drag:{tripId}:{dayIndex}
```

Presence payload should be minimal and non-sensitive:

```js
{
  userId,
  displayName,
  tripId,
  dayIndex,
  itemId,
  itemTitle,
  startedAt,
  y,              // optional viewport/list-relative position
  overItemId,     // optional target preview
  placement       // optional before/after
}
```

Keep payload ephemeral:

- Track on local drag start.
- Update throttled while dragging.
- Untrack on drag cancel, Esc, invalid end, or successful drop.
- Best effort cleanup on unmount / day switch / trip switch.

Important: Do not include full itinerary payloads, notes, private budget details, or draft content in presence payloads.

---

## Suggested UI Behavior

Remote user drag presence may show:

- A subtle outline/label near the affected visit card.
- A small "Peter is moving this" style pill.
- A muted placeholder line near the remote hover target.
- A remote cursor/handle hint if it stays visually calm.

Avoid:

- Large ghost cards that look like official local draggable cards.
- Moving local cards based on remote presence.
- Blocking the local user's actions solely because someone is preview-dragging.
- Full-card overlays that hide edit/delete/lock controls.
- Noisy realtime animation.

If a local user is currently dragging:

- Local drag should win visually.
- Remote presence should be suppressed or reduced.
- Do not merge local and remote previews.

If a remote user successfully drops:

- Existing Realtime table subscription / trip reload should show the authoritative result.
- Presence should clear.
- Do not apply a local optimistic remote reorder from presence alone.

---

## Formal / Demo Scope

Formal:

- 4.8c likely belongs only to authenticated Formal app because it depends on collaboration presence.
- Use current user identity and trip membership context.
- Respect existing permissions and edit locks.

Demo:

- Demo must remain local and unauthenticated.
- Demo should not connect to Supabase Realtime Presence.
- If a Demo visual is needed for QA, use a purely local fake presence toggle/sample, but only if explicitly requested.
- Do not let Demo presence code create a second Timeline render path.

---

## Edge Cases To Handle

- User starts drag then presses Esc.
- User starts drag then switches day.
- User starts drag then route/tab changes.
- User starts drag then browser tab loses focus.
- User disconnects mid-drag.
- Two remote users drag different cards.
- Local user drags while remote user is dragging.
- Remote user drags a card that local user is editing or has locked.
- Remote presence references an item no longer visible after data reload.
- Viewer role should not broadcast drag presence for draggable visits because viewers cannot edit/reorder.

---

## Testing / QA Suggestions

Automated:

```text
npm.cmd run build
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js
git diff --check
```

If touching app shell or Realtime setup:

```text
npx.cmd playwright test tests/phase-1-7f-smoke.spec.js
```

Manual Formal QA:

- Open the same trip in two authenticated sessions/browsers.
- Drag a timed visit in user A.
- User B sees lightweight drag presence.
- User B's local list does not reorder from presence alone.
- User A cancels drag; user B presence clears.
- User A drops valid reorder; user B updates only after official data change/reload.
- User A drops invalid target; user B presence clears and official order stays unchanged.
- User A drags an untimed visit; presence behavior remains consistent.
- Fixed card cannot broadcast draggable presence.

Demo QA:

- `/demo/timeline` still loads without login.
- Demo does not open Supabase/Auth/Realtime connections.
- Demo drag preview from 4.8a/4.8b still works.

---

## Latest Verification Before This Handoff

After Phase 4.8b + drag overlay polish:

```text
npm.cmd run build passed
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js passed 27/27
git diff --check passed with Windows LF/CRLF notices only
Manual user verification passed for Demo and Formal drag preview, Demo transport parity, tail_pending + untimed promotion bypass, vertical overlay constraint, day-board top/bottom overlay bounds, and time-block-only drag activation.
```

Existing Vite large-chunk warning remains known and is not a Phase 4.8 regression.

---

## Recommended First Step

Before coding 4.8c:

1. Read the listed docs.
2. Run `git status`.
3. Inspect the existing Realtime subscription and Supabase channel patterns in `src/App.jsx`.
4. Decide whether to use a dedicated presence channel per trip/day or one trip-wide presence channel with day filtering.
5. Implement the smallest presence-only slice behind Formal authenticated context.
6. Verify Demo remains isolated.

Keep 4.8c intentionally small: presence signal first, no collaborative data mutation.
