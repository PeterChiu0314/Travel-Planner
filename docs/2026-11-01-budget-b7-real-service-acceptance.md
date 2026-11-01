# Budget B-7｜真實 Staging 平台服務驗收

2026-11-01；唯一環境 Travel-Planner-Staging（uyqdopksfysbobhjcepk）。接續 e13560351cbb06110dce9a465263177d7e3052a6。使用者已授權連續收尾及有證據的受控 Activation；本次停止原因是實際安全前置條件未成立，沒有另設逐階段 Review 門檻。

**B-7 尚未完成；Staging Activation／Production 均 NO-GO。** Auth、Storage bytes 與專用 Worker 已由真服務驗證。Legacy Upload 的可驗證停止簽發／耗盡證據仍缺失，readiness 不填 true。Ledger64/head20261031140648；七組 Protocol／Latch、Receipt三個 readiness、前端五個預設旗標均 OFF；legacy_grants_expire_at=NULL。未啟用或 Pause，沒有重播 Migration、Hosted Schema/RLS/Grant 變更。

[去敏逐項矩陣與證據](qa/2026-11-01-budget-b7-real-service-results.json)；[連續收尾 Runbook](operations/budget-b7-closeout-runbook.md)。

## 真實服務結果

| 範圍 | 結果 | 證據及界線 |
| --- | --- | --- |
| Auth／RLS | Passed | 既有兩個獨立 QA 帳號、新獨立 JWT Session；核對 /auth/v1/user；會員／非會員隔離；新 QA 旅程撤權後，同一 JWT 立即讀不到旅程。一般驗收不使用 service_role。 |
| Private Storage／MIME／Signed URL | Passed | 普通 JWT 實際 Upload／GET／Sign／DELETE；68-byte PNG 完整 SHA-256 相符；非會員與匿名拒絕；text/plain 回覆400/InvalidMimeType。 |
| 超10MiB TUS | Passed | 宣告10,485,761 bytes，真HTTP413／433ms；尚未傳 bytes 即拒絕，未建立 upload lease。不是完整 Receipt upload 的替代驗收。 |
| 超限 standard／multipart 回應 | Blocked | 兩次既有12s邊界內未收到回應，保留失敗／Blocked斷言。Managed 日誌確認 EntityTooLarge、內部413、對外400，未提交超限物件；不以日誌把客戶端逾時改標 Passed。 |
| 合法9MiB與未知ACK | Passed，含恢復限制 | 真 Upload 的 ACK 逾時後沒有重傳；獨立 SQL 確認物件已提交，再以普通 JWT 完整 GET9437269 bytes，SHA-256=4ce8568193be84705a0cc31a87d992734748c3f39f08b0be0bab1c86d09b2ea2；headers1565ms、全部bytes4280ms。檔案為正確 CRC 的合成 PNG。這證明平台 I/O恢復，未證明 Receipt Controller未知ACK E2E。 |
| 專用 Worker JWT／headers | Passed | 可信HMAC簽發、role=budget_receipt_worker、ref/issuer正確、exp-iat=900s。真 PostgREST簽章驗證；普通使用者 claim回覆42501。Storage缺少／錯誤claim header讀取遭拒，正確header才可讀取並驗證 SHA／size／MIME／PNG container。 |
| Claim／lease／retry／restart | Passed（平台canary） | 真Node程序claim後exit42；新程序8輪×20s，cycle4完成一分鐘持久重試，cycle7完成兩分鐘過期租約接管。另一次cleanup失敗持久化、exit42，再起程序2輪×15s完成attempt2清理；錯誤finish token42501。共10個實際排程輪次，非空兩輪冒充生命週期。 |
| 參照保護／舊式覆寫 | Passed（平台canary） | Claim後普通JWT建立真附件引用；Worker DELETE未刪除Bytes，普通使用者讀回Hash相同；舊式upsert遭拒。普通JWT正常解除引用後，Worker HTTP刪除及finish成功。未以Admin刪bytes。 |
| Pending／過期清理 | Passed（平台canary） | 等待真實6分鐘期限；專用Worker sweep將3個pending轉aborted並透過Storage HTTP清理3個物件。最終3 aborted intents、6 done cleanup；attempts分別[1,2,2]及[1,1,1,1,1,2]，無pending／claimed／blocked。 |
| JWT真正到期 | Passed | 首次緊接exp的probe仍在官方30秒clock-skew內，200不是缺陷。原401拒絕斷言保留，等實際exp+skew後，回覆401/PGRST303；不改簽章、時鐘或等待逾時值來製造結果。 |
| Legacy Upload耗盡 | Blocked | 24h Storage日誌載入67/67、未見成功signed-upload／TUS簽發；S3無Access key，multipart/parts均0。但日誌有延遲、沒有權威未到期grant清單，也沒有已建立的簽發停止點；不能據此猜一個已過期timestamp。 |
| 合法Incomplete Hosted／完整Receipt／雙Browser協作 | Pending Post-Activation | Lifecycle／Receipt／群組鎖／Undo／ACK恢復／Presence等完整產品E2E依賴Activation。既有本機27/27、Controllers136/136、local Browser10/10與真Realtime6/6保留為歷史證據，不重跑、不改稱此次Hosted通過。 |

## Canary來源與資料保全

管理員只初始化明確標記「platform canary／not user receipt」的未驗證QA jobs，引用普通JWT真正上傳的獨立QA物件與Actual。沒有改Storage metadata／bytes、停Guard／RLS、偽造verified_at，亦未用service_role充當Worker。真正的verified_at、claim、retry、aborted、done均由專用Worker RPC／HTTP操作產生。這些fixture不是使用者Receipt Begin／Commit證據。

新建3個QA旅程、1個Actual、8個Storage物件均正常清理，包含自動產生的3個新Baseline；所有刪除由普通JWT或專用Worker Storage API完成。保留既有兩個QA帳號與原QA Baseline。3個新增sync signals、3個aborted intent和6個done cleanup為可追溯QA紀錄，不強制刪除。原始2旅程／1帳號／25行程／3備案／1Baseline的28組保護投影、38函式seals、Guard屬性、Budget RLS／Publication／Worker ACL／Storage Policy前後一致。

最後獨立讀回 2026-11-01T02:53:35.780614+00:00；Preflight／Readback及journal查核 2026-11-01T02:55:10.355323+00:00。Managed Security Linter實際重跑：0Errors／10Warnings／23Info；10個warning row逐項與先前一致，未新增P0/P1。三個QA Session正常local logout，finite Worker已退出，記憶體助手stopped。管理key、signing secret及Worker JWT未保存、輸出或提交；raw Dashboard logs（可能含短效Signed URL）未提交。

## 修正、問題與停止條件

- 本機P1工具相容性：publishable key不是legacy JWT。保留admin ref/role/HMAC驗證，增加exact Staging URL及真/auth/v1/health200核對；遮蔽輸入視窗僅在真正READY後關閉。新provider3/3＋既有Worker安全4/4，共7 distinct tests，加上4/4跨endpoint防護測試，共11 distinct通過；Production Build通過，保留既有bundle advisory。未修改產品UI、舊Migration或已部署封包。
- QA初始化曾因臨時SQL字串加法42725、旅程會員建立前要求representation403及缺少destination23502失敗。各次交易均以獨立唯讀確認未提交，再依實際schema修正工具；未放寬任何資料庫保護。這些不是產品功能通過證據。
- P0：本次未新增已確認缺陷。P1 release blocker：Legacy grant可驗證停止簽發／耗盡尚未完成；因而Activation、合法Incomplete Hosted、完整Receipt／多Browser E2E仍未完成。P2：standard upload ACK逾時的client／gateway原因未完全定位；已證實後端超限拒絕與合法大檔恢復，不調高Timeout掩蓋。既有Advisor／bundle／歷史source差異保留原分類。

## 具體下一步

先建立可稽核的Staging維護窗口與所有legacy簽發端停止點，查明實際使用的signed-upload／TUS／S3通道及最大有效期，從最後可能簽發時間排空並留證。官方SDK signed-upload有效2小時；TUS URL最多24小時；不可將這些文件值直接冒充本專案已耗盡的實測。先確認現有Guard是否可在不Activation時阻止新legacy簽發；若做不到，準備最小Forward及隔離驗證，不能用假timestamp越過gate。這是待解技術與時序條件，不是再次索取已給的Staging授權。

平台證據仍有效且所有前置條件成立後，才簽認readiness／證據SHA並依原子Activation程序啟用Staging；立即執行合法Incomplete與完整雙帳號／多Browser／Receipt E2E，任何P0/P1依既有Runbook安全Pause。Production17來源的條件式順序維持原Runbook；Production baseline、備份／還原及正式授權未完成，不產出自動部署封包，不合併main或部署。

官方來源：[API keys](https://supabase.com/docs/guides/getting-started/api-keys)、[Standard upload](https://supabase.com/docs/guides/storage/uploads/standard-uploads)、[Resumable/TUS](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)、[Signed upload期限](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl)、[PostgREST14 JWT clock skew](https://docs.postgrest.org/en/v14/references/auth.html)。
