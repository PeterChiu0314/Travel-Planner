# Budget desktop design QA — 2026-10-22

Comparison target: selected personal-first Budget image `exec-12ef9ab4-418c-4a98-925e-9ff581265db2.png`, plus approved detail/inline previews and the user's later rules. Rendered target: authenticated Formal page `http://127.0.0.1:5175/#`, 1440×900, light theme, existing trip, statistics view.

## Iteration 1

- [P2] Toolbar split into multiple rows and repeated visible title, with 43px records, reduced density relative to the selected image. Fixed to a single desktop toolbar and 36px rows; accessible heading retained without duplicating the visible title.
- [P2] Generic button font inheritance produced 47px rows. Fixed explicit table-cell typography and padding.

## Final comparison

Reference and final capture were embedded side by side in the same comparison page and inspected together. Evidence: `budget-design-comparison.png`; individual final captures `budget-formal-desktop.png` and `budget-formal-detail.png` in `C:/Users/Administrator/.codex/visualizations/2026/10/22/01a16129-655d-7293-bb1d-e6cd4ef79294/`.

- Fonts/typography: existing app font stack retained; 13px dense table, numeric alignment and stronger per-person figures; status and secondary text remain subordinate. No image mock text is rasterized into the app.
- Spacing/layout: existing global shell unchanged, approximately 70/30 workspace, compact group headings, no large item cards or nested boards. Single toolbar and table rows reviewed after the fixes above. Focused final detail capture verifies the right panel; automated viewport checks cover mobile basic operation and both desktop widths.
- Colors/tokens: existing warm-white, gray and muted green variables retained; neutral category headers and restrained green selected/paid states replace the image generator's incidental blue and saturated chart colors.
- Images/assets: no photographic/illustration assets required. Existing brand and Lucide icon system preserved. Distribution is a native proportional data strip; no decorative or handcrafted SVG assets were substituted.
- Copy/content: `預算`/`實付`, no filler introduction, no manual phase tabs. `對照` omitted from Planning/Traveling per the final user instruction. Human average and specific-member burden have distinct labels.
- Intentional data differences: selected mock contains illustrative 3-member/24-item numbers; authenticated trip actually has 1 member/9 records. Real data retained. Exact mock totals, implied accommodation Day ranges and fictional category rows were not copied.
- Intentional chart choice: proportional category strip with amounts/percentages is used instead of adding a donut library for this one compact chart. The information and member filtering are retained. No table/chart dependency added.
- Functional checks: click selects readonly detail; double click shares the editor draft; Enter/Save persists, blur does not; Escape cancels. Right tab switching retains the draft and selected statistics viewpoint. Unknown custom data and missing snapshots have explicit states.

No unresolved P0/P1/P2 visual issues. Hosted migration/Realtime verification is a separate pending rollout requirement; no claim of production activation.

final result: passed
