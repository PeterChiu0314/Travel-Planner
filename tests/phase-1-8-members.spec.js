import { expect, test } from "@playwright/test";
import { backend, boot } from "./helpers/formalBudgetMock.js";

test("Formal member dialog preserves invite reuse and read-only member roles", async ({ page }) => {
  const db = backend();
  db.members.push(
    { id: "viewer", trip_id: "trip", user_id: "C", role: "viewer", status: "approved", display_name: "Viewer QA" },
    { id: "pending", trip_id: "trip", user_id: "D", role: "editor", status: "pending", display_name: "Pending QA" },
  );
  const invites = [];
  await page.exposeBinding("insertInvite", (_, row) => {
    invites.push(row);
    return { error: null };
  });
  await page.addInitScript(() => {
    window.copiedInvites = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (text) => { window.copiedInvites.push(text); } },
    });
  });
  await boot(page, db, "A", { waitForBudget: false });
  await page.evaluate(() => {
    const client = window.budgetMock.client;
    const from = client.from.bind(client);
    client.from = (table) => {
      const query = from(table);
      if (table === "trip_invites") query.insert = (row) => window.insertInvite(row);
      return query;
    };
  });

  const openMembers = () => page.getByRole("button", { name: /^\d+ 位成員$/ }).click();
  const dialog = page.locator(".members-dialog");
  const closeMembers = () => dialog.getByRole("button", { name: "關閉", exact: true }).click();
  const inviteButton = (dialog) => dialog.getByRole("button", { name: "產生並複製連結", exact: true });
  await openMembers();
  const roleTrigger = dialog.getByRole("button", { name: "B 角色操作", exact: true });
  await expect(dialog.getByRole("button", { name: "核准", exact: true })).toBeVisible();
  await roleTrigger.click();
  await expect(dialog.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog.getByRole("menu")).toHaveCount(0);
  await roleTrigger.click();
  await dialog.getByRole("heading", { name: "成員與邀請", exact: true }).click();
  await expect(dialog.getByRole("menu")).toHaveCount(0);

  await inviteButton(dialog).click();
  await expect(dialog.getByText("邀請連結已複製。")).toBeVisible();
  expect(invites).toEqual([{ trip_id: "trip", token: expect.any(String) }]);
  const url = `${new URL(page.url()).origin}?invite=${invites[0].token}`;
  await expect(dialog.getByRole("textbox")).toHaveValue(url);
  await inviteButton(dialog).click();
  await expect.poll(() => page.evaluate(() => window.copiedInvites)).toEqual([url, url]);
  expect(invites).toHaveLength(1);
  await closeMembers();
  await openMembers();
  await expect(dialog.getByRole("textbox")).toHaveCount(0);
  await expect(dialog.getByText("邀請連結已複製。")).toHaveCount(0);
  expect(invites).toHaveLength(1);
  await closeMembers();

  for (const [actor, role] of [["B", "編輯者"], ["C", "檢視者"]]) {
    await page.evaluate((id) => window.budgetMock.switchAccount(id), actor);
    await expect(page.getByRole("button", { name: "帳號選單", exact: true })).toContainText(actor);
    await openMembers();
    await expect(dialog.getByText(`你目前是${role}。`, { exact: false })).toBeVisible();
    await expect(inviteButton(dialog)).toBeDisabled();
    await expect(dialog.getByRole("heading", { name: "待審核" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /角色操作/ })).toHaveCount(0);
    await expect(dialog.getByRole("textbox")).toHaveCount(0);
    await closeMembers();
  }
  expect(invites).toHaveLength(1);
  expect(page.qaErrors).toEqual([]);
});
