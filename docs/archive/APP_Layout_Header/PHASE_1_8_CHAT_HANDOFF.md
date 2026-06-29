# App Layout / Header 改版交接摘要｜進入 Phase 1.8 成員列表與管理入口

> 交接用途：給新聊天室接續 **Header 改版最後部分 Phase 1.8｜成員列表與管理入口** 使用。
> 目前專案分支：`codex/trip-date-data-flow`
> 目前狀態：Phase 1.7 已收尾並 push；準備評估是否合併 main，下一步進 Phase 1.8。

---

## 1. 本聊天室主要完成內容總覽

本聊天室主要完成 **App Layout / Header 改版 Phase 1.7：旅程日期變更與資料一致性**，從日期變更 audit、正式 Supabase RPC、縮短旅程資料清理、分享 / 匯出 / Draft / 結算階段權限，到 Playwright smoke test 環境整理。

Phase 1.7 已拆成以下階段並完成：

| Phase | 名稱 | 狀態 |
|---|---|---|
| 1.7A | 日期與各模組資料關聯 Audit | ✅ Completed |
| 1.7B | 日期變更分類、Timeline 預檢與警示 UI | ✅ User Verified |
| 1.7C | 安全日期變更執行 | ✅ User Verified |
| 1.7D | 縮短旅程確認與 Timeline 資料清理 | ✅ User Verified |
| 1.7E | Share / Export / Draft / Settlement 收尾 | ✅ User Verified |
| 1.7F | 完整回歸測試與文件更新、Playwright smoke tests | ✅ Completed / pushed |

目前 Phase 1.7 可標記為：

```text
Phase 1.7｜旅程日期變更與資料一致性
✅ Completed / pushed to codex/trip-date-data-flow
```

---

## 2. 目前分支與工作流狀態

### 目前分支

```text
codex/trip-date-data-flow
```

使用者回報：

```text
Phase 1.7 已收尾並 push 到 codex/trip-date-data-flow
```

### 是否合併 main

尚未確認已合併 main。先前建議流程：

```powershell
git branch --show-current
git status --short

git checkout main
git pull

git checkout codex/trip-date-data-flow
git merge main

npm.cmd install
npm.cmd run build
npm.cmd run test:e2e
git diff --check
```

全部通過後再：

```powershell
git checkout main
git merge codex/trip-date-data-flow
npm.cmd run build
npm.cmd run test:e2e
git push origin main
```

或採 GitHub PR / Vercel Preview 後再 merge。

---

## 3. 已套用正式 Supabase migrations

Phase 1.7 中已套用正式 Supabase：

```text
016_apply_trip_date_change.sql
017_confirm_trip_date_shortening.sql
018_filter_share_snapshot_timeline.sql
```

### Migration 原則

- **016 / 017 / 018 已套用正式 Supabase，後續不可再修改這三個 migration。**
- 若 Phase 1.8 或後續要改 DB function / schema，必須新增 `019+`。
- 不要使用 `db push` 直接推正式 Supabase。
- 正式 Supabase migration 仍維持使用 SQL Editor 手動貼上、Audit 後執行的流程。

---

## 4. Phase 1.7 的核心資料規則

### 4.1 日期變更集中入口

所有正式旅程日期變更必須走：

```js
updateTripDateRange(...)
```

不得直接呼叫：

```js
updateTrip({ start_date, end_date })
```

也不得直接更新：

```text
trips.start_date / trips.end_date
```

Phase 1.7C 已讓 Header Date Popover 與 Developer Date Tool 都走同一入口。

### 4.2 目前仍使用 `day_index + date`

目前未建立 `trip_days` table。

現行規則：

```text
item.date = trip.start_date + item.day_index
```

未來仍規劃可能導入：

```text
trip_days
- id
- trip_id
- position
- date
```

因此目前所有日期 / Day 判斷盡量集中在 helper，不要再散落寫死 `day_index` 邏輯。

已使用或應維持集中化的 helper 概念：

```js
getTimelineDayPosition(...)
getTimelineDayDate(...)
getAffectedTimelineDays(...)
buildTripDateChangePreview(...)
classifyTripDateChange(...)
```

---

## 5. Phase 1.7A Audit 結論

原本系統是混合模型：

| 層級 | 模型 |
|---|---|
| 旅程日期 | `trips.start_date / trips.end_date` |
| Timeline Day | 前端 `tripDays(activeTrip)` 動態產生 |
| 行程卡綁定 | `itinerary_items.day_index` |
| 行程實際日期 | `itinerary_items.date` |
| activeDay | 0-based index |

最大風險：

```text
只改 trips.start_date / trips.end_date 時，itinerary_items.date 不會同步，
導致正式 Timeline、Share View、Export JSON 日期不一致。
```

---

## 6. Phase 1.7B｜日期變更分類與 Preview

已新增 / 完成：

- 日期變更 preview
- Header Date Popover 顯示預檢
- Demo 同步 local-state preview
- 分類：

```text
unchanged
same-or-extended
shortened-empty-tail
shortened-with-timeline
invalid
```

### 規則

- 現有 Timeline Day 順序保留。
- 原 Day 1 對齊新的旅程開始日。
- 同天數平移：所有 item.date 同步平移。
- 延長：既有 Day 保留，新尾端 Day 空白。
- 縮短：只檢查被排除尾端 Day 是否有 Timeline 資料。
- Accommodation / Todo 不自動平移、不自動刪除，只提醒確認。
- Budget item 本體不刪。

---

## 7. Phase 1.7C｜安全日期變更執行

### 新增 RPC

正式頁透過 Supabase RPC：

```text
public.apply_trip_date_change(uuid, date, date)
```

後續在 017 改為 4 參數版本。

### 執行內容

- 更新 `trips.start_date`
- 更新 `trips.end_date`
- 同步更新：

```text
itinerary_items.date = new_start_date + day_index
```

### 保持不變

- `day_index`
- item id
- transport pair
- alternatives
- budget links
- Accommodation / Todo / Budget

### 權限

日期修改採 **Owner-only**。

內部 private function 使用：

```sql
app_private.can_manage_trip(...)
```

public wrapper 是 frontend 唯一入口。

---

## 8. Phase 1.7D｜縮短旅程確認與 Timeline 資料清理

新增 migration：

```text
017_confirm_trip_date_shortening.sql
```

RPC 改為 4 參數：

```text
public.apply_trip_date_change(uuid, date, date, boolean)
```

第 4 個參數：

```text
confirm_timeline_removal
```

### 行為

- `confirm_timeline_removal = false`
  - 若縮短會移除有 Timeline 資料的 Day，回傳 / 丟出 `unsafe_shortening`
- `confirm_timeline_removal = true`
  - transaction 刪除超出新天數的 Timeline item

### 刪除範圍

- `day_index >= new_day_count` 的 itinerary items
- 引用被刪 item 的關聯 transport cards
- alternatives cascade 或關聯清理
- itinerary-budget links 清理

### 不刪除

- Budget item 本體
- Accommodation
- Todo
- Actual
- Luggage
- Guide

### Edit lock

若受影響 item 被其他人有效 edit lock，RPC 會阻擋，避免刪除他人正在編輯的內容。

### 重要 hardening

017 已修正為不使用 temp table，改用 local variable / CTE / `removed_item_ids uuid[]`，避免 `security definer` temp table 風險。

---

## 9. Phase 1.7E｜Share / Export / Draft / Settlement 收尾

### 9.1 Share View 日期一致性

新增 migration：

```text
018_filter_share_snapshot_timeline.sql
```

更新 Share snapshot RPC：

```text
app_private.get_share_snapshot(text)
public.get_share_snapshot(text)
```

### Share View 規則

- 分享頁不是快照，而是永遠讀目前旅程最新公開資料。
- Share RPC 只回傳 `day_index` 在旅程天數範圍內的 itinerary。
- Share View 日期使用：

```text
trip.start_date + day_index
```

不依賴舊 `item.date`。

### Share View 不公開

- Budget
- Actual Expense
- Settlement
- Luggage
- 私人成員資料
- 私人附件

---

## 10. Share Link 單筆規則

Phase 1.7E 已定案：

```text
同一旅程只保留 / 顯示單筆分享連結。
```

### 舊資料處理

若資料庫已有多筆 share_links：

- 不刪除舊資料
- UI 只選一筆顯示
- active 優先
- 若多個 active，選最新
- 若都停用，選最新

### Owner 行為

Owner 可：

- 開啟 Share Dialog
- 建立分享連結
- 複製分享連結
- 啟用 / 停用分享連結

### Editor 行為

後續 patch 已完成：

- Editor 可開啟分享視窗
- Editor 可複製既有啟用中的分享連結
- Editor 不可建立 / 啟用 / 停用分享連結

### Viewer 行為

- Viewer 不可開啟 Share Dialog
- 但任何人拿到 share link 都可瀏覽公開唯讀頁

---

## 11. Export JSON 規則

目前已有匯出 JSON，沒有匯入功能。

Phase 1.7E 已定案：

```text
不做 JSON import。
Export JSON 只做日期與資料一致性修正。
```

Export JSON 應：

- 匯出最新 `trip.start_date / end_date`
- itinerary item date 與 `trip.start_date + day_index` 一致
- 不匯出 out-of-range Timeline item
- 不匯出已刪 Timeline item
- 不暗示支援匯入

JSON import 以後另開：

```text
Data Portability Phase｜資料匯出 / 匯入 / 備份還原
```

優先考慮「匯入成新旅程」，覆蓋既有旅程為高風險。

---

## 12. Draft / Active Editor Guard 規則

### 12.1 同一旅程只允許一個 active editor

目前規則：

```text
同一旅程同一時間只允許一個 active editor / active draft。
```

開啟第二個編輯器前，必須先處理目前未儲存內容：

- 儲存
- 放棄

localStorage 內可能有多筆歷史 draft，但 UI 不應同時恢復多個 active draft。

### 12.2 日期變更前 guard

定案：

```text
有任何 active editor / dirty draft 時，不允許直接修改旅程日期。
```

適用：

- Header Date Popover
- Developer Date Tool
- 未來任何日期變更入口

### 12.3 縮短刪除後清 draft

定案：

```text
確認縮短旅程並成功刪除 Day 後，被刪 Timeline item 的 local draft 一併刪除。
```

注意：

- 只有 RPC 成功後才清 draft
- RPC 失敗不可清 draft
- 主要清除 `timeline:{itemId}` draft
- `timeline:new` 若缺少 day info，暫時不盲目清除

---

## 13. 結算階段 Settlement / Date Lock 規則

### 13.1 UI 階段來源

Header 左上顯示「結算階段」不是看 `activeTrip.status`，而是：

```js
deriveTripStage(start_date, end_date)
```

目前 derive 規則：

```text
today < start_date → planning
today 在旅程日期內 → traveling
today > end_date → settled / 結算階段
```

因此不能只用：

```js
activeTrip?.status === "settled"
```

### 13.2 鎖定條件

目前採用：

```js
isTripFinalizedStatus = activeTrip?.status === "settled"
isTripInSettlementPhase = deriveTripStage(...) === "settled"
isTripDateLocked = isTripFinalizedStatus || isTripInSettlementPhase
```

### 13.3 結算階段禁止

當 `isTripDateLocked` 為 true：

- Header Date Popover 不可修改日期
- 不可邀請朋友
- 不可核准 / 拒絕 pending member
- 不可修改成員權限
- 一般內容編輯入口也應被鎖住

提示文案：

```text
旅程已進入結算階段，無法修改日期。
```

### 13.4 結算階段允許

- Owner 可分享
- Editor 可複製已啟用分享連結
- 任何拿到 link 的人可看唯讀分享頁

---

## 14. Developer Date Tool Override

### 14.1 為什麼需要 override

測試時會用 Developer Date Tool 把旅程日期調到過去，讓 UI 進入結算階段。若 Developer Tool 也被鎖死，就無法再調回未來測試。

因此定案：

```text
Header Date Popover：結算階段不可改日期
Developer Date Tool：可覆寫 settlement date lock，但僅供測試
```

### 14.2 實作規則

Developer Tool 仍走：

```js
updateTripDateRange(...)
```

但傳入：

```js
{
  allowSettlementOverride: true,
  source: "developer-date-tool"
}
```

### 14.3 Developer Tool 可繞過

- `isTripDateLocked / settlement phase date lock`

### 14.4 Developer Tool 不可繞過

- Owner 權限
- Active editor / dirty draft guard
- 危險縮短確認
- RPC transaction
- 1.7C / 1.7D 日期同步與資料清理

### 14.5 產品注意

這等於測試工具後門，因此正式產品未來應考慮：

- Developer Date Tool 僅開發 / 測試環境顯示
- 或只允許指定 developer user

正式使用者未來若要改已結算旅程，應做：

```text
重新開啟旅程
```

而不是從 Header 直接改結算日期。

---

## 15. Playwright / Phase 1.7F 測試環境

Phase 1.7F 已新增 Playwright smoke/e2e 測試環境。

### 已安裝

```text
@playwright/test
Chromium browser
```

版本確認：

```text
npx.cmd playwright --version = 1.60.0
```

### 新增檔案

```text
playwright.config.js
tests/phase-1-7f-smoke.spec.js
```

### package.json script

新增：

```json
"test:e2e": "playwright test"
```

### 執行方式

```powershell
npm.cmd run build
npm.cmd run test:e2e
```

或：

```powershell
npx.cmd playwright test
```

### Smoke tests 覆蓋

- App shell 可載入，不 crash
- `/demo/timeline` 不需登入且可顯示 Demo timeline
- Demo 可切換 Budget / Luggage
- `/?share=...` 分享 route 不需登入，不導回登入頁

### 測試結果

Codex 回報：

```text
4 passed (3.7s)
```

---

## 16. Phase 1.7F 中修正的小 bug

Playwright 測試抓到 `/demo/timeline` crash。

### Root cause

`TripHeader` props destructuring 原本類似：

```js
canChangeTripDates = canEditTrip,
canEditTrip = false,
```

這會造成 JavaScript temporal dead zone：`canChangeTripDates` default value 先讀取 `canEditTrip`，但 `canEditTrip` 在後面才初始化。

正式頁通常有傳 `canChangeTripDates`，所以不一定爆；Demo route 沒傳就 crash。

### 修法

調整順序：

```js
canEditTrip = false,
canChangeTripDates = canEditTrip,
```

語意不變，只修正 default 初始化順序。

---

## 17. npm audit / Vite-esbuild backlog

安裝 Playwright 後 `npm audit` 顯示：

```text
vite / esbuild vulnerability
```

已記錄在 `BUGS.md`，正確編號應為：

```text
BUG-024 | npm audit reports vite/esbuild vulnerability
```

重要：

- 不要跑 `npm audit fix --force`
- 因為會升級到 Vite 8，可能是 breaking change
- 目前決策：暫不升級，之後獨立開分支處理

後續任務：

```text
Dependency Maintenance｜Vite / esbuild security upgrade
```

使用者已決定：

```text
目前不升級，之後再考慮。
```

---

## 18. Phase 1.8 方向：成員列表與管理入口

使用者接下來要做：

```text
Header 改版最後部分 Phase 1.8｜成員列表與管理入口
```

### Phase 1.8 應接續的產品規則

成員 / 分享 / 結算階段權限要延續 Phase 1.7E 的定案：

| 功能 | Owner | Editor | Viewer | 結算階段 |
|---|---:|---:|---:|---:|
| 邀請新成員 | ✅ | 視現有規則，建議不開 | ❌ | ❌ |
| 核准 / 拒絕 pending member | ✅ | ❌ | ❌ | ❌ |
| 修改成員權限 | ✅ | ❌ | ❌ | ❌ |
| 開啟 Share Dialog | ✅ | ✅ | ❌ | Owner / Editor 仍可依權限 |
| 建立 / 啟用 / 停用分享 | ✅ | ❌ | ❌ | Owner 仍可 |
| 複製已啟用分享連結 | ✅ | ✅ | ❌ | Owner / Editor 仍可 |
| 修改旅程日期 | ✅ Owner only | ❌ | ❌ | ❌，Developer Tool 除外 |

### Phase 1.8 可能要處理

- Header 中顯示旅程成員列表 / avatar / role
- 成員管理入口位置
- pending member 管理入口
- 邀請朋友按鈕狀態
- 結算階段 invite / approval disabled UI
- Owner / Editor / Viewer 權限提示
- Share Dialog 入口與 Member 管理入口分離
- 避免「分享」與「邀請協作」權限混在一起

### Phase 1.8 暫時不要做

- 不要改 Share View UI 大版型
- 不要決定 Guide 是否公開
- 不要決定 Budget analysis 是否公開
- 不要做地圖 / 路線整合
- 不要做 JSON import
- 不要新增 `trip_days`

---

## 19. Share View UI / 分享視窗 UI 後續 backlog

使用者已說明：

- 唯讀檢視頁面 UI 還想改，但不急。
- 建立分享唯讀的視窗也想改，但可留後面。
- 唯讀頁 Guide 不一定要出現。
- Budget analysis 是否出現在分享頁還在思考。
- 行程顯示方式未來會搭配地圖，需要 Phase 5 調整。

建議後續獨立：

```text
Share UX Phase｜唯讀分享頁與分享視窗 UI 重設計
```

不要混入 Phase 1.8，除非使用者明確要求。

---

## 20. 建議新聊天室第一步

在新聊天室開始 Phase 1.8 前，建議先做：

1. 確認 Phase 1.7 分支是否已合併 main。
2. 若尚未合併，先按合併前檢查流程處理。
3. 讀取最新：
   - `CURRENT_TASK.md`
   - `UX_RULES.md`
   - `AGENT.md`
   - `BUGS.md`
   - `src/App.jsx`
4. Audit 現有 Header / Member / Share 相關程式碼。
5. 先產 Phase 1.8 設計範圍，不要直接動手大改。

建議給 Codex 的 Phase 1.8 起始任務可以是：

```text
請先 Audit Header 目前的成員、邀請、分享、權限與結算階段相關 UI / state flow。
不要修改檔案。
請整理：
1. Header 中目前有哪些 member/share/invite 入口
2. Owner / Editor / Viewer 目前權限如何判斷
3. pending member 目前在哪裡管理
4. 結算階段哪些入口 disabled
5. Phase 1.8 成員列表與管理入口建議拆分哪些子階段
6. 可能會影響 Phase 1.7 date/share guard 的風險
```

---

## 21. 目前重要注意事項

- `Developer Date Tool` 是測試工具，正式產品不要把它當一般流程。
- 日期變更必須走 `updateTripDateRange()`。
- Share link 管理與 member invite 是不同權限概念，不要再用同一個 disabled guard。
- 結算階段：不可邀請、不可改日期，但仍可分享。
- Editor：可複製既有啟用分享連結，但不可管理 share link。
- 016 / 017 / 018 已套用正式 Supabase，不可修改。
- npm audit / Vite 升級暫不處理。
- Playwright smoke tests 已可作為後續基本回歸測試。
