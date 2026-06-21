# App Layout Phase 3 Timeline Workspace Polish Recap

Date: 2026-06-19

Branch:

```text
codex/app-layout-phase-3-workspace
```

## Scope

This note summarizes the later Phase 3 Timeline Workspace polish work.

The work stayed focused on UI/layout only. It did not add Google Maps API integration, transportation creation logic, drag/drop sorting, route calculation, Supabase schema changes, RLS changes, RPC changes, Share changes, or Invite/member data-flow changes.

## Demo Data

- Added `src/demo-kyoto-trip.json` from the exported Kyoto/Biwako test trip JSON.
- Updated Demo Timeline seed data to use the exported trip fixture instead of the old sample data.
- Demo now uses the full 6-day Kyoto/Biwako timeline:
  - Trip dates: `2027-04-05` to `2027-04-10`
  - Timeline items: 41
  - Items by day: 7 / 7 / 7 / 6 / 5 / 9
- Kept this Demo-only. Formal app data still comes from Supabase.
- Updated the Demo smoke expectation to match the new fixture.

## Demo / Formal Layout Drift

- Removed the old Demo-only workspace grid behavior.
- Reason: Demo Timeline had a different layout model from the formal workspace, causing Header / Day Tabs spacing issues that did not reproduce on other pages.
- Result: Demo workspace now follows the same normal workspace flow as the formal page more closely.

## Map Placeholder / Route Panel

- Added a `route-panel` class to `RoutePanel` so Timeline-specific map placeholder styling can target only the route panel.
- Changed the right-side map placeholder from a card-like panel into a full-height map surface.
- Extended the route-grid background across the full future map area.
- Kept route stops rendered as an overlay on the placeholder grid.
- Adjusted the right map area to reach the right and bottom viewport edge.

## Workspace Scroll Ownership

- Timeline active state hides the outer workspace vertical scroll.
- Vertical scrolling belongs to the inner Day Board area.
- In map-collapsed mode, horizontal scrolling belongs to the Day Board rail.
- The intended behavior is:
  - Header remains at the top.
  - Day Tabs remain visible below Header.
  - Day Board owns its internal vertical scrolling.
  - Map-expanded and map-collapsed modes avoid competing outer scrollbars.

## Height Tuning

- Map-expanded Timeline workspace uses viewport-based height and negative right/bottom margins to fit the desktop workspace.
- Formal Timeline needed an override because its render path includes `TripWorkspace` / `.trip-editor`, while Demo Timeline is flatter.
- Current formal override:

```css
.trip-editor:has(.timeline-workbench:not(.hidden-section)) {
  gap: 0px;
}

.app-shell-workspace .trip-editor:has(.timeline-workbench:not(.hidden-section)) .timeline-workbench {
  height: calc(100dvh - 150px);
  max-height: calc(100dvh - 150px);
}
```

## Day Tabs

- Restyled Day Tabs:
  - Height: 36px
  - Width: 120px
  - Text format: `Day 1 · 4/5`
  - `Day N` weight: 800
  - Date weight: 500
  - Font size: 14px
- Changed map toggle to an icon-only 36x36 button:
  - Collapsed map state uses the map icon for show map.
  - Expanded map state uses the route icon for hide map.
- Implemented horizontal drag for Day Tabs with light momentum.
- Fixed click behavior after drag work:
  - Normal click still changes day.
  - Dragging more than the threshold scrolls the tab rail and suppresses accidental day switching.
- Fixed the formal page top row so many Day Tabs cannot push the map toggle button outside the viewport.

## Map-Collapsed Day Board Rail

- Removed padding from the scroll container itself so scrollbars can sit at the viewport edge.
- Added spacing on the first and last child instead:

```css
.timeline-workbench.route-collapsed .itinerary-panel > :first-child {
  margin-left: 10px;
}

.timeline-workbench.route-collapsed .itinerary-panel > :last-child {
  margin-right: 10px;
}
```

- Reason: padding on the scroll container pushes the scrollbar inward; margin on children gives visual breathing room without moving the scrollbar.

## Reverted Experiment

- Tried extending the Header glass/blur background down behind Day Tabs.
- Reverted that experiment.
- Current state keeps Day Tabs outside Header without adding a separate tinted or blurred tabs background.

## Validation Notes

- Earlier in this segment, build, targeted Demo smoke, and `git diff --check` were run after the larger Demo fixture / workspace changes.
- Later visual tuning was intentionally left for manual browser verification per user instruction.
- `git diff --check` passed before later pushes with only Windows LF/CRLF warnings.

## Watch Items

- Timeline workspace height is still visual-tuning sensitive because Demo and Formal render paths are not identical.
- If future layout work continues, prefer reducing Demo/Formal wrapper differences rather than adding more independent Demo-only layout CSS.
- Avoid placing Day Tabs inside Header unless explicitly redesigning Header ownership.
- Keep map placeholder work as CSS/JSX-only until actual Google Map integration is scoped.
