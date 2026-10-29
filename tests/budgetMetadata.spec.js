import { expect, test } from "@playwright/test";
import { mock } from "node:test";
import { createBudgetMetadataEditor, validBudgetMetadataSnapshot, withoutBudgetMetadata, budgetAuthorityTimeoutMs } from "../src/lib/budgetMetadataService.js";
import { createBudgetRefresh } from "../src/lib/budgetSync.js";
import { createRequestGuard } from "../src/lib/luggageSync.js";
import { createDemoBudgetMetadataService } from "../src/demo/budgetMetadata.js";
import { primaryBudgetCollaborators } from "../src/lib/budgetCollaboration.js";
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const clients = [];
test.afterEach(async () => { await Promise.all(clients.splice(0).map(c => c.dispose())); });
async function setup(options = {}) {
  let time = Date.now(), serial = 0;
  const values = new Map(), storage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  const props = { currentUserId: "A", activeTrip: { id: "trip" }, budgetItems: [{ id: "id", trip_id: "trip", title: "Title", note: "Note", currency: "TWD", amount: 900 }], actualExpenses: [],
    onSaveMetadata(kind, id, group, value) { props.budgetItems[0] = { ...props.budgetItems[0], [group]: value }; } };
  const transport = createDemoBudgetMetadataService(() => props, () => time), calls = [], patches = [], reads = { fail: false };
  const service = { ...transport, lease: async args => { calls.push(args); return transport.lease(args); }, patch: async args => { patches.push(args); return transport.patch(args); } };
  const client = createBudgetMetadataEditor({ service, read: trip => reads.delegate ? reads.delegate(trip) : reads.gate ? reads.gate.promise : reads.fail ? {ok:false} : transport.read(trip), sessionId: "tab", now: () => time, makeId: () => `token-${++serial}`, storage, ...options });
  clients.push(client);
  client.configure("A", "trip", true, true); await client.refresh();
  return { client, props, calls, patches, reads, service, transport, values, storage, title: client.get("budget", "id", "title"), note: client.get("budget", "id", "note"), advance: ms => { time += ms; } };
}
test("initial inspection has no authority; snapshot readiness/schema are strictly checked", async () => {
  const f = await setup(); expect(f.calls).toEqual([]); expect(f.client.view(f.title).writable).toBe(false);
  const good = (await f.transport.read("trip")).data; expect(validBudgetMetadataSnapshot(good, "trip")).toBe(true);
  for (const data of [{ ...good, tripId: "other" }, { ...good, metadataProtocol: { ...good.metadataProtocol, schemaVersion: 2 } }, { ...good, metadataRecords: [{ ...good.metadataRecords[0], groups: [] }] }]) expect(validBudgetMetadataSnapshot(data, "trip")).toBe(false);
});
test("pending typing is an intent buffer, promoted only after the actual grant", async () => {
  const f = await setup(), gate = deferred(), original = f.service.lease; f.service.lease = async args => args.p_action === "acquire" ? gate.promise : original(args);
  const work = f.client.focus(f.title); await Promise.resolve(); f.client.input(f.title, "First IME input");
  expect(f.title.value).toBe("Title"); expect(f.title.staged).toBe("First IME input"); expect(f.props.budgetItems[0].title).toBe("Title");
  gate.resolve({ data: { granted: true, revision: 0, epoch: 1, value: "Title", expires_at: new Date(Date.now() + 120000).toISOString() } });
  await work; expect(f.title.value).toBe("First IME input"); expect(f.client.view(f.title).writable).toBe(true);
});
test("denied pending input stays uncommittable and recoverable", async () => {
  const f = await setup(), gate = deferred(); f.service.lease = async () => gate.promise;
  const work = f.client.focus(f.title); await Promise.resolve(); f.client.input(f.title, "Staged intent"); gate.resolve({ data: { granted: false } }); await work;
  expect(f.client.view(f.title).display).toBe("Staged intent"); expect(f.title.value).toBe("Title"); expect(await f.client.save(f.title)).toBe(false);
});
test("narrow saves retain focused authority and never mutate amount or another group", async () => {
  const f = await setup(); await f.client.focus(f.title); f.client.input(f.title, "New title"); expect(await f.client.save(f.title)).toBe(true);
  expect(f.props.budgetItems[0]).toMatchObject({ title: "New title", note: "Note", amount: 900 }); expect(f.client.view(f.title).writable).toBe(true);
  expect(f.calls.some(c => c.p_action === "release")).toBe(false);
});
test("save adopts the DB canonical title and nullable cleared note", async () => {
  const f = await setup(); await f.client.focus(f.title); f.client.input(f.title, "  Trimmed title  "); expect(await f.client.save(f.title)).toBe(true);
  expect(f.client.view(f.title).display).toBe("Trimmed title"); await f.client.focus(f.note); f.client.input(f.note, "   ");
  expect(await f.client.save(f.note)).toBe(true); expect(f.client.view(f.note).display).toBe(""); expect(f.props.budgetItems[0].note).toBe(null);
});
test("dirty group survives remote updates while clean groups merge canonical values", async () => {
  const f = await setup(); await f.client.focus(f.title); f.client.input(f.title, "Keep local");
  f.props.budgetItems[0].note = "Remote note"; await f.client.refresh();
  expect(f.client.view(f.title).display).toBe("Keep local"); expect(f.client.view(f.note).display).toBe("Remote note");
});
test("same group remote revision creates conflict, not an automatic base replacement", async () => {
  const f = await setup(); await f.client.focus(f.title); f.client.input(f.title, "Local"); f.props.budgetItems[0].title = "Remote"; await f.client.refresh();
  expect(f.title.conflict).toBe(true); expect(f.title.base).toBe(0); expect(await f.client.save(f.title)).toBe(false);
  expect(await f.client.discard(f.title)).toBe(true); expect(f.title.value).toBe("Remote"); expect(f.title.base).toBe(1);
});
test("clean blur releases and dirty blur flushes before release", async () => {
  const f = await setup(); await f.client.focus(f.title); f.client.blur(f.title); await f.client.release(f.title); expect(f.title.token).toBe(null);
  await f.client.focus(f.note); f.client.input(f.note, "Draft"); f.client.blur(f.note);
  await expect.poll(() => f.note.token).toBe(null); expect(f.props.budgetItems[0].note).toBe("Draft");
});
test("real idle releases clean leases and heartbeats do not count as human activity", async () => {
  const f = await setup(); await f.client.focus(f.title); const activity = f.title.activity;
  f.advance(60000); await f.client.tick(); expect(f.title.activity).toBe(activity);
  f.advance(60001); await f.client.tick(); expect(f.title.token).toBe(null); expect(f.props.budgetItems[0].title).toBe("Title");
});
test("suspension disables writes; a fresh read alone cannot manufacture capability confirmation", async () => {
  const f = await setup(); await f.client.focus(f.title); f.client.input(f.title, "Draft"); f.client.suspend(); expect(f.client.view(f.title).writable).toBe(false);
  await f.client.reconcile(); expect(f.client.view(f.title).writable).toBe(false); await f.client.tick(); expect(f.client.view(f.title).writable).toBe(true);
});
test("expired ownership is never renewed or saved without reacquisition", async () => {
  const f = await setup(); await f.client.focus(f.title); f.client.input(f.title, "Offline"); f.advance(420001); await f.client.tick();
  expect(f.client.view(f.title).writable).toBe(false); expect(await f.client.save(f.title)).toBe(false); expect(f.client.view(f.title).display).toBe("Offline");
});
test("failed release remains retryable and cannot be reacquired until cleanup", async () => {
  const f = await setup(); await f.client.focus(f.title); const old = f.service.lease; f.service.lease = async args => args.p_action === "release" ? { error: { message: "offline" } } : old(args);
  expect(await f.client.release(f.title)).toBe(false); expect(await f.client.focus(f.title)).toBe(false); expect(f.title.token).toBeTruthy();
  f.service.lease = old; expect(await f.client.release(f.title)).toBe(true); expect(f.title.token).toBe(null);
});
test("lost acknowledgement uses the exact request id and payload for replay", async () => {
  const f = await setup(); await f.client.focus(f.title); f.client.input(f.title, "Committed"); const old = f.service.patch, calls = []; let first = true;
  f.service.patch = async args => { calls.push(args); const result = await old(args); if (first) { first = false; return { error: { message: "ack lost" } }; } return result; };
  expect(await f.client.save(f.title)).toBe(false); expect(f.title.request).toBeTruthy(); expect(await f.client.discard(f.title)).toBe(false);
  expect(await f.client.save(f.title)).toBe(true); expect(calls).toHaveLength(2); expect(calls[0]).toEqual(calls[1]); expect(f.title.base).toBe(1);
});
test("NOWAIT abort keeps the draft and requires explicit reacquisition", async () => {
  const f = await setup(); await f.client.focus(f.title); f.client.input(f.title, "Retry later"); f.service.patch = async () => ({ error: { code: "55P03" } });
  expect(await f.client.save(f.title)).toBe(false); expect(f.title.request).toBe(null); expect(f.title.state).toBe("lost"); expect(f.title.value).toBe("Retry later");
});
test("ABA context changes reject late admission and release only its original capability", async () => {
  const f = await setup(), gate = deferred(), calls = []; f.service.lease = async args => { calls.push(args); return args.p_action === "acquire" ? gate.promise : { data: { granted: true } }; };
  const work = f.client.focus(f.title); await Promise.resolve(); f.client.configure("A", "other", true, true); f.client.configure("A", "trip", true, true);
  gate.resolve({ data: { granted: true, epoch: 7, revision: 0, value: "Title", expires_at: new Date(Date.now() + 120000).toISOString() } }); await work;
  expect(f.client.view(f.client.get("budget", "id", "title")).writable).toBe(false);
  expect(calls.at(-1)).toMatchObject({ p_action: "release", p_trip_id: "trip", p_epoch: 7, p_token: calls[0].p_token });
});
test("draft persistence contains value/base only and restoration grants no authority", async () => {
  const f = await setup(); await f.client.focus(f.title); f.client.input(f.title, "Persist me");
  const payload = JSON.parse([...f.values.values()][0]); expect(Object.keys(payload).sort()).toEqual(["base", "value", "version"]);
  f.client.configure("A", "other", true, true); f.client.configure("A", "trip", true, true); await f.client.refresh();
  const restored = f.client.get("budget", "id", "title"); expect(f.client.view(restored).display).toBe("Persist me"); expect(f.client.view(restored).writable).toBe(false);
});
test("unanswered admission cannot report a confirmed release; late grant is cleaned with its epoch", async () => {
  const f = await setup({ timeoutMs: 20 }), gate = deferred(), calls = [];
  f.service.lease = async args => { calls.push(args); return args.p_action === "acquire" ? gate.promise : { data: { granted: true } }; };
  await f.client.focus(f.title); expect(await f.client.release(f.title)).toBe(false); const token = f.title.token; expect(token).toBeTruthy();
  gate.resolve({ data: { granted: true, epoch: 9, revision: 0, value: "Title", expires_at: new Date(Date.now() + 120000).toISOString() } });
  await expect.poll(() => calls.some(c => c.p_action === "release" && c.p_epoch === 9 && c.p_token === token)).toBe(true);
  await expect.poll(() => f.title.token).toBe(null); expect(f.client.view(f.title).writable).toBe(false);
});
test("viewer and disabled/unsupported protocols never attempt group admission", async () => {
  const f = await setup(); f.client.configure("A", "trip", true, false); await f.client.refresh(); expect(await f.client.focus(f.client.get("budget", "id", "title"))).toBe(false);
  f.client.configure("A", "trip", true, true); const data = (await f.transport.read("trip")).data; data.metadataProtocol.enabled = false; f.client.ingest(data);
  expect(await f.client.focus(f.client.get("budget", "id", "title"))).toBe(false); expect(f.calls).toEqual([]);
});
test("group-aware account deduplication retains two edits on the same record", () => {
  const base = { kind: "budget", resource_id: "id", user_id: "A", mode: "edit" };
  expect(primaryBudgetCollaborators([{ ...base, group_key: "title" }, { ...base, group_key: "note" }])).toHaveLength(2);
});
test("offline graph caching strips metadata authority and transient hints", () => {
  expect(withoutBudgetMetadata({ tripId: "trip", metadataVerified: true, metadataProtocol: {}, metadataRecords: [], collaboration: {}, serverNow: "now", collaborationRevision: 7, nextRefreshAt: "later" })).toEqual({ tripId: "trip" });
});

test("debounce coalesces rapid input and ignores canonical no-ops", async () => {
  const f = await setup({debounceMs:30}); await f.client.focus(f.title);
  f.client.input(f.title,"  Title  "); await new Promise(r=>setTimeout(r,45)); expect(f.patches).toHaveLength(0);
  for (const text of ["A","AB","ABC"]) f.client.input(f.title,text);
  expect(f.patches).toHaveLength(0); await expect.poll(()=>f.patches.length).toBe(1);
  expect(f.props.budgetItems[0].title).toBe("ABC");
});

test("composition suppresses debounce and blur until composition ends", async () => {
  const f=await setup({debounceMs:20}); await f.client.focus(f.title); f.client.composition(f.title,true);
  f.client.input(f.title,"京都"); f.client.blur(f.title); await new Promise(r=>setTimeout(r,35));
  expect(f.patches).toHaveLength(0); f.client.composition(f.title,false);
  await expect.poll(()=>f.title.token).toBe(null); expect(f.props.budgetItems[0].title).toBe("京都");
});

test("in-flight acknowledgement confirms only submitted revision; latest input drains serially", async () => {
  const f=await setup(), gate=deferred(), old=f.service.patch; let active=0, maximum=0, first=true;
  f.service.patch=async args=>{active++; maximum=Math.max(active,maximum); if(first){first=false;await gate.promise;} const result=await old(args); active--; return result;};
  await f.client.focus(f.title); f.client.input(f.title,"A"); const work=f.client.save(f.title);
  await expect.poll(()=>f.title.saving).toBe(true); f.client.input(f.title,"B"); f.client.input(f.title,"C");
  expect(f.client.view(f.title).acceptsIntent).toBe(true); gate.resolve(); expect(await work).toBe(true);
  expect(f.patches.map(p=>p.p_patch.title)).toEqual(["A","C"]); expect(maximum).toBe(1);
  expect(f.title.base).toBe(2); expect(f.title.value).toBe("C"); expect(f.props.budgetItems[0].title).toBe("C");
});

test("committed canonical survives a failed snapshot and is not resubmitted", async () => {
  const f=await setup(); await f.client.focus(f.title); f.client.input(f.title,"  Confirmed  "); f.reads.fail=true;
  expect(await f.client.save(f.title)).toBe(true); expect(f.title.value).toBe("Confirmed"); expect(f.title.syncPending).toBe(true);
  expect(f.title.request).toBe(null); expect(f.client.status().verified).toBe(false); expect(f.patches).toHaveLength(1);
  f.reads.fail=false; await f.client.refresh(); expect(f.title.value).toBe("Confirmed"); expect(f.title.syncPending).toBe(false); expect(f.patches).toHaveLength(1);
});

test("queued input survives successful first patch plus failed refresh", async () => {
  const f=await setup(), gate=deferred(), old=f.service.patch;
  f.service.patch=async args=>{await gate.promise;return old(args);}; await f.client.focus(f.title); f.client.input(f.title,"A");
  const work=f.client.save(f.title); await expect.poll(()=>f.title.saving).toBe(true); f.client.input(f.title,"B"); f.reads.fail=true; gate.resolve();
  expect(await work).toBe(false); expect(f.title.canonical).toBe("A"); expect(f.title.value).toBe("B"); expect(f.patches).toHaveLength(1);
  f.reads.fail=false; expect(await f.client.retry(f.title)).toBe(true); expect(f.props.budgetItems[0].title).toBe("B");
});

test("unknown result preserves original payload while newer input queues", async () => {
  const f=await setup(), old=f.service.patch; let first=true;
  f.service.patch=async args=>{const result=await old(args);if(first){first=false;return {error:{message:"lost ack"}};}return result;};
  await f.client.focus(f.title); f.client.input(f.title,"A"); expect(await f.client.save(f.title)).toBe(false);
  f.client.input(f.title,"B"); expect(await f.client.prepare("budget","id")).toBe(false); expect(f.patches).toHaveLength(1);
  expect(await f.client.retry(f.title)).toBe(true); expect(f.patches).toHaveLength(3); expect(f.patches[0]).toEqual(f.patches[1]);
  expect(f.patches[2].p_request_id).not.toBe(f.patches[0].p_request_id); expect(f.props.budgetItems[0].title).toBe("B");
});

test("transport timeout never overlaps a second patch before the original settles", async () => {
  const f=await setup({timeoutMs:15}),gate=deferred(),old=f.service.patch; let count=0;
  f.service.patch=async args=>{count++;await gate.promise;return old(args);}; await f.client.focus(f.title); f.client.input(f.title,"A");
  expect(await f.client.save(f.title)).toBe(false); expect(await f.client.save(f.title)).toBe(false); expect(count).toBe(1);
  gate.resolve(); expect(await f.client.save(f.title)).toBe(true); expect(count).toBe(1); expect(f.props.budgetItems[0].title).toBe("A");
});

test("unknown result persists an inert replay ledger without capability and survives new document session", async () => {
  const f=await setup(),old=f.service.patch; let first=true;
  f.service.patch=async args=>{const result=await old(args);if(first){first=false;return {error:{message:"ack lost"}};}return result;};
  await f.client.focus(f.title); f.client.input(f.title,"Committed"); await f.client.save(f.title);
  const payload=JSON.parse([...f.values.values()][0]); expect(payload.pending.id).toBe(f.patches[0].p_request_id);
  expect(JSON.stringify(payload)).not.toMatch(/p_token|p_epoch|token_hash/);
  const client=createBudgetMetadataEditor({service:f.service,read:trip=>f.transport.read(trip),sessionId:"new-tab",storage:f.storage}); clients.push(client);
  client.configure("A","trip",true,true); await client.refresh(); const group=client.get("budget","id","title");
  expect(client.view(group).writable).toBe(false); expect(group.request.p_token).toBe(null);
  expect(await client.retry(group)).toBe(true); expect(f.patches[1]).toMatchObject({p_request_id:payload.pending.id,p_session_id:"tab",p_token:null,p_epoch:null});
  expect(group.request).toBe(null); expect(group.value).toBe("Committed"); expect(group.base).toBe(1);
});

test("dirty prepare drains final patch before exact cleanup; failed patch cannot prepare", async () => {
  const f=await setup(); await f.client.focus(f.title); f.client.input(f.title,"Last revision");
  expect(await f.client.prepare("budget","id")).toBe(true); expect(f.props.budgetItems[0].title).toBe("Last revision");
  const epoch=f.title.epoch, token=f.title.token; expect(await f.client.close("budget","id")).toBe(true);
  expect(f.calls.at(-1)).toMatchObject({p_action:"release",p_token:token,p_epoch:epoch});
  await f.client.focus(f.title); f.client.input(f.title,""); expect(await f.client.prepare("budget","id")).toBe(false);
  expect(f.client.view(f.title).dirty).toBe(true);
});

test("invalid draft uses ten minute idle; heartbeat, snapshots and saved responses do not reset activity", async () => {
  const f=await setup(); await f.client.focus(f.title); f.client.input(f.title,""); await f.client.save(f.title);
  const activity=f.title.lastActivity; for(let i=0;i<9;i++){f.advance(60000);await f.client.tick();}
  expect(f.title.token).toBeTruthy(); expect(f.title.lastActivity).toBe(activity); expect(f.props.budgetItems[0].title).toBe("Title");
  f.advance(60001); await f.client.tick(); expect(f.title.token).toBe(null); expect(f.title.value).toBe("");
});

test("late patch after ABA cannot replace the new context or submit queued input", async () => {
  const f=await setup(),gate=deferred(),old=f.service.patch; f.service.patch=async args=>{await gate.promise;return old(args);};
  await f.client.focus(f.title); f.client.input(f.title,"Old"); const work=f.client.save(f.title); await expect.poll(()=>f.title.saving).toBe(true);
  f.client.input(f.title,"Queued old"); f.client.configure("A","other",true,true); f.client.configure("A","trip",true,true); await f.client.refresh();
  const current=f.client.get("budget","id","title"); gate.resolve(); expect(await work).toBe(false);
  expect(current.value).toBe("Queued old"); expect(current.base).toBe(0); expect(current.request.p_request_id).toBe(f.patches[0].p_request_id);
  expect(f.patches).toHaveLength(1); expect(f.client.view(current).writable).toBe(false);
});

test("unknown result at ten minute idle releases exact capability but keeps replay intent",async()=>{
  const f=await setup(),old=f.service.patch;f.service.patch=async args=>{await old(args);return {error:{message:"lost ack"}};};
  await f.client.focus(f.title); f.client.input(f.title,"Unknown committed");await f.client.save(f.title);
  const request=f.title.request;f.advance(600001);await f.client.tick();expect(f.title.token).toBe(null);expect(f.title.request).toEqual(request);
  expect(JSON.parse([...f.values.values()][0]).pending.id).toBe(request.p_request_id);
});

test("failed auth confirmation stops autosave without busy retrying or issuing a patch",async()=>{
  const f=await setup({debounceMs:20});await f.client.focus(f.title);let checks=0;
  f.service.authorized=async()=>{checks++;return false;};f.client.input(f.title,"Private draft");
  await expect.poll(()=>f.title.failed).toBe(true);await new Promise(r=>setTimeout(r,60));
  expect(checks).toBe(1);expect(f.patches).toHaveLength(0);expect(f.title.value).toBe("Private draft");expect(f.client.view(f.title).writable).toBe(false);
});

test("finish freezes both groups while flushing and releasing, preserving the last accepted revision",async()=>{
  const f=await setup(),gate=deferred(),old=f.service.lease;
  await f.client.focus(f.title);await f.client.focus(f.note);f.client.input(f.title,"Title final");f.client.input(f.note,"Note final");
  f.service.lease=async args=>{if(args.p_action==="release"&&args.p_group==="title")await gate.promise;return old(args);};
  const finish=f.client.finish("budget","id");await expect.poll(()=>f.title.releasing).toBe(true);
  f.client.input(f.note,"Too late to mutate a leaving editor");expect(f.note.value).toBe("Note final");expect(f.client.view(f.note).acceptsIntent).toBe(false);
  gate.resolve();expect(await finish).toBe(true);expect(f.props.budgetItems[0]).toMatchObject({title:"Title final",note:"Note final"});expect(f.note.token).toBe(null);
});

test("first real focus after an idle inspection starts its own activity window",async()=>{
  const f=await setup();f.advance(180000);await f.client.focus(f.title);await f.client.tick();expect(f.title.token).toBeTruthy();
  f.advance(120001);await f.client.tick();expect(f.title.token).toBe(null);
});

const drain = async () => { for (let i=0;i<30;i++) await Promise.resolve(); };
test("confirmed patch plus permanently pending snapshot times out without losing queued input",async()=>{
  const f=await setup();await f.client.focus(f.title);mock.timers.enable({apis:["setTimeout"]});
  try {
    f.reads.gate=deferred();f.client.input(f.title,"A");let settled=false;
    const work=f.client.save(f.title).then(ok=>{settled=true;return ok;});await drain();
    expect(f.title.canonical).toBe("A");expect(f.title.request).toBe(null);f.client.input(f.title,"B");
    mock.timers.tick(budgetAuthorityTimeoutMs+1);await drain();
    expect(f.title.canonical).toBe("A");expect(f.title.value).toBe("B");expect(f.patches).toHaveLength(1);
    expect(settled).toBe(true);expect(await work).toBe(false);expect(f.title.saveWork).toBe(null);
    expect(f.client.status().verified).toBe(false);
  }finally{mock.timers.reset();}
});

async function pendingConfirmed(f) {
  const gate=deferred();f.reads.gate=gate;f.client.input(f.title,"A");const work=f.client.save(f.title);await drain();
  expect(f.title.canonical).toBe("A");const captured=await f.transport.read("trip");f.client.input(f.title,"B");
  return {gate,work,captured};
}
test("timeout retires readWork, concurrent explicit retries share authority and latest queued patch",async()=>{
  const f=await setup();await f.client.focus(f.title);mock.timers.enable({apis:["setTimeout"]});
  try {
    const p=await pendingConfirmed(f);mock.timers.tick(budgetAuthorityTimeoutMs+1);await drain();expect(await p.work).toBe(false);
    f.reads.gate=null;const retry=f.client.retry(f.title), same=f.client.retry(f.title);await drain();expect(await retry).toBe(true);expect(await same).toBe(true);
    expect(f.patches.map(p=>p.p_patch.title)).toEqual(["A","B"]);expect(f.title.base).toBe(2);expect(f.title.value).toBe("B");
    expect(f.calls.filter(c=>c.p_action==="acquire")).toHaveLength(2);expect(f.title.saveWork).toBe(null);
    p.gate.resolve(p.captured);await drain();expect(f.title.value).toBe("B");expect(f.title.canonical).toBe("B");expect(f.title.remote.revision).toBe(2);
    expect(f.client.status().snapshot.budgetItems[0].title).toBe("B");expect(f.client.status().verified).toBe(true);
  }finally{mock.timers.reset();}
});

test("controller timeout also retires the actual coalescer slot; late transport cannot apply a financial graph",async()=>{
  const f=await setup();await f.client.focus(f.title);const guard=createRequestGuard();guard.setContext("A:trip");
  const gate=deferred(),applied=[],errors=[];let held=true,reads=0;
  const sync=createBudgetRefresh({guard,timeoutMs:budgetAuthorityTimeoutMs,read:()=>{reads++;return held?gate.promise:f.transport.read("trip");},
    apply:data=>applied.push(data.budgetItems[0].title),onError:error=>{errors.push(error);f.client.invalidate(error.message);}});
  f.reads.delegate=()=>sync.committed();mock.timers.enable({apis:["setTimeout"]});
  try {
    f.client.input(f.title,"A");const work=f.client.save(f.title);await drain();const captured=await f.transport.read("trip");f.client.input(f.title,"B");
    mock.timers.tick(budgetAuthorityTimeoutMs+1);await drain();expect(await work).toBe(false);expect(errors).toHaveLength(1);expect(reads).toBe(1);
    held=false;expect(await f.client.retry(f.title)).toBe(true);expect(reads).toBe(3);expect(applied).toEqual(["A","B"]);
    gate.resolve(captured);await drain();expect(applied).toEqual(["A","B"]);expect(f.title.value).toBe("B");expect(f.patches).toHaveLength(2);
  }finally{mock.timers.reset();sync.cancel();}
});

test("another editor's newer version wins after timeout; queued B stays a conflicted draft",async()=>{
  const f=await setup();await f.client.focus(f.title);mock.timers.enable({apis:["setTimeout"]});
  try {
    const p=await pendingConfirmed(f);mock.timers.tick(budgetAuthorityTimeoutMs+1);await drain();await p.work;
    f.reads.gate=null;f.props.budgetItems[0].title="Other editor";
    expect(await f.client.retry(f.title)).toBe(false);expect(f.title.conflict).toBe(true);expect(f.title.value).toBe("B");expect(f.title.base).toBe(1);
    expect(f.patches).toHaveLength(1);expect(f.calls.filter(c=>c.p_action==="acquire")).toHaveLength(1);
    p.gate.resolve(p.captured);await drain();expect(f.title.remote.value).toBe("Other editor");expect(f.title.conflict).toBe(true);
  }finally{mock.timers.reset();}
});

test("pending snapshot cannot strand dirty prepare or finish; discard requires an explicit decision",async()=>{
  const f=await setup();await f.client.focus(f.title);mock.timers.enable({apis:["setTimeout"]});
  try {
    const p=await pendingConfirmed(f);const exit=f.client.prepare("budget","id");
    mock.timers.tick(budgetAuthorityTimeoutMs+1);await drain();expect(await p.work).toBe(false);expect(await exit).toBe(false);
    expect(await f.client.finish("budget","id")).toBe(false);expect(f.title.value).toBe("B");expect(f.title.exiting).toBe(false);
    const token=f.title.token,epoch=f.title.epoch;expect(await f.client.discard(f.title)).toBe(true);
    expect(f.title.value).toBe("A");expect(f.calls.at(-1)).toMatchObject({p_action:"release",p_token:token,p_epoch:epoch});
    p.gate.resolve(p.captured);await drain();expect(f.title.value).toBe("A");expect(f.title.token).toBe(null);
  }finally{mock.timers.reset();}
});

test("clean confirmed patch can finish after snapshot deadline without submitting again",async()=>{
  const f=await setup();await f.client.focus(f.title);mock.timers.enable({apis:["setTimeout"]});
  try {
    f.reads.gate=deferred();f.client.input(f.title,"A");const work=f.client.save(f.title);await drain();const exit=f.client.finish("budget","id");
    mock.timers.tick(budgetAuthorityTimeoutMs+1);await drain();expect(await work).toBe(true);expect(await exit).toBe(true);
    expect(f.title.value).toBe("A");expect(f.title.token).toBe(null);expect(f.title.syncPending).toBe(true);expect(f.patches).toHaveLength(1);
  }finally{mock.timers.reset();}
});

for(const target of ["trip","account","logout"])test(`${target} context isolates a late pending snapshot before or after its deadline`,async()=>{
  const f=await setup();await f.client.focus(f.title);mock.timers.enable({apis:["setTimeout"]});
  try {
    const p=await pendingConfirmed(f);f.reads.gate=null;
    if(target==="logout")f.client.configure(null,null,false,false);
    else {f.props.currentUserId=target==="account"?"B":"A";f.client.configure(f.props.currentUserId,target==="trip"?"other":"trip",true,true);await f.client.refresh();}
    const status=f.client.status(),version=f.client.getVersion();p.gate.resolve(p.captured);await drain();expect(await p.work).toBe(false);
    expect(f.client.status().snapshot).toBe(status.snapshot);expect(f.client.status().verified).toBe(status.verified);expect(f.client.getVersion()).toBe(version);
    expect(f.patches).toHaveLength(1);
  }finally{mock.timers.reset();}
});

test("offline after snapshot timeout keeps B and reconnect needs fresh read plus confirmed lease",async()=>{
  const f=await setup();await f.client.focus(f.title);mock.timers.enable({apis:["setTimeout"]});
  try {
    const p=await pendingConfirmed(f);mock.timers.tick(budgetAuthorityTimeoutMs+1);await drain();await p.work;f.client.suspend();f.reads.gate=null;
    expect(await f.client.retry(f.title)).toBe(false);expect(f.patches).toHaveLength(1);
    await f.client.reconcile();expect(f.client.view(f.title).writable).toBe(false);expect(f.title.value).toBe("B");expect(f.patches).toHaveLength(1);
    expect(await f.client.retry(f.title)).toBe(true);expect(f.props.budgetItems[0].title).toBe("B");expect(f.title.base).toBe(2);
    p.gate.resolve(p.captured);await drain();expect(f.client.status().verified).toBe(true);
  }finally{mock.timers.reset();}
});
