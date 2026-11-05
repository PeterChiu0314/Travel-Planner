import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {pathToFileURL} from 'node:url';import {randomUUID as uuid} from 'node:crypto';
test('forward packet preserves two distinct historical Actual shapes and installs only RLS readers',async()=>{
 const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href),db=new PGlite(),trip=uuid(),A=uuid(),B=uuid(),id1=uuid(),id2=uuid();
 try{await db.exec(`create role anon;create role authenticated;create schema auth;create schema app_private;create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text);
 create table public.trips(id uuid primary key,budget_exchange_rates jsonb default '{}');create table public.trip_members(trip_id uuid,user_id uuid,display_name text,email text,status text,role text);create table public.itinerary_items(id uuid primary key,trip_id uuid,title text,day_index int);
 create table public.accommodations(id uuid,trip_id uuid,budget_item_id uuid);create table public.budget_items(id uuid);create table public.budget_item_participants(id uuid);create table public.itinerary_budget_items(id uuid);
 create table public.actual_expenses(id uuid primary key,trip_id uuid,title text,category text,note text,payer_id uuid,amount numeric,twd_amount numeric,currency text,exchange_rate numeric,paid_at timestamptz,record_status text,payment_active boolean,budget_item_id uuid,budget_origin_id uuid,pricing_mode text);
 create table public.actual_expense_participants(actual_expense_id uuid,user_id uuid,share_amount numeric);
 create table app_private.budget_edit_leases(expires_at timestamptz);create table app_private.budget_rates_leases(expires_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function app_private.can_read_trip(t uuid,a uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.trip_members where trip_id=t and user_id=a and status='approved')$$;
 create function app_private.can_edit_trip(t uuid,a uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.trip_members where trip_id=t and user_id=a and status='approved' and role in('owner','editor'))$$;
 create publication supabase_realtime;
 grant usage on schema auth,app_private to authenticated;grant execute on function auth.uid(),app_private.can_read_trip(uuid,uuid) to authenticated;`);
 await db.query('insert into public.trips(id) values($1)',[trip]);await db.query("insert into public.trip_members values($1,$2,'A','a@qa.invalid','approved','owner')",[trip,A]);
 await db.query("insert into public.actual_expenses values($1,$2,'Legacy fractional','其他',null,null,1.25,0.75,'JPY',0.6,null,'complete',true,null,null,'split_total')",[id1,trip]);
 await db.query("insert into public.actual_expenses values($1,$2,'Cancelled','其他',null,$3,2,2,'TWD',1,null,'complete',false,null,null,'custom')",[id2,trip,A]);
 await db.query('insert into public.actual_expense_participants values($1,$2,null),($3,$4,1)',[id1,A,id2,B]);
 let packet=await fs.readFile(new URL('../supabase/migrations/20261105080725_issue18_single_expense.sql',import.meta.url),'utf8');
 packet=packet.replace(/-- preflight\.sql[\s\S]*?(?=-- isolated-schema\.sql)/,'').replaceAll('<>8','<>2').replaceAll('<>11','<>2').replaceAll('<>1','<>0').replaceAll('<>18','<>0');
 await db.exec(packet);
 const rows=(await db.query('select id,paid,paid_at,payment_state from expense_stage_b.expense_items order by id')).rows;
 assert.equal(rows.length,2);assert.equal(rows.find(r=>r.id===id1).paid.twd_amount,.75);assert.equal(rows.find(r=>r.id===id1).paid_at,null);assert.equal(rows.find(r=>r.id===id1).payment_state,'paid');assert.equal(rows.find(r=>r.id===id2).payment_state,'unpaid');
 assert.equal((await db.query('select count(*)::int n from expense_stage_b.expense_participants')).rows[0].n,2);
 assert((await db.query("select relrowsecurity from pg_class where oid='public.expense_signals'::regclass")).rows[0].relrowsecurity);
 assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations')).rows[0].n,1);
 }finally{await db.close();}
});
