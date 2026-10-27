import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { prepareBudgetSafetyRollout } from "../scripts/qa/prepare-budget-safety-rollout.mjs";
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
for (const inject of [false, true]) {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage; create schema supabase_migrations;
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
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await fs.readdir(dir)).filter(name => name.endsWith(".sql") && !/^(20261022110000|20261022120000|20261027140044|20261027145613|20261027152539)/.test(name)).sort()) {
      await db.exec((await fs.readFile(new URL(file, dir), "utf8")).replace(/create extension if not exists pgcrypto;/ig, ""));
    }
    const user = randomUUID(), trip = randomUUID(), budget = randomUUID();
    await db.query("insert into auth.users(id) values($1)", [user]);
    await db.query("insert into trips(id,title,name,destination,start_date,end_date,owner_id) values($1,'Rollout QA','Rollout QA','Japan',current_date+10,current_date+15,$2)", [trip,user]);
    await db.query("insert into trip_members(trip_id,user_id,role,status) values($1,$2,'owner','approved')", [trip,user]);
    await db.query("insert into budget_items(id,trip_id,title,category,amount,currency,exchange_rate,twd_amount,payer_id) values($1,$2,'Keep budget','交通',1000,'TWD',1,1000,$3)", [budget,trip,user]);
    await db.query("insert into actual_expenses(trip_id,title,category,amount,currency,exchange_rate,twd_amount,payer_id) values($1,'Keep exact cost','交通',2800,'JPY',.22,620,$2)", [trip,user]);
    const expected = (await db.query(`select (select count(*)::int from actual_expenses) as "actualCount",
      (select md5(coalesce(jsonb_agg(to_jsonb(t)-'updated_at' order by t.id)::text,'[]')) from actual_expenses t) as "actualDigest",
      (select count(*)::int from budget_items) as "budgetCount",
      (select md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text,'[]')) from budget_items t) as "budgetDigest"`)).rows[0];
    const { sql } = await prepareBudgetSafetyRollout(expected);
    if (inject) {
      await assert.rejects(() => db.exec(sql.replace("-- VERIFY_BUDGET_DATA", "update public.budget_items set title='unwanted change';\n-- VERIFY_BUDGET_DATA")), /Original content changed/);
      await db.exec("rollback");
      assert.equal((await db.query("select title from budget_items where id=$1", [budget])).rows[0].title, "Keep budget");
      assert.equal((await db.query("select count(*)::int n from supabase_migrations.schema_migrations")).rows[0].n, 0);
      assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_schema='public' and table_name='actual_expenses' and column_name='payment_active'")).rows[0].n, 0);
    } else {
      await db.exec(sql);
      assert.equal((await db.query("select count(*)::int n from supabase_migrations.schema_migrations")).rows[0].n, 2);
      const expense = (await db.query("select * from actual_expenses")).rows[0];
      assert.equal(Number(expense.twd_amount), 620); assert.equal(Number(expense.actual_twd_amount), 620);
      assert.equal(expense.payment_active, true); assert.deepEqual(expense.payment_history, []);
      await assert.rejects(() => db.exec(sql), /Unexpected migration history/); await db.exec("rollback");
    }
  } finally { await db.close(); }
}
console.log("PASS: exact guarded two-migration rollout; metadata backfill, original-content preservation, history registration, repeat rejection and injected full-transaction rollback");
