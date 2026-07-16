# Phase 5.8 Transport Insertion Control Design QA

## Comparison Target

- Current visual: `C:/Users/ADMINI~1/AppData/Local/Temp/codex-clipboard-156ac50f-d2a7-4d7c-954b-8fc1d03f8bea.png`.
- Prior visual reference: `C:/Users/ADMINI~1/AppData/Local/Temp/codex-clipboard-5d35fc69-6176-4b62-ab06-9b0fd931f898.png`.
- User requirement: center the complete insertion affordance within the expanded card gap, restore a faint full-card-width ghost surface, align the Plus/label start with the visit time column, and allow activation from about 4 px inside either adjacent card edge.
- Implementation evidence: `tests/phase-1-7f-smoke.spec.js` verifies rendered geometry and edge activation in Chromium.
- Viewport: local Demo Timeline desktop, 1280 x 720; focused comparison uses the visible insertion row.
- States checked: 4 px resting gap, upper-card edge hover, expanded hover, collapsed reset, and lower-card edge hover.

## Findings

- No remaining P0, P1, or P2 mismatch.
- The resting card gap remains 4 px while a transparent pseudo-element extends the hit target 4 px into each adjacent card.
- The expanded card gap and insertion control both compute to 22 px, with control, line, and gap centers within 1 px.
- The ghost surface matches the visit-card width and uses `rgba(255, 255, 255, .58)` with a very light border and shadow.
- The 14 px Lucide Plus begins within 4 px of the preceding visit's time text, followed by the existing 2 px label gap and 500-weight copy.

## Required Fidelity Surfaces

- Fonts and typography: insertion copy remains 14 px and now uses weight 500.
- Spacing and layout rhythm: the 4 px resting layout expands to 22 px without vertical center drift; the 12 px effective trigger band overlaps each card edge by 4 px.
- Colors and visual tokens: Plus and label use `--muted`; the mint trailing line remains intact; the restored ghost card is faint gray-white.
- Image quality and asset fidelity: no raster assets were required; the control uses the project's existing Lucide Plus icon.
- Copy and content: `新增交通資訊` and `新增尾端交通` remain unchanged.

## Interaction And Runtime Checks

- Moving the pointer 3 px inside the lower edge of the preceding visit expands the control.
- Moving the pointer 3 px inside the upper edge of the following visit also expands the control after a collapse reset.
- Existing click wiring remains unchanged and still opens the transportation editor.
- Browser console errors: none.
- `npm.cmd run build`: passed.
- `npm.cmd run test:e2e -- tests/mapProviderPrep.spec.js`: 39/39 passed.
- `git diff --check`: passed before publication.

## Comparison History

1. The first polish removed the circular Plus surface and tightened the icon-to-label gap, but its `8px / -8px` geometry placed the revealed line below the expanded gap center and left the lower card edge difficult to trigger.
2. The corrected implementation uses `4px / -4px` resting geometry, a separate 4 px edge-overlap hit target, a 22 px centered expanded row, and a restored full-width ghost surface.
3. Rendered geometry, both edge triggers, source contracts, and production build now pass.

## Follow-up Polish

- None required for this request; user manual verification remains welcome for personal display scaling.

final result: passed
