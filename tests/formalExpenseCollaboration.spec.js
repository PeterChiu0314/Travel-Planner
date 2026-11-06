import {test,expect} from '@playwright/test';import {randomUUID as uuid} from 'node:crypto';
import {reviewFixture} from './helpers/expenseReviewFixture.js';import {boot,enableMetadata} from './helpers/expenseBackend.js';
const row=(p,title='Review')=>p.locator('.bw-row').filter({has:p.getByRole('button',{name:title,exact:true})});
const outline=(p,user,title='Review')=>row(p,title).locator(`.bw-collaboration-outline[data-user="${user}"]`);
async function open(p,f,actor=f.A){await enableMetadata(p);await boot(p,f.db,actor);}
async function select(p,title='Review'){await row(p,title).getByRole('button',{name:title,exact:true}).click();}
async function hidden(p,value){await p.evaluate(value=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:value?'hidden':'visible'});document.dispatchEvent(new Event('visibilitychange'));},value);}
test('new trip obtains its initial quote before the trip INSERT',async({page})=>{
 const f=await reviewFixture();try{await open(page,f);await page.evaluate(()=>{const client=window.budgetMock.client,from=client.from.bind(client);client.from=table=>{const query=from(table);if(table==='trips')query.insert=async payload=>{window.capturedTrip=payload;return{error:{message:'QA captured without inserting'}};};return query;};});await page.getByRole('button',{name:'新增旅程',exact:true}).click();const form=page.locator('form.create-trip-dialog');await form.getByRole('textbox',{name:'旅程名稱',exact:true}).fill('Initial rates');await form.getByRole('button',{name:'建立',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.capturedTrip?.budget_exchange_rates?.rates?.JPY)).toBe(.25);expect(f.db.quoteReads).toBe(1);expect(page.qaErrors).toEqual([]);}finally{await page.close();f.c.dispose();await f.close();}
});
test('missing planning quote initializes once, while traveling budget view never fetches or updates rates',async({page,context})=>{
 const f=await reviewFixture();try{
  await f.sql.exec('reset role');await f.sql.query("update public.trips set budget_exchange_rates='{}' where id=$1",[f.trip]);f.db.trips[0].budget_exchange_rates={};await open(page,f);
  await expect.poll(()=>f.db.expenseCalls.filter(c=>c.name==='update_expense_rates').length).toBe(1);await expect.poll(async()=>(await f.snapshot()).rates.rates.JPY).toBe(.25);await page.getByRole('tab',{name:'項目明細',exact:true}).click();await page.getByRole('tab',{name:'旅程統計',exact:true}).click();expect(f.db.expenseCalls.filter(c=>c.name==='update_expense_rates')).toHaveLength(1);
  await page.close();f.db.trips[0].start_date='2020-01-01';f.db.trips[0].end_date='2020-01-10';await f.sql.exec('reset role');await f.sql.query("update public.trips set budget_exchange_rates='{}' where id=$1",[f.trip]);f.db.trips[0].budget_exchange_rates={};const peer=await context.newPage();try{const before=f.db.quoteReads;await open(peer,f);await peer.getByRole('tab',{name:'預算',exact:true}).click();await expect(peer.getByRole('button',{name:'更新匯率',exact:true})).toBeDisabled();expect(f.db.quoteReads).toBe(before);expect(f.db.expenseCalls.filter(c=>c.name==='update_expense_rates')).toHaveLength(1);expect(peer.qaErrors).toEqual([]);}finally{await peer.close();}
 }finally{if(!page.isClosed())await page.close();f.c.dispose();await f.close();}
});
test('55000 rates refusal allows sidebar navigation and removes the unload guard without automatic replay',async({page})=>{
 const f=await reviewFixture();try{const original=f.db.request;let writes=0;f.db.request=async args=>args.name==='update_expense_rates'?(writes++,{error:{code:'55000',message:'Use atomic rates protocol'}}):original(args);
  await open(page,f);await page.getByRole('button',{name:'更新匯率',exact:true}).click();await expect.poll(()=>writes).toBe(1);await page.getByRole('button',{name:'行程路線',exact:true}).click();await expect(page.getByRole('region',{name:'支出工作區'})).toBeHidden();await expect(page.getByRole('dialog')).toHaveCount(0);expect(writes).toBe(1);await page.screenshot({path:test.info().outputPath('rates-refusal-navigation-recovered.png')});
  let unload=false;page.on('dialog',async d=>{unload=true;await d.accept();});await page.reload();expect(unload).toBe(false);expect(page.qaErrors).toEqual([]);
 }finally{await page.close();f.c.dispose();await f.close();}
});
test('idle pricing modes work on the first click without focusing the sidebar; a peer lease still blocks changes',async({page,context})=>{
 const f=await reviewFixture(),peer=await context.newPage();try{
  await open(page,f);await select(page);await page.getByRole('tab',{name:'編輯項目',exact:true}).click();const group=page.getByRole('group',{name:'預算計價與分攤',exact:true}),custom=group.getByRole('button',{name:'自訂分攤',exact:true});await expect(custom).toBeEnabled();expect(f.db.expenseCalls.filter(c=>c.name==='expense_group_lease'&&c.args.p_group==='budget')).toHaveLength(0);await custom.click();await expect(custom).toHaveAttribute('aria-pressed','true');await expect.poll(async()=>(await f.snapshot()).items[0].budget.pricing_mode).toBe('custom');
  await open(peer,f,f.B);await select(peer);await peer.getByRole('tab',{name:'編輯項目',exact:true}).click();const other=peer.getByRole('group',{name:'預算計價與分攤',exact:true});await expect(other.getByRole('button',{name:'總額均分',exact:true})).toBeDisabled();await page.screenshot({path:test.info().outputPath('idle-mode-first-click.png')});expect(page.qaErrors).toEqual([]);expect(peer.qaErrors).toEqual([]);
 }finally{await page.close();await peer.close();f.c.dispose();await f.close();}
});
test('one to four selectors update an open avatar cluster; newest selection and editor priority choose one color',async({page})=>{
 const f=await reviewFixture(),people=[f.B,uuid(),uuid(),uuid()],sessions=people.map(()=>uuid()),activities=people.map(()=>uuid());
 const hint=(n,action='select')=>f.rpc('update_expense_selection',{p_trip_id:f.trip,p_session_id:sessions[n],p_kind:'expense',p_id:f.id,p_activity_id:activities[n],p_action:action},people[n]);
 try{
  await f.sql.exec('reset role');for(let n=1;n<4;n++)await f.sql.query('insert into public.trip_members values($1,$2,$3,$4,$5,$6)',[f.trip,people[n],`Member${n}`,'peer@qa.invalid','approved','editor']);await open(page,f);
  for(let n=0;n<4;n++){expect((await hint(n)).error).toBeUndefined();await expect(outline(page,people[n])).toHaveCount(1);if(n===0)await row(page).hover();await expect(page.locator('.bw-row-peer-tooltip .bw-peer-avatar')).toHaveCount(n+1);await expect(row(page).locator('.bw-collaboration-outline')).toHaveCount(1);}
  // A second tab for the same account must not add a second avatar.
  await f.rpc('update_expense_selection',{p_trip_id:f.trip,p_session_id:uuid(),p_kind:'expense',p_id:f.id,p_activity_id:uuid(),p_action:'select'},people[0]);await expect(outline(page,people[0])).toHaveCount(1);await expect(page.locator('.bw-row-peer-tooltip .bw-peer-avatar')).toHaveCount(4);
  const token=uuid(),sid=uuid(),lease=await f.rpc('expense_group_lease',{p_id:f.id,p_group:'title',p_session_id:sid,p_token:token,p_action:'acquire',p_base:0,p_epoch:null},people[1]);expect(lease.data.granted).toBe(true);await expect(outline(page,people[1])).toHaveAttribute('data-mode','edit');
  await f.rpc('expense_group_lease',{p_id:f.id,p_group:'title',p_session_id:sid,p_token:token,p_action:'release',p_base:0,p_epoch:lease.data.epoch},people[1]);await expect(outline(page,people[0])).toHaveAttribute('data-mode','selection');
  await hint(3,'clear');await expect(page.locator('.bw-row-peer-tooltip .bw-peer-avatar')).toHaveCount(3);expect(page.qaErrors).toEqual([]);
 }finally{await page.close();f.c.dispose();await f.close();}
});
test('two accounts see selection colors immediately, edit priority wins across a third same-account tab, and leaving clears it',async({page,context})=>{
 const f=await reviewFixture(),peer=await context.newPage(),third=await context.newPage();try{await f.sql.exec('reset role');await f.sql.query("insert into expense_stage_b.expense_items(id,trip_id,title,payment_state) values($1,$2,'Second','unpaid')",[uuid(),f.trip]);await open(page,f);await open(peer,f,f.B);await open(third,f);
  await select(page);await expect(outline(peer,f.A)).toHaveAttribute('data-mode','selection');const rect=await row(peer).boundingBox(),border=await outline(peer,f.A).boundingBox();expect(border.width).toBeGreaterThan(rect.width-12);expect(await outline(peer,f.A).evaluate(e=>getComputedStyle(e).boxShadow)).not.toBe('none');await row(peer).hover();await expect(peer.getByRole('tooltip').locator('.bw-peer-avatar')).toHaveCount(1);await expect(peer.getByRole('tooltip')).not.toContainText('選取');
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
  await peer.getByRole('group',{name:'項目名稱',exact:true}).focus();await expect(peer.getByRole('tooltip')).toContainText('A 正在編輯項目名稱');await expect(peer.getByRole('group',{name:'項目名稱',exact:true}).locator('.bw-collaboration-outline')).toHaveCount(0);await peer.screenshot({path:test.info().outputPath('input-only-peer-border.png')});await peer.getByRole('textbox',{name:'備註',exact:true}).focus();await expect(peer.getByRole('textbox',{name:'備註',exact:true})).toBeEditable();
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
test('five editors use one outline and at most four overlapping avatars plus overflow; live departure clears focus tooltip',async({page})=>{
 const f=await reviewFixture();try{const people=[f.A,f.B,uuid(),uuid(),uuid()],groups=['title','note','category','payer','links'];await f.sql.exec('reset role');for(let n=2;n<people.length;n++)await f.sql.query('insert into public.trip_members values($1,$2,$3,$4,$5,$6)',[f.trip,people[n],`Peer${n}`,'peer@qa.invalid','approved','editor']);
  for(let n=0;n<people.length;n++){const r=await f.rpc('expense_group_lease',{p_id:f.id,p_group:groups[n],p_session_id:uuid(),p_token:uuid(),p_action:'acquire',p_base:0,p_epoch:null},people[n]);expect(r.data.granted).toBe(true);}
  await open(page,f);await expect(row(page).locator('.bw-collaboration-outline')).toHaveCount(1);await row(page).hover();await expect(page.getByRole('tooltip').locator('.bw-peer-avatar:not(.bw-peer-more)')).toHaveCount(4);await expect(page.getByRole('tooltip').locator('.bw-peer-more')).toHaveText('+1');await expect(page.getByRole('tooltip')).not.toContainText('編輯');await expect(page.getByRole('tooltip')).not.toContainText('Peer');
  await row(page).focus();await expect(page.getByRole('tooltip')).toBeVisible();await page.screenshot({path:test.info().outputPath('single-outline-avatars.png')});
  await row(page).evaluate(e=>e.blur());await page.setViewportSize({width:390,height:844});await row(page).focus();await expect(page.getByRole('tooltip')).toBeVisible();const bounds=await page.getByRole('tooltip').boundingBox();expect(bounds.x+bounds.width).toBeLessThanOrEqual(390);await page.screenshot({path:test.info().outputPath('narrow-avatars.png')});
  await f.sql.exec('reset role');await f.sql.exec("update expense_stage_b.groups set expires_at=clock_timestamp()-interval '1 second'");await page.evaluate(()=>window.budgetMock.emit('expense_signals'));await expect(row(page).locator('.bw-collaboration-outline')).toHaveCount(0);await expect(page.getByRole('tooltip')).toHaveCount(0);expect(page.qaErrors).toEqual([]);
 }finally{await page.close();f.c.dispose();await f.close();}
});
