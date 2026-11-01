// Activation-specific compatibility probes, always ordinary user JWTs.
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
export async function execute({credentials:c,runtime:r,args}){
 assert.equal(r.project,'uyqdopksfysbobhjcepk');const x=r.cutover,s=r.browserProof,id=x.incompleteFixtures.find(z=>z.kind==='budget').id,trip=x.trips[0],token=x.sessions[0].access_token;
 const request=async(route,{method='GET',body,headers={}}={})=>{const z=await fetch(r.url+'/rest/v1/'+route,{redirect:'error',method,headers:{apikey:c.anon,Authorization:'Bearer '+token,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});let data;try{data=await z.json();}catch{}return {status:z.status,data};};
 const graph=async()=>{const parent=await request(`budget_items?id=eq.${id}&select=*`),people=await request(`budget_item_participants?budget_item_id=eq.${id}&select=*&order=user_id`),actual=await request(`actual_expenses?id=eq.${x.retainedActual}&select=*`);assert.equal(parent.status,200);assert.equal(people.status,200);assert.equal(actual.status,200);return {parent:parent.data,people:people.data,actual:actual.data};},save=()=>fs.writeFile(path.join(r.dir,'browser-results.json'),JSON.stringify(s,null,2));
 if(args.mode==='snapshots'){
  for(let i=1;i<=10;i++){const name='read_budget_metadata_snapshot'+(i===1?'':'_v'+i),z=await request('rpc/'+name,{method:'POST',body:{p_trip_id:trip,p_session_id:randomUUID()}});assert.equal(z.status,200,`Snapshot v${i}`);assert.equal(z.data.tripId,trip);assert(Array.isArray(z.data.budgetItems)&&Array.isArray(z.data.actualExpenses));assert(z.data.budgetItems.some(v=>v.id===id));}
  s.events.push({id:'ACTIVATED-SNAPSHOT-V1-V10',status:'Passed',at:new Date().toISOString(),ordinaryJwt:true,versions:10,exactTripScoped:true});await save();return s.events.at(-1);
 }
 if(args.mode==='legacy-writes'){
  const before=await graph(),row=before.parent[0];assert.equal(before.parent.length,1);const denied=[];
  for(const [route,method,body] of [[`budget_items?id=eq.${id}`,'PATCH',{title:'QA forbidden raw DML'}],[`budget_item_participants?budget_item_id=eq.${id}&user_id=eq.${x.sessions[0].user.id}`,'PATCH',{share_amount:9}]]){const z=await request(route,{method,body,headers:{Prefer:'return=representation'}});assert(z.status>=400);assert(['55000','55P03','42501','PT409'].includes(z.data?.code),'Must hit a real protocol/lease fence, not invalid input');assert.notEqual(z.data.code,'40001');assert.deepEqual(await graph(),before);denied.push({method,httpStatus:z.status,code:z.data.code});}
  const payload={...row,title:'QA forbidden legacy save',participantIds:x.sessions.map(v=>v.user.id),shares:{},linkedItemIds:[x.linkFixture],unified_planning:true};
  const legacy=await request('rpc/save_budget_workspace_record_v3',{method:'POST',body:{p_trip_id:trip,p_kind:'budget',p_id:id,p_base_updated_at:row.updated_at,p_request_id:randomUUID(),p_payload:payload}});assert(legacy.status>=400);assert(['55000','55P03','42501','PT409'].includes(legacy.data?.code));assert.notEqual(legacy.data.code,'40001');assert.deepEqual(await graph(),before);denied.push({legacySave:true,httpStatus:legacy.status,code:legacy.data.code});
  s.events.push({id:'ACTIVATED-LEGACY-WRITE-FENCES',status:'Passed',at:new Date().toISOString(),ordinaryJwt:true,denied,financialGraphUnchanged:true});await save();return s.events.at(-1);
 }
 throw Error('Unsupported compatibility probe');
}
