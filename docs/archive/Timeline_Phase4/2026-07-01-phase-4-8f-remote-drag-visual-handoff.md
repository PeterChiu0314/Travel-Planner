# Timeline Phase 4.8f Remote Drag Visual Handoff

Date: 2026-07-01
Branch: `codex/timeline-phase-4-8`
Status: User verified / implementation pushed / no migration

---

## Summary

Phase 4.8f is a small visual-only follow-up to the Phase 4.8c collaborative drag presence work.

It strengthens the remote drag signal without adding remote ghost cards, remote placeholders, remote list reflow, or remote preview ordering.

When another member is dragging a destination card on the same day, the receiving client keeps the source card in its original position, highlights that original card with the remote user's collaborative color, reduces its opacity, and shows a clearer insertion line at the remote target.

The official reorder result still comes only from the existing drop/reorder flow and the existing RPC/reload path.

---

## Read First

- `AGENT.md`
- `CURRENT_TASK.md`
- `docs/UX_RULES.md`
- `docs/BUGS.md`
- `docs/2026-07-01-phase-4-8c2-collaborative-drag-presence-handoff.md`
- `docs/2026-07-01-phase-4-8e-online-member-presence-handoff.md`
- `docs/timeline-phase-4-drag-reorder-rules-draft-v13.md`

Archive rule:

- Do not read `docs/archive/` by default.
- `docs/gpt/` no longer exists and must not be recreated.

---

## Final UI Behavior

Remote drag source card:

- Applies only to destination cards.
- Uses class `timeline-item-remote-drag-source`.
- Uses the same non-green collaborative color palette derived from the remote drag `sessionId` / `userId` / `dragId`.
- Shows a colored border and reduced opacity.
- Does not use soft shadow after final user tuning.
- Remains in its original list position.
- Does not get removed from the list.
- Does not cause other cards to move.

Remote insertion line:

- Uses the existing class `timeline-remote-insertion-line`.
- Uses the remote drag color via `--timeline-remote-drag-color`.
- Keeps opacity stronger than the earlier muted line.
- Final spacing is `margin: 4px 10px` so the line remains visually centered in the existing gap.

Priority:

- Foreign drag state takes priority over remote selection border.
- Existing 4.8d selection remains available when no foreign drag is active.
- Transport cards remain non-sortable and do not receive remote drag source highlight. They can still show 4.8d remote selection when selected.

---

## Protected Boundaries Preserved

No changes were made to:

- reorder RPCs
- Supabase migrations
- schema or database writes
- Phase 4.7 fixed-anchor logic
- `brokenTransportIds` confirmation behavior
- official reorder persistence flow
- dnd-kit local drag overlay / preview behavior for the local dragger
- Demo presence
- Map integration
- remote DragOverlay
- remote ghost card
- remote placeholder
- remote preview order
- remote list reflow / let-place animation

---

## Relevant Code Locations

- `src/App.jsx`
  - derives `foreignDragSourceItemId`
  - derives `foreignDragStyle`
  - applies `timeline-item-remote-drag-source`
  - passes remote drag color style into `timeline-remote-insertion-line`
- `src/styles.css`
  - `.timeline-item.timeline-item-remote-drag-source`
  - `.timeline-item.focused.timeline-item-remote-drag-source`
  - `.timeline-remote-insertion-line`
- `tests/phase-4-2c-reorder.spec.js`
  - source-level smoke: `Phase 4.8f foreign drag source highlight stays visual-only`

---

## Relevant Commits

```text
fe5abad Tune remote drag visual polish
d3e911b Strengthen remote drag presence visuals
76a0a38 Show day board presence dots
a07bcd9 Recover trip presence after idle
```

---

## Verification

Checks run for Phase 4.8f:

```text
npm.cmd run build passed
git diff --check passed with Windows LF/CRLF notices only
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js --grep "Phase 4.8f|Phase 4.8c" passed 4/4
```

Manual verification:

```text
User verified Phase 4.8f as OK after final tuning:
- remote drag source card has no soft shadow
- insertion line spacing is reduced back toward the existing gap
- remote drag source remains in place
- no remote ghost / placeholder / list reflow was added
```

Existing Vite large-chunk warning remains known and is not a Phase 4.8f regression.

---

## Residual Risks

- Realtime Broadcast delivery remains best effort; existing stale timeout behavior is still the fallback if a clear/update event is missed.
- Remote drag source and insertion-line visuals are hints only. They must not be used as authoritative order state.
- The collaborative drag UI is intentionally minimal. More advanced live co-editing, ghost cards, remote cursor/scroll sync, or live preview merge is out of scope.

---

## Recommended Next Step

Phase 4.8f is accepted.

Next phase should be Phase 4.9 Map integration.

Start Phase 4.9 with a read-only audit and implementation plan. Do not begin by modifying map behavior, route calculation, database schema, RPCs, transportation repair, Demo presence, or collaborative drag semantics unless the user explicitly expands scope.

Before future work:

```text
git status
git pull
```
