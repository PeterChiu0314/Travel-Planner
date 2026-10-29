const groups = ["title", "note"];
const version = value => Number.isSafeInteger(value) && value >= 0;
// Match PostgreSQL btrim(text): normalize ordinary spaces, preserving other text.
const patchValue = (group, value) => group === "note" ? value.replace(/^ +| +$/g, "") || null : value.replace(/^ +| +$/g, "");
export function validBudgetMetadataSnapshot(data, tripId) {
  return data?.tripId === tripId && data.metadataProtocol?.name === "metadata-prototype"
    && data.metadataProtocol.schemaVersion === 1 && typeof data.metadataProtocol.enabled === "boolean"
    && data.metadataProtocol.complete === false && JSON.stringify(data.metadataProtocol.groups) === JSON.stringify(groups)
    && Number.isFinite(Date.parse(data.serverNow)) && version(data.collaborationRevision)
    && Array.isArray(data.budgetItems) && Array.isArray(data.actualExpenses)
    && Array.isArray(data.metadataRecords) && Array.isArray(data.collaboration?.entries)
    && data.metadataRecords.length === data.budgetItems.length + data.actualExpenses.length
    && new Set(data.metadataRecords.map(r => `${r.kind}:${r.id}`)).size === data.metadataRecords.length
    && data.metadataRecords.every(r => {
      const canonical = (r.kind === "budget" ? data.budgetItems : data.actualExpenses).find(row => row.id === r.id && row.trip_id === tripId);
      return canonical && r.groups?.every(g => String(g.value ?? "") === String(canonical[g.group] ?? ""));
    })
    && data.metadataRecords.every(r => ["budget", "actual"].includes(r.kind) && r.trip_id === tripId
      && typeof r.supported === "boolean" && typeof r.state_ready === "boolean" && r.groups?.length === 2
      && groups.every(key => r.groups.filter(g => g.group === key).length === 1)
      && r.groups.every(g => (typeof g.value === "string" || g.value === null) && typeof g.held === "boolean"
        && typeof g.own_session === "boolean" && (!r.state_ready || version(g.revision) && version(g.epoch))
        && (!g.held || typeof g.owner_id === "string" && Number.isFinite(Date.parse(g.expires_at)))));
}
export function withoutBudgetMetadata(data) {
  const { metadataProtocol, metadataRecords, metadataVerified, metadataReadStartedAt, metadataError, metadataUserId,
    collaboration, collaborationRevision, serverNow, nextRefreshAt, ...financial } = data;
  return financial;
}
export function createBudgetMetadataService(supabase) {
  const rpc = async (name, args) => { try { return await supabase.rpc(name, args); } catch (error) { return { error }; } };
  return {
    async authorized(actor) { try { return (await supabase.auth.getSession()).data?.session?.user?.id === actor; } catch { return false; } },
    lease: args => rpc("budget_metadata_group_lease", args),
    patch: args => rpc("patch_budget_metadata_group", args),
  };
}

// Authority is held only in this controller. Snapshot own_session and persisted
// input are hints; neither can manufacture a capability. No legacy save fallback.
export function createBudgetMetadataEditor({ service, read, sessionId, storage = null, now = Date.now,
  makeId = () => crypto.randomUUID(), timeoutMs = 10000, debounceMs = 1000 }) {
  const entries = new Map(), listeners = new Set();
  let context = null, generation = 0, revision = 0, projectionRevision = 0, snapshot = null, verified = false, message = "正在確認協作狀態…", offset = 0;
  let readWork = null, renewAt = 0, refreshAt = Infinity, suspended = false;
  const emit = (projection = false) => { revision++; if (projection) projectionRevision++; listeners.forEach(fn => fn()); };
  const key = (kind, id, group) => `${kind}:${id}:${group}`;
  const current = g => g.generation === generation && g.actor === context?.actor && g.trip === context?.trip && entries.get(g.key) === g;
  const draftKey = g => `travel-planner-metadata:${g.actor}:${g.trip}:${g.key}`;
  const dirty = g => patchValue(g.group, g.staged ?? g.value) !== patchValue(g.group, g.canonical);
  const cancelTimer = g => { clearTimeout(g.timer); g.timer = null; };
  function schedule(g) {
    cancelTimer(g);
    if (!current(g) || !dirty(g) || !owns(g) || g.composing || g.failed || g.request || g.saveWork) return;
    g.timer = setTimeout(() => { g.timer = null; void save(g, false); }, Math.max(0, (g.dueAt ?? now()) - now()));
    g.timer.unref?.();
  }
  function persist(g) {
    try {
      if (!dirty(g) && !g.request) storage?.removeItem(draftKey(g));
      else {
        const pending = g.request ? { id: g.request.p_request_id, session: g.request.p_session_id,
          base: g.request.p_base_revision, value: g.request.p_patch[g.group] } : undefined;
        storage?.setItem(draftKey(g), JSON.stringify({ version: 2, value: g.staged ?? g.value, base: g.base, pending }));
      }
    } catch { /* In-memory input remains available if storage is blocked. */ }
  }
  const allowed = g => current(g) && context.editable && verified && snapshot?.metadataProtocol.enabled
    && g.supported && g.ready && !g.deleted;
  const owns = g => allowed(g) && g.state === "held" && g.expires > now() && !g.releasing && !g.conflict;
  const args = (g, action) => ({ p_trip_id: g.trip, p_kind: g.kind, p_id: g.id, p_group: g.group,
    p_session_id: sessionId, p_token: g.token, p_action: action, p_base_revision: g.base,
    p_epoch: g.epoch ?? null, p_activity_seq: g.activity || 0, p_dirty: dirty(g) });
  async function bounded(work, late) {
    let timer, expired = false;
    const result = Promise.resolve(work).catch(error => ({ error }));
    result.then(value => { if (expired) late?.(value); });
    try { return await Promise.race([result, new Promise(resolve => { timer = setTimeout(() => {
      expired = true; resolve({ error: { code: "METADATA_TIMEOUT", message: "連線逾時，結果尚待確認。" } });
    }, timeoutMs); })]); } finally { clearTimeout(timer); }
  }
  async function cleanup(g, epoch = g.epoch) {
    if (!g.token) return { ok: true };
    if (epoch == null) return { ok: false }; // An unanswered admission is not a confirmed absence of authority.
    if (!(await service.authorized(g.actor))) return { ok: false };
    const result = await bounded(service.lease({ ...args(g, "release"), p_epoch: epoch }));
    return { ok: Boolean(!result.error && result.data?.granted), error: result.error };
  }
  function ingest(data) {
    if (!context || suspended || data.metadataUserId && data.metadataUserId !== context.actor || !validBudgetMetadataSnapshot(data, context.trip) || data.metadataVerified !== true) return false;
    snapshot = data; verified = true; message = data.metadataProtocol.enabled ? "" : "群組編輯尚未啟用，目前僅供檢視。";
    offset = Date.parse(data.serverNow) - (data.metadataReadStartedAt ?? now());
    refreshAt = data.nextRefreshAt ? Date.parse(data.nextRefreshAt) - offset : Infinity;
    for (const g of entries.values()) {
      const record = data.metadataRecords.find(r => r.kind === g.kind && r.id === g.id);
      const remote = record?.groups.find(r => r.group === g.group);
      g.deleted = !record; g.supported = record?.supported; g.ready = record?.state_ready;
      if (!remote) { g.state = "lost"; g.error = "項目已移除，未提交內容仍保留。"; continue; }
      if (remote.revision < g.base) continue; // A response predating our confirmed patch cannot roll it back.
      g.syncPending = false;
      g.remote = remote;
      if (remote.revision !== g.base && (dirty(g) || g.request)) {
        if (!g.request) { g.conflict = true; g.error = "此欄位已由其他人更新，草稿已保留。請確認最新內容。"; }
      } else if (!dirty(g) && !g.request) {
        g.canonical = remote.value ?? ""; g.value = g.canonical; g.base = remote.revision;
      }
      if (g.state === "held" && (!remote.own_session || remote.epoch !== g.epoch || !remote.held)) g.state = "lost";
    }
    emit(true); return true;
  }
  async function refresh() {
    if (!context || suspended) return { ok: false };
    if (readWork) return readWork;
    const c = context, gen = generation;
    const work = (async () => {
      let result; try { result = await read(c.trip); } catch (error) { result = { error }; }
      if (c !== context || gen !== generation) return { ok: false, stale: true };
      if (result?.ok && ingest(result.data)) return result;
      verified = false; message = result?.data?.metadataError || "協作狀態尚未確認，輸入已保留。請重新整理。";
      for (const g of entries.values()) if (g.state === "held") g.state = "uncertain";
      emit(true); return { ok: false };
    })().finally(() => { if (readWork === work) readWork = null; });
    readWork = work; return work;
  }
  function get(kind, id, group, initialValue = "") {
    if (!context || !groups.includes(group)) return null;
    const k = key(kind, id, group); let g = entries.get(k);
    if (!g) {
      const record = snapshot?.metadataRecords.find(r => r.kind === kind && r.id === id), remote = record?.groups.find(r => r.group === group);
      g = { key: k, kind, id, group, actor: context.actor, trip: context.trip, generation,
        canonical: remote?.value ?? initialValue, value: remote?.value ?? initialValue, base: remote?.revision, remote,
        state: "idle", localRevision: 0, supported: record?.supported, ready: record?.state_ready, lastActivity: now() };
      try { const saved = JSON.parse(storage?.getItem(draftKey(g)) || "null");
        if ([1, 2].includes(saved?.version) && typeof saved.value === "string" && version(saved.base)) {
          g.staged = saved.value; g.base = saved.base; g.conflict = Boolean(remote && remote.revision !== saved.base);
          g.error = g.conflict ? "遠端版本已更新，已保留此分頁草稿。" : "已恢復此分頁草稿，請先確認編輯權限。";
          const p = saved.pending;
          if (saved.version === 2 && p && typeof p.id === "string" && typeof p.session === "string" && version(p.base)
            && (typeof p.value === "string" || group === "note" && p.value === null)) {
            g.request = { ...args(g, "patch"), p_request_id: p.id, p_session_id: p.session,
              p_base_revision: p.base, p_token: null, p_epoch: null, p_patch: { [group]: p.value } };
            g.value = saved.value; delete g.staged;
            g.submittedRevision = patchValue(group, saved.value) === p.value ? 0 : -1;
            g.conflict = false; g.failed = true; g.error = "先前儲存結果待確認，請重試原請求。";
          }
        }
      } catch { /* Invalid stored data never grants authority. */ }
      entries.set(k, g);
    }
    return g;
  }
  async function release(g) {
    if (!g || !current(g)) return true;
    cancelTimer(g);
    g.focused = false; g.releasing = true;
    if (g.acquiring) { await g.acquiring; if (!current(g)) return false; }
    const result = await cleanup(g);
    if (!current(g)) return false;
    if (result.ok) { g.state = "idle"; g.token = null; g.epoch = null; g.releasing = false; g.error = ""; }
    else { g.state = "uncertain"; g.error = "尚未確認權限釋放，請重試結束編輯。"; }
    emit(); return result.ok;
  }
  async function focus(g) {
    if (!g || !allowed(g) || g.conflict || g.request || g.releasing || g.exiting) return false;
    g.focused = true;
    if (owns(g)) return true;
    if (g.acquiring) return g.acquiring;
    g.lastActivity = now(); g.activity = (g.activity || 0) + 1;
    g.state = "pending"; g.error = ""; g.token ||= makeId(); emit();
    const work = (async () => {
      if (!(await service.authorized(g.actor)) || !current(g)) { g.token = null; return false; }
      const result = await bounded(service.lease(args(g, "acquire")), async late => {
        if (late.data?.granted && version(late.data.epoch)) {
          g.epoch = late.data.epoch;
          const released = await cleanup(g);
          if (current(g) && released.ok) { g.token = null; g.state = "idle"; g.releasing = false; emit(); }
        }
      });
      if (!current(g) || g.releasing || !g.focused && !dirty(g)) {
        if (result.data?.granted) { g.epoch = result.data.epoch; await cleanup(g); }
        return false;
      }
      const data = result.data;
      if (result.error || !data?.granted || !version(data.epoch) || data.revision !== g.base || !Number.isFinite(Date.parse(data.expires_at))) {
        if (!result.error && !data?.granted) g.token = null;
        if (data?.granted && version(data.epoch)) { g.epoch = data.epoch; await cleanup(g); }
        g.state = result.error ? "uncertain" : "blocked";
        g.error = result.error?.code === "40001" ? "此欄位版本已更新，草稿已保留。" : result.error?.message || "其他成員或分頁正在編輯，請稍後重試。";
        if (result.error?.code === "40001") g.conflict = true;
        emit(); void refresh(); return false;
      }
      g.epoch = data.epoch; g.expires = Date.parse(data.expires_at) - offset;
      g.canonical = data.value ?? ""; g.value = g.staged ?? g.value; delete g.staged;
      g.state = "held";
      persist(g); emit(); schedule(g); return true;
    })().finally(() => { g.acquiring = null; if (current(g) && g.state === "pending") {
      g.state = "uncertain"; g.error = "編輯權限尚未確認，請重試。"; emit();
    } });
    g.acquiring = work; return work;
  }
  function input(g, value) {
    if (!g || !allowed(g) || g.conflict || g.releasing || g.exiting || typeof value !== "string") return;
    if (g.state === "pending") g.staged = value; // Intent buffer, never a committable value before admission.
    else if (owns(g)) g.value = value;
    else return;
    g.localRevision++; g.lastActivity = now(); g.dueAt = now() + debounceMs;
    g.activity = (g.activity || 0) + 1;
    if (g.invalid) { g.failed = false; g.invalid = false; g.error = ""; }
    persist(g); emit(); schedule(g);
  }
  function save(g, flush = true) {
    if (!g || !current(g)) return Promise.resolve(false);
    cancelTimer(g); g.flush ||= flush;
    if (g.saveWork) return g.saveWork;
    const work = commit(g).finally(() => {
      if (g.saveWork === work) { g.saveWork = null; g.flush = false; schedule(g); }
    });
    g.saveWork = work; return work;
  }
  async function commit(g) {
    if (g.acquiring) await g.acquiring;
    if (!current(g) || g.composing || suspended || !verified) return false;
    if (!g.request && (!owns(g) || g.conflict || !dirty(g))) return !dirty(g);
    if (g.group === "title" && !g.value.trim() && !g.request) { g.invalid = true; g.failed = true; g.error = "請填寫項目名稱。"; emit(); return false; }
    if (!(await service.authorized(g.actor))) {
      if (current(g)) { g.failed = true; g.state = "uncertain"; g.error = "登入狀態尚未確認，草稿已保留。"; emit(); }
      return false;
    }
    if (!current(g)) return false;
    if (!g.request) {
      if (!owns(g) || g.composing) return false;
      g.request = { ...args(g, "patch"), p_request_id: makeId(), p_patch: { [g.group]: patchValue(g.group, g.value) } };
      g.submittedRevision = g.localRevision;
    }
    const { p_action, p_activity_seq, p_dirty, ...request } = g.request;
    g.saving = true; g.error = ""; persist(g); emit();
    // A timeout cannot start another transport while the original is still in flight.
    const transport = g.patchWork ||= Promise.resolve().then(() => service.patch(request)).catch(error => ({ error }));
    let settled = false; transport.then(() => { settled = true; });
    const result = await bounded(transport);
    if (settled && g.patchWork === transport) g.patchWork = null;
    if (!current(g)) return false;
    g.saving = false;
    const data = result.data;
    if (result.error || data?.id !== g.id || data?.kind !== g.kind || data?.group !== g.group || data?.request_id !== request.p_request_id
      || data?.value !== request.p_patch[g.group] || !version(data?.revision) || ![request.p_base_revision, request.p_base_revision + 1].includes(data.revision)) {
      const code = result.error?.code;
      if (["40001", "40P01", "55P03", "42501", "55000", "22023", "0A000"].includes(code)) {
        g.request = null; g.state = "lost"; g.conflict = code === "40001";
      }
      g.error = code === "55P03" ? "編輯權限或交易忙碌，草稿已保留。請重新確認後重試。"
        : code === "40001" ? "此欄位已更新，請確認最新內容；草稿已保留。" : result.error?.message || "儲存結果尚待確認，請以原請求重試。";
      g.failed = true; persist(g); emit(); void refresh(); return false;
    }
    g.canonical = data.value ?? ""; g.base = data.revision;
    if (g.localRevision === g.submittedRevision) g.value = g.canonical;
    g.request = null; g.conflict = false; g.error = ""; g.failed = false; g.saved = true; g.syncPending = true; persist(g); emit();
    await refresh();
    if (!current(g)) return false;
    if (dirty(g)) {
      if (g.flush || (g.dueAt ?? Infinity) <= now()) return commit(g);
      return true;
    }
    if (!g.focused && !dirty(g)) return release(g);
    return true; // A committed value is never resubmitted to repair a failed refresh.
  }
  async function discard(g) {
    if (!g || !current(g)) return false;
    if (g.request || g.saving) { g.error = "儲存結果仍待確認，請先重試原請求。"; emit(); return false; }
    if (!(await release(g))) return false;
    if (!current(g)) return false;
    const remote = g.remote?.revision >= g.base ? g.remote : null;
    g.value = remote?.value ?? g.canonical; g.canonical = g.value; g.base = remote?.revision ?? g.base;
    cancelTimer(g); delete g.staged; g.conflict = false; g.failed = false; g.invalid = false; g.saved = false; persist(g); emit(); return true;
  }
  return {
    sessionId, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, getVersion: () => revision,
    getProjectionVersion: () => projectionRevision,
    matches: (actor, trip) => context?.actor === actor && context?.trip === trip,
    reconcile() { suspended = false; renewAt = 0; return refresh(); },
    get, ingest, refresh, focus, input, save, discard, release,
    composition(g, active) { if (!g || !current(g)) return; g.composing = active;
      if (active) cancelTimer(g); else { g.dueAt = g.focused ? now() + debounceMs : now(); schedule(g); } },
    async retry(g) {
      if (!g || !current(g) || !(await refresh()).ok || !current(g)) return false;
      if (g.request) {
        const confirmed = await save(g); // Exact replay is checked by DB even after expiry.
        if (!current(g) || g.request || !dirty(g)) return confirmed;
      }
      if (g.conflict || g.releasing) return false;
      g.failed = false;
      if (!owns(g) && !(await focus(g))) return false;
      return save(g);
    },
    status: () => ({ verified, message, snapshot, editable: context?.editable }),
    invalidate(error = "協作狀態尚未確認，草稿已保留。") {
      verified = false; message = error;
      for (const g of entries.values()) cancelTimer(g);
      for (const g of entries.values()) if (g.state === "held") g.state = "uncertain";
      emit(true);
    },
    view(g) { return { ...g, display: g.staged ?? g.value, dirty: dirty(g), writable: owns(g),
      acceptsIntent: allowed(g) && !g.conflict && !g.releasing && !g.exiting && (owns(g) || g.state === "pending") }; },
    blur(g) { if (!g) return; g.focused = false; g.dueAt = now(); cancelTimer(g);
      if (g.composing) return;
      if (dirty(g) || g.saving) { if (!g.failed) void save(g); }
      else if (!g.request) void release(g);
    },
    suspend() { suspended = true; verified = false; for (const g of entries.values()) { cancelTimer(g); if (g.state === "held") g.state = "uncertain"; } emit(true); },
    configure(actor, trip, active, editable) {
      if (context?.actor === actor && context?.trip === trip && context?.active === active && context?.editable === editable) return;
      generation++; for (const g of entries.values()) { cancelTimer(g); persist(g); g.releasing = true; if (!g.acquiring) void cleanup(g); }
      entries.clear(); context = actor && trip ? { actor, trip, active, editable: editable && active } : null;
      verified = false; snapshot = null; readWork = null; refreshAt = Infinity; suspended = false;
      message = "正在確認協作狀態…"; emit(true);
    },
    async tick() {
      if (!context?.active || suspended) return;
      for (const g of entries.values()) {
        if (g.state === "held" && g.expires <= now()) { g.state = "lost"; g.error = "編輯權限已到期，草稿已保留。"; emit(); }
        if (g.token && !g.saving && now() - g.lastActivity >= (dirty(g) || g.failed || g.request ? 600000 : 120000) && !g.releasing) await release(g);
      }
      if (now() >= refreshAt) { refreshAt = Infinity; await refresh(); }
      if (now() < renewAt || !verified) return;
      renewAt = now() + 60000;
      for (const g of entries.values()) {
        if (!g.token || !["held", "uncertain"].includes(g.state) || g.releasing || g.saving || !allowed(g)) continue;
        if (!(await service.authorized(g.actor)) || !current(g)) continue;
        const result = await bounded(service.lease(args(g, "renew")));
        if (!current(g) || g.releasing) continue;
        g.state = !result.error && result.data?.granted ? "held" : "uncertain";
        if (g.state === "held") { g.expires = Date.parse(result.data.expires_at) - offset; schedule(g); }
        else g.error = "編輯權限尚未確認，草稿已保留。";
        emit();
      }
    },
    async close(kind, id, drop = false) {
      const selected = [...entries.values()].filter(g => g.kind === kind && g.id === id);
      for (const g of selected) if (!(drop ? await discard(g) : await release(g))) return false;
      return true;
    },
    async saveAll(kind, id) {
      const selected = [...entries.values()].filter(g => g.kind === kind && g.id === id);
      for (const g of selected) if ((dirty(g) || g.request || g.saveWork) && !(await save(g))) return false;
      if (selected.some(g => !current(g) || dirty(g) || g.request || g.saveWork)) return false;
      return true;
    },
    async prepare(kind, id) {
      if ([...entries.values()].some(g => g.kind === kind && g.id === id && (g.failed || g.conflict || g.composing || g.request && !g.saving))) return false;
      return this.saveAll(kind, id);
    },
    async finish(kind, id) {
      const selected = [...entries.values()].filter(g => g.kind === kind && g.id === id);
      for (const g of selected) { g.exiting = true; cancelTimer(g); } emit();
      try {
        if (!(await this.prepare(kind, id))) return false;
        for (const g of selected) if (!current(g) || !(await release(g))) return false;
        return selected.every(current);
      } finally { for (const g of selected) g.exiting = false; emit(); }
    },
    async dispose() { generation++; const previous = [...entries.values()]; entries.clear(); context = null;
      for (const g of previous) { cancelTimer(g); persist(g); g.releasing = true; if (!g.acquiring) await cleanup(g); } },
  };
}
