# Timeline Phase 4.8b Demo Timeline Data Parity Polish Handoff

Date: 2026-06-30
Target next chat: continue **Timeline Phase 4.8b：Demo Timeline Data Parity Polish**
Project: Travel Planner / 旅程規劃室
Branch from current work: `codex/timeline-phase-4-8`

---

## 1. Read First

Before continuing, read:

- `AGENT.md`
- `docs/UX_RULES.md`
- `docs/BUGS.md`
- `CURRENT_TASK.md`
- `docs/timeline-phase-4-drag-reorder-rules-draft-v12.md`
- Existing Phase 4 closeout handoffs, especially:
  - `docs/2026-06-29-phase-4-6-closeout-handoff.md`
  - `docs/2026-06-29-phase-4-7-closeout-handoff.md`

Archive rule:

- Do not read `docs/archive/` by default.
- `docs/gpt/` should not be recreated.

Important: the latest rule draft is now **v12**, not v11.

---

## 2. Current Status

### Completed and accepted before this handoff

- Phase 4.7 has been implemented and manually tested OK.
- Phase 4.7a hotfix completed:
  - Fixed fixed-adjacent gap drop being misclassified as no-op.
- Phase 4.7b hotfix completed:
  - Fixed segment overflow now converts non-fitting timed visits to untimed instead of surfacing `invalid_timing_change`.
  - Existing untimed visits are rebased from after-drop mixed visual order so they do not jump below fixed anchors.
- Phase 4.8a completed locally:
  - dnd-kit local sortable ghost drag preview.
  - Drag preview is local UI only.
  - No migration / RPC changes.

### Commit / push status

The user has not explicitly confirmed commit/push after the latest 4.8a transportation visual attachment follow-up.

Before starting 4.8b, ask Codex / the next assistant to run:

```bash
git status
```

and confirm whether the 4.8a work has already been committed. Do not assume it has been committed.

---

## 3. Phase 4.8a Implementation Summary

Phase 4.8a added dnd-kit sortable drag preview for Timeline destination cards.

Packages added:

```text
@dnd-kit/core
@dnd-kit/sortable
@dnd-kit/utilities
```

Likely modified files:

```text
package.json
package-lock.json
src/App.jsx
src/styles.css
tests/phase-4-2c-reorder.spec.js
CURRENT_TASK.md
```

Main behavior:

- Same-day timeline destination cards are wrapped with `DndContext` / `SortableContext` / `verticalListSortingStrategy`.
- Each destination flow entry uses `useSortable` with the visit item id.
- Dragging uses `DragOverlay` for the floating card.
- Active source card becomes an in-list placeholder.
- Other destination cards slide open during local preview using dnd-kit transform.
- Drag preview is purely local:
  - no `itinerary_items` writes
  - no reorder RPC call
  - no `start_time` / `end_time` update
  - no untimed conversion
  - no transportation mutation
  - no draft clearing
  - no migration
- Drop still calls the existing Phase 4.7 timed reorder flow or existing untimed reorder flow.
- Fixed cards remain non-draggable.
- Timed and untimed existing drag rules remain preserved.

### Transportation visual attachment follow-up

A later 4.8a polish moved transportation cards from static timeline siblings into the previous destination sortable wrapper as **visual attachments**.

Current accepted behavior:

- Transportation cards are **not** in `SortableContext.items`.
- Transportation cards have no sortable id.
- Transportation cards remain non-draggable.
- Transportation cards can still be clicked / edited.
- `TimelineFlowAttachment` stops pointer/key event bubbling so clicking a transport card does not start a destination drag.
- During local drag preview, the transport card follows the upper destination wrapper's dnd-kit `translate3d(...)` transform.
- The user manually tested this and accepted it as logical, even though it is not completely independent transport-card sliding.

Important interpretation:

```text
During drag preview, transportation visual movement is a UI effect only.
After drop, existing Phase 4.7 rules decide whether transport confirmation appears, whether transport is deleted, whether timing is recalculated, whether overflow becomes untimed, etc.
```

---

## 4. Validation Already Reported for 4.8a

Reported by Codex and user:

```text
npm.cmd run build passed
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js passed 21/21
npx.cmd playwright test tests/phase-4-5-untimed-ordering.spec.js --grep-invert demo passed 12/12
npx.cmd playwright test tests/phase-4-4-auto-continuation.spec.js passed 7/7
npx.cmd playwright test tests/phase-4-3-transport-conflict.spec.js passed 7/7
git diff --check passed
```

Notes:

- `git diff --check` only showed Windows LF/CRLF notices.
- Vite large-chunk warning is pre-existing and not a Phase 4.8 regression.
- `npm audit` reported 3 vulnerabilities after installing dnd-kit packages; they were not auto-fixed to avoid scope creep.

Recommended before starting 4.8b:

```bash
npm.cmd run test:e2e
git status
```

---

## 5. Why Phase 4.8b Is Next

The user mainly uses local `npm run dev` and `/demo/timeline` for browser UI testing because they currently cannot easily log into the Formal authenticated page in local dev.

Problem observed:

```text
Demo data mode can differ from Formal data mode.
This can make transportation cards or timeline flow behave differently in Demo,
which makes local UI testing misleading.
```

Therefore the next slice should be:

```text
Phase 4.8b：Demo Timeline Data Parity Polish
```

Then after Demo parity is stable:

```text
Phase 4.8c：Collaborative Drag Presence
```

Do not start 4.8c before 4.8b unless user explicitly changes direction.

---

## 6. Phase 4.8b Goal

Make `/demo/timeline` a reliable **Formal-like local simulator** for Timeline UI behavior.

Demo should remain isolated from Supabase/Auth, but its mock data shape and render flow should be close enough to Formal that local UI testing is meaningful.

### Demo should still NOT use

- Supabase writes
- Auth / Google OAuth
- Realtime subscriptions
- Storage
- Draft Autosave persistence
- Edit Lock service
- production RPC calls

### Demo should align with Formal in

- timeline item shape
- destination/transport ids
- `transport_role`
- `from_item_id` / `to_item_id`
- `sort_order` / untimed negative order encoding
- fixed / timed / untimed classification
- same `ItineraryTimeline` render path
- same dnd-kit sortable wrapper / `DragOverlay` / attachment CSS behavior
- same pure planner behavior for local state after drop
- same `brokenTransportIds` confirmation semantics where possible

---

## 7. Suggested Phase 4.8b Scope

### 7.1 Audit Demo data shape

Inspect Demo mock data and compare with Formal data expectations.

Check if demo items have complete and consistent fields:

```text
id
trip_id / demo equivalent
day_id / day index equivalent
type
start_time
end_time
sort_order
is_fixed
fixed_at
fixed_by
from_item_id
to_item_id
transport_role
updated_at / stable mock baseline if needed
```

Focus especially on transportation cards:

```text
normal_pair
tail_pending
tail_promoted_pair
```

Ensure Demo has representative examples for:

- normal `A → B` transport
- tail transport
- transport with untimed endpoint warning
- pair broken by timed drag
- pair broken by untimed insertion
- fixed-anchor drag cases

### 7.2 Audit Demo render path

Confirm Demo uses the same Timeline render component/path as Formal:

```text
ItineraryTimeline
same destination flow entry model
same sortable wrappers
same transportation visual attachment behavior
same styles.css classes
```

If Demo has any special-case transportation rendering, remove or narrow it unless it is truly necessary for Demo isolation.

### 7.3 Audit Demo local planner behavior

Demo drop should mimic Formal RPC final results as closely as possible using local state and pure planners.

Check:

- timed drag uses Phase 4.7 fixed-aware pure planner
- untimed drag uses existing untimed reorder planner
- broken transport confirmation uses the same `brokenTransportIds` source as Formal
- cancel leaves local state unchanged
- confirm deletes only affected transport ids
- overflow to untimed preserves mixed visual order
- existing untimed does not compact or jump
- transportation visual attachment after drop reflects the final local state

### 7.4 Do not convert Demo into fake-success mode

The user explicitly prefers:

```text
Demo = Formal 的本地模擬版
```

Not:

```text
Demo = simplified fake-success showcase with separate rules
```

---

## 8. Strict Non-Goals for Phase 4.8b

Do NOT do these in 4.8b:

- Do not modify Supabase schema.
- Do not add or edit migrations.
- Do not edit applied migrations 019–024.
- Do not modify reorder RPCs.
- Do not change Formal persistence behavior.
- Do not change fixed anchor / untimed overflow / brokenTransportIds formal logic.
- Do not start collaborative drag presence.
- Do not add Supabase Realtime presence.
- Do not add heartbeat / timeout logic yet.
- Do not start Phase 4.9 map integration.
- Do not redesign Demo as a separate product experience.

If a Formal bug is discovered, report it separately and do not silently fix it inside Demo parity unless user approves.

---

## 9. Suggested Codex Prompt for Phase 4.8b

Use as a normal Codex prompt, not a Goal unless the user asks for Goal mode.

```text
請接續 Timeline Phase 4.8b：Demo Timeline Data Parity Polish。

前置狀態：
- Phase 4.7 已完成並人工測試 OK。
- Phase 4.8a 已完成 dnd-kit Local Sortable Drag Preview。
- dnd-kit 只處理 local UI preview；drop 後仍走既有 Phase 4.7 timed reorder / untimed reorder flow。
- 目前使用者本機 run dev 主要透過 /demo/timeline 測 UI，因此 Demo 行為需要更貼近 Formal。

目標：
讓 /demo/timeline 成為 Formal Timeline 的本地模擬版。
Demo 不接 Supabase/Auth/Realtime/Draft/Edit Lock，但 mock data shape、transport_role、pair 欄位、render flow、dnd-kit preview、local planner 結果要盡量與 Formal 對齊，避免本機 Demo 測試誤導 Formal UI 判斷。

請先 audit：
1. Demo mock itinerary item shape 是否缺 Formal 需要的欄位。
2. Demo transportation cards 是否有完整 transport_role / from_item_id / to_item_id。
3. Demo 是否使用跟 Formal 相同的 ItineraryTimeline / sortable wrapper / transportation visual attachment render path。
4. Demo timed drag 是否使用 Phase 4.7 fixed-aware pure planner。
5. Demo untimed drag、brokenTransportIds confirmation、overflow untimed conversion、transport cleanup 是否與 Formal semantics 對齊。

請修正 Demo parity，但保持以下限制：
- 不修改 Supabase migration。
- 不修改 reorder RPC。
- 不修改 Formal persistence flow。
- 不修改 Phase 4.7 fixed anchor / untimed overflow / brokenTransportIds 正式邏輯。
- 不做 Collaborative Drag Presence；那是 Phase 4.8c。
- 不做 Map integration；那是 Phase 4.9。
- Demo 仍不接 Supabase/Auth/Realtime/Draft/Edit Lock。
- 不要把 Demo 改成另一套 fake-success 展示模式。
- 不要 commit / push。

建議測試 / QA：
1. /demo/timeline 中 normal_pair transport 能依 pair 正常顯示。
2. /demo/timeline 中 tail_pending / tail_promoted_pair 行為與 Formal rules 對齊。
3. Demo timed drag across fixed anchors 仍走 4.7 local planner。
4. Demo overflow to untimed preserves mixed visual order。
5. Demo untimed drag into transport pair shows confirmation and confirm/cancel 行為正確。
6. Demo dnd-kit preview 與 Formal 共用同一 render/CSS path。
7. Transportation visual attachment 不會因 Demo data shape 卡在原位。
8. Existing targeted tests remain green。

完成後請跑：
npm.cmd run build
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js
npx.cmd playwright test tests/phase-4-5-untimed-ordering.spec.js --grep-invert demo
npx.cmd playwright test tests/phase-4-4-auto-continuation.spec.js
npx.cmd playwright test tests/phase-4-3-transport-conflict.spec.js
git diff --check

完成後回報：
- 修改了哪些檔案
- Demo mock data / render flow 哪些地方跟 Formal 對齊
- 是否有動到 Formal / RPC / migration
- 測試結果
```

---

## 10. QA Checklist for 4.8b

Manual browser checks on `/demo/timeline`:

- Timed destination drag up/down in a normal no-fixed day.
- Timed destination drag across fixed anchors.
- Overflow into fixed anchor converts non-fitting visits to untimed.
- Existing untimed visits preserve mixed visual order and do not jump below fixed anchors.
- Untimed card drag works in mixed list.
- Untimed insertion into normal pair / tail-promoted pair opens transport confirmation.
- Cancel confirmation leaves demo state unchanged.
- Confirm deletes affected demo transport rows only.
- Transportation cards visually attach to the previous destination wrapper during dnd-kit drag preview.
- Transport cards remain clickable/editable and do not start drag.
- Fixed cards remain non-draggable but fixed-adjacent gaps remain valid drop targets.

Automated checks:

```bash
npm.cmd run build
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js
npx.cmd playwright test tests/phase-4-5-untimed-ordering.spec.js --grep-invert demo
npx.cmd playwright test tests/phase-4-4-auto-continuation.spec.js
npx.cmd playwright test tests/phase-4-3-transport-conflict.spec.js
git diff --check
```

Run full E2E before final closeout or commit:

```bash
npm.cmd run test:e2e
```

---

## 11. Files Likely Relevant

Most likely:

```text
src/App.jsx
src/styles.css
src/demo-kyoto-trip.json
src/lib/destinationPackages.js
src/lib/timelineUntimedOrdering.js
src/lib/timelineTransportationConflicts.js
src/lib/timelineTransportationRoles.js
src/lib/timelineAutoContinuation.js
tests/phase-4-2c-reorder.spec.js
tests/phase-4-5-untimed-ordering.spec.js
CURRENT_TASK.md
docs/timeline-phase-4-drag-reorder-rules-draft-v12.md
```

Also inspect if needed:

```text
package.json
package-lock.json
```

Do not modify migrations unless user explicitly changes scope.

---

## 12. Production Migration State

Applied immutable migrations:

```text
019 / 20260621131905 / swap_itinerary_destination_packages
020 / 20260622130246 / reorder_itinerary_destination_packages
021 / 20260622131013 / fix_reorder_baseline_count
022 / 20260629012151 / add_transport_role_to_itinerary_items
023 / 20260629014908 / reorder_itinerary_timed_auto_continuation
024 / 20260629065754 / timeline_phase_4_7_fixed_anchor_continuation
project: lqvuqamzmchepgxkftcw
```

Rules:

- Never edit applied migrations 019–024 in place.
- If a future schema/RPC correction is explicitly required, use migration 025+.
- Phase 4.8b should require **no migration**.

---

## 13. Residual Risks / Notes

- Formal authenticated UI verification for Phase 4.8a is still recommended when possible.
- User's local dev workflow currently relies heavily on `/demo/timeline`, so Demo parity is important for future UI polish.
- Drag animation feel can be browser/timing-sensitive; prefer dnd-kit configuration over delaying official data writes or bypassing existing reorder flow.
- dnd-kit keyboard accessibility may need future UX work, but it is not Phase 4.8b scope.
- `npm audit` vulnerabilities should be tracked separately; do not run `npm audit fix` during 4.8b unless user approves.

---

## 14. Recommended Next Step

Start 4.8b with a read-only audit first.

1. Confirm git status and whether 4.8a is committed.
2. Audit Demo mock data shape vs Formal itinerary item expectations.
3. Audit Demo render path and local planner path.
4. Make the smallest Demo parity changes needed.
5. Run targeted tests.
6. Ask user to manually inspect `/demo/timeline`.

Do not start collaborative presence until Demo parity is stable.
