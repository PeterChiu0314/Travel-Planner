// Disposable WASM PostgreSQL; sequential contract checks, no hosted connection.
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {randomUUID as uuid} from 'node:crypto';
import assert from 'node:assert/strict';
import {metadataUndoCases} from './budget-metadata-undo-cases.mjs';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href),db=new PGlite();
let passed=0;const test=async(name,run)=>{await run();passed++;console.log(`PASS ${name}`);};
const actorA=uuid(),actorB=uuid(),viewer=uuid(),pending=uuid(),outsider=uuid(),trip=uuid(),secretTrip=uuid();
const a={actor:actorA,session:uuid(),token:uuid()},b={actor:actorB,session:uuid(),token:uuid()},identities=new Map([[a,a],[b,b]]);
const raw=async(sql,args=[]) =>(await db.query(sql,args)).rows;
const admin=async(sql,args=[])=>{await db.exec('reset role');return raw(sql,args);};
const query=async(client,sql,args=[])=>{
  await db.exec('reset role');
  if(sql.includes("set_config('request.jwt.claim.sub'"))client.actor=args[0];
  await raw("select set_config('request.jwt.claim.sub',$1,false)",[client.actor]);await db.exec('set role authenticated');return raw(sql,args);
};
const call=async(client,action)=>(await query(client,`select ${action.text} data`,action.values))[0].data;
const leaseAction=(client,id,group,action='acquire',options={})=>({text:'public.budget_metadata_group_lease($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
  values:[trip,options.kind||'budget',id,group,options.session||client.session,options.token||client.token,action,options.base??0,options.epoch??null,0,false]});
const patchAction=(client,id,group,value,options={})=>({text:'public.patch_budget_metadata_group($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)',
  values:[trip,options.kind||'budget',id,group,options.base??0,options.session||client.session,options.token||client.token,options.epoch,JSON.stringify({[group]:value}),options.request||uuid()]});
const fixture=async()=>{
  await admin("select set_config('request.jwt.claim.sub','',false)");const id=uuid();
  await admin("insert into budget_items(id,trip_id,title,note,category,amount,twd_amount,currency,exchange_rate,payer_id) values($1,$2,'Initial','Initial note','交通',900,900,'TWD',1,$3)",[id,trip,actorA]);
  await admin('insert into budget_item_participants(budget_item_id,user_id,share_amount) values($1,$2,300),($1,$3,600)',[id,actorA,actorB]);return id;
};
const record=async(id,kind='budget')=>(await admin(`select to_jsonb(t) data from ${kind==='budget'?'budget_items':'actual_expenses'} t where id=$1`,[id]))[0].data;
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema storage;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;
    grant usage on schema public,auth,storage to authenticated,anon;
    alter default privileges in schema public grant all on tables to authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key,bucket_id text,name text,owner uuid,metadata jsonb);
    create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
    create publication supabase_realtime;`);
  const dir=new URL('../supabase/migrations/',import.meta.url),migration='20261029091435_budget_metadata_undo_prototype.sql';
  for(const file of (await fs.readdir(dir)).filter(f=>f.endsWith('.sql')&&f<migration).sort())await db.exec((await fs.readFile(new URL(file,dir),'utf8')).replace(/create extension if not exists pgcrypto;/ig,''));
  await admin('insert into auth.users(id) select unnest($1::uuid[])',[[actorA,actorB,viewer,pending,outsider]]);
  await admin("insert into trips(id,title,name,destination,start_date,end_date,owner_id) values($1,'Undo QA','Undo QA','Japan',current_date+10,current_date+15,$3),($2,'Other','Other','Japan',current_date+10,current_date+15,$4)",[trip,secretTrip,actorA,outsider]);
  await admin("insert into trip_members(trip_id,user_id,role,status) values($1,$2,'owner','approved'),($1,$3,'editor','approved'),($1,$4,'viewer','approved'),($1,$5,'editor','pending'),($6,$7,'owner','approved')",[trip,actorA,actorB,viewer,pending,secretTrip,outsider]);
  await fixture();const source=await fs.readFile(new URL(migration,dir),'utf8');
  const definitions=()=>admin("select p.oid::regprocedure::text name,pg_get_functiondef(p.oid) body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.prokind='f' order by name");
  const financial=()=>admin("select to_jsonb(t) data from budget_items t order by id");
  const before=await definitions(),beforeRows=await financial();
  await test('failed Undo migration is atomic and dormant reverse preserves all previous functions and financial rows',async()=>{
    await assert.rejects(()=>db.exec(source.replace(/commit;\s*$/i,'select 1/0;commit;')),e=>e.code==='22012');await db.exec('rollback');
    assert.deepEqual(await definitions(),before);assert.deepEqual(await financial(),beforeRows);
    await db.exec(source);assert.deepEqual((await definitions()).filter(f=>before.some(b=>b.name===f.name)),before);assert.deepEqual(await financial(),beforeRows);
    await db.exec(await fs.readFile(new URL('../docs/qa/2026-10-29-budget-metadata-undo-rollback.sql',import.meta.url),'utf8'));
    assert.deepEqual(await definitions(),before);assert.deepEqual(await financial(),beforeRows);await db.exec(source);
  });
  await admin('update app_private.budget_metadata_protocol set enabled=true');
  await metadataUndoCases({test,admin,query,a,b,identities,actorA,actorB,viewer,pending,outsider,trip,secretTrip,fixture,record,call,leaseAction,patchAction});
  await test('local privilege/catalog audit: only narrow invoker APIs, private RLS with zero direct grants/publication',async()=>{
    const tables=await admin("select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app_private' and c.relname like 'budget_metadata_undo_%' and c.relkind='r'");
    assert.equal(tables.length,6);assert(tables.every(t=>t.relrowsecurity));
    const grants=await admin("select * from information_schema.role_table_grants where table_schema='app_private' and table_name like 'budget_metadata_undo_%' and grantee in ('PUBLIC','anon','authenticated')");assert.equal(grants.length,0);
    const functions=await admin("select p.proname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('undo_budget_metadata_group','read_budget_metadata_undo','clear_budget_metadata_undo')");
    assert.equal(functions.length,3);assert(functions.every(f=>!f.prosecdef&&!f.anon&&f.authenticated&&f.proconfig.includes('search_path=""')));
    assert.equal((await admin("select * from pg_publication_tables where schemaname='app_private' and tablename like 'budget_metadata_undo_%'")).length,0);
  });
  await test('reverse refuses to erase successfully used Undo operations and receipts',async()=>{
    await admin('update app_private.budget_metadata_undo_protocol set enabled=false');
    await assert.rejects(async()=>db.exec(await fs.readFile(new URL('../docs/qa/2026-10-29-budget-metadata-undo-rollback.sql',import.meta.url),'utf8')),/undo_rollback_requires_dormant_unused_protocol/);await db.exec('rollback');
    assert((await admin('select count(*)::int n from app_private.budget_metadata_undo_operations'))[0].n>0);
  });
  console.log(`PASS ${passed} Undo DB scenarios; PGlite sequential SQL, not hosted or parallel evidence.`);
}finally{await db.close();}
