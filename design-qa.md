# Phase 5.8 Transport Insertion Control Design QA

## Comparison Target

- Source visual truth: `C:/Users/PeterChiu/AppData/Local/Temp/codex-clipboard-2a2fbc0f-e56c-45ed-86af-0825429e358e.png`.
- User requirement: retain only a Plus icon beside `新增交通資訊`, remove its circular surface, place the icon closer to the copy, use 500-weight copy, vertically center the trailing line, and set the resting trigger height to 8 px.
- Full implementation evidence: `C:/Users/PeterChiu/.codex/visualizations/2026/07/11/019f519e-c731-7061-8c48-ff134711f34b/phase-5-8-transport-insert-hover.png`.
- Focused implementation evidence: `C:/Users/PeterChiu/.codex/visualizations/2026/07/11/019f519e-c731-7061-8c48-ff134711f34b/phase-5-8-transport-insert-hover-focused.png`.
- Viewport: local Demo Timeline desktop, 1280 x 720; focused comparison uses the visible insertion row.
- States checked: 8 px resting trigger, forced browser hover state, and opened transportation editor.

## Findings

- No remaining P0, P1, or P2 mismatch.
- The insertion row computes to 8 px at rest and 22 px on hover, preserving a compact Timeline while fitting the complete affordance.
- The 14 px Lucide Plus has no background, border radius, or shadow and sits 1.99 px from the label.
- The label computes to weight 500, and the trailing line is within 0.5 px of the label's visual center.

## Required Fidelity Surfaces

- Fonts and typography: insertion copy remains 14 px and now uses weight 500.
- Spacing and layout rhythm: icon-to-label gap computes to 1.99 px; the 8 px resting zone expands to 21.99 px on hover after device-pixel rounding.
- Colors and visual tokens: Plus and label use the existing `--muted` token; the existing mint trailing-line color remains intact.
- Image quality and asset fidelity: no raster assets were required; the control uses the project's existing Lucide Plus icon.
- Copy and content: `新增交通資訊` and `新增尾端交通` remain unchanged.

## Interaction And Runtime Checks

- Clicking the first insertion zone replaced the insertion controls with the existing transportation editor containing category, duration, name, notes, save, and cancel controls.
- Cancelling restored all four insertion controls.
- Browser console errors: none.
- `npm.cmd run build`: passed.
- `npm.cmd run test:e2e -- tests/mapProviderPrep.spec.js`: 39/39 passed.
- `git diff --check`: passed before publication.

## Comparison History

1. The source showed a circular green Plus surface and a larger icon-to-label gap.
2. The implementation removed the circular surface, switched to the existing Lucide Plus, tightened the gap to 2 px, and retained the full-width centered line.
3. Side-by-side visual inspection, computed-style measurements, interaction testing, and console inspection found no actionable mismatch.

## Follow-up Polish

- None required for this request; user manual verification remains welcome for personal display scaling.

final result: passed
