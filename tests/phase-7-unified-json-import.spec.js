import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { parseUnifiedTripJsonText } from "../src/lib/unifiedTripJsonImport.js";
import { buildAiItineraryPromptExample } from "../src/lib/aiItineraryAdapters.js";
import { buildTripImportPersistencePayload } from "../src/lib/tripJsonAdapters.js";

function formalDocument() {
  return {
    schema_version: "1",
    document_type: "travel_studio_trip",
    trip: {
      title: "正式 JSON",
      destination: { display_name: "日本 · 京都", country: "日本", city: "京都" },
      start_date: "2026-10-01",
      end_date: "2026-10-01",
      status: "planning",
    },
    days: [{ day_index: 0, date: "2026-10-01", visits: [], transports: [] }],
  };
}

test("unified JSON import keeps Formal documents on the strict Formal parser", () => {
  const result = parseUnifiedTripJsonText(JSON.stringify(formalDocument()));
  expect(result.ok).toBe(true);
  expect(result.sourceDocumentType).toBe("travel_studio_trip");
  expect(result.document).toEqual(formalDocument());
});

test("unified JSON import converts AI documents into validated Formal documents", () => {
  const text = readFileSync("tests/fixtures/manual/phase-7-ai-valid-complete.json", "utf8");
  const result = parseUnifiedTripJsonText(text);
  expect(result.ok).toBe(true);
  expect(result.sourceDocumentType).toBe("travel_studio_ai_itinerary");
  expect(result.document).toMatchObject({ document_type: "travel_studio_trip", schema_version: "1" });
  expect(result.document.trip.title).toBe("京都 AI 交換測試");
});

test("unified JSON import does not apply AI compatibility to unknown or malformed documents", () => {
  const unknown = parseUnifiedTripJsonText(JSON.stringify({ ...formalDocument(), document_type: "vendor_trip" }));
  expect(unknown.ok).toBe(false);
  expect(unknown.errors.map((error) => error.code)).toContain("invalid_document_type");

  const malformed = parseUnifiedTripJsonText("{");
  expect(malformed.ok).toBe(false);
  expect(malformed.errors[0].code).toBe("malformed_json");
});

test("unified JSON import preserves blocking AI validation errors", () => {
  const text = readFileSync("tests/fixtures/manual/phase-7-ai-blocking-error.json", "utf8");
  const result = parseUnifiedTripJsonText(text);
  expect(result.ok).toBe(false);
  expect(result.sourceDocumentType).toBe("travel_studio_ai_itinerary");
  expect(result.errors.map((error) => error.code)).toContain("fixed_requires_time");
});

test("normal AI duration continuation is not a warning but missing coordinates remain non-blocking", () => {
  const result = parseUnifiedTripJsonText(JSON.stringify(buildAiItineraryPromptExample()));
  expect(result.ok).toBe(true);
  expect(result.document.days[0].visits[1].time).toEqual({ start: "10:45", end: "11:45" });
  expect(result.warnings.map((issue) => issue.code)).not.toContain("duration_auto_scheduled");
  expect(result.warnings).toContainEqual({ code: "missing_coordinates", path: "$.days", message: "尚有 3 個目的地缺少可用座標" });
  expect(buildTripImportPersistencePayload(result.document).ok).toBe(true);
});

test("AI unsafe continuation and real Fixed conflicts remain visible without silent rescheduling", () => {
  const example = buildAiItineraryPromptExample();
  example.days[0].visits[0].schedule = { kind: "untimed" };
  let result = parseUnifiedTripJsonText(JSON.stringify(example));
  expect(result.ok).toBe(true);
  expect(result.warnings.map((issue) => issue.code)).toContain("duration_without_anchor");
  expect(result.document.days[0].visits[1].time).toBeNull();

  example.days[0].visits[0].schedule = { kind: "timed", start: "09:00", end: "10:30" };
  example.days[0].visits[1].fixed = true;
  example.days[0].visits[1].schedule = { kind: "timed", start: "10:30", end: "11:30" };
  result = parseUnifiedTripJsonText(JSON.stringify(example));
  expect(result.ok).toBe(false);
  expect(result.document).toBeNull();
  expect(result.errors.map((issue) => issue.code)).toContain("timeline_time_conflict");
});

test("unfinished draft permits unknown dining, no flights or hotels, and an intentionally empty day", () => {
  const text = readFileSync("tests/fixtures/manual/phase-7-ai-draft-duration.json", "utf8");
  const result = parseUnifiedTripJsonText(text);
  expect(result.ok).toBe(true);
  expect(result.document.days).toHaveLength(2);
  expect(result.document.days[1].visits).toEqual([]);
  expect(result.document.days[0].visits[1].time).toEqual({ start: "10:45", end: "11:45" });
  expect(result.warnings.filter((issue) => issue.code === "missing_coordinates")).toEqual([
    { code: "missing_coordinates", path: "$.days", message: "尚有 1 個目的地缺少可用座標" },
  ]);
  expect(buildTripImportPersistencePayload(result.document).ok).toBe(true);
});

test("Gemini subway category reaches the common Formal payload without changing travel times", () => {
  const example = buildAiItineraryPromptExample();
  example.days[0].transports[0].category = "subway";
  const result = parseUnifiedTripJsonText(JSON.stringify(example));
  expect(result.ok).toBe(true);
  expect(result.document.days[0].transports[0].category).toBe("train");
  expect(result.document.days[0].transports[0].duration_minutes).toBe(15);
  expect(result.document.days[0].visits[1].time).toEqual({ start: "10:45", end: "11:45" });
  expect(buildTripImportPersistencePayload(result.document).ok).toBe(true);
});
