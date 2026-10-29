// Demo transport: memory and local callbacks only. No Auth, RPC, channel or storage.
export function createDemoBudgetMetadataService(getProps, now = Date.now) {
  const states = new Map(), requests = new Map(); let revision = 0;
  const key = (kind, id, group) => `${kind}:${id}:${group}`;
  function state(kind, row, group) {
    const k = key(kind, row.id, group); let s = states.get(k);
    if (!s) { s = { revision: 0, epoch: 0, value: row[group] || "" }; states.set(k, s); }
    if (s.override === (row[group] ?? "")) delete s.override;
    if (s.override == null && s.value !== (row[group] || "")) { s.value = row[group] || ""; s.revision++; revision++; }
    return s;
  }
  function find(args) { return (args.p_kind === "budget" ? getProps().budgetItems : getProps().actualExpenses).find(r => r.id === args.p_id); }
  function supported(kind, row) { return kind === "budget" ? !row.is_fixed && !row.auto_created_actual_expense_id && !getProps().actualExpenses.some(a => a.budget_item_id === row.id)
    : !row.budget_item_id && (!row.payment_origin || row.payment_origin === "manual"); }
  return {
    authorized: async actor => actor === getProps().currentUserId,
    async read(trip) {
      const p = getProps(), records = [], entries = [];
      const budgets = p.budgetItems.filter(r => r.trip_id === trip).map(r => ({ ...r }));
      const actuals = p.actualExpenses.filter(r => r.trip_id === trip).map(r => ({ ...r }));
      for (const kind of ["budget", "actual"]) for (const row of kind === "budget" ? budgets : actuals) {
        if (row.trip_id !== trip) continue;
        records.push({ kind, id: row.id, trip_id: trip, supported: supported(kind, row), state_ready: true,
          groups: ["title", "note"].map(group => { const s = state(kind, row, group), held = Boolean(s.owner && s.expires > now());
            row[group] = s.value;
            if (held) entries.push({ kind, resource_id: row.id, group_key: group, user_id: s.owner, mode: "edit", expires_at: new Date(s.expires).toISOString(), own_session: true });
            return { group, value: s.value, revision: s.revision, epoch: s.epoch, held, owner_id: held ? s.owner : null,
              own_session: held, expires_at: held ? new Date(s.expires).toISOString() : null }; }) });
      }
      return { ok: true, data: { tripId: trip, budgetItems: budgets, actualExpenses: actuals, metadataVerified: true, metadataReadStartedAt: now(), serverNow: new Date(now()).toISOString(),
        metadataProtocol: { name: "metadata-prototype", schemaVersion: 1, enabled: true, complete: false, groups: ["title", "note"] }, metadataRecords: records,
        collaborationRevision: revision, collaboration: { tripId: trip, selectionProtocol: 2, entries },
        nextRefreshAt: entries.length ? new Date(Math.min(...entries.map(e => Date.parse(e.expires_at)))).toISOString() : null } };
    },
    async lease(args) {
      const row = find(args); if (!row || row.trip_id !== args.p_trip_id) return { error: { code: "42501" } };
      const s = state(args.p_kind, row, args.p_group), owns = s.token === args.p_token && s.session === args.p_session_id && s.epoch === args.p_epoch;
      if (args.p_action === "release") { if (owns) { s.owner = null; revision++; } return { data: { granted: true } }; }
      if (!supported(args.p_kind, row)) return { error: { code: "0A000", message: "此項目含付款關聯。" } };
      if (args.p_action === "renew" && (!owns || s.expires <= now())) return { data: { granted: false } };
      if (s.revision !== args.p_base_revision) return { error: { code: "40001" } };
      if (s.owner && s.expires > now() && (s.token !== args.p_token || s.session !== args.p_session_id)) return { data: { granted: false } };
      const fresh = args.p_action === "acquire" && (!s.owner || s.expires <= now());
      if (fresh) { s.epoch++; s.activity = args.p_activity_seq; s.lastActivity = now(); }
      s.owner = getProps().currentUserId; s.token = args.p_token; s.session = args.p_session_id;
      if (args.p_activity_seq > (s.activity ?? -1)) { s.activity = args.p_activity_seq; s.lastActivity = now(); }
      s.expires = Math.min(now() + 420000, s.lastActivity + (args.p_dirty ? 600000 : 120000)); revision++;
      return { data: { granted: s.expires > now(), revision: s.revision, epoch: s.epoch, value: s.value, expires_at: new Date(s.expires).toISOString() } };
    },
    async patch(args) {
      if (requests.has(args.p_request_id)) return { data: requests.get(args.p_request_id) };
      const row = find(args), s = row && state(args.p_kind, row, args.p_group);
      if (!s || s.token !== args.p_token || s.session !== args.p_session_id || s.epoch !== args.p_epoch || s.expires <= now()) return { error: { code: "55P03" } };
      if (s.revision !== args.p_base_revision) return { error: { code: "40001" } };
      const value = args.p_patch[args.p_group];
      if (s.value !== (value ?? "")) { s.revision++; revision++; } s.value = value ?? ""; s.override = s.value;
      getProps().onSaveMetadata(args.p_kind, row.id, args.p_group, value);
      const result = { id: row.id, kind: args.p_kind, group: args.p_group, value, revision: s.revision, request_id: args.p_request_id };
      requests.set(args.p_request_id, result); return { data: result };
    },
  };
}
