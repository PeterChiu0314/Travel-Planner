// Current-lock diagnostic against disposable PostgreSQL; intentionally records
// pre-fix behavior for Phase 0 review. Never connects to hosted Supabase.
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { acquireEditLock, releaseEditLock } from "../../src/lib/editLocks.js";
if (!process.env.PGLITE_MODULE || !process.env.BUDGET_LOCK_AUDIT_OUTPUT) throw new Error("Set external PGLITE_MODULE and BUDGET_LOCK_AUDIT_OUTPUT");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
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
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  for (const file of (await fs.readdir(dir)).filter(name => name.endsWith(".sql")).sort()) {
    await db.exec((await fs.readFile(new URL(file, dir), "utf8")).replace(/create extension if not exists pgcrypto;/ig, ""));
  }
  const a = randomUUID(), b = randomUUID(), trip = randomUUID(), id = randomUUID();
  await db.query("insert into auth.users(id) select unnest($1::uuid[])", [[a, b]]);
  await db.query("insert into trips(id,title,name,destination,start_date,end_date,owner_id) values($1,'Lock QA','Lock QA','Japan',current_date+10,current_date+15,$2)", [trip, a]);
  await db.query("insert into trip_members(trip_id,user_id,role,status) values($1,$2,'owner','approved'),($1,$3,'editor','approved')", [trip, a, b]);
  await db.query("insert into budget_items(id,trip_id,title,category,amount,currency,exchange_rate,twd_amount,payer_id) values($1,$2,'Lock QA','交通',1000,'TWD',1,1000,$3)", [id, trip, a]);
  const read = async () => (await db.query("select * from budget_items where id=$1", [id])).rows[0];
  const statements = [];
  // PGlite has one connection. Serialize real SQL transactions while retaining
  // the two frontend callers' original unlocked snapshot, as concurrent requests
  // do when PostgreSQL eventually serializes their row UPDATEs.
  let queue = Promise.resolve();
  function client(actor, session) {
    return { from(table) {
      assert.equal(table, "budget_items"); const filters = []; let patch, single = false;
      return { update(value) { patch = value; return this; }, eq(key, value) { filters.push([key, value]); return this; }, select() { return this; }, single() { single = true; return this; },
        then(resolve, reject) {
          const task = queue.then(async () => {
            await db.exec("begin");
            try {
              await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]); await db.exec("set local role authenticated");
              const keys = Object.keys(patch); assert(keys.every(key => ["locked_by", "locked_at"].includes(key)));
              assert(filters.every(([key]) => ["id", "locked_by"].includes(key)));
              const values = [...Object.values(patch), ...filters.map(([, value]) => value)];
              const sql = `update public.budget_items set ${keys.map((key, i) => `${key}=$${i + 1}`).join(",")} where ${filters.map(([key], i) => `${key}=$${keys.length + i + 1}`).join(" and ")} returning *`;
              statements.push({ session, sql }); const result = await db.query(sql, values); await db.exec("commit");
              return { data: single ? result.rows[0] || null : result.rows, error: null };
            } catch (error) { await db.exec("rollback"); throw error; }
          });
          queue = task.catch(() => {}); return task.then(resolve, reject);
        },
      };
    } };
  }
  const initial = await read();
  const [lockA, lockB] = await Promise.all([
    acquireEditLock({ record: initial, supabase: client(a, "A-tab-1"), table: "budget_items", userId: a }),
    acquireEditLock({ record: initial, supabase: client(b, "B-tab-1"), table: "budget_items", userId: b }),
  ]);
  assert.equal(lockA.error, null); assert.equal(lockB.error, null);
  assert.equal(lockA.lockedByAnotherUser, false); assert.equal(lockB.lockedByAnotherUser, false);
  assert.equal((await read()).locked_by, b);
  const crossAccount = { successes: 2, finalOwner: "B", firstCallerStillBelievesOwned: lockA.data.locked_by === a };
  await releaseEditLock({ recordId: id, supabase: client(b, "B-tab-1"), table: "budget_items", userId: b });
  const unlocked = await read();
  const [firstTab, secondTab] = await Promise.all([1, 2].map(tab => acquireEditLock({ record: unlocked, supabase: client(a, `A-tab-${tab}`), table: "budget_items", userId: a })));
  assert.equal(firstTab.error, null); assert.equal(secondTab.error, null);
  await releaseEditLock({ recordId: id, supabase: client(a, "A-tab-1"), table: "budget_items", userId: a });
  assert.equal((await read()).locked_by, null);
  const output = { methodology: "Real editLocks.js and full migration chain in disposable PGlite. Authenticated RLS applies. SQL row writes serialize on one connection; both frontend calls start from the same snapshot. Not a hosted two-connection or WebSocket test. Only unavailable pgcrypto extension declaration is skipped.",
    crossAccount, sameAccount: { successes: 2, releaseFromFirstTabClearsSecondTab: true }, statements };
  await fs.writeFile(process.env.BUDGET_LOCK_AUDIT_OUTPUT, JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
} finally { await db.close(); }
