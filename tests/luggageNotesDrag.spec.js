import { expect, test } from "@playwright/test";
const fixture = "/tests/harness/luggage.html";
const state = async page => JSON.parse(await page.getByTestId("luggage-canonical-state").textContent());
const privateRow = (page, title) => page.locator(".lb-private-row").filter({ has: page.getByRole("button", { name: `編輯：${title}`, exact: true }) });
for (const width of [1440, 390]) {
  test(`${width}px Quick Add notes remain optional and clear only after successful creation`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await page.goto(`${fixture}?empty=1`);
    const quick = page.getByRole("form", { name: "快速新增個人行李", exact: true });
    const before = await quick.boundingBox();
    await quick.getByLabel("個人行李備註", { exact: true }).fill("隨身包內袋");
    expect((await quick.boundingBox()).height).toBe(before.height);
    await quick.getByLabel("個人行李名稱", { exact: true }).fill("備用護照影本");
    await page.getByRole("button", { name: "下一次操作失敗", exact: true }).click();
    await quick.getByLabel("個人行李名稱", { exact: true }).press("Enter");
    await expect(quick.getByLabel("個人行李備註", { exact: true })).toHaveValue("隨身包內袋");
    await quick.getByLabel("個人行李名稱", { exact: true }).press("Enter");
    await expect.poll(async () => (await state(page)).luggageItems.find(item => item.title === "備用護照影本")?.notes).toBe("隨身包內袋");
    await expect(quick.getByLabel("個人行李備註", { exact: true })).toHaveValue("");
    await expect(quick.getByLabel("個人行李名稱", { exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("notes edit directly, autosave on leaving, survive failure and synchronize shared projections", async ({ page }) => {
  await page.goto(`${fixture}?latency=100`);
  await privateRow(page, "護照").getByRole("button", { name: "編輯備註：護照", exact: true }).click();
  const notes = page.getByLabel("編輯個人行李備註", { exact: true });
  await expect(notes).toBeFocused();
  await expect(page.getByRole("combobox", { name: "編輯個人行李分類", exact: true })).toHaveCount(0);
  await notes.fill("確認效期");
  await page.getByRole("button", { name: "編輯：團隊文件", exact: true }).click();
  await expect.poll(async () => (await state(page)).luggageItems.find(item => item.id === "own").notes).toBe("確認效期");
  const teamNotes = page.getByLabel("編輯共用物品備註", { exact: true });
  await teamNotes.fill("門票與預約單"); await teamNotes.press("Enter");
  await expect(page.locator(".shared-assigned").filter({ hasText: "團隊文件" })).toContainText("門票與預約單");
});

test("dragging changes only the private category; dropping outside a category does nothing", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(`${fixture}?long=1`);
  const handle = page.getByRole("button", { name: "移動分類：護照", exact: true });
  const target = page.locator("#lb-personal").getByRole("region", { name: "電子用品", exact: true }).locator(".lb-group-toggle");
  await target.click(); // collapsed categories must accept a drop.
  const from = await handle.boundingBox(), to = await target.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 12, { steps: 4 });
  await page.mouse.move(to.x + 80, to.y + to.height / 2, { steps: 12 });
  await expect(target.locator("..").locator("..")).toHaveClass(/is-drop-target/);
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).luggageItems.find(item => item.id === "own").category).toBe("電子用品");
  await expect(target).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#lb-personal").getByRole("region", { name: "電子用品", exact: true }).getByRole("button", { name: "編輯：護照", exact: true })).toBeVisible();
  const after = await handle.boundingBox(); await page.mouse.move(after.x + 10, after.y + 10); await page.mouse.down(); await page.mouse.move(1400, 80, { steps: 15 }); await page.mouse.up();
  expect((await state(page)).luggageItems.find(item => item.id === "own").category).toBe("電子用品");
});

test("phone and keyboard users can move via the handle menu, preserving notes and packing", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 }); await page.goto(fixture);
  await page.getByRole("checkbox", { name: "準備：護照", exact: true }).check();
  const handle = page.getByRole("button", { name: "移動分類：護照", exact: true });
  await handle.focus(); await handle.press("Enter");
  await page.getByRole("combobox", { name: "移動護照至分類", exact: true }).click();
  await page.getByRole("option", { name: "電子用品", exact: true }).click();
  await expect.poll(async () => (await state(page)).luggageItems.find(item => item.id === "own").category).toBe("電子用品");
  expect((await state(page)).luggageItems.find(item => item.id === "own").packed).toBe(true);
  await expect(page.locator(".lb-inline-editor")).toHaveCount(0);
});

test("note-only failure retains draft and a retry does not change shared packing", async ({ page }) => {
  await page.goto(`${fixture}?actor=packer&latency=100`);
  await page.getByRole("button", { name: "編輯備註：團隊相機", exact: true }).click();
  const notes = page.getByLabel("編輯共用物品備註", { exact: true });
  await notes.fill("鏡頭另外包好");
  await page.getByRole("button", { name: "下一次操作失敗", exact: true }).click();
  await notes.press("Enter");
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(notes).toHaveValue("鏡頭另外包好");
  expect((await state(page)).sharedLuggageItems.find(item => item.id === "ready").packed_by_assignee).toBe(true);
  await notes.press("Enter");
  await expect(page.locator(".lb-inline-editor")).toHaveCount(0);
  expect((await state(page)).sharedLuggageItems.find(item => item.id === "ready")).toMatchObject({ notes: "鏡頭另外包好", packed_by_assignee: true });
});

test("moving a private item preserves notes and leaves state untouched on failure", async ({ page }) => {
  await page.goto(fixture);
  await privateRow(page, "護照").getByRole("button", { name: "編輯備註：護照", exact: true }).click();
  const notes = page.getByLabel("編輯個人行李備註", { exact: true });
  await notes.fill("保留這段備註"); await notes.press("Enter");
  await page.getByRole("button", { name: "下一次操作失敗", exact: true }).click();
  await page.getByRole("button", { name: "移動分類：護照", exact: true }).click();
  const move = page.getByRole("combobox", { name: "移動護照至分類", exact: true });
  await move.click(); await page.getByRole("option", { name: "電子用品", exact: true }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  expect((await state(page)).luggageItems.find(item => item.id === "own")).toMatchObject({ category: "隨身必備", notes: "保留這段備註" });
  await move.click(); await page.getByRole("option", { name: "電子用品", exact: true }).click();
  await expect.poll(async () => (await state(page)).luggageItems.find(item => item.id === "own").category).toBe("電子用品");
  expect((await state(page)).luggageItems.find(item => item.id === "own").notes).toBe("保留這段備註");
});
