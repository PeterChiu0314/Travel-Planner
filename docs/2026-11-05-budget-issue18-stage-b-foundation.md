# #18 隔離 B｜首批模型與 schema 基礎

本批依已讀取的架構Review及使用者最新再確認執行：[修訂契約](2026-11-05-budget-issue18-single-expense-review.md)。不是完整B、更不是Staging切換或可供線上手測的新UI。

## 已實作

- `src/lib/expenseItems.js`：單一ID，兩個獨立金融bundle與參與者決策；版本檢查、首次付款seed、取消再付款保留原paid值；NULL不等於合法0。budget ABC三人／paid AB兩人後再改budget，paid保持不變。
- 新成員僅對已知未付budget集合提出本機候選，自訂新人0、既有排除保留，不修改來源物件；paid集合與已付款資料不自動擴張。這尚不是Hosted持久化或UI完成。
- Actual匯入純投影不讀舊Budget／Origin，不補時間、金額、分攤；用既有 `settlementBalances` 驗證有效總額、paid/shouldPay/balance及incomplete一致。無時間、legacy小數TWD、custom缺份額、未知payer、已取消、未完成案例保留原行為。這是fixture證據，未盤點／匯入真實Staging。
- `expenseCommandQueue.js`：單一待確認request、並行transport合併、原payload/request-id重試；必須由呼叫方提供權威回執驗證器，不接受只有相同ID但未驗證的回執。沒有租約授權能力、沒有Hosted transport、沒有新逆向Undo。
- `docs/operations/issue18/isolated-schema.sql`：僅供disposable DB的 `expense_stage_b` namespace。三表無Baseline；兩個selected可獨立表示NULL/false/true、同trip連結約束。RLS僅讀；authenticated無DML、anon無schema權限，未建立可寫RPC。沒有改已安裝Migration、現有schema鏈或新增Feature Flag。

## 驗證範圍

命令：設定 `PGLITE_MODULE` 指向既有、Git外測試runtime，再執行 `node --test tests/expenseItems.test.mjs tests/expenseSchema.test.mjs`。

24項通過（15純模型/協調器、9隔離SQL）：包含新舊結算等值、預估/實付分離、未知回執、viewer/editor讀取、pending/outsider隔離、anon拒絕、直接寫入拒絕、跨trip連結拒絕、paid缺bundle及重複ID拒絕。SQL fixture模擬既有membership helper，非Hosted RLS parity或真實並行Sessions。Build、diff check另已通過。未修改rendered App，未重跑未受影響的完整Playwright。

## 尚需接續，不能宣稱完成

1. 正式的原子mutation／lease RPC，reuse既有#16/#17權威生命週期並驗證capability、epoch、scope版本與request receipt；schema目前沒有任何client寫權，不可為了接線直接grant DML。
2. 完整controller／同模型Demo與共用UI，兩頁籤同ID；移除一般Source操作及後端callable入口。現有線上App尚未切換，因此Source退場亦未完成。
3. 宿泊/Timeline新項目操作接線；純舊Budget連結允許解除，但其他操作功能不可失效。無直接Actual行程關聯則空links，不猜配Origin。
4. Actual fresh inventory、精確清理manifest及migration exceptions；特別是沒有paid_at／小數TWD／缺allocation不可跳過。整批前後金融與結算比對，不以零補值。
5. 生成真正Forward、完整隔離Postgres交易/多Session測試。Staging搬移／刪除／切換D/E仍需其Review，不能把這個prototype SQL當成Migration直接裝上去。Production/main仍禁止。

本輪沒有連線助手、遠端讀寫、Staging清庫、搬移、協定切換、Storage、Docker/WSL或Production操作；現有手測前端不會顯示此隔離模型。舊Budget不保留規則保持最高優先，不建立Legacy Budget轉換／雙寫／新Baseline。
