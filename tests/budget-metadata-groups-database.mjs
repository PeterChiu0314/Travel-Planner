// Disposable PostgreSQL/WASM contract tests. No hosted project or credentials.
// PGLITE_MODULE points at a separately installed, untracked test runtime.
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { randomUUID as uuid } from 'node:crypto';
import assert from 'node:assert/strict';
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
let passed = 0;
const query = async (sql,args=[]) => (await db.query(sql,args)).rows;
const test = async (name,run) => { await run(); passed++; console.log(`PASS ${name}`); };
const deny = (run,code) => assert.rejects(run,error=>error.code===code);
const actorA=uuid(),actorB=uuid(),viewer=uuid(),pending=uuid(),outsider=uuid();
const trip=uuid(),otherTrip=uuid(),budget=uuid(),actual=uuid(),linked=uuid(),linkedActual=uuid(),item=uuid();
const sessionA=uuid(),sessionB=uuid(),sessionA2=uuid(),tokenA=uuid(),tokenB=uuid();
let titleLease,noteLease,titleResult,titleRequest;
const admin = async () => { await db.exec('reset role'); await query("select set_config('request.jwt.claim.sub','',false)"); };
const login = async actor => { await admin(); await query("select set_config('request.jwt.claim.sub',$1,false)",[actor||'']); await db.exec(`set role ${actor?'authenticated':'anon'}`); };
const row = async (id=budget,kind='budget') => (await query(`select to_jsonb(t) data from public.${kind==='budget'?'budget_items':'actual_expenses'} t where id=$1`,[id]))[0]?.data;
const read = async (id=budget,kind='budget',session=sessionA,tripId=trip) => (await query('select public.read_budget_metadata_groups($1,$2,$3,$4) data',[tripId,kind,id,session]))[0].data;
const lease = async (group,action='acquire',options={}) => {
  const {id=budget,kind='budget',session=sessionA,token=tokenA,base=0,epoch=null,seq=0,dirty=false,tripId=trip}=options;
  return (await query('select public.budget_metadata_group_lease($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) data',
    [tripId,kind,id,group,session,token,action,base,epoch,seq,dirty]))[0].data;
};
const patch = async (group,value,options={}) => {
  const {id=budget,kind='budget',session=sessionA,token=tokenA,base=0,epoch=titleLease?.epoch,request=uuid(),payload={[group]:value},tripId=trip}=options;
  return (await query('select public.patch_budget_metadata_group($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) data',
    [tripId,kind,id,group,base,session,token,epoch,JSON.stringify(payload),request]))[0].data;
};
const financial = data => Object.fromEntries(Object.entries(data).filter(([key])=>!['title','note','updated_at'].includes(key)));
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;
    grant usage on schema public,auth,storage to authenticated,anon;
    alter default privileges in schema public grant all on tables to authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key,bucket_id text,name text,owner uuid,metadata jsonb);
    create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
    create publication supabase_realtime;`);
  const dir=new URL('../supabase/migrations/',import.meta.url);
  const migration='20261029020551_budget_group_metadata_prototype.sql';
  for(const file of (await fs.readdir(dir)).filter(f=>f.endsWith('.sql')&&f<migration).sort()) {
    try { await db.exec((await fs.readFile(new URL(file,dir),'utf8')).replace(/create extension if not exists pgcrypto;/ig,'')); }
    catch(error) { console.error('Prerequisite failed:',file); throw error; }
  }
  await query('insert into auth.users(id) select unnest($1::uuid[])',[[actorA,actorB,viewer,pending,outsider]]);
  await query("insert into trips(id,title,name,destination,start_date,end_date,owner_id) values($1,'Metadata QA','Metadata QA','Japan',current_date+10,current_date+15,$3),($2,'Private','Private','Japan',current_date+10,current_date+15,$4)",[trip,otherTrip,actorA,outsider]);
  await query("insert into trip_members(trip_id,user_id,role,status) values($1,$2,'owner','approved'),($1,$3,'editor','approved'),($1,$4,'viewer','approved'),($1,$5,'editor','pending'),($6,$7,'owner','approved')",[trip,actorA,actorB,viewer,pending,otherTrip,outsider]);
  await query("insert into budget_items(id,trip_id,title,category,amount,currency,exchange_rate,twd_amount,payer_id) values($1,$3,'Original','交通',900,'TWD',1,900,$4),($2,$3,'Linked','住宿',100,'TWD',1,100,$4)",[budget,linked,trip,actorA]);
  await query("insert into budget_item_participants(budget_item_id,user_id,share_amount) values($1,$2,300),($1,$3,600)",[budget,actorA,actorB]);
  await query("insert into actual_expenses(id,trip_id,title,amount,currency,exchange_rate,twd_amount,payer_id,budget_item_id,twd_amount_source,actual_twd_amount) values($1,$3,'Standalone',300,'JPY',0.2,71,$4,null,'actual',71),($2,$3,'Payment',100,'TWD',1,100,$4,$5,'actual',100)",[actual,linkedActual,trip,actorA,linked]);
  await query("insert into itinerary_items(id,trip_id,title,type,date,day_index,sort_order) values($1,$2,'Visit','attraction',current_date+10,0,0)",[item,trip]);
  const preserved=async()=>query(`select * from (select 'budget' k,to_jsonb(t) data from budget_items t union all select 'actual',to_jsonb(t) from actual_expenses t
    union all select 'people',to_jsonb(t) from budget_item_participants t union all select 'baseline',to_jsonb(t) from trip_budget_baselines t) originals order by k,data::text`);
  const before=await preserved(),source=await fs.readFile(new URL(migration,dir),'utf8');
  const reverse=await fs.readFile(new URL('../docs/qa/2026-10-29-budget-metadata-prototype-rollback.sql',import.meta.url),'utf8');
  const oldFunctions=await query("select p.oid::regprocedure::text name,pg_get_functiondef(p.oid) body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.prokind='f' order by name");
  await test('migration fault rolls back all new objects and preserves business rows',async()=>{
    await assert.rejects(()=>db.exec(source.replace(/commit;\s*$/,()=>"do $$ begin raise exception 'Injected migration failure'; end $$; commit;")),/Injected migration failure/);
    await db.exec('rollback');
    assert.equal((await query("select to_regclass('app_private.budget_metadata_groups') name"))[0].name,null);
    assert.deepEqual(await preserved(),before);
  });
  await db.exec(source);
  await test('expand is dormant, backfills only private metadata and preserves exact originals',async()=>{
    assert.deepEqual(await preserved(),before);
    assert.equal((await query('select enabled from app_private.budget_metadata_protocol'))[0].enabled,false);
    assert.equal((await query('select count(*)::int n from app_private.budget_metadata_groups'))[0].n,8);
    await login(actorA); await deny(()=>lease('title'),'55000');
  });
  await test('dormant unused reverse restores original function definitions without financial changes',async()=>{
    await admin();await db.exec(reverse);
    assert.equal((await query("select to_regprocedure('public.read_budget_metadata_groups(uuid,text,uuid,uuid)') api"))[0].api,null);
    assert.deepEqual(await query("select p.oid::regprocedure::text name,pg_get_functiondef(p.oid) body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.prokind='f' order by name"),oldFunctions);
    assert.deepEqual(await preserved(),before);await db.exec(source);
  });
  await test('public APIs are invoker/auth-only; private tables/helpers are not exposed',async()=>{
    await admin();
    for(const fn of [
      'budget_metadata_group_lease(uuid,text,uuid,text,uuid,uuid,text,bigint,bigint,bigint,boolean)',
      'patch_budget_metadata_group(uuid,text,uuid,text,bigint,uuid,uuid,bigint,jsonb,uuid)',
      'read_budget_metadata_groups(uuid,text,uuid,uuid)']) {
      const [f]=await query("select p.prosecdef,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') auth,p.proconfig from pg_proc p where p.oid=$1::regprocedure",[`public.${fn}`]);
      assert.equal(f.prosecdef,false);assert.equal(f.anon,false);assert.equal(f.auth,true);assert(f.proconfig.includes('search_path=""'));
    }
    assert.equal((await query("select count(*)::int n from pg_publication_tables where schemaname='app_private' and tablename like 'budget_metadata_%'"))[0].n,0);
    await login(actorA);
    for(const table of ['protocol','groups','requests','effects'])await deny(()=>query(`select * from app_private.budget_metadata_${table}`),'42501');
    await deny(()=>query("select app_private.budget_metadata_record('budget',$1)",[budget]),'42501');
    await admin();await query('update app_private.budget_metadata_protocol set enabled=true');
  });
  await test('viewer can inspect authorized groups but viewer/pending/outsider/anon cannot write',async()=>{
    for(const actor of [viewer,pending,outsider]) {
      await login(actor);assert.equal(Boolean(await read()),actor===viewer);await deny(()=>lease('title'),'42501');
    }
    await login(null);await deny(()=>read(),'42501');await deny(()=>lease('title'),'42501');
    await login(actorA);await deny(()=>lease('title','acquire',{tripId:otherTrip}),'42501');
    await deny(()=>lease('amount'),'22023');
  });
  await test('same group has one holder including same-account different tabs; other group admits another user',async()=>{
    titleLease=await lease('title');assert.equal(titleLease.granted,true);
    assert.equal((await lease('title','acquire',{session:sessionA2,token:uuid()})).granted,false);
    await login(actorB);assert.equal((await lease('title','acquire',{session:sessionB,token:tokenB})).granted,false);
    noteLease=await lease('note','acquire',{session:sessionB,token:tokenB});assert.equal(noteLease.granted,true);
  });
  await test('reader exposes no capability or session secret and does not claim another tab owns a lease',async()=>{
    const data=await read(budget,'budget',sessionB);const wire=JSON.stringify(data);
    for(const secret of [tokenA,tokenB,sessionA,sessionB,'token_hash'])assert.equal(wire.includes(secret),false);
    assert.equal(data.groups.find(g=>g.group==='title').own_session,false);
    assert.equal(data.groups.find(g=>g.group==='note').own_session,true);
  });
  await test('group leases block legacy admission, raw parent/people/links and new linked payments',async()=>{
    await login(actorA);
    await deny(()=>query("select budget_edit_lease('budget',$1,$2,$3,'acquire',(to_jsonb(b)->>'updated_at')::timestamptz) from budget_items b where id=$1",[budget,sessionA2,uuid()]),'55P03');
    await deny(()=>query('update budget_items set amount=1 where id=$1',[budget]),'55P03');
    await deny(()=>query('update budget_items set locked_by=$2,locked_at=clock_timestamp() where id=$1',[budget,actorA]),'55P03');
    await deny(()=>query('delete from budget_item_participants where budget_item_id=$1',[budget]),'55P03');
    await deny(()=>query('insert into itinerary_budget_items(budget_item_id,itinerary_item_id) values($1,$2)',[budget,item]),'55P03');
    await deny(()=>query("insert into actual_expenses(trip_id,title,amount,twd_amount,budget_item_id) values($1,'Bypass',1,1,$2)",[trip,budget]),'55P03');
  });
  await test('strict patches reject extra/unknown keys, wrong token/epoch, empty title and linked resources',async()=>{
    await deny(()=>patch('title','x',{payload:{title:'x',amount:1}}),'22023');
    await deny(()=>patch('title',''),'22023');await deny(()=>patch('title',null),'22023');
    await deny(()=>patch('title','x',{token:uuid()}),'55P03');
    await deny(()=>patch('title','x',{epoch:titleLease.epoch+1}),'55P03');
    await deny(()=>lease('title','acquire',{id:linked}),'0A000');
    await deny(()=>lease('title','acquire',{id:linkedActual,kind:'actual'}),'0A000');
  });
  await test('different groups commit without whole-row conflicts or financial/participant overwrite',async()=>{
    const beforeRow=await row();const people=await query('select to_jsonb(p) data from budget_item_participants p where budget_item_id=$1 order by user_id',[budget]);
    await login(actorB);await patch('note','Member B note',{session:sessionB,token:tokenB,epoch:noteLease.epoch});
    await login(actorA);titleRequest=uuid();titleResult=await patch('title','Member A title',{request:titleRequest});
    const after=await row();assert.equal(after.title,'Member A title');assert.equal(after.note,'Member B note');
    assert.deepEqual(financial(after),financial(beforeRow));assert.deepEqual(await query('select to_jsonb(p) data from budget_item_participants p where budget_item_id=$1 order by user_id',[budget]),people);
    assert.deepEqual((await read()).groups.map(g=>g.revision),[1,1]);
    assert.equal((await read()).groups.find(g=>g.group==='title').own_session,true);
  });
  await test('autosave retains the epoch/capability; same focused group can submit again; stale same-group base rejects',async()=>{
    await deny(()=>patch('title','Stale'),'40001');
    const next=await patch('title','Continued typing',{base:1});assert.equal(next.revision,2);
    const held=(await read()).groups.find(g=>g.group==='title');assert.equal(held.epoch,titleLease.epoch);assert.equal(held.own_session,true);
    const prior=await row();const noop=await patch('title','Continued typing',{base:2});assert.equal(noop.revision,2);assert.deepEqual(await row(),prior);
  });
  await test('successful request replay survives release and rejects changed content or another tab',async()=>{
    await lease('title','release',{epoch:titleLease.epoch});
    assert.deepEqual(await patch('title','Member A title',{request:titleRequest,token:uuid()}),titleResult);
    assert.equal((await row()).title,'Continued typing');
    await deny(()=>patch('title','Different',{request:titleRequest}),'22023');
    await deny(()=>patch('title','Member A title',{request:titleRequest,session:sessionA2}),'22023');
  });
  await test('exact release cannot clear another user or a later acquisition epoch',async()=>{
    await lease('note','release',{epoch:noteLease.epoch});
    await login(actorB);assert.equal((await read(budget,'budget',sessionB)).groups.find(g=>g.group==='note').own_session,true);
    await lease('note','release',{epoch:noteLease.epoch,session:sessionB,token:tokenB});
    await login(actorA);const second=await lease('title','acquire',{base:2});assert(second.epoch>titleLease.epoch);
    await lease('title','release',{epoch:titleLease.epoch});assert.equal((await read()).groups.find(g=>g.group==='title').own_session,true);titleLease=second;
  });
  await test('caller-controlled GUCs or a prepared effect cannot authorize extra financial writes',async()=>{
    await query("select set_config('app.budget_metadata_allowed','true',false)");
    await deny(()=>query('update budget_items set note=$2 where id=$1',[budget,'Forged']),'55P03');
    await db.exec('begin');
    await query('select app_private.prepare_budget_metadata_patch($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)',[trip,'budget',budget,'title',2,sessionA,tokenA,titleLease.epoch,JSON.stringify({title:'Unsafe'}),uuid()]);
    await deny(()=>query('update budget_items set title=$2,amount=1 where id=$1',[budget,'Unsafe']),'55P03');await db.exec('rollback');
    assert.equal((await row()).title,'Continued typing');assert.equal(Number((await row()).amount),900);
  });
  await test('unfinished private preparation cannot be committed',async()=>{
    await db.exec('begin');
    await query('select app_private.prepare_budget_metadata_patch($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)',[trip,'budget',budget,'title',2,sessionA,tokenA,titleLease.epoch,JSON.stringify({title:'Unfinished'}),uuid()]);
    await deny(()=>db.exec('commit'),'40001');await db.exec('rollback');
    await admin();assert.equal((await query('select count(*)::int n from app_private.budget_metadata_effects'))[0].n,0);await login(actorA);
  });
  await test('injected post-write failure rolls back value, revision, request and effect together',async()=>{
    const beforeRow=await row(),beforeState=await read();const request=uuid();
    await admin();await db.exec("create function public.metadata_test_failure() returns trigger language plpgsql as $$begin raise exception 'Injected patch failure'; end$$; create trigger zz_metadata_test_failure after update on public.budget_items for each row execute function public.metadata_test_failure()");
    await login(actorA);await assert.rejects(()=>patch('title','Rolled back',{base:2,request}),/Injected patch failure/);
    assert.deepEqual(await row(),beforeRow);assert.deepEqual(await read(),beforeState);
    await admin();assert.equal((await query('select count(*)::int n from app_private.budget_metadata_requests where request_id=$1',[request]))[0].n,0);
    assert.equal((await query('select count(*)::int n from app_private.budget_metadata_effects'))[0].n,0);
    await db.exec('drop trigger zz_metadata_test_failure on public.budget_items; drop function public.metadata_test_failure()');await login(actorA);
  });
  await test('renewals do not change business data or extend idle without real activity; dirty TTL is bounded',async()=>{
    const beforeRow=await row();await admin();
    await query("update app_private.budget_metadata_groups set last_activity_at=clock_timestamp()-interval '119 seconds',expires_at=clock_timestamp()+interval '1 second' where kind='budget' and resource_id=$1 and group_key='title'",[budget]);
    await login(actorA);let renewed=await lease('title','renew',{epoch:titleLease.epoch});assert.equal(renewed.granted,true);
    assert(Date.parse(renewed.expires_at)-Date.now()<1500);
    renewed=await lease('title','renew',{epoch:titleLease.epoch,seq:1});assert.equal(renewed.granted,true);assert(Date.parse(renewed.expires_at)-Date.now()>110000);
    renewed=await lease('title','renew',{epoch:titleLease.epoch,seq:2,dirty:true});assert(Date.parse(renewed.expires_at)-Date.now()>400000);assert(Date.parse(renewed.expires_at)-Date.now()<=420000);
    assert.deepEqual(await row(),beforeRow);
  });
  await test('expired lease cannot renew/patch; takeover increments epoch and stale release is harmless',async()=>{
    await admin();await query("update app_private.budget_metadata_groups set expires_at=clock_timestamp()-interval '1 second' where kind='budget' and resource_id=$1 and group_key='title'",[budget]);
    await login(actorA);assert.equal((await lease('title','renew',{epoch:titleLease.epoch,seq:100})).granted,false);await deny(()=>patch('title','Expired',{base:2}),'55P03');
    await login(actorB);const taken=await lease('title','acquire',{base:2,session:sessionB,token:tokenB});assert(taken.epoch>titleLease.epoch);
    await login(actorA);await lease('title','release',{epoch:titleLease.epoch});
    await login(actorB);assert.equal((await read(budget,'budget',sessionB)).groups.find(g=>g.group==='title').own_session,true);
    await lease('title','release',{epoch:taken.epoch,session:sessionB,token:tokenB});
  });
  await test('legacy wildcard excludes groups and legacy metadata updates advance only the changed group',async()=>{
    await login(actorA);const b=await row();
    assert.equal((await query("select budget_edit_lease('budget',$1,$2,$3,'acquire',$4) data",[budget,sessionA,tokenA,b.updated_at]))[0].data.granted,true);
    assert.equal((await lease('note','acquire',{base:1})).reason,'legacy_locked');
    await query("select budget_edit_lease('budget',$1,$2,$3,'release',null)",[budget,sessionA,tokenA]);
    const prior=await read();await query('update budget_items set title=$2 where id=$1',[budget,'Legacy update']);
    const after=await read();assert.equal(after.groups.find(g=>g.group==='title').revision,prior.groups.find(g=>g.group==='title').revision+1);
    assert.equal(after.groups.find(g=>g.group==='note').revision,prior.groups.find(g=>g.group==='note').revision);
    await deny(()=>lease('title','acquire',{base:2}),'40001');
  });
  await test('standalone Actual metadata preserves known debit, original FX, origin and financial columns',async()=>{
    const beforeRow=await row(actual,'actual');const held=await lease('note','acquire',{id:actual,kind:'actual'});
    await patch('note','Standalone note',{id:actual,kind:'actual',epoch:held.epoch});
    assert.deepEqual(financial(await row(actual,'actual')),financial(beforeRow));assert.equal((await row(actual,'actual')).note,'Standalone note');
    await deny(()=>query("insert into attachments(trip_id,target_type,target_id,file_name,file_url) values($1,'actual_expense',$2,'x','x')",[trip,actual]),'55P03');
    await lease('note','release',{id:actual,kind:'actual',epoch:held.epoch});
  });
  await test('revocation blocks mutation/replay but allows exact cleanup',async()=>{
    const revision=(await read()).groups.find(g=>g.group==='title').revision;titleLease=await lease('title','acquire',{base:revision});
    await admin();await query("update trip_members set status='pending' where trip_id=$1 and user_id=$2",[trip,actorA]);
    await login(actorB);assert.equal((await read()).groups.find(g=>g.group==='title').held,false);
    await login(actorA);await deny(()=>patch('title','Revoked',{base:revision}),'42501');await deny(()=>patch('title','Member A title',{request:titleRequest}),'42501');
    await lease('title','release',{epoch:titleLease.epoch});
    await admin();await query("update trip_members set status='approved' where trip_id=$1 and user_id=$2",[trip,actorA]);await login(actorA);
  });
  await test('disabled protocol refuses new writes but permits exact release and refuses destructive reverse after use',async()=>{
    const revision=(await read()).groups.find(g=>g.group==='title').revision;const held=await lease('title','acquire',{base:revision});
    await admin();await query('update app_private.budget_metadata_protocol set enabled=false');await login(actorA);
    await deny(()=>patch('title','Paused',{base:revision,epoch:held.epoch}),'55000');
    await lease('title','release',{epoch:held.epoch});
    await admin();await assert.rejects(()=>db.exec(reverse),/metadata_rollback_requires_dormant_unused_protocol/);await db.exec('rollback');
    assert.equal((await query("select count(*)::int n from app_private.budget_metadata_requests"))[0].n>0,true);
    await query('update app_private.budget_metadata_protocol set enabled=true');await login(actorA);
  });
  await test('delete is blocked while held; tombstone and UUID recreation fence old capabilities',async()=>{
    const revision=(await read()).groups.find(g=>g.group==='title').revision;const held=await lease('title','acquire',{base:revision});
    await deny(()=>query('delete from budget_items where id=$1',[budget]),'55P03');await lease('title','release',{epoch:held.epoch});
    await query('delete from budget_items where id=$1',[budget]);assert.equal(await read(),null);
    await query("insert into budget_items(id,trip_id,title,category,amount,twd_amount) values($1,$2,'Recreated','其他',0,0)",[budget,trip]);
    const state=(await read()).groups.find(g=>g.group==='title');assert(state.epoch>held.epoch);assert(state.revision>revision);
    await deny(()=>patch('title','Old token',{base:state.revision,epoch:held.epoch}),'55P03');
  });
  console.log(`PASS ${passed} metadata DB scenarios. PGlite serial transactions; genuine parallel sessions/hosted acceptance remain unverified.`);
} catch(error) {
  console.error({message:error.message,code:error.code,where:error.where,query:error.query});
  process.exitCode=1;
} finally { await db.close(); }
