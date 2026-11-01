// Controlled local operator: secrets enter through stdin, remain in memory and
// never appear in command arguments, status/evidence files, or stdout.
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import {randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createStagingCredentialProvider,credentialProject} from './staging-worker-credentials.mjs';
import {qaDeadline} from './b7-real-response-gate.mjs';
const root=fileURLToPath(new URL('../..',import.meta.url)),dir=path.join(root,'.tmp-b7-live');
const operatorId=randomUUID();
if(!process.argv.includes('--private-stdin'))throw Error('Use the local masked-input launcher');
const maxMinutes=Number(process.argv.find(x=>x.startsWith('--max-minutes='))?.slice('--max-minutes='.length)||50);
if(!Number.isInteger(maxMinutes)||maxMinutes<5||maxMinutes>180)throw Error('Finite memory window required (5–180 minutes)');
await fs.mkdir(dir,{recursive:true});
const state=x=>fs.writeFile(path.join(dir,'status.json'),JSON.stringify({credentialsSaved:false,operatorId,...x}));
const readInput=()=>new Promise((resolve,reject)=>{const r=readline.createInterface({input:process.stdin});let received=false;r.once('line',line=>{received=true;try{resolve(JSON.parse(line));}catch{reject(Error('Private input format invalid'));}r.close();});r.once('close',()=>{if(!received)reject(Error('No private input supplied'));});});
let provider,credentials,deadlineTimer,stopWatcher,stopRequested=false;
const runtime={project:credentialProject,url:`https://${credentialProject}.supabase.co`,root,dir};
const safe=e=>String(e?.message||e).replace(/eyJ[A-Za-z0-9_.-]+|sb_secret_[A-Za-z0-9_-]+/g,'[redacted]');
const closeOwnedRuntime=async()=>{
 // Playwright close on an attached CDP browser only disconnects. Close our
 // proven, isolated native Chrome itself before dropping the CDP connection.
 if(runtime.nativeVisibility?.cdp){
  let timer;
  try{await Promise.race([runtime.nativeVisibility.cdp.send('Browser.close'),new Promise(resolve=>{timer=setTimeout(resolve,3000);})]);}catch{}finally{clearTimeout(timer);}
 }
 await Promise.allSettled([runtime.browser,...(runtime.additionalQaBrowsers||[])].filter(Boolean).map(browser=>qaDeadline(browser.close(),{ms:3000,label:'owned browser close'})));
 try{runtime.viteChild?.kill();}catch{}
 if(!runtime.qaSignoutAttempted&&runtime.qaUserIds&&runtime.publicAnon){
  runtime.qaSignoutAttempted=true;
  const sessions=[...(runtime.cutover?.sessions||[]),...(runtime.finalRecovery?.sessions||[]),...(runtime.sessions||[])];
  const seen=new Set(),results=[];
  for(const session of sessions){
   if(!runtime.qaUserIds.includes(session?.user?.id)||!session.access_token||seen.has(session.user.id))continue;
   seen.add(session.user.id);
   try{const response=await fetch(runtime.url+'/auth/v1/logout?scope=global',{method:'POST',redirect:'error',headers:{apikey:runtime.publicAnon,Authorization:'Bearer '+session.access_token},signal:AbortSignal.timeout(8000)});results.push({status:response.status});}
   catch{results.push({status:'unconfirmed'});}
  }
  await fs.writeFile(path.join(dir,'shutdown-signout.json'),JSON.stringify({at:new Date().toISOString(),ordinaryQaJwtOnly:true,results,independentReadbackRequired:true}));
 }
};
try{
 const input=await readInput();
 const env=await fs.readFile(path.join(root,'.env.staging.local'),'utf8');
 const anon=env.match(/^\s*VITE_SUPABASE_ANON_KEY\s*=\s*["']?([^\s"']+)/m)?.[1];
 const projectUrl=env.match(/^\s*VITE_SUPABASE_URL\s*=\s*["']?([^\s"']+)/m)?.[1];
 if(projectUrl?.replace(/\/$/,'')!==runtime.url)throw Error('Public configuration must target Staging');
 provider=createStagingCredentialProvider({admin:input.admin,anon,legacyAnon:input.legacyAnon||undefined,projectUrl,secret:Buffer.from(input.signingSecret||'','utf8')});
 input.admin=null;input.signingSecret=null;input.legacyAnon=null;credentials=provider.issue();
 const health=await fetch(runtime.url+'/auth/v1/health',{redirect:'error',headers:{apikey:credentials.anon},signal:AbortSignal.timeout(10000)});
 if(health.status!==200)throw Error('Staging public key rejected (HTTP '+health.status+')');
 const scope=JSON.parse(await fs.readFile(path.join(root,'.tmp-b7-p1/qa-scope.json'),'utf8'));
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 if(!Array.isArray(scope.users)||scope.users.length!==2||!scope.users.every(x=>uuid.test(x))||!uuid.test(scope.run))throw Error('Invalid controlled QA identity manifest');
 runtime.qaUserIds=scope.users;runtime.publicAnon=anon;
 const response=await fetch(runtime.url+'/auth/v1/admin/users/'+scope.users[0],{redirect:'error',headers:{apikey:credentials.admin,Authorization:'Bearer '+credentials.admin},signal:AbortSignal.timeout(10000)});
 if(response.status!==200)throw Error('Staging QA Auth read failed (HTTP '+response.status+')');
 const user=await response.json();if(user.id!==scope.users[0]||user.user_metadata?.qa_run!==scope.run)throw Error('QA identity mismatch');
 const workerExpiresAt=JSON.parse(Buffer.from(credentials.worker.split('.')[1],'base64url').toString()).exp;
 // Enforce the RAM window even when a browser operation never settles. The
 // outer loop alone cannot enforce a deadline while awaiting a QA module.
 deadlineTimer=setTimeout(()=>{
  stopRequested=true;provider?.stop();credentials=null;
  const force=setTimeout(()=>process.exit(1),25000);force.unref();
  void closeOwnedRuntime().finally(async()=>{await state({phase:'stopped',reason:'memory-window-expired'});process.exit(0);});
 },maxMinutes*60000);deadlineTimer.unref();
 let inspectingStop=false;
 stopWatcher=setInterval(async()=>{if(inspectingStop||stopRequested)return;inspectingStop=true;try{
  const request=JSON.parse(await fs.readFile(path.join(dir,'request.json'),'utf8'));
  if(request.operatorId===operatorId&&request.action==='stop'){
   stopRequested=true;await closeOwnedRuntime();
  }
 }catch{/* Missing/partial request is not a stop command. */}finally{inspectingStop=false;}},500);stopWatcher.unref();
 await state({phase:'ready',publicKeyStatus:200,authLookupStatus:200,qaIdentityVerified:true,workerExpiresAt,maxMinutes,legacyS3PublicKeySupplied:Boolean(credentials.legacyAnon)});console.log('READY: Staging QA identity verified; credentials in memory only');
 const started=Date.now();let lastId='';
 while(!stopRequested&&Date.now()-started<maxMinutes*60000){
  let request;try{request=JSON.parse(await fs.readFile(path.join(dir,'request.json'),'utf8'));}catch{}
  if(!request?.id||request.operatorId!==operatorId||request.id===lastId){await new Promise(r=>setTimeout(r,250));continue;}lastId=request.id;
  if(request.action==='stop')break;
  await state({phase:'running',id:lastId});
  try{
   let result;
   if(request.action==='refresh'){credentials=provider.issue();result={refreshed:true,workerTtlSeconds:900};}
   else{if(!/^[a-z0-9-]+\.mjs$/.test(request.module||''))throw Error('Invalid controlled QA module');const module=await import(pathToFileURL(path.join(dir,request.module)).href+'?v='+Date.now());result=await module.execute({credentials,runtime,args:request.args||{}});}
   const serialized=JSON.stringify({id:lastId,ok:true,result},null,2);if(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\./.test(serialized)||serialized.includes('sb_secret_'))throw Error('Credential-like output rejected');
   await fs.writeFile(path.join(dir,'result.json'),serialized);await state({phase:'ready',id:lastId});console.log('DONE '+lastId);
  }catch(e){await fs.writeFile(path.join(dir,'result.json'),JSON.stringify({id:lastId,ok:false,error:safe(e)},null,2));await state({phase:'ready',id:lastId,error:safe(e)});console.log('STOPPED COMMAND '+lastId);}
 }
}catch(e){await state({phase:'blocked',error:safe(e)});console.log('BLOCKED: '+safe(e));process.exitCode=1;}
finally{
 clearTimeout(deadlineTimer);clearInterval(stopWatcher);
 await closeOwnedRuntime();
 for(const client of runtime.clients||[])try{await client.auth.signOut({scope:'local'});}catch{}
 provider?.stop();credentials=null;runtime.sessions=null;runtime.clients=null;
 if(!process.exitCode)await state({phase:'stopped'});
 console.log('Credential references released');
}
