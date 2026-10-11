import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  aiItineraryCurrentSchemaVersion,
  aiItineraryDocumentType,
  parseAiItineraryText,
  validateAiItineraryDocument,
} from "../src/lib/aiItineraryContract.js";
import {
  aiItineraryBlankTemplateFileName,
  buildAiItineraryCreatePrompt,
  buildAiItineraryClipboardText,
  buildAiItineraryDocument,
  buildAiItineraryPromptExample,
  buildAiItineraryUsageInstructions,
  buildBlankAiItineraryTemplate,
  buildFormalTripJsonFromAiDraft,
} from "../src/lib/aiItineraryAdapters.js";
import { parseTripJsonText } from "../src/lib/tripJsonContract.js";

function location(name = "清水寺", overrides = {}) {
  return { name, map_url: null, latitude: null, longitude: null, ...overrides };
}

function alternative(overrides = {}) {
  return {
    category: "food",
    title: "湯豆腐備案",
    location: location("順正湯豆腐"),
    schedule: { kind: "untimed" },
    notes: null,
    ...overrides,
  };
}

function visit(title, overrides = {}) {
  return {
    category: "attraction",
    title,
    location: location(title),
    schedule: { kind: "timed", start: "09:00", end: "10:00" },
    fixed: false,
    notes: null,
    alternatives: [],
    ...overrides,
  };
}

function validAiDocument() {
  return {
    schema_version: "1",
    document_type: "travel_studio_ai_itinerary",
    trip: {
      title: "京都 AI 行程",
      destination: { display_name: "日本 · 京都", country: "日本", city: "京都" },
      start_date: "2026-10-01",
      end_date: "2026-10-02",
    },
    days: [
      {
        day_index: 0,
        date: "2026-10-01",
        visits: [
          visit("清水寺", { fixed: true, alternatives: [alternative()] }),
          visit("二年坂", { schedule: { kind: "duration", duration_minutes: 45 } }),
          visit("京都車站", { schedule: { kind: "timed", start: "23:00", end: "24:00" } }),
        ],
        transports: [
          { from_visit_number: 1, to_visit_number: 2, category: "walk", name: "步行", duration_minutes: 10, notes: null },
          { from_visit_number: 2, to_visit_number: 3, category: "bus", name: "市公車", duration_minutes: 30, notes: null },
        ],
      },
      { day_index: 1, date: "2026-10-02", visits: [], transports: [] },
    ],
  };
}

test("AI v1 schema has an independent document identity and strict root", () => {
  const schema = JSON.parse(readFileSync("src/contracts/ai-itinerary.v1.schema.json", "utf8"));
  const formalSchema = JSON.parse(readFileSync("src/contracts/trip-timeline.v1.schema.json", "utf8"));
  expect(schema.properties.schema_version.const).toBe(aiItineraryCurrentSchemaVersion);
  expect(schema.properties.document_type.const).toBe(aiItineraryDocumentType);
  expect(schema.additionalProperties).toBe(false);
  expect(schema.$defs.location.required).toEqual(["name", "map_url", "latitude", "longitude"]);
  expect(Object.keys(schema.$defs.location.properties)).toEqual(["name", "map_url", "latitude", "longitude"]);
  expect(schema.$defs.location).toEqual(formalSchema.$defs.location);
  expect(schema.$defs.location.properties).not.toHaveProperty("place_id");
});

test("blank AI planning template is downloadable field guidance without internal data", () => {
  const template = buildBlankAiItineraryTemplate();
  const json = JSON.stringify(template);
  expect(aiItineraryBlankTemplateFileName).toBe("travel-studio-ai-itinerary-template-v1.json");
  expect(template).toMatchObject({
    schema_version: "1",
    document_type: "travel_studio_ai_itinerary",
    trip: {
      title: "",
      destination: { display_name: "", country: null, city: null },
      start_date: "",
      end_date: "",
    },
    days: [{ day_index: 0, date: "", transports: [], visits: [{ title: "", alternatives: [] }] }],
  });
  expect(template.days[0].visits[0].location).toEqual({ name: null, map_url: null, latitude: null, longitude: null });
  expect(json).not.toMatch(/uuid|owner|member|place_id/i);
  expect(validateAiItineraryDocument(template).ok).toBe(false);

});

test("both prompts share file delivery, draft-safe planning and anchor-based timing guidance", () => {
  for (const prompt of [buildAiItineraryCreatePrompt(), buildAiItineraryUsageInstructions(validAiDocument())]) {
    for (const rule of [
      'schema_version: "1"（字串）', 'document_type: "travel_studio_ai_itinerary"',
      "尚未完成的行程草案", "主動提出具體、可執行的行程建議", "慢遊日可以少排，不設固定景點數",
      "不得寫成已預訂或已確認", "不需要追問這些細節", "必要文字不可空白", "YYYY-MM-DD",
      "第一筆用 start_duration", "後續可連續的非固定行程用 duration", "向上取到 5 分鐘",
      "可保留空檔與休息", "不要因為前站提早結束就把晚餐接到下午", "先展開 duration 的實際時間",
      "使用者提供的時間必須保留", "遇到 Fixed 時不可移動 Fixed", "備案不可用 duration",
      "每日開始錨點不等於 Fixed", "所有 fixed 都必須 false",
      "1→2", "1 到 1440 的整數", "name、map_url、latitude、longitude", "latitude/longitude 一起為 null",
      "不輸出 address 或 Place ID", "earliest_next_start=previous_end+transport.duration_minutes",
      "10:45，不是 10:30", "檢查 JSON 可解析", "實際解析並驗算", "不要請使用者再送回修檔",
      "可下載的 .json 檔案", "內建下載 .json", "不要建立 Google 文件", "不要假造下載連結",
    ]) expect(prompt).toContain(rule);
    expect(prompt).toContain(JSON.stringify(buildAiItineraryPromptExample()));
    expect(prompt).not.toMatch(/OpenAI|Gemini/);
  }
  expect(buildAiItineraryUsageInstructions(validAiDocument())).toContain("除非使用者明確要求簡化或刪除，應保留原有行程密度與有用內容");
  expect(buildAiItineraryCreatePrompt()).toContain("名稱可依需求命名");
});

test("prompt example validates end-to-end and demonstrates transport-aware duration continuation", () => {
  const example = buildAiItineraryPromptExample();
  expect(parseAiItineraryText(JSON.stringify(example)).ok).toBe(true);
  const formal = buildFormalTripJsonFromAiDraft(example);
  expect(formal.ok).toBe(true);
  expect(formal.document.days[0].visits[1].time).toEqual({ start: "10:45", end: "11:45" });
  expect(formal.document.days[0].visits[0].alternatives[0]).not.toHaveProperty("fixed");
  expect(buildBlankAiItineraryTemplate().trip.title).toBe("");
});

test("duration-based draft avoids the Gemini baseline overlap without loosening explicit conflict rules", () => {
  const example = buildAiItineraryPromptExample();
  example.days[0].visits[0].schedule = { kind: "start_duration", start: "09:00", duration_minutes: 150 };
  example.days[0].visits[1].schedule = { kind: "start_duration", start: "11:30", duration_minutes: 90 };
  const blocked = buildFormalTripJsonFromAiDraft(example);
  expect(blocked.ok).toBe(false);
  expect(blocked.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "timeline_time_conflict" })]));
  example.days[0].visits[1].schedule = { kind: "duration", duration_minutes: 90 };
  const continued = buildFormalTripJsonFromAiDraft(example);
  expect(continued.ok).toBe(true);
  expect(continued.document.days[0].visits[1].time).toEqual({ start: "11:45", end: "13:15" });
});

test("a meal-time anchor preserves free time rather than pulling dinner into the afternoon", () => {
  const example = buildAiItineraryPromptExample();
  example.days[0].visits[1].category = "food";
  example.days[0].visits[1].title = "晚餐建議";
  example.days[0].visits[1].schedule = { kind: "start_duration", start: "17:30", duration_minutes: 60 };
  const result = buildFormalTripJsonFromAiDraft(example);
  expect(result.ok).toBe(true);
  expect(result.document.days[0].visits[1].time).toEqual({ start: "17:30", end: "18:30" });
  expect(result.document.days[0].visits.every((visit) => visit.fixed === false)).toBe(true);
});

test("common AI field aliases are canonically migrated without loosening unknown fields", () => {
  const input = validAiDocument();
  input.days[0].visits[0].location = { name: "清水寺", area: "京都市東山區", search_hint: "京都 清水寺" };
  input.days[0].visits[0].category = "dining";
  input.days[0].visits[0].schedule = { kind: "timed", start_time: "09:00", end_time: "10:00" };
  input.days[0].visits[1].category = "accommodation";
  input.days[0].visits[1].schedule = { kind: "start_duration", start_time: "10:10", duration_minutes: 45 };
  input.days[0].transports[0] = {
    from_visit_number: 1,
    to_visit_number: 2,
    mode: "walk",
    notes: "步行約 10 分鐘",
  };

  const result = parseAiItineraryText(JSON.stringify(input));
  expect(result.ok).toBe(true);
  expect(result.migrations).toContain("ai_field_aliases_v1");
  expect(result.document.days[0].visits[0]).toMatchObject({
    category: "food",
    location: { name: "清水寺", map_url: null, latitude: null, longitude: null },
    schedule: { kind: "timed", start: "09:00", end: "10:00" },
  });
  expect(result.document.days[0].visits[1]).toMatchObject({
    category: "hotel",
    schedule: { kind: "start_duration", start: "10:10", duration_minutes: 45 },
  });
  expect(result.document.days[0].transports[0]).toMatchObject({
    category: "walk",
    name: "步行",
    duration_minutes: 10,
  });

  const legacyAddress = validAiDocument();
  legacyAddress.days[0].visits[0].location.address = "京都市東山區";
  const legacyAddressResult = parseAiItineraryText(JSON.stringify(legacyAddress));
  expect(legacyAddressResult.ok).toBe(true);
  expect(legacyAddressResult.migrations).toContain("ai_field_aliases_v1");
  expect(legacyAddressResult.document.days[0].visits[0].location).not.toHaveProperty("address");

  const zeroBased = validAiDocument();
  zeroBased.days[0].transports = zeroBased.days[0].transports.map((transport) => ({
    ...transport,
    from_visit_number: transport.from_visit_number - 1,
    to_visit_number: transport.to_visit_number - 1,
  }));
  const zeroBasedResult = parseAiItineraryText(JSON.stringify(zeroBased));
  expect(zeroBasedResult.ok).toBe(true);
  expect(zeroBasedResult.migrations).toContain("ai_field_aliases_v1");
  expect(zeroBasedResult.document.days[0].transports[0]).toMatchObject({ from_visit_number: 1, to_visit_number: 2 });

  const mixedNumbering = validAiDocument();
  mixedNumbering.days[0].transports[0].from_visit_number = 0;
  expect(parseAiItineraryText(JSON.stringify(mixedNumbering)).errors.map((error) => error.code)).toContain("invalid_range");

  input.days[0].visits[0].provider_object = {};
  expect(parseAiItineraryText(JSON.stringify(input)).errors.map((error) => error.code)).toContain("unknown_field");

  const conflictingAlias = validAiDocument();
  conflictingAlias.days[0].visits[0].schedule.start_time = "08:00";
  expect(parseAiItineraryText(JSON.stringify(conflictingAlias)).errors).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "unknown_field", path: "$.days[0].visits[0].schedule.start_time" }),
  ]));
});

test("valid AI JSON parses, normalizes, and reports non-blocking Untimed warnings", () => {
  const input = validAiDocument();
  input.trip.title = "  京都 AI 行程  ";
  const result = parseAiItineraryText(JSON.stringify(input));
  expect(result.ok).toBe(true);
  expect(result.document.trip.title).toBe("京都 AI 行程");
  expect(result.warnings.map((warning) => warning.code)).toContain("untimed_alternative");
  expect(result.sourceKind).toBe("json");
});

test("AI metro/subway synonyms map only to train and unknown categories still block", () => {
  for (const alias of ["subway", "metro"]) {
    const input = validAiDocument();
    input.days[0].transports[0].category = alias;
    input.days[0].transports[0].name = "";
    const result = parseAiItineraryText(JSON.stringify(input));
    expect(result.ok).toBe(true);
    expect(result.migrations).toContain("ai_field_aliases_v1");
    expect(result.document.days[0].transports[0]).toMatchObject({ category: "train", name: "電車", duration_minutes: 10 });
    expect(input.days[0].transports[0].category).toBe(alias);
  }
  const unknown = validAiDocument();
  unknown.days[0].transports[0].category = "teleport";
  expect(parseAiItineraryText(JSON.stringify(unknown)).errors.map((issue) => issue.code)).toContain("invalid_transport_category");
});

test("manual AI QA fixtures stay parser-verified as one valid and one blocking document", () => {
  const valid = parseAiItineraryText(readFileSync("tests/fixtures/manual/phase-7-ai-valid-complete.json", "utf8"));
  expect(valid.ok).toBe(true);
  expect(valid.document.days).toHaveLength(2);
  expect(valid.document.days[0].transports).toHaveLength(1);
  expect(valid.document.days[0].visits[1].alternatives).toHaveLength(1);

  const blocked = parseAiItineraryText(readFileSync("tests/fixtures/manual/phase-7-ai-blocking-error.json", "utf8"));
  expect(blocked.ok).toBe(false);
  expect(blocked.errors.map((error) => error.code)).toContain("fixed_requires_time");
});

test("AI parser safely accepts one fenced or text-wrapped object without guessing repairs", () => {
  const json = JSON.stringify(validAiDocument());
  expect(parseAiItineraryText(`以下是行程：\n\`\`\`json\n${json}\n\`\`\``)).toMatchObject({ ok: true, sourceKind: "markdown_fence" });
  expect(parseAiItineraryText(`以下是行程：\n${json}\n請確認。`)).toMatchObject({ ok: true, sourceKind: "wrapped_json" });
  expect(parseAiItineraryText("{").errors[0].code).toBe("malformed_json");
  expect(parseAiItineraryText("沒有 JSON").errors[0].code).toBe("json_not_found");
  expect(parseAiItineraryText(`${json}\n${json}`).errors[0].code).toBe("ambiguous_json");
  expect(parseAiItineraryText("```json\n{}\n```\n```json\n{}\n```").errors[0].code).toBe("ambiguous_json");
  expect(parseAiItineraryText("{'schema_version':'1'}").ok).toBe(false);
});

test("AI and Formal documents explicitly reject one another", () => {
  const ai = validAiDocument();
  expect(parseTripJsonText(JSON.stringify(ai)).errors.map((error) => error.code)).toContain("invalid_document_type");
  const formal = {
    schema_version: "1",
    document_type: "travel_studio_trip",
    trip: { title: "Formal", destination: { display_name: "京都", country: "日本", city: "京都" }, start_date: "2026-10-01", end_date: "2026-10-01", status: "planning" },
    days: [{ day_index: 0, date: "2026-10-01", visits: [], transports: [] }],
  };
  expect(parseAiItineraryText(JSON.stringify(formal)).errors.map((error) => error.code)).toContain("invalid_document_type");
});

test("version, required, unknown, Day, time, and Fixed invariants are blocking", () => {
  const unsupported = validAiDocument();
  unsupported.schema_version = "999";
  expect(parseAiItineraryText(JSON.stringify(unsupported)).errors[0].code).toBe("unsupported_schema_version");

  const invalid = validAiDocument();
  delete invalid.trip.title;
  invalid.trip.provider_object = {};
  invalid.days[0].date = "2026-10-02";
  invalid.days[0].visits[0].schedule = { kind: "timed", start: "24:00", end: "09:00" };
  invalid.days[0].visits[1].fixed = true;
  const codes = validateAiItineraryDocument(invalid).errors.map((error) => error.code);
  expect(codes).toEqual(expect.arrayContaining(["missing_field", "unknown_field", "invalid_day_date", "invalid_time", "fixed_requires_time"]));
});

test("transport visit numbers and alternative duration-only schedules are rejected", () => {
  const document = validAiDocument();
  document.days[0].transports[0].to_visit_number = 1;
  document.days[0].transports.push({ ...document.days[0].transports[1] });
  document.days[0].visits[0].alternatives[0].schedule = { kind: "duration", duration_minutes: 30 };
  const codes = validateAiItineraryDocument(document).errors.map((error) => error.code);
  expect(codes).toEqual(expect.arrayContaining(["invalid_transport_relation", "duplicate_transport", "alternative_duration_requires_anchor"]));
});

test("AI Draft converts durations, alternatives, transports, multiple Days, and exact 24:00 into Formal v1", () => {
  const ai = validAiDocument();
  const result = buildFormalTripJsonFromAiDraft(ai);
  expect(result.ok).toBe(true);
  expect(result.document).toMatchObject({ schema_version: "1", document_type: "travel_studio_trip" });
  expect(result.document.days).toHaveLength(2);
  expect(result.document.days[0].visits[1].time).toEqual({ start: "10:10", end: "10:55" });
  expect(result.document.days[0].visits[2].time.end).toBe("24:00");
  expect(result.document.days[0].visits[0].alternatives).toHaveLength(1);
  expect(result.document.days[0].transports[0]).toMatchObject({ from_visit_ref: "day-1-visit-1", to_visit_ref: "day-1-visit-2" });
  expect(result.warnings.map((warning) => warning.code)).toContain("duration_auto_scheduled");
});

test("duration-only without a safe anchor becomes Untimed and conflicts between explicit times block", () => {
  const noAnchor = validAiDocument();
  noAnchor.days[0].visits[0].fixed = false;
  noAnchor.days[0].visits[0].schedule = { kind: "duration", duration_minutes: 60 };
  const safe = buildFormalTripJsonFromAiDraft(noAnchor);
  expect(safe.ok).toBe(true);
  expect(safe.document.days[0].visits[0].time).toBeNull();
  expect(safe.warnings.map((warning) => warning.code)).toContain("duration_without_anchor");

  const conflict = validAiDocument();
  conflict.days[0].visits[1].schedule = { kind: "timed", start: "09:30", end: "10:30" };
  const blocked = buildFormalTripJsonFromAiDraft(conflict);
  expect(blocked.ok).toBe(false);
  expect(blocked.errors.map((error) => error.code)).toContain("timeline_time_conflict");
  expect(blocked.errors.find((error) => error.code === "timeline_time_conflict")?.message).toContain("至少應為 10:10");
});

test("AI locations convert directly, missing coordinates remain null, and partial pairs block", () => {
  const ai = validAiDocument();
  ai.days[0].visits[0].location = {
    name: "清水寺",
    map_url: "https://maps.example/kiyomizu",
    latitude: 34.9948561,
    longitude: 135.7850463,
  };
  const result = buildFormalTripJsonFromAiDraft(ai);
  expect(result.ok).toBe(true);
  expect(result.document.days[0].visits[0].location).toEqual(ai.days[0].visits[0].location);
  expect(result.document.days[0].visits[1].location).toMatchObject({ latitude: null, longitude: null });

  ai.days[0].visits[0].location.longitude = null;
  const partial = buildFormalTripJsonFromAiDraft(ai);
  expect(partial.ok).toBe(false);
  expect(partial.errors.map((error) => error.code)).toContain("invalid_coordinate_pair");
});

test("Formal domain exports a minimal AI document and vendor-neutral clipboard instructions", () => {
  const trip = { id: "trip-secret", title: "京都", name: "京都", destination: "京都", destination_country: "日本", destination_city: "京都", start_date: "2026-10-01", end_date: "2026-10-01", status: "planning", owner_id: "owner-secret" };
  const items = [
    { id: "visit-secret", trip_id: "trip-secret", day_index: 0, item_type: "visit", type: "attraction", title: "清水寺", location_name: "清水寺", address: "京都市東山區", latitude: 34.99, longitude: 135.78, map_url: "https://maps.example", start_time: "09:00:00", end_time: "10:00:00", is_fixed: true, sort_order: 10 },
  ];
  const result = buildAiItineraryDocument({ alternatives: [], items, trip });
  expect(result.ok).toBe(true);
  const serialized = JSON.stringify(result.document);
  expect(serialized).not.toContain("trip-secret");
  expect(serialized).not.toContain("owner-secret");
  expect(result.document.days[0].visits[0].location).toEqual({
    name: "清水寺",
    map_url: "https://maps.example",
    latitude: 34.99,
    longitude: 135.78,
  });
  const clipboard = buildAiItineraryClipboardText(result.document);
  expect(clipboard).toContain("name、map_url、latitude、longitude");
  expect(clipboard).toContain("不輸出 address 或 Place ID");
  expect(clipboard).toContain('"document_type": "travel_studio_ai_itinerary"');
  expect(clipboard).not.toContain("OpenAI");
  expect(clipboard).not.toContain("Gemini");
});
