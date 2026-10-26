import { test, expect } from "@playwright/test";
import { readOfflineTripData, writeOfflineTripData, readOfflineTrips, writeOfflineTrips, clearOfflineAccount } from "../src/lib/offlineCache.js";

test("account/trip-bound offline envelopes exclude private luggage and never recover unscoped legacy data", async ({ page }) => {
  await page.goto("/tests/harness/luggage.html");
  const result = await page.evaluate(async () => {
    const cache = await import("/src/lib/offlineCache.js");
    localStorage.clear();
    localStorage.setItem("travel-planner-offline-trip", JSON.stringify({ luggageItems: [{ title: "A secret" }] }));
    cache.writeOfflineTripData("trip", "A", { luggageItems: [{ title: "A secret" }], sharedLuggageItems: [{ title: "Team" }], items: [{ title: "Visit" }] });
    cache.writeOfflineTripData("other-trip", "A", { items: [{ title: "Other" }] });
    const before = Object.values(localStorage).join("");
    const a = cache.readOfflineTripData("trip", "A");
    const b = cache.readOfflineTripData("trip", "B");
    cache.writeOfflineTripData("trip", "B", { items: [{ title: "B" }] });
    cache.clearOfflineAccount("A");
    return { before, a, b, aAfter: cache.readOfflineTripData("trip", "A"), bAfter: cache.readOfflineTripData("trip", "B"), legacy: localStorage.getItem("travel-planner-offline-trip") };
  });
  expect(result.before).not.toContain("A secret");
  expect(result.a).toMatchObject({ luggageItems: [], sharedLuggageItems: [{ title: "Team" }] });
  expect(result.b).toBeNull();
  expect(result.aAfter).toBeNull();
  expect(result.bAfter.items[0].title).toBe("B");
  expect(result.legacy).toBeNull();
});

const storage = () => ({
  getItem(k) { return this[k] ?? null; }, setItem(k, v) { this[k] = String(v); }, removeItem(k) { delete this[k]; },
});
test("cache expires, rejects identity mismatch, and account cleanup preserves other accounts and drafts", () => {
  const s = storage();
  writeOfflineTrips("A", { trips: [{ id: "trip" }] }, s, 100);
  expect(readOfflineTrips("A", s, 101).trips).toHaveLength(1);
  expect(readOfflineTrips("B", s, 101)).toBeNull();
  expect(readOfflineTrips("A", s, 100 + 13 * 60 * 60 * 1000)).toBeNull();
  writeOfflineTripData("trip", "A", { items: [] }, s, 100);
  const key = Object.keys(s).find(k => k.startsWith("travel-planner-offline-v2:"));
  s.setItem(key, JSON.stringify({ userId: "B", tripId: "trip", payload: { luggageItems: ["secret"] }, cachedAt: 100 }));
  expect(readOfflineTripData("trip", "A", s, 101)).toBeNull();
  writeOfflineTripData("trip", "A", {}, s, 100);
  writeOfflineTripData("trip", "B", {}, s, 100);
  s.setItem("travel-planner-draft:A", "draft");
  clearOfflineAccount("A", s);
  expect(readOfflineTripData("trip", "A", s, 101)).toBeNull();
  expect(readOfflineTripData("trip", "B", s, 101)).not.toBeNull();
  expect(s.getItem("travel-planner-draft:A")).toBe("draft");
});

test("blocked browser storage is best effort", () => {
  const s = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } };
  expect(() => writeOfflineTripData("trip", "A", {}, s)).not.toThrow();
  expect(readOfflineTripData("trip", "A", s)).toBeNull();
});
