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
