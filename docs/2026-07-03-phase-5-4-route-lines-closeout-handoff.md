# Timeline Phase 5.4 Simple Route Lines + Destination Sequence Badge Closeout

Date: 2026-07-03
Branch: `codex/timeline-phase-5-2`

## Status

Phase 5.4 is complete. Manual QA is ALL PASS after route lines, Timeline sequence badge polish, and the transport-category destination marker / coordinate-save hotfixes.

Related commits:

```text
723308d Implement timeline phase 5.4 route lines
80bc987 Polish timeline destination sequence badge
350a713 Preserve validated timeline map coordinates on save
b1feb1c Fix transport-category destination map markers
684b162 Fix map point handling for transport-category destinations
```

## What Changed

- Formal Google map now draws simple same-day route lines between valid destination coordinates.
- Route lines are provider-local Google `Polyline` instances and do not use Directions API, Routes API, route calculation, or route cache.
- Destination marker labels now use the same destination sequence number as the Timeline.
- Timeline destination cards show a low-key sequence number at the card top-left.
- Transportation cards do not show destination sequence numbers.
- Sequence calculation remains destination-only and ignores transportation cards.
- Demo remains StaticMapProvider-only and does not load the Google Maps SDK.
- Manual QA feedback adjusted the Timeline sequence badge to plain text only:
  - card top-left
  - no border
  - no background
  - no extra shape
  - 12px low-key text
- Old-card Map URL save polish now keeps validated hidden `latitude` / `longitude` in the destination editor update payload, so saving a valid Map URL does not leave `map_url` written without coordinates.
- Transport-category destinations are no longer misclassified as transportation cards. A destination / visit with `item_type="visit"` and `type="transport"` remains a destination.
- Airports, stations, parking lots, rental-car points, ports, and other transportation-category destinations can save coordinates, show markers, participate in the simple route line, and keep destination sequence numbering.
- Only true transportation cards (`item_type === "transport"`) are excluded from marker output, route-line points, destination sequence badges, and missing-coordinate counts.
- `countMissingMapPoints()` now counts missing coordinates for transport-category destinations and still ignores true transportation cards.

## Files Changed

```text
src/App.jsx
src/components/map/providers/GoogleMapProvider.lazy.jsx
src/lib/mapPoint.js
src/lib/timelineMapMarkers.js
src/styles.css
tests/mapPoint.spec.js
tests/mapProviderPrep.spec.js
tests/timelineMapMarkers.spec.js
CURRENT_TASK.md
AGENT.md
docs/UX_RULES.md
docs/2026-07-03-phase-5-4-route-lines-closeout-handoff.md
```

## Verification

Automated checks run during Phase 5.4:

```text
npx.cmd playwright test tests/mapPoint.spec.js tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js
passed 58/58 after final transport-category hotfix

npx.cmd playwright test tests/phase-4-2c-reorder.spec.js
passed 33/33

npm.cmd run build
passed with existing Vite large-chunk warning

git diff --check
passed with Windows LF/CRLF notices only
```

Focused checks run for the old-card Map URL save polish:

```text
npx.cmd playwright test tests/mapProviderPrep.spec.js --grep "Phase 5.3 destination editor"
passed 2/2

npx.cmd playwright test tests/mapPoint.spec.js
passed 14/14

npm.cmd run build
passed with existing Vite large-chunk warning

git diff --check
passed with Windows LF/CRLF notices only
```

Manual QA:

```text
Timeline sequence badge top-left placement verified by user feedback
Plain-number sequence badge style adjusted to requested CSS
Old test data diagnosis found rows with map_url but null latitude/longitude
Map picker itself was not identified as broken
Destination editor save path now explicitly preserves validated coordinates for old cards
Transport-category destination marker regression reproduced and fixed
Transport-category destination coordinate-save regression reproduced and fixed
Manual QA: ALL PASS
Latest fix commit: 684b162
```

## Protected Scope

No changes were made to:

```text
Google Places Search
POI click/add flow
Geocoding
Reverse Geocoding
Directions API
Routes API
route calculation
route cache
marker drag
marker clustering
AdvancedMarkerElement
new packages
API key/env files
Supabase migration/schema/RPC/RLS
Timeline reorder
dnd-kit architecture
drag presence
remote selection
online presence
Budget flow
```

## Notes For Next Agent

- A marker still requires valid persisted `latitude` and `longitude`; `map_url` alone is not enough.
- If old test data has `map_url` but null coordinates, repair can be done narrowly per trip/day or by re-saving the card after this polish is deployed.
- Do not treat destination category/type `transport` as a transportation card. The durable transportation-card discriminator is `item_type === "transport"`.
- Destination / visit items with `type="transport"` should continue through normal map point parsing, coordinate persistence, marker output, route-line participation, and destination sequence numbering.
- Route lines are intentionally simple visual connectors only. They are not travel routes, transit paths, duration estimates, or cached directions.
- Keep Demo static unless explicitly redesigned.
- Treat Map-area add-point controls, search, Places, Geocoding, Directions, and route summaries as later-phase decisions.
