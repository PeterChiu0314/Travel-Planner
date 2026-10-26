import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 1000 } });
const fixture = "/tests/harness/luggage.html";

for (const [label, kind, id, section] of [["編輯：護照", "個人行李", "own", "lb-personal"], ["編輯指派共用物品：團隊文件", "共用物品", "owner-assigned", "lb-personal"], ["編輯：團隊相機", "共用物品", "ready", "lb-shared"]]) {
  test(`${label}: overflow expands only the editor and saving restores the compact row`, async ({ page }) => {
    await page.goto(fixture);
    const edit = page.getByRole("button", { name: label, exact: true });
    const row = page.locator(`#${section} article[data-item-id="${id}"]`);
    const initialHeight = (await row.boundingBox()).height;
    await edit.click();
    const form = row.getByRole("form");
    const name = form.getByLabel(`編輯${kind}名稱`, { exact: true });
    const notes = form.getByLabel(`編輯${kind}備註`, { exact: true });
    await name.fill("長名稱".repeat(10));
    await expect(form).toHaveClass(/lb-editor-stacked/);
    expect((await row.boundingBox()).height).toBeGreaterThan(initialHeight);
    expect((await notes.boundingBox()).y).toBeGreaterThan((await name.boundingBox()).y);
    expect((await name.boundingBox()).width).toBeGreaterThan((await form.boundingBox()).width * .65);
    await expect(name).toBeFocused();
    await name.fill("短名");
    await notes.fill("");
    await expect(form).not.toHaveClass(/lb-editor-stacked/);
    await notes.fill("詳細備註".repeat(25));
    await expect(form).toHaveClass(/lb-editor-stacked/);
    await expect(notes).toBeFocused();
    await notes.press("Enter");
    await expect(form).toHaveCount(0);
    expect((await row.boundingBox()).height).toBe(initialHeight);
    const noteButton = row.locator(".lb-item-notes");
    expect(await noteButton.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
    await row.getByRole("button", { name: /編輯.*：短名/, exact: true }).first().click();
    await expect(row.getByRole("form")).toHaveClass(/lb-editor-stacked/);
    await notes.press("Escape");
    await expect(row.getByRole("form")).toHaveCount(0);
    expect((await row.boundingBox()).height).toBe(initialHeight);
  });
}

test("resizing re-evaluates the original column widths without oscillating or losing focus", async ({ page }) => {
  await page.setViewportSize({ width: 1900, height: 1000 });
  await page.goto(fixture);
  await page.getByRole("button", { name: "編輯：護照", exact: true }).click();
  const form = page.locator(".lb-inline-editor");
  const name = form.getByLabel("編輯個人行李名稱", { exact: true });
  await name.fill("護照及影本與備用證件出發前確認效期");
  await expect(form).not.toHaveClass(/lb-editor-stacked/);
  await page.setViewportSize({ width: 1100, height: 1000 });
  await expect(form).toHaveClass(/lb-editor-stacked/);
  await expect(name).toBeFocused();
  const classes = await form.evaluate(async node => {
    const result = [];
    for (let i = 0; i < 10; i++) { await new Promise(requestAnimationFrame); result.push(node.classList.contains("lb-editor-stacked")); }
    return result;
  });
  expect(classes.every(Boolean)).toBe(true);
  await page.setViewportSize({ width: 1900, height: 1000 });
  await expect(form).not.toHaveClass(/lb-editor-stacked/);
});
