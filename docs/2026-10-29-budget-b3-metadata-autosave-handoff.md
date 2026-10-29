# Issue #15｜B-2 Review 修正與 B-3 名稱／備註自動儲存

2026-10-29；`codex/budget-collaboration-redesign`，起點為本機與 GitHub 一致的 `1d3d1f7946eab593c41cf6906267cdcfc78c7054`。先讀 AGENT、CURRENT_TASK、DESIGN、UX_RULES、B-1、B-2 交接及 [Issue #15](https://github.com/PeterChiu0314/Travel-Planner/issues/15)。使用者本次已授權本機實作、隔離測試、文件及功能分支 commit/push。

這是 **title/note 的 B-3 切片**。功能旗標 `VITE_BUDGET_METADATA_GROUPS` 仍預設 false；沒有 Hosted migration、正式資料修改、protocol 啟用、main merge 或部署。沒有新增／修改 SQL migration、套件或環境檔。付款連動／fixed Budget 等不支援的紀錄仍使用明確的完整編輯入口；沒有擴大金融 DB 原型。

[機器可讀逐案結果、原生鎖等待證據與來源 hashes](qa/2026-10-29-budget-b3-metadata-results.json)；[前階段 B-2](2026-10-29-budget-b2-metadata-ui-handoff.md) 的手動儲存及 value/base-only 待確認請求限制，由本交接取代；其他 DB 安全契約維持。[B-1](2026-10-29-budget-collaboration-b1-contract.md) 仍是完整方案目標，並不表示全部已實作。

## 實際行為

- 名稱／備註各自停止輸入約 1 秒提交，失焦有有效修改立即 flush。普通空白按 PostgreSQL btrim 規則 canonicalize；無實質變更不送 Patch。IME composition 中不提交，compositionend 才重新排程。
- 開啟不 acquire；focus／Tab 才取得群組權限，pending 的首次輸入保留為不可提交 intent。每組最多一個 transport／Patch 在途；儲存期間仍能輸入，更新 queued latest revision。ACK 只確認 submitted revision；較新本機輸入不被舊 ACK／snapshot 替換，使用新的 base 依序提交。
- 成功 ACK 採 DB canonical value。後續讀取失敗保留該值，顯示「已儲存，最新同步待確認」，不 fallback 到舊 financial record，也不重送已成功 Patch。新快照恢復才收斂／解除同步待確認。
- 正常成功沒有 Sonner toast，沒有「儲存名稱／備註」或常態「重新確認編輯權」按鈕。狀態／錯誤及必要重試保留 inline；輸入期間的「修改中」不作逐字 live 通知，穩定的儲存／錯誤狀態使用 polite live region，欄位以 aria-describedby 關聯。
- 成功後仍聚焦就保留同一租約；clean 離組於提交確認後釋放，clean 兩分鐘、dirty/invalid/failed 十分鐘真實 idle 釋放並保留草稿。DB 七分鐘 TTL／60 秒續租維持，續租／快照／成功 ACK 不重設人類活動時間。不顯示倒數；斷線／背景節流仍可能先由 TTL 失效。
- Snapshot、Online、SUBSCRIBED、離線快取都不會製造 capability。讀失敗／離線／隱藏停寫；回復先讀新 Snapshot，再由 DB acquire／renew 確認權限與版本。相同群組版本衝突只保留草稿，不強制覆蓋。
- request timeout／未知回應保留原 request ID、原 base 與 payload，重試先查證相同操作。原 transport 尚未 settled 時重試沿用其 Promise，不另發同組請求。已知 SQL 交易拒絕與結果未知分開處理；失敗不背景無限重試。

## 離開、完整編輯與重載

沿用 ActiveEditorGuard 加上可選 `prepare`／`finish` adapter，其他編輯器沿用原本 Save/Discard。換右側頁籤／項目／關閉／換旅程先 flush 有效修改；失敗、invalid、未知結果或 composition 尚未完成時留在可恢復面板，提供繼續編輯／明確放棄。未知結果未確認不能放棄該操作，避免把已提交與未提交混為一談；本分頁草稿仍保留，意外離頁使用原有 beforeunload 防護。

進入完整編輯的順序：flush 最後一版 → freeze 這次離開中的兩組輸入 → 再確認沒有新 pending → exact token/epoch release → fresh Snapshot → 用 canonical record 取得既有整筆租約 → 開啟完整編輯器。freeze 僅在明確離開的短暫交接，平常 autosave 不阻擋輸入。失敗不繼續；另一人的群組租約由 wildcard guard 阻擋，不能被本分頁清掉。trip/account/generation 與原 editor scope 都阻擋晚到回應操作新旅程。

Formal 的 sessionStorage schema v2：value/base，加上有需要才保存的 **inert pending ledger**（request ID、origin session、原 base、canonical payload）。不保存 token／epoch／任何可寫 capability。相容讀取 v1 草稿。新 document session 還原後仍唯讀；由使用者重試原 request，以原 origin session + null token/epoch 查已提交結果。現有 DB replay signature 不含 capability，會先檢查當下 membership 與成功 ledger；不存在的結果不能靠 null capability 取得寫權，仍須新 Snapshot／真 acquire／CAS。查證後若有較新 queued draft，重新確認權限才提交。

Demo 共用同一個 controller／UI，但只用記憶體 transport 與 React callback，不使用上述 sessionStorage，亦不連 Supabase、Auth、Realtime、Storage 或匯率 API。

## 變更檔案

| 檔案 | 改動 |
| --- | --- |
| [budgetMetadataService.js](../src/lib/budgetMetadataService.js) | 在既有每組 controller 加 debounce、composition、local/submitted revision、單一 transport、queued drain、canonical／syncPending、prepare/finish、失敗停排程及 inert reload replay；保留權限／CAS／generation／exact cleanup |
| [BudgetMetadataEditor.jsx](../src/components/budget/BudgetMetadataEditor.jsx) | 移除常態手動儲存、共用 autosave/IME handlers、inline 狀態與 retry、固定使用 controller display、guard adapter、idle 後真實操作重新取得權限 |
| [BudgetWorkspace.jsx](../src/components/budget/BudgetWorkspace.jsx) | 群組交接後重讀 canonical record 才進整筆 editor，前後檢查 scope |
| [App.jsx](../src/App.jsx) | 既有 ActiveEditorGuard 選用 prepare/finish；沒有新增平行狀態管理／全域寫入路徑 |
| [budgetMetadata.spec.js](../tests/budgetMetadata.spec.js) | 原 20 項延伸至 35 項 controller 測試；調整 blur 預期為自動提交後釋放 |
| [formalBudgetMetadata.spec.js](../tests/formalBudgetMetadata.spec.js) | 原 18 項手動操作改 autosave，新增至 32 項真 React＋隔離 backend 畫面驗證 |
| [budgetMetadataMock.js](../tests/helpers/budgetMetadataMock.js) | 加 Patch barrier 及 legacy wildcard 對群組的互斥，原權限／版本斷言維持 |
| [budget-metadata-parallel.mjs](../tests/budget-metadata-parallel.mjs) | 原生 30 項保留，新增三項使用實際 named SQL RPC 的 B-3 controller 驗證 |
| [CURRENT_TASK.md](../CURRENT_TASK.md)、[UX_RULES.md](UX_RULES.md)、本文件及 QA JSON | 更新當前狀態、default-off autosave 例外、逐案證據與驗證限制 |

既有 migration、RLS、授權、版本、交易／付款／參與人／收據／匯率程式沒有降級或放寬。

## 測試結果與驗收對應

| 層級 | 結果 | 證明範圍 |
| --- | --- | --- |
| Controller／本機記憶體 transport | **35/35** | pending intent、無權不可提交、1 秒 debounce/no-op、blur、composition、串列 queued revision、ACK/讀失敗、未知結果/timeout/重載、CAS、idle/續租、auth 停寫、ABA、exact release 與 finish freeze |
| Playwright／Chromium 真 React | **32/32** | Formal 隔離 shared backend 與 Demo memory-only；兩帳號、同帳號不同 tab、獨立群組、同組排他、IME 事件、儲存中輸入、canonical 讀失敗、dirty/sidebar/close/item/full editor、失敗/重連/衝突/未知結果、別人租約／跨旅程、idle 後首次 Unicode 刪字 |
| 原生 PostgreSQL 17.11 | **33/33** | 原 30 項安全／RLS／交易案例全部保留；新增 debounced queued title 與另一個 note writer 真重疊、canonical 讀失敗＋重載無 capability replay、dirty flush→release→legacy lease |
| 舊 metadata SQL／PGlite | **23/23** | RLS/grants、私有 effects、idempotency、stale epoch、rollback、legacy 互斥與金融原值 |
| 三套既有 DB／PGlite | **全部通過** | budget-database、budget-safety-database、budget-leases-database；最後一套用已存在的 LF disposable source mirror 避開歷史 raw-SHA guard，未改 migration |
| 既有 Budget／通知 | **119/119** | 108 項 Budget／controller／通知邏輯與 11 項 rendered Sonner；旗標預設關閉 |
| 路由／Demo／Share／Timeline smoke | **30/30** | 完整 smoke 重跑；未改測試斷言 |
| Production build／syntax／diff | 通過 | 既有大 bundle advisory 仍存在，不擴大本階段範圍 |
| 真正 Hosted | **未執行** | 沒有 PostgREST、WebSocket、真帳號 Production／Preview、多裝置或 Storage bytes 驗收 |

不把本機 HTTP Mock 宣稱為真 DB；PGlite 是單程序 SQL 安全驗證，真正並行由 native PG 補足。原生 final run `099a5815-d31c-43c1-a4e7-5b8332abf386`，loopback `127.0.0.1:1349`、兩個獨立 TCP backend/LOGIN/JWT actor/tab session，加第三個 observer。20 組 pg_stat_activity／pg_blocking_pids 觀察記錄證明 active SQL 真實等待；新增 A 在 mutation 後持交易 barrier，B 的 note mutation 確實重疊等待，才放行並驗證最後兩個欄位。READ COMMITTED，12s statement／6s lock／200ms deadlock timeout；runner 新 initdb、marker 驗證、不接受外部 DB URL，finally 停止 cluster。

群組 67 項完整通過；最後補正首次刪字的 Unicode grapheme 處理後，受影響的 Unicode／IME／儲存中輸入／idle 刪字 4 項另通過，不把重複案例相加成 71 項。

QA 案例對照：需求 1–5、8 見 1 秒／blur／composition／queued typing／canonical-read-failure；6–7 見 A-title/B-note 與同組唯一 holder（Mock＋native）；9–10 見 dirty full handoff、patch/release failure、CAS、offline/reconcile；11 見 clean 120000ms、dirty/invalid/unknown 600000ms 與七分鐘 expiry controller；12 見同帳號 tab、兩帳號、ABA／late admission／late patch、跨旅程；13–15 見 Demo、零 hosted API 請求與旗標關閉回歸。controller 使用可控 clock／真 Promise gates，UI 使用正式 debounce，native 使用真正交易 barriers；不以依序呼叫冒充重疊。

## 發現、修正及驗證界線

1. B-2 UI 在 verified=false 且 clean 時改顯示舊 record；現由 controller canonical/display 作唯一來源，首次缺 RPC 的唯讀值僅初始化，不會覆蓋已確認 ACK。
2. B-2 一有 request 就拒絕輸入、成功就全量覆寫 value；現按 local/submitted revision 確認，保留 queued latest。同組 timeout 若原 transport 未完成，不另開第二個 transport。
3. Dirty handoff 原先有舊 selectedRecord 風險；現 release 後 fresh read。另補 finish 的短暫 freeze，避免釋放第一組時把剛輸入第二組的文字當 clean discard。
4. 已提交但 ACK 遺失與已 rollback 分開；重載保留無 capability ledger，native 已驗證 null token/epoch 只能讀回既有成功結果。舊分頁持有的其他 lease 不會被新 document 擅自清掉，仍可能等待 TTL。
5. 初輪受限 Chromium 出現 ERR_NETWORK_ACCESS_DENIED，保留嚴格 console 斷言後改在允許本機瀏覽器程序的環境測試。初輪新增案例修正為完整編輯器實際的「項目」label、release 完成後再斷言，以及 timeout 後先確認原請求再切旅程；未放寬 DB 安全條件。
6. 廣泛 smoke 首次 148/149，Timeline 備案儲存後卡片偶發未展開。隔離 `1d3d1f7` 副本同例通過，停止程式編輯後目前版本完整 smoke 30/30 通過；沒有改 Timeline／CSS／該測試斷言。可能是 dev server 熱更新／時序影響，不能僅憑這次重跑宣稱找出根因。

桌面 **1440×1000**，Browser plugin not available，使用既有 Playwright。流程 `/ → 選 Budget → 群組編輯 → focus → 輸入／自動提交 → 另一分頁 committed 值` 及 `/demo/budget`。身份／非空頁／無 framework overlay／console／互動 DOM／截圖均檢查；視覺無欄位重疊或文字裁切。截圖放本機 TEMP 的 `travel-budget-b3/b2-demo-desktop.png`、`b2-other-editor.png`（沿用舊 evidence 檔名，不加入 Git）。其他 smoke 的窄螢幕通過不等於本階段新增 mobile 設計或 physical device 驗收。

## 重跑與下一步

```powershell
# 一般開發預設關閉；Formal UI 測試在 module boundary opt-in，Demo 可另用本機 env opt-in
$env:VITE_BUDGET_METADATA_GROUPS='false'
npm.cmd run dev -- --host 127.0.0.1 --port 5174 --strictPort
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:5174'
node node_modules/@playwright/test/cli.js test tests/budgetMetadata.spec.js tests/formalBudgetMetadata.spec.js --workers=1
node scripts/qa/run-budget-metadata-parallel.mjs
npm.cmd run build
git diff --check
```

native runner 需另備 PostgreSQL binaries（`BUDGET_TEST_PG_BIN` 或忽略的 `.tmp-budget-native-pg/runtime/pgsql/bin`）及 pg8.16.3；PGlite0.5.11 在忽略的獨立 runtime，`PGLITE_MODULE` 指其 index.js。這些本機 binaries／cluster／依賴／env 不透過 Git 交接。Node24.15.0。Native SHA、PID、等待圖、各案例結果見 QA JSON；沒有連 hosted。

下一輪先對本 commit 做 Code Review。分類、計價、付款人、付款／實付交易、空白正式新增、五步 Undo／Redo／歷史 UI、收據 Storage 協定及完整方案 B 啟用都未做。真正 Hosted PostgREST/Realtime、多帳號多分頁、實體中文／日文 IME、瀏覽器原生 Undo 保真、screen-reader 語音與裝置背景節流仍未驗收；本階段只驗自動化 composition events，未攔截 Ctrl+Z。Storage 被禁用／quota 滿時保留記憶體草稿，無法承諾關閉瀏覽器後仍可恢復。
