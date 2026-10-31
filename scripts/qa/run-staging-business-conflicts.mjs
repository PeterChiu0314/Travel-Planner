// Explicitly authorized disposable fixtures on the named Staging only.
// Admin is restricted to setup/cleanup; every acceptance RPC uses Auth user JWTs.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {persistBudgetWorkspace} from '../../src/lib/budgetWorkspaceService.js';

const project='uyqdopksfysbobhjcepk',work='.tmp-staging-conflict';
const env=Object.fromEntries((await fs.readFile('.env.staging.local','utf8')).split(/\r?\n/).map(x=>x.match(/^\s*([A-Z_0-9]+)\s*=\s*["']?(.*?)["']?\s*$/)).filter(Boolean).map(m=>[m[1],m[2]]));
const url=env.VITE_SUPABASE_URL,anon=env.VITE_SUPABASE_ANON_KEY;
assert.equal(url,`https://${project}.supabase.co`,'Hard fail before any request outside the named Staging');
const admin=(process.env.STAGING_FIXTURE_ADMIN_KEY||await fs.readFile(`${work}/admin-key.local`,'utf8')).trim();
const claims=token=>JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
assert.equal(claims(admin).ref,project);assert.equal(claims(admin).role,'service_role');
if(anon.startsWith('eyJ')){assert.equal(claims(anon).ref,project);assert.equal(claims(anon).role,'anon');}
else assert.match(anon,/^sb_publishable_[A-Za-z0-9_-]+$/);
if(!process.argv.includes('--authorized-disposable-fixtures'))throw Error('Explicit fixture authorization switch required');
const run=randomUUID(),users=[],sessions=[],results=[],requests=[];
const trip=randomUUID(),state={run,project,trip,users:[],createdTrip:false};
await fs.mkdir(work,{recursive:true});
const saveState=()=>fs.writeFile(`${work}/fixture-state.json`,JSON.stringify(state,null,2));
await saveState();
const http=async(token,route,method='GET',body,{fixture=false}={})=>{
 const started=performance.now();
 const r=await fetch(url+route,{method,headers:{apikey:fixture?admin:anon,...(token===anon?{}:{Authorization:`Bearer ${token}`}),'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 const text=await r.text();let data=null;try{data=text?JSON.parse(text):null;}catch{throw Error(`Non-JSON response: ${r.status}`);}
 const item={status:r.status,code:data?.code??null,ms:Math.round(performance.now()-started)};
 if(!fixture)requests.push({route:route.split('?')[0],...item});
 return {...item,data};
};
const success=r=>{assert(r.status>=200&&r.status<300,`HTTP ${r.status}, code ${r.code}, ${r.data?.message||r.data?.msg||''}`);return r.data;};
const rpc=(token,name,args)=>http(token,`/rest/v1/rpc/${name}`,'POST',args);
// Resume needs fresh Auth/create/race setup, but does not repeat the six other
// passed incident cases from the preserved initial evidence.
const onlyValidDelete=process.argv.includes('--valid-delete-only');
const initialEvidence=onlyValidDelete?JSON.parse(await fs.readFile(`${work}/http-results-before-delete-origin-review.json`,'utf8')):process.argv.includes('--resume-after-lease-status')?JSON.parse(await fs.readFile(`${work}/http-results-initial-lease-status.json`,'utf8')):null;
if(initialEvidence)assert.equal(initialEvidence.project,project);
const passedBefore=new Set(initialEvidence?.results.filter(x=>x.status==='passed').map(x=>x.name));
const setupCase=name=>/^(Real Auth|Authenticated HTTP creates|Two account sessions race)/.test(name);
const test=async(name,fn)=>{if(onlyValidDelete&&!/^(Real Auth|Authenticated HTTP creates|A valid legacy Delete)/.test(name))return;if(passedBefore.has(name)&&!setupCase(name))return;const started=performance.now();try{await fn();results.push({name,status:'passed',ms:Math.round(performance.now()-started)});console.log(`PASS ${name}`);}catch(e){results.push({name,status:'failed',error:String(e.message).replace(/eyJ[A-Za-z0-9_.-]+/g,'[redacted]')});throw e;}};
let a,b,a2,canonical,originalArgs;
const snapshot=async token=>success(await rpc(token,'read_budget_snapshot',{p_trip_id:trip}));
const graph=async()=>snapshot(a);
const unchangedConflict=async(name,call)=>test(name,async()=>{const before=await graph();const r=await call();assert.equal(r.status,409);assert.equal(r.code,'PT409');assert.deepEqual(await graph(),before);});
const payload=title=>({title,category:'其他',amount:900,currency:'TWD',payer_id:users[0].id,pricing_mode:'split_total',split_type:'equal',participantIds:users.map(u=>u.id),payment_action:'keep',payment_expected:[],unified_planning:true});
const saveArgs=(id,base,p,request=randomUUID())=>({p_trip_id:trip,p_kind:'budget',p_id:id,p_base_updated_at:base,p_payload:p,p_request_id:request});
let failure;
try{
 // Real Auth Admin endpoint, no outgoing email and no modification of existing users.
 for(const suffix of ['a','b']){
  const password=randomBytes(28).toString('base64url')+'Aa1!';
  const created=success(await http(admin,'/auth/v1/admin/users','POST',{email:`qa-pt409-${run}-${suffix}@example.invalid`,password,email_confirm:true,user_metadata:{qa_run:run}},{fixture:true}));
  const user=created.user||created;assert(user.id);users.push({id:user.id,password,email:user.email});state.users.push(user.id);await saveState();
 }
 const login=async user=>{const r=success(await http(anon,'/auth/v1/token?grant_type=password','POST',{email:user.email,password:user.password}));assert.equal(claims(r.access_token).role,'authenticated');sessions.push(r.access_token);return r.access_token;};
 a=await login(users[0]);b=await login(users[1]);a2=await login(users[0]);
 await test('Real Auth verifies two accounts and three distinct sessions',async()=>{
  assert.equal(new Set([a,b,a2].map(t=>claims(t).session_id)).size,3);
  for(const [token,user] of [[a,users[0]],[b,users[1]],[a2,users[0]]])assert.equal(success(await http(token,'/auth/v1/user')).id,user.id);
 });
 success(await http(admin,'/rest/v1/trips','POST',{id:trip,title:`QA PT409 ${run}`,name:`QA PT409 ${run}`,destination:'Isolated QA',start_date:'2099-01-01',end_date:'2099-01-03',owner_id:users[0].id},{fixture:true}));state.createdTrip=true;await saveState();
 success(await http(admin,'/rest/v1/trip_members','POST',users.map((u,i)=>({trip_id:trip,user_id:u.id,role:i?'editor':'owner',status:'approved',display_name:`PT409 QA ${i?'B':'A'}`})),{fixture:true}));
 await test('Authenticated HTTP creates Budget with participants and a retained payment',async()=>{
  originalArgs=saveArgs(null,null,{...payload('Initial'),payment_action:'paid'});
  const saved=success(await rpc(a,'save_budget_workspace_record_v3',originalArgs));
  const s=await snapshot(b);assert.equal(s.budgetItems.length,1);assert.equal(s.actualExpenses.length,1);assert.equal(s.budgetParticipants.length,2);assert.equal(s.actualParticipants.length,2);assert.equal(s.actualExpenses[0].payment_active,true);
  assert.equal(saved.id,s.budgetItems[0].id);canonical=s.budgetItems[0];
 });
 await test('Two account sessions race the same base: exactly one commit and one HTTP 409',async()=>{
  const before=await graph(),p={...payload('A winner candidate'),payment_expected:before.actualExpenses.map(x=>({id:x.id,updated_at:x.updated_at}))};
  const argsA=saveArgs(canonical.id,canonical.updated_at,p),argsB=saveArgs(canonical.id,canonical.updated_at,{...p,title:'B winner candidate'});
  const raced=await Promise.all([rpc(a,'save_budget_workspace_record_v3',argsA),rpc(b,'save_budget_workspace_record_v3',argsB)]);
  assert.deepEqual(raced.map(r=>r.status).sort(),[200,409]);assert.equal(raced.find(r=>r.status===409).code,'PT409');
  const s=await graph();assert.equal(s.budgetItems[0].title,raced[0].status===200?p.title:argsB.p_payload.title);assert.deepEqual(s.actualExpenses,before.actualExpenses);assert.deepEqual(s.actualParticipants,before.actualParticipants);assert.deepEqual(s.attachments,before.attachments);
 });
 const del=(token,id,base)=>rpc(token,'delete_budget_workspace_record',{p_trip_id:trip,p_kind:'budget',p_id:id,p_base_updated_at:base});
 await unchangedConflict('Legacy Delete missing base returns bounded HTTP 409 with graph unchanged',()=>del(b,canonical.id,null));
 await unchangedConflict('Legacy Delete stale base returns HTTP 409 with graph unchanged',()=>del(b,canonical.id,canonical.updated_at));
 await unchangedConflict('Legacy Delete missing record returns HTTP 409',()=>del(a,randomUUID(),canonical.updated_at));
 await unchangedConflict('Stale Save request and identical replay both reject without writes',async()=>{
  const s=await graph(),args=saveArgs(canonical.id,canonical.updated_at,{...payload('Must not replace'),payment_expected:s.actualExpenses.map(x=>({id:x.id,updated_at:x.updated_at}))});
  const first=await rpc(b,'save_budget_workspace_record_v3',args),second=await rpc(b,'save_budget_workspace_record_v3',args);assert.equal(first.status,409);assert.equal(first.code,'PT409');assert.equal(second.status,409);return second;
 });
 await unchangedConflict('Payment expected-version conflict preserves retained payment and financial graph',async()=>{
  const s=await graph();return rpc(b,'save_budget_workspace_record_v3',saveArgs(canonical.id,s.budgetItems[0].updated_at,{...payload('Do not change payment'),payment_action:'unpaid',payment_expected:[]}));
 });
 await test('Successful request replay returns its original receipt without repeating financial writes',async()=>{
  const before=await graph(),r=success(await rpc(a2,'save_budget_workspace_record_v3',originalArgs));assert.equal(r.id,canonical.id);assert.deepEqual(await graph(),before);
 });
 await test('Independent tab capabilities contend without overwriting or accepting stale admission',async()=>{
  const s=await graph(),base=s.budgetItems[0].updated_at;
  const capA={p_kind:'budget',p_id:canonical.id,p_session_id:randomUUID(),p_token:randomUUID(),p_action:'acquire',p_base_updated_at:base};
  assert.equal(success(await rpc(a,'budget_edit_lease',capA)).granted,true);
  const denied=success(await rpc(a2,'budget_edit_lease',{...capA,p_session_id:randomUUID(),p_token:randomUUID()}));assert.equal(denied.granted,false);assert.equal(denied.reason,'locked');
  const stale=await rpc(b,'budget_edit_lease',{...capA,p_session_id:randomUUID(),p_token:randomUUID(),p_base_updated_at:canonical.updated_at});assert.equal(stale.status,409);assert.equal(stale.code,'PT409');
  const blocked=await rpc(b,'save_budget_workspace_record_v3',saveArgs(canonical.id,base,{...payload('Blocked'),payment_expected:s.actualExpenses.map(x=>({id:x.id,updated_at:x.updated_at}))}));
  // PostgREST 14 documents 55* -> HTTP 500; it is distinct from PT409.
  assert.equal(blocked.status,500);assert.equal(blocked.code,'55P03');assert.deepEqual(await graph(),s);
  assert.equal(success(await rpc(a,'budget_edit_lease',{...capA,p_action:'release'})).granted,true);
 });
 await unchangedConflict('Selection v1 rejects a removed record with HTTP 409',()=>rpc(a,'update_budget_selection',{p_trip_id:trip,p_session_id:randomUUID(),p_kind:'budget',p_id:randomUUID()}));
 await unchangedConflict('Selection v2 rejects a removed record with HTTP 409',()=>rpc(a,'update_budget_selection_v2',{p_trip_id:trip,p_session_id:randomUUID(),p_kind:'budget',p_id:randomUUID(),p_activity_id:randomUUID(),p_action:'select'}));
 await unchangedConflict('Receipt RPC rejects a missing expense with HTTP 409 before metadata changes',()=>rpc(a,'mutate_budget_receipt',{p_trip_id:trip,p_actual_id:randomUUID(),p_action:'delete',p_receipt:{id:randomUUID()},p_edit_session_id:randomUUID(),p_edit_token:randomUUID()}));
 await test('Client persistence boundary reconciles a real HTTP 409 once and preserves its draft',async()=>{
  const before=await graph(),draft={...payload('Recoverable draft'),unified_planning:true,payment_expected:before.actualExpenses.map(x=>({id:x.id,updated_at:x.updated_at}))};let writes=0,reads=0;
  const r=await persistBudgetWorkspace({tripId:trip,reload:async()=>{reads++;await snapshot(b);return {ok:true};},supabase:{rpc:async(name,args)=>{writes++;const r=await rpc(b,name,args);return r.status>=400?{error:r.data}:{data:r.data};}}},'budget',draft,canonical.id,{baseUpdatedAt:canonical.updated_at,operationId:randomUUID()});
  assert.equal(r.ok,false);assert.equal(r.conflict,true);assert.equal(writes,1);assert.equal(reads,1);assert.equal(draft.title,'Recoverable draft');assert.deepEqual(await graph(),before);
 });
 if(!onlyValidDelete){
 const personal=success(await rpc(a,'mutate_luggage_item',{p_trip_id:trip,p_scope:'personal',p_action:'save',p_payload:{title:'QA personal',category:'QA'}}));
 const shared=success(await rpc(a,'mutate_luggage_item',{p_trip_id:trip,p_scope:'shared',p_action:'save',p_payload:{title:'QA shared',assigned_to:users[0].id}}));
 const luggage=async()=>({personal:success(await http(a,`/rest/v1/luggage_items?trip_id=eq.${trip}&order=id`)),shared:success(await http(a,`/rest/v1/shared_luggage_items?trip_id=eq.${trip}&order=id`))});
 for(const [name,fn,args] of [
  ['Luggage Save','mutate_luggage_item',{p_trip_id:trip,p_scope:'personal',p_action:'save',p_item_id:personal.id,p_expected_updated_at:'2000-01-01T00:00:00Z',p_payload:{title:'Do not replace'}}],
  ['Luggage Assign','assign_luggage_item',{p_trip_id:trip,p_scope:'personal',p_item_id:personal.id,p_expected_updated_at:'2000-01-01T00:00:00Z',p_assigned_to:users[0].id}],
  ['Luggage Privatize','privatize_luggage_item',{p_trip_id:trip,p_item_id:shared.id,p_expected_updated_at:'2000-01-01T00:00:00Z',p_category:'QA'}],
  ['Luggage Reorder','reorder_luggage_items',{p_trip_id:trip,p_scope:'personal',p_item_id:personal.id,p_target_id:personal.id,p_placement:'before',p_expected_items:[]}]
 ])await test(`${name} stale version returns HTTP 409 and preserves both luggage scopes`,async()=>{const before=await luggage(),r=await rpc(a,fn,args);assert.equal(r.status,409);assert.equal(r.code,'PT409');assert.equal(r.data.message,'luggage_stale');assert.deepEqual(await luggage(),before);});
 }
 await test('Unapproved member receives HTTP 403 / 42501, never a business conflict',async()=>{
  success(await http(admin,`/rest/v1/trip_members?trip_id=eq.${trip}&user_id=eq.${users[1].id}`,'PATCH',{status:'pending'},{fixture:true}));
  const before=await graph(),r=await del(b,canonical.id,before.budgetItems[0].updated_at);assert.equal(r.status,403);assert.equal(r.code,'42501');assert.deepEqual(await graph(),before);
 });
 await test('A valid legacy Delete still succeeds and retains payment origin and historical cost',async()=>{
  const before=await graph();success(await del(a,canonical.id,before.budgetItems[0].updated_at));const after=await graph();assert.equal(after.budgetItems.length,0);assert.equal(after.actualExpenses.length,1);assert.equal(after.actualExpenses[0].budget_item_id,null);assert.equal(after.actualExpenses[0].budget_origin_id,canonical.id);
  for(const key of ['amount','currency','exchange_rate','twd_amount','actual_twd_amount','payment_history','payment_active'])assert.deepEqual(after.actualExpenses[0][key],before.actualExpenses[0][key]);assert.deepEqual(after.actualParticipants,before.actualParticipants);
  // Existing keep_actual_twd_cost deliberately labels a detached Actual manual;
  // immutable historical identity is budget_origin_id, asserted above.
  assert.equal(before.actualExpenses[0].payment_origin,'budget_toggle');assert.equal(after.actualExpenses[0].payment_origin,'manual');
 });
}catch(e){failure=e;console.error(`FAIL ${String(e.message).replace(/eyJ[A-Za-z0-9_.-]+/g,'[redacted]')}`);}
finally{
 const cleanup=[];
 // Only fixture IDs created by this invocation; never enumerate/delete existing data.
 if(state.createdTrip){try{success(await http(admin,`/rest/v1/trips?id=eq.${trip}&title=like.QA%20PT409%20*`,'DELETE',undefined,{fixture:true}));const left=success(await http(admin,`/rest/v1/trips?id=eq.${trip}&select=id`,'GET',undefined,{fixture:true}));assert.equal(left.length,0);cleanup.push({resource:'fixture trip',removed:true});
  // Collaboration intentionally retains opaque revision tombstones after a
  // normal trip deletion. QA must also remove only its own generated ID.
  success(await http(admin,`/rest/v1/budget_collaboration_signals?trip_id=eq.${trip}`,'DELETE',undefined,{fixture:true}));assert.equal(success(await http(admin,`/rest/v1/budget_collaboration_signals?trip_id=eq.${trip}&select=trip_id`,'GET',undefined,{fixture:true})).length,0);
 }catch(e){cleanup.push({resource:'fixture trip metadata',removed:false});failure??=e;}}
 for(const user of users){try{success(await http(admin,`/auth/v1/admin/users/${user.id}`,'DELETE',undefined,{fixture:true}));const readback=await http(admin,`/auth/v1/admin/users/${user.id}`,'GET',undefined,{fixture:true});assert.equal(readback.status,404);cleanup.push({resource:'fixture auth user',removed:true});}catch(e){cleanup.push({resource:'fixture auth user',removed:false});failure??=e;}}
 const combined=new Map(((initialEvidence?.combinedResults||initialEvidence?.results)?.filter(x=>x.status==='passed')||[]).map(x=>[x.name,x]));for(const r of results)combined.set(r.name,r);
 const evidence={project,run,date:new Date().toISOString(),realHttp:true,realAuth:true,distinctAccounts:users.length,distinctSessions:sessions.length,acceptanceUsesServiceRole:false,fixtureOnlyAdmin:true,results,requests,cleanup,passed:results.filter(x=>x.status==='passed').length,failed:results.filter(x=>x.status==='failed').length,incomplete:Boolean(failure),combinedDistinctPassed:[...combined.values()].filter(x=>x.status==='passed').length,combinedResults:[...combined.values()]};
 await fs.writeFile(`${work}/http-results.json`,JSON.stringify(evidence,null,2)+'\n');state.cleanup=cleanup;await saveState();
 console.log(JSON.stringify({passed:evidence.passed,failed:evidence.failed,incomplete:evidence.incomplete,cleanup,output:`${work}/http-results.json`}));
}
if(failure)process.exitCode=1;
