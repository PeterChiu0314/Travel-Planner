import { expect, test } from "@playwright/test";

test("compact headers, no label/filter rows, and category popup opens to the lower right", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/demo/luggage");
  await expect(page.locator(".lb-list-labels, .lb-status-tabs")).toHaveCount(0);
  for (const id of ["lb-personal", "lb-shared"]) {
    const header = page.locator(`#${id} .lb-column-heading`);
    const title = await header.locator("h3").boundingBox();
    const progress = await header.getByRole("progressbar").boundingBox();
    expect(progress.x - title.x - title.width).toBeGreaterThanOrEqual(0);
    expect(progress.x - title.x - title.width).toBeLessThanOrEqual(16);
  }
  const handle = page.getByRole("button", { name: "移動分類：護照", exact: true });
  const box = await handle.boundingBox();
  await handle.click();
  const popup = page.getByRole("dialog", { name: "移動分類：護照", exact: true });
  await expect(popup).toBeVisible();
  const rect = await popup.boundingBox();
  expect(rect.width).toBe(200);
  expect(rect.x).toBeGreaterThanOrEqual(box.x + box.width);
  expect(rect.y).toBeGreaterThanOrEqual(box.y + box.height);
  await popup.getByRole("combobox").click();
  await expect(page.getByRole("option", { name: "衣物", exact: true })).toBeVisible();
  await page.getByRole("option", { name: "衣物", exact: true }).click();
  await expect(popup).toHaveCount(0);
});
