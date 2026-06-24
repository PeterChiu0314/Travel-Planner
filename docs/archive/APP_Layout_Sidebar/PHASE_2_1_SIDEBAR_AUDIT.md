# App Layout Phase 2.1 Sidebar Audit

## Status

Phase 2.1 audit completed.

Scope:

- Read-only audit.
- No code changes.
- No data flow changes.
- No Auth / Share / Invite / Date / Draft / Edit Lock / Realtime changes.
- No DB / RLS / RPC / migration changes.

Primary files inspected:

- `docs/PHASE_2_SIDEBAR_HANDOFF.md`
- `CURRENT_TASK.md`
- `AGENT.md`
- `docs/UX_RULES.md`
- `docs/BUGS.md`
- `src/App.jsx`
- `src/styles.css`

## Confirmed Phase 2 Direction

The following Sidebar direction is treated as accepted product direction for Phase 2:

1. Sidebar should be fixed and should not scroll with main content.
2. Header should be fixed and should not scroll with main content.
3. Workspace / editor area should become the main scroll container.
4. Nav should stay fixed near the top of Sidebar.
5. Desktop Nav should remove Settings.
6. Desktop Nav should show `總覽`; Mobile bottom nav should keep `今日`.
7. Trip list should sit below Nav.
8. `我的旅程 +` heading row should stay fixed above the trip list.
9. Create-trip entry should move to a small `+` beside `我的旅程`.
10. Only the trip-card list should scroll.
11. Empty trip list should show a soft empty box: `+ 建立第一個旅程`.
12. Trip list target sorting is most-recently-edited first.
13. Sidebar Members should be removed.
14. Sidebar bottom should become fixed account info / settings / sign out.
15. Settings should cover client-side personalization / display / account settings only.
16. Trip settings should move to Header top-right `more` icon.
17. Nav active visual should be stronger than Trip active visual.
18. Trip active should use a soft background and border.
19. Sidebar collapsed state should be completed within Phase 2.
20. Nav icon polish should be left to the final Phase 2 polish stage.

## 1. Current Sidebar Sections

Formal Sidebar is currently written inline inside `App()` in `src/App.jsx`, not as a separate `Sidebar` component.

Current Sidebar order:

1. Brand area:
   - `TP` brand mark.
   - Title: `旅程規劃室`.
   - Trip count.
   - Collapse toggle.
2. Full-width create-trip button:
   - `新增旅程`.
3. Desktop section navigation:
   - Rendered from `desktopNavItems`.
4. Trip list:
   - Rendered by `TripList`.
5. User box:
   - Sidebar `MembersPanel`.
   - Current user name / email.
   - Sign-out button.

Current JSX area:

- `Shell collapsed={isSidebarCollapsed}`
- `<aside className={...sidebar...}>`
- Brand
- Create trip button
- Section nav
- `TripList`
- `.user-box`

## 2. Sidebar JSX Component Structure

Relevant components:

- `Shell({ children, collapsed = false })`
  - Adds `app-shell` and optional `sidebar-collapsed`.
- `TripList({ trips, activeTripId, onSelect })`
  - Presentational trip-card list.
  - Calls `onSelect(trip.id)`.
- `MembersPanel({ className, isOwner, members, onApprove, onReject })`
  - Currently used inside Sidebar with `className="sidebar-members"`.
- `TripDialog`
  - Create-trip dialog opened by `isTripDialogOpen`.
- `TripHeader`
  - Owns Header member/share/date/more actions and should remain protected.

No dedicated formal `Sidebar` component exists yet.

## 3. Sidebar-Related CSS Classes

Primary layout classes:

- `.app-shell`
- `.app-shell.sidebar-collapsed`
- `.sidebar`
- `.workspace`

Sidebar structure classes:

- `.brand`
- `.brand-mark`
- `.brand-copy`
- `.sidebar-toggle`
- `.section-nav`
- `.section-nav-button`
- `.section-nav-button.active`
- `.section-nav-icon`

Trip list classes:

- `.trip-list`
- `.trip-card`
- `.trip-card.active`

User / member classes:

- `.user-box`
- `.sidebar-members`
- `.member-summary`
- `.member-avatar`

Mobile / Demo classes:

- `.bottom-nav`
- `.bottom-nav-button`
- `.bottom-nav-button.active`
- `.demo-shell`
- `.demo-sidebar`
- `.demo-workspace`

## 4. Current Scroll Ownership

Current real scroll container is the page / `body` / browser window.

Current layout behavior:

- `.app-shell` is a grid with `min-height: 100vh`.
- `.sidebar` is `position: sticky; top: 0; min-height: 100vh`.
- `.workspace` has padding but no fixed height and no `overflow-y`.
- `.trip-header` is `position: relative`, so it scrolls with content.
- `.bottom-nav` is fixed only on mobile.

This does not yet match the Phase 2 target:

- fixed Sidebar
- fixed Header
- Workspace/editor area as the main scroll container
- only trip-card list scrolls inside Sidebar

Important risk:

Changing scroll ownership can affect Header popovers, modal stacking, date popover placement, day board scrolling, and browser-level scroll expectations.

## 5. Main Nav Active State

Formal nav active state is derived from:

```js
activeSection === item.id
```

State source:

```js
const [activeSection, setActiveSection] = useState("today");
```

Desktop nav:

- Uses `desktopNavItems`.
- Button click calls `setActiveSection(item.id)`.

Mobile bottom nav:

- Uses `mobileNavItems`.
- Button click calls `setActiveSection(item.id)`.

Current section switching does not go through active editor guard. This is existing behavior and should not be changed accidentally during Sidebar UI work.

## 6. Desktop / Mobile Nav Data

Desktop and Mobile nav do not fully share one data source.

Current desktop nav:

```js
[
  { id: "today", label: "今日 / 總覽", shortLabel: "今日" },
  { id: "timeline", label: "行程", shortLabel: "程" },
  { id: "budget", label: "預算", shortLabel: "錢" },
  { id: "accommodation", label: "住宿", shortLabel: "宿" },
  { id: "todo", label: "待辦", shortLabel: "辦" },
  { id: "luggage", label: "行李", shortLabel: "李" },
  { id: "settlement", label: "結算", shortLabel: "結" },
  { id: "settings", label: "設定", shortLabel: "設" },
]
```

Current mobile nav:

```js
[
  { id: "today", label: "今日" },
  { id: "timeline", label: "行程" },
  { id: "budget", label: "預算" },
  { id: "luggage", label: "行李" },
  { id: "settings", label: "更多" },
]
```

Audit conclusion:

- Desktop should change `today` label to `總覽`.
- Desktop should remove `settings`.
- Mobile may keep `今日`.
- Mobile `settings` / `更多` needs a product decision in Phase 2 because `TripWorkspace` currently has no explicit settings mode.

## 7. Trip List / Active Trip Logic

`loadTrips()` loads trips by querying `trip_members` joined with `trips`.

Selected trip fields include:

- `id`
- `title`
- `name`
- `status`
- `destination`
- `destination_country`
- `destination_city`
- `start_date`
- `end_date`
- `owner_id`
- `updated_at`

Current sorting:

```js
.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))
```

Current active trip visual:

- `TripList` compares `trip.id === activeTripId`.
- Active card receives `trip-card active`.
- CSS uses border color and left inset shadow.

Current trip card content:

- Trip title.
- Destination and start date.
- Pending membership badge: `等待核准`.

## 8. Create Trip Entry

Current create-trip entry:

```jsx
<button className="primary-button create-trip-button" onClick={() => setIsTripDialogOpen(true)}>
  <span aria-hidden="true">+</span>
  新增旅程
</button>
```

It opens `TripDialog` via:

```js
setIsTripDialogOpen(true)
```

Audit conclusion:

- Safe to move this entry into a `我的旅程 +` heading row.
- Do not change `TripDialog` or `createTrip` data flow during Phase 2.2.

## 9. Sidebar Members Rendering And Removal Risk

Current Sidebar Members:

```jsx
<MembersPanel
  className="sidebar-members"
  isOwner={canInviteMembers}
  members={members}
  onApprove={approveMember}
  onReject={rejectMember}
/>
```

Current behavior:

- Renders only when `activeTrip` exists.
- Shows approved / total member count.
- Shows member avatars.
- Shows full member list.
- Owner can approve/reject pending members directly from Sidebar.

Phase 2 direction:

- Remove Sidebar Members.
- Header `MembersInviteDialog` remains the canonical member entry.

Removal risk:

- Do not delete `MembersPanel` component immediately.
- Only remove the Sidebar usage.
- Confirm owner pending approve/reject remains available from Header members dialog.
- Confirm Header member preview pending count remains visible for owner.

## 10. Account Info / Sign Out

Current account and sign out are already in `.user-box`:

```jsx
<strong className="nav-label">
  {session.user.user_metadata?.full_name || session.user.email}
</strong>
<button className="ghost-button" onClick={signOut}>
  登出
</button>
```

Audit conclusion:

- Existing logic is reusable.
- Phase 2 can re-layout `.user-box` into fixed Sidebar bottom.
- No Auth logic changes are needed.

## 11. Collapse Button Current Behavior

Current state:

```js
const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
```

Current toggle:

- Button title changes between `展開側欄` and `收合側欄`.
- Button text changes between `>` and `<`.
- `Shell` receives `collapsed={isSidebarCollapsed}`.

Current CSS:

- `.app-shell.sidebar-collapsed` changes grid from `300px` to `84px`.
- `.sidebar.collapsed` centers content.
- `.brand-copy`, `.nav-label`, trip meta, and member list are hidden.

Responsive behavior:

- Under `1100px`, sidebar collapse is visually undone.
- Toggle button is hidden.
- Sidebar becomes top layout instead of left rail.

Audit conclusion:

- Collapse exists but is incomplete for the Phase 2 target.
- It must be revisited after Sidebar IA and scroll ownership are updated.

## 12. Trip Sorting Fields

Current trip list has access to `trips.updated_at`.

Current behavior already sorts trips by `updated_at` descending.

## 13. Recently Edited Sorting Sufficiency

Existing data is enough for:

```text
Sort by trips.updated_at descending.
```

Existing data is not enough for:

```text
Sort by latest activity across itinerary, budget, actual expense, accommodation, todo, guide, luggage, attachments, or members.
```

If product wants true cross-table activity sorting, create a future task:

```text
Trip activity tracking / last_activity_at
```

That future task would likely require DB / RPC / trigger or mutation-path design and should not be included in Sidebar UI Phase 2.

## 14. State And Guard Risk Areas

### Active Trip

Trip switch currently goes through:

```js
selectTrip(nextTripId)
```

That function calls:

```js
requestActiveEditorGuardResolution()
```

Risk:

- TripList redesign must preserve `onSelect={selectTrip}`.
- Do not call `setActiveTripId` directly from new trip-card UI.

### Active Section

Nav directly calls:

```js
setActiveSection(item.id)
```

Risk:

- This direct behavior is existing behavior.
- Do not accidentally introduce guard behavior or remount behavior during visual refactor.

### Session Restore

Session context stores:

- `activeDay`
- `activeSection`
- `activeTripId`
- `luggageTab`

Valid sections are derived from:

```js
new Set([...desktopNavItems, ...mobileNavItems].map((item) => item.id))
```

Risk:

- Removing desktop `settings` while mobile still has `settings` keeps `settings` valid.
- `TripWorkspace` currently has no explicit settings mode, so `settings` can fall through to timeline-like content.
- This should be cleaned up deliberately in Phase 2, not accidentally.

### Draft Restore / Hidden Sections

`TripWorkspace` keeps many panels mounted behind `.hidden-section` to preserve active editor guard and draft behavior.

Risk:

- Do not rewrite `TripWorkspace` mounting strategy during Sidebar work.
- Do not convert hidden mounted panels into conditional unmounting casually.

## 15. Recommended Phase 2.2 To 2.6 Adjustment

### Phase 2.2 - Sidebar Information Architecture

Goal:

- Restructure Sidebar JSX and CSS without changing scroll ownership yet.

Recommended scope:

- Remove full-width `新增旅程` button.
- Add `我的旅程 +` heading row.
- Add trip list wrapper / shell.
- Add empty trip list state.
- Remove Sidebar Members usage.
- Rework bottom account area.
- Keep existing `TripDialog`, `TripList`, `selectTrip`, and `signOut` behavior.

Risk:

- Low to medium.
- Main risk is accidentally breaking trip switch guard or member management entry.

Validation:

- Build.
- E2E.
- Manual trip switch with dirty editor.
- Header members dialog still handles pending members.

### Phase 2.3 - Fixed Sidebar / Header / Workspace Scroll

Goal:

- Make Sidebar fixed.
- Make Header fixed.
- Make Workspace/editor area the main scroll container.
- Make only trip list scroll within Sidebar.

Risk:

- Medium to high.
- Header popovers may be clipped or visually misplaced.
- Modals and z-index may need checks.
- Day board horizontal scroll and route-collapsed behavior may be affected.

Validation:

- Header title edit.
- Destination popover.
- Date popover.
- More menu.
- Developer Date Tool.
- Active editor dialog.
- Timeline day board and route-collapsed mode.
- Mobile layout.

### Phase 2.4 - Desktop Nav Spec

Goal:

- Desktop nav `today` label becomes `總覽`.
- Desktop nav removes `settings`.
- Nav active visual becomes stronger than trip active.

Risk:

- Low.
- Session restore needs attention if `settings` remains in mobile.

Validation:

- Desktop active nav is clear.
- Mobile bottom nav remains `今日`.
- Reload restores active section.

### Phase 2.5 - Trip List Polish

Goal:

- Trip active uses soft background and border.
- Trip card names truncate/wrap cleanly.
- Empty trip list shows soft create-first-trip box.
- Trip list remains sorted by `updated_at` descending.

Risk:

- Low.
- Text overflow and responsive layout need checking.

Validation:

- Long trip names.
- Pending trip state.
- Empty trip state.
- Collapsed state preview if already implemented.

### Phase 2.6 - Collapse Completion

Goal:

- Complete collapsed Sidebar behavior after IA and scroll ownership are stable.

Recommended scope:

- Define collapsed brand.
- Define collapsed nav.
- Define collapsed trip list or active trip affordance.
- Define collapsed account/sign-out behavior.
- Ensure tooltip/title coverage for icon-only controls.

Risk:

- Medium.
- Needs desktop and tablet checks.

Validation:

- Toggle collapse.
- Active nav visible.
- Active trip still identifiable.
- Create trip still reachable.
- Account/sign-out still reachable.

### Final Polish - Nav Icons

Goal:

- Polish nav icons after layout behavior is stable.

Risk:

- Low.
- Should not block structural work.

## Safe Modification Areas

Safe for Phase 2 UI work:

- Sidebar JSX block inside `App()`.
- `TripList` markup and presentational props.
- Sidebar-related CSS.
- Desktop nav labels / items.
- Mobile nav labels / items if session restore impact is handled.
- Empty trip-list UI.
- Account area layout.
- Sidebar collapsed CSS.

## High-Risk Areas

Avoid unless explicitly scoped:

- `loadTrips()` query and data flow.
- `loadTripData()` data flow.
- Supabase mutations.
- Auth / Google OAuth.
- Share route and `ShareDialog` permissions.
- Member invite / approval mutation logic.
- `updateTripDateRange()`.
- Draft autosave utilities.
- Edit lock utilities.
- Active editor guard behavior.
- Realtime subscription behavior.
- `TripWorkspace` hidden mounted section strategy.
- Demo route auth bypass.
- DB / RLS / RPC / migrations.

## Phase 2.2 Recommended Starting Plan

Start with a small UI-only slice:

1. Keep current branch: `codex/app-layout-sidebar-phase-2`.
2. Modify only `src/App.jsx` Sidebar JSX and `src/styles.css`.
3. Add a `我的旅程` heading row with a compact `+` button.
4. Move create-trip action to that compact `+`.
5. Wrap `TripList` in a dedicated trip-list region.
6. Add empty trip-list create-first-trip state.
7. Remove Sidebar `MembersPanel` usage only.
8. Re-layout `.user-box` as account / settings / sign-out bottom area.
9. Change desktop `today` label to `總覽`.
10. Remove desktop `settings`.
11. Strengthen nav active visual and soften trip active visual.

Do not start fixed Header / Workspace scroll in the same first slice.

## Suggested Acceptance Checklist

Required commands:

```powershell
npm.cmd run build
npm.cmd run test:e2e
git diff --check
```

Manual checks:

- Formal app loads after login.
- Sidebar shows Nav, `我的旅程 +`, trip list, and bottom account area.
- Create trip dialog opens from the compact `+`.
- Trip switch still uses active editor dirty guard.
- Active trip remains visually identifiable.
- Nav active is visually stronger than trip active.
- Header members preview still opens `成員與邀請`.
- Owner can still approve / reject pending members from Header dialog.
- Editor can still open Share dialog and copy active share link.
- Viewer still cannot open Share dialog.
- `/demo/timeline` loads without authentication.
- `/demo/budget` and `/demo/luggage` navigation still works.
- Mobile bottom nav still works.
- No text overlap in Sidebar, trip cards, account area, or bottom nav.

Additional checks after fixed scroll work:

- Header remains visible while Workspace scrolls.
- Sidebar remains fixed while Workspace scrolls.
- Only trip-card list scrolls inside Sidebar when many trips exist.
- Header date popover is not clipped.
- Header destination popover is not clipped.
- Header more menu is not clipped.
- Active editor guard dialog is not clipped.
- Timeline day board scrolling still works.
