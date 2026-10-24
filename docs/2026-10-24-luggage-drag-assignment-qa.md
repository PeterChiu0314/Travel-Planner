# 行李單一新增與拖曳指派驗證 — 2026-10-24

## 最新精修：雙向轉換先確認

- 私物放到成員區：先顯示「轉為團隊公物？」網站Dialog；確認後公開名稱／備註並指派，取消不寫入。
- 公物放回個人分類：先顯示「轉為個人物品？」網站Dialog；確認後從團隊及原負責人的個人投影移除，轉成操作人的私物，名稱／備註保留，使用目的分類，打包重設。
- 右側成員間改派維持直接操作。空分類與未分類在拖公物期間提供接收區。手機拖至個人頁籤可切回分類，鍵盤左右鍵切欄、上下鍵選目標。
- 新增20261024063828_luggage_private_return.sql，以security invoker RPC做同UUID新增私物＋移除公物的單一交易；不修改RLS或資料表結構。
- 新增9項E2E；最終完整101/101通過，約1分鐘。資料庫114項離線檢查通過，涵蓋反向版本／鎖／權限拒絕、私人隔離、往返轉換、資料碰撞及刪除失敗回滾。Build／diff通過，原有bundle advisory保留。
- 曾發現dnd-kit在drop後50ms攔截document click，可能吞掉第一下確認；改為等清理後再開Dialog，失敗重試重複4次及全套測試通過。
- IAB實際驗證相機：私人 → Dennis公物 → 個人未分類，出現兩種確認且成功後右側消失、左側可見；Demo資料已重新載入還原。桌機對話框證據：luggage-convert-public-dialog.png、luggage-convert-private-dialog.png（同下方證據目錄）。
- 最新驗證以本節為準，下方為前一版單向流程驗證紀錄。兩個20261024 migration皆尚未套用正式Supabase；無commit、push、部署或main合併。正式多帳號Realtime及實體手機長清單拖曳仍待人工驗收。

## 前一版驗證紀錄

## 修改摘要

- 僅保留左側個人快速新增；移除團隊新增列及負責人選單，不新增成員群組按鈕。
- 私人物品拖至成員或未指派區才轉為公物。拖曳預覽說明名稱、備註將供團隊查看；原分類與備註保留，打包重設。
- 右側公物把手支援成員間改派或取消指派；包含空成員接收區。左側公物無改派選單，兩側名稱與備註引用同一筆公物。
- 取消、同負責人與區外放置不寫入，失敗保留原資料。手機拿起私人項目時切至團隊接收區，取消或失敗回原頁籤；鍵盤以空白鍵、方向鍵、Escape操作。
- 移除的團隊新增草稿在沒有競爭私物草稿時恢復為私人新增內容，否則保留原儲存；不自動發佈。

## 環境與路徑

- 本機Vite：http://127.0.0.1:5174/demo/luggage。
- Browser plugin及其browser skill未提供（Browser plugin not available）；使用專案既有Playwright執行回歸，並使用CUA操作使用者原有IAB預覽，未控制其他瀏覽器。
- Chromium自動化涵蓋360/390/820/1440px；IAB保留原桌機尺寸，另以390×844檢查手機，再還原尺寸。
- 主要互動：個人新增／既有項目 → 拖曳成員接收區 → 公物轉換及個人投影更新；右側把手 → 另一成員／未指派 → 改派；失敗 → 原項目保留 → 立即重試。

## 結果

| 檢查 | 結果 |
| --- | --- |
| 頁面標題、URL、有效內容 | 通過，旅程工房與行李清單正常呈現 |
| Framework錯誤浮層／空白畫面 | 未發現 |
| Console | 有一筆先前預覽服務重啟時的Vite HMR websocket錯誤；重新載入後未新增應用例外 |
| 實際桌機互動 | 以鍵盤把Demo相機移至Dennis接收區，出現「已轉為團隊公物，由Dennis攜帶」；重新載入恢復Demo資料 |
| 手機互動 | 390px鍵盤、CDP觸控拿起／取消／轉換通過；IAB團隊畫面檢查完成 |
| Playwright | 最終92/92通過，57.1秒；涵蓋行李及住宿／待辦／預算／分帳工作區回歸 |
| 失敗後立即重試 | 曾發現返回動畫浮層攔截滑鼠，改為pointer-events:none後重複5次及完整測試通過 |
| PostgreSQL離線 | 全migration鏈93項檢查通過，包含RLS、版本、私物隔離、轉換回滾、重複轉換、權限與既有相容性 |
| Build／diff | 通過；原有大bundle advisory仍存在 |

## 程式與資料

- LuggageBoard / LuggageInteractions / scoped CSS：單一新增入口、分類與成員接收區、滑鼠／鍵盤／觸控拖曳、同列公物編輯。
- App / luggageService：正式RPC路徑與Demo等價記憶體交易、草稿恢復與成功後的同筆公物投影。
- 新增20261024054121_luggage_drag_assignment.sql，建立security invoker的assign_luggage_item。私人轉公物以同UUID插入及刪除置於單一交易；精確版本、編輯鎖、旅程、來源本人及接收成員權限皆驗證，不提供直接寫表降級。
- 不新增資料表／欄位或依賴，不更動現有RLS與Realtime publication。

關鍵驗證命令：npm.cmd run build；npx.cmd playwright test（luggageDragAssign、luggageAssignedEdit、luggage、luggageAutosave、luggageCategories、luggageNotesDrag、luggageQuickEdit、luggageRowEdit、luggageTeam、travelWorkspace），--workers=2；node tests/luggage-database.mjs；git diff --check。

## 尚待驗收與發佈界線

- 新migration尚未套用正式Supabase；正式的拖曳轉換／改派必須先套用它，缺少RPC會安全拒絕，不會刪掉原私物。
- 多人同步測試使用隔離fixture的BroadcastChannel與離線RLS，並非已登入多帳號的正式Realtime驗證。
- 仍需人工以真實手機驗收長清單觸控拖曳、自動捲動與不同瀏覽器手感；手機分類轉移仍可點私人把手使用既有分類選單。
- 本輪未commit、push、部署或合併main。既有20261022162015協作與20261023120000備註migration已於前一任務套用；本輪沒有遠端寫入。

## 實際畫面證據

檔案位於Codex visualization資料夾：

- luggage-drag-assignment-desktop.png：拖曳至Dennis接收區，顯示接收區高亮與公開內容提示。
- luggage-drag-assignment-mobile.png：手機團隊清單，不再顯示新增列或負責人選單。

完整目錄：C:/Users/PeterChiu/.codex/visualizations/2026/10/18/01a14c95-d406-7d33-b655-0a2c9de1460d/。
