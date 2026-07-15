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
Current phase: Timeline Phase 5.8 UI Polish
Status: In progress; latest requested polish implemented and published
Branch: codex/timeline-phase-5-8
Phase 5.7c closeout commit: 23247de Close Timeline Phase 5.7c
Phase 5.7d implementation commit: 5f71256 Unify remote collaborator colors
Latest Phase 5.8 implementation: current branch HEAD
```

Phase 5.7c synchronization and Phase 5.7d remote-drag visuals remain closed baselines. Phase 5.8 is a sequence of small UI-polish changes and must not change their collaboration or persistence behavior.

## Phase 5.8 Current UI State

- Numbered destination markers use the compact Phase 5.8 proportions, refined number colors and weight, and preserve focused styling on hover.
- The Map fills the Timeline workspace behind the Dayboard instead of starting at the Dayboard's right edge.
- The Dayboard covers the complete left workspace column with a liquid-glass surface: `rgba(238, 245, 239, .78)`, a light white border, `blur(10px) saturate(140%)`, and the opaque `.96` fallback when backdrop filtering is unavailable.
- Day tabs are visually integrated with the Dayboard when the Map is expanded, while retaining their existing horizontal drag/arrow behavior and normal collapsed-Map layout.
- The Dayboard and tabs align directly against the sidebar and share the same right boundary without a gap or mismatched blur strip.
- The Dayboard vertical scrollbar uses a transparent track, no arrow buttons, a 4 px softly muted thumb, and stable gutter. Expanded-panel padding is `0 10px 5px 14px`.
- The trip title and title-edit input use 24 px / 500 weight; header metadata uses 500 weight. The header uses the compact 68 px grid layout and translucent warm-white background.
- The desktop Timeline header is a non-shrinking flex item, and its 10 px lower shadow uses a stable gradient instead of sampling the Map/Dayboard through a second backdrop blur, so dense Dayboard content cannot visually erode the header edge.
- Route-edit masking begins at the Dayboard's right edge, the workspace fills the viewport bottom without a gap, and destination markers remain fully opaque while editing.
- The Map search control is 38 px high with a 10 px liquid-glass radius. Route-edit and add-point buttons sit to its right.
- The member control is 38 px high. Its avatar stack grows left as members increase, while the divider and invite icon stay anchored at the right edge in the order `avatars | invite`.
- Share, More, and Map-collapse controls are consistently 38 x 38 px. The Map-collapse control uses the liquid-glass tokens and shows Lucide `PanelRightClose` while the Map is open, then the existing Map icon while collapsed.
- The current Map liquid-glass tokens use `rgba(255, 255, 255, .4)` for the supported surface, `rgba(255, 255, 255, .55)` for the border, `rgba(20, 55, 46, .92)` for fallback, `blur(8px)`, and `saturate(140%)`. The Dayboard background and border reference the same shared tokens in both fallback and supported states.
- Timeline visit cards, transportation cards, collapsed-day preview cards, Day tabs, the add-itinerary button, and Dayboard editing forms use a translucent solid surface (`rgba(255, 255, 255, .85)`) without `backdrop-filter`.
- Timeline delete, transportation-delete, and move confirmation dialogs render through a body-level portal so their original full-viewport dimmer and centered white dialog are preserved above the glass Dayboard and Map.
- Missing-coordinate and route-edit status overlays are centered within the Map area that remains visible to the right of the Dayboard.
- The Map search control, route-edit button, and custom-point button use the Phase 5.8 liquid-glass tokens, including a deep-green fallback, translucent supported surface, white border, 8 px blur, 140% saturation, and reduced-motion-safe interaction states.
- Places suggestions align exactly with the search-field column rather than extending under the Map tool buttons, and reuse the search control's liquid-glass background, border, blur, saturation, radius, and fallback tokens.
- Starting custom-point picking keeps the search field and Map tool row in place. The search input and search action become disabled while the custom-point button retains its original position and switches to its cancel state.
- The Google logo remains visible immediately to the right of the Dayboard.
- Formal Timeline and Demo stay visually aligned where the same controls exist; existing cards, map-marker behavior, scrolling, editing, and collapse behavior remain intact.

## Phase 5.8 Scope Guard

- Keep Phase 5.8 UI-only unless the user explicitly expands scope.
- Do not change Broadcast, ownership, Presence, Realtime, route persistence, database, migration, RLS, RPC, Share/Invite, Auth, Budget, or itinerary write behavior.
- Preserve Map search, route editing, custom-point creation, Dayboard scrolling, Day-tab navigation, and collapsed-Map operation while polishing layout and styling.
- Continue small requested polish from the latest published implementation baseline instead of treating Phase 5.8 as a single large redesign.

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

## Verification

Latest Phase 5.8 verification:

- In-app Browser verification confirmed the member, Share, More, and Map-collapse controls render at 38 px; the divider/invite area remains fixed at the member control's right edge with five displayed avatar entries.
- Map collapse/reopen interaction passed: the collapsed state renders `lucide-map`, reopening restores `lucide-panel-right-close`, and browser console errors remained at zero.
- The latest Places/search-control implementation passes `npm.cmd run build`. Authenticated branch-preview verification confirmed exact search/menu alignment, the shared translucent glass tokens, persistent disabled search controls during custom-point picking, unchanged point-button position, and no browser console errors.
- User verified that the Timeline header lower edge remains visually complete with a dense Dayboard after the non-shrinking header and stable-gradient shadow fix.
- Phase 5.8 filtered browser smoke checks passed 5/5, including stable header geometry after adding 24 Dayboard cards and a body-level Timeline confirmation dialog with a full-viewport fixed dimmer, centered white card, and preserved 8 px radius.
- The full legacy smoke suite was also attempted: its first eight checks passed, then three unrelated Demo tail-transport timing cases reached their existing 30-second timeout; no confirmation-dialog check failed.
- Phase 5.8 desktop, tablet, mobile, and trip-title edit Playwright checks passed 4/4 through `44fd4d3`.
- Focused Map/provider route-edit and workspace checks passed 2/2 through `44fd4d3`.
- Chrome DOM inspection confirmed the latest `lucide-tally-4` Map-collapse control at `6c9fadd`.
- Chrome rendered-style inspection confirmed 38 px search/tool controls, the requested liquid-glass computed styles, and 0 px horizontal-center error for both Map status overlays.
- `npm.cmd run build` passed at `6c9fadd`.
- `npm.cmd run test:e2e -- tests/mapProviderPrep.spec.js` passed 38/38 for the latest Map polish.
- `npm.cmd run build` and `git diff --check` passed for the latest Map polish.
- After the shared-token update, `npm.cmd run test:e2e -- tests/mapProviderPrep.spec.js` passed 38/38 and `git diff --check` passed.
- `git diff --check` passed for the latest implementation change.
- The Vite large-chunk warning remains informational and was present in successful builds.

Closed Phase 5.7c deployed Chrome two-client QA passed:

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

Continue user-directed Phase 5.8 UI polish from the current published branch HEAD. Preserve the closed Phase 5.7c synchronization and Phase 5.7d visual-feedback behavior.
