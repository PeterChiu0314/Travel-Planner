import {test,expect} from '@playwright/test';
import {metadataBackend,boot,enableMetadata} from './helpers/budgetMetadataMock.js';
const editor=p=>p.getByRole('region',{name:'預算群組編輯'});
const group=p=>editor(p).getByRole('group',{name:'計價與分攤',exact:true});
const amount=p=>group(p).getByRole('spinbutton',{name:'總額',exact:true});
function dbFor(){const db=metadataBackend();db.extendedMetadata=true;db.pricingMetadata=true;return db;}
async function ready(p,db,actor='A'){await enableMetadata(p);await boot(p,db,actor);await p.getByRole('button',{name:'JPY fare',exact:true}).click();await p.getByRole('tab',{name:'編輯項目',exact:true}).click();await expect(group(p)).toBeVisible();}
test.afterEach(async({page})=>{if(page.qaErrors)expect(page.qaErrors).toEqual([]);});
test('pricing and remote note autosave independently with financial graph convergence',async({page,context})=>{
 const db=dbFor();await ready(page,db);const b=await context.newPage();try{await ready(b,db,'B');await amount(page).focus();await expect(amount(page)).toBeEditable();await amount(page).fill('1200');const note=b.getByRole('textbox',{name:'備註',exact:true});await note.focus();await expect(note).toBeEditable();await note.fill('Remote note');
 await expect.poll(()=>db.rows.budget_items[0].amount).toBe(1200);await expect.poll(()=>db.rows.budget_items[0].note).toBe('Remote note');await expect(amount(b)).toHaveValue('1200');expect(db.rows.budget_items[0].twd_amount).toBe(240);expect(db.leaseCalls.filter(c=>c.args.p_action==='acquire')).toHaveLength(0);expect(b.qaErrors).toEqual([]);
 }finally{await b.close();}
});
test('custom 600 300 300 totals 1200 and mode revisit preserves edited shares',async({page})=>{
 const db=dbFor();db.members.push({trip_id:'trip',user_id:'C',role:'editor',status:'approved',display_name:'C'});db.rows.budget_item_participants.push({budget_item_id:'budget',user_id:'C'});await ready(page,db);
 await group(page).focus();await expect(group(page).getByRole('button',{name:'自訂分攤',exact:true})).toBeEnabled();await group(page).getByRole('button',{name:'自訂分攤',exact:true}).click();
 for(const [name,value]of[['A','600'],['B','300'],['C','300']])await group(page).getByRole('spinbutton',{name:`${name} 分攤金額`,exact:true}).fill(value);
 await expect(amount(page)).toHaveValue('1200');await expect(amount(page)).toBeDisabled();await expect.poll(()=>db.rows.budget_items[0].amount).toBe(1200);
 await group(page).getByRole('button',{name:'總額均分',exact:true}).click();await group(page).getByRole('button',{name:'自訂分攤',exact:true}).click();await expect(group(page).getByRole('spinbutton',{name:'A 分攤金額',exact:true})).toHaveValue('600');
 if(process.env.BUDGET_PRICING_SCREENSHOT)await page.screenshot({path:process.env.BUDGET_PRICING_SCREENSHOT,fullPage:false});
});
test('same pricing owner makes participant choices disabled and prevents peer writes',async({page,context})=>{
 const db=dbFor();await ready(page,db);await amount(page).focus();await expect(amount(page)).toBeEditable();const b=await context.newPage();try{await ready(b,db,'B');await group(b).focus();await expect(group(b).getByText('A 正在編輯計價與分攤',{exact:true})).toBeVisible();await group(b).getByText('參與成員 · 2 人',{exact:true}).click();await expect(group(b).getByRole('checkbox').first()).toBeDisabled();await expect(amount(b)).not.toBeEditable();expect(db.groupCalls.filter(c=>c.actor==='B'&&c.name==='patch_budget_metadata_group')).toHaveLength(0);
 }finally{await b.close();}
});
test('blank amount stays local and guarded full editor handoff offers save or discard',async({page})=>{
 const db=dbFor();await ready(page,db);await amount(page).focus();await expect(amount(page)).toBeEditable();await amount(page).fill('');await editor(page).getByRole('textbox',{name:'項目名稱',exact:true}).focus();await expect(page.getByRole('alert')).toContainText('請輸入非負數');expect(db.rows.budget_items[0].amount).toBe(1000);expect(db.groupCalls.filter(c=>c.name==='patch_budget_metadata_group')).toHaveLength(0);
 await group(page).getByRole('button',{name:'捨棄此欄草稿',exact:true}).click();await expect(amount(page)).toHaveValue('1000');await page.getByRole('button',{name:'編輯完整項目',exact:true}).click();await expect(page.getByRole('button',{name:'儲存',exact:true})).toBeVisible();
});
test('links readonly disables checkbox and remove while keeping historical links visible',async({page,context})=>{
 const db=dbFor();db.rows.itinerary_items=[{id:'visit',trip_id:'trip',title:'Museum',type:'attraction',day_index:0,sort_order:0}];db.rows.itinerary_budget_items=[{budget_item_id:'budget',itinerary_item_id:'visit'}];await ready(page,db);
 const links=editor(page).getByRole('group',{name:'關聯行程',exact:true});await links.focus();await expect(links.getByRole('button',{name:'取消關聯 Museum',exact:true})).toBeEnabled();const b=await context.newPage();try{await ready(b,db,'B');const other=editor(b).getByRole('group',{name:'關聯行程',exact:true});await other.getByRole('button',{name:/關聯行程/}).click();await expect(other.getByRole('checkbox',{name:'Museum'}).last()).toBeDisabled();await expect(other.getByRole('button',{name:'取消關聯 Museum',exact:true})).toBeDisabled();await expect(other.getByText('Day 1 · Museum',{exact:true})).toBeVisible();
 }finally{await b.close();}
});
test('payer options exclude pending departed and keep historical payer disabled without rewriting',async({page})=>{
 const db=dbFor();db.members.push({trip_id:'trip',user_id:'pending',role:'editor',status:'pending',display_name:'Pending'},{trip_id:'trip',user_id:'departed',role:'editor',status:'removed',display_name:'Departed'});db.rows.budget_items[0].payer_id='departed';await ready(page,db);await editor(page).getByRole('combobox',{name:'付款人',exact:true}).click();await expect(page.getByRole('option',{name:'Pending',exact:true})).toHaveCount(0);await expect(page.getByRole('option',{name:'Departed',exact:true})).toHaveCount(0);await expect(page.getByRole('option',{name:'已退出／無效成員 · departed',exact:true})).toBeDisabled();expect(db.rows.budget_items[0].payer_id).toBe('departed');
});
test('Demo pricing changes in shared UI without authenticated or persisted traffic',async({page})=>{
 await enableMetadata(page);const requests=[],errors=[];page.on('request',r=>{if(/\.supabase\.co|\/auth\/v1|\/rest\/v1|\/realtime\/v1|open.er-api.com/.test(r.url()))requests.push(r.url());});page.on('pageerror',e=>errors.push(e.message));await page.goto('/demo/budget');await page.getByRole('button',{name:'租車加油',exact:true}).click();await page.getByRole('tab',{name:'編輯項目',exact:true}).click();await group(page).focus();await expect(amount(page)).toBeEditable();await amount(page).fill('1200');await expect(group(page).getByText('已儲存',{exact:true})).toBeVisible();await expect(amount(page)).toHaveValue('1200');expect(requests).toEqual([]);expect(errors).toEqual([]);
});
