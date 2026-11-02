# Budget B-7：不同匯率驗收與 Staging 結案

日期：2026-11-02（Asia/Taipei）；以下 `Z`／`+00:00` 時間為 UTC。
分支 `codex/budget-collaboration-redesign`；起點 `ffa1dbf662ba3fb55f52c7a00b216130afd214a2`。
唯一環境：Travel-Planner-Staging（`uyqdopksfysbobhjcepk`）。

**結論：最後的 changed-quote P1 驗收門檻已關閉；B-7 Staging 核心產品功能／財務安全驗收 GO，帶已記錄 P2 限制結案，可以進入 Production 部署規劃。Production 部署／main 合併仍 NO-GO。**
這不表示每種 Storage 超限傳輸的 HTTP status、實體手機／OS IME、完整 WCAG／硬體讀屏等未驗證範圍都已通過。既有 standard／multipart 超限 HTTP 回應仍為 Blocked，未改標 Passed；它是先前矩陣已列的 P2 傳輸證據限制，不是本輪重新證明的平台能力。若要求所有 transport 子項零 Blocked，該較廣範圍仍不完整，不能使用本結案作為全面通過證書。

[本輪去敏矩陣](qa/2026-11-02-budget-b7-rates-closeout-results.json)；[前輪完整 E2E](2026-11-02-budget-b7-final-e2e-followup.md)及[Closeout Runbook](operations/budget-b7-closeout-runbook.md)。已通過且未受影響的 Auth／Storage／Worker、其他多人 E2E 與歷史單元測試沒有重跑。

## 真實報價與重新計價

- 使用產品原有 `https://open.er-api.com/v6/latest/TWD`，真 HTTP 200；未轉送旅程／會員資料。報價解析沿用產品 `parseBudgetQuote`，不攔截／替換匯率回應、不修改時鐘。原始完整 response 僅留 Git 忽略證據，公共文件不散布整份報價資料。
- 舊旅程 quote 為 **2026-11-01 00:02:31Z**，JPY **0.206945 TWD**；本輪外部 quote 為 **2026-11-02 00:02:31Z**，JPY **0.207133 TWD**。因此本次不是 no-op。供應商[官方 Open Access 文件](https://www.exchangerate-api.com/docs/free)記載每日更新與 attribution 要求，產品頁既有 attribution 保留。
- 13:41Z 前置檢查：Ledger65／Head20261101032853；28 原始投影、38 seals、Guard／Worker／Storage／Realtime 權限投影與前次讀回完全相同；七 OFF、三 readiness 保留、legacy exhausted、pending／cleanup0、有效租約0、無其他在途 transaction。
- 既有 Owner 與 Editor 建立兩個真正、不同 Auth Session；管理 key 只用隔離 QA 的登入初始化，沒有新增帳號／旅程。所有業務 RPC／清理使用普通 JWT。兩個 **headed Chrome、獨立 incognito contexts、1440×1000** 載入真 Staging；Browser plugin 未提供，沿用已授權的 Playwright 原生 Chrome，無 Browser Auth token 擷取。
- Resume 後，先由正常 UI 建立**一筆**唯一標記、未付款 JPY Budget：title／payer／兩位 participants／總額均分完整。JPY100000 在舊價完成，再由 A 真 Pricing 編輯為100001，沒有建立付款或偽造歷史。
- A 持有 Pricing 時，B 的真 changed-quote Rates admission 被 `pricing_locked` 拒絕；A Pricing 提交後，B 舊 versions 得 **HTTP409／PT409**。新版本 B Rates lease 只鎖該未付款項目，排除所有 retained Budget；A 反向 Pricing admission 被 `group_locked` 拒絕。
- B 普通 JWT 正常提交 quote，Rates revision 恰好增加1；JPY100001 由 **20695 → 20714 TWD**，兩人各 **10357**。Participants 原始關聯逐欄不變，整數分攤總和精確等於20714。相同原 Request ID／原 body replay 回傳相同 receipt，沒有第二次重計價。
- B 釋放 Rates 後，A 原先 Pricing versions 得 **409／PT409**。兩個獨立真 Snapshot 及兩個真畫面列表不用 reload 即收斂；明細實際顯示兩人10357，統計實際顯示全旅程21322／JPY0.207133。
- 四筆既有 Actual、其 Participant rows、Payment History、Source Origin／關聯、所有 retained Budget 的完整欄位，於拒絕／提交／replay／清理之後均與事前值完全相同。不是只比較筆數或付款總額。

## Baseline P2 判定與資料保留

唯讀讀取 Hosted 的 `refresh_budget_baseline`／`budget_baseline_changed` 及六個 deferred triggers，對照不可變來源：未出發、未 settled 的規劃 graph 變更會刷新行前 Baseline；已到 departure 的 Baseline 不得覆寫。Budget 頁在 rates 缺漏時正常初始化，會更新 trip，因而刷新 planning Baseline；不是每次切頁都無條件寫入。

本輪在任何 Browser 開啟前，先完整封存**主 QA 與另一舊 QA 旅程**的 Rates／Baseline。兩個 Browser 單純載入已有匯率的主旅程後，兩份 Baseline 逐欄相同。新增／計價／真正匯率更新／正常刪除本次未付款 Budget 之後，主 planning Baseline 正常反映目前四筆完整項目；另一旅程的 Rates／Baseline 仍完整相同。原始28投影內的歷史 Baseline 未變。

因此前輪「缺少 rates 的未出發 QA 旅程，首次瀏覽觸發初始化後刷新 planning Baseline」符合現有設計，**沒有確認新的非預期產品寫入**。前輪缺 raw before Hash 的證據限制仍保留為已知 P2，不回填 Hash、不還原未知原值，也不把前輪 raw equality 失敗改為 Passed。本輪新封存／新讀回是獨立通過範圍。

本次唯一新增未付款 Budget 已由普通 Owner UI／正常 Lifecycle 刪除。主 graph 最後恢復4 Budgets／4 Actual；付款、Baseline、audit／request lineage 依既有 Guard 保留；旅程匯率保留本次合法新 quote，不倒轉至舊 quote。沒有強制 SQL 清除、Auth Admin Cascade 或任何歷史財務回滾。

## 失敗、修正與安全操作

額外 UI 明細補驗第一次 `assert(start>=0)` **Failed**，立即 Pause（13:50:43Z 獨立七 OFF）。根因是 Runner 再點已選中的項目，依產品 `select()` 正常取消選取；不是重新計價錯誤。只修改 QA 操作：檢查 selected row，再等待真正明細可見，保留原完整金額／分攤斷言及失敗證據。原始資料／38 seals／租約0再次核對後，受控 Resume；僅補明細／統計及正常清理，**沒有重送 quote mutation／重跑核心競爭**。13:53:12Z 兩端明細／統計通過。

原生 CIM 曾能看到新助手 PID，但該完整性層級的 `CommandLine` 不可讀；原盤點會將它漏掉。本輪最小 QA 修正：不可辨識的 Node／Chrome 必須使退出判定 Blocked，不能當成零程序，不停止未知程序。最後新盤點確實沒有不可辨識程序、已知助手 PID 也不存在。新增 Runner 無產品功能／CSS／Migration 修改。

## 最終獨立讀回與結案界線

- **13:54:55.766397Z**：Ledger65／Head20261101032853，七 OFF、Undo full OFF；Finance／Receipt／Lifecycle latches TRUE，三既有 readiness 保留，legacy natural expiry NULL／exhausted TRUE。pending Receipt0／active cleanup0／multipart0／missingReceiptObjects0。
- **13:55:11.906376Z**：原28投影／38函式／Guard body與屬性／Worker role與grant／Storage policy與bucket／既有Realtime／RLS與ACL投影均不變。未重播 Migration，沒有 Source Hash／Ledger／RLS／Grant／Publication 修改。
- 普通 JWT global logout 兩次204；真正 refresh token 重送均400拒絕。**13:55:33.938153Z** 新唯讀交易：QA Auth sessions0／有效 refresh tokens0／三類有效租約0／無其他在途 transaction。Access JWT 的自然密碼學 expiry 不冒稱立即失效。
- **13:55:25Z** 後新原生 Windows CIM／TCP：助手、QA Chrome／descendants、Vite／5188／5189 均退出、不可辨識 Node／Chrome0；不是由 status.json 推定。RAM operator stopped／憑證釋放；未啟動 Worker 或排程。QA 前端旗標僅在已退出子程序 ON，repository defaults OFF。
- 未改 Schema／權限，沒有重跑未受影響的 Managed Advisor；沿用前輪實際0 Errors／10 Warnings／24 Info，不稱本輪已 rerun。既有 bundle warning 與實體裝置／完整 accessibility 限制保留。Build 沿用未受影響產品版本的前次通過結果，本輪只做新增 QA JS syntax／PowerShell AST／JSON／Hash／連結／敏感內容／diff 檢查。

P0／P1：本輪沒有新確認未解產品缺陷；最後 changed-quote P1 gate 已 Passed。P2：正常 planning Baseline refresh／舊 raw Hash 缺口、既有 standard／multipart 超限 HTTP status Blocked、既有 bundle／Advisor warnings；不把這些未完成證據改成 Passed。BUG-031／032／033 的既有驗證沿用。

**下一步僅為 Production 規劃／Review。** 需要另外授權正式環境唯讀 baseline／catalog／權限與實際版本差異、備份還原決策、target-bound 最小原子封包、相容前端／專用 Worker／legacy cutover／安全 Activation 發布順序。Staging65不能直接作為 Production預期；失敗採 Pause／獨立判定未知 COMMIT／經審查的 Forward Repair，不做破壞性 rollback。未操作 Production、main、Vercel、Docker／WSL。
