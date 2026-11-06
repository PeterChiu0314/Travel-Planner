# Issue #21 — 各自付／代付與多位付款人

依 [#21 定案規格](https://github.com/PeterChiu0314/Travel-Planner/issues/21) 實作在原分支 `codex/budget-collaboration-redesign`。本交接優先於先前「概念圖／功能 deferred」及單一付款人的歷史描述。保留現有行前單一金額／分攤、側欄 footer、付款膠囊、真實儲存狀態與離開保護；沒有新增完成／取消、部分付款、付款流水、第三種付款方式或另一套行前實付表單。

## 實作

- 新項目預設各自付；不要求單一付款人。已付款時，各人已付與負擔統計均保留自己的份額，兩者相抵，不產生互欠轉帳。未付款不進已付款結算。
- 代付共用一張可增減列的表單，每位可選付款人與原幣整數金額；名單獨立於參與者。當前手動金額優先，超過總額則截到目標；其他列按較早修改順序／固定列序補差，不按比例重分配，不產生負數。目標是原預算總額四捨五入整數，預算本身的小數不變；編輯中空白留在草稿，不轉成已儲存0。
- `payer_sequence` 與每列 `order` 隨整份分配持久化，刷新／多人快照後仍使用同一補差順序。預算總額／計價／成員／幣別變動由原原子 mutation 同交易更新分配；payer 寫入另核對 budget／paid dependency revisions。更正已付款的行前金額／分攤會更新當前 paid bundle 與結算，不要求先取消付款。
- 各自付／代付、已付款／未付款切換保留代付設定；明確新增／移除列照使用者操作。DB 與 JS 各自實作相同整數補差，server 不依賴前端合計正確。
- 整份付款方式／金額／順序仍由一個 `payer` group、token／epoch／revision 及一次 mutation 管理。群組內選單 portal 與列間焦點不提前釋放。付款與金額等相依群組在 admission 就阻擋他人的交錯寫入，避免彼此持有相依租約後卡住；備註、分類等仍獨立。20秒 clean／60秒 dirty、5秒續租、背景釋放、未知回執與冪等保留；Rates60秒、selection45秒／15秒、API10秒不變。
- 財務 read projection 攜帶全部付款 credit，結算逐人計入，不再把全額只記在第一個 `payer_id`。原幣轉 TWD 的尾差按穩定列序收斂到既有 paid TWD 總額。結算明細顯示各自付或所有代付者；沒有重做旅程中／結算頁完整 UI。旅程中原有單人選單保持；新多人／各自付資料可正確查看。
- Formal／Demo 共用付款欄與計算，Demo 無 Hosted／持久草稿。補回新命名項目轉正式 editor 後的 dirty field autosave；Demo 不再把自己回傳的建立前舊快照重灌到剛取得的 lease，避免快速移動焦點時錯誤唯讀。

## Staging

僅 `uyqdopksfysbobhjcepk` 安裝 Ledger74/head `20261106120016_issue21_payment_allocations`。CLI 原產生 `20261106113616`，managed apply 分配上述版本後只對齊檔名。單一 stored source／本機 SHA256 同為 `b79df321b788f6a6aa216cf0f6359b8dd4776cd0647caf63ae3079d3b7ce98ec`；已安裝來源不可原地修改／重播。

局部擴充 private expense_items：payment_mode、payer_allocations JSON array、payer_sequence、planning_managed；無第二份付款名單或流水表。既有單人付款映射成一列，舊 monetary bundle／participants／ID／狀態／日期不變。安裝後14筆原項目中的10筆非空 payer 均已映射為相同使用者的單列；原財務值指紋不變。保留 scalar payer_id 作相容投影，各自付為NULL、多人僅為第一列；新結算一律讀完整 credit。舊單人客戶端不能覆蓋既有多列。

新增 normalize_payers／sync_payment 均不授權 PUBLIC／anon／authenticated 直接呼叫；替換原 lease、mutate、create_named_item，三者 OID36431／36432／36540、owner、ACL、SECURITY DEFINER、空 search_path 均保持。既有 table RLS／direct-write fence、public invoker facade 及 Rates 函式未變。

Exact source 先在真正 Staging BEGIN／ROLLBACK 試跑，以既有 QA 旅程的兩位 approved actor 切換 authenticated DB role：新建預設各自付、NULL財務、自付付款、代付700/300、重送完全相同回執、重複／負數／外人拒絕、B payer及相依budget admission拒絕但note可寫、改B600保留當次值、總額800.50保留小數且分配201/600、已付款直接更正、切自付／取消／再付款保留設定、private直寫拒絕與deferred constraints。全部fixture與DDL回滾，獨立30資料及ledger／非目標函式seals相同、新欄不存在，才apply；安裝後同角色斷言再跑並ROLLBACK。

安裝後30資料seals只有 public.expense_signals 預期變動，其餘相同；expense_items比對先排除本次新增四欄，完整保護原欄位。原73筆ledger seal `dd49ddc51b7381766ec443c8e611c99b`、非目標app函式seal `6868dcbf496b0578d0780380fef55f78` 保持。Advisor維持25INFO／8既有definerWARN／1既有AuthWARN，無新增。未改協定flags、Auth、Storage、Production／main。

## 驗證與交付

72個distinct Node／SQL Passed：70例整批與新增四人server獨立補差例1、舊scalar付款草稿／已提交未知request恢復例1；新增付款共8例，包含300次多列修改、四人16次直接SQL mutation與非參與者代付、0與小數／整數邊界、paid更正、self統計零轉帳、peer互斥與原request ACK恢復。34個distinct Chromium Passed：最後整批33例通過，剩餘一例修正測試對隨機A/B UUID排序的假設後單獨通過；最終受影響的付款＋Demo11例整批重跑通過。既有新增、原UI、22秒實際持有／續租、背景恢復、多人頭像、Rates、Timeline／住宿均有覆蓋。Build／diff Passed，既有大bundle提示保留。

Browser plugin未提供，使用repo Playwright／static maps／既有PGlite；1440×1000各自付／多人代付截圖已檢視。這些隔離SQL-backed瀏覽器與Hosted authenticated DB role不是普通JWT／真實WebSocket雙帳號驗收，仍交使用者在Preview手測。#21保持Open，不新增Issue留言／關閉，不操作Production/main。原分支Commit／Push後核對精確SHA Preview READY再交付；使用者原未追蹤檔案保留。
