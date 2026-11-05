import {test,expect} from '@playwright/test';import {randomUUID as uuid} from 'node:crypto';
import {reviewFixture} from './helpers/expenseReviewFixture.js';import {boot,enableMetadata} from './helpers/expenseBackend.js';
const row=(p,title='Review')=>p.locator('.bw-row').filter({has:p.getByRole('button',{name:title,exact:true})});
const outline=(p,user,title='Review')=>row(p,title).locator(`.bw-collaboration-outline[data-user="${user}"]`);
async function open(p,f,actor=f.A){await enableMetadata(p);await boot(p,f.db,actor);}
async function select(p,title='Review'){await row(p,title).getByRole('button',{name:title,exact:true}).click();}
async function hidden(p,value){await p.evaluate(value=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:value?'hidden':'visible'});document.dispatchEvent(new Event('visibilitychange'));},value);}
test('two accounts see selection colors immediately, edit priority wins across a third same-account tab, and leaving clears it',async({page,context})=>{
 const f=await reviewFixture(),peer=await context.newPage(),third=await context.newPage();try{await f.sql.exec('reset role');await f.sql.query("insert into expense_stage_b.expense_items(id,trip_id,title,payment_state) values($1,$2,'Second','unpaid')",[uuid(),f.trip]);await open(page,f);await open(peer,f,f.B);await open(third,f);
  await select(page);await expect(outline(peer,f.A)).toHaveAttribute('data-mode','selection');const rect=await row(peer).boundingBox(),border=await outline(peer,f.A).boundingBox();expect(border.width).toBeGreaterThan(rect.width-12);expect(await outline(peer,f.A).evaluate(e=>getComputedStyle(e).boxShadow)).not.toBe('none');await row(peer).hover();await expect(peer.getByRole('tooltip')).toContainText('A · 選取');
  expect(f.db.expenseCalls.filter(c=>c.name==='expense_group_lease')).toHaveLength(0);await peer.screenshot({path:test.info().outputPath('two-account-selection.png')});
  await select(third,'Second');await expect(outline(peer,f.A,'Second')).toHaveAttribute('data-mode','selection');await expect(outline(peer,f.A)).toHaveCount(0);
  await page.getByRole('tab',{name:'編輯項目',exact:true}).click();const input=page.getByRole('textbox',{name:'項目名稱',exact:true});await input.focus();await expect(input).toBeEditable();await expect(outline(peer,f.A)).toHaveAttribute('data-mode','edit');await expect(outline(peer,f.A,'Second')).toHaveCount(0);
  await input.blur();await expect(outline(peer,f.A,'Second')).toHaveAttribute('data-mode','selection');await expect(outline(peer,f.A)).toHaveCount(0);
  await third.getByRole('button',{name:'行程路線',exact:true}).click();await expect(outline(peer,f.A,'Second')).toHaveCount(0);await expect(outline(peer,f.A)).toHaveAttribute('data-mode','selection');expect(page.qaErrors).toEqual([]);expect(peer.qaErrors).toEqual([]);expect(third.qaErrors).toEqual([]);
 }finally{await page.close();await peer.close();await third.close();f.c.dispose();await f.close();}
});
test('peer field color/read-only coexists with independent editing; hidden workspace releases clean authority and resumes hints',async({page,context})=>{
 const f=await reviewFixture(),peer=await context.newPage();try{await open(page,f);await open(peer,f,f.B);for(const p of [page,peer]){await select(p);await p.getByRole('tab',{name:'編輯項目',exact:true}).click();}
  const title=page.getByRole('textbox',{name:'項目名稱',exact:true}),other=peer.getByRole('textbox',{name:'項目名稱',exact:true});await title.focus();await expect(title).toBeEditable();await expect(other).not.toBeEditable();await expect(peer.getByRole('group',{name:'項目名稱',exact:true}).locator('[data-user]')).toHaveAttribute('data-user',f.A);
  await peer.getByRole('group',{name:'項目名稱',exact:true}).focus();await expect(peer.getByRole('tooltip')).toContainText('A 正在編輯項目名稱');await peer.getByRole('textbox',{name:'備註',exact:true}).focus();await expect(peer.getByRole('textbox',{name:'備註',exact:true})).toBeEditable();
  await hidden(page,true);await expect.poll(async()=>(await f.snapshot()).groups.find(g=>g.id===f.id&&g.group==='title').held).toBe(false);await expect(outline(peer,f.A)).toHaveCount(0);await hidden(page,false);await expect(outline(peer,f.A)).toHaveAttribute('data-mode','edit');await title.focus();await expect(title).toBeEditable();await expect(other).not.toBeEditable();await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);expect(page.qaErrors).toEqual([]);expect(peer.qaErrors).toEqual([]);
 }finally{await page.close();await peer.close();f.c.dispose();await f.close();}
});
test('failed snapshot refresh makes native fields readonly without erasing input; reconnect requires authoritative read',async({page})=>{
 const f=await reviewFixture();try{await open(page,f);await select(page);await page.getByRole('tab',{name:'編輯項目',exact:true}).click();const title=page.getByRole('textbox',{name:'項目名稱',exact:true});await title.focus();await expect(title).toBeEditable();
  f.db.offline=true;await page.evaluate(()=>window.budgetMock.emit('expense_signals'));await expect(title).not.toBeEditable();await expect(title).toHaveValue('Review');f.db.offline=false;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await title.focus();await expect(title).toBeEditable();await title.fill('Reconnected safely');await title.blur();await expect.poll(async()=>(await f.snapshot()).items[0].title).toBe('Reconnected safely');expect(page.qaErrors).toEqual([]);
 }finally{await page.close();f.c.dispose();await f.close();}
});
test('shared Rates control uses native RPC and reprices unpaid forecast only',async({page})=>{
 const f=await reviewFixture();try{await f.sql.exec('reset role');await f.sql.query("update expense_stage_b.expense_items set budget=budget||$2::jsonb where id=$1",[f.id,{currency:'JPY',amount:1000,exchange_rate:.2,twd_amount:200}]);await open(page,f);await expect(row(page)).toContainText('200');await page.getByRole('button',{name:'更新匯率',exact:true}).click();await expect.poll(async()=>(await f.snapshot()).items[0].budget.twd_amount).toBe(250);expect(f.db.expenseCalls.some(c=>c.name==='update_expense_rates')).toBe(true);await expect(row(page)).toContainText('250');expect(page.qaErrors).toEqual([]);
 }finally{await page.close();f.c.dispose();await f.close();}
});
test('five editors retain every collaborator color and name through the original segmented outline',async({page})=>{
 const f=await reviewFixture();try{const people=[f.A,f.B,uuid(),uuid(),uuid()],groups=['title','note','category','payer','links'];await f.sql.exec('reset role');for(let n=2;n<people.length;n++)await f.sql.query('insert into public.trip_members values($1,$2,$3,$4,$5,$6)',[f.trip,people[n],`Peer${n}`,'peer@qa.invalid','approved','editor']);
  for(let n=0;n<people.length;n++){const r=await f.rpc('expense_group_lease',{p_id:f.id,p_group:groups[n],p_session_id:uuid(),p_token:uuid(),p_action:'acquire',p_base:0,p_epoch:null},people[n]);expect(r.data.granted).toBe(true);}
  await open(page,f);await expect(row(page).locator('.is-segmented')).toBeVisible();await row(page).hover();await expect(page.getByRole('tooltip').locator('span')).toHaveCount(5);expect(await row(page).locator('.is-segmented').evaluate(e=>getComputedStyle(e).borderImageSource)).toContain('linear-gradient');expect(page.qaErrors).toEqual([]);
 }finally{await page.close();f.c.dispose();await f.close();}
});
