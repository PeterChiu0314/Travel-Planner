# B-4a Source／Receipt 相依盤點（分析，不實作新生命週期）

本機來源基準 `abee7c0` 及 B-4a forward migration；沒有查詢／修改 Hosted 或 Storage。較早 Budget Safety 文件的 destructive unpaid 語意已由 Unified Planning 取代，不能回復。此次 Payment 只切 active／首次建立／明確 paid_at，不重新關聯來源或上傳、刪除檔案。

## Source 現況與下一階段

| 欄位／路徑 | 已確認程式／SQL 行為 | 後續必要依賴 |
| --- | --- | --- |
| `actual_expenses.budget_item_id` | FK 指向 Budget，`ON DELETE SET NULL`，是目前可用來源關聯 | Actual.source＋舊／新 Budget graph；舊、新 parent 短鎖與 membership |
| `budget_origin_id` | 無來源 FK，baseline `keep_actual_budget_reference` 在有新 link 時設來源 ID，unlink 保留 old origin；來源刪除仍保留歷史識別 | 不能當「目前仍 linked」或「可獨立改價」的證據，不能為通過驗證而清掉 |
| `payment_origin` | manual／budget_toggle；舊 `keep_actual_twd_cost` 遇非鎖欄位變更會轉 manual。Pricing／Payment 現在只對精確 manifest 豁免 | provenance 與 known debit 保護；manual 不代表 origin-free，P2 已以實際舊新函式對照證明 |
| 來源欄位編輯 | 舊 Actual 完整編輯以 `budget_item_id` 提交；來源 picker 的套用會帶 Budget form；v2 及 v3 sync 會寫多欄／重建 joins，v4 外加整筆 lease | 不可將完整 form 當新 source patch；未來必須分「只改來源關聯」與「明確套用來源資料」 |
| 來源套用 | 可能改 money／payer／title／category／note／participants；known TWD／歷史外幣／retained 集合都有限制 | DB 列出完整 effects、取 source＋pricing＋payer＋實際會寫的 metadata bundles，保存 DB before-image／immutable ledger；不讀未提交草稿 |
| 修改／刪除來源 | pricing tracker 對 old/new budget_item_id、origin ID、backlink、trip 等推進 graph；Actual FK 解連仍留歷史資料 | 等待後重解完整集合；兩個 Budget 都要失效，不能只更新新來源。來源刪除與 Actual 刪除是不同交易 |
| origin-only Actual | 目前無 link、歷史仍有 origin（可能 source Budget 已不存在），且舊 trigger 可能已轉 manual | 新 Pricing／Payment fail-closed；先決定明確 detach/relink 的產品規則再做新 source action，保留成本／history／receipt |
| 多 retained／backlink | 每筆 Actual 身份保留，Payment 可對合法集合切 active，不聚合 | Source 操作要對完整 old/new 集合及每筆版本判斷，壞 backlink／跨旅程／不明來源拒絕 |

後續建議切片：先 source readonly graph inventory＋明確 relink-only contract，再做 DB operation/lease/vector/ledger 與並行 QA；另一個獨立 action 才處理 apply-source-data 的完整金融／metadata bundle。不能藉 relink 偷帶另一筆 Budget 的 money/payer/文字。以上是施工建議，未新增 source RPC 或 schema。

## Receipt 現況

| 路徑 | 現有行為／保護 | 尚未解決的跨系統邊界 |
| --- | --- | --- |
| Metadata | `public.mutate_budget_receipt` 為 invoker，trip advisory、approved editable membership、Actual 整筆 capability，限制 target/path/name/size；metadata DML 受 group wildcard guards | 仍是既有 Actual whole-row lease，尚無 Receipt group/ticket 協定 |
| Bucket／RLS | `trip-attachments` private，10 MiB，JPEG/PNG/WebP/PDF；Storage path `trips/{trip}/attachments/{targetType}/{targetId}/...`。read 用 can_read_trip，insert/update/delete 用 can_edit_trip | Storage policies 驗 trip 權限，沒有新 SQL group capability 的 byte-level 綁定；舊 clients 仍能直接操作 bytes，正式啟用前需單獨解決，不能放寬 RLS |
| 上傳 | App 先取得既有 lease，再 upload(upsert:false)，成功後呼叫 metadata RPC；metadata 失敗時嘗試刪掉剛上傳的 object | object upload 與 SQL commit 不原子；補償刪除若失敗會有孤兒，現有流程沒有持久 cleanup ticket/reconciler |
| 開啟／下載 | `createSignedUrl(file_url,600)`，metadata 路徑與 private bucket；open 新視窗 | 已簽 URL 的有效期／下載授權仍遵循 Storage，本輪沒有更動 |
| 刪除 | `deleteBudgetReceipt` 先 metadata RPC 成功再 Storage.remove，失敗回 cleanupError 並刷新；舊未走 lease 的路徑仍可能先刪 bytes 再刪 metadata | SQL rollback 無法還原已刪 object。metadata 成功／byte cleanup 失敗會留下孤兒，必須 idempotent cleanup/reconciliation |
| 替換 | 現有 UI 以新上傳／舊刪除為基礎，沒有新 replacement operation | 需保留舊 committed receipt 直到新 object＋metadata 成功；失敗不能讓兩端都消失 |
| Actual 刪除 | 附件 target 是 polymorphic target_type/target_id，並非直接對 Actual 的 FK。既有 record delete／cleanup 與 Storage 檔案清理不能混為同一交易 | 後續需以 DB 查實際 orphan metadata/object，不得假設刪 Actual 自動等於刪 bytes；receipt-bearing Actual delete 要單獨設計 |
| inactive payment | Actual 不刪、ID不變，附件 metadata／object reference 不變；Budget 明細仍可透過 retained 顯示收據 | 不得因 unpaid 移除 receipt 或改 target；未完成付款／空白建立尚未接 Receipt 新協定 |

## Receipt 建議施工邊界

1. 建立 server-authoritative upload intent：綁 actor／trip／Actual／path／預期 receipt revision；pending metadata 不誤作已完成收據。具體欄位待下一階段契約與 migration。
2. 上傳新 object 後 commit metadata，只有 DB 驗權、版本與 object identity 成功才轉 committed；替換先保留舊 committed 身份。
3. 刪除先記可追蹤 tombstone／cleanup work，再執行 byte deletion；失敗可同 ID 重試，不能宣稱 PostgreSQL rollback 還原 object。
4. cleanup/reconciliation 比對 ticket、metadata、Storage identity，保留 owner/trip audit、防重試誤刪別人的新 object；未知成功先查原 intent，不用隨機新 path 盲重送。
5. 逐步收斂舊 client 的直接 Storage write 路徑，再驗證 revoke、expire、tab isolation、上傳中 Actual/source 改變、metadata failure、byte failure、孤兒與 replacement rollback。這是正式協作啟用 gate。

本輪只完成盤點。沒有新增上述 tickets/tombstones、cleanup worker、Source actions、Storage policies 或任何正式 Storage 操作。
