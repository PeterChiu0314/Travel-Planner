# Issue #23 全域編輯保護與跨頁交接

基準為 `codex/budget-collaboration-redesign` 的 `407499b`。支出工作區切頁後仍掛載。Timeline 原先把已登記的乾淨 Guard 當成未儲存內容，停用了有時間與未排時間卡片的拖曳把手。旅程日期已在基準版本改查未儲存內容。付款時間表單的 Guard ID 最後一段是支出 ID，原本會被旅程查詢漏掉。

## Guard 清單

| 註冊位置 | 作用範圍與狀態 | 交接與影響 |
| --- | --- | --- |
| [App.jsx · Timeline](../src/App.jsx#L10410) | 行程編輯器開啟時登記，以表單原旅程與修改狀態判斷 | 乾淨表單可關閉並釋放原權限。開啟的 Timeline 編輯器仍會阻擋同頁拖曳。 |
| [App.jsx · 住宿](../src/App.jsx#L13604)、[待辦](../src/App.jsx#L14078)、[指南](../src/App.jsx#L14347) | 開啟的表單依原旅程登記 | 新增或編輯會交接。切換同頁表單時確認該編輯器自己的草稿。 |
| [App.jsx · 行李快速新增](../src/App.jsx#L14560)、[個人與共用編輯](../src/App.jsx#L14701) | 個人與共用快速草稿獨立。既有項目依編輯器原旅程登記。 | 保留行李拖曳、指派、移轉對兩種快速草稿的既有排除，避免為獨立草稿擋下拖放。跨頁或換旅程仍會保護這些草稿。 |
| [ExpenseWorkspace.jsx](../src/components/budget/ExpenseWorkspace.jsx#L65) | 依帳號與旅程登記，分開讀取草稿、寫入／未知回執、可清理的空草稿或租約 | 預算內部切換、付款、刪除仍可要求清理。其他頁面不會因乾淨租約釋放失敗被擋下，既有 blur、suspend 與重試仍處理租約。 |
| [ExpenseRates.jsx](../src/components/budget/ExpenseRates.jsx#L10) | 依帳號與旅程登記，匯率操作與未確認請求阻擋，已知結果只剩租約釋放時屬清理 | 保留更新前交接與原請求重試。預算內部操作仍可等待匯率租約清理。 |
| [BudgetMetadataEditor.jsx](../src/components/budget/BudgetMetadataEditor.jsx#L48)、[BudgetSourceEditor.jsx](../src/components/budget/BudgetSourceEditor.jsx#L27) | 舊群組依紀錄旅程登記，分開標記草稿與待確認操作 | 先嘗試既有 autosave。保留群組切換、完整編輯與來源操作的防護。 |
| [BudgetWorkspace.jsx · 表單](../src/components/budget/BudgetWorkspace.jsx#L186)、[付款時間](../src/components/budget/BudgetWorkspace.jsx#L355) | 完整編輯表單依開啟時的旅程，付款時間依紀錄的旅程 | 付款時間即使 ID 包含旅程和紀錄兩段，離頁仍會提示。按更新仍用原本的單欄付款 RPC。 |
| [BudgetWorkspace.jsx · 匯率](../src/components/budget/BudgetWorkspace.jsx#L494)、[來源與付款](../src/components/budget/BudgetWorkspace.jsx#L559)、[App.jsx · 舊匯率與生命週期](../src/App.jsx#L13288) | 旅程層的寫入中或待確認操作 | 保留原 prepare/retry 契約及不可任意捨棄的判斷。沒有依 Guard ID 前綴辨認操作。 |

## 入口與行為

- [登記與查詢](../src/App.jsx#L543)使用明確旅程及工作區。元件實例擁有自己的註冊 key，卸載只會移除該實例。資源 ID 只用於包含或排除指定編輯器。重新整理／關閉分頁會檢查目前分頁所有未處理的編輯。
- [草稿處理與交接](../src/App.jsx#L586)只對 Dirty 或 Pending 的 Guard 嘗試處理寫入。失敗才沿用原對話框，儲存或捨棄仍以各控制器結果為準。乾淨表單有實際關閉需求時才交接。乾淨的支出、匯率和舊群組租約清理可在預算內部阻擋，離開時由既有控制器生命週期處理。
- [頁面與旅程](../src/App.jsx#L2401)共用交接與旅程世代檢查。涵蓋正式側欄、底部導覽、回到總覽、設定、旅程總覽捷徑與成員位置捷徑，以及旅程選擇。手動建立旅程先完成目前旅程的交接。邀請加入、身分撤銷、登出仍走既有帳號／資料生命週期。
- [日期](../src/App.jsx#L4991)維持 Dirty／Pending 與本機草稿防護。 [Timeline](../src/App.jsx#L10420)訂閱同旅程未處理狀態，並在拖放與確認提交重查。保留 dnd-kit、固定行程、同日協作 Presence、交通、Planner、完整清單與版本檢查。
- 原調查確認拖曳誤擋及付款時間範圍判斷錯誤。乾淨租約拒絕的情境由本次瀏覽器測試注入驗證。其餘模組的 clean/dirty 風險屬受影響候選，依實際測試結果列證。

## 支出關聯限制

隔離 SQL 已確認，有時間行程重排會交換時段上的景點內容，既有 RPC 只搬移舊的預算關聯。前端提交前讀取最新支出快照，遇到會換時段且已有新版支出關聯的景點會提示並停止。未排時間排序及不交換景點內容的移動可用。此檢查與排程寫入之間仍有另一個分頁新增關聯的競爭窗口。完整修復需要伺服器在同一交易驗證或搬移新版關聯，超出本 Issue 的前端範圍。刪除有支出關聯的卡片、縮短旅程、刪除旅程，以及預算快照錯誤影響整趟資料載入均獨立於本次 Guard 修正。

## 回歸證據

- [正式介面整合測試](../tests/formalEditorHandoff.spec.js)掛載新版 ExpenseWorkspace 與 ExpenseRates，再切到 Timeline。原始 `407499b` 兩種卡片都找不到拖曳把手。修復後以真實滑鼠拖放執行有時間與未排時間排序，確認各只有一次排程 RPC，並檢查隔離 PostgreSQL 儲存的順序與重新整理後的畫面。已關聯支出卡片的時段交換會提示，且沒有排程寫入。
- 同組測試覆蓋乾淨租約拒絕、同旅程未命名草稿、確認中與未知建立回執、原請求 ID 重試只建立一筆，以及切換旅程隔離。乾淨租約拒絕後仍可開啟 Timeline、住宿、待辦及指南的編輯入口。行李透過兩個原 RPC 完成拖曳指派、轉回個人及持久化，備註保留。[日期](../tests/formalTripDateGuard.spec.js)保留空白可修改、草稿和未知回執會阻擋。[舊付款時間](../tests/formalBudgetPaymentGroups.spec.js)覆蓋 ID 含多段時的離頁保護及原更新操作。
- Playwright 各批次有重疊。地圖、日期與新增交接測試批次 101/101，Timeline 主要 UI 冒煙 30/30。排程、行李與新版支出批次 179/180，唯一失敗是舊色碼字串斷言，原始 `407499b` 已改用共用色盤。支出 Node／SQL 測試 88/88。Vite build 與 diff check 通過。
- 舊預算、行李與 Demo 工作區批次初跑 86/92。五項既有 UI 斷言在 `407499b` 同樣失敗，分別為兩項舊協作者提示可見性、Demo 舊回復測試接口、住宿舊預算欄位及結算舊基線文字。第六項為舊群組空閒租約的模擬時鐘測試，隔離重跑原版與新版各 3/3 通過。另七項舊付款測試通過，三項舊匯率／定價提示的失敗亦在原版重現。
- Browser plugin 不在此工作階段，使用本機 Chromium Playwright、static maps 與隔離資料庫。帳號、旅程與資料均為測試 fixture。未把各工作流的四種狀態做完整交叉排列，也未在 Hosted 資料上操作 CRUD 或模擬多人寫入競爭。Preview 供實際帳號手動驗收。
