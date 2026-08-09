import {
  attachTimelineScheduleSortOrders,
  planTimelineSchedule,
  remapTimelineSchedulePlanItemIds,
  timelineScheduleOperationTypes,
} from "./timelineSchedulePlanner.js";
import { buildTimelineVisitDisplayOrder, isTimedVisit } from "./timelineUntimedOrdering.js";
import { isEstablishedTransportPair, isTransportationCard } from "./timelineTransportationRoles.js";

export const destinationPackageFields = [
  "type",
  "title",
  "location",
  "note",
  "cost",
  "location_name",
  "address",
  "map_url",
  "latitude",
  "longitude",
  "description",
  "transportation_note",
];

export function destinationPackage(item) {
  return Object.fromEntries(destinationPackageFields.map((field) => [field, item?.[field] ?? null]));
}

export function swapDestinationPackagesInItems(items, sourceItemId, targetItemId, updatedAt = new Date().toISOString()) {
  const sourceItem = items.find((item) => item.id === sourceItemId);
  const targetItem = items.find((item) => item.id === targetItemId);
  if (!sourceItem || !targetItem) return items;
  const sourcePackage = destinationPackage(sourceItem);
  const targetPackage = destinationPackage(targetItem);
  return items.map((item) => {
    if (item.id === sourceItemId) return { ...item, ...targetPackage, updated_at: updatedAt };
    if (item.id === targetItemId) return { ...item, ...sourcePackage, updated_at: updatedAt };
    return item;
  });
}

export function swapItineraryParentIds(records, sourceItemId, targetItemId) {
  return records.map((record) => {
    if (record.itinerary_item_id === sourceItemId) return { ...record, itinerary_item_id: targetItemId };
    if (record.itinerary_item_id === targetItemId) return { ...record, itinerary_item_id: sourceItemId };
    return record;
  });
}

export function insertionPackageOrder(slotItemIds, sourceItemId, targetItemId, placement) {
  if (!Array.isArray(slotItemIds) || !slotItemIds.includes(sourceItemId) || !slotItemIds.includes(targetItemId)) {
    return slotItemIds;
  }
  if (sourceItemId === targetItemId || !["before", "after"].includes(placement)) return slotItemIds;
  const remainingIds = slotItemIds.filter((itemId) => itemId !== sourceItemId);
  const targetIndex = remainingIds.indexOf(targetItemId);
  if (targetIndex < 0) return slotItemIds;
  const insertionIndex = targetIndex + (placement === "after" ? 1 : 0);
  return [...remainingIds.slice(0, insertionIndex), sourceItemId, ...remainingIds.slice(insertionIndex)];
}

export function isSamePackageOrder(slotItemIds, packageSourceItemIds) {
  return (
    slotItemIds.length === packageSourceItemIds.length &&
    slotItemIds.every((itemId, index) => itemId === packageSourceItemIds[index])
  );
}

export function hasTimedDragOrderChange({ currentTimedItemIds = [], orderedTimedItemIds = null, packageSourceItemIds, slotItemIds }) {
  if (!isSamePackageOrder(slotItemIds, packageSourceItemIds)) return true;
  if (!Array.isArray(orderedTimedItemIds)) return false;
  return !isSamePackageOrder(currentTimedItemIds, orderedTimedItemIds);
}

function isFixedAnchor(item) {
  return Boolean(item?.is_fixed) && isTimedVisit(item);
}

function validPermutation(slotItemIds, packageSourceItemIds) {
  if (!Array.isArray(slotItemIds) || !Array.isArray(packageSourceItemIds) || !slotItemIds.length) return false;
  if (slotItemIds.length !== packageSourceItemIds.length) return false;
  if (new Set(slotItemIds).size !== slotItemIds.length || new Set(packageSourceItemIds).size !== packageSourceItemIds.length) {
    return false;
  }
  const slotIdSet = new Set(slotItemIds);
  return packageSourceItemIds.every((itemId) => slotIdSet.has(itemId));
}

// Compatibility for historical Phase 4 tests and non-App consumers. The old
// continuation algorithm is gone; this adapter delegates every time decision
// to the Phase 6 Planner and only reshapes its stable-slot output.
export function planTimedDragAutoContinuation({
  items = [],
  orderedVisitItemIds = null,
  packageSourceItemIds,
  slotItemIds,
}) {
  if (!validPermutation(slotItemIds, packageSourceItemIds)) {
    return { ok: false, errorCode: "invalid_manifest", updatesBySlotId: {} };
  }
  const currentVisitIds = buildTimelineVisitDisplayOrder(items).map((item) => item.id);
  const nextVisitIds = Array.isArray(orderedVisitItemIds) ? orderedVisitItemIds : packageSourceItemIds;
  const basePlan = attachTimelineScheduleSortOrders({
    items,
    plan: planTimelineSchedule({
      items,
      operation: { orderedVisitIds: nextVisitIds, type: timelineScheduleOperationTypes.reorder },
      orderedVisitIds: currentVisitIds,
    }),
  });
  if (!basePlan.ok) return { ok: false, errorCode: basePlan.validationError, updatesBySlotId: {} };

  const sourceToSlotIds = new Map(packageSourceItemIds.map((sourceId, index) => [sourceId, slotItemIds[index]]));
  const sourceIdBySlotId = new Map(packageSourceItemIds.map((sourceId, index) => [slotItemIds[index], sourceId]));
  const mappedPlan = remapTimelineSchedulePlanItemIds({ plan: basePlan, sourceToSlotIds });
  const slotIdSet = new Set(slotItemIds);
  const updatesBySlotId = {};
  const untimedSortOrderUpdates = [];
  for (const update of mappedPlan.updatedItems || []) {
    if (!slotIdSet.has(update.id)) continue;
    const original = items.find((item) => item.id === update.id);
    updatesBySlotId[update.id] = {
      ...update,
      original_end_time: original?.end_time ?? null,
      original_sort_order: original?.sort_order ?? null,
      original_start_time: original?.start_time ?? null,
      source_item_id: sourceIdBySlotId.get(update.id),
    };
    if (Object.hasOwn(update, "sort_order")) {
      untimedSortOrderUpdates.push({
        id: update.id,
        original_sort_order: original?.sort_order ?? null,
        sort_order: update.sort_order,
        updated_at: original?.updated_at || null,
      });
    }
  }
  return {
    convertedSlotIds: [...(mappedPlan.automaticUntimedItemIds || [])],
    ok: true,
    plan: mappedPlan,
    untimedSortOrderUpdates,
    updatesBySlotId,
  };
}

export function planDestinationPackageReorder({
  alternatives = [],
  itineraryBudgetLinks = [],
  items = [],
  orderedVisitItemIds = null,
  packageSourceItemIds,
  slotItemIds,
  timedAutoContinuation = false,
  updatedAt = new Date().toISOString(),
}) {
  if (!validPermutation(slotItemIds, packageSourceItemIds)) {
    return { ok: false, errorCode: "invalid_manifest" };
  }
  const slotItems = slotItemIds.map((itemId) => items.find((item) => item.id === itemId));
  if (slotItems.some((item) => !item)) return { ok: false, errorCode: "invalid_manifest" };
  const tripId = slotItems[0].trip_id;
  const dayIndex = slotItems[0].day_index;
  if (
    slotItems.some(
      (item) =>
        item.trip_id !== tripId ||
        item.day_index !== dayIndex ||
        isTransportationCard(item) ||
        !isTimedVisit(item) ||
        isFixedAnchor(item),
    )
  ) {
    return { ok: false, errorCode: "timed_visit_required" };
  }

  const authoritativeSlotIds = items
    .filter(
      (item) =>
        item.trip_id === tripId &&
        item.day_index === dayIndex &&
        isTimedVisit(item) &&
        !isFixedAnchor(item),
    )
    .sort((a, b) => {
      const timeSort = String(a.start_time).localeCompare(String(b.start_time));
      const orderSort = Number(a.sort_order || 0) - Number(b.sort_order || 0);
      return timeSort || orderSort || String(a.id).localeCompare(String(b.id));
    })
    .map((item) => item.id);
  if (!isSamePackageOrder(authoritativeSlotIds, slotItemIds)) {
    return { ok: false, errorCode: "stale_manifest" };
  }

  const timingPlan = timedAutoContinuation
    ? planTimedDragAutoContinuation({ items, orderedVisitItemIds, packageSourceItemIds, slotItemIds })
    : { convertedSlotIds: [], ok: true, untimedSortOrderUpdates: [], updatesBySlotId: {} };
  if (!timingPlan.ok) return { ok: false, errorCode: timingPlan.errorCode };

  const packageBySourceId = new Map(slotItems.map((item) => [item.id, destinationPackage(item)]));
  const newSlotBySourceId = new Map(packageSourceItemIds.map((sourceId, index) => [sourceId, slotItemIds[index]]));
  const nextItemsById = new Map(
    slotItemIds.map((slotId, index) => [
      slotId,
      {
        ...items.find((item) => item.id === slotId),
        ...packageBySourceId.get(packageSourceItemIds[index]),
        ...(timingPlan.updatesBySlotId[slotId]
          ? {
              end_time: timingPlan.updatesBySlotId[slotId].end_time,
              start_time: timingPlan.updatesBySlotId[slotId].start_time,
              ...(Number.isInteger(timingPlan.updatesBySlotId[slotId].sort_order)
                ? { sort_order: timingPlan.updatesBySlotId[slotId].sort_order }
                : {}),
            }
          : {}),
        updated_at: updatedAt,
      },
    ]),
  );

  const currentVisits = buildTimelineVisitDisplayOrder(items);
  const currentIndexById = new Map(currentVisits.map((item, index) => [item.id, index]));
  const currentVisitById = new Map(currentVisits.map((item) => [item.id, item]));
  const finalVisitSourceIds = Array.isArray(orderedVisitItemIds) ? orderedVisitItemIds : packageSourceItemIds;
  const finalIndexBySourceId = new Map(finalVisitSourceIds.map((itemId, index) => [itemId, index]));
  const finalIdForSourceId = (sourceId) => newSlotBySourceId.get(sourceId) || sourceId;
  const preservedTransportItems = [];
  const deletedTransportIds = [];
  const finalTransportPairKeys = new Set();
  for (const transportItem of items.filter(
    (item) => item.trip_id === tripId && item.day_index === dayIndex && isTransportationCard(item),
  )) {
    if (!isEstablishedTransportPair(transportItem)) {
      deletedTransportIds.push(transportItem.id);
      continue;
    }
    const originalFromIndex = currentIndexById.get(transportItem.from_item_id);
    const originalToIndex = currentIndexById.get(transportItem.to_item_id);
    const wasActive =
      Number.isInteger(originalFromIndex) &&
      Number.isInteger(originalToIndex) &&
      originalToIndex === originalFromIndex + 1 &&
      isTimedVisit(currentVisitById.get(transportItem.from_item_id)) &&
      isTimedVisit(currentVisitById.get(transportItem.to_item_id));
    const nextFromIndex = finalIndexBySourceId.get(transportItem.from_item_id);
    const nextToIndex = finalIndexBySourceId.get(transportItem.to_item_id);
    if (wasActive && (!Number.isInteger(nextFromIndex) || !Number.isInteger(nextToIndex) || nextToIndex !== nextFromIndex + 1)) {
      deletedTransportIds.push(transportItem.id);
      continue;
    }
    const nextFromId = finalIdForSourceId(transportItem.from_item_id);
    const nextToId = finalIdForSourceId(transportItem.to_item_id);
    const pairKey = `${nextFromId}->${nextToId}`;
    if (finalTransportPairKeys.has(pairKey)) return { ok: false, errorCode: "transport_state_changed" };
    finalTransportPairKeys.add(pairKey);
    preservedTransportItems.push({
      ...transportItem,
      from_item_id: nextFromId,
      to_item_id: nextToId,
      updated_at: updatedAt,
    });
  }

  const preservedTransportById = new Map(preservedTransportItems.map((item) => [item.id, item]));
  const deletedTransportIdSet = new Set(deletedTransportIds);
  const timingSortOrderById = new Map(
    (timingPlan.untimedSortOrderUpdates || []).map((update) => [update.id, update.sort_order]),
  );
  const nextItems = items
    .filter((item) => !deletedTransportIdSet.has(item.id))
    .map((item) => {
      const nextItem = nextItemsById.get(item.id) || preservedTransportById.get(item.id) || item;
      return timingSortOrderById.has(item.id)
        ? { ...nextItem, sort_order: timingSortOrderById.get(item.id), updated_at: updatedAt }
        : nextItem;
    });
  const remapParent = (record) => ({
    ...record,
    itinerary_item_id: newSlotBySourceId.get(record.itinerary_item_id) || record.itinerary_item_id,
  });

  return {
    alternatives: alternatives.map(remapParent),
    convertedSlotIds: timingPlan.convertedSlotIds || [],
    deletedTransportIds,
    itineraryBudgetLinks: itineraryBudgetLinks.map(remapParent),
    items: nextItems,
    ok: true,
    packageSourceItemIds: [...packageSourceItemIds],
    preservedTransportIds: preservedTransportItems.map((item) => item.id),
    slotItemIds: [...slotItemIds],
    timedAutoContinuationUpdates: timingPlan.updatesBySlotId,
    untimedSortOrderUpdates: timingPlan.untimedSortOrderUpdates || [],
    updatedVisitCount: slotItemIds.length,
  };
}
