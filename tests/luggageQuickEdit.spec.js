import { expect, test } from "@playwright/test";
import { dragLuggage, keyboardAssign } from "./helpers/luggageDrag.js";

// Browser plugin is unavailable; use the repository Playwright runner against
// the shared controller and the real Demo shell. No hosted writes are made.
test.use({ viewport: { width: 1440, height: 900 } });
const fixture = "/tests/harness/luggage.html";
const quick = (page, kind = "個人行李") => page.getByRole("form", { name: `快速新增${kind}`, exact: true });
const inline = page => page.locator(".lb-inline-editor");
async function load(page, query = "") {
  await page.goto(`${fixture}${query}`);
  await expect(page.getByRole("region", { name: "行李清單", exact: true })).toBeVisible();
}
async function choose(page, label, value) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("listbox", { name: `${label}選項`, exact: true }).getByRole("option", { name: value, exact: true }).click();
}
const canonical = async page => JSON.parse(await page.getByTestId("luggage-canonical-state").textContent());
const discard = async page => page.getByRole("dialog", { name: "您有未儲存的變更", exact: true }).getByRole("button", { name: "不儲存", exact: true }).click();

for (const kind of ["個人行李"]) {
  test(`${kind}: Quick Add is a fixed two-row form, remembers category and supports consecutive Enter additions`, async ({ page }) => {
    await load(page, "?empty=1");
    const form = quick(page, kind), name = form.getByLabel(`${kind}名稱`, { exact: true });
    const category = form.getByRole("combobox", { name: `${kind}分類`, exact: true });
    await expect(category).toHaveAttribute("placeholder", "未分類");
    const before = await form.boundingBox();
    const field = await name.boundingBox(), select = await category.boundingBox(), button = await form.getByRole("button", { name: `新增${kind}`, exact: true }).boundingBox();
    expect(Math.abs(field.y - select.y)).toBeLessThanOrEqual(1);
    expect(button.y).toBeGreaterThan(field.y + field.height);
    const notes = await form.getByLabel(`${kind}備註`, { exact: true }).boundingBox();
    expect(Math.abs(notes.y - button.y)).toBeLessThanOrEqual(1);
    expect(select.x).toBeLessThan(field.x);
    await choose(page, `${kind}分類`, "電子用品");
    await name.fill("充電轉接頭");
    expect((await form.boundingBox()).height).toBe(before.height);
    await name.press("Enter");
    await expect(name).toHaveValue(""); await expect(name).toBeFocused();
    await expect(category).toHaveValue("電子用品");
    await name.fill("備用充電線"); await name.press("Enter");
    await expect(name).toHaveValue(""); await expect(name).toBeFocused();
    await expect(category).toHaveValue("電子用品");
    const rows = (await canonical(page))[kind === "個人行李" ? "luggageItems" : "sharedLuggageItems"];
    expect(rows.map(row => [row.title, row.category])).toEqual([["充電轉接頭", "電子用品"], ["備用充電線", "電子用品"]]);
    expect((await form.boundingBox()).height).toBe(before.height);
  });
}

test("Quick Add category hints and choices stay isolated between tabs and trips", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1000 });
  await page.goto("/demo/luggage");
  await choose(page, "個人行李分類", "衣物");
  await page.getByRole("tab", { name: "共用物品", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "共用物品分類", exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "指派共用物品負責人", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "個人行李", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "個人行李分類", exact: true })).toHaveValue("衣物");
  await page.getByRole("button", { name: "系統測試專用", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "個人行李分類", exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "京都琵琶湖之旅-TEST", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "個人行李分類", exact: true })).toHaveValue("");
});

for (const width of [1440, 390]) {
  test(`${width}px: many assigned items share the private list scroll without trapping the pointer`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await load(page, "?assigned=1&long=1");
    if (width === 1440) await page.addStyleTag({ content: ".lb-board { height: 700px; }" });
    const assigned = page.locator(".lb-assigned"), list = page.locator(".lb-personal .lb-list-body");
    await expect(assigned.locator(".shared-assigned")).toHaveCount(37);
    expect(await assigned.evaluate(e => ({ max: getComputedStyle(e).maxHeight, overflow: getComputedStyle(e).overflowY }))).toEqual({ max: "none", overflow: "visible" });
    const nested = await list.evaluate(e => [...e.querySelectorAll("*")].filter(n => /auto|scroll/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight).map(n => n.className));
    expect(nested).toEqual([]);
    if (width === 1440) {
      await assigned.getByText("團隊文件", { exact: true }).hover(); await page.mouse.wheel(0, 600);
      await expect.poll(() => list.evaluate(e => e.scrollTop)).toBeGreaterThan(100);
      expect(await page.locator(".lb-shared .lb-list-body").evaluate(e => e.scrollTop)).toBe(0);
    } else expect(await list.evaluate(e => getComputedStyle(e).overflowY)).toBe("visible");
    const edit = page.getByRole("button", { name: "編輯：長清單物品 55", exact: true });
    await edit.click(); await expect(page.getByLabel("編輯個人行李名稱", { exact: true })).toHaveValue("長清單物品 55");
    await page.getByLabel("編輯個人行李名稱", { exact: true }).press("Escape");
    await expect(edit).toBeFocused();
  });
}

test("entering Quick Add saves the edited row without changing the separate new-item draft", async ({ page }) => {
  await load(page);
  const form = quick(page), name = form.getByLabel("個人行李名稱", { exact: true });
  await choose(page, "個人行李分類", "電子用品");
  await name.fill("新增中的充電線");
  const before = await form.boundingBox();
  await page.getByRole("button", { name: "編輯：護照", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const editor = inline(page);
  await expect(editor.locator("..")).toHaveClass(/lb-private-row/);
  await expect(editor.getByLabel("編輯個人行李名稱", { exact: true })).toBeFocused();
  await editor.getByLabel("編輯個人行李名稱", { exact: true }).fill("護照及影本");
  await editor.getByLabel("編輯個人行李備註", { exact: true }).fill("護照影本另放");
  await expect(name).toHaveValue("新增中的充電線");
  await expect(form.getByRole("combobox", { name: "個人行李分類", exact: true })).toHaveValue("電子用品");
  expect(await form.boundingBox()).toEqual(before);
  await name.click();
  await expect(editor).toHaveCount(0);
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("新增中的充電線");
  await name.press("Enter");
  await expect(name).toHaveValue(""); await expect(name).toBeFocused();
  await expect(page.getByRole("region", { name: "隨身必備", exact: true }).getByRole("button", { name: "編輯：護照及影本", exact: true })).toBeVisible();
  expect((await canonical(page)).luggageItems.find(row => row.id === "own").notes).toBe("護照影本另放");
  await expect(page.getByRole("checkbox", { name: "準備：新增中的充電線", exact: true })).not.toBeChecked();
});

test("only one inline editor opens across rows and columns without discarding Quick Add", async ({ page }) => {
  await load(page);
  await quick(page).getByLabel("個人行李名稱", { exact: true }).fill("尚未新增的物品");
  await page.getByRole("button", { name: "編輯：護照", exact: true }).click();
  await page.getByLabel("編輯個人行李名稱", { exact: true }).fill("未儲存護照");
  await page.getByRole("button", { name: "編輯：共享充電器", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await canonical(page)).luggageItems.find(row => row.id === "own").title).toBe("未儲存護照");
  await expect(inline(page)).toHaveCount(1);
  await expect(page.getByLabel("編輯共用物品名稱", { exact: true })).toHaveValue("共享充電器");
  await page.getByRole("button", { name: "編輯：團隊文件", exact: true }).click();
  await expect(inline(page)).toHaveCount(1);
  await expect(page.getByLabel("編輯共用物品名稱", { exact: true })).toHaveValue("團隊文件");
  await page.getByLabel("編輯共用物品名稱", { exact: true }).press("Escape");
  await expect(inline(page)).toHaveCount(0);
  await expect(quick(page).getByLabel("個人行李名稱", { exact: true })).toHaveValue("尚未新增的物品");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("failed Quick Add retains name, category and focus; opening an editor does not replace it", async ({ page }) => {
  await load(page);
  const name = quick(page).getByLabel("個人行李名稱", { exact: true });
  await choose(page, "個人行李分類", "衣物");
  await name.fill("防風外套");
  await page.getByRole("button", { name: "下一次操作失敗", exact: true }).click();
  await name.press("Enter");
  await expect(page.getByRole("alert").first()).toContainText(/重試|未完成/);
  await expect(name).toHaveValue("防風外套"); await expect(name).toBeFocused();
  await page.getByRole("button", { name: "編輯：護照", exact: true }).click();
  await expect(name).toHaveValue("防風外套");
  await page.getByLabel("編輯個人行李名稱", { exact: true }).press("Escape");
  await name.press("Enter"); await expect(name).toHaveValue(""); await expect(name).toBeFocused();
  expect((await canonical(page)).luggageItems.find(row => row.title === "防風外套").category).toBe("衣物");
});

test("desktop inline editing keeps the original row height and list position including the last item", async ({ page }) => {
  await page.goto("/demo/luggage");
  const list = page.locator(".lb-shared .lb-list-body"), form = page.locator("#lb-shared .lb-column-heading");
  const top = await form.boundingBox();
  const item = page.getByRole("button", { name: "編輯：常備藥包", exact: true });
  const row = await item.locator("xpath=ancestor::article[1]").boundingBox(), scroll = await list.evaluate(element => element.scrollTop);
  await item.click();
  await expect(inline(page)).toBeVisible();
  expect((await inline(page).locator("..").boundingBox()).y).toBe(row.y);
  expect((await inline(page).locator("..").boundingBox()).height).toBe(row.height);
  expect(await list.evaluate(element => element.scrollTop)).toBe(scroll);
  await page.getByLabel("編輯共用物品名稱", { exact: true }).press("Escape");
  await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
  const bottomScroll = await list.evaluate(element => element.scrollTop);
  await page.getByRole("button", { name: "編輯：共用洗衣精", exact: true }).click();
  const reveal = await list.evaluate(element => element.scrollTop);
  expect(reveal - bottomScroll).toBe(0);
  await expect(page.getByLabel("編輯共用物品名稱", { exact: true })).toBeInViewport();
  expect(await form.boundingBox()).toEqual(top);
  await expect(page.locator(".lb-team-head")).toHaveCount(0);
});

test("shared drag preserves legacy category, regroups the canonical row and leaves private Quick Add intact", async ({ page }) => {
  await load(page);
  await quick(page).getByLabel("個人行李名稱", { exact: true }).fill("待新增私物");
  await dragLuggage(page, "團隊相機", "viewer");
  const row = (await canonical(page)).sharedLuggageItems.find(item => item.id === "ready");
  expect(row).toMatchObject({ category: "團隊裝備", assigned_to: "viewer", packed_by_assignee: false, confirmed_by_owner: false });
  await expect(quick(page).getByLabel("個人行李名稱", { exact: true })).toHaveValue("待新增私物");
});

for (const width of [360, 820]) {
  test.describe(`${width}px touch context`, () => {
  test.use({ hasTouch: true });
  test(`${width}px touch layout supports fixed Quick Add and inline edit without hover or overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await load(page, "?empty=1");
    const form = quick(page), top = await form.boundingBox();
    await form.getByLabel("個人行李名稱", { exact: true }).fill("共用野餐墊");
    await form.getByLabel("個人行李名稱", { exact: true }).press("Enter");
    await keyboardAssign(page, "共用野餐墊", "owner", "personal");
    await page.getByRole("button", { name: "編輯：共用野餐墊", exact: true }).tap();
    const editor = inline(page);
    await editor.getByLabel("編輯共用物品名稱", { exact: true }).fill("防水野餐墊");
    await editor.getByLabel("編輯共用物品名稱", { exact: true }).press("Enter");
    await expect(page.getByRole("button", { name: "編輯：防水野餐墊", exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "成員已備妥：防水野餐墊", exact: true })).not.toBeChecked();
    await page.getByRole("tab", { name: "個人行李", exact: true }).click(); expect((await form.boundingBox()).height).toBe(top.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 360) { await page.getByRole("tab", { name: "個人行李", exact: true }).click(); expect((await form.getByRole("button", { name: "新增個人行李", exact: true }).boundingBox()).height).toBeGreaterThanOrEqual(44); }
  });
  });
}

test("local drafts survive refetch, visibility/focus events and a reload without mixing Quick Add and editing", async ({ page }) => {
  await load(page, "?drafts=1");
  await quick(page).getByLabel("個人行李名稱", { exact: true }).fill("待新增外套");
  await choose(page, "個人行李分類", "衣物");
  await page.getByRole("button", { name: "編輯：護照", exact: true }).click();
  await page.getByLabel("編輯個人行李名稱", { exact: true }).fill("草稿護照及影本");
  await page.getByRole("button", { name: "模擬遠端重新載入", exact: true }).click();
  await page.evaluate(() => { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus")); });
  await expect(page.getByLabel("編輯個人行李名稱", { exact: true })).toHaveValue("草稿護照及影本");
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("travel-planner-draft:")).length)).toBe(2);
  page.once("dialog", dialog => dialog.accept()); await page.reload();
  await expect(inline(page)).toHaveCount(1);
  await expect(page.getByLabel("編輯個人行李名稱", { exact: true })).toHaveValue("草稿護照及影本");
  await expect(quick(page).getByLabel("個人行李名稱", { exact: true })).toHaveValue("待新增外套");
  await expect(quick(page).getByRole("combobox", { name: "個人行李分類", exact: true })).toHaveValue("衣物");
  await expect(quick(page, "共用物品")).toHaveCount(0);
  await page.getByLabel("編輯個人行李名稱", { exact: true }).press("Escape"); await discard(page);
  await expect(inline(page)).toHaveCount(0);
  await expect(quick(page).getByLabel("個人行李名稱", { exact: true })).toHaveValue("待新增外套");
});

test("legacy top-form new drafts migrate to Quick Add and two old row drafts reopen only one editor", async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("legacy-drafts-seeded")) return;
    sessionStorage.setItem("legacy-drafts-seeded", "yes");
    const put = (type, id, form, savedAt) => localStorage.setItem(`travel-planner-draft:owner:luggage-trip:${type}:${id}`, JSON.stringify({ form, savedAt, serverUpdatedAt: "2026-10-23T01:00:00.000Z" }));
    put("luggage_item", "new", { title: "舊新增草稿", category: "證件" }, "2026-10-23T02:00:00.000Z");
    put("shared_luggage_item", "shared", { title: "舊共用物品草稿", category: "團隊裝備", assigned_to: "packer" }, "2026-10-23T02:01:00.000Z");
  });
  await load(page, "?drafts=1");
  await expect(quick(page).getByLabel("個人行李名稱", { exact: true })).toHaveValue("舊新增草稿");
  await expect(page.getByLabel("編輯共用物品名稱", { exact: true })).toHaveValue("舊共用物品草稿");
  await expect(inline(page)).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem("travel-planner-draft:owner:luggage-trip:luggage_item:new"))).toBe(null);
  await page.evaluate(() => localStorage.setItem("travel-planner-draft:owner:luggage-trip:luggage_item:own", JSON.stringify({ form: { title: "舊個人草稿", category: "證件" }, savedAt: "2026-10-23T02:00:00.000Z", serverUpdatedAt: "2026-10-23T01:00:00.000Z" })));
  page.once("dialog", dialog => dialog.accept()); await page.reload();
  await expect(inline(page)).toHaveCount(1);
});

for (const competing of [false, true]) {
  test(`removed team Quick Add draft stays private and preserves competing draft: ${competing}`, async ({ page }) => {
    await page.addInitScript(({ competing }) => {
      const put = (type, form) => localStorage.setItem(`travel-planner-draft:owner:luggage-trip:${type}:new`, JSON.stringify({ form, savedAt: "2026-10-23T02:00:00.000Z", serverUpdatedAt: null }));
      put("shared_luggage_quick_add", { title: "尚未送出的共用物品", notes: "尚未公開的備註", category: "電子用品", assigned_to: "viewer" });
      if (competing) put("luggage_quick_add", { title: "既有私人物品草稿", notes: "私人備註", category: "衣物" });
    }, { competing });
    await load(page, "?drafts=1");
    await expect(quick(page).getByLabel("個人行李名稱", { exact: true })).toHaveValue(competing ? "既有私人物品草稿" : "尚未送出的共用物品");
    await expect(quick(page, "共用物品")).toHaveCount(0);
    const oldDraft = await page.evaluate(() => localStorage.getItem("travel-planner-draft:owner:luggage-trip:shared_luggage_quick_add:new"));
    if (competing) expect(oldDraft).toContain("尚未公開的備註");
    else expect(oldDraft).toBe(null);
    await expect(page.locator("#lb-shared").getByRole("button", { name: "編輯：尚未送出的共用物品", exact: true })).toHaveCount(0);
  });
}
