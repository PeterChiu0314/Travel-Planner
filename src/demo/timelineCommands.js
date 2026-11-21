import { planDestinationPackageReorder } from "../lib/destinationPackages.js";
import {
  applyTimelineSchedulePlanToItems,
  attachTimelineScheduleSortOrders,
  planTimelineSchedule,
  remapTimelineSchedulePlanItemIds,
  timelineScheduleOperationTypes,
} from "../lib/timelineSchedulePlanner.js";
import { isTransportationCard } from "../lib/timelineTransportationRoles.js";
import { buildTransportPairSnapshot } from "../lib/timelineTransportPairs.js";
import { normalizeTimelineItemPayload } from "../components/timeline/timelineEditorForm.js";
import { isTimedVisit } from "../lib/timelineUntimedOrdering.js";
import {
  defaultTransportCategory,
  emptyItemForm,
  sortedVisitItems,
  destinationReorderErrorMessage,
  isEffectiveFixedVisit,
  isInvalidTimeRange,
  formatTimelineOverlapError,
  findOverlappingVisitItem,
} from "../components/timeline/timelineItemRules.js";
import { demoId, demoSortOrderForNewTimelineItem } from "./timelineFixtures.js";

export function createDemoTimelineCommands({
    activeDay,
    demoActiveTrip,
    timelineItems,
    setTimelineItems,
    timelineAlternatives,
    setTimelineAlternatives,
    itineraryBudgetLinks,
  }) {
  function saveTimelineItem(payload, editingId, meta = {}) {
    const nextPayload = normalizeTimelineItemPayload(payload, defaultTransportCategory);
    if (!nextPayload.title.trim()) return { ok: false };
    if (nextPayload.item_type !== "transport" && Boolean(nextPayload.start_time) !== Boolean(nextPayload.end_time)) {
      return { ok: false, errorMessage: "開始與結束時間必須同時設定，或同時清除。" };
    }
    const editingItem = editingId ? timelineItems.find((item) => item.id === editingId) : null;
    if (isEffectiveFixedVisit(editingItem)) return { ok: false, fixed: true };

    const timelineScheduleTargetId = meta.timelineScheduleTargetId || editingId;
    if (timelineScheduleTargetId && meta.timelineSchedulePlan?.ok) {
      const schedulePlan = meta.timelineSchedulePlan.upsertedTransport
        ? {
            ...meta.timelineSchedulePlan,
            upsertedTransport: {
              ...meta.timelineSchedulePlan.upsertedTransport,
              day_index: activeDay,
              sort_order: meta.timelineSchedulePlan.upsertedTransport.sort_order ?? 0,
              trip_id: demoActiveTrip.id,
            },
          }
        : meta.timelineSchedulePlan;
      const updatedAt = new Date().toISOString();
      setTimelineItems((current) =>
        applyTimelineSchedulePlanToItems({
          items: current,
          plan: schedulePlan,
          targetItemId: timelineScheduleTargetId,
          targetPayload: nextPayload,
          updatedAt,
        }),
      );
      return {
        data: { ...(editingItem || {}), ...nextPayload, id: timelineScheduleTargetId, updated_at: updatedAt },
        ok: true,
      };
    }

    if (nextPayload.item_type !== "transport" && isInvalidTimeRange(nextPayload.start_time, nextPayload.end_time)) {
      return { ok: false };
    }
    const overlapItem = findOverlappingVisitItem({
      dayIndex: activeDay,
      editingId,
      items: timelineItems,
      payload: nextPayload,
    });
    if (overlapItem && !editingId) {
      return { ok: false, overlapError: formatTimelineOverlapError(overlapItem) };
    }
    if (isTransportationCard(nextPayload) && (!nextPayload.from_item_id || !nextPayload.to_item_id)) {
      return { ok: false };
    }
    if (editingId) {
      setTimelineItems((current) =>
        current.map((item) =>
          item.id === editingId ? { ...item, ...nextPayload, updated_at: new Date().toISOString() } : item,
        ),
      );
      return { ok: true };
    }

    const newItemId = demoId(nextPayload.item_type === "transport" ? "demo-transport" : "demo-itinerary");
    setTimelineItems((current) => {
      const currentDayVisits = sortedVisitItems(current.filter((item) => item.day_index === activeDay));
      const sortOrder = demoSortOrderForNewTimelineItem({ currentDayVisits, item: nextPayload });
      return [
        ...current,
        {
          ...emptyItemForm,
          ...nextPayload,
          id: newItemId,
          trip_id: demoActiveTrip.id,
          day_index: activeDay,
          sort_order: sortOrder,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];
    });
    return { ok: true, data: { id: newItemId } };
  }

  function reorderTimelineDestinationPackages({
    dayIndex,
    orderedTimedItemIds,
    orderedVisitItemIds,
    packageSourceItemIds,
    slotItemIds,
    timelineSchedulePlan = null,
  }) {
    if (dayIndex !== activeDay || !timelineSchedulePlan?.ok) return { ok: false };
    const packagePlan = planDestinationPackageReorder({
      alternatives: timelineAlternatives,
      itineraryBudgetLinks,
      items: timelineItems,
      orderedTimedItemIds,
      orderedVisitItemIds,
      packageSourceItemIds,
      slotItemIds,
    });
    if (!packagePlan.ok) {
      return { ok: false, errorMessage: destinationReorderErrorMessage({ message: packagePlan.errorCode }) };
    }
    const sourceToSlotIds = new Map(packageSourceItemIds.map((sourceId, index) => [sourceId, slotItemIds[index]]));
    const mappedSchedulePlan = remapTimelineSchedulePlanItemIds({ plan: timelineSchedulePlan, sourceToSlotIds });
    const updatedAt = new Date().toISOString();
    setTimelineItems(
      applyTimelineSchedulePlanToItems({ items: packagePlan.items, plan: mappedSchedulePlan, updatedAt }),
    );
    setTimelineAlternatives(packagePlan.alternatives);
    setItineraryBudgetLinks(packagePlan.itineraryBudgetLinks);
    return { ok: true, data: { packagePlan, schedulePlan: mappedSchedulePlan } };
  }

  function reorderTimelineUntimedVisit({ dayIndex, timelineSchedulePlan = null }) {
    if (dayIndex !== activeDay || !timelineSchedulePlan?.ok) return { ok: false };
    setTimelineItems((current) =>
      applyTimelineSchedulePlanToItems({
        items: current,
        plan: timelineSchedulePlan,
        updatedAt: new Date().toISOString(),
      }),
    );
    return { ok: true };
  }

  function confirmTimelineTransportWarning(itemId) {
    setTimelineItems((current) =>
      current.map((item) => {
        if (item.id !== itemId) return item;
        return {
          ...item,
          ...buildTransportPairSnapshot(
            current.find((currentItem) => currentItem.id === item.from_item_id),
            current.find((currentItem) => currentItem.id === item.to_item_id),
          ),
          updated_at: new Date().toISOString(),
        };
      }),
    );
  }

  function saveTimelineAlternative(itemId, payload, editingId) {
    const item = timelineItems.find((currentItem) => currentItem.id === itemId);
    if (isEffectiveFixedVisit(item)) return { ok: false, error: { message: "此行程已固定，請先解鎖後再修改。" } };
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
      updated_at: new Date().toISOString(),
    };
    if (!nextPayload.title) return { ok: false };
    if (editingId) {
      setTimelineAlternatives((current) =>
        current.map((alternative) => (alternative.id === editingId ? { ...alternative, ...nextPayload } : alternative)),
      );
      return { ok: true };
    }
    setTimelineAlternatives((current) => [
      ...current.filter((alternative) => alternative.itinerary_item_id !== itemId),
      { ...nextPayload, id: demoId("demo-alternative"), itinerary_item_id: itemId },
    ]);
    return { ok: true };
  }

  function deleteTimelineAlternative(alternativeId) {
    const alternative = timelineAlternatives.find((item) => item.id === alternativeId);
    const parentItem = alternative ? timelineItems.find((item) => item.id === alternative.itinerary_item_id) : null;
    if (isEffectiveFixedVisit(parentItem)) return { ok: false, error: { message: "此行程已固定，請先解鎖後再修改。" } };
    setTimelineAlternatives((current) => current.filter((alternative) => alternative.id !== alternativeId));
    return { ok: true };
  }

  function deleteTimelineItem(itemId) {
    const deletedIds = new Set([itemId]);
    const deletedItem = timelineItems.find((item) => item.id === itemId);
    if (isEffectiveFixedVisit(deletedItem)) return;
    if (deletedItem && isTransportationCard(deletedItem)) {
      const currentDayItems = timelineItems.filter((item) => Number(item.day_index) === Number(activeDay));
      const expectedVisitIds = sortedVisitItems(currentDayItems).map((visit) => visit.id);
      const plan = attachTimelineScheduleSortOrders({
        items: currentDayItems,
        plan: planTimelineSchedule({
          items: currentDayItems,
          operation: { transportId: deletedItem.id, type: timelineScheduleOperationTypes.deleteTransport },
          orderedVisitIds: expectedVisitIds,
        }),
      });
      if (!plan.ok) return;
      setTimelineItems((current) =>
        applyTimelineSchedulePlanToItems({ items: current, plan, updatedAt: new Date().toISOString() }),
      );
      return;
    }
    if (deletedItem && !isTransportationCard(deletedItem)) {
      timelineItems.forEach((item) => {
        if (isTransportationCard(item) && (item.from_item_id === itemId || item.to_item_id === itemId)) {
          deletedIds.add(item.id);
        }
      });
    }
    setTimelineItems((current) => current.filter((item) => !deletedIds.has(item.id)));
    setItineraryBudgetLinks((current) => current.filter((link) => !deletedIds.has(link.itinerary_item_id)));
  }

  function toggleTimelineItemFixed(item) {
    if (!item || isTransportationCard(item)) return { ok: false };
    if (!isTimedVisit(item)) return { ok: false };
    setTimelineItems((current) =>
      current.map((currentItem) =>
        currentItem.id === item.id
          ? {
              ...currentItem,
              is_fixed: !currentItem.is_fixed,
              fixed_at: currentItem.is_fixed ? null : new Date().toISOString(),
              fixed_by: currentItem.is_fixed ? null : "demo-peter",
              updated_at: new Date().toISOString(),
            }
          : currentItem,
      ),
    );
    return { ok: true };
  }

  function applyTimelineAlternative(item, alternative) {
    if (isEffectiveFixedVisit(item)) return { ok: false };
    const oldMainPayload = {
      title: item.title,
      type: item.type || "attraction",
      start_time: item.start_time || null,
      end_time: item.end_time || null,
      cost: Number(item.cost || 0),
      location_name: item.location_name || item.location || null,
      address: item.address || null,
      map_url: item.map_url || null,
      latitude: item.latitude ?? null,
      longitude: item.longitude ?? null,
      description: item.description || item.note || null,
      transportation_note: item.transportation_note || null,
      updated_at: new Date().toISOString(),
    };
    const nextPayload = normalizeTimelineItemPayload({
      ...item,
      title: alternative.title,
      type: alternative.type || item.type,
      start_time: item.start_time || "",
      end_time: item.end_time || "",
      location: alternative.location_name || "",
      location_name: alternative.location_name || "",
      address: alternative.address || "",
      map_url: alternative.map_url || "",
      latitude: alternative.latitude ?? null,
      longitude: alternative.longitude ?? null,
      note: alternative.description || "",
      description: alternative.description || "",
      transportation_note: alternative.transportation_note || "",
      cost: alternative.cost || 0,
    }, defaultTransportCategory);
    if (nextPayload.item_type !== "transport" && isInvalidTimeRange(nextPayload.start_time, nextPayload.end_time)) return { ok: false };
    setTimelineItems((current) =>
      current.map((currentItem) => (currentItem.id === item.id ? { ...currentItem, ...nextPayload, updated_at: new Date().toISOString() } : currentItem)),
    );
    setTimelineAlternatives((current) =>
      current.map((currentAlternative) => (currentAlternative.id === alternative.id ? { ...currentAlternative, ...oldMainPayload } : currentAlternative)),
    );
    return { ok: true };
  }

  return {
    saveTimelineItem,
    reorderTimelineDestinationPackages,
    reorderTimelineUntimedVisit,
    confirmTimelineTransportWarning,
    saveTimelineAlternative,
    deleteTimelineAlternative,
    deleteTimelineItem,
    toggleTimelineItemFixed,
    applyTimelineAlternative,
  };
}
