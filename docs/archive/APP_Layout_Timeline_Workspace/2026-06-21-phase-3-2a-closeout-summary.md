# App Layout Phase 3.2a Closeout Summary

Date: 2026-06-21

Branch:

```text
codex/app-layout-phase-3-workspace
```

Latest pushed commit:

```text
9b88931 tune collapsed day board layout
```

## Phase Status

Phase 3.2a Timeline Workspace polish is close to completion. The remaining work should be limited to final manual visual verification and small corrective CSS or presentation changes. Formal Timeline and `/demo/timeline` continue to share the same Timeline components and CSS.

## Changes Completed Today

### Timeline Card Actions and Details

- Restyled the new-itinerary button and kept the shared `Plus + MapPin` presentation in Formal and Demo.
- Replaced transportation warning symbols with Lucide `MessageCircleWarning`.
- Replaced the alternative flip symbol with Lucide `Repeat2`.
- Kept the alternative flip action attached to the visit card's lower-right corner without adding an extra footer row or unnecessary card height.
- Moved alternative labels and linked-budget content away from the lower-right flip control.
- Preserved entered line breaks in expanded visit notes and expanded transportation notes while keeping compact card summaries single-line.
- Expanded transportation detail content across the full card grid with centered horizontal insets similar to visit-card details.
- Tuned transportation warning typography and shared pill styling.

### Map Open and Close Motion

- Added a lightweight Map reveal animation from right to left.
- Added a matching Map conceal animation before the collapsed Day Board layout is applied.
- Kept the animation duration and easing in CSS variables so a future full grid-width animation can reuse them.
- Added `prefers-reduced-motion` handling.
- This remains the simple animation version: the Map surface animates, while a future complete version may animate the Day Board and Map column widths together.

### Trip Header Polish

- Reduced Trip Header title and metadata font weights.
- Added a small metadata left offset.
- Kept Formal and Demo on the shared Trip Header styles.

### Multi-Day Day Board Preview

- Added visit type, linked budget / cost, and alternative pills to unselected Day Board cards.
- Kept destination title and compact note text visible.
- Matched unselected Day headings to the active Day's single-line Day/date layout.
- Set unselected Day Board width to `320px`.
- Set unselected visit preview cards to `110px` high with vertically centered content.
- Kept transportation previews compact and aligned their icon column and title start with the visit preview layout.
- Added transportation-preview-specific `14px` title sizing.
- Prevented unselected Day Boards from retaining the focused-card highlight after the active Day changes.

### Day Board Navigation

- Changed Day Tab automatic positioning from approximately `50px` left breathing room to `340px`.
- The selected Day now leaves enough room to preview the preceding `320px` Day Board plus spacing when available.
- Day 1 remains clamped to the left edge.
- Updated edge navigation button colors to shared paper and ink tokens.

## Validation

The following checks passed before today's pushes:

```powershell
npm.cmd run build
npm.cmd run test:e2e
git diff --check
```

Latest E2E result:

```text
12 passed
```

The existing Vite chunk-size warning remains informational.

## Final Manual Verification

Check both Formal Timeline and `/demo/timeline`:

1. Open and close the Map and confirm both reveal and conceal animations complete cleanly.
2. Confirm Map-expanded and Map-collapsed card typography remains consistent.
3. Expand visit and transportation cards and verify multiline notes retain their entered line breaks.
4. Verify the alternative flip control stays attached to the visit card's lower-right corner without a border gap.
5. Collapse the Map and verify unselected Day Boards show title, compact note, type, budget, and alternative pills.
6. Select a card on one Day, switch Days, and confirm unselected Day Boards do not retain focused styling.
7. Click Day Tabs and confirm the previous Day Board remains visible in the `340px` left preview space when available.
8. Verify Day Board edge buttons with and without a vertical scrollbar.

## Remaining Scope

- Finish the final manual visual pass.
- Make only small Timeline-specific CSS or presentation corrections if needed.
- Close Phase 3.2a after user verification.
- Proceed to Phase 3.3 Demo Parity / Final QA after Phase 3.2a is accepted.

Do not expand this closeout into Google Maps integration, route calculation, transportation insertion logic, sorting, drag/drop, database changes, or broad `src/App.jsx` architecture work.
