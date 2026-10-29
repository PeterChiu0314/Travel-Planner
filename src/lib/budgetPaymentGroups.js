import { withBudgetAuthorityTimeout, budgetAuthorityTimeoutMs } from './budgetMetadataService.js';
import { validPaymentValue } from './budgetPaymentValues.js';
export { validPaymentValue } from './budgetPaymentValues.js';

const version = n => Number.isSafeInteger(n) && n >= 0;
export function createBudgetPaymentService(supabase) {
  const rpc = async (name, args) => { try { return await supabase.rpc(name, args); } catch (error) { return { error }; } };
  return {
    authorized: async actor => { try { return (await supabase.auth.getSession()).data?.session?.user?.id === actor; } catch { return false; } },
    lease: args => rpc('budget_payment_lease', args), mutate: args => rpc('mutate_budget_payment_v2', args),
  };
}

// Explicit operations share the existing metadata snapshot/timeout/guard. No
// autosave timer or financial projection is introduced here.
export function createBudgetPaymentController({ metadata, service, sessionId, storage = null, timeoutMs = budgetAuthorityTimeoutMs, makeId = () => crypto.randomUUID() }) {
  let context = null, generation = 0, revision = 0;
  const entries = new Map(), listeners = new Set();
  const emit = () => { revision++; listeners.forEach(fn => fn()); };
  const current = e => e.generation === generation && context?.actor === e.actor && context?.trip === e.trip && entries.get(`${e.kind}:${e.id}`) === e;
  const key = e => `travel-planner-payment:${e.actor}:${e.trip}:${e.kind}:${e.id}`;
  function persist(e) { try { if (e.request) storage?.setItem(key(e), JSON.stringify({ version: 1, request: { ...e.request, p_token: null, p_epoch: null } })); else storage?.removeItem(key(e)); } catch { /* Memory keeps unresolved intent. */ } }
  const bounded = (work, late) => withBudgetAuthorityTimeout(work, { timeoutMs, late });
  const leaseArgs = (e, action, epoch = e.epoch) => ({ p_trip_id: e.trip, p_kind: e.kind, p_id: e.id, p_session_id: sessionId,
    p_token: e.token, p_action: action, p_base_revision: e.base, p_epoch: epoch ?? null, p_versions: e.versions });
  async function cleanup(e, epoch = e.epoch) {
    if (!e.token || epoch == null) return !e.token;
    if (!(await service.authorized(e.actor))) return false;
    const result = await bounded(service.lease(leaseArgs(e, 'release', epoch)));
    if (result.error || !result.data?.granted) return false;
    e.token = null; e.epoch = null; e.releasePending = false; return true;
  }
  function get(kind, id) {
    if (!context) return null;
    const k = `${kind}:${id}`; let e = entries.get(k);
    if (!e) {
      e = { kind, id, ...context, generation, error: '', busy: false };
      try {
        const saved = JSON.parse(storage?.getItem(key(e)) || 'null'), r = saved?.request;
        if (saved?.version === 1 && r?.p_kind === kind && r.p_id === id && r.p_trip_id === context.trip && typeof r.p_request_id === 'string'
          && typeof r.p_session_id === 'string' && version(r.p_base_revision) && ['paid', 'unpaid', 'set_paid_at'].includes(r.p_value?.action)) {
          e.request = { ...r, p_token: null, p_epoch: null }; e.error = '先前付款結果待確認，請重試原請求。';
        }
      } catch { /* Stored input never grants capability. */ }
      entries.set(k, e);
    }
    return e;
  }
  const active = e => e.busy || Boolean(e.request || e.syncPending || e.releasePending);
  async function run(e, intent) {
    if (!current(e) || !context.editable || !(await service.authorized(e.actor))) return false;
    if (!current(e) || !context.editable) return false;
    e.busy = true; e.error = ''; emit();
    try {
      if (!e.request && !e.receipt) {
        if (!(await metadata.refresh()).ok || !current(e)) throw new Error('付款協作狀態尚未確認，原狀態已保留。');
        const snapshot = metadata.status().snapshot, row = snapshot?.paymentRecords?.find(r => r.kind === e.kind && r.id === e.id);
        if (snapshot?.paymentProtocol?.name !== 'budget-payment' || snapshot.paymentProtocol.schemaVersion !== 1 || !snapshot.paymentProtocol.enabled) throw new Error('付款群組尚未啟用，資料未變更。');
        if (!row?.supported || !version(row.revision) || !validPaymentValue(row.value) || !row.value.versions.targets.some(t => t.kind === e.kind && t.id === e.id && t.group === 'payment' && t.revision === row.revision)) throw new Error('此來源或付款關聯尚未支援安全付款操作。');
        e.base = row.revision; e.versions = row.value.versions; e.token = makeId();
        const admissionScope = { ...e }, admissionToken = e.token;
        const admission = await bounded(service.lease(leaseArgs(e, 'acquire')), result => {
          if (result.data?.granted && version(result.data.epoch)) void cleanup(admissionScope, result.data.epoch).then(ok => {
            if (ok && current(e) && e.token === admissionToken) { e.token = null; e.releasePending = false; emit(); }
          });
        });
        if (!current(e)) { if (admission.data?.granted) await cleanup(e, admission.data.epoch); return false; }
        if (admission.error || !admission.data?.granted) {
          if (admission.error?.code !== 'METADATA_TIMEOUT') e.token = null; else e.releasePending = true;
          throw new Error(admission.error?.message || '其他成員正在編輯付款所需的計價／付款人，請稍後重試。');
        }
        e.epoch = admission.data.epoch;
        if (!version(admission.data.epoch) || admission.data.revision !== e.base || !validPaymentValue(admission.data.value)
          || JSON.stringify(admission.data.value.versions) !== JSON.stringify(e.versions)) throw new Error('付款權限或版本尚未確認。');
        e.epoch = admission.data.epoch;
        e.request = { p_trip_id: e.trip, p_kind: e.kind, p_id: e.id, p_session_id: sessionId, p_token: e.token,
          p_epoch: e.epoch, p_base_revision: e.base, p_value: { ...intent, versions: e.versions }, p_request_id: makeId() };
        persist(e);
      }
      if (e.request) {
        const request = e.request;
        const transport = e.transport ||= Promise.resolve().then(() => service.mutate(request)).catch(error => ({ error }));
        let settled = false; transport.then(() => { settled = true; });
        const result = await bounded(transport); if (settled && e.transport === transport) e.transport = null;
        if (!current(e)) return false;
        const data = result.data, action = request.p_value.action;
        const valid = data?.group === 'payment' && data.id === e.id && data.kind === e.kind && data.request_id === request.p_request_id
          && version(data.revision) && [request.p_base_revision, request.p_base_revision + 1].includes(data.revision) && validPaymentValue(data.value)
          && (action === 'set_paid_at' ? Date.parse(data.value.paid_at) === Date.parse(request.p_value.paid_at) : data.value.active === (action === 'paid'));
        if (result.error || !valid) {
          if (['40001', '40P01', '55P03', '42501', '55000', '22023', '22P02', '0A000'].includes(result.error?.code)) {
            e.request = null; persist(e); e.releasePending = !(await cleanup(e));
          }
          throw new Error(result.error?.message || '付款結果待確認，請以原請求重試。');
        }
        e.receipt = data; e.request = null; e.syncPending = true; persist(e); emit();
      }
      if (e.token) { e.releasePending = !(await cleanup(e)); if (e.releasePending) throw new Error('付款已提交，權限釋放仍待確認。'); }
      if (!(await metadata.refresh()).ok || !current(e)) throw new Error('付款已提交，最新同步待確認；請重新整理。');
      const latest = metadata.status().snapshot?.paymentRecords?.find(r => r.kind === e.kind && r.id === e.id);
      if (!latest || latest.revision < e.receipt.revision || !validPaymentValue(latest.value)
        || latest.revision === e.receipt.revision && (latest.value.active !== e.receipt.value.active
          || e.kind === 'actual' && Date.parse(latest.value.paid_at) !== Date.parse(e.receipt.value.paid_at))) throw new Error('付款已提交，最新狀態尚未收斂。');
      e.syncPending = false; e.receipt = null; e.error = ''; emit(); return true;
    } catch (error) {
      if (e.token && version(e.epoch) && !e.request && !e.receipt) e.releasePending = !(await cleanup(e));
      if (current(e)) { e.error = error.message || '付款操作未完成，資料已保留。'; emit(); }
      return false;
    } finally { if (current(e)) { e.busy = false; emit(); } }
  }
  function execute(kind, id, intent) {
    const e = get(kind, id); if (!e) return Promise.resolve(false);
    if (e.work) return e.work;
    if (e.releasePending && !e.receipt && !e.request) return Promise.resolve(false);
    if (!e.request && !e.receipt && !['paid', 'unpaid', 'set_paid_at'].includes(intent?.action)) return Promise.resolve(false);
    // Authorization is asynchronous too: guard the user's explicit operation
    // immediately so an item switch cannot slip in before lease admission.
    e.busy = true; e.error = ''; emit();
    const work = run(e, intent).finally(() => {
      if (e.work === work) { e.work = null; if (current(e)) { e.busy = false; emit(); } }
    }); e.work = work; return work;
  }
  return {
    get, execute, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, getVersion: () => revision,
    view(kind, id) { const e = get(kind, id); return e ? { ...e, active: active(e), unknown: Boolean(e.request) } : {}; },
    hasPending: () => [...entries.values()].some(active),
    async prepare() { for (const e of entries.values()) { if (e.work) await e.work; if (active(e)) return false; } return true; },
    async retry(kind, id) {
      const e = get(kind, id); if (!e || e.work) return false;
      if (e.releasePending && !e.receipt && !e.request) { const ok = await cleanup(e); if (current(e) && ok) { e.error = ''; emit(); } return ok; }
      if (!e.request && !e.receipt) return false;
      return execute(kind, id);
    },
    configure(actor, trip, editable) {
      if (context?.actor === actor && context?.trip === trip && context?.editable === editable) return;
      for (const e of entries.values()) { persist(e); if (e.token && !e.request && !e.busy) void cleanup(e); }
      generation++; entries.clear(); context = actor && trip ? { actor, trip, editable } : null; emit();
    },
    async dispose() { for (const e of entries.values()) { persist(e); if (!e.request && e.token) await cleanup(e); } generation++; context = null; entries.clear(); },
  };
}
