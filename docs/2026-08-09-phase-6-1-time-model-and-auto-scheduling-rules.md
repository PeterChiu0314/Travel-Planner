# Timeline Phase 6.1 | Time Model and Auto-Scheduling Rules

Status: Approved design baseline
Date: 2026-08-09
Branch: `codex/timeline-phase-6-1`
Runtime behavior: Unchanged from the completed Phase 5 baseline

Implementation follow-up: Phases 6.2 through 6.5 were subsequently implemented and automated-QA-closed on the same branch. This document remains the normative rule baseline; current code, migration, and rollout status are recorded in `docs/2026-08-09-phase-6-closeout-handoff.md` and `CURRENT_TASK.md`.

## 1. Phase Boundary

Phase 6.1 defines and closes the Timeline time model and scheduling rules. It does not switch production or Demo behavior to the new scheduler.

The agreed delivery sequence is:

1. Phase 6.1: finalize the time model, Planner contract, overflow behavior, fixed/untimed/transport rules, and concurrency contract.
2. Phase 6.2: implement the unified Planner and its lower-level scheduling core behind tests, without routing live UI operations to it.
3. Phase 6.3: route single-card time editing and timed/untimed transitions through the Planner.
4. Phase 6.4: route transportation mutations and drag reorder through the Planner.
5. Phase 6.5: full QA, regression, migration closeout, and documentation closeout.

Small preparation work is allowed before live integration, such as contract fixtures, tests, schema/type normalization, and explicit deprecation markers for tail-transport logic. Phase 6.1 must not change formal scheduling behavior.

## 2. Core Direction

All operations that affect time or card adjacency must ultimately use one scheduling Planner. Individual features must not independently implement continuation, overflow, or downstream time-shift logic.

The Planner is a pure calculation boundary. It:

- receives a normalized Day snapshot plus one operation;
- validates the requested operation against the snapshot;
- calculates new item times;
- detects fixed-anchor or day-boundary overflow;
- reports all affected items and transport side effects;
- does not read from or write to Supabase;
- does not display UI or request confirmation.

Snapshot loading, row locking, revision validation, confirmation UI, and persistence belong to outer adapters and transaction/RPC wrappers.

## 3. Canonical Time States

A destination/visit card has exactly one of two valid persisted time states.

### Timed

Both values exist:

- `start_time`
- `end_time`

The range must be valid and have positive duration.

### Untimed

Both values are absent:

- `start_time = null`
- `end_time = null`

### Invalid partial time

Exactly one of `start_time` or `end_time` is present. Partial time is not a third state and must never be produced by the Planner or accepted as a successful Phase 6 write result.

Legacy partial rows must be treated as invalid input requiring normalization or user correction. They must not be silently converted to untimed as a general fallback.

Only a Timed card can be an effective fixed scheduling anchor. A legacy Untimed row with `is_fixed = true` is not an active anchor and must be normalized safely during the later migration/integration phase.

## 4. Scheduling Vocabulary

- **Visual order**: the stable Day Board order of destination cards, including Untimed cards in their preserved positions.
- **Timed sequence**: Timed destination cards encountered in visual order.
- **Operation start**: the earliest visual position whose schedule may change for the requested operation.
- **Affected segment**: the schedulable region from the operation start up to, but not including, the next fixed anchor; the end of day is an implicit final anchor.
- **Schedule cursor**: the earliest legal start for the next Timed card, derived from the previous Timed card's end plus an effective transport duration when applicable.
- **Historical gap**: unused time that existed between Timed cards before the operation. Historical gaps inside the affected segment are not preserved.
- **Effective transport**: a valid transport card connecting the immediately relevant `from_item` and `to_item`, with both endpoints Timed and no Untimed card interrupting that relationship.

If the affected segment begins at the start of the day and no preceding Timed card exists, the first affected Timed card keeps the start represented by the operation or by the existing first affected time slot. The Planner does not move an otherwise unanchored segment to `00:00`.

## 5. Base Continuation Rule

Within the affected segment, Timed cards are packed without preserving historical gaps.

Without an effective transport:

```text
next.start = previous.end
```

With an effective transport:

```text
next.start = previous.end + transport.duration
```

For every existing Timed destination, duration is preserved:

```text
duration = original.end - original.start
next.end = next.start + duration
```

The Planner recalculates `start_time` and `end_time`. It never shortens a visit duration automatically.

## 6. Scheduling Scope

Only the operation start and the later affected segment may change.

Before the operation start, the Planner preserves:

- card times;
- user-created gaps;
- fixed cards;
- ordering;
- transport data.

Inside the affected segment, historical gaps are removed. A fixed anchor stops the segment. Nothing after that fixed anchor changes as a result of the earlier operation.

## 7. Single-Card Time Editing

For an existing destination card:

- the user's complete target time is authoritative for the target card;
- the earlier segment never moves;
- downstream continuation begins at the first following Timed destination;
- later cards may move earlier or later;
- downstream duration remains unchanged;
- downstream historical gaps are removed.

### Earlier conflict

The edit is rejected when the target starts before its earliest reachable time.

```text
earliest target start = previous Timed end + effective transport duration
```

When no effective transport applies, the previous Timed end is the earliest start. The Planner must not move earlier cards to accommodate the edit.

Untimed cards are transparent while finding the previous Timed card, but transport cannot bridge across an Untimed card. Therefore a transport whose relationship is interrupted by Untimed content does not contribute duration.

### Later overlap

A later overlap does not reject the edit. The Planner shifts following Timed cards to make room.

Example:

```text
A 09:00-10:00
B 10:00-11:00
C 11:00-12:00

Edit A to 09:00-10:30

A 09:00-10:30
B 10:30-11:30
C 11:30-12:30
```

Shortening the target pulls the downstream segment earlier by the same continuation rules.

## 8. New Destinations

Adding a new destination keeps the current pre-Phase-6 behavior and is not part of the auto-continuation refactor:

- the user chooses its time;
- overlap with an existing Timed destination rejects the add;
- adding does not push other cards;
- existing save and ordering behavior remains authoritative;
- future insertion-specific scheduling is outside Phase 6.1.

## 9. Untimed to Timed

Restoring complete time to an Untimed card is treated as single-card time editing:

- the user's complete time is authoritative;
- earlier conflict rejects the operation;
- later overlap shifts the downstream segment;
- continuation starts at the first following Timed destination;
- fixed and day-boundary overflow rules apply.

A preserved transport connected to that card becomes effective again only when both endpoints are Timed and its pair relationship remains valid.

## 10. Timed to Untimed

An explicit user change from Timed to Untimed:

- clears both `start_time` and `end_time`;
- preserves the card's visual position;
- removes it from time calculation;
- recalculates from the first following Timed destination;
- removes downstream historical gaps;
- requires no extra confirmation by itself.

Connected transport rows remain stored but become suspended while either endpoint is Untimed. They are not deleted or reattached automatically.

## 11. Untimed as a Transparent Node

An Untimed destination:

- keeps its visual position;
- contributes no time or duration;
- is not a scheduling boundary;
- does not stop the search for the next Timed or fixed destination.

Transport cannot cross an Untimed destination. A transport with an Untimed endpoint, or whose pair is interrupted by Untimed placement, is suspended:

- it remains stored;
- it contributes no duration;
- it is not re-paired to different destinations.

## 12. Transportation Rules

Phase 6 removes the tail-transport model. The target model does not retain:

- `tail_pending`
- `tail_promoted_pair`

A transport card must connect two existing destination cards through `from_item_id` and `to_item_id`. For scheduling, both endpoints must be Timed and the pair must remain valid in visual order.

Removal of legacy tail roles requires an explicit data audit and migration plan in a later phase. Existing applied migrations must never be edited in place.

### Modify transport duration

- `from_item` and all earlier content remain unchanged.
- recalculation starts at `to_item`.
- increasing duration moves the downstream segment later.
- decreasing duration moves it earlier.
- historical gaps in the affected segment are removed.

### Add transport

- recalculation starts at `to_item`;
- the valid transport duration is included immediately;
- normal time-only shifts apply directly without another confirmation.

### Delete transport

- recalculation starts at the former `to_item`;
- downstream Timed destinations move earlier without the deleted duration;
- normal time-only shifts apply directly without another confirmation.

## 13. Drag Reorder

After a drag, the operation start is the earlier visual position of:

- the old location; and
- the new location.

The Planner recalculates from that point so one operation accounts for:

- the new adjacency;
- the gap left at the old location;
- intervening Timed cards;
- intervening transport pairs;
- historical gaps.

The start of the affected drag segment is anchored by the unchanged schedule cursor before it. If no earlier Timed card exists, the first affected time slot remains the segment start anchor.

When drag invalidates transport pairs, the existing transport-removal preview and confirmation flow remains the UX contract. The drag preview UI itself is not redesigned in Phase 6.

## 14. Fixed Anchors

A fixed Timed destination is an immovable scheduling anchor:

- the Planner never changes the fixed card's time or order;
- scheduling stops at the fixed card;
- content after it belongs to a separate segment;
- Untimed cards do not split a segment.

### Fixed overflow

When the affected Timed sequence no longer fits before the next fixed anchor:

1. keep every Timed card that legally fits;
2. starting with the first card that does not fit, convert that card and all later non-fixed Timed cards before the anchor to Untimed;
3. preserve their visual positions;
4. do not move them after the fixed anchor;
5. preserve connected transport rows but mark them suspended in the result;
6. leave the fixed card and everything after it unchanged.

Because the Planner creates additional Untimed cards, confirmation is required before applying this result.

## 15. Day Boundary

`24:00` is the exclusive end-of-day scheduling boundary and acts as an implicit final anchor. The Planner may produce a card ending exactly at 24:00, but never a result ending after it.

If the schedule would cross the boundary:

1. keep every Timed card that ends at or before 24:00;
2. starting with the first card ending after 24:00, convert it and every later Timed card that day to Untimed;
3. preserve visual positions;
4. do not move cards to another day;
5. preserve connected transport rows but report them as suspended;
6. require confirmation before apply.

Planner arithmetic should use integer minutes with `1440` as the boundary. Phase 6.2 tests must cover the exact 24:00 endpoint and the persisted time serialization used by the existing database/UI stack.

## 16. Allowed Automatic Untimed Reasons

The Planner may automatically convert Timed destinations to Untimed for exactly two reasons:

1. insufficient space before a fixed anchor;
2. crossing the 24:00 day boundary.

It must not use Untimed as a generic fallback for:

- earlier overlap;
- insufficient earlier transport time;
- overlap while adding a new destination;
- invalid time format;
- non-positive duration;
- partial time;
- stale operation data;
- revision mismatch;
- invalid transport endpoints or ordering.

Those conditions reject the operation or require a reload/re-preview.

## 17. Confirmation Rules

The existing confirmation surface is reused. Phase 6 does not add success toasts or lightweight completion messages.

No additional confirmation is required for:

- time-only earlier/later shifts;
- normal single-card extension or shortening;
- transport duration changes;
- valid transport add/delete;
- explicit Timed to Untimed;
- Untimed to Timed without overflow;
- transport suspension without deletion.

Confirmation is required when:

- the Planner converts additional Timed cards to Untimed;
- an operation removes existing transport cards;
- one operation combines multiple major side effects.

The Planner reports side effects and `requiresConfirmation`; the UI owns the dialog.

## 18. Collaboration and Authoritative Writes

Preview and authoritative apply are separate:

```text
load latest Day snapshot
-> calculate preview
-> show confirmation when required
-> user confirms
-> transaction/RPC locks and reloads authoritative rows
-> validate expected revision
-> recalculate from the latest snapshot
-> compare the latest effect with the confirmed effect
-> atomically apply or return a re-preview result
```

The frontend sends intent, not authoritative batch mutations:

- operation type;
- target item IDs;
- operation parameters;
- proposed order or transport change when applicable;
- expected Day snapshot revision.

The final RPC must not trust a frontend-generated `updatedItems` list. If the snapshot changed while a confirmation dialog was open:

- a materially changed result returns a re-preview requirement;
- an invalidated operation returns a reload/conflict result;
- stale preview output is never applied directly.

The revision contract must cover the full Day manifest, including insertions, deletions, ordering, destination timestamps, and transport timestamps. A per-row `updated_at` baseline map plus the exact Day item manifest is acceptable; a single edited-row timestamp is not sufficient.

Rows must be locked in a deterministic order and the transaction must contain no external calls or UI wait time.

## 19. Unified Planner Triggers

The unified Planner must support these operation intents:

- edit one destination's complete time;
- restore Untimed to Timed;
- explicitly clear Timed to Untimed;
- modify transport duration;
- add transport;
- delete transport;
- reorder destinations.

Each feature supplies only its intent, operation start, user-authoritative values, proposed order/transport mutation, and expected revision. Continuation, overflow, affected-item summaries, and confirmation classification belong to the Planner.

Adding a new destination remains outside this unified trigger list for Phase 6.

## 20. Planner Contract

Minimum normalized input:

```text
dayIndex
orderedItems
operation
expectedRevision (outer apply contract)
```

Recommended operation types:

```text
edit_time
restore_time
clear_time
upsert_transport
delete_transport
reorder
```

Minimum output:

```text
updatedItems
untimedItemIds
removedTransportIds
suspendedTransportIds
stoppedAtFixedItemId
overflowReason
requiresConfirmation
```

Recommended additional output:

```text
affectedItemIds
operationStartIndex
validationError
revision
```

`overflowReason` is one of:

```text
fixed
day_boundary
null
```

The result must be deterministic for the same normalized snapshot and operation.

## 21. Phase 6.1 Acceptance

Phase 6.1 is complete when:

- this document is accepted as the scheduling source of truth;
- `CURRENT_TASK.md` points to it;
- the Phase 6.2 implementation prompt/task breakdown exists;
- runtime code, migrations, and production data remain unchanged;
- Phase 6.2 is explicitly marked not started.
