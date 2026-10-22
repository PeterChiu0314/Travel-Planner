/** One canonical shared row powers the team list and the assignee's personal view. */
export function transitionSharedLuggage(item, patch, { userId, isOwner = false, approvedMemberIds = [] } = {}) {
  const next = { ...item, ...patch };
  const contentChanged = ["title", "category", "assigned_to"].some((key) =>
    Object.hasOwn(patch, key) && (patch[key] || null) !== (item[key] || null));
  if (Object.hasOwn(patch, "assigned_to") && next.assigned_to && !approvedMemberIds.includes(next.assigned_to)) {
    throw new Error("luggage_invalid_assignee");
  }
  if (contentChanged) {
    next.packed_by_assignee = false;
    next.confirmed_by_owner = false;
    return next;
  }
  if (Object.hasOwn(patch, "packed_by_assignee") && next.packed_by_assignee !== item.packed_by_assignee) {
    if (!item.assigned_to || item.assigned_to !== userId) throw new Error("luggage_forbidden");
    next.confirmed_by_owner = false;
  }
  if (Object.hasOwn(patch, "confirmed_by_owner") && next.confirmed_by_owner !== item.confirmed_by_owner) {
    if (!isOwner) throw new Error("luggage_forbidden");
    if (next.confirmed_by_owner && !next.packed_by_assignee) throw new Error("luggage_not_packed");
    if (next.confirmed_by_owner && !approvedMemberIds.includes(next.assigned_to)) throw new Error("luggage_invalid_assignee");
  }
  if (!next.assigned_to || !next.packed_by_assignee) next.confirmed_by_owner = false;
  if (!next.assigned_to) next.packed_by_assignee = false;
  return next;
}

const errorMessages = {
  luggage_forbidden: "你沒有權限執行此行李操作。",
  luggage_not_packed: "請先由負責成員確認打包，再由總召確認。",
  luggage_invalid_assignee: "請指派目前旅程中已核准的成員。",
  luggage_invalid_payload: "請檢查物品名稱與操作內容。",
  luggage_stale: "這件物品已被其他人更新，請依最新內容重試。",
  luggage_locked: "這件物品正由其他成員編輯，請稍後重試。",
  luggage_not_found: "這件物品已刪除或你無法存取。",
};

export function luggageErrorMessage(error) {
  const raw = String(error?.message || error || "");
  const key = Object.keys(errorMessages).find((code) => raw.includes(code));
  if (key) return errorMessages[key];
  if (error?.code === "PGRST202" || error?.code === "42883") return "行李協作功能需要先更新資料庫，請聯絡管理者。";
  return raw || "行李操作未完成，請重試。";
}

/** No fallback table writes: absent migration must fail closed, preserving shared state rules. */
export async function mutateLuggageItem({ client, tripId, scope, action, itemId = null, baseUpdatedAt = null, payload = {} }) {
  if (!tripId || !["personal", "shared"].includes(scope) || !["save", "patch", "delete"].includes(action)) {
    return { ok: false, data: null, error: new Error("luggage_invalid_payload"), conflict: false };
  }
  try {
    const { data, error } = await client.rpc("mutate_luggage_item", {
      p_trip_id: tripId, p_scope: scope, p_action: action,
      p_item_id: itemId, p_expected_updated_at: baseUpdatedAt, p_payload: payload,
    });
    return { ok: !error, data, error, conflict: Boolean(error?.message?.includes("luggage_stale")) };
  } catch (error) {
    return { ok: false, data: null, error, conflict: Boolean(error?.message?.includes("luggage_stale")) };
  }
}
