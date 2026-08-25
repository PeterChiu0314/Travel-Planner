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

  const prompt = buildAiItineraryCreatePrompt();
  expect(prompt).toContain("資訊完整後，建立");
  expect(prompt).toContain("先向使用者提問");
  expect(prompt).toContain("不可保留空白必要欄位");
  expect(prompt).toContain("可下載的 .json 檔案");
  expect(prompt).toContain("不要建立 Google 文件");
  expect(prompt).toContain("start_time 或 end_time");
  expect(prompt).toContain("不可使用 mode 欄位");
  expect(prompt).toContain("必須是 1→2");
  expect(prompt).toContain("絕對不可使用 0");
  expect(prompt).toContain("transport.duration_minutes");
  expect(prompt).toContain("不可重疊");
  expect(prompt).toContain("name、map_url、latitude、longitude");
  expect(prompt).toContain("正確地圖 URL、緯度與經度");
  expect(prompt).toContain("不要輸出 address 或 Place ID");
  expect(prompt).not.toContain("OpenAI");
  expect(prompt).not.toContain("Gemini");
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
  expect(clipboard).toContain("不要輸出 address 或 Place ID");
  expect(clipboard).toContain('"document_type": "travel_studio_ai_itinerary"');
  expect(clipboard).not.toContain("OpenAI");
  expect(clipboard).not.toContain("Gemini");
});
