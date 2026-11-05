# Issue #18｜Staging 手測交接（2026-11-05）

## 手測入口與範圍

- 分支：`codex/budget-collaboration-redesign`；Vercel Preview：<https://travel-planner-git-codex-budget-co-6eda5b-peter-chiu-s-projects.vercel.app/>。此部署為 `target:null` 的 Preview，不是 Production。已核對部署 `dpl_CxQs7Ah3ut7cc11xRJjxVRmcvUQ3` READY、Git SHA `310107f7d8465f35324b55c040dde20d0302d887`。
- 使用有此 Preview 權限的 Vercel 帳號進入，再用既有 Travel Studio Google 帳號登入；專案連向 **Staging `uyqdopksfysbobhjcepk`**。不需管理 key。可選「系統測試專用」旅程，在「預算管理」切換「預算／實付」。已留一筆 `Issue18 Staging 手測`（ID `3559d700-41c4-4bf9-b363-767dd5691938`，TWD100，已付款）供檢查。請勿把這筆當作歷史 Actual。
- 本輪只安裝 Issue #18 同一支出模型及必要的 Staging Forward；未碰 Production、main、正式 Storage、Vercel Production。舊 Budget 18 筆不轉入新模型，符合已確認的資料取捨；原始 Actual、Source Origin、Baseline 留存。

## 已完成的必要驗收

1. Supabase 連接器在正確 Staging 專案讀到 Ledger66/head `20261103113253`、原始 Actual8／分攤11、舊 Budget18、住宿1且舊預算關聯0，目標 schema 原本不存在。安全顧問先讀取；原有私有表 `RLS Enabled No Policy` 24 個 INFO 及現有可執行 definer 警告屬既有項目。
2. 以整份 Forward 的 `BEGIN` 到最後 `ROLLBACK` 在真正 Staging 試跑成功，最後獨立讀回 Ledger66、目標 schema 不存在，原始 Actual SHA `54583d96dd90ae339569bec4f14bdbe344a8d4a5f11925955636755f9e9ef324`、分攤 SHA `0dd2f7f21fd07d9041ee244152ae237d4144e6af4aef39a8ce4fa716fc67bd16`、Baseline SHA `f8d4920767335acb168af8b7831676cabdf73295cd0597fb07c454759e0f69e5` 均未變。此前 Dashboard SQL Editor 的 RLS 附加動作失敗是歷史阻擋，不冒充此次試跑。
3. `apply_migration` 成功安裝一個 Forward。Ledger67/head `20261105083233`，名稱 `issue18_single_expense`，內含一份 source；本地 [Migration](../supabase/migrations/20261105083233_issue18_single_expense.sql) 與 Ledger `statements[1]` 的完整 SHA256 均為 `8d472812fcecc87b3def9825d85bce8bbe227e5778883649c84e99c693391a50`。新版私有支出起始8筆／11名參與者；匯入斷言逐筆比對原始 Actual 的付款 JSON、日期、狀態、payer 和份額。
4. 新支出三個讀取表及 `public.expense_signals` 的 RLS 啟用；六個公開 RPC 可由 `authenticated` 執行、`anon` 為0；清單內的舊財務寫入 RPC 及五張舊財務表對 `authenticated` 的寫入權限為0；`expense_signals` 已加入 Realtime publication。套用後 Security Advisor 未增加 Issue #18 警告。既有 Metadata／Finance／Payment／Source／Lifecycle 保持 ON，Receipt／Undo／fullUndo 為 OFF，未改 Latch/readiness。
5. READY Preview 以登入中的 Peter QA 帳號實際載入新版「支出工作區」，在「系統測試專用」新增一筆預算，編輯名稱、TWD100 與付款人，自動儲存後按「標記已付款」。畫面顯示同筆「預算 TWD100／實付 TWD100／已付款」；SQL 讀回相同 ID、付款狀態 `paid`、兩份 JSON 各100及 `paid_at`，新表共9筆。原始 Actual8／分攤11及三份原始指紋在此操作後仍不變。
6. 新 Forward 調整檔名後，41個受影響 Node/PGlite 測試通過，涵蓋獨立預算／實付份額、同組租約版本衝突、PT409、request 重送、未付款外幣重新計價及舊 Actual 形狀；先前同一前端 SHA 的13個 Chromium 與 Build 已通過。這些本地案例不冒充 Hosted 雙人驗收。

## 還需手測／正式部署前條件

- 請在 Preview 用兩名既有旅程成員驗證同一群組編輯衝突及不同群組並行；檢查重新整理後儲存與付款狀態。可用現有 QA 旅程建立新測試項目，避免修改8筆原始歷史 Actual。
- 驗證一筆外幣未付款預算的合法新匯率更新，只重算預估與分攤；已付款實付不重算。若報價未變，記錄 no-op，勿標 Passed。
- 檢查住宿關聯、Timeline 成本投影與分帳結算對新資料的讀取；原始 Actual 的特殊形狀（空付款日、舊小數 TWD）仍需專門的 Hosted 覆核。
- 上述項目及必要產品 Review 完成前，Issue #18 是 **Staging 可手測**，尚非 Production GO。不得自行套用 Production Migration、合併 main 或正式上線。

## 回家接續

拉取原分支後先讀 `CURRENT_TASK.md`、本文件與 [歷史部署前交接](2026-11-05-issue18-staging-predeploy-handoff.md)。Staging 已有新 schema 和 Ledger67，**不可重播**已安裝 Forward；以唯讀讀回核對來源／狀態再接續剩餘 Hosted 測試。保留使用者未追蹤的 `design/icon-exploration-2026-11-03/`，不要提交 key、`.env` 或 `.tmp`。
