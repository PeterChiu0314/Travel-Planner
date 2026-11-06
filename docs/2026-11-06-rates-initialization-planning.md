# 匯率首次取得、行前限制及一分鐘租約

依使用者定案：新增旅程自動取一次；行前之後只手動更新；旅行中保留原匯率；已付款金額永不因旅程報價變動；匯率租約1分鐘。

## 前端

- 一般新增旅程先取得現有ExchangeRate-API報價，與旅程初次INSERT一起寫入，不等預算頁才取得。沿用既有10秒timeout、cache與正常錯誤通知；取價失敗仍可建立旅程，之後由缺漏補救或手動更新取得。不額外建立背景排程。
- ExpenseRates補回缺漏初始化。只有工作區active、可編輯、有日期且planning、無編輯草稿／未知請求／他人匯率租約，才自動嘗試一次；已完整的五幣別quote不變。既有／匯入的行前旅程也可透過此入口補救。取價後fresh read再次檢查，若其他人已初始化即停止，server initialize旗標也防覆寫。已被其他人完成的初始化PT409在權威read證實後安靜收斂。
- 手動按鈕與controller.canUpdate均受最新planning/active/editable限制。旅行中切回預算顯示也不能更新、不取新quote。5秒timer只查原本未知請求的回執，不重新抓價或定時重算。

## DB／Staging

只更新native rate_lease與update_rates，保留OID/owner/ACL/security/search_path。Acquire先沿用expense-trip advisory lock，再鎖trip；日期檢查採Asia/Taipei，需start_date未到、status非settled、未逾end_date且無已出發legacy Baseline。真正寫入在trip row lock後再檢查，避免先取得lease再跨日。Release不受日期限制；精確已提交receipt replay在新寫入日期檢查之前，能跨日恢復舊成功而不新增寫入。

Lease由2分鐘改60秒。initialize=true只允許缺quote，已具備五幣別時拒絕PT409而非覆蓋。原未付款外幣重估與paid保護SQL未改。

CLI產生20261106035639，managed apply分配20261106053231後僅對齊檔名。Ledger72，單source SHA256cab1b121a1e544611d21225196815b750f93fadc2592b4d4e49dccb103f94e65；本機hash相符，gitattributes保留bytes。安裝後禁止改寫／重播。

## 驗證

- 6個Node/SQL案例Passed：初始化已有／並發quote不寫、非planning不抓價、1分鐘TTL、取得後出發仍拒新寫、已出發／settled／缺日期／frozen baseline拒絕租約；保留原55000拒絕／unknown ACK恢復。
- 39個Chromium整批Passed（9新模型協作／匯率，30app/Demo/Timeline/Share smoke），再補一般新增旅程攔截INSERT的quote檢查1/1Passed，共40distinct。新初始化案例確認只一次、旅行中預算按鈕disabled且quoteReads不增加。Browser plugin缺席，使用既有Playwright/static maps/PGlite。新增旅程測試只攔截初次INSERT payload，沒有Hosted新建真旅程；不冒稱普通JWT/WebSocket完整驗收。
- Exact migration在真正Staging BEGIN/ROLLBACK試跑，建立交易內新QA旅程：首次取得、第二次初始化不覆蓋、60秒租約、出發後acquire/write拒絕、舊已提交receipt仍可replay、release與deferred constraints通過。第一次確認逾時未執行；第一次SQLfixture漏必填destination整交易失敗，補齊後通過。rollback後32seals全部相同才apply；安裝後同role斷言再跑並rollback，全30資料與非目標function seal不變，只有ledger預期變動。
- SecurityAdvisor維持25INFO、8既有definerWARN、1既有AuthWARN。Build/diff Passed，既有bundle提示保留。Production/main、協定開關、既有實付／Baseline未改。
- 安裝後另補真Staging transaction驗證：首次初始化完成後，手動行前更新仍成功，再跨出發日驗證拒絕新寫／新租約且舊receipt精確恢復；ROLLBACK。兩個目標函式OID36457/36458、owner/ACL/SECURITY DEFINER及空search_path保持原值。

推送原分支後核對精確SHA Preview READY；使用者手測不等同以上自動證據。匯入流程沒有新增第二套寫入協定，缺報價的行前匯入旅程在進入預算頁時補救；旅行中匯入不自動改匯率。
