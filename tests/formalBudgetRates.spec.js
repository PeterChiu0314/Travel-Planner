import { expect, test } from "@playwright/test";

import { backend, boot } from "./helpers/formalBudgetMock.js";

const summary = page => page.locator(".bw-trip-rate").filter({ visible: true });
const expectRate = (page, rate) => expect(summary(page)).toContainText(`1 JPY${rate} TWD`);
async function settle(db) { await expect.poll(() => db.rpcs.length).toBe(1); await expect.poll(() => db.pages[0].getByRole("button", { name: "更新匯率", exact: true }).isEnabled()).toBe(true); }

test.afterEach(async ({ page }) => { if (page.qaErrors) expect(page.qaErrors).toEqual([]); });

test("existing trip rates survive reload and feed both new and existing budget editors", async ({ page }) => {
  const db = backend(); await boot(page, db);
  await expectRate(page, .2);
  expect(db.quoteReads).toBe(0); expect(db.rpcs).toEqual([]);
  await page.reload(); await expectRate(page, .2);
  await page.getByRole("button", { name: "新增預算", exact: true }).click();
  const form = page.getByRole("form", { name: "預算編輯" });
  await form.getByRole("combobox", { name: "幣別", exact: true }).click();
  await page.getByRole("option", { name: "JPY", exact: true }).click();
  await expect(form.locator(".bw-trip-rate")).toContainText("1 JPY = 0.2 TWD");
  await form.getByRole("button", { name: "取消", exact: true }).click();
  const discard = page.getByRole("dialog", { name: "放棄尚未儲存的變更？", exact: true });
  if (await discard.isVisible()) await discard.getByRole("button", { name: "放棄變更", exact: true }).click();
  await page.getByRole("button", { name: "JPY fare", exact: true }).click();
  await page.getByRole("tab", { name: "編輯項目", exact: true }).click();
  await expect(form.locator(".bw-trip-rate")).toContainText("1 JPY = 0.2 TWD");
});

test("empty JSON initializes once despite its own RPC refresh and repeated trip events", async ({ page }) => {
  const db = backend({ empty: true }); await boot(page, db);
  await expectRate(page, .25); await settle(db);
  for (let i = 0; i < 3; i++) await db.emit();
  await page.reload(); await expectRate(page, .25);
  expect(db.quoteReads).toBe(1); expect(db.rpcs).toHaveLength(1);
  expect(db.rpcs[0].args.p_initialize).toBe(true);
});

test("A's manual quote refresh reaches B's already open Formal budget and totals", async ({ page, context }) => {
  const db = backend(); await boot(page, db);
  const other = await context.newPage();
  try {
    await boot(other, db, "B"); await expectRate(other, .2);
    await page.getByRole("button", { name: "更新匯率", exact: true }).click();
    await expectRate(page, .25); await expectRate(other, .25);
    // The real trips event reloads the list; budget events reload repriced rows.
    await db.emit("budget_items");
    for (const client of [page, other]) await expect(client.locator(".bw-row").filter({ hasText: "JPY fare" })).toContainText("250");
    if (process.env.ISSUE9_SCREENSHOT) {
      await summary(page).scrollIntoViewIfNeeded();
      await page.screenshot({ path: process.env.ISSUE9_SCREENSHOT, fullPage: false });
    }
    expect(db.quoteReads).toBe(1); expect(db.rpcs).toHaveLength(1);
    expect(db.rpcs[0].args.p_initialize).toBe(false);
    expect(other.qaErrors).toEqual([]);
  } finally { await other.close(); }
});

test("offline trip cache preserves rates; a later authoritative event updates them", async ({ page }) => {
  const db = backend(); await boot(page, db); await expectRate(page, .2);
  db.offline = true; await page.reload(); await expectRate(page, .2);
  await expect(page.getByRole("status")).toContainText("目前使用已快取的離線");
  db.offline = false; db.trips[0].budget_exchange_rates.rates.JPY = .3;
  await page.evaluate(() => window.dispatchEvent(new Event("online"))); await db.emit();
  await expectRate(page, .3);
  expect(db.rpcs).toEqual([]);
});

for (const kind of ["trip", "account"]) test(`delayed ${kind} list response cannot replace fresh rates after A -> B -> A`, async ({ page }) => {
  const db = backend(); await boot(page, db); await expectRate(page, .2);
  db.hold = { actor: "A" }; await db.emit();
  await expect.poll(() => db.pending.length).toBeGreaterThan(0);
  db.hold = null;
  if (kind === "trip") {
    await page.getByRole("button", { name: "Other QA", exact: true }).click(); await expectRate(page, .4);
  } else {
    await page.evaluate(() => budgetMock.switchAccount("B")); await expectRate(page, .2);
  }
  db.trips[0].budget_exchange_rates.rates.JPY = .3;
  if (kind === "trip") {
    await page.getByRole("button", { name: "Rates QA", exact: true }).click(); await db.emit();
  } else await page.evaluate(() => budgetMock.switchAccount("A"));
  await expectRate(page, .3);
  db.release(); await expect.poll(() => page.evaluate(() => budgetMock.inFlight)).toBe(0);
  await expectRate(page, .3);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("travel-planner-offline-v2:A:trips"))?.payload.trips.find(t => t.id === "trip").budget_exchange_rates.rates.JPY)).toBe(.3);
});

test("logout clears rate caches and discards an in-flight previous-account list", async ({ page }) => {
  const db = backend(); await boot(page, db); await expectRate(page, .2);
  db.hold = { actor: "A" }; await db.emit(); await expect.poll(() => db.pending.length).toBeGreaterThan(0);
  await page.evaluate(() => budgetMock.client.auth.signOut());
  await expect(page.getByRole("button", { name: /Google/ })).toBeVisible();
  db.trips[0].budget_exchange_rates.rates.JPY = .3;
  await page.evaluate(() => budgetMock.switchAccount("B")); await expectRate(page, .3);
  db.release(); await expect.poll(() => page.evaluate(() => budgetMock.inFlight)).toBe(0);
  await expectRate(page, .3);
  expect(await page.evaluate(() => localStorage.getItem("travel-planner-offline-v2:A:trips"))).toBeNull();
});

test("departed empty-rate trips never fetch or initialize a quote", async ({ page }) => {
  const db = backend({ empty: true, departed: true }); await boot(page, db);
  await page.getByRole("tab", { name: "預算", exact: true }).click();
  await expect(page.getByRole("button", { name: "更新匯率", exact: true })).toBeDisabled();
  await db.emit(); expect(db.quoteReads).toBe(0); expect(db.rpcs).toEqual([]);
});
