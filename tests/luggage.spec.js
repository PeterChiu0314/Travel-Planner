import { expect, test } from "@playwright/test";
import { dragLuggage } from "./helpers/luggageDrag.js";

// Browser plugin not available. The project Playwright runner tests the real
// LuggagePanel controller with an isolated, in-memory persistence adapter.
test.use({ viewport: { width: 1440, height: 900 } });
const fixture = "/tests/harness/luggage.html";
const personal = (page) => page.locator(".luggage-column").first();
const team = (page) => page.locator(".luggage-column").last();
const sharedRow = (page, title) => team(page).locator(".shared-luggage-row").filter({ has: page.getByText(title, { exact: true }) });
const choose = async (page, label, value) => {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("listbox", { name: `${label}選項`, exact: true }).getByRole("option", { name: value, exact: true }).click();
};
const state = async (page) => JSON.parse(await page.getByTestId("luggage-canonical-state").textContent());
const actor = async (page, value) => page.getByLabel("測試使用者", { exact: true }).selectOption(value);
const acceptDeletion = page => page.getByRole("dialog", { name: "刪除物品？", exact: true }).getByRole("button", { name: "刪除", exact: true }).click();
async function load(page, query = "") {
  await page.goto(`${fixture}${query}`);
  await expect(page.getByRole("region", { name: "行李清單", exact: true })).toBeVisible();
}

test("personal rows are private, trip scoped and omit historical assigned copies", async ({ page }) => {
  await load(page);
  await expect(personal(page).getByText("護照", { exact: true })).toBeVisible();
  for (const title of ["Chloe 私人藥物", "Dennis 私人證件", "另一旅程私人行李", "過期共用物品複本", "另一旅程共用物品"]) await expect(page.getByText(title, { exact: true })).toHaveCount(0);
  await actor(page, "packer");
  await expect(personal(page).getByText("Chloe 私人藥物", { exact: true })).toBeVisible();
  await expect(page.getByText("護照", { exact: true })).toHaveCount(0);
  await expect(personal(page).getByText("共享充電器", { exact: true })).toBeVisible();
  await expect(team(page).getByText("共享充電器", { exact: true })).toBeVisible();
});

test("personal quick add, edit, keyboard packing and delete work without a global edit mode", async ({ page }) => {
  await load(page);
  await personal(page).getByLabel("個人行李名稱", { exact: true }).fill("旅行轉接頭");
  await personal(page).getByRole("button", { name: "新增個人行李", exact: true }).click();
  const checkbox = personal(page).getByRole("checkbox", { name: "準備：旅行轉接頭", exact: true });
  await checkbox.focus(); await page.keyboard.press("Space"); await expect(checkbox).toBeChecked();
  await personal(page).getByRole("button", { name: "編輯：旅行轉接頭", exact: true }).click();
  await personal(page).getByLabel("編輯個人行李名稱", { exact: true }).fill("兩孔轉接頭");
  await personal(page).getByLabel("編輯個人行李名稱", { exact: true }).press("Enter");
  await expect(personal(page).getByRole("checkbox", { name: "準備：兩孔轉接頭", exact: true })).toBeChecked();
  await personal(page).getByRole("button", { name: "編輯：兩孔轉接頭", exact: true }).click();
  await personal(page).getByRole("button", { name: "刪除：兩孔轉接頭", exact: true }).click();
  await acceptDeletion(page);
  await expect(personal(page).getByText("兩孔轉接頭", { exact: true })).toHaveCount(0);
});

test("only assigned members pack; packing immediately completes the item without owner confirmation", async ({ page }) => {
  await load(page);
  const row = sharedRow(page, "共享充電器");
  await expect(row.getByRole("checkbox", { name: /^成員已備妥：/ })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /^總召確認：/ })).toHaveCount(0);
  await actor(page, "packer");
  await row.getByRole("checkbox", { name: /^成員已備妥：/ }).check();
  await expect(personal(page).getByRole("checkbox", { name: "準備指派共用物品：共享充電器", exact: true })).toBeChecked();
  await expect(row).toHaveClass(/packed/);
  expect((await state(page)).sharedLuggageItems.find(item => item.id === "shared").confirmed_by_owner).toBe(false);
  await expect(row).toBeVisible();
  await personal(page).getByRole("checkbox", { name: "準備指派共用物品：共享充電器", exact: true }).uncheck();
  await expect(row.getByRole("checkbox", { name: /^成員已備妥：/ })).not.toBeChecked();
  const canonical = (await state(page)).sharedLuggageItems.find((item) => item.id === "shared");
  expect(canonical.packed_by_assignee).toBe(false); expect(canonical.confirmed_by_owner).toBe(false);
});

test("approved viewer can manage shared gear, while unassigned items cannot be marked packed", async ({ page }) => {
  await load(page, "?actor=viewer");
  await expect(personal(page).getByText("Dennis 私人證件", { exact: true })).toBeVisible();
  await personal(page).getByLabel("個人行李名稱", { exact: true }).fill("同行雨傘");
  await personal(page).getByRole("button", { name: "新增個人行李", exact: true }).click();
  await dragLuggage(page, "同行雨傘", "viewer", "personal");
  await sharedRow(page, "同行雨傘").getByRole("checkbox", { name: /^成員已備妥：/ }).check();
  await expect(personal(page).getByRole("checkbox", { name: "準備指派共用物品：同行雨傘", exact: true })).toBeChecked();
  await expect(sharedRow(page, "露營急救包").getByRole("checkbox", { name: /^成員已備妥：/ })).toBeDisabled();
  await expect(sharedRow(page, "同行雨傘").getByRole("checkbox")).toHaveCount(1);
  await sharedRow(page, "同行雨傘").getByRole("button", { name: "編輯：同行雨傘", exact: true }).click();
  await team(page).getByRole("button", { name: "刪除：同行雨傘", exact: true }).click();
  await acceptDeletion(page);
  await expect(personal(page).getByText("同行雨傘", { exact: true })).toHaveCount(0);
});

test("editing content or changing assignee resets packing and moves the canonical row to the new member", async ({ page }) => {
  await load(page);
  let row = sharedRow(page, "團隊相機");
  await expect(row.getByRole("checkbox", { name: /^成員已備妥：/ })).toBeChecked();
  await row.getByRole("button", { name: "編輯：團隊相機", exact: true }).click();
  await team(page).getByLabel("編輯共用物品名稱", { exact: true }).fill("團隊相機與充電器");
  await team(page).getByLabel("編輯共用物品名稱", { exact: true }).press("Enter");
  row = sharedRow(page, "團隊相機與充電器");
  await expect(row.getByRole("checkbox", { name: /^成員已備妥：/ })).not.toBeChecked();
  await actor(page, "packer"); await row.getByRole("checkbox", { name: /^成員已備妥：/ }).check();
  await actor(page, "owner");
  await dragLuggage(page, "團隊相機與充電器", "viewer");
  await expect(row.getByRole("checkbox", { name: /^成員已備妥：/ })).not.toBeChecked();
  await expect(team(page).getByRole("region", { name: "旅伴 Dennis的共用物品", exact: true }).getByRole("button", { name: "編輯：團隊相機與充電器", exact: true })).toBeVisible();
  await actor(page, "packer"); await expect(personal(page).getByText("團隊相機與充電器", { exact: true })).toHaveCount(0);
  await actor(page, "viewer"); await expect(personal(page).getByText("團隊相機與充電器", { exact: true })).toBeVisible();
});

test("incoming snapshots do not overwrite drafts and a failed save keeps the editor intact", async ({ page }) => {
  await load(page);
  await personal(page).getByRole("button", { name: "編輯：護照", exact: true }).click();
  const name = personal(page).getByLabel("編輯個人行李名稱", { exact: true });
  await name.fill("護照與影本"); await page.getByRole("button", { name: "模擬遠端重新載入", exact: true }).click();
  await expect(name).toHaveValue("護照與影本");
  await page.getByRole("button", { name: "下一次操作失敗", exact: true }).click();
  await personal(page).getByLabel("編輯個人行李名稱", { exact: true }).press("Enter");
  await expect(name).toHaveValue("護照與影本"); await expect(page.getByRole("alert").first()).toContainText(/重試|未完成/);
  await personal(page).getByLabel("編輯個人行李名稱", { exact: true }).press("Enter");
  await expect(personal(page).getByText("護照與影本", { exact: true })).toBeVisible();
});

test("switching from personal to shared editing saves automatically without mixing fields", async ({ page }) => {
  await load(page);
  await personal(page).getByRole("button", { name: "編輯：護照", exact: true }).click();
  await personal(page).getByLabel("編輯個人行李名稱", { exact: true }).fill("自動儲存的名稱");
  await sharedRow(page, "共享充電器").getByRole("button", { name: "編輯：共享充電器", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(team(page).getByLabel("編輯共用物品名稱", { exact: true })).toHaveValue("共享充電器");
  await expect(personal(page).getByText("自動儲存的名稱", { exact: true })).toBeVisible();
  expect((await state(page)).luggageItems.find((item) => item.id === "own").title).toBe("自動儲存的名稱");
});

test("Escape preserves dirty input until Save or Discard is explicitly chosen", async ({ page }) => {
  await load(page);
  const guard = page.getByRole("dialog", { name: "您有未儲存的變更", exact: true });
  await personal(page).getByRole("button", { name: "編輯：護照", exact: true }).click();
  await personal(page).getByLabel("編輯個人行李名稱", { exact: true }).fill("取消後不要保存");
  await personal(page).getByLabel("編輯個人行李名稱", { exact: true }).press("Escape");
  await expect(guard).toBeVisible();
  await expect(personal(page).getByLabel("編輯個人行李名稱", { exact: true })).toHaveValue("取消後不要保存");
  await guard.getByRole("button", { name: "不儲存", exact: true }).click();
  await expect(personal(page).getByLabel("個人行李名稱", { exact: true })).toHaveValue("");
  await expect(personal(page).getByText("護照", { exact: true })).toBeVisible();
  await sharedRow(page, "共享充電器").getByRole("button", { name: "編輯：共享充電器", exact: true }).click();
  await team(page).getByLabel("編輯共用物品名稱", { exact: true }).fill("取消前仍能保存");
  await team(page).getByLabel("編輯共用物品名稱", { exact: true }).press("Escape");
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(sharedRow(page, "取消前仍能保存")).toBeVisible();
  await expect(team(page).getByLabel("共用物品名稱", { exact: true })).toHaveCount(0);
});

test("two member pages receive packing and unpacking from the same canonical row", async ({ context, page }) => {
  const room = `sync-${Date.now()}-${Math.random()}`;
  await load(page, `?room=${room}&actor=packer`);
  const owner = await context.newPage(); await load(owner, `?room=${room}&actor=owner`);
  await personal(page).getByRole("checkbox", { name: "準備指派共用物品：共享充電器", exact: true }).check();
  await expect(sharedRow(owner, "共享充電器").getByRole("checkbox", { name: /^成員已備妥：/ })).toBeChecked();
  await expect(sharedRow(owner, "共享充電器")).toHaveClass(/packed/);
  await expect(owner.getByText("總召確認", { exact: true })).toHaveCount(0);
  await personal(page).getByRole("checkbox", { name: "準備指派共用物品：共享充電器", exact: true }).uncheck();
  await expect(sharedRow(owner, "共享充電器").getByRole("checkbox", { name: /^成員已備妥：/ })).not.toBeChecked();
  await expect(owner.getByText("Chloe 私人藥物", { exact: true })).toHaveCount(0);
  await expect(page.getByText("護照", { exact: true })).toHaveCount(0);
  await owner.close();
});

test("a stale shared edit cannot overwrite a remote content change", async ({ context, page }) => {
  const room = `conflict-${Date.now()}-${Math.random()}`;
  await load(page, `?room=${room}&actor=owner`);
  const other = await context.newPage(); await load(other, `?room=${room}&actor=viewer`);
  await sharedRow(page, "共享充電器").getByRole("button", { name: "編輯：共享充電器", exact: true }).click();
  await team(page).getByLabel("編輯共用物品名稱", { exact: true }).fill("本機未儲存名稱");
  await sharedRow(other, "共享充電器").getByRole("button", { name: "編輯：共享充電器", exact: true }).click();
  await team(other).getByLabel("編輯共用物品名稱", { exact: true }).fill("遠端正式名稱");
  await team(other).getByLabel("編輯共用物品名稱", { exact: true }).press("Enter");
  await expect(team(page).getByRole("form", { name: "編輯共用物品：遠端正式名稱", exact: true })).toBeVisible();
  await expect(team(page).getByLabel("編輯共用物品名稱", { exact: true })).toHaveValue("本機未儲存名稱");
  await team(page).getByLabel("編輯共用物品名稱", { exact: true }).press("Enter");
  await expect(page.getByRole("alert").first()).toContainText(/更新|重試/);
  expect((await state(page)).sharedLuggageItems.find((item) => item.id === "shared").title).toBe("遠端正式名稱");
  await expect(team(page).getByLabel("編輯共用物品名稱", { exact: true })).toHaveValue("本機未儲存名稱");
  await other.close();
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 820, height: 1000 }, { width: 390, height: 844 }]) {
  test(`long lists and controls fit ${viewport.width}px without horizontal overflow`, async ({ page }) => {
    await page.setViewportSize(viewport); await load(page, "?long=1");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const outside = await page.locator(".luggage-panel").evaluate((root) => [...root.querySelectorAll("button,input,select")].filter((element) => element.getBoundingClientRect().width > 0).filter((element) => element.getBoundingClientRect().right > innerWidth + 1).map((element) => element.getAttribute("aria-label") || element.textContent));
    expect(outside).toEqual([]);
    await expect(personal(page).getByRole("checkbox", { name: "準備：長清單物品 55", exact: true })).toBeEnabled();
    if (viewport.width === 390) {
      await page.getByRole("tab", { name: /共用物品/ }).click();
      await expect(sharedRow(page, "共享充電器")).toBeVisible();
      await expect(personal(page)).not.toBeVisible();
    }
  });
}

test("empty lists expose useful add actions and no phantom completion", async ({ page }) => {
  await load(page, "?empty=1");
  await expect(personal(page).getByLabel("個人行李名稱", { exact: true })).toBeVisible();
  await expect(team(page).getByLabel("共用物品名稱", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await personal(page).getByLabel("個人行李名稱", { exact: true }).fill("第一件行李");
  await personal(page).getByRole("button", { name: "新增個人行李", exact: true }).click();
  await expect(personal(page).getByRole("checkbox", { name: "準備：第一件行李", exact: true })).toBeVisible();
});

test("shared list has no status filters and keeps all items and progress visible", async ({ page }) => {
  await load(page);
  await expect(page.getByRole("group", { name: "共用物品篩選", exact: true })).toHaveCount(0);
  const packed = page.getByRole("progressbar", { name: "成員已備妥", exact: true });
  await expect(packed).toHaveAttribute("aria-valuenow", "1");
  await expect(packed).toHaveAttribute("aria-valuemax", "4");
  await expect(team(page).locator(".shared-luggage-row")).toHaveCount(4);
});

test("category and assignee menus align to fields and exclude pending members", async ({ page }) => {
  await load(page);
  const category = personal(page).getByRole("combobox", { name: "個人行李分類", exact: true });
  await personal(page).getByLabel("個人行李名稱", { exact: true }).fill("頭燈");
  await category.fill("露營專用"); await category.press("Escape");
  await personal(page).getByRole("button", { name: "新增個人行李", exact: true }).click();
  await expect(personal(page).getByRole("region", { name: "露營專用", exact: true }).locator(".lb-group-toggle")).toBeVisible();
  await expect(team(page).locator(".lb-list-body").getByRole("combobox")).toHaveCount(0);
  await expect(page.locator('[data-member-id="pending"]')).toHaveCount(0);
  await expect(page.locator('[data-member-id="viewer"]')).toBeVisible();
});

test("mobile list switching retains input and allows immediate packing", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await load(page);
  await personal(page).getByLabel("個人行李名稱", { exact: true }).fill("尚未新增的物品");
  await page.getByRole("tab", { name: /個人行李/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /共用物品/ })).toBeFocused();
  await expect(page.getByRole("tab", { name: /共用物品/ })).toHaveAttribute("aria-selected", "true");
  await expect(team(page)).toBeVisible();
  await page.getByRole("tab", { name: /個人行李/ }).click();
  await expect(personal(page).getByLabel("個人行李名稱", { exact: true })).toHaveValue("尚未新增的物品");
  await personal(page).getByRole("button", { name: "新增個人行李", exact: true }).click();
  await personal(page).getByRole("checkbox", { name: "準備：尚未新增的物品", exact: true }).check();
  await expect(personal(page).getByRole("checkbox", { name: "準備：尚未新增的物品", exact: true })).toBeChecked();
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`the real Demo shell is usable at ${viewport.width}px without backend or draft traffic`, async ({ page }) => {
    const errors = [], backend = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("request", (request) => { if (/supabase\.(co|in)|\/(auth|rest|storage|realtime)\/v1\//i.test(request.url())) backend.push(request.url()); });
    await page.setViewportSize(viewport);
    await page.clock.install({ time: new Date("2026-10-23T12:00:00+08:00") });
    await page.goto("/demo/luggage");
    await expect(page).toHaveTitle(/旅程工房/);
    await expect(page.getByRole("region", { name: "行李清單", exact: true })).toBeVisible();
    expect(await page.locator(".lb-column-heading").first().evaluate((element) => element.getBoundingClientRect().top)).toBeLessThan(viewport.height - 180);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const passport = personal(page).getByRole("checkbox", { name: "準備：護照", exact: true });
    const initialPacked = await passport.isChecked();
    await passport.setChecked(!initialPacked); await expect(passport).toBeChecked({ checked: !initialPacked });
    if (viewport.width === 390) {
      await page.getByRole("tab", { name: /共用物品/ }).click();
      await expect(team(page)).toBeVisible();
    }
    await page.clock.runFor(800);
    expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => /draft|lock/i.test(key)))).toEqual([]);
    expect(backend).toEqual([]); expect(errors).toEqual([]);
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  });
}

test("the 56-item Demo stays flat and dense with independently reachable list ends", async ({ page }) => {
  await page.goto("/demo/luggage");
  await expect(page.locator(".lb-private-row")).toHaveCount(40);
  await expect(page.locator(".shared-luggage-row")).toHaveCount(16);
  await expect(page.locator(".lb-private-row button[aria-label^='刪除']")).toHaveCount(0);
  await expect(page.locator(".shared-luggage-row button[aria-label^='刪除']")).toHaveCount(0);
  const density = await page.locator(".lb-shared").evaluate(root => {
    const rows = [...root.querySelectorAll(".shared-luggage-row")];
    return { first: rows[0].getBoundingClientRect().top, visible: rows.filter(row => row.getBoundingClientRect().bottom <= innerHeight).length,
      heights: rows.map(row => row.getBoundingClientRect().height), cards: rows.some(row => getComputedStyle(row).borderRadius !== "0px") };
  });
  // The approved design adds visible status tabs and member group headings.
  expect(density.first).toBeLessThan(370);
  expect(density.visible).toBeGreaterThanOrEqual(10);
  expect(Math.max(...density.heights)).toBeLessThanOrEqual(40);
  expect(density.cards).toBe(false);
  const headerY = (await team(page).locator(".lb-column-heading").boundingBox()).y;
  await team(page).locator(".lb-list-body").evaluate(element => { element.scrollTop = element.scrollHeight; });
  await team(page).getByRole("button", { name: "編輯：共用洗衣精", exact: true }).click();
  await expect(team(page).getByLabel("編輯共用物品名稱", { exact: true })).toHaveValue("共用洗衣精");
  expect((await team(page).locator(".lb-column-heading").boundingBox()).y).toBe(headerY);
  await team(page).getByLabel("編輯共用物品名稱", { exact: true }).press("Escape");
  await personal(page).locator(".lb-list-body").evaluate(element => { element.scrollTop = element.scrollHeight; });
  await personal(page).getByRole("button", { name: "編輯：旅行收納袋", exact: true }).click();
  await expect(personal(page).getByLabel("編輯個人行李名稱", { exact: true })).toHaveValue("旅行收納袋");
});

test("approved 6:4 workspace groups shared items by member and personal category groups collapse independently", async ({ page }) => {
  await page.goto("/demo/luggage");
  const widths = await page.locator(".lb-layout").evaluate(element => [...element.children].map(child => child.getBoundingClientRect().width));
  expect(widths[0] / (widths[0] + widths[1])).toBeCloseTo(.6, 3);
  await expect(team(page).locator(".lb-member-group").first()).toHaveAccessibleName("Peter（我）的共用物品");
  await expect(team(page).locator('[data-member-id="unassigned"]')).toHaveCount(0);
  const group = personal(page).getByRole("region", { name: "證件", exact: true });
  await group.getByRole("button", { name: /證件.*6項/ }).click();
  await expect(personal(page).getByRole("checkbox", { name: "準備：護照", exact: true })).toBeHidden();
  await expect(personal(page).getByRole("checkbox", { name: "準備指派共用物品：延長線・萬用轉接頭", exact: true })).toBeVisible();
  await expect(personal(page).getByRole("progressbar")).toHaveAttribute("aria-valuemax", "44");
  await expect(team(page).locator(".shared-luggage-row")).toHaveCount(16);
  await expect(page.getByRole("checkbox", { name: /^總召確認：/ })).toHaveCount(0);
  await group.getByRole("button", { name: /證件.*6項/ }).click();
  await expect(personal(page).getByRole("checkbox", { name: "準備：護照", exact: true })).toBeVisible();
});

test("deleting from an editor confirms unsaved changes and retains the draft on failure", async ({ page }) => {
  await load(page);
  await personal(page).getByRole("button", { name: "編輯：護照", exact: true }).click();
  await personal(page).getByLabel("編輯個人行李名稱", { exact: true }).fill("尚未儲存的名稱");
  // Cancellation leaves the draft intact.
  await personal(page).getByRole("button", { name: "刪除：護照", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "刪除物品？" })).toContainText("尚未儲存的修改也會捨棄");
  await page.getByRole("dialog", { name: "刪除物品？" }).getByRole("button", { name: "取消", exact: true }).click();
  await expect(personal(page).getByLabel("編輯個人行李名稱", { exact: true })).toHaveValue("尚未儲存的名稱");
  await page.getByRole("button", { name: "下一次操作失敗", exact: true }).click();
  await personal(page).getByRole("button", { name: "刪除：護照", exact: true }).click();
  await acceptDeletion(page);
  await expect(personal(page).getByLabel("編輯個人行李名稱", { exact: true })).toHaveValue("尚未儲存的名稱");
  expect((await state(page)).luggageItems.some(item => item.id === "own")).toBe(true);
  await personal(page).getByRole("button", { name: "刪除：護照", exact: true }).click();
  await acceptDeletion(page);
  await expect(personal(page).getByLabel("個人行李名稱", { exact: true })).toHaveValue("");
  expect((await state(page)).luggageItems.some(item => item.id === "own")).toBe(false);
  expect((await state(page)).luggageItems.some(item => item.owner_id === "packer")).toBe(true);
});
