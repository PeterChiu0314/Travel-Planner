# Timeline Phase 5.1e Google Map Layout Fill Fix Handoff

Date: 2026-07-02
Branch: `codex/timeline-phase-5`
Status: Implemented / Formal Google map fills RoutePanel map surface / user-adjusted map viewport is preserved / no loader or provider-selection changes / no route APIs / no migration

---

## Summary

Phase 5.1e fixes the Formal Google map layout after the loader began working in Preview.

The observed issue was that `GoogleMapProvider` rendered only as a shallow strip near the top of the right-side RoutePanel while the original static grid background remained visible below it.

Follow-up manual testing confirmed the map fills the panel. A later viewport fix also prevents the map from snapping back to the default Kyoto viewport after the user manually pans or zooms the map.

The corrected behavior:

```text
Formal Google provider -> Google map surface fills the right-side map area
empty/no-coordinate day -> Google base map fills the area + overlay hint
coordinate-bearing day -> Google marker map fills the area
user pans/zooms map -> viewport is preserved during same-day rerenders
day tab or marker-set change -> automatic map positioning is allowed again
Demo route -> unchanged StaticMapProvider layout
Static fallback -> unchanged StaticMapProvider layout
```

---

## Implementation

Updated:

- `src/App.jsx`
- `src/components/map/MapPanel.jsx`
- `src/components/map/providers/GoogleMapProvider.lazy.jsx`
- `src/styles.css`
- `tests/mapProviderPrep.spec.js`

Changes:

- `.google-map-surface` now behaves as a full map surface with stable minimum height and isolated stacking context.
- `.google-map-canvas` now fills the surface with:

```text
position: absolute
inset: 0
width: 100%
height: 100%
min-height: 100%
```

- `.google-map-empty-hint` remains an absolute overlay above the map and no longer participates in sizing.
- Formal Timeline workbench fills the RoutePanel map area with a direct route-panel child selector:

```text
.timeline-workbench .side-panels > .route-panel > .google-map-surface {
  position: absolute;
  inset: 0;
  width: 100%;
  min-height: 0;
}
```

- Google Maps internal `.gm-style` / child canvas wrapper is forced to `width: 100%` and `height: 100%` so the actual Google map, not only the provider wrapper, fills the panel.
- `RoutePanel` now passes a `viewportKey` through `MapPanel` to `GoogleMapProvider`.
- Formal `viewportKey` is keyed to `activeDay`, so changing day tabs allows automatic map positioning again.
- `GoogleMapProvider` listens for user viewport changes (`dragstart`, `zoom_changed`, `heading_changed`, `tilt_changed`).
- Once the user pans or zooms, same-day rerenders no longer call the automatic `setCenter`, `setZoom`, or `fitBounds` path.
- Programmatic map movements are briefly suppressed so app-driven `panTo` / `fitBounds` / `setZoom` are not mistaken for user movement.
- Added regression tests for both panel fill behavior and user-adjusted viewport preservation.

---

## Preserved Boundaries

No changes were made to:

- Google loader behavior.
- API keys or env files.
- Provider selection.
- Map marker creation, marker focus, marker click behavior, or coordinate filtering.
- Demo static-only behavior.
- Static fallback route-stop layout.
- Places, Geocoding, Directions, Routes, route calculation, or route cache.
- Timeline reorder, drag/drop, collaborative presence, remote selection, online presence, Budget integration, Supabase schema, RPC, RLS, or migrations.

---

## Verification

Commands run:

```text
npx.cmd playwright test tests/mapProviderPrep.spec.js
passed 18/18

npm.cmd run build
passed with existing Vite large-chunk warning

git diff --check
passed with Windows LF/CRLF notices only
```

Build output:

```text
GoogleMapProvider.lazy chunk: 7.04 KB raw / 3.11 KB gzip
main JS: 767.62 KB raw / 212.72 KB gzip
CSS: 74.25 KB raw / 13.47 KB gzip
```

Manual Preview verification is still recommended:

- Formal Google empty/no-coordinate day should fill the right-side map region.
- Formal Google coordinate-marker day should fill the right-side map region.
- Empty hint should appear as an overlay, not as layout content.
- After the user pans or zooms the map, same-day background rerenders should not snap the viewport back to Kyoto.
- Switching day tabs should still allow the map to auto-position for the newly selected day.
- Demo should remain static-only.
- `?debugMap=1` diagnostics should still work.
- Network should still show `maps.googleapis` when Formal Google provider is enabled with a key.

---

## Next Step

Deploy the branch Preview and verify the right-side Formal Google map fills the RoutePanel map area for both empty/no-coordinate days and coordinate-marker days, then pan/zoom the map and confirm it no longer snaps back to Kyoto during same-day rerenders.
