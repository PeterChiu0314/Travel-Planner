import {test,expect} from '@playwright/test';
import {boot} from './helpers/expenseBackend.js';
import {departureFixture} from './helpers/expenseDepartureFixture.js';

const itemHandle=(page,name)=>page.getByRole('button',{name:`拖曳項目「${name}」`,exact:true});
const groupHandle=(page,name)=>page.getByRole('button',{name:`拖曳分類「${name}」`,exact:true});
const category=(page,name)=>page.locator(`tbody[data-expense-category="${name}"]`);
const row=(page,id)=>page.locator(`.bw-row[data-expense-id="${id}"]`);
async function pickUp(page,handle){
 await handle.scrollIntoViewIfNeeded();
 const box=await handle.boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
 await page.mouse.down();
 await page.mouse.move(box.x+box.width/2+8,box.y+box.height/2,{steps:3});
 await expect(page.locator('.bw-drag-preview')).toBeVisible();
}
async function aim(page,target,side='after',steps=8){
 await target.scrollIntoViewIfNeeded();
 const box=await target.boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height*(side==='before'?.25:.75),{steps});
}

const ghostFor=page=>page.locator('tbody[data-expense-category] > tr[data-expense-ghost]');
const tableRow=(page,name)=>itemHandle(page,name).locator('xpath=ancestor::tr');
const height=locator=>locator.evaluate(node=>node.getBoundingClientRect().height);

test('item Ghost transfers one row of space and animates adjacent rows across targets',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('/demo/budget');
 const source='租車加油',traffic=category(page,'交通'),ghost=ghostFor(page);
 const sourceRow=row(page,await tableRow(page,source).getAttribute('data-expense-id'));
 const sourceHeight=await height(sourceRow);
 const scroller=page.locator('.bw-table-scroll');
 const originalHeight=await scroller.evaluate(node=>node.scrollHeight);
 await pickUp(page,itemHandle(page,source));
 expect(await height(sourceRow)).toBe(sourceHeight);
 await expect(ghost).toHaveCount(0);
 const first=tableRow(page,'關西機場 → 京都巴士');
 await aim(page,first,'before',1);
 await expect(ghost).toHaveCount(1);
 await expect(ghost.locator('xpath=following-sibling::tr[1]')).toContainText('關西機場 → 京都巴士');
 expect(await height(sourceRow)).toBe(0);
 expect(await height(ghost)).toBeCloseTo(sourceHeight,0);
 await expect(ghost).toContainText(source);
 expect(await scroller.evaluate(node=>node.scrollHeight)).toBe(originalHeight);
 expect(await first.evaluate(node=>node.getAnimations().some(animation=>animation.playState==='running'))).toBe(true);

 const destination=tableRow(page,'京都山科山樂酒店・2 晚');
 await aim(page,destination,'after',1);
 await expect(ghost.locator('xpath=preceding-sibling::tr[1]')).toContainText('京都山科山樂酒店・2 晚');
 await expect(ghost).toHaveCount(1);
 await expect(traffic.locator('tr[data-expense-ghost]')).toHaveCount(0);
 expect(await scroller.evaluate(node=>node.scrollHeight)).toBe(originalHeight);
 await page.keyboard.press('Escape');
 await page.mouse.up();
 await expect(ghost).toHaveCount(0);
 await expect(sourceRow).toBeVisible();
 expect(await height(sourceRow)).toBe(sourceHeight);
});

test('expanded category content accepts whole-group drops on both sides',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/demo/budget');
 const source=category(page,'機票'),target=category(page,'交通'),ghost=ghostFor(page);
 const originalItems=await source.locator(':scope > tr[data-expense-id]').evaluateAll(nodes=>nodes.map(node=>node.dataset.expenseId));
 const sourceHeight=await height(source);
 await pickUp(page,groupHandle(page,'機票'));
 await aim(page,tableRow(page,'關西機場 → 京都巴士'),'after',1);
 await expect(target.locator(':scope > tr:first-child')).toHaveAttribute('data-expense-ghost','');
 expect(await height(ghost)).toBeCloseTo(sourceHeight,0);
 expect(await height(source)).toBe(0);
 expect(await target.locator(':scope > .bw-group').evaluate(node=>node.getAnimations().length)).toBe(0);
 await aim(page,tableRow(page,'交通 IC 卡儲值'),'before',1);
 await expect(target.locator(':scope > tr:last-child')).toHaveAttribute('data-expense-ghost','');
 await expect(ghost).toHaveCount(1);
 await page.mouse.up();
 await expect(target.locator('xpath=following-sibling::tbody[1]')).toHaveAttribute('data-expense-category','機票');
 await expect(ghost).toHaveCount(0);
 expect(await source.locator(':scope > tr[data-expense-id]').evaluateAll(nodes=>nodes.map(node=>node.dataset.expenseId))).toEqual(originalItems);
});

test('Demo sorts items and categories and accepts an empty, collapsed category',async({page})=>{
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/demo/budget');
 const flight='去程機票・桃園 → 關西';
 const handle=itemHandle(page,flight);
 await expect(handle).toBeEnabled();
 const initialGroups=await page.locator('tbody[data-expense-category]').evaluateAll(nodes=>nodes.map(node=>node.dataset.expenseCategory));
 expect(initialGroups).toHaveLength(7);
 const sourceBox=await handle.locator('xpath=ancestor::tr').boundingBox();
 await page.getByRole('button',{name:'收合其他',exact:true}).click();
 await pickUp(page,handle);
 const preview=await page.locator('.bw-drag-preview').boundingBox();
 expect(preview.width).toBeCloseTo(sourceBox.width,0);
 expect(preview.height).toBeCloseTo(sourceBox.height,0);
 await aim(page,category(page,'其他').locator('.bw-group'));
 await expect(category(page,'其他').locator('.is-drop-end')).toBeVisible();
 await expect(category(page,'其他').locator(':scope > tr:last-child')).toHaveAttribute('data-expense-ghost','');
 await page.mouse.up();
 await expect(category(page,'機票').getByRole('button',{name:flight,exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'展開其他',exact:true}).click();
 await expect(category(page,'其他').getByRole('button',{name:flight,exact:true})).toBeVisible();
 await expect(page.getByRole('tab',{name:'旅程統計'})).toHaveAttribute('aria-selected','true');

 const group=groupHandle(page,'其他');
 await expect(group).toBeEnabled();
 await group.press('Space');
 await expect(page.locator('.bw-drag-preview')).toBeVisible();
 await page.keyboard.press('ArrowUp');
 await page.keyboard.press('Space');
 await expect.poll(()=>page.locator('tbody[data-expense-category]').evaluateAll(nodes=>nodes.map(node=>node.dataset.expenseCategory)))
  .toEqual([...initialGroups.slice(0,-2),'其他',initialGroups.at(-2)]);
 const moved=category(page,'其他').getByRole('button',{name:flight,exact:true});
 await expect(moved).toBeVisible();
 await pickUp(page,handle);
 await page.keyboard.press('Escape');
 await expect(page.locator('.bw-drag-preview')).toHaveCount(0);
 await page.mouse.up();
 await expect(moved).toBeVisible();
 await page.getByRole('textbox',{name:'搜尋項目'}).fill('去程');
 await expect(handle).toBeDisabled();
 await page.getByRole('textbox',{name:'搜尋項目'}).clear();
 await page.getByRole('button',{name:'多選',exact:true}).click();
 await expect(handle).toBeDisabled();
 expect(errors).toEqual([]);
});

test('mobile touch starts on the handle and moves the row without selecting it',async({browser})=>{
 const context=await browser.newContext({viewport:{width:430,height:850},hasTouch:true,isMobile:true});
 try{
  const page=await context.newPage();
  await page.goto('/demo/budget');
  const name='回程機票・名古屋 → 桃園',handle=itemHandle(page,name);
  const target=category(page,'交通').locator('.bw-group');
  await expect(handle).toBeEnabled();
  await expect(handle).toHaveCSS('touch-action','none');
  await expect(target).toHaveCSS('touch-action','auto');
  await handle.scrollIntoViewIfNeeded();
  const source=await handle.boundingBox(),destination=await target.boundingBox();
  const input=await context.newCDPSession(page);
  const touch=(type,x,y)=>input.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y}]});
  await touch('touchStart',source.x+source.width/2,source.y+source.height/2);
  await expect(page.locator('.bw-drag-preview')).toBeVisible();
  await touch('touchMove',destination.x+destination.width/2,destination.y+destination.height/2);
  await expect(target).toHaveClass(/is-drop-end/);
  await touch('touchEnd');
  await expect(category(page,'交通').getByRole('button',{name,exact:true})).toBeVisible();
  await expect(page.getByRole('tab',{name:'旅程統計'})).toHaveAttribute('aria-selected','true');
 }finally{await context.close();}
});

test('two accounts share drag presence and ordering with independent edits and lost ACK recovery',async({browser})=>{
 const f=await departureFixture();
 const aContext=await browser.newContext(),bContext=await browser.newContext();
 try{
  const first=await f.seed('跨分類測試',{}, {paid:true,payer:f.A});
  const second=await f.seed('同組測試',{});
  const a=await aContext.newPage(),b=await bContext.newPage();
  await boot(a,f.db,f.A);
  await boot(b,f.db,f.B);
  const peerRow=row(b,first);
  await peerRow.getByRole('button',{name:'跨分類測試',exact:true}).click();
  const note=await f.lease(first,'note',f.B);
  expect(note.result.data?.granted).toBe(true);
  await pickUp(a,itemHandle(a,'跨分類測試'));
  const move=peerRow.locator('.bw-remote-move');
  await expect(move).toBeVisible();
  await expect(peerRow.locator('.bw-collaboration-outline')).toHaveAttribute('data-user',f.A);
  await expect(peerRow.locator('.bw-collaboration-outline')).toBeVisible();
  expect(await move.evaluate(node=>getComputedStyle(node).color)).toBe(await peerRow.locator('.bw-collaboration-outline').evaluate(node=>{
   const sample=document.createElement('span');
   sample.style.color=getComputedStyle(node).getPropertyValue('--bw-remote-color');
   node.appendChild(sample);
   return getComputedStyle(sample).color;
  }));
  await expect(itemHandle(b,'跨分類測試')).toHaveCount(0);
  await expect(itemHandle(b,'同組測試')).toBeEnabled();
  await expect(b.locator('.bw-drag-preview')).toHaveCount(0);
  expect((await note.mutate({text:'可獨立儲存'})).data?.committed).toBe(true);
  await aim(a,row(a,second),'before');
  await a.mouse.up();
  await expect(move).toHaveCount(0);
  await expect(category(b,'交通').locator('.bw-row').first()).toHaveAttribute('data-expense-id',first);

  const categoryEdit=await f.lease(first,'category',f.B);
  expect(categoryEdit.result.data?.granted).toBe(true);
  const request=f.db.request.bind(f.db);
  let resumeFailedMove;
  const waitForFailure=new Promise(resolve=>{resumeFailedMove=resolve;});
  f.db.request=async req=>{
   if(req.name==='move_expense_order'&&req.args.p_intent.category==='住宿')await waitForFailure;
   return request(req);
  };
  await pickUp(a,itemHandle(a,'跨分類測試'));
  await aim(a,category(a,'住宿').locator('.bw-group'));
  const ghost=ghostFor(a);
  await expect(ghost).toHaveCount(1);
  try{
   await a.mouse.up();
   await expect(ghost).toHaveCount(0);
   const frames=await row(a,first).evaluate(node=>new Promise(resolve=>{
    const positions=[];
    function sample(){
     positions.push({category:node.closest('tbody')?.dataset.expenseCategory,height:node.getBoundingClientRect().height});
     if(positions.length===12)resolve(positions);else requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
   }));
   expect(frames.every(frame=>frame.category==='住宿'&&frame.height>0)).toBe(true);
  }finally{resumeFailedMove();}
  await expect(a.getByText('項目正在被操作或拖曳已逾時，排序未儲存。')).toBeVisible();
  await expect(category(a,'交通').locator(`[data-expense-id="${first}"]`)).toBeVisible();
  expect((await categoryEdit.release()).data?.settled).toBe(true);
  const older=await f.snapshot();

  let lost=false;
  f.db.request=async req=>{
   const result=await request(req);
   if(!lost&&req.name==='move_expense_order'&&!req.args.p_confirm&&result.data?.committed){
    lost=true;return {error:{message:'ACK lost'}};
   }
   return result;
  };
  await pickUp(a,itemHandle(a,'跨分類測試'));
  await aim(a,category(a,'住宿').locator('.bw-group'));
  await a.mouse.up();
  await expect(a.getByText('排序結果待確認，重新連線後會查證。')).toBeVisible();
  await expect(category(a,'住宿').locator(`[data-expense-id="${first}"]`)).toBeVisible();
  await expect(category(b,'住宿').locator(`[data-expense-id="${first}"]`)).toBeVisible();
  await expect(itemHandle(a,'跨分類測試')).toBeEnabled({timeout:12000});
  const cross=f.db.expenseCalls.filter(call=>call.name==='move_expense_order'&&call.args.p_intent.category==='住宿');
  expect(cross.at(-1).args).toEqual({...cross.at(-2).args,p_confirm:true});

  const cacheKey=`travel-planner-offline-v2:${f.B}:trip:${f.trip}`;
  const readCache=()=>b.evaluate(key=>JSON.parse(localStorage.getItem(key))?.payload.expenseGraph,cacheKey);
  await expect.poll(async()=>(await readCache())?.items.find(item=>item.id===first)?.category).toBe('住宿');
  const beforeStale=await readCache();
  let deliveredOld=false;
  f.db.request=async req=>{
   if(req.actor===f.B&&req.name==='read_expense_snapshot'){
    deliveredOld=true;
    return {data:older};
   }
   return request(req);
  };
  await f.db.emit('expense_signals',{eventType:'UPDATE',new:{trip_id:f.trip}});
  await expect.poll(()=>deliveredOld).toBe(true);
  const cached=await b.evaluate(key=>new Promise(resolve=>{
   const frames=[];
   function sample(){
    frames.push(JSON.parse(localStorage.getItem(key))?.payload.expenseGraph);
    if(frames.length===12)resolve(frames);else requestAnimationFrame(sample);
   }
   requestAnimationFrame(sample);
  }),cacheKey);
  expect(cached.every(graph=>graph.snapshotRevision>=beforeStale.snapshotRevision
   &&graph.items.find(item=>item.id===first).category==='住宿')).toBe(true);
  f.db.request=request;
  await b.reload();
  await expect(category(b,'住宿').locator(`[data-expense-id="${first}"]`)).toBeVisible();
  await expect(row(b,first)).toContainText('已付款');
  await pickUp(a,groupHandle(a,'住宿'));
  const peerGroup=category(b,'住宿').locator('.bw-group');
  await expect(peerGroup.locator('.bw-remote-move')).toBeVisible();
  await expect(peerGroup.locator('.bw-collaboration-outline')).toHaveAttribute('data-user',f.A);
  await expect(groupHandle(b,'住宿')).toHaveCount(0);
  await expect(itemHandle(b,'跨分類測試')).toBeEnabled();
  await a.keyboard.press('Escape');
  await a.mouse.up();
  await expect(groupHandle(b,'住宿')).toBeEnabled();
  expect(a.qaErrors).toEqual([]);
  expect(b.qaErrors).toEqual([]);
 }finally{await aContext.close();await bContext.close();await f.close();}
});
