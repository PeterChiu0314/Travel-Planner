# Issue #15 B-5 — 正式空白新增、完整性與安全刪除

2026-10-30，分支 `codex/budget-collaboration-redesign`。起點本機／GitHub `889b09f0f1ed6d745186c604664f5e3eae397af3`，開始時乾淨。此次只做本機實作、隔離驗證、文件及原分支 commit/push；沒有 Hosted Migration、正式 DB／Storage／設定操作、main merge 或手動部署。

## 實際支援

| 操作 | 支援及拒絕條件 |
| --- | --- |
| Budget／Actual 新增 | 專用 RPC 在原表立即建立 incomplete、DB 產生穩定 UUID；相同 Actor／Session／Request ID／payload 回傳原紀錄，不建立第二筆。新增不取得 DB 整筆或群組長租約 |
| 未完成編輯 | 現有右側群組編輯器、自動儲存 Title／Note／Category／Payer／Pricing；無有效修改不寫入，無效輸入保留草稿。不可切入 legacy 整筆編輯 |
| Budget 完成 | 有合法非空標題、明確成功提交的 Pricing、有效 approved Participants，DB 才改為 complete；付款人仍可為 null |
| Actual 完成 | 同上，另須使用者明確提交有限 paid_at；完成前 inactive，paid_at 為 NULL，完成後 active。未完成時可修正初始計價；完成後保留原本已知 TWD Debit 保護 |
| 合法零元 | DB 儲存的空白 amount=0 哨兵在 Pricing 投影為空字串。只選人不會完成；明確輸入合法 0 並滿足其他條件可完成 |
| 刪除 Budget | 支援獨立 placeholder／完整手動 Budget 及其 Participants／Timeline Links；fixed、Accommodation FK、任意 current/origin retained、backlink 拒絕 |
| 刪除 Actual | 支援無 current/origin/backlink、manual、無歷史付款陣列、無收據或待清理工作之獨立 placeholder／完整 Actual |
| 不明相依 | catalog 發現不在明確允許表集合內的 FK，或付款／來源圖不具已定義刪除契約時 fail-closed；不猜測 cascade 效果，不刪歷史 Actual |
| 收據 | 有 metadata、pending upload intent 或非 done cleanup 的 Actual 拒絕刪除。本階段不刪 Storage bytes，也沒有跨 Storage／SQL rollback 宣稱 |
| 舊本機 new 草稿 | 不自動恢復為新協定完整表單、不自動提交。新增時提供明確「保留草稿並新增」選擇；原 localStorage 內容保留，新的 DB 紀錄仍全空白。這是保留路徑，沒有自動匯入器 |

沒有自動清除未完成紀錄。合法新項目可在重新整理後持續編輯，其他協作者在權威 Snapshot 看見同一 UUID。真正 Hosted Realtime 傳播延遲仍未驗證。

## DB 實作與安全邊界

唯一新 forward migration：`20261030064703_budget_workspace_lifecycle.sql`，由已安裝 Supabase CLI 建立，未修改前 57 份 migration。原 `budget_items`／`actual_expenses` 增加 DB 維護的 `record_status`、`pricing_ready`、`lifecycle_revision`、`completed_at`；不另建財務表。既有列 grandfather 為 complete／ready、completed_at=NULL，不回填／重新估價歷史資料。

Actual.paid_at 允許 NULL；保留舊 API 的 DEFAULT now() 以維持從未啟用時的相容性，**新 placeholder RPC 明確寫 NULL**。CHECK 確保 complete Actual 有付款時間。空白建立不寫 payer、Participants、來源、收據或假 Payment。

新增 private RLS `budget_lifecycle_protocol`，無客戶端 table grants／private publication。`enabled=false`、`activated=false` 預設關閉；activated latch 一旦啟用過不回退。前端 `VITE_BUDGET_LIFECYCLE` 預設 false，實際協作編輯須同時啟用既有 Metadata／Finance 前端及 DB 相依協定；本階段沒有啟用任何正式旗標。啟用過後，即使 pause，也不恢復 legacy raw INSERT／DELETE／整筆新增刪除繞道。

公開 invoker RPC：`create_budget_workspace_placeholder`、`budget_lifecycle_lease`、`mutate_budget_lifecycle`；重用既有 request/effect ledger、Metadata group leases、計價工具和七分鐘 TTL。Create 使用既有明確操作 Controller 的無 DB 租約 admission，真正 RPC 再次驗證 actor／approved membership／trip／session／request；沒有新狀態管理器。

Delete 由 DB 解析全部受影響群組與已定義子表，版本向量包含 Lifecycle 及所有 group revision／graph。每個租約綁 Actor／Tab Session／Capability hash／Epoch；同帳號另一分頁也不能搶權。順序採 trip transaction advisory、membership/protocol SHARE NOWAIT、parent NOWAIT、group 固定排序、children NOWAIT，等待後重新驗證版本、來源、到期與完整 bundle。任一其他群組被持有即拒絕。精確 release 不會清掉接管者租約。

成功刪除在單一 SQL Transaction 中移除明確子表與 parent、推 tombstone/group revisions/epochs 並記錄不可變 Request Receipt；第二個子表故障會連同 row／joins／versions／ledger 全部回滾。保留 tombstones，拒絕舊 UUID 的晚到寫入／舊草稿復活。對未定義 parent cascade（例如啟用後刪整個 Trip）也採拒絕；其他頁面刪旅程的整合契約需在啟用前另行定義，本次未擴張該頁。

Readiness 使用 deferred trigger，在整筆窄寫與 joins 完成後才重新計算；只接受具伺服器 manifest 的 Pricing／Field／Lifecycle 效果，客戶端不能直接改 readiness，也不能在 incomplete raw 建立假 Participants／Receipt。新完成紀錄不可清空有效資料退回 incomplete 以繞過完整財務驗證。Title/Note、Payer approved member 與 Pricing 驗證沿用原契約。

安全補強：對直接呼叫 prepare helper 再搭配 Raw SQL 的路徑，create manifest 現在綁定每個 persisted column（含 created_at／updated_at）與精確 DB 空白值；不能夾帶舊表單、金額、來源或付款歷史。新增 native 反例先在舊實作重現（26 pass／1 fail），修正後要求 27/27，沒有把 helper 權限當成放行任意 DML 的依據。

必要相依擴充：Payment 的 JSON manifest 新建 Actual 需明確提供新增欄位，避免 jsonb_populate_record 將新 NOT NULL 欄位填成 NULL；保留新欄位 CHECK／權限，沒有放寬驗證。Incomplete Actual 初始化 TWD 計價時建立對應 actual_twd_amount／provenance，只有伺服器 Pricing manifest 可寫這些額外欄位；完成後原 known-debit 限制繼續生效。

## 財務統計與歷史保護

DB Complete Predicate 依 record_status，Snapshot 保留 incomplete 及真實 joins；需要完整資料的 Payment／Source／Receipt admission 拒絕，Rates 跳過 incomplete，Baseline 的 item／participant／link 集合只收 complete。旅程出發後新完成紀錄不會回填已凍結 Baseline。

共用前端 predicate 對已驗證舊 schema 的缺欄位保留 legacy complete 相容性；v9 Strict Validator 強制新的 status／ready／revision／付款時間、kind/id、trip root 及不重複投影，不能把 malformed v9 當舊 schema。列表保留未完成標記／數量、金額顯示尚未填寫；分類合計、每人負擔、比較、Settlement、Timeline BudgetSummary 均排除 incomplete，不採「沒有 Participants 等於全體」fallback。既有完整列仍保留原本 legacy fallback。

不修改 retained Actual ID、付款歷史、已知扣款、Participants、來源與 Receipt；有這些未定義刪除相依時明確拒絕。沒有逆向清 budget_origin_id、重建 Payment 或預先刪檔。

## Snapshot、未知結果與 UI

Snapshot v9 包裝原 v8／Payment／Source／Receipts／Finance projections，新增 lifecycleProtocol schema1、lifecycleRecords（含 trip create root 及 tombstone）。離線快取剝除 Lifecycle authority；Realtime 沿用 opaque trip signal、既有 coalescing／generation／10 秒權威期限，不新增管理器或 channel。

新增成功選取 DB UUID，開啟原群組自動儲存編輯器。Delete 保留既有確認。Lifecycle 是現有 Payment explicit-operation Controller 的 strategy：同一操作一筆在途、Unknown ACK 保留原 Request ID／payload 查證，已確認後 Snapshot 失敗只重讀，跨旅程／帳號與 Late ACK 沿用 generation fence。根層、右側面板及付款時間草稿使用 ActiveEditorGuard。刪除後即使 Snapshot 先移除選取且重新整理，仍從 tombstone 恢復待確認操作，不因找不到 parent 丟失 Request ID。

Demo 同 UI／Controller，新增記憶體 Lifecycle Adapter／財務 delta callback，不持久化 Lifecycle 或呼叫 Auth／Supabase RPC／Realtime／Storage。Demo Pricing 空白支援、初始成本、paid_at 版本和 Rates 排除 incomplete 與 DB 對齊；Demo 不是原生交易／授權或多帳號效能證據。

## Undo 與遷移恢復

Create Receipt 保留 create_fence（建立後完整群組向量）供後續判定僅未被修改、引用或付款的空白項目可逆；本次沒有 Create inverse RPC／Ctrl+Z。Incomplete Title/Note 不建立假的完整紀錄 inverse，已完成獨立單端最多五步 DB Undo 原型仍可成功。Delete 不可 Undo，成功只清此 Actor／Tab／Trip 必要 stack 與刪除物件 lineage；失敗與 Replay 不再消耗步數，其他帳號／分頁有效 pointers 保留。

`docs/qa/2026-10-30-budget-lifecycle-rollback.sql` 只供完全未啟用、未使用協定的本機反向檢查，還原原定義／ACL／欄位／群組 CHECK。已使用或啟用後明確拒絕反向抹除，須 forward repair。原生已驗證 migration 中途錯誤完整 rollback、未啟用 reverse 以及已使用 reverse 拒絕；不是 Hosted rollout 指令。

## 驗證結果與發現問題

選定證據、case 名稱、真正重疊 proof、連線身分及 source hashes 見 [QA JSON](qa/2026-10-30-budget-lifecycle-results.json)。本次只跑新增／直接相依，不重跑歷史完整套件。

| 層 | 結果及環境 |
| --- | --- |
| B-5 原生 PostgreSQL | 27/27；PostgreSQL 17.11、新 initdb、loopback-only，兩個獨立 LOGIN/backend/JWT/Session，READ COMMITTED；3 個實際重疊觀察：create/create、Title/Pricing、update/Delete |
| B-4d 直接相依原生 | 31/31；另一個全新隔離 cluster，保留 Payment／Source／Receipt 身分／成本／歷史與 Finance／Rates／Undo 契約，4 個實際重疊 |
| Playwright／Controller | 150/150，13 個直接相依 specs；Chromium、本機 Vite5180；Formal 使用受控 Auth/RPC/Storage Mock，Demo memory-only。Browser plugin 不可用，沿用專案 Playwright |
| Metadata／Undo SQL | 23/23、28/28，PGlite sequential；此層不稱為 PostgreSQL 雙連線並行 |
| Production Build／Syntax／diff | 通過；Build 只有既有大 bundle advisory，無新增依賴或設定 |
| Migration 保護 | 起點所有 57 份舊 migration 與 LF 正規化來源一致；只新增 forward migration |
| 視覺 | 1440×1000 截圖檢視既有 Formal 右側群組編輯器、新未完成項目與未污染的 400 小計，無錯誤 overlay／console error |

原生包含 stable UUID／request Replay、兩人可見同筆、不同群組並行完成、lease expiry／接管／晚到 release、付款時間 NULL、顯式零元、完整性版本、post-departure Baseline、不合法權限／跨 Trip、raw readiness／Participants／Receipt、delete tombstone、子表故障完整回滾、retained/history/Receipt/pending cleanup/未知 FK 安全拒絕、真正 Controller named RPC 及獨立文字 Undo。

修正過程發現：Payment JSON manifest 缺新欄位造成 NOT NULL（已補 server manifest，31 個相關原生重過）；DB 0 哨兵需要投影空字串；Incomplete Actual 初始 TWD 成本不能沿用「已付款後成本不可改」的 complete 路徑；Demo 以不完整值試算會誤拒 Pricing（已依未完成圖允許輸入，提交仍經完整 calculator）；舊 Mock 把所有 Actual Pricing 標為 unsupported，且 Pricing ACK target revision 與原生不符（只更新本次 Lifecycle Mock 契約，未降低安全斷言）。第一輪 Windows 沙箱禁止 PostgreSQL restricted token／瀏覽器本機連線，之後在允許本機測試的環境重跑；失敗執行不列為通過證據。

CLI loopback Advisor／migration-list 曾嘗試，但因既有 TLS 要求未可用；targeted catalog／RLS／ACL checks 不是完整 Advisor 認證。所有測試 clusters 已停止。沒有真正 Hosted PostgREST／Realtime 多帳號、正式 Storage HTTP／Worker、裝置/PWA 或 screen-reader 實機驗證。

## 變更檔案

| 類別 | 檔案 |
| --- | --- |
| DB | 新 lifecycle forward migration、lifecycle rollback QA SQL |
| Lifecycle／讀取 | 新 budgetLifecycleValues.js／budgetLifecycleGroups.js；budgetMetadataService.js、budgetSync.js、budgetPaymentGroups.js（僅 pending summaries） |
| 財務讀取／計價 | budgetFinance.js、budgetPricingGroups.js、planningBudget.js |
| UI／Demo | App.jsx、BudgetWorkspace.jsx、BudgetMetadataEditor.jsx；新 demo/budgetLifecycle.js；demo/budgetMetadata.js、demo/budgetFinanceGroups.js |
| QA | 新 budget-lifecycle-cases.mjs、budgetLifecycleGroups.spec.js、formalBudgetLifecycle.spec.js、helpers/budgetLifecycleMock.js；既有 native harness／runner 增加 --lifecycle 篩選 |
| 文件 | CURRENT_TASK.md、本交接、選定 QA JSON |

## 本機重跑入口

原生 runner 不接受 DB URL，只建立新的 loopback cluster；需要先依前階段 handoff 安裝未追蹤的 PostgreSQL17 與 pg runtime。

```powershell
node scripts/qa/run-budget-metadata-parallel.mjs --lifecycle
node scripts/qa/run-budget-metadata-parallel.mjs --finance
npm.cmd run build
git diff --check
```

Playwright 使用現有 Vite localhost5180 與 `PLAYWRIGHT_BASE_URL`，13 個實際 spec 名稱及逐案例結果見 QA JSON；可先單跑 `npx.cmd playwright test tests/budgetLifecycleGroups.spec.js tests/formalBudgetLifecycle.spec.js --workers=2`。PGlite 的 `PGLITE_MODULE` 指向忽略的安裝目錄，分別跑 `tests/budget-metadata-groups-database.mjs` 與 `tests/budget-metadata-undo-database.mjs`，不是連線到 Supabase。

## 下一步與剩餘限制

先以本次 commit 進行 Code Review。所有旗標保持關閉；正式啟用前仍需另外授權與驗證 migration／mixed-client fencing、Hosted Realtime 兩帳號／雙分頁、已定義外 parent cascade、既有 Receipt worker／Storage HTTP 邊界。本次不含完整 Undo UI、歷史 Source 轉換或 Receipt 啟用。舊 new 草稿只有明確保留，沒有自動值匯入；現有未定義來源／歷史付款／收據相依刪除持續安全拒絕。

接手請 pull 原分支、npm.cmd ci、依 Windows／前階段 handoff 安裝忽略的本機 PostgreSQL 與 PGlite runtime。Git 不會帶走 .env、原生 binaries／clusters、.tmp-*、測試 trace 或暫存截圖。不要把歷史「未套用」文件當作正式環境現況，這次完全未讀寫 Hosted。
