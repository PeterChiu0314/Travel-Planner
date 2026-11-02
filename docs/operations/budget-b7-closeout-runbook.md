# Budget B-7｜連續 Staging 驗收與 Production 準備

**最新狀態2026-11-02：[真實不同匯率／Staging 結案](../2026-11-02-budget-b7-rates-staging-closeout.md)、[結果矩陣](../qa/2026-11-02-budget-b7-rates-closeout-results.json)。** 最後 changed-quote P1 gate 已 Passed，Staging 核心功能／財務安全驗收 GO（帶已列 P2 限制）；Production／main／部署 NO-GO。全傳輸子項零 Blocked 的較廣驗收仍未完成，不可把原 standard／multipart HTTP status 缺口改稱通過。現在安全 Pause：Ledger65、七OFF、三 activated latches保留、readiness保留、原28/38/權限不變、QA sessions/refresh/leases0、原生QA助手/Chrome/Vite退出。以下早期64筆／readinessfalse及當時未驗證描述是歷史 checkpoint，不可當現在的前置值。

## 結案後操作與合法匯率補驗程序

1. 本輪最後市場 quote 已變，不需歷史 quote workaround：原產品公開端點HTTP200，2026-11-02 quoteJPY0.207133不同於已存2026-11-01的0.206945。raw response/取得時間/原文SHA只留Git忽略證據，公共矩陣存來源、時間、最小值與digest；保留供應商attribution，不散布整份quote。若未來quote相同，明確Blocked，不改來源/時鐘、不倒寫既有rates、不用no-op冒充重計價；可等供應商下一次真更新，再重核差異。
2. 若有另外必要的新Staging測試，先新唯讀檢查指定target/Ledger65/38seals/28投影/權限/七OFF/三latches/既有readiness/legacyexhausted、租約與在途transaction/Receipt jobs歸零。**先封存每一個可能切入QA目的旅程的完整Rates/Baseline**；UI缺rates可合法初始化並刷新futureBaseline，不能把瀏覽假設成絕對零寫入。過去缺Hash資料不回填或還原。
3. 普通QAOwner/Editor各自真Auth Session，主憑證僅RAM；沿既有原子Resume SQL及當前真證據attestation，不重填readiness、不改latch。QA-onlyVite flags只在子程序；正式defaultsOFF。有限RAM期限前必須完成Pause，timer不會自動PauseDB。未能保證收尾不可Resume。
4. 本輪只新建一筆正常UI未付款JPYBudget；真Pricing與Rates雙向競爭、舊版本409/PT409、不同quote提交及同原requestReplay、兩端Snapshot/列表/明細/統計、Actual/Origin/歷史逐欄保護已通過。不可重送未知COMMIT，不以service_role代替普通權限。本輪曾遇Runner重複點已選列而取消選取，先Pause後只修Runner選取判斷；原失敗保留，沒有放寬金額/分攤斷言或重送金融mutation。
5. 新未付款Budget已正常Lifecycle刪除，trip保持合法新quote、主planningBaseline正常更新；另一QAtripRates/Baseline完整不變。已付款/Source/歷史/audit/requests依Guard保留，不用SQL/AuthAdmin強清、不把Baseline倒轉。最終Pause讀回七OFF/latches/readiness；普通JWT全域logout、真refresh-token拒絕、獨立auth.sessions/refresh讀回0；停止Worker(本輪無)/Browser/Vite/助手，原生CIM/TCP與已知PID確認退出。現在程序盤點對不可讀CommandLine的Node/Chrome一律Blocked，不能宣稱已退出或任意停止未知程序。
6. **下一步是Production規劃，不是授權部署。** 原既有Production差異來源表仍僅條件式清單。另取明確Production授權後才能讀其即時ledger/catalog/權限/資料、訂安全backup/restore及精確target-bound forward原子封包、相容前端預設OFF/最小Worker/legacy停發與失效/Activation順序。失敗保留財務與latches，Pause後先獨立讀回未知提交，再走經Review的Forward Repair。不得直接複製Staging65筆、db push --include-all、重播Dormant/Hotfix、schema down、main合併或正式發布。

下列各 dated checkpoint 與較舊剩餘門檻保留其原始證據；本節與最新矩陣優先，不把舊失敗/Blocked歷史抹除。

2026-10-31最新授權：可連續Staging測試／必要修正／有證據的受控Activation，不需每項停Review；唯一uyqdopksfysbobhjcepk。Production、main、Vercel及Docker／WSL不在授權內。舊Runbook的「本輪只可本機」與逐階段Review是歷史界線，本次授權優先；其資料保護／readiness／Pause安全規則仍完整保留。

[最新真服務結果](../2026-11-01-budget-b7-real-service-acceptance.md)、[先前本機結果](../2026-10-31-budget-b7-closeout.md)、[去敏64筆來源與矩陣](../qa/2026-10-31-budget-b7-closeout-results.json)、[原Activation/Pause/Forward Repair程序](../2026-10-30-budget-b7-rollout-runbook.md)。本文件不把下列未跑步驟當成Passed。

## 安全供應與實際執行前條件

1. 可信操作者簽發Staging專用短效JWT：role=budget_receipt_worker、ref=uyqdopksfysbobhjcepk、iss=https://uyqdopksfysbobhjcepk.supabase.co/auth/v1、iat/exp（最多15分鐘）。原signing key留可信端，JWT透過process environment注入，不貼聊天、不寫CLI參數／Git／report。現有service_role只可QA Auth／membership初始化，不代替Worker或普通使用者權限驗收。需要存取API／signing key來源時，先取得精確授權；2026-11-01精確授權及native手動啟動已完成；助手已真READY並完成本次HTTP／Worker後停止。見[真服務證據](../2026-11-01-budget-b7-real-service-acceptance.md)；[舊啟動助手](../2026-11-01-budget-b7-memory-credential-handoff.md)保留為歷史/下次安全供應方式，不重複索取同一份授權。
2. 新鮮獨立唯讀連線比對project／實際身分／64筆ledger／38final與兩個Guard afterhash、原28資料、完整RLS／ACL／Worker／Storage policies。不可僅靠target GUC。無不明writer／有效租約，保留既有QA Baseline。DB管理憑證只用安全輸入，不重設密碼或擴權。
3. QA manifest記錄此次精確trip／Actual／object IDs（Git外）；核對原始資料未變、所有非本次scope的pending intents／cleanup皆0，排除其他測試writer。否則不跑global sweep。重啟可保留本次scope內durable jobs，不能把它們標成不存在。
4. Worker有限adapter為scripts/qa/run-b7-staging-worker.mjs，舊maintenance CLI仍loopback-only。注入STAGING_RECEIPT_WORKER_JWT、STAGING_PUBLIC_API_KEY、STAGING_RECEIPT_QA_SCOPE，再以--authorized-staging-qa執行。scope為project/tripIds/actualIds/preflightAt/livePreflight.originalDataUnchanged=true/livePreflight.noUnscopedReceiptJobs=true；每項必須由真唯讀結果支持，不能手填true冒充驗證。結果只留hash/count，不保存token。未供應憑證不啟動。

## 無循環的驗收先後

先完成既有Protocol OFF下的Auth/RLS/Realtime、Private bucket一般QA路徑MIME／small bytes／Signed URL／超10MiB的真HTTP。每個request記錄DNS/TLS／100Continue／body-send／response階段及bytes計數，區分body沒送完和後端拒絕；停止重複12秒失敗，不能只提高Timeout或用Catalog當HTTP413。

Worker的啟用前證據必須是可信token通過真PostgREST與Storage exact-header／object-ID權限，以及受控QA canary的實際claim/bytes驗證／delete/retry/restart兩輪；queue fixture與content證據要明標管理初始化對比真HTTP，不得把SQL metadata fixture本身當作Storage成功。沒有合法canary的操作來源就保持Blocked，不能靠偽造Receipt intent／驗證時間／虛構hash解鎖。完整使用者Receipt Begin／Commit／Replace與參照競爭屬啟用後驗收，不是空兩輪的結果。2026-11-01canary已實測：管理員只seed未驗證平台jobs，真普通JWTbytes、專用Worker/HTTP驗證及清理分開記錄；8+2有限排程、程序重啟、retry/lease與引用保護已通過。它仍不代表使用者Receipt Begin/Commit。Legacy授權耗盡未證實，readiness保持false。

所有前置平台能力都真實通過後，封存證據SHA，依原Runbook記錄真storage/content/cleanup驗證與實際legacy upload grant耗盡時間；不能猜測最長TTL。鎖七protocol、排空全部lease及在途財務transaction，以budget-b7-activate.sql原子開啟，不刪租約或改Guard。隨即用新連線Readback，再以Staging-only本機frontend（--mode staging及該process五個flags）執行完整E2E。原始repo defaults保持OFF，禁止連到Production frontend／API。

合法Incomplete Hosted順序：普通JWT create_budget_workspace_placeholder → 留Title空白 → Pricing群組acquire／patch合法amount/participants → release。核對record_status=incomplete／pricing_ready=true及實際child row存在，再以同一JWT測INSERT／UPDATE現存row／DELETE現存row均55000且每次整圖不變。Budget與Actual都驗。這能避免用空集合DML或私有effect/GUC假造Guard通過；在Lifecycle OFF時不能跑，不先改原始資料狀態。

## 真實Browser與Receipt完整E2E

兩個真帳號、至少三個獨立Browser context加同帳號雙tab；用實際Auth核對session_id，禁止Mock route或service-role acceptance。至少包含：不同群組同時成功／同組競爭及接管；Title/Note/Category/Payer/Links → Pricing/Participants → Payment → retained Actual → Source/Receipt；統一匯率與歷史成本/Baseline不重算；五步Undo與peer修改；Presence、首次CDC readiness/重連/背景分頁；unknown ACK原request replay及Snapshot延遲；新增／刪除與active editor；撤權／登出／切trip／late response；v1～v10和舊Save/raw DML/wildcard隔離；Modal/Portal/IME/原生Ctrl+Z/桌面及窄版基本可用性。

Receipt實測小合法檔SHA256/size/MIME/actual bytes/object UUID、Private bucket、Signed URL TTL/快取、Begin→upload→trusted verifier→Commit→Replace→Delete。負向含wrong hash/size/type、wrong/missing/cross-job headers、expired JWT/claim、並發object-ID變化與仍引用保護、pending/abandon/orphan、timeout/finish ACK loss、process重啟與至少兩輪真排程。以實際journal／HTTP／DB讀回封存，不能只看UI成功。

任何P0/P1立即停止啟用或新寫入，依budget-b7-pause.sql與獨立Readback安全Pause；保留activated latch、成功request/歷史、Baseline、Guard、bytes，不破壞性回滾或回退whole-form Save。未知COMMIT先讀回不重送。必要修正另建官方版本Forward，不能改已提交Migration或放寬測試。

## QA保留與停止

Activation使Parent guard成為永久安全邊界，Pause不還原Dormant。Lifecycle可清理獨立QA financial graph，但trip/Baseline/audit相依可能必須保留；manifest記錄保留原因、關聯及hash。不得用Auth Admin Cascade、停trigger、SQL強清或重設latch。測後logout測試sessions、移除一次性credential材料、停止有限worker/本機server；依最終實測決定維持Activation或安全Pause，未完成E2E不可當GO。

## Production精確依賴來源（條件式清單，非可執行封包）

Staging已安裝的基線47筆之外，後續17個來源如下。Production未在本輪讀取，不能假定也為47／64、已有Timeline或擁有相同role權限；已安裝者精確核對source/catalog，不重播。Production另需新的target-bound wrapper、實際保護指紋與安全備份/restore，不可直接用Staging封包／資料Hash。

| 順序 | 來源 | LF-normalized SHA-256 |
| --- | --- | --- |
| 1 | 20260811150000_atomic_apply_itinerary_alternative.sql | 6ff73aabacc0013535e73b554a0c50e7e313e5df1fe7562ceca8876df47517b8 |
| 2 | 20261029020551_budget_group_metadata_prototype.sql | 686017abab6daf966fccf15f9f231f91a58f5d4747526daff23b16453f0cdee6 |
| 3 | 20261029031137_budget_metadata_snapshot_signals.sql | b7561c3d3cbd89988abebfdf0a526092eb0d65c465dabe45d7cb7eea58d815f1 |
| 4 | 20261029091435_budget_metadata_undo_prototype.sql | fed54f64ecb3d9588e7df2c074888c02b60c7a68423cb02e86ea42f8d67cb1fd |
| 5 | 20261029114817_budget_category_payer_links_groups.sql | 08c7c9e813d6014fb8ce4fd039e4cd39f9152f0832086609e715d3d1cd591262 |
| 6 | 20261029123907_budget_pricing_participant_groups.sql | 657c0cacddcea3b70d82a2a8c6c81e52124aeab2d45c39b89d60bb3ef2d2803d |
| 7 | 20261029134206_budget_payment_lifecycle_groups.sql | 3387c31f5e4c4bbfd12ddcbc26ff62e23b534de8132a42265d5311de0d8ffaa3 |
| 8 | 20261030012554_budget_payment_minimal_bundle.sql | 7df467d8e04daedbefda589dee0c1c2cc1e09ec328c37463b640c4e02c07b011 |
| 9 | 20261030021719_budget_source_atomic_groups.sql | c9f7db07d72ad627958316a293fdb0d82e284048bee35f3dd6b57cae8a59ea2c |
| 10 | 20261030034351_budget_receipts_lifecycle.sql | 68051b3e1253617a062a863e475fb22a01401f98845a28a3720edaa6dc253a80 |
| 11 | 20261030054628_budget_financial_dependencies.sql | 6e7f04fed391137e775bff888b078e68ced76869d6adc9e302c2a8ff4ee4da55 |
| 12 | 20261030064703_budget_workspace_lifecycle.sql | 090d1fb6faeeb64e60b2927b9cf1d7418f7f3541539d9fee44aa45cba9cc0cea |
| 13 | 20261030082712_budget_workspace_undo.sql | b8fe1488d9c69057e4699b903ba762c1f3622b3d1c75eb5789e1181643055e27 |
| 14 | 20261031083437_budget_managed_worker_role_path.sql | 4a4b50f012c356120a11286d881fef3a268ca97bc23aa05f37aa4b0f122cc08e |
| 15 | 20261031130000_budget_business_conflicts_forward.sql | f3b79c74f5c79737ccb17dc89d296cdab3afb8c5c5e115ae32195bb299f6bbb3 |
| 16 | 20261031130414_budget_dormant_parent_cascade_guard.sql | 19f9c1e6184560052b4a62f4b810573198a225b98e0f80b67b874ad869e4cb22 |
| 17 | 20261031140648_budget_trip_cascade_lease_admission.sql | a221d3911b285d5ae729ca7db6fd6c2b15094dced600ee38b52eabebb7de069b |

PT409 20261031003000先前已在Production安裝，仍需未來唯讀核對來源與13函式，不能重播當成最終Forward。20261030125028舊原文保留，M0 20261031083437是Staging已接受的Managed替代；不能db push --include-all或空補舊ledger。31筆歷史source缺失仍需必要catalog依賴查核；20260819125851一個額外LF差異保留兩個Hash，不重新封存。

完整Staging E2E通過、安全Advisor/權限/資料一致、正式backup/restore及Production baseline查核後，才準備精確main合併範圍與相容frontend/schema/Worker發布次序，提正式授權；本輪不操作Production、不合併main。現在NO-GO，不建立會被自動套用的Production Migration／排程。

官方核對入口：[Storage Custom Roles](https://supabase.com/docs/guides/storage/schema/custom-roles)、[JWT Signing Keys](https://supabase.com/docs/guides/auth/signing-keys)、[Supabase Changelog](https://supabase.com/changelog)。本輪markdown Changelog端點不支援，使用官方HTML index；未因查文件升級服務／套件或讀取簽章秘密。文件支援設計查核，不代替本專案真實HTTP／JWT／headers結果。

## 2026-11-01 實際平台驗收與剩餘安全門檻

[完整矩陣](../qa/2026-11-01-budget-b7-real-service-results.json)。3個新QA旅程/1Actual/8Storage物件均正常清理，3個新Baseline由正常Trip Cascade刪除。保留3aborted intents、6done cleanup及3sync signals，不停Guard或強清稽核；舊QA Baseline、帳號及原28投影不變。最後Ledger64、38seals、七OFF、三readinessfalse、legacyNULL。記憶體助手stopped；沒有常駐Worker或排程。

測試工具保留在scripts/qa/b7-staging-service-checks.mjs、b7-staging-platform-worker-checks.mjs及child、prepare-b7-platform-canary-sql.mjs、prepare-b7-reference-canary-sql.mjs、b7-staging-large-storage-check.mjs及recover。透過既有memory operator的Git忽略module wrapper呼叫；不能直接把來源當Migration執行。SQL準備器只讀Git外qa-state manifest、產出未執行SQL；每次必須先獨立核對原資料、exactQA graph、無unscoped jobs、realobjectsize/type，fixture建立仍需管理初始化。其job signature標記platform-only/not-user-receipt，不seedverified_at/readiness；不碰Storage metadata/bytes。先核對結果id與ready才可送下一命令，不能重送未知提交。原始8輪診斷與後來封裝後2輪證據分開留存，不聲稱封裝後Source SHA就是先前診斷逐byte版本。

超限standard/multipart12s回應檢查維持Blocked；Managed backend EntityTooLarge和TUS413是另外證據。合法9MiB ACK逾時先唯讀確認commit，沒有重傳，ordinaryJWT完整GET200/9437269bytes/SHA相符再正常刪除。不可將平台ACK恢復當成尚未Activation的Receipt Controller E2E。

Legacy安全門檻不可由「沒有物件」推導。建立所有Staging簽發端可稽核停止點；盤點signed-upload/TUS/S3及其實際TTL/未完成upload；官方SDK signed-upload2h、TUS最多24h只是已確認通道上限，不是本專案已耗盡證據。Managed日誌有延遲且沒有權威未過期grant清單，本次不填猜測expiry。若現有Guard不能在Activation前阻止新legacy簽發，先做最小Forward設計與隔離驗證；不可先填now-1s、改歷史或以keyrotation/刪資料取巧。簽發停止/排空條件未成立就保持NO-GO，既有Staging授權不需重問。

PostgREST官方允許exp30秒clock skew；JWT負向測試在真正exp+30s後仍嚴格要求401/PGRST303，不改簽章/時鐘/延長request timeout。Worker自身預先45s停止使用接近到期token；不要把宣告TTL與平台skew混為同一個時間。

## 2026-11-01 Legacy cutover／受控 E2E後的現況（優先於上方歷史checkpoint）

[本輪報告與剩餘矩陣](../2026-11-01-budget-b7-legacy-cutover-and-e2e.md)、[去敏實測證據](../qa/2026-11-01-budget-b7-cutover-e2e-results.json)、[已安裝Forward／操作規則](budget-b7-legacy-cutover/README.md)。Staging已從64→65；20261101032853已安裝一次，不再執行舊Dormant、Hotfix或此Forward。

前表增量17個來源之後，第18個為`20261101032853_budget_receipt_legacy_cutover.sql`，完整LF Source SHA-256 `b5032314b31678ae6ae922f6aa648e7a7108e5ce77bd09a7a9b5aef7d3ed85b6`；原子wrapper SHA-256 `8e98cc69539afe0c0a0887a66c3c7f4d4af4e3f28f59500d4aab8adba55ac393`。它存於非自動套用目錄，官方CLI產版及原始before/after封存。Source更新3個private Guard、加入5個owner-only helper及append-only private journal；沒有重放舊PT409，也沒有改38business seals或歷史Migration來源。

Production所需的是**依實際Production ledger／catalog產出的精確來源差異與專用封包**，不是把Staging的47＋18＝65當Production預期。先前未安裝的20261030125028仍不可冒充已安裝，M0實際來源為20261031083437；F0必須位於後續覆蓋函式之後，不可重播舊Hotfix替代。前表31筆缺完整Source與Timeline LF差異仍需遵守既有依賴查核。Production本輪完全未讀寫，保留NO-GO。

Staging cutover真實停止03:57Z，oldURLkey在使用者操作後真正Revoked，04:07Z以未過期能力的HTTP拒絕及完整bytes證據建立invalidation journal。`legacy_grants_expire_at`一直NULL；不能把key撤銷改寫為自然expiry。只有journal滿足exhausted及真實Storage／專用Worker證據後才曾受控Activation。舊key不可在Pause期間恢復Standby，否則可能重新接受舊高權限上傳能力。

兩個本輪前端P1在真實競爭中發現並安全Pause：BUG-031明確首次PT409導致無epoch token阻塞discard；BUG-032 Snapshot/admission排序缺陷。修正、red/green、直接相依回歸及真Staging對應案例已記錄。Resume只重新開啟同一QA協定，不重填readiness或重設latch，不把新E2E readiness預設Passed。一次臨時Resume wrapper解析拒絕已獨立證明無COMMIT，修正本機JS dollar替換後仍保留所有Lock／Timeout及原子檢查；封存Migration不變。

**目前維持 Pause。最新驗收為2026-11-02（台灣）**：[最終 E2E 報告](../2026-11-02-budget-b7-final-e2e-followup.md)、[去敏矩陣](../qa/2026-11-02-budget-b7-final-e2e-results.json)。先前12:56Z停機／pending membership記錄見舊報告；它們已由本輪實測收尾取代，不能再當目前未恢復狀態。

- 最後 Protocol16:38:22Z：七OFF、Undo fullOFF、三activated latches TRUE、三既有readiness保留、Ledger65、pending／cleanup／missingReceipt0。
- 最後保護16:39:46Z：原28投影／38seals／Guard／Worker／Storage／Realtime投影不變。Auth sessions與有效refresh tokens已由普通JWT登出及獨立讀回證明0；16:40Z後真正原生CIM／TCP證明helper／QA Chrome／Vite及5188／5189均退出。
- QA主圖1trip／4budgets／4Actual／1itinerary／1planning Baseline；有付款歷史的新外幣圖保留，未付款contender正常刪除；本次Receipt metadata與objects歸零，原控制檔不動。舊QA旅程自動匯率初始化刷新其2099 planning Baseline，沒有raw before Hash，不宣稱其整筆不變。原始受保護歷史Baseline仍匹配。
- 新真服務範圍包括實際hidden／visible草稿、撤權／切旅程／登出與原樣晚到回應隔離、真Auth新Session／UI reload、外幣付款與版本PT409、雙帳號Receipt replace／新舊Object ID／限定Browser斷網後專用Worker清理恢復。以前已通過的Auth／Storage／Worker平台suite及未受影響案例沒有重跑。

### 剩餘門檻與下一次測試前條件

1. **真 changed-rate repricing 仍 Blocked。** 實際外部quote相同時，SQL合法回傳no-op／空targets，不能要求它與Pricing互斥或據此宣稱重新計價安全。保留失敗前提，先確定合法且真實的不同報價來源／測試時間，再只補受影響競爭與歷史成本驗收；禁止偽造quote、expiry或readiness。
2. 下一次切旅程QA先讀回兩個目的地的既有rates與Baseline指紋。缺少rates可能觸發產品正常初始化，不能假設只瀏覽UI就零寫入；不可再次以未封存的舊QA Baseline作無變更保護目標。使用新隔離可保留graph或先完成Review的明確fixture保護計畫，禁止強制SQL恢復未知Baseline。
3. 原schema／來源／Flag預設不變。若需再次Resume：重新確認指定project、Ledger65、38seals、原28投影、權限、七OFF及0不明交易／有效租約／unscoped Receipt job；readiness只能檢查既有真實證據，不重填為true。用原子Activation／Pause腳本，保留latches／request history／bytes；P0或P1立即Pause並獨立讀回。
4. 延遲回應使用scripts/qa/b7-real-response-gate.mjs：navigation只等commit，fetch／hold／delivery／cancel都有deadline；先release或abort，再unroute。只轉送route.fetch取得的真回應，取消的回應不能算實際delivered-late案例。原生Chrome visibility需先證明真正incognito與hidden／visible，不以DOM事件或focus emulation代替。
5. QA server用scripts/qa/b7-staging-vite.mjs排除scratch profile監看；真Session bootstrap每context只做一次，不能reload後偷偷登入。Master secrets仍僅RAM；Worker JWT最多15分鐘、專用role，不能用service_role代替。RAM timer不會自動Pause DB，須在期限前獨立Pause；無法安排期限前收尾時不可Resume。新自動expiry logout hook沒有另等完整期限重測；結案必須仍有普通logout、Auth獨立讀回與真正原生程序證據，不能只相信status.json。
6. 正常UI／Lifecycle／Storage清理之後核對關聯、bytes與持久queue；有Baseline／Source Origin／付款歷史／audit依賴則保留，不走Auth Admin Cascade或SQL強刪。最後Pause、登出兩個QA帳號、獨立讀回Session0、停止有限Worker／Browser／Vite／RAM operator，再原生CIM／TCP核對全部退出。原生程序腳本只辨識本專案精確程序與profile，未知Chrome保留並Blocked，禁止任意kill其他Node／Chrome。

### 正式發布準備與回復

目前只能交付待Review的feature branch，不能建立「可直接正式執行」的Staging複製封包。QA恢復及tool shutdown已完成；仍有changed-rate實測與fixture界線待Review，因此main合併／正式部署皆NO-GO。後續需要另外明確Production授權：唯讀baseline/依賴/權限與成本保護核對、必要真實備份及隔離還原、Production-bound最小Forward／原子wrapper、Stage已過版本的前端與Worker部署、最後人工決策Activation。worker專用JWT與排程必須最小權限，不能以service_role替代。

執行順序為schema dormant→獨立readback→前端預設OFF相容版本→可信Worker驗證／有界排程與readiness真證據→停止legacy簽發與真失效→原子受控Activation→真實smoke；每一步仍須新的Production範圍授權。本輪未做其中任何Production操作。失敗優先Pause停止新操作，保留request/ledger/history/bytes與latches；未知COMMIT先新唯讀連線判定，不能重送整包；只做經審查的Forward Repair，禁止破壞性schema down、舊snapshot覆蓋財務或重置activated latch。
