import { expect, test } from "@playwright/test";
import { backend, boot } from "./helpers/formalBudgetMock.js";

test("Formal member dialog preserves invite reuse and read-only member roles", async ({ page }) => {
  const db = backend();
  db.members.push(
    { id: "viewer", trip_id: "trip", user_id: "C", role: "viewer", status: "approved", display_name: "Viewer QA" },
    { id: "pending", trip_id: "trip", user_id: "D", role: "editor", status: "pending", display_name: "Pending QA" },
  );
  const invites = [];
  await page.exposeBinding("inviteRpc", (_, { p_action, p_trip_id }) => {
    expect(p_trip_id).toBe("trip");
    if (p_action === "rotate" || (p_action === "create" && !invites.length)) {
      invites.push({ token: crypto.randomUUID(), expires_at: new Date(Date.now() + 604800000).toISOString(), server_time: new Date().toISOString() });
    }
    return { data: invites.at(-1) || null, error: null };
  });
  await page.addInitScript(() => {
    window.copiedInvites = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (text) => { window.copiedInvites.push(text); } },
    });
  });
  await boot(page, db, "A", { waitForBudget: false });
  const installInviteRpc = () => page.evaluate(() => {
    const client = window.budgetMock.client;
    const rpc = client.rpc.bind(client);
    client.rpc = (name, args) => name === "manage_trip_invite" ? window.inviteRpc(args) : rpc(name, args);
  });

  await installInviteRpc();
  const openMembers = () => page.getByRole("button", { name: /^\d+ 位成員$/ }).click();
  const dialog = page.locator(".members-dialog");
  const closeMembers = () => dialog.getByRole("button", { name: "關閉", exact: true }).click();
  const inviteButton = (dialog) => dialog.getByRole("button", { name: "建立邀請連結", exact: true });
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
  const url = `${new URL(page.url()).origin}?invite=${invites[0].token}`;
  await expect(dialog.getByRole("textbox")).toHaveValue(url);
  await expect(dialog.locator("time")).toHaveAttribute("datetime", invites[0].expires_at);
  await dialog.getByRole("button", { name: "複製連結", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.copiedInvites)).toEqual([url]);
  await closeMembers();
  await openMembers();
  await expect(dialog.getByRole("textbox")).toHaveValue(url);
  await expect(dialog.getByText("邀請連結已複製。")).toHaveCount(0);
  expect(invites).toHaveLength(1);
  await dialog.getByRole("button", { name: "重新產生邀請連結" }).click();
  await expect.poll(() => invites.length).toBe(2);
  await expect(dialog.getByRole("textbox")).toHaveValue(`${new URL(page.url()).origin}?invite=${invites[1].token}`);
  await closeMembers();

  await page.reload();
  await expect(page.getByRole("button", { name: /^\d+ 位成員$/ })).toBeVisible();
  await installInviteRpc();
  await openMembers();
  await expect(dialog.getByRole("textbox")).toHaveValue(`${new URL(page.url()).origin}?invite=${invites[1].token}`);
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
  expect(invites).toHaveLength(2);
  expect(page.qaErrors).toEqual([]);
});
