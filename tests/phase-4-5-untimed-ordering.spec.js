import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  buildTimelineVisitDisplayOrder,
  planMixedTimedVisitReorder,
  planUntimedVisitReorder,
} from "../src/lib/timelineUntimedOrdering.js";
import { normalizeTransportRole, transportRoles } from "../src/lib/timelineTransportationRoles.js";

const appSource = readFileSync("src/App.jsx", "utf8");

function visit(id, startTime, sortOrder, extra = {}) {
  return {
    id,
    trip_id: "trip-1",
    day_index: 0,
    item_type: "visit",
    title: id.toUpperCase(),
    start_time: startTime,
    end_time: startTime ? "12:00" : null,
    sort_order: sortOrder,
    is_fixed: false,
    updated_at: `2026-06-24T00:00:0${Math.abs(sortOrder) % 10}.000Z`,
    ...extra,
  };
}

function transport(id, fromItemId, toItemId, extra = {}) {
  return {
    id,
    trip_id: "trip-1",
    day_index: 0,
    item_type: "transport",
    from_item_id: fromItemId,
    to_item_id: toItemId,
    transport_role: "normal_pair",
    ...extra,
  };
}

test("untimed encoded positions mix with naturally time-sorted visits and legacy untimed stays last", () => {
  const items = [
    visit("late", "11:00", 10),
    visit("early", "09:00", 90),
    visit("mixed", null, -1_998_500_000),
    visit("legacy", null, 20),
  ];

  expect(buildTimelineVisitDisplayOrder(items).map((item) => item.id)).toEqual([
    "early",
    "mixed",
    "late",
    "legacy",
  ]);
});

test("untimed reorder changes only the source sort order and leaves timed times untouched", () => {
  const items = [
    visit("a", "09:00", 10),
    visit("b", "10:00", 20),
    visit("c", null, 30),
  ];
  const originalTimedTimes = items.filter((item) => item.start_time).map((item) => [item.id, item.start_time, item.end_time]);
  const plan = planUntimedVisitReorder({
    items,
    placement: "before",
    sourceItemId: "c",
    targetItemId: "b",
  });

  expect(plan).toMatchObject({ ok: true, sourceItemId: "c" });
  const nextItems = items.map((item) => (item.id === "c" ? { ...item, sort_order: plan.sortOrder } : item));
  expect(buildTimelineVisitDisplayOrder(nextItems).map((item) => item.id)).toEqual(["a", "c", "b"]);
  expect(nextItems.filter((item) => item.start_time).map((item) => [item.id, item.start_time, item.end_time])).toEqual(
    originalTimedTimes,
  );
});

test("untimed may enter a timed gap and reports any transportation pair it breaks", () => {
  const visits = [visit("a", "09:00", 10), visit("b", "10:00", 20), visit("c", null, 30)];
  expect(
    planUntimedVisitReorder({ items: visits, placement: "before", sourceItemId: "c", targetItemId: "b" }),
  ).toMatchObject({ ok: true });

  const protectedItems = [...visits, transport("transport-ab", "a", "b")];
  expect(
    planUntimedVisitReorder({ items: protectedItems, placement: "after", sourceItemId: "c", targetItemId: "a" }),
  ).toMatchObject({ brokenTransportId: "transport-ab", brokenTransportIds: ["transport-ab"], ok: true });
});

test("Phase 6 recognizes only complete normal transport pairs", () => {
  expect(normalizeTransportRole(transport("normal", "a", "b", { transport_role: "normal_pair" }))).toBe(
    transportRoles.normalPair,
  );
  expect(normalizeTransportRole(transport("missing-role", "a", "b", { transport_role: null }))).toBeNull();
  expect(normalizeTransportRole(transport("legacy-tail", "a", null, { transport_role: "tail_pending" }))).toBeNull();
  expect(
    normalizeTransportRole(transport("legacy-promoted", "a", "b", { transport_role: "tail_promoted_pair" })),
  ).toBeNull();
});
test("timed drag uses the mixed visual list and rebases untimed slots", () => {
  const items = [visit("a", "09:00", 10), visit("b", null, -1_998_500_000), visit("c", "11:00", 30)];
  const plan = planMixedTimedVisitReorder({
    items,
    placement: "before",
    sourceItemId: "c",
    targetItemId: "a",
  });

  expect(plan).toMatchObject({
    ok: true,
    packageSourceItemIds: ["c", "a"],
    slotItemIds: ["a", "c"],
  });
  expect(plan.untimedSortOrderUpdates).toHaveLength(1);
  const nextItems = items.map((item) => {
    const update = plan.untimedSortOrderUpdates.find((candidate) => candidate.id === item.id);
    return update ? { ...item, sort_order: update.sort_order } : item;
  });
  expect(buildTimelineVisitDisplayOrder(nextItems).map((item) => item.id)).toEqual(["a", "c", "b"]);
});

test("timed drag below an untimed target can move only the untimed slot", () => {
  const items = [visit("a", "09:00", 10), visit("b", null, -1_998_500_000), visit("c", "11:00", 30)];
  const plan = planMixedTimedVisitReorder({
    items,
    placement: "after",
    sourceItemId: "a",
    targetItemId: "b",
  });

  expect(plan).toMatchObject({
    ok: true,
    packageSourceItemIds: ["a", "c"],
    slotItemIds: ["a", "c"],
  });
  expect(plan.untimedSortOrderUpdates).toHaveLength(1);
  const nextItems = items.map((item) => {
    const update = plan.untimedSortOrderUpdates.find((candidate) => candidate.id === item.id);
    return update ? { ...item, sort_order: update.sort_order } : item;
  });
  expect(buildTimelineVisitDisplayOrder(nextItems).map((item) => item.id)).toEqual(["b", "a", "c"]);
});

test("timed drag upward can land before an untimed target without transport confirmation", () => {
  const items = [
    visit("a", "09:00", 10),
    visit("c", "10:30", 20),
    visit("d", "11:10", 30),
    visit("u", null, -1_996_500_000),
    visit("e", "13:00", 40),
  ];
  expect(buildTimelineVisitDisplayOrder(items).map((item) => item.id)).toEqual(["a", "c", "d", "u", "e"]);

  const beforeUntimed = planMixedTimedVisitReorder({
    items,
    placement: "before",
    sourceItemId: "e",
    targetItemId: "u",
  });

  expect(beforeUntimed).toMatchObject({
    brokenTransportIds: [],
    ok: true,
    orderedVisitItemIds: ["a", "c", "d", "e", "u"],
    packageSourceItemIds: ["a", "c", "d", "e"],
    slotItemIds: ["a", "c", "d", "e"],
  });
  const beforeUntimedUpdates = new Map(beforeUntimed.untimedSortOrderUpdates.map((update) => [update.id, update.sort_order]));
  const beforeUntimedItems = items.map((item) =>
    beforeUntimedUpdates.has(item.id) ? { ...item, sort_order: beforeUntimedUpdates.get(item.id) } : item,
  );
  expect(buildTimelineVisitDisplayOrder(beforeUntimedItems).map((item) => item.id)).toEqual(["a", "c", "d", "e", "u"]);
});

test("timed and untimed reorder delegate scheduling to the unified Planner", () => {
  expect(appSource).toContain("planTimelineSchedule");
  expect(appSource).toContain("timelineScheduleOperation");
  expect(appSource).toContain("timelineSchedulePlan");
  expect(appSource).toContain('supabase.rpc("apply_timeline_schedule_operation"');
});

test("timed drag upward can land around a timed card before an untimed slot", () => {
  const items = [
    visit("a", "09:00", 10),
    visit("c", "10:30", 20),
    visit("d", "11:10", 30),
    visit("u", null, -1_996_500_000),
    visit("e", "13:00", 40),
  ];

  const beforeTimed = planMixedTimedVisitReorder({
    items,
    placement: "before",
    sourceItemId: "e",
    targetItemId: "d",
  });
  expect(beforeTimed).toMatchObject({
    brokenTransportIds: [],
    ok: true,
    orderedVisitItemIds: ["a", "c", "e", "d", "u"],
    packageSourceItemIds: ["a", "c", "e", "d"],
  });

  const afterTimed = planMixedTimedVisitReorder({
    items,
    placement: "after",
    sourceItemId: "e",
    targetItemId: "d",
  });
  expect(afterTimed).toMatchObject({
    brokenTransportIds: [],
    ok: true,
    orderedVisitItemIds: ["a", "c", "d", "e", "u"],
    packageSourceItemIds: ["a", "c", "d", "e"],
  });
});

test("timed drag treats fixed untimed legacy data as movable untimed", () => {
  const items = [
    visit("a", "09:00", 10),
    visit("u", null, -1_998_500_000, { is_fixed: true }),
    visit("b", "11:00", 30),
  ];
  const plan = planMixedTimedVisitReorder({
    items,
    placement: "before",
    sourceItemId: "b",
    targetItemId: "u",
  });

  expect(buildTimelineVisitDisplayOrder(items).map((item) => item.id)).toEqual(["a", "u", "b"]);
  expect(plan).toMatchObject({
    ok: true,
    packageSourceItemIds: ["a", "b"],
    slotItemIds: ["a", "b"],
  });
  expect(plan.untimedSortOrderUpdates).toEqual([
    expect.objectContaining({
      id: "u",
      original_sort_order: -1_998_500_000,
      sort_order: -1_997_500_000,
    }),
  ]);
});

test("timed drag cannot cross or move fixed timed anchors", () => {
  const items = [
    visit("a", "09:00", 10),
    visit("fixed", "10:00", 20, { is_fixed: true }),
    visit("b", "11:00", 30),
    visit("c", "12:00", 40),
  ];

  expect(
    planMixedTimedVisitReorder({
      items,
      placement: "after",
      sourceItemId: "c",
      targetItemId: "fixed",
    }),
  ).toMatchObject({ errorCode: "fixed_boundary_crossed", ok: false });

  expect(
    planMixedTimedVisitReorder({
      items,
      placement: "after",
      sourceItemId: "fixed",
      targetItemId: "a",
    }),
  ).toMatchObject({ errorCode: "fixed_item", ok: false });
});

test("timed drag derives broken transports from before and after mixed visual order", () => {
  const items = [
    visit("a", "01:10", 10),
    visit("b", "05:00", 20),
    visit("c", null, -1_997_500_000),
    visit("d", "07:05", 30),
    transport("transport-ab", "a", "b"),
  ];
  const plan = planMixedTimedVisitReorder({
    items,
    placement: "after",
    sourceItemId: "b",
    targetItemId: "c",
  });

  expect(plan).toMatchObject({
    brokenTransportIds: ["transport-ab"],
    ok: true,
    packageSourceItemIds: ["a", "b", "d"],
    slotItemIds: ["a", "b", "d"],
  });
  expect(plan.untimedSortOrderUpdates).toHaveLength(1);
});

test("a visit cleared by Phase 4.4 becomes a normal legacy untimed visit", () => {
  const items = [visit("a", "09:00", 10), visit("cleared", null, 20), visit("b", "11:00", 30)];
  expect(buildTimelineVisitDisplayOrder(items).map((item) => item.id)).toEqual(["a", "b", "cleared"]);
  expect(
    planUntimedVisitReorder({ items, placement: "before", sourceItemId: "cleared", targetItemId: "b" }),
  ).toMatchObject({ ok: true });
});

test("formal untimed persistence is baseline-guarded by the unified Planner RPC", () => {
  expect(appSource).toContain("async function reorderUntimedVisit");
  expect(appSource).toContain("applyTimelineScheduleOperation");
  expect(appSource).toContain("timelineScheduleExpectedVisitIds");
  expect(appSource).toContain("onReorderUntimedVisit");
  expect(appSource).toContain("planMixedTimedVisitReorder");
  expect(appSource).toContain("transportBaselines");
  expect(appSource).toContain("confirmedScheduleEffect");
  expect(appSource).not.toContain("renderTailTransportInsert");
  expect(appSource).not.toContain("suggestedStartTimeForUntimedAfterTailTransport");
  expect(appSource).toContain("function isEffectiveFixedVisit(item)");
  expect(appSource).toContain("if (!isTimedVisit(item))");
  expect(appSource).toContain("is_fixed: hasCompleteTime ? Boolean(payload.is_fixed) : false");
  expect(appSource).toContain('if (message.includes("fixed_boundary_crossed")) return "固定行程是排程邊界，無法跨越拖曳。";');
});

test("demo untimed drag uses unified continuation without confirmation-only effects", async ({ page }) => {
  await page.goto("/demo/timeline");
  await page.getByRole("button", { name: "DAY 6 4/10" }).click();
  const untimed = page.locator('.timeline-item[data-timing="untimed"]', { hasText: "哲學之道" });
  const timed = page.locator('.timeline-item[data-timing="timed"]');
  await expect(untimed).toBeVisible();
  await expect(untimed).toHaveClass(/drag-enabled/);

  const dragHandle = untimed.locator(".time-block");
  await dragHandle.focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(100);
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(100);
  await page.keyboard.press("Space");
  await expect(page.locator(".timeline .timeline-item").first()).toContainText("哲學之道");
  await expect(timed.locator(".time-block")).toHaveText([
    "09:3010:00",
    "10:0011:30",
    "11:3013:00",
    "13:0015:00",
  ]);
  await expect(page.getByRole("dialog", { name: "自動接續後續行程？" })).toHaveCount(0);
});

test("active editor disables untimed dragging in Demo", async ({ page }) => {
  await page.goto("/demo/timeline");
  await page.getByRole("button", { name: "DAY 6 4/10" }).click();
  const firstTimed = page.locator('.timeline-item[data-timing="timed"]').first();
  await firstTimed.click();
  await firstTimed.getByRole("button", { name: "編輯" }).click();
  await expect(page.locator('.timeline-item[data-timing="untimed"]').first()).not.toHaveClass(/drag-enabled/);
});
