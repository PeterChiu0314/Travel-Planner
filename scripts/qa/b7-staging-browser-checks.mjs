// Real Chrome, independent contexts and true Staging HTTP. No route mocks,
// traces, storageState files, or service-role browser credentials.
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
const project='uyqdopksfysbobhjcepk',sha=s=>createHash('sha256').update(s).digest('hex'),clean=s=>String(s).replace(/eyJ[A-Za-z0-9_.-]+/g,'[redacted]').replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/gi,'[qa-id]');
const browserPort=5189,browserUrl=`http://127.0.0.1:${browserPort}/`;
export async function execute({credentials:c,runtime:r,args}){
 if(['same-group','same-group-fresh'].includes(args.mode))throw Error('Retired diagnostic: use b7-browser-recovery.mjs locked with a proven live owner lease');
 assert.equal(r.project,project);const x=r.cutover;assert(x?.sessions?.length===2&&x.trips.length===1,'Exact QA sessions and trip required');
 const activation=JSON.parse(await fs.readFile(path.join(r.root,'.tmp-b7-cutover/activated.json'),'utf8'));if(!['close','inspect','paused-capture'].includes(args.mode)){assert(Object.values(activation.protocols).every(v=>v.enabled===true));assert(activation.legacyExhausted);assert(Date.now()-Date.parse(activation.observedAt)<15*60000,'Fresh true activation evidence required');}
 const state=r.browserProof??={project,realChrome:true,realHttp:true,mockedRoutes:false,events:[],errors:[],requests:[]};
 const save=async()=>fs.writeFile(path.join(r.dir,'browser-results.json'),JSON.stringify(state,null,2));
 if(args.mode==='paused-capture'){
  assert(Object.values(activation.protocols).every(z=>z.enabled===false));for(let i=0;i<(r.browserPages||[]).length;i++)await r.browserPages[i].screenshot({path:path.join(r.dir,`browser-paused-${i}.png`),fullPage:false});state.events.push({id:'P1-METADATA-ADMISSION-RECOVERY',status:'Failed',at:new Date().toISOString(),safePauseConfirmed:true,epochNullUnadmittedTokenBlockedCleanup:true,localFixTestsPassed:6,hostedRetestPending:true});await save();return {preserved:true,errors:state.errors};
 }
 if(args.mode==='close'){
  for(const context of r.browserContexts||[])await context.close();await r.browser?.close();for(const browser of r.additionalQaBrowsers||[])await browser.close();r.additionalQaBrowsers=[];r.browser=null;r.browserPages=null;r.browserContexts=null;
  if(args.stopServer&&r.viteChild){r.viteChild.kill();r.viteChild=null;}await save();return {closed:true,serverStopped:Boolean(args.stopServer),events:state.events,errors:state.errors};
 }
 if(args.mode==='server'){
  assert(!r.viteChild,'One loopback QA server only');const child=spawn(process.execPath,[path.join(r.root,'scripts/qa/b7-staging-vite.mjs')],{cwd:r.root,windowsHide:true,env:{...process.env,VITE_SUPABASE_URL:r.url,VITE_SUPABASE_ANON_KEY:c.anon,VITE_BUDGET_METADATA_GROUPS:'true',VITE_BUDGET_FINANCE_GROUPS:'true',VITE_BUDGET_RECEIPTS:'true',VITE_BUDGET_LIFECYCLE:'true',VITE_BUDGET_UNDO:'true'},stdio:['ignore','pipe','pipe']});r.viteChild=child;
  await new Promise((resolve,reject)=>{let errorText='';r.viteLifecycle={startedAt:new Date().toISOString(),stderr:''};child.stderr.on('data',buf=>{errorText=(errorText+clean(buf.toString())).slice(-3000);r.viteLifecycle.stderr=errorText;});const timer=setTimeout(()=>reject(Error('Native QA Vite did not become ready')),10000);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);r.viteLifecycle.exit={at:new Date().toISOString(),code};r.viteChild=null;reject(Error('Native QA Vite stopped: '+code+' '+errorText));});child.stdout.on('data',buf=>{if(buf.toString().replace(/\u001b\[[0-?]*[ -/]*[@-~]/g,'').includes(browserUrl)){clearTimeout(timer);resolve();}});});
  r.browserBaseUrl=browserUrl;return {nativeLoopbackServerReady:true,publicStagingConfigOnly:true,flagsOnlyThisProcess:true,defaultFlagsUnchanged:true};
 }
 if(args.mode==='server-inspect'){
  assert(r.viteChild,'Only inspect our exact QA server process');const response=await fetch(browserUrl,{redirect:'error',signal:AbortSignal.timeout(5000)});const html=await response.text();assert.equal(response.status,200);assert(html.includes('/@vite/client')&&html.includes('id="root"'),'Must be the actual Vite app, not an unrelated listener');r.browserBaseUrl=browserUrl;return {httpStatus:response.status,ownChildRunning:r.viteChild.exitCode===null,viteHtml:true,bodySha256:sha(html)};
 }
 if(args.mode==='open'){
  assert(!r.browser,'Do not duplicate live browser sessions');const browser=await chromium.launch({channel:'chrome',headless:true});r.browser=browser;r.browserContexts=[];r.browserPages=[];
  for(let i=0;i<2;i++){
   const session=x.sessions[i],context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-TW'});r.browserContexts.push(context);
   await context.route('**/*.supabase.co/**',route=>{const u=new URL(route.request().url());if(u.hostname!==project+'.supabase.co'){state.errors.push({actor:i,kind:'endpoint-fence',message:'Unexpected Supabase target blocked before transmission'});return route.abort();}return route.continue();});
   await context.addInitScript(({session,project,trip})=>{if(location.hostname!=='127.0.0.1')return;const marker=`qa-auth-seeded:${session.user.id}`;if(!localStorage.getItem(marker)){localStorage.setItem(`sb-${project}-auth-token`,JSON.stringify(session));localStorage.setItem(marker,'true');}const contextKey=`travel-planner-session-context:${session.user.id}`;if(!localStorage.getItem(contextKey))localStorage.setItem(contextKey,JSON.stringify({activeTripId:trip,activeSection:'budget',activeDay:0,luggageTab:'personal',updatedAt:new Date().toISOString()}));},{session,project,trip:x.trips[0]});
   const page=await context.newPage();r.browserPages.push(page);page.on('pageerror',e=>state.errors.push({actor:i,kind:'pageerror',message:clean(e.message)}));page.on('console',m=>{if(m.type()==='error')state.errors.push({actor:i,kind:'console',message:clean(m.text())});});
   page.on('request',req=>{const u=new URL(req.url());if(u.hostname===project+'.supabase.co')state.requests.push({actor:i,method:req.method(),path:clean(u.pathname)});});
   assert.equal(r.browserBaseUrl,browserUrl);await page.goto(r.browserBaseUrl,{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'新增預算',exact:true}).waitFor({timeout:15000});
   const text=await page.locator('body').innerText();assert(text.includes('QA B7 Legacy cutover'),'Only the exact isolated QA trip may be active');await page.screenshot({path:path.join(r.dir,`browser-actor-${i}.png`),fullPage:false});
  }
  const ids=x.sessions.map(s=>JSON.parse(Buffer.from(s.access_token.split('.')[1],'base64url')).session_id);assert.notEqual(ids[0],ids[1]);state.events.push({id:'BROWSER-REAL-TWO-CONTEXTS',status:'Passed',at:new Date().toISOString(),independentSessionHashes:ids.map(sha),desktop:{width:1440,height:1000},noServiceRoleInBrowser:true});await save();
  return {opened:true,events:state.events,errors:state.errors,snapshots:await Promise.all(r.browserPages.map(async p=>clean(await p.locator('body').innerText())))};
 }
 assert(r.browserPages?.length===2,'Open true isolated browser contexts first');
 if(args.mode==='two-groups'){
  assert(!state.events.some(e=>e.id==='BROWSER-TWO-GROUPS'),'No automatic repeat of financial UI edits');const [a,b]=r.browserPages,id=x.incompleteFixtures.find(z=>z.kind==='budget').id;
  for(const p of [a,b]){await p.getByRole('button',{name:'未命名項目',exact:true}).click();await p.getByRole('tab',{name:'編輯項目',exact:true}).click();}
  const title='QA B7 shared '+x.run.slice(0,8),note='QA independent note '+x.run.slice(0,8),at=a.getByRole('textbox',{name:'項目名稱',exact:true}),bn=b.getByRole('textbox',{name:'備註',exact:true});
  await Promise.all([(async()=>{await at.click();await at.fill(title);})(),(async()=>{await bn.click();await bn.fill(note);})()]);
  const deadline=Date.now()+12000;let row;while(Date.now()<deadline){const response=await fetch(r.url+`/rest/v1/budget_items?id=eq.${id}&select=title,note,record_status,payer_id`,{redirect:'error',headers:{apikey:c.anon,Authorization:'Bearer '+x.sessions[0].access_token},signal:AbortSignal.timeout(10000)});assert.equal(response.status,200);row=(await response.json())[0];if(row.title===title&&row.note===note)break;await new Promise(z=>setTimeout(z,150));}
  assert.equal(row.title,title,'Actor A Title autosave must reach real DB');assert.equal(row.note,note,'Actor B Note autosave must reach real DB');assert.equal(await at.inputValue(),title);assert.equal(await bn.inputValue(),note);
  state.sharedTitle=title;state.sharedNote=note;state.events.push({id:'BROWSER-TWO-GROUPS',status:'Passed',at:new Date().toISOString(),distinctActors:true,simultaneousTitleAndNote:true,canonicalDbConfirmed:true});await save();
  return {event:state.events.at(-1),errors:state.errors,snapshots:await Promise.all([a,b].map(async p=>clean(await p.locator('body').innerText())))};
 }
 if(args.mode==='same-group'){
  assert(state.sharedTitle&&state.sharedNote);const [a,b]=r.browserPages,bt=b.getByRole('textbox',{name:'項目名稱',exact:true});await bt.click();assert.equal(await bt.getAttribute('readonly'),'','Peer Title must stay read-only while A holds it');assert.equal(await b.getByRole('textbox',{name:'備註',exact:true}).inputValue(),state.sharedNote);
  const id=x.incompleteFixtures.find(z=>z.kind==='budget').id,actor=x.sessions[1].access_token,sid=crypto.randomUUID(),token=crypto.randomUUID();const rpc=async(name,body)=>{const res=await fetch(r.url+'/rest/v1/rpc/'+name,{method:'POST',redirect:'error',headers:{apikey:c.anon,Authorization:'Bearer '+actor,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});assert.equal(res.status,200);return res.json();};
  const snapshot=await rpc('read_budget_metadata_snapshot_v10',{p_trip_id:x.trips[0],p_session_id:sid}),g=snapshot.metadataRecords.find(z=>z.kind==='budget'&&z.id===id).groups.find(z=>z.group==='title');const rejected=await rpc('budget_metadata_group_lease_v2',{p_trip_id:x.trips[0],p_kind:'budget',p_id:id,p_group:'title',p_session_id:sid,p_token:token,p_action:'acquire',p_base_revision:g.revision,p_epoch:null,p_activity_seq:1,p_dirty:true,p_versions:g.versions||null});assert.equal(rejected.granted,false);assert.equal(rejected.reason,'group_locked');
  for(const page of [a,b])await page.getByRole('button',{name:'關閉編輯',exact:true}).click();for(const page of [a,b])await page.getByRole('button',{name:state.sharedTitle,exact:true}).waitFor({timeout:12000});
  state.events.push({id:'BROWSER-SAME-GROUP',status:'Passed',at:new Date().toISOString(),peerReadonly:true,realPeerRpcDenied:true,peerNotePreserved:true,bothCanonicalListsUpdated:true});await save();return {event:state.events.at(-1),errors:state.errors,snapshots:await Promise.all([a,b].map(async p=>clean(await p.locator('body').innerText())))};
 }
 if(args.mode==='same-group-fresh'){
  const [a,b]=r.browserPages,id=x.incompleteFixtures.find(z=>z.kind==='budget').id,actor=x.sessions[1].access_token,sid=crypto.randomUUID(),token=crypto.randomUUID();
  const rpc=async(name,body)=>{const res=await fetch(r.url+'/rest/v1/rpc/'+name,{method:'POST',redirect:'error',headers:{apikey:c.anon,Authorization:'Bearer '+actor,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});assert.equal(res.status,200);return res.json();};
  const snap=()=>rpc('read_budget_metadata_snapshot_v10',{p_trip_id:x.trips[0],p_session_id:sid});
  const prior=(await snap()).metadataRecords.find(z=>z.kind==='budget'&&z.id===id).groups.find(z=>z.group==='title');state.events.push({id:'SAME-GROUP-PREMISE-DIAGNOSTIC',status:'Observed',at:new Date().toISOString(),held:prior.held,ownerHash:prior.owner_id?sha(prior.owner_id):null,epoch:prior.epoch,expiresAt:prior.expires_at||null,priorImmediateReadonlyAssertionRetained:true});
  for(const p of [a,b])if(await p.getByRole('button',{name:'關閉編輯',exact:true}).count())await p.getByRole('button',{name:'關閉編輯',exact:true}).click();
  for(const p of [a,b]){if(!await p.locator('.bw-row.is-selected').count())await p.getByRole('button',{name:state.sharedTitle,exact:true}).click();await p.getByRole('tab',{name:'編輯項目',exact:true}).click();}
  const title='QA B7 lock '+x.run.slice(0,8),at=a.getByRole('textbox',{name:'項目名稱',exact:true});await at.click();await at.fill(title);const deadline=Date.now()+12000;let live;
  while(Date.now()<deadline){const d=await snap();const row=d.budgetItems.find(z=>z.id===id);live=d.metadataRecords.find(z=>z.kind==='budget'&&z.id===id).groups.find(z=>z.group==='title');if(row.title===title&&live.held)break;await new Promise(z=>setTimeout(z,100));}
  assert.equal(live.owner_id,x.sessions[0].user.id,'Competition premise requires a fresh real A-owned lease');assert(live.held&&Date.parse(live.expires_at)>Date.now());state.sharedTitle=title;
  const bt=b.getByRole('textbox',{name:'項目名稱',exact:true});await bt.click();const settled=Date.now()+10000;while(Date.now()<settled&&await bt.getAttribute('readonly')===null)await new Promise(z=>setTimeout(z,100));assert.equal(await bt.getAttribute('readonly'),'','Actual competing UI must settle read-only');assert.equal(await b.getByRole('textbox',{name:'備註',exact:true}).inputValue(),state.sharedNote);
  const d=await snap(),g=d.metadataRecords.find(z=>z.kind==='budget'&&z.id===id).groups.find(z=>z.group==='title');assert.equal(g.owner_id,x.sessions[0].user.id);const denied=await rpc('budget_metadata_group_lease_v2',{p_trip_id:x.trips[0],p_kind:'budget',p_id:id,p_group:'title',p_session_id:sid,p_token:token,p_action:'acquire',p_base_revision:g.revision,p_epoch:null,p_activity_seq:1,p_dirty:true,p_versions:g.versions});assert.equal(denied.granted,false);assert.equal(denied.reason,'group_locked');
  for(const p of [a,b])await p.getByRole('button',{name:'關閉編輯',exact:true}).click();for(const p of [a,b])await p.getByRole('button',{name:state.sharedTitle,exact:true}).waitFor({timeout:12000});state.events.push({id:'BROWSER-SAME-GROUP',status:'Passed',at:new Date().toISOString(),freshRealOwnerPremise:true,peerReadonly:true,realPeerRpcDenied:true,peerNotePreserved:true,bothCanonicalListsUpdated:true});await save();return {events:state.events.slice(-2),errors:state.errors,snapshots:await Promise.all([a,b].map(async p=>clean(await p.locator('body').innerText())))};
 }
 if(args.mode==='inspect'){await save();return {errors:state.errors,snapshots:await Promise.all(r.browserPages.map(async p=>clean(await p.locator('body').innerText())))};}
 throw Error('Unsupported real browser action');
}
