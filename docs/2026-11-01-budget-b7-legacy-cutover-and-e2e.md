# Budget B-7｜Legacy cutover 與受控 Staging E2E

2026-11-01，分支 `codex/budget-collaboration-redesign`，起點 `240a105e113bdfbf723faa9a29c2378a5bf88a0d`。本文件持續更新；尚未完成項目不列為 Passed。唯一環境 `uyqdopksfysbobhjcepk`。使用者授權連續 Staging 收尾及有真實證據的 Activation，無逐階段 Review 門檻；Production/main/Vercel/Docker/WSL 未操作。

**最終結論：Staging 已安全 Pause，Production NO-GO。** 最後Protocol讀回2026-11-01 **20:56:14台灣時間（12:56:14Z）**，七組OFF、三個不可逆Latch保留、Ledger65。完成的核心E2E與缺陷修正如下，但背景可見性、撤權／Late Response等必要驗收未完成，不能宣稱B-7整體結案。沒有逐階段等待Review；停止原因是實際環境／Runner安全阻擋。完整去敏資料見[本輪機器可讀證據](qa/2026-11-01-budget-b7-cutover-e2e-results.json)；其中distinct event types不是獨立測試總數。

## 已完成

- 官方 CLI 產版 `20261101032853`，最小 Legacy cutover Forward 已原子安裝；Ledger64→65。精確 Source／Wrapper／前後函式 Hash、正式程序及官方來源見 [cutover Runbook](operations/budget-b7-legacy-cutover/README.md)。只修改三個既有 private Receipt guard/latch，新增 owner-only private journal／五個 helper；既有 migration 原文、RLS／Storage policy、Role／Grant、38個 business 函式不變。
- 隔離 PostgreSQL17.11 **19/19** 新 cutover 測試通過，包含真正雙連線排他鎖、未知 Hash／NULL Source／Ledger collision 拒絕、原子回滾、既有屬性保留、metadata/path 凍結、禁止假 expiry、Activation／Pause latch 保護。安裝後真實 Staging 獨立唯讀交易確認原28指紋及38seals一致、三個 guard新Hash／非body屬性、五個 helper ACL、journal私有RLS／不發佈成立。SQL fixture 未冒充 HTTP。
- 真實舊授權 inventory／cutoff／失效驗證：signed-upload TTL7200s、signed及authenticated TUS真201、userJWT S3 presign真200；停止後新簽發400及舊authenticatedTUS／S3寫入403。停止點由DB記錄 **03:57:00.574743Z／台灣11:57:00.574743**。使用者親自完成 Storage URL key Rotate＋Revoke；獨立 UI 發現第一次僅 Standby，未誤認完成，補做 Revoke 後再讀回。舊未過期 upload400/InvalidJWT、signedTUS400/signature verification failed，新key簽發仍可讀原68bytes及完全一致SHA；download token無法跨scope上傳。外部管理簽發程式已由使用者確認停止。
- 失效 attestation 真實提交 **04:07:15.727009Z**，綁定實際停止點／全部accepted→retired kids／HTTP digest／檔案保全及空multipart／pending工作。`legacy_grants_expire_at` 仍NULL；未把撤銷偽裝為自然到期。舊金鑰不可恢復為Standby，避免舊高權限授權復活。
- 既有已通過 Auth／Storage／Worker 平台證據沿用，未重跑舊suite。Managed Advisor重新執行：**0Errors、10同一批Warnings、24Info**；新增1Info為刻意deny-all的private journal `RLS Enabled No Policy`。過大 standard/multipart transport回應仍Blocked；真TUS413及未變的全域10MiB限制提供容量閘門證據，沒有調高Timeout或改標Passed。
- 受控 Activation 已提交，獨立讀回 **04:10:40.310018Z**：七組ON、三項Receipt readiness真、finance/receipt/lifecycle activated latch真、ledger65、無pending jobs/multipart/缺失Receipt bytes。五個前端flag僅在Staging localhost QA Vite行程true，原始預設仍OFF。
- 合法 Incomplete Hosted：普通JWT透過Lifecycle API建立Budget／Actual，再以Pricing lease/patch新增真participant，維持空Title／incomplete／pricing_ready=true。**2合法初始化＋6項非法child POST/PATCH/DELETE** 全部完成；每項55000（Managed HTTP500）且原parent/child整圖不變，不是空集合或SQL繞Guard。Runner變數遮蔽中斷一次，沿用已存在的精確fixture繼續，未重複新增。
- 真Chrome雙獨立Context／兩個QA Auth session已登入桌面1440×1000；未使用Mock／service_role作普通操作。A Title＋B Note並行自動儲存由DB確認；兩端後續列表／右側明細一致。原生Chrome不能連sandbox Vite，因此改同一native環境、localhost5188的獨立Vite；初次ANSI輸出判斷失敗以獨立HTTP200確認，未提高網路Timeout。原sandbox server已停止。

## P1 與安全 Pause

真實競爭流程發現 **Metadata第一次admission明確PT409後 epoch=NULL，Controller仍保留token，discard/close永遠無法通過cleanup**。DB保護有效、財務未覆寫；UI草稿／Conflict保留，但恢復出口卡死，列P1。

已立即執行安全Pause，獨立讀回 **04:35:25.897787Z**：七組OFF、三個activated latch仍true、readiness仍保留真實已驗證值、legacyexhausted真、Receipt缺失0。未重設latch或破壞性回滾。

最小本機修正：只對**首次新token、無epoch、無granted結果的明確PT409**解除未授予token；草稿／conflict仍保留，等待使用者選擇恢復。若先前有未知ACK或已有epoch，仍保留能力直到實際釋放確認。Receipt `retainRequestOnError`、財務request及真正40001/40P01語意未改。

新增3項單元測試先重現1fail/2pass，再修正後3/3；直接相依的既有PT409admission、failedrelease、ABA晚回應3/3通過；Build通過。04:50:23Z依相同真實平台／cutover證據與新修正測試安全Resume；04:51真實租約競爭、04:52真正延遲admission造成的PT409回歸通過：草稿保留、沒有peer patch、明確捨棄及關閉成功。此缺陷的修正與Staging回歸已完成，尚未部署正式前端。Pause／Resume及原失敗證據均保留。

先前同群組Runner的瞬時readonly斷言、未驗證有效租約、點已選列導致取消選取、缺少p_versions參數等失敗均保留；不以這些拒絕冒充鎖競爭通過。TUS初次JSON-only錯誤分類亦保留，零bytes診斷相同response SHA確定格式後才補正；通用400／過期樣本不能計入撤銷成功。

## 目前矩陣與剩餘工作

| 項目 | 狀態 | 範圍 |
| --- | --- | --- |
| Cutover Forward／原始資料與權限 | Passed | 真Staging ledger65及獨立讀回 |
| 發證停止／舊能力失效／bytes保全 | Passed | 真HTTP及使用者key操作後獨立核對 |
| Legal Incomplete／6項Participant拒絕 | Passed | 真JWT/PostgREST、現存child及整圖比較 |
| 雙Context／不同群組並行 | Passed | 真Chrome＋真DB，非完整E2E |
| PT409 admission恢復P1 | Passed | 本機red/green及真實兩端UI恢復 |
| 相同群組穩定競爭／草稿恢復 | Passed | 新鮮真租約、對端阻擋及正常關閉；真到期接管另測 |
| Receipt Begin/Commit/Replace/Delete | Passed | 真UI、專用Worker、兩個不同object ID、bytes/SHA、peer Signed URL及獨立清理讀回 |
| 付款／單筆retainedActual／付款ACK | Passed | 300元／兩人；同Request重送不重複財務與歷史寫入；取消再付款使用同Actual |
| 合法手動Source首次關聯／解除 | Passed | origin首次建立後保留，所有財務欄位、歷史與現存participant不變 |
| generated／historical Source邊界 | Passed | 既有0A000契約拒絕解除或重新掛回；不冒充支援任意roundtrip |
| 旅程匯率更新 | Passed（已測範圍） | 真外部報價HTTP200及UI提交，三筆Actual整列不變；不同外幣報價重估另列待驗 |
| 五步Undo／輸入原生Undo／peer衝突 | Passed | 六次儲存最多五次復原；第六次無寫入；peer新值不被覆蓋 |
| Metadata ACK／v1–v10／Legacy Fence | Passed | 真提交後丟棄回應，同Request恢復；舊Save及Raw DML拒絕且整圖不變 |
| 離線重新連線 | Passed（已測範圍） | 真Context斷網、另一人提交、重新載入後新Snapshot／Realtime |
| 空白新增／編輯租約與刪除競爭 | Passed | 真Realtime INSERT／DELETE、他人持鎖拒刪、釋放後正常刪除 |
| 真租約到期／接管／舊頁恢復 | Passed | 12:06:29Z真實到期，epoch21→22，peer寫入及舊頁canonical／關閉；無SQL改時鐘／租約 |
| 同帳號雙分頁／Presence | Passed（已測範圍） | 共用Auth session、不同編輯session、真拒絕及owner名稱；非所有Presence race |
| 背景hidden／visible草稿恢復 | Blocked | 原生headless／headedChrome未提供可靠hidden狀態；不改寫visibility或注入假事件 |
| 撤權／延遲Snapshot／登出／切旅程 | Blocked | QA B實際改pending；延遲真回應Runner未返回；未驗證UI拒絕／晚回應隔離／正常恢復 |
| 手機／IME／Portal／Accessibility最終Staging流程 | Blocked | 先前未受影響的歷史證據保留，不能冒充本次全流程驗收 |
| 外幣歷史成本完整競爭／收據Object-ID並發race | Blocked | 已過的報價刷新／順序替換不能代替尚未執行的race |
| Production | NO-GO | 未授權操作；全真E2E仍未完成 |

QA精確識別留在Git外私有scope；原2個旅程、原帳號與舊QA Baseline均不是修改對象。新cutover graph含獨立trip、legacy Receipt控制檔及合法Incomplete資料；Activation後受Parent／Receipt／Audit guard保護，必要時保留，不得強制刪除。

最後獨立Protocol讀回12:56:14Z：Ledger65、七組OFF、三activatedLatch仍TRUE、三readiness維持先前真實驗證值、legacy natural expiry仍NULL／exhaustedTRUE、pending intent／cleanup／缺失Receipt為0。12:58:40Z原28投影、38seals、RLS／ACL／Worker／StoragePolicy／Publication等與原保護基準一致。QA Link最初被未擴充的child投影計入差異，確認為本次精確QA旅程內唯一關聯後，僅排除該QA parent的child，另加跨旅程關聯=0斷言；未更改原始預期Hash或Hosted資料。

12:59:18Z獨立核對Cutover ledger完整Source Hash、三函式before/after及所有非Body屬性、五私有helper seals、owner-only journal ACL／RLS／非Publication均正確。Guard after SHA為`85cda3b2566527c40fe9bb1ee791b5d9ed07172e283ad46c5b2e23dd2c2df434`、`eb1fdeec2290b9dc95c8033c0d212713f938db8ccfa716b85e340bc7f9b983ac`、`87a6a48c10e8adcca2a66c23fc91520e38b7cc8bf4f15208c1576b82e93392e0`，簽名對照見seals。Managed Advisor實際Rerun仍0Errors／10同一批Warnings／24Info；較cutover前唯一新增Info是owner-only private journal deny-all RLS。新連接器對指定Staging返回無權限，沒有擴權、沒有再讀API secrets。

11:09讀回本次業務Receipt對應Actual的metadata=0／Storageobjects=0。13:02:04Z保留QA Graph：1trip、3budgets、3Actual、1itinerary、1Baseline、1attachment、2objects（仍被引用的legacy控制收據及S3控制檔）。兩種Participant孤兒數0、有效編輯租約0、pendingReceipt及activeCleanup0。新增空白刪除競爭用的那筆Budget已正常刪除；其餘整圖含歷史Source／Baseline／audit，沒有強制Trip／Auth Admin Cascade或SQL清除。舊QA Baseline及原始資料未動。

撤權測試只改本次QA B的membership approved→pending；它實際生效，但延遲回應Runner卡住，未能完成普通owner JWT恢復。因此最後QA B仍pending，整圖保留，不能標為清理完成。使用者回覆已按Ctrl+C；原生視窗盤點未見PowerShell／QA Chrome；另佇列exact operator stop request。但最後status.json仍記running，不能用此舊檔宣稱process已退出、所有Session已登出或記憶體清除已獨立驗證。未任意終止其他Node／Chrome。這是明確未完成的安全恢復事項。

## BUG-032 Snapshot時序修正與實際限制

真到期接管測試先觀察到B在DB取得有效租約但UI仍不可編輯，立即Pause11:45:48Z。未封存完整舊失敗的前置網路trace，因此不把所有舊失敗都推測成同一根因。本機嚴格重現另一個確定缺陷：admission前發出的Snapshot晚到會撤銷剛確認的能力；較早讀回還可把較新的Pause顯示成ON。新增4項測試red-before2fail/2pass→green4/4，涵蓋舊讀回、fresh撤權、Snapshot不得自行授權、Pause不倒退。另重跑直接相依3項既有admission及4項ingest／expiry測試；Build通過，未重跑歷史全suite。

最小修正只處理讀取時序與已確認能力：同context採用readStartedAt單調順序，configure重設；舊讀取的ownership不能推翻仍有效的實際admission，但fresh撤權、版本衝突、protocol OFF及真正租約到期仍fail-closed。沒有放寬DB lease／Guard／RLS。12:02Z依新測試、原28/38/security及舊URLkey仍Revoked的獨立證據受控Resume；12:06:33Z真expiry／takeover／canonical恢復通過。

一次Resume本機封裝曾因JS String.replace把`$$`當replacement特殊字元，導致DO區塊SQL解析拒絕；獨立讀回12:00:58Z證明仍七OFF／Ledger65／無pending，沒有部分提交。修正為callback保留原SQL定界符、保留所有原子閘門後才成功Resume；原已安裝Migration與Source／wrapper Hash完全未改。

CDP `Page.setWebLifecycleState`回傳成功，但sanitized trace看到等待中A仍有18次讀取；所以移除「背景已凍結」通過宣稱。真正hidden/visible另測仍Blocked。已查明Playwright1.60預設啟用focus emulation，依[Chrome官方CDP文件](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/#method-setFocusEmulationEnabled)關閉該模擬後，原生headedChrome仍無可靠hidden觀察。保留Blocked，不修改DOM或提高Timeout湊通過。

## 剩餘P0／P1／P2與下一步

- 本輪沒有證實新的財務遺失P0。BUG-031、BUG-032已完成最小本機修正、必要直接回歸與相應真實Staging場景；正式前端未部署。
- P1 release gates：撤權／晚回應／登出／切旅程完整E2E和安全QA恢復尚未完成；背景可見性及其他矩陣Blocked保留。延遲Runner卡住不能直接推定產品根因，需先把Runner做成可取消、可定位的有限步驟，再恢復exactQA membership／Session，不能盲目重試或新建一批QA掩蓋問題。
- QA助手原本只在主迴圈判斷180分鐘，await卡住時無法強制執行；新版本加入獨立deadline／exact stop watcher及僅關閉自身Browser/Vite。語法已檢查，但本次使用者中斷的是舊已啟動版本，新版原生取消／逾時仍須實測，不能寫成通過。
- P2：既有standard/multipart超限transport回應仍Blocked；TUS413是另外證據。大型bundle警告保留。Planning UI的Incomplete Actual／來源原始錯誤訊息可用性限制只記錄，未擴大改版。完整staged `git diff --check`另外回報6個封存SQL尾端空白（Source20/131行，wrapper32/143/179/290行）；它們存在於已安裝／Hash封存的完整來源，不為通過whitespace檢查而重寫歷史。未修改whitespace設定；其餘暫存檔案的diff檢查通過。這是明確P2產物例外，不是完整diff乾淨的宣稱。
- 正式準備見[收尾Runbook](operations/budget-b7-closeout-runbook.md)：精確18項增量來源及舊47筆依賴分開核對；本輪不讀Production、不假定Production已有相同baseline，不使用Staging-only操作helper作正式啟用封包。原始資料backup/restore、production target-bound wrapper、所有Blocked及QA恢復完成後才可能改GO。沒有合併main、部署前端或操作Production。

Runner修正均保留失敗經過：總額均分的share_amount按既有SQL契約為NULL（只有custom存個別金額），改同時驗證模式、精確成員、總額及UI150/150；重點擊已選row／開啟menu／details會切換回關閉，改成檢查狀態與確定控制項；付款retry按鈕在busy時暫時隱藏，必須等付款控制項重新可用才核對重送；Snapshot確認租約已實際授予才建立競爭前提。Source第一次關聯會初始化空origin，解除後歷史origin重新關聯由原契約0A000拒絕，不把此行為當成可任意往返。Planning UI不列Incomplete Actual於既有付款清單，該QA Actual透過普通JWT的合法Lifecycle time RPC完成，未將此HTTP結果冒充Actual付款時間UI測試。
