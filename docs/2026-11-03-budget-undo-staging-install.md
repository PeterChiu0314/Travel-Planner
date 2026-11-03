# Undo 移除｜Staging 安裝完成，協定保持 OFF

2026-11-03 Asia/Taipei。唯一遠端 `Travel-Planner-Staging / uyqdopksfysbobhjcepk`；起點 `ac9501c`。使用者對明確的「僅 Staging 單一 Forward 安裝＋獨立讀回、原地保留收據／歷史／latches、七協定 OFF」問題回覆「繼續」，並於權限失敗後再次要求繼續。本輪不包含 Production/main/Vercel、功能啟用、QA帳號／財務初始化、API/signing keys取得、JWT發證或Storage bytes操作。

## 已確認的結果

Staging 已安裝 `20261103113253_remove_budget_custom_undo.sql`，**ledger65→66，Head20261103113253**。獨立 READ ONLY 查詢於 `2026-11-03T14:00:17.107254Z`（台灣22:00）確認；Dashboard pool可能重用實體backend，這裡的獨立指新查詢／新唯讀交易，不冒充已證明全新physical connection。

- 原65筆ledger完整raw-row摘要不變；新來源只有1個完整statement，實際儲存為LF、無CR，完整SHA-256 `7d4a96959bbe928c4bf4488311b82f6d5a400315d62eb8b6823dada27ba2e34c`，與不可變repo source的LF版本相同（Windows工作目錄CRLF的raw hash另不同）。本輪沒有修改migration來源；它現在已部署到Staging，**不得編輯或重播**。已取消的30秒Forward沒有安裝。
- 正確 row-projection coverage **81張base relations／668列／complete=true**；public/app_private/Auth/Storage整體row摘要前後一致。財務、付款歷史、Source、Baseline、Undo audit與既有queues均保留。另以不經XML的直接摘要確認六個財務投影、attachments及Storage catalog與最初盤點相符。
- 仍有 **1筆財務Receipt metadata、2個Storage objects**，沒有刪除、搬移或rename。1個沒有目前metadata引用的物件仍保留，不當成可刪orphan。沒有下載或計算物件bytes SHA，不將catalog指紋稱為備份／還原證據。
- **十二個Undo entry完整簽章**對anon、authenticated、budget_receipt_worker的有效EXECUTE皆false：5個public wrapper與7個private read/clear/lease/inverse入口。實際PostgREST普通JWT呼叫尚未做，不能把ACL查核稱為HTTP驗收。
- 三個替換helper及新Receipt guard的LF-normalized body hashes逐一與原Forward定義比對；其他body、既有function attributes/OID/owner/security/search_path、未變ACL、schema/RLS/既有policy/trigger/index、roles/memberships摘要保持原值。新guard trigger enabled且指向正確function，兩條restrictive policy與partial unique current-Actual index存在。
- 七個protocol與fullUndo仍OFF；原Finance/Receipt/Lifecycle activated latches及既有readiness完整保留，沒有重設或重填。有效whole/group leases0，pendingReceipt/unfinishedCleanup0；歷史工作紀錄不清空。

去敏結果：[安裝矩陣](qa/2026-11-03-budget-undo-staging-install-results.json)。真live contract、實際SQL/job與前兩次失敗證據留在Git忽略的本機目錄，不提交可執行live封包。

## 失敗、修正及證據更正

1. **第一個Hosted交易在Forward DDL前回42501**：行政角色不能對`auth.schema_migrations`取得SHARE ROW EXCLUSIVE lock。新唯讀查詢確認ledger65、新artifact不存在、schema/function/ACL/role/protocol不變。沒有擴權／換role／kill peer／重送未知COMMIT。
2. 唯讀權限盤點精確列出4張平台bookkeeping表：`auth.schema_migrations`、`storage.buckets_vectors`、`storage.migrations`、`storage.vector_indexes`。修正版只允許它們在無write-lock權限且有SELECT時使用ACCESS SHARE；其他未知缺權表一律拒絕。**財務、app-private audit、auth.users／sessions及storage.objects／buckets仍取得原本寫入排他鎖。** 四張管理表仍有前後row/schema/ACL封存，但不宣稱它們在transaction內完全write-frozen。真peer寫管理表會造成指紋不同而回滾；不需要／沒有新增平台寫入權限。[PostgreSQL LOCK權限與模式](https://www.postgresql.org/docs/17/sql-lock.html)支援此權限區別；實際保護另由非superuser/並發測試及Hosted讀回驗證。
3. **新增真並發測試發現原builder XPath錯誤**：`query_to_xml(...,true,false,'')`產生`table/row`，舊`/row/d/text()`回NULL。`ac9501c`及之前候選的aggregate `dataDigest`不能當成完整row保全證據；原19項fixture測試雖曾Passed，並不足以證明這項保護。本輪改成`/table/row/d/text()`，加入每張表非NULL/格式coverage及真同筆數財務變更／真peer改管理表的拒絕測試。[PostgreSQL XML mapping](https://www.postgresql.org/docs/17/functions-xml.html)說明tableforest=false的輸出結構。原六項直接財務摘要、Receipt/Storage直接摘要以及14項獨立financialSeal回歸不使用這個錯誤XPath，未被此缺陷取代。對舊aggregate保全宣稱明確撤回，以本輪正確81/668 before/after與直接摘要補證。
4. 測試初始化曾錯誤獨立commit未完成Undo intent，被既有deferred PT500正確拒絕；改用同交易fault fixture，不停guard。新增觀測barrier一度與writer共用連線，造成自建advisory deadlock；改用installer／observer／writer三條連線，並以pg_locks實測關鍵表的ShareRowExclusiveLock與三類實際UPDATE的55P03，沒有移除斷言。觀測barrier有獨立測試期限；正式封包的3秒lock timeout不變。
5. **第二個Hosted交易被提交前完整source校驗拒絕**，獨立正確row摘要確認所有81表/668列完整rollback，無新index/guard/policies/ledger。唯讀probe實測Dashboard把native paste轉成CRLF：raw source hash不同，LF-normalized source仍精確為上列SHA。修正版以`replace(...,chr(13),'')`在ledger儲存原LF source，並對新body只做同一種LF canonicalization後逐byte hash比對；不放寬SQL內容、空白、權限或row checks。整包CRLF native測試通過後才進行第三次交易。
6. 第三次Hosted交易成功，再由新READ ONLY查詢獨立證明上述ledger66／原ledger／source／rows／ACL／四個body／artifacts。沒有忽略錯誤、分段commit、任意retry或覆寫歷史資料。

## 測試及邊界

最終非superuser Managed-privilege fixture **23/23**，包含真row變更、真peer並發漂移與整包CRLF傳輸；它不是完整Managed Supautils或Storage bytes模擬。基本fixture **21/21**另跑，與Managed案例重疊，不加總成更多distinct。原SQL/RLS回歸 **14/14**、Build/syntax/diff通過，結果見矩陣。沒有改frontend，沿用先前117/117完整Playwright證據，未重跑／冒充新Hosted UI驗收。

安裝後將SQL Editor的可重送封包替換為完成註解及無寫入的SELECT；沒有再次執行migration。實際job保留於Git忽略的本機證據，獨立讀回頁保留供檢視。

本輪 **Staging dormant schema安裝與獨立catalog/row保全讀回完成**，不是功能Activation。Production維持先前紀錄，未重新讀寫。舊signed能力的失效/實際TTL、普通JWT HTTP拒絕、其他附件HTTP及真雙帳號Pricing/Payment/Source/Lifecycle/Realtime完整驗收、Managed Advisor新一輪audit與正式frontend發布仍不在本輪完成聲明內。沒有以readiness值、UI看不到收據或Native fixture取代這些證據。
