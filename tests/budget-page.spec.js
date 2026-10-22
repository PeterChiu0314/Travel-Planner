import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/demo/budget");
  await expect(page.getByRole("heading", { name: "預算", exact: true })).toBeVisible();
});

test("search and category filters keep whole-trip totals and actual expenses unchanged", async ({ page }) => {
  const summary = page.getByLabel("旅程費用摘要");
  const summaryBefore = await summary.textContent();
  await page.getByLabel("預算分類", { exact: true }).selectOption("餐飲");
  await expect(page.locator(".planned-budget-list article")).toHaveCount(1);
  await expect(page.locator(".planned-budget-list article")).toContainText("新宿午餐");
  await page.getByLabel("搜尋預算", { exact: true }).fill("Peter");
  await expect(page.getByText("找不到符合條件的預算")).toBeVisible();
  await expect(summary).toHaveText(summaryBefore);
  await expect(page.locator(".actual-panel article")).toHaveCount(1);
  await page.getByRole("button", { name: "清除篩選", exact: true }).click();
  await expect(page.locator(".planned-budget-list article")).toHaveCount(2);
  await page.getByLabel("搜尋預算", { exact: true }).fill("指定席");
  await expect(page.locator(".planned-budget-list article")).toHaveCount(1);
  await expect(page.locator(".planned-budget-list article")).toContainText("成田特快");
});

test("budget create edit convert and delete preserve the expense flow", async ({ page }) => {
  await page.getByRole("button", { name: "新增預算", exact: true }).click();
  const form = page.locator(".budget-panel > .budget-form");
  await form.getByLabel("標題", { exact: true }).fill("桌面測試門票");
  await form.getByLabel("金額", { exact: true }).fill("1200");
  await form.getByRole("button", { name: "儲存", exact: true }).click();
  const card = page.locator(".planned-budget-list article").filter({ hasText: "桌面測試門票" });
  await expect(card).toContainText("$1,200");
  await expect(form).toHaveCount(0);
  await page.getByRole("button", { name: "編輯預算：桌面測試門票", exact: true }).click();
  await form.getByLabel("備註", { exact: true }).fill("保留分攤及連動欄位");
  await form.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(card).toContainText("保留分攤及連動欄位");
  await card.getByRole("button", { name: "轉實付", exact: true }).click();
  await expect(card.getByRole("button", { name: "轉實付", exact: true })).toBeDisabled();
  const expense = page.locator(".actual-panel article").filter({ hasText: "桌面測試門票" });
  await expect(expense).toContainText("$1,200");
  await expect(page.getByLabel("旅程費用摘要")).toContainText("$3,312");
  await expense.getByRole("button", { name: "刪除實付：桌面測試門票", exact: true }).click();
  await expect(expense).toHaveCount(0);
  await expect(card.getByRole("button", { name: "轉實付", exact: true })).toBeEnabled();
  await card.getByRole("button", { name: "刪除預算：桌面測試門票", exact: true }).click();
  await expect(card).toHaveCount(0);
});

test("direct actual expense updates the overview and identifies overspend", async ({ page }) => {
  await page.getByRole("button", { name: "新增實付", exact: true }).click();
  const form = page.locator(".actual-panel .budget-form");
  await form.getByLabel("標題", { exact: true }).fill("額外購物");
  await form.getByLabel("金額", { exact: true }).fill("5000");
  await form.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(page.locator(".actual-panel article").filter({ hasText: "額外購物" })).toContainText("$5,000");
  await expect(page.locator(".is-over-budget")).toContainText("實付超出預算");
  await expect(page.locator(".is-over-budget")).toContainText("$3,416");
});

for (const width of [1280, 1440]) {
  test(`desktop ${width}px keeps readable cards without overflow or runtime errors`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    await expect(page.locator(".budget-page-summary")).toBeVisible();
    await expect(page).toHaveTitle("旅程工房｜Travel Studio");
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const cards = page.locator(".planned-budget-list article");
    const first = await cards.nth(0).boundingBox();
    const second = await cards.nth(1).boundingBox();
    expect(Math.abs(first.y - second.y)).toBeLessThan(1);
    expect(first.width).toBeGreaterThan(350);
    expect(errors).toEqual([]);
  });
}
