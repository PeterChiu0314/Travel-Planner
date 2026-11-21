import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export function BodyPortal({ children }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

export function FloatingOutlinedField({ children, className = "", label }) {
  return (
    <div className={`floating-outlined-field${className ? ` ${className}` : ""}`}>
      {children}
      <span aria-hidden="true" className="floating-outlined-label">{label}</span>
    </div>
  );
}

export function AutoGrowingTextarea({ value, ...textareaProps }) {
  const textareaRef = useRef(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const textareaStyle = window.getComputedStyle(textarea);
    const minimumHeight = Number.parseFloat(textareaStyle.minHeight) || 60;
    const maximumHeight = Number.parseFloat(textareaStyle.maxHeight) || 118;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, minimumHeight), maximumHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maximumHeight ? "auto" : "hidden";
  }, [value]);

  return <textarea {...textareaProps} ref={textareaRef} value={value} />;
}
