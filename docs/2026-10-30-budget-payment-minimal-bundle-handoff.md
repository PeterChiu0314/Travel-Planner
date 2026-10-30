# Issue #15 B-4a — Payment 最小相依 Bundle

起點 `3af163f7c49aa2eb0a4bd226d7cb3ac6b9c51a56`，分支 `codex/budget-collaboration-redesign`。僅本機實作、隔離測試及 feature-branch commit/push；不操作 Hosted、Storage、main 或部署。原工作區乾淨。

## 實作前相依矩陣

| 操作 | 舊長租約 | 新長租約 | 仍須驗證 |
| --- | --- | --- | --- |
| 首次 Paid | Budget.payment/pricing/payer | 同左 | committed pricing、payer、participants、membership、graph/rates/source |
| 單筆 retained Paid/Unpaid | Budget 與 Actual 的 payment/pricing/payer | Budget.payment + Actual.payment | 完整 retained 集合、所有相關 committed revisions、graph/rates/member/source |
| 多筆 retained Paid/Unpaid | 每端 payment/pricing/payer | Budget.payment + 每筆 Actual.payment | 完整集合、每端版本/epoch，不聚合、不重建 |
| Actual paid_at | Actual.payment | 同左 | 日期及必要來源／相依版本 |
| 不合法來源／付款圖 | 拒絕 | 拒絕 | 不退回 legacy Save |

## 協定與回滾計畫

沿用 request ledger、effects、短 trip advisory transaction、parent/child NOWAIT、原金額模型及 ActiveEditorGuard。新版本 lease RPC 明確接收付款意圖；DB 解析集合，將意圖、必要群組、版本與各端 epoch 綁定 bundle，Prepare 再驗。新 Snapshot 宣告版本；舊無意圖 lease 僅保留精確 release，新 acquire/renew fail closed。已成功 request replay 維持原 immutable signature 與結果。

租約 targets 與只讀 checks 分開：減少長租約不減少 committed financial/dependency version checks。狀態切換只寫 active，不變更 pricing/payer epochs 或內容；graph 前進讓舊 Pricing intent 拒絕，保留本機草稿。新 migration 只 forward；未使用且 inactive 時可精確 reverse，已使用則 forward repair，不刪 ledger 或回退財務資料。

## 重現與原因

先新增 `minimal bundle: retained Unpaid admits beside another actors live Pricing lease`，未修改產品 SQL／Controller 即在隔離 PostgreSQL 執行。run `8abca4d1-a975-4ce0-a67c-154eeb9d8e34`：A 正常取得 retained Budget.pricing，B Payment admission 回 `granted:false`，必要的成功斷言失敗。舊 `budget_payment_dependencies` 對每端無條件展開 payment/pricing/payer，並非金額寫入所需的真實相依。

該基準另有既有 choice reverse 比較失敗：Windows CRLF 與 reverse 內 LF 的函式 body 不同。native harness 現在以 LF 執行 migration source，catalog comparison 只正規化 CR；函式 SQL、grants、業務內容斷言保留，未更改任何舊 migration。後續全鏈通過。

## 實際協定

- 新 CLI 2.106.0 產生 [forward migration](../supabase/migrations/20261030012554_budget_payment_minimal_bundle.sql)。沒有升級依賴、修改舊 migration 或新建資料表。原 `budget_payment_targets`、financial invoker mutation、Finish、金額計算、RLS、effect/ledger/graph tracker 保留。
- 新 `budget_payment_lease_v2` / private admission-v2 多一個 `p_intent`（paid/unpaid/set_paid_at）。DB 按來源圖及 intent 自行決定長租約，bundle 保存 intent、versions、每端 epoch；grant 回傳 intent/targets，Controller 嚴格比對。Prepare 再解析目標、驗 intent 與精確 epoch 集合，取得首次 Paid 不能換成 Unpaid；renew 不能換意圖。
- 原 lease RPC 不再新 acquire/renew，回 `55000 payment_intent_protocol_required`；精確 release 保留。新 API 的 release 也以原 bundle、actor/session/token/root epoch 及每端 epoch 釋放，不會釋放 takeover 後的 peer。
- `versions.targets` 為通常 Paid 所需最小群組；`versions.checks` 是所有相關已提交 Pricing/Payer revision/graph（Actual 日期也含來源 Budget），不取得其長租約。無 retained 的 Unpaid no-op 使用 payment-only grant；其 snapshot 仍保留首次 Paid 的 prospective targets，Controller 依明確 intent 驗證 grant。rates/member/source/root graph checks 保留。只有授權交易及 CAS 一致才寫入。
- 新 STABLE/invoker `read_budget_metadata_snapshot_v5` 宣告 metadata schema5 / payment schema2，沿用同一 v4 financial snapshot 及既有 opaque signals/channel；v1–v4 readers 不移除。舊 reader 的 payment value 增加 checks、targets 收斂，但舊無 intent 寫入 fail closed。Formal opt-in 改讀 v5；缺 API 只讀／保留草稿，無 fallback。
- Strict Validator 驗 records 完整、financial active/paid_at、精確最小 targets/checks、metadata revision/graph 對照與 epoch grant。Controller 仍沿用 10 秒 deadline、單一 request transport、exact replay/release、generation fence、ActiveEditorGuard；不重送已 ACK 操作來修 Snapshot。
- pending ledger 新寫 version2、無 token/epoch。既有 version1 只允許原 session/request/payload 查證舊 receipt；不能重新 admission，必須以新 v5 權威 Snapshot 收斂。DB 原 immutable signature/result 未重寫，真正升級前成功 receipt 另做 SQL 驗證。
- Demo 延伸原 memory lease map／pure payment transition，不連接任何服務或儲存草稿。使用同樣 minimal targets、intent、checks、epoch 及 stale Pricing graph 拒絕；UI 的 Toggle、Actual 日期、inline 錯誤及 guard 不新增第二套狀態管理。

## 修改檔案

| 範圍 | 檔案 |
| --- | --- |
| DB | 新 migration、[dormant reverse](qa/2026-10-30-budget-payment-minimal-bundle-rollback.sql) |
| 協定／讀取 | `src/lib/budgetPaymentGroups.js`、`budgetPaymentValues.js`、`budgetMetadataService.js`、`budgetSync.js` |
| Demo | `src/demo/budgetPaymentGroups.js`、`budgetMetadata.js` |
| 原生測試 | `tests/budget-payment-minimal-cases.mjs`、`budget-payment-group-cases.mjs`、`budget-metadata-parallel.mjs` |
| Controller／UI／Mocks | `tests/budgetPaymentGroups.spec.js`、`formalBudgetPaymentGroups.spec.js`、`helpers/budgetPaymentMock.js`、`helpers/budgetMetadataMock.js` |
| 文件／證據 | 本文件、CURRENT_TASK、B-4a 交接連結、selected QA JSON |

原生案例涵蓋首次 Pricing/Payer 排他、retained Unpaid/re-Paid 與 Pricing 真實重疊、舊 Pricing CAS 拒絕、已提交 Pricing 後 Payment fresh read、完整多筆 payment targets、單端 payment contention、相反 intent 重疊、retained 集合等待後變動、expiry/takeover/late release、無能力 replay、不同 payload 拒絕、no-op、第二端／child 注入失敗全 rollback、已知扣款/外幣/歷史/收據/joins 保留、來源不合法及撤權/RLS。

注意 retained category/payer 的新 UI／同步仍不支援。本輪 payer 並存用隔離 DB 的已持有 capability fixture 驗證；沒有為此開放 retained payer acquire/patch，也不把 fixture 說成已完成 payer UI 驗收。

## 驗證與限制

| 最終驗證層 | 結果 |
| --- | --- |
| 原生 PostgreSQL 17.11 | **148/148**（原133＋15），**46**筆真正 overlap/held-lock observations；`127.0.0.1:12618`，run `02c365be-cdfc-4aeb-905d-228560b98055`，cluster 已停止 |
| 完整相關 Playwright／Controller | **351/351**，4.6分鐘，0 skipped／unexpected／flaky；原342＋6新 Controller＋2新 UI＋另含既有 LiveAudit mock 測試。Payment Controller19／UI10 在批次內，不能重複加總 |
| 修正後受影響專項 | **48/48**：Payment Controller、Pricing UI、完整 legacy lease；與完整批次重疊 |
| PGlite／既有 DB | Metadata **23/23**、Undo **28/28**；budget-database、budget-safety-database、budget-leases-database 全鏈通過。舊 lease raw-SHA guard 使用最新來源的 LF disposable mirror，workspace 舊檔與斷言不變 |
| Build／Syntax／Diff | Production build、所有變更 JS/MJS `node --check`、`git diff --check` 通過；既有 large-chunk advisory 保留 |
| 原 migration 保存 | **53/53** 與起點 Git logical source SHA-256 一致，僅新增 forward migration |

完整結果、blocking graphs、source hashes 與已停止證據：[selected QA JSON](qa/2026-10-30-budget-payment-minimal-bundle-results.json)。Native 是獨立 LOGIN/backend/JWT 的真正 PostgreSQL；PGlite 是序列 SQL；Formal 是 Auth/RPC/Realtime/Storage mocks；Demo 是共用 React UI 的 memory transport，不能混稱 Hosted 驗證。

Browser plugin 不可用，使用既有 Playwright/Chromium。流程：預算明細首次 Paid → A 計價草稿 → B retained Payment 切換 → A 草稿仍在且版本衝突；另含 Actual paid_at、unknown ACK、Snapshot timeout、legacy flag-off、Planning/Actual/Settlement、Demo 零外部流量。保留 console/page-error 斷言。初次受限 browser 有 ERR_NETWORK_ACCESS_DENIED；改在允許 localhost 的執行環境重驗。新增兩案最初誤要求狀態變更後 updated_at 不變，修正為只排除合法 updated_at，其他欄位與 join 安全斷言保留。

第一完整前端 batch 348/350：嚴格 checks 與 metadata revision 對照揭露 Demo 的 React props 尚未跟上 ACK 時，Payment value 又從舊 props 重讀 group state，造成剛建立的 Snapshot 不一致；顯示「已儲存，最新同步待確認」。修正為同次 read 共用 metadata records revisions，且 ACK override 只有真實 props 收斂才清除；新增三次連續 read＋故意延後 props 的 controller 測試，不能退回舊 canonical。既有 12 分鐘 legacy 心跳案該批未觀察到首筆 renew；原案例單獨在允許 localhost 環境通過，未修改該產品或測試、不能宣稱已證明 transient 根因。最終完整批次結果另列。

補上出發後外幣／known debit 實測後，一次 native batch 的舊自然到期案在 observer barrier 回傳 expired 後仍看到 held。該 barrier 把 pg 解碼的 JavaScript Date 當 deadline，會截斷 PostgreSQL 微秒，最多提早近 1 ms；已改為 SQL `expires_at::text` 保留完整精度。不增加 sleep、不改 TTL／產品權威，也不放寬過期斷言。run `beb627c3-dd43-4f70-b4b5-3e9bcf2daa03` 其餘147案（含新歷史外幣案例）通過；最後全鏈重驗另列。

CLI Advisor／migration-list 僅對新 loopback cluster 嘗試，仍因 `server refused TLS connection` 無法執行；原生 SQL RLS/grants/invoker/search_path/catalog 測試不是完整 Advisor certification。無 Hosted PostgREST/Realtime 真帳號、混合 client/Storage bytes、實體 IME/PWA/background/screen-reader speech 驗收。

origin-only、缺失／跨旅程／矛盾來源、壞 backlink、fixed 與不合法 retained 圖維持 fail-closed；pricing 自身歷史／已知成本規則不放寬。Receipt/Source 新功能、retained category/payer 雙端同步、空白新增、Undo UI 都沒開始。新旗標及所有 DB protocols 預設 false。

Reverse 僅用於未成功使用 Payment、protocol disabled、無 active leases/effects 的隔離環境；精確恢復前版函式/grants，不更動金融資料。已有成功 request 時拒絕 reverse，即使關閉 protocol 及清 leases，仍需 forward repair。

參考 [Supabase functions](https://supabase.com/docs/guides/database/functions)、[PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html)。2026-10-30 查閱 [changelog](https://supabase.com/changelog)；Markdown endpoint 不支援，改 HTML。沒有 SDK/CLI 升級或 Hosted 呼叫。

```powershell
node scripts/qa/run-budget-metadata-parallel.mjs --advisors
$env:PGLITE_MODULE=(Resolve-Path '.tmp-budget-db-runtime/node_modules/@electric-sql/pglite/dist/index.js').Path
node tests/budget-metadata-groups-database.mjs
node tests/budget-metadata-undo-database.mjs
node tests/budget-database.mjs
node tests/budget-safety-database.mjs
# 舊 lease suite 在 LF disposable mirror 執行，需包含最新完整 migration chain。
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:5180'
$budgetSpecs=rg --files tests -g '*.spec.js' | Where-Object { $_ -match 'tests[\\/](budget|formalBudget|unified-budget|demo-budget|appToasts|notifications|phase-1-7f-smoke)' } | ForEach-Object { $_.Replace('\','/') }
node node_modules/@playwright/test/cli.js test $budgetSpecs --workers=1
npm.cmd run build
git diff --check
```
