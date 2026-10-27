import { expect, test } from "@playwright/test";
import { createBudgetEditLeaseClient } from "../src/lib/budgetEditLeases.js";
import { persistBudgetWorkspace } from "../src/lib/budgetWorkspaceService.js";

function fixture() {
  let now = 0, serial = 0;
  const rows = { item: { id: "item", trip_id: "trip", title: "Keep draft", updated_at: "version-1" }, other: { id: "other", trip_id: "other-trip", updated_at: "version-2" } };
  const held = new Map(), calls = [], timers = new Set();
  const server = { rows, held, calls, timers, offline: false, hold: null, authReads: 0, advance(ms) { now += ms; },
    client(actor = "A") {
      const identity = { actor };
      const supabase = {
        auth: { async getSession() { server.authReads++; return { data: { session: { user: { id: identity.actor } } } }; } },
        async rpc(name, args) {
          calls.push({ actor: identity.actor, name, args });
          expect(name).toBe("budget_edit_lease");
          if (server.offline) return { error: { message: "offline" } };
          const key = `${args.p_kind}:${args.p_id}`, previous = held.get(key);
          const owns = previous?.actor === identity.actor && previous?.session === args.p_session_id && previous?.token === args.p_token;
          let data;
          if (args.p_action === "release") { if (owns) held.delete(key); data = { granted: true }; }
          else if (args.p_action === "renew" && (!owns || previous.expires <= now)) data = { granted: false, reason: "lease_lost" };
          else if (args.p_action === "acquire" && previous?.expires > now && !owns) data = { granted: false, reason: "locked" };
          else {
            held.set(key, { actor: identity.actor, session: args.p_session_id, token: args.p_token, expires: now + 420000 });
            data = { granted: true, record: structuredClone(rows[args.p_id]), expires_at: new Date(now + 420000).toISOString() };
          }
          if (server.hold?.action === args.p_action) await server.hold.promise;
          return { data, error: null };
        },
      };
      const client = createBudgetEditLeaseClient({ supabase, makeId: () => `capability-${++serial}`, setTimer: fn => { timers.add(fn); return fn; }, clearTimer: fn => timers.delete(fn) });
      client.configure(actor, "trip");
      return { client, identity };
    },
  };
  return server;
}

test("same-account tabs have distinct capabilities; loser cannot release winner", async () => {
  const db = fixture(), a = db.client(), b = db.client();
  expect((await a.client.acquire("budget_items", db.rows.item, "A")).lockedByAnotherUser).toBe(false);
  expect((await b.client.acquire("budget_items", db.rows.item, "A")).lockedByAnotherUser).toBe(true);
  await b.client.release("budget_items", "item", "A");
  expect((await a.client.ensure("budget_items", "item", "A")).ok).toBe(true);
  await a.client.dispose(); await b.client.dispose(); expect(db.held.size).toBe(0); expect(db.timers.size).toBe(0);
});

test("a restored draft with no in-memory capability is unconfirmed until acquisition", async () => {
  const db=fixture(),a=db.client(),b=db.client(),states=[];
  b.client.watch("budget_items","item",value=>states.push(value));
  expect(states.at(-1)).toBe(true);
  await a.client.acquire("budget_items",db.rows.item,"A");
  await b.client.acquire("budget_items",db.rows.item,"A");
  expect(states.at(-1)).toBe(true);
  await a.client.release("budget_items","item","A");
  await b.client.acquire("budget_items",db.rows.item,"A");expect(states.at(-1)).toBe(false);
  await a.client.dispose();await b.client.dispose();
});

test("twelve one-minute renewals retain ownership without financial row writes", async () => {
  const db = fixture(), { client } = db.client(), original = structuredClone(db.rows);
  await client.acquire("budget_items", db.rows.item, "A");
  for (let i = 0; i < 12; i++) { db.advance(60000); await client.reconcile(); }
  expect((await client.ensure("budget_items", "item", "A")).ok).toBe(true);
  expect(db.rows).toEqual(original); expect(db.calls.every(call => call.name === "budget_edit_lease")).toBe(true);
  await client.dispose();
});

test("expired owner cannot renew/save or release a later holder", async () => {
  const db = fixture(), a = db.client(), b = db.client("B"), statuses = [];
  await a.client.acquire("budget_items", db.rows.item, "A"); a.client.watch("budget_items", "item", value => statuses.push(value));
  db.advance(480000);
  expect((await a.client.ensure("budget_items", "item", "A")).ok).toBe(false);
  expect(statuses.at(-1)).toBe(true);
  expect((await b.client.acquire("budget_items", db.rows.item, "B")).error).toBeNull();
  await a.client.release("budget_items", "item", "A");
  expect((await b.client.ensure("budget_items", "item", "B")).ok).toBe(true);
  await a.client.dispose(); await b.client.dispose();
});

test("transient offline ownership is unconfirmed until a server renewal succeeds", async () => {
  const db = fixture(), { client } = db.client(), statuses = [];
  await client.acquire("budget_items", db.rows.item, "A"); client.watch("budget_items", "item", value => statuses.push(value));
  db.offline = true; expect((await client.ensure("budget_items", "item", "A")).ok).toBe(false); expect(statuses.at(-1)).toBe(true);
  db.offline = false; await client.reconcile(); expect(statuses.at(-1)).toBe(false);
  await client.dispose();
});

test("a delayed acquire cannot populate a later trip A generation or clear its new lease", async () => {
  const db = fixture(), { client } = db.client(); let release;
  db.hold = { action: "acquire", promise: new Promise(resolve => { release = resolve; }) };
  const old = client.acquire("budget_items", db.rows.item, "A");
  client.configure("A", "other-trip"); await client.flushReleases();
  client.configure("A", "trip"); await client.flushReleases();
  db.hold = null; await client.acquire("budget_items", db.rows.item, "A");
  release(); expect((await old).error).toBeTruthy();
  expect((await client.ensure("budget_items", "item", "A")).ok).toBe(true);
  await client.dispose();
});

test("account switches never send A cleanup using B credentials", async () => {
  const db = fixture(), { client, identity } = db.client();
  await client.acquire("budget_items", db.rows.item, "A");
  identity.actor = "B"; client.configure("B", "trip"); await client.flushReleases();
  expect((await client.ensure("budget_items", "item", "A")).ok).toBe(false);
  expect(db.calls.filter(call => call.actor === "B")).toEqual([]);
  await client.dispose();
});

test("temporary action lease is released even when its operation throws", async () => {
  const db = fixture(), { client } = db.client();
  await expect(client.withLease("budget_items", db.rows.item, "A", async meta => {
    expect(meta.leaseProtocol).toBe(true); expect(meta.editLease.token).toBeTruthy(); throw new Error("write failed");
  })).rejects.toThrow("write failed");
  expect(db.held.size).toBe(0); expect(db.timers.size).toBe(0); await client.dispose();
});

test("empty/Demo controller makes no auth call on cleanup", async () => {
  const db = fixture(), { client } = db.client(); await client.dispose();
  expect(db.calls).toEqual([]); expect(db.authReads).toBe(0);
});

test("Formal save forwards capability outside financial payload and fails closed without fallback", async () => {
  const calls = [], supabase = { rpc: async (name, args) => { calls.push({ name, args }); return { error: { code: "PGRST202" } }; } };
  const result = await persistBudgetWorkspace({ supabase, tripId: "trip", reload: async () => { throw Error("must not reload"); } }, "budget", { title: "draft", unified_planning: true }, "item", { leaseProtocol: true, editLease: { sessionId: "tab", token: "secret-capability" }, operationId: "retry-id", baseUpdatedAt: "v1" });
  expect(result.ok).toBe(false); expect(calls).toHaveLength(1); expect(calls[0].name).toBe("save_budget_workspace_record_v4");
  expect(calls[0].args.p_edit_token).toBe("secret-capability"); expect(calls[0].args.p_request_id).toBe("retry-id");
  expect(JSON.stringify(calls[0].args.p_payload)).not.toContain("secret-capability");
});
