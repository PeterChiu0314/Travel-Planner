# CURRENT_TASK.md

本文件記錄目前專案進度、當前工作方向、保護範圍與交接重點。之後 AI agent 進入專案時，請先閱讀本檔、`AGENT.md`、`UX_RULES.md`、`BUGS.md`。

---

## 目前分支

```text
codex/trip-date-data-flow
```

本分支專門處理旅程日期變更與行程資料流。Header 改版分支已合併進 `main`，Phase 1.7 起請在本分支上繼續日期資料流相關工作，不要切回 `main` 或另開分支，除非使用者明確要求。

目前本聊天室規則：修改完成並驗證後，預設 commit 並 push 到 `origin/codex/trip-date-data-flow`；若單一任務明確禁止 push，則以該任務指示優先。

---

## 目前階段

目前進入 App Layout Phase 1.7：旅程日期與行程資料流階段。

Phase 3 已大致收尾。App Layout Header Phase 1.0～1.6A 已完成並合併，Sidebar 與 Toolbar 後續會另開階段處理。目前重點改為：旅程日期變更後，Timeline、住宿、預算、待辦、Share / Export 等資料如何安全同步。

Header 目前狀態：

- Phase 1.0 Header 基礎改版：✅ 已完成、已驗收
- Phase 1.1 Header 上方間距修正：✅ 已完成、已驗收
- Phase 1.2 旅程名稱 Inline Edit：✅ 已完成、已驗收
- Phase 1.3 Header Metadata 結構與互動入口：✅ 已完成、已驗收
- Phase 1.4 Header 日期 Popover：✅ 已完成、已測試、User Verified!
- Phase 1.5 旅程階段自動判斷與 Header 顯示：✅ 已完成、已測試、User Verified
- Phase 1.6 目的地 Popover 與 Map-ready 國家／城市資料結構：✅ 已完成、已測試、User Verified
- Phase 1.6A 移除舊鉛筆入口，將 Legacy Editor 改為開發者日期工具：✅ 已完成、已測試、User Verified
- Phase 1.7A 日期與各模組資料關聯 Audit：✅ 已完成
- Phase 1.7B 日期變更分類、Timeline 預檢與警示 UI：✅ 已完成、已測試、User Verified
- Phase 1.5B 旅程檢視模式：⏸ 暫緩規劃，尚未實作

核心方向：

- 維持既有 Supabase / Realtime / Draft Autosave / Edit Lock 穩定。
- 旅程日期變更需先做預檢、影響統計與使用者確認，再做任何資料搬移或刪除。
- 避免用前端多次 request 處理高風險縮短清理；需要 transaction 的情境優先評估 RPC。
- Header 日期 Popover 與開發者日期工具維持既有 UI，不進行 Sidebar / Toolbar / Timeline layout 改版。
- 不要在未確認規則前自動刪除 itinerary、住宿、待辦、預算連結或固定景點。

---

## 最近完成

### App Layout Header

- Phase 1.0：建立緊湊雙行式 Trip Header。
  - 第一行顯示旅程名稱與右側 icon actions。
  - 第二行顯示目的地、日期、天數、階段、成員數。
  - 匯出 JSON、刪除旅程收進更多選單。
  - `.trip-fields` 不再常駐占用 Header 下方高度，改由「編輯旅程資料」入口開啟。
- Phase 1.1：修正 Header 上方異常留白。
  - `.workspace` 保留左右下 padding，`padding-top` 改為 0。
  - `.trip-header` 自身負責上方 30px 間距。
- Phase 1.2：旅程名稱 Inline Edit。
  - 有權限者點擊旅程名稱可切換 input。
  - Enter 儲存、Esc 取消、blur 依既有規則處理。
  - Owner / Editor 可改名；Viewer 維持純文字。
- Phase 1.3：Header Metadata 結構化。
  - metadata 拆成目的地、日期、天數、階段、成員數。
  - 目的地與日期為可互動入口；成員數可導向既有 Sidebar 成員區。
  - Demo 與 Formal 共用同一套 Header 視覺規則。
- Phase 1.4：Header 日期 Popover。
  - 日期 metadata 點擊後開啟輕量 popover。
  - Popover 包含開始日期、結束日期、旅程天數 preview、取消、儲存。
  - 支援 Enter 儲存、Esc / 外部點擊 / 取消 / 切換旅程 / 切換 section 關閉。
  - 使用既有 `onUpdateTrip({ start_date, end_date })` 更新旅程日期，不處理 Timeline 日期搬移、資料刪除或 day remap。
  - `npm.cmd run build` 與 `git diff --check` 已通過。
  - 狀態：已完成、已測試、User Verified!
- Phase 1.5：旅程階段自動判斷與 Header 顯示。
  - Header 旅程階段改由今天日期、旅程開始日期、旅程結束日期推導。
  - Header 不再依賴 `trips.status` 顯示階段，也不會寫回資料庫。
  - 缺少日期或日期無效時顯示「階段未設定」。
  - 旅程階段維持純顯示，不可點擊、無 dropdown、無 preview mode。
  - Phase 1.5B 旅程檢視模式暫緩規劃，尚未實作。
  - 狀態：已完成、已測試、User Verified。
- Phase 1.6：目的地 Popover 與 Map-ready 國家／城市資料結構。
  - Header 目的地點擊後開啟專用 Popover，不再直接開舊完整旅程資料編輯區。
  - 新增 `destination_country`、`destination_city`，並保留 `destination` 作相容欄位。
  - Header 顯示優先讀國家／城市，舊資料使用 `destination` fallback。
  - 儲存目的地時同步更新 country、city、combined destination。
  - Formal / Demo 共用同一個 TripHeader Popover JSX。
  - 不串接 Map API，不處理 geocoding、Place ID、lat / lng。
  - 狀態：已完成、已測試、User Verified。
- Phase 1.6A：移除舊鉛筆入口，將 Legacy Editor 改為開發者日期工具。
  - 移除旅程名稱旁舊鉛筆按鈕。
  - 更多選單中的「編輯旅程資料」改為 Owner-only「開發者工具」。
  - 開發者工具只保留開始日期、結束日期、說明、取消、套用測試日期。
  - 開發者工具允許歷史日期，用於測試旅程階段與歷史旅程。
  - Demo 預設不顯示開發者工具。
  - 狀態：已完成、已測試、User Verified。

### App Layout Phase 1.7：旅程日期資料流

- Phase 1.7A：日期與各模組資料關聯 Audit。
  - 狀態：已完成。
  - 本次只做 audit，未修改 App code、schema、migration 或資料。
  - 目前模型屬於混合模型：Timeline Day 由 `trips.start_date` / `trips.end_date` 動態產生，但 `itinerary_items` 同時存 `day_index` 與 `date`。
  - Formal Timeline 主要用 `day_index` 顯示；`itinerary_items.date` 在新增時寫入，但改旅程日期時不會自動同步。
  - Header 日期 Popover 與 Owner-only 開發者日期工具目前都只更新 `trips.start_date` / `trips.end_date`，沒有搬移、刪除或 remap itinerary / accommodation / todo / budget data。
  - 縮短旅程後，超出新 day range 的 itinerary row 仍留在 DB 與 state，但沒有對應 Day tab / Day board 可見。
  - Share Snapshot / Export JSON 可能仍包含正式 Timeline 看不到的 itinerary rows。
  - Accommodation 有自己的 `check_in_date` / `check_out_date`；Todo 有 `due_date`；目前都只依 `trip_id` 查詢，不依旅程日期範圍過濾。
  - Luggage 與 Guide 不直接依旅程日期。
  - 固定景點 `is_fixed` 目前只保護手動編輯 / 刪除 / 排序 / 備案，不會阻止旅程日期更新造成資料隱藏或後續刪除風險。
  - 建議後續 Phase 先做前端預檢與影響統計，再進入資料搬移 / 刪除 / RPC transaction。

Phase 1.7 拆分：

- Phase 1.7B：日期變更分類、Timeline 預檢與警示 UI。
  - 狀態：已完成、已測試、User Verified。
  - 判斷相同天數、延長、縮短。
  - 找出被排除尾端 Day。
  - 統計 Timeline 資料。
  - Accommodation / Todo 提醒。
  - 預留未來 `trip_days`。
  - 不正式搬移或刪除資料。
- Phase 1.7C：安全日期變更執行。
  - 狀態：Migration 已套用正式 Supabase，待正式頁功能測試。
  - 相同天數整體平移。
  - 延長旅程。
  - 縮短空白尾端 Day。
  - 同步 `itinerary_items.date`。
  - Day 順序維持。
  - 使用 transaction / 集中資料入口。
  - 正式頁測試清單：
    - 相同天數整體平移：旅程日期更新，Timeline `day_index`、item id、交通 pair、備案、固定景點、預算連結保留，`itinerary_items.date` 依新開始日重算。
    - 只延長結束日：新增尾端空白 Day，不新增 Timeline row，既有 item date 不被不必要更新。
    - 開始日提前並延長：Day 順序維持，所有 Timeline item date 依新開始日與 `day_index` 重算。
    - 縮短空白尾端 Day：允許儲存，Timeline 資料不刪除。
    - 縮短且尾端有 Timeline 資料：必須被阻擋，trip dates 與 item dates 不變。
    - Developer Date Tool：走同一個 `apply_trip_date_change` 入口，Owner-only。
    - 交通卡、備案、固定景點、預算連結：資料與關聯保留。
    - Accommodation / Todo：日期與資料完全不變，只保留提醒。
- Phase 1.7D：縮短旅程確認與 Timeline 資料清理。
  - 有資料的尾端 Day 警示。
  - 顯示景點、交通、備案、固定景點統計。
  - 確認後 transaction 刪除。
  - Budget link 解除、Budget 保留。
  - Accommodation / Todo 不自動修改。
- Phase 1.7E：跨流程一致性與正式收尾。
  - Share View。
  - Export JSON。
  - Developer Date Tool。
  - activeDay / Session restore。
  - Formal / Demo parity。
  - 防止其他日期更新路徑繞過統一資料入口。
- Phase 1.7F：完整回歸測試與文件更新。

### Phase 3 目前順序

- Phase 3.0：交通卡 v1 ✅ 已完成
- Phase 3.1：交通卡警示 ✅ 已完成
  - 一般警示
  - 失效警示
  - 刪除上下景點後交通卡保留
  - 快照判斷
- Phase 3.2：景點卡原位置展開編輯 ✅ 已完成
  - 點 E 後在原卡片位置展開
  - 點卡片本體仍是展開 / 收合詳細資訊
- Phase 3.2a：地圖展開模式版面規劃 ⏸ 暫緩
  - Reason：需等 App Layout / Trip Header / Sidebar 統一後再處理
- Phase 3.2b：Inline editor auto scroll ⏸ 暫緩
  - Reason：需等 scroll 容器規則確定後再處理
- Phase 3.3：地圖點位自動捲動 ⏸ 暫緩
  - Reason：需等地圖展開版面與 scroll 容器確定後再處理
- Phase 3.3：備案翻卡 ✅ 已完成
  - 備案只做景點卡
  - 每張景點卡最多 1 個備案
  - 移除 prompt / alert / confirm 式備案操作
  - 景點卡展開後可建立 / 編輯 / 刪除備案
  - `↻` 直接主備互換，不需要再按「使用此備案」
  - 主行程與備案可互換，item id 與位置不變
  - 主行程與備案共用同一套 `item.start_time` / `item.end_time`
  - 互換後相關交通卡沿用 Phase 3.1 快照比對顯示一般警示
  - Demo Timeline 已同步
- Phase 3.4：刪除確認與關聯交通卡清理 ✅ 已完成
  - 景點卡按 X 時先顯示刪除確認。
  - 若景點有關聯交通卡，確認刪除後一併移除 from/to 關聯交通卡。
  - 交通卡按 X 時先顯示刪除確認。
  - 保留 Phase 3.1 失效交通卡警示，用於排序變動、順序反轉、舊資料異常等非刪除景點造成的 pair 無效情境。
  - Demo Timeline 需同步 local state 行為。
- Phase 3.5：交通時間不足警示 ✅ 已完成
  - 有效相鄰交通卡才計算交通時間是否足夠。
  - 當 `transport_duration_minutes` 大於前一景點結束到後一景點開始的間隔時顯示警示。
  - 只提醒，不阻止景點或交通卡儲存。
  - 交通時間不足不能透過確認解除，只能透過調整景點時間或交通時間解除。
  - 若同時有一般快照警示，確認按鈕只清除一般快照警示，交通時間不足會保留。
  - 失效交通卡仍沿用 Phase 3.1 失效警示，不計算交通時間不足。
- Phase 3.6：景點卡固定 / 鎖定 ✅ 已完成
  - 只支援景點卡固定，交通卡不提供鎖定。
  - 未固定景點顯示 🔓，固定後顯示 🔒。
  - 固定景點只允許展開 / 收合與查看內容。
  - 固定景點不可編輯、刪除、翻卡、建立 / 修改 / 刪除備案。
  - 鎖定前若該景點正在被編輯或被 edit lock 佔用，會阻止鎖定。
  - Demo Timeline 使用 local state 同步支援。

Phase 3 收尾後，優先進行 App Layout 改版。

### Timeline 景點卡

- 時間欄改成開始時間、CSS 垂直線、結束時間三段結構。
- 窄版 `.time-block` override 已修正，避免蓋掉 active day 主卡的 flex column。
- 無備註卡片會保留一致收合卡高度，但不再用高空白硬撐。
- 收合卡透過 `.timeline-item` min-height 與 `.item-main` flex 垂直置中維持高度與視覺穩定。
- 景點卡標題、pill、mini button 視覺密度已調整。
- Phase 3.2 inline editor 已完成：點景點卡 E 後，編輯表單會在原卡片位置展開，不再固定出現在 Day 頂部。
- 點景點卡本體仍維持展開 / 收合詳細資訊，不會直接進入編輯模式。
- Phase 3.3 備案翻卡已完成：
  - 每張景點卡最多 1 個備案。
  - 備案面與主行程面透過 `↻` 直接互換。
  - 主備互換只交換目的地、備註、Map URL 等景點內容；時間維持同一張景點卡共用。
  - 備案建立 / 編輯表單已精簡為目的地、備註、Map URL。
  - 景點卡表單已移除費用、地址、交通備註，改以停留時長連動開始 / 結束時間。

### Timeline 交通卡

- 交通卡改成與景點卡一致的三欄概念：
  - 左欄交通 icon
  - 中欄交通名稱
  - 右欄 E / X actions
- warning badge 已移到交通標題後方，例如：

```text
🚆 JR奈良線・25分鐘 ⚠
```

- 交通卡 E / X 已固定在右上角。
- 展開交通卡 details 目前版面：
  - warning detail 是獨立 row
  - 備註在下方左欄
  - 預算 pill 在下方右欄
- 展開 warning detail 只在 `.transport-card.expanded` 顯示；收合時只顯示標題旁 badge。
- 交通卡展開區已移除「備註：」與「預算」label，只保留內容本身。
- 一般 warning detail 句尾已補句點。

### 文件 / agent 規則

- `AGENT.md` 已新增 code modification rules：
  - 既有檔案優先使用 `apply_patch`
  - 優先小範圍 targeted edits
  - 優先只修改受影響 JSX/CSS block
  - 避免 PowerShell / Node one-liner / regex global / whole-file rewrite
  - 只有建立新檔、migration、刻意替換文件、或使用者明確核准的大重構才允許 whole-file rewrite

---

## 當前保護範圍

除非使用者明確要求，不要修改：

- Supabase schema / migrations
- RLS policies
- Realtime subscription flow
- Draft Autosave
- Edit Lock
- Auth / Google OAuth flow
- Share route
- Invite flow
- Transportation card 資料模型
- Transportation card pair 判斷邏輯
- Demo 資料流
- 大範圍 `src/App.jsx` 架構

若進行 UI 調整，使用者可能會先用 DevTools 預覽 CSS，再提供 selector / 數值。請依提供內容做最小修改。

---

## 目前驗證方式

每次修改後至少執行：

```bash
npm.cmd run build
```

目前 build 會出現既有 Vite chunk size warning，這不是本輪 UI 修改造成的錯誤。

手動檢查重點：

- `/demo/timeline`
- 正式登入後 Timeline
- 地圖展開模式
- 地圖收合 Day Board
- 交通卡一般 warning
- 交通卡失效 warning
- 交通卡展開 / 收合
- E / X 右上角位置
- warning badge 位於交通標題後方
- warning detail 只在展開時顯示

---

## 已知注意事項

- PowerShell 讀取中文檔案時可能顯示亂碼，不一定代表原始檔壞掉。
- 但不要用 `Get-Content | Set-Content` 或 PowerShell 全文 rewrite 處理含中文的 JSX。
- 若需要修改 `src/App.jsx`，使用 `apply_patch`，並讓 patch context 儘量小。
- 若 `apply_patch` 因中文 context 不穩，優先改用更小的 ASCII 周邊 context，而不是全文替換。
- Demo Timeline 與正式 Timeline 的 active day 主卡共用 `ItineraryTimeline`。
- Day Board preview 走 `MultiDayTimelineColumns`，不是完全相同 render path。

---

## 下一步可能工作

依目前 Phase 3 新順序繼續：

- Phase 3 收尾。
- App Layout 改版。

暫緩項目：

- 地圖展開模式版面規劃。
- Inline editor auto scroll。
- 地圖點位自動捲動。

暫緩原因：

- 需等待 App Layout / Trip Header / Sidebar 統一。
- 需等待地圖展開版面與 scroll 容器規則確定。

---

## 交接提醒

本專案是 Vite + React SPA，不是 Next.js。

主要相關檔案：

- `src/App.jsx`
- `src/styles.css`
- `AGENT.md`
- `UX_RULES.md`
- `BUGS.md`
- `CURRENT_TASK.md`

修改 UI 時請保持保守、小步、可驗證。
