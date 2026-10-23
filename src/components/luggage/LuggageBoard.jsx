import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Check, LockKeyhole, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import MenuSelect from "../MenuSelect.jsx";
import { isLockedByAnotherUser } from "../../lib/editLocks.js";
import "./luggage-board.css";

const emptyItems = [];
const categoryDefaults = ["證件", "衣物", "電子用品", "盥洗用品", "健康用品", "日常用品", "其他"];
const packingFilters = [{ value: "all", label: "全部" }, { value: "unpacked", label: "未打包" }, { value: "packed", label: "已打包" }];
function memberLabel(member) { return member?.display_name || member?.nickname || member?.profile?.display_name || member?.profiles?.display_name || member?.email?.split("@")[0] || "旅程成員"; }
function PackingFilters({ label, value, onChange, shared = false, children }) {
  const options = shared ? [...packingFilters, { value: "unassigned", label: "未指派" }] : packingFilters;
  return <div className="lb-status-tabs" role="group" aria-label={label}>{options.map(option => <button type="button" key={option.value} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}{children}</div>;
}
function InlineSearch({ open, setOpen, query, setQuery, activeTab, mobileOnly = false }) {
  const id = useId(), root = useRef(null), input = useRef(null), trigger = useRef(null);
  useLayoutEffect(() => {
    if (open && root.current?.getClientRects().length) input.current?.focus({ preventScroll: true });
  }, [open, activeTab]);
  function close() { setQuery(""); setOpen(false); trigger.current?.focus({ preventScroll: true }); }
  return <div ref={root} className={`lb-inline-search${open ? " is-open" : ""}${mobileOnly ? " lb-search-mobile" : ""}`}>
    <button ref={trigger} className="lb-search-toggle" type="button" aria-label={open ? "收合行李搜尋" : "展開行李搜尋"} aria-expanded={open} aria-controls={open ? id : undefined} title={open ? "收合搜尋" : "搜尋物品、分類、負責人"} onClick={() => open ? close() : setOpen(true)}>{open ? <X size={15} /> : <Search size={16} />}</button>
    {open ? <label className="lb-search"><input ref={input} id={id} type="search" aria-label="搜尋行李" placeholder="搜尋物品、分類、負責人" value={query} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } }} onChange={event => setQuery(event.target.value)} />{query ? <button type="button" aria-label="清除行李搜尋" onClick={() => { setQuery(""); input.current?.focus(); }}><X size={13} /></button> : null}</label> : null}
  </div>;
}
function LuggageSelect({ caption, ...props }) {
  const select = <MenuSelect {...props} popupClassName="lb-menu-popup" />;
  return caption ? <label className="lb-meta-field"><span>{caption}</span>{select}</label> : select;
}
function Progress({ label, value, total }) {
  return <span className="lb-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={Math.max(total, 1)} aria-valuenow={value} aria-valuetext={`${value} / ${total}`}><span><b>{value}</b>/{total}</span><span className="lb-meter" aria-hidden="true"><span style={{ width: `${total ? value / total * 100 : 0}%` }} /></span></span>;
}
function PackCheck({ title, checked, disabled, onChange, label, description }) {
  return <label className="lb-check" title={description}>
    <input type="checkbox" aria-label={`${label || "打包"}：${title}`} checked={Boolean(checked)} disabled={disabled} onChange={onChange} />
    <span className="lb-check-box" aria-hidden="true"><Check size={12} /></span>
  </label>;
}
function ItemName({ item, disabled, onEdit }) {
  return <button type="button" className="lb-item-name" aria-label={`編輯：${item.title}`} title={`編輯 ${item.title}`} disabled={disabled} onClick={() => onEdit(item)}><span>{item.title}</span><Pencil size={12} aria-hidden="true" /></button>;
}
function Empty({ filtered, shared = false }) { return <p className="lb-empty">{filtered ? "沒有符合的物品" : shared ? "還沒有公物，從上方新增。" : "還沒有行李，從上方新增。"}</p>; }

function QuickAdd({ shared = false, form, setForm, categories, assignees, disabled, onSubmit }) {
  const input = useRef(null), focusAfterSubmit = useRef(false);
  const kind = shared ? "團隊公物" : "個人行李";
  useLayoutEffect(() => {
    if (!disabled && focusAfterSubmit.current) {
      focusAfterSubmit.current = false;
      input.current?.focus({ preventScroll: true });
    }
  }, [disabled]);
  async function submit(event) {
    // Composition Enter must not add an unfinished Chinese/Japanese word.
    if (event.nativeEvent.isComposing) { event.preventDefault(); return; }
    focusAfterSubmit.current = true;
    const saved = await onSubmit(event);
    if (!saved) focusAfterSubmit.current = false;
    input.current?.focus({ preventScroll: true });
  }
  return <form autoComplete="off" className={`lb-add-form${shared ? " lb-add-shared" : ""}`} aria-label={`快速新增${kind}`} onSubmit={submit}>
    <input ref={input} aria-label={`${kind}名稱`} placeholder={`新增${kind}`} value={form.title} maxLength={160} disabled={disabled} onKeyDown={event => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} onChange={event => setForm({ ...form, title: event.target.value })} />
    <LuggageSelect caption="分類" label={`${kind}分類`} editable placeholder="未分類" value={form.category} options={[{ value: "", label: "未分類" }, ...categories]} disabled={disabled} onValueChange={category => setForm({ ...form, category })} />
    {shared ? <LuggageSelect caption="負責人" label="指派公物負責人" value={form.assigned_to} options={assignees} disabled={disabled} onValueChange={assigned_to => setForm({ ...form, assigned_to })} /> : null}
    <button className="lb-submit" type="submit" aria-label={`新增${kind}`} disabled={disabled || !form.title.trim()}><Plus size={16} /></button>
  </form>;
}

function InlineEditor({ shared = false, item, form, setForm, categories, assignees, disabled, onSubmit, onCancel, onDelete }) {
  const input = useRef(null), editor = useRef(null), acting = useRef(false);
  const kind = shared ? "團隊公物" : "個人行李";
  async function save(event) {
    event.preventDefault();
    if (disabled || acting.current || event.nativeEvent?.isComposing || !form.title.trim()) return;
    acting.current = true;
    try { await onSubmit(event); } finally { acting.current = false; }
  }
  async function cancel() {
    if (disabled || acting.current) return;
    acting.current = true;
    try { await onCancel(); } finally { acting.current = false; }
  }
  function leave(event) {
    if (disabled || acting.current || !document.hasFocus() || event.currentTarget.contains(event.relatedTarget)) return;
    // Keep independent Quick Add drafts and let existing handoff/navigation
    // guards handle other controls. Menus are portals, not outside edits.
    if (event.relatedTarget?.closest("button,input,select,textarea,a,[role=dialog],[role=listbox]")) return;
    const changed = form.title !== item.title || (form.category || "") !== (item.category || "") || shared && (form.assigned_to || "") !== (item.assigned_to || "");
    if (!form.title.trim()) { input.current?.reportValidity(); return; }
    if (changed) void save(event); else void cancel();
  }
  useLayoutEffect(() => {
    // Reveal only the part below the viewport; never send the user back to Quick Add.
    const list = editor.current?.closest(".lb-list-body");
    const bottom = editor.current?.getBoundingClientRect().bottom || 0;
    if (list && /auto|scroll/.test(getComputedStyle(list).overflowY)) {
      const hidden = bottom - Math.min(list.getBoundingClientRect().bottom, window.innerHeight);
      if (hidden > 0) list.scrollTop += hidden;
    } else if (bottom > window.innerHeight) window.scrollBy(0, bottom - window.innerHeight);
    input.current?.focus({ preventScroll: true });
  }, []);
  return <form ref={editor} autoComplete="off" className={`lb-inline-editor${shared ? " lb-inline-shared" : ""}`} aria-label={`編輯${kind}：${item.title}`} onSubmit={save} onBlur={leave} onKeyDownCapture={event => {
    if (event.key === "Escape" && !event.nativeEvent.isComposing && !editor.current?.querySelector('[aria-expanded="true"]')) { event.preventDefault(); event.stopPropagation(); void cancel(); }
  }} onKeyDown={event => {
    if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
  }}>
    <input className="lb-inline-name" ref={input} required aria-label={`編輯${kind}名稱`} title="Enter 儲存，Esc 取消" value={form.title} maxLength={160} disabled={disabled} onChange={event => setForm({ ...form, title: event.target.value })} />
    <LuggageSelect label={`編輯${kind}分類`} editable placeholder="未分類" value={form.category} options={[{ value: "", label: "未分類" }, ...categories]} disabled={disabled} onValueChange={category => setForm({ ...form, category })} />
    {shared ? <LuggageSelect label="編輯公物負責人" value={form.assigned_to} options={assignees} disabled={disabled} onValueChange={assigned_to => setForm({ ...form, assigned_to })} /> : null}
    <button className="lb-delete" type="button" disabled={disabled} aria-label={`刪除：${item.title}`} title="刪除物品" onClick={async () => {
      if (acting.current) return;
      acting.current = true;
      try { await onDelete(item.id, item); } finally { acting.current = false; }
    }}><Trash2 size={15} /></button>
    <button className="lb-keyboard-submit" type="submit" tabIndex={-1} aria-hidden="true" />
  </form>;
}

export default function LuggageBoard({
  activeTrip, currentUserId, canEdit, luggageItems = emptyItems, sharedLuggageItems = emptyItems, members = emptyItems,
  personalQuickForm, setPersonalQuickForm, sharedQuickForm, setSharedQuickForm, submitPersonalQuick, submitSharedQuick,
  activeTab = "personal", onTabChange, personalForm, setPersonalForm, sharedForm, setSharedForm,
  editingPersonalId, editingSharedId, submitPersonal, submitShared, editPersonal, editShared, cancelPersonalEdit, cancelSharedEdit,
  onTogglePersonal, onUpdateShared, onDeletePersonal, onDeleteShared, busy = false, error = "",
}) {
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [personalFilter, setPersonalFilter] = useState("all"), [sharedFilter, setSharedFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const rows = useRef(new Map()), previousEditor = useRef(null);
  const approved = members.filter(member => member.status === "approved");
  const byMember = new Map(approved.map(member => [member.user_id, member]));
  const assigned = sharedLuggageItems.filter(item => item.assigned_to === currentUserId);
  const myPacked = luggageItems.filter(item => item.packed).length + assigned.filter(item => item.packed_by_assignee).length;
  const categories = [...new Set([...categoryDefaults, ...luggageItems.map(item => item.category), ...sharedLuggageItems.map(item => item.category)].filter(Boolean))].map(value => ({ value, label: value }));
  const assignees = [{ value: "", label: "未指派" }, ...approved.map(member => ({ value: member.user_id, label: `${memberLabel(member)}${member.user_id === currentUserId ? "（我）" : ""}` }))];
  const search = query.trim().toLocaleLowerCase();
  const matches = item => !search || [item.title, item.category, item.assigned_to ? memberLabel(byMember.get(item.assigned_to)) : ""].join(" ").toLocaleLowerCase().includes(search);
  const myMatches = (item, shared) => matches(item) && (categoryFilter === "all" || (item.category?.trim() || "未分類") === categoryFilter) && (personalFilter === "all" || (personalFilter === "packed") === Boolean(shared ? item.packed_by_assignee : item.packed));
  const shownPersonal = luggageItems.filter(item => item.id === editingPersonalId || myMatches(item, false)), shownAssigned = assigned.filter(item => myMatches(item, true));
  const shownShared = sharedLuggageItems.filter(item => item.id === editingSharedId || matches(item) && (sharedFilter === "all" || sharedFilter === "unassigned" && !item.assigned_to || sharedFilter === "unpacked" && !item.packed_by_assignee || sharedFilter === "packed" && item.packed_by_assignee));
  const personalCategories = [...new Set([...luggageItems, ...assigned].map(item => item.category?.trim() || "未分類"))];
  const memberGroups = new Map();
  for (const item of shownShared) {
    const key = item.assigned_to || "";
    if (!memberGroups.has(key)) memberGroups.set(key, []);
    memberGroups.get(key).push(item);
  }
  const memberOrder = [currentUserId, ...approved.map(member => member.user_id).filter(id => id !== currentUserId)];
  const rankMember = id => !id ? Number.MAX_SAFE_INTEGER : memberOrder.includes(id) ? memberOrder.indexOf(id) : memberOrder.length;
  const orderedGroups = [...memberGroups].sort(([a], [b]) => rankMember(a) - rankMember(b));
  function navigateTabs(event) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); const next = event.key === "Home" ? "personal" : event.key === "End" ? "shared" : activeTab === "personal" ? "shared" : "personal";
    onTabChange?.(next); event.currentTarget.querySelector(`#lb-${next}-tab`)?.focus();
  }
  useEffect(() => { setQuery(""); setSearchOpen(false); setPersonalFilter("all"); setSharedFilter("all"); setCategoryFilter("all"); }, [activeTrip?.id]);
  useLayoutEffect(() => {
    const editing = editingPersonalId || editingSharedId;
    if (previousEditor.current && !editing && document.activeElement === document.body) rows.current.get(previousEditor.current)?.querySelector(".lb-item-name")?.focus({ preventScroll: true });
    previousEditor.current = editing;
  }, [editingPersonalId, editingSharedId]);

  return <section className="panel luggage-panel travel-workspace lb-board" aria-label="行李清單">
    {error ? <p className="lb-error" role="alert">{typeof error === "string" ? error : "操作未完成，請重試。"}</p> : null}
    <div className="mobile-tabs lb-mobile-tabs" role="tablist" aria-label="行李清單類型" onKeyDown={navigateTabs}>
      {[['personal','個人行李'],['shared','團隊公物']].map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={activeTab === key} aria-controls={`lb-${key}`} tabIndex={activeTab === key ? 0 : -1} id={`lb-${key}-tab`} onClick={() => onTabChange?.(key)}>{label}</button>)}
    </div>
    <div className="luggage-layout lb-layout">
      <section id="lb-personal" className={`luggage-column lb-personal${activeTab === "personal" ? " active" : ""}`} aria-label="個人行李">
        <header className="lb-column-heading"><h3>個人行李 <LockKeyhole size={12} aria-label="僅自己可見" /></h3><Progress label="我的打包進度" value={myPacked} total={luggageItems.length + assigned.length} /></header>
        <PackingFilters label="個人行李篩選" value={personalFilter} onChange={setPersonalFilter}><InlineSearch {...{ open: searchOpen, setOpen: setSearchOpen, query, setQuery, activeTab }} /></PackingFilters>
        <QuickAdd form={personalQuickForm} setForm={setPersonalQuickForm} categories={categories} disabled={!canEdit || busy} onSubmit={submitPersonalQuick} />
        {personalCategories.length ? <div className="lb-category-filters" role="group" aria-label="個人行李分類篩選"><button type="button" aria-pressed={categoryFilter === "all"} onClick={() => setCategoryFilter("all")}>全部分類</button>{personalCategories.map(category => <button type="button" key={category} aria-pressed={categoryFilter === category} onClick={() => setCategoryFilter(category)}>{category}</button>)}</div> : null}
        <div className="lb-list-body" tabIndex={0} aria-label="個人行李清單">
          {shownAssigned.length ? <section className="assigned-shared-list lb-assigned" aria-label="我負責的公物">{shownAssigned.map(item => <article className={`luggage-row shared-assigned${item.packed_by_assignee ? " packed" : ""}`} key={item.id}>
            <PackCheck title={item.title} label="打包指派公物" checked={item.packed_by_assignee} disabled={!canEdit || busy || isLockedByAnotherUser(item, currentUserId)} onChange={() => onUpdateShared(item.id, { packed_by_assignee: !item.packed_by_assignee }, item)} description="公物打包狀態與團隊同步" />
            <span className="lb-public-tag">公物</span><strong>{item.title}</strong><span className="lb-item-category">{item.category || "未分類"}</span>
          </article>)}</section> : null}
          {shownPersonal.length ? <div className="luggage-list lb-private-list">{shownPersonal.map(item => {
            const locked = isLockedByAnotherUser(item, currentUserId);
            return <article ref={node => { if (node) rows.current.set(item.id, node); else rows.current.delete(item.id); }} className={`luggage-row lb-private-row${item.packed ? " packed" : ""}${editingPersonalId === item.id ? " is-editing" : ""}`} key={item.id}>{editingPersonalId === item.id
              ? <><PackCheck title={item.title} checked={item.packed} disabled /><InlineEditor item={item} form={personalForm} setForm={setPersonalForm} categories={categories} disabled={!canEdit || busy} onSubmit={submitPersonal} onCancel={cancelPersonalEdit} onDelete={onDeletePersonal} /></>
              : <><PackCheck title={item.title} checked={item.packed} disabled={!canEdit || busy || locked} onChange={() => onTogglePersonal(item)} /><ItemName item={item} disabled={!canEdit || busy || locked} onEdit={editPersonal} /><span className="lb-item-category">{item.category || "未分類"}</span>{locked ? <LockKeyhole size={12} aria-label="其他成員編輯中" /> : null}</>}</article>;
          })}</div> : !shownAssigned.length ? <Empty filtered={Boolean(search || personalFilter !== "all" || categoryFilter !== "all")} /> : null}
        </div>
      </section>
      <section id="lb-shared" className={`luggage-column lb-shared${activeTab === "shared" ? " active" : ""}`} aria-label="團隊公物">
        <header className="lb-column-heading"><h3>團隊公物</h3><Progress label="成員已打包" value={sharedLuggageItems.filter(item => item.packed_by_assignee).length} total={sharedLuggageItems.length} /></header>
        <PackingFilters label="團隊公物篩選" value={sharedFilter} onChange={setSharedFilter} shared><InlineSearch {...{ open: searchOpen, setOpen: setSearchOpen, query, setQuery, activeTab }} mobileOnly /></PackingFilters>
        <QuickAdd shared form={sharedQuickForm} setForm={setSharedQuickForm} categories={categories} assignees={assignees} disabled={!canEdit || busy} onSubmit={submitSharedQuick} />
        <div className="lb-team-head" aria-hidden="true"><span>依負責人分組</span><span>打包</span></div>
        <div className="lb-list-body" tabIndex={0} aria-label="團隊公物清單">
          {shownShared.length ? <div className="luggage-list">{orderedGroups.map(([memberId, items]) => {
            const member = byMember.get(memberId);
            const name = member ? `${memberLabel(member)}${memberId === currentUserId ? "（我）" : ""}` : memberId ? "需重新指派" : "未指派";
            return <section className={`lb-member-group${!member ? " is-unassigned" : ""}`} key={memberId} aria-label={`${name}的公物`}><h4><span className="lb-member-avatar" aria-hidden="true">{member ? memberLabel(member).slice(0, 1).toUpperCase() : "—"}</span><span>{name}</span><small>{items.filter(item => item.packed_by_assignee).length}/{items.length}</small></h4>{items.map(item => {
            const locked = isLockedByAnotherUser(item, currentUserId);
            const canPack = canEdit && !busy && !locked && item.assigned_to === currentUserId;
            return <article ref={node => { if (node) rows.current.set(item.id, node); else rows.current.delete(item.id); }} className={`shared-luggage-row${item.packed_by_assignee ? " packed" : ""}${editingSharedId === item.id ? " is-editing" : ""}`} key={item.id}>
              {editingSharedId === item.id ? <InlineEditor shared item={item} form={sharedForm} setForm={setSharedForm} categories={categories} assignees={assignees} disabled={!canEdit || busy} onSubmit={submitShared} onCancel={cancelSharedEdit} onDelete={onDeleteShared} /> : <>
              <ItemName item={item} disabled={!canEdit || busy || locked} onEdit={editShared} />
              <span className="lb-stage"><span className="lb-mobile-label">打包</span><PackCheck title={item.title} label="成員已打包" checked={item.packed_by_assignee} disabled={!canPack} description={canPack ? "負責人確認打包" : "由負責成員確認打包"} onChange={() => onUpdateShared(item.id, { packed_by_assignee: !item.packed_by_assignee }, item)} /></span>
              </>}
            </article>;
          })}</section>; })}</div> : <Empty shared filtered={Boolean(search || sharedFilter !== "all")} />}
        </div>
      </section>
    </div>
  </section>;
}
