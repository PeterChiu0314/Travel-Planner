// Shared SQL contract scenarios: PGlite sequential safety and native PG.
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
export async function metadataUndoCases({test,admin,query,a,b,identities,actorA,actorB,viewer,pending,outsider,trip,secretTrip,fixture,record,call,leaseAction,patchAction}) {
  const actor=(client,id)=>query(client,"select set_config('request.jwt.claim.sub',$1,false)",[id]);
  const read=(client=a,session=identities.get(client).session,tripId=trip)=>call(client,{text:'public.read_budget_metadata_undo($1,$2)',values:[tripId,session]});
  const clear=(client=a)=>call(client,{text:'public.clear_budget_metadata_undo($1,$2)',values:[trip,identities.get(client).session]});
  const undoAction=(client,op,lease,options={})=>({text:'public.undo_budget_metadata_group($1,$2,$3,$4,$5,$6)',values:[options.trip||trip,options.session||identities.get(client).session,op,options.token===undefined?identities.get(client).token:options.token,options.epoch??lease?.epoch,options.request||uuid()]});
  const undo=(client,op,lease,options)=>call(client,undoAction(client,op,lease,options));
  const deny=async(work,code)=>assert.rejects(work,error=>error.code===code);
  const setup=async(kind='budget')=>{
    const id=kind==='budget'?await fixture():uuid();
    if(kind==='actual')await admin("insert into actual_expenses(id,trip_id,title,note,amount,twd_amount,currency,exchange_rate,payer_id,payment_origin,actual_twd_amount,twd_amount_source) values($1,$2,'Initial','Initial note',300,71,'JPY',0.2,$3,'manual',71,'actual')",[id,trip,actorA]);
    await clear();const lease=await call(a,leaseAction(a,id,'title','acquire',{kind}));return {id,lease,kind,base:0,operations:[]};
  };
  const write=async(f,value,group='title',client=a,options={})=>{
    const operation=uuid(),result=await call(client,patchAction(client,f.id,group,value,{kind:f.kind,base:f.base,epoch:f.lease.epoch,request:operation,...options}));
    f.base=result.revision;f.operations.push(operation);return {operation,result};
  };
  const release=f=>call(a,leaseAction(a,f.id,'title','release',{kind:f.kind,base:f.base,epoch:f.lease.epoch}));
  await test('Undo migration is dormant and cannot affect old patch results or create a stack until enabled',async()=>{
    assert.equal((await admin('select enabled from app_private.budget_metadata_undo_protocol'))[0].enabled,false);
    const f=await setup();const saved=await write(f,'Before activation');assert.equal(saved.result.undo_supported,false);assert.equal((await read()).count,0);
    await deny(()=>undo(a,saved.operation,f.lease),'55000');await release(f);await admin('update app_private.budget_metadata_undo_protocol set enabled=true');
    return {defaultOff:true,oldPatchShapePreserved:true};
  });
  await test('six successful operations retain five pointers and five sequential inverses advance verified lineage',async()=>{
    const f=await setup();for(let i=1;i<=6;i++)await write(f,`Value ${i}`);
    assert.equal((await read()).count,5);const operations=await admin('select * from app_private.budget_metadata_undo_operations where resource_id=$1 order by after_revision',[f.id]);assert.equal(operations.length,6);
    for(let i=6;i>=2;i--){const top=(await read()).top;assert.equal(top.operation_id,f.operations[i-1]);const result=await undo(a,top.operation_id,f.lease);f.base=result.revision;assert.equal((await record(f.id)).title,`Value ${i-1}`);}
    assert.equal(f.base,11);assert.equal((await read()).count,0);await deny(()=>undo(a,f.operations[0],f.lease),'40001');
    assert.deepEqual(await admin('select * from app_private.budget_metadata_undo_operations where resource_id=$1 order by after_revision',[f.id]),operations,'original audit must stay immutable');
    assert.equal((await admin('select count(*)::int n from app_private.budget_metadata_undo_receipts where operation_id=any($1::uuid[])',[f.operations]))[0].n,5);await release(f);
    return {undoSteps:5,revision:11,immutableEvidence:true,noRedo:true};
  });
  await test('interleaved title/note inverse advances only its own predecessor, not the unrelated top group',async()=>{
    const f=await setup(),noteLease=await call(a,leaseAction(a,f.id,'note'));
    const t1=await write(f,'Title one');const n1=await call(a,patchAction(a,f.id,'note','Note one',{epoch:noteLease.epoch,request:uuid()}));
    const t2=await write(f,'Title two');await undo(a,t2.operation,f.lease);
    const stack=await admin('select s.expected_revision,o.group_key from app_private.budget_metadata_undo_stack s join app_private.budget_metadata_undo_operations o using(user_id,operation_id) where s.trip_id=$1 order by s.position desc',[trip]);
    assert.deepEqual(stack.map(r=>[r.group_key,Number(r.expected_revision)]),[['note',1],['title',3]]);
    const noteOp=(await read()).top.operation_id;await undo(a,noteOp,noteLease);await undo(a,t1.operation,f.lease);
    assert.equal((await record(f.id)).title,'Initial');assert.equal((await record(f.id)).note,'Initial note');assert.equal(n1.revision,1);
    await release(f);await call(a,leaseAction(a,f.id,'note','release',{epoch:noteLease.epoch}));
  });
  await test('no-op, replay, denied mutation and lease traffic do not push, clear or consume steps',async()=>{
    const f=await setup(),saved=await write(f,'One');const before=await read();
    const replay=await call(a,patchAction(a,f.id,'title','One',{base:0,epoch:f.lease.epoch,request:saved.operation}));assert.deepEqual(replay,saved.result);
    const noop=await call(a,patchAction(a,f.id,'title','One',{base:1,epoch:f.lease.epoch}));assert.equal(noop.revision,1);
    await call(a,leaseAction(a,f.id,'title','renew',{base:1,epoch:f.lease.epoch}));await deny(()=>call(a,patchAction(a,f.id,'title','No',{base:1,epoch:f.lease.epoch,token:uuid()})),'55P03');
    assert.deepEqual(await read(),before);await release(f);
  });
  await test('Undo requires current tab top, correct capability/epoch and current version; failure leaves the stack',async()=>{
    const f=await setup(),one=await write(f,'One'),two=await write(f,'Two'),before=await read();
    await deny(()=>undo(a,one.operation,f.lease),'40001');await deny(()=>undo(a,two.operation,f.lease,{session:uuid()}),'40001');
    await deny(()=>undo(b,two.operation,f.lease),'40001');await deny(()=>undo(a,two.operation,f.lease,{token:uuid()}),'55P03');
    await deny(()=>undo(a,two.operation,f.lease,{epoch:f.lease.epoch+1}),'55P03');assert.deepEqual(await read(),before);assert.equal((await record(f.id)).title,'Two');await release(f);
  });
  await test('same account separate sessions keep independent stacks and cannot release another tab authority',async()=>{
    const f=await setup(),saved=await write(f,'A tab'),session=uuid(),token=uuid();await release(f);
    await actor(b,actorA);try{
      const held=await call(b,leaseAction(b,f.id,'title','acquire',{base:1,session,token}));
      assert.equal((await read(b,session)).count,0);await deny(()=>undo(b,saved.operation,held,{session,token}),'40001');
      await call(a,leaseAction(a,f.id,'title','release',{epoch:f.lease.epoch}));
      assert.equal((await admin('select session_id from app_private.budget_metadata_groups where resource_id=$1 and group_key=\'title\'',[f.id]))[0].session_id,session);
      const op=uuid();await call(b,patchAction(b,f.id,'title','Other tab',{base:1,epoch:held.epoch,session,token,request:op}));
      assert.equal((await read()).top.operation_id,saved.operation);assert.equal((await read(b,session)).top.operation_id,op);
      await call(b,leaseAction(b,f.id,'title','release',{session,token,epoch:held.epoch}));
      const reacquired=await call(a,leaseAction(a,f.id,'title','acquire',{base:2}));await deny(()=>undo(a,saved.operation,reacquired),'40001');
      f.lease=reacquired;await release(f);
    }finally{await actor(b,actorB);}
  });
  await test('another actor can edit an unrelated group without invalidating safe title Undo',async()=>{
    const f=await setup(),saved=await write(f,'A title'),note=await call(b,leaseAction(b,f.id,'note'));
    await call(b,patchAction(b,f.id,'note','B note',{epoch:note.epoch}));const other=await read(b);await undo(a,saved.operation,f.lease);
    assert.equal((await record(f.id)).title,'Initial');assert.equal((await record(f.id)).note,'B note');assert.deepEqual(await read(b),other);
    await release(f);await call(b,leaseAction(b,f.id,'note','release',{epoch:note.epoch}));
  });
  await test('same group changed away and back by another actor cannot impersonate inverse lineage',async()=>{
    const f=await setup(),saved=await write(f,'A title');await release(f);const held=await call(b,leaseAction(b,f.id,'title','acquire',{base:1}));
    await call(b,patchAction(b,f.id,'title','B',{base:1,epoch:held.epoch}));await call(b,patchAction(b,f.id,'title','A title',{base:2,epoch:held.epoch}));
    await call(b,leaseAction(b,f.id,'title','release',{epoch:held.epoch}));f.lease=await call(a,leaseAction(a,f.id,'title','acquire',{base:3}));
    await deny(()=>undo(a,saved.operation,f.lease),'40001');assert.equal((await read()).count,1);assert.equal((await record(f.id)).title,'A title');await release(f);
  });
  await test('successful inverse replay after release returns same result, never pops twice, rejects changed identity',async()=>{
    const f=await setup();await write(f,'One');const saved=await write(f,'Two'),request=uuid();const result=await undo(a,saved.operation,f.lease,{request});await release(f);
    const before=await read();assert.deepEqual(await undo(a,saved.operation,null,{request,token:null,epoch:0}),result);assert.deepEqual(await read(),before);
    await deny(()=>undo(a,f.operations[0],null,{request,token:null}),'22023');await deny(()=>undo(a,saved.operation,null,{request,session:uuid(),token:null}),'22023');
  });
  await test('clear drops only this tab pointers, not operations or retry evidence; replay cannot recreate the stack',async()=>{
    const f=await setup(),saved=await write(f,'One');await clear();assert.equal((await read()).count,0);
    await call(a,patchAction(a,f.id,'title','One',{base:0,epoch:f.lease.epoch,request:saved.operation}));assert.equal((await read()).count,0);
    assert.equal((await admin('select count(*)::int n from app_private.budget_metadata_undo_operations where resource_id=$1',[f.id]))[0].n,1);await release(f);
  });
  await test('standalone Actual inverse restores only metadata, preserving known debit, FX and provenance',async()=>{
    const f=await setup('actual'),before=await record(f.id,'actual'),saved=await write(f,'Actual edited');await undo(a,saved.operation,f.lease);
    const after=await record(f.id,'actual');delete before.updated_at;delete after.updated_at;assert.deepEqual(after,before);await release(f);
  });
  await test('parent financial/legacy updates fence stale Undo even when values later return',async()=>{
    const f=await setup(),saved=await write(f,'Metadata');await release(f);
    await admin('update budget_items set amount=901 where id=$1',[f.id]);await admin('update budget_items set amount=900 where id=$1',[f.id]);
    f.lease=await call(a,leaseAction(a,f.id,'title','acquire',{base:1}));await deny(()=>undo(a,saved.operation,f.lease),'40001');assert.equal((await record(f.id)).title,'Metadata');await release(f);
  });
  await test('own legacy irreversible operation clears all actor-trip tab pointers conservatively but retains audit',async()=>{
    const f=await setup();await write(f,'Metadata');await release(f);await admin("select set_config('request.jwt.claim.sub',$1,false)",[actorA]);
    try {await admin('update budget_items set amount=901 where id=$1',[f.id]);}finally{await admin("select set_config('request.jwt.claim.sub','',false)");}
    assert.equal((await read()).count,0);assert.equal((await admin('select count(*)::int n from app_private.budget_metadata_undo_operations where resource_id=$1',[f.id]))[0].n,1);
  });
  await test('participant, link and trip-rate boundaries invalidate metadata inverse without undoing side effects',async()=>{
    for(const type of ['participant','link','rate']){
      const f=await setup(),saved=await write(f,'Metadata');await release(f);
      if(type==='participant')await admin('update budget_item_participants set share_amount=301 where budget_item_id=$1 and user_id=$2',[f.id,actorA]);
      if(type==='link'){const item=uuid();await admin("insert into itinerary_items(id,trip_id,title,type,date,day_index,sort_order) values($1,$2,'Visit','attraction',current_date+10,0,0)",[item,trip]);await admin('insert into itinerary_budget_items(itinerary_item_id,budget_item_id) values($1,$2)',[item,f.id]);}
      if(type==='rate')await admin("update trips set budget_exchange_rates=jsonb_build_object('rates',jsonb_build_object('JPY',0.3)) where id=$1",[trip]);
      f.lease=await call(a,leaseAction(a,f.id,'title','acquire',{base:1}));await deny(()=>undo(a,saved.operation,f.lease),'40001');await release(f);
    }
  });
  await test('permission revocation prevents read/replay/inverse and removes revoked actor tab pointers',async()=>{
    const f=await setup();const saved=await write(f,'Metadata');await admin("update trip_members set status='pending' where trip_id=$1 and user_id=$2",[trip,actorA]);
    try{await deny(()=>read(),'42501');await deny(()=>undo(a,saved.operation,f.lease),'42501');}
    finally{await admin("update trip_members set status='approved' where trip_id=$1 and user_id=$2",[trip,actorA]);}
    assert.equal((await read()).count,0);await release(f);
  });
  await test('viewer, pending, outsider, wrong trip and direct private table/function access remain denied',async()=>{
    const f=await setup(),saved=await write(f,'Metadata');
    for(const user of [viewer,pending,outsider]){await actor(b,user);await deny(()=>read(b),'42501');await deny(()=>undo(b,saved.operation,f.lease),'42501');}
    await actor(b,actorB);await deny(()=>read(a,identities.get(a).session,secretTrip),'42501');
    for(const table of ['protocol','operations','stack','lineage','intents','receipts'])await deny(()=>query(a,`select * from app_private.budget_metadata_undo_${table}`),'42501');
    await deny(()=>query(a,"select app_private.invalidate_budget_metadata_undo($1,null,null)",[trip]),'42501');await release(f);
  });
  await test('noncanonical legacy before-images never offer a misleading exact inverse',async()=>{
    for(const value of ['  Legacy  ','']){
      const f=await setup();await release(f);await admin('update budget_items set title=$2 where id=$1',[f.id,value]);
      f.lease=await call(a,leaseAction(a,f.id,'title','acquire',{base:1}));f.base=1;await write(f,'Canonical');assert.equal((await read()).count,0);await release(f);
    }
  });
  await test('uncompleted prepare cannot commit, and caller GUCs cannot authorize inverse or stack edits',async()=>{
    const f=await setup(),saved=await write(f,'One');await query(a,'begin');
    try {await query(a,'select app_private.prepare_budget_metadata_undo($1,$2,$3,$4)',[trip,identities.get(a).session,saved.operation,uuid()]);await deny(()=>query(a,'commit'),'40001');}
    finally{await query(a,'rollback');}
    assert.equal((await read()).count,1);await query(a,"select set_config('app.undo_allowed','true',false)");
    await deny(()=>query(a,'delete from app_private.budget_metadata_undo_stack'),'42501');assert.equal((await record(f.id)).title,'One');await release(f);
  });
  await test('injected receipt failure rolls back inverse value, versions, stack pop, lineage and request together',async()=>{
    const f=await setup(),saved=await write(f,'One'),before=await read(),beforeRow=await record(f.id),request=uuid();
    const lineageBefore=await admin('select * from app_private.budget_metadata_undo_lineage where resource_id=$1',[f.id]);
    await admin("create function app_private.undo_test_failure() returns trigger language plpgsql as $$begin raise exception 'injected_inverse_failure' using errcode='23514';end$$");
    await admin('create trigger undo_test_failure after insert on app_private.budget_metadata_undo_receipts for each row execute function app_private.undo_test_failure()');
    try{await deny(()=>undo(a,saved.operation,f.lease,{request}),'23514');}
    finally{await admin('drop trigger undo_test_failure on app_private.budget_metadata_undo_receipts');await admin('drop function app_private.undo_test_failure()');}
    assert.deepEqual(await read(),before);assert.deepEqual(await record(f.id),beforeRow);
    assert.deepEqual(await admin('select * from app_private.budget_metadata_undo_lineage where resource_id=$1',[f.id]),lineageBefore);
    assert.equal((await admin('select count(*)::int n from app_private.budget_metadata_requests where request_id=$1',[request]))[0].n,0);
    assert.equal((await admin('select count(*)::int n from app_private.budget_metadata_undo_intents'))[0].n,0);
    await undo(a,saved.operation,f.lease,{request});await release(f);
  });
  await test('expired capability cannot undo; new admission is mandatory and stale release cannot clear takeover',async()=>{
    const f=await setup(),saved=await write(f,'One');await admin("update app_private.budget_metadata_groups set expires_at=clock_timestamp()-interval '1 second' where resource_id=$1",[f.id]);
    const before=await read();await deny(()=>undo(a,saved.operation,f.lease),'55P03');assert.deepEqual(await read(),before);
    const other=await call(b,leaseAction(b,f.id,'title','acquire',{base:1}));await release(f);
    assert.equal((await admin('select user_id from app_private.budget_metadata_groups where resource_id=$1 and group_key=\'title\'',[f.id]))[0].user_id,actorB);
    await deny(()=>undo(a,saved.operation,f.lease),'55P03');await call(b,leaseAction(b,f.id,'title','release',{epoch:other.epoch}));
    f.lease=await call(a,leaseAction(a,f.id,'title','acquire',{base:1}));await undo(a,saved.operation,f.lease);await release(f);
  });
  await test('pausing Undo blocks new inverses but preserves successful same-request replay and audit',async()=>{
    const f=await setup();await write(f,'One');const saved=await write(f,'Two'),request=uuid(),result=await undo(a,saved.operation,f.lease,{request});
    await admin('update app_private.budget_metadata_undo_protocol set enabled=false');
    try{assert.deepEqual(await undo(a,saved.operation,f.lease,{request}),result);await deny(()=>undo(a,f.operations[0],f.lease),'55000');assert.equal((await read()).count,1);}
    finally{await admin('update app_private.budget_metadata_undo_protocol set enabled=true');}
    await release(f);
  });
  await test('a new edit after inverse continues proven predecessor lineage without creating a Redo branch',async()=>{
    const f=await setup(),first=await write(f,'One'),second=await write(f,'Two');f.base=(await undo(a,second.operation,f.lease)).revision;
    const latest=await write(f,'New after Undo');assert.equal((await read()).count,2);f.base=(await undo(a,latest.operation,f.lease)).revision;
    assert.equal((await read()).top.operation_id,first.operation);await undo(a,first.operation,f.lease);assert.equal((await record(f.id)).title,'Initial');assert.equal((await read()).count,0);await release(f);
  });
  await test('delete and recreate with identical UUID/value cannot revive an old Undo lineage',async()=>{
    const f=await setup(),saved=await write(f,'One');await release(f);await admin('delete from budget_items where id=$1',[f.id]);
    await admin("insert into budget_items(id,trip_id,title,note,category,amount,twd_amount,currency,exchange_rate,payer_id) values($1,$2,'One','Initial note','交通',900,900,'TWD',1,$3)",[f.id,trip,actorA]);
    const base=Number((await admin('select revision from app_private.budget_metadata_groups where resource_id=$1 and group_key=\'title\'',[f.id]))[0].revision);
    f.lease=await call(a,leaseAction(a,f.id,'title','acquire',{base}));await deny(()=>undo(a,saved.operation,f.lease),'40001');assert.equal((await record(f.id)).title,'One');await release(f);
  });
  await test('reader returns only current-tab top metadata and never exposes before-images or capability',async()=>{
    const f=await setup();await write(f,'Private committed text');const data=await read();assert.equal(data.count,1);
    assert.deepEqual(Object.keys(data.top).sort(),['expected_revision','group','id','kind','operation_id']);
    assert(!JSON.stringify(data).includes('Private committed text'));assert(!JSON.stringify(data).includes(identities.get(a).token));assert.equal((await read(a,uuid())).count,0);await release(f);
  });
  await test('a linked payment created then deleted still fences the old budget metadata inverse',async()=>{
    const f=await setup(),saved=await write(f,'One');await release(f);const linked=uuid();
    await admin("insert into actual_expenses(id,trip_id,title,amount,twd_amount,currency,exchange_rate,payer_id,budget_item_id,payment_origin) values($1,$2,'Temporary linked',100,100,'TWD',1,$3,$4,'manual')",[linked,trip,actorB,f.id]);
    await admin('delete from actual_expenses where id=$1',[linked]);f.lease=await call(a,leaseAction(a,f.id,'title','acquire',{base:1}));
    await deny(()=>undo(a,saved.operation,f.lease),'40001');assert.equal((await record(f.id)).title,'One');await release(f);
  });
  return {read,clear,undoAction,undo,setup,write,release,deny};
}
