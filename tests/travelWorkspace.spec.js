import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

test.use({ viewport: { width: 1440, height: 1000 } });
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-22T12:00:00+08:00") });
});
const navigate = (page, name) => page.getByRole("navigation", { name: "Demo 導覽", exact: true }).getByRole("button", { name, exact: true }).click();

test("company budget workspace remains authoritative alongside all four enabled pages", async ({ page }) => {
  await page.goto("/demo/budget");
  await expect(page.getByRole("table", { name: "預算明細", exact: true })).toBeVisible();
  await expect(page.locator(".bw-row")).toHaveCount(32);
  await expect(page.getByLabel("旅程費用摘要")).toContainText("174,851");
  for (const name of ["住宿資訊", "待辦指南", "行李清單", "分帳結算"]) {
    await expect(page.getByRole("navigation", { name: "Demo 導覽", exact: true }).getByRole("button", { name, exact: true })).toBeEnabled();
  }
  if (process.env.WORKSPACE_QA_DIR) {
    mkdirSync(process.env.WORKSPACE_QA_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.WORKSPACE_QA_DIR, "budget-desktop.png") });
  }
});

test("accommodation search, detail selection and CRUD preserve booking fields", async ({ page }) => {
  await page.goto("/demo/accommodation");
  const list = page.locator(".accommodation-list");
  const detail = page.locator(".accommodation-detail");
  await list.getByRole("button", { name: /旅程備選住宿/ }).click();
  await expect(detail.getByRole("heading", { name: "旅程備選住宿", exact: true })).toBeVisible();
  await page.getByLabel("搜尋住宿", { exact: true }).fill("京都車站");
  await expect(list.getByRole("button")).toHaveCount(1);
  await page.getByLabel("搜尋住宿", { exact: true }).fill("無符合項目");
  await expect(list).toContainText("沒有符合條件的住宿");
  await expect(page.locator(".travel-workspace-summary")).toContainText("2 間");
  await page.getByLabel("搜尋住宿", { exact: true }).fill("");
  await page.getByRole("button", { name: "新增住宿", exact: true }).click();
  let form = page.locator(".accommodation-form");
  await form.getByLabel("住宿名稱", { exact: true }).fill("新預覽旅館");
  await form.getByLabel("預約代碼", { exact: true }).fill("BOOK-123");
  await form.getByLabel("入住時間", { exact: true }).fill("16:30");
  await form.getByLabel("付款狀態", { exact: true }).selectOption("partial");
  await form.getByLabel("連動預算", { exact: true }).selectOption("demo-budget-hotel");
  await form.getByLabel("自訂備註", { exact: true }).fill("晚到需先聯絡\n保留行李寄放資訊");
  await form.getByRole("button", { name: "儲存", exact: true }).click();
  await list.getByRole("button", { name: /新預覽旅館/ }).click();
  await expect(detail).toContainText("BOOK-123");
  await expect(detail).toContainText("16:30");
  await expect(detail).toContainText("部分付款");
  await expect(detail).toContainText("京都山科山樂酒店");
  await detail.getByRole("button", { name: "編輯：新預覽旅館", exact: true }).click();
  form = page.locator(".accommodation-form");
  await expect(form.getByLabel("預約代碼", { exact: true })).toHaveValue("BOOK-123");
  await form.getByLabel("住宿名稱", { exact: true }).fill("改名旅館");
  await form.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(detail.getByRole("heading", { name: "改名旅館", exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "刪除：改名旅館", exact: true }).click();
  await expect(list.getByRole("button")).toHaveCount(2);
});

test("todo completion, filtering, linked guides and CRUD stay usable", async ({ page }) => {
  await page.goto("/demo/todo");
  const panel = page.locator(".todo-panel");
  await page.getByRole("checkbox", { name: "完成待辦：申請旅遊保險", exact: true }).check();
  await expect(page.getByRole("progressbar", { name: "準備進度", exact: true })).toHaveAttribute("value", "2");
  await panel.getByRole("button", { name: "未完成", exact: true }).click();
  await expect(panel.locator(".todo-row")).toHaveCount(1);
  await page.getByLabel("搜尋待辦", { exact: true }).fill("不存在");
  await expect(panel).toContainText("沒有符合條件的待辦");
  await page.getByLabel("搜尋待辦", { exact: true }).fill("");
  await panel.getByRole("button", { name: "全部", exact: true }).click();
  await panel.getByRole("button", { name: "新增待辦", exact: true }).click();
  let form = panel.locator("form");
  await form.getByLabel("標題", { exact: true }).fill("確認交通票券");
  await form.getByLabel("負責人", { exact: true }).selectOption("demo-a");
  await form.getByLabel("連結指南", { exact: true }).selectOption("demo-guide-1");
  await form.getByLabel("說明", { exact: true }).fill("確認使用日期與範圍");
  await form.getByRole("button", { name: "儲存", exact: true }).click();
  const row = panel.locator(".todo-row").filter({ hasText: "確認交通票券" });
  await expect(row).toContainText("Dennis");
  await expect(row).toContainText("京都車站資訊");
  await row.getByRole("button", { name: "編輯：確認交通票券", exact: true }).click();
  form = panel.locator("form");
  await expect(form.getByLabel("負責人", { exact: true })).toHaveValue("demo-a");
  await form.getByLabel("說明", { exact: true }).fill("確認完畢");
  await form.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(row).toContainText("確認完畢");
  await row.getByRole("button", { name: "刪除：確認交通票券", exact: true }).click();
  await expect(row).toHaveCount(0);
  const guide = page.locator(".guide-panel");
  await guide.getByRole("button", { name: "新增指南", exact: true }).click();
  await guide.locator("form").getByLabel("標題", { exact: true }).fill("票券使用說明");
  await guide.locator("form").getByLabel("URL", { exact: true }).fill("https://example.com/ticket");
  await guide.getByRole("button", { name: "儲存", exact: true }).click();
  let card = guide.locator(".guide-card").filter({ hasText: "票券使用說明" });
  await expect(card.getByRole("link", { name: "開啟連結" })).toHaveAttribute("href", "https://example.com/ticket");
  await card.getByRole("button", { name: "編輯：票券使用說明", exact: true }).click();
  await guide.locator("form").getByLabel("說明", { exact: true }).fill("已更新說明");
  await guide.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(card).toContainText("已更新說明");
  await card.getByRole("button", { name: "刪除：票券使用說明", exact: true }).click();
  await expect(card).toHaveCount(0);
});

test("luggage CRUD and assignee packing remain separate from owner confirmation", async ({ page }) => {
  await page.goto("/demo/luggage");
  const personal = page.locator(".luggage-column").first();
  const team = page.locator(".luggage-column").last();
  await personal.getByLabel("個人行李名稱", { exact: true }).fill("旅行轉接頭");
  await personal.getByRole("combobox", { name: "個人行李分類", exact: true }).fill("電子用品");
  await personal.getByRole("button", { name: "新增個人行李", exact: true }).click();
  await expect(personal.getByLabel("個人行李名稱", { exact: true })).toHaveValue("");
  await page.getByRole("checkbox", { name: "打包：旅行轉接頭", exact: true }).check();
  await expect(page.getByRole("progressbar", { name: "我的打包進度", exact: true })).toHaveAttribute("aria-valuenow", "2");
  await personal.getByRole("button", { name: "編輯：旅行轉接頭", exact: true }).click();
  await expect(personal.getByRole("combobox", { name: "個人行李分類", exact: true })).toHaveValue("電子用品");
  await personal.getByLabel("個人行李名稱", { exact: true }).fill("兩孔轉接頭");
  await personal.getByRole("button", { name: "儲存個人行李", exact: true }).click();
  page.once("dialog", dialog => dialog.accept());
  await personal.getByRole("button", { name: "刪除：兩孔轉接頭", exact: true }).click();
  await team.getByLabel("團隊公物名稱", { exact: true }).fill("雨備地墊");
  await team.getByRole("combobox", {name: "指派公物負責人",exact:true}).click();
  await page.getByRole("option", {name: "Peter（我）",exact:true}).click();
  await team.getByRole("button", { name: "新增團隊公物", exact: true }).click();
  const shared = team.locator(".shared-luggage-row").filter({ hasText: "雨備地墊" });
  await shared.getByRole("checkbox", { name: "成員已打包：雨備地墊", exact: true }).check();
  await expect(shared.getByRole("checkbox", { name: "總召確認：雨備地墊", exact: true })).not.toBeChecked();
  await expect(personal.locator(".assigned-shared-list").filter({ hasText: "雨備地墊" }).getByRole("checkbox").last()).toBeChecked();
  await shared.getByRole("checkbox", { name: "總召確認：雨備地墊", exact: true }).check();
  await expect(personal.locator(".shared-assigned").filter({ hasText: "雨備地墊" })).toContainText("總召已確認");
  await shared.getByRole("button", { name: "編輯：雨備地墊", exact: true }).click();
  await team.getByLabel("團隊公物名稱", { exact: true }).fill("變更尚未儲存");
  await team.getByRole("button", { name: "取消編輯團隊公物", exact: true }).click();
  await page.getByRole("dialog", { name: "您有未儲存的變更", exact: true }).getByRole("button", { name: "不儲存", exact: true }).click();
  await expect(shared).toBeVisible();
  page.once("dialog", dialog => dialog.accept());
  await shared.getByRole("button", { name: "刪除：雨備地墊", exact: true }).click();
  await expect(shared).toHaveCount(0);
});

test("settlement retains latest payment propagation and frozen departure baseline", async ({ page }) => {
  await page.goto("/demo/settlement?budgetTools=1");
  const summary = page.locator(".travel-workspace-summary");
  await expect(summary).not.toContainText("出發前預算");
  await expect(page.locator(".settlement-row")).toHaveCount(6);
  const amountBefore = await summary.textContent();
  await navigate(page, "預算管理");
  const lunch = page.locator(".bw-row").filter({ has: page.getByRole("button", { name: "Day 1・關西機場午餐", exact: true }) });
  await lunch.getByRole("button", { name: "Day 1・關西機場午餐", exact: true }).click();
  await page.getByRole("button", { name: "付款狀態", exact: true }).click();
  await expect(lunch).toContainText("已付款");
  await navigate(page, "分帳結算");
  await expect(summary).not.toHaveText(amountBefore);
  // Section navigation intentionally returns to the default UI without opt-in Demo tools.
  await page.goto("/demo/settlement?budgetTools=1");
  await page.getByRole("combobox", { name: "Demo 情境", exact: true }).click();
  await page.getByRole("option", { name: "旅程結算", exact: true }).click();
  await expect(summary).toContainText("出發前預算");
  await expect(summary).toContainText("NT$ 174,851");
  const frozen = await summary.locator("div").first().textContent();
  await navigate(page, "預算管理");
  await page.getByRole("tab", { name: "預算", exact: true }).click();
  await expect(page.locator(".bw-row")).toHaveCount(32);
  await navigate(page, "分帳結算");
  await expect(summary.locator("div").first()).toHaveText(frozen);
  await expect(page.locator(".transfer-row")).not.toHaveCount(0);
});

for (const entry of [
  { route: "accommodation", name: "住宿資訊", edit: "京都車站旅館", scope: ".accommodation-form", field: "住宿名稱" },
  { route: "todo", name: "待辦指南", edit: "申請旅遊保險", scope: ".todo-panel form", field: "標題" },
  { route: "todo", name: "待辦指南", edit: "京都車站資訊", scope: ".guide-panel form", field: "標題" },
  { route: "luggage", name: "行李清單", edit: "護照", scope: ".luggage-column:first-child form", field: "個人行李名稱" },
]) {
  test(`${entry.route} ${entry.edit} protects navigation and keeps support data isolated by trip`, async ({ page }) => {
    await page.goto(`/demo/${entry.route}`);
    await page.getByRole("button", { name: `編輯：${entry.edit}`, exact: true }).click();
    const field = page.locator(entry.scope).getByLabel(entry.field, { exact: true });
    const updated = `${entry.edit}・整合測試`;
    await field.fill(updated);
    await navigate(page, "預算管理");
    const guard = page.getByRole("dialog", { name: "您有未儲存的變更" });
    await expect(guard).toBeVisible();
    await expect(field).toHaveValue(updated);
    await guard.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(page.locator(".bw-row")).toHaveCount(32);
    await navigate(page, entry.name);
    await expect(page.getByRole("button", { name: `編輯：${updated}`, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "系統測試專用", exact: true }).click();
    await expect(page.getByRole("button", { name: `編輯：${updated}`, exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "京都琵琶湖之旅-TEST", exact: true }).click();
    await expect(page.getByRole("button", { name: `編輯：${updated}`, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: `編輯：${entry.edit}`, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: `編輯：${updated}`, exact: true })).toHaveCount(0);
  });
}

for (const route of ["accommodation", "todo", "luggage", "settlement"]) {
  test(`${route} desktop layout and demo infrastructure isolation`, async ({ page }) => {
    const failures = [], requests = [];
    page.on("pageerror", (error) => failures.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") failures.push(message.text()); });
    page.on("request", (request) => { if (/^https?:\/\/[^/]*supabase|\/(auth|rest|storage|realtime)\/v1\//i.test(request.url())) requests.push(request.url()); });
    await page.goto(`/demo/${route}`);
    await expect(page.locator(route === "luggage" ? ".lb-heading" : ".travel-workspace-heading")).toBeVisible();
    for (const size of [{ width: 1280, height: 720 }, { width: 1440, height: 1000 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(size);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      expect(await page.locator(".travel-workspace").evaluate((root) => Array.from(root.querySelectorAll("input,select,button")).filter((el) => el.getBoundingClientRect().width > 0).every((el) => el.getBoundingClientRect().right <= document.documentElement.clientWidth))).toBe(true);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    if (process.env.WORKSPACE_QA_DIR) {
      mkdirSync(process.env.WORKSPACE_QA_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.WORKSPACE_QA_DIR, `${route}-desktop.png`), fullPage: true });
    }
    if (route === "accommodation") {
      await page.getByRole("button", { name: "編輯：京都車站旅館", exact: true }).click();
      await page.locator("form").getByLabel("住宿名稱", { exact: true }).fill("僅本機輸入");
    } else if (route === "todo") {
      await page.getByRole("button", { name: "編輯：申請旅遊保險", exact: true }).click();
      await page.locator(".todo-panel form").getByLabel("標題", { exact: true }).fill("僅本機輸入");
    } else if (route === "luggage") {
      await page.getByRole("button", { name: "編輯：護照", exact: true }).click();
      await page.getByPlaceholder("新增個人行李", { exact: true }).fill("僅本機輸入");
    }
    await page.clock.runFor(700); // Exceeds the autosave debounce to detect accidental draft writes.
    expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => /draft|lock/i.test(key)))).toEqual([]);
    expect(requests).toEqual([]);
    expect(failures).toEqual([]);
  });
}
