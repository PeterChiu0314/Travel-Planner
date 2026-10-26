import { expect, test } from "@playwright/test";
import { luggageState, reassignmentDialog } from "./helpers/luggageDrag.js";
const fixture = "/tests/harness/luggage.html";
const row = (page, column, id) => page.locator(`#lb-${column} article[data-item-id="${id}"]`);
const ids = (page, column, group) => page.locator(`#lb-${column} ${group} article[data-item-id]`).evaluateAll(rows => rows.map(element => element.dataset.itemId));

async function dragRow(page, column, id, targetColumn, targetId, placement = "before", cancel = false) {
  const handle = row(page, column, id).locator(".lb-drag-handle");
  await handle.scrollIntoViewIfNeeded(); const start = await handle.boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 14, start.y + start.height / 2 + 9, { steps: 3 });
  const target = row(page, targetColumn, targetId); await target.scrollIntoViewIfNeeded(); const end = await target.boundingBox();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height * (placement === "before" ? 0.25 : 0.75), { steps: 10 });
  await expect(target).toHaveClass(new RegExp(`lb-insert-${placement}`));
  if (cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
}

for (const width of [1440, 390]) {
  test(`${width}px private item inserts before/after, preserves packing and survives refetch`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await page.goto(fixture);
    for (const title of ["錢包", "登機證"]) {
      await page.getByLabel("個人行李名稱", { exact: true }).fill(title);
      await page.getByLabel("個人行李名稱", { exact: true }).press("Enter");
    }
    const state = await luggageState(page), wallet = state.luggageItems.find(item => item.title === "錢包"), ticket = state.luggageItems.find(item => item.title === "登機證");
    await page.getByRole("checkbox", { name: "準備：登機證", exact: true }).check();
    await dragRow(page, "personal", ticket.id, "personal", wallet.id);
    await expect.poll(() => ids(page, "personal", '.lb-category-group[aria-label="未分類"]')).toEqual([ticket.id, wallet.id]);
    expect((await luggageState(page)).luggageItems.find(item => item.id === ticket.id).packed).toBe(true);
    await page.getByRole("button", { name: "模擬遠端重新載入", exact: true }).click();
    expect(await ids(page, "personal", '.lb-category-group[aria-label="未分類"]')).toEqual([ticket.id, wallet.id]);
    await dragRow(page, "personal", ticket.id, "personal", wallet.id, "after");
    await expect.poll(() => ids(page, "personal", '.lb-category-group[aria-label="未分類"]')).toEqual([wallet.id, ticket.id]);
    if (width <= 1000) await expect(page.getByRole("tab", { name: "個人行李", exact: true })).toHaveAttribute("aria-selected", "true");
  });
}

test("cross-category insertion preserves private content, long lists keep all rows, cancel/failure make no changes", async ({ page }) => {
  await page.goto(`${fixture}?long=1`); await page.setViewportSize({ width: 1440, height: 1000 });
  const before = await luggageState(page);
  await dragRow(page, "personal", "own", "personal", "long-0", "before", true);
  expect(await luggageState(page)).toEqual(before);
  await page.getByRole("button", { name: "下一次操作失敗", exact: true }).click();
  await dragRow(page, "personal", "own", "personal", "long-0");
  await expect(page.getByRole("alert").first()).toBeVisible(); expect(await luggageState(page)).toEqual(before);
  await dragRow(page, "personal", "long-18", "personal", "long-0");
  await expect.poll(async () => (await luggageState(page)).luggageItems.find(item => item.id === "long-18").sort_order).not.toBeUndefined();
  expect((await luggageState(page)).luggageItems).toHaveLength(before.luggageItems.length);
  await dragRow(page, "personal", "own", "personal", "long-0");
  await expect.poll(async () => (await luggageState(page)).luggageItems.find(item => item.id === "own").category).toBe("電子用品");
  expect((await luggageState(page)).luggageItems.find(item => item.id === "own").title).toBe("護照");
});

test("shared order is canonical in both columns, viewer can reorder without resetting packing, and can insert into another assignee", async ({ page, context }) => {
  const room = `order-${Date.now()}`; await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(`${fixture}?actor=packer&room=${room}`);
  const remote = await context.newPage(); await remote.goto(`${fixture}?actor=viewer&room=${room}`); await remote.setViewportSize({ width: 1440, height: 900 });
  await remote.bringToFront(); await dragRow(remote, "shared", "ready", "shared", "shared");
  await expect.poll(() => ids(remote, "shared", '[data-member-id="packer"]')).toEqual(["ready", "shared", "emergency"]);
  expect((await luggageState(remote)).sharedLuggageItems.find(item => item.id === "ready").packed_by_assignee).toBe(true);
  await expect.poll(() => ids(page, "personal", ".lb-assigned")).toEqual(["ready", "shared", "emergency"]);
  await page.bringToFront(); await dragRow(page, "personal", "shared", "personal", "ready");
  await expect.poll(() => ids(page, "shared", '[data-member-id="packer"]')).toEqual(["shared", "ready", "emergency"]);
  await dragRow(page, "shared", "ready", "shared", "owner-assigned");
  await reassignmentDialog(page).getByRole('button',{name:'確認',exact:true}).click();
  await expect.poll(async () => (await luggageState(page)).sharedLuggageItems.find(item => item.id === "ready").assigned_to).toBe("owner");
  expect((await luggageState(page)).sharedLuggageItems.find(item => item.id === "ready").packed_by_assignee).toBe(false);
  await remote.close();
});

test("keyboard can choose an item's insertion position and cancel without writes", async ({ page }) => {
  await page.goto(fixture); const before = await luggageState(page);
  const handle = row(page, "shared", "ready").locator(".lb-drag-handle"); await handle.focus(); await handle.press("Space");
  await expect(page.locator('.lb-drag-preview')).toBeVisible();
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("ArrowDown");
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if ((await row(page, "shared", "shared").getAttribute("class")).includes("lb-insert-before")) break;
  }
  await expect(row(page, "shared", "shared")).toHaveClass(/lb-insert-before/); await page.keyboard.press("Escape");
  await expect(row(page, "shared", "shared")).not.toHaveClass(/lb-insert-before/);
  await expect(row(page, "shared", "ready")).not.toHaveClass(/is-dragging/);
  await expect(page.locator('.lb-drag-preview')).toHaveCount(0);
  expect(await luggageState(page)).toEqual(before);
  await handle.focus(); await handle.press("Space");
  await expect(page.locator('.lb-drag-preview')).toBeVisible();
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("ArrowDown");
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if ((await row(page, "shared", "shared").getAttribute("class")).includes("lb-insert-before")) break;
  }
  await page.keyboard.press("Space");
  await expect.poll(() => ids(page, "shared", '[data-member-id="packer"]')).toEqual(["ready", "shared", "emergency"]);
});

test("remote edits during a drag reject the stale list without overwriting content or order", async ({ page, context }) => {
  const room = `order-stale-${Date.now()}`; await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(`${fixture}?room=${room}`);
  const remote = await context.newPage(); await remote.goto(`${fixture}?room=${room}&actor=viewer`);
  await page.bringToFront(); const start = await row(page, "shared", "ready").locator('.lb-drag-handle').boundingBox();
  await page.mouse.move(start.x+10,start.y+10); await page.mouse.down(); await page.mouse.move(start.x+24,start.y+20,{steps:3});
  await remote.bringToFront(); await remote.getByRole('button',{name:'編輯：共享充電器',exact:true}).click();
  const name=remote.getByLabel('編輯共用物品名稱',{exact:true}); await name.fill('遠端更新充電器'); await name.press('Enter');
  await expect.poll(async ()=>(await luggageState(page)).sharedLuggageItems.find(item=>item.id==='shared').title).toBe('遠端更新充電器');
  await page.bringToFront(); const end=await row(page,'shared','shared').boundingBox();
  await page.mouse.move(end.x+end.width/2,end.y+8,{steps:8}); await page.mouse.up();
  await expect(page.getByRole('alert').first()).toContainText('重新拖曳');
  expect(await ids(page,'shared','[data-member-id="packer"]')).toEqual(['shared','emergency','ready']);
  expect((await luggageState(page)).sharedLuggageItems.find(item=>item.id==='shared').title).toBe('遠端更新充電器');
  await remote.close();
});

test("touch sorting remains on the personal tab and inserts at the indicated position", async ({ browser }) => {
  const context=await browser.newContext({viewport:{width:390,height:900},hasTouch:true,isMobile:true});
  const page=await context.newPage(); await page.goto(fixture);
  for (const title of ['觸控 A','觸控 B']) { const input=page.getByLabel('個人行李名稱',{exact:true}); await input.fill(title); await input.press('Enter'); }
  const items=(await luggageState(page)).luggageItems, a=items.find(item=>item.title==='觸控 A'),b=items.find(item=>item.title==='觸控 B');
  const cdp=await context.newCDPSession(page);
  const touch=(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,id:1}]});
  const start=await row(page,'personal',b.id).locator('.lb-drag-handle').boundingBox();
  await touch('touchStart',start.x+12,start.y+20); await touch('touchMove',start.x+26,start.y+26);
  await expect(page.getByRole('tab',{name:'個人行李',exact:true})).toHaveAttribute('aria-selected','true');
  const end=await row(page,'personal',a.id).boundingBox(); await touch('touchMove',end.x+end.width/2,end.y+12);
  await expect(row(page,'personal',a.id)).toHaveClass(/lb-insert-before/); await touch('touchEnd');
  await expect.poll(()=>ids(page,'personal','.lb-category-group[aria-label="未分類"]')).toEqual([b.id,a.id]);
  await context.close();
});
