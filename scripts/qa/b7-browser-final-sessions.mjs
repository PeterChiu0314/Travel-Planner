import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {gateOneRealResponse,qaDeadline} from './b7-real-response-gate.mjs';
export async function execute({credentials:c,runtime:r,args}){
 assert.equal(r.project,'uyqdopksfysbobhjcepk');const x=r.cutover,s=r.browserProof,[a,b]=r.browserPages,trip=x.trips[0],actor=x.sessions[1].user.id,steps=[];
 const record=phase=>{steps.push({phase,at:new Date().toISOString()});void fs.writeFile(path.join(r.root,'.tmp-b7-final-recovery/session-progress.json'),JSON.stringify({mode:args.mode,steps},null,2));};
 const req=async(route,{token=x.sessions[0].access_token,method='GET',body}={})=>{const response=await fetch(r.url+route,{redirect:'error',method,headers:{apikey:c.anon,Authorization:'Bearer '+token,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(8000)});let data;try{data=await response.json();}catch{}return {status:response.status,data};},ok=z=>{assert(z.status>=200&&z.status<300,`Session HTTP ${z.status} ${z.data?.code||''}`);return z.data;};
 const complete=async(id,detail)=>{s.events.push({id,status:'Passed',at:new Date().toISOString(),...detail,steps});await fs.writeFile(path.join(r.dir,'browser-results.json'),JSON.stringify(s,null,2));return s.events.at(-1);};
 const membersRoute=`/rest/v1/trip_members?trip_id=eq.${trip}&user_id=eq.${actor}`;
 if(args.mode==='revoke'){
  const before=ok(await req(membersRoute));assert.equal(before.length,1);assert.equal(before[0].status,'approved');assert.equal(before[0].role,'editor');let revoked=false;
  try{record('revoke-owner-request');const changed=ok(await req(membersRoute,{method:'PATCH',body:{status:'pending'}}));assert.equal(changed.length,1);revoked=true;record('revoked');
   const read=await req(`/rest/v1/budget_items?trip_id=eq.${trip}&select=id`,{token:x.sessions[1].access_token});assert(read.status===200&&read.data.length===0||read.status===403);record('independent-rls-denied');
   await b.reload({waitUntil:'domcontentloaded',timeout:10000});await b.getByRole('button',{name:s.sharedTitle,exact:true}).waitFor({state:'hidden',timeout:8000});assert.equal(await b.getByRole('button',{name:s.sharedTitle,exact:true}).count(),0);record('fresh-ui-has-no-revoked-budget');
  }finally{if(revoked){record('restore-owner-request');const restored=ok(await req(membersRoute,{method:'PATCH',body:{status:before[0].status}}));assert.equal(restored.length,1);assert.equal(restored[0].role,before[0].role);record('restored-before-resource-cleanup');}}
  await b.reload({waitUntil:'domcontentloaded',timeout:10000});await b.getByRole('button',{name:'新增預算',exact:true}).waitFor({timeout:10000});return complete('BROWSER-FINAL-MEMBERSHIP-REVOKE',{ordinaryOwnerJwt:true,independentUserRlsDenied:true,freshUiRemovedRevokedData:true,editorMembershipNormallyRestored:true,qaPlanningBaselineMembershipRefreshExpected:true});
 }
 if(args.mode==='revoke-late'){
  const before=ok(await req(membersRoute));assert.equal(before[0].status,'approved');let revoked=false,delivered=false,verified=false;
  const gate=await gateOneRealResponse({page:b,pattern:'**/rest/v1/rpc/read_budget_metadata_snapshot_v10',match:q=>q.postDataJSON()?.p_trip_id===trip,validate:async response=>{assert.equal(response.status(),200);assert((await response.json()).budgetItems.some(z=>z.title===s.sharedTitle));},record:phase=>{record(phase);if(phase==='actual-response-delivered')delivered=true;},holdMs:12000});
  try{
   const nav=b.reload({waitUntil:'commit',timeout:8000});await qaDeadline(gate.captured,{ms:8000,label:'capture before membership revocation'});await nav;
   const changed=ok(await req(membersRoute,{method:'PATCH',body:{status:'pending'}}));assert.equal(changed.length,1);revoked=true;record('membership-revoked-with-real-response-held');
   const denied=await req(`/rest/v1/budget_items?trip_id=eq.${trip}&select=id`,{token:x.sessions[1].access_token});assert(denied.status===200&&denied.data.length===0||denied.status===403);
   record('release-after-independent-rls-refusal');
   gate.release();await qaDeadline((async()=>{while(!gate.outcome.finished)await new Promise(z=>setTimeout(z,50));})(),{ms:4000,label:'deliver revoked-context Snapshot'});assert(delivered);
   await b.getByText('目前無法讀取此旅程預算。',{exact:true}).waitFor({timeout:6000});record('authoritative-budget-refusal-rendered');assert.equal(await b.getByRole('button',{name:s.sharedTitle,exact:true}).count(),0);
   verified=true;
  }catch(error){await fs.writeFile(path.join(r.root,'.tmp-b7-final-recovery/revoked-late-failure.json'),JSON.stringify({at:new Date().toISOString(),steps,text:await b.locator('body').innerText()},null,2));throw error;}finally{
   gate.release();await gate.dispose();
   if(revoked){const restored=ok(await req(membersRoute,{method:'PATCH',body:{status:before[0].status}}));assert.equal(restored[0].role,before[0].role);record('membership-normally-restored');}
   await b.reload({waitUntil:'domcontentloaded',timeout:10000});await b.getByRole('button',{name:'新增預算',exact:true}).waitFor({timeout:10000});
  }
  assert(verified);return complete('BROWSER-REVOCATION-DELIVERED-LATE-SNAPSHOT',{ordinaryOwnerJwt:true,independentRlsDenied:true,authoritativeRefusalRendered:true,actualPreRevocationResponseDelivered:true,revokedBudgetNotRepopulated:true,membershipRestoredBeforePass:true});
 }
 if(args.mode==='trip-late'||args.mode==='logout-late'){
  let delivered=false,verified=false;const gate=await gateOneRealResponse({page:b,pattern:'**/rest/v1/rpc/read_budget_metadata_snapshot_v10',match:q=>q.postDataJSON()?.p_trip_id===trip,validate:async response=>{assert.equal(response.status(),200);const data=await response.json();assert.equal(data.tripId,trip);assert(data.budgetItems.some(z=>z.title===s.sharedTitle));},record:phase=>{record(phase);if(phase==='actual-response-delivered')delivered=true;},holdMs:12000});
  try{
   // Commit does not wait for DOM/app loading or the Snapshot held by this gate.
   const navigation=b.reload({waitUntil:'commit',timeout:8000});await qaDeadline(gate.captured,{ms:8000,label:'capture old authenticated Snapshot'});await qaDeadline(navigation,{ms:1000,label:'navigation commit'});record('old-actual-snapshot-held');
   if(args.mode==='trip-late'){
    const other=b.getByRole('button',{name:/QA B7 preactivation/});await other.click({timeout:5000});await b.locator('.trip-header-title-row').filter({hasText:'QA B7 preactivation'}).waitFor({timeout:5000});record('other-trip-visible-before-release');
   }else{
    await b.getByRole('button',{name:'帳號選單',exact:true}).click({timeout:5000});await b.getByRole('menuitem',{name:'登出',exact:true}).click({timeout:5000});await b.getByRole('button',{name:/Google/}).waitFor({timeout:6000});record('signed-out-before-release');
   }
   gate.release();await qaDeadline((async()=>{while(!gate.outcome.finished)await new Promise(z=>setTimeout(z,50));})(),{ms:4000,label:'deliver old actual Snapshot'});assert(delivered,'A cancelled response is not the delivered-late-response acceptance case');
   assert.equal(await b.getByRole('button',{name:s.sharedTitle,exact:true}).count(),0,'Old Budget must not reappear in the new context');
   if(args.mode==='trip-late'){await b.locator('.trip-header-title-row').filter({hasText:'QA B7 preactivation'}).waitFor({timeout:2000});const ready=Date.now()+8000;while(Date.now()<ready&&!(await b.getByRole('button',{name:'更新匯率',exact:true}).isEnabled().catch(()=>false)))await new Promise(z=>setTimeout(z,100));assert(await b.getByRole('button',{name:'更新匯率',exact:true}).isEnabled(),'Destination finance operation must settle before navigation');record('destination-ui-ready-before-return');await b.getByRole('button',{name:/QA B7 Legacy cutover/}).click({timeout:4000});if(await b.getByRole('button',{name:'繼續編輯',exact:true}).count()){record('normal-active-editor-prompt');await b.getByRole('button',{name:'繼續編輯',exact:true}).click();throw Error('Destination still has a real pending operation; never force-discard it');}await b.getByRole('button',{name:s.sharedTitle,exact:true}).waitFor({timeout:10000});}
   else{await b.getByRole('button',{name:/Google/}).waitFor({timeout:2000});}
   verified=true;
  }finally{record('release-held-response-before-unroute');await gate.dispose();record('gate-disposed');}
  assert(verified);return complete(args.mode==='trip-late'?'BROWSER-TRIP-SWITCH-LATE-SNAPSHOT':'BROWSER-LOGOUT-LATE-SNAPSHOT',{realResponseCapturedAndDelivered:true,noFabricatedPayload:true,oldContextNotRepopulated:true,realUiAction:true});
 }
 throw Error('Unsupported final Session case');
}
