import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {runStagingWorker,validateWorkerCredential,validateWorkerScope,stagingProject,stagingEndpoint} from '../scripts/qa/run-b7-staging-worker.mjs';
const now=Math.floor(Date.now()/1000),trip=randomUUID(),actual=randomUUID();
const jwt=c=>`e30.${Buffer.from(JSON.stringify({role:'budget_receipt_worker',ref:stagingProject,iss:stagingEndpoint+'/auth/v1',iat:now,exp:now+600,...c})).toString('base64url')}.signature`;
const scope=()=>({project:stagingProject,tripIds:[trip],actualIds:[actual],preflightAt:new Date().toISOString(),livePreflight:{originalDataUnchanged:true,noUnscopedReceiptJobs:true}});
test('Reject service role, wrong project, stale and excessive lifetime before any network operation',async()=>{
 for(const claims of [{role:'service_role'},{ref:'production'},{iss:'untrusted'},{exp:now-1},{exp:now+3600},{iat:now+90}]){
  let called=false;await assert.rejects(runStagingWorker({token:jwt(claims),anon:'public',scope:scope(),makeClient:()=>{called=true;throw Error('network');}}));assert.equal(called,false);
 }
 assert.equal(validateWorkerCredential(jwt({})).project,stagingProject);
});
test('Out-of-scope claimed job stops before Storage or finish RPC, retains durable claim',async()=>{
 const calls=[];let storage=false;
 const makeClient=()=>({rpc:async name=>{calls.push(name);return {data:name==='sweep_budget_receipts'?0:{id:randomUUID(),token:randomUUID(),object_id:randomUUID(),path:`trips/${randomUUID()}/attachments/actual_expense/${actual}/file.png`}};},storage:{from:()=>{storage=true;throw Error('Forbidden Storage operation');}}});
 await assert.rejects(runStagingWorker({token:jwt({}),anon:'public',scope:scope(),makeClient}),/outside approved QA/);
 assert.equal(storage,false);assert.deepEqual(calls,['sweep_budget_receipts','claim_budget_receipt_verification']);
});
test('Two finite empty cycles retain dedicated Authorization and cannot certify job lifecycle',async()=>{
 const calls=[],headers=[];const makeClient=(url,anon,options)=>{assert.equal(url,stagingEndpoint);headers.push(options.global.headers);return {rpc:async name=>{calls.push(name);return {data:name==='sweep_budget_receipts'?0:null};}};};
 const token=jwt({});const r=await runStagingWorker({token,anon:'public',scope:scope(),makeClient,wait:async ms=>assert.equal(ms,15000)});
 assert.equal(r.cycles.length,2);assert.equal(r.jobLifecyclePassed,false);assert(headers.every(x=>x.Authorization===`Bearer ${token}`));assert.equal(calls.length,6);
});
test('Invalid or stale preflight and pre-existing queues reject before claim',()=>{
 for(const preflightAt of ['invalid',new Date(Date.now()-360000).toISOString(),new Date(Date.now()+90000).toISOString()])assert.throws(()=>validateWorkerScope({...scope(),preflightAt}));
 assert.throws(()=>validateWorkerScope({...scope(),livePreflight:{originalDataUnchanged:true,noUnscopedReceiptJobs:false}}));
});
