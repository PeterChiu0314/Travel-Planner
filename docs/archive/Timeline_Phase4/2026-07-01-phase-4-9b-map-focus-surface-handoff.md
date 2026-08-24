# Timeline Phase 4.9b Map Focus Surface Handoff

Date: 2026-07-01
Branch: `codex/timeline-phase-4-9`
Status: Implemented locally / pending user review / no push yet

---

## Summary

Phase 4.9b turns the existing Timeline / RoutePanel focus behavior into an explicit provider-neutral Map Focus Surface.

It keeps the current `RoutePanel` placeholder UI and shared `focusedItemId` state, while adding helper contracts for future marker/map adapters. The work does not add Google Maps SDK, API keys, route calculation, map packages, migrations, RPC changes, reorder changes, or presence changes.

---

## Goal Scope

Implemented:

- Timeline destination card focus maps to the matching RoutePanel stop / future marker.
- RoutePanel stop click continues to focus the matching Timeline destination card.
- Focused transportation cards identify their `from_item_id` and `to_item_id` RoutePanel endpoint stops when available.
- Tail-pending transportation with `to_item_id = null` highlights only the source endpoint.
- Missing endpoints degrade safely without throwing or creating fake markers.
- The focus surface remains local UI state only through `focusedItemId`.

Not implemented:

- Google Maps SDK.
- API key or env var.
- Map package.
- Route calculation or polyline rendering.
- Route distance/duration cache.
- Scroll-to-card sync.
- Database writes.

---

## Helper Contract

File:

```text
src/lib/timelineMapMarkers.js
```

Existing 4.9a export:

```js
buildDayMapMarkers(dayItems, options?)
```

New 4.9b exports:

```js
buildRoutePanelStops(dayItems, options?)
getFocusedMapState(dayItems, markers, focusedItemId)
getTransportEndpointMarkerIds(dayItems, markers, transportItemOrId)
```

The helpers are provider-neutral. They do not import React, touch the DOM, call Google APIs, load SDK objects, sort items, or mutate inputs.

---

## Focus Behavior

Destination focus:

- Timeline destination click sets `focusedItemId` to the visit id.
- RoutePanel derives the matching marker/stop id from the provider-neutral marker contract.
- The matching stop receives the existing `focused` class.
- RoutePanel stop click sets `focusedItemId` back to the destination id.

Transport focus:

- Timeline transportation card click sets `focusedItemId` to the transport card id.
- `getFocusedMapState()` detects the focused item is transportation-like.
- `getTransportEndpointMarkerIds()` maps `from_item_id` and `to_item_id` to available marker ids.
- RoutePanel applies endpoint classes to matching stops.
- Tail transport with `to_item_id = null` only marks the source stop.

Endpoint classes:

```text
route-stop-transport-endpoint
route-stop-transport-from
route-stop-transport-to
```

---

## RoutePanel Wiring

`RoutePanel` now uses:

```js
buildRoutePanelStops(sortedVisitItems(dayItems), { requireLocation: true })
getFocusedMapState(dayItems, stops, focusedItemId)
```

Visible structure is preserved:

- `.route-map`
- `.route-line`
- `.route-stop`
- `.route-dot`
- `.route-name`

No workspace layout, Day Board scroll, dnd-kit structure, DragOverlay, route collapse behavior, or Timeline card design was changed.

---

## Protected Boundaries Preserved

No changes were made to:

- Google Maps SDK / API key / env var.
- map package installation.
- Supabase migrations.
- Supabase schema.
- reorder RPCs.
- official Timeline reorder flow.
- dnd-kit sortable structure.
- drag handle rules.
- local DragOverlay behavior.
- foreign drag presence.
- remote drag source / insertion line.
- remote selection behavior.
- online member presence.
- trip/day presence channels.
- fixed-anchor planner.
- untimed rebase.
- transport role model.
- route calculation.
- provider-specific map object naming.

---

## Tests

Added:

```text
tests/timelineMapFocus.spec.js
```

Coverage:

- RoutePanel stops remain provider-neutral.
- Destination focus resolves to the matching marker id.
- Focused transportation card resolves to from/to endpoint marker ids.
- Tail transport with `to_item_id = null` does not throw.
- Missing endpoint does not throw.
- Transportation cards are not emitted as marker records.
- Focus helper output does not contain Google-specific naming.

Recommended targeted commands:

```text
npx.cmd playwright test tests/timelineMapMarkers.spec.js
npx.cmd playwright test tests/timelineMapFocus.spec.js
npm.cmd run build
git diff --check
```

---

## Recommended Next Step

Phase 4.9c should be Google Map Provider Prep, not immediate SDK integration.

Suggested 4.9c focus:

- define the provider adapter boundary;
- decide whether SDK loading should be lazy and route-surface scoped;
- decide env var naming and fallback behavior before adding any API key;
- keep Timeline and RoutePanel consuming provider-neutral marker/focus contracts;
- continue deferring route calculation, route cache schema, migration, and transport repair.
