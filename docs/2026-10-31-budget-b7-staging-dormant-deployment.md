# B-7 Staging Dormant Schema 部署嘗試與獨立讀回

2026-10-31，起點 `bb6274ad6b85246005aba3a207a86de0e8e68653`，分支 `codex/budget-collaboration-redesign`。唯一目標為`Travel-Planner-Staging`／`uyqdopksfysbobhjcepk`。本輪使用者明確授權指定15來源、必要DDL／Role／Grant／Policy／Trigger與ledger寫入，**不包含Activation、前端旗標、QA fixtures、Worker／排程或Production**。

## 結果

**部署未完成：BLOCKED／NO-GO，原因是SQL Editor的完整查詢大小限制。** 14:00左右僅嘗試一次完整封包，Dashboard顯示：

> Query is too large to be run via the SQL Editor

頁面要求改用直接資料庫連線。沒有分段、逐檔Commit、縮減／改寫／重新封存封包，也沒有重試或擴權。Supabase connector的唯讀SQL仍回覆project permission denied；目前亦無直接／Session Pooler連線憑證。依使用者「工具無法安全處理完整原子封包就停止」的指示，已停止所有部署動作。

**本輪取消備份P0門檻的決策已接受，僅限這個純測試Staging；不是備份通過，也不適用Production。** 沒有新增備份、重設密碼、升級方案或破壞性重建。現在的阻擋是執行通道，不再把未完成備份列為此Staging部署前置。

## 部署前最後核對：Passed

- 13:55:59，READ ONLY backend PID `66702`：current/session user皆為postgres，Ledger47／head20261031003000；版本／名稱／已知source Hash與既有封存一致。13個Hotfix body Hash一致，自訂40001=0，F0版本無碰撞，B-7及Worker role不存在。
- 八類Catalog Hash逐一相符：25tables/RLS、280columns、147constraints、83indexes、45triggers、57policies、82custom functions、21publication entries。原13表指紋一致；另保存**28份原始欄位／rowset Hash**（原public／private表及Auth.users、Storage.objects／buckets），只保留Hash與數量，不匯出使用者原始內容。
- 13:58:14，另一READ ONLY PID `66745`：17張封包保護表的強鎖權限、Auth TRIGGER／REFERENCES、Storage SELECT／DELETE WITH GRANT OPTION、schema USAGE轉授均具備；82個自訂函式無不可擁有項，完整function ACL摘要仍相符。Supautils policy_grants、角色memberships、default ACL及四個Storage policy皆符合前次觀測。
- active leases=0、其他開啟client transactions=0、prepared transactions=0。這是部署前觀測；真正安裝仍需原封包的保護鎖與timeout，沒有移除它們。
- 封包1,488,439 bytes，SHA-256仍為`4d43bddf6ed7853daa3008c51b58d76b868553330b919f885d82a200f546698b`。T0＋13個B-7＋F0精確順序、source ledger、38組compiled before/after及78個literal替換均通過既有離線checker；舊hotfix不重播。

## 完整送出與工具拒絕

在同一份編輯器文字前加入`SET app.b7_install_target='uyqdopksfysbobhjcepk'`及只讀的target／role／backend PID確認SELECT，再接**逐字不變的完整原封包**。總長1,488,629 bytes；envelope SHA-256為`65ed4826eccc11dffc184b6a4fda3d4a72eea31237e2ed1f8d73ad90b7d32975`。這個prefix不包含其他schema／資料操作。

載入後以編輯器全選／複製回讀核對完整文字；Windows剪貼簿將14,584個LF轉成CRLF，僅在比對剪貼簿表示時正規化CRLF，LF正文Hash與原檔完全相同，沒有重新封存或修改來源。取消文字選取後，只按一次Run並確認已授權DDL警告。工具隨即拒絕過大的query，沒有回傳部署backend PID或成功COMMIT結果。未點Save；編輯器保留的是unsaved草稿。

這是**通道拒絕，不是已完成部署再回滾**。沒有聲稱已執行同Session ROLLBACK，也沒有拿另一連線的ROLLBACK當證據。後續僅做新的唯讀交易，確認沒有已提交／部分套用的變更或遺留交易。原子失敗保護沒有被改成分段流程。

私有畫面證據保存在本機ignored的`.tmp-b7-dormant-deploy/deployment-size-rejected.png`；原始快照／診斷亦只在ignored目錄，不提交Git。選錄的非敏感證據見[JSON](qa/2026-10-31-budget-b7-staging-dormant-deployment-results.json)。

## 獨立驗收

另開Staging分頁，使用新的READ ONLY資料庫交易，**不使用部署回傳結果判定成功**。

| 項目 | 實際結果 | 判定 |
| --- | --- | --- |
| 新連線 | 14:02:03，PID66791，與部署前兩個PID不同，READ ONLY=on | Passed，獨立讀回 |
| Ledger | 47筆version／name／已知source Hash與部署前相同，head仍20261031003000 | **未達62，部署Blocked** |
| 15來源 | 14:04:44另一PID67460確認15個版本全未登記 | 未安裝，無部分套用 |
| 38終版函式／54PT409＋24PT500 | 37個新函式不存在，原legacy Save仍為既有版本；終版Hash符合數0/38 | Blocked，不能用離線結果當Hosted通過 |
| 舊13個Hotfix／自訂40001 | 全部body Hash及attrs不變；custom40001=0 | Passed，靜態讀回；未呼叫寫入RPC |
| Catalog／Function／RLS／ACL／Trigger | public／app_private八類Catalog、82個既有函式OID／Owner／ACL／SECURITY／settings及五個schemas的owner／ACL完全不變 | Passed，已比對範圍無意外變更 |
| Role／Grant／Storage policy | postgres屬性、所比對memberships、default ACL、Supautils policy grants、四個Storage policies相同；private raw client grants仍0；worker role不存在 | Passed，已比對範圍未擴權 |
| 原始資料 | 28/28份原始欄位／rowset指紋、數量完全相同，含Auth.users、Baseline及Storage metadata | Passed，無意外變更 |
| 原測試集合 | 2trips／1Auth user／25items／3alternatives／1Baseline，Storage objects0 | Passed |
| 遺留交易 | 無其他持有XID／idle-in-transaction項、prepared transactions0 | Passed，無遺留開啟／aborted交易證據 |
| 七組Protocol／Latch | 七張協定表全不存在，未建立或啟用任何latch | **未Activation；不是已安裝後讀到七組false** |
| 前端flags | 兩個tracked opt-in config未改；本機`.env*`／process沒有VITE_BUDGET opt-in | 維持預設OFF；未讀改Vercel配置 |
| 既有B-7 Preflight／Readback | 所需B-7 schema不存在，無法做部署後驗收；未重複執行注定失敗的B-7依賴SQL | Blocked，未標Passed |
| Managed Advisor | 部署前及拒絕後重新載入皆0errors／9warnings／2infos | 顯示結果無計數差異；未套用修正或宣稱新完整安全審計 |

Advisor仍為前次記錄的八個受控SECURITY DEFINER API、洩漏密碼保護disabled及兩個private RLS無policy提示；沒有新增B-7物件可供Advisor認證。既有警告的分析見[最終預檢](2026-10-31-budget-b7-staging-final-predeploy-verification.md)。

## 下一步與停止點

**Dormant部署／Activation／H01～H03均NO-GO；完成本輪讀回後停止等待ChatGPT Review。** 本輪沒有發現新的資料／Catalog drift，沒有Migration SQL錯誤證據；阻擋是完整SQL的可用執行通道。

既有指定Staging DDL授權已記錄，**不要求重新確認相同範圍**。下一輪需先具備能以同一Session、ON_ERROR_STOP語意處理完整封包的通道，例如由擁有者在已有安全連線的原生DB client執行，或提供Git外受保護的既有連線設定；若需要重設憑證、擴大connector權限或額外權限，另提具體方案，不在本輪自行操作。此處沒有建立新連線或繞過SQL Editor限制。

重新執行前仍須確認原分支／封包Hash、即時Ledger47／hotfix／Catalog／保護指紋及維護時窗。精確封包及Hash不變，不用`db push --include-all`，不採逐檔提交，不省略ledger／鎖／Guard。不能因純測試資料可拋棄就清庫、重建或更動latch。

未完成且**未開始**的H01～H03：H01真Auth雙帳號／雙tab、PostgREST／Realtime及跨群組競爭／Undo／ACK恢復；H02真Storage HTTP、Signed URL、內容完整性及mixed-client保護；H03專用Worker JWT／headers、最小權限、至少兩輪排程與故障恢復。這些均需後續獨立授權，不能隨Dormant重試順便執行。

本輪只更新交接、選錄證據及Runbook。原SQL封包、manifest／seals、全部61個active migration與產品程式未改；沒有備份／Auth憑證／原始診斷日誌進Git。離線checker、文件連結與diff檢查通過；未重跑不受影響的歷史測試或Build。
