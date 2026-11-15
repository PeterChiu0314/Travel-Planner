import { useEffect, useMemo, useRef, useState } from "react";
import {
  requestActiveEditorGuardResolution,
  requestActiveEditorHandoff,
  useActiveEditorGuard,
} from "../../app/activeEditorGuard.jsx";
import { clearDraft, loadLatestDraftForEntity, useDraftAutosave } from "../../lib/draftAutosave.js";
import { acquireEditLock, isLockedByAnotherUser, releaseEditLock } from "../../lib/editLocks.js";
import { luggageLengthError } from "../../lib/luggageLimits.js";
import { friendlyError } from "../../lib/notifications.js";
import { supabase } from "../../lib/supabase.js";
import { useSiteDialog } from "../SiteDialog.jsx";
import LuggageBoard from "./LuggageBoard.jsx";

const emptyLuggageForm = {
  notes: "",
  title: "",
  category: "",
};

const emptySharedLuggageForm = {
  notes: "",
  title: "",
  category: "",
  assigned_to: "",
};

function useLuggageQuickAdd({ shared, activeTrip, currentUserId, restoreDrafts, disableDraftAutosave, canEdit, performMutation, onSave }) {
  const [emptyForm, setEmptyForm] = useState(shared ? emptySharedLuggageForm : emptyLuggageForm);
  const draft = useDraftAutosave({ disabled: disableDraftAutosave, defaultForm: emptyForm,
    entityType: shared ? "shared_luggage_quick_add" : "luggage_quick_add", editingId: null,
    isOpen: Boolean(activeTrip?.id && (restoreDrafts || disableDraftAutosave)), tripId: activeTrip?.id, userId: currentUserId });
  const guardId = `luggage-quick-${shared ? "shared" : "personal"}:${currentUserId}:${activeTrip?.id}`;
  function discard() {
    const next = { ...draft.form, title: "", notes: "" };
    setEmptyForm(next); draft.resetDraft(next);
    return true;
  }
  async function save() {
    if (!canEdit || !draft.form.title.trim()) return false;
    const lengthError = luggageLengthError(draft.form);
    const result = await performMutation(() => lengthError ? { ok: false, error: new Error(lengthError) } : onSave(draft.form, null, { tripId: activeTrip?.id }));
    if (!result?.ok) return false;
    const next = { ...draft.form, title: "", notes: "" };
    setEmptyForm(next); draft.resetDraft(next);
    return true;
  }
  const dirty = Boolean(draft.form.title.trim() || draft.form.notes?.trim());
  useActiveEditorGuard(guardId, { tripId: activeTrip?.id, workspace: "luggage" },
    useMemo(() => ({ isActive: dirty, isDirty: dirty, save, discard }), [dirty, draft.form, canEdit, onSave, performMutation]));
  async function submit(event) { event.preventDefault(); return save(); }
  return { draft, guardId, submit };
}

export function LuggagePanel({
  activeTrip,
  activeTab = "personal",
  canEdit,
  currentUserId,
  isOwner,
  luggageItems: incomingLuggageItems,
  members,
  restoreDrafts = true,
  disableDraftAutosave = false,
  useEditLocks = true,
  sharedLuggageItems: incomingSharedLuggageItems,
  onDeletePersonal,
  onDeleteShared,
  onSavePersonal,
  onSaveShared,
  onAssign,
  onPrivatize,
  onReorder,
  onTabChange,
  onTogglePersonal,
  onUpdateShared,
}) {
  const { ask, dialog } = useSiteDialog();
  // Defense in depth: cached/private and cross-trip rows never reach the board.
  const luggageItems = useMemo(() => incomingLuggageItems.filter((item) => item.owner_id === currentUserId && item.trip_id === activeTrip?.id && !item.shared_item_id && !item.is_shared_assigned_item), [incomingLuggageItems, currentUserId, activeTrip?.id]);
  const sharedLuggageItems = useMemo(() => incomingSharedLuggageItems.filter((item) => item.trip_id === activeTrip?.id && item.assigned_to), [incomingSharedLuggageItems, activeTrip?.id]);
  const contextRef = useRef(`${activeTrip?.id}:${currentUserId}`);
  contextRef.current = `${activeTrip?.id}:${currentUserId}`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  async function performMutation(action) {
    if (busyRef.current) return { ok: false };
    const actionContext = contextRef.current;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const result = await action();
      if (contextRef.current !== actionContext) return { ok: false, contextChanged: true };
      if (!result?.ok) setError(result?.conflict ? "資料已更新，請保留草稿並重新開啟最新項目後再試。" : friendlyError(result?.error || "未能儲存，請檢查連線後重試。你的輸入仍保留。"));
      return result || { ok: false };
    } catch { setError("未能儲存，請檢查連線後重試。你的輸入仍保留。"); return { ok: false }; }
    finally { busyRef.current = false; setBusy(false); }
  }
  const quickPersonal = useLuggageQuickAdd({ activeTrip, currentUserId, restoreDrafts, disableDraftAutosave, canEdit, performMutation,
    onSave: (form, id, meta) => {
      const { title, notes, category } = form;
      if (form.creation_scope !== "shared") return onSavePersonal({ title, notes, category }, id, meta);
      const assigned_to = form.assigned_to || currentUserId;
      if (!members.some(member => member.user_id === assigned_to && member.status === "approved")) return { ok: false, error: new Error("請選擇仍在旅程中的攜帶者。") };
      return onSaveShared({ title, notes, category: "", assigned_to }, id, meta);
    } });
  const quickGuardIds = [quickPersonal.guardId];
  const [personalSeed, setPersonalSeed] = useState(emptyLuggageForm);
  const [sharedSeed, setSharedSeed] = useState(emptySharedLuggageForm);
  const [editingPersonalId, setEditingPersonalId] = useState(null);
  const [editingSharedId, setEditingSharedId] = useState(null);
  const [personalUpdatedAt, setPersonalUpdatedAt] = useState(null);
  const [sharedUpdatedAt, setSharedUpdatedAt] = useState(null);
  const previousTripIdRef = useRef({ tripId: activeTrip?.id, userId: currentUserId });
  const openingEditor = useRef(0);
  const personalDraft = useDraftAutosave({
    disabled: disableDraftAutosave,
    defaultForm: personalSeed,
    editingId: editingPersonalId,
    entityType: "luggage_item",
    isOpen: Boolean(editingPersonalId),
    serverUpdatedAt: personalUpdatedAt,
    tripId: activeTrip?.id,
    userId: currentUserId,
  });
  const sharedDraft = useDraftAutosave({
    disabled: disableDraftAutosave,
    defaultForm: sharedSeed,
    editingId: editingSharedId,
    entityType: "shared_luggage_item",
    isOpen: Boolean(editingSharedId),
    serverUpdatedAt: sharedUpdatedAt,
    tripId: activeTrip?.id,
    userId: currentUserId,
  });
  const personalForm = personalDraft.form;
  const sharedForm = sharedDraft.form;
  const flushLuggageDrafts = useRef(null);
  flushLuggageDrafts.current = () => {
    quickPersonal.draft.flushDraft();
    personalDraft.flushDraft(); sharedDraft.flushDraft();
  };
  useEffect(() => {
    if (disableDraftAutosave) return undefined;
    // Do not depend on the autosave debounce when the user immediately reloads or backgrounds the page.
    const flush = () => flushLuggageDrafts.current?.();
    const hidden = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [disableDraftAutosave]);
  const setPersonalForm = personalDraft.setForm;
  const setSharedForm = sharedDraft.setForm;
  const personalDirty = disableDraftAutosave ? JSON.stringify(personalForm) !== JSON.stringify(personalSeed) : personalDraft.hasUnsavedChanges;
  const sharedDirty = disableDraftAutosave ? JSON.stringify(sharedForm) !== JSON.stringify(sharedSeed) : sharedDraft.hasUnsavedChanges;
  const personalEditorGuardId = `luggage-personal:${currentUserId}:${activeTrip?.id || "no-trip"}`;
  const sharedEditorGuardId = `luggage-shared:${currentUserId}:${activeTrip?.id || "no-trip"}`;
  const personalEditorGuard = useMemo(
    () => ({
      discard: () => discardPersonalEdit(),
      isActive: Boolean(editingPersonalId),
      isDirty: Boolean(editingPersonalId && personalDirty),
      needsHandoff: true,
      save: () => saveCurrentPersonal(),
    }),
    [personalForm, personalDirty, editingPersonalId, personalUpdatedAt],
  );
  const sharedEditorGuard = useMemo(
    () => ({
      discard: () => discardSharedEdit(),
      isActive: Boolean(editingSharedId),
      isDirty: Boolean(editingSharedId && sharedDirty),
      needsHandoff: true,
      save: () => saveCurrentShared(),
    }),
    [sharedForm, sharedDirty, editingSharedId, sharedUpdatedAt],
  );

  useEffect(() => () => {
    if (useEditLocks && editingPersonalId) void releaseEditLock({ recordId: editingPersonalId, supabase, table: "luggage_items", userId: currentUserId });
  }, [editingPersonalId, currentUserId, useEditLocks]);
  useEffect(() => () => {
    if (useEditLocks && editingSharedId) void releaseEditLock({ recordId: editingSharedId, supabase, table: "shared_luggage_items", userId: currentUserId });
  }, [editingSharedId, currentUserId, useEditLocks]);
  useActiveEditorGuard(personalEditorGuardId, { tripId: previousTripIdRef.current.tripId, workspace: "luggage" }, personalEditorGuard);
  useActiveEditorGuard(sharedEditorGuardId, { tripId: previousTripIdRef.current.tripId, workspace: "luggage" }, sharedEditorGuard);

  useEffect(() => {
    const previous = previousTripIdRef.current;
    if (previous.tripId === activeTrip?.id && previous.userId === currentUserId) return;
    if (useEditLocks && editingPersonalId) {
      void releaseEditLock({ recordId: editingPersonalId, supabase, table: "luggage_items", userId: currentUserId });
    }
    if (useEditLocks && editingSharedId) {
      void releaseEditLock({ recordId: editingSharedId, supabase, table: "shared_luggage_items", userId: currentUserId });
    }
    personalDraft.replaceForm(emptyLuggageForm);
    sharedDraft.replaceForm(emptySharedLuggageForm);
    setPersonalSeed(emptyLuggageForm);
    setSharedSeed(emptySharedLuggageForm);
    setPersonalUpdatedAt(null);
    setSharedUpdatedAt(null);
    setEditingPersonalId(null);
    setEditingSharedId(null);
    previousTripIdRef.current = { tripId: activeTrip?.id, userId: currentUserId };
  }, [activeTrip?.id, currentUserId, editingPersonalId, editingSharedId, personalDraft, sharedDraft]);

  const restoredEditor = useRef(false);
  useEffect(() => {
    if (restoredEditor.current || disableDraftAutosave || !restoreDrafts || !activeTrip?.id || !currentUserId || editingPersonalId || editingSharedId) return;
    const candidates = [];
    for (const [entityType, quick, items, shared] of [
      ["luggage_item", quickPersonal, luggageItems, false],
      ["shared_luggage_item", quickPersonal, sharedLuggageItems, true],
    ]) {
      const latest = loadLatestDraftForEntity({ entityType, tripId: activeTrip.id, userId: currentUserId });
      if (!latest) continue;
      if (latest.entityId === "new") {
        // Keep pre-upgrade new-item drafts, but never put them in the row editor.
        if (shared) continue; // Preserve old shared drafts until the single-entry recovery below.
        quick.draft.replaceForm(latest.draft.form, { dirty: true });
        quick.draft.flushDraft();
        clearDraft(latest.key);
      } else {
        const item = items.find(row => row.id === latest.entityId);
        if (item) candidates.push({ ...latest, item, shared });
      }
    }
    // Removed team Quick Add drafts are recovered as private, never silently
    // published or discarded. Leave them stored if a private draft already exists.
    const privateDraft = loadLatestDraftForEntity({ entityType: "luggage_quick_add", tripId: activeTrip.id, userId: currentUserId });
    const oldSharedQuick = loadLatestDraftForEntity({ entityType: "shared_luggage_quick_add", tripId: activeTrip.id, userId: currentUserId })
      || loadLatestDraftForEntity({ entityType: "shared_luggage_item", tripId: activeTrip.id, userId: currentUserId });
    if (oldSharedQuick?.entityId === "new" && !privateDraft && !quickPersonal.draft.form.title && !quickPersonal.draft.form.notes) {
      const recovered = oldSharedQuick.draft.form;
      quickPersonal.draft.replaceForm({ title: recovered.title || "", notes: recovered.notes || "", category: recovered.category || "" }, { dirty: true });
      quickPersonal.draft.flushDraft(); clearDraft(oldSharedQuick.key);
    }
    // Only one row editor can reopen. Other saved drafts remain available when their row is opened.
    const latest = candidates.sort((a, b) => new Date(b.draft.savedAt) - new Date(a.draft.savedAt))[0];
    if (!latest) return;
    restoredEditor.current = true;
    if (latest.shared) {
      setSharedSeed(latest.draft.form);
      setSharedUpdatedAt(latest.draft.serverUpdatedAt || latest.item.updated_at || null);
      setEditingSharedId(latest.entityId);
    } else {
      setPersonalSeed(latest.draft.form);
      setPersonalUpdatedAt(latest.draft.serverUpdatedAt || latest.item.updated_at || null);
      setEditingPersonalId(latest.entityId);
    }
  }, [activeTrip?.id, currentUserId, editingPersonalId, editingSharedId, luggageItems, sharedLuggageItems, restoreDrafts, disableDraftAutosave]);

  async function saveCurrentPersonal() {
    if (!personalForm.title.trim() || !canEdit) return false;
    const lengthError = luggageLengthError(personalForm);
    if (lengthError) { setError(lengthError); return false; }
    const canOpenEditor = await requestActiveEditorHandoff({
      workspace: "luggage",
      excludeId: personalEditorGuardId, excludeIds: quickGuardIds,
      tripId: activeTrip?.id,
    });
    if (!canOpenEditor) return false;
    const result = await performMutation(() => onSavePersonal(personalForm, editingPersonalId, { baseUpdatedAt: personalUpdatedAt, tripId: activeTrip?.id }));
    if (!result?.ok) return false;
    if (!disableDraftAutosave) clearDraft(personalDraft.draftKey);
    personalDraft.resetDraft(emptyLuggageForm);
    setPersonalSeed(emptyLuggageForm);
    setPersonalUpdatedAt(null);
    setEditingPersonalId(null);
    return true;
  }

  async function submitPersonal(event) {
    event.preventDefault();
    return saveCurrentPersonal();
  }

  async function saveCurrentShared(changes) {
    const canOpenEditor = await requestActiveEditorHandoff({
      workspace: "luggage",
      excludeId: sharedEditorGuardId, excludeIds: quickGuardIds,
      tripId: activeTrip?.id,
    });
    if (!canOpenEditor) return false;
    if (!sharedForm.title.trim() || !canEdit) return false;
    const lengthError = luggageLengthError({ ...sharedForm, ...changes });
    if (lengthError) { setError(lengthError); return false; }
    const result = await performMutation(() => onSaveShared({ ...sharedForm, ...changes }, editingSharedId, { baseUpdatedAt: sharedUpdatedAt, tripId: activeTrip?.id }));
    if (!result?.ok) return false;
    if (!disableDraftAutosave) clearDraft(sharedDraft.draftKey);
    sharedDraft.resetDraft(emptySharedLuggageForm);
    setSharedSeed(emptySharedLuggageForm);
    setSharedUpdatedAt(null);
    setEditingSharedId(null);
    return true;
  }

  async function submitShared(event, changes) {
    event.preventDefault();
    return saveCurrentShared(changes);
  }

  async function editPersonal(item) {
    if (useEditLocks && isLockedByAnotherUser(item, currentUserId)) return;
    const requestId = ++openingEditor.current;
    const canOpenEditor = await requestActiveEditorHandoff({
      workspace: "luggage",
      excludeId: personalEditorGuardId, excludeIds: quickGuardIds,
      tripId: activeTrip?.id,
    });
    if (!canOpenEditor || requestId !== openingEditor.current) return;
    if (editingPersonalId !== item.id && personalDirty) {
      const canContinue = await requestActiveEditorGuardResolution({ tripId: activeTrip?.id, workspace: "luggage", excludeIds: quickGuardIds });
      if (!canContinue) return;
    } else if (editingPersonalId && editingPersonalId !== item.id) {
      await discardPersonalEdit();
    }
    const openContext = contextRef.current;
    const lockResult = useEditLocks ? await acquireEditLock({ record: item, supabase, table: "luggage_items", userId: currentUserId }) : { data: item };
    if (contextRef.current !== openContext || requestId !== openingEditor.current) {
      if (useEditLocks && !lockResult.error) void releaseEditLock({ recordId: item.id, supabase, table: "luggage_items", userId: currentUserId });
      return;
    }
    const lockedItem = lockResult.data || item;
    if (lockResult.error || lockResult.lockedByAnotherUser) { setError("此物品正在由其他成員編輯，請稍後重試。"); return; }
    const nextForm = { title: lockedItem.title || "", category: lockedItem.category || "", notes: lockedItem.notes || "" };
    restoredEditor.current = true;
    personalDraft.flushDraft();
    setPersonalSeed(nextForm);
    personalDraft.replaceForm(nextForm, { dirty: false });
    setPersonalUpdatedAt(lockResult.data?.updated_at || item.updated_at || null);
    setEditingPersonalId(item.id);
  }

  async function discardPersonalEdit() {
    if (useEditLocks && editingPersonalId) {
      await releaseEditLock({ recordId: editingPersonalId, supabase, table: "luggage_items", userId: currentUserId });
    }
    if (!disableDraftAutosave) clearDraft(personalDraft.draftKey);
    personalDraft.resetDraft(emptyLuggageForm);
    setPersonalSeed(emptyLuggageForm);
    setPersonalUpdatedAt(null);
    setEditingPersonalId(null);
    return true;
  }

  async function cancelPersonalEdit() {
    if (personalDirty) await requestActiveEditorGuardResolution({ tripId: activeTrip?.id, workspace: "luggage", excludeIds: quickGuardIds });
    else await discardPersonalEdit();
  }
  async function cancelSharedEdit() {
    if (sharedDirty) await requestActiveEditorGuardResolution({ tripId: activeTrip?.id, workspace: "luggage", excludeIds: quickGuardIds });
    else await discardSharedEdit();
  }

  async function editShared(item) {
    if (useEditLocks && isLockedByAnotherUser(item, currentUserId)) return;
    const requestId = ++openingEditor.current;
    const canOpenEditor = await requestActiveEditorHandoff({
      workspace: "luggage",
      excludeId: sharedEditorGuardId, excludeIds: quickGuardIds,
      tripId: activeTrip?.id,
    });
    if (!canOpenEditor || requestId !== openingEditor.current) return;
    if (editingSharedId !== item.id && sharedDirty) {
      const canContinue = await requestActiveEditorGuardResolution({ tripId: activeTrip?.id, workspace: "luggage", excludeIds: quickGuardIds });
      if (!canContinue) return;
    } else if (editingSharedId && editingSharedId !== item.id) {
      await discardSharedEdit();
    }
    const openContext = contextRef.current;
    const lockResult = useEditLocks ? await acquireEditLock({ record: item, supabase, table: "shared_luggage_items", userId: currentUserId }) : { data: item };
    if (contextRef.current !== openContext || requestId !== openingEditor.current) {
      if (useEditLocks && !lockResult.error) void releaseEditLock({ recordId: item.id, supabase, table: "shared_luggage_items", userId: currentUserId });
      return;
    }
    const lockedItem = lockResult.data || item;
    if (lockResult.error || lockResult.lockedByAnotherUser) { setError("此物品正在由其他成員編輯，請稍後重試。"); return; }
    const nextForm = {
      title: lockedItem.title || "",
      category: lockedItem.category || "",
      notes: lockedItem.notes || "",
      assigned_to: lockedItem.assigned_to || "",
    };
    restoredEditor.current = true;
    sharedDraft.flushDraft();
    setSharedSeed(nextForm);
    sharedDraft.replaceForm(nextForm, { dirty: false });
    setSharedUpdatedAt(lockResult.data?.updated_at || item.updated_at || null);
    setEditingSharedId(item.id);
  }

  async function discardSharedEdit() {
    if (useEditLocks && editingSharedId) {
      await releaseEditLock({ recordId: editingSharedId, supabase, table: "shared_luggage_items", userId: currentUserId });
    }
    if (!disableDraftAutosave) clearDraft(sharedDraft.draftKey);
    sharedDraft.resetDraft(emptySharedLuggageForm);
    setSharedSeed(emptySharedLuggageForm);
    setSharedUpdatedAt(null);
    setEditingSharedId(null);
    return true;
  }

  async function updatePersonalForm(nextForm) {
    const canOpenEditor = await requestActiveEditorHandoff({
      workspace: "luggage",
      excludeId: personalEditorGuardId, excludeIds: quickGuardIds,
      tripId: activeTrip?.id,
    });
    if (canOpenEditor) setPersonalForm(nextForm);
  }

  async function updateSharedForm(nextForm) {
    const canOpenEditor = await requestActiveEditorHandoff({
      workspace: "luggage",
      excludeId: sharedEditorGuardId, excludeIds: quickGuardIds,
      tripId: activeTrip?.id,
    });
    if (canOpenEditor) setSharedForm(nextForm);
  }

  async function confirmSharedReassignment(item, assignedTo) {
    const nameOf = id => {
      const member = members.find(value => value.user_id === id);
      return id ? member?.display_name || member?.nickname || member?.email?.split("@")[0] || "旅程成員" : "旅程成員";
    };
    if (!assignedTo) return false;
    return ask({ title: `改由 ${nameOf(assignedTo)} 攜帶？`,
      message: `「${item.title}」將交給${nameOf(assignedTo)}，並重置準備狀態。`, confirmLabel: "確認" });
  }

  async function removeItem(kind, id, item) {
    if (!canEdit || busyRef.current) return;
    const isPersonal = kind === "personal";
    const editingThis = isPersonal ? editingPersonalId === id : editingSharedId === id;
    const otherDirty = isPersonal ? sharedDirty : personalDirty;
    if (otherDirty) {
      if (!await requestActiveEditorGuardResolution({ tripId: activeTrip?.id, workspace: "luggage", excludeIds: quickGuardIds })) return;
    }
    const hasDraft = editingThis && (isPersonal ? personalDirty : sharedDirty);
    if (!await ask({ title: "刪除物品？", message: `刪除「${item.title}」？${hasDraft ? "尚未儲存的修改也會捨棄。" : ""}此操作無法復原。`, confirmLabel: "刪除", danger: true })) return;
    const versioned = editingThis ? { ...item, updated_at: isPersonal ? personalUpdatedAt : sharedUpdatedAt } : item;
    const result = await performMutation(() => isPersonal ? onDeletePersonal(id, versioned) : onDeleteShared(id, versioned));
    if (result?.ok && editingThis) await (isPersonal ? discardPersonalEdit() : discardSharedEdit());
    return result;
  }
  return <>{dialog}<LuggageBoard key={`${activeTrip?.id}:${currentUserId}`} {...{
    activeTrip, activeTab, canEdit, currentUserId, isOwner, luggageItems, sharedLuggageItems, members,
    personalQuickForm: quickPersonal.draft.form,
    setPersonalQuickForm: quickPersonal.draft.setForm,
    submitPersonalQuick: quickPersonal.submit,
    personalForm, sharedForm, editingPersonalId, editingSharedId, submitPersonal, submitShared,
    editPersonal, editShared, cancelPersonalEdit, busy, error, onTabChange,
  }} cancelSharedEdit={cancelSharedEdit} setPersonalForm={updatePersonalForm} setSharedForm={updateSharedForm}
    onTogglePersonal={(item) => performMutation(() => onTogglePersonal(item))}
    onUpdateShared={(id, patch, item) => performMutation(() => onUpdateShared(id, patch, item || sharedLuggageItems.find(row => row.id === id)))}
    onReorder={async (scope, item, target, placement, expectedItems) => {
      if (!canEdit || !await requestActiveEditorHandoff({ tripId: activeTrip?.id, workspace: "luggage", excludeIds: quickGuardIds })) return { ok: false };
      const items = scope === "personal" ? luggageItems : sharedLuggageItems;
      if (!expectedItems || items.length !== expectedItems.length || !expectedItems.every(value => items.some(row => row.id === value.id && row.updated_at === value.updated_at))) {
        setError("物品已更新，請依最新清單重新拖曳。"); return { ok: false };
      }
      const actionContext = contextRef.current;
      if (scope === "shared" && (item.assigned_to || "") !== (target.assigned_to || "")) {
        if (!await confirmSharedReassignment(item, target.assigned_to)) return { ok: false, cancelled: true };
        if (contextRef.current !== actionContext) return { ok: false, contextChanged: true };
      }
      return performMutation(() => onReorder(scope, item, target, placement, items));
    }}
    onAssign={async (scope, item, assignedTo) => {
      if (!canEdit || !await requestActiveEditorHandoff({ tripId: activeTrip?.id, workspace: "luggage", excludeIds: quickGuardIds })) return { ok: false };
      if (!assignedTo || !members.some(member => member.user_id === assignedTo && member.status === "approved")) return { ok: false, error: new Error("請選擇有效的負責成員。") };
      const actionContext = contextRef.current;
      if (scope === "personal") {
        const assignee = members.find(member => member.user_id === assignedTo);
        const name = assignee?.display_name || assignee?.nickname || "旅程成員";
        if (!await ask({ title: "轉為共用物品？", message: `「${item.title}」將交由${name}負責，所有成員都能查看名稱與備註，準備狀態將重置。`, confirmLabel: "確認" })) return { ok: false, cancelled: true };
        if (contextRef.current !== actionContext) return { ok: false, contextChanged: true };
      } else if ((item.assigned_to || "") !== (assignedTo || "")) {
        if (!await confirmSharedReassignment(item, assignedTo)) return { ok: false, cancelled: true };
        if (contextRef.current !== actionContext) return { ok: false, contextChanged: true };
      }
      const latest = (scope === "personal" ? luggageItems : sharedLuggageItems).find(row => row.id === item.id);
      if (!latest || latest.updated_at !== item.updated_at) { setError("這件物品已更新，請依最新內容重新拖曳。"); return { ok: false }; }
      return performMutation(() => onAssign(scope, latest, assignedTo));
    }}
    onPrivatize={async (item, category) => {
      if (!canEdit || !await requestActiveEditorHandoff({ tripId: activeTrip?.id, workspace: "luggage", excludeIds: quickGuardIds })) return { ok: false };
      const actionContext = contextRef.current;
      if (!await ask({ title: "轉為個人物品？", message: <>「{item.title}」將移至你的個人行李，不再與團隊共享，並重置準備狀態。<br />原負責人的清單也會移除此物品。</>, confirmLabel: "確認" })) return { ok: false, cancelled: true };
      if (contextRef.current !== actionContext) return { ok: false, contextChanged: true };
      return performMutation(() => onPrivatize(item, category));
    }}
    onMovePersonal={async (item, category) => {
      if (!canEdit || item.category === category || !await requestActiveEditorHandoff({ tripId: activeTrip?.id, workspace: "luggage", excludeIds: quickGuardIds })) return false;
      const latest = luggageItems.find(row => row.id === item.id);
      if (!latest) return false;
      return performMutation(() => onSavePersonal({ title: latest.title, notes: latest.notes || "", category }, latest.id, { baseUpdatedAt: latest.updated_at, tripId: activeTrip?.id }));
    }}
    onDeletePersonal={(id, item) => removeItem("personal", id, item)}
    onDeleteShared={(id, item) => removeItem("shared", id, item)} /></>;
}
