# CURRENT_TASK.md

## Read First

- `AGENT.md`
- `docs/UX_RULES.md`
- `docs/BUGS.md`
- `docs/gpt/timeline-phase-4-plan.md`
- `docs/gpt/2026-06-22-phase-4-2c-closeout-handoff.md`
- `docs/gpt/2026-06-23-phase-4-4-closeout-handoff.md`

## Current Phase

```text
Timeline Phase 4.4 - Completed / Automated QA Passed / User Verified
```

Next phase:

```text
Awaiting user direction
```

Branch:

```text
codex/timeline-phase-4-0-to-4-2
```

## Completed Scope

### Phase 4.0 to 4.2c

- Completed Phase 4 analysis and protected-scope audit.
- Added valid tail transportation cards with `to_item_id = null`.
- Defined destination packages and child relationship behavior.
- Added insertion-style timed-visit destination-package reorder.
- Kept visit IDs and time slots fixed during reorder.
- Alternatives and linked budgets follow destination packages.
- Invalidated transportation cards are removed; replacements are never generated automatically.
- Formal reorder uses the applied 020/021 RPC path; Demo uses shared pure planning logic and local React state.

### Phase 4.3

- Added the timed-visit prompt when a new or edited visit breaks an existing normal transportation pair `A -> B`.
- Existing invalid-time and same-day-overlap validation remains higher priority.
- Restore keeps the editor open without saving or deleting transportation.
- Delete Transportation saves the visit and removes the broken transportation card.
- Formal preserves draft, edit-lock, optimistic-locking, Realtime reload, and failure safety behavior.
- Demo provides matching behavior using mock data and local React state only.
- Tail transportation is outside the Phase 4.3 prompt scope.

### Phase 4.4

- Added explicit local auto-continuation after editing an existing timed visit's `start_time` or `end_time`.
- The editor actions are ordered `取消 / 接續 / 儲存`.
- Normal Save updates only the edited visit and never opens the continuation prompt.
- Continue is enabled only after the existing timed visit's time changes and a later timed visit exists.
- Continue runs invalid-time, overlap, and Phase 4.3 transportation-pair checks before showing the confirmation.
- Cancelling the continuation confirmation returns to the active editor without saving.
- Confirming continuation shifts following timed visits while preserving each original visit duration and the original gap between visits.
- Earlier visits and untimed visits are never shifted.
- A final open-ended timed visit may move while keeping `end_time = null`.
- The first following fixed visit is a time anchor and is never moved.
- Movable visits that cannot fit before the fixed anchor, plus the remaining affected visits before that anchor, become untimed.
- Continuation stops at the fixed anchor; visits after it are unchanged.
- Foreign-locked, incomplete, invalid, or unsafe continuation data still blocks the batch safely.
- Formal validates trip/day/type/fixed/lock/`updated_at` baselines and defers lock release until the combined operation completes.
- Formal uses best-effort compensation if a downstream update or Phase 4.3 transportation deletion fails.
- Demo shares the pure continuation planner and applies the result in one local React-state update.
- No database migration or RPC change was required.
- User manually verified the final Phase 4.4 UX on 2026-06-23.

## Production Migration State

Applied immutable migrations:

```text
019 / 20260621131905 / swap_itinerary_destination_packages
020 / 20260622130246 / reorder_itinerary_destination_packages
021 / 20260622131013 / fix_reorder_baseline_count
project: lqvuqamzmchepgxkftcw
```

Important:

- Never edit applied migrations 019, 020, or 021 in place.
- Any future schema/RPC/permission correction must use migration 022+.
- Phase 4.3 and 4.4 required no migration.

## Phase 4.4 Changed Files

- `src/App.jsx`
- `src/lib/timelineAutoContinuation.js`
- `tests/phase-1-7f-smoke.spec.js`
- `tests/phase-4-3-transport-conflict.spec.js`
- `tests/phase-4-4-auto-continuation.spec.js`
- `CURRENT_TASK.md`
- `docs/gpt/2026-06-23-phase-4-4-closeout-handoff.md`

## Verification

Final checks on 2026-06-23:

```text
npm.cmd run build       passed
npx.cmd playwright test passed 54/54
git diff --check        passed
manual user verification passed
```

Browser verification also passed on `/demo/timeline`:

- The editor rendered `取消 / 接續 / 儲存` in the required order.
- Save did not open the continuation prompt.
- Continue opened the short confirmation only after a valid time change.
- Fixed-anchor overflow converted affected movable visits to untimed without moving the fixed visit.
- The page had meaningful content and no Vite error overlay.
- No browser console errors were detected.
- Demo made no Supabase/Auth/Realtime/Storage/Draft/Edit Lock requests in automated coverage.
- Existing Phase 4.2c drag-reorder and Phase 4.3 conflict tests did not regress.

The Vite build still reports the existing large-chunk warning; it is not a Phase 4.4 regression.

## Protected Scope Preserved

Phase 4.4 did not redesign or extend:

- Auth / Google OAuth
- Realtime subscription architecture
- Draft Autosave or Edit Lock architecture
- Share / Invite / member flow
- Budget core data flow
- drag-reorder RPC behavior
- generic `sort_order` architecture
- transportation pair splitting or creation
- Google Map API or route calculation
- untimed or cross-day continuation
- Demo isolation

## Residual Risks

- Formal continuation currently uses guarded client-side row updates rather than a database transaction because Phase 4.4 explicitly required no migration. Failure handling performs best-effort reverse compensation, but an extreme network failure during both the forward update and compensation can still leave partial authoritative updates.
- Concurrent changes are guarded by `updated_at`, fixed-state, and active-lock validation, but unrelated writers that do not participate in those contracts remain an external risk.
- The existing native HTML drag accessibility limitations from Phase 4.2c remain outside Phase 4.4.

## Next Step

Wait for the next explicitly approved Timeline phase. Do not infer or implement additional scheduling, transportation repair, route calculation, or database changes without new instructions.
