# Budget B-7｜Production 唯讀盤點與部署規劃

日期2026-11-02／Asia/Taipei；`Z`與`+00:00`時間為UTC。起點 `a0a818df2fcb72557f73c80ddaf77dffe0059b00`，分支 `codex/budget-collaboration-redesign`。
Production `lqvuqamzmchepgxkftcw`；只將 `uyqdopksfysbobhjcepk` 作 Staging 對照。

**結論：盤點／規劃可送 ChatGPT Review；Production 實際部署、main合併、Worker／Activation 仍 NO-GO。** 本輪只有 read-only SQL、Dashboard觀測及Vercel只讀metadata，沒有正式DDL／DML／Ledger／角色／RLS／Auth／Storage／key／排程／旗標變更，沒有Production備份匯出或還原。

[完整 Runbook／備份／恢復／檢查表](operations/budget-b7-production/README.md)、[精確來源／Ledger／Hash差異](operations/budget-b7-production/migration-plan.json)、[去敏實測證據](qa/2026-11-02-budget-b7-production-preflight-results.json)。Staging既有驗收沒有重跑。

## 1. 即時狀態與健康

14:38Z Production Catalog：實際 `postgres`／DB `postgres`、`transaction_read_only=on`、PostgreSQL17.6；Dashboard URL／header及API hostname核對正式ref。這不是native psql身分驗證；未取得正式psql憑證，也未嘗試擷取Browser token。Supabase connector權限不足，改走已登入Dashboard正常只讀介面，沒有擴權。Vercel connector只讀metadata，沒有解密env。

| 範圍 | Production 實測 |
| --- | --- |
| Ledger | **48筆／Head20261031003000**；Staging65／Head20261101032853 |
| 資料 | 7 trips／7 users／12 memberships／123 itinerary items；17 budgets／29 budget participants；3 Actuals／7 Actual participants |
| 財務／Baseline | 3 retained Budget identities、3 Origin有值、1 active／2 inactive payments、4 history entries；4 Baselines均未到departure，0 frozen；原始金額／會員ID／title不公開 |
| Receipt／Storage | attachments0、objects0、缺檔metadata0；Private trip-attachments／10MiB／JPEG、PNG、WebP、PDF |
| 租約／協定 | 1 stored expired lease、active0；Production **七組B-7表不存在**，不是「七OFF」；Worker role不存在 |
| RLS／ACL | 公有普通表RLS全部ON、57 public policies；private legacy request ledger RLS目前false，但anon／authenticated均無直接SELECT／INSERT，M0會補RLS；Storage舊member/editor policies存在 |
| Managed能力 | postgres非superuser但CREATEROLE／schemaCREATE；Storage→authenticator SET既有路徑存在。表owner是Managed角色，ACL與必要表權限已盤點，**未試強鎖／DDL／Supautils角色建立** |
| 健康 | Dashboard Healthy，CPU2%／Disk17%／RAM47%／6of60 connections；可見21:43–22:43近一小時Postgres errors0，低流量，不當負載證書 |
| 累積異常判讀 | rollback累積439702978；14:41:56→14:48:18Z約382.232秒增量0、deadlock增量0；idle-in-transaction0／等待client lock0／invalid indexes0，8組財務指紋相同。沒有重設stats或終止backend |
| 既有管理約束 | realtime.messages 的 messages_payload_exclusive 是Managed NOT VALID CHECK；沒有改寫／強制VALIDATE |

**15:24Z Legacy形狀補查：7／17 Budgets與2／3 Actuals的payer為NULL，6／7 trips缺少初始化rates。** participants均有explicit joins且均為approved，paid_at無缺值、custom share sum mismatch0、Actual非整數TWD0。NULL payer不直接等於舊資料損壞；但B-7新Lifecycle預設legacy complete，必須在真正式備份還原副本驗證這些資料的Snapshot／Payer／Pricing／Payment／Source／readiness與fail-closed恢復行為，不能用「Stage fixture已過」推定相容、不能私自補payer或用缺值當理由重寫財務。新的Production相容性P1 gate列入部署演練。

6個旅程缺rates也使「開新前端看原旅程」可能觸發正常初始化及future Baseline刷新；與Stage已確認的設計一致。正式schema驗收先讀完整Rates／Baseline seals，不開原旅程UI做smoke、不改未知原值；雙帳號smoke只用另授權的新QA旅程。

上述低負載窗口支持「目前沒有再次出現當時rollback風暴」，不證明所有時間與所有客戶端都健康。PostgREST服務精確版本／非公開完整日誌／長期p99本輪未取得，保留限制；未用SQL Editor少量查詢代替正式smoke。

Security Advisor可見 **0 Errors／10 Warnings／2 Info**，未按Rerun／Reset。9個signed-in可執行的SECURITY DEFINER API均拒絕anon EXECUTE；已只讀追蹤直接或私有委派的auth.uid／can_edit／can_manage檢查；不把靜態review當正式負向寫入測試。另1個為Leaked Password Protection Disabled，沒有更改Auth設定。warnings明細與原始Catalog只留Git忽略證據。

**Engine安全Review仍是P1門檻。** [官方17.11公告](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes)列出17.6之後的安全修正與升級相容性風險。本輪catalog指標為ltree無／btree_gist無／非extension自訂estimator0／user function legacy-cipher字樣0；沒有做臨時函式、解密探測或全資料掃描，不能據此證明全部CVE不適用。先決定升級／風險處置及受影響演練，與B-7 migration分開授權；不自行升級。[11/10 HTTP TLS cipher異動](https://supabase.com/changelog/cbc-tls-ciphers-deprecated)列為客戶端相容性觀察，不為本輪改TLS設定。

## 2. Ledger、Source及Hotfix差異

Production不是Stage的47筆起始環境：**T0 20260811150000已安裝**，實際public／private alternative函式body與Stage完全相同，不再部署。

Production import版本 **20260819134935**、Stage版本 **20260819125851**：兩者完整LF Source SHA均為 `6460f12edf525e959fd88ad4654fdc17acf2d9ee8747aea6cf2f1a24dc4b436c`，`import_trip_timeline_v1(jsonb)` body也相同。保留正式版本，不重播Stage別名、不空補別名Ledger。Raw版本差集18筆不是18個待執行來源，實際新增是17筆，計畫48→65，但最終版本集合仍與Stage不同。

Production原48筆分類：**11筆**完整single-source與同版Git原文精確相符；**34筆**保有拆分statement arrays，只能證明各statement／joined source的Hash，不能冒充原檔逐byteHash；**2筆**20261024054121／20261024063828的statements為NULL；另1筆為上面的已核對import版本別名。兩筆NULL的當前Luggage函式／權限已可檢查，但無法逆推當時整份DDL原文，保持provenance Blocked交Review，不寫Ledger補假source。此為此次Production即時結果，不沿用Stage舊「31缺完整Source」推估。

PT409 `20261031003000` 已安裝，完整Source與Git相符。13 baseline routines都保有PT409、custom40001為0：**12 raw body seals exact**；`public.privatize_luggage_item(uuid,uuid,timestamptz,text)` Production body SHA `bdde67772d13cbca9b7d78d33da4368c8a4dd11445861d054f103818f5391e32` 與Stage seal不同。精確原文／literal-preserving tokens／人工逐行diff顯示僅空白換行，沒有省略或改權限。**Raw Hash差異仍使舊封包gate失敗，不宣布13/13 exact、不改Stage seal。** 必須Review新的Production before契約及歷史source缺口，再在還原副本演練；不能重跑Hotfix。

17個來源皆以DB端計算的完整LF SHA與本機不可變檔案相符；Stage最終38個body目前仍與compiled seal相符，分類54PT409／24PT500。直接新Stage／Prod Catalog之間多22個relation（含sequence）、193個函式，17個既存body不同（含上述排版差異），這些是metadata差異，不是已通過的正式安裝測試。

## 3. 精確待部署來源（僅計畫）

| 次序 | 來源版本／檔案 | 完整 LF SHA-256 |
| --- | --- | --- |
| 1 | [20261029020551](../supabase/migrations/20261029020551_budget_group_metadata_prototype.sql) | `686017abab6daf966fccf15f9f231f91a58f5d4747526daff23b16453f0cdee6` |
| 2 | [20261029031137](../supabase/migrations/20261029031137_budget_metadata_snapshot_signals.sql) | `b7561c3d3cbd89988abebfdf0a526092eb0d65c465dabe45d7cb7eea58d815f1` |
| 3 | [20261029091435](../supabase/migrations/20261029091435_budget_metadata_undo_prototype.sql) | `fed54f64ecb3d9588e7df2c074888c02b60c7a68423cb02e86ea42f8d67cb1fd` |
| 4 | [20261029114817](../supabase/migrations/20261029114817_budget_category_payer_links_groups.sql) | `08c7c9e813d6014fb8ce4fd039e4cd39f9152f0832086609e715d3d1cd591262` |
| 5 | [20261029123907](../supabase/migrations/20261029123907_budget_pricing_participant_groups.sql) | `657c0cacddcea3b70d82a2a8c6c81e52124aeab2d45c39b89d60bb3ef2d2803d` |
| 6 | [20261029134206](../supabase/migrations/20261029134206_budget_payment_lifecycle_groups.sql) | `3387c31f5e4c4bbfd12ddcbc26ff62e23b534de8132a42265d5311de0d8ffaa3` |
| 7 | [20261030012554](../supabase/migrations/20261030012554_budget_payment_minimal_bundle.sql) | `7df467d8e04daedbefda589dee0c1c2cc1e09ec328c37463b640c4e02c07b011` |
| 8 | [20261030021719](../supabase/migrations/20261030021719_budget_source_atomic_groups.sql) | `c9f7db07d72ad627958316a293fdb0d82e284048bee35f3dd6b57cae8a59ea2c` |
| 9 | [20261030034351](../supabase/migrations/20261030034351_budget_receipts_lifecycle.sql) | `68051b3e1253617a062a863e475fb22a01401f98845a28a3720edaa6dc253a80` |
| 10 | [20261030054628](../supabase/migrations/20261030054628_budget_financial_dependencies.sql) | `6e7f04fed391137e775bff888b078e68ced76869d6adc9e302c2a8ff4ee4da55` |
| 11 | [20261030064703](../supabase/migrations/20261030064703_budget_workspace_lifecycle.sql) | `090d1fb6faeeb64e60b2927b9cf1d7418f7f3541539d9fee44aa45cba9cc0cea` |
| 12 | [20261030082712](../supabase/migrations/20261030082712_budget_workspace_undo.sql) | `b8fe1488d9c69057e4699b903ba762c1f3622b3d1c75eb5789e1181643055e27` |
| 13 | [20261031083437](operations/budget-b7-staging-managed/20261031083437_budget_managed_worker_role_path.sql) | `4a4b50f012c356120a11286d881fef3a268ca97bc23aa05f37aa4b0f122cc08e` |
| 14 | [20261031130000](operations/budget-b7-staging/20261031130000_budget_business_conflicts_forward.sql) | `f3b79c74f5c79737ccb17dc89d296cdab3afb8c5c5e115ae32195bb299f6bbb3` |
| 15 | [20261031130414](operations/drafts/budget-b7-cascade-forward/20261031130414_budget_dormant_parent_cascade_guard.sql) | `19f9c1e6184560052b4a62f4b810573198a225b98e0f80b67b874ad869e4cb22` |
| 16 | [20261031140648](operations/drafts/budget-b7-trip-cascade/20261031140648_budget_trip_cascade_lease_admission.sql) | `a221d3911b285d5ae729ca7db6fd6c2b15094dced600ee38b52eabebb7de069b` |
| 17 | [20261101032853](operations/budget-b7-legacy-cutover/20261101032853_budget_receipt_legacy_cutover.sql) | `b5032314b31678ae6ae922f6aa648e7a7108e5ce77bd09a7a9b5aef7d3ed85b6` |

每一來源路徑／bytes／完整SHA及依賴見manifest。順序保留12份prototype→fullUndo、M0、F0、兩次Cascade Forward、Legacy cutover；F0必須在最後可能重定義函式的M0之後。**不部署T0、import別名、既有Hotfix、未安裝原20261030125028。** M0 supersession在正式環境仍需明確Review／授權。

Production wrapper尚未建立；不可直接改Stage封包ref。下一輪須建立與Production48基線／角色／既有finance投影綁定的單Session單Transaction封包，保存所有已套用原文，模擬部分失敗rollback及未知COMMIT；[Runbook C節](operations/budget-b7-production/README.md#c-精確17來源與未來原子封包)定義必要契約。此輪只準備純read-only的catalog／data／舊欄位projection／post-dormant readback SQL，沒有任何新自動套用migration或執行wrapper。

## 4. 備份／還原／回復與發布策略

Free方案Dashboard明確 **Free Plan does not include project backups**。正式備份不可用Stage豁免；需明確Git外加密目的地、正式專用安全連線及native PG17匯出，完整DB／Auth／Ledger／roles／RLS／Storage metadata與獨立bytes清單，Hash驗證＋新隔離目標還原／資料一致／時間量測。見[Runbook B](operations/budget-b7-production/README.md#b-備份保護與隔離還原必須另授權後執行)。目前無backup／restore實測、無PITR保證、未要求付費或重設密碼。

發布順序：**DB dormant原子提交與獨立讀回 → 相容Frontend五OFF → 可信Production Worker／真canary → 所有Legacy issuer停止及實際失效 → 正式自身readiness與受控Activation／ON artifact Promotion → 雙帳號smoke／觀測**。每一步需各自新授權及真實Production證據；Stage readiness／已Revoked key／舊TTL不能代用。

Production Worker尚無已Review的正式runtime／可信renewal／排程／監控；現有Staging QA adapter不得直接改ref上線。Legacy signed-upload／TUS／S3／admin issuer及有效期限仍未正式盤點，objects0不能推導耗盡。本輪沒有讀正式管理key／signing secret、簽發JWT、建立canary／帳號／排程或Storage檔案。

Vercel current Production READY／main `cab828d0cc2c62ba7eb29760aae692386565cfc5`，與fresh origin/main相同；起點a0a818d相對main **40 commits／333檔／41 src檔／14 migration檔**，本輪文件另加。沒有package／lockfile／vercel.json變更；不能只merge最後幾個QA commits。五B7 env flags未設定、hiddenProductionEnvCount0，未讀secret明文；自動正式domain Promotion閘尚未確認。先另核准main合併範圍、人工發布閘與Production-build候選，不假設Preview Promotion會維持同artifact。具體步驟、雙帳號smoke／監控門檻見[Runbook D–F](operations/budget-b7-production/README.md#d-database--frontend--worker--legacy--activation)。

未知COMMIT先新連線判定；提交前失敗整交易Rollback；已Dormant保留schema、旗標OFF；已Activation後只安全Pause、保留不可逆latches／financial requests／Origin／history／bytes，使用相容前端唯讀與經審查Forward Repair。**禁止schema down、舊snapshot／backup覆蓋已提交金融操作或重設latch**。Native restore僅隔離證據，不自動授權正式復原。

## 5. Review門檻與本輪收尾

| 優先級 | 尚待處理 | 判定 |
| --- | --- | --- |
| P0 | 真正獨立Production備份／可用還原證據／安全保存 | Blocked，部署必需 |
| P1 | Production-bound packet／格式差異before契約／來源provenance／原資料與Managed權限故障演練 | Blocked，不重封舊seal或硬跳gate |
| P1 | NULL payer／缺rates的真實Legacy資料在新完整性協定下相容 | 待還原副本演練；禁止直接補值或改歷史成本 |
| P1 | PG17.6安全公告適用性／升級時序與回復演練 | 待Review，不稱可直接升級 |
| P1 | Production Worker身份／renewal／runtime／排程及Legacy全issuer失效證據 | Blocked，Activation必需 |
| P1 | main合併／Vercel自動發布人工閘／正式相容版與ON候選授權 | Blocked，本輪沒有merge／release |
| P2 | 10既有安全warnings、Managed NOT VALID、Stage超限transport／硬體accessibility證據界線 | 保留，不改為Passed |

純唯讀保護查詢採正式盤點時凍結的**舊欄位集合**，避免未來新增lifecycle欄位使Hash無法比較；Baseline payload／Origin／Payment History一律完整保護。SQL實際讀回、來源Hash／JSON／文件連結／敏感內容／diff檢查記於結果JSON；不重跑歷史測試／Build，沒有產品程式修改。初次以UI innerText擷取長SQL時會壓縮空白，Hash斷言失敗；改成分段textContent後，111份非NULL原文與DB計算first／joined Hash逐項一致，113rows含2個NULL均有列示，沒有放寬Hash斷言或修改DB來源。

Staging新讀回仍Ledger65／七OFF／Undo fullOFF／三latches及既有readiness保留，無新QA資料或服務測試。Production財務／Baseline／Storage的8組指紋多次一致；全部現存public／private **25個關聯**的舊欄位投影筆數／Hash在15:21:59與15:27:37Z也完全相同。原始診斷／Ledger SQL／Catalog與個人欄位不提交Git，僅去敏摘要與artifact digest。完成文件Commit／Push後停止，等待ChatGPT Review；**不自動進入任何Production部署**。
