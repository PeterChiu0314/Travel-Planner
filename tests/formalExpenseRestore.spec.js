import {test,expect} from '@playwright/test';
import {randomUUID as uuid} from 'node:crypto';
import {expenseBackend,boot,enableMetadata} from './helpers/expenseBackend.js';
import {newExpense,priceExpense,expenseRows,expenseSettlement} from '../src/lib/expenseItems.js';
import {expenseModels} from '../src/lib/expenseSnapshot.js';

async function fixture(){
 const f=await expenseBackend(),C=uuid();
 f.db.members.push({trip_id:f.trip,user_id:C,display_name:'C',status:'approved',role:'editor'});
 await f.sql.query('insert into public.trip_members values($1,$2,$3,$4,$5,$6)',[f.trip,C,'C','c@qa.invalid','approved','editor']);
 const make=(title,budget,paid,state='unpaid')=>{
  let item={...newExpense({id:uuid(),tripId:f.trip,members:f.db.members}),title,category:'交通',payer_id:f.A};
  if(budget!==null)item=priceExpense(item,'budget',{amount:budget,currency:'TWD',exchange_rate:1,pricing_mode:'split_total',participantIds:[f.A,f.B,C]},0);
  if(paid!==null)item=priceExpense(item,'paid',{amount:paid,currency:'TWD',exchange_rate:1,pricing_mode:'split_total',participantIds:[f.A,f.B]},0);
  return {...item,payment_state:state};
 };
 const models=[make('機場接送',10000,9500,'paid'),make('歷史午餐',null,800,'paid'),make('待填車票',null,null),make('免費接駁',0,null)];
 for(const model of models){const {item,participants}=expenseRows(model);
  await f.sql.query('insert into expense_stage_b.expense_items(id,trip_id,title,category,note,payer_id,budget,paid,payment_state,budget_decisions_known,paid_decisions_known) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[item.id,item.trip_id,item.title,item.category,item.note,item.payer_id,item.budget,item.paid,item.payment_state,item.budget_decisions_known,item.paid_decisions_known]);
  for(const p of participants)await f.sql.query('insert into expense_stage_b.expense_participants values($1,$2,$3,$4,$5,$6)',[p.expense_id,p.user_id,p.budget_selected,p.paid_selected,p.budget_share_amount,p.paid_share_amount]);
 }
 const stop=uuid();await f.sql.query('insert into public.itinerary_items values($1,$2,$3,$4)',[stop,f.trip,'機場',1]);
 await f.sql.query('insert into expense_stage_b.expense_itinerary_links values($1,$2,$3)',[models[0].id,f.trip,stop]);
 return {...f,C,models};
}
async function open(page,f,actor=f.A){await enableMetadata(page);await boot(page,f.db,actor);await expect(page.getByRole('tab',{name:'旅程統計',exact:true})).toHaveAttribute('aria-selected','true');}
const table=page=>page.getByRole('table',{name:'預算明細'});
test('restored toolbar, category table and statistics use budget ABC, not paid AB or settlement balance',async({page})=>{
 const f=await fixture();try{await open(page,f);
  await expect(page.getByRole('tab',{name:'實付',exact:true})).toHaveCount(0);
  await expect(table(page).getByRole('columnheader')).toHaveCount(5);
  const row=table(page).getByRole('row').filter({hasText:'機場接送'});await expect(row).toContainText('Day 2');await expect(row).toContainText('10,000');await expect(row).toContainText('3,333');
  await expect(table(page).getByRole('row').filter({hasText:'歷史午餐'})).toContainText('尚未填寫');
  await expect(table(page).getByRole('row').filter({hasText:'免費接駁'})).toContainText('0');
  const stats=page.getByRole('region',{name:'旅程費用摘要'});await expect(stats.locator('.bw-hero')).toContainText('3,333');await expect(stats).toContainText('10,000');await expect(stats.locator('.bw-paid-summary')).toContainText('1 / 2');
  await expect(page.locator('.bw-toolbar')).not.toContainText('更新匯率');await expect(page.locator('.bw-restored-rates')).toContainText('旅程估算匯率');
  await stats.getByRole('combobox',{name:'統計視角'}).click();await page.getByRole('option',{name:'C',exact:true}).click();await expect(stats.locator('.bw-hero')).toContainText(/3,33[34]/);
  const amounts=await stats.locator('section').filter({has:page.getByRole('heading',{name:'各成員預估負擔',exact:true})}).locator('b').allTextContents();expect(amounts.reduce((sum,value)=>sum+Number(value.replaceAll(',','')),0)).toBe(10000);
  const s=await f.snapshot(),settlement=expenseSettlement(expenseModels(s),s.members);expect(settlement.balances.reduce((sum,m)=>sum+m.paid,0)).toBe(10300);expect(settlement.balances.find(m=>m.user_id===f.C).shouldPay).toBe(0);
  await page.screenshot({path:test.info().outputPath('restored-statistics.png')});expect(page.qaErrors).toEqual([]);
 }finally{await page.close();await f.close();}
});
test('payment filter, search, category folds and explicit detail/edit tabs preserve original interaction',async({page})=>{
 const f=await fixture();try{await open(page,f);
  await page.getByRole('combobox',{name:'付款篩選'}).click();await page.getByRole('option',{name:'未付款',exact:true}).click();await expect(table(page).getByRole('button',{name:'機場接送',exact:true})).toHaveCount(0);
  await page.getByRole('combobox',{name:'付款篩選'}).click();await page.getByRole('option',{name:'全部項目',exact:true}).click();
  await page.getByRole('button',{name:'收合交通',exact:true}).click();await expect(table(page).getByRole('button',{name:'機場接送',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'展開所有分類',exact:true}).click();
  await page.getByRole('textbox',{name:'搜尋項目',exact:true}).fill('機場');await expect(table(page).locator('.bw-row')).toHaveCount(1);await table(page).getByRole('button',{name:'機場接送',exact:true}).click();
  await expect(page.getByRole('tab',{name:'項目明細',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.locator('.bw-detail')).toContainText('10,000');await expect(page.locator('.bw-detail')).not.toContainText('實付');await expect(page.locator('.bw-detail')).not.toContainText('差額');
  await page.getByRole('tab',{name:'編輯項目',exact:true}).click();const input=page.getByRole('textbox',{name:'項目名稱',exact:true});await input.focus();await expect(input).toBeEditable();await input.fill('機場接送更新');await input.blur();await expect.poll(async()=>(await f.snapshot()).items.find(i=>i.id===f.models[0].id).title).toBe('機場接送更新');
  await page.getByRole('tab',{name:'項目明細',exact:true}).click();await expect(page.getByRole('tab',{name:'項目明細',exact:true})).toHaveAttribute('aria-selected','true');
  await page.getByRole('tab',{name:'旅程統計',exact:true}).click();await table(page).getByRole('button',{name:'機場接送更新',exact:true}).click();await expect(page.getByRole('tab',{name:'旅程統計',exact:true})).toHaveAttribute('aria-selected','true');
  expect(page.qaErrors).toEqual([]);expect(f.db.expenseCalls.filter(c=>/budget_item|actual_expense/.test(c.name))).toEqual([]);
 }finally{await page.close();await f.close();}
});
test('peer-held fields keep member outline and readonly while free fields retain normal appearance',async({page,context})=>{
 const f=await fixture(),peer=await context.newPage();try{await open(page,f);await open(peer,f,f.B);
  for(const p of [page,peer]){await table(p).getByRole('button',{name:'機場接送',exact:true}).click();await p.getByRole('tab',{name:'編輯項目',exact:true}).click();}
  const title=page.getByRole('textbox',{name:'項目名稱',exact:true});await title.focus();await expect(title).toBeEditable();
  await expect.poll(()=>peer.getByRole('group',{name:'項目名稱',exact:true}).getAttribute('class'),{timeout:12000}).toContain('is-peer-held');
  await expect(peer.getByRole('textbox',{name:'項目名稱',exact:true})).not.toBeEditable();await expect(peer.getByRole('group',{name:'項目名稱',exact:true}).locator('[data-user]')).toHaveAttribute('data-user',f.A);
  await expect(peer.getByRole('group',{name:'備註',exact:true})).not.toHaveClass(/is-peer-held/);await peer.getByRole('textbox',{name:'備註',exact:true}).focus();await expect(peer.getByRole('textbox',{name:'備註',exact:true})).toBeEditable();
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);await peer.screenshot({path:test.info().outputPath('restored-collaboration.png')});expect(page.qaErrors).toEqual([]);expect(peer.qaErrors).toEqual([]);
 }finally{await page.close();await peer.close();await f.close();}
});
test('failed autosave keeps draft through Continue, and explicit discard returns to canonical detail',async({page})=>{
 const f=await fixture();try{await open(page,f);await table(page).getByRole('button',{name:'機場接送',exact:true}).click();await page.getByRole('tab',{name:'編輯項目',exact:true}).click();
  const original=f.db.request.bind(f.db);f.db.request=req=>req.name==='mutate_expense_group'&&req.args.p_group==='title'?Promise.resolve({error:{code:'22023',message:'Rejected test title'}}):original(req);
  const input=page.getByRole('textbox',{name:'項目名稱',exact:true});await input.focus();await expect(input).toBeEditable();await input.fill('保留我的草稿');await input.blur();
  await page.getByRole('tab',{name:'項目明細',exact:true}).click();const dialog=page.getByRole('dialog',{name:'您有未儲存的變更'});await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'繼續編輯',exact:true}).click();await expect(input).toHaveValue('保留我的草稿');
  await page.getByRole('tab',{name:'項目明細',exact:true}).click();await dialog.getByRole('button',{name:'不儲存',exact:true}).click();await expect(page.getByRole('tab',{name:'項目明細',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.locator('.bw-detail h3')).toHaveText('機場接送');expect((await f.snapshot()).items.find(i=>i.id===f.models[0].id).title).toBe('機場接送');
 }finally{await page.close();await f.close();}
});
test('new model pricing controls persist participant changes independently and delete uses lifecycle RPC',async({page})=>{
 const f=await fixture();try{await open(page,f);await table(page).getByRole('button',{name:'機場接送',exact:true}).click();await page.getByRole('tab',{name:'編輯項目',exact:true}).click();
  const group=page.getByRole('group',{name:'預算計價與分攤',exact:true});await group.focus();await group.getByText('參與成員 · 3 人',{exact:true}).click();await expect(group.getByRole('checkbox',{name:/^C\b/})).toBeEnabled();await group.getByRole('checkbox',{name:/^C\b/}).uncheck();await group.getByRole('button',{name:'總額均分',exact:true}).focus();
  await expect.poll(async()=>(await f.snapshot()).participants.find(p=>p.expense_id===f.models[0].id&&p.user_id===f.C).budget_selected).toBe(false);
  const s=await f.snapshot();expect(s.items.find(i=>i.id===f.models[0].id).paid.amount).toBe(10000);expect(s.participants.find(p=>p.expense_id===f.models[0].id&&p.user_id===f.C).paid_selected).toBe(false);
  await page.getByRole('tab',{name:'項目明細',exact:true}).click();await page.getByRole('button',{name:'刪除項目',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'刪除',exact:true}).click();await expect.poll(async()=>(await f.snapshot()).items.some(i=>i.id===f.models[0].id)).toBe(false);
  await page.getByRole('button',{name:'新增項目',exact:true}).click();await expect(page.getByRole('region',{name:'支出項目編輯'})).toBeVisible();expect((await f.snapshot()).items).toHaveLength(3);await page.getByRole('textbox',{name:'項目名稱',exact:true}).fill('Named new item');await page.getByRole('textbox',{name:'項目名稱',exact:true}).blur();await expect.poll(async()=>(await f.snapshot()).items.length).toBe(4);expect(page.qaErrors).toEqual([]);
 }finally{await page.close();await f.close();}
});
