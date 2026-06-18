# CURRENT_TASK.md

## Documentation Layout

Root Markdown files are entry points. Detailed project documents are stored in `docs/`.

Read these for phase handoff and operating context:

- `AGENT.md`
- `docs/UX_RULES.md`
- `docs/BUGS.md`
- `docs/PHASE_2_SIDEBAR_HANDOFF.md`
- `docs/PHASE_1_8_WORK_LOG.md`

## Latest Status - 2026-06-18 Office Wrap-up

Branch:

```text
codex/app-layout-phase-3-workspace
```

Status:

```text
App Layout Phase 3 Timeline Workspace - audit and light/full-height polish pushed, ready to continue at home
```

Latest pushed commits:

- `0db4e95 docs: add phase 3 workspace audit`
- `066a51b style: polish timeline workspace layout`
- `ac9656a style: fit timeline workspace height`
- `9b62ed2 style: pin timeline map workspace`
- `ff7b2b1 style: adjust timeline map overlay spacing`

Completed in this office-side wrap-up:

- Phase 3.1 Timeline Workspace Audit was documented in `docs/PHASE_3_WORKSPACE_AUDIT.md`.
- Phase 3.2 Timeline Workspace light polish was implemented:
  - Day tabs display was simplified to `Day N M/D`.
  - Timeline workspace ratio was adjusted toward left Day Board / right route-map context.
  - Timeline-specific panel surfaces were weakened without changing global `.panel` or `.content-grid`.
  - Formal Timeline and `/demo/timeline` share the same Timeline workspace styling.
- Phase 3.2b Timeline Workspace full-height fit was implemented:
  - Day Board and route/map context now fill the available desktop workspace height.
  - Map-expanded workspace prevents whole-workspace vertical scrolling; only the left Day Board scrolls.
  - Route heading is overlaid at the map area top-left.
  - Route list is pushed below the overlaid heading.
  - The right route/map area keeps a full-height grid background as a future Google Map placeholder.

Validation completed:

- `npm.cmd run build` passed.
- `git diff --check` passed, with only Windows LF/CRLF warnings.
- `npm.cmd run test:e2e` passed, 12/12, after Playwright Chromium was installed on this office machine.

Home continuation:

- Pull `codex/app-layout-phase-3-workspace` before continuing.
- Continue from `ff7b2b1 style: adjust timeline map overlay spacing` unless newer remote commits exist.
- Manually verify the Timeline workspace visual fit on the home machine:
  - Formal Timeline with map expanded.
  - `/demo/timeline` with map expanded.
  - Map hidden / multi-day Day Board mode.
  - Left Day Board vertical scrolling while the right map area remains fixed.
- The current height and sticky values are visual-tuning candidates:
  - `.timeline-workbench { height: calc(100dvh - 112px); }`
  - `.timeline-workbench .side-panels { top: 74px; }`
  - `.timeline-workbench .route-map { padding: 72px 18px 18px; }`
- Keep the next work as CSS / tiny JSX polish unless explicitly scoped otherwise.
- Do not add Google Map API or Timeline Phase 4 transportation creation in this phase.

## Latest Status - 2026-06-17 Home Wrap-up

Branch:

```text
codex/app-layout-sidebar-phase-2.2
```

Status:

```text
App Layout Phase 2 Sidebar - collapsed sidebar polish pushed, ready to continue at office
```

Latest pushed commits:

- `0da3629 feat: add collapsed sidebar trip flyout`
- `1c6f664 style: polish sidebar and header spacing`

Completed in this home-side wrap-up:

- Collapsed Sidebar trip list was converted into a dedicated trip-list entry button under the nav icons.
- The trip-list button opens a right-side flyout panel with the full trip list layout and create-trip `+` inside the panel.
- Collapsed Sidebar no longer shows the standalone create-trip `+` in the rail.
- Collapsed Sidebar account avatar was restored to the bottom of the rail and kept centered.
- Collapsed account menu position was adjusted to open from the lower rail area.
- Demo Sidebar was kept in parity with the formal Sidebar for the collapsed trip-list flyout behavior.
- Header and Sidebar spacing polish was pushed:
  - Header bottom border removed.
  - Header blur/shadow fade added with `.app-shell-workspace .trip-header::after`.
  - Header margin/padding tightened.
  - Sidebar, brand, logo, nav spacing tightened.

Validation completed:

- `npm.cmd run build` passed.
- `npx.cmd playwright test tests/phase-1-8-source-guards.spec.js` passed, 7/7.
- `npx.cmd playwright test` passed, 12/12, after the collapsed trip flyout work.
- `git diff --check` passed, with only Windows LF/CRLF warnings.

Office continuation:

- Pull `codex/app-layout-sidebar-phase-2.2` before continuing.
- Continue from `1c6f664 style: polish sidebar and header spacing` unless newer remote commits exist.
- Remaining Sidebar work should stay as small CSS/JSX polish unless explicitly scoped otherwise.
- Keep the known `<=1100px` responsive Sidebar issue for the later Mobile / Tablet layout stage.

## Latest Status - App Layout Phase 2 Sidebar Home Wrap-up

Branch:

```text
codex/app-layout-sidebar-phase-2.2
```

Status:

```text
App Layout Phase 2 Sidebar - home wrap-up complete, ready to continue at office
```

Latest office-side update - 2026-06-16:

- Current branch remains `codex/app-layout-sidebar-phase-2.2`.
- Sidebar collapsed UI polish has been implemented and pushed:
  - Logo acts as the expand button in collapsed mode.
  - Collapsed logo hover shows lucide `PanelLeftOpen`.
  - Expanded collapse button uses lucide `PanelLeftClose`.
  - Collapsed nav icons are centered.
  - Collapsed active nav keeps the dark green icon background with white icon.
  - Collapsed trip create button uses lucide `Plus`.
  - Collapsed trip cards use fixed icon-size buttons and show only the first character of the trip title.
  - Collapsed account area shows only the avatar.
  - Collapsed account menu opens as a dropup to the right and is not clipped.
- Sidebar account menu redesign has been implemented and pushed:
  - Account area is a clickable card in expanded mode.
  - Account menu contains Settings and Log out with lucide `Settings` and `LogOut`.
  - Existing Settings navigation and Sign Out flow were preserved.
- Recent local CSS polish not yet pushed at the time of this update:
  - `.app-shell.sidebar-collapsed` width changed to `66px`.
  - Formal `.sidebar` padding changed to `24px 10px 8px`.
  - `.demo-sidebar` padding synced to `24px 10px 8px`.
  - Low-height desktop media query sidebar padding synced to `14px 10px 8px`.
  - Collapsed trip card size changed to `40px`.
  - Collapsed create trip button size changed to `32px`.
  - Collapsed account menu left edge changed to `left: 100%` so it touches the sidebar boundary.
- Validation after the local CSS polish:
  - `npm.cmd run build` passed.
  - `git diff --check` passed.
- Full Playwright browser smoke was not rerun after this local CSS-only polish. Earlier full Playwright run on this machine was blocked by missing Playwright Chromium executable; source-guard tests passed after the collapsed sidebar JSX/CSS work.

Completed in the latest home-side wrap-up:

- Phase 2.6 Demo Sidebar Parity is implemented as UI-only local state:
  - Demo Sidebar uses local mock trips.
  - Demo supports Sidebar collapse.
  - Demo trip list scroll, Header, and account area now match the formal Sidebar structure.
  - Demo does not use Supabase, Auth, Realtime, Storage, Draft Autosave, or Edit Lock.
- The Demo nested Shell issue was fixed; Demo pages no longer render blank when Sidebar is expanded.
- Formal and Demo Sidebar account areas now match:
  - Name on the first line.
  - Email on the second line.
  - The old small account label is removed.
- Sidebar trip heading polish is complete:
  - "我的旅程" and the create trip button were enlarged for clearer hierarchy.
  - The trip heading bottom border was removed.
- Account area polish is complete:
  - `.user-box` top padding is now `10px`.
  - `.user-email` is now 11px and regular weight.

Validation completed:

- `npm.cmd run build` passed.
- `npx.cmd playwright test` passed, 11/11.
- `git diff --check` passed, with only Windows LF/CRLF warnings.
- Browser visual verification was not available in the Codex desktop sandbox on this machine; the Browser runtime failed with `CreateProcessAsUserW failed: 5`.

Latest pushed continuation point:

```text
latest pushed commit after this wrap-up: feat: align demo and formal sidebar account UI
```

Office continuation:

- Tomorrow at the office, pull `codex/app-layout-sidebar-phase-2.2` and continue from the latest pushed commit.
- Remaining Sidebar work should stay as small CSS/JSX polish unless explicitly scoped otherwise.
- Keep the known `<=1100px` responsive Sidebar issue for the later Mobile / Tablet layout stage.

## Current Status - App Layout Phase 2 Sidebar Wrap-up

Branch:

```text
codex/app-layout-sidebar-phase-2.2
```

Status:

```text
App Layout Phase 2 Sidebar - mostly complete / small polish remains
```

Summary:

- Header Phase 1 is complete, user verified, merged to `main`, and remains the baseline for Phase 2.
- Sidebar Phase 2 work is currently on `codex/app-layout-sidebar-phase-2.2`.
- `origin/main` is still at `526f9d3 docs: add phase 2 sidebar handoff`; Sidebar Phase 2 work has not been merged to `main`.
- Sidebar information architecture is implemented.
- App shell scroll layout is implemented: Sidebar/Header are fixed in desktop workspace mode and Workspace owns main scrolling.
- Sidebar compact/collapsed mode is implemented.
- Desktop low-height Sidebar trip list minimum height was fixed so "我的旅程" stays usable.
- Phase 2.5a is complete: New Trip Dialog now reuses the Header date range picker UI.
- New Trip creation data flow is unchanged and still submits selected `start_date` / `end_date`.
- Latest pushed commits on `codex/app-layout-sidebar-phase-2.2`:
  - `06b04b0 feat: update sidebar information architecture`
  - `1f681cd feat: fix app shell scroll layout`
  - `38a54bb fix: prevent sidebar trip cards stretching`
  - `50383d0 feat: add sidebar compact mode`
  - `746aac1 fix: preserve sidebar trip list height`
  - `02355d0 feat: reuse date picker in trip dialog`

Next likely work:

- Final Sidebar visual polish / QA.
- Decide whether to update `docs/PHASE_2_SIDEBAR_HANDOFF.md` or create a Phase 2 completion handoff.
- When ready, merge `codex/app-layout-sidebar-phase-2.2` into `main`.
- Continue to avoid broad rewrites; remaining Sidebar work should be small CSS/JSX polish unless explicitly scoped otherwise.

Known issue - Sidebar responsive at `<=1100px`:

- At `<=1100px`, Sidebar switches to a top layout and the trip list can spread horizontally, taking too much height.
- This was intentionally not fixed in Phase 2.4.
- Handle this later in the Mobile / Tablet layout stage.
- Possible directions:
  - Hide Sidebar trip list under `<=1100px`.
  - Replace it with a mobile trip switcher.
  - Move trip switching into Header / bottom sheet / drawer.

Handoff note:

- Home-side Phase 2.4 wrap-up was done before the latest office-side commits.
- Current local workspace has now been pulled to the GitHub latest branch state.
- Continue from `eed45d1 docs: update sidebar phase handoff status` unless newer remote commits exist.

本文件記錄目前專案進度、當前工作方向、保護範圍與交接重點。之後 AI agent 進入專案時，請先閱讀本檔、`AGENT.md`、`docs/UX_RULES.md`、`docs/BUGS.md`。

---

## 目前分支

```text
codex/app-layout-sidebar-phase-2.2
```

本分支目前處理 App Layout Phase 2 Sidebar 收尾與小型 UI polish。Header 改版已合併進 `main`；Sidebar Phase 2 尚未合併進 `main`。

目前本聊天室規則：修改完成並驗證後，若使用者要求 push，推到 `origin/codex/app-layout-sidebar-phase-2.2`；若單一任務明確禁止 push，則以該任務指示優先。

---

## 目前階段

App Layout Phase 2：Sidebar 收尾階段。Phase 2.2～2.4 已大致完成；Phase 2.4b 與 Phase 2.5a 已完成並 push。

Phase 2 已完成重點：

- Phase 2.1 Sidebar audit：已完成，記錄於 `docs/PHASE_2_1_SIDEBAR_AUDIT.md`。
- Phase 2.2 Sidebar information architecture：已完成。
- Phase 2.3 Fixed Sidebar / Header / Workspace scroll：已完成。
- Phase 2.4 Desktop nav / compact mode / collapsed behavior：大致完成。
- Phase 2.4b Desktop Sidebar Trip List minimum height：已完成。
- Phase 2.5a New Trip Dialog date picker reuse：已完成。

目前保護範圍：

- 不改 Auth / Google OAuth。
- 不改 Share route / Share Dialog core behavior。
- 不改 Invite / member mutation logic。
- 不改 Draft Autosave。
- 不改 Edit Lock。
- 不改 Realtime subscription flow。
- 不改 Supabase schema / RLS / RPC / migrations。
- 不改 `updateTripDateRange()` 或旅程日期 RPC 資料流。
- 不改 `selectTrip` / dirty editor guard。
- 不改 Sidebar layout，除非任務明確要求。

建議驗證：

```powershell
npm.cmd run build
git diff --check
```

如果任務影響 navigation、Demo route、Share route、App shell loading，追加：

```powershell
npm.cmd run test:e2e
```

以下 Phase 1 / 日期資料流紀錄為歷史脈絡，仍可作為保護規則參考。

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
- Phase 1.7C 安全日期變更執行：✅ 已完成、已測試、User Verified
- Phase 1.7D 縮短旅程確認與 Timeline 資料清理：✅ 已完成、已測試、User Verified
- Phase 1.7E 跨流程一致性、Share / Export / Draft 收尾：✅ 已完成、已測試、User Verified
- Phase 1.7F 完整回歸測試與文件更新：✅ 已完成、已測試、User Verified
- Phase 1.5B 旅程檢視模式：⏸ 暫緩規劃，尚未實作

Phase 1.7 最終核心規則：

- 維持既有 Supabase / Realtime / Draft Autosave / Edit Lock 穩定。
- 正式旅程日期變更必須走 `updateTripDateRange()`，再走 `apply_trip_date_change` RPC；不要直接更新 `trips.start_date` / `trips.end_date`。
- 旅程日期變更需先做預檢、影響統計與使用者確認，再做任何資料搬移或刪除。
- 縮短旅程且尾端有 Timeline 資料時，必須明確確認後才可 transaction 刪除。
- Header Date Popover 不可繞過結算階段日期鎖。
- Developer Date Tool 可覆寫 settlement phase date lock，但仍必須通過 Owner 權限、active editor / dirty draft guard、危險縮短確認與 RPC transaction。
- Share / Export 的 Timeline 日期應與正式 Timeline 一致，以 `trip.start_date + day_index` 對齊，不依賴舊 `itinerary_items.date` 作顯示真相。
- Accommodation / Todo / Budget 本體不因旅程日期變更自動修改；只在 preview / 提醒中提示使用者檢查。
- `trip_days` 尚未導入；目前仍使用 `day_index + date` 混合模型。
- JSON import 尚未實作，後續應獨立進入 Data Portability Phase。
- 016 / 017 / 018 migrations 已套用正式 Supabase；後續 schema / RPC 變更不可修改已套用 migration，需新增 019+。

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
  - 狀態：已完成、已測試 OK、User Verified。
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
  - 狀態：已完成、已測試 OK、User Verified。
  - 有資料的尾端 Day 警示。
  - 顯示景點、交通、備案、固定景點統計。
  - 確認後 transaction 刪除。
  - Budget link 解除、Budget 保留。
  - Accommodation / Todo 不自動修改。
- Phase 1.7E：跨流程一致性與正式收尾。
  - 狀態：已完成、已測試、User Verified。
  - Share View 日期範圍過濾與日期一致性。
  - Share Link 單筆規則。
  - Export JSON 日期一致性。
  - Developer Date Tool settlement override。
  - activeDay / Session restore clamp。
  - Formal / Demo parity。
  - 防止其他日期更新路徑繞過統一資料入口。
- Phase 1.7F：完整回歸測試與文件更新。
  - 狀態：已完成、已測試、User Verified。
  - 已建立 Playwright smoke / e2e 測試環境。
  - `npm.cmd run build` 通過。
  - `npx.cmd playwright test` 通過，4 tests passed。
  - 已記錄 vite / esbuild npm audit vulnerability 為 backlog，不執行 breaking `npm audit fix --force`。

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
- `docs/UX_RULES.md`
- `docs/BUGS.md`
- `CURRENT_TASK.md`

修改 UI 時請保持保守、小步、可驗證。

---

## Phase 1.8 Work Log

### Phase 1.8A - Audit

- Completed: Audited current App Header, member/sidebar/share/invite permission boundaries, and confirmed no DB/RLS/RPC changes are required for this phase.
- Changed files: none.
- Test result: read-only audit; no validation commands required beyond branch/status checks.
- Next: Implement Header member preview and unified members/invite entry.

### Phase 1.8B - Header Member Entry

- Completed: Replaced the standalone invite icon in TripHeader with a member preview button that shows member avatars and owner-only pending count.
- Changed files: `src/App.jsx`, `src/styles.css`.
- Test result: `npm.cmd run build` passed.
- Next: Build the unified members/invite dialog.

### Phase 1.8C - Members / Invite Dialog

- Completed: Replaced the old invite-only dialog with a members dialog that lists approved members, supports owner role changes for editor/viewer, supports member removal, shows pending requests for owner, and keeps settlement-phase member management locked.
- Changed files: `src/App.jsx`, `src/styles.css`.
- Test result: `npm.cmd run build` passed.
- Next: Align Demo route behavior with the formal Header entry.

### Phase 1.8D - Demo Parity

- Completed: Added Demo Header member entry behavior and a read-only Demo members dialog without Supabase writes.
- Changed files: `src/App.jsx`.
- Test result: `npm.cmd run test:e2e` initially caught a missing React key fallback for demo members; fixed with `id || user_id || email`.
- Next: Add smoke coverage for the new Demo member entry.

### Phase 1.8E - Smoke Coverage

- Completed: Added Playwright smoke coverage that opens the Demo Header member entry, verifies the 4-avatar +N overflow state, verifies the members dialog renders, verifies the metadata member count opens the same dialog, verifies Demo navigation does not call Supabase/Auth/REST/Realtime backend APIs, and locks formal member/share permission guards, labels, settlement notice, and disabled states with source-level tests.
- Changed files: `tests/phase-1-7f-smoke.spec.js`, `tests/phase-1-8-source-guards.spec.js`.
- Test result: `npm.cmd run test:e2e` passed with 8/8 tests.
- Next: Final validation and cleanup.

### Phase 1.8F - Final Validation

- Completed: Ran final validation after App/Header/CSS/test changes. Completion audit also tightened approved-member-only Header counts, expanded Demo members to cover +N overflow, and added trip boundary filters to pending approve/reject, role update, and member removal mutations.
- Changed files: `CURRENT_TASK.md`, `src/App.jsx`, `src/styles.css`, `tests/phase-1-7f-smoke.spec.js`, `tests/phase-1-8-source-guards.spec.js`.
- Test result: `npm.cmd run build` passed; `npm.cmd run test:e2e` passed with 8/8 tests; `git diff --check` passed.
- Next: Phase 1.8 is complete and pushed; proceed to merge/follow-up planning when requested.

### Phase 1.8 Manual Verification

- Status: Completed / Tested / User Verified.
- Owner: verified Members dialog, invite link, pending approval/rejection, editor/viewer role changes, editor/viewer removal, and independent Share management.
- Editor: verified Members dialog read-only management state, Share dialog access, active share link copy, and no create/enable/disable controls.
- Viewer: verified Members dialog access and no Share dialog access.
- Settlement phase: verified Members dialog read-only behavior, management lock, settlement notice, Header date lock, and independent Share permissions.
- Auth/invite regression: verified Google login and invite membership flow were not broken by Phase 1.8.
