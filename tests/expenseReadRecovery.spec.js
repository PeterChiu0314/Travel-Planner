import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { boot, expenseBackend } from "./helpers/expenseBackend.js";

const errorText = "目前無法讀取支出，草稿已保留。";
const retry = page => page.getByRole("button", { name: "重新讀取支出", exact: true });
const add = page => page.getByRole("button", { name: "新增項目", exact: true });
const nav = (page, name) => page.locator(".section-nav-button").getByText(name, { exact: true });

for (const scenario of ["PGRST202", "42501", "network", "timeout"]) {
  test(`first expense read recovers from ${scenario} without blocking other workspaces`, async ({ page }) => {
    const fixture = await expenseBackend();
    let releaseTimeout;
    const timeout = new Promise(resolve => { releaseTimeout = resolve; });
    const request = fixture.db.request.bind(fixture.db);
    let failedReads = 0, fail = true;
    fixture.db.rows.itinerary_items = [{
      id: randomUUID(), trip_id: fixture.trip, day_index: 0, sort_order: 0,
      item_type: "activity", type: "attraction", title: "Issue 24 QA stop",
    }];
    fixture.db.rows.accommodations = [{
      id: randomUUID(), trip_id: fixture.trip, name: "Issue 24 QA stay",
      check_in_date: "2090-04-05", check_out_date: "2090-04-06",
    }];
    fixture.db.request = async call => {
      if (!fail || call.name !== "read_expense_snapshot") return request(call);
      failedReads++;
      if (scenario === "timeout" && failedReads === 1) return timeout;
      if (scenario === "network") throw new Error("Failed to fetch");
      return { error: { code: scenario, message: "Injected snapshot failure" } };
    };
    try {
      if (scenario === "timeout") await page.clock.install();
      await boot(page, fixture.db, fixture.A, { waitForBudget: false });
      await expect.poll(() => failedReads).toBeGreaterThan(0);
      if (scenario === "timeout") await page.clock.fastForward(11_000);

      await expect(page.getByText(errorText, { exact: true })).toBeVisible();
      await expect(retry(page)).toBeEnabled();
      await expect(add(page)).toHaveCount(0);

      if (scenario === "PGRST202") {
        await nav(page, "行程路線").click();
        await expect(page.getByRole("heading", { name: "Issue 24 QA stop", exact: true })).toBeVisible();
        await nav(page, "住宿資訊").click();
        await expect(page.getByRole("heading", { name: "Issue 24 QA stay", exact: true })).toBeVisible();
        await nav(page, "行李清單").click();
        await expect(page.getByRole("heading", { name: "個人行李", exact: true })).toBeVisible();
        await nav(page, "預算管理").click();
        await expect(retry(page)).toBeVisible();
      }

      fail = false;
      await retry(page).click();
      await expect(page.getByRole("table", { name: "預算明細", exact: true })).toBeVisible();
      releaseTimeout({ error: { code: "42501", message: "Late fixture response" } });
      await expect(add(page)).toBeEnabled();
      await expect(page.getByText(errorText, { exact: true })).toHaveCount(0);
      expect(page.qaErrors).toEqual([]);
    } finally {
      releaseTimeout({ error: { code: "42501", message: "Late fixture response" } });
      await page.close();
      await fixture.close();
    }
  });
}

test("a snapshot permission refusal hides previously visible expenses until a verified retry", async ({ page }) => {
  const fixture = await expenseBackend();
  const title = "Issue 24 QA private expense";
  const result = await fixture.db.request({
    op: "rpc", name: "create_named_expense_item", actor: fixture.A,
    args: { p_trip_id: fixture.trip, p_id: randomUUID(), p_session_id: randomUUID(),
      p_request_id: randomUUID(), p_title: title },
  });
  expect(result.error).toBeUndefined();
  const request = fixture.db.request.bind(fixture.db);
  let finishOfflineRead;
  const offlineRead = new Promise(resolve => { finishOfflineRead = resolve; });
  let holdOfflineRead = false;
  let failure, deniedReads = 0;
  fixture.db.rows.accommodations = [{
    id: randomUUID(), trip_id: fixture.trip, name: "Issue 24 cache QA stay",
    check_in_date: "2090-04-05", check_out_date: "2090-04-06",
  }];
  fixture.db.request = async call => {
    if (holdOfflineRead && call.name === "read_expense_snapshot") return offlineRead;
    if (failure && call.name === "read_expense_snapshot") {
      deniedReads++;
      return { error: failure };
    }
    return request(call);
  };
  try {
    await boot(page, fixture.db, fixture.A);
    const row = page.getByRole("button", { name: title, exact: true });
    await expect(row).toBeVisible();
    const cacheKey = `travel-planner-offline-v2:${fixture.A}:trip:${fixture.trip}`;
    await expect.poll(() => page.evaluate(key => !!JSON.parse(localStorage.getItem(key))?.payload.expenseGraph, cacheKey)).toBe(true);
    const cachedAt = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).payload.expenseGraphCachedAt, cacheKey);
    expect(Number.isFinite(cachedAt)).toBe(true);

    holdOfflineRead = true;
    await page.reload();
    await nav(page, "住宿資訊").click();
    await expect(page.getByRole("heading", { name: "Issue 24 cache QA stay", exact: true })).toBeVisible();
    expect(await page.evaluate(key => !!JSON.parse(localStorage.getItem(key))?.payload.expenseGraph, cacheKey)).toBe(true);
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).payload.expenseGraphCachedAt, cacheKey)).toBe(cachedAt);
    failure = { message: "offline" };
    holdOfflineRead = false;
    finishOfflineRead({ error: failure });
    await nav(page, "預算管理").click();
    await expect(row).toBeVisible();
    await expect(add(page)).toBeDisabled();
    failure = null;
    await fixture.db.emit("expense_signals", { eventType: "UPDATE", new: { trip_id: fixture.trip } });
    await expect(add(page)).toBeEnabled();

    failure = { code: "42501", message: "Injected snapshot refusal" };
    await fixture.db.emit("expense_signals", { eventType: "UPDATE", new: { trip_id: fixture.trip } });
    await expect.poll(() => deniedReads).toBeGreaterThan(0);
    await expect(retry(page)).toBeEnabled();
    await expect(row).toHaveCount(0);
    await expect(add(page)).toHaveCount(0);
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key))?.payload.expenseGraph, cacheKey)).toBeNull();
    failure = null;
    await retry(page).click();
    await expect(row).toBeVisible();
    await expect(add(page)).toBeEnabled();
    expect(page.qaErrors).toEqual([]);
  } finally {
    finishOfflineRead({ error: { message: "offline" } });
    await page.close();
    await fixture.close();
  }
});
