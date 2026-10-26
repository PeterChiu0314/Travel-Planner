import { luggageNotesLimit } from "../../lib/luggageLimits.js";
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDndContext, useDraggable, useDroppable } from "@dnd-kit/core";
import { GripVertical, StickyNote, X } from "lucide-react";
import MenuSelect from "../MenuSelect.jsx";

export function useAnchoredPopup(open, trigger, popup, close, compact = false) {
  const [position, setPosition] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(compact ? 200 : 320, innerWidth - 24), height = popup.current?.offsetHeight || 200;
      setPosition({ width, left: Math.max(12, Math.min(compact ? rect.right + 6 : rect.right - width, innerWidth - width - 12)), top: rect.bottom + height + 6 < innerHeight ? rect.bottom + 6 : Math.max(12, rect.top - height - 6) });
    }
    place(); window.addEventListener("resize", place); document.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); document.removeEventListener("scroll", place, true); };
  }, [open, trigger, popup, compact]);
  useEffect(() => {
    if (!open) return;
    function outside(event) {
      if (!trigger.current?.contains(event.target) && !popup.current?.contains(event.target) && !event.target.closest?.(".menu-select-popup")) close();
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, close, trigger, popup]);
  return position;
}

export function QuickNote({ value, onChange, disabled, kind }) {
  const [open, setOpen] = useState(false), trigger = useRef(null), popup = useRef(null), input = useRef(null), id = useId();
  const position = useAnchoredPopup(open, trigger, popup, () => setOpen(false));
  useEffect(() => { if (open) input.current?.focus({ preventScroll: true }); }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  function close() { setOpen(false); trigger.current?.focus({ preventScroll: true }); }
  return <><button ref={trigger} type="button" className={`lb-note-toggle${value ? " has-note" : ""}`} disabled={disabled} aria-label={`新增${kind}備註`} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}><StickyNote size={16} /></button>
    {open ? createPortal(<div ref={popup} id={id} style={position} className="lb-note-popup" role="dialog" aria-label={`新增${kind}備註`} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    }}><header><strong>新增備註（選填）</strong><button type="button" aria-label="關閉備註" onClick={close}><X size={15} /></button></header>
      <textarea ref={input} aria-label={`${kind}新增備註內容`} maxLength={luggageNotesLimit} value={value || ""} disabled={disabled} onChange={event => onChange(event.target.value)} />
      <small>與物品一起新增</small>
    </div>, document.body) : null}</>;
}

export function InsertionGhost({ item, className = "", style }) {
  return <div className={`lb-insertion-ghost ${className}`} style={style} aria-hidden="true"><GripVertical size={15} /><span className="lb-ghost-check" /><div className="lb-row-fields"><span>{item.title}</span><span>{item.notes || ""}</span></div></div>;
}

// Group append space stays mounted so both opening and closing affect real layout.
export function GroupInsertion({ active, visible }) {
  const height = active?.rect.current.initial?.height || 36;
  return <div className="lb-group-insertion" style={{ height: visible ? height : 0 }}>
    {visible ? <InsertionGhost item={active.data.current.item} className="lb-group-ghost" style={{ "--lb-row-height": `${height}px` }} /> : null}
  </div>;
}

const SourceSpaceContext = createContext(false);
const DragStateContext = createContext({ active: null, over: null });
export const luggageDropResizeObserver = { disabled: true };
export function useLuggageDragState() { return useContext(DragStateContext); }

function useSynchronizedSpaceMotion(boardRef, active, overId, reserveSource, children) {
  const destinations = useRef(new Map()), animations = useRef(new Map());
  useLayoutEffect(() => {
    const nodes = [...(boardRef.current?.querySelectorAll(".lb-sortable-slot,.lb-group-insertion") || [])];
    const next = new Map(nodes.map(node => {
      const gap = parseFloat(node.style.getPropertyValue("--lb-row-height")) || 0;
      return [node, { height: `${parseFloat(node.style.height) || (node.style.height ? 0 : node.offsetHeight)}px`,
        paddingTop: `${node.classList.contains("lb-slot-before") ? gap : 0}px`,
        paddingBottom: `${node.classList.contains("lb-slot-after") ? gap : 0}px` }];
    }));
    const changed = nodes.some(node => {
      const before = destinations.current.get(node), after = next.get(node);
      return before && Object.keys(after).some(key => before[key] !== after[key]);
    });
    if (!active || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      animations.current.forEach(animation => animation.cancel()); animations.current.clear();
    } else if (changed) {
      // Capture every moving space before cancelling anything. CSS transitions
      // shorten reversals independently, so their heights stop adding up when a
      // pointer crosses multiple insertions before the previous motion finishes.
      const moving = nodes.filter(node => {
        const before = destinations.current.get(node), after = next.get(node);
        return animations.current.get(node)?.playState === "running" || before && Object.keys(after).some(key => before[key] !== after[key]);
      });
      const visible = new Set(moving.filter(node => node.getClientRects().length));
      const starts = new Map(moving.map(node => {
        const animation = animations.current.get(node), previous = destinations.current.get(node);
        if (!animation || animation.playState === "finished") return [node, previous || next.get(node)];
        const style = getComputedStyle(node);
        return [node, { height: style.height, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom }];
      }));
      animations.current.forEach(animation => animation.cancel()); animations.current.clear();
      const startTime = document.timeline.currentTime;
      for (const node of moving) {
        const from = starts.get(node), to = next.get(node);
        if (!visible.has(node) || Object.keys(to).every(key => Math.abs(parseFloat(from[key]) - parseFloat(to[key])) < .01)) continue;
        const animation = node.animate([from, to], { duration: 200, easing: "cubic-bezier(.22,.68,0,1)" });
        animation.startTime = startTime;
        animations.current.set(node, animation);
      }
    }
    destinations.current = next;
  }, [boardRef, active?.id, overId, reserveSource, children]);
  useLayoutEffect(() => () => { animations.current.forEach(animation => animation.cancel()); }, []);
}

// Overlay pickup does not change list geometry. Transfer the one row-sized space
// only when a real insertion is rendered, in the same commit as that insertion.
export function LuggageDragLayout({ children, boardRef }) {
  const { active, over } = useDndContext();
  // Pointer/collision updates need not rebuild every row when the selected
  // destination is unchanged. Only publish the UI state that rows actually use.
  const dragState = useMemo(() => ({ active, over }), [active, over]);
  const source = active?.data.current, target = over?.data.current;
  const hasDestination = Boolean(source && (
    target?.kind === "row" && target.item.id !== source.item.id ||
    target?.kind === "category" && (source.scope !== "personal" || (source.item.category?.trim() || "") !== target.category) ||
    target?.kind === "member" && (source.scope !== "shared" || (source.item.assigned_to || "") !== target.assignedTo)
  ));
  const [transferredId, setTransferredId] = useState(null);
  const reserveSource = Boolean(active && transferredId !== active.id && !hasDestination);
  useSynchronizedSpaceMotion(boardRef, active, over?.id, reserveSource, children);
  useLayoutEffect(() => {
    if (!active) setTransferredId(null);
    else if (hasDestination) setTransferredId(active.id);
  }, [active?.id, hasDestination]);
  return <DragStateContext.Provider value={dragState}><SourceSpaceContext.Provider value={reserveSource}>{children}</SourceSpaceContext.Provider></DragStateContext.Provider>;
}

export function DraggableRow({ scope = "personal", personalProjection = false, item, disabled, draggingDisabled, categories = [], onMove, rowRef, className, children }) {
  const { active, over } = useLuggageDragState();
  const idPrefix = `${personalProjection ? "assigned" : scope}:${item.id}`;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: idPrefix, data: { item, scope, personalProjection }, disabled: disabled || draggingDisabled });
  const isSource = active?.data.current?.scope === scope && active.data.current.item.id === item.id;
  const reserveSource = useContext(SourceSpaceContext);
  const collapseSource = isSource && !reserveSource;
  const elementRef = useRef(null), sourceRef = useRef(isSource);
  sourceRef.current = isSource;
  const [rowHeight, setRowHeight] = useState(null);
  useLayoutEffect(() => {
    const element = elementRef.current;
    const measure = () => {
      const height = element?.offsetHeight;
      // Inactive mobile columns are display:none; do not cache a zero row size.
      if (!sourceRef.current && height > 0) setRowHeight(previous => height === previous ? previous : height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (element) observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const dropDisabled = disabled || draggingDisabled || isSource || Boolean(active && active.data.current?.scope !== scope);
  const before = useDroppable({ id: `before:${idPrefix}`, data: { kind: "row", scope, item, placement: "before", idPrefix }, disabled: dropDisabled, resizeObserverConfig: luggageDropResizeObserver });
  const after = useDroppable({ id: `after:${idPrefix}`, data: { kind: "row", scope, item, placement: "after", idPrefix }, disabled: dropDisabled, resizeObserverConfig: luggageDropResizeObserver });
  const placement = active && active.data.current?.item.id !== item.id && !isDragging && over?.data.current?.idPrefix === idPrefix ? over.data.current.placement : null;
  const height = active?.rect.current.initial?.height || 36;
  const [open, setOpen] = useState(false), trigger = useRef(null), popup = useRef(null), draggedAt = useRef(0), id = useId();
  const position = useAnchoredPopup(open, trigger, popup, () => setOpen(false), true);
  useLayoutEffect(() => {
    if (isDragging) draggedAt.current = Infinity;
    else if (draggedAt.current === Infinity) draggedAt.current = Date.now();
  }, [isDragging]);
  useEffect(() => { if (open) popup.current?.querySelector("button")?.focus({ preventScroll: true }); }, [open]);
  const setRowNode = useCallback(node => { setNodeRef(node); elementRef.current = node; rowRef(node); }, [setNodeRef, rowRef]);
  const setHandleNode = useCallback(node => { setActivatorNodeRef(node); trigger.current = node; }, [setActivatorNodeRef]);
  return <div className={`lb-sortable-slot${isSource ? " lb-source-hidden" : ""}${collapseSource ? " lb-source-collapsed" : ""}${placement ? ` lb-slot-${placement}` : ""}`} style={{ "--lb-row-height": `${height}px`, "--lb-item-height": `${rowHeight || height}px`, height: collapseSource ? 0 : rowHeight == null ? undefined : rowHeight + (placement ? height : 0) }} aria-hidden={isSource || undefined}>
    <span ref={before.setNodeRef} className="lb-row-drop lb-row-drop-before" aria-hidden="true" /><span ref={after.setNodeRef} className="lb-row-drop lb-row-drop-after" aria-hidden="true" />
    {placement ? <InsertionGhost item={active.data.current.item} className={`lb-ghost-${placement}`} /> : null}
    <article data-item-id={item.id} ref={setRowNode} className={`${className} lb-draggable-row${isDragging ? " is-dragging" : ""}${placement === "before" ? " lb-insert-before" : ""}${placement === "after" ? " lb-insert-after" : ""}`}>
    <button {...attributes} {...listeners} ref={setHandleNode} type="button" className="lb-drag-handle" aria-disabled={disabled} disabled={disabled} aria-label={`${personalProjection ? "調整指派共用物品順序" : scope === "shared" ? "拖曳指派共用物品" : "移動分類"}：${item.title}`} title="拖曳至物品前後調整順序；空白鍵拿起，方向鍵選位置，空白鍵放置；可拖至分類或成員區" aria-expanded={scope === "personal" ? open : undefined} aria-controls={open ? id : undefined} onClick={() => { if (scope === "personal" && Date.now() - draggedAt.current > 250) setOpen(!open); }}><GripVertical size={15} /></button>
    {children}
    {open ? createPortal(<div ref={popup} id={id} style={position} className="lb-note-popup lb-move-popup" role="dialog" aria-label={`移動分類：${item.title}`} onKeyDown={event => { if (event.key === "Escape" && !popup.current?.querySelector('[aria-expanded="true"]')) { event.preventDefault(); setOpen(false); trigger.current?.focus(); } }}>
      <strong>移至分類</strong><MenuSelect label={`移動${item.title}至分類`} value={item.category || ""} options={[{ value: "", label: "未分類" }, ...categories]} onValueChange={async category => { if (category === (item.category || "") || (await onMove(item, category))?.ok) { setOpen(false); trigger.current?.focus({ preventScroll: true }); } }} />
    </div>, document.body) : null}
  </article></div>;
}
