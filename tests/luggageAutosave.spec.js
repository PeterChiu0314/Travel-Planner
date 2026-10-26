import { expect, test } from "@playwright/test";

// Browser plugin unavailable: repository Playwright uses delayed, isolated
// persistence to exercise the first-click/busy race without hosted writes.
test.use({ viewport: { width: 1440, height: 900 } });
const state = async page => JSON.parse(await page.getByTestId("luggage-canonical-state").textContent());
const name = (page, shared = false) => page.getByLabel(`編輯${shared ? "共用物品" : "個人行李"}名稱`, { exact: true });
async function load(page, query = "") { await page.goto(`/tests/harness/luggage.html?latency=100${query}`); }
const editor = page => page.locator(".lb-inline-editor");

test("one click saves and opens the next private or shared row, once, without a prompt", async ({ page }) => {
  await load(page, "&long=1");
  await page.getByLabel("個人行李名稱", { exact: true }).fill("獨立新增草稿");
  await page.getByRole("button", { name: "編輯：護照", exact: true }).click();
  await name(page).fill("護照與影本");
  await page.getByRole("button", { name: "編輯：長清單物品 1", exact: true }).click();
  await expect(name(page)).toHaveValue("長清單物品 1");
  expect((await state(page)).luggageItems.find(item => item.id === "own")).toMatchObject({ title: "護照與影本", updated_at: "2026-10-23T01:00:01.000Z" });
  await name(page).fill("變更後的長清單物品");
  await page.getByRole("button", { name: "編輯：共享充電器", exact: true }).click();
  await expect(name(page, true)).toHaveValue("共享充電器");
  expect((await state(page)).luggageItems.find(item => item.id === "long-0").title).toBe("變更後的長清單物品");
  await expect(editor(page)).toHaveCount(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("個人行李名稱", { exact: true })).toHaveValue("獨立新增草稿");
});

test("clicking Quick Add saves first and restores the original input focus and draft", async ({ page }) => {
  await load(page);
  const quick = page.getByLabel("個人行李名稱", { exact: true });
  await quick.fill("待新增外套");
  await page.getByRole("button", { name: "編輯：護照", exact: true }).click();
  await name(page).fill("護照新版");
  await quick.click();
  await expect(editor(page)).toHaveCount(0); await expect(quick).toBeFocused();
  await expect(quick).toHaveValue("待新增外套");
  expect((await state(page)).luggageItems.find(item => item.id === "own").title).toBe("護照新版");
  await quick.press("Enter");
  await expect(page.getByRole("button", { name: "編輯：待新增外套", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("shared list, creation mode and checkbox labels execute their original action after saving", async ({ page }) => {
  await load(page);
  await page.getByRole("button", { name: "編輯：護照", exact: true }).click(); await name(page).fill("護照A");
  await page.locator('#lb-shared .lb-list-body').click({ position: { x: 3, y: 3 } });
  await expect.poll(async () => (await state(page)).luggageItems.find(item => item.id === "own").title).toBe("護照A");
  await page.getByRole("button", { name: "編輯：護照A", exact: true }).click(); await name(page).fill("護照B");
  await page.getByRole("button", { name: "新增類型：共用", exact: true }).click();
  await expect(page.getByRole("form", { name: "快速新增共用物品", exact: true })).toBeVisible();
  expect((await state(page)).luggageItems.find(item => item.id === "own").title).toBe("護照B");
  await page.getByRole("button", { name: "編輯：護照B", exact: true }).click(); await name(page).fill("護照C");
  const check = page.getByRole("checkbox", { name: "成員已備妥：團隊文件", exact: true });
  await check.locator("..").click();
  await expect(check).toBeChecked();
  expect((await state(page)).luggageItems.find(item => item.id === "own").title).toBe("護照C");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Tab leaving the editor auto-saves without stealing the destination focus", async ({ page }) => {
  await load(page);
  await page.getByRole("button", { name: "編輯：護照", exact: true }).click(); await name(page).fill("鍵盤編輯");
  await name(page).press("Tab");
  await expect(editor(page)).toHaveCount(1);
  await page.getByRole("textbox", { name: "編輯個人行李備註", exact: true }).press("Tab");
  await page.getByRole("button", { name: "刪除：護照", exact: true }).press("Tab");
  const next = page.getByRole("combobox", { name: "篩選共用物品", exact: true });
  await expect(editor(page)).toHaveCount(0); await expect(next).toBeFocused();
  expect((await state(page)).luggageItems.find(item => item.id === "own").title).toBe("鍵盤編輯");
});

test("failed or blank saves block switching and retain the current row until corrected", async ({ page }) => {
  await load(page);
  await page.getByRole("button", { name: "下一次操作失敗", exact: true }).click();
  await page.getByRole("button", { name: "編輯：護照", exact: true }).click(); await name(page).fill("失敗仍保留");
  const next = page.getByRole("button", { name: "編輯：共享充電器", exact: true });
  await next.click();
  await expect(name(page)).toHaveValue("失敗仍保留"); await expect(name(page)).toBeFocused();
  await expect(name(page, true)).toHaveCount(0);
  await expect(page.getByRole("alert").first()).toBeVisible();
  expect((await state(page)).luggageItems.find(item => item.id === "own").title).toBe("護照");
  await name(page).fill("   "); await next.click();
  await expect(name(page, true)).toHaveCount(0);
  expect(await name(page).evaluate(element => element.validity.valid)).toBe(false);
  await name(page).fill("修正後可儲存"); await next.click();
  await expect(name(page, true)).toHaveValue("共享充電器");
  expect((await state(page)).luggageItems.find(item => item.id === "own").title).toBe("修正後可儲存");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a remote shared conflict retains the draft and blocks the requested Quick Add focus", async ({ context, page }) => {
  const room = `autosave-${Date.now()}`;
  await load(page, `&room=${room}`);
  const remote = await context.newPage(); await load(remote, `&room=${room}&actor=viewer`);
  for (const target of [page, remote]) await target.getByRole("button", { name: "編輯：共享充電器", exact: true }).click();
  await name(page, true).fill("本機草稿");
  await name(remote, true).fill("遠端新名稱"); await name(remote, true).press("Enter");
  await expect(page.getByRole("form", { name: "編輯共用物品：遠端新名稱", exact: true })).toBeVisible();
  await page.bringToFront();
  await page.getByLabel("個人行李名稱", { exact: true }).click();
  await expect(page.getByRole("alert").first()).toContainText(/更新|重試/);
  await expect(name(page, true)).toHaveValue("本機草稿"); await expect(name(page, true)).toBeFocused();
  expect((await state(page)).sharedLuggageItems.find(item => item.id === "shared").title).toBe("遠端新名稱");
  await expect(page.getByRole("dialog")).toHaveCount(0); await remote.close();
});

test.describe("touch autosave", () => {
test.use({ hasTouch: true });
test("mobile list tabs auto-save before switching once and keep canonical shared state", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await load(page);
  await page.getByRole("button", { name: "編輯：護照", exact: true }).click(); await name(page).fill("手機護照");
  await page.getByRole("tab", { name: "共用物品", exact: true }).tap();
  await expect(page.getByRole("tab", { name: "共用物品", exact: true })).toHaveAttribute("aria-selected", "true");
  expect((await state(page)).luggageItems.find(item => item.id === "own").title).toBe("手機護照");
  await page.getByRole("button", { name: "編輯：團隊文件", exact: true }).click(); await name(page, true).fill("團隊文件新版");
  await page.getByRole("tab", { name: "個人行李", exact: true }).tap();
  await expect(page.getByRole("checkbox", { name: "準備指派共用物品：團隊文件新版", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
});
