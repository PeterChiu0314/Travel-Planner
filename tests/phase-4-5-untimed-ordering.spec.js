import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  buildTimelineVisitDisplayOrder,
  planUntimedVisitReorder,
} from "../src/lib/timelineUntimedOrdering.js";

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

function transport(id, fromItemId, toItemId) {
  return {
    id,
    trip_id: "trip-1",
    day_index: 0,
    item_type: "transport",
    from_item_id: fromItemId,
    to_item_id: toItemId,
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

test("untimed may enter a blank timed gap but cannot break an existing transportation pair", () => {
  const visits = [visit("a", "09:00", 10), visit("b", "10:00", 20), visit("c", null, 30)];
  expect(
    planUntimedVisitReorder({ items: visits, placement: "before", sourceItemId: "c", targetItemId: "b" }),
  ).toMatchObject({ ok: true });

  const protectedItems = [...visits, transport("transport-ab", "a", "b")];
  expect(
    planUntimedVisitReorder({ items: protectedItems, placement: "after", sourceItemId: "c", targetItemId: "a" }),
  ).toMatchObject({ brokenTransportId: "transport-ab", errorCode: "transport_pair_blocked", ok: false });
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
  expect(appSource).toContain('.is("start_time", null)');
  expect(appSource).toContain('.eq("updated_at", updatedAt)');
  expect(appSource).toContain("onReorderUntimedVisit");
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
  await expect(page.locator('.timeline-item[data-timing="untimed"]')).toHaveAttribute("draggable", "false");
});
