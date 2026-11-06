# 支出狀態與舊「未完成項目」顯示清理

使用者明確指示：沒有所謂「未完成項目」，名稱旁不得加此標籤；付款狀態顯示未付款／已付款；移除編輯欄位間分隔線。

- 新ExpenseTable：移除名稱後綴，draft與unpaid均顯示「未付款」，paid顯示「已付款」。ExpenseWorkspace移除上方計數提示。
- 查到舊BudgetWorkspace仍有3處殘留：上方筆數、名稱後綴、明細提示。前兩者移除，明細改為「金額尚未填寫」。新舊工作區均不再顯示「未完成」作為項目標籤。
- 共用metadata-group移除border-bottom，保留原padding／gap／輸入欄邊框。
- 全src搜尋的其他「未完成」是失敗訊息、待辦與行李狀態，與財務項目標籤不同；不刪除其他模組文案。內部record_status/incomplete等舊相容判定及draft付款狀態仍供金額完整性／原子付款驗證，不向使用者呈現為第三種項目狀態；未改DB／RPC／既有金額／空值與零的區別。
- 舊文件／archive與歷史測試的原接受文字不是目前產品規則；本文件及最新使用者指示優先。未重寫舊migration、刪除項目、補零或強制已付款。

驗證：使用既有Playwright/static maps/PGlite測試新建、只填名稱、已付款／未付款、原UI、Demo與統計。首次誤納入歷史budget-page套件，其首例仍期待舊Demo32列，在新Demo不適用；停止該歷史套件，改執行現行新模型套件，結果於本輪完成後記錄。Build／diff Passed，既有bundle提示保留。Production/main不動，沿用使用者明確授權推送原分支。

現行17/17 Chromium Passed：Demo7、creation5、restore5；只填名稱項目的desktop截圖已檢視，名稱無後綴、狀態為「未付款」、上方無「未完成」筆數。原financial Null/paid-only、10000/9500、草稿與分攤案例均通過。最終src財務UI搜尋僅餘操作失敗／取消未完成操作等文案，沒有「未完成項目」標籤；原舊歷史測試仍有先前文案斷言，不能作為新產品規則。
