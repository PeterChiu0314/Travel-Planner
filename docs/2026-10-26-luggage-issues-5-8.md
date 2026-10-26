# 行李 Issues #5–#8 改善紀錄 — 2026-10-26

基準：`codex/luggage-workspace-redesign`，`94d28a9`。本輪已完成本機實作與驗證，使用者已要求發布目前功能分支。Git發布範圍包含程式碼、測試、文件及新migration檔；尚未部署、套用新migration或更新／關閉GitHub issues。

## #5：帳號與離線快取隔離

- `src/lib/offlineCache.js` 統一管理 v2 帳號／旅程 key 與 envelope；讀取同時驗證使用者、旅程與 12 小時有效期。
- 舊的未分帳號旅程快取只清除、不搬遷；舊帳號旅程清單 key 不讀取。帳號切換及登出清除前帳號快取，不刪其他帳號快取與編輯草稿。
- 不將私人行李／備註存入持久快取；從舊或異常 envelope 讀到私人行李也不恢復。這不宣稱 localStorage 具有加密或能抵禦同源惡意程式；其他旅程資料仍為短期離線快照。
- 短暫離線可保留同情境記憶體中的私人物品；重新整理後離線則不恢復私人物品，連線成功後再載入本人資料。
- Auth callback 在 React 更新前即失效舊 context，清空資料；getSession 的晚到回應不能蓋過新 auth 事件。旅程清單與完整旅程讀取也有序號／情境守衛。

## #8：共用資料局部 Realtime

- 移除私人表的 subscription；保留單一全域 channel 內其他工作區的原有 callback。
- 共用表 INSERT／UPDATE／DELETE 通知經 `subscribeSharedLuggage` 只排程 shared scope，80ms 合併事件；讀取中收到新通知會丟棄舊結果，再讀一次最新資料。
- 不直接以事件 payload 拼出完整資料，尤其 DELETE 通知不當成帶完整旅程欄位的資料來源；重新查詢當前旅程的權威共用清單。參考 [Supabase Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)。
- 成功 RPC 直接套用回傳資料，不再無條件抓兩份行李或整趟旅程。衝突才針對相關 scope 重讀。
- 帳號／旅程 generation 防 A→B→A；各 scope 序號阻止晚回應覆蓋 RPC。可見清單與離線共用快照採相同版本合併，保留較新列、刪除及排序回應之外的新列。
- 私人跨裝置收斂點：進入行李頁、focus、頁面恢復 visible、online、channel 訂閱／重新訂閱、整頁重新整理。不是持續即時同步。

### 讀取次數

| 情境 | 原程式分析 | 隔離正式 App 實測 |
| --- | --- | --- |
| 本人勾選私物成功 | 自行操作後讀兩份行李；私人事件還可能觸發全旅程讀取 | RPC 後新增表讀取 0 次 |
| 連續 20 個共用通知 | 每事件呼叫含 16 組結果的 `loadTripData`，未合併（最多約 320 次表讀取；未做真實服務量測） | 合併為 1 次 `shared_luggage_items` SELECT；其他表 0 次 |

測試以實際 `App` 搭配完整隔離 Supabase mock；未使用真實兩個帳號、正式網路斷線或服務端 Realtime 通道。這些線上人工驗收仍待執行。

## #6：未指派移除與待套用 migration

- 清除 UI 群組、拖曳接收區、取消指派確認及提示；新增／改派／排序 service 在呼叫 RPC 前拒絕空負責人。
- 正常測試資料皆有有效負責人；原未指派測試轉為有效成員操作或負向驗證。
- 新 migration：`supabase/migrations/20261026120000_luggage_required_assignee.sql`。
- 先統計 NULL 負責人資料，再僅刪除這些共用紀錄；有舊私人影本連結或非 NULL 但成員無效的紀錄，會中止交易，不能偷偷改寫／刪除其他資料。
- `assigned_to NOT NULL`；帳號 FK 改為 NO ACTION，另加 `(trip_id, assigned_to)` 成員 FK。使用 statement-end 可驗證的約束，以免整個旅程 cascade 刪除被錯誤阻擋。
- 成員狀態降為未核准會阻擋；移除成員／刪除帳號須先改派。全旅程刪除仍可清除該旅程資料。
- INSERT／改派 trigger 以 row lock 驗證已核准成員。唯一新 definer 為不在 public 的內部 trigger：先檢查 actor 旅程權限，只鎖定成員列、不回傳資料、不提供 Data API RPC，且撤除 public／anon／authenticated 的直接 EXECUTE。理由是 viewer 可指派物品，但不能透過成員 RLS 鎖定／更新其他人的成員紀錄。
- 原有 invoker RPC、精確版本、編輯鎖、RLS、原子轉換和負責人勾選權限保留。

### 正式執行前

新 migration **尚未套用**，未讀取或刪除正式物品。不能把離線測試清理筆數當成正式筆數。部署依賴：先核對目標專案、以下統計及是否有無效成員／舊影本，再於同一交易套用 migration；核對 migration 紀錄、欄位約束、觸發器與實際清理筆數。不要單獨發布前端後宣稱資料庫已禁止 NULL。

```sql
select count(*) as unassigned_shared_items
from public.shared_luggage_items where assigned_to is null;

select count(*) as blocked_legacy_mirrors
from public.luggage_items p join public.shared_luggage_items s on s.id=p.shared_item_id
where s.assigned_to is null;

select count(*) as needs_reassignment
from public.shared_luggage_items s
where s.assigned_to is not null and not exists (
  select 1 from public.trip_members m
  where m.trip_id=s.trip_id and m.user_id=s.assigned_to and m.status='approved'
);
```

本次離線資料庫中刪除 4 筆舊 NULL 測試紀錄，已指派與私人紀錄的完整 JSON 快照未變；不是正式資料清理。

## #7：二次確認盤點及分階段遷移

| 項目 | 本輪決定 | 理由 |
| --- | --- | --- |
| 準備 UI／進度／篩選 | 僅讀 `packed_by_assignee` | 單階段準備；非負責人包含總召皆不能代勾 |
| 新 Demo 紀錄 | 不再建立 `confirmed_by_owner` | 不示範已淘汰功能 |
| 客戶端 confirmed patch | 拒絕 | 沒有二次確認入口或 owner 例外 |
| 舊 server row 的 confirmed 欄位 | 容忍讀取；既有欄位在改內容／準備時可清 false | 不影響舊資料解析，從未用於判定準備 |
| DB confirmed 欄位、舊 RPC／trigger 相容分支 | 保留，不 DROP | 尚未證明沒有已部署舊客戶端；#7 明確要求分階段與相容優先 |
| 歷史 migrations／DB 舊客戶端測試 | 保留 | 驗證遷移前行為及舊版本安全性，不代表現行產品仍有功能入口 |

後續移除條件：盤點實際已部署用戶端及使用情形，確認沒有 confirmed patch 依賴，先停用舊 patch（明確相容錯誤），經驗證後另開 migration 清 trigger/RPC 分支，最後才考慮刪欄。每階段均須測 RLS、本人準備權限、版本與鎖，不與本輪 NULL 清理混為一談。

## 驗證

- `tests/offlineCache.spec.js`：真實瀏覽器 storage A/B 隔離、舊 key、不持久保存私人資料、TTL、清理範圍及 blocked storage。
- `tests/formalLuggageSync.spec.js`：實際 App 的 A→B 延遲回應、私人 RPC 零額外讀取、20 次共用事件單次 scoped SELECT、舊全域讀取不能覆蓋 RPC／離線快照。
- `tests/luggageSync.spec.js`：事件合併、讀取中再通知、scope／context 序號、RPC 版本合併、失敗恢復、重新訂閱。
- `tests/luggageAssignmentRules.spec.js`：空負責人與確認 patch 被拒絕、單階段準備權限、新 Demo 資料。
- `tests/luggage-database.mjs`：遷移前相容鏈＋新 migration 的 NULL 清理、NOT NULL／成員 FK、移除／降級／刪帳號阻擋、改派後移除成功、全旅程刪除、RLS、內部 trigger 不可直接呼叫。153 assertions 通過。
- 完整 UI 回歸176/176通過，Build及diff檢查通過（既有bundle-size提醒）；詳見 `CURRENT_TASK.md`。
