import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lMsAAAAASUVORK5CYII=','base64'),sha=x=>createHash('sha256').update(x).digest('hex');
export async function execute({runtime:r,credentials:c,args}){
 assert.equal(r.project,'uyqdopksfysbobhjcepk');const x=r.cutover,s=r.browserProof,[a,b]=r.browserPages,id=x.retainedActual;
 const read=async()=>{const z=await fetch(r.url+`/rest/v1/attachments?target_type=eq.actual_expense&target_id=eq.${id}&select=*`,{headers:{apikey:c.anon,Authorization:'Bearer '+x.sessions[0].access_token},redirect:'error',signal:AbortSignal.timeout(8000)});assert.equal(z.status,200);return z.json();};
 const until=async fn=>{const end=Date.now()+10000;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(z=>setTimeout(z,100));}throw Error('Concurrent Receipt transition missing');};
 if(args.mode==='open'){
  for(const page of [a,b]){if(await page.getByRole('button',{name:'關閉編輯',exact:true}).count())await page.getByRole('button',{name:'關閉編輯',exact:true}).click();if(!await page.locator('.bw-row.is-selected').filter({has:page.getByRole('button',{name:s.sharedTitle,exact:true})}).count())await page.getByRole('button',{name:s.sharedTitle,exact:true}).click();await page.getByRole('tab',{name:'項目明細',exact:true}).click();await page.getByRole('region',{name:'實付收據',exact:true}).waitFor({timeout:5000});}
  assert.equal((await read()).length,0);return {bothActualReceiptViewsReady:true,emptyIsolatedTarget:true};
 }
 if(args.mode==='reset-unstarted-race'){assert(x.receiptRace&&!x.receiptRace.fileSelectionsStarted);assert.deepEqual(await read(),[x.receiptRace.original]);x.receiptRace=null;return {noUploadWasStarted:true,originalReferenceUnchanged:true};}
 if(args.mode==='prepare-cleanup-recovery'){
  const prior=x.receiptRace;assert(prior.current&&prior.newObject&&!prior.deleteFaultInjected);assert.deepEqual(await read(),[prior.current]);
  const q=JSON.parse(await fs.readFile(path.join(r.root,'.tmp-b7-final-recovery/after-replace-queues.json'),'utf8'));assert.equal(q.pending,0);assert.equal(q.cleanup,0);
  const event={id:'RECEIPT-CONCURRENT-REPLACE-OBJECT-IDENTITY',status:'Passed',at:new Date().toISOString(),twoRealAccountsConcurrent:true,oneIntentWinner:true,originalKeptUntilVerifiedCommit:true,newObjectIdentityDistinct:true,oneCanonicalReference:true,normalCleanupCompleted:true,failedFaultInjectionNotClaimed:true};s.events.push(event);
  x.receiptUi={committed:{object:prior.newObject,attachment:prior.current.id,path:prior.current.file_url,name:prior.current.file_name}};
  x.receiptConcurrentProof=prior;x.receiptRace={original:prior.current,oldObject:prior.newObject,winner:0,recoveryOnly:true};await fs.writeFile(path.join(r.dir,'browser-results.json'),JSON.stringify(s,null,2));return event;
 }
 if(args.mode==='commit-offline-recovery'){
  const state=x.receiptRace;assert(state.recoveryOnly&&x.receiptUi.verified);const page=a,context=r.browserContexts[0],region=page.getByRole('region',{name:'實付收據',exact:true}),pattern='**/rest/v1/rpc/mutate_budget_receipts';
  const handler=async route=>{const body=route.request().postDataJSON();if(body.p_id!==id||body.p_phase!=='commit')return route.continue();const response=await route.fetch({timeout:8000,maxRetries:0});assert.equal(response.status(),200);const result=await response.json();assert.equal(result.group,'receipts');await context.setOffline(true);state.deleteFaultInjected=true;await route.fulfill({response});};await page.route(pattern,handler);
  try{await region.getByRole('button',{name:'確認／重試收據操作',exact:true}).click();const rows=await until(async()=>{const z=await read();return z.length===1&&z[0].file_url===x.receiptUi.verified.path?z:null;});assert(state.deleteFaultInjected);assert.notEqual(state.oldObject,x.receiptUi.verified.object);state.current=rows[0];state.newObject=x.receiptUi.verified.object;
   await until(async()=>await region.getByRole('button',{name:'確認／重試收據操作',exact:true}).count());return {realCommitReplyDelivered:true,qaContextOfflineAfterCommit:true,newReferenceCommitted:true,cleanupRecoveryPending:true};
  }finally{await page.unroute(pattern,handler);}
 }
 if(args.mode==='recover-online'){
  const state=x.receiptRace;assert(state?.recoveryOnly&&state.current);await r.browserContexts[0].setOffline(false);const region=a.getByRole('region',{name:'實付收據',exact:true});await region.getByRole('button',{name:'確認／重試收據操作',exact:true}).click();await until(async()=>!(await region.getByRole('button',{name:'確認／重試收據操作',exact:true}).count()));assert.deepEqual(await read(),[state.current]);return {ordinaryBrowserRecoverySettled:true,sameReferenceNoDuplicate:true};
 }
 if(args.mode==='replace-race'){
  assert(!x.receiptRace,'Do not repeat potentially committed concurrent uploads');const rows=await read();assert.equal(rows.length,1);assert(x.receiptUi?.committed?.object);x.receiptRace={original:rows[0],oldObject:x.receiptUi.committed.object,startedAt:new Date().toISOString()};
  const regions=[a,b].map(p=>p.getByRole('region',{name:'實付收據',exact:true}));for(const region of regions){const input=region.getByLabel('替換 '+rows[0].file_name,{exact:true});await input.waitFor({state:'attached',timeout:5000});assert.equal(await region.locator('.attachment-row .attachment-upload').count(),1);assert(await region.locator('.attachment-row .attachment-upload').isVisible(),'Actual file chooser label must be visible');assert(await input.isEnabled());}
  // Both real file selections start together, before either admission result.
  x.receiptRace.fileSelectionsStarted=true;await Promise.all(regions.map((region,i)=>region.getByLabel('替換 '+rows[0].file_name,{exact:true}).setInputFiles({name:`QA-concurrent-${i}.png`,mimeType:'image/png',buffer:png})));
  const winner=await until(async()=>{for(let i=0;i<2;i++)if((await regions[i].innerText()).includes('等待伺服器驗證內容'))return {index:i};});x.receiptRace.winner=winner.index;
  const loser=1-winner.index;await until(async()=>{const text=await regions[loser].innerText();return text.includes('其他成員')||text.includes('正在操作收據')||text.includes('正在編輯')||text.includes('版本');});assert.deepEqual(await read(),rows,'Concurrent Begin must preserve the original reference until verified Commit');
  await fs.writeFile(path.join(r.dir,'receipt-race-scope.json'),JSON.stringify({actual:id,original:rows[0].id,oldObject:x.receiptRace.oldObject,winner:winner.index},null,2));return {twoTrueUserUploadsStartedConcurrently:true,oneWinnerWaitingVerification:true,loserRefused:true,originalReferencePreserved:true,winnerActor:winner.index};
 }
 if(args.mode==='commit-winner'){
  const state=x.receiptRace;assert(state&&x.receiptUi.verified);const page=r.browserPages[state.winner],region=page.getByRole('region',{name:'實付收據',exact:true});
  const pattern='**/storage/v1/object/trip-attachments',handler=async route=>{const request=route.request(),body=request.postDataJSON();if(request.method()==='DELETE'&&body?.prefixes?.includes(state.original.file_url)&&!state.deleteFaultInjected){state.deleteFaultInjected=true;return route.abort('failed');}return route.continue();};
  await page.route(pattern,handler);
  try{await region.getByRole('button',{name:'確認／重試收據操作',exact:true}).click();
  const rows=await until(async()=>{const v=await read();return v.length===1&&v[0].file_url===x.receiptUi.verified.path?v:null;});assert.notEqual(rows[0].id,state.original.id);assert.notEqual(x.receiptUi.verified.object,state.oldObject);state.current=rows[0];state.newObject=x.receiptUi.verified.object;
  await until(async()=>!(await region.getByRole('button',{name:'確認／重試收據操作',exact:true}).count()));assert(state.deleteFaultInjected,'Inject a real network failure for this exact old object only');
  const event={id:'RECEIPT-CONCURRENT-REPLACE-OBJECT-IDENTITY',status:'Passed',at:new Date().toISOString(),twoRealAccountsConcurrent:true,oneIntentWinner:true,originalKeptUntilVerifiedCommit:true,newObjectIdentityDistinct:true,oneCanonicalReference:true,oldObjectHash:sha(state.oldObject),newObjectHash:sha(state.newObject),cleanupNetworkFailureInjected:true,cleanupIdentityCheckPending:true};s.events.push(event);await fs.writeFile(path.join(r.dir,'browser-results.json'),JSON.stringify(s,null,2));return event;
  }finally{await page.unroute(pattern,handler);}
 }
 throw Error('Unsupported Receipt concurrency case');
}
