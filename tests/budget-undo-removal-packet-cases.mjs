import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {migrationSources,normalize,hash} from '../scripts/qa/b7-forward-artifacts.mjs';
import {captureUndoRemovalContractQuery,undoRemovalStagingPacket,stagingTarget,forwardVersion,managedReadOnlyRelations} from '../scripts/qa/build-undo-removal-staging-packet.mjs';
export async function undoRemovalPacketCases({q,db,b,Client,trip,budget,A,sid,historyTrip,historyActual,test}){
 const plan=JSON.parse(await fs.readFile('docs/operations/budget-b7-production/migration-plan.json','utf8'));
 for(const f of (await migrationSources()).filter(f=>f.file<='20261028104333_budget_selection_activity.sql'||f.file.startsWith('20261031003000')))
  await q('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)',[f.version==='20260819125851'?'20260819134935':f.version,f.file.slice(f.version.length+1,-4),[f.source]]);
 for(const f of plan.pendingSources){const source=normalize(await fs.readFile(f.path,'utf8'));assert.equal(hash(source),f.lfSha256);await q('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)',[f.version,f.path.split('/').at(-1).replace(/^\d+_|\.sql$/g,''),[source]]);}
 assert.equal((await q('select count(*)::int n from supabase_migrations.schema_migrations'))[0].n,65);
 // Catalog objects only. This never claims to simulate/download Storage bytes.
 const p1=`trips/${historyTrip}/attachments/actual_expense/${historyActual}/control-a.pdf`,p2=`trips/${historyTrip}/attachments/actual_expense/${historyActual}/control-b.pdf`;
 await q("insert into storage.objects(id,bucket_id,name,owner,metadata) values($1,'trip-attachments',$3,$5,'{\"size\":42}'),($2,'trip-attachments',$4,$5,'{\"size\":43}')",[uuid(),uuid(),p1,p2,A]);
 await q("insert into public.attachments(trip_id,target_type,target_id,file_name,file_url,file_type,file_size,uploaded_by) values($1,'actual_expense',$2,'control-a.pdf',$3,'application/pdf',42,$4)",[historyTrip,historyActual,p1,A]);
 if(process.env.BUDGET_NATIVE_UNDO_MANAGED==='1'){
 // Targeted non-superuser privilege model, not Supautils emulation.
 for(const rel of managedReadOnlyRelations)await q(`create table ${rel}(version text primary key);insert into ${rel} values('retained-platform-row')`);
 await q('create role postgres nologin noinherit nosuperuser bypassrls;grant usage on schema auth,storage,supabase_migrations to postgres;grant usage,create on schema public,app_private to postgres;alter schema public owner to postgres;alter schema app_private owner to postgres');
 await q(`do $$declare r record;begin
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','app_private','auth','storage','supabase_migrations') and c.relkind in('r','p') loop
 if format('%I.%I',r.nspname,r.relname)=any(array['auth.schema_migrations','storage.buckets_vectors','storage.migrations','storage.vector_indexes']) then execute format('revoke all on table %I.%I from postgres;grant select on table %I.%I to postgres',r.nspname,r.relname,r.nspname,r.relname);
 else execute format('alter table %I.%I owner to postgres',r.nspname,r.relname);end if;end loop;
 for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private') and p.prokind='f' loop execute format('alter function %s owner to postgres',r.signature);end loop;
 end $$;grant usage,select,update on all sequences in schema public,app_private to postgres;set role postgres`);
 }
 const capture=async()=>(await q(captureUndoRemovalContractQuery))[0].contract;
 const state=async()=>{const p=await capture();delete p.capturedAt;return p;};
 const rejected=async(sql,pattern)=>{const before=await state();await assert.rejects(()=>q(sql),e=>pattern.test(e.message));await q('rollback');assert.deepEqual(await state(),before);};
 await q("select set_config('app.undo_removal_target',$1,false)",[stagingTarget]);
 const dormantPacket=await undoRemovalStagingPacket(await capture());
 await test('Row digests change for real same-count financial edits and reject null XML projections',async()=>{
 const before=await capture();assert.equal(before.dataProjectionCoverage.complete,true);assert(before.dataProjectionCoverage.rowCount>0);
 await q('begin');await q("update public.budget_items set title='Actual row digest probe' where id=$1",[budget]);const changed=await capture();assert.notEqual(changed.dataDigest,before.dataDigest);await q('rollback');assert.equal((await capture()).dataDigest,before.dataDigest);
 const invalid=structuredClone(before);invalid.dataProjectionCoverage.complete=null;await assert.rejects(()=>undoRemovalStagingPacket(invalid),/Incomplete row digest projection/);
 });
 await test('Unknown read-only relation never receives an automatic lock downgrade',async()=>{const p=await capture();p.managedReadOnlyRelations.push('auth.users');await assert.rejects(()=>undoRemovalStagingPacket(p),/Unknown read-only managed relation/);});
 if(process.env.BUDGET_NATIVE_UNDO_MANAGED==='1')await test('Non-superuser keeps Auth users and Storage object write exclusion; four managed tables are SELECT only',async()=>{
 assert.equal((await q("select rolsuper from pg_roles where rolname=current_user"))[0].rolsuper,false);
 assert.deepEqual((await capture()).managedReadOnlyRelations,managedReadOnlyRelations);
 for(const rel of managedReadOnlyRelations){assert.equal((await q("select has_table_privilege(current_user,$1,'SELECT') v",[rel]))[0].v,true);assert.equal((await q("select has_table_privilege(current_user,$1,'UPDATE') v",[rel]))[0].v,false);}
 for(const rel of ['auth.users','storage.objects','public.budget_items','app_private.budget_metadata_undo_operations'])assert.equal((await q("select has_table_privilege(current_user,$1,'UPDATE') v",[rel]))[0].v,true);
 });
 await test('Packet refuses transaction-local active editor and rolls back the fixture',async()=>{
 const injected=`update public.budget_items set locked_by='${A}',locked_at=clock_timestamp() where id='${budget}';\n`;
 await rejected(dormantPacket.sql.replace('do $undo_preflight$',injected+'do $undo_preflight$'),/Active editor/);
 });
 await test('Packet refuses duplicate Actuals without merging or deleting financial rows',async()=>{
 const injected=[uuid(),uuid()].map(id=>`insert into public.actual_expenses(id,trip_id,budget_item_id,title,category,amount,twd_amount,currency,exchange_rate,paid_at) values('${id}','${trip}','${budget}','Duplicate fixture','交通',1,1,'TWD',1,clock_timestamp());`).join('\n');
 await rejected(dormantPacket.sql.replace('do $undo_preflight$',injected+'\ndo $undo_preflight$'),/Duplicate current Actual/);
 });
 // Reproduce the existing Stage Pause shape, not new readiness evidence.
 await q('update app_private.budget_finance_protocol set activated=true;update app_private.budget_lifecycle_protocol set activated=true;update app_private.budget_receipt_protocol set activated=true,storage_verified=true,cleanup_worker_verified=true,content_worker_verified=true');
 const profile=await capture(),packet=await undoRemovalStagingPacket(profile);
 await test('Packet is one Forward with no reset protocol update source replay or byte operation',async()=>{
 assert.equal(packet.manifest.version,forwardVersion);assert.equal(packet.manifest.fixtureOnly,true);assert(!/delete\s+from|truncate\s|update\s+app_private\.\w+_protocol/i.test(packet.sql));
 assert.equal((packet.sql.match(/insert into supabase_migrations\.schema_migrations/g)||[]).length,1);
 });
 await test('Packet refuses incorrect target before any changes',async()=>{await q("set app.undo_removal_target='wrong'");await rejected(packet.sql,/target binding/);await q("select set_config('app.undo_removal_target',$1,false)",[stagingTarget]);});
 await test('Packet refuses stale contract',async()=>{const old={...profile,capturedAt:new Date(Date.parse(profile.capturedAt)-3600000).toISOString()};await rejected((await undoRemovalStagingPacket(old)).sql,/Fresh contract/);});
 await test('Builder rejects unknown drift in a helper it would replace',async()=>{const drift=structuredClone(profile);drift.changedBodyBefore.workspace_undo_enabled='0'.repeat(64);await assert.rejects(()=>undoRemovalStagingPacket(drift),/Installed helper body drift/);});
 for(const [key,label] of [['ledgerDigest','ledger'],['dataDigest','data'],['schemaDigest','schema'],['allFunctionBodies','complete body'],['functionBodies','body'],['functionAttributes','attributes'],['unaffectedAcls','ACL'],['roleDigest','role']])
  await test(`Packet rejects ${label} drift without partial changes`,async()=>{await rejected((await undoRemovalStagingPacket({...profile,[key]:'0'.repeat(64)})).sql,/drift/);});
 await test('Packet refuses actual peer writer lock without terminating it',async()=>{
 await b.connect();await b.query('begin');await b.query('lock table public.budget_items in row exclusive mode');
 try{await assert.rejects(()=>q(packet.sql),e=>e.code==='55P03');await q('rollback');}finally{await b.query('rollback');}
 assert.deepEqual(await state(),Object.fromEntries(Object.entries(profile).filter(([k])=>k!=='capturedAt')));
 });
 if(process.env.BUDGET_NATIVE_UNDO_MANAGED==='1')await test('Concurrent platform metadata drift rolls back install while Auth users Storage objects and finance writers remain blocked',async()=>{
 const localConfig={host:'127.0.0.1',port:Number(process.env.BUDGET_NATIVE_PORT),database:'postgres',user:'budget_local_admin'};
 const peer=new Client(localConfig),writer=new Client(localConfig),gate=731039;
 await peer.connect();await writer.connect();const before=await state(),pid=(await q('select pg_backend_pid() pid'))[0].pid;let work;
 try{
 await peer.query('select pg_advisory_lock($1)',[gate]);
 // The artificial observation barrier needs its own test deadline; retain
 // the packet's 3s production lock timeout before and after that barrier.
 work=q(packet.sql.replace('do $undo_readback$',`set local lock_timeout='20s';select pg_advisory_xact_lock(${gate});set local lock_timeout='3s';\ndo $undo_readback$`)).then(data=>({data}),error=>({error}));
 const deadline=Date.now()+10000;let blocked=false;
 while(Date.now()<deadline){const r=(await peer.query("select wait_event='advisory' waiting from pg_stat_activity where pid=$1",[pid])).rows[0];if(r?.waiting){blocked=true;break;}await new Promise(r=>setTimeout(r,25));}
 assert(blocked,'Installer must reach the actual post-DDL barrier');
 const locks=(await peer.query("select relation::regclass::text relation,mode,granted from pg_locks where pid=$1 and relation in('auth.users'::regclass,'storage.objects'::regclass,'public.budget_items'::regclass) order by relation::regclass::text,mode",[pid])).rows;
 for(const relation of ['auth.users','budget_items','storage.objects'])assert(locks.some(l=>l.relation===relation&&l.mode==='ShareRowExclusiveLock'&&l.granted),JSON.stringify({missingWriteExclusion:relation,locks}));
 for(const sql of ['update auth.users set email=email','update storage.objects set metadata=metadata','update public.budget_items set title=title']){
 // A separate writer owns no observation-barrier lock. Otherwise the test
 // itself creates a deadlock cycle and may abort the installer first.
 await writer.query("begin;set local lock_timeout='100ms'");await assert.rejects(()=>writer.query(sql),e=>e.code==='55P03',sql);await writer.query('rollback');
 }
 // Real committed peer write to a SELECT-only platform stand-in; not a
 // forged GUC/snapshot or a metadata write against the Hosted platform.
 await peer.query("update auth.schema_migrations set version='peer-platform-change'");
 await peer.query('select pg_advisory_unlock($1)',[gate]);const outcome=await work;assert.match(outcome.error?.message||'',/Protected data drift/);await q('rollback');
 assert.equal((await q('select count(*)::int n from supabase_migrations.schema_migrations'))[0].n,65);
 assert.equal((await q("select to_regclass('public.actual_expenses_one_budget') v"))[0].v,null);
 await peer.query("update auth.schema_migrations set version='retained-platform-row'");assert.deepEqual(await state(),before);
 }finally{await writer.query('rollback').catch(()=>{});await peer.query('rollback').catch(()=>{});await peer.query('select pg_advisory_unlock($1)',[gate]).catch(()=>{});if(work)await work;await q('rollback').catch(()=>{});await Promise.allSettled([writer.end(),peer.end()]);}
 });
 await test('Packet refuses in-flight Undo intent without clearing it',async()=>{
 // Existing deferred integrity guards correctly forbid committing an
 // unfinished intent. Inject it inside the disposable packet transaction,
 // not as a forged durable production state; refusal rolls back the fixture.
 const injected=`insert into app_private.budget_metadata_undo_intents(transaction_id,backend_id,user_id,trip_id,session_id,operation_id,request_id) values(txid_current(),pg_backend_pid(),'${A}','${trip}','${sid}','${uuid()}','${uuid()}');\n`;
 await rejected(packet.sql.replace('do $undo_preflight$',injected+'do $undo_preflight$'),/In-flight/);
 });
 await test('Packet late fault rolls back schema grants ledger and preserved receipt/history rows',async()=>{await rejected(packet.sql.replace("notify pgrst,'reload schema';",'select 1/0;'),/division by zero/);});
 await test('CRLF transported packet commits65 to66 with exact LF source and preserved receipts history latches',async()=>{
 await q(packet.sql.replaceAll('\n','\r\n'));const after=await capture();assert.equal(after.ledgerCount,66);assert.equal(after.ledgerHead,forwardVersion);
 for(const k of ['dataDigest','functionBodies','functionAttributes','unaffectedAcls','schemaDigest','roleDigest'])assert.equal(after[k],profile[k],k);
 assert.deepEqual(after.protocolRows,profile.protocolRows);
 assert.equal((await q('select count(*)::int n from storage.objects'))[0].n,2);
 assert.equal((await q('select count(*)::int n from public.attachments'))[0].n,1);
 const row=(await q('select statements from supabase_migrations.schema_migrations where version=$1',[forwardVersion]))[0];assert.equal(hash(row.statements[0]),packet.manifest.sourceSha256);assert(!row.statements[0].includes('\r'));
 });
 await test('Packet replay refuses without modifying installed state',async()=>{await rejected(packet.sql,/already installed/);});
 await fs.writeFile(process.env.BUDGET_NATIVE_EVIDENCE+'/undo-packet-manifest.json',JSON.stringify(packet.manifest,null,2));
}
