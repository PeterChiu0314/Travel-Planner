# Design QA — Alternative editor persistent map controls

- Source visual truth: `C:/Users/ADMINI~1/AppData/Local/Temp/codex-clipboard-b6b463ea-ea62-4a9b-8e25-54f677006635.png`
- Implementation screenshot: `docs/qa/2026-07-22-alternative-editor-iab-full.png`
- Combined comparison: `docs/qa/2026-07-22-alternative-editor-comparison.png`
- Browser: Codex in-app browser.
- Viewport/state: 607 × 697 CSS px at device pixel ratio 1; Demo Timeline Day 1, existing alternative editor.
- Pixel dimensions: source 506 × 408; implementation viewport 592 × 680; comparison board 1093 × 438. The focused implementation region was scaled to the source-region height for side-by-side inspection.

## Full-view comparison evidence

The implementation capture confirms the alternative editor remains within the existing Timeline card, keeps the external Google Map link on the right side of the map header, and does not introduce horizontal overflow. The existing editor typography, field order, borders, and spacing remain unchanged outside the requested map and action areas.

## Focused-region comparison evidence

- The static `地圖點位` heading occupies the former toggle row and uses the existing MapPin icon treatment.
- The alternative editor contains zero `.visit-map-point-toggle` elements and always renders Adjust Point, Search/Replace, and Google Maps URL controls.
- The Google Map link remains right-aligned in the unchanged header container.
- Delete Alternative and Return to Main Itinerary both compute to `rgba(0, 0, 0, 0)` backgrounds. Delete Alternative retains the existing danger text color.
- The 486 px editor reports zero horizontal overflow.
- Browser console inspection found no error entries during the verified flow.

## Required fidelity surfaces

- Fonts and typography: existing application family, weights, sizes, labels, and line heights remain unchanged.
- Spacing and layout rhythm: the redundant expanded-body top gap was removed; the map controls move upward beneath the static heading without changing the external-link position.
- Colors and visual tokens: existing border, text, muted, and danger tokens remain in use; only the two requested action backgrounds are transparent.
- Image quality and asset fidelity: no raster assets were introduced; the existing Lucide MapPin and action icons remain unchanged.
- Copy and content: `地圖點位`, `Google Map`, `調整點位`, `搜尋替換`, `刪除備案`, and `返回主行程` are preserved.

## Comparison history

1. P2: the alternative editor initially retained the collapsible `更改地點` row, causing a larger height change between modes. Fixed by replacing it with a static `地圖點位` heading and rendering the body permanently.
2. P2: Delete Alternative and Return to Main Itinerary used the shared surface fill. Fixed with an alternative-editor-scoped transparent background while retaining borders, icons, alignment, and danger text.

## Findings

No remaining P0, P1, or P2 mismatch was found in the requested region.

## Implementation checklist

- [x] Remove the alternative editor map toggle.
- [x] Keep alternative map controls permanently expanded.
- [x] Preserve the right-side Google Map link.
- [x] Move the map body upward beneath the static heading.
- [x] Remove both bottom-action background fills.
- [x] Preserve the existing alternative delete confirmation behavior.
- [x] Verify the focused workflow, responsive card width, and console.

## Follow-up polish

No P3 follow-up identified for this scope.

final result: passed

---

# Design QA — Phase 7 compact dialog and 35% image refinement

- Source visual truth: `docs/qa/2026-08-20-phase-7-import-preview-image-top.png`, with the user's later instructions authoritative: narrower and taller dialog, shorter image/map gradient, larger map-point framing, and image reduced to 35%.
- Browser-rendered implementation: `docs/qa/2026-08-20-phase-7-import-preview-image-35.png`.
- Combined comparison: `docs/qa/2026-08-20-phase-7-import-preview-image-35-comparison.png`.
- Browser and viewport: Codex in-app Browser, 1440 × 899 CSS px at device pixel ratio 1.
- State: authenticated local Staging, valid JSON import preview before confirmation.

## Full-view comparison evidence

- Dialog changed from approximately 778 × 657 px to 720 × 694 px.
- Preview board changed from approximately 728 × 441 px to 670 × 479 px.
- Image measures 166.90 px, or 34.87% of the board; map measures 309.97 px, or 64.75%.
- The image/map transition was shortened from 76 px to 48 px.

## Focused-region comparison evidence

- Route framing padding is now 56 px top, 44 px bottom, and 42 px on each side, enlarging D1–D4 while keeping them clear of the image fade and Google attribution.
- Title, destination, dates, day count, Wikimedia credit, Google logo, map data, counts, safety note, and actions remain visible.
- No horizontal overflow or dialog scrolling was introduced at the verified desktop viewport.

## Required fidelity surfaces

- Fonts and typography: unchanged; image text remains aligned to the top.
- Spacing and layout rhythm: narrower 50vw dialog and taller 1.4:1 board create the requested portrait-leaning desktop proportion.
- Colors and visual tokens: unchanged; only the blend length was reduced.
- Image quality and asset fidelity: Wikimedia landscape crop and attribution are preserved.
- Copy and content: unchanged.

## Comparison history

1. P2: dialog remained wider and flatter than requested. Fixed with a 50vw/800 px width cap and 1.4:1 board.
2. P2: 76 px transition occupied too much of the map/photo boundary. Fixed by shortening the fade to 48 px.
3. P2: route points appeared too compressed. Fixed by reducing Google `fitBounds` padding while preserving attribution clearance.
4. User refinement: image share changed from 40% to 35%; map now receives 65%.

## Findings

No actionable P0, P1, or P2 mismatch remains in this refinement scope.

## Implementation checklist

- [x] Narrow and heighten the dialog.
- [x] Shorten the image/map gradient.
- [x] Enlarge the route-point framing.
- [x] Set image/map to 35%/65%.
- [x] Verify browser measurements, focused tests, production build, and `git diff --check`.

## Follow-up polish

No P3 follow-up identified for this scope.

final result: passed

---

# Design QA — Version information dialog

- Source visual truth: `C:/Users/ADMINI~1/AppData/Local/Temp/codex-clipboard-3681bb53-1055-4733-835f-481013a06cc1.png`.
- Browser-rendered implementation: `docs/qa/2026-07-23-version-dialog-full.png`.
- Focused implementation capture: `docs/qa/2026-07-23-version-dialog.png`.
- Combined comparison: `docs/qa/2026-07-23-version-dialog-comparison.png`.
- Browser and viewport: Chrome, 1202 × 638 CSS px.
- State: authenticated version-dialog structure rendered with the production component classes and current stylesheet.

## Comparison evidence

- The two-line product name is consolidated into the requested single line: `旅程工房 | Travel Studio`.
- The displayed application version is `v0.1.6`.
- The dialog uses the existing liquid-glass surface treatment: 72% surface color, 18 px blur, 1.4 saturation, and the shared glass border token.
- The information panel and close button both compute to fully transparent backgrounds.
- The existing logo, preview badge, facts layout, dividers, and control placement remain visually consistent with the reference.
- The title remains on one line at the measured 420 px dialog width, and the page reports no horizontal overflow.

## Findings

No actionable P0, P1, or P2 mismatch remains in the requested version-dialog scope.

## Implementation checklist

- [x] Consolidate the bilingual title onto one line.
- [x] Update the visible and package versions to 0.1.6.
- [x] Apply the existing liquid-glass dialog surface.
- [x] Remove background fills from the information panel and close button.
- [x] Verify the focused source guard, production build, computed styles, and overflow.

final result: passed

---

# Design QA — Expanded visit and transportation budget rows

- Source visual truth: `C:/Users/ADMINI~1/AppData/Local/Temp/codex-clipboard-5733eef9-2c5c-4dcb-aa60-addf96c6918f.png` and `C:/Users/ADMINI~1/AppData/Local/Temp/codex-clipboard-6ffe7d37-d61d-4e53-ad96-d9c61fe6c55b.png`, with the user's responsive placement instructions authoritative.
- Browser-rendered implementation: `docs/qa/2026-07-23-expanded-budget-wide-full.png` and `docs/qa/2026-07-23-expanded-budget-visit-full.png`.
- Focused implementation captures: `docs/qa/2026-07-23-expanded-budget-transport.png` and `docs/qa/2026-07-23-expanded-budget-visit.png`.
- Combined comparison: `docs/qa/2026-07-23-expanded-budget-comparison.png`.
- Browser and viewport: Codex in-app Browser, 1280 × 800 CSS px at device pixel ratio 1; responsive behavior also measured at 320 × 800 CSS px.
- Pixel dimensions: source visit 265 × 103; source transportation 512 × 131; implementation viewport 1280 × 800; focused visit 380 × 230; focused transportation 380 × 164; comparison board 940 × 500. No density normalization was required.
- State: Demo Timeline Day 1 with one visit card and one transportation card expanded in turn.

## Full-view comparison evidence

- The expanded visit card preserves the existing card frame, note wrapping, lower-right alternative control space, and information hierarchy.
- The expanded transportation card keeps its summary and actions unchanged while moving the budget row below the complete note.
- Both expanded-card budget rows use the existing Wallet icon, divider, pale-green information tag, and responsive flex treatment.

## Focused-region comparison evidence

- Visit note text computes to 13 px / 400. Both budget labels read `預算` and compute to 14 px / 400.
- At 1280 px viewport width, the budget label and divider/tag content are side by side in both card types.
- At 320 px viewport width, the 140 px-wide transportation budget row wraps its content below the heading and reports zero horizontal overflow.
- Transportation note-to-budget layout uses the same 10 px grid gap plus shared 8 px budget-row top spacing as the visit details.
- Browser console inspection found zero error entries.

## Required fidelity surfaces

- Fonts and typography: the requested 13 px note copy and 400-weight `預算` labels are applied while retaining the existing application font and line-height behavior.
- Spacing and layout rhythm: transportation now follows the visit-card vertical rhythm; the responsive row remains compact and only wraps when its available width is insufficient.
- Colors and visual tokens: existing ink, muted, divider, border, and pale-green pill tokens remain unchanged.
- Image quality and asset fidelity: no raster UI assets were introduced; the existing Lucide Wallet icon is reused.
- Copy and content: the heading is `預算`; existing linked and unlinked budget content remains intact.

## Comparison history

1. The first rendered comparison found no actionable P0, P1, or P2 mismatch in the requested region. No visual correction iteration was required.

## Findings

No actionable P0, P1, or P2 mismatch remains in the requested expanded-card scope.

## Implementation checklist

- [x] Rename the expanded budget heading to `預算` and use weight 400.
- [x] Render expanded visit-note copy at 13 px.
- [x] Move transportation budget information below its note.
- [x] Keep budget heading and information side by side when space permits.
- [x] Wrap only when constrained, without horizontal overflow.
- [x] Verify both expanded states and browser console output.

## Follow-up polish

No P3 follow-up identified for this scope.

final result: passed

---

# Design QA — Expanded itinerary detail proportions

- Source visual truth: `C:/Users/PETERC~1/AppData/Local/Temp/codex-clipboard-4905aa72-1057-4614-9991-279a079f1c7d.png` plus the user's explicit same-row placement and spacing corrections.
- Browser-rendered implementation: `docs/qa/2026-07-22-expanded-itinerary-iab-viewport.png`.
- Focused card capture: `docs/qa/2026-07-22-expanded-itinerary-card-iab-full.png`.
- Focused alternative capture: `docs/qa/2026-07-22-expanded-itinerary-alternative-iab.png`.
- Combined comparison: `docs/qa/2026-07-22-expanded-itinerary-comparison.png`.
- Browser and viewport: Codex in-app Browser, 1280 × 800 CSS px at device pixel ratio 1.
- Pixel dimensions: source 584 × 93; implementation viewport 1280 × 800; focused card 480 × 305; focused alternative row 394 × 29; comparison board 806 × 87.
- State: Demo Timeline Day 1, Map collapsed, the first visit expanded after creating and saving a realistic `交通・AA` alternative.

## Full-view comparison evidence

- Only the content below the visit-card divider changed; the collapsed summary, card actions, staged focus/expand interaction, Google Map link behavior, and lower-right flip control remain intact.
- The note presentation is unchanged. The measured note-to-budget gap is 15.99 px, the budget heading-to-tag gap is 6 px, the budget-to-alternative gap is 11.99 px, and the alternative-to-Map gap is 11.99 px.
- The budget information bar and complete alternative row each measure 388.38 px, exactly matching the details-divider width. The alternative information bar ends 6.99 px before the flip button.

## Focused-region comparison evidence

- The screenshot remains the styling reference for the Files icon, label hierarchy, border, radius, typography, and summary treatment. The user's later correction is authoritative for moving the label and summary onto one row.
- The alternative information bar measures 23.99 px, has no chevron, is not a button or link, and contains no delete action.
- `連動預算` computes to 14 px / 600 with dark text and 8 px left padding. The unlinked state retains the pale-green information surface.
- The compact Google Map ghost link remains lower-left with a 12 px top margin. Browser console inspection found zero errors.

## Required fidelity surfaces

- Fonts and typography: existing application fonts remain unchanged; the budget heading uses the requested 14 px / 600 hierarchy, while information-bar copy retains the existing 12–13 px treatment.
- Spacing and layout rhythm: the expanded wrapper uses `0 30px`; measured gaps and divider alignment match the user-specified proportions, and the alternative row preserves the flip-button safety gap.
- Colors and visual tokens: existing ink, line, mint, transparent secondary, and pale-green pill tokens remain in use.
- Image quality and asset fidelity: no raster UI asset was added; the existing Lucide `Files`, `ExternalLink`, and `Repeat2` icons are preserved.
- Copy and content: full notes, `連動預算`, `尚未連動預算`, `備案`, `交通・AA`, and `Google Map` render in the requested hierarchy.

## Comparison history

1. P2: the first pass interpreted the screenshot literally and placed the alternative heading above the summary, while limiting budget and alternative rows by an extra 50 px. The user clarified that the information rail should align with the divider and that `備案` plus its summary belong on one row. Both rows now align to the divider while the existing card inset leaves a 6.99 px flip-control safety gap.
2. P3: the initial corrected row used the editor's 28 px summary height and 8 px vertical spacing. Per user correction, the expanded-card summary is now 24 px and both the alternative top gap and Google Map top margin are 12 px.

## Findings

No actionable P0, P1, or P2 mismatch remains in the requested expanded-detail scope.

## Implementation checklist

- [x] Preserve the full note and collapsed summary.
- [x] Strengthen and space the linked-budget heading.
- [x] Align budget information to the divider width.
- [x] Render the alternative heading and 24 px read-only summary on one row.
- [x] Remove expanded-summary chevron, click behavior, and delete action.
- [x] Preserve the Google Map ghost link and lower-right flip control.
- [x] Verify the realistic create/save/expand flow, measurements, and browser console.

## Follow-up polish

No P3 follow-up remains for this scope.

final result: passed

---

# Design QA — Transportation name input alignment

- Source visual truth: `C:/Users/ADMINI~1/AppData/Local/Temp/codex-clipboard-fa60fb2b-0625-44cf-bd12-7726bbc36e62.png`.
- Browser-rendered implementation: `docs/qa/2026-07-23-transport-name-padding-full.png`.
- Focused implementation capture: `docs/qa/2026-07-23-transport-name-padding.png`.
- Combined comparison: `docs/qa/2026-07-23-transport-name-padding-comparison.png`.
- Browser and viewport: Codex in-app Browser, 1280 × 720 CSS px at device pixel ratio 1.
- Pixel dimensions: source 404 × 314; implementation viewport 1280 × 720; focused implementation 380 × 305; comparison board 814 × 334. No density normalization was required.
- State: Demo Timeline Day 1 with the existing transportation card editor open.

## Full-view comparison evidence

- The transportation editor retains its existing category, duration, navigation, note, and action layout.
- Only the transportation-name input receives the alignment override; shared floating-field and itinerary-field styles remain unchanged.

## Focused-region comparison evidence

- The transportation-name input computes to 12 px left padding.
- The input content and floated `交通名稱` label both begin at x = 298 px, for a measured difference of 0 px.
- The editor reports zero horizontal overflow and the browser console reports zero errors.

## Required fidelity surfaces

- Fonts and typography: existing font size, weight, line height, and floating-label treatment are unchanged.
- Spacing and layout rhythm: the name value now aligns with its label and the 12 px inset used by the note content.
- Colors and visual tokens: unchanged.
- Image quality and asset fidelity: no image or icon assets changed.
- Copy and content: unchanged.

## Comparison history

1. The first rendered comparison found no remaining actionable P0, P1, or P2 mismatch after the scoped padding correction.

## Findings

No actionable P0, P1, or P2 mismatch remains in the requested field.

## Implementation checklist

- [x] Scope the override to transportation-name inputs only.
- [x] Align input content and floating-label starts at 12 px.
- [x] Preserve all surrounding editor fields and layout.
- [x] Verify the focused regression test, production build, layout measurement, and console.

## Follow-up polish

No P3 follow-up identified for this scope.

final result: passed

# Design QA — Phase 7 graphical import preview

- Source visual truth: `C:/Users/PETERC~1/AppData/Local/Temp/codex-clipboard-c0e32209-9790-47fb-85ec-940fe3a3cace.png` (1584 × 990 px).
- Browser-rendered implementation: `docs/qa/2026-08-20-phase-7-import-preview-taller.png` from local Staging preview at `http://127.0.0.1:5174/` (1440 × 899 px at device pixel ratio 1).
- Combined comparison: `docs/qa/2026-08-20-phase-7-import-preview-comparison.png`; both captures were normalized to 900 px height and inspected together.
- Browser and viewport: Codex in-app Browser; desktop 1440 × 900 CSS px and narrow 390 × 844 CSS px.
- State: valid local JSON preview before confirmation; a separate invalid JSON preview verified the guarded state.

## Full-view comparison evidence

- The revised dialog measured 778 × 657 CSS px at desktop size and required no internal scrolling.
- The preview board measured 728 × 441 CSS px, making the dialog narrower and slightly taller than the previous 835 × 638 pass.
- The selected hierarchy is preserved: compact title/file header, one wide map-and-photo board, embedded trip identity, one compact counts row, safety note, and right-aligned actions.
- The live implementation uses the existing Google Maps JavaScript API and a Wikimedia image while preserving the mock's composition.

## Focused-region comparison evidence

- Exactly one eligible representative point appeared for each D1–D4.
- Airport/station labels, notes, transportation-category cards, and missing coordinates were excluded from representative selection.
- Normal segments use a single forest-green route color; no per-Day color legend is rendered.
- Google Maps attribution and Wikimedia author/license attribution were visible.
- The board measured approximately 60% map and 40% photo, with a soft 76 px blend across the seam instead of a hard cut.
- Wikimedia search now inspects up to five candidates and prefers original images between 1.6:1 and 2.4:1 at 1000 × 500 px or larger before falling back to the closest available ratio.
- At 390 × 844, the dialog had no horizontal overflow and retained readable content and actions.
- Invalid JSON displayed both validation messages and disabled `確認匯入`.
- `確認匯入` was never clicked during QA, so no persistence was triggered.

## Required fidelity surfaces

- Typography and spacing follow the existing warm application language while matching the approved compact wide-screen proportion.
- The photo is integrated as the lower background band rather than rendered as a detached thumbnail.
- Counts are limited to visits, transports, and alternatives.
- The exact pre-persistence safety copy is retained.
- Route spacing remains data-driven because it is calculated from real geographic bounds.

## Findings

No remaining P0, P1, or P2 mismatch was found in the requested import-preview scope.

## Comparison history

1. P2: the prior 58vw, 1.86:1 implementation remained visibly wider and flatter than the user's latest reference. Fixed by reducing the desktop dialog to 54vw/860px maximum and increasing the board to a 1.65:1 ratio. The normalized comparison confirms the revised dialog is narrower while retaining the 6:4 map/photo hierarchy.
2. P2: the prior image lookup accepted the first usable page image, allowing portrait or extreme panorama sources to depend on aggressive CSS cropping. Fixed by evaluating up to five candidates using Commons original dimensions and preferring sufficiently large 1.6:1–2.4:1 landscape images.

## Implementation checklist

- [x] Responsive 54vw desktop dialog and taller 1.65:1 preview board with continuous 6:4 Google-map/photo content.
- [x] One eligible middle representative point per Day.
- [x] Normal, flight, and long-distance-break segment handling.
- [x] Keyless Wikimedia multi-candidate lookup, original-dimension filtering, attribution, and quiet fallback.
- [x] Existing validation and atomic confirmation behavior preserved.
- [x] Desktop and narrow browser verification.
- [x] Focused tests, full test suite, production build, and diff check.

## Follow-up polish

No P3 follow-up identified for this scope.

final result: passed

---

# Design QA — Phase 7 preview image/map order

- Source visual truth: `C:/Users/PETERC~1/AppData/Local/Temp/codex-clipboard-c0e32209-9790-47fb-85ec-940fe3a3cace.png`, with the user's later instruction authoritative: image above the map, image/map ratio 4:6, and image text aligned to the top.
- Browser-rendered implementation: `docs/qa/2026-08-20-phase-7-import-preview-image-top.png`.
- Combined comparison: `docs/qa/2026-08-20-phase-7-import-preview-image-top-comparison.png`.
- Browser and viewport: Codex in-app Browser, 1440 × 899 CSS px at device pixel ratio 1.
- Pixel dimensions: source 1584 × 992; implementation 1440 × 899; combined comparison 3168 × 1036. Both full-page captures were padded to equal comparison widths without changing their aspect ratios.
- State: authenticated local Staging, valid JSON import preview before confirmation.

## Full-view comparison evidence

- The dialog remains approximately 778 × 657 CSS px and keeps the approved narrower, taller desktop proportion.
- The 728 × 441 preview board now places the Wikimedia image on top and Google Map below.
- Measured image area is 175.70 px (39.8%) and map area is 263.55 px (59.8%).
- The trip copy starts 18.91 px from the board top and remains legible over the image.
- The photo extends into a soft 76 px downward fade at the seam without covering the bottom Google logo, map-data attribution, or terms.

## Focused-region comparison evidence

- Google route bounds now reserve 108 px at the top of the map so D1–D4 markers remain in the unobscured map region below the image transition.
- Trip title, destination, dates, and day count are grouped at the upper-left of the image; Wikimedia credit remains at the upper-right.
- The Google logo and map-data attribution remain visible at the map bottom.
- A fresh local app tab loaded with zero browser console errors. The existing Google Maps legacy Marker warning remains informational in the authenticated workspace.

## Required fidelity surfaces

- Fonts and typography: existing 24 px title and 14 px supporting hierarchy remain unchanged; only vertical placement moved to the image top.
- Spacing and layout rhythm: the board keeps the accepted 1.65:1 ratio and exact 4:6 region split, with no added dialog height or internal scroll.
- Colors and visual tokens: existing forest-green route, warm dialog surface, dark photo scrim, and seam opacity are preserved.
- Image quality and asset fidelity: the selected Wikimedia landscape image keeps its cover crop and attribution; no substitute asset or placeholder was introduced.
- Copy and content: trip identity, counts, safety note, and import actions remain unchanged.

## Comparison history

1. P1: the previous implementation placed Google Map above the photo, conflicting with the user's requested swap. Fixed by anchoring the 40% photo region at the top and the 60% Google Map region at the bottom.
2. P2: after moving the map below the photo, route points could have occupied the faded seam. Fixed by increasing Google `fitBounds` top padding to 108 px while retaining bottom attribution space.

## Findings

No actionable P0, P1, or P2 mismatch remains in the requested preview-board scope.

## Implementation checklist

- [x] Place the image above the Google Map.
- [x] Keep the image/map ratio at 4:6.
- [x] Align image text to the upper edge.
- [x] Preserve the soft image-to-map transition.
- [x] Keep all Google branding and map-data attribution visible.
- [x] Keep route markers inside the unobscured map region.
- [x] Verify browser rendering, production build, focused Phase 7 tests, and `git diff --check`.

## Follow-up polish

No P3 follow-up identified for this scope.

final result: passed
