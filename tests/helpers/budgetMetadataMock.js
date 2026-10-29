import { pricingInputs, normalizePricingInputs, applyDemoPricing } from "../../src/lib/budgetPricingGroups.js";
import { backend, boot } from "./formalBudgetMock.js";
import { metadataGroupKeys, recordMetadataValue, metadataField } from "../../src/lib/budgetMetadataValues.js";
export { boot };
export async function enableMetadata(page) {
  await page.route("**/src/lib/budgetMetadataConfig.js*", route => route.fulfill({ contentType: "text/javascript",
    body: "export const budgetMetadataEnabled=true;let id;export const getBudgetMetadataSessionId=()=>id ||= crypto.randomUUID();" }));
}
export function metadataBackend() {
  const db = backend({ leases: true }), original = db.request.bind(db);
  db.groupStates = new Map(); db.groupCalls = []; db.groupRequests = new Map(); db.groupRevision = 0;
  db.metadataEnabled = true; db.metadataHold = null; db.metadataPending = [];
  db.holdNextMetadataSnapshotAfterPatch = (actor = "A") => {
    const gate = { actor, started: 0, pending: [], release() { this.pending.splice(0).forEach(resolve=>resolve()); } };
    db.nextSnapshotGate = gate; return gate;
  };
  db.releaseMetadata = () => { db.metadataHold = null; db.metadataPending.splice(0).forEach(resolve => resolve()); };
  const key = args => `${args.p_kind}:${args.p_id}:${args.p_group}`;
  const rowFor = args => (db.rows[args.p_kind === "budget" ? "budget_items" : "actual_expenses"] || []).find(r => r.id === args.p_id && r.trip_id === args.p_trip_id);
  const state = (kind, row, group) => {
    const k = `${kind}:${row.id}:${group}`; if (!db.groupStates.has(k)) db.groupStates.set(k, { revision: 0, epoch: 0 }); return db.groupStates.get(k);
  };
  const valueFor = (kind,row,group) => group === "pricing" ? pricingInputs(row,(db.rows[kind === "budget" ? "budget_item_participants" : "actual_expense_participants"] || []).filter(p=>p[kind === "budget" ? "budget_item_id" : "actual_expense_id"] === row.id),{graph:0,rates:0,members:0,targets:[{kind,id:row.id,revision:state(kind,row,group).revision}]}) : recordMetadataValue(kind,row,group,db.rows.itinerary_budget_items);
  db.request = async req => {
    const { name, args, actor } = req;
    if (name === "budget_edit_lease" && args.p_action === "acquire" && [...db.groupStates.entries()].some(([key,g])=>key.startsWith(`${args.p_kind}:${args.p_id}:`) && g.actor && g.expires > db.now)) {
      db.leaseCalls.push({args,actor});return {data:{granted:false,reason:"group_locked"}};
    }
    if (["read_budget_metadata_snapshot", "read_budget_metadata_snapshot_v2", "read_budget_metadata_snapshot_v3", "read_budget_metadata_snapshot_v4"].includes(name)) {
      if (db.metadataMissing) return { error: { code: "PGRST202" } };
      const result = await original({ ...req, name: "read_budget_snapshot" }); if (!result.data || result.error) return result;
      const legacy = await original({ ...req, name: "read_budget_collaboration" });
      const entries = [...legacy.data?.entries || []], records = [];
      for (const kind of ["budget", "actual"]) for (const row of result.data[kind === "budget" ? "budgetItems" : "actualExpenses"]) {
        records.push({ kind, id: row.id, trip_id: row.trip_id, state_ready: true,
          supported: kind === "budget" ? !row.is_fixed && !row.auto_created_actual_expense_id && !(db.rows.actual_expenses || []).some(a => a.budget_item_id === row.id) : !row.budget_item_id,
          groups: (db.extendedMetadata ? metadataGroupKeys.filter(g=>db.pricingMetadata || g!=="pricing").filter(g => kind === "budget" || g !== "links") : ["title", "note"]).map(group => { const g = state(kind, row, group), held = Boolean(g.actor && g.expires > db.now && db.members.some(m => m.user_id === g.actor && m.trip_id === row.trip_id && m.role !== "viewer" && m.status === "approved"));
            const own = held && g.actor === actor && g.session === args.p_session_id;
            if (held) entries.push({ kind, resource_id: row.id, group_key: group, user_id: g.actor, mode: "edit", expires_at: new Date(g.expires).toISOString(), own_session: own });
            return { group, value: valueFor(kind,row,group), revision: g.revision, epoch: g.epoch, held, owner_id: held ? g.actor : null, own_session: own, expires_at: held ? new Date(g.expires).toISOString() : null }; }) });
      }
      result.data = { ...result.data, metadataProtocol: { name: "metadata-prototype", schemaVersion: db.metadataMalformed ? 99 : db.pricingMetadata ? 3 : db.extendedMetadata ? 2 : 1, enabled: db.metadataEnabled, complete: false, groups: db.extendedMetadata ? metadataGroupKeys.filter(g=>db.pricingMetadata || g!=="pricing") : ["title", "note"] }, metadataRecords: records,
        serverNow: new Date(db.now).toISOString(), collaborationRevision: db.groupRevision, collaboration: { tripId: args.p_trip_id, selectionProtocol: 2, entries },
        nextRefreshAt: entries.length ? new Date(Math.min(...entries.map(e => Date.parse(e.expires_at)))).toISOString() : null };
      if (db.snapshotGate?.actor === actor) {
        const gate=db.snapshotGate;db.snapshotGate=null;gate.started++;const captured=structuredClone(result);
        await new Promise(resolve=>gate.pending.push(resolve));return captured;
      }
      return result;
    }
    if (["budget_metadata_group_lease", "patch_budget_metadata_group"].includes(name)) {
      db.groupCalls.push({ name, args, actor });
      if (db.metadataHold?.actor === actor && db.metadataHold.action === (name === "patch_budget_metadata_group" ? "patch" : args.p_action)) await new Promise(resolve => db.metadataPending.push(resolve));
      if (db.offline) return { error: { message: "offline" } };
      const row = rowFor(args), g = row && state(args.p_kind, row, args.p_group);
      if (!g) return { error: { code: "42501" } };
      const owns = g.actor === actor && g.session === args.p_session_id && g.token === args.p_token && g.epoch === args.p_epoch;
      if (args.p_action === "release") {
        if (db.releaseFailure) return { error: { message: "release rejected" } };
        if (owns) { g.actor = null; db.groupRevision++; await db.emit("budget_collaboration_signals"); } return { data: { granted: true } };
      }
      if (!db.members.some(m => m.user_id === actor && m.trip_id === row.trip_id && m.role !== "viewer" && m.status === "approved")) return { error: { code: "42501" } };
      if (name === "patch_budget_metadata_group" && db.groupRequests.has(args.p_request_id)) return { data: db.groupRequests.get(args.p_request_id) };
      if (!db.metadataEnabled) return { error: { code: "55000" } };
      if (args.p_base_revision !== g.revision) return { error: { code: "40001" } };
      if (name === "patch_budget_metadata_group") {
        if (db.patchError) return { error: db.patchError };
        if (!owns || g.expires <= db.now) return { error: { code: "55P03" } };
        let value = args.p_patch[args.p_group];
        if(args.p_group === "pricing") { const next=applyDemoPricing({budgetItems:db.rows.budget_items,actualExpenses:db.rows.actual_expenses||[],budgetParticipants:db.rows.budget_item_participants||[],actualParticipants:db.rows.actual_expense_participants||[]},args.p_kind,row.id,value); Object.assign(db.rows,{budget_items:next.budgetItems,actual_expenses:next.actualExpenses,budget_item_participants:next.budgetParticipants,actual_expense_participants:next.actualParticipants}); value=normalizePricingInputs(value); }
        if (args.p_group === "links") db.rows.itinerary_budget_items = [...(db.rows.itinerary_budget_items || []).filter(link => link.budget_item_id !== row.id), ...value.map(id => ({ budget_item_id: row.id, itinerary_item_id: id }))];
        else if(args.p_group !== "pricing") row[metadataField(args.p_group)] = value;
        row.updated_at = new Date(db.now + (++db.groupRevision)).toISOString(); g.revision++;
        const data = { id: row.id, kind: args.p_kind, group: args.p_group, revision: g.revision, value, request_id: args.p_request_id };
        if(db.nextSnapshotGate?.actor===actor){db.snapshotGate=db.nextSnapshotGate;db.nextSnapshotGate=null;}
        db.groupRequests.set(args.p_request_id, data); await db.emit("budget_items"); await db.emit("budget_collaboration_signals");
        if (db.losePatchAck) { db.losePatchAck = false; return { error: { message: "ack lost" } }; }
        return { data };
      }
      if (db.held.has(`${args.p_kind}:${args.p_id}`)) return { data: { granted: false, reason: "legacy_locked" } };
      if (args.p_action === "renew" && (!owns || g.expires <= db.now)) return { data: { granted: false } };
      if (g.actor && g.expires > db.now && (g.actor !== actor || g.session !== args.p_session_id || g.token !== args.p_token)) return { data: { granted: false, owner_id: g.actor } };
      if (!g.actor || g.expires <= db.now) g.epoch++;
      Object.assign(g, { actor, session: args.p_session_id, token: args.p_token, expires: db.now + (args.p_dirty ? 420000 : 120000) });
      db.groupRevision++; await db.emit("budget_collaboration_signals");
      return { data: { granted: true, epoch: g.epoch, revision: g.revision, value: valueFor(args.p_kind,row,args.p_group), expires_at: new Date(g.expires).toISOString() } };
    }
    return original(req);
  };
  return db;
}
