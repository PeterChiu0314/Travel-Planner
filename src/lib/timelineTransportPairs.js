import { isEstablishedTransportPair, isTransportationCard, normalizeTransportSnapshotTime, transportPairKey } from "./timelineTransportationRoles.js";
import { isTimedVisit, isUntimedVisit } from "./timelineUntimedOrdering.js";

export function visitSnapshotDestination(item) {
  return item?.location_name || item?.location || item?.title || "";
}

export function buildTransportPairSnapshot(fromItem, toItem) {
  return {
    from_snapshot_start_time: normalizeTransportSnapshotTime(fromItem?.start_time),
    from_snapshot_end_time: normalizeTransportSnapshotTime(fromItem?.end_time),
    from_snapshot_destination: visitSnapshotDestination(fromItem) || null,
    to_snapshot_start_time: normalizeTransportSnapshotTime(toItem?.start_time),
    to_snapshot_end_time: normalizeTransportSnapshotTime(toItem?.end_time),
    to_snapshot_destination: visitSnapshotDestination(toItem) || null,
  };
}

function transportSnapshotMatchesVisit(transportItem, prefix, visitItem) {
  return (
    normalizeTransportSnapshotTime(transportItem?.[`${prefix}_snapshot_start_time`]) ===
      normalizeTransportSnapshotTime(visitItem?.start_time) &&
    normalizeTransportSnapshotTime(transportItem?.[`${prefix}_snapshot_end_time`]) ===
      normalizeTransportSnapshotTime(visitItem?.end_time) &&
    (transportItem?.[`${prefix}_snapshot_destination`] || null) === (visitSnapshotDestination(visitItem) || null)
  );
}

export function buildTransportPairState(items, visits) {
  const adjacentKeys = new Set();
  const visitIds = new Set(visits.map((item) => item.id));
  visits.forEach((item, index) => {
    const nextItem = visits[index + 1];
    if (nextItem) adjacentKeys.add(transportPairKey(item.id, nextItem.id));
  });

  const adjacentTransportByPair = {};
  const passiveUntimedTransportByFrom = {};
  const invalidTransportItems = [];
  const visitById = new Map(visits.map((item) => [item.id, item]));
  const visitIndexById = new Map(visits.map((item, index) => [item.id, index]));
  items
    .filter((item) => isTransportationCard(item))
    .forEach((item) => {
      const hasPair = isEstablishedTransportPair(item) && item.from_item_id && item.to_item_id;
      const pairKey = hasPair ? transportPairKey(item.from_item_id, item.to_item_id) : "";
      const pairExists = hasPair && visitIds.has(item.from_item_id) && visitIds.has(item.to_item_id);
      const pairIsAdjacent = pairExists && adjacentKeys.has(pairKey);
      const fromVisit = visitById.get(item.from_item_id) || null;
      const toVisit = visitById.get(item.to_item_id) || null;
      const fromIndex = visitIndexById.get(item.from_item_id);
      const toIndex = visitIndexById.get(item.to_item_id);
      const blockedByUntimed =
        Number.isInteger(fromIndex) &&
        Number.isInteger(toIndex) &&
        toIndex > fromIndex + 1 &&
        visits.slice(fromIndex + 1, toIndex).some(isUntimedVisit);
      const hasPassiveUntimedEndpoint =
        Boolean(fromVisit) &&
        hasPair &&
        Boolean(toVisit) &&
        (!isTimedVisit(fromVisit) || !isTimedVisit(toVisit) || blockedByUntimed);

      if (hasPassiveUntimedEndpoint) {
        passiveUntimedTransportByFrom[item.from_item_id] = [
          ...(passiveUntimedTransportByFrom[item.from_item_id] || []),
          item,
        ];
        return;
      }

      if (pairIsAdjacent) {
        if (!adjacentTransportByPair[pairKey]) adjacentTransportByPair[pairKey] = item;
        return;
      }

      invalidTransportItems.push(item);
    });

  return { adjacentTransportByPair, invalidTransportItems, passiveUntimedTransportByFrom };
}

export function transportPairNeedsReview(transportItem, fromItem, toItem) {
  return !transportSnapshotMatchesVisit(transportItem, "from", fromItem) || !transportSnapshotMatchesVisit(transportItem, "to", toItem);
}
