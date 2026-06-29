import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  destinationPackageFields,
  swapDestinationPackagesInItems,
  swapItineraryParentIds,
} from "../src/lib/destinationPackages.js";

const migration = readFileSync("supabase/migrations/019_swap_itinerary_destination_packages.sql", "utf8");

test("destination package swap preserves slot and system fields", () => {
  const source = {
    id: "slot-a",
    trip_id: "trip-1",
    day_index: 0,
    start_time: "09:00",
    end_time: "10:00",
    sort_order: 10,
    is_fixed: false,
    locked_by: null,
    from_item_id: null,
    to_item_id: null,
    title: "A",
    location_name: "Destination A",
    note: "Note A",
    cost: 100,
    updated_at: "2026-06-21T00:00:00.000Z",
  };
  const target = {
    ...source,
    id: "slot-b",
    start_time: "11:00",
    end_time: "12:00",
    sort_order: 20,
    title: "B",
    location_name: "Destination B",
    note: "Note B",
    cost: 200,
  };

  const result = swapDestinationPackagesInItems(
    [source, target],
    source.id,
    target.id,
    "2026-06-21T01:00:00.000Z",
  );
  const nextSource = result.find((item) => item.id === source.id);
  const nextTarget = result.find((item) => item.id === target.id);

  expect(destinationPackageFields).toEqual([
    "type",
    "title",
    "location",
    "note",
    "cost",
    "location_name",
    "address",
    "map_url",
    "latitude",
    "longitude",
    "description",
    "transportation_note",
  ]);
  expect(nextSource).toMatchObject({
    id: "slot-a",
    start_time: "09:00",
    end_time: "10:00",
    sort_order: 10,
    title: "B",
    location_name: "Destination B",
    note: "Note B",
    cost: 200,
  });
  expect(nextTarget).toMatchObject({
    id: "slot-b",
    start_time: "11:00",
    end_time: "12:00",
    sort_order: 20,
    title: "A",
    location_name: "Destination A",
    note: "Note A",
    cost: 100,
  });
});

test("alternatives and linked budgets follow the destination package", () => {
  const alternatives = [
    { id: "alt-a", itinerary_item_id: "slot-a" },
    { id: "alt-b", itinerary_item_id: "slot-b" },
  ];
  const budgetLinks = [
    { id: "link-a", itinerary_item_id: "slot-a", budget_item_id: "budget-a" },
    { id: "link-b", itinerary_item_id: "slot-b", budget_item_id: "budget-b" },
  ];

  expect(swapItineraryParentIds(alternatives, "slot-a", "slot-b")).toEqual([
    { id: "alt-a", itinerary_item_id: "slot-b" },
    { id: "alt-b", itinerary_item_id: "slot-a" },
  ]);
  expect(swapItineraryParentIds(budgetLinks, "slot-a", "slot-b")).toEqual([
    { id: "link-a", itinerary_item_id: "slot-b", budget_item_id: "budget-a" },
    { id: "link-b", itinerary_item_id: "slot-a", budget_item_id: "budget-b" },
  ]);
});

test("swap RPC is transactional, narrow, and does not update slot fields", () => {
  expect(migration).toContain("app_private.swap_itinerary_destination_packages");
  expect(migration).toContain("public.swap_itinerary_destination_packages");
  expect(migration).toContain("for update;");
  expect(migration).toContain("app_private.can_edit_trip");
  expect(migration).toContain("raise exception 'fixed_item'");
  expect(migration).toContain("raise exception 'item_locked'");
  expect(migration).toContain("raise exception 'stale_item'");
  expect(migration).toContain("updated_at = now()");
  expect(migration).toContain("update public.itinerary_alternatives");
  expect(migration).toContain("delete from public.itinerary_budget_items");
  expect(migration).toContain("insert into public.itinerary_budget_items");
  expect(migration).toContain("grant execute on function public.swap_itinerary_destination_packages");

  const visitUpdate = migration.match(/update public\.itinerary_items item\s+set([\s\S]*?)where item\.id in/);
  expect(visitUpdate).not.toBeNull();
  expect(visitUpdate[1]).not.toMatch(/^\s*(?:id|trip_id|day_index|start_time|end_time|sort_order|is_fixed|locked_by|from_item_id|to_item_id)\s*=/m);
  expect(visitUpdate[1].match(/^\s*updated_at\s*=\s*now\(\)/gm)).toHaveLength(1);
});
