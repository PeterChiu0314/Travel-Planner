import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID as uuid } from "node:crypto";
import { expenseBackend } from "./helpers/expenseBackend.js";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const forward = await read("../supabase/migrations/20261107035830_issue23_retire_legacy_budget.sql");
const cutover = await read("../docs/operations/budget-b7-legacy-cutover/20261101032853_budget_receipt_legacy_cutover.sql");
const admission = await read("../docs/operations/drafts/budget-b7-trip-cascade/20261031140648_budget_trip_cascade_lease_admission.sql");

test("retirement preserves native data and removes the legacy blocker for both baseline states", async t => {
  const { sql, trip: peer, A, B, close } = await expenseBackend({ timeline: true, legacyBudget: true });
  t.after(close);
  const q = async (query, args) => (await sql.query(query, args)).rows;
  const admin = async () => {
    await sql.exec("reset role");
    await q("select set_config('request.jwt.claim.sub','',false)");
  };
  const actor = async id => {
    await admin();
    await q("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await sql.exec("set role authenticated");
  };
  const ownerDelete = id => q("delete from public.trips where id=$1 returning id", [id]);

  // Exact hosted-only definitions installed before the current ledger.
  await sql.exec(cutover.split("$cutover_ddl$")[1]);
  await sql.exec(admission.split("$definition$")[1]);
  await sql.exec("create trigger zzz_budget_trip_delete_cleanup after delete on public.trips for each statement execute function app_private.cleanup_budget_trip_delete_admissions()");
  await sql.exec(admission.match(/create or replace function app_private\.guard_budget_external_parent\(\)[\s\S]*?\$tripbody\$;/)[0]);
  await sql.exec(await read("../supabase/migrations/20261107030622_issue23_allow_trip_delete_with_unfrozen_snapshot.sql"));

  const frozen = uuid(), planning = uuid();
  const expenseIds = [uuid(), uuid(), uuid()];
  for (const [i, id] of [peer, planning, frozen].entries()) {
    if (i) await q("insert into public.trips(id,title,name,destination,owner_id,start_date,end_date) values($1,'Retirement QA','Retirement QA','Japan',$2,'2090-01-01','2090-01-03')", [id, A]);
    await q("insert into public.trip_members(trip_id,user_id,role,status) values($1,$2,'owner','approved'),($1,$3,'editor','approved') on conflict do nothing", [id,A,B]);
    const [{id: stop}] = await q("insert into public.itinerary_items(trip_id,day_index,sort_order,type,title) values($1,0,0,'attraction','Visit QA') returning id", [id]);
    const [{id: guide}] = await q("insert into public.guide_items(trip_id,title) values($1,'Guide QA') returning id", [id]);
    await q("insert into public.todo_items(trip_id,title,guide_id) values($1,'Todo QA',$2)", [id,guide]);
    await actor(A);
    await q("insert into public.luggage_items(trip_id,title,owner_id) values($1,'Luggage QA',$2)", [id,A]);
    await admin();
    const expense = expenseIds[i];
    await q("insert into expense_stage_b.expense_items(id,trip_id,title,payment_state,budget) values($1,$2,'Expense QA','unpaid','{\"amount\":456}')", [expense,id]);
    await q("insert into expense_stage_b.expense_participants(expense_id,user_id) values($1,$2)", [expense,A]);
    await q("insert into expense_stage_b.expense_itinerary_links values($1,$2,$3)", [expense,id,stop]);
    await q("insert into expense_stage_b.groups(expense_id,group_key) values($1,'links')", [expense]);
    await q("insert into expense_stage_b.selections values($1,$2,$3,$4,$5,now(),now()+interval '1 minute')", [id,A,uuid(),expense,uuid()]);
    await q("insert into expense_stage_b.receipts values($1,$2,jsonb_build_object('id',$3::uuid),'{}'),($1,$4,jsonb_build_object('trip',$5::uuid),'{}')", [A,uuid(),expense,uuid(),id]);
    const [{id: legacy}] = await q("insert into public.budget_items(trip_id,title,category,amount,twd_amount,currency,exchange_rate,payer_id) values($1,'Legacy QA','其他',100,100,'TWD',1,$2) returning id", [id,A]);
    await q("insert into public.itinerary_budget_items(itinerary_item_id,budget_item_id) values($1,$2)", [stop,legacy]);
    const [{id: stay}] = await q("insert into public.accommodations(trip_id,name,check_in_date,check_out_date,expense_id,budget_item_id) values($1,'Stay QA','2090-01-01','2090-01-02',$2,$3) returning id", [id,expense,legacy]);
    await q("insert into public.attachments(trip_id,target_type,target_id,file_name,file_url) values($1,'accommodation',$2,'ordinary.txt','ordinary.txt')", [id,stay]);
    await sql.exec("alter table public.attachments disable trigger aa_removed_budget_receipts");
    await q("insert into public.attachments(trip_id,target_type,target_id,file_name,file_url) values($1,'budget_item',$2,'legacy.txt',$3)", [id,legacy,`trips/${id}/attachments/budget_item/${legacy}/legacy.txt`]);
    await sql.exec("alter table public.attachments enable trigger aa_removed_budget_receipts");
  }
  await q("update public.trip_budget_baselines set departure_at=now()-interval '1 day' where trip_id=$1", [frozen]);
  await sql.exec("update app_private.budget_finance_protocol set enabled=true where singleton; update app_private.budget_finance_protocol set enabled=false where singleton");
  assert.equal((await q("select count(*)::int n from public.trip_budget_baselines")).at(0).n, 3);
  await actor(A);
  for (const id of [planning,frozen]) await assert.rejects(() => ownerDelete(id), e => e.detail === "BUDGET_PARENT_DELETE_BLOCKED");
  await admin();

  const preserved = ["public.trips", "public.trip_members", "public.itinerary_items", "public.accommodations", "public.guide_items", "public.todo_items", "public.luggage_items", "public.attachments", "public.expense_signals",
    ...["expense_items","expense_participants","expense_itinerary_links","groups","receipts","selections","rate_leases"].map(name => `expense_stage_b.${name}`)];
  async function seal(peerOnly = false) {
    const seals = {};
    for (const table of preserved) {
      const expr = `to_jsonb(r)${table === "public.accommodations" ? " - 'budget_item_id'" : ""}`;
      const onlyOrdinary = table === "public.attachments" ? " and target_type='accommodation'" : "";
      const idKey = table === "public.trips" ? "id" : "trip_id";
      const where = table.endsWith(".receipts") ? "signature->>'trip'=$1::text or signature->>'id'=$2::text"
        : ["expense_participants","groups"].some(n=>table.endsWith("."+n)) ? "expense_id=$2::uuid and $1::uuid is not null" : `r.${idKey}=$1::uuid`;
      const result = await q(`select md5(coalesce(string_agg(d::text, ',' order by d::text),'')) hash from (select ${expr} d from ${table} r where ${peerOnly ? "("+where+")" : "true"}${onlyOrdinary}) s`,
        peerOnly ? (where.includes("$2") ? [peer,expenseIds[0]] : [peer]) : []);
      seals[table] = result[0].hash;
    }
    return seals;
  }
  const pre = await seal(), prePeer = await seal(true);
  // An unreviewed FK must stop the entire retirement before it can commit.
  await sql.exec("create table public.qa_unknown_dependency(id uuid references public.budget_items(id))");
  await assert.rejects(() => sql.exec(forward), e => e.code === "2BP01");
  await sql.exec("rollback; drop table public.qa_unknown_dependency");
  assert.deepEqual(await seal(), pre);
  assert.equal((await q("select count(*)::int n from public.attachments where target_type='budget_item'"))[0].n, 3);

  await sql.exec(forward);
  assert.deepEqual(await seal(), pre);
  const [{ retired, old_trigger, old_rpc, hosted_cutover, native_signal }] = await q(`select
    to_regclass('public.trip_budget_baselines') retired,
    to_regprocedure('app_private.guard_budget_external_parent()') old_trigger,
    to_regprocedure('public.read_budget_snapshot(uuid)') old_rpc,
    to_regclass('app_private.budget_receipt_legacy_cutover') hosted_cutover,
    exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='expense_signals') native_signal`);
  assert.deepEqual([retired, old_trigger, old_rpc, hosted_cutover, native_signal], [null, null, null, null, true]);

  const deleteTrip = id => q("select public.delete_trip_with_expenses($1) as id", [id]);
  await actor(B);
  assert.deepEqual(await ownerDelete(planning), []);
  await assert.rejects(() => deleteTrip(planning), e => e.code === "42501");
  await actor(A);
  await assert.rejects(() => q("update public.trips set budget_exchange_rates='{}'::jsonb || '{\"test\":1}' where id=$1", [peer]), e => e.code === "55000");
  assert.deepEqual(await deleteTrip(planning), [{id:planning}]);
  assert.deepEqual(await deleteTrip(frozen), [{id:frozen}]);
  await admin();
  assert.deepEqual(await seal(true), prePeer);
  for (const table of ["expense_items", "expense_itinerary_links", "selections", "rate_leases"]) {
    assert.equal((await q(`select count(*)::int n from expense_stage_b.${table} where trip_id=any($1::uuid[])`, [[planning,frozen]]))[0].n, 0);
  }
  for (const table of ["expense_participants", "groups"]) {
    assert.equal((await q(`select count(*)::int n from expense_stage_b.${table} where expense_id=any($1::uuid[])`, [expenseIds.slice(1)]))[0].n, 0);
  }
  assert.equal((await q("select count(*)::int n from expense_stage_b.receipts"))[0].n, 2);
  assert.equal((await q("select count(*)::int n from public.expense_signals"))[0].n, 1);
});
