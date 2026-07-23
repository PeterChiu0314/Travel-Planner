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
