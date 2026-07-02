# Timeline Phase 5.1e Google Map Layout Fill Fix Handoff

Date: 2026-07-02
Branch: `codex/timeline-phase-5`
Status: Implemented / Formal Google map fills RoutePanel map surface / no loader or provider-selection changes / no marker changes / no migration

---

## Summary

Phase 5.1e fixes the Formal Google map layout after the loader began working in Preview.

The observed issue was that `GoogleMapProvider` rendered only as a shallow strip near the top of the right-side RoutePanel while the original static grid background remained visible below it.

The corrected behavior:

```text
Formal Google provider -> Google map surface fills the right-side map area
empty/no-coordinate day -> Google base map fills the area + overlay hint
coordinate-bearing day -> Google marker map fills the area
Demo route -> unchanged StaticMapProvider layout
Static fallback -> unchanged StaticMapProvider layout
```

---

## Implementation

Updated:

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
- Formal Timeline workbench explicitly keeps `.google-map-surface` at full available height:

```text
.timeline-workbench .google-map-surface {
  height: 100%;
  min-height: 0;
}
```

- Added a layout regression test to keep the Google map canvas fill behavior and hint overlay behavior in place.

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
passed 17/17

npm.cmd run build
passed with existing Vite large-chunk warning

git diff --check
passed with Windows LF/CRLF notices only
```

Build output:

```text
GoogleMapProvider.lazy chunk: 6.25 KB raw / 2.85 KB gzip
main JS: 767.50 KB raw / 212.67 KB gzip
CSS: 74.07 KB raw / 13.44 KB gzip
```

Manual Preview verification is still recommended:

- Formal Google empty/no-coordinate day should fill the right-side map region.
- Formal Google coordinate-marker day should fill the right-side map region.
- Empty hint should appear as an overlay, not as layout content.
- Demo should remain static-only.
- `?debugMap=1` diagnostics should still work.
- Network should still show `maps.googleapis` when Formal Google provider is enabled with a key.

---

## Next Step

Deploy the branch Preview and verify the right-side Formal Google map fills the RoutePanel map area for both empty/no-coordinate days and coordinate-marker days.
