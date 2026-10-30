# Budget B-7 — Preflight、啟用、暫停與 Forward Repair

本文件是可審閱的操作程序，**不是 Hosted 操作授權**。目前所有新前端旗標／DB protocol 預設關閉；真 HTTP 與排程未驗收，結論為 **NO-GO**。請先讀 [驗收矩陣](2026-10-30-budget-b7-integration-acceptance.md)。

最新 B-7 [真服務補驗交接](2026-10-30-budget-b7-service-acceptance-followup.md)：本機 Docker 的 AppData namespace 與缺少 vendor registry 阻擋尚未安全修復，保留 package 私有資料 VHDX；不得改用 Hosted 繞過。CLI Advisor 已用 per-cluster TLS 成功執行，但 managed Supabase／HTTP／Worker 排程仍未通過。以下未執行的部署步驟仍需日後另行授權；本機全部通過後也須先 ChatGPT Review。

## 1. 環境與發行前檢查

1. 確認 feature branch commit／working tree，安裝既有 lockfile 依賴；不可把 `.env`、service-role、Worker JWT、claims、測試 cluster 或原始財務截圖提交 Git。
2. 本輪僅可新建本機 Docker 隔離 Supabase；不能以 Hosted 繞過 Docker 修復，也不得借用 Production。真實 HTTP 必須使用該環境 Auth 建立的兩帳號、各自獨立 browser context/session，再加同帳號第二 tab；SQL `set_config`、fixture 與 Mock 都不能取代這一步。
3. 核對目標 migration history 與 repository 全 chain。不得假設舊交接所載 Hosted checkpoint 仍是實際狀態，不重放／修改既有已套用檔。隔離原生 PG runner 套用全部 SQL，但其 Auth／Storage bootstrap 是 schema fixture，不能代表完整 Supabase 服務相容性。
4. 使用同一個經審閱的版本部署 frontend、RPC/schema 與專用 Worker。所有前端 flag 先維持 false，所有 DB enabled=false。儲存 API、Graph／lease、部分 Snapshot 缺失時只讀／保留草稿，不退回 whole-form Save。
5. 真 HTTP 矩陣須包含九項雙帳號情境、Signed URL／standard upload／replace／delete、upsert／copy／move／signed-upload／TUS／S3 拒絕、斷線／late response、舊客戶端、Worker 故障／重試／跨 job 不可讀刪與仍引用物件保護。核對 actual bytes SHA-256、MIME、size、object UUID；輸出可重現的環境版本、session 身分雜湊、HTTP 狀態與 DB readback，不輸出 token。
6. 安全驗收完成後，另行明確授權該 Hosted 環境的 migration／Storage／Worker／旗標操作；Production 仍須另一筆明確授權。先備份既有財務列、participants、links、來源、receipt metadata／bytes、baselines、request ledger，並確認 restore 演練和 Provider bytes 的保留期。

## 2. 可執行 SQL

所有檔案需以管理連線、`ON_ERROR_STOP` 執行。每份自行開啟／提交交易；不得包在外層 transaction 令 BEGIN/COMMIT 語意改變。先對新建隔離環境操作。

```powershell
# 僅使用隔離資料庫連線；不要把密碼放進 command/log/Git。
# psql 的 PGHOST、PGPORT、PGDATABASE、PGUSER、PGPASSFILE 由安全環境提供。
psql -X -v ON_ERROR_STOP=1 -f docs/operations/budget-b7-preflight.sql
psql -X -v ON_ERROR_STOP=1 -f docs/operations/budget-b7-readback.sql
```

Preflight 檢查 v10／B-7 函式存在、public invoker、private RLS／grants／publication、private 10 MiB bucket／MIME、專用 Worker 無繼承／BYPASSRLS，並列出 pending intents、blocked jobs 與活躍租約。另外比較實際 migration history、部署 commit 與完整函式／trigger 清單；catalog preflight 不是 full Security Advisor。

舊客戶端仍在時，停止發行 signed-upload／resumable／S3 等長效上傳授權；等候**實際最長有效期**完全耗盡。不能任意寫「現在已過期」。下載 Signed URL 原有 600 秒仍可能有效，不承諾即時撤回。

真正 HTTP、專用內容 verifier、cleanup worker 與排程實測都通過後，管理員才可在目標環境記錄 `storage_verified`、`cleanup_worker_verified`、新增的 `content_worker_verified` 及確實已過期的 `legacy_grants_expire_at`。這些值預設 false/null；操作文件不自動把它們改成 true。

## 3. Worker 與排程

新 `budget_receipt_worker` 是 **NOLOGIN／NOINHERIT／NOBYPASSRLS** 專用 server identity。不繼承 authenticated／anon／service_role；不授權 private tables。僅可呼叫 sweep、精確 verification/cleanup claim 與 finish，Storage 僅可讀／刪目前 claim 的 path＋object UUID，需 job/token headers；沒有 INSERT／UPDATE／任意 bucket 權限。Storage API custom-role forwarding 尚須真 HTTP 驗證。

只在可信 server/secret manager 簽發短效、role=`budget_receipt_worker` 的 JWT；不得讓 browser user_metadata 決定 role，也不得把 JWT 放前端。公開 anon key 只作 API gateway key，Authorization 使用專用 JWT；兩者不要混用。金鑰輪換／過期時停止本批，保留 durable claim，重新簽發後依 TTL 重試。

```powershell
# RECEIPT_LOCAL_URL 必須是 http loopback。
# RECEIPT_LOCAL_ANON_KEY、RECEIPT_LOCAL_WORKER_JWT 由隔離環境安全注入。
node scripts/maintenance/budget-receipt-cleanup.mjs --local
node scripts/maintenance/budget-receipt-cleanup.mjs --local --watch
```

`--watch` 每 15 秒執行一批；每批最多 50 個 verification＋50 個 cleanup，每個 transport deadline 10 秒。DB claim TTL 2 分鐘，verification 失敗退避 1 分鐘；`SKIP LOCKED`、claim token／expires 與 object identity 防止多 Worker 重複執行。服務重啟後重試持久工作，不維持僅記憶體的補償。

隔離排程驗收：以 supervisor 啟動上述 `--watch`，跨至少兩輪觀察 queue drain；中途終止、HTTP timeout、丟失 finish ACK 後重啟，確認 claim TTL 恢復、沒有刪除仍引用物件。保存實際排程與 restart/exit/queue-age/blocked-job 監測證據。本次尚未有真實服務可跑，不能把這份設定說成排程已驗收。正式 supervisor/cron、secret 發行與部署不在現有授權內；CLI 仍明確拒絕 Hosted URL，沒有生產排程自動安裝器。

Verifier 下載 exact claimed object，核對 SHA-256、實際大小、MIME 與基本 PDF/JPEG/PNG/WebP container signature，再以 server role 提交證明。DB commit 必須對應同一 object UUID／未過期 intent；檔案替換、錯 hash、尺寸、類型、claim 遺失都保留舊有效收據。此檢查不是防毒、完整 PDF/image decoder 或惡意內容掃描認證；如產品要求，須另外加入受限資源的掃描服務。

## 4. Activation

先暫停寫入／通知 client 保留草稿，等待全部 group、rates、legacy wildcard lease 排空。不要直接刪租約搶權。Preflight／Readback 通過、沒有未處理 blocked cleanup，再在同管理連線設定 `app.budget_b7_http_evidence` 為**經審閱的真 HTTP＋Worker 驗收檔 SHA-256**，執行：

```powershell
psql -X -v ON_ERROR_STOP=1 -f docs/operations/budget-b7-activate.sql
```

證據 digest 可透過安全的 psql session `SET app.budget_b7_http_evidence` 傳入；新的 psql process 不繼承先前 session 的 SET。不要用本文／SQL fixture 的 digest 冒充 HTTP 證據。脚本在單一交易鎖住 protocols，驗證證據格式、legacy expiry、worker/content attestations、active lease 與 blocked queue，才一次開啟 Metadata／Finance／Payment／Source／Receipts／Lifecycle／Undo。B-7 SQL fixture 使用虛構 digest 只是驗證程序 gate／原子性，不是發行許可。

所有相關財務 DML／外 parent statements 會持有共享 protocol fence；Activation/Pause 的 EXCLUSIVE NOWAIT 先拒絕仍在途的交易，沒有「lease 已釋放但 transaction 尚未提交」的空窗。遇到 lock-not-available 請保留原財務交易，待它自然提交／回滾並排空後重試操作腳本，不強制終止財務 backend。

保留旗標預設 false；明確授權後才在目標 frontend 開 `VITE_BUDGET_METADATA_GROUPS`、`VITE_BUDGET_FINANCE_GROUPS`、`VITE_BUDGET_RECEIPTS`、`VITE_BUDGET_LIFECYCLE`、`VITE_BUDGET_UNDO`。其他功能沿用既有 opt-in，不發明新協作協定。舊 Snapshot／原 Request 結果仍可讀；新的 old whole-form writes／wildcard acquire／raw financial children 都回 protocol required。

立即 Readback，逐環境執行真雙帳號 smoke，檢查 parent/participants/receipts／totals／baselines、active lease、pending intent、verification failure、cleanup age、Realtime reconnect 與 client errors。若任一 P0/P1 出現，先 Pause，不以 optimistic UI 當提交證據。

## 5. Pause 與非破壞性回退

```powershell
psql -X -v ON_ERROR_STOP=1 -f docs/operations/budget-b7-pause.sql
psql -X -v ON_ERROR_STOP=1 -f docs/operations/budget-b7-readback.sql
```

Pause 單一交易關閉新寫入協定，保留 activated latch、guard、readers、immutable receipts、版本、歷史與財務資料。已提交的 exact Request replay 可確認結果；新寫入拒絕。既有 lease 可以精確 release，失敗要保留原 request/draft，不 blind rebase。RPC 缺失／protocol disabled 不允許改送 v4 Save。

一般 Pause 仍允許 Worker 收斂既有未引用物件。若要人工還原 bytes／改 metadata references，須額外先停止 Worker、等待所有在途 Storage transport／claim TTL 排空，再取證及修復；不能在 cleanup 仍執行時把物件重新掛回財務資料。

若需 frontend 回退，只回到與現存 schema 相容的只讀版本，保留所有 DB guards；不要為了舊 client 能儲存而關閉 latch、drop trigger、清 ledger 或重建歷史金額。B-1～B-6 的 dormant reverse 不是已使用系統的 rollback。**本次不提供刪表／刪 history／回填舊財務 before-row 的 B-7 reverse。** Schema 程式修復使用新的 forward migration；不是把已提交付款／來源／收據倒帶。

## 6. 可執行恢復／Forward Repair 路徑

| 故障 | 保留狀態與安全動作 |
| --- | --- |
| ACK 遺失／Snapshot 慢 | UI 的確認／重試入口用原 actor/document/request/payload 查證；成功 ACK 只補讀 Snapshot，不另建付款／收據／Undo request |
| pending upload，HTTP 曾成功 | Worker 對 exact object 驗證；成功後原使用者按「確認／重試收據操作」完成原 request。不直接 INSERT metadata、不手動設 verified_at |
| hash／MIME／size 不符 | 不提交；舊收據仍有效。原使用者明確取消／abandon，durable cleanup 清 pending 新物件；修正檔案後建立新 intent |
| worker crash／finish ACK 遺失 | 重新啟動同一專用 Worker，等待 claim TTL，透過 claim／absence 與 finish 重試；不重送 metadata mutation |
| expired/abandoned upload／canonical orphan | Worker sweep 後精確 queue claim；未知 namespace 或無 catalog 的 provider bytes 不猜測，交 Provider inventory／備份對照 |
| cleanup blocked／object ID 改變／仍有 reference | 保持 blocked，不把 object_id 換成目前 ID、不直接重置 waiting。先 Readback／備份／確認引用與原 SHA；個案取得另行授權，再提交含 exact before/after assertions 的 forward repair migration |
| committed metadata 找不到 bytes | Pause 相關寫入，保存 metadata／原始 digest／provider backup。對照備份恢復到隔離環境並重新驗證 bytes／身分；正式修復需個案明確授權，不刪 metadata 掩蓋缺檔、不宣稱 SQL rollback 能恢復 bytes |
| 成本／origin／baseline 不一致 | Pause＋Readback／取證。以業務意圖及 immutable ledger 寫新的精確 forward repair，交易前後全列／joins／版本 assertion；不重算歷史、不刪付款、不改舊成功 result |

修復後再次 Preflight、直接相依 E2E、Readback；仍須通過原 Activation gate 才可恢復。缺少可核對的 before-image、物件身分、備份或授權時維持 fail-closed。

## 7. 明確不支援的外部刪除

新協定曾啟用後，即使 Pause，整旅程刪除遇到 Budget／Actual／baseline／receipt intents/queue、行程或相鄰交通遇到 Budget links、住宿遇到 Budget FK、帳號遇到付款／分攤／成員／收據相依，一律在 parent 前拒絕。它們沒有被偷偷當成 Lifecycle Delete，也不以 SET NULL/cascade 擦除歷史。一般 standalone Budget/Actual 刪除仍走既有完整 lease／effect／tombstone 規則。

正式前端的行程刪除在新 opt-in 下走 `delete_itinerary_item_budget_safe` 單一 invoker transaction；其餘舊客戶端也被 parent/adjacent transport triggers 阻擋。要支援整旅程封存／真正刪除，必須另定帳務／bytes 保留與全圖操作契約，本階段的安全規則是**明確拒絕並保留資料**。

官方查核（2026-10-30）：[Storage custom roles](https://supabase.com/docs/guides/storage/schema/custom-roles)、[RLS access control](https://supabase.com/docs/guides/storage/security/access-control)、[Storage helper functions](https://supabase.com/docs/guides/storage/schema/helper-functions)、[本機 Docker prerequisites](https://supabase.com/docs/guides/self-hosting/docker)。Changelog markdown fetch 被工具拒絕，改查 HTML index；未發現需要升級本案依賴的相關 breaking change，沒有升級套件。這些參考不代表已實測目標 Storage 版本的 custom header/role forwarding。
