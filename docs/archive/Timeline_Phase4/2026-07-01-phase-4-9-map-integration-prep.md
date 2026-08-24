# Phase 4.9 Map Integration Prep

Date: 2026-07-01
Branch: `codex/timeline-phase-4-9`
Status: Read-only audit and implementation plan / no runtime feature changes

---

## Current State

Phase 4.8 is complete and accepted. Timeline drag, fixed-anchor reorder, untimed ordering, transport role behavior, collaborative drag presence, remote card selection, trip-level online presence, and remote drag visual hints are stable enough that Phase 4.9 must treat them as protected behavior.

The current Timeline workspace already has a route/map-shaped right-side surface:

- `RoutePanel` renders a stylized `route-map` area.
- It is not a real Google Map.
- It does not load Google Maps, Mapbox, Leaflet, or any map SDK.
- It shows ordered destination stops from the active day.
- It uses `focusedItemId` to highlight a selected route stop.
- The map/route surface can be collapsed with `useTimelineMapTransition()`.

Timeline and the route surface already share a small focus state:

- Clicking a Timeline destination or transport card calls `onFocusItem(item.id)`.
- Clicking a `RoutePanel` stop calls `onFocusItem(item.id)`.
- `focusedItemId` is local UI state only. It does not write to the database and does not change order.

Formal and Demo mostly share the same Timeline render path:

- Formal uses `TripWorkspace`.
- Demo uses `DemoApp`.
- Both render `ItineraryTimeline`, `RoutePanel`, `DayTabs`, `MultiDayTimelineColumns`, and the same Timeline workspace CSS.
- Demo remains local-only and must not connect to Supabase Auth, Realtime, Presence, Broadcast, or Draft/Edit Lock behavior.

Collapsed Timeline mode already shows all non-active day boards and now shows small remote-presence dots on inactive day boards. Active-day board presence is intentionally hidden there.

---

## Relevant Files

Primary app and UI:

- `src/App.jsx`
  - `useTimelineMapTransition()` controls route/map collapse and reveal timing.
  - `DemoApp` owns Demo Timeline state and passes `focusedItemId` into Timeline and RoutePanel.
  - `TripWorkspace` owns Formal Timeline workspace state and passes `focusedItemId` into Timeline and RoutePanel.
  - `DayTabs` renders active day navigation and 4.8e day tab presence borders.
  - `ItineraryTimeline` renders the active day board, destination cards, transportation cards, drag lifecycle, remote drag UI, and focused card styling.
  - `MultiDayTimelineColumns` renders inactive day boards in collapsed route/map mode.
  - `RoutePanel` renders the current route/map placeholder surface.
  - `normalizeItemPayload()` and save/apply paths normalize destination and transport payloads.

- `src/styles.css`
  - `.timeline-workbench`
  - `.timeline-workbench.route-collapsed`
  - `.side-panels`
  - `.timeline-map-toggle`
  - `.route-panel`
  - `.route-map`
  - `.route-line`
  - `.route-stop`
  - `.route-dot`
  - `.timeline-item.focused`
  - `.transport-card.focused`
  - `.timeline-item-remote-selected`
  - `.timeline-item-remote-drag-source`
  - `.timeline-remote-insertion-line`
  - `.timeline-day-presence-dots`

Data/model helpers:

- `src/lib/destinationPackages.js`
  - `destinationPackageFields` includes `location_name`, `address`, `map_url`, `latitude`, and `longitude`.
  - Package swap/reorder helpers preserve those fields as part of the destination package.

- `src/lib/timelineUntimedOrdering.js`
  - Owns visual ordering rules for untimed visits.
  - Map work should not change this.

- `src/lib/timelineAutoContinuation.js`
  - Owns timed continuation planning.
  - Map work should not change this.

- `src/lib/timelineTransportationConflicts.js`
  - Owns transportation warning/adjacency conflict checks.
  - Map work should not become transportation repair.

Demo data:

- `src/demo-kyoto-trip.json`
  - Includes `location_name`, `address`, `map_url`, `latitude`, `longitude`, transport duration, and transport pair fields.
  - Current latitude/longitude values are mostly `null`.
  - Some destinations have `map_url`, but that is not enough for drawing real map markers without SDK parsing or geocoding.

Schema and migrations:

- `supabase/migrations/002_core_mvp_schema.sql`
  - Adds `location_name`, `address`, `map_url`, `latitude`, and `longitude` to `itinerary_items`.
  - Adds the same map fields to `itinerary_alternatives`.
  - Adds `address`, `map_url`, `latitude`, and `longitude` to `accommodations`.

- `supabase/migrations/010_add_transportation_card_fields.sql`
  - Adds `transport_duration_minutes`.
  - Comments that duration is for future route/review features.

- `supabase/migrations/011_add_transport_card_pair_fields.sql`
  - Adds `from_item_id` and `to_item_id`.
  - These are enough to associate a transport card with a source/destination pair, but not enough to draw a real route segment.

- `supabase/migrations/012_add_transport_review_snapshots.sql`
  - Adds route-review snapshot labels derived from adjacent visits.

- `supabase/migrations/019` through `024`
  - Reorder RPC migrations preserve `location_name`, `address`, `map_url`, `latitude`, and `longitude` as destination package fields.
  - They also remap transport endpoints according to Phase 4 rules.

Tests:

- `tests/phase-1-7f-smoke.spec.js`
  - Demo smoke coverage confirms basic Timeline rendering and drag entrypoints.

- `tests/phase-4-2c-reorder.spec.js`
  - Reorder, dnd-kit, collaboration, and visual-only presence coverage.

- Other Phase 4 tests protect untimed, fixed-anchor, and transport behavior.

Docs read for this audit:

- `CURRENT_TASK.md`
- `AGENT.md`
- `docs/UX_RULES.md`
- `docs/BUGS.md`
- `docs/timeline-phase-4-drag-reorder-rules-draft-v13.md`
- `docs/2026-07-01-phase-4-8c2-collaborative-drag-presence-handoff.md`
- `docs/2026-07-01-phase-4-8e-online-member-presence-handoff.md`
- `docs/2026-07-01-phase-4-8f-remote-drag-visual-handoff.md`

---

## Existing Data Model

Destination-like fields currently available on `itinerary_items`:

- `location`
- `location_name`
- `address`
- `map_url`
- `latitude`
- `longitude`
- `description`
- `transportation_note`

Destination package rules already include:

- `location_name`
- `address`
- `map_url`
- `latitude`
- `longitude`

This is important: if a destination package moves through existing reorder flows, its map fields should move with it. That means Phase 4.9 does not need to redesign reorder RPCs to keep basic marker identity attached to a destination.

Current gaps:

- No observed `place_id` field.
- No route polyline field.
- No distance field.
- No route provider field.
- No route cache metadata.
- Demo data has `latitude` and `longitude` keys, but values are generally `null`.
- Timeline forms currently expose destination name, address, and map URL, but do not expose latitude/longitude editing.
- `normalizeItemPayload()` does not currently include latitude/longitude in the normalized save payload.
- Transportation cards store duration and pair anchors, not calculated route geometry.

Accommodation also has map-capable fields:

- `address`
- `map_url`
- `latitude`
- `longitude`

Accommodation map integration should be treated as a later extension unless Phase 4.9 explicitly expands beyond Timeline.

---

## Map / Timeline Integration Opportunities

### Timeline card to Map focus

Recommended: yes.

Clicking a Timeline destination card should focus the corresponding map marker when a marker exists. This can reuse `focusedItemId` first, with no new persisted state. If coordinates are missing, the map surface can still focus a list stop or show an "open map link" affordance when `map_url` exists.

Do not make focus state part of reorder logic.

### Map marker to Timeline focus / scroll

Recommended: yes, but in small steps.

Clicking a marker should:

1. Set `focusedItemId`.
2. Keep the active day unchanged if the marker belongs to the active day.
3. Later, scroll the matching card into view with a scoped day-board helper.

Avoid adding scroll-sync during the first implementation if it risks disturbing drag sensors or day-board scroll ownership.

### Day switch behavior

Recommended: yes.

Map content should follow the active Timeline day. This matches current `RoutePanel` behavior because it receives only `dayItems` for the active day.

Collapsed multi-day board mode should not require all maps to render at once.

### Transportation cards and route segments

Recommended: defer real segments.

Transportation cards already identify route intent through:

- `transport_role`
- `from_item_id`
- `to_item_id`
- `transport_duration_minutes`
- transport category/name/note

For early 4.9, use them only as visual relationships:

- highlight the source and target markers when a transport card is focused;
- show a simple non-geographic connector only if both endpoint markers have coordinates;
- keep real route calculation out of scope.

Do not infer a route from transport duration, and do not write calculated route data.

### Remote selection and Map

Recommended: not in the first slice.

Phase 4.8d remote card selection is navigation/awareness UI, not authoritative state. A later 4.9 slice may reflect remote selection on the map with a subtle marker border, but it should be visual-only and must not affect local focus, drag locks, reorder, or route calculations.

### Demo strategy

Recommended: Demo first for UI parity, but with explicit mock coordinates.

Because current Demo data mostly has `latitude`/`longitude: null`, the first map-like implementation should either:

- use a deterministic mock coordinate set added to Demo only after review; or
- render a non-geographic route surface from existing stop order; or
- support coordinates when present and gracefully fall back to current route-list behavior.

Do not connect Demo to Google APIs or Supabase presence.

---

## Proposed Phase 4.9 Sub-phases

### 4.9a - Map data contract and marker helper

Goal:

- Add a pure helper contract for deriving day markers from Timeline items.
- No UI overhaul, no SDK, no DB writes.

Candidate output:

- `buildDayMapMarkers(dayItems)`
- marker shape:

```js
{
  id,
  itemId,
  dayIndex,
  title,
  locationName,
  address,
  mapUrl,
  latitude,
  longitude,
  hasCoordinates,
  itemType
}
```

QA:

- Unit/source-level tests or focused smoke checks that transports are excluded from marker generation.
- Confirm missing coordinates degrade cleanly.

### 4.9b - Timeline focus to map surface

Goal:

- Keep current `RoutePanel`/map surface, but make the focus contract explicit.
- Clicking Timeline destination focuses the corresponding stop/marker.
- Clicking map stop/marker focuses the Timeline card.

Constraints:

- No scroll-sync unless isolated and low-risk.
- No reorder, presence, or RPC changes.

### 4.9c - Map surface v1 without route calculation

Goal:

- Replace or extend the current stylized `route-map` with a more map-like day surface.
- Support markers for items with coordinates.
- Fall back to ordered stops for items without coordinates.
- Keep Demo and Formal on the same component.

Constraints:

- No Google API.
- No new package.
- No generated route geometry.

### 4.9d - Transport relationship overlay

Goal:

- When a transport card is focused, visually identify its `from_item_id` and `to_item_id`.
- If both endpoints have coordinates, optionally draw a straight visual connector as a planning hint.

Constraints:

- No route calculation.
- No transport repair.
- No changes to transport role model.

### 4.9e - Optional schema/API proposal

Goal:

- Decide whether current fields are enough for real Google Maps.
- If not, prepare a migration/API proposal only.

Possible migration proposal, not approved for implementation:

- Add `google_place_id text` to destination-bearing records.
- Add optional route cache fields only if product wants route rendering:
  - `route_polyline text`
  - `route_distance_meters integer`
  - `route_duration_seconds integer`
  - `route_provider text`
  - `route_updated_at timestamptz`

This should wait for explicit approval because it affects schema, costs, API keys, and data ownership.

### 4.9f - Layout polish and parity QA

Goal:

- Polish desktop expanded/collapsed map layout.
- Validate mobile behavior.
- Validate Formal/Demo parity.

Constraints:

- Do not redesign Timeline cards or dnd-kit structure.
- Do not make map layout changes that break day-board scroll ownership.

---

## Protected Scope

Do not change in Phase 4.9 unless explicitly requested:

- reorder RPCs
- Supabase migrations
- Phase 4.7 fixed-anchor planner
- untimed sort/rebase rules
- transport role model
- transport repair/cleanup behavior
- dnd-kit sortable structure
- drag handle rules
- local DragOverlay behavior
- collaborative drag presence channels
- `timeline-drag:{tripId}:{dayIndex}`
- trip-level online presence channel
- remote card selection behavior
- Demo Supabase/Auth/Realtime isolation
- Draft/Edit Lock behavior
- Active Editor Guard behavior
- Google OAuth/Auth flow

Map functionality must not:

- change Timeline ordering;
- change item times;
- change transport adjacency;
- trigger reorder RPC;
- become an input to RPC validation;
- synchronize remote preview order;
- create remote ghost cards;
- write route calculation output without a separate approved phase.

---

## Risks

### Data completeness

The schema already supports latitude/longitude, but current data may not contain values. Demo data mostly has null coordinates. A real map will need either manual coordinate entry, imported coordinates, geocoding, or a place search flow.

### Missing `place_id`

No `place_id` was found. Without a stable place ID, Google marker/place behavior may depend on coordinates or map URLs only. Map URLs are user-friendly links but are not a robust internal place identifier.

### Route geometry is absent

Transportation cards currently carry duration and relationship metadata, not route geometry. Any polyline/route drawing needs either mocked visual lines or a future API/cache design.

### API key and cost

No current Google Maps JS SDK integration or map SDK env variable was observed. Real Google Maps work will need product decisions around:

- API key name and Vite exposure;
- allowed referrers;
- billing and rate limits;
- fallback when the map SDK fails;
- privacy expectations for sending trip places to a third-party API.

### UX interference with Timeline drag

The Timeline Day Board has carefully tuned drag and scroll behavior. Map focus/scroll features must not intercept drag handles, alter card dimensions unexpectedly, or compete with the Day Board scroll container.

### Collaboration semantics

Remote selection and drag presence are best-effort UI hints. Map awareness must stay visual-only and must not become lock state or authoritative route/order state.

---

## Recommended First Implementation Step

The safest first implementation step is:

### 4.9a: Add a pure day marker derivation helper and wire it into the existing `RoutePanel` without changing behavior.

Suggested shape:

- Create a small helper that converts active-day destination visits into marker-like data.
- Exclude transportation cards from markers.
- Preserve current `RoutePanel` output while internally consuming the helper.
- Add fallback handling for missing coordinates.
- Add source-level or small smoke coverage to confirm:
  - destination cards can produce marker records;
  - transport cards do not produce markers;
  - null latitude/longitude does not crash the route/map surface;
  - `focusedItemId` remains local UI state only.

Why this is safest:

- It validates data shape before UI work.
- It keeps Demo/Formal parity.
- It does not require Google APIs, new packages, migrations, or route calculation.
- It does not touch reorder, drag, RPC, or presence logic.

---

## Suggested QA Checklist

Read-only/data prep:

- `npm.cmd run build`
- `git diff --check`

When 4.9a helper/UI wiring begins:

- `npm.cmd run build`
- `npx.cmd playwright test tests/phase-1-7f-smoke.spec.js`
- `npx.cmd playwright test tests/phase-4-2c-reorder.spec.js`
- focused source-level test for marker helper if a helper file is added
- manual Demo `/demo/timeline` check:
  - active day route/map still renders;
  - destination click focuses route/map stop;
  - route/map stop click focuses destination card;
  - transportation card remains non-draggable and does not become a marker;
  - collapsed route/map mode still shows inactive day boards;
  - inactive day board presence dots still show only foreign users and max 3.

Formal manual check:

- active Timeline day map follows day switch;
- map focus does not change item order;
- drag reorder still uses the existing handle;
- foreign drag lock still disables same-day drag only;
- remote drag source/insertion visuals still render;
- remote card selection border still works;
- no network request to Google Maps is made in pre-API phases.

Regression guard:

- If any map work touches Timeline card rendering, rerun Phase 4.8c/4.8f related specs.
- If any map work touches workspace collapse layout, verify desktop expanded/collapsed and mobile responsive layout.

---

## Implementation Notes For The Next Chat

- Treat current `RoutePanel` as the first map integration seam.
- Keep `focusedItemId` as the first shared focus state.
- Add marker derivation before map SDK decisions.
- Use Demo only as local UI parity, not as Realtime/mock presence.
- Defer migration/API choices until there is a confirmed need for real map markers, place search, or route polylines.
