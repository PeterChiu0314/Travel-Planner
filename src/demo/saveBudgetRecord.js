import { budgetStage, calculateActualPricing, calculatePricing, historicalForeignBudget, preservesBudgetPricing } from "../lib/budgetFinance.js";
import { isPaymentActive } from "../lib/planningBudget.js";
import { validatePaymentChange } from "../lib/budgetPayment.js";

// A single pure transition is committed by DemoApp only after every step succeeds.
export function saveDemoBudgetRecord(state, kind, form, id, meta, trip, members, stage = budgetStage(trip)) {
  try {
    if (meta.tripId && meta.tripId !== trip.id) throw new Error("旅程已切換，請重新開啟編輯。");
    const signature = JSON.stringify({ kind, form, id, base: meta.baseUpdatedAt || null });
    const cached = state.operations?.[meta.operationId];
    if (cached) {
      if (cached.signature !== signature) throw new Error("重試內容已改變，請重新儲存。");
      return { ok: true, nextState: state, data: cached.data };
    }
    const actual = kind === "actual", key = actual ? "actualExpenses" : "budgetItems";
    const existing = state[key].find((row) => row.id === id);
    if (id && (!existing || meta.baseUpdatedAt && meta.baseUpdatedAt !== existing.updated_at)) {
      return { ok: false, conflict: true, error: new Error("資料已由其他人更新。") };
    }
    const action = form.payment_action || "keep";
    const payments = actual ? [] : validatePaymentChange(state, id, action, form.payment_expected, form.payment_confirmed, form.unified_planning);
    const lockedPricing = !actual && historicalForeignBudget(existing, stage);
    if (lockedPricing && !form.payment_only && !preservesBudgetPricing(form, existing, state.budgetParticipants, members)) throw new Error("已出發的外幣預算保留原金額與匯率，只能修改名稱、備註等資訊。");
    const participantIds = form.payment_only ? [] : [...new Set(form.participantIds || [])];
    if (!form.payment_only && (!participantIds.length || participantIds.some((id) => !members.some((member) => member.user_id === id)))) throw new Error("請選擇有效的參與成員。");
    if (!form.payment_only && !form.title.trim()) throw new Error("請填寫項目名稱。");
    const input = !actual && !lockedPricing && form.currency !== "TWD" && state.tripBudgetRates?.rates?.[form.currency]
      ? { ...form, exchange_rate: state.tripBudgetRates.rates[form.currency] } : form;
    const pricing = form.payment_only || lockedPricing ? null : actual ? calculateActualPricing(input) : calculatePricing(input);
    const next = structuredClone(state);
    const recordId = id || `demo-${kind}-${crypto.randomUUID()}`;
    const stamp = new Date(Math.max(Date.now(), new Date(existing?.updated_at || 0).getTime() + 1)).toISOString();
    let record = existing;
    if (!form.payment_only) {
      record = lockedPricing ? { ...existing, title: form.title.trim(), category: form.category || "其他", subcategory: form.subcategory || "", note: form.note || "", updated_at: stamp } : {
        ...existing, id: recordId, trip_id: trip.id, ...pricing,
        title: form.title.trim(), category: form.category || "其他", subcategory: form.subcategory || "", note: form.note || "",
        amount: pricing.amount, currency: form.currency || "TWD", payer_id: form.payer_id || null, updated_at: stamp,
        ...(actual ? { budget_item_id: form.budget_item_id || null, budget_origin_id: form.budget_item_id || existing?.budget_origin_id || null,
          paid_at: form.paid_at ? new Date(form.paid_at).toISOString() : stamp, payment_origin: "manual" } : { is_fixed: Boolean(form.is_fixed) }),
      };
      if (existing) next[key] = next[key].map((row) => row.id === recordId ? record : row);
      else next[key].push(record);
      if (!lockedPricing) {
        const join = actual ? "actualParticipants" : "budgetParticipants", foreignKey = actual ? "actual_expense_id" : "budget_item_id";
        next[join] = [...next[join].filter((row) => row[foreignKey] !== recordId), ...participantIds.map((user_id) => ({ id: crypto.randomUUID(), [foreignKey]: recordId, user_id, share_amount: pricing.shares[user_id] }))];
      }
      if (!actual) next.itineraryBudgetLinks = [...next.itineraryBudgetLinks.filter((row) => row.budget_item_id !== recordId), ...(form.linkedItemIds || []).map((itinerary_item_id) => ({ id: crypto.randomUUID(), budget_item_id: recordId, itinerary_item_id }))];
    }
    if (!actual) {
      if (!record) throw new Error("找不到預算項目。");
      if ((action === "paid" || action === "keep" && form.is_fixed) && !payments.length) {
        const actualId = `demo-actual-${crypto.randomUUID()}`;
        next.actualExpenses.push({ ...record, id: actualId, budget_item_id: recordId, budget_origin_id: recordId,
          paid_at: stamp, payment_origin: "budget_toggle", twd_amount_source: record.currency === "TWD" ? "actual" : "estimated", actual_twd_amount: record.currency === "TWD" ? record.twd_amount : null, is_fixed: undefined });
        next.actualParticipants.push(...next.budgetParticipants.filter((row) => row.budget_item_id === recordId).map(({ user_id, share_amount }) => ({ id: crypto.randomUUID(), actual_expense_id: actualId, user_id, share_amount })));
        next.budgetItems = next.budgetItems.map((row) => row.id === recordId ? { ...row, auto_created_actual_expense_id: actualId } : row);
      } else if (action === "unpaid" && !form.unified_planning) {
        const ids = new Set(payments.map((row) => row.id));
        next.actualExpenses = next.actualExpenses.filter((row) => !ids.has(row.id));
        next.actualParticipants = next.actualParticipants.filter((row) => !ids.has(row.actual_expense_id));
        next.budgetItems = next.budgetItems.map((row) => row.id === recordId ? { ...row, auto_created_actual_expense_id: null } : row);
      }
    }
    if (!actual && form.unified_planning) {
      const retained = next.actualExpenses.filter((row) => row.budget_item_id === recordId);
      if (!form.payment_only && form.sync_payment && retained.length > 1) throw new Error("此項目包含多筆既有付款，請在下方付款紀錄逐筆修改金額。");
      next.actualExpenses = next.actualExpenses.map((row) => {
        if (row.budget_item_id !== recordId) return row;
        const active = action === "paid" ? true : action === "unpaid" ? false : isPaymentActive(row);
        if (!form.payment_only && form.sync_payment && payments.length === 1) {
          const history = [...(row.payment_history || []), { ...row, payment_history: undefined }];
          return { ...row, ...pricing, title: record.title, category: record.category, note: record.note, currency: record.currency,
            payer_id: record.payer_id, payment_active: active, payment_history: history, updated_at: stamp,
            twd_amount_source: record.currency === "TWD" ? "actual" : "estimated", actual_twd_amount: record.currency === "TWD" ? pricing.twd_amount : null };
        }
        return { ...row, payment_active: active, updated_at: stamp };
      });
      if (!form.payment_only && form.sync_payment && payments.length === 1) {
        const actualId = retained[0].id;
        next.actualParticipants = [...next.actualParticipants.filter((row) => row.actual_expense_id !== actualId), ...participantIds.map((user_id) => ({actual_expense_id: actualId,user_id,share_amount:pricing.shares[user_id]}))];
      }
    }
    const data = { id: recordId, updated_at: record?.updated_at || stamp };
    if (meta.operationId) next.operations = { ...next.operations, [meta.operationId]: { signature, data } };
    return { ok: true, data, nextState: next };
  } catch (error) { return { ok: false, error, conflict: error.code === "40001" }; }
}
