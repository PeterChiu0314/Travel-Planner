# Timeline Phase 4.5 Hotfix 3 Handoff

Date: 2026-06-24

## Status

```text
Timeline Phase 4.5 Hotfix 3 - Implemented
Browser QA - Passed
Build QA - Passed
Manual verification - Pending
```

## Scope

Hotfix 3 stabilizes only:

1. retained tail transportation restoring after its endpoint returns from untimed to timed;
2. disabling Phase 4.4 continuation when an edited visit crosses a fixed timed visit.

It does not implement Phase 4.6 timed drag, Phase 4.7 fixed-anchor drag, presence, maps, route planning, migrations, RPCs, or schema changes.

## Tail Transportation Restore

The existing classification path is retained and verified:

- while the tail endpoint is untimed, the transportation row stays anchored after its `from_item_id` visit with `untimed-warning`;
- when the endpoint becomes timed and remains the final timed visit, the same `from_item_id -> null` row returns to `tailTransportByFrom`;
- it does not enter the invalid transportation stack;
- it is not deleted, rewritten, or converted into a normal pair.

If a restored normal transportation pair has insufficient time, the existing shortage warning remains warning-only. An open tail has no destination time against which to calculate shortage.

## Fixed Crossing and Continuation

The Timeline editor compares the original visit range, candidate range, and every same-day fixed timed range.

Continuation is disabled only when the visit moves completely from one side of a fixed visit to the other:

```text
originally before fixed + candidate after fixed
or
originally after fixed + candidate before fixed
```

The disabled button uses:

```text
跨越固定行程時無法接續。
```

Direct Save remains enabled. Invalid ranges and overlaps continue to use their existing validation; a non-overlapping move across a fixed visit saves normally without running auto-continuation.

## Transportation Endpoint Conflict Stabilization

The existing Phase 4.3 planner now compares every currently valid adjacent normal transportation pair with the complete candidate timed order. It therefore detects both:

- a new or edited visit inserted between another pair;
- editing either endpoint so that its own original pair is no longer adjacent.

Before persistence, a broken endpoint pair opens the existing Restore / Delete Transportation dialog. Restore leaves the editor open without saving or deleting the transportation. Delete Transportation keeps the visit change and removes only the broken transportation through the existing guarded flow. A candidate that becomes untimed remains passive conversion and does not open this prompt.

## Files Changed

- `src/App.jsx`
- `src/lib/timelineTransportationConflicts.js`
- `CURRENT_TASK.md`
- `docs/2026-06-24-phase-4-5-hotfix-3-handoff.md`

The broader uncommitted Phase 4.5 stabilization work remains intact. No Playwright test file was added or modified.

## Browser QA

- Created a tail transportation after the final timed visit.
- Converted its endpoint to untimed: the row stayed as a passive `untimed-warning` and did not enter the invalid stack.
- Restored the endpoint time while it remained final: the row returned to a normal tail card and the invalid stack stayed empty.
- Locked a same-day fixed visit, moved an earlier visit to a non-overlapping time after it, and confirmed `接續` was disabled with the expected explanation.
- Confirmed `儲存` remained enabled and successfully moved the visit across the fixed visit.
- Edited a normal transportation endpoint to a non-overlapping time that broke adjacency and confirmed the existing Restore / Delete Transportation dialog opened before save.
- Confirmed Restore kept the editor open and preserved the transportation row.
- Browser console contained no warnings or errors.

## Verification

```text
npm.cmd run build passed
git diff --check  passed
full Playwright     not run per instruction
```

## Residual Risks

- Native HTML drag accessibility remains outside this stabilization scope.
- Formal multi-row position rebasing remains guarded client-side persistence with best-effort compensation rather than a new transaction RPC.
- Tail shortage cannot be calculated until a destination exists; normal restored pairs continue to use the existing shortage warning.
