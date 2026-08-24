# Timeline Phase 4.9a Map Marker Contract Handoff

Date: 2026-07-01
Branch: `codex/timeline-phase-4-9`
Status: Implemented locally / pending user review / no push yet

---

## Summary

Phase 4.9a adds the first Map integration contract without adding a map SDK or changing Timeline behavior.

The new helper converts the active day's Timeline destination items into provider-neutral marker records. The contract is Google-first in product direction, but it is intentionally not named or shaped as a Google-only marker so a future map provider can be swapped with lower risk.

No database migration, Supabase RPC, reorder flow, route calculation, Google API key, or map package was added.

---

## Helper

File:

```text
src/lib/timelineMapMarkers.js
```

Export:

```js
buildDayMapMarkers(dayItems, options?)
```

Behavior:

- Accepts active-day Timeline items.
- Returns marker records in the same order as the input list.
- Includes destination/visit-like items.
- Excludes transportation cards.
- Does not mutate input items.
- Does not depend on React, the DOM, Google Maps SDK, or external APIs.
- Safely parses numeric latitude/longitude strings.
- Treats missing or invalid coordinates as `null`.
- Does not throw when coordinates are incomplete.

Current option:

```js
{
  requireLocation?: boolean
}
```

`RoutePanel` uses `requireLocation: true` to preserve its existing route-stop behavior.

---

## Marker Contract

Each marker currently has this provider-neutral shape:

```js
{
  id: string,
  itemId: string,
  itemType: "destination",
  title: string,
  locationName: string,
  address: string,
  mapUrl: string,
  latitude: number | null,
  longitude: number | null,
  hasCoordinates: boolean,
  coordinateSource: "stored" | "missing",
  provider: string | null,
  providerPlaceId: string | null,
  dayIndex: number | null,
  sortOrder: number | null
}
```

Notes:

- `provider` and `providerPlaceId` are reserved for future provider-specific integration.
- They are not Google-only fields.
- Current data normally leaves them `null`.
- `hasCoordinates` is true only when both latitude and longitude are finite numbers.
- `coordinateSource` is `stored` only when both coordinates are usable.

---

## RoutePanel Wiring

`RoutePanel` now derives its existing stop list through `buildDayMapMarkers(sortedVisitItems(dayItems), { requireLocation: true })`.

The visible UI is intended to stay unchanged:

- same `.route-map`
- same `.route-stop`
- same `.route-dot`
- same `.route-name`
- same `focusedItemId` behavior
- no CSS change
- no new map UI

This wiring makes `RoutePanel` the first Map integration seam while keeping the current placeholder route surface intact.

---

## Google-first, Provider-switchable Principle

Future Phase 4.9 work may choose Google Maps first for product UX, but Timeline and RoutePanel should depend on this neutral marker contract instead of Google SDK objects.

Recommended boundary:

```text
Timeline items -> buildDayMapMarkers() -> provider-neutral markers -> map adapter
```

Future adapters can map the neutral markers into:

- Google Maps markers / AdvancedMarkerElement
- Leaflet markers
- MapLibre layers
- MapTiler / Stadia-backed tiles and overlays
- a non-geographic fallback route surface

Do not let Timeline data, drag/reorder logic, or `RoutePanel` become coupled to a specific map SDK.

---

## Protected Boundaries Preserved

No changes were made to:

- Supabase migrations
- Supabase schema
- reorder RPCs
- official reorder persistence flow
- Phase 4.7 fixed-anchor planner
- untimed sort/rebase rules
- transport role model
- route calculation
- dnd-kit sortable structure
- Timeline drag handle behavior
- foreign drag presence
- remote selection
- online member presence
- Demo presence isolation
- Google API key / env vars
- external map packages
- CSS layout

---

## Tests

Added:

```text
tests/timelineMapMarkers.spec.js
```

Coverage:

- destination item produces a marker.
- transportation cards are excluded.
- valid latitude/longitude strings become numbers.
- invalid/missing coordinates do not throw and produce `hasCoordinates: false`.
- marker order follows input order.
- provider/providerPlaceId remain neutral and are not Google-bound.
- input items are not mutated.

Recommended targeted command:

```text
npx.cmd playwright test tests/timelineMapMarkers.spec.js
```

---

## Recommended Next Step

Phase 4.9b should build on this contract:

- keep using `focusedItemId` as the first shared Timeline/Map focus state;
- make Timeline card focus and map marker/stop focus explicit;
- optionally add scroll-to-card only after verifying it does not disturb Day Board scroll ownership or dnd-kit drag sensors;
- keep Demo and Formal on the same component path;
- do not add Google Maps SDK until the provider adapter boundary is agreed.
