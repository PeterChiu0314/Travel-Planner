# Phase 5：地圖 / 路線 / 行程工作區整合 Handoff

Date: 2026-07-02  
Status: Phase 5 planning handoff for next chat / Codex goals  
Project: Travel Planner Timeline / Map Integration

---

## 1. Phase 5 目標

Phase 5 的目標是把 Timeline 從「行程列表」升級成桌面版規劃工作區：

- 左側：Timeline / Day Board / 行程卡片
- 右側：Map / Route / 今日移動摘要
- 中間關係：景點卡、交通卡、地圖 marker、路線段、預算摘要彼此連動

Phase 5 不只是放一張地圖，而是讓使用者可以在桌面版快速回答：

- 今天會去哪裡？
- 地點在地圖上的相對位置順不順？
- 每段交通怎麼移動？
- 哪些景點缺座標或地址？
- 今日交通費大概多少？
- Timeline 拖曳後，路線摘要是否需要重新確認？

---

## 2. Phase 4.9 已完成的前置基礎

Phase 4.9 是 Map 整合前置設計，目前已完成到 4.9c。

### Phase 4.9a：Map Marker Contract

已完成：

- `buildDayMapMarkers(dayItems, options?)`
- provider-neutral marker contract
- destination marker helper
- transportation cards 不會變成 marker
- 缺座標時不 throw
- RoutePanel 可吃 marker helper，但 UI 行為維持不變

### Phase 4.9b：Map Focus Surface

已完成：

- provider-neutral focus helpers：
  - `buildRoutePanelStops`
  - `getFocusedMapState`
  - `getTransportEndpointMarkerIds`
- destination focus
- transport card `from_item_id` / `to_item_id` endpoint highlight
- RoutePanel 使用 focus helpers
- 不接 Google SDK
- 不做 route calculation

### Phase 4.9c：Google Map Provider Prep

已完成：

- `MapPanel` provider seam
- `StaticMapProvider`
- `GoogleMapProvider.lazy` placeholder
- `mapProviderConfig`
- `mapProviderAdapter`
- `RoutePanel` 已改走 `MapPanel`
- 畫面仍維持原本 `.route-map` / `.route-stop` placeholder 行為
- Google-first but provider-switchable 架構
- Map SDK lazy load 原則

### 重要原則

Phase 5 不需要重新做基礎 focus contract。  
Phase 5 可以直接從「真地圖 MVP」與「工作區整合」開始。

---

## 3. Phase 5 建議子階段

## Phase 5.0：Phase 5 Kickoff / Map MVP Readiness

### 目標

在正式接 Google Maps 前，確認 Phase 5 實作邊界與風險。

### 任務

- 檢查 4.9a～4.9c 的 provider seam 是否足以承接 Google Maps。
- 確認 Demo 是否需要補 mock latitude / longitude。
- 確認 Formal 沒有座標時的 fallback 行為。
- 確認 Google Maps API key / env / referrer / billing / quota 準備事項。
- 確認 `GoogleMapProvider.lazy` 的實際接入方式。
- 確認 Map SDK 不會進 initial bundle。
- 確認 Phase 5 不改 Timeline reorder / drag / presence / transport role model。

### 成果

- Phase 5 kickoff handoff
- Google Map MVP 實作邊界
- QA checklist
- 不一定需要改程式

---

## Phase 5.1：Google Map MVP - Markers Only

### 目標

正式把 Google Map 放進右側 `MapPanel`，但只做 marker，不做路線計算。

### 功能

- 使用 Google Maps JavaScript API。
- SDK 必須 lazy load。
- API key 使用 Vite env，例如：`VITE_GOOGLE_MAPS_API_KEY`。
- 有座標的 destination 顯示 marker。
- Marker 來源使用 Phase 4.9 的 provider-neutral marker contract。
- 點 Timeline destination card → Google Map focus 對應 marker。
- 點 Google marker → Timeline 對應卡片 highlight。
- 切 Day → 地圖 marker 換成 active day。
- 缺座標時 fallback 到 static route surface。
- 缺 API key 時 fallback 到 `StaticMapProvider`。
- SDK 載入失敗時 fallback 到 `StaticMapProvider`。

### 不做

- 不做 Places 搜尋。
- 不做地址轉座標。
- 不做 Directions / Routes API。
- 不畫 polyline。
- 不算距離。
- 不算交通時間。
- 不寫 route cache。
- 不新增 migration。
- 不讓 marker 可拖曳。
- 不改交通卡時間。

### 手動 QA

- Demo 無 key 時不壞。
- Formal 無 key 時不壞。
- 有 key + 有座標時顯示 Google Map marker。
- 點卡片地圖 focus。
- 點 marker 卡片 focus。
- 切 Day 後 marker 更新。
- Google SDK 沒進 main bundle。

---

## Phase 5.2：Marker → Timeline Scroll Sync

### 目標

完成地圖 marker 到 Timeline 卡片的桌面工作區連動。

### 功能

點地圖 marker 後：

1. 自動切到對應 Day。
2. 自動 scroll 到對應 destination card。
3. 該卡片 highlight。
4. 如果右側地圖收合，仍應能更新 focus state。
5. 如果卡片在 inactive day board，先切換 active day 再 scroll。
6. 如果 item 不存在或 day 不一致，不 throw。

### 注意

- 只做 destination marker。
- transportation card 不做 marker。
- scroll 行為要保守，不要干擾拖曳中狀態。
- 拖曳中、編輯中、foreign drag readonly 時，不應強制 scroll 干擾操作。
- 不寫 DB。
- 不改排序。
- 不觸發 reorder。

### 建議行為

```text
marker click
→ onFocusItem(itemId)
→ ensure active day
→ requestAnimationFrame
→ scroll destination card into view
→ focused class highlight
```

---

## Phase 5.3：Location Data Input / Missing Coordinates Flow

### 目標

解決「地圖需要座標，但目前資料可能只有地址 / map_url / location_name」的問題。

### 功能方向

第一版可以很保守：

- destination card 顯示是否缺座標。
- 地點資料區整理：
  - location name
  - address
  - map URL
  - latitude
  - longitude
- 可以手動輸入 latitude / longitude。
- 可以從 Google Maps URL 嘗試解析座標，如果低風險。
- 有座標後 marker 才出現在 Google Map。
- 無座標時仍保留 static route stop。

### 不做

- 不做 Google Places Autocomplete。
- 不做自動 geocoding。
- 不做大量地址查詢。
- 不自動把地址送到 Google。
- 不新增 `provider_place_id` migration，除非另開資料階段。

### 為什麼要先做這階段

如果沒有座標，Google Map MVP 做完也只能顯示少量 marker。  
所以 5.3 是讓使用者可以逐步補齊地圖資料的必要階段。

---

## Phase 5.4：Route Panel 重整 / 今日移動摘要

### 目標

把右側從單純地圖變成「今日路線與移動摘要」。

### 顯示概念

```text
Day 1 路線摘要

08:00 早餐
↓ 徒步 12 分
09:00 神社
↓ 電車 25 分
11:00 商店街
↓ 計程車 15 分
13:00 飯店
```

### 功能

- RoutePanel 顯示 active day 的 destination + transportation sequence。
- destination 來自 Timeline order。
- transportation 來自現有 transportation card。
- 顯示：
  - destination time
  - destination title / location
  - transportation method
  - transportation duration
  - transportation note
  - transportation warning
- 點 route summary destination → focus Timeline card + map marker。
- 點 route summary transportation → focus Timeline transport card + highlight from/to marker。
- 若交通卡 endpoint 缺座標，仍可顯示文字摘要。
- 若交通卡時間不足 warning，摘要中也可提示。

### 不做

- 不使用 Google Directions。
- 不自動估算交通時間。
- 不自動畫 route polyline。
- 不自動新增交通卡。
- 不改 transportation role model。
- 不改 Timeline 排序規則。

---

## Phase 5.5：Transport Route Segment Visual Mapping

### 目標

讓交通卡在地圖 / RoutePanel 上更有視覺對應。

### 功能

- focus transportation card 時：
  - highlight from marker
  - highlight to marker
  - highlight route summary segment
- 若 from/to 都有座標，可以畫簡單直線或 provider-neutral connector。
- 若只有 from，highlight from。
- 若 to 是 null tail transport，highlight from + tail warning。
- 若 endpoint 缺座標，不報錯，保留文字摘要。
- map connector 只是視覺提示，不代表真實路線。

### 不做

- 不做 Directions API。
- 不做實際路線 polyline。
- 不算距離 / 時間。
- 不寫 route cache。
- 不把 connector 當真實交通路徑。

---

## Phase 5.6：Transport Budget Summary Integration

### 目標

強化交通卡與預算摘要的連動，但不重做完整 Budget 模組。

### 功能

- RoutePanel 顯示今日交通費小計。
- transportation card 若已連動 budget item，RoutePanel 可顯示金額。
- 預算反查來源：
  - 來自哪一張 transportation card
  - from / to destination
  - day
- 點交通費摘要可 focus 對應 transportation card。
- 若 budget item 已刪除或連動失效，顯示低調 warning。

### 不做

- 不重做 Budget CRUD。
- 不改分攤規則。
- 不改預算轉實付規則。
- 不在此階段做完整結算整合。

---

## Phase 5.7：Desktop Workspace Layout Polish

### 目標

整理桌面版工作區，使 Timeline + Map / Route 更適合規劃。

### 方向

地圖展開時：

```text
左：Timeline / active day
右：Map + Route summary
```

地圖收合時：

```text
多 Day 水平 Board
Active Day 寬版編輯
其他 Day 窄版預覽
```

### 功能

- 優化 MapPanel 展開 / 收合。
- 確認 Day Board 不因 MapPanel 變化而破版。
- active day 保持可讀與可編輯。
- inactive day 只做預覽。
- RoutePanel 高度與 Timeline scroll 行為協調。
- 避免 header / sidebar / workspace 捲動衝突。
- 保持 mobile 不被桌面版調整破壞。

### 不做

- 不做大型動畫。
- 不做 3D 地圖。
- 不做複雜 map transition。
- 不改 Phase 4 drag preview 行為。
- 不改 collaborative presence 行為。

---

## Phase 5.8：Directions / Routes API + Route Cache Proposal

### 目標

正式評估是否導入 Google Routes / Directions API。  
這一階段先設計，不急著實作。

### 需要確認

- 使用 Google Directions API 還是 Routes API。
- 每日每位使用者可能產生多少 route request。
- 是否需要快取。
- route cache 存在哪：
  - transportation card
  - route segment table
  - JSONB field
- 是否需要 migration。
- route cache invalidation 條件：
  - from/to marker 變更
  - travel mode 變更
  - departure time 變更
  - day/time 變更
- API 成本與 quota。
- 隱私說明。

### 建議資料欄位草案

```text
route_provider
route_geometry_format
route_geometry
route_distance_meters
route_duration_seconds
route_updated_at
route_status
```

### 不做

- 不在沒有 cache 策略時直接呼叫 API。
- 不在每次拖曳時自動打 route API。
- 不把 Google route result 寫死成唯一資料模型。
- 不修改已套用 migration，需新增 migration。

---

## Phase 5.9：Timeline Reorder + Route Review Integration

### 目標

讓使用者拖曳調整行程後，可以更直覺地知道路線是否需要重新確認。

### 功能

- 拖曳 destination 後，如果交通卡被保留，但地理順序變化大，可以提示重新確認交通。
- 若 route cache 未來存在，拖曳後標記 route stale。
- RoutePanel 顯示：
  - transportation needs review
  - missing coordinates
  - route not calculated
  - transport duration may be outdated
- 不自動打 API。
- 不自動刪除交通卡。
- 不自動重算路線。
- 只做 review state / warning。

### 不做

- 不改 Phase 4 reorder RPC。
- 不改 brokenTransportIds 規則。
- 不自動新增交通卡。
- 不自動重算所有交通時間。

---

## 4. 建議實作順序

建議順序：

```text
Phase 5.0：Kickoff / readiness
Phase 5.1：Google Map MVP - markers only
Phase 5.2：Marker → Timeline scroll sync
Phase 5.3：Location data input / missing coordinates
Phase 5.4：Route Panel 今日移動摘要
Phase 5.5：Transport route segment visual mapping
Phase 5.6：Transport budget summary integration
Phase 5.7：Desktop workspace layout polish
Phase 5.8：Directions / Routes API + cache proposal
Phase 5.9：Timeline reorder + route review integration
```

如果想要降低風險，也可以把 Phase 5.1 和 5.2 對調：

```text
5.1 先完成 StaticMapProvider 的 marker/stop scroll sync
5.2 再接 Google Map MVP
```

但以目前 4.9c 已經有 provider seam 來看，直接做 Google Map markers only 是合理的。

---

## 5. Phase 5 Protected Scope

Phase 5 早期仍要保護 Phase 4 的核心成果。

禁止任意修改：

- Timeline reorder RPC
- migration 019～024
- fixed anchor planner
- untimed rebase
- transport role model
- brokenTransportIds
- dnd-kit sortable structure
- DragOverlay
- foreign drag presence
- remote selection
- online member presence
- edit lock
- draft autosave
- Supabase Auth / RLS
- Budget 分攤與結算規則

Map / Route 工作應該優先走：

```text
read Timeline state
→ build markers / route summary
→ focus / highlight
→ fallback
```

不要反過來讓 Map 直接改 Timeline 資料。

---

## 6. Phase 5 一句話總結

```text
在不破壞 Phase 4 Timeline 拖曳、固定卡、未設時間、交通卡與多人協作規則的前提下，
把右側 MapPanel 從 placeholder 升級成 Google Map markers、今日路線摘要、交通段視覺對應與桌面規劃工作區。
```

---

## 7. 給下一聊天室的提醒

1. Phase 4.9a～4.9c 已完成 Map 前置基礎，Phase 5 不需要重做 marker contract / focus surface / provider seam。
2. Phase 5.1 若要接 Google Map，必須先確認 API key、Vercel env、HTTP referrer restriction、billing、budget alert。
3. Google Maps SDK 必須 lazy load，不可進 initial/main bundle。
4. Formal / Demo 都必須在缺 API key、缺座標、SDK 載入失敗時安全 fallback。
5. Phase 5 早期不要碰 Places / Geocoding / Directions / Routes API，避免成本、migration、route cache 和隱私範圍失控。
6. 真正路線計算與 route cache 建議延後到 Phase 5.8 先設計再實作。
