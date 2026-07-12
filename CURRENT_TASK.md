# CURRENT_TASK.md

## Read First

- `AGENT.md`
- `docs/UX_RULES.md`
- `docs/BUGS.md`
- `docs/2026-06-22-phase-4-2c-closeout-handoff.md`
- `docs/2026-06-23-phase-4-4-closeout-handoff.md`
- `docs/2026-06-24-phase-4-5-closeout-handoff.md`
- `docs/2026-06-24-phase-4-5-hotfix-2-handoff.md`
- `docs/2026-06-24-phase-4-5-hotfix-3-handoff.md`
- `docs/2026-07-01-phase-4-8c2-collaborative-drag-presence-handoff.md`
- `docs/2026-07-01-phase-4-8e-online-member-presence-handoff.md`
- `docs/2026-07-01-phase-4-8f-remote-drag-visual-handoff.md`
- `docs/2026-07-01-phase-4-9-map-integration-prep.md`
- `docs/2026-07-01-phase-4-9a-map-marker-contract-handoff.md`
- `docs/2026-07-01-phase-4-9b-map-focus-surface-handoff.md`
- `docs/2026-07-01-phase-4-9c-google-map-provider-prep-handoff.md`
- `docs/2026-07-02-phase-5-0-map-mvp-readiness-audit-handoff.md`
- `docs/2026-07-02-phase-5-1a-static-demo-map-safety-handoff.md`
- `docs/2026-07-02-phase-5-1b-formal-google-map-loader-handoff.md`
- `docs/2026-07-02-phase-5-1c-formal-google-map-markers-handoff.md`
- `docs/2026-07-02-phase-5-1d-google-map-empty-state-fix-handoff.md`
- `docs/2026-07-02-phase-5-1e-google-map-layout-fill-fix-handoff.md`
- `docs/2026-07-02-phase-5-2-map-url-point-handoff.md`
- `docs/2026-07-03-phase-5-3b-marker-focus-closeout-handoff.md`
- `docs/2026-07-03-phase-5-4-route-lines-closeout-handoff.md`
- `docs/2026-07-05-phase-5-6-places-closeout-handoff.md`
- `docs/2026-07-11-phase-5-7c-node-collaboration-handoff.md`
- `docs/todo/phase-5-map-route-workspace-integration-handoff.md`
- `docs/2026-06-30-phase-4-8c-closeout-handoff.md`
- `docs/timeline-phase-4-drag-reorder-rules-draft-v14.md` (latest working draft)

Archive rule:

- `docs/archive/` contains historical discussions, superseded handoffs, and old drafts.
- Do not read archived files by default; consult them only when a task specifically needs older context.
- `docs/gpt/` no longer exists and must not be recreated.

## Current Phase

```text
Timeline Phase 5.7c-1 Node-level Collaborative Route Editing - Stabilization / Handoff
```

Next phase:

```text
Phase 5.7d has been merged into Phase 5.7c. Phase 5.7c keeps the same-day itinerary editable, has no 15-second idle exit, and treats custom route lines as secondary data that yields to itinerary changes. Collaborative route editing now uses a single route node as the minimum synchronization and persistence unit. Presence only represents low-frequency route-editor state, uses a 32-second heartbeat, and deduplicates the editor label by user. Node locks and node add/move/delete previews use Broadcast; drag moves are latest-wins at 120 ms. PostgreSQL persists every custom node independently in `itinerary_route_override_nodes`, while `itinerary_route_overrides` remains the segment container. Channel health is checked silently on heartbeat, focus, online, and visibility recovery; replacement channels reload authoritative nodes before editing resumes. The final stabilization fixes keep remote previews across same-node handoff, release stale local ownership when a new remote owner starts, store pending final commits per `segmentKey + nodeId`, make preview-only deletes persist, and restore authoritative pre-delete node rows plus the inverse Broadcast event after a failed DELETE. Deployed Chrome QA now covers add/delete, simultaneous different-node drag, five-node limit, editor deduplication, 319-second background recovery, endpoint invalidation, failure rollback, normal-delete regression, and refresh convergence. Phase 5.7c is not yet closed: itinerary reorder/delete invalidation and repeated alternating same-node dual-account soak remain the final manual QA gaps. The damaged historical plan in `docs/todo/2026-07-09-phase-5-7c-collaborative-route-edit-plan.md` is not authoritative; use the new 2026-07-11 handoff.
```

Branch:

```text
codex/timeline-phase-5-7
```

## Completed Scope

### Phase 4.0 to 4.2c

- Completed Phase 4 analysis and protected-scope audit.
- Added valid tail transportation cards with `to_item_id = null`.
- Defined destination packages and child relationship behavior.
- Added insertion-style timed-visit destination-package reorder.
- Kept visit IDs and time slots fixed during reorder.
- Alternatives and linked budgets follow destination packages.
- Invalidated transportation cards are removed; replacements are never generated automatically.
- Formal reorder uses the applied 020/021 RPC path; Demo uses shared pure planning logic and local React state.

### Phase 4.3

- Added the timed-visit prompt when a new or edited visit breaks an existing normal transportation pair `A -> B`.
- Existing invalid-time and same-day-overlap validation remains higher priority.
- Restore keeps the editor open without saving or deleting transportation.
- Delete Transportation saves the visit and removes the broken transportation card.
- Formal preserves draft, edit-lock, optimistic-locking, Realtime reload, and failure safety behavior.
- Demo provides matching behavior using mock data and local React state only.
- Tail transportation is outside the Phase 4.3 prompt scope.

### Phase 4.4

- Added explicit local auto-continuation after editing an existing timed visit's `start_time` or `end_time`.
- The editor actions are ordered `取消 / 接續 / 儲存`.
- Normal Save updates only the edited visit and never opens the continuation prompt.
- Continue is enabled only after the existing timed visit's time changes and a later timed visit exists.
- Continue runs invalid-time, overlap, and Phase 4.3 transportation-pair checks before showing the confirmation.
- Cancelling the continuation confirmation returns to the active editor without saving.
- Confirming continuation shifts following timed visits while preserving each original visit duration and the original gap between visits.
- Earlier visits and untimed visits are never shifted.
- The original open-ended timed-visit behavior was superseded by the Phase 4.5 Hotfix: a visit missing either time is untimed.
- The first following fixed visit is a time anchor and is never moved.
- Movable visits that cannot fit before the fixed anchor, plus the remaining affected visits before that anchor, become untimed.
- Continuation stops at the fixed anchor; visits after it are unchanged.
- Foreign-locked, incomplete, invalid, or unsafe continuation data still blocks the batch safely.
- Formal validates trip/day/type/fixed/lock/`updated_at` baselines and defers lock release until the combined operation completes.
- Formal uses best-effort compensation if a downstream update or Phase 4.3 transportation deletion fails.
- Demo shares the pure continuation planner and applies the result in one local React-state update.
- No database migration or RPC change was required.
- User manually verified the final Phase 4.4 UX on 2026-06-23.

### Phase 4.5

- Added mixed same-day ordering for timed and untimed visits using the existing `itinerary_items.sort_order` field.
- Timed visits remain naturally ordered by `start_time`; untimed visits use a reserved negative `sort_order` encoding for their manual gap and rank.
- Active untimed drag changes only the source visit's display position and does not change timed visit times, destination packages, transportation cards, drafts, or locks.
- Active untimed drag into an existing valid transportation pair remains blocked with a lightweight inline message and no local/DB mutation.
- Formal untimed reorder is a guarded single-row update using trip/day/type/fixed/lock and `updated_at` checks; Demo uses shared pure planning and React local state only.
- Phase 4.5 initial automated QA passed 61/61 Playwright tests.

### Phase 4.5 Hotfix

- A visit is timed only when both `start_time` and `end_time` exist; all four complete/partial/empty combinations now use one shared classification.
- Clearing either time in the editor immediately clears the other; Formal and Demo save normalization persists either a complete pair or `null/null`.
- Partial visits do not participate in timed sorting, overlap, auto-continuation, transportation shortage, timed adjacency, or timed destination-package manifests.
- Passive untimed conversion is separate from active untimed drag. Existing transportation is not deleted, hidden, promoted to the top warning stack, rewritten as tail, or replaced.
- A timed visit that passively becomes untimed immediately receives an encoded untimed `sort_order` for its current display gap, so it remains in place instead of falling to the legacy untimed tail position.
- Phase 4.4 fixed-anchor overflow applies the same preservation rule to every converted visit while retaining their relative order.
- Every later timed-to-untimed conversion rebases all existing untimed gap encodings for that day from the pre-save display order. An earlier overflow visit therefore remains before its fixed anchor even when another timed visit above it later becomes untimed.
- Untimed visits never auto-fill or compact into newly available gaps. When visits change between timed and untimed in either direction, rebasing preserves the complete pre-save display order of every remaining untimed visit.
- While a retained transportation still has an untimed endpoint, a staged time restore preserves the transportation direction when its `from` and `to` visits would otherwise become reverse-adjacent. Restoring A and then B therefore keeps `A -> B` in order and returns the card to the normal adjacent flow once both are timed.
- Transportation with an existing untimed/partial endpoint stays anchored after its `from_item_id` visit and shows the existing compact warning UI: `目的地時間未設定，請重新確認交通卡。`
- Phase 4.4 fixed-anchor overflow and manual time clearing therefore preserve related transportation for manual review.
- No migration, RPC, or production DB change was required. Applied migrations 019/020/021 remain immutable.
- Hotfix commit: `5b75450 Fix Timeline Phase 4.5 partial time handling`.

### Phase 4.5 Hotfix 2

- Passive conversion to untimed still preserves existing transportation and its compact warning.
- Active drag of an untimed visit still rejects a target that would break an existing valid timed transportation pair before any confirmation appears.
- If the untimed source visit itself is linked by any transportation `from_item_id` or `to_item_id`, a legal drop now opens the existing `確認移動行程？` dialog.
- Cancel leaves the visit, transportation rows, local state, and Formal persistence unchanged.
- Confirm moves only the untimed source visit, deletes every transportation row linked to that source, and creates or rewrites no transportation.
- Formal validates the source and linked-transport baselines before writing, persists the source `sort_order`, deletes only the confirmed linked transportation IDs, and reloads authoritative trip data after success or failure.
- Demo performs the confirmed move and linked-transport deletion in one local React-state update without production-service calls.
- Timed visit times, Phase 4.4 auto-continuation, and the Phase 4.2c reorder RPC remain untouched.
- No migration or RPC change was required; applied migrations 019/020/021 remain immutable.

### Phase 4.5 Hotfix 3

- A retained tail transport remains a passive untimed warning while its endpoint is untimed.
- When that endpoint becomes timed again and is still the final timed visit, the same row automatically returns to the valid tail flow instead of the invalid transport stack.
- Tail restore does not delete, rewrite, or convert the transport into a normal pair.
- Editing a timed visit across a fixed timed visit disables only the `接續` action.
- The disabled continuation action explains: `跨越固定行程時無法接續。`
- Direct `儲存` remains enabled and succeeds when existing invalid-time and overlap validation pass.
- Phase 4.3 conflict detection now covers both inserting a new timed visit between an existing transportation pair and editing either endpoint so the original valid pair is no longer adjacent.
- Endpoint edits that break a pair open the existing Restore / Delete Transportation dialog before persistence; passive conversion to untimed remains outside this prompt.
- No migration, RPC, schema, production DB, or Playwright test change was made.

### Phase 4.6

- Timed visit drag now recalculates `start_time` / `end_time` instead of only swapping destination package content across existing time slots.
- Phase 4.6 timing only uses complete timed visits: rows missing either `start_time` or `end_time` stay untimed / partial and do not participate in duration-based continuation.
- Each moved/reordered timed destination package preserves its own original duration.
- The new first timed package starts at the original first complete timed visit start time.
- Same-direction adjacent pairs that remain adjacent preserve their original total gap.
- New adjacencies and direction reversals directly continue from the previous package end time.
- Untimed visits still use mixed visual order for drop target / display only; they do not create timing gaps and do not affect duration calculation.
- Formal timed drag calls the new transactional RPC `reorder_itinerary_timed_auto_continuation`.
- Demo timed drag uses the same pure planner via `timedAutoContinuation: true`.
- Existing `brokenTransportIds` confirmation / cleanup remains the transport removal gate.
- No automatic transportation card creation was added.
- Fixed card drag and fixed-anchor scheduling remain deferred to Phase 4.7.

New migration applied to production Supabase project `lqvuqamzmchepgxkftcw`:

```text
023 / 20260629014908 / reorder_itinerary_timed_auto_continuation
```

New/updated files:

- `src/lib/destinationPackages.js`
- `src/App.jsx`
- `supabase/migrations/023_reorder_itinerary_timed_auto_continuation.sql`
- `tests/phase-4-2c-reorder.spec.js`
- `tests/phase-1-7f-smoke.spec.js`
- `docs/2026-06-29-phase-4-6-closeout-handoff.md`

### Phase 4.7

- Fixed anchors are now true segment boundaries for timed drag continuation.
- A fixed anchor is only a complete timed visit with `is_fixed = true`.
- Untimed, partial-time, and legacy fixed untimed visits do not act as anchors.
- Fixed anchors themselves are not draggable and are not included in movable timed manifests.
- Non-fixed complete timed visits can be dragged across fixed anchors.
- A day is split into fixed-bounded recalculation segments.
- Segment timing reuses Phase 4.6 duration-preserving rules: original package duration is preserved, same-direction adjacent source pairs preserve original total gap, and new/reversed adjacencies directly continue.
- A segment with a left fixed anchor starts from that anchor's `end_time`.
- A segment without a left fixed anchor keeps Phase 4.6's original first-slot start rule.
- A segment with a right fixed anchor cannot pass that anchor's `start_time`.
- If a segment overflows into the next fixed anchor, the first non-fitting timed visit and the rest of that segment become untimed while preserving post-drag mixed visual order.
- If two fixed anchors have no available time space, the move is rejected with a friendly user-facing message.
- Demo and Formal both use the same fixed-aware pure planner.
- Formal timed drag now targets the new transactional RPC `reorder_itinerary_fixed_anchor_continuation`.
- Formal RPC payload includes package move, fixed-aware time recalculation, overflow untimed conversion, existing untimed sort rebase, and transport cleanup in one transaction.
- Existing `brokenTransportIds` confirmation remains the cleanup gate; cancelling the confirmation still avoids local state, DB, and transportation changes.
- No transportation cards are automatically created.

New migration file:

```text
supabase/migrations/024_reorder_itinerary_fixed_anchor_continuation.sql
```

Important: migration 024 was syntax-validated on Supabase with `BEGIN; ... ROLLBACK;`, then applied to production project `lqvuqamzmchepgxkftcw` as `20260629065754 / timeline_phase_4_7_fixed_anchor_continuation`. PostgREST schema cache reload was requested with `notify pgrst, 'reload schema';`.

New/updated files:

- `src/lib/destinationPackages.js`
- `src/lib/timelineUntimedOrdering.js`
- `src/App.jsx`
- `supabase/migrations/024_reorder_itinerary_fixed_anchor_continuation.sql`
- `tests/phase-4-2c-reorder.spec.js`
- `tests/phase-4-5-untimed-ordering.spec.js`
- `tests/phase-1-7f-smoke.spec.js`
- `docs/2026-06-29-phase-4-7-closeout-handoff.md`

### Phase 4.8

- Added dnd-kit Sortable interaction for Timeline visit cards.
- Installed and uses `@dnd-kit/core`, `@dnd-kit/sortable`, and `@dnd-kit/utilities`.
- Dragging a visit card now uses a floating `DragOverlay` while the source slot becomes an in-list placeholder.
- Other visit cards slide open during drag preview through dnd-kit sortable transforms.
- The floating overlay is measured from the original card so it matches the card width/height instead of becoming oversized.
- Drag preview remains local UI only: no `itinerary_items` writes, no reorder RPC, no time changes, no untimed conversion, no transportation mutation, no draft clearing, and no migration during drag.
- Drop still calls the existing Phase 4.7 timed reorder flow or the existing untimed reorder flow.
- Cancel, invalid target, Esc, or drag end without a valid target clears local drag state and leaves authoritative order unchanged.
- Fixed cards remain non-draggable.
- Timed and untimed existing drag rules remain preserved.
- Drop-after layout animation from dnd-kit is disabled through a custom `animateLayoutChanges` handler so cards keep the drag-preview feel without a second post-drop slide.
- Timeline gap was set to `8px`; the hidden transportation insert affordance is nested under the sortable visit entry so it does not create extra direct `.timeline` grid gaps.
- Transportation insert hover still expands between cards and is isolated from the sortable drag sensor via pointer/key event stop propagation.
- Formal and Demo use the same `ItineraryTimeline` and CSS, so preview behavior remains shared.
- Phase 4.8a follow-up keeps transportation cards as visual attachments of the previous destination sortable wrapper during drag preview; transportation cards still are not sortable items and are not draggable.
- Phase 4.8b Demo Timeline Data Parity Polish aligns Demo transport fixture shape with Formal fields including `transport_role`, `from_item_id`, `to_item_id`, snapshots, fixed metadata, and trip/day/sort fields.
- Demo newly added transportation cards now include `trip_id` and pair-adjacent `sort_order`, so the shared reorder planner preserves/remaps them like Formal data instead of leaving them outside the transport planning pass.
- Tail-pending transport promotion now has one narrow untimed bypass: when adding a timed visit C after tail source A promotes `tail_pending` into `tail_promoted_pair A -> C`, only untimed visits blocking A/C adjacency are rebased after C. Normal pairs, existing promoted pairs, unrelated untimed visits, invalid time placement, and days without tail-pending transport remain unchanged.
- Formal and Demo both use the same tail-pending promotion bypass helper; no Supabase migration, reorder RPC, or Phase 4.7 fixed-anchor/brokenTransportIds logic was changed.
- Floating overlay drag is constrained to vertical movement inside the active day board. The top bound aligns to the first timeline card/list position below the date header, and the bottom bound stays inside the active day board.
- Drag activation is limited to the left time block of a visit card. The rest of the card remains clickable for normal card interactions and does not start a drag.

### Phase 4.8c2

- Added authenticated Formal-only collaborative Timeline drag presence for active trip/day.
- Channel scope is `timeline-drag:{tripId}:{dayIndex}`.
- Supabase Realtime Presence is used only as a low-frequency soft lock for who is dragging.
- Supabase Realtime Broadcast is used for drag updates, heartbeat, remote insertion target, and clear events.
- Broadcast events:
  - `timeline-drag-update`
  - `timeline-drag-clear`
- Drag start creates a fresh `dragId`, tracks basic presence, and broadcasts the first update.
- Drag over broadcasts only target/placement changes.
- Heartbeat broadcasts every 3 seconds and does not call Presence `track()`.
- Drag cancel, invalid end, drop success/fail cleanup, unmount, day switch, trip switch, and logout cleanup broadcast clear and untrack presence.
- Foreign same-day drag presence disables that day's destination drag handles through the shared drag eligibility conditions.
- Foreign same-day drag presence shows the existing low-key `{userName} 正在拖曳` hint and muted insertion line.
- Phase 4.8c2 extends foreign same-day drag presence into a temporary same-day readonly lock for Timeline data-changing actions.
- Same-day readonly lock blocks destination drag, add/edit/delete itinerary items, add/edit/delete transportation cards, transportation warning confirmation, alternative add/edit/delete/swap, fixed toggle, auto-continuation save, and reorder confirmation save.
- Same-day readonly lock still allows expand/collapse, content viewing, Day switching, and section/page switching.
- If another user starts dragging while an editor is already open, the editor remains open and keeps its form content, but save/continuation actions are disabled and guarded with `此日行程正在被其他成員調整，請稍後再儲存。`
- Foreign same-day drag presence now shows `{userName} 正在拖曳，暫時鎖定此日編輯。` and a muted insertion line.
- Repeated same-account two-tab drag testing exposed a Realtime channel `CLOSED` state after several drags.
- Phase 4.8c2 tracks channel status separately from readiness, clears stale closed channel refs, recreates the same trip/day channel, and replays the local drag payload after `SUBSCRIBED`.
- Drag end/cancel/clear still does not remove the active timeline-drag channel; it only broadcasts clear, untracks presence, and clears local drag refs/state.
- `removeChannel(channel)` remains limited to active trip/day/user scope cleanup, component unmount, or internal replacement of a closed/errored/timed-out channel.
- `debugPresence=1` logs now include channel status on drag start, subscribe status, removeChannel reason, and skipped track reason.
- Remote DragOverlay / ghost card / preview order is not rendered or synchronized.
- B's list does not reorder from remote presence; official results still arrive only through the existing reorder RPC success plus Realtime/reload.
- Debug logging is gated behind `?debugPresence=1`.
- Demo remains local/unauthenticated and has no Supabase Presence or Broadcast wiring.
- No migration, new table, new package, reorder RPC change, Phase 4.7 fixed-anchor logic change, or brokenTransportIds logic change was made.

### Phase 4.8d

- Added collaborative Timeline card selection presence for authenticated Formal users.
- Selection is broadcast-only and never writes to the database.
- Destination card selection and transport card selection are supported.
- Broadcast payload includes `itemType: "destination" | "transport"`.
- Remote selected cards show a colored border/ring using the existing non-green 4.8d palette.
- Remote user name labels appear only on hover/focus and are positioned at the lower-right card edge.
- Local selection keeps the existing local UI and does not add a local border or self label.
- Same-account different-tab testing still treats the other tab as foreign by comparing `sessionId`, not only `userId`.
- Selection clears on Timeline blank click, Day switch, Timeline unmount, logout/trip change, and local drag start.
- Foreign selections stale out after 30 seconds.
- Multiple remote users selecting the same card collapse to the most recent foreign selection for this first version.
- Selection does not block editing, deleting, adding, drag, read-only lock, or reorder.
- Transport cards remain non-draggable and are not added to `SortableContext.items`.
- Demo remains disconnected from Supabase presence/broadcast.
- No migration, RPC, reorder flow, DragOverlay/preview sync, or package change was made.

### Phase 4.8e

- Added trip-level online member presence for authenticated Formal users.
- Channel scope is `trip-presence:{tripId}`.
- This trip-level channel does not replace the day-scoped `timeline-drag:{tripId}:{dayIndex}` channel.
- Presence payload tracks `tripId`, `userId`, `userName`, `sessionId`, `colorKey`, `pageKey`, `dayIndex`, selected Timeline item metadata, and `updatedAt`.
- Presence tracks on subscribe, supported page switch, Timeline Day switch, Timeline card selection, and a 28-second heartbeat.
- Remote trip presence older than 55 seconds is filtered from UI.
- Supported page keys include `overview`, `timeline`, `budget`, `accommodation`, `packing`, `settlement`, `settings`, and `todo`.
- Clicking another online member's avatar navigates to their supported page, and to their Timeline Day when `pageKey = "timeline"`.
- Own avatar does not jump and keeps the existing local style.
- Remote online member avatars use a single 2px non-green color border that replaces the default gray border.
- Day Tabs use a single 2px non-green color border when a remote online member is currently on that Timeline day.
- The earlier Day Tab small-dot indicator was removed after visual testing.
- Online presence is navigation-only and does not enable read-only lock, edit lock, drag lock, reorder behavior, or database writes.
- Trip-level debug logs use `[trip-presence] ...`, separate from `[drag-presence] ...`, and remain gated behind `?debugPresence=1`.
- `docs/BUGS.md` records `BUG-025` as a Known Issue / Low Priority: occasional foreign drag presence can still clear by stale timeout instead of immediate clear.
- Demo remains local/unauthenticated and has no trip-level presence wiring.
- No migration, RPC, reorder flow, DragOverlay/preview sync, schema change, database write, or package change was made.

### Phase 4.8f

- Added final remote-drag visual polish after collaborative drag presence user testing.
- Foreign drag source destination cards remain in their original list position.
- Foreign drag source cards now show the remote drag color border and reduced opacity.
- Foreign drag source cards do not use soft shadow after final visual tuning.
- Foreign drag source styling uses `timeline-item-remote-drag-source`.
- Remote insertion lines keep the existing `timeline-remote-insertion-line` class, use the remote drag color, and have stronger opacity.
- Insertion line margin was tuned back to `4px 10px` so the line stays visually centered inside the existing gap.
- Foreign drag source highlight takes priority over remote selection styling while a foreign drag is active.
- Remote selection remains broadcast-only and still supports destination and transport cards.
- Transport cards are still not sortable and do not receive remote drag source highlight.
- No remote DragOverlay, remote ghost card, remote placeholder, remote preview order, or remote list reflow was added.
- No migration, RPC, reorder flow, Demo presence, Map integration, or data-flow change was made.
- User verified Phase 4.8f as OK after the final visual tuning.

### Phase 4.9

- Completed Map Integration Prep as a read-only audit and implementation plan.
- Added `docs/2026-07-01-phase-4-9-map-integration-prep.md`.
- Current route/map surface is still `RoutePanel` + `.route-map`, not a real Google Map.
- Formal and Demo share the relevant Timeline render path through `ItineraryTimeline`, `RoutePanel`, `DayTabs`, `MultiDayTimelineColumns`, and Timeline workspace CSS.
- Existing schema already has `location_name`, `address`, `map_url`, `latitude`, and `longitude` on destination-bearing records, but Demo data mostly has null coordinates and there is no stable `place_id` / route polyline / route distance cache.
- Phase 4.9 should stay Google-first at the product level while keeping Timeline and RoutePanel provider-neutral.

### Phase 4.9a

- Added a pure provider-neutral map marker helper at `src/lib/timelineMapMarkers.js`.
- Exported `buildDayMapMarkers(dayItems, options?)`.
- The helper converts active-day Timeline destination/visit items into marker records without mutating input.
- Transportation cards are excluded from markers.
- Marker order follows the input/visual order passed into the helper; the helper does not sort or rebase items.
- Latitude/longitude strings are safely parsed into numbers when possible.
- Missing or invalid coordinates become `null` and do not throw.
- `hasCoordinates` is true only when both coordinates are finite numbers.
- `provider` and `providerPlaceId` are neutral reserved fields for future Google-first / provider-switchable adapters.
- `RoutePanel` now uses `buildDayMapMarkers(sortedVisitItems(dayItems), { requireLocation: true })` internally while preserving the existing route-stop UI and focus behavior.
- Added source-level Playwright coverage in `tests/timelineMapMarkers.spec.js`.
- Added handoff `docs/2026-07-01-phase-4-9a-map-marker-contract-handoff.md`.
- No Google Maps SDK, API key/env var, route calculation, map package, migration, RPC, reorder flow, dnd-kit structure, drag handle, collaborative presence, remote selection, online presence, transport role model, fixed-anchor planner, untimed rebase, or CSS layout change was made.

### Phase 4.9b

- Added provider-neutral focus helpers in `src/lib/timelineMapMarkers.js`.
- Exported `buildRoutePanelStops(dayItems, options?)`.
- Exported `getFocusedMapState(dayItems, markers, focusedItemId)`.
- Exported `getTransportEndpointMarkerIds(dayItems, markers, transportItemOrId)`.
- Destination focus now maps a Timeline destination card to the matching RoutePanel stop/future marker by marker id.
- RoutePanel stop click still focuses the matching Timeline destination card through the existing local `focusedItemId` state.
- Focused transportation cards now identify their `from_item_id` and `to_item_id` RoutePanel endpoint stops when those stops are available.
- Tail-pending transportation with `to_item_id = null` highlights only the source stop and does not throw.
- Missing transport endpoints do not throw and do not create placeholder markers.
- RoutePanel uses the same provider-neutral stop/focus helpers and does not introduce Google-specific naming or SDK objects.
- Added RoutePanel endpoint highlight classes:
  - `route-stop-transport-endpoint`
  - `route-stop-transport-from`
  - `route-stop-transport-to`
- The visible RoutePanel structure remains the existing `.route-map` / `.route-stop` placeholder surface.
- `focusedItemId` remains local UI state only.
- No database write, reorder RPC, drag preview, remote selection, drag presence, online presence, transport role model, Google Maps SDK, API key/env var, map package, route calculation, migration, or layout redesign was added.

### Phase 4.9c

- Added a provider-neutral `MapPanel` seam at `src/components/map/MapPanel.jsx`.
- Added `StaticMapProvider` as the default runtime provider for the existing `.route-map` / `.route-stop` placeholder surface.
- Added `GoogleMapProvider.lazy.jsx` as a lazy provider placeholder that currently falls back to the static provider and does not load any SDK.
- Added `loadGoogleMapProviderModule()` as the future dynamic import seam.
- Added pure provider config helper `src/lib/mapProviderConfig.js`.
- Added pure provider adapter input helper `src/lib/mapProviderAdapter.js`.
- `RoutePanel` now routes markers, focused map state, and `onFocusItem` through `MapPanel` while preserving the current visible route/map surface and focus behavior.
- The default map provider remains `static`.
- Google provider config is prepared as lazy-only and disabled for real SDK loading until a future approved phase.
- Added source-level Playwright coverage in `tests/mapProviderPrep.spec.js`.
- Added handoff `docs/2026-07-01-phase-4-9c-google-map-provider-prep-handoff.md`.
- No Google Maps SDK, API key/env var, map package, Leaflet/MapLibre/MapTiler/Stadia package, migration, Supabase schema change, RPC change, reorder flow, dnd-kit structure, drag handle, collaborative presence, remote selection, online presence, transport role model, fixed-anchor planner, untimed rebase, route calculation, route cache, or layout redesign was added.

New/updated files:

- `src/lib/timelineMapMarkers.js`
- `src/lib/mapProviderAdapter.js`
- `src/lib/mapProviderConfig.js`
- `src/components/map/MapPanel.jsx`
- `src/components/map/providers/StaticMapProvider.jsx`
- `src/components/map/providers/GoogleMapProvider.lazy.jsx`
- `src/App.jsx`
- `src/styles.css`
- `src/lib/timelineUntimedOrdering.js`
- `package.json`
- `package-lock.json`
- `tests/timelineMapMarkers.spec.js`
- `tests/timelineMapFocus.spec.js`
- `tests/mapProviderPrep.spec.js`
- `tests/phase-4-2c-reorder.spec.js`
- `docs/BUGS.md`
- `docs/2026-07-01-phase-4-9-map-integration-prep.md`
- `docs/2026-07-01-phase-4-9a-map-marker-contract-handoff.md`
- `docs/2026-07-01-phase-4-9b-map-focus-surface-handoff.md`
- `docs/2026-07-01-phase-4-9c-google-map-provider-prep-handoff.md`
- `docs/2026-07-01-phase-4-8e-online-member-presence-handoff.md`
- `docs/2026-07-01-phase-4-8f-remote-drag-visual-handoff.md`
- `docs/2026-06-30-phase-4-8b-demo-parity-handoff.md`
- `docs/2026-07-01-phase-4-8c2-collaborative-drag-presence-handoff.md`
- `docs/2026-06-30-phase-4-8c-closeout-handoff.md`
- `docs/timeline-phase-4-drag-reorder-rules-draft-v12.md`
- `docs/timeline-phase-4-drag-reorder-rules-draft-v13.md`
- `docs/timeline-phase-4-drag-reorder-rules-draft-v14.md`

### Phase 5.0

- Completed Map MVP readiness audit for the Phase 4.9a through 4.9c marker/focus/provider seam.
- Confirmed `MapPanel`, `StaticMapProvider`, `GoogleMapProvider.lazy`, `mapProviderConfig`, `mapProviderAdapter`, and `timelineMapMarkers` are ready for a narrow Phase 5.1 Google Map markers-only MVP.
- Confirmed the runtime still uses the static `.route-map` / `.route-stop` fallback and does not load Google Maps SDK.
- Confirmed source/package scan has no `google.maps`, `VITE_GOOGLE_MAPS_API_KEY`, Google Maps SDK script, Leaflet, MapLibre, MapTiler, Stadia Maps, Directions, Routes, Places, or Geocoding runtime coupling.
- Identified the main readiness gap as data completeness: `src/demo-kyoto-trip.json` has 31 destination-like items and 0 usable latitude/longitude pairs, so visible Demo Google markers need mock coordinates before Phase 5.1 visual QA.
- Confirmed Formal fallback should treat latitude/longitude as optional: missing, null, empty, or invalid coordinates must not throw and must fall back to static/list behavior.
- Confirmed Phase 5.1 needs outside-repo Google Cloud setup before real-map enablement: Maps JavaScript API, API key, HTTP referrer restrictions, local/Vercel env vars, billing, quota, and budget alerts.
- Documented Phase 5.1 boundary as Google Maps JavaScript API lazy load plus stored-coordinate destination markers only.
- Explicitly kept Places, Geocoding, Directions, Routes, route polyline, route cache, migration, marker drag, transportation repair, Timeline reorder changes, dnd-kit changes, drag presence, remote selection, online presence, and Budget integration out of Phase 5.1.
- Added handoff `docs/2026-07-02-phase-5-0-map-mvp-readiness-audit-handoff.md`.
- No source behavior, SDK, package, env file, migration, commit, or push was added.

### Phase 5.1a

- Added an explicit Demo/Formal map mode boundary for the Timeline route surface.
- Demo Timeline now passes `mode="demo"` into `RoutePanel`; Formal passes `mode="formal"`.
- `MapPanel` forwards mode into `getMapProviderConfig()`.
- `getMapProviderConfig({ mode: "demo" })` now always returns static provider config, even if a future caller requests Google provider and real-map loading.
- `StaticMapProvider` now displays coordinate-bearing static markers on the existing grid surface.
- Missing-coordinate destinations remain in the fallback route-stop/list surface and do not throw.
- Static markers call `onFocusItem(marker.itemId)` and reuse the existing focus / transportation endpoint class model.
- Added 16 numeric mock coordinate pairs to `src/demo-kyoto-trip.json`, covering Day 0 through Day 2:
  - Day 0: 3 coordinate-bearing destination-like items.
  - Day 1: 7 coordinate-bearing destination-like items.
  - Day 2: 6 coordinate-bearing destination-like items.
- Added source-level tests for Demo provider safety and Demo coordinate-bearing markers.
- Added handoff `docs/2026-07-02-phase-5-1a-static-demo-map-safety-handoff.md`.
- No Google Maps SDK, API key/env file, map package, Places, Geocoding, Directions, Routes, route calculation, route cache, migration, Supabase schema/RPC/RLS change, Timeline reorder change, dnd-kit change, drag/presence change, remote selection change, online presence change, transport role change, or Budget integration was added.

### Phase 5.1b

- Installed the approved package `@googlemaps/js-api-loader`.
- Added `src/lib/googleMapsLoader.js` with `loadGoogleMapsApi({ apiKey })`.
- Loader helper creates the `Loader` instance inside the function, fails safely without an API key, imports only the Maps library, and does not read `window.google.maps` or inject scripts at module top level.
- Added Formal provider selection using `VITE_MAP_PROVIDER` and `VITE_GOOGLE_MAPS_API_KEY`.
- `MapPanel` now lazy imports `GoogleMapProvider.lazy` only when Formal config allows real Google loading.
- Demo mode remains hard-locked to `StaticMapProvider` even if a future caller requests Google provider and real-map loading.
- `GoogleMapProvider.lazy.jsx` now runs a loader smoke path, shows a `Google Map ready` placeholder after loader success, and falls back to `StaticMapProvider` while loading or after loader failure.
- Added `.env.local` to `.gitignore`.
- Added source-level tests for Formal Google provider gating, Demo static safety, missing-key loader failure, and approved package boundaries.
- Added handoff `docs/2026-07-02-phase-5-1b-formal-google-map-loader-handoff.md`.
- No API key/env file, real Google map instantiation, marker rendering, marker interaction, Places, Geocoding, Directions, Routes, route calculation, route cache, migration, Supabase schema/RPC/RLS change, Timeline reorder change, dnd-kit change, drag/presence change, remote selection change, online presence change, transport role change, or Budget integration was added.

### Phase 5.1c

- Implemented Formal Google Map markers-only rendering inside `GoogleMapProvider.lazy.jsx`.
- Google map instantiation now happens only after lazy provider import and loader success.
- Google provider renders only provider-neutral destination markers with `hasCoordinates === true`.
- Missing-coordinate destinations do not create Google markers and do not throw.
- Transportation cards do not create Google markers because the marker helper excludes them.
- Marker click calls `onFocusItem(marker.itemId)` and only updates local Timeline focus state.
- Timeline destination focus pans the Google map to the matching marker and raises marker `zIndex`.
- Active-day marker changes clean up old Google markers and render the current marker set.
- Single-marker days center on that marker; multi-marker days fit bounds.
- Missing key, loader failure, render failure, loading state, and no coordinate-bearing markers all fall back to `StaticMapProvider`.
- Demo remains hard-locked to `StaticMapProvider` and does not enter the Google provider path.
- Added source-level tests for markers-only Google provider boundaries.
- Added handoff `docs/2026-07-02-phase-5-1c-formal-google-map-markers-handoff.md`.
- No API key/env file, Places, Geocoding, Directions, Routes, route calculation, route polyline, route cache, marker clustering, marker drag, AdvancedMarkerElement, migration, Supabase schema/RPC/RLS change, Timeline reorder change, dnd-kit change, drag/presence change, remote selection change, online presence change, transport role change, or Budget integration was added.

### Phase 5.1d

- Fixed Formal Google provider empty/no-coordinate active day behavior.
- Google provider no longer falls back to `StaticMapProvider` just because the active day has no coordinate-bearing markers.
- After loader success, empty days and no-coordinate days now instantiate the Google base map.
- Empty/no-coordinate days center on Kyoto using `lat: 35.0116`, `lng: 135.7681`, `zoom: 11`.
- Empty/no-coordinate days show a small Google-map overlay hint: `This day has no coordinate markers yet`.
- Provider and mode env-style values are normalized with trim/lowercase, so `VITE_MAP_PROVIDER=google`, `VITE_MAP_PROVIDER=google `, and `VITE_MAP_PROVIDER=GOOGLE` all resolve to the Formal Google provider when an API key exists.
- Demo mode normalization still forces `StaticMapProvider` even if env-style values request Google.
- Coordinate-bearing destination marker behavior from Phase 5.1c is preserved.
- Missing key, loader failure, lazy import failure, and fatal render failure still fall back to `StaticMapProvider`.
- Demo remains hard-locked to `StaticMapProvider` and does not enter the Google provider path.
- Added source-level test coverage for the empty/no-coordinate Google base map behavior.
- Added handoff `docs/2026-07-02-phase-5-1d-google-map-empty-state-fix-handoff.md`.
- No API key/env file, package, Places, Geocoding, Directions, Routes, route calculation, route polyline, route cache, marker clustering, marker drag, AdvancedMarkerElement, migration, Supabase schema/RPC/RLS change, Timeline reorder change, dnd-kit change, drag/presence change, remote selection change, online presence change, transport role change, or Budget integration was added.

### Phase 5.1e

- Fixed Formal Google map layout so `GoogleMapProvider` fills the right-side RoutePanel map surface.
- Prevented the old static grid surface from leaking below the Google map.
- Kept the empty/no-coordinate hint as an overlay instead of layout content.
- Passed `viewportKey` through `RoutePanel` and `MapPanel` to `GoogleMapProvider`.
- Preserved user-adjusted Google map viewport during same-day rerenders after pan/zoom.
- Allowed day tab or marker-set changes to re-enable automatic map positioning.
- Demo remains hard-locked to `StaticMapProvider`.
- Added handoff `docs/2026-07-02-phase-5-1e-google-map-layout-fill-fix-handoff.md`.
- No loader behavior, provider selection, API key/env file, Places, Geocoding, Directions, Routes, route calculation, route cache, migration, Timeline reorder, dnd-kit, drag/presence, remote selection, online presence, transport role, or Budget integration was changed.

### Phase 5.2

- Added Phase 5.2 map point sync for destination Map URL input.
- Destination Map URL parsing is wired into hidden coordinate persistence through `normalizeMapPointFields(payload)`; the UI still does not expose manual latitude/longitude fields.
- `parseMapUrlToPoint()` supports full Google Maps coordinate formats and now prioritizes place coordinates before viewport center coordinates:
  - `!3dlat!4dlng`
  - `q=lat,lng`
  - `ll=lat,lng`
  - `@lat,lng`
- Original 5.2 behavior treated `maps.app.goo.gl` short URLs as safe failures without throwing or network expansion; Phase 5.2c supersedes this with a host-limited Edge Function resolver.
- Clearing a destination Map URL now clears `latitude` and `longitude`.
- After Map URL and coordinates are cleared, `buildDayMapMarkers()` no longer emits a marker for that destination.
- Missing coordinate count increases correctly after a destination point is cleared.
- Destination add/edit save now requires a valid parsable Map URL before persistence.
- Blank Map URL blocks save and shows label-level feedback: `請貼上有效 Map URL`.
- Invalid or short Map URL blocks save and shows label-level feedback: `無法取得有效點位`.
- Map URL errors render to the right of the `Map URL` label via `.field-label-row` / `.field-inline-error`; no toast, success state, card badge, or large red frame was added.
- A parsable full Google Maps URL saves successfully and persists parsed `latitude` / `longitude`.
- Existing marker-to-card focus/scroll guard remains in place: focused marker can scroll the active Timeline card, while drag/edit/foreign-drag prompt states are protected.
- Demo remains hard-locked to `StaticMapProvider`.
- Added handoff `docs/2026-07-02-phase-5-2-map-url-point-handoff.md`.
- Commits pushed on `codex/timeline-phase-5-2`:
  - `377c24a Implement Timeline Phase 5.2 map point sync`
  - `8d974a6 Fix map URL clearing and coordinate parsing`
  - `f3d1de9 Require valid destination map URLs`
- No Places, Geocoding, Directions, Routes, route polyline, route cache, search UI, custom point picker, package, migration, Supabase schema/RPC/RLS change, Timeline reorder, dnd-kit, drag/presence, remote selection, online presence, transportation flow, or Budget integration was added.

### Phase 5.2c

- Added a Supabase Edge Function resolver for Google Maps short links.
- Edge Function name: `resolve-google-maps-url`.
- Frontend detects Google Maps short URLs before save and invokes the resolver only for allowed short hosts.
- Allowed short input host:
  - `maps.app.goo.gl`
- `goo.gl/maps` is recognized by the frontend helper as a Google Maps short URL shape, but the first Edge Function allowlist is intentionally stricter and only accepts `maps.app.goo.gl`.
- The Edge Function performs server-side manual redirect following and validates each redirect target against a Google Maps host allowlist before fetching the next URL.
- Allowed fetch/redirect hosts:
  - `maps.app.goo.gl`
  - `www.google.com`
  - `google.com`
  - `maps.google.com`
- Redirects to non-HTTPS, localhost, private IPs, arbitrary domains, or unsupported hosts are rejected by exact host allowlist checks.
- The frontend parses the returned `expandedUrl` with the existing `parseMapUrlToPoint()` flow.
- Successful short-link saves store `expandedUrl` as `map_url`, not the original short URL, so refresh/day switch can rebuild coordinates without another resolver call.
- Failed resolver calls, expanded URLs without coordinates, and unsupported URLs keep the editor open and show the existing Map URL label-level error.
- Submit is disabled while a short URL is resolving to avoid duplicate saves.
- Added `src/lib/googleMapsShortLinkResolver.js`.
- Added `supabase/functions/resolve-google-maps-url/index.ts`.
- No package, migration, Google API key, Places, Geocoding, Directions, Routes, route polyline, route cache, search UI, custom point picker, Timeline reorder, dnd-kit, drag/presence, remote selection, online presence, transportation flow, or Budget integration was added.

### Phase 5.3

- Fixed the destination add editor position so a new destination editor renders at the bottom of the active day's timeline flow instead of above existing items.
- If the active day has a tail transportation card, the new destination editor appears after that tail transportation card.
- Added a single icon button beside the destination editor `Map URL` label for editor-side map point picking.
- Formal Google map picking mode shows the existing bottom overlay text `點擊地圖設定位置`, listens for Google map clicks only inside `GoogleMapProvider.lazy.jsx`, and remains provider-neutral above the lazy provider.
- Clicking the Formal Google map during picking fills the active destination editor hidden `latitude` / `longitude` values and sets `map_url` to `https://www.google.com/maps?q={lat},{lng}`.
- Picked coordinates are only form state until the user presses Save; the existing Phase 5.2 validation/save flow still controls DB writes.
- Completing a pick briefly shows `已設定地圖位置` and exits picking mode.
- Pressing the same icon again, clicking outside the map, closing the editor, saving, or collapsing the route map cancels picking without clearing existing Map URL or coordinates.
- Demo remains hard-locked to `StaticMapProvider`; the picker path is disabled and does not load the Google Maps SDK.
- Phase 5.3 hotfix scrolls/focuses the bottom add editor into view after pressing Add Destination and adds a small gap above it.
- Phase 5.3 hotfix changes the Formal Google map cursor to `crosshair` only while map point picking is active.
- Commits pushed on `codex/timeline-phase-5-2`:
  - `0865ac5 Implement timeline phase 5.3 map point picker`
  - `86cd7d2 Polish timeline phase 5.3 editor picker UX`
- User manually verified Phase 5.3 hotfix OK.
- No marker focus/zoom polish, Map-area add-point button, Places, Geocoding, Directions, Routes, route polyline, route cache, search UI, package, migration, Supabase schema/RPC/RLS change, Timeline reorder, dnd-kit, drag/presence, remote selection, online presence, transportation flow, or Budget integration was added.

### Phase 5.3b

- Added Formal Google marker focus / fixed zoom polish.
- Clicking a Timeline destination card focuses the matching map marker and sets Formal Google map zoom to `15`.
- Clicking a Google marker continues to focus/scroll the corresponding Timeline card and now also updates that Google marker's active/focused style.
- Focused Google markers use the standard Google `Marker` API only: higher `zIndex`, a larger circle symbol icon, white label text, and stronger stroke.
- Non-focused markers restore to default label/icon state when focus changes.
- Marker creation no longer depends on `focusedMarkerId`, preventing focus changes from rebuilding markers or re-running bounds fitting.
- Phase 5.3b hotfix keeps movement on Google Maps `panTo` instead of custom animation, with zoom fixed at `15`.
- Marker focus remains suppressed during map point picking mode.
- Destinations without valid coordinates do not create Google markers and do not change map zoom.
- Demo remains hard-locked to `StaticMapProvider`; no Google SDK path was introduced for Demo.
- Added closeout `docs/2026-07-03-phase-5-3b-marker-focus-closeout-handoff.md`.
- Commits pushed on `codex/timeline-phase-5-2`:
  - `b05f72c Polish timeline phase 5.3b marker focus`
  - `498f0ef Fix timeline phase 5.3b marker focus polish`
- User manually verified Phase 5.3b hotfix OK.
- No AdvancedMarkerElement, marker clustering, marker drag, animation, Places, Geocoding, Directions, Routes, route polyline, route cache, search UI, package, migration, Supabase schema/RPC/RLS change, Timeline reorder, dnd-kit, drag/presence, remote selection, online presence, transportation flow, or Budget integration was added.

### Phase 5.4

- Added Formal Google simple route lines between valid same-day destination coordinates.
- Route lines are provider-local Google `Polyline` visuals only; they do not use Directions API, Routes API, route calculation, route cache, or duration/transport logic.
- Google marker labels now use the same destination sequence number as the Timeline.
- Timeline destination cards show a low-key top-left sequence number as plain 12px text with no border/background.
- Transportation cards remain unnumbered and do not produce markers or route-line points.
- Destination sequence, marker output, route-line participation, and missing-coordinate counts now share the same transportation-card definition: only `item_type === "transport"` is a transportation card.
- Destination / visit cards with category/type `transport`, such as airports, stations, parking lots, rental-car points, and ports, remain destinations. If they have valid coordinates, they keep destination sequence numbers, save `latitude` / `longitude`, produce markers, and participate in route lines.
- Old-card Map URL save polish keeps validated hidden `latitude` / `longitude` in the destination editor update payload.
- Commits pushed on `codex/timeline-phase-5-2`:
  - `723308d Implement timeline phase 5.4 route lines`
  - `80bc987 Polish timeline destination sequence badge`
  - `350a713 Preserve validated timeline map coordinates on save`
  - `b1feb1c Fix transport-category destination map markers`
  - `684b162 Fix map point handling for transport-category destinations`
- User manually verified Phase 5.4 and hotfixes. Manual QA: ALL PASS.
- No Places, Geocoding, Directions, Routes API, route calculation, route cache, search UI, package, migration, Supabase schema/RPC/RLS change, Timeline reorder, dnd-kit, drag/presence, remote selection, online presence, transportation repair flow, or Budget integration was added.

### Phase 5.5

- Added Formal Google map-area custom point add flow.
- The Map-area add button lives in the Google map overlay bottom-left as a temporary placement.
- Clicking the Map-area add button enters provider-local map point picking mode; clicking the Google map fills a pending custom point coordinate and opens the existing destination add editor path.
- The flow preserves provider-neutral map point contracts and does not change Timeline drag/reorder, transport logic, Budget, Supabase schema/RPC/RLS, or migration behavior.
- Demo / StaticMapProvider fallback remains static and does not receive the Formal Google map-area add flow.
- Commit pushed on `codex/timeline-phase-5-5`: `7ccb445 Implement timeline phase 5.5 map add flow`.

### Phase 5.6a

- Prepared Places Library gating and cost guards without adding visible Places UI.
- Places is available only for Formal Google provider when an API key exists and `VITE_GOOGLE_MAPS_PLACES_ENABLED=true`.
- Added provider-safe Places config and adapter seams while keeping Demo static-only.
- Added autocomplete session-token management and minimal Place Details normalization/cost guard utilities for later phases, but did not call Place Details from the UI.
- No editor behavior, Supabase write, API, migration, route service, geocoding flow, package, or committed API key was added.
- Commit pushed on `codex/timeline-phase-5-5`: `42ad978 Prepare timeline phase 5.6a places gating`.

### Phase 5.6b

- Added a Formal Google Places Autocomplete search box inside the Google map overlay.
- Autocomplete is gated by Formal Google provider readiness, Places library readiness, API key availability, and `VITE_GOOGLE_MAPS_PLACES_ENABLED=true`.
- Requests are debounced at 350ms, skip short inputs under 2 characters, and reuse a Places autocomplete session token until reset.
- Candidate clicks are selection-only: they set selected prediction/input UI state and reset the session token, but do not fetch Place Details, create items, open editors, save coordinates, or write Supabase.
- Phase 5.6b hotfix hides the old route panel `ROUTE / 路線` heading only when `.places-search-overlay` exists in the Formal Google route panel, avoiding overlap with the search input.
- Demo / StaticMapProvider fallback keeps the original route overlay/heading behavior and remains unaffected.
- Commits pushed on `codex/timeline-phase-5-5`:
  - `c288687 Add timeline phase 5.6b places autocomplete`
  - `7818914 Hide route heading behind places search`
- No Place Details call, Geocoding, Directions, Routes API, route calculation, route cache, editor open, Supabase write, API, migration, package, or committed API key was added.

### Phase 5.6c

- Upgraded Formal Google Places Autocomplete prediction click from selection-only to details-to-add-editor flow.
- Prediction click reuses the current autocomplete session token for Place Details and resets the token only after the details flow succeeds, fails, or returns no usable location.
- Place Details uses only the approved minimal field mask: `id`, `displayName`, `location`, and `googleMapsUri`.
- `formattedAddress`, ratings, reviews, photos, opening hours, phone numbers, website, price level, business status, editorial summaries, and generative summaries remain blocked by the high-cost field guard.
- Successful details results open the existing active day destination add editor with `title` / `location_name`, `map_url`, `latitude`, and `longitude` prefilled.
- If `googleMapsUri` is missing, the editor map URL falls back to `https://www.google.com/maps?q={lat},{lng}`.
- Failed details requests or details results without usable coordinates show an inline Places search overlay error and do not open the editor or write Supabase.
- Save remains the only path that persists the new destination.
- Demo / StaticMapProvider fallback remains static-only and does not render the Places search box or call Places.
- No POI click add, Text Search, Nearby Search, Geocoding, Reverse Geocoding, Directions API, Routes API, route calculation, route cache, address auto-fill, marker drag, marker clustering, AdvancedMarkerElement migration, package, API key/env commit, Supabase migration, schema/RPC change, Timeline reorder change, drag/presence change, Budget integration, transportation repair flow, or automatic transportation card creation was added.

### Phase 5.6d

- Added a full preview dialog between successful Places details and opening the add editor.
- Autocomplete suggestion click now fetches minimal Place Details, pans/zooms the Google map to the result, shows a preview marker, and displays a marker-anchored preview dialog.
- The preview dialog shows the place name, a Google Maps link, coordinate availability text, an Add to itinerary button, and a close button.
- The preview dialog is anchored to the selected place location using provider-local Google map projection behavior, not fixed to the map corner.
- Clicking Add to itinerary opens the existing active day destination add editor with `title` / `location_name`, coordinate `map_url`, `latitude`, and `longitude` prefilled.
- Closing the preview does not open an editor and does not write Supabase.
- Preview marker / dialog do not become itinerary markers, route-line points, sequence numbers, focused items, Timeline scroll targets, or missing-coordinate count inputs.
- Demo / StaticMapProvider remains unaffected.
- Related pushed commits:
  - `e0c99a7 Add places search result map preview`
  - `f49122f Anchor places preview dialog to map marker`
  - `ce0a172 Polish places preview dialog styling`

### Phase 5.6e

- Added Formal Google map POI click support through a cost-guarded pending marker flow.
- Clicking a Google map built-in POI does not call Place Details.
- POI click creates a provider-local pending marker and a small marker-anchored hint label.
- Clicking the pending marker or hint calls minimal Place Details.
- If the same `placeId` is already in the provider-local details cache, clicking the pending marker/hint uses cached details instead of refetching.
- Successful details clears the pending marker/hint and shows the existing full preview dialog.
- The old mini POI confirm dialog was removed.
- Map blank click, map outside click, day switch, map picking activation, provider reset, and unmount clear pending marker/hint state.
- Map-area custom point picking remains higher priority; when picking is active, POI click does not create a pending marker or call Details.
- Pending marker / hint are provider-local only and do not affect itinerary markers, route lines, sequence numbers, focused item state, Timeline scrolling, missing-coordinate counts, or Supabase writes.
- Related pushed commits:
  - `a40b029 Add places POI click preview confirm`
  - `ccb454d Replace POI mini confirm with pending marker`
  - `c4c5926 Add pending POI marker hint`
  - `2de7dbf Polish pending POI hint placement`

### Phase 5.6f

- Polished Places search input UX and cost guards.
- Autocomplete debounce is now 700ms.
- IME composition is guarded so composition input does not trigger Autocomplete prematurely.
- Enter and search icon trigger immediate search only when not composing.
- Same-query guard prevents duplicate Autocomplete requests caused by rerender, focus, Enter/icon after debounce, or setting selected text.
- Search box placeholder and aria label now display the literal primary label instead of escaped unicode text.
- Search box and suggestion list styling was tuned for the Formal Google map overlay.
- Successful suggestion details preview keeps the input populated with a primary place name instead of the full suggestion/address string.
- Selected input text priority is `details.displayName`, then `prediction.mainText`, then the original input query.
- Suggestion list closes after successful details preview.
- Add to itinerary clears the input and suggestion list, clears preview, and opens the existing add editor.
- Preview cancel clears the input and suggestion list, clears preview, and does not open an editor.
- Details failure or missing usable coordinates preserves the user's original input and does not open preview/editor.
- Manual QA passed after the final Phase 5.6f hotfix.
- Related pushed commits:
  - `96c69ed Improve places search input UX guards`
  - `24f019d Polish places search box styling`
  - `c373108 Tune places search debounce and radius`
  - `23ff2dc Adjust places preview search clearing`
  - `5a7016a Use primary text for selected place input`

### Phase 5.6g

- Added optional viewport `locationBias` to Formal Google Places Autocomplete requests.
- `GoogleMapProvider.lazy.jsx` keeps the Google-specific `map.getBounds()` conversion provider-local and stores only a plain `{ north, east, south, west }` bounds literal in a ref.
- Map `bounds_changed` / `idle` updates refresh the latest bounds ref without triggering Autocomplete by themselves.
- Debounced search, Enter, and search icon requests use the latest available bounds at request time.
- If map bounds are unavailable, Autocomplete still runs without `locationBias` and does not throw.
- No `locationRestriction`, strict bounds, Text Search, Nearby Search, Geocoding, Directions, Routes, Place Details field mask change, migration, package, API key/env commit, or Demo flow change was added.
- Existing suggestion success, full preview, POI pending marker, q=lat,lng editor map_url, and Save-only DB write behavior is preserved.
- Manual QA passed after Phase 5.6g implementation.
- Latest pushed commit: `0b7fe16 Add places autocomplete viewport bias`.

### Phase 5.7a

- Added transportation-card Google Maps navigation URLs from paired endpoint coordinates.
- Navigation buttons are icon-only with Chinese `title` / `aria-label`, shown on collapsed cards, expanded cards, and transportation editor rows.
- Flight navigation intentionally leaves `travelmode=` blank so Google Maps can choose the best route.
- Added gated Google Routes duration query support using `VITE_MAP_PROVIDER=google`, formal mode, an available Google Maps API key, and explicit routes-query enablement.
- Routes requests are duration-only and use `X-Goog-FieldMask: routes.duration`; no route lines, polylines, cache, override, migration, package, env, or committed API key was added.
- Transportation editor query UI is now an in-card Query Mode: `[查詢交通]` switches the editor body to query controls, `[取消]` returns without applying, `[查詢]` updates query state only, and `[套用]` fills the form without saving.
- General editor mode keeps `[查詢交通]` on the left and `[保存] [取消]` on the right; Save remains the only persistence action.
- Transit query UI only shows preferred vehicle types: `公車`, `地鐵`, `火車`, and `電車及輕軌電車`.
- Transit payload omits `allowedTravelModes` when all or none are selected, sends it only for partial selections, and never sends `routingPreference` or driving `routeModifiers`.
- Driving query options may send `avoidHighways`, `avoidTolls`, and `avoidFerries`; these modifiers are not sent for transit.
- Added gated `?debugRoutes=1` console logging with sanitized travel mode, allowed modes, field mask, routing/modifier flags, routes length, and error status/message. API keys are not logged.
- Transportation title/action layout was tightened so long titles ellipsize and do not collide with navigation/edit/delete buttons.
- Related pushed commits:
  - `e883fdf Add timeline phase 5.7a transport navigation`
  - `de94045 Polish timeline phase 5.7a transport controls`
  - `10585bc Polish transport editor query controls`
  - `02de5b4 Replace transport query panel with editor mode`
  - `e422325 Tighten transport query mode layout`
  - `2f610ed Fix transport editor grid alignment`
  - `1bdbcea Fix transit route query payload`

### Phase 5.7c-1

- Phase 5.7d multiplayer node collaboration was merged into Phase 5.7c.
- Multiple users can enter route edit mode without locking same-day itinerary editing.
- Custom route nodes have stable IDs and are persisted independently in `itinerary_route_override_nodes`.
- Broadcast events are node-level: `node-add`, `node-drag-start`, `node-drag-move`, `node-drag-end`, and `node-delete`.
- Presence is editor-state only; node locks moved to Broadcast to avoid Presence rate-limit and channel churn.
- Drag preview uses 120 ms latest-wins delivery and imperative marker/polyline updates instead of rebuilding all markers.
- Remote updates are retained per node, stale sequences are fenced by session/drag/version, and drag-end final coordinates supersede delayed moves.
- Channel recovery is silent, deduplicated, and reloads authoritative route nodes before re-enabling drag.
- Local final ownership remains until authoritative acknowledgement, but a new remote owner can take over the same node.
- Pending local commits are now stored per `segmentKey + nodeId`; quickly dragging P2 no longer overwrites P1's pending final commit.
- Node add/delete are optimistic Broadcast operations with node-level DB persistence and inverse-event rollback on failure.
- Delete stabilization now releases any unacknowledged local drag final for the same node, clears stale remote previews, lets a remote `node-delete` supersede local-final priority, and fences late drag-save responses so they cannot visually restore an already deleted handle.
- Authoritative segment invalidation now clears every stale remote node preview and pending local final for a segment that transitions from present to absent. This prevents endpoint-coordinate or itinerary invalidation from deleting the DB override while another client visually reconstructs it from old `node-add` / `node-drag-end` previews.
- `loadTripData` now compares incoming itinerary endpoint coordinates against the previous authoritative snapshot and removes affected local route overrides before setting the new itinerary rows. This prevents an early route reload from racing the writer's follow-up DELETE and reading the old segment back into a remote client.
- Applied migration `20260712033758_add_route_tables_to_realtime.sql` sets `REPLICA IDENTITY FULL` and adds both route override tables to `supabase_realtime`. Remote SQL verification confirms both tables use full replica identity and are publication members. Post-apply Chrome two-client QA passed endpoint-coordinate invalidation without refresh and both-client refresh convergence at zero nodes.
- Delete persistence no longer skips a remote-preview node when this client's authoritative baseline is still empty. `delete` operations bypass points-array equality short-circuiting and always issue an idempotent node DELETE; this closes the reproduced path where A removed the preview but B's refresh restored the DB node.
- Failed deletes now restore the authoritative node rows loaded immediately before the mutation instead of a potentially stale React baseline. The provider updates its imperative points ref before emitting the inverse `node-add`, so the next collaboration merge cannot erase the rollback. Deployed Chrome failure injection blocked four node-table REST attempts over 25 seconds: both clients restored one node, remained at one after unblocking and refresh, and a following normal delete still converged to zero before and after refresh.
- A real 319-second background freeze/recovery kept both clients converged; the first recovered drag synchronized exactly and the editor label stayed deduplicated.
- Rapid ownership handoff now stores `node-drag-start` separately from position/final updates and applies the two bounded slots by local receipt order. This prevents React batching from overwriting the ownership edge before the provider can release the previous client's pending final.
- Deployed Chrome replay passed A-to-B-to-A same-node handoff with both clients converging live and after refresh. A separate P1 handoff followed immediately by P2 drag also converged both nodes live and after refresh without restoring P1.
- Itinerary reorder QA swapped the second and third destinations: all three affected route overrides disappeared on both clients. A separate far-segment node survived the same reorder on both clients, proving unchanged adjacency retention. The original destination order was restored after QA; temporary transportation-card cleanup performed by the existing reorder flow remains visible in the TEST trip.
- User dual-account testing after the stabilization series reports multiplayer dragging is substantially more stable; temporary-item itinerary delete invalidation remains before final closeout.
- Latest pushed implementation commit: `c6989a3 Preserve rapid route ownership handoff`.

## Production Migration State

Applied immutable migrations:

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
project: lqvuqamzmchepgxkftcw
```

No pending production migration:

```text
none
```

Important:

- Never edit applied migrations 019, 020, 021, 022, 023, 024, `20260708063744`, `20260710125337`, or `20260712033758` in place.
- Any future schema/RPC/permission correction after Phase 4.7 must use migration 025+.
- Phase 4.3, 4.4, 4.5, and the Phase 4.5 Hotfix required no migration.

## Phase 4.5 and Hotfix Changed Files

- `src/App.jsx`
- `src/lib/destinationPackages.js`
- `src/lib/timelineAutoContinuation.js`
- `src/lib/timelineTransportationConflicts.js`
- `src/lib/timelineUntimedOrdering.js`
- `src/styles.css`
- `tests/phase-1-7f-smoke.spec.js`
- `tests/phase-4-5-untimed-ordering.spec.js`
- `CURRENT_TASK.md`
- `docs/2026-06-24-phase-4-5-closeout-handoff.md`
- `docs/2026-06-24-phase-4-5-hotfix-2-handoff.md`
- `docs/2026-06-24-phase-4-5-hotfix-3-handoff.md`
- `docs/timeline-phase-4-drag-reorder-rules-draft-v3.md`
- `docs/timeline-phase-4-drag-reorder-rules-draft-v4.md`
- `docs/timeline-phase-4-drag-reorder-rules-draft-v5.md`

## Verification

Phase 4.5 initial checks on 2026-06-24:

```text
npm.cmd run build       passed
npx.cmd playwright test passed 61/61
git diff --check        passed
```

Phase 4.5 Hotfix checks on 2026-06-24:

```text
targeted pure-helper sanity passed
Demo browser verification passed
npm.cmd run build        passed
git diff --check         passed
full Playwright rerun    intentionally not run per user instruction
manual user verification pending
```

Hotfix browser verification confirmed that clearing one time cleared both form values, the saved visit became untimed, the existing transportation stayed anchored after the from visit, the compact warning rendered, no transport moved into the top invalid stack, and the console had no warnings/errors.

Phase 4.5 Hotfix 2 checks on 2026-06-24:

```text
npm.cmd run build passed
git diff --check  passed
Demo consecutive passive-conversion browser QA passed
Demo fixed-anchor overflow and non-compacting restore QA passed
Demo tail restore and fixed-crossing continuation QA passed
Demo transportation-endpoint conflict prompt QA passed
automated tests     not added or modified per user instruction
manual verification pending
```

Phase 4.5 stabilization closeout checks on 2026-06-25:

```text
npm.cmd run build passed
git diff --check  passed
Demo browser QA    passed for passive untimed position preservation, no-compaction,
                   tail restore, fixed-crossing continuation guard, and
                   transportation endpoint conflict confirmation
Playwright tests   intentionally not run or modified per user instruction
final manual verification pending
```

Phase 4.6 closeout checks on 2026-06-29:

```text
npm.cmd run build passed
targeted Playwright passed 36/36
npm.cmd run test:e2e passed 71/71
git diff --check passed with Windows LF/CRLF notices only
```

Phase 4.6 preserves the existing Phase 4.5b / 4.5c transportation and mixed-order behavior, adds migration/RPC 023, and does not begin Phase 4.7 or Phase 4.8.

The Vite build still reports the existing large-chunk warning; it is not a Phase 4.6 regression.

Phase 4.7 closeout checks on 2026-06-29:

```text
npm.cmd run build passed
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js passed 16/16
npx.cmd playwright test tests/phase-4-5-untimed-ordering.spec.js --grep-invert demo passed 12/12
npx.cmd playwright test tests/phase-4-4-auto-continuation.spec.js passed 7/7
npx.cmd playwright test tests/phase-4-3-transport-conflict.spec.js passed 7/7
npx.cmd playwright test tests/phase-4-5-untimed-ordering.spec.js --grep demo passed 2/2
npx.cmd playwright test tests/phase-1-7f-smoke.spec.js --grep "demo timed visit drag recalculates" passed 1/1
npm.cmd run test:e2e passed 77/77
git diff --check passed with Windows LF/CRLF notices only
Supabase 024 SQL compile check passed with BEGIN/ROLLBACK on project lqvuqamzmchepgxkftcw
Supabase 024 production migration applied as 20260629065754 / timeline_phase_4_7_fixed_anchor_continuation
Supabase RPC signatures verified in app_private and public schemas
PostgREST schema cache reload requested with notify pgrst, 'reload schema'
```

Phase 4.7 preserves Phase 4.6 no-fixed timed drag behavior, Phase 4.5 untimed mixed ordering, Phase 4.4 edit continuation, and Phase 4.3 transportation conflict behavior.

The Vite build still reports the existing large-chunk warning; it is not a Phase 4.7 regression.

Phase 4.8 checks on 2026-06-30:

```text
npm.cmd run build passed
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js --grep "Phase 4.8a" passed 1/1
Playwright visual inspection on /demo/timeline confirmed drop-after wrappers become transform:none / transition:0s immediately after mouseup
```

Phase 4.8 preserves the Phase 4.7 timed reorder RPC path, Phase 4.5 untimed mixed ordering, transportation conflict confirmation gates, Demo isolation, draft autosave, edit locks, Realtime, and Supabase schema.

The Vite build still reports the existing large-chunk warning; it is not a Phase 4.8 regression.

Phase 4.8b / drag handle polish checks on 2026-06-30:

```text
npm.cmd run build passed
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js passed 27/27
git diff --check passed with Windows LF/CRLF notices only
Manual user verification passed for Demo and Formal drag preview, Demo transport parity, tail_pending + untimed promotion bypass, vertical overlay constraint, day-board top/bottom overlay bounds, and time-block-only drag activation.
```

Phase 4.8c / 4.8c2 collaborative drag presence checks on 2026-06-30 and 2026-07-01:

```text
npm.cmd run build passed
npx.cmd playwright test tests/phase-1-7f-smoke.spec.js passed 22/22
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js passed 27/27
git diff --check passed with Windows LF/CRLF notices only
Presence-only Vercel multi-account testing was unstable because sustained Presence track heartbeat could time out.
Presence + Broadcast final build rerun passed after one Windows Node teardown assertion on the first run.
git diff --check passed with Windows LF/CRLF notice only
Manual Vercel multi-account user verification passed after switching heartbeat/dragOver updates to Broadcast.
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js --grep "Phase 4.8c" passed 2/2 for 4.8c2 readonly/channel lifecycle source smoke
npm.cmd run build passed after 4.8c2 channel lifecycle recovery
git diff --check passed with Windows LF/CRLF notice only after 4.8c2 channel lifecycle recovery
Manual user verification passed for Phase 4.8c Presence + Broadcast repeated drag regression after CLOSED channel recovery.
```

Phase 4.8d / 4.8e collaborative selection and online presence checks on 2026-07-01:

```text
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js --grep "Phase 4.8d" passed
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js --grep "Phase 4.8e" passed
npx.cmd playwright test tests/phase-4-5-untimed-ordering.spec.js passed for targeted untimed ordering regression coverage
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js --grep "Phase 4.8d|untimed|mixed" passed where applicable
npm.cmd run build passed
git diff --check passed with Windows LF/CRLF notices only
Manual user testing drove visual tuning for remote card selection labels, card selection border thickness, transport card selection support, online avatar border simplification, and Day Tab border display.
```

Phase 4.8f remote drag visual polish checks on 2026-07-01:

```text
npm.cmd run build passed
git diff --check passed with Windows LF/CRLF notices only
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js --grep "Phase 4.8f|Phase 4.8c" passed 4/4
Manual user verification passed for remote drag source card opacity/border, no soft shadow, and insertion line spacing.
```

Phase 4.9a map marker contract checks on 2026-07-01:

```text
npx.cmd playwright test tests/timelineMapMarkers.spec.js passed 5/5
npm.cmd run build passed with existing Vite large-chunk warning
git diff --check passed with Windows LF/CRLF notices only
manual user verification pending
```

Phase 4.9b map focus surface checks on 2026-07-01:

```text
npx.cmd playwright test tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js passed 9/9
npm.cmd run build passed with existing Vite large-chunk warning
git diff --check passed with Windows LF/CRLF notices only
manual user verification pending
```

Phase 4.9c Google Map Provider Prep checks on 2026-07-01:

```text
npx.cmd playwright test tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js passed 12/12
npm.cmd run build passed with existing Vite large-chunk warning
build output: JS 763.37 KB raw / 211.04 KB gzip, CSS 72.51 KB raw / 13.13 KB gzip
git diff --check passed with Windows LF/CRLF notice only
rg source scan for google.maps / VITE_GOOGLE_MAPS_API_KEY / map packages in src and package.json returned no matches
manual user verification pending
```

Phase 5.0 Map MVP Readiness Audit checks on 2026-07-02:

```text
rg "google\.maps|VITE_GOOGLE_MAPS_API_KEY|maps.googleapis|Directions|Routes|Places|Geocoding|leaflet|maplibre|maptiler|stadiamaps" src package.json package-lock.json returned no matches
additional package scan for @googlemaps / @react-google-maps / leaflet / maplibre / mapbox / maptiler / stadiamaps returned no matches
Demo coordinate audit: 41 itinerary items, 31 destination-like items, 0 usable latitude/longitude pairs
docs-only audit; targeted Playwright and build were not rerun
git diff --check passed with Windows LF/CRLF notice only
```

Phase 5.1a Static Demo Map Safety checks on 2026-07-02:

```text
npx.cmd playwright test tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js passed 15/15
npm.cmd run build passed with existing Vite large-chunk warning
build output: JS 764.78 KB raw / 211.56 KB gzip, CSS 73.49 KB raw / 13.31 KB gzip
git diff --check passed with Windows LF/CRLF notices only
rg "google\.maps|VITE_GOOGLE_MAPS_API_KEY|maps.googleapis|Directions|Routes|Places|Geocoding|leaflet|maplibre|maptiler|stadiamaps" src package.json package-lock.json returned no matches
Demo coordinate audit after update: 31 destination-like items, 16 usable latitude/longitude pairs, Day 0 = 3, Day 1 = 7, Day 2 = 6
manual browser verification pending
```

Phase 5.1b Formal Google Map Loader Integration checks on 2026-07-02:

```text
npx.cmd playwright test tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js passed 17/17
npm.cmd run build passed with existing Vite large-chunk warning
build output: GoogleMapProvider.lazy chunk 1.11 KB raw / 0.66 KB gzip, main JS 766.55 KB raw / 212.39 KB gzip, CSS 73.72 KB raw / 13.35 KB gzip
git diff --check passed with Windows LF/CRLF notices only
rg "google\.maps|maps.googleapis|Directions|Routes|Places|Geocoding|leaflet|maplibre|maptiler|stadiamaps" src package.json package-lock.json returned no src matches; package-lock has expected transitive @types/google.maps from @googlemaps/js-api-loader
manual browser verification pending
```

Phase 5.1c Formal Google Map Markers Only checks on 2026-07-02:

```text
npx.cmd playwright test tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js passed 18/18
npm.cmd run build passed with existing Vite large-chunk warning
build output: GoogleMapProvider.lazy chunk 2.89 KB raw / 1.46 KB gzip, main JS 766.55 KB raw / 212.39 KB gzip, CSS 73.57 KB raw / 13.34 KB gzip
git diff --check passed with Windows LF/CRLF notices only
rg "Directions|Routes|Places|Geocoding|leaflet|maplibre|maptiler|stadiamaps|@react-google-maps" src package.json package-lock.json returned no matches
manual Formal browser verification with a real local API key pending
```

Phase 5.1d Formal Google Map Empty State Fix checks on 2026-07-02:

```text
npx.cmd playwright test tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js passed 20/20
npm.cmd run build passed with existing Vite large-chunk warning
build output: GoogleMapProvider.lazy chunk 3.13 KB raw / 1.52 KB gzip, main JS 766.56 KB raw / 212.37 KB gzip, CSS 73.88 KB raw / 13.39 KB gzip
git diff --check passed with Windows LF/CRLF notices only
rg "Directions|Routes|Places|Geocoding|leaflet|maplibre|maptiler|stadiamaps|@react-google-maps" src package.json package-lock.json returned no matches
manual Formal browser verification with a real local or Vercel API key pending
```

Phase 5.1e Google Map Layout Fill Fix checks on 2026-07-02:

```text
npx.cmd playwright test tests/mapProviderPrep.spec.js passed 18/18
npm.cmd run build passed with existing Vite large-chunk warning
build output: GoogleMapProvider.lazy chunk 7.04 KB raw / 3.11 KB gzip, main JS 767.62 KB raw / 212.72 KB gzip, CSS 74.25 KB raw / 13.47 KB gzip
git diff --check passed with Windows LF/CRLF notices only
manual Formal Preview verification passed for map fill height
manual Formal Preview verification pending for empty hint overlay, coordinate-marker day fill, user pan/zoom viewport preservation, day-tab auto-position reset, Demo static layout, debugMap diagnostics, and maps.googleapis network request
```

Phase 5.2 Map URL Point Flow checks on 2026-07-02:

```text
npx.cmd playwright test tests/mapPoint.spec.js tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js passed 44/44
npm.cmd run build passed with existing Vite large-chunk warning
git diff --check passed with Windows LF/CRLF notices only
manual user verification passed for Map URL clearing, marker disappearance, invalid URL feedback, valid URL save, and Demo static preservation
latest pushed commit: f3d1de9 Require valid destination map URLs
```

Phase 5.2c Google Maps Short Link Resolver checks on 2026-07-02:

```text
npx.cmd playwright test tests/mapPoint.spec.js tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js passed 49/49
npm.cmd run build passed with existing Vite large-chunk warning
git diff --check passed with Windows LF/CRLF notices only
Edge Function added locally at supabase/functions/resolve-google-maps-url/index.ts
Edge Function deployed after commit 0262a7d
manual user verification passed for maps.app.goo.gl short-link resolution after deployment
```

Phase 5.3 Editor Map Point Picker checks on 2026-07-03:

```text
npx.cmd playwright test tests/mapPoint.spec.js tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js passed 52/52
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js passed 33/33
npm.cmd run build passed with existing Vite large-chunk warning
git diff --check passed with Windows LF/CRLF notices only
manual QA passed for add editor bottom placement, editor Map URL picker, coordinate/map_url fill, picker overlay, cancellation, and Demo static preservation
latest pushed commit: 0865ac5 Implement timeline phase 5.3 map point picker
```

Phase 5.3 Hotfix Add Editor Scroll / Gap + Picker Cursor checks on 2026-07-03:

```text
npx.cmd playwright test tests/mapPoint.spec.js tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js passed 53/53
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js passed 33/33
npm.cmd run build passed with existing Vite large-chunk warning
git diff --check passed with Windows LF/CRLF notices only
manual user verification passed for bottom add editor scroll/focus, editor gap, picker cursor, and previously completed map point picking behavior
latest pushed commit: 86cd7d2 Polish timeline phase 5.3 editor picker UX
```

Phase 5.3b Marker Focus / Fixed Zoom Polish checks on 2026-07-03:

```text
npx.cmd playwright test tests/mapPoint.spec.js tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js passed 54/54
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js passed 33/33
npm.cmd run build passed with existing Vite large-chunk warning
git diff --check passed with Windows LF/CRLF notices only
manual QA found direct-jump / marker active style issues after initial 5.3b commit
latest pushed commit before hotfix: b05f72c Polish timeline phase 5.3b marker focus
```

Phase 5.3b Hotfix Smooth Map Pan + Focused Marker Active Style Fix checks on 2026-07-03:

```text
npx.cmd playwright test tests/mapPoint.spec.js tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js passed 54/54
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js passed 33/33
npm.cmd run build passed with existing Vite large-chunk warning
git diff --check passed with Windows LF/CRLF notices only
manual user verification passed for smooth pan, fixed zoom 15, focused marker active style, marker click focus, day switch behavior, and picking-mode preservation
latest pushed commit: 498f0ef Fix timeline phase 5.3b marker focus polish
```

Phase 5.4 Simple Route Lines + Destination Sequence Badge checks on 2026-07-03:

```text
npx.cmd playwright test tests/mapPoint.spec.js tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js passed 58/58 after final transport-category hotfix
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js passed 33/33
npm.cmd run build passed with existing Vite large-chunk warning
git diff --check passed with Windows LF/CRLF notices only
Formal Google route lines implemented with a simple provider-local Polyline between valid same-day destination coordinates
destination sequence badge implemented for Timeline destination cards and Google marker labels; transportation cards remain unnumbered
manual user feedback moved Timeline destination sequence badge to the card top-left as plain 12px text without border/background
old-card Map URL save polish added so validated map_url coordinates are explicitly preserved in the destination editor update payload
transport-category destination hotfix keeps item_type="visit" / type="transport" as a destination for marker, route line, sequence badge, missing-coordinate count, and coordinate save behavior
related pushed commits: 723308d Implement timeline phase 5.4 route lines, 80bc987 Polish timeline destination sequence badge, 350a713 Preserve validated timeline map coordinates on save, b1feb1c Fix transport-category destination map markers, 684b162 Fix map point handling for transport-category destinations
manual QA: ALL PASS
```

Phase 5.5 Map-area Custom Point Add Flow checks on 2026-07-04:

```text
npx.cmd playwright test tests/mapPoint.spec.js tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js passed
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js passed 33/33
npm.cmd run build passed with existing Vite large-chunk warning
git diff --check passed with Windows LF/CRLF notices only
manual user verification passed; Map-area button currently sits in Google map overlay bottom-left
latest pushed commit: 7ccb445 Implement timeline phase 5.5 map add flow
```

Phase 5.6a Places Library Gating / Cost Guard Prep checks on 2026-07-04:

```text
npx.cmd playwright test tests/mapPoint.spec.js tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js tests/googlePlacesConfig.spec.js passed
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js passed 33/33
npm.cmd run build passed with existing Vite large-chunk warning
git diff --check passed with Windows LF/CRLF notices only
Places remains gated behind Formal Google provider + API key + VITE_GOOGLE_MAPS_PLACES_ENABLED=true
latest pushed commit: 42ad978 Prepare timeline phase 5.6a places gating
```

Phase 5.6b Places Autocomplete Search Box + Hotfix checks on 2026-07-04:

```text
npx.cmd playwright test tests/googlePlacesAutocomplete.spec.js tests/mapProviderPrep.spec.js passed 34/34
npx.cmd playwright test tests/mapPoint.spec.js tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js tests/googlePlacesConfig.spec.js tests/googlePlacesAutocomplete.spec.js passed 67/67
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js passed 33/33
npm.cmd run build passed with existing Vite large-chunk warning
git diff --check passed with Windows LF/CRLF notices only
git diff --cached --check passed
hotfix hides the old ROUTE / route panel heading only when the Formal Google Places search overlay is present
related pushed commits: c288687 Add timeline phase 5.6b places autocomplete, 7818914 Hide route heading behind places search
```

Phase 5.6c Selected Place to Place Details to Add Editor checks on 2026-07-04:

```text
npx.cmd playwright test tests/googlePlacesAutocomplete.spec.js tests/googlePlacesConfig.spec.js tests/mapProviderPrep.spec.js passed 40/40
npx.cmd playwright test tests/mapPoint.spec.js tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js tests/googlePlacesConfig.spec.js tests/googlePlacesAutocomplete.spec.js passed 68/68
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js passed 33/33
npm.cmd run build passed with existing Vite large-chunk warning
Place Details field mask remains minimal: id, displayName, location, googleMapsUri
prediction click opens the existing add editor only after details returns usable coordinates; failed or locationless details does not open the editor
```

Phase 5.6d Places Search Result Map Preview Dialog + Add Button checks on 2026-07-04:

```text
npx.cmd playwright test tests/googlePlacesAutocomplete.spec.js tests/googlePlacesConfig.spec.js tests/mapProviderPrep.spec.js passed
npx.cmd playwright test tests/mapPoint.spec.js tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js tests/googlePlacesConfig.spec.js tests/googlePlacesAutocomplete.spec.js passed
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js passed 33/33
npm.cmd run build passed with existing Vite large-chunk warning
git diff --check passed with Windows LF/CRLF notices only
preview dialog is marker-anchored instead of fixed bottom-right after hotfix
related pushed commits: e0c99a7 Add places search result map preview, f49122f Anchor places preview dialog to map marker, ce0a172 Polish places preview dialog styling
```

Phase 5.6e Google Map POI Click to Pending Marker to Preview checks on 2026-07-04:

```text
npx.cmd playwright test tests/googlePlacesAutocomplete.spec.js passed 8/8
npx.cmd playwright test tests/mapPoint.spec.js tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js tests/googlePlacesConfig.spec.js tests/googlePlacesAutocomplete.spec.js passed 73/73
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js passed 33/33
npm.cmd run build passed with existing Vite large-chunk warning
git diff --check passed with Windows LF/CRLF notices only
POI click itself does not call Place Details; clicking pending marker/hint triggers Details or uses provider-local cache
related pushed commits: a40b029 Add places POI click preview confirm, ccb454d Replace POI mini confirm with pending marker, c4c5926 Add pending POI marker hint, 2de7dbf Polish pending POI hint placement
```

Phase 5.6f Places Search Input UX + IME / Debounce Cost Guard checks on 2026-07-05:

```text
npx.cmd playwright test tests/googlePlacesAutocomplete.spec.js passed 8/8 after final hotfix
npx.cmd playwright test tests/googlePlacesAutocomplete.spec.js tests/googlePlacesConfig.spec.js tests/mapProviderPrep.spec.js passed 45/45 after final hotfix
npx.cmd playwright test tests/mapPoint.spec.js tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js tests/googlePlacesConfig.spec.js tests/googlePlacesAutocomplete.spec.js passed 73/73 during regression checks
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js passed 33/33 during regression checks
npm.cmd run build passed with existing Vite large-chunk warning
git diff --check passed with Windows LF/CRLF notices only
git diff --cached --check passed before pushed commits
manual QA passed for Phase 5.6f hotfix
latest pushed commit: 5a7016a Use primary text for selected place input
```

Phase 5.6g Places Autocomplete Viewport Location Bias checks on 2026-07-05:

```text
npx.cmd playwright test tests/googlePlacesAutocomplete.spec.js passed 9/9
npx.cmd playwright test tests/googlePlacesAutocomplete.spec.js tests/googlePlacesConfig.spec.js tests/mapProviderPrep.spec.js passed 46/46
npx.cmd playwright test tests/mapPoint.spec.js tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js tests/googlePlacesConfig.spec.js tests/googlePlacesAutocomplete.spec.js passed 74/74
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js passed 33/33
npm.cmd run build passed with existing Vite large-chunk warning
git diff --check passed with Windows LF/CRLF notices only
git diff --cached --check passed before commit
manual QA passed for Phase 5.6g viewport location bias
latest pushed commit: 0b7fe16 Add places autocomplete viewport bias
```

Phase 5.7a Transportation Navigation + Travel Time Query checks on 2026-07-07:

```text
npm.cmd run build passed with existing Vite large-chunk warning
git diff --check passed with Windows LF/CRLF notices only
npx.cmd playwright test googleRoutesConfig googleRoutesAdapter passed 11/11 after Transit payload hotfix
npx.cmd playwright test mapProviderPrep passed 31/31 after Transit payload hotfix
Transit query UI now shows only preferred vehicle options: 公車, 地鐵, 火車, 電車及輕軌電車
Transit Routes payload omits allowedTravelModes when all or none are selected, sends allowedTravelModes only for partial selections, and omits routingPreference / routeModifiers
Driving route options may send avoidHighways / avoidTolls / avoidFerries
debugRoutes logging is gated behind ?debugRoutes=1 and does not log API keys
Transit fallback follow-ups added duration normalization, debug field-mask broadening for transit debug, removal of normal transit departureTime, Supabase Edge Function Directions fallback, ZERO_RESULTS retry, and a place_id experiment
Directions fallback now calls Supabase Edge Function google-directions-transit-duration instead of direct frontend maps.googleapis.com fetch
Edge Function calls Google Directions API server-side and returns only duration-only success or sanitized failure payloads
ZERO_RESULTS retry first used labels, then latest experiment changed fallback originLabel/destinationLabel values to place_id:<id> when provider place IDs already exist on itinerary items
Current known limitation: Places search / POI click obtains placeId transiently for preview/add editor flow, but saved itinerary item payload currently persists only name, map_url, latitude, and longitude, not provider_place_id / place_id
npx.cmd playwright test tests/googleDirectionsAdapter.spec.js tests/googleRoutesAdapter.spec.js passed 22/22 after place_id experiment
npm.cmd run build passed with existing Vite large-chunk warning after place_id experiment
git diff --check passed with Windows LF/CRLF notices only after place_id experiment
npx.cmd playwright test tests/mapProviderPrep.spec.js passed 31/31 after place_id experiment
latest pushed commit: 6bdc665 Use place IDs for transit fallback retry
```

Phase 5.7a Navigation-only + Phase 5.7b-1/5.7b-2/5.7b-3 Route Edit checks on 2026-07-08:

```text
Phase 5.7a query mode was removed after product decision to cancel in-app automatic transportation time lookup
Transportation cards remain navigation-only, keep manual type/time/name/notes editing, and airplane navigation leaves travelmode empty
Phase 5.7b-1 added Google-provider-only route edit mode, search/add-point disabling, Map-outside overlay, Map-active boundary, Esc/outside/icon exit, and Static/Demo no-route-edit behavior
Phase 5.7b-2 added local adjacent destination segment editing with segment key fromItemId:toItemId, A -> custom points -> B rendering, subsegment insert, draggable small round handles, click-delete, drag/click conflict guard, and MAX_CUSTOM_ROUTE_POINTS_PER_SEGMENT = 5
Phase 5.7b-3 added route override persistence in public.itinerary_route_overrides with points_json storing only intermediate custom points, auto upsert/delete, optimistic local display, rollback to serverRoutePointsBySegment on save failure, and a low-key route-save-failed rollback hint
Route override invalidation cleanup deletes invalid overrides after reorder, destination delete, inserted destination adjacency break, and from/to coordinate changes; stale DB overrides are filtered at read/display time
Supabase migration history was repaired on 2026-07-08: old remote timestamp versions were marked reverted, local GitHub migrations 001-024 were marked applied, then 20260708063744_add_itinerary_route_overrides.sql was pushed successfully
Final Supabase migration list confirmed local=remote for 001-024 and 20260708063744
npm.cmd run build passed with existing Vite large-chunk warning
git diff --check passed with Windows LF/CRLF notices only
npx.cmd playwright test tests/mapProviderPrep.spec.js passed 34/34 during 5.7b-3 verification
npx.cmd playwright test tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js passed 14/14 during 5.7b-3 verification
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js passed 33/33 during 5.7b-3 verification
latest pushed commit before CURRENT_TASK update: af8c81f Persist route edit overrides
```

Phase 5.7c-1 node-level collaboration stabilization checks on 2026-07-10 to 2026-07-11:

```text
remote migration 20260710125337_add_itinerary_route_override_nodes confirmed applied
npm.cmd run build passed after the latest per-node pending-commit change
npx.cmd playwright test tests/mapProviderPrep.spec.js passed 36/36 after the latest change
git diff --check passed with Windows LF/CRLF notices only
earlier stabilization regression runs passed 83 focused Playwright tests
Chrome dual-tab diagnostics confirmed node-drag-start/move/end delivery over the route-edit WebSocket channel
user dual-account manual QA reports multiplayer node dragging is substantially more stable
Chrome deployed two-session QA after b4867cd: remote delete synchronized immediately; drag-end then remote delete converged on both clients; deleting the segment's final custom node converged to zero; both-client refresh preserved identical node counts without restoration
Chrome sustained two-session QA: concurrent adds from three nodes converged to five on both clients; the five-node limit rejected further adds; simultaneous different-node drags converged to identical positions before and after refresh; same-account editor labels stayed deduplicated; simulated background recovery synchronized the first valid drag
Chrome reproduced and closed the itinerary-priority bug where endpoint coordinate invalidation deleted the authoritative DB override but stale remote previews kept handles visible until refresh. Commit 40342b3 clears previews after an absent authoritative segment; f221032 removes affected local overrides inside authoritative itinerary loads; applied migration 20260712033758 supplies the missing route-table Realtime events. Post-migration Chrome QA passed 1-to-0 convergence on both clients without refresh and remained 0 after both refreshed
Post-migration delete QA reproduced a remote-preview baseline race: B saw A's Broadcast node before loading it authoritatively, then B's requested=[] and baseline=[] equality shortcut falsely skipped DB DELETE. Commit 5985ce9 makes delete idempotent; deployed Chrome replay passed immediate convergence and both-client refresh at zero
Chrome held one client in the background for 319 seconds. The active client moved the node while the other was frozen; foreground recovery converged exactly, the recovered client's first drag synchronized with dx=0/dy=0, and the editor label remained one unique user
Chrome failure injection blocked four node-table REST attempts over 25 seconds. Commit 7cb1b40 restored the pre-delete authoritative row on both clients and emitted the inverse node-add; both stayed at one after unblocking and refresh. A following unblocked delete converged to zero and remained zero after refresh
Chrome reproduced a batched ownership edge: a rapid A-to-B-to-A drag could leave B on the previous final until refresh because node-drag-start and position updates shared one state key. Commit c6989a3 keeps bounded ownership/position slots and sorts them by receipt. Deployed replay passed live and refreshed A-to-B-to-A convergence, then passed B taking P1 and immediately dragging P2 with both nodes identical live and after refresh
Itinerary reorder Chrome QA swapped destinations 2 and 3: affected route nodes converged from three to zero on both clients. With one node on an unchanged far adjacency, the same reorder retained one node on both clients. The original destination order was restored
latest pushed implementation commit: c6989a3 Preserve rapid route ownership handoff
```

## Protected Scope Preserved

Latest Phase 5.7b / 5.7c route edit work did not redesign or extend:

- Auth / Google OAuth
- Realtime subscription architecture
- Draft Autosave or Edit Lock architecture
- Share / Invite / member flow
- Budget core data flow
- Phase 4.2c destination-package reorder RPC behavior
- generic `sort_order` architecture
- transportation pair splitting or creation
- Google Map loading behavior outside the existing provider gates
- Text Search, Nearby Search, Geocoding, Reverse Geocoding, Distance Matrix, route cache, route summary, or Google route polylines
- Routes API / Directions API transportation query flow
- locationRestriction or strict bounds
- Place Details fields outside `id`, `displayName`, `location`, and `googleMapsUri`
- address auto-fill, formattedAddress, rating, reviews, photos, opening hours, phone, website, business status, editorial summaries, or generative summaries
- cross-day scheduling
- Demo isolation
- existing RPC behavior or existing migration files
- remote DragOverlay, ghost cards, preview order sync, scroll sync, or cursor sync
- marker drag, marker clustering, or AdvancedMarkerElement migration
- automatic transportation card creation
- itinerary item writes before explicit Save; route override points are the only new auto-save path

## Residual Risks

- Formal continuation currently uses guarded client-side row updates rather than a database transaction because Phase 4.4 explicitly required no migration. Failure handling performs best-effort reverse compensation, but an extreme network failure during both the forward update and compensation can still leave partial authoritative updates.
- Concurrent changes are guarded by `updated_at`, fixed-state, and active-lock validation, but unrelated writers that do not participate in those contracts remain an external risk.
- The existing native HTML drag accessibility limitations from Phase 4.2c remain outside Phase 4.4.
- Legacy DB rows with only one time are treated safely as untimed in the UI but are not automatically written back. The next explicit save normalizes them to `null/null`.
- Because applied RPC migrations 020/021 are immutable and their server manifest predates this Hotfix, a legacy start-only row can cause timed reorder to reject safely as stale until that row is explicitly normalized.
- Hotfix 2 Formal persistence uses a guarded source-row update followed by one scoped transportation delete statement because no new RPC was approved. If deletion fails, it attempts to restore the original `sort_order` before authoritative reload; an extreme network or concurrent-write failure during both deletion and compensation can still leave a partial authoritative result.
- Phase 4.7 Formal timed drag has its transactional RPC applied in production, but this session focused on Demo/browser visual QA for Phase 4.8 sortable preview.
- Authenticated Formal UI verification passed for the latest Phase 4.8b drag-preview and tail-pending bypass polish, but future drag animation changes should still be checked on a real test trip because pointer/scroll timing is browser-sensitive.
- Drag animation feel is inherently browser/timing-sensitive; if future polish is needed, prefer dnd-kit `animateLayoutChanges` / sortable configuration over delaying Formal data writes or bypassing the existing reorder RPC flow.
- Phase 4.8c2 Realtime Broadcast delivery is best effort; the 12-second stale timeout is the fallback if a clear/update event is missed.
- Phase 4.8c2 channel recreation handles observed `CLOSED` channel state, but future Realtime lifecycle changes should retest repeated same-trip/same-day drags in two tabs.
- Phase 4.8c2 debug logs are gated behind `?debugPresence=1`. They are useful during rollout but expose ephemeral drag payload metadata in the browser console when enabled.
- Phase 4.8d remote selection presence is intentionally visual-only. It can be missed or stale-filtered without affecting authoritative data.
- Phase 4.8e trip-level online presence is best-effort Realtime UI state. Missing, delayed, or stale-filtered trip presence should not affect data correctness.
- `BUG-025` remains Known Issue / Low Priority: foreign drag presence can occasionally clear by 12-second stale timeout instead of immediate clear, despite onDragEnd immediate clear mitigation.
- Phase 5.7c Realtime Broadcast remains best effort during active drag; DB node rows are authoritative after drag-end.
- Phase 5.7c per-node pending commits plus bounded ownership/position receipt slots remove the reproduced P1-to-P2 overwrite and batched-start paths; deployed A-to-B-to-A and P1-then-P2 replay now converge live and after refresh.
- Multiplayer node add/delete, preview-only delete, failed-delete rollback, normal-delete regression, and refresh convergence have passed deployed two-client Chrome QA.
- A 319-second real background recovery passed exact node convergence, first-drag synchronization, and unique-user editor-label stability.
- Reorder invalidation and unchanged-adjacency retention passed deployed two-client QA. A reversible temporary-item delete replay remains the final Phase 5.7c manual QA gap.
- The historical Phase 5.7c plan under `docs/todo/` has encoding damage and superseded architecture notes; do not use it as the current implementation source.
- Phase 4.8e Day Tab presence border shows a compact first-version representation using the first remote presence color for that day.
- Phase 4.8f remote drag source and insertion-line visuals are presence-driven hints only. They must not be treated as authoritative reorder state.

## Next Step

Continue Phase 5.7c-1 stabilization from `c6989a3 Preserve rapid route ownership handoff` on `codex/timeline-phase-5-7`. Start by reading `docs/2026-07-11-phase-5-7c-node-collaboration-handoff.md`. Deployed two-client Chrome QA has passed remote delete, drag-then-delete, final-node delete, preview-only delete persistence, failed-delete rollback, normal-delete regression, concurrent add to the five-node limit, simultaneous different-node drag, A-to-B-to-A same-node handoff, P1 handoff immediately followed by P2, same-account editor deduplication, 319-second background recovery with a synchronized first drag, refresh convergence, endpoint-coordinate invalidation, reorder invalidation, and unchanged-adjacency retention. Production migration `20260712033758` is applied; both route tables use full replica identity and belong to `supabase_realtime`. The remaining manual gap is a reversible temporary-item destination-delete invalidation replay; do not delete an original TEST-trip destination solely for QA. Use `?debugRouteCollab=1` only while diagnosing. If it passes, run the focused map/provider tests, build, and `git diff --check`, then write the Phase 5.7c closeout update. If it fails, record the exact session/node/drag sequence and identify whether the last writer was local drag, remote preview, save response, rollback, or authoritative DB data before changing code. Do not restore same-day itinerary locking, a 15-second idle exit, segment-snapshot Broadcast, whole-`points_json` multiplayer writes, Routes/Directions travel-time queries, Google route polylines, or unrelated Timeline/Places/Auth/Budget changes.
