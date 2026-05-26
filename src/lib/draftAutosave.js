import { useEffect, useMemo, useRef, useState } from "react";

const draftPrefix = "travel-planner-draft";

export function getDraftKey({ entityId = "new", entityType, tripId, userId }) {
  return [draftPrefix, userId || "anonymous", tripId || "no-trip", entityType, entityId || "new"].join(":");
}

export function saveDraft(key, payload) {
  if (!key) return;
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        ...payload,
        savedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // Drafts are best effort; storage can be full or unavailable in private windows.
  }
}

export function loadDraft(key) {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearDraft(key) {
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to clear when local storage is unavailable.
  }
}

export function loadLatestDraftForEntity({ entityType, tripId, userId }) {
  const prefix = [draftPrefix, userId || "anonymous", tripId || "no-trip", entityType, ""].join(":");
  let latest = null;
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const draft = loadDraft(key);
      if (!draft?.form || !draft.savedAt) continue;
      if (!latest || new Date(draft.savedAt).getTime() > new Date(latest.draft.savedAt).getTime()) {
        latest = {
          draft,
          entityId: key.slice(prefix.length) || "new",
          key,
        };
      }
    }
  } catch {
    return null;
  }
  return latest;
}

export function isDraftNewerThanServer(draft, serverUpdatedAt) {
  if (!draft?.savedAt) return false;
  if (!serverUpdatedAt) return true;
  return new Date(draft.savedAt).getTime() > new Date(serverUpdatedAt).getTime();
}

export function detectRemoteConflict({ draft, remoteUpdatedAt, serverUpdatedAt }) {
  if (!draft?.savedAt || !remoteUpdatedAt || !serverUpdatedAt) return false;
  return (
    new Date(remoteUpdatedAt).getTime() > new Date(serverUpdatedAt).getTime() &&
    new Date(draft.savedAt).getTime() > new Date(serverUpdatedAt).getTime()
  );
}

export function useDraftAutosave({
  debounceMs = 500,
  defaultForm,
  editingId,
  entityType,
  isOpen,
  serverUpdatedAt,
  tripId,
  userId,
}) {
  const draftKey = useMemo(
    () => getDraftKey({ entityId: editingId || "new", entityType, tripId, userId }),
    [editingId, entityType, tripId, userId],
  );
  const [form, setForm] = useState(defaultForm);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const latestRef = useRef(defaultForm);
  const hasUnsavedRef = useRef(false);
  const openedRef = useRef(false);
  const suppressFlushRef = useRef(false);

  useEffect(() => {
    latestRef.current = form;
  }, [form]);

  useEffect(() => {
    hasUnsavedRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!isOpen) {
      openedRef.current = false;
      return;
    }
    if (openedRef.current) return;

    const draft = loadDraft(draftKey);
    if (isDraftNewerThanServer(draft, serverUpdatedAt)) {
      suppressFlushRef.current = false;
      setForm(draft.form);
      setHasUnsavedChanges(true);
    } else {
      setForm(defaultForm);
      setHasUnsavedChanges(false);
    }
    openedRef.current = true;
  }, [defaultForm, draftKey, isOpen, serverUpdatedAt]);

  useEffect(() => {
    if (!isOpen || !hasUnsavedChanges) return undefined;
    const timeout = window.setTimeout(() => {
      if (!suppressFlushRef.current) saveDraft(draftKey, { form: latestRef.current, serverUpdatedAt });
    }, debounceMs);
    return () => window.clearTimeout(timeout);
  }, [debounceMs, draftKey, hasUnsavedChanges, isOpen, form, serverUpdatedAt]);

  useEffect(() => {
    if (!isOpen) return undefined;

    function flushDraft() {
      if (hasUnsavedRef.current && !suppressFlushRef.current) {
        saveDraft(draftKey, { form: latestRef.current, serverUpdatedAt });
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") flushDraft();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", flushDraft);
    window.addEventListener("beforeunload", flushDraft);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", flushDraft);
      window.removeEventListener("beforeunload", flushDraft);
      flushDraft();
    };
  }, [draftKey, hasUnsavedChanges, isOpen, serverUpdatedAt]);

  function updateForm(next) {
    suppressFlushRef.current = false;
    hasUnsavedRef.current = true;
    setHasUnsavedChanges(true);
    setForm((current) => (typeof next === "function" ? next(current) : next));
  }

  function resetDraft(nextForm = defaultForm) {
    suppressFlushRef.current = true;
    hasUnsavedRef.current = false;
    clearDraft(draftKey);
    latestRef.current = nextForm;
    setForm(nextForm);
    setHasUnsavedChanges(false);
  }

  function flushDraft() {
    if (hasUnsavedRef.current && !suppressFlushRef.current) {
      saveDraft(draftKey, { form: latestRef.current, serverUpdatedAt });
    }
  }

  return {
    draftKey,
    form,
    flushDraft,
    hasUnsavedChanges,
    resetDraft,
    setForm: updateForm,
  };
}
