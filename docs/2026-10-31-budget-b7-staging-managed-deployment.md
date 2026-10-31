# B-7 Staging Managed Dormant Schema 部署與獨立驗收

2026-10-31，從 `14f0d3150ba9676410ea29c857f191f3dcd5e9a6` 接續，分支 `codex/budget-collaboration-redesign`。

**結果：指定新版封包已完成 COMMIT；Dormant Schema 安裝與獨立唯讀驗收 Passed。完整 B-7 服務驗收、Activation 及正式上線仍為 NO-GO，停止等待 ChatGPT Review。**

唯一目標為 `Travel-Planner-Staging`／`uyqdopksfysbobhjcepk`。使用者另行明確授權本次新 Hash、M0 supersession、Ledger 47 → 62 及唯讀驗收；未操作 Production、前端部署、H01～H03 fixtures、Worker 或排程。純測試 Staging 的備份部署門檻已由使用者取消；本次沒有備份／還原成功的宣稱，也沒有刪除或重建環境。

## 封包與交易證據

- [Managed Runbook／15 個精確來源](operations/budget-b7-staging-managed/README.md)、[immutable manifest](operations/budget-b7-staging-managed/packet-manifest.json)、[去敏結果](qa/2026-10-31-budget-b7-staging-managed-deployment-results.json)。
- 原樣執行 `docs/operations/budget-b7-staging-managed/dormant-schema.sql`，1,493,588 bytes，SHA-256 **`6a61cddbd039832b648c76cff385ee3803eaada6e2f252169affe8b9540bcf47`**。沒有改 SQL、manifest、原 Migration、F0 或函式 seals。
- 實際來源為 T0＋12 個未修改 B-7＋完整 M0 `20261031083437`＋原 F0，合計 15 個。使用者接受 M0 取代未提交的 `20261030125028`；舊版本保持未登記，沒有 tombstone／migration repair。原 `20261031003000` Hotfix 沒有重播。
- PostgreSQL 17.11 `psql`，單一持續 Session、`ON_ERROR_STOP=1`，先設定指定 target，再載入完整原樣 SQL；保留封包的單一 BEGIN／COMMIT、強鎖、5 秒 lock timeout 與 60 秒 statement timeout。沒有 `-1`、逐檔提交或分段執行。
- 部署程序 **exit 0、stdout 明確出現 COMMIT**；唯一 NOTICE 為 `B7 forward verified 38 routines; changed 38`。本新版只有一次實際封包執行。部署前曾有一次密碼驗證拒絕，該次沒有執行 SQL；使用者在本機遮罩輸入視窗重新輸入後才成功連線。

Direct 解析有 IPv6，但本機沒有 IPv6 default route，因此使用 **Session Pooler 5432**，不是 Transaction Pooler。專案身分由實際 host、project-bound pooler login、Direct DNS 對應及資料庫身分共同核對，沒有只依賴 target GUC。`psql \conninfo` 證明 client → pooler 的 `sslmode=verify-full`、TLS 1.3；`pg_stat_ssl` 的 pooler → backend 狀態不作為 client TLS 判據。密碼只留於 helper 記憶體及子程序環境，沒有寫入檔案、CLI URI、聊天或 Git；helper 已結束，狀態為 `stopped / passwordSaved=false`。

## 即時前置檢查

17:05～17:06（Asia/Taipei）完成 15 項前置檢查，全部通過後才執行：

- Ledger 47、head `20261031003000`；13 個 Hotfix body Hash、原始 Catalog 八組 section Hash、82 個函式屬性及 28 組資料投影與前次完整回滾封存一致。
- 原 schema、完整 default ACL／role memberships、四個 Storage policies、Managed grants 及必要 DDL／Auth／Storage 鎖定能力成立；既有 Storage → authenticator SET 路徑存在，M0／被取代版本均未安裝。
- 沒有有效編輯租約、其他未完成 client 寫入交易、prepared transaction、自訂 `40001` 或 private raw client grants。維護與封包鎖定條件沒有放寬。
- Managed Advisor 在部署前重新讀取為 **0 Error／9 Warning／2 Info**。沒有重新封存來源或資料預期值來通過檢查。

## COMMIT 後獨立讀回

17:07:50 起，使用新的 `psql` client 程序／唯讀連線讀取，並執行已安裝的 Preflight／Readback；**22 項檢查全部通過**。Session Pooler 可以重用 backend PID；獨立性指新的 client 連線與交易，不宣稱每個 backend PID 都不同。去敏結果保留實際 PID 與此限制。

| 項目 | 實測結果 |
| --- | --- |
| Ledger／來源 | **62 筆**，head `20261031130000`；15 個新來源名稱及 normalized SHA-256 完全符合 manifest；M0 存在，`20261030125028` 缺席；原 47 筆 identity／可核對來源 Hash 未變 |
| 最終函式 | **38／38** body Hash 符合既有 after-seal，**54 PT409／24 PT500**；沒有未知明文自訂 `ERRCODE 40001`。未改真正 PostgreSQL 產生的 `40001`／`40P01` |
| 舊 Hotfix | 13 條路徑全部核對：9 個 body 不變、3 個符合 M0 精確 Guard 變換、`save_workspace_record` 符合 F0 最終 seal；PT409 保留 |
| 原函式屬性 | 82 個原有函式 OID／Owner／ACL／settings 等保持，只有下述兩個明確設計的 SECURITY DEFINER 變更；全部 271 個 app 函式 owner 為核對過的 postgres |
| 資料保護 | **28 組原始欄位投影的 Hash／數量／欄位全相同**；2 旅程、1 Auth user、25 行程、3 備案、1 Baseline、7 pack items、2 memberships、1 private bucket／0 objects 保留 |
| RLS／ACL／Publication | 44 個 app table 均啟用 RLS；private raw PUBLIC／anon／authenticated／Worker grants 為 0；原 public／private 57 policies 與四個既有 Storage policies 保留；原 21 publication table memberships 保留，private 未發布 |
| Parent Guard | auth.users、public.accommodations、public.itinerary_items、public.trips 四個 Guard 均存在且 enabled |
| Worker | 專用 NOLOGIN／NOINHERIT／NOBYPASSRLS，無 superuser／CREATEDB／CREATEROLE／REPLICATION；Storage bucket SELECT、objects SELECT／DELETE，無其他寫入；schema USAGE、有 CREATE 者不包含 anon／authenticated／Worker |
| 匿名權限 | 新 RPC 全部匿名不可執行；唯一原有匿名 custom API 為唯讀 `get_share_snapshot(text)` |
| Protocol／Latch | metadata、source、payment、finance、lifecycle、receipt、undo **七組均 OFF**，各 activated／full_enabled／receipt readiness 亦均 false |
| Preflight／Readback | 已安裝腳本成功；active wildcard／group leases、pending receipts、blocked cleanup 全為 0；missing receipt objects 為 0；Baseline hash 保持 `6d451ff219e1e8404c68ec2e6805a46cbb482de84c1219875a746c8413586c21` |

兩個有意義的函式 security 變更是 `app_private.keep_actual_budget_origin()` 與 `app_private.keep_actual_twd_cost()`：`prosecdef false → true`，精確符合 immutable B-7 來源；它們是 private trigger functions，固定空 search_path、owner postgres、ACL 僅 postgres、匿名不可執行。不是未說明的屬性 drift。

Worker 只有兩個新 membership：authenticator 的 `ADMIN=false / INHERIT=false / SET=true`；以及 PostgreSQL 非 superuser creator postgres 的 `ADMIN=true / INHERIT=false / SET=false`。原有 membership 沒有改。已核對 Managed transitive SET 的 Catalog 能力；**未以實際 Worker JWT、HTTP、Header 或排程執行證明 runtime 成功**。

原 31 筆多 statement 歷史 Ledger 缺乏可直接一對一的完整原始檔，仍不能宣稱其原文逐 bytes 一致；本次驗證其 identity、現有 Catalog／必要依賴及原資料不變。現有 Budget／Actual／participant／receipt 財務表本來為空，本次也仍為空；資料保護讀回不等於真實財務操作 E2E。

前端 source default flags 未修改，本機 env 沒有 `VITE_BUDGET_` opt-in，亦未部署前端。沒有讀取或更改遠端 Vercel env，故不宣稱遠端環境變數已實測。

## Managed Security Advisor 差異

| 等級 | 部署前 | 部署後 | 說明 |
| --- | --- | --- | --- |
| Error | 0 | 0 | 沒有新增 Error |
| Warning | 9 | 10 | 原 8 個 signed-in SECURITY DEFINER API 與 Auth leaked-password protection 警告保留；新增 T0 API 一項 |
| Info | 2 | 22 | 新增 19 個 private table 加上 1 個既有 request ledger 的 RLS hardening，合計新增 20 項 default-deny 提示 |

新增 Warning 為 `public.apply_itinerary_alternative(...)`。實際 wrapper／private callee 與 T0 原文 Hash 相同；search_path 固定，匿名不可執行，callee 仍檢查 `auth.uid()`、`can_edit_trip`、parent／alternative 關聯與版本鎖；client／Worker 不能 CREATE 到相關 schema。記為 **P2、預期 signed-in SECURITY DEFINER API 提示**，不阻擋 Dormant 安裝。真實帳號的允許／拒絕行為仍待 H01；沒有壓掉警告或變更 Grants。

22 項 Info 全為 `app_private` 表 **RLS Enabled No Policy**，逐項核對 RLS=true、policy count=0、無 raw client／Worker grants、無 private publication。這是 RPC-owned private ledger／protocol／lease 表的 default-deny 設計；去敏 JSON 列出完整表名。新增的是 20 項提示，不能寫成新增 20 張表。

**本次 Dormant 安裝範圍沒有未解的 P0／P1。** 服務層驗收仍受下節 gate 阻擋，不能用 schema／Catalog 結果取代。

## 驗收決策與停止點

| 範圍 | 狀態 | 下一步 |
| --- | --- | --- |
| 指定新封包安裝、COMMIT、獨立 Catalog／Ledger／來源／資料保護驗收 | **Passed／GO，已完成** | 保存證據；禁止重送整包 |
| Protocol／Latch／readiness 保持 OFF | **Passed** | 未獲另行授權前保持 OFF |
| H01：真實 Auth／PostgREST／Realtime、兩帳號／雙分頁、租約／Undo／ACK／撤權與舊新版隔離 | **Blocked／未執行** | 先 Review，再明確授權測試 fixtures、帳號與完整服務流程 |
| H02：Private Storage 真 HTTP upload／replace／delete／signed URL、RLS／Headers／專用 Worker JWT、內容完整性與仍引用保護 | **Blocked／未執行** | 專用 Worker 身分，不得用 service role 代替權限驗收 |
| H03：Worker 至少兩輪排程、重啟／timeout／持久重試、cleanup／orphan 故障恢復 | **Blocked／未執行** | 另行授權啟動、排程與測試資料保留規則 |
| 完整 B-7 Activation／上線 | **NO-GO** | H01～H03 與 Activation gate 尚未通過；須另行授權 |

H01～H03 必須先區分 Activation 前能力檢查與 Activation 後 E2E；不得提前把 readiness 設為 true。QA fixtures 若因 Parent Guard／Baseline／稽核依賴不能刪除，應保留並列待授權項，不能繞過 Guard 強制清理。本輪沒有建立測試帳號、旅程、Storage objects、JWT 或 Worker jobs。

已 COMMIT 的修復採另版、可 Review 的 Forward Repair；不得刪 Ledger、drop 協定／角色、重算歷史成本或以破壞性回滾還原財務操作。原 4d43 封包仍禁止執行；新 6a61 封包也不可在已安裝環境重播。禁止 `db push --include-all`、空補舊版本或手工改 Hash 來消除 supersession 差異。

## 本輪檢查範圍

本輪沒有修改 runtime 程式或重跑不受影響的歷史功能測試／23 個 native candidate executions。Build、四份 Syntax 及隔離候選測試的成功證據屬於前一個 `14f0d31` checkpoint，[原報告](2026-10-31-budget-b7-managed-worker-candidate.md)保留其限制。本輪另做實際部署前／後檢查、Advisor、文件連結／JSON／`git diff --check` 及 immutable packet／Git 來源差異核對。原始 Catalog 輸出、憑證、診斷與截圖不提交 Git。

部署與讀回完成後停止，等待 ChatGPT Review；沒有自動開始下一階段。
