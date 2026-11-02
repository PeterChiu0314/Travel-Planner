# Budget B-7：最終 E2E 補驗與安全收尾

> 後續2026-11-02：[真實不同匯率與 Staging 結案](2026-11-02-budget-b7-rates-staging-closeout.md)已補通本文件剩餘 changed-quote P1 門檻。Staging核心功能GO帶P2限制；Production仍NO-GO。以下是前一輪不可改寫的歷史結果，其no-op／原失敗／未知raw Baseline Hash不被追認為通過。

日期：2026-11-02（Asia/Taipei）。本文件時間戳若以 `Z` 結尾即為 UTC。
分支 `codex/budget-collaboration-redesign`；起點 `0b51499b9960a936a390918b6b6f1ab152c14e24`。
唯一 Hosted 目標為 Travel-Planner-Staging，`uyqdopksfysbobhjcepk`。

**結論：可交付本輪程式與證據 Review；Staging 完整驗收及 Production 仍為 NO-GO。**
剩餘主要門檻是真實「不同新報價」引起的重新計價競爭；本輪取得的真實報價與現值相同，不能把 no-op 當作此項通過。
已完成的 Auth／Storage／Worker 平台 suite、租約到期、五步 Undo、Payment ACK 等未受影響歷史案例沒有重跑。
前次完整範圍見[既有驗收](2026-11-01-budget-b7-legacy-cutover-and-e2e.md)，本輪去敏證據見[結果矩陣](qa/2026-11-02-budget-b7-final-e2e-results.json)。

## 最終獨立讀回

- Ledger 仍為 **65**，Head `20261101032853`。未安裝／重播任何 Migration，未修改 Source Hash、RLS、Grants、Publication 或不可逆 Latch。
- `2026-11-01T16:38:22.687927Z`：七組 Protocol OFF，Undo full OFF；Finance／Receipt／Lifecycle activated 保持 TRUE，三個既有 Receipt readiness 保留。legacy expiry 仍 NULL、exhausted TRUE。
- `16:39:46.636099Z`：原始 **28 組資料投影、38 個函式 seal**、Guard 屬性及既有 Worker／Storage／Realtime 權限投影與起點一致。
- 普通 QA JWT global logout 成功，實際 refresh token 重送遭拒；`16:38:47.930715Z` 新唯讀讀回：QA Auth sessions **0**、有效 refresh tokens **0**。不宣稱 access JWT 在密碼學上立即失效。
- 最後額外唯讀摘要：pending Receipt **0**、active cleanup **0**、本次業務 Receipt metadata／Storage objects **0／0**、Participant 孤兒 **0**、有效編輯租約 **0**。
- 原生 Windows CIM／TCP 於 `16:40:22Z` 後確認：QA 助手、QA Chrome、Vite 與 5188／5189 listeners 均已退出；不是以舊 status.json 推定。RAM operator 已 stopped，未保存或輸出憑證。
- Managed Security Advisor 實際 **Rerun linter** 完成：**0 Errors／10 Warnings／24 Info**，數量與前次相同。沒有為消除既有警告而放寬權限或修改設定；本輪不是所有既有警告的消除驗收。
- 前端五個協作旗標只在一次性 QA Vite 子程序開啟；該程序已停止，repository defaults 仍 OFF。沒有前端部署、Worker 常駐排程或 Production 操作。

## 本輪功能矩陣

| 項目 | 結果 | 實際證據／界線 |
| --- | --- | --- |
| 舊原生程序安全恢復 | Passed | 使用者初始原生盤點，及最後獨立原生 CIM／TCP 盤點 |
| 原 Owner 恢復 QA B | Passed | 真實 Owner JWT，pending→approved；owner／editor 角色不變，普通 peer RLS 可讀 |
| 恢復前後 QA graph 原始位元完全相同 | Failed | 行前 QA Baseline 的 captured_at／approved members 隨既有 trigger 刷新；此原斷言未標通過 |
| 有限 Snapshot gate | Passed | 5 個新增 Runner 單元測試、真 Chrome＋真 loopback HTTP；不冒充 Hosted 驗收 |
| 真正背景／前景草稿恢復 | Passed | 原生無 focus override 的 incognito Chrome：visible→hidden→visible；隱藏時不儲存草稿、peer Note 成功、前景重新核權後儲存 |
| 撤權後普通 JWT／UI 隔離 | Passed | Owner 撤權，peer REST 拒絕、重新整理無該 Budget；finally 正常恢復 approved |
| 撤權＋真正晚到 Snapshot | Passed | 先取得真回應，撤權及獨立 RLS 拒絕後才原樣送達；UI 顯示讀取拒絕、沒有舊 Budget；會員恢復後才記通過 |
| 切旅程＋晚到 Snapshot | Passed | 另一旅程在 release 前已顯示；真舊回應送達後不回灌；目的旅程操作收斂後正常切回 |
| 登出＋晚到 Snapshot | Passed | 真 UI 登出，舊回應送達後保持登入入口、不回灌 |
| 再登入／重新整理 | Passed | 真 Auth verification 的新普通 Session；受控 QA bootstrap 後 UI 重新整理維持正確旅程，不宣稱 Google OAuth 人工登入驗收 |
| 外幣付款／Pricing 與匯率版本競爭 | Passed | 新合法 JPY Budget 由 UI 計價付款；另一人舊 rates versions 收到 HTTP409／PT409；fresh no-op lease 正常釋放 |
| 不同真實新報價的重新計價競爭 | **Blocked** | 真報價未變，SQL plan 為 no-op／空 targets；沒有偽造 quote 或用「成功未變」代替 changed-rate 驗收 |
| Receipt 雙帳號並發替換 | Passed | 兩人同時真正選檔；一方等待驗證、一方拒絕；驗證提交前舊關聯保留，之後只剩一筆新關聯且 Object ID 不同 |
| 舊 cleanup claim 與新 Object 保護 | Passed | COMMIT 後限定 QA Browser 斷網；專用 Worker 取得真舊 Object claim，不能刪新關聯檔、能正常刪舊檔；新 bytes／SHA-256 不變 |
| Receipt 斷線恢復／清理 | Passed | 真回應照常送達、正常連線重試無重複關聯；最後經普通 UI 刪除本次 Receipt，metadata／objects／工作佇列歸零 |
| IME／Portal／基本鍵盤 | Passed（步驟） | 原生 CDP IME composition 未提前儲存，commit 才儲存；Portal、Escape 焦點及 Tab 斷言完成；原組合執行在後續窄視窗斷言失敗，未將整組失敗標為通過 |
| 820／390px Budget 可用性 | Passed | 修正後僅補響應式部分：document width 符合 viewport，新增按鈕在視窗內，實際 screenshot 檢查；不宣稱實體手機、OS IME 或完整 WCAG 驗收 |

## 修正與失敗經過

產品只修改 `src/components/budget/budget-page.css` 的窄視窗規則：Budget grid wrapper 的 `min-width:0`，篩選列允許換行。390px document 原為 556px，修正後為 390px；820px 仍為 820px。表格保留自身橫向捲動 CSS，未聲稱另驗證手機實際 pan 手勢。記為 BUG-033／P2，已針對性讀回與畫面驗證。

QA 修正包含：

- 舊 `await reload(domcontentloaded)` 與 held route 相互等待的分支移除。新 gate 先等 navigation commit，真 response 有固定 fetch／hold／delivery deadline；finally 先取消或釋放 handler，才 unroute。使用真回應，不製造 Snapshot。
- 加入逐步證據、原生程序 PID 身分核對、退出途中已自行消失 PID 的處理。CDP browser 先送真正 `Browser.close`，避免只 disconnect。新增自動期限 logout hook，但**沒有另外等待完整三小時重測此 hook**；實際結案依普通 JWT logout、獨立 Auth 讀回及原生退出證據。
- Auth seed 僅對每個 context 初始化一次，避免 reload 偷偷登入已登出的帳號；既有 trip context 不再每次 reload 重設。
- Vite 曾因監看新 Chrome profile 的鎖定 Cookies 觸發 EBUSY。QA 專用 server 排除 `.tmp-*`，不變更正式 Vite 設定。
- 保留錯誤預期的失敗：目的旅程匯率尚在操作時要求離開、在 Budget 頁等別頁的「等待核准」標籤、把相同報價 no-op 當作必須 Pricing 拒絕、等待 CSS 隱藏 file input 可見、使用錯誤 scope 的 label locator。修正依已觀察 DOM／SQL 契約，沒有提高 Timeout 或刪掉核心拒絕／首次回應斷言。
- 首次 cleanup 網路故障注入沒有生效，正常清理已完成；未重送已 COMMIT 的替換。先獨立讀回 queues0，再以**新的一次合法 QA 替換**測 COMMIT 後斷網與真 Worker 恢復。不是把未注入的故障標通過。
- 一次 Pause 路徑誤選舊停止簽發 request replay，回傳原 recorded_at，沒有新增 cutover 事件；隨即執行正確 Pause 並獨立確認七 OFF。該 replay 沒有被當作 Pause 證據。
- 等待使用者回覆期間，第一個 RAM operator 到期後 DB Protocol 仍 ON；重新接回後立即手動 Pause，再以新 Session 繼續。**RAM timer 只終止本機資源，不是 DB 自動 Pause**。未新增排程／管理憑證來假稱解決此界線；下次須在期限前完成 Pause，無法確保有人執行時不得 Resume。

## 資料保留與限制

本次共新增兩個合法外幣 QA Budget 及一個對應付款 Actual；無付款依賴的 contender 已走普通 Lifecycle UI 刪除。保留的主 QA graph 最後為 1 Trip／4 Budgets／4 Actuals／1 itinerary／1 planning Baseline。新增已付款外幣 graph 含付款歷史與稽核關聯，保留，不以 Auth Admin Cascade 或 SQL 清除。三筆原 QA Actual 與外幣測試前完整內容一致；四筆 Actual 與新增外幣付款後的保護讀回一致，含 Source Origin／Payment History。

原始 2 Trips／1 User／25 Items／3 Alternatives／1 歷史 Baseline 的既有投影未變。既有 legacy 控制收據及 S3 控制物件不是本次 cleanup 目標。

**另有一項 QA 隔離限制：** 切換至舊 preactivation QA 旅程時，既有產品自動初始化其旅程匯率，正常刷新了其 **2099 年行前** Baseline（captured_at `15:55:31.017155Z`）。該 Baseline 沒有被刪除，但缺少它的事前完整 raw Hash，不能宣稱整筆不變，也不嘗試無來源還原。這不是原始受保護歷史 Baseline。下一次切換旅程測試必須先確認目的 QA 旅程已有完整 rates，並封存其 Baseline 前後指紋，或使用全新可保留 graph；不能再把「唯讀瀏覽 UI」假設為零衍生寫入。此項交 Review，記 P2 證據／fixture 隔離限制。

Receipt 證據涵蓋正常唯一 path／Object ID 替換，以及舊合法 cleanup claim 對新關聯檔案的拒絕；**沒有製造相同 path 被換成另一 Object ID 的 SQL fixture**，不宣稱該種人為場景已做 Hosted 測試。所有測試檔案、QA 身分細節、原始讀回及 screenshot 留在 Git 忽略目錄，公共 JSON 僅存去敏摘要與檔案 digest。

## 本輪檢查與下一步

- 新增 Runner 單元測試 **5／5**；原生 Chrome／loopback 有限 gate 驗證通過，與真 Staging 結果分列。
- Production Build 通過，既有 bundle size warning 保留。執行修改檔案 Syntax／PowerShell AST／JSON／文件連結／敏感內容／diff 檢查；完整結果記錄於結果 JSON。沒有重新執行 B-1～B-7 歷史全套。
- 新增產品 P0／P1 缺陷：未確認有未解項；BUG-031／032 既有通過證據沿用。本輪 P2 溢出已修；仍保留 Baseline fixture 限制、既有大 bundle、10 個既有 Advisor warnings 與先前 standard／multipart 超限 transport 的 Blocked。
- **上線驗收門檻仍未關閉：** 真實 changed-rate repricing E2E 尚未取得必要不同報價。不能偽造市場報價／readiness，也不能為測試改原歷史資料。應先 Review 其最小合法測試方式，再只補此相依範圍；已過案例不重跑。
- 保持 Staging Pause。Production／main／Vercel 完全未操作，精確 Production 封包仍須依另外授權的即時 ledger／catalog／備份決策產生；不能把 Staging 的 65 筆直接當正式預期。沿用[Closeout Runbook](operations/budget-b7-closeout-runbook.md)的 forward-only、未知 COMMIT 先讀回、禁止破壞性 rollback 原則。
