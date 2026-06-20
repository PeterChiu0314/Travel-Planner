# CURRENT_TASK.md

## Read First

- `AGENT.md`
- `docs/UX_RULES.md`
- `docs/BUGS.md`
- `docs/PHASE_3_WORKSPACE_AUDIT.md`
- `docs/gpt/2026-06-19-phase-3-timeline-workspace-polish.md`
- `docs/gpt/2026-06-19-phase-3-2a-map-first-tabs-summary.md`
- `docs/gpt/2026-06-20-phase-3-2a-timeline-workspace-summary.md`

## Current Phase

```text
App Layout Phase 3.2a - Timeline Workspace / Map-first layout polish
```

Branch:

```text
codex/app-layout-phase-3-workspace
```

Status:

```text
Map-first Timeline Workspace is implemented and under manual visual tuning.
Formal Timeline and /demo/timeline must remain visually and behaviorally aligned.
```

## Git Reference Points

- Latest pushed commit: `ed862c5 stabilize day tabs edge fades`
- Pre Map-first experiment rollback/reference anchor: `d181fb3`
- Current local work after `ed862c5` is not pushed yet.
- Expected local changes include:
  - `src/App.jsx`
  - `src/styles.css`
  - `docs/gpt/2026-06-20-phase-3-2a-timeline-workspace-summary.md`
  - `CURRENT_TASK.md`
- `test-results/` is generated output and must not be committed.

## Current Layout

- Map expanded:
  - Day Tabs only occupy the left Day Board column.
  - Route / future Map surface fills the right side from below the Header.
  - Day Board / Map ratio is approximately `30 / 70`.
  - Minimum widths are `380px` for Day Board and `420px` for Map.
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
  - Clicking a Day Tab positions the selected Day Board with about `50px` left breathing room.
- Timeline cards:
  - Map expanded and collapsed states now share the same card sizing and typography.
  - Expanded details below the divider span the full card grid with dedicated horizontal padding.
  - Empty alternative hints have a separate muted style and do not affect saved alternative titles.
- Timeline actions:
  - Lock state uses Lucide `Lock / LockOpen`.
  - Edit and delete use Lucide `Pencil / Trash2`.
  - New itinerary uses a `Plus + MapPin` icon combination.
- Formal and Demo use the same Timeline components and shared CSS for these changes.

## Manual Verification

The user currently owns visual verification. Do not automatically run build/E2E for each CSS/layout tweak unless requested; provide a focused manual checklist instead.

Check both Formal Timeline and `/demo/timeline`:

1. Map expanded: confirm the 30/70 boundary and Top Row / Map alignment.
2. Map collapsed: confirm cards keep the same typography, padding, and action sizes.
3. Day Tabs: verify click, drag, momentum, arrows, first/last mask behavior, and map open/collapse transitions.
4. Day Board navigation: verify half-circle buttons with and without a vertical scrollbar.
5. Day selection: verify the selected board keeps about 50px left spacing.
6. Card details: verify expanded information uses the wider layout and collapsed cards remain unchanged.
7. Icons: verify Lock, LockOpen, Pencil, Trash2, Plus, and MapPin hover/disabled/click behavior.
8. Alternatives: verify empty, created, edit, delete, and flip states.

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

## Out of Scope for Phase 3.2a

- Google Map API integration
- Map marker interaction
- Transportation route calculation
- Timeline Phase 4 end-of-day transportation creation
- Automatic sorting, drag/drop ordering, or transportation insertion logic

## Next Steps

1. Finish manual visual tuning for the current local Timeline changes.
2. Verify Formal / Demo parity and map expanded/collapsed behavior.
3. Commit and push the current local changes when the user approves.
4. Proceed to Phase 3.3 Demo Parity / Final QA only after the current layout is accepted.

Keep all remaining work small, targeted, and limited to Timeline CSS or small JSX presentation changes.
