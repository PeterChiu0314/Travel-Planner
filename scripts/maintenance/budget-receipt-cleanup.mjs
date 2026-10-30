import {verifyReceiptBytes} from './budget-receipt-content.mjs';
// Dedicated NOBYPASSRLS role; Storage is scoped to each exact durable claim.
export async function reconcileBudgetReceipts(client,{limit=50,timeoutMs=10000,storageForJob}={}){
 if(typeof storageForJob!=='function')throw Error('Claim-scoped Storage client required');
 if(!Number.isInteger(limit)||limit<1||limit>500||!Number.isFinite(timeoutMs)||timeoutMs<1)throw Error('Invalid worker limits');
 const bounded=async work=>{let timer;try{return await Promise.race([Promise.resolve(work),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Receipt worker transport timeout; durable claim retained.')),timeoutMs);})]);}finally{clearTimeout(timer);}};
 const sweep=await bounded(client.rpc('sweep_budget_receipts'));if(sweep.error)throw sweep.error;
 const outcomes=[];
 for(let n=0;n<limit;n++){
  const claim=await bounded(client.rpc('claim_budget_receipt_verification'));if(claim.error)throw claim.error;if(!claim.data)break;const job=claim.data;
  let error=null,proof={digest:null,size:null,type:null};
  try{const storage=await storageForJob(job),r=await bounded(storage.download(job.path));if(r.error)throw r.error;proof=verifyReceiptBytes(await r.data.arrayBuffer(),job);}catch(e){error=e.message;}
  try{const r=await bounded(client.rpc('finish_budget_receipt_verification',{p_job_id:job.id,p_token:job.token,p_object_id:job.object_id,p_digest:proof.digest,p_size:proof.size,p_type:proof.type,p_error:error}));outcomes.push({id:job.id,phase:'verify',done:r.data===true,error:r.error?.message||error});if(r.error)break;}catch(e){outcomes.push({id:job.id,phase:'verify',done:false,error:e.message});break;}
 }
 for(let n=0;n<Math.min(limit,500);n++){
  const claim=await bounded(client.rpc('claim_budget_receipt_worker'));if(claim.error)throw claim.error;if(!claim.data)break;const job=claim.data;let error=null;
  try{const storage=await storageForJob(job),r=await bounded(storage.remove([job.path]));error=r.error?.message||null;}catch(e){error=e.message;}
  let finish;try{finish=await bounded(client.rpc('finish_budget_receipt_cleanup',{p_job_id:job.id,p_token:job.token,p_error:error}));}catch(e){finish={error:{message:e.message}};}outcomes.push({id:job.id,done:finish.data===true,error:finish.error?.message||error});
  // A persistent failure waits for a later run, never spins on one broken object.
  if(error||finish.error||!finish.data)break;
 }
 return outcomes;
}

// Explicit isolated-local CLI only. Production scheduling/credentials and the
// activation acknowledgement require a separate authorized deployment.
if(process.argv[1]&&import.meta.url===(await import('node:url')).pathToFileURL(process.argv[1]).href){
 if(!process.argv.includes('--local'))throw new Error('Use --local with an isolated Storage runtime; Hosted execution is not enabled.');
 const endpoint=new URL(process.env.RECEIPT_LOCAL_URL||'');if(endpoint.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname))throw new Error('Only isolated loopback Storage is accepted.');
 const jwt=process.env.RECEIPT_LOCAL_WORKER_JWT,anon=process.env.RECEIPT_LOCAL_ANON_KEY;
 if(!jwt||!anon||JSON.parse(Buffer.from(jwt.split('.')[1]||'','base64url')).role!=='budget_receipt_worker')throw Error('Dedicated isolated worker JWT and public anon key required');
 const {createClient}=await import('@supabase/supabase-js'),make=headers=>createClient(endpoint.href,anon,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:`Bearer ${jwt}`,...headers}}}),client=make({});
 const storageForJob=job=>make({'x-receipt-worker-job':job.id,'x-receipt-worker-token':job.token}).storage.from('trip-attachments');
 do{console.log(JSON.stringify(await reconcileBudgetReceipts(client,{storageForJob})));if(!process.argv.includes('--watch'))break;await new Promise(resolve=>setTimeout(resolve,15000));}while(true);
}
