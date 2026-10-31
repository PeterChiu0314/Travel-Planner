// Native PostgreSQL role/RLS/atomic-install tests. NO HTTP/Auth/Storage service claim.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {randomUUID as uuid} from 'node:crypto';
import {nativeBootstrap} from './helpers/b7-native-bootstrap.mjs';
import {migrationSources,transactionBody,hash,normalize} from '../scripts/qa/b7-forward-artifacts.mjs';
import {captureProtection} from '../scripts/qa/build-b7-staging-packet.mjs';
import {managedArtifacts,replacementFile,supersededFile} from '../scripts/qa/build-b7-managed-packet.mjs';
const port=Number(process.env.BUDGET_NATIVE_PORT),marker=process.env.BUDGET_NATIVE_MARKER,chain=process.env.BUDGET_FORWARD_CHAIN;
assert(Number.isInteger(port)&&port>1024&&/^[a-f0-9-]{36}$/.test(marker||'')&&['staging','fresh'].includes(chain));
const pg=await import(pathToFileURL(process.env.BUDGET_NATIVE_PG_MODULE).href),{Client}=pg.default||pg;
const cfg={host:'127.0.0.1',port,database:'postgres',connectionTimeoutMillis:5000};
const db=new Client({...cfg,user:'budget_local_admin'}),installer=new Client({...cfg,user:'postgres'}),storage=new Client({...cfg,user:'supabase_storage_admin'}),api=new Client({...cfg,user:'authenticator'}),ordinary=new Client({...cfg,user:'budget_actor_a'});
const results=[],test=async(name,fn)=>{const start=Date.now();try{await fn();results.push({name,status:'passed',ms:Date.now()-start});console.log('PASS '+name);}catch(e){results.push({name,status:'failed',message:e.message,code:e.code});throw e;}};
const q=async(sql,args)=>(await db.query(sql,args)).rows,iq=async(sql,args)=>(await installer.query(sql,args)).rows;
const audit=JSON.parse(await fs.readFile('docs/qa/2026-10-31-budget-b7-preflight-audit.json','utf8'));
const record=async f=>{const old=chain==='staging'?audit.staging.ledger.find(r=>r.version===f.version):null;let source=f.source;if(old?.source_sha256&&hash(source)!==old.source_sha256&&hash(source+'\n')===old.source_sha256)source+='\n';await q('insert into supabase_migrations.schema_migrations values($1,$2,$3)',[f.version,old?.name||f.file.slice(f.version.length+1,-4),old&&!old.source_sha256?null:[source]]);};
const state=async()=>({schemas:await q("select oid,nspname,nspowner,nspacl from pg_namespace where nspname in('public','app_private','auth','storage','supabase_migrations') order by oid"),ledger:await q('select * from supabase_migrations.schema_migrations order by version'),data:await captureProtection(db),roles:await q('select oid,rolname,rolsuper,rolbypassrls,rolinherit,rolcanlogin from pg_roles order by oid'),memberships:await q('select * from pg_auth_members order by roleid,member,grantor'),functions:await q("select to_jsonb(p) row from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private') order by p.oid"),tables:await q("select c.oid,n.nspname,c.relname,c.relacl,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','app_private','auth','storage') order by c.oid"),policies:await q('select * from pg_policies order by schemaname,tablename,policyname')});
const flags=async()=>q("select 'metadata' k,enabled v from app_private.budget_metadata_protocol union all select 'finance',enabled or activated from app_private.budget_finance_protocol union all select 'payment',enabled from app_private.budget_payment_protocol union all select 'source',enabled from app_private.budget_source_protocol union all select 'receipts',enabled or activated from app_private.budget_receipt_protocol union all select 'lifecycle',enabled or activated from app_private.budget_lifecycle_protocol union all select 'undo',enabled or full_enabled from app_private.budget_metadata_undo_protocol");
const user=uuid(),trip=uuid(),past=uuid(),budget=uuid(),actual=uuid();let built,beforeRows;const originalColumns=new Map();
async function rollback(sql,code){await assert.rejects(()=>iq(sql),e=>e.code===code);await iq('rollback');}
async function scoped(client,headers,fn){await client.query('begin');try{await client.query("select set_config('role','budget_receipt_worker',true),set_config('request.headers',$1,true)",[JSON.stringify(headers)]);const r=await fn(client);await client.query('commit');return r;}catch(e){await client.query('rollback');throw e;}}
try{
 await db.connect();assert.equal((await q("select current_setting('budget_metadata.test_cluster',true) marker"))[0].marker,marker);
 await q(nativeBootstrap);await q('create role postgres login noinherit createrole bypassrls;alter role authenticator login;alter role supabase_storage_admin login;grant authenticator to supabase_storage_admin with inherit false,set true');
 const all=await migrationSources(),hotfix=all.find(f=>f.file.startsWith('20261031003000'));
 const pre=all.filter(f=>f.file<='20261028104333_budget_selection_activity.sql'&&(chain==='fresh'||!f.file.startsWith('20260811150000')));
 for(const f of pre){await q(f.source);await record(f);}if(chain==='staging'){await q(hotfix.source);await record(hotfix);}
 await q('insert into auth.users values($1,$2,$3)',[user,'isolated@example.invalid',{}]);
 await q("insert into trips(id,title,name,destination,start_date,end_date,owner_id) values($1,'Future','Future','Fixture','2099-01-01','2099-01-03',$3),($2,'Past','Past','Fixture','2020-01-01','2020-01-03',$3)",[trip,past,user]);
 await q("insert into trip_members(trip_id,user_id,role,status) values($1,$3,'owner','approved'),($2,$3,'owner','approved')",[trip,past,user]);
 for(let n=0;n<25;n++){const id=uuid();await q("insert into itinerary_items(id,trip_id,day_index,sort_order,type,title) values($1,$2,0,$3,'attraction','Fixture')",[id,n<12?trip:past,n]);if(n===0)for(let i=0;i<3;i++)await q("insert into itinerary_alternatives(itinerary_item_id,title) values($1,'Alternative')",[id]);}
 await q("update trip_budget_baselines set departure_at='2000-01-01',payload='{\"historical\":true}'");
 await q("insert into budget_items(id,trip_id,title,category,amount,twd_amount,currency,exchange_rate,payer_id) values($1,$2,'Budget','交通',900,900,'TWD',1,$3)",[budget,past,user]);
 await q('insert into budget_item_participants(budget_item_id,user_id,share_amount) values($1,$2,900)',[budget,user]);
 await q("insert into actual_expenses(id,trip_id,budget_item_id,title,category,amount,twd_amount,currency,exchange_rate,payer_id,payment_origin,twd_amount_source,actual_twd_amount,payment_history) values($1,$2,$3,'Debit','交通',1000,777,'JPY',0.2,$4,'manual','actual',777,'[{\"cost\":777}]')",[actual,past,budget,user]);
 await q('insert into actual_expense_participants(actual_expense_id,user_id) values($1,$2)',[actual,user]);
 await q("insert into attachments(trip_id,target_type,target_id,file_name,file_url,file_type,file_size) values($1,'actual_expense',$2,'protected.pdf','protected-receipt','application/pdf',8)",[past,actual]);
 // Stock PostgreSQL has no Supautils hook. Fixture owners permit policy DDL;
 // only the non-superuser SET-membership/RLS model is asserted here.
 // Transfer only fixture/application objects, never initdb/system objects.
 await q(`do $$declare r record;begin
  for r in select nspname from pg_namespace where nspname in('public','app_private','auth','storage','supabase_migrations') loop
   execute format('grant usage,create on schema %I to postgres with grant option',r.nspname);
  end loop;
  alter schema public owner to postgres;
  alter schema app_private owner to postgres;
  for r in select n.nspname,c.relname,c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in('public','app_private','auth','storage','supabase_migrations') and c.relkind in('r','p','v','m','S') order by c.relkind='S',c.oid loop
   execute format('alter %s %I.%I owner to postgres',case r.relkind when 'S' then 'sequence' when 'v' then 'view' when 'm' then 'materialized view' else 'table' end,r.nspname,r.relname);
  end loop;
  for r in select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in('public','app_private','auth','storage') and p.prokind='f'
    and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') loop
   execute 'alter function '||r.signature||' owner to postgres';
  end loop;
 end $$;`);
 await q('alter default privileges for role postgres in schema public grant all on functions to anon,authenticated,service_role;alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;alter default privileges for role postgres in schema public grant all on sequences to anon,authenticated,service_role');
 await installer.connect();await storage.connect();await api.connect();await ordinary.connect();
 assert.equal((await iq("select rolsuper from pg_roles where rolname=current_user"))[0].rolsuper,false);
 beforeRows=await captureProtection(db);
 for(const row of beforeRows)originalColumns.set(row.name,(await q("select column_name from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position",[row.name])).map(r=>r.column_name));
 if(chain==='staging'){
  const baselineSeal=JSON.parse(await fs.readFile('docs/operations/budget-b7-staging/baseline-seal.json','utf8'));
  built=await managedArtifacts({protection:beforeRows,baselineSeal});await iq("set app.b7_install_target='uyqdopksfysbobhjcepk'");
  await test('Absent existing Storage SET path refuses before install and rolls back all objects',async()=>{await q('revoke authenticator from supabase_storage_admin');const before=await state();await rollback(built.sql,'55000');assert.deepEqual(await state(),before);await q('grant authenticator to supabase_storage_admin with inherit false,set true');});
  await test('Missing effective schema Grant Option refuses candidate and rolls back',async()=>{await q('revoke grant option for usage on schema storage from postgres cascade');const before=await state();await rollback(built.sql,'55000');assert.deepEqual(await state(),before);await q('grant usage on schema storage to postgres with grant option');});
  await test('Unreviewed direct Worker member refuses candidate and rolls back',async()=>{const before=await state(),bad=built.sql.replace('create role budget_receipt_worker nologin noinherit nobypassrls;',()=>"create role budget_receipt_worker nologin noinherit nobypassrls;grant budget_receipt_worker to budget_actor_a;");assert.notEqual(bad,built.sql);await rollback(bad,'55000');assert.deepEqual(await state(),before);});
  await test('Late Forward fault rolls back roles membership ledger schema and original financial data',async()=>{const before=await state(),bad=built.sql.replace('changed:=changed+1;',()=>"changed:=changed+1; if changed=1 then perform 1/0;end if;");assert.notEqual(bad,built.sql);await rollback(bad,'22012');assert.deepEqual(await state(),before);});
  await test('Non-superuser Staging out-of-order packet installs exact replacement without reserved-role mutation',async()=>{await iq(built.sql);});
 }else{
  built=await managedArtifacts();
  await test('Fresh chronological supersession chain installs Hotfix then M0 then F0',async()=>{
   const source={file:replacementFile,version:replacementFile.split('_')[0],source:built.source};
   const queue=[...all.filter(f=>f.file>'20261028104333_budget_selection_activity.sql'&&f.file!==supersededFile),source,{file:'20261031130000_budget_business_conflicts_forward.sql',version:'20261031130000',source:normalize(await fs.readFile('docs/operations/budget-b7-staging/20261031130000_budget_business_conflicts_forward.sql','utf8'))}].sort((a,b)=>a.version.localeCompare(b.version));
   for(const f of queue){await iq(f.source);await record(f);}
  });
 }
 await test('Replacement ledger is truthful and original immutable superseded version remains absent',async()=>{const rows=await q('select version,name,statements from supabase_migrations.schema_migrations order by version');assert.equal(rows.length,62);assert(!rows.some(r=>r.version==='20261030125028'));assert.equal(rows.find(r=>r.version===replacementFile.split('_')[0]).statements[0],built.source);for(const f of built.manifest.sources){const r=rows.find(r=>r.version===f.file.split('_')[0]);assert(r,f.file);assert.equal(hash(normalize(r.statements[0])),f.sha256,f.file);}assert.equal(rows.filter(r=>r.version==='20261031003000').length,1);});
 await test('All original protected rowsets including payment history source receipt and Baseline survive',async()=>{for(const before of beforeRows){const projection=(await q(`select count(*)::int rows,encode(sha256(convert_to(coalesce(jsonb_agg(v order by v::text),'[]')::text,'UTF8')),'hex') sha from (select (select jsonb_object_agg(k,x) from jsonb_each(to_jsonb(t)) e(k,x) where k=any($1)) v from public.${before.name} t) s`,[originalColumns.get(before.name)]))[0];assert.equal(projection.rows,before.rows,before.name);assert.equal(projection.sha,before.rowset_sha256,before.name);}
  const financial=(await q('select actual_twd_amount,payment_origin,payment_history from actual_expenses where id=$1',[actual]))[0];assert.equal(financial.actual_twd_amount,'777.00');assert.equal(financial.payment_origin,'manual');assert.deepEqual(financial.payment_history,[{cost:777}]);assert.equal((await q("select count(*)::int n from attachments where file_url='protected-receipt'"))[0].n,1);
 });
 await test('38 final compiled hashes retain Guard and exactly54 PT409 /24 PT500; no custom40001',async()=>{const seal=JSON.parse(await fs.readFile('docs/operations/budget-b7-staging/compiled-seal.json','utf8'));let pt409=0,pt500=0;for(const f of seal.functions){const p=(await q('select prosrc from pg_proc where oid=to_regprocedure($1)',[f.signature]))[0];assert(p);assert.equal(hash(normalize(p.prosrc)),f.afterSha256,f.signature);pt409+=(p.prosrc.match(/errcode\s*=\s*'PT409'/gi)||[]).length;pt500+=(p.prosrc.match(/errcode\s*=\s*'PT500'/gi)||[]).length;}assert.equal(pt409,54);assert.equal(pt500,24);assert.equal((await q("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private') and prosrc ~* $x$errcode[[:space:]]*=[[:space:]]*'40001'$x$"))[0].n,0);});
 await test('Only authenticator has a direct SET grant; creator ADMIN has no SET/INHERIT; Worker has no elevated/raw private grants',async()=>{assert.deepEqual((await q("select rolcanlogin,rolsuper,rolinherit,rolbypassrls from pg_roles where rolname='budget_receipt_worker'"))[0],{rolcanlogin:false,rolsuper:false,rolinherit:false,rolbypassrls:false});assert.deepEqual((await q("select m.member::regrole::text member,m.admin_option,m.inherit_option,m.set_option from pg_auth_members m where roleid='budget_receipt_worker'::regrole order by member")),[{member:'authenticator',admin_option:false,inherit_option:false,set_option:true},{member:'postgres',admin_option:true,inherit_option:false,set_option:false}]);assert.deepEqual(await q("select * from pg_auth_members where member='budget_receipt_worker'::regrole"),[]);assert.deepEqual(await q("select table_name from information_schema.role_table_grants where table_schema='app_private' and grantee in('PUBLIC','anon','authenticated','budget_receipt_worker')"),[]);assert.equal((await q("select pg_has_role('supabase_storage_admin','budget_receipt_worker','SET') ok"))[0].ok,true);});
 await test('Real non-superuser Storage and API connections transitively SET worker; ordinary account cannot',async()=>{for(const client of [storage,api])assert.equal(await scoped(client,{},async c=>(await c.query('select current_user')).rows[0].current_user),'budget_receipt_worker');await assert.rejects(()=>ordinary.query('set role budget_receipt_worker'),e=>e.code==='42501');});
 const object=uuid(),job=uuid(),token=uuid(),target='claim-scoped-object';
 await q("insert into storage.objects(id,bucket_id,name,metadata) values($1,'trip-attachments',$2,'{\"size\":5,\"mimetype\":\"application/pdf\"}')",[object,target]);
 await q("insert into app_private.budget_receipt_intents(request_id,user_id,session_id,trip_id,actual_id,signature,action,base_revision,versions,object_path,file_type,file_size,digest,object_id,verification_token,verification_until) values($1,$2,$3,$4,$5,'{}','upload',0,'{}',$6,'application/pdf',5,$7,$8,$9,clock_timestamp()+interval '1 minute')",[job,user,uuid(),past,actual,target,'a'.repeat(64),object,token]);
 const headers={'x-receipt-worker-job':job,'x-receipt-worker-token':token};
 const visible=async h=>scoped(storage,h,async c=>(await c.query('select id from storage.objects where name=$1',[target])).rows);
 await test('Real SQL role scope reads only exact durable claim and fails closed on bad/missing headers or object-ID change',async()=>{assert.equal((await visible(headers)).length,1);assert.equal((await visible({})).length,0);assert.equal((await visible({...headers,'x-receipt-worker-token':uuid()})).length,0);await q('update storage.objects set id=$1 where id=$2',[uuid(),object]);assert.equal((await visible(headers)).length,0);await q('update storage.objects set id=$1 where name=$2',[object,target]);await q("update app_private.budget_receipt_intents set verification_until=clock_timestamp()-interval '1 second' where request_id=$1",[job]);assert.equal((await visible(headers)).length,0);});
 await q('delete from app_private.budget_receipt_intents where request_id=$1',[job]);await q('delete from storage.objects where id=$1',[object]);
 const cleanup=uuid(),cleanupToken=uuid(),dead=uuid(),foreign=uuid();
 await q("insert into storage.objects(id,bucket_id,name) values($1,'trip-attachments','unreferenced'),($2,'trip-attachments','protected-receipt')",[dead,foreign]);
 await q("insert into app_private.budget_receipt_cleanup(id,trip_id,actual_id,object_path,object_id,reason,status,claim_token,claim_until) values($1,$2,$3,'unreferenced',$4,'fixture','claimed',$5,clock_timestamp()+interval '1 minute')",[cleanup,past,actual,dead,cleanupToken]);
 await test('Exact cleanup claim deletes only unreferenced matching metadata; referenced Receipt is protected',async()=>{const h={'x-receipt-worker-job':cleanup,'x-receipt-worker-token':cleanupToken};await q("update app_private.budget_receipt_cleanup set object_path='protected-receipt',object_id=$2 where id=$1",[cleanup,foreign]);assert.equal(await scoped(storage,h,async c=>(await c.query("delete from storage.objects where name='protected-receipt' returning id")).rowCount),0);await q("update app_private.budget_receipt_cleanup set object_path='unreferenced',object_id=$2 where id=$1",[cleanup,dead]);assert.equal(await scoped(storage,{...h,'x-receipt-worker-token':uuid()},async c=>(await c.query("delete from storage.objects where name='unreferenced' returning id")).rowCount),0);assert.equal(await scoped(storage,h,async c=>(await c.query('delete from storage.objects where id=any($1) returning id',[[dead,foreign]])).rowCount),1);assert.equal((await q('select count(*)::int n from storage.objects where id=$1',[foreign]))[0].n,1);});
 await q('delete from app_private.budget_receipt_cleanup where id=$1',[cleanup]);await q('delete from storage.objects where id=$1',[foreign]);
 await test('Operational Preflight / Readback pass; all seven protocols/latches stay dormant',async()=>{for(const file of ['budget-b7-preflight.sql','budget-b7-readback.sql'])await iq(await fs.readFile(`docs/operations/${file}`,'utf8'));const f=await flags();assert.equal(f.length,7);assert(f.every(r=>r.v===false));assert.deepEqual(await q("select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','app_private') and c.relkind='r' and not c.relrowsecurity"),[]);});
 if(chain==='staging')await test('Replaying full candidate refuses and preserves committed candidate schema/ledger/data',async()=>{const before=await state();await rollback(built.sql,'P0001');assert.deepEqual(await state(),before);});
}catch(e){console.error({message:e.message,code:e.code,detail:e.detail,where:e.where});process.exitCode=1;}
finally{await fs.writeFile(path.join(process.env.BUDGET_NATIVE_EVIDENCE,'managed-worker-results.json'),JSON.stringify({chain,scope:'Native PostgreSQL non-superuser role path, RLS and install atomicity only; not Supautils/HTTP/Auth/Realtime/Storage bytes',results,passed:results.filter(r=>r.status==='passed').length,failed:results.filter(r=>r.status==='failed').length},null,2)+'\n');for(const client of [ordinary,api,storage,installer,db])await client.end().catch(()=>{});}
