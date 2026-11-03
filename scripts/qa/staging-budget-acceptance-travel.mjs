import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {settlementBalances} from '../../src/lib/budgetFinance.js';
import {ok} from './staging-budget-acceptance-http.mjs';
export async function travelCase(r){
 await r.check('B07',async()=>{
  const {api,http,trip,sessions}=r,token=sessions[0].access_token;
  const baseline=await api.read('trip_budget_baselines',`trip_id=eq.${trip}&select=*`);assert.equal(baseline.length,1);const payload=structuredClone(baseline[0].payload);
  assert(payload.items.some(x=>x.id===r.budget),'Planning complete Budget must appear in Baseline');
  const day=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Taipei'}));
  const date=offset=>{const d=new Date(day);d.setDate(d.getDate()+offset);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  ok(await http(token,`/rest/v1/trips?id=eq.${trip}`,{method:'PATCH',body:{start_date:date(-1),end_date:date(1),status:'traveling'}}));
  await api.patch(0,'budget',r.budget,'note',()=> 'QA after-departure change');
  assert.deepEqual((await api.read('trip_budget_baselines',`trip_id=eq.${trip}&select=payload`))[0].payload,payload,'Frozen Baseline must not backfill');
  const page=r.pages[0];await page.reload();await expect(page.getByRole('button',{name:'新增預算',exact:true})).toBeVisible();
  const graph=await api.snap(),members=await api.read('trip_members',`trip_id=eq.${trip}&status=eq.approved&select=*`);
  const totals=settlementBalances(graph.actualExpenses,graph.actualParticipants,members);assert.equal(totals.incomplete,false);assert(Math.abs(totals.balances.reduce((n,b)=>n+b.balance,0))<0.001);
  await page.getByRole('button',{name:'分帳結算',exact:true}).click();await expect(page.locator('.settlement-panel')).toBeVisible();await expect(page.locator('.settlement-expense').filter({hasText:graph.actualExpenses.find(z=>z.id===r.retainedActual).title})).toHaveCount(1);
  ok(await http(token,`/rest/v1/trips?id=eq.${trip}`,{method:'PATCH',body:{end_date:date(-1),status:'settled'}}));await page.reload();await expect(page.locator('.settlement-panel')).toBeVisible();assert.deepEqual((await api.read('trip_budget_baselines',`trip_id=eq.${trip}&select=payload`))[0].payload,payload);
  return {planningBaseline:true,frozenAfterDeparture:true,travelingAndSettledUi:true,canonicalSettlementZeroSum:true,productRulesUnchanged:true};
 });
}
