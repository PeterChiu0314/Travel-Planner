import { expect, test } from "@playwright/test";
import { luggageState, reassignmentDialog } from "./helpers/luggageDrag.js";
const fixture = "/tests/harness/luggage.html";
const row = (page, column, id) => page.locator(`#lb-${column} article[data-item-id="${id}"]`);
async function begin(page, column, id) {
  await expect(page.locator('.lb-drag-preview')).toHaveCount(0);
  const source = row(page, column, id); await source.scrollIntoViewIfNeeded();
  const bounds = await source.boundingBox(), handle = await source.locator('.lb-drag-handle').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 12, handle.y + handle.height / 2 + 8, { steps: 3 });
  await expect(page.locator('.lb-drag-preview')).toBeVisible();
  return bounds;
}

for (const width of [1440, 390]) {
  test(`${width}px dragging keeps the original row geometry and opens a stable ghost gap across categories`, async ({ page }) => {
    const errors=[]; page.on('pageerror', error=>errors.push(error.message));
    await page.setViewportSize({width,height:1000}); await page.goto(`${fixture}?long=1`);
    const original = await begin(page,'personal','own');
    const overlay = await page.locator('.lb-drag-preview').boundingBox();
    expect(overlay.width).toBeCloseTo(original.width,0); expect(overlay.height).toBeCloseTo(original.height,0);
    expect(await page.locator('.lb-drag-preview').innerText()).toContain('護照');
    expect(await page.locator('.lb-drag-preview').innerText()).not.toContain('放在物品');
    const target=row(page,'personal','long-0'), group=page.locator('.lb-category-group[aria-label="電子用品"]');
    await target.scrollIntoViewIfNeeded(); const before=await target.boundingBox();
    await page.mouse.move(before.x+before.width*.7,before.y+before.height*.25,{steps:12});
    await expect(target).toHaveClass(/lb-insert-before/); await expect(group).toHaveClass(/is-drop-target/);
    const ghost=group.locator('.lb-insertion-ghost'); await expect(ghost).toBeVisible();
    const gap=await ghost.boundingBox(); expect(gap.height).toBeCloseTo(original.height,0);
    await expect.poll(async()=>(await target.boundingBox()).y).toBeCloseTo(before.y+gap.height,0);
    const frames=await group.evaluate(async element=>{
      const states=[];
      for(let i=0;i<12;i++) { await new Promise(requestAnimationFrame); states.push({active:element.classList.contains('is-drop-target'),ghosts:element.querySelectorAll('.lb-insertion-ghost').length,height:element.getBoundingClientRect().height}); }
      return states;
    });
    expect(frames.every(state=>state.active&&state.ghosts===1&&state.height===frames[0].height)).toBe(true);
    const paint=await group.evaluate(element=>({background:getComputedStyle(element).backgroundColor,frame:getComputedStyle(element).boxShadow}));
    expect(paint.background).not.toBe('rgba(0, 0, 0, 0)'); expect(paint.frame).not.toBe('none');
    if(width===1440&&process.env.LUGGAGE_FEEDBACK_SCREENSHOT) await page.screenshot({path:`${process.env.LUGGAGE_FEEDBACK_SCREENSHOT}-private.png`});
    await page.keyboard.press('Escape'); await page.mouse.up();
    await expect(group.locator('.lb-insertion-ghost')).toHaveCount(0); expect(errors).toEqual([]);
  });
}

test('shared row insertion into another member keeps the full receiving area and shows assignment cues before and after drop',async({page})=>{
  await page.setViewportSize({width:1440,height:1000}); await page.goto(fixture);
  const before=await luggageState(page), original=await begin(page,'shared','ready');
  const target=row(page,'shared','owner-assigned'), destination=page.locator('[data-member-id="owner"]');
  const bounds=await target.boundingBox(); await page.mouse.move(bounds.x+bounds.width*.7,bounds.y+8,{steps:10});
  await expect(destination).toHaveClass(/is-drop-target/);
  await expect(destination.locator('.lb-drop-cue')).toContainText('放開指派給 總召 Peter');
  await expect(page.locator('.lb-assignment-notice')).toHaveCount(0);
  await expect(destination.locator('.lb-insertion-ghost')).toHaveCount(1);
  expect((await page.locator('.lb-drag-preview').boundingBox()).height).toBeCloseTo(original.height,0);
  expect(await luggageState(page)).toEqual(before);
  const states=await destination.evaluate(async element=>{
    const results=[]; for(let i=0;i<12;i++){await new Promise(requestAnimationFrame);results.push(element.classList.contains('is-drop-target')&&Boolean(element.querySelector('.lb-drop-cue')));}return results;
  });
  expect(states.every(Boolean)).toBe(true);
  if(process.env.LUGGAGE_FEEDBACK_SCREENSHOT) await page.screenshot({path:`${process.env.LUGGAGE_FEEDBACK_SCREENSHOT}-shared.png`});
  await page.mouse.up();
  await expect(reassignmentDialog(page)).toBeVisible(); expect(await luggageState(page)).toEqual(before);
  await reassignmentDialog(page).getByRole('button',{name:'確認',exact:true}).click();
  await expect(page.getByRole('status',{name:'共用物品指派結果'})).toContainText('已改由 總召 Peter 攜帶');
  expect((await luggageState(page)).sharedLuggageItems.find(item=>item.id==='ready').assigned_to).toBe('owner');
});

for(const width of [1440,390]) {
  test(`${width}px source space transfers to the destination once and cancel restores the original order`,async({page})=>{
    await page.setViewportSize({width,height:1000}); await page.goto(`${fixture}?empty=1`);
    for(const title of ['物品 A','物品 B','物品 C']) {const input=page.getByLabel('個人行李名稱',{exact:true});await input.fill(title);await input.press('Enter');}
    const before=await luggageState(page),b=before.luggageItems.find(item=>item.title==='物品 B'),c=before.luggageItems.find(item=>item.title==='物品 C');
    const original=await row(page,'personal',b.id).boundingBox(), follower=await row(page,'personal',c.id).boundingBox();
    await begin(page,'personal',b.id);
    await expect(row(page,'personal',b.id)).not.toBeVisible();
    expect((await row(page,'personal',b.id).locator('..').boundingBox()).height).toBe(original.height);
    expect((await row(page,'personal',c.id).boundingBox()).y).toBe(follower.y);
    await expect(page.locator('.lb-insertion-ghost')).toHaveCount(0);
    const target=await row(page,'personal',c.id).boundingBox();
    await page.mouse.move(target.x+target.width*.7,target.y+target.height*.75,{steps:10});
    await expect(row(page,'personal',c.id)).toHaveClass(/lb-insert-after/);
    await expect.poll(async()=>(await row(page,'personal',b.id).locator('..').boundingBox()).height).toBe(0);
    await expect.poll(async()=>(await row(page,'personal',c.id).boundingBox()).y).toBeCloseTo(follower.y-original.height,0);
    await expect(page.locator('.lb-insertion-ghost')).toHaveCount(1);
    expect(await luggageState(page)).toEqual(before);
    await page.keyboard.press('Escape');await page.mouse.up();
    await expect(row(page,'personal',b.id)).toBeVisible();
    await expect.poll(async()=>(await row(page,'personal',c.id).boundingBox()).y).toBeCloseTo(follower.y,0);
    expect(await luggageState(page)).toEqual(before);
  });
}

test('insertion animates the neighbouring row through intermediate positions and honors reduced motion',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});await page.goto(fixture);
  await begin(page,'shared','ready');
  const target=row(page,'shared','owner-assigned'),before=await target.boundingBox();
  await page.mouse.move(before.x+before.width*.7,before.y+8);
  await expect(target).toHaveClass(/lb-insert-before/);
  const sample=await target.evaluate(async element=>{
    const tops=[];for(let i=0;i<18;i++){tops.push(element.getBoundingClientRect().top);await new Promise(requestAnimationFrame);}return tops;
  });
  expect(sample.at(-1)).toBeCloseTo(before.y+before.height,0);
  expect(Math.max(...sample)-Math.min(...sample)).toBeGreaterThan(1);
  expect(sample.some(top=>top>before.y+.5&&top<before.y+before.height-.5)).toBe(true);
  await page.keyboard.press('Escape');await page.mouse.up();
  await expect(page.locator('.lb-drag-preview')).toHaveCount(0);
  await page.emulateMedia({reducedMotion:'reduce'});await begin(page,'shared','ready');
  const reduced=await target.boundingBox();await page.mouse.move(reduced.x+reduced.width*.7,reduced.y+8);
  await expect(target).toHaveClass(/lb-insert-before/);
  expect(await target.evaluate(element=>element.getAnimations().length)).toBe(0);
  await page.keyboard.press('Escape');await page.mouse.up();
});

test('moving between a category header and its rows keeps one full-section highlight and a single ghost',async({page})=>{
  await page.setViewportSize({width:1440,height:1000}); await page.goto(`${fixture}?long=1`);
  await begin(page,'personal','own');
  const group=page.locator('.lb-category-group[aria-label="電子用品"]'), heading=group.getByRole('button',{name:/^電子用品 /});
  await heading.scrollIntoViewIfNeeded(); const header=await heading.boundingBox();
  await page.mouse.move(header.x+header.width*.7,header.y+10,{steps:10});
  await expect(group).toHaveClass(/is-drop-target/); await expect(group.locator('.lb-insertion-ghost')).toHaveCount(1);
  const target=row(page,'personal','long-0'), rect=await target.boundingBox();
  await page.mouse.move(rect.x+rect.width*.7,rect.y+8,{steps:10});
  await expect(target).toHaveClass(/lb-insert-before/);
  await expect(group).toHaveClass(/is-drop-target/); await expect(group.locator('.lb-insertion-ghost')).toHaveCount(1);
  await page.keyboard.press('Escape'); await page.mouse.up();
});
