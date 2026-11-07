# Issue #23：Legacy Budget 退場與驗收

範圍：[Issue #23 指定留言](https://github.com/PeterChiu0314/Travel-Planner/issues/23#issuecomment-6701747210)。原分支 `codex/budget-collaboration-redesign`，目標只有 Travel-Planner-Staging `uyqdopksfysbobhjcepk` 和它的 Vercel Preview。保留 #23 開啟。

- 正式工作區只讀 `read_expense_snapshot`、訂閱 `expense_signals`。Timeline、住宿、分帳由新版支出提供資料；舊快照、讀寫回退、舊 Realtime 均移除。離線只能顯示該帳號及旅程的新版快照，不授予編輯權。待辦、指南、行李與 Timeline 可獨立載入。舊 UI 只留作歷史測試，不由應用程式載入。
- Timeline 的排程交易仍原子移動新版支出關聯。刪卡、縮短日期解除受影響關聯，保留支出。住宿保留 `expense_id` 的同旅程外鍵。匯率維持行前日期、角色、租約、版本及原子重算；直接修改 trip 匯率會被拒絕。
- 擁有者在既有確認窗確認後，`delete_trip_with_expenses` 先檢查 native 交易鎖，再透過原有 RLS 和清理 trigger 刪除。進行中的寫入回覆 `55P03`；已提交後可重試。只清理同旅程的新版支出、參與者、關聯、群組、選取、匯率租約、訊號和項目／旅程級回執。

[明確 SQL 清單](../supabase/migrations/20261107035830_issue23_retire_legacy_budget.sql) 是物件清單的準據。31 張舊表（公開 7、私有 24，含 2 張 Hosted 專屬表）、229 個已確認舊函式（含 8 個過時的成對排程入口和 6 個 Hosted 專屬函式）、共用表上 27 個舊 trigger、8 個政策、舊住宿 FK／欄位與舊收據 metadata 退場。舊表內附屬 trigger、index、policy 和 publication membership 隨各自資料表移除。四個共用函式檢查舊版本指紋後改用新版；其餘 native、trip RLS、非財務附件、行程、成員、行李和 Storage 共用權限保留。移除採明確物件和 `RESTRICT`。

| 資料 | Staging 實查退場前 | 同版 SQL 回滾演練內 |
| --- | ---: | ---: |
| 舊預算／實付 | 18／8 | 表已移除 |
| 已凍結／未凍結舊快照 | 0／8 | 表已移除 |
| 舊附件 metadata | 1 | 0 |
| 旅程／新版支出 | 9／23 | 9／23 |
| 新版參與者／行程關聯／群組 | 40／2／75 | 40／2／75 |
| 新版回執／匯率租約／選取／訊號 | 247／1／47／7 | 247／1／47／7 |
| 舊 Storage 實體檔案 | 2 | 2（獨立 Storage 操作） |

Staging 回滾演練和正式提交都通過；兩次交易內 23 張保護表的筆數與內容指紋相同。Staging ledger 78/head `20261107035830`。兩個實體檔都在 `trip-attachments` 已停用的舊路徑，無非財務附件共用引用；刪除時使用 Storage 正常操作，禁止直接改 `storage.objects`。保留 `removed_receipts_storage` 限制；非標準路徑若仍有實體舊收據，migration 會拒絕。

安裝前用 `node scripts/qa/build-issue23-staging-packet.mjs trial`／`install` 產生對應 SQL。封包要求 ledger 77/head `20261107030622`、原始檔 LF SHA256 `1194f2818c245a550985beb240d5c3c63f9b0fde8650180e91d907b7931766b0`，先封存當前校驗值於交易的暫存表，核對後才提交 migration 與 ledger。若出現新依賴、不同版本或保留資料有變化，整筆回滾。上線順序：Staging 提交 → 原分支 push → 確認 Preview 的 commit → 用專用測試旅程與一般成員驗證 → Storage 實體檔清理／讀回。

驗證：99 項 Node／隔離 SQL、4 項 PostgreSQL 17.11 雙連線、103 項 Playwright 案例在各修正批次通過；Vite build 和 diff 檢查通過。隔離 SQL 已涵蓋包含舊資料與兩種快照的旅程、非擁有者、真正並發寫入、關聯移動／解除、匯率與回執。瀏覽器覆蓋 Preview 既有版的地圖與六工作區；新版本的 Hosted 刪除和多帳號 Realtime 須在 Preview 更新後驗證。原有「京都五日散策」不作破壞性驗收。
