import { useEffect, useLayoutEffect, useRef, useState } from "react";

const activeEditorGuards = new Map();
const activeEditorListeners = new Set();
let activeEditorPrompt = null;

function notifyActiveEditorListeners() {
  activeEditorListeners.forEach((listener) => listener());
}

function registerActiveEditorGuard(key, guard) {
  activeEditorGuards.set(key, guard);
  notifyActiveEditorListeners();
  return () => {
    activeEditorGuards.delete(key);
    notifyActiveEditorListeners();
  };
}

function subscribeToActiveEditors(listener) {
  activeEditorListeners.add(listener);
  return () => activeEditorListeners.delete(listener);
}

function getActiveEditorGuardEntries(options) {
  const { excludeId, excludeIds = [], onlyId, workspace, tripId } = options ?? {};
  return [...activeEditorGuards.entries()].filter(([, guard]) => {
    if (options && (!tripId || guard.tripId !== tripId)) return false;
    if (workspace && guard.workspace !== workspace) return false;
    if (onlyId && guard.id !== onlyId) return false;
    if (guard.id === excludeId || excludeIds.includes(guard.id)) return false;
    return true;
  });
}

function hasUnresolvedEdit(guard) {
  const { isDirty, isPending } = guard.readState?.() ?? guard;
  return Boolean(isDirty || isPending);
}

export function getDirtyActiveEditorGuards(options) {
  return getActiveEditorGuardEntries(options)
    .map(([, guard]) => guard)
    .filter(hasUnresolvedEdit);
}

function showActiveEditorPrompt(blockingGuard) {
  if (activeEditorPrompt) return Promise.resolve(null);
  return new Promise((resolve) => {
    activeEditorPrompt = { resolve, blockingGuard };
    notifyActiveEditorListeners();
  });
}

async function resolveActiveEditorGuards(options, resolved) {
  if (activeEditorPrompt) return false;
  // Narrow autosave editors flush valid work before asking how to keep a draft.
  for (const [key, guard] of getActiveEditorGuardEntries(options)) {
    if (hasUnresolvedEdit(guard) && guard.prepare && await guard.prepare()) resolved.add(key);
  }
  const unresolved = ([key, guard]) => (!resolved.has(key) || guard.readState) && hasUnresolvedEdit(guard);
  const dirtyEntries = getActiveEditorGuardEntries(options).filter(unresolved);
  if (!dirtyEntries.length) return true;
  const dirtyKeys = new Set(dirtyEntries.map(([key]) => key));
  const blockingGuard = dirtyEntries.find(([, guard]) => guard.readState?.().missingExpenseTitle)?.[1];
  const choice = await showActiveEditorPrompt(blockingGuard);
  if (!choice) return false;
  for (const [key, guard] of getActiveEditorGuardEntries(options).filter(unresolved)) {
    if (!dirtyKeys.has(key)) return false;
    const ok = choice === "save" ? await guard.save() : await guard.discard();
    if (ok === false) return false;
    resolved.add(key);
  }
  return !getActiveEditorGuardEntries(options).some(unresolved);
}

export function requestActiveEditorGuardResolution(options) {
  return resolveActiveEditorGuards(options, new Set());
}

export async function requestActiveEditorHandoff(options) {
  const resolved = new Set();
  if (!await resolveActiveEditorGuards(options, resolved)) return false;
  for (const [key, guard] of getActiveEditorGuardEntries(options)) {
    const wasResolved = resolved.has(key);
    if (wasResolved ? !guard.finish || guard.prepareFinishes : hasUnresolvedEdit(guard)) continue;
    const { needsHandoff } = guard.readState?.() ?? guard;
    if (!needsHandoff || guard.cleanupInWorkspaceOnly && options?.workspace !== guard.workspace) continue;
    const ok = await (guard.finish ? guard.finish() : guard.discard());
    if (ok === false) return false;
  }
  return !getActiveEditorGuardEntries(options).some(([key, guard]) => (!resolved.has(key) || guard.readState) && hasUnresolvedEdit(guard));
}

export function useActiveEditorGuard(id, { tripId, workspace }, guard) {
  const key = useRef(Symbol());
  useLayoutEffect(() => {
    if (!guard.isActive || !tripId) return undefined;
    return registerActiveEditorGuard(key.current, { ...guard, id, tripId, workspace });
  }, [id, tripId, workspace, guard]);
}

export function ActiveEditorGuardDialog() {
  const [prompt, setPrompt] = useState(activeEditorPrompt);

  useEffect(() => {
    const listener = () => setPrompt(activeEditorPrompt);
    return subscribeToActiveEditors(listener);
  }, []);

  useEffect(() => {
    function handleBeforeUnload(event) {
      if (!getDirtyActiveEditorGuards().length) return;
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  if (!prompt) return null;

  function choose(choice) {
    const current = activeEditorPrompt;
    activeEditorPrompt = null;
    notifyActiveEditorListeners();
    current?.resolve(choice);
    if (choice === null) current?.blockingGuard?.focusMissingExpenseTitle();
  }

  return (
    <div className="modal-backdrop">
      <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="active-editor-guard-title">
        <h2 id="active-editor-guard-title">您有未儲存的變更</h2>
        <p>{prompt.blockingGuard ? "請先填寫項目名稱，才能儲存此支出。" : "是否儲存後繼續？"}</p>
        <div className="form-actions">
          <button className="primary-button compact" type="button" onClick={() => choose(prompt.blockingGuard ? null : "save")}>
            {prompt.blockingGuard ? "繼續編輯" : "儲存"}
          </button>
          <button className="ghost-button" type="button" onClick={() => choose("discard")}>
            不儲存
          </button>
          {!prompt.blockingGuard ? <button className="ghost-button" type="button" onClick={() => choose(null)}>繼續編輯</button> : null}
        </div>
      </div>
    </div>
  );
}
