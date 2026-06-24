# App Layout Phase 3.2a Map-first Tabs Placement Summary

Date: 2026-06-19

Branch:

```text
codex/app-layout-phase-3-workspace
```

## Reference Points

- Pre-experiment rollback anchor: `d181fb3`
- Latest pushed map-first layout commit: `1141a0e`
- Work after `1141a0e` is still local unless pushed later.

## Goal

Test a Map-first Timeline Workspace layout.

When the map is expanded, the route/map area should visually own the whole right side of the workspace, including the height previously occupied by the full-width Day Tabs row. Day Tabs should only occupy the left Day Board column. When the map is collapsed, Day Tabs and the multi-day board should return to full-width behavior.

## Main Layout Changes

- Demo and Formal Timeline now both add `route-collapsed` to `.timeline-top-row` based on map state.
- `DayTabs` now receives `layoutMode` from both Demo and Formal paths.
- `.timeline-top-row` uses a two-column grid in expanded map mode.
- `.timeline-workbench` and `.timeline-top-row` were tuned so their left/map boundary can be aligned independently.
- Workspace horizontal padding was reduced from `24px` to `10px`.
- Header negative margin was adjusted from `-24px` to `-10px`.
- Timeline workbench negative edge compensation was adjusted from `-24px` to `-10px`.
- Map/route panel was lifted upward with `--timeline-map-lift` so the map surface starts under the header shadow area.

## Day Tabs Behavior

- Original drag-to-scroll behavior remains.
- Day Tabs now keep a `navRef`.
- Active tab alignment was added:
  - Day 1 resets the tab rail to `scrollLeft = 0`.
  - Last day scrolls to the far right.
  - Other days use `scrollIntoView({ block: "nearest", inline: "nearest" })`.
- Map expanded and collapsed modes both share the same Day Tabs component.

## Edge Gradient Controls

- `DayTabs` now wraps the `nav.day-tabs` with `.day-tabs-shell`.
- Left/right edge buttons were added:
  - Left button scrolls tabs left.
  - Right button scrolls tabs right.
  - Smooth scroll is used.
- Edge buttons are no longer limited to expanded map mode.
- Edge buttons now depend on actual scroll state:
  - Hide left edge when already at the left end.
  - Hide right edge when already at the right end.
- `onScroll` and `resize` update edge visibility.
- Separate collapsed-state gradients were added to reduce color mismatch with the collapsed workspace background.

## Current Edge Styling

Base edge button:

```css
.day-tabs-edge {
  width: 30px;
  color: var(--ink);
  font-size: 30px;
  font-weight: 400;
}
```

Expanded/default gradients:

```css
.day-tabs-edge.left {
  background: linear-gradient(90deg, #eaeee7 30%, #f7f9f4ad 65%, #f7f9f400 100%);
}

.day-tabs-edge.right {
  background: linear-gradient(270deg, #f4f4ed 30%, #f7f9f4ad 65%, #f7f9f400 100%);
}
```

Collapsed gradients:

```css
.day-tabs-shell.is-collapsed .day-tabs-edge.left {
  background: linear-gradient(90deg, #eaeee7 30%, #f7f9f4ad 65%, #f7f9f400 100%);
}

.day-tabs-shell.is-collapsed .day-tabs-edge.right {
  background: linear-gradient(270deg, #f4eae2 30%, rgb(244 234 226 / 72%) 65%, rgba(247, 245, 239, 0) 100%);
}
```

## Collapsed Day Board Scroll Adjustments

- `useDayBoardNavigation.scrollToDay()` now subtracts `10px` and clamps at zero:

```js
left: Math.max(0, column.offsetLeft - board.offsetLeft - 10)
```

- Purpose:
  - Clicking a Day Tab or collapsing the map scrolls to the selected Day Board with a small left breathing space.
  - Day 1 should not falsely show the left edge arrow because of the visual 10px offset.

## Collapsed Day Board Spacing Fix

The previous `:first-child` / `:last-child` approach was wrong because the active day uses CSS `order`, so DOM first child does not always match the visual first column.

Current local fix:

```css
.timeline-workbench.route-collapsed .itinerary-panel {
  padding: 0 10px;
}

.timeline-workbench.route-collapsed .itinerary-panel > :first-child {
  margin-left: 0;
}

.timeline-workbench.route-collapsed .itinerary-panel > :last-child {
  margin-right: 0;
}
```

The active Day Board padding was also reduced:

```css
.timeline-workbench.route-collapsed .timeline-day-column.active {
  padding: 10px;
}
```

## Validation Run During This Segment

Before pushing `1141a0e`:

```powershell
npm.cmd run build
git diff --check
npm.cmd run test:e2e
```

Results:

- Build passed with the existing Vite chunk-size warning.
- `git diff --check` passed with only Windows LF/CRLF warnings.
- E2E passed: `12 passed`.

After later local edge-control changes:

```powershell
npm.cmd run build
git diff --check
```

Results:

- Build passed with the existing Vite chunk-size warning.
- `git diff --check` passed with only Windows LF/CRLF warnings.

## Still Pending Locally

At the time this note was written, these files had local unpushed changes:

- `src/App.jsx`
- `src/styles.css`

This summary file is also newly added and should be committed only if the team wants to keep the handoff note in git.

## Watch Items

- Check Day Tabs alignment in both Demo and Formal pages after every map open/collapse change.
- Check first and last day behavior in collapsed map mode.
- Do not rely on `:first-child` / `:last-child` for visual edge spacing when CSS `order` is involved.
- Keep Demo and Formal wired through the same `DayTabs` component and shared CSS.
- `d181fb3` remains the known rollback point if the map-first experiment needs to be abandoned.
