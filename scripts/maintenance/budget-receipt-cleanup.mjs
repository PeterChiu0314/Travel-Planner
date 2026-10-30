// Trusted server-side runner. Inject a service-role client outside the browser;
// importing this module never reads keys, writes Storage SQL, or deploys a schedule.
export async function reconcileBudgetReceipts(client,{limit=50,timeoutMs=10000}={}){
 const bounded=async work=>{let timer;try{return await Promise.race([Promise.resolve(work),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Receipt worker transport timeout; durable claim retained.')),timeoutMs);})]);}finally{clearTimeout(timer);}};
 const sweep=await bounded(client.rpc('sweep_budget_receipts'));if(sweep.error)throw sweep.error;
 const outcomes=[];
 for(let n=0;n<Math.min(limit,500);n++){
  const claim=await bounded(client.rpc('claim_budget_receipt_worker'));if(claim.error)throw claim.error;if(!claim.data)break;const job=claim.data;let error=null;
  try{const r=await bounded(client.storage.from('trip-attachments').remove([job.path]));error=r.error?.message||null;}catch(e){error=e.message;}
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
 const key=process.env.RECEIPT_LOCAL_SERVICE_ROLE_KEY;if(!key)throw new Error('A local-runtime service-role key is required; never use a Hosted key.');
 const {createClient}=await import('@supabase/supabase-js'),client=createClient(endpoint.href,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 do{console.log(JSON.stringify(await reconcileBudgetReceipts(client)));if(!process.argv.includes('--watch'))break;await new Promise(resolve=>setTimeout(resolve,15000));}while(true);
}
