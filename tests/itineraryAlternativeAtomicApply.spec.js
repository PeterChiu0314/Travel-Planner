import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const migrationPath = "supabase/migrations/20260811150000_atomic_apply_itinerary_alternative.sql";
const migration = readFileSync(migrationPath, "utf8");
const appSource = readFileSync("src/App.jsx", "utf8");

test("alternative apply RPC is atomic, permission checked, locked, and stale guarded", () => {
  expect(migration).toContain("app_private.apply_itinerary_alternative");
  expect(migration).toContain("public.apply_itinerary_alternative");
  expect(migration).toContain("app_private.can_edit_trip");
  expect(migration).toContain("for update;");
  expect(migration).toContain("raise exception 'permission_denied'");
  expect(migration).toContain("raise exception 'fixed_item'");
  expect(migration).toContain("raise exception 'item_locked'");
  expect(migration).toContain("raise exception 'stale_item'");
  expect(migration).toContain("raise exception 'stale_alternative'");
  expect(migration).toContain("update public.itinerary_items item");
  expect(migration).toContain("update public.itinerary_alternatives alternative");
  expect(migration).toContain(
    "grant execute on function public.apply_itinerary_alternative(uuid, uuid, timestamptz, timestamptz) to authenticated",
  );
  expect(migration).toContain(
    "revoke execute on function app_private.apply_itinerary_alternative(uuid, uuid, timestamptz, timestamptz) from authenticated",
  );
});

test("alternative apply preserves slot, schedule, transport, budget, and fixed fields", () => {
  const itemUpdate = migration.match(/update public\.itinerary_items item\s+set([\s\S]*?)where item\.id = target_item_id/);
  expect(itemUpdate).not.toBeNull();
  expect(itemUpdate[1]).not.toMatch(
    /^\s*(?:id|trip_id|day_index|date|start_time|end_time|sort_order|item_type|is_fixed|fixed_at|fixed_by|locked_by|locked_at|from_item_id|to_item_id|transport_duration_minutes|transport_role)\s*=/m,
  );
  expect(migration).not.toContain("update public.itinerary_budget_items");
  expect(migration).not.toContain("delete from public.itinerary_budget_items");
  expect(migration).not.toMatch(/update public\.itinerary_items[\s\S]*?where item\.item_type = 'transport'/);

  const alternativeUpdate = migration.match(
    /update public\.itinerary_alternatives alternative\s+set([\s\S]*?)where alternative\.id = target_alternative_id/,
  );
  expect(alternativeUpdate).not.toBeNull();
  expect(alternativeUpdate[1]).toContain("start_time = original_item.start_time");
  expect(alternativeUpdate[1]).toContain("end_time = original_item.end_time");
  expect(alternativeUpdate[1]).not.toMatch(/^\s*(?:id|itinerary_item_id|created_at)\s*=/m);
});

test("Formal alternative apply uses only the atomic RPC with both revision baselines", () => {
  const applyAlternativeBody = appSource.match(
    /async function applyAlternative\(item, alternative\) \{([\s\S]*?)\r?\n  \}\r?\n\r?\n  async function saveBudget/,
  );
  expect(applyAlternativeBody).not.toBeNull();
  expect(applyAlternativeBody[1]).toContain('supabase.rpc("apply_itinerary_alternative"');
  expect(applyAlternativeBody[1]).toContain("item_updated_at_baseline: item.updated_at");
  expect(applyAlternativeBody[1]).toContain("alternative_updated_at_baseline: alternative.updated_at");
  expect(applyAlternativeBody[1]).not.toContain('supabase.from("itinerary_items")');
  expect(applyAlternativeBody[1]).not.toContain('supabase.from("itinerary_alternatives")');
  expect(applyAlternativeBody[1]).not.toContain("ensureItineraryItemEditable");
  expect(appSource).toContain("行程或備案已由其他成員更新");
});
