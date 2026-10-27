# 旅程工房｜Travel Studio — 多人協作架構審查與 Budget Sync 設計建議

- **審查日期**：2026-10-27（Asia/Taipei）
- **審查類型**：唯讀架構／程式碼審查 + Supabase 官方文件比對
- **來源 Repository**：`PeterChiu0314/Travel-Planner`
- **審查分支**：`codex/luggage-workspace-redesign`
- **基準 Commit**：`c879ba222e37d5deee8ecdc6310bddaadb14a413`
- **範圍**：Timeline、Budget、Luggage；Presence／Broadcast／Postgres Changes、編輯鎖、請求競態、斷線恢復、Free 方案成本
- **本文件狀態**：**Review / Proposal；不是實作授權或結案證明**
- **操作邊界**：沒有修改程式／Schema／RPC，沒有部署、合併或操作正式資料庫
- **線上驗證限制**：Supabase 專案連接器未授權讀取專案設定／即時統計；未取得真正連線負載、RLS 政策或線上並發測試結果

> **核心方向**：保留已穩定的 UX 與既有業務 RPC；不要照搬 Timeline 的技術實作。先處理權限、原子鎖與資料一致性，再做低成本的即時協作視覺。避免把預算頁變成逐字共同編輯器。

## 0. 已確立的產品需求與非目標

### 產品需求

1. 參考 Google 試算表的多人即時協作體驗，但**不要求未儲存內容逐字同步**。
2. 遠端使用者在預算表格中**用既有成員顏色外框顯示選取／編輯狀態**。不常駐顯示「正在編輯」、「剛剛更新」等文字，避免列高、欄寬及位置跳動。
3. 沿用 Timeline 的成員顏色概念、Hover／Focus 浮動識別；本機選取和遠端狀態需同時可辨識。
4. A/B 可同時編輯**不同項目**；同一筆正式資料不可被不同編輯者靜默覆寫。
5. 預算、實付、分攤、付款狀態及統計應在他人**提交成功後**同步；金額與結算必須以資料庫結果為準。
6. 保留草稿與編輯器內容；重連／切換旅程不應清除使用者尚未儲存的輸入。
7. 盡量減少不必要的 Query、Realtime 訊息與 Channel churn，優先適配 Supabase Free。

### 不在本階段範圍

- 逐字／游標／輸入框同步、CRDT／OT、多人大型文件編輯。
- 整站重寫或一次替換所有 Timeline、Luggage、住宿功能。
- 單純為了使用新技術，強制把所有 Postgres Changes 換成 Broadcast。
- 在缺少線上設定／並發驗證時直接修改正式資料庫。

## 1. Executive Summary

| 優先度 | 發現／判斷 | 證據等級 | 建議 |
|---|---|---|---|
| **P1** | Presence／Broadcast Channel 目前未明確設 `private: true`；Repository 未找到 `realtime.messages` 授權政策 | 客戶端程式碼已確認；**正式專案設定／是否可越權尚待驗證** | 先做正式環境安全稽核與非成員 Join 測試，再分階段導入私人頻道 |
| **P1** | `acquireEditLock()` 先看舊資料，再 UPDATE `id`，沒有原子驗證原鎖持有者 | 程式碼已確認 | 補 DB 端條件式原子搶鎖；測同時搶鎖、同帳號多分頁 |
| **P1** | 編輯鎖用 `userId` 而非分頁 Session 識別；7 分鐘租約缺完整續期／所有權驗證 | 程式碼已確認 | 先補測與最小防護，評估獨立 Edit Lease；不要直接全站替換 |
| **P1（獨立）** | `loadTrips()` 未 SELECT `budget_exchange_rates`，但 BudgetWorkspace 從 `activeTrip` 讀取 | 程式碼已確認；正式 UI 尚待重現 | 已列於 [Issue #9](https://github.com/PeterChiu0314/Travel-Planner/issues/9)，不要混入 Sync 重構 |
| **P2** | 預算每筆 Postgres Changes 事件呼叫全旅程 `loadTripData()`（並行約 16 組查詢） | 程式碼已確認 | 同 scope 事件合併、預算資料快照、原子呈現 |
| **P2** | `activeDay` 是整個旅程 Postgres Changes Channel 的 effect 依賴；換 Day 導致預算等訂閱重建 | 程式碼已確認 | 拆開「訂閱生命週期」和「目前 Day callback」 |
| **P2** | Timeline 日級拖曳及路線編輯 Channel 在其他頁面仍可能存在 | 程式碼已確認 | 按真正需要的頁面／編輯模式加入與釋放；不影響既有 Timeline 行為 |
| **P2** | trip Presence 在卡片選取時也 `track()`；與選取 Broadcast 職責部分重疊 | 程式碼已確認 | Presence 限低頻在線／所在頁面；短暫狀態採 Broadcast 或 DB 鎖 |
| **P2** | 預算缺專屬重連後的權威資料恢復；多組查詢並非同一個一致快照 | 程式碼已確認 | 重訂閱／前景回復後 reconcile；考慮單一一致快照 read RPC |
| **P2** | 若干子表 SELECT／訂閱未限定 trip，而靠讀後過濾或 RLS | 程式碼已確認 | 透過父表 IDs、JOIN／唯讀 RPC 縮小範圍；DELETE 要實測 |
| **P3** | 缺正式服務雙帳號／兩分頁、成本與延遲基準數據 | 未做 live benchmark | 建立 QA matrix 與請求數、訊息數、p95 同步時間基準 |

**嚴重度說明**：P1 代表需優先查核／防護的風險，不代表已證實遭利用、資料外洩或正式站正在失效。

## 2. 現有架構盤點

### 2.1 Channel 清單、用途與生命週期

| Channel | 實作位置 | 主要內容 | 審查發現 |
|---|---|---|---|
| `trip-${tripId}` | [src/App.jsx](../src/App.jsx#L3828-L3918) | 多表 `postgres_changes` + 行李共用資料 | 預算／行程等事件多呼叫全旅程重讀；`activeDay` 改變會重建 |
| `trip-presence:${tripId}` | [src/App.jsx](../src/App.jsx#L3933-L4057) | 在線、頁面、Day、使用者顏色、Timeline selectedItem | 28 秒 heartbeat、55 秒 stale；選卡可能重複發 Presence |
| `timeline-drag:${tripId}:${dayIndex}` | [src/App.jsx](../src/App.jsx#L4122-L4479) | 拖曳 Presence + 選取／拖曳 Broadcast | 30 秒 selection stale；非 Timeline 頁仍可訂閱 |
| `timeline-route-edit:${tripId}:${dayIndex}` | [src/App.jsx](../src/App.jsx#L3412-L3741) | 地圖路線節點操作、Presence + Broadcast | 120ms node move throttle；需要 scope／重連保護，不適合直接搬到 Budget |

> 這是**每個已登入、已選旅程的正式頁面可能建立的四個 Supabase Realtime Channel**；Channel 不是獨立 WebSocket 連線，同一 `supabase-js` client 通常複用 WebSocket。實際連線數仍需量測。

### 2.2 Timeline：可重用與不宜照搬

**可重用：**
- `userId` 對應固定成員顏色：`timelineCollaboratorColorKey()`。
- 既有 `trip-presence` 成員身分、頁面與 Header Avatar；不必為 Budget 再建立在線列表。
- 同帳號不同分頁用 `sessionId` 判斷本地／遠端，UI 人數可按 `userId` 去重。
- Channel status／generation 防護、重連後重放必要的暫時狀態。
- 彩色外框但不重排項目；Hover／Focus 才顯示浮動名稱。

**不宜直接重用：**
- Timeline 單一 `foreignCardSelection` state：無法完整表示多位成員分別操作不同預算項目。
- Timeline 選取 30 秒 stale：開啟預算編輯器可能遠超過 30 秒。
- 拖曳 `node-drag-start/move/end` 的高頻 Broadcast 協定：預算沒有座標 preview。
- Timeline same-day drag readonly：預算應鎖住同筆資料，不鎖整個預算頁。

歷史依據：
- [Phase 4.8c2：拖曳 Presence／Broadcast 與頻道恢復](archive/Timeline_Phase4/2026-07-01-phase-4-8c2-collaborative-drag-presence-handoff.md)
- [Phase 4.8e：旅程在線成員](archive/Timeline_Phase4/2026-07-01-phase-4-8e-online-member-presence-handoff.md)
- [Phase 4.8f：遠端顏色視覺](archive/Timeline_Phase4/2026-07-01-phase-4-8f-remote-drag-visual-handoff.md)
- [Phase 5.7c：路線節點多人協作與競態修復](archive/Timeline_Phase5/2026-07-11-phase-5-7c-node-collaboration-handoff.md)

### 2.3 Luggage：值得重用的資料同步能力

[src/lib/luggageSync.js](../src/lib/luggageSync.js) 已有：
- `createRequestGuard()` 的 account/trip generation、scope、sequence。
- `createLuggageRefresh()` 的 80ms 合併、在途讀取 dirty re-run、過期結果拒收。
- 私人行李不訂閱即時事件；共用行李依旅程事件局部重讀。
- 共用物品 RPC 回應使用 canonical update，避免讀取覆蓋較新的本機結果。

**可採概念，不宜複製資料模型**：預算的總額、實付、成員分攤和關聯資料互相依賴，不能獨立回傳不同版本後直接逐表 setState。

### 2.4 Budget：目前資料更新流程

- 主要 Realtime： [src/App.jsx](../src/App.jsx#L3845-L3914)。
- 全旅程讀取： [src/App.jsx](../src/App.jsx#L3028-L3221)，16 組並行 SELECT。
- 預算編輯器： [BudgetWorkspace.jsx](../src/components/budget/BudgetWorkspace.jsx#L34-L161)。
- 寫入 RPC： [20261022120000_unified_planning_payments.sql](../supabase/migrations/20261022120000_unified_planning_payments.sql) 與 [20261022110000_budget_payment_safety_and_actual_cost.sql](../supabase/migrations/20261022110000_budget_payment_safety_and_actual_cost.sql)。
- 編輯鎖： [src/lib/editLocks.js](../src/lib/editLocks.js)。

一般儲存成功後，發起端重載資料；多個表更新的 Postgres Changes 事件亦會讓其他端重載。**沒有觀測到正式環境實際觸發次數；只能確認程式上缺合併機制。**

部分子表（`budget_item_participants`、`actual_expense_participants`、`itinerary_budget_items`、`itinerary_alternatives`）在 full load／訂閱中沒有直接 `trip_id` 過濾，靠後續 parent ID 交集或 RLS 限制範圍。這不等於越權讀取，但可能造成多旅程用戶無謂處理／載入。

## 3. 優先問題：Realtime Channel 授權

### 已確認

- `supabase.channel('trip-presence:...')`、`timeline-drag:...`、`timeline-route-edit:...` 的 client options 只有 Presence key，未指定 `config.private: true`。
- Repository 程式碼搜尋未發現 `realtime.messages` 或 `realtime.topic()` 授權政策。
- 無法從程式碼斷言正式 Supabase Dashboard 的 **Allow public access** 實際設定，也未執行非成員訂閱測試。

### 風險與建議

Supabase **public channel** 的安全性不應依賴 Channel 名稱含 UUID。需評估：已登入但非旅程成員，是否可在猜到／取得 topic 的情況下訂閱 Presence／Broadcast，接收人名、頁面或操作資訊，甚至偽造協作訊號。

1. 先在正式設定唯讀確認 public access、目前 auth、`realtime.messages` policies；以合法測試帳號執行**非成員不得 JOIN／收發**測試。
2. 為協作 Channel 規劃 **private channel + topic-scoped RLS**；政策以核准的 trip membership 判斷，區分讀／寫與必要 extension（Presence／Broadcast）。不可只寫 `TO authenticated USING (true)`。
3. 逐 Channel 漸進遷移，確保 Timeline 既有拖曳／地圖同步不斷線；**不要在 client 還是 public channel 時直接全域關閉 public access**。
4. 測被移出旅程、JWT 更換、在途連線、背景頁面及重連：Realtime Channel 授權會快取，權限撤回須考量 Token／重訂閱生命週期。
5. Postgres Changes 仍應以資料表的 RLS 控制資料權限；它與 Broadcast／Presence topic RLS 是不同層次。

官方：
- https://supabase.com/docs/guides/realtime/authorization
- https://supabase.com/docs/guides/realtime/settings

## 4. 優先問題：編輯鎖、Session 與衝突

### 已確認的競態

`src/lib/editLocks.js` 的 `acquireEditLock()` 在前端用收到的 `record` 判斷是否鎖定，再執行：

```js
supabase.from(table)
  .update({ locked_by: userId, locked_at: new Date().toISOString() })
  .eq("id", record.id)
```

UPDATE 本身沒有確認目前鎖狀態／舊 owner。兩位使用者從未鎖定快照同時操作，可先後更新同列並都以為自己成功。

- 鎖僅記 `userId`，同一帳號兩分頁無法完整區分。
- `editLockTimeoutMs = 7 * 60 * 1000`；長時間編輯缺明確 Lease Renew／Token Ownership。
- `touch_updated_at()` 在多表每次 UPDATE 都更新 `updated_at`，因此「取得／釋放編輯鎖」也可觸發 Realtime 與版本變化。
- Budget RPC 已有 transaction／`updated_at` conflict／locked_by 驗證，但不能取代**搶鎖本身的原子性**。

### 方案比較（先測再決定）

| 方案 | 優點 | 限制／成本 | 建議 |
|---|---|---|---|
| A. 在原表加原子 compare-and-swap／鎖定 RPC | 修改範圍較小，可先修實際搶鎖競態 | 鎖 UPDATE 仍觸發主表事件／timestamp；多分頁識別仍需處理 | **短期優先評估** |
| B. 獨立 `Edit Lease`（資源 `trip_id + resource_type + resource_id`，`user_id + session_id + lease_token + expires_at`） | 鎖與正式內容版本分離、可跨工作區共用 | 新 Migration、RPC、RLS 與舊流程相容遷移較複雜 | **若 A 無法同時解決長期問題，再分階段導入** |

不論方案 A/B，都必須：
- 原子取得鎖；續期、釋放、儲存檢查 owner/token（或等價安全條件）。
- 同帳號另一分頁不得把前一分頁的鎖當成自己持有。
- 過期可接手，但舊分頁回復不能再儲存舊版本。
- 編輯器失去鎖時保留草稿、回報衝突，不無聲覆寫。
- 其他使用者修改**不同預算項目**不能互相阻擋。

**禁止**為配合視覺直接使用 Broadcast 的「有人在編輯」當成資料庫權限或最終鎖狀態。

## 5. 建議資料同步：BudgetSnapshot + Context Guard

### 問題

1. 預算、實付、成員分攤、行程連結與統計互相依賴；每表各自 refresh 容易觀察到不同時間點的混合版本。
2. 16 組 SELECT 透過 `Promise.all` 並行，**並不等於交易級一致快照**。
3. 每個 Postgres Changes 事件都執行 full reload；同一筆 RPC 同時改動多表時特別浪費。
4. 即使 stale response 被 Request Guard 忽略，已送出的網路請求仍可能消耗資源。

### 目標設計

- **`BudgetSnapshot`**：單次更新應提供一致的預算模型，涵蓋 `budget_items`、`budget_item_participants`、`actual_expenses`、`actual_expense_participants`、`itinerary_budget_items`、`trip_budget_baselines`、旅程統一匯率及必要參照。
- 可比較 (a) 多表請求後在同一 commit apply，或 (b) 單一唯讀 RPC 聚合成 JSON snapshot。若選 (b)，**需驗證單一 SQL statement／交易快照一致性**；不能假設多條 PL/pgSQL SELECT 自然共享同一 MVCC snapshot。
- Event → `invalidate('budget')` → 短暫合併（候選 80–250ms，需量測）→ 一次讀取 → 一次原子套用。
- 讀取中再有變更則標記 dirty，完成後有界補讀；避免形成無限循環。
- 使用 account/trip/generation/sequence 守衛；A → B → A 舊 callback、舊快照不能寫回。
- RPC 成功回傳先以有根據的 canonical result 更新或安排 refresh；不要被較早 read 覆蓋。
- 明確處理 0 筆、刪除、取消實付、轉換來源、分攤、行程關聯、基線及匯率；統計永遠用同一版本資料計算。
- 隨 Realtime `SUBSCRIBED`／重連、`online`、前景可見與回到預算頁時執行必要 reconcile；要合併／限流。
- 正在編輯的 form/draft 不由背景資料更新直接覆寫；已選取項目被刪除時提供明確但不跳布局的衝突處置。
- 允許跨行程關聯資料變更觸發必要的 Budget invalidation，但不可每次都順帶刷新 Timeline 及地圖。

### 子表事件與 DELETE 的注意事項

資料表帶 `trip_id` 時可做旅程 filter；沒有 `trip_id` 的子表應採安全的 parent 參照、必要 ID 索引、合適的 DB notification 策略。**不要假定 DELETE 帶 `trip_id` filter 一定能在正式伺服器送達**，須以正式 Realtime + RLS + Replica Identity 測試。

### 不建議

- 每張表建立獨立永續 state 並各自刷新 React 統計。
- 每次鍵盤輸入或 Hover 就做 DB UPDATE。
- 直接把整份 BudgetSnapshot 透過使用者 Broadcast 發送並視為權威資料。
- 為了「像 Google Sheets」引入 CRDT／OT 或大型協作套件。

## 6. 協作 UI：顏色外框，但零版面跳動

- 保留原本本機 `.bw-row.is-selected` 的選取樣式；遠端使用者以既有 `timelineCollaboratorColorKey(userId, sessionId)` 的六色映射識別。
- 遠端狀態以**不參與布局的** `outline`、inset shadow、overlay 等方式繪製；HTML `<tr>` 的 outline／跨儲存格支援須經 Chrome、Edge、窄視窗測試。不可改變 `border-width` 造成列高或欄寬跳動。
- 不新增常駐「某某正在編輯」「剛剛更新」文案；Hover／Focus 才使用定位浮動標籤，行動裝置可透過項目明細或可及方式辨識。
- 優先用**已確認的 DB 編輯鎖或 Edit Lease 狀態**表示「正在編輯」，因為它代表可驗證的 ownership；僅選取而未開始編輯的瞬態提示才評估 Broadcast。
- 要支援多位成員操作不同列，不採 Timeline 單一 `foreignCardSelection`。
- 暫時提示可失效／遺失，但不能影響正式資料、資源鎖或 RPC 結果。
- 即時提示不得送出未儲存金額、備註、私人資料或不必要的 payload。

## 7. Presence／Broadcast／Postgres Changes 的責任界線

| 層 | 權威性 | 用途 | 更新頻率 |
|---|---|---|---|
| Trip Presence | 盡力而為 | 誰在線、所在頁面、成員顏色／身分 | 加入／離開／切頁 + 低頻 heartbeat |
| Broadcast | 盡力而為 | 必要時選取／拖曳等短暫視覺狀態 | 事件式；高頻才節流 |
| DB Edit Lock / Lease | 權威 | 誰能修改同一筆資料 | 取得、續期、釋放、過期 |
| Postgres Changes / DB 事件 | 變更通知，不是完整快照 | 告知對應 workspace 資料可能變更 | 資料真正 commit 後 |
| Workspace Read RPC / SELECT | 權威資料 | 重新取得一致的資料與統計來源 | 合併變更、恢復、首次進入 |
| 業務寫入 RPC | 權威 | 預算與實付原子寫入、版本與權限檢查 | 明確儲存／付款操作 |

**頻道數不是越少越好**：重要的是 scope、security、event traffic、重連策略與是否反覆 join。重用 trip-level Presence 並不代表應把高頻暫時事件重新塞回 `track()`。

## 8. Free 方案限制與成本模型

截至審查日，官方 [Realtime Limits](https://supabase.com/docs/guides/realtime/limits) 列出 Free：

| 指標 | Free |
|---|---:|
| Concurrent connections | 200 |
| Messages / second | 100 |
| Presence messages / second | 20 |
| Channel joins / second | 100 |
| Channels / connection | 100 |
| Presence calls / client / 30 seconds | 5 |

細節可能變更，實際以 Dashboard 配額和官方文件為準。Realtime 訊息按收發端計費／計額度，Postgres Changes 對每個訂閱端可計入訊息；Postgres Changes with RLS 隨收件者增加還有授權／DB CPU 成本：
- https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages
- https://supabase.com/docs/guides/realtime/benchmarks
- https://supabase.com/docs/guides/realtime/reports

**示意推估，不是線上實測：** 假設一次付款寫入造成 5 個資料表事件，4 個客戶端都收到，每個事件重新執行 16 個 SELECT，理論上可能產生 `5 × 4 × 16 = 320` 組讀取；若寫入端另有一輪 full reload，則可能更多。事件送達、重複、資料庫政策與重連會使實際數量不同。

**優化優先順序**：
1. 避免鎖 UPDATE 帶來整趟旅程重讀。
2. 同一 Budget 變更群組只做一次（必要時有界補讀）權威刷新。
3. 縮窄 SELECT 到單一旅程需要的資料，不讓其他 workspace 跟著刷新。
4. 切 Day 不重新建立無關 Channel；不活動的 Timeline 專用頻道按需釋放。
5. 量測流量與 p95 延遲後，再決定 Postgres Changes 是否需要遷移到服務端 Broadcast。

**不能宣稱目前已達或接近 Free 限制**：此次無正式 Dashboard、請求日誌或 Realtime Reports，沒有真實負載基準。

## 9. 分階段實施建議（需逐階段審核）

| 階段 | 優先級 | 內容 | 通過門檻 |
|---|---|---|---|
| 0. 安全／量測基線 | P1 | 讀正式 Realtime 設定與 RLS；非成員 Channel 測試；記錄現況訊息／讀取／延遲 | 權限風險明確；有 Before baseline |
| 1. 原子編輯鎖 | P1 | 原子搶鎖、同帳號雙分頁、續期／釋放／過期 ownership；保留草稿與寫入 RPC | 同時搶同筆僅一人持有；舊 Token 不能寫入 |
| 2. Budget Snapshot | P1 | scoped read、事件合併、dirty rerun、Context Guard、RPC 結果／刷新順序 | 金額與分攤一致；同次寫入讀取顯著下降 |
| 3. 協作外框 | P2 | 成員既有色彩、多人不同列、Tooltip、無 layout shift | 兩帳號雙向顯示正常、編輯鎖一致 |
| 4. Channel 清理 | P2 | 按需訂閱 Timeline 專用頻道、切 Day 不重建預算訂閱 | Timeline 已通過的多人回歸無退步 |
| 5. 效能與 Closeout | P2 | 比較 Before/After API requests、Realtime messages、channel joins、sync p95 | 有測量結果、Free 風險可說明 |

**部署策略**：新功能先在 feature branch + Mock／本機測試；涉及 DB/RLS Migration 須獨立 review、回滾方案與明確批准，再上線測雙帳號。已套用 Migration 不可原地修改歷史檔。

### 9.1 必測 QA Matrix

- [ ] 非成員／待審成員無法訂閱私人協作訊息；核准成員可正常收發。
- [ ] 權限被撤銷的使用者在 JWT 變更／重新連線後不再能接收或送出協作訊息。
- [ ] 兩帳號同時對同筆預算搶鎖，只有一方取得成功；另一方保留草稿。
- [ ] 同帳號兩分頁不能共享／搶走對方的 Lease Token。
- [ ] 不同成員編輯不同預算，外框、儲存及統計互不阻擋。
- [ ] 開編輯器超過 7 分鐘、網路短斷／背景返回、租約過期接手。
- [ ] 一次儲存同時改預算、已付款、實付與分攤，兩端清單／統計最終一致。
- [ ] 快速連續儲存／付款切換／刪除，同步順序不倒退，不恢復舊資料。
- [ ] A → B → A 切旅程與帳號切換，舊 callback、讀取、編輯提示都不能污染新 Context。
- [ ] 重連、visibility/focus、首次進預算頁都能與 DB 權威資料收斂。
- [ ] 多位編輯者外框同時存在；滑鼠、鍵盤、手機不造成布局位移。
- [ ] Budget Demo 保持離線／local mock，不誤訂閱正式 Supabase。
- [ ] Timeline 拖曳、路線節點、行李私人／共用 Realtime 全量回歸。
- [ ] Before/After：REST/RPC 呼叫數、Postgres Changes deliveries、Presence track 次數、Channel joins、重新訂閱數、p50/p95 同步時間、連線恢復次數。

### 9.2 完成定義

- **資料安全**：授權失效且無越權接收；同筆搶鎖和儲存無靜默覆蓋。
- **一致性**：同步完成後，兩帳號與刷新後 DB 結果一致；不丟草稿。
- **互動**：他人以顏色框即時可見、姓名僅浮動提示、沒有布局跳動。
- **效能**：有可再現的基準與改善數據；不能只用「感覺更快」結案。
- **維護性**：功能層業務獨立；共用 Session／Channel／Context／Refresh 基礎，不重建另一套沒有必要的狀態管理。

## 10. 文件依據與後續工作

### 目前程式位置

- [src/App.jsx：Full Trip Loader](../src/App.jsx#L3028-L3221)
- [src/App.jsx：Realtime Postgres Changes](../src/App.jsx#L3828-L3918)
- [src/App.jsx：Trip Presence](../src/App.jsx#L3933-L4120)
- [src/App.jsx：Timeline Drag + Broadcast](../src/App.jsx#L4122-L4479)
- [src/App.jsx：Route Edit Collaboration](../src/App.jsx#L3412-L3741)
- [src/lib/luggageSync.js](../src/lib/luggageSync.js)
- [src/lib/editLocks.js](../src/lib/editLocks.js)
- [src/components/budget/BudgetWorkspace.jsx](../src/components/budget/BudgetWorkspace.jsx)
- [src/components/budget/budget-page.css](../src/components/budget/budget-page.css)
- [supabase/migrations/009_add_edit_locks.sql](../supabase/migrations/009_add_edit_locks.sql)
- [supabase/migrations/20261022120000_unified_planning_payments.sql](../supabase/migrations/20261022120000_unified_planning_payments.sql)

### 官方資料（2026-10-27 檢索）

- [Supabase — Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization)
- [Supabase — Realtime Settings](https://supabase.com/docs/guides/realtime/settings)
- [Supabase — Realtime Limits](https://supabase.com/docs/guides/realtime/limits)
- [Supabase — Subscribing to Database Changes](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes)
- [Supabase — Realtime Benchmarks](https://supabase.com/docs/guides/realtime/benchmarks)
- [Supabase — Realtime Reports](https://supabase.com/docs/guides/realtime/reports)
- [Supabase — Realtime Messages Usage](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages)

### 與其他工作項目的邊界

- [Issue #9：正式版旅程匯率資料缺口](https://github.com/PeterChiu0314/Travel-Planner/issues/9) **獨立處理**，避免和 Sync 重構互相掩蓋原因。
- 此文件是**架構審查報告與建議目標**，不是 Codex 一次實作所有階段的 Prompt。
- 下一步應先把階段 0 的線上權限稽核、基準量測與階段 1 的鎖競態重現做完，再決定要不要採用獨立 Lease 表、單一快照 RPC 或更多 Broadcast。

---

_Review note：本報告所述「程式碼已確認」僅指目前分支中可直接觀察的邏輯；網路延遲、訊息數、非成員實際 Join、正式 DB Policy、跨分頁衝突發生率和上線效能，均須以正式環境／隔離測試補證。_
