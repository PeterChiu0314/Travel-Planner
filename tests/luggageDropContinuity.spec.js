import { expect, test } from "@playwright/test";
import { luggageState, reassignmentDialog } from "./helpers/luggageDrag.js";

const fixture = "/tests/harness/luggage.html";
const row = (page, column, id) => page.locator(`#lb-${column} article[data-item-id="${id}"]`);
async function hoverBefore(page, column, sourceId, targetId) {
  const handle = row(page, column, sourceId).locator(".lb-drag-handle");
  await handle.scrollIntoViewIfNeeded(); const start = await handle.boundingBox();
  await page.mouse.move(start.x + 8, start.y + 10); await page.mouse.down();
  await page.mouse.move(start.x + 22, start.y + 18, { steps: 3 });
  const target = row(page, column, targetId); await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox(); await page.mouse.move(box.x + box.width * .7, box.y + 8, { steps: 10 });
  await expect(target).toHaveClass(/lb-insert-before/);
}
async function observeRelease(page, column, sourceId) {
  await page.evaluate(({ column, sourceId }) => {
    window.dropFrames = [];
    const expectedTop = document.querySelector(".lb-insertion-ghost")?.getBoundingClientRect().top;
    const start = performance.now();
    window.dropRecording = new Promise(resolve => {
      function frame() {
        const source = document.querySelector(`#lb-${column} article[data-item-id="${sourceId}"]`);
        const group = source?.closest(".lb-category-group,.lb-member-group");
        const state = JSON.parse(document.querySelector('[data-testid="luggage-canonical-state"]').textContent);
        window.dropFrames.push({ elapsed: performance.now() - start, dragging: Boolean(document.querySelector(".lb-drag-preview")),
          ids: [...(group?.querySelectorAll("article[data-item-id]") || [])].map(el => el.dataset.itemId),
          group: group?.getAttribute("aria-label"), hidden: source?.closest(".lb-sortable-slot")?.classList.contains("lb-source-collapsed"),
          top: source?.getBoundingClientRect().top, expectedTop,
          canonical: state[column === "personal" ? "luggageItems" : "sharedLuggageItems"].find(item => item.id === sourceId)?.sort_order });
        if (performance.now() - start < 750) requestAnimationFrame(frame); else resolve(window.dropFrames);
      }
      requestAnimationFrame(frame);
    });
  }, { column, sourceId });
  await page.mouse.up();
  return page.evaluate(() => window.dropRecording);
}

for (const width of [1440, 390]) {
  test(`${width}px releasing a reorder holds the insertion every frame until delayed persistence completes`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await page.goto(`${fixture}?empty=1&latency=500`);
    for (const title of ["第一件", "第二件", "第三件"]) {
      await page.getByLabel("個人行李名稱", { exact: true }).fill(title); await page.getByLabel("個人行李名稱", { exact: true }).press("Enter");
      await expect(page.getByLabel("個人行李名稱", { exact: true })).toHaveValue("");
    }
    const before = await luggageState(page), [a, b, c] = before.luggageItems;
    await hoverBefore(page, "personal", c.id, a.id);
    const frames = (await observeRelease(page, "personal", c.id)).filter(frame => !frame.dragging);
    expect(frames.length).toBeGreaterThan(10);
    expect(frames.some(frame => frame.elapsed > 100 && frame.canonical == null)).toBe(true);
    for (const frame of frames) { expect(frame.hidden).toBe(false); expect(frame.ids).toEqual([c.id, a.id, b.id]); expect(Math.abs(frame.top - frame.expectedTop)).toBeLessThanOrEqual(1); }
    const after = (await luggageState(page)).luggageItems;
    expect(after.find(item => item.id === c.id).sort_order).toBeLessThan(after.find(item => item.id === a.id).sort_order);
  });
}

test("same-carrier shared reorder keeps both projections at destination without resetting packing", async ({ page }) => {
  await page.goto(`${fixture}?actor=packer&latency=500`);
  await hoverBefore(page, "shared", "ready", "shared");
  const frames = (await observeRelease(page, "shared", "ready")).filter(frame => !frame.dragging);
  for (const frame of frames) expect(frame.ids).toEqual(["ready", "shared", "emergency"]);
  const personal = page.locator('#lb-personal .lb-public-group article[data-item-id]');
  expect(await personal.evaluateAll(els => els.map(el => el.dataset.itemId))).toEqual(["ready", "shared", "emergency"]);
  expect((await luggageState(page)).sharedLuggageItems.find(item => item.id === "ready").packed_by_assignee).toBe(true);
  await expect(reassignmentDialog(page)).toHaveCount(0);
});

test("cross-category row insertion holds destination while saving; failed save restores exact canonical state", async ({ page }) => {
  await page.goto(`${fixture}?long=1&latency=500`);
  const before = await luggageState(page); await page.getByRole("button", { name: "下一次操作失敗", exact: true }).click();
  await hoverBefore(page, "personal", "own", "long-0");
  const frames = (await observeRelease(page, "personal", "own")).filter(frame => !frame.dragging);
  const waiting = frames.filter(frame => frame.elapsed > 40 && frame.elapsed < 400);
  expect(waiting.length).toBeGreaterThan(5);
  for (const frame of waiting) { expect(frame.group).toBe("電子用品"); expect(frame.ids.indexOf("own")).toBeLessThan(frame.ids.indexOf("long-0")); }
  await expect(page.getByRole("alert").first()).toBeVisible();
  expect(await luggageState(page)).toEqual(before);
  await expect(page.locator('.lb-category-group[aria-label="隨身必備"] article[data-item-id="own"]')).toBeVisible();
});

test("cross-member insertion still waits for confirmation and cancellation never updates assignment or order", async ({ page }) => {
  await page.goto(`${fixture}?latency=500`); const before = await luggageState(page);
  await hoverBefore(page, "shared", "ready", "owner-assigned"); await page.mouse.up();
  await expect(reassignmentDialog(page)).toBeVisible();
  expect(await luggageState(page)).toEqual(before);
  await expect(page.locator('#lb-shared [data-member-id="packer"] article[data-item-id="ready"]')).toBeVisible();
  await page.keyboard.press("Escape"); expect(await luggageState(page)).toEqual(before);
});

test("category-header move remains at the destination while saving and returns keyboard focus after commit", async ({ page }) => {
  await page.goto(`${fixture}?long=1&latency=500`);
  const handle = row(page, "personal", "own").locator(".lb-drag-handle");
  await handle.scrollIntoViewIfNeeded();
  const start = await handle.boundingBox(); await page.mouse.move(start.x + 8, start.y + 10); await page.mouse.down();
  await page.mouse.move(start.x + 22, start.y + 18, { steps: 3 });
  const target = page.locator('.lb-category-group[aria-label="電子用品"]'); await target.locator("h4").scrollIntoViewIfNeeded(); const box = await target.boundingBox();
  await page.mouse.move(box.x + box.width * .7, box.y + 12, { steps: 10 }); await expect(target).toHaveClass(/is-drop-target/);
  const frames = (await observeRelease(page, "personal", "own")).filter(frame => !frame.dragging);
  for (const frame of frames) expect(frame.group).toBe("電子用品");
  expect((await luggageState(page)).luggageItems.find(item => item.id === "own").category).toBe("電子用品");
  await expect(handle).toBeFocused();
});
