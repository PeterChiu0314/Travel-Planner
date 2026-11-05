# Issue #17／#18 review 修正與 Staging 交接

依 [#17 新成員 focus review](https://github.com/PeterChiu0314/Travel-Planner/issues/17#issuecomment-6653890830) 與 [#18 靜態 review](https://github.com/PeterChiu0314/Travel-Planner/issues/18#issuecomment-6653891504) 實作。沿用原分支與已恢復的 UI，不重規劃模型；#19 新增入口／空白建立規則不在本輪。兩個 Issue 維持 Open，尚無使用者手測驗收。

## 修正內容

- `expenseEditor` 將新成員補選投影到 `view().value`，canonical/value/dirty/request/storage 不因此改變。開啟、focus、失焦、切頁、finish與refresh均不提交補選；只有使用者明確操作計價／名單／分攤時，才連同本機建議通過原租約、成員向量、匯率與版本驗證提交。明確排除者保持排除，既有 paid 與已付款決策不自動擴大。
- paid 表單使用原有 participant IDs，不再把歷史空集合補成全員。complete/paid且0 participant rows的舊 Actual 可讀／focus／修改非財務欄位而保持原 paid/shares/settlement；要重新計價須由使用者明確選人，否則既有驗證以 Sonner 提醒並保留草稿。沒有補0、補時間或重算歷史分攤。
- 新 Forward 只替換既有 group lease 函式的 release 分支。回執綁定item/group/session/requested epoch，區分 released、inactive、superseded與epoch_mismatch；只在 submitted capability 已失效時認定 cleanup 完成，superseded不代表peer租約被清空。同token/session仍有效但epoch不同時拒絕，回傳其已證實的current epoch供精確cleanup。前端驗證receipt後才清除本機capability；未知ACK保留能力並重試，同一capability的舊epoch可精確修復；不接收僅有granted:true的模糊成功。
- Demo直接使用同一`ExpenseWorkspace`、`createExpenseEditor`及`newExpense/priceExpense/confirmExpensePayment/cancelExpensePayment/expenseRows`核心。memory transport只處理記憶體snapshot／lease／receipt；無Supabase/Auth/Realtime/Storage、外部報價或財務draft持久化。Fixture直接建立單一item，移除舊雙表scenario hydration、Source／Baseline／多筆付款fixture與舊Demo寫入callback。重新整理會重設，旅程間memory graph隔離。舊Production相容程式未被改接回新入口。
- 共用結算頁的新模型分支依item ID識別已付款，修正「同一筆同時列實付與待付款」；預算不再經舊付款覆蓋投影。舊Production分支保留。沿用已恢復的工具列／分類表／右側分頁／統計／Rates位置，遵循#17只用協作者色框，不增加peer灰底或欄位狀態UI。

## Staging 安裝與資料保護

Staging `uyqdopksfysbobhjcepk` 新增 **Ledger68/head `20261105132450_issue18_precise_lease_release`**。CLI先產生`20261105130529`檔；managed `apply_migration`分配`20261105132450`後本機檔名對齊，SQL bytes不變。新source SHA256為`9c2dce20c010f3355c31aa4ad4bdf53aa67ec1b5e7b8a4e8d559fde9b64c3f62`；Ledger67原source SHA仍為`8d472812fcecc87b3def9825d85bce8bbe227e5778883649c84e99c693391a50`。兩份已安裝來源不可重播或改寫。

先讀真實catalog、Security Advisor與13組資料指紋，對exact Forward做真正Staging transaction/ROLLBACK試跑；10個SQL斷言涵蓋acquire、同cap舊epoch、同帳號第二分頁、仍持有者renew、精確release、重複release、新epoch、舊cap不逐出新holder及cleanup。試跑後來源／Ledger67／13組指紋獨立讀回完全一致，才正式安裝。安裝後再執行同10個authenticated-role SQL斷言並ROLLBACK；這是DB角色模擬，不是普通JWT／Hosted瀏覽器雙人驗收。

安裝後13組資料（原Actual8／participants11／Baseline5、新items9／participants13／links0、旅程／成員／Timeline／住宿／附件／私人及共同行李）指紋相同。函式OID36431、owner、ACL、SECURITY DEFINER及空search_path保持原值。active group leases0。Security Advisor仍為24 INFO／8既有definer WARN／1既有Auth WARN，未增加。五舊協定ON、Receipt／Undo OFF，未操作Production／main、Auth session或Storage物件。[非機密證據](qa/2026-11-05-issue17-18-review-results.json)。

## 驗證與使用者手測

- 46個Node/PGlite模型／SQL／RLS／controller案例通過，包括5個新review案例；改用實際安裝版本檔名後5個新案例再次通過。Build及diff check通過，既有大bundle提示保留。
- 45個Playwright案例通過：7個既有新模型／還原UI、2個新review rendered、5個Demo（包含fixture核對）、30個app/Demo/Share smoke、1個舊Production相容計算。Demo首輪揭露待付款判斷仍用舊link，修正共用新模型分支後5/5通過。Browser plugin未提供，使用repository Playwright、static maps與隔離PGlite；desktop1440x1000截圖已檢視，圖片與trace留本機visualizations。
- 原分支推送後核對精確SHA的Vercel Preview READY，使用既有[Staging Preview](https://travel-planner-git-codex-budget-co-6eda5b-peter-chiu-s-projects.vercel.app/)手測。真實雙帳號／三Session、合法外幣新報價、住宿與完整結算旅程仍未全部完成，不宣稱使用者已接受或Production GO。
- 手測#17：後加入成員的本機預選在只focus/失焦/切頁後不持久化；真正改價才一起保存；排除後刷新不重選，預算與已付款集合獨立。手測#18：舊空分攤資料不被推測，必要時明確選人；同帳號多分頁與網路恢復可繼續編輯；Demo與登入版操作一致且重新整理Demo不保留變更。不要用原8筆歷史Actual測試改價；可在既有QA旅程建立隔離手測項目。
