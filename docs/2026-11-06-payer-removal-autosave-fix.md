# 付款人刪除卡住／側欄外第一下操作修正

使用者回報兩列付款人刪除一列後持續未儲存、切頁與重整被擋；另回報未先聚焦側欄時不能直接按新增付款人。原分支前端修正，沿用 Staging74；沒有 migration、RPC／租約／金額演算法或正式資料調整。

已重現根因：前一次 payer write 尚在傳輸時，較晚刪除觸發的1秒 debounce遇到既有saveWork直接返回。舊回執確認後雖保留較晚輸入，沒有重排autosave；持有租約的dirty field又不走tick的重新admit分支，所以永久停在尚未儲存，beforeunload／頁面guard仍有效。不是把guard關掉才能修好。

- 只在精確回執確認成功、尚有較晚revision且持有有效authority時排接續儲存；每個請求仍single-flight／原request-id恢復。未知回執不提前換request，非法／空白草稿不重試迴圈，不誤報已儲存。
- 頁面finish先等正在進行的舊write，再保存最新有效值並精確release；不拿舊write尚未涵蓋新輸入的false當成整個離開流程失敗。
- 新增／移除按鈕未聚焦時可直接點，先取得原payer租約再讀最新form執行；已持有租約時可繼續buffer較晚操作。peer-held／conflicted／unverified仍禁止。
- 增刪列後把焦點留在有效金額欄，避免原按鈕刪除／因達人數上限disabled時沒有blur，之後點側欄外仍能保存／釋放。移除依user ID而非過期index。

驗證：新增延遲回執的Chromium案例先重現「尚未儲存」失敗，修正後通過；新增4個SQL-backed控制器案例驗證接續revision、finish drain、無效draft不循環、unknown ACK原request重送後才送新revision。共29 Node／SQL通過；25 Chromium整批通過（包含第一下新增／移除、peer仍readonly、刪第一／第二列、直接重整不觸發beforeunload、原付款／草稿／Demo／住宿／Timeline）。Build／diff通過，既有bundle提示保留。Browser plugin未提供，沿用repo Playwright／static maps／PGlite；desktop截圖已檢視。

使用者開啟的Preview只讀檢視當時呈現一列與「尚未儲存」，console無error；未以重新整理丟掉現場內容。原分支commit/push後核對精確SHA Preview READY再交付。Production/main、Staging資料模型及使用者未追蹤檔案不動。
