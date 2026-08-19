import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  buildTripJsonPreview,
  parseTripJsonText,
  stringifyTripJsonDocument,
  tripJsonCurrentSchemaVersion,
  tripJsonMigrationSteps,
  validateTripJsonDocument,
} from "../src/lib/tripJsonContract.js";
import {
  buildTripImportPersistencePayload,
  buildTripJsonDocument,
  serializeTripToJson,
  tripJsonSemanticSignature,
} from "../src/lib/tripJsonAdapters.js";

function location(overrides = {}) {
  return {
    name: null,
    address: null,
    map_url: null,
    latitude: null,
    longitude: null,
    ...overrides,
  };
}

function alternative(overrides = {}) {
  return {
    category: "food",
    title: "備案餐廳",
    location: location({ name: "備案餐廳" }),
    notes: "雨天備案",
    estimated_cost: 500,
    time: { start: "10:00", end: "11:00" },
    ...overrides,
  };
}

function visit(ref, overrides = {}) {
  return {
    ref,
    category: "attraction",
    title: ref,
    location: location({ name: ref }),
    notes: null,
    estimated_cost: 0,
    time: { start: "09:00", end: "10:00" },
    fixed: false,
    alternatives: [],
    ...overrides,
  };
}

function validDocument() {
  return {
    schema_version: "1",
    document_type: "travel_studio_trip",
    trip: {
      title: "Phase 7 Round Trip",
      destination: { display_name: "日本 · 京都", country: "日本", city: "京都" },
      start_date: "2026-08-19",
      end_date: "2026-08-20",
      status: "planning",
    },
    days: [
      {
        day_index: 0,
        date: "2026-08-19",
        visits: [
          visit("day-1-visit-1", { fixed: true, alternatives: [alternative()] }),
          visit("day-1-visit-2", { time: null, title: "未設定時間" }),
          visit("day-1-visit-3", { time: { start: "10:30", end: "11:30" } }),
        ],
        transports: [
          {
            ref: "day-1-transport-1",
            from_visit_ref: "day-1-visit-1",
            to_visit_ref: "day-1-visit-3",
            category: "train",
            name: "JR 奈良線",
            duration_minutes: 15,
            notes: "保留座位",
          },
        ],
      },
      { day_index: 1, date: "2026-08-20", visits: [], transports: [] },
    ],
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function persistedPayloadToRows(payload) {
  const idByRef = new Map();
  const items = [];
  const alternatives = [];
  payload.days.forEach((day) => {
    day.visits.forEach((item, index) => {
      const id = `new-${item.ref}`;
      idByRef.set(item.ref, id);
      items.push({
        ...item,
        id,
        trip_id: "new-trip",
        day_index: day.day_index,
        date: day.date,
        item_type: "visit",
        location: item.location_name,
        note: item.description,
        is_fixed: item.is_fixed,
      });
      item.alternatives.forEach((entry, alternativeIndex) => {
        alternatives.push({
          ...entry,
          id: `alternative-${index}-${alternativeIndex}`,
          itinerary_item_id: id,
          created_at: `2026-08-19T00:00:0${alternativeIndex}Z`,
        });
      });
    });
  });
  payload.days.forEach((day) => {
    day.transports.forEach((transport) => {
      items.push({
        id: `new-${transport.ref}`,
        trip_id: "new-trip",
        day_index: day.day_index,
        date: day.date,
        sort_order: transport.sort_order,
        item_type: "transport",
        type: "transport",
        title: transport.transport_name,
        transport_role: "normal_pair",
        from_item_id: idByRef.get(transport.from_visit_ref),
        to_item_id: idByRef.get(transport.to_visit_ref),
        transport_category: transport.transport_category,
        transport_name: transport.transport_name,
        transport_duration_minutes: transport.transport_duration_minutes,
        transport_note: transport.transport_note,
      });
    });
  });
  const trip = {
    id: "new-trip",
    title: payload.trip.title,
    name: payload.trip.title,
    destination: payload.trip.destination,
    destination_country: payload.trip.destination_country,
    destination_city: payload.trip.destination_city,
    start_date: payload.trip.start_date,
    end_date: payload.trip.end_date,
    status: payload.trip.status,
  };
  return { alternatives, items, trip };
}

test("v1 schema is a portable contract rather than a Supabase row dump", () => {
  const schema = JSON.parse(readFileSync("src/contracts/trip-timeline.v1.schema.json", "utf8"));
  const source = JSON.stringify(schema);
  expect(schema.properties.schema_version.const).toBe("1");
  expect(schema.properties.document_type.const).toBe("travel_studio_trip");
  expect(source).toContain("from_visit_ref");
  expect(source).not.toContain("owner_id");
  expect(source).not.toContain("locked_by");
  expect(source).not.toContain("updated_at");
  expect(source).not.toContain("from_snapshot_start_time");
  expect(source).not.toContain("sort_order");
});

test("valid v1 JSON normalizes, validates, and creates a complete preview", () => {
  const result = parseTripJsonText(stringifyTripJsonDocument(validDocument()));
  expect(result.ok).toBeTruthy();
  expect(result.document.schema_version).toBe(tripJsonCurrentSchemaVersion);
  expect(result.warnings.map((warning) => warning.code)).toContain("suspended_transport");
  const preview = buildTripJsonPreview(result.document, result);
  expect(preview.counts).toEqual({ alternatives: 1, days: 2, fixed: 1, timed: 2, transports: 1, untimed: 1, visits: 3 });
});

test("malformed JSON and schema version failures are reported before validation", () => {
  expect(parseTripJsonText("{").errors[0].code).toBe("malformed_json");
  expect(parseTripJsonText(JSON.stringify({ document_type: "travel_studio_trip" })).errors[0].code).toBe("missing_schema_version");
  expect(parseTripJsonText(JSON.stringify({ schema_version: 1 })).errors[0].code).toBe("invalid_schema_version");
  expect(parseTripJsonText(JSON.stringify({ schema_version: "999" })).errors[0].code).toBe("unsupported_schema_version");
  expect(tripJsonMigrationSteps).toEqual({});
});

test("missing fields, wrong types, and unknown fields fail with paths", () => {
  const document = validDocument();
  delete document.trip.title;
  document.days[0].visits[0].fixed = "yes";
  document.days[0].visits[0].database_id = "do-not-accept";
  const result = validateTripJsonDocument(document);
  expect(result.ok).toBeFalsy();
  expect(result.errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "missing_field", path: "$.trip.title" }),
      expect.objectContaining({ code: "invalid_type", path: "$.days[0].visits[0].fixed" }),
      expect.objectContaining({ code: "unknown_field", path: "$.days[0].visits[0].database_id" }),
    ]),
  );
});

test("invalid dates, Day sequence, Day date, and Day count are rejected", () => {
  const document = validDocument();
  document.trip.start_date = "2026-02-30";
  document.days[0].day_index = 2;
  document.days[1].date = "2026-08-22";
  const result = validateTripJsonDocument(document);
  expect(result.errors.map((error) => error.code)).toEqual(
    expect.arrayContaining(["invalid_date", "invalid_day_sequence"]),
  );

  const missingDay = validDocument();
  missingDay.days.pop();
  expect(validateTripJsonDocument(missingDay).errors.map((error) => error.code)).toContain("day_count_mismatch");

  const reversed = validDocument();
  reversed.trip.end_date = "2026-08-18";
  expect(validateTripJsonDocument(reversed).errors.map((error) => error.code)).toContain("invalid_date_range");
});

test("invalid item type, partial/invalid time representation, and fixed Untimed are rejected", () => {
  const document = validDocument();
  document.days[0].visits[0].category = "museum";
  document.days[0].visits[0].time = { start: "25:00" };
  document.days[0].visits[1].fixed = true;
  const result = validateTripJsonDocument(document);
  expect(result.errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "invalid_item_type" }),
      expect.objectContaining({ code: "missing_field", path: "$.days[0].visits[0].time.end" }),
      expect.objectContaining({ code: "invalid_time" }),
      expect.objectContaining({ code: "fixed_requires_time" }),
    ]),
  );
});

test("transport relationships must resolve, move forward, avoid timed crossings, and stay unique", () => {
  const document = validDocument();
  document.days[0].transports.push({
    ...document.days[0].transports[0],
    ref: "day-1-transport-2",
  });
  document.days[0].transports.push({
    ...document.days[0].transports[0],
    ref: "day-1-transport-3",
    from_visit_ref: "missing",
    to_visit_ref: "day-1-visit-1",
  });
  const result = validateTripJsonDocument(document);
  expect(result.errors.map((error) => error.code)).toEqual(
    expect.arrayContaining(["duplicate_transport_pair", "invalid_relation"]),
  );

  const timedCrossing = validDocument();
  timedCrossing.days[0].visits[1].time = { start: "10:00", end: "10:15" };
  expect(validateTripJsonDocument(timedCrossing).errors.map((error) => error.code)).toContain("invalid_relation");
});

test("portable refs are unique within a Day and may be reused by another Day", () => {
  const crossDayReuse = validDocument();
  crossDayReuse.days[1].visits = [visit("day-1-visit-1")];
  expect(validateTripJsonDocument(crossDayReuse).ok).toBeTruthy();

  const sameDayDuplicate = validDocument();
  sameDayDuplicate.days[0].visits.push(visit("day-1-visit-1", { time: null }));
  expect(validateTripJsonDocument(sameDayDuplicate).errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "duplicate_ref", path: "$.days[0].visits[3].ref" }),
    ]),
  );
});

test("coordinates, costs, and transport duration reject invalid types and ranges", () => {
  const document = validDocument();
  document.days[0].visits[0].location.latitude = 95;
  document.days[0].visits[0].estimated_cost = -1;
  document.days[0].transports[0].duration_minutes = 0;
  const result = validateTripJsonDocument(document);
  expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining(["invalid_range"]));
});

test("export adapter emits only stable Trip + Timeline semantics", () => {
  const trip = {
    id: "trip-internal-id",
    title: "京都：JSON 測試",
    destination: "日本 · 京都",
    destination_country: "日本",
    destination_city: "京都",
    start_date: "2026-08-19",
    end_date: "2026-08-20",
    status: "planning",
    owner_id: "secret-owner-id",
    membership: { role: "owner", status: "approved" },
  };
  const items = [
    {
      id: "visit-a",
      trip_id: trip.id,
      day_index: 0,
      sort_order: 10,
      item_type: "visit",
      type: "attraction",
      title: "清水寺",
      location_name: "清水寺",
      start_time: "09:00:00",
      end_time: "10:00:00",
      cost: 100,
      is_fixed: true,
      fixed_by: "secret-user",
      locked_by: "secret-user",
      updated_at: "secret-time",
    },
    {
      id: "visit-b",
      trip_id: trip.id,
      day_index: 0,
      sort_order: -1998500000,
      item_type: "visit",
      type: "note",
      title: "未設定時間",
      location_name: "途中",
      start_time: null,
      end_time: null,
      cost: 0,
      is_fixed: false,
    },
    {
      id: "visit-c",
      trip_id: trip.id,
      day_index: 0,
      sort_order: 30,
      item_type: "visit",
      type: "food",
      title: "午餐",
      location_name: "午餐店",
      start_time: "10:30:00",
      end_time: "11:30:00",
      cost: 500,
      is_fixed: false,
    },
    {
      id: "transport-a-c",
      trip_id: trip.id,
      day_index: 0,
      sort_order: 20,
      item_type: "transport",
      type: "transport",
      title: "JR 奈良線",
      transport_category: "train",
      transport_name: "JR 奈良線",
      transport_duration_minutes: 15,
      transport_note: "保留座位",
      transport_role: "normal_pair",
      from_item_id: "visit-a",
      to_item_id: "visit-c",
      from_snapshot_start_time: "secret-snapshot",
    },
  ];
  const alternatives = [
    {
      id: "alternative-id",
      itinerary_item_id: "visit-a",
      title: "備案餐廳",
      type: "food",
      location_name: "備案餐廳",
      start_time: "10:00:00",
      end_time: "11:00:00",
      cost: 500,
      description: "雨天備案",
      created_at: "2026-08-19T00:00:00Z",
    },
  ];
  const result = serializeTripToJson({ alternatives, items, trip });
  expect(result.ok).toBeTruthy();
  expect(result.fileName).toBe("京都：JSON 測試.json");
  expect(result.document.days).toHaveLength(2);
  expect(result.document.days[1]).toEqual({ day_index: 1, date: "2026-08-20", visits: [], transports: [] });
  expect(result.document.days[0].visits.map((entry) => entry.title)).toEqual(["清水寺", "未設定時間", "午餐"]);
  expect(result.document.days[0].transports[0]).toMatchObject({
    from_visit_ref: "day-1-visit-1",
    to_visit_ref: "day-1-visit-3",
    duration_minutes: 15,
  });
  expect(result.json).not.toContain("trip-internal-id");
  expect(result.json).not.toContain("secret-owner-id");
  expect(result.json).not.toContain("locked_by");
  expect(result.json).not.toContain("updated_at");
  expect(result.json).not.toContain("from_snapshot_start_time");
  expect(result.json).not.toContain("sort_order");
});

test("export uses the transport category label when the optional transport name is blank", () => {
  const trip = {
    id: "trip-id",
    title: "舊資料交通名稱相容性",
    destination: "日本 · 京都",
    destination_country: "日本",
    destination_city: "京都",
    start_date: "2026-08-19",
    end_date: "2026-08-19",
    status: "planning",
  };
  const items = [
    {
      id: "visit-a",
      trip_id: trip.id,
      day_index: 0,
      sort_order: 10,
      item_type: "visit",
      type: "attraction",
      title: "A",
      start_time: "09:00:00",
      end_time: "10:00:00",
      cost: 0,
      is_fixed: false,
    },
    {
      id: "visit-b",
      trip_id: trip.id,
      day_index: 0,
      sort_order: 30,
      item_type: "visit",
      type: "attraction",
      title: "B",
      start_time: "10:15:00",
      end_time: "11:00:00",
      cost: 0,
      is_fixed: false,
    },
    {
      id: "transport-a-b",
      trip_id: trip.id,
      day_index: 0,
      sort_order: 20,
      item_type: "transport",
      type: "transport",
      title: "",
      transport_category: "train",
      transport_name: "",
      transport_duration_minutes: 15,
      transport_role: "normal_pair",
      from_item_id: "visit-a",
      to_item_id: "visit-b",
    },
  ];

  const result = serializeTripToJson({ alternatives: [], items, trip });

  expect(result.ok).toBeTruthy();
  expect(result.document.days[0].transports[0].name).toBe("電車");
});

test("persistence adapter reconstructs internal ordering without exposing it in JSON", () => {
  const result = buildTripImportPersistencePayload(validDocument());
  expect(result.ok).toBeTruthy();
  const visits = result.payload.days[0].visits;
  expect(visits[0].sort_order).toBe(10);
  expect(visits[1].sort_order).toBeLessThan(-100000000);
  expect(visits[2].sort_order).toBe(30);
  expect(visits[0]).toMatchObject({ is_fixed: true, start_time: "09:00", end_time: "10:00" });
  expect(result.payload.days[0].transports[0]).toMatchObject({
    from_visit_ref: "day-1-visit-1",
    to_visit_ref: "day-1-visit-3",
  });
  expect(result.payload.days[0].transports[0]).not.toHaveProperty("transport_role");
});

test("export-import-persist-export keeps the v1 semantic document stable", () => {
  const original = validDocument();
  const parsed = parseTripJsonText(stringifyTripJsonDocument(original));
  expect(parsed.ok).toBeTruthy();
  const persistence = buildTripImportPersistencePayload(parsed.document);
  expect(persistence.ok).toBeTruthy();
  const reconstructedRows = persistedPayloadToRows(persistence.payload);
  const exported = buildTripJsonDocument(reconstructedRows);
  expect(exported.ok).toBeTruthy();
  expect(tripJsonSemanticSignature(exported.document)).toBe(tripJsonSemanticSignature(original));
});

test("export fails safely when a transport relation cannot be represented", () => {
  const result = buildTripJsonDocument({
    trip: {
      title: "Broken relation",
      destination: "日本",
      destination_country: "日本",
      destination_city: null,
      start_date: "2026-08-19",
      end_date: "2026-08-19",
      status: "planning",
    },
    items: [
      {
        id: "transport-only",
        day_index: 0,
        item_type: "transport",
        type: "transport",
        transport_name: "Missing endpoints",
        transport_category: "train",
        transport_duration_minutes: 10,
        from_item_id: "missing-a",
        to_item_id: "missing-b",
      },
    ],
    alternatives: [],
  });
  expect(result.ok).toBeFalsy();
  expect(result.errors.map((error) => error.code)).toContain("invalid_ref");
});
