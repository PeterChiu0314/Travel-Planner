import { money } from "./budgetFinance.js";

export const paymentSnapshot = (payments) => payments.map((row) => ({ id: row.id, updated_at: row.updated_at || null })).sort((a, b) => a.id.localeCompare(b.id));

export function validatePaymentChange(state, budgetId, action, expected, confirmed = false, retain = false) {
  const payments = budgetId ? state.actualExpenses.filter((row) => row.budget_item_id === budgetId) : [];
  if (!["keep", "paid", "unpaid"].includes(action)) throw new Error("無效的付款變更。");
  if (action === "keep" && !retain) return payments;
  if (JSON.stringify(paymentSnapshot(payments)) !== JSON.stringify(paymentSnapshot(expected || []))) {
    const error = new Error("實付資料已變更，請重新開啟後確認。"); error.code = "40001"; throw error;
  }
  if (retain) return payments;
  if (action === "unpaid" && payments.length && !confirmed) throw new Error("取消付款前必須確認刪除實付資料。");
  if (action === "unpaid" && (state.attachments || []).some((row) => row.target_type === "actual_expense" && payments.some((payment) => payment.id === row.target_id))) {
    throw new Error("實付含有收據，無法從預算直接取消。請先至實付明細處理附件；目前付款與收據均已保留。");
  }
  return payments;
}

export async function preparePaymentChange(props, budgetId, paid, retain = false) {
  let payments = budgetId ? props.actualExpenses.filter((row) => row.budget_item_id === budgetId) : [];
  if (props.useEditLocks && budgetId) {
    const result = await props.services.readPayments(props.activeTrip.id, budgetId);
    if (result.error) throw result.error;
    payments = result.data;
  }
  if (!retain && !paid && payments.length) {
    const details = payments.map((row) => `• ${row.title}：NT$ ${money(row.twd_amount)}${row.payment_origin === "budget_toggle" ? "（由預算建立）" : "（人工或既有紀錄）"}`).join("\n");
    if (!window.confirm(`取消已付款將刪除 ${payments.length} 筆實付及其分攤資料，無法復原。\n${details}\n人工修改的金額不會保留；日後重新勾選將依當時預算重建。\n若含收據，系統會保留全部資料並要求先處理附件。確定繼續？`)) return null;
  }
  return { payment_action: paid ? "paid" : "unpaid", payment_expected: paymentSnapshot(payments), unified_planning: retain, payment_confirmed: !paid && payments.length > 0 };
}
