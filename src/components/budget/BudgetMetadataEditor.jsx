import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { memberLabel } from "../../lib/budgetFinance.js";
import MenuSelect from "../MenuSelect.jsx";
import { recordMetadataValue } from "../../lib/budgetMetadataValues.js";
import {isBudgetComplete} from '../../lib/budgetLifecycleValues.js';
import BudgetPricingFields from "./BudgetPricingFields.jsx";
import { initialPricingDraft, pricingModeDraft, pricingPreview } from "../../lib/budgetPricingGroups.js";
import BudgetSourceEditor from './BudgetSourceEditor.jsx';
import BudgetCollaborationFrame from './BudgetCollaborationFrame.jsx';
import BudgetEditorFeedback from './BudgetEditorFeedback.jsx';

function PricingGroup({ client, field, view, record, kind, members }) {
  const [open, setOpen] = useState(false), custom = useRef(null);
  const snapshot = client.status().snapshot;
  const canonical = (kind === "budget" ? snapshot?.budgetItems : snapshot?.actualExpenses)?.find(r => r.id === record.id) || record;
  const form = !view.dirty && view.display?.participantIds ? initialPricingDraft(view.display, canonical, members) : view.display;
  const retained = kind === "budget" && (snapshot?.actualExpenses || []).some(a => (a.budget_origin_id || a.budget_item_id) === record.id);
  let pricing; try { pricing = pricingPreview(form, canonical, kind); } catch { pricing = null; }
  const input = next => client.input(field, next, { immediate: false });
  function changeMode(mode) {
    if (mode === form.pricing_mode) return;
    if (form.pricing_mode === "custom") custom.current = { ...form.shares };
    input(pricingModeDraft(form, mode, custom.current));
    if (mode === "custom") setOpen(true);
  }
  // Unsupported retained/foreign pricing projections intentionally contain no
  // editable form. Keep the shared editor usable without inventing authority.
  if (!form || !Array.isArray(form.participantIds)) return <p className="bw-muted">{canonical.currency} {canonical.amount} · NT$ {canonical.twd_amount}</p>;
  return <><BudgetPricingFields form={form} pricing={pricing} members={members} locked={!view.acceptsIntent} historical={retained}
    tripRates={snapshot?.tripBudgetRates} setForm={input} update={(key, value) => input({ ...form, [key]: value })}
    membersOpen={open} setMembersOpen={setOpen} changeMode={changeMode} groupMode editRate={kind === "actual"} fixedCurrency={retained} />
    {kind === "budget" && !retained && form.currency !== "TWD" && snapshot?.tripBudgetRates?.rates?.[form.currency]
      && Number(form.exchange_rate) !== Number(snapshot.tripBudgetRates.rates[form.currency]) ? <button type="button" className="ghost-button compact" disabled={view.saving || Boolean(view.request)} onClick={() => void client.useLatestPricingRate(field)}>套用最新旅程匯率</button> : null}</>;
}

// Formal and memory-only Demo share the controller's serial autosave flow.
export default function BudgetMetadataEditor({ client, sourceClient, record, kind, members, services, items, categoryOptions, ItineraryPicker, onClose, onLegacy }) {
  const version = useSyncExternalStore(client.subscribe, client.getVersion);
  const fields = client.groupKeys(kind).map(group => client.get(kind, record.id, group, recordMetadataValue(kind, record, group, client.status().snapshot?.itineraryBudgetLinks)));
  const views = fields.map(g => client.view(g));
  // Full-record editing is only a compatibility escape hatch for Budget.
  // Actual retains its existing form for fields outside this planning scope.
  const needsFullEditor = kind === "actual" || ["title", "note", "category", "payer", "links", "pricing"].some(key => !views.some(g => g.group === key && g.supported));
  const { verified, editable } = client.status();
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
    <BudgetEditorFeedback client={client} sourceClient={kind === 'actual' ? sourceClient : null} recordId={record.id} />
    {kind==='actual'&&sourceClient?<BudgetSourceEditor client={sourceClient} metadata={client} record={record} members={members} services={services}/>:null}
    {views.map((g, index) => {
      const field = fields[index], title = g.group === "title", choice = ["category", "payer", "links", "pricing"].includes(g.group);
      const label = { title: "項目名稱", note: "備註", category: "分類", payer: "付款人", links: "關聯行程", pricing: "計價與分攤" }[g.group];
      const hintId = `metadata-${kind}-${record.id}-${g.group}`;
      const owner = g.remote?.held && !g.remote.own_session ? memberLabel(members.find(m => m.user_id === g.remote.owner_id)) : null;
      const input = { id: `${hintId}-input`, name: g.group, value: g.display,
        readOnly: !g.acceptsIntent, "aria-readonly": !g.acceptsIntent, "aria-busy": g.state === "pending" || g.saving,
        onFocus: () => { void client.focus(field); },
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
      return <BudgetCollaborationFrame key={g.group} className={!g.acceptsIntent ? 'is-unclaimed' : ''} ownerId={owner ? g.remote.owner_id : null} ownerName={owner} label={label}
        tabIndex={choice ? 0 : undefined} role="group" aria-label={label}
        onPointerDownCapture={() => { if (choice) void client.focus(field); }}
        onFocusCapture={() => { if (choice) void client.focus(field); }}
        onCompositionStart={() => { if (g.group === "pricing") client.composition(field, true); }}
        onCompositionEnd={() => { if (g.group === "pricing") client.composition(field, false); }}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && !event.relatedTarget?.closest("[data-budget-metadata-portal]")) client.blur(field); }}>
        <label htmlFor={input.id}>{label}</label>
        {g.group === "pricing" ? <PricingGroup client={client} field={field} view={g} record={record} kind={kind} members={members} /> : g.group === "links" ? <ItineraryPicker items={items} category={record.category} selectedIds={g.display} readOnly={!g.acceptsIntent}
          onChange={ids => client.input(field, ids)} />
          : choice ? <MenuSelect label={label} value={g.display || ""} editable={g.group === "category"} readOnly={!g.acceptsIntent} metadataPortal
            inputProps={{ id: input.id, onKeyDown: input.onKeyDown, onPaste: input.onPaste, onCompositionStart: input.onCompositionStart, onCompositionEnd: input.onCompositionEnd }}
            onValueChange={(value, action) => client.input(field, g.group === "payer" ? value || null : value, { immediate: g.group !== "category" || Boolean(action?.selected) })}
            options={g.group === "payer" ? [{ value: "", label: "未指定" }, ...members.filter(m => m.status === "approved").map(m => ({ value: m.user_id, label: memberLabel(m) })),
              ...(g.display && !members.some(m => m.user_id === g.display && m.status === "approved") ? [{ value: g.display, label: `已退出／無效成員 · ${g.display}`, disabled: true }] : [])]
              : [...new Set([...categoryOptions, g.display].filter(Boolean))].map(value => ({ value, label: value }))} />
          : title ? <input {...input} /> : <textarea {...input} rows={4} />}
      </BudgetCollaborationFrame>;
    })}
    <div className="bw-metadata-summary"><span>分類 · {record.category || "其他"}</span><span>金額 · {isBudgetComplete(record)||record.pricing_ready?`${record.currency} ${record.amount}`:'尚未填寫'}</span></div>
    {isBudgetComplete(record) && needsFullEditor ? <button type="button" className="ghost-button" disabled={!editable} onClick={onLegacy}>編輯完整項目</button> : null}
  </section>;
}
