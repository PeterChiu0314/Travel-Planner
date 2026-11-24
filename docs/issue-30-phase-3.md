# Issue 30 Phase 3 樣式與舊程式盤點

基準為 main 的 `5fead3e`。src/main.jsx 載入 App 與 AppToaster 後載入 styles.css，接著是 budget-page.css。Workspace、Luggage、Toaster 也各自由元件引入既有 CSS。

| 範圍 | 證據與處理決定 |
| --- | --- |
| 匯入旅程預覽板 | TripImportPreviewBoard.jsx 建立預覽板、地圖 OverlayView 節點及封面。樣式集中在 styles.css 的 6264–6417 行，另有 720px 和 480px 斷點。將這些選擇器整組移到元件旁，保留順序和斷點。 |
| 通用對話框與 AI 匯入 | 後段的 .dialog-card p 與 .ai-exchange-heading p 同權重，移動會影響實際文字顏色及行高。保留殼層、表單、標題與全域響應式排列。 |
| Timeline、Route、分享、成員與行李 | 桌面高度、1100px、720px 等區塊混有共用布局。成員頭像與操作按鈕亦由 TripHeader、待辦及工作區使用。保留原位置及已有的獨立樣式檔。 |
| 色彩別名 | 全庫只有宣告提及 --coral、--sky。執行時讀寫 CSS 變數的地方只讀行李尺寸、寫 Timeline 捲軸寬度。移除這兩項，保留仍在使用的 --mint、--mint-dark 及中性色。 |
| JS/JSX | 從 main.jsx 追蹤相對 import（含地圖動態載入）後，再核對測試入口和檔案內容。MembersPanel.jsx、PackList.jsx 只有未匯出的區域函式，無模組層級副作用、匯入者或呼叫點。刪除兩檔與舊 PackList 專用樣式。保留 MembersInviteDialog 共用的成員樣式及正式打包資料流程。 |
| 測試與相容程式 | BudgetWorkspace 是 budget-safety 測試入口，Google Routes adapter 也有獨立測試。保留這些模組和停用的收據流程。 |
| 匯入提醒 | TripImportNotices 的提醒清單只渲染文字。移除 .trip-import-issues code。錯誤詳細資料在另一個容器實際渲染 code，保留其規則。 |
