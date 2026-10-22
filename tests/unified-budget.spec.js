import { test, expect } from "@playwright/test";

import { saveDemoBudgetRecord } from "../src/demo/saveBudgetRecord.js";
import { planningBudgetData, calculateEntryPricing } from "../src/lib/planningBudget.js";
import { settlementBalances } from "../src/lib/budgetFinance.js";

// These regressions inspect saved data; the edit tab itself stays selected.
async function inspectAfter(page, form, action) {
  await form.getByRole('button',{name:action,exact:true}).click();
  if (await form.count() === 0) await page.getByRole('tab',{name:'項目明細',exact:true}).click();
}

const row=(page,title)=>page.locator('.bw-row').filter({has:page.getByRole('button',{name:title,exact:true})});
test.beforeEach(async({page})=>{await page.clock.install({time:new Date('2026-10-22T12:00:00+08:00')});});
test('planning has one list; paid amount edits, receipts and status round-trip without deletion',async({page})=>{
  await page.goto('/demo/budget');await expect(page.getByRole('tab',{name:'實付',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'新增預算',exact:true}).click();const form=page.getByRole('form',{name:'預算編輯'});
  await form.getByLabel('項目',{exact:true}).fill('整合機票');await form.getByLabel('總額',{exact:true}).fill('12000');await form.getByRole('button',{name:'付款狀態',exact:true}).click();await inspectAfter(page, form, "儲存");
  await row(page,'整合機票').getByRole('button',{name:'整合機票',exact:true}).click();await page.getByRole('tab',{name:'編輯項目',exact:true}).click();await form.getByLabel('總額',{exact:true}).fill('12500');await inspectAfter(page, form, "儲存");
  await expect(row(page,'整合機票')).toContainText('12,500');
  // The selected detail survives save and exposes the retained receipt target.
  await page.locator('.attachment-upload input[type=file]').setInputFiles({name:'ticket.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF test')});
  await expect(page.getByRole('button',{name:'ticket.pdf',exact:true})).toBeVisible();
  if(process.env.BUDGET_ISSUES_QA_DIR) await page.screenshot({path:`${process.env.BUDGET_ISSUES_QA_DIR}/unified-planning.png`});
  let dialogs=0;page.on('dialog',async d=>{dialogs++;await d.dismiss();});
  await page.getByRole('button',{name:'付款狀態',exact:true}).click();await expect(page.getByRole('button',{name:'付款狀態',exact:true})).toHaveAttribute('aria-pressed','false');
  await expect(row(page,'整合機票')).toContainText('12,500');await expect(page.getByRole('button',{name:'ticket.pdf',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'付款狀態',exact:true}).click();await expect(page.getByRole('button',{name:'付款狀態',exact:true})).toHaveAttribute('aria-pressed','true');expect(dialogs).toBe(0);
  await page.getByRole('navigation',{name:'Demo 導覽',exact:true}).getByRole('button',{name:'分帳結算',exact:true}).click();await expect(page.locator('.settlement-expense').filter({hasText:'整合機票'})).toContainText('12,500');
});
test('travel entry takes only currency and amount; TWD and JPY can be corrected',async({page})=>{
  await page.goto('/demo/budget');await page.clock.setSystemTime(new Date('2027-04-06T12:00:00+08:00'));await page.clock.runFor(30010);
  await page.getByRole('button',{name:'新增實付',exact:true}).click();const form=page.getByRole('form',{name:'實付編輯'});
  await expect(form.getByRole('button',{name:'實際扣款',exact:true})).toHaveCount(0);await expect(form.getByLabel('實際台幣扣款',{exact:true})).toHaveCount(0);
  await form.getByLabel('項目',{exact:true}).fill('午餐簡單記帳');await form.getByLabel('總額',{exact:true}).fill('2800');await form.getByRole('combobox',{name:'幣別',exact:true}).click();await page.getByRole('option',{name:'JPY',exact:true}).click();await inspectAfter(page, form, "儲存");await expect(row(page,'午餐簡單記帳')).toContainText('616');
  await row(page,'午餐簡單記帳').getByRole('button',{name:'午餐簡單記帳',exact:true}).click();await page.getByRole('tab',{name:'編輯項目',exact:true}).click();await form.getByRole('combobox',{name:'幣別',exact:true}).click();await page.getByRole('option',{name:'TWD',exact:true}).click();await form.getByLabel('總額',{exact:true}).fill('625');await inspectAfter(page, form, "儲存");await expect(row(page,'午餐簡單記帳')).toContainText('625');
  if(process.env.BUDGET_ISSUES_QA_DIR) await page.screenshot({path:`${process.env.BUDGET_ISSUES_QA_DIR}/unified-travel.png`});
});
test('unpaid retained payments do not enter settlement and legacy multiple records remain intact',()=>{
  const members=['a','b'].map(user_id=>({user_id}));const trip={id:'trip',start_date:'2090-01-01'};
  const budget={id:'b',title:'Old',currency:'JPY',amount:2800,twd_amount:616,exchange_rate:.22};
  const expenses=[{id:'x',budget_item_id:'b',title:'deposit',amount:100,currency:'TWD',twd_amount:100,payer_id:'a'},{id:'y',budget_item_id:'b',title:'balance',amount:525,currency:'TWD',twd_amount:525,payer_id:'b'}];
  const state={budgetItems:[budget],budgetParticipants:[],actualExpenses:expenses,actualParticipants:[],attachments:[{target_type:'actual_expense',target_id:'x'}],itineraryBudgetLinks:[]};
  const result=saveDemoBudgetRecord(state,'budget',{payment_only:true,unified_planning:true,payment_action:'unpaid',payment_expected:expenses.map(e=>({id:e.id,updated_at:null}))},'b',{},trip,members);
  expect(result.ok).toBe(true);expect(result.nextState.actualExpenses).toHaveLength(2);expect(result.nextState.attachments).toEqual(state.attachments);
  expect(settlementBalances(result.nextState.actualExpenses,[],members).balances.every(row=>row.paid===0)).toBe(true);
  const projected=planningBudgetData([budget],result.nextState.actualExpenses,[],members);expect(projected.rows[0].twd_amount).toBe(625);expect(projected.rows[0].payment_readonly).toBe(true);
  expect(planningBudgetData([budget],[{...expenses[0],payment_active:false},expenses[1]],[],members).rows[0].twd_amount).toBe(525);
  expect(calculateEntryPricing({currency:'TWD',amount:625,participantIds:['a','b']} ).twd_amount).toBe(625);
  expect(calculateEntryPricing({currency:'JPY',amount:2800,exchange_rate:.22,participantIds:['a','b'],twd_amount_source:'actual',actual_twd_amount:625}).twd_amount).toBe(625);
});
