# Issue #15｜B-2 名稱／備註群組 UI

2026-10-29；分支 `codex/budget-collaboration-redesign`。使用者要求「繼續 B-2」及後續「繼續」；本次完成已驗證 DB 原型對應的 **title/note B-2 切片**，仍非完整 Issue #15。預設旗標關閉，沒有 hosted migration、protocol 啟用、部署、main merge 或 Issue 狀態變更。使用者其後授權將程式碼／migrations／tests／文件一起 commit/push 到此功能分支，供另一台電腦接手；本機 runtime、資料庫、環境檔與原始 logs 排除。

[機器可讀結果／來源 hashes／19 組真實重疊證據](qa/2026-10-29-budget-b2-metadata-results.json)；[前階段 DB 快照契約](2026-10-29-budget-metadata-snapshot-handoff.md)；[完整 B-1 目標](2026-10-29-budget-collaboration-b1-contract.md)。

## 本次可操作行為

- 開啟明細／群組編輯畫面不取得整筆或群組租約。聚焦名稱／備註（含 Tab）才向 DB acquire 對應群組。輸入框用 readOnly 保留鍵盤可達性，顯示編輯者、pending 與重試狀態。
- 支援範圍仍為無 retained Actual、無 fixed/backlink 的 Budget，及獨立 manual Actual。其他列明確唯讀並提供「編輯完整項目」，不承諾付款群組已接管。
- acquisition pending 期間可暫存第一次輸入，**未獲 grant 前不成為可提交值**；拒絕後保留暫存，不能儲存。支援 Unicode 插入與鍵盤移動；不以此宣稱所有實體輸入法／裝置已驗收。
- title/note 各自手動儲存。只送該群組的單一欄位、base revision、epoch、tab session、capability 及 request ID；不呼叫舊整筆 save 作 fallback。成功後採用 DB canonical value，包含普通空白修剪與空備註 NULL；金額／參與人／付款不變。
- 同一列不同群組可由不同人編輯。已提交的另一群組會合併到乾淨欄位；本機 dirty group 不被背景快照重設。同組版本前進則顯示衝突，保留原 base／草稿，只能明確捨棄後採用新值。
- 成功提交後仍在組內就保留 lease；clean 離組釋放，兩分鐘真實 idle 釋放；dirty 十分鐘受 DB 七分鐘 TTL 限制。心跳／快照不增加人類活動序號；expiry timer、focus、online／visibility 恢復重讀，authority 不確定時停寫。
- 捨棄／關閉／側欄切換使用既有 active-editor guard，待精確 release 確認才離開；dirty prompt 提供儲存、不儲存、繼續編輯。release 失敗保留可恢復面板。account/trip/generation 變動使舊回應失效；晚到 acquire 只用原 capability／epoch 清理，不能授權新 context。
- sessionStorage 僅存本分頁的 value/base/schema version，不存 token、epoch、session 或 authority。重開時是未確認草稿，需重新取得權限／比對版本；其他分頁不共享草稿。金融離線快取剝除全部 metadata authority／collaboration hints。
- patch 回覆遺失時，記憶體保留原 request ID／payload，重試查同一成功結果。結果未確認前不允許捨棄該 intent。重載僅還原 value/base，沒有恢復未決 request ledger 的 controller；不宣稱跨重載自動同步已完成。
- `編輯完整項目` 是明確的新舊模式轉換：先處理本分頁群組草稿、精確釋放，再進既有 whole-record editor。新舊 wildcard 排他仍由 DB enforce，不以自動 fallback 繞過。

**B-3 仍未開始：** 沒有 debounce autosave、正式空白新增、最多五步 Undo、Redo 或歷史 UI。分類、計價、付款人／關聯／收據仍用既有安全路徑，沒有擴大 DB 原型範圍。

## 實作檔案與同步

| 檔案 | 變更 |
| --- | --- |
| [budgetMetadataConfig](../src/lib/budgetMetadataConfig.js) | `VITE_BUDGET_METADATA_GROUPS === true` 才選新 reader／editor，預設 false；同一 tab 的新快照與 lease 共用記憶體 session ID |
| [budgetMetadataService](../src/lib/budgetMetadataService.js) | 窄 RPC transport、嚴格 schema／canonical graph 檢查、每組 state machine／intent buffer、CAS、冪等重試、idle／expiry／cleanup、per-tab draft；metadata own_session 永不授予 capability |
| [BudgetMetadataEditor](../src/components/budget/BudgetMetadataEditor.jsx) | 正式／Demo 共用群組面板、readOnly／status／retry／conflict、逐組手動儲存與離開 guard |
| [budgetSync](../src/lib/budgetSync.js) | opt-in 時新單快照；缺 RPC 僅允許舊金融只讀 fallback，群組停寫；既有 coalescing 回傳已接受的 data 供 controller ingest |
| [App](../src/App.jsx) | 新快照與 client 生命周期／visibility、既有 trip channel 接 opaque signal、快取去除 authority、對讀取錯誤停寫；離開 prompt 補「繼續編輯」 |
| [BudgetWorkspace](../src/components/budget/BudgetWorkspace.jsx)／[CSS](../src/components/budget/budget-page.css) | 選取現有列後顯示群組 editor；明確完整編輯轉換，沿用桌面版面／低強度唯讀表面 |
| [budgetCollaboration](../src/lib/budgetCollaboration.js)／[budgetEditLeases](../src/lib/budgetEditLeases.js) | 同帳號真正 edit 優先與 selection 規則保留；去重鍵加 group，避免吞掉同列不同組；允許顯式共用 tab session |
| [Demo transport](../src/demo/budgetMetadata.js) | 純記憶體 lease/version/request，加窄 React callback；不呼叫 Auth/RPC/Realtime/Storage 或草稿持久化 |
| [notifications](../src/lib/notifications.js) | 修復回歸發現的 Sonner 無中生有 dismiss 競態，詳見下方 |

大表不訂閱每次鍵入：controller 將本機欄位版本與 snapshot projection 版本分開，`useSyncExternalStore` 讓群組面板更新輸入，BudgetPanel 只在 projection 變動更新。未新增套件、TS/Tailwind、框架或 SQL migration；本階段全部 migration raw hashes 與前階段一致。

在功能開啟的正式模式，collaboration 外框從同一新 snapshot 的完整 entries 先做同帳號 edit／selection 去重，再過濾 own_session；不將兩份 reader 不同時間的 hint 拼成權威。舊 selection 寫 API／節奏保留。snapshot fail、offline 或 hidden 時不提供新 group write authority，canonical／dirty input 留存。

## 驗證與發現

| 層級 | 結果與範圍 |
| --- | --- |
| [新 controller 測試](../tests/budgetMetadata.spec.js) | **20/20**：pending promotion／拒絕、schema、窄 patch、canonical trim/null、保留聚焦 lease、dirty merge／衝突、blur／idle／heartbeat、斷線／過期、release failure、未知 ack 同 ID、NOWAIT、ABA／late grant、儲存不含 capability、viewer／disabled、group-aware hints、cache stripping |
| [新畫面測試](../tests/formalBudgetMetadata.spec.js) | **18/18**：真 React Formal UI＋隔離 shared backend，兩帳號／同帳號兩分頁；詳細清單如下 |
| [真 PostgreSQL](../tests/budget-metadata-parallel.mjs) | **30/30**，19 個真實重疊案例；原 29 保留，新增 B-2 JS transport/controller 實際呼叫 named SQL RPC，兩獨立 backend acquire 真等鎖，再分別提交 title/note，並驗 trim/null／財務不變；不是 HTTP mock 冒充 DB 並行 |
| 舊 metadata SQL | **23/23**；三套 budget／safety／lease DB 全通過。舊 lease suite 仍使用 LF fixture 避開歷史 raw-SHA guard，未更改已套用來源 |
| 預算＋通知回歸 | **127/127**，含當時 19 項新 controller；最後新增 canonical case 在20項套件另通過，不把重疊數字當成新增測試總數 |
| Sonner 畫面 | **11/11**；原失敗的 Demo→Formal 首次錯誤／恢復情境額外三輪，6/6 通過 |
| Build／syntax／diff | 通過；既有大 bundle advisory 仍存在，入口 bundle 約1.10MB |

18 個新畫面案例全部通過：

1. 開啟不取租約、首次輸入 pending buffer、同群組排他。
2. A title／B note 分別窄 patch，遠端不覆蓋本機 dirty group，金額保持。
3. 同帳號兩 tab 不同 session，同組不能共同持有。
4. clean blur release、dirty exit prompt／continue、release failure retry。
5. RPC 不存在只讀，無 legacy mutation fallback。
6. protocol disabled 只讀，無 acquire。
7. ack lost 同 request ID 重送、只提交一次。
8. offline 保留值、停寫，fresh read＋DB renewal 後恢復。
9. browser online 但背景 snapshot 失敗也立即停寫，重新確認才能提交。
10. Unicode 首次輸入 pending buffer 與鍵盤 Tab。
11. 同組遠端 revision 前進後保留 draft，明確 discard 採用新版本。
12. reload 恢復本 tab value/base、不恢復 authority，也不覆蓋另一 tab。
13. 換旅程後晚到 acquire 清理，不授權返回的 generation。
14. 側欄 clean exit 在 pending acquire 未確認前保持面板，grant 後精確釋放。
15. legacy whole-record holder 阻擋 group admission，無整筆 save fallback。
16. 使用者明確完整編輯轉換，先釋放 group 再取舊整筆 lease。
17. standalone Actual note 更新保持 known debit 71／JPY／原 FX。
18. Demo 使用相同面板、僅 React 記憶體更新，無 API 請求。

初期失敗及修正：

- Playwright `fill` 在 readOnly 尚未 focus 時會等待 editable；畫面測試改成實際使用者順序 focus→輸入，pending 另有明確 gate／Unicode 操作驗證，未移除權限限制。
- metadata guard ID 最初未以 trip ID 結尾，與現有 guard scope 不符；已修正，dirty prompt 與 release cases 通過。
- 空備註 DB 回傳 NULL，title 會 btrim；嚴格 ack validator 原先若用原字串會誤判結果未知。已按 SQL 相同普通空白規則產生 canonical patch，並採 DB 回覆；原生雙連線也覆蓋。
- 原回歸 `approved snapshot clears ... warning` 完整批次會遺失首次 toast，單跑可過。實際通知 state 仍有 budget failure；Sonner 對不存在 ID 的 dismiss 會排程移除，可能與新 toast 相撞。現只對 `toast.getToasts()` 中存在的 ID 呼叫 dismiss。已撤除無效的 feedback context 實驗及所有 debug instrumentation；原測試不改斷言，完整127項及11個 rendered toast tests 通過。
- 受限 Chromium 曾回 ERR_NETWORK_ACCESS_DENIED；授權本機測試程序在適合的環境執行後，嚴格 console／意外 hosted-request 檢查保留並通過。

## 環境、預覽與重跑

Browser plugin 未提供，依 frontend-testing-debugging 使用現有 Playwright／Chromium。Formal target flow：`/ → 選取預算 → 編輯項目 → 聚焦名稱／備註 → 取得 group lease → 手動單欄 patch → 另一分頁看到 committed canonical`。Formal 透過現有 App mock boundary 攔截 Auth／RPC／Realtime／Storage；Demo 走真實本機記憶體流程。

畫面為 desktop **1440×1000**，本階段依 DESIGN.md 不做 mobile/tablet 新設計驗收。Page identity／非空頁／無 Vite overlay／console／操作後 DOM／截圖皆檢查；截圖已人工檢視無文字裁切或欄位重疊。另有舊套件 narrow viewport 回歸，不能算新 B-2 physical device 驗收。

本地截圖（不加入 Git）：`C:/Users/Administrator/AppData/Local/Temp/travel-budget-b2/b2-demo-desktop.png`、`b2-other-editor.png`。後者顯示 B 備註已儲存，同時 A 持有名稱的唯讀提示。

```powershell
# 僅本機 opt-in；未修改 .env 或部署設定
$env:VITE_BUDGET_METADATA_GROUPS='true'
npm.cmd run dev -- --host 127.0.0.1 --port 5174 --strictPort
# /demo/budget 可直接檢視。正式 / 必須具備兩份 DB migration 且另經授權啟用，否則唯讀。
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:5174'
node node_modules/@playwright/test/cli.js test tests/formalBudgetMetadata.spec.js --workers=1
node node_modules/@playwright/test/cli.js test tests/budgetMetadata.spec.js --workers=1
node scripts/qa/run-budget-metadata-parallel.mjs
```

127 項舊模式＋controller 回歸使用另一個新 dev server，`VITE_BUDGET_METADATA_GROUPS=false`、`PLAYWRIGHT_BASE_URL=http://127.0.0.1:5176`。執行檔為 budget-finance、budgetEditLeases、budgetSync、budgetCollaboration、budgetPrimaryCollaborators、budgetReceipts、budgetMetadata、formalBudgetLeases、formalBudgetSync、formalBudgetCollaboration、formalBudgetRates、formalBudgetReceipts、budgetEditorExit、budget-side-tabs、notifications 的 `.spec.js`；額外 appToasts 11項。

原生 PostgreSQL 17.11／Node24.15.0／pg8.16.3、READ COMMITTED。全新 initdb／loopback marker／兩個不同 PID、LOGIN、actor/session，final run `4d6d4ef8-f259-427e-8f05-14c78516d55e` 的 log／結果見 `.tmp-budget-native-pg/runs/`；兩個本階段成功測試 cluster 均已停止，未留下 DB service。所有 migration hashes 與前階段一致；本階段沒有 SQL 修正或 schema rollout。

## 剩餘界線與下一步

這是 **名稱／備註 B-2 的本機交付**。完整 B-2 的分類／金融群組、付款連動項目仍未實作；不能把本切片旗標開到正式站作為完整替換。正式 read path／PostgREST、websocket、真帳號多分頁、Storage bytes 與 Production rollout 尚未驗收。IME 合成、原生 Undo 保真及 queued typing 將在 B-3 autosave controller 再驗；本次沒攔截 Ctrl+Z。

下一步先做 **B-3 名稱／備註 autosave**：約1秒 debounce、blur、IME composition guard、每組串列／queued revision、結果未知同ID、儲存中仍可輸入及成功後 clean-held。五步 per-tab Undo 需要先補 DB inverse lineage／version 契約與驗證；blank persisted records、金融 groups、hosted rollout 各自分階段，不能直接附帶啟用。
