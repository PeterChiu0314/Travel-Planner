# Timeline Phase 5.4 Simple Route Lines + Destination Sequence Badge Closeout

Date: 2026-07-03
Branch: `codex/timeline-phase-5-2`

## Status

Phase 5.4 is complete, with one small follow-up polish for old destination card Map URL saves.

Related commits before this closeout:

```text
723308d Implement timeline phase 5.4 route lines
80bc987 Polish timeline destination sequence badge
350a713 Preserve validated timeline map coordinates on save
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

## Files Changed

```text
src/App.jsx
src/components/map/providers/GoogleMapProvider.lazy.jsx
src/lib/timelineMapMarkers.js
src/styles.css
tests/mapProviderPrep.spec.js
CURRENT_TASK.md
docs/2026-07-03-phase-5-4-route-lines-closeout-handoff.md
```

## Verification

Automated checks run during Phase 5.4:

```text
npx.cmd playwright test tests/mapPoint.spec.js tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js
passed 57/57

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
- Route lines are intentionally simple visual connectors only. They are not travel routes, transit paths, duration estimates, or cached directions.
- Keep Demo static unless explicitly redesigned.
- Treat Map-area add-point controls, search, Places, Geocoding, Directions, and route summaries as later-phase decisions.
