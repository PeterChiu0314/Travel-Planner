// Offline PostgreSQL fault/RLS tests. No hosted credentials or writes.
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
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
  const dir = new URL("../supabase/migrations/", import.meta.url);
  for (const file of (await fs.readdir(dir)).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec((await fs.readFile(new URL(file, dir), "utf8")).replace(/create extension if not exists pgcrypto;/ig, ""));
  }
  const a = randomUUID(), b = randomUUID(), c = randomUUID(), viewer = randomUUID(), outsider = randomUUID();
  const trip = randomUUID(), past = randomUUID();
  await db.query("insert into auth.users(id) select unnest($1::uuid[])", [[a, b, c, viewer, outsider]]);
  await db.query("insert into trips(id,title,name,destination,start_date,end_date,owner_id) values($1,'Future','Future','Japan',current_date+10,current_date+15,$3),($2,'Past','Past','Japan',current_date-10,current_date-5,$3)", [trip, past, a]);
  await db.query("insert into trip_members(trip_id,user_id,role,status) values($1,$2,'owner','approved'),($1,$3,'editor','approved'),($1,$4,'editor','approved'),($1,$5,'viewer','approved'),($6,$2,'owner','approved'),($6,$3,'editor','approved'),($6,$4,'editor','approved')", [trip, a, b, c, viewer, past]);
  const query = async (sql, args = []) => (await db.query(sql, args)).rows;
  const login = async (id) => { await db.exec("set role authenticated"); await query("select set_config('request.jwt.claim.sub',$1,false)", [id]); };
  const version = async (id, table = "budget_items") => (await query(`select updated_at from ${table} where id=$1`, [id]))[0].updated_at;
  const save = async (kind, payload, id = null, base = null, request = randomUUID(), tripId = trip) => (await query("select save_budget_workspace_record_v2($1,$2,$3,$4,$5::jsonb,$6) result", [tripId, kind, id, base, JSON.stringify(payload), request]))[0].result;
  const payments = async (id) => (await query("select id,updated_at from actual_expenses where budget_item_id=$1 order by id", [id])).map((row) => ({ id: row.id, updated_at: row.updated_at.toISOString() }));
  const payload = { title: "Atomic fare", category: "交通", amount: 1000, currency: "TWD", exchange_rate: 1, pricing_mode: "split_total", unit_amount: null, participantIds: [a,b,c], linkedItemIds: [], payer_id: a, shares: {}, is_fixed: false };
  await login(a);
  const request = randomUUID();
  const paid = { ...payload, payment_action: "paid", payment_expected: [] };
  const created = await save("budget", paid, null, null, request);
  assert.deepEqual(await save("budget", paid, null, null, request), created);
  assert.equal((await payments(created.id)).length, 1);
  await assert.rejects(async () => save("budget", { ...paid, title: "Changed request" }, null, null, request));
  const initialPayment = (await payments(created.id))[0];
  await save("budget", { ...payload, amount: 2000, payment_action: "keep" }, created.id, await version(created.id));
  assert.equal(Number((await query("select twd_amount from actual_expenses where id=$1", [initialPayment.id]))[0].twd_amount), 1000);
  assert.equal((await payments(created.id)).length, 1);

  // Known TWD stays authoritative, custom allocations retain the original FX amounts.
  const manual = { ...payload, title: "JPY charge", currency: "JPY", amount: 2800, exchange_rate: .22, pricing_mode: "custom", shares: { [a]:1400, [b]:700, [c]:700 }, budget_item_id: created.id, twd_amount_source: "actual", actual_twd_amount: 625 };
  const cost = await save("actual", manual);
  let record = (await query("select * from actual_expenses where id=$1", [cost.id]))[0];
  assert.equal(Number(record.amount),2800); assert.equal(Number(record.twd_amount),625); assert.equal(record.twd_amount_source,"actual");
  assert.equal(Number((await query("select sum(share_amount) n from actual_expense_participants where actual_expense_id=$1", [cost.id]))[0].n),2800);
  await save("actual", { ...manual, title:"Updated note", note:"Retain debit" }, cost.id, await version(cost.id,"actual_expenses"));
  assert.equal(Number((await query("select twd_amount from actual_expenses where id=$1",[cost.id]))[0].twd_amount),625);
  await assert.rejects(async () => save("actual", { ...manual, actual_twd_amount:625.5 }));
  const noReference = await save("actual", { ...payload, amount:9999999999,currency:"JPY",exchange_rate:"",twd_amount_source:"actual",actual_twd_amount:625 });
  record = (await query("select * from actual_expenses where id=$1",[noReference.id]))[0];
  assert.equal(record.exchange_rate,null);assert.equal(Number(record.twd_amount),625);assert.equal(Number(record.amount),9999999999);
  // Even a stale old client cannot overwrite an authoritative debit with 616.
  await query("select save_budget_workspace_record($1,'actual',$2,$3,$4::jsonb)",[trip,cost.id,await version(cost.id,"actual_expenses"),JSON.stringify({...manual,title:"Older client"})]);
  assert.equal(Number((await query("select twd_amount from actual_expenses where id=$1",[cost.id]))[0].twd_amount),625);
  const estimated = await save("actual", { ...payload, amount:2800,currency:"JPY",exchange_rate:.22,twd_amount_source:"estimated" });
  record = (await query("select * from actual_expenses where id=$1",[estimated.id]))[0];
  assert.equal(Number(record.twd_amount),616); assert.equal(record.actual_twd_amount,null);
  await assert.rejects(async () => save("actual", { ...manual, amount:0, shares:{[a]:0,[b]:0,[c]:0} }));
  // Missing/new shared rates are still required for planning, with server authority.
  await assert.rejects(async () => save("budget",{...payload,currency:"USD",amount:10,exchange_rate:999}));
  const quote={rates:{JPY:.22,USD:32,EUR:35,KRW:.024,HKD:4.1},source:"ExchangeRate-API",quoted_at:new Date().toISOString()};
  await query("select update_trip_budget_rates($1,$2::jsonb,false)",[trip,JSON.stringify(quote)]);
  const usd=await save("budget",{...payload,currency:"USD",amount:10,exchange_rate:999});
  assert.equal(Number((await query("select twd_amount from budget_items where id=$1",[usd.id]))[0].twd_amount),320);
  assert.equal(Number((await query("select twd_amount from actual_expenses where id=$1",[cost.id]))[0].twd_amount),625);

  // Snapshot/confirmation, locks and receipts all reject without touching the graph.
  const expected = await payments(created.id);
  await assert.rejects(async () => save("budget", { payment_only:true,payment_action:"unpaid",payment_expected:expected },created.id,await version(created.id)));
  const receipt = randomUUID();
  await query("insert into attachments(id,trip_id,target_type,target_id,file_name,file_url) values($1,$2,'actual_expense',$3,'receipt.pdf','local-fixture')",[receipt,trip,cost.id]);
  await assert.rejects(async () => save("budget", { ...payload,title:"Must roll back",payment_action:"unpaid",payment_expected:expected,payment_confirmed:true },created.id,await version(created.id)));
  assert.equal((await query("select title from budget_items where id=$1",[created.id]))[0].title,payload.title);
  assert.equal((await payments(created.id)).length,2);
  assert.equal((await query("select id from attachments where id=$1",[receipt])).length,1);
  await query("delete from attachments where id=$1",[receipt]);
  await query("update actual_expenses set note='Other editor changed this' where id=$1",[cost.id]);
  await assert.rejects(async () => save("budget", { payment_only:true,payment_action:"unpaid",payment_expected:expected,payment_confirmed:true },created.id,await version(created.id)));
  await login(b); await query("update actual_expenses set locked_by=$1,locked_at=clock_timestamp() where id=$2",[b,cost.id]); await login(a);
  await assert.rejects(async () => save("budget", { payment_only:true,payment_action:"unpaid",payment_expected:await payments(created.id),payment_confirmed:true },created.id,await version(created.id)));
  await login(b); await query("update actual_expenses set locked_by=null,locked_at=null where id=$1",[cost.id]); await login(a);

  // Failure after inserting one child must roll back every child and parent.
  await db.exec("reset role");
  await db.exec(`create function public.fail_payment_insert() returns trigger language plpgsql as $$begin if new.title='Fail full' then raise exception 'Injected payment failure'; end if; return new; end$$;
    create trigger fail_payment_insert before insert on actual_expenses for each row execute function public.fail_payment_insert();`);
  await login(a);
  const baselineBefore = (await query("select payload from trip_budget_baselines where trip_id=$1",[trip]))[0].payload;
  const failedRequest = randomUUID();
  await assert.rejects(async () => save("budget", {...paid,title:"Fail full"},null,null,failedRequest));
  assert.equal((await query("select id from budget_items where title='Fail full'")).length,0);
  assert.deepEqual((await query("select payload from trip_budget_baselines where trip_id=$1",[trip]))[0].payload,baselineBefore);
  await db.exec("reset role; drop trigger fail_payment_insert on actual_expenses; drop function public.fail_payment_insert();"); await login(a);
  const retried = await save("budget", {...paid,title:"Fail full"},null,null,failedRequest);
  assert.equal((await payments(retried.id)).length,1);
  // Fail on the second payment deletion: the first deletion must be restored too.
  const current = await payments(created.id), failId = current.at(-1).id;
  await db.exec("reset role");
  await db.exec(`create function public.fail_payment_delete() returns trigger language plpgsql as $$begin if old.id='${failId}'::uuid then raise exception 'Injected delete failure'; end if; return old; end$$;
    create trigger fail_payment_delete before delete on actual_expenses for each row execute function public.fail_payment_delete();`);
  await login(a);
  const clear = {...payload,title:"Saved together with unpaid",payment_action:"unpaid",payment_expected:current,payment_confirmed:true};
  const budgetBeforeClear = (await query("select * from budget_items where id=$1",[created.id]))[0];
  await assert.rejects(async () => save("budget",clear,created.id,await version(created.id)));
  assert.deepEqual((await query("select * from budget_items where id=$1",[created.id]))[0],budgetBeforeClear);
  assert.equal((await payments(created.id)).length,2);
  assert.equal((await query("select count(*)::int n from actual_expense_participants where actual_expense_id=any($1::uuid[])",[current.map((row)=>row.id)]))[0].n,6);
  await db.exec("reset role; drop trigger fail_payment_delete on actual_expenses; drop function public.fail_payment_delete();"); await login(a);
  await save("budget",clear,created.id,await version(created.id)); assert.equal((await payments(created.id)).length,0);
  assert.equal((await query("select title from budget_items where id=$1",[created.id]))[0].title,clear.title);

  // Historic missing-rate records retain their exact stored TWD, even if it is
  // different from a fresh round(amount * exchange_rate).
  await db.exec("reset role");
  const historical = randomUUID();
  await query("insert into budget_items(id,trip_id,category,title,amount,currency,exchange_rate,twd_amount,payer_id) values($1,$2,'交通','Old JPY',2800,'JPY',.22,620,$3)",[historical,past,a]);
  await query("insert into budget_item_participants(budget_item_id,user_id) select $1,unnest($2::uuid[])",[historical,[a,b,c]]);
  await login(a);
  const legacy = {...payload,title:"Historic title",amount:2800,currency:"JPY",exchange_rate:.22,payment_action:"keep"};
  await save("budget",legacy,historical,await version(historical),randomUUID(),past);
  record=(await query("select * from budget_items where id=$1",[historical]))[0]; assert.equal(Number(record.twd_amount),620);assert.equal(Number(record.exchange_rate),.22);
  await assert.rejects(async ()=>save("budget",{...legacy,exchange_rate:.23},historical,record.updated_at,randomUUID(),past));
  await assert.rejects(async ()=>query("update budget_items set exchange_rate=.23 where id=$1",[historical]));
  assert.equal((await query("select trip_id from trip_budget_baselines where trip_id=$1",[past])).length,0);
  await save("budget",{payment_only:true,payment_action:"paid",payment_expected:[]},historical,await version(historical),randomUUID(),past);
  assert.equal(Number((await query("select twd_amount from actual_expenses where budget_item_id=$1",[historical]))[0].twd_amount),620);
  await db.exec("reset role");
  const noJoins=randomUUID();
  await query("insert into budget_items(id,trip_id,category,title,amount,currency,exchange_rate,twd_amount,payer_id) values($1,$2,'交通','Missing FX and joins',1000,'JPY',null,250,$3)",[noJoins,past,a]);
  await login(a);
  await save("budget",{...legacy,title:"Metadata without old joins",amount:1000,exchange_rate:""},noJoins,await version(noJoins),randomUUID(),past);
  record=(await query("select * from budget_items where id=$1",[noJoins]))[0];
  assert.equal(record.exchange_rate,null);assert.equal(Number(record.twd_amount),250);
  // Unified planning preserves receipt identity and supports atomic amount edits.
  const unified = async (body,id=null,base=null,key=randomUUID()) => (await query("select save_budget_workspace_record_v3($1,'budget',$2,$3,$4::jsonb,$5) result",[trip,id,base,JSON.stringify({...body,unified_planning:true}),key]))[0].result;
  const unifiedBudget=await unified({...payload,title:"Unified ticket",amount:12000,payment_action:"paid",payment_expected:[]});
  const retainedId=(await payments(unifiedBudget.id))[0].id;
  const receiptId=randomUUID();
  await query("insert into attachments(id,trip_id,target_type,target_id,file_name,file_url) values($1,$2,'actual_expense',$3,'unified.pdf','fixture')",[receiptId,trip,retainedId]);
  await unified({...payload,title:"Unified ticket",amount:12500,sync_payment:true,payment_action:"keep",payment_expected:await payments(unifiedBudget.id)},unifiedBudget.id,await version(unifiedBudget.id));
  let retained=(await query("select * from actual_expenses where id=$1",[retainedId]))[0];
  assert.equal(Number(retained.twd_amount),12500);assert.equal(retained.payment_history.length,1);assert.equal(Number(retained.payment_history[0].amount),12000);
  const unpaidBody={payment_only:true,payment_action:"unpaid",payment_expected:await payments(unifiedBudget.id)}, unpaidBase=await version(unifiedBudget.id), unpaidKey=randomUUID();
  const unpaidResult=await unified(unpaidBody,unifiedBudget.id,unpaidBase,unpaidKey);
  assert.deepEqual(await unified(unpaidBody,unifiedBudget.id,unpaidBase,unpaidKey),unpaidResult);
  retained=(await query("select * from actual_expenses where id=$1",[retainedId]))[0];
  assert.equal(retained.payment_active,false);assert.equal(Number(retained.twd_amount),12500);assert.equal((await query("select id from attachments where id=$1",[receiptId])).length,1);
  await unified({payment_only:true,payment_action:"paid",payment_expected:await payments(unifiedBudget.id)},unifiedBudget.id,await version(unifiedBudget.id));
  assert.equal((await payments(unifiedBudget.id)).length,1);
  await db.exec("reset role");
  await db.exec(`create function public.fail_unified_update() returns trigger language plpgsql as $$begin if new.title='Fail unified' then raise exception 'Injected update failure'; end if; return new; end$$;create trigger fail_unified_update before update on actual_expenses for each row execute function public.fail_unified_update();`);
  await login(a);
  const beforeUnified=(await query("select * from budget_items where id=$1",[unifiedBudget.id]))[0];
  // A real snapshot reaches the injected failure after the budget update.
  const failedSync={...payload,title:"Fail unified",amount:13000,sync_payment:true,payment_action:"keep",payment_expected:await payments(unifiedBudget.id)};
  await assert.rejects(()=>unified(failedSync,unifiedBudget.id,beforeUnified.updated_at),/Injected update failure/);
  assert.deepEqual((await query("select * from budget_items where id=$1",[unifiedBudget.id]))[0],beforeUnified);
  assert.equal(Number((await query("select twd_amount from actual_expenses where id=$1",[retainedId]))[0].twd_amount),12500);
  await db.exec("reset role;drop trigger fail_unified_update on actual_expenses;drop function public.fail_unified_update();");await login(a);
  // Invoker financial writes remain denied to viewers, outsiders and anon.
  await login(viewer); await assert.rejects(async ()=>save("budget",paid)); await assert.rejects(()=>unified(paid));
  await login(outsider); await assert.rejects(async ()=>save("budget",paid)); await assert.rejects(()=>unified(paid));
  await db.exec("set role anon"); await assert.rejects(async ()=>save("budget",paid)); await assert.rejects(()=>unified(paid));
  await login(a); await assert.rejects(async ()=>query("select * from app_private.budget_workspace_requests"));
  console.log("PASS: budget safety v2; idempotency, confirmation, manual debit, legacy FX, RLS, locks, snapshots, receipts and injected insert/delete rollback");
} catch (error) {
  console.error({message:error.message,code:error.code,where:error.where,query:error.query}); process.exitCode=1;
} finally { await db.close(); }
