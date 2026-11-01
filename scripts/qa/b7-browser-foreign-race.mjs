// Two new legal QA budgets exercise foreign costs, a paid historical Actual,
// and a trip-rate update competing with a real Pricing lease.
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {createHash,randomUUID} from 'node:crypto';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export async function execute({runtime:r,credentials:c,args}){
 assert.equal(r.project,'uyqdopksfysbobhjcepk');const x=r.cutover,s=r.browserProof,[a,b]=r.browserPages,trip=x.trips[0];
 const read=async route=>{const z=await fetch(r.url+'/rest/v1/'+route,{headers:{apikey:c.anon,Authorization:'Bearer '+x.sessions[0].access_token},redirect:'error',signal:AbortSignal.timeout(8000)});assert.equal(z.status,200);return z.json();};
 const until=async(fn,label)=>{const end=Date.now()+12000;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(z=>setTimeout(z,100));}throw Error('Foreign integration: '+label);};
 const rows=()=>read(`budget_items?trip_id=eq.${trip}&select=*&order=id`),actuals=()=>read(`actual_expenses?trip_id=eq.${trip}&select=*&order=id`);
 const save=()=>fs.writeFile(path.join(r.dir,'foreign-race-scope.json'),JSON.stringify(x.foreignRace,null,2));
 const step=async value=>{x.foreignRace.steps.push({phase:value,at:new Date().toISOString()});await save();};
 const create=async(label,amount)=>{
  const before=await rows();await a.getByRole('button',{name:'新增預算',exact:true}).click();
  const added=await until(async()=>{const d=(await rows()).filter(z=>!before.some(v=>v.id===z.id));assert(d.length<=1);return d[0];},'new legal Budget');x.foreignRace.budgets.push(added.id);await save();
  const title=a.getByRole('textbox',{name:'項目名稱',exact:true});await title.click();await until(async()=>await title.getAttribute('readonly')===null,'Title admission');await title.fill(label);await until(async()=>(await rows()).find(z=>z.id===added.id).title===label,'Title save');
  const payer=a.getByRole('combobox',{name:'付款人',exact:true});await payer.click();await until(async()=>await payer.getAttribute('aria-readonly')!=='true','Payer admission');if(await payer.getAttribute('aria-expanded')!=='true')await payer.click();await a.getByRole('option',{name:'B7 QA A',exact:true}).click();
  const group=a.getByRole('group',{name:'計價與分攤',exact:true}),total=group.getByRole('spinbutton',{name:/總額|每人單價/});await total.click();await until(async()=>await total.getAttribute('readonly')===null,'Pricing admission');
  if(await group.getByRole('button',{name:'總額均分',exact:true}).getAttribute('aria-pressed')!=='true')await group.getByRole('button',{name:'總額均分',exact:true}).click();
  const currency=group.getByRole('combobox',{name:'幣別',exact:true});await currency.click();await a.getByRole('option',{name:'JPY',exact:true}).click();if(await group.locator('details').getAttribute('open')===null)await group.locator('summary').click();for(const name of ['B7 QA A','B7 QA B'])await group.getByRole('checkbox',{name:new RegExp(name)}).check();await group.getByRole('spinbutton',{name:'總額',exact:true}).fill(String(amount));
  await until(async()=>{const row=(await rows()).find(z=>z.id===added.id);return row.currency==='JPY'&&Number(row.amount)===amount&&row.record_status==='complete'&&row.payer_id===x.sessions[0].user.id;},'complete foreign price');return added.id;
 };
 if(args.mode==='prepare'){
  assert(!x.foreignRace,'Never repeat possibly committed QA creation');x.foreignRace={budgets:[],steps:[],oldActualSha256:sha(await actuals())};await save();
  const paid=await create('QA FX paid '+x.run.slice(0,8),1000);x.foreignRace.paid=paid;await a.getByRole('button',{name:'關閉編輯',exact:true}).click();await a.getByRole('tab',{name:'項目明細',exact:true}).click();await a.getByRole('button',{name:'付款狀態',exact:true}).click();
  const actual=await until(async()=>(await actuals()).find(z=>z.budget_origin_id===paid&&z.payment_active),'foreign payment Actual');assert.equal(actual.currency,'JPY');assert.equal(Number(actual.amount),1000);assert.equal(Number(actual.twd_amount),Math.round(1000*Number(actual.exchange_rate)));x.foreignRace.paidActual=actual.id;await step('foreign-payment-committed');await until(()=>a.getByRole('button',{name:'付款狀態',exact:true}).isEnabled(),'payment UI settlement');
  x.foreignRace.contender=await create('QA FX contender '+x.run.slice(0,8),2000);x.foreignRace.protectedActuals=await actuals();x.foreignRace.paidRow=(await rows()).find(z=>z.id===paid);await step('contender-pricing-lease-held');return {prepared:true,newQaBudgets:2,newForeignActual:1};
 }
 if(args.mode==='resume-contender'){
  assert(x.foreignRace?.paidActual&&x.foreignRace.budgets.length===1&&!x.foreignRace.contender);assert.equal((await rows()).length,4,'Independent readback must prove the failed create did not commit');
  await until(()=>a.getByRole('button',{name:'付款狀態',exact:true}).isEnabled(),'payment settled before new create');
  x.foreignRace.contender=await create('QA FX contender '+x.run.slice(0,8),2000);x.foreignRace.protectedActuals=await actuals();x.foreignRace.paidRow=(await rows()).find(z=>z.id===x.foreignRace.paid);await step('contender-pricing-lease-held');return {knownFailedCreateHadNoCommit:true,contenderPrepared:true};
 }
 if(args.mode==='cleanup-contender'){
  const f=x.foreignRace;assert(f?.contender&&!f.cleanupStarted);f.cleanupStarted=true;assert(!(await actuals()).some(z=>z.budget_item_id===f.contender||z.budget_origin_id===f.contender));
  const row=(await rows()).find(z=>z.id===f.contender);assert(row);await a.getByRole('button',{name:row.title,exact:true}).click();await a.getByRole('tab',{name:'項目明細',exact:true}).click();await a.getByRole('button',{name:'刪除項目',exact:true}).click();await a.getByRole('dialog').getByRole('button',{name:'刪除',exact:true}).click();await until(async()=>!(await rows()).some(z=>z.id===f.contender),'normal QA Lifecycle cleanup');await step('unpaid-contender-normally-deleted');return {ordinaryOwnerUiDelete:true,noActualDependency:true,paidForeignGraphRetained:true};
 }
 if(args.mode==='stale-version'){
  const f=x.foreignRace;assert(f?.contender&&f.protectedActuals);const token=x.sessions[1].access_token,sid=randomUUID();
  const rpc=async(name,body)=>{const z=await fetch(r.url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:c.anon,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(8000)});return {status:z.status,data:await z.json()};};
  const snapshot=async()=>{const z=await rpc('read_budget_metadata_snapshot_v10',{p_trip_id:trip,p_session_id:sid});assert.equal(z.status,200);return z.data;},old=await snapshot();
  const title=(await rows()).find(z=>z.id===f.contender).title;if(!await a.locator('.bw-row.is-selected').filter({has:a.getByRole('button',{name:title,exact:true})}).count())await a.getByRole('button',{name:title,exact:true}).click();await a.getByRole('tab',{name:'編輯項目',exact:true}).click();
  const field=a.getByRole('group',{name:'計價與分攤',exact:true}).getByRole('spinbutton',{name:'總額',exact:true});await field.click();await until(async()=>await field.getAttribute('readonly')===null,'fresh Pricing authority');await field.fill('2001');await until(async()=>Number((await rows()).find(z=>z.id===f.contender).amount)===2001,'concurrent Pricing commit');
  const oldRate=old.ratesRecords[0],argsFor=(row,quote,leaseToken)=>({p_trip_id:trip,p_kind:'trip',p_id:trip,p_session_id:sid,p_token:leaseToken,p_action:'acquire',p_base_revision:row.revision,p_epoch:null,p_versions:row.value.versions,p_intent:{action:'rates',quote,initialize:false}});
  const stale=await rpc('budget_rates_lease',argsFor(oldRate,old.tripBudgetRates,randomUUID()));assert.equal(stale.status,409);assert.equal(stale.data.code,'PT409','The real stale version must reject even when the current quote is unchanged');assert.deepEqual(await actuals(),f.protectedActuals);
  await a.getByRole('button',{name:'關閉編輯',exact:true}).click();await a.getByRole('textbox',{name:'項目名稱',exact:true}).waitFor({state:'hidden',timeout:10000});const fresh=await snapshot(),leaseToken=randomUUID(),request=argsFor(fresh.ratesRecords[0],fresh.tripBudgetRates,leaseToken),admitted=await rpc('budget_rates_lease',request);assert.equal(admitted.status,200);assert(admitted.data.granted);assert.deepEqual(admitted.data.targets,[],'Unchanged quote is explicitly a no-op, not a repricing proof');
  const released=await rpc('budget_rates_lease',{...request,p_action:'release',p_epoch:admitted.data.epoch});assert(released.data.granted);assert.deepEqual(await actuals(),f.protectedActuals);assert.deepEqual((await rows()).find(z=>z.id===f.paid),f.paidRow);
  const event={id:'FOREIGN-PRICING-RATES-STALE-VERSION',status:'Passed',at:new Date().toISOString(),realForeignPaymentUi:true,realOrdinaryUserHttpCompetition:true,actualStaleSnapshotPt409:true,noBlindRetry:true,freshNoopLeaseReleased:true,foreignPaidBudgetAndFourActualsUnchanged:true,changedQuoteRepricingStillPending:true};s.events.push(event);await fs.writeFile(path.join(r.dir,'browser-results.json'),JSON.stringify(s,null,2));return event;
 }
 if(args.mode==='race'){
  assert(x.foreignRace?.contender);const responses=[];const listener=async response=>{if(response.url().endsWith('/rpc/budget_rates_lease')){const data=await response.json();responses.push({status:response.status(),granted:data.granted,reason:data.reason,code:data.code});}};b.on('response',listener);
  try{
   await b.getByRole('tab',{name:'旅程統計',exact:true}).click();await b.getByRole('button',{name:'更新匯率',exact:true}).click();await until(async()=>responses.length,'rate competition response');assert(responses.some(z=>z.status===409||z.status===200&&z.granted===false),'Pricing lease must block rate update');await step('rate-update-denied-by-live-pricing-lease');assert.deepEqual(await actuals(),x.foreignRace.protectedActuals);
   await a.getByRole('button',{name:'關閉編輯',exact:true}).click();await a.getByRole('textbox',{name:'項目名稱',exact:true}).waitFor({state:'hidden',timeout:10000});
   const button=b.getByRole('button',{name:'更新匯率',exact:true});await until(()=>button.isEnabled(),'normal rate recovery control');await button.click();
   await until(async()=>responses.some(z=>z.granted===true)&&await button.isEnabled(),'rate retry after normal lease release');const latest=(await read(`trips?id=eq.${trip}&select=budget_exchange_rates`))[0].budget_exchange_rates;assert.equal(latest.source,'ExchangeRate-API');
   assert.deepEqual(await actuals(),x.foreignRace.protectedActuals,'Committed foreign Actual and all prior history must remain byte-for-byte equivalent');assert.deepEqual((await rows()).find(z=>z.id===x.foreignRace.paid),x.foreignRace.paidRow,'Paid foreign Budget must not be re-priced');const contender=(await rows()).find(z=>z.id===x.foreignRace.contender);assert.equal(Number(contender.exchange_rate),Number(latest.rates.JPY));await step('actuals-and-paid-budget-preserved-after-normal-retry');
   const event={id:'BROWSER-FOREIGN-RATES-PRICING-RACE',status:'Passed',at:new Date().toISOString(),realForeignPayment:true,ordinaryTwoUserUi:true,livePricingBlocksRates:true,normalRetryAfterRelease:true,realExternalQuote:true,paidForeignBudgetAndActualHistoryUnchanged:true,protectedActualCount:x.foreignRace.protectedActuals.length,quoteActuallyChangedFromPrior:!Object.is(Number(latest.rates.JPY),Number(x.foreignRace.paidRow.exchange_rate))};s.events.push(event);await fs.writeFile(path.join(r.dir,'browser-results.json'),JSON.stringify(s,null,2));return event;
  }finally{b.off('response',listener);}
 }
 throw Error('Unsupported foreign integration case');
}
