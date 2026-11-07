import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 1000 } });

for (const first of ["todo", "guide"]) {
  test(`${first} and its sibling retain independent drafts; leaving the page protects both`, async ({ page }) => {
    await page.goto("/demo/todo");
    const other = first === "todo" ? "guide" : "todo";
    const panels = {
      todo: page.locator(".todo-panel"),
      guide: page.locator(".guide-panel"),
    };
    const add = { todo: "新增待辦", guide: "新增指南" };
    await panels[first].getByRole("button", { name: add[first], exact: true }).click();
    await panels[first].locator("form").getByLabel("標題", { exact: true }).fill(`${first} unsaved`);
    await panels[other].getByRole("button", { name: add[other], exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "您有未儲存的變更" });
    await expect(dialog).toHaveCount(0);
    await expect(panels[first].locator("form").getByLabel("標題", { exact: true })).toHaveValue(`${first} unsaved`);
    await panels[other].locator("form").getByLabel("標題", { exact: true }).fill(`${other} unsaved`);
    await page.getByRole("navigation", { name: "Demo 導覽", exact: true }).getByRole("button", { name: "住宿資訊", exact: true }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "繼續編輯", exact: true }).click();
    for (const kind of [first, other]) {
      await expect(panels[kind].locator("form").getByLabel("標題", { exact: true })).toHaveValue(`${kind} unsaved`);
    }
    // Replacing an editor in its own domain still requires a decision.
    await panels[first].getByRole("button", { name: add[first], exact: true }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "繼續編輯", exact: true }).click();
    await page.getByRole("button", { name: "系統測試專用", exact: true }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "繼續編輯", exact: true }).click();
    for (const kind of [first, other]) {
      await expect(panels[kind].locator("form").getByLabel("標題", { exact: true })).toHaveValue(`${kind} unsaved`);
    }
    await page.getByRole("navigation", { name: "Demo 導覽", exact: true }).getByRole("button", { name: "住宿資訊", exact: true }).click();
    await dialog.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(panels.todo).toHaveCount(0);
    await page.getByRole("navigation", { name: "Demo 導覽", exact: true }).getByRole("button", { name: "待辦指南", exact: true }).click();
    for (const kind of [first, other]) {
      await expect(panels[kind].getByRole("button", { name: `編輯：${kind} unsaved`, exact: true })).toBeVisible();
    }
  });
}
