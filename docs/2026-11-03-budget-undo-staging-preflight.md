# Undo 移除｜Staging 唯讀盤點與保全方案

2026-11-03 Asia/Taipei；基線 `d663927`，唯一遠端 `Travel-Planner-Staging / uyqdopksfysbobhjcepk`。本輪只有 Dashboard 登入及明確 `BEGIN TRANSACTION READ ONLY` 的 SELECT；沒有 Migration、Activation/Pause、資料 DML、Storage bytes、發證／撤銷、QA 帳號或 Production 操作。SQL Editor 另產生私人查詢草稿，不能把此 UI 草稿描述為零外部狀態變更。

Supabase connector 的 get_project/list_migrations 都回 permission denied；因此改用現有 Edge GitHub 登入 Dashboard。頁面明確顯示專案名稱／ref／Healthy，沒有擴權或修改登入憑證。沒有將 OAuth URL 中的暫時 token 寫入 repo／文件／腳本或拿來呼叫 API；沒有讀取專案 API/signing keys。

## 新鮮遠端讀回

觀測時間 2026-11-03 12:11:53Z、12:13:25Z（台灣 20:11、20:13）。這是本輪真 Hosted SQL/catalog 證據，不是真 ordinary-JWT RPC／Storage HTTP／Realtime 驗收。

| 檢查 | 結果 |
| --- | --- |
| Ledger | 65；Head `20261101032853`；`20261103084209`／`20261103113253` 均不存在 |
| 七協定／Undo full | 全 OFF |
| Finance／Receipt／Lifecycle activated latches | 既有 TRUE，未重設 |
| Receipt readiness | 三項既有 TRUE，未重新填寫或認證 |
| legacy_grants_expire_at | NULL；未推定簽發能力自然耗盡 |
| 財務 | 13 Budget／4 Actual／3 Baseline；重複目前 Budget links 0 |
| 其他基本數量 | 4 trips／3 Auth users |
| 有效 wildcard／group leases | 0／0 |
| Pending receipts／unfinished cleanup／其他 active transactions | 0／0／0（觀測當下） |
| 歷史 queues | intents aborted3／committed7；cleanup done11；不能清空歷史 |
| 財務 Receipt metadata／Storage objects | **1／2，阻擋直接套用** |
| 引用 | 1 object 有目前財務 metadata 引用；1 object 無目前引用；metadata missing object0 |
| private RLS／direct table grants／publication | 無 RLS 的 private table0；一般角色/Worker直接表授權0；private publication0 |
| 函式 | public/app_private 共277個；已封存定義＋ACL集合摘要，但未逐一聲稱與歷史 golden seals 相等 |
| Undo ACL | 十二個 public/private 簽章 authenticated EXECUTE 仍 TRUE、anon FALSE；公開 wrapper 為 invoker，私有 entry 為 definer。新 Forward 尚未執行，不能宣稱 Hosted Undo 權限已撤銷。 |

保全摘要及六個財務投影指紋見 [去敏盤點](qa/2026-11-03-budget-undo-staging-inventory.json)。Storage digest 是 catalog JSON 指紋，不是實際 object bytes SHA-256、下載／備份或還原證據。無目前 metadata 引用不等於可刪除 orphan，可能仍是舊控制檔或其他流程持有的物件；本輪未判定用途或刪除資格。

## 具體保全方案（待 Review／Staging 寫入授權）

1. **原地保留**既有1筆metadata、2個objects及全部財務/Source/Baseline/稽核/queues；不做 delete、搬移、rename、清空、key rotation 或新 Worker sweep。新 Forward 的政策會拒絕一般使用者的財務收據路徑，但 metadata/bytes 本體仍保留，這個「使用者停止存取、資料仍保全」的結果需納入 Review。
2. 以本輪指紋為起始參考；真正執行前重新封存所有將受影響的財務/非財務/Auth/Storage投影、完整原始 ledger rows/source、exact before function/ACL/owner/security/search_path/RLS/trigger/policy、既有 audit。當下的0租約不能當稍後的維護窗口證據。未知差異或 writer 必須拒絕安裝，不能靠只有 target GUC 宣稱環境正確。
3. 檢查舊 signed-upload／signed-read／TUS／S3／其他發證能力的真停止點、期限和失效狀態；本輪沒有取 key、簽 URL、下載 bytes 或輪替憑證。新 restrictive policy 不能冒充既有 signed 能力已失效，也不能改寫原 journal/expiry。需要無秘密持久化的精確後續讀回／HTTP方案。
4. 在明確 Staging 寫入授權及 Review 接受保留既有收據的條件下，才製作 **Staging-bound 單一 Forward wrapper**：只承載 `20261103113253`，exact live before-contract、source hash、資料保全、在途 inverse/財務 transaction 排除、locks/timeouts，單一交易及 ledger 註冊；禁止重播B7/reset/舊30秒Forward/舊deferred Receipt草稿，不能使用 `db push --include-all`。任何未知 COMMIT 先用新唯讀連線判斷。
5. 先在可丟棄的隔離 clone 演練既有收據保留、late-error完整rollback、重複Actual拒絕及已安裝重播拒絕，再另行執行受控 Staging schema 更新與獨立新連線readback。對照所有原列/objects catalog和既有 latches，不能以UI看不到收據就聲稱資料已清空。沒有另外授權就不啟用非Receipt協定。
6. HTTP驗證需真普通Owner/Editor JWT和可還原/保留的獨立QA graph，先證明十二個Undo入口拒絕、輸入Ctrl+Z不發inverse、Pricing/Payment/Source/Lifecycle/Realtime/取消正常，以及財務Receipt拒絕／其他附件正常。管理key只可精確QA初始化，不能代替使用者驗收。需重新取得安全的 native/RAM-only 存取路徑；舊助手已停止，不能從舊status推定可用。任何需改既有 latches/flags 的驗收另做精確範圍決策，不假設這輪唯讀盤點已授權啟用。

## 目前決策

唯讀盤點完成；**不直接部署新 Forward，不開始 Hosted DDL/QA DML 或 Activation**。具體阻擋是已存在的財務收據、未驗證舊簽發能力和未完成target-bound before-contract／HTTP方案，不是 duplicate/lease/queue故障。請 Review 上述保全方案後明確決定 Staging 寫入及驗收範圍。Production、正式Storage/flags、main、Vercel維持本任務禁止範圍。
