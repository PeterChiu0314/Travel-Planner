# 回家接續：只恢復既有預算 UI，保留 Issue #18 模型

## 家中實作結果（2026-11-05，優先於下方待辦文字）

- 已在原分支 pull 到 `4aa1967` 後恢復 UI。`ExpenseWorkspace` 沿用原 CSS、圖示、分類色、純 Stats／PricingSummary／TripRatesSummary 和既有 PricingFields／ItineraryPicker／CollaborationFrame；新 `ExpensePresentation` 只做表格／明細／顯示投影。沒有掛回舊 Budget／Actual／Source 寫入 controller。
- 行前 toolbar 不再出現預算／實付切頁；原搜尋、付款篩選、筆數、新增、五欄分類表、小計／收合、右側三分頁、統計視角／成員負擔／分類占比與原位置 Rates 已恢復。正常 autosave 無技術 banner／成功 Toast；取消／完成回到明細，未成功儲存的草稿仍經既有 Continue／Discard guard。行前已付款項目的實付群組收在編輯器「實付金額與分攤」，與預算群組獨立。
- #18 model／controller／transport／snapshot／SQL 都未修改；安裝 Migration 完整 SHA256 仍為 `8d472812fcecc87b3def9825d85bce8bbe227e5778883649c84e99c693391a50`。NULL 預算顯示未填，不從 paid／Origin 補值；明確0仍計為已填。預算10000/ABC、實付9500/AB、歷史午餐budget NULL/paid800 的隔離 fixture 核對表格／統計與結算分開讀取。
- 驗證：41/41 Node/PGlite 模型／SQL／RLS／controller；40個 distinct Chromium案例，38個首輪通過，另外2個修正測試判定後重跑2/2（整數尾差依成員ID分配，checkbox accessible name包含金額）。涵蓋5個新恢復案例、2個新模型既有案例、3個舊欄位外觀與30個app/Demo/Share smoke。Build／diff通過，既有大bundle提示保留。瀏覽器plugin未提供，使用repository Playwright、static maps與本機隔離SQL；首次sandbox網路拒絕／跨sandbox連線失敗，改用同一原生環境的localhost5175後可驗證。桌面1440x1000截圖已檢視；截圖／trace存於本機visualizations，不提交至repo。
- 模型界線：#18 snapshot只有編輯group lease，沒有selection-only presence。已恢復本機選取列、peer編輯row／field色框、hover／focus姓名提示及peer唯讀底色；不能宣稱已恢復其他人僅選取的提示。恢復後者需要另行協作協定工作，本輪不修改模型或接回舊selection RPC。
- 沒有Hosted業務寫入／Migration／協定開關、Production／main、Receipt／Undo／Source／多筆付款恢復。新UI的真Hosted雙人、合法外幣報價、住宿／結算完整旅程與使用者外觀驗收仍待Preview手測。推送後需核對精確Git SHA的Preview READY；不以本機通過代替部署證據。使用者icon目錄及原有未追蹤檔案保持原狀。

## 使用者最新指示（最高優先）

「回家做，UI給我改回去，我先前都已經設計好。請確保資料模型正確，只改回UI。寫交接文件讓家中codex可以順利接手。」

本機這輪只交接，**沒有修改前端或資料庫**。下一位 Codex 應直接進行 UI 修復，不重新提案或要求使用者重做設計。不要將 #18 的資料模型改版解讀為授權整頁重新設計。

## 起點與目前狀態

- 分支 `codex/budget-collaboration-redesign`；起始程式 Commit `ebad31161bd2ea24f393ebf3cfedd60428bb5a3d`。先確認乾淨工作區並 fast-forward pull 原分支。
- Staging `uyqdopksfysbobhjcepk` 已安裝 Ledger67/head `20261105083233`。不可重播、修改或回退 Migration；Production/main 禁止操作。
- [已安裝模型與手測證據](2026-11-05-issue18-staging-manual-handoff.md)。Preview 已 READY：<https://travel-planner-git-codex-budget-co-6eda5b-peter-chiu-s-projects.vercel.app/>。五個舊協定 ON、Receipt/Undo/fullUndo OFF，保持現狀；不啟 Worker。
- 新增的 `ExpenseWorkspace.jsx` 取代舊工作區，造成不被接受的 UI 改動。舊版 `BudgetWorkspace.jsx`、`BudgetMetadataEditor.jsx`、`BudgetPricingFields.jsx` 與 `budget-page.css` 仍在 repository，可直接參考，不需要從截圖重建設計。
- 使用者未追蹤的 `design/icon-exploration-2026-11-03/` 不得修改或提交；不要同步 key、`.env`、`.tmp`、session。家中可直接使用受保護 Preview 手測，無須搬管理 key。

## 既有 UI 是唯一外觀基準

使用者本聊天第二張圖（TNT Chiu 帳號、右側「旅程統計」）為正確版面；第一張圖（新版「分類／項目／預算金額／狀態」簡表）是要修掉的版本。帳號和資料筆數差異不是需要複製的設計。

1. 行前頁維持原 toolbar：搜尋圖示與搜尋框、全部項目／未付款／已付款篩選、筆數、加號「新增預算」。不要額外加頂部預算／實付切頁或把匯率移到表格上方。
2. 恢復 Day、項目、每人預算 TWD、總額 TWD、狀態五欄；分類帶圖示、色底、筆數、人均與總額小計，保留分類及全部展開／收合。恢復選取列、原本間距、字級、數字對齊、付款標籤與未完成項目呈現。
3. 右側恢復「旅程統計／項目明細／編輯項目」三分頁。選取、切頁、新增、編輯、取消及離開草稿的行為沿用既有設計，不能選取就永遠強制打開編輯。
4. 統計恢復統計視角、人均預估旅費、全旅程預算、各成員預估負擔、分類占比、已付款筆數、原位置的旅程匯率更新。不能拿結算的 balance（付款減應負擔）充當預算分攤統計。
5. 名稱、備註、分類、付款人、行程關聯、計價／分攤沿用原元件和樣式；保留原成員顏色外框、選取／編輯提示。遵守 #17：正常編輯與自動儲存不新增技術狀態或成功 Toast；真正錯誤保留既有去重回饋。無人編輯不可灰化，只有他人編輯才唯讀灰化。
6. 不恢復已刪除的 Receipt、Undo、五步歷史、多筆付款、Source 管理／重關聯或多餘的「編輯完整項目」入口。使用者說恢復 UI，不表示恢復這些已被否決的產品功能。旅程中實付、結算、住宿、Timeline、Luggage 不得重新設計。

## 實作接線：恢復呈現，不能退回舊寫入

| 現在位置 | 下一步 |
| --- | --- |
| `src/App.jsx` 的 `BudgetPage`（約13302行），有 `expenseGraph` 就返回 `ExpenseWorkspace` | 保持新 snapshot／transport 路徑；不要移除此分支以強制退回舊 BudgetWorkspace 的 RPC。 |
| `ExpenseWorkspace.jsx` | 保留 `createExpenseEditor`、handoff/guard、未知 ACK、版本／租約和 payment 執行；替換其簡化 toolbar/table/side 的呈現。可抽取並重用舊 UI 純元件，不再建另一套視覺系統。 |
| `BudgetWorkspace.jsx` 的 `Stats`（約263）、`RecordDetail`（約412）、主 table／右側 tabs（約704後） | 是外觀與互動基準。優先抽出可共用純呈現元件，接新模型；不要整個掛回含舊 Source／Budget/Actual lease controller 的容器。 |
| `BudgetMetadataEditor.jsx`、`BudgetPricingFields.jsx`、`BudgetCollaborationFrame.jsx`、`MenuSelect.jsx`、`ItineraryPicker` | 重用現有呈現；新的 editor 群組仍走 `client.get/view/input/focus/blur/execute`，不可改回舊 RPC。 |
| `expenseSnapshot.js::expenseModels/expenseFinancialSnapshot` | 新模型的讀取投影可供 UI 接線，舊 consumers 形狀只是 read projection，禁止雙寫。不要為了付款 badge 偽造 `budget_item_id`／Source 關聯。 |
| `ExpenseRates.jsx` | 保留新 Rates controller／RPC，只把控制項放回原統計區域與原樣式。 |

舊 `BudgetWorkspace` 的 `actualExpenses.some(expense.budget_item_id===row.id)`、`planningBudgetData`、`payments[]`、Source preview 不能直接複製成新模型判斷。付款 badge 與動作讀同一 item 的 `payment_state`；預估讀 `budget`，實付讀 `paid`，Day 讀同一 item 的 itinerary links。不要為了畫面相同而讓已付款金額覆蓋預算。

## 已確認的模型契約與證據界線

- 一個 expense ID，有可空且獨立的 `budget`／`paid` bundle；至多一筆當前實付。預算10000、實付9500必須並存，改預算不能改已付款金額。
- 參與者以單一 child table 儲存，budget/paid 的 selected、排除決策、份額與版本各自獨立；新模型不建立第二套 Baseline 或 Source。
- NULL=未填，0=明確零元；統計依正確 scope 與完整性計算，不能以零或 paid 補出 budget。使用者已允許舊預算不保留，所以匯入的歷史 Actual 在新模型 `budget:null` 是刻意且正確的資料映射，**不能為了重現截圖10000／21而從舊 Budget 或 Origin 回填**。外觀恢復後資料數值不必和歷史截圖相同。
- 已安裝 Migration SHA256 `8d472812fcecc87b3def9825d85bce8bbe227e5778883649c84e99c693391a50`；`.gitattributes` 對此檔保留原始 CRLF／尾端空行，不能格式化。
- 實際證據：41個模型／SQL／RLS／controller 測試、先前13個 rendered Chromium；Hosted 完整 Forward 回滾試跑後正式套用，Actual8／participants11匯入及原始 Actual／participants／Baseline指紋未變。Preview 真登入完成新增、名稱／TWD100／payer自動儲存與已付款，SQL讀回同一ID。此輪交接再跑41例，結果見最新提交紀錄。
- Hosted 雙人並發、合法不同報價、住宿／結算完整旅程仍未全部驗收；不能宣稱整個模型已通過所有正式環境條件。此次 UI 修復不需為此修改模型或再安裝 Migration。

## 最少驗收與交付

1. 必要閱讀：本文件、`CURRENT_TASK.md`、`AGENT.md`、`DESIGN.md`、`docs/UX_RULES.md`、上方已安裝模型交接。舊 planning/blocked 文件的歷史文字不覆蓋最新安裝狀態。
2. 修改前用新資料 fixture 留下 baseline；恢復 UI 後 desktop screenshot 對照原 toolbar、分類表格及右側三分頁。使用既有 `formalExpenseWorkspace.spec.js` 和舊 `formalBudget*.spec.js` 測試定位適用案例；不要以舊 mock controller 通過冒充新 RPC 驗證。
3. 用**新模型**驗證預算10000／實付9500、budget A/B/C／paid A/B，表格與統計讀 budget、結算讀 paid；NULL顯示未填。測試篩選、折疊、明細／編輯切換、取消、新增／刪除、已付款按鈕、原分攤欄位與協作框。只驗收受影響範圍。
4. 模型／DB不可改；若發現確實需要改模型才可恢復某功能，先完成其他 UI，具體報告差異，不靜默改 schema／金額語意。不要求重新輸入管理 key來做純前端工作。
5. Build、相關 Playwright、必要模型回歸及 `git diff --check`；原分支 Commit／Push，確認 Vercel Preview READY後提供手測網址和完成／未驗收清單。不自行 Production部署或合併 main。
