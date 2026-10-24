import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDraggable } from "@dnd-kit/core";
import { GripVertical, StickyNote, X } from "lucide-react";
import MenuSelect from "../MenuSelect.jsx";

function useAnchoredPopup(open, trigger, popup, close) {
  const [position, setPosition] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, innerWidth - 24), height = popup.current?.offsetHeight || 200;
      setPosition({ width, left: Math.max(12, Math.min(rect.right - width, innerWidth - width - 12)), top: rect.bottom + height + 6 < innerHeight ? rect.bottom + 6 : Math.max(12, rect.top - height - 6) });
    }
    place(); window.addEventListener("resize", place); document.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); document.removeEventListener("scroll", place, true); };
  }, [open, trigger, popup]);
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
      <textarea ref={input} aria-label={`${kind}新增備註內容`} maxLength={1000} value={value || ""} disabled={disabled} onChange={event => onChange(event.target.value)} />
      <small>與物品一起新增</small>
    </div>, document.body) : null}</>;
}

export function DraggableRow({ scope = "personal", item, disabled, draggingDisabled, categories = [], onMove, rowRef, className, children }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: `${scope}:${item.id}`, data: { item, scope }, disabled: disabled || draggingDisabled });
  const [open, setOpen] = useState(false), trigger = useRef(null), popup = useRef(null), draggedAt = useRef(0), id = useId();
  const position = useAnchoredPopup(open, trigger, popup, () => setOpen(false));
  useLayoutEffect(() => {
    if (isDragging) draggedAt.current = Infinity;
    else if (draggedAt.current === Infinity) draggedAt.current = Date.now();
  }, [isDragging]);
  useEffect(() => { if (open) popup.current?.querySelector("button")?.focus({ preventScroll: true }); }, [open]);
  return <article ref={node => { setNodeRef(node); rowRef(node); }} className={`${className} lb-draggable-row${isDragging ? " is-dragging" : ""}`}>
    <button {...attributes} {...listeners} ref={node => { setActivatorNodeRef(node); trigger.current = node; }} type="button" className="lb-drag-handle" aria-disabled={disabled} disabled={disabled} aria-label={`${scope === "shared" ? "拖曳指派共用物品" : "移動分類"}：${item.title}`} title={scope === "shared" ? "拖曳至成員區指派；空白鍵開始，方向鍵選目標，空白鍵放置" : "拖曳至分類，或拖至成員區轉為共用物品；空白鍵拖曳，點擊選分類"} aria-expanded={scope === "personal" ? open : undefined} aria-controls={open ? id : undefined} onClick={() => { if (scope === "personal" && Date.now() - draggedAt.current > 250) setOpen(!open); }}><GripVertical size={15} /></button>
    {children}
    {open ? createPortal(<div ref={popup} id={id} style={position} className="lb-note-popup lb-move-popup" role="dialog" aria-label={`移動分類：${item.title}`} onKeyDown={event => { if (event.key === "Escape" && !popup.current?.querySelector('[aria-expanded="true"]')) { event.preventDefault(); setOpen(false); trigger.current?.focus(); } }}>
      <strong>移至分類</strong><MenuSelect label={`移動${item.title}至分類`} value={item.category || ""} options={[{ value: "", label: "未分類" }, ...categories]} onValueChange={async category => { if (category === (item.category || "") || (await onMove(item, category))?.ok) { setOpen(false); trigger.current?.focus({ preventScroll: true }); } }} />
    </div>, document.body) : null}
  </article>;
}
