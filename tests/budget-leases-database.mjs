// Disposable full-chain PostgreSQL verification; no hosted access.
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
  for (const file of (await fs.readdir(dir)).filter(name => name.endsWith(".sql")).sort()) {
    const source=(await fs.readFile(new URL(file,dir),'utf8')).replace(/create extension if not exists pgcrypto;/ig,'');
    if(file.endsWith('_budget_selection_activity.sql')){
      const before=(await db.query("select pg_get_functiondef('app_private.read_budget_collaboration(uuid,uuid)'::regprocedure) definition")).rows[0].definition;
      await assert.rejects(()=>db.exec(source.replace(/^commit;/m,"do $failure$ begin raise exception 'Injected activity rollback'; end $failure$;\ncommit;")),/Injected activity rollback/);await db.exec('rollback');
      assert.equal((await db.query("select to_regprocedure('public.update_budget_selection_v2(uuid,uuid,text,uuid,uuid,text)') api")).rows[0].api,null);
      assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_schema='app_private' and table_name='budget_selections' and column_name in ('activity_id','selected_at')")).rows[0].n,0);
      assert.equal((await db.query("select pg_get_functiondef('app_private.read_budget_collaboration(uuid,uuid)'::regprocedure) definition")).rows[0].definition,before);
    }
    await db.exec(source);
  }
  const query = async (sql, args = []) => (await db.query(sql, args)).rows;
  const a = randomUUID(), b = randomUUID(), viewer = randomUUID(), pending = randomUUID(), outsider = randomUUID(), trip = randomUUID();
  const s1 = randomUUID(), s2 = randomUUID(), t1 = randomUUID(), t2 = randomUUID();
  await query("insert into auth.users(id) select unnest($1::uuid[])", [[a, b, viewer, pending, outsider]]);
  await query("insert into trips(id,title,name,destination,start_date,end_date,owner_id) values($1,'Lease QA','Lease QA','Japan',current_date+10,current_date+15,$2)", [trip, a]);
  await query("insert into trip_members(trip_id,user_id,role,status) values($1,$2,'owner','approved'),($1,$3,'editor','approved'),($1,$4,'viewer','approved'),($1,$5,'editor','pending')", [trip, a, b, viewer, pending]);
  const id = randomUUID(), other = randomUUID();
  await query("insert into budget_items(id,trip_id,title,category,amount,currency,exchange_rate,twd_amount,payer_id) values($1,$3,'Lease fare','交通',1000,'TWD',1,1000,$4),($2,$3,'Other fare','交通',100,'TWD',1,100,$4)", [id, other, trip, a]);
  await query("insert into budget_item_participants(budget_item_id,user_id,share_amount) values($1,$2,500),($1,$3,500)", [id, a, b]);
  const login = async user => { await db.exec("reset role"); await query("select set_config('request.jwt.claim.sub',$1,false)", [user || ""]); await db.exec(`set role ${user ? "authenticated" : "anon"}`); };
  const admin = async () => { await db.exec("reset role"); await query("select set_config('request.jwt.claim.sub','',false)"); };
  const row = async (target = id) => (await query("select * from budget_items where id=$1", [target]))[0];
  const lease = async (action, session = s1, token = t1, target = id, type = "budget", baseline) => (await query("select budget_edit_lease($1,$2,$3,$4,$5,$6) result", [type, target, session, token, action, baseline || (action === "acquire" && type === "budget" ? (await row(target)).updated_at : null)]))[0].result;
  const deny = async (run, code) => { await assert.rejects(run, error => error.code === code); };
  const payload = { title: "Lease fare changed", category: "交通", amount: 1000, currency: "TWD", exchange_rate: 1, twd_amount: 1000, pricing_mode: "split_total", payer_id: a, participantIds: [a, b], linkedItemIds: [], shares: {}, is_fixed: false, payment_action: "keep", payment_expected: [] };
  const save = async (token = t1, session = s1, body = payload, target = id, baseline) => (await query("select save_budget_workspace_record_v4($1,'budget',$2,$3,$4::jsonb,$5,$6,$7) result", [trip, target, baseline || (await row(target)).updated_at, JSON.stringify(body), randomUUID(), session, token]))[0].result;
  const original = await row();
  const collab=async(session=s1)=>(await query("select read_budget_collaboration($1,$2) data",[trip,session]))[0].data;
  const selectRecord=async(session=s1,kind="budget",resource=id)=>(await query("select update_budget_selection($1,$2,$3,$4)",[trip,session,kind,resource]));
  const secretTrip=randomUUID();
  await query("insert into trips(id,title,name,destination,start_date,end_date,owner_id) values($1,'Other private','Other private','Japan',current_date+10,current_date+15,$2)",[secretTrip,outsider]);
  await query("insert into trip_members(trip_id,user_id,role,status) values($1,$2,'owner','approved')",[secretTrip,outsider]);
  await query("insert into budget_items(trip_id,title,category,amount,currency,exchange_rate,twd_amount) values($1,'Must not enter snapshot','其他',99,'TWD',1,99)",[secretTrip]);
  for (const actor of [viewer, pending, outsider]) {
    await login(actor); await deny(() => lease("acquire", s1, t1, id, "budget", original.updated_at), "42501");
    const snapshot=(await query("select read_budget_snapshot($1) data",[trip]))[0].data;
    if(actor===viewer) { assert.equal(snapshot.tripId,trip); assert.equal(snapshot.budgetItems.length,2); assert.equal(snapshot.budgetParticipants.length,2); assert.equal(snapshot.members.length,3); }
    else assert.equal(snapshot,null);
    if(actor===viewer) {await selectRecord();assert.equal((await collab()).entries[0].user_id,viewer);await selectRecord(s1,null,null);}
    else {assert.equal(await collab(),null);await deny(()=>selectRecord(),"42501");assert.equal((await query("select * from budget_collaboration_signals")).length,0);}
  }
  await login(null); await deny(() => lease("acquire", s1, t1, id, "budget", original.updated_at), "42501");
  await deny(()=>query("select read_budget_snapshot($1)",[trip]),"42501");
  await deny(()=>collab(),"42501");await deny(()=>selectRecord(),"42501");
  await login(a);
  assert.equal((await query("select read_budget_snapshot($1) data",[secretTrip]))[0].data,null);
  await deny(()=>query("insert into budget_collaboration_signals(trip_id) values($1)",[trip]),"42501");
  await deny(()=>query("update budget_collaboration_signals set revision=999 where trip_id=$1",[trip]),"42501");
  await deny(()=>query("select * from app_private.budget_selections"),"42501");
  await deny(()=>query("select update_budget_selection($1,$2,'budget',$3)",[secretTrip,s1,id]),"42501");
  await deny(() => query("select * from app_private.budget_edit_leases"), "42501");
  await deny(() => query("select budget_edit_lease(null,$1,$2,$3,'acquire',$4)", [id,s1,t1,original.updated_at]), "42501");
  // Legacy ownership is respected even when the account is identical.
  await query("update budget_items set locked_by=$1,locked_at=clock_timestamp() where id=$2", [a,other]);
  assert.equal((await lease("acquire",s1,t1,other)).reason,"legacy_locked");
  await query("update budget_items set locked_by=null,locked_at=null where id=$1", [other]);
  assert.equal((await lease("acquire")).granted, true);
  assert.equal((await collab()).entries.find(e=>e.mode==="edit").own_session,true);
  assert.equal((await collab(s2)).entries.find(e=>e.mode==="edit").own_session,false);
  await selectRecord();await selectRecord(s2,"budget",other);
  const hints=await collab();assert.equal(hints.entries.filter(e=>e.mode==="selection").length,2);
  for(const forbidden of ["token","session_id","token_hash"])assert.equal(JSON.stringify(hints).includes(forbidden),false);
  assert.deepEqual(await row(),original);
  await admin();await query("update app_private.budget_selections set expires_at=clock_timestamp()-interval '1 second'");
  await login(a);assert.equal((await collab()).entries.filter(e=>e.mode==="selection").length,0);
  await selectRecord(s1,null,null);await selectRecord(s2,null,null);
  for (let i = 0; i < 12; i++) assert.equal((await lease("renew")).granted, true);
  assert.deepEqual(await row(), original); // no content/version/legacy-lock mutation
  assert.equal((await lease("acquire", s2, t2)).granted, false); // same-account tab
  await lease("release", s2, t2);
  assert.equal((await lease("renew")).granted, true); // wrong tab did not release
  await login(b); assert.equal((await lease("acquire", s2, t2)).granted, false);
  await deny(() => query("update budget_items set title='bypass' where id=$1", [id]), "55P03");
  await deny(() => query("delete from budget_item_participants where budget_item_id=$1", [id]), "55P03");
  await deny(() => query("select delete_budget_workspace_record_v2($1,'budget',$2,$3,$4,$5)", [trip,id,original.updated_at,s2,t2]), "55P03");
  await deny(() => query("select save_budget_workspace_record_v2($1,'budget',$2,$3,$4::jsonb,$5)", [trip,id,original.updated_at,JSON.stringify(payload),randomUUID()]), "55P03");
  // Different records remain independent.
  assert.equal((await lease("acquire", s2, t2, other)).granted, true);
  await lease("release", s2, t2, other);
  await login(a);
  const changed = await save(); assert.equal(changed.id, id);
  assert.equal((await row()).title, payload.title);
  assert.equal((await row()).twd_amount, "1000.00");
  // Expiry is controlled only in this disposable fixture, never by the client.
  await admin(); await query("update app_private.budget_edit_leases set expires_at=clock_timestamp()-interval '1 second' where resource_id=$1", [id]);
  await login(a); assert.equal((await lease("renew")).granted, false);
  await deny(() => save(), "55P03");
  await deny(async () => query("select delete_budget_workspace_record_v2($1,'budget',$2,$3,$4,$5)", [trip,id,(await row()).updated_at,s1,t1]), "55P03");
  await login(b); assert.equal((await lease("acquire", s2, t2)).granted, true);
  await login(a); await lease("release"); // stale owner cannot clear B's capability
  await deny(() => save(), "55P03");
  await login(b); assert.equal((await lease("renew", s2, t2)).granted, true);
  await save(t2, s2, { ...payload, title: "B committed" });
  await lease("release", s2, t2);
  // A stale optimistic baseline is rejected before obtaining a new capability.
  await login(a); await deny(() => lease("acquire", s1, t1, id, "budget", original.updated_at), "40001");
  assert.equal((await lease("acquire")).granted, true);
  await save(t1, s1, { ...payload, unified_planning: true, payment_action: "paid", sync_payment: true });
  const expense = (await query("select * from actual_expenses where budget_item_id=$1", [id]))[0];
  await lease("release");
  await login(b);
  assert.equal((await lease("acquire", s2, t2, expense.id, "actual", expense.updated_at)).granted, true);
  const actualBefore = (await query("select * from actual_expenses where id=$1",[expense.id]))[0];
  assert.equal((await lease("renew",s2,t2,expense.id,"actual")).granted,true);
  assert.deepEqual((await query("select * from actual_expenses where id=$1",[expense.id]))[0],actualBefore);
  const receiptPayload={file_name:"lease-qa.pdf",file_url:`trips/${trip}/attachments/actual_expense/${expense.id}/qa.pdf`,file_size:100,file_type:"application/pdf"};
  const receiptRpc=async(action,body,session=s2,token=t2)=>(await query("select mutate_budget_receipt($1,$2,$3,$4::jsonb,$5,$6) data",[trip,expense.id,action,JSON.stringify(body),session,token]))[0].data;
  await deny(()=>receiptRpc("insert",receiptPayload,s1,t1),"55P03");
  await deny(()=>receiptRpc("insert",{...receiptPayload,file_url:"trips/other/qa.pdf"}),"22023");
  const receipt=await receiptRpc("insert",receiptPayload);
  assert.equal((await query("select read_budget_snapshot($1) data",[trip]))[0].data.attachments[0].id,receipt.id);
  await deny(()=>receiptRpc("delete",{id:receipt.id},s1,t1),"55P03");
  assert.equal((await receiptRpc("delete",{id:receipt.id})).file_url,receiptPayload.file_url);
  assert.deepEqual((await query("select * from actual_expenses where id=$1",[expense.id]))[0],actualBefore);
  await login(a);
  await deny(() => query("update actual_expense_participants set share_amount=1 where actual_expense_id=$1", [expense.id]), "55P03");
  assert.equal((await lease("acquire")).granted, true);
  const before = await row();
  await deny(() => save(t1, s1, { ...payload, title: "must rollback", unified_planning: true, sync_payment: true,
    payment_expected: [{ id: expense.id, updated_at: expense.updated_at }], payment_action: "keep" }), "55P03");
  assert.deepEqual(await row(), before); // linked Actual guard rolls back Budget too
  await lease("release");
  await login(b);
  await query("select save_budget_workspace_record_v4($1,'actual',$2,$3,$4::jsonb,$5,$6,$7)", [trip,expense.id,expense.updated_at,
    JSON.stringify({...payload,title:"Actual debit checked",budget_item_id:id,twd_amount_source:"actual",actual_twd_amount:999}),randomUUID(),s2,t2]);
  const savedActual=(await query("select * from actual_expenses where id=$1",[expense.id]))[0];
  assert.equal(savedActual.twd_amount,"999.00"); assert.equal(savedActual.actual_twd_amount,"999.00");
  await lease("release", s2, t2, expense.id, "actual");
  // Membership revocation prevents renew/save, but allows exact owner cleanup.
  await login(a); await lease("acquire");
  await admin(); await query("update trip_members set status='pending' where trip_id=$1 and user_id=$2", [trip,a]);
  await login(a); await deny(() => lease("renew"), "42501"); await deny(() => save(t1,s1,payload,id,before.updated_at), "42501");
  await lease("release");
  await admin(); assert.equal((await query("select count(*)::int n from app_private.budget_edit_leases"))[0].n, 0);
  await query("update trip_members set status='approved' where trip_id=$1 and user_id=$2", [trip,a]);
  // v2 orders real actions by server time, never heartbeat/resume expiry.
  const forbiddenSelectionId=(await query("select id from budget_items where trip_id=$1",[secretTrip]))[0].id;
  await login(a);
  const financialBeforeActivity=(await query("select read_budget_snapshot($1) data",[trip]))[0].data;
  const action1=randomUUID(),action2=randomUUID();
  const selectV2=async(session,resource,activity,action='select')=>query("select update_budget_selection_v2($1,$2,'budget',$3,$4,$5)",[trip,session,resource,activity,action]);
  await selectV2(s1,id,action1);const first=(await collab()).entries.find(e=>e.resource_id===id&&e.mode==='selection').selected_at;
  await selectV2(s2,other,action2);const second=(await collab()).entries.find(e=>e.resource_id===other&&e.mode==='selection').selected_at;
  assert.ok(second>first);assert.equal((await collab()).selectionProtocol,2);
  for(const action of ['refresh','clear','refresh','select']){await selectV2(s1,id,action1,action);if(action!=='clear')assert.equal((await collab()).entries.find(e=>e.resource_id===id&&e.mode==='selection').selected_at,first);}
  assert.equal((await collab()).entries.some(e=>'activity_id'in e||'session_id'in e),false);
  await selectV2(s1,id,randomUUID(),'clear');assert.equal((await collab()).entries.some(e=>e.resource_id===id&&e.mode==='selection'),true);
  await deny(()=>selectV2(s1,id,action1,null),'42501');
  for(const actor of [pending,outsider]){await login(actor);await deny(()=>selectV2(s1,id,randomUUID()),'42501');}
  await login(null);await deny(()=>selectV2(s1,id,randomUUID()),'42501');
  await login(a);await deny(()=>selectV2(s1,forbiddenSelectionId,randomUUID()),'40001');
  await login(viewer);const viewerActivity=randomUUID();await selectV2(s1,id,viewerActivity);assert.ok((await collab()).entries.some(e=>e.user_id===viewer));
  await login(a);await selectV2(s1,id,viewerActivity,'clear');assert.ok((await collab()).entries.some(e=>e.user_id===viewer));
  await login(viewer);await selectV2(s1,id,viewerActivity,'clear');await login(a);
  await selectV2(s1,id,action1,'clear');await selectV2(s2,other,action2,'clear');
  assert.deepEqual((await query("select read_budget_snapshot($1) data",[trip]))[0].data,financialBeforeActivity);
  await login(a); await lease("acquire", s1, t1, other);
  const version = (await row(other)).updated_at;
  await query("select delete_budget_workspace_record_v2($1,'budget',$2,$3,$4,$5)", [trip,other,version,s1,t1]);
  assert.equal((await query("select count(*)::int n from budget_items where id=$1", [other]))[0].n, 0);
  await admin(); assert.equal((await query("select count(*)::int n from app_private.budget_edit_leases"))[0].n, 0);
  assert.equal((await query("select relrowsecurity from pg_class where oid='app_private.budget_edit_leases'::regclass"))[0].relrowsecurity, true);
  const snapshotMetadata=(await query("select provolatile,prosecdef,has_function_privilege('anon',oid,'EXECUTE') anon from pg_proc where oid='read_budget_snapshot(uuid)'::regprocedure"))[0];
  assert.deepEqual(snapshotMetadata,{provolatile:"s",prosecdef:false,anon:false});
  // Exercise the exact authenticated Actual-delete API locally as well as
  // Budget delete. Hosted upstream timeout has not been reproduced here.
  await login(a);
  await lease("acquire",s1,t1,expense.id,"actual",savedActual.updated_at);
  await query("select delete_budget_workspace_record_v2($1,'actual',$2,$3,$4,$5)",[trip,expense.id,savedActual.updated_at,s1,t1]);
  const finalSnapshot=(await query("select read_budget_snapshot($1) data",[trip]))[0].data;
  assert.equal(finalSnapshot.actualExpenses.length,0); assert.equal(finalSnapshot.actualParticipants.length,0);
  assert.equal(finalSnapshot.budgetItems.length,1); assert.equal(finalSnapshot.budgetParticipants.length,2);
  await admin();
  const secretItem=(await query("select * from budget_items where trip_id=$1",[secretTrip]))[0];
  await login(outsider);await lease("acquire",s1,t1,secretItem.id,"budget",secretItem.updated_at);
  await admin();await query("delete from trips where id=$1",[secretTrip]);
  assert.equal((await query("select count(*)::int n from budget_collaboration_signals where trip_id=$1",[secretTrip]))[0].n,1);
  assert.equal((await query("select count(*)::int n from app_private.budget_edit_leases where trip_id=$1",[secretTrip]))[0].n,0);
  for (const fn of ["budget_edit_lease(text,uuid,uuid,uuid,text,timestamptz)","save_budget_workspace_record_v4(uuid,text,uuid,timestamptz,jsonb,uuid,uuid,uuid)","delete_budget_workspace_record_v2(uuid,text,uuid,timestamptz,uuid,uuid)","mutate_budget_receipt(uuid,uuid,text,jsonb,uuid,uuid)","read_budget_collaboration(uuid,uuid)","update_budget_selection(uuid,uuid,text,uuid)","update_budget_selection_v2(uuid,uuid,text,uuid,uuid,text)"]) {
    assert.equal((await query("select has_function_privilege('anon',$1,'EXECUTE') allowed", [fn]))[0].allowed, false);
    assert.equal((await query("select prosecdef from pg_proc where oid=$1::regprocedure", [fn]))[0].prosecdef, false);
  }
  const rolloutChecks=await query(await fs.readFile(new URL('../docs/qa/2026-10-28-budget-selection-activity-verify.sql',import.meta.url),'utf8'));
  assert.equal(rolloutChecks.length,6);
  for(const check of rolloutChecks)assert.equal(check.passed,true,check.check_name);
  console.log("PASS: full-chain Budget leases/snapshots/receipts; atomic authority, cross-trip RLS, STABLE invoker snapshot, zero financial heartbeat writes, guarded metadata, Actual/Budget delete, rollback, revocation and 6/6 selection rollout checks");
} finally { await db.close(); }
