# CURRENT_TASK.md

This file is the live project ledger. Keep it concise and aligned with the real branch, deployed behavior, production migration state, and next requested phase.

Historical Phase 4 through Phase 5.7c detail is preserved in:

- `docs/archive/Timeline_Phase5/2026-07-12-current-task-through-phase-5-7c.md`

Do not copy completed phase-by-phase logs back into this file. Add a closeout link and a short verified summary instead.

## Start Here

Read these current sources before implementation:

1. `AGENT.md`
2. `docs/UX_RULES.md`
3. `docs/BUGS.md`
4. This file
5. The handoff or plan for the explicitly requested phase

Relevant latest closeouts and plans:

- `docs/2026-07-12-phase-5-7d-remote-route-node-visual-plan.md`
- `docs/2026-07-11-phase-5-7c-node-collaboration-handoff.md`
- `docs/2026-07-05-phase-5-6-places-closeout-handoff.md`
- `docs/todo/phase-5-map-route-workspace-integration-handoff.md`
- `docs/timeline-phase-4-drag-reorder-rules-draft-v14.md`

Archive rules:

- `docs/archive/` contains historical discussions, superseded handoffs, snapshots, and old drafts.
- Do not read archived files by default; consult them only when older context is specifically required.
- `docs/gpt/` is historical and must not be recreated.
- `docs/todo/2026-07-09-phase-5-7c-collaborative-route-edit-plan.md` has encoding damage and superseded architecture; do not use it as an implementation source.

## Current Status

```text
Current phase: Timeline Phase 5.7d Multiplayer Route Editing Visual Feedback
Status: Implemented and manually verified
Branch: main
Baseline implementation commit: c6989a3 Preserve rapid route ownership handoff
Baseline closeout commit: 23247de Close Timeline Phase 5.7c
Phase 5.7d implementation commit: 5f71256 Unify remote collaborator colors
```

Phase 5.7c synchronization remains closed. Phase 5.7d is a visual-only enhancement and must not change its collaboration or persistence behavior.

## Phase 5.7d Scope

- Local dragging keeps the existing green-center, white-outline node with no additional effect.
- While a remote user owns a node drag lock, the green center remains unchanged.
- The remote node's white outline changes to that user's existing stable `userId` hash color.
- Trip avatar borders, Timeline drag visuals, and route-node visuals all derive from the same `userId`-first color helper; `sessionId` is only a legacy fallback.
- A same-color translucent glow is shown without visually enlarging the node core.
- The normal white outline and no-glow appearance return on drag-end, lock timeout, node deletion, segment invalidation, Day/trip change, route-edit exit, or channel cleanup.
- No name label in this phase.
- Do not change the existing color palette or hash assignment.
- Do not add color to Broadcast payloads; compute it locally from the existing trusted palette.
- Keep Marker updates imperative; do not rebuild markers for drag moves.
- No Broadcast, ownership, Realtime, database, migration, RLS, RPC, route persistence, or itinerary behavior change.

## Phase 5.7c Final State

- Same-day itinerary editing remains available while route editing is active; there is no same-day readonly lock and no 15-second idle exit.
- A custom route node is the synchronization and persistence unit.
- Presence carries low-frequency editor state with a 32-second heartbeat and user-deduplicated labels.
- Broadcast carries node add, delete, drag ownership, move preview, and final events; drag moves are latest-wins at 120 ms.
- PostgreSQL persists nodes independently in `itinerary_route_override_nodes`; `itinerary_route_overrides` remains the segment container.
- Pending commits are scoped by `segmentKey + nodeId`.
- Ownership-start and position/final events use separate bounded receipt slots so React batching cannot erase a handoff edge.
- Preview-only deletes always issue an idempotent database DELETE.
- Failed deletes restore the authoritative pre-delete node rows and emit inverse `node-add` collaboration events.
- Authoritative itinerary changes invalidate only affected route segments; unchanged adjacencies retain their nodes.
- Route-table Realtime changes use full replica identity and publication membership.
- Database rows are authoritative after drag-end; active-drag Broadcast remains best effort.

## Final Verification

Deployed Chrome two-client QA passed:

- node add/delete, final-node delete, preview-only delete, and normal-delete refresh convergence;
- delete immediately after drag-end without handle restoration or return-to-origin behavior;
- failed DELETE rollback after four blocked REST attempts over 25 seconds;
- concurrent adds through the five-node limit;
- simultaneous different-node dragging;
- A-to-B-to-A same-node ownership handoff;
- B taking P1 and immediately dragging P2;
- identical live and refreshed node positions/order;
- same-account editor-label deduplication;
- 319-second background recovery and synchronized first drag after foregrounding;
- endpoint-coordinate, reorder, and reversible destination-delete invalidation;
- preservation of nodes on unaffected adjacencies;
- cleanup of temporary QA destination and route nodes.

Latest automated verification:

```text
npm.cmd run test:e2e -- tests/mapProviderPrep.spec.js: 36/36 passed
npm.cmd run build: passed
git diff --check: passed (Windows LF/CRLF notices only)
```

The Vite large-chunk warning is informational and was present in successful builds.

Phase 5.7d manual verification:

- User-confirmed two-client Chrome QA passed for consistent remote user color across the avatar border, Timeline drag visuals, and route-node outline/glow.
- Local dragging remains unchanged; no name label was added.
- No automated tests were run for the final color-source alignment fix; the user performed the requested manual verification.

## Production Migration State

Production Supabase project:

```text
lqvuqamzmchepgxkftcw
```

Applied immutable migrations relevant to current Timeline behavior:

```text
019 / 20260621131905 / swap_itinerary_destination_packages
020 / 20260622130246 / reorder_itinerary_destination_packages
021 / 20260622131013 / fix_reorder_baseline_count
022 / 20260629012151 / add_transport_role_to_itinerary_items
023 / 20260629014908 / reorder_itinerary_timed_auto_continuation
024 / 20260629065754 / timeline_phase_4_7_fixed_anchor_continuation
20260708063744 / add_itinerary_route_overrides
20260710125337 / add_itinerary_route_override_nodes
20260712033758 / add_route_tables_to_realtime
```

Current state:

- No pending production migration.
- Local and remote migration history were verified aligned through `20260712033758`.
- `itinerary_route_overrides` and `itinerary_route_override_nodes` use `REPLICA IDENTITY FULL` and belong to `supabase_realtime`.
- Never edit an applied migration in place; use a new timestamped migration for future schema, RLS, RPC, permission, replica-identity, or publication changes.

## Durable Scope Guards

Preserve the following unless a future phase explicitly changes them:

- Do not restore same-day route-edit locking or a 15-second idle exit.
- Do not return to segment-snapshot Broadcast or whole-`points_json` multiplayer writes.
- Do not synchronize map pan/zoom, cursors, Timeline scroll, or remote DragOverlay as part of route-node collaboration.
- Do not add Routes/Directions travel-time queries, Google route polylines, route cache, or automatic transportation creation without explicit scope.
- Demo remains unauthenticated, static-map-only, and disconnected from Supabase/Auth/Realtime.
- Only `item_type === "transport"` identifies a transportation card; transportation-like destination categories remain destinations with coordinates, markers, sequence numbers, and route participation.
- Places keeps its minimal field mask: `id`, `displayName`, `location`, and `googleMapsUri`.
- Save remains the only itinerary write for Places/editor flows; route-node override autosave is the scoped exception.
- Preserve existing Phase 4 reorder RPC behavior, fixed-anchor rules, transportation pair contracts, draft autosave, edit locks, Auth, Share/Invite, and Budget flows.

## Known Residual Risks

- Realtime Broadcast is best effort during active drag; authoritative database reload is the convergence fallback after drag-end.
- `BUG-025` remains Low Priority: foreign Timeline drag presence can occasionally clear by its 12-second stale timeout instead of the immediate clear event.
- Active forms must continue to resist Realtime/refetch replacement.
- Legacy rows with only one time remain safely treated as untimed until an explicit save normalizes them.
- Existing native HTML drag accessibility limitations remain outside the completed route-collaboration scope.
- Timeline drag animation remains browser/timing-sensitive; future polish should use dnd-kit configuration rather than delaying authoritative writes.

See `docs/BUGS.md` and the archived ledger for older phase-specific risks.

## Working Tree Hygiene

- `supabase/.temp/` and `test-results/` are recurring local artifacts and must remain untracked unless explicitly requested.
- Preserve unrelated user changes in a dirty working tree.
- When publishing a phase, include its current tracker and closeout/handoff documentation in the same verified change set.

## Next Step

Phase 5.7d is complete. Await the next explicitly requested Timeline phase without expanding the closed 5.7c synchronization scope.
