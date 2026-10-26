import { expect, test } from "@playwright/test";
import { assignLuggageItem, mutateLuggageItem, reorderLuggageItems, transitionSharedLuggage } from "../src/lib/luggageService.js";

test("new clients reject unassigned mutations/conversions/reorders before making an RPC", async () => {
  let calls = 0; const client = { rpc: async () => { calls++; return {}; } };
  const item = { id: "gear", updated_at: "2026-10-26T00:00:00Z" };
  expect((await assignLuggageItem({ client, tripId: "trip", scope: "personal", item, assignedTo: null })).ok).toBe(false);
  expect((await mutateLuggageItem({ client, tripId: "trip", scope: "shared", action: "save", payload: { title: "Gear", assigned_to: null } })).ok).toBe(false);
  expect((await reorderLuggageItems({ client, tripId: "trip", scope: "shared", item, target: { ...item, assigned_to: null } })).ok).toBe(false);
  expect((await mutateLuggageItem({ client, tripId: "trip", scope: "shared", action: "patch", payload: { confirmed_by_owner: true } })).ok).toBe(false);
  expect(calls).toBe(0);
});

test("readiness belongs to the assignee; legacy confirmation is not a current client operation", () => {
  const item = { assigned_to: "A", packed_by_assignee: false, confirmed_by_owner: true };
  const context = { userId: "B", isOwner: true, approvedMemberIds: ["A", "B"] };
  expect(() => transitionSharedLuggage(item, { packed_by_assignee: true }, context)).toThrow("luggage_forbidden");
  expect(() => transitionSharedLuggage(item, { confirmed_by_owner: true }, context)).toThrow("luggage_invalid_payload");
  expect(() => transitionSharedLuggage(item, { assigned_to: null }, context)).toThrow("luggage_invalid_assignee");
  const fresh = transitionSharedLuggage({ assigned_to: "A", packed_by_assignee: false }, { packed_by_assignee: true }, { ...context, userId: "A" });
  expect(fresh.packed_by_assignee).toBe(true);
  expect(fresh).not.toHaveProperty("confirmed_by_owner");
});

test("Demo shared records all have approved assignees and no second-confirmation state", async ({ page }) => {
  await page.goto("/demo/luggage");
  const rows = await page.evaluate(async () => {
    const { createDemoSharedLuggageItems } = await import("/src/demo/luggageFixtures.js");
    return createDemoSharedLuggageItems("trip");
  });
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every(row => row.assigned_to && !Object.hasOwn(row, "confirmed_by_owner"))).toBe(true);
  await expect(page.getByText("未指派", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: /總召確認/ })).toHaveCount(0);
});
