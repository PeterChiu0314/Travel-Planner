# #19 — 單一新增入口與本機命名草稿

依 [Issue #19](https://github.com/PeterChiu0314/Travel-Planner/issues/19) 在原分支實作，供 Staging 手測。沿用 #18 單一支出、同一 editor／group lease／精確回執；沒有重新規劃資料模型。

- Formal／Demo 唯一入口為「＋新增項目」。新增只開原右側表單的本機草稿，正式表格／參與者／行程關聯零寫入；同一表單可填預算與實付，行前也可直接記帳。
- 名稱 trim 有效後才使用固定 expense ID／request ID 建立，只有名稱也可以。新項目 budget／paid 都是 NULL、payment_state=draft，不假造金額或已付款。合法 0 元保留。
- 空白／只含空白的草稿不觸發離開提示，關閉、取消、切頁可直接丟棄；有備註、金額或其他實質輸入但未命名，沿用頁面級「繼續編輯／不儲存／儲存」保護。未命名不能儲存，選儲存仍保留原表單。無欄位操作按鈕、成功 Toast 或空白草稿 Toast。
- 本機輸入與建立請求依 actor／trip 存在 sessionStorage；Demo 維持 memory-only。建立的未知回執不可放棄、改 ID 或改原請求；重送／重載確認同一筆，較晚輸入交回原 group editor。確定的業務拒絕不自動重播，保留輸入供修改或明確放棄。雙擊新增重用同一草稿。
- 建立確認前不取得財務 lease；確認 receipt 加 authoritative row 後轉交原欄位租約／版本保護，未確認不宣稱儲存成功。先前 #17/#18 協作色框、背景恢復與快照 fail-closed 維持。

## Staging Forward

僅 `uyqdopksfysbobhjcepk` 安裝 `20261105150453_issue19_named_expense_create.sql`，Ledger70。CLI 原產生時間為 `20261105145253`，managed apply 分配上述版本後只更改檔名；單一 ledger source 與本機 SHA256 同為 `28f9e0f62a9d2f34f1b3c566b3449a38614973f696e6b5d81db8abf93d958b3c`，已安裝來源不可改寫／重播。

新增 private `create_named_item` 與 authenticated-only public invoker `create_named_expense_item`，驗證 actor／trip edit permission、非空名稱，request signature 包含 title／trip／ID／session，advisory lock 保護重送與建立。原 private `create_item` 改成只恢復既有已提交回執，禁止舊客戶端再建立空白列；既有 public facade／權限維持，無財務資料重寫、刪除或模型變更。

Exact Forward 在 Staging transaction／ROLLBACK 先測試，獨立讀回確認新 API 不存在、原 Ledger69 與資料／函式指紋未變才 apply。安裝後再以兩名既有 approved QA actor 的 authenticated DB role 測試並 ROLLBACK：空白與 NULL 拒絕、名稱 trim、NULL 財務、重送相同回執、異內容拒絕、舊已提交回執可恢復、舊空白建立拒絕、B 可讀 A 新項目但不可重用其 ID、未登入／anon／private direct write 拒絕。這是 DB 角色驗證，不是普通 JWT／真實瀏覽器 WebSocket 認證。

安裝前後13組原資料指紋與 group lease 定義／OID／owner／ACL 相符。原69筆 ledger seal `8f400df0b8894c27a23dd70d88e77906`、排除本次預期修改／新增的 create 函式後，其餘 app 函式 seal `2d39ed71a591ecba08253ef79e0ca164` 均相符。Security Advisor 維持原25 INFO、8 definer WARN 與1 Auth WARN，沒有新增。未操作 Production／main，也未操作旁邊開啟的 Production SQL Dashboard。

## 驗證與交付

60個 Node／SQL 案例通過：原模型／schema／RPC／migration41、review5、collaboration6、本次creation8。26個 distinct Chromium 案例通過：24例整批通過後，另補 Demo 空白／未命名保護與真實隔離 SQL 建立 ACK 遺失後立即刷新、保留較晚輸入兩例通過。涵蓋同筆10000／9500、paid-only800、兩帳號三分頁與5人色框、背景 lease 恢復、Rates、Timeline／住宿連結、guard、合法0與斷線重載。最初環境無 Browser plugin，使用 repo Playwright；sandbox localhost 不通後將 Vite／Chromium 放同一本機環境。Google Maps 本機網域限制用既有 static provider 排除，沒有修改地圖產品功能。Desktop1440×1000 截圖已檢視。Build／diff 通過，既有大 bundle 提示保留。

推送原分支後確認精確 SHA Preview READY，使用者重新整理原 Preview 手測；#19 保持 Open 待使用者驗收。不自行關閉 Issue、不新增 GitHub 留言、不合併 main／部署 Production。真實 hosted ordinary-JWT 多人瀏覽器驗收仍未冒稱完成。
