# CURRENT_TASK.md

## Read First

- `AGENT.md`
- `docs/UX_RULES.md`
- `docs/BUGS.md`
- `docs/2026-06-22-phase-4-2c-closeout-handoff.md`
- `docs/2026-06-23-phase-4-4-closeout-handoff.md`
- `docs/2026-06-24-phase-4-5-closeout-handoff.md`
- `docs/2026-06-24-phase-4-5-hotfix-2-handoff.md`
- `docs/2026-06-24-phase-4-5-hotfix-3-handoff.md`
- `docs/timeline-phase-4-drag-reorder-rules-draft-v5.md` (latest working draft)

Archive rule:

- `docs/archive/` contains historical discussions, superseded handoffs, and old drafts.
- Do not read archived files by default; consult them only when a task specifically needs older context.
- `docs/gpt/` no longer exists and must not be recreated.

## Current Phase

```text
Timeline Phase 4.5 Stabilization + Hotfixes 1-3 - Implemented / Browser and Build QA Passed / Final Manual Verification Pending
```

Next phase:

```text
Paused after the 2026-06-25 stabilization closeout; awaiting final manual verification or next explicit direction
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
- A timed visit that passively becomes untimed immediately receives an encoded untimed `sort_order` for its current display gap, so it remains in place instead of falling to the legacy untimed tail position.
- Phase 4.4 fixed-anchor overflow applies the same preservation rule to every converted visit while retaining their relative order.
- Every later timed-to-untimed conversion rebases all existing untimed gap encodings for that day from the pre-save display order. An earlier overflow visit therefore remains before its fixed anchor even when another timed visit above it later becomes untimed.
- Untimed visits never auto-fill or compact into newly available gaps. When visits change between timed and untimed in either direction, rebasing preserves the complete pre-save display order of every remaining untimed visit.
- While a retained transportation still has an untimed endpoint, a staged time restore preserves the transportation direction when its `from` and `to` visits would otherwise become reverse-adjacent. Restoring A and then B therefore keeps `A -> B` in order and returns the card to the normal adjacent flow once both are timed.
- Transportation with an existing untimed/partial endpoint stays anchored after its `from_item_id` visit and shows the existing compact warning UI: `目的地時間未設定，請重新確認交通卡。`
- Phase 4.4 fixed-anchor overflow and manual time clearing therefore preserve related transportation for manual review.
- No migration, RPC, or production DB change was required. Applied migrations 019/020/021 remain immutable.
- Hotfix commit: `5b75450 Fix Timeline Phase 4.5 partial time handling`.

### Phase 4.5 Hotfix 2

- Passive conversion to untimed still preserves existing transportation and its compact warning.
- Active drag of an untimed visit still rejects a target that would break an existing valid timed transportation pair before any confirmation appears.
- If the untimed source visit itself is linked by any transportation `from_item_id` or `to_item_id`, a legal drop now opens the existing `確認移動行程？` dialog.
- Cancel leaves the visit, transportation rows, local state, and Formal persistence unchanged.
- Confirm moves only the untimed source visit, deletes every transportation row linked to that source, and creates or rewrites no transportation.
- Formal validates the source and linked-transport baselines before writing, persists the source `sort_order`, deletes only the confirmed linked transportation IDs, and reloads authoritative trip data after success or failure.
- Demo performs the confirmed move and linked-transport deletion in one local React-state update without production-service calls.
- Timed visit times, Phase 4.4 auto-continuation, and the Phase 4.2c reorder RPC remain untouched.
- No migration or RPC change was required; applied migrations 019/020/021 remain immutable.

### Phase 4.5 Hotfix 3

- A retained tail transport remains a passive untimed warning while its endpoint is untimed.
- When that endpoint becomes timed again and is still the final timed visit, the same row automatically returns to the valid tail flow instead of the invalid transport stack.
- Tail restore does not delete, rewrite, or convert the transport into a normal pair.
- Editing a timed visit across a fixed timed visit disables only the `接續` action.
- The disabled continuation action explains: `跨越固定行程時無法接續。`
- Direct `儲存` remains enabled and succeeds when existing invalid-time and overlap validation pass.
- Phase 4.3 conflict detection now covers both inserting a new timed visit between an existing transportation pair and editing either endpoint so the original valid pair is no longer adjacent.
- Endpoint edits that break a pair open the existing Restore / Delete Transportation dialog before persistence; passive conversion to untimed remains outside this prompt.
- No migration, RPC, schema, production DB, or Playwright test change was made.

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
- `docs/2026-06-24-phase-4-5-closeout-handoff.md`
- `docs/2026-06-24-phase-4-5-hotfix-2-handoff.md`
- `docs/2026-06-24-phase-4-5-hotfix-3-handoff.md`
- `docs/timeline-phase-4-drag-reorder-rules-draft-v3.md`
- `docs/timeline-phase-4-drag-reorder-rules-draft-v4.md`
- `docs/timeline-phase-4-drag-reorder-rules-draft-v5.md`

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

Phase 4.5 Hotfix 2 checks on 2026-06-24:

```text
npm.cmd run build passed
git diff --check  passed
Demo consecutive passive-conversion browser QA passed
Demo fixed-anchor overflow and non-compacting restore QA passed
Demo tail restore and fixed-crossing continuation QA passed
Demo transportation-endpoint conflict prompt QA passed
automated tests     not added or modified per user instruction
manual verification pending
```

Phase 4.5 stabilization closeout checks on 2026-06-25:

```text
npm.cmd run build passed
git diff --check  passed
Demo browser QA    passed for passive untimed position preservation, no-compaction,
                   tail restore, fixed-crossing continuation guard, and
                   transportation endpoint conflict confirmation
Playwright tests   intentionally not run or modified per user instruction
final manual verification pending
```

This closeout preserves the existing Hotfix work, adds no migration/RPC/schema change, and does not begin Phase 4.6 or Phase 4.7.

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
- Hotfix 2 Formal persistence uses a guarded source-row update followed by one scoped transportation delete statement because no new RPC was approved. If deletion fails, it attempts to restore the original `sort_order` before authoritative reload; an extreme network or concurrent-write failure during both deletion and compensation can still leave a partial authoritative result.

## Next Step

Wait for final Phase 4.5 stabilization manual verification or the next explicitly approved Timeline phase. Do not infer Phase 4.6 scheduling, fixed-card drag, presence, map, transportation repair, or database changes.
