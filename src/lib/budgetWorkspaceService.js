// Formal persistence boundary: one RPC, no follow-up payment writes or fallback.
export async function persistBudgetWorkspace({ supabase, tripId, reload }, kind, payload, id, meta = {}) {
  let response;
  try {
    response = await supabase.rpc(meta.leaseProtocol ? "save_budget_workspace_record_v4" : payload.unified_planning ? "save_budget_workspace_record_v3" : "save_budget_workspace_record_v2", {
      p_trip_id: tripId, p_kind: kind, p_id: id || null,
      p_base_updated_at: meta.baseUpdatedAt || null,
      p_request_id: meta.operationId || crypto.randomUUID(),
      p_payload: { ...payload, ...(payload.paid_at ? { paid_at: new Date(payload.paid_at).toISOString() } : {}) },
      ...(meta.leaseProtocol ? { p_edit_session_id: meta.editLease?.sessionId || null, p_edit_token: meta.editLease?.token || null } : {}),
    });
  } catch (error) { return { ok: false, error }; }
  const { data, error } = response;
  if (error) {
    const conflict = ["40001", "40P01"].includes(error.code);
    if (conflict) { try { await reload(tripId); } catch { /* Original conflict and draft remain authoritative. */ } }
    return { ok: false, error: /PGRST202|42883/.test(error.code || "")
      ? { ...error, message: "安全儲存尚未啟用，需先套用預算修正 migration。資料未變更，草稿已保留。" } : error, conflict };
  }
  try { const refreshed = await reload(tripId); if (refreshed?.ok === false) return { ok: true, data, refreshError: refreshed.error || new Error("預算重新整理未完成") }; }
  catch (refreshError) { return { ok: true, data, refreshError }; }
  return { ok: true, data };
}
