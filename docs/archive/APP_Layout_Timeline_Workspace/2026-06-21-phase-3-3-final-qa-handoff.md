# App Layout Phase 3.3 - Timeline Workspace Final QA and Handoff

Date: 2026-06-21

Branch:

```text
codex/app-layout-phase-3-workspace
```

Latest pushed commit at QA start:

```text
217e2d4 add development version dialog
```

## Outcome

Phase 3.2a implementation is complete. Phase 3.3 code, Demo visual, interaction, safety, and automated QA passed without requiring another Timeline CSS or JSX correction.

The authenticated Formal Timeline visual pass was completed and accepted by the user on 2026-06-21. Formal and Demo Timeline Workspace parity is approved for merge to `main`.

## QA Results

### 1. Map Open / Close

- Demo Map-expanded and Map-collapsed states both rendered successfully.
- Map reveal and conceal use the shared `220ms` transition lifecycle.
- At a `1920 x 1080` viewport:
  - Timeline workbench width: `1650px`
  - Active Day Board width: `495px`
  - Map width: `1155px`
  - Day Board stayed below the `550px` maximum.
- Day Tabs and the Day Board / Map boundary remained aligned.
- Authenticated Formal animation smoothness was accepted by the user.

### 2. Formal / Demo Parity

- Formal and Demo both use:
  - `.timeline-top-row`
  - `.content-grid.timeline-workbench`
  - `DayTabs`
  - `ItineraryTimeline`
  - `MultiDayTimelineColumns`
  - `RoutePanel`
  - shared Timeline CSS
- No independent Demo-only Timeline card or workspace implementation was found.
- Formal signed-in visual inspection was completed by the user after Codex QA.

### 3. Multiline Notes

Demo local-state editing was used to save two-line visit and transportation notes.

- Visit expanded detail:
  - Preserved the newline in `textContent`.
  - Computed `white-space` was `pre-line`.
  - Compact summary remained `nowrap`.
- Transportation expanded detail:
  - Preserved the newline in `textContent`.
  - Computed `white-space` was `pre-line`.
  - Detail content remained inset and centered across the full transportation card grid.

### 4. Alternative Flip Control

- The `Repeat2` alternative control was present only on the expanded visit card.
- Geometry matched the visit card lower-right corner exactly:
  - Right delta: `0px`
  - Bottom delta: `0px`
  - Control size: `38 x 38px`
- Right and bottom borders were present.
- The visit card retained `overflow: hidden`, preventing a visible border gap.

### 5. Map-Collapsed Multi-Day Preview

- Five unselected Day Boards rendered for the six-day fixture.
- Unselected Day Board width: `320px`.
- Visit preview height: `110px`.
- Preview cards showed destination, compact note, type, cost / linked budget, and alternative pills when available.
- Transportation preview icon and title alignment matched the visit preview grid.

### 6. Focus Cleanup and Day Positioning

- Selecting `伏見十石舟` on Day 2, then switching to Day 1, left no focused preview styling.
- Unselected preview focused count remained `0`.
- Clicking Day 3 positioned the active board after the previous Day preview:
  - Previous Day Board width: `320px`
  - Gap: `10px`
  - Horizontal scroll position: `330px`

### 7. Day Tabs and Day Board Edge Controls

- Day Board right edge control changed horizontal scroll from `0` to `514`.
- In Map-expanded mode, Day Tabs measured:
  - Client width: `504px`
  - Scroll width: `740px`
- The right Day Tabs control scrolled from `0` to `236`.
- After scrolling, the right hint disappeared and the left hint / left-side mask appeared.
- Day Board left / right controls exposed correct disabled states.

### 8. Demo Isolation

The `DemoApp` source segment contained no references to:

- Supabase
- Auth
- `postgres_changes` / Realtime
- Storage
- `localStorage`
- `useDraftAutosave`
- `acquireEditLock`
- `releaseEditLock`

Demo Timeline explicitly passes:

```text
disableDraftAutosave
restoreDrafts={false}
useEditLocks={false}
```

No browser console warnings or errors were observed on Demo Timeline or the unauthenticated Formal login route.

## Automated Validation

Commands:

```powershell
npm.cmd run build
npm.cmd run test:e2e
git diff --check
```

Results:

```text
Build: passed
E2E: 13 passed
git diff --check: passed
```

The existing Vite chunk-size warning remains informational.

## Files Changed During Phase 3.3

No application code or Timeline CSS changes were required by Final QA.

Documentation updates:

- `CURRENT_TASK.md`
- `docs/gpt/2026-06-21-phase-3-3-final-qa-handoff.md`

`test-results/` is generated output and must not be committed.

## Authenticated Formal Sign-off

User verification completed on 2026-06-21:

1. Map open / close animation: passed.
2. Formal and Demo Map-expanded / Map-collapsed parity: passed.
3. Visit, transportation, and alternative controls: passed.
4. Multi-Day previews, Day switching, and edge controls: passed.

## Phase Closure Recommendation

- Phase 3.2a: closed, completed, and user verified.
- Phase 3.3: closed, completed, and user verified.
- Merge status: approved for merge to `main`.
- Next phase: start from the updated `main` baseline after merge.

Do not expand this handoff into Google Maps integration, route calculation, transportation insertion, sorting, drag/drop, schema work, RLS, RPC, Auth, Realtime, Draft Autosave, or Edit Lock changes.
