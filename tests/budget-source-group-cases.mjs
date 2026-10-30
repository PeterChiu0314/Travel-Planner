import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {sourceSafetyCases} from './budget-source-safety-cases.mjs';
export async function sourceGroupCases(h,pay) {
 const {test,admin,query,a,b,actorA,actorB,trip,fixture,record,call,leaseAction,patchAction,identities,overlap}=h;
 const preview=(c,id,action,budget)=>call(c,{text:'public.read_budget_source_preview($1,$2,$3,$4)',values:[trip,id,action,budget]});
 const lease=(c,id,p,action='acquire',options={})=>{const who=identities.get(c);return {text:'public.budget_source_lease($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)',values:[trip,'actual',id,options.session||who.session,options.token||who.token,action,p.revision,options.epoch??null,JSON.stringify(p.versions),JSON.stringify({action:p.action,budget_id:p.budget_id})]};};
 const acquire=async(c,id,action,budget)=>{const p=await preview(c,id,action,budget),l=await call(c,lease(c,id,p));return {...l,preview:p};};
 const release=(c,id,l)=>call(c,lease(c,id,l.preview,'release',{epoch:l.epoch}));
 const action=(c,id,l,options={})=>{const who=identities.get(c);return {text:'public.mutate_budget_source($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)',values:[trip,'actual',id,options.session||who.session,options.token===undefined?who.token:options.token,options.epoch===undefined?l.epoch:options.epoch,l.preview.revision,JSON.stringify({action:l.preview.action,budget_id:l.preview.budget_id,versions:l.preview.versions,...options.value}),options.request||uuid()]};};
 const mutate=(c,id,l,options={})=>call(c,action(c,id,l,options));
 const actual=async(budget=null,cost=900)=>{const id=uuid(),enabled=(await admin('select enabled from app_private.budget_source_protocol'))[0].enabled;
  // Isolated admin fixture, not an application bypass: the runtime protocol
  // rejects legacy/raw linked inserts once enabled.
  if(budget&&enabled)await admin('update app_private.budget_source_protocol set enabled=false');
  try{await admin("insert into actual_expenses(id,trip_id,budget_item_id,title,category,note,amount,twd_amount,currency,exchange_rate,payer_id,payment_origin,twd_amount_source,actual_twd_amount,payment_history) values($1,$2,$3,'Actual draft','交通','Actual note',900,$4,'TWD',1,$5,'manual','actual',$4,'[{\"keep\":true}]'::jsonb)",[id,trip,budget,cost,actorB]);await admin('insert into actual_expense_participants(actual_expense_id,user_id) values($1,$2),($1,$3)',[id,actorA,actorB]);}finally{if(budget&&enabled)await admin('update app_private.budget_source_protocol set enabled=true');}return id;};
 const people=id=>admin('select * from actual_expense_participants where actual_expense_id=$1 order by user_id',[id]);
 const states=()=>admin('select * from app_private.budget_metadata_groups order by kind,resource_id,group_key');
 await test('Source starts dormant with narrow invoker RPCs and private protocol ACLs',async()=>{
  const id=await actual(),budget=await fixture();assert.equal((await admin('select enabled from app_private.budget_source_protocol'))[0].enabled,false);await assert.rejects(()=>preview(a,id,'relink_only',budget),e=>e.code==='55000');
  for(const signature of ['public.mutate_budget_source(uuid,text,uuid,uuid,uuid,bigint,bigint,jsonb,uuid)','public.budget_source_lease(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb,jsonb)','public.read_budget_metadata_snapshot_v6(uuid,uuid)']){const row=(await admin("select prosecdef,proconfig,has_function_privilege('anon',oid,'execute') anon from pg_proc where oid=$1::regprocedure",[signature]))[0];assert.equal(row.prosecdef,false);assert.equal(row.anon,false);assert(row.proconfig.includes('search_path=""'));}
  assert.equal((await admin("select has_table_privilege('authenticated','app_private.budget_source_protocol','select,insert,update,delete') allowed"))[0].allowed,false);await admin('update app_private.budget_source_protocol set enabled=true');
 });
 await test('Relink-only preserves all money people payer text activity history and receipt while capturing first origin',async()=>{
  const id=await actual(null,777),budget=await fixture(),receipt=uuid();await admin("insert into attachments(id,trip_id,target_type,target_id,file_name,file_url,file_type,file_size,uploaded_by) values($1,$2,'actual_expense',$3,'keep','keep','image/png',1,$4)",[receipt,trip,id,actorA]);const before=await record(id,'actual'),joins=await people(id),attachments=await admin('select * from attachments where id=$1',[receipt]);const l=await acquire(a,id,'relink_only',budget);assert(l.granted);assert.deepEqual(l.targets.map(t=>t.group).sort(),['payment','source']);await mutate(a,id,l);await release(a,id,l);const after=await record(id,'actual');assert.equal(after.budget_item_id,budget);assert.equal(after.budget_origin_id,budget);for(const k of Object.keys(before).filter(k=>!['updated_at','budget_item_id','budget_origin_id'].includes(k)))assert.deepEqual(after[k],before[k],k);assert.deepEqual(await people(id),joins);assert.deepEqual(await admin('select * from attachments where id=$1',[receipt]),attachments);
 });
 await test('manual unlink retains historical origin and blocks ambiguous A to B origin-only deleted source and generated detach',async()=>{
  const old=await fixture(),next=await fixture(),id=await actual(old);await assert.rejects(()=>preview(a,id,'relink_only',next),e=>e.code==='0A000');let l=await acquire(a,id,'relink_only',null);assert(l.granted);await mutate(a,id,l);await release(a,id,l);assert.equal((await record(id,'actual')).budget_origin_id,old);await assert.rejects(()=>preview(a,id,'relink_only',old),e=>e.code==='0A000');await admin('delete from budget_items where id=$1',[old]);await assert.rejects(()=>preview(a,id,'apply_source_data',next),e=>e.code==='0A000');
  const generated=await pay.paid();await assert.rejects(()=>preview(a,generated.aid,'relink_only',null),e=>e.code==='0A000');assert.equal((await record(generated.id)).auto_created_actual_expense_id,generated.aid);
 });
 await test('same source no-op leaves all revisions graph contents and Undo unchanged',async()=>{
  const budget=await fixture(),id=await actual(budget),l=await acquire(a,id,'relink_only',budget),before=await record(id,'actual'),groups=await states();const result=await mutate(a,id,l);assert.equal(result.revision,l.preview.revision);assert.deepEqual(await record(id,'actual'),before);assert.deepEqual(await states(),groups);await release(a,id,l);
 });
 await test('Apply commits custom pricing people payer title category note atomically and preserves provenance identity',async()=>{
  const budget=await fixture(),id=await actual();await admin("update budget_items set title='Source title',category='住宿',note='Source note',pricing_mode='custom',split_type='custom' where id=$1",[budget]);await admin('update budget_item_participants set share_amount=case when user_id=$2 then 600 else 300 end where budget_item_id=$1',[budget,actorA]);const before=await record(id,'actual'),joins=await people(id),l=await acquire(a,id,'apply_source_data',budget);assert(l.granted);assert(l.targets.some(t=>t.group==='pricing'));await mutate(a,id,l);await release(a,id,l);const after=await record(id,'actual');assert.equal(after.title,'Source title');assert.equal(after.note,'Source note');assert.equal(after.category,'住宿');assert.equal(after.payer_id,actorA);assert.equal(after.pricing_mode,'custom');assert.equal(after.amount,900);assert.equal(after.actual_twd_amount,900);assert.equal(after.payment_origin,before.payment_origin);assert.deepEqual(after.payment_history,before.payment_history);const next=await people(id);assert.deepEqual(next.map(p=>p.id),joins.map(p=>p.id));assert.equal(Number(next.find(p=>p.user_id===actorA).share_amount),600);
 });
 await test('Apply known debit mismatch rejects the entire intent without even copying text',async()=>{
  const budget=await fixture(),id=await actual(null,777),before=await record(id,'actual');await assert.rejects(()=>preview(a,id,'apply_source_data',budget),e=>e.code==='22023');assert.deepEqual(await record(id,'actual'),before);
 });
 await test('Source Pricing owner blocks Apply but permits Relink and fences the old Pricing vector',async()=>{
  const budget=await fixture(),id=await actual(),g=(await query(a,'select public.read_budget_metadata_snapshot_v3($1,$2) d',[trip,identities.get(a).session]))[0].d.metadataRecords.find(r=>r.id===budget).groups.find(g=>g.group==='pricing');const held=await call(a,leaseAction(a,budget,'pricing','acquire',{base:g.revision}));assert(held.granted);
  try{assert.equal((await acquire(b,id,'apply_source_data',budget)).granted,false);const l=await acquire(b,id,'relink_only',budget);assert(l.granted);await mutate(b,id,l);await release(b,id,l);
   assert((await admin("select graph_revision from app_private.budget_metadata_groups where kind='budget' and resource_id=$1 and group_key='pricing'",[budget]))[0].graph_revision>g.value.versions.graph);
   await assert.rejects(()=>call(a,patchAction(a,budget,'pricing',{...g.value,amount:'1200'},{base:g.revision,epoch:held.epoch})),e=>['40001','0A000'].includes(e.code));assert.equal((await record(budget)).amount,900);
  }finally{await call(a,leaseAction(a,budget,'pricing','release',{base:g.revision,epoch:held.epoch}));}
 });
 await test('real overlapping Actual title and Relink preserve both committed changes',async()=>{
  const budget=await fixture(),id=await actual(),held=await call(a,leaseAction(a,id,'title','acquire',{kind:'actual'})),l=await acquire(b,id,'relink_only',budget);assert(held.granted&&l.granted);
  const result=await overlap('source-title-relink',patchAction(a,id,'title','Concurrent Actual title',{kind:'actual',epoch:held.epoch}),action(b,id,l));assert(result.outcomes.every(r=>r.ok));assert.equal((await record(id,'actual')).title,'Concurrent Actual title');assert.equal((await record(id,'actual')).budget_item_id,budget);await release(b,id,l);await call(a,leaseAction(a,id,'title','release',{kind:'actual',base:1,epoch:held.epoch}));return {overlap:true,outcomes:result.outcomes};
 });
 await test('two Source admissions actually overlap with one winner and exact tab capability isolation',async()=>{
  const budget=await fixture(),id=await actual(),p=await preview(a,id,'relink_only',budget),result=await overlap('source-exclusive',lease(a,id,p),lease(b,id,p));assert(result.outcomes[0].data.granted);assert.equal(result.outcomes[1].data.granted,false);const l={...result.outcomes[0].data,preview:p};await assert.rejects(()=>mutate(b,id,l),e=>['55P03','40001'].includes(e.code));await release(a,id,l);return {overlap:true,outcomes:result.outcomes};
 });
 await test('Source replay after release is immutable and action destination or session mismatch cannot reuse its request',async()=>{
  const budget=await fixture(),id=await actual(),l=await acquire(a,id,'relink_only',budget),request=uuid(),result=await mutate(a,id,l,{request});await release(a,id,l);const before=await states();assert.deepEqual(await mutate(a,id,l,{request,token:null,epoch:null}),result);assert.deepEqual(await states(),before);await assert.rejects(()=>mutate(a,id,l,{request,value:{budget_id:null}}),e=>e.code==='22023');
 });
 await test('participant second write fault rolls back Actual Source money versions joins effects and ledger',async()=>{
  const budget=await fixture(),id=await actual();await admin('delete from actual_expense_participants where actual_expense_id=$1 and user_id=$2',[id,actorB]);const l=await acquire(a,id,'apply_source_data',budget),before=await record(id,'actual'),joins=await people(id),groups=await states(),request=uuid();await admin(`create function budget_test.source_fault() returns trigger language plpgsql as $$begin if new.user_id='${actorB}'::uuid then raise exception 'Source second child fault' using errcode='22012';end if;return new;end $$;create trigger zz_source_fault before insert on actual_expense_participants for each row execute function budget_test.source_fault()`);
  try{await assert.rejects(()=>mutate(a,id,l,{request}),e=>e.code==='22012');assert.deepEqual(await record(id,'actual'),before);assert.deepEqual(await people(id),joins);assert.deepEqual(await states(),groups);assert.equal((await admin('select count(*)::int n from app_private.budget_metadata_requests where request_id=$1',[request]))[0].n,0);assert.equal((await admin('select count(*)::int n from app_private.budget_metadata_effects'))[0].n,0);}finally{await admin('drop trigger zz_source_fault on actual_expense_participants;drop function budget_test.source_fault()');await release(a,id,l);}
 });
 await test('live Actual target group blocks Apply and live Payment blocks source topology changes',async()=>{
  const budget=await fixture(),id=await actual(),title=await call(a,leaseAction(a,id,'title','acquire',{kind:'actual'}));try{assert.equal((await acquire(b,id,'apply_source_data',budget)).granted,false);}finally{await call(a,leaseAction(a,id,'title','release',{kind:'actual',epoch:title.epoch}));}
  const payment=await pay.acquire(a,budget);try{assert.equal((await acquire(b,id,'relink_only',budget)).granted,false);}finally{await pay.release(a,budget,payment);}
 });
 await test('Source expiry takeover and late release preserve newer holder epochs and reject stale mutation',async()=>{
  const budget=await fixture(),id=await actual(),l=await acquire(a,id,'relink_only',budget);await admin("update app_private.budget_metadata_groups set expires_at=clock_timestamp()-interval '1 second' where source_bundle->>'id'=$1",[id]);const newer=await acquire(b,id,'relink_only',budget);assert(newer.epoch>l.epoch);await assert.rejects(()=>mutate(a,id,l),e=>['55P03','40001'].includes(e.code));await release(a,id,l);assert.equal((await admin("select user_id from app_private.budget_metadata_groups where kind='actual' and resource_id=$1 and group_key='source'",[id]))[0].user_id,actorB);await release(b,id,newer);
 });
 const source={preview,lease,acquire,release,action,mutate,actual};
 await sourceSafetyCases(h,source,pay);
 return source;
}
