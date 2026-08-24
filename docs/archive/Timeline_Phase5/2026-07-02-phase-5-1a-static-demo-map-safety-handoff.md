# Timeline Phase 5.1a Static Demo Map Safety Handoff

Date: 2026-07-02
Branch: `codex/timeline-phase-5`
Status: Implemented locally / no Google SDK / no API key / no package / no migration / no commit / no push

---

## Summary

Phase 5.1a makes the Demo map path safe before any Formal Google Map MVP work.

Implemented:

- Demo `RoutePanel` now explicitly passes `mode="demo"`.
- Formal `RoutePanel` explicitly passes `mode="formal"`.
- `MapPanel` forwards `mode` into `getMapProviderConfig()`.
- `getMapProviderConfig({ mode: "demo" })` always returns the static provider, even if `providerId: "google"` and `enableRealMap: true` are requested.
- `StaticMapProvider` now displays coordinate-bearing static markers on the existing grid surface.
- `StaticMapProvider` still falls back to the existing route-stop/list surface for missing coordinates.
- Demo fixture now has 16 mock coordinate pairs across Day 0 through Day 2.
- Source-level tests cover Demo provider safety and Demo mock coordinates.

Not implemented:

- Google Maps SDK.
- Google API key or env file.
- Map package.
- Places, Geocoding, Directions, Routes, route calculation, polyline, or route cache.
- Supabase migration, schema, RPC, or RLS changes.
- Timeline reorder, dnd-kit, drag overlay, presence, remote selection, online presence, transport role model, or Budget changes.

---

## Demo Provider Safety

Demo route rule:

```text
Demo route:
always -> StaticMapProvider
never  -> GoogleMapProvider
never  -> Google Maps SDK
never  -> Google API quota
```

Implemented by:

- Passing `mode="demo"` from the Demo Timeline `RoutePanel`.
- Returning static config immediately in `getMapProviderConfig()` when `mode === "demo"`.

This is intentionally independent of any future Formal provider switch.

---

## Static Marker Surface

`StaticMapProvider` now splits markers into:

- coordinate markers: `marker.hasCoordinates === true`
- fallback stops: markers without coordinates

Coordinate markers render as buttons on the static grid:

- positioned by normalized latitude/longitude bounds;
- labelled with the same route stop index;
- clickable through `onFocusItem(marker.itemId)`;
- compatible with focused destination styling;
- compatible with transportation endpoint highlight classes.

Missing-coordinate markers remain in the fallback route-stop list. Empty days still show the static empty state.

This is not a real map and does not draw route geometry.

---

## Demo Mock Coordinates

Updated file:

```text
src/demo-kyoto-trip.json
```

Current Demo coordinate count:

```text
destination-like items: 31
with usable coordinates: 16
Day 0: 3
Day 1: 7
Day 2: 6
```

Coordinates are plain numeric mock coordinates. No `provider_place_id`, migration, Google URL parsing, or geocoding was added.

---

## Tests

Updated:

- `tests/mapProviderPrep.spec.js`
- `tests/timelineMapMarkers.spec.js`

Coverage added:

- Demo provider config is forced to static even when Google + real map is requested.
- Demo and Formal `RoutePanel` calls pass explicit mode.
- Demo fixture produces coordinate-bearing marker helper output for Day 1.

Verification run:

```text
npx.cmd playwright test tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js
passed 15/15

npm.cmd run build
passed with existing Vite large-chunk warning

git diff --check
passed with Windows LF/CRLF notices only

rg "google\.maps|VITE_GOOGLE_MAPS_API_KEY|maps.googleapis|Directions|Routes|Places|Geocoding|leaflet|maplibre|maptiler|stadiamaps" src package.json package-lock.json
returned no matches
```

Build output:

```text
JS 764.78 KB raw / 211.56 KB gzip
CSS 73.49 KB raw / 13.31 KB gzip
```

---

## Next Step

Phase 5.1 Formal Google Map MVP can now start as a markers-only implementation if the user approves Google Cloud/API key/env/billing/referrer setup.

Keep Phase 5.1 behind `MapPanel` and `GoogleMapProvider.lazy`, preserve `StaticMapProvider` fallback, and keep Demo permanently static unless the user explicitly requests a separate Demo real-map mode.
