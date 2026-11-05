# #18 功能接線與多人選取同步補回

根因：切到 `ExpenseWorkspace` 後繞過 `LegacyBudgetPanel` 的 collaboration controller，未發布／接收選取，也未接完整 workspace／visibility 生命週期。先前只恢復外觀、使用新租約投影的說法不代表多人功能已恢復；這是漏接。本次保留 #18 財務模型，補回功能契約，不恢復 Source／Receipt／Undo／多筆付款；#19 獨立。

## 已補接與驗證對照

| 原功能契約 | #18 路徑及驗證 |
| --- | --- |
| 多人選取提示 | 重用原 collaboration controller 與同一套顏色／排序規則，使用 `update_expense_selection`／`read_expense_collaboration` 及既有 `expense_signals`。提示45秒到期、15秒heartbeat；genuine selected_at 不被refresh／背景返回改寫，晚到clear不清除新activity。 |
| 多分頁與編輯優先 | 同帳號最多顯示最新genuine選取；編輯優先於選取，own-session去重。兩帳號三分頁隔離SQL-backed Chromium案例確認，另補5位編輯者的原segmented框及姓名清單。 |
| 色框與權限 | Row同時顯示選取／編輯、hover與鍵盤focus姓名；field顯示對應group持有人。選取不取得lease，不阻擋另一個人正常編輯；實際唯讀／寫入仍受原group租約、版本、RLS限制。 |
| 離開與背景 | 離開工作區／hidden／offline清提示與可安全釋放的己方租約，保留草稿／未知請求；回到原焦點先fresh authority read再精確重取，避免仍有游標卻永久readonly。失敗不偽裝成功。 |
| 快照與草稿 | App原生快照讀取失敗有獨立expenseVerified=false；離線cache不保存group authority。Cached graph可讀但不能授權。恢復草稿等fresh exact-base後保持輸入，不因cache缺lease版本誤報衝突。 |
| 財務與編輯 | 10000budget／9500paid獨立、member decisions、custom pricing、guarded cancel、lifecycle、unknown ACK沿原控制器；Native Rates按鈕以真正新RPC在隔離SQL核對未付款JPY重新報價。 |
| Timeline／住宿／結算 | Formal／Demo共用cost projection，paid-only可出現在Timeline；0不再用舊itinerary cost替代。住宿編輯與明細讀同一expense_id。補Demo建立paid-only→行程link→Timeline→住宿選取／儲存／明細操作。原結算同ID及既有legacy金額契約保留。 |
| Demo與其他入口 | Demo保持同模型／同編輯器、memory-only、static maps，無Hosted／持久draft。App、Demo、Share、Timeline／交通編輯等原smoke有覆蓋。 |

## Staging

`uyqdopksfysbobhjcepk` 已安裝Ledger69/head`20261105142122_issue18_selection_collaboration`，SQL SHA256 `c368cd0c2494711725145a46d73b8eb351f16b26328166d8ff6012c5b7408321`。CLI先產生`20261105134322`檔，managed apply分配上述版本後僅改本機檔名，bytes未變。已安裝來源不可重播／原地改寫。

新增private selections與4個受限函式，Public invoker facade僅authenticated可用；approved viewer可選取但不能取得edit lease。每次非clear操作驗證trip membership及未刪除item；清除綁定actor/session/activity。private table RLS ON、clients無直接SELECT／write；不新增／改寫財務parent、participants、Baseline或租約寫入規則。

Exact Forward先在真正Staging transaction／ROLLBACK試跑，以既有QA項目與兩名approved actor切換authenticated role測試；首次確認過期後重試，SQL斷言曾因transaction_timestamp固定將同交易剛clear的hint視為未到期，改以clock_timestamp核對實際expiry後通過。試跑後Ledger68／schema未安裝狀態與13資料指紋獨立相符才apply。安裝後重做role SQL與ROLLBACK；selection rows0、active group leases0。這是DB角色驗證，不是普通JWT與真實WebSocket多帳號瀏覽器驗收。

13組資料（原Actual8／participants11、Baseline5、新items9／participants13／links0，及旅程／成員／Timeline／住宿／附件／行李）完整指紋不變；原68筆migration ledger及所有既有public/app_private/expense_stage_b函式完整definition／OID／owner／ACL seal不變。Security Advisor既有8 definer WARN與1 Auth WARN不變；private deny-all selection表新增1個INFO（24→25），為刻意限制direct access。未操作Production，旁邊開啟的Production Dashboard亦未使用。

## 證據與界線

52個Node／SQL案例通過；56個distinct Playwright案例通過（55例整批54通過，原Demo「預算」標籤斷言依native同項目支出改為「支出」後重跑通過；新增5人segmented色框通過），Build／diff通過，既有bundle提示保留。Browser plugin未提供，使用repository Playwright與隔離PGlite，desktop1440×1000截圖檢視；[非機密指紋與功能矩陣](qa/2026-11-05-expense-functional-parity-results.json)。

原分支推送後確認精確SHA Preview READY，請使用者重新整理既有Staging Preview。真實兩帳號／三Session ordinary-JWT／WebSocket及使用者手測仍不冒稱完成，#17/#18保持Open；Production/main禁止操作。使用者icon目錄及原未追蹤檔案不動。
