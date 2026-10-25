import { expect, test } from "@playwright/test";
import { keyboardAssign } from "./helpers/luggageDrag.js";

// Browser plugin unavailable; repository Playwright uses the shared controller
// and isolated persistence adapter, never hosted data.
test.use({ viewport: { width: 1440, height: 900 } });
const fixture = "/tests/harness/luggage.html";
const canonical = async page => JSON.parse(await page.getByTestId("luggage-canonical-state").textContent());

test("personal status and search controls are removed while progress remains visible", async ({ page }) => {
  await page.goto(fixture);
  await expect(page.getByRole("group", { name: "個人行李篩選", exact: true })).toHaveCount(0);
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "展開行李搜尋", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "編輯：護照", exact: true })).toBeVisible();
  for (const label of ["我的打包進度", "成員已打包"]) {
    const progress = page.getByRole("progressbar", { name: label, exact: true });
    expect(await progress.innerText()).toMatch(/^\d+\/\d+$/);
    expect((await progress.locator(".lb-meter").boundingBox()).width).toBeGreaterThanOrEqual(100);
  }
});

for (const width of [1440, 390, 360]) {
  test(`${width}px row editing keeps neighbouring rows fixed, preserves menus and saves on background tap`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await page.goto(fixture);
    const row = page.locator(".lb-private-row").first();
    const before = await row.boundingBox();
    await row.getByRole("button", { name: "編輯：護照", exact: true }).click();
    const editor = row.getByRole("form");
    expect((await row.boundingBox()).height).toBe(before.height);
    await expect(editor.getByRole("button", { name: /^儲存|取消/ })).toHaveCount(0);
    await expect(editor.getByRole("button", { name: "刪除：護照", exact: true })).toHaveText("");
    const name = editor.getByLabel("編輯個人行李名稱", { exact: true });
    await name.fill("護照及影本");
    await editor.getByLabel("編輯個人行李備註", { exact: true }).fill("確認效期");
    await expect(editor).toBeVisible();
    expect((await canonical(page)).luggageItems.find(item => item.id === "own").title).toBe("護照");
    await editor.getByLabel("編輯個人行李備註", { exact: true }).press("Escape");
    const guard = page.getByRole("dialog", { name: "您有未儲存的變更", exact: true });
    await expect(guard).toBeVisible();
    await guard.getByRole("button", { name: "不儲存", exact: true }).click();
    await row.getByRole("button", { name: "編輯：護照", exact: true }).click();
    await name.fill("護照及影本");
    await editor.getByLabel("編輯個人行李備註", { exact: true }).fill("確認效期");
    await name.focus();
    await page.getByRole("heading", { name: /個人行李/ }).click();
    await expect(editor).toHaveCount(0);
    expect((await canonical(page)).luggageItems.find(item => item.id === "own")).toMatchObject({ title: "護照及影本", notes: "確認效期" });
    expect((await row.boundingBox()).height).toBe(before.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("row autosave failure and IME Enter retain the draft, while icon deletion still confirms", async ({ page }) => {
  await page.goto(fixture);
  await page.getByRole("button", { name: "編輯：護照", exact: true }).click();
  const name = page.getByLabel("編輯個人行李名稱", { exact: true });
  await name.fill("護照未完成輸入");
  await name.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  expect((await canonical(page)).luggageItems.find(item => item.id === "own").title).toBe("護照");
  await page.getByRole("button", { name: "下一次操作失敗", exact: true }).click();
  await name.focus(); await page.getByRole("heading", { name: /個人行李/ }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(name).toHaveValue("護照未完成輸入");
  await page.getByRole("button", { name: "刪除：護照", exact: true }).click();
  await page.getByRole("dialog", { name: "刪除物品？" }).getByRole("button", { name: "取消", exact: true }).click();
  await expect(name).toHaveValue("護照未完成輸入");
  expect((await canonical(page)).luggageItems.some(item => item.id === "own")).toBe(true);
  await name.press("Enter");
  await expect(page.getByRole("button", { name: "編輯：護照未完成輸入", exact: true })).toBeFocused();
});

test("mobile team retains same-height editing and confirmed reassignment", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(fixture);
  await page.getByRole("tab", { name: "共用物品", exact: true }).click();
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  const row = page.locator(".shared-luggage-row").filter({ has: page.getByRole("button", { name: "編輯：共享充電器", exact: true }).or(page.getByRole("form", { name: "編輯共用物品：共享充電器", exact: true })) });
  const before = await row.boundingBox();
  await row.getByRole("button", { name: "編輯：共享充電器", exact: true }).click();
  expect((await row.boundingBox()).height).toBe(before.height);
  const editor = row.getByRole("form");
  await expect(editor.getByRole("combobox")).toHaveCount(0);
  await editor.getByLabel("編輯共用物品名稱", { exact: true }).press("Escape");
  await keyboardAssign(page, "共享充電器", "owner");
  await expect(row.getByRole("checkbox", { name: /^成員已打包/ })).toBeEnabled();
  expect((await canonical(page)).sharedLuggageItems.find(item => item.id === "shared").assigned_to).toBe("owner");
});
