import { expect } from "@playwright/test";

export const luggageState = async page => JSON.parse(await page.getByTestId("luggage-canonical-state").textContent());
export const reassignmentDialog = page => page.getByRole("dialog", { name: /^(改由 .+ 攜帶？|取消負責人指派？)$/ });
async function settlePickup(page) {
  await expect(page.locator(".lb-drag-preview")).toBeVisible();
  // Read destination coordinates after the source's real layout has closed.
  await page.locator(".lb-source-collapsed").evaluateAll(nodes => Promise.all(nodes.flatMap(node => node.getAnimations()).map(animation => animation.finished.catch(() => {}))));
}
export async function dragLuggage(page, title, memberId, scope = "shared", { cancel = false, confirm = true } = {}) {
  const handle = page.getByRole("button", { name: `${scope === "shared" ? "拖曳指派共用物品" : "移動分類"}：${title}`, exact: true });
  const previousMember = scope === "shared" ? await handle.evaluate(element => element.closest('[data-member-id]')?.dataset.memberId) : null;
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 8, { steps: 3 });
  await settlePickup(page);
  if (scope === "personal" && page.viewportSize().width <= 1000) {
    const tab = await page.getByRole("tab", { name: "共用物品", exact: true }).boundingBox();
    await page.mouse.move(tab.x + tab.width / 2, tab.y + tab.height / 2, { steps: 5 });
  }
  const target = page.locator(`#lb-shared [data-member-id="${memberId || "unassigned"}"]`);
  // Hover the visible heading rather than tweening toward coordinates captured
  // before an intervening group's insertion space pushes this destination down.
  await target.locator("h4").hover();
  if (scope === "shared" && previousMember === (memberId || "unassigned")) await expect(target).not.toHaveClass(/is-drop-target/);
  else await expect(target).toHaveClass(/is-drop-target/);
  if (cancel) { await page.keyboard.press("Escape"); await page.mouse.up(); }
  else {
    await page.mouse.up();
    if (scope === "personal" && confirm) await page.getByRole("dialog", { name: "轉為共用物品？", exact: true }).getByRole("button", { name: "確認", exact: true }).click();
    if (scope === "shared" && confirm && previousMember !== (memberId || "unassigned")) await reassignmentDialog(page).getByRole("button", { name: "確認", exact: true }).click();
  }
}

export async function keyboardAssign(page, title, memberId, scope = "shared") {
  await expect(page.locator('.lb-drag-preview')).toHaveCount(0);
  const handle = page.getByRole("button", { name: `${scope === "shared" ? "拖曳指派共用物品" : "移動分類"}：${title}`, exact: true });
  const previousMember = scope === "shared" ? await handle.evaluate(element => element.closest('[data-member-id]')?.dataset.memberId) : null;
  await expect(handle).toBeEnabled(); await handle.focus(); await handle.press("Space");
  await expect(page.locator('.lb-drag-preview')).toBeVisible();
  if (scope === "personal" && page.viewportSize().width <= 1000) {
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole('tab', { name: '共用物品', exact: true })).toHaveAttribute('aria-selected', 'true');
  }
  const target = page.locator(`#lb-shared [data-member-id="${memberId || "unassigned"}"]`);
  for (let i = 0; i < 100; i += 1) {
    await page.keyboard.press("ArrowDown");
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if ((await target.getAttribute("class"))?.includes("is-drop-target")) break;
  }
  await expect(target).toHaveClass(/is-drop-target/); await page.keyboard.press("Space");
  if (scope === "personal") await page.getByRole("dialog", { name: "轉為共用物品？", exact: true }).getByRole("button", { name: "確認", exact: true }).click();
  if (scope === "shared" && previousMember !== (memberId || "unassigned")) await reassignmentDialog(page).getByRole("button", { name: "確認", exact: true }).click();
}

export async function returnLuggage(page, title, category, { confirm = true, keyboard = false } = {}) {
  const handle = page.getByRole("button", { name: `拖曳指派共用物品：${title}`, exact: true });
  if (keyboard) {
    await handle.focus(); await handle.press("Space");
    if (page.viewportSize().width <= 1000) await page.keyboard.press("ArrowLeft");
  } else {
    await handle.scrollIntoViewIfNeeded(); const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 14, box.y + box.height / 2 + 10, { steps: 3 });
    await settlePickup(page);
    if (page.viewportSize().width <= 1000) {
      const tab = await page.getByRole("tab", { name: "個人行李", exact: true }).boundingBox();
      await page.mouse.move(tab.x + tab.width / 2, tab.y + tab.height / 2, { steps: 10 });
      await expect(page.getByRole("tab", { name: "個人行李", exact: true })).toHaveAttribute("aria-selected", "true");
    }
  }
  const target = page.locator(".lb-category-group").filter({ has: page.getByRole("button", { name: new RegExp(`^${category} `) }) });
  if (keyboard) {
    for (let i = 0; i < 100; i += 1) {
      await page.keyboard.press("ArrowDown");
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      if ((await target.getAttribute("class"))?.includes("is-drop-target")) break;
    }
    await expect(target).toHaveClass(/is-drop-target/); await page.keyboard.press("Space");
  } else {
    await target.locator("h4").hover();
    await expect(target).toHaveClass(/is-drop-target/); await page.mouse.up();
  }
  const dialog = page.getByRole("dialog", { name: "轉為個人物品？", exact: true }); await expect(dialog).toBeVisible();
  if (confirm) await dialog.getByRole("button", { name: "確認", exact: true }).click();
}
