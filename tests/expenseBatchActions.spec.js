import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { boot } from './helpers/expenseBackend.js';
import { departureFixture } from './helpers/expenseDepartureFixture.js';

test('budget row and batch actions keep their alignment and copy only budget data',async({page})=>{
 const f=await departureFixture();
 try{
  const first=await f.seed('批次交通', {amount:901}, {paid:true,payer:f.A});
  const second=await f.seed('批次午餐', {pricing_mode:'custom',shares:{[f.A]:120,[f.B]:300,[f.C]:480}});
  const third=await f.seed('單列刪除', {});
  const stop=randomUUID();
  await f.sql.query("insert into public.itinerary_items(id,trip_id,day_index,sort_order,type,title) values($1,$2,0,0,'attraction','測試行程')",[stop,f.trip]);
  await f.sql.query('insert into expense_stage_b.expense_itinerary_links(expense_id,trip_id,itinerary_item_id) values($1,$2,$3)',[first,f.trip,stop]);
  const before=await f.snapshot();
  await boot(page,f.db,f.A);
  const remove=page.getByRole('button',{name:'刪除「單列刪除」'});
  await expect(remove).toHaveCSS('opacity','0');
  await page.getByRole('button',{name:'單列刪除',exact:true}).hover();
  await expect(remove).toHaveCSS('opacity','1');
  const x=await remove.boundingBox();
  await remove.click();
  let dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'取消',exact:true}).click();
  await expect(remove).toHaveCount(1);

  await page.getByRole('button',{name:'多選',exact:true}).click();
  const close=await page.getByRole('button',{name:'關閉多選'}).boundingBox();
  const checkbox=page.getByRole('checkbox',{name:'選取「批次交通」'});
  const box=await checkbox.boundingBox();
  expect(Math.abs((x.x+x.width/2)-(close.x+close.width/2))).toBeLessThan(1);
  expect(Math.abs((box.x+box.width/2)-(close.x+close.width/2))).toBeLessThan(1);
  await checkbox.check();
  await expect(page.getByRole('checkbox',{name:'全選可見項目'})).toHaveJSProperty('indeterminate',true);
  await page.getByRole('checkbox',{name:'選取「批次午餐」'}).check();
  await expect(page.getByText('已選 2 筆',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'複製所選項目'}).click();
  await expect(page.getByRole('button',{name:'批次交通（副本）',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'批次午餐（副本）',exact:true})).toBeVisible();
  const after=await f.snapshot();
  for(const [id,title] of [[first,'批次交通'],[second,'批次午餐']]){
   const source=before.items.find(item=>item.id===id),copy=after.items.find(item=>item.title===title+'（副本）');
   expect(copy).toMatchObject({budget:source.budget,category:source.category,paid:null,paid_at:null,payer_id:null,payer_allocations:[],payment_mode:'self',payment_state:'unpaid'});
   const shares=(snapshot,id)=>snapshot.participants.filter(row=>row.expense_id===id).map(({user_id,budget_selected,budget_share_amount})=>({user_id,budget_selected,budget_share_amount}));
   expect(shares(after,copy.id)).toEqual(shares(before,id));
   expect(after.links.filter(link=>link.expense_id===copy.id).map(link=>link.itinerary_item_id)).toEqual(id===first?[stop]:[]);
  }

  await checkbox.check();
  await page.getByRole('checkbox',{name:'選取「批次午餐」'}).check();
  await page.getByRole('button',{name:'刪除所選項目'}).click();
  dialog=page.getByRole('dialog',{name:'刪除 2 筆支出項目？'});
  await dialog.getByRole('button',{name:'刪除',exact:true}).click();
  await expect(page.getByRole('button',{name:'批次交通',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'批次午餐',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'關閉多選'}).click();
  await page.getByRole('button',{name:'單列刪除',exact:true}).hover();
  await remove.click();
  f.db.dropAck=true;
  await page.getByRole('dialog').getByRole('button',{name:'刪除',exact:true}).click();
  await expect(remove).toHaveCount(0);
  expect((await f.snapshot()).items.some(item=>[first,second,third].includes(item.id))).toBe(false);
  const deletes=()=>f.db.expenseCalls.filter(call=>call.name==='mutate_expense_group'&&call.args.p_id===third);
  await expect.poll(()=>deletes().length,{timeout:12000}).toBe(2);
  expect(deletes()[1].args).toEqual(deletes()[0].args);
  expect(page.qaErrors).toEqual([]);
 }finally{await page.close();await f.close();}
});

test('filtered select-all and batch retries preserve the correct targets without duplicates',async({page})=>{
 const f=await departureFixture();
 try{
  const first=await f.seed('重試機票',{});
  const second=await f.seed('重試晚餐',{});
  await f.seed('其他項目',{});
  const request=f.db.request.bind(f.db);
  let lost=false;
  f.db.request=async req=>{
   const result=await request(req);
   if(!lost&&req.name==='copy_expense_item'&&req.args.p_source_id===first&&result.data?.committed){
    lost=true;return {error:{message:'ACK lost'}};
   }
   return result;
  };
  await boot(page,f.db,f.A);
  await page.getByRole('textbox',{name:'搜尋項目'}).fill('重試');
  await page.getByRole('button',{name:'多選',exact:true}).click();
  await page.getByRole('checkbox',{name:'全選可見項目'}).check();
  await expect(page.getByText('已選 2 筆',{exact:true})).toBeVisible();
  const copy=page.getByRole('button',{name:'複製所選項目'});
  await copy.click();
  await expect(page.getByText('已複製 1 筆，待確認 1 筆',{exact:true})).toBeVisible();
  await expect(page.getByRole('checkbox',{name:'選取「重試機票」'})).toBeChecked();
  await expect(page.getByRole('checkbox',{name:'選取「重試晚餐」'})).not.toBeChecked();
  await copy.click();
  await expect(page.getByText('已選 0 筆',{exact:true})).toBeVisible();
  const calls=f.db.expenseCalls.filter(call=>call.name==='copy_expense_item'&&call.args.p_source_id===first);
  expect(calls).toHaveLength(2);
  expect(calls[1].args).toEqual(calls[0].args);
  const after=await f.snapshot();
  expect(after.items.filter(item=>item.title.endsWith('（副本）')).map(item=>item.title).sort()).toEqual(['重試晚餐（副本）','重試機票（副本）'].sort());

  const peer=await f.lease(first,'title',f.B);
  expect(peer.result.data?.granted).toBe(true);
  const firstOriginal=page.getByRole('checkbox',{name:'選取「重試機票」'});
  await firstOriginal.check();
  await page.getByRole('checkbox',{name:'選取「重試晚餐」'}).check();
  const removeSelected=()=>page.getByRole('button',{name:'刪除所選項目'}).click();
  const confirm=()=>page.getByRole('dialog').getByRole('button',{name:'刪除',exact:true}).click();
  await removeSelected();
  await confirm();
  await expect(page.getByText('已刪除 1 筆，失敗 1 筆',{exact:true})).toBeVisible();
  await expect(firstOriginal).toBeChecked();
  expect((await f.snapshot()).items.some(item=>item.id===second)).toBe(false);
  expect((await peer.release()).data?.settled).toBe(true);
  expect((await f.snapshot()).items.some(item=>item.id===first)).toBe(true);
  await removeSelected();
  await confirm();
  await expect(firstOriginal).toHaveCount(0);
 }finally{await page.close();await f.close();}
});

test('Demo copies and deletes multiple items through the same controls',async({page})=>{
 await page.goto('/demo/budget');
 const rows=page.locator('.bw-row');
 const button=page.getByRole('button',{name:'多選',exact:true});
 await expect(button).toBeEnabled();
 const count=await rows.count();
 expect(count).toBeGreaterThan(1);
 await button.click();
 await rows.nth(0).getByRole('checkbox').check();
 await rows.nth(1).getByRole('checkbox').check();
 await page.getByRole('button',{name:'複製所選項目'}).click();
 await expect(rows).toHaveCount(count+2);
 const copies=page.getByRole('checkbox',{name:/（副本）/});
 await copies.nth(0).check();
 await copies.nth(1).check();
 await page.getByRole('button',{name:'刪除所選項目'}).click();
 await page.getByRole('dialog').getByRole('button',{name:'刪除',exact:true}).click();
 await expect(rows).toHaveCount(count);
});
