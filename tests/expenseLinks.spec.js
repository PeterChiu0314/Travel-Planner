import {test,expect} from '@playwright/test';
import {randomUUID as uuid} from 'node:crypto';
import {boot} from './helpers/expenseBackend.js';
import {departureFixture} from './helpers/expenseDepartureFixture.js';

const dialog=page=>page.getByRole('dialog',{name:'關聯行程',exact:true});
const summary=page=>page.getByRole('group',{name:'關聯行程',exact:true});
const entry=page=>summary(page).getByRole('button',{name:/^(新增|編輯)關聯行程$/});
const status=page=>dialog(page).getByRole('status',{name:'關聯儲存狀態'});
const card=(page,name)=>dialog(page).getByRole('button',{name,exact:true});
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

test('Mini Dayboard pages and filters without losing selections and flushes the latest links on close',async({page})=>{
 const f=await departureFixture();
 try{
  const expense=await f.seed('多日關聯測試',{});
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
  const board=dialog(page).getByRole('region',{name:'多日行程'});
  await expect(board.getByRole('region',{name:/Day [1-4] 行程/})).toHaveCount(4);
  expect(await board.evaluate(node=>node.scrollWidth===node.clientWidth&&node.scrollHeight>node.clientHeight)).toBe(true);
  await expect(dialog(page).getByRole('checkbox')).toHaveCount(0);
  const twoCards=card(page,'首日美術館');
  await twoCards.first().click();
  await expect(twoCards.last()).toHaveAttribute('aria-pressed','true');
  await card(page,'第二天午餐').click();
  await dialog(page).getByRole('combobox',{name:'行程分類'}).selectOption('hotel');
  await expect(twoCards).toHaveCount(0);
  await expect(card(page,'第六日飯店')).toBeEnabled();
  await card(page,'第六日飯店').click();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  const ids=async()=>(await f.snapshot()).links.filter(link=>link.expense_id===expense).map(link=>link.itinerary_item_id).sort();
  await expect.poll(ids).toEqual([museum,meal,late].sort());
  const writes=f.db.expenseCalls.filter(call=>call.name==='mutate_expense_group'&&call.args.p_group==='links');
  expect(writes).toHaveLength(1);
  expect(writes[0].args.p_value.ids).toEqual([museum,meal,late].sort());
  await expect(entry(page)).toBeFocused();

  await entry(page).click();
  await dialog(page).getByRole('button',{name:'後一天'}).click();
  await expect(dialog(page).getByRole('region',{name:'Day 5 行程'})).toBeVisible();
  await dialog(page).getByRole('textbox',{name:'搜尋關聯行程'}).fill('第六日');
  await expect(card(page,'第六日飯店')).toHaveAttribute('aria-pressed','true');
  await dialog(page).getByRole('button',{name:'關閉關聯行程'}).click();
  await summary(page).getByRole('button',{name:'取消關聯 第六日飯店',exact:true}).click();
  await expect.poll(ids).toEqual([museum,meal].sort());
  expect(page.qaErrors).toEqual([]);
 }finally{await page.close();await f.close();}
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
  await expect(dialog(a).getByRole('button',{name:'取得編輯權',exact:true})).toBeEnabled();
  await expect(card(a,'測試行程')).toHaveAttribute('aria-pressed','true');
  await dialog(a).getByRole('button',{name:'取得編輯權',exact:true}).click();
  await expect(card(a,'其他行程')).toBeEnabled();
  await expect(entry(b)).toBeDisabled();
  await expect(entry(b)).toBeEnabled({timeout:24000});
  await expect(card(a,'其他行程')).toBeDisabled();
  await dialog(a).getByRole('button',{name:'取得編輯權',exact:true}).click();
  await expect(card(a,'其他行程')).toBeEnabled();
  await a.evaluate(()=>{
   Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
   document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(entry(b)).toBeEnabled();
  await a.evaluate(()=>{
   delete document.visibilityState;
   document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(dialog(a).getByRole('button',{name:'取得編輯權',exact:true})).toBeEnabled();
  expect((await f.snapshot()).links.some(link=>link.expense_id===first&&link.itinerary_item_id===museum)).toBe(true);
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
