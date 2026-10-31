# B-7 Staging Dormant Schema 封包與操作 Runbook

2026-10-31。**待 ChatGPT Review；禁止自動執行。** 只適用 `Travel-Planner-Staging`（`uyqdopksfysbobhjcepk`），不能用於 Production。完整結果見 [本輪交接](../../2026-10-31-budget-b7-forward-package-validation.md)。

## 封包內容與重現

- `dormant-schema.sql`：完整來源、單一外層交易、精確 ledger 登記、保護指紋和最後讀回。位於非自動套用目錄；沒有連線設定或執行器。
- `packet-manifest.json`：15 個新增來源的 LF-normalized SHA-256、封包 Hash／大小、保留的舊 hotfix Hash、分類與編譯封存 Hash。這些 Hash 不是備份。
- `20261031130000_budget_business_conflicts_forward.sql`：終版 Forward 候選，**尚未安裝**；版本須在實際部署前再次確認無碰撞。不能移入自動 migration 流程後順便部署。
- `compiled-definitions.json`、`compiled-seal.json`：原生 PostgreSQL 實際編譯的 38 組 before／after 原文與 SHA-256；包括最後動態 Save Guard。fixture OID 不當成遠端 OID。
- `baseline-seal.json`：已套用 PT409 的 13 個舊基線函式 body Hash；本輪由相同不可變來源在隔離 DB 重建，**不冒充新一次遠端 catalog 觀察**。
- `error-classification.json`：78 個 message／分類／理由；54 個業務 PT409、24 個內部完整性 PT500。

在 repo 根目錄執行以下**離線生成／本機隔離**命令，不含 Hosted executor：

```powershell
node scripts/qa/run-budget-metadata-parallel.mjs --forward --seal
node scripts/qa/run-budget-metadata-parallel.mjs --forward --fresh-chain
node scripts/qa/build-b7-staging-packet.mjs
Get-FileHash docs/operations/budget-b7-staging/dormant-schema.sql -Algorithm SHA256
```

Runner 使用既有原生 PostgreSQL runtime、全新 marker 叢集、隨機 loopback port；結束停止叢集，不接受外部 DB URL。Auth／Storage schema 是 fixture。第二次生成必須與 manifest 的封包 Hash 相同；若來源或資料基線變更，停止，重做差異 Review，不能直接更新預期 Hash 過關。既有 61 個 migration 原文未修改。

## 唯一安裝順序

Staging 已有 `20261031003000`，**不重播**。封包依序安裝下列 15 個來源；每個完整來源同交易寫入 ledger `statements[1]`。只剝除來源的 top-level BEGIN／COMMIT，不修改 dollar body。ledger 47 → 62。

| 順序 | 來源 |
| --- | --- |
| T0 | `20260811150000_atomic_apply_itinerary_alternative.sql` |
| 1 | `20261029020551_budget_group_metadata_prototype.sql` |
| 2 | `20261029031137_budget_metadata_snapshot_signals.sql` |
| 3 | `20261029091435_budget_metadata_undo_prototype.sql` |
| 4 | `20261029114817_budget_category_payer_links_groups.sql` |
| 5 | `20261029123907_budget_pricing_participant_groups.sql` |
| 6 | `20261029134206_budget_payment_lifecycle_groups.sql` |
| 7 | `20261030012554_budget_payment_minimal_bundle.sql` |
| 8 | `20261030021719_budget_source_atomic_groups.sql` |
| 9 | `20261030034351_budget_receipts_lifecycle.sql` |
| 10 | `20261030054628_budget_financial_dependencies.sql` |
| 11 | `20261030064703_budget_workspace_lifecycle.sql` |
| 12 | `20261030082712_budget_workspace_undo.sql` |
| 13 | `20261030125028_budget_workspace_integration_safety.sql` |
| F0 | `20261031130000_budget_business_conflicts_forward.sql` |

T0 是本來缺失的 Timeline 原子 alternative API，先於 Links／跨功能驗收補齊；不是 B-7 啟用。Fresh 測試依全部 61 個原始檔的時間排序安裝，再接 F0；舊 hotfix 在 B-7 後只執行一次。不能使用 `db push --include-all`。

## 未來另行授權後的安裝 gate

以下是操作計畫，**本輪未執行 Hosted 備份、安裝、啟用、Worker 或 HTTP 驗收**。

1. 明確確認專案 ref、維護時窗、執行角色；另外授權 dormant schema＋ledger 寫入。將前端維持舊版且所有 QA opt-in 關閉，停止新的寫入來源；檢查在途請求／lease，不能把一次活動連線為零當成維護保證。
2. 重新唯讀讀取 Staging 的 47 筆 ledger、13 個基線 body、依賴 catalog／ACL／RLS／trigger／publication／role membership、Auth 使用者與 Storage 清單。檢查既有 31 筆無完整 source 的歷史記錄之必要依賴；原生 fixture 完整來源不證明遠端未知定義相同。**缺少這項對照時仍 NO-GO**。
3. 建立授權範圍內的獨立加密 DB 備份（含 public／app_private／Auth 必要資料、ledger、角色與 ACL 清單）、Storage bytes＋object ID／路徑／metadata 清單；保留原件，雜湊核對並在另一個隔離目標驗證可讀／可還原。不要提交 dump、個人 ID、token、原始日誌。此項尚未完成。不能以本輪 rowset Hash 或 Docker 備份代替 Supabase 備份。
4. 逐項比對先前記錄的 **2 trips／1 user／25 itinerary items／3 alternatives／1 frozen Baseline／Storage objects 0** 與 13 表保護指紋。封包硬性綁定先前去敏預檢的指紋，任何 drift 都拒絕。不得為了安裝而改資料或盲目重封 Hash。必要時建立新版本封包並重驗。
5. 封包最前方鎖住 ledger、13 個 public 保護表、Auth.users、Storage.objects／buckets，`SHARE ROW EXCLUSIVE` 允許普通 SELECT，阻擋其他 writer；DDL 可能進一步要求強鎖。lock timeout 5s／statement timeout 60s，任一步失敗全交易 rollback。必須先確認 managed Auth／Storage owner 權限允許鎖表；本機 admin 通過不保證 Hosted 執行角色相同。需要安靜維護時窗，無權限時不降級移除保護鎖。
6. 經再次授權的 operator 在**同一資料庫 Session**明確設定 `app.b7_install_target='uyqdopksfysbobhjcepk'` 後，才可用 ON_ERROR_STOP 的 SQL client 將整個封包作為一個交易執行。這個 GUC 是防誤操作提示，**不是伺服器身分證明**；必須另核對連線專案。不提供可誤觸執行的連線命令。
7. 封包會拒絕 ledger／known source／baseline body drift、重複安裝、非 dormant protocol、自訂未知 40001；交易內保存每張表的原始欄位投影，核對所有原始資料不變，允許新增 schema 欄位。T0／13 個 B-7／F0 的 exact source ledger 同交易提交；成功才發出 PostgREST reload NOTIFY。
8. 提交後獨立唯讀連線逐項核對 ledger 62／F0 來源 Hash、38 個 after body Hash、未被 F0 涉及的 hotfix 原路徑、OID／owner／ACL／SECURITY／search_path、RLS／grants／private publication、原始欄位資料投影／Auth／Storage／Baseline／歷史成本。執行既有 [Preflight](../budget-b7-preflight.sql) 與 [Readback](../budget-b7-readback.sql)，再做 Managed Security Advisor。既有 Readback 是狀態摘要，不可取代部署前後逐欄位資料與 catalog 比較。未知缺失全部停止，不自動設置 readiness=true。

## Rollback／Forward Repair 與停止條件

尚未提交：任何 source／catalog／資料 drift、權限或 lock timeout、DDL／Deferred Constraint／Forward／ledger 失敗，整筆 ROLLBACK；獨立讀回原 ledger47、所有表／roles／schema／function Hash。隔離 DB 已在第一個 Forward 重寫後注入除零，證明前面 T0／13 個 B-7、role membership、ledger 和原資料全部回復；部署鎖也阻擋了真正第二連線 writer，直到 rollback。

已提交、尚未啟用：保持 dormant，停止下游驗收，保存讀回與備份。只準備新的、經審閱授權的 Forward Repair；不 drop schema／role、不刪 ledger、不覆寫已提交來源、不重新跑舊 hotfix。這個完整安裝封包刻意拒絕重跑；**只有 F0 本身精確 after-hash no-op 可重跑**。

已啟用後的未來事故：依另行授權執行既有 [Pause](../budget-b7-pause.sql)，停新的 group writes，保留 activated latch／history／pending intent／Receipt metadata／bytes，讀回並 Forward Repair。**Pause 不等於回到舊版相容狀態**，也不撤銷 parent guard。不得以還原舊 dump、重計價、刪資料或重設 latch 撤銷已提交財務操作。備份僅用於隔離重建／比對／經授權復原設計。

## H01～H03：能力證據與完整 E2E 分開

| Gate | Activation 前可驗證能力（仍待授權實測） | Activation 後完整驗收（仍 Blocked） |
| --- | --- | --- |
| H01 | 真 Auth 兩帳號、獨立 Session／同帳號雙 tab；reader、disabled mutation 拒絕、Realtime 建連／斷線／背景恢復；不產生群組成功寫入證明 | 不同／同群組競爭、租約、計價／付款／retained Actual／Source／匯率／Receipt、Undo 五步與 peer 衝突、新增／刪除、unknown ACK 原 ID replay／delayed Snapshot、撤權／登出／trip switch／late response、v1–v10 與 mixed-client 保護 |
| H02 | 隔離 Private Bucket 的真 HTTP 及平台 RLS／JWT/header forwarding；受控 queue fixture 必須標明 setup，不能冒充正常 begin/commit RPC | 正常 Receipt Upload／Replace／Delete／Signed URL，SHA-256＋MIME＋size＋實際內容，原 object ID 改變／並發／metadata-bytes 不一致、pending／orphan／legacy bytes 防護 |
| H03 | 專用 Worker JWT（`budget_receipt_worker`）、claims／headers、least privilege、排程 supervisor 能力與兩輪＋故障恢復；不能用 service_role 代替 | 真 receipt pipeline／claim fencing／retry／restart／timeout／持久 queue／已引用 object 不誤刪，兩輪以上 schedule 與重啟後恢復證據 |

兩組證據各有 manifest／時間範圍／結果／digest：`preactivation-capability` 只能證明實際測得的服務能力；`postactivation-e2e` 才能證明完整使用流程。現有 activation SQL 的 evidence GUC 是 operator attestation，不能從 Hash 推導未跑的 E2E。若 Review 仍要求 postactivation 全 E2E 作為首次 activation 的前置，循環依賴沒有解決，**維持 activation BLOCKED**；不得偽造 evidence/readiness、弱化 latch 或借 SQL fixture 補通過。Worker 的 Staging-only HTTP adapter／JWT 簽發與 supervisor 尚未實作驗證；實際 legacy grant 最長有效期也須真證據，不能猜期限。

QA setup 必須先授權建立精確兩個可拋棄帳號及新 QA trips／files／queues，使用獨立 prefix、本機保留 ID 對照；原始兩個旅程與一個帳號永不列入清理集合。Auth admin 只做 setup／teardown，一般 mutation 一律 user JWT；Worker 用專用 JWT。不得洩露 JWT／signed URLs／檔案內容。

QA 清理先撤回 session、釋放 lease，正常 RPC 清除可清項目；有 Baseline／已提交 payment／audit／request receipt／pending intent 或 B-7 Parent Guard 拒絕的旅程／帳號，標為 **待授權保留**，封存去敏數量與原因，停止整旅程／Auth user 刪除。Pause 後仍遵守相同規則；不得 disable trigger、清 latch、手動 cascade、刪歷史或用 service_role 強制 purge。測試檔只有在沒有引用且 cleanup claim／object ID fence 全部成立時才能刪 bytes。

## GO／NO-GO

| 階段 | 決策 | 邊界 |
| --- | --- | --- |
| 本機 Forward／controller／離線封包供 Review | GO（本輪結果見交接） | 原生 SQL＋受控 browser 證據；不代表真服務 |
| Hosted dormant schema 安裝 | NO-GO，等待 Review＋明確授權 | 新鮮唯讀 catalog／備份還原／權限與維護 gate 未完成 |
| H01～H03 fixture／HTTP／Worker 能力驗證 | Blocked，未授權未實測 | 必須另授權 QA 保留、Storage、專用身分及排程範圍 |
| Protocol／QA frontend opt-in／完整 E2E | NO-GO | readiness 語意、真 legacy expiry 和前述證據未完成 |
| Production／main／Vercel | NO-GO | 本輪完全不在授權範圍 |

官方語意來源：[PostgREST 自訂 PT 狀態碼](https://docs.postgrest.org/en/stable/references/errors.html#raise-errors-with-http-status-codes)、[PostgreSQL 17 serialization／deadlock handling](https://www.postgresql.org/docs/17/mvcc-serialization-failure-handling.html)。本輪保留 engine 40001／40P01，沒有用 PT409 取代真正交易重試。Supabase changelog Markdown 抓取失敗，無法用它宣稱已完成最新變更全量比對；本輪沒有導入新 Supabase API／SDK 或 managed schema 相容性假設。
