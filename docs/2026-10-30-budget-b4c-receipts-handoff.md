# Issue #15 B-4c Receipt 安全協定

2026-10-30 B-7 後續：目前契約以 [B-7 驗收](2026-10-30-budget-b7-integration-acceptance.md)／[操作文件](2026-10-30-budget-b7-rollout-runbook.md) 為準。新增可信內容驗證與預設 false 的 content_worker_verified；Worker 改用專用 NOBYPASSRLS role＋exact claim headers，下面舊 service-role CLI 是歷史做法。真 Storage HTTP／排程仍 Blocked，不能據此啟用。

2026-10-30；分支 `codex/budget-collaboration-redesign`；起點與 GitHub HEAD 均為 `2ba45ac691608afe76840493f3534e292956e35b`，工作區起初乾淨。只進行本機實作、隔離 QA、文件與本分支 commit/push；未連接 Hosted Supabase，沒有正式資料／Storage／設定／migration／main merge／手動部署。

## 實作盤點與差異

舊 `App.uploadAttachment`：Actual whole-row lease → Storage upload(upsert:false) → `mutate_budget_receipt` metadata；metadata 失敗只做瀏覽器補償刪除。舊 `deleteBudgetReceipt`：metadata 刪除成功再 remove bytes，沒有持久 cleanup；其他工作區仍有先 Storage 後 metadata 路徑。`trip-attachments` 是 private bucket，10 MiB、JPEG/PNG/WebP/PDF；標準 path 為 `trips/<trip>/attachments/<type>/<target>/<filename>`，Signed URL 600 秒。舊 Storage policy 只有 trip 權限，不能代表 Receipt group capability。

這次沿用同一 AttachmentList、Menu/inline 樣式、Actual Detail／retained 入口，新增選檔「替換」，沒有獨立收據頁。其他工作區仍使用原 callbacks／UI。新協定只在 `VITE_BUDGET_METADATA_GROUPS=true` **且** `VITE_BUDGET_RECEIPTS=true` 時接入；兩者預設關閉。

| 動作／故障 | DB 與檔案行為 | 恢復與可見狀態 |
| --- | --- | --- |
| Upload | DB 先建立綁 actor/tab/Actual/版本/原 Request ID 的 pending intent，產生不可重用的 Metadata ID／object path；再 Storage upload；DB 查 object ID、size、MIME 後原子提交有效 metadata | pending 檔案不列入有效附件；HTTP ACK 遺失先查同 intent，不換 path、不重複上傳 |
| Replace | 新 object 完整成功後，同一 SQL transaction INSERT 新 metadata＋DELETE 舊 metadata＋enqueue 舊 object cleanup | metadata 任一步失敗全部回滾，舊有效收據及舊 bytes 保留；新 bytes 仍 pending，可同 ID 提交或明確取消 |
| Delete | 先持久 intent，再原子移除有效 metadata 與建立精確 object cleanup job；**這是邏輯刪除的提交點** | SQL 失敗保留舊有效 metadata／bytes；提交後 Storage 失敗不反向偽稱 SQL rollback，保留 bytes／journal，可透過待清理原檔入口存取直到清理完成 |
| metadata 成功、cleanup 失敗／逾時 | 已確認 receipt ACK 與 cleanup 分開；舊 object job 不因瀏覽器離開消失 | 顯示「舊檔清理待重試」；replace 的新有效收據保持可用；只重試 cleanup，不能重送 upload／建立另一筆 metadata |
| upload 成功、metadata 失敗 | 原 intent 仍 pending，新 object 不作有效收據；舊收據不變 | 同 Request ID 重新查 object 後只提交 metadata；也可取消並持久 enqueue pending object |
| 未回應的 upload HTTP | 共用既有 10s authority deadline；每個原 request 在 Storage adapter 內共用一個在途 upload promise | DB 已查到 object 即可提交 metadata，不等待遺失的 HTTP ACK；尚無 object 且原 upload 未結束時，重試只共享 transport，不平行再傳一次 |
| metadata ACK 遺失 | immutable successful receipt／原 intent result 查證 | 不重新 acquire、不再 upload／建立 metadata；恢復前不顯示假成功 |
| Snapshot 慢／失敗 | 保留已確認 ACK／canonical IDs；不把舊 metadata 當成這次成功結果 | 只重讀 Snapshot；舊 ACK 不覆蓋新 context；cleanup 掛起也不把已確認 metadata 降成未知提交 |
| lease 到期／接管 | 重新讀權威 Snapshot，版本完全相同才可用新 capability／epoch 恢復原 intent | 來源／付款／收據版本已變則拒絕，不 rebase；保留原檔或明確取消／保留待確認操作 |
| 撤權／離開 | Actor 每步由 DB／Storage 驗證；明確「保留操作，稍後確認」只留下無 capability 的 request 資訊 | ActiveEditorGuard 預設攔截；保留後可以先離開，重新進入仍要核對原 request；reload 必須重選原檔案，並比對 name/type/size/SHA-256 |

`payment_active=false` 不刪收據；全程不改 Actual ID、付款歷史、已知扣款、payer、participants 或其他金融欄位。Receipt 不產生 Undo before-image，成功只清目前 actor/tab 的不可逆操作指標，不清別人的無關 Undo／audit。SQL rollback **不能還原已刪除的 Storage bytes**。

## DB／版本／權限

- CLI 產生新 forward migration `20261030034351_budget_receipts_lifecycle.sql`；前 55 份 migration 原檔不修改。`receipts` 是 Actual group，不混入文字 autosave groupKeys。只持有 Actual.receipts 長租約，沿用七分鐘 TTL、精確 actor/session/token hash/epoch；短交易 trip advisory＋membership/protocol SHARE NOWAIT＋parent NOWAIT。撤權 holder 不再阻擋新的 approved holder，接管推進 epoch；過時 release 不清新 holder。
- Snapshot 明確新增 `read_budget_metadata_snapshot_v7`，metadata schema7、Receipt schema1，保留 v1–v6／Payment schema2／Source schema1。strict validator 比對 receipt IDs 與 committed attachments、版本／身份；offline cache 去除 Receipt authority projection。缺 v7 時仍可唯讀查看舊附件，不 fallback 寫入舊 Receipt RPC。
- `receipt_versions` 只讀 Actual source revision、payment revision、pricing graph、current/origin 及來源 Budget graph。來源／付款並行改變時拒絕舊 intent；未定義的 origin-only／矛盾付款圖 fail-closed，不以修 Origin 或改 provenance 解鎖，原收據仍可讀。Receipt-bearing／pending-upload Actual 的舊刪除路徑拒絕，沒有新增正式 Actual lifecycle。
- `budget_receipt_intents`、`budget_receipt_cleanup`、protocol 都是 private RLS tables，無 authenticated/anon table grants、無 private Realtime publication。狀態變更重用既有 `signal_budget_metadata_state` 發出 trip 範圍 opaque invalidation，沿用目前 coalesced Snapshot reader；不另建 Snapshot manager。
- Public financial/metadata RPC 維持 SECURITY INVOKER；窄 private helpers 固定空 search_path、驗證 JWT actor／approved edit role／trip／Actual／完整版本與 capability，effect 綁 transaction/backend/actor。附件 DML 僅接受完整 manifest 的 new/old rows；未 Finish 的 effect 不能 commit。成功結果進現有 immutable request ledger；跨協定同 ID 不可重用。

| RPC | 用途 |
| --- | --- |
| `budget_receipts_lease` | acquire／renew／精確 release，DB 固定單一 receipts target |
| `mutate_budget_receipts` | 同原 ID begin／commit；支援 upload／delete／replace，DB 產生與檢查 object identity |
| `read_budget_receipt_operation` | 已授權 actor/tab 查原 intent、object ready／成功 result，不能取得寫入 capability |
| `abandon_budget_receipt` | 以最新版本及新／仍有效 capability 明確取消 pending intent，enqueue 新 object；不取消已 committed 操作 |
| `claim_budget_receipt_cleanup`／`finish_budget_receipt_cleanup` | approved editor 的精確 job claim／結果確認；claim token、Actual receipt lease、版本及 object ID 必須一致 |
| `sweep_budget_receipts`／`claim_budget_receipt_worker` | **只有 service_role** 可呼叫的過期 intent／canonical orphan inventory 與 SKIP LOCKED durable work；不直接 DML Storage bytes |

## 新舊 Storage 路徑與 activation gate

新 object path 由 DB 產生：`trips/<trip>/attachments/actual_expense/<actual>/receipts/<metadata UUID>/<request UUID>/file`，沒有 lease capability 出現在 path／metadata。Receipt Storage client 只使用當前使用者 JWT、公開 anon key 與每次操作的 session/token/epoch/request headers；不變更共用 client headers，也沒有 frontend service-role key。

在既有 permissive Storage policies 之上新增四個 **RESTRICTIVE** policies，因此舊 client 不能藉另一個寬鬆 policy 繞過：

- 新 namespace 永遠受保護；啟用後所有 canonical Actual 路徑、既有 Actual metadata 引用及 journal object 都受保護。只允許 pending intent 的精確標準 authenticated upload，並驗 actor、tab capability、epoch、版本、TTL、MIME／size（API preflight 允許未提供 size，最終 metadata commit 仍完整核對）。
- 封鎖 overwrite/upsert、move/copy、signed-upload token 發行／上傳、S3／resumable 等替代寫入 operation；未知 Storage backend operation fail-closed。signed download 保留既有 private read／600 秒有效期。
- Delete 只有已 committed／aborted journal 的精確無 metadata reference object、有效 cleanup claim 與當前 Receipt capability 可以執行；trusted worker 只從受控 claim 取得 path/object ID，不能接收使用者指定的任意刪除路徑。
- 舊 metadata `mutate_budget_receipt`／raw INSERT/UPDATE/DELETE 在 activation 後也受 manifest boundary 拒絕；暫停 protocol 仍保留 `activated` latch，不能恢復舊寫入來繞過保護。其他工作區正常 path/policies 不變；不能把 Receipt object alias 到另一工作區來逃避清理／授權。

**不能直接開旗標。** DB activation trigger 要求 `storage_verified=true`、`cleanup_worker_verified=true`，且明確的 `legacy_grants_expire_at` 已過期；bucket 必須 private 且仍為原10 MiB／MIME 設定。這些欄位預設 false/null，只有管理端可寫。

正式啟用前需另案授權：隔離／Hosted HTTP 驗證 Storage 將必要 headers 與 operation context 傳給 RLS、上傳 preflight／final metadata 相容性、舊 signed-upload／resumable 授權已全部停止發行並耗盡實際最長有效期、混合舊 client 已受限制，以及 server worker 排程確實執行。既有簽出的下載 URL 在600秒內仍可能有效，沒有宣稱即時撤回 URL。這次不改正式設定或部署 worker；QA 的 readiness booleans 只描述隔離 fixture，**不是正式驗證**。

## 持久清理／worker

`scripts/maintenance/budget-receipt-cleanup.mjs` 提供 `reconcileBudgetReceipts(trustedClient)`，worker 先 sweep 過期 pending intents，再處理已持久化的 waiting／過期 claimed jobs；每批有上限、每個 transport 有沿用的10s deadline，失敗退出本批，後續排程重試。成功刪除但回應／finish 遺失時，下個 claim 會檢查 object absence 再完成；舊 claim token 不能完成新 claim。

掃描只處理可證實 canonical Actual namespace 且無任何 attachment 引用的 catalog objects；其他工作區／malformed path 不猜測。新 upload 已 aborted 但 HTTP 晚到建立 object，也可由後續 sweep 對原 path/object ID 找出。Object ID 改變、重新被 metadata 引用等情況進 `blocked` 隔離，需額外確認身份，不自動刪掉另一個新物件。Provider 內部無 `storage.objects` 記錄的實體碎片不在此 SQL catalog 可觀察範圍，不能冒稱已掃到所有底層 S3 bytes。

可明確執行的 CLI **只接受隔離 loopback Storage**：

```powershell
# 只使用新建隔離 runtime 的 URL／service-role key；不使用 Hosted key。
node scripts/maintenance/budget-receipt-cleanup.mjs --local --watch
# 需在程序環境提供 RECEIPT_LOCAL_URL、RECEIPT_LOCAL_SERVICE_ROLE_KEY。
```

Production scheduling／secrets／觀測與 blocked job 處理必須另案授權。沒有 worker 就不滿足 activation gate，不把「有瀏覽器會補償」當成可靠清理。

## 實作檔案

| 層 | 修改檔案 |
| --- | --- |
| DB | 新 migration、`docs/qa/2026-10-30-budget-receipt-rollback.sql` |
| 協作／Storage | `src/lib/budgetReceiptGroups.js`、`budgetReceiptValues.js`、`budgetReceiptStorage.js`、`budgetReceiptConfig.js`；既有 `budgetPaymentGroups.js`／`budgetMetadataService.js`／`budgetSync.js` |
| 共用 UI | `src/components/budget/BudgetReceiptAttachments.jsx`、`BudgetWorkspace.jsx`、`src/App.jsx` 的現有 AttachmentList／BudgetPanel |
| Demo／worker | `src/demo/budgetReceipts.js`、`budgetMetadata.js`；`scripts/maintenance/budget-receipt-cleanup.mjs` |
| 驗證 | `tests/budget-receipts-cases.mjs`、`budgetReceiptGroups.spec.js`、`formalBudgetReceiptGroups.spec.js`、`helpers/budgetReceiptMock.js`；native harness／runner 新 `--receipts` 篩選 |

既有 `tests/formalBudgetReceipts.spec.js` 原樣保留。新測試曾一度覆蓋同名舊檔，差異檢查時已恢復並另取新檔名；原有安全斷言沒有移除。

## QA、發現問題與限制

最終逐案結果、native environment／blocking proofs、檔案 SHA、原55份 migration preservation 見 [選定 QA JSON](qa/2026-10-30-budget-receipt-results.json)。只跑 Receipt 與直接受影響範圍，沒有重跑舊186 native／373 frontend 全套。

- Native PostgreSQL17.11，每次新 initdb、loopback隨機port／marker、獨立 LOGIN/backend/JWT；**23/23**。4 個真實 overlap 觀察：同 Receipt admission 唯一 winner、Receipt＋Actual Title 同時成功、Payment／Source 與 Receipt 等待後 stale vector 拒絕。另驗 RLS／ACL／private bucket、錯誤 path／MIME／size、跨trip／撤權／tab／epoch、manifest deferred rollback、metadata第二筆故障、cleanup錯誤／object-ID隔離／worker重試、activation與unused reverse／used reverse拒絕、real v7 named-RPC Controller。
- 前端／Controller／Storage fault Adapter：**87/87**（Receipt Controller17、rendered UI8、既有 Receipt/Payment/Source/Snapshot 直接相依案例）；Receipt 記憶體檔案 body 及 journal 分開，測 upload ACK 不回應、單一 Storage transport、metadata失敗／已提交ACK遺失、cleanup不回應／失敗、snapshot逾時／晚到／ABA、reload無 capability、重選原檔案、保留操作離開、其他人／同帳號第二分頁唯讀。Formal 是本機 Auth/RPC/Storage mocks；Demo 共用 UI、memory object URLs，沒有外部 Auth/RPC/Realtime/Storage 或 persistent Receipt requests。Demo 沿用既有保守 global financial generation，不能當成精確 Hosted 吞吐／並行效能證據。
- 因實際改到 text guard／Undo capture，必要擴大至原有 Metadata SQL **23/23**、Undo SQL **28/28**，都是 PGlite 序列，**不是並行／Hosted 證據**。沒有大量重跑其他工作區／金融全套。
- 實際發現並修正：PL/pgSQL effect result／record-alias ambiguity；明細頁離開沒有經過 edit-only handoff；metadata ACK 與慢 cleanup 被包在同一 Promise 的風險（已拆為 afterConfirmed，保留已確認成功）；Source-enabled Actual title/note guard 提早 return，使成功 patch revision仍0、Undo無指標。最後一項在本次新 migration 以驗證後 boolean 豁免 linked wildcard，仍執行 revision loop 修正；沒有改舊 Source migration或降低授權。Undo successful Receipt 不進 inverse capture，避免 `missing_undo_before_image`，只清本 actor/tab 指標。舊 partial RPC 的 `undo_supported=false` 回應契約保留，實測 DB prototype 的 exact operation pointer／revision／immutable audit，而不把它當成 Undo 前端啟用。
- 最後檢查以新案例重現 UUID-shaped 畸形 orphan path 使 sweep 整批失敗（原生22成功／1失敗）；改用完整 canonical UUID regex，現在略過畸形路徑並繼續正常 inventory，最終23/23。Auth 拒絕或10s逾時也納入既有 Controller try/catch，顯示 inline 失敗、沒有建立 intent，恢復後允許明確重試；新增 Controller case 確認。
- 歷史 origin-only fixture 初次嘗試直接寫 origin，被原 Trigger 還原；改成先合法 legacy link 再 unlink，明確證明 origin保留／新寫入拒絕。沒有放寬 graph 或移除成本保護以通過測試。
- Build／changed JS/MJS syntax／`git diff --check` 通過；既有 >500KB chunk advisory保留。UI 1440×1000、Browser plugin unavailable，沿用既有 Playwright Chromium；確認正確頁面、無blank／Vite overlay、無console/pageerror、上傳→替換→刪除與失敗恢復互動。截圖在 workspace外 visualizations，不提交測試財務畫面。
- **沒有真正 Storage HTTP／Hosted RLS／Signed URL下載／provider bytes／Realtime真帳號／worker部署認證**。原生 SQL stub 驗證 policies；可控 Adapter 驗證跨系統生命周期；不能混稱正式 Storage 安全驗證。本階段未重跑先前已知 loopback CLI Advisor TLS失敗，沒有新的Advisor certification。

未使用且未 activation 的 reverse 精確恢復前版函式/grants/policies/原資料；有 intent／job／成功使用或activated latch即拒絕，需forward repair。新Protocol與所有frontend flags仍預設關閉。Source未定義歷史轉換、retained category/payer一般同步、正式空白新增／Actual刪除、五步Undo前端、其他頁附件改版、正式啟用均未開始。

官方依據：Storage [RLS access control](https://supabase.com/docs/guides/storage/security/access-control)、[schema 與實體物件分離](https://supabase.com/docs/guides/storage/schema/design)、[operation-aware helpers](https://supabase.com/docs/guides/storage/schema/helper-functions)；[標準上傳 preflight](https://github.com/supabase/storage/blob/master/src/storage/uploader.ts)、[operation名稱](https://github.com/supabase/storage/blob/master/src/http/routes/operations.ts)、[signed-upload發行](https://github.com/supabase/storage/blob/master/src/http/routes/object/getSignedUploadURL.ts)。查閱日期2026-10-30，沒有升級套件或據此宣稱 Hosted 相容。
