import { calculateActualPricing, calculatePricing, participantsFor, recordAllocations } from "./budgetFinance.js";
import {isBudgetComplete} from './budgetLifecycleValues.js';

export const isPaymentActive = (expense) => expense.payment_active !== false;

// One planning row shows the retained payment amount. Original payment records
// (including FX, receipt identity and multiple legacy payments) remain intact.
export function planningBudgetData(budgets, expenses, people, members) {
  const rows = [], participants = [];
  for (const budget of budgets) {
    const retained = expenses.filter((expense) => isBudgetComplete(expense)&&expense.budget_item_id === budget.id);
    if (!retained.length) { rows.push(budget); continue; }
    const active = retained.filter(isPaymentActive);
    const payments = active.length ? active : retained;
    const shares = {};
    let known = true;
    for (const expense of payments) {
      const allocation = recordAllocations(expense, participantsFor(expense, people, "actual_expense_id", members));
      if (!allocation) known = false;
      for (const [id, amount] of Object.entries(allocation || {})) shares[id] = (shares[id] || 0) + amount;
    }
    const total = payments.reduce((sum, expense) => sum + Number(expense.twd_amount), 0);
    rows.push({ ...budget, amount: total, currency: "TWD", exchange_rate: 1, twd_amount: total,
      pricing_mode: payments.length === 1 && payments[0].pricing_mode !== "custom" ? "split_total" : "custom", split_type: payments.length === 1 && payments[0].pricing_mode !== "custom" ? "equal" : "custom", unit_amount: null,
      payer_id: payments.length === 1 ? payments[0].payer_id : budget.payer_id,
      payment_count: retained.length, payment_readonly: !known || retained.length > 1 });
    const ids = known ? Object.keys(shares) : [...new Set(payments.flatMap((expense) => participantsFor(expense, people, "actual_expense_id", members).map((row) => row.user_id)))];
    for (const id of ids) participants.push({ budget_item_id: budget.id, user_id: id, share_amount: known ? shares[id] : null });
  }
  return { rows, participants };
}

export function calculateEntryPricing(form) {
  if (form.twd_amount_source === "legacy" || form.twd_amount_source === "actual" && form.currency !== "TWD") return calculateActualPricing(form);
  const pricing = calculatePricing(form);
  return form.currency === "TWD" ? { ...pricing, twd_amount_source: "actual", actual_twd_amount: pricing.twd_amount }
    : { ...pricing, twd_amount_source: "estimated", actual_twd_amount: null };
}
