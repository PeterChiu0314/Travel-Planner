import { expect, test } from "@playwright/test";
import { dragLuggage, returnLuggage, luggageState as state } from "./helpers/luggageDrag.js";
const fixture = "/tests/harness/luggage.html";

test("private sharing waits for the site dialog; cancellation keeps the private item unchanged", async ({ page }) => {
  await page.goto(fixture); const before = await state(page);
  const native = []; page.on("dialog", dialog => { native.push(dialog.type()); dialog.dismiss(); });
  await dragLuggage(page, "護照", "viewer", "personal", { confirm: false });
  const dialog = page.getByRole("dialog", { name: "轉為共用物品？", exact: true });
  await expect(dialog).toContainText("旅伴 Dennis"); await expect(dialog).toContainText("名稱與備註供全體");
  expect(await state(page)).toEqual(before);
  await dialog.getByRole("button", { name: "取消", exact: true }).click(); expect(await state(page)).toEqual(before);
  await dragLuggage(page, "護照", "viewer", "personal");
  await expect.poll(async () => (await state(page)).sharedLuggageItems.find(row => row.id === "own")?.assigned_to).toBe("viewer");
  expect(native).toEqual([]);
});

test("returning public gear confirms removal and privacy, preserves notes and resets packing", async ({ page }) => {
  await page.goto(fixture);
  await page.getByRole("button", { name: "編輯備註：團隊相機", exact: true }).click();
  await page.getByLabel("編輯共用物品備註", { exact: true }).fill("相機電池放側袋");
  await page.getByLabel("編輯共用物品備註", { exact: true }).press("Enter");
  const before = await state(page);
  await returnLuggage(page, "團隊相機", "衣物", { confirm: false });
  const dialog = page.getByRole("dialog", { name: "轉為個人物品？", exact: true });
  await expect(dialog).toContainText("從共用物品移除"); await expect(dialog).toContainText("僅自己可見");
  expect(await state(page)).toEqual(before);
  await dialog.press("Escape"); expect(await state(page)).toEqual(before);
  await returnLuggage(page, "團隊相機", "衣物");
  await expect.poll(async () => (await state(page)).sharedLuggageItems.some(row => row.id === "ready")).toBe(false);
  expect((await state(page)).luggageItems.find(row => row.id === "ready")).toMatchObject({ owner_id: "owner", category: "衣物", notes: "相機電池放側袋", packed: false, shared_item_id: null, is_shared_assigned_item: false });
  await expect(page.locator("#lb-personal").getByRole("button", { name: "編輯：團隊相機", exact: true })).toBeVisible();
  await expect(page.locator("#lb-shared").getByRole("button", { name: "編輯：團隊相機", exact: true })).toHaveCount(0);
});

test("failed return preserves the public row and assignee; retry creates exactly one private row", async ({ page }) => {
  await page.goto(`${fixture}?latency=100`); const before = await state(page);
  await page.getByRole("button", { name: "下一次操作失敗", exact: true }).click();
  await returnLuggage(page, "團隊文件", "證件");
  await expect(page.getByRole("alert").first()).toBeVisible(); expect(await state(page)).toEqual(before);
  await returnLuggage(page, "團隊文件", "證件");
  await expect.poll(async () => (await state(page)).luggageItems.filter(row => row.id === "owner-assigned").length).toBe(1);
  await expect(page.getByRole("button", { name: "編輯指派共用物品：團隊文件", exact: true })).toHaveCount(0);
});

for (const width of [1440, 390]) {
  test(`${width}px keyboard can return gear to an empty personal category`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await page.goto(fixture);
    if (width <= 1000) await page.getByRole("tab", { name: "共用物品", exact: true }).click();
    await returnLuggage(page, "共享充電器", "電子用品", { keyboard: true });
    await expect(page.locator("#lb-personal").getByRole("button", { name: "編輯：共享充電器", exact: true })).toBeVisible();
    expect((await state(page)).luggageItems.find(row => row.id === "shared")).toMatchObject({ category: "電子用品", owner_id: "owner", packed: false });
  });
}

test("phone pointer hovers the personal tab before returning to a category, cancellation restores team view", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 }); await page.goto(fixture);
  await page.getByRole("tab", { name: "共用物品", exact: true }).click(); const before = await state(page);
  await returnLuggage(page, "團隊文件", "證件", { confirm: false });
  await page.getByRole("dialog", { name: "轉為個人物品？", exact: true }).getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("tab", { name: "共用物品", exact: true })).toHaveAttribute("aria-selected", "true");
  expect(await state(page)).toEqual(before);
});

test("remote edits during the return dialog cannot be overwritten or converted using a stale version", async ({ page, context }) => {
  const room = `return-${Date.now()}`; await page.goto(`${fixture}?room=${room}`);
  const remote = await context.newPage(); await remote.goto(`${fixture}?room=${room}&actor=viewer`);
  await page.bringToFront(); await returnLuggage(page, "團隊相機", "電子用品", { confirm: false });
  await remote.bringToFront(); await remote.getByRole("button", { name: "編輯：團隊相機", exact: true }).click();
  await remote.getByLabel("編輯共用物品名稱", { exact: true }).fill("遠端更新的團隊相機");
  await remote.getByLabel("編輯共用物品名稱", { exact: true }).press("Enter");
  await expect.poll(async () => (await state(page)).sharedLuggageItems.find(row => row.id === "ready").title).toBe("遠端更新的團隊相機");
  await page.bringToFront(); await page.getByRole("dialog", { name: "轉為個人物品？", exact: true }).getByRole("button", { name: "確認", exact: true }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  expect((await state(page)).luggageItems.some(row => row.id === "ready")).toBe(false);
  expect((await state(page)).sharedLuggageItems.find(row => row.id === "ready").title).toBe("遠端更新的團隊相機");
});

test("conversion removes former-assignee projection and the new private item stays invisible to others", async ({ page, context }) => {
  const room = `private-${Date.now()}`; await page.goto(`${fixture}?room=${room}&actor=viewer`);
  const remote = await context.newPage(); await remote.goto(`${fixture}?room=${room}&actor=owner`);
  await page.bringToFront(); await returnLuggage(page, "團隊文件", "證件");
  await expect(page.getByRole("button", { name: "編輯：團隊文件", exact: true })).toBeVisible();
  await expect(remote.getByRole("button", { name: "編輯指派共用物品：團隊文件", exact: true })).toHaveCount(0);
  await expect(remote.getByRole("button", { name: "編輯：團隊文件", exact: true })).toHaveCount(0);
});

test("phone touch can hover the personal tab and confirm returning public gear", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, hasTouch: true, isMobile: true });
  const page = await context.newPage(); await page.goto(fixture);
  await page.getByRole("tab", { name: "共用物品", exact: true }).tap();
  const cdp = await context.newCDPSession(page);
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  const handle = await page.getByRole("button", { name: "拖曳指派共用物品：團隊文件", exact: true }).boundingBox();
  await touch("touchStart", handle.x + handle.width / 2, handle.y + handle.height / 2);
  await touch("touchMove", handle.x + handle.width / 2 + 14, handle.y + handle.height / 2 + 10);
  const tab = await page.getByRole("tab", { name: "個人行李", exact: true }).boundingBox();
  await touch("touchMove", tab.x + tab.width / 2, tab.y + tab.height / 2);
  await expect(page.getByRole("tab", { name: "個人行李", exact: true })).toHaveAttribute("aria-selected", "true");
  const category = page.locator('.lb-category-group[aria-label="衣物"]'); await category.scrollIntoViewIfNeeded();
  const target = await category.boundingBox(); await touch("touchMove", target.x + target.width / 2, target.y + 18);
  await expect(category).toHaveClass(/is-drop-target/); await touch("touchEnd");
  await page.getByRole("dialog", { name: "轉為個人物品？", exact: true }).getByRole("button", { name: "確認", exact: true }).tap();
  await expect(page.getByRole("button", { name: "編輯：團隊文件", exact: true })).toBeVisible();
  await context.close();
});
