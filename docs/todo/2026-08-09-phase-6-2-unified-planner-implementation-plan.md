# Timeline Phase 6.2 | Unified Planner Implementation Prompt and Task Breakdown

Status: Completed historical implementation plan; superseded by `docs/2026-08-09-phase-6-closeout-handoff.md`
Depends on: `docs/2026-08-09-phase-6-1-time-model-and-auto-scheduling-rules.md`
Target branch: `codex/timeline-phase-6-2`, created from the verified Phase 6.1 closeout baseline when the user starts Phase 6.2

Outcome note: The user expanded scope to complete Phases 6.2 through 6.5 in one working branch. The runtime integration, migrations, regression updates, and closeout therefore landed together on `codex/timeline-phase-6-1`; the branch split and stop conditions below are retained only as historical planning context, not current instructions.

## Copy-Paste Implementation Prompt

Implement Timeline Phase 6.2: the unified scheduling Planner and lower-level scheduling core.

Before implementation, confirm Phase 6.1 has been reviewed and published, then create/switch to `codex/timeline-phase-6-2` from that verified baseline. Do not implement Phase 6.2 while the documentation-only Phase 6.1 branch is still awaiting closeout.

Read before editing:

1. `AGENT.md`
2. `docs/UX_RULES.md`
3. `docs/BUGS.md`
4. `CURRENT_TASK.md`
5. `docs/2026-08-09-phase-6-1-time-model-and-auto-scheduling-rules.md`
6. `docs/timeline-phase-4-drag-reorder-rules-draft-v14.md`
7. the current implementations and tests listed under "Repository Map" below

Phase boundary:

- Phase 6.2 builds the unified Planner contract, pure scheduling calculation, authoritative transaction design, and exhaustive contract tests.
- Do not route live single-card editing through it yet; that belongs to Phase 6.3.
- Do not route live transport mutations or drag reorder through it yet; that belongs to Phase 6.4.
- Do not remove the existing Phase 4/5 runtime paths while they remain the production fallback.
- Do not apply production migrations in this phase unless the user separately approves deployment.
- Do not change Demo, Share, Auth, Realtime presence, route-node collaboration, Budget, or map behavior.

Required result:

1. One deterministic Planner contract accepts a normalized Day snapshot plus one operation intent.
2. It implements the approved Timed/Untimed, no-gap continuation, duration preservation, transport, fixed overflow, 24:00 overflow, and confirmation-classification rules.
3. It never reads/writes Supabase and never opens UI.
4. A transaction/RPC design can reload and lock the latest Day rows, verify a full-Day revision, rerun the same Planner semantics, and atomically apply only a still-valid result.
5. Frontend preview data is never treated as authoritative write input.
6. Existing live behavior remains unchanged until Phases 6.3 and 6.4 explicitly switch callers.

Validation must include focused Planner tests, existing Phase 4 time/reorder tests, full Playwright regression, production build, and `git diff --check`. Report any skipped database-local validation explicitly.

## Repository Map

Current logic is split across these files and must be understood before implementation:

- `src/lib/timelineAutoContinuation.js`
  - current single-edit continuation preview;
  - preserves historical gaps, which Phase 6 replaces inside the affected segment;
  - currently returns frontend batch updates.
- `src/lib/timelineUntimedOrdering.js`
  - visual interleaving and stable Untimed positions;
  - conversion sort-order planning;
  - mixed timed/untimed drag planning.
- `src/lib/timelineTransportationRoles.js`
  - current `normal_pair`, `tail_pending`, and `tail_promoted_pair` model;
  - tail roles are deprecated by the approved Phase 6 target but cannot be removed without audit/migration.
- `src/lib/timelineTransportationConflicts.js`
  - existing drag/edit pair-break detection and transport confirmation inputs.
- `src/lib/timelineTime.js`
  - existing small time helper surface.
- `src/App.jsx`
  - current formal save batching/compensation;
  - existing auto-continuation confirmation UI;
  - Demo local mutations;
  - existing reorder and transport handlers.
- `supabase/migrations/023_reorder_itinerary_timed_auto_continuation.sql`
  - current timed reorder scheduling RPC.
- `supabase/migrations/024_reorder_itinerary_fixed_anchor_continuation.sql`
  - current fixed-anchor continuation/overflow RPC.
- `tests/phase-4-4-auto-continuation.spec.js`
  - current single-edit continuation expectations, including historical-gap preservation that Phase 6 intentionally supersedes only after integration.
- `tests/phase-4-5-untimed-ordering.spec.js`
  - mixed visual order, Untimed slot, fixed, and tail-role coverage.
- `tests/phase-4-destination-package.spec.js`
  - destination-package and protected-field guards.

Do not edit applied migrations 019 through 024. Any database implementation must be a new timestamped migration.

## Architecture Constraint

The formal preview and final transaction must share one semantic contract. Before coding, choose and document one of these executable arrangements:

### Preferred arrangement

- A pure private Postgres Planner function accepts a normalized JSON Day snapshot and operation JSON and returns the Planner result JSON.
- A read-only preview wrapper loads the latest permitted Day snapshot and calls the pure function without mutation.
- A final apply RPC locks Day rows in deterministic ID order, validates the full-Day revision, calls the same pure function, compares the newly calculated major effects with the confirmed preview, and applies atomically.
- The frontend uses the returned contract and does not send `updatedItems` as authority.

This arrangement minimizes preview/apply semantic drift in the formal app. If a JavaScript reference Planner is also built for isolated tests or future Demo behavior, shared golden fixtures must prove parity with the authoritative contract.

### Not acceptable

- keeping independent scheduling algorithms in every UI feature;
- accepting a frontend-calculated batch as the final database mutation;
- validating only the target item's `updated_at`;
- applying part of a multi-item schedule and compensating with best-effort client rollback as the final Phase 6 architecture;
- waiting for user confirmation inside an open transaction;
- modifying already-applied migrations.

## Proposed Planner Input Contract

Use plain serializable data. Exact field names may be refined once, then frozen by tests.

```js
{
  dayIndex: 0,
  orderedItems: [
    {
      id: "uuid",
      itemType: "visit" | "transport",
      visualIndex: 0,
      startTime: "09:00" | null,
      endTime: "10:00" | null,
      isFixed: false,
      sortOrder: 10,
      updatedAt: "...",
      fromItemId: null,
      toItemId: null,
      transportDurationMinutes: 0
    }
  ],
  operation: {
    type: "edit_time" | "restore_time" | "clear_time" | "upsert_transport" | "delete_transport" | "reorder",
    targetItemId: "uuid" | null,
    targetStartTime: "09:30" | null,
    targetEndTime: "10:30" | null,
    transport: null,
    orderedVisitIds: null,
    oldVisualIndex: null,
    newVisualIndex: null
  }
}
```

Normalization rules:

- convert time strings to integer minutes once;
- classify every destination as Timed, Untimed, or invalid partial;
- reject partial/non-positive ranges before scheduling;
- treat only `item_type === "transport"` as a transport card;
- treat fixed as effective only for a complete Timed destination;
- derive effective transport only from valid endpoints and current visual adjacency;
- keep Untimed visual order stable;
- use `1440` as the day boundary;
- avoid mutating input objects.

## Proposed Planner Output Contract

```js
{
  ok: true,
  updatedItems: [
    { id: "uuid", startTime: "10:00", endTime: "11:00" }
  ],
  affectedItemIds: ["uuid"],
  untimedItemIds: [],
  removedTransportIds: [],
  suspendedTransportIds: [],
  stoppedAtFixedItemId: null,
  overflowReason: null,
  operationStartIndex: 1,
  requiresConfirmation: false
}
```

Validation failure:

```js
{
  ok: false,
  validationError: "partial_time" | "invalid_range" | "earlier_conflict" | "invalid_transport" | "stale_revision" | "invalid_operation",
  affectedItemIds: [],
  requiresConfirmation: false
}
```

Use explicit error codes; UI wording belongs to Phase 6.3/6.4 adapters.

## Full-Day Revision Contract

The concurrency token must detect:

- changed timestamps;
- new or removed Day items;
- changed visual/order manifest;
- changed destination times/fixed state;
- changed transport endpoints or duration.

Recommended initial representation:

```js
{
  itemIds: ["ordered", "day", "manifest"],
  updatedAtById: { "uuid": "timestamp" }
}
```

The preview returns this revision. The final apply RPC receives it as an expected revision, locks all relevant Day rows in deterministic `id` order, rebuilds the authoritative revision, and compares the full manifest and timestamp map.

After revision validation, the RPC must rerun the Planner using locked authoritative rows. If the new Planner result changes any confirmed major side effect (`untimedItemIds` or `removedTransportIds`), return `repreview_required` with the new preview and do not mutate.

## Task Breakdown

### Task 6.2-A | Freeze contract fixtures

- Add table-driven fixtures covering normalized Day snapshots, operations, expected results, and explicit error codes.
- Keep fixtures independent from React and Supabase clients.
- Include both compact unit cases and multi-card mixed Timed/Untimed/transport cases.
- Freeze input/output naming before wiring callers.

Acceptance:

- fixtures express every approved Phase 6.1 rule;
- no fixture relies on current historical-gap preservation;
- input mutation is tested and rejected.

### Task 6.2-B | Build time primitives and normalization

- Add strict `HH:mm` parsing/formatting for `00:00` through the 24:00 boundary rules.
- Represent calculations as integer minutes.
- Classify Timed/Untimed/partial.
- Calculate positive destination duration.
- Normalize visual order and transport metadata.
- Derive effective versus suspended transports without crossing Untimed nodes.

Acceptance:

- partial time is an error, never a fallback;
- end before/equal start is rejected;
- exact end at 24:00 is covered;
- no item other than true `item_type === "transport"` is treated as transport.

### Task 6.2-C | Implement the pure segment scheduler

- Calculate the operation start.
- Establish the schedule cursor from the unchanged predecessor or first affected slot.
- Pack Timed destinations without historical gaps.
- Preserve destination durations.
- Stop at a fixed anchor.
- Convert only the fixed/day-boundary overflow suffix to Untimed.
- Preserve visual positions.
- Report suspended transport IDs.
- Produce deterministic, minimal updates.

Acceptance:

- earlier cards and gaps remain untouched;
- affected historical gaps are removed;
- fixed and post-fixed content is unchanged;
- output ordering is stable;
- identical input produces identical output.

### Task 6.2-D | Implement operation adapters inside the Planner boundary

Support and test:

- `edit_time`;
- `restore_time`;
- `clear_time`;
- `upsert_transport`;
- `delete_transport`;
- `reorder`.

The adapters may transform intent into one normalized proposed snapshot and operation start, but must all call the same segment scheduler.

Adding a new destination stays on the old path and is not implemented here.

Acceptance:

- no operation duplicates downstream scheduling logic;
- edit/restore reject earlier conflict;
- clear starts continuation at the first later Timed destination;
- transport changes start at `to_item`;
- reorder starts at `min(oldVisualIndex, newVisualIndex)`;
- transport deletions and automatic Untimed changes classify confirmation correctly.

### Task 6.2-E | Define the authoritative transaction/RPC core

- Add only new timestamped migration files.
- Keep the pure calculation function free of table reads/writes.
- Make the preview wrapper readonly.
- In apply, authorize the trip/day through the existing RLS/helper model.
- Lock all relevant Day rows in deterministic ID order.
- validate the full-Day revision.
- rerun the Planner after locking.
- compare major effects with the confirmed preview summary.
- update all destination/transport rows atomically.
- return authoritative result/revision.
- grant execute only to `authenticated`; revoke broader/default execute as appropriate.
- keep the transaction short and free of network/external calls.

If local Supabase is unavailable, complete the SQL as an unapplied migration plus source/contract tests and clearly record that live RPC execution remains unverified.

Acceptance:

- no partial batch apply is possible;
- stale or changed preview cannot write;
- insert/delete manifest drift is detected;
- affected updates are set-based or deterministically locked;
- permissions follow least privilege;
- existing migrations are untouched.

### Task 6.2-F | Preserve runtime isolation

- Do not connect `src/App.jsx` save, transport, or reorder handlers to the new Planner yet.
- Do not delete `timelineAutoContinuation.js` or existing RPC callers.
- If an import or adapter must be added for compile-time validation, keep it unreachable behind tests and document it.
- Do not alter confirmation copy or Demo behavior.

Acceptance:

- current formal and Demo flows behave exactly as before;
- existing Phase 4/5 regression tests still pass unchanged except for clearly intentional contract-test additions;
- no production data path calls the Phase 6 core.

### Task 6.2-G | Documentation and handoff

- Update `CURRENT_TASK.md` with actual verified completion state.
- Add a Phase 6.2 handoff describing files, contract, test matrix, migration state, and Phase 6.3 entry points.
- Record whether SQL was only source-validated, applied locally, or applied remotely.
- Keep Phase 6.3 marked not started.

## Required Test Matrix

### Time state and validation

- Timed has both values.
- Untimed has neither value.
- start-only rejects.
- end-only rejects.
- zero/negative duration rejects.
- malformed time rejects.
- exact 24:00 end succeeds.
- result beyond 24:00 overflows.

### Continuation

- no transport packs next start to previous end.
- valid transport adds duration.
- destination durations remain unchanged.
- historical gaps before operation start stay.
- historical gaps after operation start disappear.
- an operation on the final Timed card produces no downstream changes.

### Single edit

- earlier conflict rejects without moving predecessors.
- later overlap shifts followers.
- shortening pulls followers earlier.
- restoring Untimed behaves like edit.
- explicit clear preserves visual position and repacks later Timed cards.

### Untimed and transport

- Untimed is transparent to Timed continuation.
- transport does not cross Untimed.
- transport with an Untimed endpoint is suspended.
- suspended transport is preserved, not removed.
- add/modify/delete transport starts at `to_item`.
- tail-role fixtures are identified as legacy/deprecated and do not become effective Phase 6 transport.

### Fixed and boundary overflow

- fixed card never moves.
- scheduling stops at fixed.
- content after fixed remains byte-for-byte unchanged in the result.
- overflow suffix becomes Untimed.
- fitting prefix remains Timed.
- day-boundary overflow matches fixed overflow semantics.
- no automatic cross-day move occurs.
- only overflow may automatically create Untimed cards.

### Reorder

- operation start is the earlier old/new index.
- predecessor before operation start remains unchanged.
- old-location gap and new adjacency both recalculate.
- broken transport IDs are reported.
- pure time shifts do not require confirmation.
- transport removal does require confirmation.

### Collaboration

- changed timestamp rejects/re-previews.
- inserted item rejects/re-previews.
- deleted item rejects/re-previews.
- changed order rejects/re-previews.
- confirmation side-effect change returns new preview without writing.
- valid unchanged revision applies atomically.

## Verification Commands

Use Windows-safe commands:

```powershell
npx.cmd playwright test tests/phase-6-2-timeline-schedule-planner.spec.js
npx.cmd playwright test tests/phase-4-4-auto-continuation.spec.js tests/phase-4-5-untimed-ordering.spec.js tests/phase-4-destination-package.spec.js
npx.cmd playwright test
npm.cmd run build
git diff --check
git status --short --branch
```

If database contract tests are added, list their exact command and result separately. Do not imply that an unapplied migration has been verified against production.

## Stop Conditions

Stop and request direction before:

- changing the approved Phase 6.1 rules;
- introducing a new Day table or broad schema redesign;
- applying a migration to production;
- removing legacy tail transport data without a verified audit/migration plan;
- changing add-destination behavior;
- changing confirmation UX;
- connecting Phase 6 logic to live single-edit, transport, or drag flows during Phase 6.2;
- modifying Auth, RLS architecture, Share/Invite, Budget, map/route collaboration, or Demo production-isolation contracts.

## Phase 6.2 Definition of Done

- unified Planner contract is frozen and fully tested;
- every Phase 6.1 scheduling rule has at least one focused fixture;
- authoritative preview/apply transaction design exists and is source-validated;
- revision coverage includes full Day manifest and timestamps;
- existing live paths are unchanged;
- no applied migration was edited;
- full required validation passes or every skipped check is explicit;
- handoff identifies exact Phase 6.3 integration points;
- Phase 6.3 remains not started.
