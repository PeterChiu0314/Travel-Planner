# Budget B-7｜BUG-030 本機修正與隔離回歸

> 後續狀態：本文件保留本機22/22歷史。新封包已另獲精確授權並部署至Staging，Ledger64、真實HTTP7/7、BUG-030結案；見[最新部署驗收](2026-10-31-bug030-staging-deployment.md)。以下「尚未部署」僅為當時紀錄。

2026-10-31，分支codex/budget-collaboration-redesign，起點24d2c5580875da9e18f98dacc278ac9dcb4f2041。使用者「繼續」後，本輪完成**本機最小修正／隔離驗證／供Review的非自動套用Forward**，沒有把它當成另一份Hosted部署授權。

**官方候選20261031140648／22項針對性原生回歸全部通過。Staging未存取／未寫入；BUG-030的真HTTP仍未結案。** [完整Runbook與安全規則](operations/drafts/budget-b7-trip-cascade/README.md)、[封包manifest](operations/drafts/budget-b7-trip-cascade/packet-manifest.json)、[去敏實測結果](qa/2026-10-31-budget-b7-trip-cascade-local-results.json)。

## 根因與最小修正

前輪Staging普通owner的DELETE trips，在FK DELETE budget_items時由guard_budget_edit_lease→assert_budget_edit_lease拋42501；approved membership已不能取得。本輪先用真正PostgreSQL authenticated角色／獨立連線重現同一拒絕，沒有superuser／BYPASSRLS，修正前整圖保持。

只替換兩個private函式body並保留OID／owner／ACL／security／search_path／輸入名稱及defaults。Trip刪除前，在既有RLS下驗owner與合法Budget角色、鎖membership及七protocol rows、拒絕有效租約／raw lock與並發親子列寫入，然後寫入不可由使用者偽造的private交易授權。該授權綁定txid／backend／trip／actor／trigger depth，只用於同交易內的nested FK cascade；lease檢查仍保留。AFTER STATEMENT清除，error與rollback無殘留。

新增物件僅一張owner-only private RLS表、一個無公開EXECUTE的cleanup trigger function、一個Trip AFTER DELETE STATEMENT trigger。需要這個受保護的狀態來承接刪前的真實權限；單用GUC、親列不存在或trigger depth都不能證明使用者曾獲授權。沒有公開RPC／新role／Worker／flag，也不改既有RLS或grants。

並發部分用try-advisory＋有序NOWAIT親子列鎖，避免先持Trip row再等待peer編輯交易造成新的鎖循環；遇忙碌明確55P03拒絕，沒有增加Timeout、把所有衝突改409或重寫引擎40001／40P01。

## 候選身分

| 欄位 | 封存值 |
| --- | --- |
| 官方Migration版本 | `20261031140648`，CLI2.106.0／真實UTC產生 |
| 完整Source | 17987bytes／SHA-256 `a221d3911b285d5ae729ca7db6fd6c2b15094dced600ee38b52eabebb7de069b` |
| 原子Wrapper | 37600bytes／SHA-256 `032a2498b1677cbb7c99b0d38c388a9e707043fb6184823aa3a9d936b74653f1` |
| 預期Ledger | 63/head20261031130414→64/head20261031140648；僅在native實測 |
| 修改既有函式 | guard_budget_external_parent()、assert_budget_edit_lease(text,uuid,boolean,uuid,uuid) |
| 新物件 | budget_trip_delete_admissions、cleanup函式、Trip cleanup trigger |

Full body before／after見[compiled-definitions](operations/drafts/budget-b7-trip-cascade/compiled-definitions.json)。已部署Incomplete Forward130414、其Source／wrapper／manifest與舊Migration、38final seals全部不動。較早未Review原型140342在補強並發保護後拒收，留ignored開發記錄、未部署／未登記；唯一Review候選為140648，不是重封已核准Hosted封包。

## 22／22隔離結果

原生PostgreSQL17.11，每次全新loopback cluster；實際authenticated role／claims、非superuser／非BYPASSRLS、普通actor與管理fixture連線分開，並發以真row／advisory locks與pg_stat_activity barrier驗證。**不是Supabase Auth token驗簽／PostgREST／Storage／Browser驗收**。

| 針對性範圍 | 結果 |
| --- | --- |
| 舊42501重現／before compiled Hash | Passed |
| Forward後段故障／DDL、函式、資料與Ledger整筆回滾 | Passed |
| 原函式屬性、所有既有函式／RLS／Trigger／財務fixture保持 | Passed |
| 普通owner刪Trip：Budget／Actual及children、多筆Trip同語句 | Passed |
| 非會員／editor／匿名、撤權editor與owner金融權限、偽造GUC／私表寫入／cleanup呼叫 | Passed |
| 有效legacy／group／rates lease與raw lock拒絕；過期lease允許 | Passed |
| membership／protocol／advisory／parent／child並發寫入拒絕 | Passed |
| 已進入cascade時另一連線取得lease，不能在Trip提交刪除後留下權限 | Passed |
| 單筆Budget／Actual已部署行為、live Incomplete子列INSERT／UPDATE／DELETE | Passed |
| finance／lifecycle／receipt曾Activated後Pause、metadata-only啟用仍fail-closed | Passed |
| 巢狀零row Trip語句不清外層授權；後段child錯誤全圖回滾 | Passed |
| 重送、unknown body／新物件grant／trigger漂移拒絕，full source Ledger63→64／NULL及來源碰撞 | Passed |

這是22個實際測試case的分組摘要，完整名稱／結果在JSON。候選實際版本／Source／wrapper一致；所有context row結束為0，七組fixture旗標最終OFF，cluster已停止。只跑直接相依新回歸，沒有重跑不受影響的歷史15項／Realtime／完整H01～H03；前端無異動，不重跑既有Build。

開發中曾因CREATE OR REPLACE遺漏原參數名／default遭42P13拒絕，已修正且保留原屬性；native anon沒有table grant，改驗既有ACL42501而非假定RLS零row；撤權分別驗editor及owner的金融權限；原生時間戳保留microseconds；巢狀test trigger的dollar quote修正。沒有放寬產品斷言、停用Hosted Guard或以Timeout增加換通過。

## Hosted未完成與下一步

本輪沒有讀取Hosted、執行新SQL、重用密碼helper、讀金鑰、修改QA Graph或Cleanup。最後可引用的服務checkpoint仍是前輪21:34台灣時間：Ledger63／七OFF，Trip HTTP42501、兩個新QA trip及Baseline保留。這不是本輪即時驗證，不能宣稱Staging已修好。

**GO：ChatGPT Review此新封包。NO-GO：自動部署Staging、Activation、Worker與Production。** 如Review通過，下一輪需要精確授權version140648／上列兩個Hash、兩個private body＋三個新private/trigger物件及一筆Ledger63→64；先執行新的Managed Catalog／role／資料／lease／七OFF Preflight，再單Session執行完整wrapper並獨立讀回。

仍須真實普通JWT的Trip Cascade與安全清理、PT409 HTTP、合法Incomplete負向fixture。不能因native通過先把BUG-030或P1-CASCADE Hosted結案；不能把本輪本機繼續解讀為部署或旗標啟用授權。必要權限差異、Advisor及所有新物件實際Managed行為留待下一輪驗證。停止等待Review。
