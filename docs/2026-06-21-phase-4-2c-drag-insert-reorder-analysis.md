# Timeline Phase 4.2c - Drag Insert Itinerary Reorder Analysis

Date: 2026-06-21

Status: Analysis complete; no implementation or migration created.

## Purpose and Decision Summary

Phase 4.2c changes timed-visit drag from a two-item destination-package swap into insertion-style reordering while preserving the existing slot model:

- timed visit row IDs remain slot identities;
- `start_time` / `end_time`, day identity, and system fields remain on those slots;
- destination packages are permuted across the fixed slots;
- alternatives and linked budgets follow their destination package;
- existing transportation cards are preserved only when their original destination endpoints remain adjacent in the same direction;
- preserved transportation cards keep their content but receive anchors for the endpoints' new slot IDs;
- invalidated transportation cards are deleted;
- no transportation card is auto-created.

The existing `019` RPC is not sufficient. It performs one transposition and intentionally leaves transportation anchors on the same two slots. Repeating it cannot safely provide insertion semantics: an insertion may affect every package in a range, child relationships and transportation decisions must use one pre-reorder snapshot, repeated calls expose intermediate states, and a partial failure would not be atomic.

Recommendation: add a new transactional reorder RPC in a future `020` migration. Keep `019` unchanged for migration-history integrity and backward compatibility, but remove the two-item swap from the normal drag UX once insert reorder is implemented.

## Recommended Data Model

No new table or persistent ordering column is required for timed visits.

Treat the day's timed visit rows as fixed time slots. The request contains two equally sized arrays:

```text
slot_item_ids            = [slotA, slotB, slotC, slotD]
package_source_item_ids  = [slotB, slotC, slotA, slotD]
```

The array index is the fixed destination slot. `package_source_item_ids[i]` identifies the pre-transaction destination package copied into `slot_item_ids[i]`. Both arrays must contain the same IDs exactly once. The second array must be a permutation of the first.

For the example above, the package order changes from `A B C D` to `B C A D`, while row IDs and times remain `slotA slotB slotC slotD`.

The destination package allowlist remains the Phase 4.2 definition:

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
- child `itinerary_alternatives`
- child `itinerary_budget_items`

Slot/system fields must not move:

- `id`, `trip_id`, `day_index`, `date`, `item_type`
- `start_time`, `end_time`, `sort_order`
- `created_by`, `created_at`
- fixed and lock fields
- transport-only fields and review snapshots

All changed visit slots should receive `updated_at = now()`. It is acceptable to update every slot in the submitted permutation for a simple, deterministic contract, even if some package remains in its original slot. The client should avoid calling the RPC for a no-op permutation.

### Scope of the Manifest

The safest v1 contract is a complete manifest of all timed, non-transport visits for one day, not only the visibly moved interval. The RPC must compare `slot_item_ids` with the authoritative timed-visit set in the locked day and reject missing or extra IDs.

Benefits:

- transportation adjacency is computed against one complete order;
- endpoints cannot silently sit outside a client-selected subrange;
- concurrent visit insertion/deletion becomes a stale-manifest error;
- the server does not need to infer how a partial range should interact with fixed or omitted visits.

Because this phase does not define crossing fixed barriers, v1 should reject reorder if any timed visit in that day is fixed. A later design could introduce independently reorderable segments, but that should not be inferred here.

Untimed visits, transportation rows, and cross-day rows are never members of either permutation array.

## Transportation Preservation and Deletion Rules

Transportation decisions must use destination identities from the pre-update snapshot, not the post-update contents of anchor rows.

Build a mapping:

```text
original package identity -> new slot ID
```

For each transportation card, first snapshot its row ID, content, old `from_item_id`, old `to_item_id`, and baseline. Its original anchors identify the pre-reorder destination packages.

### Normal `A -> B` Card

Preserve only when all are true:

1. both original endpoint IDs are members of the complete valid manifest;
2. both packages occur in the new package sequence;
3. B's new index is exactly A's new index plus one;
4. A remains before B;
5. the resulting anchor pair belongs to the same trip and day.

If preserved:

- keep the transportation row ID and all transportation content;
- set `from_item_id` to A's new slot ID;
- set `to_item_id` to B's new slot ID;
- set the transport row's `updated_at = now()` through the existing update behavior;
- do not change its review snapshots.

Delete when either endpoint is absent from the valid manifest, the endpoints are no longer adjacent, their order reverses, or the mapped pair is otherwise invalid. A transport row that would render before the first timed visit is invalid and must be deleted. With a complete, validated manifest this case should be impossible for a preserved normal pair, but the server should still fail closed.

### Tail `A -> null` Card

Preserve only when A is present and A's package is the final element of the new timed package sequence. Update `from_item_id` to A's new slot ID and keep `to_item_id = null`.

Delete when A is absent or no longer the final timed destination. Do not convert it into a normal card and do not create a replacement tail card for the newly final destination.

### No Automatic Creation

For `A B C D -> B C A D`, preserved original edges are evaluated independently:

- `A -> B`: delete;
- `B -> C`: preserve and remap to their new slots;
- `C -> D`: delete;
- tail `D -> null`: preserve if present;
- do not create `C -> A` or `A -> D`.

### Anchor Unique-Index Collision

`itinerary_items_transport_pair_unique_idx` is unique for non-null transport pairs. Updating preserved rows directly can fail even when the final state is valid. For example, a preserved `A -> B` may move into the old slot pair temporarily occupied by preserved `B -> C`.

The transaction should therefore:

1. snapshot all transportation decisions;
2. delete doomed transport rows first;
3. temporarily set both anchors to `null` for every preserved normal/tail transport row;
4. assign all final mapped anchors from the snapshot.

The temporary null state is transaction-local and never visible after commit. The existing distinct-endpoint check allows it. Final assignments must still satisfy the partial unique index. This also prevents a doomed card from occupying a pair needed by a preserved card.

## Recommended RPC Design

### Migration and Function Names

Recommended future migration:

```text
020_reorder_itinerary_destination_packages.sql
```

Recommended functions:

```text
app_private.reorder_itinerary_destination_packages(...)
public.reorder_itinerary_destination_packages(...)
```

The private implementation should follow the established `019` security-definer pattern with an explicit `search_path`. Revoke it from frontend roles. The public wrapper should be executable only by `authenticated`, with authorization enforced again in the private implementation.

### Parameters

Recommended contract:

```text
trip_id uuid
day_index integer
slot_item_ids uuid[]
package_source_item_ids uuid[]
item_updated_at_baselines jsonb
```

`trip_id` and `day_index` are worth accepting even though they can be inferred. They make the intended scope explicit, allow permission checks before mutation, and let the RPC reject a confused or stale client manifest.

Both ID arrays are required. A source/target pair or only a destination index is too narrow for server-side verification of the full intended result.

`item_updated_at_baselines` should be an object keyed by item UUID whose value is the ISO timestamp observed by the client. It should include every submitted timed visit and every transportation row in the scoped day, including invalid-warning cards. This is preferable to only visit baselines because anchor updates or deletion must not erase a collaborator's concurrent transport edit.

Example:

```json
{
  "slot-a-uuid": "2026-06-21T10:00:00Z",
  "slot-b-uuid": "2026-06-21T10:00:01Z",
  "transport-uuid": "2026-06-21T10:00:02Z"
}
```

The RPC should reject a missing baseline for any row it will update or delete. It should also reject when the authoritative timed-visit or transportation-row set differs from the client's manifest/baseline coverage. This catches a concurrent visit or transport creation instead of silently absorbing it.

If JSON is considered too loose for generated API typing, equivalent aligned parameters are acceptable:

```text
item_baseline_ids uuid[]
item_baseline_updated_ats timestamptz[]
```

The two arrays must have equal length and unique IDs. Do not accept timestamps only for the dragged source and visual target.

### Return Format

Return a stable JSON result, for example:

```json
{
  "ok": true,
  "trip_id": "...",
  "day_index": 0,
  "slot_item_ids": ["..."],
  "package_source_item_ids": ["..."],
  "updated_visit_count": 4,
  "moved_alternative_count": 3,
  "moved_budget_link_count": 2,
  "preserved_transport_ids": ["..."],
  "deleted_transport_ids": ["..."],
  "updated_transport_count": 1
}
```

Returning IDs and counts is sufficient because Formal already reloads trip data after successful mutations and Realtime observes only the committed transaction. Returning full rows would increase payload and duplicate the normal reload path.

Suggested stable error codes:

- `permission_denied`
- `invalid_day`
- `invalid_manifest`
- `duplicate_item`
- `manifest_not_permutation`
- `different_trip_or_day`
- `timed_visit_required`
- `fixed_item`
- `item_locked`
- `stale_item`
- `stale_manifest`
- `transport_state_changed`

## Transaction Algorithm

The private RPC should perform all work in one PostgreSQL transaction provided by the function call:

1. Require `auth.uid()` and validate non-null, non-empty, equally sized arrays.
2. Validate `day_index >= 0`, array uniqueness, and that the package-source array is exactly a permutation of the slot array.
3. Verify `app_private.can_edit_trip(trip_id, auth.uid())`.
4. Lock all `itinerary_items` rows for the trip/day in stable `id` order with `FOR UPDATE`, including timed visits, untimed visits, and transport rows. Locking the full day gives transportation decisions one stable snapshot. If practical, use a trip-scoped advisory transaction lock to serialize day mutation against inserts, because row locks alone cannot lock a row that has not yet been inserted. Otherwise the complete-set recheck must be documented as not fully preventing a concurrent insert race.
5. Derive the authoritative timed-visit set (`item_type <> 'transport' AND start_time IS NOT NULL`) and require exact set equality with `slot_item_ids`.
6. Require every manifest row to match `trip_id` and `day_index`, be a timed visit, and not be fixed.
7. Reject any timed visit actively locked by another user using the existing seven-minute timeout. The current user's own lock may be accepted only if the UI has already resolved its editor; normal drag should still be blocked while any editor is active.
8. Validate every required visit and transport `updated_at` against `item_updated_at_baselines`. Recheck the authoritative row sets after locking.
9. Snapshot the explicit destination fields for every package source before updating any visit row. Also snapshot alternatives, budget links, and all transport rows/decisions.
10. Build an in-transaction mapping table or CTE containing `slot_id`, `source_id`, and ordinal position. Do not derive later mappings from already-mutated visit rows.
11. Update all destination allowlist fields on slot rows from the package snapshots and set `updated_at = now()`.
12. Reassign alternatives according to `old parent/source ID -> new slot ID`.
13. Reassign itinerary-budget links with the collision-safe delete/reinsert algorithm below.
14. Classify transport rows from their original endpoints, delete invalidated rows, clear anchors on preserved rows, then write their final mapped anchors.
15. Leave transportation review snapshots unchanged so changed time-slot context is reviewable.
16. Return counts/IDs. Any validation or constraint failure raises and rolls the entire RPC back.

Locking child rows explicitly with stable-order `FOR UPDATE` before snapshotting is recommended. The day-level serialization choice should also cover client mutations that can insert/delete day items; otherwise the RPC can only guarantee atomicity for rows visible at its snapshot, not exclusion of an unrelated concurrent insert.

## Alternatives Parent Reassignment

Alternatives follow their pre-transaction destination package. Create the full old-parent to new-slot mapping, then update each affected alternative once:

```text
alternative.itinerary_item_id = mapping.new_slot_id
where mapping.old_source_id = alternative.itinerary_item_id
```

Alternative IDs and contents remain unchanged. Their own `start_time` / `end_time` fields, if present, remain unchanged under the previously approved destination-package model.

Use one mapping-driven update rather than sequential updates. Sequential parent changes can cause a later statement to move rows a second time after their parent has already changed.

## Linked Budgets and Unique Constraint Safety

`itinerary_budget_items` has a unique constraint on `(itinerary_item_id, budget_item_id)`. Arbitrary permutation must not use sequential parent updates because a destination can temporarily collide with an existing link at its target slot.

Use the same safe pattern as `019`, generalized to N packages:

1. lock and snapshot every link whose `itinerary_item_id` is in the source manifest, including `id`, `budget_item_id`, and `created_at`;
2. delete all captured rows inside the transaction;
3. reinsert each row with the mapped new slot ID while preserving link `id` and `created_at`.

Because the source list is a true permutation, the final relationships have the same cardinality and cannot create a new duplicate unless invalid duplicate input or pre-existing inconsistent data is present. Let the unique constraint abort and roll back if that invariant is violated.

Do not modify `budget_items`, participants, amounts, payers, fixed flags, or Budget calculations.

## Transportation Review Snapshots and Warnings

Do not refresh review snapshots during reorder. Refreshing them would silently confirm a transportation card after its time-slot anchors changed.

For a preserved normal card, the destination snapshot still describes the same A and B packages, while time snapshots may no longer match the new slots. The existing `transportPairNeedsReview` comparison should therefore produce the normal review warning when appropriate. Transportation duration shortage remains warning-only and is recalculated from the preserved card duration and its newly anchored slots; it never blocks commit.

For a preserved tail card, retain its existing from snapshots. If the current tail rendering does not compare its from snapshot, implementation should extend the existing lightweight warning evaluation for the tail case rather than updating snapshots in the reorder transaction. That would be a warning-path adjustment, not route calculation.

Deleted cards need no review state. No new review-snapshot table or history row is required.

## Demo Local-State Transaction Parity

Demo must implement the same logical operation without Supabase, Auth, Realtime, Storage, Draft Autosave, Edit Lock, or localStorage.

Recommended shared pure planner:

```text
planDestinationPackageReorder({ items, slotItemIds, packageSourceItemIds })
```

It should return one immutable plan containing:

- updated visit rows built from a pre-change destination-package snapshot;
- an old-source to new-slot mapping;
- reassigned alternatives;
- reassigned itinerary-budget links;
- preserved transport rows with new anchors;
- deleted transport IDs;
- warning/review state derived normally after the update.

Demo should compute the complete plan from one snapshot before calling any setter. Then apply the related React state updates as one user operation. React state setters are not a database transaction, so the planner must be pure and fail before any setter is called. A reducer holding Timeline items, alternatives, and links together would provide the strongest atomic local model; if the current separate states remain, calculate all next arrays first and update them in the same event/batched render.

Formal may reuse the pure client planner only for preview and drop intent. The database RPC remains authoritative.

Demo refresh must continue to reset mock state.

## UI Drop Semantics

Insertion operates on destination-package order, not DOM row movement or persisted `sort_order`.

Represent drop positions as gaps `0..N` around the timed visits. On drop:

1. remove the dragged package from its original package sequence;
2. determine the intended gap in the remaining sequence;
3. insert the dragged package at that gap;
4. assign the resulting package sequence back to the original ordered slot IDs.

For a card target:

- pointer in the target card's upper half means insert before that target package;
- pointer in the lower half means insert after that target package;
- an explicit gap indicator between C and D is equivalent to below C / above D;
- normalize the index after removing the source, otherwise downward drags are off by one;
- if the resulting permutation is unchanged, do nothing and show no confirmation.

Thus dragging A to the C/D gap yields `B C A D`.

Only timed, non-fixed, unlocked visits in the same day are valid sources and drop context. Untimed and cross-day drag remain out of scope. Transportation cards are neither sources nor insertion targets.

## Confirmation Prompt Recommendation

Show a concise preview before committing because transport deletion is destructive. Suggested Traditional Chinese copy:

```text
要將「A」移到「C」與「D」之間嗎？

行程的時間區間會保留不變，只有目的地內容會依新順序套入原本時段。
不再相鄰的交通卡會自動移除；尾端交通卡若不再位於當日最後一站後方，也會移除。

[取消] [確認重排]
```

At the beginning/end, replace the first line with natural wording such as `移到當日第一站` or `移到當日最後一站`. If the pure preview can identify affected cards, an optional final line may say `將移除 2 張交通卡` and list short labels, but do not create a complex repair dialog.

Do not imply that times move, routes are recalculated, or new transportation cards are created.

## Replace or Retain the Two-Item Swap

Insertion reorder should completely replace two-item swap as the user-facing drag behavior. Keeping both under the same gesture is ambiguous and produces different results for non-adjacent cards.

The `019` RPC should remain deployed and unchanged. Existing clients may still call it, and removing it is unnecessary for Phase 4.2c. The new UI should call only the reorder RPC. A future cleanup migration may revoke/drop the old public wrapper after all deployed clients have moved, but that is not part of `020` unless explicitly approved.

## Risks

- **Concurrent insert phantom:** row locks do not block a new day item that does not yet exist. Prefer a transaction-scoped trip/day advisory lock adopted by all relevant day mutations, or document and test the remaining race. Complete-manifest and baseline rechecks reduce but do not mathematically eliminate it under `READ COMMITTED` when other writers ignore the advisory lock.
- **Transport content loss:** deleting a transport row concurrently edited by another user is unacceptable; transport baselines and row locks are required.
- **Unique-index transient collisions:** both budget links and transport anchors need collision-safe multi-phase reassignment.
- **Incomplete client manifest:** hidden invalid transport cards must be included in baseline coverage; otherwise stale or invalid rows may survive unexpectedly.
- **Snapshot drift:** rewriting transport review snapshots would falsely mark changed context as reviewed.
- **Realtime refresh:** commit is atomic, but broad reload must not remount an unrelated active editor. Existing global editor guard should block reorder while any editor is active.
- **Touch/mobile ambiguity:** HTML drag events are weak on touch. The implementation phase must define accessible pointer/keyboard behavior, but this analysis does not modify UI.
- **Large-day payload:** JSON baselines and full-day snapshots grow with the day, but expected itinerary sizes are small and correctness is more valuable than a narrower unsafe contract.
- **Fixed visits:** rejecting an entire day with any fixed timed visit is conservative. Segment-based reorder can be designed later if product needs it.

## Acceptance Criteria

### Data and RPC

- `A B C D -> B C A D` preserves slot IDs and all slot times.
- Destination allowlist fields, alternatives, and linked budgets follow A/B/C/D packages exactly.
- Link and alternative row IDs remain unchanged; budget link `created_at` remains unchanged.
- Input arrays must be an exact full-day timed-visit permutation.
- Wrong trip/day, fixed visits, active foreign locks, stale baselines, and changed manifests abort with no partial writes.
- All participating rows are handled in one transaction.
- Preserved transport content/IDs remain unchanged except anchors and `updated_at`.
- Invalidated normal/tail cards are deleted; no new card is created.
- Review snapshots remain unchanged and shortage remains warning-only.

### Transportation Cases

- A pair still adjacent in the same direction is preserved and remapped.
- A non-adjacent or reversed pair is deleted.
- A pair with an endpoint outside the valid manifest is deleted or causes stale-manifest rejection according to whether the row itself is in the scoped day; it is never silently preserved.
- A tail card is preserved only when its original from-package remains last.
- Multiple preserved pairs can shift without unique-index collision.
- Duplicate or malformed transport data fails safely.

### Demo and UX

- Demo produces the same resulting packages, child parents, preserved/deleted transports, and warnings from local state.
- Upper-half, lower-half, first-gap, last-gap, upward, and downward drops produce deterministic permutations.
- No-op drops do not call Formal RPC or show confirmation.
- Confirmation states that time ranges stay fixed and explains both normal and tail transport deletion.
- Cancel changes nothing; a failed RPC leaves UI state unchanged and reloads on stale-state errors.

## E2E and Manual QA Matrix

Automated/E2E coverage should include:

1. `A B C D`, drag A between C/D -> `B C A D`; IDs/times unchanged.
2. Drag D before B -> `A D B C`; verify downward/upward index normalization.
3. Drag into the current adjacent gap -> no-op.
4. Alternatives with multiple rows follow their source package once.
5. Budget links follow packages; the same budget linked to multiple packages does not violate uniqueness; link IDs and `created_at` remain stable.
6. Preserve a still-adjacent normal pair and verify its new slot anchors.
7. Delete non-adjacent and reversed pairs.
8. Shift a chain of two or more preserved transport pairs to exercise transient unique-index collisions.
9. Preserve/delete tail cards based on the original from-package's final position.
10. Verify no new C -> A or A -> D card is created.
11. Preserve review snapshots and show the normal context/time warning after remap when values differ.
12. Show transportation shortage warning without blocking reorder.
13. Reject fixed, locked, stale, wrong-day, cross-trip, duplicate, missing, and non-permutation requests with full rollback.
14. Concurrently edit a transport or visit and verify the stale transaction cannot delete/overwrite it.
15. `/demo/timeline` matches Formal result and makes no Supabase/Auth/Realtime/Storage/Draft/Lock requests.

Manual QA should additionally cover:

- mouse insertion above/below cards;
- touch/pointer and keyboard accessibility once designed;
- confirmation wording at first, middle, and last gaps;
- cancel and RPC failure behavior;
- Realtime refresh after one atomic commit;
- unrelated active editor guard, draft preservation, and lock behavior;
- reload consistency;
- invalid transport warning area after reorder;
- mobile card density and visible insertion indicator.

Required implementation-phase checks remain:

```text
npm.cmd run build
npx.cmd playwright test
git diff --check
```

## Final Recommendation

Add a new `020` migration containing a dedicated N-way `reorder_itinerary_destination_packages` transaction. Do not modify `019`, and do not implement reorder by chaining swaps or browser table updates.

The migration is recommended but is not created in this analysis phase. This document is the only intended Phase 4.2c repository change.
