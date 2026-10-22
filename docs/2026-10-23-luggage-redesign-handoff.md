# 行李頁完整改版｜研究、設計與驗收交接

日期：2026-10-23。分支：`codex/luggage-workspace-redesign`，從已推送的 `95e3a83` 延伸。本輪完成本機實作；使用者於 2026-10-23 授權提交並推送此功能分支。未合併 main，也未部署前端或套用線上 migration。

## 現況分析與研究範圍

先查看實際 `/demo/luggage` 畫面與資料流程。舊頁的頂部摘要與清單進度重複，新增表單較分散，缺少搜尋與狀態篩選。桌面近 1:1 雙欄未反映公物的分工資訊量；手機沿用桌面 Shell，側欄把主要內容推到首屏之外。原本編輯者可以代替其他負責人勾選打包；全頁編輯權限又阻止已核准 viewer 管理私物與公物。後端狀態保護也需要同步更新，不能只停用按鈕。

參考的是官方公開產品介紹、產品圖與說明文件；沒有登入或購買產品，不將公開資料當成實際操作驗證。

| 參考 | 可借鑑 | 本輪取捨 |
| --- | --- | --- |
| [PackPoint](https://www.packpnt.com/) | 將旅程需求整理成可勾選清單，支援自訂物品 | 採清單與分類，不加入天氣／活動推薦引擎 |
| [PackParty](https://pack-party.com/home)、[官方 App Store 說明](https://apps.apple.com/us/app/packparty-group-packing-list/id6737479623) | 共用清單、指派、類別與打包狀態，避免重複攜帶 | 公物只有一筆來源；不採免登入公開協作，保留旅程成員權限 |
| [Todoist 官方說明](https://www.todoist.com/help/todoist/features/introduction-to-projects-TLTjNftLM) | 分區整理、清單內快速新增，常見操作容易到達 | 常駐新增與分類、搜尋、狀態篩選；不做專案管理看板 |
| [Packup 公開網站](https://packupapp.com/) | 已納入檢視，但公開頁無可擷取的功能文字 | 不據此推論協作、離線或權限能力 |

套件盤點：既有 React、lucide-react、MenuSelect、草稿保存及編輯鎖足以完成。dnd-kit 雖已安裝，但沒有值得新增拖曳／排序資料模型的高頻需求。本輪沒有新增相依套件，也沒有導入元件框架。Supabase [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes) 文件用於檢查既有訂閱與 RLS 邊界；不改用另一套同步通道。

## 最終設計與操作

1. 桌面採約 4:6 雙欄，森林綠、紙色、現有字體及語意 token。刪除重複的頂部摘要，將進度放回各清單。
2. 個人欄顯示自己的私物，依分類整理；「我負責的公物」以淡色區塊獨立呈現。我的進度合計私物與指派給我的公物，不把總召確認誤算為個人打包。
3. 公物欄明確列出負責人，以及「成員打包 → 總召確認」兩階段；另顯示兩條真實進度。未指派物品與已離開成員會提示重新指派。
4. 常駐快速新增，Enter 提交；選單可選分類，也可直接輸入自訂分類。名稱、分類與指派的修改使用同一表單，儲存失敗保留輸入。取消／切換編輯與離開頁面沿用 Save / Discard 保護。
5. 搜尋物品、分類或公物負責人；個人可篩全部／未打包／已打包，公物可篩未指派、未打包、待總召確認、已確認。篩選不改進度的完整分母。
6. 手機在個人／團隊頁籤切換，兩個表單草稿均保留。頁籤支援方向鍵、Home、End；主要控制與選單選項至少 44px。只在可見行李頁套用手機 Shell 修正，其他 Formal 隱藏分頁不受影響。
7. 沒有資料、搜尋無結果、未指派公物各有不同提示。刪除要確認；有進行中的編輯時先結束編輯，再根據最新資料刪除。

## 狀態與權限

| 動作 | 權限與結果 |
| --- | --- |
| 私物查看／新增／修改／刪除／打包 | 旅程已核准成員，只能操作自己的資料；總召也不能查看他人私物 |
| 公物查看／新增／修改／刪除 | 同一旅程所有已核准成員，包含 viewer |
| 公物打包／取消打包 | 僅目前負責成員；不能由總召代勾。取消後清除總召確認 |
| 總召確認／取消確認 | 僅 `trips.owner_id`；確認前需已指派給目前已核准成員且已打包 |
| 修改名稱、分類或負責人 | 實際值有變動時，清除打包與總召確認，需重新檢查物品 |
| 同內容儲存 | 不重設狀態 |
| 重新指派／取消指派 | 保留同一筆公物，兩階段重設；個人欄即隨來源資料移動／移除 |
| 過期版本、外人編輯鎖、跨旅程 | 拒絕寫入，保留草稿；版本衝突後讀取最新清單供重試 |

## 程式與資料

- `src/components/luggage/LuggageBoard.jsx`、`luggage-board.css`：獨立畫面與響應式樣式；不處理正式資料寫入。
- `src/App.jsx`：保留並更新 `LuggagePanel` 草稿／鎖控制器；正式寫入統一走 RPC，Demo 用隔離記憶體狀態。個人／旅程資料在進入畫面前再次嚴格過濾。已移除無呼叫處的舊 `LuggageView`，不再保留另一套 Demo 行李介面。
- `src/components/MenuSelect.jsx`：僅增加可選的 popup class，讓行李選項有 44px 點擊高度；既有預算選單預設樣式不變，同寬與 4px 捲軸沿用。
- `src/lib/luggageService.js`：共用狀態轉換、錯誤文案與 `mutate_luggage_item` 客戶端。
- `luggage_items` 是私人清單；`shared_luggage_items` 是公物唯一來源。歷史 `shared_item_id`／`is_shared_assigned_item` 副本保留原資料，但不作為第二套可獨立勾選的狀態。
- `pack_items` 為獨立歷史／Today checklist 流程，並非上述公物副本。本輪不合併、不刪除或重寫它，也不改動其既有回呼。
- `supabase/migrations/20261022162015_luggage_collaboration_state_safety.sql`：以 CLI 產生檔案名；調整公物 RLS、驗證 trigger，新增 invoker RPC 與精確 `updated_at` 比對。沒有新資料表或資料欄，不移除／重寫既有資料。保留既有 Realtime publication 與 replica identity。
- 公物每次編輯／勾選／確認均在同一資料列交易內處理。既有 Postgres Changes 訂閱仍依旅程重新載入；RPC 成功與版本衝突另重新抓取清單，避免依賴事件必達。新 RPC 缺少時不退回不安全的直接寫入，表單保留並提示更新資料庫。

## 自動驗證

- 全套 Playwright：431/431 通過（1.1 分鐘）；包含原有 413 項與 18 項新行李測試。
- 最終取消草稿保護、44px 選項及手機鍵盤頁籤的追加測試：相關 34/34 通過（19.0 秒）；新行李測試共 19 項，全部測試目前 432 項。
- 離線 PostgreSQL：完整 migration chain + 65 項行李斷言通過。涵蓋角色權限、私物隔離、重新指派、內容修改、取消狀態、成員撤銷、版本／鎖／跨旅程、anon、直接資料表防護與既有資料 JSON 保留。
- 瀏覽器情境：桌機 1440、平板 820、手機 390，長清單與空清單；兩個測試頁面透過 BroadcastChannel 模擬資料更新，驗證同筆公物在不同使用者畫面的狀態一致。
- 真實 Demo 1440／390 smoke：有主要內容、無錯誤覆蓋層、console/page error 0；未發出 Supabase/Auth/Storage/Realtime 請求，未寫 draft／lock localStorage。
- Build 與 diff check：通過；既有 Vite >500KB chunk 提示仍存在，未新增套件。
- Browser plugin 未安裝；依使用者明確要求採專案 Playwright E2E。另於既有 IAB 頁面查看改版前畫面；已檢視改版後桌面、手機個人與公物截圖。

## 驗證界線與人工驗收

沒有登入真實成員、沒有正式資料修改、沒有 hosted migration／deployment。離線 PostgreSQL 與測試傳輸不能證明正式 Realtime 網路或所有實機瀏覽器均正常。

本機 Supabase 未啟動（54322 無法連線），CLI security advisors 未能執行；離線 catalog 檢查已確認 invoker、RLS、publication。上線前需對目標測試環境套用 migration 並執行 advisors。

人工驗收建議：

1. 本機使用 `/demo/luggage` 檢查分類、文字長度、搜尋／篩選與手機雙頁籤。
2. 在經授權的測試資料庫，分別以總召、負責人、viewer 三個真實帳號登入；確認私物互不可見，公物全員可改。
3. 負責人打包後總召確認；兩端交替取消、修改、重新指派，檢查 Realtime 是否即時同步，以及斷線重連後能否取得最新資料。
4. 用真實 iPhone／Android 檢查鍵盤、選單、底部安全區及背景切回；本輪響應式模擬不等同實機驗證。

部署順序：目前所有未套用 migration（包括前一輪兩份 Budget migration）須先於此版前端部署。僅檔案已準備，禁止將本文件解讀為線上已啟用。

後續可選：多項貼上新增、複用既有清單、個人分類排序；本輪不新增拖曳排序、數量、離線寫入佇列或 AI 推薦，以免增加資料與衝突處理成本。
