# Timeline Phase 4.2a - Destination Package Analysis

Date: 2026-06-21

Status: Analysis complete; RPC / migration approved and implemented locally, pending deployment and authenticated Formal QA.

## Purpose

Phase 4.2 swaps destination packages between two timed visit slots. It is not list sorting: visit IDs and time slots remain in place while destination-facing content and its child relationships move together.

## Current Data Shape

The destination package spans three tables:

1. `itinerary_items`: the primary visit row and its destination-facing fields.
2. `itinerary_alternatives`: child alternatives keyed by `itinerary_item_id`.
3. `itinerary_budget_items`: linked-budget relationships keyed by `itinerary_item_id`.

Formal data is persisted through Supabase and refreshed by Realtime. Demo uses local React state in `DemoApp`.

### Live Baseline Verification

Read-only verification against the connected production Supabase project on 2026-06-21 confirmed:

- `public.itinerary_items.from_item_id` is nullable.
- `public.itinerary_items.to_item_id` is nullable.
- The transportation pair, review snapshot, alternative visit-field, and fixed-item migrations are present in the deployed migration history.
- RLS is enabled on `itinerary_items`, `itinerary_alternatives`, and `itinerary_budget_items`.
- There were no existing `A -> null` tail transportation rows and no duplicate tail groups at verification time.

The live schema therefore supports Phase 4.1 without a schema change. The lack of a unique tail constraint remains a concurrency limitation; the first implementation prevents duplicates in application logic but does not claim database-level race protection.

## Swappable Destination Fields

Only the following `itinerary_items` fields belong to the destination content package:

- `type`
- `title`
- `location`
- `location_name`
- `address`
- `map_url`
- `latitude`
- `longitude`
- `note`
- `description`
- `transportation_note`
- `cost`

The swap must use an explicit allowlist. Transport-only fields are not part of a visit destination package and must remain `null` for visit rows.

## Slot and System Fields That Must Not Move

- `id`
- `trip_id`
- `day_index`
- `date`
- `item_type`
- `start_time`
- `end_time`
- `sort_order`
- `created_by`
- `created_at`
- `updated_at`
- `is_fixed`
- `fixed_at`
- `fixed_by`
- `locked_by`
- `locked_at`
- `transport_category`
- `transport_name`
- `transport_duration_minutes`
- `transport_note`
- `from_item_id`
- `to_item_id`
- all `from_snapshot_*` and `to_snapshot_*` fields

Visit IDs therefore remain time-slot identities. Transportation pair anchors continue pointing to the same slots, so a content swap cannot turn an adjacent pair into an invalid pair.

## Alternatives

Alternatives belong to the destination package and must follow the destination to the other slot.

- Move each affected `itinerary_alternatives.itinerary_item_id` from slot A to B or B to A.
- Do not rewrite the alternative row content during the package swap.
- Alternative IDs remain unchanged.
- The alternative row's own `start_time` / `end_time` fields remain unchanged; the primary Timeline display continues to use the destination slot's time.

## Linked Budgets

Linked-budget relationships belong to the destination package and must follow the destination.

- Move affected `itinerary_budget_items.itinerary_item_id` links from A to B or B to A.
- Do not modify `budget_items` rows, participants, amounts, payers, or Budget calculations.
- Preserve each link row ID when the database operation can do so safely.
- Handle budgets linked to both destinations without violating the unique `(itinerary_item_id, budget_item_id)` constraint.

This is relationship reassignment, not a Budget feature or Budget data-flow redesign.

## Formal Transaction Requirement

Phase 4.2b cannot safely use independent browser updates. A complete package swap changes both visit rows plus child rows in two other tables. If any request fails midway, destinations, alternatives, and budget links can disagree.

Formal therefore requires one database transaction exposed through a narrowly scoped RPC. The RPC should:

1. Require two distinct timed visit IDs in the same trip and day.
2. Verify the current user can edit the trip.
3. Lock both visit rows for update in a stable ID order.
4. Reject transportation rows, fixed rows, rows locked by another user, missing time slots, or stale `updated_at` baselines.
5. Snapshot the explicit destination-field allowlist for both rows.
6. Swap those destination fields without changing slot/system fields.
7. Reassign alternatives in both directions.
8. Reassign linked-budget relationships in both directions while safely handling shared budget links.
9. Commit all changes together or roll back all changes.
10. Return the updated visit rows or a structured error that the UI can display.

`updated_at` is not exchanged between slots. Both affected visit rows explicitly receive `updated_at = now()` as part of the successful transaction so optimistic concurrency and Realtime consumers observe the package change.

The migration must be new; do not edit applied migrations. Based on the repository sequence, the next migration would start at `019+`, but it must be created only after approval.

The public RPC surface must remain minimal. It must use the project's existing private permission-helper pattern, grant execution only as required, and never expose a service-role path to the browser.

Supabase's current Database Functions guidance confirms that Postgres functions are callable through `supabase.rpc()`, recommends `security invoker` by default, requires a constrained `search_path` for `security definer`, and notes that function execute privileges must be explicitly revoked and granted. This project already has a stricter established pattern for transaction-backed mutations, so Phase 4.2b should follow it:

- `app_private.swap_itinerary_destination_packages(...)`: transactional `security definer` implementation with an explicit `search_path`.
- `public.swap_itinerary_destination_packages(...)`: narrow authenticated wrapper.
- Revoke execute from `public` and `anon`.
- Grant execute only to `authenticated` on the public wrapper.
- Keep the private function non-executable by frontend roles.

### Proposed RPC Contract

Suggested input parameters:

```text
source_item_id uuid
target_item_id uuid
source_updated_at timestamptz
target_updated_at timestamptz
```

Suggested successful return:

```json
{
  "ok": true,
  "source_item_id": "...",
  "target_item_id": "...",
  "moved_alternative_count": 0,
  "moved_budget_link_count": 0
}
```

Suggested stable error codes:

- `permission_denied`
- `item_not_found`
- `same_item`
- `different_trip_or_day`
- `timed_visit_required`
- `fixed_item`
- `item_locked`
- `stale_item`

### Linked-Budget Swap Algorithm

`itinerary_budget_items` has a unique `(itinerary_item_id, budget_item_id)` constraint. The RPC must not perform two independent parent-ID updates because shared budget links can collide during the swap.

The safe transaction should:

1. Snapshot link rows for both slots, including IDs and `created_at`.
2. Delete those captured link rows inside the same function transaction.
3. Reinsert each captured row with the opposite slot ID while preserving its link ID and `created_at`.
4. If both destinations link the same budget, the final pairs remain unique because the original two relationships exchange slots rather than merge.
5. Let any constraint or permission failure raise an exception so the entire function call rolls back.

Alternatives do not have the same parent/budget uniqueness constraint. They can be reassigned with one `CASE` update after both parent IDs are locked and validated.

## Demo Local-State Parity

Demo can perform the same logical transaction in one React update sequence:

- Snapshot both visit packages first.
- Update both `timelineItems` rows from the same snapshot.
- Reassign `timelineAlternatives` parent IDs in one state update.
- Reassign `itineraryBudgetLinks` parent IDs in one state update, preserving shared links.
- Do not change visit IDs, times, ordering, fixed state, transport anchors, or any production callback.

The Demo handler should use the same shared destination-field allowlist or package-builder helper as Formal so the two paths cannot drift.

## Editor, Fixed, Lock, Draft, and Realtime Protection

- Do not begin drag while any Timeline editor is active. Use the existing active-editor guard to require Save or Discard first.
- Fixed visits cannot be drag sources or targets.
- Formal must reject either row when `locked_by` belongs to another active user.
- The RPC must re-check fixed and lock state inside the transaction; UI disabled states are not sufficient authorization.
- Drag-swap must not modify draft autosave or edit-lock utilities.
- Because no editor may be open during the swap, there should be no active Timeline draft to rewrite.
- Realtime may refresh after commit, but it must not expose a half-completed package because the Formal swap is one transaction.

## Transportation Review Behavior

Pair anchors remain attached to time-slot IDs, so adjacency remains valid. Transportation snapshots still contain the previous destinations; after the package swap, existing `transportPairNeedsReview` behavior should produce a normal transportation review warning for affected adjacent cards.

Do not rewrite transport pair anchors or silently confirm their snapshots during the swap.

## Decision

- A schema redesign is not required.
- A new transactional RPC and migration are required for Formal Phase 4.2b.
- The RPC / migration design was approved and implemented in `supabase/migrations/019_swap_itinerary_destination_packages.sql`.
- Phase 4.2b client and Demo behavior are implemented locally.
- Production migration deployment and authenticated Formal QA remain required before final acceptance.
- No drag/drop implementation should be added as a client-only multi-request workaround.
