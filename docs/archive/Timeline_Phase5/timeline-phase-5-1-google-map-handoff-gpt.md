# Timeline Phase 5.1 Google Map MVP Handoff

Date: 2026-07-02  
Project: Travel Planner / 旅程規劃室  
Branch context: `codex/timeline-phase-5`  
Status: Phase 5.1 Google Map MVP completed through layout fill fix / Google Map loads successfully / ready for Phase 5.1 closeout or Phase 5.2

---

## 1. Current Status Summary

Phase 5.1 has been completed through several substeps:

```text
5.1a：Demo static map safety + mock coordinates ✅
5.1b：Formal Google Maps loader integration ✅
5.1c：Formal Google Map markers-only ✅
5.1d：Formal empty/no-coordinate Google base map ✅
5.1d follow-ups：provider diagnostics / loader diagnostics / loader API fix ✅
5.1e：Google Map Layout Fill Fix ✅
```

Formal Timeline can now enter the Google Map provider path when:

```text
mode = formal
VITE_MAP_PROVIDER = google
VITE_GOOGLE_MAPS_API_KEY exists
Google Maps loader succeeds
```

Latest confirmed browser diagnostics show:

```text
[MapPanel] provider diagnostics:
mode: "formal"
requestedProvider: "google"
resolvedProvider: "google"
hasGoogleMapsKey: true
shouldUseGoogleProvider: true
fallbackReason: null

[GoogleMapProvider] diagnostics:
hasApiKey: true
loadAttempted: true
loadSucceeded: true
mapCreated: true
fallbackReason: null
```

This confirms Google Map is now successfully loaded and instantiated.

---

## 2. Important Product Rule Established

The product rule was clarified during Phase 5.1d:

```text
Coordinates determine markers.
Coordinates do NOT determine whether Google Map is shown.
```

Final desired behavior:

```text
Formal + provider google + key + loader success
→ Always show Google Map base map

Has coordinate-bearing destination markers
→ Show markers

No items / no stops / no coordinate markers
→ Still show Google Map base map
→ Show low-key empty hint
```

Current empty hint:

```text
This day has no coordinate markers yet
```

Coordinates / missing coordinate input flow is NOT part of Phase 5.1.  
That should be handled later in Phase 5.3.

---

## 3. Completed Subphase Details

## Phase 5.1a：Static Demo Map Safety + Demo Mock Coordinates

Completed:

- Demo route explicitly uses `mode="demo"`.
- Demo provider config forcibly resolves to `static`.
- Demo never enters Google provider path.
- Demo never loads Google SDK.
- Demo never consumes Google Maps quota.
- `StaticMapProvider` can render static coordinate markers using mock coordinates.
- `src/demo-kyoto-trip.json` was given 16 numeric mock coordinates for Day 0–2.
- Demo static marker / route-stop behavior remains available.

Key rule:

```text
Demo route:
always -> StaticMapProvider
never  -> GoogleMapProvider
never  -> Google Maps SDK
never  -> Google API quota
```

---

## Phase 5.1b：Formal Google Map Loader Integration

Completed:

- Installed approved package only:

```text
@googlemaps/js-api-loader
```

- Added `src/lib/googleMapsLoader.js`.
- `MapPanel` reads:
  - `VITE_MAP_PROVIDER`
  - `VITE_GOOGLE_MAPS_API_KEY`
- Formal mode can enter Google lazy provider path.
- Demo mode remains static-only.
- Missing key / loader failure falls back to `StaticMapProvider`.
- No API key was committed.
- No `.env` / `.env.local` was committed.
- No real map instantiate yet at this stage.
- No marker rendering yet at this stage.

Original loader approach was later fixed in 5.1d follow-up; see Section 5 below.

---

## Phase 5.1c：Formal Google Map Markers Only

Completed:

- `GoogleMapProvider.lazy.jsx` can instantiate basic `google.maps.Map`.
- Only destination markers with `hasCoordinates === true` are rendered.
- Transportation cards do not become markers.
- Marker click calls:

```js
onFocusItem(marker.itemId)
```

- Timeline destination focus pans to marker and raises marker `zIndex`.
- Day / marker set changes clear old markers and rebuild marker set.
- Missing key / loader failure / render failure falls back static.
- Demo remains static-only.

Important limitation:

- At first, `no coordinates` still caused fallback static. This was later changed in Phase 5.1d.

---

## Phase 5.1d：Formal Google Map Empty State Fix

Completed product correction:

- Formal Google provider now should show Google base map even when:
  - active day is empty
  - active day has no route stops
  - active day has no items
  - active day has no coordinate-bearing markers
- `no coordinates` means “no markers”, not “no Google Map”.
- Added low-key empty hint:

```text
This day has no coordinate markers yet
```

---

## 4. Debug / Diagnostics Added

Added gated diagnostics that only run when the URL query includes:

```text
?debugMap=1
```

### MapPanel diagnostics

Added through `src/lib/mapProviderDiagnostics.js` and `MapPanel`.

Console label:

```text
[MapPanel] provider diagnostics
```

Fields:

```text
mode
requestedProvider
resolvedProvider
hasGoogleMapsKey
shouldUseGoogleProvider
fallbackReason
```

No API key is printed.

### GoogleMapProvider diagnostics

Console label:

```text
[GoogleMapProvider] diagnostics
```

Fields:

```text
hasApiKey
totalMarkers
coordinateMarkers
containerReady
loadAttempted
loadSucceeded
mapCreated
fallbackReason
```

No API key is printed.

### GoogleMapsLoader diagnostics

Console label:

```text
[GoogleMapsLoader] diagnostics
```

Includes safe loader error metadata when `debugMap=1`, with API key redacted.

---

## 5. Critical Bug Found and Fixed

### Root Cause

Google Map still did not load even after MapPanel diagnostics showed:

```text
mode: "formal"
requestedProvider: "google"
resolvedProvider: "google"
hasGoogleMapsKey: true
shouldUseGoogleProvider: true
fallbackReason: null
```

Network showed `GoogleMapProvider.lazy-*.js` loaded, but no `maps.googleapis.com` request.

Two internal issues were found:

### Issue 1：Provider canvas was never mounted

In `GoogleMapProvider.lazy.jsx`, when `status !== "ready"`, the provider rendered `StaticMapProvider`.

This meant:

```text
Google provider imported
→ status not ready
→ StaticMapProvider rendered
→ .google-map-canvas never appears
→ container ref never becomes ready
→ loader is never called
```

Fix:

- Formal Google provider now renders its own `.google-map-canvas` immediately after mount.
- Once `apiKey exists + containerReady`, it calls `loadGoogleMapsApi({ apiKey })`.
- Loader success creates:

```js
new google.maps.Map(...)
```

- Coordinate markers are optional.

### Issue 2：Wrong API loader usage for `@googlemaps/js-api-loader@2.1.1`

The old usage:

```js
new Loader(...)
```

was deprecated / non-functional for the installed loader version and threw before any request was sent.

Fix:

```js
setOptions({ key, v: "weekly" })
await importLibrary("maps")
```

After this fix, Google Maps loader succeeded.

### Service Worker Fix

`public/sw.js` was updated so these domains are network-only and not cached/intercepted:

```text
maps.googleapis.com
maps.gstatic.com
```

This avoids service worker interference with Google Maps external resources.

---

## 6. Current Confirmed Browser State

Latest browser screenshot / console shows Google Map successfully rendered in Formal Timeline.

Current visible behavior:

- Right panel shows real Google base map.
- Empty/no-coordinate day shows low-key hint:

```text
This day has no coordinate markers yet
```

- Console diagnostics show:

```text
loadAttempted: true
loadSucceeded: true
mapCreated: true
fallbackReason: null
```

This confirms Google Maps API is working.

Current UI status:

- Google Map base map is confirmed to load.
- Phase 5.1e layout fill fix has been completed and tested OK.
- Google map now fills the intended right-side map surface instead of appearing only as a shallow top band.
- The old static grid should no longer leak below the Google map in Formal Google provider mode.
- Empty/no-coordinate hint remains an overlay and should not compress the map canvas.
- Demo still uses StaticMapProvider and should keep its existing static layout.

---

## 7. Phase 5.1e：Google Map Layout Fill Fix

Completed after the first Google Map browser confirmation.

Problem fixed:

```text
Google Map loaded successfully, but the map canvas only occupied a shallow horizontal band near the top of the right panel.
The old static grid background leaked below it.
```

Expected fixed behavior:

```text
Formal GoogleMapProvider fills the right-side RoutePanel / MapPanel map surface.
Empty hint is overlaid on top of the map instead of changing map height.
No static grid leaks below the Google map.
Demo StaticMapProvider layout remains unchanged.
```

Important implementation constraint:

```text
Layout fixes must not unmount/remount GoogleMapProvider during normal Timeline interactions.
Keep the existing mapRef guard so google.maps.Map is created once per provider mount.
```

Relevant map-load behavior confirmed with Codex:

```text
Does not recreate map while component remains mounted:
- Day switch
- itinerary stops add/delete/edit
- marker coordinate set changes
- focus card / focus marker
- route panel open/close
- Timeline reorder / card state updates

Can recreate map:
- page refresh
- leaving current trip/editor so Formal Timeline unmounts
- route/page switch that remounts App or TripEditor
- provider config changes in a new build/session
- fatal Google provider fallback then re-entering Google path
- React dev StrictMode in local dev may mount/unmount effects twice; production build usually does not
```

---

## 8. Google Maps Key / Env Notes

User currently used Maps Demo Key for testing.

Important:

- Maps Demo Key can be used for prototype/testing.
- It does not appear to support HTTP referrer restriction like standard Cloud API keys.
- It is not intended for production.
- For production or broader testing, use standard Maps JavaScript API key with:
  - HTTP referrer restriction
  - API restriction: Maps JavaScript API
  - quota limit
  - budget alert

Env variables:

```env
VITE_MAP_PROVIDER=google
VITE_GOOGLE_MAPS_API_KEY=<maps demo key or formal key>
```

Vite env reminder:

- Variables need `VITE_` prefix to be exposed to frontend bundle.
- Vercel env changes require redeploy.
- Preview deployment needs env available for Preview.
- Production deployment needs env available for Production.

---

## 9. API Usage / Billing Reminder

Reloading a page that creates a new Google Map instance likely counts as a map load / billable event or Demo Key usage event.

Current understanding:

```text
Full page reload
→ React app reloads
→ GoogleMapProvider mounts
→ new google.maps.Map(...)
→ likely counts as one map load
```

Usually not a new map load:

```text
Same page Day switch
pan / zoom
marker update
Timeline card focus
```

For development:

- Avoid unnecessary refresh loops.
- Use `VITE_MAP_PROVIDER=static` when not testing Google Map.
- Keep Demo route static-only.
- Do not put Demo Key in production.

---

## 10. Do Not Regress These Rules

Keep these protected:

```text
Demo:
always StaticMapProvider
never GoogleMapProvider
never Google Maps SDK
never Google API quota
```

```text
Formal:
provider static -> StaticMapProvider
provider google + missing key -> StaticMapProvider
provider google + loader failure -> StaticMapProvider
provider google + loader success -> GoogleMapProvider base map
```

Coordinates:

```text
coordinates affect marker rendering only
coordinates do not decide whether Google Map base map is shown
```

Forbidden for the next small fix:

- Do not add Places.
- Do not add Geocoding.
- Do not add Directions / Routes.
- Do not add route calculation.
- Do not add route cache.
- Do not add marker drag.
- Do not add new package.
- Do not add migration.
- Do not modify Timeline reorder / drag / presence.
- Do not modify transportation repair logic.
- Do not update Budget flow.

---

## 11. Files Touched Recently

Recent relevant files:

```text
src/components/map/MapPanel.jsx
src/components/map/providers/GoogleMapProvider.lazy.jsx
src/components/map/providers/StaticMapProvider.jsx
src/lib/googleMapsLoader.js
src/lib/mapProviderConfig.js
src/lib/mapProviderAdapter.js
src/lib/mapProviderDiagnostics.js
public/sw.js
tests/mapProviderPrep.spec.js
src/demo-kyoto-trip.json
src/styles.css
```

`test-results/` may appear as untracked local Playwright output.  
Do not include it in commits unless explicitly needed.

---

## 12. Validation History

Recent validation commands that passed:

```text
npx playwright test tests/mapProviderPrep.spec.js
npm run build
git diff --check
```

Earlier full map tests also passed:

```text
npx.cmd playwright test tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js
npm.cmd run build
git diff --check
```

Phase 5.1e Google Map Layout Fill Fix was reported as fixed and tested OK.

The build still has the existing Vite large-chunk warning. It is not a Phase 5.1 regression.

---

## 13. Recommended Next Step

Phase 5.1 is now ready for closeout as:

```text
Phase 5.1 Google Map MVP:
- Demo static-safe
- Formal Google loader
- Formal Google base map
- Formal destination markers when coordinates exist
- Empty/no-coordinate Formal days still show Google base map
- Google map layout fills the right-side map surface
```

Recommended next order:

```text
5.1 closeout / commit / merge as needed
→ 5.2 Marker → Timeline Scroll Sync
→ 5.3 Location Data Input / Missing Coordinates Flow
```

Phase 5.2 should focus on:

```text
marker click
→ focus Timeline card
→ scroll destination card into view
→ if needed, switch to the correct Day first
→ avoid forced scroll during drag/edit/foreign-drag readonly states
```

Phase 5.3 should handle how users add / repair coordinates:

```text
missing coordinate indicator
manual latitude / longitude input
optional Google Maps URL parsing
do not add Geocoding API until separately approved
```
