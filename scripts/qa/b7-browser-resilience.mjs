// Fault injection forwards real requests; it never fabricates a Supabase response.
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex');
export async function execute({credentials:c,runtime:r,args}){
 assert.equal(r.project,'uyqdopksfysbobhjcepk');const x=r.cutover,s=r.browserProof,[a,b]=r.browserPages,id=x.incompleteFixtures.find(z=>z.kind==='budget').id,trip=x.trips[0];
 const proof=JSON.parse(await fs.readFile(path.join(r.root,'.tmp-b7-cutover/activated.json'),'utf8'));assert(Object.values(proof.protocols).every(z=>z.enabled));assert(Date.now()-Date.parse(proof.observedAt)<15*60000);
 const read=async()=>{const z=await fetch(r.url+`/rest/v1/budget_items?id=eq.${id}&select=*`,{headers:{apikey:c.anon,Authorization:'Bearer '+x.sessions[0].access_token},redirect:'error',signal:AbortSignal.timeout(10000)});assert.equal(z.status,200);const rows=await z.json();assert.equal(rows.length,1);return rows[0];};
 const until=async fn=>{const end=Date.now()+12000;while(Date.now()<end){const z=await fn();if(z)return z;await new Promise(r=>setTimeout(r,100));}throw Error('Real resilience transition missing');};
 const save=()=>fs.writeFile(path.join(r.dir,'browser-results.json'),JSON.stringify(s,null,2));
 const edit=async p=>{if(!await p.getByRole('region',{name:'預算群組編輯',exact:true}).count()){const name=(await read()).title;if(!await p.locator('.bw-row.is-selected').count())await p.getByRole('button',{name,exact:true}).click();await p.getByRole('tab',{name:'編輯項目',exact:true}).click();}const t=p.getByRole('textbox',{name:'項目名稱',exact:true});await t.click();await until(async()=>await t.getAttribute('readonly')===null);return t;};
 const close=async p=>{await p.getByRole('button',{name:'關閉編輯',exact:true}).click();await p.getByRole('textbox',{name:'項目名稱',exact:true}).waitFor({state:'hidden',timeout:10000});};
 const record=async(id,detail)=>{s.events.push({id,status:'Passed',at:new Date().toISOString(),...detail});await save();return s.events.at(-1);};
 if(args.mode==='undo-five'){
  assert(!s.events.some(e=>e.id==='BROWSER-UNDO-FIVE'));const t=await edit(a),values=[];
  for(let i=1;i<=6;i++){const title=`QA Undo ${x.run.slice(0,8)} ${i}`;await t.fill(title);await until(async()=>(await read()).title===title);values.push(title);}
  await close(a);await a.getByRole('tab',{name:'旅程統計',exact:true}).click();
  for(let i=5;i>=1;i--){await a.keyboard.press('Control+z');await until(async()=>(await read()).title===values[i-1]);}
  let sixthRpc=0;const listener=req=>{if(req.url().endsWith('/rpc/undo_budget_workspace'))sixthRpc++;};a.on('request',listener);await a.keyboard.press('Control+z');await new Promise(z=>setTimeout(z,1500));a.off('request',listener);assert.equal((await read()).title,values[0]);assert.equal(sixthRpc,0,'An empty five-step stack must not issue a sixth mutation');s.sharedTitle=values[0];return record('BROWSER-UNDO-FIVE',{sixDistinctAutosaves:true,fiveSuccessfulUndo:true,sixthMutationAbsent:true,realCtrlZ:true});
 }
 if(args.mode==='native-undo'){
  const before=await read(),t=await edit(a);await t.press('End');await t.pressSequentially('X');await t.press('Control+z');assert.equal(await t.inputValue(),before.title);await new Promise(z=>setTimeout(z,1300));assert.equal((await read()).title,before.title);await close(a);return record('BROWSER-NATIVE-UNDO',{inputOwnedShortcut:true,noFinancialMutation:true});
 }
 if(args.mode==='unknown-ack'){
  assert(!x.unknownAckStarted,'Never blindly repeat an unknown financial request');x.unknownAckStarted=true;const t=await edit(a),title=`QA ACK ${x.run.slice(0,8)}`,requests=[];let dropped=false;
  const pattern='**/rest/v1/rpc/patch_budget_metadata_group_v2';const handler=async route=>{const body=route.request().postDataJSON();if(body.p_id!==id||body.p_group!=='title')return route.continue();requests.push(body.p_request_id);if(dropped)return route.continue();dropped=true;const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');};await a.route(pattern,handler);
  try{await t.fill(title);await until(async()=>(await read()).title===title);await a.getByRole('button',{name:'確認儲存結果',exact:true}).waitFor({timeout:12000});assert.equal(await t.inputValue(),title);await a.getByRole('button',{name:'確認儲存結果',exact:true}).click();await until(async()=>!(await a.getByRole('button',{name:'確認儲存結果',exact:true}).count()));assert(dropped);assert(requests.length>=2);assert(requests.every(v=>v===requests[0]),'Recovery must replay the original request ID');assert.equal((await read()).title,title);await close(a);s.sharedTitle=title;return await record('BROWSER-UNKNOWN-ACK-REPLAY',{actualCommitBeforeLostResponse:true,sameRequestId:true,requestHash:sha(requests[0]),draftPreserved:true,realHttp:true});}finally{await a.unroute(pattern,handler);}
 }
 if(args.mode==='undo-peer-conflict'){
  const at=await edit(a),own=`QA own ${x.run.slice(0,8)}`;await at.fill(own);await until(async()=>(await read()).title===own);await close(a);const bt=await edit(b),peer=`QA peer ${x.run.slice(0,8)}`;await bt.fill(peer);await until(async()=>(await read()).title===peer);await close(b);await a.getByRole('tab',{name:'旅程統計',exact:true}).click();await a.keyboard.press('Control+z');await until(async()=>(await a.locator('body').innerText()).includes('可在輸入框外按 Ctrl+Z'));assert.equal((await read()).title,peer);s.sharedTitle=peer;return record('BROWSER-UNDO-PEER-CONFLICT',{peerCanonicalPreserved:true,staleUndoRejected:true});
 }
 if(args.mode==='offline-reconnect'){
  await r.browserContexts[1].setOffline(true);const at=await edit(a),title=`QA reconnect ${x.run.slice(0,8)}`;await at.fill(title);await until(async()=>(await read()).title===title);await close(a);assert(!(await b.locator('body').innerText()).includes(title));await r.browserContexts[1].setOffline(false);await b.reload({waitUntil:'domcontentloaded'});await b.getByRole('button',{name:title,exact:true}).waitFor({timeout:15000});s.sharedTitle=title;return record('BROWSER-OFFLINE-RECONNECT',{realContextNetworkOffline:true,peerCanonicalRecovered:true,realSnapshotAndRealtime:true});
 }
 if(args.mode==='background-visibility'){
  const blank=await r.browserContexts[0].newPage();try{
   await a.bringToFront();await blank.bringToFront();let hidden=false;const probe=Date.now()+3000;while(Date.now()<probe){if(await a.evaluate(()=>document.visibilityState==='hidden')){hidden=true;break;}await new Promise(z=>setTimeout(z,100));}
   if(!hidden){s.events.push({id:'BROWSER-REAL-BACKGROUND-VISIBILITY',status:'Blocked',at:new Date().toISOString(),reason:'Native Chrome did not report a hidden page; no DOM visibility override or synthetic event used'});await save();return s.events.at(-1);}
   await a.bringToFront();await until(async()=>await a.evaluate(()=>document.visibilityState==='visible'));const before=await read(),at=await edit(a);await until(async()=>await at.getAttribute('readonly')===null);const draft=`QA background ${x.run.slice(0,8)}`;await at.fill(draft);await blank.bringToFront();await until(async()=>await a.evaluate(()=>document.visibilityState==='hidden'));
   if(!await b.getByRole('region',{name:'預算群組編輯',exact:true}).count()){if(!await b.locator('.bw-row.is-selected').count())await b.getByRole('button',{name:before.title,exact:true}).click();await b.getByRole('tab',{name:'編輯項目',exact:true}).click();}const note=b.getByRole('textbox',{name:'備註',exact:true});await note.click();await until(async()=>await note.getAttribute('readonly')===null);const peerNote=`QA background peer ${x.run.slice(0,8)}`;await note.fill(peerNote);await until(async()=>(await read()).note===peerNote);await close(b);await new Promise(z=>setTimeout(z,1300));assert.equal((await read()).title,before.title,'Hidden draft must not autosave before authority is reconciled');assert.equal(await at.inputValue(),draft,'Real hidden-page draft is retained');await a.bringToFront();await until(async()=>await a.evaluate(()=>document.visibilityState==='visible'));await until(async()=>(await read()).title===draft);await close(a);s.sharedTitle=draft;s.sharedNote=peerNote;return await record('BROWSER-REAL-BACKGROUND-VISIBILITY',{nativeDocumentHiddenAndVisible:true,noVisibilityOverride:true,draftPreservedWhileHidden:true,peerOtherGroupCommitted:true,reconciledThenAutosaved:true});
  }finally{await blank.close();await a.bringToFront();}
 }
 if(args.mode==='responsive'){
  for(const width of [820,390]){await a.setViewportSize({width,height:900});await a.getByRole('button',{name:'預算管理',exact:true}).waitFor({timeout:5000}).catch(()=>{});const dimensions=await a.evaluate(()=>({viewport:innerWidth,content:document.documentElement.scrollWidth}));assert(dimensions.content<=dimensions.viewport+1,'No horizontal viewport overflow');await a.screenshot({path:path.join(r.dir,`browser-width-${width}.png`),fullPage:false});}await a.setViewportSize({width:1440,height:1000});return record('BROWSER-RESPONSIVE',{widths:[820,390],noHorizontalOverflow:true,realChrome:true});
 }
 throw Error('Unsupported resilience case');
}
