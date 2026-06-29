import { isTimedVisit } from "./timelineUntimedOrdering.js";

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

function timeToMinutes(value) {
  if (!value) return null;
  const [hours, minutes] = String(value).split(":");
  const parsedHours = Number(hours);
  const parsedMinutes = Number(minutes);
  if (!Number.isFinite(parsedHours) || !Number.isFinite(parsedMinutes)) return null;
  return parsedHours * 60 + parsedMinutes;
}

function minutesToTime(totalMinutes) {
  if (!Number.isInteger(totalMinutes) || totalMinutes < 0 || totalMinutes >= 24 * 60) return null;
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function planTimedDragAutoContinuation({ items = [], packageSourceItemIds, slotItemIds }) {
  if (!validPermutation(slotItemIds, packageSourceItemIds)) {
    return { ok: false, errorCode: "invalid_manifest", updatesBySlotId: {} };
  }

  const slotItems = slotItemIds.map((itemId) => items.find((item) => item.id === itemId));
  const sourceItems = packageSourceItemIds.map((itemId) => items.find((item) => item.id === itemId));
  if (slotItems.some((item) => !isTimedVisit(item)) || sourceItems.some((item) => !isTimedVisit(item))) {
    return { ok: false, errorCode: "timed_visit_required", updatesBySlotId: {} };
  }

  const originalIndexBySourceId = new Map(slotItemIds.map((itemId, index) => [itemId, index]));
  const firstOriginalStart = timeToMinutes(slotItems[0].start_time);
  if (firstOriginalStart === null) return { ok: false, errorCode: "invalid_time", updatesBySlotId: {} };

  const updatesBySlotId = {};
  let nextStart = firstOriginalStart;
  let previousSource = null;
  for (let index = 0; index < packageSourceItemIds.length; index += 1) {
    const source = sourceItems[index];
    const sourceStart = timeToMinutes(source.start_time);
    const sourceEnd = timeToMinutes(source.end_time);
    if (sourceStart === null || sourceEnd === null || sourceEnd <= sourceStart) {
      return { ok: false, errorCode: "invalid_time", updatesBySlotId: {} };
    }

    if (previousSource) {
      const previousOriginalIndex = originalIndexBySourceId.get(previousSource.id);
      const currentOriginalIndex = originalIndexBySourceId.get(source.id);
      if (currentOriginalIndex === previousOriginalIndex + 1) {
        const previousOriginalEnd = timeToMinutes(previousSource.end_time);
        const originalGap = sourceStart - previousOriginalEnd;
        if (previousOriginalEnd === null || originalGap < 0) {
          return { ok: false, errorCode: "invalid_gap", updatesBySlotId: {} };
        }
        nextStart += originalGap;
      }
    }

    const duration = sourceEnd - sourceStart;
    const nextEnd = nextStart + duration;
    const nextStartTime = minutesToTime(nextStart);
    const nextEndTime = minutesToTime(nextEnd);
    if (!nextStartTime || !nextEndTime) {
      return { ok: false, errorCode: "invalid_time", updatesBySlotId: {} };
    }

    updatesBySlotId[slotItemIds[index]] = {
      end_time: nextEndTime,
      original_end_time: slotItems[index].end_time,
      original_start_time: slotItems[index].start_time,
      source_item_id: source.id,
      start_time: nextStartTime,
    };
    nextStart = nextEnd;
    previousSource = source;
  }

  return { ok: true, updatesBySlotId };
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

export function planDestinationPackageReorder({
  alternatives = [],
  itineraryBudgetLinks = [],
  items = [],
  packageSourceItemIds,
  slotItemIds,
  timedAutoContinuation = false,
  updatedAt = new Date().toISOString(),
}) {
  if (!validPermutation(slotItemIds, packageSourceItemIds)) {
    return { ok: false, errorCode: "invalid_manifest" };
  }
  const slotIdSet = new Set(slotItemIds);
  const slotItems = slotItemIds.map((itemId) => items.find((item) => item.id === itemId));
  if (slotItems.some((item) => !item)) return { ok: false, errorCode: "invalid_manifest" };
  const tripId = slotItems[0].trip_id;
  const dayIndex = slotItems[0].day_index;
  if (
    slotItems.some(
      (item) =>
        item.trip_id !== tripId ||
        item.day_index !== dayIndex ||
        item.item_type === "transport" ||
        !isTimedVisit(item),
    )
  ) {
    return { ok: false, errorCode: "timed_visit_required" };
  }
  if (slotItems.some((item) => item.is_fixed)) return { ok: false, errorCode: "fixed_item" };

  const authoritativeSlotIds = items
    .filter(
      (item) =>
        item.trip_id === tripId &&
        item.day_index === dayIndex &&
        isTimedVisit(item),
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
    ? planTimedDragAutoContinuation({ items, packageSourceItemIds, slotItemIds })
    : { ok: true, updatesBySlotId: {} };
  if (!timingPlan.ok) return { ok: false, errorCode: timingPlan.errorCode };

  const packageBySourceId = new Map(slotItems.map((item) => [item.id, destinationPackage(item)]));
  const newSlotBySourceId = new Map(packageSourceItemIds.map((sourceId, index) => [sourceId, slotItemIds[index]]));
  const newIndexBySourceId = new Map(packageSourceItemIds.map((sourceId, index) => [sourceId, index]));
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
            }
          : {}),
        updated_at: updatedAt,
      },
    ]),
  );

  const transportItems = items.filter(
    (item) => item.trip_id === tripId && item.day_index === dayIndex && item.item_type === "transport",
  );
  const preservedTransportItems = [];
  const deletedTransportIds = [];
  const finalTransportPairKeys = new Set();
  for (const transportItem of transportItems) {
    const fromIndex = newIndexBySourceId.get(transportItem.from_item_id);
    const toIndex = newIndexBySourceId.get(transportItem.to_item_id);
    const isTail = Boolean(transportItem.from_item_id) && !transportItem.to_item_id;
    const preserveNormal = Number.isInteger(fromIndex) && Number.isInteger(toIndex) && toIndex === fromIndex + 1;
    const preserveTail = isTail && Number.isInteger(fromIndex) && fromIndex === packageSourceItemIds.length - 1;
    if (!preserveNormal && !preserveTail) {
      deletedTransportIds.push(transportItem.id);
      continue;
    }
    const nextFromId = newSlotBySourceId.get(transportItem.from_item_id);
    const nextToId = preserveTail ? null : newSlotBySourceId.get(transportItem.to_item_id);
    const pairKey = `${nextFromId || ""}->${nextToId || ""}`;
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
  const nextItems = items
    .filter((item) => !deletedTransportIdSet.has(item.id))
    .map((item) => nextItemsById.get(item.id) || preservedTransportById.get(item.id) || item);
  const remapParent = (record) => ({
    ...record,
    itinerary_item_id: newSlotBySourceId.get(record.itinerary_item_id) || record.itinerary_item_id,
  });

  return {
    ok: true,
    items: nextItems,
    alternatives: alternatives.map(remapParent),
    itineraryBudgetLinks: itineraryBudgetLinks.map(remapParent),
    packageSourceItemIds: [...packageSourceItemIds],
    slotItemIds: [...slotItemIds],
    timedAutoContinuationUpdates: timingPlan.updatesBySlotId,
    preservedTransportIds: preservedTransportItems.map((item) => item.id),
    deletedTransportIds,
    updatedVisitCount: slotItemIds.length,
  };
}
