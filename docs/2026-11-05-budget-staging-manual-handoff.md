# Staging 手測交接｜2026-11-05

手測網址：[http://127.0.0.1:5174](http://127.0.0.1:5174)。已確認HTTP200與「使用 Google 登入」畫面，使用一般 Google 帳號登入此 Staging；不提供或保存 QA 密碼，也不需要 service_role key。此為本機網址，只在目前這台電腦可用。若停止服務，於原分支執行 node scripts/qa/start-staging-manual.mjs；需要既有忽略的 .env.staging.local 公開設定。Google 登入若要求核准／加入旅程，沿用現有流程，不自行更改 Auth 設定或擴權。

依使用者最新明確指示，Metadata、Finance、Payment、Source、Lifecycle **持續 ON**，Undo、Receipt/fullUndo持續OFF；無45分鐘自動關閉、不必等全部自動化通過。沒有 Worker。自動QA、管理助手與5189/5190已退出；只保留5174手測 Vite。關閉前端不會關閉協定。此狀態僅限Staging uyqdopksfysbobhjcepk，Production完全未操作。

## 已驗證與待手測

- **32/34通過**；C07仍Failed（自動化Chrome最小化後仍visible，需真實瀏覽器背景／切回測試），D03仍Blocked（缺真正pre-removal signed URL，禁止新簽名冒充舊證據）。可手測不等於自動化全部通過，也不是Production GO。
- 新增／刪除B01本輪真實普通JWT通過；D01金融收據metadata55000/HTTP500及實際Storage policy拒絕、D02既有精確收據路徑簽名拒絕、D04住宿附件上傳／簽名／實體bytes比對／正常刪除均真實通過。
- B07本輪通過：正常QA旅程進入traveling，修改不同note後凍結Baseline不回填；旅行實付頁與settled結算頁、實付顯示及餘額合計零通過。旅行階段預設實付，所以使用「新增實付」定位；之前「新增預算」斷言是QA定位錯誤。QA旅程已settled，不強制還原歷史Baseline／日期。
- 編輯／自動儲存B02/B03及付款B05/B06沿用2026-11-04真實Hosted成功證據：標題備註正常存回、金額及分攤一致、付款切換重用同一Actual、第二筆current Actual遭23505拒絕。產品前端／SQL未因本輪改動；本輪沒有宣稱重新測過全部付款案例。建議手測用自己的新QA旅程，新增預算→改標題金額／分攤→離開欄位確認存回→切已付款→刷新確認同一筆實付，再取消未存編輯。不要在原始歷史資料上操作。

## 證據與限制

最新[矩陣](qa/2026-11-05-budget-staging-manual-results.json)、[非機密scope／最後OFF／目前ON manifest](qa/2026-11-05-budget-staging-manual-handoff.json)。家裡原始raw report無法存取；A03/C05/C06/C08/C09只沿用已提交摘要，逐列標記來源與缺少raw，不偽造執行時間。新唯讀圖與原圖差異精確限於C09標題及相同Actual／Baseline標題和時間戳；原始財務資料與私有QA旅程指紋不變。

每次停止均安全Pause再獨立核對。最後自動化OFF在2026-11-05T01:18:47.781503+00:00，手測ON獨立讀回在2026-11-05T01:20:13.44904+00:00。Ledger66/source/functions/attributes/roles/ACL/stable schema精確；83關係、原始receipt1/objects2及通知計數增量核對。實際受管Realtime publication輪替仍單獨捕捉，未改Migration或重設counter。UI匯出曾立即取得舊active結果；該檔未被接受為OFF證據，改以完成後的實際新時間戳及新CSV獨立驗證，拒絕的重複Pause沒有提交變動。

新manifest continuation標示manual-only，拒絕自動重播；若再做自動測試，先取得新的精確scope／financial graph與新OFF/active合約，不使用11/04舊checkpoint。未完成案例不被偽標Passed。後續只交使用者手測／ChatGPT Review；Production migration／正式啟用／main／Vercel仍未授權。
