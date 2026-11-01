import {createClient} from '@supabase/supabase-js';import {verifyReceiptBytes} from '../maintenance/budget-receipt-content.mjs';import {reconcileBudgetReceipts} from '../maintenance/budget-receipt-cleanup.mjs';import {createHash} from 'node:crypto';import readline from 'node:readline';import assert from 'node:assert/strict';
const line=await new Promise(resolve=>readline.createInterface({input:process.stdin}).once('line',resolve)),x=JSON.parse(line);const sha=s=>createHash('sha256').update(s).digest('hex');
assert(['crash','resume','cleanup-crash','cleanup-resume'].includes(x.mode),'Known finite QA child mode required');
const claim=JSON.parse(Buffer.from(x.worker.split('.')[1],'base64url'));assert.equal(claim.role,'budget_receipt_worker');assert.equal(claim.ref,'uyqdopksfysbobhjcepk');assert(claim.exp-claim.iat<=900);
const make=h=>createClient('https://uyqdopksfysbobhjcepk.supabase.co',x.anon,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:'Bearer '+x.worker,...h}}}),base=make({});
const scoped=job=>{assert(x.objects.some(o=>o.path===job.path),'Exact QA object allowlist');assert(job.id&&job.token&&job.object_id);return make({'x-receipt-worker-job':job.id,'x-receipt-worker-token':job.token}).storage.from('trip-attachments');};
const rpc=async(n,a)=>{const z=await base.rpc(n,a);if(z.error)throw Error(n+':'+z.error.code);return z.data;};
const emit=z=>process.stdout.write(JSON.stringify(z)+'\n');
try{
 if(x.mode==='cleanup-crash'){
  const job=await rpc('claim_budget_receipt_worker');assert(job.path.endsWith('/retry-cleanup.png'));scoped(job);
  const bad=await base.rpc('finish_budget_receipt_cleanup',{p_job_id:job.id,p_token:'00000000-0000-0000-0000-000000000000',p_error:null});assert.equal(bad.error?.code,'42501');
  assert.equal(await rpc('finish_budget_receipt_cleanup',{p_job_id:job.id,p_token:job.token,p_error:'Controlled QA cleanup transport failure; retry must persist'}),false);emit({phase:'cleanup-retry-persisted',wrongTokenDenied:true,job:sha(job.id)});process.exit(42);
 }
 if(x.mode==='crash'){
  const valid=await rpc('claim_budget_receipt_verification');assert(valid.path.endsWith('/valid.png'));const good=scoped(valid);
  for(const client of [base.storage.from('trip-attachments'),make({'x-receipt-worker-job':valid.id,'x-receipt-worker-token':'00000000-0000-0000-0000-000000000000'}).storage.from('trip-attachments')]){const d=await client.download(valid.path);assert(d.error,'No/wrong claim headers must deny bytes');}
  const d=await good.download(valid.path);assert.ifError(d.error);const proof=verifyReceiptBytes(await d.data.arrayBuffer(),valid);assert.equal(await rpc('finish_budget_receipt_verification',{p_job_id:valid.id,p_token:valid.token,p_object_id:valid.object_id,p_digest:proof.digest,p_size:proof.size,p_type:proof.type,p_error:null}),true);emit({phase:'verify',content:true,headersNegative:true,job:sha(valid.id)});
  const retry=await rpc('claim_budget_receipt_verification');assert(retry.path.endsWith('/retry.png'));assert.equal(await rpc('finish_budget_receipt_verification',{p_job_id:retry.id,p_token:retry.token,p_object_id:retry.object_id,p_digest:null,p_size:null,p_type:null,p_error:'Controlled QA transport failure; durable retry expected'}),false);emit({phase:'retry-persisted',job:sha(retry.id)});
  const crash=await rpc('claim_budget_receipt_verification');assert(crash.path.endsWith('/crash.png'));emit({phase:'crash-after-claim',job:sha(crash.id)});process.exit(42);
 }
 const cycles=x.mode==='cleanup-resume'?2:8,interval=x.mode==='cleanup-resume'?15000:20000;
 for(let cycle=1;cycle<=cycles;cycle++){
  const res=await reconcileBudgetReceipts(base,{limit:10,timeoutMs:10000,storageForJob:scoped});emit({phase:'cycle',cycle,at:new Date().toISOString(),verified:res.filter(z=>z.phase==='verify'&&z.done).length,cleaned:res.filter(z=>!z.phase&&z.done).length,failed:res.filter(z=>!z.done).length});assert(res.every(z=>z.done),'Worker failure must stop');if(cycle<cycles)await new Promise(r=>setTimeout(r,interval));
 }
 process.exit(0);
}catch(e){emit({phase:'failed',error:String(e.message).replace(/eyJ[A-Za-z0-9_.-]+/g,'[redacted]')});process.exit(1);}
