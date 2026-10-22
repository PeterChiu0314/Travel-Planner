import { expect, test } from "@playwright/test";
import { budgetDay, budgetStage, calculatePricing, comparisonRows, recordAllocations, recordForm, settlementBalances } from "../src/lib/budgetFinance.js";
import { fetchBudgetQuote, parseBudgetQuote } from "../src/lib/tripBudgetRates.js";
const members=['a','b','c'].map(user_id=>({user_id,display_name:user_id,status:'approved'}));
const form={currency:'JPY',exchange_rate:'0.22',pricing_mode:'per_person',unit_amount:'700',participantIds:['c','a','b']};

test('public trip quote is inverted to TWD, validated, deduplicated and cached',async()=>{
  const quote={result:'success',base_code:'TWD',time_last_update_unix:1792627200,rates:{JPY:5,USD:.03125,EUR:1/35,KRW:1/.024,HKD:1/4.1}};
  expect(parseBudgetQuote(quote).rates).toEqual({JPY:.2,USD:32,EUR:35,KRW:.024,HKD:4.1});
  expect(()=>parseBudgetQuote({...quote,base_code:'USD'})).toThrow();
  expect(()=>parseBudgetQuote({...quote,rates:{...quote.rates,JPY:0}})).toThrow();
  const original=globalThis.fetch; let calls=0;
  globalThis.fetch=async(url,options)=>{calls++;expect(url).toBe('https://open.er-api.com/v6/latest/TWD');expect(options.credentials).toBe('omit');return {ok:true,json:async()=>quote};};
  try { const values=await Promise.all([fetchBudgetQuote(),fetchBudgetQuote()]);expect(values[0]).toEqual(values[1]);await fetchBudgetQuote();expect(calls).toBe(1);await fetchBudgetQuote({force:true});expect(calls).toBe(2); }
  finally {globalThis.fetch=original;}
});
test('three pricing modes reconcile original totals and deterministic TWD shares',()=>{
  expect(calculatePricing(form)).toMatchObject({amount:2100,twd_amount:462,allocations:{a:154,b:154,c:154}});
  expect(calculatePricing({...form,currency:'TWD',pricing_mode:'split_total',amount:'2491'}).allocations).toEqual({a:831,b:830,c:830});
  expect(calculatePricing({...form,pricing_mode:'custom',shares:{a:'2000',b:'1500',c:'1000'}})).toMatchObject({amount:4500,twd_amount:990,allocations:{a:440,b:330,c:220}});
  expect(calculatePricing({...form,currency:'TWD',unit_amount:'0.50',participantIds:['a']}).twd_amount).toBe(1);
});
test('legacy amounts remain totals; missing custom weights never become averages',()=>{
  const legacy=recordForm({id:'budget',amount:2100,currency:'JPY'},[],'budget_item_id',members);
  expect(calculatePricing({...legacy,exchange_rate:0.22}).amount).toBe(2100);
  expect(recordAllocations({twd_amount:100,split_type:'custom'},[{user_id:'a'}])).toBeNull();
  expect(()=>calculatePricing({...form,participantIds:[]})).toThrow(/至少/);
  expect(()=>calculatePricing({...form,exchange_rate:0})).toThrow(/大於/);
  expect(()=>calculatePricing({...form,unit_amount:'1.001'})).toThrow(/小數/);
});
test('allocation sums reconcile across varied rates, amounts and subsets',()=>{
  for(const amount of ['0','0.01','0.5','3.57','16353.33','49060'])for(const exchange_rate of ['0.219999','0.22','31.123456'])for(const n of [1,2,3]){
    const result=calculatePricing({...form,pricing_mode:'split_total',amount,exchange_rate,participantIds:members.slice(0,n).map(m=>m.user_id)});
    expect(Object.values(result.allocations).reduce((a,b)=>a+b,0)).toBe(result.twd_amount);
  }
});
test('payer is independent from burden and settlement uses custom weights',()=>{
  const {balances,incomplete}=settlementBalances([{id:'x',amount:4500,twd_amount:990,payer_id:'a',pricing_mode:'custom'}],members.map((m,i)=>({actual_expense_id:'x',user_id:m.user_id,share_amount:[2000,1500,1000][i]})),members);
  expect(incomplete).toBe(false);
  expect(balances.map(r=>[r.paid,r.shouldPay,r.balance])).toEqual([[990,440,550],[0,330,-330],[0,220,-220]]);
  expect(balances.reduce((s,r)=>s+r.balance,0)).toBe(0);
});
test('comparison sums multiple actuals, preserves deleted origins and counts extras',()=>{
  const baseline={payload:{items:[{id:'p',category:'交通',title:'租車',twd_amount:1000},{id:'q',title:'未花費',twd_amount:200}]}};
  const rows=comparisonRows(baseline,[{id:'a',budget_item_id:'p',twd_amount:300},{id:'b',budget_origin_id:'p',twd_amount:900},{id:'c',twd_amount:50}]);
  expect(rows.map(r=>r.difference)).toEqual([200,-200,50]);
  expect(rows.reduce((s,r)=>s+r.actual,0)).toBe(1250);expect(rows.reduce((s,r)=>s+r.planned,0)).toBe(1200);
});
test('stages respect Taipei midnight; Day comes only from itinerary links',()=>{
  const trip={start_date:'2027-04-05',end_date:'2027-04-10'};
  expect(budgetStage(trip,new Date('2027-04-04T15:59:59Z'))).toBe('planning');
  expect(budgetStage(trip,new Date('2027-04-04T16:00:00Z'))).toBe('traveling');
  expect(budgetStage(trip,new Date('2027-04-10T16:00:00Z'))).toBe('settled');
  const links=[0,1,3].map(i=>({budget_item_id:'p',itinerary_item_id:String(i)})),items=links.map(l=>({id:l.itinerary_item_id,day_index:Number(l.itinerary_item_id)}));
  expect(budgetDay({id:'p'},links,items)).toBe('Day 1、2、4');expect(budgetDay({id:'p'},links.slice(0,2),items)).toBe('Day 1–2');expect(budgetDay({id:'x'},links,items)).toBe('—');
});
