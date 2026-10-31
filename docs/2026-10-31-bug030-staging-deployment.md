# BUG-030｜Staging Forward 部署與 HTTP 驗收

2026-10-31；分支 codex/budget-collaboration-redesign，起點 e571839717109e8be34bead4e4bcd7ec34a5f9e4。唯一目標 Travel-Planner-Staging／uyqdopksfysbobhjcepk。

**COMMIT 成功、Ledger 63 → 64、真實 HTTP 7/7 Passed。BUG-030 可在 Staging 結案。** 七組 Protocol／Latch／Readiness 全 OFF；B-7 Activation、Worker、Production 仍 NO-GO，停止等待 ChatGPT Review。

[去敏驗收證據](qa/2026-10-31-bug030-staging-deployment-results.json)、[核准封包與 Runbook](operations/drafts/budget-b7-trip-cascade/README.md)、[前輪22項原生回歸](2026-10-31-budget-b7-trip-cascade-local-repair.md)。本輪沒有重跑原生22項、Realtime、Build 或完整 H01～H03；沒有產品／前端／依賴變更。

## 部署與獨立讀回

| 檢查 | 實測結果 |
| --- | --- |
| 安全連線 | psql／Session Pooler 5432／project-bound login／postgres DB及角色；TLS1.3、verify-full；密碼只在本機隱藏輸入與程序記憶體 |
| 新唯讀 Preflight | 22:42 Taipei；Ledger63/head20261031130414、新版本缺席、原28指紋／38函式／13Hotfix、Catalog／RLS／ACL／Worker／Storage、七OFF與無有效租約／在途交易均符合 |
| 完整 Source | 20261031140648_budget_trip_cascade_lease_admission，17,987bytes；SHA-256 a221d3911b285d5ae729ca7db6fd6c2b15094dced600ee38b52eabebb7de069b |
| 正式 Wrapper | 37,600bytes；SHA-256 032a2498b1677cbb7c99b0d38c388a9e707043fb6184823aa3a9d936b74653f1 |
| 原子執行 | 同一 psql Session 設定 Staging target、ON_ERROR_STOP=1，完整載入原 Wrapper；保留其 BEGIN／COMMIT、鎖與 Timeout，不加 -1、不分段、不重播；exit0、COMMIT 明確回傳 |
| 獨立讀回 | 新唯讀 client 重新查 Ledger64/head20261031140648；name／statements[1]完整Source SHA正確；非部署回傳代替驗收 |
| 函式／資料 | 兩個既有 private body 只按核准值更新；OID／owner／ACL／security／search_path／參數及defaults不變；原38函式、13Hotfix與原28受保護資料指紋不變 |
| 新物件 | 僅核准 admission表、cleanup函式、Trip AFTER STATEMENT trigger及其欄位／constraint／index；表RLS ON、owner-only、0policy、0publication；最終context0row |
| 最小權限 | anon／authenticated／service_role／budget_receipt_worker：新增表／欄位權限及cleanup EXECUTE全false；原角色／Grant／RLS／Storage policy無非預期變更 |

| 既有函式 | Before SHA-256 | After SHA-256 |
| --- | --- | --- |
| guard_budget_external_parent() | 339372306c750fb35c826502db586f8760c9d98c6ce157885cc4c42adf66a32a | 33250f5f38a512114aff9577caf01d4f2e87a9492f212311cf760c8d21df7d8a |
| assert_budget_edit_lease(text,uuid,boolean,uuid,uuid) | 4a128561f030302b54889c2e91c0a867ae87c9d091ab07ff81c0377ef264d780 | a198a9f151ae29474341fac43e517c3e2d0bb09d75f2322133586ef8383cec0f |

前輪 guard_incomplete_child() 保持 ecd7888508e91b6df351a9ab4e95cf1a3facc426316ee68a868e622b1cdfda51。13個舊Hotfix函式均保留PT409、custom40001=0；本輪HTTP未收到40001。不改真正引擎序列化／死鎖錯誤。

## 真實 HTTP 結果

實際時間為 **14:48:51Z 起（台灣22:48）**；兩個既有獨立QA帳號重新登入取得不同session_id，Auth /user 核對身分。一般操作與清理全用普通使用者JWT。service_role僅對既有QA Auth產登入link／verify與三筆新QA membership初始化，不代替任何權限斷言。

| 針對性情境 | 結果與證據 |
| --- | --- |
| 真Auth／獨立Session／兩個唯一QA旅程 | Passed；不同使用者與Session，全部實際PostgREST |
| Budget、Actual Parent DELETE | Passed；正常owner刪親列，participant FK cascade成功 |
| 同旅程peer有效租約 | Passed；owner Trip DELETE遭500/55P03拒絕，整圖不變；peer正常釋放自己租約 |
| PT409 | Passed；舊base租約acquire回409/PT409，整圖不變；僅證明此真實版本衝突路徑，不宣稱所有付款／Replay流程已驗收 |
| 非會員與匿名 | Passed；Budget／Actual／Trip六次刪除均拒絕或RLS零row，整圖不變 |
| 新QA Trip Cascade | Passed；兩個owner普通DELETE均成功，相關Budget／Actual／participants／Baseline圖清除 |
| 前輪保留QA清理 | Passed；僅核對owner／精確QA標題後正常DELETE兩個先前失敗旅程，舊preactivation QA及Baseline保持 |

租約55P03對外仍是既有500映射，屬既有P2，沒有為通過驗收改成409。現存Incomplete非法Participant負向的Hosted合法fixture仍 Pending；Activated／Paused安全界線沿用先前原生22/22證據，**本輪沒有啟用Protocol，也未將SQL測試冒充HTTP**。

## 清理與原始資料保護

- 共四個明確QA旅程（本輪2＋前輪失敗2）由普通owner正常DELETE。新唯讀查其trip／member／Baseline／Budget／Actual／participant／group／request均0；Budget／Actual participant全庫孤兒0，admission0，無有效租約或其他未完成交易。
- 四筆屬這四個已刪QA旅程的協作signal保留。該表無Trip FK；它們是同步／刪除訊號，不是participant孤兒。不強制SQL或Auth Admin Cascade清除。去敏證據保留trip hash及數量，精確ID只在ignored本機manifest。
- 舊preactivation QA保持2帳號／1旅程／9Budget／5participant／1Baseline／72groups／12requests／2signals／0Storage objects。其帳號未刪。包含上述四筆保留訊號時，歷史QA signals合計6。
- 原28資料指紋預期值完全未改。最終唯讀投影僅將本輪manifest的兩個新QA旅程ID排除於原始資料範圍；沒有重新封存原Hash。初次投影曾包含新QA signal而顯示差異，精確歸屬核對後才使用原本的QA隔離規則，未修改Hosted資料。
- 兩個本輪Auth Session均logout204；本機一次性admin key檔已移除、父程序環境清空；DB helper stopped、passwordSaved=false。密碼／JWT／個資／原始log／本機fixture manifest均未提交。

## Security Advisor 與七組 OFF

真正Managed Security Advisor重新執行：**0 Errors／10 Warnings／22 Info → 0／10／23**。10個Warning逐列相同（既有九個登入者可呼叫SECURITY DEFINER及Auth leaked-password保護未啟用）。新增Info為 RLS Enabled No Policy／app_private.budget_trip_delete_admissions，符合核准owner-only、無公開權限且無policy的default-deny設計；不是新增P0／P1。沒有為消除提示更改Policy或Grant，也不宣稱Info清單完全不變。

最終14:51Z唯讀證據中 Source／Finance／Payment／Receipt／Metadata／Lifecycle／Undo七組enabled全部false；Finance／Receipt／Lifecycle activated=false，Undo full_enabled=false，Receipt三個verification readiness=false。前端旗標來源未改；沒有部署前端或啟動Worker／排程。

## 結論與後續門檻

**BUG-030：Closed（Staging真實部署及HTTP驗證）。GO：ChatGPT Review本次結果。NO-GO：Activation／Worker／Production。**

本次未新增未解P0／P1；既有Storage超限／Worker專用JWT與排程、收據內容與HTTP完整性、合法Incomplete Hosted負向fixture，以及啟用後群組競爭／Undo／ACK恢復等完整H01～H03仍各自待驗收。既有Realtime產品修正未部署。這些限制不以本輪7/7或Dormant部署代替。

不重送本Forward、不移除Guard、不破壞性Rollback。若有新問題需另行Review與精確Forward授權；下一步只Review，沒有自動進入下一階段。未操作Production、Docker／WSL、main／Vercel或其他Hosted修復。

交付檢查：新HTTP Runner syntax、去敏JSON解析、73個本機Markdown連結、敏感內容掃描及diff whitespace檢查通過；原封包兩個SHA再核對一致。離線重比實際讀回，確認只更新核准兩個body／新增11個Catalog entries，原28資料／38函式與所有既有保護欄位不變。未因本輪QA工具／文件變動重跑無關Build或歷史測試。
