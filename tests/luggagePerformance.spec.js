import { expect, test } from "@playwright/test";

// Keep the real Demo's cross-category drag from returning to a full-list
// measuring/render loop. Count expensive style reads rather than asserting FPS,
// which depends on the machine and how many test workers are running.
test("real Demo cross-category dragging avoids repeated full-list style measurement", async ({ page }) => {
  await page.setViewportSize({ width: 1456, height: 1400 }); await page.goto("/demo/luggage");
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  const handle = await page.getByRole("button", { name: "移動分類：護照", exact: true }).boundingBox();
  await page.evaluate(() => {
    window.luggageStyleReads = 0; window.luggagePerfTargets = new Set();
    const original = window.getComputedStyle;
    window.getComputedStyle = function (...args) { window.luggageStyleReads++; return original.apply(this, args); };
  });
  await page.mouse.move(handle.x + 10, handle.y + 16); await page.mouse.down();
  await page.mouse.move(handle.x + 24, handle.y + 24, { steps: 3 });
  await expect(page.locator(".lb-drag-preview")).toBeVisible();
  const targets = ["信用卡", "充電器", "行動電源", "相機", "現金錢包", "薄外套", "登機證"];
  for (let step = 0; step < 28; step++) {
    const title = targets[step % targets.length];
    const target = await page.getByRole("button", { name: `移動分類：${title}`, exact: true }).locator("..").boundingBox();
    await page.mouse.move(target.x + target.width * .65, target.y + 10);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => {
      const group = document.querySelector(".lb-insert-before,.lb-insert-after")?.closest(".lb-category-group");
      if (group) window.luggagePerfTargets.add(group.getAttribute("aria-label")); resolve();
    })));
  }
  const metrics = await page.evaluate(() => ({ styleReads: window.luggageStyleReads, categories: [...window.luggagePerfTargets] }));
  expect(metrics.categories.length).toBeGreaterThanOrEqual(3);
  expect(metrics.styleReads).toBeLessThan(30000);
  await test.info().attach("cross-category-measurement-budget", { body: JSON.stringify(metrics), contentType: "application/json" });
  if (process.env.LUGGAGE_PERF_SCREENSHOT) await page.screenshot({ path: process.env.LUGGAGE_PERF_SCREENSHOT });
  await page.keyboard.press("Escape"); await page.mouse.up();
  await expect(page.locator(".lb-drag-preview")).toHaveCount(0); expect(errors).toEqual([]);
});
