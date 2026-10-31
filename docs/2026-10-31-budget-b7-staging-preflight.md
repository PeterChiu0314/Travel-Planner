# Budget B-7 Staging 部署前安全預檢

日期：2026-10-31，Asia/Taipei。起點／已 fetch 的 GitHub 原分支 HEAD：`7b9f5a5c0c0408134d2a731ef2c65c2725cf674b`。

**決策：唯讀預檢完成；實際部署／啟用仍 NO-GO，停止等待 ChatGPT Review。** 本輪沒有執行任何 migration（包含 rollback 演練）、fixture 建立、Storage 操作、Worker、protocol／flag 更新、Docker、main merge 或前端部署。先前 Staging 測試的操作授權不延伸到這次 B-7；本輪新指示只授權唯讀、草案與文件。

## 1. 本輪 live 唯讀證據

| 項目 | 新觀測／界限 |
| --- | --- |
| Production `lqvuqamzmchepgxkftcw` | Dashboard 約 **11:37**：Healthy、CPU **2%**、RAM 52%、6/60 connections；最近 60 分鐘 **10:37–11:37 PostgreSQL Error 0**，高 CPU banner 消失。可判斷該觀測時段已恢復；不是長期保證，也沒有執行修復、終止 backend 或修改 Production。 |
| Staging `uyqdopksfysbobhjcepk` ledger | **11:41:52** 的 `BEGIN TRANSACTION READ ONLY` 查詢：47 筆，head `20261031003000`；GitHub 同一 commit 有 61 個 SQL 檔，remote-only 版本 0、缺少 14 個。 |
| 原 hotfix | live `public/app_private` 13 個 PT409 函式、0 個自訂 `40001`；B-7 metadata protocol 與專用 Worker role 均不存在。 |
| 已記錄 source | 15 筆新基線／hotfix 原文 SHA-256 完全相符。舊 Phase 7 import 有 1 筆 byte-hash 差異，已證實只差外層空白：trim 後原文相等、lexical tokens 相等，ledger／GitHub／live body 三方 hash 都為 `15bf3368cef00d10b9f45092bff68a562e6408f30de9adcdeeba326c36e34273`；live invoker、anon 無 execute、authenticated 可 execute、search_path 相符。**不要為空白差異重寫 ledger。** |
| 未完整記錄的歷史 | 其餘 **31 筆** ledger 沒有可直接比對的單一完整 source。只能確認版本存在，不能宣稱全歷史 source parity；部署前仍須對必要 schema／constraint／trigger／RLS／grant 做 catalog 對照。 |
| 資料保護 | **11:48:41**：2 trips、1 Auth user、2 memberships、25 itinerary items、3 alternatives、**1 Baseline**；Budget／Actual／participants／Budget Links／attachments／行李皆 0。13 個指定 public 表已取得 rowset SHA-256，原始列與個資未輸出／提交。 |
| Storage／協作 | private `trip-attachments`、10 MiB、JPEG/PNG/WebP/PDF；objects 0、bytes 0；leases／selections／signals／request receipts 0，active API queries 0（瞬間觀測）。空 bucket 不能證明歷史 upload grants 已過期。 |

去敏詳細結果：[預檢證據](qa/2026-10-31-budget-b7-preflight-audit.json)。Production screenshot 與讀回僅留本機；原始診斷資料、密鑰、個人路徑不提交 Git。

## 2. 缺失、依賴與明確安裝順序

不能以 ledger 的最大版本推定中間檔案已執行。`20261031003000` 已實際套用，**不得 replay、改內容或標成 reverted**。禁止 `db push --include-all`、repair ledger 假裝補齊，或直接重放全部歷史檔。

| 順序 | 缺少的原始檔／版本 | 必要依賴、影響與驗證 |
| --- | --- | --- |
| T0 | `20260811150000_atomic_apply_itinerary_alternative.sql` | Staging 的 public/private `apply_itinerary_alternative` **兩者都不存在**，不是單純漏 ledger。依賴既有 Timeline 表、替代方案及權限 helpers。非 B-7 DDL 的直接呼叫依賴，但 H01 Timeline/Links/替代方案整合需先補 runtime parity。原檔只建立函式／權限／comment，沒有業務 DML。建議另行授權後明確安裝原檔並真實登記該舊版本；不得只補 ledger。 |
| 1 | `20261029020551_budget_group_metadata_prototype.sql` | 既有 October baseline／leases；建立 dormant Metadata、effect、group state、Title/Note。6 個自訂 RAISE。 |
| 2 | `20261029031137_budget_metadata_snapshot_signals.sql` | 序號 1＋既有 consistent snapshot；signals/readers/publication。0 個。 |
| 3 | `20261029091435_budget_metadata_undo_prototype.sql` | 序號 1/2；初版 Metadata Undo／lineage。6 個。 |
| 4 | `20261029114817_budget_category_payer_links_groups.sql` | 前三檔；Category/Payer/Links 與 Snapshot v2。8 個。 |
| 5 | `20261029123907_budget_pricing_participant_groups.sql` | 序號 4＋舊財務 baseline；Pricing/Participants、graph/effects、Snapshot v3；**覆寫舊 Save**。17 個。 |
| 6 | `20261029134206_budget_payment_lifecycle_groups.sql` | Pricing；Payment、Snapshot v4。11 個。 |
| 7 | `20261030012554_budget_payment_minimal_bundle.sql` | Payment；最小付款 bundle、Snapshot v5。5 個。 |
| 8 | `20261030021719_budget_source_atomic_groups.sql` | Pricing/Payment；Source、來源保護、Snapshot v6。10 個。 |
| 9 | `20261030034351_budget_receipts_lifecycle.sql` | Source/Payment、現有 Storage schema/private bucket；Receipt intents/cleanup/RLS、Snapshot v7。12 個。數字僅是檔案安裝順序，不是新增 Issue 子階段。 |
| 10 | `20261030054628_budget_financial_dependencies.sql` | 前述全部；Finance dependency/rates/effects、Snapshot v8。20 個。 |
| 11 | `20261030064703_budget_workspace_lifecycle.sql` | Finance/Receipt；空白新增／Complete／刪除、Snapshot v9。18 個。 |
| 12 | `20261030082712_budget_workspace_undo.sql` | Lifecycle／舊 Undo；完整五步分頁 Undo、Snapshot v10。23 個。 |
| 13 | `20261030125028_budget_workspace_integration_safety.sql` | 全部前置；Worker role／trusted verification、parent fences、legacy replay latch、private ledger RLS、Snapshot 修正。5 個。 |
| F0 | **待 Review 後分配新版本，必須大於 `20261031003000`** | 新的 terminal forward repair，最後處理下節 38 個已審閱函式，保留 序號 13 動態安裝的 guards。不是重跑舊 hotfix，也不是改已套用歷史。草案仍不能執行。 |

上述 13 個 B-1～B-7 檔必須維持原先依賴順序。建議未來經完整演練的**白名單原子封包**安裝 T0＋13 檔＋F0，最後才 commit／schema reload；禁止逐檔 commit 後讓中間的 `40001` 版本暴露給流量。每個原檔的 BEGIN/COMMIT 包裝需由經審閱封包精確處理，不能把現成含 COMMIT 的來源直接外包一層 BEGIN 就宣稱原子性。未知 DDL 非交易限制／managed role 權限失敗即全批停止，不跳過。

## 3. `40001` 風險與 Forward 修正草案

[完整風險清單](2026-10-31-budget-b7-40001-audit.md)與去敏 JSON 列出每個檔／函式／RAISE 行號。離線 lexer 排除註解、字串假例與 serialization handler：13 個待部署檔共 **141 個實際自訂 RAISE 點，分布於 69 個歷史函式定義**；後續定義覆寫後，靜態推估 terminal 為 **38 個函式／78 個點**。兩個 `DO ... pg_get_functiondef ... EXECUTE` 區塊另列，不冒充已實跑的 live catalog。

- P0：序號 5 在 `public.save_budget_workspace_record(uuid,text,uuid,timestamptz,jsonb)` 重新引入 **3 個**業務 `40001`。原 hotfix 已在 ledger，新部署不會自動再執行它；即使手動再跑，也只涵蓋原 13 個舊函式，不能修完新群組函式。
- 序號 13 動態修改 4 個 Save wrappers 和 private request helper，增加 legacy replay/protocol fences；另修改 Links guard/reader。這些改動本身不新增 `40001`，但 Forward 必須以**最後的含 guard 定義**為基礎。不可還原舊 hotfix 時的完整函式而移除新 guards。
- 自訂版本、依賴、Undo lineage、stale resource、未完成 effect 的 RAISE 都是確定性拒絕，重跑相同交易無法自行消失；應保留原 message/detail/hint，改用 PT409（內部 invariant 類仍須逐項 Review，不能留自訂 serialization_failure）。真正 engine-generated `40001` 與 `40P01`、EXCEPTION handlers、既有原生競爭測試保留。`budgetPayment.js`／`budgetSourceGroups.js` 中本機合成的 `40001` 沒有送到 PostgREST，不能因文字相同就一併替換。
- P1：`budgetMetadataService.js` 與 `budgetPaymentGroups.js` 沒有將 PT409 納入已知拒絕；只有舊 whole-form service 已相容。提供 [未套用 client patch](operations/drafts/budget-b7-pt409-client.patch)：保留草稿與錯誤訊息、清除已知拒絕的 generic pending request、保留 Receipt 的 deliberate `retainRequestOnError` hook；未知 ACK／transport failure 仍用原 ID 恢復，不做 blind rebase。

[Forward SQL 草案](operations/drafts/budget-b7-no-business-40001.sql)放在 active migration 目錄外，含**無條件 DRAFT 停止**、一個動態 Save 未封存的 NULL fingerprint、結尾 ROLLBACK。它不是可部署檔，未在任何 DB 執行／編譯。設計只允許具名 signature＋已核對 before/after body hash＋RAISE 數量，逐函式保留 OID/owner/ACL/security/search_path 等全部其他 `pg_proc` 屬性，遇到未知 code／函式 drift 一律 rollback。before/after 雙 fingerprint 也須涵蓋 fresh chronological chain 中舊 hotfix 已先把 Save 轉成 PT409 的情況，以及重複執行的 no-op。

升格為 executable Forward 前，必須在另行授權的隔離 DB 編譯實際完整順序、封存 序號 13 動態 gate 的最終 before/after hash、驗證零自訂 40001、財務影像／attrs／default-off／fault rollback／fresh chain 與 out-of-order chain。**本輪只通過離線 lexer 5/5、patch apply-check 與 draft JS syntax；沒有 migration chain 或修正後 controller 的行為驗收。** 不以 PostgREST 升級代替修正；Supabase 明載 PostgREST 14 會因自訂 40001 無限重試，[官方說明](https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions)；真正 engine error 的交易重試語意依 [PostgreSQL 文件](https://www.postgresql.org/docs/current/mvcc-serialization-failure-handling.html)。

## 4. Staging 部署與 H01～H03 順序計畫

下列都是**未執行、待額外授權**的計畫；不是新增 B-8 或分拆 Issue 子階段。原先的 PT409 20 案例只證明舊基線，不代表 B-7 群組／Realtime／Browser 已通過。

1. **Review gate／封包準備**：解決 P0 Forward、P1 controller 草案、T0 決策、31 筆歷史 catalog 必要依賴對照；建立不可變來源 manifest、before-data dump/hash、可讀回的加密備份與相同版本還原演練。原始 2 trip IDs／1 user ID、25 items／3 alternatives／1 Baseline、Storage UUIDs 為保護集合，僅留本機。明確維護時窗，不靠「目前 0 活動連線」假設未來沒有在途交易。
2. **只安裝 dormant schema**：明確 Staging target、47 筆原 ledger hash／來源差異狀態及保護指紋相符後，執行已審閱 T0＋13＋F0 原子封包及 exact ledger 登記。所有前端 flags、DB enabled、activated latch 均保持初始 off；Worker 不啟動／不排程。只執行安全 catalog/readback/Advisor，驗證私有表 RLS/ACL/publication、public invoker、原始資料、新/舊 RPC、13 個 hotfix 原路徑與全庫自訂 40001=0。
3. **驗證能力證據（協定尚未啟用）**：另行授權建立兩個真 Auth QA 帳號及獨立 QA 旅程、最小 Storage 檔案／可追蹤 queue fixtures；所有正常 mutation 之後都用一般 user JWT。H01 先檢查 disabled 拒絕／reader／unknown client fail-closed；H02/H03 可先跑 Storage 平台權限及 dedicated-role HTTP pipeline。直接種 queue 只用於能力測試，必須標為 fixture setup，不能宣稱正常 Receipt RPC 全流程已通過。
4. **避免 activation 證據循環**：現有 `budget-b7-activate.sql` 要求真 HTTP／Worker digest 與 readiness attestations，但完整 H01、Receipt begin/commit／legacy-byte 拒絕又需協定已啟用。Review 必須先核准：把「preactivation 平台／pipeline readiness」與「postactivation 完整 E2E」分開記錄、分開 digest，前者只可聲明已實測能力，不能把尚未跑的 H01/H02 寫成 passed。若現有 attestation 語意不能支持這個界線，**維持 activation NO-GO，另做經審閱測試 admission 設計**；不偽填 true、虛構 HTTP hash、移除 latch 或暫停 trigger。
5. **Staging controlled activation／本機 QA frontend**：只有 readiness 範圍、真實最長 legacy grant expiry、專用 Worker JWT/header forwarding、維護時窗和啟用／Pause 明確另授權後，才能用既有 gate controlled activation。以 localhost QA frontend 明確指向 Staging，ignored QA env opt-in flags；不要改 tracked 預設或部署 Production／Vercel。跑完下表，才評完整 B-7 acceptance。任何失敗先依停止規則處理。

| Gate | 必須補驗的真服務內容 | 證據與通過條件 | 現狀 |
| --- | --- | --- | --- |
| H01 | 真 Auth 兩帳號、各自獨立 browser context＋同帳號第二 tab；不同群組並寫、同群組拒絕、Pricing/Payment/Source/FX/retained Actual、五步 Undo 與 peer 修改、新增/Complete/刪除競爭；Realtime 更新/reconnect、背景/lease 到期、斷線；unknown ACK、原 Request Replay、Snapshot delay；撤權/登出/trip switch/reload/late response、ActiveEditorGuard；舊客戶端整筆 Save/raw DML/wildcard。v1–v10 Snapshot 與 Timeline alternatives/Links/統計同步；在真 Session 整合流程核對 Ctrl+Z 原生輸入優先、Portal/IME 與草稿，不重跑未受影響的全部歷史 UI 案例。 | 實際 Auth JWT/session 身分去敏、WebSocket SUBSCRIBED/重連與後續 authoritative read、PostgREST status/reason、browser screenshots/console；獲確認後 graph/participants/Receipt/Baseline/totals 一致；草稿及原 request 恢復正確。不能用 Mock/SQL 取代 Browser／Realtime。 | **Blocked**；hotfix 20 案例不是此 gate。 |
| H02 | 真 private Storage standard Upload/Replace/Delete/Signed URL；anon/跨帳號/錯 path/錯 headers/舊 direct byte delete；upsert/copy/move/signed upload/TUS/S3 可用路徑與拒絕；檔案 SHA-256/MIME/大小/實際 container、object UUID/path ABA；metadata/bytes 不一致、Pending Intent/expired/orphan/reference-safe cleanup。 | 保存無 token 的 HTTP status、object UUID 雜湊/bytes digest、DB readback；錯檔／置換失敗保留舊有效收據；已引用檔案不得刪。測試前後保護集合不變。既有 signed URL 的有效期要真實等待／取證，不宣稱立即撤銷。 | **Blocked**；bucket 設定正確、objects=0 不是 HTTP 驗收。 |
| H03 | 專用 `budget_receipt_worker` JWT；Auth/PostgREST/Storage custom role/job-token headers 實際 forwarding；最小權限、錯 job/token/過期/cross-job deny；server content verifier；真 supervisor 至少兩輪、restart、10s timeout、finish ACK 遺失、2min claim 到期、1min retry／durable queue；still-referenced與object-ID變化競爭。 | 真 HTTP、role/grants readback、supervisor start/exit/restart、兩輪 queue-age/attempt/claim 記錄；不能用 service-role 代替此角色驗收。結束明確 stop supervisor，等待在途 transport/claim 排空。 | **Blocked**；現有 maintenance CLI 僅接受 loopback，尚無 Staging supervisor/adapter。 |

H03 應另做**硬鎖 Staging project、短效專用 Worker JWT 的受信任測試 adapter**，重用 `reconcileBudgetReceipts`。保留現有 `--local` URL guard，不能刪 guard 後傳 Hosted URL，也不能把管理金鑰作 Worker JWT。整個 sweep 會盤點全 bucket 的 canonical orphans；未來只要出現不屬於 QA manifest 的候選 object/job，即停止 Worker，不以全域清理當測試收尾。

H01/H02/H03 的 matrix 應逐項 Passed/Failed/Blocked；失敗必須查因，不放寬 assertion／加 timeout。DB catalog/Advisor、Build、Browser、HTTP與Worker證據分開記錄，不合併為一個籠統 passed。

## 5. 清理、停止與非破壞性回復

**不得沿用 `run-staging-business-conflicts.mjs` 的整旅程／Auth-user DELETE 來清 B-7。** 啟用後 parent guard 會因 Baseline、財務列、Receipt intent/cleanup 等拒絕 cascade；Pause 只關 enabled，保留 activated latch，因此不會解除拒絕。正常 QA 旅程也會建立 Baseline；Receipt/audit 記錄還可能必須留存。

清理計畫依序：凍結 QA 操作／保存結果 → 透過正式操作入口收斂或明確 abandon 原 Request → 用 Lifecycle/Receipt protocol 清理可清的 QA 業務資料 → 讓 exact-job Worker 確認引用／UUID後清 bytes → stop supervisor，等 transport/claim TTL → 確認沒有未解 pending/blocked → 解除 QA sessions，隔離／停用 QA 帳號入口。所有候選必須同時匹配 run/trip/user/object UUID manifest 且不在原始保護集合。

若 parent guard 仍擋住 QA trip/user 刪除，**保留標記的 QA 旅程、Baseline與稽核記錄**，報告 retained / blocked，不偷偷刪 Baseline/ledger、關 trigger、改 activated、以 service-role 繞過或刪任何原始資料。Review 需選擇是否授權保留隔離 fixture/audit；若要求最終回到只有原 2 trips/1 user，現有 B-7 沒有安全 archival/purge protocol，**在該清理方案完成前部署 NO-GO**。這是清理規則的實際限制，不承諾 Pause 後可完全移除測試資料。

| 停止條件 | 動作／回復 |
| --- | --- |
| ledger/source/catalog、資料/Storage manifest drift；非 QA 候選；未知自訂 40001；Forward hash/count不符 | 不開始；若尚未 commit，整批 transaction rollback，原 hotfix/ledger/財務保留。不能跳過失敗 statement。 |
| 安裝後 default-off/RLS/grants/trigger/函式屬性變化不符，或 controller PT409 尚未完成驗證 | 不 activation、不前端 flags、不 Worker；保留新 schema，經審閱的 forward repair。 |
| CPU/error 爆量、重複 deterministic Request、金融／Receipt/Source/Baseline 不一致、draft overwrite、越權、未知 ACK | 停止發送新操作／保留 Request；啟用後依明確 Staging 操作授權 Pause、讀回。不能為排空而強殺財務 backend。Production 僅回報，任何修復另授權。 |
| Worker 可能誤刪／UUID或reference改變／跨 job 授權 | 先停 supervisor、等待 transport/claims，保全 bytes/metadata/queue；blocked/quarantine，不盲目重試 delete。 |
| 已提交財務操作出錯 | Pause＋只讀 frontend、保留 guards/latches/history/receipts/source origin/Baseline；新增 forward repair。禁止 destructive down、清 history、改 ledger 假回滾或以 before-row 覆蓋已提交操作。 |

## 6. GO／NO-GO 與額外授權

| 決策範圍 | 判斷 |
| --- | --- |
| 本輪唯讀檢查、離線稽核、草案、文件 | **GO / 完成**；Production 該時窗恢復、Staging 差異已定位。 |
| 現有 13 檔直接部署到 Staging | **NO-GO（P0）**：會重新引入自訂 40001。 |
| 草案直接當 executable migration / frontend | **NO-GO（P1）**：Forward 未編譯／動態 fingerprint 未封存；client patch 未套用與行為驗證。 |
| Staging schema rollout | **NO-GO**，直到上述修正／必要 catalog對照／T0與原子封包／資料保全及清理保留決策 Review 通過，並另行明確授權。 |
| H01/H02/H03 controlled activation／Worker | **NO-GO / Blocked**：readiness/bootstrap證據界線、legacy grants expiry、Staging adapter/JWT/supervisor 未具備或未授權。 |
| Production B-7 啟用 | **NO-GO**；本輪恢復觀測與舊 hotfix測試不代表正式上線準備完成。 |

Review 後需分清楚的授權範圍（本輪不索取、不執行）：

1. **Staging schema**：列名 T0、13 個 B-1～B-7、已封存新 Forward、exact ledger/RLS/role/grants，及原子失敗回復；不包含 activation/flags/schedule。
2. **測試資料與保全**：真 Auth 帳號／獨立旅程／Storage/queue fixture、加密備份與還原驗證、精確 manifest 清理，並接受 guarded QA/audit 保留，或先審查安全 archival/purge 能力。
3. **Worker 身分與 runtime**：專用短效 JWT 簽發/secret handling、僅 Staging adapter/supervisor、兩輪與故障恢復，及停止／撤回 QA session 的權限；不用 service-role 驗收。
4. **Staging controlled activation**：真 readiness 證據 scope/digest、實際 legacy grant expiry、現有 attestation gate、localhost QA opt-in frontend flags、H01/H02/H03 與 Pause/Readback。若需 Hosted frontend Preview，另行列明，不暗含在本機 QA 內。
5. Production schema/RLS/Storage/Worker/旗標/排程、main merge、正式前端部署一律仍需獨立明確授權。

本次保留所有舊通過證據；沒有重跑歷史單元測試、20 個 hotfix HTTP 案例、Build 或任何 Supabase 功能驗收。完成 source/patch/syntax/diff 檢查後只 Commit/Push 原分支，停止等待 Review。
