# B-7 Staging Managed-compatible candidate Runbook

**NON-AUTO-APPLY／僅供 Review；本輪沒有 Hosted 寫入授權。** 唯一預定目標是 Travel-Planner-Staging／uyqdopksfysbobhjcepk。舊封包因 reserved-role Grant 失敗且完整回滾；新候選本機驗證不等於 Hosted 權限或服務驗收通過。

[完整修正與驗證報告](../../2026-10-31-budget-b7-managed-worker-candidate.md)、[去敏證據](../../qa/2026-10-31-budget-b7-managed-worker-results.json)、[原封包 Runbook](../budget-b7-staging/README.md)。

## 封包身分與唯一來源順序

- 新 SQL：`dormant-schema.sql`，1,493,588 bytes，SHA-256 `6a61cddbd039832b648c76cff385ee3803eaada6e2f252169affe8b9540bcf47`。
- M0：`20261031083437_budget_managed_worker_role_path.sql`，SHA-256 `4a4b50f012c356120a11286d881fef3a268ca97bc23aa05f37aa4b0f122cc08e`。
- 舊 SQL 保持 SHA-256 `4d43bddf6ed7853daa3008c51b58d76b868553330b919f885d82a200f546698b`；仍禁止重跑。
- 下列 15 個實際來源全部與各自完整原文同交易登記。13 個原 B-7 中最後一份由完整 M0 替代，其餘12份、T0、F0不變。舊 Hotfix 已在47筆基線，絕不重播。

| 順序 | 實際來源 | LF-normalized SHA-256 |
| --- | --- | --- |
| 1 | `20260811150000_atomic_apply_itinerary_alternative.sql` | `6ff73aabacc0013535e73b554a0c50e7e313e5df1fe7562ceca8876df47517b8` |
| 2 | `20261029020551_budget_group_metadata_prototype.sql` | `686017abab6daf966fccf15f9f231f91a58f5d4747526daff23b16453f0cdee6` |
| 3 | `20261029031137_budget_metadata_snapshot_signals.sql` | `b7561c3d3cbd89988abebfdf0a526092eb0d65c465dabe45d7cb7eea58d815f1` |
| 4 | `20261029091435_budget_metadata_undo_prototype.sql` | `fed54f64ecb3d9588e7df2c074888c02b60c7a68423cb02e86ea42f8d67cb1fd` |
| 5 | `20261029114817_budget_category_payer_links_groups.sql` | `08c7c9e813d6014fb8ce4fd039e4cd39f9152f0832086609e715d3d1cd591262` |
| 6 | `20261029123907_budget_pricing_participant_groups.sql` | `657c0cacddcea3b70d82a2a8c6c81e52124aeab2d45c39b89d60bb3ef2d2803d` |
| 7 | `20261029134206_budget_payment_lifecycle_groups.sql` | `3387c31f5e4c4bbfd12ddcbc26ff62e23b534de8132a42265d5311de0d8ffaa3` |
| 8 | `20261030012554_budget_payment_minimal_bundle.sql` | `7df467d8e04daedbefda589dee0c1c2cc1e09ec328c37463b640c4e02c07b011` |
| 9 | `20261030021719_budget_source_atomic_groups.sql` | `c9f7db07d72ad627958316a293fdb0d82e284048bee35f3dd6b57cae8a59ea2c` |
| 10 | `20261030034351_budget_receipts_lifecycle.sql` | `68051b3e1253617a062a863e475fb22a01401f98845a28a3720edaa6dc253a80` |
| 11 | `20261030054628_budget_financial_dependencies.sql` | `6e7f04fed391137e775bff888b078e68ced76869d6adc9e302c2a8ff4ee4da55` |
| 12 | `20261030064703_budget_workspace_lifecycle.sql` | `090d1fb6faeeb64e60b2927b9cf1d7418f7f3541539d9fee44aa45cba9cc0cea` |
| 13 | `20261030082712_budget_workspace_undo.sql` | `b8fe1488d9c69057e4699b903ba762c1f3622b3d1c75eb5789e1181643055e27` |
| 14 | `20261031083437_budget_managed_worker_role_path.sql` | `4a4b50f012c356120a11286d881fef3a268ca97bc23aa05f37aa4b0f122cc08e` |
| 15 | `20261031130000_budget_business_conflicts_forward.sql` | `f3b79c74f5c79737ccb17dc89d296cdab3afb8c5c5e115ae32195bb299f6bbb3` |

## Ledger 與 supersession 必須先 Review

新安裝仍47 → 62，Head為20261031130000。`20261030125028` 必須未安裝、未登記，`20261031083437` 登記M0完整來源；不空補舊Ledger、不宣稱執行原檔、不修改原始檔Hash。已有舊B-7安裝或M0的環境直接拒絕，不適用此候選。

原檔仍留在 `supabase/migrations`；CLI可能顯示這一筆未套用。因此未來也不可盲用db push／include-all或migration repair。Review須明確接受這個替代歷史與來源選擇政策；目前只是一份候選，不是已批准的全環境reconciliation方案。

## 本機重現（不接受外部DB URL）

```powershell
node scripts/qa/check-b7-staging-packet.mjs
node scripts/qa/check-b7-managed-packet.mjs
node scripts/qa/run-budget-metadata-parallel.mjs --managed-worker
node scripts/qa/run-budget-metadata-parallel.mjs --managed-worker --fresh-chain
```

Builder `scripts/qa/build-b7-managed-packet.mjs` 僅離線輸出此候選，拒絕原封包／來源漂移；沒有網路或DB executor。Checker比對完整生成SQL、各來源、函式定義零差異與單一BEGIN／COMMIT。Runner每次建立新的loopback PostgreSQL cluster，連線marker驗證後才執行，finally停止；不能用此fixture證明Auth／Realtime／Storage HTTP／Worker排程。

## 未來部署前的 gate（本輪不執行）

1. 先取得**此新Hash＋M0替代／Ledger規則**的Staging-only明確授權。原4d43封包的授權不自動擴充到新版本。
2. 新鮮唯讀核對project host／pooler登入role與實際postgres身分、Ledger47/head、13舊Hotfix、全部Catalog／RLS／ACL／Trigger、原資料指紋、未完成交易；不得用target GUC當唯一身分證明。原2個旅程／1帳號與財務／Baseline／Receipt受保護，無破壞性重建。
3. 額外核對現有Storage→authenticator的SET TRUE鏈、postgres的Managed Grant Option與必要DDL能力。**不能新增／修改reserved-role membership**。使用者角色的creator ADMIN若存在只允許ADMIN TRUE／INHERIT FALSE／SET FALSE；其他直接會員不接受。Supautils行為仍須真Hosted執行檢查，不能以stock fixture取代。
4. 維持所有Protocol／Latch／前端flags OFF。無有效lease／在途writer；保留原強鎖、lock timeout5s、statement timeout60s。維護期間有任何不明寫入即停。
5. 使用native psql與verify-full TLS，Direct優先、IPv6不可用時Session Pooler5432；不使用Transaction Pooler。憑證安全本機輸入，不存聊天／CLI URI／Log／Git。
6. 同一持續Session設定target，再載入**此原樣新SQL**；ON_ERROR_STOP=1，保留內部BEGIN／COMMIT，不加psql -1、不分段、不移除鎖。任一SQL錯誤停止、結束Session並獨立讀回；unknown COMMIT先判定狀態，不重送。
7. COMMIT後必須新唯讀連線核對62個實際Ledger、M0存在／舊版缺席、38個最終Hash、54PT409／24PT500／零自訂40001、資料投影、角色及RLS／ACL／Trigger、七組OFF；執行既有Preflight／Readback與Managed Advisor。失敗保持Dormant，不做破壞性回滾。

## 停止／回復

交易失敗應整筆回滾，先核對舊47基線、舊Hotfix、Catalog／資料及Worker不存在。不要修掉報錯SQL後接著跑後半包。已COMMIT則保持Dormant，只準備經Review的新Forward Repair；不刪Ledger、不drop協定／角色、不重計價、不還原撤銷已提交財務操作。

即使新Dormant安裝成功，仍未授權建立H01～H03 fixtures、Storage files、簽發／讀取JWT signing secrets、啟動Worker排程或Activation。本輪沒有取得任何Hosted憑證或執行以上步驟。
