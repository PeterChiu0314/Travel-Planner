import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  hasTimedDragOrderChange,
  insertionPackageOrder,
  isSamePackageOrder,
  planDestinationPackageReorder,
  planTimedDragAutoContinuation,
} from "../src/lib/destinationPackages.js";
import { buildTimelineVisitDisplayOrder, planMixedTimedVisitReorder } from "../src/lib/timelineUntimedOrdering.js";
import { planTailPendingPromotionUntimedBypass } from "../src/lib/timelineUntimedOrdering.js";

const migration = readFileSync("supabase/migrations/020_reorder_itinerary_destination_packages.sql", "utf8");
const baselineCountFixMigration = readFileSync("supabase/migrations/021_fix_reorder_baseline_count.sql", "utf8");
const timedAutoContinuationMigration = readFileSync(
  "supabase/migrations/023_reorder_itinerary_timed_auto_continuation.sql",
  "utf8",
);
const fixedAnchorContinuationMigration = readFileSync(
  "supabase/migrations/024_reorder_itinerary_fixed_anchor_continuation.sql",
  "utf8",
);
const appSource = readFileSync("src/App.jsx", "utf8");
const packageSource = readFileSync("package.json", "utf8");
const stylesSource = readFileSync("src/styles.css", "utf8");

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

test("Phase 4.6 timed drag preserves each package duration instead of swapping time slots", () => {
  const items = [
    visit("slot-a", "A", "09:00", 10, { end_time: "10:00" }),
    visit("slot-b", "B", "10:30", 20, { end_time: "11:00" }),
    visit("slot-c", "C", "12:00", 30, { end_time: "13:30" }),
  ];
  const slots = items.map((item) => item.id);
  const sources = ["slot-c", "slot-a", "slot-b"];
  const timingPlan = planTimedDragAutoContinuation({ items, slotItemIds: slots, packageSourceItemIds: sources });

  expect(timingPlan.ok).toBe(true);
  expect(Object.values(timingPlan.updatesBySlotId).map((update) => [update.source_item_id, update.start_time, update.end_time])).toEqual([
    ["slot-c", "09:00", "10:30"],
    ["slot-a", "10:30", "11:30"],
    ["slot-b", "12:00", "12:30"],
  ]);

  const reorderPlan = planDestinationPackageReorder({
    items,
    slotItemIds: slots,
    packageSourceItemIds: sources,
    timedAutoContinuation: true,
  });
  expect(slots.map((slotId) => {
    const item = reorderPlan.items.find((candidate) => candidate.id === slotId);
    return [item.title, item.start_time, item.end_time];
  })).toEqual([
    ["C", "09:00", "10:30"],
    ["A", "10:30", "11:30"],
    ["B", "12:00", "12:30"],
  ]);
});

test("Phase 4.6 preserves same-direction gaps and directly continues reversed pairs", () => {
  const items = [
    visit("slot-a", "A", "09:00", 10, { end_time: "10:00" }),
    visit("slot-b", "B", "10:30", 20, { end_time: "11:00" }),
    visit("slot-c", "C", "12:00", 30, { end_time: "13:30" }),
  ];
  const slots = items.map((item) => item.id);

  expect(
    Object.values(
      planTimedDragAutoContinuation({
        items,
        slotItemIds: slots,
        packageSourceItemIds: ["slot-b", "slot-c", "slot-a"],
      }).updatesBySlotId,
    ).map((update) => [update.source_item_id, update.start_time, update.end_time]),
  ).toEqual([
    ["slot-b", "09:00", "09:30"],
    ["slot-c", "10:30", "12:00"],
    ["slot-a", "12:00", "13:00"],
  ]);

  expect(
    Object.values(
      planTimedDragAutoContinuation({
        items,
        slotItemIds: slots,
        packageSourceItemIds: ["slot-b", "slot-a", "slot-c"],
      }).updatesBySlotId,
    ).map((update) => [update.source_item_id, update.start_time, update.end_time]),
  ).toEqual([
    ["slot-b", "09:00", "09:30"],
    ["slot-a", "09:30", "10:30"],
    ["slot-c", "10:30", "12:00"],
  ]);
});

test("Phase 4.6 rejects partial-time rows before duration-based continuation", () => {
  const items = [
    visit("slot-a", "A", "09:00", 10, { end_time: "10:00" }),
    visit("slot-b", "B", "10:30", 20, { end_time: null }),
  ];

  expect(
    planTimedDragAutoContinuation({
      items,
      slotItemIds: ["slot-a", "slot-b"],
      packageSourceItemIds: ["slot-b", "slot-a"],
    }),
  ).toMatchObject({ errorCode: "timed_visit_required", ok: false });
});

test("Phase 4.7 fixed anchors split timed drag into continuation segments", () => {
  const items = [
    visit("slot-a", "A", "09:00", 10, { end_time: "09:30" }),
    visit("fixed-1", "F1", "10:00", 20, { end_time: "10:15", is_fixed: true }),
    visit("slot-b", "B", "10:30", 30, { end_time: "11:00" }),
    visit("slot-c", "C", "11:15", 40, { end_time: "12:00" }),
    visit("fixed-2", "F2", "13:00", 50, { end_time: "13:15", is_fixed: true }),
    visit("slot-d", "D", "14:00", 60, { end_time: "14:20" }),
  ];
  const slots = ["slot-a", "slot-b", "slot-c", "slot-d"];
  const sources = ["slot-a", "slot-d", "slot-b", "slot-c"];
  const plan = planDestinationPackageReorder({
    items,
    orderedTimedItemIds: ["slot-a", "fixed-1", "slot-d", "slot-b", "slot-c", "fixed-2"],
    orderedVisitItemIds: ["slot-a", "fixed-1", "slot-d", "slot-b", "slot-c", "fixed-2"],
    slotItemIds: slots,
    packageSourceItemIds: sources,
    timedAutoContinuation: true,
  });

  expect(plan.ok).toBe(true);
  expect(slots.map((slotId) => {
    const item = plan.items.find((candidate) => candidate.id === slotId);
    return [item.title, item.start_time, item.end_time];
  })).toEqual([
    ["A", "09:00", "09:30"],
    ["D", "10:15", "10:35"],
    ["B", "10:35", "11:05"],
    ["C", "11:20", "12:05"],
  ]);
  expect(plan.items.find((item) => item.id === "fixed-1")).toMatchObject({ start_time: "10:00", end_time: "10:15", title: "F1" });
  expect(plan.items.find((item) => item.id === "fixed-2")).toMatchObject({ start_time: "13:00", end_time: "13:15", title: "F2" });
});

test("Phase 4.7 overflow converts the first non-fitting visit and the segment tail to untimed", () => {
  const items = [
    visit("fixed-1", "F1", "10:00", 10, { end_time: "10:15", is_fixed: true }),
    visit("slot-b", "B", "10:30", 20, { end_time: "11:00" }),
    visit("slot-c", "C", "11:15", 30, { end_time: "12:00" }),
    visit("fixed-2", "F2", "11:10", 40, { end_time: "12:30", is_fixed: true }),
    visit("slot-d", "D", "14:00", 50, { end_time: "14:20" }),
  ];
  const plan = planDestinationPackageReorder({
    items,
    orderedTimedItemIds: ["fixed-1", "slot-d", "slot-b", "slot-c", "fixed-2"],
    orderedVisitItemIds: ["fixed-1", "slot-d", "slot-b", "slot-c", "fixed-2"],
    slotItemIds: ["slot-b", "slot-c", "slot-d"],
    packageSourceItemIds: ["slot-d", "slot-b", "slot-c"],
    timedAutoContinuation: true,
  });

  expect(plan.ok).toBe(true);
  expect(["slot-b", "slot-c", "slot-d"].map((slotId) => {
    const item = plan.items.find((candidate) => candidate.id === slotId);
    return [item.title, item.start_time, item.end_time];
  })).toEqual([
    ["D", "10:15", "10:35"],
    ["B", "10:35", "11:05"],
    ["C", null, null],
  ]);
  expect(Number.isInteger(plan.items.find((item) => item.id === "slot-d").sort_order)).toBe(true);
  expect(plan.timedAutoContinuationUpdates["slot-d"]).toMatchObject({ start_time: null, end_time: null, source_item_id: "slot-c" });
});

test("Phase 4.7 rejects inserting timed visits between fixed anchors with no space", () => {
  const items = [
    visit("fixed-1", "F1", "10:00", 10, { end_time: "10:15", is_fixed: true }),
    visit("fixed-2", "F2", "10:15", 20, { end_time: "10:30", is_fixed: true }),
    visit("slot-a", "A", "11:00", 30, { end_time: "11:30" }),
  ];
  expect(
    planDestinationPackageReorder({
      items,
      orderedTimedItemIds: ["fixed-1", "slot-a", "fixed-2"],
      orderedVisitItemIds: ["fixed-1", "slot-a", "fixed-2"],
      slotItemIds: ["slot-a"],
      packageSourceItemIds: ["slot-a"],
      timedAutoContinuation: true,
    }),
  ).toMatchObject({ ok: false, errorCode: "fixed_segment_no_space" });
});

function planFixedAdjacentDrag(items, sourceItemId, targetItemId, placement) {
  const mixedPlan = planMixedTimedVisitReorder({ items, placement, sourceItemId, targetItemId });
  expect(mixedPlan.ok).toBe(true);
  expect(
    hasTimedDragOrderChange({
      currentTimedItemIds: items.filter((item) => item.start_time && item.end_time).map((item) => item.id),
      orderedTimedItemIds: mixedPlan.orderedTimedItemIds,
      packageSourceItemIds: mixedPlan.packageSourceItemIds,
      slotItemIds: mixedPlan.slotItemIds,
    }),
  ).toBe(true);
  return planDestinationPackageReorder({
    items,
    orderedTimedItemIds: mixedPlan.orderedTimedItemIds,
    orderedVisitItemIds: mixedPlan.orderedVisitItemIds,
    slotItemIds: mixedPlan.slotItemIds,
    packageSourceItemIds: mixedPlan.packageSourceItemIds,
    timedAutoContinuation: true,
  });
}

function planAppTimedDrag(items, sourceItemId, targetItemId, placement) {
  const mixedPlan = planMixedTimedVisitReorder({ items, placement, sourceItemId, targetItemId });
  expect(mixedPlan.ok).toBe(true);
  const plan = planDestinationPackageReorder({
    items,
    orderedTimedItemIds: mixedPlan.orderedTimedItemIds,
    orderedVisitItemIds: mixedPlan.orderedVisitItemIds,
    slotItemIds: mixedPlan.slotItemIds,
    packageSourceItemIds: mixedPlan.packageSourceItemIds,
    timedAutoContinuation: true,
  });
  if (!plan.ok) return plan;
  const finalUntimedSortOrderUpdates = plan.convertedSlotIds?.length
    ? plan.untimedSortOrderUpdates || []
    : mixedPlan.untimedSortOrderUpdates || [];
  const sortOrderById = new Map(finalUntimedSortOrderUpdates.map((update) => [update.id, update.sort_order]));
  return {
    ...plan,
    items: plan.items.map((item) => (sortOrderById.has(item.id) ? { ...item, sort_order: sortOrderById.get(item.id) } : item)),
    untimedSortOrderUpdates: finalUntimedSortOrderUpdates,
  };
}

test("Phase 4.7a fixed-adjacent timed drop gaps are valid reorder targets", () => {
  const fixedBoundedItems = [
    visit("slot-a", "A", "09:00", 10, { end_time: "09:30" }),
    visit("fixed-1", "F", "10:00", 20, { end_time: "10:15", is_fixed: true }),
    visit("slot-b", "B", "10:30", 30, { end_time: "11:00" }),
    visit("slot-c", "C", "11:15", 40, { end_time: "12:00" }),
    visit("fixed-2", "F2", "13:00", 50, { end_time: "13:15", is_fixed: true }),
    visit("slot-d", "D", "14:00", 60, { end_time: "14:20" }),
  ];

  const beforeRightAnchor = planFixedAdjacentDrag(fixedBoundedItems, "slot-d", "fixed-2", "before");
  expect(beforeRightAnchor.ok).toBe(true);
  expect(beforeRightAnchor.items.find((item) => item.id === "slot-d")).toMatchObject({
    start_time: "11:45",
    end_time: "12:05",
    title: "D",
  });

  const afterRightAnchor = planFixedAdjacentDrag(fixedBoundedItems, "slot-c", "fixed-2", "after");
  expect(afterRightAnchor.ok).toBe(true);
  expect(afterRightAnchor.items.find((item) => item.id === "slot-c")).toMatchObject({
    start_time: "13:15",
    end_time: "14:00",
    title: "C",
  });

  const afterLeftAnchor = planFixedAdjacentDrag(fixedBoundedItems, "slot-a", "fixed-1", "after");
  expect(afterLeftAnchor.ok).toBe(true);
  expect(afterLeftAnchor.items.find((item) => item.id === "slot-a")).toMatchObject({
    start_time: "10:15",
    end_time: "10:45",
    title: "A",
  });

  const tailItems = [
    visit("slot-a", "A", "09:00", 10, { end_time: "09:30" }),
    visit("slot-b", "B", "10:00", 20, { end_time: "10:30" }),
    visit("fixed-1", "F", "11:00", 30, { end_time: "11:15", is_fixed: true }),
    visit("slot-c", "C", "12:00", 40, { end_time: "12:30" }),
  ];
  const beforeFixed = planFixedAdjacentDrag(tailItems, "slot-c", "fixed-1", "before");
  expect(beforeFixed.ok).toBe(true);
  expect(beforeFixed.items.find((item) => item.id === "slot-c")).toMatchObject({
    start_time: "10:30",
    end_time: "11:00",
    title: "C",
  });
});

test("Phase 4.7a no-space fixed-fixed gap still rejects only the closed fixed segment", () => {
  const items = [
    visit("slot-a", "A", "09:00", 10, { end_time: "09:30" }),
    visit("slot-b", "B", "10:00", 20, { end_time: "10:30" }),
    visit("fixed-1", "F", "10:30", 30, { end_time: "10:45", is_fixed: true }),
    visit("fixed-2", "F2", "10:45", 40, { end_time: "11:00", is_fixed: true }),
    visit("slot-c", "C", "12:00", 50, { end_time: "12:30" }),
  ];

  expect(planFixedAdjacentDrag(items, "slot-c", "fixed-1", "before")).toMatchObject({ ok: true });
  expect(planFixedAdjacentDrag(items, "slot-c", "fixed-2", "before")).toMatchObject({
    ok: false,
    errorCode: "fixed_segment_no_space",
  });
});

function untimedSortOrderForSlot(slot, rank = 500_000) {
  return -2_000_000_000 + slot * 1_000_000 + rank;
}

function planOverflowBeforeFixed({ cEndTime, fixedStartTime }) {
  const items = [
    visit("slot-a", "A", "01:00", 10, { end_time: "01:30" }),
    visit("slot-b", "B", null, untimedSortOrderForSlot(1), { end_time: null }),
    visit("fixed-1", "F", fixedStartTime, 30, { end_time: "02:10", is_fixed: true }),
    visit("slot-c", "C", "01:50", 40, { end_time: cEndTime }),
    visit("fixed-2", "F2", "09:00", 50, { end_time: "10:00", is_fixed: true }),
  ];
  return planAppTimedDrag(items, "slot-c", "slot-a", "before");
}

test("Phase 4.7b fixed segment overflow converts timed visits to untimed and preserves mixed visual order", () => {
  const cFitsAOverflows = planOverflowBeforeFixed({ cEndTime: "02:10", fixedStartTime: "01:45" });
  expect(cFitsAOverflows.ok).toBe(true);
  expect(buildTimelineVisitDisplayOrder(cFitsAOverflows.items).map((item) => [item.title, item.start_time, item.end_time])).toEqual([
    ["C", "01:00", "01:20"],
    ["A", null, null],
    ["B", null, null],
    ["F", "01:45", "02:10"],
    ["F2", "09:00", "10:00"],
  ]);
  expect(cFitsAOverflows.untimedSortOrderUpdates).toEqual([
    expect.objectContaining({ id: "slot-b", sort_order: untimedSortOrderForSlot(1, 666_666) }),
  ]);

  const cAlsoOverflows = planOverflowBeforeFixed({ cEndTime: "02:50", fixedStartTime: "01:40" });
  expect(cAlsoOverflows.ok).toBe(true);
  expect(buildTimelineVisitDisplayOrder(cAlsoOverflows.items).map((item) => [item.title, item.start_time, item.end_time])).toEqual([
    ["C", null, null],
    ["A", null, null],
    ["B", null, null],
    ["F", "01:40", "02:10"],
    ["F2", "09:00", "10:00"],
  ]);
  expect(cAlsoOverflows.errorCode).not.toBe("invalid_timing_change");

  const enoughSpace = planOverflowBeforeFixed({ cEndTime: "02:10", fixedStartTime: "02:00" });
  expect(enoughSpace.ok).toBe(true);
  expect(buildTimelineVisitDisplayOrder(enoughSpace.items).map((item) => [item.title, item.start_time, item.end_time])).toEqual([
    ["C", "01:00", "01:20"],
    ["A", "01:20", "01:50"],
    ["B", null, null],
    ["F", "02:00", "02:10"],
    ["F2", "09:00", "10:00"],
  ]);
});

test("Phase 4.7b Formal and Demo use the overflow rebase payload instead of the pre-conversion untimed slot", () => {
  const plan = planOverflowBeforeFixed({ cEndTime: "02:10", fixedStartTime: "01:45" });
  expect(plan.ok).toBe(true);
  expect(plan.convertedSlotIds).toEqual(["slot-c"]);
  expect(plan.untimedSortOrderUpdates).toEqual([
    expect.objectContaining({
      id: "slot-b",
      original_sort_order: untimedSortOrderForSlot(1),
      sort_order: untimedSortOrderForSlot(1, 666_666),
    }),
  ]);
  expect(appSource).toContain("finalUntimedSortOrderUpdates");
  expect(appSource).toContain("previewPlan.convertedSlotIds");
});

test("Phase 4.8b tail_pending promotion bypasses only blocking untimed visits", () => {
  const items = [
    visit("slot-a", "A", "09:00", 10, { end_time: "10:00" }),
    visit("untimed-b", "B", null, untimedSortOrderForSlot(1), { end_time: null }),
    visit("slot-c", "C", "10:15", 20, { end_time: "11:00" }),
    transport("transport-tail-a", "slot-a", null, { transport_role: "tail_pending" }),
  ];
  const plan = planTailPendingPromotionUntimedBypass({
    items,
    promotedFromItemId: "slot-a",
    promotedToItemId: "slot-c",
    tailTransportItem: items.find((item) => item.id === "transport-tail-a"),
  });

  expect(plan.ok).toBe(true);
  expect(plan.untimedSortOrderUpdates).toEqual([
    expect.objectContaining({ id: "untimed-b", sort_order: untimedSortOrderForSlot(2) }),
  ]);
  const nextItems = items.map((item) =>
    item.id === "untimed-b"
      ? { ...item, sort_order: plan.untimedSortOrderUpdates[0].sort_order }
      : item.id === "transport-tail-a"
        ? { ...item, to_item_id: "slot-c", transport_role: "tail_promoted_pair" }
        : item,
  );
  expect(buildTimelineVisitDisplayOrder(nextItems).map((item) => item.id)).toEqual(["slot-a", "slot-c", "untimed-b"]);
});

test("Phase 4.8b tail_pending promotion does not rebase unrelated untimed visits", () => {
  const items = [
    visit("untimed-d", "D", null, untimedSortOrderForSlot(0), { end_time: null }),
    visit("slot-a", "A", "09:00", 10, { end_time: "10:00" }),
    visit("untimed-b", "B", null, untimedSortOrderForSlot(1), { end_time: null }),
    visit("slot-c", "C", "10:15", 20, { end_time: "11:00" }),
    transport("transport-tail-a", "slot-a", null, { transport_role: "tail_pending" }),
  ];
  const plan = planTailPendingPromotionUntimedBypass({
    items,
    promotedFromItemId: "slot-a",
    promotedToItemId: "slot-c",
    tailTransportItem: items.find((item) => item.id === "transport-tail-a"),
  });

  expect(plan.ok).toBe(true);
  expect(plan.untimedSortOrderUpdates.map((update) => update.id)).toEqual(["untimed-b"]);
  expect(plan.untimedSortOrderUpdates.some((update) => update.id === "untimed-d")).toBe(false);
});

test("Phase 4.8b normal_pair transport does not use tail_pending untimed bypass", () => {
  const items = [
    visit("slot-a", "A", "09:00", 10, { end_time: "10:00" }),
    visit("untimed-b", "B", null, untimedSortOrderForSlot(1), { end_time: null }),
    visit("slot-c", "C", "10:15", 20, { end_time: "11:00" }),
    transport("transport-ac", "slot-a", "slot-c", { transport_role: "normal_pair" }),
  ];
  const plan = planTailPendingPromotionUntimedBypass({
    items,
    promotedFromItemId: "slot-a",
    promotedToItemId: "slot-c",
    tailTransportItem: items.find((item) => item.id === "transport-ac"),
  });

  expect(plan.ok).toBe(true);
  expect(plan.untimedSortOrderUpdates).toEqual([]);
  expect(buildTimelineVisitDisplayOrder(items).map((item) => item.id)).toEqual(["slot-a", "untimed-b", "slot-c"]);
});

test("Phase 4.8b tail_pending bypass is skipped when the promoted timed visit is before the tail source", () => {
  const items = [
    visit("slot-c", "C", "08:30", 20, { end_time: "09:00" }),
    visit("slot-a", "A", "09:00", 10, { end_time: "10:00" }),
    visit("untimed-b", "B", null, untimedSortOrderForSlot(2), { end_time: null }),
    transport("transport-tail-a", "slot-a", null, { transport_role: "tail_pending" }),
  ];
  const plan = planTailPendingPromotionUntimedBypass({
    items,
    promotedFromItemId: "slot-a",
    promotedToItemId: "slot-c",
    tailTransportItem: items.find((item) => item.id === "transport-tail-a"),
  });

  expect(plan.ok).toBe(true);
  expect(plan.untimedSortOrderUpdates).toEqual([]);
  expect(buildTimelineVisitDisplayOrder(items).map((item) => item.id)).toEqual(["slot-c", "slot-a", "untimed-b"]);
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

test("Demo-added transport remains attached to its semantic pair after moving a neighboring visit", () => {
  const items = [
    visit("napoli", "Napoli", "11:00", 10),
    visit("kasahara", "笠原桜公園", "12:00", 20),
    visit("orix", "Orix Rent-a-car大津駅南口店", "13:00", 30),
    visit("hachiman", "八幡堀", "14:00", 40),
    visit("villa", "近江八幡夢園Villa", "15:00", 50),
    transport("demo-transport-orix-hachiman", "orix", "hachiman", {
      title: "5・5分鐘",
      transport_duration_minutes: 5,
      transport_role: "normal_pair",
    }),
  ];
  const mixedPlan = planMixedTimedVisitReorder({
    items,
    placement: "after",
    sourceItemId: "napoli",
    targetItemId: "hachiman",
  });
  expect(mixedPlan.ok).toBe(true);

  const plan = planDestinationPackageReorder({
    items,
    orderedTimedItemIds: mixedPlan.orderedTimedItemIds,
    orderedVisitItemIds: mixedPlan.orderedVisitItemIds,
    packageSourceItemIds: mixedPlan.packageSourceItemIds,
    slotItemIds: mixedPlan.slotItemIds,
    timedAutoContinuation: true,
  });

  expect(plan.ok).toBe(true);
  expect(plan.deletedTransportIds).not.toContain("demo-transport-orix-hachiman");
  expect(plan.preservedTransportIds).toContain("demo-transport-orix-hachiman");
  const transportItem = plan.items.find((item) => item.id === "demo-transport-orix-hachiman");
  const fromVisit = plan.items.find((item) => item.id === transportItem.from_item_id);
  const toVisit = plan.items.find((item) => item.id === transportItem.to_item_id);
  expect([fromVisit.title, transportItem.title, toVisit.title]).toEqual([
    "Orix Rent-a-car大津駅南口店",
    "5・5分鐘",
    "八幡堀",
  ]);
  expect(toVisit.title).not.toBe("Napoli");
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

test("planner rejects incomplete manifests and fixed timed slots", () => {
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
      slotItemIds: ["slot-a", "slot-c", "slot-d"],
      packageSourceItemIds: ["slot-c", "slot-a", "slot-d"],
    }),
  ).toMatchObject({ ok: false, errorCode: "timed_visit_required" });
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

test("023 RPC performs Phase 4.6 timed auto-continuation transactionally", () => {
  expect(timedAutoContinuationMigration).toContain("app_private.reorder_itinerary_timed_auto_continuation");
  expect(timedAutoContinuationMigration).toContain("public.reorder_itinerary_timed_auto_continuation");
  expect(timedAutoContinuationMigration).toContain("and item.end_time is not null");
  expect(timedAutoContinuationMigration).toContain("duration_minutes := source_end_minutes - source_start_minutes");
  expect(timedAutoContinuationMigration).toContain("source_position = previous_source_position + 1");
  expect(timedAutoContinuationMigration).toContain("start_time = time '00:00' + make_interval(mins => next_start_minutes)");
  expect(timedAutoContinuationMigration).toContain("grant execute on function public.reorder_itinerary_timed_auto_continuation");
  expect(appSource).toContain("timedAutoContinuation: true");
});

test("024 RPC performs Phase 4.7 fixed-anchor continuation transactionally", () => {
  expect(fixedAnchorContinuationMigration).toContain("app_private.reorder_itinerary_fixed_anchor_continuation");
  expect(fixedAnchorContinuationMigration).toContain("public.reorder_itinerary_fixed_anchor_continuation");
  expect(fixedAnchorContinuationMigration).toContain("ordered_timed_item_ids");
  expect(fixedAnchorContinuationMigration).toContain("untimed_sort_order_updates");
  expect(fixedAnchorContinuationMigration).toContain("fixed_segment_no_space");
  expect(fixedAnchorContinuationMigration).toContain("converted_slot_ids");
  expect(fixedAnchorContinuationMigration).toContain("start_time = null");
  expect(fixedAnchorContinuationMigration).toContain("grant execute on function public.reorder_itinerary_fixed_anchor_continuation");
  expect(appSource).toContain("reorder_itinerary_fixed_anchor_continuation");
  expect(appSource).toContain("orderedTimedItemIds");
  expect(appSource).toContain("orderedVisitItemIds");
  expect(appSource).toContain("reorderArgs.untimed_sort_order_updates");
});

test("Phase 4.8a dnd-kit local sortable ghost preview stays UI-only", () => {
  expect(packageSource).toContain("\"@dnd-kit/core\"");
  expect(packageSource).toContain("\"@dnd-kit/sortable\"");
  expect(packageSource).toContain("\"@dnd-kit/utilities\"");
  expect(appSource).toContain("DndContext");
  expect(appSource).toContain("SortableContext");
  expect(appSource).toContain("useSortable");
  expect(appSource).toContain("verticalListSortingStrategy");
  expect(appSource).toContain("DragOverlay");
  expect(appSource).toContain("sortableKeyboardCoordinates");
  expect(appSource).toContain("visitItemIds");
  expect(appSource).toContain("disabled: { draggable: disabled, droppable: false }");
  expect(appSource).not.toContain("dragPreviewVisitIds");
  expect(appSource).not.toContain("setDragPreviewVisitIds");
  expect(appSource).toContain("await commitVisitDrop(sourceItemId, targetItem, placement)");
  expect(appSource).toContain("onReorderDestinationPackages(timedReorder)");
  expect(appSource).toContain("onReorderUntimedVisit(untimedReorder)");
  expect(stylesSource).toContain(".timeline-drag-overlay-card");
  expect(stylesSource).toContain(".timeline-sortable-entry.sortable-active-placeholder");
  expect(stylesSource).toContain(".timeline-sortable-entry");
  expect(stylesSource).not.toContain(".timeline-drop-spacer");
  expect(appSource).not.toContain("data-dnd-drop-spacer");
  expect(appSource).not.toContain("dragPlaceholderHeight");
  expect(stylesSource).not.toContain(".timeline-item.dnd-placeholder-card");
  expect(stylesSource).not.toContain(".timeline-item.drag-target::before");
  expect(fixedAnchorContinuationMigration).not.toContain("DragOverlay");
});

test("Phase 4.8c foreign drag presence makes only the active formal day read-only", () => {
  expect(appSource).toContain("const canMutateThisDay = canEdit && !foreignSameDayDragActive");
  expect(appSource).toContain("正在拖曳，暫時鎖定此日編輯");
  expect(appSource).toContain("此日行程正在被其他成員調整，請稍後再儲存。");
  expect(appSource).toContain("if (foreignSameDayDragActive) {\n      setTimeError(foreignDragSaveBlockedMessage);");
  expect(appSource).toContain("disabled={!canMutateThisDay}");
  expect(appSource).toContain("disabled={!canMutateThisDay || lockedByOther}");
  expect(appSource).toContain("disabled={!canMutateThisDay || !canRequestAutoContinuation}");
  expect(appSource).toContain("if (!canMutateThisDay || isOpen || !nextItem");
  expect(appSource).toContain("if (!canMutateThisDay || isOpen || !previousItem");
  expect(appSource).toContain("foreignSameDayDragActive={foreignSameDayDragActive}");
  expect(appSource).toContain("foreignSameDayDragActive={Boolean(foreignDragPresence)}");
  expect(appSource).not.toContain("foreignSameDayDragActive={true}");
});

test("Phase 4.8c drag presence recreates closed channels without removing on drag cleanup", () => {
  expect(appSource).toContain("timelineDragPresenceChannelSummary");
  expect(appSource).toContain("timelineDragPresenceStatusRef");
  expect(appSource).toContain("timelineDragPresenceReconnectRef");
  expect(appSource).toContain("channel status on dragStart");
  expect(appSource).toContain("removeChannel reason");
  expect(appSource).toContain("track skipped reason");
  expect(appSource).toContain("stale-channel-status");
  expect(appSource).toContain("setTimelineDragPresenceChannelVersion((version) => version + 1)");
  expect(appSource).toContain("if (channel && channelReady)");
  expect(appSource).toContain("if (channel && timelineDragPresenceReadyRef.current && currentPayload)");
  expect(appSource).not.toContain("removeChannel(channel);\n    }\n  }, []);");
});

test("Phase 4.8c drag presence clears immediately when local drag ends", () => {
  expect(appSource).toContain("drag clear requested reason");
  expect(appSource).toContain("broadcast clear sent reason");
  expect(appSource).toContain("broadcast clear received");
  expect(appSource).toContain("clear ignored reason");
  expect(appSource).toContain("clear fallback local cleanup");
  expect(appSource).toContain("drag end branch name");
  expect(appSource).toContain('clearVisitDrag("cancel")');
  expect(appSource).toContain("clearVisitDrag(`drag-end-${branch}`)");
  expect(appSource).toContain('clearVisitDrag("drag-end-drop");\n    await commitVisitDrop(sourceItemId, targetItem, placement);');
  expect(appSource).toContain("current.dragId === payload.dragId || current.sessionId === payload.sessionId");
  expect(appSource).toContain("clearReason: payload.clearReason");
  expect(appSource).toContain('clearVisitDrag("commit-untimed-plan")');
  expect(appSource).toContain('branch: "timed-confirmation"');
  expect(appSource).toContain('branch: "timed-rpc"');
});

test("Phase 4.8d remote card selection is broadcast-only and does not lock the day", () => {
  expect(appSource).toContain("timeline-card-selection-update");
  expect(appSource).toContain("timeline-card-selection-clear");
  expect(appSource).toContain("const timelineCardSelectionStaleMs = 30000");
  expect(appSource).toContain("timelineCardSelectionColors");
  expect(appSource).toContain('blue: "#2f6df6"');
  expect(appSource).toContain('purple: "#7c4dff"');
  expect(appSource).toContain('orange: "#e57a1f"');
  expect(appSource).toContain('pink: "#d94d8c"');
  expect(appSource).toContain('cyan: "#1598b7"');
  expect(appSource).toContain('yellow: "#c99a00"');
  expect(appSource).not.toContain("green:");
  expect(appSource).toContain("payload.sessionId === sessionId");
  expect(appSource).toContain("selection broadcast update");
  expect(appSource).toContain("selection broadcast clear");
  expect(appSource).toContain("selection received");
  expect(appSource).toContain("selection ignored reason");
  expect(appSource).toContain("itemType: payload.itemType");
  expect(appSource).toContain('const itemType = isTransportationCard(item) ? "transport" : "destination"');
  expect(appSource).toContain('itemType === "transport" ? transportCardTitle(item)');
  expect(appSource).toContain('expectedItemType: selectedItemType');
  expect(appSource).toContain("data-remote-selection-label");
  expect(appSource).toContain("timeline-item-remote-selected");
  expect(appSource).toContain('className={`transport-card');
  expect(appSource).toContain('}${remoteSelection ? " timeline-item-remote-selected" : ""}`');
  expect(appSource).toContain('if (typeof onPublishCardSelection === "function") onPublishCardSelection(item);');
  expect(appSource).toContain("!foreignSameDayDragActive &&");
  expect(appSource).toContain('onClearCardSelection();');
  expect(appSource).not.toContain("setForeignDragPresence(payload)");
  expect(appSource).not.toContain("visitItemIds = dayItems.map");
  expect(stylesSource).toContain(".timeline-item.timeline-item-remote-selected");
  expect(stylesSource).toContain(".transport-card.timeline-item-remote-selected");
  expect(stylesSource).toContain(".transport-card.timeline-item-remote-selected::after");
  expect(stylesSource).toContain("content: attr(data-remote-selection-label)");
  expect(stylesSource).toContain("pointer-events: none");
});

test("Phase 4.8e trip-level online member presence stays navigation-only", () => {
  expect(appSource).toContain("tripPresenceHeartbeatMs = 28000");
  expect(appSource).toContain("tripPresenceStaleMs = 55000");
  expect(appSource).toContain("trip-presence:${activeTripId}");
  expect(appSource).toContain("function tripPresenceDebug");
  expect(appSource).toContain("[trip-presence]");
  expect(appSource).toContain("subscribe start");
  expect(appSource).toContain("subscribed");
  expect(appSource).toContain("track latest payload");
  expect(appSource).toContain("track skipped");
  expect(appSource).toContain("sync state");
  expect(appSource).toContain("computed online members");
  expect(appSource).toContain("avatar click navigation");
  expect(appSource).toContain("computed day tab presence");
  expect(appSource).toContain("reconnect requested reason");
  expect(appSource).toContain("recreate channel");
  expect(appSource).toContain("heartbeat requested reconnect");
  expect(appSource).toContain("focus/visibility recovery");
  expect(appSource).toContain("replay track after subscribed");
  expect(appSource).toContain("tripPresenceRecoverableStatuses");
  expect(appSource).toContain("tripPresenceChannelVersion");
  expect(appSource).toContain("selectedItemType");
  expect(appSource).toContain("selectedItemTitle");
  expect(appSource).toContain("tripPresencePageToSection");
  expect(appSource).toContain('overview: "today"');
  expect(appSource).toContain('packing: "luggage"');
  expect(appSource).toContain('timeline: "timeline"');
  expect(appSource).toContain("HeaderMemberPresencePreview");
  expect(appSource).toContain("remotePresenceByUser");
  expect(appSource).toContain("timelineDayTabPresenceByDay");
  expect(appSource).toContain("dayTabPresenceByDay");
  expect(appSource).toContain("tripPresenceSelectedItem");
  expect(appSource).toContain("member.user_id !== currentUserId");
  expect(appSource).toContain("setActiveSection(section)");
  expect(appSource).toContain("setActiveDay(Number(presence.dayIndex))");
  expect(appSource).toContain("channel.track(nextPayload)");
  expect(appSource).toContain("channel.untrack()");
  expect(appSource).not.toContain("trip-presence:${activeTripId}:${activeDay}");
  expect(stylesSource).toContain(".trip-header-member-avatar.remote-online");
  expect(appSource).toContain("has-remote-presence");
  expect(stylesSource).toContain(".day-tab.has-remote-presence");
  expect(stylesSource).toContain("--trip-presence-color");
});

test("Phase 4.8b demo timeline fixtures model formal transportation roles", () => {
  expect(appSource).toContain("createDemoTransportFixture");
  expect(appSource).toContain("createDemoTransportFixtures");
  expect(appSource).toContain("demoSortOrderForNewTimelineItem");
  expect(appSource).toContain("trip_id: demoActiveTrip.id");
  expect(appSource).toContain("demo-transport-day3-napoli-kasahara");
  expect(appSource).toContain("demo-transport-day3-hachiman-tail");
  expect(appSource).toContain("demo-transport-day2-tail-promoted-yamashina-rest");
  expect(appSource).toContain("transportRoles.normalPair");
  expect(appSource).toContain("transportRoles.tailPending");
  expect(appSource).toContain("transportRoles.tailPromotedPair");
  expect(appSource).toContain("normalizeTransportRole({ ...item, item_type: \"transport\" })");
  expect(appSource).toContain("TimelineFlowAttachment");
  expect(appSource).toContain("<SortableContext items={visitItemIds}");
});
