import { expect } from "@playwright/test";
import { saveDemoBudgetRecord } from "../../src/demo/saveBudgetRecord.js";

// Real App + shared, isolated backend. In particular, honor the nested SELECT:
// returning every trip column would hide the missing budget_exchange_rates bug.
export function backend({ empty = false, departed = false, leases = false } = {}) {
  const quote = { rates: { JPY: .25, USD: 32, EUR: 35, KRW: .025, HKD: 4 }, source: "ExchangeRate-API", quoted_at: "2026-10-27T00:00:00Z" };
  const trips = ["trip", "other"].map(id => ({ id, title: id === "trip" ? "Rates QA" : "Other QA", name: id,
    status: "planning", destination: "Japan", owner_id: "A", start_date: departed ? "2020-04-05" : "2090-04-05", end_date: departed ? "2020-04-10" : "2090-04-10",
    updated_at: "2026-10-27T00:00:00Z", budget_exchange_rates: empty ? {} : { ...quote, rates: { ...quote.rates, JPY: id === "trip" ? .2 : .4 } } }));
  const members = trips.flatMap(trip => ["A", "B"].map(user_id => ({ id: `${trip.id}-${user_id}`, trip_id: trip.id, user_id, role: user_id === "A" ? "owner" : "editor", status: "approved", display_name: user_id })));
  const budget = { id: "budget", trip_id: "trip", title: "JPY fare", category: "交通", amount: 1000, currency: "JPY", exchange_rate: .2, twd_amount: 200, pricing_mode: "split_total", payer_id: "A", updated_at: "2026-10-27T00:00:00Z" };
  const rows = { budget_items: [budget], budget_item_participants: [{ budget_item_id: "budget", user_id: "A" }, { budget_item_id: "budget", user_id: "B" }] };
  if (leases) {
    rows.budget_items.push({ ...budget, id: "second", title: "Second fare" });
    rows.budget_item_participants.push({ budget_item_id: "second", user_id: "A" }, { budget_item_id: "second", user_id: "B" });
  }
  const stateKeys = { budget_items: "budgetItems", budget_item_participants: "budgetParticipants", actual_expenses: "actualExpenses", actual_expense_participants: "actualParticipants", itinerary_budget_items: "itineraryBudgetLinks", attachments: "attachments" };
  return { trips, members, rows, quote, pages: [], reads: [], snapshotReads: [], collaborationReads: [], selectionCalls: [], selections: new Map(), rpcs: [], storageCalls: [], receiptFailure: false, leaseCalls: [], held: new Map(), now: Date.now(), operations: {}, quoteReads: 0, offline: false, hold: null, pending: [], missingLeaseRpc: false,
    release() { this.hold = null; this.pending.splice(0).forEach(resolve => resolve()); },
    async emit(table = "trips", payload = {eventType:"UPDATE"}) { await Promise.all(this.pages.filter(page => !page.isClosed()).map(page => page.evaluate(({table,payload}) => window.budgetMock.emit(table,payload), {table,payload}))); },
    async request({ op, table, columns, filters = [], patch, single, actor, name, args, action, path, paths }) {
      if(op==="storage") {this.storageCalls.push({action,path,paths});return {data:{},error:null};}
      if (op === "rpc") {
        if(name==="update_budget_selection") {
          this.selectionCalls.push({actor,args});const key=`${args.p_trip_id}:${actor}:${args.p_session_id}`;
          if(this.offline)return {error:{message:"offline"}};
          if(!args.p_id)this.selections.delete(key);
          else this.selections.set(key,{tripId:args.p_trip_id,user_id:actor,session:args.p_session_id,kind:args.p_kind,resource_id:args.p_id,expires_at:new Date(this.now+45000).toISOString(),mode:"selection"});
          await this.emit("budget_collaboration_signals");return {data:null,error:null};
        }
        if(name==="read_budget_collaboration") {
          this.collaborationReads.push({actor,args});if(this.offline)return {error:{message:"offline"}};
          const entries=[...this.selections.values()].filter(e=>e.tripId===args.p_trip_id).map(e=>({...e,own_session:e.user_id===actor&&e.session===args.p_session_id}));
          for(const [key,h] of this.held){const [kind,id]=key.split(":"),record=(rows[kind==="budget"?"budget_items":"actual_expenses"]||[]).find(r=>r.id===id);if(record?.trip_id===args.p_trip_id)entries.push({kind,resource_id:id,user_id:h.actor,mode:"edit",expires_at:new Date(h.expires).toISOString(),own_session:h.actor===actor&&h.session===args.p_session_id});}
          return {data:{tripId:args.p_trip_id,serverNow:new Date(this.now).toISOString(),entries:entries.filter(e=>Date.parse(e.expires_at)>this.now)},error:null};
        }
        if (name === "read_budget_snapshot") {
          this.snapshotReads.push({actor,tripId:args.p_trip_id});
          const trip=trips.find(t=>t.id===args.p_trip_id), budgets=(rows.budget_items||[]).filter(r=>r.trip_id===args.p_trip_id), actuals=(rows.actual_expenses||[]).filter(r=>r.trip_id===args.p_trip_id);
          const result=structuredClone({data:{tripId:args.p_trip_id,tripBudgetRates:trip.budget_exchange_rates,
            budgetItems:budgets,budgetParticipants:(rows.budget_item_participants||[]).filter(p=>budgets.some(b=>b.id===p.budget_item_id)),
            actualExpenses:actuals,actualParticipants:(rows.actual_expense_participants||[]).filter(p=>actuals.some(e=>e.id===p.actual_expense_id)),
            itineraryBudgetLinks:(rows.itinerary_budget_items||[]).filter(l=>budgets.some(b=>b.id===l.budget_item_id)),
            budgetBaseline:(rows.trip_budget_baselines||[]).find(s=>s.trip_id===args.p_trip_id)||null,
            items:(rows.itinerary_items||[]).filter(i=>i.trip_id===args.p_trip_id),members:members.filter(m=>m.trip_id===args.p_trip_id&&m.status==="approved"),attachments:(rows.attachments||[]).filter(a=>a.trip_id===args.p_trip_id&&a.target_type==="actual_expense")},error:this.offline?{message:"offline"}:null});
          if (this.hold?.snapshotActor===actor && (!this.hold.tripId||this.hold.tripId===args.p_trip_id)) await new Promise(resolve=>this.pending.push(resolve));
          return result;
        }
        // The rates tests only need admission, while the lease tests exercise
        // the real client against this shared authoritative metadata service.
        if (name === "budget_edit_lease") {
          this.leaseCalls.push({ args, actor });
          if (this.missingLeaseRpc) return { error: { code: "PGRST202", message: "lease API unavailable" } };
          if (this.offline) return { error: { message: "offline" } };
          const row = (rows[args.p_kind === "budget" ? "budget_items" : "actual_expenses"] || []).find(r => r.id === args.p_id);
          const key = `${args.p_kind}:${args.p_id}`, held = this.held.get(key);
          const owns = held?.actor === actor && held.session === args.p_session_id && held.token === args.p_token;
          if (args.p_action === "release") { if (owns) { this.held.delete(key); await this.emit("budget_collaboration_signals"); } return { data: { granted: true }, error: null }; }
          if (!row || !members.some(m => m.trip_id === row.trip_id && m.user_id === actor && m.status === "approved" && m.role !== "viewer")) return { error: { code: "42501", message: "Forbidden" } };
          if (args.p_action === "renew" && (!owns || held.expires <= this.now)) return { data: { granted: false }, error: null };
          if (args.p_action === "acquire" && args.p_base_updated_at !== row.updated_at) return { error: { code: "40001", message: "Record changed" } };
          if (args.p_action === "acquire" && held?.expires > this.now && !owns) return { data: { granted: false, owner_id: held.actor }, error: null };
          this.held.set(key, { actor, session: args.p_session_id, token: args.p_token, expires: this.now + 420000 });
          await this.emit("budget_collaboration_signals");
          const result = { data: { granted: true, record: structuredClone(row), expires_at: new Date(this.now + 420000).toISOString() }, error: null };
          if (this.hold?.action === args.p_action && this.hold.actor === actor) await new Promise(resolve => this.pending.push(resolve));
          return result;
        }
        this.rpcs.push({ name, args, actor });
        if(name==="mutate_budget_receipt") {
          const held=this.held.get(`actual:${args.p_actual_id}`);
          if(this.receiptFailure||!held||held.actor!==actor||held.session!==args.p_edit_session_id||held.token!==args.p_edit_token||held.expires<=this.now)return {error:{code:"55P03",message:"Receipt lease lost"}};
          let receipt;
          if(args.p_action==="insert") {receipt={...args.p_receipt,id:crypto.randomUUID(),trip_id:args.p_trip_id,target_type:"actual_expense",target_id:args.p_actual_id};(rows.attachments??=[]).push(receipt);}
          else {receipt=rows.attachments.find(a=>a.id===args.p_receipt.id);rows.attachments=rows.attachments.filter(a=>a.id!==args.p_receipt.id);}
          await this.emit("attachments",{eventType:args.p_action==="insert"?"INSERT":"DELETE",new:args.p_action==="insert"?receipt:{},old:args.p_action==="delete"?receipt:{}});
          return {data:structuredClone(receipt),error:null};
        }
        if (leases && ["save_budget_workspace_record_v4", "delete_budget_workspace_record_v2"].includes(name)) {
          if (this.offline) return { error: { message: "offline" } };
          if (args.p_id) {
            const held = this.held.get(`${args.p_kind}:${args.p_id}`);
            if (!held || held.actor !== actor || held.session !== args.p_edit_session_id || held.token !== args.p_edit_token || held.expires <= this.now) return { error: { code: "55P03", message: "Lease lost" } };
          }
          const rowKey = args.p_kind === "budget" ? "budget_items" : "actual_expenses";
          if (name.startsWith("delete_")) {
            rows[rowKey] = rows[rowKey].filter(r => r.id !== args.p_id);
            this.held.delete(`${args.p_kind}:${args.p_id}`);
            await this.emit(rowKey); return { data: null, error: null };
          }
          const state = Object.fromEntries(Object.entries(stateKeys).map(([table, key]) => [key, rows[table] || []]));
          state.operations = this.operations;
          const result = saveDemoBudgetRecord(state, args.p_kind, args.p_payload, args.p_id,
            { baseUpdatedAt: args.p_base_updated_at, operationId: args.p_request_id }, trips.find(t => t.id === args.p_trip_id), members.filter(m => m.trip_id === args.p_trip_id));
          if (!result.ok) return { error: { code: result.conflict ? "40001" : "P0001", message: result.error.message } };
          for (const [table, key] of Object.entries(stateKeys)) rows[table] = result.nextState[key];
          this.operations = result.nextState.operations;
          await this.emit(rowKey); return { data: result.data, error: null };
        }
        if (name !== "update_trip_budget_rates") throw new Error(`Unexpected RPC: ${name}`);
        const trip = trips.find(trip => trip.id === args.p_trip_id);
        if (!args.p_initialize || !trip.budget_exchange_rates.rates) {
          trip.budget_exchange_rates = structuredClone(args.p_quote);
          for (const row of rows.budget_items.filter(row => row.trip_id === trip.id)) {
            row.exchange_rate = args.p_quote.rates[row.currency]; row.twd_amount = Math.round(row.amount * row.exchange_rate);
          }
        }
        await this.emit(); // Simulated committed DB event, delivered to both Apps.
        return { data: structuredClone(trip.budget_exchange_rates), error: null };
      }
      this.reads.push({ table, columns, actor, patch });
      let data = table === "trip_members" ? members : rows[table] || [];
      data = data.filter(row => filters.every(([key, value]) => row[key] === value));
      if (patch) data.forEach(row => Object.assign(row, patch));
      if (table === "trip_members" && columns.includes("trips(")) {
        const fields = columns.match(/trips\(([^)]+)\)/)[1].split(",");
        data = data.map(row => ({ ...row, trips: Object.fromEntries(fields.map(key => [key, trips.find(trip => trip.id === row.trip_id)[key]])) }));
      }
      const result = structuredClone({ data: single ? data[0] || null : data, error: this.offline ? { message: "offline" } : null });
      if (this.hold?.actor===actor && this.hold.readTable===table) await new Promise(resolve=>this.pending.push(resolve));
      if (this.hold?.actor === actor && table === "trip_members" && columns.includes("trips(")) await new Promise(resolve => this.pending.push(resolve));
      return result;
    },
  };
}

export async function boot(page, db, actor = "A") {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", request => { if (/\/auth\/v1\/|\/rest\/v1\/|\/realtime\/v1\//.test(request.url())) errors.push(`Unexpected hosted request: ${request.url()}`); });
  page.qaErrors = errors;
  db.pages.push(page);
  await page.exposeBinding("budgetBackend", (_, request) => db.request(request));
  await page.route("**/src/lib/supabase.js*", route => route.fulfill({ contentType: "text/javascript", body: "export const hasSupabaseConfig = true; export const supabase = window.budgetMock.client;" }));
  await page.route("https://open.er-api.com/v6/latest/TWD", route => {
    db.quoteReads++;
    return route.fulfill({ json: { result: "success", base_code: "TWD", time_last_update_unix: 1793059200,
      rates: { TWD: 1, JPY: 4, USD: 1 / 32, EUR: 1 / 35, KRW: 40, HKD: .25 } } });
  });
  await page.addInitScript(actor => {
    for (const user of ["A", "B", actor]) localStorage.setItem(`travel-planner-session-context:${user}`, JSON.stringify({ activeTripId: "trip", activeSection: "budget" }));
    const callbacks = [], channels = [];
    const session = () => ({ user: { id: actor, email: `${actor}@qa.invalid`, user_metadata: { full_name: actor } }, access_token: "qa-not-a-real-token" });
    const mock = window.budgetMock = { inFlight: 0,
      switchAccount(next) { actor = next; callbacks.forEach(callback => callback("SIGNED_IN", session())); },
      captureReload() { return channels.filter(c => !c.closed && c.name.startsWith("trip-")).at(-1).handlers.find(h => h.config.table === "trips").callback; },
      captureBudget() { return channels.filter(c => !c.closed && c.name.startsWith("trip-")).at(-1).handlers.find(h => h.config.table === "budget_items").callback; },
      status(status) { channels.filter(c=>!c.closed&&c.name.startsWith("trip-")).forEach(c=>c.statusCallback?.(status)); },
      emit(table, payload={eventType:"UPDATE"}) { channels.filter(c => !c.closed).forEach(c => c.handlers.filter(h => h.type === "postgres_changes" && h.config.table === table && (h.config.event==="*"||h.config.event===payload.eventType)).forEach(h => h.callback(payload))); },
    };
    mock.client = {
      auth: { getSession: async () => ({ data: { session: session() } }), onAuthStateChange(callback) { callbacks.push(callback); return { data: { subscription: { unsubscribe() {} } } }; }, signOut: async () => { callbacks.forEach(c => c("SIGNED_OUT", null)); return {}; } },
      from(table) {
        const filters = []; let columns = "*", patch, single = false;
        return {
          select(value = "*") { columns = value; return this; }, eq(key, value) { filters.push([key, value]); return this; }, in() { return this; }, order() { return this; },
          update(value) { patch = value; return this; }, single() { single = true; return this; }, maybeSingle() { single = true; return this; },
          then(resolve, reject) {
            mock.inFlight++;
            return window.budgetBackend({ op: "read", table, columns, filters, patch, single, actor }).finally(() => { mock.inFlight--; }).then(resolve, reject);
          },
        };
      },
      rpc: (name, args) => window.budgetBackend({ op: "rpc", name, args, actor }),
      storage:{from:()=>({upload:async path=>window.budgetBackend({op:"storage",action:"upload",path,actor}),remove:async paths=>window.budgetBackend({op:"storage",action:"remove",paths,actor})})},
      channel(name) {
        const c = { name, closed: false, handlers: [], on(type, config, callback) { this.handlers.push({ type, config, callback }); return this; }, subscribe(callback) { this.statusCallback=callback; queueMicrotask(() => callback?.("SUBSCRIBED")); return this; }, presenceState() { return {}; }, track: async () => "ok", untrack: async () => "ok", send: async () => "ok" };
        channels.push(c); return c;
      },
      removeChannel: async channel => { channel.closed = true; },
    };
  }, actor);
  await page.goto("/");
  await expect(page.getByRole("table", { name: /^(預算|實付)明細$/ })).toBeVisible();
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
}
