import { expect, test } from "@playwright/test";
import { dragLuggage, keyboardAssign, luggageState as state } from "./helpers/luggageDrag.js";
const fixture = "/tests/harness/luggage.html";

test("single private entry, no team creation or assignment selectors, every member is an empty receiving slot", async ({ page }) => {
  await page.goto(`${fixture}?empty=1`);
  await expect(page.getByRole("form", { name: "快速新增個人行李", exact: true })).toBeVisible();
  await expect(page.getByRole("form", { name: "快速新增共用物品", exact: true })).toHaveCount(0);
  await expect(page.locator(".lb-member-group")).toHaveCount(3);
  await expect(page.locator('[data-member-id="viewer"]')).toContainText("尚無共用物品");
  await expect(page.locator('[data-member-id="pending"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: /共用物品操作/ })).toHaveCount(0);
});

test("private promotion transfers title/category/notes atomically, resets packing and exposes one shared row", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(fixture);
  await page.getByRole("button", { name: "編輯備註：護照", exact: true }).click();
  const notes = page.getByRole("textbox", { name: "編輯個人行李備註", exact: true }); await notes.fill("轉共享前可檢視的備註"); await notes.press("Enter");
  await page.getByRole("checkbox", { name: "準備：護照", exact: true }).check();
  await dragLuggage(page, "護照", "viewer", "personal");
  await expect.poll(async () => (await state(page)).luggageItems.some(item => item.id === "own")).toBe(false);
  expect((await state(page)).sharedLuggageItems.find(item => item.id === "own")).toMatchObject({ title: "護照", category: "隨身必備", notes: "轉共享前可檢視的備註", assigned_to: "viewer", packed_by_assignee: false });
  await expect(page.locator('[data-member-id="viewer"]').getByRole("button", { name: "編輯：護照", exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "共用物品指派結果" })).toContainText("已轉為共用物品");
});

test("own-slot conversion creates the canonical own projection and remains editable without assignment controls", async ({ page }) => {
  await page.goto(fixture); await dragLuggage(page, "護照", "owner", "personal");
  await expect(page.getByRole("button", { name: "編輯指派共用物品：護照", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "編輯指派共用物品：護照", exact: true }).click();
  await expect(page.locator(".lb-inline-editor").getByRole("combobox")).toHaveCount(0);
  const notes = page.getByLabel("編輯共用物品備註", { exact: true }); await notes.fill("同一筆共用物品備註"); await notes.press("Enter");
  await expect(page.locator("#lb-shared").getByRole("button", { name: "編輯備註：護照", exact: true })).toHaveText("同一筆共用物品備註");
});

test("shared drag updates assignee only, same-slot and cancellation leave records unchanged", async ({ page }) => {
  await page.goto(fixture); const before = await state(page);
  await dragLuggage(page, "團隊相機", "packer"); expect(await state(page)).toEqual(before);
  await dragLuggage(page, "團隊相機", "viewer", "shared", { cancel: true }); expect(await state(page)).toEqual(before);
  await dragLuggage(page, "團隊相機", "viewer");
  await expect.poll(async () => (await state(page)).sharedLuggageItems.find(item => item.id === "ready").assigned_to).toBe("viewer");
  expect((await state(page)).sharedLuggageItems.find(item => item.id === "ready")).toMatchObject({ category: "團隊裝備", packed_by_assignee: false, confirmed_by_owner: false });
  await dragLuggage(page, "團隊相機", "");
  await expect.poll(async () => (await state(page)).sharedLuggageItems.find(item => item.id === "ready").assigned_to).toBe(null);
});

test("failed conversion leaves the entire private source intact, retry converts once", async ({ page }) => {
  await page.goto(`${fixture}?latency=100`); const before = await state(page);
  await page.getByRole("button", { name: "下一次操作失敗", exact: true }).click();
  await dragLuggage(page, "護照", "", "personal");
  await expect(page.getByRole("alert").first()).toBeVisible(); expect(await state(page)).toEqual(before);
  await dragLuggage(page, "護照", "", "personal");
  await expect.poll(async () => (await state(page)).luggageItems.some(item => item.id === "own")).toBe(false);
  expect((await state(page)).sharedLuggageItems.filter(item => item.id === "own")).toHaveLength(1);
});

for (const width of [1440, 390]) {
  test(`${width}px keyboard can convert a private item and reassign public gear, including empty destinations`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await page.goto(fixture);
    await keyboardAssign(page, "護照", "viewer", "personal");
    await expect.poll(async () => (await state(page)).sharedLuggageItems.find(item => item.id === "own")?.assigned_to).toBe("viewer");
    await keyboardAssign(page, "團隊文件", "packer");
    await expect.poll(async () => (await state(page)).sharedLuggageItems.find(item => item.id === "owner-assigned").assigned_to).toBe("packer");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("viewer can drag to assign but cannot pack someone else's gear", async ({ page }) => {
  await page.goto(`${fixture}?actor=viewer`); await dragLuggage(page, "團隊相機", "owner");
  await expect.poll(async () => (await state(page)).sharedLuggageItems.find(item => item.id === "ready").assigned_to).toBe("owner");
  await expect(page.getByRole("checkbox", { name: "成員已備妥：團隊相機", exact: true })).toBeDisabled();
});

test("phone touch drag stays for ordering, hovers team tab to convert and cancels without writes", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, hasTouch: true, isMobile: true });
  const page = await context.newPage(); await page.goto(fixture);
  const cdp = await context.newCDPSession(page);
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" || type === "touchCancel" ? [] : [{ x, y, id: 1 }] });
  const before = await state(page);
  const handle = page.getByRole("button", { name: "移動分類：護照", exact: true });
  const start = await handle.boundingBox();
  await touch("touchStart", start.x + start.width / 2, start.y + start.height / 2);
  await touch("touchMove", start.x + start.width / 2 + 14, start.y + start.height / 2 + 12);
  await expect(page.getByRole("tab", { name: "個人行李", exact: true })).toHaveAttribute("aria-selected", "true");
  const tab = await page.getByRole("tab", { name: "共用物品", exact: true }).boundingBox();
  await touch("touchMove", tab.x + tab.width / 2, tab.y + tab.height / 2);
  await expect(page.getByRole("tab", { name: "共用物品", exact: true })).toHaveAttribute("aria-selected", "true");
  await touch("touchCancel");
  await expect(page.getByRole("tab", { name: "個人行李", exact: true })).toHaveAttribute("aria-selected", "true");
  expect(await state(page)).toEqual(before);
  const retry = await handle.boundingBox();
  await touch("touchStart", retry.x + retry.width / 2, retry.y + retry.height / 2);
  await touch("touchMove", retry.x + retry.width / 2 + 14, retry.y + retry.height / 2 + 12);
  await touch("touchMove", tab.x + tab.width / 2, tab.y + tab.height / 2);
  const target = page.locator('[data-member-id="viewer"]'); await expect(target).toBeVisible();
  const end = await target.boundingBox(); await touch("touchMove", end.x + end.width / 2, end.y + 25);
  await expect(target).toHaveClass(/is-drop-target/); await touch("touchEnd");
  await page.getByRole("dialog", { name: "轉為共用物品？", exact: true }).getByRole("button", { name: "確認", exact: true }).tap();
  await expect.poll(async () => (await state(page)).sharedLuggageItems.find(item => item.id === "own")?.assigned_to).toBe("viewer");
  await context.close();
});

test("cross-member snapshots receive promotion and reassignment without private copies", async ({ page, context }) => {
  const room = `drag-${Date.now()}`; await page.goto(`${fixture}?room=${room}`);
  const remote = await context.newPage(); await remote.goto(`${fixture}?room=${room}&actor=viewer`);
  await page.bringToFront(); await dragLuggage(page, "護照", "viewer", "personal");
  await expect(remote.getByRole("button", { name: "編輯指派共用物品：護照", exact: true })).toBeVisible();
  await expect(remote.getByRole("button", { name: "編輯：護照", exact: true })).toBeVisible();
  await remote.bringToFront(); await remote.getByRole("checkbox", { name: "準備指派共用物品：護照", exact: true }).check();
  await expect(page.getByRole("checkbox", { name: "成員已備妥：護照", exact: true })).toBeChecked();
});
