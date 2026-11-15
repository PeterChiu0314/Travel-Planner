import { expect, test } from "@playwright/test";
import { backend, boot } from "./helpers/formalBudgetMock.js";

test("Formal sidebar keeps the empty trip entry, flyout and account actions connected", async ({ page }) => {
  const db = backend();
  db.members.splice(0);
  await boot(page, db, "A", { waitForBudget: false });

  const firstTrip = page.locator(".sidebar").getByRole("button", { name: /建立第一個旅程$/ });
  await expect(firstTrip).toBeVisible();
  await page.getByTitle("收合側欄", { exact: true }).click();
  const tripMenu = page.getByRole("button", { name: "我的旅程", exact: true });
  const flyout = page.locator("#sidebar-trips-flyout");
  await tripMenu.click();
  await expect(tripMenu).toHaveAttribute("aria-expanded", "true");
  await expect(flyout).toBeVisible();
  await page.getByRole("heading", { name: "開始安排下一趟旅程" }).click();
  await expect(flyout).toHaveCount(0);

  await tripMenu.click();
  await firstTrip.click();
  await expect(flyout).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "新增旅程", exact: true })).toBeVisible();
  await page.locator(".create-trip-dialog").getByRole("button", { name: "取消", exact: true }).click();

  const account = page.getByRole("button", { name: "帳號選單", exact: true });
  const menu = page.getByRole("menu", { name: "帳號選單", exact: true });
  await account.click();
  await page.getByRole("heading", { name: "開始安排下一趟旅程" }).click();
  await expect(menu).toHaveCount(0);
  await account.click();
  await menu.getByRole("menuitem", { name: "版本", exact: true }).click();
  const version = page.getByRole("dialog", { name: "旅程工房 | Travel Studio" });
  await expect(version).toBeVisible();
  await expect(menu).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(version).toHaveCount(0);

  await account.click();
  await menu.getByRole("menuitem", { name: "設定", exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator(".bottom-nav-button").filter({ hasText: "更多" })).toHaveClass(/\bactive\b/);
  await account.click();
  await menu.getByRole("menuitem", { name: "登出", exact: true }).click();
  await expect(page.getByRole("button", { name: "使用 Google 登入", exact: true })).toBeVisible();
  expect(page.qaErrors).toEqual([]);
});
