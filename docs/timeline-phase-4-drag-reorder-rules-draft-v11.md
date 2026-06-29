# Timeline Phase 4 拖曳重排 / 多人協作 / 固定卡 / 未設時間規則草稿 v11

Date: 2026-06-29
Status: Full rules draft for next chat / updated after Phase 4.6 implementation + fixed/untimed normalization hotfix + Phase 4.7 continuation-segment fixed anchor decision

> 本文件以 v9 為底更新 Phase 4.6 已完成後的最新規則。
> Phase 4.6 已完成 timed visit drag auto-continuation：拖曳後依新的 timed-only 順序重算時間，保留每張 complete timed visit 自己的 duration，不交換 time slot。
> 本版正式收斂 fixed / untimed 規則：只有 complete timed visit 可以 fixed 並作為 fixed anchor；untimed / partial time 不可 fixed，legacy fixed untimed 需在 normalize 時清除 fixed 狀態，且不可阻擋 drag / rebase / auto-continuation。
> 本版仍保留 Phase 4.5b / 4.5c 的 transportation role model、mixed visual drag target、`brokenTransportIds`，以及 timed / untimed 插入既有交通 pair 中間時的確認刪除規則。
> 本版更新 Phase 4.7 方向：採「延續區段版 fixed anchor drag」。fixed anchor 將同一天切成可調整區段；拖曳跨固定卡後，重算受影響 fixed 區段內的非固定 complete timed visits，若撞到下一個 fixed anchor，從第一張塞不下的非固定 timed visit 開始轉為 untimed。
> 本文件仍是規則草稿與新聊天室 handoff 依據，後續可再拆成 Codex prompt 或正式 handoff。

---

## 0. 目前 Phase 狀態與後續拆分建議

目前已完成：

```text
Phase 4.3：新增 / 編輯景點時間插入既有交通 pair 提示
Phase 4.4：修改時間後，局部自動接續時間
Phase 4.5：未設定時間景點排序規則 / Stabilization
Phase 4.5 Hotfix 3：tail restore、fixed 接續 disabled、Restore/Delete 補強
Phase 4.5b：Transportation Role Model（normal_pair / tail_pending / tail_promoted_pair）
Phase 4.5c：Mixed Drag Target / Prompt Cleanup（mixed visual order、brokenTransportIds、untimed 插入交通 pair 可確認刪除）
Phase 4.6：Timed Visit Drag Auto-Continuation（duration-preserving time recalculation、Formal transaction RPC 023、Demo/Formal parity）
Phase 4.6 Hotfix：fixed / untimed 規則收斂（untimed 不可 fixed；legacy fixed untimed normalize 清除 fixed 狀態）
```

後續建議拆分：

```text
Phase 4.7：固定行程卡作為時間錨點的拖曳規則（延續區段版 fixed anchor drag）
Phase 4.8：Collaborative Drag Presence，多人拖曳中狀態提示
Phase 4.9：Map 整合前置設計
Phase 4.10：QA 與交接
```

拆分原因：

- 不把拖曳、自動時間、固定卡、未設時間卡、交通卡限制全部塞進同一個 Phase。
- Phase 4.5 / 4.5b / 4.5c 已先把 untimed mixed order 與 transportation role model 穩定。
- Phase 4.6 已完成 timed drag auto-continuation，只處理無 fixed anchor 或不跨 fixed anchor 的基本 duration-preserving recalculation。
- Phase 4.6 已確立每張 complete timed visit 保留自己的 duration，不可交換時間 slot。
- Phase 4.6 Hotfix 已確立 untimed / partial time 不可 fixed；只有 complete timed + fixed 才能作為 Phase 4.7 anchor。
- Phase 4.7 再處理固定卡作為時間錨點的進階拖曳規則，採延續區段版：fixed anchor 切分 day segments，受影響區段內依 Phase 4.6 規則接續，撞到下一個 fixed anchor 時從第一張塞不下的非固定 timed visit 開始轉 untimed。
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

沒有完整設定 `start_time` / `end_time` 的目的地行程卡。

判定規則：

```text
只要 start_time 或 end_time 任一個不存在 / 未設定 / null，該 visit 就視為 untimed visit。
```

也就是：

| start_time | end_time | 判定 |
|---|---|---|
| 有 | 有 | timed visit |
| 無 | 無 | untimed visit |
| 有 | 無 | untimed visit |
| 無 | 有 | untimed visit |

原因：

- 沒有 `start_time`，系統無法判斷排序時間點。
- 沒有 `end_time`，系統無法計算停留時長。
- 只有其中一個時間時，不能參與 overlap、auto-continuation、transport shortage 或 timed adjacency 判斷。

儲存建議：

```text
若使用者將 start_time 或 end_time 任一個設為未設定，另一個也應同步清除，避免留下 partial timed state。
```

它代表：

```text
使用者想把這個目的地放在行程順序裡，但時間還沒決定。
```

### transportation card

交通卡分成三種角色，不應只靠 `from_item_id / to_item_id` 推測語意。

#### normal_pair

一般交通卡，代表使用者明確建立的 `A → B` 交通。

```text
A timed
transport A → B
B timed
```

資料概念：

```text
transport_role = normal_pair
from_item_id = A
to_item_id = B
```

#### tail_pending

尾端待配對交通卡，代表「目前最後一個已排定行程後，準備接下一個行程的交通」。

```text
A timed
tail transport
```

資料概念：

```text
transport_role = tail_pending
from_item_id = A
to_item_id = null
```

若 tail transport 後方有 untimed visit，該 untimed visit 只是候選下一行程，不會立刻形成 pair。

```text
A timed
tail transport warning
B untimed
```

#### tail_promoted_pair

由尾端交通形成的交通 pair。

```text
A timed
tail transport
B untimed
```

當 B 設定完整時間，且排序合理地接在 A 後方，tail transport 會升級為：

```text
A timed
transport A → B
B timed
```

資料概念：

```text
transport_role = tail_promoted_pair
from_item_id = A
to_item_id = B
```

此角色看起來像一般 `A → B`，但來源是 tail transport，因此當 B 再改回 untimed 時，應退回 `tail_pending`，而不是依 normal pair 規則處理。

### fixed timed visit

已被使用者鎖定的 complete timed visit。

判定規則：

```text
只有 start_time 與 end_time 都存在的 visit，才可以 fixed。
untimed / partial time visit 不可 fixed，也不可作為 fixed anchor。
```

固定卡代表：

- 目的地資料不動
- `start_time / end_time` 不動
- 不可拖曳
- 不可被自動時間接續推動

### fixed untimed legacy dirty data

`is_fixed = true` 但缺少 `start_time` 或 `end_time` 的 visit 視為 legacy / dirty data，不可當作合法固定卡。

規則：

- UI 不應讓 untimed / partial time 顯示固定按鈕。
- toggle fixed 僅允許 complete timed visit 執行。
- normalize visit payload 時，若 visit 不是 complete timed，應清除 `is_fixed / fixed_at / fixed_by`。
- legacy fixed untimed 不可阻擋 drag / rebase / auto-continuation。
- legacy fixed untimed 不可作為 Phase 4.7 fixed anchor。

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

## 2. Phase 4.4 補充：固定卡與自動接續限制

> Phase 4.5 stabilization 補充。
> 這一段只處理「修改時間後按接續」的保守限制，不等於 Phase 4.7 的拖曳跨固定卡規則。

### 核心概念

固定卡跨越規則目前只適用於拖曳流程的未來設計，不適用於修改時間後的自動接續。

若使用者只是按「儲存」，系統只更新目前這張行程卡的時間。
若時間不重疊且通過既有 validation，允許該行程依 `start_time` 重新排序到 fixed card 前後。

若使用者按「接續」，系統會嘗試自動調整後續行程時間。
因此當新的時間位置會跨越同一天任一 fixed timed visit 時，「接續」不可使用。

---

### 規則

#### 1. 儲存可以跨固定卡

如果使用者編輯某張非固定 timed visit 的時間，新的 `start_time / end_time` 讓該 visit 排序到 fixed timed visit 前後，只要沒有時間重疊，按「儲存」是合法的。

原因：

- 這是使用者明確修改目前卡片時間。
- timed visits 本來就依 `start_time` 排序。
- 若時間重疊 fixed visit，既有 overlap validation 會阻擋。
- 若沒有重疊，只是排序到 fixed visit 前後，視為合法時間修改。

#### 2. 接續不可跨固定卡

如果使用者編輯某張非固定 timed visit 的時間後，新的時間位置會跨越同一天任一 fixed timed visit，則「接續」不可使用。

原因：

- 固定卡是時間錨點。
- 「修改時間 + 接續」不應隱性產生跨固定卡的自動重排。
- 跨 fixed anchor 的進階處理應留到 Phase 4.7 的拖曳固定錨點規則。
- 在 Phase 4.4 / 4.5 stabilization 階段，系統不應嘗試自動接續跨過 fixed card。

#### 3. UI 行為

當時間變更會跨越 fixed timed visit 時：

```text
接續 button disabled
儲存 button 仍可使用
```

建議提示：

```text
跨越固定行程時無法接續
```

或：

```text
此時間會跨越固定行程，無法自動接續。
請直接儲存，或改用拖曳重新安排。
```

#### 4. 不做的事

此規則不做以下事情：

- 不阻擋合法的單張時間儲存。
- 不自動把跨 fixed 的行程轉成 untimed。
- 不自動推動 fixed visit。
- 不自動跨 fixed anchor 接續後方行程。
- 不提前實作 Phase 4.7 拖曳跨固定卡規則。

---

## 3. Phase 4.6：拖曳 timed visit 後，自動調整時間

> Phase 4.6 已完成。
> 原本討論中的 4.4b 基本規則已拆到 Phase 4.6，並已實作 duration-preserving timed drag auto-continuation。

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

### 已完成實作摘要

Phase 4.6 已完成以下內容：

- `planTimedDragAutoContinuation`：依新 timed-only order 重算 complete timed visits 的時間。
- Formal / Demo drag flow：timed drag 會帶 `timedAutoContinuation: true`。
- Formal transaction RPC：透過 migration `023_reorder_itinerary_timed_auto_continuation.sql` 一次完成 package move、time recalculation、transport cleanup。
- regression tests：已覆蓋 duration preservation、same-direction gap、direction reversal、mixed untimed、transport cleanup 等 Phase 4.6 核心情境。
- fixed / untimed hotfix：只有 complete timed visit 可 fixed；legacy fixed untimed 會 normalize 清除 fixed 狀態，且不可阻擋 drag / rebase / auto-continuation。

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

#### 10. untimed visits 不可 fixed

未設定時間卡與 partial time 卡不可 fixed，也不可成為 fixed anchor。

若資料中存在 legacy fixed untimed：

- normalize 時清除 fixed 狀態。
- 不可阻擋 drag / rebase / auto-continuation。
- 不可顯示成固定卡。
- 不可讓內部 stale sort-order code 直接顯示到 UI。

#### 11. 有 active editor 時禁止拖曳

有行程正在新增或編輯時，不允許拖曳移動。

目的：

```text
避免未儲存資料被 reorder / refetch / package movement 覆蓋。
```

---

## 4. 多人協作時拖曳重排的保護規則

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

## 5. Phase 4.7：固定行程卡作為時間錨點的拖曳規則（延續區段版）

> 此為討論中的新方向。
> 它會取代目前 4.2c「當天有 fixed timed visit 就禁止整日拖曳」的保守規則。
> Phase 4.7 採「延續區段版 fixed anchor drag」，不要採「只看目標前後兩張卡的保守插入版」。
> 不要塞進 Phase 4.6 基本拖曳自動時間；Phase 4.6 已完成無 fixed anchor 或不涉及 fixed anchor 的基本 duration-preserving recalculation。

### 核心概念

固定卡本身不動，但其他非固定行程可以跨過固定卡。

固定卡是：

```text
complete timed visit + is_fixed
時間錨點 / 區隔線 / day segment boundary
```

untimed / partial time visit 不可 fixed，也不可成為時間錨點。

固定卡：

- 資料不動
- `start_time / end_time` 不動
- 不可拖曳
- 不被其他卡拖曳流程推動
- 不被 auto-continuation 改時間
- 可被 planner 讀取作為時間邊界，但不可被 planner 更新

其他非固定卡：

- 可以拖曳
- 可以跨過固定卡
- 跨 fixed anchor 後，只重算受影響 fixed 區段內的非固定 complete timed visits
- 若受影響區段能塞入下一個 fixed anchor 前，保留 timed 狀態並取得新時間
- 若受影響區段重算後撞到下一個 fixed anchor，從第一張塞不下的非固定 timed visit 開始，該張與後續同區段非固定 timed visits 轉成 untimed
- untimed visits 只保留 mixed visual position，不參與時間接續

---

### 固定卡規則

#### 1. fixed anchor 定義

只有以下狀態才是 fixed anchor：

```text
start_time exists
end_time exists
is_fixed = true
```

也就是：

```text
complete timed visit + is_fixed = fixed anchor
```

不合法 anchor：

```text
untimed + is_fixed
partial time + is_fixed
```

若資料中有 legacy fixed untimed / fixed partial time：

- normalize 時清除 `is_fixed / fixed_at / fixed_by`
- 不顯示固定狀態
- 不作為 fixed anchor
- 不阻擋 drag / rebase / auto-continuation

#### 2. 固定卡本身不變

固定卡代表：

- 目的地資料固定
- `start_time / end_time` 固定
- 不可拖曳
- 不可因其他卡拖曳而改變資料或時間
- 不可因 untimed rebase 改變 sort_order 或 fixed state
- 不可因 auto-continuation 被推動

簡化：

```text
fixed anchor 可以當路標，但不能被搬動。
```

#### 3. 其他卡可以跨過固定卡

非固定 timed visit 可以拖到固定卡前後。

允許：

- 從固定卡前拖到固定卡後
- 從固定卡後拖到固定卡前
- 插入兩張固定卡之間
- 插入固定卡與一般 timed visit 之間
- 插入固定卡前方第一段或固定卡後方尾段

但固定卡本身不動。

---

### 延續區段版 fixed anchor 規則

#### 4. fixed anchor 將同一天切成多個可調整區段

同一天的 complete timed fixed anchors 會把 timeline 切成多個區段。

例如：

```text
A 08:00~09:00
F1 🔒 10:00~11:00
B 12:00~13:00
C 13:30~14:00
F2 🔒 15:00~16:00
D 17:00~18:00
```

切成：

```text
區段 1：A
Fixed anchor：F1
區段 2：B / C
Fixed anchor：F2
區段 3：D
```

fixed anchors 不參與重算，只作為區段邊界。

#### 5. 未涉及 fixed anchor 的拖曳

若拖曳不跨 fixed anchor，也不會讓受影響區段撞到 fixed anchor：

```text
照 Phase 4.6 基本拖曳自動時間規則。
```

也就是：

- 每張 complete timed visit 保留自己的 duration
- 原本仍同方向相鄰的 pair 保留 gap
- 新相鄰 / 方向反轉直接接續
- untimed 不參與時間計算
- 不新增交通卡
- brokenTransportIds 照既有流程處理

#### 6. 涉及 fixed anchor 的拖曳

若拖曳跨過 fixed anchor，或拖曳後的 timed order 會影響 fixed anchor 前後區段：

```text
只重算受影響 fixed 區段內的非固定 complete timed visits。
```

受影響區段的時間起點 / 終點：

- 若區段前方有 fixed anchor，區段起點 = 前方 fixed anchor 的 `end_time`
- 若區段前方沒有 fixed anchor，區段起點 = Phase 4.6 規則中的原本第一張 timed visit start_time
- 若區段後方有 fixed anchor，區段終點 = 後方 fixed anchor 的 `start_time`
- 若區段後方沒有 fixed anchor，區段沒有固定終點，依 Phase 4.6 往後接續

區段內重算仍沿用 Phase 4.6 規則：

- 每張非固定 complete timed visit 保留自己的 duration
- 原本仍同方向相鄰的 pair 保留原本 total gap
- 新形成相鄰 / 方向反轉直接接續
- untimed 不參與時間接續
- 不新增交通卡
- fixed anchor 不動

#### 7. 區段能塞入下一個 fixed anchor 前

如果受影響區段重算後，所有非固定 complete timed visits 都能在下一個 fixed anchor 前完成：

```text
全部保留 timed。
```

例如：

```text
F1 🔒 10:00~11:00
D 17:00~18:00
B 12:00~13:00
C 13:30~14:00
F2 🔒 15:00~16:00
```

把 D 拖到 F1 後、B 前，重算 F1 / F2 中間區段：

```text
F1 🔒 10:00~11:00
D 11:00~12:00
B 12:00~13:00
C 13:30~14:00
F2 🔒 15:00~16:00
```

結果：

- F1 / F2 不動
- D / B / C 保留自己的 duration
- D / B / C 依區段內新順序重算時間
- 若原本同方向相鄰仍存在，保留 gap
- 新相鄰直接接續
- 不新增交通卡

#### 8. 區段撞到下一個 fixed anchor

如果受影響區段重算後，某張非固定 timed visit 會撞到下一個 fixed anchor：

```text
從第一張塞不下的非固定 timed visit 開始，
該張與後續同區段非固定 timed visits 清除 start_time / end_time，
轉成 untimed visit，
並保留拖曳後的 mixed visual position。
```

例如：

```text
F1 🔒 10:00~11:00
D 11:00~13:00
B 13:00~14:00
C 14:30~15:30
F2 🔒 15:00~16:00
```

C 會撞到 F2，所以結果應為：

```text
F1 🔒 10:00~11:00
D 11:00~13:00
B 13:00~14:00
C 未設定時間
F2 🔒 15:00~16:00
```

如果 B 也放不下，則：

```text
F1 🔒
D timed
B untimed
C untimed
F2 🔒
```

注意：

- 不是只把 moved card 轉 untimed
- 而是從第一張塞不下的非固定 timed visit 開始，後續同區段非固定 timed visits 都轉 untimed
- fixed anchor 不動
- 已轉 untimed 的卡保留 visual order，不參與後續 timed continuation
- 轉 untimed 後可依 Phase 4.5 rebase 規則保護既有 untimed 位置，但不得 compact 其他 untimed

建議提示：

```text
部分行程無法在固定行程前保留原停留時間，已改為未設定時間。
```

若只有被拖曳卡轉 untimed，也可提示：

```text
此行程無法在固定行程前保留原停留時間，已改為未設定時間。
```

#### 9. 兩張 fixed anchors 中間完全沒有空白時間

如果兩張 fixed anchors 之間完全沒有空白時間，且使用者想把 timed visit 插入該區段，應直接拒絕。

例如：

```text
A 🔒 10:00~11:00
B 🔒 11:00~12:00
```

中間沒有任何空白。

建議提示：

```text
此區段沒有可插入的時間空間，請先調整固定行程，或改放到其他位置。
```

#### 10. 前段與尾段

若拖曳目標在第一個 fixed anchor 之前：

- 區段終點 = 第一個 fixed anchor 的 `start_time`
- 區段起點 = Phase 4.6 的原本第一張 timed visit start_time
- 若重算後撞到第一個 fixed anchor，從第一張塞不下的非固定 timed visit 開始轉 untimed

若拖曳目標在最後一個 fixed anchor 之後：

- 區段起點 = 最後一個 fixed anchor 的 `end_time`
- 區段沒有後方 fixed 終點
- 區段內可依 Phase 4.6 往後接續
- 不需要因沒有後方 fixed 而轉 untimed，除非另有 overlap / invalid time 規則

---

### 交通卡規則

#### 11. 沿用既有 transportation role / brokenTransportIds

Phase 4.7 不重新設計 transport model。

仍沿用：

- `normal_pair`
- `tail_pending`
- `tail_promoted_pair`
- `brokenTransportIds`
- 交通卡移除確認流程

#### 12. 不自動新增交通卡

跨 fixed anchor 拖曳後，即使形成新相鄰關係，也不自動新增交通卡。

#### 13. 既有交通卡保留 / 移除

- 原本交通卡兩端仍同方向相鄰 → 保留
- 原本交通卡兩端不再相鄰 → 依 `brokenTransportIds` 顯示確認並移除
- `tail_pending` 不是已成立 pair，不可當成 normal_pair 處理
- timed → untimed conversion 後，交通卡依 Phase 4.5b / 4.5c role 規則處理

---

### 不做的事

Phase 4.7 不做以下事情：

- 不採保守插入版
- 不只檢查目標前後兩張卡
- 不只把 moved card 轉 untimed
- 不推動 fixed anchor
- 不讓 untimed / partial time 成為 fixed anchor
- 不新增交通卡
- 不重構 transportation role model
- 不做 collaborative drag presence
- 不做 Map integration
- 不做 Google Docs-style drag merge

---

### 固定卡範例

#### 範例 A：跨 fixed anchor 並成功塞入區段

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
- RE 在同一受影響區段中，若依 Phase 4.7 planner 判定需要重算，則保留 RE duration 並依區段規則重算；若 RE 是區段外或未受影響，則不動
- BB 保留 30 分鐘停留時長
- BB 取得新時間 `12:00~12:30`
- 原本 G 交通卡若不再相鄰，依 brokenTransportIds 確認後移除
- 不自動新增交通卡

#### 範例 B：區段撞到下一個 fixed anchor

原本：

```text
F1 🔒 10:00~11:00
B 12:00~13:00
C 13:30~14:00
F2 🔒 15:00~16:00
D 17:00~19:00
```

把 D 拖到 F1 / B 之間：

```text
F1 🔒 10:00~11:00
D 11:00~13:00
B 13:00~14:00
C 14:30~15:00
F2 🔒 15:00~16:00
```

若 C 剛好到 15:00 前結束，合法。

若 C 會超過 15:00，例如：

```text
C 14:30~15:30
```

則 C 撞到 F2，結果：

```text
F1 🔒 10:00~11:00
D 11:00~13:00
B 13:00~14:00
C 未設定時間
F2 🔒 15:00~16:00
```

#### 範例 C：兩張 fixed anchors 中間無空白

```text
F1 🔒 10:00~11:00
F2 🔒 11:00~12:00
```

拖 timed visit 到 F1 / F2 之間：

```text
拒絕插入
```

提示：

```text
此區段沒有可插入的時間空間，請先調整固定行程，或改放到其他位置。
```

---

## 6. Phase 4.5：未設定時間景點排序規則

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

#### 0. Partial time 一律視為 untimed

若一張 visit 只有 `start_time` 或只有 `end_time`，不顯示成半套 timed card。

應視為 untimed visit：

- 不參與 timed sorting
- 不參與 overlap validation
- 不參與 auto-continuation
- 不參與 transport shortage 計算
- 不作為有效 timed adjacency 端點

資料層建議直接清除另一個時間欄位，避免畫面出現 `--:--` 搭配單一時間的狀態。

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
- 不主動改變 timed visits 的時間；若 mixed visual order 破壞既有交通 pair，需先提示並在確認後刪除受影響交通卡
- 不影響固定卡時間

#### 3. untimed visit 不參與時間接續

Phase 4.6 / 4.7 計算時間時，只看 timed visits。

untimed visit：

- 不產生 gap
- 不保留 gap
- 不造成 overlap
- 不參與 timed adjacency

#### 3.1 untimed visit 不可固定

untimed visit / partial time visit 不顯示固定按鈕，也不可執行 toggle fixed。

原因：

```text
fixed 的語意是完整時間錨點；
untimed 沒有完整 start_time / end_time，因此不能作為時間錨點。
```

若資料中存在 `is_fixed = true` 的 untimed / partial time visit，視為 legacy dirty data：

- normalize 時清除 `is_fixed / fixed_at / fixed_by`。
- 不把它當 fixed anchor。
- 不讓它阻擋 untimed slot rebase。
- 不讓它阻擋 drag reorder / timed auto-continuation。
- 不直接顯示 `untimed_sort_order_stale` 等內部錯誤碼。

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

### 5. Untimed slot / rebase 規則

> Phase 4.5 stabilization 補充。
> 這一段用來避免 untimed visit 因 timed gaps 改變而跳位。

#### 5.1 Untimed slot 計算只看同一天

untimed visit 的 position / slot 計算必須限定在同一天的 `dayItems`。

不可以使用整個 trip 的全部 items 來計算 untimed slot。

原因：

```text
不同天的 sort_order / untimed slot 不應影響當天行程的顯示位置。
```

錯誤情境：

```text
Day 1 的 untimed slot 影響 Day 2 的 untimed visit，
導致該 visit 被解讀到尾端或錯誤區段。
```

正確規則：

- 同一天內計算 display order。
- 同一天內計算 timed gaps。
- 同一天內計算 untimed slot。
- 跨日資料不可影響當日 untimed visit 的位置。

#### 5.2 Rebase 的目的

rebase 不是自動整理排序，也不是自動 compact。

rebase 的目的只有一個：

```text
避免既有 untimed visit 因 timed gap 結構改變，而被舊 slot 編碼錯誤解讀到其他位置。
```

例如：

```text
A timed
B timed
C timed
D fixed
```

A 修改時間並按「接續」後，C 撞到 D，因此 C 變 untimed 並留在 D 前。

接著 B 也變 untimed，當日 timed gaps 改變。

此時必須 rebase 既有 untimed C，讓 C 仍維持在 D 前，而不是被舊 slot 解讀到 D 後。

#### 5.3 timed → untimed 時可以 rebase

當同一天內有 visit 從 timed 變成 untimed 時，系統可以同步 rebase 當日既有 untimed visits。

適用情境：

- 使用者手動將 timed visit 改為未設定時間。
- Phase 4.4 auto-continuation 撞到 fixed anchor，導致後續 visit 轉為 untimed。
- partial time 正規化後，原本被視為 timed 的 visit 轉為 untimed。

rebase 後的目標：

- 既有 untimed visits 保持原本視覺位置附近。
- 既有 untimed visits 不應因 timed gaps 改變而跳到 fixed visit 後方。
- 既有 untimed visits 不應掉到尾端。
- passive transportation warning flow 不被破壞。
- invalid transport stack 不應因 rebase 產生假陽性。

#### 5.4 untimed → timed 時不可自動 compact 其他 untimed

當某張 untimed visit 被重新設定完整 `start_time / end_time`，並恢復為 timed visit 時：

```text
只移動 / 更新被恢復為 timed 的那張 visit。
其他既有 untimed visits 不應自動往上補位。
```

不允許的行為：

```text
B、C 原本因 fixed anchor overflow 變成 untimed。
使用者逐一恢復 B、C 的時間。
下方其他 untimed visits 因為 B、C 離開 untimed layer 而逐步往上位移。
```

原因：

```text
untimed visit 的位置代表使用者手動安排或系統保留的視覺意圖，
不應因其他卡恢復時間而自動 compact。
```

核心規則：

```text
rebase ≠ compact
```

- rebase：保護既有 untimed 不被錯誤解讀。
- compact：自動把 untimed 卡片排緊、補空位。Phase 4.5 不做 compact。

#### 5.5 staged restore 時保留交通方向

若 untimed visit 與既有交通卡有 `from_item_id / to_item_id` 關係，在逐步恢復時間的 staged restore 過程中，系統必須保留原交通方向的相對順序。

例如原本：

```text
A
transport A → B
B
```

A、B 都轉成 untimed 後，仍應維持：

```text
A
transport A → B
B
```

若使用者先恢復 A，B 仍然是 untimed：

```text
A timed
transport A → B warning
B untimed
```

B 不可暫時跑到 A 前面。

若再恢復 B，且 A / B 重新形成合理相鄰關係：

```text
A timed
transport A → B
B timed
```

交通卡應回到正常相鄰位置，不應進入 invalid transport stack。

若恢復後時間間隔不足，可以顯示「交通時間不足」warning；這不是 invalid transport。

#### 5.6 Rebase 觸發時機整理

| 情境 | 是否允許 rebase 其他 untimed | 說明 |
|---|---|---|
| timed → untimed | 可以 | 用來避免既有 untimed 被錯誤解讀到其他 gap |
| auto-continuation overflow → untimed | 可以 | 例如 C 撞 fixed D 後留在 D 前 |
| partial time 正規化為 untimed | 可以 | 若原本影響 timed gap 結構，需保護既有 untimed |
| untimed → timed | 不應 compact | 只更新被恢復時間的那張，不讓其他 untimed 自動補位 |
| 使用者主動拖曳 untimed | 只更新被拖曳那張 | 不新增 / 不刪交通卡，依主動拖曳規則 |
| passive transport warning flow | 不應破壞 | rebase 不應讓交通卡消失、置頂或進 invalid stack |

---

## 7. Phase 4.5b：Transportation Role Model

> Phase 4.5b 的目標是先讓系統正式分清楚交通卡角色。
> 這不是 Phase 4.6 timed drag auto-continuation，也不是 Phase 4.7 fixed anchor drag。
> 目前沒有正式使用者，既有測試資料可以清理、刪除或重建；以最佳資料模型與最乾淨實作為優先。

### 核心概念

交通卡不能只靠畫面位置或 `to_item_id === null` 臨時判斷。

系統必須明確知道每張交通卡是：

```text
normal_pair：一般 A→B 交通
tail_pending：尾端待配對交通
tail_promoted_pair：由尾端交通形成的 A→B
```

原因：

同樣看起來像：

```text
A
transport A → B
B
```

實際上可能有兩種來源：

```text
normal_pair
tail_promoted_pair
```

兩者在 B 改成 untimed 時行為不同。

---

### 7.1 交通角色資料模型

建議新增欄位：

```text
transport_role
```

允許值：

```text
normal_pair
tail_pending
tail_promoted_pair
```

建議使用新 migration，例如：

```text
022_add_transport_role_to_itinerary_items.sql
```

不要修改已套用的 migrations 019 / 020 / 021。

既有資料處理原則：

- 目前沒有正式使用者，既有測試資料可以刪除或重建。
- 若需要 backfill，可簡化處理：
  - `to_item_id is null` → `tail_pending`
  - `to_item_id is not null` → `normal_pair`
- 若既有交通資料與新模型衝突，可以清掉測試資料，不需為舊測試資料保留複雜兼容邏輯。
- Demo mock data 必須同步更新為新角色格式。

---

### 7.2 normal_pair：一般交通

#### 畫面

```text
A 09:00~10:00
transport A → B
B 10:30~11:00
```

#### 資料

```text
transport_role = normal_pair
from_item_id = A
to_item_id = B
```

#### 行為

若 B 改成 untimed：

```text
A timed
transport A → B warning
B untimed
```

規則：

- 交通卡自動保留。
- 顯示未設定時間 warning。
- 不自動刪除。
- 不自動改成 tail transport。
- 後續使用者拖曳 B 或修改 B 時間，若會破壞 pair，才依既有提示或移除流程處理。

若 B 仍是 timed，但修改時間後跑到 A 前面，或 A / B 不再相鄰：

```text
B timed
A timed
transport A → B ?
```

規則：

- 這是主動破壞 normal pair。
- 儲存前顯示既有 Restore / Delete Transportation 對話框。
- Restore：保留 editor 與交通卡，不寫入變更。
- Delete：儲存變更並移除受影響交通卡。

---

### 7.3 tail_pending：尾端待配對交通

#### 畫面

```text
A 09:00~10:00
tail transport
```

#### 資料

```text
transport_role = tail_pending
from_item_id = A
to_item_id = null
```

#### 用途

tail_pending 是讓使用者可以順著往下規劃的待配對交通。

例如：

```text
A timed
tail transport
B untimed
```

B 還沒有時間，所以 B 不會立刻吃掉尾端交通，也不會形成 `A → B`。

#### 規則

若 tail transport 後方是 untimed visit：

```text
A timed
tail transport warning
B untimed
```

則：

- 不形成 pair。
- 不進 invalid stack。
- 不跳 Restore / Delete Transportation。
- 交通卡保留。
- 顯示未設定時間 warning。

建議 warning：

```text
下一個行程時間未設定，請重新確認交通卡。
```

---

### 7.4 tail_pending + untimed 設定時間

原本：

```text
A 09:00~10:00
tail transport
B untimed
```

當 B 設定完整時間後，系統才判斷是否形成 pair。

#### 情境 A：B 時間合理，排在 A 後方

B 設定為：

```text
B 10:30~11:00
```

如果排序後 B 合理接在 A 後方，且 A / B 之間沒有其他 timed visit 插入：

```text
A 09:00~10:00
transport A → B
B 10:30~11:00
```

則：

- 原 tail transport 升級為 `tail_promoted_pair`。
- `to_item_id` 設為 B。
- 不新增另一張交通卡。
- 不跳 Restore / Delete。
- 若交通時間不足，只顯示 transportation shortage warning，不算 invalid。

#### 情境 B：B 時間不合理，排到 A 前方

B 設定為：

```text
B 08:00~08:30
```

排序後：

```text
B 08:00~08:30
A 09:00~10:00
tail transport
```

則：

- B 自己依 start_time 排到 A 前面。
- 原 tail transport 保持 `tail_pending`。
- `to_item_id` 保持 null。
- 不形成 `A → B`。
- 不跳 Restore / Delete。
- 不進 invalid stack。

這是 tail_pending 與 normal_pair 最大差異：
normal_pair 被破壞要提示；tail_pending 尚未成 pair，因此不提示。

---

### 7.5 tail_promoted_pair：尾端形成的 pair

#### 畫面

```text
A 09:00~10:00
transport A → B
B 10:30~11:00
```

#### 資料

```text
transport_role = tail_promoted_pair
from_item_id = A
to_item_id = B
```

#### 與 normal_pair 的差異

tail_promoted_pair 看起來像 normal pair，但它是由 tail_pending 升級而來。

因此，當 B 再改回 untimed 時，應退回 tail_pending。

```text
A 09:00~10:00
tail transport warning
B untimed
```

資料變化：

```text
transport_role = tail_pending
from_item_id = A
to_item_id = null
```

規則：

- 不進 invalid stack。
- 不跳 Restore / Delete。
- 不刪除交通卡。
- 不改成 normal_pair。
- 顯示未設定時間 warning。

若 B 仍是 timed，但修改時間後導致 A / B 不再相鄰，tail_promoted_pair 可依 normal_pair 的 timed endpoint 破壞規則處理；但 B 轉 untimed 時必須優先退回 tail_pending。

---

### 7.6 Untimed 與交通卡共通規則

#### timed → untimed

不論是使用者主動改成 untimed，或系統被動 conversion：

- 交通卡預設保留。
- 顯示未設定時間 warning。
- 不自動刪除。
- 不自動 invalid。
- 但若該交通卡是 tail_promoted_pair，且變成 untimed 的是 `to_item_id` endpoint，應退回 tail_pending。

#### untimed 拖曳

若 untimed visit 本身與交通卡有關聯：

- 拖曳前需提示交通卡將被移除或受影響。
- 確認後才移除受影響交通卡並移動。
- 取消則不改 local state、不寫 DB、不刪交通卡。

#### untimed 設定時間

若 untimed visit 設定完整時間：

- 先依 `start_time` 排入 timed sequence。
- 若它剛好可合理接上 tail_pending，則 tail_pending 升級為 tail_promoted_pair。
- 若不合理，tail_pending 保持存在，不形成 pair。
- 若它影響 normal_pair，依 normal_pair 規則處理。

---

### 7.7 不做的事

Phase 4.5b 不做以下事情：

- 不實作 Phase 4.6 timed drag auto-continuation。
- 不實作 Phase 4.7 fixed anchor drag。
- 不做 Google Docs-style collaborative drag。
- 不修改已套用的 migrations 019 / 020 / 021。
- 不為舊測試資料保留複雜 fallback。
- 不讓 tail_pending 自動轉成 normal_pair。
- 不讓 tail_promoted_pair 在 endpoint untimed 時走 normal_pair warning。
- 不把 tail transport 當成 normal A→B pair 判斷。

---

## 8. Phase 4.5c：Mixed Drag Target / Prompt Cleanup

> Phase 4.5c 已完成。
> 本階段修正 timed / untimed 混排拖曳 target、交通卡提示條件，以及 active insertion into transport gap 的一致性。
> 本階段不實作 Phase 4.6 的 timed drag auto-continuation，也不重新計算 timed visit 時間。

### 核心概念

拖曳 target 應依完整 mixed visual list 判斷，而不是只依 timed-only sequence 判斷。

```text
顯示順序 / drop target：看 mixed visual order
時間接續 / duration 計算：Phase 4.6 才做，且只看 complete timed visits
```

### 規則

#### 1. Timed visit 可拖到 untimed 上方或下方

例如：

```text
A timed
B untimed
C timed
```

拖 C 到 A 上方，預期：

```text
C timed
A timed
B untimed
```

不可只交換 timed sequence，卻讓 B untimed 留在原本 gap：

```text
C timed
B untimed
A timed
```

#### 2. Untimed visit 可存在列表頭、中、尾

以下都合法：

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

untimed 不應因 timed count 或 timed gap 改變而自動 compact 或跳位。

#### 3. 只有 actual affected transports 才提示

如果拖曳不會破壞、刪除或改變任何交通卡：

```text
不跳 reorder confirmation
不跳交通卡移除提示
直接完成拖曳
```

如果拖曳會破壞 `normal_pair` 或 `tail_promoted_pair`：

```text
先跳交通卡移除提示
使用者確認後才移動卡片並刪除受影響交通卡
```

#### 4. brokenTransportIds 需由 before / after mixed visual order 計算

`planMixedTimedVisitReorder` 應比較拖曳前後的 mixed visual order，回傳 `brokenTransportIds`。

Timeline drop path 必須把這些 broken transports 併入 reorder confirmation 判斷。

即使 timed-only package order 沒變，只要 untimed slot 變動破壞既有交通 pair，也必須提示。

Regression case：

```text
A timed
transport A → B
B timed
C untimed
D timed
```

拖 B 到 C / D 中間時，必須抓到 `A → B` 失效並顯示提示。

#### 5. Timed / untimed 都可插入交通 pair 中間

不論拖曳的是 timed visit 或 untimed visit，只要插入既有 `normal_pair` / `tail_promoted_pair` 中間，就允許 drop，但必須先提示交通卡會被移除。

確認後：

- 完成拖曳移動。
- 刪除 `plan.brokenTransportIds` 對應的交通卡。
- 不自動新增新交通卡。

取消則完全不改 state / DB。

#### 6. no-op path 不提示

若使用者拖起後放回原位，或 drop 結果沒有實際改變 mixed visual order，也沒有 broken transports：

```text
不提示
不寫 DB
不刪交通卡
```

---

## 9. Untimed visit 與交通卡規則

### 核心概念

未設時間卡可以混在行程內，但交通卡必須先分角色。

```text
normal_pair：已成立的一般 A→B
tail_pending：尾端待配對，不會被 untimed 立刻吃掉
tail_promoted_pair：尾端交通形成的 A→B
```

---

### A. 主動 untimed drag 規則

#### 1. Untimed visit 可插入既有交通 pair 中間，但必須先提示

如果兩張 timed visits 之間已有 `normal_pair` 或已成立的 `tail_promoted_pair`，代表畫面上已有明確的 `A → B` 關係。

原本：

```text
A 09:00~10:00
transport A → B
B 11:00~12:00
C untimed
```

允許使用者主動拖曳成：

```text
A 09:00~10:00
C untimed
B 11:00~12:00
```

但因為 mixed visual order 已破壞 `A → B`，必須先顯示交通卡移除提示。
使用者確認後：

- 移動 untimed visit。
- 刪除 `plan.brokenTransportIds` 對應的受影響交通卡。
- 不新增任何新交通卡。
- 不改變其他 timed visits 的 `start_time / end_time`。

使用者取消時：

- 不改 local state。
- 不寫資料庫。
- 不刪除交通卡。
- 不移動卡片。

#### 2. tail_pending 後方可放 untimed visit

tail_pending 後方放 untimed visit 是合法規劃狀態：

```text
A timed
tail transport warning
B untimed
```

此時：

- 不形成 pair。
- 不失效。
- 不跳 Restore / Delete。
- 不顯示新增尾端交通 hover。
- 不允許再開另一個尾端交通新增表單。
- 交通卡與後方 untimed visit 之間保留正常 visual gap。
- 等 B 設定時間後再判斷是否升級為 tail_promoted_pair。

#### 3. Untimed drag 的交通卡刪除依 brokenTransportIds

主動拖曳 untimed visit 時，不應只檢查「交通卡是否直接連著被拖曳的 untimed 卡」。

正確規則：

```text
先用 before / after mixed visual order 計算 plan.brokenTransportIds。
只要 mixed visual order 會破壞 normal_pair / tail_promoted_pair，
就顯示交通卡移除提示。
確認後刪除 brokenTransportIds。
```

這可涵蓋以下情境：

```text
A timed
transport A → B
B timed
C untimed
D timed
```

把 C 插入 A / B 中間時，C 不是交通 endpoint，但它仍破壞 `A → B`，因此必須提示並刪除 `A → B`。

---

### B. timed → untimed conversion 規則

#### 4. timed 變成 untimed 時交通卡預設保留

不論是使用者主動改成 untimed，或系統被動 conversion：

- 相關交通卡不自動刪除。
- 相關交通卡不自動隱藏。
- 相關交通卡不應掉到列表置頂。
- 顯示未設定時間 warning。
- 使用者後續拖曳或修改 untimed 時，再依規則提示交通卡將移除或受影響。

#### 5. normal_pair endpoint 變成 untimed

```text
A timed
normal_pair A → B
B timed
```

B 變成 untimed 後：

```text
A timed
normal_pair A → B warning
B untimed
```

不退回 tail，不刪除交通卡。

#### 6. tail_promoted_pair endpoint 變成 untimed

```text
A timed
tail_promoted_pair A → B
B timed
```

B 變成 untimed 後：

```text
A timed
tail_pending warning
B untimed
```

資料上應退回：

```text
transport_role = tail_pending
from_item_id = A
to_item_id = null
```

#### 7. tail_pending + untimed

```text
A timed
tail_pending warning
B untimed
```

這是合法狀態，不是 invalid。

---

### C. 交通卡 warning

當交通卡任一有效 endpoint 已 untimed 或 partial time 被正規化為 untimed，交通卡應顯示時間相關 warning。

normal_pair 建議文案：

```text
目的地時間未設定，請重新確認交通卡。
```

tail_pending 建議文案：

```text
下一個行程時間未設定，請重新確認交通卡。
```

---

### D. 真正可視為 invalid 的情境

只有以下情境才應視為交通卡已無法維持基本關聯：

- `from_item_id` 或 `to_item_id` 指向的 visit 已被刪除，且無法依 role 合理退回或重新掛載。
- 使用者明確刪除交通卡。
- timed drag reorder 規則明確判定交通卡不再相鄰且本次操作屬於 timed reorder cleanup。
- 資料中的 `transport_role` 與 `from_item_id / to_item_id` 組合不合法，且無法安全修復。

被動 untimed conversion 本身不應直接觸發交通卡刪除或 invalid。

---

## 10. 交通卡整體規則整理

### normal_pair

- 明確的 A→B 交通。
- endpoint 改成 untimed → 保留 warning。
- endpoint timed 但不再相鄰 → Restore / Delete。
- 不會自動退回 tail_pending。

### tail_pending

- 尾端待配對交通。
- 後方 untimed 不影響它。
- 後方 untimed 設定合理時間 → 升級 tail_promoted_pair。
- 後方 untimed 設定不合理時間 → 保持 tail_pending，不提示、不 invalid。
- 不可自動改成 normal_pair。

### tail_promoted_pair

- 由 tail_pending 升級而來的 A→B。
- timed 狀態下看起來像 pair。
- `to_item_id` endpoint 改成 untimed → 退回 tail_pending。
- timed endpoint 修改導致不再相鄰時，可依已成立 pair 的 Restore / Delete flow 處理。
- 不可自動改成 normal_pair，除非未來另行設計「確認轉為一般交通」。

### timed visit 拖曳

- 原本交通卡兩端仍同方向相鄰 → 保留
- 原本交通卡兩端不再相鄰 → 依 role 決定移除、退回 tail 或提示
- 新形成相鄰關係 → 不自動新增 normal_pair
- tail_pending 只有在候選 untimed 設定合理時間後才會升級

### 主動 untimed visit 拖曳

- 只改 untimed visit 的位置
- 不新增交通卡
- 不影響 timed visits 時間
- 可插入已有 normal_pair / tail_promoted_pair 的中間
- 若 mixed visual order 會破壞交通卡，拖曳前需提示並依確認結果移除 `plan.brokenTransportIds` 對應的受影響交通卡
- 交通卡是否受影響不要求它直接連著被拖曳的 untimed 卡

### timed visit 轉成 untimed

- 交通卡預設保留並 warning
- normal_pair 保留 pair warning
- tail_promoted_pair 退回 tail_pending warning
- tail_pending 保持 tail_pending warning
- 不因 untimed 本身進 invalid stack

### partial time

若一張 visit 只有 `start_time` 或只有 `end_time`：

- 判定為 untimed
- 儲存時建議同步清除另一個時間欄位
- 不參與 timed ordering
- 不作為有效 transport shortage 計算端點
- 若已有相關交通卡，依 role 套用上述規則並 warning

### untimed slot / rebase

- untimed slot 計算只看同一天 `dayItems`
- timed → untimed 時，可以 rebase 當日既有 untimed visits，避免舊 slot 被錯誤解讀
- rebase 的目的不是 compact，而是保護原位置
- untimed → timed 時，不可自動 compact 其他 untimed visits
- staged restore 過程中，若存在已成立交通 pair，必須保留 from 在 to 前方的相對方向；tail_pending 則不形成 pair，直到時間合理
- 恢復時間後若交通時間不足，只顯示 transportation shortage warning，不應變成 invalid transport

### fixed / untimed normalization

- 只有 complete timed visit 可以 fixed。
- untimed / partial time visit 不顯示固定按鈕，也不可執行 toggle fixed。
- 若 non-complete timed visit 的 payload 出現 `is_fixed / fixed_at / fixed_by`，normalize 時應清除。
- legacy fixed untimed 不可阻擋 drag / rebase / auto-continuation。
- Phase 4.7 fixed anchor 僅能由 complete timed + is_fixed 的 visit 形成。
- UI 不應直接顯示 `untimed_sort_order_stale` 或其他內部錯誤碼。

---
## 11. Phase 4.8：Collaborative Drag Presence

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

## 12. 建議實作順序

### Phase 4.4

修改時間後，局部自動接續時間。

範圍：

- 只處理編輯 start_time / end_time 後的後續 timed visits
- 不處理 drag reorder
- 不處理 untimed mixed sorting
- 不處理 fixed anchor 跨區拖曳
- 若編輯後的新時間會跨越 fixed timed visit，「接續」不可使用
- 但「儲存」仍可使用，只要不違反 invalid time / overlap validation

### Phase 4.5

未設定時間景點排序規則。

範圍：

- untimed visit 可以混在行程內
- untimed visit 拖曳只改位置
- untimed visit 不影響 timed auto-continuation
- untimed visit 可以插入已有交通卡的 pair 中間，但必須先提示並確認刪除受影響交通卡

### Phase 4.5b

Transportation Role Model。

範圍：

- 新增 `transport_role`
- 分清楚 `normal_pair` / `tail_pending` / `tail_promoted_pair`
- 允許新增 022+ migration
- 既有測試資料可清理或重建
- Demo mock data 同步更新
- normal pair 與 tail transport 套用不同 untimed 規則
- 不進入 Phase 4.6 / 4.7

### Phase 4.5c

Mixed Drag Target / Prompt Cleanup。

範圍：

- timed / untimed drop target 都看完整 mixed visual list。
- untimed 可以在列表頭、中、尾。
- timed visit 可以拖到 untimed 上方或下方。
- no-transport / no-op path 不跳提示。
- 會破壞 normal_pair / tail_promoted_pair 的 path 仍跳交通卡移除提示。
- `planMixedTimedVisitReorder` 比較 before / after mixed visual order 並回傳 `brokenTransportIds`。
- timed / untimed 都可以插入既有交通 pair 中間，但確認後刪除受影響交通卡。
- 不把 4.6 timed drag auto-continuation 混進 4.5c。

### Phase 4.6

拖曳 timed visit 後，自動調整時間。已完成。

完成範圍：

- 無固定卡或不涉及固定卡的基本 timed drag auto-continuation
- 只處理 complete timed visits（start_time / end_time 都存在）
- 每張卡保留自己的原本 duration
- 原本仍同方向相鄰保留 gap
- 新相鄰 / 方向反轉直接接續
- 交通卡保留 / 移除 / 不新增
- Formal 端已使用 transaction RPC `023_reorder_itinerary_timed_auto_continuation.sql`
- fixed / untimed normalization 已完成：只有 complete timed visit 可 fixed

### Phase 4.7

固定卡作為時間錨點的拖曳規則，採延續區段版 fixed anchor drag。

前提：

- 只有 complete timed visit + is_fixed 才是 fixed anchor。
- untimed / partial time 不可 fixed，也不可作為 anchor。
- fixed anchor 可以被讀取為時間邊界，但不可被拖曳、rebase 或 auto-continuation 更新。

範圍：

- 固定卡本身不可拖曳，資料與時間不動。
- 其他非固定 timed visit 可以跨固定卡。
- fixed anchor 將同一天切成多個可調整區段。
- 拖曳跨 fixed anchor 後，只重算受影響 fixed 區段內的非固定 complete timed visits。
- 區段內沿用 Phase 4.6：保留 duration、同方向相鄰保留 gap、新相鄰 / 方向反轉直接接續。
- 若區段重算後能在下一個 fixed anchor 前完成，保留 timed。
- 若區段重算後撞到下一個 fixed anchor，從第一張塞不下的非固定 timed visit 開始，該張與後續同區段非固定 timed visits 轉 untimed，並保留 mixed visual position。
- 兩張 fixed anchors 中間完全沒有空白時間時，不可插入 timed visit。
- 不採保守插入版，不只檢查目標前後兩張卡，也不只把 moved card 轉 untimed。

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

## 13. 待確認事項

以下細節後續仍可再討論：

1. 固定卡拖曳錨點邏輯已明確拆到 Phase 4.7，且 Phase 4.7 已決定採延續區段版 fixed anchor drag；Phase 4.6 已只完成基本 timed drag auto-continuation。
2. 被動 untimed conversion 後，交通卡 warning 的最終 UI 樣式與文案。
3. untimed visit 混在行程中時，視覺上是否需要特別標示「未設定時間」。
4. timed visit 轉 untimed 後，是否需要顯示一次性提示或在卡片上保留 warning。
5. fixed card 前後若存在 transportation card，跨固定卡拖曳時仍沿用 brokenTransportIds confirmation / cleanup；是否需要更嚴格保護可於 Phase 4.7 QA 後再評估。
6. Phase 4.6 已新增並套用 RPC migration 023；Phase 4.7 可能需要新增 RPC / migration 以支援 fixed-aware segment recalculation，待實作前確認。
7. Collaborative Drag Presence 的技術實作要使用 Supabase Realtime presence、獨立 presence table，或既有 Realtime channel metadata，待實作前確認。
8. presence timeout / tab close / drag cancel 後的清除策略，待實作前確認。
9. Phase 4.5 untimed slot rebase 是否需要長期改成更明確的 order model，而不是只使用負值 sort_order 編碼，待 Phase 4.5 stabilization 後評估。
10. Tail transport 在 endpoint 恢復 timed 後的有效性判斷，後續是否需要更明確的 helper 測試或 RPC 層保護。
11. Fixed card 與「接續」disabled 規則目前只限制自動接續，不限制單純儲存；若未來儲存也造成過多混亂，再評估是否加入提示。
12. fixed / untimed 規則已收斂：untimed 不可 fixed；legacy fixed untimed 視為髒資料並於 normalize 清除 fixed 狀態。

---

## 14. 一句話總結

```text
Phase 4 後續應拆開處理：
4.4 先做修改時間後局部接續，且跨 fixed timed visit 時禁用接續但允許合法儲存；
4.5 定義未設時間卡可混排行程但不影響時間，並完成 stabilization；
4.5b 建立 Transportation Role Model，正式分清 normal_pair / tail_pending / tail_promoted_pair，讓一般交通與尾端交通套用不同 untimed 規則；
4.5c 完成 mixed visual drag target 與 prompt cleanup：timed / untimed 都可依完整 mixed visual list 拖曳，只有 brokenTransportIds 存在時才提示；timed / untimed 都可插入既有 normal_pair / tail_promoted_pair 中間，但確認後會刪除受影響交通卡；
4.6 已完成 complete timed visit 拖曳後自動調整時間，重點是保留每張卡自己的原本停留時長，不可交換時間 slot；partial time / start-only / end-only 均不可參與 duration-based continuation；Formal 端已使用 transaction RPC 023；
4.6 Hotfix 已收斂 fixed / untimed 規則：只有 complete timed visit 可以 fixed；untimed / partial time 不可 fixed，legacy fixed untimed 會 normalize 清除 fixed 狀態，且不可阻擋 drag / rebase / auto-continuation；
4.7 處理固定卡作為時間錨點，固定錨點只限 complete timed + is_fixed，並採延續區段版：fixed anchor 將 day 切成可調整區段，拖曳跨 fixed anchor 後重算受影響區段內非固定 complete timed visits；若撞到下一個 fixed anchor，從第一張塞不下的非固定 timed visit 開始，該張與後續同區段非固定 timed visits 轉未設定時間；
4.8 加入 Collaborative Drag Presence，讓多人協作時可看到拖曳中狀態並暫時禁止同日多人同時拖曳；
4.9 再進 Map 整合前置設計；
4.10 最後做 QA 與交接。
```
