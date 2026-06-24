# Timeline Phase 4.4 Closeout and Handoff

Date: 2026-06-23

## Status

```text
Timeline Phase 4.4 - Completed
Automated QA - Passed
Browser QA - Passed
User manual verification - Passed
```

Branch:

```text
codex/timeline-phase-4-0-to-4-2
```

Relevant commits:

```text
01d1d6b Implement Timeline Phase 4.4 auto continuation
62f0aa0 Refine Timeline Phase 4.4 continuation UX
```

## Final Product Decision

Auto-continuation is an explicit user action. Editing and saving a timed visit must not interrupt every save with a continuation prompt.

The final editor action order is:

```text
取消 / 接續 / 儲存
```

- Cancel follows the existing discard flow and never saves or continues.
- Save updates only the edited visit and never opens the Phase 4.4 prompt.
- Continue validates the edit and opens the continuation confirmation only when continuation is meaningful.

This replaces the first Phase 4.4 UX where every valid time edit opened a two-choice auto-continuation prompt during normal Save.

## Continue Availability

The Continue button is shown for an existing non-transport visit editor and is enabled only when:

- the original visit is timed with both `start_time` and `end_time`;
- the edited form still has both `start_time` and `end_time`;
- the user changed the start or end time;
- at least one later timed visit exists on the same day.

New visits, transportation editors, unchanged time edits, untimed edits, and the final timed visit cannot start an ineffective continuation.

## Validation and Prompt Order

Continue uses the existing editor submit path in this order:

1. Reject fixed edited visits.
2. Validate `end_time > start_time`.
3. Run same-day overlap validation.
4. Run the Phase 4.3 broken transportation-pair check.
5. Build the shared Phase 4.4 continuation plan.
6. Check affected movable visits for foreign locks and safe baselines.
7. Show the short continuation confirmation.

Final confirmation copy:

```text
自動接續後續行程？

後續有時間的行程會依原本停留時間與間隔自動調整。
固定行程不會移動，放不下的行程會改為未設定時間。

取消 / 確定接續
```

Cancelling this dialog returns to the active editor with the form values intact. Nothing is saved and no downstream item is changed.

## Phase 4.3 Interaction

Phase 4.3 remains higher priority than the continuation prompt.

- Save that breaks `A -> B` opens the existing Restore/Delete Transportation prompt, then saves only the edited visit if Delete is chosen.
- Continue that breaks `A -> B` opens the same Phase 4.3 prompt first.
- Choosing Restore returns to the editor without saving.
- Choosing Delete carries the continuation intent forward, but transportation deletion is deferred until the user confirms continuation and the combined save succeeds.
- Cancelling the later Phase 4.4 dialog does not delete the transportation card.

No transportation card is automatically created, split, or rewritten.

## Continuation Data Rules

The shared pure planner lives in:

```text
src/lib/timelineAutoContinuation.js
```

Rules:

- Only same-day timed visits after the edited visit participate.
- Earlier visits and the edited visit's identity remain unchanged.
- The edited visit uses the user's new time range.
- Each following movable visit preserves its original duration.
- Each original total gap is preserved, including transportation time and blank time.
- Untimed visits do not participate.
- No route calculation or full-day scheduling occurs.
- No transportation card is automatically added or removed, except the explicit Phase 4.3 Delete choice.
- Transportation-duration shortage remains warning-only.

## Fixed Visit Scheme B

The first following fixed timed visit is an immutable time anchor.

- Its `start_time` and `end_time` never change.
- Movable timed visits before the anchor are continued in order.
- If a moved visit would overlap the fixed anchor, that visit becomes untimed.
- That visit and all remaining affected movable visits before the anchor receive `start_time = null` and `end_time = null`.
- Continuation stops at the fixed anchor.
- Visits after the fixed anchor are not changed during this operation.

This rule applies only to explicit time continuation after editing. It does not change drag-reorder behavior around fixed cards.

## Formal Save Safety

Formal continuation keeps the existing guarded client-side batch path:

- every affected row uses its `updated_at` baseline;
- mutations are constrained to the active trip and day;
- transportation rows and fixed rows cannot be updated by the continuation batch;
- active foreign locks block affected movable rows;
- edit-lock release is deferred until the combined operation completes;
- successful callbacks still return `{ ok: true }`;
- optimistic-lock conflicts still return `{ ok: false, conflict: true }`;
- downstream failure triggers best-effort reverse compensation for applied continuation rows and the edited visit;
- failed saves keep the editor in a safe visible state and do not pretend success.

No migration or new RPC was added. Applied migrations 019, 020, and 021 remain immutable.

## Demo Parity

`/demo/timeline` uses the same UI component and pure continuation planner.

Demo applies the edited visit, continuation updates, untimed conversions, and optional Phase 4.3 transportation deletion through local React state only.

Demo does not call:

- Supabase;
- Auth;
- Realtime;
- Storage;
- Draft Autosave;
- Edit Lock;
- `localStorage`.

## Files Changed Across Phase 4.4

- `src/App.jsx`
- `src/lib/timelineAutoContinuation.js`
- `tests/phase-1-7f-smoke.spec.js`
- `tests/phase-4-3-transport-conflict.spec.js`
- `tests/phase-4-4-auto-continuation.spec.js`
- `CURRENT_TASK.md`
- `docs/2026-06-23-phase-4-4-closeout-handoff.md`

## Verification

Final automated checks:

```text
npm.cmd run build       passed
npx.cmd playwright test passed 54/54
git diff --check        passed
```

Browser verification on `/demo/timeline` confirmed:

- meaningful page content rendered;
- no Vite error overlay;
- no browser console errors;
- editor actions appeared as `取消 / 接續 / 儲存`;
- Continue was initially disabled and enabled after a valid time change;
- the short continuation dialog rendered with `取消 / 確定接續`.

User manually tested and confirmed the final behavior is OK on 2026-06-23.

The existing Vite large-chunk warning remains non-blocking and is not a Phase 4.4 regression.

## Regression Coverage

Automated coverage includes:

- normal Save changes only the edited visit and shows no continuation dialog;
- Continue is the only action that opens the Phase 4.4 dialog;
- cancelling the dialog preserves the active form and saves nothing;
- duration and original gaps are preserved;
- earlier and untimed visits are excluded;
- final open-ended behavior;
- fixed-anchor preservation;
- overflow before fixed becomes untimed;
- no continuation past fixed;
- no-following-visit Continue disabled state;
- invalid-time and overlap validation priority;
- Phase 4.3 Restore/Delete regression coverage;
- Phase 4.2c insertion reorder regression coverage;
- Demo production-service isolation.

## Protected Scope Preserved

Phase 4.4 did not redesign:

- Auth / Google OAuth;
- Realtime architecture;
- Draft Autosave or Edit Lock architecture;
- Share / Invite / member flows;
- Budget core flow;
- Phase 4.2c reorder RPC behavior;
- generic `sort_order` architecture;
- route calculation or Google Maps;
- drag-time adjustment;
- cross-day continuation;
- untimed/timed mixed scheduling;
- Collaborative Drag Presence.

## Residual Risks

- Formal continuation is still a sequence of guarded client-side updates rather than one database transaction. Best-effort compensation reduces risk, but a network failure during both forward mutation and compensation can leave partial authoritative changes.
- Unrelated writers that do not honor the same `updated_at` and lock contracts remain an external concurrency risk.
- Visits converted to untimed do not automatically delete transportation cards. Existing warning and manual correction flows remain responsible, as required by Phase 4.4 scope.

## Next Step

Phase 4.4 is closed and user verified. Wait for the next explicitly approved phase; do not infer additional scheduling, drag-presence, map, or database work.
