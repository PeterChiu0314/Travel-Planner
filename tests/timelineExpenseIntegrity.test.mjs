import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID as uuid } from "node:crypto";
import { expenseBackend } from "./helpers/expenseBackend.js";

const fixture = await expenseBackend({ timeline: true });
const { sql, trip, A, B } = fixture;
test.after(() => fixture.close());
const query = (text, values = []) => sql.query(text, values);
async function asActor(actor = A) {
  await sql.exec("reset role");
  await query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
  await sql.exec("set role authenticated");
}
async function admin() {
  await sql.exec("reset role");
  await query("select set_config('request.jwt.claim.sub','',false)");
}
async function sample() {
  await admin();
  const ids = [uuid(), uuid(), uuid(), uuid()];
  for (let index = 0; index < ids.length; index++) {
    await query(`insert into public.itinerary_items(id,trip_id,day_index,sort_order,type,title,start_time,end_time)
      values($1,$2,0,$3,'attraction',$4,$5,$6)`, [ids[index], trip, index, ids[index], index < 3 ? `${9 + index}:00` : null, index < 3 ? `${10 + index}:00` : null]);
  }
  const expense = uuid(), second = uuid();
  await query(`insert into expense_stage_b.expense_items(id,trip_id,title,payment_state,budget)
    values($1,$3,'First','unpaid','{"amount":100}'),($2,$3,'Second','unpaid','{"amount":200}')`, [expense, second, trip]);
  await query("insert into expense_stage_b.expense_itinerary_links values($1,$3,$4),($2,$3,$5),($1,$3,$5),($1,$3,$6)", [expense, second, trip, ids[0], ids[2], ids[3]]);
  return { ids, expense, second };
}
async function manifest() {
  return (await query(`select app_private.timeline_day_visit_ids($1,0) as ids,
    (select jsonb_object_agg(id,updated_at) from itinerary_items where trip_id=$1 and day_index=0) as versions`, [trip])).rows[0];
}
async function reorder(slots, sources, ordered) {
  await admin();
  const expected = await manifest();
  await asActor();
  return (await query(`select public.apply_timeline_schedule_operation_link_safe($1,0,null,null,$2,$3,$4,null,null,$5,$6) as result`,
    [trip, { type: "reorder", orderedVisitIds: ordered || expected.ids }, expected.ids, expected.versions, slots, sources])).rows[0].result;
}
async function links() {
  await admin();
  return (await query(`select l.expense_id,i.title from expense_stage_b.expense_itinerary_links l
    join public.itinerary_items i on i.id=l.itinerary_item_id order by l.expense_id,i.title`)).rows;
}
async function clean() {
  await admin();
  await query("delete from public.itinerary_items where trip_id=$1", [trip]);
}

for (const order of [[1, 0, 2], [2, 1, 0], [1, 2, 0]]) {
  test(`package permutation ${order} preserves many-to-many expense links and amounts`, async () => {
    await clean();
    const { ids, expense, second } = await sample();
    const before = await links();
    const result = await reorder(ids.slice(0, 3), order.map(index => ids[index]));
    assert.equal(result.ok, true);
    assert.deepEqual(await links(), before);
    const rows = (await query("select id,budget from expense_stage_b.expense_items where id=any($1::uuid[]) order by id", [[expense, second]])).rows;
    assert.equal(rows.find(row => row.id === expense).budget.amount, 100);
    assert.equal(rows.find(row => row.id === second).budget.amount, 200);
    const groups = (await query("select revision from expense_stage_b.groups where expense_id=$1 and group_key='links'", [expense])).rows;
    assert.equal(Number(groups[0].revision), 1);
  });
}

test("untimed visual reorder retains identity, link revisions and amounts", async () => {
  await clean();
  const { ids, expense } = await sample();
  const before = await links();
  const result = await reorder(null, null, [ids[0], ids[3], ids[1], ids[2]]);
  assert.equal(result.ok, true);
  assert.deepEqual(await links(), before);
  assert.equal((await query("select count(*)::int as n from expense_stage_b.groups where expense_id=$1 and group_key='links'", [expense])).rows[0].n, 0);
});

test("stale link selection cannot attach to a newly swapped slot and exact committed replay remains valid", async () => {
  await clean();
  const { ids, expense } = await sample();
  await admin();
  const version = (await query("select updated_at::text from itinerary_items where id=$1", [ids[0]])).rows[0].updated_at;
  const session = uuid(), token = uuid(), request = uuid();
  await asActor(B);
  const lease = (await query("select public.expense_group_lease($1,'links',$2,$3,'acquire',0,null,0,false) as value", [expense, session, token])).rows[0].value;
  assert.equal(lease.granted, true);
  const value = { ids: [ids[0]], itinerary_versions: { [ids[0]]: version } };
  await reorder(ids.slice(0, 3), [ids[1], ids[0], ids[2]]);
  await asActor(B);
  await assert.rejects(() => query("select public.mutate_expense_group($1,'links',$2,$3,$4,0,$5,$6)", [expense, session, token, lease.epoch, value, request]), error => error.code === "PT409");
  await admin();
  const currentRevision = Number((await query("select revision from expense_stage_b.groups where expense_id=$1 and group_key='links'", [expense])).rows[0].revision);
  const oldValueForNewRevision = value;
  await asActor(B);
  const fresh = (await query("select public.expense_group_lease($1,'links',$2,$3,'acquire',$4,null,0,false) as value", [expense, session, token, currentRevision])).rows[0].value;
  await assert.rejects(() => query("select public.mutate_expense_group($1,'links',$2,$3,$4,$5,$6,$7)", [expense, session, token, fresh.epoch, currentRevision, oldValueForNewRevision, request]), error => error.code === "PT409");
  await admin();
  const current = await manifest();
  const good = { ids: [ids[0]], itinerary_versions: { [ids[0]]: current.versions[ids[0]] } };
  const args = [expense, session, token, fresh.epoch, currentRevision, good, uuid()];
  await asActor(B);
  const committed = (await query("select public.mutate_expense_group($1,'links',$2,$3,$4,$5,$6,$7) as value", args)).rows[0].value;
  await admin();
  await query("delete from public.itinerary_items where id=$1", [ids[0]]);
  await asActor(B);
  assert.deepEqual((await query("select public.mutate_expense_group($1,'links',$2,$3,$4,$5,$6,$7) as value", args)).rows[0].value, committed);
  assert.equal((await links()).some(link => link.expense_id === expense), false);
});

test("card deletion and confirmed shortening unlink only removed destinations and keep expenses", async () => {
  await clean();
  const { ids, expense } = await sample();
  await admin();
  await query("update public.itinerary_items set day_index=5 where id=$1", [ids[3]]);
  await asActor();
  await query("select public.delete_itinerary_item_budget_safe($1,$2)", [trip, ids[0]]);
  await query("select public.apply_trip_date_change($1,'2090-04-05','2090-04-06',true)", [trip]);
  const remaining = await links();
  assert.deepEqual(remaining.filter(link => link.expense_id === expense).map(link => link.title), [ids[2]]);
  assert.equal((await query("select budget->>'amount' as amount from expense_stage_b.expense_items where id=$1", [expense])).rows[0].amount, "100");
});

test("invalid manifests and unauthorized actors do not move any expense link", async () => {
  await clean();
  const { ids } = await sample(), before = await links();
  await admin();
  const expected = await manifest();
  await asActor();
  await assert.rejects(() => query(`select public.apply_timeline_schedule_operation_link_safe($1,0,null,null,$2,$3,$4,null,null,$5,$6)`,
    [trip, { type: "reorder", orderedVisitIds: expected.ids }, expected.ids, expected.versions, ids.slice(0, 2), ids.slice(0, 2).reverse()]), /stale_manifest/);
  await asActor(uuid());
  await assert.rejects(() => query(`select public.apply_timeline_schedule_operation_link_safe($1,0,null,null,$2,$3,$4,null,null,$5,$6)`,
    [trip, { type: "reorder", orderedVisitIds: expected.ids }, expected.ids, expected.versions, ids.slice(0, 3), ids.slice(0, 3).reverse()]), /permission_denied/);
  assert.deepEqual(await links(), before);
});

test("owner trip deletion clears native children while other trips and their expenses remain", async () => {
  await admin();
  const target = uuid(), retained = (await query("select count(*)::int as n from expense_stage_b.expense_items where trip_id=$1", [trip])).rows[0].n;
  await query("insert into public.trips(id,title,name,destination,owner_id,start_date,end_date) values($1,'Delete QA','Delete QA','Japan',$2,'2090-01-01','2090-01-03')", [target, A]);
  await query("insert into public.trip_members(trip_id,user_id,role,status) values($1,$2,'owner','approved') on conflict do nothing", [target, A]);
  const expense = uuid(), stop = uuid();
  await query("insert into itinerary_items(id,trip_id,day_index,sort_order,type,title) values($1,$2,0,0,'attraction','Delete QA')", [stop, target]);
  await query("insert into expense_stage_b.expense_items(id,trip_id,title,payment_state) values($1,$2,'Delete QA','unpaid')", [expense, target]);
  await query("insert into expense_stage_b.expense_participants(expense_id,user_id) values($1,$2)", [expense, A]);
  await query("insert into expense_stage_b.expense_itinerary_links values($1,$2,$3)", [expense, target, stop]);
  await query("insert into expense_stage_b.groups(expense_id,group_key) values($1,'links')", [expense]);
  await query("insert into expense_stage_b.rate_leases(trip_id) values($1)", [target]);
  await asActor(B);
  assert.equal((await query("delete from public.trips where id=$1 returning id", [target])).rows.length, 0);
  await asActor();
  assert.equal((await query("delete from public.trips where id=$1 returning id", [target])).rows.length, 1);
  await admin();
  for (const table of ["expense_items", "rate_leases", "expense_itinerary_links"]) {
    assert.equal((await query(`select count(*)::int as n from expense_stage_b.${table} where trip_id=$1`, [target])).rows[0].n, 0);
  }
  assert.equal((await query("select count(*)::int as n from public.expense_signals where trip_id=$1", [target])).rows[0].n, 0);
  assert.equal((await query("select count(*)::int as n from expense_stage_b.expense_items where trip_id=$1", [trip])).rows[0].n, retained);
});
