# Timeline Phase 7.5-7.8 | AI 行程交換與匯入計畫

> 2026-08-24 後續決策已取代本文件原先的 Place Resolution 設計：AI 與 Formal JSON 的 `location` 現在統一使用 `name/map_url/latitude/longitude`，新模板與匯出不含 `address`，舊 JSON 的 `address` 匯入時會忽略。AI 匯入前不呼叫 Places、不顯示地圖或候選確認；缺少座標只顯示既有黃色警示且不阻擋匯入。現行結果以 closeout 與 `CURRENT_TASK.md` 為準，下文保留為歷史規劃脈絡。

日期：2026-08-24
分支：`codex/timeline-phase-7-ai-exchange-import`
基線：`0bb623e`

## 1. 階段邊界

本階段建立外部 AI 與旅程工房之間的可攜交換層，但不在網站內呼叫任何模型。完整資料流為：

```text
Formal App Domain
→ AI Export Adapter
→ travel_studio_ai_itinerary v1
→ 使用者自行交給外部 AI
→ 貼回 AI 回覆
→ Extract / Parse / Migrate / Normalize / Validate
→ AI Import Draft
→ Place Resolution
→ Formal travel_studio_trip v1
→ 現有 buildTripImportPersistencePayload
→ 現有 import_trip_timeline_v1 RPC
```

明確不做：AI API、Provider selector、API Key、Chat UI、Streaming、Agent、Token／成本、模型自動修改既有正式 Timeline、server-side model call。

## 2. 文件身份與生命週期

AI 文件使用：

- `document_type: "travel_studio_ai_itinerary"`
- `schema_version: "1"`

正式交換文件繼續使用：

- `document_type: "travel_studio_trip"`
- `schema_version: "1"`

兩套 migration table、normalizer、validator 與 parser 分離。Formal parser 收到 AI 文件時回報 `invalid_document_type`；AI parser 收到 Formal 文件時亦同。AI Contract 改版不可修改或放寬正式 JSON v1。

## 3. AI Contract v1

### 3.1 Root 與 Trip

```json
{
  "schema_version": "1",
  "document_type": "travel_studio_ai_itinerary",
  "trip": {
    "title": "京都五日散策",
    "destination": {
      "display_name": "京都，日本",
      "country": "日本",
      "city": "京都"
    },
    "start_date": "2026-10-01",
    "end_date": "2026-10-05"
  },
  "days": []
}
```

AI 文件不包含 status、Supabase ID、owner/member、timestamp、lock、Realtime、route override、provider object、Place ID、座標或 Maps URL。正式匯入一律建立 `planning` Trip。

### 3.2 Day 與行程

Day 嚴格依日期範圍完整列出，`day_index` 從 0 連續遞增：

```json
{
  "day_index": 0,
  "date": "2026-10-01",
  "visits": [
    {
      "category": "attraction",
      "title": "清水寺",
      "location": {
        "name": "清水寺",
        "area": "東山區",
        "search_hint": "京都 清水寺"
      },
      "schedule": {
        "kind": "timed",
        "start": "09:00",
        "end": "10:30"
      },
      "fixed": true,
      "notes": null,
      "alternatives": []
    }
  ],
  "transports": [
    {
      "from_visit_number": 1,
      "to_visit_number": 2,
      "category": "walk",
      "name": "步行",
      "duration_minutes": 15,
      "notes": null
    }
  ]
}
```

行程陣列即視覺順序；AI 不需產生 ref。Import Adapter 依 Day 與 index 產生 deterministic Day-local Formal refs。

`category` 沿用正式成熟類別：`attraction`、`food`、`hotel`、`transport`、`note`。

### 3.3 可搜尋地點

`location` 為 `null` 或僅包含：

- `name`：主要搜尋名稱。
- `area`：城市內區域或行政區，可為 `null`。
- `search_hint`：補充搜尋文字，可為 `null`。

Contract 不接受 Place ID、provider ID、latitude、longitude、address 或 map URL。這些欄位只可由旅程工房的 Place Resolution 產生。

### 3.4 時間表示與確定性正規化

`schedule` 只接受四種互斥形態：

1. `timed`：`{ kind, start, end }`
2. `start_duration`：`{ kind, start, duration_minutes }`
3. `duration`：`{ kind, duration_minutes }`
4. `untimed`：`{ kind }`

正規化規則：

- `timed` 直接驗證並保留；開始不可為 `24:00`，結束可為 `24:00`。
- `start_duration` 以分鐘加總產生 end；超過 `24:00` 是 Error。
- `duration` 只有在緊鄰前一個最終為 Timed 的行程時自動接續；start 為「前一行程 end + `transport_to_next.duration_minutes`」向上取到 5 分鐘，end 為 start + duration。
- 若 `duration` 沒有可用前錨點、跨越 Untimed、超過 `24:00`，或會撞到下一個明確 Timed／Fixed 錨點，該段轉為 Untimed 並產生 Warning；不把猜測時間送進 Formal RPC。
- `untimed` 轉為 Formal `time: null`。
- `fixed: true` 僅允許 `timed` 或 `start_duration`；Fixed duration-only／Untimed 是 Error。

此 adapter 自行產生完整 Formal snapshot；不假設 Phase 6 Planner 或 RPC 會替新 Trip 排程。

### 3.5 交通表示

AI 使用 Day-level `transports` 與人類可理解的 1-based visit number，避免維護 UUID 或不透明 ref：

- `from_visit_number`／`to_visit_number` 對應同一 Day 的行程順序。
- 兩端必須存在、不可相同、方向必須向後，且同一端點 pair 不可重複。
- duration 必須為 1–1440 的整數。
- 此格式可以保留既有被 Untimed 行程暫停的非相鄰 transport；Formal Adapter 會轉成 Day-local `from_visit_ref`／`to_visit_ref`。
- 空白名稱沿用既有類別顯示 fallback，不破壞 Phase 7.1–7.4 行為。

### 3.6 備案

備案與主行程共用 category、title、location、schedule、notes，但沒有 `fixed`、巢狀備案或交通。備案時間套用 `timed`、`start_duration`、`untimed`；不接受依前項目的 `duration`，避免在未被採用的分支內猜測排程。

## 4. Parser 與驗證

安全抽取依序只接受：

1. 整段為單一 JSON object。
2. 恰好一個 Markdown fenced `json`／無語言 code block，block 內容為單一 JSON object。
3. 前後為少量一般文字，中央可由平衡大括號明確抽出恰好一個 JSON object。

多個 JSON object、未平衡括號、JSON5、註解、尾逗號、單引號、猜測補欄位或自動修復一律阻擋。

Pipeline：

```text
Raw text
→ extractAiItineraryJsonText
→ JSON.parse
→ document type / version detection
→ migrateAiItineraryDocument
→ normalizeAiItineraryDocument
→ structural validation
→ semantic validation
→ normalized AI Draft
```

Error 包含：malformed/ambiguous JSON、unsupported version、wrong type、unknown/missing fields、日期／Day、時間、Fixed、尾端交通、非法範圍。Warning 包含：Untimed、duration 無法安全接續、缺少可搜尋地點、文字地點、忽略的非必要資訊。

## 5. Place Resolution

### 5.1 可重用基礎

重用 `googleMapsLoader.js`、`googlePlacesConfig.js`、`googlePlacesAdapter.js`。新增的 batch coordinator 只負責佇列、狀態、信心與結果組合，不複製 Places API adapter。

### 5.2 Draft location identity

每個主行程與備案由 adapter 產生 draft key，例如：

- `day-1-visit-1`
- `day-1-visit-1-alternative-1`

Place ID 僅存在於短暫候選／解析狀態，不寫入 AI 文件、Formal JSON 或資料庫。

### 5.3 狀態

- `resolved`：保守規則確認單一高信心候選，且 details 具有有效、非 `0,0` 座標。
- `needs_confirmation`：存在多個合理候選，需使用者選擇。
- `not_found`：沒有候選。
- `text_only`：使用者明確選擇保留文字地點，不附座標／Maps URL。
- `missing`：AI 未提供可搜尋地點；以 Warning 保留無地圖資料。
- `error`：Provider 載入或請求失敗，可重試或保留文字地點。

高信心規則：第一候選主名稱與 location name 正規化後完全相同、沒有第二個同名候選，且有提供的 area/city/country context 至少一項出現在候選描述。無 context 時，只有 API 回傳單一候選才可自動接受。任何 details 座標缺失或 `0,0` 都不得成為 resolved。

### 5.4 批次 UX 與確認門檻

- 初次解析並行數設上限，避免一次送出無限制 Places 請求。
- 高信心項目自動完成。
- Preview 只集中展開 `needs_confirmation`、`not_found`、`error`。
- 使用者可重新搜尋、選候選，或明確按「保留文字地點」。
- 未處理的 `needs_confirmation`／`not_found`／`error` 阻擋確認；`text_only`／`missing` 是可繼續的 Warning。

## 6. AI Export／Import UX

旅程 Header 的既有更多操作加入「AI 行程交換」，打開單一交換 Dialog：

- 目前旅程：顯示 vendor-neutral 使用說明，可一鍵複製「說明 + AI JSON」，亦可只複製／下載 AI JSON。
- 匯入：主要入口為貼上 AI 回覆；另提供 `.json` 檔案作輔助。

解析成功後進入延續 Phase 7 圖形語言的 Preview：Hero、Map、Trip／Day 摘要、解析進度與待處理地點集中區。阻擋性 Contract Error 使用既有 compact red state，不顯示 Hero／Map／confirm。

## 7. Formal 轉接與 Persistence

`buildFormalTripJsonFromAiDraft` 只在 Contract 有效且所有必要 resolution 已處理後執行：

- 產生正式 `travel_studio_trip` v1。
- location 只採旅程工房 resolution details；絕不採 AI 座標／URL／Place ID。
- unresolved text-only location 保留 `name`，其他 map 欄位為 null。
- estimated cost 目前固定為 0，因不在 AI v1 成熟範圍。
- transport 的 visit number 轉成 Day-local refs。
- 再呼叫現有 Formal validator 與 `buildTripImportPersistencePayload`。
- 最終只呼叫既有 authenticated `import_trip_timeline_v1` RPC，不新增第二套寫入或新 migration。

Supabase 官方文件仍建議 database function 使用 `security invoker`，並明確 revoke `public`／`anon` 後只 grant 合法角色；目前 RPC 已符合。2026-08-24 changelog 未顯示會破壞此 RPC 路徑的變更。

## 8. 測試與完成門檻

新增 focused suites：

- Contract／Parser：valid、malformed、fence、文字包覆、多 JSON、version/type、required/unknown fields、日期、時間、Fixed／Untimed。
- Adapter：Formal→AI、AI→Formal、duration 接續、24:00、multiple Days、alternatives、transports、文字地點、兩種文件互斥。
- Place Resolution：唯一高信心、多候選、找不到、重搜、選候選、部分失敗、provider error、拒絕 `0,0`。
- Import UI／boundary：貼上主流程、Error 無 Hero/Map、Warning 可預覽、未處理 resolution 阻擋、只呼叫既有 RPC、atomic rollback regression。

最終必須通過：

1. 新增 focused tests。
2. 原 Phase 7 contract／RPC／preview tests。
3. Phase 6 Planner 與 navigation/map regressions。
4. 完整 Playwright regression。
5. `npm.cmd run build`。
6. `git diff --check`。
7. authenticated Staging：貼上、解析、候選處理、確認建立、reload、semantic re-export、原子失敗無殘留。
8. 清除所有 Staging QA Trip 與 dependent rows；Production 不變。

## 9. 完成產物

- AI v1 schema、contract、adapters、Place Resolution coordinator。
- AI exchange/import React UI 與 CSS。
- 完整自動測試與 manual QA fixture。
- 更新 `CURRENT_TASK.md`。
- Phase 7 完整 closeout/handoff，記錄 Staging、Production、Git 與 Vercel 的實際狀態。
