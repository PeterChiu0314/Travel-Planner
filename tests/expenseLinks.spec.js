import {test,expect} from '@playwright/test';
import {randomUUID as uuid} from 'node:crypto';
import {boot} from './helpers/expenseBackend.js';
import {departureFixture} from './helpers/expenseDepartureFixture.js';

const dialog=page=>page.getByRole('dialog',{name:'選取關聯行程',exact:true});
const summary=page=>page.getByRole('group',{name:'關聯行程',exact:true});
const entry=page=>summary(page).getByRole('button',{name:/^(新增|編輯)關聯行程$/});
const status=page=>dialog(page).getByRole('status',{name:'關聯儲存狀態'});
const card=(page,name)=>dialog(page).getByRole('button',{name,exact:true});
const noManualLease=page=>expect(dialog(page).getByText(/取得編輯權/)).toHaveCount(0);
const visibility=(page,value)=>page.evaluate(visibilityState=>{
 Object.defineProperty(document,'visibilityState',{configurable:true,value:visibilityState});
 document.dispatchEvent(new Event('visibilitychange'));
},value);
async function edit(page,title){
 await page.locator('.bw-row').getByRole('button',{name:title,exact:true}).click();
 await page.getByRole('tab',{name:'編輯項目',exact:true}).click();
}
async function seedStop(f,title,day,type='attraction',sortOrder=0){
 const id=uuid();
 await f.sql.exec('reset role');
 await f.sql.query('insert into public.itinerary_items(id,trip_id,day_index,sort_order,type,title) values($1,$2,$3,$4,$5,$6)',
  [id,f.trip,day,sortOrder,type,title]);
 return id;
}

test('Mini Dayboard pans and filters without losing selections and flushes the latest links on close',async({page})=>{
 const f=await departureFixture();
 try{
  const expense=await f.seed('多日關聯測試',{});
  await f.sql.query("update expense_stage_b.expense_items set category='餐飲' where id=$1",[expense]);
  const museum=await seedStop(f,'首日美術館',0),meal=await seedStop(f,'第二天午餐',1,'food');
  const late=await seedStop(f,'第六日飯店',5,'hotel');
  for(let i=0;i<12;i++)await seedStop(f,`景點 ${i+1}`,0,'attraction',i+1);
  await f.syncItinerary();
  await page.setViewportSize({width:1440,height:900});
  const request=f.db.request.bind(f.db);
  f.db.request=async req=>{
   const result=await request(req);
   if(req.name==='read_expense_snapshot'&&result.data){
    const item=result.data.itineraryItems.find(row=>row.id===museum);
    // Two day projections of the same itinerary ID.
    result.data.itineraryItems.push({...item,day_index:1});
   }
   return result;
  };
  await boot(page,f.db,f.A);
  await edit(page,'多日關聯測試');
  await entry(page).click();
  const categories=dialog(page).getByRole('group',{name:'行程分類'});
  await expect(categories.getByRole('button',{name:'餐飲',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(card(page,'第二天午餐')).toHaveAttribute('aria-pressed','false');
  await expect(card(page,'首日美術館')).toHaveCount(0);
  await categories.getByRole('button',{name:'全部',exact:true}).click();
  const board=dialog(page).getByRole('region',{name:'多日行程'});
  await expect(board.getByRole('region',{name:/Day [1-6] 行程/})).toHaveCount(6);
  await expect(dialog(page).locator('.day-tab')).toHaveCount(0);
  await expect(dialog(page).getByRole('button',{name:/前一天|後一天/})).toHaveCount(0);
  expect(await board.evaluate(node=>node.scrollWidth>node.clientWidth&&node.scrollHeight>node.clientHeight)).toBe(true);
  await expect(dialog(page).getByRole('checkbox')).toHaveCount(0);
  const twoCards=card(page,'首日美術館');
  const box=await twoCards.last().boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width/2-75,box.y+box.height/2,{steps:8});
  await page.mouse.up();
  await expect.poll(()=>board.evaluate(node=>node.scrollLeft)).toBeGreaterThan(50);
  await expect(twoCards.first()).toHaveAttribute('aria-pressed','false');
  expect(f.db.expenseCalls.filter(call=>call.name==='mutate_expense_group'&&call.args.p_group==='links')).toHaveLength(0);
  await page.mouse.wheel(2000,0);
  await expect.poll(()=>board.evaluate(node=>Math.abs(node.scrollWidth-node.clientWidth-node.scrollLeft))).toBeLessThanOrEqual(1);
  await page.mouse.wheel(-2000,0);
  await expect.poll(()=>board.evaluate(node=>node.scrollLeft)).toBe(0);
  const headerBefore=await dialog(page).locator('header').boundingBox();
  const footerBefore=await dialog(page).locator('footer').boundingBox();
  await page.mouse.wheel(0,240);
  await expect.poll(()=>board.evaluate(node=>node.scrollTop)).toBeGreaterThan(0);
  expect(await board.evaluate(node=>node.scrollLeft)).toBe(0);
  expect(await dialog(page).locator('header').boundingBox()).toEqual(headerBefore);
  expect(await dialog(page).locator('footer').boundingBox()).toEqual(footerBefore);
  await twoCards.first().click();
  await expect(twoCards.last()).toHaveAttribute('aria-pressed','true');
  await card(page,'第二天午餐').click();
  const category=categories.getByRole('button',{name:'住宿',exact:true});
  expect((await category.boundingBox()).height).toBe(36);
  expect((await dialog(page).locator('.bw-link-search').boundingBox()).height).toBe(36);
  await category.press('Space');
  await expect(category).toHaveAttribute('aria-pressed','true');
  await expect(twoCards).toHaveCount(0);
  await expect(card(page,'第六日飯店')).toBeEnabled();
  await card(page,'第六日飯店').click();
  await page.mouse.click(12,12);
  await expect(dialog(page)).toHaveCount(0);
  const ids=async()=>(await f.snapshot()).links.filter(link=>link.expense_id===expense).map(link=>link.itinerary_item_id).sort();
  await expect.poll(ids).toEqual([museum,meal,late].sort());
  const writes=f.db.expenseCalls.filter(call=>call.name==='mutate_expense_group'&&call.args.p_group==='links');
  expect(writes).toHaveLength(1);
  expect(writes[0].args.p_value.ids).toEqual([museum,meal,late].sort());
  await expect(entry(page)).toBeFocused();

  await entry(page).click();
  await expect(categories.getByRole('button',{name:'餐飲',exact:true})).toHaveAttribute('aria-pressed','true');
  await categories.getByRole('button',{name:'全部',exact:true}).click();
  await board.press('ArrowRight');
  await expect.poll(()=>board.evaluate(node=>node.scrollLeft)).toBeGreaterThan(0);
  await dialog(page).getByRole('textbox',{name:'搜尋關聯行程'}).fill('第六日');
  await expect(card(page,'第六日飯店')).toHaveAttribute('aria-pressed','true');
  await dialog(page).getByRole('button',{name:'關閉關聯行程'}).click();
  await summary(page).getByRole('button',{name:'取消關聯 第六日飯店',exact:true}).click();
  await expect.poll(ids).toEqual([museum,meal].sort());
  expect(page.qaErrors).toEqual([]);
 }finally{await page.close();await f.close();}
});

test('touch swipes pan the Dayboard without toggling a card',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:820},hasTouch:true,isMobile:true});
 try{
  const page=await context.newPage();
  await page.goto('/demo/budget');
  await edit(page,'去程機票・桃園 → 關西');
  await entry(page).click();
  const board=dialog(page).getByRole('region',{name:'多日行程'});
  const first=board.locator('.bw-link-card').first();
  await expect(first).toBeEnabled();
  const checked=await first.getAttribute('aria-pressed');
  const {x,y,width,height}=await first.boundingBox();
  const input=await context.newCDPSession(page);
  const touch=(type,screenX,screenY)=>input.send('Input.dispatchTouchEvent',{
   type,touchPoints:type==='touchEnd'?[]:[{x:screenX,y:screenY}],
  });
  await touch('touchStart',x+width*.8,y+height/2);
  for(let step=1;step<=8;step++)await touch('touchMove',x+width*(.8-step*.07),y+height/2);
  await touch('touchEnd');
  await expect.poll(()=>board.evaluate(node=>node.scrollLeft)).toBeGreaterThan(50);
  await expect(first).toHaveAttribute('aria-pressed',checked);
  await expect(status(page)).toHaveText('已儲存');
 }finally{await context.close();}
});

test('links admission is per expense, replays an unknown close and recovers after going offline',async({browser})=>{
 test.setTimeout(55000);
 const f=await departureFixture(),aContext=await browser.newContext(),bContext=await browser.newContext();
 try{
  const first=await f.seed('共同支出',{}),second=await f.seed('另一筆支出',{});
  const museum=await seedStop(f,'測試行程',0),meal=await seedStop(f,'其他行程',1,'food');
  await f.syncItinerary();
  const a=await aContext.newPage(),b=await bContext.newPage();
  await boot(a,f.db,f.A);await boot(b,f.db,f.B);
  await edit(a,'共同支出');await edit(b,'共同支出');
  await entry(a).click();
  await expect(card(a,'測試行程')).toBeEnabled();
  await expect(entry(b)).toBeDisabled();
  await expect(summary(b).locator('.bw-collaboration-controls')).toHaveAttribute('data-user',f.A);
  const note=b.getByRole('textbox',{name:'備註',exact:true});
  await note.focus();
  await expect(note).toBeEditable();
  await note.fill('備註可獨立修改');
  await edit(b,'另一筆支出');
  await entry(b).click();await card(b,'其他行程').click();
  await dialog(b).getByRole('button',{name:'關閉關聯行程'}).click();
  await expect.poll(async()=>(await f.snapshot()).links.some(link=>link.expense_id===second&&link.itinerary_item_id===meal)).toBe(true);

  await dialog(a).getByRole('textbox',{name:'搜尋關聯行程'}).fill('測試');
  await card(a,'測試行程').click();
  f.db.dropAck=true;
  await dialog(a).getByRole('button',{name:'關閉關聯行程'}).click();
  const writes=()=>f.db.expenseCalls.filter(call=>call.name==='mutate_expense_group'&&call.args.p_group==='links'&&call.args.p_id===first);
  await expect.poll(()=>writes().length,{timeout:12000}).toBe(2);
  expect(writes()[0].args).toEqual(writes()[1].args);
  await edit(b,'共同支出');
  await expect(summary(b).getByText('Day 1 · 測試行程',{exact:true})).toBeVisible();
  await expect(entry(b)).toBeEnabled();

  await entry(a).click();await expect(card(a,'其他行程')).toBeEnabled();
  await aContext.setOffline(true);
  await expect(card(a,'其他行程')).toBeDisabled();
  await aContext.setOffline(false);
  await expect(status(a)).toHaveText('編輯已暫停');
  await noManualLease(a);
  await expect(card(a,'測試行程')).toHaveAttribute('aria-pressed','true');
  await dialog(a).getByRole('textbox',{name:'搜尋關聯行程'}).fill('其他');
  await expect(card(a,'其他行程')).toBeEnabled();
  await expect(entry(b)).toBeDisabled();
  const acquisitions=()=>f.db.expenseCalls.filter(call=>call.actor===f.A&&call.name==='expense_group_lease'
   &&call.args.p_id===first&&call.args.p_group==='links'&&call.args.p_action==='acquire');
  const beforeReturn=acquisitions().length;
  await visibility(a,'hidden');
  await expect(entry(b)).toBeEnabled();
  await visibility(a,'visible');
  await visibility(a,'visible');
  await expect(card(a,'其他行程')).toBeEnabled();
  await expect(status(a)).toHaveText('已儲存');
  await noManualLease(a);
  expect(acquisitions()).toHaveLength(beforeReturn+1);
  expect(acquisitions().at(-1).args.p_token).not.toBe(acquisitions().at(-2).args.p_token);
  await expect(entry(b)).toBeDisabled();

  await visibility(a,'hidden');
  await expect(entry(b)).toBeEnabled();
  await entry(b).click();
  await expect(card(b,'其他行程')).toBeEnabled();
  const snapshots=()=>f.db.expenseCalls.filter(call=>call.actor===f.A&&call.name==='read_expense_snapshot').length;
  const beforePeerReturn=snapshots();
  await visibility(a,'visible');
  await expect.poll(snapshots).toBeGreaterThan(beforePeerReturn);
  await expect(summary(a).locator('.bw-collaboration-controls')).toHaveAttribute('data-user',f.B);
  await expect(dialog(a)).toHaveCount(0);
  await dialog(b).getByRole('button',{name:'關閉關聯行程'}).click();
  await expect(entry(a)).toBeEnabled();
  expect(acquisitions()).toHaveLength(beforeReturn+1);
  expect((await f.snapshot()).links.some(link=>link.expense_id===first&&link.itinerary_item_id===museum)).toBe(true);
 }finally{await aContext.close();await bContext.close();await f.close();}
});

test('Mini Dayboard idle activity restores the first selection and a peer takeover closes the clean dialog',async({browser})=>{
 const f=await departureFixture(),aContext=await browser.newContext(),bContext=await browser.newContext();
 let admit;
 const admissionGate=new Promise(resolve=>{admit=resolve;});
 try{
  const id=await f.seed('閒置接手',{}),stop=await seedStop(f,'閒置後選取',0);
  await f.syncItinerary();
  const rpc=f.db.request.bind(f.db);
  const isAcquire=call=>call.name==='expense_group_lease'&&call.args.p_group==='links'&&call.args.p_action==='acquire';
  f.db.request=async call=>{if(isAcquire(call)&&call.actor===f.A)await admissionGate;return rpc(call);};
  const a=await aContext.newPage(),b=await bContext.newPage();
  await boot(a,f.db,f.A);await boot(b,f.db,f.B);
  await edit(a,'閒置接手');await edit(b,'閒置接手');
  await a.clock.install();
  await entry(a).click();
  await expect(status(a)).toHaveText('準備中…');
  await expect(card(a,'閒置後選取')).toBeDisabled();
  await noManualLease(a);
  admit();
  await expect(status(a)).toHaveText('已儲存');
  await expect(entry(b)).toBeDisabled();
  await a.clock.fastForward(21000);
  await expect(status(a)).toHaveText('編輯已暫停');
  await expect(entry(b)).toBeEnabled();
  await noManualLease(a);
  await card(a,'閒置後選取').hover();
  await a.clock.fastForward(5000);
  const acquisitions=()=>f.db.expenseCalls.filter(call=>isAcquire(call)&&call.actor===f.A);
  expect(acquisitions()).toHaveLength(1);
  await card(a,'閒置後選取').click();
  await expect(card(a,'閒置後選取')).toHaveAttribute('aria-pressed','true');
  await expect.poll(async()=>(await f.snapshot()).links.some(link=>link.expense_id===id&&link.itinerary_item_id===stop)).toBe(true);
  await expect(status(a)).toHaveText('已儲存');
  expect(acquisitions()).toHaveLength(2);
  await a.clock.fastForward(21000);
  await expect(status(a)).toHaveText('編輯已暫停');
  const board=dialog(a).getByRole('region',{name:'多日行程'});
  await board.press('ArrowRight');
  await expect(status(a)).toHaveText('已儲存');
  await expect(card(a,'閒置後選取')).toHaveAttribute('aria-pressed','true');
  expect(acquisitions()).toHaveLength(3);
  expect(f.db.expenseCalls.filter(call=>call.name==='mutate_expense_group'&&call.args.p_group==='links')).toHaveLength(1);
  await a.clock.fastForward(21000);
  await expect(status(a)).toHaveText('編輯已暫停');
  await expect(entry(b)).toBeEnabled();
  await entry(b).click();
  await expect(status(b)).toHaveText('已儲存');
  await expect(dialog(a)).toHaveCount(0);
  await expect(entry(a)).toBeDisabled();
  await expect(summary(a).locator('.bw-collaboration-controls')).toHaveAttribute('data-user',f.B);
  expect(acquisitions()).toHaveLength(3);
 }finally{admit();await aContext.close();await bContext.close();await f.close();}
});

test('Mini Dayboard keeps an unknown receipt across background and peer takeover',async({browser})=>{
 test.setTimeout(45000);
 const f=await departureFixture(),aContext=await browser.newContext(),bContext=await browser.newContext();
 try{
  const id=await f.seed('回執待確認',{});
  const first=await seedStop(f,'離開前的選取',0),second=await seedStop(f,'接手後的選取',1);
  await f.syncItinerary();
  const rpc=f.db.request.bind(f.db),attempts=[];
  let receiptsAvailable=false;
  f.db.request=async call=>{
   if(call.actor===f.A&&call.name==='mutate_expense_group'&&call.args.p_group==='links'){
    attempts.push(structuredClone(call.args));
    if(attempts.length===1)f.db.dropAck=true;
    else if(!receiptsAvailable)return {error:{message:'ACK unavailable'}};
   }
   return rpc(call);
  };
  const a=await aContext.newPage(),b=await bContext.newPage();
  await boot(a,f.db,f.A);await boot(b,f.db,f.B);
  await edit(a,'回執待確認');await edit(b,'回執待確認');
  await entry(a).click();await expect(status(a)).toHaveText('已儲存');
  await card(a,'離開前的選取').click();
  await visibility(a,'hidden');
  await expect(status(a)).toHaveText('儲存結果待確認');
  expect(attempts).toHaveLength(1);
  await aContext.setOffline(true);
  await f.sql.exec('reset role');
  await f.sql.query("update expense_stage_b.groups set expires_at=clock_timestamp()-interval '1 second' where expense_id=$1 and group_key='links'",[id]);
  await f.db.emit('expense_signals',{eventType:'UPDATE',new:{trip_id:f.trip}});
  await expect(entry(b)).toBeEnabled();
  await entry(b).click();await expect(status(b)).toHaveText('已儲存');
  await card(b,'接手後的選取').click();
  await expect(status(b)).toHaveText('已儲存');
  await aContext.setOffline(false);
  await visibility(a,'visible');
  await expect(status(a)).toHaveText('儲存結果待確認');
  await expect(card(a,'離開前的選取')).toHaveAttribute('aria-pressed','true');
  await expect(card(a,'接手後的選取')).toBeDisabled();
  await noManualLease(a);
  await expect(summary(a).locator('.bw-collaboration-controls')).toHaveAttribute('data-user',f.B);
  receiptsAvailable=true;
  await expect(dialog(a)).toHaveCount(0,{timeout:12000});
  expect(attempts.length).toBeGreaterThan(1);
  expect(attempts.every(args=>JSON.stringify(args)===JSON.stringify(attempts[0]))).toBe(true);
  expect((await f.snapshot()).links.filter(link=>link.expense_id===id).map(link=>link.itinerary_item_id).sort()).toEqual([first,second].sort());
 }finally{await aContext.close();await bContext.close();await f.close();}
});

test('closing during an in-flight save drains the later selection before releasing links',async({page})=>{
 const f=await departureFixture();
 let completeFirst;
 const gate=new Promise(resolve=>{completeFirst=resolve;});
 try{
  const expense=await f.seed('儲存進行中',{});
  const first=await seedStop(f,'景點甲',0),second=await seedStop(f,'景點乙',1);
  await f.syncItinerary();
  const request=f.db.request.bind(f.db);
  let blocked=false;
  f.db.request=async req=>{
   if(!blocked&&req.name==='mutate_expense_group'&&req.args.p_group==='links'){
    blocked=true;
    await gate;
   }
   return request(req);
  };
  await boot(page,f.db,f.A);
  await edit(page,'儲存進行中');
  await entry(page).click();
  await card(page,'景點甲').click();
  await expect.poll(()=>blocked).toBe(true);
  await expect(status(page)).toHaveText('儲存中…');
  await card(page,'景點乙').click();
  await dialog(page).getByRole('button',{name:'關閉關聯行程'}).click();
  await expect(dialog(page)).toHaveCount(0);
  completeFirst();
  await expect.poll(async()=>(await f.snapshot()).links.filter(link=>link.expense_id===expense).map(link=>link.itinerary_item_id).sort())
   .toEqual([first,second].sort());
  await expect.poll(async()=>(await f.snapshot()).groups.find(group=>group.id===expense&&group.group==='links').held).toBe(false);
  const writes=f.db.expenseCalls.filter(call=>call.name==='mutate_expense_group'&&call.args.p_group==='links');
  expect(writes.map(call=>call.args.p_value.ids)).toEqual([[first],[first,second].sort()]);
 }finally{completeFirst();await page.close();await f.close();}
});

test('an itinerary version change rejects the draft and deliberate reselection can save it',async({page})=>{
 const f=await departureFixture();
 try{
  const expense=await f.seed('版本驗證',{});
  const stop=await seedStop(f,'行程舊名',0);
  const second=await seedStop(f,'另一站',1);
  await f.syncItinerary();
  await boot(page,f.db,f.A);
  await edit(page,'版本驗證');
  await entry(page).click();
  await card(page,'行程舊名').click();
  await f.sql.exec('reset role');
  await f.sql.query("update public.itinerary_items set title='行程新名',updated_at=updated_at+interval '1 second' where id=$1",[stop]);
  await f.syncItinerary();
  await f.db.emit('expense_signals',{eventType:'UPDATE',new:{trip_id:f.trip}});
  await expect(card(page,'行程新名')).toHaveAttribute('aria-pressed','true');
  await card(page,'另一站').click();
  await expect(status(page)).toHaveText('儲存失敗，變更已保留');
  expect((await f.snapshot()).links.filter(link=>link.expense_id===expense)).toEqual([]);
  await expect(page.getByText('行程已變更，請重新選取受影響的行程。未儲存的關聯已保留。')).toBeVisible();
  await dialog(page).getByRole('button',{name:'關閉關聯行程'}).click();
  await expect(summary(page).getByText('Day 1 · 行程新名',{exact:true})).toBeVisible();
  await entry(page).click();
  await expect(card(page,'行程新名')).toBeEnabled();
  await card(page,'行程新名').click();
  await card(page,'行程新名').click();
  await expect(status(page)).toHaveText('已儲存');
  await expect.poll(async()=>(await f.snapshot()).links.filter(link=>link.expense_id===expense).map(link=>link.itinerary_item_id).sort())
   .toEqual([stop,second].sort());
 }finally{await page.close();await f.close();}
});
