# 完全移除預算自訂 Undo｜交 ChatGPT Review，未部署

2026-11-03 Asia/Taipei；分支 `codex/budget-collaboration-redesign`，實作起點 `4266736`。起始 tracked tree clean，五個既有 untracked patch/QA 圖保留。僅本機 source、mocked browser 與新 loopback PostgreSQL；沒有讀寫 Production、正式 Storage/flags、main、Vercel 或 Docker/WSL。

## 產品及前端

五步、30 秒單步 Undo 全部取消。刪除 `budgetUndoGroups.js` Controller/service/flag/key helpers 及 Demo `budgetUndo.js` 模擬；App 不再建立、訂閱、configure/dispose Undo，不再註冊 Undo handoff guard。BudgetWorkspace 完全移除全域 Ctrl/Cmd+Z/composition listener、preventDefault 與 pending props。沒有 Undo 按鈕、歷史、倒數或通知，也沒有替代撤銷機制。已儲存資料只能重新編輯。

名稱／備註／數字輸入由瀏覽器處理 Undo。既有群組自動儲存、版本檢查、租約、未儲存草稿取消、同步錯誤及協作標示沿用。移除 Undo 專用 document session rotation，沿用原群組 per-tab session。Formal 使用 v9（或原 feature 對應版本）Snapshot，不再選用 v10；v10 財務資料仍可被通用 validator 接受，但 Undo payload 不參與授權／執行。

保留上一輪收據 UI/runtime 移除、舊分筆付款 UI 移除及單筆目前實付限制。沒有修改旅途中實付／結算的產品規則。

## 依賴盤點與 Forward

官方 CLI 建立 `20261103113253_remove_budget_custom_undo.sql`。已明確未部署的 `20261103084209` 及其 generator 移除，由新版本一次承接 Receipt metadata Trigger、restrictive SELECT/Storage policies、Receipt client ACL 及 `actual_expenses_one_budget` partial unique index。沒有 saved_at、30 秒期限、清空 pointers 或重新生成 B6 函式。舊 deferred-Receipt 草稿不堆疊。

| 相依 | 處理及保留原因 |
| --- | --- |
| `budget_metadata_undo_protocol`（enabled/full_enabled） | 保留既有表和值；兩個既有 enabled helper 永久回 false，不新增 Protocol/Latch，也不能靠舊 activation UPDATE 重新開 Undo。 |
| private `budget_metadata_undo_operations/stack/lineage/intents/receipts` | 保留 audit、row types、FK 與舊函式相依；無 DROP 或歷史清理。原 private RLS/ACL 不放寬。 |
| `budget_metadata_effects.undo_before_value/undo_bundle`、capture/record/assert/boundary Triggers | B6 擴充的正常 field/Pricing/Payment/Source/Lifecycle finish／invalidate 路徑仍引用這些 row types/helpers；不拆解共享原子 transaction。enabled helpers=false 使新 Undo capture 短路。 |
| prepare/manifest/finish inverse helpers、舊 public RPC | 保留定義以免破壞既有相依，但撤銷 PUBLIC/anon/authenticated/Worker EXECUTE，包括 private 原本授予 invoker wrapper 的入口。 |
| `read_workspace_undo`、v10 Snapshot | 保留唯讀相容投影；內部 summary 固定 disabled/count0/topNULL，effects revision 投影仍可讀。v1–v9 與一般 financial graph 不變。 |
| 原已部署 migrations、request receipts、Baseline、Source、付款歷史 | 不修改、刪除或重播。財務版本、群組租約及 RLS 保持。 |

封鎖的 public RPC：`undo_budget_metadata_group`、`undo_budget_workspace`、`budget_workspace_undo_lease`、`read_budget_metadata_undo`、`clear_budget_metadata_undo`。同時封鎖 private `prepare_budget_metadata_undo`、`workspace_undo_lease`、`prepare_workspace_inverse`、`workspace_inverse_manifest`、`finish_workspace_inverse` 及對應 read/clear。隔離 DB 對 anon/authenticated 檢查十二個完整簽章的有效 EXECUTE 均 false，實際呼叫 inverse 回 42501。

**此結論僅對套用新 Forward 的隔離資料庫成立。Hosted 沒有套用或重新盤點；既有 Hosted Undo RPC/ACL 仍是舊部署狀態，不能宣稱已撤銷。** 唯讀 v10 Snapshot 本身仍可呼叫，不是 Undo 寫入入口。

## 驗證與失敗紀錄

最終完整 Playwright **117/117、0 skipped**（1.8 分鐘）；包含原生 Undo／不可逆已存資料、整合、Receipt移除、Metadata、Pricing、Payment、Lifecycle、Shell/Timeline/Luggage/Share，實際 suite 範圍見矩陣。Build、changed JS syntax、`git diff --check` 通過；原有 >500kB bundle advisory 保留。1440/820/390 Demo 截圖已在 Git 外保存；1440px已目視檢查，非空白、無 framework overlay；三種寬度的編輯／儲存互動與 console 檢查通過。

詳見 [本輪矩陣](qa/2026-11-03-budget-custom-undo-removal-results.json)。新建 native PostgreSQL17.11 12/12：晚期 SQL fault 全交易 rollback（body/ACL/index/financial rows）、協定/latch 不變、Receipt metadata/Storage 拒絕與其他附件 CRUD、單筆 linked Actual/獨立 Actual、Undo 十二入口 ACL／實際拒絕、舊協定無法重新開啟、v10 compatibility、雙帳號不同群組寫入、同組租約互斥、Pricing/participants 原子失敗。cluster 已停止。

刪除舊 Controller、Formal/Demo Undo、30 秒 expiry 及 workspace Undo 專用測試，改為原生鍵盤／已儲存不可復原測試；整合測試改為收據不存在且 Ctrl+Z 保留已存 Links。保留歷史 migration fixture 的 SQL 安全/相依回歸來源（舊 metadata prototype/financial cases），它們不是本產品仍支持 Undo 的驗收，也不取代最新 Forward 拒絕測試。

Browser plugin unavailable，使用現有 Playwright Chromium、原生 loopback Vite `127.0.0.1:5175`。Formal 為 mock RPC/Auth，不是真 Hosted。數字只要求瀏覽器原生行為、keydown 未 preventDefault 及無 Undo RPC；Windows 的 Meta+Z 僅證明應用無攔截，未宣稱 macOS 硬體驗證。

初輪 sandbox initdb WAL rename 權限、sandbox browser 路徑、跨 sandbox loopback timeout 均保留失敗結果，後改在核准原生環境執行。測試曾對 readonly 欄位直接 fill，改為實際 click admission；備註原生 Undo 合併粒度不同，使用單次原生 insertText 驗證；Demo request 監測改看 hostname，避免把本機 supabase 套件來源誤算 Hosted。兩個歷史多分頁案例假設一秒自動儲存不會發生：同帳號競爭改為明確等待已儲存後以新名稱開啟；未儲存草稿隔離用既有 patch gate 固定尚未 ACK 前提，仍要求另一 tab 看舊 canonical／原 tab reload 恢復本地草稿且沒有 capability。修正後專項2/2。沒有跳過或放寬鎖、版本、資料隔離斷言來取得通過。

## 正式部署前

交 ChatGPT Review；本輪不部署、不啟用。另案取得授權後，重新讀 live ledger/catalog/ACL、重複 linked Actual、財務 Receipt metadata/objects/jobs、舊 signed URL 能力及有效租約／在途交易。已存在重複實付或收據/jobs 時先保全方案，不自動刪除／合併。新版本只可依 exact live 差異建封包；禁止 db push 全鏈、重播 reset、重設 latch 或修改已部署 migration。

先 Staging 原子失敗演練及真 ordinary JWT 多帳號/多 tab 的 Pricing/Payment/Source/Lifecycle/Realtime/取消；證明新舊 Undo RPC 都拒絕、其他附件 HTTP 正常、財務 Receipt HTTP 拒絕。舊 signed 能力不能只由 policy 推論失效。再另決定正式 schema/frontend 與既有非 Receipt 協定發布順序，Undo 永不啟用。沒有刪除財務歷史或做 schema-down。

## `531a671` 後的本機 Review 補強

後續要求「繼續」先解讀為本機 Review／補強，並非正式或 Staging 寫入授權。重新檢查前端 import／keydown／RPC 路徑及 SQL public/private inverse ACL，未發現新的可執行 Undo 入口；未修改產品程式或 Forward。這是本機自查，不冒充獨立 Review 或 Hosted certification。

原測試對非空歷史保全及既存 duplicate 阻擋的證據不夠直接，已補：

- 管理初始化的獨立歷史 graph，包含外幣付款、目前 Budget link／Source Origin、Actual participants、Baseline、Undo operations／stack／request receipts。這些是明確的隔離 fixture，不是真 Hosted 使用者付款證據。
- 在 Forward 前放入兩筆相同 Budget 的 Actual，要求 unique index 建立回 `23505`，整包回滾；完整財務／稽核投影、七個協定列與 public/private function bodies／ACL 均一致，index 未殘留。不自動合併或清理重複資料；測試 fixture 由 runner 在獨立 cluster 清理。
- 成功套用及晚期 fault 都比對非空完整 graph；七個 protocol（含其現有 latch/readiness 欄位）不變。Undo 即使舊 protocol 欄位設 true，兩個 enabled helper 仍回 false。
- 同伴先提交新 title revision，再以仍有效的租約送舊 base revision，要求 `PT409` 且完整財務／歷史投影不變；沒有取消版本檢查。

這次只補測試／證據／文件，不重跑未受影響的 117-case frontend suite；其上輪完整 Passed 紀錄仍保留。部署決策仍待 Review、live inventory、受控 Staging 與真 JWT/HTTP。尤其現有 receipt bytes/jobs、舊能力失效、在途 inverse／財務 writer 的排除，必須由下一份 target-bound preflight/wrapper 及真讀回證明；單獨本機 SQL Passed 不是可直接對 Hosted 執行整條 migration chain 的授權。

最新完整隔離 PostgreSQL17.11 **14/14 Passed**，已正常停止 cluster；changed JS syntax、`git diff --check` Passed。前述 12/12 是首次移除的歷史 checkpoint，已由這輪完整擴充 suite 取代。
