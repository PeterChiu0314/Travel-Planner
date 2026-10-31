# Budget B-7｜H01～H03 Staging 啟用前服務驗收

2026-10-31，起點 `548075f13437871a7eb3176b5be54f6a9361149e`，分支 `codex/budget-collaboration-redesign`。唯一目標：`Travel-Planner-Staging`／`uyqdopksfysbobhjcepk`。

**結論：啟用前服務能力已有真實證據，但 Activation 仍 NO-GO。** 存在兩項 P1：兩輪測試均遺失首次 Budget INSERT 的 Realtime 事件，以及 Dormant 父列刪除的 Participant Guard 相容缺陷。後者已有本機 Forward 草案與 **8／8** 隔離回歸，尚未套用 Hosted。沒有重跑 Dormant 封包、寫入 Ledger、變更 Hosted Schema／RLS／Grants、啟用任何協定／Latch／readiness／前端旗標，亦未啟動 Worker、排程或操作 Production。

最終矩陣為 **25 Passed／2 Failed／3 Blocked／10 Pending Post-Activation**；Passed包含2項真Catalog條目，不能統稱25項HTTP。首輪21／25通過；補測只執行7項受影響／必要setup條目，5通過／2未通過，保留歷史結果不合併重複計數。

證據：[去敏完整結果與逐項矩陣](qa/2026-10-31-budget-b7-staging-preactivation-results.json)、[部署基線](2026-10-31-budget-b7-staging-managed-deployment.md)、[Managed Runbook](operations/budget-b7-staging-managed/README.md)、[本機 Guard 草案](operations/drafts/budget-b7-preactivation/20261031100434_budget_dormant_parent_cascade_guard.sql)。

## 真實執行與界線

首輪為 **17:41:08～17:41:55 Asia/Taipei**；受影響項目補測為 **18:08:53～18:09:24**。使用現有 `@supabase/supabase-js`／`@supabase/realtime-js` **2.106.1**、Node **24.16.0**，沒有更動套件或 lockfile。每輪建立 A／B 兩個真實 Auth 帳號、兩個不同 session_id，經 `/auth/v1/user` 核對身分；JWT 全由真實 password sign-in 取得。兩個獨立 Supabase clients 經真實 WebSocket 連線，沒有 Mock、SQL 假扮 Auth，亦未宣稱已完成產品雙 Browser UI 驗收。

使用者已授權 Staging QA 初始化及受控清理。既有 Staging service_role 只用於 Auth Admin、建立 QA 旅程／membership，以及精確 QA ID 的清理；**所有驗收 RPC、RLS、Storage 與 Realtime 均使用一般使用者 JWT 或匿名／無效憑證負向測試**。沒有用 service_role 模擬 Worker。QA token未保存；首輪刪Auth帳號不代表立即撤銷所有已簽JWT，本次未驗證此種撤銷語意。

前一輪 DB 密碼沒有保存，本輪未要求重設或取得密碼。新出現的 Supabase 連接器對此專案回覆無權限，因此採 Dashboard 唯讀 SQL 作 Catalog／保護指紋核對，HTTP Runner 仍直接連到指定 project endpoint；未擷取 Dashboard session token。初始沙箱 DNS 導致零資料的連線失敗；核准的網路程序成功後才有實際服務驗收。

管理金鑰最初只在記憶體；跨執行環境交付時，曾短暫置於 Git 忽略、停用繼承且僅目前 Windows 使用者可存取的暫存檔，**於網路 Runner 啟動前刪除**。沒有在命令列／Git／報告印出金鑰。QA 密碼、JWT、Signed URL、原始 row ID 清單與原始診斷不提交 Git。未存取 JWT signing secret 或產生 Worker JWT。

## H01：Auth／PostgREST／Realtime

| 項目 | 狀態 | 證據與限制 |
| --- | --- | --- |
| 真實登入、JWT 身分與兩個獨立 Session | **Passed** | A／B sub 與 session_id 不同，Auth user endpoint 與預期帳號相符；Git 僅存識別 Hash |
| 成員／非成員 RLS | **Passed** | B 尚未加入時看不到 QA trip、Snapshot 回傳 null、mutation 拒絕；加入 editor 後可讀及修改同一 QA Budget |
| 舊預算 Save／一般帳號 peer update／原 Request Replay | **Passed** | Protocol OFF 時建立金額120TWD及一個 participant；B 更新成功；原 request 重播不新增 row；未測完整付款歷史整合 |
| 確定性版本衝突 | **Passed** | stale Save bounded HTTP409／PT409；再次 Snapshot 證明圖未變；本輪觀察的 request 沒有 `40001`，不擴張為所有 PG engine 交易無序列化錯誤 |
| 匿名／無效 JWT | **Passed** | 保護 RPC 拒絕；非成員的唯讀 Snapshot 依既有設計回傳 null，沒有把安全空結果誤判成錯誤 |
| 未啟用功能拒絕 | **Passed，限實際呼叫** | Metadata acquire 與 Lifecycle placeholder 均回覆55000，graph未變；v10 Snapshot 可讀且 metadata enabled=false。沒有把預期 HTTP500／55000 當功能故障，也沒有聲稱逐一跑完所有新 mutation |
| 真實 Realtime 訂閱與 UPDATE | **Passed** | A／B 都 SUBSCRIBED，後續 UPDATE 兩端接收，authoritative Snapshot 相符 |
| 首次 Budget INSERT | **Failed／P1** | 兩次獨立 run，兩端在 SUBSCRIBED 後皆未於固定10秒界線收到第一個 INSERT；DB／HTTP已確認建立成功。沒有提高 Timeout 或放寬斷言 |
| 斷線後重建訂閱 | **Passed，範圍有限** | 修正 Runner：await intentional disconnect、移除舊 channel、建立新 client/channel、等新 SUBSCRIBED；之後 B 確實收到新 UPDATE。這不證明瀏覽器背景分頁／被動網路中斷全流程 |
| 取消訂閱 | **Passed** | B取消後不再接收下一筆UPDATE，A收到該筆；B的權威HTTP讀取仍正確 |
| 群組並行、同組競爭、Undo／ACK／Pricing／Payment／Source等完整 E2E | **Pending Post-Activation** | 不能由舊功能測試或 OFF 拒絕取代 |

Realtime 首次 INSERT 的 root cause **未確認**。唯讀確認 publication 有 INSERT／UPDATE／DELETE，Budget 在既有 publication，後續 UPDATE 能送達；因此不能直接斷言是缺 publication、RLS 或 SDK bug。補測沒有改 schema、publication、Grants 或 Managed `realtime` schema。後續應取得該兩個實測時間窗的服務日誌／訂閱控制訊息，定位首次事件處理，再做最小修正；不能藉重新部署或先啟用 B-7 掩蓋。

## H02：Storage HTTP

| 項目 | 狀態 | 實際證據 |
| --- | --- | --- |
| Private Bucket／Policy／限制設定 | **Passed，真 Catalog** | `trip-attachments` private，10,485,760 bytes；JPEG／PNG／WebP／PDF，既有 member policies 及 restrictive receipt boundaries 保留。設定檢查不當 HTTP proof |
| 一般 QA 路徑 upload／download | **Passed，真 HTTP** | A以一般JWT上傳68-byte PNG並下載；SHA-256 `c33aeac20cdfb2d12b602cd65611496d0ca00a0407c782340e6df4c7bfdc52ea` 相同 |
| Signed URL | **Passed，真 bytes** | 一般會員簽發30秒URL，實際下載Hash一致；URL只留記憶體，沒有實測expiry或立即撤銷 |
| 非成員／匿名／錯路徑 | **Passed** | read、sign、upload拒絕；非成員delete沒有刪任何物件，原會員仍可讀；private public URL拒絕 |
| 不允許 MIME | **Passed，真 HTTP** | text/plain 兩輪均拒絕 |
| 超過大小限制的 HTTP 拒絕 | **Blocked** | 10,485,761-byte upload及Expect:100-continue均未在既定12秒 transport deadline取得回覆。沒有實測HTTP413，不能由Catalog推論通過；沒有單純提高Timeout |
| 一般 QA 物件正常 delete | **Passed，補測** | 一般JWT Storage DELETE回傳精確物件；新的URL query讀回拒絕，最終Catalog確認objects=0 |
| 未啟用 Receipt namespace | **Passed** | A對受保護 receipt 路徑的普通 upload 被拒絕；沒有建立 receipt metadata或Pending Intent |
| Receipt Begin／Commit／Replace、content proof、Worker-reference協作 | **Pending Post-Activation** | 本次只證明平台一般附件能力與OFF安全邊界 |

初輪刪除後直接重用剛下載過的URL仍得到200；後續Catalog證明物件已不存在。這與快取行為相符，但沒有封存 response cache headers，因此**不能聲稱已定位哪一層快取**。補測使用新 query URL加上Catalog讀回，沒有改刪除成功的實質斷言；既有Signed URL的有效期／快取保留仍待完整Receipt驗收。

## H03：Worker 啟用前

| 項目 | 狀態 | 證據／依賴 |
| --- | --- | --- |
| 專用role與最小權限 | **Passed，真 Catalog** | NOLOGIN／NOINHERIT／NOBYPASSRLS，無superuser／CREATEROLE／CREATEDB／REPLICATION；Worker不繼承其他role |
| SET路徑 | **Passed，Catalog capability** | 既有Storage→authenticator保持；authenticator可SET Worker、不自動繼承；creator ADMIN只有SET=false／INHERIT=false。沒有用此項冒充Storage runtime SET成功 |
| Grants與一般使用者不可Claim | **Passed** | Bucket SELECT、objects SELECT／DELETE，其餘Storage寫入拒絕；一般JWT呼叫兩個Worker claim RPC得到42501 |
| 真Worker JWT／Headers／exact claim | **Blocked** | 無專用token，不讀signing secret，不以service_role替代；job／token／expiry／object UUID／仍引用保護只完成來源與Catalog核對 |
| Claim／Lease／Retry／Cleanup實際執行 | **Blocked** | 未執行claim、finish、sweep或Cleanup；本輪沒有在private queue直接種fixture |
| 排程、至少兩輪、重啟與持久重試 | **Blocked** | 本輪不授權啟動。現有maintenance CLI仍只接受loopback，不移除guard、不建立常駐服務 |

來源已核對：`scripts/maintenance/budget-receipt-cleanup.mjs` 以專用JWT的Authorization、公開apikey及每job `x-receipt-worker-job`／`x-receipt-worker-token` 建立獨立client；claim約2分鐘、verification retry約1分鐘、每transport10秒、每批verification／cleanup各最多50項。內容驗證器核對digest／size／container signature／MIME，並不承諾完整解碼或malware scanning。這些是來源設計，不是本輪已跑的Worker驗收。

安全供應方式：由**操作者控制的可信簽發端**簽發僅Staging、短效、`role=budget_receipt_worker` 的測試token，透過受限環境注入單次硬鎖Staging adapter；原始signing key留在原可信端。須另行授權token供應／最小必要簽發、adapter單次執行及queue fixture保留，再測實際JWT驗證、Headers傳遞、錯job／token／過期／cross-job拒絕。排程／兩輪／重啟屬另一項明確執行授權；本次沒有要求使用者在聊天貼token或secret。

## 問題分級與本機修正

- **P0：本輪未發現。** 不代表Activation gate已通過。
- **P1-RT-INSERT：未解。** 兩輪真服務遺失首次INSERT；後續UPDATE、重建訂閱與取消訂閱已實測。需要查服務時間窗及冷訂閱的交付行為，不改未知原因的Hosted設定。
- **P1-CASCADE：本機修復，Hosted未解。** `guard_incomplete_child()` 在FK cascade的parent已消失時，`budget_complete()`變false，遂把正常DELETE判成Incomplete。初輪與補測真HTTP刪旅程皆55000。草案只在**DELETE、父列不存在、finance／lifecycle／receipts從未activated**時保留legacy cascade；現存Incomplete親列的raw participant INSERT仍拒絕，已activated後暫停的Parent Guard仍fail-closed。
- **P2：驗收工具問題已修正並補測。** Reconnect必須等新SUBSCRIBED，不能用舊joined狀態；刪除讀回需考量快取。大小transport條件仍Blocked，不降斷言取得Passed。

Forward草案在非自動套用目錄，精確before／after Guard Hash：`c3667a091954ed67ea677ff73aed85a5aa57cf292bb02519fcea155521a4a3d5` → `ecd7888508e91b6df351a9ab4e95cf1a3facc426316ee68a868e622b1cdfda51`。未知Hash／已activated環境拒絕；不改任何已提交來源、舊封包或38函式seal。官方CLI產生的草案版本`20261031100434`小於既有Ledger head `20261031130000`，**版本順序／Ledger政策仍須另行Review，草案不能直接部署**。

隔離原生PostgreSQL針對性 **8／8** 通過：重現Budget／Actual原Guard故障、屬性與七OFF保存、兩種parent cascade修正、正常trip cascade、現存Incomplete保護、metadata啟用時拒絕安裝、已activated暫停fixture拒絕、重複執行與未知body drift原子拒絕。測試中的paused-latch為回滾的native合成fixture，未動Staging旗標。cluster已停止。期間fixture缺欄位／缺actor及直接設定activated會被真latch覆蓋等測試建置錯誤均修正，沒有放寬產品斷言；沒有重跑原B-1～B-7全套。另完成Production Build（保留既有大chunk提示）、3份JS Syntax、新舊封包離線checker、JSON／60個本機連結／敏感內容掃描及git diff --check；沒有更改產品runtime或前端旗標。

## QA 清單與保護資料

兩輪分別使用專用 `.invalid` 帳號、獨立future trip及含run UUID的一般附件路徑。Git僅保存user／session／trip／object Hash；可供後續授權處理的精確ID清單位於Git忽略的本機fixture manifest。

| Run | 帳號／旅程／Budget | Storage／稽核保留 |
| --- | --- | --- |
| 初輪 | 兩QA帳號與旅程最終不存在 | 0 objects；revision tombstone可能保留，納入最終總數 |
| 補測 | **保留2QA帳號、1旅程、1Budget、1participant、1QA Baseline** | 0 objects；8groups、部分legacy request／signal依賴保留，不強制清除 |
| 兩輪合計最後讀回 | 1QA trip、2QA users、1Budget、1participant、1QA Baseline | 0objects、8groups、4legacy requests、2signals；receipt intents／cleanup queue均0 |

**清理順序錯誤揭露：** 初輪Runner在trip DELETE被Guard拒絕後，仍繼續既有Auth Admin刪帳號流程；owner FK cascade使QA trip最後被刪除。這不是原先打算保留的清理結果；已修正Runner，trip清理失敗就保留相關帳號，避免改走Auth cascade。補測確實保留該圖，不以強制SQL、停Trigger、改Grants或清private audit取得清理成功。此錯誤與修正保留於證據，沒有宣稱初輪Guard-cleanup通過。

最終獨立唯讀查詢將**兩輪精確QA manifest**排除後，原28組欄位投影Hash／數量全部相同；原2trip／1Auth user／25itinerary／3alternatives／1Baseline保留。這是原資料集合的保護比較，不聲稱整個DB總列數不變。Ledger仍62／head不變，38函式Hash仍相符；Hosted Guard仍是舊beforeHash，證明草案未套用。Bucket policies、Worker角色／memberships／capabilities與測試前一致。

七組Protocol完整row（含Latch／receipt readiness）前後相同且全OFF；queues全0。前端source／env未更動、未部署，沒有重新審核遠端Vercel環境變數。

## Review 後的最小下一步

1. 先Review兩項P1及非自動Forward草案；解決版本順序／來源Hash／ledger政策後，另行明確授權Staging-only修復及針對性真HTTP回歸。禁止重送Dormant封包。
2. 取得必要Realtime服務日誌／訂閱控制訊息並定位首次INSERT遺失；保留冷訂閱實測，不以UPDATE或延時掩蓋。
3. 在具備可觀察request完成狀態的受控網路補驗over-limit HTTP；目前只確認MIME拒絕及Catalog大小限制。
4. Review專用Worker token供應與Staging adapter／queue fixture政策；未獲授權前不碰signing secret、不Claim、不掃Orphan、不排程。
5. 最後才另行規劃Activation／Pause範圍與readiness證據：啟用前平台能力digest與啟用後完整E2E必須分開，不提前填true解除循環。

Activation後仍待真實群組並行／同組競爭、租約接管、Pricing／Payment／Source／FX／retained Actual、五步Undo與peer衝突、Lifecycle新增刪除、unknown ACK／Request Replay／Snapshot延遲、帳號撤權／登出／trip切換／late response、v1～v10 reader／舊新版隔離、Desktop雙Browser的Portal／IME／原生Ctrl+Z、Receipt Begin／Commit／Replace及Worker兩輪／故障恢復／仍引用object identity保護。此輪沒有替這些項目標Passed。

**完成文件與原分支Commit／Push後停止，等待ChatGPT Review。Activation／Worker／Production仍NO-GO。**

## 官方資料核對

- [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)：publication、使用者授權與訂閱要求；不是本專案首次INSERT問題的已證根因。
- [Storage Access Control](https://supabase.com/docs/guides/storage/security/access-control)、[Private serving](https://supabase.com/docs/guides/storage/serving/downloads)、[Smart CDN](https://supabase.com/docs/guides/storage/cdn/smart-cdn)：區分RLS、Signed URL與快取／刪除讀回。
- [Custom Roles](https://supabase.com/docs/guides/storage/schema/custom-roles)：專用JWT與role；沒有因此授權簽發secret。
- [官方Changelog](https://supabase.com/changelog)：核對相關breaking changes，[HTTP TLS舊cipher停用](https://supabase.com/changelog/cbc-tls-ciphers-deprecated)不代表本次應放寬TLS；[Realtime schema保護](https://supabase.com/changelog/realtime-schema-locked-down-against-modification)亦不能繞過來修訂閱。未升級服務或修改Managed schema。
