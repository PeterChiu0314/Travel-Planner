# Issue #15 B-7 — 最終整合驗收

起點 `227028573e2c45f3e774c7d1d3fb2a1656a8a899`，分支 `codex/budget-collaboration-redesign`。僅本機／新建隔離環境、必要修正、原分支 commit/push；所有新旗標預設關閉。Hosted、main、正式 Storage／排程／部署未授權。

本文件是本次驗收矩陣與結果入口。**發行結論：Blocked／NO-GO**。本機程式修正、DB 整合與可控 UI 已通過；真 Auth/PostgREST/Realtime/Storage HTTP、Worker 排程與完整 Supabase managed 環境安全驗收未完成，不能宣稱正式上線就緒。歷史 B-1～B-6 的通過數字不計入此次結果。

最新補驗自 `a28232ebc051c40c0741907d4e1c44a55f1df701` 接續：見 [Docker／真服務補驗交接](2026-10-30-budget-b7-service-acceptance-followup.md) 與 [去敏證據](qa/2026-10-30-budget-b7-service-followup.json)。新增 9/9 TLS／catalog 查核，CLI Advisor TLS 已排除；真 HTTP／排程仍 Blocked。本節以下歷史 DB／UI 數字沒有重跑或重算為本輪結果。

## 跨功能矩陣

| ID | 使用情境／安全邊界 | 本次方法 | 狀態 |
| --- | --- | --- | --- |
| I01 | 完整 migration chain、順序／函式／trigger／private RLS／grants | 60 份原始 SQL、新 initdb PG17.11；Auth/Storage schema 是 fixture | Passed（DB） |
| I02 | 空白新增 → 雙人不同群組 → 計價完成 → 付款 → retained 鏡射 | 獨立 LOGIN／backend／session 的連線整合 | Passed（DB） |
| I03 | 相同群組競爭、租約到期接管／精確 late release | 兩連線實際重疊、持久租約與 epoch；blocking graph | Passed（DB） |
| I04 | Pricing／Participants、Payment、Payer 相依與單筆 retained 跨端 | Pricing/retained Payment 真正等待後 stale 拒絕；custom 跨端 Undo | Passed（DB） |
| I05 | Source relink／apply、Receipt、Undo 邊界與刪除衝突 | 真交易；Storage catalog／可信證明 fixture，不是 HTTP bytes | Passed（DB） |
| I06 | 全旅程匯率、歷史成本／history／origin／baseline 保護 | 完整財務影像／既有 migration 故障回滾與保留 | Passed（DB） |
| I07 | 五步 Undo、他人修改／無關群組、Create／Delete 爭用 | 跨功能 SQL；Ctrl+Z／未知 ACK 的可控 UI | Passed（DB/UI） |
| I08 | v1～v10 Snapshot、舊 API／raw DML／wildcard、暫停與同 ID replay | 空／非空圖；v2/v3/v4 exact 歷史 receipt；新 group 原 request | Passed（DB） |
| I09 | 外 Parent Cascade／整旅程／帳號／相鄰交通刪除 | parent 前 fail-closed、RPC 全交易回滾、財務列／joins 不變 | Passed（DB） |
| I10 | 撤權／context 變動／reload／late ACK／慢 Snapshot | DB 撤權；Controller account/trip/ABA 與慢回應；Mock Auth | Passed（受控層） |
| H01 | 真 Auth／PostgREST／Realtime 雙帳號雙分頁、重連／背景 | Docker backend 無法啟動，未產生真正服務 session | Blocked |
| H02 | Storage HTTP upload／replace／delete／signed URL、舊 byte delete 拒絕 | 無隔離 Storage HTTP；SQL RLS／Mock 不算 HTTP | Blocked |
| H03 | Worker HTTP、custom role/header forwarding、真排程／重試 | 專用角色 SQL RLS、worker 邏輯通過；真服務／排程未驗收 | Blocked |
| U01 | Desktop Formal／Demo 主要流程、統計／右側明細 | Playwright Chromium，Formal backend controlled Mock、Demo memory | Passed（受控 UI） |
| U02 | 1440/820/390px 新增與完成計價、Portal／Modal／IME／鍵盤 | screenshot/DOM/console；IME 為 composition event，非實體輸入法 | Passed（瀏覽器） |
| O01 | Preflight／Activation／Pause／Readback／Forward repair | 四份 SQL gate／財務影像在隔離 DB 通過；修復程序有 fail-closed 邊界 | Passed（本機程序） |
| O02 | Production build／syntax／diff | 本次 source 與直接相依 | Passed |
| O03 | Security Advisor／CLI migration list | 新 TLS cluster 的 CLI Advisor 實跑成功：64 WARN / 0 ERROR；9/9 catalog 查核。migration list 可連線但無 managed ledger，完整服務／history 對齊未驗收 | Passed（原生 CLI/catalog）；Blocked（完整 Supabase） |

## 環境界線

- 開始時五個原有未追蹤檔保留，沒有已追蹤修改。
- 本機已有 Docker CLI 29.7.2／Desktop 4.90.0；2026-10-30 啟動失敗：Ingest socket `sailor-ingest.sock` 無法 rename，backend crash，Linux Engine named pipe 不存在。沒有重設 Docker、刪除既有 volume、變更正式服務或憑證。真 HTTP 項目待環境確認，不能用 native SQL／Mock 改列 Passed。
- 已安全停止 Desktop，再嘗試保留備份式 rename 該零位元 socket，仍收到「系統無法存取該檔案」，沒有移動成功、沒有刪除 socket 或重設系統。Docker 最後已停止；沒有本次建立的 Supabase HTTP 環境。
- 補驗外部 probe 證明：正常 AppData 的 Docker 路徑不存在，明確 package 私有路徑的 AF_UNIX socket 可讀；Explorer 啟動另因 Docker 登錄缺失失敗。10,782,507,008-byte 既有資料 VHDX 保留在 package 路徑。修復涉及安裝／資料位置風險而停下；沒有重裝、搬檔或 registry hack，詳見補驗交接。
- Browser plugin 未提供；使用專案 Playwright。財務測試截圖存 workspace 外，不提交私密畫面。

## 發現、修正與最終證據

| 分級 | 問題／修正 | 驗證 |
| --- | --- | --- |
| P0-01 | 啟用後有效 Raw participants UPDATE 在無群組租約時仍可成功。新增子表 effect-required guard，涵蓋 participants／Links 的 OLD/NEW 父端，保留原 pricing/payment/source/lifecycle manifest 精確驗證 | 原成功 bypass 轉為拒絕；正常 custom pricing、跨端 inverse、Links、Source apply、complete delete 全通過 |
| P1-01 | 舊 wildcard 仍可在啟用後取得；舊 whole-form 先落入不一致的價格驗證 | activated latch 拒絕 acquire/renew；v1–v4 新寫入明確 protocol required；v2/v3/v4 exact 舊 receipt replay 保留，錯 payload 拒絕 |
| P1-02 | 空旅程 v8 metadataRecords=null，v9/v10 使 UI／匯率初始化失敗 | v8 coalesce=[]；validator 先檢查陣列；空/非空 v1–v10、初始匯率與新建完成通過 |
| P1-03 | Receipt 只查 MIME/size，Worker 使用 service-role | 新 NOLOGIN/NOINHERIT/NOBYPASSRLS 角色、exact claim Storage RLS、可信 SHA-256/size/type/container proof；未證明不提交、同 request 恢復；新增 content_worker_verified=false gate。DB/邏輯通過，HTTP 仍 Blocked |
| P1-04 | 外部 parent/cascade 規則未定；前端行程刪除可能先刪相鄰交通後失敗 | parent/adjacent transport 前拒絕；新 invoker 單一交易入口；拒絕後完整 before/after 不變、跨 trip 拒絕 |
| P1-05 | Paid 後 Budget Links 因舊整筆 supported 判斷被誤擋 | 僅合法單筆 retained 的 Budget.links 放行；不鏡射 Actual、不改金流／history；Snapshot/Demo/原租約/Undo 對齊，DB＋Demo UI 通過 |
| P2-01 | Portal listbox/menu 或 native dialog 中 Ctrl+Z 可能穿透到資料 Undo | 尊重 dialog/menu/listbox ownership；原生輸入／composition、其他工作區、reload／late ACK 回歸通過 |
| P1-GATE | 真服務／混合客戶端／Worker 排程尚未實測 | Blocked；正式啟用前必須補驗，不接受 SQL fixture 的 readiness booleans 作發行證明 |
| P2-LIMIT | Source 歷史 origin A→B／origin-only/generated detach 仍為既有明確拒絕；外 Parent 真正刪除採保留資料 | 安全 fail-closed，沒有偽稱支援。若產品要求這些操作，仍不能開旗標繞過契約 |

沒有未修復的已重現程式 P0/P1 留在本機修改；但 P1-GATE 仍未驗收，所以發行結論沒有改成 Passed。

## 本次結果與重跑範圍

- 原生 B-7 **26/26**：run `c7667979-eca3-4612-af93-35cef29796dc`，PG17.11、隨機 loopback port、兩個獨立 LOGIN/backend/JWT claim/document session，2 個真正重疊 blocking observations，另確認未提交財務交易的 shared fence 會使 Pause/Activation 的 EXCLUSIVE NOWAIT 拒絕，防止在 statements 中途切換。這不是 Auth 簽發的 JWT／PostgREST／Realtime session。
- Receipt 直接相依原生 **23/23**：run `cd86c382-1ab2-4891-9c11-b6209d5e7ede`，4 個真正重疊 observations；因 prepare／worker ACL/gate／protocol transition fence 改動才重跑。SQL fixture 用明確的 trusted-proof fixture helper，沒有放寬 MIME／size／租約／rollback 斷言；不能當作 bytes 下載驗證。
- Playwright **45 個不同案例通過**：B-7＋Undo 19/19、Receipt Controller/UI 26/26。之後擴充同一個 Demo1440 案例加入 paid→Links autosave→Ctrl+Z，再通過1/1，沒有重複算成46。沒有重跑全部 B-1～B-6 歷史單元套件。
- 新 migration `20261030125028_budget_workspace_integration_safety.sql` 由 CLI 建立；59 份既有 migration 保持原來源。Expansion 的注入故障會整交易回滾 functions/roles/RLS/policies/既有財務影像；成功 expansion 也不改已提交成本／origin／receipt／baseline。
- Build、JS/MJS syntax、diff 檢查通過；僅既有 >500kB chunk advisory。CLI Advisor/migration list 在真 loopback 重試仍回 `tls error (server refused TLS connection)`，不列為通過。全部 native clusters 已停止。
- [完整案例、observations、版本與 source hashes](qa/2026-10-30-budget-b7-results.json)。[可執行操作與 Forward Repair 程序](2026-10-30-budget-b7-rollout-runbook.md)。

以上 TLS 失敗為原 checkpoint 紀錄，已由補驗的新 per-cluster TLS／verify-full 修正：只重跑新增 9 項安全查核，CLI Advisor 成功而保留 64 WARN 的分類及限制，沒有修改既有產品 RLS。詳見 [補驗證據](qa/2026-10-30-budget-b7-service-followup.json)。這不解除 H01–H03，也不代表原生 fixture 的 migration list Remote 空欄已對齊 managed history。

復現命令：

```powershell
node scripts/qa/run-budget-metadata-parallel.mjs --integration --advisors
node scripts/qa/run-budget-metadata-parallel.mjs --receipts
# 先依 Windows setup 啟動 Vite5180，PLAYWRIGHT_BASE_URL 指向該 loopback。
node node_modules/@playwright/test/cli.js test tests/budgetIntegration.spec.js tests/budgetUndoGroups.spec.js tests/formalBudgetUndo.spec.js --workers=1
node node_modules/@playwright/test/cli.js test tests/budgetReceiptGroups.spec.js tests/formalBudgetReceiptGroups.spec.js --workers=1
npm.cmd run build
git diff --check
```

初輪故障均有定位：測試曾用錯 text intent 的 SQL型別、回應同名 intent 覆蓋測試 action、建立不合法 transport、重複點選已選列導致取消選取。修正 fixture／腳本，沒有增加 timeout。撤權測試改成在撤權完成後、被拒絕 mutation 前取財務影像，避免將合法行前 baseline captured_at 刷新誤判成失敗寫入。真實產品問題與上表相對應；特別是 raw child bypass 及 retained Links 的舊 guard，皆修改產品並保留嚴格 before/after 驗證。

## 真多人九項驗收狀態

| 必要真服務情境 | DB／可控 UI 證據 | 真 HTTP 結論 |
| --- | --- | --- |
| A/B 同筆不同群組 | 真 backend overlap、雙頁 Mock UI | Blocked |
| 同群組競爭／草稿保留 | DB 排他、Controller pending | Blocked |
| Retained／付款／分攤競爭 | 原生競爭＋stale vector＋跨端 custom Undo | Blocked |
| Undo＋peer 修改 | 同組拒絕、無關 Note 成功 | Blocked |
| 新增／刪除＋他人編輯 | 原生 lease/lifecycle、tombstone | Blocked |
| 斷線／重連／背景／到期接管 | 原生 expiry/epoch、受控 retry；非 Realtime | Blocked |
| ACK 遺失／Snapshot 延遲／同 ID | Controller/Mock transport＋真 DB exact replay | Blocked |
| 撤權／切 trip／登出／reload／late response | DB 撤權、受控 context/Undo/Receipt 測試 | Blocked |
| 新舊 client 混用 | DB v1–v10／whole-form／wildcard／Storage SQL fencing | Blocked |

## 尚需額外授權／外部條件

1. Docker 安裝／資料 namespace 修復須先有可審閱的備份／恢復計畫與明確授權；現有授權不包含資料移動、registry hack、重裝／reset。安全恢復後可依現有本機隔離授權補 H01–H03。
2. 最新指示禁止改用 Hosted 繞過本機阻擋；沒有建立收費測試專案或使用任何正式服務。
3. 本機真服務證據通過後先回報 ChatGPT Review，再另行申請 Hosted／Production migration、Storage policies、Worker secrets與排程、前端及 DB flags；main merge／正式部署／切換也各需明確授權。
4. 本次不更新／關閉 GitHub Issue，不合併 main，不執行 Hosted SQL／Storage／RLS／Worker 排程／正式部署；push 原 feature branch 不能當作上線完成。

## 瀏覽器證據

環境：本機 Chromium、Vite `http://127.0.0.1:5180`；Browser plugin absent，使用既有 Playwright。Formal 是 controlled Auth/RPC/Storage backend，Demo 是真正 memory adapter。頁面 identity／title、非空白／無 Vite overlay、console/pageerror、互動後 DOM/財務影像與 desktop/820/390px 圖檢查通過。若之後需要在 app 內逐步檢查 DOM/console，可安裝 Browser plugin；本次證據不依賴它。

截圖存 workspace 外 visualizations 的 `b7-demo-1440.png`、`b7-demo-820.png`、`b7-demo-390.png`，不提交財務畫面。390px 可輸入名稱、展開參與者、填合法零元並完成；這是桌面 Chromium viewport，沒有宣稱真手機/PWA／真實 screen-reader 語音驗收。
