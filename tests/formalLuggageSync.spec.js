import { expect, test } from "@playwright/test";

async function boot(page) {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", request => {
    if (/\/auth\/v1\/|\/rest\/v1\/|\/realtime\/v1\//.test(request.url())) errors.push(`Unexpected hosted request: ${request.url()}`);
  });
  page.qaErrors = errors;
  // Observe the real guard without changing its public behavior or App source.
  await page.route(/\/src\/lib\/luggageSync\.js(?:\?t=\d+)?$/, route => route.fulfill({ contentType: "text/javascript", body: `
    export * from "/src/lib/luggageSync.js?original";
    import { createRequestGuard as original } from "/src/lib/luggageSync.js?original";
    export function createRequestGuard() {
      const guard = original(), begin = guard.begin;
      guard.begin = function(scope) {
        const token = begin.call(this, scope);
        window.formalLuggageMock.tokens.push(token);
        window.formalLuggageMock.guard = this;
        return token;
      };
      return guard;
    }
  ` }));
  await page.route("**/src/lib/supabase.js*", route => route.fulfill({ contentType: "text/javascript", body: "export const hasSupabaseConfig = true; export const supabase = window.formalLuggageMock.client;" }));
  await page.addInitScript(() => {
    const trip = { id: "trip", title: "Formal QA", name: "Formal QA", status: "planning", destination: "Japan", start_date: "2090-04-05", end_date: "2090-04-10", owner_id: "A" };
    const members = ["A", "B"].map(user_id => ({ id: `member-${user_id}`, trip_id: "trip", user_id, role: user_id === "A" ? "owner" : "viewer", status: "approved", display_name: user_id }));
    const base = { trip_id: "trip", category: "證件", updated_at: "2026-10-26T00:00:00.000000+00:00" };
    const rows = { luggage_items: ["A", "B"].map(owner_id => ({ ...base, id: `private-${owner_id}`, title: `${owner_id} private`, notes: `${owner_id} secret notes`, owner_id, packed: false })), shared_luggage_items: [{ ...base, id: "shared", title: "Team gear", assigned_to: "A", packed_by_assignee: false }] };
    const otherTrip = { ...trip, id: "other", title: "Other QA", name: "Other QA" };
    const allMembers = [...members, ...members.map(m => ({ ...m, id: `${m.id}-other`, trip_id: "other" }))];
    rows.luggage_items.push(...rows.luggage_items.map(r => ({ ...r, id: `${r.id}-other`, trip_id: "other", title: `${r.owner_id} other private` })));
    rows.shared_luggage_items.push({ ...rows.shared_luggage_items[0], id: "shared-other", trip_id: "other", title: "Other gear" });
    for (const userId of ["A", "B"]) localStorage.setItem(`travel-planner-session-context:${userId}`, JSON.stringify({ activeTripId: "trip", activeSection: "luggage", luggageTab: "personal" }));
    let actor = "A";
    const callbacks = [], channels = [];
    const mock = window.formalLuggageMock = { reads: [], tokens: [], pending: [], holdA: false, hold: null, offline: false, rows };
    const session = () => ({ user: { id: actor, email: `${actor}@qa.invalid`, user_metadata: { full_name: actor } }, access_token: "qa-not-a-real-token" });
    mock.switchAccount = next => { actor = next; callbacks.forEach(callback => callback("SIGNED_IN", session())); };
    mock.release = () => { mock.pending.splice(0).forEach(resolve => resolve()); };
    // Retain a real callback even after removeChannel: emulate an already queued event.
    mock.captureReload = () => channels.filter(c => !c.closed && c.name.startsWith("trip-")).at(-1).handlers.find(h => h.config.table === "budget_items").callback;
    mock.emit = table => channels.filter(c => !c.closed).forEach(c => c.handlers.filter(h => h.type === "postgres_changes" && h.config.table === table).forEach(h => h.callback({ eventType: "UPDATE" })));
    mock.client = {
      auth: { getSession: async () => ({ data: { session: session() } }), onAuthStateChange(callback) { callbacks.push(callback); return { data: { subscription: { unsubscribe() {} } } }; }, signOut: async () => { callbacks.forEach(c => c("SIGNED_OUT", null)); return {}; } },
      from(table) {
        const filters = []; let columns = "", single = false;
        const query = {
          select(value = "*") { columns = value; return this; }, eq(k, v) { filters.push([k, v]); return this; }, order() { return this; }, maybeSingle() { single = true; return this; }, in() { return this; },
          then(resolve, reject) {
            const user = actor;
            const tripId = filters.find(([k]) => k === "trip_id")?.[1];
            mock.reads.push({ table, user, tripId });
            let data = table === "trip_members" ? columns.includes("trips(") ? allMembers.map(m => ({ ...m, trips: m.trip_id === "other" ? otherTrip : trip })) : allMembers : rows[table] || [];
            data = data.filter(row => filters.every(([k, v]) => row[k] === v));
            if (table === "luggage_items") data = data.filter(row => row.owner_id === user);
            const result = structuredClone({ data: single ? data[0] || null : data, error: mock.offline ? { message: "offline" } : null });
            const held = user === "A" && table === "luggage_items" && mock.holdA
              || mock.hold?.user === user && mock.hold?.tripId === tripId && table === (mock.hold.table || "itinerary_items");
            const wait = held ? new Promise(r => mock.pending.push(r)) : Promise.resolve();
            return wait.then(() => result).then(resolve, reject);
          },
        }; return query;
      },
      async rpc(name, args) {
        if (name !== "mutate_luggage_item") return { data: null, error: null };
        const row = rows[args.p_scope === "personal" ? "luggage_items" : "shared_luggage_items"].find(r => r.id === args.p_item_id);
        Object.assign(row, args.p_payload, { updated_at: new Date().toISOString() });
        return { data: structuredClone(row), error: null };
      },
      channel(name) {
        const c = { name, closed: false, handlers: [], on(type, config, callback) { this.handlers.push({ type, config, callback }); return this; }, subscribe(callback) { queueMicrotask(() => callback?.("SUBSCRIBED")); return this; }, presenceState() { return {}; }, track: async () => "ok", untrack: async () => "ok", send: async () => "ok" };
        channels.push(c); return c;
      },
      removeChannel: async channel => { channel.closed = true; },
    };
  });
  await page.goto("/tests/harness/formal-luggage.html");
  await expect(page.getByRole("button", { name: "編輯：A private", exact: true })).toBeVisible();
  // Let the controlled 80ms initial subscription/entry refresh settle.
  await page.waitForTimeout(200);
}

test.afterEach(async ({ page }) => { expect(page.qaErrors).toEqual([]); });

test("real App rejects delayed A responses after switching to B in the same trip", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { formalLuggageMock.holdA = true; window.dispatchEvent(new Event("focus")); });
  await expect.poll(() => page.evaluate(() => formalLuggageMock.pending.length)).toBeGreaterThan(0);
  await page.evaluate(() => formalLuggageMock.switchAccount("B"));
  await expect(page.getByRole("button", { name: "編輯：B private", exact: true })).toBeVisible();
  await page.evaluate(() => formalLuggageMock.release());
  await expect(page.getByRole("button", { name: "編輯：A private", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => Object.values(localStorage).filter(v => v.includes("A secret notes")))).toEqual([]);
});

test("real App private mutations read zero tables; shared event bursts read only the shared table", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { formalLuggageMock.reads = []; });
  await page.getByRole("checkbox", { name: "準備：A private", exact: true }).check();
  await expect(page.getByRole("checkbox", { name: "準備：A private", exact: true })).toBeChecked();
  expect(await page.evaluate(() => formalLuggageMock.reads)).toEqual([]);
  await page.evaluate(() => {
    formalLuggageMock.rows.shared_luggage_items[0].title = "Team updated";
    for (let i = 0; i < 20; i++) formalLuggageMock.emit("shared_luggage_items");
    formalLuggageMock.emit("luggage_items");
  });
  await expect(page.getByRole("button", { name: "編輯指派共用物品：Team updated", exact: true })).toBeVisible();
  await expect(page.locator("#lb-shared").getByRole("button", { name: "編輯：Team updated", exact: true })).toBeVisible();
  expect(await page.evaluate(() => formalLuggageMock.reads.map(r => r.table))).toEqual(["shared_luggage_items"]);
});

test("older full loads cannot roll back a successful shared RPC or its offline snapshot", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { formalLuggageMock.holdA = true; formalLuggageMock.emit("budget_items"); });
  await expect.poll(() => page.evaluate(() => formalLuggageMock.pending.length)).toBeGreaterThan(0);
  const check = page.locator("#lb-shared").getByRole("checkbox", { name: "成員已備妥：Team gear", exact: true });
  await check.check();
  await page.evaluate(() => { formalLuggageMock.holdA = false; formalLuggageMock.release(); });
  await expect(check).toBeChecked();
  await page.evaluate(() => { formalLuggageMock.offline = true; formalLuggageMock.emit("budget_items"); });
  await expect(page.getByText("目前使用已快取的離線資料；重新連線後會自動更新。", { exact: true })).toBeVisible();
  await expect(check).toBeChecked();
  await expect(page.getByRole("button", { name: "編輯：A private", exact: true })).toBeVisible();
});

async function expectObsoleteCallbackIgnored(page) {
  // The destination full load is blocked at itinerary_items, not merely an old
  // response delayed until after the switch. Local refresh timers have settled.
  await expect.poll(() => page.evaluate(() => formalLuggageMock.pending.length)).toBeGreaterThan(0);
  await page.waitForTimeout(200);
  const result = await page.evaluate(async () => {
    const m = formalLuggageMock;
    const token = m.tokens.filter(t => t.scope === "trip").at(-1);
    const before = m.tokens.length, readsBefore = m.reads.length;
    const validBefore = m.guard.valid(token);
    m.staleReload(); // Actual retained Realtime callback runs while B is pending.
    await Promise.resolve();
    return { validBefore, validAfter: m.guard.valid(token), newTokens: m.tokens.slice(before), newReads: m.reads.slice(readsBefore) };
  });
  expect(result.validBefore).toBe(true);
  expect(result.newTokens).toEqual([]); // trip/personal/shared sequences unchanged
  expect(result.newReads).toEqual([]);
  expect(result.validAfter).toBe(true);
  await page.evaluate(() => { formalLuggageMock.hold = null; formalLuggageMock.release(); });
}

test("late trip A callback cannot invalidate trip B's pending full load", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    formalLuggageMock.staleReload = formalLuggageMock.captureReload();
    formalLuggageMock.hold = { user: "A", tripId: "other" };
  });
  await page.getByRole("button", { name: "Other QA", exact: true }).click();
  await expectObsoleteCallbackIgnored(page);
  await expect(page.getByRole("button", { name: "編輯：A other private", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "編輯：A private", exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => Object.values(localStorage).some(v => v.includes('"Other gear"') && v.includes('"members"')))).toBe(true);
  await page.screenshot({ path: test.info().outputPath("trip-b-loaded.png") });
});

test("late account A callback in the same trip cannot invalidate account B's pending full load", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    formalLuggageMock.staleReload = formalLuggageMock.captureReload();
    formalLuggageMock.hold = { user: "B", tripId: "trip" };
    formalLuggageMock.switchAccount("B");
  });
  await expectObsoleteCallbackIgnored(page);
  await expect(page.getByRole("button", { name: "編輯：B private", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "編輯：A private", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => Object.values(localStorage).some(v => v.includes("A secret notes")))).toBe(false);
});

for (const kind of ["trip", "account"]) {
  test(`late callback from an earlier ${kind} A generation is rejected after A -> B -> A`, async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { formalLuggageMock.staleReload = formalLuggageMock.captureReload(); });
    if (kind === "trip") {
      await page.getByRole("button", { name: "Other QA", exact: true }).click();
      await expect(page.getByRole("button", { name: "編輯：A other private", exact: true })).toBeVisible();
    } else {
      await page.evaluate(() => formalLuggageMock.switchAccount("B"));
      await expect(page.getByRole("button", { name: "編輯：B private", exact: true })).toBeVisible();
    }
    await page.evaluate(() => { formalLuggageMock.hold = { user: "A", tripId: "trip" }; });
    if (kind === "trip") await page.getByRole("button", { name: "Formal QA", exact: true }).click();
    else await page.evaluate(() => formalLuggageMock.switchAccount("A"));
    await expectObsoleteCallbackIgnored(page);
    await expect(page.getByRole("button", { name: "編輯：A private", exact: true })).toBeVisible();
  });

  test(`in-flight full-load token from ${kind} A stays obsolete after A -> B -> A`, async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      const m = formalLuggageMock;
      m.hold = { user: "A", tripId: "trip" };
      m.captureReload()();
      m.oldToken = m.tokens.filter(t => t.scope === "trip").at(-1);
    });
    await expect.poll(() => page.evaluate(() => formalLuggageMock.pending.length)).toBeGreaterThan(0);
    if (kind === "trip") {
      await page.getByRole("button", { name: "Other QA", exact: true }).click();
      await expect(page.getByRole("button", { name: "編輯：A other private", exact: true })).toBeVisible();
    } else {
      await page.evaluate(() => formalLuggageMock.switchAccount("B"));
      await expect(page.getByRole("button", { name: "編輯：B private", exact: true })).toBeVisible();
    }
    await page.evaluate(() => {
      const m = formalLuggageMock;
      m.hold = null; // Old result remains pending; subsequent reads see new data.
      m.rows.luggage_items.find(r => r.id === "private-A").title = "A fresh";
      m.rows.shared_luggage_items[0].title = "Fresh gear";
    });
    if (kind === "trip") await page.getByRole("button", { name: "Formal QA", exact: true }).click();
    else await page.evaluate(() => formalLuggageMock.switchAccount("A"));
    await expect(page.getByRole("button", { name: "編輯：A fresh", exact: true })).toBeVisible();
    expect(await page.evaluate(() => formalLuggageMock.guard.valid(formalLuggageMock.oldToken))).toBe(false);
    await page.evaluate(() => formalLuggageMock.release());
    await expect(page.getByRole("button", { name: "編輯：A fresh", exact: true })).toBeVisible();
    await expect(page.locator("#lb-shared").getByRole("button", { name: "編輯：Fresh gear", exact: true })).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("travel-planner-offline-v2:A:trip:trip")).payload.sharedLuggageItems[0].title)).toBe("Fresh gear");
  });
}

test("logout clears trip data and rejects late callbacks and pending responses", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const m = formalLuggageMock;
    m.staleReload = m.captureReload();
    m.hold = { user: "A", tripId: "trip" };
    m.staleReload();
  });
  await expect.poll(() => page.evaluate(() => formalLuggageMock.pending.length)).toBeGreaterThan(0);
  await page.evaluate(() => formalLuggageMock.client.auth.signOut());
  await expect(page.getByRole("button", { name: /Google/ })).toBeVisible();
  expect(await page.evaluate(() => formalLuggageMock.guard.context().key)).toBe(null);
  const newTokens = await page.evaluate(() => {
    const m = formalLuggageMock, before = m.tokens.length;
    m.staleReload(); m.hold = null; m.release();
    return m.tokens.slice(before);
  });
  expect(newTokens).toEqual([]);
  await expect(page.locator("#lb-personal, #lb-shared")).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("travel-planner-offline")))).toEqual([]);
  // A fresh account must start from its own data after the null clear path.
  await page.evaluate(() => {
    formalLuggageMock.hold = { user: "B", tripId: "trip", table: "luggage_items" };
    formalLuggageMock.switchAccount("B");
  });
  await expect.poll(() => page.evaluate(() => formalLuggageMock.pending.length)).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "編輯：A private", exact: true })).toHaveCount(0);
  await page.evaluate(() => { formalLuggageMock.hold = null; formalLuggageMock.release(); });
  await expect(page.getByRole("button", { name: "編輯：B private", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "編輯：A private", exact: true })).toHaveCount(0);
});
