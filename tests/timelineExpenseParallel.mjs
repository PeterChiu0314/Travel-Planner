import assert from "node:assert/strict";
import { randomUUID as uuid } from "node:crypto";
import { pathToFileURL } from "node:url";
import { installTimelineFixture } from "./helpers/expenseBackend.js";

const { Client } = (await import(pathToFileURL(process.env.BUDGET_NATIVE_PG_MODULE).href)).default;
const port = Number(process.env.BUDGET_NATIVE_PORT);
assert(port > 0 && process.env.BUDGET_NATIVE_MARKER, "Use the isolated native runner");
const connection = { host: "127.0.0.1", port, database: "postgres", user: "budget_local_admin" };
const admin = new Client(connection), scheduler = new Client(connection), editor = new Client(connection);
await Promise.all([admin.connect(), scheduler.connect(), editor.connect()]);
const trip = uuid(), actor = uuid(), peer = uuid();
const rows = async (text, args = []) => (await admin.query(text, args)).rows;
const sql = { exec: text => admin.query(text), query: (text, args) => admin.query(text, args) };
try {
  assert.equal((await admin.query("select current_setting('budget_metadata.test_cluster') as marker")).rows[0].marker, process.env.BUDGET_NATIVE_MARKER);
  await installTimelineFixture(sql, { id: trip, title: "Concurrent QA", destination: "Japan",
    start_date: "2090-01-01", end_date: "2090-01-02", budget_exchange_rates: {} }, actor,
    [actor, peer].map(user_id => ({ user_id, display_name: "QA", email: "qa@invalid.test", status: "approved", role: user_id === actor ? "owner" : "editor" })));
  for (const [client, id] of [[scheduler, actor], [editor, peer]]) {
    await client.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await client.query("set role authenticated");
  }
  const a = uuid(), b = uuid(), expense = uuid(), session = uuid(), token = uuid();
  await rows(`insert into itinerary_items(id,trip_id,day_index,sort_order,type,title,start_time,end_time)
    values($1,$3,0,0,'attraction','A','09:00','10:00'),($2,$3,0,1,'attraction','B','10:00','11:00')`, [a, b, trip]);
  await rows("insert into expense_stage_b.expense_items(id,trip_id,title,payment_state) values($1,$2,'Expense','unpaid')", [expense, trip]);
  async function prepareSwap() {
    const versions = (await rows("select jsonb_object_agg(id,updated_at) as value from itinerary_items where trip_id=$1", [trip]))[0].value;
    return { versions, args: [trip, { type: "reorder", orderedVisitIds: [a, b] }, [a, b], versions, [b, a]] };
  }
  const swapQuery = "select public.apply_timeline_schedule_operation_link_safe($1,0,null,null,$2,$3,$4,null,null,$3,$5) as value";
  const mutateQuery = "select public.mutate_expense_group($1,'links',$2,$3,$4,$5,$6,$7) as value";
  const lease = async base => (await editor.query("select public.expense_group_lease($1,'links',$2,$3,'acquire',$4,null,0,false) as value", [expense, session, token, base])).rows[0].value;
  const first = await prepareSwap(), held = await lease(0);
  const request = uuid(), body = { ids: [a], itinerary_versions: { [a]: first.versions[a] } };

  // A link write commits first while Timeline is waiting for its trip lock.
  await editor.query("begin");
  await editor.query(mutateQuery, [expense, session, token, held.epoch, 0, body, request]);
  const waitingSwap = scheduler.query(swapQuery, first.args);
  await admin.query("select pg_sleep(0.1)");
  assert.equal((await rows("select cardinality(pg_blocking_pids($1)) as n", [scheduler.processID]))[0].n, 1);
  await editor.query("commit");
  assert.equal((await waitingSwap).rows[0].value.ok, true);
  assert.deepEqual(await rows(`select i.title from expense_stage_b.expense_itinerary_links l
    join itinerary_items i on i.id=l.itinerary_item_id where l.expense_id=$1`, [expense]), [{ title: "A" }]);
  console.log("PASS link commits before waiting reorder, link follows A");

  // Reorder commits first. A peer's displayed slot versions must be rejected.
  const second = await prepareSwap();
  const revision = Number((await rows("select revision from expense_stage_b.groups where expense_id=$1 and group_key='links'", [expense]))[0].revision);
  const fresh = await lease(revision);
  const value = { ids: [a], itinerary_versions: { [a]: second.versions[a] } };
  await scheduler.query("begin");
  await scheduler.query(swapQuery, second.args);
  const blockedWrite = editor.query(mutateQuery, [expense, session, token, fresh.epoch, revision, value, uuid()]).then(() => null, error => error);
  await admin.query("select pg_sleep(0.1)");
  assert.equal((await rows("select cardinality(pg_blocking_pids($1)) as n", [editor.processID]))[0].n, 1);
  await scheduler.query("commit");
  assert.equal((await blockedWrite).code, "PT409");
  assert.deepEqual(await rows(`select i.title from expense_stage_b.expense_itinerary_links l
    join itinerary_items i on i.id=l.itinerary_item_id where l.expense_id=$1`, [expense]), [{ title: "A" }]);
  console.log("PASS reorder commits before waiting link write, stale selection refused");

  // Even an unlinked expense at revision zero must validate target versions.
  const newExpense = uuid(), newToken = uuid();
  await rows("insert into expense_stage_b.expense_items(id,trip_id,title,payment_state) values($1,$2,'Unlinked','unpaid')", [newExpense, trip]);
  const claim = (await editor.query("select public.expense_group_lease($1,'links',$2,$3,'acquire',0,null,0,false) as value", [newExpense, session, newToken])).rows[0].value;
  await assert.rejects(() => editor.query(mutateQuery, [newExpense, session, newToken, claim.epoch, 0, value, uuid()]), error => error.code === "PT409");
  console.log("PASS new expense cannot attach stale slot after a swap");

  const noteToken = uuid(), noteRequest = uuid();
  const note = (await editor.query("select public.expense_group_lease($1,'note',$2,$3,'acquire',0,null,0,false) as value",
    [newExpense, session, noteToken])).rows[0].value;
  assert.equal(note.granted, true);
  await editor.query("begin");
  await editor.query("select public.mutate_expense_group($1,'note',$2,$3,$4,0,$5,$6)",
    [newExpense, session, noteToken, note.epoch, { text: "Concurrent save" }, noteRequest]);
  await scheduler.query("set statement_timeout='5s'");
  const deleteTrip = () => scheduler.query("select public.delete_trip_with_expenses($1) as id", [trip]);
  await assert.rejects(deleteTrip, error => error.code === "55P03");
  assert.equal((await rows("select count(*)::int as n from trips where id=$1", [trip]))[0].n, 1);
  await editor.query("commit");
  assert.deepEqual((await deleteTrip()).rows, [{ id: trip }]);
  assert.equal((await rows("select count(*)::int as n from expense_stage_b.receipts where request_id=$1", [noteRequest]))[0].n, 0);
  console.log("PASS owner delete refuses a live expense transaction and succeeds after it commits");
} finally {
  await Promise.allSettled([scheduler.query("rollback"), editor.query("rollback")]);
  await Promise.all([admin.end(), scheduler.end(), editor.end()]);
}
