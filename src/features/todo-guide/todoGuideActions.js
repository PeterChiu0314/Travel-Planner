import {
  deleteGuide as deleteFormalGuide,
  deleteTodo as deleteFormalTodo,
  saveGuide as saveFormalGuide,
  saveTodo as saveFormalTodo,
  toggleTodo as toggleFormalTodo,
} from "./formalCommands.js";
import { notify } from "../../lib/notifications.js";
import { supabase } from "../../lib/supabase.js";

export function createTodoGuideActions({
  activeTrip,
  canEditActiveTripContent,
  loadTripData,
  rejectCrossTripSave,
  isCurrentTripContext,
  updateWithConflictCheck,
}) {
  async function saveGuide(payload, editingId, meta = {}) {
    if (!activeTrip || !canEditActiveTripContent) return;
    if (!isCurrentTripContext(meta)) return rejectCrossTripSave();
    const result = await saveFormalGuide({
      client: supabase,
      tripId: activeTrip.id,
      payload,
      editingId,
      meta,
      updateWithConflictCheck,
    });
    if (result.error) notify.error(result.error.message);
    else if (result.conflict) notify.warning("此資料在你編輯期間已被其他人更新。");
    else await loadTripData(activeTrip.id);
    return result.conflict ? { ok: false, conflict: true } : { ok: !result.error, error: result.error };
  }

  async function deleteGuide(guideId) {
    if (!activeTrip || !canEditActiveTripContent) return;
    const { error } = await deleteFormalGuide({ client: supabase, guideId });
    if (error) notify.error(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function saveTodo(payload, editingId, meta = {}) {
    if (!activeTrip || !canEditActiveTripContent) return;
    if (!isCurrentTripContext(meta)) return rejectCrossTripSave();
    const result = await saveFormalTodo({
      client: supabase,
      tripId: activeTrip.id,
      payload,
      editingId,
      meta,
      updateWithConflictCheck,
    });
    if (result.error) notify.error(result.error.message);
    else if (result.conflict) notify.warning("此資料在你編輯期間已被其他人更新。");
    else await loadTripData(activeTrip.id);
    return result.conflict ? { ok: false, conflict: true } : { ok: !result.error, error: result.error };
  }

  async function toggleTodo(todo) {
    if (!canEditActiveTripContent) return;
    const { error } = await toggleFormalTodo({ client: supabase, todo });
    if (error) notify.error(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function deleteTodo(todoId) {
    if (!activeTrip || !canEditActiveTripContent) return;
    const { error } = await deleteFormalTodo({ client: supabase, todoId });
    if (error) notify.error(error.message);
    else await loadTripData(activeTrip.id);
  }

  return {
    saveGuide,
    deleteGuide,
    saveTodo,
    toggleTodo,
    deleteTodo,
  };
}
