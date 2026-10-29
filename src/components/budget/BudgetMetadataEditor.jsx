import { useEffect, useMemo, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { memberLabel } from "../../lib/budgetFinance.js";

// Shares the same narrow editor in Formal and memory-only Demo. No autosave in B-2.
export default function BudgetMetadataEditor({ client, record, kind, members, services, onClose, onLegacy }) {
  const version = useSyncExternalStore(client.subscribe, client.getVersion);
  const fields = [client.get(kind, record.id, "title"), client.get(kind, record.id, "note")];
  const views = fields.map(g => client.view(g));
  const { message, verified, editable } = client.status();
  const busy = views.some(g => g.saving);
  const hasDraft = views.some(g => g.dirty || g.request || g.saving);
  const saveAll = async () => { for (const g of fields) if ((client.view(g).dirty || g.request) && !(await client.save(g))) return false; return true; };
  const discardAll = async () => { for (const g of fields) if (!(await client.discard(g))) return false; return true; };
  services.useGuard(`budget-metadata:${kind}:${record.id}:${record.trip_id}`, useMemo(() => ({ isActive: true,
    isDirty: hasDraft, save: saveAll, discard: discardAll }), [client, record.id, kind, version, hasDraft]));
  useEffect(() => {
    const captured = fields;
    return () => { for (const g of captured) void client.release(g); };
  }, [client, record.id, kind]);
  return <section className="bw-editor bw-metadata-editor" aria-label={kind === "actual" ? "實付群組編輯" : "預算群組編輯"}>
    <div className="bw-detail-heading"><h3>編輯{kind === "actual" ? "實付" : "預算"}</h3>
      <button className="bw-icon" type="button" aria-label="關閉編輯" disabled={busy} onClick={onClose}><X size={17} /></button></div>
    <p className="bw-muted">名稱與備註可分別編輯，變更後請逐欄儲存。</p>
    {message ? <p className="bw-warning" role="status">{message}<button className="ghost-button compact" type="button" onClick={() => void client.refresh()}>重新整理</button></p> : null}
    {views.map((g, index) => {
      const field = fields[index], title = g.group === "title", label = title ? "項目名稱" : "備註";
      const hintId = `metadata-${kind}-${record.id}-${g.group}`;
      const owner = g.remote?.held && !g.remote.own_session ? memberLabel(members.find(m => m.user_id === g.remote.owner_id)) : null;
      const text = !editable ? "目前沒有編輯權限" : !verified ? "協作狀態尚未確認" : !g.supported ? "此項目尚未支援分欄編輯，請使用完整項目編輯"
        : !g.ready ? "群組資料尚未確認" : g.request && !g.saving ? "儲存結果待確認，請重試原請求"
        : g.saving ? "儲存中…" : g.state === "pending" ? "正在取得編輯權，輸入暫存中…" : owner ? `${owner} 正在編輯${label}`
        : g.conflict ? "遠端已更新；本機草稿仍保留" : g.dirty ? "尚未儲存" : g.saved ? "已儲存" : g.writable ? "可編輯" : "聚焦後取得編輯權";
      const input = { id: `${hintId}-input`, name: g.group, value: verified || g.dirty ? g.display : record[g.group] || "",
        readOnly: !g.acceptsIntent, "aria-readonly": !g.acceptsIntent, "aria-busy": g.state === "pending" || g.saving,
        "aria-describedby": hintId, onFocus: () => { void client.focus(field); },
        onChange: event => client.input(field, event.target.value) };
      return <div key={g.group} className={`bw-metadata-group${owner || !g.acceptsIntent ? " is-readonly" : ""}`}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) client.blur(field); }}>
        <label htmlFor={input.id}>{label}</label>
        {title ? <input {...input} /> : <textarea {...input} rows={4} />}
        <span id={hintId} className="bw-metadata-status" role="status" aria-live="polite">{text}</span>
        {g.error ? <p role="alert" className="bw-warning">{g.error}</p> : null}
        <div className="bw-metadata-actions">
          <button type="button" className="primary-button compact" disabled={g.saving || !g.request && (!g.writable || !g.dirty)} onClick={() => void client.save(field)}>
            {g.request && !g.saving ? "確認儲存結果" : `儲存${title ? "名稱" : "備註"}`}</button>
          {!g.writable && !g.request && editable && verified && g.supported && g.ready && !g.conflict ? <button type="button" className="ghost-button compact" disabled={g.state === "pending" || g.releasing}
            onClick={() => void client.focus(field)}>重新確認編輯權</button> : null}
          {g.dirty || g.conflict || g.releasing ? <button type="button" className="ghost-button compact" disabled={g.saving || Boolean(g.request)} onClick={() => void client.discard(field)}>捨棄此欄草稿</button> : null}
        </div>
      </div>;
    })}
    <div className="bw-metadata-summary"><span>分類 · {record.category || "其他"}</span><span>金額 · {record.currency} {record.amount}</span></div>
    <button type="button" className="ghost-button" disabled={busy || !editable} onClick={onLegacy}>編輯完整項目</button>
  </section>;
}
