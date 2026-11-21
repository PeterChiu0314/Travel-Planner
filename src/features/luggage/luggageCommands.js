import { applyLuggageMutation, applyLuggageOrder } from "../../lib/luggageSync.js";
import { notify } from "../../lib/notifications.js";
import {
  reorderLuggageItems,
  privatizeLuggageItem,
  assignLuggageItem,
  mutateLuggageItem,
  luggageErrorMessage,
} from "../../lib/luggageService.js";
import { supabase } from "../../lib/supabase.js";

export function createLuggageCommands({
    session,
    setLuggageItems,
    setSharedLuggageItems,
    activeTrip,
    requestGuard,
    updateSharedCache,
    refreshLuggage,
    activeMembership,
    rejectCrossTripSave,
    isCurrentTripContext,
  }) {
  async function persistLuggage(scope, action, payload, itemId, meta = {}) {
    if (!activeTrip || !session?.user || activeMembership?.status !== "approved") return { ok: false, error: new Error("你不是此旅程的已核准成員。") };
    if (!isCurrentTripContext(meta)) return rejectCrossTripSave();
    const tripId = activeTrip.id;
    const context = requestGuard.context();
    requestGuard.invalidate([scope]);
    const result = await mutateLuggageItem({ client: supabase, tripId, scope, action, payload,
      itemId: itemId || null, baseUpdatedAt: meta.baseUpdatedAt || null });
    if (!requestGuard.sameContext(context)) return { ok: false, contextChanged: true };
    requestGuard.invalidate([scope]);
    if (result.error) {
      const error = new Error(luggageErrorMessage(result.error));
      if (result.conflict) await refreshLuggage(tripId, [scope]);
      notify.error(error.message);
      return { ...result, error };
    }
    if (requestGuard.sameContext(context)) {
      const setter = scope === "personal" ? setLuggageItems : setSharedLuggageItems;
      const update = current => applyLuggageMutation(current, { action, itemId, data: result.data });
      if (scope === "shared") updateSharedCache(tripId, session.user.id, update);
      setter(update);
    }
    return result;
  }

  function saveLuggageItem(payload, editingId, meta = {}) {
    return persistLuggage("personal", "save", { title: payload.title.trim(), category: payload.category.trim(), notes: (payload.notes || "").trim() }, editingId, meta);
  }

  function toggleLuggageItem(item) {
    return persistLuggage("personal", "patch", { packed: !item.packed }, item.id, { tripId: item.trip_id, baseUpdatedAt: item.updated_at });
  }

  function deleteLuggageItem(itemId, item) {
    return persistLuggage("personal", "delete", {}, itemId, { tripId: item?.trip_id, baseUpdatedAt: item?.updated_at });
  }

  function saveSharedLuggageItem(payload, editingId, meta = {}) {
    return persistLuggage("shared", "save", { title: payload.title.trim(), category: payload.category.trim(), notes: (payload.notes || "").trim(), assigned_to: payload.assigned_to || null }, editingId, meta);
  }

  function updateSharedLuggageItem(itemId, patch, item) {
    return persistLuggage("shared", "patch", patch, itemId, { tripId: item?.trip_id, baseUpdatedAt: item?.updated_at });
  }

  function deleteSharedLuggageItem(itemId, item) {
    return persistLuggage("shared", "delete", {}, itemId, { tripId: item?.trip_id, baseUpdatedAt: item?.updated_at });
  }

  async function assignTripLuggage(scope, item, assignedTo) {
    if (!activeTrip || !session?.user || activeMembership?.status !== "approved" || item.trip_id !== activeTrip.id) return { ok: false, error: new Error("luggage_forbidden") };
    const tripId = activeTrip.id;
    const context = requestGuard.context();
    requestGuard.invalidate(["personal", "shared"]);
    const result = await assignLuggageItem({ client: supabase, tripId, scope, item, assignedTo });
    if (!requestGuard.sameContext(context)) return { ok: false, contextChanged: true };
    requestGuard.invalidate(["personal", "shared"]);
    if (!result.ok) {
      const error = new Error(luggageErrorMessage(result.error));
      if (result.conflict) await refreshLuggage(tripId);
      return { ...result, error };
    }
    if (requestGuard.sameContext(context)) {
      if (scope === "personal") setLuggageItems(current => current.filter(row => row.id !== item.id));
      const update = current => applyLuggageMutation(current, { action: "save", itemId: scope === "shared" ? item.id : null, data: result.data });
      updateSharedCache(tripId, session.user.id, update);
      setSharedLuggageItems(update);
    }
    return result;
  }

  async function privatizeTripLuggage(item, category) {
    if (!activeTrip || !session?.user || activeMembership?.status !== "approved" || item.trip_id !== activeTrip.id) return { ok: false, error: new Error("luggage_forbidden") };
    const tripId = activeTrip.id;
    const context = requestGuard.context();
    requestGuard.invalidate(["personal", "shared"]);
    const result = await privatizeLuggageItem({ client: supabase, tripId, item, category });
    if (!requestGuard.sameContext(context)) return { ok: false, contextChanged: true };
    requestGuard.invalidate(["personal", "shared"]);
    if (!result.ok) {
      if (result.conflict) await refreshLuggage(tripId);
      return { ...result, error: new Error(luggageErrorMessage(result.error)) };
    }
    if (requestGuard.sameContext(context)) {
      updateSharedCache(tripId, session.user.id, current => current.filter(row => row.id !== item.id));
      setSharedLuggageItems(current => current.filter(row => row.id !== item.id));
      setLuggageItems(current => current.some(row => row.id === result.data.id) ? current : [...current, result.data]);
    }
    return result;
  }

  async function reorderTripLuggage(scope, item, target, placement, items) {
    if (!activeTrip || activeMembership?.status !== "approved" || item.trip_id !== activeTrip.id || target.trip_id !== activeTrip.id) return { ok: false, error: new Error("luggage_forbidden") };
    const tripId = activeTrip.id;
    const context = requestGuard.context();
    requestGuard.invalidate([scope]);
    const result = await reorderLuggageItems({ client: supabase, tripId, scope, item, target, placement, items });
    if (!requestGuard.sameContext(context)) return { ok: false, contextChanged: true };
    requestGuard.invalidate([scope]);
    if (!result.ok) {
      if (result.conflict) await refreshLuggage(tripId, [scope]);
      return { ...result, error: new Error(luggageErrorMessage(result.error)) };
    }
    if (requestGuard.sameContext(context)) {
      const setter = scope === "personal" ? setLuggageItems : setSharedLuggageItems;
      const update = current => applyLuggageOrder(current, result.data);
      if (scope === "shared") updateSharedCache(tripId, session.user.id, update);
      setter(update);
    }
    return result;
  }

  return {
    saveLuggageItem,
    toggleLuggageItem,
    deleteLuggageItem,
    saveSharedLuggageItem,
    updateSharedLuggageItem,
    deleteSharedLuggageItem,
    assignTripLuggage,
    privatizeTripLuggage,
    reorderTripLuggage,
  };
}
