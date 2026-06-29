# App Layout / Header 改版完成交接摘要｜進入 Sidebar Phase 2

> 交接用途：給新聊天室接續 **App Layout Phase 2｜Sidebar 改版** 使用。
> 本文件接續 `PHASE_1_8_CHAT_HANDOFF.md`，更新目前 Header Phase 1.7～1.8 已完成狀態。
> 目前專案方向：Header 已完成，下一步進入 Sidebar UI / Layout 改版。

---

## 1. 目前總狀態

Header 改版 Phase 1 已可標記為完成：

```text
App Layout Header Phase 1
✅ Phase 1.7 Completed / user verified
✅ Phase 1.8 Completed / user verified
✅ Header UI final polish mostly completed
✅ build passed
✅ e2e passed
✅ git diff --check passed
```

Phase 1.7 與 Phase 1.8 都已通過功能驗證。接下來可以進入：

```text
App Layout Phase 2｜Sidebar 改版
```

---

## 2. 目前分支狀態

Phase 1.8 工作分支：

```text
codex/app-layout-header-phase-1-8
```

如果尚未 commit / push，建議先完成：

```powershell
git status --short
npm.cmd run build
npm.cmd run test:e2e
git diff --check

git add CURRENT_TASK.md src/App.jsx src/styles.css tests/phase-1-7f-smoke.spec.js tests/phase-1-8-source-guards.spec.js
git commit -m "Complete app layout header phase 1"
git push origin codex/app-layout-header-phase-1-8
```

若已 commit / push / merge，請依實際狀態從最新 `main` 或 Phase 1.8 分支開 Sidebar 新分支。

建議 Sidebar 分支名稱：

```text
codex/app-layout-sidebar-phase-2
```

建議開分支方式：

```powershell
# 若 Phase 1.8 已 merge main
git checkout main
git pull
git checkout -b codex/app-layout-sidebar-phase-2

# 若 Phase 1.8 尚未 merge main，且 Sidebar 要接在 Header 完成版上
git checkout codex/app-layout-header-phase-1-8
git pull
git checkout -b codex/app-layout-sidebar-phase-2
```

---

## 3. Phase 1.7 完成摘要｜日期變更與資料一致性

Phase 1.7 已完成旅程日期變更資料流與安全防護。

核心完成內容：

- Header Date Popover 與 Developer Date Tool 都統一走 `updateTripDateRange(...)`。
- 禁止直接使用 `updateTrip({ start_date, end_date })` 修改日期。
- 日期變更時同步維持：
  - `trips.start_date`
  - `trips.end_date`
  - `itinerary_items.date = new_start_date + day_index`
- 縮短旅程時可偵測被排除 Day 是否有 Timeline 資料。
- 危險縮短需確認後才移除超出天數的 Timeline items。
- Accommodation / Todo 不自動平移、不自動刪除，只提示使用者。
- Share / Export 日期資料一致性已修正。
- 結算階段 date lock 已完成。
- Developer Date Tool 可覆寫 settlement date lock，但不可繞過 Owner 權限、active editor guard、危險縮短確認與 RPC transaction。

已套用正式 Supabase migrations：

```text
016_apply_trip_date_change.sql
017_confirm_trip_date_shortening.sql
018_filter_share_snapshot_timeline.sql
```

重要原則：

```text
016 / 017 / 018 已套用正式 Supabase，後續不可修改原 migration。
若需要 DB function / schema 調整，必須新增 019+ migration。
```

---

## 4. Phase 1.8 完成摘要｜成員預覽與成員邀請管理

Phase 1.8 已完成 Header 成員入口改版。

### 4.1 Header 成員 Preview

完成內容：

- Header 右側新增成員 preview 長形入口。
- 原本獨立「邀請朋友」icon 改為成員 preview 入口的一部分。
- 成員 preview 顯示 approved members initials。
- 最多顯示 4 位成員，超過顯示 `+N`。
- Owner 有 pending member 時顯示 owner-only `待審 N`。
- 旅程資訊列的 `N 位成員` 保留，且可點擊開啟同一個 dialog。
- Tooltip / title / aria-label 統一使用：

```text
成員與邀請
```

### 4.2 MembersInviteDialog

原本 invite-only dialog 已升級為：

```text
MembersInviteDialog / 成員與邀請
```

Dialog 內容包含：

- 目前成員
- 待審核
- 邀請朋友
- 你的權限說明

角色顯示統一為中文：

| DB role | UI 顯示 |
|---|---|
| owner | 擁有者 |
| editor | 編輯者 |
| viewer | 檢視者 |

### 4.3 Owner 權限

Owner 可：

- 建立 invite link。
- 核准 pending member。
- 拒絕 pending member。
- 修改 editor / viewer 角色。
- 移除 editor / viewer。
- 管理 share link。

限制：

- 不可修改自己 owner 身份。
- 不做 owner 轉移。
- 不可移除自己。
- 移除成員前需要確認。

### 4.4 Editor 權限

Editor 可：

- 開啟 `成員與邀請` dialog。
- 查看成員列表與權限說明。
- 開啟 Share Dialog。
- 查看並複製 Owner 已建立且 active 的 share link。

Editor 不可：

- 邀請成員。
- 核准 / 拒絕 pending。
- 修改角色。
- 移除成員。
- 建立 / 啟用 / 停用 share link。

### 4.5 Viewer 權限

Viewer 可：

- 開啟 `成員與邀請` dialog。
- 查看成員列表與權限說明。

Viewer 不可：

- 邀請成員。
- 管理成員。
- 開啟 Share Dialog。
- 管理 share link。

### 4.6 Share 權限回歸修正

Phase 1.8 測試時曾發現：

```text
Editor 開啟 Share Dialog 後，看不到 Owner 已建立的 active share link。
```

原因：

```text
canOpenShareDialog 已允許 Owner / Editor，
但 loadShareLinks effect 仍只在 isOwner 時執行。
```

修正：

```text
loadShareLinks(activeTripId) 改為在 canOpenShareDialog 為 true 時載入。
canManageShareLinks = isOwner 保持獨立。
```

修正後規則：

| 行為 | Owner | Editor | Viewer |
|---|---:|---:|---:|
| 開 Share Dialog | ✅ | ✅ | ❌ |
| 載入 shareLinks | ✅ | ✅ | ❌ |
| 看見 active share link | ✅ | ✅ | ❌ |
| 複製 active share link | ✅ | ✅ | ❌ |
| 建立 share link | ✅ | ❌ | ❌ |
| 啟用 / 停用 share link | ✅ | ❌ | ❌ |

Share View route / RPC / migration / RLS / `updateTripDateRange()` 未修改。

---

## 5. Phase 1 UI 最後調整摘要

Header Phase 1.8 完成後，使用者進一步調整了成員 preview 與 MembersInviteDialog UI。

### 5.1 Header 成員 preview 視覺

已討論 / 調整方向：

- 成員 preview 長形框整體可點擊。
- 左側 initials 不再額外包框。
- 右側成員與邀請 icon 放在長形框內。
- 成員與邀請 icon 右側 / 左側間距調整。
- 在成員 initials 與 icon 中間加入淡分隔線。
- Header icon button 高度調整時需同時注意 `height` 與 `min-height`。

### 5.2 MembersInviteDialog 成員操作 UI

目前使用者希望：

- 成員操作 UI 不要像後台管理。
- editor / viewer 的角色操作外觀要與 `擁有者` pill 一致。
- 差別是 editor / viewer 的 pill 可下拉。
- 移除成員不要再用獨立垃圾桶 icon button。
- 移除成員整合進角色操作 menu。

建議設計：

```text
Peter Chiu                       [ 擁有者 ]
TNT Chiu                         [ 檢視者 ▾ ]
```

自訂 role menu 建議內容：

```text
編輯者
檢視者 ✓
────────
移除成員
```

注意：

- 原生 `<select>` 可以做但樣式受限。
- 若要更好看，建議用自訂 dropdown / popover menu。
- 自訂 menu 需要處理開關、點外關閉、Esc 關閉。
- Owner 自己、owner 成員、Editor、Viewer、結算階段仍顯示靜態 role pill。

---

## 6. Demo / Tests 狀態

Phase 1.8 已新增 / 更新測試：

- Demo Header 成員 preview 可開 mock dialog。
- Demo `N 位成員` 入口可開同一 mock dialog。
- Demo 不寫 Supabase。
- Demo 不接 Auth / Realtime / draft autosave / edit lock。
- Playwright smoke 已擴充。
- 新增 source guard tests：

```text
tests/phase-1-8-source-guards.spec.js
```

最後驗證結果：

```text
npm.cmd run build      passed
npm.cmd run test:e2e   passed
8/8 tests passed
git diff --check       passed
```

仍有既有 Vite chunk size warning，非本次新增錯誤。

---

## 7. 已修改檔案

Phase 1.8 / Header UI 主要涉及：

```text
CURRENT_TASK.md
src/App.jsx
src/styles.css
tests/phase-1-7f-smoke.spec.js
tests/phase-1-8-source-guards.spec.js
```

另有交接 / work log：

```text
PHASE_1_8_WORK_LOG.md
```

---

## 8. 進入 Sidebar Phase 2 的建議

下一階段建議命名：

```text
App Layout Phase 2｜Sidebar 改版
```

建議先做：

```text
Phase 2A｜Sidebar Audit
```

第一步不要直接改檔案，先 Audit：

1. Sidebar 目前區塊與元件結構。
2. Trip list / active trip 顯示邏輯。
3. Section nav active 狀態來源。
4. Members 區塊與 Header 成員 preview 是否重複。
5. Mobile / Desktop Sidebar 行為。
6. 哪些地方可做 UI polish。
7. 哪些地方可能影響 activeTrip / activeSection / draft guard / session restore。
8. 建議 Phase 2 拆分子階段。

---

## 9. Sidebar Phase 2 初步方向

Sidebar 改版可拆成以下子階段：

| Phase | 內容 | 建議 |
|---|---|---|
| 2A | Audit 現有 Sidebar | 不改檔案 |
| 2B | Sidebar 資訊架構整理 | 決定品牌、新增旅程、導航、旅程列表、成員區順序 |
| 2C | Trip List 改版 | active trip 卡片、日期、狀態、長名稱截斷 |
| 2D | Nav Item 視覺統一 | icon/label 對齊、active/hover 狀態 |
| 2E | Sidebar Members 區塊決策 | 建議簡化保留，不與 Header 重複 |
| 2F | Mobile / Collapsed Sidebar | 小螢幕與 icon-only 狀態 |

---

## 10. Sidebar Members 初步決策建議

因 Header 已有成員 preview，Sidebar 底部 Members 區塊可能與 Header 重複。

可選方案：

| 方案 | 說明 |
|---|---|
| A 保留 | Sidebar Members 當輔助狀態 |
| B 簡化 | 只顯示 initials + count，點擊開成員與邀請 |
| C 移除 | 成員管理集中到 Header |

目前建議：

```text
B：簡化保留
```

理由：

- 完全移除會讓 Sidebar 底部突然空掉。
- 完整 Members 區塊會與 Header 重複。
- 簡化後可作為協作狀態提示，不搶 Header 主入口。

---

## 11. Sidebar Phase 2 保護範圍

除非使用者明確要求，Sidebar Phase 2 不要修改：

- Supabase schema / migrations / RLS / RPC。
- Auth / Google OAuth flow。
- Demo route before auth checks。
- Share route / Share Dialog core。
- Invite flow / `request_trip_membership`。
- `updateTripDateRange()`。
- Draft Autosave。
- Edit Lock。
- Realtime subscription flow。
- Storage / attachments。
- Active editor guard。
- Session restore / active trip restore。
- Trip CRUD 資料流。
- Header Phase 1.7 / 1.8 權限規則。

Sidebar Phase 2 應以：

```text
UI / CSS / JSX 結構整理
```

為主，不應重寫資料流。

---

## 12. 建議給 Codex 的 Sidebar Phase 2A Goal

可直接貼給 Codex：

```text
/goal App Layout Phase 2A｜Sidebar 改版 Audit

目標：
請先 Audit 現有 Sidebar 結構，不修改檔案。

請閱讀：
- CURRENT_TASK.md
- AGENT.md
- UX_RULES.md
- BUGS.md
- PHASE_1_8_WORK_LOG.md
- src/App.jsx
- src/styles.css

請整理：
1. Sidebar 目前有哪些區塊與元件。
2. Trip list / active trip 顯示邏輯。
3. Section nav active 狀態來源。
4. 新增旅程入口目前如何運作。
5. Sidebar Members 區塊與 Header 成員 preview 是否重複。
6. Mobile / desktop Sidebar 行為。
7. 哪些 UI 可以 polish。
8. 哪些地方可能影響 activeTrip / activeSection / draft guard / session restore。
9. Sidebar Phase 2 建議拆成哪些子階段。
10. 每個子階段的修改範圍、風險與驗收方式。

限制：
- 不修改檔案。
- 不改資料流。
- 不改 Auth / Share / Invite / Date / Draft / Edit Lock / Realtime。
- 不改 DB / RLS / RPC / migration。

完成 Audit 報告後停止，等待使用者確認。
```

---

## 13. 回歸測試提醒

Sidebar Phase 2 每次修改後至少執行：

```powershell
npm.cmd run build
npm.cmd run test:e2e
git diff --check
```

手動檢查重點：

- 登入後正式頁可載入。
- Active trip 不會跳掉。
- 切換 trip 時 active editor / dirty draft guard 仍有效。
- Reload 後仍恢復正確 activeTrip / activeSection。
- Sidebar nav active 狀態正確。
- Demo `/demo/timeline`、`/demo/budget`、`/demo/luggage` 不需登入且不 crash。
- Share route `?share=...` 不需登入，不導回登入頁。
- Header 成員與邀請、Share 權限不受 Sidebar 修改影響。

---

## 14. 最後提醒

本專案是：

```text
Vite + React SPA
```

不是 Next.js。

主要修改檔案通常是：

```text
src/App.jsx
src/styles.css
```

修改 UI 時請保持：

- 小步修改。
- 優先 `apply_patch`。
- 避免 whole-file rewrite。
- 避免用中文 UI 字串當唯一 patch 錨點。
- 保護 Auth / Demo / Share / Invite / Draft / Edit Lock / Realtime。
- Demo 與正式 UI 盡量保持一致，但 Demo 不接正式資料流。
