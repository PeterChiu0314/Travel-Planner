# Issue #15 B-6 — 五步 Undo 完整整合與 B-5 P2

2026-10-30，分支 `codex/budget-collaboration-redesign`，本機／GitHub 確認起點 `ed80aaec803d96c50c63204e8c528f7d99f54299`，開始時乾淨。使用者授權本機實作、隔離測試、文件、原分支 commit/push。沒有 Hosted Migration、正式資料／Storage／設定、main merge 或手動部署。

## 支援矩陣

| 操作 | 實際行為 |
| --- | --- |
| Budget／Actual Title、Note、Category、Payer | 窄寫 inverse；保留 Payer 合法 null，非 null 再驗證 approved member；不清歷史 subcategory |
| Budget Links | 使用原 Links 租約與同 Trip 參照檢查，還原該項目行程 ID 集合，不覆寫其他欄位 |
| Pricing／Participants | 原 Pricing Bundle、calculator、精度及 known-debit 規則；逐端還原原計價輸入及有效 Participants／shares，金額由 DB 重算 |
| 合法單筆 retained Budget／Actual（含 inactive） | Title／Note／Category／Payer 與受既有 Pricing 契約支援的 Pricing，整組原子 inverse；每端可有不同 before-value，沒有只還原 Budget 的捷徑 |
| 空白 Placeholder Create | 僅仍是原始空白、未引用／修改／付款／收據，所有群組與 Lifecycle fence 仍吻合，且沒有他人租約時，可用 Lifecycle 刪除作 inverse |
| 修改過又還原空白的 Placeholder | 不冒充原建立狀態：群組 revision 已變，即使文字相同也拒絕舊 Create Undo |
| Payment、Source Conversion、Receipt、Rates、明確 Delete | 不提供 inverse；成功的非 no-op 形成該 Actor／Tab／Trip Stack 邊界，失敗／No-op／Replay 不重複清除新步驟 |
| 不合法來源圖、多 retained、失效 backlink、stale Rates／Membership／Graph、已知實付成本受損 | 拒絕整筆 inverse，保留 Stack Top，不跳步；沿用前階段 fail-closed 契約 |
| 已完成項目將退回空標題／無效計價／空 Participants | 拒絕，不把 completed 狀態退回 incomplete 來繞過驗證；歷史非 canonical 文字不能透過窄寫恢復時也明確拒絕 |

本階段沒有新增 Undo 面板、列表、按鈕、Redo 或選擇任意歷史步驟。

## 擴充既有 DB 原型

唯一新 forward migration：`20261030082712_budget_workspace_undo.sql`（已安裝 Supabase CLI 建立）。起點既有 58 份 migrations 不修改。沿用六張 `budget_metadata_undo_*` private RLS 表、原 Request Ledger、群組租約、效果 manifest 與 deferred-finish 約束；沒有第二套 Undo／財務模型。

既有 Undo protocol 新增 `full_enabled=false`，須既有 enabled 及 Lifecycle／Finance／Metadata 相依協定共同允許。前端 `VITE_BUDGET_UNDO` 預設 false；本地完整 Formal／Demo 測試同時開啟既有 Metadata、Finance、Lifecycle 旗標。所有正式旗標／協定仍未啟用。舊原型及 v1–v9 讀取／成功 Request Replay 保留；Full Bundle 不能走舊單端 Undo RPC 偷渡復原。

Operations 擴充不可變 narrow effect bundle／dependencies；Stack pointer 擴充可變 expected bundle；Lineage 支援新群組。after_revision CHECK 允許根端未變而第二端實際變動的合法 Bundle，真正每端 revision 仍受窄寫 manifest／Finish 控制。private 表仍零 client grants／publication，所有新 definer functions 固定空 search_path，public RPC 是 invoker。只授權 invoker 交易所需的 actor/transaction-bound prerequisites；其他 capture／value／lineage helpers 不可由 client 直接執行。

Admission 在已鎖定的權威 targets 上捕捉 narrow before-value，Pricing 含 Participants／shares，Links 含 ID 集合。Ledger 插入前，記錄每端 after-value／revision／pricing graph、predecessor；Pricing 另綁 rates／membership revision。Create 保存完整原始 row／lifecycle group fence。原始 operation、成功 Request Receipt 及 before-image 不隨 inverse 改寫。

每個 Actor＋Trip＋Document Session 最多五個 pointer；第六次可復原成功只淘汰最舊 pointer，保留操作及冪等 Ledger。No-op／失敗／租約交通不 push、不 pop。Undo 的 request 先查 actor/session/trip/op-bound receipt，再查 Top／全部 effects／lineage，取得原群組完整租約；再次交易驗證後透過現有窄寫 prepare、per-target manifest、DML／Finish 執行。無未驗證整筆 before-row 回寫。任何端或子表失敗，全 SQL transaction 包含版本、stack、receipt 回滾。

鎖順序沿用 trip advisory、approved membership/protocol SHARE NOWAIT、固定父列／群組順序與 child NOWAIT；同帳號另一 Tab 的 capability 也不可搶。Acquire／Mutate 都檢查 fresh Top／revision／dependencies，原 token／epoch 過期就拒絕，精確 release 不會釋放別人的租約。Source／Rates／Payment／Receipt 仍各走原協定。

## 同群組連續 inverse lineage

A→B→C 的第二次 inverse 不使用舊 revision。成功 inverse 同交易驗證：此步的 before-image 等於其確切 predecessor after-image，predecessor 屬同 Actor／Tab，該重疊 target 的 expected revision 等於建立此步時的 before revision，graph 也仍相同，才推進 predecessor pointer 的該 target 至新 inverse revision。其他 target、rates／members／graph 與其他步驟不改。被淘汰 pointer 不復活。

兩端及 Pricing 都逐 target 做這項銜接。其他人曾改同群組又改回原文字，仍會因 revision／lineage 拒絕。其他人改無關項目或 Note 等無關群組，不會因整列 updated_at 變動而拒絕安全 Title Undo。逆向交易不再 push，因此沒有 Undo Undo／Redo 分支。

## Snapshot、Controller 與恢復

Snapshot v10 包裝原 v9，新增每個目前 actor/document 的 `undoRecords` 摘要（count／top identity，不含 before-image），及群組 Effect revisions／tombstone。Viewer 保留 readonly Snapshot、看不到其他人的 Stack。Strict Validator 要求一致的 effect 身分、revision 與 lifecycle existence，離線快取剝除 Undo authority。

`createBudgetUndoController` 是原 Payment explicit-operation Controller 的 strategy，重用單一在途 transport、10 秒 authority deadline、未知 request／原 ID、精確 cleanup、generation fence、Snapshot 重試與 ActiveEditorGuard；沒有第二套 pending-operation manager。額外只排隊使用者的 Ctrl+Z 次數，DB 仍是唯一 Stack。

- ACK 遺失：先查證原 Request ID／operation，不送下一步，不重複 pop。
- 已確認 ACK、Snapshot Pending／Timeout：保留已確認 receipt，只重讀；Snapshot 的每個影響群組 revision／deleted fence 必須至少包含 ACK 效果，不能只用另一個不相干 Top 判定成功。Late Snapshot 不覆寫較新輸入。
- 確定版本／權限／租約拒絕：不跳過 Top，不強制覆蓋；重新按 Ctrl+Z 可重新驗證。
- 切換項目、右側面板、旅程／離開預算時，沿用 guard 處理未提交內容及待確認 inverse。未知 transport 不允許靜默離開；強制帳號 Context 變動時舊 ACK 不操作新 Context。

Document Session 只在記憶體，重複 React render／StrictMode factory 維持穩定；新 Document、帳號或旅程 Context 變化會換 UUID，即使切回舊旅程也不恢復原 Stack。離開時盡力以已授權 actor 清除舊 session pointers；若斷線／已登出不能清，舊 session 仍不會被恢復。Undo request 不存 localStorage／sessionStorage；既有其他群組的安全 pending-request 恢復規則不變。

## Ctrl+Z 與 Demo

BudgetWorkspace 直接處理表單外 Ctrl+Z／Cmd+Z。文字／搜尋／Number／Textarea／Contenteditable（含 plaintext-only）／IME 保留原生行為；Shift+Z、Ctrl+Y 不提供資料 Redo。對話框存在時不穿透觸發。連按只序列送出一個 inverse；錯誤停止佇列保留 Top。Sonner 與原 inline status 顯示已復原／沒有可復原／衝突／待確認，沒有額外 Undo 控制項。

Demo 使用同 UI、Controller 及既有 calculator，新增 memory Adapter 模擬同一五步 pointer／lineage／request receipt／lease 契約。財務資料以既有 Lifecycle delta 安裝，各端先計算／驗證完才一次套用；沒有 Auth／Supabase RPC／Realtime／Storage 或持久化。Demo 使用原本保守 global graph，不能據此聲稱已驗證真正 DB 授權或跨使用者吞吐。

## B-5 P2 修正

1. 分類個人小計：先 `grouped.filter(isBudgetComplete)`，再 `recordAllocations`。同分類完整＋未完成時，完整紀錄的個人小計正常，未完成列仍顯示未完成。
2. 行前「其他付款紀錄」：只從 Complete 且 payment_active 的有效實付集合取無 Budget 關聯列；完整的有效 Actual 繼續顯示，Incomplete／inactive 不冒充 NT$0。正常實付列表仍保留 Incomplete（B-5 相關 UI 回歸通過）。

## 驗證

[選定 QA JSON](qa/2026-10-30-budget-workspace-undo-results.json) 包含逐案例結果、各 run 的 bootstrap/migration hashes、真正 blocking observations、已停止 cluster 與 final source hashes。

| 層 | 結果／範圍 |
| --- | --- |
| B-6 原生 PostgreSQL17.11 | 33/33，兩個獨立 LOGIN/backend/JWT/Session、READ COMMITTED、新 initdb loopback-only；2 個觀測到阻擋圖的真實重疊（Undo＋peer Note 同時成功；Undo＋舊 Title admission 衝突） |
| Finance 原生直接相依 | 31/31、4 個觀測重疊；Full flag 關閉時 Payment／Pricing／retained Metadata／Rates／legacy fencing／舊單端 Undo 保持原契約 |
| Lifecycle 原生直接相依 | 27/27、3 個觀測重疊；空白新增／readiness／UUID／tombstone／raw helper guard／已知扣款／刪除回滾保持原契約 |
| Playwright／Controller | 111/111、10 個 spec；本機 Chromium＋Vite5180，Formal controlled Mock、Demo memory。Browser plugin 未提供，沿用專案 Playwright |
| Build／Syntax／diff | 通過；Production Build 僅既有大 bundle advisory。58 份舊 migration LF 正規化來源均保留 |
| 視覺 | 1440×1000 檢視 Ctrl+Z 後 JPY fare 恢復、400／每人200 小計與原詳細頁，沒有新增歷史 UI、Vite overlay 或 Console error |

原生新增案例包括六步淘汰／連續 inverse、各欄、不同端 before-value、active/inactive retained、跨端 Pricing／Participants、第二端故障回滾、空白 Create inverse／修改後拒絕、completed 退化拒絕、late request replay／expiry／跨 tab／跨 trip／revocation／viewer、rates/member CAS、所有不可逆邊界、private ACL、同群組跨端及 Pricing 連續 inverse、歷史空 Actual title 拒絕、incomplete Title 恢復空白。歷史異常列僅由隔離 fixture 的管理員停 trigger 初始化，用來驗證 inverse 必須拒絕；應用授權／財務檢查沒有為測試放寬。

Controller／UI 以 Deferred gate 驗證 Unknown ACK 原 Request、單一在途、連按順序、已確認 ACK＋永不 Resolve Snapshot 只讀恢復、Late ACK Context、原生輸入優先、重新整理新 Session、Demo 無外部服務及 P2。沒有重跑所有歷史套件；既有 Metadata/Undo PGlite 數字是前階段證據，本次不列為新驗證。

本次 Receipt 邊界案例只使用隔離 PostgreSQL 的 `storage.objects` fixture 與 RLS／intent metadata，沒有真實 HTTP bytes／Hosted Storage／worker。其 storage_verified／cleanup_worker_verified 是該本機 fixture 的測試設定，不能當作正式驗收。沒有嘗試本次 Hosted／Advisor／部署。

## 修正過程與剩餘界線

- 原型未支援的跨端 inverse 不能只把舊 flag 打開：須記完整 narrow bundle、逐端 manifest、predecessor 及 expected revision。
- 原生初輪找到 SQL alias 與 PL/pgSQL 變數歧義、窄 invoker prerequisite ACL 缺漏，皆已修正並重過。
- Pricing fixture 的 equal-mode legacy share_amount 不代表 custom allocation；測試改用真正合法 custom mode 驗證 exact meaningful shares，保留原 calculator 及 Participant whitelist，未放寬安全斷言。Known TWD debit 不能在測試中任意重估，改用可重估的 retained 外幣情境並保留拒絕測試。
- Undo 摘要新增全群組 effect revisions 後，其他 actor 不變的斷言改為完整私有 Stack rows 比對；不把合法財務群組變動誤當另一人的 Stack 變動。
- Session getter 對重複 render 必須 idempotent；新 Context 換 UUID，避免離線清除失敗後回到舊 Stack。

已修改／引用的 Placeholder Create inverse、完成後退化、historical noncanonical text、stale rates/member/graph、失效來源或已知扣款破壞持續安全拒絕。這些失敗不刪 Top，沒有「跳過」UI。歷史 full／metadata request 不變，Ledger 不因第五步淘汰而刪除。

正式啟用前仍需另外授權 Hosted PostgREST／Realtime 真雙帳號、雙 Tab、混合用戶端、PWA／實際 screen reader、效能及 Receipt HTTP／Worker 驗證。本次不啟用，也不擴張未定義 Source 歷史轉換。B-5 的外 parent cascade（例如整旅程刪除）限制沿用原交接。

## 檔案與接手

- DB：新 forward migration、`docs/qa/2026-10-30-budget-workspace-undo-rollback.sql`（僅 dormant/unused local reverse；已使用須 forward repair）。
- Controller／Snapshot：新 `src/lib/budgetUndoGroups.js`；既有 `budgetMetadataConfig.js`、`budgetMetadataService.js`、`budgetSync.js`。
- UI／Demo：`src/App.jsx`、`BudgetWorkspace.jsx`、新 `src/demo/budgetUndo.js`；既有 Demo Metadata／Lifecycle 的 adapter 接點。
- QA：新 native Undo cases、Controller spec、Formal UI spec、Undo Mock；既有 native harness／runner 加 `--undo-full`；既有兩個 Mock helpers 對齊新 document-session export／adapter 接點。
- 文件：CURRENT_TASK、本交接、QA JSON。忽略的 runtimes／clusters／trace／暫存 generator／截圖不 commit。

本機重跑：依先前 Windows handoff 安裝忽略的 PostgreSQL17／pg runtime；`node scripts/qa/run-budget-metadata-parallel.mjs --undo-full`。直接相依用 `--finance`／`--lifecycle`。啟動本機 Vite5180、設定 PLAYWRIGHT_BASE_URL 後可先跑 `npx.cmd playwright test tests/budgetUndoGroups.spec.js tests/formalBudgetUndo.spec.js --workers=2`；全部此次 spec 與數量見 QA JSON。`npm.cmd run build`、`git diff --check`。

下一步：以本次功能分支 commit 交由 ChatGPT Review；不推進 Hosted 或正式開旗標。Git 不攜帶 .env／本機測試 binaries，回家請 pull 原分支並依 handoff 安裝依賴。
