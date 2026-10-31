# B-7 Managed Worker 相容候選與隔離驗證

> 後續狀態：使用者另行明確授權新 Hash 與 M0 supersession；新版已在 Staging 完成 COMMIT、Ledger 62 與獨立讀回，見[實際部署報告](2026-10-31-budget-b7-staging-managed-deployment.md)。本文保留較早本機 checkpoint 的授權範圍與 23 次 native 執行證據；下文「尚未授權／最後 Hosted 觀測」描述當時狀態，不代表目前狀態。H01～H03、Activation 仍未通過或啟用。

2026-10-31，從 `aff8d78fdec252b4f95e315204a91e70283e3d5d` 接續，原分支 `codex/budget-collaboration-redesign`。使用者明確授權「本機修正與隔離驗證」；**沒有授權新封包的 Hosted 寫入**。本次沒有連線 Staging／Production、讀取密碼、建立 Hosted fixtures、啟用 Protocol／Flag 或啟動 Worker／排程。

**結果：新版非自動套用候選已完成本機驗證，可交 Review；Hosted 部署與服務驗收仍 NO-GO。** 舊封包與全部原始 Migration、Forward、38 函式 seal 都保留不動。較早[真實 psql 失敗與完整回滾](2026-10-31-budget-b7-staging-psql-deployment.md)仍是最後一次 Hosted 觀測，不宣稱本次重新核對遠端。

候選：[Runbook／精確順序](operations/budget-b7-staging-managed/README.md)、[manifest](operations/budget-b7-staging-managed/packet-manifest.json)、[完整 SQL](operations/budget-b7-staging-managed/dormant-schema.sql)。去敏結果：[本機證據](qa/2026-10-31-budget-b7-managed-worker-results.json)。

## 已確認的角色路徑

- Supabase 官方的 [Storage Custom Roles](https://supabase.com/docs/guides/storage/schema/custom-roles) 使用自訂角色、`authenticator` membership 與專用 role JWT；不要求修改 `supabase_storage_admin`。文件另示範繼承 `anon`，本候選採明確 schema／table／RPC Grants，**不給 Worker anon、authenticated 或 service_role membership**。
- PostgreSQL 17 的 [Role Membership](https://www.postgresql.org/docs/17/role-membership.html) 說明，只要整條鏈都是 `SET TRUE`，原登入角色就可直接切換到間接角色；`INHERIT FALSE` 會阻止自動繼承，並不阻止明確 `SET ROLE`。
- 前次 Staging 唯讀封存已記錄 `supabase_storage_admin → authenticator` 的 SET 路徑。這是歷史證據，不代替下一次部署前的即時檢查。新候選遇到路徑缺失直接 fail-closed，不新增或修理這條受管理關係。
- 官方 Storage 原始碼固定於 commit `9d15cdc93c0b1afc37708914f5e45f865b231d48`：[`pg-connection.ts`](https://github.com/supabase/storage/blob/9d15cdc93c0b1afc37708914f5e45f865b231d48/src/internal/database/pg-connection.ts) 從 JWT payload 取角色，將 Headers 傳入 scope；[`postgres/scope.ts`](https://github.com/supabase/storage/blob/9d15cdc93c0b1afc37708914f5e45f865b231d48/src/internal/database/postgres/scope.ts) 以交易區域設定 role、JWT claims、request.headers；[`jwt.ts`](https://github.com/supabase/storage/blob/9d15cdc93c0b1afc37708914f5e45f865b231d48/src/http/plugins/jwt.ts) 先驗證 JWT。

這支持本候選的設計，但 **master commit 不是 Staging 正在執行的版本證據**。實際 JWT 驗證、Headers 完整傳遞、Storage bytes／API 行為仍須 H02／H03 測得，不能由閱讀原始碼推導通過。

## 修正範圍

另建立 `20261031083437_budget_managed_worker_role_path.sql`（M0），版本來自現有官方 Supabase CLI `migration new`，在 ignored 隔離目錄產生，再由 deterministic builder 輸出到非自動套用目錄。沒有在 `supabase/migrations` 新增、覆寫或搬移檔案，也沒有升級 CLI。

M0 是未提交舊 `20261030125028` 的**完整替代來源**，函式、Guard、Trigger、Policy 與財務邏輯原文均相同，只替換 Worker 角色授予的 DO block，並增加來源註記：

1. 檢查既有 Storage／authenticator 角色與 SET 路徑；不存在即拒絕。
2. 只明確執行 `GRANT budget_receipt_worker TO authenticator WITH INHERIT FALSE, SET TRUE`；不直接修改 reserved role。
3. 檢查 Storage／API 均能 SET Worker、authenticator 不自動繼承、Worker 不繼承任何角色、沒有非預期直接會員，並確認 schema Usage、禁止 schema Create，以及 Storage Select／Delete 與禁止其他資料操作的權限。
4. 保留 Worker `NOLOGIN／NOINHERIT／NOBYPASSRLS`，逐 job／token／object ID／claim expiry／仍被引用保護全部不變。沒有改用 service_role，也沒有 Worker Runtime／前端變更。

非 superuser 隔離測試找出 PostgreSQL 的自動 creator ADMIN membership：[`Role Attributes`](https://www.postgresql.org/docs/17/role-attributes.html) 確認，非 superuser CREATEROLE 建立角色時，會得到 ADMIN TRUE／SET FALSE／INHERIT FALSE。M0 僅允許執行角色具有這種管理關係，其他會員或更寬的旗標仍拒絕。這不是一般用戶的權限；建立者本來就能管理新角色，ADMIN 不能視為防止該管理者自行擴權的安全邊界。

測試亦發現 stock fixture 的 schema Usage 缺乏 GRANT OPTION，可能讓 GRANT 只產生 warning 卻未授予權限。已修正**本機 fixture**以符合前次 Managed 查核，並在 M0 加入授予後的權限檢查，避免產出表面安裝成功、Worker 無法使用的結果。沒有在 Hosted 擴權。

## 真實來源與 Ledger

- 安裝順序改為 **T0＋12 個未改 B-7 來源＋M0＋原 F0**，仍為 15 個來源、Ledger 47 → 62。原 `20261031003000` Hotfix 不重播。
- Manifest 明確封存 superseded 舊來源的檔名／版本／Hash 與新 M0 完整來源 Hash。執行與登記的是 M0；**不偽造 `20261030125028` 已執行，也不把修改過的內容登記在舊版本下**。
- Packet 拒絕舊版本或 M0 已登記、非 47 筆基線、既有 Hash／資料 Drift 或 SET 路徑缺失。已有原 B-7 安裝的環境不適用，須另做正常 Forward Upgrade。
- Fresh 驗證使用明確 supersession map：保留所有原始檔，排除舊 B-7 最後一份，依時間套用 M0；結果 Hotfix 在 M0 前、F0 在後。
- 原檔仍存在 `supabase/migrations`，一般 CLI 會把舊版本視為未套用。**不可執行 db push／include-all、migration repair、空 Ledger tombstone 或手工補「已套用」來掩蓋差異。** Review 必須接受這個明確替代歷史與未來來源選擇規則後，才能授權部署；這是可審查的方案，尚未被使用者批准為正式 migration reconciliation 政策。

新封包 SHA-256：`6a61cddbd039832b648c76cff385ee3803eaada6e2f252169affe8b9540bcf47`，1,493,588 bytes。舊封包仍為 `4d43bddf6ed7853daa3008c51b58d76b868553330b919f885d82a200f546698b`。共同支援 seal 未重新封存。

新增 `.gitattributes` 僅固定新版目錄的 SQL 為 LF，保留 Windows checkout 的封包 bytes／SHA；不套用到既有 Migration 或舊封包。

## 本機結果

既有原生 PostgreSQL 17.11 Runner 新增 `--managed-worker`，只派送新測試檔，未改舊測試預期值或重跑歷史功能全套。**Staging 順序 14/14、Fresh 順序 9/9；共 23 次 case execution、15 個不同情境**：

- 新連線的非 superuser installer 完成候選 schema；獨立非 superuser Storage／authenticator 連線成功經 SET 鏈切換 Worker，一般帳號不能切換。
- 缺少既有 SET 路徑拒絕；在 Forward 第一個改寫後注入故障，角色、membership、schema、函式、Ledger 及財務原資料全部回滾。
- 62 筆 Ledger 的 M0／其他實際來源精確相符，舊版本缺席；完整候選重送拒絕且已提交狀態不變。
- 13 張保護表的原始欄位投影 Hash／數量相符，包含付款歷史、手動來源、Receipt metadata 與 frozen Baseline。
- 38 個最終函式全部匹配既有 after-seal，包含最後動態 Guard；54 PT409／24 PT500，自訂 40001 為 0。M0 靜態函式定義無差異，Forward 自身仍檢查 OID／Owner／ACL／Security／設定不變。
- 真 SQL RLS：正確 claim 可讀；缺少／錯誤 Header、錯誤 Token、過期租約、Object ID 變更都拒絕；精確 cleanup 只刪符合條件的 fixture metadata，仍被引用的收據不刪。
- 原有 Preflight／Readback 在兩個新安裝的 native fixture 通過，七組 Protocol／Latch 一直維持 false；private tables 有 RLS、沒有 raw client／worker grants。
- Production Build、四份受影響 JS Syntax、原封包與新封包 offline checker、JSON／文件連結／diff checks 通過。Build 只有既有大 chunk 提示，沒有因本次調整警告門檻。

**範圍限制：** Native stock PostgreSQL 沒有 Supautils；為測試 schema Policy DDL，fixture table owner 使用可管理的測試 owner，未模擬 Managed Auth／Storage 真實所有權豁免。這是真非 superuser SET／RLS／交易驗證，**不是 Hosted 完整權限演練**。fixture 保護指紋以合成資料產生，不是實際 Staging 備份；預設候選檔仍綁原封存的 Staging 指紋，沒有為了通過而改它。SQL metadata 刪除只在合成 fixture 用來測 RLS，不能當 Storage HTTP／bytes 清理成功。[官方 Storage schema 說明](https://supabase.com/docs/guides/storage/schema/design) 要求實際檔案變更經 API。

## GO／NO-GO 與後續授權

| 項目 | 判斷 |
| --- | --- |
| 新候選、明確 supersession、原封存不變，交 Review | **GO，本機測得範圍通過** |
| 舊 4d43 封包 | **NO-GO，已知 Managed Grant 不相容，禁止重跑** |
| 新候選 Hosted Dormant 部署 | **NO-GO，尚無新版本授權與 Managed 實測** |
| H01～H03／Activation／正式上線 | **Blocked，未開始、未證明就緒** |

下一輪最小範圍：先審查並接受 M0 替代來源／Ledger 規則，再明確授權僅指定 Staging 的新 Hash 封包。仍須新鮮唯讀檢查身分、47 Ledger、原資料／Hotfix／Catalog、既有 SET 鏈與 grant-option、無在途交易；同 Session／ON_ERROR_STOP／原 BEGIN/COMMIT／全部鎖與 Timeout 保留。任一 Drift、Managed 角色限制或未知 COMMIT 立即停止並獨立讀回，不移除保護條件或猜測修正。

即使 Dormant 安裝成功，也不包含 fixture/JWT provisioning、Storage 檔案、Worker 排程或 Activation；H01～H03 需另外明確授權。前端所有新 flags 保持預設 OFF。
