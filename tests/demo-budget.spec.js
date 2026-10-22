import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { createDemoBudgetState, demoBudgetMembers, hydrateDemoBudgetScenario } from "../src/demo/budgetFixtures.js";
import { comparisonRows, recordAllocations, settlementBalances } from "../src/lib/budgetFinance.js";
const trip = { ...JSON.parse(fs.readFileSync(new URL('../src/demo-kyoto-trip.json', import.meta.url), 'utf8')), id: 'demo-trip-kyoto' };
const fixture = () => createDemoBudgetState(trip, trip.itinerary_items);
const row = (page, title) => page.locator('.bw-row').filter({ has: page.getByRole('button', { name: title, exact: true }) });

test('Kyoto fixture graph reconciles all modes, members, categories and real Timeline links', () => {
  const state = fixture();
  expect(state.budgetItems).toHaveLength(32);
  expect(state.actualExpenses).toHaveLength(8);
  expect(new Set(state.budgetItems.map(item=>item.pricing_mode))).toEqual(new Set(['split_total','per_person','custom']));
  expect(new Set(state.budgetItems.map(item=>item.category)).size).toBe(7);
  expect(state.itineraryBudgetLinks.length).toBeGreaterThan(25);
  const itemIds = new Set(trip.itinerary_items.map(item=>item.id));
  expect(state.itineraryBudgetLinks.every(link=>itemIds.has(link.itinerary_item_id))).toBe(true);
  let burden=0;
  state.budgetItems.forEach(item=>{
    const allocations=recordAllocations(item,state.budgetParticipants.filter(p=>p.budget_item_id===item.id));
    expect(allocations).not.toBeNull();
    expect(Object.values(allocations).reduce((sum,n)=>sum+n,0)).toBe(item.twd_amount);
    burden+=Object.values(allocations).reduce((sum,n)=>sum+n,0);
  });
  expect(burden).toBe(174851);
  const final=hydrateDemoBudgetScenario(state,'settled');
  const balances=settlementBalances(final.actualExpenses,final.actualParticipants,demoBudgetMembers);
  expect(balances.incomplete).toBe(false);
  expect(balances.balances.reduce((sum,r)=>sum+r.balance,0)).toBe(0);
  const rows=comparisonRows(state.baseline,final.actualExpenses);
  expect(rows.reduce((sum,r)=>sum+r.actual,0)).toBe(final.actualExpenses.reduce((sum,r)=>sum+r.twd_amount,0));
  expect(rows.some(r=>r.extra)).toBe(true);expect(rows.some(r=>r.unrecorded)).toBe(true);
  expect(final.actualExpenses.filter(r=>r.budget_origin_id==='demo-budget-fuel')).toHaveLength(2);
});

test('scenario hydration never resurrects edited/deleted test expenses or makes dangling source links', () => {
  const state=hydrateDemoBudgetScenario(fixture(),'traveling');
  const modified={...state,actualExpenses:state.actualExpenses.filter(r=>r.id!=='demo-actual-bus'),
    budgetItems:state.budgetItems.filter(r=>r.id!=='demo-budget-fuel')};
  const final=hydrateDemoBudgetScenario(modified,'settled');
  expect(final.actualExpenses.some(r=>r.id==='demo-actual-bus')).toBe(false);
  expect(final.actualExpenses.find(r=>r.id==='demo-actual-fuel').budget_item_id).toBeNull();
  expect(final.actualExpenses.find(r=>r.id==='demo-actual-fuel').budget_origin_id).toBe('demo-budget-fuel');
  expect(hydrateDemoBudgetScenario(final,'settled')).toBe(final);
});

test.describe('shared Demo UI',()=>{
  const failures=new WeakMap();
  test.beforeEach(async({page})=>{
    const errors=[];failures.set(page,errors);
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await page.clock.install({time:new Date('2026-10-22T12:00:00+08:00')});
    await page.goto('/demo/budget');
    await expect(page.locator('.bw-row')).toHaveCount(32);
  });
  test.afterEach(async({page})=>{expect(failures.get(page)).toEqual([]);});
  test('member viewpoint changes burden and categories and remains selected after detail viewing',async({page})=>{
    const requests=[];page.on('request',request=>{if(/supabase|googleapis/.test(request.url()))requests.push(request.url());});
    const expected=fixture().budgetItems.reduce((sum,item)=>sum+(recordAllocations(item,fixture().budgetParticipants.filter(p=>p.budget_item_id===item.id))['demo-peter']||0),0);
    await page.getByRole('combobox',{name:'統計視角',exact:true}).click(); await page.getByRole('option',{name:'Peter',exact:true}).click();
    await expect(page.locator('.bw-hero')).toContainText(`NT$ ${expected.toLocaleString('zh-TW')}`);
    const before=await page.getByLabel('旅程費用摘要').textContent();
    await row(page,'Villa 火鍋食材').getByRole('button',{name:'Villa 火鍋食材',exact:true}).click();
    await expect(page.locator('.bw-detail')).toContainText('自訂分攤');
    await expect(page.locator('.bw-detail')).toContainText('440');
    await page.getByRole('tab',{name:'旅程統計',exact:true}).click();
    await expect(page.getByRole('combobox',{name:'統計視角',exact:true})).toHaveText('Peter');
    await expect(page.getByLabel('旅程費用摘要')).toHaveText(before);
    expect(requests).toEqual([]);
  });
  test('scenario controls show readonly stages, unique expenses, frozen comparison and balances',async({page})=>{
    await page.goto('/demo/budget?budgetTools=1');
    await page.getByRole('combobox',{name:'Demo 情境',exact:true}).click(); await page.getByRole('option',{name:'行程中',exact:true}).click();
    await expect(page.locator('.budget-workspace')).toHaveAttribute('data-stage','traveling');
    await expect(page.locator('.trip-header-stage')).toContainText('旅行階段');
    await expect(page.locator('.bw-row')).toHaveCount(20);
    await expect(page.getByRole('tab',{name:'對照',exact:true})).toHaveCount(0);
    await page.getByRole('combobox',{name:'Demo 情境',exact:true}).click(); await page.getByRole('option',{name:'旅程結算',exact:true}).click();
    await expect(page.locator('.bw-row')).toHaveCount(34);
    await page.getByRole('tab',{name:'對照',exact:true}).click();
    const before=await page.locator('.bw-comparison-summary').textContent();
    await expect(page.getByRole('table',{name:'出發前預算對照',exact:true})).toContainText('預算外');
    await page.getByRole('tab',{name:'預算',exact:true}).click();
    const fuel=row(page,'租車加油');await fuel.getByRole('button',{name:'租車加油',exact:true}).click();
    page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'刪除項目',exact:true}).click();
    await expect(page.locator('.bw-row')).toHaveCount(31);
    await page.getByRole('tab',{name:'對照',exact:true}).click();
    await expect(page.locator('.bw-comparison-summary')).toHaveText(before);
    await expect(page.locator('.bw-row').filter({hasText:'租車加油'})).toContainText('2,002');
    await page.getByRole('button',{name:'分帳結算',exact:true}).first().click();
    await expect(page.locator('.settlement-table .settlement-row')).toHaveCount(6);
    await expect(page.locator('.transfer-row')).not.toHaveCount(0);
    await page.getByRole('button',{name:'預算管理',exact:true}).click();
    await expect(page.locator('.bw-row')).toHaveCount(34);
  });
  test('navigation protects drafts, isolates trip data and restores local edits when returning',async({page})=>{
    await page.getByRole('button',{name:'新增預算',exact:true}).click();
    await page.getByRole('form',{name:'預算編輯'}).getByLabel('項目',{exact:true}).fill('京都獨立測試');
    await page.getByRole('button',{name:'系統測試專用',exact:true}).click();
    const guard=page.getByRole('dialog',{name:'您有未儲存的變更'});await expect(guard).toBeVisible();
    await guard.getByRole('button',{name:'儲存',exact:true}).click();
    await expect(page.locator('.bw-row')).toHaveCount(0);
    await page.getByRole('button',{name:'京都琵琶湖之旅-TEST',exact:true}).click();
    await expect(row(page,'京都獨立測試')).toHaveCount(1);await expect(page.locator('.bw-row')).toHaveCount(33);
    await page.getByRole('button',{name:'新增預算',exact:true}).click();
    await page.getByRole('form',{name:'預算編輯'}).getByLabel('項目',{exact:true}).fill('不要保留');
    await page.getByRole('button',{name:'行程路線',exact:true}).click();await guard.getByRole('button',{name:'不儲存',exact:true}).click();
    await page.getByRole('button',{name:'預算管理',exact:true}).click();
    await expect(page.getByRole('form',{name:'預算編輯'})).toHaveCount(0);
    await expect(row(page,'不要保留')).toHaveCount(0);
  });
  test('receipts upload open locally and delete through the Formal attachment component',async({page})=>{
    await page.clock.setSystemTime(new Date('2027-04-06T12:00:00+08:00'));await page.clock.runFor(30010);await page.getByRole('tab',{name:'實付',exact:true}).click();
    await row(page,'去程機票・桃園 → 關西').getByRole('button',{name:'去程機票・桃園 → 關西',exact:true}).click();
    await page.locator('.attachment-upload input').setInputFiles({name:'demo-receipt.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5QAAAABJRU5ErkJggg==','base64')});
    await expect(page.locator('.attachment-row')).toContainText('demo-receipt.png');
    const popup=page.waitForEvent('popup');await page.getByRole('button',{name:'demo-receipt.png',exact:true}).click();
    const local=await popup;await local.waitForURL(/^blob:/);await expect(local.locator('img')).toBeVisible();await local.close();
    await page.locator('.attachment-row .mini-button').click();await expect(page.locator('.attachment-row')).toHaveCount(0);
  });
});
