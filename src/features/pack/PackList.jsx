import { useState } from "react";

function PackList({ canEdit, items, onAdd, onDelete, onToggle }) {
  const [title, setTitle] = useState("");
  return (
    <section className="panel">
      <div className="panel-heading tight">
        <div>
          <p className="eyebrow">Pack</p>
          <h3>打包清單</h3>
        </div>
      </div>
      <form
        autoComplete="off"
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          onAdd(title);
          setTitle("");
        }}
      >
        <input
          autoComplete="off"
          disabled={!canEdit}
          placeholder="新增項目"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <button className="icon-button small" disabled={!canEdit} type="submit" title="新增清單">
          +
        </button>
      </form>
      <div className="pack-list">
        {items.map((item) => (
          <div className={`pack-item${item.done ? " done" : ""}`} key={item.id}>
            <input checked={item.done} disabled={!canEdit} type="checkbox" onChange={() => onToggle(item)} />
            <span>{item.title}</span>
            <button className="mini-button" disabled={!canEdit} type="button" onClick={() => onDelete(item.id)}>
              X
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
