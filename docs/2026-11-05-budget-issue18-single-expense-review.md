# Issue #18｜單一旅行支出項目：Review 方案

日期：2026-11-05（Asia/Taipei）。分支：`codex/budget-collaboration-redesign`。

**建議：建立一套支出項目資料模型，保留預算／實付兩個檢視；同一 ID 內分開保存可空的預估與付款金額。停止 Source／Origin／Relink 業務流程，不維護兩套可寫模型。**

本文件是 [Issue #18](https://github.com/PeterChiu0314/Travel-Planner/issues/18) 要求的影響分析、模型及分階段遷移／驗收方案，**尚未實作新 schema、套 Migration、刪資料或切換服務**。Issue 明訂「先交付…交 ChatGPT Review，再動重大資料庫結構」。#17 Review 修正先完成；其尚未完成的新成員決策持久化，納入本模型一次處理，真實 Hosted 驗收仍未通過。

## 1. 最新資料保留範圍

使用者本輪明確表示：**「預算舊資料不必保留」**。

- 舊 `budget_items`、其 participant／行程關聯及純預算 QA 衍生資料不列為搬移需求。取消舊預算轉換、Budget／Actual 雙向同步與長期相容寫入的設計。
- 這不等於可以刪除旅程、行程、住宿、行李、成員、既有實付、結算或其他功能附件。本輪不執行任何刪除。
- 實付資料先保留：獨立或原先連到預算的 Actual 都可映射成「只有實付、預算未填」的新支出項目。**不由舊 budget／Origin 還原預算金額，也不替實付建立多餘預算。**
- 凍結 Baseline 仍沿用先前「不可改寫歷史 Baseline」限制，原表唯讀隔離，不搬回新預算，也不拿已付款資料補造舊 Baseline。若要刪除它或財務 Storage，需另列明確範圍；不將此保留變成新 Source 功能。
- 以上是 Review 範圍設定；真正執行前，還要用當時的 Staging 實際列數、FK／trigger 清單和目標 manifest 驗證刪除影響。不能用過去 QA 摘要代替本次現況。

## 2. 已核對的程式／SQL 相依

本輪核對 repository 原始碼與已部署交接，未新查遠端。最新**已記錄** Staging 為 ledger66／`20261103113253`；五個必要協定 ON、Receipt／Undo OFF。這不是新 readback；先前瀏覽器自動審核服務的用量阻擋未被繞過。Production 不在本輪操作範圍。

| 現有相依 | 本次核對依據 | 單一項目下的處置 |
| --- | --- | --- |
| `budget_items` / `actual_expenses` | core schema、B7 Lifecycle、`BudgetWorkspace.jsx` | 由一個 `expense_items` 取代可寫業務模型。舊預算不搬；實付依下表匯入。不要只把兩表 UNION 後繼續雙寫。 |
| 兩套 participant tables | `budgetFinance.js` / `budgetPricingGroups.js` | 一套 item participants，金額分配可分預估／實付欄位，但都是同一 item 的原子 pricing 操作。 |
| `actual_expenses_one_budget` | 不可變 Forward `20261103113253` | 現有 partial unique index 限制非 NULL `budget_item_id`，包含取消付款的列；新模型沒有付款 child row，至多一筆當前實付由 item 的單一 paid bundle 結構保證。 |
| `budget_item_id` / `budget_origin_id` | `budgetSourceValues.js`、Source SQL、comparison functions | 新業務模型不保留這兩個欄位或來源管理入口。舊 Actual 的金融資料保存，不將歷史 Origin 強轉成目前預算。 |
| Source UI/controller/RPC | `BudgetSourceEditor.jsx`、`budgetSourceGroups.js`、`read_budget_source_preview` / `budget_source_lease` / `mutate_budget_source` | 新 snapshot／寫入入口完整接替後撤銷舊 callable 路徑，移除 UI、controller、預覽／重關聯／反套資料及只為其存在的測試。不能只藏 UI。 |
| Payment／Pricing 多目標 bundle | `budgetPaymentGroups.js` / `budgetPaymentValues.js` / B7 SQL | 同一 item 的 pricing/payment/payer 版本與交易，保留冪等、防競態；移除 Budget↔Actual 拓撲與額外 Source version。 |
| Lifecycle placeholder | `budgetLifecycleGroups.js`、B7 workspace SQL | 一種 item 建立／刪除流程；新增入口只決定要填預估還是實付。未填值不能變成合法零元或已付款。 |
| Metadata 與 snapshot validators | `budgetMetadataService.js` | 目前 v6+ 強制 Source、v7+ 強制 Receipt、v9+ 強制 Lifecycle 等片段；不能單獨刪欄位。新 snapshot 一次替換契約、validator、Demo 及讀取安裝流程。 |
| 行前付款投影 | `planningBudget.js::planningBudgetData` | 目前會把預算列顯示成付款 TWD 合計；新模型移除此覆蓋投影，預算10,000仍是10,000，付款9,500另存。 |
| 結算／差額 | `budgetFinance.js::settlementBalances`、兩處 comparison helper | 結算只讀有效 paid bundle；差額直接依同一 ID／凍結新 Baseline 比較，不靠 Origin 找 Actual。預算未填顯示「未編預算」，不假稱預算為0。 |
| 旅程匯率 | `trips.budget_exchange_rates`、Finance/Rates controller | 保留旅程統一報價及手動更新，僅重算允許的未付款預估；實付匯率、已知扣款和已付款歷史不隨預算更新。 |
| Baseline | `trip_budget_baselines`（trip PK）、`refresh_budget_baseline` | 現有快照 cutoff 後不可變，不能拿新 payload 覆蓋原列。新模型使用獨立 schema-v2 snapshot；舊凍結列退出新業務讀取，維持唯讀，不做假 hash／歷史修復。 |
| Timeline / Accommodation 外鍵 | core FK 與 B7 boundary guards | `itinerary_budget_items` 可作舊預算衍生資料移除；`accommodations.budget_item_id` 為 nullable 引用，只解除該引用，不能刪住宿列。其他引用須由實際 catalog 再盤點。 |
| RLS、ACL、Realtime、cache、draft | 現有 App Budget subscription / metadata scope | 新 parent/participants/links 都以 trip membership 授權；一致 snapshot、scope/generation/version 防舊結果仍保留。cutover 要隔離舊 cache/draft，不能將舊 `kind:budget/actual` 草稿偷偷提交為新項目。 |
| Undo／Receipt 殘留 | `20261103113253`、舊 Snapshot validator、private audit/helper | 不恢復 Undo、Receipt、Worker，不重開 Storage 權限。只移除新模型已不依賴的程式；舊稽核／未確認請求先留唯讀，待無依賴再用 Forward `DROP … RESTRICT`，不使用廣泛 CASCADE。 |

相依盤點證明需要替換整體讀寫契約，不能直接刪 `Source` 元件後宣稱重構完成。`docs/operations/issue18/read-only-inventory.sql` 是後續 Staging catalog／資料 preflight 草案，**本輪未執行，也沒有生成 Passed 結果**。

## 3. 建議的最小資料模型

採「單一 parent＋單一 participants＋行程 links＋必要的凍結快照」。不新增獨立付款項目表、Source 對照表、Receipt Worker 或常駐搬移／雙寫服務。以下為 Review 契約，非可直接執行的 DDL。

| 實體 | 主要欄位／約束 | 理由 |
| --- | --- | --- |
| `expense_items` | `id` UUID PK、`trip_id` FK、title/category/note、payer；可空 `budget_*` 金額/幣別/單價/模式/匯率/TWD；可空 `paid_*` 對應欄位與扣款來源；`payment_state`、`paid_at`；成員決策是否已知與群組版本 | 同一項目有兩組可選的金額資料，不是兩張可重關聯的紀錄。分開欄位才能保留10,000預估與9,500實付。 |
| `expense_participants` | PK `(expense_id,user_id)`、`selected`、可空 `budget_share_amount` / `paid_share_amount`；與 item 同 trip 的有效／歷史成員驗證 | 已考慮但排除的成員也有 `selected=false`，不再靠「沒 join row」猜測。預估／實付兩組份額是同一 pricing payload，非兩套 controller。 |
| `expense_itinerary_links` | 唯一 `(expense_id,itinerary_item_id)`、雙方 trip 相同 | 預算／實付檢視共用同一行程關聯，不依賴 budget parent。 |
| 新 `expense_trip_baselines` | 每旅程一份新模型凍結快照，含 canonical item IDs、預估金額／參與者／links、cutoff與schema version | 舊表的凍結列不改；新規劃在現有 cutoff 規則下封存新資料。過去沒有新模型事前快照的旅程不能補造。 |

必要 private state 沿用既有群組租約／request receipt 的設計，只把 subject 收斂為 `expense_id`，不另建第二套協作服務或多個發布協定。對所有新 exposed relations 開 RLS；authenticated viewer 僅讀、approved editor／owner 才能走受控 mutation。禁止 anon、pending、outsider、跨 trip 寫入；不能因簡化改為 service-role 前端寫入。

### 金額、付款與完整性

- NULL 是未填；0 是使用者明確輸入且通過驗證的零元。統計不得用 `COALESCE(amount,0)` 把未填當完成項目。
- 每種模式仍沿用 #17：共用明確參與者集合；每人單價×勾選人數；總額均分保留輸入總額；自訂份額加總決定該金額 bundle 的總額；原幣以分計算、TWD 尾差使用既有整數 allocation。
- `payment_state` 建議 `unpaid` / `draft` / `paid`：新增預算為 unpaid；「新增實付」先建立 paid-intent 的 draft，缺值不進結算。只有明確完成付款意圖且金額、付款人、份額、時間有效的原子操作才能成為 paid；單純讀取／換階段不會付款。
- 付款可從預估 seed 一次，9,500修改只改 paid bundle，budget仍10,000。付款時間可在確認付款時預設該次時間；匯入既有實付時原時間不變。draft 缺時間如何完成需在 UI／RPC 同一契約實作，不能在 reader 擅自補時間。
- 取消付款使狀態 unpaid，保留最近一次 paid bundle 作再次付款的候選，不計入結算。再次付款仍更新同一 row，不 INSERT 第二個 current payment；重送同 request-id 只有一次 effect。
- 已知台幣扣款、原匯率／原幣金額與 paid份額受原有財務限制保護。保留 legacy 小數 TWD 時不能靜默取整；新值沿現行合法精度。無法有效 allocation 的 legacy 列保留並明確排除／阻擋結算確認，不能偽造完整。

### #17 新成員決策一次處理

1. 新 item 建立時保存當時有效核准成員的決策列，預設 selected=true；使用者排除改 false。三種模式不重建／全選名單。
2. 決策已知的未付款 item：新核准成員沒有決策列，才可在計價畫面提出補選；原排除列不能被選回。自訂新份額為0，保留既有份額。
3. 畫面讀取不寫；persist 必須由使用者的 pricing 互動取得該組租約、驗證 members/row/rates version 後，將成員決策、金額、份額一次提交。別人持有 pricing 時只讀其 canonical 資料及色框，不能偷偷補選。
4. 匯入實付的決策先標為未知，保留既有名單，不猜測其他人是否被排除。第一次明確調整參與者時才記錄完整的已考慮成員集合。
5. 已付款項目不因加入成員／開啟畫面而重算付款歷史。人工更動 paid participants 需要明確的合法同組金融操作，已知扣款保護不放寬。

## 4. 資料對應（舊預算不保留後的簡化版本）

| 舊狀態 | 新結果 | 阻擋／檢查 |
| --- | --- | --- |
| 只有預算，含未完成預算 | 不搬移；在核准的 Staging reset 範圍刪除舊 budget及其衍生 join rows | 不影響旅程、Timeline、住宿本體；先確認所有 FK／guard。 |
| 預算有一筆目前有效 Actual | 用 Actual ID 建一筆實付型 expense；`budget_* = NULL`，不保留舊預算或Origin關係 | Paid金額、幣別、扣款來源、payer、participants、paid_at逐欄等值。不是把預算值覆蓋為實付。 |
| 獨立手動 Actual | 同 Actual ID 實付型 expense、預算空 | 不建立佔位預算，不要求來源選擇。 |
| 已取消付款 Actual | 同 ID 保留為 unpaid，保留最後金融值但不進結算 | 匯入不自動再次付款。 |
| 未完成 Actual | 同 ID draft；未填原值仍未填 | 不補0、不補時間、不變成已付；缺少 payer/成員等必須保留不完整狀態。 |
| 多 Actual 共用歷史 Origin／曾 Relink | 不按 Origin 合併；Actual各自ID與金融值保留，均無舊預算 | 檢查當前有效資料是否重複計入。存在不一致／不可判定付款列時列為 Review exception，不刪除、合併或累加成一筆。 |
| Source metadata差異 | 使用 Actual自己已儲存的名稱/分類/備註/payer；舊預算不搬 | 不做反向套用／優先budget，無需欄位衝突合併。 |
| 舊 Baseline | 原列保留唯讀，不納入新 item的比較 | 缺新事前快照時差額為未知，不拿目前paid值補回。 |
| 舊財務 receipt metadata/object | 維持已停用與原保護，不自動刪 Storage | 其他附件系統不變；清除財務物件需另列範圍。 |

原 Actual 備註、payment history等不應因不再需要 Source而被當作可刪；遷移前保留原列唯讀或可稽核封存，驗證新金融投影後再另做清理 Review。此封存不提供一般 UI 的歷史管理功能，也不參與新業務寫入。

## 5. 寫入與 UI 收斂

- 一個 item selection、同一個 editor、同一套 Pricing/Metadata 純函式與 controller。預算／實付頁籤只切顯示範圍／重點，切頁籤不複製或轉換紀錄。
- 行前新增項目填預算；付款在同一項目內完成，標示「預算金額」「實付金額」。旅行中新增實付直接建立同類 item，預算可空。
- 沿用 title/note/category/payer/links/pricing/payment/lifecycle 需求中的真正群組邊界；pricing 提交金額、參與者、決策、兩組相依份額須原子。不同 metadata groups 可並行，付款檢查 pricing/payer versions，rates鎖僅作用其真正相依範圍。
- 租約仍綁帳號、分頁 session、opaque capability與epoch；同帳號不同分頁不是同一 holder。保留 #16 的 admission/blur/release/late ACK guard，不從 snapshot own-session hint 發明 authority。
- 正常 autosave／同步完全無文字與成功 Toast。真正失敗用 #17 Review 修正後的去重 Sonner；草稿／未知回執留在內部，無法恢復的離開使用既有頁面確認。
- 完全移除來源下拉、目前／歷史來源、Relink／Apply、舊整筆重複入口、非必要付款歷史 UI。新業務不再 import Source controller、要求Source/Receipt snapshot readiness 或啟動 Worker。
- Realtime安裝單一一致 snapshot；coalescing、account/trip/generation/version fence、離線草稿及未知 request receipt保留。Demo使用同模型與元件，只有transport改純記憶體，不呼叫Auth/Storage/Realtime。

## 6. 分階段 Forward／切換計畫（待 Review，未執行）

| 階段 | 可 Review 的具體產物／退出條件 | 本輪狀態 |
| --- | --- | --- |
| A：方案 | 本文件、dependency map、舊預算可捨棄邊界、Actual mapping、成員決策、驗收表 | 已交付；等待 ChatGPT Review。 |
| B：隔離實作 | CLI產生**新的** Forward；new parent/people/links/baseline，RPC／RLS／receipts及同模型Demo；新snapshot不含Source/Receipt依賴 | 未開始重大schema實作。已安裝Migration/Source Hash/Latch不改、不重播。 |
| C：隔離驗收 | 真實 Postgres交易／RLS與相同schema測試；財務數字、atomicity、同組互斥、兩帳號三Session、未知ACK、baseline精度均有證據 | 未執行；PGlite serial 或 Mock不作genuineparallel代替。 |
| D：Staging準備 | Fresh READ ONLY inventory／Actual與其他模組SHA-256／目標清理manifest；已開始請求確認、租約釋放；無未知未結交易 | 未執行；先前五ON授權維持，不自行Pause。需要短暫切換時以核准Runbook受控進行。 |
| E：Staging切換 | 批次匯入Actual→expense（ID不變）、保護其他資料、停舊寫RPC、防舊client寫回；Preview新reader／editor；舊預算按manifest刪除 | 未執行；先驗證再刪，整批錯誤回滾；不建立長期雙寫、背景migrator或更多協定。 |
| F：退場 | pg_depend、函式體、trigger及前端import皆無舊依賴後，新的contract Forward逐項 `REVOKE` / `DROP … RESTRICT` | 未執行；保留不變的歷史Migration及必要稽核，禁止廣泛CASCADE／role/RLS鬆綁。 |
| G：結案 | #17成員決策與Hosted剩餘項驗收完成；#18數字/UX/權限/資料對照通過，Commit/Push與Review | 尚未達成；Production仍NO-GO，不合main、不正式部署。 |

不以部署順序猜測資料庫版本。舊RPC有未確認 request-id時，必須先查證結束或隔離為不能切換的阻擋項，不能刪其回執後把同一請求當新寫入。新client不因舊API拒絕而fallback全表更新。

切換前可回滾至未啟用的新空結構；一旦新模型接收寫入，回復舊版需要先停止新寫入並驗證反向可表示性。不能直接重開舊client、把新實付覆蓋回已刪budget，或以還原整庫傷及其他模組。優先Forward修復；實際回退界線與恢復產物在B/C階段確定。

## 7. 驗收表（全部待執行，不是Passed）

| 案例 | 必須看見的結果／證據 |
| --- | --- |
| 新預算10,000→付款9,500 | 同ID、budget10,000/paid9,500、省500（或paid-budget=-500）、結算僅9,500；跨帳號刷新一致。 |
| 臨時午餐800／兩人 | budget為NULL、paid800、各400、指定payer後差額應收應付正確；無Source、無額外budget。 |
| 取消／再付款／ACK丟失 | 同一current bundle、至多一次effect；取消不計結算、重送不新增第二筆。 |
| 未完成／合法0 | NULL與0可辨別；draft/未付款不進結算；合法0可完成且分攤一致。 |
| 分攤／新成員 | #17 10,000→自訂5,000+5,000→7,000+5,000=12,000；已排除不重選；新member辨識有決策證據；custom新人0。 |
| 已付款／Rates／Baseline | 真實不同報價只重算合法未付預估；paid金融值與舊凍結baseline不變；新凍結快照切階段不造付款。 |
| A/B/A Session | 同組唯一holder、不同組並行、same-account分頁隔離、PT409收斂與exact late cleanup；HTTP加獨立SQL證據。 |
| 失敗及安靜UI | 正常打字/等待/切欄/成功無banner與Toast；離線/拒絕/驗證失敗一則通知、草稿保留、冪等恢復或離開保護。 |
| 後端停用Source／Receipt／Undo | 已登入editor直接呼叫舊入口也不能繞過，Storage財務寫入仍拒絕；一般附件不受影響。 |
| 實付匯入／預算清除 | 匯入前後金融列／人員份額等值、有效付款總額及每人balances相同；清理僅命中manifest舊預算，其他模組SHA-256一致。 |
| RLS／ACL／UI一致 | viewer/pending/outsider/anon/跨trip拒絕；正式與Demo共享欄位計算；Build/相關Playwright/資料庫整合/diff檢查。 |

本輪沒有製造新的Staging資料指紋、readiness或測試結果。下一步是Review本模型與清理範圍，再實作B；不是現在執行Migration或正式上線。
