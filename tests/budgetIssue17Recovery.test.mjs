import test from 'node:test';
import assert from 'node:assert/strict';
import {createBudgetMetadataEditor} from '../src/lib/budgetMetadataService.js';
import {createDemoBudgetMetadataService} from '../src/demo/budgetMetadata.js';

async function fixture() {
  let time=Date.now();
  const props={currentUserId:'A',activeTrip:{id:'trip'},members:[{user_id:'A',status:'approved'}],budgetItems:[{id:'id',trip_id:'trip',title:'Original',note:'Note',category:'其他',amount:100,currency:'TWD',payer_id:'A'}],actualExpenses:[],
    onSaveMetadata(kind,id,group,value){props.budgetItems[0]={...props.budgetItems[0],[group]:value};}};
  const transport=createDemoBudgetMetadataService(()=>props),service={...transport},calls=[];
  service.patch=args=>{calls.push(structuredClone(args));return transport.patch(args);};
  const client=createBudgetMetadataEditor({service,read:trip=>transport.read(trip),sessionId:'tab',debounceMs:60000,now:()=>time});
  client.configure('A','trip',true,true);await client.refresh();return {client,transport,service,props,calls,g:client.get('budget','id','title'),advance(){time+=6000;}};
}
test('background recovery confirms exact release without any per-field action',async()=>{
  const f=await fixture();let fail=true;f.service.lease=args=>args.p_action==='release'&&fail?{error:{message:'offline'}}:f.transport.lease(args);
  try{assert(await f.client.focus(f.g));assert.equal(await f.client.release(f.g),false);fail=false;await f.client.recover();assert.equal(f.g.releasing,false);assert.equal(f.g.token,null);assert(await f.client.focus(f.g));}finally{await f.client.dispose();}
});
test('unknown committed request is recovered through the identical idempotent receipt lookup, never a new request',async()=>{
  const f=await fixture();let first=true;
  f.service.patch=async args=>{f.calls.push(structuredClone(args));const result=await f.transport.patch(args);if(first){first=false;return {error:{message:'ACK lost'}};}return result;};
  try{assert(await f.client.focus(f.g));f.client.input(f.g,'Saved once');assert.equal(await f.client.save(f.g),false);assert(f.g.request);await f.client.recover();assert.equal(f.calls.length,2);assert.deepEqual(f.calls[1],f.calls[0]);assert.equal(f.g.base,1);assert.equal(f.g.request,null);assert.equal(f.props.budgetItems[0].title,'Saved once');assert.equal(f.client.status().pending,false);}finally{await f.client.dispose();}
});
test('a clean stale admission recovers automatically, without treating ordinary contention as a dirty conflict',async()=>{
  const f=await fixture();let first=true;
  f.service.lease=args=>args.p_action==='acquire'&&first?(first=false,{error:{code:'PT409'}}):f.transport.lease(args);
  try{assert.equal(await f.client.focus(f.g),false);await f.client.refresh();assert.equal(f.g.conflict,false);await f.client.recover();assert.equal(f.client.view(f.g).writable,true);assert.deepEqual(f.client.status().failures,[]);}finally{await f.client.dispose();}
});
test('true same-group changes retain the draft and are never automatically rebased over a peer write',async()=>{
  const f=await fixture();try{assert(await f.client.focus(f.g));f.client.input(f.g,'My draft');assert(await f.client.release(f.g));
    const args={p_trip_id:'trip',p_kind:'budget',p_id:'id',p_group:'title',p_session_id:'other-tab',p_token:'other-token',p_action:'acquire',p_base_revision:0,p_epoch:null,p_activity_seq:1,p_dirty:false};
    const held=await f.transport.lease(args);assert(held.data.granted);
    const changed=await f.transport.patch({...args,p_epoch:held.data.epoch,p_request_id:'other-request',p_patch:{title:'Peer committed'}});assert(!changed.error);
    await f.client.refresh();assert(f.g.conflict);await f.client.recover();assert.equal(f.client.view(f.g).display,'My draft');assert.equal(f.props.budgetItems[0].title,'Peer committed');assert.equal(f.calls.length,0);assert(f.client.status().pending);
  }finally{await f.client.dispose();}
});
