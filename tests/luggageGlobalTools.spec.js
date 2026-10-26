import { expect, test } from "@playwright/test";

test("empty search collapses outside, typed search stays open and searches both columns", async ({ page }) => {
  await page.goto("/demo/luggage");
  const toggle = page.getByRole("button", { name: "搜尋所有行李", exact: true });
  const search = page.getByRole("searchbox", { name: "搜尋所有行李", exact: true });
  await toggle.click();
  await expect(search).toHaveAttribute("placeholder", "搜尋所有行李名稱或備註");
  await page.locator("#lb-shared h3").click();
  await expect(search).toHaveCount(0);
  await toggle.click();
  await search.fill("野餐墊");
  await page.locator("#lb-shared h3").click();
  await expect(search).toBeVisible();
  await expect(page.locator("#lb-personal .luggage-row")).toHaveCount(0);
  await expect(page.locator("#lb-shared .shared-luggage-row")).toHaveCount(1);
  await expect(page.locator("#lb-shared").getByRole("button", { name: "編輯：野餐墊", exact: true })).toBeVisible();
  await search.fill("核對入住日期");
  await expect(page.locator("#lb-shared .shared-luggage-row")).toHaveCount(1);
  await search.fill("公用雨傘");
  await expect(page.locator("#lb-personal .shared-assigned")).toHaveCount(1);
  await expect(page.locator("#lb-shared .shared-luggage-row")).toHaveCount(1);
  await search.fill("");
  await page.locator("#lb-shared h3").click();
  await expect(search).toHaveCount(0);
  await expect(page.locator("#lb-shared .shared-luggage-row")).toHaveCount(16);
});

test("shared readiness has an independent filter and a centered white active icon", async ({ page }) => {
  await page.goto("/tests/harness/luggage.html");
  const filter = page.getByRole("combobox", { name: "篩選共用物品", exact: true });
  await filter.click();
  await page.getByRole("option", { name: "已備妥", exact: true }).click();
  await expect(page.locator("#lb-shared .shared-luggage-row")).toHaveCount(1);
  await expect(page.locator("#lb-personal .luggage-row")).toHaveCount(2);
  const style = await filter.evaluate(node => {
    const svg = node.querySelector("svg"), a = node.getBoundingClientRect(), b = svg.getBoundingClientRect();
    return { color: getComputedStyle(svg).color, x: b.x + b.width / 2 - a.x - a.width / 2, y: b.y + b.height / 2 - a.y - a.height / 2 };
  });
  expect(style).toEqual({ color: "rgb(255, 255, 255)", x: 0, y: 0 });
  const progress = page.locator("#lb-shared").getByRole("progressbar");
  await expect(progress).toHaveAttribute("aria-valuemax", "4");
  await expect(progress).toHaveAttribute("aria-valuenow", "1");
  await filter.click();
  await page.getByRole("option", { name: "全部", exact: true }).click();
  await expect(page.locator("#lb-shared .shared-luggage-row")).toHaveCount(4);
});

for (const width of [1440, 390]) {
  test(`${width}px help follows shared filter, opens concise guide and closes by Escape/outside`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/demo/luggage");
    if (width === 390) await page.getByRole("tab", { name: "共用物品", exact: true }).click();
    const help = page.getByRole("button", { name: "行李頁說明", exact: true });
    const filter = page.getByRole("combobox", { name: "篩選共用物品", exact: true });
    expect((await help.boundingBox()).x).toBeGreaterThan((await filter.boundingBox()).x);
    await help.click();
    const dialog = page.getByRole("dialog", { name: "行李頁說明", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("個人行李僅自己可見");
    await expect(dialog).toContainText("搜尋涵蓋兩欄");
    await expect(dialog.getByRole("button", { name: "關閉行李頁說明", exact: true })).toBeFocused();
    const box = await dialog.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(help).toBeFocused();
    await help.click();
    await page.locator("#lb-shared h3").click();
    await expect(dialog).toHaveCount(0);
  });
}
