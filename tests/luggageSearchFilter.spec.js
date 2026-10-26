import { expect, test } from "@playwright/test";

async function choose(page, name) {
  await page.getByRole("combobox", { name: "篩選個人行李", exact: true }).click();
  await page.getByRole("option", { name, exact: true }).click();
}
for (const width of [1440, 390]) {
  test(`${width}px title/notes search and readiness filter compose without changing shared rows or progress`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/demo/luggage");
    const personal = page.locator("#lb-personal");
    const progress = personal.getByRole("progressbar");
    const total = await progress.getAttribute("aria-valuemax");
    const title = await personal.locator("h3").boundingBox();
    const button = page.getByRole("button", { name: "搜尋所有行李", exact: true });
    const filter = page.getByRole("combobox", { name: "篩選個人行李", exact: true });
    const filterBefore = await filter.boundingBox();
    await button.click();
    const search = page.getByRole("searchbox", { name: "搜尋所有行李", exact: true });
    await expect(search).toBeFocused();
    const rect = await search.boundingBox();
    expect(rect.x).toBeLessThan((await page.getByRole("button", { name: "關閉行李搜尋", exact: true }).boundingBox()).x);
    expect(rect.y).toBeGreaterThanOrEqual(title.y);
    if (width === 1440) expect((await filter.boundingBox()).x).toBeCloseTo(filterBefore.x, 0);
    await search.fill("USB-C");
    await expect(personal.getByRole("button", { name: "編輯：充電器", exact: true })).toBeVisible();
    await expect(personal.getByRole("button", { name: "編輯：護照", exact: true })).toHaveCount(0);
    await expect(progress).toHaveAttribute("aria-valuemax", total);
    await choose(page, "已備妥");
    await expect(personal.getByText("沒有符合的物品", { exact: true })).toBeVisible();
    await expect(personal.locator(".is-filtered")).toHaveCount(1);
    await choose(page, "未準備");
    await expect(personal.getByRole("button", { name: "編輯：充電器", exact: true })).toBeVisible();
    await search.press("Escape");
    await expect(search).toHaveCount(0);
    await expect(button).toBeFocused();
    await choose(page, "全部");
    await expect(personal.getByRole("button", { name: "編輯：護照", exact: true })).toBeVisible();
    await expect(personal.locator(".is-filtered")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("search temporarily opens collapsed matches, close clears the query and restores collapse", async ({ page }) => {
  await page.goto("/demo/luggage");
  const category = page.getByRole("button", { name: /^證件\s/ });
  await category.click();
  const passport = page.getByRole("button", { name: "編輯：護照", exact: true });
  await expect(passport).toBeHidden();
  await page.getByRole("button", { name: "搜尋所有行李", exact: true }).click();
  await page.getByRole("searchbox").fill("護照");
  await expect(passport).toBeVisible();
  await page.getByRole("button", { name: "關閉行李搜尋", exact: true }).click();
  await expect(passport).toBeHidden();
  await category.click();
  await expect(passport).toBeVisible();
});

test("readiness filter includes assigned shared items and leaves the team list unchanged", async ({ page }) => {
  await page.goto("/tests/harness/luggage.html");
  const personal = page.locator("#lb-personal");
  await page.getByRole("checkbox", { name: "準備指派共用物品：團隊文件", exact: true }).check();
  await choose(page, "已備妥");
  await expect(personal.getByRole("button", { name: "編輯指派共用物品：團隊文件", exact: true })).toBeVisible();
  await expect(personal.getByRole("button", { name: "編輯：護照", exact: true })).toHaveCount(0);
  await expect(page.locator("#lb-shared .shared-luggage-row")).toHaveCount(4);
  await page.getByRole("combobox", { name: "篩選個人行李", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(personal.getByRole("button", { name: "編輯：護照", exact: true })).toBeVisible();
});
