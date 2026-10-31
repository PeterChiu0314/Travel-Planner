# Budget B-7｜Staging Cascade Forward 部署與真實 HTTP 回歸

2026-10-31，分支 `codex/budget-collaboration-redesign`，起點 `03204d767a38054094d89e612d3c35290eeca9dc`。唯一目標 Travel-Planner-Staging／`uyqdopksfysbobhjcepk`。

**核准 Forward 已 COMMIT，Ledger62→63及獨立讀回全部正確。Budget／Actual Parent Cascade真HTTP通過；整Trip DELETE仍403／42501，P1-CASCADE不能結案。** 已停止後續寫入，保留完整剩餘QA Graph，不回滾已提交修復、不強制清理。Activation／Worker／Production為NO-GO，等待ChatGPT Review。

[去敏驗收證據](qa/2026-10-31-budget-b7-cascade-deployment-results.json)、[既有核准Forward與Runbook](operations/drafts/budget-b7-cascade-forward/README.md)、[前輪P1調查](2026-10-31-budget-b7-p1-repair-review.md)。舊報告／packet manifest記錄產出時的hostedApplied=false／deploymentAuthorized=false，不修改它們來假裝重新核准；本文件記錄後續明確授權與實際部署。

## 核准封包與部署

| 項目 | 實際結果 |
| --- | --- |
| Migration | `20261031130414_budget_dormant_parent_cascade_guard.sql`，3,546bytes |
| 完整Source SHA-256 | `19f9c1e6184560052b4a62f4b810573198a225b98e0f80b67b874ad869e4cb22` |
| 執行wrapper | `candidate-deployment.psql`，9,116bytes |
| Wrapper SHA-256 | `e6db59ea72d45e21e4e7860f37d70cfab1e6d35e483847deba533495d45118a6` |
| Ledger | 62／head20261031130000 → **63／head20261031130414** |
| 新Ledger | name正確、statements恰一個完整Source、SHA相符 |
| Guard Before body SHA | `c3667a091954ed67ea677ff73aed85a5aa57cf292bb02519fcea155521a4a3d5` |
| Guard After body SHA | `ecd7888508e91b6df351a9ab4e95cf1a3facc426316ee68a868e622b1cdfda51` |
| SQL結果 | psql exit0、INSERT0 1、明確COMMIT；無unknown ACK、未重送 |

原生PostgreSQL17.11 psql，Session Pooler5432，實際Host／project-bound login為指定Staging，DB／current_user／session_user為預期postgres身分。helper強制 `sslmode=verify-full` 與既有CA；`\conninfo`確認client→pooler TLS1.3。依[PostgreSQL官方SSL說明](https://www.postgresql.org/docs/17/libpq-ssl.html)，verify-full同時驗證憑證鏈及hostname；不能以pooler後端pg_stat_ssl代替client證據。

密碼由使用者在本機遮罩視窗輸入，只留helper記憶體／子程序環境；沒有密碼檔／CLI URI／聊天或Git。首次背景helper壽命不足，未執行部署；改為持續前景Session後完成Preflight與部署。最後helper正常stopped／passwordSaved=false。未重設密碼、擷取瀏覽器Session Token或擴權。

同一持續psql Session先SET指定target，再完整載入核准wrapper；保留原BEGIN／COMMIT、ON_ERROR_STOP、鎖與Timeout。未使用-1、拆段提交、重播Dormant／Hotfix或修改原SQL／Hash。Hosted唯一結構修改為此private Guard及一筆Ledger，沒有其他Schema／RLS／Publication／Role／Grant變更。

## Preflight與獨立讀回

21:27～21:28台灣時間的Preflight符合：62/head、新version缺席、BeforeHash、38final seals、28原資料投影、保留QA圖、七完整Protocol／Latch／Readiness row OFF。對照既有已部署Catalog的columns／constraints／functions／indexes／policies／publication／tables／triggers及角色／schema／default ACL／storage policies／private grants，無未預期Drift。

最後維護查詢確認edit/group/rates lease、legacy有效鎖、prepared transactions皆0，沒有其他在途交易。沒有更改預期值通過門檻。

COMMIT後以四個新的唯讀client連線重新讀回：

- Ledger63、新name／完整sourceSHA正確，Guard AfterHash及整個pg_proc非body屬性不變（OID／Owner／ACL／SECURITY／search_path等）。
- 原38final函式及13個舊Hotfix相符；Catalog僅guard_incomplete_child()定義Hash改變，其餘所有已封存Catalog物件及權限保持。
- 28原資料Hash及既有2帳號／1QA trip／9Budget／5participants／1QA Baseline／72groups／12requests／2signals保持，無原始或前輪QA mutation。
- 七組Protocol／Latch／Readiness全OFF，Worker／Storage policy／RLS／Trigger保持。沒有Worker／前端／Realtime變更。

Session Pooler可重用backend；獨立指新的psql client／交易，不宣稱PID一定不同。

## 真實HTTP矩陣

使用既有兩個獨立QA Auth帳號重新登入，JWT user／role／session_id已核對。service_role只讀取指定QA Auth並generate_link→真Auth verify，以及本輪兩個唯一QA trip的owner membership初始化；沒有寄信、新帳號、signing secret或管理清理。**所有驗收REST／RPC／DELETE皆普通JWT**。未存JWT；短期管理key交接檔限目前Windows使用者，執行前刪除、環境退出清除。

初版QA初始化：owner JWT可POST旅程，但bootstrap owner membership被既有RLS拒絕；尚未開始Cascade。保留該失敗證據，僅沿用同一組唯一run／trip ID，以受控membership初始化補齊，沒有重建或清空Graph。這是QA setup限制，沒有以放寬RLS取得Passed。

| 驗收 | 狀態 | 真實結果／界線 |
| --- | --- | --- |
| 真Auth／兩Session／新QA範圍 | Passed | 真Auth verify、兩普通JWT；本輪獨立旅程 |
| Budget Parent DELETE→Participant | **Passed** | 普通JWT DELETE返回1parent，child讀回空 |
| Actual Parent DELETE→Participant | **Passed** | 普通JWT DELETE返回1parent，child讀回空 |
| 非會員／匿名刪Budget／Actual／Trip | **Passed** | 六個拒絕／零row結果，owner重新讀回親列仍在 |
| 正常QA Trip DELETE | **Failed P1** | HTTP403／SQLSTATE42501 Forbidden，交易回滾，兩親列與children仍在 |
| Incomplete Parent非法Participant INSERT／UPDATE／DELETE | **Blocked** | 失敗後停止寫入；既有QA無Incomplete Parent，Protocol OFF不允許以Raw INSERT製造，未繞Guard／開旗標 |
| 本輪PT409真HTTP版本衝突 | **Blocked** | 尚未執行即觸發停止條件；舊Hotfix及final Hash不變不等於此HTTP已通過 |
| 正常QA清理 | **Blocked／保留** | Trip正常DELETE失敗，不走Auth Admin Cascade或SQL清除 |
| 最終關聯／資料保護 | Passed（唯讀） | 全域Budget／Actual participant孤兒皆0，原資料與既有QA保持 |

Runner本輪實際執行4Passed／1Failed；三個後續項目因停止列Blocked。沒有用SQL fixture冒充HTTP，沒有啟用Paused／Activated負向測試；原15／15原生邊界證據沿用，未重跑。本輪後續不再有Hosted寫入。

## Trip失敗的已確認原因

21:32:46.856台灣時間對應PostgreSQL log的實際context：

1. 普通owner JWT的DELETE trips產生FK DELETE budget_items。
2. app_private.guard_budget_edit_lease() line26呼叫assert_budget_edit_lease。
3. app_private.assert_budget_edit_lease(text,uuid,boolean,uuid,uuid) line11在can_edit_trip檢查拋42501 Forbidden。

唯讀函式來源顯示can_edit_trip→approved_trip_role由trip_members取approved角色。此FK cascade執行時編輯角色已不能取得；這與Trip／membership Cascade可見性相關，拒絕發生在legacy lease Guard，不是剛修好的Incomplete Child Guard。原始log保留Git外ignored，不提交IP／完整query／個人內容。

先前15／15原生測試的親列刪除是privileged session／auth.uid null；assert_budget_edit_lease明確對此跳過，因此未涵蓋普通JWT的權限可見性。**該native通過不能推翻本輪真HTTP失敗。** 不重跑admin測試來宣稱修復。

建議下一輪先在隔離PostgreSQL建立真正authenticated＋JWT claims的Trip cascade重現，設計刪前權限與租約驗證的受控交易上下文，並保留Incomplete、Activated／Paused外部Parent Guard與非會員隔離。不建議只移除can_edit_trip或對所有外部DELETE放行。涉及另一個函式／交易協定，超出本次單Guard授權；本輪不修改、不部署其他Forward。

## 最終資料與Advisor

原始28組預期Hash保持。QA新建列會落入舊「非已知QA」投影；最終查詢只增加本輪manifest精確trip／parent IDs的QA排除，**不改任何預期Hash**。初版final投影含新participant造成兩項差異，校正至同一原始資料範圍後全部28相符；此為scope修正，不隱藏原始資料Drift。

本輪保留：**2個新QA trip、2owner memberships、1Budget＋1participant、1Actual＋1participant、2個自動產生的QA Baseline**。另兩個單筆parent及其children已在成功case正常刪除。0新帳號／0Storage物件；沿用既有QA帳號，所有既有QA Baseline不動。精確ID清單只在ignored本機manifest，Git存Hash。登出已嘗試，但原Runner未封存Auth logout返回狀態，不宣稱已獨立證實全部session撤銷；沒有保存JWT。

Managed Security Advisor部署前後皆 **0Errors／10Warnings／22Info**，重新執行linter後警告實體完全相同。既有9個預期signed-in SECURITY DEFINER RPC提示＋1個Leaked Password Protection Disabled，未修改設定。**無新增security P0／P1，但Trip業務P1仍存在**；Advisor不能代替Cascade驗收。

本輪僅增加QA Runner／文件；Syntax、JSON／來源Hash／diff檢查通過，原核准SQL／wrapper／manifest與既有Migration不變。沒有產品碼／build依賴異動，因此不重跑已過Build、Realtime或完整H01～H03。

**結論：Forward部署Passed；P1-CASCADE整合仍Failed／未結案。GO交ChatGPT Review；NO-GO Activation、Worker、Production。** 下一輪最小需要：隔離普通JWT回歸與另一個最小lease/membership cascade修正的Review；若需Hosted安裝，另按精確封包／Hash授權，並針對本輪保留QA驗證及安全清理。不得重播本Forward或做破壞性Rollback。
