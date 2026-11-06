# Issue #20 — 單一協作色框與頭像群組

在原分支實作新模型共用的 `ExpenseTable`。每列最多一個協作 outline；實際編輯者優先，否則取最新 genuine selected_at，時間相同以既有 user ID 排序穩定決定。同帳號多個群組／分頁只顯示一位；不把選取當成租約。沿用既有 account palette。

Hover／鍵盤 focus 僅顯示重疊圓形頭像：最多4位，其餘 `+N`。依使用者2026-11-06截圖修正，圓圈由28px縮至22px，每人只顯示名稱第一字元（英文字母大寫），不顯示相片；移除群組外層白色背景、邊框、陰影與padding，僅圓圈保留1px分隔細邊。沒有姓名清單、狀態字、額外姓名 title 或操作。提示從目前 collaborators 推導，開啟時加入／離開也即時更新；最後一人離開則消失。focus 後移開滑鼠仍保留提示，捲動／resize 重定位，Escape 關閉。

只改新 ExpenseTable 的清單呈現；欄位群組原姓名提示與舊 Production compatibility 工作區保持原狀。DB／RLS／RPC／lease／autosave／財務與 #19 建立流程未改，無 migration 或 Hosted 財務寫入。使用者 icon 目錄不動。

## 驗證

最新位置精修：依使用者截圖，頭像群組改在協作框左下方，第一個圓圈左緣對齊實際 outline 的左緣，下方間距2px；hover／focus與捲動重定位使用同一個outline幾何，不再依整列左緣或固定上移量估算。

編輯欄位修正：使用者指出色框錯框整個群組。移除共用BudgetCollaborationFrame的absolute群組overlay，改用display:contents的控制項容器傳遞既有owner色，直接上色input／textarea／選單／計價模式按鈕邊框，checkbox／radio使用同色accent。標籤與padding不畫框；唯讀、租約與原姓名提示不變。適用新Expense與舊共用editor，未動RPC或權限。

後續提示／模式精修：姓名提示改以實際input／textarea／選單為錨，提示底部距輸入欄上緣4px，不再從含label/padding的群組往上35px。計價模式在未聚焦時因fieldset disabled而使用瀏覽器淡字；新Expense模式選項在有效可編輯、無peer租約／衝突／未確認請求時可直接選，單次點擊先等待原client.focus取得權限，再以最新view值轉換模式；失敗不改資料。其他財務輸入仍沿用原權限保護。非選中模式明確使用正常文字色。

本次21/21 Chromium Passed（前述20例及新增「未先點側欄直接切自訂分攤／peer仍被阻擋」SQL-backed案例）；Build／diff Passed，desktop提示貼近input截圖已檢視，console errors空。未重做Hosted ordinary-JWT／WebSocket驗收。

此修正20/20 Chromium Passed（metadata appearance3、Issue17 6、native collaboration6、UI restore5），Build／diff Passed。桌面peer輸入框色邊截圖已檢查，無群組色框，原只讀與姓名提示正常；Browser plugin未提供，沿用Playwright/static maps/隔離SQL。上一筆左下頭像提交79da775精確SHA Preview已READY。

- Browser plugin unavailable，使用 repository Playwright、既有 PGlite 隔離 SQL 與 localhost5175 static map provider；未新增依賴。首次未設 PGLITE_MODULE，測試未進入業務流程；設定現存 runtime 後重跑。首次 Google provider 被 sandbox 阻擋的 resource error，以測試 server static provider 排除，未忽略 console error。
- 6/6 collaboration Chromium Passed：1～4人、5人+1、最新選取／編輯優先、同帳號分頁去重、即時離開、workspace hidden／返回、快照離線恢復及原Rates。修正新窄版 focus 測試揭露的自動捲動提示消失後整批6例通過。
- 使用者頭像精修後，同6例重新通過，Build／diff Passed，桌面截圖確認只有22px單字母圓圈、無外層白方框。未重跑不受此呈現修改影響的14例。
- 桌面1440×1000與窄版390×844截圖已檢視；頭像提示未溢出或改動表格幾何。截圖／trace 在外部本機 visualizations，無提交。
- 額外14/14新模型 Chromium regression Passed：#19建立／未知ACK、原UI／篩選／草稿、成員決策、歷史空分攤、10000／9500與paid-only。共20個distinct案例通過，qaErrors均空。Build／git diff --check Passed，既有 bundle size warning 保留。Preview狀態待原分支推送後核對。

## 交付界線

原分支推送、核對精確 SHA Preview READY 後交使用者手測。真實 Hosted ordinary-JWT／WebSocket 多人驗收尚未重跑；隔離 SQL-backed 瀏覽器測試不能代替此項。#20 保持 Open，不新增 GitHub 留言、不操作 Production／main。

首次自動審核在執行前拒絕 combined commit/push，使用者隨後明確允許提交並推送至 `PeterChiu0314/Travel-Planner` 原分支。原#20提交 `fa7a7d1` 已推送，精確SHA Preview `dpl_Ds78UNJJqmCYVxs1bWPPnZ5RCryw` 已確認 READY／target:null。上述頭像精修另依同一授權推送原分支並核對Preview；不更動Production／main。
