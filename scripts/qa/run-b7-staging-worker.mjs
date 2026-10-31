// Explicit, finite Staging QA adapter. Does not sign credentials or change flags.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {reconcileBudgetReceipts} from '../maintenance/budget-receipt-cleanup.mjs';

export const stagingProject='uyqdopksfysbobhjcepk';
export const stagingEndpoint=`https://${stagingProject}.supabase.co`;
export function validateWorkerCredential(token,now=Math.floor(Date.now()/1000)){
 let c;try{const pieces=token.split('.');if(pieces.length!==3||!pieces[2])throw Error();c=JSON.parse(Buffer.from(pieces[1],'base64url').toString());}catch{throw Error('Dedicated short-lived Staging Worker credential required');}
 if(c.role!=='budget_receipt_worker'||c.ref!==stagingProject||c.iss!==`${stagingEndpoint}/auth/v1`
  ||!Number.isInteger(c.iat)||!Number.isInteger(c.exp)||c.exp<=now+45||c.iat>now+30||c.exp-c.iat>900||c.iat<now-900)throw Error('Worker role/project/issuer/short expiry validation failed');
 // Claim checks are local admission only. Actual JWT signature trust is checked by Supabase.
 return {role:c.role,expiresAt:c.exp,project:c.ref};
}
export function validateWorkerScope(scope){
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
 const stamp=Date.parse(scope?.preflightAt);
 if(scope?.project!==stagingProject||!scope.livePreflight?.originalDataUnchanged||!scope.livePreflight?.noUnscopedReceiptJobs
  ||!scope.tripIds?.length||!scope.actualIds?.length||![...scope.tripIds,...scope.actualIds].every(x=>uuid.test(x))
  ||!Number.isFinite(stamp)||Date.now()-stamp>300000||stamp>Date.now()+30000)throw Error('Fresh Staging QA scope and no unscoped receipt jobs required');
 return scope;
}
export function assertWorkerJob(job,scope){
 const m=/^trips\/([^/]+)\/attachments\/actual_expense\/([^/]+)\/(.+)$/.exec(job?.path||'');
 if(!m||!scope.tripIds.includes(m[1])||!scope.actualIds.includes(m[2])||!job.id||!job.token||!job.object_id)throw Error('Claim outside approved QA graph; stop and retain durable claim without Storage access');
}
export async function runStagingWorker({token,anon,scope,cycles=2,intervalMs=15000,makeClient=createClient,wait=ms=>new Promise(r=>setTimeout(r,ms)),onCycle=()=>{}}){
 const identity=validateWorkerCredential(token);validateWorkerScope(scope);
 if(!Number.isInteger(cycles)||cycles<2||cycles>8||intervalMs<15000||intervalMs>60000)throw Error('Finite QA schedule required (2–8 cycles, 15–60 seconds)');
 const client=headers=>makeClient(stagingEndpoint,anon,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:`Bearer ${token}`,...headers}}});
 const transport=client({}),out=[];
 const api={rpc:async(name,args)=>{const r=await transport.rpc(name,args);if(!r.error&&r.data&&['claim_budget_receipt_verification','claim_budget_receipt_worker'].includes(name))assertWorkerJob(r.data,scope);return r;}};
 for(let cycle=1;cycle<=cycles;cycle++){
  validateWorkerCredential(token);
  // Sweep runs globally: fresh proof of no jobs outside this QA scope is mandatory.
  // Existing scoped jobs may survive a restart. Check every claim before bytes I/O.
  const rows=await reconcileBudgetReceipts(api,{limit:20,timeoutMs:10000,storageForJob:job=>{
   assertWorkerJob(job,scope);
   const storage=client({'x-receipt-worker-job':job.id,'x-receipt-worker-token':job.token}).storage.from('trip-attachments');
   return {download:p=>{if(p!==job.path)throw Error('Exact claimed object required');return storage.download(p);},remove:ps=>{if(ps.length!==1||ps[0]!==job.path)throw Error('Exact claimed object required');return storage.remove(ps);}};
  }});
  const result={cycle,jobs:rows.length,verified:rows.filter(x=>x.phase==='verify'&&x.done).length,cleaned:rows.filter(x=>!x.phase&&x.done).length,failed:rows.filter(x=>!x.done).length};
  out.push(result);await onCycle(result);
  if(result.failed)throw Error('QA Worker job failed; stop, retain durable retry state, inspect before restart');
  if(cycle<cycles)await wait(intervalMs);
 }
 return {project:identity.project,cycles:out,realHttp:true,signatureVerifiedByService:true,jobLifecyclePassed:out.some(x=>x.verified)&&out.some(x=>x.cleaned),note:'Empty cycles prove RPC capability only, never claim/cleanup/retry/receipt lifecycle acceptance'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(!process.argv.includes('--authorized-staging-qa'))throw Error('Explicit Staging QA execution required');
 const token=process.env.STAGING_RECEIPT_WORKER_JWT,anon=process.env.STAGING_PUBLIC_API_KEY,scopeFile=process.env.STAGING_RECEIPT_QA_SCOPE;
 if(!token||!anon||!scopeFile)throw Error('BLOCKED: supply dedicated Staging Worker JWT, public API key and fresh protected QA scope via process environment');
 const scope=JSON.parse(await fs.readFile(scopeFile,'utf8'));const proof=await runStagingWorker({token,anon,scope,onCycle:x=>console.log(JSON.stringify(x))});
 const dir=path.resolve('.tmp-b7-closeout');await fs.mkdir(dir,{recursive:true});
 proof.credentialSha256=createHash('sha256').update(token).digest('hex');
 await fs.writeFile(path.join(dir,'worker-result.json'),JSON.stringify(proof,null,2));
}
