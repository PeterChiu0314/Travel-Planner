import {test,expect} from '@playwright/test';
import {metadataBackend,boot,enableMetadata} from './helpers/budgetMetadataMock.js';
const title=p=>p.getByRole('textbox',{name:'項目名稱',exact:true});
const region=p=>p.getByRole('region',{name:'預算群組編輯'});
async function ready(p,db,actor='A') {await enableMetadata(p);await boot(p,db,actor);await p.getByRole('button',{name:'JPY fare',exact:true}).click();await p.getByRole('tab',{name:'編輯項目',exact:true}).click();await expect(title(p)).toBeVisible();}
async function choose(p,label,value) {await region(p).getByRole('combobox',{name:label,exact:true}).click();await p.getByRole('option',{name:value,exact:true}).click();}
const dbFor=()=>{const db=metadataBackend();db.extendedMetadata=true;db.rows.itinerary_items=[{id:'visit',trip_id:'trip',title:'Museum',type:'attraction',item_type:'visit',day_index:0,sort_order:0,date:'2090-04-05'}];return db;};
test.afterEach(async({page})=>{if(page.qaErrors)expect(page.qaErrors).toEqual([]);});
test('category and title two-client autosave converge without changing money',async({page,context})=>{
 const db=dbFor();await ready(page,db);const b=await context.newPage();try{await ready(b,db,'B');await title(b).focus();await title(b).fill('Remote title');await choose(page,'分類','餐飲');
 await expect.poll(()=>db.rows.budget_items[0].category).toBe('餐飲');await expect.poll(()=>db.rows.budget_items[0].title).toBe('Remote title');await expect(region(b).getByRole('combobox',{name:'分類',exact:true})).toHaveValue('餐飲');expect(db.rows.budget_items[0].twd_amount).toBe(200);expect(b.qaErrors).toEqual([]);
 }finally{await b.close();}
});
test('payer and note are independent, null is saved and first selection is retained during admission',async({page,context})=>{
 const db=dbFor();await ready(page,db);const b=await context.newPage();try{await ready(b,db,'B');await b.getByRole('textbox',{name:'備註',exact:true}).focus();await b.getByRole('textbox',{name:'備註',exact:true}).fill('Remote note');
 db.metadataHold={actor:'A',action:'acquire'};await choose(page,'付款人','B');expect(db.rows.budget_items[0].payer_id).toBe('A');db.releaseMetadata();
 await expect.poll(()=>db.rows.budget_items[0].payer_id).toBe('B');await expect.poll(()=>db.rows.budget_items[0].note).toBe('Remote note');await choose(page,'付款人','未指定');await expect.poll(()=>db.rows.budget_items[0].payer_id).toBe(null);expect(db.rows.budget_items[0].amount).toBe(1000);
 }finally{await b.close();}
});
test('same category lock keeps keyboard access and refuses remote selection',async({page,context})=>{
 const db=dbFor();await ready(page,db);await region(page).getByRole('combobox',{name:'分類',exact:true}).focus();await expect.poll(()=>db.groupCalls.filter(c=>c.args.p_group==='category').length).toBeGreaterThan(0);
 const b=await context.newPage();try{await ready(b,db,'B');await choose(b,'分類','住宿');await expect(b.getByText('A 正在編輯分類',{exact:true})).toBeVisible();expect(db.rows.budget_items[0].category).toBe('交通');expect(db.groupCalls.filter(c=>c.actor==='B'&&c.name==='patch_budget_metadata_group')).toHaveLength(0);
 }finally{await b.close();}
});
test('links selector writes the full set once and snapshot updates another tab',async({page,context})=>{
 const db=dbFor();await ready(page,db);const b=await context.newPage();try{await ready(b,db,'B');await region(page).getByRole('button',{name:/關聯行程/}).click();const option=region(page).getByRole('checkbox',{name:'Museum'}).last();await option.focus();await option.check();
 await expect.poll(()=>db.rows.itinerary_budget_items).toEqual([{budget_item_id:'budget',itinerary_item_id:'visit'}]);await expect(region(b).getByText('Day 1 · Museum',{exact:true})).toBeVisible();
 expect(db.groupCalls.filter(c=>c.name==='patch_budget_metadata_group'&&c.args.p_group==='links').map(c=>c.args.p_patch)).toEqual([{links:['visit']}]);
 if(process.env.BUDGET_CHOICE_SCREENSHOT)await page.screenshot({path:process.env.BUDGET_CHOICE_SCREENSHOT,fullPage:false});
 }finally{await b.close();}
});
test('unknown payer result retries original request and full-editor handoff uses canonical',async({page})=>{
 const db=dbFor();await ready(page,db);db.losePatchAck=true;await choose(page,'付款人','B');await expect(page.getByRole('button',{name:'確認儲存結果',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'確認儲存結果',exact:true}).click();await expect.poll(()=>db.groupCalls.filter(c=>c.name==='patch_budget_metadata_group').length).toBe(2);
 const calls=db.groupCalls.filter(c=>c.name==='patch_budget_metadata_group');expect(calls[0].args.p_request_id).toBe(calls[1].args.p_request_id);
 await page.getByRole('button',{name:'編輯完整項目',exact:true}).click();await expect(page.getByRole('button',{name:'儲存',exact:true})).toBeVisible();expect(db.rows.budget_items[0].payer_id).toBe('B');
});
test('retained record shows explicit unsupported group without new or legacy writes',async({page})=>{
 const db=dbFor();db.rows.actual_expenses=[{id:'paid',trip_id:'trip',budget_item_id:'budget',title:'Payment',amount:10,twd_amount:10,currency:'TWD',payment_origin:'budget_toggle',payment_active:true}];await ready(page,db);await choose(page,'分類','住宿');
 await expect(page.getByText('此項目尚未支援分欄編輯，請使用完整項目編輯').first()).toBeVisible();expect(db.groupCalls).toHaveLength(0);expect(db.leaseCalls).toHaveLength(0);expect(db.rows.budget_items[0].category).toBe('交通');
});
test('custom category debounces typing and rejects blank without a write',async({page})=>{
 const db=dbFor();await ready(page,db);const field=region(page).getByRole('combobox',{name:'分類',exact:true});await field.focus();await field.fill('地方小吃');
 await expect.poll(()=>db.rows.budget_items[0].category).toBe('地方小吃');await field.fill('');await title(page).focus();await expect(page.getByText('請填寫分類。',{exact:true})).toBeVisible();expect(db.rows.budget_items[0].category).toBe('地方小吃');
});
test('Demo category payer links use real shared UI and memory only',async({page})=>{
 await enableMetadata(page);const requests=[],errors=[];page.on('request',r=>{if(/\.supabase\.co|\/auth\/v1|\/rest\/v1|\/realtime\/v1|open.er-api.com/.test(r.url()))requests.push(r.url());});page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/demo/budget');await page.getByRole('button',{name:'租車加油',exact:true}).click();await page.getByRole('tab',{name:'編輯項目',exact:true}).click();await choose(page,'分類','餐飲');await choose(page,'付款人','未指定');
 await region(page).getByRole('button',{name:/關聯行程/}).click();const option=region(page).getByRole('checkbox').last();await option.focus();await option.setChecked(!(await option.isChecked()));await expect(region(page).getByText('已儲存',{exact:true}).last()).toBeVisible();
 await page.getByRole('tab',{name:'項目明細',exact:true}).click();expect(requests).toEqual([]);expect(errors).toEqual([]);
});
test('category composition never commits intermediate IME text and blur flushes only after end',async({page})=>{
 const db=dbFor();await ready(page,db);const field=region(page).getByRole('combobox',{name:'分類',exact:true});await field.focus();await expect(field).toBeEditable();
 await field.dispatchEvent('compositionstart');await field.fill('地方料理');await field.dispatchEvent('keydown',{key:'Enter',isComposing:true});await expect(field).toHaveValue('地方料理');await page.clock.install();await page.clock.fastForward(1500);
 expect(db.groupCalls.filter(c=>c.name==='patch_budget_metadata_group')).toHaveLength(0);await title(page).focus();expect(db.rows.budget_items[0].category).toBe('交通');
 await field.dispatchEvent('compositionend');await expect.poll(()=>db.rows.budget_items[0].category).toBe('地方料理');
});
