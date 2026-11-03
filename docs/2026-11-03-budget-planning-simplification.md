# 行前預算精簡｜待 Review，未部署

**已由 [完全移除自訂 Undo](2026-11-03-budget-custom-undo-removal.md) 取代 Undo 部分。** 以下是 `4266736` 的歷史驗證紀錄；30 秒設計取消，未部署的 `20261103084209` 已從待套用鏈移除，由新 Forward `20261103113253` 承接收據移除／單筆實付限制及永久停用 Undo。不得執行本文舊 Forward 或將舊測試視為目前產品驗收。

2026-11-03；分支 `codex/budget-collaboration-redesign`，起點 `c181b99`。本輪僅本機實作，未操作 Production、Hosted Storage、正式旗標、main、Vercel、Docker／WSL；部署狀態沿用 CURRENT_TASK 既有證據，未新查遠端。

## 修改與依賴

- Formal／Demo 預算不再建立 Receipt Controller、狀態、Guard、上傳緩衝及附件 renderer；移除舊 Receipt lease 刪除 callback。財務附件 callback 固定停用，舊 flags 不能重新啟用，其他附件不變。Demo 僅保留唯讀 Snapshot 相容投影，沒有 Receipt transport。
- Undo 改為單步、**30 秒**，連按合併一次；沒有按鈕、歷史、倒數、成功／失敗訊息或 Toast。輸入、搜尋、選單、Modal、IME及編輯面板保留本地行為。一般存檔／同步錯誤仍正常回饋。未知 ACK 保留同 Request 恢復，不誤執行下一筆。
- 移除舊分筆付款編輯列表，以人工評估阻擋取代；保留一筆付款 toggle、獨立實付入口及既有名稱／分類／付款人／備註／分攤／匯率／行程關聯與協作回饋。

官方 CLI 產生新 Forward `20261103084209_budget_planning_simplification.sql`，**未安裝 Hosted**。本機 generator 從不可變 B6 Source 產出完整定義，無自動執行資料庫步驟：

- operations 新增 saved_at，舊操作視為過期；清除暫時 pointers，不刪 audit／財務紀錄。新 pointer 只保留一筆，同 actor／trip／document session，在既有群組版本、租約、相依檢查內驗證 30 秒期限。舊 metadata Undo mutation 的 client EXECUTE 撤銷，避免繞過期限。Pricing仍以同一原子 bundle 復原金額與 Participants。
- unique partial index 限制非 NULL `actual_expenses.budget_item_id`，重複資料會使整個 Forward 失敗，不刪除或合併。NULL 繼續允許獨立旅途支出；`budget_origin_id` 是歷史 Source，保留原意，不改寫為目前關聯。
- metadata DML trigger、metadata SELECT 限縮及 Storage restrictive ALL policy 永久拒絕財務收據路徑，不依賴 Receipt protocol/readiness/Worker。撤銷公開 Receipt mutation/read/abandon/claim/finish/sweep 的 client EXECUTE。其他附件授權不放寬，不新增 protocol/profile 或重設 latch。
- 新 Forward 取代先前未安裝的 deferred-Receipt 草案用途；不得自動堆疊或重播舊草案。已套用來源不變。

舊 Receipt Controller／Storage adapter／Demo 模擬檔仍由歷史測試直接 import，但已不在現行 App 執行依賴內。舊 Wire validator、七個 protocol 表、private ledger、函式及 audit 因既有 Snapshot／歷史相依保留。Source／Origin、付款歷史、Baseline、旅途中實付／結算結構不刪，沒有 schema drop 或清理財務資料。

## 本機驗證

- 隔離 PostgreSQL17.11 **12/12**：財務 Receipt metadata／Storage RLS拒絕及其他附件 CRUD、Worker client ACL、第二筆實付拒絕／獨立實付允許、單步與重複 Undo、同組衝突／不同組並行、跨 session、custom 金額／分攤原子復原、實際等待 30 秒到期。runner `--planning` 僅接受新 loopback＋marker，測後停止。不是 Hosted Auth／Storage HTTP 證據。
- Playwright **49 distinct**：Controller Undo6＋Finance3、收據移除 UI2、單步靜默／真到期 UI2、Formal Undo／Demo6、既有必要 Shell／Timeline／Luggage／Share smoke30。未全面重跑歷史 Receipt／B1～B7 suite。Browser plugin 未提供，因此使用本機 Playwright。
- Build 通過，保留既有 bundle size warning；diff check 通過。詳細範圍見[矩陣](qa/2026-11-03-budget-planning-simplification-results.json)。

初輪 sandbox 的 pg_ctl restricted token及瀏覽器 ERR_NETWORK_ACCESS_DENIED，改在核准的原生環境重驗。30秒產品期限測試需45秒 runner deadline。移除 Demo Receipt transport 一度缺少 attachments read投影，補回唯讀相容投影後新增／Undo通過。Pricing測試先使用錯誤 envelope 被22023拒絕，改用真實協定 envelope，未放寬DB檢查。所有失敗保留本機log，不冒充Passed。

**既有限制**：首次初始化 Pricing 後，Undo到「無參與者」值會由 calculator `Participants required`安全拒絕，沒有部分回復；UI靜默。有效 custom 設定的金額與分攤原子復原另測通過。不宣稱所有首次初始化都可 inverse。

## Review 與啟用前條件

本輪可交程式 Review，正式啟用仍 NO-GO。需另授權 live ledger/catalog／duplicate／Receipt objects＋jobs inventory及原始指紋，先做 Staging Forward 演練與交易失敗原子性、真雙帳號／多分頁 Pricing/Rates/Undo/Realtime和財務 Receipt HTTP拒絕／其他附件HTTP回歸。有重複實付或既有收據／jobs即阻擋，先制定保全方案。

舊 Signed URL及外部管理發證能力不能只靠新policy宣稱已失效；必須核對實際TTL／撤銷與通道，不自動輪替key或刪物件。新 Forward 仍需依 live catalog檢查private／security-definer權限、既有相依及並發寫入。六個非Receipt協定沿用安全啟用邊界，本輪未開flag；本地fixture enable不是正式發布程序。正式資料處置、備份及部署需另案決策與授權。
