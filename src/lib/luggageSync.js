// Use the same canonical merge for visible rows and the offline shared snapshot.
// Existing edits never resurrect a row removed by a newer authoritative read.
export function applyLuggageMutation(rows, { action, itemId, data }) {
  if (action === "delete") return rows.filter(row => row.id !== itemId);
  if (!itemId) return rows.some(row => row.id === data.id) ? rows : [...rows, data];
  return rows.map(row => row.id === itemId && row.updated_at <= data.updated_at ? data : row);
}
export function applyLuggageOrder(rows, updatedRows) {
  const updates = new Map(updatedRows.map(row => [row.id, row]));
  return rows.map(row => {
    const updated = updates.get(row.id);
    return updated && row.updated_at <= updated.updated_at ? updated : row;
  });
}

// Context generation prevents account/trip A -> B -> A responses from leaking.
export function createRequestGuard() {
  let key = null, generation = 0;
  const sequences = new Map();
  return {
    setContext(next) { if (next !== key) { key = next; generation++; sequences.clear(); } },
    context() { return { key, generation }; },
    sameContext(token) { return token.key === key && token.generation === generation; },
    begin(scope) { const sequence = (sequences.get(scope) || 0) + 1; sequences.set(scope, sequence); return { key, generation, scope, sequence }; },
    valid(token) { return this.sameContext(token) && token.sequence === sequences.get(token.scope); },
    invalidate(scopes) { for (const scope of scopes) this.begin(scope); },
  };
}

export function createLuggageRefresh({ guard, read, apply, onError = () => {}, onVerified = () => {} }) {
  const work = new Map();
  let timer = null, scheduledContext = null;
  const scheduled = new Set();
  function refreshScope(scope) {
    const context = guard.context();
    if (!context.key) return Promise.resolve();
    const current = work.get(scope);
    if (current && guard.sameContext(current.context)) { current.dirty = true; return current.promise; }
    const entry = { context, dirty: false };
    entry.promise = (async () => {
      do {
        entry.dirty = false;
        const token = guard.begin(scope);
        try {
          const result = await read(scope, context.key);
          if (guard.valid(token) && !entry.dirty) {
            if (result.error) onError(result.error, scope);
            else { apply(scope, result.data || []); onVerified(scope, result); }
          }
        } catch (error) { if (guard.valid(token)) onError(error, scope); }
      } while (entry.dirty && guard.sameContext(context));
    })().finally(() => { if (work.get(scope) === entry) work.delete(scope); });
    work.set(scope, entry);
    return entry.promise;
  }
  function cancel() { clearTimeout(timer); timer = null; scheduledContext = null; scheduled.clear(); }
  return {
    refresh(scopes = ["personal", "shared"]) { return Promise.all(scopes.map(refreshScope)); },
    schedule(scopes = ["shared"]) {
      if (scheduledContext && !guard.sameContext(scheduledContext)) cancel();
      for (const scope of scopes) scheduled.add(scope);
      // Invalidate a pending read immediately; it may predate this event.
      guard.invalidate(scopes);
      if (timer !== null) return;
      const context = guard.context();
      scheduledContext = context;
      timer = setTimeout(() => {
        const scopes = [...scheduled]; timer = null; scheduledContext = null; scheduled.clear();
        if (guard.sameContext(context)) void Promise.all(scopes.map(refreshScope));
      }, 80);
    },
    cancel,
  };
}

export function subscribeSharedLuggage(channel, tripId, refresh) {
  return channel.on("postgres_changes", { event: "*", schema: "public", table: "shared_luggage_items", filter: `trip_id=eq.${tripId}` }, () => refresh.schedule(["shared"]));
}
