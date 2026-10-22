// Money is calculated in original-currency cents and six-decimal FX, then
// rounded once to whole TWD. Stable largest-remainder allocations reconcile.
export const pricingLabels = { per_person: "每人計價", split_total: "總額均分", custom: "自訂分攤" };
export const money = (value) => Math.round(Number(value || 0)).toLocaleString("zh-TW");
export const memberLabel = (member) => member?.display_name || member?.email || member?.user_id || "未指定";

function decimal(value, digits, label) {
  const text = String(value ?? "").trim();
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`).test(text)) throw new Error(`${label}請輸入非負數，最多 ${digits} 位小數。`);
  const [whole, fraction = ""] = text.split(".");
  const result = BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, "0"));
  if (result > 999999999999n) throw new Error(`${label}超過可儲存範圍。`);
  return result;
}
const roundDivide = (a, b) => (a + b / 2n) / b;
const fromCents = (value) => Number(value) / 100;

export function allocateWhole(total, weights) {
  const sorted = [...weights].sort(([a], [b]) => a.localeCompare(b));
  const sum = sorted.reduce((value, [, weight]) => value + weight, 0n);
  if (!sum) return Object.fromEntries(sorted.map(([id]) => [id, 0]));
  const shares = sorted.map(([id, weight]) => ({ id, value: total * weight / sum, remainder: total * weight % sum }));
  let remaining = total - shares.reduce((value, row) => value + row.value, 0n);
  [...shares].sort((a, b) => a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1)
    .forEach((row) => { if (remaining > 0n) { row.value += 1n; remaining -= 1n; } });
  return Object.fromEntries(shares.map((row) => [row.id, Number(row.value)]));
}

export function calculatePricing(form) {
  const ids = [...new Set(form.participantIds || [])].sort();
  if (!ids.length) throw new Error("請至少選擇一位參與成員。");
  const mode = form.pricing_mode || "split_total";
  if (!pricingLabels[mode]) throw new Error("不支援的計價方式。");
  const rate = form.currency === "TWD" ? 1000000n : decimal(form.exchange_rate, 6, "匯率");
  if (!rate) throw new Error("匯率必須大於 0。");
  const unit = mode === "per_person" ? decimal(form.unit_amount, 2, "每人單價") : null;
  const weights = ids.map((id) => [id, mode === "custom" ? decimal(form.shares?.[id], 2, "成員金額") : 1n]);
  const cents = mode === "per_person" ? unit * BigInt(ids.length) : mode === "custom"
    ? weights.reduce((sum, [, amount]) => sum + amount, 0n) : decimal(form.amount, 2, "總額");
  if (cents > 999999999999n) throw new Error("總額超過可儲存範圍。");
  const twd = roundDivide(cents * rate, 100000000n);
  if (twd > 9999999999n) throw new Error("台幣總額超過可儲存範圍。");
  const originalShares = allocateWhole(cents, weights);
  return {
    amount: fromCents(cents), unit_amount: unit === null ? null : fromCents(unit), twd_amount: Number(twd),
    exchange_rate: Number(rate) / 1000000, pricing_mode: mode, split_type: mode === "custom" ? "custom" : "equal",
    allocations: allocateWhole(twd, weights),
    shares: Object.fromEntries(Object.entries(originalShares).map(([id, amount]) => [id, amount / 100])),
  };
}

export function calculateActualPricing(form) {
  const source = form.twd_amount_source || "estimated";
  if (!["actual", "estimated", "legacy"].includes(source)) throw new Error("請選擇有效的台幣金額來源。");
  // A known debit does not require the traveler to reverse-engineer an FX rate.
  const pricing = calculatePricing({ ...form, exchange_rate: source === "estimated" ? form.exchange_rate : 1 });
  if (source === "estimated") return { ...pricing, twd_amount_source: source, actual_twd_amount: null };
  const text = String(form.actual_twd_amount ?? "").trim();
  if (!(source === "legacy" ? /^\d+(?:\.\d{1,2})?$/ : /^\d+$/).test(text) || Number(text) > 9999999999) throw new Error("台幣扣款金額請輸入有效的非負整數。");
  const twd = Number(text);
  const weights = form.participantIds.map((id) => [id, form.pricing_mode === "custom" ? decimal(form.shares?.[id], 2, "分攤金額") : 1n]);
  if (twd > 0 && !weights.some(([, value]) => value > 0n)) throw new Error("自訂分攤合計為零，無法分配非零台幣成本。");
  const referenceRate = form.currency === "TWD" ? 1 : String(form.exchange_rate ?? "").trim() ? Number(decimal(form.exchange_rate, 6, "參考匯率")) / 1000000 : null;
  if (referenceRate === 0) throw new Error("參考匯率必須大於 0。");
  return { ...pricing, exchange_rate: referenceRate, twd_amount: twd, allocations: allocateWhole(BigInt(Math.round(twd)), weights), twd_amount_source: source, actual_twd_amount: twd };
}

export function historicalForeignBudget(record, stage) {
  return Boolean(record && record.currency !== "TWD" && stage !== "planning");
}

export function preservesBudgetPricing(form, record, participantRows, members = []) {
  const people = participantRows.filter((row) => row.budget_item_id === record.id);
  const ids = (people.length ? people : members).map((row) => row.user_id).sort();
  const selected = [...new Set(form.participantIds || [])].sort();
  return (form.currency || "TWD") === record.currency
    && Number(form.amount) === Number(record.amount)
    && Number(form.exchange_rate) === Number(record.exchange_rate)
    && (form.pricing_mode || "split_total") === (record.pricing_mode || "split_total")
    && Number(form.unit_amount || 0) === Number(record.unit_amount || 0)
    && JSON.stringify(ids) === JSON.stringify(selected)
    && (record.pricing_mode !== "custom" || people.every((row) => Number(form.shares?.[row.user_id]) === Number(row.share_amount)));
}

export function participantsFor(record, rows, key, members) {
  const matches = rows.filter((row) => row[key] === record.id);
  // Legacy records with no join rows used all approved members. Explicitly
  // empty selections in new forms are rejected, never silently expanded.
  return matches.length ? matches : members.map((member) => ({ user_id: member.user_id }));
}

export function recordAllocations(record, participants) {
  if ((record.twd_amount_source || "legacy") === "legacy" && !Number.isInteger(Number(record.twd_amount))) return null;
  const custom = record.pricing_mode === "custom" || record.split_type === "custom";
  const weights = participants.map((row) => [row.user_id, record.pricing_mode === "custom" || record.split_type === "custom"
    ? row.share_amount == null ? null : decimal(row.share_amount, 2, "分攤金額") : 1n]);
  if (weights.some(([, value]) => value === null)) return null;
  if (custom && weights.reduce((sum, [, value]) => sum + value, 0n) !== decimal(record.amount, 2, "總額")) return null;
  if (Number(record.twd_amount) > 0 && !weights.some(([, value]) => value > 0n)) return null;
  return allocateWhole(BigInt(Math.round(Number(record.twd_amount || 0))), weights);
}

export function recordForm(record, rows, key, members, links = []) {
  const participants = record ? participantsFor(record, rows, key, members) : members.map((member) => ({ user_id: member.user_id }));
  return {
    category: record?.category || "其他", subcategory: record?.subcategory || "", title: record?.title || "",
    amount: record?.amount ?? 0, currency: record?.currency || "TWD", exchange_rate: record ? record.exchange_rate ?? "" : 1,
    pricing_mode: record?.pricing_mode || (record?.split_type === "custom" ? "custom" : "split_total"),
    unit_amount: record?.unit_amount ?? "", shares: Object.fromEntries(participants.map((row) => [row.user_id, row.share_amount ?? ""])),
    payer_id: record?.payer_id || "", note: record?.note || "", is_fixed: Boolean(record?.is_fixed),
    participantIds: participants.map((row) => row.user_id), linkedItemIds: links.filter((row) => row.budget_item_id === record?.id).map((row) => row.itinerary_item_id),
    budget_item_id: record?.budget_item_id || "", paid_at: record?.paid_at ? localDateTime(record.paid_at) : localDateTime(),
    twd_amount_source: record ? record.twd_amount_source || "legacy" : "estimated",
    actual_twd_amount: record ? record.actual_twd_amount ?? record.twd_amount ?? "" : "",
  };
}
export function localDateTime(value = new Date()) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function budgetDay(record, links, items) {
  const ids = new Set(links.filter((link) => link.budget_item_id === (record.budget_item_id || record.id)).map((link) => link.itinerary_item_id));
  const days = [...new Set(items.filter((item) => ids.has(item.id)).map((item) => Number(item.day_index) + 1))].sort((a, b) => a - b);
  if (!days.length) return "—";
  if (days.length > 1 && days.every((day, index) => !index || day === days[index - 1] + 1)) return `Day ${days[0]}–${days.at(-1)}`;
  return `Day ${days.join("、")}`;
}

export function budgetStage(trip, today = new Date()) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(today);
  if (trip?.status === "settled" || (trip?.end_date && date > trip.end_date)) return "settled";
  if (trip?.start_date && date >= trip.start_date) return "traveling";
  return "planning";
}

export function comparisonRows(baseline, expenses) {
  expenses = expenses.filter((row) => row.payment_active !== false);
  const planned = baseline?.payload?.items || [];
  const plannedIds = new Set(planned.map((row) => row.id));
  const rows = planned.map((row) => {
    const actual = expenses.filter((expense) => (expense.budget_origin_id || expense.budget_item_id) === row.id).reduce((sum, expense) => sum + Number(expense.twd_amount), 0);
    return { ...row, planned: Number(row.twd_amount), actual, difference: actual - Number(row.twd_amount), unrecorded: !expenses.some((expense) => (expense.budget_origin_id || expense.budget_item_id) === row.id) };
  });
  expenses.filter((expense) => !plannedIds.has(expense.budget_origin_id || expense.budget_item_id)).forEach((expense) => rows.push({ ...expense, planned: 0, actual: Number(expense.twd_amount), difference: Number(expense.twd_amount), category: expense.category || "其他", extra: true }));
  return rows;
}

export function settlementBalances(expenses, participants, members) {
  const totals = Object.fromEntries(members.map((member) => [member.user_id, { ...member, paid: 0, shouldPay: 0 }]));
  let incomplete = false;
  expenses.filter((row) => row.payment_active !== false).forEach((expense) => {
    const people = participantsFor(expense, participants, "actual_expense_id", members);
    const shares = recordAllocations(expense, people);
    if (!shares || !totals[expense.payer_id]) incomplete = true;
    if (totals[expense.payer_id]) totals[expense.payer_id].paid += Number(expense.twd_amount);
    Object.entries(shares || {}).forEach(([id, amount]) => {
      if (!totals[id]) { incomplete = true; return; }
      totals[id].shouldPay += amount;
    });
  });
  return { incomplete, balances: Object.values(totals).map((member) => ({ ...member, name: memberLabel(member), balance: member.paid - member.shouldPay })) };
}
