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

test("transport roles distinguish legacy normal pairs from tail pending cards", () => {
  expect(normalizeTransportRole(transport("legacy-normal", "a", "b"))).toBe(transportRoles.normalPair);
  expect(normalizeTransportRole(transport("legacy-tail", "a", null))).toBe(transportRoles.tailPending);
  expect(normalizeTransportRole(transport("promoted", "a", "b", { transport_role: "tail_promoted_pair" }))).toBe(
    transportRoles.tailPromotedPair,
  );
});

test("tail promoted pairs protect their gap while tail pending cards do not", () => {
  const visits = [visit("a", "09:00", 10), visit("b", "10:00", 20), visit("c", null, 30)];
  expect(
    planUntimedVisitReorder({
      items: [...visits, transport("tail-ab", "a", "b", { transport_role: "tail_promoted_pair" })],
      placement: "after",
      sourceItemId: "c",
      targetItemId: "a",
    }),
  ).toMatchObject({ brokenTransportId: "tail-ab", brokenTransportIds: ["tail-ab"], ok: true });

  expect(
    planUntimedVisitReorder({
      items: [...visits, transport("tail-a", "a", null, { transport_role: "tail_pending" })],
      placement: "after",
      sourceItemId: "c",
      targetItemId: "a",
    }),
  ).toMatchObject({ ok: true });
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

test("timed drag can cross fixed timed anchors but cannot drag the anchor itself", () => {
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
  ).toMatchObject({
    ok: true,
    orderedTimedItemIds: ["a", "fixed", "c", "b"],
    packageSourceItemIds: ["a", "c", "b"],
    slotItemIds: ["a", "b", "c"],
  });

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

test("formal untimed persistence is baseline-guarded and does not call the destination reorder RPC", () => {
  expect(appSource).toContain("async function reorderUntimedVisit");
  expect(appSource).toContain('.update({ sort_order: sortOrder })');
  expect(appSource).toContain('.or("start_time.is.null,end_time.is.null")');
  expect(appSource).toContain('.eq("updated_at", updatedAt)');
  expect(appSource).toContain("onReorderUntimedVisit");
  expect(appSource).toContain("!hasPassiveTransportAfterItem ? renderTailTransportInsert(item) : null");
  expect(appSource).toContain("function suggestedStartTimeForUntimedAfterTailTransport");
  expect(appSource).toContain("formatTimeDisplay(item.start_time) || suggestedUntimedStartTime");
  expect(appSource).toContain("const brokenTransportIds = new Set(plan.brokenTransportIds || [])");
  expect(appSource).toContain(".filter((item) => isTransportationCard(item) && brokenTransportIds.has(item.id))");
  expect(appSource).toContain("planMixedTimedVisitReorder");
  expect(appSource).toContain("brokenTransportIds = []");
  expect(appSource).toContain("transportBaselines: explicitTransportBaselines");
  expect(appSource).toContain("previewPlan.deletedTransportIds.length || explicitTransportBaselines.length");
  expect(appSource).toContain("function isEffectiveFixedVisit(item)");
  expect(appSource).toContain("if (!isTimedVisit(item))");
  expect(appSource).toContain("is_fixed: hasCompleteTime ? Boolean(payload.is_fixed) : false");
});

test("demo shows mixed untimed content and dragging it does not open continuation UI", async ({ page }) => {
  await page.goto("/demo/timeline");
  await page.getByRole("button", { name: "DAY 6 4/10" }).click();
  const untimed = page.locator('.timeline-item[data-timing="untimed"]', { hasText: "哲學之道" });
  const timed = page.locator('.timeline-item[data-timing="timed"]');
  await expect(untimed).toBeVisible();
  await expect(untimed).toHaveAttribute("draggable", "true");

  const originalTimedLabels = await timed.locator(".time-block").allTextContents();
  await untimed.dragTo(timed.first(), { targetPosition: { x: 20, y: 2 } });
  await expect(page.locator(".timeline .timeline-item").first()).toContainText("哲學之道");
  await expect(timed.locator(".time-block")).toHaveText(originalTimedLabels);
  await expect(page.getByRole("dialog", { name: "自動接續後續行程？" })).toHaveCount(0);
});

test("active editor disables untimed dragging in Demo", async ({ page }) => {
  await page.goto("/demo/timeline");
  await page.getByRole("button", { name: "DAY 6 4/10" }).click();
  const firstTimed = page.locator('.timeline-item[data-timing="timed"]').first();
  await firstTimed.click();
  await firstTimed.getByRole("button", { name: "編輯" }).click();
  await expect(page.locator('.timeline-item[data-timing="untimed"]').first()).toHaveAttribute("draggable", "false");
});
