import { createPortal } from "react-dom";
import { luggageTitleLimit, luggageNotesLimit } from "../../lib/luggageLimits.js";
import { closestCenter, DndContext, DragOverlay, KeyboardSensor, MeasuringStrategy, PointerSensor, pointerWithin, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { DraggableRow, GroupInsertion, LuggageDragLayout, useAnchoredPopup, luggageDropResizeObserver, useLuggageDragState } from "./LuggageInteractions.jsx";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, CreditCard, GripVertical, LockKeyhole, Package, Pencil, Plus, Shirt, Smartphone, SoapDispenserDroplet, BriefcaseMedical, Luggage, Trash2, Users, Search, SlidersHorizontal, CircleHelp, X } from "lucide-react";
import MenuSelect from "../MenuSelect.jsx";
import { isLockedByAnotherUser } from "../../lib/editLocks.js";
import { planLuggageOrder, sortLuggageItems } from "../../lib/luggageOrdering.js";
import "./luggage-board.css";

const emptyItems = [];
const categoryDefaults = ["證件", "電子用品", "衣物", "盥洗用品", "健康用品", "日常用品", "其他"];
function memberLabel(member) { return member?.display_name || member?.nickname || member?.profile?.display_name || member?.profiles?.display_name || member?.email?.split("@")[0] || "旅程成員"; }

const categoryIcons = { 證件: CreditCard, 衣物: Shirt, 電子用品: Smartphone, 盥洗用品: SoapDispenserDroplet, 健康用品: BriefcaseMedical, 日常用品: Package };
function PersonalGroup({ label, count, packed, collapsed, toggle, shared = false, children }) {
  const { active, over } = useLuggageDragState();
  const { setNodeRef, isOver } = useDroppable({ id: `category:${label}`, data: { kind: "category", category: label === "未分類" ? "" : label }, disabled: shared, resizeObserverConfig: luggageDropResizeObserver });
  const target = over?.data.current;
  const originalCategory = active?.data.current?.scope === "personal" && (active.data.current.item.category?.trim() || "未分類") === label;
  const receiving = !shared && !originalCategory && (isOver || target?.kind === "row" && target.scope === "personal" && (target.item.category?.trim() || "未分類") === label);
  const id = useId(), Icon = shared ? Luggage : categoryIcons[label] || Package;
  return <section ref={setNodeRef} className={`lb-category-group${shared ? " lb-public-group" : ""}${receiving ? " is-drop-target" : ""}`} aria-label={label}>
    <h4><button type="button" className="lb-group-toggle" aria-expanded={!collapsed} aria-controls={id} onClick={toggle}>
      {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}<Icon size={16} /><span>{label}</span><small>{count}項</small><span className="lb-group-count">{packed}/{count}</span>
    </button></h4>
    <div id={id} hidden={collapsed}>{children}{!count && active?.data.current?.scope === "shared" ? <p className="lb-slot-empty">拖入此分類，確認後轉為私人物品</p> : null}</div>
    <GroupInsertion active={active} visible={Boolean(isOver && active && !originalCategory)} />
  </section>;
}

function LuggageTab({ tab, label, selected, onChange }) {
  const { active } = useLuggageDragState();
  const { setNodeRef } = useDroppable({ id: `tab:${tab}`, data: { kind: "tab", tab }, disabled: !active || selected, resizeObserverConfig: luggageDropResizeObserver });
  return <button ref={setNodeRef} type="button" role="tab" aria-selected={selected} aria-controls={`lb-${tab}`} tabIndex={selected ? 0 : -1} id={`lb-${tab}-tab`} onClick={() => onChange?.(tab)}>{label}</button>;
}

function MemberSlot({ memberId, name, member, items, all, canReceive, children }) {
  const { active, over } = useLuggageDragState();
  const { setNodeRef, isOver } = useDroppable({ id: `member:${memberId}`, data: { kind: "member", assignedTo: memberId, label: name }, disabled: !canReceive, resizeObserverConfig: luggageDropResizeObserver });
  const target = over?.data.current;
  const originalMember = active?.data.current?.scope === "shared" && (active.data.current.item.assigned_to || "") === memberId;
  const receiving = canReceive && !originalMember && (isOver || target?.kind === "row" && target.scope === "shared" && (target.item.assigned_to || "") === memberId);
  const conversion = active?.data.current?.scope === "personal";
  const cue = conversion ? memberId ? `交給 ${name} 準備` : "放開轉為未指派共用物品" : memberId ? `交給 ${name} 準備` : "放開取消指派";
  return <section ref={setNodeRef} data-member-id={memberId || "unassigned"} className={`lb-member-group${!member ? " is-unassigned" : ""}${receiving ? " is-drop-target" : ""}`} aria-label={`${name}的共用物品`}>
    <h4><span className="lb-member-avatar" aria-hidden="true">{member ? memberLabel(member).slice(0, 1).toUpperCase() : "—"}</span><span>{name}</span><small>{all.filter(item => item.packed_by_assignee).length}/{all.length}</small></h4>
    {children}
    {!items.length ? <p className="lb-slot-empty">{all.length ? "沒有符合的物品" : "尚無共用物品"}</p> : null}
    <GroupInsertion active={active} visible={Boolean(isOver && active && !originalMember)} />
    {receiving && (conversion || (active?.data.current?.item.assigned_to || "") !== memberId) ? <span className="lb-drop-cue" aria-hidden="true">{cue}</span> : null}
  </section>;
}

// Arrow keys traverse real, visible destinations; no separate assignee menu.
function keyboardDestination(event, { currentCoordinates, context }, selectedTarget) {
  if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.code)) return;
  event.preventDefault();
  const targets = context.droppableContainers.getEnabled().filter(container =>
    container.data.current?.kind !== "tab" && container.node.current?.getClientRects().length);
  const index = targets.findIndex(container => container.id === context.over?.id);
  const direction = ["ArrowDown", "ArrowRight"].includes(event.code) ? 1 : -1;
  const target = targets[(index + direction + targets.length) % targets.length];
  if (!target) return;
  selectedTarget.current = target.id;
  target.node.current.scrollIntoView({ block: "nearest", inline: "nearest" });
  const rect = target.node.current.getBoundingClientRect(), active = context.collisionRect;
  if (!active) return;
  return { x: currentCoordinates.x + rect.left + rect.width / 2 - active.left - active.width / 2,
    y: currentCoordinates.y + rect.top + rect.height / 2 - active.top - active.height / 2 };
}

function LuggageSelect({ caption, ...props }) {
  const select = <MenuSelect {...props} popupClassName="lb-menu-popup" />;
  return caption ? <label className="lb-meta-field"><span>{caption}</span>{select}</label> : select;
}
function ReadinessFilter({ label, filter, setFilter, disabled }) {
  return (<MenuSelect className={`lb-heading-filter${filter !== "all" ? " is-filtered" : ""}`} label={label} value={filter} disabled={disabled} options={[{ value: "all", label: "全部" }, { value: "unpacked", label: "未準備" }, { value: "packed", label: "已備妥" }]} onValueChange={setFilter} popupWidth={144} popupAlign="end" popupClassName="lb-menu-popup" triggerContent={<><SlidersHorizontal size={17} aria-hidden="true" /><span className="lb-sr-status">{filter === "all" ? "全部" : filter === "packed" ? "已備妥" : "未準備"}</span></>} />);
}
function PersonalTools({ query, setQuery, filter, setFilter, disabled }) {
  const [open, setOpen] = useState(false), input = useRef(null), trigger = useRef(null), search = useRef(null);
  const id = useId();
  useLayoutEffect(() => { if (open) input.current?.focus({ preventScroll: true }); }, [open]);
  useEffect(() => {
    if (!open || query.trim()) return;
    function outside(event) { if (!search.current?.contains(event.target)) setOpen(false); }
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open, query]);
  function close() { setQuery(""); setOpen(false); trigger.current?.focus({ preventScroll: true }); }
  return <div className={`lb-heading-tools${open ? " is-search-open" : ""}`}>
    <div ref={search} className="lb-heading-search">
      {open ? <input id={id} ref={input} type="search" aria-label="搜尋所有行李" placeholder="搜尋所有行李名稱或備註" value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); close(); } }} /> : null}
      <button ref={trigger} type="button" className="lb-heading-icon" aria-label={open ? "關閉行李搜尋" : "搜尋所有行李"} title={open ? "關閉搜尋" : "搜尋"} aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onClick={() => open ? close() : setOpen(true)}>{open ? <X size={17} /> : <Search size={17} />}</button>
    </div>
    <ReadinessFilter label="篩選個人行李" {...{ filter, setFilter, disabled }} />
  </div>;
}
function SharedTools({ filter, setFilter, disabled }) {
  const [open, setOpen] = useState(false), trigger = useRef(null), popup = useRef(null), id = useId();
  const position = useAnchoredPopup(open, trigger, popup, () => setOpen(false));
  useLayoutEffect(() => { if (open) popup.current?.querySelector("button")?.focus({ preventScroll: true }); }, [open]);
  function close() { setOpen(false); trigger.current?.focus({ preventScroll: true }); }
  return <div className="lb-heading-tools">
    <ReadinessFilter label="篩選共用物品" {...{ filter, setFilter, disabled }} />
    <button ref={trigger} className="lb-heading-icon" type="button" aria-label="行李頁說明" title="行李頁說明" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}><CircleHelp size={17} /></button>
    {open ? createPortal(<div ref={popup} id={id} className="lb-note-popup lb-help-popup" style={position} role="dialog" aria-label="行李頁說明" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <header><strong>行李頁說明</strong><button type="button" aria-label="關閉行李頁說明" onClick={close}><X size={16} /></button></header>
      <ul><li>個人行李僅自己可見；共用物品供旅程成員查看。</li><li>從左側新增，可選個人或共用，並指定負責人。</li><li>勾選表示已備妥；共用物品由負責人確認準備。</li><li>拖曳可調整順序、分類或負責人；共享、改派與轉回個人皆會先詢問。</li><li>搜尋涵蓋兩欄名稱與備註，兩欄可分別篩選準備狀態。</li></ul>
    </div>, document.body) : null}
  </div>;
}
function Progress({ label, value, total }) {
  return <span className="lb-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={Math.max(total, 1)} aria-valuenow={value} aria-valuetext={`${value} / ${total}`}><span><b>{value}</b>/{total}</span><span className="lb-meter" aria-hidden="true"><span style={{ width: `${total ? value / total * 100 : 0}%` }} /></span></span>;
}
function PackCheck({ title, checked, disabled, onChange, label, description }) {
  return <label className="lb-check" title={description}>
    <input type="checkbox" aria-label={`${label || "準備"}：${title}`} checked={Boolean(checked)} disabled={disabled} onChange={onChange} />
    <span className="lb-check-box" aria-hidden="true"><Check size={12} /></span>
  </label>;
}
function ItemName({ item, disabled, onEdit, assigned = false }) {
  return <button type="button" className="lb-item-name" aria-label={`${assigned ? "編輯指派共用物品" : "編輯"}：${item.title}`} title={`編輯 ${item.title}`} disabled={disabled} onClick={() => onEdit(item)}><span>{item.title}</span><Pencil size={12} aria-hidden="true" /></button>;
}
function ItemFields({ item, assigned = false, disabled, onName, onNotes }) {
  return <div className="lb-row-fields"><div className="lb-row-title">{assigned ? <span className="lb-public-tag">共用</span> : null}<ItemName assigned={assigned} item={item} disabled={disabled} onEdit={onName} /></div><button type="button" className="lb-item-notes" aria-label={`${assigned ? "編輯指派共用物品備註" : "編輯備註"}：${item.title}`} title={item.notes || "新增備註"} disabled={disabled} onClick={onNotes}>{item.notes || <span className="lb-note-hint">新增備註</span>}</button></div>;
}

function DraggedItemRow({ dragged, currentUserId }) {
  const { item, scope, personalProjection, rowStyle } = dragged;
  const shared = scope === "shared", packed = shared ? item.packed_by_assignee : item.packed;
  const className = `${shared && !personalProjection ? "shared-luggage-row" : "luggage-row"}${shared && item.assigned_to === currentUserId ? " is-mine" : ""}${personalProjection ? " shared-assigned" : ""}${packed ? " packed" : ""}`;
  return <div className="luggage-panel lb-board lb-drag-preview" style={rowStyle} aria-hidden="true"><article className={className}>
    <span className="lb-drag-handle"><GripVertical size={15} /></span>
    <PackCheck title={item.title} checked={packed} disabled={shared && item.assigned_to !== currentUserId} onChange={() => {}} />
    <ItemFields item={item} assigned={personalProjection} />
  </article></div>;
}
function Empty({ filtered }) { return <p className="lb-empty">{filtered ? "沒有符合的物品" : "還沒有行李，從上方新增。"}</p>; }

function QuickAdd({ form, setForm, categories, members, currentUserId, disabled, onSubmit }) {
  const input = useRef(null), focusAfterSubmit = useRef(false);
  const shared = form.creation_scope === "shared", kind = shared ? "共用物品" : "個人行李";
  const assignedTo = form.assigned_to || currentUserId;
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
    <div className="lb-creation-mode" role="group" aria-label="新增物品類型">{[[false, "個人", Luggage], [true, "共用", Users]].map(([isShared, label, Icon]) =>
      <button key={label} type="button" className="lb-mode-option" aria-label={`新增類型：${label}`} aria-pressed={shared === isShared} disabled={disabled} onClick={() => {
        if (shared !== isShared) setForm({ ...form, creation_scope: isShared ? "shared" : "personal", assigned_to: assignedTo });
      }}><Icon size={15} aria-hidden="true" /><span>{label}</span></button>)}</div>
    {shared ? <LuggageSelect label="共用物品攜帶者" placeholder="選擇攜帶者" value={assignedTo} options={members.map(member => ({ value: member.user_id, label: `${memberLabel(member)}${member.user_id === currentUserId ? "（我）" : ""}` }))} disabled={disabled} onValueChange={assigned_to => setForm({ ...form, assigned_to })} />
      : <LuggageSelect label={`${kind}分類`} editable placeholder="未分類" value={form.category} options={[{ value: "", label: "未分類" }, ...categories]} disabled={disabled} onValueChange={category => setForm({ ...form, category })} />}
    <input ref={input} aria-label={`${kind}名稱`} placeholder={`新增${kind}`} value={form.title} maxLength={luggageTitleLimit} disabled={disabled} onKeyDown={event => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} onChange={event => setForm({ ...form, title: event.target.value })} />
    <div className="lb-add-secondary">
      <input className="lb-quick-notes" aria-label={`${kind}備註`} placeholder="備註（選填）" value={form.notes || ""} maxLength={luggageNotesLimit} disabled={disabled} onChange={event => setForm({ ...form, notes: event.target.value })} onKeyDown={event => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} />
      <button className="lb-submit" type="submit" aria-label={`新增${kind}`} disabled={disabled || !form.title.trim() || shared && !members.some(member => member.user_id === assignedTo)}><Plus size={16} aria-hidden="true" /><span>新增</span></button>
    </div>
  </form>;
}

function InlineEditor({ shared = false, assigned = false, item, form, setForm, disabled, onSubmit, onCancel, onDelete, focusNotes = false }) {
  const input = useRef(null), noteInput = useRef(null), editor = useRef(null), acting = useRef(false);
  const [stacked, setStacked] = useState(false);
  useLayoutEffect(() => {
    const fields = editor.current?.querySelector(".lb-inline-fields");
    if (!fields) return;
    const canvas = document.createElement("canvas"), context = canvas.getContext("2d");
    function measure() {
      if (!context) return;
      // Always compare against the original two-column widths, even after
      // expanding. Measuring expanded inputs would toggle the layout forever.
      const width = fields.clientWidth, gap = 8;
      const badge = fields.querySelector(".lb-public-tag")?.getBoundingClientRect().width || 0;
      function exceeds(element, value, available) {
        const style = getComputedStyle(element);
        context.font = style.font;
        const inset = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
        return context.measureText(value || "").width + inset > available + 1;
      }
      setStacked(width > 0 && (exceeds(input.current, form.title, (width - gap) * .35 - badge)
        || exceeds(noteInput.current, form.notes, (width - gap) * .65)));
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(fields);
    return () => observer.disconnect();
  }, [form.title, form.notes, assigned]);
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
  return <form ref={editor} autoComplete="off" className={`lb-inline-editor${stacked ? " lb-editor-stacked" : ""}`} aria-label={`編輯${kind}：${item.title}`} onSubmit={save} onBlur={leave} onKeyDownCapture={event => {
    if (event.key === "Escape" && !event.nativeEvent.isComposing && !editor.current?.querySelector('[aria-expanded="true"]')) { event.preventDefault(); event.stopPropagation(); void cancel(); }
  }} onKeyDown={event => {
    if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
  }}>
    <div className="lb-inline-fields"><div className="lb-inline-title">{assigned ? <span className="lb-public-tag">共用</span> : null}<input className="lb-inline-name" ref={input} required aria-label={`編輯${kind}名稱`} title="離開此列自動儲存，Enter 儲存，Esc 取消" value={form.title} maxLength={luggageTitleLimit} disabled={disabled} onChange={event => { event.target.setCustomValidity(""); setForm({ ...form, title: event.target.value }); }} /></div>
    <input ref={noteInput} className="lb-inline-notes" aria-label={`編輯${kind}備註`} placeholder="新增備註" title={form.notes || ""} value={form.notes || ""} maxLength={luggageNotesLimit} disabled={disabled} onChange={event => setForm({ ...form, notes: event.target.value })} /></div>
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
    <PackCheck title={item.title} label={personal ? "準備指派共用物品" : "成員已備妥"} checked={item.packed_by_assignee} disabled={disabled || editing || item.assigned_to !== currentUserId} description={personal ? "共用物品準備狀態與團隊同步" : item.assigned_to === currentUserId ? "負責人確認準備" : "由負責成員確認準備"} onChange={() => onUpdate(item.id, { packed_by_assignee: !item.packed_by_assignee }, item)} />
    {editing ? <InlineEditor shared assigned={personal} item={item} {...editorProps} /> : <>
      <ItemFields item={item} assigned={personal} disabled={disabled} onName={() => onOpen(false)} onNotes={() => onOpen(true)} />
    </>}
  </>;
  return <DraggableRow scope="shared" personalProjection={personal} {...{ item, disabled, draggingDisabled, rowRef, className }}>{content}</DraggableRow>;
}

export default function LuggageBoard({
  activeTrip, currentUserId, canEdit, luggageItems = emptyItems, sharedLuggageItems = emptyItems, members = emptyItems,
  personalQuickForm, setPersonalQuickForm, submitPersonalQuick,
  activeTab = "personal", onTabChange, personalForm, setPersonalForm, sharedForm, setSharedForm,
  editingPersonalId, editingSharedId, submitPersonal, submitShared, editPersonal, editShared, cancelPersonalEdit, cancelSharedEdit,
  onTogglePersonal, onUpdateShared, onMovePersonal, onAssign, onPrivatize, onReorder, onDeletePersonal, onDeleteShared, busy: mutationBusy = false, error = "",
}) {
  const [focusNotes, setFocusNotes] = useState(false);
  const [sharedEditorLocation, setSharedEditorLocation] = useState("shared");
  const [assignmentNotice, setAssignmentNotice] = useState("");
  const [personalQuery, setPersonalQuery] = useState("");
  const [personalFilter, setPersonalFilter] = useState("all");
  const [sharedFilter, setSharedFilter] = useState("all");
  const [dragged, setDragged] = useState(null);
  const [dropPreview, setDropPreview] = useState(null);
  const busy = mutationBusy || Boolean(dropPreview);
  // Keep the accepted insertion visible while persistence is pending. Merge only
  // presentation order/category into live rows; incoming content stays current.
  function presentedItems(scope, items) {
    if (dropPreview?.scope !== scope) return items;
    const ranks = new Map(dropPreview.ids.map((id, index) => [id, index]));
    return items.map(item => ({ ...item, sort_order: ranks.get(item.id) ?? item.sort_order,
      ...(dropPreview.itemId === item.id && dropPreview.category !== undefined ? { category: dropPreview.category } : {}) }));
  }
  const presentedPersonal = presentedItems("personal", luggageItems);
  const presentedShared = presentedItems("shared", sharedLuggageItems);
  useEffect(() => {
    if (!dragged) return;
    function switchColumn(event) {
      if (!window.matchMedia("(max-width: 1000px)").matches || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      onTabChange?.(event.key === "ArrowLeft" ? "personal" : "shared");
    }
    document.addEventListener("keydown", switchColumn, true);
    return () => document.removeEventListener("keydown", switchColumn, true);
  }, [dragged, onTabChange]);
  const dragOriginTab = useRef(null);
  const dragSnapshot = useRef(null);
  const keyboardTarget = useRef(null);
  const pickupBounds = useRef(null);
  const boardRef = useRef(null);
  const dropGroupNodes = useRef(new WeakMap());
  const keyboardDrag = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: (event, args) => keyboardDestination(event, args, keyboardTarget), keyboardCodes: { start: ["Space"], end: ["Space", "Enter"], cancel: ["Escape", "Tab"] } }));
  const [collapsedGroups, setCollapsedGroups] = useState([]);
  const previousCategories = useRef(new Map());
  const rows = useRef(new Map()), previousEditor = useRef(null);
  const approved = members.filter(member => member.status === "approved");
  const byMember = new Map(approved.map(member => [member.user_id, member]));
  const assigned = sortLuggageItems(presentedShared.filter(item => item.assigned_to === currentUserId));
  // A successful write can update the projection before the controller closes
  // the editor. Keep its origin during that write instead of opening it twice.
  const sharedLocation = sharedEditorLocation === "personal" && (busy || assigned.some(item => item.id === editingSharedId)) ? "personal" : "shared";
  const myPacked = luggageItems.filter(item => item.packed).length + assigned.filter(item => item.packed_by_assignee).length;
  const categories = [...new Set([...categoryDefaults, ...luggageItems.map(item => item.category), ...sharedLuggageItems.map(item => item.category)].filter(Boolean))].map(value => ({ value, label: value }));
  const query = personalQuery.trim().toLocaleLowerCase();
  const personalFiltered = Boolean(query || personalFilter !== "all");
  const matchesQuery = item => !query || `${item.title}\n${item.notes || ""}`.toLocaleLowerCase().includes(query);
  const matchesPersonal = (item, packed) => matchesQuery(item)
    && (personalFilter === "all" || (personalFilter === "packed") === Boolean(packed));
  const shownPersonal = sortLuggageItems(presentedPersonal.filter(item => item.id === editingPersonalId || matchesPersonal(item, item.packed)));
  const shownAssigned = assigned.filter(item => item.id === editingSharedId && sharedLocation === "personal" || matchesPersonal(item, item.packed_by_assignee));
  const sharedFiltered = Boolean(query || sharedFilter !== "all");
  const shownShared = sortLuggageItems(presentedShared.filter(item => item.id === editingSharedId || matchesQuery(item) && (sharedFilter === "all" || (sharedFilter === "packed") === Boolean(item.packed_by_assignee))));
  const categoryOf = item => item.category?.trim() || "未分類";
  const personalGroups = [...new Set([...categoryDefaults, ...presentedPersonal.map(categoryOf), ...(dragged?.scope === "shared" ? ["未分類"] : [])])].map(category => ({ category, items: shownPersonal.filter(item => categoryOf(item) === category), all: presentedPersonal.filter(item => categoryOf(item) === category) })).filter(group => group.items.length || dragged?.scope === "shared");
  const isCollapsed = key => !personalFiltered && collapsedGroups.includes(key);
  function toggleGroup(key) { setCollapsedGroups(current => current.includes(key) ? current.filter(value => value !== key) : [...current, key]); }
  useEffect(() => {
    const next = new Map(luggageItems.map(item => [item.id, categoryOf(item)]));
    const reveal = new Set(luggageItems.filter(item => previousCategories.current.size && previousCategories.current.get(item.id) !== categoryOf(item)).map(categoryOf));
    previousCategories.current = next;
    if (reveal.size) setCollapsedGroups(current => current.filter(key => !reveal.has(key)));
  }, [luggageItems]);
  const memberGroups = new Map();
  for (const member of approved) memberGroups.set(member.user_id, []);
  for (const item of shownShared) {
    const key = item.assigned_to || "";
    if (!memberGroups.has(key)) memberGroups.set(key, []);
    memberGroups.get(key).push(item);
  }
  const memberOrder = [currentUserId, ...approved.map(member => member.user_id).filter(id => id !== currentUserId)];
  const rankMember = id => !id ? Number.MAX_SAFE_INTEGER : memberOrder.includes(id) ? memberOrder.indexOf(id) : memberOrder.length;
  const orderedGroups = [...memberGroups].filter(([, items]) => !sharedFiltered || items.length || dragged).sort(([a], [b]) => rankMember(a) - rankMember(b));
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
  useEffect(() => { setCollapsedGroups([]); setPersonalQuery(""); setPersonalFilter("all"); setSharedFilter("all"); }, [activeTrip?.id]);
  useEffect(() => {
    if (!assignmentNotice) return;
    const timer = setTimeout(() => setAssignmentNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [assignmentNotice]);
  useLayoutEffect(() => {
    const editing = editingPersonalId || (editingSharedId ? `${sharedLocation}:${editingSharedId}` : null);
    if (previousEditor.current && !editing && document.activeElement === document.body) {
      const row = rows.current.get(previousEditor.current);
      const fallback = document.querySelector(previousEditor.current.startsWith("personal:") ? '#lb-personal .lb-creation-mode' : '#lb-shared .lb-status-tabs button');
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

  function finishDrag() { setDragged(null); keyboardTarget.current = null; pickupBounds.current = null; }
  async function persistDrop(preview, action) {
    setDropPreview(preview);
    try {
      const result = await action();
      // Allow the parent's canonical snapshot to render before releasing the
      // presentation overlay, including asynchronous Formal refreshes.
      if (result?.ok) await new Promise(resolve => requestAnimationFrame(resolve));
      return result;
    } finally {
      if (mounted.current) setDropPreview(null);
    }
  }
  function cancelDrag() {
    finishDrag();
    if (dragOriginTab.current) onTabChange?.(dragOriginTab.current);
    dragOriginTab.current = null;
  }
  async function drop({ active, over }) {
    const data = active.data.current, target = over?.data.current;
    finishDrag();
    if (!data?.item || !target) { cancelDrag(); return; }
    const assignedTo = target.kind === "member" ? target.assignedTo : target.kind === "row" && target.scope === "shared" ? target.item.assigned_to : undefined;
    const changingAssignee = data.scope === "shared" && assignedTo !== undefined && (data.item.assigned_to || "") !== (assignedTo || "");
    if (changingAssignee || target.kind === "category" && data.scope === "shared" || target.kind === "member" && data.scope === "personal") {
      // dnd-kit suppresses document clicks for 50ms after pointer release.
      await new Promise(resolve => setTimeout(resolve, 60));
      if (!mounted.current) return;
    }
    if (target.kind === "row" && data.scope === target.scope) {
      if (data.item.id !== target.item.id) {
        const reorder = () => onReorder(data.scope, data.item, target.item, target.placement, dragSnapshot.current?.[data.scope]);
        const currentItems = data.scope === "personal" ? luggageItems : sharedLuggageItems;
        const ordered = currentItems.some(item => item.id === data.item.id) && currentItems.some(item => item.id === target.item.id)
          ? planLuggageOrder(currentItems, data.item.id, target.item.id, target.placement) : null;
        // Cross-member moves must still wait for the user's confirmation.
        const result = changingAssignee || !ordered ? await reorder() : await persistDrop({ scope: data.scope, ids: ordered.map(item => item.id), itemId: data.item.id,
          ...(data.scope === "personal" ? { category: target.item.category || "" } : {}) }, reorder);
        if (result?.ok) {
          const reassigned = data.scope === "shared" && (data.item.assigned_to || "") !== (target.item.assigned_to || "");
          setAssignmentNotice(reassigned ? target.item.assigned_to ? `已改由 ${memberLabel(byMember.get(target.item.assigned_to))} 攜帶` : "已取消指派，移至未指派群組" : "已更新物品順序");
          if (data.scope === "personal") setCollapsedGroups(current => current.filter(key => key !== (target.item.category || "未分類")));
          await new Promise(resolve => requestAnimationFrame(resolve));
          rows.current.get(data.personalProjection ? `personal:${data.item.id}` : data.scope === "shared" ? `shared:${data.item.id}` : data.item.id)?.querySelector(".lb-drag-handle")?.focus({ preventScroll: true });
        } else if (dragOriginTab.current) onTabChange?.(dragOriginTab.current);
      }
      dragOriginTab.current = null;
      return;
    }
    if (target.kind === "category" && data.scope === "personal") {
      if (target.category !== (data.item.category || "")) {
        setCollapsedGroups(current => current.filter(key => key !== (target.category || "未分類")));
        const result = await persistDrop({ scope: "personal", ids: sortLuggageItems(luggageItems).map(item => item.id), itemId: data.item.id, category: target.category }, () => onMovePersonal(data.item, target.category));
        if (result?.ok) {
          await new Promise(resolve => requestAnimationFrame(resolve));
          rows.current.get(data.item.id)?.querySelector(".lb-drag-handle")?.focus({ preventScroll: true });
        }
      }
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

  return <DndContext sensors={sensors} measuring={{ droppable: { strategy: MeasuringStrategy.Always } }} collisionDetection={args => {
    // Collapsing the source must not immediately turn its old footprint into
    // a new row/group insertion and reopen that space beneath a stationary pointer.
    if (args.pointerCoordinates && pickupBounds.current) {
      const { x, y } = args.pointerCoordinates, { rect, point, scrollContainer, scrollTop, windowTop } = pickupBounds.current;
      if (scrollContainer?.scrollTop === scrollTop && window.scrollY === windowTop && Math.hypot(x - point.x, y - point.y) < 24 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return [];
      pickupBounds.current = null;
    }
    // Read current viewport geometry directly, including animated space and scroll.
    // Refreshing dnd-kit's measured Rects every frame rebuilds scroll-ancestor
    // observers/styles and publishes React context updates for the entire list.
    const containers = [], droppableRects = new Map(), groupRects = new Map();
    for (const container of args.droppableContainers) {
      const node = container.node.current;
      if (!node) continue;
      let group = dropGroupNodes.current.get(node);
      if (!group?.isConnected) {
        group = node.closest(".lb-category-group,.lb-member-group") || node;
        dropGroupNodes.current.set(node, group);
      }
      let groupRect = groupRects.get(group);
      if (!groupRect) { groupRect = group.getBoundingClientRect(); groupRects.set(group, groupRect); }
      const pointer = args.pointerCoordinates;
      if (pointer && (pointer.x < groupRect.left || pointer.x > groupRect.right || pointer.y < groupRect.top || pointer.y > groupRect.bottom)) continue;
      const rect = node === group ? groupRect : node.getBoundingClientRect();
      if (!rect?.width || !rect.height) continue;
      containers.push(container); droppableRects.set(container.id, rect);
    }
    if (!args.pointerCoordinates && keyboardTarget.current && containers.some(container => container.id === keyboardTarget.current)) return [{ id: keyboardTarget.current }];
    const geometry = { ...args, droppableContainers: containers, droppableRects };
    const collisions = args.pointerCoordinates ? pointerWithin(geometry) : closestCenter(geometry);
    const row = collisions.find(hit => containers.find(container => container.id === hit.id)?.data.current?.kind === "row");
    return row ? [row] : collisions;
  }} accessibility={{ screenReaderInstructions: { draggable: "按空白鍵拿起物品，上下鍵選擇物品前後、分類或成員，空白鍵放置，Escape取消。私人與共用物品互轉時需確認。手機左右鍵切換個人與團隊頁籤。" }, announcements: {
    onDragStart: ({ active }) => `已拿起${active.data.current?.item.title || "物品"}`,
    onDragOver: ({ over }) => over?.data.current?.kind === "row" ? `放在${over.data.current.item.title}${over.data.current.placement === "before" ? "前面" : "後面"}` : undefined,
    onDragEnd: () => "已放下物品，正在確認操作結果",
    onDragCancel: () => "已取消移動，物品維持原位",
  } }} onDragOver={({ over }) => {
    if (!keyboardDrag.current && over?.data.current?.kind === "tab") onTabChange?.(over.data.current.tab);
  }} onDragStart={({ active, activatorEvent }) => {
    keyboardDrag.current = activatorEvent?.type === "keydown";
    dropGroupNodes.current = new WeakMap();
    keyboardTarget.current = null;
    dragSnapshot.current = { personal: luggageItems, shared: sharedLuggageItems };
    const data = active.data.current;
    const key = data.personalProjection ? `personal:${data.item.id}` : data.scope === "shared" ? `shared:${data.item.id}` : data.item.id;
    const node = rows.current.get(key), rect = node?.getBoundingClientRect() || active.rect.current.initial;
    const scrollContainer = node?.closest(".lb-list-body");
    pickupBounds.current = keyboardDrag.current ? null : { rect, point: { x: activatorEvent.clientX, y: activatorEvent.clientY }, scrollContainer, scrollTop: scrollContainer?.scrollTop, windowTop: window.scrollY };
    const style = node ? getComputedStyle(node) : null;
    setAssignmentNotice("");
    const board = node?.closest(".lb-board");
    setDragged({ ...data, listHeights: { personal: board?.querySelector("#lb-personal .lb-list-body")?.scrollHeight, shared: board?.querySelector("#lb-shared .lb-list-body")?.scrollHeight }, rowStyle: { width: rect?.width, height: rect?.height, "--lb-inset-start": style?.getPropertyValue("--lb-inset-start"), "--lb-inset-end": style?.getPropertyValue("--lb-inset-end") } }); dragOriginTab.current = activeTab;
  }} onDragCancel={cancelDrag} onDragEnd={drop}><LuggageDragLayout boardRef={boardRef}><section ref={boardRef} className={`panel luggage-panel travel-workspace lb-board${dragged ? " lb-layout-dragging" : ""}`} aria-label="行李清單">
    {error ? <p className="lb-error" role="alert">{typeof error === "string" ? error : "操作未完成，請重試。"}</p> : null}
    <span className="lb-sr-status" role="status" aria-label="共用物品指派結果">{assignmentNotice}</span>
    <div className="mobile-tabs lb-mobile-tabs" role="tablist" aria-label="行李清單類型" onKeyDown={navigateTabs}>
      {[['personal','個人行李'],['shared','共用物品']].map(([key, label]) => <LuggageTab key={key} tab={key} label={label} selected={activeTab === key} onChange={onTabChange} />)}
    </div>
    <div className="luggage-layout lb-layout">
      <section id="lb-personal" className={`luggage-column lb-personal${activeTab === "personal" ? " active" : ""}`} aria-label="個人行李">
        <header className="lb-column-heading"><h3><Luggage size={20} aria-hidden="true" />個人行李</h3><Progress label="我的準備進度" value={myPacked} total={luggageItems.length + assigned.length} /><PersonalTools query={personalQuery} setQuery={setPersonalQuery} filter={personalFilter} setFilter={setPersonalFilter} disabled={busy || Boolean(dragged)} /></header>
        <QuickAdd form={personalQuickForm} setForm={setPersonalQuickForm} categories={categories} members={approved} currentUserId={currentUserId} disabled={!canEdit || busy} onSubmit={async event => {
          const saved = await submitPersonalQuick(event);
          if (saved) {
            const shared = personalQuickForm.creation_scope === "shared";
            setCollapsedGroups(current => current.filter(key => key !== (shared ? "assigned" : personalQuickForm.category || "未分類")));
            if (shared) { setAssignmentNotice(`已新增共用物品，由 ${memberLabel(byMember.get(personalQuickForm.assigned_to || currentUserId))} 攜帶`); }
          }
          return saved;
        }} />
        <div className="lb-list-body" tabIndex={0} aria-label="個人行李清單">
          <div className="lb-list-content" style={{ minHeight: dragged?.listHeights.personal }}>
          {shownAssigned.length ? <PersonalGroup label="我負責的共用物品" shared count={assigned.length} packed={assigned.filter(item => item.packed_by_assignee).length} collapsed={isCollapsed("assigned") && !(editingSharedId && sharedLocation === "personal")} toggle={() => toggleGroup("assigned")}><div className="assigned-shared-list lb-assigned">{shownAssigned.map(item => sharedRow(item, true))}</div></PersonalGroup> : null}
          {personalGroups.length ? <div className="luggage-list lb-private-list">{personalGroups.map(group => <PersonalGroup key={group.category} label={group.category} count={group.all.length} packed={group.all.filter(item => item.packed).length} collapsed={isCollapsed(group.category) && !group.items.some(item => item.id === editingPersonalId)} toggle={() => toggleGroup(group.category)}>{group.items.map(item => {
            const locked = isLockedByAnotherUser(item, currentUserId);
            return <DraggableRow item={item} disabled={!canEdit || busy || locked} draggingDisabled={Boolean(editingPersonalId || editingSharedId)} categories={categories} onMove={movePersonal} rowRef={node => { if (node) rows.current.set(item.id, node); else rows.current.delete(item.id); }} className={`luggage-row lb-private-row${item.packed ? " packed" : ""}${editingPersonalId === item.id ? " is-editing" : ""}`} key={item.id}>{editingPersonalId === item.id
              ? <><PackCheck title={item.title} checked={item.packed} disabled /><InlineEditor focusNotes={focusNotes} item={item} form={personalForm} setForm={setPersonalForm} categories={categories} disabled={!canEdit || busy} onSubmit={submitPersonal} onCancel={cancelPersonalEdit} onDelete={onDeletePersonal} /></>
              : <><PackCheck title={item.title} checked={item.packed} disabled={!canEdit || busy || locked} onChange={() => onTogglePersonal(item)} /><ItemFields item={item} disabled={!canEdit || busy || locked} onName={() => { setFocusNotes(false); editPersonal(item); }} onNotes={() => { setFocusNotes(true); editPersonal(item); }} />{locked ? <LockKeyhole size={12} aria-label="其他成員編輯中" /> : null}</>}</DraggableRow>;
          })}</PersonalGroup>)}</div> : !shownAssigned.length ? <Empty filtered={personalFiltered} /> : null}
          </div>
        </div>
      </section>
      <section id="lb-shared" className={`luggage-column lb-shared${activeTab === "shared" ? " active" : ""}`} aria-label="共用物品">
        <header className="lb-column-heading"><h3><Users size={20} aria-hidden="true" />共用物品</h3><Progress label="成員已備妥" value={sharedLuggageItems.filter(item => item.packed_by_assignee).length} total={sharedLuggageItems.length} /><SharedTools filter={sharedFilter} setFilter={setSharedFilter} disabled={busy || Boolean(dragged)} /></header>
        <div className="lb-list-body" tabIndex={0} aria-label="共用物品清單">
          <div className="lb-list-content" style={{ minHeight: dragged?.listHeights.shared }}>
          {!shownShared.length && sharedFiltered && !dragged ? <Empty filtered /> : null}<div className="luggage-list">{orderedGroups.map(([memberId, items]) => {
            const member = byMember.get(memberId);
            const name = member ? `${memberLabel(member)}${memberId === currentUserId ? "（我）" : ""}` : memberId ? "需重新指派" : "未指派";
            return <MemberSlot key={memberId} {...{ memberId, name, member, items }} all={sharedLuggageItems.filter(item => (item.assigned_to || "") === memberId)} canReceive={canEdit && !busy && Boolean(member || !memberId)}>{items.map(item => sharedRow(item, false))}</MemberSlot>; })}</div>
          </div>
        </div>
      </section>
    </div>
  </section><DragOverlay dropAnimation={null} zIndex={70} style={{ pointerEvents: "none" }}>{dragged ? <DraggedItemRow dragged={dragged} currentUserId={currentUserId} /> : null}</DragOverlay></LuggageDragLayout></DndContext>;
}
