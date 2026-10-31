# Issue #15 B-7 Forward／Staging 封包驗證交接

2026-10-31，從 `5c9e8ea07ddb9f95e748d9b2836f28e8c3790bb8`，分支 `codex/budget-collaboration-redesign`。本輪只有 source／測試／文件、原生 PostgreSQL 隔離驗證與本機受控瀏覽器；**沒有 Hosted 存取、部署、Protocol／旗標啟用、Docker／WSL 操作**。停止等待 ChatGPT Review。

## 決策與封包

**GO：本輪 Forward／controller 修正及封包供 Review。NO-GO：Staging 安裝、Activation、H01～H03 與正式上線。**

[完整封包與 Runbook](operations/budget-b7-staging/README.md)在非自動套用目錄；含完整 SQL、來源 manifest、逐點分類、實際 compiled before／after 原文與 Hash。單一外層交易安裝 T0＋13個B-7＋F0，並精確登記來源 ledger、核對原始資料、保持 default-off。既有61個 migration 原文完全未改，包括已套用 PT409 hotfix。

封包 SHA-256：`4d43bddf6ed7853daa3008c51b58d76b868553330b919f885d82a200f546698b`，1,488,439 bytes（UTF-8／LF），重複生成一致。15檔順序及每檔 Hash 見 [manifest](operations/budget-b7-staging/packet-manifest.json)。候選 F0 版本 `20261031130000` 未安裝，實際部署前須再確認版本無碰撞。sourceCommit 記錄本輪起點，交付 commit 以 Git 為準。

## P0：實際編譯與語意分類

Staging 歷史：47個舊ledger（含hotfix，缺T0／B-7）→T0→13個B-7→F0。實際編譯確認 **38個終版函式／78個自訂40001 RAISE**，含最後動態 legacy Save Guard。Fresh 歷史：全部61個原檔按時間排序→F0；舊hotfix在B-7之後正常執行一次，先轉換Save的3點，因此F0前是37個仍含40001函式／75點，完整被審閱集合仍是38／78。F0接受精確before或after body Hash，不重播舊hotfix、不還原新Guard。

- **54 PT409**：admission／prepare／top-of-stack 的版本、依賴、intent、stale／missing／tombstoned resource、legacy Save、Undo stale FX拒絕。保留message與所有權限／版本檢查，不自動重送。admission的missing group/state拒絕無法授予的資源圖，保留draft並要求權威reload，不自動補造group；reload持續缺失仍須調查初始化／資料問題，409不是自動修復。
- **24 PT500**：server-owned effect finalization、commit/deferred assertion、inverse bundle／before-image／lineage完整性、readiness前未完成effect。不能包裝成普通版本衝突。`finish_workspace_inverse` 的 `Inverse target changed` 位於prepare之後的finalizer，屬PT500；`workspace_undo_top` 的使用者前置競爭仍屬PT409。`workspace_inverse_manifest` missing prior為PT500，stale rate為PT409。每個message、來源、分類與理由見 [78點清單](operations/budget-b7-staging/error-classification.json)。
- 真engine `40001`／`40P01`、EXCEPTION handlers與不送PostgREST的本機合成錯誤未改。真雙連線分別產生原碼，失敗交易rollback，deadlock survivor commit。

[完整compiled原文](operations/budget-b7-staging/compiled-definitions.json)與 [seal](operations/budget-b7-staging/compiled-seal.json)封存38組before／after。F0只換經核准SQLSTATE literal，其餘body不變；全部`pg_proc`非prosrc屬性相同，包括OID、Owner、ACL、SECURITY、search_path與參數。F0前後RLS／trigger／schema ACL／roles／membership／ledger／資料不變。

missing signature、Hash／形狀／點數drift皆fail-closed。未知custom40001的最後掃描若失敗，整筆交易rollback，包含先前CREATE OR REPLACE；不宣稱所有未知routine都在第一個rewrite前發現。F0重跑為after-hash no-op；整個安裝封包刻意拒絕重跑。

## P1：Controller

已套用draft patch至`budgetMetadataService.js`、`budgetPaymentGroups.js`，另加入PT500 confirmed refusal，避免內部拒絕被誤判unknown ACK。已知失敗保留使用者draft／錯誤及恢復入口，清除已確定未提交的generic request；tick／refresh不自動重送財務寫入。PT409及legacy40001設conflict，PT500不偽稱版本衝突。

Receipt原`retainRequestOnError`完整保留：PT409／PT500仍保留原request ID／原檔，只在明確retry後沿既有pipeline恢復。Transport timeout、lost ACK、Snapshot遲到、lease失效繼續使用既有恢復機制，不以新ID盲目重送。這些回歸使用受控服務，真PostgREST解碼仍待H01／H02。

## 本輪驗收矩陣

| 項目 | 結果 | 範圍 |
| --- | --- | --- |
| Staging out-of-order封包 | Passed 19/19 | PostgreSQL17.11；fault rollback、真並行writer fence、ledger47→62 |
| Fresh chronological | Passed 14/14 | 全部原始檔順序、舊hotfix一次、terminal F0 |
| 38函式／78點、54／24分類 | Passed | compiled body＋Hash；78 RAISE probes只驗碼／message，**不是78個實際業務分支全觸發** |
| attrs／Data／RLS／grants | Passed（原生fixture） | 全pg_proc非body屬性、schema ACL／membership／triggers／RLS；private表RLS與無client／worker raw DML、Worker NOLOGIN／NOINHERIT／NOBYPASSRLS |
| 原子交易／未知routine／drift／冪等 | Passed | 首個rewrite後除零注入，schema／roles／ledger／原資料全回復；peer writer被55P03拒絕直到rollback釋鎖 |
| 財務保全 | Passed（原生fixture） | 所有原始欄位投影；JPY歷史777／payment history／participants／receipt metadata／Source Origin／frozen Baseline未重計價或刪除 |
| Preflight／Readback／dormant Pause | Passed（原生fixture） | 執行三份既有操作SQL；七組protocol／latch全程false；**沒有Activation演練** |
| Controller直接相依回歸 | Passed 16/16 | 8新增PT409／PT500 admission／commit／Receipt＋8相依ACK／timeout／replay／stale／retained pricing；受控服務fixture |
| Rendered Browser | Passed 3/3 | 真Chromium／本機Vite、受控Auth／RPC；autosave draft保留，Payment拒絕後明確新operation只提交一次 |
| Build／Syntax／diff | Passed | production build及必要JS檢查；既有>500kB bundle advisory |
| Managed catalog／Security Advisor | Blocked | 本輪無Hosted存取；原生權限檢查不認證managed defaults |
| Staging安裝／備份還原 | Blocked | 未授權未執行；31筆老ledger無完整來源仍須必要相依核對 |
| H01 Auth／PostgREST／Realtime雙帳號 | Blocked | 舊hotfix20案不代表B-7；本輪沒有新的真服務驗收 |
| H02 Storage HTTP／H03 Worker排程 | Blocked | 真JWT／headers／adapter／兩輪排程及故障恢復、legacy grant expiry待完成 |
| Activation／正式上線 | NO-GO | 真readiness與完整E2E未完成，不能用fixture digest啟用 |

Auth.uid、Storage tables／roles／publication是fixture，不是真GoTrue／PostgREST／Realtime／Storage HTTP。合成兩旅程／一使用者／25items／3alternatives／frozen Baseline，再加歷史financial graph，比真Staging的空finance基線更豐富；沒有個人資料。原生測試使用相同封包生成器，只注入合成rowset manifest；**交付綁定舊Staging觀測指紋的封包沒有連接Hosted執行**。本機17.11不證明Hosted17.6.1.155的managed ownership／RLS defaults。

選錄去敏證據：[JSON](qa/2026-10-31-budget-b7-forward-validation-results.json)。完整clusters／traces／logs在ignored本機evidence，cluster均已停止。Browser skill未列出，依frontend-testing-debugging使用既有Playwright workflow；route/module interception確保沒有Hosted呼叫。三張screenshot已視覺檢視：draft保留、Payment retry後列表／右欄已付款一致，無error overlay／fixture console error；不是手機／IME／Accessibility全測。測試server已停止。

## 失敗調查與剩餘風險

早期partial-failure fixture將SQL body當JS replacement string，body內`$'`導致suffix展開、syntax error；改callback保留原文，未放寬assertion。sandbox initdb WAL rename／Chromium路徑／loopback與Vite已停止等環境失敗，改用授權normal-user loopback Runner／重啟專用Vite後通過，未提高Timeout。一次自動核准服務用量不足導致未執行，使用者繼續後重新送審成功；以上不計入產品通過數。

本輪無新增未解本機P0／P1。仍阻擋Hosted的 **P0 gate**：新鮮catalog／31歷史來源未知相依、managed權限與備份還原、readiness／首次Activation證據範圍及真服務驗收。**P1 gate**：專用Worker Staging adapter／JWT／supervisor、實際legacy grant expiry。未做workaround。P2既有bundle advisory不阻擋本輪Review，不代表效能驗收已過。

下一步先ChatGPT Review。之後仍須分別授權：新鮮唯讀Hosted對照／備份還原、Staging dormant schema＋ledger、QA帳號／fixtures與Guard阻擋保留、Storage HTTP、專用Worker JWT／排程與能力驗證，最後才是scoped Activation／Pause及完整E2E。Production／main／Vercel另授權。

依 [Runbook](operations/budget-b7-staging/README.md)分開preactivation-capability與postactivation-e2e digest，不偽填readiness；activation循環依賴未解就維持BLOCKED。QA trip／Auth user／Baseline／audit／intent無法正常清除時列待授權保留，不強制cascade／刪歷史。已提交財務操作只允許Forward Repair，不使用破壞性回滾。

官方語意：[PostgREST PT errors](https://docs.postgrest.org/en/stable/references/errors.html#raise-errors-with-http-status-codes)、[PostgreSQL17交易重試](https://www.postgresql.org/docs/17/mvcc-serialization-failure-handling.html)。先前 [預檢](2026-10-31-budget-b7-staging-preflight.md)、[靜態稽核](2026-10-31-budget-b7-40001-audit.md)保留歷史證據，本交接取代「未套用controller／未編譯Forward」狀態。
