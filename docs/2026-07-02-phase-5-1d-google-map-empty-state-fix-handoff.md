# Timeline Phase 5.1d Google Map Empty State Fix Handoff

Date: 2026-07-02
Branch: `codex/timeline-phase-5`
Status: Implemented locally / Formal Google base map for empty and no-coordinate days / no API key / no route APIs / no migration / no commit / no push

---

## Summary

Phase 5.1d fixes the Phase 5.1c behavior where Formal Google provider fell back to `StaticMapProvider` whenever the active day had no coordinate-bearing markers.

The corrected behavior:

```text
Formal provider google + API key + loader success -> Google base map
coordinate-bearing destinations -> Google markers
empty day / no coordinate-bearing destinations -> Google base map + empty hint
missing key / loader failure / render fatal error -> StaticMapProvider fallback
Demo route -> always StaticMapProvider
```

---

## Implementation

Updated:

- `src/components/map/providers/GoogleMapProvider.lazy.jsx`
- `src/styles.css`
- `tests/mapProviderPrep.spec.js`

Changes:

- Removed `!coordinateMarkers.length` from the static fallback condition.
- Google provider now instantiates a base map after loader success even when there are no coordinate-bearing markers.
- Empty/no-coordinate days center on Kyoto:

```text
lat: 35.0116
lng: 135.7681
zoom: 11
```

- No-coordinate days render a small overlay hint:

```text
This day has no coordinate markers yet
```

- Existing marker behavior is preserved for coordinate-bearing destinations.
- Fatal render errors still fall back to `StaticMapProvider`.

---

## Preserved Boundaries

No changes were made to:

- Demo static-only behavior.
- API keys or env files.
- Packages.
- Places, Geocoding, Directions, Routes.
- Route calculation, route polyline, or route cache.
- Marker clustering, marker drag, or AdvancedMarkerElement.
- Supabase schema, RPC, RLS, or migrations.
- Timeline reorder, dnd-kit, DragOverlay, fixed anchor planner, untimed rebase, transport role model, collaborative presence, remote selection, online presence, or Budget integration.

---

## Verification

Commands run:

```text
npx.cmd playwright test tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js
passed 19/19

npm.cmd run build
passed with existing Vite large-chunk warning

git diff --check
passed with Windows LF/CRLF notices only
```

Build output:

```text
GoogleMapProvider.lazy chunk: 3.13 KB raw / 1.53 KB gzip
main JS: 766.48 KB raw / 212.36 KB gzip
CSS: 73.88 KB raw / 13.39 KB gzip
```

Source scan:

```text
rg "Directions|Routes|Places|Geocoding|leaflet|maplibre|maptiler|stadiamaps|@react-google-maps" src package.json package-lock.json
```

Result:

- No matches.

Manual Formal browser verification with a real local or Vercel API key is still pending.

---

## Next Step

Deploy this fix to the branch preview or merge it into `main` when ready.

For manual QA:

- Formal empty day should show Google base map plus the empty hint.
- Formal no-coordinate day should show Google base map plus the empty hint.
- Formal coordinate-bearing day should show Google markers.
- Demo should remain static-only.
