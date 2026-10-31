// Fresh native DB only: targeted reproduction/repair, never service acceptance.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {randomUUID as uuid} from 'node:crypto';
import {nativeBootstrap} from './helpers/b7-native-bootstrap.mjs';
import {migrationSources,hash} from '../scripts/qa/b7-forward-artifacts.mjs';
import {cascadeSource,cascadeDeploymentSql,validateCascadeVersion} from '../scripts/qa/b7-cascade-forward-artifacts.mjs';
const port=Number(process.env.BUDGET_NATIVE_PORT),marker=process.env.BUDGET_NATIVE_MARKER;
assert(Number.isInteger(port)&&port>1024&&/^[a-f0-9-]{36}$/.test(marker||''));
const pg=await import(pathToFileURL(process.env.BUDGET_NATIVE_PG_MODULE).href),{Client}=pg.default||pg;
const db=new Client({host:'127.0.0.1',port,database:'postgres',user:'budget_local_admin'}),results=[];
const q=async(sql,args)=>(await db.query(sql,args)).rows;
const test=async(name,fn)=>{await fn();results.push({name,status:'Passed'});console.log('PASS '+name);};
const rejected=async(sql,args,code)=>{await q('begin');try{await assert.rejects(()=>q(sql,args),e=>e.code===code);}finally{await q('rollback');}};
const seal=JSON.parse(await fs.readFile('docs/operations/drafts/budget-b7-preactivation/guard-seal.json','utf8'));
const draft=await cascadeSource();
// Before issuance use an explicitly synthetic fixture version. Once an official
// candidate exists, verify and test its exact version/source/wrapper locally.
let issued=null;try{issued=JSON.parse(await fs.readFile('docs/operations/drafts/budget-b7-cascade-forward/packet-manifest.json','utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const fixtureVersion=issued?.version||'20990101000000';
if(issued){validateCascadeVersion(fixtureVersion);assert.equal(issued.issuedByOfficialCli,true);assert.equal(hash(draft),issued.sourceSha256);assert.equal(await fs.readFile('docs/operations/drafts/budget-b7-cascade-forward/'+issued.file,'utf8'),draft);}
const fullWrapper=await cascadeDeploymentSql(fixtureVersion);
if(issued){assert.equal(hash(fullWrapper),issued.wrapperSha256);assert.equal(await fs.readFile('docs/operations/drafts/budget-b7-cascade-forward/candidate-deployment.psql','utf8'),fullWrapper);}
const wrapper=fullWrapper.replace(/^\\set .*$/gm,'');
const snapshot=async()=>({
 ledger:await q("select version,name,encode(sha256(convert_to(coalesce(array_to_string(statements,''),''),'UTF8')),'hex') sha from supabase_migrations.schema_migrations order by version"),
 tables:await q("select n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','app_private','auth','storage') and c.relkind='r' order by 1,2"),
 policies:await q('select * from pg_policies order by schemaname,tablename,policyname'),
 triggers:await q("select tgrelid,tgname,tgenabled,pg_get_triggerdef(oid) definition from pg_trigger where not tgisinternal order by tgrelid,tgname"),
 routines:await q("select p.oid,to_jsonb(p)-'prosrc' attrs,case when p.oid='app_private.guard_incomplete_child()'::regprocedure then null else encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') end body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private') order by p.oid"),
 data:await q("select 'budget' k,encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]')::text,'UTF8')),'hex') sha from budget_items t union all select 'actual',encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]')::text,'UTF8')),'hex') from actual_expenses t union all select 'baseline',encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by trip_id),'[]')::text,'UTF8')),'hex') from trip_budget_baselines t"),
 flags:await flags(),
});
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
 const install=async s=>{await q(s.source);await q('insert into supabase_migrations.schema_migrations values($1,$2,$3)',[s.version,s.file.slice(s.version.length+1,-4),[s.source]]);};
 for(const s of all){if(s.version==='20261030125028')continue;await install(s);}
 for(const file of ['docs/operations/budget-b7-staging-managed/20261031083437_budget_managed_worker_role_path.sql','docs/operations/budget-b7-staging/20261031130000_budget_business_conflicts_forward.sql']){const name=file.split('/').at(-1);await install({version:name.split('_')[0],file:name,source:await fs.readFile(file,'utf8')});}
 assert.equal((await q('select count(*)::int n from supabase_migrations.schema_migrations'))[0].n,62);
 await q("set app.b7_install_target='uyqdopksfysbobhjcepk'");
 await q('insert into auth.users values($1,$2,$3)',[actor,'fixture@example.invalid',{}]);
 const b=await fixture(),a=await fixture('actual');
 await test('Reproduce dormant Budget and Actual FK cascade rejection without altering rows',async()=>{for(const f of [b,a])await rejected(`delete from ${f.kind==='budget'?'budget_items':'actual_expenses'} where id=$1`,[f.rid],'55000');});
 await test('Late forward fault rolls back changed body, financial fixture, RLS/ACL/triggers and ledger',async()=>{
  const before=await snapshot();const body=(await q("select prosrc from pg_proc where oid='app_private.guard_incomplete_child()'::regprocedure"))[0].prosrc;
  const injected=wrapper.replace('-- FORWARD_POST_REPLACE_CHECK','perform 1/0;');assert.notEqual(injected,wrapper);await assert.rejects(()=>q(injected),e=>e.code==='22012');await q('rollback');
  assert.deepEqual(await snapshot(),before);assert.equal((await q("select prosrc from pg_proc where oid='app_private.guard_incomplete_child()'::regprocedure"))[0].prosrc,body);
 });
 const attrs=await q("select to_jsonb(p)-'prosrc' a from pg_proc p where oid='app_private.guard_incomplete_child()'::regprocedure");
 await test('Draft matches sealed old body, preserves routine attributes and all seven OFF flags',async()=>{
  assert.equal(hash((await q("select replace(prosrc,chr(13),'') body from pg_proc where oid='app_private.guard_incomplete_child()'::regprocedure"))[0].body),seal.beforeSha256);
  const before=await snapshot();await q(draft);assert.deepEqual(await snapshot(),before);assert.deepEqual(await q("select to_jsonb(p)-'prosrc' a from pg_proc p where oid='app_private.guard_incomplete_child()'::regprocedure"),attrs);assert((await flags()).every(x=>!x.v));
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
 await test('Live incomplete Budget/Actual parents still reject participant UPDATE and DELETE',async()=>{
  for(const kind of ['budget','actual']){const f=await fixture(kind),parent=kind==='budget'?'budget_items':'actual_expenses',child=kind==='budget'?'budget_item_participants':'actual_expense_participants',fk=kind==='budget'?'budget_item_id':'actual_expense_id';
   // Native-only synthetic pre-existing incomplete graph. Re-enable the
   // deferred readiness trigger before exercising the real child Guard.
   await q('begin');await q(`alter table ${parent} disable trigger zzz_readiness`);await q(`update ${parent} set record_status='incomplete',pricing_ready=false where id=$1`,[f.rid]);await q('set constraints all immediate');await q(`alter table ${parent} enable trigger zzz_readiness`);await q('savepoint incomplete');
   for(const sql of [`update ${child} set share_amount=1 where ${fk}=$1`,`delete from ${child} where ${fk}=$1`]){await assert.rejects(()=>q(sql,[f.rid]),e=>e.code==='55000');await q('rollback to savepoint incomplete');}await q('rollback');
  }
 });
 await test('Synthetic paused lifecycle and receipt latches retain parent deletion fencing',async()=>{
  for(const table of ['budget_lifecycle_protocol','budget_receipt_protocol']){const f=await fixture();await q('begin');
   const row=(await q(`select to_jsonb(p) r from app_private.${table} p`))[0].r;row.enabled=false;row.activated=true;
   await q(`delete from app_private.${table}`);await q(`insert into app_private.${table} select * from jsonb_populate_record(null::app_private.${table},$1::jsonb)`,[JSON.stringify(row)]);await q('savepoint paused');
   await assert.rejects(()=>q('delete from trips where id=$1',[f.trip]),e=>e.code==='0A000');await q('rollback to savepoint paused');await assert.rejects(()=>q(draft.replace(/^begin;$/m,'').replace(/^commit;$/m,'')),e=>e.message==='Dormant-only repair refused after activation');await q('rollback');
  }
 });
 await test('Concurrent protocol writer blocks repair before function or ledger changes',async()=>{
  const peer=new Client({host:'127.0.0.1',port,database:'postgres',user:'budget_local_admin'});await peer.connect();const before=await snapshot();try{await peer.query('begin');await peer.query('update app_private.budget_metadata_protocol set enabled=enabled');await assert.rejects(()=>q(draft),e=>e.code==='55P03');await q('rollback');}finally{await peer.query('rollback');await peer.end();}assert.deepEqual(await snapshot(),before);
 });
 await test('Version validator rejects old head and impossible dates without DB writes',async()=>{
  assert.throws(()=>validateCascadeVersion('20261031130000'));assert.throws(()=>validateCascadeVersion('20991301000000'));assert.throws(()=>validateCascadeVersion('not-a-version'));const before=await snapshot();await q("set app.b7_install_target='wrong'");await assert.rejects(()=>q(wrapper),e=>e.message==='Explicit Staging target required');await q('rollback');await q("set app.b7_install_target='uyqdopksfysbobhjcepk'");assert.deepEqual(await snapshot(),before);
 });
 await test('Atomic ledger62 to63 stores exact full source and repeat is a no-op',async()=>{
  await q(wrapper);const rows=await q('select name,statements from supabase_migrations.schema_migrations where version=$1',[fixtureVersion]);assert.equal(rows[0].statements[0],draft);const before=await snapshot();await q(wrapper);assert.deepEqual(await snapshot(),before);
 });
 await test('Ledger source collision and unexpected head refuse without partial changes',async()=>{
  for(const sql of [`update supabase_migrations.schema_migrations set statements=array['unreviewed'] where version='${fixtureVersion}'`,`update supabase_migrations.schema_migrations set statements=null where version='${fixtureVersion}'`,`update supabase_migrations.schema_migrations set statements=array[null::text] where version='${fixtureVersion}'`,`update supabase_migrations.schema_migrations set name=null where version='${fixtureVersion}'`,`insert into supabase_migrations.schema_migrations values('${String(BigInt(fixtureVersion)+1n)}','unexpected',array['probe'])`]){await q('begin');await q(sql);await q('savepoint ledger_drift');await assert.rejects(()=>q(wrapper.replace(/^begin;$/m,'').replace(/^commit;$/m,'')),e=>/ledger|source collision/i.test(e.message));await q('rollback');}
 });
 await fs.writeFile(process.env.BUDGET_NATIVE_EVIDENCE+'/preactivation-regression.json',JSON.stringify({scope:'Native fixture only; no real HTTP claim',results,flags:await flags(),migrationVersion:fixtureVersion,officialCliCandidate:!!issued,sourceSha256:hash(draft),wrapperSha256:hash(fullWrapper),hostedApplied:false},null,2));
}finally{await db.end();}
