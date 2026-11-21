import { notify } from "../../lib/notifications.js";
import { supabase } from "../../lib/supabase.js";
import { deleteTripStay, saveTripStay } from "./formalStays.js";

export function createStayActions({
    activeTrip,
    canEditActiveTripContent,
    loadTripData,
    rejectCrossTripSave,
    isCurrentTripContext,
    updateWithConflictCheck,
  }) {
  async function saveAccommodation(payload, editingId, meta = {}) {
    if (!activeTrip || !canEditActiveTripContent) return;
    if (!isCurrentTripContext(meta)) return rejectCrossTripSave();
    const result = await saveTripStay({
      client: supabase, trip: activeTrip, payload, editingId, meta, updateWithConflictCheck,
    });
    if (result.error) notify.error(result.error.message);
    else if (result.conflict) notify.warning("此資料在你編輯期間已被其他人更新。");
    else await loadTripData(activeTrip.id);
    return result.conflict ? { ok: false, conflict: true } : { ok: !result.error, error: result.error };
  }

  async function deleteAccommodation(accommodationId) {
    if (!activeTrip || !canEditActiveTripContent) return;
    const { error } = await deleteTripStay(supabase, accommodationId);
    if (error) notify.error(error.message);
    else await loadTripData(activeTrip.id);
  }

  return { saveAccommodation, deleteAccommodation };
}
