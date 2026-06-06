# CURRENT_TASK.md

這是給未來 AI agent 使用的目前工作脈絡。請保持簡短，當優先順序改變時更新此檔案。

## 目前階段

專案目前處於 MVP stabilization。

目前原則：

* 保護既有多人協作流程。
* 優化容易讓使用者遺失資料或卡住的 UX。
* Demo 頁面要與正式 app UI 保持一致。
* 改善 travel-first 的可用性與規劃流程。
* 優先做小而安全的修改，避免大型重寫。

---

# 目前主要焦點

## Timeline Layout & Transportation UX Phase

目前焦點：

* 先專注常規電腦螢幕比例。
* 在做更廣泛的 responsive 優化前，先打磨標準桌面版 Timeline workspace 版面。
* 在行程項目之間加入 transportation card。
* 保持地圖收合與 Day Board 行為穩定。
* 保護 draft autosave、edit lock、Realtime safety 與 Demo parity。

## 優先順序

1. 標準桌面版面比例
2. Day Board / map ratio polish
3. Transportation card UX：Phase 3.0 / 3.1 / 3.1a 已完成；下一步 Phase 3.1b 警示 UI polish
4. Timeline card density polish
5. Demo parity
6. Regression safety

---

# 最近已完成的 Timeline 工作

Phase 1 與 Phase 2 已大致穩定。

已完成：

* UI 文案統一：「時間軸」→「行程」，「地點」→「目的地」。
* Timeline card 時間顯示簡化為 `HH:mm`。
* 時間選項改為每 5 分鐘一跳。
* 新增行程時，若上一筆有結束時間，會自動帶入開始時間。
* BUG-016 invalid time validation 已保留：
  * `end_time <= start_time` 會禁止儲存。
  * 顯示錯誤提示。
  * Editor 不會關閉。
  * Draft 與 lock 會保留。
* Timeline 頁不再顯示 Budget 或 Luggage panels。
* Members panel 已移到 sidebar。
* Desktop 40/60 Timeline layout 已完成。
* Map / route panel 收合已完成。
* 地圖收合模式已顯示 Day Board columns。
* Day Board tabs、水平導覽與 active Day 行為已完成。
* Day Board card polish 已完成：
  * Active Day column 較寬。
  * Cards 使用目的地作為主要標題。
  * Timeline form 不再顯示獨立的 title/name 欄位。
  * 儲存時仍會讓 `title` 與 destination/location 同步，以維持資料相容性。
* Phase 3.0 Transportation Card v1 已完成並通過功能測試：
  * 可在相鄰景點卡之間新增、展開、收合、編輯、刪除交通卡。
  * 每組相鄰景點 pair 最多顯示一張交通卡。
  * 景點卡依 `start_time` 排序；交通卡以 `from_item_id` / `to_item_id` pair 插入相鄰景點之間。
  * non-adjacent transport 在 Phase 3.1 改為保留資料並置頂顯示「交通資訊需確認」警示，不刪除、不硬塞到錯誤 gap。
  * Phase 3.1a 一般警示改用上下景點 `start_time` / `end_time` / destination 快照判斷；備註、地址、Map URL 等非交通路線欄位不觸發。
  * Phase 3.1a 已將 pair FK 改為 `on delete set null`，刪除上下景點後交通卡保留並進入失效警示區。
  * Phase 3.1a 已完成測試 OK；接下來進行 Phase 3.1b Transportation warning UI polish。
  * Insert zone 已完成輕量化 polish，避免破壞 Day Board 卡片密度。
  * Demo Timeline 與正式版保持同一行為，仍是 mock/local-state only。
* Demo Timeline 保持 parity，且仍是 mock/local-state only。

---

# 目前非目標

除非使用者明確要求，否則不要做：

* Supabase schema changes
* Realtime subscription rewrites
* Draft autosave key 或 storage redesign
* Edit lock flow rewrite
* Google Maps API integration
* Inline card editing architecture
* Alternative flip-card UI
* Route-click auto scroll
* Marker/card hover sync
* Container/view extraction
* 大規模 `src/App.jsx` architecture rewrite
* 新增 framework、TypeScript、Tailwind 或 Next.js migration
* Tablet、mobile、narrow-window 或 device-specific layout optimization

---

# 穩定性要求

必須保護：

* Draft autosave 行為
* Edit lock 行為
* Realtime active edit safety
* Demo/form parity
* Google OAuth flow
* Share route behavior
* Budget、Luggage、Auth、Share data flows
* RLS-backed permissions
* BUG-016 invalid time range validation

不要：

* 在 reload/refetch 時重新初始化 active forms。
* 讓 Realtime 覆蓋 active edits。
* 讓 Demo 連到 Supabase、Realtime、Storage、Auth 或 localStorage。
* 大幅重寫 `src/App.jsx`。
* 更動 Supabase schema 或 migrations。

---

# 目前測試重點

每次修改後都要執行：

```bash
npm run build
```

Manual regression focus：

* Timeline 編輯在切換瀏覽器 tab / app switch 後仍保留。
* Save 後正確清除 draft。
* Cancel 後正確釋放 lock。
* Realtime update 不會覆蓋 active form。
* Demo timeline 不需登入仍可使用。
* Demo timeline 仍維持 mock-state only。
* Timeline validation 仍會阻擋 invalid time range。
* 新增行程預設帶入上一筆結束時間的行為仍正常。
* Map expanded mode 的 route/map context 仍穩定。
* Map collapsed mode 的 Day Board columns 仍穩定。
* Day tabs 與 Day Board 水平導覽仍正常。

---

# 如果不確定

優先選擇穩定性，而不是新功能。

修改 Timeline 行為前，先檢查：

* `AGENT.md`
* `UX_RULES.md`
* `BUGS.md`
* `src/lib/draftAutosave.js`
* `src/lib/editLocks.js`
* `src/App.jsx` 裡的 Realtime subscription flow
