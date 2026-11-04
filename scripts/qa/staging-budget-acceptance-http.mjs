import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {assertTarget,endpoint,project,sha} from './staging-budget-acceptance-scope.mjs';

// No retries, redirects, raw bodies, tokens, URLs with query strings or PII in evidence.
export function createHttp({url,anon,fetchImpl=fetch,requests=[],beforeRequest=()=>{}}){
 assertTarget(url);
 assert(typeof anon==='string'&&(anon.startsWith('sb_publishable_')||anon.startsWith('eyJ')));
 return async(token,route,{method='GET',body,admin=false,raw=false,prefer='return=representation'}={})=>{
  assertTarget(url);assert(route.startsWith('/')&&!route.startsWith('//')&&!route.includes('://'));
  beforeRequest({route,method});
  assert(['return=representation','return=minimal'].includes(prefer));
  const started=performance.now();
  const response=await fetchImpl(url+route,{method,redirect:'error',headers:{apikey:admin?token:anon,...(token?{Authorization:`Bearer ${token}`} :{}),'Content-Type':raw?'image/png':'application/json',Prefer:prefer},body:body===undefined?undefined:raw?body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  const bytes=Buffer.from(await response.arrayBuffer());let data=null;try{data=JSON.parse(bytes.toString());}catch{}
  requests.push({path:route.split('?')[0].replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/gi,':qa-id'),method,status:response.status,code:data?.code||null,admin,ms:Math.round(performance.now()-started)});
  return {status:response.status,data,bytes};
 };
}
export function ok(r){assert(r.status>=200&&r.status<300,`HTTP ${r.status} ${r.data?.code||r.data?.error||''}`);return r.data;}
export const claims=t=>JSON.parse(Buffer.from(t.split('.')[1],'base64url').toString());
export async function realSessions({http,admin,qa,onSession=()=>{}}){
 assert(qa.users?.length===2&&new Set(qa.users).size===2);assert.match(qa.run,/^[a-f0-9-]{36}$/);
 assert(qa.users.every(id=>/^[a-f0-9-]{36}$/.test(id)),'Exact existing QA UUIDs required');
 const sessions=[];
 for(const i of [0,1,0]){
  const user=ok(await http(admin,`/auth/v1/admin/users/${qa.users[i]}`,{admin:true}));
  assert.equal(user.id,qa.users[i]);assert.equal(user.user_metadata?.qa_run,qa.run);assert(user.email.endsWith('@example.invalid'));
  const link=ok(await http(admin,'/auth/v1/admin/generate_link',{admin:true,method:'POST',body:{type:'magiclink',email:user.email}}));
  const session=ok(await http(null,'/auth/v1/verify',{method:'POST',body:{type:'magiclink',token_hash:(link.properties||link).hashed_token}}));
  onSession(session);const c=claims(session.access_token);assert.equal(c.role,'authenticated');assert.equal(c.sub,user.id);assert.equal(ok(await http(session.access_token,'/auth/v1/user')).id,user.id);sessions.push(session);
 }
 assert.equal(new Set(sessions.map(s=>claims(s.access_token).session_id)).size,3);
 return sessions;
}
export function fixtureApi({http,sessions,trip,onCreate=()=>{}}){
 const sids=sessions.map(()=>randomUUID()),rpc=async(i,name,args)=>http(sessions[i].access_token,`/rest/v1/rpc/${name}`,{method:'POST',body:args});
 const snap=async(i=0)=>ok(await rpc(i,'read_budget_metadata_snapshot_v9',{p_trip_id:trip,p_session_id:sids[i]}));
 const read=async(table,filter,i=0)=>ok(await http(sessions[i].access_token,`/rest/v1/${table}?${filter}`));
 const group=async(i,kind,id,key)=>{const s=await snap(i);const g=s.metadataRecords.find(r=>r.kind===kind&&r.id===id)?.groups.find(g=>g.group===key);assert(g,`Missing ${kind} ${key}`);return g;};
 const held=new Map();
 const acquire=async(i,kind,id,key)=>{
  const g=await group(i,kind,id,key),args={p_trip_id:trip,p_kind:kind,p_id:id,p_group:key,p_session_id:sids[i],p_token:randomUUID(),p_action:'acquire',p_base_revision:g.revision,p_epoch:null,p_activity_seq:1,p_dirty:true,p_versions:key==='pricing'?g.value.versions:g.versions};
  const result=ok(await rpc(i,'budget_metadata_group_lease_v2',args));if(result.granted)held.set(args.p_token,{i,args,result});return {i,args,result};
 };
 const release=async h=>{const r=ok(await rpc(h.i,'budget_metadata_group_lease_v2',{...h.args,p_action:'release',p_epoch:h.result.epoch,p_base_revision:h.result.revision,p_dirty:false}));assert(r.granted);held.delete(h.args.p_token);return r;};
 const patchHeld=async(h,value,base=h.result.revision)=>{
  const r=await rpc(h.i,'patch_budget_metadata_group_v2',{p_trip_id:trip,p_kind:h.args.p_kind,p_id:h.args.p_id,p_group:h.args.p_group,p_base_revision:base,p_session_id:h.args.p_session_id,p_token:h.args.p_token,p_epoch:h.result.epoch,p_patch:{[h.args.p_group]:value},p_request_id:randomUUID(),p_versions:h.args.p_group==='pricing'?value.versions:h.result.versions});
  if(r.status===200)h.result.revision=r.data.revision;return r;
 };
 const patch=async(i,kind,id,key,build)=>{const h=await acquire(i,kind,id,key);assert(h.result.granted);try{return ok(await patchHeld(h,build(h.result.value)));}finally{await release(h);}};
 const create=async kind=>{const d=ok(await rpc(0,'create_budget_workspace_placeholder',{p_trip_id:trip,p_kind:kind,p_session_id:sids[0],p_request_id:randomUUID()}));assert(d.created_id);await onCreate(d.created_id);return d.created_id;};
 // Compare the complete business graph; volatile lease/collaboration clocks are separate.
 const graph=async()=>{const s=await snap();return Object.fromEntries(['budgetItems','actualExpenses','budgetParticipants','actualParticipants','itineraryBudgetLinks','budgetBaseline','tripBudgetRates','attachments'].map(k=>[k,s[k]??null]));};
 return {rpc,snap,read,group,acquire,release,patchHeld,patch,create,graph,sids,releaseAll:async()=>{for(const h of held.values())await release(h);}};
}

export async function httpCases(r){
 const {check,api:a,sessions,trip,http}=r,ids=sessions.slice(0,2).map(s=>s.user.id);
 await check('A01',async()=>({users:2,sessions:3,sessionHashes:sessions.map(s=>sha(claims(s.access_token).session_id))}));
 await check('A02',async()=>{
  const u=randomUUID(),args={p_trip_id:trip,p_session_id:a.sids[0]};
  for(const [name,body] of [
   ['read_budget_metadata_undo',args],['clear_budget_metadata_undo',args],
   ['budget_workspace_undo_lease',{...args,p_operation_id:u,p_token:u,p_action:'acquire',p_epoch:null}],
   ['undo_budget_workspace',{...args,p_operation_id:u,p_token:u,p_epoch:1,p_request_id:u}],
   ['undo_budget_metadata_group',{...args,p_operation_id:u,p_token:u,p_epoch:1,p_request_id:u}],
  ]){const z=await a.rpc(0,name,body);assert.equal(z.status,403,name);assert.equal(z.data?.code,'42501',name);}
  return {ordinaryJwt:true,exactSignatures:5};
 });
 r.budget=await a.create('budget');assert((await a.snap()).budgetItems.some(b=>b.id===r.budget));
 assert(r.budget,'Lifecycle creation must pass before dependent cases');
 const id=r.budget;
 await a.patch(0,'budget',id,'title',()=>`QA acceptance ${r.run.slice(0,8)}`);
 await check('B03',async()=>{await a.patch(0,'budget',id,'category',()=> '交通');await a.patch(0,'budget',id,'payer',()=>ids[0]);const b=(await a.snap()).budgetItems.find(b=>b.id===id);assert.equal(b.category,'交通');assert.equal(b.payer_id,ids[0]);return {canonicalConfirmed:true};});
 await check('B04',async()=>{
  await a.patch(0,'budget',id,'pricing',v=>({...v,pricing_mode:'split_total',amount:100,unit_amount:null,currency:'JPY',exchange_rate:0.21,participantIds:ids,shares:{}}));
  let s=await a.snap(),b=s.budgetItems.find(b=>b.id===id);assert.equal(Number(b.amount),100);assert.equal(b.currency,'JPY');assert.equal(Number(b.exchange_rate),0.21);assert.equal(s.budgetParticipants.filter(p=>p.budget_item_id===id).length,2);
  await a.patch(0,'budget',id,'pricing',v=>({...v,pricing_mode:'custom',amount:120,unit_amount:null,currency:'TWD',exchange_rate:1,participantIds:ids,shares:{[ids[0]]:70,[ids[1]]:50}}));
  s=await a.snap();const people=s.budgetParticipants.filter(p=>p.budget_item_id===id);assert.deepEqual(people.map(p=>Number(p.share_amount)).sort((a,b)=>a-b),[50,70]);return {equalAndCustom:true,currencyAndRate:true};
 });
 await check('C01',async()=>{await Promise.all([a.patch(0,'budget',id,'title',()=>`QA concurrent ${r.run.slice(0,8)}`),a.patch(1,'budget',id,'note',()=> 'Real independent note')]);const b=(await a.snap()).budgetItems.find(b=>b.id===id);assert.equal(b.note,'Real independent note');assert(b.title.startsWith('QA concurrent'));return {distinctAccounts:true};});
 await check('C02',async()=>{const owner=await a.acquire(0,'budget',id,'title');assert(owner.result.granted);try{for(const i of [1,2]){const peer=await a.acquire(i,'budget',id,'title');assert.equal(peer.result.granted,false);assert.equal(peer.result.reason,'group_locked');}}finally{await a.release(owner);}return {differentUserAndSameUserSessionDenied:true};});
 await check('C03',async()=>{const h=await a.acquire(0,'budget',id,'note');assert(h.result.granted);try{const renewed=ok(await a.rpc(0,'budget_metadata_group_lease_v2',{...h.args,p_action:'renew',p_epoch:h.result.epoch,p_activity_seq:2}));assert(renewed.granted);assert.equal(renewed.epoch,h.result.epoch);}finally{await a.release(h);}const g=await a.group(1,'budget',id,'note');assert.equal(g.held,false);return {acquiredRenewedReleased:true};});
 const staleFailure=async()=>{const stale=await a.group(0,'budget',id,'title');await a.patch(1,'budget',id,'title',()=>`QA newer ${r.run.slice(0,8)}`);const h=await a.acquire(0,'budget',id,'title');assert(h.result.granted);const before=await a.graph();try{const z=await a.patchHeld(h,'Must never commit',stale.revision);assert.equal(z.status,409);assert.equal(z.data?.code,'PT409');assert.deepEqual(await a.graph(),before);}finally{await a.release(h);}return {http:409,code:'PT409',completeFinancialGraphUnchanged:true};};
 await check('C04',staleFailure);await check('B08',staleFailure);
 await check('C10',async()=>{const visible=await a.read('trips',`id=eq.${r.privateTrip}&select=id`,1);assert.deepEqual(visible,[]);const route=`/rest/v1/trip_members?trip_id=eq.${trip}&user_id=eq.${ids[1]}`;try{ok(await http(sessions[0].access_token,route,{method:'PATCH',body:{status:'pending'}}));const z=await a.rpc(1,'read_budget_metadata_snapshot_v9',{p_trip_id:trip,p_session_id:a.sids[1]});assert.equal(z.status,403);assert.equal(z.data?.code,'42501');}finally{const restored=ok(await http(sessions[0].access_token,route,{method:'PATCH',body:{status:'approved'}}));assert.equal(restored.length,1);}return {nonmemberAndRevokedEditor:true};});
}

export async function paymentAndSourceCases(r){
 const {check,api:a,trip,sessions}=r;
 const mutate=async(kind,id,type,intent)=>{
  const s=await a.snap(),record=s[`${type}Records`].find(z=>z.kind===kind&&z.id===id);assert(record);const token=randomUUID();
  const preview=type==='source'?ok(await a.rpc(0,'read_budget_source_preview',{p_trip_id:trip,p_id:id,p_action:intent.action,p_budget_id:intent.budget_id})):null;
  const versions=preview?.versions||record.value.versions,lease={p_trip_id:trip,p_kind:kind,p_id:id,p_session_id:a.sids[0],p_token:token,p_action:'acquire',p_base_revision:preview?.revision??record.revision,p_epoch:null,p_versions:versions,p_intent:type==='payment'?intent.action:intent};
  const held=ok(await a.rpc(0,`budget_${type}_lease${type==='payment'?'_v2':''}`,lease));assert(held.granted);
  try{return ok(await a.rpc(0,`mutate_budget_${type}${type==='payment'?'_v2':''}`,{p_trip_id:trip,p_kind:kind,p_id:id,p_session_id:a.sids[0],p_token:token,p_epoch:held.epoch,p_base_revision:held.revision,p_value:{...intent,versions},p_request_id:randomUUID()}));}
  finally{ok(await a.rpc(0,`budget_${type}_lease${type==='payment'?'_v2':''}`,{...lease,p_action:'release',p_epoch:held.epoch}));}
 };
 r.mutate=mutate;
 await check('B05',async()=>{let first,history;for(const action of ['paid','unpaid','paid']){await mutate('budget',r.budget,'payment',{action});const s=await a.snap(),rows=s.actualExpenses.filter(x=>x.budget_item_id===r.budget);assert.equal(rows.length,1);const z=rows[0];if(first)assert.equal(z.id,first);else{first=z.id;r.resources.push(z.id);await r.savePrivate();}assert.equal(z.payment_active,action==='paid');if(history)assert.deepEqual(z.payment_history.slice(0,history.length),history);history=z.payment_history;}r.retainedActual=first;return {oneActual:true,historyPrefixPreserved:true};});
 await check('B06',async()=>{
  const budget=await a.create('budget'),actual=await a.create('actual');
  await a.patch(0,'budget',budget,'title',()=>`QA first source ${r.run.slice(0,8)}`);
  await a.patch(0,'budget',budget,'payer',()=>sessions[0].user.id);
  await a.patch(0,'budget',budget,'pricing',v=>({...v,pricing_mode:'split_total',amount:100,unit_amount:null,currency:'TWD',exchange_rate:1,participantIds:[sessions[0].user.id],shares:{}}));
  await a.patch(0,'actual',actual,'title',()=> 'QA manual source Actual');await a.patch(0,'actual',actual,'payer',()=>sessions[0].user.id);
  await a.patch(0,'actual',actual,'pricing',v=>({...v,pricing_mode:'split_total',amount:100,unit_amount:null,currency:'TWD',exchange_rate:1,participantIds:[sessions[0].user.id],shares:{}}));
  await mutate('actual',actual,'lifecycle',{action:'set_paid_at',paid_at:new Date().toISOString()});
  const before=(await a.snap()).actualExpenses.find(z=>z.id===actual);assert.equal(before.budget_origin_id,null);
  for(const target of [budget,null]){
   const preview=ok(await a.rpc(0,'read_budget_source_preview',{p_trip_id:trip,p_id:actual,p_action:'relink_only',p_budget_id:target}));assert(preview);
   await mutate('actual',actual,'source',{action:'relink_only',budget_id:target});
   const after=(await a.snap()).actualExpenses.find(z=>z.id===actual);assert.equal(after.budget_item_id,target);assert.equal(after.budget_origin_id,budget);
   for(const k of ['amount','twd_amount','payer_id','payment_history','payment_active'])assert.deepEqual(after[k],before[k],k);
  }return {firstLinkDetachOnly:true,historicalOriginRetained:true};
 });
}
