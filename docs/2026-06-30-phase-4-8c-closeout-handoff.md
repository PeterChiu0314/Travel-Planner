# Timeline Phase 4.8c Collaborative Drag Presence Closeout

Date: 2026-06-30
Branch: `codex/timeline-phase-4-8`
Status: Implemented / user verified / no migration

---

## Read First

- `AGENT.md`
- `CURRENT_TASK.md`
- `docs/UX_RULES.md`
- `docs/BUGS.md`
- `docs/timeline-phase-4-drag-reorder-rules-draft-v13.md`
- `docs/2026-06-30-phase-4-8b-demo-parity-handoff.md`
- `docs/2026-06-30-phase-4-8c-collaborative-drag-presence-handoff.md`

Archive rule:

- Do not read `docs/archive/` by default.
- `docs/gpt/` no longer exists and must not be recreated.

---

## Summary

Phase 4.8c adds lightweight collaborative drag presence for authenticated Formal Timeline drag reorder.

When one approved editor/owner drags a destination card on a trip day, other members on the same trip/day see a subtle drag hint and insertion line, and their same-day destination drag handles are temporarily disabled.

The feature does not synchronize remote drag overlay, ghost cards, local preview order, or official ordering data. The authoritative result still comes only from the existing drop flow and reorder RPC success.

---

## Final Technical Shape

Channel:

```text
timeline-drag:{tripId}:{dayIndex}
```

Supabase Realtime Presence:

- Used only for the low-frequency "someone is dragging" soft lock.
- `track()` happens on drag start and after subscribe if a local drag already exists.
- `untrack()` happens on drag cleanup.
- Presence no longer carries heartbeat or drag-over updates.

Presence payload:

```js
{
  userId,
  userName,
  sessionId,
  dragId,
  tripId,
  dayIndex,
  itemId,
  itemTitle,
  startedAt
}
```

Supabase Realtime Broadcast:

- Used for drag updates, heartbeat, insertion target, and immediate clear.
- Broadcast was added after Vercel testing showed Presence `track()` can time out during sustained heartbeat/dragOver updates.

Broadcast events:

```text
timeline-drag-update
timeline-drag-clear
```

Broadcast update payload:

```js
{
  userId,
  userName,
  sessionId,
  dragId,
  tripId,
  dayIndex,
  itemId,
  itemTitle,
  overItemId,
  placement,
  sentAt
}
```

Foreign filtering:

- Same tab is excluded by `sessionId`.
- Same account in another tab/session is treated as foreign if `sessionId` differs.
- Trip and day must match.
- Payloads older than 12 seconds are stale and stop disabling/showing presence.

Local safety:

- Local drag max duration remains 75 seconds.
- Heartbeat broadcasts every 3 seconds.
- Cleanup paths broadcast clear and untrack presence.

---

## UI Behavior

Implemented:

- Same-day foreign drag disables destination drag handles.
- Same-day foreign drag shows `{userName} 正在拖曳`.
- Same-day foreign drag can show a muted insertion line using remote `overItemId` and `placement`.
- Edit/delete/expand/general card interactions remain unaffected.

Not implemented:

- No remote `DragOverlay`.
- No remote ghost card.
- No remote local preview reorder.
- No multi-user merge.
- No Map integration.

---

## Protected Boundaries Preserved

No changes were made to:

- reorder RPCs
- Supabase migrations
- database tables
- Phase 4.7 fixed-anchor continuation logic
- Phase 4.7 `brokenTransportIds` confirmation logic
- local preview order synchronization
- Demo Supabase/Auth/Realtime isolation
- Map integration

Demo remains local mock state only.

---

## Relevant Code Locations

Primary implementation:

- `src/App.jsx`
  - Formal drag presence channel/effects in authenticated `App`
  - `publishDragPresence(payload)`
  - `clearDragPresence()`
  - `foreignDragPresence`
  - `foreignSameDayDragActive`
  - `ItineraryTimeline` dnd-kit lifecycle integration
  - drag eligibility checks for timed and untimed destination drag

UI styling:

- `src/styles.css`
  - `.timeline-remote-drag-hint`
  - `.timeline-remote-insertion-line`

Smoke test update:

- `tests/phase-1-7f-smoke.spec.js`
  - Demo smoke now checks dnd-kit time-block drag handles instead of native full-card `draggable="true"`.

---

## Commit Notes

Relevant commits on `codex/timeline-phase-4-8`:

```text
d18279f Add Timeline Phase 4.8c drag presence
3989cba Fix Timeline drag presence startup tracking
ca4c0c9 Keep Timeline drag presence heartbeat active
1530c20 Debug timeline drag presence flow
3cd0dcc Use broadcast for timeline drag presence updates
```

`1530c20` was a temporary debug commit used to diagnose Vercel multi-account behavior. It is intentionally left in branch history for now. Current debug logs are gated by `?debugPresence=1`, so normal users do not see console output. If desired before merge, either squash the branch or add a cleanup commit to remove debug helpers.

---

## Verification

Automated checks run during 4.8c:

```text
npm.cmd run build passed
npx.cmd playwright test tests/phase-1-7f-smoke.spec.js passed 22/22
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js passed 27/27
git diff --check passed with Windows LF/CRLF notices only
```

Presence + Broadcast final change:

```text
npm.cmd run build first run bundled successfully but exited with a Windows Node UV_HANDLE_CLOSING assertion
npm.cmd run build rerun passed
git diff --check passed with Windows LF/CRLF notice only
```

Manual Vercel verification:

```text
User verified Phase 4.8c multi-account drag presence is OK after Presence + Broadcast change.
```

Existing Vite large-chunk warning remains known and is not a Phase 4.8c regression.

---

## Residual Risks

- Realtime Broadcast delivery is still best effort; the 12-second stale timeout is the fallback when clear/update is missed.
- Debug helpers expose ephemeral drag payloads in console only when `?debugPresence=1` is set. This is useful for short-term rollout debugging but can be removed before merge if desired.
- Multi-user manual testing passed on Vercel, but future changes to dnd-kit lifecycle, day switching, or Realtime channel setup should retest two authenticated sessions.

---

## Recommended Next Step

Phase 4.8c is closed for now.

Next work should be one of:

- final merge/PR cleanup for Phase 4.8,
- optional debug-log cleanup if production history should be quieter,
- Phase 4.9 Map integration only if explicitly requested.

Do not infer additional collaborative editing, multi-user merge, transportation repair, schema/RPC work, or Demo presence.
