# Timeline Phase 4 拖曳重排 / 多人協作 / 固定卡 / 未設時間規則草稿

Date: 2026-06-23
Status: Draft for discussion / updated with Collaborative Drag Presence

> 本文件整理目前討論過的 Timeline Phase 4 後續規則。  
> 目前專案已完成 Phase 4.3；Phase 4.4 之後尚未實作。  
> 本文件不是最終實作指令，後續可再拆成 Codex prompt 或正式 handoff。

---

## 0. 目前 Phase 重新排序建議

目前已完成：

```text
Phase 4.3：新增 / 編輯景點時間插入既有交通 pair 提示
```

後續建議拆分：

```text
Phase 4.4：修改時間後，局部自動接續時間
Phase 4.5：未設定時間景點排序規則
Phase 4.6：拖曳 timed visit 後，自動調整時間
Phase 4.7：固定行程卡作為時間錨點的拖曳規則
Phase 4.8：Collaborative Drag Presence，多人拖曳中狀態提示
Phase 4.9：Map 整合前置設計
Phase 4.10：QA 與交接
```

拆分原因：

- 不把拖曳、自動時間、固定卡、未設時間卡、交通卡限制全部塞進同一個 Phase。
- 先定義 untimed visits，後面固定卡「塞不下轉 untimed」才有基礎。
- 先做一般拖曳自動時間，再做固定卡錨點進階規則。
- 多人拖曳中的 presence 只做暫時視覺狀態，不混入正式 reorder RPC。
- 4.4b 原本討論的內容建議拆成 4.6 + 4.7，協作拖曳視覺狀態另拆到 4.8。

---

## 1. 名詞定義

### timed visit

有 `start_time` / `end_time` 的目的地行程卡。

例如：

```text
09:00 ~ 10:00 台北車站
```

### untimed visit

沒有設定 `start_time` / `end_time` 的目的地行程卡。

它代表：

```text
使用者想把這個目的地放在行程順序裡，但時間還沒決定。
```

### transportation card

兩張 timed visits 之間的交通卡。

例如：

```text
A → B，捷運 20 分鐘
```

### fixed timed visit

已被使用者鎖定的 timed visit。

固定卡代表：

- 目的地資料不動
- `start_time / end_time` 不動
- 不可拖曳
- 不可被自動時間接續推動

### destination package

一張行程卡中會跟著目的地移動的內容資料。

包含：

- title / location / note / cost
- map fields
- alternatives
- linked budget rows

但不包含：

- row id
- day identity
- fixed state
- edit lock state
- created_at

### transaction RPC

資料庫函式，一次完成多個資料變更。

原則：

```text
全部成功 → commit
任一步失敗 → rollback，資料回到原狀
```

用於避免拖曳重排時出現半完成狀態。

### timed manifest

使用者拖曳當下看到的同一天 timed visits 清單快照。

用來確認資料庫目前狀態是否仍和使用者畫面一致。

若 manifest 不一致，代表使用者畫面過期，拖曳應被拒絕。

### updated_at baseline

使用者開始操作時看到的資料版本時間。

用來確認該資料在使用者操作期間是否被其他人修改。

若資料庫中的 `updated_at` 與 baseline 不一致，代表資料已過期，本次操作應被拒絕。

### active foreign edit lock

其他使用者正在編輯某張卡，且該 edit lock 還沒過期。

- active：仍有效
- foreign：不是自己，是其他人
- edit lock：該卡正在被編輯

---

## 2. Phase 4.6：拖曳 timed visit 後，自動調整時間

> 原本討論中的 4.4b 基本規則，建議拆到 Phase 4.6。

### 核心概念

移動 timed visit 後：

- 目的地順序改變
- 每張行程保留原本停留時間
- 系統依新順序自動接續時間

總結：

```text
拖曳移動後，目的地順序改變；
每張行程保留原本停留時長；
原本同方向仍相鄰的段落保留原本間隔；
新相鄰或方向反轉則直接接續；
不再相鄰的交通卡自動移除；
不新增交通卡。
```

---

### 時間規則

#### 1. 新順序第一張

新順序的第一張 timed visit，使用原本第一張 timed visit 的開始時間。

例如：

```text
原本第一張從 09:00 開始
移動後新的第一張也從 09:00 開始
```

#### 2. 停留時間

每張 timed visit 保留自己原本的停留時長。

例如：

```text
A 原本停 50 分
移動後 A 仍停 50 分
```

#### 3. 原本仍相鄰的行程

如果兩張 timed visits 在移動前後都保持同方向相鄰，就保留原本總間隔。

例如：

```text
移動前：B → C
移動後：B → C
```

保留：

```text
B.end_time 到 C.start_time 的總間隔
```

總間隔包含：

- 交通時間
- 空白等待時間
- 即使中間沒有交通卡，也保留原本空白

#### 4. 新形成的相鄰行程

如果兩張 timed visits 是移動後才變成相鄰，就直接接續。

例如：

```text
原本不是 C → A
移動後變成 C → A
```

則：

```text
C 結束後，A 直接開始
```

不自動補交通時間，也不自動留空白。

#### 5. 方向反轉

如果原本是：

```text
B → C
```

移動後變成：

```text
C → B
```

不保留原本間隔。

方向反轉視為新相鄰，所以直接接續。

---

### 交通卡規則

#### 6. 仍相鄰的交通卡保留

原本的交通卡，如果移動後兩個目的地仍然同方向相鄰，就保留。

```text
原本：B → C
移動後：B → C
交通卡保留
```

#### 7. 不再相鄰的交通卡移除

如果交通卡兩端的目的地移動後不再相鄰，就自動移除。

```text
原本：A → B
移動後：B C A D
A 和 B 不相鄰
所以 A → B 交通卡移除
```

#### 8. 不自動新增交通卡

新形成的相鄰關係，不會自動建立交通卡。

```text
移動後形成 C → A
系統不會自動新增 C → A 交通卡
```

---

### 其他限制

#### 9. untimed visits 不參與時間接續

未設定時間的卡不參與 timed auto-continuation。

#### 10. 有 active editor 時禁止拖曳

有行程正在新增或編輯時，不允許拖曳移動。

目的：

```text
避免未儲存資料被 reorder / refetch / package movement 覆蓋。
```

---

## 3. 多人協作時拖曳重排的保護規則

### 核心概念

多人協作時，拖曳重排不是即時共同編輯。

系統不嘗試合併多位使用者的拖曳意圖。

採用：

```text
先成功者優先，後送出的舊狀態操作拒絕。
```

也就是：

```text
使用者 A 先完成拖曳重排
使用者 B 仍用舊畫面送出拖曳
B 的操作應被拒絕，並重新載入最新行程資料
```

---

### 目前 4.2c 已有的保護

以下屬於 Phase 4.2c 已有概念：

- 拖曳重排走 RPC，不是純前端更新
- 驗證完整 timed manifest
- 驗證 visit / transportation `updated_at` baseline
- 使用 trip/day transaction lock 或 advisory lock
- fixed timed visit 會禁止當天 reorder（4.2c 現況）
- active foreign lock 會禁止 reorder
- active Timeline editor 會阻止 drag
- stale baseline / wrong manifest 會 rollback
- 失效交通卡會依規則刪除
- 成功後 reload authoritative trip data

---

### Phase 4.6 / 4.7 需要延續或加強的保護

因為 4.6 / 4.7 會自動調整多張時間，正式版不建議使用前端多次 update 完成。

建議：

```text
新增 022+ migration / 新 RPC
用 transaction RPC 一次完成 reorder + time recalculation + transport cleanup
```

RPC 應驗證：

- 使用者 edit permission
- timed manifest
- package permutation
- all related updated_at baseline
- fixed state
- edit lock state
- transportation baseline
- 原始 start_time / end_time
- 原始 duration
- 原始 adjacency / gap

只要任一條件不符：

```text
拒絕本次拖曳
rollback
重新載入最新資料
```

---

### 衝突處理

#### 正常情況

```text
使用者 A 拖曳成功
資料庫一次完成 reorder / time recalculation / transportation cleanup
其他使用者透過 Realtime 或 reload 看到最新結果
```

#### 衝突情況

```text
使用者 A 拖曳成功
使用者 B 使用舊畫面拖曳
B 的 RPC 被拒絕
B 看到提示並重新載入最新資料
B 可以在最新資料上重新操作
```

建議提示：

```text
此日行程已被其他成員更新，已為你載入最新版本，請重新操作。
```

---

### 不做的事情

多人拖曳保護不做以下事情：

- 不即時合併兩個人的拖曳意圖
- 不做 Google Docs 式同步拖曳
- 不讓前端自行判斷覆蓋誰的結果
- 不在衝突時自動選擇某個順序
- 不用多次前端 update 模擬 transaction
- 不在 Demo 接 Supabase / Realtime / Edit Lock
- 不修改已套用的 019 / 020 / 021 migrations

---

## 4. Phase 4.7：固定行程卡作為時間錨點的拖曳規則

> 此為討論中的新方向。  
> 它會取代目前 4.2c「當天有 fixed timed visit 就禁止整日拖曳」的保守規則。  
> 建議拆到 Phase 4.7，不要塞進 4.6 基本拖曳自動時間。

### 核心概念

固定卡本身不動，但其他卡可以跨過固定卡。

固定卡是：

```text
時間錨點 / 區隔線
```

固定卡：

- 資料不動
- 時間不動
- 不可拖曳
- 不被其他卡拖曳流程推動

其他非固定卡：

- 可以自由拖曳
- 可以跨過固定卡
- 若移動後時間塞得下，保留 timed 狀態並給新時間
- 若塞不下或會重疊，移動卡變成 untimed visit

---

### 固定卡規則

#### 1. 固定卡本身不變

固定卡代表：

- 目的地資料固定
- `start_time / end_time` 固定
- 不可拖曳
- 不可因其他卡拖曳而改變資料或時間

#### 2. 其他卡可以跨過固定卡

非固定 timed visit 可以拖到固定卡前後。

允許：

- 從固定卡前拖到固定卡後
- 從固定卡後拖到固定卡前
- 插入兩張固定卡之間
- 插入固定卡與一般 timed visit 之間

但固定卡本身不動。

---

### 固定卡時間錨點規則

#### 3. 無固定卡影響時

照 Phase 4.6 基本拖曳自動時間規則。

#### 4. 有固定卡影響時

固定卡優先。

跨固定卡拖曳時，不再套用整日自動接續。

改用固定錨點插入規則：

```text
系統檢查目標位置前後的可用時間空間。
```

#### 5. 若時間空間足夠

移動卡：

- 保留原本停留時長
- 保留 timed 狀態
- 取得新的 `start_time / end_time`

通常新形成相鄰時，直接從前一個時間錨點後方開始。

例如：

```text
GE 🔒 11:00~12:00
RE 14:00~14:20
```

把 BB 拖到 GE 下方，BB 原本停留 30 分鐘。

GE 到 RE 有可用時間：

```text
12:00 ~ 14:00
```

所以 BB 變成：

```text
BB 12:00~12:30
```

RE 不動。

#### 6. 若時間不足或會重疊

若移動過去後：

- 時間空間不足
- 會撞到固定卡
- 會與既有 timed visit 重疊

則移動卡：

- 清除 `start_time / end_time`
- 變成 untimed visit
- 保留在拖曳後的位置

例如：

```text
GE 🔒 11:00~12:00
RE 14:00~14:20
```

GE 到 RE 只有 2 小時空間。  
若 BB 停留超過 2 小時，拖到 GE 下方後：

```text
BB 變成未設定時間
RE 不動
GE 不動
```

#### 7. 兩張固定卡之間無空白時間

如果兩張固定卡之間完全沒有空白時間，則不可插入。

例如：

```text
A 🔒 10:00~11:00
B 🔒 11:00~12:00
```

中間沒有任何空白。

此時若想插入 timed visit，應直接拒絕。

建議提示：

```text
此區段沒有可插入的時間空間，請先調整固定行程，或改放到其他位置。
```

#### 8. 兩張固定卡之間有空白時間

如果兩張固定卡之間有空白時間，允許插入。

- 若移動卡停留時間放得下，保留 timed 並給新時間。
- 若有空白但時間不足，移動卡轉成 untimed。

---

### 固定卡範例

原本：

```text
AA 07:00~09:00
G 交通卡 20 分鐘
BB 10:00~10:30
GE 🔒 11:00~12:00
RE 14:00~14:20
```

把 BB 拖到 GE 下方：

```text
AA
GE 🔒 11:00~12:00
BB 12:00~12:30
RE 14:00~14:20
```

結果：

- GE 固定，時間不變
- RE 時間不變
- BB 保留 30 分鐘停留時長
- BB 取得新時間 `12:00~12:30`
- 原本 G 交通卡移除
- 不自動新增交通卡

若 BB 停留超過 2 小時：

```text
AA
GE 🔒 11:00~12:00
BB 未設定時間
RE 14:00~14:20
```

結果：

- BB 變成 untimed
- GE / RE 不動
- 交通卡依規則移除

---

## 5. Phase 4.5：未設定時間景點排序規則

> 這原本計畫在 4.5 處理，但因為 4.7 固定卡會把 timed visit 轉成 untimed，所以需要先給定義。

### 核心概念

未設時間卡可以混在行程內。

它代表：

```text
使用者想把這個目的地放在這個位置附近，但時間還沒決定。
```

拖曳時：

```text
untimed visit 只改變自己的位置，不影響其他 timed visits 的時間變動。
```

---

### 顯示與排序規則

#### 1. 未設時間卡可以混在行程內

untimed visit 不需要強制集中在最下面。

可以出現在：

- timed visit 前面
- timed visit 後面
- fixed visit 前後
- 兩張 timed visits 中間
- 兩張 fixed visits 中間

#### 2. 拖曳 untimed visit 只改位置

拖曳 untimed visit 時：

- 只改變它在畫面上的位置
- 不改變其他 timed visits 的 `start_time / end_time`
- 不觸發 Phase 4.6 自動時間接續
- 不新增交通卡
- 不刪除交通卡
- 不影響固定卡時間

#### 3. untimed visit 不參與時間接續

Phase 4.6 / 4.7 計算時間時，只看 timed visits。

untimed visit：

- 不產生 gap
- 不保留 gap
- 不造成 overlap
- 不參與 timed adjacency

#### 4. timed visit 轉成 untimed

若 timed visit 因固定卡時間空間不足而轉成 untimed：

- 清除 `start_time / end_time`
- 保留在拖曳後的位置
- 立即退出本次 timed auto-continuation
- 應提示使用者該卡已轉為未設定時間

建議提示：

```text
此行程無法在固定行程之間保留原停留時間，已改為未設定時間。
```

---

## 6. Untimed visit 與交通卡規則

### 核心概念

未設時間卡可以混在行程內，但不可插入到已有 transportation card 的兩張 timed visits 中間。

如果兩張 timed visits 之間已有交通卡，代表使用者已經明確建立：

```text
A → B
```

這段移動關係。

因此 untimed visit 不可以插入到 A 和 B 中間。

---

### 規則

#### 1. 有交通卡的 pair，中間不可插入 untimed visit

原本：

```text
A 09:00~10:00
交通卡 A → B
B 11:00~12:00
```

不允許拖成：

```text
A 09:00~10:00
C 未設定時間
交通卡 A → B
B 11:00~12:00
```

也不允許：

```text
A 09:00~10:00
交通卡 A → B
C 未設定時間
B 11:00~12:00
```

#### 2. 沒有交通卡的空白間隔，可以插入 untimed visit

如果 A 和 B 中間沒有交通卡：

```text
A 09:00~10:00
B 11:00~12:00
```

則可以插入：

```text
A 09:00~10:00
C 未設定時間
B 11:00~12:00
```

#### 3. untimed visit 插入交通 pair 時直接拒絕

untimed visit 不提供 Phase 4.3 的 Restore / Delete flow。

只要目標位置在已有交通卡的 pair 中間，就直接禁止插入。

建議提示：

```text
這裡已有交通卡連接，無法插入未設時間行程。
請先刪除交通卡，或將行程放到其他位置。
```

---

## 7. 交通卡整體規則整理

### timed visit 拖曳

- 原本交通卡兩端仍同方向相鄰 → 保留
- 原本交通卡兩端不再相鄰 → 移除
- 新形成相鄰關係 → 不自動新增交通卡

### timed visit 被轉成 untimed

若 timed visit 因時間空間不足轉成 untimed：

- 該卡不再參與 timed adjacency
- 與該卡相關的 timed transportation 應視為失效
- 不自動新增任何交通卡

### untimed visit 拖曳

- 不新增交通卡
- 不刪除交通卡
- 不影響 timed visits 時間
- 不可插入已有交通卡連接的 pair 中間

---


## 8. Phase 4.8：Collaborative Drag Presence

> 此階段放在固定卡拖曳規則之後。  
> 它處理「拖曳中的多人視覺狀態」，不代表正式資料已更新。  
> 正式資料仍以 reorder RPC 成功結果為準。

### 核心概念

當某位成員正在拖曳某一天的 timed visit 時，其他成員可以看到拖曳狀態，但不能同時拖曳該日行程。

這只是拖曳中的暫時視覺狀態：

```text
拖曳中 presence ≠ 正式資料更新
正式結果 = 拖曳者放開後確認 + reorder RPC 成功
```

---

### 保守規則

#### 1. 同一天只允許一位成員拖曳

同一天的 timed visit 拖曳採保守模式：

```text
若偵測到其他成員正在拖曳該日行程，
本機使用者的該日拖曳功能暫時 disabled。
```

目的：

- 避免兩人同時拖曳同一天造成 UI 期待混亂
- 降低 stale / conflict 發生頻率
- 讓正式資料仍由 reorder RPC 決定

#### 2. 不合併拖曳意圖

Collaborative Drag Presence 不做 Google Docs 式拖曳合併。

不做：

- 不即時合併兩個人的拖曳順序
- 不讓其他人的畫面真的跟著重排
- 不在 presence 階段推測最終順序
- 不取代 reorder RPC 的 manifest / baseline / conflict 驗證

---

### 視覺第一版

#### 3. 顯示拖曳者狀態

在被拖曳卡片旁顯示：

```text
{userName} 正在拖曳
```

#### 4. 顯示淡淡插入線

在目標插入位置顯示淡淡的插入線。

規則：

- 插入線不顯示文字
- 插入線只是 preview，不代表正式資料已更新
- 不讓其他使用者畫面中的卡片真的跟著重排

#### 5. 不使用大型干擾 UI

不顯示：

- 大型 modal
- toast
- error banner
- 全寬警告區塊

拖曳 presence 應該是輕量、安靜、不中斷規劃的視覺提示。

---

### 資料規則

拖曳中 presence 階段不可寫入正式行程資料。

拖曳中不做：

- 不寫入 `itinerary_items`
- 不更新 `start_time / end_time`
- 不刪除 transportation cards
- 不新增 transportation cards
- 不清除 draft
- 不釋放 edit lock
- 不移動 alternatives / linked budgets

presence 只是一個暫時狀態，不是資料提交。

---

### 正式儲存

#### 6. 只有拖曳者確認後才呼叫 reorder RPC

流程：

```text
拖曳開始
→ 發送 drag presence
→ 其他成員該日拖曳 disabled
→ 拖曳者放開
→ 顯示確認提示
→ 拖曳者確認
→ 呼叫 reorder RPC
```

#### 7. RPC 成功後才更新正式結果

RPC 成功後：

- 資料庫寫入正式 reorder 結果
- 所有人透過 Realtime / reload 看到正式結果
- presence 狀態清除

#### 8. RPC 失敗時走既有 conflict 規則

RPC 失敗時：

- 不套用拖曳結果
- 清除本次 presence
- 依既有 stale / conflict 規則處理
- 重新載入 authoritative trip data

建議提示：

```text
此日行程已被其他成員更新，已為你載入最新版本，請重新操作。
```

---

### 和多人協作保護規則的關係

Collaborative Drag Presence 是「操作前與操作中的 UX 保護」。

transaction RPC / timed manifest / updated_at baseline 是「正式儲存時的資料安全保護」。

兩者都需要：

```text
presence：減少同時拖曳與降低使用者困惑
RPC validation：保證正式資料不被舊狀態覆蓋
```

---

## 9. 建議實作順序

### Phase 4.4

修改時間後，局部自動接續時間。

範圍：

- 只處理編輯 start_time / end_time 後的後續 timed visits
- 不處理 drag reorder
- 不處理 untimed mixed sorting
- 不處理 fixed anchor 跨區拖曳

### Phase 4.5

未設定時間景點排序規則。

範圍：

- untimed visit 可以混在行程內
- untimed visit 拖曳只改位置
- untimed visit 不影響 timed auto-continuation
- untimed visit 不可插入已有交通卡的 pair 中間

### Phase 4.6

拖曳 timed visit 後，自動調整時間。

範圍：

- 無固定卡或不涉及固定卡的基本 timed drag auto-continuation
- 每張卡保留 duration
- 原本仍同方向相鄰保留 gap
- 新相鄰 / 方向反轉直接接續
- 交通卡保留 / 移除 / 不新增
- 多人協作保護需要 transaction RPC 設計

### Phase 4.7

固定卡作為時間錨點的拖曳規則。

範圍：

- 固定卡本身不可拖曳，資料與時間不動
- 其他卡可以跨固定卡
- 能塞入固定卡時間空間則給新時間
- 塞不下或重疊則移動卡轉 untimed
- 兩張固定卡無空白時間時不可插入

### Phase 4.8

Collaborative Drag Presence。

範圍：

- 拖曳中 presence 只做暫時視覺狀態
- 同一天只允許一位成員拖曳
- 其他成員看到「{userName} 正在拖曳」與淡淡插入線
- 其他成員該日拖曳暫時 disabled
- 拖曳中不寫入 itinerary_items、不改時間、不刪交通卡、不清 draft、不釋放 edit lock
- 正式結果仍以 reorder RPC 成功為準

### Phase 4.9

Map 整合前置設計。

### Phase 4.10

QA 與交接。

---

## 9. 待確認事項

以下細節後續仍可再討論：

1. 固定卡邏輯是否要和 Phase 4.6 同時實作，或明確拆到 Phase 4.7。
2. 若 timed visit 拖入已有交通卡 pair 中間，但最後因時間不足轉成 untimed，是否仍刪除原交通卡，或直接拒絕。
3. untimed visit 混在行程中時，視覺上是否需要特別標示「未設定時間」。
4. timed visit 轉 untimed 後，是否需要顯示一次性提示或在卡片上保留 warning。
5. fixed card 前後若存在 transportation card，跨固定卡拖曳時是否需要更嚴格保護。
6. Phase 4.6 / 4.7 是否需要新 migration 022+ 與新 RPC。初步建議需要。
7. Collaborative Drag Presence 的技術實作要使用 Supabase Realtime presence、獨立 presence table，或既有 Realtime channel metadata，待實作前確認。
8. presence timeout / tab close / drag cancel 後的清除策略，待實作前確認。

---

## 10. 一句話總結

```text
Phase 4 後續應拆開處理：
4.4 先做修改時間後局部接續；
4.5 定義未設時間卡可混排行程但不影響時間，且不可插入交通 pair；
4.6 再做 timed visit 拖曳後自動調整時間；
4.7 處理固定卡作為時間錨點，允許其他卡跨過固定卡，塞得下給時間，塞不下轉未設定時間；
4.8 加入 Collaborative Drag Presence，讓多人協作時可看到拖曳中狀態並暫時禁止同日多人同時拖曳；
4.9 再進 Map 整合前置設計；
4.10 最後做 QA 與交接。
```
