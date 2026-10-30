# Issue #15 B-4b — Source 來源關聯與資料套用

起點 `c136244f4a039bfbc2de3ba3c93023c872a69288`，本機／GitHub 同步、工作區乾淨。只做本機 forward migration、隔離 QA、文件及 feature-branch commit/push；Source/Payment/Metadata/Undo DB protocols 與前端旗標保持 default-off，不連 Hosted／Storage、不改 main、不部署。

## 實作前相依矩陣與支援邊界

| 情境 | Current／Origin／backlink | 決策與寫入 |
| --- | --- | --- |
| manual、無 current/origin → Budget A | current=A，首次 origin=A；保留 manual provenance、既有 backlink | 支援 relink；只寫 current＋既有 Trigger 定義的首次 origin，不寫財務／文字／payer／joins |
| manual current=A、origin=A → unlink | current=null，origin=A；沒有指向本 Actual 的 generated backlink | 支援，保留歷史／身分；A 的歷史 origin-only 邊界仍令 Payment/Pricing fail-closed，不能當成零 retained 再付款 |
| current=A、origin=A → B | 舊 Trigger 會將 origin 覆寫 B，且現有 Payment 拒絕 current/origin 不一致 | **拒絕／待產品決策**，不清歷史或創造不相容來源圖 |
| origin-only → 任一非空來源 | 歷史存在／原來源已刪除都不代表可重建目前來源 | **拒絕／待產品決策**；不把 manual provenance 當 origin-free |
| generated retained → unlink/換來源 | 會留下原 Budget backlink 或需修正付款身分 | **拒絕／待產品決策**；same-source 操作可驗證後 no-op／apply |
| manual link → 已有合法 retained 的 Budget | 完整 old/new 集合、同旅程、backlink 合法 | 支援，不聚合、不更新其他 Actual；多 retained pricing 既有拒絕不放寬 |
| 收據／known debit／歷史外幣 relink | identity、participants、cost、rate、history、attachments 全保持 | 安全圖可支援；不回算或重掛收據 |
| apply-source-data | current 合法且 origin 不需覆寫；copy DB committed pricing/participants/payer/title/category/note | 原子完整套用；known debit 不同、歷史外幣重估、settled、不合法來源／成員等整筆拒絕，不偷偷部分成功 |
| missing/cross-trip/fixed/bad backlink/矛盾 origin | 無法證實完整來源及付款圖 | 拒絕；不修補原資料、不 fallback |
| same source、同全部套用內容 | current/origin/backlink 完全不動 | no-op，不推進無關版本、不消耗 Undo |

舊 `keep_actual_budget_origin` 的實際語意：非空 current 設 origin=current，解除 current 保留 old origin；`keep_actual_twd_cost` 對一般 update 可能將 generated provenance 轉 manual。施工前先增加原生 baseline cases 驗證這些行為，以及 FK SET NULL 後保留 origin/known debit/receipt target，再建立新的 migration。這不是授權沿用破壞歷史的 legacy 更新。

## Bundle／版本／交易計畫

Relink 長租約：Actual.source＋舊／新 Budget.payment；無關 Title/Note/Pricing/Payer 不取長租約。Actual.payment/pricing/payer、相關 Budget 圖、retained 集合、membership/rates/source 以只讀 vector 保護。不同群組草稿不會因 Source 操作清除；已使用舊圖的 Pricing/Payment intent 必須拒絕。

Apply：Actual.source＋真正會變動的 Actual title/category/note/payer/pricing 群組＋必要 Budget.payment（拓樸變更時）。所有讀取的來源及目的群組版本、完整 parent/participant 集合納入 checks；來源必要 Pricing/Payer 若已有其他編輯權則拒絕，但不替只讀來源取得新的長租約。DB preview 回傳 before/after 差異與完整 vector；確認後 admission/Prepare 都再次解析，不能靜默擴權或使用舊摘要覆蓋。

沿用 private group/effect/immutable request ledger、Trip advisory、全域排序 parent/child NOWAIT、invoker mutation、精確 capability/session/epoch/TTL、未知結果同 ID、ActiveEditorGuard／generation fence／10s deadline。新 Source operation 及 snapshot 版本獨立宣告，既有 v1–v5 和 Payment replay 保留。Source 不進文字 Undo，只有成功變動才 fence affected lineage/清本 actor/tab 的不可逆 stack；別人的無關 stack 保留。

回滾：未使用且 inactive 可精確恢復函式/grants、移除未用新物件；成功 request 存在後只能 forward repair，不回退財務資料、不刪 audit。Receipt 僅驗證 reference/metadata 不變，不做 byte 操作或新生命週期。

## 實際實作與相容性

- 新 forward migration `20261030021719_budget_source_atomic_groups.sql`，由 Supabase CLI 建立；沒有修改前 54 個 migration。Source protocol 表維持 RLS、無 client table grants、無 Realtime publication，初始 false。
- 新 public SECURITY INVOKER RPC：`read_budget_source_preview`、`budget_source_lease`、`mutate_budget_source`。Preview 只有讀取，不取權。Private resolver、admission、prepare/finish 沿用既有 group/effect/request ledger，成功 receipt 的 signature 區分 action/destination/actor/tab/base/version；exact replay 可在精確 release 後驗證，不重新取得 capability。
- Relink SQL 僅寫 `budget_item_id`／合法首次 `budget_origin_id`。Apply 明列允許欄位，不複製整筆 record；Participants 用 delta insert/update/delete，既有成員 join ID/created_at 保留。Manifest 比對完整 parent（僅排除 updated_at）及完整 join rows，Finish 之前任何 child 或 parent 故障都回滾；未 Finish 的 effect 由既有 deferred constraint 拒絕 commit。
- 新 `zz_source_boundary` 檢查 linked INSERT、current/origin UPDATE、linked/origin-bearing DELETE；Source enabled 時，舊 whole Save／raw SQL／Budget FK SET NULL 不能繞過。必須有當前 backend/transaction/Auth 綁定的 Source/Payment/Pricing effect。**Source 啟用後，既有來源 Budget 的刪除會安全阻擋，直到後續 lifecycle 明確授權；這不是已完成的新刪除功能。** origin-free manual 的一般 legacy 操作保留原保護。
- Origin trigger 為讀取 private transaction-bound manifest，改用窄範圍 SECURITY DEFINER、空 search_path 並撤銷直接 client execute；沒有對金融 RPC 改 definer、沒有降低 RLS。成本/provenance trigger 只豁免精確 Source effect 或已授權 Actual title/note effect，Relink 不把 generated provenance 轉 manual。
- Actual title/note 在 Source protocol 下可與 Relink 共存；Apply 若會寫該群組，必須取得對應 bundle。這沒有開放 retained category/payer 日常跨端同步。
- 明確新增 `read_budget_metadata_snapshot_v6`（metadata schema6、Source schema1），在同一 SQL snapshot 組合舊 v5 金融投影與 Source hints。v1–v5 readers 與 Payment schema2/immutable 舊 receipt replay 保留；前端 opt-in reader 讀 v6，缺少 RPC 可顯示既有財務資料但協作唯讀，不能 fallback 到舊 Save。
- `budgetSourceValues.js` 嚴格驗證 Source projection／preview／admission／protected fields。`budgetSourceGroups.js` 只是既有 `createBudgetPaymentController` 的 Source strategy，沿用一個 operation transport、10 秒權威 timeout、unknown 原 ID、精確 release、read-only reconcile、generation/actor/trip fences。沒有第二套 Snapshot manager 或金額計算器。
- Formal unknown request 的 sessionStorage 只保留無 capability 的原 request；token/epoch 為 null，只能查證已提交結果，不能拿它重新寫入。Demo 不使用此持久化。
- 共用 `BudgetSourceEditor` 嵌入 Actual 右側編輯器，MenuSelect 不會 seed 其他欄位；Relink 是明確提交，Apply 先顯示 DB committed 的逐欄／participants 差異，再確認。沿用 SiteDialog、inline status、ActiveEditorGuard。來源選擇、未確認 request、釋放或 Snapshot 未確認都阻止靜默離開。
- 新協定 opt-in 時，舊完整 Actual Source picker 明確唯讀，事件 handler 也不會執行全表單 seed。Planning 中既有單筆 retained 的入口導向同一 Actual 編輯器；沒有重建獨立付款紀錄頁。
- Demo 共用 React UI／既有 finance delta 與 calculatePricing；memory-only resolver 模擬相同拒絕邊界、版本、group targets、精確 epoch、unknown replay，保留身份及 receipt references。Scenario hydration 與 memory finance props 變更透過既有 coalesced reader 收斂，沒有 Auth/RPC/Realtime/Storage 呼叫或新 persistent draft。

## 檔案清單

| 層 | 檔案 |
| --- | --- |
| DB | `supabase/migrations/20261030021719_budget_source_atomic_groups.sql`、`docs/qa/2026-10-30-budget-source-rollback.sql` |
| 共用協定 | `src/lib/budgetSourceGroups.js`、`budgetSourceValues.js`；既有 `budgetPaymentGroups.js`、`budgetMetadataService.js`、`budgetSync.js` |
| 共用 UI | `src/components/budget/BudgetSourceEditor.jsx`、`BudgetMetadataEditor.jsx`、`BudgetWorkspace.jsx`、`src/App.jsx` |
| Demo | `src/demo/budgetSourceGroups.js`、`budgetMetadata.js`、`budgetPaymentGroups.js` |
| SQL QA | `tests/budget-source-baseline-cases.mjs`、`budget-source-group-cases.mjs`、`budget-source-safety-cases.mjs`、`budget-source-database.mjs`、既有 `budget-metadata-parallel.mjs` |
| Controller/UI QA | `tests/budgetSourceGroups.spec.js`、`formalBudgetSourceGroups.spec.js`、`helpers/budgetSourceMock.js`、既有 `helpers/budgetMetadataMock.js`／`budgetPaymentMock.js` |
| 交接 | 本文件、`CURRENT_TASK.md`、Source/Receipt 盤點 crosslink、`docs/qa/2026-10-30-budget-source-results.json` |

## 發現問題與修正依據

1. **實作前 native baseline**：run `b27a1b41-ebca-4e82-8695-5e4b67bd9655` 為 151/151，先證明舊 Trigger 的 first origin／unlink／relink overwrite、generated detach 與 FK SET NULL 行為，之後才新增 Source migration。沒有憑欄位名稱推定歷史語意。
2. 第一 native 實作 run 112 pass/23 fail，Origin invoker trigger 不能執行 private effect lookup。修正 trigger 的受控 definer 邊界，沒有擴增 authenticated helper 權限；後續 SQL 編譯又抓到 JSONB operator precedence／PLpgSQL alias ambiguity，已修正。
3. 強 no-op 全狀態比對抓到 Prepare 沿用 renew 時改寫 expires_at。改為 private `validate`，只檢查完整既有 bundle，不修改 lease 或任何 epoch。原全狀態斷言保留。
4. Demo Relink 最初不必要地重建 Participants，會把原 null/缺省表示轉換；改為只有 people logical delta 真正改變才寫 collection，Relink 原集合完全保持。
5. UI known-debit 拒絕後點關閉，抓到 Source guard ID 將 trip 放在非尾端，現有 guard scope parser 無法辨認。改為 `budget-source:<id>:<trip>`，保留草稿並出現現有 Continue/Discard 路徑。
6. 真正 Demo 情境切換揭露無 Realtime 的 memory hydration 未刷新 group Snapshot，以及 unsupported Pricing projection 缺少 participantIds 造成共享編輯器 crash。沿用既有 reader refresh，unsupported 僅顯示 canonical 金額，不建立假的可寫表單；Demo pageerror／零外部流量斷言通過。
7. 後續 native 183/184 的新 Pricing/Relink overlap test 在 A gate 之前失敗：fixture Participants 已推進 Pricing revision，而測試使用 default0。改從 confirmed preview checks 取 base；沒有增加 timeout、修改產品版本規則或放寬斷言。後續 184/184，另補歷史外幣及 Source parent-first NOWAIT 案再全鏈驗證。
8. 初次前端 batch 因執行環境中斷只完成到 259，不能當通過。恢復時 dev server 已停止，重跑全部測試的腳本另有 Windows path filter 問題而選到 874 案；觀察到 ERR_CONNECTION_REFUSED 後中止，重啟 localhost、以檔名挑選 32 specs。完整最終結果以選定 JSON 證據為準，不混算中斷或連線失敗批次。

## 驗證與界線

最終結果：native **186/186**、**54** 筆 overlap/held-lock observations；run `91f7a685-d558-4ee4-a6a4-8505d7be20cf` 已停止。完整相關 Playwright **373/373**、32 specs、0 skipped/failed/flaky。Source 新增 Controller14＋rendered8 均在此完整批次內。每案結果、blocking graph、環境、54 份舊 migration preservation hashes 及實作 source hashes 由 [選定 QA 證據](qa/2026-10-30-budget-source-results.json) 記錄。

- 真正 native PostgreSQL **17.11**，每次新 initdb，127.0.0.1、隨機 port／marker、兩個不同 LOGIN/backend/JWT，observer 觀察 pg_stat_activity／blocking pids。既有 46 筆觀察及新增 Source title、exclusive、Pricing、member wait、retained wait、Payment、Payer、parent-row NOWAIT 證據分別保存。PGlite 不充作並行證據。
- Source 序列 SQL **25/25**，另外 **8** 案只在 native 跑，明確 SKIP；Metadata SQL **23/23**、Undo SQL **28/28**，三個完整 migration chain suites（budget-database／budget-safety-database／budget-leases-database）通過。舊 lease suite 在忽略的 LF source mirror 跑，所有新 migration 包含在內，既有 migration 原檔不動。
- Source Controller **14** 案、Formal/Demo rendered **8** 案包含零權限 preview、兩種 action、custom atomic、known-debit、unknown ACK／單一 transport、Snapshot pending／read-only retry／晚到隔離、離開 guard、同帳號 capability、跨 Context、release failure、offline 確認恢復、嚴格 schema 與缺 RPC；屬本機 Mock／memory transport，不能當 Hosted PostgREST 認證。
- 桌面 1440×1000 截圖已檢視：來源 current/origin、兩個清楚動作、原 Actual title/note/payer 留存，無新頁面／重疊遮擋。檔案在 workspace 外的 visualizations 目錄，不提交測試財務畫面。
- Production build 通過，保留原有 >500KB chunk advisory；changed JS/MJS syntax 及 `git diff --check` 通過。無 npm dependency 變更。
- CLI Advisor／migration-list 只嘗試新的 loopback cluster，仍被 `server refused TLS connection` 阻擋；原生 RLS/ACL/search_path/invoker tests 不是完整 Advisor certification。沒有 Hosted 呼叫、Hosted migration／資料／Storage bytes／設定變更、main merge 或手動部署。
- 現有 frontend `VITE_BUDGET_METADATA_GROUPS` 預設關閉；Metadata、Payment、Undo、Source private protocols 都預設 false。正式 Hosted PostgREST/Realtime 真帳號、混合舊 client、實體 device/PWA/IME/screen-reader speech、效能與 Storage 生命週期仍未驗收。

## 後續接手

先 review 本分支的 Source boundary、最小 bundle/vector、private manifest 邊界與選定逐案證據，再決定下一個切片。A→B historical origin、origin-only reconnect、generated detach 與 Source-enabled linked deletion 都仍需明確產品／完整 lifecycle 契約；不能透過清 Origin／backlink、重建 Actual 或 legacy fallback 解鎖。Receipt Storage 新生命週期、retained category/payer 一般雙端同步、正式空白新增、五步 Undo UI、Redo/history UI 及整套正式啟用都沒有開始。

在另一台機器拉取分支後，程式與 migrations/rollback/QA 文件可以續作；npm dependencies、本機 PG/PGlite runtime、`.env`、ignored clusters/traces 不在 Git。沿用 Windows setup 與前一份 [minimal bundle 重跑步驟](2026-10-30-budget-payment-minimal-bundle-handoff.md)，新增 `node tests/budget-source-database.mjs`，native runner 已包含所有 Source cases；不要連 Hosted 重放。
