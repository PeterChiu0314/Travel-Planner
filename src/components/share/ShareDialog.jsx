import { useMemo, useState } from "react";
import { supabase } from "../../lib/supabase.js";

export default function ShareDialog({ canManage = false, links, onClose, onRefresh, trip }) {
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState("");
  const [error, setError] = useState("");
  const primaryLink = useMemo(
    () =>
      [...links].sort((a, b) => {
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
        return (b.created_at || "").localeCompare(a.created_at || "");
      })[0] || null,
    [links],
  );

  async function copyShareUrl(token, id) {
    const url = `${window.location.origin}?share=${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setError("");
    } catch {
      setError("無法複製分享連結，請手動複製網址。");
    }
  }

  async function createShareLink() {
    if (!canManage) return;
    setBusy(true);
    setError("");
    if (primaryLink) {
      if (!primaryLink.is_active) {
        const { error: updateError } = await supabase
          .from("share_links")
          .update({ is_active: true })
          .eq("id", primaryLink.id);
        if (updateError) {
          setBusy(false);
          setError(updateError.message);
          return;
        }
        await onRefresh();
      }
      setBusy(false);
      await copyShareUrl(primaryLink.token, primaryLink.id);
      return;
    }
    const token = crypto.randomUUID();
    const { error } = await supabase.from("share_links").insert({
      trip_id: trip.id,
      token,
      is_active: true,
    });
    setBusy(false);

    if (error) {
      setError(error.message);
      return;
    }

    await onRefresh();
    await copyShareUrl(token, token);
  }

  async function toggleShareLink(link) {
    if (!canManage) return;
    setBusy(true);
    setError("");
    const { error } = await supabase
      .from("share_links")
      .update({ is_active: !link.is_active })
      .eq("id", link.id);
    setBusy(false);

    if (error) {
      setError(error.message);
      return;
    }

    await onRefresh();
  }

  return (
    <div className="modal-backdrop">
      <div className="dialog-card share-dialog">
        <h2>唯讀分享</h2>
        <p>分享頁不需要登入，只會顯示行程、住宿與指南；預算、實付、結算、行李與成員資料不會公開。</p>
        {error ? <div className="notice danger">{error}</div> : null}
        <div className="share-link-list">
          {primaryLink ? (
            <div className="share-link-row" key={primaryLink.id}>
              <div>
                <strong>{primaryLink.is_active ? "分享連結已啟用" : "分享連結已停用"}</strong>
                <span>{`${window.location.origin}?share=${primaryLink.token}`}</span>
              </div>
              <div className="share-link-actions">
                {primaryLink.is_active ? (
                  <button className="mini-button" type="button" onClick={() => copyShareUrl(primaryLink.token, primaryLink.id)}>
                    {copiedId === primaryLink.id ? "已複製" : "複製"}
                  </button>
                ) : null}
                {canManage ? (
                  <button className="mini-button" type="button" disabled={busy} onClick={() => toggleShareLink(primaryLink)}>
                    {primaryLink.is_active ? "停用" : "啟用"}
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="empty-inline">尚未建立唯讀分享連結。</div>
          )}
        </div>
        <div className="form-actions">
          <button className="ghost-button" type="button" onClick={onClose}>
            關閉
          </button>
          {canManage ? (
            <button className="primary-button compact" type="button" disabled={busy} onClick={createShareLink}>
              建立並複製連結
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
