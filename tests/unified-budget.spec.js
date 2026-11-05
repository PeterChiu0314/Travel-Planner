import { test, expect } from "@playwright/test";

import { saveDemoBudgetRecord } from "../src/demo/saveBudgetRecord.js";
import { planningBudgetData, calculateEntryPricing } from "../src/lib/planningBudget.js";
import { settlementBalances } from "../src/lib/budgetFinance.js";

// Historical Production compatibility arithmetic; current Demo flows are in demo-budget.spec.js.
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
