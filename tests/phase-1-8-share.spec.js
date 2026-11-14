import { expect, test } from "@playwright/test";
import { backend, boot } from "./helpers/formalBudgetMock.js";

test("a valid share token shows the public snapshot in schedule order", async ({ page }) => {
  await page.route("**/rest/v1/rpc/get_share_snapshot", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ share_token: "fixture-token" });
    await route.fulfill({
      json: {
        trip: { title: "Public trip" },
        itinerary_items: [
          { id: "untimed", title: "Untimed visit", item_type: "visit", sort_order: 3 },
          { id: "later", title: "Later visit", item_type: "visit", start_time: "11:00", end_time: "12:00" },
          { id: "bus", title: "Bus transfer", item_type: "transport", start_time: "08:00", end_time: "08:30", sort_order: 2 },
          { id: "earlier", title: "Earlier visit", item_type: "visit", start_time: "09:00", end_time: "10:00" },
        ],
        accommodations: [{ id: "stay", name: "Public stay" }],
        guide_items: [{ id: "guide", title: "Public guide" }],
        budget_items: [{ title: "Private budget" }],
        luggage_items: [{ title: "Private luggage" }],
        actual_expenses: [{ title: "Private expense" }],
        settlements: [{ title: "Private settlement" }],
        trip_members: [{ display_name: "Private member" }],
      },
    });
  });

  await page.goto("/?share=fixture-token");
  const share = page.locator(".share-view");
  await expect(share.getByRole("heading", { level: 1 })).toHaveText("Public trip");
  await expect(share.getByRole("heading", { level: 2 })).toHaveText(["行程", "住宿", "指南"]);
  await expect(share.getByRole("heading", { level: 4 })).toHaveText([
    "Earlier visit", "Later visit", "Bus transfer", "Untimed visit", "Public stay", "Public guide",
  ]);
  await expect(share.getByText(/Private /)).toHaveCount(0);
  await expect(share.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "使用 Google 登入" })).toHaveCount(0);
});

test("owner manages the share link and an approved editor can copy it", async ({ page, context }) => {
  const db = backend();
  db.rows.share_links = [];
  await page.exposeBinding("insertShareLink", (_, row) => {
    db.rows.share_links.push({ id: "share-link", ...row });
    return { error: null };
  });
  const stubClipboard = (target) => target.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (text) => { window.copiedShareUrl = text; } },
    });
  });
  await stubClipboard(page);
  await boot(page, db, "A", { waitForBudget: false });
  await page.evaluate(() => {
    const client = window.budgetMock.client;
    const from = client.from.bind(client);
    client.from = (table) => {
      const query = from(table);
      if (table === "share_links") query.insert = (row) => window.insertShareLink(row);
      return query;
    };
  });

  await page.getByRole("button", { name: "唯讀分享" }).click();
  const ownerDialog = page.locator(".share-dialog");
  await ownerDialog.getByRole("button", { name: "建立並複製連結" }).click();
  await expect(ownerDialog.getByText("分享連結已啟用")).toBeVisible();
  const [link] = db.rows.share_links;
  const expectedUrl = `${new URL(page.url()).origin}?share=${link.token}`;
  await expect.poll(() => page.evaluate(() => window.copiedShareUrl)).toBe(expectedUrl);

  await ownerDialog.getByRole("button", { name: "停用", exact: true }).click();
  await expect(ownerDialog.getByText("分享連結已停用")).toBeVisible();
  await ownerDialog.getByRole("button", { name: "建立並複製連結" }).click();
  await expect(ownerDialog.getByText("分享連結已啟用")).toBeVisible();
  expect(db.rows.share_links).toEqual([{ ...link, is_active: true }]);

  const editor = await context.newPage();
  await stubClipboard(editor);
  await boot(editor, db, "B", { waitForBudget: false });
  await editor.getByRole("button", { name: "唯讀分享" }).click();
  const editorDialog = editor.locator(".share-dialog");
  await expect(editorDialog.getByRole("button")).toHaveText(["複製", "關閉"]);
  await editorDialog.getByRole("button", { name: "複製", exact: true }).click();
  await expect(editorDialog.getByRole("button", { name: "已複製" })).toBeVisible();
  expect(await editor.evaluate(() => window.copiedShareUrl)).toBe(expectedUrl);
  expect(db.reads.filter((read) => read.actor === "B" && read.table === "share_links" && read.patch)).toEqual([]);
});
