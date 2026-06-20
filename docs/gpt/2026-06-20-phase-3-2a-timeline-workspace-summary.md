# App Layout Phase 3.2a - Timeline Workspace Summary

日期：2026-06-20  
分支：`codex/app-layout-phase-3-workspace`

## Git 基準

- 今天已推送的最新 commit：`ed862c5 stabilize day tabs edge fades`
- 較大型 Map-first 方案前的保留基準：`d181fb3`
- 本摘要建立時，`src/App.jsx` 與 `src/styles.css` 仍有尚未推送的版面調整。
- `test-results/` 是未追蹤測試產物，不應加入 commit。

## Day Tabs Edge Mask

- 左右邊緣提示由背景色 gradient overlay 改為真正的 `mask-image` / `-webkit-mask-image`。
- Edge button 保持在 mask 外層，不會跟著 tabs rail 淡出。
- 第一張只顯示右側淡出；最後一張只顯示左側淡出；中間位置顯示雙側淡出。
- 目前淡出停駐點：
  - 完全透明：左右端點 `0% / 100%`
  - 中段可見度：`6%`，位置 `18px`
  - 完全可見：`32px`
- Day Tabs 左右 padding 為 `12px`，edge icon 左右 padding 為 `6px`。

## Workspace 比例

- Map 展開時，Day Board / Map 比例調整為約 `30 / 70`。
- Day Board 最小寬度改為 `380px`，Map 最小寬度維持 `420px`。
- Workbench：

```css
--timeline-columns: minmax(380px, 30fr) minmax(420px, 70fr);
```

- Top Row 同步使用：

```css
--timeline-columns: minmax(380px, calc(30% + 6px)) minmax(420px, 1fr);
```

- `+6px` 保留作為 Day Tabs / Map 分界校準。

## Day Board 左右導覽

- Map 收合時的左右滑動按鈕改為貼齊兩側的半圓樣式。
- 按鈕尺寸目前為 `28px × 50px`，垂直位置為 `top: 46%`。
- 左右箭頭改用 Lucide `ChevronLeft / ChevronRight`。
- 左箭頭向左偏移 `4px`，右箭頭向右偏移 `4px`。
- 新增 scrollbar 寬度偵測：
  - 有垂直 scrollbar 時，右半圓貼在 scrollbar 內側，不遮住 scrollbar。
  - 無 scrollbar 時，右半圓直接貼齊 Workspace / 視窗邊緣。
  - Overlay scrollbar 至少預留 `12px`。
  - 使用 `ResizeObserver` 在 Day Board 尺寸改變時重新計算。
- 點擊 Day Tab 自動定位 Day Board 時，左側預留由 `10px` 增加為 `50px`。

## 景點卡展開內容

- 淡線以上的時間、標題、摘要、標籤與操作按鈕結構不變。
- 淡線以下的詳細資訊移至獨立 `.item-expanded-content`，使用 `grid-column: 1 / -1` 橫跨卡片完整寬度。
- 展開內容目前設定：
  - `padding: 0 28px`
  - `.item-details` margin-top：`8px`
  - 詳細文字：`14px / 500 / var(--muted)`
- 連動預算與備案關聯資訊一併使用較寬版面。

## 備案資訊

- `.alternative-relation-row`：
  - 背景：`#f4f4f4`
  - 圓角：`8px`
  - 字體：`14px / 500`
  - padding：`4px 12px`
  - margin-top：`6px`
- 未建立備案提示使用專用 `.alternative-empty-hint`：
  - `color: var(--muted)`
  - `font-size: 13px`
- 已建立備案後的標題文字不受空狀態樣式影響。

## 卡片樣式統一

- 移除 Map 收合狀態下 active Day 卡片的 compact 覆寫。
- Map 展開與收合現在共用相同的卡片 grid、padding、gap、字級與 meta spacing。
- 通用景點卡樣式目前為：
  - Card border：`1px solid var(--line)`
  - 標題：`16px / 500`
  - 摘要：`13px`
  - 時間：`14px / 500`
- Map 收合狀態的 `.timeline-column-header` 最小高度改為 `36px`。

## Timeline Actions 與 Icons

- 鎖定狀態由 emoji 改為 Lucide `Lock / LockOpen`。
- 編輯由 `E` 改為 Lucide `Pencil`。
- 刪除由 `X` 改為 Lucide `Trash2`。
- 套用範圍包含景點卡、交通卡與備案刪除；表單/通知的關閉 `X` 保持不變。
- `.mini-button` 改為 `28px × 28px`，新增 `line-height: 1`。
- Timeline action icon 為 `14px`，stroke width 為 `1.5`。
- Sidebar toggle 與 Map toggle icon stroke width 統一為 `1.8`。

## 新增行程按鈕

- 原本純 `+` / `+ 行程` 改為 Lucide `Plus + MapPin` 組合。
- 按鈕尺寸為 `56px × 32px`。
- Icons 為 `15px`，stroke width 為 `1.8`，間距為 `4px`。
- 保留「新增行程」title 與 aria-label。

## 其他字體調整

- 交通卡標題與交通編輯標題：`14px / 500`。
- Brand 說明與 eyebrow：`13px`。
- Panel H3：`18px / 500`。

## Formal / Demo Parity

- Day Tabs、Day Board navigation、Timeline cards 與新增行程按鈕皆由共用元件與共用 CSS 提供。
- 本日調整應同步套用正式頁與 `/demo/timeline`。

## 驗證狀態

- Commit `ed862c5` 推送前已通過：
  - `npm.cmd run build`
  - `npm.cmd run test:e2e`：12/12
  - `git diff --check`
- `ed862c5` 之後的版面與 icon 微調依使用者要求未執行自動測試，改由手動驗證。

## 手動驗證清單

1. Map 展開時確認 Day Board / Map 約為 30 / 70，Top Row 分界與 Map 左緣對齊。
2. Map 收合後確認卡片字級、padding 與 Map 展開時一致。
3. 有垂直 scrollbar 時確認右半圓不遮住 scrollbar；無 scrollbar 時確認貼齊右緣。
4. 點擊不同 Day Tabs，確認 active Day Board 左側約保留 50px。
5. 展開景點卡，確認淡線以下資訊撐滿且左右保留 28px padding；收合卡片版面不變。
6. 驗證 Lock、LockOpen、Pencil、Trash2、Plus + MapPin 的 hover、disabled、tooltip 與點擊功能。
7. 驗證有備案與無備案兩種狀態，確認空狀態提示不影響已建立備案標題。
8. 正式頁與 `/demo/timeline` 各驗證一次。
