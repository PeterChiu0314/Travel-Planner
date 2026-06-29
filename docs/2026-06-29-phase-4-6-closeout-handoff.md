# Timeline Phase 4.6 Closeout Handoff

Date: 2026-06-29
Project: Travel Planner
Status: Implemented; build and full E2E QA passed

---

## Scope Completed

Phase 4.6 implements timed visit drag auto-continuation.

Timed drag now moves itinerary intent rather than only swapping destination package content into old time slots. After a timed drag, the app recalculates the complete timed sequence and preserves each moved package's own original duration.

Rules implemented:

- Only complete timed visits (`start_time` and `end_time` both present) participate.
- Partial time / start-only / end-only rows remain untimed for duration-based continuation.
- The first new timed package uses the original first complete timed visit start time.
- Same-direction adjacent pairs that remain adjacent preserve their original total gap.
- New adjacencies and direction reversals directly continue from the previous package end.
- Untimed visits remain mixed-visual-order items only and do not create timing gaps.
- Existing `brokenTransportIds` confirmation/cleanup remains the only path for deleting broken `normal_pair` / `tail_promoted_pair` transports.
- No new transportation cards are generated.
- Fixed-card drag and fixed-anchor scheduling remain Phase 4.7 work.

---

## Implementation Notes

Pure planner:

- `src/lib/destinationPackages.js`
  - Added `planTimedDragAutoContinuation`.
  - Added optional `timedAutoContinuation` support to `planDestinationPackageReorder`.

Formal app:

- `src/App.jsx`
  - Timed drag payloads now set `timedAutoContinuation: true`.
  - Formal timed drag calls `reorder_itinerary_timed_auto_continuation`.
  - Untimed reorder and `brokenTransportIds` confirmation paths remain unchanged.

Demo:

- Demo timed drag uses the same pure planner through `timedAutoContinuation: true`.
- Demo smoke now expects duration-preserving recalculation instead of fixed time-slot swapping.

Database:

- Added `supabase/migrations/023_reorder_itinerary_timed_auto_continuation.sql`.
- Applied to production Supabase project `lqvuqamzmchepgxkftcw` as:

```text
20260629014908 / reorder_itinerary_timed_auto_continuation
```

The RPC is transaction-based and keeps the Phase 4.2c baseline/lock/transport safety shape:

- advisory day lock
- complete timed manifest validation
- `updated_at` baselines for timed visits and transports
- fixed item guard
- active foreign lock guard
- alternatives and budget links move with destination packages
- still-adjacent directed transports are preserved
- broken transports are deleted only through the existing confirmation path

---

## Tests Updated

- `tests/phase-4-2c-reorder.spec.js`
  - duration preservation
  - same-direction gap preservation
  - direction reversal direct continuation
  - partial-time rejection
  - 023 RPC static contract

- `tests/phase-1-7f-smoke.spec.js`
  - Demo timed drag now asserts Phase 4.6 duration-preserving times.

---

## Validation

Latest validation commands run in this session:

```text
npm.cmd run build
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js tests/phase-4-5-untimed-ordering.spec.js tests/phase-4-3-transport-conflict.spec.js tests/phase-1-7f-smoke.spec.js --grep "Phase 4.6|timed drag|untimed|transport|adjacent no-op|new timed visit|edited timed visit|tail promoted|formal"
npm.cmd run test:e2e
git diff --check
```

Results:

```text
build passed
targeted Playwright passed: 36/36
full Playwright passed: 71/71
git diff --check passed, with Windows LF/CRLF notices only
```

Vite still reports the existing large chunk warning; this is not a Phase 4.6 regression.

---

## Not Done

Deliberately deferred:

- Phase 4.7 fixed-anchor drag / cross-fixed scheduling.
- Phase 4.8 collaborative drag presence.
- Phase 4.9 map integration.
- Automatic creation of new transportation cards.
- Reworking the transportation role model.

---

## Next Recommended Step

Proceed to Phase 4.7 only after manual review confirms the Phase 4.6 drag behavior feels correct in Demo and Formal.
