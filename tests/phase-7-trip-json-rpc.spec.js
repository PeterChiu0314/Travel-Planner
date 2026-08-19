import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20260819125851_phase_7_import_trip_timeline_v1.sql",
  "utf8",
);
const appSource = readFileSync("src/App.jsx", "utf8");

test("Phase 7 import is one authenticated security-invoker RPC transaction", () => {
  expect(migration).toContain("create or replace function public.import_trip_timeline_v1(payload jsonb)");
  expect(migration).toContain("security invoker");
  expect(migration).toContain("caller_id uuid := auth.uid()");
  expect(migration).toContain("raise exception 'permission_denied'");
  expect(migration).toContain(
    "revoke all on function public.import_trip_timeline_v1(jsonb) from public, anon, authenticated",
  );
  expect(migration).toContain(
    "grant execute on function public.import_trip_timeline_v1(jsonb) to authenticated",
  );
});

test("Phase 7 RPC creates the Trip owner and complete Timeline graph", () => {
  expect(migration).toContain("insert into public.trips");
  expect(migration).toContain("insert into public.trip_members");
  expect(migration).toContain("insert into public.itinerary_alternatives");
  expect(migration.match(/insert into public\.itinerary_items/g)).toHaveLength(2);
  expect(migration).toContain("'normal_pair'");
  expect(migration).toContain("from_item_id");
  expect(migration).toContain("to_item_id");
  expect(migration).toContain("from_snapshot_start_time");
  expect(migration).toContain("to_snapshot_end_time");
});

test("Phase 7 RPC repeats schema, Day, time, fixed, coordinate, and relation invariants", () => {
  expect(migration).toContain("unsupported_schema_version");
  expect(migration).toContain("invalid_document_type");
  expect(migration).toContain("invalid_day_count");
  expect(migration).toContain("invalid_day_sequence");
  expect(migration).toContain("partial_time");
  expect(migration).toContain("fixed_requires_time");
  expect(migration).toContain("invalid_coordinates");
  expect(migration).toContain("invalid_alternative_coordinates");
  expect(migration).toContain("invalid_transport_relation");
  expect(migration).toContain("invalid_transport_crossing");
  expect(migration).toContain("duplicate_transport_pair");
  expect(migration).toContain("invalid_transport_scope");
  expect(migration).toContain("transport_duration_value < 1 or transport_duration_value > 1440");
});

test("portable refs are Day-scoped and SQL regexes stay PostgreSQL compatible", () => {
  expect(migration).toContain("scoped_ref := target_day_index::text || ':' || visit_ref");
  expect(migration).toContain("ref_map ->> (target_day_index::text || ':' || from_visit_ref)");
  expect(migration).not.toContain("(?:");
});

test("Formal import previews locally and performs no writes before confirmation", () => {
  const previewBody = appSource.match(
    /async function previewTripImport\(file\) \{([\s\S]*?)\r?\n  \}\r?\n\r?\n  async function confirmTripImport/,
  );
  expect(previewBody).not.toBeNull();
  expect(previewBody[1]).toContain("file.text()");
  expect(previewBody[1]).toContain("parseTripJsonText(text)");
  expect(previewBody[1]).toContain("buildTripJsonPreview");
  expect(previewBody[1]).not.toContain("supabase.");
});

test("Formal commit uses only the atomic import RPC and selects the returned Trip", () => {
  const commitBody = appSource.match(
    /async function confirmTripImport\(\) \{([\s\S]*?)\r?\n  \}\r?\n\r?\n  async function updateTrip/,
  );
  expect(commitBody).not.toBeNull();
  expect(commitBody[1]).toContain('supabase.rpc("import_trip_timeline_v1"');
  expect(commitBody[1]).toContain("buildTripImportPersistencePayload");
  expect(commitBody[1]).toContain("await loadTrips(data.trip_id)");
  expect(commitBody[1]).not.toContain('supabase.from("trips")');
  expect(commitBody[1]).not.toContain('supabase.from("itinerary_items")');
  expect(commitBody[1]).not.toContain("delete(");
});

test("Formal export uses the versioned adapter instead of dumping database rows", () => {
  const exportBody = appSource.match(
    /function exportTrip\(\) \{([\s\S]*?)\r?\n  \}\r?\n\r?\n  async function selectTrip/,
  );
  expect(exportBody).not.toBeNull();
  expect(exportBody[1]).toContain("serializeTripToJson");
  expect(exportBody[1]).not.toContain("pack_items");
  expect(exportBody[1]).not.toContain("members");
  expect(exportBody[1]).not.toContain("JSON.stringify");
});
