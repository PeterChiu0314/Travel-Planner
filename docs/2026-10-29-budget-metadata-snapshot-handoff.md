# Issue #15｜群組快照與協作通知 DB 切片

2026-10-29；分支 `codex/budget-collaboration-redesign`。依使用者「好，繼續」實作先前提出的本機 DB 下一步。**原生 PostgreSQL 最終 29/29 通過：原有 17 項保留，新增 12 項；18 項有跨連線重疊證據。** 未連 hosted Supabase、未部署、未接 B-2 UI，未做計價／付款、Undo 或 Storage。

後續：使用者批准的 [B-2 名稱／備註 UI 切片](2026-10-29-budget-b2-metadata-ui-handoff.md) 已完成本機 opt-in 接入。此處「沒有 frontend caller」描述本 DB 階段交付時的狀態；後續原生30/30、UI18/18、controller20/20及回歸通過。DB仍預設停用／未hosted rollout，沒有更改本 migration source。

- [機器可讀結果、18 組重疊證據、PID、來源 hashes](qa/2026-10-29-budget-metadata-snapshot-results.json)
- [新 migration：20261029031137](../supabase/migrations/20261029031137_budget_metadata_snapshot_signals.sql)
- [原生測試](../tests/budget-metadata-parallel.mjs)／[隔離 runner](../scripts/qa/run-budget-metadata-parallel.mjs)
- [上一個 metadata 原型](2026-10-29-budget-metadata-prototype-handoff.md)／[原 17 項並行測試與 deadlock 修正](2026-10-29-budget-native-parallel-verification.md)

## 1. 實作與讀取契約

新增 `public.read_budget_metadata_snapshot(p_trip_id uuid,p_session_id uuid)`，**STABLE、SECURITY INVOKER、空 search_path、僅 authenticated EXECUTE**。舊 `read_budget_snapshot`、`read_budget_collaboration` 及 #14 selection API 完全不改。新入口沒有 frontend caller。

快照保留舊 financial graph 的全部頂層欄位／內容，再加：

| 欄位 | 契約 |
| --- | --- |
| metadataProtocol | name=`metadata-prototype`、schemaVersion=1、enabled、complete=false、groups=[title,note]；不是完整 groups v2 或可上線訊號 |
| metadataRecords | 目前存在的 Budget／Actual，含 kind/id/trip_id、supported、state_ready，以及兩組 canonical value/revision/epoch/held/owner_id/own_session/expires_at |
| collaboration | 保留 selectionProtocol=2 與舊 edit/selection entries，附加 group_key=title/note 的 edit entries；同列兩位不同群組編輯者都保留，不在 DB 先按 resource 去重 |
| collaborationRevision | 同一 MVCC snapshot 的既有 opaque signal revision；無 signal 時 0，不是 financial group version，也不是完整 graphRevision |
| serverNow | statement_timestamp()；不以長交易起點時間判定本次讀取的租約可見性 |
| nextRefreshAt | 所有可見 group／legacy edit／selection hint 中最早到期時間；無 hint 時 null，供未來本機 timer 重讀 |

`app_private.read_budget_metadata_state` 為唯一新增的窄 SECURITY DEFINER reader：驗證 auth.uid／當前 trip membership，所有 canonical 與私有 group join 限定該旅程，輸出明確白名單。它只投影 metadata；完整財務圖繼續經原 invoker/RLS reader。pending、非成員、被撤權者讀不到受限旅程；viewer 可讀、不能寫。

不存在／已刪除資源不輸出，private tombstone 留存供版本 fencing。metadata state 缺失時 `state_ready=false` 且 revision/epoch 為 null，不假造 0。linked Budget／Actual 照樣在 financial graph 及 metadataRecords 中，但 `supported=false`；現有 prototype 拒寫規則不變。

已過期或持有人失去 edit 權限時，held=false、owner_id/expires_at=null，且不輸出 group edit hint。`own_session` 僅為提示；不驗 token 的 reader 永遠不能授予 mutation 權限。前端未來仍須用 acquire/epoch/capability 及版本檢查，不能靠此布林值提交。

所有新增／沿用 reader 都在 STABLE 呼叫鏈中。原生 probe 在同一讀取 statement 中先讀快照、等待 gate，再讀一次；期間另一 backend 的 patch 真正執行並提交。兩份舊讀取完全一致，而另一條新 statement 已見新值／revision／signal，證明不混用兩個提交時間點。

## 2. 通知契約與相容性

沿用已 published、SELECT RLS 的 `public.budget_collaboration_signals`，**仍僅有 trip_id、revision 兩欄**。不增加 publication table，不公開 private metadata／session／token／輸入文字。

- `budget_metadata_group_signal`：group INSERT/UPDATE/DELETE（含 acquire、renew、release、patch revision、tombstone）更新 opaque revision。
- `budget_metadata_member_signal`：會員 INSERT/DELETE 或 role/status/user_id/trip_id UPDATE 使相關旅程重讀；投影即時重新查 membership，不信舊 claim 中的角色。
- `budget_metadata_protocol_signal`：enabled 切換時通知有 metadata 的旅程。暫停不解除既有 lease，讀取仍顯示權限，精確 release 仍可用。
- metadata/member scope 移動時，依 trip UUID 排序通知 old/new 兩旅程。整個 trip 刪除時跳過不存在 parent，不重建 signal。既有 opaque signal 不 DELETE，以沿用原本的 Realtime DELETE 隱私策略。

signal 與觸發它的交易一起 commit／rollback；失敗 patch 不留下成功通知。revision 可以在同一業務操作中增加多次，不能把差值當操作次數；消費端應延續 coalescing 並重讀權威資料。signal 不包含更新值或寫入權限。

續租不修改 financial row 或 group revision，只改必要 lease metadata 及 signal；頻率沿用原有續租，不新增 focus heartbeat 協定。讀 snapshot 不寫任何 signal。因 group tracking 在原 prototype 中連 dormant legacy 寫入也存在，擴充後這些 metadata 寫入會產生額外 opaque invalidation；舊 reader 不因此取得新協定或改變 selection 排序。

**自然時間流逝不觸發 SQL，所以不會自動產生到期 event。** 後續 UI 必須在 nextRefreshAt、focus／reconnect 及事件時重讀；本次 long-transaction 測試驗證到期前後兩個 statement 的 held 正確改變，signal 沒有被假造增量。角色／成員、金融 dependency／support 變動也要保留既有 trip_members 與 financial table 的 invalidation，不能只訂閱新 group hints。

## 3. 測試環境與結果

官方 EDB PostgreSQL **17.11 Windows x64**，Node.js 24.15.0、pg 8.16.3；沿用前階段 archive SHA-256 與隔離 runner。每次 initdb 新建 cluster、只綁 127.0.0.1、不接受 connection URL；不同 LOGIN、auth.uid/session/capability、獨立 TCP/PID，另有 observer。READ COMMITTED，真實 advisory／row lock 與 catalog barrier；沒有 hosted credentials／正式 fixture。

首輪擴充 27/27 通過，再補自然到期／trip cascade 與 migration 前既有資料 fixture，最終 **29/29**。本階段兩個成功啟動的 server 已停止，postmaster.pid 不存在；最終 log 的 deadlock ERROR 為 0。一般交易仍可能短暫序列化，不宣稱任何任意 SQL 排程都無死鎖。

| 新增案例（原有 17 項見前階段報告） | 結果／實證 |
| --- | --- |
| migration 注入失敗、既有資料保全、dormant reverse | 通過；22012 回滾全部新增物件；已存在 Budget／Actual known debit／member／baseline／private group 原值與舊 function definitions 保留，reverse 後精確一致 |
| 完整 graph 相容與有限 readiness | 通過；逐欄比對原 financial snapshot，含 Budget／standalone Actual；protocol complete=false，重複讀取不改 signal |
| 同列兩群組 owner 與舊 selection | 通過；兩位編輯者同時存在，own_session 正確，舊 entries／selected_at 保留；無 session/token/hash 外洩 |
| acquire／renew／release 通知 | 通過；signal 前進，financial row 不變，group revision 不變，釋放後快照不顯示 held |
| 到期、接管、晚到 release、降權 | 通過；舊 release 不通知或清新 owner，降權通知並隱藏舊 owner |
| 自然到期與長交易時鐘 | 通過；依 server time 真正跨越到期點，下一 statement 不再顯示 held，不需寫入過期事件 |
| STABLE 跨提交一致性（並行） | 通過；reader/writer 同時 active，各被 observer gate 控制；B 提交後 A 同 statement 仍見舊 graph/group/signal，新 statement 見新值 |
| 未提交／失敗 signal 可見性（並行） | 通過；A 正在真 patch 交易中，B 的完整 snapshot 可完成且只見舊 committed row/group/signal；A 22012 後全部回復 |
| legacy title 更新、刪除／同 UUID 重建 | 通過；通知及 canonical version 前進；快照不列 tombstone，重建版號仍 fencing |
| pause／unsupported | 通過；pause 產生通知且保留可讀 held；linked Budget 明確 unsupported，不擴大付款協定 |
| auth/RLS/publication/grants | 通過；viewer/pending/outsider/anon 邊界、invoker/STABLE/search_path、僅既有兩欄 signal published |
| trip cascade deletion | 通過；只保留 opaque signal，metadata 被 cascade 刪除，不重建信號／資源，不再提供授權快照 |

保留原有 **16 項實際競爭／rollback／lock-order 重疊案例＋1 項原生 RLS**，因此最終為 18 項跨連線重疊案例、11 項其他 DB 案例。新讀取重疊案例不把 SELECT 不等待 writer 宣稱為 write contention；其證據為 reader 在 writer 未提交且仍 active 時完成。完整 activity、outcome、PID 與來源 hashes 見 JSON。

回歸：23/23 原 metadata DB 情境；budget-database、budget-safety-database、budget-leases-database 三套通過；finance／lease／sync／collaboration／primary-collaborator／receipt 六組 controller **38/38**；build、JS syntax、diff check 通過。既有大 bundle advisory 未變。

一項舊 lease 測試初次失敗：它假設 outsider 在**所有旅程**看不到 signal。新 member/group trigger 現在也為該使用者自己已核准的 secretTrip 建 signal；RLS 正確允許讀自己的旅程。測試改成拒絕受測 trip，並比對全部可見 trip 的精確 allowlist（outsider 只有 secretTrip；pending 為空），沒有放寬 RLS 或刪除權限驗證。

原 #14 raw SHA guard 仍需 LF-normalized disposable mirror 執行舊 lease suite；僅同步本次新 migration／新測試，沒有改已套用 workspace migration 或 hash guard。首次 sandbox 啟動 pg_ctl 因 Windows restricted-token error 87 失敗，未啟動 server；同一 loopback-only runner 在允許啟動本機程序的執行環境成功。

## 4. 變更與重跑

- 新增 migration、這份交接、[JSON evidence](qa/2026-10-29-budget-metadata-snapshot-results.json)、[擴充 reverse](qa/2026-10-29-budget-metadata-snapshot-rollback.sql)。
- 擴充原生 parallel suite，修正舊 lease suite 的 signal scope 斷言，更新 CURRENT_TASK／prototype handoff。
- **所有前階段 migration（含 20261029020551 原型）raw source hashes 不變**；新 migration SHA-256：`b7561c3d3cbd89988abebfdf0a526092eb0d65c465dabe45d7cb7eea58d815f1`。
- 沒有 src、package.json／lockfile、Auth／Storage 設定、Issue 狀態、commit/push／merge 更動。先前文件整理與未追蹤測試產物保留。

```powershell
node scripts/qa/run-budget-metadata-parallel.mjs
$env:PGLITE_MODULE=(Resolve-Path '.tmp-budget-db-runtime/node_modules/@electric-sql/pglite/dist/index.js').Path
node tests/budget-metadata-groups-database.mjs
node tests/budget-database.mjs
node tests/budget-safety-database.mjs
node .tmp-budget-db-lf/tests/budget-leases-database.mjs
node node_modules/@playwright/test/cli.js test tests/budget-finance.spec.js tests/budgetEditLeases.spec.js tests/budgetSync.spec.js tests/budgetCollaboration.spec.js tests/budgetPrimaryCollaborators.spec.js tests/budgetReceipts.spec.js --workers=1
```

runtime 準備沿[前階段說明](2026-10-29-budget-native-parallel-verification.md)。原始 final run：`.tmp-budget-native-pg/runs/19994236-89bb-4ff7-b817-ff97fec847ae/`；binary/data/node_modules/log 為未追蹤本地產物，不加入 Git。

## 5. 回撤與下一步

只在本機 dormant/unused 狀態使用新 reverse：先撤本擴充，再撤原 prototype。需 enabled=false、無 live lease／pending effect／successful request；不 CASCADE，不刪或倒退 signal revision，不還原 financial rows。已有成功操作時保留資料並另設 forward repair，不能刪 request 冪等證據。

接著可做 **B-2 title/note 的服務 adapter 與 UI 接入**：驗 schema/enabled/supported/state_ready，重用 account/trip/generation/版本 guard、80ms coalescing，按 (kind,id,group) 保留多位 owner，處理 nextRefreshAt、pending／唯讀／retry，確保舊 callback 不覆蓋本機 dirty group。NOWAIT 55P03 也需明確恢復策略。這些都尚未實作；目前沒有新 UI 或自動儲存體驗驗收。

本次不證明 hosted PostgREST、Realtime websocket／logical replication consumer、真帳號 UI、Storage bytes 或 Production rollout 可用；publication/RLS 與 commit 可見性是本機 DB 證據。完整協定接管／正式啟用、付款群組、五步 Undo、blank record 仍依 B-1 分階段處理。

設計依據：[PostgreSQL STABLE／MVCC snapshot](https://www.postgresql.org/docs/17/xfunc-volatility.html)、[Supabase Postgres Changes 與 publication/RLS](https://supabase.com/docs/guides/realtime/postgres-changes)。本次查閱 [Supabase changelog](https://supabase.com/changelog)；近期 API TLS breaking change 不影響這次 loopback 原生 SQL，未升級 SDK 或改連線設定。
