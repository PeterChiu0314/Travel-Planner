# Timeline Phase 4.5 Hotfix 2 Handoff

Date: 2026-06-24

## Status

```text
Timeline Phase 4.5 Hotfix 2 - Implemented
Build QA - Passed
Manual verification - Pending
```

## Goal

Prevent an untimed visit with linked transportation from carrying that stale relationship to a new display position during an active drag.

Passive conversion remains unchanged: clearing time, partial-time normalization, or fixed-anchor overflow still keeps existing transportation anchored near its `from_item_id` visit with the compact warning.

Passive conversion also keeps the converted visit in its current Timeline position by persisting the corresponding encoded untimed `sort_order`. It must not fall to the legacy untimed tail position merely because its times were cleared.

## Final Behavior

For an active untimed drag:

1. The existing target-position planner runs first.
2. A drop that would break a valid timed transportation pair is rejected immediately without a dialog or mutation.
3. A legal drop checks whether any transportation has `from_item_id` or `to_item_id` equal to the source visit ID.
4. If none exists, the existing untimed single-row reorder continues directly.
5. If linked transportation exists, the shared move confirmation dialog opens with unchanged copy:

```text
確認移動行程？
移動行程卡後，部分交通卡可能會自動移除
取消 / 確定
```

Cancel performs no move, deletion, local-state change, or Formal write.

Confirm:

- updates only the untimed source visit's `sort_order`;
- deletes every transportation row linked to the source in either direction;
- does not create replacement or tail transportation;
- does not modify timed visit times;
- does not trigger Phase 4.4 auto-continuation;
- does not call the Phase 4.2c timed destination-package reorder RPC.

## Formal Safety

Formal retains edit permission, active-editor, fixed, foreign-lock, saving-state, source `updated_at`, trip, day, item-type, and untimed-source guards.

Before writing, it verifies that the linked transportation manifest and each transportation `updated_at` baseline still match authoritative data. It then performs the guarded source `sort_order` update and one scoped delete for the confirmed transportation IDs.

Any update, baseline, or delete failure returns failure, keeps the lightweight notice path, and reloads authoritative trip data. If transportation deletion fails after the source update, Formal makes a best-effort guarded compensation to restore the original `sort_order` before reload.

No migration or RPC was added. Applied migrations 019, 020, and 021 remain unchanged and immutable.

## Demo Parity

`/demo/timeline` uses the same dialog and target-position rules. On confirmation it updates the source visit and removes the linked transportation rows in one local React-state update.

Demo does not call Supabase, Auth, Realtime, Storage, Draft Autosave, Edit Lock, or `localStorage`.

The passive-conversion position planner is scoped to the active day's `dayItems`. Passing the full multi-day Demo item collection polluted the encoded gap index and could make the second consecutively converted visit fall toward the end of the day.

## Files Changed

- `src/App.jsx`
- `src/lib/timelineAutoContinuation.js`
- `src/lib/timelineUntimedOrdering.js`
- `CURRENT_TASK.md`
- `docs/2026-06-24-phase-4-5-closeout-handoff.md`
- `docs/2026-06-24-phase-4-5-hotfix-2-handoff.md`

No automated test files were added or modified, per explicit instruction.

## Verification

```text
npm.cmd run build passed
git diff --check  passed
Demo consecutive passive-conversion browser QA passed
manual verification pending
```

Browser QA converted both endpoints of an existing transportation pair to untimed in sequence. Both visits remained in their original order, the transportation stayed anchored after its `from_item_id` visit, and the browser console reported no warnings or errors.

Browser QA also restored the two endpoint times in sequence. After restoring only the `from` endpoint, the still-untimed `to` visit remained after it instead of reversing ahead of it. After restoring both endpoints, the transportation returned to the normal adjacent flow and did not enter the invalid transportation stack.

An additional browser QA reproduced the fixed-anchor overflow sequence: delaying A and confirming continuation converted C to untimed before fixed D; subsequently converting B to untimed rebased both B and C, preserving `A, B, C, D, E`. C did not move below D, the retained transportation stayed in the passive warning flow, the invalid transportation stack stayed empty, and the console reported no warnings or errors.

The final rule is non-compacting: when B and C are restored to timed one at a time, every unrelated remaining untimed visit keeps its absolute display position. Browser QA confirmed the bottom untimed accommodation remained after E throughout both restores instead of moving upward toward D.

The existing Vite large-chunk warning remains non-blocking.

## Residual Risk

Formal uses a guarded source-row update followed by one scoped transportation delete statement rather than a new transaction RPC. A delete failure triggers best-effort `sort_order` compensation and authoritative reload, but an extreme network or concurrent-write failure during both the forward operation and compensation can still leave a partial authoritative result.

Native HTML drag remains primarily mouse/desktop oriented. Touch and keyboard-accessible reorder remain outside this Hotfix.

## Next-Step Boundary

Wait for manual verification. Do not implement Phase 4.6 timed drag auto-continuation, Phase 4.7 fixed-card drag anchors, Phase 4.8 drag presence, maps, route calculation, or transportation repair.
