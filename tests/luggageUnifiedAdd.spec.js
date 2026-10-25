import { expect, test } from "@playwright/test";
import { luggageState } from "./helpers/luggageDrag.js";

// Browser plugin not available; use the existing Playwright runner and local adapters.
const fixture = "/tests/harness/luggage.html";
const mode = page => page.locator(".lb-mode-option[aria-pressed=true]");
const switchMode = page => page.locator(".lb-mode-option[aria-pressed=false]").click();
const quick = page => page.locator(".lb-add-form");
async function choose(page, name, value) {
  await page.getByRole("combobox", { name, exact: true }).click();
  await page.getByRole("listbox", { name: `${name}選項`, exact: true }).getByRole("option", { name: value, exact: true }).click();
}

for (const width of [1440, 390]) {
  test(`${width}px segmented creation preserves input and independent category/carrier choices; shared creation writes once`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await page.goto(fixture);
    const before = await luggageState(page);
    await expect(page.getByRole("group", { name: "新增物品類型", exact: true }).getByRole("button")).toHaveCount(2);
    await expect(mode(page)).toHaveCount(1); await expect(mode(page)).toHaveText("個人");
    const notes = quick(page).getByLabel("個人行李備註", { exact: true });
    const formBox = await quick(page).boundingBox(), noteBox = await notes.boundingBox(), toggleBox = await page.locator(".lb-creation-mode").boundingBox();
    const nameBox = await quick(page).getByLabel("個人行李名稱", { exact: true }).boundingBox();
    const metaBox = await quick(page).getByRole("combobox", { name: "個人行李分類", exact: true }).boundingBox();
    const addBox = await quick(page).getByRole("button", { name: "新增個人行李", exact: true }).boundingBox();
    expect(metaBox.x).toBeGreaterThan(toggleBox.x + toggleBox.width);
    expect(nameBox.x).toBeGreaterThan(metaBox.x + metaBox.width);
    expect(Math.abs(addBox.y - noteBox.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(addBox.x + addBox.width - formBox.x - formBox.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(noteBox.x - toggleBox.x)).toBeLessThanOrEqual(1);
    expect(noteBox.x + noteBox.width).toBeLessThan(addBox.x);
    expect(noteBox.y).toBeGreaterThan(toggleBox.y + toggleBox.height);
    await expect(page.locator(".lb-note-toggle,.lb-meta-field")).toHaveCount(0);
    await choose(page, "個人行李分類", "衣物");
    await quick(page).getByLabel("個人行李名稱", { exact: true }).fill("共用延長線"); await notes.fill("放在隨身包");
    await switchMode(page);
    await expect(mode(page)).toHaveText("共用"); await expect(mode(page)).toHaveAttribute("aria-pressed", "true");
    await expect(quick(page).getByLabel("共用物品名稱", { exact: true })).toHaveValue("共用延長線");
    await expect(quick(page).getByLabel("共用物品備註", { exact: true })).toHaveValue("放在隨身包");
    await expect(page.getByRole("combobox", { name: "個人行李分類", exact: true })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "共用物品攜帶者", exact: true })).toContainText("總召 Peter（我）");
    await choose(page, "共用物品攜帶者", "旅伴 Dennis");
    await page.locator(".lb-mode-option[aria-pressed=false]").press("Enter");
    await expect(mode(page)).toHaveText("個人");
    await expect(page.getByRole("combobox", { name: "個人行李分類", exact: true })).toHaveValue("衣物");
    await page.locator(".lb-mode-option[aria-pressed=false]").press("Space");
    await expect(page.getByRole("combobox", { name: "共用物品攜帶者", exact: true })).toContainText("旅伴 Dennis");
    expect(await luggageState(page)).toEqual(before);
    await quick(page).getByRole("button", { name: "新增共用物品", exact: true }).click();
    await expect(quick(page).getByLabel("共用物品名稱", { exact: true })).toHaveValue("");
    await expect(quick(page).getByLabel("共用物品備註", { exact: true })).toHaveValue("");
    await expect(quick(page).getByLabel("共用物品名稱", { exact: true })).toBeFocused();
    await expect(mode(page)).toHaveText("共用");
    await expect(page.getByRole("combobox", { name: "共用物品攜帶者", exact: true })).toContainText("旅伴 Dennis");
    const after = await luggageState(page);
    expect(after.luggageItems).toEqual(before.luggageItems);
    expect(after.sharedLuggageItems).toHaveLength(before.sharedLuggageItems.length + 1);
    expect(after.sharedLuggageItems.find(item => item.title === "共用延長線")).toMatchObject({ assigned_to: "viewer", notes: "放在隨身包", category: "", packed_by_assignee: false });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await choose(page, "共用物品攜帶者", "總召 Peter（我）");
    await quick(page).getByLabel("共用物品名稱", { exact: true }).fill("自己攜帶公物");
    await quick(page).getByLabel("共用物品備註", { exact: true }).fill("第二件備註");
    await quick(page).getByLabel("共用物品備註", { exact: true }).press("Enter");
    await expect(page.getByRole("button", { name: "編輯指派共用物品：自己攜帶公物", exact: true })).toBeVisible();
    expect((await luggageState(page)).sharedLuggageItems.filter(item => item.title === "自己攜帶公物")).toHaveLength(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("failed shared creation preserves the entire draft; retry saves once; pending members and unassigned are excluded", async ({ page }) => {
  await page.goto(`${fixture}?latency=100`); await switchMode(page);
  await page.getByRole("combobox", { name: "共用物品攜帶者", exact: true }).click();
  const menu = page.getByRole("listbox", { name: "共用物品攜帶者選項", exact: true });
  await expect(menu.getByRole("option")).toHaveCount(3);
  await expect(menu.getByRole("option", { name: /未指派|尚待核准/ })).toHaveCount(0);
  await menu.getByRole("option", { name: "旅伴 Chloe", exact: true }).click();
  await quick(page).getByLabel("共用物品名稱", { exact: true }).fill("失敗後再試");
  await quick(page).getByLabel("共用物品備註", { exact: true }).fill("保留備註");
  const before = await luggageState(page); await page.getByRole("button", { name: "下一次操作失敗", exact: true }).click();
  await quick(page).getByRole("button", { name: "新增共用物品", exact: true }).click();
  await expect(page.getByRole("alert").first()).toBeVisible(); expect(await luggageState(page)).toEqual(before);
  await expect(quick(page).getByLabel("共用物品名稱", { exact: true })).toHaveValue("失敗後再試");
  await expect(quick(page).getByLabel("共用物品備註", { exact: true })).toHaveValue("保留備註");
  await expect(page.getByRole("combobox", { name: "共用物品攜帶者", exact: true })).toContainText("旅伴 Chloe");
  await quick(page).getByRole("button", { name: "新增共用物品", exact: true }).click();
  await expect(quick(page).getByLabel("共用物品名稱", { exact: true })).toHaveValue("");
  expect((await luggageState(page)).sharedLuggageItems.filter(item => item.title === "失敗後再試")).toHaveLength(1);
});

test("unified draft restores its explicit shared mode, name, notes and carrier without publishing on reload", async ({ page }) => {
  await page.goto(`${fixture}?drafts=1`); await switchMode(page); await choose(page, "共用物品攜帶者", "旅伴 Dennis");
  await quick(page).getByLabel("共用物品名稱", { exact: true }).fill("未送出的共用草稿");
  await quick(page).getByLabel("共用物品備註", { exact: true }).fill("草稿備註");
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide"))); await page.reload();
  await expect(mode(page)).toHaveText("共用");
  await expect(quick(page).getByLabel("共用物品名稱", { exact: true })).toHaveValue("未送出的共用草稿");
  await expect(quick(page).getByLabel("共用物品備註", { exact: true })).toHaveValue("草稿備註");
  await expect(page.getByRole("combobox", { name: "共用物品攜帶者", exact: true })).toContainText("旅伴 Dennis");
  expect((await luggageState(page)).sharedLuggageItems.some(item => item.title === "未送出的共用草稿")).toBe(false);
});

test("a restored draft with a departed carrier cannot create an unassigned item", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("travel-planner-draft:owner:luggage-trip:luggage_quick_add:new", JSON.stringify({ form: { title: "過期待指派草稿", notes: "保留", category: "衣物", creation_scope: "shared", assigned_to: "departed" }, savedAt: "2090-01-01T00:00:00Z" })));
  await page.goto(`${fixture}?drafts=1`); await expect(mode(page)).toHaveText("共用");
  await expect(quick(page).getByRole("button", { name: "新增共用物品", exact: true })).toBeDisabled();
  await choose(page, "共用物品攜帶者", "旅伴 Dennis");
  await quick(page).getByRole("button", { name: "新增共用物品", exact: true }).click();
  await expect(quick(page).getByLabel("共用物品名稱", { exact: true })).toHaveValue("");
  expect((await luggageState(page)).sharedLuggageItems.find(item => item.title === "過期待指派草稿").assigned_to).toBe("viewer");
});

test("approved viewers can create shared items and pending members cannot use the unified entry", async ({ page }) => {
  await page.goto(`${fixture}?actor=viewer`); await switchMode(page);
  await expect(page.getByRole("combobox", { name: "共用物品攜帶者", exact: true })).toContainText("旅伴 Dennis（我）");
  await quick(page).getByLabel("共用物品名稱", { exact: true }).fill("觀察者新增公物");
  await quick(page).getByLabel("共用物品名稱", { exact: true }).press("Enter");
  await expect(page.getByRole("button", { name: "編輯指派共用物品：觀察者新增公物", exact: true })).toBeVisible();
  await page.goto(`${fixture}?actor=pending`); await expect(mode(page)).toBeDisabled();
  await expect(quick(page).getByLabel("個人行李名稱", { exact: true })).toBeDisabled();
  await expect(quick(page).getByLabel("個人行李備註", { exact: true })).toBeDisabled();
});

test("real Demo unified entry matches the approved two-row layout without backend traffic or console errors", async ({ page }) => {
  await page.setViewportSize({ width: 1456, height: 1080 });
  const errors = [], requests = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (/\.supabase\.co|\/(rest|auth|storage)\/v1|\/realtime\/v1/i.test(request.url())) requests.push(request.url()); });
  await page.goto("/demo/luggage"); await expect(page).toHaveTitle(/Travel Studio/);
  await expect(quick(page)).toBeVisible(); await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "個人行李篩選", exact: true })).toHaveCount(0);
  await expect(page.getByRole("searchbox")).toHaveCount(0); await expect(page.locator(".lb-creation-mode")).toHaveCount(1);
  if (process.env.LUGGAGE_UNIFIED_SCREENSHOT) {
    await page.screenshot({ path: `${process.env.LUGGAGE_UNIFIED_SCREENSHOT}-personal.png` });
    await choose(page, "個人行李分類", "電子用品");
    await quick(page).getByLabel("個人行李名稱", { exact: true }).fill("萬用轉接頭");
    await quick(page).getByLabel("個人行李備註", { exact: true }).fill("放隨身包，支援多國插頭");
    await page.screenshot({ path: `${process.env.LUGGAGE_UNIFIED_SCREENSHOT}-filled.png` });
    await quick(page).getByLabel("個人行李名稱", { exact: true }).fill("");
    await quick(page).getByLabel("個人行李備註", { exact: true }).fill("");
  }
  await switchMode(page); await expect(page.getByRole("combobox", { name: "共用物品攜帶者", exact: true })).toContainText("Peter（我）");
  if (process.env.LUGGAGE_UNIFIED_SCREENSHOT) await page.screenshot({ path: `${process.env.LUGGAGE_UNIFIED_SCREENSHOT}-shared.png` });
  await choose(page, "共用物品攜帶者", "Dennis"); await quick(page).getByLabel("共用物品名稱", { exact: true }).fill("Demo 統一新增");
  await quick(page).getByLabel("共用物品備註", { exact: true }).fill("直接指派 Dennis");
  await quick(page).getByLabel("共用物品名稱", { exact: true }).press("Enter");
  await expect(page.getByRole("button", { name: "編輯：Demo 統一新增", exact: true })).toBeVisible();
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});
