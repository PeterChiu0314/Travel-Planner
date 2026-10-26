import { expect, test } from "@playwright/test";
import { luggageLengthError } from "../src/lib/luggageLimits.js";

test("length validation accepts the limits and preserves oversized restored content", () => {
  expect(luggageLengthError({ title: "物".repeat(30), notes: "註".repeat(100) })).toBe("");
  const restored = { title: "物".repeat(31), notes: "註".repeat(101) };
  expect(luggageLengthError(restored)).toContain("項目名稱最多 30 字");
  expect(luggageLengthError({ ...restored, title: "物" })).toContain("備註最多 100 字");
  expect(restored.title).toHaveLength(31);
  expect(restored.notes).toHaveLength(101);
});

for (const mode of ["個人", "共用"]) {
  test(`${mode} creation and editing enforce 30/100 limits`, async ({ page }) => {
    await page.goto("/tests/harness/luggage.html");
    await page.getByRole("button", { name: `新增類型：${mode}`, exact: true }).click();
    const kind = mode === "個人" ? "個人行李" : "共用物品";
    const name = page.getByLabel(`${kind}名稱`, { exact: true });
    const notes = page.getByLabel(`${kind}備註`, { exact: true });
    await expect(name).toHaveAttribute("maxlength", "30");
    await expect(notes).toHaveAttribute("maxlength", "100");
    await name.pressSequentially("物".repeat(31));
    await notes.pressSequentially("註".repeat(101));
    await expect(name).toHaveValue("物".repeat(30));
    await expect(notes).toHaveValue("註".repeat(100));
    await name.press("Enter");
    const label = mode === "個人" ? "編輯：" : "編輯指派共用物品：";
    await page.locator("#lb-personal").getByRole("button", { name: label + "物".repeat(30), exact: true }).click();
    const editName = page.getByLabel(`編輯${kind}名稱`, { exact: true });
    const editNotes = page.getByLabel(`編輯${kind}備註`, { exact: true });
    await expect(editName).toHaveAttribute("maxlength", "30");
    await expect(editNotes).toHaveAttribute("maxlength", "100");
    await expect(editName).toHaveValue("物".repeat(30));
    await expect(editNotes).toHaveValue("註".repeat(100));
  });
}
