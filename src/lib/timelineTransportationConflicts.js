import { isTimedVisit } from "./timelineUntimedOrdering.js";

function isTransportationCard(item) {
  return item?.item_type === "transport";
}

function compareTimedVisits(a, b) {
  const timeSort = String(a?.start_time || "99:99").localeCompare(String(b?.start_time || "99:99"));
  const orderSort = Number(a?.sort_order || 0) - Number(b?.sort_order || 0);
  return timeSort || orderSort || String(a?.id || "").localeCompare(String(b?.id || ""));
}

function pairKey(fromItemId, toItemId) {
  return `${fromItemId || ""}->${toItemId || ""}`;
}

export function findBrokenTransportationPair({ candidate, dayIndex, editingId = null, items = [] }) {
  if (!candidate || isTransportationCard(candidate) || !isTimedVisit(candidate)) return null;

  const currentTimedVisits = items
    .filter(
      (item) =>
        !isTransportationCard(item) &&
        isTimedVisit(item) &&
        Number(item.day_index) === Number(dayIndex),
    )
    .sort(compareTimedVisits);
  const currentAdjacentPairs = new Set(
    currentTimedVisits.slice(0, -1).map((item, index) => pairKey(item.id, currentTimedVisits[index + 1].id)),
  );
  const editingItem = editingId ? currentTimedVisits.find((item) => item.id === editingId) : null;
  const candidateItem = {
    ...(editingItem || {}),
    ...candidate,
    id: editingId || "__candidate_timed_visit__",
    day_index: dayIndex,
    sort_order:
      editingItem?.sort_order ??
      (currentTimedVisits.length + 1) * 10,
  };
  const candidateOrder = [
    ...currentTimedVisits.filter((item) => item.id !== editingId),
    candidateItem,
  ].sort(compareTimedVisits);
  const candidateIndex = candidateOrder.findIndex((item) => item.id === candidateItem.id);
  if (candidateIndex <= 0 || candidateIndex >= candidateOrder.length - 1) return null;

  const fromItem = candidateOrder[candidateIndex - 1];
  const toItem = candidateOrder[candidateIndex + 1];
  const originalPairKey = pairKey(fromItem.id, toItem.id);
  if (!currentAdjacentPairs.has(originalPairKey)) return null;

  const transportItem = items.find(
    (item) =>
      isTransportationCard(item) &&
      Number(item.day_index) === Number(dayIndex) &&
      item.from_item_id === fromItem.id &&
      item.to_item_id === toItem.id,
  );
  if (!transportItem) return null;

  return { fromItem, toItem, transportItem };
}
