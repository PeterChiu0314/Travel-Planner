import test from 'node:test';
import assert from 'node:assert/strict';
import {createExpenseEditor} from '../src/lib/expenseEditor.js';

function fixture(t){
 const start=1_800_000_000_000,trip='trip',id='expense';
 t.mock.timers.enable({apis:['Date'],now:start});
 let held=null;
 const calls=[],writes=[];
 const service={authorized:async()=>true,
  read:async()=>({data:{schemaVersion:1,tripId:trip,serverNow:new Date().toISOString(),
   items:[{id,trip_id:trip,payment_state:'unpaid',budget:null,paid:null}],links:[],participants:[],
   itineraryItems:[{id:'stop',updated_at:'2026-11-09T00:00:00Z'}],
   groups:[{id,group:'links',revision:0,epoch:1,own_session:Boolean(held),held:Boolean(held),expires_at:held}],
  }}),
  lease:async request=>{
   calls.push(request);
   if(request.p_action==='release'){
    held=null;
    return {data:{schemaVersion:1,action:'release',id,group:'links',session_id:'session',requested_epoch:1,
     granted:true,settled:true,capability_active:false,outcome:'released'}};
   }
   held=new Date(Date.now()+(request.p_dirty?60000:20000)).toISOString();
   return {data:{granted:true,epoch:1,expires_at:held}};
  },
  mutate:async request=>{writes.push(request);return {error:{message:'network request failed'}};},
 };
 const client=createExpenseEditor({actor:'actor',trip,sessionId:'session',service});
 t.after(()=>client.dispose());
 return {client,id,calls,writes,at:ms=>t.mock.timers.setTime(start+ms)};
}

test('links activity keeps a session usable and clean idle releases it without reacquiring on return',async t=>{
 const {client,id,calls,at}=fixture(t);
 await client.refresh();
 const links=client.get(id,'links');
 assert.equal(await client.beginLinks(links),true);
 at(18000);
 client.touchLinks(links);
 await client.tick();
 at(24000);
 await client.tick();
 assert.equal(client.view(links).editable,true);
 at(38000);
 await client.tick();
 await client.endLinks(links);
 assert.equal(client.view(links).editable,false);
 assert.equal(calls.at(-1).p_action,'release');
 assert.equal(await client.beginLinks(links),true);
 client.suspend();
 await links.releaseWork;
 assert.equal(await client.resume(),true);
 assert.equal(client.view(links).editable,false);
 assert.equal(calls.at(-1).p_action,'release');
});

test('dirty links get the longer idle window and stop renewing while an unknown request remains recoverable',async t=>{
 const {client,id,calls,writes,at}=fixture(t);
 await client.refresh();
 const links=client.get(id,'links');
 assert.equal(await client.beginLinks(links),true);
 client.input(links,['stop']);
 await client.save(links);
 const request=links.request;
 assert.ok(request);
 at(15000);
 await client.tick();
 at(35000);
 await client.tick();
 assert.equal(calls.at(-1).p_dirty,true);
 assert.equal(client.view(links).editable,true);
 at(60000);
 await client.tick();
 await client.endLinks(links);
 assert.equal(links.linksSession,null);
 assert.equal(links.request.p_request_id,request.p_request_id);
 assert.deepEqual(client.view(links).value,['stop']);
 const renewals=calls.filter(call=>call.p_action==='renew').length;
 at(70000);
 await client.tick();
 assert.equal(calls.filter(call=>call.p_action==='renew').length,renewals);
 assert.ok(writes.length>1);
 assert.ok(writes.every(write=>write.p_request_id===request.p_request_id));
});
