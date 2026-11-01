// Delays one real request before forwarding it unchanged to Staging. No fake
// response or database fixture stands in for the actual PT409 transaction.
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
export async function execute({credentials:c,runtime:r,args}){
 assert.equal(r.project,'uyqdopksfysbobhjcepk');const activation=JSON.parse(await fs.readFile(path.join(r.root,'.tmp-b7-cutover/activated.json'),'utf8'));assert(Object.values(activation.protocols).every(z=>z.enabled));assert(Date.now()-Date.parse(activation.observedAt)<15*60000);const x=r.cutover,s=r.browserProof,[a,b]=r.browserPages,id=x.incompleteFixtures.find(z=>z.kind==='budget').id,trip=x.trips[0];
 const save=()=>fs.writeFile(path.join(r.dir,'browser-results.json'),JSON.stringify(s,null,2));
 const rpc=async(actor,name,body)=>{const response=await fetch(r.url+'/rest/v1/rpc/'+name,{method:'POST',redirect:'error',headers:{apikey:c.anon,Authorization:'Bearer '+x.sessions[actor].access_token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});const data=await response.json();return {status:response.status,data};};
 const read=async actor=>{const v=await rpc(actor,'read_budget_metadata_snapshot_v10',{p_trip_id:trip,p_session_id:crypto.randomUUID()});assert.equal(v.status,200);return v.data;};
 const group=d=>d.metadataRecords.find(z=>z.kind==='budget'&&z.id===id).groups.find(z=>z.group==='title');
 const until=async fn=>{const end=Date.now()+10000;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(z=>setTimeout(z,100));}throw Error('Expected real UI/DB transition did not occur');};
 const editor=async p=>{if(!await p.getByRole('textbox',{name:'項目名稱',exact:true}).count()){if(!await p.locator('.bw-row.is-selected').count())await p.getByRole('button',{name:s.sharedTitle,exact:true}).click();await p.getByRole('tab',{name:'編輯項目',exact:true}).click();}const t=p.getByRole('textbox',{name:'項目名稱',exact:true});await t.waitFor();return t;};
 const close=async p=>{await p.getByRole('button',{name:'關閉編輯',exact:true}).click();await p.getByRole('textbox',{name:'項目名稱',exact:true}).waitFor({state:'hidden',timeout:10000});};
 if(args.mode==='locked'){
  const at=await editor(a),bt=await editor(b);await at.click();const lease=await until(async()=>{const g=group(await read(0));return g.held&&g.owner_id===x.sessions[0].user.id?g:null;});assert(Date.parse(lease.expires_at)>Date.now());await bt.click();await until(async()=>await bt.getAttribute('readonly')==='');
  const g=group(await read(1));assert.equal(g.owner_id,x.sessions[0].user.id);const denied=await rpc(1,'budget_metadata_group_lease_v2',{p_trip_id:trip,p_kind:'budget',p_id:id,p_group:'title',p_session_id:crypto.randomUUID(),p_token:crypto.randomUUID(),p_action:'acquire',p_base_revision:g.revision,p_epoch:null,p_activity_seq:1,p_dirty:true,p_versions:g.versions});assert.equal(denied.status,200);assert.equal(denied.data.granted,false);assert.equal(denied.data.reason,'group_locked');assert.equal(await b.getByRole('textbox',{name:'備註',exact:true}).inputValue(),s.sharedNote);
  await close(b);await close(a);s.events.push({id:'BROWSER-SAME-GROUP',status:'Passed',at:new Date().toISOString(),freshAOwnedLease:true,realPeerRpcGroupLocked:true,peerReadonly:true,peerNotePreserved:true,normalCloseBoth:true});await save();return s.events.at(-1);
 }
 if(args.mode==='pt409-recovery'){
  const at=await editor(a),bt=await editor(b),held=deferred(),release=deferred();let intercepted=false,forwarded=false,peerPatches=0;
  const observe=req=>{if(req.url().endsWith('/rpc/patch_budget_metadata_group_v2')){try{const j=req.postDataJSON();if(j.p_id===id&&j.p_group==='title')peerPatches++;}catch{}}};b.on('request',observe);
  const pattern='**/rest/v1/rpc/budget_metadata_group_lease_v2';
  const hold=async route=>{assert.equal(new URL(route.request().url()).hostname,r.project+'.supabase.co');const j=route.request().postDataJSON();if(!intercepted&&j.p_id===id&&j.p_group==='title'&&j.p_action==='acquire'){intercepted=true;held.resolve();const allow=await release.promise;if(allow){forwarded=true;await route.continue();}else await route.abort();}else await route.continue();};
  await b.route(pattern,hold);const draft='QA protected draft '+x.run.slice(0,8),canonical='QA confirmed '+x.run.slice(0,8);const started=Date.now();
  try{
   await bt.click();await Promise.race([held.promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('Real admission request not intercepted')),3000))]);await bt.fill(draft);
   await at.click();await at.fill(canonical);await at.blur();await until(async()=>{const d=await read(0);return d.budgetItems.find(z=>z.id===id).title===canonical;});assert(Date.now()-started<8000,'Do not turn this definite rejection test into an unknown-ACK timeout');
   const response=b.waitForResponse(resp=>resp.url().endsWith('/rpc/budget_metadata_group_lease_v2')&&resp.request().postDataJSON()?.p_group==='title',{timeout:10000});release.resolve(true);const rejected=await response,body=await rejected.json();assert.equal(rejected.status(),409);assert.equal(body.code,'PT409');
   await until(async()=>await bt.inputValue()===draft&&await b.getByText('版本衝突；本機草稿仍保留',{exact:true}).count()>0);assert.equal(peerPatches,0,'An unadmitted draft must never become a financial write');
   const field=b.locator('.bw-metadata-group').filter({has:bt});await field.getByRole('button',{name:'捨棄此欄草稿',exact:true}).click();await until(async()=>await bt.inputValue()===canonical);await close(b);await close(a);s.sharedTitle=canonical;
   for(const p of [a,b])await p.getByRole('button',{name:canonical,exact:true}).waitFor({timeout:10000});const actual=(await read(0)).budgetItems.find(z=>z.id===id);assert.equal(actual.title,canonical);assert.equal(actual.note,s.sharedNote);
   s.events.push({id:'P1-METADATA-ADMISSION-RECOVERY-RETEST',status:'Passed',at:new Date().toISOString(),realBackendPt409:true,oneDelayedUnmodifiedRequest:true,syntheticBackendResponse:false,userDraftPreservedUntilExplicitDiscard:true,peerPatchCount:peerPatches,discardAndCloseSucceeded:true,bothCanonicalListsUpdated:true,controllerFixActive:true});await save();return s.events.at(-1);
  }finally{if(!forwarded)release.resolve(false);await b.unroute(pattern,hold);b.off('request',observe);}
 }
 throw Error('Unsupported true recovery case');
}
