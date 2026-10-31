# B-7｜Staging 憑證授權與記憶體執行交接

2026-11-01，原分支codex/budget-collaboration-redesign，起點041ecbd4023a03371914294c4285de8332f6a5f2。接續[完整收尾](2026-10-31-budget-b7-closeout.md)，不是新增子階段。使用者已明確授權讀取Travel-Planner-Staging／uyqdopksfysbobhjcepk的既有管理API key與JWT signing secret，僅本機記憶體初始化QA／簽發最長15分鐘專用Worker JWT；不保存、不輸出、不提交Git、不操作Production。這項授權已足夠，不再要求同一份權限確認。

## 已完成與實際限制

- 從指定Staging的官方設定頁讀取既有Legacy anon／service_role與「Legacy JWT secret (still used)」，只在記憶體核對project ref／role以及HMAC簽章相符；沒有建立、輪換或停用key。秘密值未出現在工具輸出、命令參數、檔案、Git、截圖或報告；頁面已關閉，主key／signer／Worker JWT參照已清除。
- 曾在記憶體簽發一枚900秒、專用role=budget_receipt_worker的JWT，尚未由真實服務驗證，**不標為Worker HTTP通過**。沒有以service_role替代普通使用者或Worker驗收。
- 瀏覽器控制程序的直接HTTP失敗；唯讀診斷為原生WebException／NameResolutionFailure，尚未送出Auth請求。核准的原生terminal public health請求可連到Staging，回401（未帶key的預期保護結果），只證明網路可達。
- 嘗試的限目前Windows使用者named pipe在該隔離環境內ready，但外部原生client仍ENOENT。兩次受控交付失敗後停止該路徑，沒有改成暫存金鑰檔或剪貼簿交付。環境隔離是已觀察限制；沒有聲稱已定位Windows內部namespace實作。
- Windows自動化工具拒絕啟動PowerShell，明示product policy blocks this app。沒有改用Run dialog、其他app或UI輸入繞過。**真正剩餘步驟是使用者自行啟動本機助手，不是還缺同一份Staging授權。**
- 未執行Hosted Migration、Activation、readiness寫入、Worker排程、QA資料初始化或Production操作。除公開health探測外，沒有新增完成的Auth／Storage／Worker驗收。本輪不重跑先前已過27／136／10等無關歷史套件。

## 可直接執行的本機助手

在一般Windows PowerShell自行執行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "D:\Codex\Travel-Planner-Git\scripts\qa\start-b7-staging-memory.ps1"
```

這是執行單一已檢查本機腳本的process參數，不修改全域Execution Policy，不需要管理員權限。請勿把key放在命令列或聊天。兩個遮蔽欄位不是Supabase登入密碼：

1. Project Settings → API Keys → Legacy anon, service_role API keys：既有service_role。
2. Project Settings → JWT Keys → Legacy JWT Secret：既有Legacy JWT secret。

按Connect Staging (memory only)，保持該PowerShell開啟，再回覆已連線。啟動只做普通的本機簽章核對及Staging既有QA身分唯讀GET；不建立測試資料、不執行SQL或啟用協定。

助手以遮蔽Windows Forms收取，經redirected stdin交給同一原生Node程序；不把key放入檔案／環境變數／CLI參數／stdout。公開anon由既有.env.staging.local讀取，並以同一secret核對兩把Legacy key的簽章與ref／role／expiry；master secret不傳給測試module。專用JWT固定Staging issuer/ref／role、900秒，到期可在同程序重新簽發；沒有任意角色／專案／長效JWT簽發入口。

現有QA manifest只用於核對指定帳號ID與qa_run標籤，不能當成業務授權來源。RLS／會員權限驗收仍必須使用實際普通JWT。啟動的Auth讀回失敗就blocked並釋放key；成功才在.tmp-b7-live/status.json記錄ready／authLookupStatus200，該檔不含憑證。每次operator有新ID，過期request檔不會誤觸發；受控module只允許該ignored目錄內的安全檔名。

程序最長50分鐘、每枚Worker JWT最多15分鐘。正常stop／啟動失敗會清除signer Buffer與憑證參照；中止launcher會終止它自己的Node child，不影響其他專案。這是參照清除／Buffer歸零，不承諾可鑑識證明所有runtime暫存記憶體已立即擦除。沒有持久secret manager或常駐排程安裝。

## 程式與驗證

- [遮蔽launcher](../scripts/qa/start-b7-staging-memory.ps1)：PowerShell AST語法檢查通過。因產品政策，agent未完成正常桌面GUI驗收，不把syntax當GUI啟動通過。
- [記憶體operator](../scripts/qa/b7-staging-memory-operator.mjs)：Node syntax通過；只在Staging固定endpoint做QA GET，初始實際Auth結果待使用者啟動。
- [受限簽發provider](../scripts/qa/staging-worker-credentials.mjs)、[兩項測試](../tests/budget-staging-credentials.test.mjs)：合成secret驗證錯project／role／expiry／簽章拒絕、固定900秒workerrole、stop後Buffer歸零及不能再次簽發。2／2通過，不是服務驗收。
- 與既有Worker adapter四項本機安全測試合跑6／6通過；沒有進行真實claim／Storage transport或排程。

## 接續順序

讀取status.json的operatorId／ready及authLookupStatus200；重新做新鮮Staging64筆ledger／38函式／原28資料／七OFF／RLS／ACL／Worker／Storage／租約與queue Preflight。所有憑證只留該Node程序記憶體，普通Auth與Worker各用正確JWT；去敏結果才寫檔。

隨後沿[連續Runbook](operations/budget-b7-closeout-runbook.md)完成QA登入、over10MiB實際HTTP階段診斷、正確的Worker能力canary／兩輪／恢復、具備真證據才Activation、合法Incomplete child負向及完整雙Browser E2E。不偽造readiness或重播Dormant。沒有另造逐階段Review門檻，Production／main／Vercel／Docker／WSL仍禁止。

**狀態：授權已取得；原生記憶體助手等待使用者自行啟動。Activation／Production仍NO-GO，真實服務矩陣未變。**

官方設計依據：[Storage Custom Roles](https://supabase.com/docs/guides/storage/schema/custom-roles)、[JWT Signing Keys](https://supabase.com/docs/guides/auth/signing-keys)。使用既有Node crypto的HMAC-SHA256與timingSafeEqual，不安裝新套件、不自創加密演算法。
