# Timeline Phase 4.8c2 Collaborative Drag Presence Handoff

Date: 2026-07-01
Branch: `codex/timeline-phase-4-8`
Status: Implemented / user verified / no migration

---

## Summary

Phase 4.8c2 is the stabilized follow-up to Phase 4.8c Collaborative Drag Presence.

4.8c introduced authenticated Formal-only Timeline drag presence with Supabase Realtime Presence + Broadcast. 4.8c2 keeps that shape and adds two safeguards verified by user testing:

- Foreign same-day drag presence temporarily makes that Day Board read-only for data-changing Timeline actions.
- Repeated drag no longer gets stuck after the `timeline-drag:{tripId}:{dayIndex}` channel reports `CLOSED`.

No RPC, migration, reorder semantics, Demo presence, remote DragOverlay, ghost card, or remote preview order was added.

---

## Read First

- `AGENT.md`
- `CURRENT_TASK.md`
- `docs/UX_RULES.md`
- `docs/BUGS.md`
- `docs/timeline-phase-4-drag-reorder-rules-draft-v13.md`
- `docs/2026-06-30-phase-4-8c-closeout-handoff.md`

Archive rule:

- Do not read `docs/archive/` by default.
- `docs/gpt/` no longer exists and must not be recreated.

---

## Latest Commit Context

Recent commits on `codex/timeline-phase-4-8`:

```text
8e5071f Recover Timeline drag presence channel
9d59dff Strengthen Timeline drag presence day lock
71118ae Document Timeline Phase 4.8c closeout
3cd0dcc Use broadcast for timeline drag presence updates
1530c20 Debug timeline drag presence flow
```

Before future work:

```text
git status
git pull
```

---

## Final Technical Shape

Channel:

```text
timeline-drag:{tripId}:{dayIndex}
```

Realtime Presence:

- Formal authenticated app only.
- Presence tracks the drag start soft lock.
- Presence untracks during drag cleanup.
- Presence heartbeat tracking is intentionally not used.

Realtime Broadcast:

- Broadcast carries drag update, heartbeat, target/placement, and clear events.
- Broadcast events:
  - `timeline-drag-update`
  - `timeline-drag-clear`

Identity:

- Self/foreign filtering uses `sessionId`, not `userId`.
- Same account in another tab is treated as foreign when `sessionId` differs.

Debug:

- Debug logging remains gated behind `?debugPresence=1`.
- 4.8c2 added logs for:
  - channel status summary on drag start
  - subscribe status
  - removeChannel reason
  - skipped track reason when channel is missing, not ready, or closed

---

## 4.8c2 Same-Day Readonly Lock

When `foreignSameDayDragActive === true`, the active Day Board becomes temporarily read-only for data-changing Timeline actions.

Disabled / blocked:

- destination drag
- add itinerary item
- edit itinerary item
- delete itinerary item
- add transportation card
- edit transportation card
- delete transportation card
- confirm transportation warning
- add/edit/delete alternative
- swap primary/alternative
- fixed toggle
- auto-continuation save
- reorder confirmation save

Still allowed:

- expand/collapse cards
- view item content
- switch Day
- switch app section/page

Open editor behavior:

- If B already has an editor open when A starts dragging, the form is not closed and content is not cleared.
- Save/continuation buttons are disabled.
- Save handlers also guard against submit attempts and show:

```text
此日行程正在被其他成員調整，請稍後再儲存。
```

Remote hint:

```text
{userName} 正在拖曳，暫時鎖定此日編輯。
```

Scope:

- Only the active same-day Timeline board is locked.
- The whole trip is not locked.
- Existing viewer/editor/owner permission gates remain the base permission model.

---

## 4.8c2 CLOSED Channel Recovery

Observed regression:

- Same account, two tabs, same trip/day.
- First 3-4 drags worked.
- Later drags stopped syncing remotely.
- Debug console showed `track error` with status `CLOSED`.

Root cause:

- Drag end/cancel was not intentionally removing the channel.
- The active channel could still become `CLOSED` through Realtime/channel lifecycle.
- A stale closed channel could remain reachable through refs, so the next drag start attempted to track or publish through an unusable channel.

Fix:

- Track channel status separately from ready state.
- On `CLOSED`, `CHANNEL_ERROR`, or `TIMED_OUT`, clear the active channel ref and mark ready false.
- Trigger a channel recreation for the same trip/day.
- Preserve local drag payload during reconnect cleanup so it can replay after the new channel reaches `SUBSCRIBED`.
- On `SUBSCRIBED`, replay local drag presence with Presence `track()` and Broadcast update.
- Drag cleanup still only broadcasts clear, untracks presence, and clears local drag refs/state.
- `removeChannel(channel)` remains limited to channel effect cleanup for scope changes, unmount, or internal reconnect cleanup.

Remove channel only for:

- active trip changes
- active day changes
- logout / user disappears
- component unmount
- internal replacement of a closed/errored/timed-out channel

---

## Protected Boundaries Preserved

No changes were made to:

- Supabase migrations
- reorder RPCs
- Phase 4.7 fixed-anchor reorder logic
- Phase 4.7 `brokenTransportIds` confirmation logic
- Phase 4.5 untimed mixed-order rules
- official reorder persistence flow
- Demo Supabase/Auth/Realtime isolation
- remote DragOverlay / ghost / preview order synchronization
- Map integration

Demo remains local mock state only.

---

## Relevant Code Locations

- `src/App.jsx`
  - Formal timeline drag presence channel effect
  - `publishDragPresence`
  - `clearDragPresence`
  - `timelineDragPresenceChannelSummary`
  - same-day readonly `canMutateThisDay`
  - `ItineraryTimeline` mutation button/handler guards
- `src/styles.css`
  - `.timeline-remote-drag-hint`
  - `.timeline-remote-insertion-line`
- `tests/phase-4-2c-reorder.spec.js`
  - source-level smoke coverage for 4.8c2 readonly lock and closed-channel recovery

---

## Verification

Checks run for 4.8c2:

```text
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js --grep "Phase 4.8c" passed 2/2
npm.cmd run build passed
git diff --check passed with Windows LF/CRLF notices only
```

Manual user verification:

```text
Phase 4.8c Presence + Broadcast repeated drag regression tested OK.
```

Existing Vite large-chunk warning remains known and is not a Phase 4.8c2 regression.

---

## Residual Risks

- Realtime Broadcast delivery remains best effort; the 12-second stale timeout is still the fallback when clear/update is missed.
- Channel recreation is guarded by active channel identity to avoid stale cleanup loops, but future changes to Realtime lifecycle should retest repeated same-trip/same-day drags in two tabs.
- Debug logs expose ephemeral drag payload metadata only when `?debugPresence=1` is enabled.

---

## Recommended Next Step

Phase 4.8c2 is closed for now.

Proceed with final merge/PR cleanup, optional debug-log cleanup, or Phase 4.9 Map integration only if explicitly requested.

Do not infer additional collaborative editing, multi-user merge, transportation repair, schema/RPC work, Demo presence, or remote preview synchronization.
