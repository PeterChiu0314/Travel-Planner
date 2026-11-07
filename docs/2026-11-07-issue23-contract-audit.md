# Issue #23：Guide/Todo 範圍與旅程回執清理查核

## 結論與交付界線

使用者指出的兩點均成立。既有 #23 測試未覆蓋 Guide/Todo 同頁雙草稿，也未在刪旅程案例建立任何 native 回執；先前通過的拖放、刪卡、日期縮短證據不能證明這兩個契約正確。本次本機補修並回歸，沒有推送、重新部署或安裝 Hosted migration。大型 App 拆分仍未執行，不能將此查核稱為全面模組重構或所有跨模組問題已清零。

## 編輯所有權契約

Guard registry 已按 tripId/workspace 篩選，但 GuidePanel 的註冊、openNewGuide、openEditGuide 三處誤用 todo。Guide 與 Todo 在同一畫面掛載，因此新增另一功能的項目會交接原功能草稿，包含乾淨表單被關閉及 dirty 草稿被要求處理。

本次 Guide 三處改為 guide，Todo 保持 todo。另查出 Demo 的離頁、換旅程、回登入以 activeSection 當 workspace，若只改 Guide 字串，離開 todo 頁就會漏掉 guide 草稿。三個生命週期入口改用整個離開旅程的 Guard，與正式 App navigation 相同。預算 reset/scenario 仍限 budget。

| 範圍 | 所有權／預期行為 | 本次查核 |
| --- | --- | --- |
| Timeline 同功能入口、日期許可 | timeline；日期只攔 Timeline 真草稿 | 保持；日期 Dirty/Unknown Budget 回歸通過 |
| Guide / Todo 同頁新增、編輯 | guide / todo 各自交接 | 修正 Guide 三處；雙向獨立草稿通過 |
| Accommodation 同功能入口 | accommodation | 未改；跨頁/換旅程既有測試通過 |
| Luggage 新增、指派、移轉 | luggage | 未改；正式介面指派/移回與乾淨 Budget 故障隔離通過 |
| Budget、Rates、Lifecycle | budget | 未改；Dirty/Pending/Unknown 與相同 request 重試保護通過 |
| 切頁、換旅程、離開 App | 正在離開的整趟旅程 | Demo 補正；兩個同頁領域的草稿都必須受保護 |

新 UI 測試涵蓋兩個順序（Todo→Guide、Guide→Todo）、同功能再次新增仍提示、取消切頁／換旅程保留兩份值，以及選儲存後兩份資料都保留。正式與 Demo 使用同一 TodoPanel/GuidePanel，正式 app 級 handoff 原已使用 trip scope。

## Native 回執所有權契約

現行寫入者以 create_named_expense_item、mutate、update_rates 為主：

| 操作 | signature 所有權 | 舊清理結果 |
| --- | --- | --- |
| 建立項目 | trip + id | id 路徑可清理 |
| 修改項目（含付款、連結、lifecycle） | id（expense ID） | id 路徑可清理 |
| 更新／初始化匯率 | trip，沒有 id | 遺漏 |

以真正 public create、lease、mutate、rates RPC 產生三種回執再以 owner DELETE 刪旅程，修改前剩 1 筆 rates 回執。追加 `20261107025112_issue23_trip_receipt_cleanup.sql`，清理比對 signature.trip 或該旅程 expense IDs，且在刪 expense_items 前執行。沒有改已安裝的 `20261106181006`。

同時驗證零支出、只有匯率操作的旅程，以及另一旅程真實 rates 回執逐欄保持。原 owner admission、legacy financial protections、trip try-advisory-lock、item/group NOWAIT 順序與 private function 權限保持；未新增跨領域讀取或把金融規則交給 Timeline。

Native receipts 目前沒有獨立 trip FK，其生命週期依上述寫入格式與刪除契約。未新增格式的操作可以沿用本契約；若未來新增寫入者，必須一併驗證所有權與刪除回歸，不能只測建立／重播成功。

## 實際 Staging 只讀查核

本輪查詢 `uyqdopksfysbobhjcepk` 的 pg_proc：remove_trip_expense_graph security definer、空 search_path，body 包含 signature.id、不含 signature.trip。本機修正尚未安裝。以 signature.trip 對 trips 做 anti-join，現有 orphan trip receipts 為 **0**；沒有刪除或修改 Hosted 資料。此結果不等於舊實作沒有漏洞。

## 驗證與限制

- Node/SQL **52/52**：Timeline/expense integrity 9、create 9、peer admission 6、rates planning 2；migration/schema/RPC 26。包含真正回執寫入、刪旅程、他旅程保留、拒絕越權、版本／重播、支付與參與者限制。
- Chromium **25 個不同案例通過**：Guide/Todo 2、travelWorkspace 11、formalTripDateGuard 3、formalEditorHandoff 9。新增雙向案例在修正前已觀察到非預期 dialog；修正後包含擴充的離頁/換旅程/save 檢查通過。
- travelWorkspace 另 **2 個案例失敗**：住宿 CRUD 找不到舊的「連動預算」欄位；settlement 案例期待「出發前預算」而畫面是「實際金額／尚未付款」。以額外 Vite load plugin 讀取修改前 HEAD 的 App.jsx 作對照，兩個案例均同樣失敗。本輪未改這些欄位或測試期待，不能將整份 suite 報為全綠。
- formalTripDateGuard 首次批次缺 PGLITE_MODULE 而無法初始化；補齊路徑後 3/3。formalEditorHandoff 的 snapshot 故障案例首次跑到本機 Google 選點入口；用測試設計的 static provider 重跑後通過。這是測試 fixture 設定，未改 .env 或 Hosted 地圖設定。
- Build、git diff --check 通過；仍有既有大 bundle advisory。
- 本輪 SQL 使用完整 migration chain 的隔離 PGlite，UI 用本機 Chromium + SQL fixture；未宣稱 Hosted 新版本 UI、多帳號 WebSocket 或 native PostgreSQL 新一輪併發驗收。

## 後續

本機差異可供 review。Hosted 安裝需以此新 migration 做同來源 rollback trial、既有資料／函式／權限比對與安裝後只讀驗證；Preview 前端需另行交付後才可驗收 Guide/Todo 真登入流程。既有兩個 Demo suite 失敗應另作測試契約維護，不應用刪除 assertion 掩蓋。

## 續查：Preview「京都五日散策」整趟刪除被擋

2026-11-07 以正常 Browser Use 確認指定的 Preview 與提示，並在 Staging SQL Editor 做只讀查詢。這趟（11/15 出發）有 3 筆 native 支出、1 筆未凍結 `trip_budget_baselines`；舊 `budget_items`、`actual_expenses`、收據 intent／cleanup 及 attachments 均為 0。快照 cutoff 為 11/15 00:00 Asia/Taipei。Staging 財務、生命週期與收據的既有 activation latch 為 true；實際 `guard_budget_external_parent` 的 source SHA-256 `33250f5f38a512114aff9577caf01d4f2e87a9492f212311cf760c8d21df7d8a`，與既有 dormant-cascade 修復的部署版本相同。這個 guard 把任何 baseline 當歷史，先於 #23 的 `z_remove_native_expenses_before_trip_delete` 拒絕。因此 UI 的泛用訊息不代表有實付或收據，也不是上一個匯率回執遺漏所造成。

本機追加 `20261107030622_issue23_allow_trip_delete_with_unfrozen_snapshot.sql`：只在可辨識的 guard 版本上收窄原 baseline 條件，以 `departure_at <= clock_timestamp()` 保護已凍結快照。未凍結規劃快照沿用既有外鍵 cascade，native 資料仍由 #23 的刪除交易處理。保留舊財務、收據、owner/RLS 與既有鎖規則。未刪除任何 Hosted 資料，也未在 Production 進行刪除試跑。

最新隔離 SQL 12/12 通過。使用與 Staging 相同指紋的舊 guard body 並啟動保護後，原樣重現 owner DELETE 拒絕；套用新 migration 後 owner 可刪除僅含未凍結快照及 native 支出的旅程，非 owner 仍不能刪；凍結快照與舊預算仍阻擋，其他旅程保留。這是本機驗證，尚未套用 Staging。

## 續行：兩筆刪旅程 migration 已套用 Staging

2026-11-07 使用者授權套用。僅在 Preview 使用的 `uyqdopksfysbobhjcepk` 執行。先核對 ledger 75 與兩個原函式 SHA，將本機兩份 SQL 正規化換行後驗證 SHA，並在交易內試跑。使用真正的 create/mutate/rates RPC 建立三種回執；authenticated 非 owner 無法刪除，owner 可刪除有未凍結快照及新版支出的旅程，已凍結快照仍拒絕。讀回確認快照、支出、三種回執、匯率 lease、signal 一起清除。試跑回滾後仍是 ledger 75。

以相同交易安裝，測試資料先回滾到 savepoint，才提交函式與 ledger。兩個函式的原 OID、owner、權限及屬性通過交易內比對。獨立讀回確認 ledger 77，`20261107025112` 與 `20261107030622` 已登記且兩份 SQL SHA 皆一致；未凍結條件與 trip 回執清理已在函式內生效；QA 旅程 0 筆。「京都五日散策」仍在、3 筆新版支出仍在。Production 與 Preview 前端部署均未變更；Guide/Todo 前端修正仍在本機。
