const version = n => Number.isSafeInteger(n) && n >= 0;
const targetKey = t => `${t?.kind}:${t?.id}:${t?.group}`;
const targetsEqual = (a, b) => a.length === b.length && a.every(t => b.some(u => targetKey(t) === targetKey(u)));
export function paymentLeaseTargets(kind, id, versions, intent) {
  return versions.targets.filter(t => intent !== 'unpaid' || t.group === 'payment');
}
export function validPaymentAdmission(data, kind, id, intent, expected) {
  return data?.intent === intent && version(data.epoch) && Array.isArray(data.targets)
    && data.targets.every(t => t && version(t.epoch)) && new Set(data.targets.map(targetKey)).size === data.targets.length
    && targetsEqual(data.targets, expected) && data.targets.some(t => t.kind === kind && t.id === id && t.group === 'payment' && t.epoch === data.epoch);
}
export const validPaymentValue = (value, legacyReceipt = false) => value && typeof value.active === 'boolean' && value.versions
  && ['graph', 'rates', 'members', 'source'].every(k => version(value.versions[k]))
  && Array.isArray(value.versions.targets) && new Set(value.versions.targets.map(targetKey)).size === value.versions.targets.length
  && value.versions.targets.every(t => t && ['budget', 'actual'].includes(t.kind) && ['payment', 'pricing', 'payer'].includes(t.group) && typeof t.id === 'string' && version(t.revision))
  && (legacyReceipt && value.versions.checks === undefined || Array.isArray(value.versions.checks) && new Set(value.versions.checks.map(targetKey)).size === value.versions.checks.length
  && value.versions.checks.every(t => t && ['budget', 'actual'].includes(t.kind) && ['pricing', 'payer'].includes(t.group) && typeof t.id === 'string' && version(t.revision) && version(t.graph)));
export function validPaymentSnapshot(data) {
  return data.paymentProtocol?.name === 'budget-payment' && data.paymentProtocol.schemaVersion === 2 && typeof data.paymentProtocol.enabled === 'boolean'
    && Array.isArray(data.paymentRecords) && data.paymentRecords.length === data.budgetItems.length + data.actualExpenses.length
    && new Set(data.paymentRecords.map(r => `${r.kind}:${r.id}`)).size === data.paymentRecords.length
    && data.paymentRecords.every(r => {
      const row = (r.kind === 'budget' ? data.budgetItems : data.actualExpenses).find(p => p.id === r.id);
      return ['budget', 'actual'].includes(r.kind) && row && row.trip_id === data.tripId && r.trip_id === data.tripId
        && typeof r.supported === 'boolean' && version(r.revision) && version(r.epoch) && validPaymentValue(r.value)
        && (r.supported === false || (() => {
          const retained = r.kind === 'budget' ? data.actualExpenses.filter(a => a.budget_item_id === r.id) : [];
          const parents = [{ kind: r.kind, id: r.id }, ...retained.map(a => ({ kind: 'actual', id: a.id }))];
          const expected = parents.flatMap(t => (r.kind === 'budget' && !retained.length ? ['payment', 'pricing', 'payer'] : ['payment']).map(group => ({ ...t, group })));
          const source = r.kind === 'actual' && row.budget_item_id ? [{ kind: 'budget', id: row.budget_item_id }] : [];
          const checks = [...parents, ...source].flatMap(t => ['pricing', 'payer'].map(group => ({ ...t, group })));
          return targetsEqual(r.value.versions.targets, expected) && targetsEqual(r.value.versions.checks, checks)
            && r.value.versions.checks.every(t => { const g = data.metadataRecords?.find(x => x.kind === t.kind && x.id === t.id)?.groups?.find(g => g.group === t.group);
              return g && g.revision === t.revision && (t.group !== 'pricing' || g.value?.versions?.graph === t.graph); })
            && r.value.versions.targets.some(t => t.kind === r.kind && t.id === r.id && t.group === 'payment' && t.revision === r.revision);
        })())
        && r.value.active === (r.kind === 'actual' ? row.payment_active !== false : data.actualExpenses.some(a => a.budget_item_id === r.id && a.payment_active !== false))
        && (r.kind !== 'actual' || Date.parse(r.value.paid_at) === Date.parse(row.paid_at) || !r.supported && r.value.paid_at == null && row.paid_at == null)
        && typeof r.held === 'boolean' && typeof r.own_session === 'boolean' && (!r.held || typeof r.owner_id === 'string' && Number.isFinite(Date.parse(r.expires_at)));
    });
}
