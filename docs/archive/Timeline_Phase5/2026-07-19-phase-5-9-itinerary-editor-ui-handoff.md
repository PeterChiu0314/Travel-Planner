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
- The point section is collapsed by default. Its header shows a `更改地點` disclosure on the left and a compact `Maps` external link on the right.
- Expanding `更改地點` reveals the existing MapPin + `調整點位` and Search + `搜尋替換` actions, followed by the full-width Google Maps URL input.
- The URL input has no Apply button. Blur or Enter resolves and applies the completed URL, then collapses the point section on success while keeping it expanded with inline validation on failure.
- Visit-editor input, select, and textarea typography is consistently 14 px.
- Adjust Point reuses the existing map pick mode and only updates the editor draft.
- Search/Replace reuses the existing Places search and preview; the confirmation action reads `更改地點`, updates the current draft, and exits the mode.
- Search/Replace uses the existing page-overlay geometry while leaving the Map, Places suggestions, and preview confirmation interactive.
- New visits still require a valid point. Existing legacy visits without a point may edit unrelated fields when their point data is unchanged.
- All point changes remain draft-only until the visit form is saved.
- Expanded visit details use 400-weight note copy and unframed metadata rows with thin separators. Linked budget uses a 14 px / 500 `Wallet` heading plus a content-width pale-green tag that wraps below only when needed; an existing alternative uses a 16 px `Files` icon, 14 px / 400 `備案`, and a 400-weight plain 24 px summary whose divider/content group wraps when constrained. The alternative and budget rows use 8 px top margins. The compact Google Map link remains lower-left with `2px 6px` padding and a `-6px` left margin, while the flip control remains lower-right.

## Verification

- `npm.cmd run build` passed.
- `npm.cmd run test:e2e -- tests/mapProviderPrep.spec.js` passed 40/40.
- `npm.cmd run test:e2e -- tests/phase-1-7f-smoke.spec.js` passed 30/30.
- The Phase 5.9 rendered smoke check at 1280 x 720 confirmed same-row geometry, independently adjustable hour/minute segments, minute `+5`, the multi-option custom menu, `90 -> 1小時30分鐘`, linked end-time updates, collapsed URL input, and zero console errors.
- In-app Browser Demo QA at 624 x 800 confirmed the collapsed 34 px `更改地點` / `Maps` header and the expanded 34 px point-action row plus 36 px full-width URL input. The 486 px editor had no horizontal overflow, save actions remained visible, and console errors remained zero.
- The focused Phase 5.9 density checks passed 4/4 after the final point-action width fix.
- `git diff --check` passed.

## Manual QA Still Recommended

- Authenticated Formal Google Maps visual comparison for the Search/Replace overlay, Places suggestion z-index, preview confirmation label, and cancellation cleanup.
- User visual approval of final card density and control proportions.
