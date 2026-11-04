import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ok} from './staging-budget-acceptance-http.mjs';
import {endpoint,sha} from './staging-budget-acceptance-scope.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lMsAAAAASUVORK5CYII=','base64');
export async function storageCases(r){
 const {check,http,trip,sessions,api}=r,token=sessions[0].access_token;
 await check('D01',async()=>{
  const attachment={id:randomUUID(),trip_id:trip,target_type:'budget_item',target_id:r.budget,file_name:'QA forbidden receipt.png',file_url:`trips/${trip}/attachments/budget_item/${r.budget}/${r.run}.png`,file_type:'image/png',file_size:png.length,uploaded_by:sessions[0].user.id};
  r.objects.push(attachment.file_url);await r.savePrivate();
  const before=await api.graph();const metadata=await http(token,'/rest/v1/attachments',{method:'POST',body:attachment});assert.equal(metadata.data?.code,'55000');assert.equal(metadata.status,400);
  const upload=await http(token,`/storage/v1/object/trip-attachments/${attachment.file_url}`,{method:'POST',body:png,raw:true});assert(upload.status>=400);assert(/row.level|policy|unauthoriz|403/i.test(JSON.stringify(upload.data)),'Upload must reject by access policy, not malformed path or MIME');assert.deepEqual(await api.graph(),before);r.objects=r.objects.filter(p=>p!==attachment.file_url);await r.savePrivate();return {metadataGuard:true,realUploadPolicyRefusal:true};
 });
 await check('D04',async()=>{
  const accommodation=randomUUID(),attachment=randomUUID(),path=`trips/${trip}/attachments/accommodation/${accommodation}/${r.run}.png`;
  ok(await http(token,'/rest/v1/accommodations',{method:'POST',body:{id:accommodation,trip_id:trip,name:`QA attachment ${r.run}`,check_in_date:'2099-01-01',check_out_date:'2099-01-02'}}));
  r.objects.push(path);await r.savePrivate();
  ok(await http(token,`/storage/v1/object/trip-attachments/${path}`,{method:'POST',raw:true,body:png}));
  ok(await http(token,'/rest/v1/attachments',{method:'POST',body:{id:attachment,trip_id:trip,target_type:'accommodation',target_id:accommodation,file_name:'QA pixel.png',file_url:path,file_type:'image/png',file_size:png.length,uploaded_by:sessions[0].user.id}}));
  const sign=ok(await http(token,`/storage/v1/object/sign/trip-attachments/${path}`,{method:'POST',body:{expiresIn:60}}));
  const signed=sign.signedURL||sign.signedUrl;assert.equal(typeof signed,'string');const url=new URL(signed.startsWith('/storage/v1/')?signed:`/storage/v1${signed.startsWith('/')?'':'/'}${signed}`,endpoint);assert.equal(url.origin,endpoint);assert.equal(url.pathname,`/storage/v1/object/sign/trip-attachments/${path}`);
  const bytes=await http(null,url.pathname+url.search);assert.equal(bytes.status,200);assert.equal(sha(bytes.bytes.toString('base64')),sha(png.toString('base64')));
  ok(await http(token,`/rest/v1/attachments?id=eq.${attachment}`,{method:'DELETE'}));
  const removed=ok(await http(token,'/storage/v1/object/trip-attachments',{method:'DELETE',body:{prefixes:[path]}}));assert(removed.some(v=>v.name===path));r.objects=r.objects.filter(x=>x!==path);await r.savePrivate();
  const absent=await http(token,`/storage/v1/object/authenticated/trip-attachments/${path}`);assert(absent.status>=400);return {exactBytesMatched:true,normalMetadataAndStorageCleanup:true};
 });
 // A pre-removal capability cannot be recreated after removal. Never claim a
 // missing-object response or a newly signed nonfinancial URL proves revocation.
 if(r.input.protectedReceiptPath){
  const p=r.input.protectedReceiptPath;assert(r.before.installation.receiptPathHashes.includes(sha(p)),'Exact existing receipt metadata path required');assert(p.startsWith('trips/')&&!p.includes('..'));
  const visible=ok(await http(token,`/rest/v1/trips?id=eq.${p.split('/')[1]}&select=id`));
  if(visible.length===1)await check('D02',async()=>{const signed=await http(token,`/storage/v1/object/sign/trip-attachments/${p}`,{method:'POST',body:{expiresIn:60}});assert(signed.status>=400);assert(/policy|unauthoriz|not.found|404|403/i.test(JSON.stringify(signed.data)));return {knownExistingCatalogPath:true,ordinaryMemberReadConfirmed:true,signRejected:true};});
  else r.block('D02','Existing receipt trip is not visible to the approved QA identity; nonmember refusal cannot prove receipt removal');
 }
 else r.block('D02','Requires exact protected existing receipt path matched to captured catalog hash; nonexistent-path404 is insufficient');
 if(!r.input.legacySignedUrl){r.block('D03','No pre-removal signed URL retained; cannot recreate historical capability');return;}
 await check('D03',async()=>{
  const url=new URL(r.input.legacySignedUrl);assert.equal(url.origin,endpoint);assert(url.pathname.startsWith('/storage/v1/object/sign/trip-attachments/'));
  const historicalPath=decodeURIComponent(url.pathname.slice('/storage/v1/object/sign/trip-attachments/'.length));assert(r.before.installation.receiptPathHashes.includes(sha(historicalPath)),'Historical capability must identify the exact protected financial receipt');
  const exp=Number(r.input.legacySignedUrlExpiresAt);assert(Number.isFinite(exp));const remaining=exp*1000-Date.now();assert(remaining>0&&remaining<=120000,'Provide an unexpired URL with at most120s remaining for a bounded genuine-expiry test');
  const before=await http(null,url.pathname+url.search);assert.equal(before.status,200,'A denied or expired initial URL is not proof of pre/post-expiry access');
  await new Promise(resolve=>setTimeout(resolve,remaining+2000));const after=await http(null,url.pathname+url.search);assert(after.status>=400);assert(/expir/i.test(JSON.stringify(after.data)),'Must reject due to actual expiry');return {realBefore200:true,realExpiryRefusal:true,bytesNotPersisted:true};
 });
}
