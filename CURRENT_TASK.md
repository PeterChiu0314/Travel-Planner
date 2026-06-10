# CURRENT_TASK.md

本文件記錄目前專案進度、當前工作方向、保護範圍與交接重點。之後 AI agent 進入專案時，請先閱讀本檔、`AGENT.md`、`UX_RULES.md`、`BUGS.md`。

---

## 目前分支

```text
main
```

Phase 3.3 已從 `codex/ui-experiment` 合併回 `main`，並已推送到 GitHub。

最新已合併 commit：

```text
d427c27 Merge remote-tracking branch 'origin/codex/ui-experiment'
```

後續若另開 UI 實驗分支，請依該聊天室/任務的 push 規則執行。

---

## 目前階段

目前仍在 MVP stabilization 與 Timeline desktop UI polish 階段。

Phase 3.3 備案翻卡已測試完成，可以告一段落。Phase 3.4 刪除確認與關聯交通卡清理已驗收完成。Phase 3.5 交通時間不足警示已驗收完成；Phase 3 收尾後，再進行 App Layout 改版。

核心方向：

- 維持既有 Supabase / Realtime / Draft Autosave / Edit Lock 穩定。
- 以小範圍 CSS / JSX 調整改善 Timeline 卡片閱讀性。
- 保持 Demo Timeline 與正式 Timeline UI 共用與一致。
- 避免大改資料流、schema、權限與架構。

---

## 最近完成

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
