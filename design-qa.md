# Phase 5.8 Sidebar Navigation Design QA

## Comparison Target

- Source visual truth: `C:/Users/ADMINI~1/AppData/Local/Temp/codex-clipboard-90e76263-3ce3-4e0f-9042-4505131608a3.png`.
- Implementation screenshot: unavailable because the in-app Browser integration is unstable in this desktop session; source contracts and production build are used before user acceptance.
- User requirement: retain the seven labels and 500 weight, align their text start with `旅程規劃室`, and keep every navigation icon centered under the TP logo instead of moving with the text.
- Implementation evidence: `tests/phase-1-8-source-guards.spec.js` verifies the labels, weight, and separate regular/compact icon-padding and label-gap contracts.
- Viewport: desktop expanded sidebar, including the compact-height rule used by the supplied screenshot.
- States checked: normal and active navigation rows; collapsed sidebar remains structurally unchanged.

## Findings

- Source-level implementation is complete. Final visual acceptance remains pending because browser capture is unavailable.

## Required Fidelity Surfaces

- Fonts and typography: all seven labels use 500 weight.
- Spacing and layout rhythm: regular desktop uses 11 px left padding plus a 19 px label gap; compact-height desktop uses 12 px left padding plus an 18 px label gap. These pairs center the 30/24 px icons under the 44/40 px TP logo while preserving the brand-heading text start.
- Colors and visual tokens: unchanged.
- Image quality and asset fidelity: no image or icon assets are changed.
- Copy and content: all seven labels match the user-provided names exactly.

## Interaction And Runtime Checks

- `npm.cmd run build`: passed.
- `git diff --check`: passed.
- Source guard contracts were updated for all labels, both icon-padding/label-gap pairs, and 500 weight; the Playwright-based source guard was not executed because browser automation was not requested for this iteration.
- Automated browser geometry and console verification remains unavailable because the in-app Browser session repeatedly reset during the preceding task.

## Comparison History

1. The source screenshot shows short legacy labels at 700 weight, with their text column starting left of the brand heading.
2. The first implementation replaced all seven labels, changed weight to 500, and moved the entire row content right, which also shifted the icons.
3. The correction moves the icons back under the TP logo and increases only the icon-to-label gap, preserving the aligned text column.
4. Post-fix manual visual acceptance is pending.

## Follow-up Polish

- Manually confirm the icon centers align with the TP logo and the text start aligns with `旅程規劃室` at the user's display scale.

final result: blocked
