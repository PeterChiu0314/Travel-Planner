# Home Codex Handoff

這份文件是給家裡電腦上的 Codex 接手用的專案交接摘要。開始工作前，請先讀：

* `AGENT.md`
* `UX_RULES.md`
* `CURRENT_TASK.md`
* `BUGS.md`

---

# 專案背景

這是一個「旅程規劃室」網站，用來做多人協作旅行規劃。

網站核心用途：

* 建立與管理旅程。
* 共同編輯行程 Timeline / 行程頁。
* 管理預算、實際支出與結算。
* 管理住宿、待辦、行李。
* 邀請旅伴加入，owner 審核成員。
* 產生 readonly 分享連結。
* 提供 `/demo` mock 版本，方便不用登入也能檢查 UI/UX。

技術棧：

* React 18 + Vite 5。
* Plain JavaScript / JSX。
* Plain CSS，主要在 `src/styles.css`。
* Supabase Auth / Postgres / RLS / Realtime / Storage。
* Google OAuth 登入。
* Vercel 部署。
* 這不是 Next.js、不是 TypeScript、不是 Tailwind、不是 WordPress。

本專案目前仍在 MVP stabilization。改動時請優先保護資料安全、協作安全與表單生命週期。

---

# 目前狀態

已完成或大致完成：

* Google OAuth login。
* Trip CRUD 與 active trip 切換。
* Owner / editor / viewer 角色與 pending approval flow。
* Invite link flow。
* Supabase RLS 與 trip-scoped Realtime。
* Timeline / 行程 CRUD。
* Timeline alternatives。
* Timeline 與 Budget 多對多連動。
* Budget planned items、actual expenses、equal split、convert to actual。
* Settlement 計算。
* Accommodation / Todo / Guide / Luggage 功能。
* Attachments metadata + private Storage signed URL。
* Public readonly share snapshot。
* Draft autosave。
* Record-level edit lock。
* Demo routes:
  * `/demo/timeline`
  * `/demo/budget`
  * `/demo/luggage`

Timeline Phase 1 / Phase 2 已大致收斂：

* 文案統一：「時間軸」→「行程」、「地點」→「目的地」。
* Timeline card 時間顯示為 `HH:mm`，不顯示秒數。
* 新增/編輯時間選項為每 5 分鐘一跳。
* 新增行程可自動帶入上一筆結束時間。
* BUG-016 invalid time range 已修復並需保留。
* Timeline 頁已移除 Budget / Luggage 區塊。
* MembersPanel 已移到 sidebar。
* Desktop 40/60 layout 已完成。
* 地圖/route context 可收合。
* 收合後 Day Board 橫向多欄已完成。
* Day tabs、左右箭頭、Day column active 樣式已完成。
* Day Board card polish 已完成：
  * active day column 較寬。
  * card 主標題使用目的地。
  * Timeline 表單不再顯示獨立「名稱」欄位。
  * 儲存時仍同步 `title = destination/location` 以保護既有資料結構。

---

# 想接著做什麼

目前 active focus 請以 `CURRENT_TASK.md` 為準。

目前下一階段是：

## Timeline Layout & Transportation UX Phase

優先順序：

1. 常規桌面螢幕比例的 Timeline 版面調整。
2. Day Board / map ratio polish。
3. Transportation card UX。
4. Timeline card density polish。
5. Demo parity。
6. Regression safety。

重要更正：

* 先不要做 tablet / mobile / narrow-window / device-specific layout optimization。
* 現階段先專注常規電腦螢幕比例。
* 之後才處理其他設備版面適應。

Transportation card 方向：

* 在 itinerary items 之間加入交通資訊卡。
* 先做 UI/UX 與資料流最小可行版本。
* 不接 Google Maps API。
* 不改 Supabase schema，除非使用者明確要求並同意 migration scope。

---

# 已知問題

請先看 `BUGS.md` 的最新狀態。

目前重要風險：

* `src/App.jsx` 很大，請避免大規模重構。
* Realtime 現在是 broad reload，改 Timeline 時不可讓 active editor 被 refetch 重置。
* Draft autosave 必須保留：
  * 編輯中切 tab/app switch 後內容仍在。
  * save success 要 clear draft。
  * cancel 要提示並 release lock。
* Edit lock 必須保留：
  * 只鎖單筆 record。
  * save / confirmed cancel 後 release。
* Demo 必須保持 mock/local React state only：
  * 不連 Supabase。
  * 不連 Auth。
  * 不連 Realtime。
  * 不連 Storage。
  * 不使用 localStorage。
* Share route 必須 readonly，不能曝光 budget、settlement、luggage、private member data。
* Windows terminal 可能把中文顯示成 mojibake；不要只靠 PowerShell 輸出判斷原始碼是否壞掉。以 build / browser 檢查為準。

最近已修過的高風險 bug：

* `activeDay is not defined` production crash。
* restoreDrafts runtime crash。
* BUG-016 invalid time validation。
* 多個 Timeline Day Board layout / card polish 問題。

---

# 重要檔案

入口與設定：

* `index.html`
* `src/main.jsx`
* `src/App.jsx`
* `src/styles.css`
* `vite.config.js`
* `vercel.json`
* `package.json`

Supabase / collaboration：

* `src/lib/supabase.js`
* `src/lib/draftAutosave.js`
* `src/lib/editLocks.js`
* `supabase/migrations/*.sql`

專案交接與規則：

* `AGENT.md`
* `UX_RULES.md`
* `CURRENT_TASK.md`
* `BUGS.md`
* `HOME_CODEX_HANDOFF.md`

主要 React 結構目前多數仍在 `src/App.jsx`：

* `App`
* `DemoApp`
* `TripWorkspace`
* `ItineraryTimeline`
* `MultiDayTimelineColumns`
* `RoutePanel`
* `BudgetPanel`
* `LuggagePanel`
* `MembersPanel`
* `ShareView`

---

# 部署資訊

GitHub repo：

* `https://github.com/PeterChiu0314/Travel-Planner.git`

Vercel：

* Repo 內有 `vercel.json`。
* `vercel.json` 目前只設定 SPA rewrite：
  * `/demo` → `/index.html`
  * `/demo/:path*` → `/index.html`
* 本機 repo 目前沒有 `.vercel/project.json`，所以 Vercel project id / org id 未記錄在 repo。
* 正式網址目前未寫在 repo 文件中，請回家後到 Vercel dashboard 或 Vercel CLI 確認。

環境變數：

* `VITE_SUPABASE_URL`
* `VITE_SUPABASE_ANON_KEY`

不要把 Supabase service role key 放進前端或 repo。

---

# 家裡電腦接手流程

1. Clone repo:

   ```bash
   git clone https://github.com/PeterChiu0314/Travel-Planner.git
   cd Travel-Planner
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. 建立 `.env`，填入：

   ```bash
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   ```

4. 啟動 dev server:

   ```bash
   npm run dev
   ```

5. 每次完成修改至少執行：

   ```bash
   npm run build
   ```

6. 如果修改 Timeline / Demo / form flow，請手動檢查：

   * `/demo/timeline` 不需登入可用。
   * Demo 不打 Supabase/Auth/Realtime/Storage/localStorage。
   * Timeline 新增/編輯/刪除正常。
   * invalid time range 仍會擋 save。
   * 編輯中切換地圖顯示/隱藏不會清掉輸入。
   * active form 不會被 Realtime/refetch 重置。

---

# 工作提醒

請保持小步修改。

不要一次大改：

* `src/App.jsx`
* Timeline architecture
* draft flow
* realtime flow
* Supabase schema

目前最重要的是把 Timeline 做得更像 travel planning workspace，同時保護：

* draft autosave
* edit lock
* realtime active edit safety
* demo parity
* Auth / Share / Budget / Luggage
