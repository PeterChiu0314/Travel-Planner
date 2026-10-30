// Real PostgreSQL connections. Only accepts the fresh runner's marked loopback cluster.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { randomUUID as uuid,createHash } from 'node:crypto';
import {createBudgetMetadataEditor,createBudgetMetadataService} from '../src/lib/budgetMetadataService.js';
import {metadataUndoCases} from './budget-metadata-undo-cases.mjs';
import {metadataChoiceCases} from './budget-metadata-choice-cases.mjs';
import {pricingGroupCases} from './budget-pricing-group-cases.mjs';
import {paymentGroupCases} from './budget-payment-group-cases.mjs';
import {paymentMinimalCases} from './budget-payment-minimal-cases.mjs';
import {sourceBaselineCases} from './budget-source-baseline-cases.mjs';
import {sourceGroupCases} from './budget-source-group-cases.mjs';
import {createBudgetPaymentController} from '../src/lib/budgetPaymentGroups.js';
import {createBudgetSourceController,createBudgetSourceService} from '../src/lib/budgetSourceGroups.js';
import {receiptCases} from './budget-receipts-cases.mjs';
import {financeCases} from './budget-finance-cases.mjs';
import {lifecycleCases} from './budget-lifecycle-cases.mjs';
import {workspaceUndoCases} from './budget-workspace-undo-cases.mjs';
import {integrationCases} from './budget-integration-cases.mjs';
const port=Number(process.env.BUDGET_NATIVE_PORT),marker=process.env.BUDGET_NATIVE_MARKER;
assert(Number.isInteger(port)&&port>1024&&port<65536&&/^[a-f0-9-]{36}$/.test(marker||''),'Use the isolated runner, not a database URL');
const imported=await import(pathToFileURL(process.env.BUDGET_NATIVE_PG_MODULE).href);
const {Client}=imported.default||imported;
const config={host:'127.0.0.1',port,database:'postgres',ssl:false,connectionTimeoutMillis:5000};
const control=new Client({...config,user:'budget_local_admin',application_name:'metadata-test-observer'});
const a=new Client({...config,user:'budget_actor_a',application_name:'metadata-test-A'});
const b=new Client({...config,user:'budget_actor_b',application_name:'metadata-test-B'});
const results=[],observations=[];
const actorA=uuid(),actorB=uuid(),viewer=uuid(),pending=uuid(),outsider=uuid(),trip=uuid(),secretTrip=uuid();
const identities=new Map([[a,{actor:actorA,session:uuid(),token:uuid()}],[b,{actor:actorB,session:uuid(),token:uuid()}]]);
let pidA,pidB,observerPid,gate=910000;
const query=async(client,sql,values=[])=>{const result=await client.query(sql,values);return result.rows;};
const definitions=()=>admin("select p.oid::regprocedure::text name,replace(pg_get_functiondef(p.oid),chr(13),'') body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.prokind='f' order by name");
const admin=(sql,values=[])=>query(control,sql,values);
const waitUntil=async(check,label,timeout=8000)=>{
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){const value=await check();if(value)return value;await new Promise(resolve=>setTimeout(resolve,20));}
  throw new Error(`Barrier timed out: ${label}`);
};
const activity=async()=>admin(`select pid,application_name,state,wait_event_type,wait_event,
  backend_xid::text,xact_start,query_start,clock_timestamp() observed_at,pg_blocking_pids(pid) blocking_pids
  from pg_stat_activity where pid=any($1::int[]) order by pid`,[[pidA,pidB]]);
const record=async (id,kind='budget')=>(await admin(`select to_jsonb(b) data from ${kind==='budget'?'budget_items':'actual_expenses'} b where id=$1`,[id]))[0].data;
const snapshot=async(client=a,tripId=trip,session=identities.get(client)?.session)=>
  (await query(client,'select public.read_budget_metadata_snapshot($1,$2) data',[tripId,session]))[0].data;
const signal=async(tripId=trip)=>(await admin('select revision::text revision from budget_collaboration_signals where trip_id=$1',[tripId]))[0]?.revision??'0';
const metadataRecord=(snap,id,kind='budget')=>snap.metadataRecords.find(r=>r.id===id&&r.kind===kind);
const state=async(id,group)=>(await admin('select revision,lease_epoch,user_id,session_id,expires_at from app_private.budget_metadata_groups where kind=\'budget\' and resource_id=$1 and group_key=$2',[id,group]))[0];
const leaseAction=(client,id,group,action='acquire',options={})=>{
  const identity=identities.get(client);
  return {text:'public.budget_metadata_group_lease($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',values:[trip,options.kind||'budget',id,group,
    options.session||identity.session,options.token||identity.token,action,options.base??0,options.epoch??null,0,false]};
};
const patchAction=(client,id,group,value,options={})=>{
  const identity=identities.get(client);
  return {text:'public.patch_budget_metadata_group($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)',values:[trip,options.kind||'budget',id,group,options.base??0,
    options.session||identity.session,options.token||identity.token,options.epoch,JSON.stringify({[group]:value}),options.request||uuid()]};
};
const call=async(client,action)=>(await query(client,`select ${action.text} data`,action.values))[0].data;
const legacyAction=(client,id,base)=>{const identity=identities.get(client);return {text:"public.budget_edit_lease('budget',$1,$2,$3,'acquire',$4)",values:[id,identity.session,identity.token,base]};};
const holdCall=async(client,action,heldGate)=>{
  return (await query(client,`select budget_test.hold_result(${action.text},$${action.values.length+1}::bigint) data`,[...action.values,heldGate]))[0].data;
};
const transaction=async(client,work)=>{
  await client.query('begin');
  try{const result=await work();await client.query('commit');return {ok:true,data:result};}
  catch(error){await client.query('rollback');return {ok:false,code:error.code,message:error.message,detail:error.detail};}
};
const fixture=async()=>{
  const id=uuid();
  await admin("insert into budget_items(id,trip_id,title,note,category,amount,twd_amount,currency,exchange_rate,payer_id) values($1,$2,'Initial','Initial note','交通',900,900,'TWD',1,$3)",[id,trip,actorA]);
  await admin('insert into budget_item_participants(budget_item_id,user_id,share_amount) values($1,$2,300),($1,$3,600)',[id,actorA,actorB]);return id;
};
const test=async(name,run)=>{
  if(process.env.BUDGET_NATIVE_INTEGRATION_ONLY==='1'&&!name.startsWith('B7'))return;
  if(process.env.BUDGET_NATIVE_RECEIPTS_ONLY==='1'&&!name.startsWith('Receipt'))return;
  if(process.env.BUDGET_NATIVE_FINANCE_ONLY==='1'&&!name.startsWith('Finance'))return;
  if(process.env.BUDGET_NATIVE_LIFECYCLE_ONLY==='1'&&!name.startsWith('Lifecycle'))return;
  if(process.env.BUDGET_NATIVE_UNDO_FULL_ONLY==='1'&&!name.startsWith('WorkspaceUndo'))return;
  const started=Date.now();
  try{const detail=await run();results.push({name,status:'passed',ms:Date.now()-started,...detail});console.log(`PASS ${name}`);}
  catch(error){results.push({name,status:'failed',ms:Date.now()-started,message:error.message,code:error.code});console.error(`FAIL ${name}: ${error.message}`);}
  finally{if(pidA)await Promise.allSettled([a.query('rollback'),b.query('rollback')]);await admin('select pg_advisory_unlock_all()');}
};
// A remains active inside its SQL SELECT, blocked on the observer's test-only
// gate. B is then observed waiting on A's real production advisory/row lock.
const overlap=async(name,actionA,actionB,options={})=>{
  const heldGate=++gate;
  await admin('select pg_advisory_lock($1::bigint)',[heldGate]);
  const workA=transaction(a,()=>holdCall(a,actionA,heldGate));
  let workB,proof;
  try{
    await waitUntil(async()=>{const rows=await activity();return rows.some(r=>r.pid===pidA&&r.state==='active'&&r.blocking_pids.includes(observerPid));},`${name}: A gate`);
    workB=transaction(b,()=>call(b,actionB));
    proof=await waitUntil(async()=>{
      const rows=await activity(),ar=rows.find(r=>r.pid===pidA),br=rows.find(r=>r.pid===pidB);
      if(ar?.state==='active'&&br?.state==='active'&&ar.blocking_pids.includes(observerPid)&&br.blocking_pids.includes(pidA))return rows;
    },`${name}: two active blocked backend queries`);
    observations.push({name,proof});
    if(options.inspect)await options.inspect();
  }finally{await admin('select pg_advisory_unlock($1::bigint)',[heldGate]);}
  const outcomes=await Promise.all([workA,workB]);return {outcomes,proof};
};
try{
  await control.connect();
  assert.equal((await admin("select current_setting('budget_metadata.test_cluster',true) marker"))[0].marker,marker,'Refusing an unmarked server');
  assert.equal((await admin('select count(*)::int n from pg_database where datname not in (\'postgres\',\'template0\',\'template1\')'))[0].n,0,'Refusing a reused cluster');
  await control.query(`create role anon;create role authenticated;create role service_role bypassrls;
    create role budget_actor_a login;create role budget_actor_b login;create role budget_anon login;
    grant authenticated to budget_actor_a,budget_actor_b;
    grant anon to budget_anon;
    create schema auth;create schema storage;create schema budget_test;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;
    grant usage on schema public,auth,storage,budget_test to authenticated,anon;
    alter default privileges in schema public grant all on tables to authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key,bucket_id text,name text,owner uuid,metadata jsonb);
    create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
    create publication supabase_realtime;
    create function budget_test.hold_result(value jsonb,gate bigint) returns jsonb language plpgsql security invoker as $$
      begin perform pg_advisory_xact_lock(gate);return value;end $$;
    create function budget_test.await_gate(gate bigint) returns boolean language plpgsql security invoker as $$
      begin perform pg_advisory_xact_lock(gate);return true;end $$;
    create function budget_test.revoke_member(trip uuid,actor uuid) returns jsonb language plpgsql security invoker as $$
      begin perform pg_advisory_xact_lock(hashtextextended(trip::text,0));
        update public.trip_members set status='pending' where trip_id=trip and user_id=actor;return '{}'::jsonb;end $$;
    grant execute on function budget_test.hold_result(jsonb,bigint),budget_test.await_gate(bigint),budget_test.revoke_member(uuid,uuid) to authenticated;`);
  const migrationDir=new URL('../supabase/migrations/',import.meta.url),hashes=[];
  for(const file of (await fs.readdir(migrationDir)).filter(f=>f.endsWith('.sql')).sort()){
    // PostgreSQL stores function body line endings verbatim. Compare the same
    // logical source on LF and Windows CRLF checkouts without editing migrations.
    const source=(await fs.readFile(new URL(file,migrationDir),'utf8')).replace(/\r\n/g,'\n');
    if(file==='20261030125028_budget_workspace_integration_safety.sql'&&process.env.BUDGET_NATIVE_INTEGRATION_ONLY==='1'){
      await test('B7 forward migration failure is fully atomic and successful expansion preserves known cost origin receipt and baseline',async()=>{
        const u=uuid(),t=uuid(),bid=uuid(),aid=uuid();await admin('insert into auth.users(id) values($1)',[u]);await admin("insert into trips(id,title,name,destination,start_date,end_date,owner_id) values($1,'B7 preservation','B7 preservation','Japan',current_date+10,current_date+15,$2)",[t,u]);await admin("insert into budget_items(id,trip_id,title,category,amount,twd_amount) values($1,$2,'Original Budget','交通',900,900)",[bid,t]);await admin("insert into actual_expenses(id,trip_id,budget_item_id,title,category,amount,twd_amount,currency,exchange_rate,payment_origin,twd_amount_source,actual_twd_amount,payment_history) values($1,$2,$3,'Original Actual','交通',900,777,'TWD',1,'manual','actual',777,'[{\"keep\":true}]')",[aid,t,bid]);await admin("insert into attachments(trip_id,target_type,target_id,file_name,file_url) values($1,'actual_expense',$2,'keep.pdf','original-receipt')",[t,aid]);
        const rows=()=>admin("select k,v from(select 'budget' k,to_jsonb(x) v from budget_items x where trip_id=$1 union all select 'actual',to_jsonb(x) from actual_expenses x where trip_id=$1 union all select 'receipt',to_jsonb(x) from attachments x where trip_id=$1 union all select 'baseline',to_jsonb(x) from trip_budget_baselines x where trip_id=$1)q order by k,v::text",[t]);
        const catalog=async()=>({defs:await definitions(),policies:await admin('select * from pg_policies order by schemaname,tablename,policyname'),rls:await admin("select c.oid::regclass::text n,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app_private' and relkind='r' order by 1"),roles:await admin('select rolname,rolsuper,rolbypassrls,rolcanlogin from pg_roles order by rolname')});
        const before=await rows(),cat=await catalog();await assert.rejects(()=>admin(source.replace(/commit;\s*$/i,()=> 'select 1/0;commit;')),e=>e.code==='22012');await admin('rollback');assert.deepEqual(await catalog(),cat);assert.deepEqual(await rows(),before);await admin(source);assert.deepEqual(await rows(),before);await admin('delete from trips where id=$1',[t]);await admin('delete from auth.users where id=$1',[u]);
      });
      // The successful test expansion above already installed this migration.
      hashes.push({file,sha256:createHash('sha256').update(source).digest('hex')});continue;
    }
    if(file==='20261030082712_budget_workspace_undo.sql'&&process.env.BUDGET_NATIVE_UNDO_FULL_ONLY==='1'){
      await test('WorkspaceUndo forward fault and dormant reverse preserve complete definitions ACL and private rows',async()=>{
        const catalog=async()=>({defs:await definitions(),acl:await admin("select oid::regprocedure::text name,proacl::text acl from pg_proc where pronamespace in('public'::regnamespace,'app_private'::regnamespace) and prokind='f' order by name"),rows:await admin("select * from app_private.budget_metadata_undo_operations order by operation_id"),policies:await admin('select * from pg_policies order by schemaname,tablename,policyname')});
        const before=await catalog();await assert.rejects(()=>admin(source.replace(/commit;\s*$/i,'select 1/0;commit;')),e=>e.code==='22012');await admin('rollback');assert.deepEqual(await catalog(),before);await admin(source);await admin(await fs.readFile(new URL('../docs/qa/2026-10-30-budget-workspace-undo-rollback.sql',import.meta.url),'utf8'));assert.deepEqual(await catalog(),before);
      });
    }
    if(file==='20261030064703_budget_workspace_lifecycle.sql'&&process.env.BUDGET_NATIVE_LIFECYCLE_ONLY==='1'){
      await test('Lifecycle forward fault and dormant reverse preserve old definitions permissions and financial identities',async()=>{
        const u=uuid(),t=uuid(),bid=uuid();await admin('insert into auth.users(id) values($1)',[u]);await admin("insert into trips(id,title,name,destination,start_date,end_date,owner_id) values($1,'Lifecycle QA','Lifecycle QA','Japan','2090-01-01','2090-01-05',$2)",[t,u]);await admin("insert into budget_items(id,trip_id,title,category,amount,twd_amount) values($1,$2,'Keep existing','其他',10,10)",[bid,t]);
        const catalog=async()=>({defs:await definitions(),acl:await admin("select oid::regprocedure::text name,proacl::text acl from pg_proc where pronamespace in('public'::regnamespace,'app_private'::regnamespace) and prokind='f' order by name"),policies:await admin('select * from pg_policies order by schemaname,tablename,policyname'),rows:await admin("select * from (select 'budget' k,to_jsonb(t) v from budget_items t union all select 'actual',to_jsonb(t) from actual_expenses t union all select 'groups',to_jsonb(t) from app_private.budget_metadata_groups t) q order by k,v::text")});
        const before=await catalog();await assert.rejects(()=>admin(source.replace(/commit;\s*$/i,'select 1/0;commit;')),e=>e.code==='22012');await admin('rollback');assert.deepEqual(await catalog(),before);await admin(source);await admin(await fs.readFile(new URL('../docs/qa/2026-10-30-budget-lifecycle-rollback.sql',import.meta.url),'utf8'));assert.deepEqual(await catalog(),before);await admin('delete from trips where id=$1',[t]);await admin('delete from auth.users where id=$1',[u]);
      });
    }
    if(file==='20261030054628_budget_financial_dependencies.sql'&&process.env.BUDGET_NATIVE_FINANCE_ONLY==='1'){
      await test('Finance forward failure and unused reverse preserve definitions ACLs policies and existing financial rows',async()=>{
        const user=uuid(),tid=uuid(),bid=uuid(),aid=uuid();await admin('insert into auth.users(id) values($1)',[user]);await admin("insert into trips(id,title,name,destination,start_date,end_date,owner_id) values($1,'Finance migration','Finance migration','Japan','2090-01-01','2090-01-06',$2)",[tid,user]);await admin("insert into budget_items(id,trip_id,title,category,amount,twd_amount,payer_id) values($1,$2,'Keep budget','交通',900,900,$3)",[bid,tid,user]);await admin("insert into actual_expenses(id,trip_id,budget_item_id,title,category,amount,twd_amount,payer_id) values($1,$2,$3,'Keep actual','交通',900,777,$4)",[aid,tid,bid,user]);
        const catalog=async()=>({defs:await definitions(),acl:await admin("select oid::regprocedure::text name,proacl::text acl from pg_proc where pronamespace in('public'::regnamespace,'app_private'::regnamespace) and prokind='f' order by name"),policies:await admin('select * from pg_policies order by schemaname,tablename,policyname'),rows:await admin("select * from (select 'trip' k,to_jsonb(t) v from trips t union all select 'budget',to_jsonb(t) from budget_items t union all select 'actual',to_jsonb(t) from actual_expenses t union all select 'groups',to_jsonb(t) from app_private.budget_metadata_groups t) q order by k,v::text")});
        const before=await catalog();await assert.rejects(()=>admin(source.replace(/commit;\s*$/i,'select 1/0;commit;')),e=>e.code==='22012');await admin('rollback');assert.deepEqual(await catalog(),before);await admin(source);await admin(await fs.readFile(new URL('../docs/qa/2026-10-30-budget-finance-rollback.sql',import.meta.url),'utf8'));assert.deepEqual(await catalog(),before);await admin('delete from trips where id=$1',[tid]);await admin('delete from auth.users where id=$1',[user]);
      });
    }
    if(file==='20261030034351_budget_receipts_lifecycle.sql'&&process.env.BUDGET_NATIVE_RECEIPTS_ONLY==='1'){
      await test('Receipt forward migration fault and unused reverse preserve definitions ACLs Storage policies and existing receipt identities',async()=>{
        const u=uuid(),t=uuid(),id=uuid(),receipt=uuid(),path=`trips/${t}/attachments/actual_expense/${id}/legacy.pdf`;
        await admin('insert into auth.users(id) values($1)',[u]);await admin("insert into trips(id,title,name,destination,start_date,end_date,owner_id) values($1,'Receipt migration QA','Receipt migration QA','Japan','2090-01-01','2090-01-06',$2)",[t,u]);await admin("insert into actual_expenses(id,trip_id,title,category,amount,twd_amount,currency,exchange_rate,payer_id) values($1,$2,'Legacy actual','交通',900,900,'TWD',1,$3)",[id,t,u]);await admin("insert into attachments(id,trip_id,target_type,target_id,file_name,file_url) values($1,$2,'actual_expense',$3,'legacy.pdf',$4)",[receipt,t,id,path]);await admin("insert into storage.objects(id,bucket_id,name,metadata) values($1,'trip-attachments',$2,'{\"size\":5,\"mimetype\":\"application/pdf\"}')",[uuid(),path]);
        const catalog=async()=>({defs:await definitions(),acl:await admin("select oid::regprocedure::text name,proacl::text acl from pg_proc where pronamespace in('public'::regnamespace,'app_private'::regnamespace) and prokind='f' order by name"),policies:await admin("select * from pg_policies where schemaname='storage' order by policyname"),serviceUsage:(await admin("select has_schema_privilege('service_role','app_private','usage') v"))[0].v,rows:await admin("select * from (select 'actual' k,to_jsonb(t) v from actual_expenses t union all select 'receipt',to_jsonb(t) from attachments t union all select 'objects',to_jsonb(t) from storage.objects t union all select 'groups',to_jsonb(t) from app_private.budget_metadata_groups t) q order by k,v::text")});
        const before=await catalog();await assert.rejects(()=>admin(source.replace(/commit;\s*$/i,'select 1/0;commit;')),e=>e.code==='22012');await admin('rollback');assert.deepEqual(await catalog(),before);await admin(source);await admin(await fs.readFile(new URL('../docs/qa/2026-10-30-budget-receipt-rollback.sql',import.meta.url),'utf8'));assert.deepEqual(await catalog(),before);
        await admin('delete from storage.objects where name=$1',[path]);await admin('delete from trips where id=$1',[t]);await admin('delete from auth.users where id=$1',[u]);
      });
    }
    if(file==='20261030021719_budget_source_atomic_groups.sql'){
      await test('Source migration fault and dormant reverse preserve full definitions ACLs nonempty identities receipts and groups',async()=>{
        const user=uuid(),t=uuid(),bid=uuid(),aid=uuid(),receipt=uuid();
        await admin('insert into auth.users(id) values($1)',[user]);await admin("insert into trips(id,title,name,destination,start_date,end_date,owner_id) values($1,'Migration fixture','Migration fixture','Japan','2090-01-01','2090-01-06',$2)",[t,user]);
        await admin("insert into budget_items(id,trip_id,title,category,amount,twd_amount,currency,exchange_rate,payer_id) values($1,$2,'Original source','交通',900,900,'TWD',1,$3)",[bid,t,user]);await admin("insert into actual_expenses(id,trip_id,budget_item_id,title,category,amount,twd_amount,currency,exchange_rate,payer_id) values($1,$2,$3,'Historical actual','交通',900,777,'TWD',1,$4)",[aid,t,bid,user]);await admin('insert into actual_expense_participants(actual_expense_id,user_id) values($1,$2)',[aid,user]);await admin("insert into attachments(id,trip_id,target_type,target_id,file_name,file_url,file_type,file_size,uploaded_by) values($1,$2,'actual_expense',$3,'original.pdf','original.pdf','application/pdf',1,$4)",[receipt,t,aid,user]);
        const grants=()=>admin("select p.oid::regprocedure::text name,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.prokind='f' order by name");
        const business=()=>admin("select * from (select 'budget' k,to_jsonb(t) v from budget_items t union all select 'actual',to_jsonb(t) from actual_expenses t union all select 'people',to_jsonb(t) from actual_expense_participants t union all select 'receipt',to_jsonb(t) from attachments t union all select 'groups',to_jsonb(t) from app_private.budget_metadata_groups t) rows order by k,v::text");
        const before=await definitions(),acl=await grants(),rows=await business();
        await assert.rejects(()=>admin(source.replace(/commit;\s*$/i,'select 1/0;commit;')),e=>e.code==='22012');await admin('rollback');assert.deepEqual(await definitions(),before);assert.deepEqual(await grants(),acl);assert.deepEqual(await business(),rows);
        await admin(source);assert.equal((await admin("select count(*)::int n from app_private.budget_metadata_groups where group_key='source' and resource_id=$1",[aid]))[0].n,1);
        await admin(await fs.readFile(new URL('../docs/qa/2026-10-30-budget-source-rollback.sql',import.meta.url),'utf8'));assert.deepEqual(await definitions(),before);assert.deepEqual(await grants(),acl);assert.deepEqual(await business(),rows);
        await admin('delete from trips where id=$1',[t]);await admin('delete from auth.users where id=$1',[user]);
      });
    }
    if(file==='20261030012554_budget_payment_minimal_bundle.sql'){
      await test('minimal Payment migration failure and dormant reverse preserve definitions grants and original business content',async()=>{
        const before=await definitions(),rows=await admin('select to_jsonb(g) v from app_private.budget_metadata_groups g order by kind,resource_id,group_key');
        const grants=()=>admin("select p.oid::regprocedure::text name,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.prokind='f' order by name");const acl=await grants();
        await assert.rejects(()=>control.query(source.replace(/commit;\s*$/i,'select 1/0;commit;')),e=>e.code==='22012');await control.query('rollback');assert.deepEqual(await definitions(),before);assert.deepEqual(await grants(),acl);
        await control.query(source);await control.query(await fs.readFile(new URL('../docs/qa/2026-10-30-budget-payment-minimal-bundle-rollback.sql',import.meta.url),'utf8'));
        assert.deepEqual(await definitions(),before);assert.deepEqual(await grants(),acl);assert.deepEqual(await admin('select to_jsonb(g) v from app_private.budget_metadata_groups g order by kind,resource_id,group_key'),rows);
      });
    }
    if(file==='20261029134206_budget_payment_lifecycle_groups.sql'){
      await test('B-4a injected migration failure and unused reverse restore complete prior definitions and rows',async()=>{
        const defs=definitions;
        const business=()=>admin("select * from (select 'budget' k,to_jsonb(t) v from budget_items t union all select 'actual',to_jsonb(t) from actual_expenses t union all select 'budget-people',to_jsonb(t) from budget_item_participants t union all select 'actual-people',to_jsonb(t) from actual_expense_participants t union all select 'links',to_jsonb(t) from itinerary_budget_items t union all select 'receipts',to_jsonb(t) from attachments t union all select 'baseline',to_jsonb(t) from trip_budget_baselines t) originals order by k,v::text");
        const before=await defs(),data=await business();
        await assert.rejects(()=>control.query(source.replace(/commit;\s*$/i,()=> 'select 1/0;commit;')),e=>e.code==='22012');await control.query('rollback');assert.deepEqual(await defs(),before);assert.deepEqual(await business(),data);
        await control.query(source);assert.deepEqual(await business(),data);await control.query(await fs.readFile(new URL('../docs/qa/2026-10-29-budget-b4a-payment-rollback.sql',import.meta.url),'utf8'));assert.deepEqual(await defs(),before);assert.deepEqual(await business(),data);
      });
    }
    if(file==='20261029123907_budget_pricing_participant_groups.sql'){
      await test('Pricing migration injected failure and dormant reverse restore prior functions and business rows',async()=>{
        const defs=definitions;
        const rows=()=>admin("select * from (select 'budget' k,to_jsonb(t) v from budget_items t union all select 'actual',to_jsonb(t) from actual_expenses t union all select 'baseline',to_jsonb(t) from trip_budget_baselines t union all select 'people',to_jsonb(t) from budget_item_participants t) s order by k,v::text");
        const before=await defs(),data=await rows();await assert.rejects(()=>control.query(source.replace(/commit;\s*$/i,()=> 'select 1/0;commit;')),e=>e.code==='22012');await control.query('rollback');assert.deepEqual(await defs(),before);assert.deepEqual(await rows(),data);
        await control.query(source);assert.deepEqual(await rows(),data);await control.query(await fs.readFile(new URL('../docs/qa/2026-10-29-budget-pricing-groups-rollback.sql',import.meta.url),'utf8'));assert.deepEqual(await defs(),before);assert.deepEqual(await rows(),data);
      });
    }
    if(file==='20261029114817_budget_category_payer_links_groups.sql'){
      await test('choice expand failure and unused reverse preserve business contents and old definitions',async()=>{
        const defs=definitions;
        const business=()=>admin("select * from (select 'budget' k,to_jsonb(t) v from budget_items t union all select 'actual',to_jsonb(t) from actual_expenses t union all select 'baseline',to_jsonb(t) from trip_budget_baselines t) x order by k,v::text");
        const before=await defs(),rows=await business();await assert.rejects(()=>control.query(source.replace(/commit;\s*$/i,'select 1/0;commit;')),e=>e.code==='22012');await control.query('rollback');assert.deepEqual(await defs(),before);assert.deepEqual(await business(),rows);
        await control.query(source);assert.deepEqual(await business(),rows);
        await control.query(await fs.readFile(new URL('../docs/qa/2026-10-29-budget-choice-groups-rollback.sql',import.meta.url),'utf8'));assert.deepEqual(await defs(),before);assert.deepEqual(await business(),rows);
      });
    }
    if(file==='20261029091435_budget_metadata_undo_prototype.sql'){
      const definitions=()=>admin("select p.oid::regprocedure::text name,pg_get_functiondef(p.oid) body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.prokind='f' order by name");
      const financial=()=>admin("select * from (select 'budget' kind,to_jsonb(t) data from budget_items t union all select 'actual',to_jsonb(t) from actual_expenses t union all select 'metadata',to_jsonb(t) from app_private.budget_metadata_groups t union all select 'signals',to_jsonb(t) from budget_collaboration_signals t) originals order by kind,data::text");
      await test('Undo expand failure is atomic and dormant reverse preserves previous functions and full financial originals',async()=>{
        const before=await definitions(),beforeRows=await financial();await assert.rejects(()=>control.query(source.replace(/commit;\s*$/i,'select 1/0;commit;')),e=>e.code==='22012');await control.query('rollback');
        assert.deepEqual(await definitions(),before);assert.deepEqual(await financial(),beforeRows);await control.query(source);
        assert.deepEqual((await definitions()).filter(f=>before.some(old=>old.name===f.name)),before);assert.deepEqual(await financial(),beforeRows);
        await control.query(await fs.readFile(new URL('../docs/qa/2026-10-29-budget-metadata-undo-rollback.sql',import.meta.url),'utf8'));
        assert.deepEqual(await definitions(),before);assert.deepEqual(await financial(),beforeRows);
      });
    }
    if(file==='20261029031137_budget_metadata_snapshot_signals.sql'){
      const preservedUser=uuid(),preservedTrip=uuid();
      await admin('insert into auth.users(id) values($1)',[preservedUser]);
      await admin("insert into trips(id,title,name,destination,start_date,end_date,owner_id) values($1,'Preexisting','Preexisting','Japan',current_date+10,current_date+15,$2)",[preservedTrip,preservedUser]);
      await admin("insert into trip_members(trip_id,user_id,role,status) values($1,$2,'owner','approved')",[preservedTrip,preservedUser]);
      await admin("insert into budget_items(trip_id,title,note,category,amount,twd_amount,currency,exchange_rate,payer_id) values($1,'Before expansion','Retain note','交通',900,900,'TWD',1,$2)",[preservedTrip,preservedUser]);
      await admin("insert into actual_expenses(trip_id,title,note,amount,twd_amount,currency,exchange_rate,payer_id,twd_amount_source,actual_twd_amount) values($1,'Existing Actual','Retain debit',300,71,'JPY',0.2,$2,'actual',71)",[preservedTrip,preservedUser]);
      const preserved=()=>admin(`select * from (
        select 'budget' kind,to_jsonb(t) data from budget_items t union all select 'actual',to_jsonb(t) from actual_expenses t
        union all select 'groups',to_jsonb(t) from app_private.budget_metadata_groups t
        union all select 'members',to_jsonb(t) from trip_members t union all select 'baseline',to_jsonb(t) from trip_budget_baselines t
      ) originals order by kind,data::text`);
      const definitions=()=>admin("select p.oid::regprocedure::text name,pg_get_functiondef(p.oid) body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.prokind='f' order by name");
      const before=await definitions(),signalsBefore=await admin('select * from budget_collaboration_signals order by trip_id'),rowsBefore=await preserved();
      await test('snapshot extension migration failure is atomic and dormant reverse preserves old definitions/signals',async()=>{
        await assert.rejects(()=>control.query(source.replace(/commit;\s*$/i,'select 1/0; commit;')),error=>error.code==='22012');
        await control.query('rollback');assert.deepEqual(await definitions(),before);assert.deepEqual(await preserved(),rowsBefore);
        await control.query(source);
        assert.deepEqual(await preserved(),rowsBefore);assert.deepEqual((await definitions()).filter(f=>before.some(old=>old.name===f.name)),before);
        await control.query(await fs.readFile(new URL('../docs/qa/2026-10-29-budget-metadata-snapshot-rollback.sql',import.meta.url),'utf8'));
        assert.deepEqual(await definitions(),before);assert.deepEqual(await admin('select * from budget_collaboration_signals order by trip_id'),signalsBefore);assert.deepEqual(await preserved(),rowsBefore);
      });
    }
    await control.query(source);hashes.push({file,sha256:createHash('sha256').update(source).digest('hex')});
  }
  assert.equal((await admin('select enabled from app_private.budget_metadata_protocol'))[0].enabled,false);
  await admin('update app_private.budget_metadata_protocol set enabled=true');
  await admin('insert into auth.users(id) select unnest($1::uuid[])',[[actorA,actorB,viewer,pending,outsider]]);
  await admin("insert into trips(id,title,name,destination,start_date,end_date,owner_id) values($1,'Native isolated','Native isolated','Japan',current_date+10,current_date+15,$3),($2,'Private','Private','Japan',current_date+10,current_date+15,$4)",[trip,secretTrip,actorA,outsider]);
  await admin("insert into trip_members(trip_id,user_id,role,status) values($1,$2,'owner','approved'),($1,$3,'editor','approved'),($1,$4,'viewer','approved'),($1,$5,'editor','pending'),($6,$7,'owner','approved')",[trip,actorA,actorB,viewer,pending,secretTrip,outsider]);
  await Promise.all([a.connect(),b.connect()]);
  for(const client of [a,b]){
    await client.query("set statement_timeout='12s';set lock_timeout='6s';set role authenticated");
    await client.query("select set_config('request.jwt.claim.sub',$1,false)",[identities.get(client).actor]);
  }
  [pidA,pidB,observerPid]=[(await query(a,'select pg_backend_pid() pid'))[0].pid,(await query(b,'select pg_backend_pid() pid'))[0].pid,(await admin('select pg_backend_pid() pid'))[0].pid];
  assert.notEqual(pidA,pidB);assert.notEqual(pidA,observerPid);
  const sessions=await Promise.all([a,b].map(c=>query(c,"select pg_backend_pid() pid,session_user,current_user,auth.uid() actor,current_setting('transaction_isolation') isolation")));
  await fs.writeFile(path.join(process.env.BUDGET_NATIVE_EVIDENCE,'bootstrap.json'),JSON.stringify({server:(await admin('select version() version'))[0].version,pids:[pidA,pidB,observerPid],sessions,hashes},null,2));

  if(process.env.BUDGET_NATIVE_INTEGRATION_ONLY==='1'){
    await integrationCases({test,admin,query,a,b,actorA,actorB,viewer,pending,trip,secretTrip,fixture,record,call,overlap,identities,transaction,observations});
  }else if(process.env.BUDGET_NATIVE_UNDO_FULL_ONLY==='1'){
    await workspaceUndoCases({test,admin,query,a,b,actorA,actorB,viewer,pending,trip,secretTrip,fixture,record,call,overlap,identities,transaction,observations});
  }else if(process.env.BUDGET_NATIVE_LIFECYCLE_ONLY==='1'){
    await lifecycleCases({test,admin,query,a,b,actorA,actorB,trip,secretTrip,fixture,record,call,leaseAction,patchAction,overlap,identities,transaction,activity,waitUntil,pidA,pidB,observerPid,observations});
  }else if(process.env.BUDGET_NATIVE_FINANCE_ONLY==='1'){
    await financeCases({test,admin,query,a,b,actorA,actorB,viewer,pending,outsider,trip,secretTrip,fixture,record,call,leaseAction,patchAction,overlap,identities,transaction,activity,waitUntil,pidA,pidB,observerPid,observations});
  }else if(process.env.BUDGET_NATIVE_RECEIPTS_ONLY==='1'){
    await receiptCases({test,admin,query,a,b,actorA,actorB,viewer,pending,outsider,trip,secretTrip,fixture,record,call,leaseAction,patchAction,overlap,identities,transaction,activity,waitUntil,pidA,pidB,observerPid,observations});
  }else{
  await test('metadata snapshot keeps the complete invoker financial graph and exposes explicit limited readiness',async()=>{
    const id=await fixture();
    const actual=uuid();await admin("insert into actual_expenses(id,trip_id,title,amount,currency,exchange_rate,twd_amount,payer_id,payment_origin) values($1,$2,'Standalone',71,'TWD',1,71,$3,'manual')",[actual,trip,actorA]);
    const snap=await snapshot(),old=(await query(a,'select public.read_budget_snapshot($1) data',[trip]))[0].data;
    for(const [key,value] of Object.entries(old))assert.deepEqual(snap[key],value,key);
    assert.deepEqual(snap.metadataProtocol,{name:'metadata-prototype',schemaVersion:1,enabled:true,complete:false,groups:['title','note']});
    for(const [row,kind] of [[id,'budget'],[actual,'actual']]){
      const rec=metadataRecord(snap,row,kind);assert(rec.supported&&rec.state_ready);assert.equal(rec.groups.length,2);
      assert.equal(rec.groups.find(g=>g.group==='title').revision,0);
    }
    const before=await signal();await snapshot();await snapshot();assert.equal(await signal(),before,'reads must not notify');
    return {financialGraphUnchanged:true,limitedProtocol:true};
  });
  await test('group hints preserve both editors plus legacy selection ordering without leaking secrets',async()=>{
    const id=await fixture();await call(a,leaseAction(a,id,'title'));await call(b,leaseAction(b,id,'note'));
    const selection=uuid();await query(a,"select public.update_budget_selection_v2($1,$2,'budget',$3,$4,'select')",[trip,identities.get(a).session,id,selection]);
    const snap=await snapshot(),edits=snap.collaboration.entries.filter(e=>e.resource_id===id&&e.group_key);
    assert.equal(edits.length,2);assert.equal(edits.find(e=>e.group_key==='title').own_session,true);assert.equal(edits.find(e=>e.group_key==='note').own_session,false);
    const old=(await query(a,'select public.read_budget_collaboration($1,$2) data',[trip,identities.get(a).session]))[0].data;
    const legacy=snap.collaboration.entries.filter(e=>!e.group_key);
    assert.deepEqual(legacy,old.entries);
    assert(snap.nextRefreshAt);assert.equal(snap.collaborationRevision,Number(await signal()));
    const serialized=JSON.stringify(snap.metadataRecords)+JSON.stringify(snap.collaboration);
    for(const forbidden of ['token_hash','session_id',identities.get(a).token,identities.get(b).token,identities.get(b).session])assert(!serialized.includes(forbidden),forbidden);
    const otherTab=await snapshot(a,trip,uuid());assert.equal(metadataRecord(otherTab,id).groups.find(g=>g.group==='title').own_session,false);
    return {groupEditors:edits.length,legacySelectionPreserved:true};
  });
  await test('lease acquire/renew/release notify through opaque signals without touching financial rows or group revisions',async()=>{
    const id=await fixture(),before=await record(id);let rev=BigInt(await signal());
    const held=await call(a,leaseAction(a,id,'title'));assert(BigInt(await signal())>rev);rev=BigInt(await signal());
    await call(a,leaseAction(a,id,'title','renew',{epoch:held.epoch}));assert(BigInt(await signal())>rev);rev=BigInt(await signal());
    const fresh=await snapshot();assert.equal(metadataRecord(fresh,id).groups.find(g=>g.group==='title').held,true);
    await call(a,leaseAction(a,id,'title','release',{epoch:held.epoch}));assert(BigInt(await signal())>rev);
    assert.equal(metadataRecord(await snapshot(),id).groups.find(g=>g.group==='title').held,false);
    assert.deepEqual(await record(id),before);assert.equal(Number((await state(id,'title')).revision),0);
    return {financialRowUnchanged:true};
  });
  await test('expired and revoked ownership is hidden on refresh and stale release cannot disturb takeover',async()=>{
    const id=await fixture(),held=await call(a,leaseAction(a,id,'title'));
    await admin("update app_private.budget_metadata_groups set expires_at=clock_timestamp()-interval '1 second' where kind='budget' and resource_id=$1 and group_key='title'",[id]);
    let rec=metadataRecord(await snapshot(),id).groups.find(g=>g.group==='title');assert.equal(rec.held,false);assert.equal(rec.owner_id,null);assert.equal(rec.expires_at,null);
    const taken=await call(b,leaseAction(b,id,'title'));assert(taken.epoch>held.epoch);const revision=await signal();
    await call(a,leaseAction(a,id,'title','release',{epoch:held.epoch}));assert.equal(await signal(),revision);
    assert.equal(metadataRecord(await snapshot(),id).groups.find(g=>g.group==='title').owner_id,actorB);
    try{await admin("update trip_members set role='viewer' where trip_id=$1 and user_id=$2",[trip,actorB]);assert(BigInt(await signal())>BigInt(revision));
      rec=metadataRecord(await snapshot(),id).groups.find(g=>g.group==='title');assert.equal(rec.held,false);assert.equal(rec.owner_id,null);
      assert(!(await snapshot()).collaboration.entries.some(e=>e.resource_id===id&&e.group_key));
    }finally{await admin("update trip_members set role='editor' where trip_id=$1 and user_id=$2",[trip,actorB]);}
    return {expiredHidden:true,revokedHidden:true,staleReleaseIgnored:true};
  });
  await test('natural expiry produces no event and uses statement time even inside a long transaction',async()=>{
    const id=await fixture();await call(a,leaseAction(a,id,'title'));
    // Preserve PostgreSQL microseconds across the observer barrier. pg's Date
    // decoder truncates to milliseconds and can announce expiry too early.
    const expiry=(await admin("update app_private.budget_metadata_groups set expires_at=clock_timestamp()+interval '600 milliseconds' where kind='budget' and resource_id=$1 and group_key='title' returning expires_at::text",[id]))[0].expires_at;
    const rev=await signal();await a.query('begin');
    try{
      const first=await snapshot();assert.equal(metadataRecord(first,id).groups.find(g=>g.group==='title').held,true);
      assert(new Date(first.nextRefreshAt)<=new Date(expiry));
      await waitUntil(async()=>(await admin('select clock_timestamp()>$1::timestamptz expired',[expiry]))[0].expired,'natural server expiry');
      const second=await snapshot();assert.equal(metadataRecord(second,id).groups.find(g=>g.group==='title').held,false);
      assert(!second.collaboration.entries.some(e=>e.resource_id===id&&e.group_key));assert.equal(await signal(),rev);
    }finally{await a.query('rollback');}
    return {expiry:new Date(expiry).toISOString(),noExpiryWrite:true};
  });
  await test('one STABLE statement retains graph/group/signal snapshot across an overlapping committed patch',async()=>{
    const id=await fixture(),held=await call(b,leaseAction(b,id,'title'));
    await admin(`create function budget_test.snapshot_probe(trip uuid,session uuid,gate bigint) returns jsonb language plpgsql stable security invoker as $$
      declare first jsonb;begin first:=public.read_budget_metadata_snapshot(trip,session);perform pg_advisory_xact_lock(gate);
        return jsonb_build_object('before',first,'after',public.read_budget_metadata_snapshot(trip,session));end $$`);
    const readGate=++gate,writeGate=++gate;await admin('select pg_advisory_lock($1::bigint),pg_advisory_lock($2::bigint)',[readGate,writeGate]);
    const reading=transaction(a,()=>call(a,{text:'budget_test.snapshot_probe($1,$2,$3)',values:[trip,identities.get(a).session,readGate]}));
    let writing,proof,fresh;
    try{
      await waitUntil(async()=>{const rows=await activity();return rows.some(r=>r.pid===pidA&&r.state==='active'&&r.blocking_pids.includes(observerPid));},'snapshot reader gate');
      writing=transaction(b,()=>holdCall(b,patchAction(b,id,'title','Committed during read',{epoch:held.epoch}),writeGate));
      proof=await waitUntil(async()=>{const rows=await activity();return rows.length===2&&rows.every(r=>r.state==='active'&&r.blocking_pids.includes(observerPid))?rows:false;},'both reader and writer active');
      observations.push({name:'single-statement-snapshot-across-commit',proof});
      await admin('select pg_advisory_unlock($1::bigint)',[writeGate]);assert((await writing).ok);
      // An independent statement sees the commit while A is still blocked.
      fresh=await snapshot(b);assert.equal(metadataRecord(fresh,id).groups.find(g=>g.group==='title').value,'Committed during read');
    }finally{await admin('select pg_advisory_unlock($1::bigint),pg_advisory_unlock($2::bigint)',[readGate,writeGate]);}
    const outcome=await reading;assert(outcome.ok);assert.deepEqual(outcome.data.before,outcome.data.after);
    const before=outcome.data.before;
    assert.equal(before.budgetItems.find(r=>r.id===id).title,'Initial');assert.equal(metadataRecord(before,id).groups.find(g=>g.group==='title').revision,0);
    assert(fresh.collaborationRevision>before.collaborationRevision);return {overlap:true,oldRevision:before.collaborationRevision,newRevision:fresh.collaborationRevision};
  });
  await test('uncommitted patch and its signal remain invisible; injected failure rolls both back',async()=>{
    const id=await fixture(),held=await call(a,leaseAction(a,id,'title')),before=await snapshot(b),heldGate=++gate;
    await admin('select pg_advisory_lock($1::bigint)',[heldGate]);
    const writing=transaction(a,async()=>{await holdCall(a,patchAction(a,id,'title','Rollback notification',{epoch:held.epoch}),heldGate);await a.query('select 1/0');});
    let during;
    try{await waitUntil(async()=>{const rows=await activity();return rows.some(r=>r.pid===pidA&&r.state==='active'&&r.blocking_pids.includes(observerPid));},'rollback visibility writer gate');
      during=await snapshot(b);assert.deepEqual(during.budgetItems,before.budgetItems);assert.deepEqual(during.metadataRecords,before.metadataRecords);assert.equal(during.collaborationRevision,before.collaborationRevision);
      observations.push({name:'snapshot-during-uncommitted-patch',proof:await activity(),reader:'B completed while A active/uncommitted'});
    }finally{await admin('select pg_advisory_unlock($1::bigint)',[heldGate]);}
    assert.equal((await writing).code,'22012');const after=await snapshot(b);assert.deepEqual(after.metadataRecords,before.metadataRecords);assert.equal(after.collaborationRevision,before.collaborationRevision);
    return {overlap:true,uncommittedVisible:false,signalRolledBack:true};
  });
  await test('legacy metadata mutations and delete/recreate invalidate without emitting tombstone resources',async()=>{
    const id=await fixture();let rev=BigInt(await signal());
    await query(a,"update budget_items set title='Legacy canonical' where id=$1",[id]);assert(BigInt(await signal())>rev);
    assert.equal(metadataRecord(await snapshot(),id).groups.find(g=>g.group==='title').value,'Legacy canonical');
    const prior=metadataRecord(await snapshot(),id).groups.find(g=>g.group==='title').revision;
    rev=BigInt(await signal());await query(a,'delete from budget_items where id=$1',[id]);assert(BigInt(await signal())>rev);
    assert.equal(metadataRecord(await snapshot(),id),undefined);assert(!(await snapshot()).collaboration.entries.some(e=>e.resource_id===id));
    await admin("insert into budget_items(id,trip_id,title,category,amount,currency,exchange_rate,twd_amount,payer_id) values($1,$2,'Recreated','交通',900,'TWD',1,900,$3)",[id,trip,actorA]);
    assert(metadataRecord(await snapshot(),id).groups.find(g=>g.group==='title').revision>prior);
    return {tombstoneHidden:true,recreatedFenced:true};
  });
  await test('paused protocol is notified and remains readable with active ownership; linked records report unsupported',async()=>{
    const id=await fixture(),held=await call(a,leaseAction(a,id,'title'));const prior=BigInt(await signal());
    try{await admin('update app_private.budget_metadata_protocol set enabled=false');assert(BigInt(await signal())>prior);
      const snap=await snapshot();assert.equal(snap.metadataProtocol.enabled,false);assert.equal(metadataRecord(snap,id).groups.find(g=>g.group==='title').held,true);
    }finally{await admin('update app_private.budget_metadata_protocol set enabled=true');await call(a,leaseAction(a,id,'title','release',{epoch:held.epoch}));}
    const linked=await fixture();await admin("insert into actual_expenses(trip_id,title,amount,currency,exchange_rate,twd_amount,payer_id,budget_item_id) values($1,'Linked',900,'TWD',1,900,$2,$3)",[trip,actorA,linked]);
    assert.equal(metadataRecord(await snapshot(),linked).supported,false);return {pausedReadable:true,unsupportedExplicit:true};
  });
  await test('snapshot auth/RLS, publication and signal grants preserve private boundaries',async()=>{
    for(const actor of [viewer,pending,outsider]){await a.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
      assert.equal(Boolean(await snapshot()),actor===viewer);assert.equal(Boolean(await snapshot(a,secretTrip)),actor===outsider);
      if(actor===viewer){const denied=await transaction(a,()=>query(a,'update budget_collaboration_signals set revision=0 where trip_id=$1',[trip]));assert.equal(denied.code,'42501');}
    }
    await a.query("select set_config('request.jwt.claim.sub',$1,false)",[actorA]);assert.equal(await snapshot(a,secretTrip),null);
    const funcs=await admin("select p.prosecdef,p.provolatile,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') anon from pg_proc p where p.oid='public.read_budget_metadata_snapshot(uuid,uuid)'::regprocedure");
    assert.equal(funcs[0].prosecdef,false);assert.equal(funcs[0].provolatile,'s');assert.equal(funcs[0].anon,false);assert(funcs[0].proconfig.includes('search_path=""'));
    const tables=await admin("select schemaname,tablename from pg_publication_tables where pubname='supabase_realtime' and (tablename='budget_collaboration_signals' or tablename like 'budget_metadata_%')");
    assert.deepEqual(tables,[{schemaname:'public',tablename:'budget_collaboration_signals'}]);
    const columns=await admin("select column_name from information_schema.columns where table_schema='public' and table_name='budget_collaboration_signals' order by ordinal_position");assert.deepEqual(columns.map(c=>c.column_name),['trip_id','revision']);
    const anonymous=new Client({...config,user:'budget_anon'});try{await anonymous.connect();await anonymous.query('set role anon');
      await assert.rejects(()=>snapshot(anonymous,trip,uuid()),e=>e.code==='42501');
    }finally{await anonymous.end();}
    return {invokerStable:true,onlyOpaqueSignalPublished:true};
  });
  await test('trip deletion retains only its opaque signal and does not resurrect metadata or authorized reads',async()=>{
    const disposableTrip=uuid(),id=uuid();
    await admin("insert into trips(id,title,name,destination,start_date,end_date,owner_id) values($1,'Disposable','Disposable','Japan',current_date+10,current_date+15,$2)",[disposableTrip,actorA]);
    await admin("insert into trip_members(trip_id,user_id,role,status) values($1,$2,'owner','approved')",[disposableTrip,actorA]);
    await admin("insert into budget_items(id,trip_id,title,category,amount,currency,exchange_rate,twd_amount,payer_id) values($1,$2,'Delete scope','交通',90,'TWD',1,90,$3)",[id,disposableTrip,actorA]);
    assert(await snapshot(a,disposableTrip));const revision=await signal(disposableTrip);
    await admin('delete from trips where id=$1',[disposableTrip]);
    assert.equal(await signal(disposableTrip),revision);assert.equal(await snapshot(a,disposableTrip),null);
    assert.equal((await query(a,'select * from budget_collaboration_signals where trip_id=$1',[disposableTrip])).length,0);
    assert.equal((await admin('select * from app_private.budget_metadata_groups where trip_id=$1',[disposableTrip])).length,0);
    return {retainedOpaqueRevision:revision,metadataRemoved:true};
  });

  await test('B-2 JavaScript adapters/controllers use real named RPCs and independently commit title/note',async()=>{
    const id=await fixture(),heldGate=++gate,clients=[];
    await admin('select pg_advisory_lock($1::bigint)',[heldGate]);
    const create=client=>{
      const identity=identities.get(client);let first=client===a;
      const service=createBudgetMetadataService({auth:{getSession:async()=>({data:{session:{user:{id:identity.actor}}}})},
        rpc:async(name,params)=>{
          assert(['budget_metadata_group_lease','patch_budget_metadata_group'].includes(name));
          const keys=Object.keys(params),values=Object.values(params);
          let sql=`public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')})`;
          if(first&&params.p_action==='acquire'){first=false;values.push(heldGate);sql=`budget_test.hold_result(${sql},$${values.length}::bigint)`;}
          try{return {data:(await query(client,`select ${sql} data`,values))[0].data};}catch(error){return {error};}
        }});
      const model=createBudgetMetadataEditor({service,sessionId:identity.session,read:async()=>({ok:true,data:{
        ...await snapshot(client),metadataVerified:true,metadataReadStartedAt:Date.now()}})});
      model.configure(identity.actor,trip,true,true);clients.push(model);return model;
    };
    const ca=create(a),cb=create(b);await Promise.all([ca.refresh(),cb.refresh()]);
    const title=ca.get('budget',id,'title'),note=cb.get('budget',id,'note');
    const workA=ca.focus(title);let workB;
    try{
      await waitUntil(async()=>{const rows=await activity();return rows.some(r=>r.pid===pidA&&r.state==='active'&&r.blocking_pids.includes(observerPid));},'B-2 adapter A active');
      workB=cb.focus(note);
      const proof=await waitUntil(async()=>{const rows=await activity();return rows.some(r=>r.pid===pidB&&r.state==='active'&&r.blocking_pids.includes(pidA))?rows:false;},'B-2 adapter B actual trip wait');
      observations.push({name:'B-2-controller-real-RPC-admission',proof});
    }finally{await admin('select pg_advisory_unlock($1::bigint)',[heldGate]);}
    assert(await workA);assert(await workB);ca.input(title,'Adapter title');cb.input(note,'Adapter note');
    assert((await Promise.all([ca.save(title),cb.save(note)])).every(Boolean));
    const final=await record(id);assert.equal(final.title,'Adapter title');assert.equal(final.note,'Adapter note');assert.equal(Number(final.twd_amount),900);
    ca.input(title,'  Canonical title  ');cb.input(note,'   ');
    assert((await Promise.all([ca.save(title),cb.save(note)])).every(Boolean));
    assert.equal(ca.view(title).display,'Canonical title');assert.equal(cb.view(note).display,'');
    assert.equal((await record(id)).note,null);
    await Promise.all([ca.discard(title),cb.discard(note)]);await Promise.all(clients.map(c=>c.dispose()));
    return {overlap:true,transport:'actual PostgreSQL named RPCs; no HTTP mock',fields:['title','note'],financialPreserved:true};
  });
  const nativeModel=(client,options={})=>{
    const identity=identities.get(client),calls=[];
    const service=createBudgetMetadataService({auth:{getSession:async()=>({data:{session:{user:{id:identity.actor}}}})},rpc:async(name,params)=>{
      calls.push({name,params});const keys=Object.keys(params),values=Object.values(params);
      let sql=`public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')})`;
      if(name==='patch_budget_metadata_group'&&options.patchGate){values.push(options.patchGate);options.patchGate=null;sql=`budget_test.hold_result(${sql},$${values.length}::bigint)`;}
      try {const data=(await query(client,`select ${sql} data`,values))[0].data;
        if(name==='patch_budget_metadata_group'&&options.loseAck){options.loseAck=false;return {error:{message:'simulated lost transport acknowledgement AFTER actual DB commit'}};}
        return {data};}catch(error){return {error};}
    }});
    const model=createBudgetMetadataEditor({service,sessionId:options.session||identity.session,storage:options.storage,debounceMs:40,
      read:async()=>options.failRead?{ok:false}:{ok:true,data:{...await snapshot(client,trip,options.session||identity.session),metadataVerified:true,metadataReadStartedAt:Date.now()}}});
    model.configure(identity.actor,trip,true,true);return {model,calls,options};
  };
  await test('B-3 debounced queued typing overlaps another real writer without losing either group',async()=>{
    const id=await fixture(),heldGate=++gate,fa=nativeModel(a,{patchGate:heldGate}),fb=nativeModel(b);
    await Promise.all([fa.model.refresh(),fb.model.refresh()]);const title=fa.model.get('budget',id,'title'),note=fb.model.get('budget',id,'note');
    assert(await fa.model.focus(title));assert(await fb.model.focus(note));await admin('select pg_advisory_lock($1::bigint)',[heldGate]);
    try {
      fa.model.input(title,'First');
      await waitUntil(async()=>{const rows=await activity();return rows.find(r=>r.pid===pidA)?.blocking_pids.includes(observerPid);},'B-3 actual autosave holds transaction');
      fa.model.input(title,'Queued middle');fa.model.input(title,'Queued latest');fb.model.input(note,'Parallel note');
      const proof=await waitUntil(async()=>{const rows=await activity();return rows.find(r=>r.pid===pidB)?.blocking_pids.includes(pidA)?rows:false;},'B-3 second autosave actively waits for first');
      observations.push({name:'B-3-debounced-controller-patches',proof});
      assert.equal(fa.model.view(title).display,'Queued latest');assert(fa.model.view(title).acceptsIntent);
      assert.equal(fa.calls.filter(c=>c.name==='patch_budget_metadata_group').length,1);
    }finally{await admin('select pg_advisory_unlock($1::bigint)',[heldGate]);}
    await waitUntil(async()=>!title.saveWork&&!note.saveWork&&!fa.model.view(title).dirty&&!fb.model.view(note).dirty,'B-3 final queued save');
    const final=await record(id);assert.equal(final.title,'Queued latest');assert.equal(final.note,'Parallel note');assert.equal(Number(final.twd_amount),900);
    const patches=fa.calls.filter(c=>c.name==='patch_budget_metadata_group');assert.deepEqual(patches.map(c=>c.params.p_patch.title),['First','Queued latest']);
    assert.equal(Number((await state(id,'title')).revision),2);assert.equal(Number((await state(id,'note')).revision),1);
    await Promise.all([fa.model.dispose(),fb.model.dispose()]);return {overlap:true,autosave:true,queuedVersions:2,financialPreserved:true};
  });
  await test('B-3 confirmed patch survives failed snapshot and unknown ack replays after document reload without capability',async()=>{
    const id=await fixture(),values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
    const f=nativeModel(a,{storage});await f.model.refresh();const title=f.model.get('budget',id,'title');assert(await f.model.focus(title));
    f.model.input(title,'Confirmed canonical');f.options.failRead=true;assert(await f.model.save(title));assert.equal(title.value,'Confirmed canonical');assert(title.syncPending);
    assert.equal(f.calls.filter(c=>c.name==='patch_budget_metadata_group').length,1);f.options.failRead=false;await f.model.refresh();assert(!title.syncPending);
    assert(await f.model.retry(title));f.options.loseAck=true;f.model.input(title,'Committed lost ack');assert.equal(await f.model.save(title),false);
    const pending=JSON.parse([...values.values()][0]).pending;assert(pending.id);assert(!JSON.stringify([...values.values()]).includes('p_token'));
    await f.model.dispose();
    const restored=nativeModel(a,{storage,session:uuid()});await restored.model.refresh();const g=restored.model.get('budget',id,'title');
    assert(!restored.model.view(g).writable);assert.equal(g.request.p_token,null);assert(await restored.model.retry(g));
    assert.equal(g.value,'Committed lost ack');assert.equal(Number((await state(id,'title')).revision),2);
    const replay=restored.calls.find(c=>c.name==='patch_budget_metadata_group').params;assert.equal(replay.p_request_id,pending.id);assert.equal(replay.p_token,null);assert.equal(replay.p_epoch,null);
    assert.equal((await admin('select count(*)::int n from app_private.budget_metadata_requests where request_id=$1',[pending.id]))[0].n,1);
    await restored.model.dispose();return {native:true,confirmedReadFailure:true,reloadReplayWithoutAuthority:true,commits:2};
  });
  await test('B-3 dirty flush and exact group release admit a legacy whole-record lease using fresh canonical',async()=>{
    const id=await fixture(),f=nativeModel(a);await f.model.refresh();const title=f.model.get('budget',id,'title');assert(await f.model.focus(title));
    f.model.input(title,'Before full editor');assert(await f.model.prepare('budget',id));assert(await f.model.close('budget',id));
    const row=await record(id);assert.equal(row.title,'Before full editor');const held=await call(a,legacyAction(a,id,row.updated_at));assert(held.granted);
    const identity=identities.get(a);await query(a,"select public.budget_edit_lease('budget',$1,$2,$3,'release',null)",[id,identity.session,identity.token]);
    const patch=f.calls.find(c=>c.name==='patch_budget_metadata_group').params,release=f.calls.find(c=>c.params.p_action==='release').params;
    assert.equal(release.p_token,patch.p_token);assert.equal(release.p_epoch,patch.p_epoch);await f.model.dispose();return {native:true,dirtyHandoff:true,exactRelease:true};
  });
  await test('same group exclusive across two simultaneously active user sessions',async()=>{
    const id=await fixture();const result=await overlap('same-group',leaseAction(a,id,'title'),leaseAction(b,id,'title'));
    assert(result.outcomes[0].ok&&result.outcomes[0].data.granted);assert(result.outcomes[1].ok&&!result.outcomes[1].data.granted);
    assert.equal(result.outcomes[1].data.reason,'group_locked');assert.equal((await state(id,'title')).user_id,actorA);
    return {outcomes:result.outcomes,overlap:true};
  });
  await test('same account different tab sessions cannot share a group capability',async()=>{
    const id=await fixture();await b.query("select set_config('request.jwt.claim.sub',$1,false)",[actorA]);
    try{const result=await overlap('same-account-tabs',leaseAction(a,id,'title'),leaseAction(b,id,'title'));
      assert(result.outcomes[0].data.granted);assert.equal(result.outcomes[1].data.granted,false);return {outcomes:result.outcomes,overlap:true};
    }finally{await b.query("select set_config('request.jwt.claim.sub',$1,false)",[actorB]);}
  });
  await test('different groups acquire in overlapping transactions and both remain held',async()=>{
    const id=await fixture();const result=await overlap('different-groups',leaseAction(a,id,'title'),leaseAction(b,id,'note'));
    assert(result.outcomes.every(r=>r.ok&&r.data.granted));assert.equal((await state(id,'title')).user_id,actorA);assert.equal((await state(id,'note')).user_id,actorB);
    return {outcomes:result.outcomes,overlap:true,serialization:'short trip advisory transactions; long-lived group leases coexist'};
  });
  await test('overlapping partial patches preserve both fields and hide uncommitted data',async()=>{
    const id=await fixture(),before=await record(id);const la=await call(a,leaseAction(a,id,'title')),lb=await call(b,leaseAction(b,id,'note'));
    const result=await overlap('partial-patches',patchAction(a,id,'title','A title',{epoch:la.epoch}),patchAction(b,id,'note','B note',{epoch:lb.epoch}),{
      inspect:async()=>{assert.deepEqual(await record(id),before);}
    });
    assert(result.outcomes.every(r=>r.ok));const after=await record(id);assert.equal(after.title,'A title');assert.equal(after.note,'B note');
    for(const key of Object.keys(before).filter(k=>!['title','note','updated_at'].includes(k)))assert.deepEqual(after[key],before[key]);
    assert.equal(Number((await state(id,'title')).revision),1);assert.equal(Number((await state(id,'note')).revision),1);
    return {overlap:true,outcomes:result.outcomes,uncommittedVisible:false};
  });
  await test('standalone Actual partial patches overlap without changing known debit or provenance',async()=>{
    const id=uuid();await admin("insert into actual_expenses(id,trip_id,title,note,amount,currency,exchange_rate,twd_amount,payer_id,twd_amount_source,actual_twd_amount) values($1,$2,'Actual initial','Actual note',300,'JPY',0.2,71,$3,'actual',71)",[id,trip,actorA]);
    const before=await record(id,'actual'),la=await call(a,leaseAction(a,id,'title','acquire',{kind:'actual'})),lb=await call(b,leaseAction(b,id,'note','acquire',{kind:'actual'}));
    const result=await overlap('actual-partial-patches',patchAction(a,id,'title','Actual A',{kind:'actual',epoch:la.epoch}),patchAction(b,id,'note','Actual B',{kind:'actual',epoch:lb.epoch}));
    assert(result.outcomes.every(r=>r.ok));const after=await record(id,'actual');assert.equal(after.title,'Actual A');assert.equal(after.note,'Actual B');
    for(const key of Object.keys(before).filter(k=>!['title','note','updated_at'].includes(k)))assert.deepEqual(after[key],before[key]);
    return {overlap:true,outcomes:result.outcomes,knownDebitPreserved:true};
  });
  await test('new group wins overlapping legacy whole-record admission',async()=>{
    const id=await fixture(),before=await record(id);const result=await overlap('group-vs-legacy',leaseAction(a,id,'title'),legacyAction(b,id,before.updated_at));
    assert(result.outcomes[0].data.granted);assert.equal(result.outcomes[1].ok,false);assert.equal(result.outcomes[1].code,'55P03');return {overlap:true,outcomes:result.outcomes};
  });
  await test('legacy whole-record lease wins overlapping group admission',async()=>{
    const id=await fixture(),before=await record(id);const result=await overlap('legacy-vs-group',legacyAction(a,id,before.updated_at),leaseAction(b,id,'note'));
    assert(result.outcomes[0].data.granted);assert(result.outcomes[1].ok);assert.equal(result.outcomes[1].data.reason,'legacy_locked');return {overlap:true,outcomes:result.outcomes};
  });
  await test('expiry is rechecked after real advisory-lock waiting',async()=>{
    const id=await fixture(),held=await call(b,leaseAction(b,id,'title'));
    await admin("update app_private.budget_metadata_groups set expires_at=clock_timestamp()+interval '1 second' where resource_id=$1 and group_key='title'",[id]);
    let validityWhileWaiting;
    const result=await overlap('expiry-after-wait',leaseAction(a,id,'note'),patchAction(b,id,'title','Expired write',{epoch:held.epoch}),{
      inspect:async()=>{
        validityWhileWaiting=(await admin('select expires_at,clock_timestamp() observed_at,expires_at>clock_timestamp() still_valid from app_private.budget_metadata_groups where resource_id=$1 and group_key=\'title\'',[id]))[0];
        assert.equal(validityWhileWaiting.still_valid,true,'Lease must still be valid AFTER actual B lock waiting is observed');
        await waitUntil(async()=>(await admin('select expires_at<=clock_timestamp() expired from app_private.budget_metadata_groups where resource_id=$1 and group_key=\'title\'',[id]))[0].expired,'server expiry');
      }
    });
    assert.equal(result.outcomes[1].ok,false);assert.equal(result.outcomes[1].code,'55P03');assert.equal((await record(id)).title,'Initial');return {overlap:true,validityWhileWaiting,outcomes:result.outcomes};
  });
  await test('late old release overlaps takeover without clearing the new epoch',async()=>{
    const id=await fixture(),old=await call(b,leaseAction(b,id,'title'));
    await admin("update app_private.budget_metadata_groups set expires_at=clock_timestamp()-interval '1 second' where resource_id=$1 and group_key='title'",[id]);
    const result=await overlap('late-release',leaseAction(a,id,'title'),leaseAction(b,id,'title','release',{epoch:old.epoch}));
    assert(result.outcomes.every(r=>r.ok));const final=await state(id,'title');assert.equal(final.user_id,actorA);assert(Number(final.lease_epoch)>Number(old.epoch));return {overlap:true,outcomes:result.outcomes};
  });
  await test('failed transaction rolls back value/revision/request while overlapping another writer',async()=>{
    const id=await fixture(),la=await call(a,leaseAction(a,id,'title')),lb=await call(b,leaseAction(b,id,'note')),request=uuid();
    const heldGate=++gate;await admin('select pg_advisory_lock($1::bigint)',[heldGate]);
    const workA=transaction(a,async()=>{await holdCall(a,patchAction(a,id,'title','Must rollback',{epoch:la.epoch,request}),heldGate);await a.query("select 1/0");});
    let workB,proof;
    try{
      await waitUntil(async()=>(await activity()).some(r=>r.pid===pidA&&r.blocking_pids.includes(observerPid)),'rollback A gate');
      workB=transaction(b,()=>call(b,patchAction(b,id,'note','B survived',{epoch:lb.epoch})));
      proof=await waitUntil(async()=>{const rows=await activity();return rows.find(r=>r.pid===pidB)?.blocking_pids.includes(pidA)&&rows.every(r=>r.state==='active')?rows:false;},'rollback overlap');
      observations.push({name:'rollback',proof});
    }finally{await admin('select pg_advisory_unlock($1::bigint)',[heldGate]);}
    const outcomes=await Promise.all([workA,workB]);assert.equal(outcomes[0].code,'22012');assert(outcomes[1].ok);
    assert.equal((await record(id)).title,'Initial');assert.equal((await record(id)).note,'B survived');assert.equal(Number((await state(id,'title')).revision),0);
    assert.equal((await admin('select count(*)::int n from app_private.budget_metadata_requests where request_id=$1',[request]))[0].n,0);
    assert.equal((await admin('select count(*)::int n from app_private.budget_metadata_effects'))[0].n,0);return {overlap:true,outcomes};
  });
  await test('deferred unfinished-effect commit failure rolls back before an overlapping writer succeeds',async()=>{
    const id=await fixture(),la=await call(a,leaseAction(a,id,'title')),lb=await call(b,leaseAction(b,id,'note')),request=uuid();
    const prepared=patchAction(a,id,'title','Never committed',{epoch:la.epoch,request});prepared.text=prepared.text.replace('public.patch_budget_metadata_group','app_private.prepare_budget_metadata_patch');
    const result=await overlap('deferred-rollback',prepared,patchAction(b,id,'note','After failed commit',{epoch:lb.epoch}));
    assert.equal(result.outcomes[0].code,'40001');assert.equal(result.outcomes[0].message,'unfinished_group_patch');assert(result.outcomes[1].ok);
    assert.equal((await record(id)).title,'Initial');assert.equal(Number((await state(id,'title')).revision),0);assert.equal((await record(id)).note,'After failed commit');
    assert.equal((await admin('select count(*)::int n from app_private.budget_metadata_effects'))[0].n,0);
    assert.equal((await admin('select count(*)::int n from app_private.budget_metadata_requests where request_id=$1',[request]))[0].n,0);
    return {overlap:true,outcomes:result.outcomes};
  });
  await test('concurrent duplicate request commits once and returns the original result',async()=>{
    const id=await fixture(),held=await call(a,leaseAction(a,id,'title')),request=uuid();
    await b.query("select set_config('request.jwt.claim.sub',$1,false)",[actorA]);
    const action=patchAction(a,id,'title','Exactly once',{epoch:held.epoch,request});
    try{const result=await overlap('duplicate-request',action,action);assert(result.outcomes.every(r=>r.ok));assert.deepEqual(result.outcomes[0].data,result.outcomes[1].data);
      assert.equal(Number((await state(id,'title')).revision),1);return {overlap:true,outcomes:result.outcomes};
    }finally{await b.query("select set_config('request.jwt.claim.sub',$1,false)",[actorB]);}
  });
  for(const kind of ['budget','actual'])await test(`${kind}: row-first legacy transaction versus group patch fails safely without deadlock`,async()=>{
    const id=kind==='budget'?await fixture():uuid(),table=kind==='budget'?'budget_items':'actual_expenses';
    if(kind==='actual')await admin("insert into actual_expenses(id,trip_id,title,amount,twd_amount,currency,exchange_rate,payer_id) values($1,$2,'Initial',300,300,'TWD',1,$3)",[id,trip,actorA]);
    const held=await call(b,leaseAction(b,id,'title','acquire',{kind})),heldGate=++gate,startGate=++gate,request=uuid();
    await admin('select pg_advisory_lock($1::bigint)',[heldGate]);
    await admin('select pg_advisory_lock($1::bigint)',[startGate]);
    await a.query('begin');await query(a,`select id from ${table} where id=$1 for update`,[id]);
    const gateA=query(a,'select budget_test.hold_result(\'{}\'::jsonb,$1) data',[heldGate]);
    await waitUntil(async()=>(await activity()).some(r=>r.pid===pidA&&r.blocking_pids.includes(observerPid)),'row-first A gate');
    let outcomeB,proof;
    const action=patchAction(b,id,'title','After retry',{kind,epoch:held.epoch,request});
    const workB=transaction(b,async()=>{
      return (await query(b,`select case when budget_test.await_gate($${action.values.length+1}::bigint) then ${action.text} end data`,[...action.values,startGate]))[0].data;
    }).then(r=>(outcomeB=r));
    try{
      const simultaneous=await waitUntil(async()=>{
        const rows=await activity();return rows.length===2&&rows.every(r=>r.state==='active'&&r.blocking_pids.includes(observerPid))?rows:false;
      },'row-first simultaneous server query barrier');
      await admin('select pg_advisory_unlock($1::bigint)',[startGate]);
      proof=await waitUntil(async()=>{
        const rows=await activity();
        if(outcomeB){assert(rows.find(r=>r.pid===pidA)?.state==='active');return {simultaneous,boundedRejection:outcomeB,activeAWhenRejected:rows};}
        const br=rows.find(r=>r.pid===pidB);return br?.blocking_pids.includes(pidA)?{simultaneous,unsafeRowWait:true,activities:rows}:false;
      },'row-order observation');
      observations.push({name:`row-first-order-${kind}`,proof});
    }finally{await admin('select pg_advisory_unlock($1::bigint)',[heldGate]);}
    await gateA;
    let outcomeA;
    try{await query(a,`update ${table} set note='Legacy attempted' where id=$1`,[id]);await a.query('commit');outcomeA={ok:true};}
    catch(error){await a.query('rollback');outcomeA={ok:false,code:error.code,message:error.message};}
    await workB;
    assert.notEqual(outcomeA.code,'40P01',JSON.stringify({outcomeA,outcomeB}));assert.notEqual(outcomeB.code,'40P01',JSON.stringify({outcomeA,outcomeB}));
    assert.equal(outcomeB.code,'55P03','Prototype must NOWAIT-reject instead of holding trip lock while waiting on a legacy parent row');
    assert.equal(outcomeA.code,'55P03');assert.equal((await record(id,kind)).title,'Initial');
    assert.equal((await admin('select count(*)::int n from app_private.budget_metadata_requests where request_id=$1',[request]))[0].n,0);
    const retried=await call(b,action);assert.equal(retried.revision,1);assert.deepEqual(await call(b,action),retried);
    return {overlap:true,outcomes:[outcomeA,outcomeB],retry:'passed',proof};
  });
  await test('bounded lock timeout aborts without a partial patch and can retry',async()=>{
    const id=await fixture(),held=await call(b,leaseAction(b,id,'note')),request=uuid();const action=patchAction(b,id,'note','Retry note',{epoch:held.epoch,request});
    await a.query('begin');await query(a,'select pg_advisory_xact_lock(hashtextextended($1::text,0))',[trip]);
    const heldGate=++gate;await admin('select pg_advisory_lock($1::bigint)',[heldGate]);const gateA=query(a,'select budget_test.hold_result(\'{}\'::jsonb,$1)',[heldGate]);
    await b.query("set lock_timeout='700ms'");const workB=transaction(b,()=>call(b,action));
    await waitUntil(async()=>{const rows=await activity();return rows.find(r=>r.pid===pidB)?.blocking_pids.includes(pidA)&&rows.every(r=>r.state==='active')?rows:false;},'timeout overlap').then(proof=>observations.push({name:'bounded-timeout',proof}));
    const failed=await workB;assert.equal(failed.code,'55P03');await admin('select pg_advisory_unlock($1::bigint)',[heldGate]);await gateA;await a.query('rollback');
    assert.equal((await record(id)).note,'Initial note');await b.query("set lock_timeout='6s'");const retry=await call(b,action);assert.equal(retry.revision,1);assert.deepEqual(await call(b,action),retry);
    return {overlap:true,outcome:failed,retry:'passed'};
  });
  await test('membership revocation committed during lock wait prevents stale-authority writes',async()=>{
    const id=await fixture(),held=await call(b,leaseAction(b,id,'title'));
    try{
      const result=await overlap('revocation-after-wait',{text:'budget_test.revoke_member($1,$2)',values:[trip,actorB]},patchAction(b,id,'title','Revoked write',{epoch:held.epoch}));
      assert(result.outcomes[0].ok);assert.equal(result.outcomes[1].code,'42501');assert.equal((await record(id)).title,'Initial');return {overlap:true,outcomes:result.outcomes};
    }finally{await admin("update trip_members set status='approved' where trip_id=$1 and user_id=$2",[trip,actorB]);}
  });
  await test('real-server RLS and grants retain viewer/pending/outsider/anon and private-table boundaries',async()=>{
    const id=await fixture();
    for(const actor of [viewer,pending,outsider]){
      await a.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
      const read=(await query(a,'select read_budget_metadata_groups($1,\'budget\',$2,$3) data',[trip,id,identities.get(a).session]))[0].data;
      assert.equal(Boolean(read),actor===viewer);
      const failed=await transaction(a,()=>call(a,leaseAction(a,id,'title')));assert.equal(failed.code,'42501');
    }
    await a.query("select set_config('request.jwt.claim.sub',$1,false)",[actorA]);
    for(const table of ['protocol','groups','requests','effects']){const failed=await transaction(a,()=>query(a,`select * from app_private.budget_metadata_${table}`));assert.equal(failed.code,'42501');}
    const anonymous=new Client({...config,user:'budget_anon',application_name:'metadata-test-anon'});
    try{await anonymous.connect();await anonymous.query('set role anon');const denied=await transaction(anonymous,()=>call(anonymous,leaseAction(a,id,'title')));assert.equal(denied.code,'42501');}
    finally{await anonymous.end();}
    return {checks:'viewer read-only, pending/outsider/anon denied, four private tables denied'};
  });
  const undoQA=await metadataUndoCases({test,admin,query,a,b,identities,actorA,actorB,viewer,pending,outsider,trip,secretTrip,fixture,record,call,leaseAction,patchAction});
  await test('Undo: two active same-tab requests for one target have one pop and one safe conflict',async()=>{
    const f=await undoQA.setup(),saved=await undoQA.write(f,'One'),identityA=identities.get(a),identityB=identities.get(b);
    await query(b,"select set_config('request.jwt.claim.sub',$1,false)",[actorA]);
    try{const options={session:identityA.session,token:identityA.token};
      const result=await overlap('undo-same-target',undoQA.undoAction(a,saved.operation,f.lease),undoQA.undoAction(b,saved.operation,f.lease,options));
      assert(result.outcomes[0].ok);assert.equal(result.outcomes[1].code,'40001');assert.equal((await undoQA.read()).count,0);
      assert.equal((await record(f.id)).title,'Initial');assert.equal(Number((await state(f.id,'title')).revision),2);await undoQA.release(f);
      return {overlap:true,outcomes:result.outcomes,pops:1};
    }finally{await query(b,"select set_config('request.jwt.claim.sub',$1,false)",[identityB.actor]);}
  });
  await test('Undo: overlapping identical request replays original inverse and cannot pop a second operation',async()=>{
    const f=await undoQA.setup();await undoQA.write(f,'One');const saved=await undoQA.write(f,'Two'),request=uuid(),identity=identities.get(a);
    await query(b,"select set_config('request.jwt.claim.sub',$1,false)",[actorA]);
    try{const result=await overlap('undo-duplicate-request',undoQA.undoAction(a,saved.operation,f.lease,{request}),undoQA.undoAction(b,saved.operation,f.lease,{request,session:identity.session,token:identity.token}));
      assert(result.outcomes.every(r=>r.ok));assert.deepEqual(result.outcomes[0].data,result.outcomes[1].data);assert.equal((await undoQA.read()).count,1);
      assert.equal((await record(f.id)).title,'One');assert.equal(Number((await state(f.id,'title')).revision),3);await undoQA.release(f);
      return {overlap:true,outcomes:result.outcomes,pops:1,replay:true};
    }finally{await query(b,"select set_config('request.jwt.claim.sub',$1,false)",[actorB]);}
  });
  await test('Undo: different actors inversely patch title and note in genuinely overlapping transactions',async()=>{
    const f=await undoQA.setup(),title=await undoQA.write(f,'A title'),noteLease=await call(b,leaseAction(b,f.id,'note')),noteOp=uuid();
    await call(b,patchAction(b,f.id,'note','B note',{epoch:noteLease.epoch,request:noteOp}));
    const result=await overlap('undo-independent-groups',undoQA.undoAction(a,title.operation,f.lease),undoQA.undoAction(b,noteOp,noteLease),{
      inspect:async()=>{const visible=await record(f.id);assert.equal(visible.title,'A title');assert.equal(visible.note,'B note');}});
    assert(result.outcomes.every(r=>r.ok));const final=await record(f.id);assert.equal(final.title,'Initial');assert.equal(final.note,'Initial note');assert.equal(Number(final.twd_amount),900);
    await undoQA.release(f);await call(b,leaseAction(b,f.id,'note','release',{epoch:noteLease.epoch}));return {overlap:true,outcomes:result.outcomes,financialPreserved:true};
  });
  await test('Undo: rollback after inverse leaves stack and original result while another writer is actually waiting',async()=>{
    const f=await undoQA.setup(),saved=await undoQA.write(f,'A title'),noteLease=await call(b,leaseAction(b,f.id,'note')),request=uuid();
    const before=await undoQA.read(),heldGate=++gate;await admin('select pg_advisory_lock($1::bigint)',[heldGate]);
    await a.query('begin');await call(a,undoQA.undoAction(a,saved.operation,f.lease,{request}));
    const gateA=query(a,"select budget_test.hold_result('{}'::jsonb,$1)",[heldGate]);let workB,proof;
    try{await waitUntil(async()=>{const rows=await activity();return rows.find(r=>r.pid===pidA)?.blocking_pids.includes(observerPid);},'undo rollback A barrier');
      workB=transaction(b,()=>call(b,patchAction(b,f.id,'note','B survived',{epoch:noteLease.epoch})));
      proof=await waitUntil(async()=>{const rows=await activity();return rows.find(r=>r.pid===pidB)?.blocking_pids.includes(pidA)?rows:false;},'undo rollback B actual wait');
      observations.push({name:'undo-inverse-rollback',proof});assert.equal((await record(f.id)).title,'A title');
    }finally{await admin('select pg_advisory_unlock($1::bigint)',[heldGate]);await gateA;await assert.rejects(()=>query(a,'select 1/0'),e=>e.code==='22012');await a.query('rollback');}
    assert((await workB).ok);assert.deepEqual(await undoQA.read(),before);assert.equal((await record(f.id)).title,'A title');assert.equal((await record(f.id)).note,'B survived');
    assert.equal((await admin('select count(*)::int n from app_private.budget_metadata_requests where request_id=$1',[request]))[0].n,0);
    await undoQA.release(f);await call(b,leaseAction(b,f.id,'note','release',{epoch:noteLease.epoch}));return {overlap:true,rolledBack:true};
  });
  await test('Undo: membership revocation committed during lock wait rejects a formerly valid inverse',async()=>{
    const id=await fixture(),held=await call(b,leaseAction(b,id,'title')),op=uuid();await call(b,patchAction(b,id,'title','B title',{epoch:held.epoch,request:op}));
    try{const result=await overlap('undo-revocation-after-wait',{text:'budget_test.revoke_member($1,$2)',values:[trip,actorB]},undoQA.undoAction(b,op,held));
      assert(result.outcomes[0].ok);assert.equal(result.outcomes[1].code,'42501');assert.equal((await record(id)).title,'B title');return {overlap:true,outcomes:result.outcomes};
    }finally{await admin("update trip_members set status='approved' where trip_id=$1 and user_id=$2",[trip,actorB]);await call(b,leaseAction(b,id,'title','release',{epoch:held.epoch}));}
  });
  await test('Undo: parent row-first legacy writer safely NOWAIT-rejects inverse instead of deadlocking',async()=>{
    const f=await undoQA.setup(),saved=await undoQA.write(f,'A title'),heldGate=++gate;
    await admin('select pg_advisory_lock($1::bigint)',[heldGate]);await b.query('begin');await query(b,'select id from budget_items where id=$1 for update',[f.id]);
    const gateB=query(b,"select budget_test.hold_result('{}'::jsonb,$1)",[heldGate]);
    let proof;try{
      await waitUntil(async()=>{const rows=await activity();return rows.find(r=>r.pid===pidB)?.blocking_pids.includes(observerPid);},'undo row-first B gate');
      const outcome=await transaction(a,()=>call(a,undoQA.undoAction(a,saved.operation,f.lease)));assert.equal(outcome.code,'55P03');
      proof=await activity();observations.push({name:'undo-row-first-nowait',proof,outcome});assert.equal((await record(f.id)).title,'A title');assert.equal((await undoQA.read()).count,1);
    }finally{await admin('select pg_advisory_unlock($1::bigint)',[heldGate]);await gateB;await b.query('rollback');}
    await undoQA.undo(a,saved.operation,f.lease);await undoQA.release(f);return {overlap:true,nowait:true,proof};
  });
  await test('Undo: membership row-first revocation cannot deadlock a waiting metadata inverse',async()=>{
    const f=await undoQA.setup(),saved=await undoQA.write(f,'A title'),heldGate=++gate;
    await admin(`create function budget_test.hold_member_revocation(trip uuid,actor uuid,gate bigint) returns jsonb
      language plpgsql security definer set search_path='' as $$begin
      update public.trip_members set status='pending' where trip_id=trip and user_id=actor;
      perform pg_advisory_xact_lock(gate);return '{}'::jsonb;end$$`);
    await admin('select pg_advisory_lock($1::bigint)',[heldGate]);await b.query('begin');
    const gateB=query(b,'select budget_test.hold_member_revocation($1,$2,$3)',[trip,actorA,heldGate]);
    try{await waitUntil(async()=>{const rows=await activity();return rows.find(r=>r.pid===pidB)?.blocking_pids.includes(observerPid);},'undo membership row-first B gate');
      const outcome=await transaction(a,()=>call(a,undoQA.undoAction(a,saved.operation,f.lease)));assert.equal(outcome.code,'55P03');
      observations.push({name:'undo-member-row-first-nowait',proof:await activity(),outcome});
    }finally{await admin('select pg_advisory_unlock($1::bigint)',[heldGate]);await gateB;await b.query('rollback');await admin('drop function budget_test.hold_member_revocation(uuid,uuid,bigint)');}
    await undoQA.undo(a,saved.operation,f.lease);await undoQA.release(f);return {overlap:true,nowait:true};
  });
  await metadataChoiceCases({test,admin,query,a,b,actorA,actorB,viewer,pending,outsider,trip,secretTrip,fixture,record,call,leaseAction,patchAction,overlap,identities,legacyAction});
  await test('links child row-first holder is observed during safe NOWAIT rejection',async()=>{
    const id=await fixture(),item=uuid();await admin("insert into itinerary_items(id,trip_id,title,type,date,day_index,sort_order) values($1,$2,'Locked link','attraction',current_date+10,0,0)",[item,trip]);
    await admin('insert into itinerary_budget_items(budget_item_id,itinerary_item_id) values($1,$2)',[id,item]);
    const l=await call(a,leaseAction(a,id,'links','acquire',{base:1})),heldGate=++gate;await admin('select pg_advisory_lock($1::bigint)',[heldGate]);await b.query('begin');await query(b,'select 1 from itinerary_budget_items where budget_item_id=$1 for update',[id]);
    const work=query(b,'select budget_test.hold_result(\'{}\'::jsonb,$1::bigint)',[heldGate]);
    try{await waitUntil(async()=>{const rows=await activity();return rows.find(r=>r.pid===pidB)?.blocking_pids.includes(observerPid);},'choice child lock held');
      const outcome=await transaction(a,()=>call(a,patchAction(a,id,'links',[],{base:1,epoch:l.epoch})));assert.equal(outcome.code,'55P03');observations.push({name:'choice-links-child-row-nowait',proof:await activity(),outcome});
    }finally{await admin('select pg_advisory_unlock($1::bigint)',[heldGate]);await work;await b.query('rollback');await call(a,leaseAction(a,id,'links','release',{epoch:l.epoch}));}return {overlap:true,nowait:true};
  });
  await pricingGroupCases({test,admin,query,a,b,actorA,actorB,viewer,pending,outsider,trip,secretTrip,fixture,record,call,leaseAction,patchAction,overlap,identities,undoQA,transaction,activity,waitUntil,pidA,pidB,observerPid,observations});
  await test('used Pricing protocol refuses dormant reverse without losing committed financial rows',async()=>{
    const before=await admin('select id,amount,twd_amount from budget_items order by id');
    assert((await admin("select count(*)::int n from app_private.budget_metadata_requests where result->>'group'='pricing'"))[0].n>0);
    await admin('update app_private.budget_metadata_protocol set enabled=false;update app_private.budget_metadata_groups set expires_at=null');
    const source=await fs.readFile(new URL('../docs/qa/2026-10-29-budget-pricing-groups-rollback.sql',import.meta.url),'utf8');
    await assert.rejects(()=>control.query(source),/Pricing used or active/);await control.query('rollback');assert.deepEqual(await admin('select id,amount,twd_amount from budget_items order by id'),before);
    await admin('update app_private.budget_metadata_protocol set enabled=true');
  });
  await test('Pricing private generations have RLS no client grants no publication and narrow invoker public patch',async()=>{
    const rows=await admin("select c.relrowsecurity,has_table_privilege('authenticated',c.oid,'select,insert,update,delete') client from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app_private' and c.relname='budget_pricing_trip_versions'");assert.equal(rows[0].relrowsecurity,true);assert.equal(rows[0].client,false);
    assert.equal((await admin("select count(*)::int n from pg_publication_tables where schemaname='app_private' and tablename='budget_pricing_trip_versions'"))[0].n,0);
    assert.equal((await admin("select prosecdef from pg_proc where oid='public.patch_budget_pricing_group(uuid,text,uuid,text,bigint,uuid,uuid,bigint,jsonb,uuid)'::regprocedure"))[0].prosecdef,false);
  });
  await test('real pricing controller validates v3 financial snapshot and commits only atomic pricing RPC intent',async()=>{
    const id=await fixture(),identity=identities.get(a),calls=[];
    const service={authorized:async actor=>actor===identity.actor,
      lease:async args=>{try{return {data:await call(a,leaseAction(a,args.p_id,args.p_group,args.p_action,{kind:args.p_kind,base:args.p_base_revision,epoch:args.p_epoch,session:args.p_session_id,token:args.p_token}))};}catch(error){return {error};}},
      patch:async args=>{calls.push(args);try{return {data:await call(a,patchAction(a,args.p_id,args.p_group,args.p_patch[args.p_group],{kind:args.p_kind,base:args.p_base_revision,epoch:args.p_epoch,session:args.p_session_id,token:args.p_token,request:args.p_request_id}))};}catch(error){return {error};}}};
    const client=createBudgetMetadataEditor({service,sessionId:identity.session,read:async()=>({ok:true,data:{...(await query(a,'select public.read_budget_metadata_snapshot_v3($1,$2) d',[trip,identity.session]))[0].d,metadataVerified:true}})});
    try{client.configure(actorA,trip,true,true);assert((await client.refresh()).ok);const g=client.get('budget',id,'pricing');assert(await client.focus(g));client.input(g,{...g.value,amount:'1200'});assert(await client.save(g));assert.equal((await record(id)).amount,1200);assert.equal(calls.length,1);assert.deepEqual(Object.keys(calls[0].p_patch),['pricing']);}
    finally{await client.dispose();}
  });
  const paymentQA=await paymentGroupCases({test,admin,query,a,b,actorA,actorB,viewer,pending,outsider,trip,secretTrip,fixture,record,call,leaseAction,patchAction,overlap,identities,undoQA,transaction,activity,waitUntil,pidA,pidB,observerPid,observations});
  await paymentMinimalCases({test,admin,query,a,b,actorA,actorB,trip,fixture,record,call,leaseAction,patchAction,overlap,identities,transaction,activity,waitUntil,pidA,pidB,observerPid,observations},paymentQA);
  await sourceBaselineCases({test,admin,trip,fixture,actorA,record},paymentQA);
  const sourceQA=await sourceGroupCases({test,admin,query,a,b,actorA,actorB,trip,fixture,record,call,leaseAction,patchAction,overlap,identities,transaction,activity,waitUntil,pidA,pidB,observerPid,observations},paymentQA);
  await test('B-4b real v6 strict Snapshot Source strategy named RPC relink and atomic Apply preserve identity',async()=>{
    const id=await sourceQA.actual(),budget=await fixture(),identity=identities.get(a),calls=[];
    const supabase={auth:{getSession:async()=>({data:{session:{user:{id:actorA}}}})},rpc:async(name,args)=>{calls.push({name,args});try{const keys=Object.keys(args),values=keys.map(k=>args[k]);const text=`public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')})`;return {data:await call(a,{text,values})};}catch(error){return {error};}}};
    const metadata=createBudgetMetadataEditor({service:{authorized:async()=>true},sessionId:identity.session,read:async()=>({ok:true,data:{...(await query(a,'select public.read_budget_metadata_snapshot_v6($1,$2) d',[trip,identity.session]))[0].d,metadataVerified:true}})}),source=createBudgetSourceController({metadata,service:createBudgetSourceService(supabase),sessionId:identity.session});
    try{metadata.configure(actorA,trip,true,true);source.configure(actorA,trip,true);const before=await record(id,'actual');for(const action of ['relink_only','apply_source_data']){const p=await source.preview('actual',id,{action,budget_id:budget});assert(!p.error,p.error?.message);assert(await source.execute('actual',id,{action,budget_id:budget,versions:p.data.versions}),source.view('actual',id).error);assert.equal(source.hasPending(),false);}const after=await record(id,'actual');assert.equal(after.budget_item_id,budget);assert.equal(after.title,'Initial');assert.equal(after.actual_twd_amount,before.actual_twd_amount);assert.deepEqual(after.payment_history,before.payment_history);assert.equal(calls.filter(c=>c.name==='mutate_budget_source').length,2);assert(!calls.some(c=>c.name.startsWith('save_')));}
    finally{await source.dispose();await metadata.dispose();}
  });
  await test('B-4a real v5 Snapshot explicit Payment controller named RPC and canonical reconciliation',async()=>{
    const id=await fixture(),identity=identities.get(a),rpc=async action=>{try{return {data:await call(a,action)};}catch(error){return {error};}};
    const metadata=createBudgetMetadataEditor({service:{authorized:async()=>true},sessionId:identity.session,read:async()=>({ok:true,data:{...(await query(a,'select public.read_budget_metadata_snapshot_v5($1,$2) d',[trip,identity.session]))[0].d,metadataVerified:true}})});
    const service={authorized:async actor=>actor===actorA,lease:args=>rpc(paymentQA.lease(a,args.p_id,args.p_action,{kind:args.p_kind,base:args.p_base_revision,epoch:args.p_epoch,versions:args.p_versions,token:args.p_token,session:args.p_session_id,intent:args.p_intent})),mutate:args=>rpc({text:'public.mutate_budget_payment_v2($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)',values:[args.p_trip_id,args.p_kind,args.p_id,args.p_session_id,args.p_token,args.p_epoch,args.p_base_revision,JSON.stringify(args.p_value),args.p_request_id]})};
    const payment=createBudgetPaymentController({metadata,service,sessionId:identity.session});
    try{metadata.configure(actorA,trip,true,true);payment.configure(actorA,trip,true);assert(await payment.execute('budget',id,{action:'paid'}),payment.view('budget',id).error);assert.equal(payment.hasPending(),false);const actual=(await admin('select id from actual_expenses where budget_item_id=$1',[id]))[0].id;assert(await payment.execute('budget',id,{action:'unpaid'}),payment.view('budget',id).error);assert(await payment.execute('budget',id,{action:'paid'}),payment.view('budget',id).error);assert.equal((await admin('select id from actual_expenses where budget_item_id=$1',[id]))[0].id,actual);}
    finally{await payment.dispose();await metadata.dispose();}
  });
  }
}catch(error){results.push({name:'harness/bootstrap',status:'failed',message:error.message,code:error.code});console.error(error.message);}
finally{
  await Promise.allSettled([a.end(),b.end()]);
  let server;
  try{server=(await admin('select version() version'))[0].version;}catch{}
  const report={marker,host:'127.0.0.1',port,server,results,observations,passed:results.filter(r=>r.status==='passed').length,failed:results.filter(r=>r.status==='failed').length};
  await fs.writeFile(path.join(process.env.BUDGET_NATIVE_EVIDENCE,'results.json'),JSON.stringify(report,null,2));
  await control.end();console.log(`Native parallel results: ${report.passed} passed, ${report.failed} failed`);if(report.failed)process.exitCode=1;
}
