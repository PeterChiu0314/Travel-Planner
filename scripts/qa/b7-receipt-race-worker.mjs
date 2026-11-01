// One real business cleanup claim, not a rerun of the Worker platform suite.
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {createClient} from '@supabase/supabase-js';import {validateWorkerCredential} from './run-b7-staging-worker.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
export async function execute({runtime:r,credentials:c}){
 assert.equal(r.project,'uyqdopksfysbobhjcepk');validateWorkerCredential(c.worker);const x=r.cutover,state=x.receiptRace;assert(state?.newObject&&state.deleteFaultInjected);
 const pre=JSON.parse(await fs.readFile(path.join(r.root,'.tmp-b7-cutover/receipt-worker-preflight.json'),'utf8'));assert(Date.now()-Date.parse(pre.observedAt)<300000);assert.equal(pre.pending,0);assert.equal(pre.cleanup,1);assert.equal(pre.unscopedCleanup,0);
 const make=(jwt,headers={})=>createClient(r.url,c.anon,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:'Bearer '+jwt,...headers}}}),worker=make(c.worker);
 const claim=await worker.rpc('claim_budget_receipt_worker');assert.ifError(claim.error);const job=claim.data;assert(job);assert.equal(job.path,state.original.file_url);assert.equal(job.object_id,state.oldObject);assert.notEqual(job.object_id,state.newObject);
 const storage=make(c.worker,{'x-receipt-worker-job':job.id,'x-receipt-worker-token':job.token}).storage.from('trip-attachments');
 const protectedDelete=await storage.remove([state.current.file_url]);assert(protectedDelete.error||Array.isArray(protectedDelete.data)&&protectedDelete.data.length===0,'An old claim must not delete the current referenced object');
 const owner=make(x.sessions[0].access_token).storage.from('trip-attachments'),before=await owner.download(state.current.file_url);assert.ifError(before.error);assert.equal(digest(Buffer.from(await before.data.arrayBuffer())),'c33aeac20cdfb2d12b602cd65611496d0ca00a0407c782340e6df4c7bfdc52ea');
 const deleted=await storage.remove([job.path]);assert.ifError(deleted.error);assert.equal(deleted.data.length,1);const finished=await worker.rpc('finish_budget_receipt_cleanup',{p_job_id:job.id,p_token:job.token,p_error:null});assert.ifError(finished.error);assert.equal(finished.data,true);
 const after=await owner.download(state.current.file_url);assert.ifError(after.error);assert.equal(digest(Buffer.from(await after.data.arrayBuffer())),'c33aeac20cdfb2d12b602cd65611496d0ca00a0407c782340e6df4c7bfdc52ea');
 const event={id:'RECEIPT-OLD-CLAIM-NEW-OBJECT-PROTECTION',status:'Passed',at:new Date().toISOString(),dedicatedWorkerJwt:true,exactOldObjectClaim:true,oldClaimCouldNotDeleteNewReference:true,realStorageHttpCleanup:true,currentReferenceBytesAndSha256Preserved:true,samePathObjectIdReuseNotClaimed:true};r.browserProof.events.push(event);await fs.writeFile(path.join(r.dir,'browser-results.json'),JSON.stringify(r.browserProof,null,2));return event;
}
