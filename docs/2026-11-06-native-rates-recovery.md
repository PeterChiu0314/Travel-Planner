# 更新匯率55000與頁面無法離開修正

## 根因與前端

Expense原生update_rates直接更新trips.budget_exchange_rates，但Staging的舊finance latch仍啟用；legacy guard需要transaction/backend/actor綁定的trusted rates effect，因此以55000「Use atomic rates protocol」拒絕。之前隔離SQL fixture未安裝這組舊trigger，所以漏掉整合衝突。

expenseRates.confirm原先只將PT409/22023/42501/55P03視為明確拒絕，55000仍保留pending請求並讓page leave guard反覆重試，beforeunload也持續被觸發。加入55000的明確拒絕處理：清除原請求、精確release、refresh，不自動重送被拒絕操作。另修正沒有pending或cleanup的retry/finish直接成功，不再emit反覆更新guard。真正未知network ACK仍保留不可變request並查原receipt。

## Staging修正與保護

CLI建立新migration，managed安裝後僅對齊檔名至20261106033608_native_rates_compatibility.sql。只替換兩個函式，保留OID/owner/ACL/security/search_path：

- 原生update_rates完成原權限／租約／版本／quote／targets檢查後，在現有private effect table建立綁定tx/backend/actor/trip/quote的admission，讓既有guard驗證通過；receipt寫入後清除effect。沒有關閉trigger／latch，直接quote寫入仍55000。
- 原receipt增加server產生的transaction/backend識別。舊deferred baseline trigger僅在trips只有匯率／updated_at變動，且同transaction/backend/actor、trip、quote相符的已提交native receipt存在時跳過；其他legacy baseline流程不變。保留原Actual與Baseline，不新增Baseline系統、不變更RLS或client grants。

Ledger70→71/head20261106033608，單一stored source SHA256為2a91619b7b9f4b20550ca3fe81aba45b80e83318371055654ad0ec8de083372d，本機bytes相符；gitattributes保留原bytes。Applied來源不可原地改寫或重播。此source含原函式CRLF部分及無尾端newline，不能格式化。

## 驗證與界線

- 先取真catalog、trigger、ACL、SecurityAdvisor與30組public/expense資料指紋、ledger及非目標函式seal。
- Exact Forward真正Staging BEGIN/ROLLBACK試跑；authenticated DB role使用既有QA acceptance trip，僅在交易內建立兩筆外幣fixture。JPY1000預算200更新至250，已付款budget/paid仍200；原Actual與全Baseline指紋保持，direct write拒絕，same-request精確replay，release與deferred constraints/effect cleanup通過。全fixture與schema試跑rollback後32seals全部相符，才apply。初次SQL串接漏semicolon在執行前syntax error，修正後exact source trial通過，未冒稱失敗試跑成功。
- 安裝後全30data seals及非目標function seal相同，只有ledger seal預期改變；再次執行同authenticated-role／外幣／paid／baseline／replay斷言並ROLLBACK。SecurityAdvisor維持25INFO/8既有definerWARN/1既有AuthWARN。沒有新public表／grant／協定開關、Production/main或Storage/Auth session操作。
- 2個Node client regression Passed：55000清理後finish不emit、不重送；unknownACK保留exact request直到確定拒絕。8個distinct Chromium Passed，包括新55000失敗後側欄切Timeline、無Dialog阻擋、reload不觸發beforeunload；該例再跑1/1截圖。Browser plugin未提供，repository Playwright/static maps/既有PGlite；這些SQL-backed瀏覽器與Hosted DB role不等同普通JWT／WebSocket使用者驗收。
- Build／diff Passed，既有bundle警告保留。前端推送後核對精確SHA Preview READY供使用者重新整理原分支網址。截圖／trace保留在本機visualizations，不提交raw logs或secret。
