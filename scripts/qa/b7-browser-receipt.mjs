// Actual application receipt lifecycle; user JWT UI and a dedicated finite Worker.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {verifyReceiptBytes} from '../maintenance/budget-receipt-content.mjs';
import {validateWorkerCredential} from './run-b7-staging-worker.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lMsAAAAASUVORK5CYII=','base64');
export async function execute({credentials:c,runtime:r,args}){
 assert.equal(r.project,'uyqdopksfysbobhjcepk');const x=r.cutover,s=r.browserProof,[a,b]=r.browserPages,id=x.retainedActual;assert(id&&s.retainedActual===id);
 const active=JSON.parse(await fs.readFile(path.join(r.root,'.tmp-b7-cutover/activated.json'),'utf8'));assert(Object.values(active.protocols).every(z=>z.enabled));assert(Date.now()-Date.parse(active.observedAt)<15*60000);
 const read=async()=>{const res=await fetch(r.url+`/rest/v1/attachments?target_type=eq.actual_expense&target_id=eq.${id}&select=*`,{headers:{apikey:c.anon,Authorization:'Bearer '+x.sessions[0].access_token},redirect:'error',signal:AbortSignal.timeout(10000)});assert.equal(res.status,200);return res.json();};
 const save=()=>fs.writeFile(path.join(r.dir,'browser-results.json'),JSON.stringify(s,null,2));
 const until=async fn=>{const end=Date.now()+12000;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(z=>setTimeout(z,100));}throw Error('Receipt UI/HTTP transition missing');};
 const region=a.getByRole('region',{name:'實付收據',exact:true});
 if(args.mode==='upload'||args.mode==='replace'){
  const before=await read();if(args.mode==='upload')assert.equal(before.length,0);else assert.equal(before.length,1);
  const name=args.mode==='upload'?'QA-b7-receipt.png':'QA-b7-replacement.png';
  const input=args.mode==='upload'?region.locator('input[type=file]').first():region.getByLabel('替換 '+before[0].file_name,{exact:true});
  assert(await input.isEnabled());x.receiptUi??={};assert(!x.receiptUi[args.mode],'Never repeat a potentially committed upload/replace');x.receiptUi[args.mode]={before:before.map(z=>({id:z.id,path:z.file_url})),name};
  await input.setInputFiles({name,mimeType:'image/png',buffer:png});
  await region.getByRole('button',{name:'確認／重試收據操作',exact:true}).waitFor({timeout:12000});
  const text=await region.innerText();assert(text.includes('等待伺服器驗證內容'));assert.deepEqual((await read()).map(z=>z.id),before.map(z=>z.id),'Before verified commit the original attachment set must remain');
  s.events.push({id:'BROWSER-RECEIPT-'+args.mode.toUpperCase()+'-BEGIN',status:'Passed',at:new Date().toISOString(),bytes:png.length,sha256:sha(png),originalMetadataPreserved:true,ordinaryBrowserUpload:true});await save();return s.events.at(-1);
 }
 if(args.mode==='verify'){
  validateWorkerCredential(c.worker);const proof=JSON.parse(await fs.readFile(path.join(r.root,'.tmp-b7-cutover/receipt-worker-preflight.json'),'utf8'));assert(Date.now()-Date.parse(proof.observedAt)<300000);assert.equal(proof.unscopedPending,0);assert.equal(proof.pending,1);
  const make=headers=>createClient(r.url,c.anon,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:'Bearer '+c.worker,...headers}}});const worker=make({});
  const claim=await worker.rpc('claim_budget_receipt_verification');assert.ifError(claim.error);const job=claim.data;assert(job&&job.path.startsWith(`trips/${x.trips[0]}/attachments/actual_expense/${id}/`));assert(job.object_id&&job.token);
  const storage=make({'x-receipt-worker-job':job.id,'x-receipt-worker-token':job.token}).storage.from('trip-attachments');const bytes=await storage.download(job.path);assert.ifError(bytes.error);const content=verifyReceiptBytes(await bytes.data.arrayBuffer(),job);assert.equal(content.digest,sha(png));assert.equal(content.size,png.length);
  const done=await worker.rpc('finish_budget_receipt_verification',{p_job_id:job.id,p_token:job.token,p_object_id:job.object_id,p_digest:content.digest,p_size:content.size,p_type:content.type,p_error:null});assert.ifError(done.error);assert.equal(done.data,true);
  if(x.receiptUi.committed)assert.notEqual(job.object_id,x.receiptUi.committed.object,'Replacement must have a distinct actual Storage identity');x.receiptUi.verified={request:job.id,path:job.path,object:job.object_id};s.events.push({id:'RECEIPT-BUSINESS-WORKER-VERIFY',status:'Passed',at:new Date().toISOString(),dedicatedRole:true,exactClaimHeaders:true,objectHash:sha(job.object_id),bytes:content.size,sha256:content.digest});await save();return s.events.at(-1);
 }
 if(args.mode==='commit'){
  const verified=x.receiptUi.verified;assert(verified);await region.getByRole('button',{name:'確認／重試收據操作',exact:true}).click();
  const rows=await until(async()=>{const z=await read();return z.length===1&&z[0].file_url===verified.path?z:null;});assert.equal(rows[0].file_size,png.length);
  await until(async()=>!(await region.getByRole('button',{name:'確認／重試收據操作',exact:true}).count()));
  x.receiptUi.committed={...verified,attachment:rows[0].id,name:rows[0].file_name};s.events.push({id:'BROWSER-RECEIPT-COMMIT',status:'Passed',at:new Date().toISOString(),attachmentHash:sha(rows[0].id),objectHash:sha(verified.object),sameVerifiedPath:true,oneAttachment:true});await save();return s.events.at(-1);
 }
 if(args.mode==='read'){
  const rows=await read();assert.equal(rows.length,1);const signed=await fetch(r.url+'/storage/v1/object/sign/trip-attachments/'+rows[0].file_url,{method:'POST',headers:{apikey:c.anon,Authorization:'Bearer '+x.sessions[1].access_token,'Content-Type':'application/json'},body:JSON.stringify({expiresIn:60}),redirect:'error',signal:AbortSignal.timeout(10000)});assert.equal(signed.status,200);const d=await signed.json(),url=new URL('/storage/v1'+(d.signedURL||d.signedUrl),r.url);assert.equal(url.hostname,r.project+'.supabase.co');const bytes=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(10000)});assert.equal(bytes.status,200);const data=Buffer.from(await bytes.arrayBuffer());assert.equal(sha(data),sha(png));assert.equal(data.length,png.length);assert.equal(bytes.headers.get('content-type')?.split(';')[0],'image/png');
  s.events.push({id:'RECEIPT-BUSINESS-PEER-SIGNED-READ',status:'Passed',at:new Date().toISOString(),ordinaryPeerJwt:true,privateSignedUrl:true,bytes:data.length,sha256:sha(data)});await save();return s.events.at(-1);
 }
 if(args.mode==='delete'){
  assert(!x.receiptUi.deleteStarted);const before=await read();assert.equal(before.length,1);x.receiptUi.deleteStarted=true;await region.getByRole('button',{name:'X',exact:true}).click();await until(async()=>(await read()).length===0);
  await until(async()=>!(await region.getByRole('button',{name:'確認／重試收據操作',exact:true}).count()));
  const retained=await fetch(r.url+`/rest/v1/actual_expenses?id=eq.${id}&select=id,payment_active,twd_amount`,{headers:{apikey:c.anon,Authorization:'Bearer '+x.sessions[0].access_token},signal:AbortSignal.timeout(10000)});assert.equal(retained.status,200);const actual=await retained.json();assert.equal(actual.length,1);assert(actual[0].payment_active);assert.equal(Number(actual[0].twd_amount),300);
  s.events.push({id:'BROWSER-RECEIPT-DELETE',status:'Passed',at:new Date().toISOString(),ordinaryBrowserJwt:true,logicalReceiptRemoved:true,paymentHistoryRetained:true});await save();return s.events.at(-1);
 }
 if(args.mode==='inspect'){return {metadata:await read(),a:await a.locator('body').innerText(),b:await b.locator('body').innerText()};}
 throw Error('Unsupported receipt case');
}
