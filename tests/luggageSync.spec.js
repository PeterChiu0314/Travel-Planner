import { expect, test } from "@playwright/test";
import { createRequestGuard, createLuggageRefresh, subscribeSharedLuggage, applyLuggageMutation, applyLuggageOrder } from "../src/lib/luggageSync.js";
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test("RPC merges preserve newer rows/deletions and rows absent from an older ordering response", () => {
  const newer = { id: "one", updated_at: "2026-10-26T02:00:00Z" };
  const old = { id: "one", updated_at: "2026-10-26T01:00:00Z" };
  const added = { id: "two", updated_at: "2026-10-26T03:00:00Z" };
  expect(applyLuggageMutation([newer], { action: "save", itemId: "one", data: old })).toEqual([newer]);
  expect(applyLuggageMutation([], { action: "save", itemId: "one", data: old })).toEqual([]);
  expect(applyLuggageOrder([newer, added], [old])).toEqual([newer, added]);
});

test("burst events coalesce to one shared-only read; no private subscription or unrelated workspace read", async () => {
  const guard = createRequestGuard(); guard.setContext("A:trip");
  const reads = [], applied = [], registrations = [];
  const refresh = createLuggageRefresh({ guard, read: async scope => { reads.push(scope); return { data: ["latest"] }; }, apply: (...args) => applied.push(args) });
  const channel = { on(event, config, callback) { registrations.push({ event, config, callback }); return this; } };
  subscribeSharedLuggage(channel, "trip", refresh);
  expect(registrations.map(r => r.config.table)).toEqual(["shared_luggage_items"]);
  for (let i = 0; i < 20; i++) registrations[0].callback({ eventType: i % 2 ? "UPDATE" : "DELETE" });
  await expect.poll(() => reads.length).toBe(1);
  expect(reads).toEqual(["shared"]);
  expect(applied).toEqual([["shared", ["latest"]]]);
  refresh.cancel();
});

test("an event during an in-flight read discards the old snapshot and performs one follow-up", async () => {
  const guard = createRequestGuard(); guard.setContext("A:trip");
  const first = deferred(), applied = []; let reads = 0;
  const refresh = createLuggageRefresh({ guard, read: () => ++reads === 1 ? first.promise : Promise.resolve({ data: ["new"] }), apply: (scope, data) => applied.push(data) });
  const pending = refresh.refresh(["shared"]);
  const merged = refresh.refresh(["shared"]);
  first.resolve({ data: ["old"] });
  await Promise.all([pending, merged]);
  expect(reads).toBe(2);
  expect(applied).toEqual([["new"]]);
});

test("account/trip ABA switches and completed RPCs invalidate obsolete reads", async () => {
  const guard = createRequestGuard(); guard.setContext("A:trip");
  const old = deferred(), applied = [];
  const refresh = createLuggageRefresh({ guard, read: () => old.promise, apply: (scope, data) => applied.push(data) });
  const pending = refresh.refresh(["personal"]);
  guard.setContext("B:trip"); guard.setContext("A:trip");
  old.resolve({ data: ["private A old session"] }); await pending;
  expect(applied).toEqual([]);
  const full = guard.begin("shared");
  guard.invalidate(["shared"]); // RPC finished with its canonical new row.
  expect(guard.valid(full)).toBe(false);
  const latest = guard.begin("shared");
  expect(guard.valid(latest)).toBe(true);
  guard.setContext("A:other-trip"); expect(guard.valid(latest)).toBe(false);
});

test("failed scoped reads preserve data and a later refresh recovers", async () => {
  const guard = createRequestGuard(); guard.setContext("A:trip");
  const data = ["kept"], errors = []; let offline = true;
  const refresh = createLuggageRefresh({ guard, read: async () => offline ? { error: Error("offline") } : { data: ["fresh"] }, apply: (scope, rows) => data.splice(0, data.length, ...rows), onError: error => errors.push(error.message) });
  await refresh.refresh(["shared"]); expect(data).toEqual(["kept"]);
  offline = false; await refresh.refresh(["shared"]);
  expect(data).toEqual(["fresh"]); expect(errors).toEqual(["offline"]);
});

test("resubscription after a context change replaces a scheduled old-context refresh", async () => {
  const guard = createRequestGuard(); guard.setContext("A:old-trip");
  const reads = [];
  const refresh = createLuggageRefresh({ guard, read: async (scope, key) => { reads.push(key); return { data: [] }; }, apply() {} });
  refresh.schedule(["shared"]);
  guard.setContext("B:new-trip");
  refresh.schedule(["shared"]);
  await expect.poll(() => reads).toEqual(["B:new-trip"]);
  refresh.cancel();
});
