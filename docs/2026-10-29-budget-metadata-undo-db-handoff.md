# Issue #15｜B-3 名稱／備註五步 Undo：DB 切片

2026-10-29；`codex/budget-collaboration-redesign`，起點 `46a8aaf4bf4f764b8ce080de091e7828cef47a91`，本機／GitHub 一致。使用者更正為依進度繼續下一步；本次選擇先完成 **最多五步、目前分頁 title/note Undo 的 DB 安全基礎**。沒有開始金融群組、空白正式新增、Redo、歷史 UI、Hosted migration、正式資料修改、main merge 或部署。

**這次沒有接 Ctrl+Z 或新增 UI。** 原有前端自動儲存／Snapshot timeout 程式碼完全不變；`VITE_BUDGET_METADATA_GROUPS` 仍預設 false。新的私有 Undo protocol 也預設 false。只有 isolated test fixtures 曾打開兩個 DB flag，所有 test cluster 均已停止。完整 B-3 尚不能因此稱為完成。

[完整 B-1 Undo 規則](2026-10-29-budget-collaboration-b1-contract.md#8-最多-5-步目前分頁限定的-undo)；[既有自動儲存交接](2026-10-29-budget-b3-metadata-autosave-handoff.md)；[本次逐案結果／實際等待證據與 hashes](qa/2026-10-29-budget-metadata-undo-results.json)。

## 實作與資料安全

以 Supabase CLI **2.106.0** 的 `migration new` 產生 [20261029091435_budget_metadata_undo_prototype.sql](../supabase/migrations/20261029091435_budget_metadata_undo_prototype.sql)，不改前兩份 metadata migrations 或已套用的任何 migration。只在新 migration 新增物件／trigger 與 effect 的可選 before-image 欄位，**既有 RPC 的 function definition、參數、result 與 snapshot schema 保留**。原 Patch 的 `undo_supported:false` 仍維持，避免舊 frontend 誤判完整功能已接管。

| 私有物件 | 用途 |
| --- | --- |
| budget_metadata_undo_protocol | admin-only，enabled=false；Undo 的獨立開關，不代表正式啟用許可 |
| budget_metadata_undo_operations | DB before/after image、原始 before/after revision、actor/origin session/trip、同組 predecessor；只追加成功 metadata 操作，不改寫已提交紀錄 |
| budget_metadata_undo_stack | actor＋origin session＋trip 的最多五個指標與 mutable expected_revision；第六筆只淘汰最舊指標，成功 inverse 不 push、不產生 Redo |
| budget_metadata_undo_lineage | 每個 record/group 的最後有效 operation lineage 與 current revision；不以文字相同取代版本檢查 |
| budget_metadata_undo_intents | transaction/backend/actor-bound 精確 inverse；未完成 intent 的 deferred constraint 拒絕 commit，不用 caller-controlled GUC 授權 |
| budget_metadata_undo_receipts | inverse request ID／原目標／origin session／結果；重試回同一結果，不再 pop |

所有新表 RLS enabled、沒有 PUBLIC／anon／authenticated 直接 table/sequence grants，不加入 Realtime publication。before-image 不放入 snapshot／collaboration hints／公開 top reader。新增的 private helpers 明確 actor/trip 權限與空 search_path，public API 皆 SECURITY INVOKER/authenticated-only；沒有服務金鑰、Auth user_metadata 授權或新 financial write bypass。

新增 metadata row trigger 在既有 exact-effect guard 後，從真正 DB OLD 取得 before-image，綁定原本 `budget_metadata_effects` 的 transaction/backend/actor/request。成功 ledger insert 才記 operation／push；失敗、no-op、replay、acquire/renew/release 都不入列。原 RPC 最終 transaction 失敗時，資料、group revision、request、operation／stack／lineage／receipt 一起 rollback。

Undo 先取得原有 trip advisory transaction lock、重驗 membership，鎖目前分頁的 stack top；membership row 使用 `FOR SHARE NOWAIT`，避免 legacy row-first revocation 和 trip-first inverse 形成死鎖。接著由 **原本 `public.patch_budget_metadata_group`** 驗證 parent NOWAIT、supported dependency、current group revision、token/epoch/session、expiry 與 RLS，再以 DB inverse payload 原子寫一個欄位。Undo 不重算計價、付款、FX、known debit 或 participants。

## RPC 契約

| API | 輸入／結果 |
| --- | --- |
| `read_budget_metadata_undo(p_trip_id,p_session_id)` | 可編輯成員目前分頁的 protocol/enabled/count/top；top 只有 operation_id、kind/id/group、expected_revision，沒有 before/after text、capability 或其他分頁內容 |
| `undo_budget_metadata_group(p_trip_id,p_session_id,p_operation_id,p_token,p_epoch,p_request_id)` | p_operation 必須是該分頁／旅程的 top，不能跳步；目前同組有效 lease 才能做新 inverse。結果沿用 canonical Patch result，加 `undo_of`。相同 request 的成功 replay 可在 lease 釋放後回原結果，但仍檢查當下 membership／origin／trip／target |
| `clear_budget_metadata_undo(p_trip_id,p_session_id)` | 清除本人指定當前分頁／旅程的指標，用於之後 client 的旅程／登入生命週期；不刪 operation／request／receipt，成功 Patch replay 不會重建已清 stack |

不以 viewer/read permission 提供 inverse：viewer、pending、outsider、anon、跨旅程、錯誤 token/epoch/session 一律拒絕。沒有外部可指定的 before-image 或 inverse patch 參數。

**連續同組復原：** A→B v1→C v2，Undo C→B 產生 v3，只有原同分頁 predecessor 的 image／expected revision 被證明相符，才能把其 expected 推進至 v3；不改原 audit。title/note 交錯亦只推進該組，其他組維持自己的版本。另一人／分頁改同組後即使又改回相同文字，revision/lineage 仍不同，舊 inverse 拒絕。Undo 後新 edit 可以延續仍在 stack 的已驗證 predecessor，沒有 Redo branch。

## 保守邊界與尚未接管的契約

- 只支援既有無 retained Actual／無 fixed/backlink Budget 與獨立 manual Actual 的 title/note。尚未支援分類、payer、pricing、來源、付款、收據或 delete 的 inverse。
- legacy whole-record／financial／participants／links／receipts／rates／date 更新使相關 lineage 失效；Actual 與 Budget 的 link/origin 曾建立後又移除，也不會讓舊 lineage 復活。刪除再建立相同 UUID/value 亦拒絕舊 inverse。
- **legacy 操作缺少可靠 origin tab context，因此此切片保守清除該 actor 在該 trip 的所有 tab pointers。** 與完整 B-1 只清當前分頁的目標尚有差異；他人 stack 不被直接刪掉，但相依 lineage 仍可失效。必須在後續 bridge 定義可信的 legacy origin，才能精準到單分頁。這是部分協定不能正式啟用的原因之一。
- 舊資料 before-image 若含非 canonical 空白／空備註字串，現有 Patch RPC 的 btrim/null normalization 無法 byte-for-byte 還原；舊空名稱也不符合目前 Patch validator。此切片將該次操作視為不可安全 inverse 的邊界，清掉該 actor 的 trip pointers；不把修剪後的值冒充原 before-image。不變更正式歷史值／normalize 回填。
- protocol paused 時拒絕新 inverse，成功 request replay 仍保留。停用期間變動的 group revision／dependency fence 仍能拒絕舊 inverse。沒有自動回退舊資料或抹除成功證據。
- [本機逆向 SQL](qa/2026-10-29-budget-metadata-undo-rollback.sql) 只允許 dormant、unused 且無在途 effects/intents；已用過即拒絕 destructive reverse，保留 audit。PGlite/native 都驗證 migration failure 全回滾、unused reverse 還原前版 function definitions／資料。

## 測試與環境

| 層級 | 結果／實際範圍 |
| --- | --- |
| 新 SQL 契約／PGlite0.5.11 | **28/28**：含25 shared cases、migration atomic/reverse、privilege/catalog audit、成功使用後拒絕逆向刪證據；單程序序列 SQL，不宣稱並行 |
| 原生 PostgreSQL17.11／pg8.16.3 | **66/66**：舊33全保留＋Undo migration atomic/reverse1＋shared25＋新增並行／鎖測試7；27組實際重疊／鎖持有觀察，含新的同目標、同request replay、不同組、inverse rollback、撤權、parent row-first、member row-first |
| 原 metadata DB | **23/23**，原套件未改斷言 |
| 舊三套 DB | budget-database、budget-safety-database、budget-leases-database 全通過；lease suite 用既有 LF disposable source mirror，加本次新 migration，避開舊 #14 raw SHA guard，已套用來源未動 |
| 既有前端／controller | **211/211**：包含名稱備註45 controller、45 rendered UI、Snapshot/coalescer、Budget金融/lease/receipt/rates與通知。沒有新增 Undo UI 測試，也不能宣稱 Ctrl+Z 已驗收 |
| Production build／syntax／diff | 通過；前端 bundle 與前次相同，約1.104MB，既有 large-chunk advisory |
| CLI Advisor／migration list | 已只對 marked loopback URL 嘗試；CLI2.106 在 sslmode=disable URL 下仍要求TLS，本機 native cluster 拒絕TLS，所以**不可宣稱 Advisor 或 CLI migration-list 通過**。本次另以 SQL catalog 測 RLS/grants/invoker/search_path/publication。不是完整 Supabase Advisor 認證 |
| Hosted | **沒有連接或操作**；沒有 hosted migration、真 PostgREST/Realtime/UI 驗收或正式部署 |

原生 final run `4b20d11f-fe4b-4e31-bbde-a68aaedc544b`，127.0.0.1:5512；兩個不同 backend PID／LOGIN/JWT actor/tab identity，第三個 observer。以 advisory gates、pg_stat_activity／pg_blocking_pids 保證新 inverse 與對手真的重疊；NOWAIT 案例另證明對手仍持 parent/member row lock 時 inverse 安全返回55P03。READ COMMITTED、12s statement timeout、6s lock timeout、200ms deadlock timeout；沒有新40P01。runner finally 已停止 cluster，沒有留下 DB service。

初期發現與處理：新 SQL CASE comparison 需要括號，於 disposable migration parse 階段修正；rate boundary fixture 起初寫回相同 `{}` 沒有實質更新，改為真正改匯率；membership row-first fixture 不能讓普通 editor 直接撤 owner 權限，改用隔離 test schema 的明確 fault helper 模擬管理者 raw revocation，未放寬 production RLS。前端初次回歸 dev server 沒啟動，connection refused 後中止並啟動正確 localhost5180重跑；沒有改產品碼／測試斷言掩蓋環境問題。

## 修改檔案與重跑

- 新 migration、上述 rollback SQL。
- [共用 Undo SQL cases](../tests/budget-metadata-undo-cases.mjs)、[PGlite runner](../tests/budget-metadata-undo-database.mjs)、[native suite](../tests/budget-metadata-parallel.mjs)。
- [native runner](../scripts/qa/run-budget-metadata-parallel.mjs)：加可選 `--advisors`，命令只接 runner 剛建立的 loopback port；結果寫 ignored test evidence，無任意 hosted URL。
- CURRENT_TASK、本文件與本次 QA JSON；沒有應用程式、套件、env、既有 migration 或既有測試安全斷言改動。

```powershell
$env:PGLITE_MODULE=(Resolve-Path '.tmp-budget-db-runtime/node_modules/@electric-sql/pglite/dist/index.js').Path
node tests/budget-metadata-undo-database.mjs
node scripts/qa/run-budget-metadata-parallel.mjs --advisors
npm.cmd run build
git diff --check
```

需自行安裝的本機 PG binaries、PGlite／pg、cluster／raw logs 不在 Git；Node24.15.0。本次 CLI changelog.md 不支援 MIME，改讀[官方 HTML changelog](https://supabase.com/changelog)，近期 TLS HTTP／SDK 項目不改本機 SQL 契約。權限依[官方 functions 規則](https://supabase.com/docs/guides/database/functions)，trigger rollback 行為依[PostgreSQL 官方說明](https://www.postgresql.org/docs/17/trigger-definition.html)。

下一步先 Review 此 DB 切片，再接 client 的 Undo session lifecycle、單次 inverse in-flight／未知結果重試、Ctrl+Z 原生輸入優先及 Formal／Demo parity。接 UI 前要處理上述 legacy origin-tab 與 before-image eligibility 邊界；維持雙旗標關閉，不附帶 blank creation 或金融協作。
