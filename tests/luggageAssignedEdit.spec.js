import { expect, test } from "@playwright/test";

const fixture = "/tests/harness/luggage.html";
const state = async page => JSON.parse(await page.getByTestId("luggage-canonical-state").textContent());
const personal = page => page.locator("#lb-personal");
const team = page => page.locator("#lb-shared");
const name = page => page.getByRole("textbox", { name: "編輯共用物品名稱", exact: true });
const notes = page => page.getByRole("textbox", { name: "編輯共用物品備註", exact: true });

for (const width of [1440, 390]) {
  test(`${width}px own public gear edits in place, saves one canonical record and preserves packing for notes`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await page.goto(`${fixture}?latency=100`);
    await personal(page).getByRole("checkbox", { name: "打包指派共用物品：團隊文件", exact: true }).check();
    await personal(page).getByRole("button", { name: "編輯指派共用物品備註：團隊文件", exact: true }).click();
    await expect(notes(page)).toBeFocused();
    await expect(personal(page).locator(".lb-inline-editor")).toHaveCount(1);
    await expect(team(page).locator(".lb-inline-editor")).toHaveCount(0);
    await expect(personal(page).locator(".lb-inline-editor").getByRole("combobox")).toHaveCount(0);
    await notes(page).fill("統一放隨身包"); await notes(page).press("Enter");
    await expect(page.locator(".lb-inline-editor")).toHaveCount(0);
    expect((await state(page)).sharedLuggageItems.find(item => item.id === "owner-assigned")).toMatchObject({ notes: "統一放隨身包", packed_by_assignee: true });
    await expect(personal(page).getByRole("button", { name: "編輯指派共用物品備註：團隊文件", exact: true })).toHaveText("統一放隨身包");
    if (width === 390) await page.getByRole("tab", { name: "共用物品", exact: true }).click();
    await expect(team(page).getByRole("button", { name: "編輯備註：團隊文件", exact: true })).toHaveText("統一放隨身包");
    expect((await state(page)).luggageItems.some(item => item.title === "團隊文件")).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });


}

test("switching columns auto-saves once, with a single shared editor and the correct focus", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(`${fixture}?latency=100`);
  await personal(page).getByRole("button", { name: "編輯指派共用物品：團隊文件", exact: true }).click();
  await name(page).fill("新版團隊文件");
  await team(page).getByRole("button", { name: "編輯：團隊文件", exact: true }).click();
  await expect(name(page)).toHaveValue("新版團隊文件");
  await expect(team(page).locator(".lb-inline-editor")).toHaveCount(1);
  await expect(personal(page).locator(".lb-inline-editor")).toHaveCount(0);
  expect((await state(page)).sharedLuggageItems.find(item => item.id === "owner-assigned").updated_at).toBe("2026-10-23T01:00:01.000Z");
  await name(page).press("Escape");
  await expect(team(page).getByRole("button", { name: "編輯：新版團隊文件", exact: true })).toBeFocused();
});



test("personal public edit cancels without touching canonical content and deletes via the site dialog", async ({ page }) => {
  await page.goto(fixture);
  await personal(page).getByRole("button", { name: "編輯指派共用物品：團隊文件", exact: true }).click();
  await name(page).press("Escape");
  await expect(personal(page).getByRole("button", { name: "編輯指派共用物品：團隊文件", exact: true })).toBeFocused();
  await personal(page).getByRole("button", { name: "編輯指派共用物品：團隊文件", exact: true }).click();
  await page.getByRole("button", { name: "刪除：團隊文件", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "刪除物品？", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(name(page)).toBeVisible();
  await page.getByRole("button", { name: "刪除：團隊文件", exact: true }).click();
  await page.getByRole("button", { name: "刪除", exact: true }).click();
  await expect(personal(page).locator(".shared-assigned")).toHaveCount(0);
  expect((await state(page)).sharedLuggageItems.some(item => item.id === "owner-assigned")).toBe(false);
});
