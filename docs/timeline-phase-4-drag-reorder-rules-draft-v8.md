# Timeline Phase 4 拖曳重排 / 多人協作 / 固定卡 / 未設時間規則草稿 v8

Date: 2026-06-28  
Status: Draft for next chat / corrected timed-vs-untimed definition after Phase 4.5b + Phase 4.5c implementation

> 本文件由 v6 更新而來，補上已落地的 Phase 4.5b Transportation Role Model、Phase 4.5c Mixed Drag Target / Prompt Cleanup，以及進入 Phase 4.6 前必須保留的規則。
> v8 的重點是：4.5b / 4.5c 已完成到可進 Phase 4.6 的狀態；並修回原本 timed / untimed 定義：只有 start_time 與 end_time 都存在才是可參與 Phase 4.6 duration 計算的 timed visit。Phase 4.6 要處理 timed visit 拖曳後「保留自身停留時間並重算時間」，不可再交換時間 slot。

---

## 0. Phase 狀態

目前狀態：

```text
Phase 4.3：新增 / 編輯景點時間插入既有交通 pair 提示：完成
Phase 4.4：修改時間後局部自動接續：完成
Phase 4.5：未設定時間排序 / stabilization：完成
Phase 4.5b：Transportation Role Model：完成第一版
Phase 4.5c：Mixed Drag Target / Prompt Cleanup：完成
Phase 4.6：拖曳 timed visit 後，自動調整時間：下一階段
Phase 4.7：固定行程卡作為時間錨點的拖曳規則：後續
Phase 4.8：Collaborative Drag Presence：後續
Phase 4.9：Map 整合前置設計：後續
Phase 4.10：QA 與交接：後續
```

---

## 1. 名詞定義

### timed visit

正式規則：

```text
只有 start_time 與 end_time 都存在，才視為 timed visit。
```

也就是：

| start_time | end_time | 判定 |
|---|---|---|
| 有 | 有 | timed visit / complete timed visit |
| 有 | 無 | untimed visit / partial time，應正規化 |
| 無 | 有 | untimed visit / partial time，應正規化 |
| 無 | 無 | untimed visit |

補充：

- Phase 4.6 的「保留停留時間」只適用於完整 timed visit。
- 若只有 start_time 或只有 end_time，系統無法計算 duration，不可參與 duration-based auto-continuation。
- 不應再把 `start_time 有、end_time 無` 定義成正式的 timed visit。
- 若目前 Demo 或舊資料存在 start-only edge case，應在資料或表單層修正 / guard，不要讓它進入 Phase 4.6 timed drag 計算。

### untimed visit

沒有完整 `start_time / end_time` 的目的地行程卡。

它代表：

```text
使用者想把這個目的地放在這個順序附近，但時間還沒決定。
```

規則：

- 可以存在於列表頭、中、尾。
- 可以混在 timed / fixed visit 之間。
- 不參與 timed auto-continuation。
- 不產生 gap、不保留 gap、不造成 overlap。
- 不作為有效 transport shortage 計算端點。
- 拖曳 untimed 只改自己的 mixed visual position。
- 只要 start_time 或 end_time 任一缺少，就視為 untimed；儲存時建議同步清除另一個時間欄位，避免 partial time。

### complete timed visit

同時有 `start_time / end_time` 的 timed visit。

Phase 4.6 的 duration-preserving drag 以 complete timed visit 為唯一基準：

```text
duration = end_time - start_time
```

### partial time / start-only edge case

只有 `start_time` 或只有 `end_time` 的狀態不是正式 timed visit。

規則：

- 視為 untimed / 表單未完成狀態。
- 不參與 timed ordering 的 duration recalculation。
- 不可偷偷發明 end_time 或 duration。
- 不可為了 Demo final visit 或相容性而改變正式 timed / untimed 定義。

### transportation card

交通卡必須有明確 role，不應只靠 `from_item_id / to_item_id` 或畫面位置推測語意。

三種角色：

```text
normal_pair
tail_pending
tail_promoted_pair
```

---

## 2. Phase 4.5b：Transportation Role Model

### 2.1 資料模型

新增欄位：

```text
transport_role
```

允許值：

```text
normal_pair
tail_pending
tail_promoted_pair
```

已新增 migration：

```text
022_add_transport_role_to_itinerary_items.sql
```

回填：

```text
to_item_id is null     -> tail_pending
to_item_id is not null -> normal_pair
```

helper：

```text
src/lib/timelineTransportationRoles.js
```

---

### 2.2 normal_pair

一般 A→B 交通。

資料：

```text
transport_role = normal_pair
from_item_id = A
to_item_id = B
```

行為：

- A/B 仍同方向相鄰：交通保留。
- endpoint 變成 untimed：交通保留並顯示未設定時間 warning。
- endpoint 仍 timed，但修改時間後 A/B 不再相鄰：走 Restore/Delete Transportation。
- drag reorder 破壞 A/B：顯示交通卡移除提示；確認後刪除。
- 不自動退回 tail_pending。

---

### 2.3 tail_pending

尾端待配對交通，代表「上一張 timed visit 後準備接下一個行程的交通」。

資料：

```text
transport_role = tail_pending
from_item_id = A
to_item_id = null
```

行為：

- 後方 untimed 不會立刻形成 pair。
- 後方 untimed 不讓 tail_pending 失效。
- 不跳 Restore/Delete。
- 不進 invalid stack。
- 顯示未設定時間 warning。
- 如果 timed card 後方已有 passive/tail transport，不顯示「新增尾端交通」hover，也不允許開新增尾端交通表單。
- tail_pending 與後方 untimed 之間需保留正常 UI gap。
- tail_pending 後方 untimed 開編輯時，可自動預填開始時間：
  - start = 上一張 timed visit end_time + tail transport duration
  - 只填表單 draft，不直接寫 DB。

---

### 2.4 tail_pending + untimed 設時間

原本：

```text
A timed
tail_pending transport
B untimed
```

若 B 設定完整時間，且排序後合理接在 A 後方：

```text
A timed
transport A→B
B timed
```

則：

```text
tail_pending -> tail_promoted_pair
to_item_id = B
```

若 B 設定時間後排到 A 前方：

```text
B timed
A timed
tail_pending transport
```

則：

- 保持 tail_pending。
- 不形成 A→B。
- 不提示。
- 不 invalid。

---

### 2.5 tail_promoted_pair

由 tail_pending 形成的 A→B。

資料：

```text
transport_role = tail_promoted_pair
from_item_id = A
to_item_id = B
```

行為：

- 看起來像一般 A→B，但來源是 tail。
- 若 B 再變成 untimed：
  - `tail_promoted_pair -> tail_pending`
  - `to_item_id = null`
  - 不刪交通卡、不跳 Restore/Delete。
- 若 timed drag 破壞 A/B：
  - 顯示交通卡移除提示。
  - 確認後刪除 affected transport。
- 不自動轉成 normal_pair。

---

## 3. Phase 4.5c：Mixed Drag Target / Prompt Cleanup

### 3.1 核心規則

拖曳 drop target 必須看完整 mixed visual list：

```text
timed + untimed + transport display context
```

不可只看 timed-only sequence。

但時間計算仍只看 timed visits：

```text
time calculation = timed sequence only
visual placement = mixed visual list
```

---

### 3.2 Untimed 可在頭 / 中 / 尾

以下都合法：

```text
U untimed
A timed
B timed
```

```text
A timed
U untimed
B timed
```

```text
A timed
B timed
U untimed
```

不允許系統把 untimed 自動拉回某個舊 gap。

---

### 3.3 Timed 可拖到 untimed 上下方

例：

```text
A timed
U untimed
C timed
```

拖 C 到 A 上方，應依實際 drop target 形成：

```text
C timed
A timed
U untimed
```

不可只交換 timed sequence 後讓 U 留在原本 gap：

```text
C timed
U untimed
A timed
```

---

### 3.4 Affected transport detection

`planMixedTimedVisitReorder` 應比較：

```text
before mixed visual order
after mixed visual order
```

並回傳：

```text
brokenTransportIds
```

規則：

- 不只檢查 drop target 附近。
- 必須檢查拖曳卡原位置與新位置。
- 只要 `normal_pair` / `tail_promoted_pair` 在 after mixed order 中不再同方向相鄰，就視為 broken transport。
- 即使 timed-only package order 沒變，只要 untimed slot 變動破壞 transport，也要提示。

例：

```text
A -transport- B
C untimed
D

拖 B 到 C/D 中間
```

必須抓到 `A→B` broken。

---

### 3.5 Prompt cleanup

只有真的有 affected transport 時才提示。

```text
brokenTransportIds.length > 0 -> 顯示交通卡移除提示
brokenTransportIds.length = 0 -> 不提示
no-op drag -> 不提示
```

no-transport/no-op path 不應顯示 reorder confirmation。

但若會影響既有交通卡，仍必須提示。

---

### 3.6 Timed / untimed 插入交通 gap

最新規則：

```text
不論拖曳的是 timed visit 或 untimed visit，
只要插入 normal_pair / tail_promoted_pair 中間，
都允許 drop，但必須先顯示交通卡移除提示。
```

確認後：

- 移動 dragged card。
- 刪除 `plan.brokenTransportIds`。
- 不新增交通卡。

取消後：

- 不改 local state。
- 不寫 DB。
- 不刪交通卡。

這取代舊規則「untimed 不可插入已有交通 pair 中間」。

---

### 3.7 Formal / Demo 保存邏輯

Formal / Demo 都應使用：

```text
plan.brokenTransportIds
```

作為刪除交通卡 baseline。

不應要求被刪除交通卡必須直接連著 dragged untimed card。

原因：

```text
untimed 插入 A/B 中間時，untimed 本身不是 transport endpoint，
但它仍然破壞 A→B。
```

---

## 4. Phase 4.6：Timed Visit Drag Auto-Continuation

### 4.1 核心目標

Phase 4.6 要處理：

```text
拖曳 timed visit 後，自動調整 start_time / end_time。
```

最重要原則：

```text
拖曳不是交換時間 slot。
拖曳後，每張 complete timed visit 必須保留自己的原停留時長。
```

也就是：

```text
移動的是 itinerary intent，不是只交換 destination package。
```

---

### 4.2 基本時間規則

#### 1. 新順序第一張

新 timed sequence 的第一張使用原本第一張 timed visit 的 start_time。

```text
原本第一張 09:00 開始
拖曳後新的第一張也從 09:00 開始
```

#### 2. 保留自身 duration

每張 complete timed visit 保留自己的原 duration。

```text
A 原本 60 分
A 拖曳後仍 60 分
```

不可讓 A 拿到其他卡的 duration。

#### 3. 原本仍同方向相鄰

如果兩張 timed visits 拖曳前後都保持同方向相鄰：

```text
B → C before
B → C after
```

保留原本總間隔：

```text
C.start_time - B.end_time
```

總間隔包含：

- 交通時間
- 空白等待時間
- 即使沒有交通卡，也保留原本空白

#### 4. 新形成相鄰

如果兩張 timed visits 是拖曳後才相鄰：

```text
C → A
```

則直接接續：

```text
A.start_time = C.end_time
```

不自動新增交通時間或空白。

#### 5. 方向反轉

如果原本是：

```text
A → B
```

拖曳後變成：

```text
B → A
```

方向反轉視為新相鄰，直接接續，不保留原 A→B gap。

---

### 4.3 交通規則

- 原本交通卡兩端拖曳後仍同方向相鄰：保留。
- 原本交通卡兩端不再同方向相鄰：加入 `brokenTransportIds`。
- 有 broken transports：顯示交通卡移除提示。
- 使用者確認後：完成 reorder/time recalculation，刪除 broken transports。
- 使用者取消：不改資料。
- 新形成相鄰關係：不自動新增交通卡。
- tail_pending 只有在候選 untimed 設定合理時間後才升級，不因 drag 自動亂轉。

---

### 4.4 Untimed 在 Phase 4.6 的角色

- Untimed 仍保留在 mixed visual list。
- Untimed 不參與 timed auto-continuation。
- Untimed 不產生 gap、不保留 gap、不造成 overlap。
- Timed auto-continuation 只看 timed sequence。
- Drag target 仍要看 mixed visual list。

---

### 4.5 Partial time 注意事項

partial time：

```text
只有 start_time 或只有 end_time
```

它不是正式 timed visit，應視為 untimed / 表單未完成狀態。

Phase 4.6 不可默默套用 duration 規則，也不可自動發明缺少的時間。

進 Phase 4.6 時應遵守：

- duration-preserving drag 只處理 start_time / end_time 都完整的 visits。
- partial time 不參與 timed auto-continuation。
- 若舊資料或 Demo final visit 存在 start-only 狀態，需先正規化或在流程中 guard。
- 不因相容性需求把 partial time 重新定義成 timed visit。

---

### 4.6 Fixed card 邊界

Phase 4.6 不做固定錨點進階規則。

目前保留：

- fixed card 本身不可拖曳。
- fixed card 不被 auto-continuation 推動。
- 編輯時間後按「接續」若跨 fixed，button disabled。
- 單純「儲存」可跨 fixed，只要不重疊。
- 非固定卡跨 fixed 後塞得下/塞不下的完整拖曳規則留到 Phase 4.7。

---

## 5. Phase 4.7：Fixed Anchor Drag Rules

Phase 4.7 才處理：

- fixed card 作為時間錨點。
- 其他卡可跨 fixed。
- 塞得下：保留 duration，給新時間。
- 塞不下：移動卡轉 untimed。
- 兩個 fixed 中間完全無空白：不可插入。
- fixed 本身資料與時間永遠不動。

Phase 4.6 不要提前實作。

---

## 6. Phase 4.8：Collaborative Drag Presence

保守規則：

- 同一天只允許一位成員拖曳。
- 其他成員看到 `{userName} 正在拖曳`。
- 目標位置顯示淡插入線。
- 其他人的畫面不真的重排。
- Presence 不寫 itinerary_items、不改時間、不刪交通卡。
- 正式結果仍以 reorder RPC 成功為準。
- 不做 Google Docs-style 合併拖曳。

---

## 7. 多人協作 / RPC 保護

Phase 4.6 / 4.7 若會一次調整多張時間，正式版應優先使用 transaction RPC，而不是前端多次 update。

RPC 應驗證：

- user permission
- timed manifest
- mixed visual baseline / package permutation
- all related updated_at baseline
- fixed state
- edit lock state
- transportation baseline
- original start/end/duration
- original adjacency/gap
- brokenTransportIds

若不一致：

```text
rollback
reload authoritative trip data
show stale/conflict message
```

建議提示：

```text
此日行程已被其他成員更新，已為你載入最新版本，請重新操作。
```

---

## 8. Phase 4.6 建議 QA

### duration 不可交換

```text
A 09:00-10:00 duration 60
B 10:30-11:00 duration 30
C 12:00-13:30 duration 90

拖 C 到 A 上方
C 仍應停留 90 分，不可拿到 A 的 60 分 slot。
```

### mixed visual target

```text
A timed
U untimed
C timed

拖 C 到 A 上方
應照 mixed visual drop target 顯示，不可只交換 timed sequence。
```

### no affected transport

無交通卡時拖曳：

```text
不跳提示
直接完成
```

### affected transport

```text
A
transport A→B
B
C

拖 B 離開 A
要提示交通卡移除。
```

### untimed 插入 transport gap

```text
A
transport A→B
B
U untimed

拖 U 到 A/B 中間
要提示交通卡移除。
確認後移動 U，刪除 A→B。
```

### fixed guard

```text
Phase 4.6 不應實作固定錨點進階拖曳。
```

---

## 9. 進 Phase 4.6 前檢查

1. 確認 Phase 4.5b / 4.5c 最後一版測試已跑完。
2. 確認 migration 022 是否已套到 Supabase remote。
3. 更新 `CURRENT_TASK.md`。
4. commit / push Phase 4.5b + 4.5c。
5. 從乾淨工作樹開始 Phase 4.6。
6. 若遇到 partial time（只有 start_time 或只有 end_time），先正規化或 guard，不要讓它進入 Phase 4.6 duration 計算。

---

## 10. 一句話總結

```text
Phase 4.5b/4.5c 已把交通角色與 mixed visual drag target 穩定下來：
normal_pair / tail_pending / tail_promoted_pair 已分流；
timed/untimed 都能依 mixed visual list 拖曳；
只有 brokenTransportIds 真的存在時才跳提示；
timed/untimed 插入交通 gap 都允許，但要確認後刪除受影響交通卡。

Phase 4.6 下一步是 timed visit 拖曳後自動調整時間：
不可交換時間 slot；
每張 complete timed visit 要保留自己的原 duration；
原本仍同方向相鄰保留 gap；
新相鄰或方向反轉直接接續；
不新增交通卡；
固定錨點進階規則留到 Phase 4.7。
```
