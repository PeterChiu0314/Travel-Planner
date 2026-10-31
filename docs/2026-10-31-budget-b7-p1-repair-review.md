# Budget B-7｜兩項 P1 調查、修正與 Staging 回歸準備

2026-10-31，分支 `codex/budget-collaboration-redesign`，起點 `9ee883e30d0e881c087d322020daa7dbdb7e0c94`。唯一服務目標 `Travel-Planner-Staging`／`uyqdopksfysbobhjcepk`。

**P1-RT-INSERT 已定位並修正，真服務6／6通過。P1-CASCADE正式Forward `20261031130414` 已由官方CLI產生，實際版號的15／15隔離回歸通過，可交ChatGPT Review；Hosted修復尚未授權／未執行。** 本輪沒有Hosted Schema／RLS／Publication／Role／Grant／Ledger／設定寫入，沒有重播Dormant、Activation、Worker、Production、main或Vercel部署。

證據：[去敏時序與結果](qa/2026-10-31-budget-b7-p1-repair-results.json)、[完整Cascade來源／版本門檻／Ledger規則](operations/drafts/budget-b7-cascade-forward/README.md)、[Source manifest](operations/drafts/budget-b7-cascade-forward/source-manifest.json)。較早[啟用前報告](2026-10-31-budget-b7-staging-preactivation-acceptance.md)與原失敗結果保留，不把當時的Fail改成Passed。

## 1. Realtime 根因：JOIN完成早於Postgres Changes就緒

原Runner的事件判斷本身有效：依eventType及新Budget ID檢查兩端首次INSERT，固定10秒deadline，沒有用UPDATE替代。錯誤是**把 `.subscribe(SUBSCRIBED)` 的Phoenix JOIN確認當成資料串流已就緒**。實際Postgres Changes訂閱異步建立，之後另發 `system / extension=postgres_changes / status=ok` 確認。官方[Realtime Protocol](https://supabase.com/docs/guides/realtime/protocol)也區分這兩種訊息。

本輪先保留原JOIN-only方式並重現，加入原生WebSocket入站envelope觀察、SDK system／status回呼、client monotonic elapsedMs、HTTP開始／返回與event commit_timestamp。沒有保存token、JOIN完整payload或QA以外的row值。

| 2026-10-31 Asia/Taipei | 實際觀察 |
| --- | --- |
| 18:44:25.664 | A／B皆SUBSCRIBED；同時開始首次RPC INSERT |
| 18:44:25.876 | RPC返回HTTP200，該Budget後續確實存在 |
| 18:44:28.222／28.804 | A／B才收到Postgres Changes system就緒訊息 |
| 原固定10秒檢查 | 兩端皆無首次INSERT，嚴格斷言失敗，保留於beforeFix證據 |

缺失事件沒有可讀的event commit_timestamp；本輪不把row created_at或HTTP Date冒充精確DB commit時刻。HTTP成功返回界定已提交完成，client端monotonic時序用來比較JOIN／請求／system／callback；server Date與client約有數秒差異，不能直接混算。

### 四種訂閱與RPC／REST比較

同一A／B普通JWT，各自比較 `INSERT`／`*`、有trip_id Filter／無Filter四種方式。無Filter回呼先以保留QA trip篩選，沒有保存或套用其他旅程row。

- 修正前，較早就緒的六個訂閱已收到同一RPC INSERT，最後建立的兩個`* unfiltered`訂閱漏收；之後REST INSERT八個訂閱皆收到。
- 這**不能直接歸因RPC、Filter或INSERT事件類型有bug**：各訂閱的註冊時間不同。System ACK是安全的正向就緒確認，不是精確內部註冊時刻；有些事件可在ACK回呼前已送出。
- 所有欄位的authenticated SELECT／INSERT權限、Budget的publication membership／全部欄位、publication INSERT／UPDATE與RLS已即時核對。後續兩種路徑在相同就緒條件下都通過，排除本案的權限／Publication／payload判斷缺陷。
- Raw入站envelope也沒有漏收通道的該INSERT，因此不是Runner把已收到的INSERT誤判成UPDATE或丟棄。

### 修正與真實回歸

Runner現在在同一固定界線內分別確認JOIN與Postgres system就緒，才開始寫入；沒有固定sleep或延長INSERT事件deadline。18:49:19.781／19.846兩端確認Postgres就緒，19.854開始同一既有RPC，兩端都收到首次INSERT。重跑僅此P1的六項直接相依情境，**6／6 Passed**：

1. 冷啟動兩端Postgres-ready後立即RPC INSERT，兩端首次事件成功。
2. RPC INSERT，兩個真JWT Client的八個訂閱全部收到。
3. 相同權限的正常REST INSERT，八個訂閱全部收到。
4. 後續UPDATE，兩端`*`訂閱收到，INSERT-only不誤收UPDATE。
5. 重新建立訂閱後，兩端收到新INSERT及UPDATE；取消B訂閱後不再收後續UPDATE，A仍收到。
6. QA owner暫把B的QA membership設為pending，B讀不到QA Budget／不能改寫；最後恢復approved。未改資料庫Role／Grant或原有使用者資料。

原Preactivation Runner也套用相同就緒判斷，沒有重跑其完整矩陣。

產品只做最小修正：`realtimePostgresReadiness.js`共用語意判斷；`App.jsx`在system就緒時透過既有coalesced、帳號／旅程／generation防護的Budget refresh做權威catch-up，補上JOIN至CDC-ready間的資料缺口。仍由Snapshot決定資料，不從event row覆寫草稿。直接相依2／2本機測試驗證JOIN不等於就緒、忽略其他extension／錯誤、rejoin重讀、coalescing、舊context／ABA／cleanup拒絕。前端只在本機Build，**沒有部署或宣稱已完成渲染雙Browser UI驗收**。

### 服務日誌界線

連接器的指定project及09:40～10:10Z查詢都回覆無權限；沒有擴權。Dashboard唯讀Realtime filter可讀17:40～18:10台灣時間的28列，包含兩次tenant初始化及`realtime.messages`串流啟動，未見明確JOIN／授權拒絕字樣。這些是預設tenant／messages層log，**不提供每個Budget CDC訂閱／JOIN內部LSN**，不以它推測缺少的內部細節。決定性證據是實際wire控制訊息、原Runner重現及相同RPC修正前後的結果；原始log未提交Git。

**Realtime不需要Hosted設定、Publication、RLS或Grant修復。** 不保證所有任意網路故障下零事件損失；重讀恢復、群組協作等其餘B-7驗收仍遵循原gate，本輪沒有擴張證據範圍。

## 2. Cascade：正式版本與完整來源通過隔離驗證

保留原`20261031100434`草案及before／after函式Hash，不改舊Migration、M0、38final seals或Dormant封包。新[完整source.sql](operations/drafts/budget-b7-cascade-forward/source.sql)只修同一private Guard的必要判斷，新增安裝交易的七Protocol鎖及非body屬性核對。

- 完整來源：**3,546 bytes／LF SHA-256 `19f9c1e6184560052b4a62f4b810573198a225b98e0f80b67b874ad869e4cb22`**。
- Function before：`c3667a091954ed67ea677ff73aed85a5aa57cf292bb02519fcea155521a4a3d5`。
- Function after：`ecd7888508e91b6df351a9ab4e95cf1a3facc426316ee68a868e622b1cdfda51`，與舊草案完全相同。
- 從未Activated且真正FK cascade導致parent已不存在時才允許DELETE；現存Incomplete的INSERT／UPDATE／DELETE仍受保護；曾Activated後Pause的三種Parent Guard仍fail-closed。
- 未知Hash、非Dormant、並發protocol writer、屬性異動都拒絕。OID／owner／ACL／security／search_path與全部RLS／Trigger保持，僅該函式body改成封存afterHash。

### 正式CLI版本與先前時間阻擋

已安裝Head為 `20261031130000`。早先官方CLI產生 `20261031105916`，因早於Head被拒收，當時的Blocked證據完整保留。官方[新檔生成原碼](https://github.com/supabase/cli/blob/v2.106.0/apps/cli-go/internal/migration/new/new.go)使用[目前UTC](https://github.com/supabase/cli/blob/v2.106.0/apps/cli-go/internal/utils/misc.go)；沒有手改時間／版號或舊Head。

使用者選擇21:00後產版，另明確授權一次性21:01同聊天本機續作及Commit／Push。**官方CLI2.106.0於21:04:14台灣時間產生 `20261031130414`，正常退出0；時間阻擋已解除。** [完整版本檔](operations/drafts/budget-b7-cascade-forward/20261031130414_budget_dormant_parent_cascade_guard.sql)與source.sql逐byte一致，3,546bytes，Source SHA不變。封包位於非自動套用目錄，沒有放進supabase/migrations。

- [Packet manifest](operations/drafts/budget-b7-cascade-forward/packet-manifest.json)：真實官方版號／CLI版本／產出時間／完整Source SHA。
- [原子candidate-deployment.psql](operations/drafts/budget-b7-cascade-forward/candidate-deployment.psql)：9,116bytes，SHA-256 `e6db59ea72d45e21e4e7860f37d70cfab1e6d35e483847deba533495d45118a6`；lexer確認只有一個實際top-level BEGIN／COMMIT，repo沒有相同版號碰撞。
- source.sql內「official version pending」註解是早先來源準備時的歷史文字，保留bytes以維持已審閱Source SHA；目前狀態以source-manifest／packet-manifest為準，不把歷史文字當runtime旗標。

第一次21:01呼叫曾建立空檔`20261031130151`後等待：本機execFile未關閉stdin，而官方CopyStdinIfExists會等管線EOF。已核對PID／父子關係，只停止該次本機產檔程序；空檔留ignored、不作候選。修正工具明確關閉stdin，加入60秒子程序界線，再由官方CLI重新產生上述正式版本，沒有手填／沿用失敗版號。初次沙箱另阻擋CLI telemetry設定暫存寫入；產檔及原生PG隔離測試使用受控require_escalated，沒有Hosted連線／SQL或Docker操作。

prepare工具核對來源Hash、拒絕覆寫已發行候選，沒有DB executor；現在再次呼叫會拒絕重發現有候選。後續部署仍須Review＋另行明確授權，不能因本機產版完成而執行Hosted。

### 原子Ledger規則及15項隔離回歸

Ledger只在後續獲授權、正式版本成立時，和函式變更同一Session／單一Transaction由**62→63**。核對原Head／筆數、version／name／完整Source SHA；記錄真實完整SQL原文，不只片段。重複執行只接受同version同source、after body及63/head完全一致的Dormant狀態。未知Head、來源碰撞、錯target、Hash Drift或後段失敗都回滾；已提交後只允許另版Forward Repair，不做破壞性rollback。

隔離原生PostgreSQL重跑原8項，另加7項，**15／15 Passed**，包括：

- 原Budget／Actual cascade故障重現、修正後兩種親列及整trip正常cascade。
- 現存Incomplete Parent的participant INSERT、UPDATE、DELETE拒絕。
- metadata已啟用拒絕安裝；finance／lifecycle／receipt曾Activated後Pause的合成fixture仍阻擋外部刪除／重裝。
- 準確before／afterHash、完整pg_proc非body屬性、全部RLS／ACL／Trigger／財務fixture資料保留。
- 並發protocol writer令修復NOWAIT拒絕；未知body拒絕；過舊／無效日期版號拒絕。
- 寫body後注入故障，body／資料／catalog／ledger整筆回滾。
- 完整source真實登記62→63；重送不變；同version來源碰撞、NULL name／statements／NULL來源元素、未知Head拒絕。

較早Ledger演練使用明確合成版號`20990101000000`，該歷史結果保留，沒有冒充正式版本。21:04之後針對**實際官方版號`20261031130414`及精確Source／wrapper**重新跑15項，全部通過，cluster已停止；這次才是正式候選的隔離證據。paused／incomplete edge資料仍是回滾的native合成fixture，不能當Staging Activation通過。新增fixture初版遇到pending deferred trigger events，修正為先flush再重新啟用，產品斷言未放寬；成功15項的cluster已停止。

## 3. 最後Staging讀回與保留資料

19:02:05台灣時間的新唯讀查詢確認：Ledger仍**62／head20261031130000**，原28組scope投影／38final函式Hash／七組完整Protocol與Latch row／RLS與publication欄位／Worker權限均與測試前相同，七組OFF、Receipt readiness OFF、queues0。Hosted Guard仍是舊beforeHash，確證未套用Forward。原2trip／1Auth user／25itinerary／3alternatives／1Baseline不作mutation目標且指紋未變。

只沿用保留QA帳號及旅程，**本輪新增0帳號／0旅程／8個Budget**（重現4＋修正回歸4），未清理。最後QA圖：2帳號、1trip、9Budget、5participants、1QA Baseline、72groups、12legacy requests、2signals、0Storage objects。精確ID inventory只在ignored本機manifest，Git存Hash。所有測試channel移除、socket關閉、本輪新建Auth Session已sign out；不宣稱已簽JWT立即失效。

QA登入由既有Staging service_role僅呼叫Auth Admin讀取指定QA帳號／generate_link，再由真Auth verify發給普通JWT；不寄信、不重設密碼、不產生帳號、不讀signing secret。所有驗收DML／RPC／Realtime用普通JWT。短暫管理金鑰檔僅目前Windows使用者可存取，啟動網路程序前移除；憑證不在命令列、log或Git。初版Auth adapter誤按supabase-js包裝形狀讀原始HTTP回應，修正flat response解析；該失敗尚未寫Budget。

## 4. 判斷與下一步

| 範圍 | 判斷 |
| --- | --- |
| P1-RT-INSERT根因／Runner修正／真服務回歸 | **Passed，6／6**；不需Hosted設定修復 |
| 最小產品catch-up修正 | **本機Passed**：2／2直接相依測試＋Build；未部署前端 |
| P1-CASCADE邏輯／完整source／原子規則 | **隔離Passed，15／15**；不是Hosted驗收 |
| 晚於Head的官方新Migration版本 | **Passed：`20261031130414`**；完整source／wrapper封存、實際版號15／15通過 |
| Staging Cascade真HTTP修復後回歸 | **Blocked／尚未授權部署**；舊Guard仍在 |
| 程式與已封存source交Review | **GO** |
| Forward部署、Activation／Worker／Production | **NO-GO** |

正式產版、實際版號／Source／wrapper Hash與碰撞檢查、對應隔離Ledger演練均已完成，交ChatGPT Review。21:01續作只做本機工作，未重新連線Staging；19:02讀回是本輪最後完整服務證據，不能冒充21時後即時狀態。後續Hosted最小授權只應包含：這一private函式Forward、必要鎖與一筆Ledger，以及指定保留QA的正常Cascade回歸／受控清理與唯讀驗證；不需要Realtime、Publication、RLS、Role／Grant修改。遇其他Guard／Baseline／稽核阻擋仍保留，不強制清理。

本輪Build、Syntax、新舊Dormant封包離線Hash、JSON／文件／diff檢查通過，保留既有大chunk提示；沒有重跑其他B-1～B-7歷史套件。結束後停止等待ChatGPT Review，不自行部署Forward或進入Activation／Worker。
