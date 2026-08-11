import { planUntimedSortOrdersForVisualOrder } from "./timelineUntimedOrdering.js";
import { isTransportationCard } from "./timelineTransportationRoles.js";
import { roundMinutesUpToStep } from "./timelineTime.js";

export const timelineScheduleOperationTypes = Object.freeze({
  clearTime: "clear_time",
  deleteTransport: "delete_transport",
  editTime: "edit_time",
  reorder: "reorder",
  restoreTime: "restore_time",
  upsertTransport: "upsert_transport",
});

const validOperationTypes = new Set(Object.values(timelineScheduleOperationTypes));
const dayBoundaryMinutes = 24 * 60;

export function timelineTimeToMinutes(value, { allowDayBoundary = false } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const match = String(value).trim().match(/^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || minutes < 0 || minutes > 59) return null;
  if (hours === 24 && minutes === 0 && allowDayBoundary) return dayBoundaryMinutes;
  if (hours < 0 || hours > 23) return null;
  return hours * 60 + minutes;
}

export function timelineMinutesToTime(totalMinutes) {
  if (!Number.isInteger(totalMinutes) || totalMinutes < 0 || totalMinutes > dayBoundaryMinutes) return null;
  if (totalMinutes === dayBoundaryMinutes) return "24:00";
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

function sameTime(left, right) {
  const normalize = (value) => (value ? String(value).slice(0, 5) : null);
  return normalize(left) === normalize(right);
}

function visitTimeState(item) {
  const hasStart = Boolean(item?.start_time);
  const hasEnd = Boolean(item?.end_time);
  if (hasStart !== hasEnd) return { state: "partial" };
  if (!hasStart) return { state: "untimed" };
  const start = timelineTimeToMinutes(item.start_time);
  const end = timelineTimeToMinutes(item.end_time, { allowDayBoundary: true });
  if (start === null || end === null || end <= start) return { state: "invalid" };
  return { duration: end - start, end, start, state: "timed" };
}

function stableId(item) {
  return String(item?.id || "");
}

function normalTransport(item) {
  return isTransportationCard(item) && item.transport_role === "normal_pair";
}

function transportDuration(item) {
  const duration = Number(item?.transport_duration_minutes ?? 0);
  return Number.isInteger(duration) && duration > 0 ? duration : null;
}

function destinationLabel(item) {
  return item?.location_name || item?.location || item?.title || "";
}

function buildOrderedVisits(items, orderedVisitIds) {
  const visits = items.filter((item) => !isTransportationCard(item));
  const visitById = new Map(visits.map((item) => [item.id, item]));
  const ids = Array.isArray(orderedVisitIds) && orderedVisitIds.length
    ? [...orderedVisitIds]
    : visits.map((item) => item.id);
  if (
    ids.length !== visits.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !visitById.has(id))
  ) {
    return { error: "invalid_manifest" };
  }
  return { visits: ids.map((id) => ({ ...visitById.get(id) })) };
}

function firstDifferentIndex(currentIds, nextIds) {
  const length = Math.min(currentIds.length, nextIds.length);
  for (let index = 0; index < length; index += 1) {
    if (currentIds[index] !== nextIds[index]) return index;
  }
  return currentIds.length === nextIds.length ? -1 : length;
}

function precedingTimedIndex(visits, startIndex) {
  for (let index = startIndex - 1; index >= 0; index -= 1) {
    if (visitTimeState(visits[index]).state === "timed") return index;
  }
  return -1;
}

function nextFixedIndex(visits, startIndex) {
  for (let index = startIndex; index < visits.length; index += 1) {
    if (visits[index]?.is_fixed && visitTimeState(visits[index]).state === "timed") return index;
  }
  return -1;
}

function transportByPair(transports, removedIds, fromItem, toItem, fromIndex, toIndex) {
  if (!fromItem || !toItem || toIndex !== fromIndex + 1) return null;
  if (visitTimeState(fromItem).state !== "timed" || visitTimeState(toItem).state !== "timed") return null;
  return transports.find(
    (item) =>
      !removedIds.has(item.id) &&
      normalTransport(item) &&
      item.from_item_id === fromItem.id &&
      item.to_item_id === toItem.id,
  ) || null;
}

function resultError(validationError, extra = {}) {
  return {
    affectedItemIds: [],
    ok: false,
    requiresConfirmation: false,
    validationError,
    ...extra,
  };
}

function updateVisitTime(context, item, startTime, endTime, automaticUntimed = false) {
  const start = startTime ?? null;
  const end = endTime ?? null;
  if (sameTime(item.start_time, start) && sameTime(item.end_time, end)) return;
  item.start_time = start;
  item.end_time = end;
  context.updatedById.set(item.id, { id: item.id, start_time: start, end_time: end });
  if (!start && !end) {
    context.untimedIds.add(item.id);
    if (automaticUntimed) context.automaticUntimedIds.add(item.id);
  }
}

function scheduleSegment(context, startIndex, { anchorStart = null } = {}) {
  const { removedIds, transports, visits } = context;
  const fixedIndex = nextFixedIndex(visits, startIndex);
  const segmentEnd = fixedIndex >= 0 ? fixedIndex : visits.length;
  const boundary = fixedIndex >= 0
    ? visitTimeState(visits[fixedIndex]).start
    : dayBoundaryMinutes;
  let previousIndex = precedingTimedIndex(visits, startIndex);
  let previousEnd = previousIndex >= 0 ? visitTimeState(visits[previousIndex]).end : null;
  let firstTimed = true;

  for (let index = startIndex; index < segmentEnd; index += 1) {
    const item = visits[index];
    const state = visitTimeState(item);
    if (state.state !== "timed") continue;

    let nextStart;
    if (firstTimed && anchorStart !== null) {
      nextStart = anchorStart;
    } else if (previousEnd !== null) {
      const transport = transportByPair(transports, removedIds, visits[previousIndex], item, previousIndex, index);
      nextStart = roundMinutesUpToStep(previousEnd + (transport ? transportDuration(transport) : 0));
    } else {
      nextStart = state.start;
    }
    const nextEnd = nextStart + state.duration;
    const fixedBoundaryTransport =
      fixedIndex >= 0 && index === fixedIndex - 1
        ? transportByPair(transports, removedIds, item, visits[fixedIndex], index, fixedIndex)
        : null;
    const requiredEnd = nextEnd + (fixedBoundaryTransport ? transportDuration(fixedBoundaryTransport) : 0);
    if (requiredEnd > boundary) {
      for (let overflowIndex = index; overflowIndex < segmentEnd; overflowIndex += 1) {
        const overflowItem = visits[overflowIndex];
        if (visitTimeState(overflowItem).state === "timed" && !overflowItem.is_fixed) {
          updateVisitTime(context, overflowItem, null, null, true);
        }
      }
      context.overflowReason = fixedIndex >= 0 ? "fixed" : "day_boundary";
      context.stoppedAtFixedItemId = fixedIndex >= 0 ? visits[fixedIndex].id : null;
      return;
    }

    updateVisitTime(context, item, timelineMinutesToTime(nextStart), timelineMinutesToTime(nextEnd));
    previousEnd = nextEnd;
    previousIndex = index;
    firstTimed = false;
  }
  if (fixedIndex >= 0) context.stoppedAtFixedItemId = visits[fixedIndex].id;
}

function collectBrokenTransportIds(transports, originalVisits, nextVisits) {
  const originalIndexById = new Map(originalVisits.map((item, index) => [item.id, index]));
  const nextIndexById = new Map(nextVisits.map((item, index) => [item.id, index]));
  const originalById = new Map(originalVisits.map((item) => [item.id, item]));
  return transports
    .filter(normalTransport)
    .filter((item) => {
      const originalFromIndex = originalIndexById.get(item.from_item_id);
      const originalToIndex = originalIndexById.get(item.to_item_id);
      const wasActive =
        Number.isInteger(originalFromIndex) &&
        Number.isInteger(originalToIndex) &&
        originalToIndex === originalFromIndex + 1 &&
        visitTimeState(originalById.get(item.from_item_id)).state === "timed" &&
        visitTimeState(originalById.get(item.to_item_id)).state === "timed";
      if (!wasActive) return false;
      const nextFromIndex = nextIndexById.get(item.from_item_id);
      const nextToIndex = nextIndexById.get(item.to_item_id);
      return !Number.isInteger(nextFromIndex) || !Number.isInteger(nextToIndex) || nextToIndex !== nextFromIndex + 1;
    })
    .map((item) => item.id)
    .sort();
}

function collectTransportEffects(context) {
  const { removedIds, transports, visits } = context;
  const indexById = new Map(visits.map((item, index) => [item.id, index]));
  const visitById = new Map(visits.map((item) => [item.id, item]));
  const suspended = new Set();
  for (const transport of transports) {
    if (removedIds.has(transport.id) || !normalTransport(transport)) continue;
    const fromItem = visitById.get(transport.from_item_id);
    const toItem = visitById.get(transport.to_item_id);
    const fromIndex = indexById.get(transport.from_item_id);
    const toIndex = indexById.get(transport.to_item_id);
    const validAdjacency = Number.isInteger(fromIndex) && Number.isInteger(toIndex) && toIndex === fromIndex + 1;
    const blockedByUntimed =
      Number.isInteger(fromIndex) &&
      Number.isInteger(toIndex) &&
      toIndex > fromIndex + 1 &&
      visits.slice(fromIndex + 1, toIndex).some((item) => visitTimeState(item).state === "untimed");
    const active =
      validAdjacency &&
      visitTimeState(fromItem).state === "timed" &&
      visitTimeState(toItem).state === "timed";
    if (
      !active &&
      fromItem &&
      toItem &&
      (
        blockedByUntimed ||
        visitTimeState(fromItem).state !== "timed" ||
        visitTimeState(toItem).state !== "timed"
      )
    ) suspended.add(transport.id);
    if (!validAdjacency || !fromItem || !toItem) continue;
    const snapshotUpdate = {
      from_snapshot_destination: destinationLabel(fromItem) || null,
      from_snapshot_end_time: fromItem.end_time || null,
      from_snapshot_start_time: fromItem.start_time || null,
      id: transport.id,
      to_snapshot_destination: destinationLabel(toItem) || null,
      to_snapshot_end_time: toItem.end_time || null,
      to_snapshot_start_time: toItem.start_time || null,
    };
    const changed = Object.entries(snapshotUpdate).some(([key, value]) => key !== "id" && (transport[key] || null) !== value);
    if (changed) context.updatedById.set(transport.id, { ...(context.updatedById.get(transport.id) || { id: transport.id }), ...snapshotUpdate });
  }
  context.suspendedIds = suspended;
}

export function planTimelineSchedule({ items = [], operation, orderedVisitIds } = {}) {
  if (!operation || !validOperationTypes.has(operation.type)) return resultError("invalid_operation");
  const clonedItems = items.map((item) => ({ ...item }));
  const ordered = buildOrderedVisits(clonedItems, orderedVisitIds);
  if (ordered.error) return resultError(ordered.error);
  const originalVisits = ordered.visits;
  const invalidVisit = originalVisits.find((item) => ["partial", "invalid"].includes(visitTimeState(item).state));
  if (invalidVisit) {
    return resultError(visitTimeState(invalidVisit).state === "partial" ? "partial_time" : "invalid_range", {
      invalidItemId: invalidVisit.id,
    });
  }

  let visits = originalVisits.map((item) => ({ ...item }));
  let transports = clonedItems
    .filter(isTransportationCard)
    .map((item) => ({ ...item }))
    .sort((a, b) => stableId(a).localeCompare(stableId(b)));
  const context = {
    automaticUntimedIds: new Set(),
    overflowReason: null,
    removedIds: new Set(),
    stoppedAtFixedItemId: null,
    suspendedIds: new Set(),
    transports,
    untimedIds: new Set(),
    updatedById: new Map(),
    visits,
  };
  const currentIds = originalVisits.map((item) => item.id);
  let operationStartIndex = -1;
  let explicitRemovedTransportId = null;
  let upsertedTransport = null;

  if ([timelineScheduleOperationTypes.editTime, timelineScheduleOperationTypes.restoreTime].includes(operation.type)) {
    const targetIndex = visits.findIndex((item) => item.id === operation.targetItemId);
    if (targetIndex < 0) return resultError("invalid_target");
    const target = visits[targetIndex];
    if (target.is_fixed && visitTimeState(target).state === "timed") return resultError("fixed_item");
    const start = timelineTimeToMinutes(operation.start_time ?? operation.targetStartTime);
    const end = timelineTimeToMinutes(operation.end_time ?? operation.targetEndTime, { allowDayBoundary: true });
    if (start === null || end === null) return resultError("partial_time");
    if (end <= start) return resultError("invalid_range");
    const previousIndex = precedingTimedIndex(visits, targetIndex);
    if (previousIndex >= 0) {
      const previous = visits[previousIndex];
      const pairTransport = transportByPair(transports, context.removedIds, previous, target, previousIndex, targetIndex);
      const earliestStart = roundMinutesUpToStep(
        visitTimeState(previous).end + (pairTransport ? transportDuration(pairTransport) : 0),
      );
      if (start < earliestStart) return resultError("earlier_conflict", { earliestStart: timelineMinutesToTime(earliestStart) });
    }
    updateVisitTime(context, target, timelineMinutesToTime(start), timelineMinutesToTime(end));
    operationStartIndex = targetIndex;
    scheduleSegment(context, targetIndex, { anchorStart: start });
  } else if (operation.type === timelineScheduleOperationTypes.clearTime) {
    const targetIndex = visits.findIndex((item) => item.id === operation.targetItemId);
    if (targetIndex < 0) return resultError("invalid_target");
    const target = visits[targetIndex];
    if (target.is_fixed && visitTimeState(target).state === "timed") return resultError("fixed_item");
    updateVisitTime(context, target, null, null);
    operationStartIndex = targetIndex;
    scheduleSegment(context, targetIndex + 1);
  } else if (operation.type === timelineScheduleOperationTypes.upsertTransport) {
    const transport = { ...(operation.transport || {}) };
    if (!transport.id || !transport.from_item_id || !transport.to_item_id) return resultError("invalid_transport");
    if (visits.some((item) => item.id === transport.id)) return resultError("invalid_transport");
    transport.item_type = "transport";
    transport.transport_role = "normal_pair";
    if (transportDuration(transport) === null) return resultError("invalid_transport");
    const fromIndex = visits.findIndex((item) => item.id === transport.from_item_id);
    const toIndex = visits.findIndex((item) => item.id === transport.to_item_id);
    if (fromIndex < 0 || toIndex !== fromIndex + 1) return resultError("invalid_transport");
    const existingIndex = transports.findIndex((item) => item.id === transport.id);
    if (existingIndex >= 0) transports[existingIndex] = { ...transports[existingIndex], ...transport };
    else transports.push(transport);
    context.transports = transports;
    upsertedTransport = transport;
    operationStartIndex = toIndex;
    const fromState = visitTimeState(visits[fromIndex]);
    const toState = visitTimeState(visits[toIndex]);
    if (fromState.state === "timed" && toState.state === "timed") {
      if (visits[toIndex].is_fixed) {
        if (fromState.end + transportDuration(transport) > toState.start) return resultError("fixed_boundary_conflict");
      } else {
        scheduleSegment(context, toIndex);
      }
    }
  } else if (operation.type === timelineScheduleOperationTypes.deleteTransport) {
    const transportId = operation.transportId || operation.targetItemId;
    const transport = transports.find((item) => item.id === transportId);
    if (!transport || !normalTransport(transport)) return resultError("invalid_transport");
    const toIndex = visits.findIndex((item) => item.id === transport.to_item_id);
    const fromIndex = visits.findIndex((item) => item.id === transport.from_item_id);
    if (fromIndex < 0 || toIndex < 0) return resultError("invalid_transport");
    context.removedIds.add(transport.id);
    explicitRemovedTransportId = transport.id;
    operationStartIndex = toIndex;
    if (visitTimeState(visits[fromIndex]).state === "timed" && visitTimeState(visits[toIndex]).state === "timed" && !visits[toIndex].is_fixed) {
      scheduleSegment(context, toIndex);
    }
  } else if (operation.type === timelineScheduleOperationTypes.reorder) {
    const nextIds = operation.orderedVisitIds;
    if (!Array.isArray(nextIds) || nextIds.length !== originalVisits.length) return resultError("invalid_manifest");
    const nextOrder = buildOrderedVisits(clonedItems, nextIds);
    if (nextOrder.error) return resultError(nextOrder.error);
    const nextVisits = nextOrder.visits;
    for (const fixed of originalVisits.filter((item) => item.is_fixed && visitTimeState(item).state === "timed")) {
      const currentFixedIndex = currentIds.indexOf(fixed.id);
      const nextFixedIndex = nextIds.indexOf(fixed.id);
      if (
        currentFixedIndex !== nextFixedIndex ||
        currentIds.slice(0, currentFixedIndex).some((id) => nextIds.indexOf(id) > nextFixedIndex) ||
        currentIds.slice(currentFixedIndex + 1).some((id) => nextIds.indexOf(id) < nextFixedIndex)
      ) {
        return resultError("fixed_boundary_crossed");
      }
    }
    operationStartIndex = firstDifferentIndex(currentIds, nextIds);
    if (operationStartIndex < 0) {
      return {
        affectedItemIds: [],
        automaticUntimedItemIds: [],
        ok: true,
        operationStartIndex: -1,
        orderedVisitIds: nextIds,
        overflowReason: null,
        removedTransportIds: [],
        requiresConfirmation: false,
        stoppedAtFixedItemId: null,
        suspendedTransportIds: [],
        untimedItemIds: [],
        updatedItems: [],
      };
    }
    visits = nextVisits;
    context.visits = visits;
    collectBrokenTransportIds(transports, originalVisits, visits).forEach((id) => context.removedIds.add(id));
    const firstAffectedTimed = originalVisits.slice(operationStartIndex).find((item) => visitTimeState(item).state === "timed");
    const hasPreviousTimed = precedingTimedIndex(visits, operationStartIndex) >= 0;
    scheduleSegment(context, operationStartIndex, {
      anchorStart: hasPreviousTimed || !firstAffectedTimed ? null : visitTimeState(firstAffectedTimed).start,
    });
  }

  collectTransportEffects(context);
  const removedTransportIds = [...context.removedIds].sort();
  const automaticUntimedItemIds = [...context.automaticUntimedIds];
  const updatedItems = [...context.updatedById.values()].sort((a, b) => stableId(a).localeCompare(stableId(b)));
  const affectedItemIds = [...new Set([
    ...updatedItems.map((item) => item.id),
    ...removedTransportIds,
    ...context.suspendedIds,
  ])];
  const removedAsMajorEffect = removedTransportIds.some((id) => id !== explicitRemovedTransportId);

  return {
    affectedItemIds,
    automaticUntimedItemIds,
    ok: true,
    operationStartIndex,
    orderedVisitIds: visits.map((item) => item.id),
    overflowReason: context.overflowReason,
    removedTransportIds,
    requiresConfirmation: automaticUntimedItemIds.length > 0 || removedAsMajorEffect,
    stoppedAtFixedItemId: context.stoppedAtFixedItemId,
    suspendedTransportIds: [...context.suspendedIds].sort(),
    untimedItemIds: [...context.untimedIds],
    updatedItems,
    upsertedTransport,
  };
}

export function attachTimelineScheduleSortOrders({ items = [], plan }) {
  if (!plan?.ok || !Array.isArray(plan.orderedVisitIds)) return plan;
  const replacements = (plan.updatedItems || []).filter((item) => Object.hasOwn(item, "start_time") || Object.hasOwn(item, "end_time"));
  const sortPlan = planUntimedSortOrdersForVisualOrder({
    items,
    nextVisitIds: plan.orderedVisitIds,
    replacements,
  });
  if (!sortPlan.ok) return resultError(sortPlan.errorCode || "order_space_exhausted");
  const updatedById = new Map((plan.updatedItems || []).map((item) => [item.id, { ...item }]));
  Object.entries(sortPlan.sortOrders).forEach(([id, sort_order]) => {
    const current = items.find((item) => item.id === id);
    if (current?.sort_order === sort_order && !updatedById.has(id)) return;
    updatedById.set(id, { ...(updatedById.get(id) || { id }), sort_order });
  });
  return {
    ...plan,
    affectedItemIds: [...new Set([...(plan.affectedItemIds || []), ...updatedById.keys()])],
    updatedItems: [...updatedById.values()].sort((a, b) => stableId(a).localeCompare(stableId(b))),
  };
}

export function remapTimelineSchedulePlanItemIds({ plan, sourceToSlotIds = {} }) {
  if (!plan?.ok) return plan;
  const idMap = sourceToSlotIds instanceof Map ? sourceToSlotIds : new Map(Object.entries(sourceToSlotIds));
  const mappedId = (id) => idMap.get(id) || id;
  const mapIds = (ids = []) => [...new Set(ids.map(mappedId))];
  const updatedById = new Map();
  for (const update of plan.updatedItems || []) {
    const id = mappedId(update.id);
    updatedById.set(id, { ...(updatedById.get(id) || {}), ...update, id });
  }
  return {
    ...plan,
    affectedItemIds: mapIds(plan.affectedItemIds),
    automaticUntimedItemIds: mapIds(plan.automaticUntimedItemIds),
    orderedVisitIds: mapIds(plan.orderedVisitIds),
    stoppedAtFixedItemId: plan.stoppedAtFixedItemId ? mappedId(plan.stoppedAtFixedItemId) : null,
    untimedItemIds: mapIds(plan.untimedItemIds),
    updatedItems: [...updatedById.values()].sort((a, b) => stableId(a).localeCompare(stableId(b))),
  };
}

export function applyTimelineSchedulePlanToItems({ items = [], plan, targetItemId = null, targetPayload = null, updatedAt = null }) {
  if (!plan?.ok) return items;
  const removedIds = new Set(plan.removedTransportIds || []);
  const updateById = new Map((plan.updatedItems || []).map((item) => [item.id, item]));
  const next = items
    .filter((item) => !removedIds.has(item.id))
    .map((item) => {
      const update = updateById.get(item.id);
      const targetUpdate = targetItemId && item.id === targetItemId ? targetPayload : null;
      if (!update && !targetUpdate) return item;
      return { ...item, ...(targetUpdate || {}), ...(update || {}), ...(updatedAt ? { updated_at: updatedAt } : {}) };
    });
  if (plan.upsertedTransport && !next.some((item) => item.id === plan.upsertedTransport.id)) {
    next.push({ ...plan.upsertedTransport, ...(targetPayload || {}), ...(updatedAt ? { updated_at: updatedAt } : {}) });
  }
  return next;
}
