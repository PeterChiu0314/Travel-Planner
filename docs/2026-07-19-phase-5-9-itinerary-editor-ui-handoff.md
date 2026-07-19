# Timeline Phase 5.9 Itinerary Editor UI Handoff

## Scope

Phase 5.9 updates the Timeline visit editor UI without changing itinerary persistence, overlap rules, transportation pairing, auto-continuation, draft autosave, edit locks, Realtime, or route persistence.

## Implemented

- Type and destination share one compact row at approximately 25/75 width.
- Start, end, and duration share one linked row.
- The first two control rows use a compact 36 px height.
- Start/end use one visual field with separately focusable hour and minute segments. Each segment supports direct numeric input, arrow keys, wheel adjustment, left/right navigation, and whole-time paste such as `945`, `0945`, `9:45`, or `09:45`.
- The custom time menu replaces the browser-native `datalist`, contains all 288 five-minute options, scrolls the current value into view, and displays multiple choices at once.
- Hour changes use one-hour steps, minute changes use five-minute steps, and start-time edits preserve the current duration/linkage behavior.
- The duration field accepts minutes and renders a localized hour/minute label.
- The visit note starts at two lines with reduced padding, auto-grows to about five lines, then scrolls internally.
- The point section removes the redundant title and leading icon. Its roughly 44 px action row uses three explicit icon-and-text controls: MapPin + `調整點位`, Search + `搜尋替換`, and Map + `打開地圖`.
- The old always-visible Map URL field is replaced by an expandable URL input beside the compact point actions.
- The URL input has no Apply button. Blur or Enter resolves and applies the completed URL, then collapses the input on success while keeping inline validation visible on failure.
- Visit-editor input, select, and textarea typography is consistently 14 px.
- Adjust Point reuses the existing map pick mode and only updates the editor draft.
- Search/Replace reuses the existing Places search and preview; the confirmation action reads `更改地點`, updates the current draft, and exits the mode.
- Search/Replace uses the existing page-overlay geometry while leaving the Map, Places suggestions, and preview confirmation interactive.
- New visits still require a valid point. Existing legacy visits without a point may edit unrelated fields when their point data is unchanged.
- All point changes remain draft-only until the visit form is saved.

## Verification

- `npm.cmd run build` passed.
- `npm.cmd run test:e2e -- tests/mapProviderPrep.spec.js` passed 40/40.
- `npm.cmd run test:e2e -- tests/phase-1-7f-smoke.spec.js` passed 30/30.
- The Phase 5.9 rendered smoke check at 1280 x 720 confirmed same-row geometry, independently adjustable hour/minute segments, minute `+5`, the multi-option custom menu, `90 -> 1小時30分鐘`, linked end-time updates, collapsed URL input, and zero console errors.
- In-app Browser Demo QA at 624 x 800 confirmed 36 px primary/time controls, a 55 px two-line note, a roughly 44 px point row, the removed point title, and three approximately 84.82 px actions whose client and scroll widths match without clipping. Console errors remained zero.
- The focused Phase 5.9 density checks passed 4/4 after the final point-action width fix.
- `git diff --check` passed.

## Manual QA Still Recommended

- Authenticated Formal Google Maps visual comparison for the Search/Replace overlay, Places suggestion z-index, preview confirmation label, and cancellation cleanup.
- User visual approval of final card density and control proportions.
