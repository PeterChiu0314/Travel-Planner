import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Plus } from "lucide-react";
import {
  requestActiveEditorGuardResolution,
  requestActiveEditorHandoff,
  useActiveEditorGuard,
} from "../app/activeEditorGuard.jsx";
import { clearDraft, loadLatestDraftForEntity, useDraftAutosave } from "../lib/draftAutosave.js";
import { acquireEditLock, isLockedByAnotherUser, releaseEditLock } from "../lib/editLocks.js";
import { memberName } from "../lib/memberName.js";
import { supabase } from "../lib/supabase.js";
import ConflictNotice from "./ConflictNotice.jsx";
import { WorkspaceActions, WorkspaceHeading, WorkspaceProgress, WorkspaceSearch } from "./workspace/TravelWorkspace.jsx";

const emptyGuideForm = {
  title: "",
  description: "",
  url: "",
};

const emptyTodoForm = {
  title: "",
  description: "",
  due_date: "",
  assignee_id: "",
  guide_id: "",
};

export default function TodoGuidePanel({
  activeTrip,
  canEdit,
  currentUserId,
  guideItems,
  members,
  todoItems,
  onDeleteGuide,
  onDeleteTodo,
  onSaveGuide,
  onSaveTodo,
  onToggleTodo,
  restoreDrafts = true,
  disableDraftAutosave = false,
  useEditLocks = true,
}) {
  const [activeTab, setActiveTab] = useState("todo");
  const approvedMembers = members.filter((member) => member.status === "approved");
  return (
    <section className="panel todo-guide-panel travel-workspace">
      <WorkspaceHeading title="待辦指南" description="把出發前的準備，和旅途中的資訊放在一起。" />
      <WorkspaceProgress label="準備進度" value={todoItems.filter((item) => item.completed).length} total={todoItems.length} />
      <div className="mobile-tabs">
        <button className={activeTab === "todo" ? "active" : ""} type="button" onClick={() => setActiveTab("todo")}>
          待辦
        </button>
        <button className={activeTab === "guide" ? "active" : ""} type="button" onClick={() => setActiveTab("guide")}>
          指南
        </button>
      </div>
      <div className="todo-guide-layout">
        <div className={`todo-guide-column${activeTab === "todo" ? " active" : ""}`}>
          <TodoPanel
            activeTrip={activeTrip}
            canEdit={canEdit}
            currentUserId={currentUserId}
            guideItems={guideItems}
            members={approvedMembers}
            todoItems={todoItems}
            onDelete={onDeleteTodo}
            onSave={onSaveTodo}
            onToggle={onToggleTodo}
            disableDraftAutosave={disableDraftAutosave}
            useEditLocks={useEditLocks}
            restoreDrafts={restoreDrafts}
          />
        </div>
        <div className={`todo-guide-column${activeTab === "guide" ? " active" : ""}`}>
          <GuidePanel
            activeTrip={activeTrip}
            canEdit={canEdit}
            currentUserId={currentUserId}
            guideItems={guideItems}
            onDelete={onDeleteGuide}
            onSave={onSaveGuide}
            disableDraftAutosave={disableDraftAutosave}
            useEditLocks={useEditLocks}
            restoreDrafts={restoreDrafts}
          />
        </div>
      </div>
    </section>
  );
}

function TodoPanel({
  activeTrip,
  canEdit,
  currentUserId,
  guideItems,
  members,
  onDelete,
  onSave,
  onToggle,
  restoreDrafts = true,
  disableDraftAutosave = false,
  useEditLocks = true,
  todoItems,
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const visibleTodos = todoItems.filter((item) => (status === "all" || (status === "completed" ? item.completed : !item.completed)) && [item.title, item.description].filter(Boolean).join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formSeed, setFormSeed] = useState(emptyTodoForm);
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(null);
  const [editorTripId, setEditorTripId] = useState(null);
  const [restoredDraftKey, setRestoredDraftKey] = useState(null);
  const [conflict, setConflict] = useState(false);
  const { draftKey, flushDraft, form, hasUnsavedChanges: autosaveHasUnsavedChanges, replaceForm, resetDraft, setForm } = useDraftAutosave({
    disabled: disableDraftAutosave,
    defaultForm: formSeed,
    editingId,
    entityType: "todo_item",
    forceDirtyOnOpen: Boolean(restoredDraftKey),
    isOpen,
    serverUpdatedAt: baseUpdatedAt,
    tripId: activeTrip?.id,
    userId: currentUserId,
  });
  const memberById = new Map(members.map((member) => [member.user_id, member]));
  const guideById = new Map(guideItems.map((guide) => [guide.id, guide]));
  const pendingCount = todoItems.filter((item) => !item.completed).length;
  const hasUnsavedChanges = disableDraftAutosave ? JSON.stringify(form) !== JSON.stringify(formSeed) : autosaveHasUnsavedChanges;
  const activeEditorGuardId = `todo:${activeTrip?.id || "no-trip"}`;
  const activeEditorGuard = useMemo(
    () => ({
      discard: () => closeTodoForm(true),
      isActive: isOpen,
      isDirty: hasUnsavedChanges,
      needsHandoff: true,
      save: () => saveCurrentTodo(),
    }),
    [form, hasUnsavedChanges, isOpen, editingId, baseUpdatedAt, draftKey],
  );

  useActiveEditorGuard(activeEditorGuardId, { tripId: editorTripId || activeTrip?.id, workspace: "todo" }, activeEditorGuard);

  useEffect(() => {
    if (!isOpen || !editorTripId || !activeTrip?.id || editorTripId === activeTrip.id) return;
    if (useEditLocks && editingId) {
      void releaseEditLock({ recordId: editingId, supabase, table: "todo_items", userId: currentUserId });
    }
    replaceForm(emptyTodoForm);
    setFormSeed(emptyTodoForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setEditingId(null);
    setEditorTripId(null);
    setRestoredDraftKey(null);
    setIsOpen(false);
  }, [activeTrip?.id, currentUserId, editingId, editorTripId, isOpen, replaceForm]);

  useEffect(() => {
    if (disableDraftAutosave || !restoreDrafts || isOpen || !activeTrip?.id || !currentUserId) return;
    const latest = loadLatestDraftForEntity({
      entityType: "todo_item",
      tripId: activeTrip.id,
      userId: currentUserId,
    });
    if (!latest) return;
    const matchingItem = todoItems.find((item) => item.id === latest.entityId);
    if (latest.entityId !== "new" && !matchingItem) return;
    setFormSeed(latest.draft.form);
    setBaseUpdatedAt(latest.entityId === "new" ? latest.draft.serverUpdatedAt || null : matchingItem?.updated_at || null);
    setConflict(false);
    setEditingId(latest.entityId === "new" ? null : latest.entityId);
    setEditorTripId(activeTrip.id);
    setRestoredDraftKey(latest.key);
    setIsOpen(true);
  }, [activeTrip?.id, currentUserId, isOpen, restoreDrafts, todoItems]);

  async function openNewTodo() {
    const canOpenEditor = await requestActiveEditorHandoff({
      workspace: "todo",
      excludeId: activeEditorGuardId,
      tripId: activeTrip?.id,
    });
    if (!canOpenEditor) return;
    if (isOpen) {
      const canContinue = hasUnsavedChanges ? await requestActiveEditorGuardResolution({ tripId: editorTripId, onlyId: activeEditorGuardId }) : true;
      if (!canContinue) return;
      if (!hasUnsavedChanges) await closeTodoForm(true);
    }
    flushDraft();
    replaceForm(emptyTodoForm);
    setFormSeed(emptyTodoForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setEditingId(null);
    setEditorTripId(activeTrip?.id || null);
    setRestoredDraftKey(null);
    setIsOpen(true);
  }

  async function openEditTodo(item) {
    if (useEditLocks && isLockedByAnotherUser(item, currentUserId)) return;
    const canOpenEditor = await requestActiveEditorHandoff({
      workspace: "todo",
      excludeId: activeEditorGuardId,
      tripId: activeTrip?.id,
    });
    if (!canOpenEditor) return;
    if (isOpen && editingId !== item.id) {
      const canContinue = hasUnsavedChanges ? await requestActiveEditorGuardResolution({ tripId: editorTripId, onlyId: activeEditorGuardId }) : true;
      if (!canContinue) return;
      if (!hasUnsavedChanges) await closeTodoForm(true);
    }
    const lockResult = useEditLocks ? await acquireEditLock({ record: item, supabase, table: "todo_items", userId: currentUserId }) : { data: item };
    if (lockResult.error || lockResult.lockedByAnotherUser) return;
    const lockedItem = lockResult.data || item;
    const nextForm = {
      title: item.title || "",
      description: item.description || "",
      due_date: item.due_date || "",
      assignee_id: item.assignee_id || "",
      guide_id: item.guide_id || "",
    };
    flushDraft();
    replaceForm(nextForm);
    setFormSeed(nextForm);
    setBaseUpdatedAt(lockedItem.updated_at || item.updated_at || null);
    setConflict(false);
    setEditingId(item.id);
    setEditorTripId(activeTrip?.id || null);
    setRestoredDraftKey(null);
    setIsOpen(true);
  }

  async function saveCurrentTodo() {
    const result = await onSave(form, editingId, { baseUpdatedAt, tripId: editorTripId });
    if (!result?.ok) {
      if (result?.conflict) setConflict(true);
      return false;
    }
    if (!disableDraftAutosave) clearDraft(draftKey);
    resetDraft(emptyTodoForm);
    setFormSeed(emptyTodoForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setIsOpen(false);
    setEditingId(null);
    setEditorTripId(null);
    setRestoredDraftKey(null);
    return true;
  }

  async function submit(event) {
    event.preventDefault();
    await saveCurrentTodo();
  }

  async function closeTodoForm(force = false) {
    if (!force && hasUnsavedChanges && !window.confirm("放棄尚未儲存的變更？")) return;
    if (useEditLocks && editingId) await releaseEditLock({ recordId: editingId, supabase, table: "todo_items", userId: currentUserId });
    if (!disableDraftAutosave) clearDraft(draftKey);
    resetDraft(emptyTodoForm);
    setFormSeed(emptyTodoForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setIsOpen(false);
    setEditingId(null);
    setEditorTripId(null);
    setRestoredDraftKey(null);
  }

  return (
    <section className="todo-panel">
      <div className="panel-heading tight">
        <div>
          <p className="eyebrow">Todo</p>
          <h3>待辦</h3>
        </div>
        <div className="member-actions">
          <span className="pill">{pendingCount} 未完成</span>
          <button className="icon-button small" disabled={!canEdit} type="button" title="新增待辦" onClick={openNewTodo}>
            <Plus size={15} aria-hidden="true" /> 新增待辦
          </button>
        </div>
      </div>

      {isOpen ? (
        <form autoComplete="off" className="item-form" onSubmit={submit}>
          {conflict ? (
            <ConflictNotice onKeep={() => setConflict(false)} onLatest={() => closeTodoForm(true)} />
          ) : null}
          <div className="field-group form-grid wide">
            <label>
              標題
              <input autoComplete="off" required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
            </label>
            <label>
              截止日
              <input
                autoComplete="off"
                type="date"
                value={form.due_date}
                onChange={(event) => setForm({ ...form, due_date: event.target.value })}
              />
            </label>
          </div>
          <div className="field-group form-grid wide">
            <label>
              負責人
              <select aria-label="負責人" value={form.assignee_id} onChange={(event) => setForm({ ...form, assignee_id: event.target.value })}>
                <option value="">未指定</option>
                {members.map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {memberName(member)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              連結指南
              <select aria-label="連結指南" value={form.guide_id} onChange={(event) => setForm({ ...form, guide_id: event.target.value })}>
                <option value="">未連結</option>
                {guideItems.map((guide) => (
                  <option key={guide.id} value={guide.id}>
                    {guide.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="full-label">
            說明
            <textarea
              aria-label="說明"
              autoComplete="off"
              rows="3"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </label>
          <div className="form-actions">
            <button className="ghost-button" type="button" onClick={() => closeTodoForm()}>
              取消
            </button>
            <button className="primary-button compact" type="submit">
              儲存
            </button>
          </div>
        </form>
      ) : null}

      <WorkspaceSearch label="搜尋待辦" value={query} onChange={setQuery} />
      <div className="todo-filters" aria-label="待辦狀態">{[["all", "全部"], ["pending", "未完成"], ["completed", "已完成"]].map(([value, label]) => <button key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(value)}>{label}</button>)}</div>
      <div className="todo-list">
        {visibleTodos.length ? (
          visibleTodos.map((item) => {
            const assignee = memberById.get(item.assignee_id);
            const guide = guideById.get(item.guide_id);
            return (
              <article className={`todo-row${item.completed ? " completed" : ""}`} key={item.id}>
                <input aria-label={`完成待辦：${item.title}`} checked={item.completed} disabled={!canEdit} type="checkbox" onChange={() => onToggle(item)} />
                <div>
                  <strong>{item.title}</strong>
                  {item.description ? <p>{item.description}</p> : null}
                  <div className="item-meta">
                    {item.due_date ? <span className="pill">{item.due_date}</span> : null}
                    <span className="pill">{assignee ? memberName(assignee) : "未指定負責人"}</span>
                    {guide ? <span className="pill">指南：{guide.title}</span> : null}
                  </div>
                </div>
                <WorkspaceActions name={item.title} disabled={!canEdit} onEdit={() => openEditTodo(item)} onDelete={() => onDelete(item.id)} />
              </article>
            );
          })
        ) : (
          <div className="timeline-empty">{todoItems.length ? "沒有符合條件的待辦" : "尚未建立待辦"}</div>
        )}
      </div>
    </section>
  );
}

function GuidePanel({ activeTrip, canEdit, currentUserId, guideItems, onDelete, onSave, restoreDrafts = true, disableDraftAutosave = false, useEditLocks = true }) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formSeed, setFormSeed] = useState(emptyGuideForm);
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(null);
  const [editorTripId, setEditorTripId] = useState(null);
  const [conflict, setConflict] = useState(false);
  const { draftKey, flushDraft, form, hasUnsavedChanges: autosaveHasUnsavedChanges, replaceForm, resetDraft, setForm } = useDraftAutosave({
    disabled: disableDraftAutosave,
    defaultForm: formSeed,
    editingId,
    entityType: "guide_item",
    isOpen,
    serverUpdatedAt: baseUpdatedAt,
    tripId: activeTrip?.id,
    userId: currentUserId,
  });
  const hasUnsavedChanges = disableDraftAutosave ? JSON.stringify(form) !== JSON.stringify(formSeed) : autosaveHasUnsavedChanges;
  const activeEditorGuardId = `guide:${activeTrip?.id || "no-trip"}`;
  const activeEditorGuard = useMemo(
    () => ({
      discard: () => closeGuideForm(true),
      isActive: isOpen,
      isDirty: hasUnsavedChanges,
      needsHandoff: true,
      save: () => saveCurrentGuide(),
    }),
    [form, hasUnsavedChanges, isOpen, editingId, baseUpdatedAt, draftKey],
  );

  useActiveEditorGuard(activeEditorGuardId, { tripId: editorTripId || activeTrip?.id, workspace: "guide" }, activeEditorGuard);

  useEffect(() => {
    if (!isOpen || !editorTripId || !activeTrip?.id || editorTripId === activeTrip.id) return;
    if (useEditLocks && editingId) {
      void releaseEditLock({ recordId: editingId, supabase, table: "guide_items", userId: currentUserId });
    }
    replaceForm(emptyGuideForm);
    setFormSeed(emptyGuideForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setEditingId(null);
    setEditorTripId(null);
    setIsOpen(false);
  }, [activeTrip?.id, currentUserId, editingId, editorTripId, isOpen, replaceForm]);

  useEffect(() => {
    if (disableDraftAutosave || !restoreDrafts || isOpen || !activeTrip?.id || !currentUserId) return;
    const latest = loadLatestDraftForEntity({
      entityType: "guide_item",
      tripId: activeTrip.id,
      userId: currentUserId,
    });
    if (!latest) return;
    const matchingItem = guideItems.find((item) => item.id === latest.entityId);
    if (latest.entityId !== "new" && !matchingItem) return;
    setFormSeed(latest.draft.form);
    setBaseUpdatedAt(latest.draft.serverUpdatedAt || matchingItem?.updated_at || null);
    setConflict(false);
    setEditingId(latest.entityId === "new" ? null : latest.entityId);
    setEditorTripId(activeTrip.id);
    setIsOpen(true);
  }, [activeTrip?.id, currentUserId, guideItems, isOpen, restoreDrafts]);

  async function openNewGuide() {
    const canOpenEditor = await requestActiveEditorHandoff({
      workspace: "guide",
      excludeId: activeEditorGuardId,
      tripId: activeTrip?.id,
    });
    if (!canOpenEditor) return;
    if (isOpen) {
      const canContinue = hasUnsavedChanges ? await requestActiveEditorGuardResolution({ tripId: editorTripId, onlyId: activeEditorGuardId }) : true;
      if (!canContinue) return;
      if (!hasUnsavedChanges) await closeGuideForm(true);
    }
    flushDraft();
    replaceForm(emptyGuideForm);
    setFormSeed(emptyGuideForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setEditingId(null);
    setEditorTripId(activeTrip?.id || null);
    setIsOpen(true);
  }

  async function openEditGuide(item) {
    if (useEditLocks && isLockedByAnotherUser(item, currentUserId)) return;
    const canOpenEditor = await requestActiveEditorHandoff({
      workspace: "guide",
      excludeId: activeEditorGuardId,
      tripId: activeTrip?.id,
    });
    if (!canOpenEditor) return;
    if (isOpen && editingId !== item.id) {
      const canContinue = hasUnsavedChanges ? await requestActiveEditorGuardResolution({ tripId: editorTripId, onlyId: activeEditorGuardId }) : true;
      if (!canContinue) return;
      if (!hasUnsavedChanges) await closeGuideForm(true);
    }
    const lockResult = useEditLocks ? await acquireEditLock({ record: item, supabase, table: "guide_items", userId: currentUserId }) : { data: item };
    if (lockResult.error || lockResult.lockedByAnotherUser) return;
    const lockedItem = lockResult.data || item;
    const nextForm = {
      title: item.title || "",
      description: item.description || "",
      url: item.url || "",
    };
    flushDraft();
    replaceForm(nextForm);
    setFormSeed(nextForm);
    setBaseUpdatedAt(lockedItem.updated_at || item.updated_at || null);
    setConflict(false);
    setEditingId(item.id);
    setEditorTripId(activeTrip?.id || null);
    setIsOpen(true);
  }

  async function saveCurrentGuide() {
    const result = await onSave(form, editingId, { baseUpdatedAt, tripId: editorTripId });
    if (!result?.ok) {
      if (result?.conflict) setConflict(true);
      return false;
    }
    if (!disableDraftAutosave) clearDraft(draftKey);
    resetDraft(emptyGuideForm);
    setFormSeed(emptyGuideForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setIsOpen(false);
    setEditingId(null);
    setEditorTripId(null);
    return true;
  }

  async function submit(event) {
    event.preventDefault();
    await saveCurrentGuide();
  }

  async function closeGuideForm(force = false) {
    if (!force && hasUnsavedChanges && !window.confirm("放棄尚未儲存的變更？")) return;
    if (useEditLocks && editingId) await releaseEditLock({ recordId: editingId, supabase, table: "guide_items", userId: currentUserId });
    if (!disableDraftAutosave) clearDraft(draftKey);
    resetDraft(emptyGuideForm);
    setFormSeed(emptyGuideForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setIsOpen(false);
    setEditingId(null);
    setEditorTripId(null);
  }

  return (
    <section className="guide-panel">
      <div className="panel-heading tight">
        <div>
          <p className="eyebrow">Guide</p>
          <h3>指南</h3>
        </div>
        <button className="icon-button small" disabled={!canEdit} type="button" title="新增指南" onClick={openNewGuide}>
          <Plus size={15} aria-hidden="true" /> 新增指南
        </button>
      </div>

      {isOpen ? (
        <form autoComplete="off" className="item-form" onSubmit={submit}>
          {conflict ? (
            <ConflictNotice onKeep={() => setConflict(false)} onLatest={() => closeGuideForm(true)} />
          ) : null}
          <label>
            標題
            <input autoComplete="off" required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </label>
          <label className="full-label">
            URL
            <input autoComplete="off" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} />
          </label>
          <label className="full-label">
            說明
            <textarea
              aria-label="說明"
              autoComplete="off"
              rows="3"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </label>
          <div className="form-actions">
            <button className="ghost-button" type="button" onClick={() => closeGuideForm()}>
              取消
            </button>
            <button className="primary-button compact" type="submit">
              儲存
            </button>
          </div>
        </form>
      ) : null}

      <div className="guide-list">
        {guideItems.length ? (
          guideItems.map((item) => (
            <article className="guide-card" key={item.id}>
              <span className="guide-link-icon"><ExternalLink size={18} aria-hidden="true" /></span>
              <div>
                <strong>{item.title}</strong>
                {item.description ? <p>{item.description}</p> : null}
                {item.url ? (
                  <a href={item.url} rel="noreferrer" target="_blank">
                    開啟連結
                  </a>
                ) : null}
              </div>
              <WorkspaceActions name={item.title} disabled={!canEdit} onEdit={() => openEditGuide(item)} onDelete={() => onDelete(item.id)} />
            </article>
          ))
        ) : (
          <div className="timeline-empty">尚未建立指南</div>
        )}
      </div>
    </section>
  );
}

// Quick-add drafts are independent of the single inline editor. Both participate in navigation guards.
