// Native SQL/RLS release-profile tests. NO Hosted or Storage HTTP claims.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {randomUUID as uuid} from 'node:crypto';
import {nativeBootstrap} from './helpers/b7-native-bootstrap.mjs';
import {migrationSources,transactionBody,hash} from '../scripts/qa/b7-forward-artifacts.mjs';
const port=Number(process.env.BUDGET_NATIVE_PORT),marker=process.env.BUDGET_NATIVE_MARKER;
assert(port>1024&&/^[a-f0-9-]{36}$/.test(marker||''));
const pg=await import(pathToFileURL(process.env.BUDGET_NATIVE_PG_MODULE).href),{Client}=pg.default||pg;
const cfg={host:'127.0.0.1',port,database:'postgres',connectionTimeoutMillis:5000};
const db=new Client({...cfg,user:'budget_local_admin'}),a=new Client({...cfg,user:'budget_actor_a'}),b=new Client({...cfg,user:'budget_actor_b'});
const q=async(sql,args)=>(await db.query(sql,args)).rows,aq=async(sql,args)=>(await a.query(sql,args)).rows;
const results=[],test=async(name,fn)=>{try{await fn();results.push({name,status:'passed'});console.log('PASS '+name);}catch(e){results.push({name,status:'failed',code:e.code,message:e.message});throw e;}};
const sourcePath='docs/operations/drafts/budget-receipts-deferred/20261102173541_budget_receipts_deferred_release.sql';
const source=(await fs.readFile(sourcePath,'utf8')).replaceAll('\r',''),version='20261102173541';
const A=uuid(),B=uuid(),trip=uuid(),actual=uuid(),budget=uuid(),sidA=uuid(),sidB=uuid(),tokenA=uuid(),tokenB=uuid();
const oldReceiptIds=[];
const state=async()=>({metadata:await q('select * from attachments order by id'),objects:await q('select * from storage.objects order by id')});
const oldBodies=()=>q("select p.oid,encode(sha256(convert_to(replace(prosrc,chr(13),''),'UTF8')),'hex') sha from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private') order by p.oid");
const fullPath=kind=>`trips/${trip}/attachments/${kind}/${actual}/fixture.png`;
let actorsConnected=false;
try{
 await db.connect();assert.equal((await q("select current_setting('budget_metadata.test_cluster',true) m"))[0].m,marker);
 await q(nativeBootstrap);await q('grant authenticator to supabase_storage_admin with inherit false,set true');
 // Reproduce the actual managed baseline ACL (authenticated/anon=arwd), not
 // a permission added by the Forward. Stock bootstrap has no Storage grants.
 await q('grant select,insert,update,delete on storage.objects to authenticated,anon');
 for(const f of (await migrationSources()).filter(f=>f.file<='20261028104333_budget_selection_activity.sql'||f.file.startsWith('20261031003000'))){await q(f.source);await q('insert into supabase_migrations.schema_migrations values($1,$2,$3)',[f.version==='20260819125851'?'20260819134935':f.version,f.file.slice(f.version.length+1,-4),[f.source]]);}
 const plan=JSON.parse(await fs.readFile('docs/operations/budget-b7-production/migration-plan.json','utf8'));
 for(const f of plan.pendingSources){const body=(await fs.readFile(f.path,'utf8')).replaceAll('\r','');assert.equal(hash(body),f.lfSha256);await q(body);await q('insert into supabase_migrations.schema_migrations values($1,$2,$3)',[f.version,f.name,[body]]);}
 await q("set app.b7_install_target='lqvuqamzmchepgxkftcw'");
 await q('insert into auth.users values($1,$3,$4),($2,$5,$4)',[A,B,'native-a@example.invalid',{},'native-b@example.invalid']);
 await q("insert into trips(id,title,name,destination,start_date,end_date,owner_id) values($1,'Native deferred','Native deferred','Fixture','2099-01-01','2099-01-03',$2)",[trip,A]);
 await q("insert into trip_members(trip_id,user_id,role,status) values($1,$2,'owner','approved'),($1,$3,'editor','approved')",[trip,A,B]);
 await q("insert into budget_items(id,trip_id,title,category,amount,twd_amount,currency,exchange_rate,payer_id) values($1,$2,'Native budget','交通',100,100,'TWD',1,$3)",[budget,trip,A]);
 await q('insert into budget_item_participants(budget_item_id,user_id,share_amount) values($1,$2,100)',[budget,A]);
 await q("insert into actual_expenses(id,trip_id,title,category,amount,twd_amount,currency,exchange_rate,payer_id,paid_at) values($1,$2,'Native actual','交通',100,100,'TWD',1,$3,clock_timestamp())",[actual,trip,A]);
 await q('insert into actual_expense_participants(actual_expense_id,user_id,share_amount) values($1,$2,100)',[actual,A]);
 await a.connect();await b.connect();actorsConnected=true;
 for(const [c,id]of [[a,A],[b,B]]){await c.query('set role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);}
 const before=await oldBodies();
 await test('Candidate refuses unknown installed Receipt guard before adding objects',async()=>{await assert.rejects(()=>q(source.replace('85cda3b2566527c40fe9bb1ee791b5d9ed07172e283ad46c5b2e23dd2c2df434','0'.repeat(64))),e=>/Unknown installed/.test(e.message));await q('rollback');assert.equal((await q("select to_regprocedure('app_private.budget_receipts_deferred()') v"))[0].v,null);});
 await test('Late failure rolls back new functions trigger and policies',async()=>{await assert.rejects(()=>q(source.replace(/commit;\s*$/,'select 1/0;commit;')),e=>e.code==='22012');await q('rollback');assert.equal((await q("select to_regprocedure('app_private.budget_receipts_deferred()') v"))[0].v,null);});
 await test('Forward adds only reviewed objects and a truthful local ledger row',async()=>{await q('begin;'+transactionBody(source));await q('insert into supabase_migrations.schema_migrations values($1,$2,$3)',[version,'budget_receipts_deferred_release',[source]]);await q('commit');assert.equal((await q('select count(*)::int n from supabase_migrations.schema_migrations'))[0].n,66);const after=await oldBodies();assert.deepEqual(after.filter(x=>before.some(y=>y.oid===x.oid)),before);assert.equal(after.length,before.length+2);});
 await test('Legacy receipt behavior is unchanged before first financial activation',async()=>{const row=(await aq("insert into attachments(trip_id,target_type,target_id,file_name,file_url) values($1,'actual_expense',$2,'legacy.png',$3) returning id",[trip,actual,fullPath('actual_expense')]))[0];assert.equal((await a.query('delete from attachments where id=$1',[row.id])).rowCount,1);
  // Legal ordinary-user writes before the first latch transition create the
  // old-row boundary fixture; no guard is disabled and no latch is reset.
  for(const n of [1,2])oldReceiptIds.push((await aq("insert into attachments(trip_id,target_type,target_id,file_name,file_url) values($1,'actual_expense',$2,'old.png',$3) returning id",[trip,actual,fullPath('actual_expense')+n]))[0].id);
 });
 await test('Six-protocol native profile never sets receipt readiness or latch',async()=>{await q("update app_private.budget_metadata_protocol set enabled=true;update app_private.budget_finance_protocol set enabled=true;update app_private.budget_payment_protocol set enabled=true;update app_private.budget_source_protocol set enabled=true;update app_private.budget_lifecycle_protocol set enabled=true;update app_private.budget_metadata_undo_protocol set enabled=true,full_enabled=true;");assert.equal((await aq('select app_private.budget_receipts_deferred() v'))[0].v,true);const r=(await q('select to_jsonb(t) r from app_private.budget_receipt_protocol t'))[0].r;for(const k of ['enabled','activated','storage_verified','cleanup_worker_verified','content_worker_verified'])assert.equal(r[k],false);assert.equal(r.legacy_grants_expire_at,null);});
 await test('Financial receipt metadata INSERT UPDATE DELETE all refuse atomically',async()=>{const beforeGraph=await state();await assert.rejects(()=>aq("insert into attachments(trip_id,target_type,target_id,file_name,file_url) values($1,'actual_expense',$2,'deny.png',$3)",[trip,actual,fullPath('actual_expense')]),e=>e.code==='55000');await q('begin');await q("update app_private.budget_finance_protocol set enabled=false"); // latch still TRUE; cannot bypass.
  await assert.rejects(()=>q("insert into attachments(trip_id,target_type,target_id,file_name,file_url) values($1,'actual_expense',$2,'deny.png',$3)",[trip,actual,fullPath('actual_expense')]),e=>e.code==='55000');await q('rollback');assert.deepEqual(await state(),beforeGraph);
  // Existing nonfinancial metadata cannot be retargeted into the deferred type.
  const row=(await aq("insert into attachments(trip_id,target_type,target_id,file_name,file_url) values($1,'accommodation',$2,'keep.png',$3) returning id",[trip,uuid(),fullPath('accommodation')]))[0];await assert.rejects(()=>aq("update attachments set target_type='actual_expense',target_id=$2 where id=$1",[row.id,actual]),e=>e.code==='55000');
  await assert.rejects(()=>aq("update attachments set file_name='no.png' where id=$1",[oldReceiptIds[0]]),e=>e.code==='55000');
  await assert.rejects(()=>aq('delete from attachments where id=$1',[oldReceiptIds[1]]),e=>e.code==='55000');
  assert.equal((await q('select count(*)::int n from attachments where id=any($1::uuid[])',[oldReceiptIds]))[0].n,2);
 });
 await test('Normal member Storage metadata cannot insert or retarget financial paths',async()=>{await assert.rejects(()=>aq('insert into storage.objects(id,bucket_id,name,owner) values($1,$2,$3,$4)',[uuid(),'trip-attachments',fullPath('actual_expense'),A]),e=>e.code==='42501');const id=uuid();await aq('insert into storage.objects(id,bucket_id,name,owner) values($1,$2,$3,$4)',[id,'trip-attachments',fullPath('accommodation'),A]);await assert.rejects(()=>aq('update storage.objects set name=$2 where id=$1',[id,fullPath('actual_expense')]),e=>e.code==='42501');assert.equal((await aq('select name from storage.objects where id=$1',[id]))[0].name,fullPath('accommodation'));});
 await test('Two ordinary native sessions still edit independent groups and get PT409 for stale versions',async()=>{
  await assert.rejects(()=>aq("select public.budget_metadata_group_lease($1,'budget',$2,'title',$3,$4,'acquire',0,null,0,false)",[trip,budget,sidA,tokenA]),e=>e.code==='55000');
  const field=async(c,g,s)=>(await c.query('select public.read_budget_metadata_snapshot_v10($1,$2) v',[trip,s])).rows[0].v.metadataRecords.find(r=>r.kind==='budget'&&r.id===budget).groups.find(x=>x.group===g);
  const lease=(c,g,s,t,r)=>(c.query("select public.budget_metadata_group_lease_v2($1,'budget',$2,$3,$4,$5,'acquire',$6,null,0,false,$7::jsonb) v",[trip,budget,g,s,t,r.revision,JSON.stringify(r.versions)])).then(x=>x.rows[0].v);
  const ra=await field(a,'title',sidA),rb=await field(b,'note',sidB),la=await lease(a,'title',sidA,tokenA,ra),lb=await lease(b,'note',sidB,tokenB,rb);assert(la.granted&&lb.granted);
  const patch=(c,g,s,t,l,r,value)=>(c.query("select public.patch_budget_metadata_group_v2($1,'budget',$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb) v",[trip,budget,g,r.revision,s,t,l.epoch,JSON.stringify(value),uuid(),JSON.stringify(r.versions)])).then(x=>x.rows[0].v);
  await patch(a,'title',sidA,tokenA,la,ra,{title:'Native edited'});await patch(b,'note',sidB,tokenB,lb,rb,{note:'Peer note'});
  await assert.rejects(()=>lease(b,'title',sidB,tokenB,ra),e=>e.code==='PT409');assert.equal((await q('select title from budget_items where id=$1',[budget]))[0].title,'Native edited');
 });
 await test('Real native lifecycle placeholder and v10 Snapshot remain available without receipts',async()=>{const r=(await aq("select public.create_budget_workspace_placeholder($1,'budget',$2,$3) r",[trip,sidA,uuid()]))[0].r;assert(r.created_id);const s=(await aq('select public.read_budget_metadata_snapshot_v10($1,$2) r',[trip,sidA]))[0].r;assert(s);assert.equal((await q('select record_status from budget_items where id=$1',[r.created_id]))[0].record_status,'incomplete');});
 await test('Pause retains financial/lifecycle latches and still refuses legacy receipts',async()=>{await q('update app_private.budget_metadata_undo_protocol set enabled=false,full_enabled=false;update app_private.budget_lifecycle_protocol set enabled=false;update app_private.budget_source_protocol set enabled=false;update app_private.budget_payment_protocol set enabled=false;update app_private.budget_finance_protocol set enabled=false;update app_private.budget_metadata_protocol set enabled=false');assert.equal((await aq('select app_private.budget_receipts_deferred() v'))[0].v,true);await assert.rejects(()=>aq("insert into attachments(trip_id,target_type,target_id,file_name,file_url) values($1,'actual_expense',$2,'deny.png',$3)",[trip,actual,fullPath('actual_expense')]),e=>e.code==='55000');});
}finally{
 await db.query('rollback').catch(()=>{});await Promise.allSettled([...(actorsConnected?[a.end(),b.end()]:[]),db.end()]);
  await fs.writeFile(process.env.BUDGET_NATIVE_EVIDENCE+'/deferred-receipts-results.json',JSON.stringify({scope:'isolated native SQL/RLS only; not HTTP or real Auth; never applied Hosted; direct boundary-fixture flag transitions are not an operational Activation preflight',version,sourceSha256:hash(source),results},null,2));
}
