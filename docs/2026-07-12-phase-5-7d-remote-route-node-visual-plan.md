# Timeline Phase 5.7d Multiplayer Route Editing Visual Feedback

Date: 2026-07-12  
Branch: `codex/timeline-phase-5-7`  
Baseline: Phase 5.7c complete at `c6989a3 Preserve rapid route ownership handoff`

## Objective

Make a route node visibly identifiable while a remote user is dragging it, without changing the completed Phase 5.7c collaboration architecture.

## Approved Visual

- Local drag: no new visual effect.
- Remote drag: keep the existing green center.
- Replace the white outline with the remote user's existing stable `userId` hash color.
- Add a subtle same-color translucent glow.
- Keep the node core at its current size.
- Do not add a user-name label.
- Do not change the existing collaboration color palette or hash function.

## Lifecycle

Apply the remote visual from the existing remote node lock. Restore the default white-outline/no-glow icon when any of these occurs:

- `node-drag-end`;
- remote lock stale timeout;
- `node-delete`;
- segment invalidation;
- Day or trip change;
- route-edit exit;
- Realtime channel cleanup or replacement.

## Implementation Constraints

- Compute the color locally from the existing trusted `userId` hash palette.
- Do not transmit CSS colors in Broadcast events.
- Use the current Google Marker imperative record and `setIcon`; do not rebuild markers during drag moves.
- Do not add `AdvancedMarkerElement`, a name overlay, or new marker packages.
- Do not modify Broadcast phases, ownership fencing, pending commits, Realtime subscriptions, database writes, migrations, RLS, RPCs, route persistence, itinerary reorder, Auth, Share/Invite, Places, or Budget.
- Demo and StaticMapProvider remain unchanged.

## Verification

- Normal node: green center, white outline, no glow.
- Local dragging: same normal appearance throughout.
- Remote `node-drag-start`: user-color outline and glow appear on the receiving client only.
- Remote move: highlight follows the existing imperative marker position.
- Remote drag-end: final position remains and the visual returns to normal.
- Lock timeout and route-edit cleanup cannot leave a stale colored outline or glow.
- Same account across tabs uses the same user color while session ownership remains distinct.
- `tests/mapProviderPrep.spec.js`, production build, and `git diff --check` pass.

No production migration is expected.
