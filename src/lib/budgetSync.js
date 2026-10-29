import { budgetMetadataEnabled, getBudgetMetadataSessionId } from "./budgetMetadataConfig.js";
import { validBudgetMetadataSnapshot, withBudgetAuthorityTimeout, budgetSnapshotTimeoutError } from "./budgetMetadataService.js";
export const emptyBudgetSnapshot = () => ({ tripId: null, budgetItems: [], budgetParticipants: [], actualExpenses: [], actualParticipants: [],
  itineraryBudgetLinks: [], budgetBaseline: null, items: [], members: [], attachments: [], tripBudgetRates: null });
export const mergeBudgetAttachments = (attachments, snapshot) => [...attachments.filter(a => a.target_type !== "actual_expense"), ...snapshot.attachments];

export async function readBudgetSnapshot(supabase, tripId) {
  try {
    const started = Date.now();
    let result = await supabase.rpc(budgetMetadataEnabled ? "read_budget_metadata_snapshot_v4" : "read_budget_snapshot",
      { p_trip_id: tripId, ...(budgetMetadataEnabled ? { p_session_id: getBudgetMetadataSessionId() } : {}) });
    let metadataMissing = false;
    if (budgetMetadataEnabled && ["PGRST202", "42883"].includes(result.error?.code)) {
      // Read-only financial fallback; the new editor stays fail-closed.
      result = await supabase.rpc("read_budget_snapshot", { p_trip_id: tripId }); metadataMissing = true;
    }
    if (result.error) return result;
    const data = result.data;
    if (!data) return { error: { code: "42501", message: "目前無法讀取此旅程預算。" } };
    if (data.tripId !== tripId || ["budgetItems", "budgetParticipants", "actualExpenses", "actualParticipants", "itineraryBudgetLinks", "items", "members", "attachments"].some(key => !Array.isArray(data[key]))) {
      return { error: { code: "BUDGET_SNAPSHOT_INVALID", message: "預算資料尚未確認，請重新連線。" } };
    }
    if (budgetMetadataEnabled && !metadataMissing && !validBudgetMetadataSnapshot(data, tripId)) {
      return { error: { code: "BUDGET_METADATA_INVALID", message: "群組協作資料尚未確認，請重新整理。" } };
    }
    return { data: budgetMetadataEnabled ? { ...data, metadataVerified: !metadataMissing, metadataReadStartedAt: started,
      ...(metadataMissing ? { metadataError: "群組協作尚未啟用，目前僅供檢視。" } : {}) } : data, error: null };
  } catch (error) { return { error }; }
}

// One coalesced authority read for the complete financial graph. Invalidations
// during a read discard its result and rerun once quiet; generations cover ABA.
export function createBudgetRefresh({ guard, read, apply, onError = () => {}, onVerified = () => {}, delay = 80, timeoutMs = null }) {
  let entry = null, timer = null;
  function cancel() { clearTimeout(timer); timer = null; }
  function refresh() {
    cancel();
    const context = guard.context();
    if (!context.key) return Promise.resolve({ ok: false });
    if (entry && guard.sameContext(entry.context)) return entry.promise;
    const work = { context, dirty: false };
    const run = (async () => {
      let result;
      do {
        work.dirty = false;
        const token = guard.begin("budget");
        work.token = token;
        result = await read(context.key);
        if (work.expired || !guard.sameContext(context)) return { ok: false, stale: true };
        if (guard.valid(token) && !work.dirty) {
          if (result.error) { onError(result.error); return { ok: false, error: result.error }; }
          apply(result.data, context.key); onVerified(result); return { ok: true, data: result.data };
        }
        // A full-trip read may advance this scope too. Its guarded application
        // wins; only a real invalidation requires another snapshot request.
      } while (work.dirty && guard.sameContext(context));
      return { ok: false, stale: true };
    })();
    // One deadline includes invalidation reruns. Retiring the logical work also
    // fences its uncancellable transport before a late result can apply.
    work.promise = (timeoutMs == null ? run : withBudgetAuthorityTimeout(run, {
      timeoutMs, error: budgetSnapshotTimeoutError(), onTimeout: () => { work.expired = true; },
    })).then(result => {
      if (result.error && result.ok == null) {
        if (guard.sameContext(context) && (guard.valid(work.token) || work.dirty)) onError(result.error);
        return { ok: false, error: result.error };
      }
      return result;
    }).catch(error => {
      if (guard.sameContext(context)) onError(error);
      return { ok: false, error };
    }).finally(() => { if (entry === work) entry = null; });
    entry = work; return work.promise;
  }
  function schedule() {
    const context = guard.context();
    if (!context.key) return;
    guard.invalidate(["budget"]);
    if (entry && guard.sameContext(entry.context)) { entry.dirty = true; return; }
    if (timer !== null) return;
    timer = setTimeout(() => { timer = null; if (guard.sameContext(context)) void refresh(); }, delay);
  }
  return { refresh, schedule, cancel,
    // A successful mutation needs a post-commit snapshot, even if an older read
    // is already pending. All same-turn events and the writer share its rerun.
    committed() { schedule(); return refresh(); },
  };
}
