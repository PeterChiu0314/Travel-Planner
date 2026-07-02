# Timeline Phase 4.5 Closeout and Handoff

Date: 2026-06-24

## Status

```text
Timeline Phase 4.5 - Implemented
Automated QA - Passed
Browser QA - Passed
Partial-Time/Passive-Transport Hotfix - Implemented
User manual verification - Pending
```

Branch:

```text
codex/timeline-phase-4-0-to-4-2
```

Relevant commits:

```text
e2a6033 Implement Timeline Phase 4.5 untimed ordering
5b75450 Fix Timeline Phase 4.5 partial time handling
```

## Final Product Decision

Phase 4.5 lets untimed destination visits participate in the same-day Timeline display order without changing the timed schedule.

- A visit is timed only when both `start_time` and `end_time` exist, and is ordered naturally by `start_time`.
- Missing either time—including start-only and end-only legacy data—makes the visit untimed.
- An untimed visit can appear before, after, or between timed visits.
- Dragging an untimed visit changes only its persisted manual display position.
- Timed visit times, destination packages, alternatives, linked budgets, and transportation cards do not move with an untimed drag.
- Phase 4.2c timed destination-package reorder and Phase 4.4 auto-continuation remain separate operations.

## Persisted Ordering Model

No schema change was required. Phase 4.5 reuses the existing integer field:

```text
itinerary_items.sort_order
```

The shared helper reserves a negative integer range for encoded untimed positions. The encoding stores:

- the gap/slot relative to the naturally sorted timed visits;
- the untimed visit's manual rank among other untimed visits in that gap.

Legacy untimed rows whose `sort_order` is not encoded remain at the end of the timed schedule until the user drags them. This gives existing production data a safe backward-compatible fallback.

When a currently timed visit becomes untimed through manual time clearing, partial-time normalization during save, or Phase 4.4 fixed-anchor overflow, the save flow immediately encodes its current display gap. The converted visit therefore stays in its existing visual position instead of entering the legacy tail fallback. When multiple overflow visits convert together, their relative order is preserved.

Because gap numbers are relative to the remaining timed visits, every later timed-to-untimed conversion also rebases existing untimed rows from the current display order. This prevents an earlier fixed-anchor overflow visit from moving below its anchor when another timed visit above it subsequently becomes untimed.

The same rebasing applies when an untimed visit becomes timed again. It preserves the absolute pre-save display order of every remaining untimed visit; untimed cards do not auto-fill or compact upward into gaps created or removed by timing changes.

Timed visits never use the untimed encoding for their display order. Their primary ordering remains `start_time`, with existing `sort_order` and ID tie-breakers only when needed.

The shared pure helper is:

```text
src/lib/timelineUntimedOrdering.js
```

It owns:

- mixed timed/untimed visit display order;
- untimed source validation;
- before/after insertion planning;
- transportation-pair protection;
- encoded `sort_order` generation;
- shared error-message mapping.

## Phase 4.5 Hotfix: Complete-Time Contract

The final classification contract is:

| start_time | end_time | classification |
|---|---|---|
| set | set | timed |
| missing | missing | untimed |
| set | missing | untimed |
| missing | set | untimed |

`isTimedVisit` and `isUntimedVisit` in `timelineUntimedOrdering.js` are shared by mixed display ordering, active drag, destination-package planning, Phase 4.3 transportation conflict detection, and Phase 4.4 auto-continuation.

Partial visits do not participate in:

- timed natural sorting;
- overlap validation;
- auto-continuation;
- transportation-duration shortage;
- timed adjacency;
- the frontend timed destination-package manifest.

The visit editor immediately clears both form values when the user clears either start or end. `normalizeItemPayload` repeats the invariant at the Formal/Demo save boundary, so persisted visit data is either a complete pair or `null/null`.

## Untimed Drag Rules

An untimed visit can be dragged when:

- the current user can edit;
- there is no active Timeline editor;
- the source is not fixed;
- the source is not locked by another user;
- no other untimed or timed reorder is currently being saved.

A successful untimed drag:

- updates only the source visit's `sort_order`;
- preserves all timed `start_time` / `end_time` values;
- does not call the Phase 4.2c destination-package reorder RPC;
- does not trigger Phase 4.4 auto-continuation;
- does not add, delete, or rewrite transportation cards;
- does not clear drafts or release edit locks.

The existing active-editor guard disables both timed and untimed drag until the editor is resolved.

## Transportation Pair Protection

For a currently valid normal transportation card `A -> B`, where A and B are adjacent timed visits, an untimed visit cannot be inserted between them.

The planner compares the current valid pair adjacency with the proposed display order. If the proposed order separates A and B:

- the plan returns `transport_pair_blocked` and the blocking transportation ID;
- local item state is not changed;
- Formal does not call Supabase;
- the transportation card is neither deleted nor rewritten;
- no replacement transportation is created;
- the UI shows a compact inline hint:

```text
這裡已有交通卡連接，無法插入未設時間行程。
請先刪除交通卡，或將行程放到其他位置。
```

Transportation insertion controls are now shown only between two adjacent timed visits. Untimed adjacency does not expose a transportation insertion control.

Tail transportation data behavior is unchanged. If its from visit passively becomes untimed, it is rendered as an anchored warning instead of being treated as a new tail or moved to the top invalid stack.

## Active Drag vs Passive Untimed Conversion

Phase 4.5 now explicitly separates two operations.

### Active untimed drag

The user deliberately moves an already untimed visit. The original Phase 4.5 protection remains unchanged: it cannot be inserted between a currently valid transportation pair. Rejection changes no local state, performs no Supabase write, and does not add, delete, move, or rewrite transportation.

### Passive untimed conversion

A timed visit can passively become untimed because:

- Phase 4.4 fixed-anchor overflow clears its times;
- the user manually clears either time;
- legacy partial data is normalized during save.

This is not an active insertion into a transportation pair. If a transportation card's referenced visits still exist and either endpoint is untimed/partial, the card:

- remains in data and in the Timeline;
- is not deleted or hidden;
- is not moved into the top invalid-transport stack;
- is not rewritten as tail transportation;
- does not create a replacement;
- is anchored after its existing `from_item_id` visit;
- uses the existing compact warning card with `目的地時間未設定，請重新確認交通卡。`

Only missing referenced visits, explicit deletion, Phase 4.3 Delete, or an approved timed-reorder cleanup can remove the relationship through their existing flows.

## Formal Save Safety

Formal persistence updates one `itinerary_items` row through the existing Supabase table path.

The update is constrained by:

- active `trip_id`;
- active `day_index`;
- source item ID;
- non-transport item type;
- `start_time is null`;
- `is_fixed = false`;
- the source row's `updated_at` baseline.

If the guarded update returns no row or fails:

- the UI does not claim success;
- the lightweight failure message remains visible;
- authoritative trip data is reloaded;
- the callback returns a failed/conflict result.

Realtime reload therefore preserves the persisted untimed position without introducing a new table or RPC.

Formal and Demo visit saves both normalize partial time to `null/null`. Passive conversion does not pass a Phase 4.3 Delete intent, so the existing transportation row is preserved.

Passive conversion also persists an encoded untimed `sort_order` for the visit's current display position. This position update does not count as an active untimed drag and does not remove transportation.

When transportation endpoints are restored to timed in separate saves, the mixed display order keeps a still-untimed reverse-adjacent endpoint in the transportation's `from -> to` direction. This prevents the intermediate restore state from turning the retained pair into an invalid transportation card before both endpoints are timed again.

Applied migrations 019, 020, and 021 remain unchanged and immutable. No migration 022 was created, and production DB was not modified during Phase 4.5.

## Demo Parity

`/demo/timeline` uses the same Timeline component and `timelineUntimedOrdering.js` planner.

- A Day 6 mock untimed visit demonstrates mixed ordering.
- Demo persistence uses local React state only.
- Demo changes only the source item's `sort_order` and local `updated_at`.
- Demo never calls Supabase, Auth, Realtime, Storage, Draft Autosave, Edit Lock, or `localStorage`.

## Phase 4.2c / 4.3 / 4.4 Compatibility

- Phase 4.2c continues to accept timed visits only and still calls the 020/021 RPC path.
- Untimed visits remain outside the destination-package reorder manifest.
- Phase 4.3 timed insertion conflict behavior is unchanged.
- Phase 4.4 excludes untimed visits from continuation.
- Visits converted to untimed by the Phase 4.4 fixed-anchor rule now participate in the Phase 4.5 display helper as legacy untimed visits and can be manually repositioned.
- Fixed timed visits are not moved or modified by an untimed drag.

## Files Changed

- `src/App.jsx`
- `src/lib/timelineUntimedOrdering.js`
- `src/lib/destinationPackages.js`
- `src/lib/timelineAutoContinuation.js`
- `src/lib/timelineTransportationConflicts.js`
- `src/styles.css`
- `tests/phase-4-5-untimed-ordering.spec.js`
- `tests/phase-1-7f-smoke.spec.js`
- `docs/2026-06-24-phase-4-5-closeout-handoff.md`

The existing Demo trip-switch smoke assertion was made date-robust: it now verifies that exactly one valid day is active and that the old out-of-range Day 6 board is gone, rather than assuming the current trip day must always be Day 1.

## Verification

Final automated checks on 2026-06-24:

```text
npm.cmd run build       passed
npx.cmd playwright test passed 61/61
git diff --check        passed
```

Browser verification on `/demo/timeline` confirmed:

- meaningful Timeline content rendered;
- timed and untimed cards appeared in one mixed list;
- no Vite error overlay was present;
- no browser console warnings or errors were detected;
- Phase 4.5 drag behavior used local Demo state;
- the screenshot command itself timed out in the in-app browser, but DOM, console, overlay, and Playwright verification completed successfully.

The existing Vite large-chunk warning remains non-blocking and is not a Phase 4.5 regression.

### Hotfix verification

The Hotfix intentionally followed the user-requested reduced test flow:

```text
targeted pure-helper sanity passed
Demo browser verification passed
npm.cmd run build        passed
git diff --check         passed
full Playwright rerun    not requested / not run
```

Browser verification manually cleared the end time of a visit connected by transportation. The start time cleared immediately, the saved visit became untimed, the transportation remained in the from visit's flow entry with an `untimed-warning`, the top invalid stack stayed empty, and no console warnings/errors appeared.

## Test Workflow Note

Future Timeline phases should use a layered workflow to reduce runtime and token output:

1. Run the new helper/phase tests while implementing.
2. Run directly related regression files only after UI wiring changes.
3. Re-run only failed cases during diagnosis.
4. Run the full Playwright suite once at final closeout.
5. Keep successful logs summarized rather than printing full DOM snapshots or complete diffs.

## Residual Risks

- Native HTML drag remains primarily mouse/desktop oriented. Touch and keyboard-accessible reordering require a separately approved interaction design.
- The integer gap encoding intentionally leaves large rank spacing. Extremely repeated insertions into the exact same narrow position can eventually exhaust the available midpoint; the planner then rejects safely and asks for a refresh instead of corrupting order.
- Formal ordering is a guarded single-row update, not a multi-row transaction. This is appropriate because Phase 4.5 changes only the dragged untimed row.
- Legacy partial DB rows are treated as untimed immediately but are written back as `null/null` only on the next explicit save.
- Applied RPC migrations 020/021 predate the complete-time contract and cannot be edited. A legacy start-only row may make timed reorder reject safely as stale until the row is explicitly normalized.
- User manual verification is still pending.

## Next Step Boundary

Phase 4.5 does not implement:

- timed drag followed by automatic time adjustment;
- dragging across fixed-card scheduling regions;
- untimed/timed automatic scheduling;
- transportation creation, deletion, splitting, or route calculation;
- Collaborative Drag Presence;
- Google Maps integration.

Wait for explicit Phase 4.6 direction before extending timed drag or scheduling behavior.
