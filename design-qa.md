# Phase 5.8 Transport Insertion Control Design QA

## Comparison Target

- Current visual: `C:/Users/ADMINI~1/AppData/Local/Temp/codex-clipboard-9a533b9a-a161-4187-a8e2-cc4560fef933.png`.
- Prior visual reference: `C:/Users/ADMINI~1/AppData/Local/Temp/codex-clipboard-5d35fc69-6176-4b62-ab06-9b0fd931f898.png`.
- User requirement: retain the centered insertion affordance and broad edge trigger, use an 18 px borderless deep-gray ghost surface at `.06` opacity with 2 px clearance above and below, and end the trailing line 20 px from the right edge.
- Implementation evidence: `tests/phase-1-7f-smoke.spec.js` verifies rendered geometry and edge activation in Chromium.
- Viewport: local Demo Timeline desktop, 1280 x 720; focused comparison uses the visible insertion row.
- States checked: 4 px resting gap, upper-card edge hover, expanded hover, collapsed reset, and lower-card edge hover.

## Findings

- No remaining P0, P1, or P2 mismatch.
- The resting card gap remains 4 px while a transparent pseudo-element extends the hit target 4 px into each adjacent card.
- The expanded card gap and insertion control both compute to 22 px; the trailing line sits 1 px below the geometric center and ends 20 px from the card's right edge.
- The ghost surface matches the visit-card width, computes to 18 px high with 2 px clearance above and below, and uses borderless, shadowless `rgba(36, 43, 38, .06)`.
- The 13 px Lucide Plus begins within 4 px of the preceding visit's time text, followed by the existing 2 px label gap and 13 px, 500-weight copy.

## Required Fidelity Surfaces

- Fonts and typography: insertion copy and Plus are both 13 px; copy uses weight 500.
- Spacing and layout rhythm: the 4 px resting layout expands to a 22 px card gap containing an 18 px ghost surface with 2 px top and bottom clearance; the 12 px effective trigger band overlaps each card edge by 4 px.
- Colors and visual tokens: Plus and label use `--muted`; the mint trailing line remains intact; the ghost card is translucent deep gray without border or shadow.
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
3. The next polish shifted the trailing line down 1 px, switched the ghost surface to borderless deep gray, and reduced the label and Plus to 13 px.
4. The current polish reduces the ghost surface to 18 px with 2 px card clearance, lowers its alpha to `.06`, and increases the trailing line's right clearance to 20 px.
5. Rendered geometry, both edge triggers, source contracts, and production build now pass.

## Follow-up Polish

- None required for this request; user manual verification remains welcome for personal display scaling.

final result: passed
