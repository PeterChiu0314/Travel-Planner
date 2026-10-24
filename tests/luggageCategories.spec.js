import { expect, test } from "@playwright/test";
const fixture = "/tests/harness/luggage.html";
const group = (page, name) => page.locator("#lb-personal").getByRole("region", { name, exact: true });
const toggle = (page, name) => group(page, name).locator(".lb-group-toggle");
const canonical = async page => JSON.parse(await page.getByTestId("luggage-canonical-state").textContent());

test("collapsing an edited category saves first and failed saves keep it open", async ({ page }) => {
  await page.goto(`${fixture}?latency=100`);
  await page.getByRole("button", { name: "編輯：護照", exact: true }).click();
  await page.getByLabel("編輯個人行李名稱", { exact: true }).fill("護照與影本");
  await toggle(page, "隨身必備").click();
  await expect(toggle(page, "隨身必備")).toHaveAttribute("aria-expanded", "false");
  expect((await canonical(page)).luggageItems.find(item => item.id === "own").title).toBe("護照與影本");
  await toggle(page, "隨身必備").click();
  await page.getByRole("button", { name: "編輯：護照與影本", exact: true }).click();
  await page.getByLabel("編輯個人行李名稱", { exact: true }).fill("失敗草稿");
  await page.getByRole("button", { name: "下一次操作失敗", exact: true }).click();
  await toggle(page, "隨身必備").click();
  await expect(page.getByLabel("編輯個人行李名稱", { exact: true })).toHaveValue("失敗草稿");
  await expect(toggle(page, "隨身必備")).toHaveAttribute("aria-expanded", "true");
});

for (const width of [1440, 390]) {
  test(`${width}px categories support keyboard, shared sync, search and adding into a collapsed group`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(fixture);
    await expect(page.locator(".lb-category-filters,.lb-item-category")).toHaveCount(0);
    const publicGroup = group(page, "我負責的共用物品");
    const publicCheck = publicGroup.getByRole("checkbox", { name: "打包指派共用物品：團隊文件", exact: true });
    await publicCheck.check();
    await expect(toggle(page, "我負責的共用物品")).toContainText("1/1");
    expect((await canonical(page)).sharedLuggageItems.find(item => item.id === "owner-assigned").packed_by_assignee).toBe(true);
    await toggle(page, "隨身必備").focus(); await page.keyboard.press("Enter");
    await expect(group(page, "隨身必備").getByRole("button", { name: "編輯：護照", exact: true })).toBeHidden();
    await page.getByRole("button", { name: "展開行李搜尋", exact: true }).click();
    await page.locator("#lb-personal").getByLabel("搜尋行李", { exact: true }).fill("護照");
    await expect(group(page, "隨身必備").getByRole("button", { name: "編輯：護照", exact: true })).toBeVisible();
    await page.locator("#lb-personal").getByLabel("搜尋行李", { exact: true }).press("Escape");
    await expect(toggle(page, "隨身必備")).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("combobox", { name: "個人行李分類", exact: true }).fill("隨身必備");
    const name = page.getByLabel("個人行李名稱", { exact: true });
    await name.fill("備用證件"); await name.press("Enter");
    await expect(toggle(page, "隨身必備")).toHaveAttribute("aria-expanded", "true");
    await expect(group(page, "隨身必備").getByRole("button", { name: "編輯：備用證件", exact: true })).toBeVisible();
    await expect(name).toBeFocused();
    await expect(toggle(page, "隨身必備")).toContainText("0/2");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
