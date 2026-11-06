import MenuSelect from "../MenuSelect.jsx";
import { memberLabel, money, pricingLabels } from "../../lib/budgetFinance.js";
import { pricingParticipantsDraft } from "../../lib/budgetPricingGroups.js";

// One pricing surface for whole-record editors and the atomic group controller.
export default function BudgetPricingFields({ form, pricing, members, locked, historical, tripRates, update, setForm,
  membersOpen, setMembersOpen, changeMode, showModes = true, groupMode = false, editRate = false, fixedCurrency = false, modeLocked = locked, showModeLegend = true, showSummary = true }) {
  const eligible = members.filter(m => m.status === 'approved');
  const options = [...eligible, ...form.participantIds.filter(id => !eligible.some(m => m.user_id === id)).map(user_id => ({ user_id, display_name: `已退出／無效成員 · ${user_id.slice(0, 6)}`, unavailable: true }))];
  return <>
    {showModes ? <fieldset disabled={modeLocked} className="bw-modes" aria-label="計價方式">{showModeLegend?<legend>計價方式</legend>:null}{Object.entries(pricingLabels).map(([key, label]) => <button key={key} type="button" aria-pressed={form.pricing_mode === key} onClick={() => changeMode(key)}>{label}</button>)}</fieldset> : null}
    <div className="bw-two-fields"><label>{form.pricing_mode === "per_person" ? "每人單價" : "總額"}<input name="amount" required min="0" step="0.01" type="number"
      disabled={!groupMode && locked || form.pricing_mode === "custom"} readOnly={groupMode && locked} value={form.pricing_mode === "custom" ? pricing?.amount ?? "" : form.pricing_mode === "per_person" ? form.unit_amount ?? "" : form.amount}
      onChange={event => update(form.pricing_mode === "per_person" ? "unit_amount" : "amount", event.target.value)} /></label>
      <div className="bw-field"><span>幣別</span><MenuSelect disabled={fixedCurrency || !groupMode && locked} readOnly={locked} metadataPortal={groupMode} label="幣別" value={form.currency}
        onValueChange={value => { if (!locked) setForm({ ...form, currency: value, exchange_rate: value === "TWD" ? 1 : tripRates?.rates?.[value] ?? "" }); }}
        options={[...new Set(["TWD", "JPY", "USD", "EUR", "KRW", "HKD", form.currency])].filter(Boolean).map(value => ({ value, label: value }))} /></div></div>
    {form.currency !== "TWD" ? editRate ? <label>參考匯率<input name="exchange_rate" type="number" min="0.000001" step="0.000001" readOnly={locked} value={form.exchange_rate} onChange={e => update("exchange_rate", e.target.value)} /></label> : <div className="bw-trip-rate"><span>{historical ? "歷史匯率" : "旅程估算匯率"}</span><b>1 {form.currency} = {form.exchange_rate || "—"} TWD</b></div> : null}
    <details className="bw-member-options" open={membersOpen} onToggle={event => setMembersOpen(event.currentTarget.open)}><summary>參與成員 · {form.participantIds.length} 人</summary>
      <fieldset className="bw-participants"><legend>各人負擔 · {form.pricing_mode === "custom" ? form.currency : "TWD"}</legend>{options.map(member => <label key={member.user_id}>
        <input disabled={locked || member.unavailable && !form.participantIds.includes(member.user_id)} type="checkbox" checked={form.participantIds.includes(member.user_id)} onChange={() => setForm(pricingParticipantsDraft(form, form.participantIds.includes(member.user_id) ? form.participantIds.filter(id => id !== member.user_id) : [...form.participantIds, member.user_id]))} />{memberLabel(member)}
        {form.pricing_mode === "custom" && form.participantIds.includes(member.user_id) ? <input aria-label={`${memberLabel(member)} 分攤金額`} disabled={!groupMode && locked} readOnly={groupMode && locked} required min="0" step="0.01" type="number" value={form.shares[member.user_id] ?? ""} onChange={event => update("shares", { ...form.shares, [member.user_id]: event.target.value })} /> : <b>{pricing ? money(pricing.allocations[member.user_id] || 0) : "—"}</b>}
      </label>)}</fieldset></details>
    {showSummary ? <BudgetPricingSummary form={form} pricing={pricing}/> : null}
  </>;
}

export function BudgetPricingSummary({form,pricing}) {
  return pricing ? <div className="bw-calculation"><div><span>每人</span><strong>{form.pricing_mode === "custom" ? "依成員" : form.participantIds.length ? `${pricing.twd_amount % form.participantIds.length ? "≈ " : ""}NT$ ${money(pricing.twd_amount / form.participantIds.length)}` : "—"}</strong></div><div><span>總額</span><strong>NT$ {money(pricing.twd_amount)}</strong>{form.currency !== "TWD" ? <small>{form.currency} {money(pricing.amount)}</small> : null}</div></div> : null;
}
