import test from 'node:test';
import assert from 'node:assert/strict';
import {createBudgetMetadataEditor} from '../src/lib/budgetMetadataService.js';
import {createDemoBudgetMetadataService} from '../src/demo/budgetMetadata.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(){
 const props={currentUserId:'A',activeTrip:{id:'trip'},members:[{user_id:'A',status:'approved'}],budgetItems:[{id:'id',trip_id:'trip',title:'Original',note:'Note',category:'其他',amount:100,currency:'TWD',payer_id:'A'}],actualExpenses:[],onSaveMetadata(kind,id,group,value){props.budgetItems[0]={...props.budgetItems[0],[group]:value};}};
 const transport=createDemoBudgetMetadataService(()=>props),service={...transport};
 const client=createBudgetMetadataEditor({service,read:trip=>transport.read(trip),sessionId:'tab',debounceMs:60000,timeoutMs:100});client.configure('A','trip',true,true);await client.refresh();return {client,transport,service,props,g:client.get('budget','id','title')};
}
test('definite denied admission arriving after blur clears the never-granted capability',async()=>{
 const f=await fixture(),gate=deferred();let acquire=0;f.service.lease=args=>args.p_action==='acquire'&&++acquire===1?gate.promise:f.transport.lease(args);
 try{const focus=f.client.focus(f.g);await new Promise(setImmediate);f.client.blur(f.g);const release=f.client.release(f.g);gate.resolve({data:{granted:false,reason:'group_locked'}});assert.equal(await focus,false);assert.equal(await release,true);assert.equal(f.g.token,null);assert.equal(f.g.releasing,false);assert.equal(await f.client.focus(f.g),true);}finally{await f.client.dispose();}
});
test('concurrent release callers share one capability release and immediate refocus waits for it',async()=>{
 const f=await fixture(),gate=deferred();let releases=0;try{assert(await f.client.focus(f.g));f.service.lease=async args=>{if(args.p_action==='release'){releases++;await gate.promise;}return f.transport.lease(args);};
 const a=f.client.release(f.g),b=f.client.release(f.g);await new Promise(setImmediate);assert.equal(releases,1);const again=f.client.focus(f.g);gate.resolve();assert(await a);assert(await b);assert(await again);assert.equal(f.client.view(f.g).writable,true);
 }finally{gate.resolve();await f.client.dispose();}
});
test('the visible retry action recovers a failed release without discarding unsaved input',async()=>{
 const f=await fixture();let fail=true;f.service.lease=args=>args.p_action==='release'&&fail?{error:{message:'offline'}}:f.transport.lease(args);
 try{assert(await f.client.focus(f.g));f.client.input(f.g,'Retained draft');assert.equal(await f.client.release(f.g),false);assert.equal(f.client.view(f.g).display,'Retained draft');fail=false;assert.equal(await f.client.retry(f.g),true);assert.equal(f.props.budgetItems[0].title,'Retained draft');assert.equal(f.g.releasing,false);}finally{await f.client.dispose();}
});
test('late grant retains its exact epoch when cleanup fails and explicit retry can recover',async()=>{
 const f=await fixture(),gate=deferred();let attempt,fail=true;
 f.service.lease=args=>{if(args.p_action==='acquire'&&!attempt){attempt=args;return gate.promise;}if(args.p_action==='release'&&fail)return {error:{message:'release failed'}};return f.transport.lease(args);};
 try{assert.equal(await f.client.focus(f.g),false);f.client.input(f.g,'unaccepted');assert.equal(await f.client.release(f.g),false);const reply=await f.transport.lease(attempt);gate.resolve(reply);for(let i=0;i<30&&f.g.epoch==null;i++)await new Promise(setImmediate);assert.equal(f.g.epoch,reply.data.epoch);assert(f.g.token);fail=false;assert.equal(await f.client.retry(f.g),true);assert.equal(f.g.releasing,false);}finally{gate.resolve({error:{message:'cancelled'}});await f.client.dispose();}
});
test('refresh during exact release cannot restore authority or strand a clean field',async()=>{
 const f=await fixture(),gate=deferred();try{assert(await f.client.focus(f.g));f.service.lease=async args=>{const result=await f.transport.lease(args);if(args.p_action==='release')await gate.promise;return result;};const release=f.client.release(f.g);await new Promise(setImmediate);await f.client.refresh();assert.equal(f.client.view(f.g).writable,false);gate.resolve();assert(await release);assert.equal(await f.client.focus(f.g),true);}finally{gate.resolve();await f.client.dispose();}
});
test('blurred first PT409 keeps the conflicted draft but no impossible release capability',async()=>{
 const f=await fixture(),gate=deferred();f.service.lease=args=>args.p_action==='acquire'?gate.promise:f.transport.lease(args);
 try{const focus=f.client.focus(f.g);await new Promise(setImmediate);f.client.input(f.g,'Conflicted draft');f.client.blur(f.g);const release=f.client.release(f.g);gate.resolve({error:{code:'PT409',message:'stale'}});assert.equal(await focus,false);assert(await release);assert.equal(f.g.token,null);assert.equal(f.g.conflict,true);assert.equal(f.client.view(f.g).display,'Conflicted draft');assert.equal(f.props.budgetItems[0].title,'Original');assert(await f.client.discard(f.g));}finally{await f.client.dispose();}
});
test('a confirmed grant replaces a stale peer ownership hint without waiting for Realtime',async()=>{
 const f=await fixture();try{const s=await f.transport.read('trip'),r=s.data.metadataRecords.find(r=>r.id==='id').groups.find(g=>g.group==='title');Object.assign(r,{held:true,own_session:false,owner_id:'B',expires_at:new Date(Date.now()+60000).toISOString()});assert(f.client.ingest(s.data));assert.equal(f.client.view(f.g).remote.own_session,false);assert(await f.client.focus(f.g));assert.equal(f.client.view(f.g).remote.own_session,true);assert.equal(f.client.view(f.g).remote.owner_id,'A');}finally{await f.client.dispose();}
});
