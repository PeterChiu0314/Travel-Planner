# Staging 真實 HTTP／多人協作自動化驗收｜第一階段，待 Hosted 寫入授權

最新執行以 [2026-11-04 Staging continuation](2026-11-04-budget-staging-acceptance.md) 為準：使用者後續已授權 Staging 真實驗收與手測準備。下列未授權／未執行及5 Passed／29 Blocked是原始準備期的歷史狀態，不能當作目前執行結果或要求重複授權。

基準 `c416b7d`，分支 `codex/budget-collaboration-redesign`。原準備期只新增 QA 工具／測試／交接，沒有修改產品、Migration、RLS、角色、正式 flags 或部署。未操作 Production、main、正式 Storage、Vercel、Docker／WSL。當時使用者授權範圍是建立測試、本機驗證及安全唯讀。

## 實際結果

- [JSON 全矩陣](qa/2026-11-03-budget-staging-real-acceptance-results.json)：34 個 Hosted 驗收群組，**Passed 5／Failed 0／Blocked 29／Not Run 0**。Blocked 表示明確前置條件尚未滿足，不是跳過斷言後通過。這不是34個已執行測試。
- 5個 Passed：4個新 Hosted READ ONLY catalog／row／ACL盤點群組，以及1個真公開 Auth HTTP群組（health、settings兩個GET，皆200）。**已執行 ordinary-JWT業務／Storage寫入／多人瀏覽器群組：0。** Realtime publication/grants正常不等於收到真websocket事件。
- 本機另有 **14/14安全單元測試、6/6 Playwright**，0 skipped；Formal RPC為既有Mock、Demo為本機React。兩者完全不計入Hosted功能Passed。Build與JS syntax通過，既有>500kB bundle advisory保留。未變產品，不重跑先前117個完整frontend或14／23個歷史SQL案例來膨脹本輪數量。
- READ ONLY於`2026-11-03T14:54:43Z`初次、`15:04:37Z`及`15:09:23Z`補充收尾；ledger66／Head20261103113253／source LF SHA7d4a9695…ba2e34c。81張base relations／668列完整摘要前後一致；function／ACL／schema／roles／ledger摘要不變。收據metadata1、objects2直接摘要一致，七協定OFF、既有activated/readiness不變、active leases／pendingReceipt／unfinishedCleanup皆0。最後另讀回新guard SHA、兩條restrictive policy、partial unique index；沒有重播Migration。
- `15:21:44Z`再次在真Staging READ ONLY驗證scoped original-row query：產生有效64位摘要、預定新trip collision0、全81表／668列摘要仍同最初。這只驗證before投影與查詢可執行，沒有執行或聲稱QA after流程Passed。
- 真Staging目前Auth users3，其中2個`qa_run`標記帳號；它們的ID與run hash均符合既有Git忽略的`.tmp-b7-p1/qa-scope.json`。QA Auth sessions0。這證明可優先重用既有QA身分，**尚未登入或取得他們的新JWT**。原使用者與既有旅程不改。

| Hosted群組 | Passed | Failed | Blocked | Not Run |
| --- | ---: | ---: | ---: | ---: |
| R：catalog及公開Auth GET | 5 | 0 | 0 | 0 |
| A：真登入／Undo移除 | 0 | 0 | 5 | 0 |
| B：預算／財務／Baseline／結算 | 0 | 0 | 8 | 0 |
| C：三Session／鎖／Realtime／恢復 | 0 | 0 | 10 | 0 |
| D：收據拒絕／signed URL／合法附件 | 0 | 0 | 5 | 0 |
| Z：獨立收尾讀回 | 0 | 0 | 1 | 0 |
| 合計 | 5 | 0 | 29 | 0 |

本機14個安全單元測試及6個Mock/Demo瀏覽器案例另計。每個Hosted ID的斷言、phase及Blocked原因列於JSON，不與本機結果或歷史QA重複加總。

## 舊工具盤點及重用

| 既有能力 | 本輪處理 |
| --- | --- |
| `run-staging-business-conflicts.mjs`：真Auth／三Session／HTTP conflict | 沿用同樣普通JWT、bounded HTTP、完整graph比較與admin僅初始化原則；不重播其舊baseline／建立新帳號／刪除老QA資料。 |
| `b7-staging-memory-operator.mjs`、`b7-staging-service-checks.mjs` | 舊operator要求Worker signing credential且綁舊cutover／ledger64–65。本輪入口不取signing secret、不簽Worker JWT、不需要Worker／Receipt。 |
| `b7-staging-browser-checks.mjs`、payment／source／resilience modules | 沿用選取器、真Auth session seed、普通RPC與財務不變斷言；舊入口要求七協定ON、v10且含五步Undo，**不直接執行**。新入口採v9、五個非Undo／非Receipt協定。 |
| `b7-staging-vite.mjs` | 直接重用loopback5189、strictPort、忽略私密QA目錄的server；只改子程序env，不改repository或Hosted flags。 |
| `b7-real-response-gate.mjs` | 重用`qaDeadline`；衝突案例只延遲未修改的真admission request，轉送後要求實際409/PT409，沒有fabricated response。 |
| `budgetNativeUndo.spec.js`、Budget workspace mock | 直接重跑既有6個本機案例；保留真Chromium input history與沒有Undo RPC的斷言。 |
| `budgetFinance.js` | 結算預期值直接使用產品既有`settlementBalances`，並以真graph與UI交叉比較。沒有設計新旅途中付款／結算規則。 |

沒有Browser plugin及其browser skill；依`frontend-testing-debugging`使用專案既有Playwright。Dashboard唯讀則使用已登入Edge與CUA；不從瀏覽器擷取Auth/API secrets。此次沒有新的Hosted rendered UI驗收。

## 七協定 OFF 時可做什麼

| 測試 | 是否需要協定ON | 仍需額外授權的原因 |
| --- | --- | --- |
| catalog／原資料摘要／公開Auth GET | 不需要；本輪已執行 | 無Hosted業務／Session／Storage寫入。 |
| 真Auth三Session、舊Undo RPC拒絕 | 不需要 | login／generate-link會建立Auth runtime狀態，目前未授權；不應為單測拒絕而先開五協定。 |
| 舊signed URL GET／新financial sign拒絕 | 不需要 | Storage只讀子範圍、合法既有capability／member session及exact path需先確認；無歷史URL不能合成。 |
| 一般住宿附件CRUD | 不需要Budget新協定 | 仍需新QA住宿／會員與新Storage物件操作授權。 |
| 完整群組編輯、Pricing、Payment、Source、Lifecycle／多人UI | 需要五個既有協定 | metadata為共同基礎，finance供跨端field／Pricing／rates版本，payment／source／lifecycle各有其端點gate。Receipt與Undo不是必要依賴，保持OFF。 |
| 最後原資料／Pause讀回 | 全部恢復OFF後查核 | 與準備期readonly區分，不以「沒有新寫入」冒充執行後cleanup。 |

完整runner為一次跑完整功能而要求新鮮五協定ON證據；若只授權Auth／拒絕檢查，應使用相同`realSessions`／HTTP helper單跑該子集合，不能繞過runner gate或順帶開協定。當前OFF的catalog通過不代表已部署前端的協作編輯已啟用。

## 新入口與執行方法

`scripts/qa/run-staging-budget-acceptance.mjs`預設READ ONLY。`--readonly`與寫入模式互斥。錯誤target、舊ledger／source、缺seal、Undo／Receipt ON、有active lease、過期contract或QA身分不符皆拒絕；不能從`.env.local`誤用Production。HTTP固定Staging且`redirect:error`、10秒deadline、不自動重試。

```powershell
node scripts/qa/run-staging-budget-acceptance.mjs --print-preflight
node scripts/qa/run-staging-budget-acceptance.mjs --readonly
node --test tests/staging-budget-acceptance.test.mjs
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:5175'
npx.cmd playwright test tests/budgetNativeUndo.spec.js --workers=1
npm.cmd run build
git diff --check
```

完整READ ONLY capture需經已登入Staging SQL Editor執行，結果存於Git忽略的`.tmp-staging-budget-acceptance/before.json`；runner不嘗試直接DB或自動取admin key。capture是有日期的觀測；寫入前必須重新capture並通過15分鐘freshness。

`--prepare-scope`只離線配置兩個全新trip UUID，寫`qa-plan.json`與`scoped-preflight.sql`，不登入／建資料，且拒絕覆寫pending run。本輪已準備一份。scoped capture增加原資料保全projection：只排除新trip／其新resource／新object，以及兩個QA帳號的Auth runtime rows。原有其他QA旅程的財務／Receipt也仍在seal內；任何NULL row digest拒絕。OFF時另存`dormant-before.json`，ON後fresh capture存`before.json`。runner會更新exact-created IDs及`after-preflight.sql`；最後Pause後執行該READ ONLY SQL存`after.json`，再用`--finalize`核對原資料seal／schema／ACL／latches／receipt／objects／零QA sessions。Readonly phase不能呼叫finalize冒充QA完成。

**只有收到下節明確授權後**，才可安排五協定enable、fresh active capture、`--authorized-staging-qa --private-stdin`。RAM輸入為`{approval,admin}`，不得放進命令列／tracked檔案；`approval`必須固定target、scope=`isolated-budget-http-browser-storage-qa`、有限expiresAt、exact active contract SHA、reuseExistingQaUsers=true、createAuthUsers／modifyLatches／enableReceipt／enableUndo=false。這份本機資料不是使用者授權本身，不能自行填寫便執行。

新runner實作A/B/C與D01／D04的實際流程；D02需exact現存receipt path符合capture SHA，D03需真實歷史signed URL。未跑過的新Hosted腳本仍須在授權後逐項排除真環境差異；單元測試只證明防護條件，不能證明整套遠端流程已可無人值守通過。

## 最小 Hosted 授權提案（尚未執行）

1. **唯一目標**`uyqdopksfysbobhjcepk`，安排最多45分鐘獨占QA時窗。協定是Staging全專案開關，無法只對新trip啟用；期間其他人不進行Staging編輯。開始重新READ ONLY查核，任何未知drift／在途writer／租約／工作均停止，不kill peer或忽略錯誤。
2. **只暫時變更五個既有`enabled`欄位**：metadata、finance、payment、source、lifecycle false→true，結束true→false。Undo／fullUndo／Receipt永遠false；不UPDATE任何activated、readiness、legacy cutoff；不GRANT、不改RLS／publication／schema、不安裝Migration。`protocolControls()`可離線生成enable/pause兩份review SQL；本機已生成但沒有執行，live封包不提交Git。套用前須新contract／人工確認target，結束須另一次READ ONLY。
3. **重用兩個已確認QA帳號**，不新增／改密碼／改provider。既有Staging admin credential僅在RAM用於兩帳號的identity GET與magiclink generate/verify；不發email，取得A、B、A第二次登入，共3個真Session。三個隔離headed Chrome contexts，所有業務驗收用普通JWT；不需要signing secret、service-role業務寫入或Worker。
4. **最多新增兩個唯一run UUID標記QA旅程**：一個共享（Owner A／Editor B），一個A私有；僅新增該共享trip內的預算／實付／participants／Source／Baseline、分組租約、正常request receipts及collaboration signals。最多3個Budget（含一筆create-delete canary）／2個Actual；不恢復分筆付款。B07只改本輪QA旅程日期／狀態，觀察既有Baseline凍結與旅途中／結算UI，不修改產品規則。
5. **Storage只操作本輪QA object**：一張約70bytes PNG與一筆新住宿attachment，普通JWT upload／sign／read／delete；另對本輪QA Budget合法格式的financial metadata insert及新financial path upload做預期拒絕。若意外成功，標Failed並停止，不把允許上傳當通過或偷偷擴權。既有1筆metadata／2物件完全不改、不刪、不搬、不upsert。
6. **既有收據只讀（獨立子範圍）**：若同意，可安全讀取exact既有financial path（只在ignored/RAM），先與capture SHA核對，再測普通JWT新的sign請求遭拒。D03只有仍保存的真正pre-removal URL可測；URL及token不得進Git／console／trace。沒有歷史URL或它已過期時維持Blocked，不重建或重新簽成歷史能力。本輪**沒有讀取任何Storage bytes或Signed URL**。
7. **結束策略**：正常UI／HTTP釋放本輪租約、關閉contexts/server、普通JWT logout各自session。住宿attachment及唯一PNG按正常API刪除；本輪QA財務歷史／旅程**保留供Review**，不自動cascade清除或admin刪ledger。保留範圍寫入ignored`fixture-scope.json`，後續另審exact IDs清理。不得把保留狀態標成已清空；Z01必須等獨立Pause／sessions／queues／original-row讀回後才能Passed。
8. **失敗處理**：不自動retry未知COMMIT／付款／fixture provisioning。先查exact request receipt及canonical graph；不得猜結果。Pause先等正常editor/leases釋放，遇未知在途狀態保持Failed／Blocked並回報，不能force reset latch或清queue。若中途程式退出，依ignored scope復原／讀回，不能只相信本機status。

## 尚未完成及進入 Production 審查條件

目前 **不具備真實驗收全面完成／Production release GO條件**。可以Review這份測試計畫與工具；正式部署審查仍需要29個Blocked群組的真證據、legacy signed capability處理決策、after原資料保全與全部OFF讀回。普通JWT業務、實際Realtime及Storage未執行，不由catalog／mock或舊B7結果推論通過。

尤其D03若歷史URL已不存在，無法事後重現「原URL在未到期前是否仍可用」；應由Review接受清楚的證據缺口或另定自然TTL／觀察方案，不能改既有金鑰、Storage policy或偽造時間來取得Passed。

## 本輪失敗與修復紀錄

- Supabase MCP READ ONLY回permission denied，未改權限／憑證；改由同一Staging Dashboard執行`BEGIN READ ONLY`，成功。
- sandbox Node初次Auth GET `fetch failed`；相同唯讀程式經核准原生網路執行，兩GET皆200。沒有把transport failure當功能失敗或重試業務寫入。
- 單元測試初輪10/11：無DML字串檢查誤中`has_table_privilege(...,'UPDATE')`的文字literal。改為先去SQL字串再檢查真正語句，仍保留禁止寫入斷言；後加入original-row namespace／NULL projection／after漂移等三項，最終14/14。
- 新original-row READ ONLY SQL初次生成時，JS字串替換把regexp的`$`加單引號解讀成replacement suffix，SQL解析拒絕；沒有DML。改用replacement callback保留literal，增加完整regexp及單一結果alias斷言，再做真Dashboard唯讀驗證；不隱藏失敗，也不跳過保全檢查。
- Playwright sandbox初次6案都在browser launch前因找不到套件私有browser路徑失敗；明確使用已安裝native Chromium後，觀察兩案因跨sandbox loopback逾時，停止該run。將Vite與browser放在同一原生loopback後，完整6/6通過（21.8秒），沒有調整產品／放寬時間或移除斷言。
- 已停止本輪自有5175 Vite；沒有啟動HostedQA5189、Auth sessions、Worker或任何協定。本機截圖／trace不提交，raw JWT／storageState沒有保存。

## 使用者最後的8項UI手動驗收（待自動化完成後，非現在要求手測）

1. 新增一筆預算，修改名稱／備註，確認自動儲存提示及重新整理後內容。
2. 名稱／備註輸入中用Ctrl/Cmd+Z，已儲存並關閉編輯後再按一次，確認資料不回復。
3. 開啟編輯、修改尚未儲存內容後取消，確認提示與保留／捨棄符合預期。
4. 調整金額／幣別／付款人及均分／自訂分攤，確認數值可理解。
5. 付款→取消付款→再付款，確認單筆實付與狀態、歷史呈現。
6. 與另一人各改不同欄位，再嘗試同欄位，確認鎖及協作視覺回饋。
7. 看一次旅途中實付／結算與行前Baseline差異，確認文字／排序符合使用直覺。
8. 確認收據入口、分筆付款、自訂Undo均不存在；住宿附件仍可正常操作。

ChatGPT Review重點：五協定全專案啟用界線、exact QA scope、普通JWT／三Session、after保全、signed URL缺口、未知結果不盲重送，以及不得把本機Passed當Hosted Passed。
