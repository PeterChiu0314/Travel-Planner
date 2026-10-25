import { expect, test } from "@playwright/test";
import { luggageState } from "./helpers/luggageDrag.js";

for (const width of [1456, 390]) {
  test(`${width}px pickup has no insertion bounce, origin frame or scroll jump`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await page.goto("/demo/luggage");
    const handle = page.getByRole("button", { name: "移動分類：現金錢包", exact: true });
    await handle.evaluate(el => el.scrollIntoView({ block: "center" }));
    const point = await handle.boundingBox();
    await page.evaluate(() => {
      const list = document.querySelector("#lb-personal .lb-list-body");
      const heading = [...document.querySelectorAll(".lb-category-group")].find(el => el.getAttribute("aria-label") === "證件").querySelector("h4");
      const follower = [...document.querySelectorAll("#lb-personal .lb-private-row")].find(el => el.textContent.includes("信用卡"));
      const nextHeading = [...document.querySelectorAll(".lb-category-group")].find(el => el.getAttribute("aria-label") === "電子用品").querySelector("h4");
      const origin = heading.parentElement;
      const sourceSlot = [...document.querySelectorAll("#lb-personal .lb-private-row")].find(el => el.textContent.includes("現金錢包")).parentElement;
      const lowerRows = [...document.querySelectorAll("#lb-personal .lb-private-row")].filter(el => ["充電器", "行動電源", "手機充電線"].some(name => el.querySelector(".lb-item-name")?.textContent === name));
      window.pickupFrames = [];
      const start = performance.now();
      window.pickupRecording = new Promise(resolve => {
        function frame() {
          window.pickupFrames.push({ elapsed: performance.now() - start, top: heading.getBoundingClientRect().top, follower: follower.getBoundingClientRect().top,
            next: nextHeading.getBoundingClientRect().top, sourceHeight: sourceSlot.getBoundingClientRect().height,
            lower: lowerRows.map(el => el.getBoundingClientRect().top), scroll: list.scrollTop, ghost: list.querySelectorAll(".lb-insertion-ghost").length,
            highlight: origin.classList.contains("is-drop-target") });
          if (performance.now() - start < 600) requestAnimationFrame(frame); else resolve(window.pickupFrames);
        }
        frame();
      });
    });
    await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2); await page.mouse.down();
    await page.mouse.move(point.x + point.width / 2 + 12, point.y + point.height / 2 + 8, { steps: 3 });
    await expect(page.locator(".lb-drag-preview")).toBeVisible();
    const frames = await page.evaluate(() => window.pickupRecording);
    for (const frame of frames) {
      expect(frame.ghost).toBe(0); expect(frame.highlight).toBe(false);
      expect(Math.abs(frame.top - frames[0].top)).toBeLessThanOrEqual(.5);
      expect(Math.abs(frame.scroll - frames[0].scroll)).toBeLessThanOrEqual(.5);
      expect(frame.sourceHeight).toBe(frames[0].sourceHeight);
      expect(Math.abs(frame.follower - frames[0].follower)).toBeLessThanOrEqual(.5);
      expect(Math.abs(frame.next - frames[0].next)).toBeLessThanOrEqual(.5);
      frame.lower.forEach((top, i) => expect(Math.abs(top - frames[0].lower[i])).toBeLessThanOrEqual(.5));
    }
    await page.keyboard.press("Escape"); await page.mouse.up();
  });
}

for (const width of [1440, 390]) {
  test(`${width}px pickup and first insertion transfer one space without a lower-list bounce`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await page.goto("/tests/harness/luggage.html?empty=1");
    for (const title of ["A", "B", "C", "D"]) {
      const input = page.getByLabel("個人行李名稱", { exact: true }); await input.fill(title); await input.press("Enter");
    }
    const before = await luggageState(page), [, sourceItem, targetItem, lowerItem] = before.luggageItems;
    const row = id => page.locator(`#lb-personal article[data-item-id="${id}"]`);
    const handle = row(sourceItem.id).locator(".lb-drag-handle"); const point = await handle.boundingBox();
    await page.evaluate(({ source, target, lower }) => {
      const sourceSlot = document.querySelector(`article[data-item-id="${source}"]`).parentElement;
      const targetSlot = document.querySelector(`article[data-item-id="${target}"]`).parentElement;
      const follower = document.querySelector(`article[data-item-id="${lower}"]`);
      window.transferFrames = [];
      window.transferRecording = true;
      const sample = () => {
        window.transferFrames.push({ lower: follower.getBoundingClientRect().top,
          space: sourceSlot.getBoundingClientRect().height + targetSlot.getBoundingClientRect().height,
          source: sourceSlot.getBoundingClientRect().height, ghosts: document.querySelectorAll(".lb-insertion-ghost").length });
        if (window.transferRecording) requestAnimationFrame(sample);
      };
      sample();
    }, { source: sourceItem.id, target: targetItem.id, lower: lowerItem.id });
    await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2); await page.mouse.down();
    await page.mouse.move(point.x + point.width / 2 + 12, point.y + point.height / 2 + 8, { steps: 3 });
    await expect(page.locator(".lb-drag-preview")).toBeVisible();
    // Capture the previously failing pause: pickup must leave all lower rows still.
    await page.evaluate(() => new Promise(resolve => { let count = 0; const frame = () => ++count === 18 ? resolve() : requestAnimationFrame(frame); requestAnimationFrame(frame); }));
    if (process.env.LUGGAGE_FEEDBACK_SCREENSHOT) await page.screenshot({ path: `${process.env.LUGGAGE_FEEDBACK_SCREENSHOT}-pickup-${width}.png` });
    const target = await row(targetItem.id).boundingBox();
    await page.mouse.move(target.x + target.width * .7, target.y + target.height * .25, { steps: 10 });
    await expect(row(targetItem.id)).toHaveClass(/lb-insert-before/);
    await expect.poll(() => row(sourceItem.id).locator("..").evaluate(el => el.getBoundingClientRect().height)).toBe(0);
    const frames = await page.evaluate(() => { window.transferRecording = false; return window.transferFrames; });
    expect(frames.length).toBeGreaterThan(20);
    expect(frames.some(frame => frame.source > 1 && frame.source < frames[0].source - 1)).toBe(true);
    for (const frame of frames) {
      expect(Math.abs(frame.lower - frames[0].lower)).toBeLessThanOrEqual(1);
      expect(Math.abs(frame.space - frames[0].space)).toBeLessThanOrEqual(1);
      expect(frame.ghosts).toBeLessThanOrEqual(1);
    }
    await expect(row(sourceItem.id)).not.toBeVisible();
    await expect(row(sourceItem.id).locator("..").locator(".lb-insertion-ghost")).toHaveCount(0);
    if (process.env.LUGGAGE_FEEDBACK_SCREENSHOT) await page.screenshot({ path: `${process.env.LUGGAGE_FEEDBACK_SCREENSHOT}-insert-${width}.png` });
    await page.keyboard.press("Escape"); await page.mouse.up(); expect(await luggageState(page)).toEqual(before);
  });
}

test("same-category insertion has a ghost but no group frame; another category still highlights", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto("/tests/harness/luggage.html?long=1");
  const before = await luggageState(page);
  const handle = page.getByRole("button", { name: "移動分類：長清單物品 1", exact: true }); await handle.scrollIntoViewIfNeeded();
  const start = await handle.boundingBox(); await page.mouse.move(start.x + 8, start.y + 10); await page.mouse.down();
  await page.mouse.move(start.x + 22, start.y + 18, { steps: 3 });
  await expect(page.locator(".lb-drag-preview")).toBeVisible();
  const target = page.locator('#lb-personal article[data-item-id="long-2"]');
  await page.locator("#lb-personal .lb-list-content").evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));
  await target.scrollIntoViewIfNeeded(); const box = await target.boundingBox();
  await page.mouse.move(box.x + box.width * .7, box.y + box.height * .75, { steps: 10 });
  await expect(target).toHaveClass(/lb-insert-after/);
  const origin = page.getByRole("region", { name: "電子用品", exact: true });
  await expect(origin).not.toHaveClass(/is-drop-target/); await expect(origin.locator(".lb-insertion-ghost")).toHaveCount(1);
  const other = page.getByRole("region", { name: "換洗衣物", exact: true }); await other.locator("h4").scrollIntoViewIfNeeded();
  const heading = await other.locator("h4").boundingBox(); await page.mouse.move(heading.x + heading.width * .7, heading.y + 10, { steps: 10 });
  await expect(other).toHaveClass(/is-drop-target/); await expect(other.locator(".lb-insertion-ghost")).toHaveCount(1);
  await page.keyboard.press("Escape"); await page.mouse.up(); expect(await luggageState(page)).toEqual(before);
});

test("pickup at the bottom of a scrolled desktop list keeps its scroll range and visible category positions", async ({ page }) => {
  await page.setViewportSize({ width: 1456, height: 800 }); await page.goto("/demo/luggage");
  const list = page.getByLabel("個人行李清單", { exact: true });
  await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
  const before = await list.evaluate(el => ({ top: el.scrollTop, height: el.scrollHeight,
    headings: [...el.querySelectorAll("h4")].map(h => h.getBoundingClientRect().top) }));
  const handle = page.getByRole("button", { name: "移動分類：旅行收納袋", exact: true }); const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 8, { steps: 3 });
  await expect(page.locator(".lb-drag-preview")).toBeVisible();
  const frames = await list.evaluate(async el => {
    const frames = [];
    for (let i = 0; i < 20; i++) { await new Promise(requestAnimationFrame); frames.push({ top: el.scrollTop, height: el.scrollHeight,
      headings: [...el.querySelectorAll("h4")].map(h => h.getBoundingClientRect().top), ghosts: el.querySelectorAll(".lb-insertion-ghost").length }); }
    return frames;
  });
  for (const frame of frames) {
    expect(frame.top).toBe(before.top); expect(frame.height).toBe(before.height); expect(frame.headings).toEqual(before.headings); expect(frame.ghosts).toBe(0);
  }
  await page.keyboard.press("Escape"); await page.mouse.up();
  expect(await list.evaluate(el => el.scrollTop)).toBe(before.top);
});

for (const width of [1440, 390]) for (const scope of ["personal", "shared"]) {
  test(`${width}px ${scope} rapid insertion changes keep the lower list and total spacing steady`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1400 }); await page.goto("/tests/harness/luggage.html?empty=1");
    if (scope === "shared") await page.locator(".lb-mode-option[aria-pressed=false]").click();
    for (const title of ["A", "B", "C", "D", "E", "F", "G", "H"]) {
      const input = page.getByLabel(scope === "personal" ? "個人行李名稱" : "共用物品名稱", { exact: true }); await input.fill(title); await input.press("Enter");
    }
    if (scope === "shared" && width <= 1000) await page.getByRole("tab", { name: "共用物品", exact: true }).click();
    const before = await luggageState(page), items = before[scope === "personal" ? "luggageItems" : "sharedLuggageItems"];
    const row = id => page.locator(`#lb-${scope} article[data-item-id="${id}"]`);
    const handle = await row(items[1].id).locator(".lb-drag-handle").boundingBox();
    await page.evaluate(({ id, scope }) => {
      const list = document.querySelector(`#lb-${scope}`), follower = list.querySelector(`article[data-item-id="${id}"]`);
      window.rapidFrames = []; window.recordRapid = true;
      const sample = () => {
        window.rapidFrames.push({ lower: follower.getBoundingClientRect().top,
          space: [...list.querySelectorAll(".lb-sortable-slot")].reduce((sum, el) => sum + el.getBoundingClientRect().height, 0),
          target: list.querySelector(".lb-insert-before,.lb-insert-after")?.dataset.itemId });
        if (window.recordRapid) requestAnimationFrame(sample);
      }; sample();
    }, { id: items.at(-1).id, scope });
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 12, handle.y + handle.height / 2 + 8, { steps: 2 });
    await expect(page.locator(".lb-drag-preview")).toBeVisible();
    for (const index of [2, 3, 4, 5, 4, 3, 2, 0, 4, 5, 3, 2]) {
      const target = await row(items[index].id).boundingBox();
      await page.mouse.move(target.x + target.width * .65, target.y + target.height * .25);
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await page.evaluate(() => new Promise(resolve => { let n = 0; const frame = () => ++n === 20 ? resolve() : requestAnimationFrame(frame); requestAnimationFrame(frame); }));
    const frames = await page.evaluate(() => { window.recordRapid = false; return window.rapidFrames; });
    expect(frames.length).toBeGreaterThan(20);
    const ranges = Object.fromEntries(["lower", "space"].map(key => [key, Math.max(...frames.map(frame => frame[key])) - Math.min(...frames.map(frame => frame[key]))]));
    const targets = [...new Set(frames.map(frame => frame.target).filter(Boolean))];
    expect(targets.length).toBeGreaterThanOrEqual(4);
    for (const range of Object.values(ranges)) expect(range).toBeLessThanOrEqual(1.5);
    await test.info().attach("rapid-drag-metrics", { body: JSON.stringify({ width, scope, ...ranges, targets }), contentType: "application/json" });
    if (process.env.LUGGAGE_FEEDBACK_SCREENSHOT) await page.screenshot({ path: `${process.env.LUGGAGE_FEEDBACK_SCREENSHOT}-rapid-${scope}-${width}.png` });
    await page.keyboard.press("Escape"); await page.mouse.up(); expect(await luggageState(page)).toEqual(before);
  });
}
