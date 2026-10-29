import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {createBudgetMetadataEditor,createBudgetMetadataService,validBudgetMetadataSnapshot} from '../src/lib/budgetMetadataService.js';
export async function metadataChoiceCases(h) {
  const {test,admin,query,a,b,actorA,actorB,trip,secretTrip,fixture,record,call,leaseAction,patchAction,overlap,identities}=h;
  await admin('update app_private.budget_metadata_protocol set enabled=true');
  await admin('update app_private.budget_metadata_undo_protocol set enabled=true');
  const lease=(c,id,g,opts={})=>call(c,leaseAction(c,id,g,'acquire',opts));
  const patch=(c,id,g,v,l,opts={})=>call(c,patchAction(c,id,g,v,{epoch:l.epoch,...opts}));
  const release=(c,id,g,l)=>call(c,leaseAction(c,id,g,'release',{epoch:l.epoch}));
  const item=async(tripId=trip)=>{const id=uuid();await admin("insert into itinerary_items(id,trip_id,title,type,date,day_index,sort_order) values($1,$2,'Linked visit','attraction',current_date+10,0,0)",[id,tripId]);return id;};
  const value=async(id,g)=>(await admin("select app_private.budget_metadata_value('budget',$1,$2) v",[id,g]))[0].v;
  const graph=()=>admin("select * from (select 'b' k,to_jsonb(t) v from budget_items t union all select 'a',to_jsonb(t) from actual_expenses t union all select 'p',to_jsonb(t) from budget_item_participants t union all select 'ap',to_jsonb(t) from actual_expense_participants t) x order by k,v::text");
  await test('v2 snapshot strict group schema with old v1 preserved',async()=>{
    const snap=(await query(a,'select public.read_budget_metadata_snapshot_v2($1,$2) data',[trip,identities.get(a).session]))[0].data;
    assert.equal(snap.metadataProtocol.schemaVersion,2);assert.deepEqual(snap.metadataProtocol.groups,['title','note','category','payer','links']);
    assert(snap.metadataRecords.filter(r=>r.kind==='budget').every(r=>r.groups.length===5));
    assert(validBudgetMetadataSnapshot(snap,trip));
    assert.equal((await query(a,'select public.read_budget_metadata_snapshot($1,$2) data',[trip,identities.get(a).session]))[0].data.metadataProtocol.schemaVersion,1);
  });
  await test('actual JS controller uses schema-v2 SQL transport for nullable payer and whole link set',async()=>{
    const id=await fixture(),visit=await item(),identity=identities.get(a);
    const sdk={auth:{getSession:async()=>({data:{session:{user:{id:actorA}}}})},rpc:async(name,args)=>{
      const keys=Object.keys(args);try{return {data:(await query(a,`select public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) data`,Object.values(args).map(v=>Array.isArray(v)||v&&typeof v==='object'?JSON.stringify(v):v)))[0].data};}catch(error){return {error};}
    }};
    const client=createBudgetMetadataEditor({service:createBudgetMetadataService(sdk),sessionId:identity.session,
      read:async()=>({ok:true,data:{...(await query(a,'select public.read_budget_metadata_snapshot_v2($1,$2) data',[trip,identity.session]))[0].data,metadataVerified:true}})});
    try{client.configure(actorA,trip,true,true);assert((await client.refresh()).ok);
      for(const [group,v] of [['payer',null],['category','餐飲'],['links',[visit]]]){const g=client.get('budget',id,group);assert(await client.focus(g));client.input(g,v);assert(await client.save(g));assert.equal(client.view(g).dirty,false);assert(await client.release(g));}
      assert.equal((await record(id)).payer_id,null);assert.deepEqual(await value(id,'links'),[visit]);
    }finally{await client.dispose();}
  });
  await test('v2 reader is invoker STABLE auth-only; viewer read cannot confer group authority',async()=>{
    const [f]=await admin("select p.prosecdef,p.provolatile,has_function_privilege('anon',p.oid,'EXECUTE') anon from pg_proc p where p.oid='public.read_budget_metadata_snapshot_v2(uuid,uuid)'::regprocedure");assert.equal(f.prosecdef,false);assert.equal(f.provolatile,'s');assert.equal(f.anon,false);
    await query(a,"select set_config('request.jwt.claim.sub',$1,false)",[h.viewer]);try{const id=await fixture();assert((await query(a,'select public.read_budget_metadata_snapshot_v2($1,$2) d',[trip,uuid()]))[0].d);await assert.rejects(()=>lease(a,id,'category'),e=>e.code==='42501');}finally{await query(a,"select set_config('request.jwt.claim.sub',$1,false)",[actorA]);}
  });
  for(const [group,other,v,w] of [['category','title','餐飲','New title'],['payer','note',actorB,'Other note']]) {
    await test(`${group} and ${other} real overlapping writes preserve both groups and financial fields`,async()=>{
      const id=await fixture(),before=await record(id),l=await lease(a,id,group),r=await lease(b,id,other);
      const result=await overlap(`choice-${group}-${other}`,patchAction(a,id,group,v,{epoch:l.epoch}),patchAction(b,id,other,w,{epoch:r.epoch}));
      assert(result.outcomes.every(o=>o.ok));const after=await record(id);assert.equal(after[group==='payer'?'payer_id':group],v);assert.equal(after[other],w);
      for(const key of ['amount','currency','exchange_rate','twd_amount','subcategory'])assert.deepEqual(after[key],before[key]);
      await release(a,id,group,l);await release(b,id,other,r);return {overlap:true};
    });
  }
  await test('category same-group contention has unique winner',async()=>{
    const id=await fixture(),result=await overlap('choice-category-exclusive',leaseAction(a,id,'category'),leaseAction(b,id,'category'));
    assert(result.outcomes[0].data.granted);assert.equal(result.outcomes[1].data.granted,false);await release(a,id,'category',result.outcomes[0].data);return {overlap:true};
  });
  await test('payer validates pending outsider and null without touching financial data',async()=>{
    const id=await fixture(),l=await lease(a,id,'payer'),before=await record(id);
    for(const actor of [h.pending,h.outsider])await assert.rejects(()=>patch(a,id,'payer',actor,l),e=>e.code==='22023');
    const result=await patch(a,id,'payer',null,l);assert.equal(result.value,null);const after=await record(id);assert.equal(after.payer_id,null);assert.equal(after.amount,before.amount);await release(a,id,'payer',l);
  });
  await test('category preserves legacy subcategory and exact standalone Actual debit provenance',async()=>{
    const id=uuid();await admin("insert into actual_expenses(id,trip_id,title,category,subcategory,amount,currency,exchange_rate,twd_amount,payer_id,twd_amount_source,actual_twd_amount) values($1,$2,'Manual','交通','Legacy subtype',300,'JPY',0.2,71,$3,'actual',71)",[id,trip,actorA]);
    const before=await record(id,'actual'),l=await lease(a,id,'category',{kind:'actual'});await patch(a,id,'category','住宿',l,{kind:'actual'});
    const after=await record(id,'actual');for(const key of Object.keys(before).filter(k=>!['category','updated_at'].includes(k)))assert.deepEqual(after[key],before[key]);
    await call(a,leaseAction(a,id,'category','release',{kind:'actual',epoch:l.epoch}));
    const payer=await lease(a,id,'payer',{kind:'actual'});await patch(a,id,'payer',actorB,payer,{kind:'actual'});
    const final=await record(id,'actual');for(const key of Object.keys(before).filter(k=>!['category','payer_id','updated_at'].includes(k)))assert.deepEqual(final[key],before[key]);
    await call(a,leaseAction(a,id,'payer','release',{kind:'actual',epoch:payer.epoch}));
  });
  await test('retained payment category payer links reject the entire operation without bundle',async()=>{
    const id=await fixture();await admin("insert into actual_expenses(trip_id,budget_item_id,title,amount,twd_amount,currency,exchange_rate,payer_id) values($1,$2,'Retained',7,7,'TWD',1,$3)",[trip,id,actorA]);const before=await graph();
    for(const g of ['category','payer','links']){await assert.rejects(()=>lease(a,id,g),e=>e.code==='0A000');await assert.rejects(()=>patch(a,id,g,g==='links'?[]:g==='payer'?actorB:'住宿',{epoch:1}),e=>e.code==='0A000');}
    assert.deepEqual(await graph(),before);
  });
  await test('links normalizes and atomically replaces complete set while title writer overlaps',async()=>{
    const id=await fixture(),i=await item(),j=await item(),l=await lease(a,id,'links'),r=await lease(b,id,'title'),before=await record(id);
    const result=await overlap('choice-links-title',patchAction(a,id,'links',[j,i,j],{epoch:l.epoch}),patchAction(b,id,'title','Linked title',{epoch:r.epoch}));assert(result.outcomes.every(o=>o.ok));
    assert.deepEqual(await value(id,'links'),[i,j].sort());const saved=result.outcomes[0].data;assert.equal(saved.revision,1);
    const request=uuid(),p=await patch(a,id,'links',[j],l,{base:1,request});assert.equal(p.revision,2);assert.deepEqual(await value(id,'links'),[j]);assert.deepEqual(await patch(a,id,'links',[j],l,{base:1,request}),p);
    const after=await record(id);for(const k of ['amount','payer_id','subcategory','twd_amount'])assert.deepEqual(after[k],before[k]);
    await release(a,id,'links',l);await release(b,id,'title',r);return {overlap:true};
  });
  await test('cross-trip links rejected before any child mutation',async()=>{
    const id=await fixture(),i=await item(secretTrip),l=await lease(a,id,'links');await assert.rejects(()=>patch(a,id,'links',[i],l),e=>e.code==='22023');assert.deepEqual(await value(id,'links'),[]);await release(a,id,'links',l);
  });
  await test('injected second link insert failure rolls back collection revision signal and request',async()=>{
    const id=await fixture(),i=await item(),j=await item(),l=await lease(a,id,'links'),before=await graph();
    await admin(`create function budget_test.reject_choice_link() returns trigger language plpgsql as $$begin if new.itinerary_item_id='${j}'::uuid then raise exception 'Injected link fault' using errcode='22012';end if;return new;end $$;create trigger zz_choice_fault before insert on itinerary_budget_items for each row execute function budget_test.reject_choice_link()`);
    try{await assert.rejects(()=>patch(a,id,'links',[i,j],l),e=>e.code==='22012');assert.deepEqual(await value(id,'links'),[]);assert.deepEqual(await graph(),before);assert.equal((await admin("select revision::int r from app_private.budget_metadata_groups where resource_id=$1 and group_key='links'",[id]))[0].r,0);}
    finally{await admin('drop trigger zz_choice_fault on itinerary_budget_items;drop function budget_test.reject_choice_link()');await release(a,id,'links',l);}
  });
  await test('legacy and cascade links fence stale collection versions',async()=>{
    const id=await fixture(),i=await item();await admin('insert into itinerary_budget_items(budget_item_id,itinerary_item_id) values($1,$2)',[id,i]);
    await assert.rejects(()=>lease(a,id,'links'),e=>e.code==='40001');await admin('delete from itinerary_items where id=$1',[i]);assert.deepEqual(await value(id,'links'),[]);
    assert.equal((await admin("select revision::int r from app_private.budget_metadata_groups where resource_id=$1 and group_key='links'",[id]))[0].r,2);
  });
  await test('new unrelated category payer links preserve title Undo and never push new operations',async()=>{
    const id=await fixture(),title=await lease(a,id,'title'),saved=await patch(a,id,'title','Undoable',title);await release(a,id,'title',title);
    const count=async()=>(await query(a,'select public.read_budget_metadata_undo($1,$2) data',[trip,identities.get(a).session]))[0].data.count;
    const before=await count();for(const [g,v] of [['category','住宿'],['payer',actorB],['links',[await item()]]]){const l=await lease(b,id,g);await patch(b,id,g,v,l);await release(b,id,g,l);assert.equal(await count(),before);}
    const l=await lease(a,id,'title',{base:saved.revision});await query(a,'select public.undo_budget_metadata_group($1,$2,$3,$4,$5,$6)',[trip,identities.get(a).session,saved.request_id,identities.get(a).token,l.epoch,uuid()]);
    assert.equal((await record(id)).title,'Initial');await release(a,id,'title',l);
  });
  await test('new choices honor wildcard paused protocol and viewer grants',async()=>{
    const id=await fixture(),l=await lease(a,id,'category'),updated=(await record(id)).updated_at;await assert.rejects(()=>call(b,h.legacyAction(b,id,updated)),e=>e.code==='55P03');await release(a,id,'category',l);
    await admin('update app_private.budget_metadata_protocol set enabled=false');try{await assert.rejects(()=>lease(a,id,'payer'),e=>e.code==='55000');}finally{await admin('update app_private.budget_metadata_protocol set enabled=true');}
  });
}
