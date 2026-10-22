import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { loadLatestDraftForEntity, useDraftAutosave } from "../../lib/draftAutosave.js";
import MenuSelect from "../MenuSelect.jsx";
import { budgetDay, budgetStage, calculatePricing, comparisonRows, memberLabel, money, participantsFor, pricingLabels, recordAllocations, recordForm } from "../../lib/budgetFinance.js";

const categoryOrder = ["機票", "交通", "住宿", "門票", "餐飲", "購物", "其他"];
const palette = ["#52766a", "#a2b2a6", "#b6a28a", "#d3c6b2", "#829da0", "#aeb0a2", "#dcd8cd"];
const empty = recordForm(null, [], "", []);

// Both editor controllers stay mounted. The right panel and inline cell share
// this exact draft, lock, conflict baseline and explicit save operation.
function useWorkspaceEditor(kind, props) {
  const { activeTrip, members, currentUserId, services, disableDraftAutosave, restoreDrafts, useEditLocks, canEdit } = props;
  const isActual = kind === "actual";
  const table = isActual ? "actual_expenses" : "budget_items";
  const entityType = isActual ? "actual_expense" : "budget_item";
  const key = isActual ? "actual_expense_id" : "budget_item_id";
  const records = isActual ? props.actualExpenses : props.budgetItems;
  const participants = isActual ? props.actualParticipants : props.budgetParticipants;
  const [context, setContext] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const guardId = `${kind}:${activeTrip?.id || "no-trip"}`;
  const draft = useDraftAutosave({ defaultForm: context?.seed || empty, disabled: disableDraftAutosave,
    editingId: context?.id, entityType, forceDirtyOnOpen: Boolean(context?.restored), isOpen: Boolean(context),
    serverUpdatedAt: context?.baseUpdatedAt, tripId: activeTrip?.id, userId: currentUserId });
  const { form, replaceForm, resetDraft } = draft;
  const hasUnsavedChanges = draft.hasUnsavedChanges || Boolean(disableDraftAutosave && context && JSON.stringify(form) !== JSON.stringify(context.seed));

  async function close(force = false) {
    if (savingRef.current) return false;
    if (!force && hasUnsavedChanges && !window.confirm("放棄尚未儲存的變更？")) return false;
    if (useEditLocks && context?.id) await services.release(table, context.id, currentUserId);
    resetDraft(empty);
    setContext(null);
    setError("");
    return true;
  }
  async function save() {
    if (savingRef.current || !canEdit || !context || context.tripId !== activeTrip?.id) return false;
    let pricing;
    try {
      if (!form.title.trim()) throw new Error("請填寫項目名稱。");
      pricing = calculatePricing(form);
    } catch (err) { setError(err.message); return false; }
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      let saveBaseline = context.baseUpdatedAt;
      if (useEditLocks && context.id && context.restored) {
        const latest = await services.read(table, context.id, context.tripId);
        if (latest.error || !latest.data || latest.data.updated_at !== context.baseUpdatedAt) {
          setError("資料已由其他人更新。你的草稿仍保留，請取消後重新開啟最新資料。"); return false;
        }
        const lock = await services.acquire(table, latest.data, currentUserId);
        if (lock.error || lock.lockedByAnotherUser) { setError("其他成員正在編輯此項目，請稍後再試。"); return false; }
        saveBaseline = lock.data.updated_at;
        setContext((current) => ({ ...current, baseUpdatedAt: saveBaseline, restored: false }));
      }
      const result = await (isActual ? props.onSaveActual : props.onSave)({ ...form, ...pricing }, context.id,
        { baseUpdatedAt: saveBaseline, tripId: context.tripId });
      if (!result?.ok) {
        setError(result?.conflict ? "資料已由其他人更新。你的草稿仍保留，請取消後重新開啟最新資料。" : result?.error?.message || "儲存失敗，請重試。");
        return false;
      }
      if (useEditLocks && context.id) await services.release(table, context.id, currentUserId);
      resetDraft(empty);
      setContext(null);
      return true;
    } catch (err) { setError(err.message); return false; }
    finally { savingRef.current = false; setSaving(false); }
  }
  services.useGuard(guardId, useMemo(() => ({ isActive: Boolean(context), isDirty: hasUnsavedChanges || saving, save, discard: () => close(true) }),
    [context, form, hasUnsavedChanges, saving]));

  useEffect(() => {
    if (!context || context.tripId === activeTrip?.id) return;
    // useDraftAutosave's previous-key cleanup preserves the old trip draft.
    // Do not resetDraft here: its key already points at the destination trip.
    if (useEditLocks && context.id) void services.release(table, context.id, currentUserId);
    replaceForm(empty);
    setContext(null);
    setError("");
  }, [activeTrip?.id]);

  useEffect(() => {
    if (!restoreDrafts || disableDraftAutosave || context || !activeTrip?.id || !currentUserId || !canEdit) return;
    const latest = loadLatestDraftForEntity({ entityType, tripId: activeTrip.id, userId: currentUserId });
    if (!latest || (latest.entityId !== "new" && !records.some((row) => row.id === latest.entityId))) return;
    // A restored draft keeps its original conflict baseline, not the latest
    // server timestamp. Locks are reacquired and checked before saving.
    const seed = { ...empty, ...latest.draft.form };
    replaceForm(seed, { dirty: true });
    setContext({ id: latest.entityId === "new" ? null : latest.entityId, tripId: activeTrip.id,
      seed, baseUpdatedAt: latest.draft.serverUpdatedAt || null, restored: true });
  }, [activeTrip?.id, restoreDrafts, records, context, currentUserId, canEdit]);

  async function open(record = null, overrides = {}) {
    if (!canEdit || savingRef.current) return false;
    if (useEditLocks && record && services.isLocked(record, currentUserId)) return false;
    if (record && context?.id === record.id) return true;
    if (!(await services.handoff({ tripId: activeTrip.id }))) return false;
    let locked = record;
    if (useEditLocks && record) {
      const result = await services.acquire(table, record, currentUserId);
      if (result.error || result.lockedByAnotherUser) { setError("其他成員正在編輯此項目。"); return false; }
      locked = result.data || record;
    }
    const seed = { ...recordForm(record, participants, key, members, props.itineraryBudgetLinks), ...overrides };
    replaceForm(seed);
    setContext({ id: record?.id || null, seed, baseUpdatedAt: locked?.updated_at || null, tripId: activeTrip.id });
    setError("");
    return true;
  }
  return { ...draft, hasUnsavedChanges, context, error, saving, open, close, save };
}

function Stats({ records, rows, members, actual, budgets, viewpoint, setViewpoint }) {
  const validView = ["average", "all", ...members.map((member) => member.user_id)].includes(viewpoint) ? viewpoint : "average";
  const allocations = records.map((record) => recordAllocations(record, participantsFor(record, rows, actual ? "actual_expense_id" : "budget_item_id", members)));
  const total = records.reduce((sum, row) => sum + Number(row.twd_amount || 0), 0);
  const unknown = allocations.some((value) => value === null || Object.keys(value).some((id) => !members.some((member) => member.user_id === id)));
  const people = members.map((member) => ({ ...member, amount: allocations.reduce((sum, shares) => sum + (shares?.[member.user_id] || 0), 0) }));
  const main = validView === "all" ? total : validView === "average" ? members.length ? total / members.length : 0 : people.find((person) => person.user_id === validView)?.amount || 0;
  const categories = new Map();
  records.forEach((record, index) => {
    const category = record.category || budgets.find((row) => row.id === record.budget_item_id)?.category || "其他";
    const value = validView === "all" ? Number(record.twd_amount) : validView === "average" ? members.length ? Number(record.twd_amount) / members.length : 0 : allocations[index]?.[validView] || 0;
    categories.set(category, (categories.get(category) || 0) + value);
  });
  const categoriesList = [...categories].sort((a, b) => b[1] - a[1]);
  return <section className="bw-stats" aria-label="旅程費用摘要">
    <div className="bw-viewpoint"><span>統計視角</span><MenuSelect label="統計視角" value={validView} onValueChange={setViewpoint} options={[{value:"average",label:"人均旅費"}, ...members.map((member)=>({value:member.user_id,label:memberLabel(member)})), {value:"all",label:"全旅程"}]} /></div>
    <div className="bw-hero"><span>{validView === "average" ? `人均${actual ? "實際" : "預估"}旅費` : validView === "all" ? `全旅程${actual ? "實付" : "預算"}` : `${memberLabel(members.find((row) => row.user_id === validView))} 的${actual ? "實際" : "預估"}負擔`}</span>
      <strong><small>NT$</small> {unknown && validView !== "all" && validView !== "average" ? "—" : money(main)}</strong>
      <span className="bw-muted">{validView === "average" ? `全團平均 · ${members.length} 位成員` : "依參與項目計算"}</span>
    </div>
    {validView !== "all" ? <div className="bw-stat-line"><span>全旅程{actual ? "實付" : "預算"}</span><b>NT$ {money(total)}</b></div> : null}
    {unknown ? <p className="bw-warning">部分項目的分攤成員或金額待確認。</p> : null}
    <section><h4>各成員{actual ? "實際" : "預估"}負擔</h4>{people.map((person) => <div className="bw-stat-line" key={person.user_id}><span>{memberLabel(person)}</span><b>{unknown ? "—" : money(person.amount)}</b></div>)}</section>
    <section><h4>分類{actual ? "支出" : "預算"}</h4>
      <div className="bw-distribution" role="img" aria-label="分類金額占比">{categoriesList.map(([category, value], index) => <span key={category} style={{ flex: Math.max(value, 0), backgroundColor: palette[index % palette.length] }} title={`${category} ${money(value)}`} />)}</div>
      {categoriesList.map(([category, value], index) => <div className="bw-stat-line" key={category}><span className="bw-category-label"><i style={{ backgroundColor: palette[index % palette.length] }} />{category}</span><span><b>{unknown && validView !== "all" && validView !== "average" ? "—" : money(value)}</b><small>{main ? Math.round(value / main * 100) : 0}%</small></span></div>)}
    </section>
    {actual ? null : <div className="bw-stat-line bw-paid-summary"><span>已記錄實付的項目</span><span>{records.filter((row) => row.hasActual).length} / {records.length}</span></div>}
  </section>;
}

function PricingSummary({ amount, twdAmount, currency, mode, count }) {
  const perPerson = mode === "custom" ? "依成員" : count ? `${twdAmount % count ? "約 " : ""}NT$ ${money(twdAmount / count)}` : "—";
  return <div className="bw-calculation"><div><span>每人</span><strong>{perPerson}</strong></div><div><span>總額</span><strong>NT$ {money(twdAmount)}</strong>{currency !== "TWD" ? <small>{currency} {money(amount)}</small> : null}</div></div>;
}

function itinerarySuggestionScore(item, category) {
  const title = item.title || "";
  if (category === "住宿" && /早餐|午餐|晚餐|起床|出發/.test(title)) return 0;
  const types = { "住宿": ["hotel"], "餐飲": ["food"], "交通": ["transport"], "機票": ["transport"], "門票": ["attraction"], "購物": ["shopping"] };
  const hints = { "住宿": /飯店|酒店|住宿|villa|check\s*in|入住/i, "餐飲": /早餐|午餐|晚餐|餐廳|火鍋|燒肉|咖啡|甜點/i, "交通": /租車|還車|車站|巴士|新幹線|名鐵/i, "機票": /航班|航空|虎航|飛機|起飛|降落|flight/i, "購物": /購物|採買|伴手禮|shopping/i };
  const typeMatch = (types[category] || []).includes(item.type) || category === "交通" && item.item_type === "transport";
  const hintMatch = hints[category]?.test(title);
  if (category === "機票") return hintMatch ? 120 : 0;
  return (typeMatch ? 100 : 0) + (hintMatch ? 30 : 0);
}

function ItineraryPicker({ items, selectedIds, category, onChange }) {
  const [query, setQuery] = useState("");
  const [day, setDay] = useState("");
  const days = [...new Set(items.map((item) => Number(item.day_index)))].sort((a, b) => a - b);
  const matches = items.filter((item) => (day === "" || Number(item.day_index) === Number(day)) && item.title.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => Number(a.day_index) - Number(b.day_index) || Number(a.sort_order || 0) - Number(b.sort_order || 0));
  const suggested = matches.filter((item) => itinerarySuggestionScore(item, category) > 0)
    .sort((a, b) => itinerarySuggestionScore(b, category) - itinerarySuggestionScore(a, category)).slice(0, 5);
  function toggle(id) { onChange(selectedIds.includes(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id]); }
  function option(item) { return <label key={item.id}><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggle(item.id)} /><span>{item.title}</span></label>; }
  return <section className="bw-link-picker" aria-label="關聯行程">
    <div className="bw-link-heading"><span>關聯行程</span><small>{selectedIds.length} 項</small></div>
    {selectedIds.length ? <ul className="bw-linked-items">{selectedIds.map((id) => {
      const item = items.find((row) => row.id === id);
      return <li key={id}><span>{item ? `Day ${Number(item.day_index) + 1} · ${item.title}` : "已移除的行程"}</span><button type="button" className="bw-icon" aria-label={`取消關聯 ${item?.title || "已移除的行程"}`} onClick={() => toggle(id)}><X size={13} /></button></li>;
    })}</ul> : null}
    <details className="bw-link-options"><summary>{selectedIds.length ? "變更關聯" : "選擇行程"}</summary>
      <div className="bw-link-filters"><input aria-label="搜尋關聯行程" placeholder="搜尋行程" value={query} onChange={(event) => setQuery(event.target.value)} /><MenuSelect label="關聯行程日期" value={day} onValueChange={setDay} options={[{value:"",label:"全部 Day"},...days.map(value=>({value:String(value),label:`Day ${value+1}`}))]} /></div>
      <div className="bw-link-results">{suggested.length ? <fieldset aria-label="建議行程" className="bw-link-suggestions"><legend>建議</legend>{suggested.map(option)}</fieldset> : null}{days.filter((value) => matches.some((item) => Number(item.day_index) === value)).map((value) => <fieldset key={value} aria-label={`Day ${value + 1} 行程`}><legend>Day {value + 1}</legend>{matches.filter((item) => Number(item.day_index) === value).map(option)}</fieldset>)}{!matches.length ? <p className="bw-muted">沒有符合的行程</p> : null}</div>
    </details>
  </section>;
}

function RecordEditor({ editor, actual, members, items, budgets, budgetParticipants, actualExpenses, onCancel }) {
  const { form, setForm, context, error, saving } = editor;
  const [membersOpen, setMembersOpen] = useState(false);
  const hasActual = !actual && context.id && actualExpenses.some((expense) => expense.budget_item_id === context.id);
  const participantOptions = [...members, ...form.participantIds.filter((id) => !members.some((member) => member.user_id === id))
    .map((id) => ({ user_id: id, display_name: `未列成員 · ${id.slice(0, 6)}` }))];
  let pricing;
  try { pricing = calculatePricing(form); } catch { pricing = null; }
  function update(key, value) { setForm({ ...form, [key]: value }); }
  function toggle(key, value) { update(key, form[key].includes(value) ? form[key].filter((id) => id !== value) : [...form[key], value]); }
  function changeMode(mode) {
    const next = { ...form, pricing_mode: mode };
    if (pricing) {
      next.amount = pricing.amount;
      if (mode === "per_person") next.unit_amount = Math.round(pricing.amount / form.participantIds.length * 100) / 100;
      if (mode === "custom") next.shares = pricing.shares;
    }
    setForm(next);
    if (mode === "custom") setMembersOpen(true);
  }
  return <form className="bw-editor" aria-label={actual ? "實付編輯" : "預算編輯"} autoComplete="off" onSubmit={(event) => { event.preventDefault(); void editor.save(); }}>
    <div className="bw-detail-heading"><h3>{actual && !context.id && form.budget_item_id ? "登記付款" : `${context.id ? "編輯" : "新增"}${actual ? "實付" : "預算"}`}</h3><button aria-label="關閉編輯" className="bw-icon" type="button" disabled={saving} onClick={onCancel}><X size={17} /></button></div>
    {error ? <p role="alert" className="bw-warning">{error}</p> : null}
    <label>項目<input name="title" required value={form.title} onChange={(event) => update("title", event.target.value)} /></label>
    {!actual ? <div className="bw-two-fields"><div className="bw-field"><span>分類</span><MenuSelect editable label="分類" value={form.category} onValueChange={(value)=>update("category",value)} options={categoryOrder.map(value=>({value,label:value}))} /></div><label>細項<input value={form.subcategory} onChange={(event) => update("subcategory", event.target.value)} /></label></div> : null}
    {!actual ? <fieldset className="bw-modes"><legend>計價方式</legend>{Object.entries(pricingLabels).map(([key, label]) => <button key={key} type="button" aria-pressed={form.pricing_mode === key} onClick={() => changeMode(key)}>{label}</button>)}</fieldset> : null}
    <div className="bw-two-fields"><label>{form.pricing_mode === "per_person" ? "每人單價" : "總額"}<input name="amount" required min="0" step="0.01" type="number" disabled={form.pricing_mode === "custom"} value={form.pricing_mode === "custom" ? pricing?.amount ?? "" : form.pricing_mode === "per_person" ? form.unit_amount : form.amount} onChange={(event) => update(form.pricing_mode === "per_person" ? "unit_amount" : "amount", event.target.value)} /></label>
      <div className="bw-field"><span>幣別</span><MenuSelect label="幣別" value={form.currency} onValueChange={(value)=>setForm({...form,currency:value,exchange_rate:value === "TWD" ? 1 : form.exchange_rate === 1 ? "" : form.exchange_rate})} options={[...new Set(["TWD","JPY","USD","EUR","KRW","HKD",form.currency])].filter(Boolean).map(value=>({value,label:value}))} /></div></div>
    {form.currency !== "TWD" ? <label>匯率（1 {form.currency} → TWD）<input min="0.000001" step="0.000001" required type="number" value={form.exchange_rate} onChange={(event) => update("exchange_rate", event.target.value)} /></label> : null}
    <details className="bw-member-options" open={membersOpen} onToggle={(event) => setMembersOpen(event.currentTarget.open)}><summary>參與成員 · {form.participantIds.length} 人</summary><fieldset className="bw-participants"><legend>各人負擔 · {form.pricing_mode === "custom" ? form.currency : "TWD"}</legend>{participantOptions.map((member) => <label key={member.user_id}><input type="checkbox" checked={form.participantIds.includes(member.user_id)} onChange={() => toggle("participantIds", member.user_id)} />{memberLabel(member)}{form.pricing_mode === "custom" && form.participantIds.includes(member.user_id) ? <input aria-label={`${memberLabel(member)} 分攤金額`} required min="0" step="0.01" type="number" value={form.shares[member.user_id] ?? ""} onChange={(event) => update("shares", { ...form.shares, [member.user_id]: event.target.value })} /> : <b>{pricing ? money(pricing.allocations[member.user_id] || 0) : "—"}</b>}</label>)}</fieldset></details>
    {pricing ? <PricingSummary amount={pricing.amount} twdAmount={pricing.twd_amount} currency={form.currency} mode={form.pricing_mode} count={form.participantIds.length} /> : null}
    <div className="bw-field"><span>付款人</span><MenuSelect label="付款人" value={form.payer_id} onValueChange={(value)=>update("payer_id",value)} options={[{value:"",label:"未指定"},...members.map(member=>({value:member.user_id,label:memberLabel(member)}))]} /></div>
    {actual ? <>
      <details className="bw-secondary-fields"><summary>更多設定</summary>
        <div className="bw-two-fields"><div className="bw-field"><span>分類</span><MenuSelect editable label="分類" value={form.category} onValueChange={(value)=>update("category",value)} options={categoryOrder.map(value=>({value,label:value}))} /></div><label>細項<input value={form.subcategory} onChange={(event) => update("subcategory", event.target.value)} /></label></div>
        <label>付款時間<input type="datetime-local" value={form.paid_at} onChange={(event) => update("paid_at", event.target.value)} /></label>
        <div className="bw-field"><span>來源預算</span><MenuSelect label="來源預算" value={form.budget_item_id} onValueChange={(value) => {
          const budget = budgets.find((row) => row.id === value);
          if (!budget) { update("budget_item_id", ""); return; }
          const seed = recordForm(budget, budgetParticipants, "budget_item_id", members);
          setForm({ ...form, ...seed, budget_item_id: budget.id, paid_at: form.paid_at });
        }} options={[{value:"",label:"直接新增"},...budgets.map(row=>({value:row.id,label:row.title}))]} /></div>
        <fieldset className="bw-modes"><legend>計價方式</legend>{Object.entries(pricingLabels).map(([key, label]) => <button key={key} type="button" aria-pressed={form.pricing_mode === key} onClick={() => changeMode(key)}>{label}</button>)}</fieldset>
      </details>
    </> : <>
      {hasActual ? <div className="bw-payment-note"><span><Check size={14} />已付款</span><small>修改預算不會變更實付金額。</small></div> : null}
      <ItineraryPicker items={items} category={form.category} selectedIds={form.linkedItemIds} onChange={(ids) => update("linkedItemIds", ids)} />
    </>}
    <label>備註<textarea rows={2} value={form.note} onChange={(event) => update("note", event.target.value)} /></label>
    <div className="bw-editor-actions"><button className="ghost-button compact" type="button" disabled={saving} onClick={onCancel}>取消</button><button className="primary-button compact" type="submit" disabled={saving}>{saving ? "儲存中…" : actual && !context.id && form.budget_item_id ? "確認付款" : "儲存"}</button></div>
  </form>;
}

function RecordDetail({ record, actual, participants, members, links, items, payments, canEdit, onEdit, onDelete, onConvert, onViewPayment, renderAttachments }) {
  const shares = recordAllocations(record, participants);
  const mode = record.pricing_mode || (record.split_type === "custom" ? "custom" : "split_total");
  return <section className="bw-detail"><div className="bw-detail-heading"><span>{record.category || "其他"}{record.subcategory ? ` · ${record.subcategory}` : ""}</span><button className="bw-icon" aria-label="編輯項目" type="button" disabled={!canEdit} onClick={onEdit}><Pencil size={16} /></button></div>
    <h3>{record.title}</h3><PricingSummary amount={record.amount} twdAmount={record.twd_amount} currency={record.currency} mode={mode} count={participants.length} />
    <dl><div><dt>計價方式</dt><dd>{pricingLabels[mode]}</dd></div>{mode === "per_person" ? <div><dt>每人單價</dt><dd>{record.currency} {money(record.unit_amount)}</dd></div> : null}<div><dt>參與成員</dt><dd>{participants.length} 人</dd></div>
      <div><dt>付款人</dt><dd>{memberLabel(members.find((row) => row.user_id === record.payer_id))}</dd></div>
      {record.currency !== "TWD" ? <div><dt>換算匯率</dt><dd>1 {record.currency} = {record.exchange_rate} TWD</dd></div> : null}
      <div><dt>關聯行程</dt><dd>{budgetDay(record, links, items)}</dd></div>
      {actual ? <div><dt>付款時間</dt><dd>{new Date(record.paid_at).toLocaleString("zh-TW", { hour12: false })}</dd></div> : null}
    </dl><section><h4>各人負擔 <small>TWD</small></h4>{participants.map((participant) => <div className="bw-stat-line" key={participant.user_id}><span>{memberLabel(members.find((member) => member.user_id === participant.user_id))}</span><b>{shares ? money(shares[participant.user_id]) : "待確認"}</b></div>)}</section>
    {record.note ? <section><h4>備註</h4><p>{record.note}</p></section> : null}
    {renderAttachments?.(record)}
    {!actual && payments.length ? <section className="bw-payment-list"><h4><Check size={14} />已付款 · {payments.length} 筆</h4>{payments.map((expense) => <button key={expense.id} type="button" onClick={() => onViewPayment(expense)}><span>{memberLabel(members.find((member) => member.user_id === expense.payer_id))}</span><b>NT$ {money(expense.twd_amount)}</b><ArrowRight size={13} /></button>)}</section> : null}
    <div className="bw-detail-actions">{!actual ? <button className="ghost-button compact" disabled={!canEdit} type="button" onClick={onConvert}>{payments.length ? "再登記一筆付款" : "登記付款"} <ArrowRight size={14} /></button> : null}<button className="bw-icon bw-danger" aria-label="刪除項目" disabled={!canEdit} type="button" onClick={onDelete}><Trash2 size={16} /></button></div>
  </section>;
}

export default function BudgetWorkspace(incoming) {
  const props = { disableDraftAutosave: false, restoreDrafts: true, useEditLocks: true, ...incoming,
    members: incoming.members.filter((row) => row.status === "approved") };
  const { activeTrip, budgetItems, actualExpenses, budgetParticipants, actualParticipants, itineraryBudgetLinks: links, items, members, canEdit, services, baseline } = props;
  const [stage, setStage] = useState(() => props.demoStage || budgetStage(activeTrip));
  const [view, setView] = useState(() => (props.demoStage || budgetStage(activeTrip)) === "planning" ? "budget" : "actual");
  const [panel, setPanel] = useState("stats");
  const [viewpoint, setViewpoint] = useState("average");
  const [selected, setSelected] = useState(null);
  const [inline, setInline] = useState(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const budgetEditor = useWorkspaceEditor("budget", { ...props, restoreDrafts: props.restoreDrafts && view === "budget" });
  const actualEditor = useWorkspaceEditor("actual", { ...props, restoreDrafts: props.restoreDrafts && view === "actual" });
  const activeEditor = actualEditor.context ? actualEditor : budgetEditor.context ? budgetEditor : null;
  const editingActual = activeEditor === actualEditor;
  const sideRef = useRef(null);
  useEffect(() => { if (sideRef.current) sideRef.current.scrollTop = 0; }, [panel, selected?.id, activeEditor?.context?.id, Boolean(activeEditor), activeTrip?.id]);
  useEffect(() => {
    const update = () => setStage(props.demoStage || budgetStage(activeTrip));
    update();
    const timer = window.setInterval(update, 30000);
    return () => window.clearInterval(timer);
  }, [activeTrip?.id, activeTrip?.start_date, activeTrip?.end_date, activeTrip?.status, props.demoStage]);
  useEffect(() => { setView(stage === "planning" ? "budget" : "actual"); setInline(null); }, [stage, activeTrip?.id]);
  useEffect(() => { setSelected(null); setPanel("stats"); setViewpoint("average"); setQuery(""); setCategory(""); }, [activeTrip?.id]);
  useEffect(() => { if (activeEditor) setPanel("detail"); if (!activeEditor) setInline(null); }, [Boolean(activeEditor)]);

  const actual = view === "actual";
  const compare = view === "compare" && stage === "settled";
  const rows = actual ? actualExpenses : budgetItems;
  const participantRows = actual ? actualParticipants : budgetParticipants;
  const joinKey = actual ? "actual_expense_id" : "budget_item_id";
  const comparedRows = compare && baseline ? comparisonRows(baseline, actualExpenses) : [];
  const categories = [...new Set((compare ? comparedRows : rows).map((row) => row.category || budgetItems.find((item) => item.id === row.budget_item_id)?.category || "其他"))]
    .sort((a, b) => (categoryOrder.indexOf(a) < 0 ? 99 : categoryOrder.indexOf(a)) - (categoryOrder.indexOf(b) < 0 ? 99 : categoryOrder.indexOf(b)) || a.localeCompare(b));
  const displayRows = (compare ? comparedRows : rows).map((row) => ({ ...row, category: row.category || budgetItems.find((item) => item.id === row.budget_item_id)?.category || "其他" }))
    .filter((row) => (!category || row.category === category) && `${row.title} ${row.subcategory || ""} ${row.note || ""}`.toLowerCase().includes(query.toLowerCase()));
  const rawSelectedRecord = selected?.kind === "actual" ? actualExpenses.find((row) => row.id === selected.id) : budgetItems.find((row) => row.id === selected?.id);
  const selectedRecord = rawSelectedRecord ? { ...rawSelectedRecord, category: rawSelectedRecord.category || budgetItems.find((row) => row.id === rawSelectedRecord.budget_item_id)?.category || "其他" } : null;
  useEffect(() => { if (budgetEditor.error || actualEditor.error) setPanel("detail"); }, [budgetEditor.error, actualEditor.error]);

  async function select(row) {
    if (activeEditor?.context?.id !== row.id && !(await services.handoff({ tripId: activeTrip.id }))) return;
    setSelected({ kind: actual ? "actual" : "budget", id: row.id }); setPanel("detail"); setInline(null);
  }
  async function edit(row, field) {
    const editor = actual ? actualEditor : budgetEditor;
    if (!(await editor.open(row))) return;
    setSelected({ kind: actual ? "actual" : "budget", id: row.id }); setPanel("detail");
    if (field !== "title" && (row.pricing_mode === "custom" || row.split_type === "custom" || (editor.context?.id === row.id && editor.form.pricing_mode === "custom"))) {
      setInline(null);
      window.setTimeout(() => {
        const members = document.querySelector('.bw-member-options');
        if (members) members.open = true;
        document.querySelector('.bw-editor input[aria-label$="分攤金額"]')?.focus();
      }, 0);
    } else {
      const participants = participantsFor(row, participantRows, joinKey, members);
      setInline({ id: row.id, field, before: editor.context?.id === row.id ? editor.form : recordForm(row, participantRows, joinKey, members, links), dirty: editor.context?.id === row.id && editor.hasUnsavedChanges,
        value: field === "title" ? row.title : field === "person" ? Math.round(Number(row.amount) / participants.length * 100) / 100 : row.amount });
    }
  }
  function inlineChange(value) {
    setInline({ ...inline, value });
    const editor = actual ? actualEditor : budgetEditor;
    const form = editor.form;
    if (inline.field === "title") editor.setForm({ ...form, title: value });
    else if (inline.field === "person") editor.setForm({ ...form, pricing_mode: "per_person", unit_amount: value });
    else if (form.pricing_mode === "custom") {
      setInline(null); // A custom total cannot silently overwrite member shares.
      window.setTimeout(() => document.querySelector('.bw-editor input[aria-label$="分攤金額"]')?.focus(), 0);
    } else editor.setForm({ ...form, pricing_mode: "split_total", amount: value });
  }
  function cell(row, field, content) {
    let currentPricing;
    if (activeEditor) { try { currentPricing = calculatePricing(activeEditor.form); } catch { /* Keep invalid input editable. */ } }
    const count = activeEditor?.form.participantIds.length || 1;
    if (inline?.id === row.id && inline.field === field && activeEditor) return <input autoFocus aria-label={`快速修改${field === "title" ? "項目" : field === "person" ? "每人預算" : "總額"}（${row.currency}）`} type={field === "title" ? "text" : "number"} min="0" step="0.01" value={field === "title" ? activeEditor.form.title : field === "person" ? activeEditor.form.pricing_mode === "per_person" ? activeEditor.form.unit_amount : Math.round(Number(activeEditor.form.amount) / count * 100) / 100 : currentPricing?.amount ?? activeEditor.form.amount}
      onClick={(event) => event.stopPropagation()} onChange={(event) => inlineChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void activeEditor.save(); } if (event.key === "Escape") { event.preventDefault(); if (inline.dirty) activeEditor.replaceForm(inline.before, { dirty: true }); else void activeEditor.close(true); setInline(null); } }} />;
    return <button className={`bw-cell${field === "person" ? " bw-person" : ""}`} type="button" onDoubleClick={(event) => { event.stopPropagation(); void edit(row, field); }} title={canEdit ? "點一下查看，點兩下編輯" : "查看明細"}>{content}</button>;
  }
  async function changeView(next) {
    if (!(await services.handoff({ tripId: activeTrip.id }))) return;
    setView(next); setSelected(null); setInline(null); setCategory(""); setQuery(""); setPanel("stats");
  }
  async function add() {
    const editor = actual || compare ? actualEditor : budgetEditor;
    if (await editor.open(null, actual || compare ? { payer_id: props.currentUserId || "" } : {})) { if (compare) setView("actual"); setPanel("detail"); setInline(null); }
  }
  async function remove() {
    if (!(await services.handoff({ tripId: activeTrip.id }))) return;
    if (!window.confirm(`刪除「${selectedRecord.title}」？`)) return;
    const result = await (selected.kind === "actual" ? props.onDeleteActual : props.onDelete)(selectedRecord.id, { baseUpdatedAt: selectedRecord.updated_at, tripId: activeTrip.id });
    if (result?.ok === false) return;
    setSelected(null); setPanel("stats");
  }
  async function convert() {
    const seed = recordForm(selectedRecord, budgetParticipants, "budget_item_id", members);
    if (await actualEditor.open(null, { ...seed, budget_item_id: selectedRecord.id })) { setView("actual"); setPanel("detail"); }
  }
  async function viewPayment(expense) {
    if (!(await services.handoff({ tripId: activeTrip.id }))) return;
    setView("actual"); setCategory(""); setQuery(""); setInline(null);
    setSelected({ kind: "actual", id: expense.id }); setPanel("detail");
  }
  const statsRecords = (actual || compare ? actualExpenses : budgetItems).map((row) => ({ ...row, hasActual: actualExpenses.some((expense) => expense.budget_item_id === row.id) }));
  const baselineTotal = baseline?.payload?.items?.reduce((sum, row) => sum + Number(row.twd_amount), 0) || 0;
  const actualTotal = actualExpenses.reduce((sum, row) => sum + Number(row.twd_amount), 0);
  return <section className="budget-panel budget-workspace" aria-label="預算工作區" data-stage={stage}>
    <div className="bw-main"><div className="bw-toolbar"><h3>預算</h3><div className="bw-tabs" role="tablist" aria-label="費用資料檢視">
      {[['budget', '預算'], ['actual', '實付'], ...(stage === "settled" ? [['compare', '對照']] : [])].map(([key, label]) => <button role="tab" key={key} type="button" aria-selected={view === key} onClick={() => void changeView(key)}>{label}</button>)}
    </div>
      <div className="bw-filters"><label><Search size={15} /><input aria-label="搜尋項目" placeholder="搜尋項目" value={query} onChange={(event) => setQuery(event.target.value)} /></label><MenuSelect label="費用分類" value={category} onValueChange={setCategory} options={[{value:"",label:"全部分類"},...categories.map(value=>({value,label:value}))]} /><span>{displayRows.length} 筆</span></div>
      <button className="primary-button compact bw-add" disabled={!canEdit} type="button" onClick={() => void add()}><Plus size={15} />{actual || compare ? "新增實付" : "新增預算"}</button></div>
      {compare ? <div className="bw-comparison-summary">{baseline ? <><span>出發前預算<b>NT$ {money(baselineTotal)}</b></span><span>實際支出<b>NT$ {money(actualTotal)}</b></span><span>差額<b>{actualTotal - baselineTotal > 0 ? "+" : ""}{money(actualTotal - baselineTotal)}</b></span></> : <p>無出發前快照，無法還原當時預算。</p>}</div> : null}
      <div className="bw-table-scroll"><table className="bw-table" aria-label={compare ? "出發前預算對照" : actual ? "實付明細" : "預算明細"}><thead><tr><th className="bw-day">Day</th><th className="bw-title">項目</th><th className="bw-number">{compare ? "出發前預算" : actual ? "每人負擔" : "每人預算"}<small>TWD</small></th><th className="bw-number">{compare ? "實付" : "總額"}<small>TWD</small></th><th>{compare ? "差額" : "狀態"}</th></tr></thead>
        <tbody>{categories.filter((value) => displayRows.some((row) => row.category === value)).map((value) => <Fragment key={value}><tr className="bw-group"><th colSpan={compare ? 2 : 3}>{value}<small>{displayRows.filter((row) => row.category === value).length} 筆</small></th>{compare ? <td className="bw-number">{money(displayRows.filter((row) => row.category === value).reduce((sum, row) => sum + row.planned, 0))}</td> : null}<td className="bw-number">{money(displayRows.filter((row) => row.category === value).reduce((sum, row) => sum + Number(compare ? row.actual : row.twd_amount), 0))}</td><td /></tr>
          {displayRows.filter((row) => row.category === value).map((row) => {
            const people = participantsFor(row, participantRows, joinKey, members);
            const custom = row.pricing_mode === "custom" || row.split_type === "custom";
            const isSelected = selected?.id === row.id || activeEditor?.context?.id === row.id;
            return <tr key={row.id} className={`bw-row${isSelected ? " is-selected" : ""}`} onClick={compare ? undefined : () => void select(row)}>
              <td className="bw-day">{budgetDay(row, compare ? baseline?.payload?.links || [] : links, compare ? baseline?.payload?.itinerary || [] : items)}</td><td>{compare ? <span>{row.title}{row.extra ? <small className="bw-muted"> · 預算外</small> : null}</span> : cell(row, "title", row.title)}</td>
              <td className="bw-number">{compare ? money(row.planned) : cell(row, "person", custom ? "依成員" : people.length ? `${Number(row.twd_amount) % people.length ? "約 " : ""}${money(Number(row.twd_amount) / people.length)}` : "—")}</td>
              <td className="bw-number bw-total">{compare ? money(row.actual) : cell(row, "total", money(row.twd_amount))}</td>
              <td>{compare ? <span className={row.difference > 0 ? "bw-danger" : ""}>{row.difference > 0 ? "+" : ""}{money(row.difference)}{row.unrecorded ? <small className="bw-muted"> 未記錄</small> : null}</span> : <span className={`bw-status${actual || actualExpenses.some((expense) => expense.budget_item_id === row.id) ? " paid" : ""}`}>{actual || actualExpenses.some((expense) => expense.budget_item_id === row.id) ? "實付" : "預算"}</span>}</td>
            </tr>;
          })}</Fragment>)}</tbody></table></div>
      {!displayRows.length ? <div className="bw-empty">{query || category ? "找不到符合條件的項目" : compare ? "尚無可對照項目" : `尚未建立${actual ? "實付" : "預算"}`}</div> : null}
      {inline ? <div className="bw-inline-hint">{inline.field === "title" ? "修改項目" : `以 ${activeEditor?.form.currency} 原幣金額編輯`} · Enter 儲存 · Esc 取消<button className="bw-icon" aria-label="儲存快速修改" type="button" onClick={() => void activeEditor?.save()}><Check size={15} /></button></div> : null}
    </div>
    <aside className="bw-side" ref={sideRef}><div className="bw-side-tabs" role="tablist" aria-label="右側面板"><button role="tab" type="button" aria-selected={panel === "stats"} onClick={() => setPanel("stats")}>旅程統計</button><button role="tab" type="button" aria-selected={panel === "detail"} onClick={() => setPanel("detail")}>項目明細{activeEditor?.hasUnsavedChanges ? " ·" : ""}</button></div>
      {panel === "stats" ? <Stats viewpoint={viewpoint} setViewpoint={setViewpoint} records={statsRecords} rows={actual || compare ? actualParticipants : budgetParticipants} members={members} actual={actual || compare} budgets={budgetItems} /> : activeEditor ? <RecordEditor key={`${editingActual ? "actual" : "budget"}:${activeEditor.context.id || "new"}`} editor={activeEditor} actual={editingActual} members={members} items={items} budgets={budgetItems} budgetParticipants={budgetParticipants} actualExpenses={actualExpenses} onCancel={() => void activeEditor.close()} /> : selectedRecord ? <RecordDetail record={selectedRecord} actual={selected.kind === "actual"} participants={participantsFor(selectedRecord, selected.kind === "actual" ? actualParticipants : budgetParticipants, selected.kind === "actual" ? "actual_expense_id" : "budget_item_id", members)} members={members} items={items} links={links} payments={actualExpenses.filter((expense) => expense.budget_item_id === selectedRecord.id)} canEdit={canEdit && (!props.useEditLocks || !services.isLocked(selectedRecord, props.currentUserId))} onEdit={() => void (selected.kind === "actual" ? actualEditor : budgetEditor).open(selectedRecord)} onDelete={() => void remove()} onConvert={() => void convert()} onViewPayment={(expense) => void viewPayment(expense)} renderAttachments={selected.kind === "actual" ? props.renderAttachments : null} /> : <div className="bw-empty">選取項目查看明細</div>}
    </aside>
  </section>;
}
