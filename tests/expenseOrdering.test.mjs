import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID as uuid} from 'node:crypto';
import {departureFixture} from './helpers/expenseDepartureFixture.js';
import {orderedExpenseRows} from '../src/lib/expenseOrdering.js';
import {createExpenseEditor} from '../src/lib/expenseEditor.js';

test('a delayed order snapshot cannot publish older category or item order',async()=>{
 const trip='trip',items=['a','b'].map(id=>({id,trip_id:trip,payment_state:'unpaid'}));
 const snapshot=(snapshotRevision,categories,first,second)=>({
  schemaVersion:1,tripId:trip,snapshotRevision,items,groups:[],links:[],participants:[],
  ordering:{categories,items:{[first]:{position:1},[second]:{position:2}}},
 });
 const older=snapshot(1,['機票','交通'],'a','b');
 const newer=snapshot(2,['交通','機票'],'b','a');
 const latest=snapshot(3,['交通','機票'],'a','b');
 let resolveDelayed,startDelayed;
 const started=new Promise(resolve=>{startDelayed=resolve;});
 const delayed=new Promise(resolve=>{resolveDelayed=resolve;});
 const responses=[newer,delayed,latest];
 const published=[];
 const client=createExpenseEditor({actor:'actor',trip,sessionId:'session',
  service:{authorized:async()=>true,read:async()=>{
   const next=responses.shift();
   if(next===delayed)startDelayed();
   return {data:await next};
  }},onSnapshot:data=>published.push(data),
 });
 try{
  assert.equal(await client.refresh(),true);
  const pending=client.refresh();
  await started;
  client.ingest(newer);
  resolveDelayed(older);
  assert.equal(await pending,true);
  assert.equal(client.status().verified,true);
  assert.deepEqual(published,[newer]);
  for(const graph of [client.status().graph,published.at(-1)]){
   assert.deepEqual(graph.ordering.categories,['交通','機票']);
   assert.deepEqual(orderedExpenseRows(graph.items,graph.ordering.items).map(item=>item.id),['b','a']);
  }
  assert.equal(await client.refreshAfterMutation(),true);
  assert.deepEqual(published,[newer,latest]);
 }finally{client.dispose();}
});

test('expense ordering validates intent, protects fields and fences unknown writes',async()=>{
 const f=await departureFixture();
 try{
  const a=await f.seed('A',{}, {paid:true,payer:f.A});
  const b=await f.seed('B',{});
  const c=await f.seed('C',{});
  const trip={p_trip_id:f.trip};
  const start=async(id,actor=f.A,kind='item',session=uuid())=>{
   const args={...trip,p_kind:kind,p_id:id,p_session_id:session,p_token:uuid()};
   const lease=await f.rpc('expense_drag_lease',{...args,p_action:'acquire'},actor);
   const request=(intent={})=>({...args,p_request_id:uuid(),p_intent:{
    sourceCategory:'交通',category:'交通',categoryRevision:0,revision:0,
    targetCategoryRevision:0,target:null,side:'end',...intent,
   }});
   return {args,lease,request,move:(r,confirm=false)=>f.rpc('move_expense_order',{...r,p_confirm:confirm},actor),
    release:()=>f.rpc('expense_drag_lease',{...args,p_action:'release'},actor)};
  };
  const before=await f.snapshot();
  const owner=await start(a);
  assert.equal(owner.lease.data?.granted,true,JSON.stringify(owner.lease));
  assert.equal((await start(a,f.B)).lease.data?.granted,false);
  assert.equal((await start(a.toUpperCase(),f.B)).lease.data?.granted,false);
  assert.equal((await start(a,f.A)).lease.data?.granted,false);
  const forged=owner.request({target:b,side:'before'});
  assert.equal((await f.rpc('move_expense_order',{...forged,p_session_id:uuid()},f.A)).error?.code,'55P03');
  const peer=await start(b,f.B);
  const category=await start('交通',f.B,'category');
  const note=await f.lease(a,'note',f.B);
  assert.equal(note.result.data?.granted,true);
  const first=owner.request({target:c,side:'before'});
  const moved=await owner.move(first);
  assert.equal(moved.data?.committed,true,JSON.stringify(moved));
  assert.equal((await note.mutate({text:'independent'})).data?.committed,true);
  assert.equal((await peer.move(peer.request({target:a,side:'before'}))).data?.committed,true);
  assert.equal((await category.move(category.request({target:'購物',side:'after'}))).data?.committed,true);
  const ordered=await f.snapshot();
  assert.deepEqual(orderedExpenseRows(ordered.items,ordered.ordering.items).map(row=>row.id),[b,a,c]);
  assert.deepEqual(ordered.ordering.categories,['機票','住宿','門票','餐飲','購物','交通','其他']);
  assert.deepEqual((await owner.move(first)).data,moved.data);
  assert.equal((await owner.move({...first,p_intent:{...first.p_intent,side:'after'}})).error?.code,'22023');
  assert.deepEqual((await f.snapshot()).ordering.items,ordered.ordering.items);

  const field=await f.lease(a,'category',f.B);
  const cross=await start(a);
  const crossing=cross.request({category:'住宿',revision:1});
  assert.equal((await cross.move(crossing)).error?.code,'55P03');
  assert.equal((await f.snapshot()).items.find(row=>row.id===a).category,'交通');
  assert.equal((await field.release()).data?.settled,true);
  assert.equal((await cross.move(crossing)).data?.committed,true);
  assert.equal((await f.lease(a,'category',f.B,0)).result.error?.code,'PT409');
  const after=await f.snapshot(),original=before.items.find(row=>row.id===a),updated=after.items.find(row=>row.id===a);
  assert.deepEqual(updated,{...original,category:'住宿',note:'independent'});
  assert.deepEqual(after.participants,before.participants);
  assert.deepEqual(after.links,before.links);
  assert.deepEqual(after.rates,before.rates);

  const unknown=await start(b,f.B);
  const uncommitted=unknown.request({category:'門票',revision:1});
  assert.equal((await unknown.move(uncommitted,true)).data?.committed,false);
  assert.equal((await unknown.move(uncommitted)).data?.committed,false);
  const expiring=await start(c);
  await f.sql.exec('reset role; update expense_stage_b.drag_leases set expires_at=now()');
  assert.equal((await expiring.move(expiring.request())).error?.code,'55P03');
  assert.equal((await start(c,f.B)).lease.data?.granted,true);
  assert.equal((await f.rpc('read_expense_snapshot',{...trip,p_session_id:uuid()},uuid())).error?.code,'42501');

  const deletedTarget=await start(b,f.B);
  const lifecycle=await f.lease(c,'lifecycle');
  assert.equal((await lifecycle.mutate({action:'delete'})).data?.committed,true);
  assert.equal((await deletedTarget.move(deletedTarget.request({target:c,side:'before',revision:1}))).error?.code,'PT409');
  assert.equal((await f.snapshot()).items.some(item=>item.id===c),false);
 }finally{await f.close();}
});
