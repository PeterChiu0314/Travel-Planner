# Timeline Phase 4 拖曳重排 / 多人協作 / Map 前置整合規則草稿 v14

Date: 2026-07-01
Status: Updated after Phase 4.8f Remote Drag Visual Polish + Phase 4.9a Map Marker Contract

> 本文件以 v13 為底更新 Phase 4.8 後半與 Phase 4.9 前置規則。
> Phase 4.8a～4.8f 已完成：dnd-kit local drag preview、Demo Timeline parity、Collaborative Drag Presence、remote selection、online member presence、remote drag visual polish。
> Phase 4.9 已開始 Map Integration Prep，並完成 4.9a Map Marker Contract：新增 provider-neutral `buildDayMapMarkers(dayItems, options?)` helper，讓 RoutePanel / 未來 MapPanel 可使用中立 marker contract。
> 目前產品方向是 Google Maps first，但必須保留 provider-switchable architecture；Timeline / RoutePanel / data helper 不可直接綁死 Google Maps SDK。
> Phase 4.9 前期仍不接 Google SDK、不新增 API key、不新增 migration、不做 route calculation；Map work 不可影響 Phase 4 已穩定的 reorder / drag / presence / transport role / fixed anchor / untimed 規則。
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
Phase 4.5c：Mixed Drag Target / Prompt Cleanup（mixed visual order、brokenTransportIds、timed / untimed 插入交通 pair 可確認刪除）
Phase 4.6：Timed Visit Drag Auto-Continuation（duration-preserving time recalculation、Formal transaction RPC 023、Demo/Formal parity）
Phase 4.6 Hotfix：fixed / untimed 規則收斂（untimed 不可 fixed；legacy fixed untimed normalize 清除 fixed 狀態）
Phase 4.7：Fixed Anchor Drag Continuation Segments（Formal transaction RPC 024、Demo/Formal parity）
Phase 4.7a：fixed-adjacent gap no-op misclassification 修正
Phase 4.7b：fixed overflow untimed conversion preserves mixed visual order 修正
Phase 4.8a：dnd-kit Local Sortable Drag Preview（local-only UI preview、No Migration）
Phase 4.8b：Demo Timeline Data Parity / Transport Edge Cases
Phase 4.8c：Collaborative Drag Presence（Supabase Presence + Broadcast）
Phase 4.8c2：Same-day readonly lock + Realtime channel lifecycle recovery
Phase 4.8d：Remote Timeline Card Selection（destination / transport selection border）
Phase 4.8e：Online Member Presence / Jump to Member Location
Phase 4.8f：Remote Drag Visual Polish（remote source highlight + stronger insertion line）
Phase 4.9 Prep：Map Integration Prep / Read-only audit and implementation plan
Phase 4.9a：Map Marker Contract / buildDayMapMarkers
```

後續建議拆分：

```text
Phase 4.9b：Map Focus Surface
Phase 4.9c：Google Map Provider Prep
Phase 4.10：QA / closeout / merge prep
```

拆分原因：

- Phase 4.4～4.7 已穩定處理拖曳、自動時間、固定卡、未設時間卡、交通卡限制與 transaction RPC。
- Phase 4.8 已完成 dnd-kit local preview、Demo parity、collaborative drag presence、remote selection、online member presence 與 remote drag polish。
- Phase 4.8 的所有 remote/collaboration 功能都只做 UI presence / awareness，不取代正式 RPC validation。
- Phase 4.9 開始處理 Map 整合前置，但必須與 Timeline reorder / drag / fixed / untimed / transport role 完全解耦。
- 使用者決策：未來地圖整合以 Google Maps 為第一優先，但架構必須保留 provider-switchable 彈性，避免之後免費額度不足時難以改接其他 provider。
- 4.9a 已先建立 provider-neutral marker contract；4.9b 再整理 focus surface；4.9c 再設計 Google Map Provider / lazy load / API key / quota / route cache 策略。
- Google Maps SDK 之後必須 lazy load，不可進 initial/main bundle。
- Phase 4.10 再做 QA、文件 closeout、merge prep。

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

### local drag preview

拖曳中的本機視覺預覽。

規則：

- 只存在於目前使用者的瀏覽器畫面。
- 不代表正式資料已更新。
- 不寫入 `itinerary_items`。
- 不呼叫 reorder RPC。
- 不更新 `start_time / end_time`。
- 不刪除或新增 transportation cards。
- 不轉 untimed。
- drop 後才交給既有 Phase 4.7 reorder flow 判斷正式結果。

### dnd-kit sortable preview

Phase 4.8a 導入的本機拖曳 UI 層。

使用概念：

- `DndContext`
- `SortableContext`
- `useSortable`
- `verticalListSortingStrategy`
- `DragOverlay`

此層只負責：

- 浮起中的拖曳卡片 overlay。
- source placeholder。
- 列表滑動讓位。
- 本機 preview order。

此層不負責：

- 正式資料排序。
- fixed anchor 時間重算。
- untimed overflow conversion。
- transportation cleanup。
- Supabase migration / RPC。

### transportation visual attachment

Phase 4.8a 的拖曳視覺設計。

交通卡不加入 `SortableContext.items`，沒有 sortable id，也不可拖曳。

但為了讓拖曳 preview 時交通卡不要卡在原位，交通卡可以作為前一張 destination sortable wrapper 的 visual attachment：

```text
SortableEntry(A)
  Visit A
  Transport A → B visual attachment

SortableEntry(B)
  Visit B
```

因此 wrapper 受到 dnd-kit transform 時，交通卡會跟著前一張 destination 的 visual group 一起移動。

注意：

- 這只是 UI attachment，不改交通卡正式資料。
- 交通卡仍可點擊 / 編輯。
- 交通卡本身不啟動拖曳。
- drop 後交通卡是否保留 / 提示 / 刪除，仍由既有 `brokenTransportIds` 與 Phase 4.7 正式 flow 判斷。

### Demo parity

Demo 應作為 Formal 的本地模擬版，而不是另一套簡化規則。

Demo 可以不接：

- Supabase
- Auth
- Realtime
- Draft Autosave
- Edit Lock

但 Demo 應盡量對齊 Formal：

- mock data shape
- `transport_role`
- `from_item_id / to_item_id`
- Timeline render flow
- dnd-kit local preview behavior
- pure planner / local state 模擬 RPC 成功後結果

原因：

```text
使用者本機 run dev 主要依賴 /demo/timeline 測試 UI，
因此 Demo 行為若與 Formal 差異過大，會導致拖曳與交通卡 QA 誤判。
```

---

### map marker contract

Phase 4.9a 開始建立的 Map 資料合約。

它代表：

```text
Timeline active day items → provider-neutral map marker records
```

規則：

- 只從 destination / visit 產生 marker。
- transportation card 不產生 marker。
- marker contract 不依賴 React、DOM、Google Maps SDK 或任何外部 API。
- 缺少 `latitude / longitude` 時不可 throw，應以 `hasCoordinates = false` fallback。
- marker order 應跟 active day visual/input order 一致，不自行重排。
- marker contract 可以支援未來 Google Maps，但欄位命名不可綁死 Google。

### buildDayMapMarkers

Phase 4.9a 新增的純 helper：

```text
buildDayMapMarkers(dayItems, options?)
```

用途：

- 將 active day destination items 轉成 RoutePanel / future MapPanel 可使用的 marker records。
- 排除 transportation cards。
- 支援 Formal / Demo item shape。
- 轉換有效 `latitude / longitude` 為 number。
- 對缺失或無效座標做安全 fallback。
- 不 mutate input items。

### provider-neutral marker

Map marker contract 應使用中立欄位，例如：

```text
provider
providerPlaceId
latitude
longitude
hasCoordinates
coordinateSource
```

目前 `provider / providerPlaceId` 可為 `null`。
未來若接 Google Maps，可使用：

```text
provider = "google"
providerPlaceId = Google Place ID
```

若未來改用其他 provider，也能改成：

```text
provider = "osm" / "maptiler" / "stadia" / other
providerPlaceId = provider-specific place id
```

不要在 Timeline core 或 marker helper 中直接使用：

```text
google.maps.Marker
google.maps.LatLng
google_place_id 作為唯一概念
```

### Map Focus Surface

Phase 4.9b 的目標。

Map Focus Surface 指現有 `RoutePanel` / future `MapPanel` 與 Timeline 之間的 focus 關係：

```text
Timeline destination card click → focusedItemId → RoutePanel stop / future marker focus
RoutePanel stop / future marker click → focusedItemId → Timeline card focus
Transport card focus → identify from/to destination stops if available
```

規則：

- `focusedItemId` 仍是 local UI state。
- 不寫 DB。
- 不改排序。
- 不觸發 reorder RPC。
- 不影響 dnd-kit drag preview。
- 不影響 remote selection / presence / readonly lock。

### Google-first provider-switchable architecture

使用者目前決策：

```text
Google Maps first, provider-switchable architecture.
```

意思是：

- 未來真地圖優先考慮 Google Maps。
- 但 Google Maps SDK 必須被隔離在 provider component / adapter 中。
- Timeline / RoutePanel / marker helper 不應直接依賴 Google SDK。
- 若未來 Google Maps 免費額度不足或成本過高，應能較低風險切換到 Leaflet / MapLibre / MapTiler / Stadia 等方案。
- Google Maps SDK 必須 lazy load，不可進 initial/main bundle。


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
不再相鄰的交通卡依 `brokenTransportIds` confirmation / cleanup 移除；
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

如果交通卡兩端的目的地移動後不再相鄰，需依 `brokenTransportIds` confirmation / cleanup 處理。

```text
原本：A → B
移動後：B C A D
A 和 B 不相鄰
所以 A → B 需納入 brokenTransportIds
使用者確認後才移除
取消則不移動、不刪交通卡
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
- 4.2c 曾採 fixed timed visit 禁止當天 reorder；Phase 4.7 已改為 fixed-aware segment validation
- active foreign lock 會禁止 reorder
- active Timeline editor 會阻止 drag
- stale baseline / wrong manifest 會 rollback
- 失效交通卡會依規則刪除
- 成功後 reload authoritative trip data

---

### Phase 4.6 / 4.7 已延續並加強的保護

因為 4.6 / 4.7 會自動調整多張時間，正式版不使用前端多次 update 完成。

目前已完成：

```text
Phase 4.6：transaction RPC 023，一次完成 reorder + time recalculation + transport cleanup
Phase 4.7：transaction RPC 024，一次完成 fixed-aware reorder + segment recalculation + overflow untimed conversion + transport cleanup
```

後續若再修正式資料流程，應新增 migration 025+，不可修改已套用的 019～024。

RPC 應持續驗證：

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

## 5. Phase 4.7：固定行程卡作為時間錨點的拖曳規則（延續區段版，已完成）

> Phase 4.7 已完成。
> 它取代了 4.2c「當天有 fixed timed visit 就禁止整日拖曳」的保守規則。
> Phase 4.7 採「延續區段版 fixed anchor drag」，不要採「只看目標前後兩張卡的保守插入版」。
> Phase 4.7 正式流程使用 migration / RPC 024；後續不可原地修改已套用的 024，若需修正請新增 025+。

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

### Phase 4.7a / 4.7b Hotfix 摘要

#### Phase 4.7a：fixed-adjacent gap no-op misclassification

問題：

```text
fixed-adjacent drop 有時只改變完整 timed visual order，
但 non-fixed package permutation 看起來沒變，
因此被 early no-op 判斷擋掉，planner / RPC 沒有執行。
```

修正：

- no-op 判斷必須同時看 non-fixed package order 與完整 `orderedTimedItemIds`。
- fixed-adjacent gap 只要 visual timed order 有實際改變，就不應被視為 no-op。
- fixed-adjacent gap 仍應進入 Phase 4.7 planner / RPC，由正式規則判斷是否可放入、轉 untimed 或拒絕。

#### Phase 4.7b：overflow untimed conversion preserves mixed visual order

問題：

```text
fixed segment overflow 轉 untimed 後，
不能只替「被轉成 untimed 的 timed visits」重算 sort_order，
否則既有 untimed 可能因 timed gap 改變被舊 slot 解讀到 fixed anchor 下方或原本 source 位置。
```

修正：

- after-drop mixed visual order 是 overflow conversion 後的 visual source of truth。
- overflow conversion 後，既有 untimed visits 也要依 final mixed visual order 一起 rebase。
- rebase 只能保護位置，不可 compact。
- Formal RPC 與 Demo pure planner 必須使用同一份 final untimed rebase payload。
- 時間不足時不應直接回 `invalid_timing_change`；應先走 fixed segment overflow conversion，從第一張塞不下的 timed visit 開始轉 untimed。

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

### 7.4.1 tail_pending + untimed + 新增 timed visit 的 narrow bypass 例外

> Phase 4.8b QA 補充。
> 此規則只處理「尾端待配對交通卡後方已有 untimed visit，但使用者新增一張 timed visit 並合理接上 tail_pending」的邊界情境。
> 它是非常窄的例外，不可擴大成一般 untimed 自動位移規則。

#### 核心原則

Phase 4.5 的 untimed 原則仍然成立：

```text
untimed visit 預設不參與時間接續。
untimed visit 不因 timed 新增 / 恢復 / 拖曳而自動 compact。
untimed visit 不應「隨波逐流」被一般 timed 變動推動。
```

唯一例外是：

```text
tail_pending 在本次新增 timed visit 時升級為 tail_promoted_pair，
且某些 untimed visits 正好位於 tail_pending 與 promoted target 之間、會阻擋新 pair 顯示。
```

這些 blocking untimed visits 才能被最小幅度 rebase 到 promoted target 後方。

#### 問題情境

原本：

```text
A timed
tail_pending transport
B untimed
```

此時使用者按「新增行程」，系統可能依 tail transport 預設帶入：

```text
C.start_time = A.end_time + tail_pending duration
```

若 C 儲存後是合理接在 A 後方的 complete timed visit，使用者意圖可解讀為：

```text
我要把 C 接在 A 的尾端交通後方，形成下一個 timed destination。
```

正確結果：

```text
A timed
transport A → C
C timed
B untimed
```

資料應更新為：

```text
transport_role = tail_promoted_pair
from_item_id = A.id
to_item_id = C.id
```

B untimed 被移到 C 後方，不是因為一般 untimed 可以被 timed 新增推動，而是因為：

```text
B 位於 tail_pending 與本次 promoted target C 之間，
若不 rebase 會阻擋 A → C pair 的正式視覺掛載。
```

#### 觸發條件

此 narrow bypass 必須同時符合以下條件才可套用：

1. 交通卡角色是 `tail_pending`。
2. `tail_pending.from_item_id = A`。
3. 使用者本次新增一張 complete timed visit `C`。
4. `C` 的時間合理接在 `A` 後方，例如由 `A.end_time + tail_pending duration` 自動帶入，或排序後可合理成為 A 的下一個 timed target。
5. 本次操作會讓 `tail_pending` 升級成 `tail_promoted_pair A → C`。
6. 有 untimed visit 位於 `tail_pending` 與 `C` 之間，且會阻擋 `A → C` pair 顯示。
7. rebase 範圍只限這些 blocking untimed visits。

#### 不允許套用的情境

以下情境不可套用此 bypass：

```text
A timed
B untimed
C timed
```

若沒有 tail_pending，B 不可因新增 / 拖曳 / 恢復 C 而自動移動。

```text
A timed
normal_pair transport A → C
B untimed
C timed
```

normal_pair 中間有 untimed，應依 `brokenTransportIds` / Restore / Delete 等既有規則處理，不可自動把 B 推走。

```text
A timed
tail_promoted_pair transport A → C
B untimed
C timed
```

已經是 tail_promoted_pair，不是「本次 tail_pending promoted」的瞬間，不可套用 bypass。

```text
A timed
tail_pending transport
B untimed
C timed，但 C 排到 A 前方或時間不合理
```

C 不合理時，tail_pending 保持 tail_pending，B 不動，不 invalid。

#### 實作限制

- 不可推動 unrelated untimed visits。
- 不可 compact untimed list。
- 不可讓 normal_pair / tail_promoted_pair 使用此 bypass。
- 不可把一般新增 timed visit 造成的 untimed 位移當成規則。
- 不可因 blocking untimed 的存在，把 tail_pending 判定為 invalid。
- 若 tail_pending 無法合理 promoted，維持 tail_pending warning 狀態。

#### Regression 建議

至少覆蓋：

1. `A timed / tail_pending / B untimed` 後新增合理 timed C，結果為 `A / transport A→C / C / B untimed`。
2. 其他 unrelated untimed 的相對位置不變。
3. normal_pair 中間的 untimed 不套用 bypass，仍走交通卡破壞確認。
4. C 時間不合理時，tail_pending 不升級，B 不動，不 invalid。

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

#### 新增 timed visit 接上 tail_pending

若 tail_pending 後方已有 untimed visit，但使用者新增一張 complete timed visit，且該新增 visit 合理接在 tail_pending 的 `from_item_id` 後方，則可依 7.4.1 的 narrow bypass 將 tail_pending 升級為 tail_promoted_pair。

此時只允許 rebase 位於 tail_pending 與 promoted target 之間、會阻擋新 pair 的 blocking untimed visits；其他 untimed 不可被推動或 compact。

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
- 新增 timed visit 若合理接在 tail_pending 的 from visit 後方，可升級 tail_promoted_pair，但只能套用 7.4.1 的 narrow bypass，將 blocking untimed 最小 rebase 到 promoted target 後方。
- 不可推動 unrelated untimed，不可 compact untimed list。
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
## 11. Phase 4.8：Sortable Drag Preview / Demo Parity / Collaborative Presence / Remote Awareness

> Phase 4.8 已完成 4.8a～4.8f。
> 本階段只處理 Timeline drag UX、Demo parity 與多人協作 awareness / presence UI。
> 它不改正式 reorder RPC，不改 migration，不同步 remote DragOverlay，不做 remote ghost card，也不做 Google Docs-style drag merge。

---

### 11.1 Phase 4.8a：dnd-kit Local Sortable Drag Preview（已完成）

#### 核心概念

拖曳中的 UI preview 只屬於本機視覺狀態，不代表正式資料更新。

```text
local drag preview ≠ official reorder result
```

正式資料仍以 drop 後的既有 Phase 4.7 reorder flow / RPC / Demo planner 結果為準。

#### dnd-kit 使用範圍

Phase 4.8a 使用 dnd-kit 做本機拖曳互動：

- `@dnd-kit/core`
- `@dnd-kit/sortable`
- `@dnd-kit/utilities`
- `DndContext`
- `SortableContext`
- `useSortable`
- `verticalListSortingStrategy`
- `DragOverlay`

此層只負責：

- 被拖曳卡片的 floating overlay。
- 原列表中的 source placeholder。
- 其他 destination cards 的滑動讓位。
- 本機 preview order。
- overlay 垂直移動限制在 active day board 內。
- drag activation 限制在 destination card 左側 time block。

此層不負責：

- 正式資料排序。
- fixed anchor continuation。
- untimed overflow conversion。
- transportation cleanup。
- Supabase migration / RPC。

#### Sortable items

`SortableContext.items` 只包含 destination visit ids。

不加入：

- transportation cards
- invalid/warning transport stack
- add-transport affordance
- section separators

原因：

```text
正式可拖曳的單位仍然是 destination visit / destination package，
交通卡只是依 role / pair 顯示的附屬資料，不是排序主體。
```

#### Transportation visual attachment

交通卡不成為 sortable item，但在 local drag preview 中不可固定在原 timeline position。

Phase 4.8a 採用：

```text
transportation card = previous destination sortable wrapper 的 visual attachment
```

範例：

```text
SortableEntry(A)
  Visit A
  Transport A → B visual attachment

SortableEntry(B)
  Visit B
```

效果：

- wrapper 被 dnd-kit transform 時，交通卡跟著前一張 destination visual group 移動。
- 交通卡不會在拖曳 preview 中卡在原位。
- 交通卡本身不可拖曳，也不加入正式排序。
- 交通卡仍可點擊 / 編輯。
- 需阻止交通卡 pointer / key event 冒泡啟動拖曳。

注意：

```text
這只是視覺 attachment。
drop 後交通卡是否提示、保留、移除或 warning，仍回到既有 Phase 4.7 / brokenTransportIds 正式規則。
```

---

### 11.2 Phase 4.8b：Demo Timeline Data Parity / Transport Edge Cases（已完成）

#### 核心概念

Demo 應是 Formal 的本地模擬版，而不是另一套簡化規則。

Demo 可以不接：

- Supabase
- Auth
- Realtime
- Draft Autosave
- Edit Lock
- Storage

但 Demo 應盡量對齊 Formal：

- mock data shape
- `transport_role`
- `from_item_id / to_item_id`
- timed / untimed classification
- fixed anchor interpretation
- transportation warning / pair render flow
- dnd-kit local preview render path
- pure planner / local state 模擬 RPC 成功後的結果

#### 已完成重點

- Demo mock transportation 補齊 Formal 欄位與 transport role shape。
- Demo newly added transportation cards 補 `trip_id` 與 pair-adjacent `sort_order`。
- Demo local state 更接近 Formal RPC success 後結果。
- Formal / Demo 共用 tail-pending promotion bypass helper。
- 補 tail_pending + untimed + 新增 timed visit 的 narrow bypass：只有 tail_pending 在本次新增 timed visit 時升級為 tail_promoted_pair，且 blocking untimed 位於 tail_pending 與 promoted target 中間時，才允許最小 rebase 到 promoted target 後方。
- normal_pair、既有 tail_promoted_pair、unrelated untimed、不合理時間、沒有 tail_pending 的情境不可套用 bypass。

#### 不做的事

- 不接 Demo Supabase / Auth / Realtime。
- 不改 migration。
- 不改 reorder RPC。
- 不改 Phase 4.7 fixed anchor planner。
- 不改 brokenTransportIds flow。

---

### 11.3 Phase 4.8c / 4.8c2：Collaborative Drag Presence + Same-day Readonly Lock（已完成）

#### 核心概念

當某位成員正在拖曳某一天的 Timeline destination card 時，其他成員可以看到拖曳狀態，但不能同時修改該日資料。

這只是拖曳中的暫時視覺狀態：

```text
拖曳中 presence ≠ 正式資料更新
正式結果 = 拖曳者放開後確認 + reorder RPC 成功
```

#### 技術設計

- Authenticated Formal-only。
- Day-scoped channel：`timeline-drag:{tripId}:{dayIndex}`。
- Supabase Realtime Presence：低頻 soft lock / who is dragging。
- Supabase Realtime Broadcast：drag update / heartbeat / insertion target / clear。
- Broadcast events：
  - `timeline-drag-update`
  - `timeline-drag-clear`

#### 同日保守鎖定

若偵測到 foreign same-day drag：

- 本機該日 destination drag disabled。
- 該日資料變更暫時 readonly。
- 禁止 add/edit/delete itinerary items。
- 禁止 add/edit/delete transportation cards。
- 禁止 transportation warning confirmation。
- 禁止 alternative add/edit/delete/swap。
- 禁止 fixed toggle。
- 禁止 auto-continuation save。
- 禁止 reorder confirmation save。

仍允許：

- expand / collapse。
- 查看內容。
- 切 Day。
- 切頁面 / section。

若 foreign drag 發生時 editor 已開啟：

- editor 保留內容。
- save / continuation actions disabled。
- 使用 guard 文案：`此日行程正在被其他成員調整，請稍後再儲存。`

#### 防卡死與 channel recovery

- Drag heartbeat 走 Broadcast，不持續 Presence track。
- foreign drag 超過 stale timeout 後自動清除。
- drag cancel / invalid / success / fail / unmount / day switch / trip switch / logout 都 cleanup。
- 發現 channel `CLOSED / TIMED_OUT / CHANNEL_ERROR` 時，清除 stale channel ref、重建 channel，並在 subscribed 後 replay latest local drag payload。
- `removeChannel(channel)` 只用於 active trip/day/user cleanup、component unmount 或 channel replacement。
- Debug logs 使用 `?debugPresence=1` 才顯示。

#### 不做的事

- 不同步 remote DragOverlay。
- 不同步 remote preview order。
- 不做 remote ghost card。
- 不讓其他使用者列表跟著重排。
- 不取代 RPC validation。
- Demo 不接 Presence / Broadcast。

---

### 11.4 Phase 4.8d：Remote Timeline Card Selection（已完成）

#### 核心概念

多人協作中，其他使用者選到某張 Timeline card 時，本機可以看到 low-key selection awareness。

這是 visual-only：

- 不寫 DB。
- 不阻擋操作。
- 不改 reorder。
- 不改 edit lock。
- 不改 drag lock。

#### 行為

- 支援 destination card selection。
- 支援 transport card selection。
- Broadcast payload 包含：`itemType: "destination" | "transport"`。
- Remote selected card 顯示 colored border / ring。
- hover / focus 時顯示 userName label，位於 card lower-right。
- Local user 不額外顯示 local selection border。
- 多個 remote users 選同卡時，第一版顯示最近 foreign selection。
- selection 30 秒 stale。
- selection 會在 Timeline blank click、Day switch、Timeline unmount、logout / trip change、local drag start 時清除。

#### foreign 判斷

使用 `sessionId` 判斷 foreign，而不只看 `userId`。

原因：

```text
同帳號多分頁測試時，另一個 tab 仍應被視為 foreign awareness source。
```

#### 優先權

foreign drag 狀態優先於 remote selection border。

若同一張卡同時 remote selected 且被 foreign user 正在拖曳：

```text
顯示 foreign drag source highlight，不顯示 remote selection border。
```

---

### 11.5 Phase 4.8e：Online Member Presence / Jump to Member Location（已完成）

#### 核心概念

Trip-level online presence 用於顯示成員目前是否在線、在哪個 page / Timeline Day，並支援點 avatar 跳到對方位置。

這是 navigation / awareness UI，不是 lock state。

#### 技術設計

Trip-level channel：

```text
trip-presence:{tripId}
```

Payload：

```js
{
  tripId,
  userId,
  userName,
  sessionId,
  colorKey,
  pageKey,
  dayIndex,
  selectedItemId,
  selectedItemType,
  selectedItemTitle,
  updatedAt
}
```

Track timing：

- subscribe
- supported page switch
- Timeline Day switch
- Timeline card selection
- heartbeat
- focus / visibility recovery
- online recovery

Timing：

- heartbeat：28 seconds
- stale：55 seconds

#### UI

- Header member avatar online border：single 2px non-green color border。
- Day Tab presence border：single 2px non-green color border。
- Inactive Day Board presence dots：top-right 顯示最多 3 個 foreign user color dots。
- Active Day Board 不顯示 dots，因為 active board 已由 main Timeline 呈現。
- 點 remote online avatar：跳到該成員目前 page；若在 Timeline，跳到對方 dayIndex。
- Own avatar 不跳轉，保留 local style。

Supported pageKey mapping：

- `overview -> today`
- `timeline`
- `budget`
- `accommodation`
- `packing -> luggage`
- `settlement`
- `settings`
- `todo`

#### Channel recovery

若 trip-level channel 進入 `CLOSED / TIMED_OUT / CHANNEL_ERROR`：

- 清除 channel ref。
- ready false。
- request reconnect。
- subscribed 後 replay latest payload。
- focus / visibilitychange visible / online 會 recover and track latest location。

#### 不做的事

- 不啟用 readonly lock。
- 不改 edit lock。
- 不改 drag lock。
- 不寫 DB。
- 不改 reorder。
- Demo 不接 trip-level presence。

---

### 11.6 Phase 4.8f：Remote Drag Visual Polish（已完成）

#### 核心概念

強化 foreign drag presence UI，但不做完整 remote ghost placeholder。

目標：讓其他使用者更清楚知道：

```text
誰正在拖曳哪張卡片
目前插入位置在哪裡
```

#### Source card highlight

當 A 正在拖曳某張 destination card 時，B 端該卡片仍留在原位。

B 端依 foreign drag payload 找到原列表中的 destination card，套用：

```text
timeline-item-remote-drag-source
```

視覺：

- 使用遠端拖曳者顏色 border。
- soft shadow。
- `opacity: 0.56`。
- 不移除 source card。
- 不改列表順序。
- 不做 remote layout shift。
- 不同步 DragOverlay。

#### Insertion line polish

沿用 class：

```text
timeline-remote-insertion-line
```

調整：

- 使用遠端拖曳者顏色。
- `opacity: 0.7`。
- height 3px。
- 上下 margin 加大。
- 插入線落在 gap 中間更明顯。

#### 狀態優先權

foreign drag visual 優先於 remote selection。

```text
foreign drag active → 顯示 remote drag source highlight
foreign drag clear / stale timeout → source highlight + insertion line 消失
```

#### Transport card

- transportation card 不加入 `SortableContext.items`。
- transportation card 不變 draggable。
- transportation card 不做 foreign drag source highlight。
- transportation card 若只是被 remote selection 選中，仍維持 Phase 4.8d selection border 行為。

#### 不做的事

- 不改 RPC。
- 不改 migration。
- 不改 reorder flow。
- 不改 Demo presence。
- 不改 4.8e online presence。
- 不同步 remote DragOverlay。
- 不做真正 ghost card。
- 不做遠端列表讓位。
- 不新增套件。

---

## 12. Phase 4.9：Map Integration Prep / Marker Contract / Focus Surface

> Phase 4.9 已開始。
> 它不是 Timeline reorder 的延伸，也不是 route calculation。
> 它的目標是先讓 Map / RoutePanel 與 Timeline 之間有穩定資料合約與 focus surface，之後再安全接 Google Maps。

### 核心產品方向

```text
Google Maps first, provider-switchable architecture.
```

意思是：

- 未來真地圖優先考慮 Google Maps。
- 但 Timeline / RoutePanel / Map helper 不可直接綁死 Google SDK。
- Google Maps SDK 必須 lazy load，不可進 initial/main bundle。
- 若未來 Google Maps 免費額度不足或成本過高，應能較低風險改接 Leaflet / MapLibre / MapTiler / Stadia 等方案。

---

### 12.1 Phase 4.9 Prep：Map Integration Read-only Audit（已完成）

#### 已確認 Current State

- 目前右側是 `RoutePanel` + `.route-map` 的地圖感 placeholder。
- 它不是真 Google Map。
- 沒有載入 Google Maps / Mapbox / Leaflet / MapLibre SDK。
- Formal / Demo 共用 `ItineraryTimeline`、`RoutePanel`、`TripWorkspace` 相關 render path。
- `focusedItemId` 已作為 local UI focus state：Timeline card click 與 RoutePanel stop click 都能走 `onFocusItem(item.id)`。
- `focusedItemId` 不寫 DB、不改排序、不觸發 RPC。

#### Existing map-capable fields

`itinerary_items` 已有：

- `location_name`
- `address`
- `map_url`
- `latitude`
- `longitude`

destination package fields 已包含：

- `location_name`
- `address`
- `map_url`
- `latitude`
- `longitude`

因此 destination package 在 reorder / package move 時，map fields 應跟著目的地內容移動。

#### Current gaps

目前沒有：

- `place_id`
- route polyline
- distance
- route provider
- route cache metadata
- Google Maps SDK env var / API key strategy
- route calculation flow

Demo mock data 有 lat/lng key，但多數為 `null`，所以不能假設能直接畫真 marker。

---

### 12.2 Phase 4.9a：Map Marker Contract（已完成）

#### 目標

建立 provider-neutral marker helper，讓 active day Timeline items 可以轉成未來 Map / RoutePanel 可使用的資料合約。

#### Helper

```text
src/lib/timelineMapMarkers.js
buildDayMapMarkers(dayItems, options?)
```

#### Marker contract fields

```text
id
itemId
itemType
title
locationName
address
mapUrl
latitude
longitude
hasCoordinates
coordinateSource
provider
providerPlaceId
dayIndex
sortOrder
```

#### 規則

- 只處理 destination / visit items。
- 排除 transportation cards。
- 不 mutate input。
- 不依賴 React。
- 不依賴 DOM。
- 不依賴 Google Maps SDK。
- 不呼叫外部 API。
- 缺少 latitude / longitude 時不可 throw。
- `hasCoordinates` 只有在 lat/lng 都是有限數字時才為 true。
- marker order 保持輸入順序。
- `provider / providerPlaceId` 目前可為 null，為未來 Google-first / provider-switchable 架構預留。

#### RoutePanel wiring

RoutePanel 可先內部使用：

```text
buildDayMapMarkers(sortedVisitItems(dayItems), { requireLocation: true })
```

但 UI class / CSS / 顯示樣式 / focus 行為維持不變。

#### 不做的事

- 不接 Google Maps SDK。
- 不新增 API key / env var。
- 不新增 migration / schema。
- 不改 RPC。
- 不改 reorder / drag / dnd-kit / presence / remote selection / online presence。
- 不新增 map package。
- 不做 route calculation。

---

### 12.3 Phase 4.9b：Map Focus Surface（下一步 / 進行中目標）

#### 目標

整理現有 RoutePanel / route-map placeholder，建立更明確的 Map Focus Surface。

讓以下關係更清楚：

```text
Timeline destination card ↔ RoutePanel stop / future marker
Timeline transport card ↔ from/to destination stops
active day ↔ active day map markers / stops
focusedItemId ↔ focused stop / future marker
```

#### Destination focus 行為

- 點 Timeline destination card → 對應 RoutePanel stop / future marker focused。
- 點 RoutePanel stop / future marker → 對應 Timeline destination card focused。
- `focusedItemId` 仍然只是 local UI state。
- 不寫 DB。
- 不改排序。
- 不觸發 reorder RPC。
- 不影響 drag preview。
- 不影響 remote selection / presence。

#### Transport focus 行為

當使用者 focus / click transportation card 時，RoutePanel / future MapPanel 可以識別：

- `from_item_id`
- `to_item_id`
- 對應 source destination stop
- 對應 target destination stop

第一版只做 low-risk visual relation：

- 不畫真 route。
- 不做 Google route。
- 不做 polyline。
- 不做距離 / 時間計算。
- 可在 RoutePanel stop 加低調 endpoint class。
- 若 `to_item_id = null`，例如 tail_pending，只 highlight from stop。
- endpoint 不存在或不是當日 marker 時，不可 throw。
- transportation card 本身仍不可變成 marker。
- 不改 transport role model。

#### 不做的事

- 不接 Google Map。
- 不做 scroll-sync，除非另開小階段確認不干擾 drag sensors / day-board scroll。
- 不做 route calculation。
- 不新增 map package。
- 不大改 layout。

---

### 12.4 Phase 4.9c：Google Map Provider Prep（後續）

#### 目標

在真正接 Google Maps 前，先建立 provider boundary 與 lazy load 策略。

#### 原則

- Google Maps SDK 只能在 provider component / adapter 裡載入。
- 不可在 `App.jsx` 或主入口直接 import Google Maps SDK。
- Map SDK 必須 lazy load，只在 Map surface 需要時載入。
- Google provider 必須能被 Static / Leaflet / MapLibre 等 provider 替換。

可能架構：

```text
src/components/map/MapPanel.jsx
src/components/map/providers/GoogleMapProvider.jsx
src/components/map/providers/StaticMapProvider.jsx
src/lib/timelineMapMarkers.js
```

資料欄位命名應避免綁死 Google：

```text
place_provider
provider_place_id
route_provider
route_geometry_format
route_distance_meters
route_duration_seconds
route_updated_at
```

而不是只設計：

```text
google_place_id
google_polyline
```

#### 需要另行確認

- Google API key / env var name。
- Vite expose strategy。
- allowed referrers。
- billing / quota / budget alert。
- SDK loading failure fallback。
- Places / Routes 是否拆階段。
- route cache 是否需要 migration 025+。

---

### 12.5 Map work protected scope

Phase 4.9 Map work 不可：

- change Timeline ordering。
- change `start_time / end_time`。
- trigger reorder RPC。
- change fixed anchor planner。
- change untimed rebase。
- change transport role model。
- change brokenTransportIds flow。
- change dnd-kit sortable structure。
- change drag handles。
- change local DragOverlay。
- change foreign drag presence。
- change remote selection behavior。
- change online member presence。
- write route calculation result without approved migration。
- load Google Maps SDK in initial/main bundle。
- make Demo depend on Supabase / Google API。

---

## 13. 建議實作順序

### Phase 4.9a：Map Marker Contract（已完成）

範圍：

- 新增 `buildDayMapMarkers(dayItems, options?)`。
- 建立 provider-neutral marker contract。
- 排除 transportation cards。
- 支援 missing coordinate fallback。
- RoutePanel 內部可吃 helper，但 UI 不變。
- 不接 Google SDK / API key / route calculation。

### Phase 4.9b：Map Focus Surface（下一步）

範圍：

- 整理 `focusedItemId` 在 Timeline / RoutePanel / future MapPanel 間的責任。
- 保持 Timeline destination card ↔ RoutePanel stop focus。
- 新增或整理 transportation card focus → from/to endpoint stop highlight。
- 不做真 route / Google route / polyline。
- 不做 scroll-sync，除非另行確認。

### Phase 4.9c：Google Map Provider Prep

範圍：

- 設計 MapProvider boundary。
- 明確 Google SDK lazy load 規則。
- 不讓 Google SDK 進 initial/main bundle。
- 規劃 provider-neutral place / route 欄位命名。
- 評估 Google API key、billing、quota、referrer、privacy、fallback。
- 若需要 migration，只提出 migration 025+ 草案，不直接實作。

### Phase 4.10：QA / closeout / merge prep

範圍：

- 回歸 Timeline drag / fixed / untimed / transport / presence。
- 驗證 Demo / Formal parity。
- 驗證 Map 前置 work 不影響 Timeline reorder。
- 更新 handoff / CURRENT_TASK / BUGS。
- 準備 merge / PR cleanup。

---

## 14. 待確認事項

以下細節後續仍可再討論：

1. 被動 untimed conversion 後，交通卡 warning 的最終 UI 樣式與文案。
2. untimed visit 混在行程中時，視覺上是否需要特別標示「未設定時間」。
3. timed visit 轉 untimed 後，是否需要顯示一次性提示或在卡片上保留 warning。
4. fixed card 前後若存在 transportation card，跨固定卡拖曳時仍沿用 brokenTransportIds confirmation / cleanup；是否需要更嚴格保護可於後續 QA 後再評估。
5. dnd-kit 導入後的 keyboard accessibility 是否另開 future UX；目前 Phase 4 主要以本機視覺拖曳手感為先。
6. transportation visual attachment 目前採「跟前一張 destination sortable wrapper 移動」；若未來要改成更獨立的 transport card layout animation，應另開 polish，不要影響正式 transport role model。
7. Phase 4.5 untimed slot rebase 是否需要長期改成更明確的 order model，而不是只使用負值 sort_order 編碼，待 Phase 4 後續穩定後評估。
8. Tail transport 在 endpoint 恢復 timed 後的有效性判斷，後續是否需要更明確的 helper 測試或 RPC 層保護。
9. Fixed card 與「接續」disabled 規則目前只限制自動接續，不限制單純儲存；若未來儲存也造成過多混亂，再評估是否加入提示。
10. BUG-025：foreign drag presence 偶爾可能靠 stale timeout 清除，而非立即 clear；目前屬 Known Issue / Low Priority。
11. Google Maps SDK 實際接入時間點。
12. Google API key / env var / referrer / billing / quota alert 設定策略。
13. `place_provider / provider_place_id` 是否需要 migration。
14. `route_provider / route cache / route geometry` 是否需要 migration。
15. Map SDK lazy load 實作方式。
16. Demo 是否要補 mock coordinates。
17. 點 marker 後是否要 scroll Timeline card into view。
18. remote selection 是否要反映到 Map。
19. Google Maps 免費額度若不足，未來替換 Leaflet / MapLibre / MapTiler / Stadia 的 provider adapter 策略。
20. 已套用的 production migrations 019～024 不可原地修改；未來 schema / RPC / permission 修正都必須使用 migration 025+。

---

## 15. 一句話總結

```text
Phase 4 後續應拆開處理：
4.4 已完成修改時間後局部接續，且跨 fixed timed visit 時禁用接續但允許合法儲存；
4.5 已定義未設時間卡可混排行程但不影響時間，並完成 stabilization；
4.5b 已建立 Transportation Role Model，正式分清 normal_pair / tail_pending / tail_promoted_pair，讓一般交通與尾端交通套用不同 untimed 規則；Phase 4.8b QA 另補 tail_pending + untimed + 新增 timed visit 的 narrow bypass，只有 tail_pending 本次 promoted 時才可將 blocking untimed 最小 rebase 到 promoted target 後方，一般 untimed 仍不可自動位移或 compact；
4.5c 已完成 mixed visual drag target 與 prompt cleanup：timed / untimed 都可依完整 mixed visual list 拖曳，只有 brokenTransportIds 存在時才提示；timed / untimed 都可插入既有 normal_pair / tail_promoted_pair 中間，但確認後會刪除受影響交通卡；
4.6 已完成 complete timed visit 拖曳後自動調整時間，重點是保留每張卡自己的原本停留時長，不可交換 time slot；partial time / start-only / end-only 均不可參與 duration-based continuation；Formal 端已使用 transaction RPC 023；
4.6 Hotfix 已收斂 fixed / untimed 規則：只有 complete timed visit 可以 fixed；untimed / partial time 不可 fixed，legacy fixed untimed 會 normalize 清除 fixed 狀態，且不可阻擋 drag / rebase / auto-continuation；
4.7 已完成固定卡作為時間錨點的延續區段版拖曳，固定錨點只限 complete timed + is_fixed，並採 fixed-bounded segments：拖曳跨 fixed anchor 後重算受影響區段內非固定 complete timed visits；若撞到下一個 fixed anchor，從第一張塞不下的非固定 timed visit 開始，該張與後續同區段非固定 timed visits 轉未設定時間；Formal 端已使用 transaction RPC 024；
4.7a / 4.7b 已修正 fixed-adjacent gap no-op 與 fixed overflow untimed conversion mixed visual order；
4.8a 已完成 dnd-kit Local Sortable Drag Preview，只做本機 DragOverlay / placeholder / sortable sliding preview；transportation card 不可拖曳、不進 sortable items，但可作為前一張 destination wrapper 的 visual attachment 跟著 preview movement；drop 前不寫資料，drop 後仍走既有 4.7 正式 flow；
4.8b 已完成 Demo Timeline Data Parity / Transport Edge Cases，讓 /demo/timeline 的 mock data shape、transport role、pair 欄位與 render flow 更接近 Formal，並補 tail_pending promotion narrow bypass；
4.8c / 4.8c2 已完成 Collaborative Drag Presence、same-day readonly lock 與 Realtime channel lifecycle recovery；同日 foreign drag 會暫時鎖定該日資料變更，但不取代 RPC validation；
4.8d 已完成 remote destination / transport selection border，selection visual-only，不阻擋操作；foreign drag visual 優先於 remote selection；
4.8e 已完成 trip-level online member presence，支援 avatar online border、Day Tab presence border、inactive Day Board dots 與點 avatar 跳到對方 page / Timeline day；
4.8f 已完成 Remote Drag Visual Polish，不做 remote ghost / remote reorder / remote DragOverlay，只強化 source card highlight 與 insertion line；
4.9 已開始 Map Integration Prep，產品方向是 Google Maps first 但 provider-switchable；4.9a 已完成 provider-neutral buildDayMapMarkers marker contract，RoutePanel 可內部吃 marker helper但 UI 不變；
4.9b 下一步是 Map Focus Surface，整理 Timeline card / RoutePanel stop / transport endpoint focus 關係，不接 Google Map、不算 route；
4.9c 再做 Google Map Provider Prep，包含 MapProvider boundary、Google SDK lazy load、API key / quota / billing / route cache 策略；
4.10 最後做 QA、文件 closeout 與 merge prep。
```
