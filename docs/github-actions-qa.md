# Travel Studio｜GitHub Actions 非阻擋回歸 QA

## 目標與約束

- 每次 Push 到 `codex/**` 或 `main`，以及對 `main` 的 PR，執行 `Travel Studio QA`。
- **Vercel 自動 Preview 部署照常進行**；Actions 失敗不禁止 Push、不阻止部署、不會修改程式，也不自動關閉 Issue。
- 預設 **core**：Build + 專選的跨頁瀏覽器測試、Formal App 資料流、故障恢復、離線快取、跨旅程 Guard；每次 Push 執行。範圍集中在已通過行為，並非完全取代完整 QA。
- 選用 **extended**：除 core 以外，跑較完整的跨頁測試組（包含多人協作、成員權限、旅程日期、Timeline 排程規則）。重要改版／合併前手動啟動。工作流程需出現在預設分支後，GitHub 網站才會顯示 `Run workflow` 手動入口；目前若只在功能分支上，先由 Push 自動執行 core。
- 不存取 Hosted Supabase，不使用正式／Staging credentials，不驗證真實 WebSocket；使用 Demo、Mock 與隔離 PGlite。
- 請勿把 Hosted DB URL、service-role key 或 Vercel token 加進 workflow。

## 運作

`.github/workflows/qa-regression.yml`：Checkout → `npm ci` → 安裝 CI 專用 pinned PGlite → 安裝 Chromium → `npm run build` → 啟動本機 Vite → Playwright → 失敗時保存 trace、HTML、截圖與 Vite log，7 天到期。

- `PGLITE_MODULE` 在 runner 內由 `require.resolve('@electric-sql/pglite')` 取得，不需在專案 runtime 新增資料庫依賴。
- Chromium、Node.js 版本固定於 workflow；Playwright 依照 `package-lock.json` 使用既有專案版本。
- 1 worker、失敗重試 1 次；重試後成功仍應查看 flaky 項目，不應視為永久修復。
- 同分支新 Push 會取消過時的執行；不同分支獨立執行。
- 初期不配置 required checks 或 Vercel Deployment Gate。

## 如何查看與處理

1. 開 GitHub → Actions → **Travel Studio QA** → 最新 workflow run。
2. 綠色：core 已通過。紅色：看失敗測試及 `travel-studio-qa-<run_id>` artifact 中的 Trace（Playwright Trace Viewer）。
3. Codex 每次 Push 後應核對該次 commit 的 Actions 結果；失敗時依序排除**產品回歸 → 測試環境 → 過時斷言 → 偶發問題**，不要直接刪測試或修改期待結果讓它通過。
4. 若同一功能修復過重大 BUG，將已重現的測試加入 core；未修改功能規則時，避免更改既有行為斷言。
5. 測試選單位於 workflow 的 `core_pattern` 與 specs 清單；新增核心案例時優先引用**既有測試**，不要複製一份。重新命名測試時同步檢查 `core_pattern`，確保其仍選中預期測試。
6. 若流程因 runner / 依賴版本失敗，先修 CI，不要求更動業務邏輯。此範圍不應觸碰 Production、main 的功能碼或 DB schema。

## 邊界

Actions 能抓到「測試已涵蓋」的回歸，不代表已驗證全部視覺、Map API、真實多人 Realtime 或 Hosted 失敗情境。大改版／模組化的分段拆分仍須額外跑相關模組回歸與少量必要手動驗收。
