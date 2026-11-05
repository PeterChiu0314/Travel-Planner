# Issue #18｜Staging 部署前交接（2026-11-05）

## 本輪交付

原分支加入同一支出 ID 的預算／實付編輯頁、逐群組租約與版本、一次付款、獨立參與者決策、旅程匯率更新、Realtime invalidation、住宿選取新支出，以及 Timeline 只讀成本投影。新模型不使用舊 Budget Source、Receipt 或 Undo；原始 Actual 與 Baseline 留存。CLI 產生的唯一 Forward 為 `supabase/migrations/20261105080725_issue18_single_expense.sql`，包含導入 8 筆舊 Actual／11 筆分攤、逐筆比對、舊寫入入口停用和 Ledger 新版本。

## 已驗證

- Staging project `uyqdopksfysbobhjcepk` 唯讀盤點：Ledger 66/head `20261103113253`、舊 Budget 18、Actual 8、Actual participants 11、住宿 1（舊預算關聯 0）、兩種舊租約 0；新 schema 不存在。前後獨立讀回 Actual SHA256 `54583d96dd90ae339569bec4f14bdbe344a8d4a5f11925955636755f9e9ef324`、Baseline SHA256 `f8d4920767335acb168af8b7831676cabdf73295cd0597fb07c454759e0f69e5` 未變。完整舊資料內容只在 Dashboard 內讀取，Git 不含其原文。
- Disposable PGlite：16 個私有 RPC/Controller 測試通過，包含預算 A/B/C、實付 A/B、PT409、租約同帳戶跨頁、未知回應同 request、取消付款、匯率只重算未付款預估；1 個完整 Forward 結構及 legacy NULL 日期／小數 TWD／未知份額測試通過。這是序列測試，不當作真實兩人 Hosted 並發。
- Mocked Chromium：新 App 的同 ID 預算 10,000／實付 9,500 與 Actual-only 失去 ACK 重送流程 2/2 通過。舊 guarded Budget snapshot 回歸另見本輪測試輸出。Build 和 diff check 通過。

## 尚未達 Staging 部署門檻

Supabase Dashboard 對整包交易試跑提示新建表 RLS。選擇「Run and enable RLS」後 SQL Editor 顯示 `schema "expense_stage_b" does not exist`；其是否在 SQL 執行之後的額外 RLS 步驟失敗，無法從該畫面確證，所以不標 Passed。正式 Commit 操作被自動審核拒絕，明確理由為 Staging dry run 未通過。隨後獨立 readback 確認沒有新 schema、沒有 Ledger 67、原始 Actual/Baseline 指紋未變。沒有改五個協定、Undo/Receipt、Latch、Migration 66、正式環境。

下一步：使用有正確 Staging 存取權的正式 Supabase migration 執行路徑，先完成可讀回結果的交易回滾試跑；完整 Preflight/Actual parity/RLS/ACL 合格後才套用此 Forward，並執行授權帳號的實際新增、修改、付款、兩人群組衝突、Rates、住宿及結算煙霧測試。新 Preview 前端在新 RPC 尚未安裝時會走舊讀取；不能當作新版已上 Staging。正式 Production/main 仍 NO-GO。
