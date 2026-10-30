import {test} from 'node:test';
import assert from 'node:assert/strict';
import {persistBudgetWorkspace} from '../src/lib/budgetWorkspaceService.js';
import {isBudgetConflict} from '../src/lib/budgetErrors.js';
import {mutateLuggageItem} from '../src/lib/luggageService.js';

for(const code of ['PT409','40001','40P01'])test(`${code} preserves the failed request and performs only an authoritative reload`,async()=>{
 const calls=[];let reads=0;const payload={title:'Unsaved draft'},meta={operationId:'original-request',baseUpdatedAt:'old'};
 const result=await persistBudgetWorkspace({tripId:'trip',reload:async()=>{reads++;return {ok:true};},supabase:{rpc:async(name,args)=>{calls.push({name,args});return {error:{code,message:'Record changed'}};}}},'budget',payload,'row',meta);
 assert.equal(result.ok,false);assert.equal(result.conflict,true);assert.equal(calls.length,1);assert.equal(reads,1);assert.equal(calls[0].args.p_request_id,'original-request');assert.equal(payload.title,'Unsaved draft');
});
test('conflict remains a failure when reconciliation is offline',async()=>{
 const r=await persistBudgetWorkspace({tripId:'trip',reload:async()=>{throw Error('offline');},supabase:{rpc:async()=>({error:{code:'PT409',message:'Record changed'}})}},'budget',{title:'draft'},'row');assert.equal(r.ok,false);assert.equal(r.conflict,true);
});
test('authorization and network errors are not treated as version conflicts',()=>{
 for(const code of ['42501','METADATA_TIMEOUT',undefined])assert.equal(isBudgetConflict({code}),false);
});
test('luggage retains stale-draft classification with the non-retrying transport code',async()=>{
 let writes=0;const r=await mutateLuggageItem({tripId:'trip',scope:'personal',action:'patch',itemId:'row',payload:{title:'Draft'},client:{rpc:async()=>{writes++;return {error:{code:'PT409',message:'luggage_stale'}};}}});
 assert.equal(r.ok,false);assert.equal(r.conflict,true);assert.equal(writes,1);
});
