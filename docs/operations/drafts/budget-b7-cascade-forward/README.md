# Cascade Forward：官方版本 20261031130414／本機驗證完成

2026-10-31。**NON-AUTO-APPLY；本輪不授權 Hosted 寫入。** 唯一可能的後續目標為 `Travel-Planner-Staging`／`uyqdopksfysbobhjcepk`，並非 Production。

本輪已驗證[完整 source.sql](source.sql)，3,546 bytes，LF SHA-256：

`19f9c1e6184560052b4a62f4b810573198a225b98e0f80b67b874ad869e4cb22`

[source-manifest](source-manifest.json)封存真實完整來源及函式 before／after Hash。正式候選為[20261031130414_budget_dormant_parent_cascade_guard.sql](20261031130414_budget_dormant_parent_cascade_guard.sql)，來源與source.sql逐byte相同；[packet-manifest](packet-manifest.json)封存正式版號、Source／wrapper SHA及官方CLI資訊。 原[舊草案](../budget-b7-preactivation/20261031100434_budget_dormant_parent_cascade_guard.sql)與其seal保留作歷史，不得部署舊版本。

## 正式版本及歷史時間阻擋

已安裝Ledger head為`20261031130000`。早先CLI產生`20261031105916`，不符合遞增而拒收；該歷史空檔僅留ignored。依使用者明確選擇，21:00後重新產生正式版號 **`20261031130414`**，CLI v2.106.0正常退出0；版號時間阻擋已解除。

官方 [migration new](https://supabase.com/docs/reference/cli/supabase-migration-new) 沒有指定時間或依既有head遞增的選項；[v2.106.0 new.go](https://github.com/supabase/cli/blob/v2.106.0/apps/cli-go/internal/migration/new/new.go)呼叫[UTC現在時間](https://github.com/supabase/cli/blob/v2.106.0/apps/cli-go/internal/utils/misc.go)。因此必須等 **2026-10-31 UTC 13:00:00之後／台灣21:00之後**才可依本輪條件產生合格版本。沒有偽造時間、改系統時鐘、改舊Head、手改版本或用其他CLI命令繞過。

以下命令**只在本機產檔，沒有DB executor／連線／部署**；本次已執行完成，現有候選存在時會拒絕再次產生。時間門檻未到或來源Hash漂移亦拒絕，不自動重新封存：

```powershell
node scripts/qa/prepare-b7-cascade-forward.mjs
```

工具於ignored workdir呼叫官方migration new，明確關閉stdin以提供EOF，再核對新產生的版號與來源Hash。正式版本檔、[candidate-deployment.psql](candidate-deployment.psql)及[packet-manifest.json](packet-manifest.json)均已產生並完成版本碰撞／Hash／實際版本隔離驗證；不得覆寫或重發候選。wrapper為9,116bytes，SHA-256 `e6db59ea72d45e21e4e7860f37d70cfab1e6d35e483847deba533495d45118a6`，單一top-level交易。source.sql的pending註解保留早先準備時文字，以維持完整來源Hash；不代表目前仍未產版，也不是啟用旗標／Hosted授權。第一次空檔20261031130151因stdin未EOF而停止，未採用；最終正式候選只認packet-manifest所列版號。

## 修改邏輯與保護

只替換 `app_private.guard_incomplete_child()`。保留舊草案原有before／after body Hash：

- before：`c3667a091954ed67ea677ff73aed85a5aa57cf292bb02519fcea155521a4a3d5`
- after：`ecd7888508e91b6df351a9ab4e95cf1a3facc426316ee68a868e622b1cdfda51`

僅當DELETE、親列已不存在、finance／lifecycle／receipt從未Activated，保留正常FK cascade；現存Incomplete Parent的participant INSERT／UPDATE／DELETE仍拒絕，曾Activated後Pause的外部Parent Guard仍拒絕。沒有修改其他財務／Lifecycle函式、38個final seals、RLS、ACL、Trigger或資料。

來源於交易內鎖住七個Protocol表，防止修復期間並發啟用；所有enabled／Latch必須OFF。精確before或after body才接受；重建後檢查整個pg_proc非body屬性（含OID／owner／ACL／security／search_path）不變及afterHash正確。未知Hash、非Dormant、鎖衝突或屬性差異都失敗，保留交易回滾。

## 已驗證的 Ledger／原子規則

離線 builder：`scripts/qa/b7-cascade-forward-artifacts.mjs`。將完整 `source.sql` 以原文陣列存入ledger，SHA按LF核對；不是只存函式片段或假tombstone。

1. 後續執行前須另獲**實際正式版號＋完整Source／wrapper SHA**的Staging-only授權，核對真實endpoint／project-bound login，不能只靠target GUC判斷專案。
2. 原62筆／head20261031130000、舊Guard Hash、38final函式／原資料指紋／七OFF及維護條件都必須即時符合。不要重播Dormant packet或舊Hotfix。
3. 同Session設定指定target，`psql ON_ERROR_STOP=1`載入完整wrapper；只有一個top-level BEGIN／COMMIT，不加`-1`。source原文內的BEGIN／COMMIT在ledger陣列中只是字串，實際執行部分由lexer剝除外層交易。
4. 鎖住ledger，安裝前精確62／head，body變更與source登記同交易；成功才**62→63**。已存在的同version僅在63／head／name／完整sourceHash／after body全相符且仍Dormant時接受重複執行，不新增列或改資料。
5. 同version異來源（含NULL name／statements／NULL來源陣列元素）、未知Head／筆數、錯target、未知body、非Dormant或後段失敗，一律拒絕／整筆回滾。unknown COMMIT先獨立讀回，不直接重送。
6. COMMIT後另開唯讀連線核對63、完整Source Hash、afterHash、OID／Owner／ACL／RLS／Trigger、38final Hash、原資料指紋及七OFF。已提交後不得刪ledger／做破壞性rollback；修復只能另版Forward。

使用者明確授權的21:01本機續作已完成；不含任何Hosted部署／Activation。

早期合成版號`20990101000000`的15／15結果保留作歷史。正式候選 **`20261031130414`** 的精確來源／wrapper已另跑15／15通過，含Ledger62→63／重播／NULL source／collision／rollback，cluster已停止；這仍是原生PostgreSQL隔離驗證，不能冒充Staging修復／真HTTP驗收。

## 後續最小 Hosted 範圍

新版號與來源驗證已完成，待ChatGPT Review後，只需另行授權：此一private函式的完整Forward、必要交易鎖及一筆ledger，接著針對保留QA的正常Cascade做真HTTP回歸與唯讀驗證。不需要Realtime設定／Publication／RLS／Role／Grant變更、完整Dormant重播、Activation或Worker。QA清理需另行列明，遇Baseline／稽核／Parent Guard拒絕仍保留，不能強制清理。
