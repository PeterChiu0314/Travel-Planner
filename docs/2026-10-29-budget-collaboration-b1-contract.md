# Issue #15 B-1｜預算欄位／群組協作影響分析與 DB 契約

日期：2026-10-29。分支：`codex/budget-collaboration-redesign`；程式基準：`cab828d`。重新讀取 [Issue #15](https://github.com/PeterChiu0314/Travel-Planner/issues/15) 與留言（0 則）、AGENT、CURRENT_TASK、DESIGN、UX_RULES 和相關程式／migration 後整理。

後續使用者裁定已納入：自動儲存後仍聚焦同群組時保留租約，離開或 clean 閒置兩分鐘才釋放；Undo 改為**最多 5 步、限目前分頁、不做 Redo、不增加歷史紀錄 UI**。這些裁定取代本文件初版的儲存即釋放、跨分頁及單步 Undo 決策，後續實作／驗收以本版為準；GitHub Issue 原文的單步描述未在本次修改。

**本階段完成盤點與設計，以下新 API、資料表和 migration 分段均為提案，尚未實作或執行。** 沒有變更應用程式、既有 migration、正式資料、套件、Issue 狀態，也沒有 commit/push、合併或部署。先前未提交的文件整理保留。這份文件是 B-2/B-3 的實作契約，不代表新的 DB 協定已驗證。

上述為 B-1 交付邊界。後續已另完成[本機 title/note DB 原型](2026-10-29-budget-metadata-prototype-handoff.md)，僅支援無付款連動的記錄、預設停用；API 使用 metadata-prototype 名稱，並非本文件完整 API／schema 已實作。進度與限制以 CURRENT_TASK 及該交接為準。

## 1. 決策摘要與範圍

- 名稱、分類、備註、計價分攤、付款人、關聯行程分別取得權限；付款、來源關聯、收據、刪除是明確的相依交易。開啟明細／編輯畫面只有讀取及 selection，不取得租約。
- DB 群組版本加上嚴格欄位白名單 patch 取代整筆 form 儲存。不同群組的修改不因整筆 `updated_at` 改變而互相判定衝突。
- 保留現在的短交易 trip advisory lock，與付款圖、匯率、出發快照相容；不把人類輸入期間包在資料庫 transaction 裡。不同群組可同時持有租約及輸入，提交短暫序列化，不宣稱 DB 同一列可同時物理寫入或已提升吞吐量。
- 規劃期單筆付款仍同步，但只同步這次變動的群組。跨 Budget/Actual 的衍生更新必須事先納入同一租約 bundle、版本向量與原子交易；不能繼續呼叫整筆 v4→v3→v2。
- 新增採正式、不計入財務的「未完成紀錄」，穩定 UUID 由 DB 建立；完成後沿用 ID。需要 schema、讀取、統計／結算／快照一起升級。
- 自動儲存成功不結束仍聚焦、持續操作同群組的編輯權；clean 狀態在離開群組或兩分鐘真實閒置時釋放，避免停頓後重複 acquire。
- Undo 保留目前分頁最近最多 5 筆可復原的成功操作，按新到舊依序反向 patch；每步完整驗證相依版本。不做 Redo、不增加歷史紀錄 UI，也不保證刪除／收據／付款等所有副作用可還原。
- 採 expand → bridge → activate → observe 升級。只有新協定完整覆蓋寫入入口後才允許開啟；回退到舊程式前必須先停止新寫入，不能直接移除 guard。

## 2. 現況盤點與具體影響

| 現有入口／證據 | 目前行為 | B-1 結論／後續變更 |
| --- | --- | --- |
| [BudgetWorkspace](../src/components/budget/BudgetWorkspace.jsx) `useWorkspaceEditor.open/save/close` | 開啟即 acquire；整筆 seed/baseUpdatedAt；儲存後 release；一份表單 dirty／draft／Guard | 改為每群組 canonical/base/local/queue 狀態；開啟只讀；表單關閉等待提交或明確處理保留草稿 |
| 同檔 `RecordEditor`、`add`、`saveBudgetWithPayment` | Save/Cancel；新增先本機；planning 投影值送整筆；來源預算選取會用 seed 覆蓋多欄 | 新增直接 RPC；來源變更明確列為 compound operation，不偽裝單欄更新；不得直接把投影值當 DB 原始欄位 |
| [budgetEditLeases](../src/lib/budgetEditLeases.js) | Map key 為 table:id，capability 僅記憶體；60 秒續租；release 最長等 10 秒；generation 防過時回應 | 增加 group 與 bundle ID、epoch、版本向量；保留 Auth／ABA／晚到 cleanup 防護；不能只在 key 加 group 而沿用舊 RPC |
| [lease migration](../supabase/migrations/20261027140044_budget_atomic_edit_leases.sql) | PK(kind,resource_id) 整筆唯一；acquire 比整筆 updated_at；七分鐘 TTL；舊 locked_by 互斥 | 新群組唯一鍵、單調 epoch、群組版本；舊整筆租約視為 wildcard，與所有群組雙向互斥 |
| 同 migration `guard_budget_edit_lease` | parent UPDATE/DELETE、participants/links/attachments 子表 DML 都 guard；新 parent INSERT 尚未由此 guard 覆蓋 | 新 guard 必須覆蓋 parent INSERT、子表 old/new parent、FK/cascade、衍生欄位；不能只守新 RPC |
| [workspace service](../src/lib/budgetWorkspaceService.js) | v4 帶 capability，依條件委派 v3/v2；重試帶 request ID；提交後重讀 snapshot | 新 patch service 不得把 v4 當 fallback；保留「已提交但同步未完成」與「未提交」區別 |
| [baseline/pricing SQL](../supabase/migrations/20261022090000_budget_workspace_baseline_and_pricing.sql) | RPC 要非空 title、至少一位 approved participant；upsert 多欄、刪後重建 participants/links；伺服器算總額 | 原 validator 拆成群組驗證；metadata patch 不能替換 joins；不能刪掉既有金額／分攤約束支援空白 |
| [v2 safety](../supabase/migrations/20261022110000_budget_payment_safety_and_actual_cost.sql)、[v3 planning](../supabase/migrations/20261022120000_unified_planning_payments.sql) | request ledger；規劃單筆付款同步名稱／分類／備註／金額／payer／participants；付款 history、active；實付成本保護 | 逐群組有限衍生更新；保留 history／payment IDs／receipts／known debit；狀態 unpaid 只停用，不回退舊 v2 刪付款分支 |
| 同 safety migration `keep_actual_twd_cost` | 現行 trigger 的廣泛 row 比較連 metadata 變更也可能標記 payment_origin=manual | 新 metadata patch 不能意外改 provenance；需把群組效果與來源保護 trigger 一起 review，不能只保留函式名稱就視為相容 |
| [planningBudget](../src/lib/planningBudget.js)、[budgetFinance](../src/lib/budgetFinance.js) | 有 retained Actual 時 planning 顯示台幣投影；多筆／未知配置禁止聚合改價；無 join 的舊資料 fallback 全體成員 | 新 incomplete 狀態必須先分流，不能套 legacy fallback；舊資料的既有 fallback 與未知值警告保留 |
| [snapshot SQL](../supabase/migrations/20261027145613_budget_consistent_snapshot.sql)、[budgetSync](../src/lib/budgetSync.js) | STABLE/invoker 單一快照含金流、rates、member、links、receipts；80ms coalescing、dirty rerun | 擴充 protocol/readiness/groupVersions/graphRevision；仍以 DB 已提交 snapshot 合併，重用 context guard |
| [collaboration](../src/lib/budgetCollaboration.js)、[#14 SQL](../supabase/migrations/20261028104333_budget_selection_activity.sql) | 真正 edit 優先；同帳號 selection 依 selected_at；先去重再隱藏自己；private hints + opaque signal | 加 group/bundle 範圍及可聚合的人員提示；不能用既有 resource-only dedupe 把同列不同群組吞掉；heartbeat 不改 selected_at |
| [App](../src/App.jsx) `BudgetPanel` / save/delete/convert/rates | Formal 建立 lease client；收據 withLease；仍有舊 direct DML／v1-v3 及 conversion 入口 | DB bridge 要涵蓋所有舊入口，不能以「新版不會走」當防護；完整列於 §9 |
| 同檔 Demo render/commit、[Demo transition](../src/demo/saveBudgetRecord.js) | 正式 UI 共用，無 lease/network；單一 pure transition＋request ledger | 模擬相同群組 patch／未完成資料／目前分頁最多 5 步 Undo，但記憶體操作，不新增 Supabase 或持久化 |

目前規則文件有歷史落差：UX_RULES 的 Budget 段仍寫 double-click／blur never writes；DESIGN 記錄 #11 後的選取與付款安全。Issue #15 是未來 Budget 專屬 autosave 變更，不能把它泛化到 Timeline／住宿等表單。B-2/B-3 更新相關規則時需標示生效階段。

## 3. 群組與相依交易

群組 key 為 `(kind, resource_id, group_key)`，kind 為 budget 或 actual。group_key 嚴格 enum；trip_id 由 DB parent 解析，必須與請求相同。bundle 是一次使用者意圖所需的全部 key，**由 DB 決定，不能由前端刪減**。

| 群組 | 允許的輸入／衍生欄位 | 相依與排他邊界 |
| --- | --- | --- |
| title | title | 不更動金額／payer／participants；規劃單筆同步時 bundle 包含 Actual.title |
| category | category；保留未編輯的 legacy subcategory | 不重置歷史 subcategory；單筆同步只更新對應 Actual.category |
| note | note | 單筆同步只更新對應 Actual.note；不碰其他 metadata |
| pricing | pricing_mode、amount 或 unit_amount 或 shares、currency、participantIds；DB 衍生 exchange_rate、twd_amount、split_type、allocations | 所有相依計價為同組；Actual 的 twd_amount_source／actual_twd_amount／reference rate 同組；不能前端指定衍生總額 |
| payer | payer_id | 與 pricing 獨立；只驗證 approved member 或現行允許的 null；規劃單筆同步取得 Actual.payer |
| links | Budget 的 linkedItemIds 集合 | 原子 replace 對應 itinerary_budget_items；只接受同 trip itinerary，不能把其他群組內容帶進來 |
| payment | Budget 付款 active/建立付款意圖；Actual.paid_at | 建立／重啟付款、轉實付是專用交易；提交需 pricing＋payer 等相依 bundle，見下表，不使用全 form |
| source | Actual.budget_item_id、保護 budget_origin_id | 更換來源會影響舊／新付款圖；單純重新關聯與「套用來源數值」為不同明確 action，後者列出 pricing/payer/title/category/note 全部效果 |
| receipts | Actual 附件集合 | metadata RPC＋Storage lifecycle；版本與刪除相依；不因上傳鎖住名稱或備註 |
| lifecycle（操作型） | create/promote/delete | 不作一般可聚焦欄位；DB 算 readiness；delete 與 parent 全群組及受影響付款／收據互斥 |

計價與付款採最小安全組合：

| 動作 | DB 解析的 bundle／版本依賴 | 寫入界線 |
| --- | --- | --- |
| 無 retained payment 改價格 | Budget.pricing；ratesRevision／graphRevision | 僅 Budget 金額＋participants；不取得 payer 長租約 |
| 規劃期單筆 retained payment 改價格（含 inactive） | Budget.pricing＋對應 Actual.pricing；graphRevision、retained 集合、來源版本 | 一次更新兩者金額／分攤；保留付款 ID／receipt；history 只記真實相依變更 |
| 改付款人 | Budget.payer，單筆同步再含 Actual.payer；graphRevision | 不重算價格或複製舊 title/note；A 改名稱、B 改 payer 應皆可成功 |
| 標 paid（首次建立） | Budget.payment＋pricing＋payer；完整性、graphRevision、ratesRevision；讀取當下已提交 metadata | 原子建立 Actual＋participants／backlink；不讀取未提交草稿；若他人正持 pricing 則拒絕並可重試 |
| 切 unpaid／重新 paid（已有 retained） | Budget.payment＋相關 Actual.payment；首次建立的依賴不適用；graphRevision | 只改 payment_active，完整保留 amounts/history/receipts；不重新按匯率建付款 |
| Actual 直接改價／付款人 | 對應 Actual 群組＋graphRevision；必要時 Budget.pricing 或 payer bundle | planning 投影依 snapshot 更新；直接金流修改依現行規則保留來源／manual provenance，不擅自反向覆蓋原 Budget |
| 多筆 retained 或未知分攤 | 個別 Actual 群組；必要時共同 Budget.payment/graph 依賴 | 禁止聚合覆蓋金額／payer；提供「選取並開啟該實付項目」的現行 Edit 路徑，不恢復舊獨立明細面板 |
| 改來源／刪除 | 舊新來源 Budget 對應群組＋Actual/source/lifecycle 所需 key，全數排序 | 保留 budget_origin_id 語意；刪 Budget 的 SET NULL、backlink 與收據等 effects 納入同一依賴圖 |
| 更新全旅程匯率 | 旅程 rates 操作；所有受影響、未有 retained 的 Budget.pricing；完整性／出發狀態 | 一次取得全部或拒絕，不部分更新；不因同帳號即可搶走其他 tab 租約；已出發與 retained 歷史成本不改 |

短交易保護圖的讀取與變更；付款集合改變（含直接新增 Actual、改來源、FK/cascade）會遞增 graphRevision。既有 bundle 取得後若解析出的 key/相依版本改變，整次提交拒絕並要求重新取得，不可靜默擴權。metadata patch 只檢查它實際寫入／鏡射的群組與圖拓樸，不依賴無關付款時間或另一群組的一般 updated_at。

計價數值契約沿用原幣最多兩位小數、匯率最多六位小數且大於零、整筆換算一次為整數 TWD，再用穩定 largest-remainder 配置。per_person 由單價×去重參與者數決定總額；split_total 由總額決定；custom 由所選每人的非負兩位金額加總，切入時帶入原均分配置，不鎖最後一人、不補剩餘差額。提交拒絕未知／已撤權參與者、缺少權重、超範圍／非有限數字，actual/legacy 已知台幣成本不得被 metadata 或來源匯率重新推算；出發後外幣價格限制依 DB 當下階段重驗。

## 4. 新 DB 物件與不變條件（提案）

| 物件 | 欄位／規則 |
| --- | --- |
| app_private.budget_group_versions | PK(kind,resource_id,group_key)；trip_id；非負 bigint revision；不因 lease acquire/renew/release 遞增；刪除保留必要 tombstone 供 stale/Undo 拒絕 |
| app_private.budget_group_leases | 同一 PK；actor、tab session、token_hash、單調 lease_epoch、expires_at、last_activity_at；renew/release/takeover 都比對完整識別；group key 有 CHECK |
| app_private.budget_graph_versions | 每個 Budget 付款圖及獨立 Actual 的 revision；rates 另有 trip-level revision；關聯 topology/retained 集合改動才遞增，不用整列 updated_at 代替 |
| app_private.budget_group_requests | UNIQUE(actor,request_id)；origin tab_session_id、trip/protocol/action/canonical payload hash/base vector；已提交 result、effect versions、undo eligibility；不存明文 capability |
| app_private.budget_undo_stacks | PK(actor,tab_session_id)，綁 trip_id；每分頁最多 5 個 operation 指標及必要的版本／origin lineage；僅更新本分頁 stack，成功 Undo pop、不 push；其他分頁、失敗／no-op／heartbeat 不改寫；不得查他人／其他分頁的 undo payload |
| app_private.budget_write_protocol | 受控的 DB 端 legacy/bridge/groups/paused 狀態與 schema protocol；authenticated 無直接表權限；開關本身不等於授權上線 |
| Budget/Actual readiness | 明確 record_status 與 pricing_ready 等由 DB 維護的完整性欄位；原有資料預設 complete，不重算／回填猜測的財務值；新空白紀錄為 incomplete |

私有表皆 RLS enabled、撤銷 PUBLIC/anon/authenticated 的直接表權限且不加入 Realtime publication；讀取版本／租約投影經狹窄 private helper 驗證 membership 後回傳。public financial RPC 維持 SECURITY INVOKER、空 search_path、限定 authenticated；只把必要私有 metadata 存取放在具 actor/trip 檢查的 private SECURITY DEFINER helper。可執行 helper 的呼叫也必須不能繞過版本／白名單／permission 檢查。

lease_epoch 的持久 counter 放在 group version/state 列，release 即使移除 lease 也不得歸零；刪除／重建相同 UUID 不可重用舊 epoch。polymorphic kind/resource_id 沒有直接跨兩張 parent 表的 FK，因此 create/delete/cleanup helper 與讀取都必須驗證 parent/trip 存在性，防止 orphan metadata 被當成可寫 resource。

guard 必須依 OLD/NEW 差異檢查每個欄位及子表父鍵，要求這個 transaction 已驗證的 capability/effect manifest；單一 `set_config('...allowed',true)` 不是權威，也不能僅憑 function 名稱或 client protocol 旗標放行。identity、trip、origin、readiness、版本欄位與 financial derivations 均不可 raw patch。舊 locked_by/locked_at 不能當成新群組權限。

## 5. RPC 與原子 patch 契約（新名稱均未建立）

| API | 必要輸入 | 結果／限制 |
| --- | --- | --- |
| read_budget_snapshot_v2 | trip_id | protocol/schema status、record readiness、groupVersions、graph/rates revisions＋既有一致 financial graph；單一 STABLE snapshot，版本不另開時間點讀取 |
| budget_group_lease | trip/kind/id/group、session/capability、action、base group vector、真實操作序號 | acquire 返回 DB 計算 bundle＋epoch/expiry/current projection；renew 不能復活過期權限；release 精確比對、冪等 |
| patch_budget_workspace_group | trip/kind/id/group、patch、base vector、bundle capability、request_id | 嚴格拒絕未知欄位／其他群組欄位；只更新實際 changed columns／joins；回傳 canonical effects、所有 effect versions、commit ID、可還原性 |
| create_budget_workspace_placeholder | trip/kind、request_id | 立即 insert incomplete＋穩定 UUID／版本；重試回相同 ID；無一筆本機 new 草稿先於 DB |
| mutate_budget_payment_v2 / mutate_budget_source | 明確 action、相依版本／集合、bundle、request_id、必要確認摘要 | 保留既有付款原子性；不接受藏在 metadata patch 裡的 side effect |
| mutate_budget_receipt_v2 | metadata action、Actual receipts/version、bundle、request_id | 不把 Storage 位元組視為 SQL 可原子回滾；保留獨立清理狀態 |
| delete_budget_workspace_record_v3 | identity、完整 effect/依賴版本、operation bundle、request_id、明確確認 | 拒絕他人持有的任何受影響群組；付款／收據處理遵循現有明確刪除界線 |
| undo_budget_workspace_operation | trip、origin tab_session_id、該分頁 stack top operation_id、反向 intent、必要 bundle 的有效權限、request_id | DB 核對 actor＋分頁 stack top 與 operation origin，取 canonical before-image、比對所有 effect versions／origin lineage；已有有效同組權限可重驗沿用，否則重取；成功原子 pop，不接受指定任意較舊項目 |
| read_budget_collaboration_v2 | trip、own_session | group/bundle 範圍、editor ID、serverNow/expiry、selection protocol；不回 token/session 明文或未提交欄位值 |

patch 請求例：`{kind:"budget", id, group:"note", patch:{note:"集合地點改在出口"}, baseVersions:[...], bundle:{...}, requestId}`。**不能帶 title/amount/payer 當「順便儲存」。** 省略欄位代表不變；可空值只有各群組明定的 null/empty；null 不是省略。成員／行程 ID 去重、排序，同 trip/approved 驗證由 server 重做。

交易順序：

1. 驗證 actor、當下 membership/role、trip/resource、protocol 及動作；取得既有 trip advisory xact lock，再重驗並在交易內保護相關 membership rows，讓撤權與提交有明確序列。新舊觸發器與 RPC 必須採同一入口順序，不能只信先前 JWT 或頁面 canEdit。
2. 序列化／保留 `(actor,request_id)`；相同 request 的 canonical signature 相同且已成功，先返回原成功 result，**即使原 lease 已釋放**。不同內容或 origin tab_session_id 拒絕；結果重讀仍需當下授權。這個 signature 不包含輪換 capability，包含 origin tab_session_id/business intent/base vector/protocol。
3. 依 trip→kind→resource UUID→group key 全域順序鎖 metadata、需要的 parent/child rows；DB 重解 bundle，檢查 graph/rates/read versions、epoch/token/expiry。expiry 必須在等鎖完成後、實際寫入前用當下 server time 重驗。不存在的 lease row 用唯一鍵 UPSERT/CAS 搭配 transaction 序列化，不使用有空窗的先 SELECT 再 INSERT。
4. 驗證 group patch／計價／歷史限制；只執行此次 effects，遞增變動 group revision（no-op 不遞增）、必要 graph/rates/lifecycle revision。metadata patch 不重建 unrelated joins，不附帶 reprice。
5. 同交易記成功 result／before-image／effect versions／origin lineage，將可復原操作 push 至該 actor＋origin tab_session_id 的 stack，超過 5 筆只淘汰最舊 Undo 指標；不可復原操作依 §8 作安全邊界。淘汰指標不刪 request 冪等紀錄；Undo 自身不 push。必要 baseline 在交易最後只讀完整紀錄。任一步失敗全回滾；不做 client compensation。
6. 回傳成功後可顯示已儲存；有較新 queued input 繼續序列提交。沒有 queued input 但仍聚焦同群組時保留編輯租約；已離開群組且沒有 pending／失敗修改，或 clean 真實閒置達兩分鐘時，才精確釋放對應編輯 bundle。只有 compound operation 臨時取得、未屬於持續編輯範圍的額外租約，才在操作結束後釋放；不釋放原本仍在編輯的群組。應釋放時 release 失敗顯示「已儲存，權限釋放待確認」，不重新送出 mutation。writer snapshot 與 events 共用 coalesced refresh。

所有 DB 鎖只活在一次短交易；不要在 SQL 等使用者輸入、confirmation、外部匯率或 Storage。保留短 lock/statement timeout；只有真正由 PostgreSQL 產生的 serialization_failure `40001`／deadlock `40P01` 才保留其交易語意與有界恢復，不把 engine code 全域改寫。自訂版本／依賴／lineage／effect 衝突須以不觸發 transport retry 的 code（本次草案為 `PT409`）拒絕；不得以自訂 `RAISE ... 40001` 模擬業務衝突或 blind retry。2026-10-31 [安全預檢與尚未執行的 Forward 草案](2026-10-31-budget-b7-staging-preflight.md)指出歷史實作仍待修正，這段契約更新不代表 migration 已部署。API error reason 至少區分 forbidden/protocol_required/group_locked/lease_lost/group_conflict/dependency_changed/invalid_patch/invalid_pricing/request_mismatch/incomplete_record。

## 6. 租約、autosave 與同步邊界

- UI focus（含 Tab）開始 acquire；未獲授權前控制項處於可聚焦的 pending/readonly。首次輸入／選擇可保留為不可提交的短暫 action intent，成功且 focus/context 仍有效才套用；失敗不改可提交 form、不吞首次操作，也不洩漏文字到 presence。Portal menu 與 IME composition 屬同一群組。
- 群組內移動不 release/reacquire；autosave 成功且沒有下一個 local revision 時轉成 clean-held，仍聚焦同群組且未達 idle deadline 就保留租約。接續輸入沿用同一有效租約，不因一次約一秒的輸入停頓而重新 acquire。
- clean 狀態離開群組即 release；dirty/inFlight 離開群組先 flush／等提交確認，成功且無新 pending 才 release；invalid／failed 保留草稿與錯誤，按既有退出保護及 dirty 閒置規則處理，不把未完成提交當 clean。Portal menu、IME 與同群組內 focus 移動不算離開。
- clean focus 連續約 2 分鐘無真實操作才 release；dirty/invalid/failed 仍採約 10 分鐘閒置 release 並保留草稿。不顯示倒數。以最後一次真實操作計時，autosave 成功、60 秒 renew、snapshot、focus recovery、selection heartbeat 都不重設人類 idle；若長時間在途的提交成功時 clean deadline 已過，確認無 pending 後釋放。
- 只有因 idle、離開、斷線／過期等原因失去權限後，下一次真實操作才需要重新 acquire；focus 還留在欄位本身不能自動搶回已釋放的租約。
- server 以 monotonic activity sequence 與 server time 記真實互動；renew 的 expiry 取七分鐘 TTL 與 clean/dirty idle deadline 較早者。client 也負責 idle release；背景停鐘或網路中斷可能先於 10 分鐘由七分鐘 TTL 失效，不能承諾背景保鎖十分鐘。expired renew 必拒絕；回前景先核對權限再輸入／提交。
- 每群組維持 canonical、baseVersion、localRevision、dirty/valid/composing、inFlight request、queued latest intent、error；一組最多一個 write 在途。約 1 秒停頓／blur 觸發文字及整組 pricing，選單有效選定即觸發。IME 組字中、空字串數字、無效分攤不送。
- inFlight 回來只能確認當次 revision，不能清掉較新 queued input。timeout 結果未知先用同 request ID 查／重送原意圖；結果未確認前不得為同一次操作另造 ID。新 local revision 才是新的請求。
- Remote snapshot 更新 canonical 與未編輯群組；本機 dirty/inFlight group 維持本地值；同群組遠端 revision 前進顯示衝突，不把 base 偷換成新版本自動覆蓋。account/trip ABA、登出、撤權、舊 release/response 全沿用 generation 防護。
- 關閉／切頁先 flush 有效 pending，失敗／invalid 時提供保留／回到編輯及明確處理入口，不默默 discard；意外離頁保留 per-group 值、原版本與 request ID，但不持久化 token。共享 ActiveEditorGuard 只為 Budget 增加群組協作 adapter，其他頁 Save/Discard 不變。
- 財務資料繼續用已提交 DB→既有事件→80ms snapshot invalidation；協作範圍用既有 opaque signals＋新的 metadata reader。group lease heartbeat 不更新財務列、不遞增 financial groupVersion，不另裝 CRDT／新焦點 DB 高頻通道。
- 人員外框依 group 顯示；同一人的真實 edits 可有多個 group，selection 仍依 #14 selected_at 去重後過濾本 tab；心跳不能讓舊 selection 變成最新。權限釋放後恢復操作，不自動搶鎖。Sonner #13 的確認恢復與 inline error 分工保留。

## 7. 空白正式新增、完整性與財務約束

`002_core_mvp_schema.sql` 的 title/category/amount/twd_amount NOT NULL，金額非負；Actual.paid_at 目前 NOT NULL DEFAULT now。舊 save RPC 額外拒絕空 title、空 participants。不能用呼叫舊 save 加假資料達成正式空白新增。

提案在原表新增 DB 維護的完整性欄位，不增第二套 financial table：placeholder 使用 title 空字串、金額 0 的儲存哨兵、pricing_ready=false、record_status=incomplete、payer/source null、無 participants／payments／receipts。UI 將哨兵顯示為未填，不當作真實零元。明確輸入合法零元＋有效 participants 可成為真正 complete 的零元項目。分類「其他」與幣別 TWD 可作現行預設；不偽造旅程匯率或付款事實。

Actual 空白新增的 paid_at 改為可空，並用條件 CHECK 要求 complete Actual 具有有效 paid_at；不能把建立時間冒充實付時間。title 可空顯示但儲存仍用非 NULL 空字串，complete 才要求非空 title；pricing_ready 只有經計價 validator 的成功群組交易才能設 true。complete 的金額精度、總額加總、參與者有效性、custom 權重、known debit、歷史外幣規則不得放寬。payer 沿用可 null 規則，完成 Actual 缺 payer 仍保留現行結算無法產生轉帳建議的警示。

readiness 由每次有效 group patch 在交易內重算，完成過程不需取得別人的長租約；完整性轉變遞增 lifecycle version。既有 complete row 的無效輸入留在本機，不允許任意把正式金額退回哨兵。incomplete 只可改已驗證的群組；未完成資料不能觸發 paid、轉實付、分攤、出發快照或收據操作。

所有 totals/person stats/category subtotal/planningBudgetData/comparisonRows/SettlementPanel／Timeline budget summary／trip baseline／付款 RPC 都要用明確 complete predicate；incomplete 保留在列表與 snapshot，顯示未完成數，不能進入 legacy「沒有 participants 等於全體」分支。出發 baseline 僅收入 cutoff 前已完成的紀錄；出發後完成不回補 baseline。刪除 placeholder 明確操作，不自動清掉別人正在填的紀錄。

create request 的結果永久綁同一次 request ID，網路斷線重試不重複新增。既有 `new` 本機 draft 仍要提供匯入／保留選擇，先建立 placeholder 再逐群組驗證，不在讀到舊 draft 時自動建立正式資料或提交舊值。

## 8. 最多 5 步、目前分頁限定的 Undo

保留**目前分頁 tab_session_id＋本帳號、當前 trip 相符**的最多 5 步 server stack，從最新成功操作依序往前復原。一次成功 DB 提交（含其原子衍生 effects）算一步，依本節可復原性決定入 stack；第 6 筆入列淘汰最舊一步。其他分頁的操作不會改寫本分頁 stack。每個分頁的 document session 建立獨立記憶體識別，不從 localStorage 或複製分頁的 sessionStorage 沿用；重新載入建立新 document session，不自動恢復舊 session 的 stack。切換 trip/登出清除本分頁的可用 Undo stack，不自動帶入或恢復另一旅程紀錄。

文字、textarea、contenteditable、number/IME focus 時 Ctrl+Z 優先交瀏覽器；表單外才送資料 Undo。DB 同時確認操作屬於 actor＋origin tab_session_id、仍為 stack top，且所有 effect／相依版本未被不允許的後續更新取代；不能跳過 stack top 去還原任意舊步，也不能只相信 client 傳來的 before-image。每個分頁同時至多一個 Undo 在途，連按 Ctrl+Z 序列處理；結果未知先用相同 request ID 查明，不能在前一步未確認時先 pop 或送下一步。

例：分頁 A 修改京都住宿，分頁 B 修改無相依的交通費；回到 A 按 Ctrl+Z 只可復原 A 的住宿修改，B 的交通費保持不變。若 B 後來修改 A 那筆操作所影響的同群組，A 的 Undo 必須因版本衝突拒絕；其他分頁只改無關群組則不應阻止 A 的安全復原。

| 已成功操作 | 最多 5 步 Undo 的納入規則 |
| --- | --- |
| title/category/note/links/payer | 允許；取得相同 effect bundle、比對每個 changed group 的 after-version 及相依版本，原子 inverse；他人改無關群組不阻止 |
| pricing/participants | 允許；同時還原相關金額與 Actual 同步部分；rates/graph/歷史限制仍驗證；舊匯率不可因 Undo 重新寫回，變動則拒絕 |
| 只新增空白 placeholder | 僅它仍是未完成、沒有其他修改／付款／收據／引用，且版本完全符合時允許刪除；否則拒絕，不還原別人操作 |
| payment/source conversion、刪除完整紀錄、收據 upload/delete、旅程全體匯率 | 第一版不提供 Ctrl+Z；保留明確操作及必要確認，不承諾還原 Storage／歷史金流 |
| no-op/失敗/acquire/renew/release | 不入 stack，不消耗一步，也不清除既有可復原步驟 |

Undo 成功後只原子 pop 本分頁的一步；這個 inverse transaction 不新增 Undo 項目，沒有 Redo，也不能 Undo Undo 來無限切換。Undo 後的新可復原操作 push 到尚存的 stack，總數仍不超過 5；不建立被 pop 操作的 Redo 分支。重試成功的 Undo 必回同一 result，不能重複 pop；失敗則 stack 保持不變、顯示既有 inline／通知回饋，不跳過失敗目標。

**連續還原同群組的版本契約：** 例如本分頁把名稱 A→B（v1）→C（v2），Undo 最新一步把 C→B 後會產生新版本 v3，不能直接用舊 v1 CAS 還原更前一步。DB 必須在成功 Undo 的同一交易，沿已記錄的本分頁 operation lineage，驗證最新 inverse 的 restored image 與下一步所需狀態相符，才把下一個 stack top 的重疊 group expected-version 推進到 v3。不得更動其未被這次 inverse 觸及的 group/dependency 版本；不得只因目前值相同就跳過 revision 檢查。只有這段連續本分頁操作及已驗證的 inverse 可以推進期望版本，期間若有其他分頁／使用者／系統對相依群組的寫入，即使後來值相同也不能冒充本分頁 lineage。無法證實安全銜接就拒絕，不改寫已提交的原始 audit／request result。

同分頁發生不可復原的成功操作（付款、完整刪除、收據、全旅程匯率等）時，作為安全邊界清空尚存 stack，以免繞過財務副作用繼續還原更早狀態；失敗操作不清空。其他分頁操作不清本分頁 stack，但其造成的相依版本變動仍會拒絕危險 Undo。帳號撤權後不允許 Undo；server before-image／stack 受同一授權及 private table 隔離保護。

不新增歷史紀錄列表、時間軸、抽屜、步驟選擇器或 Redo 控制項；stack 與 lineage 是內部安全資料。只沿用 Ctrl+Z 和現有回饋位置提示成功／無可復原操作／版本衝突，不能選擇第 N 步跳著還原。

## 9. 舊入口與混合客戶端相容

| 入口 | bridge 及 groups 模式要求 |
| --- | --- |
| budget_edit_lease / legacy locked_by writes | 舊整筆 lease＝wildcard；有任何活躍 group 時拒絕舊 acquire，反向亦同；groups 開啟後舊 acquire 回 protocol_required |
| save_budget_workspace_record v1/v2/v3/v4 | bridge 僅在無群組租約且舊權限通過時執行，guard 必須記全部 group/effect 版本；groups 模式回明確升級錯誤，不委派新 protocol 的整表單 fallback |
| parent raw INSERT/UPDATE/DELETE、participant/link raw DML | bridge 需完整 legacy wildcard 交易授權且所有相依群組無新租約；groups 全拒絕不帶有效 effect 授權的 DML，包括未受舊 parent UPDATE guard 覆蓋的 INSERT |
| payment_only、is_fixed 舊 auto Actual、convertBudgetToActual、來源變更 | 不允許繞過 pricing/payer/graph；groups 導向專用新 API；legacy read-only 不代表可啟用舊 destructive unpaid |
| Actual/Budget delete 與 FK SET NULL/cascade | 驗證整個 effect 集合，包括 budget_origin/backlink、participants、links、attachments；自動 FK effects 不可偽裝成 metadata patch |
| mutate_budget_receipt、舊 attachments DML、Storage bytes | metadata 群組 guard；另核對 Storage policy，見下段，不能只攔 metadata 就說已保護收據 |
| update_trip_budget_rates、date/member/itinerary 相關 baseline triggers | 新協定驗證 affected groups／版本；保留 deferred baseline 的 cutoff；members/itinerary 刪除產生的相依效果需 source-aware 版本 invalidation |
| 舊 read_budget_snapshot / read_budget_collaboration、完整 App loadTripData | 保留相容讀取或清楚 protocol 資訊；v2 不存在時新 UI 停用寫入、保留 draft；不退回舊 save |

Storage 特別風險：目前舊刪除順序是 remove bytes→刪 metadata，metadata guard 攔不到已刪的 bytes。groups activation 前須完成 receipt Storage policy／狹窄 API 設計，讓舊 client 的 byte delete 在新協定模式不能先成功。既有 approved-membership 與 path 規則保留；新流程必須驗證 authorized receipt operation 與 canonical path，metadata delete 成功後執行 byte cleanup，失敗留 orphan cleanup 狀態；不得公開 bucket 或用 frontend service role 解決。若無法以現有 authenticated Storage policy 證實這條路徑安全，activation **不得通過**，需先實作經授權 server-side cleanup；這是 B-4 前的硬性 gate，不是已完成能力。

優先設計為 private `receipt_object_operations`：DB 驗證 receipts bundle 後登記 exact path、actor、action、短效狀態。groups 模式的 Storage INSERT/DELETE policy 只對 Actual receipt 路徑允許對應已核准操作，DELETE 需 metadata 已移除的 cleanup 狀態；upload 失敗的 rollback cleanup 也要明確授權。不得把這條限制套到住宿等其他附件。需修改目前 [Storage policy](../supabase/migrations/007_create_attachments_storage.sql) 及後續 private-helper policy 版本的最終定義，而非刪 storage.objects 代替 Storage API。這是選定的首要方案，必須先證實 Storage/RLS 呼叫語境與重試行為，不能僅有 grant row 就宣稱已能安全執行。

不能靠客戶端傳 `protocol:2` 或關掉按鈕識別新客戶端。DB private mode、lease epoch、版本與 whitelist 是權威。protocol cutover 必須暫停舊 client 寫入並要求更新；即使其他分支 Preview 仍在線也要 fail closed。跨舊／新交易共存與 grant/trigger 行為必須用真實不同連線驗證。

## 10. Migration、發布與回滾計畫

本階段不產生可被自動部署誤套用的 migration。後續實作時使用 `supabase migration new <name>` 產生實際版本；不預填時間戳、不修改已套用檔案。以下為四個邏輯 migration，需依實作依賴調整後分別 review。

| 段 | 預定內容 | 開啟條件／回退 |
| --- | --- | --- |
| M1 expand metadata | private group versions/leases/requests/undo-stacks/protocol；reader 新 API；舊資料 versions 初始化為 0；不動金融內容 | mode=legacy、groups API 不可寫；未開啟可保留 dormant metadata，或停用新 EXECUTE 後精確撤回 |
| M2 bridge guards/APIs | bundle acquire/patch/compound/delete/rates/receipts；legacy wildcard guard；每條舊路徑 version tracking；group collaboration projection | mode=bridge；只有通過 local/Staging 契約測試後才能允許測試群組寫入；資料庫仍保護舊 client |
| M3 incomplete/undo/read paths | readiness、條件 CHECK、complete filtering、placeholder、目前分頁最多 5 步 Undo／版本 lineage、baseline/settlement／snapshot adapters；Storage 安全路徑 | 全部 reader/aggregate 和副作用路徑均完成，資料 digest／rollback 測試通過；尚不可用舊 UI 操作 placeholders |
| M4 controlled activation | 新 frontend 正式／Demo parity、protocol 切換與 legacy write 拒絕；保留舊 read API／metadata | 明確 rollout 授權、live preflight、真雙帳號驗收；groups 生效後舊 UI 回升級訊息；不刪舊 API／table |

前置：[只讀盤點 SQL](qa/2026-10-29-budget-b1-readonly-inventory.sql) 收集版本、schema／constraints／triggers／grants／RLS/publication、活躍租約數、財務及 baseline counts/digests。不把它當 approval 或已執行的 remote audit。rollout wrapper 應鎖定目標 tables、精確比對 prerequisite source hash、原始財務／receipt/baseline digest、timeout、單一 transaction 登記 migration；失敗全回滾，成功另做獨立 readback。Windows paste 的 CRLF canonicalization 沿用 #14 已驗證策略。

回滾分級：

1. **activation 前**：撤銷新 API 的寫入權、確認無新 in-flight lease/request，再停用未用物件；舊 schema/data 不變。反向 migration 在 disposable DB 注入失敗，驗證舊函式 source／grants／triggers 全恢復。
2. **groups 已生效**：先 DB mode=paused 阻止新舊寫入；保留讀取與所有 draft／request result。等在途提交有結果，按 epoch 使新租約失效，不能單靠睡七分鐘後假定完成。snapshot、payment、receipt 等外部清理完成情形需核對。
3. **資料已有新操作**：優先保留新增 metadata/constraints 的 forward repair；不還原財務舊快照、不抹掉成功操作。未完成 rows 保留可讀清單；未處理前不可讓 v1 UI 恢復寫入／統計。可用支援 incomplete 的相容維護版，不自動刪 placeholder 或改成假 complete。
4. 若必須回舊 client：逐筆確認 incomplete／source/payment 操作的可表示性、Storage orphan／pending cleanup、versions／request ledger；取得另外的資料處理授權後才轉換。無法無損表示就維持 paused/forward repair。不要 `DROP ... CASCADE` 掃掉 ledger、receipt 或 financial rows。

## 11. 階段驗收矩陣與下一步

| Gate | 必驗內容 | 本次狀態 |
| --- | --- | --- |
| B-1 source audit | HEAD、Issue/UX、lease/RPC/trigger、付款/participants/receipt、Formal/Demo、空白約束與舊 UI 盤點 | 已完成；新協定為設計 |
| G1 群組 DB 契約 | 同組雙連線唯一 winner；同帳號不同 session 互斥；不同組 patch 保留雙方值；epoch/ABA/過期 release；unknown keys/跨 trip/撤權/RLS/grants | 待 M1/M2 實作與 disposable＋真多連線測試 |
| G2 financial graph | pricing＋payer並行不互覆；single retained 原子同步；multi payment 禁聚合；來源/刪除/cascade/legacy direct INSERT；注入第二筆 child write 失敗完整回滾 | 待實作 |
| G3 UI/idle | 同筆兩人開啟不鎖；focus/Tab/首次選單/IME；組內移動；autosave 後仍聚焦保留同一有效租約、接續輸入不重取；clean 離組／2m 釋放、dirty 10m／背景TTL；同列多組提示＋#14 dedupe；不自動搶鎖 | 待 B-2/B-3 |
| G4 autosave/recovery | 1s debounce、valid group transaction、串列化／快速新輸入、timeout同ID、lease遺失/同組衝突、snapshot合併、關閉/換旅程/登出 | 待 B-3 |
| G5 incomplete/undo | 另一成員即見同UUID placeholder、不進任何 totals/baseline；完成同ID；Ctrl+Z 原生優先／本分頁最多5步、第6筆淘汰最舊；同組連續5次Undo版本銜接、retry不重複pop、失敗不跳步；A住宿/B交通後 A只還原住宿；另一分頁同組更新拒絕、無關組更新不阻擋；不可逆操作清stack；無Redo／歷史紀錄UI | 待 B-3 |
| G6 rates/payment/storage | #9 現有 rates載入／首次初始化／跨人更新、出發後保護、retained不重估、600+300+300=1200、Receipt舊client byte delete拒絕／cleanup retry | 待 B-4；Storage 是 activation gate |
| G7 mixed rollout | bridge舊新互斥、groups拒絕v1-v4/raw/fallback、只讀/升級提示、pause/rollback/source digest、advisors與真帳號驗收 | 待明確 hosted 授權與完整實作 |

下一個實作切片建議：先做 M1/M2 的 **title＋note** 群組 DB 垂直切片，在 disposable PostgreSQL 驗證不同群組不互覆與 legacy wildcard，金融/空白新增/Undo仍關閉；接著 pricing/payer/payment graph。它是後續建議，不代表 B-2/B-3 已開始或要求再做一次 B-1。

## 12. 本次驗證與限制

- 既有財務／lease／snapshot／selection／receipt controller 測試：38/38 通過（六組既有測試，無新測試模仿未實作 API）。其中 finance 覆蓋精度／三模式／匯率／分攤，lease 覆蓋同帳號 tab、過期／釋放／晚到回應，sync 覆蓋 burst／ABA，collaboration 覆蓋 #14，receipt 覆蓋 metadata 失敗不刪 bytes。
- 這些是現有 JS/controller baseline，不是新 group DB SQL、真雙連線、hosted Realtime 或 UI autosave 的證明。新 migration、只讀 inventory SQL 尚未在 hosted 執行；新 schema 的競態、constraint 和 query plan 尚未測試。
- 檢查本文件與 CURRENT_TASK 的相對連結、git diff --check、normal production build；build 既有 chunk-size advisory 不納入本階段改版。
- 本階段只產出契約與盤點 SQL。沒有新 migration，因此沒有「已可套用」或「可正式啟用」的結論；完整 B-4 前不撤銷現有安全交易與權限保護。

官方依據（2026-10-29 查閱）：[Supabase functions](https://supabase.com/docs/guides/database/functions) 說明 invoker、definer/search_path 與 EXECUTE 授權；[Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes) 說明 publication/RLS 與刪除事件的限制，因此這份設計沿用既有 opaque invalidation 而不公開私有租約資料；[PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html) 說明短交易與一致鎖定順序。Supabase changelog 的 .md 端點回 unsupported MIME，改讀 [HTML changelog](https://supabase.com/changelog)；未據此更動 SDK/Realtime API。
