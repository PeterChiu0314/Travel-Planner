import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { planTimelineAutoContinuation } from "../src/lib/timelineAutoContinuation.js";

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

test("auto continuation preserves every following duration and original gap", () => {
  const items = [
    visit("a", "09:00", "10:00", 10),
    visit("b", "10:30", "11:30", 20),
    visit("c", "12:00", "13:00", 30),
  ];
  const plan = planTimelineAutoContinuation({
    candidate: { ...items[0], start_time: "09:30", end_time: "10:30" },
    dayIndex: 0,
    editedItemId: "a",
    items,
  });

  expect(plan).toMatchObject({ shouldPrompt: true, canAutoContinue: true });
  expect(plan.updates.map((item) => [item.id, item.start_time, item.end_time])).toEqual([
    ["b", "11:00", "12:00"],
    ["c", "12:30", "13:30"],
  ]);
});

test("editing a middle visit leaves earlier visits untouched and shifts only followers", () => {
  const items = [
    visit("a", "09:00", "10:00", 10),
    visit("b", "10:30", "11:30", 20),
    visit("c", "12:00", "13:00", 30),
    visit("d", "14:00", "14:30", 40),
  ];
  const plan = planTimelineAutoContinuation({
    candidate: { ...items[1], start_time: "10:45", end_time: "11:45" },
    dayIndex: 0,
    editedItemId: "b",
    items,
  });

  expect(plan.updates.map((item) => [item.id, item.start_time, item.end_time])).toEqual([
    ["c", "12:15", "13:15"],
    ["d", "14:15", "14:45"],
  ]);
  expect(plan.followingVisitIds).not.toContain("a");
});

test("untimed and partially timed visits are excluded from auto continuation", () => {
  const items = [
    visit("a", "09:00", "10:00", 10),
    visit("untimed", null, null, 15),
    visit("b", "10:30", "11:30", 20),
    visit("c", "12:00", null, 30),
  ];
  const plan = planTimelineAutoContinuation({
    candidate: { ...items[0], start_time: "09:15", end_time: "10:15" },
    dayIndex: 0,
    editedItemId: "a",
    items,
  });

  expect(plan.updates.map((item) => [item.id, item.start_time, item.end_time])).toEqual([
    ["b", "10:45", "11:45"],
  ]);
  expect(plan.followingVisitIds).not.toContain("untimed");
  expect(plan.followingVisitIds).not.toContain("c");
});

test("fixed follower is an anchor and later visits are not crossed", () => {
  const items = [
    visit("a", "07:00", "09:00", 10),
    visit("b", "10:00", "10:30", 20),
    visit("fixed", "11:00", "12:00", 30, { is_fixed: true }),
    visit("after", "14:00", "14:20", 40),
  ];
  const plan = planTimelineAutoContinuation({
    candidate: { ...items[0], start_time: "07:30", end_time: "09:30" },
    dayIndex: 0,
    editedItemId: "a",
    items,
  });

  expect(plan).toMatchObject({ shouldPrompt: true, canAutoContinue: true, fixedVisitId: "fixed" });
  expect(plan.updates.map((item) => [item.id, item.start_time, item.end_time])).toEqual([
    ["b", "10:30", "11:00"],
  ]);
  expect(plan.followingVisitIds).not.toContain("fixed");
  expect(plan.followingVisitIds).not.toContain("after");
});

test("visits that do not fit before a fixed anchor become untimed", () => {
  const items = [
    visit("a", "07:00", "09:00", 10),
    visit("b", "10:00", "10:30", 20),
    visit("c", "10:40", "10:50", 30),
    visit("fixed", "11:00", "12:00", 40, { is_fixed: true }),
    visit("after", "14:00", "14:20", 50),
  ];
  const plan = planTimelineAutoContinuation({
    candidate: { ...items[0], start_time: "08:00", end_time: "10:00" },
    dayIndex: 0,
    editedItemId: "a",
    items,
  });

  expect(plan.updates.map((item) => [item.id, item.start_time, item.end_time])).toEqual([
    ["b", null, null],
    ["c", null, null],
  ]);
  expect(plan.updates.map((item) => item.id)).not.toContain("fixed");
  expect(plan.updates.map((item) => item.id)).not.toContain("after");
});

test("new, untimed, unchanged, and final visit edits do not prompt", () => {
  const items = [visit("a", "09:00", "10:00", 10), visit("b", "11:00", "12:00", 20)];
  expect(
    planTimelineAutoContinuation({ candidate: visit("new", "10:15", "10:45", 30), dayIndex: 0, editedItemId: null, items }),
  ).toMatchObject({ shouldPrompt: false });
  expect(
    planTimelineAutoContinuation({ candidate: { ...items[0], start_time: null, end_time: null }, dayIndex: 0, editedItemId: "a", items }),
  ).toMatchObject({ shouldPrompt: false });
  expect(
    planTimelineAutoContinuation({ candidate: items[0], dayIndex: 0, editedItemId: "a", items }),
  ).toMatchObject({ shouldPrompt: false });
  expect(
    planTimelineAutoContinuation({
      candidate: { ...items[1], start_time: "11:15", end_time: "12:15" },
      dayIndex: 0,
      editedItemId: "b",
      items,
    }),
  ).toMatchObject({ shouldPrompt: false });
});

test("formal batch path uses baselines, fixed guards, deferred lock release, and compensation", () => {
  expect(appSource).toContain('.eq("updated_at", update.updated_at)');
  expect(appSource).toContain('.eq("is_fixed", false)');
  expect(appSource).toContain("rollbackItineraryTimeContinuation");
  expect(appSource).toContain("deferEditLockRelease: requiresDeferredCompletion");
  expect(appSource).toContain("autoContinuationUpdates: options.autoContinuationUpdates || []");
  expect(appSource).toContain("options.requestAutoContinuation");
  expect(appSource).toContain("自動接續後續行程？");
  expect(appSource).toContain("確定接續");
});
