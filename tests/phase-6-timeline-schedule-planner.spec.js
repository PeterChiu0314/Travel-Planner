import { expect, test } from "@playwright/test";
import {
  applyTimelineSchedulePlanToItems,
  attachTimelineScheduleSortOrders,
  planTimelineSchedule,
  remapTimelineSchedulePlanItemIds,
  timelineMinutesToTime,
  timelineScheduleOperationTypes,
  timelineTimeToMinutes,
} from "../src/lib/timelineSchedulePlanner.js";

function visit(id, start_time, end_time, extra = {}) {
  return {
    day_index: 0,
    id,
    item_type: "visit",
    is_fixed: false,
    location_name: id,
    sort_order: 10,
    start_time,
    end_time,
    updated_at: `revision-${id}`,
    ...extra,
  };
}

function transport(id, from_item_id, to_item_id, duration, extra = {}) {
  return {
    day_index: 0,
    from_item_id,
    id,
    item_type: "transport",
    to_item_id,
    transport_duration_minutes: duration,
    transport_role: "normal_pair",
    updated_at: `revision-${id}`,
    ...extra,
  };
}

function plan(items, operation, orderedVisitIds = items.filter((item) => item.item_type !== "transport").map((item) => item.id)) {
  return planTimelineSchedule({ items, operation, orderedVisitIds });
}

function timeUpdate(result, id) {
  const update = result.updatedItems.find((item) => item.id === id);
  return update ? { end_time: update.end_time, start_time: update.start_time } : null;
}

test("strict time primitives include the exact 24:00 end boundary", () => {
  expect(timelineTimeToMinutes("23:59")).toBe(1439);
  expect(timelineTimeToMinutes("24:00")).toBeNull();
  expect(timelineTimeToMinutes("24:00", { allowDayBoundary: true })).toBe(1440);
  expect(timelineMinutesToTime(1440)).toBe("24:00");
  expect(timelineTimeToMinutes("09:60")).toBeNull();
});

test("Planner follows supplied visual order and never start_time sorting", () => {
  const items = [visit("b", "11:00", "12:00"), visit("a", "09:00", "10:00"), visit("c", "13:00", "14:00")];
  const result = plan(items, { type: "edit_time", targetItemId: "b", start_time: "08:00", end_time: "09:00" }, ["b", "a", "c"]);
  expect(result.ok).toBe(true);
  expect(timeUpdate(result, "a")).toBeNull();
  expect(timeUpdate(result, "c")).toEqual({ start_time: "10:00", end_time: "11:00" });
});

test("extending one card shifts the downstream segment and preserves duration", () => {
  const items = [visit("a", "09:00", "10:00"), visit("b", "10:15", "11:15"), visit("c", "11:45", "12:15")];
  const result = plan(items, { type: "edit_time", targetItemId: "a", start_time: "09:00", end_time: "10:30" });
  expect(result.ok).toBe(true);
  expect(timeUpdate(result, "b")).toEqual({ start_time: "10:30", end_time: "11:30" });
  expect(timeUpdate(result, "c")).toEqual({ start_time: "11:30", end_time: "12:00" });
  expect(result.requiresConfirmation).toBe(false);
});

test("shortening one card pulls the downstream segment forward and removes historical gaps", () => {
  const items = [visit("a", "09:00", "10:00"), visit("b", "10:30", "11:30"), visit("c", "12:00", "13:00")];
  const result = plan(items, { type: "edit_time", targetItemId: "a", start_time: "09:00", end_time: "09:30" });
  expect(timeUpdate(result, "b")).toEqual({ start_time: "09:30", end_time: "10:30" });
  expect(timeUpdate(result, "c")).toEqual({ start_time: "10:30", end_time: "11:30" });
});

test("an earlier conflict rejects without moving predecessors", () => {
  const items = [visit("a", "09:00", "10:00"), visit("b", "10:30", "11:30")];
  const result = plan(items, { type: "edit_time", targetItemId: "b", start_time: "09:45", end_time: "10:45" });
  expect(result).toMatchObject({ earliestStart: "10:00", ok: false, validationError: "earlier_conflict" });
});

test("an edit that overlaps followers is accepted and repacked", () => {
  const items = [visit("a", "09:00", "10:00"), visit("b", "10:00", "11:00")];
  const result = plan(items, { type: "edit_time", targetItemId: "a", start_time: "09:00", end_time: "10:45" });
  expect(result.ok).toBe(true);
  expect(timeUpdate(result, "b")).toEqual({ start_time: "10:45", end_time: "11:45" });
});

test("a valid transport duration participates in continuation", () => {
  const items = [visit("a", "09:00", "10:00"), visit("b", "10:45", "11:45"), transport("t", "a", "b", 30)];
  const result = plan(items, { type: "edit_time", targetItemId: "a", start_time: "09:00", end_time: "10:15" });
  expect(timeUpdate(result, "b")).toBeNull();
  expect(result.updatedItems.find((item) => item.id === "t")).toMatchObject({
    from_snapshot_end_time: "10:15",
    to_snapshot_start_time: "10:45",
  });
});

test("transport continuation rounds the next visit upward to the five-minute timeline step", () => {
  const items = [
    visit("a", "15:10", "16:10"),
    transport("t-ab", "a", "b", 8),
    visit("b", "16:30", "17:30"),
  ];
  const result = plan(items, { type: "edit_time", targetItemId: "a", start_time: "15:10", end_time: "16:10" });

  expect(result.ok).toBe(true);
  expect(result.updatedItems).toContainEqual({ id: "b", start_time: "16:20", end_time: "17:20" });
  expect(items.find((item) => item.id === "t-ab").transport_duration_minutes).toBe(8);
});

test("five-minute continuation keeps exact boundaries and rounds each transport leg independently", () => {
  const items = [
    visit("a", "15:10", "16:10"),
    transport("t-ab", "a", "b", 10),
    visit("b", "16:30", "17:30"),
    transport("t-bc", "b", "c", 7),
    visit("c", "18:00", "18:30"),
  ];
  const result = plan(items, { type: "edit_time", targetItemId: "a", start_time: "15:10", end_time: "16:10" });

  expect(result.ok).toBe(true);
  expect(result.updatedItems).toEqual(expect.arrayContaining([
    { id: "b", start_time: "16:20", end_time: "17:20" },
    { id: "c", start_time: "17:30", end_time: "18:00" },
  ]));
});

test("earlier-conflict guidance uses the five-minute transport ceiling", () => {
  const items = [
    visit("a", "15:10", "16:10"),
    transport("t-ab", "a", "b", 8),
    visit("b", "16:30", "17:30"),
  ];
  const result = plan(items, { type: "edit_time", targetItemId: "b", start_time: "16:18", end_time: "17:18" });

  expect(result).toMatchObject({ earliestStart: "16:20", ok: false, validationError: "earlier_conflict" });
});

test("increasing transport duration shifts from to_item", () => {
  const items = [visit("a", "09:00", "10:00"), visit("b", "10:20", "11:20"), visit("c", "11:30", "12:00"), transport("t", "a", "b", 20)];
  const result = plan(items, {
    type: timelineScheduleOperationTypes.upsertTransport,
    transport: transport("t", "a", "b", 45),
  });
  expect(timeUpdate(result, "b")).toEqual({ start_time: "10:45", end_time: "11:45" });
  expect(timeUpdate(result, "c")).toEqual({ start_time: "11:45", end_time: "12:15" });
});

test("decreasing transport duration pulls from to_item forward", () => {
  const items = [visit("a", "09:00", "10:00"), visit("b", "10:45", "11:45"), transport("t", "a", "b", 45)];
  const result = plan(items, { type: "upsert_transport", transport: transport("t", "a", "b", 10) });
  expect(timeUpdate(result, "b")).toEqual({ start_time: "10:10", end_time: "11:10" });
});

test("adding transport schedules from to_item without confirmation", () => {
  const items = [visit("a", "09:00", "10:00"), visit("b", "10:30", "11:30")];
  const result = plan(items, { type: "upsert_transport", transport: transport("new-t", "a", "b", 15) });
  expect(result.ok).toBe(true);
  expect(result.upsertedTransport.id).toBe("new-t");
  expect(timeUpdate(result, "b")).toEqual({ start_time: "10:15", end_time: "11:15" });
  expect(result.requiresConfirmation).toBe(false);
});

test("explicit transport deletion repacks from former to_item without repeat confirmation", () => {
  const items = [visit("a", "09:00", "10:00"), visit("b", "10:30", "11:30"), transport("t", "a", "b", 30)];
  const result = plan(items, { type: "delete_transport", transportId: "t" });
  expect(result.removedTransportIds).toEqual(["t"]);
  expect(timeUpdate(result, "b")).toEqual({ start_time: "10:00", end_time: "11:00" });
  expect(result.requiresConfirmation).toBe(false);
});

test("explicit timed to untimed keeps visual order and repacks later timed cards", () => {
  const items = [visit("a", "09:00", "10:00"), visit("b", "10:30", "11:30"), visit("c", "12:00", "13:00")];
  const result = plan(items, { type: "clear_time", targetItemId: "b" });
  expect(timeUpdate(result, "b")).toEqual({ start_time: null, end_time: null });
  expect(timeUpdate(result, "c")).toEqual({ start_time: "10:00", end_time: "11:00" });
  expect(result.orderedVisitIds).toEqual(["a", "b", "c"]);
  expect(result.requiresConfirmation).toBe(false);
});

test("untimed to timed behaves as a single-card edit", () => {
  const items = [visit("a", "09:00", "10:00"), visit("b", null, null), visit("c", "11:30", "12:30")];
  const result = plan(items, { type: "restore_time", targetItemId: "b", start_time: "10:15", end_time: "11:00" });
  expect(result.ok).toBe(true);
  expect(timeUpdate(result, "b")).toEqual({ start_time: "10:15", end_time: "11:00" });
  expect(timeUpdate(result, "c")).toEqual({ start_time: "11:00", end_time: "12:00" });
});

test("an untimed middle node is transparent but blocks transport borrowing", () => {
  const items = [
    visit("a", "09:00", "10:00"),
    visit("u", null, null),
    visit("b", "11:00", "12:00"),
    transport("t", "a", "b", 45),
  ];
  const result = plan(items, { type: "edit_time", targetItemId: "a", start_time: "09:00", end_time: "10:15" });
  expect(timeUpdate(result, "b")).toEqual({ start_time: "10:15", end_time: "11:15" });
  expect(result.suspendedTransportIds).toEqual(["t"]);
});

test("transport with an untimed endpoint remains stored and is suspended", () => {
  const items = [visit("a", "09:00", "10:00"), visit("b", "10:30", "11:30"), transport("t", "a", "b", 30)];
  const result = plan(items, { type: "clear_time", targetItemId: "b" });
  expect(result.removedTransportIds).toEqual([]);
  expect(result.suspendedTransportIds).toEqual(["t"]);
});

test("partial time input is rejected rather than normalized", () => {
  const result = plan([visit("a", "09:00", null)], { type: "clear_time", targetItemId: "a" });
  expect(result).toMatchObject({ invalidItemId: "a", ok: false, validationError: "partial_time" });
});

test("invalid non-positive duration is rejected", () => {
  const result = plan([visit("a", "09:00", "09:00")], { type: "clear_time", targetItemId: "a" });
  expect(result).toMatchObject({ ok: false, validationError: "invalid_range" });
});

test("fixed anchor contains the affected segment and leaves later content unchanged", () => {
  const items = [
    visit("a", "09:00", "10:00"),
    visit("b", "10:15", "11:15"),
    visit("fixed", "12:00", "13:00", { is_fixed: true }),
    visit("c", "14:00", "15:00"),
  ];
  const result = plan(items, { type: "edit_time", targetItemId: "a", start_time: "09:00", end_time: "10:30" });
  expect(timeUpdate(result, "b")).toEqual({ start_time: "10:30", end_time: "11:30" });
  expect(timeUpdate(result, "fixed")).toBeNull();
  expect(timeUpdate(result, "c")).toBeNull();
  expect(result.stoppedAtFixedItemId).toBe("fixed");
});

test("fixed overflow converts the first non-fitting suffix to untimed", () => {
  const items = [
    visit("a", "09:00", "10:00"),
    visit("b", "10:00", "11:00"),
    visit("c", "11:00", "12:00"),
    visit("fixed", "12:00", "13:00", { is_fixed: true }),
    visit("after", "14:00", "15:00"),
  ];
  const result = plan(items, { type: "edit_time", targetItemId: "a", start_time: "09:00", end_time: "10:30" });
  expect(timeUpdate(result, "b")).toEqual({ start_time: "10:30", end_time: "11:30" });
  expect(timeUpdate(result, "c")).toEqual({ start_time: null, end_time: null });
  expect(result).toMatchObject({ overflowReason: "fixed", requiresConfirmation: true, stoppedAtFixedItemId: "fixed" });
  expect(timeUpdate(result, "after")).toBeNull();
});

test("transport into a fixed anchor is included in the fixed boundary", () => {
  const items = [
    visit("a", "09:00", "10:00"),
    visit("b", "10:00", "11:00"),
    transport("t", "b", "fixed", 45),
    visit("fixed", "11:30", "12:30", { is_fixed: true }),
  ];
  const result = plan(items, { type: "edit_time", targetItemId: "a", start_time: "09:00", end_time: "10:15" });
  expect(timeUpdate(result, "b")).toEqual({ start_time: null, end_time: null });
  expect(result).toMatchObject({
    automaticUntimedItemIds: ["b"],
    overflowReason: "fixed",
    requiresConfirmation: true,
    stoppedAtFixedItemId: "fixed",
  });
  expect(result.suspendedTransportIds).toEqual(["t"]);
});

test("editing the destination directly before fixed includes its incoming transport and untimes the suffix", () => {
  const items = [
    visit("a", "09:00", "10:00"),
    visit("b", "10:00", "11:00"),
    transport("t", "b", "fixed", 45),
    visit("fixed", "11:30", "12:30", { is_fixed: true }),
  ];
  const result = plan(items, { type: "edit_time", targetItemId: "b", start_time: "10:00", end_time: "11:15" });
  expect(timeUpdate(result, "b")).toEqual({ start_time: null, end_time: null });
  expect(result).toMatchObject({
    automaticUntimedItemIds: ["b"],
    overflowReason: "fixed",
    requiresConfirmation: true,
    stoppedAtFixedItemId: "fixed",
  });
  expect(result.suspendedTransportIds).toEqual(["t"]);
});

test("an edited destination that cannot fit before fixed untimes every timed card in that suffix", () => {
  const items = [
    visit("a", "09:00", "10:00"),
    visit("b", "10:00", "11:00"),
    visit("c", "11:00", "11:30"),
    visit("fixed", "12:00", "13:00", { is_fixed: true }),
  ];
  const result = plan(items, { type: "edit_time", targetItemId: "b", start_time: "10:00", end_time: "12:15" });
  expect(timeUpdate(result, "b")).toEqual({ start_time: null, end_time: null });
  expect(timeUpdate(result, "c")).toEqual({ start_time: null, end_time: null });
  expect(result.automaticUntimedItemIds).toEqual(["b", "c"]);
  expect(result.overflowReason).toBe("fixed");
});

test("a card may end exactly at 24:00", () => {
  const items = [visit("a", "22:00", "23:00"), visit("b", "23:00", "24:00")];
  const result = plan(items, { type: "edit_time", targetItemId: "a", start_time: "22:00", end_time: "23:00" });
  expect(result.ok).toBe(true);
  expect(result.overflowReason).toBeNull();
  expect(result.automaticUntimedItemIds).toEqual([]);
});

test("day overflow converts the non-fitting suffix to untimed", () => {
  const items = [visit("a", "22:00", "23:00"), visit("b", "23:00", "23:45"), visit("c", "23:45", "24:00")];
  const result = plan(items, { type: "edit_time", targetItemId: "a", start_time: "22:00", end_time: "23:30" });
  expect(timeUpdate(result, "b")).toEqual({ start_time: null, end_time: null });
  expect(timeUpdate(result, "c")).toEqual({ start_time: null, end_time: null });
  expect(result).toMatchObject({ overflowReason: "day_boundary", requiresConfirmation: true });
});

test("reorder starts at the first changed visual slot and preserves visit durations", () => {
  const items = [visit("a", "09:00", "10:00"), visit("b", "10:30", "11:00"), visit("c", "12:00", "13:30")];
  const result = plan(items, { type: "reorder", orderedVisitIds: ["b", "a", "c"] });
  expect(result.ok).toBe(true);
  expect(result.operationStartIndex).toBe(0);
  expect(timeUpdate(result, "b")).toEqual({ start_time: "09:00", end_time: "09:30" });
  expect(timeUpdate(result, "a")).toEqual({ start_time: "09:30", end_time: "10:30" });
  expect(timeUpdate(result, "c")).toEqual({ start_time: "10:30", end_time: "12:00" });
});

test("reorder preserves a gap before the operation start and removes later gaps", () => {
  const items = [visit("a", "08:00", "09:00"), visit("b", "10:00", "11:00"), visit("c", "12:00", "13:00"), visit("d", "14:00", "15:00")];
  const result = plan(items, { type: "reorder", orderedVisitIds: ["a", "b", "d", "c"] });
  expect(timeUpdate(result, "a")).toBeNull();
  expect(timeUpdate(result, "b")).toBeNull();
  expect(timeUpdate(result, "d")).toEqual({ start_time: "11:00", end_time: "12:00" });
  expect(timeUpdate(result, "c")).toBeNull();
});

test("reorder reports broken transport and requires the existing major confirmation", () => {
  const items = [visit("a", "09:00", "10:00"), visit("b", "10:30", "11:30"), visit("c", "12:00", "13:00"), transport("t", "a", "b", 30)];
  const result = plan(items, { type: "reorder", orderedVisitIds: ["b", "a", "c"] });
  expect(result.removedTransportIds).toEqual(["t"]);
  expect(result.requiresConfirmation).toBe(true);
});

test("reorder preserves a transport that was already suspended before the operation", () => {
  const items = [
    visit("a", "09:00", "10:00"),
    visit("u", null, null),
    visit("b", "10:30", "11:30"),
    visit("c", "12:00", "13:00"),
    visit("d", "13:30", "14:30"),
    transport("suspended", "a", "b", 30),
  ];
  const result = plan(items, { type: "reorder", orderedVisitIds: ["a", "u", "b", "d", "c"] });
  expect(result.ok).toBe(true);
  expect(result.removedTransportIds).toEqual([]);
  expect(result.suspendedTransportIds).toEqual(["suspended"]);
  expect(result.requiresConfirmation).toBe(false);
});

test("reorder cannot move a fixed anchor's visual slot", () => {
  const items = [visit("a", "09:00", "10:00"), visit("fixed", "11:00", "12:00", { is_fixed: true }), visit("b", "13:00", "14:00")];
  const result = plan(items, { type: "reorder", orderedVisitIds: ["a", "b", "fixed"] });
  expect(result).toMatchObject({ ok: false, validationError: "fixed_boundary_crossed" });
});

test("reorder cannot exchange destinations across a fixed boundary while leaving the anchor in place", () => {
  const items = [
    visit("a", "09:00", "10:00"),
    visit("fixed", "11:00", "12:00", { is_fixed: true }),
    visit("b", "13:00", "14:00"),
  ];
  const result = plan(items, { type: "reorder", orderedVisitIds: ["b", "fixed", "a"] });
  expect(result).toMatchObject({ ok: false, validationError: "fixed_boundary_crossed" });
});

test("sort-order adapter keeps converted untimed cards in visual order", () => {
  const items = [visit("a", "09:00", "10:00", { sort_order: 10 }), visit("b", "10:00", "11:00", { sort_order: 20 })];
  const basePlan = plan(items, { type: "clear_time", targetItemId: "a" });
  const result = attachTimelineScheduleSortOrders({ items, plan: basePlan });
  const a = result.updatedItems.find((item) => item.id === "a");
  expect(a.sort_order).toBeLessThan(-100_000_000);
  expect(result.orderedVisitIds).toEqual(["a", "b"]);
});

test("applying a plan is deterministic and does not mutate source objects", () => {
  const items = [visit("a", "09:00", "10:00"), visit("b", "10:30", "11:30")];
  const before = structuredClone(items);
  const result = plan(items, { type: "edit_time", targetItemId: "a", start_time: "09:00", end_time: "10:15" });
  const applied = applyTimelineSchedulePlanToItems({ items, plan: result, targetItemId: "a", targetPayload: { title: "changed" }, updatedAt: "new-revision" });
  expect(items).toEqual(before);
  expect(applied.find((item) => item.id === "b")).toMatchObject({ start_time: "10:15", end_time: "11:15", updated_at: "new-revision" });
  expect(plan(items, { type: "edit_time", targetItemId: "a", start_time: "09:00", end_time: "10:15" })).toEqual(result);
});

test("reloading an applied authoritative result converges without compensation updates", () => {
  const items = [visit("a", "09:00", "10:00"), visit("b", "10:30", "11:30"), visit("c", "12:00", "13:00")];
  const operation = { type: "edit_time", targetItemId: "a", start_time: "09:00", end_time: "10:15" };
  const firstPlan = attachTimelineScheduleSortOrders({ items, plan: plan(items, operation) });
  const reloadedItems = applyTimelineSchedulePlanToItems({
    items,
    plan: firstPlan,
    targetItemId: "a",
    targetPayload: { start_time: "09:00", end_time: "10:15" },
    updatedAt: "authoritative-revision",
  });
  const convergedPlan = attachTimelineScheduleSortOrders({
    items: reloadedItems,
    plan: plan(reloadedItems, operation),
  });
  expect(convergedPlan.ok).toBe(true);
  expect(convergedPlan.updatedItems).toEqual([]);
  expect(convergedPlan.removedTransportIds).toEqual([]);
  expect(convergedPlan.requiresConfirmation).toBe(false);
});

test("package reorder plans remap source destination updates onto stable slot ids", () => {
  const result = plan(
    [visit("slot-a", "09:00", "10:00"), visit("slot-b", "10:00", "11:30")],
    { type: "reorder", orderedVisitIds: ["slot-b", "slot-a"] },
  );
  const remapped = remapTimelineSchedulePlanItemIds({
    plan: result,
    sourceToSlotIds: { "slot-a": "slot-b", "slot-b": "slot-a" },
  });
  expect(timeUpdate(remapped, "slot-a")).toEqual({ start_time: "09:00", end_time: "10:30" });
  expect(timeUpdate(remapped, "slot-b")).toEqual({ start_time: "10:30", end_time: "11:30" });
  expect(remapped.orderedVisitIds).toEqual(["slot-a", "slot-b"]);
});

test("invalid manifests and invalid transport endpoints reject explicitly", () => {
  const items = [visit("a", "09:00", "10:00"), visit("b", "10:00", "11:00")];
  expect(planTimelineSchedule({ items, orderedVisitIds: ["a"], operation: { type: "clear_time", targetItemId: "a" } })).toMatchObject({ ok: false, validationError: "invalid_manifest" });
  expect(plan(items, { type: "upsert_transport", transport: transport("t", "b", "a", 10) })).toMatchObject({ ok: false, validationError: "invalid_transport" });
  expect(plan(items, { type: "reorder" })).toMatchObject({ ok: false, validationError: "invalid_manifest" });
  expect(plan(items, { type: "reorder", orderedVisitIds: [] })).toMatchObject({ ok: false, validationError: "invalid_manifest" });
  expect(plan(items, { type: "upsert_transport", transport: transport("a", "a", "b", 10) })).toMatchObject({ ok: false, validationError: "invalid_transport" });
});
