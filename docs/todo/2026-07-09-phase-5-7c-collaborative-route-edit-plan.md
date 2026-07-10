# Timeline Phase 5.7c：多人地圖路線協作規劃

Date: 2026-07-09
Project: Travel Planner / 旅程規劃室
Branch context: `codex/timeline-phase-5-7`
Previous phase: Phase 5.7b-3 Route Override Persistence completed

---

## 0. 本文件定位

本文件整理 Phase 5.7c 的最終規劃，用於交接給新聊天室 / Codex。

Phase 5.7c 已吸收原本 Phase 5.7d 的多人同線節點協作目標。

也就是：

```text
原本 5.7c：保守版，一人編輯、其他人觀看，同日 readonly
原本 5.7d：實驗版，多人同時編輯同一條線，不同節點可同時拖曳

新版 5.7c：直接做多人地圖路線協作
新版 5.7d：取消 / 併入 5.7c，不再作為獨立正式階段
```

新版 5.7c 的核心原則是：

```text
行程資料優先。
地圖路線折線只是視覺輔助。
多人可以一起編輯路線，但不能阻擋正式行程操作。
如果行程變更導致路線折線不再有效，該折線直接失效並回到直線。
```

---

## 1. 目前 Phase 5.7b 已完成狀態

Phase 5.7b-3 已完成並 push。

目前已有：

```text
Google provider only route edit mode
同日相鄰 destination segment 的手動折線編輯
A -> custom points -> B 顯示
每段最多 5 個自訂中繼點
點線段新增節點
拖曳節點
點擊節點刪除
route override persistence
自動 upsert / delete
保存失敗 rollback
reorder / delete / insert / coordinate change 的 invalidation cleanup
Static / Demo 不支援 route edit mode
```

新增資料表：

```text
public.itinerary_route_overrides
```

目前保存概念：

```text
route override 綁定同日目前相鄰段 from_item_id -> to_item_id
points_json 只保存中繼節點
顯示時組合：from coordinate + points_json + to coordinate
```

已套用 migration：

```text
20260708063744_add_itinerary_route_overrides.sql
```

Supabase migration history 已修復並確認 GitHub local `001`～`024` 與 remote 對齊，且 `20260708063744` 已成功 push 到 remote。

---

## 2. Phase 5.7c 最終目標

Phase 5.7c 要做到：

```text
多人可以同時進入路線編輯模式。
多人可以同時編輯同一天的地圖路線。
多人可以同時編輯同一條 A -> B 線。
不同使用者可以拖曳不同節點。
同一個節點不能被多人同時拖曳。
多人新增 / 刪除 / 拖曳節點後，其他人會同步看到結果。
正式保存仍以 DB 為準。
同日行程不鎖定。
行程變更時，受影響的手動畫線直接失效並回到直線。
不做 15 秒 idle 自動退出。
```

---

## 3. 使用者顯示規則

### 3.1 Route edit mode 人數提示

當只有 1 位使用者正在該日路線編輯模式：

```text
某某正在編輯地圖路線
```

當 2 位以上使用者正在該日路線編輯模式：

```text
N 位成員正在編輯地圖路線
```

主提示不列出所有人名，避免 UI 擁擠。
若未來需要，可在 hover / avatar 區顯示詳細名單。

### 3.2 節點被他人拖曳時

若某節點正在被其他使用者拖曳：

```text
節點外圈顯示該使用者顏色
hover / 靠近時顯示：某某正在編輯
```

若使用者嘗試拖曳被他人佔用的節點：

```text
這個節點正在被某某編輯
```

此提示應低調，不要使用大型確認視窗。

---

## 4. 同日行程不鎖定規則

新版 5.7c 明確決定：

```text
route edit mode 不鎖同日行程。
```

也就是其他使用者仍可正常操作：

```text
新增景點
刪除景點
拖曳行程卡
修改景點時間
修改景點座標 / Map URL
編輯交通卡
新增 / 刪除 / 修改交通卡
切 Day
切頁面
pan / zoom 地圖
```

理由：

```text
行程是主要資料。
路線折線只是輔助視覺。
路線編輯不應該反過來阻擋正式行程操作。
```

---

## 5. 行程變更時的路線讓位規則

當同日行程被其他人或自己變更時，route override 應依既有 5.7b 原則失效。

### 5.1 相鄰關係改變

route override 綁定的是：

```text
from_item_id -> to_item_id
```

如果該段不再是目前同日相鄰 destination segment：

```text
該段手動畫線失效
刪除 / 忽略該 route override
新產生的相鄰段顯示直線
不阻擋行程操作
不跳大型確認
```

例：

```text
原本：A > B > C > D
B -> P1 -> C

有人拖曳 C，使順序變成：A > B > D > C

結果：
B -> C 不再相鄰
B -> P1 -> C 失效
B -> D 顯示直線
D -> C 顯示直線
```

### 5.2 端點座標改變

如果某段 route override 的 from / to 任一景點座標改變：

```text
與該點相連的 route override 失效
相關線段回到直線
```

### 5.3 拖曳中遇到行程變更

如果使用者正在拖曳某個節點，而該節點所屬 segment 因行程變更失效：

```text
立即取消該節點拖曳
釋放該節點操作狀態
移除該段 route override preview
該段回到直線或消失
顯示低調提示：行程已變更，部分手動畫線已重設為直線。
```

不得阻止行程變更。

---

## 6. 多人節點協作規則

### 6.1 多人可同時進入 route edit mode

同一 trip / day 可以有多位使用者同時在 route edit mode。

```text
A 可以進入 route edit mode
B 可以進入 route edit mode
C 可以進入 route edit mode
```

不再有「一人獨占 route edit mode」。

### 6.2 同一節點不能被搶

如果 A 正在拖曳 P1：

```text
P1 被 A 暫時佔用
B 不能拖 P1
B 可以拖 P2
C 可以拖其他 segment 的節點
```

### 6.3 不同節點可同時拖曳

例如：

```text
B -> P1 -> P2 -> C
```

允許：

```text
A 拖 P1
B 拖 P2
```

不允許：

```text
A 和 B 同時拖 P1
```

### 6.4 新增節點

使用者可點擊線段 / 子線段新增節點。

規則：

```text
每段最多 5 個自訂節點
新增節點後，其他使用者要同步看到
新增節點後自動保存
如果遠端已經新增到 5 個，本機新增應失敗或回復 authoritative data
```

### 6.5 刪除節點

規則：

```text
可以刪除沒有人正在拖曳的節點
不能刪除別人正在拖曳的節點
刪除後其他使用者要同步看到節點消失
刪除後自動保存
```

若刪除被佔用的節點：

```text
這個節點正在被某某編輯，暫時無法刪除
```

---

## 7. 節點資料格式要求

5.7c 需要把原本 5.7b 的 points_json 升級成 5.7d-compatible 格式。

### 7.1 不建議只存 lat/lng

舊格式：

```json
[
  { "lat": 35.01, "lng": 135.77 },
  { "lat": 35.02, "lng": 135.78 }
]
```

多人協作時不夠安全，因為不能只靠第 1 個點、第 2 個點判斷節點。

### 7.2 新格式需有 stable node id

建議格式：

```json
[
  {
    "id": "node_xxxxx",
    "lat": 35.01,
    "lng": 135.77
  },
  {
    "id": "node_yyyyy",
    "lat": 35.02,
    "lng": 135.78
  }
]
```

後續所有多人同步都應用：

```text
segmentKey + nodeId
```

不應只用：

```text
segmentKey + nodeIndex
```

### 7.3 舊資料相容

已存在的舊 points_json 若沒有 id：

```text
讀取時應能正常顯示
第一次編輯 / 保存時補上 stable node id
不要讓舊資料造成 route edit crash
```

---

## 8. Supabase Realtime 使用策略

5.7c 建議沿用 Phase 4.8 的 Supabase Realtime 架構。

也就是：

```text
Presence：用來知道誰正在編輯路線、誰正在拖節點
Broadcast：用來同步拖曳中的節點位置、節點新增/刪除、clear 狀態
DB：保存最後正式結果
```

與 Phase 4.8 差異：

```text
Phase 4.8 是拖行程卡，因此需要 temporary same-day readonly lock。
Phase 5.7c 是拖 route override 節點，不鎖同日行程。
```

因此不要照搬 Phase 4.8 的 same-day readonly lock。

### 8.1 Channel

建議新增獨立 channel：

```text
timeline-route-edit:{tripId}:{dayIndex}
```

不要混用既有：

```text
timeline-drag:{tripId}:{dayIndex}
```

理由：

```text
行程卡拖曳與路線節點拖曳是不同互動
鎖定規則不同
payload 不同
debug 與清理邏輯不同
```

### 8.2 Presence 用途

Presence 用來顯示：

```text
誰正在 route edit mode
誰正在拖哪個節點
使用者名稱 / 顏色 / session
狀態是否 stale
```

Presence payload 可包含概念欄位：

```json
{
  "tripId": "...",
  "dayIndex": 1,
  "sessionId": "...",
  "userId": "...",
  "userName": "...",
  "colorKey": "...",
  "routeEditMode": true,
  "activeSegmentKey": "fromItemId:toItemId",
  "activeNodeId": "node_xxxxx",
  "updatedAt": 1234567890
}
```

### 8.3 Broadcast 用途

Broadcast 用來同步：

```text
node drag start
node drag move
node drag end
node add
node delete
route edit clear
segment invalidated
```

Broadcast payload 應使用 stable node id。

概念格式：

```json
{
  "editId": "route-edit-uuid",
  "segmentKey": "fromItemId:toItemId",
  "fromItemId": "...",
  "toItemId": "...",
  "nodeId": "node_xxxxx",
  "nodes": [
    { "id": "node_xxxxx", "lat": 35.01, "lng": 135.77 }
  ],
  "phase": "node-drag-move",
  "updatedAt": 1234567890
}
```

拖曳 move 可節流，避免過度 broadcast。

建議節流範圍：

```text
100–200ms
```

---

## 9. 保存策略

### 9.1 使用者體感

使用者不需要按保存。

```text
拖曳結束後自動保存
新增節點後自動保存
刪除節點後自動保存
```

### 9.2 正式資料以 DB 為準

Broadcast 是即時 preview，不是正式資料。

正式結果仍以 DB / reload / Realtime reload 後的資料為準。

### 9.3 避免互相覆蓋

多人同時編輯時，最重要風險是整包 points_json 覆蓋。

如果仍用整包 points_json：

```text
A 拖 P1 保存
B 拖 P2 晚一點保存舊 points_json
A 的 P1 修改可能被 B 覆蓋
```

因此 5.7c 需要特別處理保存衝突。

可行方向：

```text
優先方向：節點級保存 / patch，誰改哪個 node 就保存哪個 node。
若初期仍維持 points_json，必須在保存前後做 baseline / version guard，避免舊資料覆蓋新資料。
```

如果 Codex 評估目前 `itinerary_route_overrides.points_json` 不適合安全支援多人 node-level patch，可考慮新增更細資料結構，例如：

```text
route_overrides
route_override_nodes
```

概念：

```text
route_overrides
- id
- trip_id
- day_index
- from_item_id
- to_item_id
- created_at
- updated_at

route_override_nodes
- id
- route_override_id
- node_key
- order_key
- lat
- lng
- updated_by
- updated_at
```

但是否新增 table 可交由 Codex 技術評估；產品規則上要求是：

```text
多人拖不同節點時，不可互相覆蓋。
```

### 9.4 保存失敗

保存失敗時：

```text
只還原該次操作
不要整條線全部還原
顯示低調提示：路線保存失敗，已還原該次操作。
```

如果 authoritative data 已經變更：

```text
重新載入該 segment 的最新 route override
以 DB 結果為準
```

---

## 10. 斷線 / 離開 / stale cleanup

新版 5.7c 不做：

```text
15 秒未操作自動退出 route edit mode
```

原因：

```text
route edit mode 不鎖同日行程
其他人也可以同時進 route edit mode
不再存在某人佔用同日編輯權的問題
```

但仍需要清理異常狀態。

### 10.1 正常退出

以下情境應清除自己的 route edit presence：

```text
再次點擊 route edit icon 退出
按 Esc 退出
切 Day
切頁面
離開 trip/editor
登出
關閉頁面 / unmount
```

### 10.2 節點拖曳中斷線

如果使用者正在拖 node，卻斷線 / 關閉頁面 / channel stale：

```text
釋放該使用者持有的 node lock
其他人可以重新拖該 node
```

### 10.3 Stale timeout

雖然不做 idle exit，但仍需要 stale timeout 清除壞掉的 presence / node lock。

概念：

```text
route edit presence stale：只影響顯示人數
node drag stale：必須釋放節點
```

---

## 11. 與現有 Phase 4.8 / 5.7b 的關係

### 11.1 沿用 Phase 4.8 的協作概念

可參考 Phase 4.8c2：

```text
Presence 作協作狀態
Broadcast 作即時互動同步
DB 作 authoritative final result
sessionId 用於分辨 self / foreign
channel status / CLOSED recovery 需考慮
Debug logs 可沿用 ?debugPresence=1 類似方式
```

但不要沿用：

```text
same-day readonly lock
remote DragOverlay
ghost card
Timeline preview reorder
```

### 11.2 延續 Phase 5.7b 的 route override 原則

保留：

```text
route override 綁定 from_item_id -> to_item_id
只有同日相鄰 destination segment 有效
失效後回到直線
Static / Demo 不支援 route edit collaboration
不使用 Google Routes API polyline
不保存 Google route content
```

---

## 12. Protected Scope

Phase 5.7c 不應改動：

```text
Google Maps loader / provider gating
StaticMapProvider / Demo isolation
Places Autocomplete / POI / Preview 核心流程
Destination editor Map URL picker
Map-area add point flow
Transportation card navigation / manual editing
Routes API / Directions API 查詢流程，不要恢復
Timeline reorder RPC
dnd-kit card drag 架構
Budget / Share / Invite / Auth
Existing applied migrations 001-024 and 20260708063744，不要原地修改
Google route polyline / route cache / encoded polyline，不要新增
```

---

## 13. Phase 5.7c 建議拆分

新版只拆兩個子階段。

### Phase 5.7c-1：多人地圖路線協作核心

目標：

```text
多人可以同時進入 route edit mode。
多人可以同時編輯路線。
不同人可以拖不同節點。
同一節點不能被多人同時拖曳。
多人新增 / 刪除 / 拖曳節點後，其他人會同步看到結果。
節點自動保存，且不互相覆蓋。
```

包含：

```text
route edit presence
人數提示
stable node id
node lock
node drag broadcast
node add / delete broadcast
node save / rollback
避免多人保存互相覆蓋
```

### Phase 5.7c-2：行程變更與協作穩定化

目標：

```text
確保多人路線協作不干擾正式行程資料。
```

包含：

```text
同日行程不鎖定
行程順序變更時 route override 失效
端點刪除時 route override 失效
端點座標變更時 route override 失效
拖曳中 segment 失效時清理 local / remote preview
斷線 / 離開 / stale node lock cleanup
多人 QA
Demo / Static regression
```

---

## 14. QA 重點

5.7c-1 QA：

```text
兩人同時進入 route edit mode
1 人時顯示「某某正在編輯地圖路線」
2 人以上時顯示「N 位成員正在編輯地圖路線」
A 拖 P1，B 看到 P1 移動
A 拖 P1 時，B 不能拖 P1
A 拖 P1 時，B 可以拖 P2
多人新增節點
多人刪除節點
不能刪除別人正在拖曳的節點
每段最多 5 個自訂節點
保存失敗只還原該次操作
多人拖不同節點不互相覆蓋
```

5.7c-2 QA：

```text
route edit mode 期間仍可新增景點
route edit mode 期間仍可刪除景點
route edit mode 期間仍可拖曳行程卡
route edit mode 期間仍可修改景點座標
segment 不再相鄰時，該 route override 回直線
端點座標改變時，相關 route override 回直線
拖曳中 segment 失效時，拖曳安全取消
使用者切 Day 清除自己的 route edit 狀態
使用者關閉頁面釋放 node lock
Realtime channel CLOSED / reconnect 後不殘留錯誤 node lock
Demo / Static 不顯示多人 route edit 功能
```

---

## 15. 最終結論

Phase 5.7c 的產品定義：

```text
多人地圖路線協作。
```

最重要的規則：

```text
多人可以一起畫線。
同一節點不能被多人搶。
行程不因路線編輯而鎖住。
行程一變，受影響路線就讓位回直線。
路線永遠是輔助，行程永遠是主資料。
```
