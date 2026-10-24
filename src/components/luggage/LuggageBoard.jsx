import { closestCenter, DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, useDndContext, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
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
  const { active } = useDndContext();
  const { setNodeRef, isOver } = useDroppable({ id: `category:${label}`, data: { kind: "category", category: label === "未分類" ? "" : label }, disabled: shared });
  const id = useId(), Icon = shared ? Luggage : categoryIcons[label] || Package;
  return <section ref={setNodeRef} className={`lb-category-group${shared ? " lb-public-group" : ""}${isOver ? " is-drop-target" : ""}`} aria-label={label}>
    <h4><button type="button" className="lb-group-toggle" aria-expanded={!collapsed} aria-controls={id} onClick={toggle}>
      {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}<Icon size={16} /><span>{label}</span><small>{count}項</small><span className="lb-group-count">{packed}/{count}</span>
    </button></h4>
    <div id={id} hidden={collapsed}>{children}{!count && active?.data.current?.scope === "shared" ? <p className="lb-slot-empty">拖入此分類，確認後轉為私人物品</p> : null}</div>
  </section>;
}

function LuggageTab({ tab, label, selected, onChange }) {
  const { active } = useDndContext();
  const { setNodeRef } = useDroppable({ id: `tab:${tab}`, data: { kind: "tab", tab }, disabled: !active || selected || active.data.current?.scope !== "shared" });
  return <button ref={setNodeRef} type="button" role="tab" aria-selected={selected} aria-controls={`lb-${tab}`} tabIndex={selected ? 0 : -1} id={`lb-${tab}-tab`} onClick={() => onChange?.(tab)}>{label}</button>;
}

function MemberSlot({ memberId, name, member, items, all, canReceive, children }) {
  const { active } = useDndContext();
  const { setNodeRef, isOver } = useDroppable({ id: `member:${memberId}`, data: { kind: "member", assignedTo: memberId, label: name }, disabled: !canReceive });
  const conversion = active?.data.current?.scope === "personal";
  const cue = conversion ? memberId ? `放開轉為共用物品並交給 ${name}` : "放開轉為未指派共用物品" : memberId ? `放開指派給 ${name}` : "放開取消指派";
  return <section ref={setNodeRef} data-member-id={memberId || "unassigned"} className={`lb-member-group${!member ? " is-unassigned" : ""}${isOver ? " is-drop-target" : ""}`} aria-label={`${name}的共用物品`}>
    <h4><span className="lb-member-avatar" aria-hidden="true">{member ? memberLabel(member).slice(0, 1).toUpperCase() : "—"}</span><span>{name}</span><small>{all.filter(item => item.packed_by_assignee).length}/{all.length}</small></h4>
    {children}
    {!items.length ? <p className="lb-slot-empty">{all.length ? "沒有符合的物品" : "尚無共用物品"}</p> : null}
    {isOver ? <span className="lb-drop-cue" aria-hidden="true">{cue}</span> : null}
  </section>;
}

// Arrow keys traverse real, visible destinations; no separate assignee menu.
function keyboardDestination(event, { currentCoordinates, context }) {
  if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.code)) return;
  event.preventDefault();
  const targets = context.droppableContainers.getEnabled().filter(container =>
    container.data.current?.kind !== "tab" && container.node.current?.getClientRects().length);
  const index = targets.findIndex(container => container.id === context.over?.id);
  const direction = ["ArrowDown", "ArrowRight"].includes(event.code) ? 1 : -1;
  const target = targets[(index + direction + targets.length) % targets.length];
  if (!target) return;
  target.node.current.scrollIntoView({ block: "nearest", inline: "nearest" });
  const rect = target.node.current.getBoundingClientRect(), active = context.collisionRect;
  if (!active) return;
  return { x: currentCoordinates.x + rect.left + rect.width / 2 - active.left - active.width / 2,
    y: currentCoordinates.y + rect.top + rect.height / 2 - active.top - active.height / 2 };
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
function ItemName({ item, disabled, onEdit, assigned = false }) {
  return <button type="button" className="lb-item-name" aria-label={`${assigned ? "編輯指派共用物品" : "編輯"}：${item.title}`} title={`編輯 ${item.title}`} disabled={disabled} onClick={() => onEdit(item)}><span>{item.title}</span><Pencil size={12} aria-hidden="true" /></button>;
}
function Empty({ filtered }) { return <p className="lb-empty">{filtered ? "沒有符合的物品" : "還沒有行李，從上方新增。"}</p>; }

function QuickAdd({ form, setForm, categories, disabled, onSubmit }) {
  const input = useRef(null), focusAfterSubmit = useRef(false);
  const kind = "個人行李";
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
  return <form autoComplete="off" className="lb-add-form" aria-label={`快速新增${kind}`} onSubmit={submit}>
    <input ref={input} aria-label={`${kind}名稱`} placeholder={`新增${kind}`} value={form.title} maxLength={160} disabled={disabled} onKeyDown={event => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} onChange={event => setForm({ ...form, title: event.target.value })} />
    <LuggageSelect caption="分類" label={`${kind}分類`} editable placeholder="未分類" value={form.category} options={[{ value: "", label: "未分類" }, ...categories]} disabled={disabled} onValueChange={category => setForm({ ...form, category })} />
    <QuickNote kind={kind} value={form.notes} onChange={notes => setForm({ ...form, notes })} disabled={disabled} />
    <button className="lb-submit" type="submit" aria-label={`新增${kind}`} disabled={disabled || !form.title.trim()}><Plus size={16} /></button>
  </form>;
}

function InlineEditor({ shared = false, item, form, setForm, disabled, onSubmit, onCancel, onDelete, focusNotes = false }) {
  const input = useRef(null), noteInput = useRef(null), editor = useRef(null), acting = useRef(false);
  const latest = useRef(null), replaying = useRef(false);
  const kind = shared ? "共用物品" : "個人行李";
  async function save(event, changes) {
    event?.preventDefault();
    if (disabled || acting.current || event?.nativeEvent?.isComposing) return false;
    input.current?.setCustomValidity(form.title.trim() ? "" : "請輸入物品名稱");
    if (!form.title.trim()) { input.current?.reportValidity(); return false; }
    acting.current = true;
    try { return await onSubmit(event || { preventDefault() {} }, changes); } finally { acting.current = false; }
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
  return <form ref={editor} autoComplete="off" className="lb-inline-editor" aria-label={`編輯${kind}：${item.title}`} onSubmit={save} onBlur={leave} onKeyDownCapture={event => {
    if (event.key === "Escape" && !event.nativeEvent.isComposing && !editor.current?.querySelector('[aria-expanded="true"]')) { event.preventDefault(); event.stopPropagation(); void cancel(); }
  }} onKeyDown={event => {
    if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
  }}>
    <div className="lb-inline-fields"><input className="lb-inline-name" ref={input} required aria-label={`編輯${kind}名稱`} title="離開此列自動儲存，Enter 儲存，Esc 取消" value={form.title} maxLength={160} disabled={disabled} onChange={event => { event.target.setCustomValidity(""); setForm({ ...form, title: event.target.value }); }} />
    <input ref={noteInput} className="lb-inline-notes" aria-label={`編輯${kind}備註`} placeholder="新增備註" title={form.notes || ""} value={form.notes || ""} maxLength={1000} disabled={disabled} onChange={event => setForm({ ...form, notes: event.target.value })} /></div>
    <button className="lb-delete" type="button" disabled={disabled} aria-label={`刪除：${item.title}`} title="刪除物品" onClick={async () => {
      if (acting.current) return;
      acting.current = true;
      try { await onDelete(item.id, item); } finally { acting.current = false; }
    }}><Trash2 size={15} /></button>
    <button className="lb-keyboard-submit" type="submit" tabIndex={-1} aria-hidden="true" />
  </form>;
}

function SharedItemRow({ personal = false, item, editing, locked, canEdit, busy, currentUserId, onOpen, onUpdate, rowRef, editorProps, draggingDisabled }) {
  const disabled = !canEdit || busy || locked;
  const className = `${personal ? "luggage-row shared-assigned" : "shared-luggage-row"}${item.assigned_to === currentUserId ? " is-mine" : ""}${item.packed_by_assignee ? " packed" : ""}${editing ? " is-editing" : ""}`;
  const content = <>
    <PackCheck title={item.title} label={personal ? "打包指派共用物品" : "成員已打包"} checked={item.packed_by_assignee} disabled={disabled || editing || item.assigned_to !== currentUserId} description={personal ? "共用物品打包狀態與團隊同步" : item.assigned_to === currentUserId ? "負責人確認打包" : "由負責成員確認打包"} onChange={() => onUpdate(item.id, { packed_by_assignee: !item.packed_by_assignee }, item)} />
    {personal ? <span className="lb-public-tag">共用物品</span> : null}
    {editing ? <InlineEditor shared item={item} {...editorProps} /> : <>
      <div className="lb-row-fields"><ItemName assigned={personal} item={item} disabled={disabled} onEdit={() => onOpen(false)} /><button type="button" className="lb-item-notes" aria-label={`${personal ? "編輯指派共用物品備註" : "編輯備註"}：${item.title}`} title={item.notes || "新增備註"} disabled={disabled} onClick={() => onOpen(true)}>{item.notes || <span className="lb-note-hint">新增備註</span>}</button></div>
    </>}
  </>;
  return personal ? <article ref={rowRef} className={className}>{content}</article> : <DraggableRow scope="shared" {...{ item, disabled, draggingDisabled, rowRef, className }}>{content}</DraggableRow>;
}

export default function LuggageBoard({
  activeTrip, currentUserId, canEdit, luggageItems = emptyItems, sharedLuggageItems = emptyItems, members = emptyItems,
  personalQuickForm, setPersonalQuickForm, submitPersonalQuick,
  activeTab = "personal", onTabChange, personalForm, setPersonalForm, sharedForm, setSharedForm,
  editingPersonalId, editingSharedId, submitPersonal, submitShared, editPersonal, editShared, cancelPersonalEdit, cancelSharedEdit,
  onTogglePersonal, onUpdateShared, onMovePersonal, onAssign, onPrivatize, onDeletePersonal, onDeleteShared, busy = false, error = "",
}) {
  const [focusNotes, setFocusNotes] = useState(false);
  const [sharedEditorLocation, setSharedEditorLocation] = useState("shared");
  const [assignmentNotice, setAssignmentNotice] = useState("");
  const [dragged, setDragged] = useState(null);
  const dragOriginTab = useRef(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: keyboardDestination, keyboardCodes: { start: ["Space"], end: ["Space", "Enter"], cancel: ["Escape", "Tab"] } }));
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [personalFilter, setPersonalFilter] = useState("all"), [sharedFilter, setSharedFilter] = useState("all");
  const [collapsedGroups, setCollapsedGroups] = useState([]);
  const previousCategories = useRef(new Map());
  const rows = useRef(new Map()), previousEditor = useRef(null);
  const approved = members.filter(member => member.status === "approved");
  const byMember = new Map(approved.map(member => [member.user_id, member]));
  const assigned = sharedLuggageItems.filter(item => item.assigned_to === currentUserId);
  // A successful write can update the projection before the controller closes
  // the editor. Keep its origin during that write instead of opening it twice.
  const sharedLocation = sharedEditorLocation === "personal" && (busy || assigned.some(item => item.id === editingSharedId)) ? "personal" : "shared";
  const myPacked = luggageItems.filter(item => item.packed).length + assigned.filter(item => item.packed_by_assignee).length;
  const categories = [...new Set([...categoryDefaults, ...luggageItems.map(item => item.category), ...sharedLuggageItems.map(item => item.category)].filter(Boolean))].map(value => ({ value, label: value }));
  const search = query.trim().toLocaleLowerCase();
  const matches = item => !search || [item.title, item.category, item.notes, item.assigned_to ? memberLabel(byMember.get(item.assigned_to)) : ""].join(" ").toLocaleLowerCase().includes(search);
  const myMatches = (item, shared) => matches(item) && (personalFilter === "all" || (personalFilter === "packed") === Boolean(shared ? item.packed_by_assignee : item.packed));
  const shownPersonal = luggageItems.filter(item => item.id === editingPersonalId || myMatches(item, false)), shownAssigned = assigned.filter(item => sharedLocation === "personal" && item.id === editingSharedId || myMatches(item, true));
  const shownShared = sharedLuggageItems.filter(item => item.id === editingSharedId || matches(item) && (sharedFilter === "all" || sharedFilter === "unassigned" && !item.assigned_to || sharedFilter === "unpacked" && !item.packed_by_assignee || sharedFilter === "packed" && item.packed_by_assignee));
  const categoryOf = item => item.category?.trim() || "未分類";
  const personalGroups = [...new Set([...categoryDefaults, ...luggageItems.map(categoryOf), ...(dragged?.scope === "shared" ? ["未分類"] : [])])].map(category => ({ category, items: shownPersonal.filter(item => categoryOf(item) === category), all: luggageItems.filter(item => categoryOf(item) === category) })).filter(group => group.items.length || dragged?.scope === "shared");
  const isCollapsed = key => !search && collapsedGroups.includes(key);
  function toggleGroup(key) { setCollapsedGroups(current => current.includes(key) ? current.filter(value => value !== key) : [...current, key]); }
  useEffect(() => {
    const next = new Map(luggageItems.map(item => [item.id, categoryOf(item)]));
    const reveal = new Set(luggageItems.filter(item => previousCategories.current.size && previousCategories.current.get(item.id) !== categoryOf(item)).map(categoryOf));
    previousCategories.current = next;
    if (reveal.size) setCollapsedGroups(current => current.filter(key => !reveal.has(key)));
  }, [luggageItems]);
  const memberGroups = new Map();
  for (const member of approved) memberGroups.set(member.user_id, []);
  memberGroups.set("", []);
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
  useEffect(() => {
    if (!assignmentNotice) return;
    const timer = setTimeout(() => setAssignmentNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [assignmentNotice]);
  useLayoutEffect(() => {
    const editing = editingPersonalId || (editingSharedId ? `${sharedLocation}:${editingSharedId}` : null);
    if (previousEditor.current && !editing && document.activeElement === document.body) {
      const row = rows.current.get(previousEditor.current);
      const fallback = document.querySelector(previousEditor.current.startsWith("personal:") ? '#lb-personal .lb-status-tabs button' : '#lb-shared .lb-status-tabs button');
      (row?.querySelector(".lb-item-name") || fallback)?.focus({ preventScroll: true });
    }
    previousEditor.current = editing;
  }, [editingPersonalId, editingSharedId, sharedLocation]);
  function openShared(item, location, notes) {
    setFocusNotes(notes); setSharedEditorLocation(location);
    void editShared(item);
  }
  function sharedRow(item, personal) {
    const location = personal ? "personal" : "shared";
    return <SharedItemRow key={item.id} personal={personal} item={item} editing={editingSharedId === item.id && sharedLocation === location} locked={isLockedByAnotherUser(item, currentUserId)} {...{ canEdit, busy, currentUserId }} draggingDisabled={Boolean(editingPersonalId || editingSharedId)} onOpen={notes => openShared(item, location, notes)} onUpdate={onUpdateShared}
      rowRef={node => { const key = `${location}:${item.id}`; if (node) rows.current.set(key, node); else rows.current.delete(key); }}
      editorProps={{ form: sharedForm, setForm: setSharedForm, disabled: !canEdit || busy, onSubmit: submitShared, onCancel: cancelSharedEdit, onDelete: onDeleteShared, focusNotes }} />;
  }

  function finishDrag() { setDragged(null); }
  function cancelDrag() {
    finishDrag();
    if (dragOriginTab.current) onTabChange?.(dragOriginTab.current);
    dragOriginTab.current = null;
  }
  async function drop({ active, over }) {
    const data = active.data.current, target = over?.data.current;
    finishDrag();
    if (!data?.item || !target) { cancelDrag(); return; }
    if (target.kind === "category" && data.scope === "shared" || target.kind === "member" && data.scope === "personal") {
      // dnd-kit suppresses document clicks for 50ms after pointer release.
      // Mount the confirmation after cleanup so its first explicit click works.
      await new Promise(resolve => setTimeout(resolve, 60));
      if (!mounted.current) return;
    }
    if (target.kind === "category" && data.scope === "personal") {
      if (target.category !== (data.item.category || "")) await movePersonal(data.item, target.category);
      dragOriginTab.current = null;
      return;
    }
    if (target.kind === "category" && data.scope === "shared") {
      const result = await onPrivatize(data.item, target.category);
      if (result?.ok) {
        setCollapsedGroups(current => current.filter(key => key !== (target.category || "未分類")));
        setAssignmentNotice(`已轉為個人物品，放入${target.category || "未分類"}`);
        onTabChange?.("personal");
        await new Promise(resolve => requestAnimationFrame(resolve));
        rows.current.get(data.item.id)?.querySelector(".lb-drag-handle")?.focus({ preventScroll: true });
      } else if (dragOriginTab.current) onTabChange?.(dragOriginTab.current);
      dragOriginTab.current = null;
      return;
    }
    if (target.kind === "tab") { cancelDrag(); return; }
    if (target.kind !== "member" || data.scope === "shared" && (data.item.assigned_to || "") === target.assignedTo) { dragOriginTab.current = null; return; }
    const result = await onAssign(data.scope, data.item, target.assignedTo);
    if (result?.ok) {
      setAssignmentNotice(data.scope === "personal" ? target.assignedTo ? `已轉為共用物品，由 ${target.label} 攜帶` : "已轉為未指派共用物品" : target.assignedTo ? `已改由 ${target.label} 攜帶` : "已取消指派，移至未指派群組");
      if (target.assignedTo === currentUserId) setCollapsedGroups(current => current.filter(key => key !== "assigned"));
      await new Promise(resolve => requestAnimationFrame(resolve));
      rows.current.get(`shared:${data.item.id}`)?.querySelector(".lb-drag-handle")?.focus({ preventScroll: true });
    } else if (dragOriginTab.current) onTabChange?.(dragOriginTab.current);
    dragOriginTab.current = null;
  }

  return <DndContext sensors={sensors} collisionDetection={args => {
    const containers = args.droppableContainers.filter(container => container.node.current?.getClientRects().length);
    return args.pointerCoordinates ? pointerWithin({ ...args, droppableContainers: containers }) : closestCenter({ ...args, droppableContainers: containers });
  }} accessibility={{ screenReaderInstructions: { draggable: "按空白鍵拿起物品，上下鍵選擇分類或成員，空白鍵放置，Escape取消。私人與共用物品互轉時需確認。手機拖曳共用物品時左右鍵切換個人與團隊頁籤。" } }} onDragOver={({ over }) => {
    if (over?.data.current?.kind === "tab") onTabChange?.(over.data.current.tab);
  }} onDragStart={({ active }) => {
    setDragged(active.data.current || null); dragOriginTab.current = activeTab;
    if (window.matchMedia("(max-width: 1000px)").matches && active.data.current?.scope === "personal") onTabChange?.("shared");
  }} onDragCancel={cancelDrag} onDragEnd={drop}><section className="panel luggage-panel travel-workspace lb-board" aria-label="行李清單" onKeyDownCapture={event => {
    if (dragged?.scope === "shared" && window.matchMedia("(max-width: 1000px)").matches && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); onTabChange?.(event.key === "ArrowLeft" ? "personal" : "shared");
    }
  }}>
    {error ? <p className="lb-error" role="alert">{typeof error === "string" ? error : "操作未完成，請重試。"}</p> : null}
    <span className={`lb-assignment-notice${assignmentNotice ? " is-visible" : ""}`} role="status" aria-label="共用物品指派結果">{assignmentNotice}</span>
    <div className="mobile-tabs lb-mobile-tabs" role="tablist" aria-label="行李清單類型" onKeyDown={navigateTabs}>
      {[['personal','個人行李'],['shared','共用物品']].map(([key, label]) => <LuggageTab key={key} tab={key} label={label} selected={activeTab === key} onChange={onTabChange} />)}
    </div>
    <div className="luggage-layout lb-layout">
      <section id="lb-personal" className={`luggage-column lb-personal${activeTab === "personal" ? " active" : ""}`} aria-label="個人行李">
        <header className="lb-column-heading"><h3>個人行李 <LockKeyhole size={12} aria-label="僅自己可見" /></h3><Progress label="我的打包進度" value={myPacked} total={luggageItems.length + assigned.length} /></header>
        <PackingFilters label="個人行李篩選" value={personalFilter} onChange={setPersonalFilter}><InlineSearch {...{ open: searchOpen, setOpen: setSearchOpen, query, setQuery, activeTab }} /></PackingFilters>
        <QuickAdd form={personalQuickForm} setForm={setPersonalQuickForm} categories={categories} disabled={!canEdit || busy} onSubmit={submitPersonalQuick} />
        <div className="lb-list-body" tabIndex={0} aria-label="個人行李清單">
          <div className="lb-list-labels" aria-hidden="true"><span>物品</span><span>備註</span></div>
          {shownAssigned.length ? <PersonalGroup label="我負責的共用物品" shared count={assigned.length} packed={assigned.filter(item => item.packed_by_assignee).length} collapsed={isCollapsed("assigned") && !(editingSharedId && sharedLocation === "personal")} toggle={() => toggleGroup("assigned")}><div className="assigned-shared-list lb-assigned">{shownAssigned.map(item => sharedRow(item, true))}</div></PersonalGroup> : null}
          {personalGroups.length ? <div className="luggage-list lb-private-list">{personalGroups.map(group => <PersonalGroup key={group.category} label={group.category} count={group.all.length} packed={group.all.filter(item => item.packed).length} collapsed={isCollapsed(group.category) && !group.items.some(item => item.id === editingPersonalId)} toggle={() => toggleGroup(group.category)}>{group.items.map(item => {
            const locked = isLockedByAnotherUser(item, currentUserId);
            return <DraggableRow item={item} disabled={!canEdit || busy || locked} draggingDisabled={Boolean(editingPersonalId || editingSharedId)} categories={categories} onMove={movePersonal} rowRef={node => { if (node) rows.current.set(item.id, node); else rows.current.delete(item.id); }} className={`luggage-row lb-private-row${item.packed ? " packed" : ""}${editingPersonalId === item.id ? " is-editing" : ""}`} key={item.id}>{editingPersonalId === item.id
              ? <><PackCheck title={item.title} checked={item.packed} disabled /><InlineEditor focusNotes={focusNotes} item={item} form={personalForm} setForm={setPersonalForm} categories={categories} disabled={!canEdit || busy} onSubmit={submitPersonal} onCancel={cancelPersonalEdit} onDelete={onDeletePersonal} /></>
              : <><PackCheck title={item.title} checked={item.packed} disabled={!canEdit || busy || locked} onChange={() => onTogglePersonal(item)} /><div className="lb-row-fields"><ItemName item={item} disabled={!canEdit || busy || locked} onEdit={item => { setFocusNotes(false); editPersonal(item); }} /><button type="button" className="lb-item-notes" aria-label={`編輯備註：${item.title}`} title={item.notes || "新增備註"} disabled={!canEdit || busy || locked} onClick={() => { setFocusNotes(true); editPersonal(item); }} >{item.notes || <span className="lb-note-hint">新增備註</span>}</button></div>{locked ? <LockKeyhole size={12} aria-label="其他成員編輯中" /> : null}</>}</DraggableRow>;
          })}</PersonalGroup>)}</div> : !shownAssigned.length ? <Empty filtered={Boolean(search || personalFilter !== "all")} /> : null}
        </div>
      </section>
      <section id="lb-shared" className={`luggage-column lb-shared${activeTab === "shared" ? " active" : ""}`} aria-label="共用物品">
        <header className="lb-column-heading"><h3>共用物品</h3><Progress label="成員已打包" value={sharedLuggageItems.filter(item => item.packed_by_assignee).length} total={sharedLuggageItems.length} /></header>
        <PackingFilters label="共用物品篩選" value={sharedFilter} onChange={setSharedFilter} shared><InlineSearch {...{ open: searchOpen, setOpen: setSearchOpen, query, setQuery, activeTab }} mobileOnly /></PackingFilters>
        <div className="lb-list-body" tabIndex={0} aria-label="共用物品清單">
          <div className="luggage-list">{orderedGroups.map(([memberId, items]) => {
            const member = byMember.get(memberId);
            const name = member ? `${memberLabel(member)}${memberId === currentUserId ? "（我）" : ""}` : memberId ? "需重新指派" : "未指派";
            return <MemberSlot key={memberId} {...{ memberId, name, member, items }} all={sharedLuggageItems.filter(item => (item.assigned_to || "") === memberId)} canReceive={canEdit && !busy && Boolean(member || !memberId)}>{items.map(item => sharedRow(item, false))}</MemberSlot>; })}</div>
        </div>
      </section>
    </div>
  </section><DragOverlay style={{ pointerEvents: "none" }}>{dragged ? <div className="lb-drag-preview"><strong>{dragged.item.title}</strong>{dragged.item.notes ? <span>{dragged.item.notes}</span> : null}<small>{dragged.scope === "personal" ? "拖至成員區，確認後轉為共用物品並公開名稱與備註" : "拖至個人分類，確認後轉為自己的私人物品"}</small></div> : null}</DragOverlay></DndContext>;
}
