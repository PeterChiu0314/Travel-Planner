import { useState } from "react";
import { Pencil, Search, Trash2, Wallet, X } from "lucide-react";
import { isLockedByAnotherUser } from "../../lib/editLocks.js";

const currencyFormatter = new Intl.NumberFormat("zh-TW", {
  style: "currency",
  currency: "TWD",
  maximumFractionDigits: 0,
});
const money = (value) => currencyFormatter.format(Number(value || 0));
const memberLabel = (member) => member?.display_name || member?.email || "未指定";

export function BudgetAmount({ item }) {
  return (
    <div className="budget-amount">
      <strong>{money(item.twd_amount)}</strong>
      <span>{item.currency} {Number(item.amount || 0).toLocaleString("zh-TW")}</span>
    </div>
  );
}

export function BudgetOverview({ budgetItems, actualExpenses }) {
  const planned = budgetItems.reduce((sum, item) => sum + Number(item.twd_amount || 0), 0);
  const actual = actualExpenses.reduce((sum, item) => sum + Number(item.twd_amount || 0), 0);
  const overBudget = actual > planned;
  const categories = new Map();
  budgetItems.forEach((item) => {
    const category = item.category || "其他";
    categories.set(category, (categories.get(category) || 0) + Number(item.twd_amount || 0));
  });
  return (
    <div className="budget-summary-section">
      <div className="budget-page-summary" aria-label="旅程費用摘要">
        <div>
          <span>預算總額 · TWD</span>
          <strong>{money(planned)}</strong>
          <small>{budgetItems.length} 筆預計費用</small>
        </div>
        <div>
          <span>實付總額 · TWD</span>
          <strong>{money(actual)}</strong>
          <small>{actualExpenses.length} 筆已記錄支出</small>
        </div>
        <div className={overBudget ? "is-over-budget" : ""}>
          <span>{overBudget ? "實付超出預算" : "預算與實付差額"} · TWD</span>
          <strong>{money(Math.abs(planned - actual))}</strong>
          <small>依目前記錄計算，非待付款金額</small>
        </div>
      </div>
      {categories.size ? (
        <div className="budget-category-summary" aria-label="各分類預算">
          <span>預算分布</span>
          {[...categories].map(([category, amount]) => (
            <span key={category}><b>{category}</b> {money(amount)}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PlannedBudgetList({
  budgetItems,
  members,
  items,
  participantsByBudget,
  linksByBudget,
  canEdit,
  currentUserId,
  useEditLocks,
  onEdit,
  onDelete,
  onConvertToActual,
  onAdd,
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const memberById = new Map(members.map((member) => [member.user_id, member]));
  const itineraryById = new Map(items.map((item) => [item.id, item]));
  const categories = [...new Set(budgetItems.map((item) => item.category).filter(Boolean))];
  const activeCategory = categories.includes(category) ? category : "";
  const search = query.trim().toLocaleLowerCase();
  const visibleItems = budgetItems.filter((item) => {
    if (activeCategory && item.category !== activeCategory) return false;
    const text = [item.title, item.category, item.subcategory, item.note, memberLabel(memberById.get(item.payer_id))].join(" ").toLocaleLowerCase();
    return !search || text.includes(search);
  });
  return (
    <div className="planned-budget-list">
      {budgetItems.length ? (
        <div className="budget-list-toolbar">
          <label className="budget-search">
            <Search size={16} aria-hidden="true" />
            <input
              aria-label="搜尋預算"
              placeholder="搜尋名稱、分類或付款人"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <button type="button" aria-label="清除搜尋" onClick={() => setQuery("")}>
                <X size={16} aria-hidden="true" />
              </button>
            ) : null}
          </label>
          <select aria-label="預算分類" value={activeCategory} onChange={(event) => setCategory(event.target.value)}>
            <option value="">全部分類</option>
            {categories.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
          </select>
          <span className="budget-result-count" role="status">{visibleItems.length} / {budgetItems.length} 筆</span>
        </div>
      ) : null}
      <div className="budget-cards">
        {visibleItems.map((item) => {
          const locked = useEditLocks && isLockedByAnotherUser(item, currentUserId);
          const participants = (participantsByBudget[item.id] || []).map((id) => memberById.get(id)).filter(Boolean).map(memberLabel);
          const linkedNames = (linksByBudget[item.id] || []).map((id) => itineraryById.get(id)?.title).filter(Boolean);
          return (
            <article className="budget-card budget-page-card" key={item.id}>
              <div className="budget-card-heading">
                <div>
                  <span>{item.category}{item.subcategory ? ` · ${item.subcategory}` : ""}</span>
                  <h4>{item.title}</h4>
                </div>
                <BudgetAmount item={item} />
              </div>
              <dl className="budget-card-details">
                <div><dt>付款人</dt><dd>{memberLabel(memberById.get(item.payer_id))}</dd></div>
                <div><dt>分攤成員</dt><dd>{participants.length ? participants.join("、") : "未指定"}</dd></div>
                <div className="budget-detail-wide"><dt>連動行程</dt><dd>{linkedNames.length ? linkedNames.join("、") : "未連動"}</dd></div>
                {item.note ? <div className="budget-detail-wide"><dt>備註</dt><dd>{item.note}</dd></div> : null}
              </dl>
              <div className="budget-card-footer">
                <div className="item-meta">
                {item.split_type ? <span className="pill">{item.split_type === "equal" ? "均分" : "自訂"}</span> : null}
                {item.is_fixed ? <span className="pill">固定費用</span> : null}
                {item.auto_created_actual_expense_id ? <span className="pill">已轉實付</span> : null}
                {locked ? <span className="pill">{memberLabel(memberById.get(item.locked_by))} 編輯中</span> : null}
                </div>
                <div className="budget-actions">
                <button className="ghost-button compact" disabled={!canEdit || Boolean(item.auto_created_actual_expense_id)} type="button" onClick={() => onConvertToActual(item)}>轉實付</button>
                <button className="mini-button" aria-label={`編輯預算：${item.title}`} title="編輯預算" disabled={!canEdit || locked} type="button" onClick={() => onEdit(item)}><Pencil size={16} aria-hidden="true" /></button>
                <button className="mini-button" aria-label={`刪除預算：${item.title}`} title="刪除預算" disabled={!canEdit} type="button" onClick={() => onDelete(item.id)}><Trash2 size={16} aria-hidden="true" /></button>
                </div>
              </div>
            </article>
          );
        })}
        {!visibleItems.length ? (
          <div className="budget-list-empty">
            <Wallet size={24} aria-hidden="true" />
            <strong>{budgetItems.length ? "找不到符合條件的預算" : "先記下旅程的第一筆預算"}</strong>
            <p>{budgetItems.length ? "試試其他關鍵字，或清除篩選查看全部費用。" : "交通、住宿或餐飲，都可以先估算，再轉為實付。"}</p>
            {budgetItems.length ? (
              <button className="ghost-button compact" type="button" onClick={() => { setQuery(""); setCategory(""); }}>清除篩選</button>
            ) : (
              <button className="ghost-button compact" type="button" disabled={!canEdit} onClick={onAdd}>新增預算</button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
