# Issue #15 B-4d — retained 欄位同步與旅程匯率

2026-10-30，分支 `codex/budget-collaboration-redesign`，本機／GitHub 起點 `3ab87947cbfa85ac9d7896efbab46b58ef479109`，起初工作區乾淨。使用者授權本機實作、隔離測試與同分支 commit/push；沒有 Hosted DB／Storage／設定、main merge、手動部署或正式啟用。

## 盤點與實際支援

原有 Metadata Controller 已支援四欄窄寫、自動儲存、佇列、Snapshot deadline 與精確 release。B-4a 允許 Budget Title/Note，但沒有跨端 Bundle；Category/Payer 仍拒絕 retained。此次只擴充必要的 bundle/effect/vector，沒有改用 legacy 整筆 Save。匯率原本用 `update_trip_budget_rates`＋`apply_trip_budget_rate`；新路徑重用既有 Pricing calculator、租約表、版本表與 Payment 明確操作 Controller 策略。

| 情境 | 支援／安全界線 |
| --- | --- |
| Budget 無 retained | Title、Note、Category、Payer 只更新 Budget |
| 合法單筆 retained，包括 inactive | DB 解析 Budget＋Actual 同群組 Bundle，一次交易寫兩端；manual/generated 合法 current/origin/backlink 均以現有 Payment 圖檢查為準 |
| 多筆、origin-only／不一致來源、異常 backlink、fixed Budget | Budget 四欄 acquire/patch 拒絕；不猜測或修正歷史 |
| Actual 四欄直接修改 | 單向窄寫，不回寫 Budget；Category/Payer 仍須合法付款／來源圖；Title/Note 沿用 B-4b 已有獨立文字契約 |
| Category／Payer | 不清 subcategory；payer null 沿用合法規則，非 null 必須 approved member 並持 SHARE NOWAIT 到 commit |
| 規劃期旅程匯率 | 一次取得所有實際須重估的未 retained 外幣 Budget.pricing，原子更新 quote＋價格；TWD／retained（含 inactive 與歷史 origin）保持原值 |
| 匯率遇任一受影響 Pricing 租約 | 整筆拒絕，包括同帳號另一分頁；不搶租約、不部分更新 |
| 已出發、settled、已凍結 baseline | 匯率更新拒絕；歷史外幣與已知 Actual TWD 不重估 |
| Fixed 未 retained 外幣須重估／壞 backlink／不一致計價輸入 | 安全拒絕整筆匯率操作 |

四欄不修改 amount/rate/cost、participants、paid_at/active/history、source、receipt 或 provenance。匯率不重建 joins；沿用穩定 largest-remainder 的 `calculatePricing` 投影，既有 SQL 計價工具確認 mode/amount/unit/shares 精度與總額，無 join 舊資料保留 approved-member fallback。

## DB、安全與相容

CLI 建立唯一新 forward migration `20261030054628_budget_financial_dependencies.sql`，前56份 migration 不修改。新 private `budget_finance_protocol`、`budget_rates_leases` 啟用 RLS，無 client table grants／private publication。`enabled=false`、`activated=false` 預設關閉；一旦啟用過，activated latch 保持舊寫入隔離，pause 不放回不安全舊流程。Frontend `VITE_BUDGET_FINANCE_GROUPS` 預設 false，且需 Metadata 旗標。

新增 invoker/authenticated APIs：`budget_metadata_group_lease_v2`、`patch_budget_metadata_group_v2`、`budget_rates_lease`、`update_trip_budget_rates_v2`、`read_budget_metadata_snapshot_v8`。舊 Metadata 成功 signature／Request Ledger Replay 保留；新協定啟用後四欄新寫入／舊匯率 RPC 拒絕。Pricing／Links 舊安全 group API 仍委派現有實作。Payment v2、Source v1、Receipts v1 的 manifest 路徑保留。

Bundle 由 DB 解析，含每端 revision、pricing graph、epoch，capability 綁 actor/document-session/token hash；不依賴整列 updated_at 或無關付款日期。先 trip advisory，membership/protocol SHARE NOWAIT，parent NOWAIT，group canonical ordering；等待後重新檢查 actor、版本、expiry、完整集合。每個 effect 綁 transaction/backend/actor；新 manifest 列出每端完整 before-row 與窄寫 whitelist，Finish 對照真正 DB 結果，未 Finish 的既有 deferred effect constraint 阻止 commit。第二端故障會回滾資料、版本、ledger 與 Undo capture。

Rates vector 包含 rates/member revision 及全 Budget pricing/graph 集合，故等待期間 quote／retained／pricing／membership 改變均不得默默 rebase。長租約只持有實際需改價的 Pricing；rates root capability 獨立且七分鐘 TTL。quote 與同 quote initialization no-op 不推版本；實質 quote 更新推 ratesRevision、實際重估列推 pricingRevision。精確 release 只清同一 rates bundle。新 private quote writer 只接受當前 transaction manifest，不擴大 trips RLS 權限。

Snapshot v8 包裝原 v7，同一 STABLE SQL snapshot；新增 finance schema1、ratesRecords、四欄完整版本向量／supported。保留 v1–v7 與 Payment/Source/Receipts projections。private state 變更重用 opaque trip signal 與 coalesced reader；沒有新 channel／Snapshot manager。offline cache 剝除 finance authority。Strict validator 比對每端 revision、canonical 財務值、quote 與 schema。

## Undo 邊界

獨立單端 Title/Note 保留既定最多五步 DB Undo；native 實測同一 invoker inverse 成功。**跨端鏡射目前不支援 Undo**：不建立不完整 inverse、不 push 假操作，回傳 `undo_supported=false`／`mirrored_text_not_supported`，刪除實際 changed group 的舊 lineage，舊 pointer 即使仍存在也會被拒絕；不只還原 Budget。所有 before-row 仍保存在 transaction manifest 供安全驗證，但不宣稱它等同完整跨端 Undo 契約。

Category/Payer 不新增 Undo；Rates 成功只清目前 actor/tab/trip stack，失敗／no-op／Replay 不清。其他帳號／分頁或無關群組有效指標不被刪掉。沒有 Ctrl+Z／Redo／history UI。

## Formal／Demo 與恢復

既有四欄 autosave Controller 傳遞／持久化版本向量、吸收 canonical ACK 新 vector，保留原本單一在途 Patch、queued latest、IME、精確 release、idle 和 generation guards。新 Rates 是既有 Payment 明確操作 Controller 的小 strategy；原自動取得／手動「更新匯率」介面不變。未知結果保留原 quote/request，按原按鈕查證同一請求；已確認 ACK 後 Snapshot timeout 只重讀，不重送 rates transaction。ActiveEditorGuard 與 root/panel navigation 攔截未確認操作。

Demo 共用 UI／Controller／純計價工具，新增 memory adapter 與 React 更新前的 canonical overlay；不連 Auth／RPC／Realtime／Storage，不持久化請求。Demo 仍沿用既有保守 global pricing graph，不能宣稱等同原生並行吞吐。正式 HTTP／Realtime 真雙帳號仍未驗證。

## 修改檔案與重跑

| 層 | 檔案 |
| --- | --- |
| DB | 新 forward migration；`docs/qa/2026-10-30-budget-finance-rollback.sql` |
| Controller／validator | `src/lib/budgetFinanceGroups.js`、`budgetFinanceValues.js`、既有 `budgetMetadataService.js`／`budgetSync.js` |
| UI／Demo | `src/App.jsx`、`BudgetWorkspace.jsx`、`src/demo/budgetMetadata.js`／`budgetFinanceGroups.js` |
| QA | `tests/budget-finance-cases.mjs`、`budgetFinanceGroups.spec.js`、`formalBudgetFinanceGroups.spec.js`、`helpers/budgetFinanceMock.js`、既有 native harness／runner 的 `--finance` 篩選 |

只驗證本次與直接相依，不重跑舊完整186/373套件。最終結果、逐案、blocking PID 證據與來源 hashes 見 [選定 QA JSON](qa/2026-10-30-budget-finance-results.json)。

- 原生 PostgreSQL17.11：31/31，4個真正重疊觀察，獨立 LOGIN/backend/JWT actor/document sessions、observer advisory gates／pg_blocking_pids；不是依序呼叫宣稱並行。包含 dormant migration fault／reverse／ACL、12種四欄情境、雙端失敗、Title/Payer、同組、同帳號、過期／接管、撤權、異常圖、vector、real JS named RPC、Undo／舊入口、Rates/Pricing、Rates/Payment 等待、原子改價故障、出發保護。每次新 initdb，loopback 隨機port，finally 停止。
- Controller／Playwright／Mock：116/116，新增3 Controller＋4 rendered；直接相依 Metadata45、Payment19、Source14、Receipt17、Rates8、Snapshot6。Formal 是本機 mock，不當作 PostgreSQL／Hosted 證據。新 rendered 驗 inactive 鏡射、匯率顯示、ACK遺失重試及 Demo無外部呼叫。
- 因 Pricing 版本向量／Rates admission 直接相依，另補 Pricing Controller／Formal／Demo **16/16**（兩個既有 specs），沒有擴大至其他工作區全套。
- PGlite 原 Metadata23/23、Undo28/28：序列 SQL，只作直接相依回歸；不宣稱真實並行。
- Production Build、changed JS/MJS syntax、`git diff --check`：通過，既有 large-chunk advisory 保留。

初期發現：PL/pgSQL CASE 比較括號、invoker 不應直接呼叫 private value helper、local variable qualification、rates admission 缺 canonical value、JSONB quote key order 導致 ACK 誤判，均在隔離測試修正，沒有放寬 ACL/RLS。Mock 缺 attachments／paid_at 及 owner↔actor 映射造成失敗，補完整 fixture而非削弱 strict validator。首次 rendered 本機服務未啟動，後啟動再跑；focus 前需等畫面就緒，重新點入欄位後保持真正租約／鏡射斷言。失敗／中斷的 log 不計為通過。

未使用且未啟用 reverse 精確還原舊函式／ACL／policy／既有內容；activated／用過後拒絕，需 forward repair。Receipt 正式 HTTP／worker 驗收、未定義 Source 歷史轉換、空白新增／刪除、Undo UI、正式啟用均未開始。官方依據：[PostgreSQL locks](https://www.postgresql.org/docs/17/explicit-locking.html)、[Supabase function security](https://supabase.com/docs/guides/database/functions)。查閱2026-10-30；changelog markdown fetch MIME不支援，既有CLI版本未升級。

原生 final run `cfaf7471-5c04-45dc-8617-9591fa6b98b2` 已停止；loopback CLI Advisor／migration-list 均因既有 TLS 要求未通過，不能宣稱 Advisor 認證。

UI 驗證採既有 Playwright（Browser plugin unavailable）；1440×1000 匯率更新截圖已檢視，正確頁名、沒有Vite overlay／console error，JPY0.25、整旅程500／每人250。圖片留在工作區外 visualizations，不提交。

最後 authority audit 修正：Rates exact release 在未建立 root 時不 INSERT；acquire 才於 approved edit membership 驗證後建立。原生斷言跨 Trip release／acquire 都不留下私有租約列，且新增 private tables RLS、零直接授權／publication。最終31/31；Advisor TLS限制保留前一輪同階段隔離 marker證據。
