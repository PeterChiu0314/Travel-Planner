# BUG-030｜Trip Cascade 租約授權 Forward（Staging 已部署）

**已依精確封包授權 COMMIT 至 Travel-Planner-Staging／uyqdopksfysbobhjcepk，Ledger64；真實HTTP7/7、BUG-030結案。禁止重送本封包。** [實際部署與驗收](../../../2026-10-31-bug030-staging-deployment.md)、[去敏證據](../../../qa/2026-10-31-bug030-staging-deployment-results.json)。七Protocol／Latch／Readiness OFF，Activation／Worker／Production仍NO-GO。以下保留核准封包及原執行前規則的歷史紀錄；「尚未授權／執行」描述僅指先前本機Review階段。此目錄不在supabase/migrations；不要db push／include-all／重播舊Forward。

[先前本機修正與隔離報告](../../../2026-10-31-budget-b7-trip-cascade-local-repair.md)、[去敏22項證據](../../../qa/2026-10-31-budget-b7-trip-cascade-local-results.json)、[先前63筆checkpoint](../../../2026-10-31-budget-b7-cascade-deployment.md)。最新64筆服務證據見上方部署報告，舊失敗紀錄保留。

## 唯一已核准部署封包

| 項目 | 封存值 |
| --- | --- |
| 官方CLI版本 | 2.106.0；真實UTC產版，不手改時間／版號 |
| Migration | [20261031140648_budget_trip_cascade_lease_admission.sql](20261031140648_budget_trip_cascade_lease_admission.sql) |
| 完整Source | 17,987bytes，SHA-256 `a221d3911b285d5ae729ca7db6fd6c2b15094dced600ee38b52eabebb7de069b` |
| Wrapper | [candidate-deployment.psql](candidate-deployment.psql)，37,600bytes |
| Wrapper SHA-256 | `032a2498b1677cbb7c99b0d38c388a9e707043fb6184823aa3a9d936b74653f1` |
| Ledger | 已實測63／20261031130414 →64／20261031140648；Source及函式獨立讀回通過 |
| 封存 | [packet-manifest](packet-manifest.json)、[source-manifest](source-manifest.json)、[完整before／after body](compiled-definitions.json) |

僅更改兩個既有private函式body：guard_budget_external_parent()、assert_budget_edit_lease(text,uuid,boolean,uuid,uuid)。OID／owner／ACL／security／search_path／輸入名稱與defaults保持。另新增三個必要物件：

- app_private.budget_trip_delete_admissions：私有短期交易授權表，RLS啟用、owner-only ACL、無Policy／API Publication，對PUBLIC／anon／authenticated／service_role／Worker均無表權限。
- app_private.cleanup_budget_trip_delete_admissions()：SECURITY DEFINER／空search_path，僅由trigger呼叫，無公開EXECUTE。
- public.trips.zzz_budget_trip_delete_cleanup：AFTER DELETE FOR EACH STATEMENT，按txid／backend／trigger depth清除此語句的授權。

沒有新Role、公開RPC、Protocol旗標、Worker或排程，也不改既有RLS／Grants。對新private物件的REVOKE只用來確保最小權限。

## 權限與並發契約

1. 普通使用者仍先通過原Trip DELETE RLS。刪除前的private Guard以try-advisory鎖序列化旅程，驗證真正owner；如有Budget／Actual，還必須有approved owner/editor角色，並以FOR SHARE NOWAIT鎖住membership，防止撤權競爭。
2. 鎖定七個Protocol singleton的目前row，任何已啟用／曾啟用Latch或未知狀態皆fail-closed。既有Activated／Paused外部Parent Guard不變。
3. 有效legacy edit／group／rates lease或七分鐘raw financial lock皆55P03拒絕，不能藉Trip cascade把租約先刪掉。再按固定順序NOWAIT預鎖相關Budget／Actual與children／link／Actual attachment rows，遇並發寫入立即拒絕，不等待形成新的鎖循環。
4. 授權表只由private BEFORE Guard寫入，綁定transaction_id、backend_id、trip_id、user_id、trigger_depth。只有同一actor／transaction／backend的巢狀FK cascade，且Trip row已不存在時，這筆授權才能替代消失membership的權限查詢。**不信任client GUC、pg_trigger_depth單一條件或「親列不存在」本身。** 原lease判斷仍執行。
5. AFTER STATEMENT清理只刪同tx／backend／對應depth；巢狀零row DELETE不能清掉外層授權。成功語句與回滾後皆0row，不留持久權限。所有操作與原DELETE同交易。

[PostgreSQL官方Trigger說明](https://www.postgresql.org/docs/17/trigger-definition.html)說明row AFTER先於statement AFTER，且trigger／原語句同交易回滾。本輪還用實際SQL角色與多連線測試這些清理與鎖行為，沒有只依文件假定安全。

## 本機重現與不可變界線

`node scripts/qa/run-budget-metadata-parallel.mjs --trip-cascade-regression`：全新loopback原生PG17.11，安裝必要依賴與已部署63筆來源後，使用**實際候選版號／完整source／wrapper**驗證22項。實際authenticated SQL role（非superuser／非BYPASSRLS）及claims，並非Supabase Auth驗簽或PostgREST HTTP。測後cluster停止。

`node scripts/qa/prepare-b7-trip-cascade.mjs`只呼叫官方migration new及產本機artifact；候選已存在會拒絕覆寫，sourceHash漂移也拒絕，不自動重封。此工具沒有DB executor。較早未Review原型140342已拒收並保留ignored；唯一候選是本README所列140648。

已部署130414的source／wrapper／manifest、38final seals、舊Migrations與財務歷史不修改。22項新針對性回歸不代替先前尚未通過的Hosted Trip／Incomplete／PT409測試。

## 部署前必要門檻（歷史核准程序，已完成）

- 先ChatGPT Review本候選的真實版號／兩個Hash／五個物件變動，再取得**新的Staging-only明確授權**；泛稱繼續或前次one-Guard授權不能用來部署本封包。
- 新的唯讀連線核對實際host／project-bound login／DB／role、TLS verify-full、Ledger恰63/head130414、新版本缺席、兩個before body SHA、已部署Incomplete Guard afterHash ecd788…、38final Hash、原28資料指紋與保留QA清單／Baseline、全RLS／ACL／Trigger／Worker／Storage policies；不得重封預期Hash來通過。
- 七組完整Protocol／Latch／Readiness均OFF。新增admission表／函式／cleanup trigger均應不存在；未知同名物件或部分已套用即拒絕。確認無有效legacy／group／rates/raw鎖、未完成交易或其他測試寫入。
- 確認部署role可在app_private建立私有表／函式、在public.trips建立trigger、執行必要表鎖，並保留原函式owner；本次Managed Preflight及原子COMMIT已驗證，不擴權或更改既有grants。

## 核准後的原子執行與讀回程序（已依此完成，不重送）

1. 重新準備僅針對本候選的安全psql helper；**不要直接重用前輪operator，它釘住舊130414的path／Hash**。既有helper已stopped，密碼未保存。不要讀瀏覽器Session Token或把密碼放URI／命令列／Git。
2. 只用已核對Staging Direct或Session Pooler5432／verify-full。單一client Session先SET app.b7_install_target='uyqdopksfysbobhjcepk'，再完整載入candidate-deployment.psql；保留ON_ERROR_STOP與原BEGIN／COMMIT，不加-1、不拆段。
3. Wrapper鎖Ledger並確認63/head；來源要求精確兩個before或兩個after Hash及前置Incomplete Guard，新增物件／ACL／schema形狀精確符合；所有body、物件與一筆完整source ledger在同交易，成功才64。後段任一失敗全部回滾。
4. 若COMMIT不明先獨立唯讀讀回，不能直接重送。同版本重送只接受64/head／name／完整sourceSHA及所有after物件完全一致；NULL來源、source碰撞、未知head／部分函式狀態／權限或清理trigger漂移都拒絕。
5. COMMIT後新唯讀連線核對64／完整source、兩個afterHash與原非body屬性、38final／原資料／七OFF、新表RLS／ACL／0rows、cleanup函式／trigger、新物件不被Realtime發布及Managed Advisor前後差異。不得做破壞性Rollback或刪Ledger；必要時另版Forward Repair。

## Hosted驗收與清理（先前待辦，最新結果見部署報告）

普通JWT Trip／Budget／Actual cascade、非會員／匿名、有效peer租約拒絕及真實PT409已通過；撤權／並發邊界沿用先前本機證據。Incomplete負向需安全合法Hosted fixture，仍無protocol-OFF合法製造方式，不能用直接SQL／停trigger／服務角色繞Guard。

前輪保留的兩個QA trip以及本輪兩個新QA trip，已依精確manifest用普通owner正常DELETE清理，其Baseline／financial／membership關聯均0；舊preactivation QA旅程／Baseline未動。四筆無Trip FK的QA signal保留，不強制清除。其他Parent／Baseline／Audit guard若拒絕仍應保留，不走Auth Admin Cascade或強制SQL。

**目前GO：部署結果ChatGPT Review。BUG-030已在Staging結案；NO-GO：Activation／Worker／Production。不自動進入下一階段。**
