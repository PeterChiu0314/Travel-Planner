export const emptyBudgetSnapshot = () => ({ tripId: null, budgetItems: [], budgetParticipants: [], actualExpenses: [], actualParticipants: [],
  itineraryBudgetLinks: [], budgetBaseline: null, items: [], members: [], attachments: [], tripBudgetRates: null });
export const mergeBudgetAttachments = (attachments, snapshot) => [...attachments.filter(a => a.target_type !== "actual_expense"), ...snapshot.attachments];

export async function readBudgetSnapshot(supabase, tripId) {
  try {
    const result = await supabase.rpc("read_budget_snapshot", { p_trip_id: tripId });
    if (result.error) return result;
    const data = result.data;
    if (!data) return { error: { code: "42501", message: "目前無法讀取此旅程預算。" } };
    if (data.tripId !== tripId || ["budgetItems", "budgetParticipants", "actualExpenses", "actualParticipants", "itineraryBudgetLinks", "items", "members", "attachments"].some(key => !Array.isArray(data[key]))) {
      return { error: { code: "BUDGET_SNAPSHOT_INVALID", message: "預算資料尚未確認，請重新連線。" } };
    }
    return { data, error: null };
  } catch (error) { return { error }; }
}

// One coalesced authority read for the complete financial graph. Invalidations
// during a read discard its result and rerun once quiet; generations cover ABA.
export function createBudgetRefresh({ guard, read, apply, onError = () => {}, delay = 80 }) {
  let entry = null, timer = null;
  function cancel() { clearTimeout(timer); timer = null; }
  function refresh() {
    cancel();
    const context = guard.context();
    if (!context.key) return Promise.resolve({ ok: false });
    if (entry && guard.sameContext(entry.context)) return entry.promise;
    const work = { context, dirty: false };
    work.promise = (async () => {
      let result;
      do {
        work.dirty = false;
        const token = guard.begin("budget");
        result = await read(context.key);
        if (!guard.sameContext(context)) return { ok: false, stale: true };
        if (guard.valid(token) && !work.dirty) {
          if (result.error) { onError(result.error); return { ok: false, error: result.error }; }
          apply(result.data, context.key); return { ok: true };
        }
        // A full-trip read may advance this scope too. Its guarded application
        // wins; only a real invalidation requires another snapshot request.
      } while (work.dirty && guard.sameContext(context));
      return { ok: false, stale: true };
    })().catch(error => {
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
