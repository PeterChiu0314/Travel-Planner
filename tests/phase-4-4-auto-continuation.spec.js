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

test("untimed visits are excluded and a final open-ended timed visit keeps a null end", () => {
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
    ["c", "12:15", null],
  ]);
  expect(plan.followingVisitIds).not.toContain("untimed");
});

test("fixed follower blocks auto continuation but still requests a save choice", () => {
  const items = [
    visit("a", "09:00", "10:00", 10),
    visit("b", "10:30", "11:30", 20, { is_fixed: true }),
    visit("c", "12:00", "13:00", 30),
  ];
  expect(
    planTimelineAutoContinuation({
      candidate: { ...items[0], start_time: "09:15", end_time: "10:15" },
      dayIndex: 0,
      editedItemId: "a",
      items,
    }),
  ).toMatchObject({ shouldPrompt: true, canAutoContinue: false, blockReason: "fixed_visit", updates: [] });
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
});
