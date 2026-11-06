# 新版欄位租約20／60秒與續租

## 範圍

使用者授權只改原分支、新版expense租約並部署Staging。無待存變更20秒，有待存變更60秒。最新匯率規則與60秒lease完全保留，多人選取45秒／15秒heartbeat、API10秒timeout不變。未改Production/main或UI。

## 實作

- DB只替換expense_stage_b.lease：TTL20/60秒；有效同seq renew也更新expires_at，解決原seq不增加時「回傳granted但期限沒延長」；舊seq renew拒絕，避免晚到的舊dirty狀態縮短新租約。原actor/session/token/epoch、版本、過期與同組互斥檢查不變；release receipt邏輯保持。
- 前端5秒檢查續租，距到期15秒內也提早處理，先於snapshot refresh；不同欄位並行，單欄位single-flight。API仍10秒上限。回覆需確認原capability／epoch／active context仍相符，成功期限確實在未來，否則不授權。失焦或背景release後的晚到renew不能恢復authority。自己mutation造成的revision競態交原receipt/snapshot恢復，不誤判他人搶走。
- 保留失焦自動保存／清淨時立即release、背景釋放、dirty草稿與未知request-id恢復、真衝突拒絕及多人互斥。沒有改寫舊已安裝migration。

## Staging

CLI產生20261106055339，managed install分配20261106055836後只對齊檔名。Ledger73，single source SHA25634bbe692ec2b16a43cb519d1e5e2584fb74802729c4340e5e17f80794020cb7a；本機相同，gitattributes保留bytes，安裝後不可改寫或重播。

先取30組資料、ledger與非目標函式seal。Exact Forward真正BEGIN/ROLLBACK試跑，以既有無active note lease的項目和兩位approved actor切換authenticated role驗證：20秒／60秒、相同seq確實延長、舊seq拒絕、另一帳號不能搶、過期renew拒絕、第二帳號新epoch接手、舊holder renew/release不能清新holder、新holder仍可續租及精確release。試跑後32seals全部相符才apply；安裝後同斷言再次跑並ROLLBACK。

安裝後業務/財務/group資料與所有非目標函式（含最新兩個Rates函式與selection函式）seal不變；ledger預期變動，expense_signals與selections在觀察期間有變動，未宣稱這兩組soft presence完全不變或擅自清除。SecurityAdvisor保持25INFO、8既有definerWARN、1既有AuthWARN。沒有改flags、Auth session或Storage。

## 驗證

- 17distinct Node/SQL Passed：creation9、review5、新TTL/renew3；新3例最後整組3/3重跑。原新fixture首輪重複在authenticated role安裝function遭permission denied，改由既有helper在初始化root階段安裝後通過，沒有放寬權限。
- 11/11 Chromium Passed：兩帳號同時focus只一個owner；實際等待22秒仍editable且至少3次renew；blur保存後lease釋放，另一人能接手。另有背景釋放、草稿、離線snapshot恢復、Rates最新初始化／行前限制、新旅程取價、多人selection等回歸。使用repo Playwright/static maps/既有PGlite，Browser plugin未提供。
- Build／diff Passed，既有bundle警告保留。測試為SQL-backed瀏覽器／DB role，非Hosted普通JWT／獨立WebSocket多帳號完整認證。原分支commit/push後確認精確SHA Preview READY交使用者手測。
