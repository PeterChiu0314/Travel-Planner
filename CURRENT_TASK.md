# CURRENT_TASK.md

## Read First

- `AGENT.md`
- `docs/UX_RULES.md`
- `docs/BUGS.md`
- `docs/gpt/timeline-phase-4-plan.md`
- `docs/gpt/2026-06-21-phase-4-2-destination-package-analysis.md`

## Current Phase

```text
Timeline Phase 4.0–4.2 - Completed / Pushed
```

Branch:

```text
codex/timeline-phase-4-0-to-4-2
```

Latest pushed commit:

```text
d4b73fc Implement Timeline Phase 4.1 and 4.2
```

Status:

```text
Phase 4.0 analysis and handoff are complete.
Phase 4.1 tail transportation and next-visit default time are complete.
Phase 4.2 destination-package analysis and timed-visit drag swap are complete.
The branch is pushed and tracks origin/codex/timeline-phase-4-0-to-4-2.
No Phase 4.3 implementation has started on this branch.
```

## Home Environment Closeout

- Work completed and pushed on 2026-06-21.
- `test-results/` is generated output and remains untracked; do not commit it.
- This `CURRENT_TASK.md` update is the final handoff change following implementation commit `d4b73fc`.
- Do not amend or rewrite the already-applied `019` migration.

## Phase 4.0 Completed

- Reviewed the Phase 4 scope, implementation order, protected areas, Timeline data flow, and Demo/Formal parity risks.
- Updated `docs/gpt/timeline-phase-4-plan.md` to reflect the agreed Phase 4.1–4.7 definitions.
- Added the Phase 4.2 destination-package analysis document.
- Confirmed the Phase 4 order remains 4.1 tail transportation, 4.2 destination-package swap, 4.3 insertion prompt, 4.4 local auto-continuation, 4.5 untimed ordering, 4.6 Map design only, and 4.7 QA/handoff.

## Phase 4.1 Completed

- A final timed visit may have one tail transportation card with `from_item_id` set and `to_item_id = null`.
- A valid tail card is not treated as an invalid pair warning.
- The next timed visit defaults to the previous visit end plus tail transportation duration.
- The result rounds upward to the next five-minute Timeline UI step:
  - `10:00 + 15 = 10:15`
  - `10:00 + 17 = 10:20`
  - `10:00 + 23 = 10:25`
  - `10:00 + 1 = 10:05`
  - `10:00 + 0 = 10:00`
- Transportation duration remains arbitrary minutes; it is not restricted to multiples of five.
- The suggested time remains editable.
- Saving the next timed visit completes the tail pair to `A → B` in Formal and Demo.
- Formal includes compensation cleanup if tail-pair completion fails after insertion.
- Transportation shortage warnings and local auto-continuation were not changed.
- Formal and Demo share the same suggestion helper.

## Phase 4.2 Completed

Destination package fields that swap:

- `type`, `title`, `location`, `note`, `cost`
- `location_name`, `address`, `map_url`, `latitude`, `longitude`
- `description`, `transportation_note`
- linked `itinerary_alternatives`
- linked `itinerary_budget_items`

Slot/system fields that do not swap:

- IDs, trip/day/date identity, `item_type`
- `start_time`, `end_time`, `sort_order`
- fixed fields, edit-lock fields, and `created_at`
- transportation pair anchors and snapshots

Both visit rows receive `updated_at = now()`; timestamps are not exchanged.

Drag behavior:

- Timed visit drag exchanges destination packages; it is not general ordering.
- IDs and time slots stay in place.
- Transportation pair anchors remain unchanged.
- Changed destination semantics may use the normal transportation warning.
- Transportation cards, untimed visits, fixed cards, and cards locked by another user cannot be dragged or targeted.
- Any active editor blocks drag until Save or Discard.
- Demo uses local React state; Formal uses one atomic RPC.

## Production Migration State

Migration:

```text
supabase/migrations/019_swap_itinerary_destination_packages.sql
```

Production history:

```text
version: 20260621131905
name: swap_itinerary_destination_packages
project: lqvuqamzmchepgxkftcw
```

- `019` was successfully applied to Production.
- The private implementation is `app_private.swap_itinerary_destination_packages(...)`.
- The authenticated wrapper is `public.swap_itinerary_destination_packages(...)`.
- The RPC validates authentication, edit permission, trip/day identity, timed visits, fixed state, active locks, and stale timestamps.
- It locks rows in stable ID order and atomically swaps destination fields, alternatives, and budget links.
- Budget link IDs and `created_at` values are preserved.
- The public security-definer wrapper is intentionally executable by `authenticated`; authorization is enforced in the private implementation.

Important:

- Never edit applied migration `019` in place.
- Future schema, function, permission, or RPC changes must use migration `020+`.

## Additional Bug Fixes Included

- Tail transportation default time rounds upward to the next five-minute UI step.
- Switching from a longer trip's selected Day board to a shorter trip no longer leaves the old out-of-range board visible.
- Formal and Demo synchronously select a valid default day when switching trips.
- Demo also clears the focused item from the previous trip.

## Validation Completed

```text
npm.cmd run build          passed
npx.cmd playwright test    passed 23/23
git diff --check           passed
```

Formal RPC rollback QA also confirmed:

- destination fields swap while IDs and time slots stay fixed;
- alternatives and budget links move with destinations;
- budget link IDs and `created_at` stay unchanged;
- both visit rows refresh `updated_at`;
- the transaction was rolled back and retained no QA fixture.

## Protected Scope Preserved

The completed work did not redesign or broadly modify:

- Auth / Google OAuth
- Realtime subscriptions
- Draft Autosave or Edit Lock behavior
- Share / Invite / member flow
- Budget core data flow
- global `.panel` or `.content-grid`
- Google Map API or route calculation
- general drag/drop ordering or `sort_order` schema
- Demo isolation from Supabase, Auth, Realtime, Storage, Draft Autosave, and Edit Lock

## Next Steps

1. Fetch and check out `codex/timeline-phase-4-0-to-4-2` in the next work environment.
2. Review commit `d4b73fc` and this handoff update.
3. Before merge, run `npm.cmd run build`, `npx.cmd playwright test`, and `git diff --check`.
4. Merge the verified Phase 4.0–4.2 branch into the intended base branch.
5. Start Timeline Phase 4.3 from the merged baseline on a new scoped branch.
6. Follow `docs/gpt/timeline-phase-4-plan.md`; Phase 4.3 must not add auto-splitting, route calculation, or between-card insertion buttons.
