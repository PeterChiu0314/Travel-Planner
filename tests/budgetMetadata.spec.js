import { expect, test } from "@playwright/test";
import { createBudgetMetadataEditor, validBudgetMetadataSnapshot, withoutBudgetMetadata } from "../src/lib/budgetMetadataService.js";
import { createDemoBudgetMetadataService } from "../src/demo/budgetMetadata.js";
import { primaryBudgetCollaborators } from "../src/lib/budgetCollaboration.js";
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function setup(options = {}) {
  let time = Date.now(), serial = 0;
  const values = new Map(), storage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  const props = { currentUserId: "A", activeTrip: { id: "trip" }, budgetItems: [{ id: "id", trip_id: "trip", title: "Title", note: "Note", currency: "TWD", amount: 900 }], actualExpenses: [],
    onSaveMetadata(kind, id, group, value) { props.budgetItems[0] = { ...props.budgetItems[0], [group]: value }; } };
  const transport = createDemoBudgetMetadataService(() => props, () => time), calls = [];
  const service = { ...transport, lease: async args => { calls.push(args); return transport.lease(args); } };
  const client = createBudgetMetadataEditor({ service, read: trip => transport.read(trip), sessionId: "tab", now: () => time, makeId: () => `token-${++serial}`, storage, ...options });
  client.configure("A", "trip", true, true); await client.refresh();
  return { client, props, calls, service, transport, values, storage, title: client.get("budget", "id", "title"), note: client.get("budget", "id", "note"), advance: ms => { time += ms; } };
}
test("initial inspection has no authority; snapshot readiness/schema are strictly checked", async () => {
  const f = await setup(); expect(f.calls).toEqual([]); expect(f.client.view(f.title).writable).toBe(false);
  const good = (await f.transport.read("trip")).data; expect(validBudgetMetadataSnapshot(good, "trip")).toBe(true);
  for (const data of [{ ...good, tripId: "other" }, { ...good, metadataProtocol: { ...good.metadataProtocol, schemaVersion: 2 } }, { ...good, metadataRecords: [{ ...good.metadataRecords[0], groups: [] }] }]) expect(validBudgetMetadataSnapshot(data, "trip")).toBe(false);
});
test("pending typing is an intent buffer, promoted only after the actual grant", async () => {
  const f = await setup(), gate = deferred(), original = f.service.lease; f.service.lease = async args => args.p_action === "acquire" ? gate.promise : original(args);
  const work = f.client.focus(f.title); await Promise.resolve(); f.client.input(f.title, "First IME input");
  expect(f.title.value).toBe("Title"); expect(f.title.staged).toBe("First IME input"); expect(await f.client.save(f.title)).toBe(false);
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
test("clean blur releases and dirty blur retains recoverable input", async () => {
  const f = await setup(); await f.client.focus(f.title); f.client.blur(f.title); await f.client.release(f.title); expect(f.title.token).toBe(null);
  await f.client.focus(f.note); f.client.input(f.note, "Draft"); f.client.blur(f.note); expect(f.note.token).toBeTruthy(); expect(f.client.view(f.note).dirty).toBe(true);
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
