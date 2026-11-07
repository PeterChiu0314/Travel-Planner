# Issue #24 正式站與 Preview 差異回歸

比較基準為正式站 `85a7209` 和 Preview `9525ace`。本機用各版程式碼、隔離資料和相同操作比對，部署目標為原功能分支的 Staging Preview。[Issue 主文](https://github.com/PeterChiu0314/Travel-Planner/issues/24) · [A／B／C 補充](https://github.com/PeterChiu0314/Travel-Planner/issues/24#issuecomment-6705077817)

| 分類 | 重現與前後差異 | 修正與證據 |
| --- | --- | --- |
| A · Confirmed regression | 乾淨瀏覽器中，讓首個支出讀取遇到 RPC 不存在、`42501`、網路拒絕或逾時。舊版顯示表格及全域重試通知。原 Preview 的錯誤狀態因空快照 ID 被濾掉，頁內停留在「讀取支出項目…」。有資料後遭 `42501` 也仍顯示先前的列。 | 讓成功與失敗都跟隨帳號、旅程與請求世代。首次失敗顯示「重新讀取支出」，讀回伺服器快照才恢復編輯。拒絕存取時隱藏舊資料、清除該快取並保留草稿。見 [App](../src/App.jsx#L2480) 和 [瀏覽器測試](../tests/expenseReadRecovery.spec.js)。 |
| B · Confirmed regression | 舊版提交後即送出旅程 INSERT。原 Preview 在提交後等匯率。攔住匯率並提交兩次，回應前零筆，讓匯率以 503 結束後得到兩筆不同 ID 的 INSERT。另重現切換帳號後舊提交嘗試寫入。 | 開啟表單後在背景抓匯率。提交立即使用當時仍有效的同來源報價，缺報價時可建立，行前預算頁沿用既有自動初始化。表單顯示「建立中…」，同步鎖阻止重複提交，帳號與旅程切換會使舊交接失效。同樣的延遲與 503 測試在匯率仍未回應時送出一筆，第二次沒有送出。見 [建立流程](../src/App.jsx#L4785) 和 [測試](../tests/formalExpenseCollaboration.spec.js#L13)。 |
| C · Confirmed regression | 先載入一筆支出再重整，讓住宿等資料先成功、支出 RPC 稍後失敗。舊版等財務讀取後才寫共用快取，失敗時保留原快取。原 Preview 在住宿出現時已將有效的支出快取覆蓋。 | 核心資料更新沿用同帳號、同旅程的有效支出快取，保留原到期時間。慢讀失敗後快取僅供檢視，恢復權威讀取後才可編輯。見 [快取寫入](../src/App.jsx#L3235)、[快取期限](../src/lib/offlineCache.js#L17) 和 [瀏覽器測試](../tests/expenseReadRecovery.spec.js#L68)。 |
| Confirmed pre-existing | 同一旅程 Day 2 有景點。注入財務 RPC 不存在時，舊版 Today 的「看行程」能切到 Day 2，但行程資料未載入。全域通知可重試財務。 | 修正後的 Preview 在相同故障下也進 Day 2，且顯示原景點。住宿和行李亦獨立載入。 |
| Intentional change | 兩版用相同 Guide 草稿點「新增待辦」。舊版要求先處理 Guide，Preview 可同時保留兩份草稿。 | 沿用 #23 的 Guide／Todo 範圍。住宿 `expense_id` 和新版分帳投影也沿用 #23 契約。 |

已跑定向 Chromium、Node／隔離 SQL、Build 和 diff 檢查。Timeline 的 `PGRST202` 與網路不確定回應測試各觀察到一筆原子排程呼叫，卡片與支出關聯一致。回歸範圍也涵蓋擁有者刪除、日期縮短、換旅程、租約與連線恢復、帳號隔離、住宿／待辦／指南／行李和分帳。Google 無 API key 與路線 override 使用現有測試。故障注入與並發寫入的證據來自隔離環境，Hosted 的這些故障情境與雙帳號 Realtime 為 **Unverified**。#23 的既有手測沿用 Issue 紀錄。

一個 Phase 2.2 靜態測試仍要求 `selectTrip` 內的舊 Guard 字串。固定 Preview 基準已改用 `navigateWithEditorHandoff`，該字串當時就不存在。實際換旅程與草稿交接已用瀏覽器驗證。
