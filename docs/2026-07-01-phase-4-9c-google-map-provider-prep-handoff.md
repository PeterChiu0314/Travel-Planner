# Timeline Phase 4.9c Google Map Provider Prep Handoff

Date: 2026-07-01
Branch: `codex/timeline-phase-4-9`
Status: Implemented locally / pending user review / no push yet

---

## Goal Scope

Phase 4.9c prepares the Google Map provider boundary without adding a real map SDK.

Implemented:

- Added a provider-neutral `MapPanel` seam.
- Added a static provider that preserves the existing RoutePanel placeholder surface.
- Added a lazy Google provider placeholder that falls back to the static surface.
- Added `loadGoogleMapProviderModule()` as the future dynamic import seam.
- Added pure provider config and adapter helpers.
- Routed `RoutePanel` through `MapPanel` while preserving existing marker/focus behavior.
- Added source-level tests for provider config, adapter input, and no Google SDK/package/env coupling.

Not implemented:

- Google Maps SDK.
- Google Maps package.
- API key or Vite env var.
- Leaflet / MapLibre / MapTiler / Stadia package.
- Real map rendering.
- Route calculation.
- Route cache.
- Migration or schema change.
- RPC, reorder, drag, presence, or remote selection changes.
- Push.

---

## Provider Architecture Proposal

Current boundary:

```text
Timeline day items
  -> buildRoutePanelStops()
  -> getFocusedMapState()
  -> MapPanel
  -> MapProviderAdapter input
  -> StaticMapProvider
```

Prepared future boundary:

```text
MapPanel
  -> StaticMapProvider
  -> GoogleMapProvider.lazy
  -> future provider adapter implementations
```

Files added:

```text
src/components/map/MapPanel.jsx
src/components/map/providers/StaticMapProvider.jsx
src/components/map/providers/GoogleMapProvider.lazy.jsx
src/lib/mapProviderAdapter.js
src/lib/mapProviderConfig.js
tests/mapProviderPrep.spec.js
```

`MapPanel` remains provider-neutral. It receives:

- `markers`
- `focusedMapState`
- `onFocusItem`
- `providerId`
- `enableRealMap`

The default provider is still static. `RoutePanel` now uses `MapPanel`, but visible output remains the existing `.route-map` / `.route-stop` surface.

---

## Lazy Load Rule

Google Maps SDK must only load after a future explicit provider switch and only from the map surface boundary.

Rules:

- Do not top-level import Google Maps SDK from `App.jsx`.
- Do not add a Google Maps package in Phase 4.9c.
- Do not add `VITE_GOOGLE_MAPS_API_KEY` in Phase 4.9c.
- Do not include Google SDK code in the initial/main bundle.
- Future Google provider work must use dynamic loading behind `GoogleMapProvider.lazy`.
- Current dynamic import seam is `loadGoogleMapProviderModule()`.
- If Google SDK loading fails, fall back to `StaticMapProvider`.

Current config helper:

```js
getMapProviderConfig({ providerId, enableRealMap })
```

Default result:

```text
providerId: static
loadMode: eager
canLoadRealMap: false
fallbackProviderId: static
```

Google result remains lazy-only until future approval:

```text
providerId: google
loadMode: lazy
canLoadRealMap: false unless explicitly enabled
fallbackProviderId: static
```

---

## Provider-Neutral Contract

Timeline and RoutePanel must not depend on:

- `google.maps.Map`
- `google.maps.Marker`
- `google.maps.Polyline`
- Google SDK event objects
- provider package-specific marker objects

Provider input should stay based on:

- markers from `buildDayMapMarkers()` / `buildRoutePanelStops()`
- `focusedItemId`
- `focusedMapState`
- transport endpoint marker ids
- `onFocusItem`

Adapter input helper:

```js
buildMapProviderAdapterInput({ markers, focusedMapState, onFocusItem })
```

It returns plain data:

- `markers`
- `focusedMarkerId`
- `focusedItemId`
- `focusedItemType`
- `transportEndpointMarkerIds`
- `onMarkerFocus`

No React, DOM, Google SDK, route calculation, sorting, or mutation is included in the adapter helper.

---

## Future Data Model Proposal Only

No migration was added.

If the product stays Google-first but provider-switchable, prefer neutral fields over Google-only names:

```text
place_provider
provider_place_id
route_provider
route_geometry_format
route_geometry
route_distance_meters
route_duration_seconds
route_updated_at
```

Avoid starting with:

```text
google_place_id
google_polyline
```

Migration guidance:

- Do not edit applied migrations 019 through 024.
- Any future map schema/RPC/permission work must use migration 025+.
- Route cache should remain a product decision, not a Phase 4.9c side effect.

---

## Google API / Env / Billing Checklist

Before any real Google Maps MVP:

- Choose or create Google Cloud project.
- Confirm Maps JavaScript API requirement.
- Decide whether Places API is needed.
- Decide whether Routes / Directions API is needed.
- Decide Vite env name, likely `VITE_GOOGLE_MAPS_API_KEY`, but do not add it until approved.
- Restrict API key by HTTP referrer.
- Add local dev referrers.
- Add Vercel preview referrers.
- Add production domain referrers.
- Enable billing account.
- Add budget alert.
- Add quota limits.
- Define SDK failure fallback to static route surface.
- Review privacy implications of sending trip places to Google.

---

## Bundle Size Guard

Known build baseline from Phase 4.9b:

```text
JS chunk: about 753.9 KB raw / 204.4 KB gzip
CSS chunk: about 70.6 KB raw / 12.8 KB gzip
src/App.jsx: about 592 KB
Vite large-chunk warning already exists
```

Phase 4.9c guard:

- Do not add a Google package.
- Do not add any map SDK package.
- Do not import Google SDK from `App.jsx`.
- If a future provider package is added, add bundle analysis.
- Real map SDK must stay out of the initial/main bundle.

---

## Protected Scope

Preserved:

- No Google Maps SDK.
- No map package.
- No API key or env var.
- No migration.
- No Supabase schema change.
- No RPC change.
- No Timeline reorder change.
- No dnd-kit sortable change.
- No drag handle change.
- No local DragOverlay change.
- No foreign drag presence change.
- No remote drag source / insertion line change.
- No remote selection behavior change.
- No online member presence change.
- No trip/day presence channel change.
- No fixed-anchor planner change.
- No untimed rebase change.
- No transport role model change.
- No route calculation.
- No route cache.
- No layout redesign.

---

## Verification

Checks run:

```text
npx.cmd playwright test tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js passed 12/12
npm.cmd run build passed with existing Vite large-chunk warning
git diff --check passed with Windows LF/CRLF notice only
rg source scan for google.maps / VITE_GOOGLE_MAPS_API_KEY / map packages in src and package.json returned no matches
```

Manual user verification is still pending.

---

## Recommended Next Step

Either:

- `Goal 4.9d Google Map MVP` if the provider boundary is accepted and the user approves SDK/API/env decisions; or
- `Phase 4.9 closeout / commit / push` if the team wants to freeze the prep artifacts before implementing a real map.

For 4.9d, start with:

- explicit provider switch plan;
- API key/referrer/billing confirmation;
- SDK lazy loading implementation;
- static fallback verification;
- no route calculation unless separately approved.
