# Codex Prompt｜Timeline Phase 4.5b：Transportation Role Model

請協助實作 **Timeline Phase 4.5b：Transportation Role Model**。

這不是 Phase 4.6，也不是 Phase 4.7。不要實作 timed drag auto-continuation、fixed drag anchor、Collaborative Drag Presence 或 Map 功能。

## 請先閱讀

- `AGENT.md`
- `CURRENT_TASK.md`
- `docs/UX_RULES.md`
- `docs/BUGS.md`
- 近期 Phase 4.5 / Hotfix handoff
- 若 repo 內已有 `docs/timeline-phase-4-rules.md` 或相關 Phase 4 rules，請一併閱讀

並先執行：

```bash
git status
```

目前 Phase 4.5 Hotfix 3 已完成但可能尚未 commit，請不要回退既有成果。

---

## 背景

目前 untimed visit 與 transportation card 的規則已逐漸混亂，主因是系統無法明確區分：

1. 一般交通 `A → B`
2. 尾端待配對交通
3. 由尾端交通升級形成的 `A → B`

本階段目標是建立正式 transportation role model，避免繼續靠 `to_item_id === null` 或畫面位置推測。

目前沒有正式使用者，只有測試資料。既有交通測試資料可以修改、清理或刪除，以最佳結構與最穩實作為優先。

---

## 本階段目標

新增交通卡角色，例如：

```text
normal_pair
tail_pending
tail_promoted_pair
```

命名可以依現有 code style 微調，但語意必須明確。

### 1. normal_pair：一般 A→B 交通

資料語意：

```text
transport_role = normal_pair
from_item_id = A
to_item_id = B
```

行為：

- A/B 任一端改成 untimed → 交通卡保留並顯示「未設定時間」warning。
- A/B 仍是 timed，但改時間後不再相鄰或方向被破壞 → 儲存前跳既有 Restore / Delete Transportation 對話框。
- Restore：保留 editor 與交通卡，不寫入變更。
- Delete：沿用既有刪交通卡流程。
- normal_pair 不應自動退回 tail。

### 2. tail_pending：尾端待配對交通

資料語意：

```text
transport_role = tail_pending
from_item_id = A
to_item_id = null
```

它代表使用者正在順著往下排，A 後方準備接下一個行程。

行為：

- 後方出現 untimed visit 時，不形成 pair。
- untimed 不會讓 tail_pending invalid。
- 不跳 Restore / Delete Transportation。
- 可顯示輕量 warning，例如：`下一個行程時間未設定，請重新確認交通卡。`
- 若後方 untimed 被設定完整時間後，系統才判斷是否可形成 pair。

形成 pair 的合理條件：

```text
B 恢復 timed 後，
B 排序在 A 後方，
B.start_time >= A.end_time，
且 A / B 在 timed sequence 中相鄰。
```

若合理：

```text
tail_pending A → null
升級為
tail_promoted_pair A → B
```

若不合理，例如 B 設定時間後排序跑到 A 前方：

- B 依 start_time 排到正確位置。
- tail_pending 保持在 A 後方。
- 不形成 pair。
- 不跳 Restore / Delete。
- 不進 invalid stack。

### 3. tail_promoted_pair：尾端交通升級後形成的 A→B

資料語意：

```text
transport_role = tail_promoted_pair
from_item_id = A
to_item_id = B
```

畫面可顯示成一般 `A → B` 交通，但 validation 行為與 normal_pair 不同。

行為：

- 若 B 又改成 untimed → 退回 `tail_pending`，清除 `to_item_id`，保留交通卡並顯示未設定時間 warning。
- 若 B 改時間後不再合理接在 A 後方 → 退回 `tail_pending`，B 依時間排序，不跳 Restore / Delete。
- 不可自動改成 normal_pair。
- 不可因 endpoint untimed 而進 invalid stack。
- 只有 from anchor 被刪除、當天無可掛載行程、或資料狀態無法修復時，才可視為 invalid。

---

## Untimed 與交通卡總規則

請保留目前已確認規則：

- timed → untimed 時，相關交通卡自動保留並 warning。
- 系統被動轉 untimed 與使用者主動轉 untimed，都採保留 warning，不自動刪除。
- 使用者拖曳或修改 untimed 造成交通關係需要移除時，才顯示既有移除提示。
- `partial time` 仍一律視為 untimed。
- `timed → untimed` 可 rebase 當日既有 untimed visits 以保護位置。
- `untimed → timed` 不可 compact 其他 untimed visits。
- `接續` 跨 fixed 時 disabled，提示固定文案：`跨越固定行程時無法接續。`
- `儲存` 仍可跨 fixed，只要不 overlap。

---

## DB / Migration

可以新增 migration，例如：

```text
022_add_transport_role_to_itinerary_items.sql
```

不要修改已套用的 019 / 020 / 021。

建議：

- transportation rows 必須有合法 `transport_role`。
- 非 transportation rows 可為 `null`。
- 既有資料可簡單轉換或清理：
  - `to_item_id is null` → `tail_pending`
  - `to_item_id is not null` → `normal_pair`
  - 若舊資料不符合新模型，可以刪除測試 transportation rows，以乾淨模型為優先。

請同步更新 Demo mock data。

---

## 實作方向

請集中整理 role 判斷，不要在各處散落 `to_item_id === null` 推測。

可新增或調整 helper，例如：

- transportation role 判斷
- render model placement
- invalid transport 判斷
- normal pair conflict 判斷
- tail_pending promotion 判斷
- tail_promoted_pair demotion 判斷

請優先檢查：

- `src/App.jsx`
- `src/lib/timelineTransportationConflicts.js`
- `src/lib/timelineUntimedOrdering.js`
- `src/lib/timelineAutoContinuation.js`
- `src/lib/destinationPackages.js`
- Demo mock data / timeline data normalization 相關檔案

---

## 不做

本階段不要做：

- Phase 4.6 timed drag auto-continuation
- Phase 4.7 fixed drag anchor
- Collaborative Drag Presence
- Map 整合
- 大型 Timeline render model 重寫
- 修改 019 / 020 / 021 migration

---

## QA 重點

請至少用 Browser QA 驗證：

1. normal_pair endpoint 改 untimed → 交通卡保留 warning。
2. normal_pair endpoint 改時間導致不相鄰 → 跳 Restore / Delete。
3. tail_pending 後方有 untimed → 不失效、不形成 pair、不跳 Restore / Delete。
4. tail_pending 後方 untimed 設定時間且合理接在 A 後 → 升級成 tail_promoted_pair。
5. tail_pending 後方 untimed 設定時間但排到 A 前 → B 排到前面，tail_pending 保持，不提示、不 invalid。
6. tail_promoted_pair 的 B 改回 untimed → 退回 tail_pending warning。
7. tail_promoted_pair 的 B 改時間後不再合理接在 A 後 → 退回 tail_pending，不跳 Restore / Delete。
8. invalid transport stack 不應出現上述 false positive。
9. Demo `/demo/timeline` 與 Formal 行為一致。
10. Console 無錯誤。

最後執行：

```bash
npm.cmd run build
git diff --check
```

Playwright 可先不跑完整套件；若你認為必要，只跑本階段相關 targeted tests，並避免輸出大型 logs。

---

## 完成後請回報

1. 修改檔案
2. migration 名稱與資料處理方式
3. 三種 role 的實作位置
4. normal_pair 行為
5. tail_pending 行為
6. tail_promoted_pair 行為
7. Demo / Formal 是否一致
8. Browser QA 結果
9. build / `git diff --check` 結果
10. 殘留風險
