# Timeline Phase 5.6 Places Search / Preview / POI Flow Closeout

Date: 2026-07-05
Branch: `codex/timeline-phase-5-5`

## Status

Phase 5.6 is complete and manually verified OK through Phase 5.6g. Phase 5.6g added Formal Google Places Autocomplete viewport `locationBias` without adding strict bounds, new APIs, migrations, packages, or Place Details fields.

Latest pushed commit:

```text
0b7fe16 Add places autocomplete viewport bias
```

Related commits:

```text
42ad978 Prepare timeline phase 5.6a places gating
c288687 Add timeline phase 5.6b places autocomplete
7818914 Hide route heading behind places search
8297513 Add timeline phase 5.6c place details flow
69f4456 Fix place details Google Maps URI field
812fd62 Use coordinate map URLs for place details editor
e0c99a7 Add places search result map preview
f49122f Anchor places preview dialog to map marker
ce0a172 Polish places preview dialog styling
a40b029 Add places POI click preview confirm
ccb454d Replace POI mini confirm with pending marker
c4c5926 Add pending POI marker hint
2de7dbf Polish pending POI hint placement
96c69ed Improve places search input UX guards
24f019d Polish places search box styling
c373108 Tune places search debounce and radius
23ff2dc Adjust places preview search clearing
5a7016a Use primary text for selected place input
0b7fe16 Add places autocomplete viewport bias
```

## What Changed

- Added Places Library gating for the Formal Google map provider only.
- Places remains disabled unless the Formal Google provider is active, an API key exists, the Places library is ready, and `VITE_GOOGLE_MAPS_PLACES_ENABLED=true`.
- Added a provider-local Places Autocomplete search box in the Formal Google map overlay.
- Autocomplete requests are cost-guarded:
  - debounce is now 700ms
  - input shorter than 2 characters is skipped
  - IME composition is guarded
  - Enter and search icon trigger immediate search only when not composing
  - same-query guard prevents duplicate Autocomplete requests
  - session token is reused until the search/details flow resets it
- Selected autocomplete suggestions fetch Place Details with the minimal field mask only:
  - `id`
  - `displayName`
  - `location`
  - `googleMapsUri`
- Selected autocomplete suggestions now show a marker-anchored full preview dialog before opening the add editor.
- Successful details selection keeps the search input visible with the primary place name:
  - `details.displayName`
  - fallback `prediction.mainText`
  - fallback original search text
- The full suggestion/address string is not kept in the input after successful details preview.
- Suggestion list closes after successful details preview.
- Clicking "Add to itinerary" opens the active day destination add editor and then clears the search input, suggestion list, and preview.
- Cancelling the full preview clears the search input, suggestion list, and preview without opening an editor or writing to the database.
- Details failure or missing usable coordinates keeps the user's original input so they can adjust the query.
- Editor `map_url` is always the coordinate URL: `https://www.google.com/maps?q={lat},{lng}`.
- The `googleMapsUri` / `googleMapsURI` value may still be normalized internally, but it is not written into the editor `map_url`.
- Save remains the only database write.
- Added a Google map POI click flow:
  - POI click does not call Place Details.
  - POI click creates a provider-local pending marker and hint label only.
  - Clicking the pending marker or hint calls Place Details.
  - Same `placeId` uses provider-local cache instead of refetching details.
  - Successful details replaces the pending marker with the full preview dialog.
- The old mini POI confirm dialog was removed.
- Preview dialog is marker-anchored through provider-local Google map projection behavior rather than fixed to the map corner.
- Preview marker / pending marker / pending hint are provider-local only.
- Demo / StaticMapProvider remains static-only and does not render Places search UI or call Places.
- Phase 5.6g adds optional viewport bias to Formal Google Places Autocomplete:
  - `GoogleMapProvider.lazy.jsx` reads `map.getBounds()` provider-locally.
  - Bounds are converted into a plain `{ north, east, south, west }` literal.
  - The latest bounds ref is refreshed from map `bounds_changed` / `idle` events.
  - Autocomplete requests include `locationBias` only when usable bounds exist.
  - Map pan/zoom alone does not trigger Autocomplete requests.
  - No `locationRestriction` or strict bounds behavior was added.

## Files Changed

```text
src/App.jsx
src/components/map/MapPanel.jsx
src/components/map/providers/GoogleMapProvider.lazy.jsx
src/components/map/providers/StaticMapProvider.jsx
src/lib/googleMapsLoader.js
src/lib/googlePlacesAdapter.js
src/lib/googlePlacesConfig.js
src/styles.css
tests/googlePlacesAutocomplete.spec.js
tests/googlePlacesConfig.spec.js
tests/mapProviderPrep.spec.js
tests/mapPoint.spec.js
tests/timelineMapFocus.spec.js
tests/timelineMapMarkers.spec.js
CURRENT_TASK.md
docs/2026-07-05-phase-5-6-places-closeout-handoff.md
```

## Verification

Key automated checks run during Phase 5.6:

```text
npx.cmd playwright test tests/googlePlacesAutocomplete.spec.js tests/googlePlacesConfig.spec.js tests/mapProviderPrep.spec.js
passed 45/45 after Phase 5.6f hotfix 2

npx.cmd playwright test tests/mapPoint.spec.js tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js tests/googlePlacesConfig.spec.js tests/googlePlacesAutocomplete.spec.js
passed 73/73 during Phase 5.6e / 5.6f regression checks

npx.cmd playwright test tests/phase-4-2c-reorder.spec.js
passed 33/33 during Phase 5.6d / 5.6e / 5.6f regression checks

npm.cmd run build
passed with existing Vite large-chunk warning

git diff --check
passed with Windows LF/CRLF notices only

git diff --cached --check
passed before pushed commits
```

Final Phase 5.6f hotfix 2 checks:

```text
npx.cmd playwright test tests/googlePlacesAutocomplete.spec.js
passed 8/8

npx.cmd playwright test tests/googlePlacesAutocomplete.spec.js tests/googlePlacesConfig.spec.js tests/mapProviderPrep.spec.js
passed 45/45

npm.cmd run build
passed with existing Vite large-chunk warning

git diff --check
passed with Windows LF/CRLF notices only

git diff --cached --check
passed
```

Manual QA:

```text
Phase 5.6f hotfix manual test passed.
Phase 5.6g viewport location bias manual test passed.
Search input clear timing passed.
Selected suggestion input display uses primary place name after successful details preview.
Suggestion list closes after successful details preview.
Add to itinerary clears search input and opens the existing add editor.
Preview cancel clears search input without opening an editor.
Details failure keeps the user's original input.
POI pending marker flow remained OK.
Autocomplete suggestions now follow the current Google map viewport bias without strict bounds.
```

Phase 5.6g focused check before full regression:

```text
npx.cmd playwright test tests/googlePlacesAutocomplete.spec.js
passed 9/9

npx.cmd playwright test tests/googlePlacesAutocomplete.spec.js tests/googlePlacesConfig.spec.js tests/mapProviderPrep.spec.js
passed 46/46

npx.cmd playwright test tests/mapPoint.spec.js tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js tests/googlePlacesConfig.spec.js tests/googlePlacesAutocomplete.spec.js
passed 74/74

npx.cmd playwright test tests/phase-4-2c-reorder.spec.js
passed 33/33

npm.cmd run build
passed with existing Vite large-chunk warning

git diff --check
passed with Windows LF/CRLF notices only

git diff --cached --check
passed before commit
```

## Protected Scope

No changes were made to:

```text
Supabase schema/RPC/migration/RLS
API key/env committed files
new packages
Text Search
Nearby Search
Geocoding
Reverse Geocoding
Directions API
Routes API
Distance Matrix
route calculation
route cache
route summary
automatic transportation card creation
address auto-fill
formattedAddress
rating/reviews/photos/opening hours/phone/website/businessStatus/editorialSummary/generativeSummary
Place Details fields outside id/displayName/location/googleMapsUri
locationRestriction
strict bounds
marker drag
marker clustering
AdvancedMarkerElement migration
Timeline reorder
dnd-kit architecture
drag presence
remote selection
online presence
Budget integration
localStorage cache
Demo production data flow
```

## Notes For Next Agent

- Keep Places work Formal-Google-only unless a later phase explicitly redesigns Demo.
- Keep viewport influence as Autocomplete `locationBias` only unless a later phase explicitly approves `locationRestriction` / strict bounds.
- Keep Place Details field usage minimal. Do not add rich details fields without a cost review.
- Autocomplete and Details are intentionally separated:
  - Autocomplete suggestion click may fetch minimal Place Details.
  - POI click itself must not fetch Place Details.
  - POI pending marker / hint click may fetch Place Details.
- Keep editor `map_url` as `https://www.google.com/maps?q={lat},{lng}` so Phase 5.2 validation continues to pass.
- The full preview dialog is the confirmation boundary before opening the add editor.
- Save remains the only Supabase write.
- If future work changes input behavior, preserve IME composition guard, same-query guard, session token reuse/reset, and failure preserving the user's original query.
