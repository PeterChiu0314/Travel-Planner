import { expect, test } from "@playwright/test";
import { backend, boot } from "./helpers/formalBudgetMock.js";

test("Formal todo keeps its guide link and a stale guide edit keeps its draft", async ({ page }) => {
  const db = backend();
  const version = "2090-01-01T00:00:00Z";
  const todo = {
    id: "todo-qa", trip_id: "trip", title: "QA todo", description: "Original todo",
    completed: false, updated_at: version,
  };
  const guide = {
    id: "guide-qa", trip_id: "trip", title: "QA guide", description: "Original guide",
    url: "https://example.com/guide", updated_at: version,
  };
  db.rows.todo_items = [todo];
  db.rows.guide_items = [guide];

  const writes = [];
  const request = db.request.bind(db);
  db.request = (call) => {
    if (call.patch && ["guide_items", "todo_items"].includes(call.table)) writes.push(call);
    return request(call);
  };
  await boot(page, db, "A", { waitForBudget: false });
  await page.getByRole("navigation", { name: "功能導覽" }).getByRole("button", { name: "待辦指南" }).click();

  const todoPanel = page.locator(".todo-panel");
  await todoPanel.getByRole("button", { name: "編輯：QA todo" }).click();
  const todoForm = todoPanel.locator("form");
  await todoForm.getByLabel("說明", { exact: true }).fill("  Updated todo  ");
  await todoForm.getByLabel("連結指南", { exact: true }).selectOption(guide.id);
  await todoForm.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(todoForm).toHaveCount(0);
  await expect(todoPanel.locator(".todo-row")).toContainText(guide.title);
  expect(writes[1]).toMatchObject({
    table: "todo_items",
    patch: {
      trip_id: todo.trip_id, title: todo.title, description: "Updated todo",
      due_date: null, assignee_id: null, guide_id: guide.id,
    },
    filters: [["id", todo.id], ["trip_id", todo.trip_id], ["updated_at", version]],
  });
  expect(writes[2]).toMatchObject({
    patch: { locked_by: null, locked_at: null },
    filters: [["id", todo.id], ["locked_by", "A"]],
  });

  const completed = todoPanel.getByRole("checkbox", { name: "完成待辦：QA todo" });
  await completed.click();
  await expect(completed).toBeChecked();
  expect(todo.completed).toBe(true);
  expect(writes[3]).toMatchObject({
    table: "todo_items", patch: { completed: true }, filters: [["id", todo.id]],
  });

  const guidePanel = page.locator(".guide-panel");
  await guidePanel.getByRole("button", { name: "編輯：QA guide" }).click();
  const guideForm = guidePanel.locator("form");
  await guideForm.getByLabel("說明", { exact: true }).fill("Unsaved QA guide");
  guide.updated_at = "2090-01-02T00:00:00Z";
  await guideForm.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(guidePanel.getByRole("alert")).toContainText("此資料在你編輯期間已被其他人更新。");
  await expect(guideForm.getByLabel("說明", { exact: true })).toHaveValue("Unsaved QA guide");
  expect(writes[5]).toMatchObject({
    table: "guide_items",
    patch: { trip_id: guide.trip_id, title: guide.title, description: "Unsaved QA guide", url: guide.url },
    filters: [["id", guide.id], ["trip_id", guide.trip_id], ["updated_at", version]],
  });
  expect(writes).toHaveLength(6);
  expect(guide.description).toBe("Original guide");
  expect(guide.locked_by).toBe("A");
  expect(page.qaErrors).toEqual([]);
});
