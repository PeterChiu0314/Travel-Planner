# Travel Studio 架構規範

[App.jsx](../../src/App.jsx) 決定入口。Demo 直接掛載 [DemoApp](../../src/demo/DemoApp.jsx)，公開分享由 [PublicShare](../../src/components/share/PublicShare.jsx) 讀取唯讀快照。正式入口 [FormalWorkspace](../../src/app/FormalWorkspace.jsx) 管登入、旅程選取、權限、導航與跨頁編輯交接，[TripWorkspace](../../src/app/TripWorkspace.jsx) 將目前旅程和各功能的具名操作交給畫面。

## 資料與協作的責任

| 功能 | 維護入口與契約 |
| --- | --- |
| 工作區資料 | [useTripDataLoad](../../src/app/useTripDataLoad.js) 並行發出十項功能查詢，保留原有整批錯誤與離線回填策略。帳號、旅程、generation 與讀權均有效時才能接收結果。[useTripSubscription](../../src/app/useTripSubscription.js) 管旅程資料表通知，[useTripPresence](../../src/app/useTripPresence.js) 管成員位置。 |
| Timeline | [ItineraryTimeline](../../src/components/timeline/ItineraryTimeline.jsx) 組合日欄、卡片、選取與編輯器。[useTimelineEditor](../../src/components/timeline/useTimelineEditor.jsx) 持有同一次編輯的 draft、lock、備案、地圖驗證及提交確認；[欄位畫面](../../src/components/timeline/timelineEditorFields.jsx) 讀取此 session。[useTimelineReorder](../../src/components/timeline/useTimelineReorder.js) 管拖曳與預覽。Formal 寫入走 [formalTimelineCommands](../../src/features/timeline/formalTimelineCommands.js)，Demo 走 [本地操作](../../src/demo/timelineCommands.js)。 |
| Route | [useRouteWorkspace](../../src/components/map/useRouteWorkspace.js) 持有自訂路段、節點保存與回讀、Broadcast、失敗回復及端點失效。工作區在接受新行程資料時呼叫 `invalidateChangedEndpoints`。地圖 provider 持有拖曳中的畫面預覽。 |
| Expense／Settlement／Today | [useExpenseSnapshot](../../src/features/expense/useExpenseSnapshot.js) 接收獨立的財務讀取。Native Expense graph 是金額、付款和關聯的唯一權威。Budget 經 [ExpenseWorkspace](../../src/components/budget/ExpenseWorkspace.jsx) 編輯；Settlement、Stays、Today 與 Timeline 使用投影。離線 graph 只供顯示。 |
| Trip／Members／交換 | [TripHeader](../../src/components/trip/TripHeader.jsx) 管日期和標題操作介面。[tripCommands](../../src/features/trip/tripCommands.js) 協調日期 Guard、[Timeline draft 契約](../../src/components/timeline/timelineDrafts.js) 與原子 RPC。[memberCommands](../../src/features/members/memberCommands.js) 管成員及邀請，[exchangeCommands](../../src/features/trip-import/exchangeCommands.js) 管預覽、確認匯入、匯出與 AI 交換。 |
| Stays／Todo／Guide | 住宿 [formalStays](../../src/features/stays/formalStays.js) 與待辦指南 [formalCommands](../../src/features/todo-guide/formalCommands.js) 管表名、欄位與查詢順序。各自的 actions 接入共用 scope、衝突檢查及刷新。 |
| Luggage／Pack／附件 | [行李操作](../../src/features/luggage/luggageCommands.js) 與 [局部刷新](../../src/features/luggage/useLuggageRefresh.js) 分別處理 personal/shared 契約，private rows 僅留在目前帳號記憶體。Pack 與附件各自管理讀寫。[Pack](../../src/features/pack/packCommands.js) · [附件](../../src/features/attachments/attachmentCommands.js) |

## 新需求改哪裡

- **Timeline 欄位**先改欄位畫面與 [timelineEditorForm.js](../../src/components/timeline/timelineEditorForm.js) 的初始值、提交與保存正規化。若時間規則有變，再改 planner。排程與 Expense links 維持同一個原子提交。
- **Budget 計算**先找 Expense 功能與 [expenseSnapshot.js](../../src/lib/expenseSnapshot.js) 的投影；canonical 金額、付款與分攤規則由資料模型及後端交易共同決定。
- **Route 點位**的互動在 Google provider，segment key、鄰接和節點轉換在 [routeOverrides.js](../../src/lib/routeOverrides.js)，跨人同步與回復在 Route workspace。
- **Trip 日期或成員**從 TripHeader／Members 對應命令進入。跨表一致性由既有 RPC 或 trigger 保證。日期縮短成功後才依縮短日期所移除的行程 ID清理 Timeline 草稿。

功能透過具名查詢、命令或 callback 溝通。功能模組不得反向 import 應用入口。新增功能內部欄位或 UI state 時，優先放在既有 owner；跨頁交接、帳號切換及整批讀取的接收順序仍由旅程工作區協調。Demo 共用畫面與純轉換，所有保存由自己的記憶體資料來源執行。

[#64](https://github.com/PeterChiu0314/Travel-Planner/issues/64) 的 Stays 離線 Expense 關聯是獨立產品決策。修改快取權威、SQL/RLS、RPC 或協作語意時，須另列行為變更及驗收。
