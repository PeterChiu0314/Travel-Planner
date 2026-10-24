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
  // Legacy clients may still send confirmation patches. The current UI only
  // reads/writes packed_by_assignee; retain this guard for compatibility.
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
  luggage_not_packed: "請先由負責成員完成打包。",
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

export async function assignLuggageItem({ client, tripId, scope, item, assignedTo }) {
  if (!tripId || !["personal", "shared"].includes(scope) || !item?.id || !item.updated_at) {
    return { ok: false, error: new Error("luggage_invalid_payload") };
  }
  try {
    const { data, error } = await client.rpc("assign_luggage_item", {
      p_trip_id: tripId, p_scope: scope, p_item_id: item.id,
      p_expected_updated_at: item.updated_at, p_assigned_to: assignedTo || null,
    });
    return { ok: !error, data, error, conflict: Boolean(error?.message?.includes("luggage_stale")) };
  } catch (error) { return { ok: false, error, conflict: Boolean(error?.message?.includes("luggage_stale")) }; }
}

/** Local-only equivalent of the atomic RPC for Demo and isolated UI fixtures. */
export function assignLuggageSnapshot(snapshot, { scope, item, assignedTo, tripId, userId, approvedMemberIds, now = Date.now() }) {
  if (!["personal", "shared"].includes(scope) || !item?.id || !item.updated_at) throw new Error("luggage_invalid_payload");
  if (!approvedMemberIds.includes(userId)) throw new Error("luggage_forbidden");
  if (assignedTo && !approvedMemberIds.includes(assignedTo)) throw new Error("luggage_invalid_assignee");
  const source = (scope === "personal" ? snapshot.luggageItems : snapshot.sharedLuggageItems).find(row => row.id === item.id && row.trip_id === tripId);
  if (!source || scope === "personal" && source.owner_id !== userId) throw new Error("luggage_not_found");
  if (source.updated_at !== item.updated_at) throw new Error("luggage_stale");
  if (source.locked_by && source.locked_by !== userId && Date.parse(source.locked_at) > now - 420000) throw new Error("luggage_locked");
  if (scope === "personal" && (source.shared_item_id || source.is_shared_assigned_item || snapshot.sharedLuggageItems.some(row => row.id === source.id))) throw new Error("luggage_invalid_payload");
  if (scope === "shared" && (source.assigned_to || "") === (assignedTo || "")) return snapshot;
  const next = scope === "personal" ? {
    id: source.id, trip_id: tripId, title: source.title, category: source.category, notes: source.notes || null,
    assigned_to: assignedTo || null, packed_by_assignee: false, confirmed_by_owner: false,
    created_at: new Date(now).toISOString(),
  } : { ...transitionSharedLuggage(source, { assigned_to: assignedTo || null }, { userId, approvedMemberIds }), locked_by: null, locked_at: null };
  next.updated_at = new Date(Math.max(now, Date.parse(source.updated_at) + 1)).toISOString();
  return { ...snapshot, luggageItems: scope === "personal" ? snapshot.luggageItems.filter(row => row.id !== source.id) : snapshot.luggageItems,
    sharedLuggageItems: scope === "personal" ? [...snapshot.sharedLuggageItems, next] : snapshot.sharedLuggageItems.map(row => row.id === source.id ? next : row) };
}

export async function privatizeLuggageItem({ client, tripId, item, category }) {
  if (!tripId || !item?.id || !item.updated_at) return { ok: false, error: new Error("luggage_invalid_payload") };
  try {
    const { data, error } = await client.rpc("privatize_luggage_item", {
      p_trip_id: tripId, p_item_id: item.id, p_expected_updated_at: item.updated_at, p_category: category || "",
    });
    return { ok: !error, data, error, conflict: Boolean(error?.message?.includes("luggage_stale")) };
  } catch (error) { return { ok: false, error, conflict: Boolean(error?.message?.includes("luggage_stale")) }; }
}

export function privatizeLuggageSnapshot(snapshot, { item, category, tripId, userId, approvedMemberIds, now = Date.now() }) {
  if (!item?.id || !item.updated_at) throw new Error("luggage_invalid_payload");
  if (!approvedMemberIds.includes(userId)) throw new Error("luggage_forbidden");
  const source = snapshot.sharedLuggageItems.find(row => row.id === item.id && row.trip_id === tripId);
  if (!source) throw new Error("luggage_not_found");
  if (source.updated_at !== item.updated_at) throw new Error("luggage_stale");
  if (source.locked_by && source.locked_by !== userId && Date.parse(source.locked_at) > now - 420000) throw new Error("luggage_locked");
  if (snapshot.luggageItems.some(row => row.id === source.id)) throw new Error("luggage_invalid_payload");
  const target = { id: source.id, trip_id: tripId, owner_id: userId, title: source.title, category: (category || "").trim(),
    notes: source.notes || null, packed: false, shared_item_id: null, is_shared_assigned_item: false,
    created_at: new Date(now).toISOString(), updated_at: new Date(Math.max(now, Date.parse(source.updated_at) + 1)).toISOString() };
  return { ...snapshot, luggageItems: [...snapshot.luggageItems, target], sharedLuggageItems: snapshot.sharedLuggageItems.filter(row => row.id !== source.id) };
}
