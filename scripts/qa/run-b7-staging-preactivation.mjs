// Explicit Staging-only preactivation acceptance. Never activates protocols,
// changes schema/grants, signs JWTs or starts receipt maintenance.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {isPostgresChangesReady} from '../../src/lib/realtimePostgresReadiness.js';

const project='uyqdopksfysbobhjcepk',work='.tmp-b7-preactivation';
if(!process.argv.includes('--authorized-disposable-fixtures'))throw Error('Explicit Staging fixture authorization required');
const env=Object.fromEntries((await fs.readFile('.env.staging.local','utf8')).split(/\r?\n/).map(s=>s.match(/^\s*([A-Z_0-9]+)\s*=\s*["']?(.*?)["']?\s*$/)).filter(Boolean).map(m=>[m[1],m[2]]));
const url=env.VITE_SUPABASE_URL,anon=env.VITE_SUPABASE_ANON_KEY,admin=process.env.STAGING_FIXTURE_ADMIN_KEY;
const claims=t=>JSON.parse(Buffer.from(t.split('.')[1],'base64url').toString());
const hash=v=>createHash('sha256').update(v).digest('hex');
assert.equal(url,`https://${project}.supabase.co`);assert.equal(claims(admin).ref,project);assert.equal(claims(admin).role,'service_role');
if(anon.startsWith('eyJ')){assert.equal(claims(anon).ref,project);assert.equal(claims(anon).role,'anon');}else assert.match(anon,/^sb_publishable_[A-Za-z0-9_-]+$/);
const before=JSON.parse(await fs.readFile(`${work}/before.json`,'utf8'));
assert.equal(before.ledger.count,62);assert(Object.values(before.protocols).every(p=>!p.enabled&&!p.activated&&!p.full_enabled));
const followup=process.argv.includes('--affected-followup');
const selected=new Set(['H01-01','H01-03','H01-04','H01-05','H01-13','H02-06','H02-09']);
const run=randomUUID(),trip=randomUUID(),users=[],clients=[],channels=[],events=[],results=[],requests=[],cleanup=[];
const state={run,project,trip,users:[],createdTrip:false,objects:[],budget:null,cleanup};
const evidence={project,run,followup,startedAt:new Date().toISOString(),realAuth:true,realHttp:true,realRealtime:true,acceptanceUsesServiceRole:false,adminForFixtureOnly:true,results,requests,events,cleanup};
await fs.mkdir(work,{recursive:true});
const save=async()=>{await fs.writeFile(`${work}/fixture-state.json`,JSON.stringify(state,null,2));await fs.writeFile(`${work}/http-results.json`,JSON.stringify(evidence,null,2));};
const safe=s=>String(s).replace(/eyJ[A-Za-z0-9_.-]+/g,'[token]').replace(/https?:\/\/[^\s]+/g,'[url]');
const http=async(token,route,method='GET',body,{fixture=false,raw=false,contentType='application/json'}={})=>{
 assert(route.startsWith('/')&&!route.startsWith('//'));
 if(fixture){assert.equal(token,admin);assert(/^\/(auth\/v1\/admin\/users|rest\/v1\/(trips|trip_members|budget_collaboration_signals))($|[/?])/.test(route));}
 else assert.notEqual(token,admin,'Admin cannot perform acceptance operations');
 if(route.startsWith('/rest/v1/rpc/')&&method==='POST'&&!/^\/rest\/v1\/rpc\/claim_budget_receipt_(verification|worker)$/.test(route))assert.equal(body.p_trip_id,trip,'Only this invocation QA trip is a mutation target');
 const t=performance.now();
 const r=await fetch(url+route,{method,headers:{apikey:fixture?admin:anon,...(token?{Authorization:`Bearer ${token}`} :{}),'Content-Type':contentType,...(route.startsWith('/rest/')?{Prefer:'return=representation'}:{})},body:body===undefined?undefined:raw?body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
 const text=raw&&method==='GET'?null:await r.text();let data;
 if(text!==null){try{data=text?JSON.parse(text):null;}catch{data={message:'Non-JSON response'};}}
 const bytes=text===null?Buffer.from(await r.arrayBuffer()):null;
 if(!fixture)requests.push({method,route:route.split('?')[0].replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,':uuid'),status:r.status,code:data?.code??data?.error_code??null,ms:Math.round(performance.now()-t)});
 return {status:r.status,data,bytes};
};
const good=r=>{assert(r.status>=200&&r.status<300,`HTTP ${r.status}: ${r.data?.code||r.data?.error||''} ${safe(r.data?.message||r.data?.msg||'')}`);return r.data;};
const denied=r=>assert(r.status>=400,`Expected rejection, got ${r.status}`);
const rpc=(token,name,args)=>http(token,`/rest/v1/rpc/${name}`,'POST',args);
const test=async(id,name,fn)=>{if(followup&&!selected.has(id))return;try{const details=await fn();results.push({id,name,status:'Passed',...(details?{details}:{})});console.log(`PASS ${id} ${name}`);}catch(e){results.push({id,name,status:'Failed',error:safe(e.message)});console.log(`FAIL ${id} ${safe(e.message)}`);}await save();};
const waitUntil=async(fn,ms=10000)=>{const deadline=Date.now()+ms;while(Date.now()<deadline){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('Expected Realtime event absent within bounded 10s');};
let a,b,canonical,originalArgs,fatal;
const snapshot=token=>rpc(token,'read_budget_snapshot',{p_trip_id:trip});
const payload=title=>({title,category:'其他',amount:120,currency:'TWD',payer_id:users[0].id,pricing_mode:'split_total',split_type:'equal',participantIds:[users[0].id],payment_action:'keep',payment_expected:[],unified_planning:true});
const args=(id,base,p,request=randomUUID())=>({p_trip_id:trip,p_kind:'budget',p_id:id,p_base_updated_at:base,p_payload:p,p_request_id:request});
const root=`trips/${trip}/attachments/qa-preactivation/${run}`;
// A small structurally valid PNG; no personal file or financial receipt metadata.
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lMsAAAAASUVORK5CYII=','base64');
const path=`${root}/pixel.png`,storagePath=p=>`/storage/v1/object/trip-attachments/${p}`;
const upload=(token,p,bytes=png,type='image/png')=>http(token,storagePath(p),'POST',bytes,{raw:true,contentType:type});
const download=(token,p)=>http(token,`/storage/v1/object/authenticated/trip-attachments/${p}`,'GET',undefined,{raw:true});
const freshDownload=(token,p)=>http(token,`/storage/v1/object/authenticated/trip-attachments/${p}?qa_cache_bust=${randomUUID()}`,'GET',undefined,{raw:true});
const remove=(token,p)=>http(token,'/storage/v1/object/trip-attachments','DELETE',{prefixes:[p]});
const removed=r=>{good(r);assert(Array.isArray(r.data)&&r.data.some(x=>x.name===path||x.name===`trip-attachments/${path}`),'Delete must return the exact QA object');};
try{
 for(const label of ['A','B']){
  const password=randomBytes(28).toString('base64url')+'Aa1!',email=`qa-b7-pre-${run}-${label.toLowerCase()}@example.invalid`;
  const r=good(await http(admin,'/auth/v1/admin/users','POST',{email,password,email_confirm:true,user_metadata:{qa_run:run}},{fixture:true})),u=r.user||r;
  assert(u.id);users.push({id:u.id,password,email,label});state.users.push(u.id);await save();
 }
 const login=async u=>good(await http(null,'/auth/v1/token?grant_type=password','POST',{email:u.email,password:u.password}));
 const sa=await login(users[0]),sb=await login(users[1]);a=sa.access_token;b=sb.access_token;
 await test('H01-01','Two real Auth accounts and distinct sessions',async()=>{
  assert.notEqual(claims(a).sub,claims(b).sub);assert.notEqual(claims(a).session_id,claims(b).session_id);
  for(const [t,u] of [[a,users[0]],[b,users[1]]]){assert.equal(claims(t).role,'authenticated');assert.equal(good(await http(t,'/auth/v1/user')).id,u.id);}
  evidence.identities=users.map((u,i)=>({label:u.label,userHash:hash(u.id),sessionHash:hash(claims(i?b:a).session_id)}));
 });
 good(await http(admin,'/rest/v1/trips','POST',{id:trip,title:`QA B7 preactivation ${run}`,name:`QA B7 preactivation ${run}`,destination:'Isolated QA',start_date:'2099-01-01',end_date:'2099-01-03',owner_id:users[0].id},{fixture:true}));state.createdTrip=true;await save();
 good(await http(admin,'/rest/v1/trip_members','POST',{trip_id:trip,user_id:users[0].id,role:'owner',status:'approved',display_name:'B7 QA A'},{fixture:true}));
 await test('H01-02','Member sees QA trip; nonmember cannot read or mutate it',async()=>{
  assert.equal(good(await http(a,`/rest/v1/trips?id=eq.${trip}&select=id`)).length,1);
  assert.deepEqual(good(await http(b,`/rest/v1/trips?id=eq.${trip}&select=id`)),[]);
  // This invoker SQL reader intentionally returns null when no trip is visible.
  assert.equal(good(await snapshot(b)),null);denied(await rpc(b,'save_budget_workspace_record_v3',args(null,null,payload('Forbidden'))));
 });
 await test('H02-01','Live private bucket MIME and size configuration',async()=>{
  assert.equal(before.bucket.id,'trip-attachments');assert.equal(before.bucket.public,false);assert.equal(before.bucket.file_size_limit,10485760);
  for(const t of ['image/png','image/jpeg','image/webp','application/pdf'])assert(before.bucket.allowed_mime_types.includes(t));
  assert(before.storagePolicies.some(p=>p.policyname==='Receipt upload boundary'&&p.permissive==='RESTRICTIVE'));
  return {source:'fresh Managed database read-only catalog; not an HTTP mutation proof'};
 });
 await test('H02-02','Ordinary member uploads QA PNG via real Storage HTTP',async()=>{good(await upload(a,path));state.objects.push(path);await save();});
 await test('H02-03','Authenticated download bytes equal uploaded PNG',async()=>{const r=await download(a,path);good(r);assert.equal(hash(r.bytes),hash(png));return {sha256:hash(png),bytes:png.length};});
 await test('H02-04','Nonmember and anonymous cannot read/sign/delete QA bytes',async()=>{
  denied(await download(b,path));denied(await download(null,path));
  denied(await http(b,`/storage/v1/object/sign/trip-attachments/${path}`,'POST',{expiresIn:30}));
  const r=await remove(b,path);assert(r.status>=400||Array.isArray(r.data)&&r.data.length===0);
  assert.equal(hash((await download(a,path)).bytes),hash(png));
  denied(await http(null,`/storage/v1/object/public/trip-attachments/${path}`,'GET'));
 });
 await test('H02-05','Wrong path, anonymous and nonmember uploads rejected',async()=>{
  for(const [t,p] of [[a,`invalid/${run}/pixel.png`],[null,`${root}/anonymous.png`],[b,`${root}/nonmember.png`]])denied(await upload(t,p));
 });
 await test('H02-06','Bucket rejects disallowed MIME and over-limit upload',async()=>{
  denied(await upload(a,`${root}/text.txt`,Buffer.from('QA'),'text/plain'));
  // HTTP Expect/Continue allows the real Storage limit to reject headers before
  // consuming 10MiB on slow uplinks; never extend the bounded transport timeout.
  const {request}=await import('node:https');
  const outcome=await new Promise((resolve,reject)=>{
   const req=request(new URL(storagePath(`${root}/oversize.png`),url),{method:'POST',headers:{apikey:anon,Authorization:`Bearer ${a}`,'Content-Type':'image/png','Content-Length':'10485761',Expect:'100-continue'}},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode,body}));});
   req.setTimeout(12000,()=>req.destroy(Error('Over-limit HTTP header response timeout')));req.on('error',reject);
   req.on('continue',()=>req.end(Buffer.alloc(10485761)));req.flushHeaders();
  });
  assert.equal(outcome.status,413,'Storage must reject over-limit content length');
  requests.push({method:'POST',route:'/storage/v1/object/trip-attachments/:qa-oversize',status:outcome.status,code:'over-limit'});
  return {overLimitBytes:10485761,expectContinue:true};
 });
 await test('H02-07','Signed URL reads actual private bytes',async()=>{
  const r=good(await http(a,`/storage/v1/object/sign/trip-attachments/${path}`,'POST',{expiresIn:30}));const signed=r.signedURL||r.signedUrl;assert(signed);
  const target=new URL(signed.startsWith('/object/')?'/storage/v1'+signed:signed,url);assert.equal(target.origin,url);
  const response=await fetch(target,{signal:AbortSignal.timeout(12000)});assert.equal(response.status,200);assert.equal(hash(Buffer.from(await response.arrayBuffer())),hash(png));
  // The URL remains solely in memory; expiry/revocation is not claimed here.
  return {ttlSeconds:30,actualBytesMatched:true,expiryNotTested:true};
 });
 await test('H02-08','Receipt namespace fails closed while receipt protocol OFF',async()=>{
  const protectedPath=`trips/${trip}/attachments/actual_expense/${randomUUID()}/receipts/${run}/pixel.png`;
  denied(await upload(a,protectedPath));
 });
 // Realtime uses independent Supabase client instances with ordinary user JWTs.
 good(await http(admin,'/rest/v1/trip_members','POST',{trip_id:trip,user_id:users[1].id,role:'editor',status:'approved',display_name:'B7 QA B'},{fixture:true}));
 const subscribe=async(token,label)=>{
  const client=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:`Bearer ${token}`}}});clients.push(client);await client.realtime.setAuth(token);
  let postgresReady=false;
  const seen=[];const channel=client.channel(`qa-b7-${run}-${label}`).on('system',{},payload=>{if(isPostgresChangesReady(payload)){postgresReady=true;events.push({client:label,type:'POSTGRES_READY',at:new Date().toISOString()});}}).on('postgres_changes',{event:'*',schema:'public',table:'budget_items',filter:`trip_id=eq.${trip}`},event=>{seen.push(event);events.push({client:label,type:event.eventType,recordHash:hash(event.new?.id||event.old?.id||''),at:new Date().toISOString()});});channels.push(channel);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Realtime SUBSCRIBED absent within bounded 10s')),10000);channel.subscribe(status=>{events.push({client:label,type:status,at:new Date().toISOString()});if(status==='SUBSCRIBED'){clearTimeout(timer);resolve();}else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){clearTimeout(timer);reject(Error(`Realtime ${status}`));}});});
  await waitUntil(()=>postgresReady);
  return {client,channel,seen};
 };
 let ra,rb;
 await test('H01-03','Two independent JWT Realtime subscriptions become SUBSCRIBED',async()=>{ra=await subscribe(a,'A');rb=await subscribe(b,'B');});
 await test('H01-04','Legacy Budget save remains available with protocols OFF',async()=>{
  originalArgs=args(null,null,payload('Legacy baseline'));
  const r=good(await rpc(a,'save_budget_workspace_record_v3',originalArgs));assert(r.id);state.budget=r.id;await save();
  const graph=good(await snapshot(b));canonical=graph.budgetItems.find(x=>x.id===r.id);assert(canonical);assert.equal(canonical.amount,120);assert.equal(graph.budgetParticipants.length,1);
 });
 assert(canonical,'Legacy fixture required for remaining mutation tests');
 await test('H01-05','Both Realtime clients receive the actual Budget INSERT',async()=>{assert(ra&&rb);await waitUntil(()=>ra.seen.some(e=>e.eventType==='INSERT'&&e.new.id===canonical.id)&&rb.seen.some(e=>e.eventType==='INSERT'&&e.new.id===canonical.id));});
 await test('H01-06','Successful original Request Replay does not duplicate rows',async()=>{const graph=good(await snapshot(a));assert.equal(good(await rpc(a,'save_budget_workspace_record_v3',originalArgs)).id,canonical.id);assert.deepEqual(good(await snapshot(b)),graph);});
 let changed;
 await test('H01-07','Second ordinary account updates legacy Budget and produces UPDATE',async()=>{
  good(await rpc(b,'save_budget_workspace_record_v3',args(canonical.id,canonical.updated_at,payload('B update'))));changed=good(await snapshot(a)).budgetItems.find(x=>x.id===canonical.id);assert.equal(changed.title,'B update');
  if(ra&&rb)await waitUntil(()=>ra.seen.some(e=>e.eventType==='UPDATE'&&e.new.title==='B update')&&rb.seen.some(e=>e.eventType==='UPDATE'&&e.new.title==='B update'));
 });
 await test('H01-08','Deterministic stale save is bounded HTTP409/PT409, no mutation',async()=>{
  const graph=good(await snapshot(a));const r=await rpc(a,'save_budget_workspace_record_v3',args(canonical.id,canonical.updated_at,payload('Must reject')));assert.equal(r.status,409);assert.equal(r.data.code,'PT409');assert.deepEqual(good(await snapshot(a)),graph);
 });
 await test('H01-09','Anonymous and invalid JWT denied protected RPC',async()=>{denied(await snapshot(null));denied(await snapshot('invalid-session'));});
 await test('H01-10','Metadata OFF refuses group acquisition without draft overwrite',async()=>{
  const graph=good(await snapshot(a));const r=await rpc(a,'budget_metadata_group_lease',{p_trip_id:trip,p_kind:'budget',p_id:canonical.id,p_group:'title',p_session_id:randomUUID(),p_token:randomUUID(),p_action:'acquire',p_base_revision:0,p_epoch:null,p_activity_seq:0,p_dirty:true});
  if(r.status>=400){assert.equal(r.data.code,'55000');}else{assert.equal(r.data.granted,false);assert.match(r.data.reason,/disabled|unavailable/);}assert.deepEqual(good(await snapshot(a)),graph);return {http:r.status,code:r.data?.code??null,reason:r.data?.reason??null};
 });
 await test('H01-11','B-7 placeholder creation OFF rejects and preserves graph',async()=>{
  const graph=good(await snapshot(a));const r=await rpc(a,'create_budget_workspace_placeholder',{p_trip_id:trip,p_kind:'budget',p_session_id:randomUUID(),p_request_id:randomUUID()});denied(r);assert.equal(r.data.code,'55000');assert.deepEqual(good(await snapshot(a)),graph);
 });
 await test('H01-12','Snapshot v10 is callable but reports dormant capabilities',async()=>{const r=good(await rpc(a,'read_budget_metadata_snapshot_v10',{p_trip_id:trip,p_session_id:randomUUID()}));assert(r);assert.equal(r.metadataProtocol.enabled,false);return {metadataProtocolEnabled:r.metadataProtocol.enabled};});
 await test('H01-13','Realtime disconnect/reconnect receives later committed update',async()=>{
  assert(rb);await rb.client.realtime.disconnect();events.push({client:'B',type:'INTENTIONAL_DISCONNECT',at:new Date().toISOString()});
  // Explicit disconnect is intentional teardown; rebuild the subscription as
  // the application's reconnection lifecycle does. A stale channel.state is
  // not acknowledgement of a newly joined WebSocket subscription.
  await rb.client.removeChannel(rb.channel);rb=await subscribe(b,'B-reconnected');
  events.push({client:'B-reconnected',type:'RECONNECTED',at:new Date().toISOString()});
  const row=good(await snapshot(a)).budgetItems.find(x=>x.id===canonical.id);good(await rpc(a,'save_budget_workspace_record_v3',args(row.id,row.updated_at,payload('After reconnect'))));
  await waitUntil(()=>rb.seen.some(e=>e.eventType==='UPDATE'&&e.new.title==='After reconnect'));assert.equal(good(await snapshot(b)).budgetItems[0].title,'After reconnect');
 });
 await test('H01-14','Realtime unsubscribe stops delivery while authoritative read remains usable',async()=>{
  assert(rb);await rb.client.removeChannel(rb.channel);const count=rb.seen.length;
  const row=good(await snapshot(a)).budgetItems.find(x=>x.id===canonical.id);good(await rpc(a,'save_budget_workspace_record_v3',args(row.id,row.updated_at,payload('After unsubscribe'))));
  if(ra)await waitUntil(()=>ra.seen.some(e=>e.eventType==='UPDATE'&&e.new.title==='After unsubscribe'));
  await new Promise(r=>setTimeout(r,600));assert.equal(rb.seen.length,count);assert.equal(good(await snapshot(b)).budgetItems[0].title,'After unsubscribe');events.push({client:'B',type:'UNSUBSCRIBED_NO_FURTHER_EVENT',at:new Date().toISOString()});
 });
 await test('H02-09','Ordinary member deletes exact QA object via Storage HTTP',async()=>{if(followup){good(await upload(a,path));state.objects.push(path);await save();}removed(await remove(a,path));denied(await freshDownload(a,path));state.objects=state.objects.filter(p=>p!==path);await save();});
 await test('H03-01','Ordinary user cannot execute dedicated Worker RPCs',async()=>{
  for(const name of ['claim_budget_receipt_verification','claim_budget_receipt_worker']){
   // No user role can enter these functions; no queue claim is created.
   const r=await http(a,`/rest/v1/rpc/${name}`,'POST',{});denied(r);assert.equal(r.data.code,'42501');
  }
 });
 await test('H01-15','Observed deterministic HTTP conflicts contain no custom 40001',async()=>{assert(!requests.some(r=>r.code==='40001'));return {observedRequests:requests.length,scope:'Only this preactivation HTTP run; not proof against every possible engine serialization failure'};});
}catch(e){fatal=safe(e.message);evidence.fatal=fatal;console.log(`STOP ${fatal}`);}
finally{
 for(const client of clients){try{await client.removeAllChannels();await client.realtime.disconnect();}catch{}}
 // Never bypass Guard or delete private audit/queue records to make cleanup pass.
 if(a)for(const object of [...state.objects]){try{const r=await remove(a,object);good(r);denied(await freshDownload(a,object));state.objects=state.objects.filter(p=>p!==object);cleanup.push({resource:'QA Storage object',removed:true});}catch(e){cleanup.push({resource:'QA Storage object',removed:false,reason:safe(e.message)});}}
 let tripRemoved=!state.createdTrip;
 if(state.createdTrip){try{good(await http(admin,`/rest/v1/trips?id=eq.${trip}&title=eq.${encodeURIComponent(`QA B7 preactivation ${run}`)}`,'DELETE',undefined,{fixture:true}));assert.equal(good(await http(admin,`/rest/v1/trips?id=eq.${trip}&select=id`,'GET',undefined,{fixture:true})).length,0);cleanup.push({resource:'QA trip and normal cascades',removed:true});
   // Legacy opaque revision tombstones: exact invocation UUID only, no private ledger.
   good(await http(admin,`/rest/v1/budget_collaboration_signals?trip_id=eq.${trip}`,'DELETE',undefined,{fixture:true}));tripRemoved=true;
  }catch(e){cleanup.push({resource:'QA trip',removed:false,reason:safe(e.message),retained:true});}}
 for(const u of users){if(!tripRemoved){cleanup.push({resource:`QA account ${u.label}`,removed:false,retained:true,reason:'Trip cleanup rejected; do not cascade through Auth deletion'});continue;}try{good(await http(admin,`/auth/v1/admin/users/${u.id}`,'DELETE',undefined,{fixture:true}));assert.equal((await http(admin,`/auth/v1/admin/users/${u.id}`,'GET',undefined,{fixture:true})).status,404);cleanup.push({resource:`QA account ${u.label}`,removed:true});}catch(e){cleanup.push({resource:`QA account ${u.label}`,removed:false,retained:true,reason:safe(e.message)});}}
 evidence.finishedAt=new Date().toISOString();evidence.passed=results.filter(x=>x.status==='Passed').length;evidence.failed=results.filter(x=>x.status==='Failed').length;evidence.fatal=fatal??null;
 evidence.fixtureHashes={trip:hash(trip),users:users.map(u=>hash(u.id)),objects:[hash(path)]};
 evidence.pendingPostActivation=['Group concurrency/lease takeover','Pricing/Payment/Source/retained Actual/FX','Undo and peer conflict','Lifecycle create/delete competition','Unknown ACK/Replay/Snapshot delay with B-7 mutations','Receipt Begin/Commit/Replace and verifier SHA256 pipeline','Legacy-client activated fencing'];
 evidence.blocked=['Dedicated Worker JWT not supplied; signing secret not accessed','Worker scheduler/cleanup loop not authorized'];
 await save();console.log(JSON.stringify({passed:evidence.passed,failed:evidence.failed,fatal:evidence.fatal,cleanup,output:`${work}/http-results.json`}));
}
if(fatal||evidence.failed)process.exitCode=1;
