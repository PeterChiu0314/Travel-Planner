# App Layout Phase 3.1 - Timeline Workspace Audit

日期：2026-06-18

範圍：本階段只盤點 Timeline Workspace 的 JSX / CSS / Demo render path，不修改程式碼。

## 1. 目前 JSX 結構

### Formal Timeline

- Formal Timeline 入口在 `src/App.jsx` 的 `TripWorkspace`。
- `TripWorkspace` 依 `activeSection` 判斷目前是否顯示 Timeline。
- Timeline mode 的主要外層結構：
  - `.timeline-top-row`
    - `DayTabs`
    - 顯示 / 隱藏 route/map 的切換按鈕
  - `.content-grid.timeline-workbench`
    - 左側 / 主區：`.panel.itinerary-panel`
    - 右側 route/map context：`.side-panels`

### Day Tabs

- `DayTabs` component 位於 `src/App.jsx`。
- Formal Timeline 在 Header 下方、workbench 上方 render `DayTabs`。
- Demo Timeline 也在相同相對位置 render `DayTabs`。
- Day tabs 目前不在 `ItineraryTimeline` 內，而是在 Formal / Demo 各自的 Timeline 外框中。

### Day Board Header

- Active Day Board 由 `ItineraryTimeline` render。
- active day 外層是 `.timeline-day-column.active`。
- header 是 `.panel-heading.timeline-column-header`。
- Day Board header 右上角目前有新增目的地 `+` 按鈕，呼叫 `openNewItem`。
- 這符合「新增目的地保留在 Day Board 右上角」的方向。

### 地圖顯示 / 隱藏 Render Path

目前狀態由 `isRouteCollapsed` 控制。

地圖 / route context 顯示時：

- `isRouteCollapsed === false`
- `.timeline-workbench` 不加 `route-collapsed`
- `itinerary-panel` 只顯示 active day 的 `ItineraryTimeline`
- 右側 render：
  - `<aside className="side-panels">`
  - `<RoutePanel />`

地圖 / route context 隱藏時：

- `isRouteCollapsed === true`
- `.timeline-workbench` 加上 `route-collapsed`
- 不 render `RoutePanel`
- 在 `itinerary-panel` 內追加 render `MultiDayTimelineColumns`
- `MultiDayTimelineColumns` 顯示其他 days 的 preview columns，讓多日 Day Board 橫向吃滿 workspace。

### RoutePanel

- `RoutePanel` 目前是右側 route/map context 的承載區。
- 內容目前是 fake map grid + route stop list。
- CSS class 主要是：
  - `.route-map`
  - `.route-line`
  - `.route-stop`
  - `.route-dot`
  - `.route-name`
- 命名已經偏 route / map context，未來接 Google Map 可以沿用此區塊。

### MultiDayTimelineColumns

- `MultiDayTimelineColumns` 只在 `isRouteCollapsed === true` 時 render。
- 它會排除 active day，只顯示其他 day 的 preview。
- 每個 day preview 使用 `.timeline-day-preview`。
- preview 內的景點卡使用 `.timeline-preview-card`。
- 若該 day 的兩個 visit item 之間有交通卡，preview 也會顯示 `.transport-preview-card`。

## 2. 目前 CSS 控制點

### Workspace / Workbench Grid

主要控制點在 `src/styles.css`：

- `.content-grid`
  - 目前預設是 `grid-template-columns: minmax(0, 1fr) 360px`
  - 這是較通用的 content grid 設定，不只 Timeline 使用。

- `@media (min-width: 1101px) .timeline-workbench`
  - 目前覆寫為 `grid-template-columns: minmax(320px, 2fr) minmax(0, 3fr)`
  - 約等於左側 40%、右側 60%。
  - 已確立的 36% / 64% 目前先視為下一階段假設值，仍需手動確認視覺後定案。

- `.timeline-workbench.route-collapsed`
  - 目前改為 `grid-template-columns: minmax(0, 1fr)`
  - 代表 route/map context 隱藏時，workbench 變成單欄。

### Left Day Board / Itinerary Panel

- `.timeline-workbench .itinerary-panel`
  - desktop 下設 `max-height: calc(100vh - 250px)`
  - `overflow-y: auto`
  - `scrollbar-gutter: stable`

- `.timeline-workbench.route-collapsed .itinerary-panel`
  - 改成 `display: flex`
  - `align-items: flex-start`
  - `overflow-x: auto`
  - `overflow-y: clip`
  - 用來承載 active day + other day preview columns。

### Right Route / Map Context

- `.timeline-workbench .side-panels`
  - desktop 下是 `position: sticky`
  - `top: 24px`

- `.timeline-workbench .route-map`
  - 目前設 `min-height: min(560px, calc(100vh - 250px))`
  - 是右側 route/map 視覺高度的主要控制點。

### Day Tabs

- `.day-tabs`
  - flex row
  - `overflow-x: auto`
  - 適合多天旅程水平捲動。

- `.timeline-top-row`
  - flex row
  - 左側 Day tabs 透過 `.timeline-top-row .day-tabs { flex: 1; min-width: 0; }` 吃剩餘寬度。
  - 右側切換按鈕透過 `.timeline-top-row .ghost-button { flex: 0 0 auto; }` 固定尺寸。

### Day Board / Cards

- `.timeline-day-column.active`
  - active day board 的外層。

- `.timeline-column-header`
  - active day header 和 preview day header 共用的 header 高度 / 對齊控制點。

- `.timeline-item`
  - active day 景點卡。

- `.transport-card`
  - active day 交通卡。

- `.timeline-preview-card`
  - route/map 隱藏時，其他 days 的 preview card。

## 3. 下一階段建議修改哪些 Class / JSX Block

### 優先改 CSS

Phase 3.2 的輕量 polish 建議優先集中在 CSS：

- `.timeline-workbench`
  - 調整地圖顯示時的左右比例。
  - 36% / 64% 先作為假設值，需手動確認後再固定。
  - 左側需保留合理 `min-width`，避免 Day Board 太窄。

- `.timeline-workbench .itinerary-panel`
  - 調整 left Day Board 的 padding、max-height、scroll 體感。

- `.timeline-workbench .side-panels`
  - 調整右側 sticky offset 或未來 map context 外觀。

- `.timeline-workbench .route-map`
  - 放大右側 map / route context。
  - 命名與結構保持 route / map context 方向。

- `.timeline-top-row`
  - Day tabs 保留在 Header 下方原位置，只做間距與 polish。

- `.timeline-column-header`
  - Day Board header 與新增目的地按鈕的對齊、間距可微調。

### 如需改 JSX，需同步 Formal / Demo

若 Phase 3.2 需要改 JSX 外框，優先只碰兩處重複 render path：

- Formal：`TripWorkspace` 中的 `.timeline-top-row` 與 `.content-grid.timeline-workbench`
- Demo：`DemoApp` 中的 `.timeline-top-row` 與 `.content-grid.timeline-workbench`

目前 Formal 與 Demo 的內部 Timeline component 共用程度高：

- 共用 `ItineraryTimeline`
- 共用 `RoutePanel`
- 共用 `MultiDayTimelineColumns`

但外層 workbench JSX 是兩份，因此外框調整要保持 parity。

### 不建議本階段處理

- 不新增 Google Map API。
- 不新增 Timeline Phase 4 的新增交通功能。
- 不改 Transportation card pair logic。
- 不把 Budget summary 放入行程頁。
- 不重構 `TripWorkspace` mounting 策略。

## 4. Demo Timeline Parity

Demo Timeline render path 位於 `DemoApp`。

Demo 與 Formal 相同點：

- 都使用 `.timeline-top-row`
- 都使用 `.content-grid.timeline-workbench`
- 都使用 `isRouteCollapsed` 控制 route/map context 顯示 / 隱藏
- 都共用 `ItineraryTimeline`
- 都共用 `RoutePanel`
- 都共用 `MultiDayTimelineColumns`

Demo 與 Formal 差異：

- Demo 使用 local mock state。
- Demo `ItineraryTimeline` 傳入 `disableDraftAutosave`。
- Demo `ItineraryTimeline` 傳入 `useEditLocks={false}`。
- Demo 不使用 Supabase、Realtime、Storage、Draft Autosave、Edit Lock。

後續改版注意：

- CSS class 改動大多可同時套用 Formal / Demo。
- JSX 外框若調整，需同步 `TripWorkspace` 與 `DemoApp`。
- 不要讓 Demo 接到 production callback 或正式資料流。

## 5. 需要注意的風險

- `TripWorkspace` 目前用 `.hidden-section` 保持其他 section mounted，這是為了保護 active editor guard 和 draft 行為；不要在 Phase 3.2 重構 mounting 策略。
- `ItineraryTimeline` 內含 Draft Autosave、Edit Lock、active editor guard、inline editor、delete confirm、transport warning 等邏輯；本階段只做 layout polish，不應移動 editor lifecycle。
- `.panel` 是全域樣式；若要改 Timeline panel 外觀，應使用 `.timeline-workbench .itinerary-panel` 或更窄 selector，避免影響 Budget、Accommodation、Todo、Luggage 等頁面。
- `.content-grid` 也是通用 class；Timeline 比例應優先用 `.timeline-workbench` 覆寫，不要直接改通用 `.content-grid`。
- `route-collapsed` 目前語意是「route/map context 隱藏」，不是 Day Board collapsed；後續命名或註解要避免誤解。
- 右側區塊未來會串接 Google Map，因此 `RoutePanel` 和 `.route-map` 的改動應保持 route / map context 彈性。
- 36% / 64% 只是目前假設比例，需保留調整空間，等待手動視覺確認。

