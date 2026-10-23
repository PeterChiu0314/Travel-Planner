import { expect, test } from "@playwright/test";
const fixture = "/tests/harness/luggage.html";
const state = async page => JSON.parse(await page.getByTestId("luggage-canonical-state").textContent());
async function choose(page, label, name) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("listbox").getByRole("option", { name, exact: true }).click();
}
for (const actor of ["owner", "packer", "viewer"]) {
  test(`${actor} can create and reassign team gear to every approved member`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${fixture}?actor=${actor}`);
    const add = page.locator(".lb-add-shared");
    await expect(add.getByRole("combobox")).toHaveCount(1);
    await add.getByLabel("團隊公物名稱", { exact: true }).fill("共用備品");
    await choose(page, "指派公物負責人", "旅伴 Chloe" + (actor === "packer" ? "（我）" : ""));
    await add.getByLabel("團隊公物名稱", { exact: true }).press("Enter");
    await expect.poll(async () => (await state(page)).sharedLuggageItems.find(item => item.title === "共用備品")?.assigned_to).toBe("packer");
    await page.getByRole("button", { name: "編輯：團隊相機", exact: true }).click();
    await expect(page.locator(".lb-inline-shared").getByRole("combobox")).toHaveCount(1);
    await page.getByRole("combobox", { name: "編輯公物負責人", exact: true }).click();
    await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(4);
    await expect(page.getByRole("listbox").getByRole("option", { name: /尚待核准/ })).toHaveCount(0);
    await page.getByRole("listbox").getByRole("option", { name: "旅伴 Dennis" + (actor === "viewer" ? "（我）" : ""), exact: true }).click();
    await page.getByLabel("編輯團隊公物名稱", { exact: true }).press("Enter");
    expect((await state(page)).sharedLuggageItems.find(item => item.id === "ready")).toMatchObject({ assigned_to: "viewer", packed_by_assignee: false, category: "團隊裝備" });
    const row = page.locator(".shared-luggage-row").filter({ has: page.getByRole("button", { name: "編輯：團隊相機", exact: true }) });
    if (actor === "viewer") await expect(row).toHaveClass(/is-mine/);
    else await expect(row).not.toHaveClass(/is-mine/);
  });
}
for (const width of [1440, 390]) {
  test(`${width}px team checks precede names and own items have a subtle background`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(fixture);
    if (width === 390) await page.getByRole("tab", { name: "團隊公物", exact: true }).click();
    await expect(page.locator(".lb-team-head")).toHaveCount(0);
    const row = page.locator(".shared-luggage-row").filter({ has: page.getByRole("button", { name: "編輯：團隊文件", exact: true }) });
    const checkbox = await row.getByRole("checkbox").boundingBox(), name = await row.getByRole("button", { name: "編輯：團隊文件", exact: true }).boundingBox();
    expect(checkbox.x + checkbox.width).toBeLessThanOrEqual(name.x);
    await expect(row).toHaveClass(/is-mine/);
    const ownColor = await row.evaluate(node => getComputedStyle(node).backgroundColor);
    expect(ownColor).not.toBe(await page.locator(".shared-luggage-row:not(.is-mine)").first().evaluate(node => getComputedStyle(node).backgroundColor));
    await row.getByRole("button", { name: "編輯：團隊文件", exact: true }).click();
    await expect(page.locator(".shared-luggage-row.is-editing").getByRole("checkbox")).toBeDisabled();
    await expect(page.getByLabel("編輯團隊公物名稱", { exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
