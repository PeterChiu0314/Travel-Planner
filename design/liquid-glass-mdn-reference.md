# 旅程工房｜液態玻璃與 MDN 實作參考

## 文件資訊

- 專案：Travel Studio
- 主題：深墨綠色＋液態玻璃
- 文件用途：記錄目前預覽採用的液態玻璃參數，以及後續 CSS 實作可查閱的 MDN 來源
- 建立日期：2026 年 7 月 14 日
- 相關設計檔：[website-design-spec.md](./website-design-spec.md)、[travel-studio-design-system-深墨綠.json](./travel-studio-design-system-深墨綠.json)

> 本文件定義 CSS 的實作依據；品牌氣氛、視覺比例、元件使用時機與內容規範仍以網站設計規範為準。

## 1. 目前採用的液態玻璃參數

目前預覽中的搜尋列、地圖工具按鈕與地圖狀態標籤，採用以下設定：

| 參數 | 值 | 用途 |
|---|---|---|
| 液態玻璃背景 | `rgba(255, 255, 255, .08)` | 支援 `backdrop-filter` 時的半透明表面 |
| 模糊 | `blur(10px)` | 讓底圖透過玻璃產生柔和的景深 |
| 飽和度 | `saturate(140%)` | 保留地圖色彩，同時增加玻璃後方的色彩層次 |
| 邊框 | `rgba(255, 255, 255, .25)` | 定義玻璃邊界與背景分離 |
| 舊版背景 fallback | `rgba(20, 55, 46, .92)` | 不支援背景模糊時維持深墨綠與文字對比 |
| 搜尋列圓角 | `16px` | 主要浮動搜尋元件 |
| 工具按鈕圓角 | `14px` | 地圖右上角浮動工具 |
| 狀態標籤圓角 | `12px` | 地圖底部輔助資訊 |
| 基礎字級 | `14px` | 預覽與網站設計系統的主要內文 |
| 一般轉場 | `160ms ease` | Hover、Focus 與輕微浮起效果 |

目前深墨綠主題的核心 Token：

```css
:root {
  --brand-color: #325248;
  --brand-color-hover: #245341;
  --brand-foreground: #ffffff;
  --accent-color: #e47b25;
  --text-color: #2d312f;
  --text-muted: #66716b;
  --font-base: 14px;
  --radius-glass: 16px;

  --glass-bg: rgba(255, 255, 255, .08);
  --glass-bg-fallback: rgba(20, 55, 46, .92);
  --glass-border: rgba(255, 255, 255, .25);
  --glass-blur: 10px;
  --glass-saturation: 140%;
  --glass-transition: 160ms ease;
}
```

## 2. 舊版瀏覽器 fallback 與液態玻璃增強

先提供可讀、可用的深墨綠背景，再透過 `@supports` 在瀏覽器支援時加上半透明與模糊效果。這個順序可避免不支援 `backdrop-filter` 的瀏覽器顯示成低對比白底或完全透明。

```css
.glass-search {
  min-height: 54px;
  padding: 9px 11px 9px 15px;
  border: 1px solid rgba(255, 255, 255, .25);
  border-radius: 16px;
  background: rgba(20, 55, 46, .92);
  box-shadow: 0 18px 38px rgba(20, 55, 46, .24);
  color: #ffffff;
  transition:
    border-color var(--glass-transition),
    box-shadow var(--glass-transition),
    transform var(--glass-transition);
}

/* 支援液態玻璃時才啟用 */
@supports (backdrop-filter: blur(10px)) or
          (-webkit-backdrop-filter: blur(10px)) {
  .glass-search {
    background: rgba(255, 255, 255, .08);
    border: 1px solid rgba(255, 255, 255, .25);
    backdrop-filter: blur(10px) saturate(140%);
    -webkit-backdrop-filter: blur(10px) saturate(140%);
    color: var(--text-color);
  }
}
```

### 實作原則

- `@supports` 只負責漸進增強，不取代 fallback。
- `backdrop-filter` 作用於元素後方內容；元件本身仍需有半透明背景才能看出玻璃層次。
- 搜尋輸入、圖示與按鈕需在 fallback 和玻璃狀態分別確認對比度。
- `-webkit-backdrop-filter` 保留給需要 WebKit 前綴的瀏覽器。
- 透明度降低時，邊框、內側高光或陰影可以小幅保留，避免元件與地圖背景融在一起。
- 液態玻璃只用於搜尋列、浮動工具列、狀態標籤等浮層；一般卡片與主要內容區仍以實心表面和 Border 優先。

## 3. Hover、Focus 與轉場

液態玻璃的互動狀態應以邊界、陰影和輕微位移呈現，不能只依賴透明度或顏色變化：

```css
.glass-search:hover {
  border-color: rgba(255, 255, 255, .42);
}

.glass-search:focus-within {
  border-color: var(--brand-color);
  box-shadow:
    0 20px 44px rgba(38, 52, 45, .20),
    0 0 0 3px rgba(228, 123, 37, .28);
  transform: translateY(-1px);
}

.glass-search button:hover,
.glass-search button:focus-visible {
  background: var(--brand-color-hover);
  transform: translateY(-1px);
}
```

Focus 狀態必須保留清楚的視覺指示；輸入框的 Placeholder 不可取代 Label，並且 Hover 不可作為行動裝置唯一的互動提示。

## 4. 可延伸的 CSS 設計方式

### 4.1 使用 CSS Custom Properties

將品牌色、字級、圓角、透明度與模糊值集中在 Token，方便預覽工具或正式頁面同步調整。元件內只引用 `var()`，不要在各個元件重複散落相同色值。

```css
.glass-search {
  border-radius: var(--radius-glass);
  background: var(--glass-bg-fallback);
}

@supports (backdrop-filter: blur(10px)) {
  .glass-search {
    background: var(--glass-bg);
    backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturation));
  }
}
```

### 4.2 使用 `color-mix()` 與 `oklch()` 建立色階

若後續需要由 `--brand-color` 產生 Hover、Soft、Disabled 或玻璃高光色，可優先測試 `color-mix(in oklab, ...)` 或 `color-mix(in oklch, ...)`。這些色階仍需以實際文字對比度和瀏覽器支援結果驗證，並保留明確 fallback。

```css
:root {
  --brand-soft: #e5eee9;
  --brand-hover: #245341;
}

@supports (color: color-mix(in oklab, black, white)) {
  :root {
    --brand-soft: color-mix(in oklab, var(--brand-color) 12%, white);
    --brand-hover: color-mix(in oklab, var(--brand-color) 86%, black);
  }
}
```

### 4.3 使用 `clamp()` 進行字級縮放

展示型標題或地圖頁標題可使用 `clamp()` 在不同寬度平滑縮放；基礎內文維持 `14px`，避免影響表單與行程資訊的閱讀密度。

```css
.page-title {
  font-size: clamp(28px, 3vw, 36px);
}
```

### 4.4 使用 Container Queries

當行程卡或 Panel 可能出現在 Sidebar、Timeline 或 Mobile 抽屜中時，可用容器寬度決定版面，而不是只依賴整個視窗寬度。

```css
.itinerary-panel {
  container-type: inline-size;
}

@container (max-width: 420px) {
  .itinerary-card {
    grid-template-columns: 1fr;
  }
}
```

### 4.5 尊重 `prefers-reduced-motion`

使用者要求減少動畫時，應停用浮起、陰影漸變和較長的轉場，但不移除 Focus 指示或狀態差異。

```css
@media (prefers-reduced-motion: reduce) {
  .glass-search,
  .glass-search button {
    transition: none;
  }
}
```

## 5. MDN 參考來源

MDN 主要用來確認 CSS 的語法、瀏覽器支援與降級方式；視覺比例、品牌氣氛、元件用途與內容層級仍由網站設計規範定義。

| 類別 | 可參考內容 | 本專案用途 |
|---|---|---|
| 設計變數 | [CSS Custom Properties](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascading_variables/Using_custom_properties) | 管理品牌色、字級、圓角、透明度與共用 Token |
| 液態玻璃 | [backdrop-filter](https://developer.mozilla.org/zh-CN/docs/Web/CSS/Reference/Properties/backdrop-filter) | 背景模糊、飽和度與半透明材質 |
| 陰影層次 | [box-shadow](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/box-shadow) | Panel、卡片、浮層與 Focus 層次 |
| 光暈效果 | [CSS Gradients](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Images/Using_gradients) | 高光、漸層與玻璃反射光 |
| 色彩系統 | [color-mix()](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/color_value/color-mix) | 產生品牌色階、Soft 色與互動狀態色 |
| 色彩空間 | [oklch()](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/color_value/oklch) | 以較一致的感知亮度與彩度建立色階 |
| 字級縮放 | [clamp()](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/clamp) | 讓展示型標題適應不同螢幕 |
| Hover / Focus | [CSS Pseudo-classes](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/Pseudo-classes) | Button、輸入框、卡片與表單狀態 |
| 動畫速度 | [transition](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/transition) | Hover、Focus 與輕微位移的平滑轉場 |
| 瀏覽器降級 | [@supports](https://developer.mozilla.org/en-US/docs/Web/CSS/%40supports) | 不支援液態玻璃時套用深墨綠 fallback |
| 無障礙 | [prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion) | 使用者要求減少動畫時停用轉場效果 |
| 元件響應式 | [Container Queries](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_queries) | 讓行程卡與 Panel 依容器寬度調整 |

## 6. 建議優先順序

正式頁面要落地這套視覺時，優先確認以下七項：

1. CSS Custom Properties：先建立單一 Token 來源。
2. `backdrop-filter`：以 fallback 為基礎，逐步加入玻璃效果。
3. `box-shadow`：控制 Panel、浮層與 Focus 的層級，不使用高濃度黑影。
4. CSS Gradients：只加入必要的高光和反射，不讓漸層搶過內容。
5. `@supports`：確認不支援液態玻璃時仍保有可讀性。
6. `transition`：統一 Hover、Focus 的速度與緩動。
7. `prefers-reduced-motion`：提供減少動畫的替代狀態。

`color-mix()`、`oklch()`、`clamp()` 與 Container Queries 可在基礎元件穩定後逐步導入，並以實際瀏覽器測試和可讀性檢查作為採用條件。

## 7. 變更紀錄

| 日期 | 內容 |
|---|---|
| 2026-07-14 | 建立深墨綠液態玻璃參數與 MDN 實作參考文件。 |
| 2026-07-14 | 液態玻璃預覽採用 `rgba(255, 255, 255, .08)`、`blur(10px)`、`saturate(140%)`。 |
