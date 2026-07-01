# Codex Prompt｜Timeline Phase 4.5c：Mixed Drag Target / Prompt Cleanup

## Goal

請協助實作 **Timeline Phase 4.5c：Mixed Drag Target / Prompt Cleanup**。

本階段只修正 Timeline 在 **timed visit / untimed visit 混排拖曳** 時的 drop target 與交通提示判斷問題。

這不是 Phase 4.6，也不是 Phase 4.7。
不要實作 timed drag auto-continuation、固定卡跨區拖曳、Collaborative Drag Presence 或 Map 功能。

---

## Before You Start

請先閱讀並遵守：

- `AGENT.md`
- `CURRENT_TASK.md`
- `docs/UX_RULES.md`
- `docs/BUGS.md`
- `docs/timeline-phase-4-rules.md` 或目前最新的 Phase 4 規則檔
- Phase 4.5 / 4.5 Hotfix 3 / 4.5b 相關 handoff 或目前最新 closeout

請先確認：

```bash
git status
```

重要限制：

1. 不要回退 Phase 4.5、Hotfix 3、Phase 4.5b 的既有成果。
2. 不要修改已套用的 migrations 019 / 020 / 021。
3. 本階段原則上不新增 migration / RPC / schema，除非你發現 Phase 4.5b 尚未完成且必須銜接 `transport_role`；若需要請先清楚說明。
4. 不要新增大型重構。
5. 不要改 Demo 連線規則；Demo `/demo/timeline` 必須維持 local mock state，不接 Supabase/Auth/Realtime/Storage/Draft/Edit Lock。

---

## Current Problems

### Problem 1：Timed visit 不能拖到 untimed 上方或下方

目前一般 timed visit 似乎無法正確拖曳到 untimed visit 的上方或下方。

預期規則：

```text
Untimed visit 可以存在於列表頭、中、尾。
Timed visit 也可以拖曳到 untimed visit 的上方或下方。
```

範例：

```text
A timed
B untimed
C timed
```

拖曳 C 到 A 上方，預期：

```text
C timed
A timed
B untimed
```

不是只做 A / C 的 timed swap，然後把 B untimed 留在原本 gap 中間。

---

### Problem 2：沒有交通卡受影響時，不應跳交通提示

目前上下沒有交通卡時，拖曳行程卡到別處也可能跳提示。

預期規則：

```text
如果本次拖曳沒有實際影響任何 transportation card，就不應跳提示。
```

只有實際會造成以下情況時才提示：

- 移除交通卡
- 拆開既有 normal pair
- 破壞 tail promoted pair
- 影響 tail pending 的掛載或形成判斷
- 主動 untimed drag 插入既有 transportation pair 中間

若只是空白間隔拖曳，且沒有 affected transports：

```text
直接拖曳，不跳確認提示。
```

---

### Problem 3：中間有 untimed 時，timed drag 的頭尾 drop target 會異常

目前在這種情況：

```text
A timed
B untimed
C timed
```

拖曳 C 到 A 上方，理論上應變成：

```text
C timed
A timed
B untimed
```

但目前可能變成：

```text
C timed
B untimed
A timed
```

這代表系統只交換了 timed sequence，卻沒有依完整 mixed visual list 處理 drop target。

同理，拖曳 A 到 C 下方時，也不應只做 A / C swap，untimed 應依實際視覺 drop target 保持合法位置。

---

## Required Rules

### A. Mixed visual list is the source of drop target

拖曳放置位置必須以畫面上的完整 mixed list 判斷。

也就是：

```text
timed visit + untimed visit 都是同一個 visual list 裡的卡片。
```

不可只對 timed visits 做 reorder，然後把 untimed slot 固定留在原 gap。

---

### B. Untimed can exist at head / middle / tail

以下都是合法畫面：

```text
B untimed
A timed
C timed
```

```text
A timed
B untimed
C timed
```

```text
A timed
C timed
B untimed
```

系統不得因為 untimed 在頭或尾，就自動把它拉回某個 timed gap。

---

### C. Timed visit can be dropped above / below untimed visit

Timed visit 可以拖曳到 untimed visit 的上方或下方。

範例：

```text
A timed
B untimed
C timed
```

拖曳 C 到 B 上方，允許。
拖曳 C 到 B 下方，允許。
拖曳 C 到 A 上方，允許。
拖曳 A 到 C 下方，允許。

---

### D. Time calculation still only uses timed visits

雖然 drop target 要看完整 mixed visual list，但時間計算仍只看 timed visits。

例如畫面：

```text
C timed
A timed
B untimed
```

時間接續 / timed order 只看：

```text
C → A
```

Untimed visit：

- 不參與 auto-continuation
- 不產生 gap
- 不保留 gap
- 不造成 overlap
- 不參與 transportation shortage 計算

---

### E. Transportation prompt must be based on affected transports

交通提示只能在本次拖曳真的影響 transportation card 時出現。

請修正為：

```text
affectedTransports.length > 0 才需要提示。
```

或使用等價的明確判斷。

不要因為「有 drag reorder」就跳提示。
不要因為 drop target 靠近 untimed 就跳提示。
不要因為上下是空白 gap 就跳提示。

---

## Expected Behaviors

### Case 1：Timed drag across untimed, no transports

Initial:

```text
A timed
B untimed
C timed
```

Action:

```text
Drag C above A
```

Expected:

```text
C timed
A timed
B untimed
```

No transport prompt.

---

### Case 2：Timed drag below untimed, no transports

Initial:

```text
A timed
B untimed
C timed
```

Action:

```text
Drag A below C
```

Expected result should follow actual visual drop target, not a simple A/C timed swap.

No transport prompt if no transportation card is affected.

---

### Case 3：Untimed at head is allowed

Initial:

```text
A timed
B untimed
C timed
```

Action:

```text
Drag B above A
```

Expected:

```text
B untimed
A timed
C timed
```

No auto-compacting.
No timed gap misinterpretation.

---

### Case 4：Untimed at tail is allowed

Initial:

```text
A timed
B untimed
C timed
```

Action:

```text
Drag B below C
```

Expected:

```text
A timed
C timed
B untimed
```

No auto-compacting.
No invalid transport unless actual transport is affected.

---

### Case 5：Transport prompt only when actual transport exists

Initial:

```text
A timed
B timed
C timed
```

No transportation cards between them.

Action:

```text
Drag B elsewhere
```

Expected:

```text
No transportation warning / confirm prompt.
```

---

### Case 6：Transport prompt still appears when actual normal pair is affected

Initial:

```text
A timed
transport A → B
B timed
C timed
```

Action:

```text
Drag B away from A
```

Expected:

```text
Show existing transportation warning / confirm flow.
```

Do not remove this protection.

---

## Files To Inspect First

優先檢查：

- `src/App.jsx`
- `src/lib/timelineUntimedOrdering.js`
- `src/lib/timelineAutoContinuation.js`
- `src/lib/timelineTransportationConflicts.js`
- `src/lib/destinationPackages.js`
- `src/styles.css`

請避免重寫 Timeline render model。

---

## Demo / Formal Parity

Formal app 與 Demo `/demo/timeline` 行為需一致：

- Timed visit 可拖到 untimed 上下方。
- Untimed 可存在頭、中、尾。
- 沒有 affected transports 時不跳提示。
- 有 affected transports 時仍保留既有保護提示。

Demo 不可接 Supabase / Auth / Realtime / Storage / Draft / Edit Lock。

---

## Testing / QA Control

請控制測試輸出，不要跑不必要的大型測試。

開發中可先做 targeted manual QA。

最後請執行：

```bash
npm.cmd run build
git diff --check
```

不強制跑完整 Playwright。
如果你認為需要跑 targeted Playwright，請只跑相關 spec，並只回報摘要。

---

## Final Report Format

完成後請簡短回報：

1. 修改檔案。
2. Mixed visual drop target 如何修正。
3. Timed visit 是否可拖到 untimed 上下方。
4. Untimed 是否可存在 head / middle / tail。
5. 無交通卡時是否不再跳提示。
6. 有交通卡受影響時，既有提示是否仍正常。
7. Formal / Demo 是否一致。
8. Browser QA 結果。
9. `npm.cmd run build` 結果。
10. `git diff --check` 結果。
11. 殘留風險。
