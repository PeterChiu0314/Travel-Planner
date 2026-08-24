# Timeline Phase 5.1c Formal Google Map Markers Handoff

Date: 2026-07-02
Branch: `codex/timeline-phase-5`
Status: Implemented locally / Formal markers-only Google provider / no API key / no route APIs / no migration / no commit / no push

---

## Summary

Phase 5.1c implements the Formal Google Map markers-only provider behind the Phase 5.1b lazy loader path.

Implemented:

- `GoogleMapProvider.lazy.jsx` now instantiates a basic `google.maps.Map` after loader success.
- It renders Google markers only for provider-neutral markers with `hasCoordinates === true`.
- Marker click calls `onFocusItem(marker.itemId)`.
- Focused Timeline destination pans the Google map to the matching marker and raises its `zIndex`.
- Day/marker changes clean up old Google markers and create the current active-day marker set.
- Missing key, loader failure, render failure, no coordinate-bearing markers, and loading state all fall back to `StaticMapProvider`.
- Demo remains hard-locked to `StaticMapProvider`.

Not implemented:

- API key or env file.
- Places, Geocoding, Directions, Routes, route calculation, route polyline, route cache.
- Marker clustering, marker drag, custom icons, or AdvancedMarkerElement.
- Transportation route segment rendering.
- Timeline reorder, dnd-kit, presence, remote selection, online presence, transport role, Budget, Supabase schema/RPC/RLS, or migration changes.

---

## Provider Behavior

Formal route:

```text
provider static -> StaticMapProvider
provider google + API key + loader success + coordinate markers -> GoogleMapProvider
provider google + missing key -> StaticMapProvider
provider google + loader failure -> StaticMapProvider
provider google + render failure -> StaticMapProvider
provider google + no coordinate-bearing active-day markers -> StaticMapProvider
```

Demo route:

```text
mode demo -> StaticMapProvider
```

Demo still does not import/invoke the Google provider, instantiate Google Maps, render Google markers, or consume Google API quota.

---

## Google Marker Scope

Google provider uses the Phase 4.9 marker contract:

- `marker.itemId`
- `marker.title`
- `marker.locationName`
- `marker.latitude`
- `marker.longitude`
- `marker.hasCoordinates`

Rules:

- Only `hasCoordinates === true` markers create Google markers.
- Transportation cards never create markers because they are excluded by the marker helper.
- Missing-coordinate destinations stay out of Google marker rendering.
- Marker click is local focus only and calls `onFocusItem(marker.itemId)`.
- No database writes, Timeline order changes, day changes, or route calculations happen from marker click.

---

## Map Camera

Initial camera behavior:

- One marker: center on the marker and use zoom 14.
- Multiple markers: fit bounds to active-day coordinate-bearing markers.
- Focused marker: pan to the marker and raise marker `zIndex`.

No camera animation, persisted viewport, cross-day viewport memory, or custom route geometry was added.

---

## Verification

Commands run:

```text
npx.cmd playwright test tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js
passed 18/18

npm.cmd run build
passed with existing Vite large-chunk warning

git diff --check
passed with Windows LF/CRLF notices only
```

Build output:

```text
GoogleMapProvider.lazy chunk: 2.89 KB raw / 1.46 KB gzip
main JS: 766.55 KB raw / 212.39 KB gzip
CSS: 73.57 KB raw / 13.34 KB gzip
```

Source scan:

```text
rg "Directions|Routes|Places|Geocoding|leaflet|maplibre|maptiler|stadiamaps|@react-google-maps" src package.json package-lock.json
```

Result:

- No matches.

Manual browser verification with a real local Google Maps API key is still pending.

---

## Next Step

Recommended next step is manual Formal QA with a local uncommitted `.env.local`:

```text
VITE_MAP_PROVIDER=google
VITE_GOOGLE_MAPS_API_KEY=your_local_key
```

Keep `.env.local` uncommitted.

After manual QA, the next product phase can decide between marker polish, scroll sync, missing-coordinate UX, or route summary work. Do not add Places, Geocoding, Directions, Routes, route cache, migration, transportation repair, or Timeline reorder changes without a separate approved goal.
