# Timeline Phase 4.7 Closeout Handoff

Date: 2026-06-29
Branch: `codex/timeline-phase-4-7`
Status: Implemented locally / automated QA passed / production migration 024 applied

## Scope

Phase 4.7 implements fixed-anchor drag continuation segments on top of Phase 4.6 timed drag auto-continuation.

Implemented:

- Fixed anchors are only complete timed visits with `is_fixed = true`.
- Fixed anchors are not draggable and are not included in movable timed manifests.
- Non-fixed complete timed visits can be dragged across fixed anchors.
- Fixed anchors split a day into recalculation segments.
- Segment recalculation preserves each moved package duration.
- Same-direction adjacent source pairs preserve original total gap.
- New adjacencies and direction reversals directly continue.
- A segment with a left fixed anchor starts from the left anchor `end_time`.
- A segment with no left fixed anchor keeps the Phase 4.6 original first-slot start.
- A segment with a right fixed anchor cannot pass the anchor `start_time`.
- Overflow converts the first non-fitting timed visit and the remaining segment tail to untimed.
- Overflow conversion clears `start_time` / `end_time` and rebases untimed sort positions from the post-drag mixed visual order.
- A zero-space fixed segment returns the friendly message: `此區段沒有可插入的時間空間，請先調整固定行程，或改放到其他位置。`
- Existing `brokenTransportIds` confirmation remains the UI gate before transport cleanup.
- No new transportation cards are generated.
- Legacy fixed untimed rows remain non-anchors and movable as untimed rows.

Not implemented:

- Phase 4.8 collaborative drag presence.
- Phase 4.9 map integration.
- Transportation role model refactor.

## Code Changes

- `src/lib/destinationPackages.js`
  - Adds fixed-aware `planTimedDragAutoContinuation`.
  - Keeps the no-fixed path compatible with Phase 4.6.
  - Adds fixed-segment overflow conversion and untimed sort-order preservation.
  - Preserves/deletes transportation cards from the post-drag mixed visual order.

- `src/lib/timelineUntimedOrdering.js`
  - Adds `planUntimedSortOrdersForVisualOrder`.
  - Changes timed drag manifests to include only non-fixed timed visits while also returning full `orderedTimedItemIds` and `orderedVisitItemIds`.

- `src/App.jsx`
  - Removes the old "any fixed timed visit blocks all timed drag" guard.
  - Keeps fixed anchors themselves non-draggable.
  - Sends fixed-aware timed drag requests to `reorder_itinerary_fixed_anchor_continuation`.
  - Includes `untimed_sort_order_updates` in the timed-drag RPC payload so Formal can remain transactional.
  - Maps `fixed_segment_no_space` to a friendly UI message.

- `supabase/migrations/024_reorder_itinerary_fixed_anchor_continuation.sql`
  - Adds `app_private.reorder_itinerary_fixed_anchor_continuation`.
  - Adds public wrapper `public.reorder_itinerary_fixed_anchor_continuation`.
  - Keeps permission, day, manifest, baseline, edit-lock, fixed-state, transport baseline, and transactional cleanup checks.

- Tests updated:
  - `tests/phase-4-2c-reorder.spec.js`
  - `tests/phase-4-5-untimed-ordering.spec.js`
  - `tests/phase-1-7f-smoke.spec.js`

## Supabase State

Local migration file:

```text
supabase/migrations/024_reorder_itinerary_fixed_anchor_continuation.sql
```

Remote validation performed:

```text
BEGIN;
<024 SQL>
ROLLBACK;
```

Result: Postgres accepted the SQL and returned no error.

Production migration applied after explicit owner authorization:

```text
project: lqvuqamzmchepgxkftcw
version: 20260629065754
name: timeline_phase_4_7_fixed_anchor_continuation
```

Post-apply verification:

```text
app_private.reorder_itinerary_fixed_anchor_continuation exists with the expected signature
public.reorder_itinerary_fixed_anchor_continuation exists with the expected signature
notify pgrst, 'reload schema' was sent to refresh the PostgREST schema cache
```

## Verification

Passed:

```text
npm.cmd run build
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js
npx.cmd playwright test tests/phase-4-5-untimed-ordering.spec.js --grep-invert demo
npx.cmd playwright test tests/phase-4-4-auto-continuation.spec.js
npx.cmd playwright test tests/phase-4-3-transport-conflict.spec.js
npx.cmd playwright test tests/phase-4-5-untimed-ordering.spec.js --grep demo
npx.cmd playwright test tests/phase-1-7f-smoke.spec.js --grep "demo timed visit drag recalculates"
npm.cmd run test:e2e
git diff --check
```

Full e2e result:

```text
77 passed
```

`git diff --check` only reported expected Windows LF/CRLF notices.

The Vite build still reports the existing large-chunk warning; it is not a Phase 4.7 regression.

## Residual Risk

- The RPC was syntax-compiled with `BEGIN/ROLLBACK` and applied to production, but it has not been exercised against real production trip data in this session.
- Manual authenticated Formal verification is still recommended after applying migration 024.

## Next Step

Rerun a small authenticated Formal smoke on a test trip before pushing/deploying.
