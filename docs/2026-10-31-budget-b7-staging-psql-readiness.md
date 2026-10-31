# B-7 Staging psql 連線準備與停止紀錄

2026-10-31，起點`49e60d428836df716c2b8e7965ed0014e58e1dff`，原分支`codex/budget-collaboration-redesign`。唯一允許目標`Travel-Planner-Staging`／`uyqdopksfysbobhjcepk`。既有指定15來源Dormant DDL／Role／Grant／ledger授權沿用，不含Activation、QA fixtures、Worker／排程、Production、憑證重設或權限擴張。

**結果：psql工具可用，但沒有可用資料庫連線憑證；依使用者指示停止部署，NO-GO。** 沒有嘗試SQL Editor、connector、瀏覽器Session Token或其他部署通道，也沒有啟動Docker／WSL或安裝軟體。

## 本輪已確認

- PATH沒有psql，但現有ignored原生runtime的`psql.exe --version`成功，為 **PostgreSQL17.11**，可使用絕對路徑；不必另外安裝或修改PATH。位置為repo內`.tmp-budget-native-pg/runtime/pgsql/bin/psql.exe`。
- 僅檢查既有連線設定：PG連線／service／passfile／TLS相關環境變數及標準DB URL變數皆未設定；指定或標準libpq passfile／servicefile均未發現可用檔案。Windows目前Roaming、一般桌面profile的標準位置分別檢查，未假設AppData相同；沒有掃描密碼庫、其他專案或瀏覽器token。
- `.env`、`.env.local`、`.env.staging.local`只有前端設定，沒有原生DB憑證key。僅讀取key名稱與檔案存在狀態，未輸出任何金鑰／密碼。
- 原封包仍1,488,439 bytes，SHA-256 `4d43bddf6ed7853daa3008c51b58d76b868553330b919f885d82a200f546698b`；離線checker通過，來源／manifest／seals未改，沒有重新封存。

這只涵蓋已明確可用的本機設定，不宣稱使用者沒有其他裝置或密碼管理器中的既有密碼。未發現可用憑證後，沒有啟動psql網路連線、密碼提示、DNS／IPv6／TLS測試、Hosted查詢或部署wrapper。

## 使用者需從Dashboard準備的資料

1. 開啟指定[Staging專案](https://supabase.com/dashboard/project/uyqdopksfysbobhjcepk)，確認Project Ref完整為`uyqdopksfysbobhjcepk`，點 **Connect**。
2. 優先選 **Direct connection**，記下Dashboard實際顯示的Host、Port、Database、Role；通常為5432／postgres／postgres，Host需包含此ref，不能只依GUC確認身分。若之後實測IPv6不可用，選 **Session pooler** 的實際host與5432，使用Dashboard顯示、包含此ref的登入角色（一般`postgres.<ref>`）。**不選Transaction pooler／6543，不啟用付費IPv4 add-on。** 本輪尚未實測網路可達性，不能說Direct已失敗或Pooler已可用。[官方連線模式](https://supabase.com/docs/guides/database/connecting-to-postgres)
3. 依Dashboard的Database／SSL連線資訊取得所選端點適用的Server root certificate，保存在Git外；後續設定`sslmode=verify-full`與對應`sslrootcert`，核對Host名稱與憑證。這是未執行的準備步驟，不代表TLS已驗證，也不要求變更伺服器SSL設定。[官方psql與SSL說明](https://supabase.com/docs/guides/database/psql)
4. 準備**建立專案時設定的現有DB密碼**。Connect的`[YOUR-PASSWORD]`是待填值；前端anon／service API key不是psql登入密碼。Dashboard連線參數不等於已取得可用密碼。不要把密碼貼到聊天、帶密碼的URI／命令列、日誌或Git；由使用者在本機安全輸入，或放在Git外、只有本人可讀的libpq passfile，再提供檔案路徑。**若現有密碼也無法取得，在本輪禁止重設／擴權的限制下無法繼續；沒有可用的Dashboard開關可替代這個條件。** [DB角色與密碼](https://supabase.com/docs/guides/database/postgres/roles)

Windows的標準passfile是`%APPDATA%\postgresql\pgpass.conf`，亦可明確指定`PGPASSFILE`；service設定可用`PGSERVICEFILE`。建議用Git外的明確絕對路徑，避免Codex／桌面AppData差異。Windows libpq不代為檢查密碼檔ACL，使用者須確保資料夾／檔案安全；本輪沒有建立、修改ACL或讀取任何密碼檔內容。[PG17 password file](https://www.postgresql.org/docs/17/libpq-pgpass.html)、[service file](https://www.postgresql.org/docs/17/libpq-pgservice.html)

不需新增帳號、提高角色、變更connector權限、重設密碼、升級方案或修改資料庫。若沒有現有密碼，保持停止；任何與上述禁止項目有關的新方案須另外討論，不自動執行。

## 部署與驗收狀態

| 項目 | 本輪狀態 |
| --- | --- |
| 原生psql17 | Passed，17.11啟動正常 |
| 封包Hash／離線完整性 | Passed，原Hash不變 |
| Staging連線／實際TLS／Host／Role身分 | **Blocked，未建立連線** |
| 即時Ledger47／Hotfix／Catalog／RLS／ACL／資料指紋／在途交易 | **未重驗**，不能沿用舊資料當本輪通過 |
| 單Session／Transaction／COMMIT | **未執行**，沒有送出SQL，不是執行後Rollback |
| Ledger62／15來源／38after Hash／54PT409＋24PT500 | **Blocked，未部署**；離線候選結果不是Hosted結果 |
| 部署後獨立資料驗收／Preflight／Readback | **未執行** |
| Managed Security Advisor前後差異 | **未讀取**；前次0errors／9warnings／2infos僅為歷史紀錄 |
| Protocol／Latch／前端flags／Worker | 未啟用或修改；本輪未連線讀回遠端值 |

上一輪14:04的最後已驗證狀態為Ledger47、15新版本未登記、B-7／worker不存在；見[部署嘗試報告](2026-10-31-budget-b7-staging-dormant-deployment.md)。這不是本輪即時查核。本輪沒有COMMIT或任何Hosted修改。

## 憑證可用後的既有執行規則

先完成ChatGPT Review與安全憑證／端點準備，再重新即時核對指定ref、角色、ledger、13Hotfix、Catalog／ACL／資料指紋及在途交易。既有指定Staging部署授權沿用，不擴大；純測試Staging的備份門檻仍依使用者決策取消。

psql必須使用`ON_ERROR_STOP=1`與單一持續連線，在該Session設定target，再執行**原檔**；保留內部BEGIN／COMMIT，**不加`psql -1`**，不逐檔、不分段、不重播舊Hotfix、不修改Hash或保護條件。若用wrapper，只能在本機Git忽略位置。錯誤立即退出並確認連線結束、未提交交易回滾；連線中斷／unknown COMMIT先用新獨立READ ONLY連線判定狀態，禁止直接重送。成功後才做新連線的62-ledger／38函式／權限／資料／七組OFF及Advisor驗收。

**本輪沒有建立wrapper，也沒有執行上述SQL。** 更新CURRENT_TASK與Runbook、文件檢查及原分支Commit／Push後停止等待Review；不自動開始H01～H03或Activation。
