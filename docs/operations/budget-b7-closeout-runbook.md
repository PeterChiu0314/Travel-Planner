# Budget B-7｜連續 Staging 驗收與 Production 準備

2026-10-31最新授權：可連續Staging測試／必要修正／有證據的受控Activation，不需每項停Review；唯一uyqdopksfysbobhjcepk。Production、main、Vercel及Docker／WSL不在授權內。舊Runbook的「本輪只可本機」與逐階段Review是歷史界線，本次授權優先；其資料保護／readiness／Pause安全規則仍完整保留。

[本輪結果](../2026-10-31-budget-b7-closeout.md)、[去敏64筆來源與矩陣](../qa/2026-10-31-budget-b7-closeout-results.json)、[原Activation/Pause/Forward Repair程序](../2026-10-30-budget-b7-rollout-runbook.md)。本文件不把下列未跑步驟當成Passed。

## 安全供應與實際執行前條件

1. 可信操作者簽發Staging專用短效JWT：role=budget_receipt_worker、ref=uyqdopksfysbobhjcepk、iss=https://uyqdopksfysbobhjcepk.supabase.co/auth/v1、iat/exp（最多15分鐘）。原signing key留可信端，JWT透過process environment注入，不貼聊天、不寫CLI參數／Git／report。現有service_role只可QA Auth／membership初始化，不代替Worker或普通使用者權限驗收。需要存取API／signing key來源時，先取得精確授權；本輪自動審查拒絕仍有效。
2. 新鮮獨立唯讀連線比對project／實際身分／64筆ledger／38final與兩個Guard afterhash、原28資料、完整RLS／ACL／Worker／Storage policies。不可僅靠target GUC。無不明writer／有效租約，保留既有QA Baseline。DB管理憑證只用安全輸入，不重設密碼或擴權。
3. QA manifest記錄此次精確trip／Actual／object IDs（Git外）；核對原始資料未變、所有非本次scope的pending intents／cleanup皆0，排除其他測試writer。否則不跑global sweep。重啟可保留本次scope內durable jobs，不能把它們標成不存在。
4. Worker有限adapter為scripts/qa/run-b7-staging-worker.mjs，舊maintenance CLI仍loopback-only。注入STAGING_RECEIPT_WORKER_JWT、STAGING_PUBLIC_API_KEY、STAGING_RECEIPT_QA_SCOPE，再以--authorized-staging-qa執行。scope為project/tripIds/actualIds/preflightAt/livePreflight.originalDataUnchanged=true/livePreflight.noUnscopedReceiptJobs=true；每項必須由真唯讀結果支持，不能手填true冒充驗證。結果只留hash/count，不保存token。未供應憑證不啟動。

## 無循環的驗收先後

先完成既有Protocol OFF下的Auth/RLS/Realtime、Private bucket一般QA路徑MIME／small bytes／Signed URL／超10MiB的真HTTP。每個request記錄DNS/TLS／100Continue／body-send／response階段及bytes計數，區分body沒送完和後端拒絕；停止重複12秒失敗，不能只提高Timeout或用Catalog當HTTP413。

Worker的啟用前證據必須是可信token通過真PostgREST與Storage exact-header／object-ID權限，以及受控QA canary的實際claim/bytes驗證／delete/retry/restart兩輪；queue fixture與content證據要明標管理初始化對比真HTTP，不得把SQL metadata fixture本身當作Storage成功。沒有合法canary的操作來源就保持Blocked，不能靠偽造Receipt intent／驗證時間／虛構hash解鎖。完整使用者Receipt Begin／Commit／Replace與參照競爭屬啟用後驗收，不是空兩輪的結果。當前canary尚未執行，readiness保持false。

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
