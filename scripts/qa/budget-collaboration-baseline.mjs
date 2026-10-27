// Phase 0 diagnostic: real App, controlled in-memory SDK backend, no hosted I/O.
// Counts are SDK invocations / injected deliveries, not Supabase network traffic.
import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

if (!process.env.BUDGET_BASELINE_OUTPUT) throw new Error("Set BUDGET_BASELINE_OUTPUT outside the repository");
const trip = { id: "trip", title: "Budget baseline", name: "Budget baseline", status: "planning", destination: "Japan", owner_id: "A", start_date: "2090-04-05", end_date: "2090-04-10", updated_at: "2026-10-27T00:00:00Z", budget_exchange_rates: { rates: { JPY: .2, USD: 32, EUR: 35, KRW: .025, HKD: 4 }, source: "ExchangeRate-API", quoted_at: "2026-10-27T00:00:00Z" } };
const members = ["A", "B"].map(user_id => ({ id: `member-${user_id}`, trip_id: "trip", user_id, display_name: user_id, role: user_id === "A" ? "owner" : "editor", status: "approved" }));
let tick = 0;
const version = () => new Date(Date.parse("2026-10-27T00:00:00Z") + ++tick).toISOString();
const makeBudget = (id, title, amount = 1000) => ({ id, trip_id: "trip", title, category: "交通", amount, currency: "TWD", exchange_rate: 1, twd_amount: amount, pricing_mode: "split_total", split_type: "equal", payer_id: "A", updated_at: version() });
const rows = { budget_items: [makeBudget("fare", "Baseline fare")], budget_item_participants: ["A", "B"].map(user_id => ({ budget_item_id: "fare", user_id, share_amount: 500 })), actual_expenses: [], actual_expense_participants: [] };
const pages = [], log = [], errors = [];
function record(actor, op, details = {}) { log.push({ actor, op, ...details }); }
async function emit(table) { await Promise.all(pages.map(page => page.evaluate(table => window.baseline.emit(table), table))); }
async function request({ actor, table, columns, filters = [], patch, single, name, args }) {
  if (name) {
    record(actor, "rpc", { name });
    if (name === "delete_budget_workspace_record") {
      rows.budget_items = rows.budget_items.filter(row => row.id !== args.p_id);
      rows.budget_item_participants = rows.budget_item_participants.filter(row => row.budget_item_id !== args.p_id);
      await emit("budget_items"); await emit("budget_item_participants");
      return { data: null, error: null };
    }
    if (name !== "save_budget_workspace_record_v3") throw new Error(`Unexpected RPC ${name}`);
    const payload = args.p_payload, id = args.p_id || "created";
    let row = rows.budget_items.find(row => row.id === id);
    if (!row) { row = makeBudget(id, payload.title, Number(payload.amount)); rows.budget_items.push(row); }
    if (!payload.payment_only) {
      Object.assign(row, payload, { id, updated_at: version(), locked_by: null, locked_at: null });
      rows.budget_item_participants = rows.budget_item_participants.filter(row => row.budget_item_id !== id);
      rows.budget_item_participants.push(...payload.participantIds.map(user_id => ({ budget_item_id: id, user_id, share_amount: Number(row.twd_amount) / payload.participantIds.length })));
      await emit("budget_items"); await emit("budget_item_participants");
    }
    if (payload.payment_action === "paid") {
      let payment = rows.actual_expenses.find(row => row.budget_item_id === id);
      if (!payment) {
        payment = { ...row, id: `paid-${id}`, budget_item_id: id, payment_active: true, updated_at: version() };
        rows.actual_expenses.push(payment);
        rows.actual_expense_participants.push(...["A", "B"].map(user_id => ({ actual_expense_id: payment.id, user_id, share_amount: Number(payment.twd_amount) / 2 })));
        await emit("actual_expenses"); await emit("actual_expense_participants");
      }
    }
    return { data: { id, updated_at: row.updated_at }, error: null };
  }
  record(actor, patch ? "update" : "select", { table, columns, filters });
  let data = (table === "trip_members" ? members : rows[table] || []).filter(row => filters.every(([key, value]) => row[key] === value));
  if (patch) {
    data.forEach(row => Object.assign(row, patch, { updated_at: version() }));
    await emit(table);
  }
  if (table === "trip_members" && columns.includes("trips(")) {
    const fields = columns.match(/trips\(([^)]+)\)/)[1].split(",");
    data = data.map(row => ({ ...row, trips: Object.fromEntries(fields.map(key => [key, trip[key]])) }));
  }
  return structuredClone({ data: single ? data[0] || null : data, error: null });
}
const browser = await chromium.launch();
try {
  for (const actor of ["A", "B"]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); pages.push(page);
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (/supabase\.co|open\.er-api\.com/.test(request.url())) errors.push("Unexpected hosted request"); });
    await page.exposeBinding("baselineRequest", (_, args) => request({ ...args, actor }));
    await page.exposeBinding("baselineRecord", (_, op, details) => record(actor, op, details));
    await page.route("**/src/lib/supabase.js*", route => route.fulfill({ contentType: "text/javascript", body: "export const hasSupabaseConfig = true; export const supabase = window.baseline.client;" }));
    await page.addInitScript(actor => {
      localStorage.setItem(`travel-planner-session-context:${actor}`, JSON.stringify({ activeTripId: "trip", activeSection: "budget" }));
      const channels = [], session = { user: { id: actor, email: `${actor}@qa.invalid`, user_metadata: { full_name: actor } }, access_token: "not-a-real-token" };
      const m = window.baseline = { inFlight: 0, pendingLogs: [],
        record(op, details) { const promise = window.baselineRecord(op, details); this.pendingLogs.push(promise); return promise; },
        emit(table) { channels.filter(c => !c.closed).forEach(c => c.handlers.filter(h => h.type === "postgres_changes" && h.config.table === table).forEach(h => { this.record("delivery", { table }); h.callback({ eventType: "UPDATE" }); })); },
      };
      m.client = {
        auth: { getSession: async () => ({ data: { session } }), onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; } },
        from(table) {
          const filters = []; let columns = "*", single = false, patch;
          return { select(value = "*") { columns = value; return this; }, eq(key, value) { filters.push([key, value]); return this; }, in() { return this; }, order() { return this; }, update(value) { patch = value; return this; }, single() { single = true; return this; }, maybeSingle() { single = true; return this; },
            then(resolve, reject) { m.inFlight++; return window.baselineRequest({ table, columns, filters, patch, single }).finally(() => { m.inFlight--; }).then(resolve, reject); } };
        },
        rpc(name, args) { m.inFlight++; return window.baselineRequest({ name, args }).finally(() => { m.inFlight--; }); },
        channel(name, options) {
          m.record("join", { name, private: Boolean(options?.config?.private) });
          const c = { name, closed: false, handlers: [], on(type, config, callback) { this.handlers.push({ type, config, callback }); return this; }, subscribe(callback) { queueMicrotask(() => callback?.("SUBSCRIBED")); return this; }, presenceState() { return {}; }, track: async () => { await m.record("track", { name }); return "ok"; }, untrack: async () => "ok", send: async event => { await m.record("broadcast", { name, event: event.event }); return "ok"; } };
          channels.push(c); return c;
        },
        removeChannel: async c => { c.closed = true; await m.record("leave", { name: c.name }); },
      };
    }, actor);
    await page.goto(process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:5174/");
    await expect(page.getByRole("table", { name: "預算明細", exact: true })).toBeVisible();
  }
  const [a, b] = pages;
  async function idle() {
    for (const page of pages) { await expect.poll(() => page.evaluate(() => baseline.inFlight)).toBe(0); await page.evaluate(() => Promise.all(baseline.pendingLogs)); }
  }
  await a.waitForTimeout(150); await idle(); // Explicit 80ms initial luggage timer.
  const startup = log.filter(e => ["join", "leave", "track"].includes(e.op));
  function summarize(entries) { return Object.fromEntries(["A", "B"].map(actor => [actor, Object.fromEntries(["select", "update", "rpc", "delivery", "join", "leave", "track", "broadcast"].map(op => [op, entries.filter(e => e.actor === actor && e.op === op).length]))])); }
  const scenarios = [];
  async function measure(name, fn) { await idle(); const start = log.length; await fn(); await idle(); scenarios.push({ name, counts: summarize(log.slice(start)), entries: log.slice(start) }); }
  const row = (page, title) => page.locator(".bw-row").filter({ has: page.getByRole("button", { name: title, exact: true }) });
  await measure("create: one injected event per touched table", async () => {
    await a.getByRole("button", { name: "新增預算", exact: true }).click(); const form = a.getByRole("form", { name: "預算編輯" });
    await form.getByLabel("項目", { exact: true }).fill("Created fare"); await form.getByLabel("總額", { exact: true }).fill("100"); await form.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(row(b, "Created fare")).toBeVisible();
  });
  await measure("edit including lock acquire/release", async () => {
    await row(a, "Baseline fare").getByRole("button", { name: "Baseline fare", exact: true }).click(); await a.getByRole("tab", { name: "編輯項目", exact: true }).click();
    const form = a.getByRole("form", { name: "預算編輯" }); await form.getByLabel("項目", { exact: true }).fill("Edited fare"); await form.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(row(b, "Edited fare")).toBeVisible();
  });
  await a.getByRole("tab", { name: "項目明細", exact: true }).click();
  await measure("payment on: one injected event per touched table", async () => {
    await a.getByRole("button", { name: "付款狀態", exact: true }).click(); await expect(row(b, "Edited fare")).toContainText("已付款");
  });
  await row(a, "Created fare").getByRole("button", { name: "Created fare", exact: true }).click();
  await measure("delete: one injected event per touched table", async () => {
    await a.getByRole("button", { name: "刪除項目", exact: true }).click();
    await a.getByRole("dialog").getByRole("button", { name: "刪除", exact: true }).click(); await expect(row(b, "Created fare")).toHaveCount(0);
  });
  await measure("ten concurrent synthetic budget notifications", async () => { await Promise.all(Array.from({ length: 10 }, () => emit("budget_items"))); });
  const latencies = [];
  for (let i = 0; i < 20; i++) {
    const title = `Latency ${i}`; rows.budget_items.find(row => row.id === "fare").title = title;
    const start = performance.now(); await emit("budget_items"); await expect(row(b, title)).toBeVisible(); await idle(); latencies.push(Math.round(performance.now() - start));
  }
  const sorted = [...latencies].sort((x, y) => x - y);
  const output = { baseline: "2600066 + local issue #9 SELECT fix", appSha256: createHash("sha256").update(await fs.readFile("src/App.jsx")).digest("hex"),
    methodology: "Real / entry, production CSS and StrictMode; in-memory SDK responses and synthetic callbacks. All counts are local invocations, not hosted REST/message measurements. Events model one delivery per touched table, not actual per-row WAL fan-out. Latency includes Playwright/IPC overhead, no network delay.",
    startup, scenarios, latency: { samples: latencies, p50Ms: sorted[9], p95Ms: sorted[18] }, errors };
  await fs.writeFile(process.env.BUDGET_BASELINE_OUTPUT, JSON.stringify(output, null, 2));
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ scenarios: scenarios.map(({ name, counts }) => ({ name, counts })), latency: output.latency, errors }, null, 2));
} finally { await browser.close(); }
