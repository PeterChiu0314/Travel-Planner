# CURRENT_TASK.md

## Read First

- `AGENT.md`
- `docs/UX_RULES.md`
- `docs/BUGS.md`
- `docs/gpt/timeline-phase-4-plan.md`
- `docs/gpt/2026-06-21-phase-4-2-destination-package-analysis.md`
- `docs/gpt/2026-06-21-phase-4-2c-drag-insert-reorder-analysis.md`
- `docs/gpt/2026-06-22-phase-4-2c-closeout-handoff.md`

## Current Phase

```text
Timeline Phase 4.2c - Completed / Production RPC QA Passed
```

Next phase:

```text
Timeline Phase 4.3 - Timed Visit Breaks Existing Transportation Pair Prompt
```

Branch:

```text
codex/timeline-phase-4-0-to-4-2
```

Latest pushed commit before the local 4.2c implementation:

```text
d2d1e78 Analyze Timeline Phase 4.2c insert reorder
```

The Phase 4.2c implementation and this documentation closeout are currently local working-tree changes. Do not describe them as committed or pushed until Git confirms that state.

## Completed Scope

### Phase 4.0

- Completed Phase 4 analysis, protected-scope review, data-flow audit, and handoff plan.

### Phase 4.1

- Added valid tail transportation cards with `to_item_id = null`.
- Added next-visit default start time from previous end time plus tail transport duration.
- Rounded the suggestion upward to the next five-minute UI step without restricting arbitrary transport duration.
- Kept the suggested time editable.
- Kept transportation shortage warning-only.
- Preserved Formal/Demo parity.

### Phase 4.2a and 4.2b

- Defined destination-package fields and child relationship behavior.
- Applied immutable Production migration `019_swap_itinerary_destination_packages.sql`.
- Kept visit IDs/time slots fixed while swapping destination packages atomically.
- Retained 019 for compatibility.

### Phase 4.2c

The final user-facing drag behavior is insertion-style destination-package reorder:

- Timed visit content is inserted before/after another timed visit package.
- Visit row IDs and `start_time` / `end_time` slots do not move.
- `sort_order` is not changed and no generic sorting architecture was added.
- Upper card half inserts before; lower half inserts after.
- No-op drops do not show confirmation or call the RPC.
- Transportation cards and untimed visits are not draggable or valid targets.
- Any fixed timed visit, active foreign lock, or active editor blocks reorder.
- Confirmation explains fixed time ranges and deletion of invalidated normal/tail transports.
- Alternatives and linked budget rows follow their destination packages.
- Existing transport is preserved only when its original package relationship remains valid.
- Invalidated transport is deleted; no replacement transportation is generated.
- Transport review snapshots remain unchanged.
- Demo uses the same pure planning rules with local React state only.

## Production Migration State

Applied immutable migrations:

```text
019 / 20260621131905 / swap_itinerary_destination_packages
020 / 20260622130246 / reorder_itinerary_destination_packages
021 / 20260622131013 / fix_reorder_baseline_count
project: lqvuqamzmchepgxkftcw
```

020 RPCs:

- `app_private.reorder_itinerary_destination_packages(...)`
- `public.reorder_itinerary_destination_packages(...)`

Security state:

- Private implementation is `SECURITY DEFINER` with explicit `search_path`.
- Private execute permission is revoked from frontend roles.
- Public wrapper is executable by `authenticated`, not `anon`.
- Private implementation rechecks `auth.uid()` and trip edit permission.
- The Supabase advisor warning for an authenticated security-definer wrapper is intentional for this narrow RPC pattern.

Important:

- Never edit applied migrations 019, 020, or 021 in place.
- Any future schema/RPC/permission correction must use migration 022+.
- The current drag UI calls the 020 reorder RPC, not the 019 swap RPC.

## Formal QA Completed

Production transaction QA used isolated fixture rows and ended with `ROLLBACK`.

Verified:

- `A B C D -> B C A D`.
- Slot IDs and time ranges remained unchanged.
- Alternatives and linked budget rows followed destination packages.
- Budget link IDs and `created_at` remained unchanged.
- Still-adjacent `B -> C` transport was preserved and remapped.
- Invalidated `A -> B` and `C -> D` transports were deleted.
- Valid tail transport was preserved when its package remained last.
- Review snapshots remained unchanged.
- Visit `updated_at` values refreshed.
- Fixed, foreign-lock, stale-baseline, and wrong-manifest requests rejected with full rollback.
- No Production QA fixture data remained.

## Demo and Automated QA Completed

- Demo insertion drag and adjacent no-op paths passed.
- Demo emitted no Supabase/Auth/Realtime/Storage/Draft/Edit Lock requests.
- Shared planner tests cover insertion normalization, package movement, alternatives, budget links, normal/tail transport preservation/deletion, untimed exclusion, fixed state, and migration security contracts.

Latest checks:

```text
npm.cmd run build       passed
npx.cmd playwright test passed 32/32
git diff --check        passed
```

The Vite build still reports the existing large-chunk warning; it is not a Phase 4.2c regression.

## Changed Files in the Local 4.2c Worktree

- `src/App.jsx`
- `src/lib/destinationPackages.js`
- `src/styles.css`
- `tests/phase-1-7f-smoke.spec.js`
- `tests/phase-4-2c-reorder.spec.js`
- `supabase/migrations/020_reorder_itinerary_destination_packages.sql`
- `supabase/migrations/021_fix_reorder_baseline_count.sql`
- `docs/gpt/timeline-phase-4-plan.md`
- `CURRENT_TASK.md`
- `docs/gpt/2026-06-22-phase-4-2c-closeout-handoff.md`

`test-results/` is generated and untracked. Do not commit it.

## Protected Scope Preserved

Phase 4.2c did not redesign:

- Auth / Google OAuth
- Realtime subscription architecture
- Draft Autosave or Edit Lock behavior
- Share / Invite / member flow
- Budget core data flow
- global `.panel` or `.content-grid`
- Google Map API or route calculation
- generic drag/drop ordering or `sort_order` schema
- Demo isolation

## Residual Risks

- The reorder RPC takes a trip/day advisory transaction lock, but unrelated writers that do not adopt the same lock can still create a narrow concurrent-insert phantom window.
- Native HTML drag is primarily mouse-oriented; touch/pointer and keyboard accessibility remain future design work.
- Production Formal data-path QA passed transactionally; a signed-in visual browser pass may still be useful before merge/deploy.
- The 019 compatibility RPC remains callable by authenticated clients until a separately approved cleanup migration removes it.

## Next Step: Phase 4.3

Implement only the add/edit time conflict prompt when a timed visit lands between an existing transportation pair `A -> B`.

First-version buttons:

- Restore
- Delete

Do not add:

- automatic pair splitting;
- automatic `A -> C` or `C -> B` repair;
- between-card insertion buttons;
- route calculation;
- Phase 4.4 local auto-continuation.

Before starting Phase 4.3, commit/push or otherwise preserve the verified Phase 4.2c working tree.
