import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Promise-based prompts keep persistence behind an explicit site-styled choice.
export function useSiteDialog() {
  const [request, setRequest] = useState(null);
  const pending = useRef(null);
  const ask = useCallback(options => {
    if (pending.current) return Promise.resolve(false);
    return new Promise(resolve => { pending.current = resolve; setRequest(options); });
  }, []);
  const choose = useCallback(value => {
    const resolve = pending.current;
    pending.current = null;
    setRequest(null);
    resolve?.(value);
  }, []);
  useEffect(() => () => { pending.current?.(false); pending.current = null; }, []);
  return { ask, dialog: request ? <SiteDialog request={request} choose={choose} /> : null };
}

function SiteDialog({ request, choose }) {
  const titleId = useId(), descriptionId = useId(), card = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    card.current?.querySelector("button")?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus?.({ preventScroll: true }); };
  }, []);
  return createPortal(<div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) choose(false); }}>
    <div ref={card} className="dialog-card site-prompt" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); choose(false); }
      if (event.key === "Tab") {
        const buttons = [...card.current.querySelectorAll("button")];
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
      <h2 id={titleId}>{request.title}</h2>
      <p id={descriptionId}>{request.message}</p>
      <div className="form-actions">
        {!request.notice ? <button className="ghost-button" type="button" onClick={() => choose(false)}>取消</button> : null}
        <button className={request.danger ? "primary-button compact site-prompt-danger" : "primary-button compact"} type="button" onClick={() => choose(true)}>{request.confirmLabel || "確定"}</button>
      </div>
    </div>
  </div>, document.body);
}
