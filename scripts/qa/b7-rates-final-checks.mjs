// Staging-only changed real quote acceptance. Master credentials stay in the
// existing RAM operator; normal operations use two real authenticated sessions.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {parseBudgetQuote} from '../../src/lib/tripBudgetRates.js';
import {calculatePricing,recordAllocations} from '../../src/lib/budgetFinance.js';
const project='uyqdopksfysbobhjcepk';
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function execute({runtime:r,credentials:c,args}){
 assert.equal(r.project,project);assert.equal(r.url,`https://${project}.supabase.co`);
 const dir=path.join(r.root,'.tmp-b7-rates-final'),json=async file=>JSON.parse((await fs.readFile(path.join(r.root,file),'utf8')).replace(/^\uFEFF/,''));
 const write=async(file,value)=>fs.writeFile(path.join(dir,file),JSON.stringify(value,null,2));
 if(args.mode==='ping')return {project:r.project,processId:process.pid,started:new Date(Date.now()-process.uptime()*1000).toISOString(),noHostedWrites:true};
 const request=async(route,{token,method='GET',body,admin=false}={})=>{
  if(token===c.admin)assert(admin,'Admin only for isolated QA Auth initialization');
  const response=await fetch(r.url+route,{redirect:'error',method,headers:{apikey:admin?c.admin:c.anon,...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  let data;try{data=await response.json();}catch{}return {status:response.status,data};
 };
 const ok=result=>{assert(result.status>=200&&result.status<300,`Rates QA HTTP ${result.status} ${result.data?.code||''}`);return result.data;};
 if(args.mode==='sessions'){
  assert(!r.cutover,'Do not duplicate potentially live sessions');
  const protection=await json('.tmp-b7-rates-final/pre-protection.json'),protocols=await json('.tmp-b7-rates-final/pre-protocols.json'),scope=await json('.tmp-b7-rates-final/pre-scope.json'),prior=await json('.tmp-b7-final-recovery/final-protection.json');
  assert(Date.now()-Date.parse(protocols.observedAt)<15*60000);assert.equal(protection.ledger.count,65);assert.equal(protection.ledger.head,'20261101032853');assert(Object.values(protocols.protocols).every(p=>!p.enabled));assert.equal(scope.qaSessions,0);assert.equal(scope.qaActiveRefreshTokens,0);assert(Object.values(scope.activeLeases).every(n=>n===0));assert.equal(scope.otherTransactions.length,0);
  for(const key of ['data','functions','worker','worker_memberships','worker_grants','worker_capabilities','storagePolicies','guardSha256','guardAttributes','publications','rt','bucket'])assert.deepEqual(protection[key],prior[key]);
  assert.equal(protocols.pendingIntents,0);assert.equal(protocols.activeCleanup,0);assert(protocols.legacyExhausted);
  const qa=await json('.tmp-b7-p1/qa-scope.json'),saved=await json('.tmp-b7-live/legacy-cutover-scope.json'),sessions=[];
  // Store each successful Session immediately so shutdown can revoke it even
  // if initialization of the second account fails.
  r.cutover={...saved,sessions};
  for(const id of qa.users){
   const user=ok(await request('/auth/v1/admin/users/'+id,{admin:true,token:c.admin}));assert.equal(user.user_metadata?.qa_run,qa.run);
   const link=ok(await request('/auth/v1/admin/generate_link',{admin:true,token:c.admin,method:'POST',body:{type:'magiclink',email:user.email}}));
   const session=ok(await request('/auth/v1/verify',{method:'POST',body:{type:'magiclink',token_hash:(link.properties||link).hashed_token}}));assert.equal(session.user.id,id);assert.equal(JSON.parse(Buffer.from(session.access_token.split('.')[1],'base64url')).role,'authenticated');sessions.push(session);
  }
  assert.notEqual(JSON.parse(Buffer.from(sessions[0].access_token.split('.')[1],'base64url')).session_id,JSON.parse(Buffer.from(sessions[1].access_token.split('.')[1],'base64url')).session_id);
  r.ratesFinal={run:randomUUID(),events:[],steps:[],sessions};
  return {realIndependentSessions:2,qaUsersCreated:0,financialWrites:0,masterSecretsInBrowser:false};
 }
 const x=r.cutover,state=r.ratesFinal;assert(x?.sessions.length===2&&state);
 const trip=x.trips[0],token=x.sessions[0].access_token;
 const read=route=>request('/rest/v1/'+route,{token}).then(ok);
 const rpc=(actor,name,body)=>request('/rest/v1/rpc/'+name,{token:x.sessions[actor].access_token,method:'POST',body});
 const step=async phase=>{state.steps.push({phase,at:new Date().toISOString()});await write('steps.json',state.steps);};
 const until=async(fn,label)=>{const end=Date.now()+12000;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Rates QA deadline: '+label);};
 const budgets=()=>read(`budget_items?trip_id=eq.${trip}&select=*&order=id`);
 const actuals=()=>read(`actual_expenses?trip_id=eq.${trip}&select=*&order=id`);
 const snapshot=async(actor,sid)=>ok(await rpc(actor,'read_budget_metadata_snapshot_v10',{p_trip_id:trip,p_session_id:sid}));
 const protectedHistory=async()=>{
  assert.deepEqual(await actuals(),state.before.actuals,'Every original Actual field including Origin/Payment History stays exact');
  const ids=state.before.actuals.map(a=>a.id).join(',');assert.deepEqual(await read(`actual_expense_participants?actual_expense_id=in.(${ids})&select=*&order=id`),state.before.actualParticipants);
  const retained=state.before.budgets.filter(b=>state.before.actuals.some(a=>a.budget_item_id===b.id||a.budget_origin_id===b.id));
  for(const saved of retained)assert.deepEqual((await budgets()).find(b=>b.id===saved.id),saved,'Retained Budget must not be repriced');
 };
 if(args.mode==='seal'){
  const graph={trips:await read(`trips?id=in.(${trip},${(await json('.tmp-b7-p1/qa-scope.json')).trip})&select=*&order=id`),baselines:await read(`trip_budget_baselines?trip_id=in.(${trip},${(await json('.tmp-b7-p1/qa-scope.json')).trip})&select=*&order=trip_id`),budgets:await read(`budget_items?trip_id=eq.${trip}&select=*&order=id`),actuals:await read(`actual_expenses?trip_id=eq.${trip}&select=*&order=id`),actualParticipants:await read('actual_expense_participants?actual_expense_id=in.('+ (await read(`actual_expenses?trip_id=eq.${trip}&select=id&order=id`)).map(a=>a.id).join(',')+')&select=*&order=id')};
  assert.equal(graph.actuals.length,4);assert.equal(graph.baselines.length,2);assert(graph.trips.every(t=>t.budget_exchange_rates?.rates?.JPY));
  state.before=graph;await write('ordinary-before.json',graph);return {qaTripRatesAndBaselinesSealed:2,actualsSealed:graph.actuals.length,actualsSha256:sha(graph.actuals),baselineSha256:sha(graph.baselines)};
 }
 if(args.mode==='browser'){
  assert(state.before&&!r.browser);const activation=await json('.tmp-b7-rates-final/resume-readback.json');assert(Date.now()-Date.parse(activation.observedAt)<10*60000);assert(Object.values(activation.protocols).every(p=>p.enabled));
  r.browser=await chromium.launch({channel:'chrome',headless:false});r.browserContexts=[];r.browserPages=[];state.consoleErrors=[];
  for(let i=0;i<2;i++){
   const context=await r.browser.newContext({viewport:{width:1440,height:1000},locale:'zh-TW'});r.browserContexts.push(context);
   await context.route('**/*.supabase.co/**',route=>new URL(route.request().url()).hostname===project+'.supabase.co'?route.continue():route.abort());
   await context.addInitScript(({session,project,trip})=>{if(location.hostname!=='127.0.0.1')return;const marker='rates-qa-seeded:'+session.user.id;if(!localStorage.getItem(marker)){localStorage.setItem(`sb-${project}-auth-token`,JSON.stringify(session));localStorage.setItem(`travel-planner-session-context:${session.user.id}`,JSON.stringify({activeTripId:trip,activeSection:'budget',activeDay:0,luggageTab:'personal',updatedAt:new Date().toISOString()}));localStorage.setItem(marker,'true');}},{session:x.sessions[i],project,trip});
   const page=await context.newPage();r.browserPages.push(page);page.on('pageerror',e=>state.consoleErrors.push({actor:i,message:e.message}));
   await page.goto('http://127.0.0.1:5189/',{waitUntil:'domcontentloaded',timeout:15000});await page.getByRole('button',{name:'新增預算',exact:true}).waitFor({timeout:15000});assert((await page.locator('body').innerText()).includes('QA B7 Legacy cutover'));assert.equal(await page.locator('vite-error-overlay').count(),0);
  }
  await protectedHistory();const tripNow=(await read(`trips?id=eq.${trip}&select=budget_exchange_rates`))[0];assert.deepEqual(tripNow.budget_exchange_rates,state.before.trips.find(t=>t.id===trip).budget_exchange_rates,'Opening initialized trip must not refresh rates');
  const baselines=await read(`trip_budget_baselines?trip_id=in.(${state.before.trips.map(t=>t.id).join(',')})&select=*&order=trip_id`);assert.deepEqual(baselines,state.before.baselines,'Opening initialized trip alone causes no Baseline mutation');
  await step('two-headed-Chrome-contexts-open-baselines-unchanged');return {realBrowserContexts:2,viewport:{width:1440,height:1000},headless:false,baselineReadOnlyVisitExact:true};
 }
 if(args.mode==='prepare'){
  assert(!state.fixture,'No blind repeat of creation');const a=r.browserPages[0],before=await budgets();
  const source=await fetch('https://open.er-api.com/v6/latest/TWD',{redirect:'error',signal:AbortSignal.timeout(10000)});assert.equal(source.status,200);const raw=await source.json(),quote=parseBudgetQuote(raw),old=state.before.trips.find(t=>t.id===trip).budget_exchange_rates;
  assert.notEqual(quote.rates.JPY,old.rates.JPY);assert(Date.parse(quote.quoted_at)>Date.parse(old.quoted_at));assert.notEqual(Math.round(100001*quote.rates.JPY),Math.round(100001*old.rates.JPY));state.quote=quote;await write('operator-real-quote.json',{fetchedAt:new Date().toISOString(),url:source.url,status:source.status,raw,parsed:quote});
  await a.getByRole('button',{name:'新增預算',exact:true}).click();const added=await until(async()=>{const diff=(await budgets()).filter(b=>!before.some(z=>z.id===b.id));assert(diff.length<=1);return diff[0];},'one legal blank Budget');state.fixture=added.id;await write('fixture.json',{trip,id:added.id,run:state.run});await step('one-new-blank-budget-committed');
  const title='QA FX changed quote '+state.run.slice(0,8),field=a.getByRole('textbox',{name:'項目名稱',exact:true});await field.click();await until(async()=>await field.getAttribute('readonly')===null,'Title lease');await field.fill(title);await until(async()=>(await budgets()).find(b=>b.id===added.id).title===title,'Title autosave');
  const payer=a.getByRole('combobox',{name:'付款人',exact:true});await payer.click();await until(async()=>await payer.getAttribute('aria-readonly')!=='true','Payer lease');if(await payer.getAttribute('aria-expanded')!=='true')await payer.click();await a.getByRole('option',{name:'B7 QA A',exact:true}).click();
  const group=a.getByRole('group',{name:'計價與分攤',exact:true}),amount=group.getByRole('spinbutton',{name:/總額|每人單價/});await amount.click();await until(async()=>await amount.getAttribute('readonly')===null,'Pricing lease');if(await group.getByRole('button',{name:'總額均分',exact:true}).getAttribute('aria-pressed')!=='true')await group.getByRole('button',{name:'總額均分',exact:true}).click();await group.getByRole('combobox',{name:'幣別',exact:true}).click();await a.getByRole('option',{name:'JPY',exact:true}).click();if(await group.locator('details').getAttribute('open')===null)await group.locator('summary').click();for(const name of ['B7 QA A','B7 QA B'])await group.getByRole('checkbox',{name:new RegExp(name)}).check();await group.getByRole('spinbutton',{name:'總額',exact:true}).fill('100000');
  state.title=title;await until(async()=>{const b=(await budgets()).find(b=>b.id===added.id);return b.record_status==='complete'&&b.currency==='JPY'&&Number(b.amount)===100000&&Number(b.exchange_rate)===old.rates.JPY;},'complete unpaid JPY Budget at actual old quote');await protectedHistory();await step('unpaid-JPY-100000-complete-with-two-participants-Pricing-held');return {createdOneUnpaidQaBudget:true,currency:'JPY',amount:100000,oldRate:old.rates.JPY,newRealRate:quote.rates.JPY,actualsUnchanged:4};
 }
 if(args.mode==='race'){
  assert(state.fixture&&state.quote&&!state.rateRequest,'No replay of unknown financial outcome');const a=r.browserPages[0],sid=randomUUID(),leaseToken=randomUUID(),bSession=1;
  const oldSnapshot=await snapshot(bSession,sid),oldRecord=oldSnapshot.ratesRecords[0],intent={action:'rates',quote:state.quote,initialize:false};
  const leaseArgs=(record,action='acquire',epoch=null)=>({p_trip_id:trip,p_kind:'trip',p_id:trip,p_session_id:sid,p_token:leaseToken,p_action:action,p_base_revision:record.revision,p_epoch:epoch,p_versions:record.value.versions,p_intent:intent});
  const blocked=ok(await rpc(bSession,'budget_rates_lease',leaseArgs(oldRecord)));assert.equal(blocked.granted,false);assert.equal(blocked.reason,'pricing_locked');await protectedHistory();await step('B-changed-Rates-rejected-by-A-live-Pricing');
  const amount=a.getByRole('group',{name:'計價與分攤',exact:true}).getByRole('spinbutton',{name:'總額',exact:true});await amount.fill('100001');await until(async()=>Number((await budgets()).find(b=>b.id===state.fixture).amount)===100001,'A Pricing commit');
  const stale=await rpc(bSession,'budget_rates_lease',leaseArgs(oldRecord));assert.equal(stale.status,409);assert.equal(stale.data.code,'PT409');await step('B-old-Rates-version-HTTP409-PT409');await protectedHistory();
  await a.getByRole('button',{name:'關閉編輯',exact:true}).click();await a.getByRole('textbox',{name:'項目名稱',exact:true}).waitFor({state:'hidden',timeout:10000});const beforeRates=await snapshot(bSession,sid),record=beforeRates.ratesRecords[0];
  const acquired=ok(await rpc(bSession,'budget_rates_lease',leaseArgs(record)));assert(acquired.granted);assert.equal(acquired.targets.length,1);assert.equal(acquired.targets[0].id,state.fixture,'Only the new unpaid Budget is a Rates target');state.heldRates={args:leaseArgs(record),epoch:acquired.epoch};await step('B-fresh-Rates-acquired-exactly-unpaid-target');
  const peerSnapshot=await snapshot(0,randomUUID()),pricing=peerSnapshot.metadataRecords.find(g=>g.kind==='budget'&&g.id===state.fixture).groups.find(g=>g.group==='pricing');
  const pricingArgs={p_trip_id:trip,p_kind:'budget',p_id:state.fixture,p_group:'pricing',p_session_id:randomUUID(),p_token:randomUUID(),p_action:'acquire',p_base_revision:pricing.revision,p_epoch:null,p_activity_seq:1,p_dirty:true,p_versions:pricing.value.versions};
  const pricingBlocked=ok(await rpc(0,'budget_metadata_group_lease_v2',pricingArgs));assert.equal(pricingBlocked.granted,false);assert.equal(pricingBlocked.reason,'group_locked');await step('A-Pricing-denied-while-B-holds-Rates');
  const beforeCommit={budget:(await budgets()).find(b=>b.id===state.fixture),participants:await read(`budget_item_participants?budget_item_id=eq.${state.fixture}&select=*&order=user_id`)};state.beforeCommit=beforeCommit;
  const value={...intent,versions:record.value.versions},requestId=randomUUID(),body={p_trip_id:trip,p_kind:'trip',p_id:trip,p_session_id:sid,p_token:leaseToken,p_epoch:acquired.epoch,p_base_revision:record.revision,p_value:value,p_request_id:requestId};state.rateRequest=body;await write('rates-request-scope.json',{requestId,bodySha256:sha(body),beforeCommit});
  const committed=ok(await rpc(bSession,'update_trip_budget_rates_v2',body));assert.equal(committed.request_id,requestId);assert.equal(committed.revision,record.revision+1);assert.equal(committed.value.quote.rates.JPY,state.quote.rates.JPY);await step('real-changed-quote-committed-once');
  const after=(await budgets()).find(b=>b.id===state.fixture);assert.equal(Number(after.amount),100001);assert.equal(Number(after.exchange_rate),state.quote.rates.JPY);assert.equal(Number(after.twd_amount),Math.round(100001*state.quote.rates.JPY));assert.notEqual(after.twd_amount,beforeCommit.budget.twd_amount);for(const key of Object.keys(after))if(!['exchange_rate','twd_amount','updated_at'].includes(key))assert.deepEqual(after[key],beforeCommit.budget[key]);
  const participants=await read(`budget_item_participants?budget_item_id=eq.${state.fixture}&select=*&order=user_id`);assert.deepEqual(participants,beforeCommit.participants);assert.equal(participants.length,2);const allocation=recordAllocations(after,participants),total=Object.values(allocation).reduce((a,b)=>a+b,0);assert.equal(total,Number(after.twd_amount));const values=Object.values(allocation);assert(Math.max(...values)-Math.min(...values)<=1);
  const replay=ok(await rpc(bSession,'update_trip_budget_rates_v2',body));assert.deepEqual(replay,committed);assert.deepEqual((await budgets()).find(b=>b.id===state.fixture),after);await protectedHistory();await step('exact-request-replay-no-duplicate-reprice-history-unchanged');
  const released=ok(await rpc(bSession,'budget_rates_lease',leaseArgs(record,'release',acquired.epoch)));assert(released.granted);state.heldRates=null;
  const stalePricing=await rpc(0,'budget_metadata_group_lease_v2',pricingArgs);assert.equal(stalePricing.status,409);assert.equal(stalePricing.data.code,'PT409');await step('A-pre-rate-Pricing-version-HTTP409-PT409');
  const snapshots=await Promise.all([snapshot(0,randomUUID()),snapshot(1,randomUUID())]);for(const snap of snapshots){assert.equal(snap.budgetItems.find(b=>b.id===state.fixture).twd_amount,after.twd_amount);assert.equal(snap.tripBudgetRates.rates.JPY,state.quote.rates.JPY);assert.deepEqual([...snap.actualExpenses].sort((a,b)=>a.id.localeCompare(b.id)),state.before.actuals);}
  // Genuine Realtime updates must converge both rendered lists without reload.
  const texts=[];for(let i=0;i<2;i++){const page=r.browserPages[i];await until(async()=>{const row=page.locator('.bw-row').filter({has:page.getByRole('button',{name:state.title,exact:true})});return await row.count()===1&&(await row.innerText()).includes(Number(after.twd_amount).toLocaleString('zh-TW'));},'actor '+i+' canonical list amount');assert.equal(await page.locator('vite-error-overlay').count(),0);texts.push(await page.locator('body').innerText());await page.screenshot({path:path.join(dir,'changed-rate-actor-'+i+'.png'),fullPage:false});}
  await write('browser-text.json',texts);assert.deepEqual(state.consoleErrors,[]);state.after=after;
  const event={id:'REAL-CHANGED-QUOTE-REPRICING',status:'Passed',at:new Date().toISOString(),oldQuoteDate:state.before.trips.find(t=>t.id===trip).budget_exchange_rates.quoted_at,newQuoteDate:state.quote.quoted_at,oldJpy:beforeCommit.budget.exchange_rate,newJpy:after.exchange_rate,jpyAmount:after.amount,oldTwd:beforeCommit.budget.twd_amount,newTwd:after.twd_amount,allocations:Object.values(allocation),distinctUsers:2,pricingBlocksRates:true,ratesBlocksPricing:true,staleRatesPT409:true,stalePricingPT409:true,exactRequestReplay:true,bothRealSnapshotsConverged:true,bothRenderedListsConvergedWithoutReload:true,actualRowsAndParticipantsExact:4,retainedBudgetsExact:true};state.events.push(event);await write('results.json',{events:state.events,steps:state.steps});return event;
 }
 if(args.mode==='inspect-ui'){
  const pages=[];for(let i=0;i<r.browserPages.length;i++){const page=r.browserPages[i];pages.push({actor:i,text:await page.locator('body').innerText()});await page.screenshot({path:path.join(dir,'ui-diagnostic-'+i+'.png'),fullPage:false});}await write('ui-diagnostic.json',{at:new Date().toISOString(),pages});return {captured:pages.length,location:'Git-ignored ui-diagnostic.json',noHostedWrite:true};
 }
 if(args.mode==='ui-readback'){
  assert(state.after);const total=(await budgets()).reduce((sum,b)=>sum+Number(b.twd_amount),0),expected=Number(state.after.twd_amount)/2;assert(Number.isInteger(expected));
  for(let i=0;i<2;i++){
   const page=r.browserPages[i];if(!await page.locator('.bw-row.is-selected').filter({has:page.getByRole('button',{name:state.title,exact:true})}).count())await page.getByRole('button',{name:state.title,exact:true}).click();await page.getByRole('tab',{name:'項目明細',exact:true}).click();await page.getByText('各人負擔 TWD',{exact:true}).waitFor({state:'visible',timeout:8000});
   const text=await page.locator('body').innerText(),start=text.indexOf('各人負擔 TWD');assert(start>=0);const detail=text.slice(start);for(const name of ['B7 QA A','B7 QA B'])assert(detail.includes(name+'\n'+expected.toLocaleString('zh-TW')),'Actual rendered per-user allocation required');assert(text.includes('1 JPY = '+state.quote.rates.JPY+' TWD'));await page.screenshot({path:path.join(dir,'allocation-actor-'+i+'.png'),fullPage:false});
   await page.getByRole('tab',{name:'旅程統計',exact:true}).click();const stats=await page.locator('body').innerText();assert(stats.includes('全旅程預算\nNT$ '+total.toLocaleString('zh-TW')));assert(stats.includes('1 JPY\n'+state.quote.rates.JPY+' TWD'));await page.screenshot({path:path.join(dir,'statistics-actor-'+i+'.png'),fullPage:false});
  }
  await protectedHistory();assert.deepEqual(state.consoleErrors,[]);const event={id:'CHANGED-RATE-UI-ALLOCATIONS-STATISTICS',status:'Passed',at:new Date().toISOString(),bothRealBrowsers:true,perPerson:expected,wholeTripBudget:total,newJpy:state.quote.rates.JPY,reloaded:false};state.events.push(event);await write('results.json',{events:state.events,steps:state.steps});return event;
 }
 if(args.mode==='cleanup'){
  assert(state.after&&!state.cleanupStarted);state.cleanupStarted=true;const a=r.browserPages[0];if(!await a.locator('.bw-row.is-selected').filter({has:a.getByRole('button',{name:state.title,exact:true})}).count())await a.getByRole('button',{name:state.title,exact:true}).click();await a.getByRole('tab',{name:'項目明細',exact:true}).click();await a.getByRole('button',{name:'刪除項目',exact:true}).click();await a.getByRole('dialog').getByRole('button',{name:'刪除',exact:true}).click();await until(async()=>!(await budgets()).some(b=>b.id===state.fixture),'ordinary Lifecycle delete');await protectedHistory();await step('unpaid-QA-Budget-normally-deleted');const after={trips:await read(`trips?id=in.(${state.before.trips.map(t=>t.id).join(',')})&select=*&order=id`),baselines:await read(`trip_budget_baselines?trip_id=in.(${state.before.trips.map(t=>t.id).join(',')})&select=*&order=trip_id`),budgets:await budgets(),actuals:await actuals()};
  const other=state.before.trips.find(t=>t.id!==trip);assert.deepEqual(after.trips.find(t=>t.id===other.id),other);assert.deepEqual(after.baselines.find(b=>b.trip_id===other.id),state.before.baselines.find(b=>b.trip_id===other.id));assert.deepEqual(after.budgets,state.before.budgets);assert.deepEqual(after.actuals,state.before.actuals);const baseline=after.baselines.find(b=>b.trip_id===trip);assert.equal(baseline.payload.items.length,after.budgets.length);for(const b of after.budgets){const saved=baseline.payload.items.find(z=>z.id===b.id);for(const key of ['title','currency','amount','twd_amount','exchange_rate'])assert.deepEqual(saved[key],b[key]);}await write('ordinary-after.json',after);return {ordinaryQaDelete:true,otherQaRatesAndBaselineExact:true,mainBaselineDerivedFromCurrentCompleteItems:true,originalFourActualsExact:true,retainedBudgetsExact:true,newPaidData:0};
 }
 if(args.mode==='logout'){
  const statuses=[];for(const session of x.sessions){const out=await request('/auth/v1/logout?scope=global',{token:session.access_token,method:'POST'});assert.equal(out.status,204);const refresh=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token}});assert([400,401].includes(refresh.status));assert(['refresh_token_not_found','refresh_token_already_used','session_not_found'].includes(refresh.data?.error_code));statuses.push({logout:out.status,refreshRefused:refresh.status});}
  x.sessions=[];state.sessions=[];await write('logout.json',{at:new Date().toISOString(),ordinaryJwt:true,statuses,independentAuthReadbackRequired:true});return {ordinaryGlobalLogoutBoth:true,realRefreshTokensRefused:true};
 }
 throw Error('Unsupported rates final mode');
}
