# Issue #15 — Pricing + Participants 原子群組

起點 `4312affbde6fa527da35b95dcb2e38b6e88a8ace`；本機／GitHub 已確認同步，保留原有五個未追蹤檔案。先讀 AGENT、CURRENT_TASK、根目錄 DESIGN、UX_RULES、B-1、B-3、Undo、category/payer/links 交接及 Issue #15（無留言）。只允許本機實作／隔離測試、文件和 feature-branch commit/push。

## 實作前相依矩陣

| 情境 | 權限／版本／更新 | 決策 |
| --- | --- | --- |
| 無 retained、非 fixed/backlink Budget | Budget.pricing；graph/rates/member dependency；金額、模式、幣別、單價、分攤一次更新 | 支援；不拿 payer 租約，不寫 metadata/links |
| 行前單筆 generated retained（包含 inactive） | DB 解析 Budget.pricing + Actual.pricing bundle，兩邊 revision/epoch、來源／graph／rates vector；雙 parent 和 participants NOWAIT | 支援可證實的 generated、同來源關係；保留 ID、付款狀態、歷史、收據、payer、metadata |
| retained 已知 actual/legacy TWD 成本 | 權威 known debit 與 source 不變；只接受不會改變該已知成本的同步 | 允許安全的分攤／同成本操作；需要覆寫已知成本的改價整筆拒絕，不轉 estimated |
| standalone manual Actual | Actual.pricing；使用自身已知成本或 estimated 規則，不能從來源重建實付 | 支援；known debit/provenance 不變 |
| 多 retained、manual/不明來源 linked Actual、fixed 或不一致 backlink | 未完成金融/source graph | 整筆拒絕，無 legacy save fallback |
| 出發後外幣 Budget／retained 非 planning | 原始外幣、歷史匯率／成本與 baseline | pricing 拒絕；不把今日報價套回歷史 |
| 全旅程匯率／成員／來源拓樸改動 | rates/graph/member 版本失效；等待後重驗 | 舊 vector 拒絕；匯率路徑不可繞過活躍 pricing |
| 舊 parent/child/save/payment/receipt | 整筆 wildcard 與新群組互斥，既有原子 RPC 保留 | 活躍 pricing 不可繞過；新 group 不呼叫舊整筆儲存 |
| Pricing 與文字／category／payer／links | 無 retained 互相獨立；retained 仍維持原 metadata 不支援邊界 | 各組窄寫，不能複製舊欄位；retained category/payer 仍拒絕 |
| Undo | 新 pricing 不入文字 Undo stack；financial/participants 變更為 dependency boundary | 保留舊測試／lineage，拒絕不安全 inverse，不清其他人的不相關 stack |

保留既有兩位原幣／六位匯率／一次整筆換算／穩定 largest-remainder。Custom 採 B-1 與 Issue #15 的最終規則：切入帶原均分值、各人可改、總額為加總；不新增剩餘補差／最後一人鎖定。本次貼文內「沿用剩餘均分」與此衝突，依其指定的已定案契約處理。

## 套件與重用決策

調查 [big.js](https://mikemcl.github.io/big.js/) 與 [React Hook Form](https://react-hook-form.com/)：可提供小數／表單能力，但不能替代 DB 權威、既有 BigInt `budgetFinance` 或 B-3 controller。直接重用 calculatePricing/calculateActualPricing/allocateWhole 與現有 UI。DB 從既有 save 的 numeric 計價段抽出共用 helper，legacy save 與 pricing patch 共用，不另設金額模型；不新增依賴。

## 完成的協定

沿用 metadata group state、request ledger、signals、B-3 serial controller 和 guard。Pricing 使用有結構的整組 value；DB 保存／驗證 bundle version vector，包含 graph/rates/member generation、peer group revision/epoch。短 trip transaction + parent/child NOWAIT；租約不是長 SQL transaction。Snapshot 新 schema 明示每組 support，不把 retained metadata 變成可寫。所有旗標／DB protocol 預設停用，不連 Hosted。

新 migration [20261029123907](../supabase/migrations/20261029123907_budget_pricing_participant_groups.sql) 由 Supabase CLI 建立，只有 forward expand；未修改已存在 migration，未連 Hosted。DB metadata 與 Undo protocol、前端 `VITE_BUDGET_METADATA_GROUPS` 仍預設關閉。這是本機已驗證的實作 checkpoint，並非上線紀錄。

### DB／RPC／Trigger

- `budget_metadata_group_lease` 沿用入口，pricing 分派至 `budget_pricing_admission`；DB 自行解析完整 targets，取同一 capability、每端獨立 epoch，保存 bundle origin／graph／rates／members／target revision。全部 admission／renew／release 一次處理，另一個帳號或同帳號其他 tab 不能共享；逾期、缺 peer、錯 epoch／token、晚到 release 皆不能部分更新或釋放新持有者。
- `patch_budget_metadata_group` pricing 分派到新增 invoker `patch_budget_pricing_group`。Prepare 只接受 pricing whitelist，重驗 trip／members／parents／participants、租約與 vector，保存 DB before-images／完整 manifest；invoker 僅改金融欄位與 participant 差異，Finish 驗證所有 rows／joins 後一次推進兩端 revision。任何第二端 child fault 都 rollback parents、joins、versions、effects 和 request。無變更不動金額／joins／版本；成功請求進既有 immutable request ledger，相同 ID 只 replay 相同 intent。
- 共用 `calculate_budget_group_pricing(jsonb)` 抽自原有 numeric 計價段，legacy save 與新 Patch 使用同一 helper；原幣兩位、匯率六位、正匯率小於 1,000,000、總額／TWD 範圍與前端 BigInt 一致。非負有限 decimal、合法模式、至少一個 approved participant、custom 加總及最大餘數分配沿用既有契約。participant 差異保留未變的 join ID。
- `budget_pricing_trip_versions` 為 private RLS table，無 client table grants／publication。六個 tracker triggers 涵蓋 Budget／Actual／兩種 participants／trips／members，對舊路徑維護 pricing revision、graph、rates 與 member generations；精確新 effect 由 Finish 統一推進。舊 row／child guards 對 active pricing 仍是 wildcard 排他，沒有 legacy save fallback。
- forward-redefine `keep_actual_twd_cost`／`apply_trip_budget_rate`，僅 exact authorized pricing manifest 可跳過舊自動 provenance 改寫／當日匯率套用；完整 protected fields 在 Finish 再檢驗。其他 legacy 行為保留。已知 actual／legacy debit 不改、不轉 estimated；linked/TWD 的新算值若不同於已知成本，整筆拒絕。standalone known foreign Actual 可改原幣／分攤，但權威台幣扣款與 source 保留。
- 新 STABLE/invoker `read_budget_metadata_snapshot_v3`＋state-v3 在同一 financial snapshot 加入 pricing value／dependency vector／per-group supported。v1／v2 readers 與既有 signals/channel 保留。retained 的 title／note／category／payer／links 維持原拒絕邊界，只有已證實安全的 pricing bundle 可編輯。
- 新 pricing 不進 Undo stack，也不提供 Undo UI。金融 boundary 使受影響 record 的舊 text inverse lineage 失效，僅清本次 actor/session 的不可逆 stack；其他帳號不相關 stack 保留。既有 title/note Undo 和五步 DB 測試完整保留。

匯率與 pricing 的重疊有兩種合法結果：舊 rates RPC 本來就排除有 retained 的 Budget，因此 quote 可獨立提交，兩端歷史匯率／成本保持不變，之後帶舊 rates vector 的 pricing 拒絕；若會重估正在編輯的 unlinked Budget，則 rates 整個交易 55P03 rollback，quote 也不部分儲存。等待 trip lock 時 retained 集合改變，舊完整 bundle 必須拒絕。

### Controller／共用 UI／P2

- 延伸原 B-3 serial autosave controller，pricing value 有結構，整組 mode／amount／unit／currency／rate／participants／shares／vector 一起排隊；有效修改 debounce 1 秒、blur flush、IME 期間不提交，invalid draft 留在本機。只會因本分頁已證實成功的 ACK 推進 queued value 的 vector，不對外部 graph/rate/member 變更盲目 rebase。
- reuse focus lease、pending intent、2 分鐘 clean／10 分鐘 dirty real-idle、guard prepare/finish、exact retry／release、10 秒 Snapshot deadline、generation/account/trip fence。未知結果保留原 request；已 ACK 的 A 即使 snapshot pending，也不重送 A，queued B 保留並等重新確認。
- `BudgetPricingFields` 同時供完整 RecordEditor 與群組編輯器使用；預覽使用原 `calculatePricing`／`calculateActualPricing`，沒有新金額模型。切進 custom 帶既有均分，custom 合計即總額；離開再返回保留已編輯 shares。保留的付款幣別／歷史匯率鎖定，已知實付預覽使用已知 debit。
- Formal opt-in 改讀 v3；Demo 使用相同 UI/controller，但只走純記憶體 transition，一次更新 finance state，保留 inactive Actual／join IDs／history／receipt reference，不接 Auth/RPC/Storage/Realtime/drafts/localStorage。
- ItineraryPicker 唯讀 checkbox／取消關聯 button 實際 disabled，保留歷史標籤與搜尋檢視；可聚焦的 group 容器能先取得編輯權。payer option 只列 approved，pending／departed 不可選；歷史無效 payer 保留辨識標籤與 disabled option，不自行清除或改人。MenuSelect 支援 disabled option 的 mouse／keyboard 拒絕。

### 驗證與發現

| 層級 | 最終結果 |
| --- | --- |
| Native PostgreSQL 17.11 | **112/112**；不同 LOGIN/JWT/backend＋observer，包含真實 blocking-pids wait graph、pricing/title、pricing/payer、競爭 admission、child NOWAIT、retained set wait、rates overlap、到期接管與 late release、完整 second-child rollback、known debit、Undo、private grants 與真實 v3/controller/RPC |
| Migration/reverse | 注入 migration failure 全部 rollback；未使用且 inactive 時 reverse 精確還原原函式／業務 rows；protocol disabled 且租約清除後，存在 pricing request 仍拒絕 reverse |
| 原 SQL regression | metadata **23/23**、Undo **28/28**；budget-database、budget-safety-database、budget-leases-database full-chain 通過。lease suite 使用既有 LF disposable mirror，未改舊 raw-SHA assertions |
| Pricing controller | **9/9**；原 controller45、choice11 另全數通過；含 structure/vector、custom1200、invalid/no-op、queue、unknown ACK、10 秒 Snapshot deadline、late read、retained Demo／known-cost refusal |
| 全前端回歸 | 最終 **279/279**（4.5 分鐘），逐層統計見 machine-readable evidence；前一完整 batch **277/277**，新增兩項 controller 在其後加入 |
| 原偶發 title/note | 原案例原 timeout／斷言連續 **8/8**；本次未重現。不能宣稱前次 transient 根因已證明 |
| Build／syntax／diff | Production build 通過，既有 large-chunk advisory 保留；10 個 JS/MJS syntax、JSX build parser 與 diff 全部通過，51 個原 migration 與 HEAD 邏輯內容一致 |

真實 Snapshot/controller 測試曾發現：unsupported pricing 的空 targets 讓過嚴的前端 validator 拒絕整份 Snapshot。已修正為僅明示 `supported:false` 可沒有 targets；可寫 snapshot 與 ACK 必須含本 record/revision 的 target，新增正反測試後 native 整合通過。另一個新 UI 測試最初對 readonly note 直接 fill；改為先 focus／確認 editable，沒有修改產品權限或放寬斷言。

原生 concurrency 使用 observer barrier、`pg_stat_activity`／`pg_blocking_pids`，不是用睡眠推論重疊。最終 run `f937ec39-96df-47df-966e-d4c3c392f544`、39 筆實際 overlap／held-lock observations／不同 PID/LOGIN／逐案 outcomes 與 source hashes 見 [QA results](qa/2026-10-29-budget-pricing-groups-results.json)。所有隔離 clusters 已由 runner finally 停止，runtime／node_modules／原始 logs／clusters 留在 ignored 區。前端 Browser plugin 不可用，使用既有 Playwright/Chromium，Formal 為隔離 mocks；Demo 驗證零外部服務請求，console/page errors 嚴格檢查。桌面 1440×1000 screenshot 位於本 chat visualization `budget-pricing.png`，已檢視三人 custom600/300/300、total1200、JPY/TWD 和欄位可讀性。

```powershell
node scripts/qa/run-budget-metadata-parallel.mjs
$env:PGLITE_MODULE=(Resolve-Path '.tmp-budget-db-runtime/node_modules/@electric-sql/pglite/dist/index.js').Path
node tests/budget-metadata-groups-database.mjs
node tests/budget-metadata-undo-database.mjs
node tests/budget-database.mjs
node tests/budget-safety-database.mjs
# 舊 lease raw-SHA guard 依既有流程用 LF disposable mirror 執行。
node node_modules/@playwright/test/cli.js test tests/budgetPricingGroups.spec.js tests/formalBudgetPricingGroups.spec.js --workers=1
node node_modules/@playwright/test/cli.js test tests/formalBudgetMetadata.spec.js --grep 'different groups save narrow' --repeat-each=8 --workers=1
npm.cmd run build
git diff --check
```

### 回滾與後續範圍

[Dormant reverse SQL](qa/2026-10-29-budget-pricing-groups-rollback.sql) 僅適用未曾使用 pricing、protocol disabled、無 active leases/effects 時；restore 原函式、drop 新 triggers/functions/private versions 與 pricing group state，不逆轉金融資料。已產生成功 request 的環境要 forward repair，不得刪 audit 或回退成本。舊 migration 與 v1/v2 保持原樣；私有來源 hashes 的驗證方式見 evidence。

retained category/payer 原子同步仍未實作，不能把 pricing bundle 當作其授權；多 retained、fixed、不明來源／不一致 backlink、非 planning retained、歷史外幣 Budget 仍整筆拒絕。付款狀態／建立付款新協定、來源重新關聯、Receipt Storage 保護新協定、persisted 空白新增、Undo/Ctrl+Z/Redo/history UI、完整 protocol 啟用仍不在此次範圍。

未做 Hosted migration/data/protocol/configuration、main merge、manual deployment 或 GitHub Issue 變更。CLI Advisor/migration-list 本輪未重試；前輪 loopback TLS 失敗仍是未驗證限制，targeted SQL grants/RLS/catalog 不代表完整 Advisor certification。Hosted PostgREST/Realtime 雙帳號、舊 client 混用與 Storage bytes 保護、真實裝置/PWA／背景節流／實體 IME／screen-reader speech 尚待獨立啟用驗收。feature-branch push 可能觸發自動 Preview；Git publication 不證明 Preview/Production Ready。
