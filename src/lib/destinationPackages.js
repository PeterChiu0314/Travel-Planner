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
        !item.start_time,
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
        item.item_type !== "transport" &&
        Boolean(item.start_time),
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

  const packageBySourceId = new Map(slotItems.map((item) => [item.id, destinationPackage(item)]));
  const newSlotBySourceId = new Map(packageSourceItemIds.map((sourceId, index) => [sourceId, slotItemIds[index]]));
  const newIndexBySourceId = new Map(packageSourceItemIds.map((sourceId, index) => [sourceId, index]));
  const nextItemsById = new Map(
    slotItemIds.map((slotId, index) => [
      slotId,
      {
        ...items.find((item) => item.id === slotId),
        ...packageBySourceId.get(packageSourceItemIds[index]),
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
    preservedTransportIds: preservedTransportItems.map((item) => item.id),
    deletedTransportIds,
    updatedVisitCount: slotItemIds.length,
  };
}
