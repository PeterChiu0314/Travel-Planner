import assert from "node:assert/strict";
import test from "node:test";
import { getDraftKey, loadLatestDraftForEntity, findLatestDraftTrip } from "../src/lib/draftAutosave.js";
import { clearTimelineDraftsForItemIds, hasTimelineDraftForTrip, timelineDraftEntityType } from "../src/components/timeline/timelineDrafts.js";

function mockDraftStorage(t) {
  const drafts = new Map();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const storage = {
    get length() { return drafts.size; },
    key: index => [...drafts.keys()][index] ?? null,
    getItem: key => drafts.get(key) ?? null,
    removeItem: key => drafts.delete(key),
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete globalThis.localStorage;
  });
  const seed = ({ tripId, entityId, userId = "A", entityType = "itinerary_item", savedAt = "2026-11-19" }) => {
    const key = getDraftKey({ entityId, entityType, tripId, userId });
    drafts.set(key, JSON.stringify({ form: { title: entityId }, savedAt }));
    return key;
  };
  return { drafts, seed };
}

test("Timeline date guard finds existing drafts in the current trip and account", t => {
  const { drafts, seed } = mockDraftStorage(t);
  assert.equal(timelineDraftEntityType, "itinerary_item");
  seed({ tripId: "one", entityId: "visit" });
  seed({ tripId: "two", entityId: "visit", savedAt: "2026-11-20" });
  seed({ tripId: "three", entityId: "visit", userId: "B" });
  seed({ tripId: "three", entityId: "new", savedAt: "2026-11-21" });
  drafts.set(getDraftKey({ tripId: "three", userId: "A", entityType: "itinerary_item", entityId: "invalid" }), '{"savedAt":"2026-11-21"}');
  assert.equal(hasTimelineDraftForTrip({ tripId: "one", userId: "A" }), true);
  assert.equal(hasTimelineDraftForTrip({ tripId: "two", userId: "A" }), true);
  assert.equal(hasTimelineDraftForTrip({ tripId: "three", userId: "A" }), false);
  assert.equal(hasTimelineDraftForTrip({ tripId: "three", userId: "B" }), true);
  assert.equal(loadLatestDraftForEntity({ tripId: "three", userId: "A", entityType: "itinerary_item" }).entityId, "new");
  assert.equal(findLatestDraftTrip({ entityTypes: ["itinerary_item"], userId: "A" }).tripId, "two");
});

test("Timeline cleanup deletes only the specified cards for the given account and trip", t => {
  const { drafts, seed } = mockDraftStorage(t);
  seed({ tripId: "one", entityId: "removed" });
  const kept = [
    seed({ tripId: "one", entityId: "kept" }),
    seed({ tripId: "two", entityId: "removed" }),
    seed({ tripId: "one", entityId: "removed", userId: "B" }),
    seed({ tripId: "one", entityId: "removed", entityType: "todo_item" }),
    seed({ tripId: "one", entityId: "new" }),
  ];
  clearTimelineDraftsForItemIds({ tripId: "one", userId: "A", itemIds: new Set(["removed", "new", "missing"]) });
  assert.deepEqual([...drafts.keys()], kept);
});
