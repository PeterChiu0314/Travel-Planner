# Timeline Phase 4.2c Closeout and Handoff

Date: 2026-06-22

## Status

```text
Timeline Phase 4.2c - Completed
Production migrations 020 and 021 - Applied
Formal Production RPC QA - Passed
Demo and automated QA - Passed
```

Branch:

```text
codex/timeline-phase-4-0-to-4-2
```

At the time of this handoff, the 4.2c implementation and closeout documents are local working-tree changes after pushed commit `d2d1e78`. Verify Git state before claiming commit or push completion.

## Final Product Decision

Phase 4.2c replaces the user-facing two-card swap gesture with insertion-style destination-package reorder.

```text
Before: A B C D
Drag A after C
After:  B C A D
```

The ordered time slots remain fixed. Destination packages are reassigned across those slots.

This is not:

- DOM/list row movement;
- persisted `sort_order` sorting;
- transportation-card dragging;
- untimed-visit sorting;
- automatic route repair.

The earlier 019 swap RPC remains deployed for compatibility, but the current UI calls only the 020 reorder RPC.

## Implemented Behavior

### Drag and Confirmation UX

- Timed visits are the only draggable sources and targets.
- Upper target half means insert before.
- Lower target half means insert after.
- Downward insertion is normalized after source removal.
- An unchanged permutation is a no-op with no prompt or RPC.
- Any fixed timed visit disables reorder for that day.
- Any active foreign timed-visit lock disables reorder for that day.
- Any active Timeline editor blocks drag until Save or Discard.
- The confirmation states that time ranges stay fixed.
- The confirmation reports invalidated transportation deletion.
- Cancel leaves all state unchanged.

### Destination-Package Movement

The existing Phase 4.2a allowlist is retained:

- `type`, `title`, `location`, `note`, `cost`
- `location_name`, `address`, `map_url`
- `latitude`, `longitude`
- `description`, `transportation_note`

These relationships also follow the package:

- `itinerary_alternatives`
- `itinerary_budget_items`

These slot/system fields do not move:

- row ID, trip/day/date identity, and `item_type`
- `start_time`, `end_time`, and `sort_order`
- fixed state, edit-lock state, and `created_at`
- transportation review snapshots

Visit rows updated by the operation receive `updated_at = now()`.

### Transportation Rules

Transportation decisions are classified from the pre-change package order:

- Preserve a normal card only when its original packages remain adjacent in the same direction.
- Preserve a tail card only when its original from-package remains the final timed package.
- Remap preserved card anchors to the corresponding final slot IDs.
- Delete invalidated normal/tail cards.
- Never create replacement transportation.
- Leave review snapshots unchanged so normal warning logic can flag changed context.
- Keep transportation-duration shortage warning-only.

Preserved anchors are temporarily cleared inside the transaction before final assignment to avoid transient unique-index collisions.

### Formal and Demo Parity

Formal:

- Builds a full timed-slot manifest and full day visit/transport `updated_at` baselines.
- Calls `public.reorder_itinerary_destination_packages(...)`.
- Reloads authoritative trip data after success and stale-state failures.

Demo:

- Uses the shared pure planner in `src/lib/destinationPackages.js`.
- Computes the complete item/alternative/budget-link result before applying React state.
- Does not call Supabase, Auth, Realtime, Storage, Draft Autosave, Edit Lock, or localStorage.

## Database Closeout

### Migration 019

```text
file: supabase/migrations/019_swap_itinerary_destination_packages.sql
version: 20260621131905
name: swap_itinerary_destination_packages
status: applied / immutable
```

Retained as compatibility foundation. Do not edit it.

### Migration 020

```text
file: supabase/migrations/020_reorder_itinerary_destination_packages.sql
version: 20260622130246
name: reorder_itinerary_destination_packages
status: applied / immutable
```

RPCs:

- `app_private.reorder_itinerary_destination_packages(...)`
- `public.reorder_itinerary_destination_packages(...)`

The RPC:

- requires authenticated edit permission;
- locks the scoped day rows in stable order;
- takes a trip/day advisory transaction lock;
- validates the exact timed manifest and package permutation;
- rejects fixed visits and active foreign locks;
- validates every timed visit and transportation baseline;
- moves destination packages, alternatives, and budget links atomically;
- performs collision-safe transport deletion/remapping;
- returns changed counts and IDs.

### Migration 021

```text
file: supabase/migrations/021_fix_reorder_baseline_count.sql
version: 20260622131013
name: fix_reorder_baseline_count
status: applied / immutable
```

Formal QA found that PostgreSQL does not provide `jsonb_object_length(jsonb)`. Migration 021 replaced that baseline-cardinality expression with a count over `jsonb_object_keys(item_updated_at_baselines)`.

Any future database correction must use migration 022+.

### Verified ACL

- Private RPC: `SECURITY DEFINER`, explicit `search_path`, no frontend execute grant.
- Public wrapper: `SECURITY DEFINER`, explicit `search_path`, executable by `authenticated`, not `anon`.
- Authorization is rechecked inside the private implementation.
- The Supabase security advisor reports the public authenticated security-definer wrapper. This is intentional for the narrow guarded RPC pattern.

## Formal Production QA

QA used isolated fixtures inside transactions and ended with `ROLLBACK`.

Successful reorder verified:

- `A B C D -> B C A D`;
- slot IDs and time ranges unchanged;
- alternative for B moved to B's new slot;
- budget link for C moved to C's new slot;
- link ID and `created_at` preserved;
- original `B -> C` transportation preserved and remapped;
- original `A -> B` and `C -> D` transportation deleted;
- D tail transportation preserved because D remained last;
- transportation review snapshots unchanged;
- visit `updated_at` refreshed;
- no new transportation created.

Rejection/rollback verified:

- fixed timed visit;
- active foreign lock;
- stale visit baseline;
- incomplete/wrong timed manifest.

After QA, the fixture trip did not exist in Production.

## Automated and Demo QA

```text
npm.cmd run build       passed
npx.cmd playwright test passed 32/32
git diff --check        passed
```

Coverage includes:

- upward/downward insertion normalization;
- `B C A D` and `A D B C`;
- adjacent no-op behavior;
- fixed time slots and IDs;
- alternatives and linked budgets;
- preserved/deleted normal transport;
- preserved/deleted tail transport;
- no synthesized transportation;
- untimed visit exclusion;
- fixed/incomplete-manifest planner rejection;
- 020/021 migration security and correction contracts;
- Demo drag confirmation and no-op UI.

The Vite large-chunk warning remains pre-existing and non-blocking.

## Files Changed

- `src/App.jsx`
- `src/lib/destinationPackages.js`
- `src/styles.css`
- `tests/phase-1-7f-smoke.spec.js`
- `tests/phase-4-2c-reorder.spec.js`
- `supabase/migrations/020_reorder_itinerary_destination_packages.sql`
- `supabase/migrations/021_fix_reorder_baseline_count.sql`
- `docs/archive/Timeline_Phase4/timeline-phase-4-plan.md` (historical; consult only when needed)
- `CURRENT_TASK.md`
- `docs/2026-06-22-phase-4-2c-closeout-handoff.md`

Generated `test-results/` remains untracked and must not be committed.

## Protected Areas Preserved

No intentional changes were made to:

- Auth / Google OAuth
- Realtime subscription architecture
- Draft Autosave behavior
- Edit Lock behavior
- Share / Invite / member flow
- Budget core data flow
- global `.panel` or `.content-grid`
- Google Map API or route calculation
- generic drag/drop sorting or `sort_order` schema
- Demo production-service isolation

## Residual Risks and Follow-Up

- The RPC advisory lock only serializes writers that adopt the same trip/day lock. An unrelated insert path that ignores it leaves a narrow concurrent-insert phantom risk.
- HTML drag is mouse-oriented. Touch/pointer and keyboard-accessible reorder need a separately designed interaction.
- Formal database behavior passed Production transaction QA; a signed-in visual browser pass is still useful before merge/deploy.
- The 019 public compatibility RPC remains callable until a separately approved cleanup migration.
- `test-results/` should be removed before staging/commit.

## Next Phase Handoff: Phase 4.3

Phase 4.3 adds a prompt when adding or editing a timed visit causes the sorted result to land between an existing transportation pair `A -> B`.

First version buttons:

- Restore
- Delete

Phase 4.3 must not:

- automatically split transportation;
- rewrite the pair to `A -> C` or `C -> B`;
- add a between-card visit insertion button;
- calculate routes;
- implement Phase 4.4 auto-continuation.

Start Phase 4.3 only after preserving the verified 4.2c work through the intended Git workflow.

