# Luggage search/progress and same-row editing QA — 2026-10-23

final result: passed

## Source and comparison evidence

- Approved reference: C:/Users/PeterChiu/.codex/generated_images/01a14c95-d406-7d33-b655-0a2c9de1460d/exec-d416116a-3cd4-4500-b21d-5c3ff0ce3b73.png (1586×992).
- Scope: the user's five refinements — search icon after personal已打包; reveal search only on request; number-only progress with long rounded tracks; same-row editor with name/category/trash. Preserve the existing60:40 workspace and member-grouped single-stage packing.
- Implementation: http://127.0.0.1:5174/demo/luggage, first Demo trip, light theme, all statuses, 現金錢包 in edit mode with unchanged value. Actual40 private/20 shared fixtures retained.
- Evidence directory: C:/Users/PeterChiu/.codex/visualizations/2026/10/18/01a14c95-d406-7d33-b655-0a2c9de1460d/
- Actual desktop: luggage-row-edit-desktop.png, 1440×900 CSS/pixels, deviceScaleFactor1.
- Full comparison: luggage-row-edit-comparison.png, 2880×924; source uniformly normalized to1439×900 beside actual1440×900, with24px caption strip. Opened together and reviewed.
- Focused comparison: luggage-row-edit-focus-comparison.png; source and actual editor plus neighbouring rows cropped and uniformly scaled for legibility, then opened together.
- Other states: luggage-search-open-desktop.png, luggage-row-edit-mobile.png (390×844). Mobile is a usability check; no mobile reference was supplied.
- Existing in-app Browser inspected; unchanged cash-wallet row opened as an edit-state preview and tab retained. Repository Playwright used for repeatable tests/captures, authorized by the task; separate Browser plugin unavailable.
- Prior report preserved in docs/qa/2026-10-23-luggage-member-design-qa.md.

## Findings and disposition

No actionable P0/P1/P2 visual differences remain in this scoped comparison.
- The implementation removes the top search spacer, positions the magnifier directly after the third personal status tab, and keeps expanded search on that line without shifting list contents.
- The editor retains the exact existing desktop36px row with28px fields; adjacent rows do not move. Mobile retains the normal45px outer row (44px child target plus existing separator). No expanded background, field captions or action toolbar.
- Counts are visible without wording; progress track/fill both have rounded ends. Desktop width120px, constrained80px on narrow desktops; phone90px,4px tall.
- Accepted project constraints: established compact13px body/11px metadata and current22px desktop headings remain rather than copying the generated mock's enlarged text. Existing app shell and actual60:40 grid retained. The generated reference approximates spacing; no pixel-identity claim.
- Existing team依負責人分組/打包 alignment label remains; no extra feature or owner-confirmation UI added.

## Fidelity surfaces

- Typography: existing system font, weights and hierarchy preserved. No new font/package; compact metadata stays subordinate. Same-row input remains legible; names can scroll inside input without growing rows.
- Spacing/layout: one main scroll container per column, no nested assigned scroll or cards. Editor only swaps row content. Both status rows maintain height with search open. Exact60:40 grid unchanged.
- Colors/tokens: warm-white base, muted primary green, gray ink and neutral separators. Only field border changes on focus; no black outline/halo. Trash uses the existing error color.
- Assets/icons: existing TP identity and Lucide magnifier/close/trash retained. Member initials remain actual text identity; no generated raster asset required. No fake decorative images.
- Copy/content: no打包/成員已打包 progress prefixes, but accessible progress labels remain. Actual counts and item names preserved. Save/Cancel captions are absent from rows; native input title describes Enter/Escape.
- Interactions: Enter saves; composition Enter does not submit. Escape closes an open menu first, then uses the existing dirty-edit confirmation. Blank-space blur saves; portal menus, other controls/Quick Add and document backgrounding do not trigger it. Failures retain the editor/draft; deleting asks confirmation. Current controller/draft/RPC adapters remain.
- Responsive/accessibility: desktop1440, tablet820, phone390/360 tested; no horizontal overflow. Phone team can use the same query through one visible search instance. Icon buttons are labelled, with expanded state/focus restoration. Keyboard list and checkbox indicators retained.

## Validation

- Playwright55/55 passed(25.6s): original luggage and workspace regressions plus6 new cases for search expansion/clearing/placement, progress geometry, identical row height, dropdown interaction, background saving, IME, failure retention, delete confirmation and mobile assignment. Existing private/trip isolation, optimistic conflict, two-page simulated sync and local draft restoration pass.
- Initial validation failures were outdated test selectors for the removed header, a nonexistent Cancel action in the existing two-choice guard, and a text-only locator that disappeared when a row became an input. Selectors updated to verify actual new behavior; no guard or data flow changed to satisfy tests.
- Final Build and diff check pass; pre-existing bundle-size advisory only.
- Screenshot run: correct page/meaningful content, no runtime error or framework overlay. Demo isolation tests report no backend or draft/lock traffic.
- At QA time no schema/RLS/RPC migration, hosted write, push, merge or deployment was performed. For later user-authorized Git publication, see CURRENT_TASK.md. Real authenticated Supabase Realtime and physical phone keyboards remain unverified.

## Manual acceptance / follow-up

- Review the compact edit feel, keyboard Enter/Escape and mobile keyboard Done behavior.
- Validate real multi-account collaboration before rollout; simulated sync does not prove hosted Realtime.
- Optional P3: tune small-screen search input width after actual-device feedback.
- Implementation checklist complete for all five requested refinements.
