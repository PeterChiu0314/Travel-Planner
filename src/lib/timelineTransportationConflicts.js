import { isTimedVisit } from "./timelineUntimedOrdering.js";
import { isNormalTransportPair, isTransportationCard } from "./timelineTransportationRoles.js";

function compareTimedVisits(a, b) {
  const timeSort = String(a?.start_time || "99:99").localeCompare(String(b?.start_time || "99:99"));
  const orderSort = Number(a?.sort_order || 0) - Number(b?.sort_order || 0);
  return timeSort || orderSort || String(a?.id || "").localeCompare(String(b?.id || ""));
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
  const currentIndexById = new Map(currentTimedVisits.map((item, index) => [item.id, index]));
  const candidateIndexById = new Map(candidateOrder.map((item, index) => [item.id, index]));
  const brokenTransport = items.find(
    (item) =>
      isTransportationCard(item) &&
      isNormalTransportPair(item) &&
      Number(item.day_index) === Number(dayIndex) &&
      item.from_item_id &&
      item.to_item_id &&
      currentIndexById.get(item.to_item_id) === currentIndexById.get(item.from_item_id) + 1 &&
      candidateIndexById.get(item.to_item_id) !== candidateIndexById.get(item.from_item_id) + 1,
  );
  if (!brokenTransport) return null;

  const fromItem = currentTimedVisits.find((item) => item.id === brokenTransport.from_item_id);
  const toItem = currentTimedVisits.find((item) => item.id === brokenTransport.to_item_id);
  if (!fromItem || !toItem) return null;
  return { fromItem, toItem, transportItem: brokenTransport };
}
