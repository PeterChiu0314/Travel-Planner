import { useState } from "react";
import { BedDouble, Car, ChevronDown, ChevronRight, Circle, CircleCheck, Package, Plane, ShoppingBag, Ticket, UtensilsCrossed, X } from "lucide-react";
import MenuSelect from "../MenuSelect.jsx";
import { isBudgetComplete } from "../../lib/budgetLifecycleValues.js";
import { memberLabel, money, originalMoney, participantsFor, recordAllocations } from "../../lib/budgetFinance.js";
import { budgetCurrencies } from "../../lib/tripBudgetRates.js";

const categoryOrder = ["機票", "交通", "住宿", "門票", "餐飲", "購物", "其他"];
const categoryIcons = { "機票": Plane, "交通": Car, "住宿": BedDouble, "門票": Ticket, "餐飲": UtensilsCrossed, "購物": ShoppingBag, "其他": Package };
const palette = ["#52766a", "#a2b2a6", "#b6a28a", "#d3c6b2", "#829da0", "#aeb0a2", "#dcd8cd"];
// Category identity is stable even when cost ranking or member view changes.
const categoryColors = { "機票": palette[0], "住宿": palette[1], "餐飲": palette[2], "交通": palette[3], "其他": palette[4], "購物": palette[5], "門票": palette[6] };
function categoryColor(category) {
  return categoryColors[category] || palette[[...category].reduce((hash, character) => (hash * 31 + character.codePointAt(0)) >>> 0, 0) % palette.length];
}
export {categoryOrder, categoryIcons, categoryColor};
export function Stats({ records, rows, members, actual, budgets, viewpoint, setViewpoint, ratesControl, ratesSummary }) {
  records=records.filter(isBudgetComplete);budgets=budgets.filter(isBudgetComplete);
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
      <div className="bw-distribution" role="img" aria-label="分類金額占比">{categoriesList.map(([category, value]) => <span key={category} style={{ flex: Math.max(value, 0), backgroundColor: categoryColor(category) }} title={`${category} ${money(value)}`} />)}</div>
      {categoriesList.map(([category, value]) => <div className="bw-stat-line" key={category}><span className="bw-category-label"><i style={{ backgroundColor: categoryColor(category) }} />{category}</span><span><b>{unknown && validView !== "all" && validView !== "average" ? "—" : money(value)}</b><small>{main ? Math.round(value / main * 100) : 0}%</small></span></div>)}
    </section>
    {actual ? null : <><div className="bw-stat-line bw-paid-summary"><span>已付款項目</span><span>{records.filter((row) => row.hasActual).length} / {records.length}</span></div>{ratesSummary ?? <TripRatesSummary {...ratesControl} />}</>}
  </section>;
}

export function PricingSummary({ amount, twdAmount, currency, mode, count, showOriginalPrecision, uneven }) {
  const perPerson = mode === "custom" || uneven ? "依成員" : count ? `${twdAmount % count ? "≈ " : ""}NT$ ${money(twdAmount / count)}` : "—";
  return <div className="bw-calculation"><div><span>每人</span><strong>{perPerson}</strong></div><div><span>總額</span><strong>NT$ {money(twdAmount)}</strong>{currency !== "TWD" || showOriginalPrecision && !Number.isInteger(amount) ? <small>{currency} {showOriginalPrecision ? originalMoney(amount) : money(amount)}</small> : null}</div></div>;
}

export function TripRatesSummary({ tripRates, ratesBusy, ratesError, canRefreshRates, onRefreshRates }) {
  return <section className="bw-trip-rate"><div><h4>旅程估算匯率</h4><button type="button" className="ghost-button compact" disabled={!canRefreshRates || ratesBusy} onClick={onRefreshRates}>{ratesBusy ? "更新中…" : "更新匯率"}</button></div>
    {Object.entries(tripRates?.rates || {}).filter(([currency]) => budgetCurrencies.includes(currency)).map(([currency, rate]) => <div key={currency}><span>1 {currency}</span><b>{rate} TWD</b></div>)}
    <small>{tripRates?.quoted_at ? `${tripRates.source} · ${new Date(tripRates.quoted_at).toLocaleDateString("zh-TW")}` : tripRates ? "首次自動取得，之後手動更新" : "旅程統一匯率尚待啟用"}</small>
    <small>更新整個旅程的未付款預算；已付款金額不變。</small>
    {tripRates?.source === "ExchangeRate-API" ? <a href="https://www.exchangerate-api.com" target="_blank" rel="noreferrer">Rates By Exchange Rate API</a> : null}
    {ratesError ? <small role="alert">{ratesError}</small> : null}
  </section>;
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

export function ItineraryPicker({ items, selectedIds, category, onChange, readOnly = false }) {
  const [query, setQuery] = useState("");
  const [day, setDay] = useState("");
  const [open, setOpen] = useState(false);
  const days = [...new Set(items.map((item) => Number(item.day_index)))].sort((a, b) => a - b);
  const matches = items.filter((item) => (day === "" || Number(item.day_index) === Number(day)) && item.title.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => Number(a.day_index) - Number(b.day_index) || Number(a.sort_order || 0) - Number(b.sort_order || 0));
  const suggested = matches.filter((item) => itinerarySuggestionScore(item, category) > 0)
    .sort((a, b) => itinerarySuggestionScore(b, category) - itinerarySuggestionScore(a, category)).slice(0, 5);
  function toggle(id) { if (!readOnly) onChange(selectedIds.includes(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id]); }
  function option(item) { return <label key={item.id}><input type="checkbox" disabled={readOnly} checked={selectedIds.includes(item.id)} onChange={() => toggle(item.id)} /><span>{item.title}</span></label>; }
  return <section className="bw-link-picker" aria-label="關聯行程">
    <button className="bw-link-heading" type="button" aria-expanded={open} aria-controls="budget-link-options" onClick={() => setOpen(!open)}><span>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}關聯行程</span><small>{selectedIds.length} 項</small></button>
    {selectedIds.length ? <ul className="bw-linked-items">{selectedIds.map((id) => {
      const item = items.find((row) => row.id === id);
      return <li key={id}><span>{item ? `Day ${Number(item.day_index) + 1} · ${item.title}` : "已移除的行程"}</span><button type="button" className="bw-icon" disabled={readOnly} aria-label={`取消關聯 ${item?.title || "已移除的行程"}`} onClick={() => toggle(id)}><X size={13} /></button></li>;
    })}</ul> : null}
    <div className="bw-link-options" id="budget-link-options" hidden={!open}>
      <div className="bw-link-filters"><input aria-label="搜尋關聯行程" placeholder="搜尋行程" value={query} onChange={(event) => setQuery(event.target.value)} /><MenuSelect label="關聯行程日期" value={day} onValueChange={setDay} options={[{value:"",label:"全部 Day"},...days.map(value=>({value:String(value),label:`Day ${value+1}`}))]} /></div>
      <div className="bw-link-results">{suggested.length ? <fieldset aria-label="建議行程" className="bw-link-suggestions"><legend>建議</legend>{suggested.map(option)}</fieldset> : null}{days.filter((value) => matches.some((item) => Number(item.day_index) === value)).map((value) => <fieldset key={value} aria-label={`Day ${value + 1} 行程`}><legend>Day {value + 1}</legend>{matches.filter((item) => Number(item.day_index) === value).map(option)}</fieldset>)}{!matches.length ? <p className="bw-muted">沒有符合的行程</p> : null}</div>
    </div>
  </section>;
}

export function PaymentToggle({ checked, disabled, onChange, busy = false }) {
  const Icon = checked ? CircleCheck : Circle;
  return <button type="button" className={`bw-payment-toggle${checked ? " is-paid" : ""}`} aria-label="付款狀態" aria-pressed={checked} aria-busy={busy} disabled={disabled} onClick={() => onChange(!checked)}><Icon size={14} aria-hidden="true" /><span>{busy ? "處理中…" : checked ? "已付款" : "未付款"}</span></button>;
}
