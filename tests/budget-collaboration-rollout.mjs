import fs from "node:fs/promises";
import {pathToFileURL} from "node:url";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {budgetSnapshotSQL,collaborationReadinessSQL,collaborationMigrations,prepareBudgetCollaborationRollout} from "../scripts/qa/prepare-budget-collaboration-rollout.mjs";
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);
for(const failure of [false,true]){
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create schema supabase_migrations;
 create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;
 grant usage on schema public,auth,storage to authenticated,anon;
 alter default privileges in schema public grant all on tables to authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key,bucket_id text,name text,owner uuid,metadata jsonb);
 create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
 create publication supabase_realtime;`);
 const dir=new URL("../supabase/migrations/",import.meta.url);
 for(const name of (await fs.readdir(dir)).filter(n=>n.endsWith(".sql")&&!collaborationMigrations.includes(n)).sort())await db.exec((await fs.readFile(new URL(name,dir),"utf8")).replace(/create extension if not exists pgcrypto;/ig,""));
 await db.exec("insert into supabase_migrations.schema_migrations(version) values('20261022110000'),('20261022120000')");
 const user=randomUUID(),trip=randomUUID();await db.query("insert into auth.users(id) values($1)",[user]);
 await db.query("insert into trips(id,title,name,destination,start_date,end_date,owner_id) values($1,'Keep trip','Keep trip','Japan',current_date+10,current_date+15,$2)",[trip,user]);
 await db.query("insert into budget_items(trip_id,title,category,amount,currency,exchange_rate,twd_amount) values($1,'Keep money','交通',1000,'TWD',1,1000)",[trip]);
 await db.query("insert into actual_expenses(trip_id,title,category,amount,currency,exchange_rate,twd_amount,twd_amount_source,actual_twd_amount) values($1,'Keep debit','交通',2000,'JPY',.2,777,'actual',777)",[trip]);
 const expected=(await db.query(budgetSnapshotSQL)).rows;
 assert.ok((await db.query(collaborationReadinessSQL)).rows.every(r=>r.passed));
 const result=await prepareBudgetCollaborationRollout(expected);
 if(failure){
   await assert.rejects(()=>db.exec(result.sql.replace("-- VERIFY_BUDGET_COLLABORATION","update budget_items set title='unwanted';\n-- VERIFY_BUDGET_COLLABORATION")),/Original content changed/);await db.exec("rollback");
   assert.deepEqual((await db.query(budgetSnapshotSQL)).rows,expected);assert.equal((await db.query("select to_regclass('app_private.budget_edit_leases') t")).rows[0].t,null);
   assert.equal((await db.query("select count(*)::int n from supabase_migrations.schema_migrations")).rows[0].n,2);
 }else{
   await db.exec(result.sql);assert.deepEqual((await db.query(budgetSnapshotSQL)).rows,expected);
   assert.ok((await db.query(result.verifySql)).rows.every(r=>r.passed));
   assert.equal((await db.query(collaborationReadinessSQL)).rows.find(r=>r.check_name==='new_migrations_absent').passed,false);
   assert.equal((await db.query("select count(*)::int n from supabase_migrations.schema_migrations")).rows[0].n,5);
   await assert.rejects(()=>db.exec(result.sql),/Already\/partially applied/);await db.exec("rollback");
 }
 }finally{await db.close();}
}
console.log("PASS: exact three-migration collaboration rollout, unchanged original rows/debits, client privilege/publication boundaries, history, repeat rejection and injected full rollback");
