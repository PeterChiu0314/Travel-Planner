import { expect, test } from "@playwright/test";

async function boot(page) {
  await page.route("**/src/lib/supabase.js*", route => route.fulfill({ contentType: "text/javascript", body: "export const hasSupabaseConfig = true; export const supabase = window.formalLuggageMock.client;" }));
  await page.addInitScript(() => {
    const trip = { id: "trip", title: "Formal QA", name: "Formal QA", status: "planning", destination: "Japan", start_date: "2090-04-05", end_date: "2090-04-10", owner_id: "A" };
    const members = ["A", "B"].map(user_id => ({ id: `member-${user_id}`, trip_id: "trip", user_id, role: user_id === "A" ? "owner" : "viewer", status: "approved", display_name: user_id }));
    const base = { trip_id: "trip", category: "證件", updated_at: "2026-10-26T00:00:00.000000+00:00" };
    const rows = { luggage_items: ["A", "B"].map(owner_id => ({ ...base, id: `private-${owner_id}`, title: `${owner_id} private`, notes: `${owner_id} secret notes`, owner_id, packed: false })), shared_luggage_items: [{ ...base, id: "shared", title: "Team gear", assigned_to: "A", packed_by_assignee: false }] };
    for (const userId of ["A", "B"]) localStorage.setItem(`travel-planner-session-context:${userId}`, JSON.stringify({ activeTripId: "trip", activeSection: "luggage", luggageTab: "personal" }));
    let actor = "A";
    const callbacks = [], channels = [];
    const mock = window.formalLuggageMock = { reads: [], pending: [], holdA: false, offline: false, rows };
    const session = () => ({ user: { id: actor, email: `${actor}@qa.invalid`, user_metadata: { full_name: actor } }, access_token: "qa-not-a-real-token" });
    mock.switchAccount = next => { actor = next; callbacks.forEach(callback => callback("SIGNED_IN", session())); };
    mock.release = () => { mock.pending.splice(0).forEach(resolve => resolve()); };
    mock.emit = table => channels.filter(c => !c.closed).forEach(c => c.handlers.filter(h => h.type === "postgres_changes" && h.config.table === table).forEach(h => h.callback({ eventType: "UPDATE" })));
    mock.client = {
      auth: { getSession: async () => ({ data: { session: session() } }), onAuthStateChange(callback) { callbacks.push(callback); return { data: { subscription: { unsubscribe() {} } } }; }, signOut: async () => { callbacks.forEach(c => c("SIGNED_OUT", null)); return {}; } },
      from(table) {
        const filters = []; let columns = "", single = false;
        const query = {
          select(value = "*") { columns = value; return this; }, eq(k, v) { filters.push([k, v]); return this; }, order() { return this; }, maybeSingle() { single = true; return this; }, in() { return this; },
          then(resolve, reject) {
            const user = actor;
            mock.reads.push({ table, user });
            let data = table === "trip_members" ? columns.includes("trips(") ? members.map(m => ({ ...m, trips: trip })) : members : rows[table] || [];
            data = data.filter(row => filters.every(([k, v]) => row[k] === v));
            if (table === "luggage_items") data = data.filter(row => row.owner_id === user);
            const result = structuredClone({ data: single ? data[0] || null : data, error: mock.offline ? { message: "offline" } : null });
            const wait = user === "A" && table === "luggage_items" && mock.holdA ? new Promise(r => mock.pending.push(r)) : Promise.resolve();
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
