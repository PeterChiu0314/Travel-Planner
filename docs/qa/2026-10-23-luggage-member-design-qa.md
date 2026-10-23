# Luggage selected design QA — 2026-10-23

final result: passed

## Target and evidence

- Source: C:/Users/PeterChiu/.codex/generated_images/01a14c95-d406-7d33-b655-0a2c9de1460d/exec-f94a8f25-efae-42c1-b132-be20157d2cb5.png (1586×992).
- Source interpretation: option3 overall, option2 team member grouping. Later explicit user overrides require an exact 60:40 personal/team ratio and removal of owner confirmation. These override the generated concept's approximate ratio and remaining confirmation column.
- Implementation: http://127.0.0.1:5174/demo/luggage, light theme, first Demo trip, all statuses, no active editor, 40 private +20 canonical shared items (4 assigned to the current member). Existing trip header/sidebar preserved.
- Evidence folder: C:/Users/PeterChiu/.codex/visualizations/2026/10/18/01a14c95-d406-7d33-b655-0a2c9de1460d/
- Final desktop: luggage-selected-desktop-final.png, 1440×900 CSS/pixels, deviceScaleFactor1.
- Full-view comparison: luggage-selected-comparison.png, 2880×924. Source uniformly normalized to 1439×900 beside the actual1440×900 capture; only a24px annotation strip added. The comparison was opened and visually reviewed together.
- Focused comparison: luggage-selected-personal-comparison.png shows actual source/implementation crops together, examining headings, controls, chips, public tags and row text. Crop normalization is for readability, not a pixel-identity claim.
- Responsive evidence: luggage-selected-mobile-final.png (390×844), luggage-selected-mobile-team-final.png (390×900). No supplied mobile visual target; these are usability checks rather than fidelity comparisons.
- In-app Browser was inspected and its existing luggage tab kept open. Repository Playwright supplies repeatable E2E/captures, as explicitly requested in the task; the separate Browser plugin is unavailable.
- Previous Budget report preserved in docs/qa/2026-10-22-budget-design-qa.md.

## Comparison history and findings

1. Initial capture luggage-selected-desktop.png: [P2 typography] inherited workspace heading styles weakened the intended column hierarchy; category labels inherited excessive weight. Public tags sat after names instead of beside the checkbox. Fixed explicit22px desktop/18px phone headings, neutral400-weight category labels and public tags before names. Removed the redundant assigned-section heading.
2. Final capture and combined comparisons listed above were opened after the fixes. Heading hierarchy and flat list organization now follow the selected design. No actionable P0/P1/P2 remains in the scoped comparison.

## Required fidelity surfaces

- Typography: existing Travel Studio system font preserved, desktop titles22px/600, body13px, category labels11px/400. This intentionally uses the project's compact text rhythm rather than reproducing the mock's enlarged/bold row typography. Item names truncate on desktop, wrap on phones; full name remains accessible via the edit button label/title.
- Spacing/layout: measured column widths688.796875/459.203125 at1440px establish60:40 (sidebar excluded). Flat36px rows, one thin column divider, no nested cards. Team groups show one initial/name/count header, then item/packing rows. Own group first, unassigned last. Independent desktop scroll, no assigned subsection scrollbar; mobile uses the page/workspace scroll.
- Colors/tokens: existing warm-white surface, gray ink, primary muted green and neutral borders retained. Chips/status underline use the same primary token. Packed rows have a checked box and subdued strikethrough; completion never depends on legacy owner confirmation.
- Assets/icons: existing TP brand and Lucide library retained. Member disks display actual member initials as text identity, with no photo placeholders or generated decorative assets. No image assets are required for the selected functional UI.
- Copy/content: actual60-item fixtures retained rather than copying invented mock counts. Explicit未打包/已打包 wording replaces ambiguous完成; 未指派 filter is useful for team assignment. Owner-confirmation controls, progress, filters and waiting text are absent by the user's later decision. Existing個人行李 label retained for consistency with mobile navigation.
- Responsive: 360/390/820/1101/1280/1440 widths measured with no horizontal overflow; shared Quick Add name widths86/116/546/98.6/148.2/212.2px respectively. Phone checkbox/add controls44px. Metadata captions remain visible; a long name scrolls within its input rather than expanding the layout.
- Interaction/accessibility: separate checkboxes and edit buttons; labelled status/category button groups with pressed state; private region, keyboard list focus, editable dropdown focus borders, disabled foreign-assignee packing and project4px scrollbars preserved.

## Validation and boundaries

- Relevant Playwright49/49 passed (1.6m): privacy/trip filtering, all approved roles, packing without owner confirmation (including legacy confirmed=false), unpacking sync, rename/reassignment resets, member regrouping, category chips, two-page simulated sync, stale conflicts, draft reload, Quick Add and inline edit, empty/long/touch/Demo isolation and other workspace regressions.
- After the final heading/CSS cleanup: responsive/density/ratio/Demo/touch subset9/9 passed (27.6s).
- Final production Build passed, existing bundle-size advisory only. Diff check passed.
- Browser screenshots/measurement run found no runtime errors. Demo E2E found no backend/draft/lock traffic.
- No schema/RLS/RPC/dependency change or hosted writes. Historical confirmed_by_owner and guarded legacy RPC/service support remain for compatibility; the current UI neither reads it nor sends that patch.
- Hosted authenticated Supabase Realtime/RLS and physical phone keyboards have not been revalidated. Existing prepared collaboration migration remains a deployment prerequisite.

## Acceptance and follow-up

- Manually review the chosen visual balance, long-list wheel/touch feel and subtle editor contrast.
- Validate real authenticated multi-account collaboration before production rollout.
- [P3] Optional future polish: tune the progress meter length and typography after user acceptance. No extra feature, template/category management or sorting UI added.
- Implementation checklist complete: exact ratio, member grouping, single-stage packing, synchronized projections, responsive and draft regression checks.
