import test from 'node:test';
import assert from 'node:assert/strict';
import {createExpenseRates} from '../src/lib/expenseRates.js';
function fixture(){
 const calls=[],errors=[],values=new Map(),graph={rates:{rates:{JPY:.2}},rateState:{revision:0,targets:[]}};
 const service={authorized:async()=>true,rateLease:async args=>{calls.push(args);return {data:{granted:true,epoch:1}};},rates:async args=>{calls.push(args);return {error:{code:'55000',message:'Use atomic rates protocol'}};}};
 const controller=createExpenseRates({service,actor:'A',trip:'T',sessionId:'S',getGraph:()=>graph,refresh:async()=>true,storage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},onError:e=>errors.push(e),quote:async()=>({rates:{JPY:.25}})});
 return {controller,service,calls,errors,values};
}
test('definite rates refusal retires the request and lease, unlocks leave guard, and never replays',async()=>{
 const f=fixture();assert.equal(await f.controller.update(),false);assert.equal(f.controller.status().pending,false);assert.equal(f.controller.status().busy,false);assert.equal(f.values.size,0);assert.equal(f.calls.filter(c=>c.p_action==='release').length,1);
 let emissions=0;f.controller.subscribe(()=>emissions++);for(let i=0;i<4;i++)assert(await f.controller.finish());assert.equal(emissions,0);assert.equal(f.calls.filter(c=>c.p_request_id).length,1);
});
test('unknown rates receipt stays pending with the same immutable request until a definite refusal',async()=>{
 const f=fixture();f.service.rates=async args=>{f.calls.push(args);return {error:{message:'network lost'}};};assert.equal(await f.controller.update(),false);assert(f.controller.status().pending);const request=f.calls.find(c=>c.p_request_id);assert.equal(await f.controller.finish(),false);assert.deepEqual(f.calls.filter(c=>c.p_request_id)[1],request);
 f.service.rates=async()=>({error:{code:'55000',message:'refused'}});await f.controller.retry();assert.equal(f.controller.status().pending,false);assert.equal(f.values.size,0);
});
