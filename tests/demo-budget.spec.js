import {expect,test} from '@playwright/test';
import fs from 'node:fs';
import {createDemoExpenseModels,demoBudgetMembers} from '../src/demo/budgetFixtures.js';
import {expenseSettlement} from '../src/lib/expenseItems.js';
const trip={...JSON.parse(fs.readFileSync(new URL('../src/demo-kyoto-trip.json',import.meta.url),'utf8')),id:'demo-trip-kyoto'};
const row=(p,title)=>p.locator('.bw-row').filter({has:p.getByRole('button',{name:title,exact:true})});
const editor=p=>p.getByRole('region',{name:'支出項目編輯'});
async function title(p,text){const input=editor(p).getByRole('textbox',{name:'項目名稱',exact:true});await input.focus();await expect(input).toBeEditable();await input.fill(text);await input.blur();}
async function amount(p,scope,value){const group=editor(p).getByRole('group',{name:scope==='paid'?'實付計價與分攤':'預算計價與分攤',exact:true});const input=group.getByRole('spinbutton',{name:'總額',exact:true});await input.focus();await expect(input).toBeEditable();await input.fill(value);await input.blur();}
async function payer(p,name){const g=editor(p).getByRole('group',{name:'付款方式',exact:true});await g.focus();const mode=g.getByRole('button',{name:'指定付款人',exact:true});if(await mode.count())await mode.click();await g.getByRole('combobox').first().click();await p.getByRole('option',{name,exact:true}).click();}

test('synthetic fixture has one item identity and valid Timeline links without Source or Baseline',()=>{
 const items=createDemoExpenseModels(trip,trip.itinerary_items);expect(items).toHaveLength(32);expect(new Set(items.map(i=>i.id)).size).toBe(32);expect(items.filter(i=>i.payment_state==='paid')).toHaveLength(8);
 expect(new Set(items.map(i=>i.budget.pricing_mode))).toEqual(new Set(['split_total','per_person','custom']));expect(new Set(items.map(i=>i.category)).size).toBe(7);
 expect(items.flatMap(i=>i.links).length).toBeGreaterThan(25);expect(items.every(i=>i.links.every(id=>trip.itinerary_items.some(t=>t.id===id)))).toBe(true);
 expect(items.every(i=>!('budget_item_id' in i)&&!('budget_origin_id' in i))).toBe(true);expect(expenseSettlement(items,demoBudgetMembers).incomplete).toBe(false);
});
test.beforeEach(async({page})=>{
 await page.setViewportSize({width:1440,height:1000});
 page.qaErrors=[];page.forbidden=[];page.on('pageerror',e=>page.qaErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')page.qaErrors.push(m.text());});
 page.on('request',r=>{if(/\/auth\/v1\/|\/rest\/v1\/|\/realtime\/v1\/|\/storage\/v1\/|open.er-api.com/.test(r.url()))page.forbidden.push(r.url());});
 await page.clock.setFixedTime(new Date('2026-11-05T12:00:00+08:00'));await page.goto('/demo/budget');await expect(page.getByRole('region',{name:'支出工作區'})).toBeVisible();
});
test.afterEach(async({page})=>{expect(page.qaErrors).toEqual([]);expect(page.forbidden).toEqual([]);const keys=await page.evaluate(()=>[...Object.keys(localStorage),...Object.keys(sessionStorage)].filter(k=>k.startsWith('travel-planner-expense')));expect(keys).toEqual([]);});
test('Demo uses restored shared UI and stats with explicit detail selection',async({page})=>{
 await expect(page.locator('.bw-row')).toHaveCount(32);await expect(page.getByRole('tab',{name:'實付',exact:true})).toHaveCount(0);await expect(page.getByRole('table',{name:'預算明細'}).getByRole('columnheader')).toHaveCount(6);
 await page.getByRole('combobox',{name:'統計視角'}).click();await page.getByRole('option',{name:'Peter',exact:true}).click();const stats=page.getByRole('region',{name:'旅程費用摘要'}),before=await stats.textContent();
 await page.getByRole('tab',{name:'項目明細',exact:true}).click();await row(page,'Villa 火鍋食材').getByRole('button',{name:'Villa 火鍋食材',exact:true}).click();await expect(page.locator('.bw-detail')).toContainText('自訂分攤');
 await page.getByRole('tab',{name:'旅程統計',exact:true}).click();await expect(stats).toHaveText(before);await expect(page.getByText(/來源預算|目前來源|變更來源關聯|編輯完整項目/)).toHaveCount(0);await page.screenshot({path:test.info().outputPath('shared-demo.png')});
});
test('Demo unified add discards blank drafts and protects unnamed substantive content',async({page})=>{
 const add=page.getByRole('button',{name:'新增項目',exact:true});await expect(add).toHaveCount(1);await add.click();await expect(page.locator('.bw-row')).toHaveCount(32);await page.getByRole('tab',{name:'項目明細',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.bw-row')).toHaveCount(32);
 await add.click();await editor(page).getByRole('textbox',{name:'備註',exact:true}).fill('尚未命名');await page.getByRole('tab',{name:'項目明細',exact:true}).click();const guard=page.getByRole('dialog',{name:'您有未儲存的變更'});await expect(guard).toBeVisible();await guard.getByRole('button',{name:'不儲存',exact:true}).click();await expect(page.locator('.bw-row')).toHaveCount(32);await expect(editor(page)).toHaveCount(0);
});
test('planning uses one amount and a paid toggle without paid amounts or comparison UI',async({page})=>{
 await page.getByRole('button',{name:'新增項目',exact:true}).click();await title(page,'同筆支出');await amount(page,'budget','10000');await payer(page,'Peter');await editor(page).getByRole('button',{name:'付款狀態',exact:true}).click();
 await expect(editor(page).getByText(/實付/)).toHaveCount(0);await page.getByRole('tab',{name:'項目明細',exact:true}).click();await expect(row(page,'同筆支出')).toContainText('10,000');await expect(page.locator('.bw-detail')).not.toContainText('實付');
 await page.getByRole('button',{name:'付款狀態',exact:true}).click();await expect(row(page,'同筆支出')).toContainText('未付款');await page.getByRole('button',{name:'付款狀態',exact:true}).click();await expect(row(page,'同筆支出')).toContainText('已付款');await expect(page.locator('.bw-detail')).not.toContainText('差額');
 await page.getByRole('button',{name:'預算管理',exact:true}).click();await expect(row(page,'同筆支出')).toHaveCount(1);await page.reload();await expect(row(page,'同筆支出')).toHaveCount(0);
});
test('paid-only lunch needs no budget or source and reaches settlement',async({page})=>{
 await page.goto('/demo/budget?budgetTools=1');await page.getByRole('combobox',{name:'Demo 情境'}).click();await page.getByRole('option',{name:'行程中',exact:true}).click();await page.getByRole('button',{name:'新增項目',exact:true}).click();await title(page,'只有實付午餐');await amount(page,'paid','800');await payer(page,'Dennis');
 await editor(page).getByRole('button',{name:'標記已付款',exact:true}).click();await page.getByRole('tab',{name:'項目明細',exact:true}).click();await expect(page.locator('.bw-detail')).toContainText('預算 · 未填');
 await page.getByRole('navigation',{name:'Demo 導覽',exact:true}).getByRole('button',{name:'分帳結算',exact:true}).click();await expect(page.locator('.settlement-expense').filter({hasText:'只有實付午餐'})).toContainText('800');
});
test('trip switch isolates saved items and reset uses the same memory graph',async({page})=>{
 await page.getByRole('button',{name:'新增項目',exact:true}).click();await title(page,'京都獨立測試');await page.getByRole('tab',{name:'項目明細',exact:true}).click();await page.getByRole('button',{name:'系統測試專用',exact:true}).click();await expect(page.locator('.bw-row')).toHaveCount(0);
 await page.getByRole('button',{name:'京都琵琶湖之旅-TEST',exact:true}).click();await expect(row(page,'京都獨立測試')).toHaveCount(1);
 await page.goto('/demo/budget?budgetTools=1');await page.getByRole('button',{name:'新增項目',exact:true}).click();await title(page,'重設前');await page.getByRole('tab',{name:'項目明細',exact:true}).click();await page.getByRole('button',{name:'重設預算案例',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'重設',exact:true}).click();await expect(row(page,'重設前')).toHaveCount(0);await expect(page.locator('.bw-row')).toHaveCount(32);
});
test('paid-only item links reach Timeline and accommodation detail through the same expense identity',async({page})=>{
 await page.goto('/demo/budget?budgetTools=1');await page.getByRole('combobox',{name:'Demo 情境'}).click();await page.getByRole('option',{name:'行程中',exact:true}).click();await page.getByRole('button',{name:'新增項目',exact:true}).click();await title(page,'連結實付');await amount(page,'paid','800');await payer(page,'Peter');
 const links=editor(page).getByRole('group',{name:'關聯行程',exact:true});await links.focus();await links.getByRole('button',{name:/關聯行程/}).click();await links.getByRole('textbox',{name:'搜尋關聯行程'}).fill('關西機場午餐');await expect(links.getByRole('checkbox',{name:'關西機場午餐',exact:true})).toBeEnabled();await links.getByRole('checkbox',{name:'關西機場午餐',exact:true}).check();await editor(page).getByRole('button',{name:'標記已付款',exact:true}).click();await page.getByRole('tab',{name:'項目明細',exact:true}).click();
 await page.getByRole('button',{name:'行程路線',exact:true}).click();const card=page.locator('.timeline-item').filter({has:page.getByRole('heading',{name:'關西機場',exact:true})});await card.click();await card.click();await expect(card.locator('.linked-budget-list')).toContainText(/連結實付.*800/);
 await page.getByRole('button',{name:'住宿資訊',exact:true}).click();await page.getByRole('button',{name:'新增住宿',exact:true}).click();const form=page.locator('.accommodation-form');await form.getByLabel('住宿名稱',{exact:true}).fill('新模型住宿');await form.getByRole('combobox',{name:'關聯支出',exact:true}).selectOption({label:'連結實付'});await form.getByRole('button',{name:'儲存',exact:true}).click();await page.locator('.accommodation-list-item').filter({hasText:'新模型住宿'}).click();await expect(page.locator('.accommodation-detail')).toContainText('關聯支出：連結實付');
});
