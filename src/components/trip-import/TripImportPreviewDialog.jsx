import TripImportPreviewBoard from "./TripImportPreviewBoard.jsx";
import TripImportNotices from "./TripImportNotices.jsx";

export default function TripImportPreviewDialog({ busy, error, onClose, onConfirm, preview }) {
  const errors = preview?.errors || [];
  const warnings = preview?.warnings || [];
  const trip = preview?.trip;
  const counts = preview?.counts || {};
  const blockingIssues = error
    ? [...errors, { code: "import_failed", message: error, path: "$" }]
    : errors;
  const hasBlockingError = blockingIssues.length > 0;
  const canConfirm = Boolean(trip && !hasBlockingError && !busy);

  return (
    <div className="modal-backdrop">
      <section
        aria-labelledby="trip-import-preview-title"
        className={`dialog-card trip-import-preview-dialog${hasBlockingError ? " has-blocking-error" : ""}`}
      >
        <div className="trip-import-preview-heading">
          <div>
            <h2 id="trip-import-preview-title">匯入旅程預覽</h2>
          </div>
        </div>

        {!hasBlockingError && trip ? (
          <TripImportPreviewBoard days={preview?.days} trip={trip} />
        ) : null}

        {hasBlockingError ? (
          <div className="trip-import-blocking-error" role="alert">
            <strong>無法匯入這份旅程</strong>
            <details>
              <summary>查看細節（{blockingIssues.length}）</summary>
              <ul>
                {blockingIssues.slice(0, 20).map((issue, index) => (
                  <li key={`${issue.path}-${issue.code}-${index}`}>
                    <span>{issue.message}</span>
                    <code>{issue.path}</code>
                  </li>
                ))}
              </ul>
              {blockingIssues.length > 20 ? <p>另有 {blockingIssues.length - 20} 項細節未展開。</p> : null}
            </details>
          </div>
        ) : null}
        {!hasBlockingError ? <TripImportNotices warnings={warnings} /> : null}

        <div className="trip-import-preview-footer">
          {!hasBlockingError ? (
            <div
              aria-label={`${preview?.days?.length || 0} 天，行程 ${counts.visits || 0}，交通 ${counts.transports || 0}，備案 ${counts.alternatives || 0}`}
              className="trip-import-counts"
            >
              <span><strong>{preview?.days?.length || 0}</strong> 天</span>
              <span>行程 <strong>{counts.visits || 0}</strong></span>
              <span>交通 <strong>{counts.transports || 0}</strong></span>
              <span>備案 <strong>{counts.alternatives || 0}</strong></span>
            </div>
          ) : null}
          <div className="form-actions">
            <button className="ghost-button" type="button" disabled={busy} onClick={onClose}>取消</button>
            {!hasBlockingError ? (
              <button className="primary-button compact" type="button" disabled={!canConfirm} onClick={onConfirm}>
                {busy ? "匯入中…" : "確認匯入"}
              </button>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
