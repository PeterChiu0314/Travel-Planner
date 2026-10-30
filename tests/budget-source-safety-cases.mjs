import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import fs from 'node:fs/promises';
export async function sourceSafetyCases(h,s,pay) {
 const {test,admin,query,a,b,actorA,actorB,trip,fixture,record,call,identities,leaseAction,patchAction,overlap}=h;
 const full=id=>admin('select to_jsonb(r) v from actual_expenses r where id=$1',[id]);
 await test('Source rejects missing cross-trip fixed and broken backlink destinations without writes',async()=>{
  const id=await s.actual(),budget=await fixture(),before=await full(id);
  await assert.rejects(()=>s.preview(a,id,'relink_only',uuid()),e=>e.code==='0A000');
  await admin('update budget_items set is_fixed=true where id=$1',[budget]);await assert.rejects(()=>s.preview(a,id,'relink_only',budget),e=>e.code==='0A000');await admin('update budget_items set is_fixed=false where id=$1',[budget]);
  const t=uuid();await admin("insert into trips(id,title,name,destination,start_date,end_date,owner_id) values($1,'Other','Other','Japan','2090-01-01','2090-01-06',$2)",[t,actorA]);await admin('update budget_items set trip_id=$2 where id=$1',[budget,t]);await assert.rejects(()=>s.preview(a,id,'relink_only',budget),e=>e.code==='0A000');await admin('update budget_items set trip_id=$2 where id=$1',[budget,trip]);
  await admin('update budget_items set auto_created_actual_expense_id=$2 where id=$1',[budget,id]);await assert.rejects(()=>s.preview(a,id,'relink_only',budget),e=>e.code==='0A000');await admin('update budget_items set auto_created_actual_expense_id=null where id=$1',[budget]);assert.deepEqual(await full(id),before);
 });
 await test('Source multi retained link preserves every other Actual backlink money joins and receipts',async()=>{
  const paid=await pay.paid(),extra=await s.actual(paid.id),id=await s.actual(),before=await full(paid.aid),other=await full(extra),budget=await record(paid.id),l=await s.acquire(a,id,'relink_only',paid.id);assert(l.granted);assert.equal(l.preview.versions.retained[0].actuals.length,2);await s.mutate(a,id,l);await s.release(a,id,l);assert.deepEqual(await full(paid.aid),before);assert.deepEqual(await full(extra),other);assert.equal((await record(paid.id)).auto_created_actual_expense_id,budget.auto_created_actual_expense_id);assert.equal((await admin('select count(*)::int n from actual_expenses where budget_item_id=$1',[paid.id]))[0].n,3);
 });
 await test('Source raw linked INSERT UPDATE DELETE FK SET NULL and whole-save cannot bypass protocol even without a live lease',async()=>{
  const budget=await fixture(),id=await s.actual(budget),before=await full(id),fresh=await s.actual();
  await assert.rejects(()=>query(a,'update actual_expenses set budget_item_id=$2 where id=$1',[fresh,budget]),e=>e.code==='55000');
  await assert.rejects(()=>query(a,"insert into actual_expenses(trip_id,budget_item_id,title,amount,twd_amount,currency,exchange_rate,payer_id,actual_twd_amount,twd_amount_source) values($1,$2,'Bypass',9,9,'TWD',1,$3,9,'actual')",[trip,budget,actorA]),e=>e.code==='55000');
  await assert.rejects(()=>query(a,'delete from actual_expenses where id=$1',[id]),e=>e.code==='55000');
  await assert.rejects(()=>query(a,'delete from budget_items where id=$1',[budget]),e=>e.code==='55000');assert.deepEqual(await full(id),before);assert(await record(budget));
 });
 await test('Source bound destination intent extra financial payload and unfinished manifest reject atomically',async()=>{
  const budget=await fixture(),id=await s.actual(),l=await s.acquire(a,id,'relink_only',budget),before=await full(id);
  try{await assert.rejects(()=>s.mutate(a,id,l,{value:{amount:1}}),e=>e.code==='22023');await assert.rejects(()=>s.mutate(a,id,l,{value:{action:'apply_source_data'}}),e=>e.code==='40001');
   const action=s.action(a,id,l),values=action.values;await assert.rejects(()=>call(a,{text:'app_private.prepare_budget_source($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)',values}),e=>e.code==='40001');assert.deepEqual(await full(id),before);assert.equal((await admin('select count(*)::int n from app_private.budget_metadata_effects'))[0].n,0);
  }finally{await s.release(a,id,l);}
 });
 for(const dependency of ['source text','rates','member','actor role','source deletion'])await test(`Source rejects changed ${dependency} between confirmed preview and admission`,async()=>{
  const budget=await fixture(),id=await s.actual(),p=await s.preview(a,id,'apply_source_data',budget),before=await full(id);
  try{
   if(dependency==='source text')await admin("update budget_items set title='New committed source' where id=$1",[budget]);
   if(dependency==='rates')await admin('update app_private.budget_pricing_trip_versions set rates=rates+1 where trip_id=$1',[trip]);
   if(dependency==='member')await admin("update trip_members set status='pending' where trip_id=$1 and user_id=$2",[trip,actorB]);
   if(dependency==='actor role')await admin("update trip_members set role='viewer' where trip_id=$1 and user_id=$2",[trip,actorA]);
   if(dependency==='source deletion')await admin('delete from budget_items where id=$1',[budget]);
   await assert.rejects(()=>call(a,s.lease(a,id,p)),e=>['40001','42501','0A000'].includes(e.code));assert.deepEqual(await full(id),before);
  }finally{if(dependency==='member')await admin("update trip_members set status='approved' where trip_id=$1 and user_id=$2",[trip,actorB]);if(dependency==='actor role')await admin("update trip_members set role='owner' where trip_id=$1 and user_id=$2",[trip,actorA]);}
 });
 await test('Source no-op preserves Undo pointers; changed Source fences only affected lineage and own tab stack',async()=>{
  const id=await s.actual(),budget=await fixture(),unrelated=await fixture(),l=await call(b,leaseAction(b,unrelated,'title'));
  await call(b,patchAction(b,unrelated,'title','Other actor undo',{epoch:l.epoch}));await call(b,leaseAction(b,unrelated,'title','release',{base:1,epoch:l.epoch}));
  const read=()=>admin('select * from app_private.budget_metadata_undo_stack where user_id=$1 order by position',[actorB]),before=await read();assert(before.length>0);
  const noop=await s.acquire(a,id,'relink_only',null);await s.mutate(a,id,noop);await s.release(a,id,noop);assert.deepEqual(await read(),before);
  const changed=await s.acquire(a,id,'relink_only',budget);await s.mutate(a,id,changed);await s.release(a,id,changed);assert.deepEqual(await read(),before);assert.equal((await admin("select count(*)::int n from app_private.budget_metadata_undo_operations where resource_id=$1 and group_key='source'",[id]))[0].n,0);assert.equal((await admin('select count(*)::int n from app_private.budget_metadata_undo_lineage where resource_id=any($1::uuid[])',[[id,budget]]))[0].n,0);
 });
 await test('Source same account other tab cannot mutate or release the exact capability',async()=>{
  const budget=await fixture(),id=await s.actual(),l=await s.acquire(a,id,'relink_only',budget),session=uuid(),token=uuid();
  await assert.rejects(()=>s.mutate(a,id,l,{session,token}),e=>e.code==='55P03');await call(a,s.lease(a,id,l.preview,'release',{session,token,epoch:l.epoch}));
  const held=(await admin("select user_id,session_id,lease_epoch from app_private.budget_metadata_groups where resource_id=$1 and group_key='source'",[id]))[0];assert.equal(held.user_id,actorA);assert.equal(held.session_id,identities.get(a).session);assert.equal(Number(held.lease_epoch),l.epoch);await s.mutate(a,id,l);await s.release(a,id,l);
 });
 await test('Source departed foreign Relink preserves frozen rate debit and history; Apply and settled relink reject whole intent',async()=>{
  const budget=await fixture(),id=await s.actual();await admin("update actual_expenses set currency='JPY',amount=4500,exchange_rate=0.2 where id=$1",[id]);const dates=(await admin('select start_date::text,end_date::text,status from trips where id=$1',[trip]))[0];await admin("update trips set start_date='2020-01-01',status='traveling' where id=$1",[trip]);
  try{const before=await record(id,'actual'),l=await s.acquire(a,id,'relink_only',budget);await s.mutate(a,id,l);await s.release(a,id,l);const after=await record(id,'actual');for(const k of Object.keys(before).filter(k=>!['updated_at','budget_item_id','budget_origin_id'].includes(k)))assert.deepEqual(after[k],before[k],k);await assert.rejects(()=>s.preview(a,id,'apply_source_data',budget),e=>e.code==='0A000');await admin("update trips set status='settled' where id=$1",[trip]);await assert.rejects(()=>s.preview(a,id,'relink_only',null),e=>e.code==='0A000');assert.deepEqual(await record(id,'actual'),after);
  }finally{await admin('update trips set start_date=$2,end_date=$3,status=$4 where id=$1',[trip,dates.start_date,dates.end_date,dates.status]);}
 });
 await test('Source parent row-first holder overlaps admission and NOWAIT rejects without deadlock or leaked capability',async()=>{
  const budget=await fixture(),id=await s.actual(),p=await s.preview(b,id,'relink_only',budget),gate=938031;await admin('select pg_advisory_lock($1::bigint)',[gate]);
  const work=h.transaction(a,async()=>{await query(a,'select id from actual_expenses where id=$1 for update',[id]);await query(a,'select budget_test.await_gate($1::bigint)',[gate]);});
  try{await h.waitUntil(async()=>(await h.activity()).find(r=>r.pid===h.pidA)?.blocking_pids.includes(h.observerPid),'Source parent row-first gate');const proof=await h.activity();await assert.rejects(()=>call(b,s.lease(b,id,p)),e=>e.code==='55P03');assert((await h.activity()).find(r=>r.pid===h.pidA)?.blocking_pids.includes(h.observerPid));assert.equal((await admin("select user_id from app_private.budget_metadata_groups where resource_id=$1 and group_key='source'",[id]))[0].user_id,null);h.observations.push({name:'source-parent-nowait',proof,outcome:'55P03'});}finally{await admin('select pg_advisory_unlock($1::bigint)',[gate]);assert((await work).ok);}return {overlap:true,nowait:true};
 });
 await test('Source committed source text after admission rejects Apply without partial writes or a request receipt',async()=>{
  const budget=await fixture(),id=await s.actual(),l=await s.acquire(a,id,'apply_source_data',budget),before=await full(id),request=uuid();
  // Independent narrow Title remains permitted on the read-only source.
  const title=await call(b,leaseAction(b,budget,'title'));await call(b,patchAction(b,budget,'title','Changed during confirmation',{epoch:title.epoch}));await call(b,leaseAction(b,budget,'title','release',{base:1,epoch:title.epoch}));
  await assert.rejects(()=>s.mutate(a,id,l,{request}),e=>e.code==='40001');assert.deepEqual(await full(id),before);assert.equal((await admin('select count(*)::int n from app_private.budget_metadata_requests where request_id=$1',[request]))[0].n,0);await s.release(a,id,l);
 });
 await test('Source Pricing and Relink admissions overlap without stealing the independent Pricing capability',async()=>{
  const budget=await fixture(),id=await s.actual(),p=await s.preview(b,id,'relink_only',budget),base=p.versions.checks.find(c=>c.kind==='budget'&&c.id===budget&&c.group==='pricing').revision;
  const r=await overlap('source-pricing-admissions',leaseAction(a,budget,'pricing','acquire',{base}),s.lease(b,id,p));assert(r.outcomes.every(x=>x.ok&&x.data.granted));const source={...r.outcomes[1].data,preview:p};await s.mutate(b,id,source);await s.release(b,id,source);const held=(await admin("select user_id,lease_epoch from app_private.budget_metadata_groups where resource_id=$1 and group_key='pricing'",[budget]))[0];assert.equal(held.user_id,actorA);assert.equal(Number(held.lease_epoch),r.outcomes[0].data.epoch);await call(a,leaseAction(a,budget,'pricing','release',{base,epoch:r.outcomes[0].data.epoch}));return {overlap:true,outcomes:r.outcomes};
 });
 await test('Source actor revocation during observed overlap wait prevents admission and preserves the whole Actual',async()=>{
  const budget=await fixture(),id=await s.actual(),p=await s.preview(b,id,'apply_source_data',budget),before=await full(id);await admin('select pg_advisory_lock(hashtextextended($1::text,0))',[trip]);const work=h.transaction(b,()=>call(b,s.lease(b,id,p)));
  try{await h.waitUntil(async()=>(await h.activity()).find(r=>r.pid===h.pidB)?.blocking_pids.includes(h.observerPid),'Source member wait');const proof=await h.activity();await admin("update trip_members set status='pending' where trip_id=$1 and user_id=$2",[trip,actorB]);await admin('select pg_advisory_unlock(hashtextextended($1::text,0))',[trip]);const outcome=await work;assert.equal(outcome.code,'42501');assert.deepEqual(await full(id),before);h.observations.push({name:'source-member-wait',proof,outcome});}finally{await admin('select pg_advisory_unlock(hashtextextended($1::text,0))',[trip]);await work;await admin("update trip_members set status='approved' where trip_id=$1 and user_id=$2",[trip,actorB]);}return {overlap:true};
 });
 await test('Source retained set changes during observed overlap wait reject the old vector without authority expansion',async()=>{
  const budget=await fixture(),id=await s.actual(),p=await s.preview(b,id,'relink_only',budget);await admin('select pg_advisory_lock(hashtextextended($1::text,0))',[trip]);
  const work=h.transaction(b,()=>call(b,s.lease(b,id,p)));try{await h.waitUntil(async()=>(await h.activity()).find(r=>r.pid===h.pidB)?.blocking_pids.includes(h.observerPid),'Source retained wait');const proof=await h.activity();const other=await s.actual(budget);await admin('select pg_advisory_unlock(hashtextextended($1::text,0))',[trip]);const outcome=await work;assert.equal(outcome.code,'40001');assert.equal((await record(id,'actual')).budget_item_id,null);assert.equal((await record(other,'actual')).budget_item_id,budget);h.observations.push({name:'source-retained-wait',proof,outcome});}finally{await admin('select pg_advisory_unlock(hashtextextended($1::text,0))',[trip]);await work;}return {overlap:true};
 });
 await test('Source mutation and Payment admission actually overlap and stale Payment vector cannot toggle newly linked Actual',async()=>{
  const budget=await fixture(),id=await s.actual(),l=await s.acquire(a,id,'relink_only',budget),p=await pay.get(b,budget);const r=await overlap('source-payment',s.action(a,id,l),pay.lease(b,budget,'acquire',{base:p.revision,versions:p.value.versions,intent:'paid'}));assert(r.outcomes[0].ok);assert.equal(r.outcomes[1].code,'40001');await s.release(a,id,l);assert.equal((await record(id,'actual')).budget_item_id,budget);assert.equal((await admin('select count(*)::int n from actual_expenses where budget_item_id=$1',[budget]))[0].n,1);return {overlap:true,outcomes:r.outcomes};
 });
 await test('Source Apply and Actual payer admission actually overlap; payer cannot enter an in-flight changed group',async()=>{
  const budget=await fixture(),id=await s.actual(),l=await s.acquire(a,id,'apply_source_data',budget);const r=await overlap('source-payer',s.action(a,id,l),leaseAction(b,id,'payer','acquire',{kind:'actual'}));assert(r.outcomes[0].ok);assert.equal(r.outcomes[1].code,'0A000');assert.equal((await record(id,'actual')).payer_id,actorA);await s.release(a,id,l);return {overlap:true,outcomes:r.outcomes};
 });
 await test('Source used reverse refuses financial rollback after protocol is disabled',async()=>{
  const before=await admin('select to_jsonb(r) v from actual_expenses r order by id'),reverse=await fs.readFile(new URL('../docs/qa/2026-10-30-budget-source-rollback.sql',import.meta.url),'utf8');await admin('update app_private.budget_source_protocol set enabled=false;update app_private.budget_metadata_groups set expires_at=null');try{await assert.rejects(()=>admin(reverse),/Source used or active/);await admin('rollback');assert.deepEqual(await admin('select to_jsonb(r) v from actual_expenses r order by id'),before);}finally{await admin('update app_private.budget_source_protocol set enabled=true');}
 });
}
