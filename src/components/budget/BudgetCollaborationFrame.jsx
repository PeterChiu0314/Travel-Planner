import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { collaboratorColor } from '../../lib/collaboratorColors.js';

// Uses the same per-account palette and outline/tooltip styles as Budget rows.
export default function BudgetCollaborationFrame({ ownerId, ownerName, label, children, className = '', onFocusCapture, onBlur, ...props }) {
  const id = useId(), [position, setPosition] = useState(null);
  const description = ownerId ? `${ownerName} 正在編輯${label}` : '';
  const show = event => {
    const rect = event.currentTarget.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 260)), top: Math.max(8, rect.top - 35) });
  };
  return <div {...props} className={`bw-metadata-group ${className}${ownerId ? ' has-collaborators' : ''}`}
    aria-describedby={ownerId ? id : undefined}
    onMouseEnter={show} onMouseLeave={event => { if (!event.currentTarget.contains(document.activeElement)) setPosition(null); }}
    onFocusCapture={event => { show(event); onFocusCapture?.(event); }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPosition(null); onBlur?.(event); }}>
    {ownerId ? <span className="bw-collaboration-outline" aria-hidden="true" data-user={ownerId} style={{ inset: '1px', '--bw-remote-color': collaboratorColor(ownerId) }} /> : null}
    {children}
    {ownerId ? createPortal(<div id={id} role="tooltip" className="bw-collaboration-tooltip" hidden={!position} style={position || { display: 'none' }}>
      <span><i style={{ background: collaboratorColor(ownerId) }} />{description}</span>
    </div>, document.body) : null}
  </div>;
}
