import { dateToInputValue } from "../../lib/displayFormat.js";
import { submitTimelineSchedule } from "../../lib/timelineScheduleService.js";
import { notify } from "../../lib/notifications.js";
import { releaseEditLock } from "../../lib/editLocks.js";
import { supabase } from "../../lib/supabase.js";
import { attachTimelineScheduleSortOrders, planTimelineSchedule, timelineScheduleOperationTypes } from "../../lib/timelineSchedulePlanner.js";
import { isTransportationCard } from "../../lib/timelineTransportationRoles.js";
import { buildTransportPairSnapshot } from "../../lib/timelineTransportPairs.js";
import { normalizeTimelineItemPayload } from "../../components/timeline/timelineEditorForm.js";
import { isTimedVisit } from "../../lib/timelineUntimedOrdering.js";
import {
  defaultTransportCategory,
  sortedVisitItems,
  destinationReorderErrorMessage,
  alternativeApplyErrorMessage,
  timelineScheduleErrorMessage,
  timelineScheduleUpdatedAtBaselines,
  isEffectiveFixedVisit,
  isInvalidTimeRange,
  formatTimelineOverlapError,
  findOverlappingVisitItem,
} from "../../components/timeline/timelineItemRules.js";

export function createTimelineCommands({
  session,
  activeDay,
  items,
  alternatives,
  activeTrip,
  requestGuard,
  tripDataContext,
  canEditActiveTripContent,
  days,
  dayItems,
  loadTripData,
  rejectCrossTripSave,
  isCurrentTripContext,
  updateWithConflictCheck,
}) {
  async function ensureItineraryItemEditable(itemId) {
    const localItem = items.find((item) => item.id === itemId);
    if (localItem && isTransportationCard(localItem)) return true;
    if (localItem?.is_fixed) {
      notify.warning("此行程已固定，請先解鎖後再修改。");
      return false;
    }
    const { data, error } = await supabase
      .from("itinerary_items")
      .select("is_fixed")
      .eq("id", itemId)
      .eq("trip_id", activeTrip.id)
      .maybeSingle();
    if (error) {
      notify.error(error.message);
      return false;
    }
    if (data?.is_fixed) {
      notify.warning("此行程已固定，請先解鎖後再修改。");
      return false;
    }
    return true;
  }

  async function applyTimelineScheduleOperation({
    inlineFeedback = false,
    confirmedMajorEffect = null,
    dayIndex = activeDay,
    expectedVisitIds = null,
    itemUpdatedAtBaselines = null,
    operation,
    packageSourceItemIds = null,
    plan,
    slotItemIds = null,
    targetItemId = null,
    targetPayload = null,
  }) {
    if (!activeTrip || !plan?.ok || !operation || !itemUpdatedAtBaselines) return { ok: false };
    const sourceItems = items.filter((item) => Number(item.day_index) === Number(dayIndex));
    const result = await submitTimelineSchedule(supabase, {
      confirmedMajorEffect,
      expectedVisitIds: expectedVisitIds || sortedVisitItems(sourceItems).map((item) => item.id),
      itemUpdatedAtBaselines,
      operation,
      packageSourceItemIds,
      plan,
      slotItemIds,
      dayIndex,
      targetItemId,
      targetPayload,
      tripId: activeTrip.id,
    }, () => requestGuard.sameContext(tripDataContext));
    if (result.blocked) return { ok: false, errorMessage: result.blocked };
    const responseStatus = result.data?.status || null;
    if (result.error || responseStatus === "repreview_required") {
      const message = String(result.error?.message || responseStatus || "");
      const conflict = /stale_|repreview_required|transport_state_changed/.test(message);
      const errorMessage = conflict
        ? "此日行程已由其他成員更新，請重新載入最新資料後再試。"
        : destinationReorderErrorMessage(result.error || { message });
      if (!inlineFeedback) notify.error(errorMessage);
      if (conflict) await loadTripData(activeTrip.id);
      return { conflict, error: result.error, errorMessage, ok: false, preview: result.data?.preview || null };
    }
    await loadTripData(activeTrip.id);
    return { data: result.data, ok: true };
  }

  async function saveItem(payload, editingId, meta = {}) {
    if (!activeTrip || !canEditActiveTripContent) return;
    if (!isCurrentTripContext(meta)) return rejectCrossTripSave();
    const editingItem = editingId ? items.find((item) => item.id === editingId) : null;
    if (isEffectiveFixedVisit(editingItem)) {
      notify.warning("此行程已固定，請先解鎖後再修改。");
      return { ok: false, fixed: true };
    }
    if (editingId && !(await ensureItineraryItemEditable(editingId))) return { ok: false, fixed: true };
    if (payload?.item_type !== "transport" && Boolean(payload?.start_time) !== Boolean(payload?.end_time)) {
      const errorMessage = "開始與結束時間必須同時設定，或同時清除。";
      notify.error(errorMessage);
      return { ok: false, errorMessage };
    }
    const normalizedPayload = normalizeTimelineItemPayload(payload, defaultTransportCategory);
    if (
      isTransportationCard(normalizedPayload) &&
      (!normalizedPayload.from_item_id || !normalizedPayload.to_item_id)
    ) {
      notify.error("交通卡必須連接兩張相鄰行程。");
      return { ok: false };
    }
    const invalidTimeRange = !isTransportationCard(normalizedPayload) && isInvalidTimeRange(normalizedPayload.start_time, normalizedPayload.end_time);
    if (invalidTimeRange) {
      notify.error("結束時間必須晚於開始時間。");
      return { ok: false };
    }
    const overlapItem = findOverlappingVisitItem({
      dayIndex: activeDay,
      editingId,
      items,
      payload: normalizedPayload,
    });
    if (overlapItem && !editingId) {
      const overlapError = formatTimelineOverlapError(overlapItem);
      return { ok: false, overlapError };
    }
    const timelineSchedulePlan = meta.timelineSchedulePlan?.ok ? meta.timelineSchedulePlan : null;
    const timelineScheduleOperation = meta.timelineScheduleOperation || null;
    const timelineScheduleTargetId = meta.timelineScheduleTargetId || editingId;
    if (timelineScheduleTargetId && timelineSchedulePlan && timelineScheduleOperation) {
      const result = await applyTimelineScheduleOperation({
        inlineFeedback: true,
        confirmedMajorEffect: meta.confirmedScheduleEffect || null,
        expectedVisitIds: meta.timelineScheduleExpectedVisitIds,
        itemUpdatedAtBaselines: meta.timelineScheduleItemBaselines,
        operation: timelineScheduleOperation,
        plan: timelineSchedulePlan,
        targetItemId: timelineScheduleTargetId,
        targetPayload: normalizedPayload,
      });
      if (!result.ok) return result;
      await releaseEditLock({
        recordId: timelineScheduleTargetId,
        supabase,
        table: "itinerary_items",
        userId: session?.user?.id,
      });
      return {
        data: (result.data?.items || []).find((item) => item.id === timelineScheduleTargetId) || result.data,
        ok: true,
      };
    }
    if (editingId) {
      const result = await updateWithConflictCheck("itinerary_items", normalizedPayload, editingId, meta);
      if (result.error) notify.error(result.error.message);
      else if (result.conflict) notify.warning("此資料在你編輯期間已被其他人更新。");
      else await loadTripData(activeTrip.id);
      return result;
    }

    const sortOrder = (dayItems.filter((item) => !isTransportationCard(item)).length + 1) * 10;
    const insertResult = await supabase
      .from("itinerary_items")
      .insert({
        ...normalizedPayload,
        trip_id: activeTrip.id,
        day_index: activeDay,
        date: days[activeDay] ? dateToInputValue(days[activeDay]) : null,
        sort_order: sortOrder,
      })
      .select("*")
      .single();
    if (insertResult.error) {
      notify.error(insertResult.error.message);
      return { ok: false, error: insertResult.error };
    }
    await loadTripData(activeTrip.id);
    return { ok: true, data: insertResult.data };
  }

  async function saveAlternative(itemId, payload, editingId) {
    if (!activeTrip || !canEditActiveTripContent) return { ok: false };
    const item = items.find((currentItem) => currentItem.id === itemId);
    if (isEffectiveFixedVisit(item)) {
      notify.warning("此行程已固定，請先解鎖後再修改。");
      return { ok: false, error: { message: "此行程已固定，請先解鎖後再修改。" } };
    }
    if (!(await ensureItineraryItemEditable(itemId))) {
      return { ok: false, error: { message: "此行程已固定，請先解鎖後再修改。" } };
    }
    const nextPayload = {
      title: payload.title.trim(),
      type: payload.type || "attraction",
      start_time: payload.start_time || null,
      end_time: payload.end_time || null,
      cost: Number(payload.cost || 0),
      location_name: payload.location_name.trim() || null,
      address: payload.address.trim() || null,
      map_url: payload.map_url.trim() || null,
      latitude: payload.latitude ?? null,
      longitude: payload.longitude ?? null,
      description: payload.description.trim() || null,
      transportation_note: payload.transportation_note.trim() || null,
    };

    if (editingId) {
      const { error } = await supabase.from("itinerary_alternatives").update(nextPayload).eq("id", editingId);
      if (error) notify.error(error.message);
      else await loadTripData(activeTrip.id);
      return { ok: !error, error };
    }

    const { error } = await supabase.from("itinerary_alternatives").insert({
      ...nextPayload,
      itinerary_item_id: itemId,
    });
    if (error) notify.error(error.message);
    else await loadTripData(activeTrip.id);
    return { ok: !error, error };
  }

  async function deleteAlternative(alternativeId) {
    if (!activeTrip || !canEditActiveTripContent) return { ok: false };
    const alternative = alternatives.find((item) => item.id === alternativeId);
    const parentItem = alternative ? items.find((item) => item.id === alternative.itinerary_item_id) : null;
    if (isEffectiveFixedVisit(parentItem)) {
      notify.warning("此行程已固定，請先解鎖後再修改。");
      return { ok: false, error: { message: "此行程已固定，請先解鎖後再修改。" } };
    }
    if (parentItem && !(await ensureItineraryItemEditable(parentItem.id))) {
      return { ok: false, error: { message: "此行程已固定，請先解鎖後再修改。" } };
    }
    const { error } = await supabase.from("itinerary_alternatives").delete().eq("id", alternativeId);
    if (error) notify.error(error.message);
    else await loadTripData(activeTrip.id);
    return { ok: !error, error };
  }

  async function applyAlternative(item, alternative) {
    if (!activeTrip || !canEditActiveTripContent) return { ok: false };
    if (isEffectiveFixedVisit(item)) {
      notify.warning("此行程已固定，請先解鎖後再修改。");
      return { ok: false, error: { message: "此行程已固定，請先解鎖後再修改。" } };
    }
    const result = await supabase.rpc("apply_itinerary_alternative", {
      alternative_updated_at_baseline: alternative.updated_at,
      item_updated_at_baseline: item.updated_at,
      target_alternative_id: alternative.id,
      target_item_id: item.id,
    });
    if (result.error || !result.data?.ok) {
      const error = result.error || { message: "invalid_result" };
      const conflict = /stale_|item_not_found|alternative_not_found/.test(String(error.message || ""));
      const errorMessage = alternativeApplyErrorMessage(error);
      notify.error(errorMessage);
      if (conflict) await loadTripData(activeTrip.id);
      return { conflict, error, errorMessage, ok: false };
    }
    await loadTripData(activeTrip.id);
    return { data: result.data, ok: true };
  }

  async function deleteItem(itemId) {
    if (!activeTrip || !canEditActiveTripContent) return;
    const item = items.find((currentItem) => currentItem.id === itemId);
    if (isEffectiveFixedVisit(item)) {
      notify.warning("此行程已固定，請先解鎖後再修改。");
      return;
    }
    if (item && !isTransportationCard(item) && !(await ensureItineraryItemEditable(itemId))) return;
    if (item && isTransportationCard(item)) {
      const expectedVisitIds = sortedVisitItems(dayItems).map((visit) => visit.id);
      const operation = { transportId: item.id, type: timelineScheduleOperationTypes.deleteTransport };
      const plan = attachTimelineScheduleSortOrders({
        items: dayItems,
        plan: planTimelineSchedule({ items: dayItems, operation, orderedVisitIds: expectedVisitIds }),
      });
      if (!plan.ok) {
        notify.error(timelineScheduleErrorMessage(plan));
        return;
      }
      await applyTimelineScheduleOperation({
        expectedVisitIds,
        itemUpdatedAtBaselines: timelineScheduleUpdatedAtBaselines(dayItems),
        operation,
        plan,
        targetItemId: item.id,
      });
      return;
    }
    if (item && !isTransportationCard(item)) {
      const { error } = await supabase.rpc("delete_itinerary_item_budget_safe", { p_trip_id: activeTrip.id, p_id: itemId });
      if (error) notify.error(error.message);
      else await loadTripData(activeTrip.id);
      return;
    }
    const { error } = await supabase.from("itinerary_items").delete().eq("id", itemId).eq("trip_id", activeTrip.id);
    if (error) notify.error(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function toggleItemFixed(item) {
    if (!activeTrip || !canEditActiveTripContent || !item || isTransportationCard(item)) return { ok: false };
    if (!isTimedVisit(item)) {
      notify.error("未設定完整時間的行程不能固定。");
      return { ok: false };
    }
    if (!item.is_fixed && item.locked_by) {
      notify.warning("此行程目前有人正在編輯，暫時無法鎖定。");
      return { ok: false };
    }
    const nextFixed = !item.is_fixed;
    const { error } = await supabase
      .from("itinerary_items")
      .update({
        is_fixed: nextFixed,
        fixed_at: nextFixed ? new Date().toISOString() : null,
        fixed_by: nextFixed ? session.user.id : null,
      })
      .eq("id", item.id)
      .eq("trip_id", activeTrip.id);
    if (error) {
      notify.error(error.message);
      return { ok: false, error };
    }
    await loadTripData(activeTrip.id);
    return { ok: true };
  }

  async function confirmTransportWarning(itemId) {
    if (!activeTrip || !canEditActiveTripContent) return;
    const transportItem = items.find((item) => item.id === itemId);
    if (!transportItem) return;
    const snapshot = buildTransportPairSnapshot(
      items.find((item) => item.id === transportItem.from_item_id),
      items.find((item) => item.id === transportItem.to_item_id),
    );
    const { error } = await supabase
      .from("itinerary_items")
      .update({ ...snapshot, updated_at: new Date().toISOString() })
      .eq("id", itemId)
      .eq("trip_id", activeTrip.id);
    if (error) notify.error(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function reorderDestinationPackages({
    confirmedScheduleEffect = null,
    dayIndex,
    itemUpdatedAtBaselines = null,
    packageSourceItemIds,
    slotItemIds,
    timelineScheduleExpectedVisitIds = null,
    timelineScheduleOperation = null,
    timelineSchedulePlan = null,
  }) {
    if (!activeTrip || !canEditActiveTripContent || dayIndex !== activeDay) return { ok: false };
    if (!timelineSchedulePlan?.ok || !timelineScheduleOperation) {
      return { ok: false, errorMessage: "目前無法安全重新排程，請重新整理後再試。" };
    }
    return applyTimelineScheduleOperation({
      confirmedMajorEffect: confirmedScheduleEffect,
      dayIndex,
      expectedVisitIds: timelineScheduleExpectedVisitIds,
      itemUpdatedAtBaselines,
      operation: timelineScheduleOperation,
      packageSourceItemIds,
      plan: timelineSchedulePlan,
      slotItemIds,
    });
  }

  async function reorderUntimedVisit({
    confirmedScheduleEffect = null,
    dayIndex,
    itemUpdatedAtBaselines = null,
    timelineScheduleExpectedVisitIds = null,
    timelineScheduleOperation = null,
    timelineSchedulePlan = null,
  }) {
    if (!activeTrip || !canEditActiveTripContent || dayIndex !== activeDay) return { ok: false };
    if (!timelineSchedulePlan?.ok || !timelineScheduleOperation) {
      return { ok: false, errorMessage: "目前無法安全重新排程，請重新整理後再試。" };
    }
    return applyTimelineScheduleOperation({
      confirmedMajorEffect: confirmedScheduleEffect,
      dayIndex,
      expectedVisitIds: timelineScheduleExpectedVisitIds,
      itemUpdatedAtBaselines,
      operation: timelineScheduleOperation,
      plan: timelineSchedulePlan,
    });
  }

  return {
    saveItem,
    saveAlternative,
    deleteAlternative,
    applyAlternative,
    deleteItem,
    toggleItemFixed,
    confirmTransportWarning,
    reorderDestinationPackages,
    reorderUntimedVisit,
  };
}

export function readTimelineItems(client, tripId) {
  return client.from("itinerary_items").select("*").eq("trip_id", tripId);
}

export function readTimelineAlternatives(client) {
  return client.from("itinerary_alternatives").select("*");
}
