import {test,expect} from '@playwright/test';
import {metadataBackend,boot,enableMetadata} from './helpers/budgetMetadataMock.js';
import {lifecycleBackend,enableLifecycle} from './helpers/budgetLifecycleMock.js';
import {collaboratorColor} from '../src/lib/collaboratorColors.js';
const editor=p=>p.getByRole('region',{name:'預算群組編輯'});
const group=p=>editor(p).getByRole('group',{name:'計價與分攤',exact:true});
const amount=p=>group(p).getByRole('spinbutton',{name:'總額',exact:true});
const title=p=>editor(p).getByRole('textbox',{name:'項目名稱',exact:true});
function fixture(){const db=metadataBackend();db.extendedMetadata=true;db.pricingMetadata=true;Object.assign(db.rows.budget_items[0],{currency:'TWD',exchange_rate:1,amount:10000,twd_amount:10000});return db;}
async function ready(p,db,actor='A'){await enableMetadata(p);await boot(p,db,actor);await p.getByRole('button',{name:'JPY fare',exact:true}).click();await p.getByRole('tab',{name:'編輯項目',exact:true}).click();await expect(title(p)).toBeVisible();}
test.afterEach(async({page})=>{if(page.qaErrors)expect(page.qaErrors).toEqual([]);});

test('split 10000 becomes 5000+5000, every custom amount stays editable and total becomes 12000',async({page})=>{
 const db=fixture();await ready(page,db);await expect(group(page).locator('details')).not.toHaveAttribute('open','');expect(db.groupCalls).toHaveLength(0);
 await group(page).focus();await expect(group(page).getByRole('button',{name:'自訂分攤',exact:true})).toBeEnabled();await group(page).getByRole('button',{name:'自訂分攤',exact:true}).click();
 for(const name of ['A','B'])await expect(group(page).getByRole('spinbutton',{name:`${name} 分攤金額`,exact:true})).toHaveValue('5000');
 await group(page).getByRole('spinbutton',{name:'A 分攤金額',exact:true}).fill('7000');await expect(amount(page)).toHaveValue('12000');
 await expect.poll(()=>db.rows.budget_items[0].amount).toBe(12000);expect(db.rows.budget_item_participants.filter(p=>p.budget_item_id==='budget').map(p=>p.share_amount)).toEqual([7000,5000]);
 await expect(editor(page).locator('.bw-metadata-status,.bw-metadata-actions,[role=alert]')).toHaveCount(0);await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
 await page.screenshot({path:test.info().outputPath('custom-split.png')});
});

test('manual exclusions survive all modes; a new custom participant starts at zero without changing existing amounts',async({page})=>{
 const db=fixture();db.members.push({trip_id:'trip',user_id:'C',role:'editor',status:'approved',display_name:'C'});await ready(page,db);
 await group(page).focus();await expect(group(page).getByRole('button',{name:'自訂分攤',exact:true})).toBeEnabled();await group(page).getByRole('button',{name:'自訂分攤',exact:true}).click();
 const boxes=group(page).getByRole('checkbox');await expect(boxes.nth(2)).not.toBeChecked();await boxes.nth(2).check();
 await expect(group(page).getByRole('spinbutton',{name:'C 分攤金額',exact:true})).toHaveValue('0');await expect(amount(page)).toHaveValue('10000');
 await expect.poll(()=>db.rows.budget_item_participants.filter(p=>p.budget_item_id==='budget').length).toBe(3);
 await boxes.nth(1).uncheck();await group(page).getByRole('button',{name:'每人計價',exact:true}).click();
 await group(page).getByRole('spinbutton',{name:'每人單價',exact:true}).fill('1000');await expect.poll(()=>db.rows.budget_items[0].amount).toBe(2000);
 await group(page).getByRole('button',{name:'總額均分',exact:true}).click();await group(page).getByRole('button',{name:'自訂分攤',exact:true}).click();await expect(boxes.nth(1)).not.toBeChecked();
});

test('temporary empty amount is only a draft; real failures toast once and recover without field actions',async({page})=>{
 const db=fixture();await ready(page,db);await amount(page).focus();await expect(amount(page)).toBeEditable();await amount(page).fill('');
 await expect(page.getByRole('status',{name:'預算同步狀態'})).toHaveCount(0);await page.waitForTimeout(1300);
 expect(db.groupCalls.filter(c=>c.name==='patch_budget_metadata_group')).toHaveLength(0);await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
 db.patchError={code:'XX000',message:'server unavailable'};await amount(page).fill('11000');await expect(page.locator('[data-sonner-toast]')).toHaveCount(1);
 await expect(editor(page).getByRole('button',{name:/^重試$|捨棄此欄草稿|確認儲存結果/})).toHaveCount(0);await expect(editor(page).getByRole('alert')).toHaveCount(0);
 await expect.poll(()=>db.groupCalls.filter(c=>c.name==='patch_budget_metadata_group').length,{timeout:10000}).toBeGreaterThanOrEqual(2);await expect(page.locator('[data-sonner-toast]')).toHaveCount(1);
 db.patchError=null;await expect.poll(()=>db.rows.budget_items[0].amount,{timeout:12000}).toBe(11000);await expect(page.getByRole('status',{name:'預算同步狀態'})).toHaveCount(0);
});

test('two users see the existing collaborator color with hover/focus name, no field status or normal-contention Toast',async({page,context})=>{
 const db=fixture();await ready(page,db);await title(page).focus();await expect(title(page)).toBeEditable();const peer=await context.newPage();
 try{await ready(peer,db,'B');await title(peer).focus();await expect(title(peer)).not.toBeEditable();const frame=editor(peer).getByRole('group',{name:'項目名稱',exact:true});
  await expect(frame.locator('.bw-collaboration-controls')).toHaveAttribute('style',new RegExp(collaboratorColor('A')));await expect(frame.locator('.bw-collaboration-outline')).toHaveCount(0);await expect(peer.getByRole('tooltip').filter({hasText:'A 正在編輯項目名稱'})).toBeVisible();
  await frame.hover();await expect(peer.getByRole('tooltip').filter({hasText:'A 正在編輯項目名稱'})).toBeVisible();await expect(editor(peer).locator('.bw-metadata-status,.bw-metadata-actions,[role=alert]')).toHaveCount(0);await expect(peer.locator('[data-sonner-toast]')).toHaveCount(0);
  const note=editor(peer).getByRole('textbox',{name:'備註',exact:true});await note.focus();await expect(note).toBeEditable();await note.fill('Peer note');await expect.poll(()=>db.rows.budget_items[0].note).toBe('Peer note');expect(peer.qaErrors).toEqual([]);
  await peer.screenshot({path:test.info().outputPath('peer-outline.png')});
 }finally{await peer.close();}
});

for(const kind of ['budget','actual'])test(`new ${kind} defaults approved members in the display, requires pricing authority and keeps blank amount incomplete`,async({page})=>{
 const db=lifecycleBackend();db.members.push({trip_id:'trip',user_id:'P',status:'pending',role:'editor',display_name:'Pending'});if(kind==='actual'){db.trips[0].start_date='2020-04-05';db.trips[0].end_date='2020-04-10';}
 await enableLifecycle(page);await boot(page,db);await page.getByRole('button',{name:kind==='budget'?'新增預算':'新增實付',exact:true}).click();
 const region=page.getByRole('region',{name:kind==='budget'?'預算群組編輯':'實付群組編輯'}),pricing=region.getByRole('group',{name:'計價與分攤',exact:true});
 await expect(pricing.getByText('參與成員 · 2 人',{exact:true})).toBeVisible();await expect(pricing.locator('details')).not.toHaveAttribute('open','');await expect(pricing.getByRole('spinbutton',{name:'總額',exact:true})).toHaveValue('');
 const row=(kind==='budget'?db.rows.budget_items:db.rows.actual_expenses).at(-1);expect(row.pricing_ready).toBe(false);expect((kind==='budget'?db.rows.budget_item_participants:db.rows.actual_expense_participants).filter(p=>p[kind==='budget'?'budget_item_id':'actual_expense_id']===row.id)).toHaveLength(0);
 await pricing.focus();const input=pricing.getByRole('spinbutton',{name:'總額',exact:true});await expect(input).toBeEditable();await input.fill('1000');await input.blur();
 await expect.poll(()=>(kind==='budget'?db.rows.budget_items:db.rows.actual_expenses).at(-1).pricing_ready).toBe(true);const people=(kind==='budget'?db.rows.budget_item_participants:db.rows.actual_expense_participants).filter(p=>p[kind==='budget'?'budget_item_id':'actual_expense_id']===row.id);expect(people.map(p=>p.user_id).sort()).toEqual(['A','B']);
});
