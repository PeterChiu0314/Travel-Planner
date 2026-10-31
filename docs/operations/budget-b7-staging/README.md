# B-7 Staging Dormant Schema 封包與操作 Runbook

後續[另版 Managed Worker 封包](../budget-b7-staging-managed/README.md)已另獲新 Hash 與 M0 supersession 明確授權，並完成 Staging COMMIT／Ledger 62／獨立讀回，見[新部署報告](../../2026-10-31-budget-b7-staging-managed-deployment.md)。本目錄的原封包／manifest／seals未變且原封包仍 NO-GO；本頁下文保留舊版失敗 checkpoint，不能當目前 Ledger 狀態。不要重跑任何整包或自動補 Ledger；H01～H03／Activation 仍待 Review 與另行授權。

2026-10-31。只適用 `Travel-Planner-Staging`（`uyqdopksfysbobhjcepk`），不能用於 Production。[封包產出交接](../../2026-10-31-budget-b7-forward-package-validation.md)。**原指定 Dormant 安裝已有授權並經 psql 實際嘗試，但 Managed reserved-role Grant 失敗；完整回滾確認，禁止重試原封包。**

目前：[psql部署與獨立回滾](../../2026-10-31-budget-b7-staging-psql-deployment.md)。使用者自行重設 Staging DB 密碼後，原生psql17.11以 Session Pooler5432 / verify-full TLS1.3 成功連線。16:21前置符合；原封包第13692行 `grant budget_receipt_worker to supabase_storage_admin` 被平台 reserved-role hook 拒絕，psql exit3，未 COMMIT。16:23新唯讀連線證明 Ledger47、15版本全未安裝、原資料/Catalog/ACL/角色關係全部回復。七組協定與Worker role不存在；沒有Activation/QA/Worker。

**P0未解：CREATEROLE、table grants、policy_grants及lock權限不代表能修改 Managed reserved role。** 此封包不具 Hosted 安裝相容性；不准去掉 Grant、改權限、跳過錯誤或同Hash重送。先研究官方支援的最小權限 Worker/Storage 身分及新封包方案，隔離驗證並取得新版本Review/部署授權。不能用F0後追加migration修補到達F0前就失敗的安裝。

較早[缺憑證暫停](../../2026-10-31-budget-b7-staging-psql-readiness.md)、[SQL Editor大小拒絕](../../2026-10-31-budget-b7-staging-dormant-deployment.md)與[預檢](../../2026-10-31-budget-b7-staging-final-predeploy-verification.md)均保留歷史。使用者只對此純測試Staging取消備份P0門檻，不是備份/還原通過；不授權清庫/重建/刪資料。原SQL/manifest/seals全未改，SQL Editor仍禁止作為替代通道。

SQL註解中的「No Hosted authorization」是封包產出時備註；不改註解以保持原Hash。本輪已授權的原封包嘗試完成並失敗，現在停止等待ChatGPT Review，沒有重試或擴權授權。

## 封包內容與重現

- `dormant-schema.sql`：完整來源、單一外層交易、精確 ledger 登記、保護指紋和最後讀回。位於非自動套用目錄；沒有連線設定或執行器。
- `packet-manifest.json`：15 個新增來源的 LF-normalized SHA-256、封包 Hash／大小、保留的舊 hotfix Hash、分類與編譯封存 Hash。這些 Hash 不是備份。
- `20261031130000_budget_business_conflicts_forward.sql`：終版 Forward 候選，**尚未安裝**；版本須在實際部署前再次確認無碰撞。不能移入自動 migration 流程後順便部署。
- `compiled-definitions.json`、`compiled-seal.json`：原生 PostgreSQL 實際編譯的 38 組 before／after 原文與 SHA-256；包括最後動態 Save Guard。fixture OID 不當成遠端 OID。
- `baseline-seal.json`：已套用 PT409 的 13 個舊基線函式 body Hash；封包產出時由相同不可變來源在隔離 DB 重建，本次 psql 部署前後亦已獨立核對全部相符。
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

## 已授權Dormant安裝的 gate 與通道限制

**目前停止：下列是安裝契約，不能據此重跑不相容原封包。** 下一版還必須驗證 Managed reserved-role 限制；此項已由真實 psql 失敗確認，未解即 NO-GO。

前次 SQL Editor 工具大小拒絕；本次完整 psql 執行在 reserved-role Grant 失敗並完整回滾，**沒有完成安裝**。沒有啟用／Worker／HTTP驗收。只有能安全承載完整原子封包的通道才可繼續；不能把下列程序改成逐檔部署。

1. 明確確認專案ref、維護時窗、執行角色；本輪指定Dormant schema＋ledger已有授權，範圍不含Activation／QA／Worker。將前端維持舊版且所有QA opt-in關閉，檢查在途請求／lease；仍使用封包保護鎖，不能把一次活動連線為零當成未來維護保證。
2. 重新唯讀讀取 Staging 的 47 筆 ledger、13 個基線 body、依賴 catalog／ACL／RLS／trigger／publication／role membership、Auth 使用者與 Storage 清單。檢查既有 31 筆無完整 source 的歷史記錄之必要依賴；原生 fixture 完整來源不證明遠端未知定義相同。**缺少這項對照時仍 NO-GO**。
3. **此純測試Staging由使用者明確取消備份／還原前置**；不建立備份／升級方案，也不將rowset Hash當作備份。使用者後續另自行重設Staging DB密碼，agent只接收本機遮罩登入輸入。本決策不授權清庫／重建／刪資料，不適用任何Production或其他環境。沒有備份／還原通過證據，歷史紀錄保留。
4. 逐項比對先前記錄的 **2 trips／1 user／25 itinerary items／3 alternatives／1 frozen Baseline／Storage objects 0** 與 13 表保護指紋。封包硬性綁定先前去敏預檢的指紋，任何 drift 都拒絕。不得為了安裝而改資料或盲目重封 Hash。必要時建立新版本封包並重驗。
5. 封包最前方鎖住 ledger、13 個 public 保護表、Auth.users、Storage.objects／buckets，`SHARE ROW EXCLUSIVE` 允許普通 SELECT，阻擋其他 writer；DDL 可能進一步要求強鎖。lock timeout 5s／statement timeout 60s，任一步失敗全交易 rollback。必須先確認 managed Auth／Storage owner 權限允許鎖表；本機 admin 通過不保證 Hosted 執行角色相同。需要安靜維護時窗，無權限時不降級移除保護鎖。
6. 在**同一資料庫Session**明確設定`app.b7_install_target='uyqdopksfysbobhjcepk'`後，以具ON_ERROR_STOP語意且能承載整個封包的SQL client一次執行。GUC不是伺服器身分證明，須另核對ref／role。**Dashboard已實測拒絕此完整封包；禁止再用SQL Editor或改成分段。** 若需新憑證、connector權限或其他擴權，另行提出方案；既有同範圍DDL授權不等於這些變更已授權。
   psql規則：Direct優先，IPv6不可用才用Session Pooler，禁止Transaction Pooler；以安全本機輸入及verify-full TLS驗證連線。保留原檔BEGIN／COMMIT，設定`ON_ERROR_STOP=1`，**不加`-1`**。無可用憑證就停止；unknown COMMIT先獨立唯讀判定，不盲目重送。本次已用單Session wrapper執行，遇reserved-role錯誤退出且完整回滾；記憶體helper已停止，沒有passfile。不得再依這個契約重試已知不相容原封包。
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
| Hosted dormant schema 安裝 | Failed／NO-GO；完整回滾已確認 | psql通道已可用；Managed reserved-role Grant不相容，禁止重跑原封包，先審查新方案；此Staging備份門檻已取消 |
| H01～H03 fixture／HTTP／Worker 能力驗證 | Blocked，未授權未實測 | 必須另授權 QA 保留、Storage、專用身分及排程範圍 |
| Protocol／QA frontend opt-in／完整 E2E | NO-GO | readiness 語意、真 legacy expiry 和前述證據未完成 |
| Production／main／Vercel | NO-GO | 本輪完全不在授權範圍 |

官方語意來源：[PostgREST 自訂 PT 狀態碼](https://docs.postgrest.org/en/stable/references/errors.html#raise-errors-with-http-status-codes)、[PostgreSQL 17 serialization／deadlock handling](https://www.postgresql.org/docs/17/mvcc-serialization-failure-handling.html)。保留 engine 40001／40P01，沒有用 PT409 取代真正交易重試。封包產出時changelog Markdown工具抓取失敗；本次已透過官方HTTPS取得index，並查閱17.11 breaking-change與Managed角色限制，但沒有升級DB或修改資料。這不構成新封包或Worker服務驗收通過。
