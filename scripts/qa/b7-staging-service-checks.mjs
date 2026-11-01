import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';import https from 'node:https';
const sha=x=>createHash('sha256').update(x).digest('hex');
const claims=t=>JSON.parse(Buffer.from(t.split('.')[1],'base64url').toString());
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lMsAAAAASUVORK5CYII=','base64');
const clean=s=>String(s).replace(/eyJ[A-Za-z0-9_.-]+/g,'[redacted]').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,'[qa-id]');
export async function execute({credentials:c,runtime:r,args}){
 assert.equal(r.project,'uyqdopksfysbobhjcepk','Staging-only QA project');assert.equal(r.url,'https://uyqdopksfysbobhjcepk.supabase.co','Staging-only QA endpoint');
 const out=r.proof??={project:r.project,realAuth:true,realHttp:true,requests:[],results:[]};
 const save=async()=>{await fs.writeFile(r.dir+'/service-results.json',JSON.stringify(out,null,2));if(r.manifest)await fs.writeFile(r.dir+'/qa-state.json',JSON.stringify(r.manifest,null,2));};
 const http=async(token,route,method='GET',body,options={})=>{
  assert(route.startsWith('/')&&!route.startsWith('//'));assert.equal(r.project,'uyqdopksfysbobhjcepk');
  if(token===c.admin)assert(options.fixture,'Admin is fixture-only');
  const started=performance.now();const response=await fetch(r.url+route,{redirect:'error',method,headers:{apikey:token===c.admin?c.admin:c.anon,...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':options.type||'application/json',Prefer:options.minimal?'return=minimal':'return=representation'},body:body===undefined?undefined:options.raw?body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
  const bytes=Buffer.from(await response.arrayBuffer());let data;try{data=bytes.length?JSON.parse(bytes.toString()):null;}catch{data=null;}
  if(!options.fixture&&!route.startsWith('/auth/'))out.requests.push({route:route.split('?')[0].replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,':id'),method,status:response.status,code:data?.code||data?.error||null,ms:Math.round(performance.now()-started)});
  return {status:response.status,data,bytes};
 };
 const good=x=>{assert(x.status>=200&&x.status<300,'HTTP '+x.status+' '+clean(x.data?.code||x.data?.error||''));return x.data;};
 const record=(id,detail)=>{out.results.push({id,status:'Passed',detail});};
 if(args.mode==='initialize'){
  assert(!r.manifest,'Already initialized; never repeat uncertain writes');
  const pre=JSON.parse(await fs.readFile(r.dir+'/before.json','utf8'));assert.equal(pre.ledger.count,64);assert(Date.now()-Date.parse(pre.observedAt)<300000,'Fresh preflight required');assert(Object.values(pre.protocols).every(x=>!x.enabled&&!x.activated&&!x.full_enabled&&!x.storage_verified&&!x.cleanup_worker_verified&&!x.content_worker_verified));assert.deepEqual(pre.queue,{cleanup:0,intents:0});
  const qa=JSON.parse(await fs.readFile(r.root+'/.tmp-b7-p1/qa-scope.json','utf8'));r.sessions=[];
  for(const id of qa.users){const u=good(await http(c.admin,'/auth/v1/admin/users/'+id,'GET',undefined,{fixture:true}));assert.equal(u.id,id);assert.equal(u.user_metadata.qa_run,qa.run);assert(u.email.endsWith('@example.invalid'));const link=good(await http(c.admin,'/auth/v1/admin/generate_link','POST',{type:'magiclink',email:u.email},{fixture:true}));const auth=good(await http(null,'/auth/v1/verify','POST',{type:'magiclink',token_hash:(link.properties||link).hashed_token}));assert.equal(claims(auth.access_token).role,'authenticated');assert.equal(claims(auth.access_token).sub,id);assert.equal(good(await http(auth.access_token,'/auth/v1/user')).id,id);r.sessions.push(auth);}
  assert.notEqual(claims(r.sessions[0].access_token).session_id,claims(r.sessions[1].access_token).session_id);
  const run=randomUUID(),trips=[randomUUID(),randomUUID()];r.manifest={run,users:qa.users,tripIds:trips,objects:[],actualIds:[],budgets:[],createdAt:new Date().toISOString()};await save();
  for(const trip of trips){good(await http(r.sessions[0].access_token,'/rest/v1/trips','POST',{id:trip,title:'QA B7 Closeout '+run,name:'QA B7 Closeout '+run,owner_id:qa.users[0],destination:'B7 isolated QA',start_date:'2099-01-01',end_date:'2099-01-03'},{minimal:true}));good(await http(c.admin,'/rest/v1/trip_members','POST',{trip_id:trip,user_id:qa.users[0],role:'owner',status:'approved',display_name:'B7 QA Owner'},{fixture:true}));}
  good(await http(c.admin,'/rest/v1/trip_members','POST',{trip_id:trips[0],user_id:qa.users[1],role:'editor',status:'approved',display_name:'B7 QA Editor'},{fixture:true}));
  record('AUTH-REAL',{sessions:2,userHashes:qa.users.map(sha),sessionHashes:r.sessions.map(x=>sha(claims(x.access_token).session_id)),adminAcceptance:false});
  good(await http(r.sessions[0].access_token,`/rest/v1/trips?id=eq.${trips[0]}&select=id`));assert.deepEqual(good(await http(r.sessions[1].access_token,`/rest/v1/trips?id=eq.${trips[1]}&select=id`)),[]);record('AUTH-RLS',{member:true,nonmember:true});await save();return {initialized:true,results:out.results,tripHashes:trips.map(sha)};
 }
 assert(r.manifest&&r.sessions?.length===2,'Initialize real QA sessions first');
 const a=r.sessions[0].access_token,b=r.sessions[1].access_token,m=r.manifest;
 if(args.mode==='worker-capability'){
  for(const name of ['claim_budget_receipt_verification','claim_budget_receipt_worker']){const response=await http(c.worker,'/rest/v1/rpc/'+name,'POST',{});assert.equal(response.status,200);assert.equal(response.data,null);const denied=await http(a,'/rest/v1/rpc/'+name,'POST',{});assert.equal(denied.data?.code,'42501');}
  record('WORKER-SIGNED-CAPABILITY',{dedicatedJwt:true,ttlSeconds:claims(c.worker).exp-claims(c.worker).iat,emptyClaimsOnly:true,notLifecycleAcceptance:true});await save();return out.results.at(-1);
 }
 if(args.mode==='storage'){
  const root=`trips/${m.tripIds[1]}/attachments/qa-b7-platform/${m.run}`,p=root+'/pixel.png';m.objects.push(p);await save();
  good(await http(a,'/storage/v1/object/trip-attachments/'+p,'POST',png,{raw:true,type:'image/png'}));
  const read=await http(a,'/storage/v1/object/authenticated/trip-attachments/'+p+'?qa='+randomUUID());assert.equal(read.status,200);assert.equal(sha(read.bytes),sha(png));record('STORAGE-BYTES',{size:png.length,sha256:sha(png)});
  const signed=good(await http(a,'/storage/v1/object/sign/trip-attachments/'+p,'POST',{expiresIn:30}));const signedPath=signed.signedURL||signed.signedUrl;assert(signedPath.startsWith('/object/sign/'));const sr=await http(null,'/storage/v1'+signedPath);assert.equal(sr.status,200);assert.equal(sha(sr.bytes),sha(png));record('STORAGE-SIGNED-URL',{bytesMatch:true});
  for(const token of [b,null]){const denied=await http(token,'/storage/v1/object/authenticated/trip-attachments/'+p);assert(denied.status>=400);const sign=await http(token,'/storage/v1/object/sign/trip-attachments/'+p,'POST',{expiresIn:30});assert(sign.status>=400);}
  record('STORAGE-PRIVATE',{nonmemberAndAnonymousDenied:true});
  const mime=await http(a,'/storage/v1/object/trip-attachments/'+root+'/bad.txt','POST',Buffer.from('QA'),{raw:true,type:'text/plain'});assert(mime.status>=400);record('STORAGE-MIME',{httpStatus:mime.status});
  // Keep the existing12s boundary. Record exact transport stages rather than
  // extending deadlines or treating a failed upload as a size-limit rejection.
  const largePath=root+'/too-large.png',bytes=Buffer.alloc(10485761);png.copy(bytes);const timing={declaredBytes:bytes.length};
  const over=await new Promise(resolve=>{const start=performance.now();let sent=false,done=false;const finish=x=>{if(done)return;done=true;clearTimeout(fallback);resolve({...x,timing});};const req=https.request(r.url+'/storage/v1/object/trip-attachments/'+largePath,{method:'POST',headers:{apikey:c.anon,Authorization:'Bearer '+a,'Content-Type':'image/png','Content-Length':bytes.length,Expect:'100-continue'}},res=>{let text='';res.on('data',x=>{if(text.length<4096)text+=x});res.on('end',()=>{let d;try{d=JSON.parse(text)}catch{}finish({status:res.statusCode,code:d?.code||d?.error||null,serverStatus:d?.statusCode||null})});});
   req.on('socket',s=>{s.once('lookup',()=>timing.dnsMs=Math.round(performance.now()-start));s.once('secureConnect',()=>timing.tlsMs=Math.round(performance.now()-start));});const send=()=>{if(sent)return;sent=true;timing.bodyStartMs=Math.round(performance.now()-start);req.end(bytes);};req.once('continue',()=>{timing.continueMs=Math.round(performance.now()-start);send()});req.once('finish',()=>timing.clientFinishMs=Math.round(performance.now()-start));req.once('error',e=>finish({status:null,error:e.code||'transport-error'}));req.setTimeout(12000,()=>req.destroy(Error('transport-deadline')));const fallback=setTimeout(send,1000);req.flushHeaders();
  });
  out.overLimit=over;if(over.status!==413){out.results.push({id:'STORAGE-OVER-10MIB',status:over.status===null?'Blocked':'Failed',detail:over});await save();return {stop:true,overLimit:over,results:out.results};}record('STORAGE-OVER-10MIB',over);
  const removed=good(await http(a,'/storage/v1/object/trip-attachments','DELETE',{prefixes:[p]}));assert(removed.some(x=>x.name===p));const absent=await http(a,'/storage/v1/object/authenticated/trip-attachments/'+p+'?qa='+randomUUID());assert(absent.status>=400);m.objects=m.objects.filter(x=>x!==p);record('STORAGE-DELETE',{httpReadAbsent:true});await save();return {results:out.results,overLimit:over};
 }
 if(args.mode==='storage-tus'){
  const p=`trips/${m.tripIds[1]}/attachments/qa-b7-platform/${m.run}/too-large-tus.png`;
  const metadata=Object.entries({bucketName:'trip-attachments',objectName:p,contentType:'image/png',cacheControl:'3600'}).map(([k,v])=>k+' '+Buffer.from(v).toString('base64')).join(',');
  const started=performance.now();const response=await fetch(r.url+'/storage/v1/upload/resumable',{method:'POST',headers:{apikey:c.anon,Authorization:'Bearer '+a,'Tus-Resumable':'1.0.0','Upload-Length':'10485761','Upload-Metadata':metadata,'x-upsert':'false'},signal:AbortSignal.timeout(12000)});
  const detail={status:response.status,ms:Math.round(performance.now()-started),declaredBytes:10485761,protocol:'TUS 1.0.0',bytesSent:0};
  if(response.status===201){const location=response.headers.get('location');assert(location);const target=new URL(location,r.url);assert(target.hostname===new URL(r.url).hostname,'Exact Staging upload location required');const removed=await fetch(target,{method:'DELETE',headers:{apikey:c.anon,Authorization:'Bearer '+a,'Tus-Resumable':'1.0.0'},signal:AbortSignal.timeout(12000)});detail.terminationStatus=removed.status;assert(removed.status>=200&&removed.status<300,'Incomplete QA upload must terminate normally');}
  await response.arrayBuffer();out.results.push({id:'STORAGE-OVER-10MIB-TUS',status:response.status===413?'Passed':'Failed',detail});await save();return out.results.at(-1);
 }
 if(args.mode==='storage-delete'){
  const p=`trips/${m.tripIds[1]}/attachments/qa-b7-platform/${m.run}/pixel.png`;
  const d=good(await http(a,'/storage/v1/object/trip-attachments','DELETE',{prefixes:[p]}));assert(d.some(x=>x.name===p));const absent=await http(a,'/storage/v1/object/authenticated/trip-attachments/'+p+'?qa='+randomUUID());assert(absent.status>=400);m.objects=m.objects.filter(x=>x!==p);record('STORAGE-DELETE',{realHttp:true,readAbsent:true});await save();return out.results.at(-1);
 }
 if(args.mode==='remember-expiry'){
  r.expiryToken=c.worker;return {expiresAt:claims(c.worker).exp,stored:'memory only'};
 }
 if(args.mode==='expired-worker'){
  // PostgREST documents 30 seconds of exp clock-skew tolerance. Keep the
  // rejection assertion strict; test after that actual interval, no re-signing.
  assert(r.expiryToken&&claims(r.expiryToken).exp+30<Date.now()/1000,'Wait for genuine expiry plus documented30-second clock skew; never change signed claims');
  const response=await http(r.expiryToken,'/rest/v1/rpc/claim_budget_receipt_worker','POST',{});assert.equal(response.status,401);assert(/expired/i.test(response.data?.message||''),'Must fail because of genuine expiry');r.expiryToken=null;record('WORKER-EXPIRED-JWT',{httpStatus:response.status,code:response.data.code,realExpiry:true});await save();return out.results.at(-1);
 }
 if(args.mode==='prepare-ref'||args.mode==='prepare-cleanup-retry'){
  const key=args.mode==='prepare-ref'?'reference':'cleanupRetry',name=key==='reference'?'reference':'retry-cleanup';assert(!m.canary[key]);const p=`trips/${m.tripIds[0]}/attachments/qa-b7-worker/${m.run}/${m.canary.actual}/${name}.png`;
  good(await http(a,'/storage/v1/object/trip-attachments/'+p,'POST',png,{raw:true,type:'image/png'}));m.canary[key]={path:p,request:randomUUID(),attachment:randomUUID()};m.objects.push(p);await save();return {uploaded:true,sha256:sha(png)};
 }
 if(args.mode==='worker-reference'){
  const ref=m.canary.reference;assert(ref);const job=good(await http(c.worker,'/rest/v1/rpc/claim_budget_receipt_worker','POST',{}));assert.equal(job.path,ref.path);r.referenceJob=job;
  const storage=(method,body,path=ref.path)=>fetch(r.url+'/storage/v1/'+(method==='DELETE'?'object/trip-attachments':'object/authenticated/trip-attachments/'+path),{method,headers:{apikey:c.anon,Authorization:'Bearer '+c.worker,'Content-Type':'application/json','x-receipt-worker-job':job.id,'x-receipt-worker-token':job.token},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
  good(await http(a,'/rest/v1/attachments','POST',{id:ref.attachment,trip_id:m.tripIds[0],target_type:'actual_expense',target_id:m.canary.actual,file_name:'QA live reference.png',file_url:ref.path,file_type:'image/png',file_size:png.length,uploaded_by:m.users[0]}));
  const denied=await storage('DELETE',{prefixes:[ref.path]});const deniedData=await denied.json();assert(denied.status>=400||Array.isArray(deniedData)&&deniedData.length===0,'Referenced object must not delete');const live=await http(a,'/storage/v1/object/authenticated/trip-attachments/'+ref.path+'?qa='+randomUUID());assert.equal(live.status,200);assert.equal(sha(live.bytes),sha(png));
  const overwritten=await fetch(r.url+'/storage/v1/object/trip-attachments/'+ref.path,{method:'POST',headers:{apikey:c.anon,Authorization:'Bearer '+a,'Content-Type':'image/png','x-upsert':'true'},body:png,signal:AbortSignal.timeout(12000)});assert(overwritten.status>=400,'Legacy overwrite must not change protected object');await overwritten.arrayBuffer();
  good(await http(a,`/rest/v1/attachments?id=eq.${ref.attachment}`,'DELETE'));const deleted=await storage('DELETE',{prefixes:[ref.path]});assert(deleted.status>=200&&deleted.status<300);const deletedData=await deleted.json();assert(deletedData.some(x=>x.name===ref.path));assert.equal(good(await http(c.worker,'/rest/v1/rpc/finish_budget_receipt_cleanup','POST',{p_job_id:job.id,p_token:job.token,p_error:null})),true);
  const absent=await storage('GET');assert(absent.status>=400);await absent.arrayBuffer();m.objects=m.objects.filter(x=>x!==ref.path);record('WORKER-LIVE-REFERENCE',{referencedBytesPreserved:true,legacyOverwriteDenied:true,normalDetachThenCleanup:true,jobHeaders:true});await save();return out.results.at(-1);
 }
 if(args.mode==='cleanup'){
  const pre=JSON.parse(await fs.readFile(r.dir+'/after-platform.json','utf8'));
  assert(Date.now()-Date.parse(pre.observedAt)<300000,'Fresh actual readback required');assert.equal(pre.ledger.count,64);assert.equal(pre.qa.objects,0,'All QA bytes must be removed first');assert(Object.values(pre.protocols).every(x=>!x.enabled&&!x.activated),'Do not apply Dormant cleanup after activation');
  const revoked=good(await http(a,`/rest/v1/trip_members?trip_id=eq.${m.tripIds[0]}&user_id=eq.${m.users[1]}`,'DELETE'));assert.equal(revoked.length,1);assert.deepEqual(good(await http(b,`/rest/v1/trips?id=eq.${m.tripIds[0]}&select=id`)),[]);record('AUTH-MEMBERSHIP-REVOKED',{sameUserJwt:true,readDeniedImmediately:true});
  for(const id of m.actualIds){const rows=good(await http(a,`/rest/v1/actual_expenses?id=eq.${id}&trip_id=eq.${m.tripIds[0]}`,'DELETE'));assert.equal(rows.length,1);assert.deepEqual(good(await http(a,`/rest/v1/actual_expense_participants?actual_expense_id=eq.${id}&select=id`)),[]);}
  for(const id of m.tripIds){const trip=good(await http(a,`/rest/v1/trips?id=eq.${id}&select=id,title`));assert.equal(trip.length,1);assert.equal(trip[0].title,'QA B7 Closeout '+m.run);const rows=good(await http(a,`/rest/v1/trips?id=eq.${id}`,'DELETE'));assert.equal(rows.length,1);assert.deepEqual(good(await http(a,`/rest/v1/trips?id=eq.${id}&select=id`)),[]);}
  m.cleanedAt=new Date().toISOString();m.objects=[];record('QA-NORMAL-CLEANUP',{tripDeletes:2,actualDeletes:m.actualIds.length,ordinaryJwt:true,noForcedCascade:true,privateJournalsRetained:true});await save();return out.results.slice(-2);
 }
 if(args.mode==='logout'){
  for(const token of [a,b])assert.equal((await http(token,'/auth/v1/logout?scope=local','POST')).status,204);record('AUTH-LOGOUT',{sessions:2,scope:'local',doesNotClaimExistingJwtInvalidated:true});await save();r.sessions=null;return out.results.at(-1);
 }
 if(args.mode==='summary'){await save();return {results:out.results,requests:out.requests.length,workerExpiresAt:claims(c.worker).exp};}
 if(args.mode==='prepare-canary'){
  assert(!m.canary,'Never replay uncertain canary initialization');
  const actual=randomUUID();m.actualIds.push(actual);m.canary={actual,session:randomUUID(),objects:[],intents:[]};await save();
  good(await http(a,'/rest/v1/actual_expenses','POST',{id:actual,trip_id:m.tripIds[0],title:'QA Worker canary '+m.run,category:'其他',amount:100,twd_amount:100,currency:'TWD',exchange_rate:1,payer_id:m.users[0],paid_at:new Date().toISOString()}));
  good(await http(a,'/rest/v1/actual_expense_participants','POST',{actual_expense_id:actual,user_id:m.users[0],share_amount:100}));
  for(const name of ['valid','retry','crash','cleanup']){const p=`trips/${m.tripIds[0]}/attachments/qa-b7-worker/${m.run}/${actual}/${name}.png`;const response=good(await http(a,'/storage/v1/object/trip-attachments/'+p,'POST',png,{raw:true,type:'image/png'}));const bytes=await http(a,'/storage/v1/object/authenticated/trip-attachments/'+p+'?qa='+randomUUID());assert.equal(bytes.status,200);assert.equal(sha(bytes.bytes),sha(png));const obj={name,path:p,request:randomUUID(),digest:sha(png),size:png.length,type:'image/png'};m.canary.objects.push(obj);m.objects.push(p);await save();}
  return {prepared:true,objectCount:m.canary.objects.length,actualHash:sha(actual),note:'Real ordinary-user Storage bytes; no private jobs seeded yet'};
 }
 if(args.mode==='storage-multipart'){
  const root=`trips/${m.tripIds[1]}/attachments/qa-b7-platform/${m.run}`,p=root+'/too-large-multipart.png',bytes=Buffer.alloc(10485761);png.copy(bytes);
  const body=new FormData();body.append('cacheControl','3600');body.append('',new Blob([bytes],{type:'image/png'}),'too-large.png');
  const started=performance.now();let proof;
  try{const response=await fetch(r.url+'/storage/v1/object/trip-attachments/'+p,{redirect:'error',method:'POST',headers:{apikey:c.anon,Authorization:'Bearer '+a,'x-upsert':'false'},body,signal:AbortSignal.timeout(12000)});let data;try{data=await response.json()}catch{}proof={status:response.status,code:data?.code||data?.error||null,serverStatus:data?.statusCode||null,ms:Math.round(performance.now()-started),declaredFileBytes:bytes.length,format:'SDK-compatible multipart FormData'};}catch(e){proof={status:null,error:e.name,ms:Math.round(performance.now()-started),format:'SDK-compatible multipart FormData'};}
  const list=good(await http(a,'/storage/v1/object/list/trip-attachments','POST',{prefix:root,limit:100,sortBy:{column:'name',order:'asc'}}));assert(!list.some(x=>x.name.startsWith('too-large')),'Oversized object must not exist');
  out.results.push({id:'STORAGE-OVER-10MIB-MULTIPART',status:proof.status===413?'Passed':proof.status===null?'Blocked':'Failed',detail:{...proof,noOversizedObject:true}});await save();return out.results.at(-1);
 }
 throw Error('Unsupported controlled QA operation');
}
