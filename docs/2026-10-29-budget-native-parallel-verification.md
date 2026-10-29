# Issue #15｜原生 PostgreSQL 雙連線並行驗證

日期：2026-10-29。分支：`codex/budget-collaboration-redesign`。範圍限於已存在的 title/note DB 原型；不做 B-2 UI、計價／付款群組、hosted migration、部署或正式資料操作。先前未提交的文件整理與原型檔案保留；本次沒有 commit/push。

**結果：最終 17/17 案例通過，其中 16 個案例各保留實際重疊執行證據，另外一個為原生伺服器 RLS／grants 驗證。** 發現並修正一個 row-lock/trip-lock 順序造成的真實 deadlock。原有 23 個離線權限／交易情境及三套 Budget DB 回歸通過。

- [機器可讀結果、PID／wait graph、前後來源雜湊](qa/2026-10-29-budget-metadata-parallel-results.json)
- [測試 runner](../scripts/qa/run-budget-metadata-parallel.mjs)
- [雙連線測試](../tests/budget-metadata-parallel.mjs)
- [修正的未套用 prototype migration](../supabase/migrations/20261029020551_budget_group_metadata_prototype.sql)

## 1. 測試環境與隔離

| 項目 | 實際環境 |
| --- | --- |
| Engine | PostgreSQL 17.11，x86_64 Windows／MSVC 64-bit，原生 postgres.exe；不是 PGlite、mock 或同一連線排程 |
| Runtime | Node.js v24.15.0、node-postgres pg 8.16.3；driver 只安裝至未追蹤測試 runtime，未改 package.json／lockfile |
| Server | 每次由 initdb 建立全新 cluster；只監聽 127.0.0.1、OS 選取的空閒埠；沒有安裝 Windows service |
| Isolation | 每 cluster 隨機 marker；harness 拒絕不符 server marker 或已有其他業務 DB 的 server；不接受 DATABASE_URL／Supabase URL |
| 連線 | 兩個獨立 TCP Client、不同 backend PID、不同 LOGIN role；兩者 SET ROLE authenticated 並設定各自 auth.uid session claim；另有管理／觀察連線 |
| 交易 | READ COMMITTED；一般 statement_timeout 12s、lock_timeout 6s；特定 timeout 案例 700ms；deadlock_timeout 200ms |
| 本地 scaffold | auth/users、JWT helper、storage catalog 與 Realtime publication 名稱在新 cluster 中建立，以執行原 migration；並未連接 Supabase Auth、Storage 或 Realtime 服務 |
| 原始資料 | 僅 synthetic users/trips/Budget/Actual fixtures；載入 workspace 的 migration chain，包含預設停用的 prototype，再只在該測試 cluster 啟用 |
| 結束 | 全部四次成功啟動的測試 cluster 已 pg_ctl fast/wait stop；保存 log、結果與 cluster marker，確認 postmaster.pid 不存在 |

官方 EDB [可攜式 binary 下載頁](https://www.enterprisedb.com/download-postgresql-binaries) 的 PostgreSQL 17.11 Windows x64 連結為 `https://sbp.enterprisedb.com/getfile.jsp?fileid=1260616`。本次 archive SHA-256：`80379b2c04d51c30225532e0ae04509899141e9957ed096fe749d7fd9df8f82f`。下載只作本機測試，沒有 SDK／專案套件升級。

Windows 中文 checkout 路徑曾使 initdb 回報 UTF-8 0xa6 路徑編碼錯誤；那次沒有啟動 server。runner 改用純 ASCII 的系統暫存 cluster 路徑與 runtime junction，結果／log 複製回 workspace 的 `.tmp-budget-native-pg/runs/<marker>/`。不修改系統服務或其他資料庫。

## 2. 如何證明是並行

一般競爭案例採可觀測的 server barrier，而不是先 await A 完成再呼叫 B：

1. observer 持有測試專用 gate；A 在 explicit transaction 內執行真實 lease/patch API，再於同一個仍執行中的 SQL SELECT 等待 gate。A 的真實 trip／row／group transaction locks 仍存在。
2. 在 A 的 `pg_stat_activity.state='active'` 且 `pg_blocking_pids(A)` 含 observer 時，送出 B 的獨立交易。
3. observer 等到 A、B **同時 active**，且 `pg_blocking_pids(B)` 含 A，記錄 PID、xact_start、query_start、backend_xid、wait_event、observed_at 與 blocking PIDs，才放行 A。
4. 驗證兩個交易結果及最終 canonical fields／versions／ledger。結果不是依賴固定 sleep 碰巧同時發生。

例如最終 different-groups case，兩者會短暫等待同一 trip advisory transaction lock；但提交後兩個 group editing lease 都有效。**目前保留短 SQL 序列化，不宣稱同一列物理寫入完全不等待。** 不同群組的人類編輯權可共存，兩筆重疊的 patch 最後都保存。

NOWAIT row-order 案例另用兩個 gate 先證明兩條 server query 同時 active；A 已在獨立交易取得 parent row lock。放行 B 的 API 後，A 的查詢仍 active 且持 row lock，B 必須立刻以 55P03 拒絕；同時記錄拒絕時 A 的 activity。這項測試不期待 B 等 row lock，因為「不等待」正是修正的行為。

最終 cluster 的 actor PID、SQL session_user、auth.uid 及所有 observations 均保存在結果 JSON；測試自己的 gate/helper 只建立於隔離 DB 的 `budget_test` schema，不加入應用 migration。

## 3. 發現的問題與最小修正

初次原生驗證的 13 個案例中：11 通過，1 個真實原型缺陷，1 個測試設定錯誤。

### 原型缺陷：舊 row-first 路徑與新 trip-first patch 形成死鎖

前版 `prepare_budget_metadata_patch` 在取得 trip advisory lock 及 group state 後，直到 invoker UPDATE 才等待 parent row。舊 raw 交易可能先 SELECT FOR UPDATE 取得同列，接著由舊 trigger 等待 trip lock：

```mermaid
flowchart LR
  A["舊交易 A：持 parent row lock"] -->|"等待 trip advisory lock"| B["新 patch B：持 trip advisory lock"]
  B -->|"等待 parent row lock"| A
```

伺服器實際回報 `40P01 deadlock detected`。原始證據：B PID 19328 等 transaction 860（A PID 63028），A 等 B 的 trip advisory lock；log 也保存兩條正在執行的 statement。這不是從程式碼推測的風險。

修正只在尚未套用的 prototype migration 的 `prepare_budget_metadata_patch`：在 trip lock／成功 request replay／enabled 檢查之後，先取得對應 Budget 或 Actual 的 **FOR UPDATE NOWAIT** parent row lock，再讀最新 canonical row、驗 membership／group version，最後建立精確 effect。若其他交易持 parent row，整次以 SQLSTATE **55P03** 安全失敗，立即釋放 transaction 的 trip lock，不再形成等待循環。

已有成功 request 的 replay 仍在 parent lock 前回傳舊成功結果，不因目前 row 忙碌而重寫。拒絕的第一次請求沒有 ledger／effect／field／version 殘留；對方結束後，同一 request ID 重試成功，再重送返回同一成功結果。沒有改動舊已套用 migration、grants、RLS、付款模型或 frontend。

prototype raw source SHA-256：修正前 `fd6c38a4a762c715a81ef5623cca67e55e64398922a881e8b4e62ceb97f0581b` → 修正後 `686017abab6daf966fccf15f9f231f91a58f5d4747526daff23b16453f0cdee6`。初次與最終 bootstrap 中，**其餘 migration raw-byte hashes 全部相同**。

### 測試設定錯誤：authenticated login 不能切換到 anon

首輪測試想從僅有 authenticated membership 的 login `SET ROLE anon`，伺服器正確拒絕。這不是原型 grant 缺陷。修正 harness 為額外的本地 `budget_anon` LOGIN，僅授予 anon，再驗證 public API 的 EXECUTE 拒絕；沒有擴權兩個 authenticated login 或改應用權限。

修正後同一 13-case 組合通過；再擴充 Actual、deferred rollback、撤權與時間證據，最終 17/17 通過。四輪 native cluster 均已關閉，未留下執行中的服務。

## 4. 最終逐項結果

| # | 案例 | 真實重疊／預期結果 | 結果 |
| --- | --- | --- | --- |
| 1 | 同群組、兩使用者搶鎖 | B 真正等 A，A granted、B group_locked；唯一 owner | 通過 |
| 2 | 同帳號不同分頁 Session | 不同 backend／session capability，不能共同持有同組 | 通過 |
| 3 | 不同群組搶鎖 | 交易重疊，title/note 兩個 owner 各自保留權限 | 通過 |
| 4 | Budget title/note 局部更新 | 等待中 observer 只見舊 committed row；提交後雙值保留，金融／participants 未被整筆舊值覆蓋 | 通過 |
| 5 | 獨立 Actual title/note 更新 | 交易重疊；原幣／匯率／known TWD 71／provenance 保持原值 | 通過 |
| 6 | 新群組先取得、舊整筆後到 | 舊 admission 等待後 55P03，新權限保留 | 通過 |
| 7 | 舊整筆先取得、新群組後到 | 新 admission 等待後 legacy_locked，不能搶過 wildcard | 通過 |
| 8 | 等待期間 lease 過期 | B 已阻塞時 server 時鐘證實仍有效；保持 gate 到 server 判定到期，再放行；patch 55P03、值未變 | 通過 |
| 9 | 過期接管與晚到舊 release | A 接管提高 epoch，B release 確實等 A；最後不清掉 A 的新權限 | 通過 |
| 10 | 寫入後交易失敗 | A 已改值但未 commit，B 同時等待；A 22012 rollback，title/revision/request/effect 全回復，B note 成功 | 通過 |
| 11 | Deferred constraint commit 失敗 | A unfinished effect 在 commit 時 40001；B 等待後成功；無 half-write／pending effect／假成功 request | 通過 |
| 12 | 相同 request 同時重送 | 第二條連線等待第一條；只改一次 revision、返回完全相同 canonical result | 通過 |
| 13 | Budget 舊 row-first 對新 patch | 兩 active query／row lock 實證；新 patch NOWAIT 55P03、舊 raw 更新因 group guard 55P03；無 40P01，同 ID retry 成功 | 通過 |
| 14 | Actual 舊 row-first 對新 patch | 驗證另一條 parent lock 分支，結果同上 | 通過 |
| 15 | Advisory lock timeout | B 真等 A，700ms lock_timeout 55P03；無部分修改，同 request retry/replay 成功 | 通過 |
| 16 | 等待期間會員撤權 | A 交易提交撤權，B 等待後重新驗權 42501；不信原先通過的權限／session claim | 通過 |
| 17 | RLS／grants（非並行案例） | viewer 僅讀；pending/outsider/anon 禁寫；四張 private metadata table 禁直接 SELECT | 通過 |

最終 engine log 的 `ERROR: deadlock detected` 次數為 **0**。這是對本次指定 Budget/Actual lock-order schedule 的結果，不是對任何任意 SQL／未來金融群組都不會 deadlock 的保證。

## 5. 回歸與邊界

- 原 [metadata SQL 測試](../tests/budget-metadata-groups-database.mjs) **23/23**：保留原有 migration fault、reverse、RLS/grants、capability/epoch、legacy/raw/child 排他、嚴格 patch、GUC 偽造、unfinished effect、request replay、idle／known debit／撤權／tombstone 測試。
- `budget-database.mjs` 通過：全 migration、計價、RLS、rollback、conflict、fixed Actual、出發快照與刪 Budget origin。
- `budget-safety-database.mjs` 通過：v2 idempotency、confirmation、manual debit、legacy FX、locks、receipts、故障回滾。
- `budget-leases-database.mjs` 通過：whole-record leases／consistent snapshot／receipts／撤權與 6/6 selection checks；沿上一階段使用獨立 LF-normalized fixture，避開歷史 raw SHA guard 對 Windows CRLF 的拒絕，沒有改已套用來源檔。
- `node --check` runner／parallel suite、正常 build、`git diff --check` 通過；既有大 bundle advisory 保留。
- native 測試沒有 Supabase 網路服務、hosted migration、真實 Google OAuth／Realtime 或 Storage bytes API；這些既有 release gate 仍未通過。此階段沒有啟用 UI／autosave／五步 Undo，也沒有擴大至 pricing、payment 或 receipt protocol。

## 6. 變更檔案與重跑

本階段新增／修改：prototype migration 的 parent NOWAIT 檢查、原生 test runner、parallel test suite、這份報告與 JSON evidence；同步更新 prototype handoff／CURRENT_TASK。其他已存在的未提交文件與測試產物保留。

準備官方可攜式 PostgreSQL（解壓到自選目錄），測試 driver 放未追蹤 runtime；不需要 Supabase login、project link 或任何 connection string：

```powershell
npm.cmd install --prefix .tmp-budget-db-runtime --no-package-lock --ignore-scripts --no-audit --no-fund pg@8.16.3 @electric-sql/pglite@0.5.11
$env:BUDGET_TEST_PG_BIN=(Resolve-Path '.tmp-budget-native-pg/runtime/pgsql/bin').Path
node scripts/qa/run-budget-metadata-parallel.mjs
```

runner 自行選本機埠、新建 marker/cluster、載入本地 schema、執行雙連線驗證，最後停止 server；原始報告與 log 在 `.tmp-budget-native-pg/runs/<marker>/`。未追蹤 binary、data、node_modules 與暫存輸出不應加入 Git。

下一步可回到群組 snapshot／協作 invalidation 的 DB 整合設計，再接 title/note 欄位 UI。啟用 prototype 的 hosted rollout、B-2 UI 與金融群組都不屬本次授權。

鎖定機制依 [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html)；重疊觀測採 [pg_stat_activity](https://www.postgresql.org/docs/current/monitoring-stats.html) 與 blocking PIDs。這些是測試設計依據；結論以本次實際 server trace 為準。
