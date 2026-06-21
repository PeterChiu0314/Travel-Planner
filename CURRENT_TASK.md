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

## Current Phase

```text
App Layout Phase 3.2a - Timeline Workspace closeout
```

Branch:

```text
codex/app-layout-phase-3-workspace
```

Status:

```text
Phase 3.2a implementation and visual polish are nearly complete.
Only final manual verification and small Timeline-specific corrections remain before closeout.
Formal Timeline and /demo/timeline must remain visually and behaviorally aligned.
```

## Git Reference Points

- Latest pushed commit: `9b88931 tune collapsed day board layout`
- Today's earlier pushed commits:
  - `d225daf refine timeline details and map motion`
  - `5506a00 refine multi-day timeline previews`
- Current local documentation changes are not pushed yet:
  - `docs/gpt/2026-06-21-phase-3-2a-closeout-summary.md`
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

## Manual Verification

The user currently owns visual verification. Do not automatically run build/E2E for each CSS/layout tweak unless requested; provide a focused manual checklist instead.

Check both Formal Timeline and `/demo/timeline`:

1. Map expanded: confirm the 30/70 boundary and Top Row / Map alignment.
2. Map collapsed: confirm cards keep the same typography, padding, and action sizes.
3. Day Tabs: verify click, drag, momentum, arrows, first/last mask behavior, and Map open/close transitions.
4. Day Board navigation: verify half-circle buttons with and without a vertical scrollbar.
5. Day selection: verify the selected board leaves about `340px` for the previous Day Board when available.
6. Card details: verify expanded visit and transportation notes preserve line breaks and use the wider layout.
7. Icons: verify Lock, LockOpen, Pencil, Trash2, Plus, and MapPin hover/disabled/click behavior.
8. Alternatives: verify empty, created, edit, delete, and flip states.
9. Multi-Day preview: verify labels, `320px` width, `110px` visit cards, transportation alignment, and no stale focused styling.

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

1. Run the final manual visual pass using `docs/gpt/2026-06-21-phase-3-2a-closeout-summary.md`.
2. Verify Formal / Demo parity, Map animation, multiline details, Multi-Day previews, and Day Board navigation.
3. Mark Phase 3.2a completed and user-verified after the layout is accepted.
4. Commit and push the closeout documentation when the user approves.
5. Proceed to Phase 3.3 Demo Parity / Final QA only after Phase 3.2a is closed.

Keep all remaining work small, targeted, and limited to Timeline CSS or small JSX presentation changes.
