import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  insertionPackageOrder,
  isSamePackageOrder,
  planDestinationPackageReorder,
} from "../src/lib/destinationPackages.js";

const migration = readFileSync("supabase/migrations/020_reorder_itinerary_destination_packages.sql", "utf8");
const baselineCountFixMigration = readFileSync("supabase/migrations/021_fix_reorder_baseline_count.sql", "utf8");

function visit(id, title, startTime, sortOrder, extra = {}) {
  return {
    id,
    trip_id: "trip-1",
    day_index: 0,
    item_type: "visit",
    type: "attraction",
    title,
    location_name: `Destination ${title}`,
    start_time: startTime,
    end_time: startTime ? startTime.replace(":00", ":45") : null,
    sort_order: sortOrder,
    is_fixed: false,
    updated_at: `2026-06-21T00:00:0${sortOrder / 10}.000Z`,
    ...extra,
  };
}

function transport(id, fromItemId, toItemId, extra = {}) {
  return {
    id,
    trip_id: "trip-1",
    day_index: 0,
    item_type: "transport",
    title: id,
    from_item_id: fromItemId,
    to_item_id: toItemId,
    transport_duration_minutes: 20,
    from_snapshot_title: `snapshot-${fromItemId}`,
    to_snapshot_title: toItemId ? `snapshot-${toItemId}` : null,
    updated_at: "2026-06-21T00:01:00.000Z",
    ...extra,
  };
}

function fixture() {
  const visits = [
    visit("slot-a", "A", "09:00", 10),
    visit("slot-b", "B", "10:00", 20),
    visit("slot-c", "C", "11:00", 30),
    visit("slot-d", "D", "12:00", 40),
  ];
  return {
    visits,
    items: [
      ...visits,
      transport("transport-ab", "slot-a", "slot-b"),
      transport("transport-bc", "slot-b", "slot-c"),
      transport("transport-cd", "slot-c", "slot-d"),
      transport("transport-tail-d", "slot-d", null),
    ],
    alternatives: visits.map((item) => ({ id: `alt-${item.title}`, itinerary_item_id: item.id, title: item.title })),
    links: visits.map((item) => ({
      id: `link-${item.title}`,
      itinerary_item_id: item.id,
      budget_item_id: `budget-${item.title}`,
      created_at: "2026-06-20T00:00:00.000Z",
    })),
  };
}

test("insertion package order normalizes upward, downward, and no-op drops", () => {
  const slots = ["slot-a", "slot-b", "slot-c", "slot-d"];
  expect(insertionPackageOrder(slots, "slot-a", "slot-c", "after")).toEqual([
    "slot-b",
    "slot-c",
    "slot-a",
    "slot-d",
  ]);
  expect(insertionPackageOrder(slots, "slot-d", "slot-b", "before")).toEqual([
    "slot-a",
    "slot-d",
    "slot-b",
    "slot-c",
  ]);
  expect(insertionPackageOrder(slots, "slot-b", "slot-c", "before")).toEqual(slots);
  expect(isSamePackageOrder(slots, insertionPackageOrder(slots, "slot-b", "slot-c", "before"))).toBe(true);
});

test("ABCD to BCAD keeps slots and moves destination packages and children", () => {
  const data = fixture();
  const slots = data.visits.map((item) => item.id);
  const sources = insertionPackageOrder(slots, "slot-a", "slot-c", "after");
  const plan = planDestinationPackageReorder({
    items: data.items,
    alternatives: data.alternatives,
    itineraryBudgetLinks: data.links,
    slotItemIds: slots,
    packageSourceItemIds: sources,
    updatedAt: "2026-06-22T00:00:00.000Z",
  });

  expect(plan.ok).toBe(true);
  const nextVisits = slots.map((slotId) => plan.items.find((item) => item.id === slotId));
  expect(nextVisits.map((item) => item.title)).toEqual(["B", "C", "A", "D"]);
  expect(nextVisits.map((item) => [item.id, item.start_time, item.end_time])).toEqual(
    data.visits.map((item) => [item.id, item.start_time, item.end_time]),
  );
  expect(plan.alternatives.map((item) => [item.id, item.itinerary_item_id])).toEqual([
    ["alt-A", "slot-c"],
    ["alt-B", "slot-a"],
    ["alt-C", "slot-b"],
    ["alt-D", "slot-d"],
  ]);
  expect(plan.itineraryBudgetLinks.map((item) => [item.id, item.itinerary_item_id, item.created_at])).toEqual([
    ["link-A", "slot-c", "2026-06-20T00:00:00.000Z"],
    ["link-B", "slot-a", "2026-06-20T00:00:00.000Z"],
    ["link-C", "slot-b", "2026-06-20T00:00:00.000Z"],
    ["link-D", "slot-d", "2026-06-20T00:00:00.000Z"],
  ]);
});

test("reorder preserves only original directed adjacent transports and remaps anchors", () => {
  const data = fixture();
  const slots = data.visits.map((item) => item.id);
  const plan = planDestinationPackageReorder({
    items: data.items,
    slotItemIds: slots,
    packageSourceItemIds: ["slot-b", "slot-c", "slot-a", "slot-d"],
    updatedAt: "2026-06-22T00:00:00.000Z",
  });

  expect(plan.ok).toBe(true);
  expect(plan.preservedTransportIds).toEqual(["transport-bc", "transport-tail-d"]);
  expect(plan.deletedTransportIds).toEqual(["transport-ab", "transport-cd"]);
  expect(plan.items.find((item) => item.id === "transport-bc")).toMatchObject({
    from_item_id: "slot-a",
    to_item_id: "slot-b",
    from_snapshot_title: "snapshot-slot-b",
    to_snapshot_title: "snapshot-slot-c",
  });
  expect(plan.items.find((item) => item.id === "transport-tail-d")).toMatchObject({
    from_item_id: "slot-d",
    to_item_id: null,
  });
  expect(plan.items.some((item) => item.from_item_id === "slot-b" && item.to_item_id === "slot-c")).toBe(false);
});

test("D before B produces ADBC while untimed visits stay outside the manifest", () => {
  const data = fixture();
  const untimed = visit("untimed", "UNTIMED", null, 50);
  const items = [...data.items, untimed];
  const slots = data.visits.map((item) => item.id);
  const sources = insertionPackageOrder(slots, "slot-d", "slot-b", "before");
  const plan = planDestinationPackageReorder({ items, slotItemIds: slots, packageSourceItemIds: sources });

  expect(plan.ok).toBe(true);
  expect(slots.map((slotId) => plan.items.find((item) => item.id === slotId).title)).toEqual(["A", "D", "B", "C"]);
  expect(plan.items.find((item) => item.id === "untimed")).toEqual(untimed);
  expect(plan.preservedTransportIds).toEqual(["transport-bc"]);
  expect(plan.deletedTransportIds).toEqual(["transport-ab", "transport-cd", "transport-tail-d"]);
});

test("tail is deleted when its original package is no longer last and no replacement is created", () => {
  const data = fixture();
  const slots = data.visits.map((item) => item.id);
  const plan = planDestinationPackageReorder({
    items: data.items,
    slotItemIds: slots,
    packageSourceItemIds: ["slot-d", "slot-a", "slot-b", "slot-c"],
  });

  expect(plan.ok).toBe(true);
  expect(plan.deletedTransportIds).toContain("transport-tail-d");
  expect(plan.items.filter((item) => item.item_type === "transport" && !item.to_item_id)).toHaveLength(0);
  expect(plan.preservedTransportIds).toEqual(["transport-ab", "transport-bc"]);
  expect(plan.items.find((item) => item.id === "transport-ab")).toMatchObject({
    from_item_id: "slot-b",
    to_item_id: "slot-c",
  });
  expect(plan.items.find((item) => item.id === "transport-bc")).toMatchObject({
    from_item_id: "slot-c",
    to_item_id: "slot-d",
  });
});

test("planner rejects incomplete manifests and any fixed timed visit", () => {
  const data = fixture();
  expect(
    planDestinationPackageReorder({
      items: data.items,
      slotItemIds: ["slot-a", "slot-b", "slot-c"],
      packageSourceItemIds: ["slot-b", "slot-c", "slot-a"],
    }),
  ).toMatchObject({ ok: false, errorCode: "stale_manifest" });

  const fixedItems = data.items.map((item) => (item.id === "slot-c" ? { ...item, is_fixed: true } : item));
  expect(
    planDestinationPackageReorder({
      items: fixedItems,
      slotItemIds: data.visits.map((item) => item.id),
      packageSourceItemIds: ["slot-b", "slot-c", "slot-a", "slot-d"],
    }),
  ).toMatchObject({ ok: false, errorCode: "fixed_item" });
});

test("020 RPC is transactional, manifest-based, collision-safe, and least-privilege", () => {
  expect(migration).toContain("app_private.reorder_itinerary_destination_packages");
  expect(migration).toContain("public.reorder_itinerary_destination_packages");
  expect(migration).toContain("security definer");
  expect(migration).toContain("set search_path = public, app_private");
  expect(migration).toContain("pg_advisory_xact_lock");
  expect(migration).toMatch(/order by item\.id\r?\n  for update/);
  expect(migration).toContain("authoritative_slot_ids is distinct from slot_item_ids");
  expect(migration).toContain("manifest_not_permutation");
  expect(migration).toContain("raise exception 'fixed_item'");
  expect(migration).toContain("raise exception 'item_locked'");
  expect(migration).toContain("raise exception 'stale_item'");
  expect(migration).toContain("raise exception 'transport_state_changed'");
  expect(migration).toContain("delete from public.itinerary_budget_items");
  expect(migration).toContain("insert into public.itinerary_budget_items");
  expect(migration).toMatch(/set from_item_id = null,\s+to_item_id = null/);
  expect(migration).not.toMatch(/from_snapshot_[a-z_]+\s*=/);
  expect(migration).not.toMatch(/to_snapshot_[a-z_]+\s*=/);
  expect(migration).toContain(
    "revoke execute on function app_private.reorder_itinerary_destination_packages(uuid, integer, uuid[], uuid[], jsonb) from authenticated",
  );
  expect(migration).toContain(
    "grant execute on function public.reorder_itinerary_destination_packages(uuid, integer, uuid[], uuid[], jsonb) to authenticated",
  );
});

test("021 replaces the unsupported JSON baseline cardinality helper", () => {
  expect(baselineCountFixMigration).toContain("jsonb_object_keys(item_updated_at_baselines)");
  expect(baselineCountFixMigration).not.toContain("jsonb_object_length(item_updated_at_baselines)");
  expect(baselineCountFixMigration).toContain(
    "revoke execute on function app_private.reorder_itinerary_destination_packages(uuid, integer, uuid[], uuid[], jsonb) from authenticated",
  );
});
