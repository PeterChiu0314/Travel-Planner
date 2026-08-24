# Timeline Phase 5.1b Formal Google Map Loader Handoff

Date: 2026-07-02
Branch: `codex/timeline-phase-5`
Status: Implemented locally / Formal-only lazy loader path / no API key / no marker rendering / no migration / no commit / no push

---

## Summary

Phase 5.1b adds the Formal-only Google Maps JavaScript API loader path. It does not implement the real Google map canvas, markers, marker click behavior, route calculation, Places, Geocoding, Directions, Routes, route cache, or any database change.

Implemented:

- Installed the approved package `@googlemaps/js-api-loader`.
- Added `src/lib/googleMapsLoader.js`.
- Added Formal provider selection using `VITE_MAP_PROVIDER` and `VITE_GOOGLE_MAPS_API_KEY`.
- Preserved Demo static safety from Phase 5.1a.
- Added lazy provider import from `MapPanel`.
- Added loader smoke behavior in `GoogleMapProvider.lazy.jsx`.
- Added `.env.local` to `.gitignore`.
- Added source-level tests for Demo safety, Formal provider config, missing-key fallback, and loader missing-key failure.

---

## Formal Provider Flow

Current Formal behavior:

```text
provider static -> StaticMapProvider
provider google + missing API key -> StaticMapProvider
provider google + API key -> lazy import GoogleMapProvider
Google provider loader success -> Google Map ready placeholder
Google provider loader failure -> StaticMapProvider
```

The env names are:

```text
VITE_MAP_PROVIDER
VITE_GOOGLE_MAPS_API_KEY
```

No env file or real key was created.

---

## Demo Safety

Demo remains hard-locked to static:

```text
Demo route:
always -> StaticMapProvider
never  -> GoogleMapProvider
never  -> Google Maps SDK
never  -> Google API quota
```

`getMapProviderConfig({ mode: "demo" })` returns static config even if `providerId: "google"` and `enableRealMap: true` are requested.

---

## Loader Helper

Added:

```text
src/lib/googleMapsLoader.js
```

Behavior:

- Imports `Loader` from `@googlemaps/js-api-loader`.
- Creates the loader instance inside `loadGoogleMapsApi()`.
- Throws `Missing Google Maps API key` when no key is supplied.
- Calls `loader.importLibrary("maps")`.
- Does not import Places, Directions, Routes, or Geocoding libraries.
- Does not read `window.google.maps` at module top level.
- Does not inject a script at module top level.
- Does not log or expose API keys.

---

## Google Provider Smoke

`GoogleMapProvider.lazy.jsx` now:

- calls `loadGoogleMapsApi({ apiKey })`;
- shows `Google Map ready` after loader success;
- falls back to `StaticMapProvider` while loading or after failure;
- does not call `new google.maps.Map()`;
- does not render Google markers;
- does not implement marker click interaction.

Marker rendering and marker interaction remain deferred to Phase 5.1c.

---

## Package Scope

Added approved package:

```text
@googlemaps/js-api-loader
```

NPM also added its transitive type dependency:

```text
@types/google.maps
```

No other map package was added:

- no `@react-google-maps/api`
- no Leaflet
- no MapLibre
- no Mapbox
- no MapTiler
- no Stadia Maps

---

## Verification

Commands run:

```text
npx.cmd playwright test tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js
passed 17/17

npm.cmd run build
passed with existing Vite large-chunk warning

git diff --check
passed with Windows LF/CRLF notices only
```

Build output:

```text
GoogleMapProvider.lazy chunk: 1.11 KB raw / 0.66 KB gzip
main JS: 766.55 KB raw / 212.39 KB gzip
CSS: 73.72 KB raw / 13.35 KB gzip
```

Source scan:

```text
rg "google\.maps|maps.googleapis|Directions|Routes|Places|Geocoding|leaflet|maplibre|maptiler|stadiamaps" src package.json package-lock.json
```

Result:

- No matches in `src`.
- No Places / Directions / Routes / Geocoding / Leaflet / MapLibre / MapTiler / Stadia runtime coupling.
- Expected package-lock-only matches for transitive `@types/google.maps`.

---

## Next Step

Phase 5.1c can implement Formal Google Map markers only:

- instantiate a Google map only inside `GoogleMapProvider.lazy`;
- render markers only for provider-neutral markers with stored coordinates;
- marker click calls `onFocusItem(marker.itemId)`;
- preserve Demo static-only behavior;
- preserve StaticMapProvider fallback for missing key, loader failure, and missing coordinates.

Do not add Places, Geocoding, Directions, Routes, route polylines, route cache, migration, transportation repair, Timeline reorder changes, drag/presence changes, or API keys in repo.
