import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

export async function businessConflictCases({test,admin,query,a,b,trip,actorA,fixture,record}) {
 const migration=await fs.readFile(new URL('../supabase/migrations/20261031003000_rpc_business_conflicts_no_retry.sql',import.meta.url),'utf8');
 const budget=await fixture(),before=await record(budget);
 await test('Conflict hotfix stale Save and lease admission retain their business guards',async()=>{
  await assert.rejects(()=>query(a,'select public.save_budget_workspace_record($1,$2,$3,$4,$5::jsonb)',[trip,'budget',budget,null,JSON.stringify({title:'Do not save',amount:900,currency:'TWD',exchange_rate:1,payer_id:actorA,participantIds:[actorA]})]),e=>e.code==='PT409');
  await assert.rejects(()=>query(a,"select public.budget_edit_lease('budget',$1,$2,$3,'acquire',null)",[budget,randomUUID(),randomUUID()]),e=>e.code==='PT409');
  assert.deepEqual(await record(budget),before);
 });
 for(const base of [null,'2000-01-01T00:00:00Z']) await test(`Conflict hotfix stale delete ${base===null?'missing':'old'} version rejects without financial writes`,async()=>{
  await assert.rejects(()=>query(a,'select public.delete_budget_workspace_record($1,$2,$3,$4)',[trip,'budget',budget,base]),e=>e.code==='PT409'&&e.message==='Record changed');
  assert.deepEqual(await record(budget),before);
  assert.equal((await admin('select count(*)::int n from budget_item_participants where budget_item_id=$1',[budget]))[0].n,2);
 });
 await test('Conflict hotfix missing record is a bounded business rejection',async()=>{
  await assert.rejects(()=>query(a,'select public.delete_budget_workspace_record($1,$2,$3,$4)',[trip,'budget',randomUUID(),new Date().toISOString()]),e=>e.code==='PT409');
 });
 await test('Conflict hotfix original permission and valid-delete behavior remain intact',async()=>{
  await assert.rejects(()=>query(a,'select public.delete_budget_workspace_record($1,$2,$3,$4)',[randomUUID(),'budget',budget,before.updated_at]),e=>e.code==='42501');
  await query(a,'select public.delete_budget_workspace_record($1,$2,$3,$4)',[trip,'budget',budget,before.updated_at]);
  assert.equal((await admin('select count(*)::int n from budget_items where id=$1',[budget]))[0].n,0);
 });
 await test('Conflict hotfix maps all thirteen baseline routines and is idempotent without changing attributes or Budget rows',async()=>{
  assert.equal((await admin("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private') and p.prokind='f' and p.prosrc ~* 'errcode[[:space:]]*=[[:space:]]*''PT409'''"))[0].n,13);
  assert.equal((await admin("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private') and p.prokind='f' and p.prosrc ~* 'errcode[[:space:]]*=[[:space:]]*''40001'''"))[0].n,0);
  const defs=()=>admin("select p.oid,to_jsonb(p) attributes from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private') and p.prokind='f' order by p.oid");
  const rows=()=>admin('select to_jsonb(b) d from budget_items b order by id');
  const functions=await defs(),data=await rows();await admin(migration);assert.deepEqual(await defs(),functions);assert.deepEqual(await rows(),data);
 });
 await test('Conflict hotfix leaves genuine database serialization failures unchanged',async()=>{
  await admin('create table budget_test.engine_conflict(id int primary key,value int);insert into budget_test.engine_conflict values(1,0);grant all on budget_test.engine_conflict to authenticated');
  await query(a,'begin isolation level repeatable read');await query(a,'select * from budget_test.engine_conflict where id=1');
  await query(b,'update budget_test.engine_conflict set value=1 where id=1');
  await assert.rejects(()=>query(a,'update budget_test.engine_conflict set value=2 where id=1'),e=>e.code==='40001');await query(a,'rollback');
 });
}
