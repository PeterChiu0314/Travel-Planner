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
