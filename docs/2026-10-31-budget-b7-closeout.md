# Budget B-7｜完整收尾執行紀錄

2026-10-31，起點585daacd2bca27d520202193ac90198fa3433789，原分支codex/budget-collaboration-redesign。唯一Hosted目標Travel-Planner-Staging／uyqdopksfysbobhjcepk。

**本輪已連續完成不依賴憑證的工作；整體B-7未完成，Staging未Activation，Production NO-GO。** 不是每階段停Review：真正阻擋是QA登入／可信專用Worker憑證供應，及API憑證頁自動安全審查拒絕。未繞過、未讀取signing secret、未偽造readiness，沒有Hosted Schema／業務資料寫入或Worker排程。

[去敏結果與來源清單](qa/2026-10-31-budget-b7-closeout-results.json)、[連續操作Runbook／Production來源順序](operations/budget-b7-closeout-runbook.md)。前輪[BUG-030部署7/7](2026-10-31-bug030-staging-deployment.md)仍有效，不當成本輪新HTTP證據。

## 驗收矩陣

| ID | 項目 | 狀態 | 本輪證據與界線 |
| --- | --- | --- | --- |
| LIVE-BASELINE | Fresh Staging Ledger64, original28 fingerprints,38final functions,roles/Storage policies,seven OFF | Passed | Real Dashboard read-only SQL; compared unchanged previous checkpoint; no Hosted DDL/DML |
| LIVE-SOURCES | Staging Ledger to Git source inventory | Passed | 64 classified:32 exact,31 historical without full source,1 exact full-source readback differs by one trailing LF; no resealing |
| INCOMPLETE-LOCAL | Legal Lifecycle+Pricing fixture, existing-child INSERT/UPDATE/DELETE rejection | Passed | New native integration case for Budget and Actual; no direct child seeding or Guard bypass |
| INCOMPLETE-HTTP | Same legal fixture under real ordinary JWT | Blocked | QA credential supply unavailable; valid fixture requires Lifecycle/Finance activation; no fake HTTP proof |
| STORAGE-HTTP | Over10MiB/MIME/private/Signed URL/bytes SHA-256/receipt lifecycle | Blocked | No current ordinary QA JWT. Historical small PNG/MIME/private/Signed URL passed, historical overlimit deadline unresolved; no rerun this round |
| WORKER-ADAPTER | Bounded Staging adapter with project/role/expiry and exact QA claim scope | Passed | Four local safety tests; no signing secret, no Hosted Worker execution |
| WORKER-LIVE | Trusted short JWT/headers/claim/lease/cleanup/retry/restart/two scheduled cycles | Blocked | Dedicated token not supplied; ordinary/service-role substitution prohibited; zero Hosted cycles this round |
| ACTIVATION | Conditional Staging Protocol/Readiness/flags activation | Blocked | Authorized in principle, safety prerequisites unsatisfied; no attestation or flag changed |
| FULL-E2E | Real independent Browser Auth sessions and complete collaboration flows | Blocked | Requires QA credentials and gated Activation; no real-session E2E claim |
| LOCAL-INTEGRATION | Marked native PostgreSQL financial/integration concurrency | Passed | 27/27; original26 repeated once only to add legal fixture coverage; latest27 used, not summed |
| LOCAL-CONTROLLERS | Nine collaboration Controller suites | Passed | 136/136 local tests, not Hosted service evidence |
| LOCAL-PLAYWRIGHT | Integration/Forward suites (8 browser cases +2 verifier/Worker unit cases) | Passed | 10/10. Browser cases use Mock backend or Demo; includes1440/820/390; not real Staging multiuser |
| BUILD | Production Build, syntax and immutable packet checks | Passed | Build passed with existing large chunk warning; originals/managed packet unchanged |
| ADVISOR | Managed Staging Security Advisor rerun | Passed | 0Errors10Warnings23Info; no drift from prior checkpoint; existing findings retained |
| PRODUCTION | Exact Production install / merge / deploy readiness | Blocked | No Production access; live baseline/catalog/backups unknown; Staging live gates incomplete. NO-GO |

Passed是各列明確定義的範圍，不把本機Mock／SQL fixture叫作真實Staging。整體沒有新增已確認的產品功能Failed；早期本機環境失敗與阻擋均保留，不灌入Hosted通過數。

## 實際修正／新增

- 合法Incomplete fixture：普通角色呼叫Lifecycle placeholder，再用Pricing RPC建立2個真Participants；Title留空使record_status仍incomplete、pricing_ready=true。Budget／Actual各自的INSERT、針對既有row UPDATE、DELETE都55000且每次整圖不變。沒有用空集合UPDATE／DELETE冒充Guard拒絕，也沒用管理員直接造child。新案例併入原26項整合，最新27/27；這不是Hosted實測。
- 有限Staging Worker adapter：只接受此project／issuer、專用role、最長15分鐘JWT；本機decode只做准入，真正簽章由Supabase驗證。每批20項、每transport10秒、2～8輪／15～60秒，不裝常駐排程。不讀signing secret或移除舊loopback CLI guard。新scope要求5分鐘內唯讀證據、原始資料保護、無QA範圍外intents/queue；有既存QA durable jobs才可重啟，範圍外claim在Storage／finish前停止。空兩輪不算清理／重試通過。4項本機測試Pass，Hosted零輪。
- 離線Release稽核：核對真實64筆ledger、所有本機來源及17個B-7依賴來源。32精確相符；31筆舊記錄沒有完整source；20260819125851的Hosted完整source比Git多一個檔尾LF，兩個不同SHA都保留，執行SQL相同。最初innerText會壓縮SQL字串空白，改用textContent取回原文並與後端SHA一致後才分類。沒有改舊Migration、Ledger或封存Hash。

## 回歸與實際UI

Native27/27（真多連線，SQL角色／Auth schema fixture）、Controller136/136、Playwright10/10（其中8個瀏覽器案例、2個本機verifier/Worker案例）、adapter4/4。先前26項跑完後為加入合法fixture重跑，僅保留最新27項計數；為匯出視覺證據重跑4個已過案例，不加總。Production Build通過，保留既有大chunk提示。兩份原封包checker通過，沒有重封或部署。

Playwright證明Formal Mock UI的autosave/PT409/PT500草稿保存／付款恢復、Portal／Modal／IME／Undo鍵盤歸屬及Demo1440/820/390基本操作。Demo不發出Supabase／匯率API請求，console及overlay斷言通過。既有Browser plugin技能未提供，採repo的Playwright；CUA讀Dashboard正常，但localhost頁面兩次網路失敗後停止該路徑。先後排除MSIX瀏覽器快取路徑與loopback namespace問題，使用既有官方Chromium和核准本機程序完成；未放寬斷言或提高Timeout。

## 安全查核與資料

新唯讀Staging：Ledger64/head20261031140648、原28保護投影／38函式／Worker能力與Storage policies相符，七組Protocol／Latch／readiness仍OFF。Managed Advisor重新執行仍0Errors／10Warnings／23Info，與前輪逐列Warnings一致；新增私有表no-policy Info是前輪既有項。沒有新測試帳號、旅程或Storage物件，原始資料及既有QA Baseline未改；前輪四筆QA signal繼續保留。

最終獨立讀回時間為台灣2026-10-31 23:54（15:54Z）：完整Catalog／RLS／ACL／Trigger／roles與前輪部署後相符，custom40001=0、有效租約0、其他未完成交易0；原28／38／所有Protocol rows及QA數量前後相同，Receipt intents／cleanup均0。測試server已停止，native cluster已停止。交付的JS syntax／JSON解析、76個本機Markdown連結、敏感內容及git diff whitespace檢查通過；視覺截圖為本機Demo／Mock，未提交原始個資或財務畫面。

## 剩餘P0／P1／P2

- 新確認P0：無。不能據此宣稱可Activation。
- P1發行阻擋：真實Worker身分／Headers／清理／重啟／兩輪、Receipt bytes及生命週期、受控Activation後完整真雙帳號Browser E2E尚未完成；這些是未驗收gate，不聲稱已重現產品缺陷。Storage >10MiB過去transport失敗仍未解。
- 操作先後需明確：Incomplete的合法建立要先有Lifecycle，Receipt使用流程需啟用，而Receipt啟用要求平台Worker能力。先測平台及受控QA canary能力，後測啟用後使用流程；不把完整Receipt生命週期當成尚未Activation即可跑完，也不先填true。真QA canary的scope／原始物件／intents／queue必須可核對，沒有真簽章及HTTP成功就不能用SQL fixture取代。
- P2：既有500/55P03租約映射、大bundle；歷史31筆source缺失、1筆額外LF的精確來源差異。不能盲推全部Migration。

API頁讀取被自動安全審查拒絕，理由是可能暴露Staging API／簽章秘密且缺明確來源存取授權。已提出最小安全供應：可信外部短效Worker JWT與QA登入資料以Git外受保護路徑／程序環境提供，或明確授權Staging來源僅記憶體使用。尚無答覆不當批准，沒有改用SQL／瀏覽器Session Token／其他工具偷取金鑰。

後續在供應憑證後沿本次Staging授權連續完成，不另造B-8或逐項Review門檻。Production、main、Vercel、Docker／WSL仍禁止；正式前必須另取得Production明確授權。現在不產可誤執行的Production SQL封包，不合併main、不宣稱整體收尾成功。
