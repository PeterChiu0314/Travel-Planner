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
