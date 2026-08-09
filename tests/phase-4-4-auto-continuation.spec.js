import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  applyTimelineSchedulePlanToItems,
  planTimelineSchedule,
} from "../src/lib/timelineSchedulePlanner.js";

const appSource = readFileSync("src/App.jsx", "utf8");

function visit(id, startTime, endTime, sortOrder, extra = {}) {
  return {
    id,
    trip_id: "trip-1",
    day_index: 0,
    item_type: "visit",
    title: id.toUpperCase(),
    start_time: startTime,
    end_time: endTime,
    sort_order: sortOrder,
    updated_at: `2026-06-23T00:00:0${sortOrder / 10}.000Z`,
    ...extra,
  };
}

test("Phase 6 continuation removes affected historical gaps and preserves duration", () => {
  const items = [
    visit("a", "09:00", "10:00", 10),
    visit("b", "10:30", "11:30", 20),
    visit("c", "12:00", "13:00", 30),
  ];
  const plan = planTimelineSchedule({
    items,
    orderedVisitIds: ["a", "b", "c"],
    operation: { type: "edit_time", targetItemId: "a", start_time: "09:30", end_time: "10:30" },
  });
  expect(applyTimelineSchedulePlanToItems({ items, plan })).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "b", start_time: "10:30", end_time: "11:30" }),
      expect.objectContaining({ id: "c", start_time: "11:30", end_time: "12:30" }),
    ]),
  );
  expect(plan.requiresConfirmation).toBe(false);
});

test("Phase 6 fixed overflow converts only the non-fitting suffix", () => {
  const items = [
    visit("a", "07:00", "09:00", 10),
    visit("b", "10:00", "10:30", 20),
    visit("c", "10:40", "10:50", 30),
    visit("fixed", "11:00", "12:00", 40, { is_fixed: true }),
    visit("after", "14:00", "14:20", 50),
  ];
  const plan = planTimelineSchedule({
    items,
    orderedVisitIds: items.map((item) => item.id),
    operation: { type: "edit_time", targetItemId: "a", start_time: "08:00", end_time: "10:50" },
  });
  expect(plan).toMatchObject({
    automaticUntimedItemIds: ["b", "c"],
    overflowReason: "fixed",
    requiresConfirmation: true,
    stoppedAtFixedItemId: "fixed",
  });
  expect(plan.updatedItems.find((item) => item.id === "after")).toBeUndefined();
});

test("Formal App uses the authoritative unified RPC without client compensation", () => {
  expect(appSource).toContain('supabase.rpc("apply_timeline_schedule_operation"');
  expect(appSource).toContain("timelineScheduleUpdatedAtBaselines");
  expect(appSource).toContain("confirmedScheduleEffect");
  expect(appSource).not.toContain("rollbackItineraryTimeContinuation");
  expect(appSource).not.toContain("autoContinuationUpdates");
  expect(appSource).not.toContain("planTimelineAutoContinuation");
  expect(appSource).toContain("套用重大排程變更？");
  expect(appSource).toContain("確定套用");
});
