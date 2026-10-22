import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { money } from "../../lib/budgetFinance.js";
import "./travel-workspace.css";

export const workspaceMoney = (value) => `NT$ ${money(value)}`;

export function WorkspaceHeading({ title, description, action, children }) {
  return <div className="travel-workspace-heading"><div><h3>{title}</h3><p>{description}</p></div>{children}{action ? <button className="primary-button compact" disabled={action.disabled} type="button" onClick={action.onClick}><Plus size={16} aria-hidden="true" />{action.label}</button> : null}</div>;
}

export function WorkspaceSummary({ items }) {
  return <div className="travel-workspace-summary">{items.map(({ label, value, detail }) => <div key={label}><span>{label}</span><strong>{value}</strong>{detail ? <small>{detail}</small> : null}</div>)}</div>;
}

export function WorkspaceSearch({ label, placeholder, value, onChange }) {
  return <label className="travel-workspace-search"><Search size={16} aria-hidden="true" /><input aria-label={label} placeholder={placeholder || label} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

export function WorkspaceActions({ name, disabled, onEdit, onDelete }) {
  return <div className="member-actions travel-workspace-actions"><button className="mini-button" aria-label={`編輯：${name}`} title="編輯" disabled={disabled} type="button" onClick={onEdit}><Pencil size={15} aria-hidden="true" /></button><button className="mini-button" aria-label={`刪除：${name}`} title="刪除" disabled={disabled} type="button" onClick={onDelete}><Trash2 size={15} aria-hidden="true" /></button></div>;
}

export function WorkspaceProgress({ label, value, total }) {
  return <div className="travel-workspace-progress"><div><span>{label}</span><strong>{value} / {total}</strong></div><progress aria-label={label} value={value} max={total || 1} /></div>;
}
