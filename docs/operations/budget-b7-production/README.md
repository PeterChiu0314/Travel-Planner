# B-7 Production 部署／操作 Runbook

**2026-11-03 execution update:** [Production deployment report](../../2026-11-03-budget-b7-production-deployment.md) supersedes the planning-only status below. User explicitly waived backup/restore and authorized budget-only test-data clearing. The [sealed transaction](candidate/packet-manifest.json) COMMITTED48→65; seven protocols/latches/readiness remainFALSE. NEVER replay its reset. Compatible frontend source85a7209 / deploymentdpl_2AwcVUpbqvENCEFQG2UvVaRrNo1j is Production READY; five enable flags absent/OFF, receipt-disable flagTRUE, anonymous release smoke passed. Main unchanged.

**Receipts now deferred by user.** Full-seven Activation instructions below are historical, not a command to force Worker/readiness on. [Non-auto deferred-Receipt candidate and six-protocol plan](../drafts/budget-receipts-deferred/README.md) passed10 native SQL/RLS checks only, remains uninstalled and lacks an operational managed wrapper/Activation/Pause plus real Production JWT smoke. Install/activate nothing until those controls and a new masked native session exist. Future receipt activation still needs real Worker runtime/renewal and Production legacy cutoff; RAM-only signing does not authorize hosted secrets. Old native helpers actually exited, stale read job quarantined, no operator action tonight. No destructive schema rollback or latch reset.

## Historical planning contract (2026-11-02; superseded only where stated)

2026-11-02。唯一 Production target：`lqvuqamzmchepgxkftcw`。**本文件不是部署授權，沒有可執行的 Production migration wrapper。現在 NO-GO。** 本輪只執行 `BEGIN ... READ ONLY` 的 SELECT 與本機文件工作；不安裝 schema、不合併 main、不發布／Promotion、不啟用任何旗標／Worker。

[盤點報告](../../2026-11-02-budget-b7-production-predeployment-plan.md)、[來源／差異 manifest](migration-plan.json)、[去敏證據](../../qa/2026-11-02-budget-b7-production-preflight-results.json)。Staging core acceptance GO 帶原 P2 限制，不等同 Production readiness。

## A. 身分、來源與維護切點

1. 維護前重新唯讀確認 project URL／Dashboard header／API hostname；真正部署必須另驗原生 psql 的 Direct 或 Session Pooler5432、project-bound login、Database、Role、`sslmode=verify-full`。不能只靠 GUC 或 `current_database()='postgres'` 證明 project。禁止 Transaction Pooler、SQL Editor 分段、用 Stage 憑證代替正式連線、讀 Browser session token。現在沒有驗證 Production psql 憑證。
2. 執行 [catalog-readonly.sql](catalog-readonly.sql)、[data-health-readonly.sql](data-health-readonly.sql)、[legacy-preservation-readonly.sql](legacy-preservation-readonly.sql)、[全部現存25個public/private關聯投影](public-preservation-readonly.sql)。核對48筆／Head20261031003000、17來源全未安裝、T0及正式import版本仍存在、38個未來目標與現況差異、13 Hotfix 的12 exact＋1已辨識排版差異、RLS／ACL／Trigger／Managed grant path。只讀權限 metadata 不證明尚未執行的強鎖／Supautils DDL 必成功。
3. 現有48 Ledger 原文一律保留。34筆拆分 statements 可封存 joined hash，不能冒充原始完整檔案 hash；2筆 NULL 不補假原文。Production import20260819134935與Stage20260819125851有相同完整LF來源與現存body，保留正式版號、不重播別名。T0已在Production，不重播。舊Hotfix與未安裝20261030125028均不加入待部署列表。

   [ledger-preservation-readonly.sql](ledger-preservation-readonly.sql)另外凍結48個原版本並對完整原row做DB端raw SHA，連CRLF／NULL差異也保護；不得僅比較LF-normalized Hash來放行舊Source改寫。部署後只允許額外17rows，原48 raw-row seals必須相同。
4. 原始資料 seal 必須在實際批准的維護切點重取。若與本輪值有差異，先區分可核對的正常業務變更、Catalog／來源 drift，不得自動重封以通過。停止不明 writer、排空有效租約與在途財務 transaction；不刪租約、不停止他人 backend、不新增擋寫 RLS。不能建立可靠短維護窗就停。
5. 先完成下節備份／還原與 Production baseline 封包演練。Source manifest 現在只記錄真實來源，**沒有核准格式差異 allowlist／DDL 執行器**。12/13 raw seal 不等於全過；另審正式環境已讀到的排版差異原文、保留原 Stage seal，通過 Review 後才建立新的、Production 專用 before 契約。

6. 執行[Legacy形狀只讀查核](legacy-shape-readonly.sql)。目前7Budget／2Actual無payer、6trips無rates：先在正式備份還原副本證明新Snapshot／Payer／Pricing／Payment／Source及Lifecycle完整性／恢復相容；不將NULL payer直接判為壞資料、不自動補QA付款人、不重算Actual。發布前先封存所有目的旅程Rates/Baseline，第一個新前端smoke只開新隔離QA trip；瀏覽缺rates原旅程可能合法初始化並刷新futureBaseline，不能假裝是純讀。此項未驗證即保持P1 Blocked。

## B. 備份、保護與隔離還原（必須另授權後執行）

正式為 Free／Nano，Dashboard 明確無 scheduled backups；沒有 PITR 可依賴。Staging 可拋棄資料的備份豁免**不適用 Production**。本輪未匯出、未還原，P0 release gate 尚未通過。

- 先指定 Git 外、受 ACL／磁碟加密保護的獨立目的地，核對空間、可寫性及清單。不得沿用先前 Docker 的 F 槽授權自行存正式個資；不得寫入 repository／雲端分享。正式17MB級DB只是估計規模，空間需涵蓋 archive、檢視／解壓、第二複本及未來 Storage bytes。
- 供應 Production 專用安全原生連線，使用 PostgreSQL17工具；先核對 `pg_dump --version`／`pg_restore --version`／`--help`。TLS verify-full、受保護 service/passfile 或遮蔽 RAM 輸入；不把含密碼 URI／環境內容寫入CLI／日誌。**不啟動 Docker／WSL**，不用目前依賴 Docker 的 Supabase CLI dump 範例直接繞過限制。
- 建議 native `pg_dump --format=custom` 的單一一致性 snapshot，覆蓋 public、app_private、auth、storage metadata、supabase_migrations、sequences／constraints／RLS／policies／triggers／functions。先核對角色對每個必要表的 SELECT／dump 能力，不能成功取得public就宣稱完整。角色／membership／ACL另外盤點；如用 `pg_dumpall --roles-only --no-role-passwords`，先由官方help確認、只取無角色密碼部分，與schema restore計畫分開。
- Auth匯出含敏感身分與密碼hash／session，須最小存取、加密與到期保留；不輸出原始值。OAuth provider、redirect、JWT簽發金鑰、API key與執行排程等平台設定不保證包含於DB dump；另列安全設定／secret-manager還原需求，不把signing secret放進一般報告。沒有這些資料時只聲稱DB可還原，不稱完整Supabase環境復原。
- Supabase DB backup 不含 Storage bytes。於同一維護切點列出 object-ID／path／size／MIME／SHA-256清單並經HTTP取得必要bytes；目前objects0仍需重新確認並留下空清單證據，不代表沒有尚存的上傳授權。不要只備份 Signed URL。對archive／metadata／每個檔案計算SHA-256並驗第二份複本；Hash只證明位元完整，還原才證明可用。
- 建立全新 loopback 原生PG17隔離目標，停外部webhook／出站網路、排程及寄信，不能讓還原出的正式session被使用。先 `pg_restore --list` 與離線檢視；以 `--single-transaction --exit-on-error` 還原至**明確隔離DB**。Managed角色／extensions／owners需有審閱過的本機對應，原dump保留，不能刪掉失敗SQL或停Guard偽造成功；`--no-owner`若使用，Owner差異必單列，不能冒稱權限還原等價。
- 核對全部必要表筆數／原ID／FK／分攤／付款歷史／Origin／完整Baseline payload／Receipt metadata、舊48Ledger內容與財務Hash。測還原副本上的baseline→17來源原子安裝、故障注入ROLLBACK、F0最終38Hash／54PT409＋24PT500／未知custom40001拒絕與Managed權限差異。原生PG不能證明正式Auth／Realtime／Storage服務已復原，另列Managed服務驗證範圍。
- 記錄實際備份、還原、資料／服務驗證耗時。擬議短維護窗RPO0（schema-only提交前無業務寫入）、RTO30分鐘是**待演練目標，非保證**；財務提交後不能以舊備份覆蓋正式資料達成這個目標。失敗診斷用副本，線上採Forward Repair。

官方依據：[Supabase備份及Storage限制](https://supabase.com/docs/guides/platform/backups)、[Managed還原自訂Auth／Storage物件](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)、[pg_dump17](https://www.postgresql.org/docs/17/app-pgdump.html)、[pg_restore17](https://www.postgresql.org/docs/17/app-pgrestore.html)。不採官方範例中的停trigger／重設密碼等步驟去修改正式環境。

## C. 精確17來源與未來原子封包

順序與每一完整LF SHA見[migration-plan.json](migration-plan.json)；從 metadata prototype20261029020551 → signals → metadataUndo → Category/Payer/Links → Pricing → Payment → minimalBundle → Source → Receipt → Finance → Lifecycle → fullUndo → **M0 20261031083437** → **F0 20261031130000** → Cascade20261031130414 → Trip admission20261031140648 → Legacy cutover20261101032853。

這是「Hotfix已先安裝、B-7之後補入」的真實 out-of-order 順序；不執行 `db push --include-all`、`migration repair`、空補版本或重跑Hotfix。正式採M0替代未安裝原20261030125028須另外明確核准。

未來builder須從不可變來源重新組合 **Production專用** packet：獨立Host／Login與target驗證、已審beforeHash／完整Catalog／原資料projection、同一Session、唯一最外層BEGIN／COMMIT、原強鎖與NOWAIT、建議lock_timeout3s／statement_timeout60s／有界整體維護時間、ON_ERROR_STOP=1，**不使用psql -1**。來源內已知top-level BEGIN／COMMIT只能由驗證過的builder處理，不可直接逐檔 `\i` 造成中途COMMIT；Ledger仍保存每份完整原文及Hash，不修改來源檔案。

17個schema來源、必要role／grants與17Ledger rows必須同一交易；任一guard／Hash／資料／權限失敗全Rollback。保護原financial欄位的投影列在readonly SQL中：新lifecycle欄位是已知增加，**不能因此放寬任何舊欄位、Source Origin、Payment History或Baseline payload**。舊公有金融資料DML counters應0；private metadata群組初始化是允許且單列的schema配套。End Ledger是正式48基線集合∪17，不是抄Stage65的版本集合。

COMMIT未知先新唯讀連線判定版本集合／來源／data seals，不重送。COMMIT後另一新連線用catalog／legacy projection及[readback-protocols.sql](readback-protocols.sql)讀回：65／Head20261101032853、17完整Source、38final／54PT409＋24PT500、兩次Cascade等必要Guard、原函式屬性、RLS／ACL／Trigger／新role最小權限／匿名拒絕。**Dormant時七OFF、三latches FALSE、readiness FALSE**；不能複製Stage目前TRUE狀態。先完成獨立驗收再離開schema維護窗。

## D. Database → Frontend → Worker → Legacy → Activation

| 階段 | 必要結果／停止門檻 |
| --- | --- |
| D0 Database dormant | 上節全部交易及獨立讀回；財務／Baseline projection保持；未知差異立即停。 |
| D1 Frontend相容版 | 審main範圍後另行核准合併；先以五旗標全部OFF的相容版發布。Vite env在build時固定，改env不會改既有artifact。前B7舊版不能當已activated後可寫入的rollback方案。 |
| D2 Worker準備／真Prod canary | 專用NOLOGIN／NOINHERIT／NOBYPASSRLS role、短效JWT≤15m、project／iss／claims／custom headers exact。真普通JWTStorage bytes與專用Worker權限驗證、claim／lease／retry／restart至少兩輪；不是service_role替代，也不是把Stage readiness抄true。QA graph先獨立授權，受Guard保護者保留。 |
| D3 Legacy cutover | 盤點所有正式signed-upload/TUS/S3／service-admin簽發端、真TTL及未完成upload；freeze journal、停止所有issuer、排空／真正失效證據。objects0不代表授權耗盡。若需正式Storage簽章key輪替／撤銷須另外授權且由使用者親自完成；不可恢復舊key或捏造expiry。 |
| D4 Activation | 只有正式自身Storage/content/cleanup／legacy耗盡證據齊全，無writer／lease／unknown request後，另核准readiness、protocol及frontend flags。原子Activation後，短維護窗Promotion已驗證的ON artifact；舊端／rawDML應fail-closed，不能放寬Guard讓舊端存整筆。 |
| D5 Smoke／觀察 | 下節通過才開放正常流量；P0/P1立刻安全Pause、停新worker claim並獨立讀回。不得從文件狀態推測功能已啟用。 |

**Worker承載尚未解決：** 現有 `run-b7-staging-worker.mjs` 是限定Staging的QA adapter，不能改ref充當Production服務。建議審核既有Managed scheduler＋小型Node／Function工作項，Vercel Functions/Cron須先核對本方案排程頻率／執行限制及費用；不假設Free/Hobby能每分鐘排程。新實作需可靠可信簽發／token renewal、到期前停止claim、secret manager、冪等／持久retry、health heartbeat與有界shutdown；不在前端放signing secret、不用長效service_role當worker。Runtime／簽發端／排程／IAM未Review即保持P1 Blocked，本輪沒有建立服務或簽發正式JWT。

## E. main／Vercel 發布控制

當前Production READY：`cab828d0cc2c62ba7eb29760aae692386565cfc5`／`main`，與新fetch的origin/main相符。已驗證產品候選起點a0a818d比main多40commits／333檔，其中41個src檔、14個supabase/migrations檔；package／lockfile與vercel.json沒有差異。本輪規劃文件另加，最終merge前必重新對完整HEAD列範圍、固定可審PR／commit與Stage驗收對應；不只挑最後幾個QA commit。

Vercel env metadata可見5個非Budget keys，hiddenProductionEnvCount0、五B7 flags均未設定，沒有解密secret。main部署記錄不能單獨證明未來automatic-domain-promotion開關；**其發布閘尚待驗證**，不能認為合main不會上線。正式授權須把main合併與Production promotion分開；如Git integration自動發布，需要先經授權建立人工Promotion閘或暫停自動alias，不可在本輪改設定。

建議依[官方 staged-production／promotion流程](https://vercel.com/docs/deployments/promoting-a-deployment)，用Production build context建立不配正式domain的候選、驗證實際DB endpoint及五OFF flags，再明確Promotion；不要把Preview直接promote等同驗過的Production bytes（可能重新build）。ON候選也是新的build，需另外驗證、固定artifact ID與endpoint／flags。任何CLI release、env改動、Git main merge或alias切換均需後續授權，本輪未執行。

## F. 雙帳號 Smoke、指標及停止

另授權後建立**兩個**具唯一QA標記的普通帳號、全新旅程及少量fixture；不使用原正式7用戶／7旅程作修改目標。先測B未加入時讀／寫拒絕，再由QA Owner正常核准為Editor；新旅程Rates／Baseline先封存。使用不同Auth Session及Browser contexts，主secret不進Browser。

必測最小鏈：新增Incomplete→非法Participant三種DML拒絕→不同群組並發成功／同組拒絕且草稿保留→Pricing／participants→真不同quote或明示no-op→paid／Actual／SourceOrigin→Receipt真bytes/SHA／replace→Undo與另一人變更→正常刪除無歷史fixture；reconnect／unknownACK以相同Request ID恢復。舊版RPC／rawDML在啟用後拒絕，無40001業務重試。付款與Baseline／audit graph不可為清理而強刪；無法正常清除保留並登記。測後普通JWT全域logout、獨立Session讀回、受控worker／browser資源退出。

觀測：建立正式維護前15分鐘低負載基準；smoke至少15分鐘、隨後30分鐘觀察（擬議，非已完成）。追蹤CPU／connections／long locks／rollback速率、Postgres40001/PT409/5xx、RPC p95/p99、Snapshot／Realtime延遲、group lease衝突、付款筆數／原請求重播、worker heartbeat／最舊pending/cleanup/retries／storage缺檔／Baseline變更。

停止條件：任何未授權資料／RLS／Hash drift、歷史成本重算、重複財務寫入、權限繞過、錯刪bytes、無限重試為P0/P1立刻Pause；任何未知COMMIT先獨立判定。建議CPU>80%持續5分鐘、5xx>1%或持續高於基準、鎖等待>5s、worker無heartbeat超過2輪／token過期無法renew、queue無法於兩輪收斂、Snapshot p95>5s等皆先停止新操作並分析；低流量需看實際件數，不能單靠百分比。這些是待Review門檻，不是本輪已跑負載結果。

## G. Pause／Forward Repair 與最小後續授權

- 尚未COMMIT：ON_ERROR_STOP斷線後整交易Rollback，重新唯讀核對48／baseline，不分段重跑。
- 已COMMIT但Dormant：保留schema與ledger，七OFF；不因frontend問題做schema down。若獨立讀回異常，保留證據、停止下一階段，提出精確Forward。
- 已Activation或已有新財務提交：只在另授權的正式Session執行已審Production-bound Pause（七enabled/fullUndo false），保留三不可逆latches、readiness真證據、requests／history／receipts。Pause不會讓舊版整筆Save重新變安全；前端保持相容版本並顯示唯讀／恢復入口。未完cleanup按claim／lease安全停，不能殺掉不明程序或刪queue。驗證七OFF再製作經Review的Forward Repair，不重設latches、不拿舊snapshot／backup覆蓋已提交財務。
- 需要的下一輪授權先分為：①安全備份目的地／最小正式連線與隔離還原；②版本安全公告／缺來源及格式差異Review、正式原子封包與還原副本演練；③僅Dormant17來源及必要roles/ledger的精確Hash部署；④相容前端main／Vercel發布；⑤Worker身份／runtime／canary／排程及QA資料；⑥所有legacy issuer停止／實際簽章失效及人工key操作；⑦正式readiness／Activation／ON artifact／smoke。**本輪沒有其中任何寫入授權。**

檢查表：backup+restore□／engine-security-review□／source-provenance+format-review□／Production packet+fault rollback□／psqlTLS+role+lock能力□／frontend auto-promotion閘□／Worker runtime+signer□／legacy-stop+exhaustion□／正式QA/服務證據□／逐階段明確授權□。未完成任一必需項即 NO-GO。
