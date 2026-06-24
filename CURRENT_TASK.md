# CURRENT_TASK.md

## Read First

- `AGENT.md`
- `docs/UX_RULES.md`
- `docs/BUGS.md`
- `docs/gpt/timeline-phase-4-plan.md`
- `docs/gpt/2026-06-22-phase-4-2c-closeout-handoff.md`
- `docs/gpt/2026-06-23-phase-4-4-closeout-handoff.md`
- `docs/gpt/2026-06-24-phase-4-5-closeout-handoff.md`
- `docs/gpt/timeline-phase-4-drag-reorder-rules-draft-v3.md`

## Current Phase

```text
Timeline Phase 4.5 + Partial-Time/Passive-Transport Hotfix - Implemented / Automated and Browser QA Passed / Manual Verification Pending
```

Next phase:

```text
Awaiting Phase 4.5 Hotfix manual verification or next explicit direction
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
- The original open-ended timed-visit behavior was superseded by the Phase 4.5 Hotfix: a visit missing either time is untimed.
- The first following fixed visit is a time anchor and is never moved.
- Movable visits that cannot fit before the fixed anchor, plus the remaining affected visits before that anchor, become untimed.
- Continuation stops at the fixed anchor; visits after it are unchanged.
- Foreign-locked, incomplete, invalid, or unsafe continuation data still blocks the batch safely.
- Formal validates trip/day/type/fixed/lock/`updated_at` baselines and defers lock release until the combined operation completes.
- Formal uses best-effort compensation if a downstream update or Phase 4.3 transportation deletion fails.
- Demo shares the pure continuation planner and applies the result in one local React-state update.
- No database migration or RPC change was required.
- User manually verified the final Phase 4.4 UX on 2026-06-23.

### Phase 4.5

- Added mixed same-day ordering for timed and untimed visits using the existing `itinerary_items.sort_order` field.
- Timed visits remain naturally ordered by `start_time`; untimed visits use a reserved negative `sort_order` encoding for their manual gap and rank.
- Active untimed drag changes only the source visit's display position and does not change timed visit times, destination packages, transportation cards, drafts, or locks.
- Active untimed drag into an existing valid transportation pair remains blocked with a lightweight inline message and no local/DB mutation.
- Formal untimed reorder is a guarded single-row update using trip/day/type/fixed/lock and `updated_at` checks; Demo uses shared pure planning and React local state only.
- Phase 4.5 initial automated QA passed 61/61 Playwright tests.

### Phase 4.5 Hotfix

- A visit is timed only when both `start_time` and `end_time` exist; all four complete/partial/empty combinations now use one shared classification.
- Clearing either time in the editor immediately clears the other; Formal and Demo save normalization persists either a complete pair or `null/null`.
- Partial visits do not participate in timed sorting, overlap, auto-continuation, transportation shortage, timed adjacency, or timed destination-package manifests.
- Passive untimed conversion is separate from active untimed drag. Existing transportation is not deleted, hidden, promoted to the top warning stack, rewritten as tail, or replaced.
- Transportation with an existing untimed/partial endpoint stays anchored after its `from_item_id` visit and shows the existing compact warning UI: `目的地時間未設定，請重新確認交通卡。`
- Phase 4.4 fixed-anchor overflow and manual time clearing therefore preserve related transportation for manual review.
- No migration, RPC, or production DB change was required. Applied migrations 019/020/021 remain immutable.
- Hotfix commit: `5b75450 Fix Timeline Phase 4.5 partial time handling`.

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
- Phase 4.3, 4.4, 4.5, and the Phase 4.5 Hotfix required no migration.

## Phase 4.5 and Hotfix Changed Files

- `src/App.jsx`
- `src/lib/destinationPackages.js`
- `src/lib/timelineAutoContinuation.js`
- `src/lib/timelineTransportationConflicts.js`
- `src/lib/timelineUntimedOrdering.js`
- `src/styles.css`
- `tests/phase-1-7f-smoke.spec.js`
- `tests/phase-4-5-untimed-ordering.spec.js`
- `CURRENT_TASK.md`
- `docs/gpt/2026-06-24-phase-4-5-closeout-handoff.md`
- `docs/gpt/timeline-phase-4-drag-reorder-rules-draft-v3.md`

## Verification

Phase 4.5 initial checks on 2026-06-24:

```text
npm.cmd run build       passed
npx.cmd playwright test passed 61/61
git diff --check        passed
```

Phase 4.5 Hotfix checks on 2026-06-24:

```text
targeted pure-helper sanity passed
Demo browser verification passed
npm.cmd run build        passed
git diff --check         passed
full Playwright rerun    intentionally not run per user instruction
manual user verification pending
```

Hotfix browser verification confirmed that clearing one time cleared both form values, the saved visit became untimed, the existing transportation stayed anchored after the from visit, the compact warning rendered, no transport moved into the top invalid stack, and the console had no warnings/errors.

The Vite build still reports the existing large-chunk warning; it is not a Phase 4.4 regression.

## Protected Scope Preserved

Phase 4.5 and its Hotfix did not redesign or extend:

- Auth / Google OAuth
- Realtime subscription architecture
- Draft Autosave or Edit Lock architecture
- Share / Invite / member flow
- Budget core data flow
- drag-reorder RPC behavior
- generic `sort_order` architecture
- transportation pair splitting or creation
- Google Map API or route calculation
- timed drag auto-continuation or cross-day scheduling
- Demo isolation

## Residual Risks

- Formal continuation currently uses guarded client-side row updates rather than a database transaction because Phase 4.4 explicitly required no migration. Failure handling performs best-effort reverse compensation, but an extreme network failure during both the forward update and compensation can still leave partial authoritative updates.
- Concurrent changes are guarded by `updated_at`, fixed-state, and active-lock validation, but unrelated writers that do not participate in those contracts remain an external risk.
- The existing native HTML drag accessibility limitations from Phase 4.2c remain outside Phase 4.4.
- Legacy DB rows with only one time are treated safely as untimed in the UI but are not automatically written back. The next explicit save normalizes them to `null/null`.
- Because applied RPC migrations 020/021 are immutable and their server manifest predates this Hotfix, a legacy start-only row can cause timed reorder to reject safely as stale until that row is explicitly normalized.

## Next Step

Wait for Phase 4.5 Hotfix manual verification or the next explicitly approved Timeline phase. Do not infer Phase 4.6 scheduling, fixed-card drag, presence, map, transportation repair, or database changes.
