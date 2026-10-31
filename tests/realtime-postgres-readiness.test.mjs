import assert from 'node:assert/strict';
import {test} from 'node:test';
import {onPostgresChangesReady} from '../src/lib/realtimePostgresReadiness.js';
import {createBudgetRefresh} from '../src/lib/budgetSync.js';
import {createRequestGuard} from '../src/lib/luggageSync.js';

test('CDC catch-up follows Postgres readiness rather than JOIN, and ignores unrelated/error controls',()=>{
 const bindings=new Map(),channel={on(event,filter,fn){bindings.set(event,fn);return this;}};
 let refreshed=0;onPostgresChangesReady(channel,()=>refreshed++);
 // Real wire semantics: successful JOIN alone has no CDC-ready system frame.
 assert.equal(refreshed,0);
 bindings.get('system')({extension:'system',status:'ok',message:'Replication connection established'});
 bindings.get('system')({extension:'postgres_changes',status:'error'});
 assert.equal(refreshed,0);
 bindings.get('system')({extension:'postgres_changes',status:'ok',message:'Subscribed to PostgreSQL'});
 assert.equal(refreshed,1);
 // A rejoin must trigger a fresh authoritative read, not a one-time latch.
 bindings.get('system')({extension:'postgres_changes',status:'ok'});
 assert.equal(refreshed,2);
});

test('CDC readiness catch-up preserves coalescing and context/cleanup admission',async()=>{
 const bindings=new Map(),channel={on(event,filter,fn){bindings.set(event,fn);return this;}};
 let active=true,reads=0,applies=0;const guard=createRequestGuard();guard.setContext('QA-A');const context=guard.context();
 // Use the real refresh scheduler: gap recovery does not install event rows.
 const refresh=createBudgetRefresh({guard,read:async()=>{reads++;return {data:{verified:true}};},apply:()=>{applies++;}});
 onPostgresChangesReady(channel,()=>{if(active&&guard.sameContext(context))refresh.schedule();});
 const ready=()=>bindings.get('system')({extension:'postgres_changes',status:'ok'});
 ready();ready();
 await refresh.refresh();assert.equal(reads,1);assert.equal(applies,1);
 guard.setContext('QA-B');ready();guard.setContext('QA-A');ready();assert.equal(reads,1);
 active=false;ready();assert.equal(reads,1);refresh.cancel();
});
