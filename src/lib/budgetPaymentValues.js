const version = n => Number.isSafeInteger(n) && n >= 0;
export const validPaymentValue = value => value && typeof value.active === 'boolean' && value.versions
  && ['graph', 'rates', 'members', 'source'].every(k => version(value.versions[k]))
  && Array.isArray(value.versions.targets) && new Set(value.versions.targets.map(t => `${t.kind}:${t.id}:${t.group}`)).size === value.versions.targets.length
  && value.versions.targets.every(t => ['budget', 'actual'].includes(t.kind) && ['payment', 'pricing', 'payer'].includes(t.group) && typeof t.id === 'string' && version(t.revision));
export function validPaymentSnapshot(data) {
  return data.paymentProtocol?.name === 'budget-payment' && data.paymentProtocol.schemaVersion === 1 && typeof data.paymentProtocol.enabled === 'boolean'
    && Array.isArray(data.paymentRecords) && data.paymentRecords.length === data.budgetItems.length + data.actualExpenses.length
    && new Set(data.paymentRecords.map(r => `${r.kind}:${r.id}`)).size === data.paymentRecords.length
    && data.paymentRecords.every(r => {
      const row = (r.kind === 'budget' ? data.budgetItems : data.actualExpenses).find(p => p.id === r.id);
      return ['budget', 'actual'].includes(r.kind) && row && row.trip_id === data.tripId && r.trip_id === data.tripId
        && typeof r.supported === 'boolean' && version(r.revision) && version(r.epoch) && validPaymentValue(r.value)
        && (r.supported === false || r.value.versions.targets.some(t => t.kind === r.kind && t.id === r.id && t.group === 'payment' && t.revision === r.revision))
        && r.value.active === (r.kind === 'actual' ? row.payment_active !== false : data.actualExpenses.some(a => a.budget_item_id === r.id && a.payment_active !== false))
        && (r.kind !== 'actual' || Date.parse(r.value.paid_at) === Date.parse(row.paid_at) || !r.supported && r.value.paid_at == null && row.paid_at == null)
        && typeof r.held === 'boolean' && typeof r.own_session === 'boolean' && (!r.held || typeof r.owner_id === 'string' && Number.isFinite(Date.parse(r.expires_at)));
    });
}
