import { pricingInputs, normalizePricingInputs, applyDemoPricing } from "../lib/budgetPricingGroups.js";
// Demo transport: memory and local callbacks only. No Auth, RPC, channel or storage.
import { metadataGroupKeys, recordMetadataValue, sameMetadataValue, metadataField } from "../lib/budgetMetadataValues.js";
import { budgetStage } from "../lib/budgetFinance.js";
export function createDemoBudgetMetadataService(getProps, now = Date.now) {
  const states = new Map(), requests = new Map(); let revision = 0;
  const key = (kind, id, group) => `${kind}:${id}:${group}`;
  const versions = (kind, id, revision) => ({ graph: 0, rates: 0, members: 0, targets: [{ kind, id, revision }] });
  function valueFor(kind, row, group) { return group === "pricing" ? pricingInputs(row, (getProps()[kind === "budget" ? "budgetParticipants" : "actualParticipants"] || []).filter(p => p[kind === "budget" ? "budget_item_id" : "actual_expense_id"] === row.id), versions(kind,row.id,states.get(key(kind,row.id,group))?.revision || 0)) : recordMetadataValue(kind,row,group,getProps().itineraryBudgetLinks); }
  function state(kind, row, group) {
    const value = valueFor(kind, row, group);
    const k = key(kind, row.id, group); let s = states.get(k);
    if (!s) { s = { revision: 0, epoch: 0, value }; states.set(k, s); }
    if (sameMetadataValue(group, s.override, value)) delete s.override;
    if (s.override === undefined && !sameMetadataValue(group, s.value, value)) { s.value = value; s.revision++; revision++; }
    return s;
  }
  function find(args) { return (args.p_kind === "budget" ? getProps().budgetItems : getProps().actualExpenses).find(r => r.id === args.p_id); }
  function supported(kind, row) { return kind === "budget" ? !row.is_fixed && !row.auto_created_actual_expense_id && !getProps().actualExpenses.some(a => a.budget_item_id === row.id)
    : !row.budget_item_id && (!row.payment_origin || row.payment_origin === "manual"); }
  function canPrice(kind, row) { try { const p=getProps(), stage=p.demoStage || budgetStage(p.activeTrip);
    if(kind === "budget" && stage !== "planning" && (row.currency !== "TWD" || p.actualExpenses.some(a=>(a.budget_origin_id || a.budget_item_id)===row.id))) return false;
    applyDemoPricing({budgetItems:p.budgetItems,actualExpenses:p.actualExpenses,budgetParticipants:p.budgetParticipants||[],actualParticipants:p.actualParticipants||[]},kind,row.id,valueFor(kind,row,"pricing")); return true; } catch { return false; } }
  const supports = (kind,row,group) => group === "pricing" ? canPrice(kind,row) : supported(kind,row);
  return {
    authorized: async actor => actor === getProps().currentUserId,
    async read(trip) {
      const p = getProps(), records = [], entries = [];
      let links = [...p.itineraryBudgetLinks || []];
      let budgets = p.budgetItems.filter(r => r.trip_id === trip).map(r => ({ ...r }));
      let financial = { budgetItems: budgets, actualExpenses: p.actualExpenses.filter(r => r.trip_id === trip).map(r => ({ ...r })), budgetParticipants: structuredClone(p.budgetParticipants || []), actualParticipants: structuredClone(p.actualParticipants || []) };
      for (const [key,s] of states) { if (key.endsWith(":pricing") && s.override) { const [kind,id]=key.split(":"); try { financial=applyDemoPricing(financial,kind,id,s.value); } catch { /* Canonical refresh will report unsupported graphs. */ } } }
      budgets=financial.budgetItems; const actuals = financial.actualExpenses;
      for (const kind of ["budget", "actual"]) for (const row of kind === "budget" ? budgets : actuals) {
        if (row.trip_id !== trip) continue;
        records.push({ kind, id: row.id, trip_id: trip, supported: supported(kind, row), state_ready: true,
          groups: metadataGroupKeys.filter(g => kind === "budget" || g !== "links").map(group => { const s = state(kind, row, group), held = Boolean(s.owner && s.expires > now());
            if (group === "links") links = [...links.filter(link => link.budget_item_id !== row.id), ...s.value.map(id => ({ budget_item_id: row.id, itinerary_item_id: id }))];
            else if (group !== "pricing") row[metadataField(group)] = s.value;
            if (held) entries.push({ kind, resource_id: row.id, group_key: group, user_id: s.owner, mode: "edit", expires_at: new Date(s.expires).toISOString(), own_session: true });
            return { group, supported: supports(kind,row,group), value: s.value, revision: s.revision, epoch: s.epoch, held, owner_id: held ? s.owner : null,
              own_session: held, expires_at: held ? new Date(s.expires).toISOString() : null }; }) });
      }
      return structuredClone({ ok: true, data: { tripId: trip, budgetItems: budgets, actualExpenses: actuals, budgetParticipants: financial.budgetParticipants, actualParticipants: financial.actualParticipants, tripBudgetRates: p.tripBudgetRates || p.tripRates, metadataVerified: true, metadataReadStartedAt: now(), serverNow: new Date(now()).toISOString(),
        itineraryBudgetLinks: links,
        metadataProtocol: { name: "metadata-prototype", schemaVersion: 3, enabled: true, complete: false, groups: metadataGroupKeys }, metadataRecords: records,
        collaborationRevision: revision, collaboration: { tripId: trip, selectionProtocol: 2, entries },
        nextRefreshAt: entries.length ? new Date(Math.min(...entries.map(e => Date.parse(e.expires_at)))).toISOString() : null } });
    },
    async lease(args) {
      const row = find(args); if (!row || row.trip_id !== args.p_trip_id) return { error: { code: "42501" } };
      const s = state(args.p_kind, row, args.p_group), owns = s.token === args.p_token && s.session === args.p_session_id && s.epoch === args.p_epoch;
      if (args.p_action === "release") { if (owns) { s.owner = null; revision++; } return { data: { granted: true } }; }
      if (!supports(args.p_kind, row,args.p_group)) return { error: { code: "0A000", message: "此項目含付款關聯。" } };
      if (args.p_action === "renew" && (!owns || s.expires <= now())) return { data: { granted: false } };
      if (s.revision !== args.p_base_revision) return { error: { code: "40001" } };
      if (s.owner && s.expires > now() && (s.token !== args.p_token || s.session !== args.p_session_id)) return { data: { granted: false } };
      const fresh = args.p_action === "acquire" && (!s.owner || s.expires <= now());
      if (fresh) { s.epoch++; s.activity = args.p_activity_seq; s.lastActivity = now(); }
      s.owner = getProps().currentUserId; s.token = args.p_token; s.session = args.p_session_id;
      if (args.p_activity_seq > (s.activity ?? -1)) { s.activity = args.p_activity_seq; s.lastActivity = now(); }
      s.expires = Math.min(now() + 420000, s.lastActivity + (args.p_dirty ? 600000 : 120000)); revision++;
      return { data: { granted: s.expires > now(), revision: s.revision, epoch: s.epoch, value: s.value, expires_at: new Date(s.expires).toISOString() } };
    },
    async patch(args) {
      if (requests.has(args.p_request_id)) return { data: requests.get(args.p_request_id) };
      const row = find(args), s = row && state(args.p_kind, row, args.p_group);
      if (!s || !supports(args.p_kind, row,args.p_group) || s.token !== args.p_token || s.session !== args.p_session_id || s.epoch !== args.p_epoch || s.expires <= now()) return { error: { code: "55P03" } };
      if (s.revision !== args.p_base_revision) return { error: { code: "40001" } };
      let value = args.p_patch[args.p_group];
      if (args.p_group === "pricing") { try { value=normalizePricingInputs(value); const p=getProps(); if (value.participantIds.some(id=>!p.members?.some(m=>m.user_id===id&&m.status==="approved"))) throw new Error("參與成員已不在旅程中。"); applyDemoPricing(p,args.p_kind,row.id,value); } catch(error) { return {error:{code:"22023",message:error.message}}; } }
      if (args.p_group === "payer" && value && !getProps().members.some(m => m.user_id === value && m.status === "approved")) return { error: { code: "22023", message: "付款人已不在旅程中。" } };
      if (args.p_group === "links" && (args.p_kind !== "budget" || value.some(id => !getProps().items.some(i => i.id === id && i.trip_id === row.trip_id)))) return { error: { code: "22023", message: "關聯行程不屬於此旅程。" } };
      if (!sameMetadataValue(args.p_group, s.value, value)) { s.revision++; revision++; } if(args.p_group === "pricing") value={...value,versions:versions(args.p_kind,row.id,s.revision)}; s.value = value; s.override = s.value;
      getProps().onSaveMetadata(args.p_kind, row.id, args.p_group, value);
      const result = { id: row.id, kind: args.p_kind, group: args.p_group, value, revision: s.revision, request_id: args.p_request_id };
      requests.set(args.p_request_id, result); return { data: result };
    },
  };
}
