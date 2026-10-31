# B-7 Staging psql 部署失敗與完整回滾驗證

2026-10-31，分支 `codex/budget-collaboration-redesign`，Git 起點 `2da16221a42f0ecaad10ff21cb7b113078407fd3`。唯一資料庫目標 `Travel-Planner-Staging`／`uyqdopksfysbobhjcepk`。本次沿用指定 Dormant Schema 的 DDL／Role／Grant／Ledger 授權；使用者自行完成 Staging 密碼重設後，要求繼續。沒有操作 Production。

**結果：連線成功、部署失敗、完整交易回滾已獨立確認；NO-GO。** 原封包在 B-7 Worker 的 Managed reserved-role Grant 被拒絕，沒有到達 F0 或 COMMIT。沒有更改封包、移除 Grant、擴權或重送。下一步先交 ChatGPT Review，不能開始 H01～H03／Activation。

去敏證據：[本次結果](qa/2026-10-31-budget-b7-staging-psql-deployment-results.json)。較早的[缺少憑證紀錄](2026-10-31-budget-b7-staging-psql-readiness.md)與[SQL Editor 大小拒絕](2026-10-31-budget-b7-staging-dormant-deployment.md)保留歷史效力，已非目前阻擋原因。

## 連線與憑證

- 現有原生 `psql 17.11`，沒有安裝軟體或啟動 Docker／WSL。Direct DNS 有 AAAA，但 Windows 無 IPv6 預設路由、Direct 無法建立連線；因此使用 Dashboard 已核對的 **Session Pooler 5432**，沒有使用 Transaction Pooler。
- 實際端點 `aws-0-ap-northeast-1.pooler.supabase.com:5432`；登入角色 `postgres.uyqdopksfysbobhjcepk`，資料庫 `postgres`。`psql \conninfo` 確認目標與 **TLSv1.3／TLS_AES_256_GCM_SHA384**。設定 `sslmode=verify-full`，使用 Dashboard 所連結的官方 CA，SHA-256 `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`。
- SQL 的 current/session user 均為 `postgres`、伺服器 PostgreSQL 17.6，伺服器位址與此 Staging Direct DNS 對應；身分確認不只依賴 target GUC。沒有連線 Production。
- 使用者在本機遮罩表單輸入新 DB 密碼，僅透過子程序環境傳給 libpq，未保存 passfile、密碼 URI、命令列參數或密碼日誌。忽略目錄中的 runner／SQL／metadata 不含密碼；工作結束已停止 helper 並釋放程序。訊息切換曾結束記憶體 helper，使用者重新輸入後才繼續。
- `pg_stat_ssl.ssl=false` 是 **Pooler 到 backend** 這一段的觀測，不是用戶端 TLS。最初把它當成用戶端檢查而拒絕，釐清後以 psql conninfo 與明確 verify-full 設定驗證；沒有降低 SSL 模式。[官方 psql／TLS 程序](https://supabase.com/docs/guides/database/psql)。

## 部署前核對

16:21:31～16:21:57（Asia/Taipei），新原生 psql 連線，READ ONLY：

| 項目 | 結果 |
| --- | --- |
| Ledger | 47 筆，Head `20261031003000`；版本／名稱／已有完整來源 Hash 與原封存相同 |
| 13 個 PT409 Hotfix | body Hash 全相符；自訂 `40001` 為 0 |
| Catalog | 八類逐項 Hash 相符：25 tables/RLS、280 columns、147 constraints、83 indexes、45 triggers、57 policies、82 custom functions、21 publication entries |
| 函式屬性 | 82 個既有函式的 OID／Owner／ACL／Security／設定等 catalog 屬性相符；prosrc 由 body Hash 另核對 |
| 資料 | 28 組既有欄位投影、數量及 rowset Hash 相符，包含 public／private／Auth／Storage |
| 執行角色與 Grants | postgres 非 superuser、具 CREATEROLE；Auth trigger/references、Storage usage/select/delete 轉授、既有強鎖權限檢查通過 |
| 維護狀態 | 有效 lease 0、其他未完成 client transaction 0、prepared transaction 0 |
| 原封包 | 1,488,439 bytes，SHA-256 `4d43bddf6ed7853daa3008c51b58d76b868553330b919f885d82a200f546698b`；15 來源、38 seal、78 分類點檢查通過，未重新封存 |

31 筆沒有完整單一 source 的舊 Ledger 仍不宣稱原文 byte parity；必要現有 schema 依賴透過完整 Catalog 與先前實際 Staging 封存比對。

較廣的新查詢另顯示 3 筆 `supabase_admin` default ACL 與 3 筆 `supabase_realtime_admin` membership。既有封存分別只涵蓋部署 owner `postgres` 與執行 principals；對相同範圍逐項比較後全部一致。完整新觀測保留於 ignored 本機證據，沒有改舊 Hash／預期資料；這些額外 managed 記錄也在本次部署前後完全一致。這個查詢範圍差異不是修改遠端或重新封存的理由。

**先前的 Grant／CREATEROLE／lock 查核不涵蓋 Supautils 的 reserved-role utility hook。** 本次實際失敗證明不能再把這些查核合稱「所有 Managed DDL 權限已通過」。

## 實際執行與 P0

本機 ignored wrapper 僅設 `ON_ERROR_STOP`、同 Session 的 `app.b7_install_target`，再 `\i` 原 SQL。使用 `-X -w -q -A -t -v ON_ERROR_STOP=1 -f`；沒有 `-1`，保留封包原有 BEGIN／COMMIT、保護鎖、lock timeout 5 秒、statement timeout 60 秒。沒有重播既有 Hotfix。完整 15-source 順序未改，執行到第 13 個 B-7 source 的角色授予時失敗。

16:22:50（結果檔完成時間，Asia/Taipei），psql **exit code 3**，原封包第 **13692** 行：

```text
ERROR: "supabase_storage_admin" is a reserved role, only superusers can modify it
CONTEXT: SQL statement "grant budget_receipt_worker to supabase_storage_admin"
```

原始來源：`supabase/migrations/20261030125028_budget_workspace_integration_safety.sql` 第 20～24 行 DO block。本次 stderr 未要求 verbose SQLSTATE，沒有把推測的 SQLSTATE 當作實測。`ON_ERROR_STOP` 中止且 psql 關閉連線；沒有到達 COMMIT，不是連線 ACK 不明，也沒有盲目重送。

**P0：Receipt Worker 的 Storage impersonation／membership 方案與 Hosted reserved-role 保護不相容。** Supabase 官方說明 postgres 不是 superuser，並使用 Supautils 保護服務角色；官方測試包含相同 reserved-role 錯誤。[Managed 角色限制](https://supabase.com/docs/guides/database/postgres/roles-superuser)、[reserved-role 保護設計](https://supabase.com/blog/roles-postgres-hooks)、[Supautils 官方測試](https://github.com/supabase/supautils/blob/master/test/expected/reserved_roles.out)。

不能靠 CREATEROLE、重設 DB 密碼、改 Pooler、較長 Timeout 或同一封包重試解決。也不能刪掉這一行就宣稱 Worker HTTP 權限相同。原生 PostgreSQL fixture 沒有這項 Managed hook，所以先前隔離通過不構成此操作可在 Hosted 執行的證據。

## 新連線獨立回滾讀回

16:23:00～16:23:34（Asia/Taipei），**新的 psql 程序／唯讀連線**，backend PID `77596`（部署前查核 PID `77588`；不把它宣稱為未另取樣的部署 PID）：

- Ledger **47 → 47**，Head 不變；指定 15 個新增 version **全部不存在**。
- T0 API、七組 Protocol 表、`budget_receipt_worker` role 均不存在；沒有殘留 B-7 schema 或 Activation Latch。這是「未安裝」，不是存在七筆 false 的協定列。
- Ledger、28 組原始資料、八類 Catalog、82 個函式屬性、13 個 Hotfix、Schema／Default ACL／Role membership／Storage policies／postgres role／managed policy grants **逐項完全一致**。16 組回滾比較全相符。
- 原資料維持 **2 trips／1 Auth user／25 itinerary items／3 alternatives／1 Baseline／7 pack items／2 memberships／1 private bucket／0 Storage objects**；Budget／Actual／Receipt 仍為 0。沒有讀取或提交個人資料明文。
- 有效 lease、其他未完成 transaction、prepared transaction 皆 0；自訂 `40001` 0，private raw client/worker table grants 0。
- 所有既有 RLS／ACL／Trigger／財務保護未變。**未做破壞性 Rollback、刪資料、drop role 或修改 Ledger**；讀回證明的是 PostgreSQL 自動原子回滾。

## Advisor、Flags 與驗收矩陣

Supabase connector 的 Advisor 權限仍拒絕；使用已登入、指定 Staging Dashboard 的 Managed Security Advisor 讀取及 Refresh，沒有用 SQL fixture 代替：

- 前後皆 **0 errors／9 warnings／2 infos**，新增問題 0。
- 警告是既有 8 個 signed-in SECURITY DEFINER API，加 Auth leaked password protection disabled。
- Info 是既有 private `budget_edit_leases`／`budget_selections` RLS enabled no policy；raw client grants 為 0。
- 這次 P0 是安裝相容性問題；交易回滾後 Advisor 不會把它當成已安裝 schema 的漏洞報出。0 errors 不代表可部署。

| 驗收 | 狀態 |
| --- | --- |
| 原生 psql／指定 Staging／verify-full TLS | Passed |
| 原封包來源、Ledger47、Hotfix、Catalog／原始資料前置 | Passed，Managed reserved-role capability 不在已通過範圍 |
| 完整原子封包安裝／COMMIT／Ledger62 | **Failed**，reserved-role Grant；未 COMMIT |
| 失敗後獨立回滾／原資料與權限保全 | **Passed** |
| 38 final Hash／54 PT409＋24 PT500 的 Hosted 安裝 | **Blocked，未安裝**；離線 seal 不作遠端通過證據 |
| 安裝後既有 Preflight／Readback SQL | **Blocked**，必要 B-7 表／API 不存在；沒有執行來假造成功 |
| Managed Security Advisor 前後比較 | Passed，0／9／2 不變 |
| Protocol／Latch | Passed 未啟用；所有七組表不存在 |
| 前端 Flags | source 仍 explicit opt-in、預設 OFF；本機 env 無 B-7 opt-in，無前端／Vercel變更。未另讀取 Vercel 遠端 env，不宣稱其 live 值已驗證 |
| H01～H03／Activation／Production | Blocked，未開始、未授權擴大 |

H01 仍缺真雙帳號 Browser／Auth／Realtime／衝突與恢復；H02 仍缺 Receipt Storage HTTP、Signed URL、內容驗證與 RLS；H03 仍缺專用 Worker JWT／Header、最小權限、兩輪排程與故障恢復。沒有新增 fixture、檔案、帳號、Worker 或排程。

## 下一步與停止條件

1. **停止重試原封包並交 ChatGPT Review。** 新 P0 必須先研究官方支援的專用 Worker／Storage 身分路徑，不修改 reserved role、不借 service_role 代替最小權限驗收。
2. 需另行授權必要程式／部署封包修訂及隔離驗證；原始 migrations／封包／seals 保留不動。新方案必須說明 immutable history、Managed 相容安裝順序與來源登記，不能用 F0 後追加一份 migration 修補一個會在到達 F0 前失敗的封包。
3. 先在能重現非-superuser／reserved-role 限制的環境驗證拒絕及安全相容方案，再送新封包／Hash 供 Review；**本輪沒有設計或實作繞過方法**。仍須取得新版本 Staging-only 部署授權後才重驗並部署。
4. 不需要為本次失敗清庫、刪測試資料或恢復備份。沒有備份／還原通過主張；此純測試 Staging 的備份前置仍依使用者決策豁免。

本次只增加文件／去敏證據，沒有產品、Migration、Manifest 或 seal 修改。不重跑未受影響歷史 Unit／Build；離線封包 checker、文件連結／JSON、`git diff --check` 驗證後 Commit／Push 原分支，停止。
