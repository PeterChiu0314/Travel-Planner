# 回家接續 Staging 驗收

**最新接續checkpoint：2026-11-04 19:25已依額度門檻停止。** 五小時used93%／remaining7%；未重跑C05、未登入或啟用。還原工具拒絕本機舊qa-scope衝突並保留原檔。恢復前先核對／備存衝突檔，禁止直接覆蓋或再prepare另一批scope。[完整停止紀錄](2026-11-04-budget-staging-resume-stop.md)。

分支：`codex/budget-collaboration-redesign`。先讀 `AGENT.md`、`CURRENT_TASK.md`、[最新驗收紀錄](2026-11-04-budget-staging-acceptance.md) 與 [矩陣](qa/2026-11-04-budget-staging-acceptance-results.json)。目前22 Passed /1 Failed /11 Blocked；尚未準備好完整手測或正式啟用。本輪只到正式部署前，不操作 Production、main、Vercel、Docker／WSL。

## 在家裡電腦準備

在既有 checkout 先確認沒有未提交修改，切換原分支，再拉取：

```powershell
git status --short
git switch codex/budget-collaboration-redesign
git pull --ff-only origin codex/budget-collaboration-redesign
npm.cmd ci
node scripts/qa/restore-staging-acceptance-handoff.mjs
```

還原工具只建立被 Git 忽略的非機密 QA 範圍、既有資料圖、前次報告、最後 OFF 指紋及 `home-preflight.sql`；不連線、不開協定、不建立資料、不還原 session/key/執行許可，也不把歷史指紋當作新的 before。若已有不同範圍檔案會拒絕覆蓋，先保留並核對。不要重新執行 prepare-scope 建立另一批資料。

接著在一般 PowerShell 執行（相對路徑適用家裡 checkout）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File ".\scripts\qa\start-staging-acceptance.ps1"
```

使用同一個 Staging 的 publishable／anon 與既有 legacy service_role key，在遮蔽視窗填入；不要貼到聊天、提交 Git 或複製本機原始日誌。公開 key 可由原本安全管道重建 `.env.staging.local`；管理 key 僅留助手記憶體。此助手只先驗證兩名既有 QA 身分，並不啟用協定。換電腦與程序結束後都要重新連線。無需 JWT signing secret、Receipt Worker 或新的權限。

## 交給下一位助手的接續順序

1. 僅對 `uyqdopksfysbobhjcepk` 執行產生的 `home-preflight.sql`（READ ONLY），取得新的獨立捕捉；與 `last-handoff-off.json` 比較 ledger66/head20261103113253、source、完整 functions/attributes/roles/ACL、穩定 schema、83關係與 Rates/Baseline 指紋、原始 signals、sessions/三類 leases/jobs0。未解釋的資料變動不得直接更新基準接受。受管 publication 自動輪替須保存實際列；不得豁免應用程式 schema。
2. 核對 manifest 的精確既有 QA 範圍：兩旅程、兩 budget、兩 Actual；`continuation.json` 從 C05 接續。已 Passed 且未受影響案例不重跑；前次 raw report 的 baseCommit 欄位曾固定舊值，保留原始記錄，下一輪 runner 已改為實際 HEAD。普通 JWT 讀取的整張 QA financial graph 必須與 checkpoint 完全一致才可寫入，不可重建、合併或刪除歷史。
3. 用新 OFF 合約建立受控 enable SQL，只開 metadata/finance/payment/source/lifecycle 的 enabled；Receipt/Undo/fullUndo 永遠 OFF，latch/readiness 不變。獨立讀回新的 active capture 後才寫入 before.json 並派送新 approval，含目前 continuationSha256 與期限。沿用 scope/protection 工具；不要使用舊七組 ON 或30秒 Undo Runbook。先前 Staging 授權仍有效，無需再逐階段要求批准。
4. 先重測 C05 的實際 product WebSocket frame，再做剩餘 A03/B01/B07/C06–C09/D01–D04。不將 UI 輪詢收斂或 SUBSCRIBED 當成 postgres_changes 通過。D02 從獨立唯讀 catalog 取得已存在的精確 receipt path 並比對 hash；本交接不攜帶原始附件路徑。D03 若仍無真正舊 signed URL，保留明確證據缺口交 Review，不能偽造 Passed。
5. 任何 P0/P1 立即安全 Pause。每次中止或完成後 logout、釋放己方 leases、五組 enabled OFF，再獨立 verifyAfter，保留 immutable latch、原始資料及 QA 財務歷史；確認 session、metadata/edit/Rates leases、jobs、owned attachment0。只清理本輪正常 API 建立的非財務附件，不操作既有 receipt bytes。
6. 全部必要驗收通過並處理歷史證據缺口後，再準備正式手測入口。已讀取 Auth 設定的 Site URL／允許 redirect 是 `http://127.0.0.1:5174`／`http://127.0.0.1:5174/**`，手測使用5174與 Staging mode；自動 QA 使用5189。不要為了換埠改 Auth 安全設定。手測所需五組 ON 應明確記錄為交接狀態，不能同時聲稱七組 OFF。目前尚無留下運行的手測 Vite。

## 額度與跨電腦限制

使用者要求五小時額度剩10%時停止新增測試，安全 Pause／logout／退出程序，更新矩陣、BUGS、CURRENT_TASK 和 Runbook，再 Commit／Push 原分支。已建立本機5分鐘 heartbeat（budget）；讀取真實 account usage，usedPercent90代表剩10%。輪詢不是即時保證，關機／應用程式停止後不能保證原主機繼續執行。回家續測時檢查實際監控是否在執行，必要時恢復同一項監控，避免重複建立。

額度由同一帳號共用，換電腦不會重置。Git 可轉移程式、非機密 scope 與已確認證據；不會轉移 RAM key、程序、一般登入 session、本機 env 或自動化主機狀態。舊 before/approval 已過時，需重新捕捉。本機 UI 原始日誌與附件路徑留在原機；可公開的測試圖與保護指紋已在 tracked manifest。

可在家對 Codex 說：「先 pull 原分支，讀 CURRENT_TASK 與2026-11-04 home handoff，還原非機密 QA scope，從 C05 繼續；只做到正式部署前。額度剩10%時安全收尾並 push。」
