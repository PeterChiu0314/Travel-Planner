# Timeline Phase 5.2 → 5.3 Handoff

Date: 2026-07-02  
Project: Travel Planner / 旅程規劃室  
Branch: `codex/timeline-phase-5-2`  
Status: Phase 5.2 completed / pushed / Edge Function deployed / manual QA OK / ready for Phase 5.3 planning

---

## 1. Current Status Summary

Phase 5.2 is functionally complete and manually verified.

Final Phase 5.2 scope:

```text
Map URL → coordinate parsing → hidden latitude/longitude → Google/static markers
Invalid / empty Map URL → save blocked with inline field error
Cleared Map URL → coordinates cleared → marker removed
Google Maps short link → Edge Function resolver → expandedUrl → coordinate parsing
Marker click → focus / scroll to Timeline destination card
Map panel missing coordinate overlay
Demo remains StaticMapProvider only
```

Latest pushed commit:

```text
0262a7d Add Google Maps short link resolver
```

Earlier Phase 5.2b commit:

```text
f3d1de9 Require valid destination map URLs
```

Edge Function deployed and manually verified:

```text
resolve-google-maps-url
Supabase project: lqvuqamzmchepgxkftcw
```

Manual QA result:

```text
Phase 5.2 full flow tested OK.
```

---

## 2. Important Branch Note

The actual working branch is:

```text
codex/timeline-phase-5-2
```

Earlier prompt text sometimes referenced `codex/timeline-phase-5`, but implementation and push were done on:

```text
origin/codex/timeline-phase-5-2
```

---

## 3. Phase 5.2 Completed Features

### 3.1 Map URL point parsing

Added / updated:

```text
src/lib/mapPoint.js
```

Supported coordinate extraction patterns:

```text
!3dlat!4dlng
q=lat,lng
ll=lat,lng
@lat,lng
```

Final parser priority:

```text
1. !3dlat!4dlng
2. q=lat,lng
3. ll=lat,lng
4. @lat,lng
```

Reason:

```text
!3dlat!4dlng is usually closer to the actual Google place pin.
@lat,lng can be only the viewport center and may be slightly offset.
```

Invalid / empty / null URL does not throw.

---

### 3.2 Valid map point rule

Current product rule:

```text
Destination card has a valid map point =
map_url exists
AND system can obtain valid latitude / longitude from map_url
```

Valid coordinate definition:

```text
latitude: finite number, -90 to 90
longitude: finite number, -180 to 180
```

No manual latitude / longitude UI is shown.

Latitude / longitude are hidden data written by the system.

---

### 3.3 Save requirement and inline error

Implemented in:

```text
src/App.jsx
```

Save validation location:

```text
Destination editor `saveCurrentEditor()`
Before calling `onSaveItem()`
```

Validation helper:

```text
validateDestinationMapUrl(submittedForm.map_url)
```

Blocked cases:

```text
Map URL empty
Map URL invalid / cannot produce coordinates
maps.app.goo.gl before resolver failure
resolver failure
expanded URL without coordinates
```

Inline error display:

```text
Map URL label right side
.field-label-row + .field-inline-error
```

Error messages:

```text
Empty Map URL:
請貼上有效 Map URL

Map URL exists but cannot produce point:
無法取得有效點位
```

No toast.  
No destination-card badge.  
No success status text.

---

### 3.4 Clear Map URL behavior

Hotfix completed and manually verified.

If user explicitly clears Map URL and saves:

```text
map_url becomes empty/null according to existing format
latitude becomes null
longitude becomes null
marker disappears
missing coordinate count increases
reload / Day switch does not restore the old marker
```

Root cause fixed:

```text
normalizeMapPointFields() previously preserved existing valid latitude/longitude when map_url was blank.
This kept stale markers after Map URL was removed.
```

---

### 3.5 Marker generation

Updated marker generation requires valid coordinates.

Relevant file:

```text
src/lib/timelineMapMarkers.js
```

Rules:

```text
Destination with valid point → marker
Destination without valid point → no marker, no throw
Transportation card → no marker
Single marker → center
Multiple markers → fit bounds
Day switch → marker set updates
```

---

### 3.6 Map panel missing coordinate overlay

Map panel now shows a low-key overlay when active day has destination cards missing valid points.

Text:

```text
尚有 N 個目的地缺少可用座標
```

Rules:

```text
Show only in Map panel.
Do not add UI to destination cards.
Overlay must not affect Google map canvas height.
Google and Static providers support it.
```

This is considered a transition UI. Once every destination is required to have a point, it should rarely appear.

---

### 3.7 Marker click focus / scroll

Marker / static marker focus uses existing `onFocusItem` flow.

Behavior:

```text
marker click
→ focus destination card
→ active Timeline card scrolls into view
```

Scroll suppression states:

```text
editing
local drag
foreign drag
reorder confirmation
transport confirmation
auto-continuation confirmation
```

Do not force scroll during those states.

---

### 3.8 Google Maps short link resolver

Added:

```text
src/lib/googleMapsShortLinkResolver.js
supabase/functions/resolve-google-maps-url/index.ts
```

Edge Function:

```text
resolve-google-maps-url
```

Deployment completed:

```text
Supabase project: lqvuqamzmchepgxkftcw
```

Supported input host:

```text
maps.app.goo.gl
```

Redirect / fetch allowlist:

```text
maps.app.goo.gl
www.google.com
google.com
maps.google.com
```

Security / SSRF protection:

```text
HTTPS only
exact input host allowlist
manual redirect following
every redirect hop checked against HTTPS + exact host allowlist
redirect depth capped
no localhost / private IP / arbitrary domain fetching
```

Storage strategy:

```text
If short link resolves successfully, save expandedUrl to map_url, not the original short URL.
```

Reason:

```text
Reload / Day switch can rebuild markers without calling resolver again.
```

UI behavior:

```text
short link success → wait resolver → parse expandedUrl → save success → no success text
short link failure → editor stays open → user input preserved → existing inline error shown
resolver pending → submit disabled to avoid duplicate submit
```

Manual QA confirmed `maps.app.goo.gl` now works after deploying Edge Function.

---

## 4. Demo / Formal Boundaries Preserved

Demo must remain:

```text
StaticMapProvider only
No GoogleMapProvider
No Google Maps SDK quota
No Supabase Presence/Broadcast integration
```

Formal Google provider remains:

```text
provider google + key + loader success → Google base map
coordinates only control markers
empty/no-coordinate day still shows Google base map
```

No changes were made to:

```text
Places
Geocoding
Directions
Routes
route polyline
route cache
transport auto calculation
Timeline reorder
dnd-kit architecture
presence / broadcast / remote selection / online presence
Budget flow
Supabase schema / migration / RPC / RLS
Google API key / env commit
```

---

## 5. P0 Regression Note

Before continuing Phase 5.2, a P0 regression was observed:

```text
Phase 4.8 collaborative visual presence became unstable after Phase 4.9 / 5.x map integration.
```

User later reported:

```text
P0 has been fixed.
```

After that, Phase 5.2 testing resumed and passed.

For future map phases, always quick-smoke these Phase 4.8 features after map-related changes:

```text
foreign drag source border / opacity
remote insertion line
foreign same-day readonly lock
remote selection border
online member avatar / Day Tab presence
same-account two-tab foreign session behavior
```

---

## 6. Test Results

### Phase 5.2b

Commit:

```text
f3d1de9 Require valid destination map URLs
```

Tests:

```text
npx.cmd playwright test tests/mapPoint.spec.js tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js
44 passed

npm.cmd run build
passed with existing Vite large chunk warning

git diff --check
passed with Windows LF/CRLF warning only
```

Manual QA:

```text
OK
```

---

### Phase 5.2c

Commit:

```text
0262a7d Add Google Maps short link resolver
```

Tests:

```text
npx.cmd playwright test tests/mapPoint.spec.js tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js
49 passed

npm.cmd run build
passed with existing Vite large chunk warning

git diff --check
passed with Windows LF/CRLF warning only
```

Edge Function deployment:

```text
npx.cmd supabase login
npx.cmd supabase link --project-ref lqvuqamzmchepgxkftcw
npx.cmd supabase functions deploy resolve-google-maps-url
```

Deployment output confirmed:

```text
Deployed Functions on project lqvuqamzmchepgxkftcw: resolve-google-maps-url
```

Manual QA:

```text
maps.app.goo.gl short link tested OK.
```

---

## 7. Files Changed Across Final Phase 5.2 Work

Known files touched during Phase 5.2b / 5.2c:

```text
src/App.jsx
src/lib/mapPoint.js
src/lib/timelineMapMarkers.js
src/lib/googleMapsShortLinkResolver.js
src/styles.css
supabase/functions/resolve-google-maps-url/index.ts
tests/mapPoint.spec.js
tests/timelineMapMarkers.spec.js
tests/timelineMapFocus.spec.js
tests/mapProviderPrep.spec.js
CURRENT_TASK.md
docs/2026-07-02-phase-5-2-map-url-point-handoff.md
```

There may be untracked local Playwright output:

```text
test-results/
```

Do not include it unless explicitly needed.

---

## 8. Phase 5.2 Closeout Status

Phase 5.2 can be considered complete:

```text
Implementation complete
Automated tests passed
Build passed
Edge Function deployed
Manual QA passed
Pushed to origin/codex/timeline-phase-5-2
```

Recommended next action before new feature work:

```text
Confirm CURRENT_TASK.md and docs/2026-07-02-phase-5-2-map-url-point-handoff.md include:
- commit f3d1de9
- commit 0262a7d
- Edge Function deployment confirmation
- manual QA OK
- P0 presence regression fixed before final 5.2 QA
```

---

## 9. Recommended Phase 5.3

Recommended next phase:

```text
Timeline Phase 5.3：Custom Map Point Picker
```

Reason:

```text
Phase 5.2 lets users create map points from Google Maps URLs.
The next essential input path is custom points directly selected on the right-side map.
```

This supports cases where a destination is not a clean Google place:

```text
photo spot
meeting point
parking spot
trailhead
campground internal point
riverbank / viewpoint / roadside stop
```

---

## 10. Phase 5.3 Proposed Scope

Core flow:

```text
1. User creates or edits a destination.
2. Destination editor shows a small button near the destination/title field.
   Suggested text: 地圖選點
3. User clicks 地圖選點.
4. Right-side Google Map enters point picking mode.
5. Map shows a low-key overlay hint:
   點擊地圖設定此行程的位置
6. User clicks a point on the map.
7. System fills current editor with:
   latitude
   longitude
   map_url = https://www.google.com/maps?q={lat},{lng}
8. User saves destination using existing Phase 5.2 save requirement.
```

Important:

```text
Do not show manual latitude / longitude inputs.
Use hidden form state only.
```

Suggested cancel behavior:

```text
If user exits picking mode or cancels editor, preserve previous editor values.
Do not write to DB until user saves.
```

---

## 11. Phase 5.3 Boundaries

Phase 5.3 should NOT include:

```text
Google Places search
Map search bar
clicking Google place POI to auto-fill name
Geocoding / reverse geocoding
Directions / Routes
transport auto calculation
route polyline
route cache
Supabase migration
new package
Timeline reorder / dnd / presence changes
Budget changes
Demo Google provider
```

Phase 5.3 should be a custom point picker only.

---

## 12. Later Phase Suggestions

Suggested roadmap after 5.3:

```text
5.3 Custom Map Point Picker
    Let users select a custom point on the map from the destination editor.

5.4 Map Search / Place Search
    Add right-side map search and place result selection.
    This may require Places API and should be separately approved.

5.5 Add Flow Redesign
    Re-evaluate Timeline add, Map add, custom point add, and transportation add flow.

5.6 Simple Route Lines
    Draw straight lines between destination markers in Timeline order.
    No Directions / Routes API.

5.7 Map ↔ Timeline Full Sync
    Complete card click → marker pan/focus, hover highlight, Day sync, etc.

5.8 Transportation Auto Assist
    Later route calculation-assisted transport cards.
    This may require Directions / Routes API and cache design.
```

---

## 13. Notes for Next Chat

Start the next chat from this state:

```text
Phase 5.2 complete.
Branch origin/codex/timeline-phase-5-2 contains latest pushed work.
Edge Function resolve-google-maps-url has been deployed and manually tested OK.
Next recommended task is Phase 5.3 Custom Map Point Picker.
```

Do not re-open Phase 5.2 unless a regression appears.
