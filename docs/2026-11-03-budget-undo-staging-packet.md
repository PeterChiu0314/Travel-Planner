# Undo 移除｜Staging 單一 Forward 封包候選，未執行 Hosted

**最新狀態已由 [Staging安裝紀錄](2026-11-03-budget-undo-staging-install.md) 取代：Staging ledger66／Forward20261103113253已安裝，七協定OFF。** 本文是`ac9501c`候選歷史，不再是可執行安裝指令。原aggregate row-digest XPath有錯，完整row保全宣稱撤回；已以修正後81表/668列coverage、真資料/並發/CRLF23項測試及實際獨立讀回補證。原先一律write-lock平台表的策略也已修正為精確四表read-lock例外。不要執行或重播舊候選；新source已部署，不得修改。

起點 `97c3761`，唯一目標 `uyqdopksfysbobhjcepk`。依 [原地保全方案](2026-11-03-budget-undo-staging-preflight.md) 準備本機候選；沒有 Hosted DDL/DML、Storage bytes、協定／flag啟用或 Production 操作。Dashboard 只有 READ ONLY contract 查詢及私人查詢草稿。

## 實作與範圍

`scripts/qa/build-undo-removal-staging-packet.mjs` 是離線產生器，沒有 DB/network client、自動執行或重試。只承載不可變 `20261103113253_remove_budget_custom_undo.sql`，LF source SHA-256 `7d4a96959bbe928c4bf4488311b82f6d5a400315d62eb8b6823dada27ba2e34c`。來源 Forward 本輪沒有修改，不包含 B7/reset/已取消30秒來源或 deferred Receipt 草稿。

- 單一交易，原65筆 ledger完整raw-row摘要精確相符後才繼續；成功只新增1筆 ledger（65→66），完整source單一statement及hash讀回，原65筆不變；已安裝或發現取消的30秒來源即拒絕重播。
- 指定Staging target／行政身分／資料庫；必須另由操作者核對Dashboard project或TLS連線端點，GUC不是伺服器身分證明。本機fixture封包另綁隨機cluster marker與local-admin身分，不能拿去Hosted。
- before-contract有效期15分鐘。公開／私有／Auth／Storage所有base relations的完整row projections，只在DB內轉成整體hash；完整原始ledger另算hash。沒有輸出財務明細、密碼、Auth token或Storage路徑／bytes。
- 依固定順序取得relation `SHARE ROW EXCLUSIVE` locks，保留3秒lock timeout；拒絕其他active/idle-in-transaction client、有效wildcard/group/legacyrecord租約、pendingReceipt／未完成cleanup／Undo intent與重複目前實付。未知managed lock/permission失敗直接回滾，不擴權、不終止peer或重設latch。
- 函式before全body、attributes/OID/owner/security/search_path、未變ACL、relation/columns/constraints/RLS/policies/triggers/indexes/publications、角色／membership都做漂移檢查。三個將替換helper另與其不可變已部署來源比hash，不能只把未知現況重新封存當成可覆蓋。
- after保全全部財務、非財務、Auth/Storage catalog與private audit rows、所有七protocol列及既有latches/readiness；未變body/attrs/ACL/schema/role再核對。僅容許這次source明定的三個helper body、removed-client EXECUTE、新guard/trigger/兩restrictive policies/unique index。逐一檢查新body和已撤銷權限。
- 不刪除或移動既有收據；保留1筆metadata、2個objects（包含無目前引用者），無Worker sweep、reset、schema-down或假造legacy expiry/readiness。Storage catalog/hash不等於bytes備份或HTTP403證據。

## 唯讀 live contract

最新捕捉 `2026-11-03T12:32:17.820009Z`（台灣20:32），Staging ledger65/head20261101032853，七OFF／既有latches與readiness保留。三個待替換helper hash確實與不可變舊來源相符。12:29與12:32兩次觀測共有的data／ledger／schema／role／functionAttrs／unaffectedBodies／ACL摘要相同；這不是未來維護窗口或無writer的保證。

具體 live `contract.json`、完整 `packet.sql`、`manifest.json` 留在 Git 忽略的 `.tmp-undo-removal-staging-packet/`，不提交實際before-contract或可執行live封包。公開只交source工具、測試與去敏matrix。候選會到期，需在獲得精確執行授權後重新READ ONLY封存、核對有無差異並重新產出；不是舊候選無限期可執行。不得修改舊profile timestamp來繞過期限。

## 隔離驗證

新建native PostgreSQL17.11，stage-like fixture含非空外幣付款／Source／Baseline／Undo稽核、1筆收據metadata、2個Storage catalog物件，並保留已activated且Pause的latches。實際bytes／Managed Supautils權限不模擬為Passed。

封包 **19/19 Passed**：active editor、duplicate拒絕；只有一個Forward無reset；錯誤target／逾期contract／未知helper body拒絕；ledger/data/schema/全部body/未變body/attributes/ACL/roles漂移拒絕；真peer table lock超時且不終止peer；transaction-local未完成Undo intent拒絕；晚期錯誤完整rollback；單次65→66提交與收據/歷史/latches保留；重播拒絕。runner正常停止cluster。

第一輪嘗試把unfinished Undo intent獨立commit，既有deferred guard正確以PT500拒絕。測試改為在同一可丟棄封包交易內注入fault並驗證整包拒絕／回滾，沒有停trigger、改guard或假造已完成稽核；這是predicate fault test，不冒充真Auth inverse競爭。

原14項SQL/RLS回歸另行重驗，結果見 [本輪矩陣](qa/2026-11-03-budget-undo-staging-packet-results.json)。本輪沒有改frontend，先前117/117 browser結果保留而未重跑；Build、changed JS syntax與diff check通過，既有bundle warning保留。

## 操作說明與執行前決策

1. `node scripts/qa/build-undo-removal-staging-packet.mjs --capture` 只輸出READ ONLY SQL。經已核對的Staging行政連線執行，將可見contract結果保存到本機忽略目錄；不得取用／持久化專案secrets。獨立確認專案ref及正常Admin身分。
2. `node scripts/qa/build-undo-removal-staging-packet.mjs .tmp-undo-removal-staging-packet/contract.json` 只產出本機packet/manifest。先Reviewsource/profile/packet hash及即時資料與保全範圍。`node scripts/qa/run-budget-metadata-parallel.mjs --planning --undo-packet` 只測全新loopback cluster。
3. **尚未授權Hosted執行，不貼packet到Dashboard或執行CLI。** 精確下一階段可限定為「僅Staging單一Forward dormant安裝＋獨立readback，原地保留既有收據／歷史／latches，七協定仍OFF」，不自動包含Activation、QA資料初始化或HTTP keys取得。未知COMMIT先新READ ONLY連線判斷，禁止重送整包。
4. 若獲得該精確範圍授權，重新capture核對漂移，才依Reviewedpacket一次執行。Managed role/lock/policy權限未真演練，失敗即完整rollback並新readback，不自行更換角色或繞過managed schema。執行後新連線確認ledger66/source、權限、財務與物件catalog/原始latches全保留；不能只看COMMIT回覆。
5. 舊signed-read/upload/TUS/S3等能力失效、真ordinary-JWT Undo拒絕與其他附件HTTP、多人財務/Realtime acceptance仍未完成。它們是產品啟用與完整驗收的後續門檻，不能以catalog或隔離fixture代替；本封包沒有啟用、輪替key、發JWT、開始Worker或刪除物件。

交付狀態：本機封包準備完成，待Review／精確Staging執行決策。Production/main/Vercel仍不在範圍。
