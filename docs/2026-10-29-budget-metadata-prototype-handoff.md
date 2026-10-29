# Issue #15｜名稱／備註群組 DB 最小切片

2026-10-29；`codex/budget-collaboration-redesign`，基準 `cab828d`。使用者在 B-1 與租約／Undo 修訂後要求繼續下一步；本次範圍為本機 DB 最小切片。既有未提交的文件整理保留。

## 後續：原生雙連線驗證已完成

其後使用者批准下一個 DB 切片：[群組一致快照與 opaque 通知](2026-10-29-budget-metadata-snapshot-handoff.md) 已完成。本機新增 20261029031137，原有 20261029020551 source 不再修改；STABLE/invoker 新 reader 保留原 financial graph 並附加 group metadata／編輯者／到期提示，沿用既有 RLS signal。最終原生 29/29（本節原 17＋新增 12），18 項有重疊證據；23 個原 metadata 情境、三套 DB 回歸與 38 controller 測試通過。沒有 frontend caller 或 hosted 啟用；下一步為 B-2 title/note adapter/UI。

使用者後續明確要求隔離 PostgreSQL 並行測試，[完整結果與失敗分析](2026-10-29-budget-native-parallel-verification.md) 已完成：原生 PostgreSQL 17.11、兩條不同 PID／LOGIN／actor session，最終 **17/17**（16 項重疊案例＋1 項權限檢查）。每項並行案例保留 server activity／blocking PID 證據，不以序列呼叫代替。

實際重現舊 row-first 交易與 trip-first patch 的 40P01 deadlock；只在這份未套用 prototype 的 prepare helper 加入 Budget/Actual parent **FOR UPDATE NOWAIT**，拒絕持 trip lock 等 parent row，以 55P03 安全失敗、同 ID 重試。最終指定案例無 deadlock；原 23 個離線情境、三套 Budget DB 回歸、build／syntax／diff 通過。四次成功啟動的測試 cluster 均已停止。未連正式 Supabase，沒有 hosted migration／deploy／UI 或金融群組實作。

下文「沒有真正多連線測試」與舊鎖定順序描述保留的是最初切片交付邊界；對此次已覆蓋的並行案例，以此段及新報告為準，hosted／UI／Storage 等 gate 仍不因此完成。

## 已完成與範圍

- CLI `supabase migration new budget_group_metadata_prototype` 產生 [20261029020551](../supabase/migrations/20261029020551_budget_group_metadata_prototype.sql)。**僅撰寫並在 disposable PostgreSQL 執行，未套用 hosted。** 不編輯任何已套用 migration。
- 獨立 title/note 租約與 group revision；相同記錄兩群組可由不同帳號持有並提交，不以整列 updated_at 當 group conflict。
- scope 刻意限於 **無任何 retained Actual、無 fixed/backlink 的 Budget**，以及 **budget_item_id 為 null 且 payment_origin=manual 的獨立 Actual**。有付款關聯的記錄返回 `group_dependency_not_supported`，不偷偷跳過單筆同步或改寫歷史金額。
- API 預設停用。沒有 frontend 呼叫、UI 改動、功能旗標部署、套件檔更動、正式資料操作、commit/push、merge 或 Issue 更新。
- 保留使用者已裁定的方向：成功 patch 後租約仍保留；clean idle 兩分鐘、dirty idle 十分鐘受七分鐘 TTL 約束。五步、目前分頁限定 Undo／無 Redo／無歷史 UI 仍是後續要求；本切片明確回 `undo_supported=false`，尚未實作 Undo 或 autosave controller。

## 新的 API 與私有狀態

| 物件 | 用途 |
| --- | --- |
| public.read_budget_metadata_groups | STABLE/invoker；同一次快照返回 title/note canonical value、revision、epoch、有效 owner／own_session、supported／enabled；不暴露 session/token/hash |
| public.budget_metadata_group_lease | invoker；acquire/renew/release，綁 actor＋tab session＋hash capability＋epoch；acquire 比 group base revision；expired renew 拒絕 |
| public.patch_budget_metadata_group | invoker；只接受一組的一個 title 或 note 欄位；成功返回 canonical metadata、revision、request ID；不呼叫整筆 v4/v3/v2 |
| app_private.budget_metadata_groups | title/note 的 counter 與 lease 狀態；一個 durable PK(kind,id,group) 保留 revision／epoch；release 不歸零，刪除留 tombstone，再建 UUID 仍 fencing |
| app_private.budget_metadata_requests | UNIQUE(actor,request_id)，比對 origin session 與 canonical business signature；成功 replay 不需原 lease 仍活著，不重複寫入 |
| app_private.budget_metadata_effects | 交易／backend／actor 綁定的精確白名單 effect；非 caller 自訂 GUC。deferred constraint 拒絕未完成的 prepare 交易 |
| app_private.budget_metadata_protocol | admin-only singleton，enabled 預設 false。只在測試內由管理角色啟用；沒有可讓 frontend 啟用的 RPC |

所有新 private tables 啟用 RLS、撤銷 client table grants、不加入 Realtime publication。public wrapper 為 authenticated-only、空 search_path、financial UPDATE 使用 invoker/RLS；僅私有 metadata helpers 具受限 definer 權限。helper 也驗證 actor、trip、capability、版本、已核准會員，不能單獨 prepare 後偽造一筆金融變更。

修正後寫入順序為 trip advisory xact lock → 成功 request replay → parent FOR UPDATE NOWAIT → membership／group metadata 保護與驗證 → transaction-bound effect → 原表單一欄位 UPDATE → AFTER trigger 檢查最終 row 差異／版本遞增 → ledger／effect cleanup。parent busy 以 55P03 立即拒絕，避免與舊 row-first 路徑形成循環。AFTER 檢查包含 BEFORE triggers 的全部影響，除指定欄位和 updated_at 外不允許其他列內容變更；因此 standalone Actual 的 known debit／currency／provenance 保持不變。

新 group 註冊透過既有短 trip advisory transaction 序列化，唯一鍵也在 DB enforce；不在輸入期間持有 SQL transaction。每組 lease 只接受正確 actor/session/token/epoch 的 renew/release。新 acquire 可在過期後從最新版重新取得，晚到舊 release 不能解除新 epoch。

## 舊介面互斥與版本追蹤

- 舊 `budget_edit_lease` 的 private table BEFORE trigger 將整筆租約視為 wildcard；活躍 metadata group 存在時不能取得／續租舊租約。新 group 也會拒絕仍活著的舊 capability 或 locked_by，即使同帳號。
- 原表 AFTER guard 阻擋有活躍 group 時的 raw UPDATE/DELETE／legacy 整筆覆寫；新 patch 的精確 effect 可與另一組租約並存。
- participants、links、Actual receipt metadata 的 old/new parent 都檢查；新 Actual INSERT／來源變更也檢查來源 Budget 的 group，不能以建立付款繞過互斥。
- 無 group 時舊流程維持現行 validator/RLS/交易。legacy title/note 改動仍各自遞增群組版本，舊鎖欄位變更或 heartbeat 不遞增；新客戶端不能拿先前 group revision 蓋回舊資料。
- private states 會追蹤原表資料與 tombstone，這是 dormant migration 的唯一持續新增副作用；不更新金融列、不改金額／participants／baseline 內容。
- 暫停新 API 不會解除活躍租約，精確 release 仍可使用；guard 繼續保護未清理的權限，不能把 enabled=false 當成可讓舊 client 直接覆寫。

這是 prototype bridge，**不是**完整 groups protocol：舊 client 還未在全域切成 protocol_required；有關聯的付款群組未接管；沒有 group collaboration signal／UI reader 整合、Storage bytes 保護或 group snapshot v2。不得把這個 migration 單獨啟用為正式多人協作。

## Idle 與成功後保留租約

- 成功 patch 只把該組標為 clean，不清 user/session/token/epoch；下一次有效輸入可沿用仍有效的同一 capability。
- clean deadline 兩分鐘，dirty 十分鐘；每次 expiry 最多再七分鐘。續租活動序號沒前進，不重設 last_activity_at；真正操作由未來 controller 增加 activity sequence，focus／snapshot／定時 heartbeat 不算操作。
- DB 以收到活動序號的 server time 計算 deadline；client 精確最後一次輸入時間／blur／IME／queued revision／背景恢復仍待 B-2/B-3 controller。這個 SQL 原型不能證明完整使用者 idle 體驗已完成。
- 若 writer 未送續租、背景被節流或已超過 deadline，DB 拒絕 renew/patch，必須重新 acquire 並驗版本。clean release／離組由未來 UI 呼叫，DB 不因成功提交自動 release。

## 回撤

[本地 reverse SQL](qa/2026-10-29-budget-metadata-prototype-rollback.sql) 只允許 enabled=false、無活躍 lease、無 pending effect、**沒有任何成功 request** 的 dormant unused 原型；精確移除本切片物件，不使用 CASCADE，也不動舊函式或金融資料。測試已比較 reverse 前後全部原有 public/private function definitions 及 business snapshots。

若已有成功操作，reverse 會拒絕，避免清掉 request 冪等證據。先 pause、保留 metadata 與現有資料，再另行設計 forward repair；不允許把 financial rows 還原成舊快照或直接刪 request table 作為回退。任何 hosted rollout／rollback 都需要另行明確授權及 live preflight。

## 本次驗證

- [專用 DB 測試](../tests/budget-metadata-groups-database.mjs)：**23 個情境通過**。涵蓋 migration 注入失敗回滾、dormant data preservation、reverse、invoker/grants/RLS、viewer/pending/outsider/anon、不同組提交、同組排他（含同帳號不同 session）、秘密資料不輸出、legacy/raw/child/link/payment exclusion、嚴格 patch、成功保留租約、stale version／capability、request replay、GUC 偽造、unfinished prepare、提交故障回滾、idle／TTL、Actual 金額保護、撤權、paused release、UUID tombstone。
- 既有 `budget-database.mjs`、`budget-safety-database.mjs` 與 `budget-leases-database.mjs` 皆通過，包含全部 migration、新 SQL dormant 狀態下的原財務/RLS／付款／收據／出發快照／舊租約 regression。
- Windows checkout 的既有 #14 migration 為 CRLF，`prepare-budget-selection-rollout.mjs` 對 raw bytes 的固定 SHA guard 使原始路徑的 lease suite 在驗證新 migration 前就失敗。只對 lease suite 使用 `.tmp-budget-db-lf/` 的 LF-normalized disposable source mirror，與 Git canonical LF source 一致；不修改 workspace 已套用檔案、hash guard 或腳本。其餘兩套與新測試直接從 workspace 執行。
- PGlite 使用 PostgreSQL/WASM 真正 SQL、trigger、RLS 與 transaction rollback；本身序列處理 SQL。**沒有真正多連線的同時搶鎖／wait/deadlock 測試，也沒有 hosted Realtime／真帳號／Storage API／physical device 驗收。** 不將依次送出的兩位 actor admission 稱為 hosted concurrent benchmark。
- 測試 runtime 固定為 PGlite 0.5.11，放於 `.tmp-budget-db-runtime/`，未修改 package.json/package-lock。pgcrypto 擴充宣告沿既有離線測試略過，Supabase 既有設定不改。
- 正常 build、JS syntax 及 diff check 應在交付前通過；既有 bundle advisory 不屬於本切片問題。沒有 UI 改動，因此未以 rendered screenshot 宣稱 UI/autosave 已可用。

本機重跑（PowerShell，runtime 已安裝時）：

```powershell
$env:PGLITE_MODULE=(Resolve-Path '.tmp-budget-db-runtime/node_modules/@electric-sql/pglite/dist/index.js').Path
node tests/budget-metadata-groups-database.mjs
node tests/budget-database.mjs
node tests/budget-safety-database.mjs
node .tmp-budget-db-lf/tests/budget-leases-database.mjs
```

## 下一個切片

指定的真 PostgreSQL 雙連線 admission／legacy row-order／expiry／rollback／bounded retry，以及其後批准的 group snapshot／協作 metadata invalidation，均已依上述後續報告在隔離 DB 完成。接下來將 title/note 接入焦點唯讀／pending 與編輯者提示，含 adapter/context guard、group-aware 去重、到期重讀與 draft merge。付款連動 bundle、pricing/payer、空白新增、五步 Undo 與 Storage gate 仍依 [B-1 契約](2026-10-29-budget-collaboration-b1-contract.md) 分階段處理；UI／金融／hosted 工作尚未開始。
