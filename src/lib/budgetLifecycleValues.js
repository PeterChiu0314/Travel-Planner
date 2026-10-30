export const budgetLifecycleEnabled = import.meta.env?.VITE_BUDGET_LIFECYCLE==='true';
// Missing status belongs to the verified legacy schema. New schemas require DB fields.
export const isBudgetComplete = row => row?.record_status === undefined || row.record_status === 'complete';
const version = n => Number.isSafeInteger(n) && n >= 0;
const object = v => Boolean(v && typeof v === 'object' && !Array.isArray(v));
export const validLifecycleValue = v => object(v) && typeof v.exists === 'boolean' && object(v.versions);
export function validLifecycleSnapshot(d) {
  const records = d.lifecycleRecords;
  if (d.lifecycleProtocol?.name !== 'budget-lifecycle' || d.lifecycleProtocol.schemaVersion !== 1
    || typeof d.lifecycleProtocol.enabled !== 'boolean' || !Array.isArray(records)
    || new Set(records.map(r => r.kind + ':' + r.id)).size !== records.length
    || records.filter(r => r.kind === 'trip').length !== 1) return false;
  if (!records.every(r => ['trip', 'budget', 'actual'].includes(r.kind) && typeof r.id === 'string'
    && r.trip_id === d.tripId && version(r.revision) && typeof r.supported === 'boolean' && validLifecycleValue(r.value)
    && (r.kind !== 'trip' || r.id === d.tripId && r.value.exists))) return false;
  return [['budget', d.budgetItems], ['actual', d.actualExpenses]].every(([kind, rows]) => rows.every(r => {
    const life = records.find(l => l.kind === kind && l.id === r.id);
    return ['incomplete', 'complete'].includes(r.record_status) && typeof r.pricing_ready === 'boolean'
      && (r.record_status !== 'complete' || r.pricing_ready && (kind !== 'actual' || Number.isFinite(Date.parse(r.paid_at))))
      && version(r.lifecycle_revision) && (r.completed_at === null || Number.isFinite(Date.parse(r.completed_at)))
      && life?.value.exists && life.revision === r.lifecycle_revision
      && life.value.versions.lifecycle === r.lifecycle_revision && Array.isArray(life.value.versions.groups)
      && life.value.versions.groups.every(g => typeof g.group === 'string' && version(g.revision) && version(g.graph));
  })) && records.every(l => l.kind === 'trip' || !l.value.exists
    || (l.kind === 'budget' ? d.budgetItems : d.actualExpenses).some(r => r.id === l.id));
}
