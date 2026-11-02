// Fixed Production RAM-only capability probe. Does not activate or schedule.
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createProductionCredentialProvider,productionCredentialProject as project} from './production-worker-credentials.mjs';
const root=fileURLToPath(new URL('../..',import.meta.url)),dir=path.join(root,'.tmp-b7-production-live'),operatorId=randomUUID();
if(!process.argv.includes('--private-stdin'))throw Error('Use the masked input launcher');
const minutes=Number(process.argv.find(x=>x.startsWith('--max-minutes='))?.split('=')[1]||60);
if(!Number.isInteger(minutes)||minutes<5||minutes>180)throw Error('Finite RAM window required');
await fs.mkdir(dir,{recursive:true});
const state=extra=>fs.writeFile(path.join(dir,'status.json'),JSON.stringify({operatorId,project,credentialsSaved:false,...extra}));
const input=()=>new Promise((resolve,reject)=>{const r=readline.createInterface({input:process.stdin});let got=false;r.once('line',line=>{got=true;try{resolve(JSON.parse(line));}catch{reject(Error('Private input invalid'));}r.close();});r.once('close',()=>{if(!got)reject(Error('Private input missing'));});});
let provider,credentials,timer,stopped=false;
const url=`https://${project}.supabase.co`;
try{
 const x=await input();provider=createProductionCredentialProvider({admin:x.admin,anon:x.legacyAnon,secret:Buffer.from(x.signingSecret||'','utf8')});
 x.admin=null;x.signingSecret=null;x.legacyAnon=null;credentials=provider.issue();
 const health=await fetch(url+'/auth/v1/health',{redirect:'error',headers:{apikey:credentials.anon},signal:AbortSignal.timeout(10000)});
 if(health.status!==200)throw Error('Production public credential rejected');
 timer=setTimeout(()=>{stopped=true;provider?.stop();credentials=null;},minutes*60000);timer.unref();
 await state({phase:'ready',healthStatus:200,workerTtlSeconds:900,readinessChanged:false});
 console.log('READY: Production identity checked; memory only; no activation');
 let lastId='';
 while(!stopped){
  let job;try{job=JSON.parse(await fs.readFile(path.join(dir,'request.json'),'utf8'));}catch{}
  if(!job?.id||job.operatorId!==operatorId||job.id===lastId){await new Promise(r=>setTimeout(r,300));continue;}
  lastId=job.id;if(job.action==='stop')break;
  await state({phase:'running',id:lastId});
  let result;
  if(job.action==='worker-empty-claim'){
   credentials=provider.issue();
   const claims=JSON.parse(Buffer.from(credentials.worker.split('.')[1],'base64url'));
   const r=await fetch(url+'/rest/v1/rpc/claim_budget_receipt_worker',{method:'POST',redirect:'error',headers:{apikey:credentials.anon,Authorization:'Bearer '+credentials.worker,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});
   const body=await r.json().catch(()=>null);
   const empty=body===null||Array.isArray(body)&&body.length===0;
   result={httpStatus:r.status,empty,workerRole:claims.role,workerRef:claims.ref,ttlSeconds:claims.exp-claims.iat,usesServiceRoleAsWorker:false,scope:'empty claim capability only; not content cleanup readiness',readinessChanged:false};
   if(r.status!==200||!empty){await state({phase:'blocked',id:lastId,reason:'unexpected-worker-claim-result'});await fs.writeFile(path.join(dir,'result.json'),JSON.stringify({id:lastId,ok:false,result}));break;}
  }else{await state({phase:'blocked',id:lastId,reason:'unsupported-fixed-command'});break;}
  await fs.writeFile(path.join(dir,'result.json'),JSON.stringify({id:lastId,ok:true,result}));
  await state({phase:'ready',id:lastId});console.log('DONE: fixed capability command');
 }
}catch(error){
 const known=new Map([
  ['Invalid Production credential format','credential-format'],
  ['Production project role or expiry rejected','credential-project-role-or-expiry'],
  ['Production signature rejected','credential-signature'],
  ['In-memory signing Buffer required','signing-secret-missing'],
  ['Production public credential rejected','public-key-health-rejected'],
  ['fetch failed','transport']
 ]);
 await state({phase:'blocked',reason:known.get(error.message)||'credential-or-transport-check-failed'});
 console.log('BLOCKED: Production capability check failed');process.exitCode=1;
}finally{
 clearTimeout(timer);provider?.stop();credentials=null;
 if(!process.exitCode)await state({phase:'stopped'});
}
