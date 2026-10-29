import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { memberLabel } from "../../lib/budgetFinance.js";
import MenuSelect from "../MenuSelect.jsx";
import { recordMetadataValue } from "../../lib/budgetMetadataValues.js";
import BudgetPricingFields from "./BudgetPricingFields.jsx";
import { pricingPreview } from "../../lib/budgetPricingGroups.js";

function PricingGroup({ client, field, view, record, kind, members }) {
  const [open, setOpen] = useState(false), custom = useRef(null);
  const form = view.display, snapshot = client.status().snapshot;
  const canonical = (kind === "budget" ? snapshot?.budgetItems : snapshot?.actualExpenses)?.find(r => r.id === record.id) || record;
  const retained = kind === "budget" && (snapshot?.actualExpenses || []).some(a => (a.budget_origin_id || a.budget_item_id) === record.id);
  let pricing; try { pricing = pricingPreview(form, canonical, kind); } catch { pricing = null; }
  const input = next => client.input(field, next, { immediate: false });
  function changeMode(mode) {
    if (mode === form.pricing_mode) return;
    if (form.pricing_mode === "custom") custom.current = { ...form.shares };
    input({ ...form, pricing_mode: mode, amount: pricing?.amount ?? form.amount,
      unit_amount: mode === "per_person" && pricing ? Math.round(pricing.amount / form.participantIds.length * 100) / 100 : form.unit_amount,
      shares: mode === "custom" ? custom.current || pricing?.shares || form.shares : form.shares });
    if (mode === "custom") setOpen(true);
  }
  return <><BudgetPricingFields form={form} pricing={pricing} members={members} locked={!view.acceptsIntent} historical={retained}
    tripRates={snapshot?.tripBudgetRates} setForm={input} update={(key, value) => input({ ...form, [key]: value })}
    membersOpen={open} setMembersOpen={setOpen} changeMode={changeMode} groupMode editRate={kind === "actual"} fixedCurrency={retained} />
    {kind === "budget" && !retained && form.currency !== "TWD" && snapshot?.tripBudgetRates?.rates?.[form.currency]
      && Number(form.exchange_rate) !== Number(snapshot.tripBudgetRates.rates[form.currency]) ? <button type="button" className="ghost-button compact" disabled={view.saving || Boolean(view.request)} onClick={() => void client.useLatestPricingRate(field)}>套用最新旅程匯率</button> : null}</>;
}

// Formal and memory-only Demo share the controller's serial autosave flow.
export default function BudgetMetadataEditor({ client, record, kind, members, services, items, categoryOptions, ItineraryPicker, onClose, onLegacy }) {
  const version = useSyncExternalStore(client.subscribe, client.getVersion);
  const fields = client.groupKeys(kind).map(group => client.get(kind, record.id, group, recordMetadataValue(kind, record, group, client.status().snapshot?.itineraryBudgetLinks)));
  const views = fields.map(g => client.view(g));
  const { message, verified, editable } = client.status();
  const hasDraft = views.some(g => g.dirty || g.request || g.saving);
  const saveAll = () => client.saveAll(kind, record.id);
  const discardAll = async () => { for (const g of fields) if (!(await client.discard(g))) return false; return true; };
  services.useGuard(`budget-metadata:${kind}:${record.id}:${record.trip_id}`, useMemo(() => ({ isActive: true,
    isDirty: hasDraft, prepare: () => client.prepare(kind, record.id), finish: () => client.finish(kind, record.id), save: saveAll, discard: discardAll }), [client, record.id, kind, version, hasDraft]));
  useEffect(() => {
    return () => { void client.close(kind, record.id); };
  }, [client, record.id, kind]);
  return <section className="bw-editor bw-metadata-editor" aria-label={kind === "actual" ? "實付群組編輯" : "預算群組編輯"}>
    <div className="bw-detail-heading"><h3>編輯{kind === "actual" ? "實付" : "預算"}</h3>
      <button className="bw-icon" type="button" aria-label="關閉編輯" onClick={onClose}><X size={17} /></button></div>
    <p className="bw-muted">有效修改會自動儲存。</p>
    {message ? <p className="bw-warning" role="status">{message}<button className="ghost-button compact" type="button" onClick={() => void client.refresh()}>重新整理</button></p> : null}
    {views.map((g, index) => {
      const field = fields[index], title = g.group === "title", choice = ["category", "payer", "links", "pricing"].includes(g.group);
      const label = { title: "項目名稱", note: "備註", category: "分類", payer: "付款人", links: "關聯行程", pricing: "計價與分攤" }[g.group];
      const hintId = `metadata-${kind}-${record.id}-${g.group}`;
      const owner = g.remote?.held && !g.remote.own_session ? memberLabel(members.find(m => m.user_id === g.remote.owner_id)) : null;
      const text = g.saved && g.syncPending ? g.dirty ? "已儲存，最新同步待確認；另有尚未儲存的修改" : "已儲存，最新同步待確認"
        : !editable ? "目前沒有編輯權限" : !verified ? "協作狀態尚未確認" : !g.supported ? "此項目尚未支援分欄編輯，請使用完整項目編輯"
        : !g.ready ? "群組資料尚未確認" : g.request && !g.saving ? "儲存結果待確認，請重試原請求"
        : g.saving ? "儲存中…" : g.state === "pending" ? "正在取得編輯權，輸入暫存中…" : owner ? `${g.saved ? "已儲存；" : ""}${owner} 正在編輯${label}`
        : g.conflict ? "版本衝突；本機草稿仍保留" : g.failed ? "尚未儲存／儲存失敗" : g.dirty ? "修改中" : g.saved ? "已儲存" : g.writable ? "可編輯" : "聚焦後取得編輯權";
      const input = { id: `${hintId}-input`, name: g.group, value: g.display,
        readOnly: !g.acceptsIntent, "aria-readonly": !g.acceptsIntent, "aria-busy": g.state === "pending" || g.saving,
        "aria-describedby": hintId, onFocus: () => { void client.focus(field); },
        onPointerDown: () => { if (!g.acceptsIntent) void client.focus(field); },
        onKeyDown: event => {
          if (g.acceptsIntent || !["idle", "lost"].includes(g.state) || !verified || g.conflict || event.ctrlKey || event.metaKey || event.altKey) return;
          if (event.key.length === 1 || ["Backspace", "Delete"].includes(event.key) || g.group === "note" && event.key === "Enter") {
            let { selectionStart: start, selectionEnd: end } = event.currentTarget;
            const insertion = event.key.length === 1 ? event.key : event.key === "Enter" ? "\n" : "";
            if (start === end && ["Backspace", "Delete"].includes(event.key)) {
              const boundaries = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(g.display)].map(part => part.index);
              if (event.key === "Backspace") start = boundaries.filter(index => index < start).at(-1) ?? 0;
              else end = boundaries.find(index => index > end) ?? g.display.length;
            }
            void client.focus(field);
            client.input(field, g.display.slice(0, start) + insertion + g.display.slice(end), { immediate: false });
            event.preventDefault();
          }
        },
        onPaste: event => {
          if (g.acceptsIntent || !["idle", "lost"].includes(g.state) || !verified || g.conflict) return;
          const { selectionStart: start, selectionEnd: end } = event.currentTarget;
          void client.focus(field); client.input(field, g.display.slice(0, start) + event.clipboardData.getData("text") + g.display.slice(end), { immediate: false }); event.preventDefault();
        },
        onChange: event => client.input(field, event.target.value),
        onCompositionStart: () => client.composition(field, true), onCompositionEnd: () => client.composition(field, false) };
      return <div key={g.group} className={`bw-metadata-group${owner || !g.acceptsIntent ? " is-readonly" : ""}`}
        tabIndex={choice ? 0 : undefined} role={choice ? "group" : undefined} aria-label={choice ? label : undefined}
        onPointerDownCapture={() => { if (choice) void client.focus(field); }}
        onFocusCapture={() => { if (choice) void client.focus(field); }}
        onCompositionStart={() => { if (g.group === "pricing") client.composition(field, true); }}
        onCompositionEnd={() => { if (g.group === "pricing") client.composition(field, false); }}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && !event.relatedTarget?.closest("[data-budget-metadata-portal]")) client.blur(field); }}>
        <label htmlFor={input.id}>{label}</label>
        {g.group === "pricing" ? <PricingGroup client={client} field={field} view={g} record={record} kind={kind} members={members} /> : g.group === "links" ? <ItineraryPicker items={items} category={record.category} selectedIds={g.display} readOnly={!g.acceptsIntent}
          onChange={ids => client.input(field, ids)} />
          : choice ? <MenuSelect label={label} value={g.display || ""} editable={g.group === "category"} readOnly={!g.acceptsIntent} metadataPortal
            inputProps={{ id: input.id, onKeyDown: input.onKeyDown, onPaste: input.onPaste, onCompositionStart: input.onCompositionStart, onCompositionEnd: input.onCompositionEnd, "aria-describedby": hintId }}
            onValueChange={(value, action) => client.input(field, g.group === "payer" ? value || null : value, { immediate: g.group !== "category" || Boolean(action?.selected) })}
            options={g.group === "payer" ? [{ value: "", label: "未指定" }, ...members.filter(m => m.status === "approved").map(m => ({ value: m.user_id, label: memberLabel(m) })),
              ...(g.display && !members.some(m => m.user_id === g.display && m.status === "approved") ? [{ value: g.display, label: `已退出／無效成員 · ${g.display}`, disabled: true }] : [])]
              : [...new Set([...categoryOptions, g.display].filter(Boolean))].map(value => ({ value, label: value }))} />
          : title ? <input {...input} /> : <textarea {...input} rows={4} />}
        <span id={hintId} className="bw-metadata-status" aria-live={g.dirty && !g.failed && !g.conflict && !g.saving ? "off" : "polite"} aria-atomic="true">{text}</span>
        {g.error ? <p role="alert" className="bw-warning">{g.error}</p> : null}
        <div className="bw-metadata-actions">
          {g.request && !g.saving || g.failed || g.error && !g.conflict ? <button type="button" className="ghost-button compact" disabled={g.saving || g.releasing || g.conflict}
            onClick={() => void client.retry(field)}>{g.request ? "確認儲存結果" : "重試"}</button> : null}
          {g.dirty || g.conflict || g.releasing ? <button type="button" className="ghost-button compact" disabled={g.saving || Boolean(g.request)} onClick={() => void client.discard(field)}>捨棄此欄草稿</button> : null}
        </div>
      </div>;
    })}
    <div className="bw-metadata-summary"><span>分類 · {record.category || "其他"}</span><span>金額 · {record.currency} {record.amount}</span></div>
    <button type="button" className="ghost-button" disabled={!editable} onClick={onLegacy}>編輯完整項目</button>
  </section>;
}
