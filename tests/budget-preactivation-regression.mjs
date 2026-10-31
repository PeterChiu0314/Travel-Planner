// Fresh native DB only: targeted reproduction/repair, never service acceptance.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {randomUUID as uuid} from 'node:crypto';
import {nativeBootstrap} from './helpers/b7-native-bootstrap.mjs';
import {migrationSources,hash} from '../scripts/qa/b7-forward-artifacts.mjs';
const port=Number(process.env.BUDGET_NATIVE_PORT),marker=process.env.BUDGET_NATIVE_MARKER;
assert(Number.isInteger(port)&&port>1024&&/^[a-f0-9-]{36}$/.test(marker||''));
const pg=await import(pathToFileURL(process.env.BUDGET_NATIVE_PG_MODULE).href),{Client}=pg.default||pg;
const db=new Client({host:'127.0.0.1',port,database:'postgres',user:'budget_local_admin'}),results=[];
const q=async(sql,args)=>(await db.query(sql,args)).rows;
const test=async(name,fn)=>{await fn();results.push({name,status:'Passed'});console.log('PASS '+name);};
const rejected=async(sql,args,code)=>{await q('begin');try{await assert.rejects(()=>q(sql,args),e=>e.code===code);}finally{await q('rollback');}};
const seal=JSON.parse(await fs.readFile('docs/operations/drafts/budget-b7-preactivation/guard-seal.json','utf8'));
const draft=await fs.readFile('docs/operations/drafts/budget-b7-preactivation/'+seal.draftFile,'utf8');
const flags=async()=>q("select 'metadata' k,enabled v from app_private.budget_metadata_protocol union all select 'finance',enabled or activated from app_private.budget_finance_protocol union all select 'lifecycle',enabled or activated from app_private.budget_lifecycle_protocol union all select 'receipts',enabled or activated from app_private.budget_receipt_protocol union all select 'payment',enabled from app_private.budget_payment_protocol union all select 'source',enabled from app_private.budget_source_protocol union all select 'undo',enabled or full_enabled from app_private.budget_metadata_undo_protocol");
const actor=uuid();
const fixture=async(kind='budget')=>{
 const trip=uuid(),rid=uuid();await q("insert into trips(id,title,name,destination,start_date,end_date,owner_id) values($1,'QA','QA','QA','2099-01-01','2099-01-03',$2)",[trip,actor]);await q("insert into trip_members(trip_id,user_id,role,status) values($1,$2,'owner','approved')",[trip,actor]);
 if(kind==='budget'){await q("insert into budget_items(id,trip_id,title,category,amount,currency,exchange_rate,twd_amount,payer_id) values($1,$2,'QA','其他',1,'TWD',1,1,$3)",[rid,trip,actor]);await q('insert into budget_item_participants(budget_item_id,user_id) values($1,$2)',[rid,actor]);}
 else{await q("insert into actual_expenses(id,trip_id,title,category,amount,currency,exchange_rate,twd_amount,payer_id,paid_at) values($1,$2,'QA','其他',1,'TWD',1,1,$3,clock_timestamp())",[rid,trip,actor]);await q('insert into actual_expense_participants(actual_expense_id,user_id) values($1,$2)',[rid,actor]);}
 return {trip,rid,kind};
};
try{
 await db.connect();assert.equal((await q("select current_setting('budget_metadata.test_cluster',true) marker"))[0].marker,marker);
 await q(nativeBootstrap);await q('grant authenticator to supabase_storage_admin with inherit false,set true');
 const all=await migrationSources();
 for(const s of all){if(s.version==='20261030125028')continue;await q(s.source);}
 await q(await fs.readFile('docs/operations/budget-b7-staging-managed/20261031083437_budget_managed_worker_role_path.sql','utf8'));
 await q(await fs.readFile('docs/operations/budget-b7-staging/20261031130000_budget_business_conflicts_forward.sql','utf8'));
 await q('insert into auth.users values($1,$2,$3)',[actor,'fixture@example.invalid',{}]);
 const b=await fixture(),a=await fixture('actual');
 await test('Reproduce dormant Budget and Actual FK cascade rejection without altering rows',async()=>{for(const f of [b,a])await rejected(`delete from ${f.kind==='budget'?'budget_items':'actual_expenses'} where id=$1`,[f.rid],'55000');});
 const attrs=await q("select to_jsonb(p)-'prosrc' a from pg_proc p where oid='app_private.guard_incomplete_child()'::regprocedure");
 await test('Draft matches sealed old body, preserves routine attributes and all seven OFF flags',async()=>{
  assert.equal(hash((await q("select replace(prosrc,chr(13),'') body from pg_proc where oid='app_private.guard_incomplete_child()'::regprocedure"))[0].body),seal.beforeSha256);
  await q(draft);assert.deepEqual(await q("select to_jsonb(p)-'prosrc' a from pg_proc p where oid='app_private.guard_incomplete_child()'::regprocedure"),attrs);assert((await flags()).every(x=>!x.v));
 });
 await test('Dormant Budget and Actual parent cascades remove only their participant children',async()=>{
  for(const f of [b,a]){await q(`delete from ${f.kind==='budget'?'budget_items':'actual_expenses'} where id=$1`,[f.rid]);assert.equal((await q(`select count(*)::int n from ${f.kind==='budget'?'budget_item_participants':'actual_expense_participants'} where ${f.kind==='budget'?'budget_item_id':'actual_expense_id'}=$1`,[f.rid]))[0].n,0);}
 });
 await test('Normal dormant trip cascade succeeds after repair',async()=>{const f=await fixture();await q('delete from trips where id=$1',[f.trip]);assert.equal((await q('select count(*)::int n from budget_items where id=$1',[f.rid]))[0].n,0);});
 await test('Incomplete live parent still rejects raw participant INSERT',async()=>{
  const trip=uuid(),rid=uuid();await q("insert into trips(id,title,name,destination,start_date,end_date,owner_id) values($1,'QA','QA','QA','2099-01-01','2099-01-03',$2)",[trip,actor]);
  await q("insert into budget_items(id,trip_id,title,category,record_status,pricing_ready,amount,currency,exchange_rate,twd_amount) values($1,$2,'','其他','incomplete',false,0,'TWD',1,0)",[rid,trip]);
  await rejected('insert into budget_item_participants(budget_item_id,user_id) values($1,$2)',[rid,actor],'55000');
 });
 await test('Enabled metadata protocol refuses the dormant-only repair without changes',async()=>{
  await q('begin');await q('update app_private.budget_metadata_protocol set enabled=true');
  await assert.rejects(()=>q(draft.replace(/^begin;$/m,'').replace(/^commit;$/m,'')),e=>e.message==='Dormant-only repair refused after activation');await q('rollback');
 });
 await test('Paused activated finance still blocks external parent cascade and repair',async()=>{
  const f=await fixture();await q('begin');
  // Native synthetic paused-latch fixture only, rolled back below. The real
  // latch derives activated from enabled; assigning activated alone is ignored.
  await q('update app_private.budget_finance_protocol set enabled=true');await q('update app_private.budget_finance_protocol set enabled=false');
  assert.equal((await q('select activated from app_private.budget_finance_protocol'))[0].activated,true);await q('savepoint active_probe');
  await assert.rejects(()=>q('delete from trips where id=$1',[f.trip]),e=>e.code==='0A000');await q('rollback to savepoint active_probe');
  await assert.rejects(()=>q(draft.replace(/^begin;$/m,'').replace(/^commit;$/m,'')),e=>e.message==='Dormant-only repair refused after activation');await q('rollback');
 });
 await test('Repeated draft preserves repaired body and rejects unknown body drift atomically',async()=>{
  await q(draft);const body=(await q("select prosrc from pg_proc where oid='app_private.guard_incomplete_child()'::regprocedure"))[0].prosrc;assert.equal(hash(body),seal.afterSha256);
  await q('begin');await q("create or replace function app_private.guard_incomplete_child() returns trigger language plpgsql security definer set search_path='' as $$begin return old;end$$");
  await q('savepoint drift');await assert.rejects(()=>q(draft.replace(/^begin;$/m,'').replace(/^commit;$/m,'')),e=>e.message==='Unreviewed incomplete-child Guard hash');await q('rollback');assert.equal((await q("select prosrc from pg_proc where oid='app_private.guard_incomplete_child()'::regprocedure"))[0].prosrc,body);
 });
 await fs.writeFile(process.env.BUDGET_NATIVE_EVIDENCE+'/preactivation-regression.json',JSON.stringify({scope:'Native fixture only; no real HTTP claim',results,flags:await flags(),hostedApplied:false},null,2));
}finally{await db.end();}
