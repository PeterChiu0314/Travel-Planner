// Sequential disposable PostgreSQL/WASM contract checks. Never concurrency evidence.
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {randomUUID as uuid} from 'node:crypto';
import {sourceGroupCases} from './budget-source-group-cases.mjs';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href),db=new PGlite();
const actorA=uuid(),actorB=uuid(),trip=uuid(),a={actor:actorA,session:uuid(),token:uuid()},b={actor:actorB,session:uuid(),token:uuid()},identities=new Map([[a,a],[b,b]]);
let passed=0,skipped=0;
const admin=async(sql,args=[])=>{if(sql.trim().toLowerCase()==='rollback'){await db.exec(sql);return [];}await db.exec("reset role;select set_config('request.jwt.claim.sub','',false)");return args.length?(await db.query(sql,args)).rows:(await db.exec(sql)).at(-1)?.rows||[];};
const query=async(c,sql,args=[])=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[c.actor]);await db.exec('set role authenticated');return (await db.query(sql,args)).rows;};
const call=async(c,p)=>(await query(c,'select '+p.text+' data',p.values))[0].data;
const record=async(id,kind='budget')=>(await admin(`select to_jsonb(r) data from ${kind==='budget'?'budget_items':'actual_expenses'} r where id=$1`,[id]))[0].data;
const fixture=async()=>{await admin("select set_config('request.jwt.claim.sub','',false)");const id=uuid();await admin("insert into budget_items(id,trip_id,title,note,category,amount,twd_amount,currency,exchange_rate,payer_id) values($1,$2,'Budget source','Budget note','交通',900,900,'TWD',1,$3)",[id,trip,actorA]);await admin('insert into budget_item_participants(budget_item_id,user_id,share_amount) values($1,$2,300),($1,$3,600)',[id,actorA,actorB]);return id;};
const leaseAction=(c,id,group,action='acquire',o={})=>({text:'public.budget_metadata_group_lease($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',values:[trip,o.kind||'budget',id,group,c.session,c.token,action,o.base??0,o.epoch??null,0,false]});
const patchAction=(c,id,group,value,o={})=>({text:'public.patch_budget_metadata_group($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)',values:[trip,o.kind||'budget',id,group,o.base??0,c.session,c.token,o.epoch,JSON.stringify({[group]:value}),uuid()]});
const test=async(name,run)=>{if(/overlap/.test(name)){skipped++;console.log('SKIP native-only '+name);return;}await run();passed++;console.log('PASS '+name);};
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create schema budget_test;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;
 grant usage on schema public,auth,storage,budget_test to authenticated,anon;alter default privileges in schema public grant all on tables to authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key,bucket_id text,name text,owner uuid,metadata jsonb);create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;create publication supabase_realtime;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);for(const file of (await fs.readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec((await fs.readFile(new URL(file,dir),'utf8')).replace(/create extension if not exists pgcrypto;/ig,''));
 await admin('insert into auth.users(id) values($1),($2)',[actorA,actorB]);await admin("insert into trips(id,title,name,destination,start_date,end_date,owner_id) values($1,'Source QA','Source QA','Japan','2090-01-01','2090-01-06',$2)",[trip,actorA]);await admin("insert into trip_members(trip_id,user_id,role,status) values($1,$2,'owner','approved'),($1,$3,'editor','approved')",[trip,actorA,actorB]);await admin('update app_private.budget_metadata_protocol set enabled=true;update app_private.budget_payment_protocol set enabled=true;update app_private.budget_metadata_undo_protocol set enabled=true');
 const acquire=async(c,id)=>{const value=(await query(c,'select public.read_budget_metadata_snapshot_v5($1,$2) d',[trip,c.session]))[0].d.paymentRecords.find(r=>r.id===id);const args=[trip,'budget',id,c.session,c.token,'acquire',value.revision,null,JSON.stringify(value.value.versions),'paid'];return (await query(c,'select public.budget_payment_lease_v2($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) d',args))[0].d;};
 const release=async(c,id,l)=>query(c,"select public.budget_payment_lease_v2($1,'budget',$2,$3,$4,'release',$5,$6,$7::jsonb,'paid')",[trip,id,c.session,c.token,l.revision,l.epoch,JSON.stringify(l.value.versions)]);
 const paid=async()=>{const id=await fixture(),l=await acquire(a,id);const r=(await query(a,"select public.mutate_budget_payment_v2($1,'budget',$2,$3,$4,$5,$6,$7::jsonb,$8) d",[trip,id,a.session,a.token,l.epoch,l.revision,JSON.stringify({action:'paid',versions:l.value.versions}),uuid()]))[0].d;await release(a,id,l);return {id,aid:r.created_id};};
 await sourceGroupCases({test,admin,query,a,b,actorA,actorB,trip,fixture,record,call,leaseAction,patchAction,identities},{paid,acquire,release});
 console.log(`PASS ${passed} Source SQL cases; ${skipped} real overlap cases run only in native harness.`);
}finally{await db.close();}
