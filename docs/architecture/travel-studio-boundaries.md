# Travel Studio 架構規範

功能規則由功能 owner 維護。App 協調身份、作用域與跨功能生命週期。下列邊界適用於目前的目錄結構，部分功能仍在 `App.jsx` 內提供實作。

## 責任與公開介面

| Owner | 責任與接點 |
| --- | --- |
| App／`src/app` | 管理 session、active trip/day、membership／權限與 account/trip scope。透過 RequestGuard 與 generation 擋晚到回應，管理跨工作區 Guard、訂閱與清理、refresh、快取與畫面狀態的交接。 |
| Timeline | Editor 管表單、draft、lock、地圖驗證、planner input 與確認。[`timelineEditorForm.js`](../../src/components/timeline/timelineEditorForm.js) 提供初始值、`buildTimelineItemSubmission` 與獨立的 `normalizeTimelineItemPayload`。[`submitTimelineSchedule`](../../src/lib/timelineScheduleService.js) 管 Formal 排程 RPC wire contract，App 管送出時機、Guard、錯誤及刷新。 |
| Luggage | [`readLuggageScope`](../../src/lib/luggageSync.js) 定義 personal 的 trip + owner、shared 的 trip 與共同查詢投影／順序。App 管接收資料的 scope token、訂閱與刷新。既有 [offline envelope](../../src/lib/offlineCache.js) 只容許 shared 行李離線快取，personal 留在目前登入範圍的記憶體。 |
| Todo／Guide | [`formalCommands.js`](../../src/features/todo-guide/formalCommands.js) 管五個寫入 command 與行資料映射。App 供應旅程及版本衝突檢查，維持鎖釋放、錯誤、通知與刷新。 |
| Budget／Expense | Formal 的唯一財務權威是 Native Expense graph。[`ExpenseWorkspace`](../../src/components/budget/ExpenseWorkspace.jsx) 與 [Expense API](../../src/lib/expenseTransport.js) 管編輯和 lease。Timeline、Settlement、Stays 消費 graph 投影。離線 cache 只供顯示，寫入須由已驗證的來源與現有 lease 流程授權。 |
| Map／Route | [Google provider](../../src/components/map/providers/GoogleMapProvider.lazy.jsx) 管點位操作、拖曳與 preview。[`routeOverrides.js`](../../src/lib/routeOverrides.js) 管 segment key、鄰接及節點純轉換。App 管 route 父表／節點 REST、回讀與回復、Broadcast／Realtime，以及 Timeline 端點座標或鄰接變更後的失效處理。 |
| Trip／Members | Trip/Members 定義日期、身分、角色的操作。App 管准入、確認、Guard 與刷新。日期變更、旅程刪除與成員異動的跨域一致性由既有資料庫原子交易維持，例如 `apply_trip_date_change`、`delete_trip_with_expenses` 與成員異動觸發器。 |
| Stays | [`AccommodationPanel`](../../src/components/AccommodationPanel.jsx) 管住宿表單，由 App 接線至住宿 CRUD。住宿可保存自己的 `expense_id` 關聯，支出候選與名稱只讀 Expense graph。 |

## 依賴與變更護欄

- App 透過具名 command、query、event 或 callback 接功能。功能間使用這些介面或共用純 helper。Feature 禁止反向 import App、讀寫另一個功能的私有 state，或循環依賴。
- 每份權威資料及編輯狀態各有一個 owner，衍生畫面用 selector。Formal 使用具 session、trip 與權限驗證的伺服器資料，Demo 使用自己的記憶體／fixture。兩者可共用純邏輯。
- 先重用既有 owner 和入口。只有能收斂決策或減少實際重複才抽取。避免預設增加 service/controller/hook 層、store 或第二份 cache。
- 變更若牽涉 Guard、RequestGuard、Draft、Lock／lease、Realtime、權限與回應順序，須明列語意和驗收。SQL／RLS、RPC wire contract 與 link-safe 原子交易的變更另行審核。排程與費用連結維持同一原子提交。

## 新需求改哪裡

| 需求 | 實作落點 |
| --- | --- |
| 新增 Timeline visit／transport 欄位 | 先檢查 Editor 輸入與 `timelineEditorForm.js` 的初始值、提交、正規化。只有欄位影響時間規則時才改 planner。若需持久化新欄位，另核對一般 CRUD 與 link-safe RPC 的 `target_payload`／SQL 對應。App 保留呼叫與 Guard。 |
| 改 Budget 計算或付款 | 先找 Expense 功能與純投影或 group 模組。若改 canonical 金額、付款、分攤或驗證，同步評估後端交易及權限。App 傳遞 scope、快照與刷新，消費者讀權威投影。 |
| 改 Map 路線點位 | 點位互動與 preview 放 Google provider。段與節點的純資料規則放 `routeOverrides.js`。持久化、跨人同步與 Timeline 失效由現有 App 接點協調。資料格式或 RLS 變動另案。 |
| 改旅程日期或成員 | Trip/Members 管輸入和操作契約。App 協調確認、作用域、草稿與刷新。日期縮短、Expense link 和成員離開造成的跨表異動由既有 SQL/RPC 或觸發器維持原子性。 |

## Phase 2B 跨功能耦合

| 分類 | 邊界與後續 |
| --- | --- |
| 已消除 | [#55](https://github.com/PeterChiu0314/Travel-Planner/issues/55) 的 Todo/Guide 表名與寫入映射進功能 commands。[#58](https://github.com/PeterChiu0314/Travel-Planner/issues/58) 的 personal/shared 兩個完整載入查詢與 scoped refresh 共用 `readLuggageScope`。[#60](https://github.com/PeterChiu0314/Travel-Planner/issues/60) 的 11 個 RPC 頂層鍵由排程 service 管理。[#65](https://github.com/PeterChiu0314/Travel-Planner/issues/65) 將 Editor 提交與保存正規化集中成兩個純入口。Formal save、Demo save、Demo 備案切換保留三個正規化接點。 |
| 刻意保留 | Timeline 的 Editor／Modal、Guard、Draft、Lock、Map 與保存順序是既有生命週期。Route 的 REST、Broadcast/Realtime 與 Timeline segment invalidation 需要相同 scope、回讀與復原。單獨抽一段讀取的收益有限，[#61](https://github.com/PeterChiu0314/Travel-Planner/issues/61) 採零 Diff。Expense 顯示回填與 full reload envelope 交接各有驗證時機，保留 graph revision、TTL、A → B → A generation、lease 與 Settlement/Stays 投影，避免模糊快取權威，[#62](https://github.com/PeterChiu0314/Travel-Planner/issues/62) 採零 Diff。 |
| 延後，依問題另開 Issue | [`loadTripData`](../../src/App.jsx#L2236) 仍同批讀多表，功能刷新影響範圍較大。待出現可重現的延遲、錯誤互相拖累或過量讀取，再評估 scoped refresh。日期縮短清理用 [`entityType: "timeline"`](../../src/App.jsx#L4104-L4113)，Editor 的 [draft entity 為 `itinerary_item`](../../src/App.jsx#L7924)。若重現清理問題，交由 Timeline 草稿契約處理。[成員移除](../../src/App.jsx#L5045-L5064) 以 `luggageErrorMessage` 映射部分錯誤，適合在有錯誤語意需求時交還 Trip/Members。這兩處是私有契約耦合。 |
| 延後，獨立產品決策 | [#64](https://github.com/PeterChiu0314/Travel-Planner/issues/64) 裁定 Stays 離線時能否新增或變更 Expense 關聯。現有程式可讀到離線 graph，正式環境的產品錯誤尚未確認。 |

Phase 2B 已為四個切片建立具名介面。App 仍承載 Editor 與跨工作區載入，剩餘耦合按可維護性和實際影響追蹤。
