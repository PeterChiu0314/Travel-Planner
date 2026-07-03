# Timeline Phase 5.3b Marker Focus / Fixed Zoom Polish Closeout

Date: 2026-07-03
Branch: `codex/timeline-phase-5-2`

## Status

Phase 5.3b and the follow-up hotfix are complete, pushed, and manually verified OK.

Latest pushed commit:

```text
498f0ef Fix timeline phase 5.3b marker focus polish
```

Related commit:

```text
b05f72c Polish timeline phase 5.3b marker focus
```

## What Changed

- Timeline destination card clicks now focus the matching Formal Google marker.
- Formal Google map focus uses fixed zoom `15`.
- Focus movement uses Google Maps `panTo`; no custom animation was added.
- Google marker clicks continue to focus/scroll the matching Timeline card.
- Google marker clicks now also update the focused marker active style.
- Focused marker styling uses only the standard Google `Marker` API:
  - higher `zIndex`
  - larger circle symbol icon
  - white label text
  - stronger stroke
- Non-focused markers restore to default icon/label state when focus changes.
- Marker creation no longer depends on `focusedMarkerId`, so focus changes do not rebuild markers or re-run bounds fitting.
- Map point picking mode still suppresses Timeline/marker focus behavior.
- Destinations without valid coordinates do not create marker focus behavior and do not change zoom.
- Demo remains StaticMapProvider-only and does not load the Google Maps SDK.

## Files Changed

```text
src/components/map/providers/GoogleMapProvider.lazy.jsx
tests/mapProviderPrep.spec.js
CURRENT_TASK.md
docs/2026-07-03-phase-5-3b-marker-focus-closeout-handoff.md
```

The earlier 5.3 transition handoff was also pushed:

```text
docs/timeline-phase-5-2-to-5-3-handoff-gpt.md
```

## Verification

Automated checks run for initial 5.3b:

```text
npx.cmd playwright test tests/mapPoint.spec.js tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js
passed 54/54

npx.cmd playwright test tests/phase-4-2c-reorder.spec.js
passed 33/33

npm.cmd run build
passed with existing Vite large-chunk warning

git diff --check
passed with Windows LF/CRLF notices only
```

Automated checks run for 5.3b hotfix:

```text
npx.cmd playwright test tests/mapPoint.spec.js tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js
passed 54/54

npx.cmd playwright test tests/phase-4-2c-reorder.spec.js
passed 33/33

npm.cmd run build
passed with existing Vite large-chunk warning

git diff --check
passed with Windows LF/CRLF notices only
```

Manual QA:

```text
Timeline A -> smooth pan + zoom 15 passed
Timeline B -> smooth pan + active marker switch passed
Google marker click -> Timeline focus/scroll + active marker passed
Manual zoom changes reset to zoom 15 on next Timeline focus passed
Day switch did not leave stale focused marker styling passed
Map point picking mode remained unaffected passed
Demo remained StaticMapProvider-only passed
```

## Protected Scope

No changes were made to:

```text
Places
Geocoding
Directions
Routes
route polyline
route cache
search UI
POI click/add flow
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

- Keep Demo static unless explicitly redesigned.
- Keep route/line work out of marker focus polish. Simple route lines or polylines should be treated as a separate Phase 5.4-style decision.
- If marker focus needs more visual tuning, stay within standard Google `Marker` options unless a later phase explicitly approves `AdvancedMarkerElement`.
- If map point picking is active, marker focus and Timeline card focus should stay suppressed.

