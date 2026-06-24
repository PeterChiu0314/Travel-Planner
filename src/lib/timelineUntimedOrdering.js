const untimedSortBase = -2_000_000_000;
const untimedSortStride = 1_000_000;
const untimedSortMaxSlot = 1_900;
const legacyRankBase = 500_000;

function isTransportationCard(item) {
  return item?.item_type === "transport";
}

function stableId(item) {
  return String(item?.id || "");
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

export function isUntimedVisit(item) {
  return Boolean(item) && !isTransportationCard(item) && !item.start_time;
}

export function buildTimelineVisitDisplayOrder(items = []) {
  const visits = items.filter((item) => !isTransportationCard(item));
  const timedVisits = visits.filter((item) => Boolean(item.start_time)).sort(compareTimedVisits);
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
  return ordered;
}

function validTransportationPairs(items, visits) {
  const indexById = new Map(visits.map((item, index) => [item.id, index]));
  return items
    .filter(
      (item) =>
        isTransportationCard(item) &&
        item.from_item_id &&
        item.to_item_id &&
        indexById.has(item.from_item_id) &&
        indexById.has(item.to_item_id) &&
        visits[indexById.get(item.from_item_id)]?.start_time &&
        visits[indexById.get(item.to_item_id)]?.start_time &&
        indexById.get(item.to_item_id) === indexById.get(item.from_item_id) + 1,
    )
    .map((item) => ({ fromItemId: item.from_item_id, id: item.id, toItemId: item.to_item_id }));
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
  if (source.is_fixed) return { errorCode: "fixed_item", ok: false };

  const nextVisits = currentVisits.filter((item) => item.id !== source.id);
  const targetIndex = nextVisits.findIndex((item) => item.id === target.id);
  const insertIndex = targetIndex + (placement === "before" ? 0 : 1);
  nextVisits.splice(insertIndex, 0, source);

  if (sameOrder(currentVisits.map((item) => item.id), nextVisits.map((item) => item.id))) {
    return { noOp: true, ok: true, sortOrder: source.sort_order };
  }

  const protectedPairs = validTransportationPairs(items, currentVisits);
  const nextIndexById = new Map(nextVisits.map((item, index) => [item.id, index]));
  const brokenPair = protectedPairs.find(
    (pair) => nextIndexById.get(pair.toItemId) !== nextIndexById.get(pair.fromItemId) + 1,
  );
  if (brokenPair) return { brokenTransportId: brokenPair.id, errorCode: "transport_pair_blocked", ok: false };

  const sourceIndex = nextVisits.findIndex((item) => item.id === source.id);
  const slot = nextVisits.slice(0, sourceIndex).filter((item) => Boolean(item.start_time)).length;
  const untimedInSlot = nextVisits.filter((item, index) => {
    if (!isUntimedVisit(item)) return false;
    return nextVisits.slice(0, index).filter((candidate) => Boolean(candidate.start_time)).length === slot;
  });
  const sourceSlotIndex = untimedInSlot.findIndex((item) => item.id === source.id);
  const previous = untimedInSlot[sourceSlotIndex - 1] || null;
  const next = untimedInSlot[sourceSlotIndex + 1] || null;
  const previousRank = previous ? untimedPlacement(previous, currentVisits.filter((item) => item.start_time).length).rank : 0;
  const nextRank = next ? untimedPlacement(next, currentVisits.filter((item) => item.start_time).length).rank : untimedSortStride;
  const rank = Math.floor((previousRank + nextRank) / 2);
  const sortOrder = encodeUntimedSortOrder(slot, rank);
  if (sortOrder === null || rank <= previousRank || rank >= nextRank) {
    return { errorCode: "order_space_exhausted", ok: false };
  }

  return {
    nextVisitIds: nextVisits.map((item) => item.id),
    ok: true,
    sortOrder,
    sourceItemId: source.id,
  };
}

export function untimedOrderingErrorMessage(errorCode) {
  if (errorCode === "transport_pair_blocked") {
    return "這裡已有交通卡連接，無法插入未設定時間行程。請先刪除交通卡，或將行程放到其他位置。";
  }
  if (errorCode === "fixed_item") return "固定行程無法調整位置。";
  if (errorCode === "order_space_exhausted") return "這個位置暫時無法插入，請重新整理後再試。";
  return "未設定時間行程移動失敗，請稍後再試。";
}
