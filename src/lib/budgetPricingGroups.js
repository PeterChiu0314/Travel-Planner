import { calculatePricing, calculateActualPricing } from "./budgetFinance.js";

// A new Lifecycle placeholder has no participant rows yet. This is a local
// default only: the first intentional edit still goes through pricing admission.
export function initialPricingDraft(value, record, members) {
  if (record.record_status !== 'incomplete' || record.pricing_ready || value.participantIds.length) return value;
  return { ...value, participantIds: members.filter(m => m.status === 'approved').map(m => m.user_id),
    shares: value.pricing_mode === 'custom' ? Object.fromEntries(members.filter(m => m.status === 'approved').map(m => [m.user_id, 0])) : value.shares };
}

export function pricingModeDraft(value, mode, previousCustom) {
  if (mode === value.pricing_mode) return value;
  let pricing; try { pricing = calculatePricing(value); } catch { /* Keep incomplete amounts incomplete. */ }
  let cached;
  if (pricing && previousCustom) try {
    const result = calculatePricing({ ...value, pricing_mode: 'custom', shares: previousCustom });
    if (result.amount === pricing.amount) cached = previousCustom;
  } catch { /* A stale/incomplete cache must not omit new participants. */ }
  const next = { ...value, pricing_mode: mode };
  if (pricing) next.amount = pricing.amount;
  if (mode === 'per_person') next.unit_amount = pricing && value.participantIds.length
    ? Math.round(pricing.amount / value.participantIds.length * 100) / 100 : value.unit_amount;
  if (mode === 'custom') next.shares = Object.fromEntries(value.participantIds.map(id => [id,
    cached ? cached[id] : pricing?.shares[id] ?? (pricing ? 0 : '')]));
  return next;
}

export function pricingParticipantsDraft(value, participantIds) {
  return { ...value, participantIds, shares: value.pricing_mode === 'custom'
    ? { ...value.shares, ...Object.fromEntries(participantIds.filter(id => !Object.hasOwn(value.shares, id)).map(id => [id, 0])) } : value.shares };
}

export const incompletePricingInput = value => !value.participantIds.length || (value.pricing_mode === 'custom'
  ? value.participantIds.some(id => String(value.shares[id] ?? '').trim() === '')
  : String((value.pricing_mode === 'per_person' ? value.unit_amount : value.amount) ?? '').trim() === '');

export const pricingInputs = (row, people = [], versions = null) => ({
  pricing_mode: row.pricing_mode || "split_total", amount: row.record_status==='incomplete'&&!row.pricing_ready?'':row.amount ?? "", unit_amount: row.unit_amount ?? null,
  currency: row.currency || "TWD", exchange_rate: row.exchange_rate ?? "",
  participantIds: people.map(p => p.user_id).sort(),
  shares: row.pricing_mode === "custom" ? Object.fromEntries(people.map(p => [p.user_id, p.share_amount])) : {}, versions,
});
export function normalizePricingInputs(value, includeVersions = true) {
  const p = calculatePricing(value);
  return { pricing_mode: p.pricing_mode, amount: p.amount, unit_amount: p.unit_amount, currency: value.currency,
    exchange_rate: p.exchange_rate, participantIds: [...new Set(value.participantIds)].sort(),
    shares: p.pricing_mode === "custom" ? Object.fromEntries([...new Set(value.participantIds)].sort().map(id => [id, Number(value.shares[id])])) : {},
    ...(includeVersions ? { versions: value.versions } : {}) };
}
export function pricingInputError(value) { try { normalizePricingInputs(value); return ""; } catch (error) { return error.message; } }
export function pricingPreview(value, record, kind) {
  if(record.record_status==='incomplete')return calculatePricing(value);
  return kind === "actual" ? calculateActualPricing({ ...value, twd_amount_source: record.twd_amount_source || "legacy", actual_twd_amount: record.actual_twd_amount ?? record.twd_amount }) : calculatePricing(value);
}
export const validPricingInputShape = value => value && typeof value === "object" && !Array.isArray(value)
  && ["per_person", "split_total", "custom"].includes(value.pricing_mode) && typeof value.currency === "string"
  && Array.isArray(value.participantIds) && value.participantIds.every(id => typeof id === "string")
  && value.shares && typeof value.shares === "object" && !Array.isArray(value.shares);
export function pricingContent(value) {
  try { return normalizePricingInputs(value, false); } catch {
    if (!value || typeof value !== "object") return value;
    return { pricing_mode: value.pricing_mode, amount: String(value.amount ?? ""), unit_amount: String(value.unit_amount ?? ""),
      currency: value.currency, exchange_rate: String(value.exchange_rate ?? ""), participantIds: [...value.participantIds || []].sort(),
      shares: Object.fromEntries(Object.entries(value.shares || {}).sort(([a], [b]) => a.localeCompare(b))) };
  }
}
export const validPricingVersions = v => v && [v.graph, v.rates, v.members].every(n => Number.isSafeInteger(n) && n >= 0)
  && Array.isArray(v.targets) && new Set(v.targets.map(t => `${t.kind}:${t.id}`)).size === v.targets.length
  && v.targets.every(t => ["budget", "actual"].includes(t.kind) && typeof t.id === "string" && Number.isSafeInteger(t.revision) && t.revision >= 0);

// Pure memory transition for Demo. Formal writes use only the database RPC.
export function applyDemoPricing(finance, kind, id, value) {
  const next = { ...finance };
  const budget = kind === "budget" && finance.budgetItems.find(r => r.id === id);
  const peers = budget ? finance.actualExpenses.filter(r => (r.budget_origin_id || r.budget_item_id) === id) : [];
  if (budget?.is_fixed || peers.length > 1 || budget?.auto_created_actual_expense_id && budget.auto_created_actual_expense_id !== peers[0]?.id
    || peers.some(r => r.trip_id !== budget.trip_id || r.budget_item_id !== id || r.payment_origin !== "budget_toggle" || r.budget_origin_id !== id || r.currency !== budget.currency || Number(r.exchange_rate) !== Number(budget.exchange_rate))) throw new Error("此付款關聯尚未支援計價群組。");
  if (peers.length && (value.currency !== budget.currency || Number(value.exchange_rate) !== Number(budget.exchange_rate))) throw new Error("保留付款的幣別與歷史匯率不可變更。");
  for (const [targetKind, targetId] of [[kind, id], ...peers.map(r => ["actual", r.id])]) {
    const rows = targetKind === "budget" ? "budgetItems" : "actualExpenses", people = targetKind === "budget" ? "budgetParticipants" : "actualParticipants";
    const parent = targetKind === "budget" ? "budget_item_id" : "actual_expense_id", row = next[rows].find(r => r.id === targetId);
    if (!row || targetKind === "actual" && !budget && (row.budget_item_id || row.budget_origin_id || row.payment_origin && row.payment_origin !== "manual")) throw new Error("請從來源預算編輯計價群組。");
    const computed = calculatePricing(value), pricing = pricingPreview(value, row, targetKind);
    if (targetKind === "actual" && row.record_status!=='incomplete' && (row.twd_amount_source || "legacy") !== "estimated" && (budget || value.currency === "TWD") && computed.twd_amount !== Number(row.actual_twd_amount ?? row.twd_amount)) throw new Error("此修改會改變已知台幣扣款，請保留付款成本。");
    const fields = Object.fromEntries(["pricing_mode", "amount", "unit_amount", "currency", "exchange_rate", "split_type", "twd_amount"].map(k => [k, k === "currency" ? value.currency : pricing[k]]));
    if(targetKind==='actual'&&row.record_status==='incomplete')Object.assign(fields,{twd_amount_source:value.currency==='TWD'?'actual':'estimated',actual_twd_amount:value.currency==='TWD'?computed.twd_amount:null});
    next[rows] = next[rows].map(r => r.id === targetId ? { ...r, ...fields } : r);
    const existing = next[people] || [];
    next[people] = [...existing.filter(p => p[parent] !== targetId), ...value.participantIds.map(user_id => ({
      ...existing.find(p => p[parent] === targetId && p.user_id === user_id), [parent]: targetId, user_id, share_amount: pricing.shares[user_id] }))];
  }
  return next;
}
