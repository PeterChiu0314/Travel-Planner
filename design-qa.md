# Phase 5.8 Sidebar Navigation Design QA

## Comparison Target

- Source visual truth: `C:/Users/ADMINI~1/AppData/Local/Temp/codex-clipboard-90e76263-3ce3-4e0f-9042-4505131608a3.png`.
- Implementation screenshot: unavailable because the in-app Browser integration is unstable in this desktop session; source contracts and production build are used before user acceptance.
- User requirement: replace all seven expanded-sidebar navigation labels, use 500 font weight, and align their text start with `旅程規劃室`.
- Implementation evidence: `tests/phase-1-8-source-guards.spec.js` verifies the labels, regular desktop padding, compact-height padding, and weight contracts.
- Viewport: desktop expanded sidebar, including the compact-height rule used by the supplied screenshot.
- States checked: normal and active navigation rows; collapsed sidebar remains structurally unchanged.

## Findings

- Source-level implementation is complete. Final visual acceptance remains pending because browser capture is unavailable.

## Required Fidelity Surfaces

- Fonts and typography: all seven labels use 500 weight.
- Spacing and layout rhythm: the text column uses 20 px left button padding in both regular and compact-height desktop rules, matching the brand-heading start after accounting for icon sizes and gaps.
- Colors and visual tokens: unchanged.
- Image quality and asset fidelity: no image or icon assets are changed.
- Copy and content: all seven labels match the user-provided names exactly.

## Interaction And Runtime Checks

- `npm.cmd run build`: passed.
- `git diff --check`: passed.
- Source guard contracts were updated for all labels, both padding rules, and 500 weight; the Playwright-based source guard was not executed because browser automation was not requested for this iteration.
- Automated browser geometry and console verification remains unavailable because the in-app Browser session repeatedly reset during the preceding task.

## Comparison History

1. The source screenshot shows short legacy labels at 700 weight, with their text column starting left of the brand heading.
2. The implementation replaces all seven labels, changes weight to 500, and moves the expanded text column right by 10 px in regular desktop and 12 px in compact-height desktop.
3. Post-fix manual visual acceptance is pending.

## Follow-up Polish

- Manually confirm the text start aligns with `旅程規劃室` at the user's display scale.

final result: blocked
