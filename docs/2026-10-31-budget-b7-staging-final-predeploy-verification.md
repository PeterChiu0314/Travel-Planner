# B-7 Staging 最終部署前驗證

2026-10-31，起點 `6c98e610e07c6bb637dac7597005b0c2961efe76`，分支 `codex/budget-collaboration-redesign`。唯一遠端目標 `Travel-Planner-Staging`／`uyqdopksfysbobhjcepk`。資料庫觀測時間 **13:16–13:34 Asia/Taipei**。本輪只有 READ ONLY 查詢、Dashboard 查閱、必要本機隔離／離線驗證及文件更新；沒有 Hosted DDL／DML／Migration／封包試跑，沒有 Production 操作、Protocol／旗標啟用、Worker／排程、Docker／WSL 或 Vercel 操作。

**結論：Dormant Schema 部署仍 NO-GO。Catalog／資料指紋／封包核對已完成；獨立真實備份及還原因沒有連線憑證而 BLOCKED。** 使用者明確回覆沒有可供本機匯出的直接／Session Pooler 憑證。沒有因此重設密碼、擴權、升級方案或改用別的專案。

## 1. 真實 Staging 與歷史相依

Supabase connector 的 `get_project`／READ ONLY `execute_sql` 都回覆 permission denied。已登入 Dashboard 則有此專案的正常存取權；透過**未儲存的工具列 SQL 面板**執行已審閱的 `BEGIN ... READ ONLY`／SELECT／COMMIT，session 設定只用 `SET LOCAL statement_timeout`，未點 Save as snippet，也未儲存／修改任何 Hosted SQL snippet。首次查詢確認 `transaction_read_only=on`、current/session user 都為 `postgres`，PostgreSQL17.6。最後查詢仍 ledger47、head不變、B-7／F0不存在。

| 項目 | 本輪結果 |
| --- | --- |
| Ledger | **47筆**；head `20261031003000`；版本／名稱／已知source Hash集合與前次完全一致 |
| PT409 Hotfix | 13個body Hash均與既有baseline seal相符；Owner postgres、search_path空、public wrappers invoker／private helpers definer與既有設計一致；自訂40001=0 |
| T0／B-7／F0 | 尚未安裝；`20261031130000`無版本碰撞。不能把尚不存在的七組protocol宣稱已在Hosted讀到false |
| 保護集合 | **13/13表 count＋rowset SHA-256相符**：2trips、2members、25items、3alternatives、1Baseline；Budget／Actual／participants／receipts／luggage仍0 |
| Auth／Storage | Auth users=1；Storage objects=0、1個private bucket，10MiB上限與四種MIME相符。Auth僅核對數量，沒有前次完整Auth row Hash，**不宣稱全部Auth內容逐位元未變** |
| 財務歷史 | 原Baseline rowset Hash相同；本輪沒有業務資料寫入、沒有重新計價。空finance表的證據不冒充真實財務操作E2E |

31筆老ledger並非沒有任何SQL：它們有multi-statement arrays，缺少可直接與原檔比對的單一完整source Hash。本輪未重寫ledger／重新封存歷史。改以47個不可變Git來源在全新原生叢集重建**必要自訂Schema相依參照**，與真Staging的同一canonical Catalog projection比較：

| 類別（public／app_private） | 數量 | Hash比較 |
| --- | ---: | --- |
| tables／RLS flags | 25 | 相同 |
| columns／types／defaults／identity | 280 | 相同 |
| constraints／deferrable／validated | 147 | 相同 |
| indexes／validity | 83 | 相同 |
| triggers／definition／enabled | 45 | 相同 |
| policies／roles／USING／WITH CHECK | 57 | 相同 |
| 自訂functions／body／args／SECURITY／search_path等 | 82 | 相同 |
| publication membership／columns／row filters | 21 | 相同，沒有private表publication |

八類Hash完整值見 [去敏證據](qa/2026-10-31-budget-b7-staging-final-predeploy-results.json)。本機pgcrypto原先在public而Managed在extensions，首次函式計數118對82；排除36個extension-owned函式後，自訂82個函式全部相符。沒有排除任何應用函式或改變預期定義以忽略drift。真實Managed extensions位置與版本另查閱；本輪沒有安裝／搬移extension。這證明**現有必要Catalog相依符合來源**，不證明31筆歷史檔案有byte-for-byte來源可追溯，也不是Staging資料備份。

## 2. 執行角色與Managed差異

| 能力 | 實際查核與限制 |
| --- | --- |
| Database／Schema／Function／DDL | postgres非superuser，CREATEDB／CREATEROLE／BYPASSRLS為true；database CREATE及public／app_private／ledger schema CREATE具備。82個自訂函式全由postgres擁有，non-owned清單空；所有public／app_private表owner均可用。這是Catalog能力判斷，**沒有藉CREATE／REPLACE試跑證明** |
| Auth／Storage強鎖 | 封包16個保護表＋ledger所需強鎖權限具備（共17張：13public＋Auth.users＋Storage.objects／buckets＋ledger）。有SELECT及至少一項MAINTAIN／UPDATE／DELETE／TRUNCATE；依PG17規則可取得SHARE ROW EXCLUSIVE。未實際在Hosted取得強鎖、未阻擋服務writer |
| Auth Trigger／FK | Auth.users的TRIGGER／REFERENCES具備；不需要修改Auth表owner。Auth owner為supabase_auth_admin，postgres無SET該owner權限，未嘗試切換或擴權 |
| Storage Policy | buckets／objects owner為supabase_storage_admin，postgres不是owner。但**實際supautils.policy_grants明確列入postgres＋這兩張表**；不能單用owner檢查錯判拒絕，也不能把此例外延伸成任意ALTER TABLE權限 |
| Storage Grant | buckets SELECT及objects SELECT／DELETE具WITH GRANT OPTION；storage/public/app_private schema USAGE可轉授，符合專用Worker grants的需要 |
| 新Worker role | CREATEROLE具備，budget_receipt_worker尚不存在；封包只建立NOLOGIN／NOINHERIT／NOBYPASSRLS並將**新worker role**授予authenticator／storage admin，不是把reserved admin role授予worker。reserved_roles／reserved_memberships已讀回，未修改任何membership |
| Managed預設ACL | postgres在public新增tables／functions／sequences會直接授權anon／authenticated／service_role；app_private無同樣default ACL紀錄。這與簡化fixture不同，已做下述離線補驗 |

`supautils.version`讀回NULL，不能宣稱已確認binary版本；policy_grants／drop_trigger_grants等具體設定與角色membership則已直接讀回。Managed事件觸發器存在，包含PostgREST DDL／drop watcher及平台extension hooks；本輪未觸發DDL。這些平台條件必須在真正部署前再次讀取；不保證未來執行一定不遇到lock／quota／timeout，原子失敗停止規則仍必要。

針對本輪新發現的public直接default grants，在全新空的原生參照叢集只模擬這組ACL，再編譯T0／13／F0：**新public RPC匿名可執行=0、private raw client／worker table grants=0、public／private缺RLS表=0、七組protocol／latch全false**。只補這個新相依風險，未重跑歷史功能套件。這不是Managed owner／Supautils執行演練，更不是Auth／Storage服務驗收或備份還原。

重現本輪離線參照／新ACL相依補驗（全新本機叢集，沒有Hosted連線）：

```powershell
node scripts/qa/run-budget-metadata-parallel.mjs --staging-catalog
node scripts/qa/run-budget-metadata-parallel.mjs --staging-catalog --managed-defaults-rehearsal
```

Canonical SELECT來源為`scripts/qa/b7-catalog-readonly.mjs`；沒有連線／套用能力。Managed預設ACL補驗只跑第二條即可，勿把flag單獨交給歷史Runner。

## 3. Security Advisor

直接查閱指定Staging的Security Advisor頁：**0 errors／9 warnings／2 infos**，沒有接受修正、Reset或Rerun linter操作；這是當時顯示的分析，不宣稱全新深度安全審計。首頁的「no issues」不能代替這一頁。

- 8項 `Signed-In Users Can Execute SECURITY DEFINER Function`：Timeline schedule／date change／三種reorder／swap、request membership、budget rates。全部owner postgres、固定search_path、anon EXECUTE=false、authenticated EXECUTE=true；anon／authenticated對public CREATE=false。函式body與來源相符，來源檢視包含會員／管理權限檢查，request membership限有效invite並只建立pending。這些是既有受控API設計警告，**仍需Review接受，沒有以改SECURITY屬性或盲目撤權消除警告，也不宣稱已做全體負向Auth E2E**。
- 1項 `Leaked Password Protection Disabled`：既有Auth hardening缺口；未變更Auth設定、未升級付費方案。記為P2既有風險，非此封包新引入；正式Auth驗收仍須記錄處理／接受決策。
- 2項 `RLS Enabled No Policy`：app_private.budget_edit_leases／budget_selections。private raw client grants=0，透過受控RPC使用的deny-by-default設計；不新增寬鬆Policy消除提示。另一private request ledger目前RLS=false但無client raw grant，B-7原檔會補RLS；本輪未提前修它。

現有anon可EXECUTE的public自訂RPC僅`get_share_snapshot(text)`；private可讀helper grants供既有RLS／分享流程，不等於匿名財務寫入權限。所有82個函式的實際ACL另計摘要Hash，沒有套用本機fixture ACL覆蓋Managed grants。

## 4. 備份／還原：BLOCKED，未產生副本

Dashboard實際顯示 **Free Plan does not include project backups**，且專案沒有scheduled backup。官方說明免費方案應自行logical export；PITR是付費方案附加能力，本輪未開啟。DB備份只含Storage metadata，**不含bytes**。[Supabase Backups](https://supabase.com/docs/guides/platform/backups)

本機可用設定只有前端URL／anon與Maps變數；僅列變數名稱，未輸出金鑰，也未從瀏覽器session擷取token。Connector無此專案權限，Dashboard SQL結果表不是pg_dump介面。使用者明確回覆沒有直接／Session Pooler憑證。**停止備份匯出路徑**，不重設密碼、不掃描其他帳號憑證、不提高角色、不用anon/RLS可見資料假裝完整dump、不自製SQL拼裝恢復取代官方備份。

| 備份／還原工作 | 狀態／原因 |
| --- | --- |
| 真Staging DB logical dump | BLOCKED，沒有可用匯出連線憑證 |
| Git外加密備份檔／檔案清單 | 未建立；沒有可宣稱的備份目的地／大小／Hash |
| source／copy SHA-256 | N/A，沒有備份檔；封包／Catalog／rowset Hash不是備份Hash |
| Archive可讀性／TOC | 未執行，沒有archive |
| 全新隔離目標restore／counts／FK／Hash | BLOCKED，沒有真備份可還原；原生來源參照不計入此項 |
| Storage metadata／bytes | DB觀測objects0、private bucket1，沒有需下載的已登記object；未做獨立bytes inventory／下載，不能認證無外部orphan |

最低可行替代：由專案擁有者在可用既有DB連線的受控電腦，依官方指引輸出logical backup，或提供Git外受保護連線設定檔；**不在聊天貼密碼／dump**。若必須新設憑證／擴權／付費，先另授權並由使用者處理安全憑證流程。也可只交付本機備份檔路徑供離線驗證，無須交出連線密碼。

備份計畫須覆蓋public／app_private schema＋data、Auth必要帳號與關聯、RLS／policies／functions／triggers、非密碼角色定義及memberships、ledger、必要managed Auth／Storage schema相依與extension清單、Storage metadata和bytes獨立清單。Active tokens／Vault secrets／無關telemetry等額外敏感範圍須先確認必要性，不能盲目整庫擷取。保留加密原檔與working copy，目的地Git外、僅當事使用者可讀、金鑰與備份分離；核對檔案Hash、來源一致snapshot、範圍／排除項與時間。

還原應先檢視archive TOC與SQL、確認版本／extension／managed owner相依，在**全新隔離目標**執行；核對原始資料數量、必要FK、逐表原始欄位投影Hash、Baseline及歷史成本、Auth／Storage metadata關聯、RLS／ACL／ledger。原生PG17可作部分DB驗證；若缺managed extension／Auth／Storage schema而不能完整恢復，繼續標示該範圍BLOCKED，不能跳過失敗物件取得通過。Supabase CLI dump需要Docker的路徑不適用目前限制，不啟動Docker；原生pg_dump需明確處理managed internals與版本相容，不等於整套服務可還原。Roles、外部服務設定與Storage bytes都需另外處理。[官方restore說明](https://supabase.com/docs/guides/self-hosting/restore-from-platform)、[PG17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html)

## 5. 現有部署封包最後差異

執行新增的**純讀取、無DB連線、無重新封存**檢查器：

```powershell
node scripts/qa/check-b7-staging-packet.mjs
```

結果：raw SHA-256仍`4d43bddf6ed7853daa3008c51b58d76b868553330b919f885d82a200f546698b`、1,488,439 bytes；15個來源及全部supporting seals相符；現有生成器產物與交付SQL完全相同；一個top-level BEGIN／COMMIT。T0→13個B-7→F0正確，舊hotfix不重播；47→62 exact ledger與original-column保護仍在。

全部38個compiled before／after原文Hash及逐字替換重新核對：只換78個已分類SQLSTATE literal，54 PT409／24 PT500，其餘body文字相同。未碰engine40001／40P01，動態Save Guard仍在。**這些是已封存候選定義的離線檢查，38個B-7終版函式尚未在Hosted安裝，不能說已讀回Hosted after Hash。**

鎖定在首次preflight讀資料前、lock_timeout5s；初始statement_timeout60s，F0將其收緊至30s（每個statement，非整個維護時窗上限）。失敗ROLLBACK；提交後Forward Repair，不刪歷史／ledger、不破壞性還原財務資料。七組DB開關／latch本機重建保持false；兩個frontend opt-in預設仍需明確字串true，tracked／local設定未改。原封包、manifest、全部61個active migration及product source均未修改；沒有用重新封存Hash消除差異。既有 [Runbook](operations/budget-b7-staging/README.md)仍適用。

## 6. 問題分級與下一輪最小授權

| 等級／事項 | 判斷 |
| --- | --- |
| **P0：獨立真實備份可讀／可還原缺口** | 未解，直接阻擋Dormant Schema部署；不因交易rollback已測而豁免 |
| P1：Managed實際DDL執行／新role grant | Catalog能力與具體Supautils授權已核對，沒有已確認的權限缺失；**未做Hosted試寫**，不視為已演練。真正執行仍須逐條fail-closed，不能遇錯後升權或刪掉Guard／鎖 |
| P2：Advisor既有9 warnings／2 infos | 如上記錄，Review需接受或另行安排修正；本輪不改無關功能／Auth／RLS |
| H01～H03／Activation | 仍未完成、未授權；不是Dormant schema本身已啟用的證據 |

**先解除備份／還原P0並Review，再談部署授權；本輪不請求立即部署。** 備份完成後的最小授權建議文字應明列：

> 僅對`uyqdopksfysbobhjcepk`，在確認維護時窗、重新唯讀核對未drift及備份／還原已通過後，以已核對的postgres角色執行本封包指定Hash的完整單一交易：T0＋13 B-7＋F0和ledger47→62。授權範圍包含封包內必要public／app_private DDL、Auth trigger／FK、Storage policy／grants、新NOLOGIN／NOINHERIT／NOBYPASSRLS Worker role及必要membership，並執行獨立readback。任何失敗rollback並停止；不重播舊hotfix、不額外擴權、不修改原財務資料。所有Protocol／flags維持關閉，不建立QA帳號或旅程、不上傳檔案、不啟動Worker／排程、不合併main或部署Vercel。

新的QA／Storage HTTP／專用Worker JWT／排程／Activation授權必須分開；本輪不能自動進入。若備份前提無法完成，維持NO-GO，不以另一份source fixture替代。

本輪交付含去敏Catalog／權限結果、offline checker與native catalog reference工具；沒有備份／個資／金鑰／原始診斷日誌進Git。必要Syntax與diff檢查完成；沒有重跑不受影響的產品單元／Browser／Build。本機叢集停止，SQL面板未儲存；完成Commit／Push後停止等待ChatGPT Review。

補充官方依據：[PG17 LOCK權限](https://www.postgresql.org/docs/17/sql-lock.html)、[Supabase Supautils的Policy grants／reserved memberships](https://github.com/supabase/supautils#table-ownership-bypass)。具體Managed設定以本輪實讀為準，不以文件預設猜測。
