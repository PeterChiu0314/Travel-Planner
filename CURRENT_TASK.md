# CURRENT_TASK.md

## Read First

- `AGENT.md`
- `docs/UX_RULES.md`
- `docs/BUGS.md`
- `docs/PHASE_3_WORKSPACE_AUDIT.md`
- `docs/gpt/2026-06-19-phase-3-timeline-workspace-polish.md`
- `docs/gpt/2026-06-19-phase-3-2a-map-first-tabs-summary.md`
- `docs/gpt/2026-06-20-phase-3-2a-timeline-workspace-summary.md`
- `docs/gpt/2026-06-21-phase-3-2a-closeout-summary.md`
- `docs/gpt/2026-06-21-phase-3-3-final-qa-handoff.md`

## Current Phase

```text
App Layout Phase 3.3 - Completed / User Verified
```

Branch:

```text
codex/app-layout-phase-3-workspace
```

Status:

```text
Phase 3.2a is completed and user verified.
Phase 3.3 Demo QA, automated validation, and authenticated Formal Timeline visual verification all passed.
Timeline Workspace Final QA is closed and approved for merge to main.
```

## Git Reference Points

- Latest pushed commit: `217e2d4 add development version dialog`
- Phase 3.2a closeout commit: `a85d368 close out phase 3.2 timeline polish`
- Final QA baseline: `217e2d4 add development version dialog`
- Final handoff: `docs/gpt/2026-06-21-phase-3-3-final-qa-handoff.md`
- `test-results/` is generated output and must not be committed.

## Current Layout

- Map expanded:
  - Day Tabs only occupy the left Day Board column.
  - Route / future Map surface fills the right side from below the Header.
  - Day Board / Map ratio is approximately `30 / 70`.
  - Minimum widths are `380px` for Day Board and `420px` for Map.
  - Day Board maximum width is `550px`; additional wide-screen space belongs to the Map.
- Map collapsed:
  - Day Tabs and multi-day Day Board use the full workspace width.
  - Horizontal scrolling belongs to the inner Day Board rail.
  - Left/right navigation uses scrollbar-aware edge half-circle buttons.
- Workspace owns no competing outer Timeline scroll; Day Board owns its internal scrolling.
- Demo uses the full six-day Kyoto/Biwako fixture from `src/demo-kyoto-trip.json`.

## Recent Completed Polish

- Day Tabs:
  - Drag, momentum, click selection, smooth arrow scrolling, and active-tab alignment are preserved.
  - Edge fading uses `mask-image` / `-webkit-mask-image`, not background-color overlays.
  - First day only fades on the right, last day only fades on the left, middle positions fade on both sides.
- Day Board navigation:
  - Edge buttons use Lucide chevrons and attach to the viewport/workspace edge.
  - The right button detects vertical scrollbar width and does not cover the scrollbar.
  - Clicking a Day Tab leaves about `340px` on the left so the previous `320px` Day Board remains available as a quick preview when possible.
- Timeline cards:
  - Map expanded and collapsed states now share the same card sizing and typography.
  - Expanded details below the divider span the full card grid with dedicated horizontal padding.
  - Expanded visit and transportation notes preserve entered line breaks.
  - Transportation details use the full card grid with centered horizontal insets.
  - Empty alternative hints have a separate muted style and do not affect saved alternative titles.
- Timeline actions:
  - Lock state uses Lucide `Lock / LockOpen`.
  - Edit and delete use Lucide `Pencil / Trash2`.
  - New itinerary uses a `Plus + MapPin` icon combination.
- Map motion:
  - Map reveal and conceal use a lightweight `220ms` animation.
  - The future complete animation may coordinate Day Board and Map grid widths.
- Multi-Day preview:
  - Unselected Day Boards show destination title, compact note, type, budget/cost, and alternative pills.
  - Unselected Day Boards are `320px` wide and visit previews are `110px` high.
  - Unselected Day Boards never retain focused-card styling.
- Formal and Demo use the same Timeline components and shared CSS for these changes.

## Phase 3.3 QA Result

Completed in Demo and source / render-path audit:

1. Map-expanded and Map-collapsed layout rendered without console errors.
2. Visit and transportation multiline notes preserved line breaks.
3. Alternative flip control matched the visit card lower-right corner with no border gap.
4. Multi-Day preview sizes, metadata, transportation alignment, and focus cleanup passed.
5. Day Tabs and Day Board edge controls scrolled and updated their edge states correctly.
6. Demo remained isolated from Supabase, Auth, Realtime, Storage, Draft Autosave, and Edit Lock.
7. Build passed; E2E passed `13/13`; `git diff --check` passed.

Authenticated Formal Timeline manual sign-off completed by the user on 2026-06-21:

1. Map open / close animation accepted.
2. Formal Map-expanded and Map-collapsed layout accepted.
3. Visit, transportation, and alternative controls accepted.
4. Multi-Day previews, Day switching, and edge controls accepted.

## Protected Scope

Do not modify unless explicitly requested:

- Supabase schema, migrations, RLS, or RPC
- Auth / Google OAuth
- Realtime subscriptions
- Draft Autosave or Edit Lock behavior
- Share / Invite / member data flow
- Timeline data model
- Transportation pair, warning, or route logic
- Budget data flow
- `.hidden-section` mounting strategy
- Broad `src/App.jsx` architecture
- Global `.panel` or `.content-grid` behavior without a Timeline-specific selector

## Out of Scope for Phase 3.3

- Google Map API integration
- Map marker interaction
- Transportation route calculation
- Timeline Phase 4 end-of-day transportation creation
- Automatic sorting, drag/drop ordering, or transportation insertion logic

## Next Steps

1. Merge `codex/app-layout-phase-3-workspace` into `main`.
2. Push the verified merge to `origin/main`.
3. Start the next project phase from the updated `main` baseline with a new handoff.

Keep all remaining work small, targeted, and limited to Timeline CSS or small JSX presentation changes.
