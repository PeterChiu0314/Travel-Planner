# Timeline Phase 5.7c-1 Node-level Collaboration Handoff

Date: 2026-07-11  
Branch: `codex/timeline-phase-5-7`  
Latest pushed code commit: `40342b3 Clear stale previews after route invalidation`
Status: stabilization in progress; multiplayer dragging is substantially more stable, but final closeout QA is not complete.

Deletion stabilization after `0517a80`: node deletion now supersedes an unacknowledged drag final for the same node. Local delete clears pending-final ownership and stale remote preview state; remote `node-delete` also releases local-final priority; a late response from the older drag save is fenced from restoring the deleted handle. Commit `b4867cd` is deployed. Chrome two-session QA passed immediate remote delete, drag-end followed by remote delete, deletion of the segment's final custom node, and both-client refresh convergence without node restoration. Focused provider tests, production build, and diff validation also pass.

Further Chrome two-session QA passed concurrent adds from three to five nodes, five-node limit enforcement, simultaneous different-node drags, refresh convergence, same-account editor-label deduplication, and the first drag after a simulated background lifecycle recovery. Endpoint-coordinate invalidation then exposed another stale-preview path: the database override was deleted correctly, but a remote editor retained five handles until refresh because old remote node previews were merged over an absent authoritative segment. Deployed commit `40342b3` tracks authoritative segment keys and clears remote previews plus pending local finals only when a segment transitions from present to absent. Automated provider tests, build, and diff validation pass. A fresh deployed endpoint-invalidation replay remains pending because the invalidation QA consumed the available test nodes and Chrome automation did not trigger the first transparent hit-line node add; no direct database seeding was performed.

The deployed replay subsequently created a fresh node through the planning-phase UI and confirmed one more missing link: the remote client retained the handle until refresh because it did not reliably reload route overrides after the endpoint's `itinerary_items` update. The route-override table is subscribed in code, but the applied route migrations do not add it to the Realtime publication. The current follow-up therefore reloads both trip data and active-day route overrides from the existing reliable itinerary-item Realtime callback. This requires no schema or migration change. Focused provider tests, production build, and diff validation pass; deployed two-client replay remains required.

## 1. New-chat startup

Read these files first:

1. `CURRENT_TASK.md`
2. `AGENT.md`
3. `docs/UX_RULES.md`
4. `docs/BUGS.md`
5. This handoff

Do not use `docs/todo/2026-07-09-phase-5-7c-collaborative-route-edit-plan.md` as the current technical source. It has encoding damage and contains superseded segment-snapshot / Presence-lock architecture.

Recurring local noise that must remain untracked unless explicitly requested:

```text
supabase/.temp/
test-results/
```

## 2. Product decisions already fixed

- Phase 5.7d was merged into Phase 5.7c.
- Multiple users may enter route edit mode at the same time.
- Same-day itinerary editing is not locked by route edit mode.
- There is no 15-second route-edit idle exit.
- Itinerary data is primary; custom route lines are secondary.
- If itinerary adjacency or endpoint coordinates change, affected custom route lines may be invalidated and return to straight lines.
- One editor label: `某某正在編輯地圖路線`.
- Two or more editors: `N 位成員正在編輯地圖路線`.
- Recovery is silent. Do not add loading banners, toast, or `正在恢復多人同步…` UI.
- Demo / StaticMapProvider remains excluded from route editing and Realtime collaboration.

## 3. Current collaboration architecture

Channel:

```text
timeline-route-edit:{tripId}:{dayIndex}
```

### Presence

Presence only represents low-frequency route-editor state.

- Stable session identity.
- Editor count is deduplicated by `userId`.
- Heartbeat: 32 seconds.
- Stale editor threshold: 70 seconds.
- Do not put mouse-move coordinates or node locks back into Presence.

### Broadcast

Broadcast carries node-level collaboration events:

```text
node-add
node-drag-start
node-drag-move
node-drag-end
node-delete
```

Rules:

- One payload affects one `segmentKey + nodeId` only.
- Drag preview throttle is 120 ms, latest-wins.
- `drag-end` is immediate and fences delayed moves from the same drag.
- Remote marker and polyline updates are imperative; drag moves must not rebuild all route handles.
- Node locks are derived from Broadcast start/move/end, not Presence.
- Remote node-lock stale timeout is 12 seconds.

### Database

Segment container:

```text
public.itinerary_route_overrides
```

Independent custom nodes:

```text
public.itinerary_route_override_nodes
```

Each node persists independently with stable `node_key`, `order_key`, latitude, longitude, creator/updater metadata, and timestamps. Multiplayer writes must not return to whole-segment `points_json` replacement.

Applied remote migrations:

```text
20260708063744_add_itinerary_route_overrides.sql
20260710125337_add_itinerary_route_override_nodes.sql
```

The node migration includes RLS, indexes, old-data conversion, and the concurrent five-node limit. Do not edit either applied migration in place.

## 4. Stabilization history and confirmed causes

Important pushed commits, oldest to newest:

```text
a0890aa Use node-level route collaboration
4e3f70d Stabilize collaborative route dragging
110def0 Stop route edit presence churn
9e65806 Harden route node final commits
1b4f059 Stabilize route edit presence recovery
e9b6e16 Resync route nodes before recovery
e46779b Preserve route node handoff previews
4dec053 Move route node locks to broadcast
3c3cce3 Release stale route node final ownership
0517a80 Track pending route commits per node
b4867cd Stabilize collaborative route node deletion
40342b3 Clear stale previews after route invalidation
```

Confirmed failures that were corrected:

1. Drag-move React state rebuilt all Google markers, causing flicker and difficult click-delete.
2. Segment snapshots let users overwrite different nodes with stale copies.
3. Presence enter/exit churn recreated channels and caused high CPU/network use, delay, and rollback.
4. Repeated Presence node-lock updates reached Supabase Presence rate limits.
5. Idle/background channel closure was detected only on the next send.
6. Old route-override queries could overwrite the current trip/day result.
7. Local final priority was released before authoritative acknowledgement.
8. Same-node remote handoff could be hidden behind the previous local final priority.
9. A single pending-commit ref allowed a quick P2 drag to overwrite P1's unacknowledged commit. Commit `0517a80` replaced this with per-node pending commits keyed by `segmentKey + nodeId`.

Chrome WebSocket diagnostics confirmed that `node-drag-start`, `node-drag-move`, and `node-drag-end` were transmitted and received during the handoff failure. The remaining rollback was client-side ownership/commit bookkeeping, not missing Broadcast delivery.

## 5. Current user-verified status

The user reports that multiplayer node dragging is now substantially more stable.

Do not mark Phase 5.7c complete yet. The latest per-node pending-commit change still requires deployed dual-account testing.

Most important first scenario:

```text
A drags P1
→ B drags the same P1
→ B immediately drags P2
→ P1 must not return to an earlier position
→ both clients must converge after drag-end and refresh
```

## 6. Remaining manual QA

### Drag and ownership

- A drags P1, B drags P2 simultaneously.
- A drags P1, B takes P1, A takes P1 again.
- A drags P1, B takes P1 and immediately drags P2.
- Rapid drag for 10 to 20 seconds does not accumulate delayed playback.
- Drag-end converges both clients to the same final position.
- Refresh both clients and confirm identical node positions/order.

### Add and delete

- A adds a node; B sees it immediately and after refresh.
- B deletes an unlocked node; A sees it disappear immediately and after refresh.
- Immediately after a drag ends, either client deletes that same node; the old final position must not restore the handle while the drag save or authoritative acknowledgement is still in flight.
- A and B add different nodes concurrently.
- A cannot delete P1 while B holds P1's drag lock.
- Five-node limit remains correct during concurrent adds.
- Save failure rolls back only the affected node and emits the inverse collaboration event.

### Presence and channel lifecycle

- Editor count remains the actual unique-user count during sustained dragging.
- Same account in two tabs still counts as one member label.
- Background or idle one client for 5 to 10 minutes.
- On returning to foreground, channel recovery happens silently before a valid drag.
- No recovery loop, duplicate topic, REST fallback, or Presence churn.
- First valid drag after recovery is synchronized.

### Itinerary priority

- Reorder, insert, delete, and endpoint coordinate changes remain available during route edit mode.
- Only affected route overrides are invalidated.
- Unaffected adjacent segments retain their custom nodes.
- New adjacencies render as straight lines.

## 7. Debugging guidance

Use:

```text
?debugRouteCollab=1
```

For one failing node, capture:

```text
segmentKey
nodeId
sessionId
dragId
sequence / eventVersion
node-drag-start/move/end send and receive
current node-lock owner
pending local commit owner and commitId
save response
authoritative node acknowledgement
last marker.setPosition source
```

Before changing code, determine whether the final incorrect writer is:

```text
local drag
remote preview
save response
rollback
authoritative DB reload
```

Do not respond to a correctness failure by only changing the 120 ms throttle. Preview smoothness and final convergence are separate issues.

## 8. Necessary automated verification

Use the smallest relevant checks while iterating:

```powershell
npx.cmd playwright test tests/mapProviderPrep.spec.js
npm.cmd run build
git diff --check
```

Latest verified result after `0517a80`:

```text
mapProviderPrep: 36 passed
production build: passed
git diff --check: passed
branch local/remote: 0 / 0 at push time
```

Earlier stabilization passes also completed 83 focused Playwright checks.

## 9. Protected scope

Do not reintroduce or expand:

- same-day readonly route-edit lock;
- 15-second idle exit;
- segment-snapshot Broadcast;
- whole-`points_json` multiplayer writes;
- synchronized pan/zoom, cursors, Timeline scroll, or remote DragOverlay;
- Routes/Directions transportation time lookup;
- Google route polyline persistence or encoded polylines;
- Places field-mask expansion;
- Demo/Static Google collaboration;
- Timeline reorder RPC changes;
- Auth, member/invite, Budget, Draft Autosave, or unrelated migrations.

## 10. Closeout condition

Phase 5.7c can close only after the remaining dual-account QA passes, both refreshed clients converge to identical DB-backed node state, editor count remains stable, idle recovery works silently, and add/delete/invalidation regressions pass.

When closing:

1. Update `CURRENT_TASK.md` with final manual QA and latest commit.
2. Convert this handoff into the final Phase 5.7c closeout state or create a separate closeout document.
3. Audit `AGENT.md` and `docs/UX_RULES.md` only for genuinely durable new rules.
4. Keep `supabase/.temp/` and `test-results/` out of commits.
