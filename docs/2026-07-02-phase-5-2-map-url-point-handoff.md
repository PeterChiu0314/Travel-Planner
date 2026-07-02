# Timeline Phase 5.2 Map URL Point Handoff

Date: 2026-07-02
Branch: `codex/timeline-phase-5-2`
Status: Phase 5.2 completed and verified / Phase 5.2c short-link resolver deployed and manually verified OK / no route APIs / no migration

---

## Summary

Phase 5.2 completes the first map point input flow on top of the Phase 5.1 Google Map MVP.

The final product rule is:

```text
valid destination map point =
map_url exists
and the system can parse valid latitude / longitude from map_url
```

Destination add/edit now requires a parsable full Google Maps URL. When valid, the app stores the parsed `latitude` and `longitude` as hidden persisted fields. When invalid, save is blocked and the editor remains open.

Phase 5.2c adds server-side short-link expansion for `https://maps.app.goo.gl/...` through a deployed Supabase Edge Function. Full Google Maps URLs still parse directly on the client.

---

## Completed Behavior

### Map URL Parsing

`src/lib/mapPoint.js` now owns the parser and validation rules.

`parseMapUrlToPoint(mapUrl)` supports full Google Maps coordinate patterns and uses this priority order:

```text
1. !3dlat!4dlng
2. q=lat,lng
3. ll=lat,lng
4. @lat,lng
```

The priority was changed because `!3dlat!4dlng` is usually closer to the real place pin, while `@lat,lng` is often only the viewport center.

Invalid, empty, null, and out-of-range URLs do not throw. Short URLs are detected separately and resolved through the Phase 5.2c Edge Function before coordinate parsing.

### Coordinate Persistence

`normalizeMapPointFields(payload)` is wired into destination save normalization.

For destination items:

- Valid full Google Maps URL -> parsed `latitude` / `longitude` are persisted.
- Blank Map URL -> `latitude` / `longitude` become `null`.
- Invalid Map URL -> `latitude` / `longitude` become `null`.
- Transport items -> `latitude` / `longitude` remain `null`.

The UI still does not expose manual latitude or longitude inputs.

### Marker Removal After Clearing URL

Clearing a destination Map URL now clears the stored point. After save:

- `map_url` is empty/null by the existing payload convention.
- `latitude` is `null`.
- `longitude` is `null`.
- `buildDayMapMarkers()` no longer emits a marker for that destination.
- Missing coordinate count increases correctly.
- Refreshing or switching days does not bring the marker back.

### Invalid URL Save Requirement

Destination add/edit save now validates the Map URL before calling `onSaveItem()`.

Validation helper:

```text
validateDestinationMapUrl(mapUrl)
```

Behavior:

- Blank Map URL blocks save and shows `請貼上有效 Map URL`.
- Invalid full URL blocks save and shows `無法取得有效點位`.
- `maps.app.goo.gl` short URL waits for the resolver; if expansion/parsing fails, save is blocked and the existing invalid-point label error is shown.
- Parsable full Google Maps URL saves and writes coordinates.
- Correcting the URL clears the field-level error.

The editor stays open and preserves the user's typed URL when validation fails.

### Short Link Resolver

Phase 5.2c adds one Supabase Edge Function:

```text
resolve-google-maps-url
```

Frontend behavior:

- full Google Maps URLs parse directly and do not call the resolver.
- `maps.app.goo.gl` short URLs call the resolver before save.
- resolver success returns `expandedUrl`, then the frontend runs `parseMapUrlToPoint(expandedUrl)`.
- resolver failure or expanded URLs without coordinates keep the editor open and show the existing Map URL label-level error.
- submit is disabled while resolving to avoid duplicate saves.

Storage choice:

```text
successful short-link save stores expandedUrl as map_url
```

This is intentionally more stable than storing the original short URL, because refresh/day switch can rebuild coordinates from the saved URL without another resolver call.

Resolver allowlist:

```text
short input host:
- maps.app.goo.gl

manual redirect/fetch hosts:
- maps.app.goo.gl
- www.google.com
- google.com
- maps.google.com
```

SSRF / arbitrary URL protection:

- input must be HTTPS.
- input host must exactly match `maps.app.goo.gl`.
- redirects are followed manually with `redirect: "manual"`.
- every redirect target must remain HTTPS.
- every fetch target must be in the exact Google Maps host allowlist.
- localhost, private IPs, arbitrary domains, non-HTTPS URLs, and unsupported hosts are never fetched.
- redirect depth is capped.

### Feedback Placement

Map URL errors render beside the `Map URL` label in the main destination editor:

```text
Map URL                         error text
```

Implementation:

- `mapUrlError` local state in `ItineraryTimeline`.
- `.field-label-row` for label/error alignment.
- `.field-inline-error` for low-key text styling.

No toast, success message, card badge, large red frame, or layout redesign was added.

### Marker Focus / Scroll

The Phase 5.2 marker focus path remains in place:

- marker focus can target the active Timeline card.
- Timeline card scroll uses the existing `data-timeline-item-id` surface.
- drag/edit/foreign-drag prompt states remain guarded.

---

## Files Changed

Phase 5.2 relevant files:

- `src/App.jsx`
- `src/lib/mapPoint.js`
- `src/lib/googleMapsShortLinkResolver.js`
- `src/lib/timelineMapMarkers.js`
- `src/styles.css`
- `supabase/functions/resolve-google-maps-url/index.ts`
- `tests/mapPoint.spec.js`
- `tests/timelineMapMarkers.spec.js`
- `tests/timelineMapFocus.spec.js`
- `tests/mapProviderPrep.spec.js`

Phase 5.2 docs closeout files:

- `CURRENT_TASK.md`
- `docs/2026-07-02-phase-5-2-map-url-point-handoff.md`

---

## Pushed Commits

```text
377c24a Implement Timeline Phase 5.2 map point sync
8d974a6 Fix map URL clearing and coordinate parsing
f3d1de9 Require valid destination map URLs
```

Phase 5.2c implementation commit:

```text
0262a7d Add Google Maps short link resolver
```

The Edge Function was deployed after this commit, and the user manually verified short-link behavior OK.

---

## Preserved Boundaries

No changes were made to:

- Google Places.
- Geocoding API.
- Directions API.
- Routes API.
- route polyline.
- route cache.
- search UI.
- custom point picker.
- manual latitude/longitude fields.
- Google API keys or env files.
- packages.
- Supabase migrations.
- Supabase RPC/RLS/schema.
- Timeline reorder.
- dnd-kit behavior.
- collaborative drag presence.
- remote selection.
- online presence.
- transportation pairing/repair.
- Budget flow.

Demo remains hard-locked to `StaticMapProvider`.

No package was added for short-link resolution.

---

## Verification

Automated checks:

```text
npx.cmd playwright test tests/mapPoint.spec.js tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js
passed 44/44

npm.cmd run build
passed with existing Vite large-chunk warning

git diff --check
passed with Windows LF/CRLF notices only

Edge Function deployment
completed after commit 0262a7d

Manual maps.app.goo.gl short-link verification
passed
```

Latest Phase 5.2c checks:

```text
npx.cmd playwright test tests/mapPoint.spec.js tests/timelineMapMarkers.spec.js tests/timelineMapFocus.spec.js tests/mapProviderPrep.spec.js
passed 49/49

npm.cmd run build
passed with existing Vite large-chunk warning

git diff --check
passed with Windows LF/CRLF notices only
```

Manual user verification:

```text
passed
```

Manually verified behavior included:

- clearing Map URL removes marker.
- parser chooses the correct point from full Google Maps URLs.
- invalid Map URL blocks save and shows label-level feedback.
- `maps.app.goo.gl` can resolve through the Edge Function path, then parse coordinates from the expanded URL.
- valid full Google Maps URL saves and writes coordinates.
- Demo remains static.

---

## Residual Notes

- Existing database rows may still contain old coordinate values if the user never explicitly edits/saves the Map URL. Phase 5.2 only handles explicit user saves; it does not run a data cleanup migration.
- Local function testing can use Supabase CLI after configuring the project: `supabase functions serve resolve-google-maps-url`.
- Deployment can use Supabase CLI or Dashboard; no production migration is involved.
- The deployed Edge Function has been manually verified with `maps.app.goo.gl` short links.
- Missing-coordinate UX beyond the Map URL save requirement remains a future product decision.
- The existing Vite large-chunk warning remains informational and is not a Phase 5.2 regression.

---

## Next Step

Phase 5.2c is deployed and manually verified OK. Before starting the next map phase, reread this handoff plus `CURRENT_TASK.md`.

Reasonable next product choices:

- location-data UX polish.
- missing-coordinate repair flow.
- marker polish.
- route summary work.

Keep the next phase out of Places, Geocoding, Directions, Routes, search UI, custom point picker, route cache, migrations, Timeline reorder, drag/presence, and Budget unless explicitly approved.
