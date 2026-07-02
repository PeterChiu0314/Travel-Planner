# Timeline Phase 5.0 Map MVP Readiness Audit Handoff

Date: 2026-07-02
Branch: `codex/timeline-phase-5`
Status: Readiness audit complete / docs only / no SDK / no API key / no package / no migration / no commit / no push

---

## Summary

Phase 5.0 audited whether the Phase 4.9a through 4.9c map seam is ready for a Phase 5.1 Google Map MVP, markers only.

Conclusion: the code boundary is ready for a narrow markers-only MVP, as long as Phase 5.1 stays inside the existing provider seam and keeps `StaticMapProvider` as the fallback. The main readiness gap is data, not architecture: Demo fixture destinations currently have no usable coordinates, and Formal data may also have missing or null latitude/longitude values.

Phase 5.1 can proceed only after Google Cloud/API key/env/billing/referrer setup is approved outside the repo. It should not include Places, Geocoding, Directions, Routes, route polylines, route cache, schema migration, or transportation repair.

---

## Files Reviewed

Required docs:

- `CURRENT_TASK.md`
- `AGENT.md`
- `docs/UX_RULES.md`
- `docs/BUGS.md`
- `docs/2026-07-01-phase-4-9-map-integration-prep.md`
- `docs/2026-07-01-phase-4-9a-map-marker-contract-handoff.md`
- `docs/2026-07-01-phase-4-9b-map-focus-surface-handoff.md`
- `docs/2026-07-01-phase-4-9c-google-map-provider-prep-handoff.md`
- `docs/todo/phase-5-map-route-workspace-integration-handoff.md`

Source and test files:

- `src/App.jsx`
- `src/components/map/MapPanel.jsx`
- `src/components/map/providers/StaticMapProvider.jsx`
- `src/components/map/providers/GoogleMapProvider.lazy.jsx`
- `src/lib/mapProviderConfig.js`
- `src/lib/mapProviderAdapter.js`
- `src/lib/timelineMapMarkers.js`
- `src/demo-kyoto-trip.json`
- `tests/timelineMapMarkers.spec.js`
- `tests/timelineMapFocus.spec.js`
- `tests/mapProviderPrep.spec.js`
- `package.json`
- `package-lock.json`
- `.gitignore`

Archive policy was preserved. `docs/archive/` was not read.

---

## 1. Provider Seam Readiness

Readiness: ready for Phase 5.1 markers-only, with one implementation caveat.

Current route:

```text
RoutePanel
-> buildRoutePanelStops(sortedVisitItems(dayItems), { requireLocation: true })
-> getFocusedMapState(dayItems, stops, focusedItemId)
-> MapPanel
-> buildMapProviderAdapterInput()
-> StaticMapProvider
```

What is ready:

- `MapPanel` is a clear provider seam and receives provider-neutral `markers`, `focusedMapState`, and `onFocusItem`.
- `StaticMapProvider` preserves the current `.route-map` / `.route-stop` fallback surface.
- `GoogleMapProvider.lazy.jsx` exists as a placeholder and currently falls back to `StaticMapProvider`.
- `loadGoogleMapProviderModule()` exists as the future dynamic import seam.
- `mapProviderConfig` already models `static` vs `google`, lazy loading, real-map enablement, and static fallback.
- `mapProviderAdapter` passes only plain marker/focus data into provider implementations.
- `timelineMapMarkers` exposes the needed pure helpers:
  - `buildDayMapMarkers(dayItems, options?)`
  - `buildRoutePanelStops(dayItems, options?)`
  - `getFocusedMapState(dayItems, markers, focusedItemId)`
  - `getTransportEndpointMarkerIds(dayItems, markers, transportItemOrId)`
- Transportation endpoint highlight is provider-neutral and maps `from_item_id` / `to_item_id` into marker ids.

Implementation caveat:

- `MapPanel` currently always renders `StaticMapProvider`; it computes `providerConfig`, but does not yet choose the lazy Google provider. Phase 5.1 must add provider selection behind `providerConfig` while keeping static fallback on missing key, disabled provider, import failure, or SDK failure.

---

## 2. Demo Coordinate Readiness

Readiness: not ready for visible Google markers without adding mock coordinates.

Source scan of `src/demo-kyoto-trip.json`:

```text
items: 41
destination-like items: 31
destinations with usable latitude + longitude: 0
destinations missing usable coordinates: 31
```

Current implication:

- Demo can still render the existing static ordered route-stop surface.
- Demo can test fallback behavior and focus behavior.
- Demo cannot visually demonstrate Google map markers until mock coordinates are added.

Recommended Phase 5.1 data boundary:

- Add mock coordinates to Demo fixture only if the user wants visible Demo markers during Phase 5.1.
- Do not add Formal schema fields; latitude/longitude already exist.
- Do not add geocoding.
- Do not parse Google Maps URLs into coordinates.
- Do not add Google Places.
- Do not introduce migration or route cache.

---

## 3. Formal Fallback Readiness

Readiness: mostly ready, as long as Phase 5.1 treats coordinates as optional.

Expected safe behavior:

- Missing API key should render `StaticMapProvider`.
- Disabled provider should render `StaticMapProvider`.
- SDK import/load failure should render `StaticMapProvider`.
- Missing active-day items should render the existing empty static route surface.
- Destination rows with missing, null, empty, or invalid coordinates should not throw.
- Destination rows without coordinates should not become Google markers.
- Transportation cards should not become markers.
- Focused transportation cards can still highlight available endpoint stops through provider-neutral endpoint ids.
- Tail transportation with `to_item_id = null` should highlight only the source endpoint when available.

Important existing helper behavior:

- `buildDayMapMarkers()` returns destination markers even when coordinates are missing, with `hasCoordinates: false`.
- `StaticMapProvider` can display ordered stops without coordinates.
- A future Google provider should filter to `marker.hasCoordinates === true` for actual Google markers and keep non-coordinate destinations in fallback/list UI.

---

## 4. Google Maps API / Env / Billing Checklist

Required outside-repo setup before Phase 5.1 real-map enablement:

- Google Cloud project selected or created.
- Maps JavaScript API enabled.
- Billing account enabled.
- Budget alert configured.
- Quota limits reviewed.
- API key created.
- API key restricted by HTTP referrers.
- Localhost referrers added for development.
- Vercel preview domain referrers added.
- Vercel production domain referrers added.
- Vite env name confirmed: recommended `VITE_GOOGLE_MAPS_API_KEY`.
- Optional provider switch env confirmed only if needed: recommended `VITE_MAP_PROVIDER`.
- Vercel env vars added for Development, Preview, and Production as needed.
- Key is never committed.
- `.env` is gitignored. `.env.local` is not explicitly listed, but `.env` is ignored; add `.env.local` if local workflow needs it before creating that file.

Do not request or paste real keys into chat.

---

## 5. SDK Lazy-Load Readiness

Readiness: ready as a seam, not yet implemented as a real loader.

Current safeguards:

- No Google SDK import exists in `App.jsx`.
- No `google.maps` top-level access exists in `src`.
- No script injection exists.
- No map package is installed.
- `GoogleMapProvider.lazy.jsx` currently imports only `StaticMapProvider`.
- `loadGoogleMapProviderModule()` uses dynamic `import()`.
- `mapProviderConfig` marks Google provider as `loadMode: "lazy"`.

Phase 5.1 must preserve:

- SDK must not be in the initial/main bundle.
- SDK loading must be route/map-surface scoped.
- No module should read `window.google.maps` at top level.
- No module should inject Google SDK script at top level.
- Provider failure must not break `RoutePanel`, Timeline, drag, focus, or day switching.
- Static fallback must remain available for Demo, missing key, quota/API failure, and SDK failure.

---

## 6. Source Scan Results

Command requested by the Phase 5.0 prompt:

```text
rg "google\.maps|VITE_GOOGLE_MAPS_API_KEY|maps.googleapis|Directions|Routes|Places|Geocoding|leaflet|maplibre|maptiler|stadiamaps" src package.json package-lock.json
```

Result:

- No matches in `src`, `package.json`, or `package-lock.json`.

Additional package scan:

- No `@googlemaps`.
- No `@react-google-maps`.
- No Leaflet.
- No MapLibre.
- No Mapbox package.
- No MapTiler package.
- No Stadia Maps package.

This confirms Phase 4.9c did not introduce SDK/runtime coupling.

---

## 7. Phase 5.1 Implementation Boundary

Recommended goal:

```text
Phase 5.1 Google Map MVP - markers only
```

Allowed:

- Add Google Maps JavaScript API lazy loading behind `GoogleMapProvider.lazy`.
- Read API key from Vite env, likely `VITE_GOOGLE_MAPS_API_KEY`.
- Optionally read provider switch from `VITE_MAP_PROVIDER` or equivalent explicit app config.
- Render Google markers only for destination markers with usable stored coordinates.
- Use the Phase 4.9 provider-neutral marker contract.
- Timeline destination focus should focus the matching marker when present.
- Google marker click should call `onFocusItem(marker.itemId)` and reuse existing focused card styling.
- Active day change should replace marker set.
- Missing API key should fall back to static provider.
- SDK load failure should fall back to static provider.
- Missing destination coordinates should fall back to static/list surface without throwing.

Not allowed in Phase 5.1:

- Places search or autocomplete.
- Geocoding.
- Google Maps URL parsing.
- Directions API.
- Routes API.
- Route polyline.
- Distance or duration calculation.
- Route cache.
- Migration.
- Marker drag.
- Timeline reorder changes.
- Transportation time calculation.
- Transportation card creation, repair, rewrite, or deletion behavior changes.
- Budget integration.

---

## 8. QA Checklist

Docs-only Phase 5.0 verification:

- `git diff --check`

Before and during Phase 5.1 source work:

- `npx.cmd playwright test tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js`
- `npm.cmd run build`
- `git diff --check`

Manual checks for Phase 5.1:

- Demo without API key falls back to static route surface.
- Formal without API key falls back to static route surface.
- API key present plus coordinate-bearing destinations renders Google markers.
- Destination card click focuses the matching marker.
- Marker click focuses the matching Timeline destination card.
- Active day switch replaces marker set.
- Destination without coordinates does not throw and does not render a Google marker.
- Transportation card does not render as a marker.
- Focused transportation card highlights available endpoint markers/stops.
- Tail transport highlights only the source endpoint.
- SDK load failure falls back to static provider.
- No Google SDK appears in the initial/main bundle.
- Timeline drag handle, DragOverlay, foreign drag presence, remote selection, and online presence still behave as before.

---

## 9. Residual Risks

- Demo has zero usable destination coordinates, so visible marker QA needs fixture coordinates or Formal seed data.
- Formal latitude/longitude completeness is unknown and should be treated as optional.
- The existing Timeline form does not expose latitude/longitude editing, so users cannot manually repair missing coordinates in-app yet.
- `MapPanel` provider selection still needs implementation; the seam exists but currently always renders static.
- `.env.local` is not explicitly listed in `.gitignore`; consider adding it before creating local env files.
- The current Vite large-chunk warning already exists and should be watched when adding any map loader.

---

## 10. Ready For Phase 5.1?

Yes, with constraints.

Phase 5.1 is ready to start as a narrow Google Maps JavaScript API markers-only MVP if the user approves API key/env/billing/referrer setup and accepts static fallback as the default failure mode.

Do not expand Phase 5.1 into route calculation, Places, Geocoding, Directions/Routes API, schema changes, or transportation workflow changes.
