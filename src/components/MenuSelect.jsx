import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

// Uses the established Timeline menu surface and option styles. Portal keeps
// menus clear of the independently scrolling Budget panels.
export default function MenuSelect({ label, value, options, onValueChange, editable = false, placeholder, className = "", popupClassName = "", disabled = false }) {
  const id = useId();
  const root = useRef(null), menu = useRef(null), control = useRef(null);
  const [open, setOpen] = useState(false), [position, setPosition] = useState(null), [active, setActive] = useState(0);
  const [filter, setFilter] = useState("");
  const shown = editable && filter ? options.filter((option) => option.label.toLowerCase().includes(filter.toLowerCase())) : options;
  const selected = options.find((option) => String(option.value) === String(value));
  function show() {
    if (disabled) return;
    setFilter("");
    setActive(Math.max(0, options.findIndex((option) => String(option.value) === String(value))));
    setOpen(true);
  }
  function choose(option) {
    if (disabled || !option) return;
    onValueChange(option.value); setOpen(false); setFilter(""); control.current?.focus();
  }
  useLayoutEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = root.current.getBoundingClientRect();
      const width = Math.min(rect.width, window.innerWidth - 16);
      const roomBelow = window.innerHeight - rect.bottom - 8, roomAbove = rect.top - 8;
      const above = roomBelow < 160 && roomAbove > roomBelow;
      const maxHeight = Math.min(208, Math.max(60, above ? roomAbove - 5 : roomBelow - 5));
      setPosition({ position: "fixed", left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), width,
        top: above ? "auto" : rect.bottom + 5, bottom: above ? window.innerHeight - rect.top + 5 : "auto", maxHeight, right: "auto", zIndex: 100 });
    }
    place();
    function outside(event) {
      if (!root.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false);
    }
    function scroll(event) { if (!menu.current?.contains(event.target)) place(); }
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", scroll);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("scroll", scroll, true); window.removeEventListener("resize", scroll); };
  }, [open]);
  useLayoutEffect(() => {
    if (open) menu.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, position]);
  function keyDown(event) {
    if (disabled) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
    if (event.key === "Tab") { setOpen(false); return; }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (!open) { show(); return; }
      setActive((current) => event.key === "Home" ? 0 : event.key === "End" ? shown.length - 1 : Math.max(0, Math.min(shown.length - 1, current + (event.key === "ArrowDown" ? 1 : -1))));
    }
    if (event.key === "Enter" || !editable && event.key === " ") { event.preventDefault(); if (open) choose(shown[active]); else show(); }
  }
  const aria = { role: "combobox", "aria-label": label, "aria-expanded": open, "aria-haspopup": "listbox", "aria-controls": open ? id : undefined,
    "aria-activedescendant": open && shown[active] ? `${id}-${active}` : undefined };
  return <div className={`menu-select ${className}`} ref={root} onKeyDown={keyDown} onBlur={(event) => {
    if (!root.current?.contains(event.relatedTarget) && !menu.current?.contains(event.relatedTarget)) setOpen(false);
  }}>
    {editable ? <div className="menu-select-editable"><input {...aria} placeholder={placeholder} disabled={disabled} ref={control} value={value} onClick={() => { if (!open) show(); }} onChange={(event) => { onValueChange(event.target.value); setFilter(event.target.value); setActive(0); setOpen(true); }} /><button type="button" aria-label={`開啟${label}選單`} disabled={disabled} tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onClick={() => open ? setOpen(false) : show()}><ChevronDown size={15} /></button></div>
      : <button {...aria} disabled={disabled} ref={control} className="menu-select-trigger" type="button" onClick={() => open ? setOpen(false) : show()}><span>{selected?.label || value || "未指定"}</span><ChevronDown size={15} /></button>}
    {open && position ? createPortal(<div id={id} ref={menu} className={`timeline-time-menu timeline-type-menu menu-select-popup ${popupClassName}`} role="listbox" aria-label={`${label}選項`} style={position}>
      {shown.map((option, index) => <button key={option.value} id={`${id}-${index}`} data-index={index} type="button" role="option" aria-selected={String(option.value) === String(value)} className={`${String(option.value) === String(value) ? "selected" : ""}${index === active ? " keyboard-active" : ""}`} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}>{option.label}</button>)}
      {!shown.length ? <div className="menu-select-empty">可直接輸入自訂分類</div> : null}
    </div>, document.body) : null}
  </div>;
}
