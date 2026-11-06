# Issue #20 — 單一協作色框與頭像群組

在原分支實作新模型共用的 `ExpenseTable`。每列最多一個協作 outline；實際編輯者優先，否則取最新 genuine selected_at，時間相同以既有 user ID 排序穩定決定。同帳號多個群組／分頁只顯示一位；不把選取當成租約。沿用既有 account palette。

Hover／鍵盤 focus 僅顯示重疊圓形頭像：最多4位，其餘 `+N`；有既有 avatar_url 就使用，否則用姓名縮寫，圖片失敗也回退縮寫。沒有姓名清單、狀態字、額外姓名 title 或操作。提示從目前 collaborators 推導，開啟時加入／離開也即時更新；最後一人離開則消失。focus 後移開滑鼠仍保留提示，捲動／resize 重定位，Escape 關閉。

只改新 ExpenseTable 的清單呈現；欄位群組原姓名提示與舊 Production compatibility 工作區保持原狀。DB／RLS／RPC／lease／autosave／財務與 #19 建立流程未改，無 migration 或 Hosted 財務寫入。使用者 icon 目錄不動。

## 驗證

- Browser plugin unavailable，使用 repository Playwright、既有 PGlite 隔離 SQL 與 localhost5175 static map provider；未新增依賴。首次未設 PGLITE_MODULE，測試未進入業務流程；設定現存 runtime 後重跑。首次 Google provider 被 sandbox 阻擋的 resource error，以測試 server static provider 排除，未忽略 console error。
- 6/6 collaboration Chromium Passed：1～4人、5人+1、最新選取／編輯優先、同帳號分頁去重、即時離開、workspace hidden／返回、快照離線恢復及原Rates。修正新窄版 focus 測試揭露的自動捲動提示消失後整批6例通過。
- 桌面1440×1000與窄版390×844截圖已檢視；頭像提示未溢出或改動表格幾何。截圖／trace 在外部本機 visualizations，無提交。
- 額外14/14新模型 Chromium regression Passed：#19建立／未知ACK、原UI／篩選／草稿、成員決策、歷史空分攤、10000／9500與paid-only。共20個distinct案例通過，qaErrors均空。Build／git diff --check Passed，既有 bundle size warning 保留。Preview狀態待原分支推送後核對。

## 交付界線

原分支推送、核對精確 SHA Preview READY 後交使用者手測。真實 Hosted ordinary-JWT／WebSocket 多人驗收尚未重跑；隔離 SQL-backed 瀏覽器測試不能代替此項。#20 保持 Open，不新增 GitHub 留言、不操作 Production／main。

首次自動審核在執行前拒絕 combined commit/push，使用者隨後明確允許提交並推送至 `PeterChiu0314/Travel-Planner` 原分支。現在依該授權提交／推送並核對新 Preview；先前 `284051a`／READY／target:null 僅為#19部署證據。
