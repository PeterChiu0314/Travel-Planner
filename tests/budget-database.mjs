// Isolated PostgreSQL WASM test. No Supabase credentials or remote writes.
// PGLITE_MODULE points to an external @electric-sql/pglite/dist/index.js.
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite');
const db=new PGlite();
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
const migrationDir=new URL('../supabase/migrations/',import.meta.url);
for(const name of (await fs.readdir(migrationDir)).filter(n=>n.endsWith('.sql')).sort()) {
  // pgcrypto is supplied by Supabase; gen_random_uuid is built into PG here.
  const sql=(await fs.readFile(new URL(name,migrationDir),'utf8')).replace(/create extension if not exists pgcrypto;/ig,'');
  try {await db.exec(sql);} catch(error){console.error('Migration failed:',name,error.message);throw error;}
}
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002',c='00000000-0000-4000-8000-000000000003',viewer='00000000-0000-4000-8000-000000000004',outsider='00000000-0000-4000-8000-000000000005';
const trip='10000000-0000-4000-8000-000000000001',past='10000000-0000-4000-8000-000000000002';
await db.query(`insert into auth.users(id) select unnest($1::uuid[])`,[[a,b,c,viewer,outsider]]);
await db.query(`insert into trips(id,title,name,destination,start_date,end_date,owner_id) values($1,'Future','Future','Japan',current_date+10,current_date+15,$3),($2,'Past','Past','Japan',current_date-10,current_date-5,$3)`,[trip,past,a]);
await db.query(`insert into trip_members(trip_id,user_id,role,status) values($1,$2,'owner','approved'),($1,$3,'editor','approved'),($1,$4,'editor','approved'),($1,$5,'viewer','approved'),($6,$2,'owner','approved')`,[trip,a,b,c,viewer,past]);
await db.exec('set role authenticated');
async function login(user){await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[user]);}
await login(a);
async function save(kind,payload,id=null,base=null){return(await db.query(`select save_budget_workspace_record($1,$2,$3,$4,$5::jsonb) as result`,[trip,kind,id,base,JSON.stringify(payload)])).rows[0].result.id;}
const payload={title:'Gate',category:'門票',pricing_mode:'per_person',unit_amount:700,currency:'JPY',exchange_rate:0.22,participantIds:[a,b,c],payer_id:a,linkedItemIds:[],note:'',is_fixed:true};
const id=await save('budget',payload);
assert.equal((await db.query('select amount from budget_items where id=$1',[id])).rows[0].amount,'2100.00');
assert.equal((await db.query('select twd_amount from budget_items where id=$1',[id])).rows[0].twd_amount,'462.00');
assert.equal((await db.query('select count(*)::int n from actual_expenses where budget_item_id=$1',[id])).rows[0].n,1);
let baseline=(await db.query('select * from trip_budget_baselines where trip_id=$1',[trip])).rows[0];
assert.equal(baseline.payload.items[0].amount,2100);
assert.equal(baseline.payload.participants.length,3);
assert.equal((await db.query('select count(*)::int n from trip_budget_baselines where trip_id=$1',[past])).rows[0].n,0);
const before=(await db.query('select updated_at from budget_items where id=$1',[id])).rows[0].updated_at;
await assert.rejects(()=>save('budget',{...payload,participantIds:[outsider]},id,before));
assert.equal((await db.query('select count(*)::int n from budget_item_participants where budget_item_id=$1',[id])).rows[0].n,3);
await assert.rejects(()=>save('budget',payload,id,'2000-01-01T00:00:00Z'));
await login(viewer);await assert.rejects(()=>save('budget',payload));
await assert.rejects(()=>db.query('update trip_budget_baselines set payload=$1 where trip_id=$2',['{}',trip]));
await login(outsider);assert.equal((await db.query('select count(*)::int n from trip_budget_baselines')).rows[0].n,0);
await login(a);
const custom=await save('actual',{...payload,is_fixed:false,pricing_mode:'custom',shares:{[a]:2000,[b]:1500,[c]:1000},budget_item_id:id});
assert.equal((await db.query('select amount from actual_expenses where id=$1',[custom])).rows[0].amount,'4500.00');
assert.equal((await db.query('select sum(share_amount) s from actual_expense_participants where actual_expense_id=$1',[custom])).rows[0].s,'4500.00');
// A write begun before cutoff but committed after it cannot replace the last
// committed predeparture version. Deferred triggers check real commit-time.
await db.exec('reset role');
await db.query(`update trip_budget_baselines set departure_at=clock_timestamp()+interval '200 milliseconds' where trip_id=$1`,[trip]);
const beforeLateCommit=(await db.query('select payload from trip_budget_baselines where trip_id=$1',[trip])).rows[0].payload;
await db.exec('set role authenticated');await login(a);
await db.exec('begin');
const lateVersion=(await db.query('select updated_at from budget_items where id=$1',[id])).rows[0].updated_at;
await save('budget',{...payload,unit_amount:750},id,lateVersion);
await db.exec('select pg_sleep(0.25); commit');
assert.deepEqual((await db.query('select payload from trip_budget_baselines where trip_id=$1',[trip])).rows[0].payload,beforeLateCommit);
// Move the departure into the past, then modify future dates again. An existing
// frozen baseline must never be refreshed or recreated by later operations.
await db.exec('reset role');
await db.query(`update trip_budget_baselines set departure_at=clock_timestamp()-interval '1 second' where trip_id=$1`,[trip]);
baseline=(await db.query('select * from trip_budget_baselines where trip_id=$1',[trip])).rows[0];
await db.exec('set role authenticated');await login(a);
const version=(await db.query('select updated_at from budget_items where id=$1',[id])).rows[0].updated_at;
await save('budget',{...payload,unit_amount:900},id,version);
assert.equal((await db.query('select count(*)::int n from actual_expenses where budget_item_id=$1',[id])).rows[0].n,2); // Fixed actual plus independent custom expense; no duplicate fixed actual.
assert.deepEqual((await db.query('select payload from trip_budget_baselines where trip_id=$1',[trip])).rows[0].payload,baseline.payload);
await login(b);
await db.query('update budget_items set locked_by=$1,locked_at=clock_timestamp() where id=$2',[b,id]);
const lockedVersion=(await db.query('select updated_at from budget_items where id=$1',[id])).rows[0].updated_at;
await login(a);
await assert.rejects(()=>db.query('select delete_budget_workspace_record($1,$2,$3,$4)',[trip,'budget',id,lockedVersion]));
await login(b);
await db.query('select delete_budget_workspace_record($1,$2,$3,$4)',[trip,'budget',id,lockedVersion]);
const actual=(await db.query('select budget_item_id,budget_origin_id from actual_expenses where id=$1',[custom])).rows[0];
assert.equal(actual.budget_item_id,null);assert.equal(actual.budget_origin_id,id);
assert.deepEqual((await db.query('select payload from trip_budget_baselines where trip_id=$1',[trip])).rows[0].payload,baseline.payload);
console.log('PASS: all migrations; pricing, RLS, rollback, conflict, fixed actual, snapshot freeze and deleted-budget identity');
await db.close();
