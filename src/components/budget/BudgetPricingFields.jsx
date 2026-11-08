import MenuSelect from "../MenuSelect.jsx";
import { memberLabel, money, originalMoney, pricingLabels } from "../../lib/budgetFinance.js";
import { pricingParticipantsDraft } from "../../lib/budgetPricingGroups.js";

// One pricing surface for whole-record editors and the atomic group controller.
export default function BudgetPricingFields({ form, pricing, members, locked, historical, tripRates, update, setForm,
  membersOpen, setMembersOpen, changeMode, showModes = true, groupMode = false, editRate = false, fixedCurrency = false, modeLocked = locked, modeBusy = false, showModeLegend = true, showSummary = true, requestParticipantForm, planningIntegers = false, finishAmountInput, headingAfterAmount, personalAmount }) {
  const eligible = members.filter(m => m.status === 'approved');
  const options = [...eligible, ...form.participantIds.filter(id => !eligible.some(m => m.user_id === id)).map(user_id => ({
    user_id, display_name: members.find(m=>m.user_id===user_id)?.display_name || "已退出／無效成員", unavailable: true,
  }))];
  async function toggleParticipant(member) {
    const current = requestParticipantForm ? await requestParticipantForm() : locked ? null : form;
    if (!current) return;
    setForm(pricingParticipantsDraft(current, current.participantIds.includes(member.user_id) ? current.participantIds.filter(id => id !== member.user_id) : [...current.participantIds, member.user_id]));
  }
  const amountInput = { min: 0, step: planningIntegers ? 1 : 0.01, type: "number", onBlur: finishAmountInput };
  function updateAmount(key, value, raw = value) {
    update(key, value, { deferRounding: planningIntegers && raw.includes(".") });
  }
  const modes = showModes ? <fieldset disabled={modeLocked} className="bw-modes" aria-label="計價方式">{showModeLegend?<legend>計價方式</legend>:null}{Object.entries(pricingLabels).map(([key, label]) => <button key={key} type="button" aria-pressed={form.pricing_mode === key} aria-disabled={modeBusy || undefined} onClick={() => { if (!modeBusy) changeMode(key); }}>{label}</button>)}</fieldset> : null;
  return <>
    {!headingAfterAmount && modes}
    <div className="bw-two-fields"><label>{form.pricing_mode === "per_person" ? "每人單價" : "總額"}<input name="amount" required {...amountInput}
      disabled={!groupMode && locked || form.pricing_mode === "custom"} readOnly={groupMode && locked} value={form.pricing_mode === "custom" ? pricing?.amount ?? "" : form.pricing_mode === "per_person" ? form.unit_amount ?? "" : form.amount}
      onChange={event => updateAmount(form.pricing_mode === "per_person" ? "unit_amount" : "amount", event.target.value)} /></label>
      <div className="bw-field"><span>幣別</span><MenuSelect disabled={fixedCurrency || !groupMode && locked} readOnly={locked} metadataPortal={groupMode} label="幣別" value={form.currency}
        onValueChange={value => { if (!locked) setForm({ ...form, currency: value, exchange_rate: value === "TWD" ? 1 : tripRates?.rates?.[value] ?? "" }); }}
        options={[...new Set(["TWD", "JPY", "USD", "EUR", "KRW", "HKD", form.currency])].filter(Boolean).map(value => ({ value, label: value }))} /></div></div>
    {headingAfterAmount && <><span className="bw-pricing-heading">{headingAfterAmount}</span>{modes}</>}
    {form.currency !== "TWD" ? editRate ? <label>參考匯率<input name="exchange_rate" type="number" min="0.000001" step="0.000001" readOnly={locked} value={form.exchange_rate} onChange={e => update("exchange_rate", e.target.value)} /></label> : <div className="bw-trip-rate"><span>{historical ? "歷史匯率" : "旅程估算匯率"}</span><b>1 {form.currency} = {form.exchange_rate || "—"} TWD</b></div> : null}
    <details className="bw-member-options" open={membersOpen} onToggle={event => setMembersOpen(event.currentTarget.open)}><summary>參與成員 · {form.participantIds.length} 人</summary>
      <fieldset className="bw-participants"><legend>各人負擔 · {planningIntegers || form.pricing_mode === "custom" ? form.currency : "TWD"}</legend>{options.map(member => <label key={member.user_id}>
        <input disabled={(!requestParticipantForm && locked) || member.unavailable && !form.participantIds.includes(member.user_id)} type="checkbox" checked={form.participantIds.includes(member.user_id)} onChange={() => void toggleParticipant(member)} />{memberLabel(member)}
        {form.pricing_mode === "custom" && form.participantIds.includes(member.user_id) ? <input aria-label={`${memberLabel(member)} 分攤金額`} disabled={!groupMode && locked} readOnly={groupMode && locked} required {...amountInput} value={form.shares[member.user_id] ?? ""} onChange={event => updateAmount("shares", { ...form.shares, [member.user_id]: event.target.value }, event.target.value)} /> : <b>{form.participantIds.includes(member.user_id) ? pricing ? planningIntegers ? originalMoney(pricing.shares[member.user_id]) : money(pricing.allocations[member.user_id] || 0) : "—" : ""}</b>}
      </label>)}</fieldset></details>
    {showSummary ? <BudgetPricingSummary form={form} pricing={pricing} personalAmount={personalAmount}/> : null}
  </>;
}

export function BudgetPricingSummary({form,pricing,showOriginalPrecision=false,keepVisible=false,storedAmount,personalAmount}) {
  if (!pricing && !keepVisible) return null;
  const count = form.participantIds.length;
  let perPersonLabel = "每人";
  let perPerson = "—";
  if (personalAmount !== undefined) {
    perPersonLabel = "個人";
    perPerson = personalAmount === null ? "—" : `NT$ ${money(personalAmount)}`;
  } else if (pricing && form.pricing_mode === "custom") {
    perPerson = "依成員";
  } else if (pricing && form.pricing_mode === "per_person") {
    const currency = form.currency === "TWD" ? "NT$" : form.currency;
    perPerson = `${currency} ${originalMoney(pricing.unit_amount)}`;
  } else if (pricing && count) {
    const hasRemainder = pricing.twd_amount % count !== 0
      || (pricing.original_scale === 0 && pricing.amount % count !== 0);
    if (hasRemainder) perPersonLabel = "每人約";
    perPerson = `NT$ ${money(pricing.twd_amount / count)}`;
  }
  const showOriginal = form.currency !== "TWD" || showOriginalPrecision && Number.isFinite(storedAmount) && !Number.isInteger(storedAmount);
  const original = pricing ? (showOriginalPrecision ? originalMoney(pricing.amount) : money(pricing.amount)) : "—";
  return <div className="bw-calculation"><div><span>{perPersonLabel}</span><strong>{perPerson}</strong></div><div><span>總額</span><strong>{pricing ? `NT$ ${money(pricing.twd_amount)}` : "—"}</strong>{showOriginal ? <small>{form.currency} {original}</small> : null}</div></div>;
}
