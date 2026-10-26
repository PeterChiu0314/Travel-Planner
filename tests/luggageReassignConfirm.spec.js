import { expect, test } from "@playwright/test";
import { dragLuggage, luggageState, reassignmentDialog } from "./helpers/luggageDrag.js";
const fixture='/tests/harness/luggage.html';
async function dropOnRow(page) {
  const handle=page.getByRole('button',{name:'拖曳指派共用物品：團隊相機',exact:true});
  await expect(page.locator('.lb-drag-preview')).toHaveCount(0);await handle.scrollIntoViewIfNeeded();
  const box=await handle.boundingBox();await page.mouse.move(box.x+10,box.y+10);await page.mouse.down();await page.mouse.move(box.x+24,box.y+18,{steps:3});
  const target=page.locator('#lb-shared article[data-item-id="owner-assigned"]');await target.scrollIntoViewIfNeeded();const rect=await target.boundingBox();
  await page.mouse.move(rect.x+rect.width*.65,rect.y+8,{steps:10});await expect(target).toHaveClass(/lb-insert-before/);await page.mouse.up();
  await expect(reassignmentDialog(page)).toBeVisible();
}
for(const width of [1440,390]) {
  test(`${width}px member-header reassignment confirms recipient and packing reset, all cancellations preserve data`,async({page})=>{
    await page.setViewportSize({width,height:1000});await page.goto(fixture);
    if(width<=1000) await page.getByRole('tab',{name:'共用物品',exact:true}).click();
    const before=await luggageState(page);
    for(const cancel of ['button','escape','backdrop']) {
      await dragLuggage(page,'團隊相機','owner','shared',{confirm:false});
      const dialog=reassignmentDialog(page);await expect(dialog).toContainText('將交給總召 Peter');await expect(dialog).toContainText('重置準備狀態');
      expect(await luggageState(page)).toEqual(before);await expect(page.locator('.lb-assignment-notice')).toHaveCount(0);
      if(cancel==='button') await dialog.getByRole('button',{name:'取消',exact:true}).click();
      else if(cancel==='escape') await page.keyboard.press('Escape');
      else await page.locator('.modal-backdrop').click({position:{x:3,y:3}});
      await expect(dialog).toHaveCount(0);expect(await luggageState(page)).toEqual(before);
    }
    await dragLuggage(page,'團隊相機','owner','shared',{confirm:false});await expect(reassignmentDialog(page)).toBeVisible();expect(await luggageState(page)).toEqual(before);
    if(width===1440 && process.env.LUGGAGE_CONFIRM_SCREENSHOT) {
      await expect(page.locator('.lb-drag-preview')).toHaveCount(0);
      await page.screenshot({path:process.env.LUGGAGE_CONFIRM_SCREENSHOT});
    }
    await reassignmentDialog(page).getByRole('button',{name:'確認',exact:true}).click();
    await expect.poll(async()=>(await luggageState(page)).sharedLuggageItems.find(item=>item.id==='ready').assigned_to).toBe('owner');
    expect((await luggageState(page)).sharedLuggageItems.find(item=>item.id==='ready').packed_by_assignee).toBe(false);
    await dragLuggage(page,'團隊相機','','shared',{confirm:false});await expect(reassignmentDialog(page)).toContainText('未指派群組');
    await reassignmentDialog(page).getByRole('button',{name:'確認',exact:true}).click();
    await expect.poll(async()=>(await luggageState(page)).sharedLuggageItems.find(item=>item.id==='ready').assigned_to).toBe(null);
  });
  test(`${width}px item-row insertion waits for confirmation; cancel preserves both order and assignment`,async({page})=>{
    await page.setViewportSize({width,height:1000});await page.goto(fixture);if(width<=1000) await page.getByRole('tab',{name:'共用物品',exact:true}).click();
    const before=await luggageState(page);await dropOnRow(page);expect(await luggageState(page)).toEqual(before);
    await reassignmentDialog(page).getByRole('button',{name:'取消',exact:true}).click();expect(await luggageState(page)).toEqual(before);
    await dropOnRow(page);await reassignmentDialog(page).getByRole('button',{name:'確認',exact:true}).click();
    await expect.poll(async()=>(await luggageState(page)).sharedLuggageItems.find(item=>item.id==='ready').assigned_to).toBe('owner');
    expect((await luggageState(page)).sharedLuggageItems.find(item=>item.id==='ready').sort_order).toBeLessThan((await luggageState(page)).sharedLuggageItems.find(item=>item.id==='owner-assigned').sort_order);
  });
}

test('failed confirmed reassignment preserves the source and retry asks again',async({page})=>{
  await page.goto(fixture);const before=await luggageState(page);await page.getByRole('button',{name:'下一次操作失敗',exact:true}).click();
  await dragLuggage(page,'團隊相機','owner');await expect(page.getByRole('alert').first()).toBeVisible();expect(await luggageState(page)).toEqual(before);
  await dragLuggage(page,'團隊相機','owner');await expect.poll(async()=>(await luggageState(page)).sharedLuggageItems.find(item=>item.id==='ready').assigned_to).toBe('owner');
});

test('remote updates while the confirmation is open cannot be overwritten by confirmed row insertion',async({page,context})=>{
  const room=`confirm-${Date.now()}`;await page.goto(`${fixture}?room=${room}`);const remote=await context.newPage();await remote.goto(`${fixture}?room=${room}&actor=viewer`);
  await page.bringToFront();await dropOnRow(page);
  await remote.bringToFront();await remote.getByRole('button',{name:'編輯：團隊相機',exact:true}).click();const input=remote.getByLabel('編輯共用物品名稱',{exact:true});await input.fill('遠端更新相機');await input.press('Enter');
  await expect.poll(async()=>(await luggageState(page)).sharedLuggageItems.find(item=>item.id==='ready').title).toBe('遠端更新相機');
  await page.bringToFront();await reassignmentDialog(page).getByRole('button',{name:'確認',exact:true}).click();await expect(page.getByRole('alert').first()).toBeVisible();
  expect((await luggageState(page)).sharedLuggageItems.find(item=>item.id==='ready')).toMatchObject({title:'遠端更新相機',assigned_to:'packer'});await remote.close();
});
