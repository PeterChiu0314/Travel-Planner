// Budget-only capabilities live in memory per tab, never in drafts/storage or
// financial rows. The database validates the same capability again at Save.
export function createBudgetEditLeaseClient({ supabase, makeId = () => crypto.randomUUID(), setTimer = setInterval, clearTimer = clearInterval, intervalMs = 60000 }) {
  const sessionId = makeId(), entries = new Map(), watchers = new Map();
  let userId = null, tripId = null, generation = 0, timer = null, pendingReleases = [];
  const kind = table => table === "budget_items" ? "budget" : table === "actual_expenses" ? "actual" : null;
  const key = (table, id) => `${table}:${id}`;
  const lostError = () => new Error("編輯權限尚未確認或已到期，草稿已保留。請重新確認編輯權限。");
  const emit = entryKey => watchers.get(entryKey)?.forEach(fn => fn(entries.get(entryKey)?.state !== "held"));
  const current = entry => entry.generation === generation && entry.userId === userId && entry.tripId === tripId && entries.get(entry.key) === entry;
  function stop() { if (timer !== null) clearTimer(timer); timer = null; }
  function start() {
    if (timer !== null || !entries.size) return;
    timer = setTimer(() => { void reconcile(); }, intervalMs);
    timer?.unref?.();
  }
  async function call(entry, action, baseUpdatedAt = null) {
    try {
      return await supabase.rpc("budget_edit_lease", { p_kind: kind(entry.table), p_id: entry.id, p_session_id: sessionId,
        p_token: entry.token, p_action: action, p_base_updated_at: baseUpdatedAt });
    } catch (error) { return { error }; }
  }
  async function releaseEntry(entry) {
    // An unmounted old controller may receive admission after Auth changed.
    // Check the live identity as well as this controller's render context.
    const session = await supabase.auth?.getSession?.().catch(() => null);
    if (session?.data?.session?.user?.id !== entry.userId) return;
    return call(entry, "release");
  }
  async function acquire(table, record, actor) {
    if (!kind(table) || !record || actor !== userId || record.trip_id !== tripId) return { error: lostError() };
    const entryKey = key(table, record.id), previous = entries.get(entryKey);
    const entry = { key: entryKey, table, id: record.id, tripId, userId, generation,
      token: previous?.state === "held" ? previous.token : makeId(), state: "pending" };
    // Register before the request so a context switch invalidates this result.
    entries.set(entryKey, entry);
    const result = await call(entry, "acquire", record.updated_at);
    if (!current(entry)) {
      if (entry.userId === userId && result.data?.granted && entries.get(entryKey)?.token !== entry.token) void releaseEntry(entry);
      return { error: lostError() };
    }
    if (result.error || !result.data?.granted) {
      if (previous) { previous.state = "lost"; entries.set(entryKey, previous); }
      else entries.delete(entryKey);
      emit(entryKey);
      if (!entries.size) stop();
      return { error: result.error, lockedByAnotherUser: !result.error, ownerId: result.data?.owner_id };
    }
    entry.state = "held"; entry.expiresAt = result.data.expires_at;
    emit(entryKey); start();
    return { data: result.data.record, error: null, lockedByAnotherUser: false };
  }
  async function renew(entry) {
    if (!current(entry) || entry.state === "lost") return { ok: false, error: lostError() };
    if (entry.inFlight) return entry.inFlight;
    entry.inFlight = (async () => {
      const result = await call(entry, "renew");
      if (!current(entry)) return { ok: false, error: lostError() };
      entry.state = result.error ? ["42501", "55P03"].includes(result.error.code) ? "lost" : "uncertain" : result.data?.granted ? "held" : "lost";
      entry.expiresAt = result.data?.expires_at || entry.expiresAt;
      emit(entry.key);
      return entry.state === "held" ? { ok: true, editLease: { sessionId, token: entry.token } } : { ok: false, error: result.error || lostError() };
    })().finally(() => { entry.inFlight = null; });
    return entry.inFlight;
  }
  async function reconcile() { await Promise.all([...entries.values()].filter(e => e.state !== "lost").map(renew)); }
  async function ensure(table, id, actor) {
    const entry = entries.get(key(table, id));
    return entry && actor === userId ? renew(entry) : { ok: false, error: lostError() };
  }
  async function release(table, id, actor) {
    const entryKey = key(table, id), entry = entries.get(entryKey);
    if (!entry || actor !== entry.userId) return;
    entries.delete(entryKey); emit(entryKey); if (!entries.size) stop();
    return releaseEntry(entry);
  }
  return {
    sessionId, leaseProtocol: true, acquire, ensure, release, reconcile,
    configure(actor, trip, allowed = true) {
      const nextUser = actor || null, nextTrip = allowed ? trip : null;
      if (nextUser === userId && nextTrip === tripId) return;
      generation++; pendingReleases.push(...entries.values()); entries.clear(); stop();
      userId = nextUser; tripId = nextTrip;
    },
    async flushReleases() {
      const previous = pendingReleases; pendingReleases = [];
      // Never send an old account's cleanup using a newly signed-in account.
      await Promise.all(previous.filter(e => e.userId === userId).map(releaseEntry));
    },
    watch(table, id, fn) {
      if (!id) { fn(false); return () => {}; }
      const entryKey = key(table, id), set = watchers.get(entryKey) || new Set();
      set.add(fn); watchers.set(entryKey, set); emit(entryKey);
      return () => { set.delete(fn); if (!set.size) watchers.delete(entryKey); };
    },
    async withLease(table, record, actor, run) {
      const entryKey = key(table, record.id), alreadyOwned = entries.get(entryKey)?.state === "held";
      if (!alreadyOwned) {
        const result = await acquire(table, record, actor);
        if (result.error || result.lockedByAnotherUser) return { ok: false, error: result.error || new Error("其他成員或分頁正在編輯此項目。") };
      }
      try {
        const result = await ensure(table, record.id, actor);
        return result.ok ? await run({ leaseProtocol: true, editLease: result.editLease }) : result;
      } finally { if (!alreadyOwned) await release(table, record.id, actor); }
    },
    async dispose() {
      stop(); generation++;
      const previous = [...entries.values(), ...pendingReleases]; entries.clear(); pendingReleases = []; watchers.clear();
      if (!previous.length) return;
      await Promise.all(previous.map(releaseEntry));
    },
  };
}
