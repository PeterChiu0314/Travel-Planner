import test from 'node:test';
import assert from 'node:assert/strict';
import {createExpenseEditor} from '../src/lib/expenseEditor.js';

const stopVersion='2026-11-09T00:00:00Z';
function fixture(t){
 const start=1_800_000_000_000,trip='trip',id='expense';
 t.mock.timers.enable({apis:['Date'],now:start});
 let held=null,ack=false,revision=0,saved=[],version=stopVersion;
 const item={id,trip_id:trip,payment_state:'unpaid',budget:null,paid:null};
 const calls=[],writes=[];
 const service={authorized:async()=>true,
  read:async()=>({data:{schemaVersion:1,tripId:trip,serverNow:new Date().toISOString(),
   items:[item],links:saved.map(itinerary_item_id=>({expense_id:id,itinerary_item_id})),participants:[],
   itineraryItems:[{id:'stop',updated_at:version}],
   groups:[{id,group:'links',revision,epoch:1,own_session:Boolean(held),held:Boolean(held),expires_at:held}],
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
  mutate:async request=>{
   writes.push(request);
   if(!ack)return {error:{message:'network request failed'}};
   saved=request.p_value.ids;
   return {data:{committed:true,request_id:request.p_request_id,expense_id:id,group:'links',revision:++revision,item,participants:[]}};
  },
 };
 const client=createExpenseEditor({actor:'actor',trip,sessionId:'session',service});
 t.after(()=>client.dispose());
 return {client,id,calls,writes,at:ms=>t.mock.timers.setTime(start+ms),confirm:()=>{ack=true;},changeStop:()=>{version='2026-11-09T00:00:01Z';}};
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

test('foreground preserves a pending draft without admitting the links dialog',async t=>{
 const {client,id,calls,writes}=fixture(t);
 await client.refresh();
 const links=client.get(id,'links');
 assert.equal(await client.openLinks(links),true);
 client.input(links,['stop']);
 await client.save(links);
 const request=links.request;
 client.suspend({background:true});
 await client.resume({foreground:true});
 assert.equal(await client.actOnLinks(links,{id:'stop',version:stopVersion,selected:false}),'paused');
 assert.equal(links.request,request);
 assert.equal(calls.filter(call=>call.p_action==='acquire').length,1);
 assert.equal(writes.length,1);
 assert.equal(links.linksSession,null);
 assert.deepEqual(client.view(links).value,['stop']);
});

test('closing a suspended links dialog prevents background return from acquiring a lease',async t=>{
 const {client,id,calls}=fixture(t);
 await client.refresh();
 const links=client.get(id,'links');
 assert.equal(await client.openLinks(links),true);
 client.suspend({background:true});
 await client.endLinks(links);
 await links.releaseWork;
 await client.resume({foreground:true});
 assert.equal(calls.filter(call=>call.p_action==='acquire').length,1);
 assert.equal(client.view(links).editable,false);
});

test('a late confirmation uses the last activity to set the clean idle deadline',async t=>{
 const {client,id,calls,at,confirm}=fixture(t);
 await client.refresh();
 const links=client.get(id,'links');
 assert.equal(await client.openLinks(links),true);
 client.input(links,['stop']);
 at(10000);
 await client.tick();
 at(25000);
 await client.tick();
 assert.equal(client.linksDialogState(links).editable,true);
 confirm();
 assert.equal(await client.save(links),true);
 assert.equal(client.linksDialogState(links).editable,false);
 await client.tick();
 await links.linksCloseWork;
 assert.equal(calls.at(-1).p_action,'release');
 assert.equal(calls.filter(call=>call.p_action==='acquire').length,1);
});

test('a paused card action validates the displayed itinerary version before changing the draft',async t=>{
 const {client,id,calls,writes,at,changeStop}=fixture(t);
 await client.refresh();
 const links=client.get(id,'links');
 assert.equal(await client.openLinks(links),true);
 at(21000);
 await client.tick();
 changeStop();
 assert.equal(await client.actOnLinks(links,{id:'stop',version:stopVersion,selected:true}),'changed');
 assert.equal(client.linksDialogState(links).editable,true);
 assert.deepEqual(client.view(links).value,[]);
 assert.equal(writes.length,0);
 assert.equal(calls.filter(call=>call.p_action==='acquire').length,2);
 assert.equal(await client.actOnLinks(links,{id:'stop',version:'2026-11-09T00:00:01Z',selected:true}),'ready');
 assert.deepEqual(client.view(links).value,['stop']);
});
