# Issue #23 跨模組隔離與行程支出一致性

本次接續 `a564829`，依 #23 的架構與優先級補充實作。大型頁面拆分另行安排。

## 所有權與故障範圍

| 操作 | 資料所有權 | 相依契約 | 故障處理與證據 |
| --- | --- | --- | --- |
| Timeline 拖放、編輯、固定、交通、備案 | itinerary_items 與原 Planner | 排程 application service，完整 Day manifest／updated_at／Presence | 移除跨工作區 Guard 查詢。原 Planner 規則保留。正式工作區掛載支出和匯率後完成拖放並重整。 |
| 支出連結景點 | expense_itinerary_links | SQL 交易將 source slot 對應到 destination slot | 支出 ID、金額、分攤保留，連結與 links revision 同交易搬移。相鄰、非相鄰、三卡循環、多對多與未排時間排序均測試。 |
| 支出連結與拖放競爭 | 支出 links group 與 itinerary version | 原 expense-trip advisory lock、links group revision、每個所選景點的 updated_at | 連結先提交時隨景點搬移。拖放先提交時拒絕舊畫面的連結意圖。已提交的相同 request 仍回傳原回執。原生 PostgreSQL 雙連線驗證兩種等待順序。 |
| 刪卡、縮短旅程 | Trip／Timeline | 原權限、原 confirmation 與原子刪除，trigger 解除失效連結 | 保留支出與金額。受影響 links revision 遞增，過期草稿無法重建已失效關聯。 |
| 刪除整趟旅程 | Trip owner 與既有旅程刪除政策 | 原 DELETE RLS／舊財務防護，加上同旅程 native graph cleanup | 清除同旅程支出、連結、參與者、groups、receipts、rate lease、signal。其他旅程保留。既有歷史資料防護仍先執行。 |
| 行程、住宿、待辦、指南、行李載入 | 各自的公開資料表 | 原 request scope／account-trip generation | 預算 refresh 獨立執行。Budget 逾時或拒絕時，成功的其他資料照常顯示與更新。 |
| 預算載入與離線草稿 | Budget controller／financial snapshot | 原 coalesced refresh、cache、request receipt | 預算錯誤維持 unverified，允許獨立重試。42501 清除財務資料。預算請求卡住的正式介面測試通過。 |
| 同頁新增、行李拖放／指派／移轉 | 個別 workspace controller | 中立 Guard 的明確 workspace scope | 只交接同工作區表單。乾淨預算租約清理失敗不會阻止這些操作。 |
| 切頁、換旅程、建立旅程 | app navigation | 中立 trip scoped Dirty／Pending／Unknown handoff | 真正草稿與未確認寫入仍保護。取消離頁保留原值，未知建立重試相同 request ID。 |
| 旅程日期 | Trip 與 Timeline 草稿 | 原日期／縮短驗證 | 支出草稿與未知支出建立不再控制日期許可，草稿仍留在原控制器；Timeline 草稿繼續受保護。 |
| 靜態地圖下新增行程 | Timeline／Map | Map provider capability | 靜態 provider 直接開啟行程表單，實際地圖 provider 沿用選點新增流程。 |

## 實作

- `src/lib/timelineScheduleService.js` 為排程提交入口。前端呼叫 `apply_timeline_schedule_operation_link_safe`，資料庫尚未安裝時顯示服務更新提示。此 adapter 不讀取預算快照或預算內部 state。
- 新 migration 包裝原排程 private function，原 planner 持續負責 manifest、固定邊界、交通、版本和重大影響確認。安全入口和既有 public 入口共用相同後端交易。
- 連結修改在顯示選取時記錄 itinerary versions，與草稿和未知 request 一起保留。Server 在原 request-id replay 檢查之後，才對新寫入驗證所選 ID 與版本。舊版尚未提交的無版本連結意圖會要求重新選取。
- 排程與支出 mutation 使用同一把旅程交易鎖。刪卡 RPC 在取得項目鎖前取得這把鎖，縮短旅程也沿用相同順序。Trip DELETE 已先鎖 parent，採 try-lock 和 NOWAIT，避免等待需要 parent 的 writer。

## 驗證

- 原生 PostgreSQL 17.11 的兩個真實連線通過三項競爭驗證，查核 blocking PID 後才放行提交。測試 cluster 僅綁定 loopback，執行後停止。
- 隔離完整 migration chain 的八項 SQL 測試涵蓋金額保留、三種 permutation、多對多連結、未排時間、過期選取、精確 replay、刪卡／縮短、越權與旅程刪除。
- 第一批跨頁／日期／快照回歸 23/23。較大批次 137/138，唯一失敗為原測試要求 RPC 字串留在 App，已更新為檢查 application service 入口與安全 RPC。後續重點批次 54/54。
- Browser plugin skill 未列出，隔離回歸使用既有 Playwright Chromium、static maps 與本機測試帳號。Hosted 試跑、安裝與 Preview 實測狀態以下方交付紀錄為準。

## 交付紀錄

Staging `uyqdopksfysbobhjcepk` 已安裝 Ledger75/head `20261106181006_timeline_expense_link_integrity`。Hosted 安裝前同來源回滾試跑及安裝後 authenticated-role 回滾驗證均通過。安裝記錄 SQL 與提交來源逐字相同（移除檔尾空白）；本機檔案 SHA256 `21f6abf70e0f90fc4074c408cfddb60da27347fe8234c9f1be23dccc076a4472`。五項資料 seal（trips、itinerary、expense_items、expense_participants、links）與安裝前相同。Security Advisor 維持既有25 INFO／9 WARN，沒有新增項目。最後96/96 Node／SQL 測試與 Build／diff check 通過。Preview 發布及 Hosted 瀏覽器驗收待記錄。
