# Issue #15 B-4a — Payment lifecycle

起點 `abee7c0be9a45c1cd034caaa395d3db5737220b8`，feature branch `codex/budget-collaboration-redesign`，pull 已確認 0/0；原有五個 untracked files 保留。只做本機 forward migration、隔離 QA、文件與 feature commit/push，所有新 flags/protocol default off，不連 Hosted、不改 main／Storage／Issue。

## SQL 前動作與相依矩陣

| 動作／情境 | 相依與寫入 | 決策 |
| --- | --- | --- |
| 首次 Budget Paid | DB 解析 Budget.payment + pricing + payer，驗證 committed money/approved participants/payer，建立 Actual + joins + backlink | 單交易；不使用前端整筆 form；title/note 窄寫可獨立並行 |
| 單筆 retained Unpaid | Budget.payment + Actual.payment 及必要 pricing/payer 排他；只改 active | 保留 ID、cost、participants、history、source、receipt；不刪除或重估 |
| 再 Paid／inactive pricing 後再 Paid | 同一 retained 集合、版本與群組權限 | 恢復原 Actual，不 copy Budget 舊 metadata/payer，不重建 joins |
| 多筆合法 retained | 同一次操作取所有必要群組；各端 payment version | 保留逐筆身份與歷史，全部 active 狀態一次變更，不加總重建 |
| Actual paid_at | Actual.payment 與可證實的 source graph；只更新日期 | 明確操作；來源不明／origin-only 拒絕，不觸及金額、付款人與來源 |
| 他人持有 Pricing／Payer，或舊整筆 lease | capability/session/epoch/TTL/versions，短 trip lock + row NOWAIT | 拒絕並可恢復；不藉同帳號共用其他 tab capability |
| 未知結果／逾時 | 既有 immutable metadata request ledger，固定 action/vector/request ID | 原請求 replay，不產生新 Actual；不同 payload 同 ID 拒絕 |
| source-only／跨旅程／不明 provenance／壞 backlink／fixed | 不可證實的完整金融圖 | fail-closed；不改來源、不刪 cost/history/receipt |
| 取消／重試／離開／帳號旅程切換 | 共用 ActiveEditorGuard，generation fence，權威 Snapshot | 操作中停用 toggle；未知結果不丟棄；舊 ACK 不更新新畫面 |

## P2 調查與既有機制

- P2-1：舊 `budget_pricing_targets(actual)` 只檢查 `budget_item_id` 與 `payment_origin`，未檢查保留的 `budget_origin_id`。`keep_actual_twd_cost` 在一般 unlink/edit 可能改為 manual，但來源歷史仍保留；新 forward migration 必須拒絕 origin-only，不能自行修正成 standalone。對仍存在來源 Budget 的 origin-only 參考也不能當作零 retained 再建付款。
- P2-2：共享 PricingFields 的 currency change fallback 直接保留舊非 1 匯率，JPY→缺 quote 的 USD 可能沿用 JPY rate。將缺 quote 明確清空，顯示「尚無此幣別的旅程匯率」，無預覽／不可提交；保留其他草稿，quote 恢復後重驗版本，不盲目 rebase。
- 沿用現有 metadata groups、effects/deferred finished guard、request ledger、opaque signals、financial Snapshot 與 BigInt/numeric money engine。Payment 是 explicit action，另有短 bundle admission／release，不加入自動儲存欄位。
- 研究 [TanStack mutations](https://tanstack.com/query/latest/docs/framework/react/guides/mutations)、[Supabase functions](https://supabase.com/docs/guides/database/functions) 與 [Storage RLS](https://supabase.com/docs/guides/storage/security/access-control)。專案已有 serial controller/guard，新增完整 client-state 套件無法取代 DB 原子性，故不新增依賴／第二套金額或同步模型。

## 實作與驗證

本文件的動作矩陣先於 SQL 變更。CLI 建立的新 forward migration 為 [20261029134206_budget_payment_lifecycle_groups.sql](../supabase/migrations/20261029134206_budget_payment_lifecycle_groups.sql)，先完成 DB lifecycle／故障注入與原生並行，再接 controller／Formal／Demo。沒有更動任何舊 migration。

### DB 變更與支援邊界

- 沿用 `budget_metadata_groups`／request ledger／effects，新增 operation group `payment`、private `payment_bundle`／`payment_manifest` 與 **預設 false** 的 private RLS `budget_payment_protocol`。新 table 無 client grants／publication；protocol 變動透過既有 opaque signal 通知。Metadata／Undo protocol 與前端 flag 也維持預設關閉。
- 新 invoker `budget_payment_lease` → private admission。點擊時 DB 解 dependencies：Budget 取 Budget 與所有合法 retained 的 payment/pricing/payer，Actual paid_at 取 Actual.payment。每組 capability/session/epoch、2 分鐘短操作租約、版本與 graph/rates/member/source vector 必須完整，renew/release 精確作用整個 bundle；same-account tab 不共用。trip advisory → member/trip/parent/participants 的短 row locks，parent/child NOWAIT 防 row-first deadlock，等待後重解完整集合與 vector。舊 whole-row lease／legacy lock 與新群組雙向排他。
- 新 invoker `mutate_budget_payment_v2`，只收 `action`／合法 paid_at／dependency versions。Private Prepare 校驗 Auth／approved editable role、整個金融圖、每組權限、已提交金額與合法 participants／payer，保存 DB full before/after manifest；invoker 只執行 manifest 的 inserts／active／paid_at／首次 backlink。Finish 校驗每端完整保護欄位、精確 participants、全部 capability／expiry／epoch，才推 payment revisions 和 immutable request receipt。Deferred unfinished-effect guard 禁止 partial prepared commit。
- 首次 Paid 使用既有共用 `calculate_budget_group_pricing` 驗證 DB committed money，再複製當下已提交 Budget 與 participants。TWD 記錄 known actual debit，外幣沿存檔匯率 estimated，不傳 frontend whole form，不讀他人本機 Pricing／Payer 草稿。只建立一筆 Actual 與稳定 ID/backlink；相同 actor/request/session/原 payload replay 同一結果，不同 payload 同 ID 22023 拒絕。
- 已有一／多筆合法 retained（含 manual linked）時，Paid/Unpaid 只切每筆 `payment_active`，不刪除、不聚合、不改 money/payer/source/paid_at/history/receipts、不重建 participants。新增 exact payment effect 讓舊 known-cost/provenance trigger 只在精確合法交易保留原 source；一般 legacy behavior 不改。非空原付款歷史、收據、join IDs 與已知 debit 的 roundtrip 有 SQL 保護測試。
- Actual.payment `set_paid_at` 為明確日期操作，限制有限合法 timestamp，其他 parent 欄位與所有 joins 保留。standalone 需 manual 且無 link/origin；linked 需同旅程可證實來源、非 fixed、origin 不矛盾。不支援的 origin-only、source 缺失、fixed/backlink 壞圖整筆拒絕。
- payment mutations 不進文字 Undo。只使 affected record lineage、當次 actor/session 的不可逆 stack 失效，保留其他人的不相關 pointers。既有 28 個 Undo DB 情境及全部原 pricing/native 情境保留。
- 新 `track_budget_payment_versions` 對 legacy paid_at/activity 更新推進 payment revision，activity 改變也使 Actual／來源 Budget pricing graph 失效。新操作由 Finish 統一推進，不因 No-op／heartbeat／replay 重複 bump。v1/v2/v3 snapshot source 保留，新 STABLE/invoker `read_budget_metadata_snapshot_v4` 含同一 financial graph＋typed payment records/protocol，前端檢查全量 record coverage、canonical active/paid_at、own target revision 與 lease hints；own_session 不是 capability。
- 為讓 Payment 與無關 Budget title/note 都可完成，只有 Payment protocol 啟用時擴大 nonfixed Budget title/note 的窄寫支援（含 retained）；不 copy 到 Actual，graph/current committed metadata 決定付款內容。retained category/payer/links 仍安全拒絕，不視為本輪已完成。

### P2 根因、修正與測試

**Origin-only**：SQL 測試透過真正 insert→unlink／delete source 證明 `budget_origin_id` 保留且 `payment_origin` 可被舊 trigger 轉 manual；在可回滾 transaction 中載入原 Pricing helper，確認它的確會把該 Actual 當 standalone，再 rollback 並驗證新 helper 拒絕。新 forward helper 同時檢查 link、origin、manual provenance，Budget retained resolver 也納入 origin references，避免誤認零付款重新建一筆。不改資料或清除 origin；cost/history/receipt 保留。

**錯誤匯率**：`BudgetPricingFields` 幣別切換只接受新幣別的 quote，無 quote 一律清空，不 fallback 舊 JPY rate。顯示「尚無此幣別的旅程匯率」、停 TWD preview，invalid Pricing 不送出，其他輸入保留。Quote 到齊後「套用最新旅程匯率」由使用者明確操作，controller 重讀 Snapshot，拒絕 graph/member/target revisions 已變的情境，exact release／重新 admission/CAS 後才提交；不自動覆蓋／盲目 rebase。恢復中草稿仍為 staged intent，未授權不能提交。Formal 畫面與 controller 有對應測試。

### Controller／UI／Demo

- [budgetPaymentGroups.js](../src/lib/budgetPaymentGroups.js) 是 explicit-operation adapter，重用原 metadata authority Snapshot／10s timeout／ActiveEditorGuard；沒有付款 autosave，也沒有第二套金融計算／CRDT／資料同步。`budgetPaymentValues.js` 集中 typed snapshot 驗證。
- 開啟明細不 acquire；點 Toggle 才 fresh read→bundle acquire→新 RPC→exact release→權威 Snapshot。busy 不能雙送，沒有 optimistic fake success。缺 RPC 不 fallback；權限衝突／validation 留 inline，無重複全域 Toast。
- 未知 mutation ACK 保存原 request/base/value/origin-session；原 transport 未 settled 時 retry 仍用同一 Promise。Reload 的 inert pending 不存 token/epoch，明確 retry 只查同 request。點擊即設 busy/guard，連非同步 Auth 等待也不能在 lease admission 前悄悄換項目；帳號／trip／generation fence 擋舊 admission/ACK。late acquire 回來以原 capability/epoch cleanup。已提交但 snapshot／release 未確認只重試該步，不建立新付款。獨立匯率 generation 已前進但 payment revision/content 已收斂時，接受新的權威 Snapshot，不卡在舊 receipt dependency vector。
- 共用 Payment Toggle 保留原 UI，新增 busy 文案/aria-busy；未知結果停用並顯示「確認付款結果」。Guard 包含已從 sessionStorage 還原的未確認操作，不能換頁／完整編輯時悄悄丟掉。Actual 日期輸入本身不寫 DB，按「更新付款時間」才提交窄操作，日期採原 localDateTime／ISO 模式。
- Formal flag-off 的既有流程保留；flag-on 只用新 Payment RPC，v4 Snapshot 失敗不能製造寫權。Payment 狀態不進 offline financial cache。
- [Demo adapter](../src/demo/budgetPaymentGroups.js) 共用原 `saveDemoBudgetRecord` 的保留式付款 transition，與 metadata transport 共用 lease map；一次 minimal finance delta 更新，preserve old Actual/join/history/receipt，既有 React async callback 期間有 memory overlay 保持 snapshot 一致。無 Supabase/Auth/Realtime/Storage／sessionStorage/localStorage。未加入新的金額／付款業務模型。

### 驗證結果與發現

| 層級 | 結果／範圍 |
| --- | --- |
| 原生 PostgreSQL | 133/133（完整舊112＋B-4a21）；不同 LOGIN/backend/JWT、實際 blocking wait graph；首次／多筆／inactive pricing→repaid、known cost/nonempty history/receipt/join IDs、同 request replay/mismatch、P2 舊新函式對照、withdraw membership、source graph during wait、lease takeover/late release、no-op、legacy/raw bypass、第二 child／第二 retained update fault、v4 Snapshot→實際 controller→named RPC |
| Migration/reverse | 注入 forward failure rollback；未使用且 inactive dormant reverse 完整恢復舊函式與業務 rows；Payment ledger 已使用時，protocol disabled＋清 leases 仍拒絕 reverse |
| SQL regression | Metadata23、Undo28；budget-database、budget-safety-database、budget-leases-database 全鏈通過（lease raw-SHA guard 沿用 LF disposable mirror，不改舊斷言） |
| Controller | Payment13、原 metadata45／choice11／pricing9 全通過；新增 strict v4 malformed graph、timeout/unknown ACK/exact replay、reload pending、release/admission failure、late ACK／auth switch、獨立 rate generation 收斂 |
| UI/full regression | 主要 **300/300**，含新13項 controller＋8項 Formal/Demo/P2 UI，原全部279個 regression 保留；另舊Budget表單／Safety／Unified Planning／Demo財務 **42/42**（46.6秒），合計 **342/342**；[machine-readable evidence](qa/2026-10-29-budget-b4a-payment-results.json) 保存批次時間、逐案與 hashes |
| 原協作 repeat | 首次焦點／排他與 title-note 雙人各8輪，合計16/16；timeout／產品斷言不放寬 |
| Build／syntax／diff | Production build、13個JS/MJS syntax／JSX build parser、diff 通過；52個舊 migrations 保持原內容。既有 bundle advisory 保留 |
| CLI advisors／migration list | 本輪實際對 loopback 嘗試，兩者仍要求 TLS 而失敗；不是 hosted connection，也不宣稱完整 Advisor certification。SQL grants/RLS/catalog 與不同 role tests 已通過 |

前一次 full batch 294/295：首次 focus 測試期望 DB 舊名稱，但取得租約後等待另一瀏覽器啟動可能超過正常1s autosave，已合法提交。根因是測試時序假設，已增加 mock transaction barrier，保留原 DB舊值／readonly/owner 斷言，再驗 release barrier 後 autosave 確實提交；不改產品 debounce／timeout。原 title/note 案例未改斷言。一次 repeat batch 全部在 `page.goto` connection-refused，因前一本機 dev process 已結束，未進入測試情境；重啟後16輪通過。

其他實作期故障都保留拒絕與 rollback：新 JSONB operator 需括號；Payment 必須從文字 Undo capture 排除，否則會要求 before-image；Demo 的 pure financial transition 只能 clone finance，不能 clone 含 React callback 的 props；付款時間 UI 測試改按瀏覽器 local timezone 轉 ISO，沒有錯改產品為 UTC 輸入。

Browser plugin 不可用，使用既有 Playwright/Chromium 的真 React，Formal 是隔離 shared Auth/RPC/Realtime/Storage mocks，Demo 驗零外部 service traffic、零 payment draft persistence；console/page errors 嚴格保留。桌面1440×1000 `budget-payment.png` 已視覺檢查付款狀態、原金額／分攤、receipt reference 與 Toggle/footer可到達；截圖在本 chat visualization folder，不放 repo。

### Source／Receipt 後續與回滾限制

完整盤點：[Source/Receipt boundaries](2026-10-29-budget-b4a-source-receipt-boundaries.md)。Source link-only／apply-source-data 必須拆不同 explicit operation，涵蓋 old/new Budget graph、origin/provenance／金額／payer／文字不同 bundle；本輪沒做新 source action。Receipt 現有 capability-bound metadata RPC、private bucket/RLS、upload/compensation/delete/signedURL 與 Actual delete/孤兒邊界逐項記錄；下一階段要獨立 pending→committed→cleanup→reconciliation，SQL rollback 不能還原已刪 bytes。

[Dormant reverse SQL](qa/2026-10-29-budget-b4a-payment-rollback.sql) 只允許未成功使用 Payment ledger、protocol disabled、無 active leases/effects；還原舊函式並移除新 group/helper/protocol。不 rollback 付款成本／刪 audit；已用需 forward repair。新 forward migration 與52個舊檔案需保持來源 hashes 可追溯。

沒有 Hosted migration/data/protocol/config／Storage bytes、manual deployment、main merge 或 Issue mutation。retained category/payer跨端、source操作、Receipt生命週期、persisted blank records、Undo/Ctrl+Z/Redo/history UI 與完整方案B啟用仍未完成。Hosted PostgREST/Realtime多帳號、舊clients混用、Storage byte-level lease、真實device/PWA/background/IME/screen-reader speech 仍是後續獨立驗收 gate；Git push不證明Preview/Production Ready。

```powershell
node scripts/qa/run-budget-metadata-parallel.mjs --advisors
$env:PGLITE_MODULE=(Resolve-Path '.tmp-budget-db-runtime/node_modules/@electric-sql/pglite/dist/index.js').Path
node tests/budget-metadata-groups-database.mjs
node tests/budget-metadata-undo-database.mjs
node tests/budget-database.mjs
node tests/budget-safety-database.mjs
# lease suite 使用既有 LF disposable source mirror
node node_modules/@playwright/test/cli.js test tests/budgetPaymentGroups.spec.js tests/formalBudgetPaymentGroups.spec.js --workers=1
node node_modules/@playwright/test/cli.js test tests/formalBudgetMetadata.spec.js --grep 'open has no lease|different groups save narrow' --repeat-each=8 --workers=1
npm.cmd run build
git diff --check
```
