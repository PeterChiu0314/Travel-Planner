import { saveDemoBudgetRecord } from './saveBudgetRecord.js';
import { calculatePricing } from '../lib/budgetFinance.js';
import { pricingInputs } from '../lib/budgetPricingGroups.js';

export function applyDemoPaymentChanges(finance, change) {
  const next = { ...finance };
  next.budgetItems = finance.budgetItems.map(r => change.budget?.id === r.id ? { ...r, auto_created_actual_expense_id: change.budget.actualId } : r);
  next.actualExpenses = finance.actualExpenses.map(r => change.actuals.some(a => a.id === r.id) ? { ...r, ...change.actuals.find(a => a.id === r.id).fields } : r);
  if (change.created && !next.actualExpenses.some(r => r.id === change.created.id)) next.actualExpenses = [...next.actualExpenses, change.created];
  next.actualParticipants = [...finance.actualParticipants, ...change.people.filter(p => !finance.actualParticipants.some(q => q.id === p.id))];
  return next;
}
export function paymentChangesApplied(p, change) {
  return (!change.created || p.actualExpenses.some(r => r.id === change.created.id))
    && change.actuals.every(a => p.actualExpenses.some(r => r.id === a.id && Object.entries(a.fields).every(([k, v]) => r[k] === v)))
    && (!change.budget || p.budgetItems.some(r => r.id === change.budget.id && r.auto_created_actual_expense_id === change.budget.actualId));
}
// Reuses the established pure payment transition and the metadata transport's
// lease map. Only the operation adapter and minimal committed delta are new.
export function attachDemoPayments(service, getProps, { state, commit, changed }, now = Date.now) {
  const requests = new Map(); let graph = 0;
  const rows = (kind, p = getProps()) => kind === 'budget' ? p.budgetItems : p.actualExpenses;
  function targets(kind, id) {
    const p = getProps(), row = rows(kind).find(r => r.id === id); if (!row) return null;
    if (kind === 'actual') {
      if (!row.budget_item_id && (row.budget_origin_id || row.payment_origin && row.payment_origin !== 'manual')) return null;
      if (row.budget_item_id && (!p.budgetItems.some(b => b.id === row.budget_item_id && !b.is_fixed) || row.budget_origin_id && row.budget_origin_id !== row.budget_item_id)) return null;
      return [{ kind, id }];
    }
    const payments = p.actualExpenses.filter(a => (a.budget_origin_id || a.budget_item_id) === id);
    if (row.is_fixed || payments.some(a => a.trip_id !== row.trip_id || a.budget_item_id !== id) || row.auto_created_actual_expense_id && !payments.some(a => a.id === row.auto_created_actual_expense_id)) return null;
    return [{ kind, id }, ...payments.map(a => ({ kind: 'actual', id: a.id }))];
  }
  const deps = (kind, id) => (targets(kind, id) || []).flatMap(t => (kind === 'budget' ? ['payment', 'pricing', 'payer'] : ['payment']).map(group => ({ ...t, group })));
  const get = d => state(d.kind, rows(d.kind).find(r => r.id === d.id), d.group);
  function value(kind, id) {
    const p = getProps(), row = rows(kind).find(r => r.id === id);
    return { active: kind === 'actual' ? row.payment_active !== false : p.actualExpenses.some(a => a.budget_item_id === id && a.payment_active !== false), paid_at: kind === 'actual' ? row.paid_at : null,
      versions: { graph, rates: 0, members: 0, source: 0, targets: deps(kind, id).map(d => ({ ...d, revision: get(d).revision })) } };
  }
  const originalRead = service.read.bind(service);
  service.read = async trip => {
    const result = await originalRead(trip); if (!result.ok) return result;
    const p = getProps(), data = result.data;
    data.metadataProtocol.schemaVersion = 4;
    data.paymentProtocol = { name: 'budget-payment', schemaVersion: 1, enabled: true };
    data.paymentRecords = ['budget', 'actual'].flatMap(kind => rows(kind).filter(r => r.trip_id === trip).map(row => {
      const g = state(kind, row, 'payment'), held = Boolean(g.owner && g.expires > now());
      return { kind, id: row.id, trip_id: trip, supported: Boolean(targets(kind, row.id)) && (kind !== 'actual' || Number.isFinite(Date.parse(row.paid_at))), revision: g.revision, epoch: g.epoch, value: value(kind, row.id), held, owner_id: held ? g.owner : null, own_session: held, expires_at: held ? new Date(g.expires).toISOString() : null };
    }));
    for (const r of data.metadataRecords) if (r.kind === 'budget' && !p.budgetItems.find(b => b.id === r.id)?.is_fixed) for (const g of r.groups) if (['title', 'note'].includes(g.group)) g.supported = true;
    return result;
  };
  service.paymentLease = async args => {
    const row = rows(args.p_kind).find(r => r.id === args.p_id && r.trip_id === args.p_trip_id); if (!row) return { error: { code: '42501' } };
    const root = state(args.p_kind, row, 'payment'), owns = g => g.owner === getProps().currentUserId && g.session === args.p_session_id && g.token === args.p_token;
    if (args.p_action === 'release') { if (owns(root) && root.epoch === args.p_epoch) for (const d of root.bundle || []) { const g = get(d); if (owns(g)) g.owner = null; } changed(); return { data: { granted: true } }; }
    const dependencies = deps(args.p_kind, row.id); if (!targets(args.p_kind, row.id)) return { error: { code: '0A000' } };
    if (root.revision !== args.p_base_revision || JSON.stringify(args.p_versions) !== JSON.stringify(value(args.p_kind, row.id).versions)) return { error: { code: '40001' } };
    if (dependencies.some(d => { const g = get(d); return g.owner && g.expires > now() && !owns(g); })) return { data: { granted: false } };
    for (const d of dependencies) { const g = get(d); if (!g.owner || g.expires <= now()) g.epoch++; Object.assign(g, { owner: getProps().currentUserId, session: args.p_session_id, token: args.p_token, expires: now() + 120000 }); }
    root.bundle = dependencies; changed(); return { data: { granted: true, revision: root.revision, epoch: root.epoch, value: value(args.p_kind, row.id), expires_at: new Date(root.expires).toISOString() } };
  };
  service.mutatePayment = async args => {
    const signature = JSON.stringify([args.p_trip_id, args.p_kind, args.p_id, args.p_session_id, args.p_base_revision, args.p_value]);
    const cached = requests.get(args.p_request_id); if (cached) return cached.signature === signature ? { data: structuredClone(cached.data) } : { error: { code: '22023' } };
    const p = getProps(), row = rows(args.p_kind).find(r => r.id === args.p_id), root = row && state(args.p_kind, row, 'payment');
    if (!root || root.owner !== p.currentUserId || root.token !== args.p_token || root.session !== args.p_session_id || root.epoch !== args.p_epoch || root.expires <= now()) return { error: { code: '55P03' } };
    if (root.revision !== args.p_base_revision || JSON.stringify(args.p_value.versions) !== JSON.stringify(value(args.p_kind, row.id).versions)) return { error: { code: '40001' } };
    try {
      let change = { tripId: row.trip_id, actuals: [], people: [], created: null, budget: null };
      if (args.p_kind === 'actual') {
        const paid_at = new Date(args.p_value.paid_at).toISOString(); change.actuals = [{ id: row.id, fields: { paid_at } }];
      } else {
        const retained = p.actualExpenses.filter(a => a.budget_item_id === row.id);
        if (!retained.length && args.p_value.action === 'paid') {
          const form = pricingInputs(row, p.budgetParticipants.filter(j => j.budget_item_id === row.id)), pricing = calculatePricing(form);
          if (pricing.amount !== Number(row.amount) || pricing.twd_amount !== Number(row.twd_amount) || form.participantIds.some(id => !p.members.some(m => m.user_id === id && m.status === 'approved'))) throw new Error('付款所需計價／成員資料尚未完成。');
        }
        const finance = Object.fromEntries(['budgetItems', 'budgetParticipants', 'actualExpenses', 'actualParticipants', 'itineraryBudgetLinks', 'attachments', 'tripBudgetRates', 'operations'].map(k => [k, p[k] ?? (k === 'operations' ? {} : k === 'tripBudgetRates' ? null : [])]));
        const result = saveDemoBudgetRecord(finance, 'budget', { payment_only: true, payment_action: args.p_value.action, unified_planning: true, payment_expected: retained.map(r => ({ id: r.id, updated_at: r.updated_at })) }, row.id,
          { tripId: row.trip_id, baseUpdatedAt: row.updated_at, operationId: args.p_request_id }, p.activeTrip, p.members);
        if (!result.ok) throw result.error;
        const created = result.nextState.actualExpenses.find(a => !p.actualExpenses.some(b => a.id === b.id));
        change.created = created ? { ...created, payment_active: true, payment_history: created.payment_history || [] } : null;
        change.actuals = retained.filter(r => (r.payment_active !== false) !== (args.p_value.action === 'paid')).map(r => ({ id: r.id, fields: { payment_active: args.p_value.action === 'paid' } }));
        if (created) { change.people = result.nextState.actualParticipants.filter(j => j.actual_expense_id === created.id); change.budget = { id: row.id, actualId: created.id }; }
      }
      const didChange = Boolean(change.created || change.actuals.some(a => Object.entries(a.fields).some(([k, v]) => rows('actual').find(r => r.id === a.id)?.[k] !== v)));
      commit(change); if (didChange) { graph++; for (const t of targets(args.p_kind, row.id)) state(t.kind, rows(t.kind).find(r => r.id === t.id), 'payment').revision++; changed(true); }
      const data = { id: row.id, kind: args.p_kind, group: 'payment', request_id: args.p_request_id, revision: root.revision, value: value(args.p_kind, row.id), created_id: change.created?.id || null };
      requests.set(args.p_request_id, { signature, data }); return { data: structuredClone(data) };
    } catch (error) { return { error: { code: '22023', message: error.message } }; }
  };
  return service;
}
