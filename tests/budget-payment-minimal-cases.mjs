import assert from 'node:assert/strict';
import { randomUUID as uuid } from 'node:crypto';
import {readFile} from 'node:fs/promises';
export async function paymentMinimalCases(h, p) {
 const {test,admin,query,a,b,actorA,actorB,trip,record,call,leaseAction,patchAction,identities,overlap}=h;
 const group=async(c,id,name)=>(await query(c,'select public.read_budget_metadata_snapshot_v3($1,$2) d',[trip,identities.get(c).session]))[0].d.metadataRecords.find(r=>r.id===id).groups.find(g=>g.group===name);
 const untouched=async id=>admin("select kind,resource_id,group_key,revision,lease_epoch,user_id,session_id,token_hash,expires_at,pricing_bundle from app_private.budget_metadata_groups where resource_id=$1 and group_key in('pricing','payer') order by kind,group_key",[id]);
 for(const intent of ['unpaid','paid'])await test(`minimal: Pricing and retained ${intent} admissions really overlap; stale pricing refuses`,async()=>{
  const {id,aid}=await p.paid();if(intent==='paid'){const l=await p.acquire(b,id,{intent:'unpaid'});await p.mutate(b,id,l,{action:'unpaid'});await p.release(b,id,l);}
  const pricing=await group(a,id,'pricing'),payment=await p.get(b,id),before=await record(aid,'actual');
  const r=await overlap(`minimal-pricing-${intent}`,leaseAction(a,id,'pricing','acquire',{base:pricing.revision}),p.lease(b,id,'acquire',{base:payment.revision,versions:payment.value.versions,intent}));
  assert(r.outcomes.every(x=>x.ok&&x.data.granted));const held=r.outcomes[0].data,l=r.outcomes[1].data;
  const epochs=await untouched(id),actualEpochs=await untouched(aid);assert.equal(l.intent,intent);assert.equal(l.targets.length,2);assert(l.targets.every(t=>t.group==='payment'));
  try{await p.mutate(b,id,l,{action:intent});assert.deepEqual(await untouched(id),epochs);assert.deepEqual(await untouched(aid),actualEpochs);
   const after=await record(aid,'actual');for(const key of Object.keys(before).filter(k=>!['payment_active','updated_at'].includes(k)))assert.deepEqual(after[key],before[key],key);
   await assert.rejects(()=>call(a,patchAction(a,id,'pricing',{...pricing.value,amount:'1200'},{base:pricing.revision,epoch:held.epoch})),e=>e.code==='40001');assert.equal((await record(id)).amount,900);
  }finally{await p.release(b,id,l);await call(a,leaseAction(a,id,'pricing','release',{base:pricing.revision,epoch:held.epoch}));}
  return {overlap:true,outcomes:r.outcomes,stalePricing:'40001',unrelatedEpochsUnchanged:true};
 });
 await test('minimal: existing payer capability is neither acquired overwritten nor released by retained status toggle',async()=>{
  const {id,aid}=await p.paid(),who=identities.get(a);
  // Retained payer UI remains unsupported. Model an already-held capability at
  // the compatibility boundary without enabling a new payer mutation API.
  await admin("update app_private.budget_metadata_groups set user_id=$2,session_id=$3,token_hash=sha256(convert_to($4::text,'UTF8')),lease_epoch=lease_epoch+1,expires_at=clock_timestamp()+interval '2 minutes' where kind='budget' and resource_id=$1 and group_key='payer'",[id,actorA,who.session,who.token]);
  const before=await untouched(id),row=await record(aid,'actual');let l;
  try{l=await p.acquire(b,id,{intent:'unpaid'});assert(l.granted);await p.mutate(b,id,l,{action:'unpaid'});await p.release(b,id,l);assert.deepEqual(await untouched(id),before);assert.equal((await record(aid,'actual')).payer_id,row.payer_id);}
  finally{await admin("update app_private.budget_metadata_groups set user_id=null,session_id=null,token_hash=null,expires_at=null where resource_id=$1 and group_key='payer'",[id]);}
 });
 await test('minimal: every retained payment target is required; one independently held Actual blocks all admission',async()=>{
  const {id,aid}=await p.paid(),second=uuid();await admin("insert into actual_expenses(id,trip_id,budget_item_id,title,amount,twd_amount,currency,exchange_rate,payer_id,payment_origin) values($1,$2,$3,'second',31,31,'TWD',1,$4,'manual')",[second,trip,id,actorA]);
  const date=await p.acquire(a,second,{kind:'actual',intent:'set_paid_at'});try{const denied=await p.acquire(b,id,{intent:'unpaid'});assert.equal(denied.granted,false);assert.equal((await p.get(b,id)).held,false);}finally{await p.release(a,second,date,{kind:'actual'});}
  const l=await p.acquire(b,id,{intent:'unpaid'});assert.equal(l.targets.length,3);assert.deepEqual(new Set(l.targets.map(t=>t.id)),new Set([id,aid,second]));assert(l.targets.every(t=>t.group==='payment'));
  await admin("update app_private.budget_metadata_groups set lease_epoch=lease_epoch+1 where kind='actual' and resource_id=$1 and group_key='payment'",[second]);
  await assert.rejects(()=>p.mutate(b,id,l,{action:'unpaid'}),e=>e.code==='55P03');assert((await record(aid,'actual')).payment_active);assert((await record(second,'actual')).payment_active);await p.release(b,id,l);
  // A lost peer epoch must not be cleared by a late release.
  assert.equal((await p.get(b,second,'actual')).owner_id,actorB);await admin("update app_private.budget_metadata_groups set expires_at=null,user_id=null where resource_id=$1 and group_key='payment'",[second]);
 });
 await test('minimal: two opposite retained mutations overlap; exactly one fresh-version result and no interleaving',async()=>{
  const {id,aid}=await p.paid(),l=await p.acquire(a,id,{intent:'unpaid'}),other=await p.get(b,id);
  const r=await overlap('minimal-opposite-status',p.action(a,id,l,{action:'unpaid'}),p.lease(b,id,'acquire',{intent:'paid',base:other.revision,versions:other.value.versions}));
  assert(r.outcomes[0].ok);assert.equal(r.outcomes[1].code,'40001');assert.equal((await record(aid,'actual')).payment_active,false);await p.release(a,id,l);return {overlap:true,outcomes:r.outcomes};
 });
 await test('minimal: bound intent rejects action switch and renew switch; old unbound admission fails closed',async()=>{
  const id=await h.fixture(),l=await p.acquire(a,id,{intent:'paid'});
  try{await assert.rejects(()=>p.mutate(a,id,l,{action:'unpaid'}),e=>e.code==='40001');await assert.rejects(()=>call(a,p.lease(a,id,'renew',{base:l.revision,epoch:l.epoch,versions:l.value.versions,intent:'unpaid'})),e=>e.code==='40001');
   await assert.rejects(()=>query(a,'select public.budget_payment_lease($1,$2,$3,$4,$5,$6,$7,$8,$9)',[trip,'budget',id,identities.get(a).session,identities.get(a).token,'acquire',l.revision,l.epoch,l.value.versions]),e=>e.code==='55000');assert.equal((await admin('select count(*)::int n from actual_expenses where budget_item_id=$1',[id]))[0].n,0);
  }finally{await p.release(a,id,l);}
 });
 await test('minimal: pricing commit after payment admission rejects stale checks; fresh authoritative read keeps latest money',async()=>{
  const id=await h.fixture();await admin("update budget_items set currency='JPY' where id=$1",[id]);const first=await p.acquire(b,id),created=await p.mutate(b,id,first,{action:'paid'}),aid=created.created_id;await p.release(b,id,first);
  const pricing=await group(a,id,'pricing'),held=await call(a,leaseAction(a,id,'pricing','acquire',{base:pricing.revision}));assert(held.granted);
  const l=await p.acquire(b,id,{intent:'unpaid'});assert(l.granted);
  try{await call(a,patchAction(a,id,'pricing',{...pricing.value,amount:'1200'},{base:pricing.revision,epoch:held.epoch}));
   const after=await record(aid,'actual');assert.equal(after.amount,1200);await assert.rejects(()=>p.mutate(b,id,l,{action:'unpaid'}),e=>e.code==='40001');await p.release(b,id,l);
   const fresh=await p.acquire(b,id,{intent:'unpaid'});assert(fresh.granted);await p.mutate(b,id,fresh,{action:'unpaid'});await p.release(b,id,fresh);assert.equal((await record(aid,'actual')).amount,after.amount);
  }finally{await p.release(b,id,l);await call(a,leaseAction(a,id,'pricing','release',{base:(await group(a,id,'pricing')).revision,epoch:held.epoch}));}
 });
 await test('minimal: same request replay after release does not require a new bundle or advance graph/epochs',async()=>{
  const {id,aid}=await p.paid(),l=await p.acquire(b,id,{intent:'unpaid'}),request=uuid(),result=await p.mutate(b,id,l,{action:'unpaid'},{request});await p.release(b,id,l);
  const before=await admin('select * from app_private.budget_metadata_groups where resource_id=any($1::uuid[]) order by kind,resource_id,group_key',[[id,aid]]);
  assert.deepEqual(await p.mutate(b,id,l,{action:'unpaid'},{request,token:null,epoch:null}),result);assert.deepEqual(await admin('select * from app_private.budget_metadata_groups where resource_id=any($1::uuid[]) order by kind,resource_id,group_key',[[id,aid]]),before);
 });
 await test('minimal: retained set changes during observed admission wait rejects the whole old set',async()=>{
  const {id,aid}=await p.paid(),snapshot=await p.get(b,id),second=uuid();await admin('select pg_advisory_lock(hashtextextended($1::text,0))',[trip]);
  const work=h.transaction(b,()=>call(b,p.lease(b,id,'acquire',{intent:'unpaid',base:snapshot.revision,versions:snapshot.value.versions})));
  try{await h.waitUntil(async()=>{const rows=await h.activity();return rows.find(r=>r.pid===h.pidB)?.blocking_pids.includes(h.observerPid);},'minimal retained-set wait');const proof=await h.activity();
   await admin("insert into actual_expenses(id,trip_id,budget_item_id,title,amount,twd_amount,currency,exchange_rate,payer_id,payment_origin) values($1,$2,$3,'new retained',12,12,'TWD',1,$4,'manual')",[second,trip,id,actorA]);await admin('select pg_advisory_unlock(hashtextextended($1::text,0))',[trip]);
   const outcome=await work;assert.equal(outcome.code,'40001');assert((await record(aid,'actual')).payment_active);assert((await record(second,'actual')).payment_active);assert.equal((await p.get(b,id)).held,false);h.observations.push({name:'minimal-retained-set-wait',proof,outcome});
  }finally{await admin('select pg_advisory_unlock(hashtextextended($1::text,0))',[trip]);await work;}return {overlap:true};
 });
 await test('minimal: retained no-op leaves all graph revisions and unrelated lease epochs unchanged',async()=>{
  const {id,aid}=await p.paid(),before=await untouched(id),peer=await untouched(aid),l=await p.acquire(b,id,{intent:'paid'}),value=l.value;
  const result=await p.mutate(b,id,l,{action:'paid'});assert.equal(result.revision,l.revision);assert.deepEqual(result.value,value);assert.deepEqual(await untouched(id),before);assert.deepEqual(await untouched(aid),peer);await p.release(b,id,l);
 });
 await test('minimal: used extension refuses reverse even when disabled and all leases are cleared',async()=>{
  const before=await admin('select to_jsonb(a) v from actual_expenses a order by id');await admin('update app_private.budget_payment_protocol set enabled=false;update app_private.budget_metadata_groups set expires_at=null');
  const {readFile}=await import('node:fs/promises');const reverse=await readFile(new URL('../docs/qa/2026-10-30-budget-payment-minimal-bundle-rollback.sql',import.meta.url),'utf8');
  try{await assert.rejects(()=>admin(reverse),/Payment used or active/);await admin('rollback');assert.deepEqual(await admin('select to_jsonb(a) v from actual_expenses a order by id'),before);}finally{await admin('update app_private.budget_payment_protocol set enabled=true');}
 });
 await test('minimal: a real pre-upgrade successful request replays its immutable old receipt without capability',async()=>{
  const id=await h.fixture(),who=identities.get(a),request=uuid();
  const source=await readFile(new URL('../supabase/migrations/20261029134206_budget_payment_lifecycle_groups.sql',import.meta.url),'utf8');
  const names=['budget_payment_dependencies(text,uuid)','budget_payment_value(text,uuid)','budget_payment_admission(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb)','prepare_budget_payment(uuid,text,uuid,uuid,uuid,bigint,bigint,jsonb,uuid)'];
  const latest=[];for(const name of names)latest.push((await admin('select pg_get_functiondef($1::regprocedure) body',['app_private.'+name]))[0].body);
  await admin('begin');try{
   for(const name of names){const start=source.indexOf('create function app_private.'+name.slice(0,name.indexOf('('))+'(');await admin(source.slice(start,source.indexOf('$$;',start)+3).replace('create function','create or replace function'));}
   await admin("select set_config('request.jwt.claim.sub',$1,true)",[actorA]);await admin('set local role authenticated');
   const row=(await admin('select public.read_budget_metadata_snapshot_v4($1,$2) d',[trip,who.session]))[0].d.paymentRecords.find(r=>r.id===id);
   const lease=(await admin("select public.budget_payment_lease($1,'budget',$2,$3,$4,'acquire',$5,null,$6::jsonb) d",[trip,id,who.session,who.token,row.revision,JSON.stringify(row.value.versions)]))[0].d;assert(lease.granted);
   const args=[trip,'budget',id,who.session,who.token,lease.epoch,row.revision,JSON.stringify({action:'paid',versions:row.value.versions}),request];
   const sql='select public.mutate_budget_payment_v2($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) d',receipt=(await admin(sql,args))[0].d;assert.equal(receipt.value.versions.checks,undefined);
   await admin('reset role');for(const definition of latest)await admin(definition);await admin('set local role authenticated');args[4]=null;args[5]=null;
   assert.deepEqual((await admin(sql,args))[0].d,receipt);assert.equal((await admin('select count(*)::int n from actual_expenses where budget_item_id=$1',[id]))[0].n,1);
  }finally{await admin('rollback');}
 });
 await test('minimal: departed foreign retained roundtrip preserves known debit frozen rate receipt history and join identities',async()=>{
  const id=await h.fixture();await admin("update budget_items set currency='JPY' where id=$1",[id]);const initial=await p.acquire(a,id),created=await p.mutate(a,id,initial,{action:'paid'}),aid=created.created_id;await p.release(a,id,initial);
  await admin("update actual_expenses set actual_twd_amount=777,twd_amount_source='actual',payment_history='[{\"event\":\"historical\",\"amount\":777}]'::jsonb where id=$1",[aid]);const receipt=uuid();await admin("insert into attachments(id,trip_id,target_type,target_id,file_name,file_url,file_type,file_size,uploaded_by) values($1,$2,'actual_expense',$3,'historical.pdf','historical.pdf','application/pdf',10,$4)",[receipt,trip,aid,actorA]);
  const dates=(await admin('select start_date::text,end_date::text,status from trips where id=$1',[trip]))[0];await admin("update trips set start_date='2020-01-01',status='traveling' where id=$1",[trip]);
  try{const before=await record(aid,'actual'),joins=await admin('select * from actual_expense_participants where actual_expense_id=$1 order by id',[aid]),attachment=await admin('select * from attachments where id=$1',[receipt]);assert.equal(before.actual_twd_amount,777);
   for(const action of ['unpaid','paid']){const l=await p.acquire(b,id,{intent:action});assert(l.granted);assert(l.targets.every(t=>t.group==='payment'));await p.mutate(b,id,l,{action});await p.release(b,id,l);const row=await record(aid,'actual');for(const key of Object.keys(before).filter(k=>!['updated_at','payment_active'].includes(k)))assert.deepEqual(row[key],before[key],key);assert.deepEqual(await admin('select * from actual_expense_participants where actual_expense_id=$1 order by id',[aid]),joins);assert.deepEqual(await admin('select * from attachments where id=$1',[receipt]),attachment);}
  }finally{await admin('update trips set start_date=$2,end_date=$3,status=$4 where id=$1',[trip,dates.start_date,dates.end_date,dates.status]);}
 });
}
