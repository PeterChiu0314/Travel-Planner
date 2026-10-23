import { DndContext, DragOverlay, PointerSensor, pointerWithin, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { DraggableRow, QuickNote } from "./LuggageInteractions.jsx";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, CreditCard, LockKeyhole, Package, Pencil, Plus, Search, Shirt, Smartphone, SoapDispenserDroplet, BriefcaseMedical, Luggage, Trash2, X } from "lucide-react";
import MenuSelect from "../MenuSelect.jsx";
import { isLockedByAnotherUser } from "../../lib/editLocks.js";
import "./luggage-board.css";

const emptyItems = [];
const categoryDefaults = ["證件", "電子用品", "衣物", "盥洗用品", "健康用品", "日常用品", "其他"];
const packingFilters = [{ value: "all", label: "全部" }, { value: "unpacked", label: "未打包" }, { value: "packed", label: "已打包" }];
function memberLabel(member) { return member?.display_name || member?.nickname || member?.profile?.display_name || member?.profiles?.display_name || member?.email?.split("@")[0] || "旅程成員"; }

const categoryIcons = { 證件: CreditCard, 衣物: Shirt, 電子用品: Smartphone, 盥洗用品: SoapDispenserDroplet, 健康用品: BriefcaseMedical, 日常用品: Package };
function PersonalGroup({ label, count, packed, collapsed, toggle, shared = false, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: `category:${label}`, data: { category: label === "未分類" ? "" : label }, disabled: shared });
  const id = useId(), Icon = shared ? Luggage : categoryIcons[label] || Package;
  return <section ref={setNodeRef} className={`lb-category-group${shared ? " lb-public-group" : ""}${isOver ? " is-drop-target" : ""}`} aria-label={label}>
    <h4><button type="button" className="lb-group-toggle" aria-expanded={!collapsed} aria-controls={id} onClick={toggle}>
      {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}<Icon size={16} /><span>{label}</span><small>{count}項</small><span className="lb-group-count">{packed}/{count}</span>
    </button></h4>
    <div id={id} hidden={collapsed}>{children}</div>
  </section>;
}

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
    {!shared ? <LuggageSelect caption="分類" label={`${kind}分類`} editable placeholder="未分類" value={form.category} options={[{ value: "", label: "未分類" }, ...categories]} disabled={disabled} onValueChange={category => setForm({ ...form, category })} /> : null}
    {shared ? <LuggageSelect caption="負責人" label="指派公物負責人" value={form.assigned_to} options={assignees} disabled={disabled} onValueChange={assigned_to => setForm({ ...form, assigned_to })} /> : null}
    <QuickNote kind={kind} value={form.notes} onChange={notes => setForm({ ...form, notes })} disabled={disabled} />
    <button className="lb-submit" type="submit" aria-label={`新增${kind}`} disabled={disabled || !form.title.trim()}><Plus size={16} /></button>
  </form>;
}

function InlineEditor({ shared = false, item, form, setForm, categories, assignees, disabled, onSubmit, onCancel, onDelete, focusNotes = false }) {
  const input = useRef(null), noteInput = useRef(null), editor = useRef(null), acting = useRef(false);
  const latest = useRef(null), replaying = useRef(false);
  const kind = shared ? "團隊公物" : "個人行李";
  async function save(event) {
    event?.preventDefault();
    if (disabled || acting.current || event?.nativeEvent?.isComposing) return false;
    input.current?.setCustomValidity(form.title.trim() ? "" : "請輸入物品名稱");
    if (!form.title.trim()) { input.current?.reportValidity(); return false; }
    acting.current = true;
    try { return await onSubmit(event || { preventDefault() {} }); } finally { acting.current = false; }
  }
  async function cancel() {
    if (disabled || acting.current) return;
    acting.current = true;
    try { await onCancel(); return true; } finally { acting.current = false; }
  }
  function related(target) {
    if (!target || !editor.current) return false;
    if (editor.current.contains(target)) return true;
    return [...editor.current.querySelectorAll("[aria-controls]")].some(control => document.getElementById(control.getAttribute("aria-controls"))?.contains(target));
  }
  async function finish() {
    const changed = form.title !== item.title || (form.notes || "") !== (item.notes || "") || (form.category || "") !== (item.category || "") || shared && (form.assigned_to || "") !== (item.assigned_to || "");
    return changed ? save() : cancel();
  }
  async function leave(event) {
    if (disabled || acting.current || !document.hasFocus() || related(event.relatedTarget)) return;
    const target = event.relatedTarget;
    const scope = editor.current?.closest(".app-shell") || editor.current?.closest(".lb-board");
    // Focus leaving the app and visibility changes keep local drafts rather
    // than committing incomplete input.
    if (target && (!scope?.contains(target) || target.closest("[role=dialog]"))) return;
    const saved = await finish();
    await new Promise(resolve => requestAnimationFrame(resolve));
    if (saved === false) { input.current?.focus({ preventScroll: true }); return; }
    if (target?.isConnected) target.focus?.({ preventScroll: true });
  }
  latest.current = { disabled, finish };
  useEffect(() => {
    const actionable = "button,input,select,textarea,a,label,[role=button]";
    function actionTarget(event) {
      const target = event.target instanceof Element ? event.target.closest(actionable) : null;
      const scope = editor.current?.closest(".app-shell") || editor.current?.closest(".lb-board");
      if (!target || !scope?.contains(target) || !editor.current?.getClientRects().length || related(target) || target.closest("[role=dialog]")) return null;
      return { target, scope };
    }
    function pointerDown(event) {
      if (event.button !== 0 || replaying.current || !actionTarget(event)) return;
      // Keep focus until click is captured. Starting a write on blur would
      // disable the clicked button before its click could run.
      event.preventDefault(); event.stopImmediatePropagation();
    }
    async function click(event) {
      const action = actionTarget(event);
      if (replaying.current || !action) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (latest.current.disabled || acting.current) return;
      const label = action.target.getAttribute("aria-label"), id = action.target.id;
      const saved = await latest.current.finish();
      // Wait for the saved row, fresh handlers/versions and enabled controls.
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (saved === false) { input.current?.focus({ preventScroll: true }); return; }
      const target = action.target.isConnected ? action.target : id ? document.getElementById(id) : label ? action.scope.querySelector(`[aria-label="${CSS.escape(label)}"]`) : null;
      if (!target || target.matches(":disabled")) return;
      target.focus?.({ preventScroll: true });
      replaying.current = true;
      try { target.click(); } finally { replaying.current = false; }
    }
    document.addEventListener("pointerdown", pointerDown, true);
    document.addEventListener("click", click, true);
    return () => {
      document.removeEventListener("pointerdown", pointerDown, true);
      document.removeEventListener("click", click, true);
    };
  }, []);
  useLayoutEffect(() => {
    // Reveal only the part below the viewport; never send the user back to Quick Add.
    const list = editor.current?.closest(".lb-list-body");
    const bottom = editor.current?.getBoundingClientRect().bottom || 0;
    if (list && /auto|scroll/.test(getComputedStyle(list).overflowY)) {
      const hidden = bottom - Math.min(list.getBoundingClientRect().bottom, window.innerHeight);
      if (hidden > 0) list.scrollTop += hidden;
    } else if (bottom > window.innerHeight) window.scrollBy(0, bottom - window.innerHeight);
    (focusNotes ? noteInput.current : input.current)?.focus({ preventScroll: true });
  }, []);
  return <form ref={editor} autoComplete="off" className={`lb-inline-editor${shared ? " lb-inline-shared" : ""}`} aria-label={`編輯${kind}：${item.title}`} onSubmit={save} onBlur={leave} onKeyDownCapture={event => {
    if (event.key === "Escape" && !event.nativeEvent.isComposing && !editor.current?.querySelector('[aria-expanded="true"]')) { event.preventDefault(); event.stopPropagation(); void cancel(); }
  }} onKeyDown={event => {
    if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
  }}>
    <div className="lb-inline-fields"><input className="lb-inline-name" ref={input} required aria-label={`編輯${kind}名稱`} title="離開此列自動儲存，Enter 儲存，Esc 取消" value={form.title} maxLength={160} disabled={disabled} onChange={event => { event.target.setCustomValidity(""); setForm({ ...form, title: event.target.value }); }} />
    <input ref={noteInput} className="lb-inline-notes" aria-label={`編輯${kind}備註`} placeholder="新增備註" title={form.notes || ""} value={form.notes || ""} maxLength={1000} disabled={disabled} onChange={event => setForm({ ...form, notes: event.target.value })} /></div>
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
  onTogglePersonal, onUpdateShared, onMovePersonal, onDeletePersonal, onDeleteShared, busy = false, error = "",
}) {
  const [focusNotes, setFocusNotes] = useState(false);
  const [dragged, setDragged] = useState(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [personalFilter, setPersonalFilter] = useState("all"), [sharedFilter, setSharedFilter] = useState("all");
  const [collapsedGroups, setCollapsedGroups] = useState([]);
  const previousCategories = useRef(new Map());
  const rows = useRef(new Map()), previousEditor = useRef(null);
  const approved = members.filter(member => member.status === "approved");
  const byMember = new Map(approved.map(member => [member.user_id, member]));
  const assigned = sharedLuggageItems.filter(item => item.assigned_to === currentUserId);
  const myPacked = luggageItems.filter(item => item.packed).length + assigned.filter(item => item.packed_by_assignee).length;
  const categories = [...new Set([...categoryDefaults, ...luggageItems.map(item => item.category), ...sharedLuggageItems.map(item => item.category)].filter(Boolean))].map(value => ({ value, label: value }));
  const assignees = [{ value: "", label: "未指派" }, ...approved.map(member => ({ value: member.user_id, label: `${memberLabel(member)}${member.user_id === currentUserId ? "（我）" : ""}` }))];
  const search = query.trim().toLocaleLowerCase();
  const matches = item => !search || [item.title, item.category, item.notes, item.assigned_to ? memberLabel(byMember.get(item.assigned_to)) : ""].join(" ").toLocaleLowerCase().includes(search);
  const myMatches = (item, shared) => matches(item) && (personalFilter === "all" || (personalFilter === "packed") === Boolean(shared ? item.packed_by_assignee : item.packed));
  const shownPersonal = luggageItems.filter(item => item.id === editingPersonalId || myMatches(item, false)), shownAssigned = assigned.filter(item => myMatches(item, true));
  const shownShared = sharedLuggageItems.filter(item => item.id === editingSharedId || matches(item) && (sharedFilter === "all" || sharedFilter === "unassigned" && !item.assigned_to || sharedFilter === "unpacked" && !item.packed_by_assignee || sharedFilter === "packed" && item.packed_by_assignee));
  const categoryOf = item => item.category?.trim() || "未分類";
  const personalGroups = [...new Set([...categoryDefaults, ...luggageItems.map(categoryOf)])].map(category => ({ category, items: shownPersonal.filter(item => categoryOf(item) === category), all: luggageItems.filter(item => categoryOf(item) === category) })).filter(group => group.items.length);
  const isCollapsed = key => !search && collapsedGroups.includes(key);
  function toggleGroup(key) { setCollapsedGroups(current => current.includes(key) ? current.filter(value => value !== key) : [...current, key]); }
  useEffect(() => {
    const next = new Map(luggageItems.map(item => [item.id, categoryOf(item)]));
    const reveal = new Set(luggageItems.filter(item => previousCategories.current.size && previousCategories.current.get(item.id) !== categoryOf(item)).map(categoryOf));
    previousCategories.current = next;
    if (reveal.size) setCollapsedGroups(current => current.filter(key => !reveal.has(key)));
  }, [luggageItems]);
  const memberGroups = new Map();
  for (const item of shownShared) {
    const key = item.assigned_to || "";
    if (!memberGroups.has(key)) memberGroups.set(key, []);
    memberGroups.get(key).push(item);
  }
  const memberOrder = [currentUserId, ...approved.map(member => member.user_id).filter(id => id !== currentUserId)];
  const rankMember = id => !id ? Number.MAX_SAFE_INTEGER : memberOrder.includes(id) ? memberOrder.indexOf(id) : memberOrder.length;
  const orderedGroups = [...memberGroups].sort(([a], [b]) => rankMember(a) - rankMember(b));
  async function movePersonal(item, category) {
    const result = await onMovePersonal(item, category);
    if (result?.ok) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      rows.current.get(item.id)?.querySelector(".lb-drag-handle")?.focus({ preventScroll: true });
    }
    return result;
  }
  function navigateTabs(event) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); const next = event.key === "Home" ? "personal" : event.key === "End" ? "shared" : activeTab === "personal" ? "shared" : "personal";
    onTabChange?.(next); event.currentTarget.querySelector(`#lb-${next}-tab`)?.focus();
  }
  useEffect(() => { setQuery(""); setSearchOpen(false); setPersonalFilter("all"); setSharedFilter("all"); setCollapsedGroups([]); }, [activeTrip?.id]);
  useLayoutEffect(() => {
    const editing = editingPersonalId || editingSharedId;
    if (previousEditor.current && !editing && document.activeElement === document.body) rows.current.get(previousEditor.current)?.querySelector(".lb-item-name")?.focus({ preventScroll: true });
    previousEditor.current = editing;
  }, [editingPersonalId, editingSharedId]);

  return <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={({ active }) => setDragged(active.data.current?.item || null)} onDragCancel={() => setDragged(null)} onDragEnd={({ active, over }) => {
    setDragged(null); const item = active.data.current?.item, category = over?.data.current?.category;
    if (item && typeof category === "string" && category !== (item.category || "")) void movePersonal(item, category);
  }}><section className="panel luggage-panel travel-workspace lb-board" aria-label="行李清單">
    {error ? <p className="lb-error" role="alert">{typeof error === "string" ? error : "操作未完成，請重試。"}</p> : null}
    <div className="mobile-tabs lb-mobile-tabs" role="tablist" aria-label="行李清單類型" onKeyDown={navigateTabs}>
      {[['personal','個人行李'],['shared','團隊公物']].map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={activeTab === key} aria-controls={`lb-${key}`} tabIndex={activeTab === key ? 0 : -1} id={`lb-${key}-tab`} onClick={() => onTabChange?.(key)}>{label}</button>)}
    </div>
    <div className="luggage-layout lb-layout">
      <section id="lb-personal" className={`luggage-column lb-personal${activeTab === "personal" ? " active" : ""}`} aria-label="個人行李">
        <header className="lb-column-heading"><h3>個人行李 <LockKeyhole size={12} aria-label="僅自己可見" /></h3><Progress label="我的打包進度" value={myPacked} total={luggageItems.length + assigned.length} /></header>
        <PackingFilters label="個人行李篩選" value={personalFilter} onChange={setPersonalFilter}><InlineSearch {...{ open: searchOpen, setOpen: setSearchOpen, query, setQuery, activeTab }} /></PackingFilters>
        <QuickAdd form={personalQuickForm} setForm={setPersonalQuickForm} categories={categories} disabled={!canEdit || busy} onSubmit={submitPersonalQuick} />
        <div className="lb-list-body" tabIndex={0} aria-label="個人行李清單">
          <div className="lb-list-labels" aria-hidden="true"><span>物品</span><span>備註</span></div>
          {shownAssigned.length ? <PersonalGroup label="我負責的公物" shared count={assigned.length} packed={assigned.filter(item => item.packed_by_assignee).length} collapsed={isCollapsed("assigned")} toggle={() => toggleGroup("assigned")}><div className="assigned-shared-list lb-assigned">{shownAssigned.map(item => <article className={`luggage-row shared-assigned${item.packed_by_assignee ? " packed" : ""}`} key={item.id}>
            <PackCheck title={item.title} label="打包指派公物" checked={item.packed_by_assignee} disabled={!canEdit || busy || isLockedByAnotherUser(item, currentUserId)} onChange={() => onUpdateShared(item.id, { packed_by_assignee: !item.packed_by_assignee }, item)} description="公物打包狀態與團隊同步" />
            <span className="lb-public-tag">公物</span><div className="lb-row-fields"><strong>{item.title}</strong><span className="lb-item-notes" title={item.notes || ""}>{item.notes}</span></div>
          </article>)}</div></PersonalGroup> : null}
          {shownPersonal.length ? <div className="luggage-list lb-private-list">{personalGroups.map(group => <PersonalGroup key={group.category} label={group.category} count={group.all.length} packed={group.all.filter(item => item.packed).length} collapsed={isCollapsed(group.category) && !group.items.some(item => item.id === editingPersonalId)} toggle={() => toggleGroup(group.category)}>{group.items.map(item => {
            const locked = isLockedByAnotherUser(item, currentUserId);
            return <DraggableRow item={item} disabled={!canEdit || busy || locked} draggingDisabled={Boolean(editingPersonalId || editingSharedId)} categories={categories} onMove={movePersonal} rowRef={node => { if (node) rows.current.set(item.id, node); else rows.current.delete(item.id); }} className={`luggage-row lb-private-row${item.packed ? " packed" : ""}${editingPersonalId === item.id ? " is-editing" : ""}`} key={item.id}>{editingPersonalId === item.id
              ? <><PackCheck title={item.title} checked={item.packed} disabled /><InlineEditor focusNotes={focusNotes} item={item} form={personalForm} setForm={setPersonalForm} categories={categories} disabled={!canEdit || busy} onSubmit={submitPersonal} onCancel={cancelPersonalEdit} onDelete={onDeletePersonal} /></>
              : <><PackCheck title={item.title} checked={item.packed} disabled={!canEdit || busy || locked} onChange={() => onTogglePersonal(item)} /><div className="lb-row-fields"><ItemName item={item} disabled={!canEdit || busy || locked} onEdit={item => { setFocusNotes(false); editPersonal(item); }} /><button type="button" className="lb-item-notes" aria-label={`編輯備註：${item.title}`} title={item.notes || "新增備註"} disabled={!canEdit || busy || locked} onClick={() => { setFocusNotes(true); editPersonal(item); }} >{item.notes || <span className="lb-note-hint">新增備註</span>}</button></div>{locked ? <LockKeyhole size={12} aria-label="其他成員編輯中" /> : null}</>}</DraggableRow>;
          })}</PersonalGroup>)}</div> : !shownAssigned.length ? <Empty filtered={Boolean(search || personalFilter !== "all")} /> : null}
        </div>
      </section>
      <section id="lb-shared" className={`luggage-column lb-shared${activeTab === "shared" ? " active" : ""}`} aria-label="團隊公物">
        <header className="lb-column-heading"><h3>團隊公物</h3><Progress label="成員已打包" value={sharedLuggageItems.filter(item => item.packed_by_assignee).length} total={sharedLuggageItems.length} /></header>
        <PackingFilters label="團隊公物篩選" value={sharedFilter} onChange={setSharedFilter} shared><InlineSearch {...{ open: searchOpen, setOpen: setSearchOpen, query, setQuery, activeTab }} mobileOnly /></PackingFilters>
        <QuickAdd shared form={sharedQuickForm} setForm={setSharedQuickForm} categories={categories} assignees={assignees} disabled={!canEdit || busy} onSubmit={submitSharedQuick} />
        <div className="lb-list-body" tabIndex={0} aria-label="團隊公物清單">
          {shownShared.length ? <div className="luggage-list">{orderedGroups.map(([memberId, items]) => {
            const member = byMember.get(memberId);
            const name = member ? `${memberLabel(member)}${memberId === currentUserId ? "（我）" : ""}` : memberId ? "需重新指派" : "未指派";
            return <section className={`lb-member-group${!member ? " is-unassigned" : ""}`} key={memberId} aria-label={`${name}的公物`}><h4><span className="lb-member-avatar" aria-hidden="true">{member ? memberLabel(member).slice(0, 1).toUpperCase() : "—"}</span><span>{name}</span><small>{items.filter(item => item.packed_by_assignee).length}/{items.length}</small></h4>{items.map(item => {
            const locked = isLockedByAnotherUser(item, currentUserId);
            const canPack = canEdit && !busy && !locked && item.assigned_to === currentUserId;
            return <article ref={node => { if (node) rows.current.set(item.id, node); else rows.current.delete(item.id); }} className={`shared-luggage-row${item.assigned_to === currentUserId ? " is-mine" : ""}${item.packed_by_assignee ? " packed" : ""}${editingSharedId === item.id ? " is-editing" : ""}`} key={item.id}>
              {editingSharedId === item.id ? <><PackCheck title={item.title} label="成員已打包" checked={item.packed_by_assignee} disabled /><InlineEditor focusNotes={focusNotes} shared item={item} form={sharedForm} setForm={setSharedForm} categories={categories} assignees={assignees} disabled={!canEdit || busy} onSubmit={submitShared} onCancel={cancelSharedEdit} onDelete={onDeleteShared} /></> : <>
              <span className="lb-stage"><span className="lb-mobile-label">打包</span><PackCheck title={item.title} label="成員已打包" checked={item.packed_by_assignee} disabled={!canPack} description={canPack ? "負責人確認打包" : "由負責成員確認打包"} onChange={() => onUpdateShared(item.id, { packed_by_assignee: !item.packed_by_assignee }, item)} /></span>
              <div className="lb-row-fields"><ItemName item={item} disabled={!canEdit || busy || locked} onEdit={item => { setFocusNotes(false); editShared(item); }} /><button type="button" className="lb-item-notes" aria-label={`編輯備註：${item.title}`} title={item.notes || "新增備註"} disabled={!canEdit || busy || locked} onClick={() => { setFocusNotes(true); editShared(item); }}>{item.notes || <span className="lb-note-hint">新增備註</span>}</button></div>
              </>}
            </article>;
          })}</section>; })}</div> : <Empty shared filtered={Boolean(search || sharedFilter !== "all")} />}
        </div>
      </section>
    </div>
  </section><DragOverlay>{dragged ? <div className="lb-drag-preview">{dragged.title}</div> : null}</DragOverlay></DndContext>;
}
