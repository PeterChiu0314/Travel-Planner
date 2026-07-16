# Design QA — Shared Itinerary Type Colors

- Source visual truth: `C:/Users/PETERC~1/AppData/Local/Temp/codex-clipboard-46767969-2d37-495e-a9b4-7053f7863bc4.png`
- Formal implementation source: `src/lib/mapMarkerVisuals.js` and `src/lib/timelineTypeStyles.js`
- Implementation screenshot: `C:/Users/PeterChiu/.codex/visualizations/2026/07/16/019f6ac6-57f2-7f43-a06f-796320713fd6/design-preview-type-label-marker-sync.png`
- Viewport: 1280 × 720 CSS px
- State: desktop design-system preview, left Token panel scrolled to shared itinerary type colors with Timeline labels and Map markers visible

## Full-view comparison evidence

The source panel and browser-rendered Preview were opened together at original detail. The control group is now named `行程類型色` and clearly states that one type palette controls both itinerary-card labels and Map markers. The group continues to follow the existing Token-panel grid, typography, spacing, and scrolling patterns without changing the workspace layout.

## Focused region comparison evidence

A separate crop was not required because the implementation screenshot shows the type controls, visible itinerary labels, and Map markers at readable size. Browser interaction changed food to `#0066CC`; both food labels and Map markers 1 and 3 immediately received identical derived fill and text colors, while marker borders used the selected main color.

## Required fidelity surfaces

- Fonts and typography: the group reuses the existing 15px section heading, 12px labels, and 10px descriptions; no wrapping or clipping was observed.
- Spacing and layout rhythm: all five rows reuse the existing three-column color-control grid and remain inside the independently scrolling Token panel.
- Colors and visual tokens: attraction, food, hotel, transport, and note now use shared `color-type-*` tokens. Card labels and markers consume the same fill and text values; Reset restores the exact Formal defaults.
- Image quality and asset fidelity: existing Formal SVG marker geometry and shadow remain unchanged; only token-driven color values were added.
- Copy and content: the `行程類型色` heading and description communicate the shared relationship. Marker sequences 1–5 align with card labels food, transport, food, attraction, and hotel.

## Findings

No actionable P0, P1, or P2 mismatch remains within the requested shared-type-color scope.

## Comparison history

1. Baseline finding — P1: Map markers used editable marker-only tokens while itinerary-card labels still used unrelated Error, Info, and Success colors; marker 1 also disagreed with its food label.
2. Fix: replaced marker-only tokens with shared `color-type-*` tokens, applied their companion tones to both surfaces, aligned marker 1 to food, and added legacy `color-marker-*` import fallback.
3. Post-fix evidence: all five visible card/marker pairs match on fill and text colors. A custom food value updated both food labels and markers 1 and 3; all computed matches passed.

## Verification

- Default card-label/marker synchronization: passed, 5/5 visible pairs.
- Live custom food update: passed for 2/2 labels and 2/2 markers.
- Reset to exact Formal type colors: passed.
- Legacy `color-marker-*` import compatibility: implemented through explicit fallback.
- Browser console warnings/errors: 0.
- `npm.cmd run build`: passed.
- `git diff --check`: passed.

final result: passed
