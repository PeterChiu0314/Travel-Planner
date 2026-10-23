import { expect, test } from "@playwright/test";
import { preparePaymentChange } from "../src/lib/budgetPayment.js";

// Browser plugin not available; exercise the project Playwright runner locally.
for (const width of [1440, 390]) {
  test(`${width}px luggage uses a site deletion dialog with safe keyboard focus`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const native = [], errors = [];
    page.on("dialog", async dialog => { native.push(dialog.message()); await dialog.dismiss(); });
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/demo/luggage");
    await expect(page).toHaveTitle(/旅程工房/);
    await page.getByRole("button", { name: "編輯：護照", exact: true }).click();
    const trigger = page.getByRole("button", { name: "刪除：護照", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "刪除物品？", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("此操作無法復原");
    await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "刪除", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.getByLabel("編輯個人行李名稱", { exact: true })).toHaveValue("護照");
    await trigger.click();
    expect((await dialog.boundingBox()).width).toBeLessThanOrEqual(width);
    await dialog.getByRole("button", { name: "刪除", exact: true }).click();
    await expect(page.getByRole("button", { name: "編輯：護照", exact: true })).toHaveCount(0);
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    expect(native).toEqual([]); expect(errors).toEqual([]);
  });
}

test("budget discard and deletion cancel without native prompts or data loss", async ({ page }) => {
  const native = []; page.on("dialog", async dialog => { native.push(dialog.message()); await dialog.dismiss(); });
  await page.goto("/demo/budget");
  await page.getByRole("button", { name: "新增預算", exact: true }).click();
  const form = page.getByRole("form", { name: "預算編輯", exact: true });
  await form.getByLabel("項目", { exact: true }).fill("未儲存草稿");
  await form.getByRole("button", { name: "取消", exact: true }).click();
  const discard = page.getByRole("dialog", { name: "放棄尚未儲存的變更？", exact: true });
  await discard.getByRole("button", { name: "取消", exact: true }).click();
  await expect(form.getByLabel("項目", { exact: true })).toHaveValue("未儲存草稿");
  await form.getByRole("button", { name: "取消", exact: true }).click();
  await discard.getByRole("button", { name: "放棄變更", exact: true }).click();
  await expect(form).toHaveCount(0);
  await page.getByRole("tab", { name: "項目明細", exact: true }).click();
  await page.locator(".bw-row").first().getByRole("button").first().click();
  await page.getByRole("button", { name: "刪除項目", exact: true }).click();
  const deletion = page.getByRole("dialog", { name: "刪除項目？", exact: true });
  await deletion.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.locator(".bw-row")).toHaveCount(32);
  expect(native).toEqual([]);
});

test("Demo reset and attachment validation use site notices", async ({ page }) => {
  const native = []; page.on("dialog", async dialog => { native.push(dialog.message()); await dialog.dismiss(); });
  await page.goto("/demo/budget?budgetTools=1");
  await page.getByRole("button", { name: "重設預算案例", exact: true }).click();
  await page.getByRole("dialog", { name: "重設 Demo 預算？", exact: true }).getByRole("button", { name: "取消", exact: true }).click();
  await page.locator(".bw-row").first().getByRole("button").first().click();
  await page.locator('.attachment-list input[type="file"]').first().setInputFiles({ name: "bad.txt", mimeType: "text/plain", buffer: Buffer.from("invalid") });
  const notice = page.getByRole("dialog", { name: "無法上傳附件", exact: true });
  await expect(notice).toContainText("JPG、PNG、WebP 或 PDF");
  await notice.getByRole("button", { name: "確定", exact: true }).click();
  expect(native).toEqual([]);
});

test("legacy payment removal requests the site confirmation and fails closed without it", async () => {
  const props = { actualExpenses: [{ id: "payment", budget_item_id: "budget", title: "人工付款", twd_amount: 100 }], useEditLocks: false };
  await expect(preparePaymentChange(props, "budget", false)).rejects.toThrow("缺少網站確認介面");
  let prompt;
  expect(await preparePaymentChange({ ...props, ask: async options => { prompt = options; return false; } }, "budget", false)).toBe(null);
  expect(prompt.message).toContain("人工付款");
  expect(await preparePaymentChange({ ...props, ask: async () => true }, "budget", false)).toMatchObject({ payment_action: "unpaid", payment_confirmed: true });
});
