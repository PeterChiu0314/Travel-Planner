// Staging-only, retained QA identities. No schema/role/flag/ledger writes,
// no Worker, no new account/trip, no deleting the retained graph.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {isPostgresChangesReady} from '../../src/lib/realtimePostgresReadiness.js';
const project='uyqdopksfysbobhjcepk',work='.tmp-b7-p1';
const requirePostgresReady=process.argv.includes('--postgres-ready');
assert(process.argv.includes('--authorized-retained-qa'),'Explicit retained-QA authority required');
const scope=JSON.parse(await fs.readFile(`${work}/qa-scope.json`,'utf8'));
const before=JSON.parse(await fs.readFile(`${work}/before.json`,'utf8'));
assert.equal(before.ledger.count,62);assert(Object.values(before.protocols).every(p=>!p.enabled&&!p.activated&&!p.full_enabled));
const env=Object.fromEntries((await fs.readFile('.env.staging.local','utf8')).split(/\r?\n/).map(s=>s.match(/^\s*([A-Z_0-9]+)\s*=\s*["']?(.*?)["']?\s*$/)).filter(Boolean).map(m=>[m[1],m[2]]));
const url=env.VITE_SUPABASE_URL,anon=env.VITE_SUPABASE_ANON_KEY,admin=process.env.STAGING_FIXTURE_ADMIN_KEY;
const claims=t=>JSON.parse(Buffer.from(t.split('.')[1],'base64url'));
const hash=s=>createHash('sha256').update(s).digest('hex');
assert.equal(url,`https://${project}.supabase.co`);assert.equal(claims(admin).ref,project);assert.equal(claims(admin).role,'service_role');
const run=randomUUID(),trip=scope.trip,clients=[],tokens=[],created=[],results=[],timeline=[],frames=[];
const safe=s=>String(s).replace(/eyJ[A-Za-z0-9_.-]+/g,'[token]').replace(/sb_(secret|publishable)_[A-Za-z0-9_-]+/g,'[key]').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,'[uuid]');
const stamp=()=>({at:new Date().toISOString(),elapsedMs:Math.round(performance.now())});
const evidence={project,runHash:hash(run),tripHash:hash(trip),requirePostgresReady,startedAt:new Date().toISOString(),authMethod:'Existing QA Auth Admin generateLink + real Auth verify, no email sent or password reset',results,timeline,frames,createdHashes:[],acceptanceUsesServiceRole:false};
const save=async()=>{await fs.writeFile(`${work}/rt-results.json`,JSON.stringify(evidence,null,2));await fs.writeFile(`${work}/created-rows.json`,JSON.stringify({trip,run,ids:created},null,2));};
const http=async(token,route,method='GET',body,fixture=false)=>{
 if(fixture){assert.equal(token,admin);assert(/^\/auth\/v1\/admin\/(users\/|generate_link$)/.test(route));}
 else assert.notEqual(token,admin);
 if(route.startsWith('/rest/')&&method!=='GET'){
  if(route==='/rest/v1/rpc/save_budget_workspace_record_v3')assert.equal(body.p_trip_id,trip);
  else if(route==='/rest/v1/budget_items'&&method==='POST')assert.equal(body.trip_id,trip);
  else if(route.startsWith('/rest/v1/budget_items?')&&method==='PATCH')assert(route.includes(`trip_id=eq.${trip}`)&&created.some(id=>route.includes(`id=eq.${id}`)));
  else if(route.startsWith('/rest/v1/trip_members?')&&method==='PATCH')assert(route.includes(`trip_id=eq.${trip}`)&&route.includes(`user_id=eq.${scope.users[1]}`)&&Object.keys(body).join()==='status');
  else throw Error('Unexpected mutation scope');
 }
 const t=stamp();const r=await fetch(url+route,{method,headers:{apikey:fixture?admin:anon,...(token?{Authorization:`Bearer ${token}`} :{}),'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
 const text=await r.text();let data;try{data=text?JSON.parse(text):null;}catch{throw Error(`Non-JSON HTTP ${r.status}`);}
 if(!fixture&&!route.startsWith('/auth/'))timeline.push({type:'HTTP',route:route.split('?')[0],method,status:r.status,code:data?.code??null,start:t,response:stamp(),serverDate:r.headers.get('date')});
 return {status:r.status,data};
};
const good=r=>{assert(r.status>=200&&r.status<300,`HTTP ${r.status} ${safe(r.data?.message||r.data?.msg||r.data?.error_description||'')}`);return r.data;};
const test=async(name,fn)=>{try{const detail=await fn();results.push({name,status:'Passed',detail});console.log('PASS '+name);}catch(e){results.push({name,status:'Failed',message:safe(e.message)});console.log('FAIL '+name+' '+safe(e.message));}await save();};
const wait=async fn=>{const end=Date.now()+10000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Expected event missing within unchanged 10s bound');};
const clientFor=async(token,label)=>{
 // Instrument only safe envelope fields before SDK dispatch; frames and JWT
 // content are never persisted. This is the real native WebSocket transport.
 class AuditedSocket extends WebSocket{
  constructor(...args){super(...args);this.addEventListener('message',event=>{
   try{const raw=JSON.parse(typeof event.data==='string'?event.data:Buffer.from(event.data).toString());
    const envelope=Array.isArray(raw)?{joinRef:raw[0],ref:raw[1],topic:raw[2],event:raw[3],payload:raw[4]}:raw;
    const p=envelope.payload||{},data=p.data||{};
    frames.push({...stamp(),client:label,event:envelope.event,topicHash:hash(envelope.topic||''),ref:envelope.ref??null,status:p.status??null,changeType:data.type??null,commitTimestamp:data.commit_timestamp??null,errors:Array.isArray(data.errors)?data.errors.map(safe):null,message:envelope.event==='system'?safe(p.message||''):undefined});
   }catch{frames.push({...stamp(),client:label,event:'binary-or-non-json',bytes:typeof event.data==='string'?event.data.length:event.data.byteLength});}
  });}
 }
 const c=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:`Bearer ${token}`}},realtime:{transport:AuditedSocket}});
 clients.push(c);await c.realtime.setAuth(token);return c;
};
const variants=[['insert-filtered','INSERT',true],['all-filtered','*',true],['insert-unfiltered','INSERT',false],['all-unfiltered','*',false]];
const subscriptions=[];
const subscribe=async(c,label,variant)=>{
 const [name,event,filtered]=variant,seen=[],s={label,variant:name,seen};subscriptions.push(s);
 s.channel=c.channel(`qa-b7-p1-${run}-${label}-${name}`).on('system',{},p=>{timeline.push({...stamp(),type:'SYSTEM',client:label,variant:name,extension:p.extension,status:p.status,message:safe(p.message||'')});if(isPostgresChangesReady(p))s.postgresReady=stamp();}).on('postgres_changes',{event,schema:'public',table:'budget_items',...(filtered?{filter:`trip_id=eq.${trip}`}:{})},p=>{
  // Unfiltered listeners never persist or apply rows outside the QA trip.
  if(p.new?.trip_id!==trip)return;
  const item={...stamp(),type:'CALLBACK',client:label,variant:name,eventType:p.eventType,idHash:hash(p.new.id),commitTimestamp:p.commit_timestamp,newKeys:Object.keys(p.new).sort(),oldKeys:Object.keys(p.old||{}).sort(),errors:p.errors??null};seen.push(item);timeline.push(item);
 });
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('JOIN acknowledgement missing within unchanged 10s')),10000);s.channel.subscribe((status,error)=>{timeline.push({...stamp(),type:'STATUS',client:label,variant:name,status,message:error?safe(error.message):null});if(status==='SUBSCRIBED'){clearTimeout(timer);s.subscribed=stamp();resolve();}if(['CHANNEL_ERROR','TIMED_OUT'].includes(status)){clearTimeout(timer);reject(Error(error?safe(error.message):status));}});});
 if(requirePostgresReady)await wait(()=>Boolean(s.postgresReady));return s;
};
const update=(a,id,title)=>http(a,`/rest/v1/budget_items?id=eq.${id}&trip_id=eq.${trip}`,'PATCH',{title});
let restored=false,a,b,rpcId,restId,fatal;
try{
 for(const uid of scope.users){
  const user=good(await http(admin,`/auth/v1/admin/users/${uid}`,'GET',undefined,true));assert.equal(user.id,uid);assert.equal(user.user_metadata.qa_run,scope.run);assert(user.email.endsWith('@example.invalid'));
  // Raw Auth Admin HTTP flattens user/properties; supabase-js wraps them.
  const link=good(await http(admin,'/auth/v1/admin/generate_link','POST',{type:'magiclink',email:user.email},true));assert.equal((link.user||link).id,uid);
  const tokenHash=(link.properties||link).hashed_token;assert.equal(typeof tokenHash,'string');
  const session=good(await http(null,'/auth/v1/verify','POST',{type:'magiclink',token_hash:tokenHash}));assert.equal(claims(session.access_token).sub,uid);assert.equal(claims(session.access_token).role,'authenticated');tokens.push(session.access_token);
  assert.equal(good(await http(session.access_token,'/auth/v1/user')).id,uid);
 }
 [a,b]=tokens;assert.notEqual(claims(a).session_id,claims(b).session_id);evidence.identities=scope.users.map((u,i)=>({userHash:hash(u),sessionHash:hash(claims(tokens[i]).session_id)}));
 const membership=good(await http(a,`/rest/v1/trip_members?trip_id=eq.${trip}&select=user_id,status,role`));assert(membership.some(m=>m.user_id===scope.users[0]&&m.role==='owner'));assert(membership.some(m=>m.user_id===scope.users[1]&&m.status==='approved'));
 // Reproduce the original cold two-channel gate before comparison channels
 // introduce incidental time between JOIN acknowledgement and the first write.
 const coldA=await clientFor(a,'A-cold'),coldB=await clientFor(b,'B-cold');
 const [coldSa,coldSb]=await Promise.all([subscribe(coldA,'A-cold',variants[1]),subscribe(coldB,'B-cold',variants[1])]);
 await test(requirePostgresReady?'Fixed cold gate: immediate RPC INSERT after two Postgres-ready acknowledgements':'Original cold gate: immediate RPC INSERT after two SUBSCRIBED acknowledgements',async()=>{
  timeline.push({...stamp(),type:'COLD_RPC_INSERT_START'});
  const row=good(await http(a,'/rest/v1/rpc/save_budget_workspace_record_v3','POST',{p_trip_id:trip,p_kind:'budget',p_id:null,p_base_updated_at:null,p_payload:{title:`QA P1 cold ${run}`,category:'其他',amount:120,currency:'TWD',payer_id:scope.users[0],pricing_mode:'split_total',split_type:'equal',participantIds:[scope.users[0]],payment_action:'keep',payment_expected:[],unified_planning:true},p_request_id:randomUUID()}));
  assert(row.id);created.push(row.id);await save();await wait(()=>[coldSa,coldSb].every(s=>s.seen.some(e=>e.eventType==='INSERT'&&e.idHash===hash(row.id))));
 });
 await Promise.all([coldA.removeAllChannels(),coldB.removeAllChannels()]);await Promise.all([coldA.realtime.disconnect(),coldB.realtime.disconnect()]);
 const ca=await clientFor(a,'A'),cb=await clientFor(b,'B');
 for(const variant of variants)await Promise.all([subscribe(ca,'A',variant),subscribe(cb,'B',variant)]);
 const comparisons=subscriptions.filter(s=>['A','B'].includes(s.label));assert(comparisons.every(s=>s.subscribed));
 await test('RPC INSERT: both real JWT clients, INSERT/*, with/without filter',async()=>{
  timeline.push({...stamp(),type:'RPC_INSERT_START'});
  const data=good(await http(a,'/rest/v1/rpc/save_budget_workspace_record_v3','POST',{p_trip_id:trip,p_kind:'budget',p_id:null,p_base_updated_at:null,p_payload:{title:`QA P1 RPC ${run}`,category:'其他',amount:120,currency:'TWD',payer_id:scope.users[0],pricing_mode:'split_total',split_type:'equal',participantIds:[scope.users[0]],payment_action:'keep',payment_expected:[],unified_planning:true},p_request_id:randomUUID()}));
  rpcId=data.id;assert(rpcId);created.push(rpcId);await save();const idHash=hash(rpcId);
  await wait(()=>comparisons.every(s=>s.seen.some(e=>e.eventType==='INSERT'&&e.idHash===idHash)));
  return {allEightSubscriptionsDelivered:true};
 });
 await test('REST INSERT at identical user role: both clients and all four variants',async()=>{
  restId=randomUUID();created.push(restId);await save();timeline.push({...stamp(),type:'REST_INSERT_START'});
  const rows=good(await http(a,'/rest/v1/budget_items','POST',{id:restId,trip_id:trip,title:`QA P1 REST ${run}`,category:'其他',amount:120,currency:'TWD',exchange_rate:1,twd_amount:120,payer_id:scope.users[0]}));assert.equal(rows[0].id,restId);
  await wait(()=>comparisons.every(s=>s.seen.some(e=>e.eventType==='INSERT'&&e.idHash===hash(restId))));return {allEightSubscriptionsDelivered:true};
 });
 assert(restId,'REST fixture missing');
 await test('UPDATE after INSERT delivered to both * subscriptions; INSERT-only stays silent',async()=>{
  const beforeCount=comparisons.filter(s=>s.variant.startsWith('insert')).map(s=>s.seen.length);
  good(await update(a,restId,`QA P1 UPDATE ${run}`));await wait(()=>comparisons.filter(s=>s.variant.startsWith('all')).every(s=>s.seen.some(e=>e.eventType==='UPDATE'&&e.idHash===hash(restId))));
  assert.deepEqual(comparisons.filter(s=>s.variant.startsWith('insert')).map(s=>s.seen.length),beforeCount);
 });
 await test('Resubscription: both JWT clients receive a new INSERT then UPDATE',async()=>{
  await Promise.all([ca.removeAllChannels(),cb.removeAllChannels()]);await Promise.all([ca.realtime.disconnect(),cb.realtime.disconnect()]);
  const na=await clientFor(a,'A-rejoin'),nb=await clientFor(b,'B-rejoin');const [sa,sb]=await Promise.all([subscribe(na,'A-rejoin',variants[1]),subscribe(nb,'B-rejoin',variants[1])]);
  const id=randomUUID();created.push(id);await save();good(await http(a,'/rest/v1/budget_items','POST',{id,trip_id:trip,title:`QA P1 rejoin ${run}`,category:'其他',amount:1,currency:'TWD',exchange_rate:1,twd_amount:1,payer_id:scope.users[0]}));
  await wait(()=>[sa,sb].every(s=>s.seen.some(e=>e.eventType==='INSERT'&&e.idHash===hash(id))));
  good(await update(a,id,`QA P1 rejoin update ${run}`));await wait(()=>[sa,sb].every(s=>s.seen.some(e=>e.eventType==='UPDATE'&&e.idHash===hash(id))));
  await nb.removeChannel(sb.channel);const count=sb.seen.length;good(await update(a,id,`QA P1 unsubscribe ${run}`));const updates=sa.seen.filter(e=>e.eventType==='UPDATE').length;await wait(()=>sa.seen.filter(e=>e.eventType==='UPDATE').length>=Math.max(2,updates));await new Promise(r=>setTimeout(r,600));assert.equal(sb.seen.length,count);
 });
 await test('Nonmember QA isolation using owner-controlled membership suspension and restoration',async()=>{
  good(await http(a,`/rest/v1/trip_members?trip_id=eq.${trip}&user_id=eq.${scope.users[1]}`,'PATCH',{status:'pending'}));
  const rows=good(await http(b,`/rest/v1/budget_items?trip_id=eq.${trip}&select=id`));assert.deepEqual(rows,[]);
  const denied=await update(b,restId,'Must not update');assert(denied.status>=400||Array.isArray(denied.data)&&denied.data.length===0);
  good(await http(a,`/rest/v1/trip_members?trip_id=eq.${trip}&user_id=eq.${scope.users[1]}`,'PATCH',{status:'approved'}));restored=true;
 });
}catch(e){fatal=safe(e.message);console.log('STOP '+fatal);}
finally{
 for(const c of clients)try{await c.removeAllChannels();await c.realtime.disconnect();}catch{}
 if(a&&!restored)try{good(await http(a,`/rest/v1/trip_members?trip_id=eq.${trip}&user_id=eq.${scope.users[1]}`,'PATCH',{status:'approved'}));restored=true;}catch(e){evidence.membershipRestoreFailure=safe(e.message);}
 for(const token of tokens)try{good(await http(token,'/auth/v1/logout?scope=local','POST'));}catch(e){timeline.push({type:'QA_SIGNOUT_ERROR',message:safe(e.message)});}
 evidence.membershipRestored=restored;evidence.fatal=fatal??null;evidence.finishedAt=new Date().toISOString();evidence.createdHashes=created.map(hash);evidence.noCleanupAttempt=true;evidence.passed=results.filter(r=>r.status==='Passed').length;evidence.failed=results.filter(r=>r.status==='Failed').length;
 evidence.deliveryMatrix=subscriptions.map(s=>({client:s.label,variant:s.variant,subscribed:s.subscribed,postgresReady:s.postgresReady,callbacks:s.seen}));await save();console.log(JSON.stringify({passed:evidence.passed,failed:evidence.failed,createdBudgets:created.length,membershipRestored:restored,fatal:evidence.fatal}));
}
if(fatal||evidence.failed)process.exitCode=1;
