export default function ConflictNotice({ onKeep, onLatest }) {
  return (
    <div className="draft-conflict" role="alert">
      <strong>此資料在你編輯期間已被其他人更新。</strong>
      <span>你可以保留目前草稿，或查看最新版本。</span>
      <div className="conflict-actions">
        <button className="mini-button" type="button" onClick={onKeep}>
          保留我的草稿
        </button>
        <button className="mini-button" type="button" onClick={onLatest}>
          查看最新版本
        </button>
      </div>
    </div>
  );
}
