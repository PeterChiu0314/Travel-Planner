# Phase 5.8 Map Search Controls Design QA

## Comparison Target

- Source visual truth:
  - `C:/Users/PeterChiu/AppData/Local/Temp/codex-clipboard-c88373fe-f2a0-4501-b1af-48c262941f83.png`
  - `C:/Users/PeterChiu/AppData/Local/Temp/codex-clipboard-f3e34229-3bba-4b16-9aa8-2c456d1f5f14.png`
  - User requirement: suggestions match the search-field width and glass style; custom-point picking keeps the search row visible but disabled without moving the point button.
- Published implementation: authenticated `codex/timeline-phase-5-8` branch preview at commit `f60020d`.
- Full-view evidence: `C:/Users/PeterChiu/.codex/visualizations/2026/07/11/019f519e-c731-7061-8c48-ff134711f34b/phase-5-8-search-full-view.png`
- Focused implementation evidence:
  - `C:/Users/PeterChiu/.codex/visualizations/2026/07/11/019f519e-c731-7061-8c48-ff134711f34b/phase-5-8-search-suggestions.png`
  - `C:/Users/PeterChiu/.codex/visualizations/2026/07/11/019f519e-c731-7061-8c48-ff134711f34b/phase-5-8-custom-point-disabled-search.png`
- Combined comparison evidence:
  - `C:/Users/PeterChiu/.codex/visualizations/2026/07/11/019f519e-c731-7061-8c48-ff134711f34b/design-qa-search-suggestions-comparison.png`
  - `C:/Users/PeterChiu/.codex/visualizations/2026/07/11/019f519e-c731-7061-8c48-ff134711f34b/design-qa-custom-point-comparison.png`
- Viewport: authenticated desktop Chrome, 2650 x 1100 screenshot surface.
- States checked: autocomplete results for `711`; custom-point picking active.

## Findings

- No remaining P0, P1, or P2 mismatch.
- Suggestions share the search field's exact left edge and width (`0 px` left delta, `0 px` width delta) without extending beneath the Map tool buttons.
- Computed suggestion glass style is `rgba(255, 255, 255, .4)`, `blur(8px) saturate(1.4)`, `rgba(255, 255, 255, .55)` border, and `10px` radius.
- Custom-point picking leaves the search field visible, disables both the input and search action, preserves the point button's horizontal position, and changes its accessible label to `取消選點`.

## Required Fidelity Surfaces

- Fonts and typography: existing search and suggestion typography is preserved; no wrapping or weight regression is visible.
- Spacing and layout rhythm: the search field, suggestions, route button, and point button remain on the established 8 px grid; menu width and left alignment are exact.
- Colors and visual tokens: suggestions now reuse the Phase 5.8 Map glass variables in both supported and fallback states.
- Image quality and asset fidelity: no raster asset or icon replacement was required; existing library icons and Google Map rendering are preserved.
- Copy and content: autocomplete result content and the existing search/cancel labels remain unchanged.

## Interaction And Runtime Checks

- Search input produced live Google Places suggestions.
- Entering and cancelling custom-point mode did not create or modify itinerary data.
- Browser console errors: none.
- `npm.cmd run build`: passed after the final cascade fix.
- `git diff --check`: passed.

## Comparison History

1. Initial published comparison found one P1 color mismatch: the later fallback declaration overrode the translucent supported background.
2. The supported-state declaration was moved after the base fallback block and republished as `f60020d`.
3. Post-fix computed and focused visual evidence confirms the intended translucent background and exact width alignment.

## Follow-up Polish

- None required for this request; user manual verification remains welcome for personal display scaling.

final result: passed
