import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {calculatePricing,recordAllocations} from '../src/lib/budgetFinance.js';
export async function pricingGroupCases(h){
 const {test,admin,query,a,b,actorA,actorB,trip,secretTrip,fixture,record,call,leaseAction,patchAction,overlap,identities}=h;
 const get=async(id,kind='budget')=>(await query(a,'select public.read_budget_metadata_snapshot_v3($1,$2) d',[trip,identities.get(a).session]))[0].d.metadataRecords.find(r=>r.kind===kind&&r.id===id).groups.find(g=>g.group==='pricing');
 const acquire=async(c,id,options={})=>call(c,leaseAction(c,id,'pricing','acquire',{base:(await get(id,options.kind||'budget')).revision,...options}));
 const release=(c,id,l,options={})=>call(c,leaseAction(c,id,'pricing','release',{epoch:l.epoch,...options}));
 const form=async(id,patch={},kind='budget')=>({...((await get(id,kind)).value),...patch});
 const mutate=async(c,id,l,p,options={})=>call(c,patchAction(c,id,'pricing',p,{epoch:l.epoch,base:l.revision,...options}));
 const people=async(id,kind='budget')=>admin(`select user_id,share_amount from ${kind==='budget'?'budget_item_participants':'actual_expense_participants'} where ${kind==='budget'?'budget_item_id':'actual_expense_id'}=$1 order by user_id`,[id]);
 const retained=async({source='estimated',active=true}={})=>{const id=await fixture(),aid=uuid();
  if(source==='estimated')await admin("update budget_items set currency='JPY',exchange_rate=0.2,twd_amount=180 where id=$1",[id]);
  await admin("insert into actual_expenses(id,trip_id,budget_item_id,title,category,amount,currency,exchange_rate,twd_amount,payer_id,payment_origin,twd_amount_source,actual_twd_amount,payment_active,payment_history) select $1,trip_id,id,'Retained original','交通',amount,currency,exchange_rate,twd_amount,payer_id,'budget_toggle',$3,case when $3='actual' then twd_amount else null end,$4,'[{\"event\":\"preserve\"}]' from budget_items where id=$2",[aid,id,source,active]);
  await admin('insert into actual_expense_participants(actual_expense_id,user_id,share_amount) select $1,user_id,share_amount from budget_item_participants where budget_item_id=$2',[aid,id]);return {id,aid};};
 await test('pricing v3 reports independent group support and private vectors without leaking capability',async()=>{
  const {id,aid}=await retained();const data=(await query(a,'select public.read_budget_metadata_snapshot_v3($1,$2) d',[trip,identities.get(a).session]))[0].d;
  assert.equal(data.metadataProtocol.schemaVersion,3);assert.deepEqual(data.metadataProtocol.groups,['title','note','category','payer','links','pricing']);const r=data.metadataRecords.find(r=>r.id===id);assert.equal(r.supported,false);assert.equal(r.groups.find(g=>g.group==='pricing').supported,true);assert.equal(r.groups.find(g=>g.group==='payer').supported,false);assert(!JSON.stringify(data).includes('token_hash'));assert.equal((await get(aid,'actual')).supported,false);
 });
 for(const [name,patch] of [['per_person',{pricing_mode:'per_person',unit_amount:'12.34',participantIds:[actorA,actorB,actorA]}],['split_total',{pricing_mode:'split_total',amount:'10.01'}],['custom',{pricing_mode:'custom',shares:{[actorA]:'600',[actorB]:'300'}}]])await test(`pricing ${name} uses exact existing finance formulas and sums allocations`,async()=>{
  const id=await fixture(),before=await record(id),l=await acquire(a,id),p=await form(id,patch);const result=await mutate(a,id,l,p);const expected=calculatePricing(p);assert.equal((await record(id)).amount,expected.amount);assert.equal((await record(id)).twd_amount,expected.twd_amount);
  for(const key of ['title','note','category','payer_id','is_fixed','auto_created_actual_expense_id'])assert.deepEqual((await record(id))[key],before[key]);
  const rows=await people(id),alloc=recordAllocations(await record(id),rows);assert.equal(Object.values(alloc).reduce((sum,n)=>sum+n,0),expected.twd_amount);assert.equal(result.revision,l.revision+1);await release(a,id,l);
 });
 await test('custom 600+300+300 is 1200 and mode changes preserve explicit custom values',async()=>{
  const third=uuid();await admin('insert into auth.users(id) values($1)',[third]);await admin("insert into trip_members(trip_id,user_id,role,status) values($1,$2,'editor','approved')",[trip,third]);const id=await fixture(),l=await acquire(a,id);const p=await form(id,{pricing_mode:'custom',participantIds:[actorA,actorB,third],shares:{[actorA]:'600',[actorB]:'300',[third]:'300'}});await mutate(a,id,l,p);assert.equal((await record(id)).amount,1200);assert.deepEqual((await people(id)).map(r=>Number(r.share_amount)).sort((x,y)=>x-y),[300,300,600]);await release(a,id,l);
 });
 await test('zero is valid; blank negative nonfinite excess precision and unknown members reject atomically',async()=>{
  const id=await fixture(),l=await acquire(a,id),p=await form(id),before=await record(id),rows=await people(id);
  for(const invalid of [{amount:''},{amount:'-1'},{amount:'NaN'},{amount:'Infinity'},{amount:'1.001'},{amount:'10000000000'},{currency:'JPY',exchange_rate:'0'},{participantIds:[]},{participantIds:[h.pending]},{participantIds:[h.outsider]}]){
   await assert.rejects(()=>mutate(a,id,l,{...p,...invalid}),e=>['22023','42501','40001'].includes(e.code));assert.deepEqual(await record(id),before);assert.deepEqual(await people(id),rows);
  }
  await mutate(a,id,l,{...p,amount:'0'});assert.equal((await record(id)).amount,0);await release(a,id,l);
 });
 await test('pricing no-op preserves versions participant IDs and exact replay survives release',async()=>{
  const id=await fixture();await admin('update budget_item_participants set share_amount=null where budget_item_id=$1',[id]);const base=(await get(id)).revision,l=await acquire(a,id,{base}),p=await form(id),before=await record(id),rows=await admin('select * from budget_item_participants where budget_item_id=$1 order by id',[id]),request=uuid();
  const r=await mutate(a,id,l,p,{base,request});assert.equal(r.revision,base);assert.deepEqual(await record(id),before);assert.deepEqual(await admin('select * from budget_item_participants where budget_item_id=$1 order by id',[id]),rows);await release(a,id,l);assert.deepEqual(await mutate(a,id,l,p,{base,request}),r);
 });
 for(const active of [true,false])await test(`single retained ${active?'active':'inactive'} estimated bundle commits both prices and preserves IDs history receipts provenance`,async()=>{
  const {id,aid}=await retained({active}),base=(await get(id)).revision,l=await acquire(a,id,{base}),before=await record(aid,'actual');
  const attachment=uuid();await release(a,id,l);await admin("insert into attachments(id,trip_id,target_type,target_id,file_name,file_url,file_size,file_type,uploaded_by) values($1,$2,'actual_expense',$3,'keep.pdf','keep.pdf',1,'application/pdf',$4)",[attachment,trip,aid,actorA]);
  const lease=await acquire(a,id,{base}),p=await form(id,{amount:'1200'});await mutate(a,id,lease,p,{base});const actual=await record(aid,'actual');assert.equal((await record(id)).amount,1200);assert.equal(actual.amount,1200);assert.equal(actual.twd_amount,Math.round(1200*before.exchange_rate));
  for(const key of ['id','budget_item_id','budget_origin_id','payment_history','payment_active','payment_origin','twd_amount_source','actual_twd_amount','title','category','payer_id'])assert.deepEqual(actual[key],before[key]);assert.equal((await admin('select count(*)::int n from attachments where id=$1',[attachment]))[0].n,1);await release(a,id,lease);
 });
 await test('known retained debit rejects unsafe reprice while participant-only edit preserves known debit/source',async()=>{
  const {id,aid}=await retained({source:'actual'}),base=(await get(id)).revision,l=await acquire(a,id,{base}),p=await form(id),before=await record(aid,'actual');await assert.rejects(()=>mutate(a,id,l,{...p,amount:'1200'},{base}),e=>e.code==='0A000');assert.deepEqual(await record(aid,'actual'),before);
  await mutate(a,id,l,{...p,participantIds:[actorA]},{base});const after=await record(aid,'actual');for(const key of ['actual_twd_amount','twd_amount','payment_origin','twd_amount_source','payment_history'])assert.deepEqual(after[key],before[key]);assert.equal((await people(aid,'actual')).length,1);await release(a,id,l);
 });
 for(const other of ['title','payer'])await test(`pricing and ${other} are independent genuinely overlapping writes`,async()=>{
  const id=await fixture(),l=await acquire(a,id),r=await call(b,leaseAction(b,id,other)),p=await form(id,{amount:'1100'}),result=await overlap(`pricing-${other}`,patchAction(a,id,'pricing',p,{epoch:l.epoch,base:l.revision}),patchAction(b,id,other,other==='title'?'Concurrent title':actorB,{epoch:r.epoch}));assert(result.outcomes.every(o=>o.ok));assert.equal((await record(id)).amount,1100);assert.equal((await record(id))[other==='payer'?'payer_id':other],other==='title'?'Concurrent title':actorB);await release(a,id,l);await call(b,leaseAction(b,id,other,'release',{epoch:r.epoch}));return {overlap:true};
 });
 await test('pricing contention uniquely admits one account and same-account tabs do not share bundle',async()=>{
  const id=await fixture(),base=(await get(id)).revision,r=await overlap('pricing-exclusive',leaseAction(a,id,'pricing','acquire',{base}),leaseAction(b,id,'pricing','acquire',{base}));assert(r.outcomes[0].data.granted);assert.equal(r.outcomes[1].data.granted,false);
  await query(b,"select set_config('request.jwt.claim.sub',$1,false)",[actorA]);try{assert.equal((await acquire(b,id)).granted,false);}finally{await query(b,"select set_config('request.jwt.claim.sub',$1,false)",[actorB]);await release(a,id,r.outcomes[0].data);}return {overlap:true};
 });
 await test('missing peer capability rejects full retained bundle without partial writes',async()=>{
  const {id,aid}=await retained(),base=(await get(id)).revision,l=await acquire(a,id,{base}),before=await record(id),actual=await record(aid,'actual'),p=await form(id,{amount:'1200'});
  await admin("update app_private.budget_metadata_groups set token_hash=null where kind='actual' and resource_id=$1 and group_key='pricing'",[aid]);await assert.rejects(()=>mutate(a,id,l,p,{base}),e=>e.code==='55P03');assert.deepEqual(await record(id),before);assert.deepEqual(await record(aid,'actual'),actual);await release(a,id,l);
 });
 await test('second Actual participant fault rolls back both parents children versions request and preserved history',async()=>{
  const {id,aid}=await retained(),base=(await get(id)).revision,l=await acquire(a,id,{base}),before=await record(id),actual=await record(aid,'actual'),bp=await people(id),ap=await people(aid,'actual'),p=await form(id,{pricing_mode:'custom',shares:{[actorA]:'600',[actorB]:'600'}});
  await admin(`create function budget_test.pricing_fault() returns trigger language plpgsql as $$begin if new.actual_expense_id='${aid}'::uuid and new.user_id='${actorB}'::uuid then raise exception 'Injected pricing participant fault' using errcode='22012';end if;return new;end $$;create trigger zz_pricing_fault before insert or update on actual_expense_participants for each row execute function budget_test.pricing_fault()`);
  try{await assert.rejects(()=>mutate(a,id,l,p,{base}),e=>e.code==='22012');assert.deepEqual(await record(id),before);assert.deepEqual(await record(aid,'actual'),actual);assert.deepEqual(await people(id),bp);assert.deepEqual(await people(aid,'actual'),ap);assert.equal((await get(id)).revision,base);}
  finally{await admin('drop trigger zz_pricing_fault on actual_expense_participants;drop function budget_test.pricing_fault()');await release(a,id,l);}
 });
 await test('multi retained ambiguous origin and historical foreign graph fail closed',async()=>{
  const {id,aid}=await retained();await admin("insert into actual_expenses(trip_id,budget_item_id,title,amount,twd_amount,currency,exchange_rate,payer_id) values($1,$2,'Second',1,1,'TWD',1,$3)",[trip,id,actorA]);await assert.rejects(()=>acquire(a,id,{base:(0)}),e=>e.code==='0A000');
  const other=await fixture();await admin("update budget_items set currency='JPY' where id=$1",[other]);await admin("update trips set start_date=current_date-2,end_date=current_date+1 where id=$1",[trip]);try{await assert.rejects(()=>acquire(a,other),e=>e.code==='0A000');}finally{await admin('update trips set start_date=current_date+10,end_date=current_date+15 where id=$1',[trip]);}
 });
 await test('rates and membership generation changes reject stale pricing intent without blind retry',async()=>{
  const id=await fixture(),l=await acquire(a,id),p=await form(id,{amount:'1100'}),before=await record(id);await admin("update trips set budget_exchange_rates=jsonb_build_object('rates',jsonb_build_object('JPY',0.4)) where id=$1",[trip]);await assert.rejects(()=>mutate(a,id,l,p),e=>e.code==='40001');assert.deepEqual(await record(id),before);await release(a,id,l);
 });
 await test('retained estimate preserves its historical rate after shared quote changed',async()=>{
  const {id,aid}=await retained(),before=await record(aid,'actual');await admin("update trips set budget_exchange_rates=jsonb_build_object('rates',jsonb_build_object('JPY',0.5)) where id=$1",[trip]);
  const l=await acquire(a,id),p=await form(id,{amount:'1200'});await mutate(a,id,l,p);assert.equal((await record(id)).exchange_rate,before.exchange_rate);assert.equal((await record(aid,'actual')).exchange_rate,before.exchange_rate);assert.equal((await record(id)).twd_amount,Math.round(1200*before.exchange_rate));await release(a,id,l);
 });
 await test('pricing expiry takeover fences late patch release and renew for the entire retained bundle',async()=>{
  const {id,aid}=await retained(),l=await acquire(a,id),p=await form(id,{amount:'1200'});
  await admin("update app_private.budget_metadata_groups set expires_at=clock_timestamp()-interval '1 second' where resource_id=any($1::uuid[]) and group_key='pricing'",[[id,aid]]);
  const fresh=await acquire(b,id);assert(fresh.granted);assert(fresh.epoch>l.epoch);await assert.rejects(()=>mutate(a,id,l,p),e=>e.code==='55P03');await release(a,id,l);
  assert.equal((await call(a,leaseAction(a,id,'pricing','renew',{base:l.revision,epoch:l.epoch}))).granted,false);
  assert.equal((await admin("select count(*)::int n from app_private.budget_metadata_groups where resource_id=any($1::uuid[]) and group_key='pricing' and user_id=$2",[[id,aid],actorB]))[0].n,2);await release(b,id,fresh);
 });
 await test('approved participant revocation invalidates pricing vector and leaves parent plus joins untouched',async()=>{
  const id=await fixture(),l=await acquire(a,id),p=await form(id,{amount:'1200'}),before=await record(id),rows=await people(id);
  await admin("update trip_members set status='pending' where trip_id=$1 and user_id=$2",[trip,actorB]);
  try{await assert.rejects(()=>mutate(a,id,l,p),e=>['40001','42501','22023'].includes(e.code));assert.deepEqual(await record(id),before);assert.deepEqual(await people(id),rows);}finally{await admin("update trip_members set status='approved' where trip_id=$1 and user_id=$2",[trip,actorB]);await release(a,id,l);}
 });
 await test('standalone known foreign Actual preserves authoritative debit source and receipt while reallocating',async()=>{
  const id=uuid();await admin("insert into actual_expenses(id,trip_id,title,note,amount,twd_amount,currency,exchange_rate,payer_id,payment_origin,actual_twd_amount,twd_amount_source) values($1,$2,'Manual known','Keep',900,777,'JPY',0.3,$3,'manual',777,'actual')",[id,trip,actorA]);
  await admin('insert into actual_expense_participants(actual_expense_id,user_id) values($1,$2),($1,$3)',[id,actorA,actorB]);const before=await record(id,'actual'),l=await acquire(a,id,{kind:'actual'}),p=await form(id,{pricing_mode:'custom',shares:{[actorA]:'600',[actorB]:'600'}},'actual');
  await mutate(a,id,l,p,{kind:'actual'});const row=await record(id,'actual');assert.equal(row.amount,1200);assert.equal(row.twd_amount,777);assert.equal(row.actual_twd_amount,777);for(const key of ['twd_amount_source','payer_id','note','payment_history','payment_origin'])assert.deepEqual(row[key],before[key]);assert.equal(Object.values(recordAllocations(row,await people(id,'actual'))).reduce((n,v)=>n+v,0),777);await release(a,id,l,{kind:'actual'});
 });
 await test('pricing boundary fences affected text inverse and retains another accounts unrelated stack',async()=>{
  const f=await h.undoQA.setup(),saved=await h.undoQA.write(f,'Before finance'),other=await fixture();const lb=await call(b,leaseAction(b,other,'title')),op=uuid();await call(b,patchAction(b,other,'title','B unrelated',{epoch:lb.epoch,request:op}));const bStack=await h.undoQA.read(b);
  const l=await acquire(a,f.id),p=await form(f.id,{amount:'1200'});await mutate(a,f.id,l,p);await assert.rejects(()=>h.undoQA.undo(a,saved.operation,f.lease),e=>e.code==='40001');assert.deepEqual(await h.undoQA.read(b),bStack);await release(a,f.id,l);await h.undoQA.release(f);await call(b,leaseAction(b,other,'title','release',{epoch:lb.epoch,base:1}));
 });
 await test('pricing child row-first lock is observed and whole patch NOWAIT aborts without deadlock',async()=>{
  const id=await fixture(),l=await acquire(a,id),p=await form(id,{amount:'1200'}),before=await record(id),gate=1+Math.floor(Math.random()*1000000000);
  await admin('select pg_advisory_lock($1::bigint)',[gate]);await b.query('begin');await query(b,'select 1 from budget_item_participants where budget_item_id=$1 for update',[id]);const work=query(b,"select budget_test.hold_result('{}'::jsonb,$1::bigint)",[gate]);
  try{await h.waitUntil(async()=>{const rows=await h.activity();return rows.find(r=>r.pid===h.pidB)?.blocking_pids.includes(h.observerPid);},'pricing child holder');const outcome=await h.transaction(a,()=>mutate(a,id,l,p));assert.equal(outcome.code,'55P03');assert.deepEqual(await record(id),before);h.observations.push({name:'pricing-child-row-nowait',proof:await h.activity(),outcome});}
  finally{await admin('select pg_advisory_unlock($1::bigint)',[gate]);await work;await b.query('rollback');await release(a,id,l);}return {overlap:true,nowait:true};
 });
 await test('retained set changing during observed trip lock wait rejects stale complete bundle',async()=>{
  const {id,aid}=await retained(),l=await acquire(a,id),p=await form(id,{amount:'1300'}),before=await record(id),actual=await record(aid,'actual');
  await admin('select pg_advisory_lock(hashtextextended($1::text,0))',[trip]);const work=h.transaction(a,()=>mutate(a,id,l,p));
  try{await h.waitUntil(async()=>{const rows=await h.activity();return rows.find(r=>r.pid===h.pidA)?.blocking_pids.includes(h.observerPid);},'pricing awaits source change');const proof=await h.activity();
   await admin("update app_private.budget_metadata_groups set expires_at=clock_timestamp()-interval '1 second' where resource_id=any($1::uuid[]) and group_key='pricing'",[[id,aid]]);
   await admin("insert into actual_expenses(trip_id,budget_item_id,title,amount,twd_amount,currency,exchange_rate,payer_id,payment_origin) values($1,$2,'Second while expired',100,100,'TWD',1,$3,'manual')",[trip,id,actorB]);
   await admin('select pg_advisory_unlock(hashtextextended($1::text,0))',[trip]);const outcome=await work;assert.equal(outcome.ok,false);assert(['40001','55P03','0A000'].includes(outcome.code));assert.deepEqual(await record(id),before);assert.deepEqual(await record(aid,'actual'),actual);h.observations.push({name:'pricing-retained-set-during-wait',proof,outcome});
  }finally{await admin('select pg_advisory_unlock(hashtextextended($1::text,0))',[trip]);await work;await release(a,id,l);}return {overlap:true};
 });
 await test('concurrent trip rate refresh preserves retained prices fences stale vectors and rejects unlinked overwrite',async()=>{
  const {id,aid}=await retained(),l=await acquire(a,id),p=await form(id,{amount:'1400'}),before=await record(aid,'actual');
  const quote={source:'ExchangeRate-API',quoted_at:new Date().toISOString(),rates:{JPY:0.6,USD:32,EUR:35,KRW:0.025,HKD:4}};
  const result=await overlap('pricing-versus-trip-rates',patchAction(a,id,'pricing',p,{epoch:l.epoch,base:l.revision}),{text:'public.update_trip_budget_rates($1,$2::jsonb,false)',values:[trip,JSON.stringify(quote)]});
  // The existing rates RPC deliberately excludes every retained Budget. Its
  // independent quote change may commit; the next old pricing vector must fail.
  assert.equal(result.outcomes[0].ok,true);assert.equal(result.outcomes[1].ok,true);assert.equal((await record(id)).exchange_rate,before.exchange_rate);assert.equal((await record(aid,'actual')).exchange_rate,before.exchange_rate);assert.equal((await record(aid,'actual')).amount,1400);
  await assert.rejects(()=>mutate(a,id,l,{...result.outcomes[0].data.value,amount:'1500'},{base:result.outcomes[0].data.revision}),e=>e.code==='40001');await release(a,id,l);
  const unlinked=await fixture();await admin("update budget_items set currency='JPY' where id=$1",[unlinked]);const lease=await acquire(a,unlinked),intent=await form(unlinked,{amount:'1500'}),nextQuote={...quote,rates:{...quote.rates,JPY:0.7}};
  const locked=await overlap('pricing-unlinked-versus-trip-rates',patchAction(a,unlinked,'pricing',intent,{epoch:lease.epoch,base:lease.revision}),{text:'public.update_trip_budget_rates($1,$2::jsonb,false)',values:[trip,JSON.stringify(nextQuote)]});
  assert.equal(locked.outcomes[0].ok,true);assert.equal(locked.outcomes[1].code,'55P03');assert.equal((await record(unlinked)).exchange_rate,0.6);assert.equal(Number((await admin('select budget_exchange_rates->\'rates\'->>\'JPY\' rate from trips where id=$1',[trip]))[0].rate),0.6);await release(a,unlinked,lease);return {overlap:true};
 });
 return {get,form,acquire,release,mutate,retained};
}
