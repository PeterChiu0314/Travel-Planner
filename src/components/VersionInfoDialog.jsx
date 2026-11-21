import { useEffect } from "react";

const appVersion = "0.1.6";

export function VersionInfoDialog({ onClose }) {
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop version-dialog-backdrop" onClick={onClose}>
      <div
        className="dialog-card version-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="version-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="version-dialog-logo" aria-hidden="true">TP</div>
        <div className="version-dialog-heading">
          <span className="version-dialog-stage">Development Preview</span>
          <h2 id="version-dialog-title">旅程工房 | Travel Studio</h2>
        </div>
        <dl className="version-dialog-facts">
          <div>
            <dt>當前版本</dt>
            <dd>v{appVersion}</dd>
          </div>
          <div>
            <dt>產品類型</dt>
            <dd>Collaborative Travel Web App</dd>
          </div>
          <div>
            <dt>開發者</dt>
            <dd>PeterChiu</dd>
          </div>
        </dl>
        <button className="ghost-button version-dialog-close" type="button" onClick={onClose}>
          關閉
        </button>
      </div>
    </div>
  );
}
