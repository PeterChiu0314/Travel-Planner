import { useEffect, useMemo, useState } from "react";
import {
  requestActiveEditorGuardResolution,
  requestActiveEditorHandoff,
  useActiveEditorGuard,
} from "../app/activeEditorGuard.jsx";
import { todayInput } from "../lib/displayFormat.js";
import { clearDraft, loadLatestDraftForEntity, useDraftAutosave } from "../lib/draftAutosave.js";
import { acquireEditLock, isLockedByAnotherUser, releaseEditLock } from "../lib/editLocks.js";
import { expenseModels } from "../lib/expenseSnapshot.js";
import { supabase } from "../lib/supabase.js";
import ConflictNotice from "./ConflictNotice.jsx";
import { WorkspaceActions, WorkspaceHeading, WorkspaceSearch, WorkspaceSummary } from "./workspace/TravelWorkspace.jsx";

const emptyAccommodationForm = {
  name: "",
  check_in_date: "",
  check_out_date: "",
  check_in_time: "",
  check_out_time: "",
  address: "",
  map_url: "",
  booking_code: "",
  payment_status: "unpaid",
  expense_id: "",
  custom_notes: "",
};

function AttachmentList({ attachments, canEdit, targetId, targetType, onDelete, onOpen, onUpload,onReplace }) {
  async function handleUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    await onUpload(targetType, targetId, file);
    event.target.value = "";
  }

  return (
    <div className="attachment-list">
      <div className="attachment-heading">
        <strong>附件</strong>
        <label className={`attachment-upload${!canEdit ? " disabled" : ""}`}>
          上傳
          <input
            accept="image/jpeg,image/png,image/webp,application/pdf"
            disabled={!canEdit}
            type="file"
            onChange={handleUpload}
          />
        </label>
      </div>
      {attachments.length ? (
        attachments.map((attachment) => (
          <div className="attachment-row" key={attachment.id}>
            <button type="button" onClick={() => onOpen(attachment)}>
              {attachment.file_name}
            </button>
            <span>{attachment.file_size ? `${Math.round(attachment.file_size / 1024)} KB` : ""}</span>
            {onReplace?<label className={`attachment-upload${!canEdit?' disabled':''}`}>替換<input aria-label={`替換 ${attachment.file_name}`} disabled={!canEdit} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={event=>{const file=event.target.files?.[0];if(file)void onReplace(attachment,file);event.target.value='';}}/></label>:null}
            <button className="mini-button" disabled={!canEdit} type="button" onClick={() => onDelete(attachment)}>
              X
            </button>
          </div>
        ))
      ) : (
        <span className="muted-text">尚未上傳附件</span>
      )}
    </div>
  );
}

export default function AccommodationPanel({
  activeTrip,
  accommodations,
  attachments,
  expenseGraph,
  canEdit,
  currentUserId,
  trip,
  onDelete,
  onDeleteAttachment,
  onOpenAttachment,
  onSave,
  onUploadAttachment,
  restoreDrafts = true,
  disableDraftAutosave = false,
  useEditLocks = true,
  enableAttachments = true,
}) {
  const [search, setSearch] = useState("");
  const visibleAccommodations = accommodations.filter((item) => [item.name, item.address, item.booking_code].filter(Boolean).join(" ").toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [selectedId, setSelectedId] = useState(accommodations[0]?.id || null);
  const [formSeed, setFormSeed] = useState(emptyAccommodationForm);
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(null);
  const [editorTripId, setEditorTripId] = useState(null);
  const [restoredDraftKey, setRestoredDraftKey] = useState(null);
  const [conflict, setConflict] = useState(false);
  const { draftKey, flushDraft, form, hasUnsavedChanges: autosaveHasUnsavedChanges, replaceForm, resetDraft, setForm } = useDraftAutosave({
    disabled: disableDraftAutosave,
    defaultForm: formSeed,
    editingId,
    entityType: "accommodation",
    forceDirtyOnOpen: Boolean(restoredDraftKey),
    isOpen,
    serverUpdatedAt: baseUpdatedAt,
    tripId: activeTrip?.id || trip?.id,
    userId: currentUserId,
  });
  const selected = accommodations.find((item) => item.id === selectedId) || accommodations[0] || null;
  const hasUnsavedChanges = disableDraftAutosave ? JSON.stringify(form) !== JSON.stringify(formSeed) : autosaveHasUnsavedChanges;
  const activeEditorGuardId = `accommodation:${activeTrip?.id || trip?.id || "no-trip"}`;
  const activeEditorGuard = useMemo(
    () => ({
      discard: () => closeAccommodationForm(true),
      isActive: isOpen,
      isDirty: hasUnsavedChanges,
      needsHandoff: true,
      save: () => saveCurrentAccommodation(),
    }),
    [form, hasUnsavedChanges, isOpen, editingId, baseUpdatedAt, draftKey],
  );

  useActiveEditorGuard(activeEditorGuardId, { tripId: editorTripId || activeTrip?.id || trip?.id, workspace: "accommodation" }, activeEditorGuard);

  useEffect(() => {
    const currentTripId = activeTrip?.id || trip?.id || null;
    if (!isOpen || !editorTripId || !currentTripId || editorTripId === currentTripId) return;
    if (useEditLocks && editingId) {
      void releaseEditLock({ recordId: editingId, supabase, table: "accommodations", userId: currentUserId });
    }
    replaceForm(emptyAccommodationForm);
    setFormSeed(emptyAccommodationForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setEditingId(null);
    setEditorTripId(null);
    setRestoredDraftKey(null);
    setIsOpen(false);
  }, [activeTrip?.id, currentUserId, editingId, editorTripId, isOpen, replaceForm, trip?.id]);

  useEffect(() => {
    if (disableDraftAutosave || !restoreDrafts || isOpen || !(activeTrip?.id || trip?.id) || !currentUserId) return;
    const latest = loadLatestDraftForEntity({
      entityType: "accommodation",
      tripId: activeTrip?.id || trip?.id,
      userId: currentUserId,
    });
    if (!latest) return;
    const matchingItem = accommodations.find((item) => item.id === latest.entityId);
    if (latest.entityId !== "new" && !matchingItem) return;
    setFormSeed(latest.draft.form);
    setBaseUpdatedAt(latest.entityId === "new" ? latest.draft.serverUpdatedAt || null : matchingItem?.updated_at || null);
    setConflict(false);
    setEditingId(latest.entityId === "new" ? null : latest.entityId);
    setEditorTripId(activeTrip?.id || trip?.id || null);
    setRestoredDraftKey(latest.key);
    setIsOpen(true);
  }, [accommodations, activeTrip?.id, currentUserId, isOpen, restoreDrafts, trip?.id]);

  async function openNewAccommodation() {
    const canOpenEditor = await requestActiveEditorHandoff({
      workspace: "accommodation",
      excludeId: activeEditorGuardId,
      tripId: activeTrip?.id || trip?.id,
    });
    if (!canOpenEditor) return;
    if (isOpen) {
      const canContinue = hasUnsavedChanges ? await requestActiveEditorGuardResolution({ tripId: editorTripId, onlyId: activeEditorGuardId }) : true;
      if (!canContinue) return;
      if (!hasUnsavedChanges) await closeAccommodationForm(true);
    }
    const nextForm = {
      ...emptyAccommodationForm,
      check_in_date: trip.start_date || todayInput(),
      check_out_date: trip.start_date || todayInput(),
    };
    flushDraft();
    replaceForm(nextForm);
    setFormSeed(nextForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setEditingId(null);
    setEditorTripId(activeTrip?.id || trip?.id || null);
    setRestoredDraftKey(null);
    setIsOpen(true);
  }

  async function openEditAccommodation(item) {
    if (useEditLocks && isLockedByAnotherUser(item, currentUserId)) return;
    const canOpenEditor = await requestActiveEditorHandoff({
      workspace: "accommodation",
      excludeId: activeEditorGuardId,
      tripId: activeTrip?.id || trip?.id,
    });
    if (!canOpenEditor) return;
    if (isOpen && editingId !== item.id) {
      const canContinue = hasUnsavedChanges ? await requestActiveEditorGuardResolution({ tripId: editorTripId, onlyId: activeEditorGuardId }) : true;
      if (!canContinue) return;
      if (!hasUnsavedChanges) await closeAccommodationForm(true);
    }
    const lockResult = useEditLocks ? await acquireEditLock({ record: item, supabase, table: "accommodations", userId: currentUserId }) : { data: item };
    if (lockResult.error || lockResult.lockedByAnotherUser) return;
    const lockedItem = lockResult.data || item;
    const nextForm = {
      name: item.name || "",
      check_in_date: item.check_in_date || trip.start_date || todayInput(),
      check_out_date: item.check_out_date || item.check_in_date || trip.start_date || todayInput(),
      check_in_time: item.check_in_time || "",
      check_out_time: item.check_out_time || "",
      address: item.address || "",
      map_url: item.map_url || "",
      booking_code: item.booking_code || "",
      payment_status: item.payment_status || "unpaid",
      expense_id: item.expense_id || "",
      custom_notes: item.custom_notes || "",
    };
    flushDraft();
    replaceForm(nextForm);
    setFormSeed(nextForm);
    setBaseUpdatedAt(lockedItem.updated_at || item.updated_at || null);
    setConflict(false);
    setEditingId(item.id);
    setEditorTripId(activeTrip?.id || trip?.id || null);
    setRestoredDraftKey(null);
    setIsOpen(true);
  }

  async function saveCurrentAccommodation() {
    const result = await onSave(form, editingId, { baseUpdatedAt, tripId: editorTripId });
    if (!result?.ok) {
      if (result?.conflict) setConflict(true);
      return false;
    }
    if (!disableDraftAutosave) clearDraft(draftKey);
    resetDraft(emptyAccommodationForm);
    setFormSeed(emptyAccommodationForm);
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
    await saveCurrentAccommodation();
  }

  async function closeAccommodationForm(force = false) {
    if (!force && hasUnsavedChanges && !window.confirm("放棄尚未儲存的變更？")) return;
    if (useEditLocks && editingId) await releaseEditLock({ recordId: editingId, supabase, table: "accommodations", userId: currentUserId });
    if (!disableDraftAutosave) clearDraft(draftKey);
    resetDraft(emptyAccommodationForm);
    setFormSeed(emptyAccommodationForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setIsOpen(false);
    setEditingId(null);
    setEditorTripId(null);
    setRestoredDraftKey(null);
  }

  return (
    <section className="panel accommodation-panel travel-workspace">
      <WorkspaceHeading title="住宿資訊" description="每一晚的落腳處，都安排妥當。" action={{ label: "新增住宿", disabled: !canEdit, onClick: openNewAccommodation }} />
      <WorkspaceSummary items={[
        { label: "住宿安排", value: `${accommodations.length} 間` },
        { label: "已付款", value: `${accommodations.filter((item) => item.payment_status === "paid").length} 間` },
        { label: "待確認付款", value: `${accommodations.filter((item) => item.payment_status !== "paid").length} 間` },
      ]} />

      {isOpen ? (
        <form autoComplete="off" className="item-form accommodation-form" onSubmit={submit}>
          {conflict ? (
            <ConflictNotice onKeep={() => setConflict(false)} onLatest={() => closeAccommodationForm(true)} />
          ) : null}
          <div className="field-group form-grid wide">
            <label>
              住宿名稱
              <input autoComplete="off" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
            <label>
              預約代碼
              <input
                autoComplete="off"
                value={form.booking_code}
                onChange={(event) => setForm({ ...form, booking_code: event.target.value })}
              />
            </label>
          </div>
          <div className="field-group form-grid">
            <label>
              入住日期
              <input
                required
                type="date"
                value={form.check_in_date}
                onChange={(event) => setForm({ ...form, check_in_date: event.target.value })}
              />
            </label>
            <label>
              退房日期
              <input
                required
                type="date"
                value={form.check_out_date}
                onChange={(event) => setForm({ ...form, check_out_date: event.target.value })}
              />
            </label>
            <label>
              入住時間
              <input
                type="time"
                value={form.check_in_time}
                onChange={(event) => setForm({ ...form, check_in_time: event.target.value })}
              />
            </label>
            <label>
              退房時間
              <input
                type="time"
                value={form.check_out_time}
                onChange={(event) => setForm({ ...form, check_out_time: event.target.value })}
              />
            </label>
          </div>
          <div className="field-group form-grid wide">
            <label>
              地址
              <input autoComplete="off" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
            </label>
            <label>
              Map URL
              <input autoComplete="off" value={form.map_url} onChange={(event) => setForm({ ...form, map_url: event.target.value })} />
            </label>
          </div>
          <div className="field-group form-grid wide">
            <label>
              付款狀態
              <select
                aria-label="付款狀態"
                value={form.payment_status}
                onChange={(event) => setForm({ ...form, payment_status: event.target.value })}
              >
                <option value="unpaid">未付款</option>
                <option value="partial">部分付款</option>
                <option value="paid">已付款</option>
              </select>
            </label>
            <label>
              關聯支出
              <select aria-label="關聯支出" disabled={!expenseGraph} value={form.expense_id || ""}
                onChange={(event) => setForm({ ...form, expense_id: event.target.value })}>
                <option value="">未連動</option>
                {!expenseGraph && form.expense_id ? <option value={form.expense_id}>已關聯支出</option> : null}
                {(expenseGraph ? expenseModels(expenseGraph) : []).map((item) => <option key={item.id} value={item.id}>{item.title || "未命名項目"}</option>)}
              </select>
            </label>
          </div>
          <label className="full-label">
            自訂備註
            <textarea
              aria-label="自訂備註"
              autoComplete="off"
              rows="3"
              value={form.custom_notes}
              onChange={(event) => setForm({ ...form, custom_notes: event.target.value })}
            />
          </label>
          <div className="form-actions">
            <button className="ghost-button" type="button" onClick={() => closeAccommodationForm()}>
              取消
            </button>
            <button className="primary-button compact" type="submit">
              儲存
            </button>
          </div>
        </form>
      ) : null}

      <div className="accommodation-layout">
        <div className="accommodation-list">
          <h4>住宿安排</h4>
          <WorkspaceSearch label="搜尋住宿" placeholder="搜尋住宿、地址或預約代碼" value={search} onChange={setSearch} />
          {visibleAccommodations.length ? (
            visibleAccommodations.map((item) => (
              <button
                className={`accommodation-list-item${selected?.id === item.id ? " active" : ""}`}
                key={item.id}
                type="button"
                aria-pressed={selected?.id === item.id}
                onClick={() => setSelectedId(item.id)}
              >
                <strong>{item.name}</strong>
                <span>
                  {item.check_in_date} → {item.check_out_date}
                </span>
                <span>{item.payment_status === "paid" ? "已付款" : item.payment_status === "partial" ? "部分付款" : "未付款"}</span>
              </button>
            ))
          ) : (
            <div className="timeline-empty">{search ? "沒有符合條件的住宿" : "尚未建立住宿"}</div>
          )}
        </div>

        <div className="accommodation-detail">
          {selected ? (
            <>
              <div className="panel-heading tight">
                <div>
                  <p className="eyebrow">Stay</p>
                  <h3>{selected.name}</h3>
                </div>
                <WorkspaceActions name={selected.name} disabled={!canEdit} onEdit={() => openEditAccommodation(selected)} onDelete={() => onDelete(selected.id)} />
              </div>
              <div className="accommodation-facts">
                <div>
                  <span>入住</span>
                  <strong>
                    {selected.check_in_date} {selected.check_in_time || ""}
                  </strong>
                </div>
                <div>
                  <span>退房</span>
                  <strong>
                    {selected.check_out_date} {selected.check_out_time || ""}
                  </strong>
                </div>
                <div>
                  <span>付款狀態</span>
                  <strong>
                    {selected.payment_status === "paid"
                      ? "已付款"
                      : selected.payment_status === "partial"
                        ? "部分付款"
                        : "未付款"}
                  </strong>
                </div>
                <div>
                  <span>預約代碼</span>
                  <strong>{selected.booking_code || "未填寫"}</strong>
                </div>
              </div>
              <div className="accommodation-notes">
                {selected.address ? <p>地址：{selected.address}</p> : null}
                {selected.map_url ? (
                  <a href={selected.map_url} rel="noreferrer" target="_blank">
                    開啟地圖
                  </a>
                ) : null}
                <p>{selected.expense_id
                  ? `關聯支出：${expenseGraph ? expenseModels(expenseGraph).find(item => item.id === selected.expense_id)?.title || "已移除的支出" : "支出資料讀取中"}`
                  : "尚未關聯支出"}</p>
                {selected.custom_notes ? <p>{selected.custom_notes}</p> : null}
                {enableAttachments ? <AttachmentList
                  attachments={attachments.filter(
                    (attachment) => attachment.target_type === "accommodation" && attachment.target_id === selected.id,
                  )}
                  canEdit={canEdit}
                  targetId={selected.id}
                  targetType="accommodation"
                  onDelete={onDeleteAttachment}
                  onOpen={onOpenAttachment}
                  onUpload={onUploadAttachment}
                /> : <div className="timeline-empty">附件與憑證可於正式旅程上傳；本地預覽不會儲存檔案。</div>}
              </div>
            </>
          ) : (
            <div className="timeline-empty">選擇一筆住宿查看詳細資料</div>
          )}
        </div>
      </div>
    </section>
  );
}
