import { isEstablishedTransportPair, isTailPendingTransport, isTransportationCard } from "./timelineTransportationRoles.js";

const untimedSortBase = -2_000_000_000;
const untimedSortStride = 1_000_000;
const untimedSortMaxSlot = 1_900;
const legacyRankBase = 500_000;

function stableId(item) {
  return String(item?.id || "");
}

function timeToMinutes(value) {
  if (!value) return null;
  const [hours, minutes] = String(value).split(":");
  const parsedHours = Number(hours);
  const parsedMinutes = Number(minutes);
  if (!Number.isFinite(parsedHours) || !Number.isFinite(parsedMinutes)) return null;
  return parsedHours * 60 + parsedMinutes;
}

function compareTimedVisits(a, b) {
  return (
    String(a.start_time || "").localeCompare(String(b.start_time || "")) ||
    Number(a.sort_order || 0) - Number(b.sort_order || 0) ||
    stableId(a).localeCompare(stableId(b))
  );
}

function decodeUntimedSortOrder(sortOrder) {
  const value = Number(sortOrder);
  if (!Number.isInteger(value) || value < untimedSortBase || value >= -100_000_000) return null;
  const offset = value - untimedSortBase;
  const slot = Math.floor(offset / untimedSortStride);
  const rank = offset % untimedSortStride;
  if (slot < 0 || slot > untimedSortMaxSlot || rank <= 0 || rank >= untimedSortStride) return null;
  return { rank, slot };
}

function legacyUntimedRank(item) {
  const value = Number(item?.sort_order || 0);
  const bounded = Number.isFinite(value) ? Math.max(-100_000, Math.min(100_000, Math.trunc(value))) : 0;
  return legacyRankBase + bounded;
}

function untimedPlacement(item, timedCount) {
  const decoded = decodeUntimedSortOrder(item?.sort_order);
  if (decoded) return { rank: decoded.rank, slot: Math.min(decoded.slot, timedCount) };
  return { rank: legacyUntimedRank(item), slot: timedCount };
}

function encodeUntimedSortOrder(slot, rank) {
  if (!Number.isInteger(slot) || slot < 0 || slot > untimedSortMaxSlot) return null;
  if (!Number.isInteger(rank) || rank <= 0 || rank >= untimedSortStride) return null;
  return untimedSortBase + slot * untimedSortStride + rank;
}

export function isTimedVisit(item) {
  return Boolean(item) && !isTransportationCard(item) && Boolean(item.start_time) && Boolean(item.end_time);
}

export function isUntimedVisit(item) {
  return Boolean(item) && !isTransportationCard(item) && !isTimedVisit(item);
}

export function buildTimelineVisitDisplayOrder(items = []) {
  const visits = items.filter((item) => !isTransportationCard(item));
  const timedVisits = visits.filter(isTimedVisit).sort(compareTimedVisits);
  const untimedBySlot = new Map();

  visits.filter(isUntimedVisit).forEach((item) => {
    const placement = untimedPlacement(item, timedVisits.length);
    const entries = untimedBySlot.get(placement.slot) || [];
    entries.push({ item, rank: placement.rank });
    untimedBySlot.set(placement.slot, entries);
  });

  untimedBySlot.forEach((entries) => {
    entries.sort(
      (a, b) =>
        a.rank - b.rank ||
        String(a.item.created_at || "").localeCompare(String(b.item.created_at || "")) ||
        stableId(a.item).localeCompare(stableId(b.item)),
    );
  });

  const ordered = [];
  for (let slot = 0; slot <= timedVisits.length; slot += 1) {
    ordered.push(...(untimedBySlot.get(slot) || []).map((entry) => entry.item));
    if (slot < timedVisits.length) ordered.push(timedVisits[slot]);
  }
  items
    .filter((item) => isTransportationCard(item) && item.from_item_id && item.to_item_id)
    .forEach((transport) => {
      const fromIndex = ordered.findIndex((item) => item.id === transport.from_item_id);
      const toIndex = ordered.findIndex((item) => item.id === transport.to_item_id);
      if (fromIndex < 0 || toIndex < 0 || fromIndex !== toIndex + 1) return;
      const fromItem = ordered[fromIndex];
      const toItem = ordered[toIndex];
      if (!isUntimedVisit(fromItem) && !isUntimedVisit(toItem)) return;
      ordered[toIndex] = fromItem;
      ordered[fromIndex] = toItem;
    });
  return ordered;
}

export function planTimelineTimingChangeSortOrders({ items = [], replacements = [] }) {
  const replacementById = new Map(replacements.map((replacement) => [replacement.id, replacement]));
  const currentVisits = buildTimelineVisitDisplayOrder(items);
  if (replacementById.size !== replacements.length || replacements.some((replacement) => !currentVisits.some((item) => item.id === replacement.id))) {
    return { errorCode: "invalid_timing_change", ok: false, sortOrders: {} };
  }
  const finalItem = (item) => ({ ...item, ...(replacementById.get(item.id) || {}) });

  const untimedAfterConversion = currentVisits.filter((item) => isUntimedVisit(finalItem(item)));
  const untimedBySlot = new Map();
  untimedAfterConversion.forEach((item) => {
    const itemIndex = currentVisits.findIndex((candidate) => candidate.id === item.id);
    const slot = currentVisits
      .slice(0, itemIndex)
      .filter((candidate) => isTimedVisit(finalItem(candidate))).length;
    const entries = untimedBySlot.get(slot) || [];
    entries.push(item);
    untimedBySlot.set(slot, entries);
  });
  const sortOrders = {};
  for (const [slot, entries] of untimedBySlot.entries()) {
    const rankStep = Math.floor(untimedSortStride / (entries.length + 1));
    if (rankStep <= 0) return { errorCode: "order_space_exhausted", ok: false, sortOrders: {} };
    for (let index = 0; index < entries.length; index += 1) {
        const rank = rankStep * (index + 1);
        const sortOrder = encodeUntimedSortOrder(slot, rank);
        if (sortOrder === null) return { errorCode: "order_space_exhausted", ok: false, sortOrders: {} };
        sortOrders[entries[index].id] = sortOrder;
      }
  }

  return { ok: true, sortOrders };
}

export function planUntimedSortOrdersForVisualOrder({ items = [], nextVisitIds = [], replacements = [] }) {
  const replacementById = new Map(replacements.map((replacement) => [replacement.id, replacement]));
  const visits = items.filter((item) => !isTransportationCard(item));
  const visitById = new Map(visits.map((item) => [item.id, item]));
  if (
    new Set(nextVisitIds).size !== nextVisitIds.length ||
    nextVisitIds.length !== visits.length ||
    nextVisitIds.some((itemId) => !visitById.has(itemId))
  ) {
    return { errorCode: "invalid_timing_change", ok: false, sortOrders: {} };
  }

  const finalItem = (item) => ({ ...item, ...(replacementById.get(item.id) || {}) });
  const untimedBySlot = new Map();
  let timedBefore = 0;
  for (const itemId of nextVisitIds) {
    const item = visitById.get(itemId);
    if (isTimedVisit(finalItem(item))) {
      timedBefore += 1;
      continue;
    }
    const entries = untimedBySlot.get(timedBefore) || [];
    entries.push(item);
    untimedBySlot.set(timedBefore, entries);
  }

  const sortOrders = {};
  for (const [slot, entries] of untimedBySlot.entries()) {
    const rankStep = Math.floor(untimedSortStride / (entries.length + 1));
    if (rankStep <= 0) return { errorCode: "order_space_exhausted", ok: false, sortOrders: {} };
    for (let index = 0; index < entries.length; index += 1) {
      const sortOrder = encodeUntimedSortOrder(slot, rankStep * (index + 1));
      if (sortOrder === null) return { errorCode: "order_space_exhausted", ok: false, sortOrders: {} };
      sortOrders[entries[index].id] = sortOrder;
    }
  }

  return { ok: true, sortOrders };
}

export function planTailPendingPromotionUntimedBypass({
  items = [],
  promotedFromItemId,
  promotedToItemId,
  tailTransportItem,
}) {
  if (!isTailPendingTransport(tailTransportItem)) return { ok: true, untimedSortOrderUpdates: [] };
  if (!promotedFromItemId || !promotedToItemId || tailTransportItem.from_item_id !== promotedFromItemId) {
    return { ok: true, untimedSortOrderUpdates: [] };
  }

  const currentVisits = buildTimelineVisitDisplayOrder(items);
  const fromIndex = currentVisits.findIndex((item) => item.id === promotedFromItemId);
  const targetIndex = currentVisits.findIndex((item) => item.id === promotedToItemId);
  if (fromIndex < 0 || targetIndex < 0 || targetIndex <= fromIndex) return { ok: true, untimedSortOrderUpdates: [] };

  const fromItem = currentVisits[fromIndex];
  const targetItem = currentVisits[targetIndex];
  if (!isTimedVisit(fromItem) || !isTimedVisit(targetItem)) return { ok: true, untimedSortOrderUpdates: [] };

  const fromEnd = timeToMinutes(fromItem.end_time);
  const targetStart = timeToMinutes(targetItem.start_time);
  if (fromEnd !== null && targetStart !== null && targetStart < fromEnd) return { ok: true, untimedSortOrderUpdates: [] };

  const blockingUntimedItems = currentVisits.slice(fromIndex + 1, targetIndex).filter(isUntimedVisit);
  if (!blockingUntimedItems.length) return { ok: true, untimedSortOrderUpdates: [] };

  const blockingUntimedIds = new Set(blockingUntimedItems.map((item) => item.id));
  const nextVisitIds = currentVisits.map((item) => item.id).filter((itemId) => !blockingUntimedIds.has(itemId));
  const nextTargetIndex = nextVisitIds.indexOf(promotedToItemId);
  nextVisitIds.splice(nextTargetIndex + 1, 0, ...blockingUntimedItems.map((item) => item.id));

  const sortPlan = planUntimedSortOrdersForVisualOrder({ items, nextVisitIds });
  if (!sortPlan.ok) return sortPlan;
  return {
    ok: true,
    untimedSortOrderUpdates: Object.entries(sortPlan.sortOrders)
      .filter(([itemId]) => blockingUntimedIds.has(itemId))
      .map(([itemId, sortOrder]) => {
        const item = items.find((candidate) => candidate.id === itemId);
        return {
          id: itemId,
          original_sort_order: item?.sort_order,
          sort_order: sortOrder,
          updated_at: item?.updated_at || null,
        };
      }),
  };
}

export function planUntimedConversionSortOrders({ items = [], sourceItemIds = [] }) {
  const sourceIds = new Set(sourceItemIds);
  const currentVisits = buildTimelineVisitDisplayOrder(items);
  const convertedVisits = currentVisits.filter((item) => sourceIds.has(item.id) && isTimedVisit(item));
  if (convertedVisits.length !== sourceIds.size) {
    return { errorCode: "timed_source_required", ok: false, sortOrders: {} };
  }
  return planTimelineTimingChangeSortOrders({
    items,
    replacements: convertedVisits.map((item) => ({ id: item.id, start_time: null, end_time: null })),
  });
}

function validTransportationPairs(items, visits) {
  const indexById = new Map(visits.map((item, index) => [item.id, index]));
  return items
    .filter(
      (item) =>
        isTransportationCard(item) &&
        isEstablishedTransportPair(item) &&
        item.from_item_id &&
        item.to_item_id &&
        indexById.has(item.from_item_id) &&
        indexById.has(item.to_item_id) &&
        isTimedVisit(visits[indexById.get(item.from_item_id)]) &&
        isTimedVisit(visits[indexById.get(item.to_item_id)]) &&
        indexById.get(item.to_item_id) === indexById.get(item.from_item_id) + 1,
    )
    .map((item) => ({ fromItemId: item.from_item_id, id: item.id, toItemId: item.to_item_id }));
}

function brokenTransportationPairIds(items, currentVisits, nextVisits) {
  const protectedPairs = validTransportationPairs(items, currentVisits);
  const nextIndexById = new Map(nextVisits.map((item, index) => [item.id, index]));
  return protectedPairs
    .filter((pair) => nextIndexById.get(pair.toItemId) !== nextIndexById.get(pair.fromItemId) + 1)
    .map((pair) => pair.id);
}

function sameOrder(left, right) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function planUntimedVisitReorder({ items = [], placement = "after", sourceItemId, targetItemId }) {
  const currentVisits = buildTimelineVisitDisplayOrder(items);
  const source = currentVisits.find((item) => item.id === sourceItemId);
  const target = currentVisits.find((item) => item.id === targetItemId);
  if (!source || !isUntimedVisit(source)) return { errorCode: "untimed_source_required", ok: false };
  if (!target || target.id === source.id) return { errorCode: "invalid_target", ok: false };
  const nextVisits = currentVisits.filter((item) => item.id !== source.id);
  const targetIndex = nextVisits.findIndex((item) => item.id === target.id);
  const insertIndex = targetIndex + (placement === "before" ? 0 : 1);
  nextVisits.splice(insertIndex, 0, source);

  if (sameOrder(currentVisits.map((item) => item.id), nextVisits.map((item) => item.id))) {
    return { noOp: true, ok: true, sortOrder: source.sort_order };
  }

  const brokenTransportIds = brokenTransportationPairIds(items, currentVisits, nextVisits);

  const sourceIndex = nextVisits.findIndex((item) => item.id === source.id);
  const slot = nextVisits.slice(0, sourceIndex).filter(isTimedVisit).length;
  const untimedInSlot = nextVisits.filter((item, index) => {
    if (!isUntimedVisit(item)) return false;
    return nextVisits.slice(0, index).filter(isTimedVisit).length === slot;
  });
  const sourceSlotIndex = untimedInSlot.findIndex((item) => item.id === source.id);
  const previous = untimedInSlot[sourceSlotIndex - 1] || null;
  const next = untimedInSlot[sourceSlotIndex + 1] || null;
  const timedCount = currentVisits.filter(isTimedVisit).length;
  const previousRank = previous ? untimedPlacement(previous, timedCount).rank : 0;
  const nextRank = next ? untimedPlacement(next, timedCount).rank : untimedSortStride;
  const rank = Math.floor((previousRank + nextRank) / 2);
  const sortOrder = encodeUntimedSortOrder(slot, rank);
  if (sortOrder === null || rank <= previousRank || rank >= nextRank) {
    return { errorCode: "order_space_exhausted", ok: false };
  }

  return {
    nextVisitIds: nextVisits.map((item) => item.id),
    brokenTransportId: brokenTransportIds[0] || null,
    brokenTransportIds,
    ok: true,
    sortOrder,
    sourceItemId: source.id,
  };
}

export function planMixedTimedVisitReorder({ items = [], placement = "after", sourceItemId, targetItemId }) {
  const currentVisits = buildTimelineVisitDisplayOrder(items);
  const source = currentVisits.find((item) => item.id === sourceItemId);
  const target = currentVisits.find((item) => item.id === targetItemId);
  if (!source || !isTimedVisit(source)) return { errorCode: "timed_source_required", ok: false };
  if (!target || target.id === source.id || isTransportationCard(target)) return { errorCode: "invalid_target", ok: false };
  if (source.is_fixed) return { errorCode: "fixed_item", ok: false };

  const nextVisits = currentVisits.filter((item) => item.id !== source.id);
  const targetIndex = nextVisits.findIndex((item) => item.id === target.id);
  const insertIndex = targetIndex + (placement === "before" ? 0 : 1);
  nextVisits.splice(insertIndex, 0, source);

  const currentVisitIds = currentVisits.map((item) => item.id);
  const nextVisitIds = nextVisits.map((item) => item.id);
  const isMovableTimedVisit = (item) => isTimedVisit(item) && !item.is_fixed;
  const slotItemIds = currentVisits.filter(isMovableTimedVisit).map((item) => item.id);
  const packageSourceItemIds = nextVisits.filter(isMovableTimedVisit).map((item) => item.id);
  const untimedBySlot = new Map();
  nextVisits.filter(isUntimedVisit).forEach((item) => {
    const itemIndex = nextVisits.findIndex((candidate) => candidate.id === item.id);
    const slot = nextVisits.slice(0, itemIndex).filter(isTimedVisit).length;
    const entries = untimedBySlot.get(slot) || [];
    entries.push(item);
    untimedBySlot.set(slot, entries);
  });

  const untimedSortOrderUpdates = [];
  for (const [slot, entries] of untimedBySlot.entries()) {
    const rankStep = Math.floor(untimedSortStride / (entries.length + 1));
    if (rankStep <= 0) return { errorCode: "order_space_exhausted", ok: false };
    for (let index = 0; index < entries.length; index += 1) {
      const sortOrder = encodeUntimedSortOrder(slot, rankStep * (index + 1));
      if (sortOrder === null) return { errorCode: "order_space_exhausted", ok: false };
      if (entries[index].sort_order !== sortOrder) {
        untimedSortOrderUpdates.push({
          id: entries[index].id,
          original_sort_order: entries[index].sort_order,
          sort_order: sortOrder,
          updated_at: entries[index].updated_at || null,
        });
      }
    }
  }

  return {
    noOp: sameOrder(currentVisitIds, nextVisitIds),
    brokenTransportIds: brokenTransportationPairIds(items, currentVisits, nextVisits),
    ok: true,
    orderedTimedItemIds: nextVisits.filter(isTimedVisit).map((item) => item.id),
    orderedVisitItemIds: nextVisitIds,
    packageSourceItemIds,
    slotItemIds,
    sourceItemId: source.id,
    targetItemId: target.id,
    untimedSortOrderUpdates,
  };
}

export function untimedOrderingErrorMessage(errorCode) {
  if (errorCode === "transport_pair_blocked") {
    return "這裡已有交通卡連接，無法插入未設時間行程。請先刪除交通卡，或將行程放到其他位置。";
  }
  if (errorCode === "fixed_item") return "固定行程無法調整位置。";
  if (errorCode === "order_space_exhausted") return "這個位置暫時無法插入，請重新整理後再試。";
  return "未設定時間行程移動失敗，請稍後再試。";
}
