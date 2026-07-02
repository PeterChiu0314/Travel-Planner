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
- `docs/2026-06-30-phase-4-8c-closeout-handoff.md`
- `docs/timeline-phase-4-drag-reorder-rules-draft-v14.md` (latest working draft)

Archive rule:

- `docs/archive/` contains historical discussions, superseded handoffs, and old drafts.
- Do not read archived files by default; consult them only when a task specifically needs older context.
- `docs/gpt/` no longer exists and must not be recreated.

## Current Phase

```text
Timeline Phase 4.9c Google Map Provider Prep - Implemented locally / Pending user review / No Migration / No Push
```

Next phase:

```text
Phase 4.9c prepares the Google Map provider boundary while keeping the runtime on the existing static RoutePanel surface. Next decision is either Goal 4.9d Google Map MVP, with explicit SDK/API/env approval, or Phase 4.9 closeout / commit / push. Do not add route calculation, migration, reorder/presence changes, map packages, API keys, or initial-bundle SDK loading without approval.
```

Branch:

```text
codex/timeline-phase-4-9
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

## Production Migration State

Applied immutable migrations:

```text
019 / 20260621131905 / swap_itinerary_destination_packages
020 / 20260622130246 / reorder_itinerary_destination_packages
021 / 20260622131013 / fix_reorder_baseline_count
022 / 20260629012151 / add_transport_role_to_itinerary_items
023 / 20260629014908 / reorder_itinerary_timed_auto_continuation
024 / 20260629065754 / timeline_phase_4_7_fixed_anchor_continuation
project: lqvuqamzmchepgxkftcw
```

No pending production migration:

```text
none
```

Important:

- Never edit applied migrations 019, 020, 021, 022, 023, or 024 in place.
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

## Protected Scope Preserved

Latest Phase 4.8 collaborative presence work did not redesign or extend:

- Auth / Google OAuth
- Realtime subscription architecture
- Draft Autosave or Edit Lock architecture
- Share / Invite / member flow
- Budget core data flow
- Phase 4.2c destination-package reorder RPC behavior
- generic `sort_order` architecture
- transportation pair splitting or creation
- Google Map API or route calculation
- cross-day scheduling
- Demo isolation
- schema/RPC/migration behavior
- remote DragOverlay, ghost cards, preview order sync, scroll sync, or cursor sync

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
- Phase 4.8e Day Tab presence border shows a compact first-version representation using the first remote presence color for that day.
- Phase 4.8f remote drag source and insertion-line visuals are presence-driven hints only. They must not be treated as authoritative reorder state.

## Next Step

Phase 4.9c is implemented locally and pending user review. Next recommended decision is either Goal 4.9d Google Map MVP, with explicit SDK/API/env/billing approval, or Phase 4.9 closeout / commit / push. Do not infer transportation repair, deeper collaborative editing, multi-user merge, Demo presence, remote cursor/scroll sync, remote ghost cards, remote preview reordering, reorder/RPC changes, route calculation, route cache, map packages, API keys, SDK loading, or additional database changes.
