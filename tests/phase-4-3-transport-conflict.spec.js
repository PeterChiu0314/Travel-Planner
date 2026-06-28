import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { findBrokenTransportationPair } from "../src/lib/timelineTransportationConflicts.js";

const appSource = readFileSync("src/App.jsx", "utf8");

function visit(id, startTime, endTime, sortOrder) {
  return {
    id,
    trip_id: "trip-1",
    day_index: 0,
    item_type: "visit",
    title: id.toUpperCase(),
    start_time: startTime,
    end_time: endTime,
    sort_order: sortOrder,
  };
}

function transport(id, fromItemId, toItemId, extra = {}) {
  return {
    id,
    trip_id: "trip-1",
    day_index: 0,
    item_type: "transport",
    title: id,
    start_time: null,
    end_time: null,
    from_item_id: fromItemId,
    to_item_id: toItemId,
    updated_at: "2026-06-23T00:00:00.000Z",
    ...extra,
  };
}

const a = visit("a", "09:00", "10:00", 10);
const b = visit("b", "11:00", "12:00", 20);
const pair = transport("transport-ab", "a", "b");

test("new timed visit detects the valid transportation pair it would break", () => {
  expect(
    findBrokenTransportationPair({
      candidate: visit("candidate", "10:15", "10:45", 30),
      dayIndex: 0,
      items: [a, pair, b],
    }),
  ).toMatchObject({
    fromItem: { id: "a" },
    toItem: { id: "b" },
    transportItem: { id: "transport-ab" },
  });
});

test("edited timed visit detects a different valid pair after moving into its gap", () => {
  const c = visit("c", "14:00", "15:00", 30);
  expect(
    findBrokenTransportationPair({
      candidate: { ...c, start_time: "10:15", end_time: "10:45" },
      dayIndex: 0,
      editingId: "c",
      items: [a, pair, b, c],
    }),
  ).toMatchObject({ transportItem: { id: "transport-ab" } });
});

test("blank gaps, untimed visits, tails, and already invalid pairs do not prompt", () => {
  const candidate = visit("candidate", "10:15", "10:45", 30);
  expect(findBrokenTransportationPair({ candidate, dayIndex: 0, items: [a, b] })).toBeNull();
  expect(
    findBrokenTransportationPair({ candidate: { ...candidate, start_time: null }, dayIndex: 0, items: [a, pair, b] }),
  ).toBeNull();
  expect(
    findBrokenTransportationPair({ candidate, dayIndex: 0, items: [a, transport("tail-a", "a", null), b] }),
  ).toBeNull();

  const existingMiddle = visit("middle", "10:10", "10:20", 15);
  expect(
    findBrokenTransportationPair({
      candidate: visit("candidate-2", "10:30", "10:45", 30),
      dayIndex: 0,
      items: [a, pair, existingMiddle, b],
    }),
  ).toBeNull();
});

test("candidate without both neighboring timed visits does not prompt", () => {
  expect(
    findBrokenTransportationPair({
      candidate: visit("candidate", "08:00", "08:30", 30),
      dayIndex: 0,
      items: [a, pair, b],
    }),
  ).toBeNull();
  expect(
    findBrokenTransportationPair({
      candidate: visit("candidate", "13:00", "14:00", 30),
      dayIndex: 0,
      items: [a, pair, b],
    }),
  ).toBeNull();
});

test("unchanged edit position does not prompt", () => {
  expect(
    findBrokenTransportationPair({
      candidate: { ...a, end_time: "09:45" },
      dayIndex: 0,
      editingId: "a",
      items: [a, pair, b],
    }),
  ).toBeNull();
});

test("tail promoted pairs do not open the normal pair conflict prompt", () => {
  expect(
    findBrokenTransportationPair({
      candidate: { ...b, start_time: "08:00", end_time: "08:30" },
      dayIndex: 0,
      editingId: "b",
      items: [a, transport("tail-ab", "a", "b", { transport_role: "tail_promoted_pair" }), b],
    }),
  ).toBeNull();
});

test("formal resolution guards transport deletion and compensates failed combined saves", () => {
  expect(appSource).toContain('.eq("updated_at", transportConflict.updated_at)');
  expect(appSource).toContain("deferEditLockRelease: requiresDeferredCompletion");
  expect(appSource).toContain("行程變更未儲存");
  expect(appSource).toContain("新增行程未儲存");
});
