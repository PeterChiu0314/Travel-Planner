import { dateToInputValue } from "../../lib/displayFormat.js";
import { dateRangeDayCount, parseDateOnly } from "../../lib/tripDateUi.js";
import { isTransportationCard } from "../../lib/timelineTransportationRoles.js";
import { sortScheduleItems } from "../../lib/timelineUntimedOrdering.js";
import { addDays } from "./tripDetails.js";
import { isEffectiveFixedVisit } from "../timeline/timelineItemRules.js";

function getTimelineDayPosition(item) {
  const position = Number(item?.day_index);
  return Number.isInteger(position) && position >= 0 ? position : 0;
}

function getTimelineDayDate(startDate, position) {
  const start = parseDateOnly(startDate);
  if (!start || !Number.isInteger(position) || position < 0) return "";
  return dateToInputValue(addDays(start, position));
}

function emptyTimelineDayCounts() {
  return {
    alternatives: 0,
    budgetLinks: 0,
    fixed: 0,
    timeline: 0,
    transports: 0,
    visits: 0,
  };
}

function buildTimelineDayPreviewMap(items = [], alternatives = [], itineraryBudgetLinks = []) {
  const byPosition = new Map();
  const itemPositionById = new Map();

  items.forEach((item) => {
    const position = getTimelineDayPosition(item);
    const counts = byPosition.get(position) || emptyTimelineDayCounts();
    counts.timeline += 1;
    if (isTransportationCard(item)) counts.transports += 1;
    else counts.visits += 1;
    if (isEffectiveFixedVisit(item)) counts.fixed += 1;
    byPosition.set(position, counts);
    if (item?.id) itemPositionById.set(item.id, position);
  });

  alternatives.forEach((alternative) => {
    const position = itemPositionById.get(alternative?.itinerary_item_id);
    if (position === undefined) return;
    const counts = byPosition.get(position) || emptyTimelineDayCounts();
    counts.alternatives += 1;
    byPosition.set(position, counts);
  });

  const budgetLinksByPosition = new Map();
  itineraryBudgetLinks.forEach((link) => {
    const position = itemPositionById.get(link?.itinerary_item_id);
    if (position === undefined || !link?.budget_item_id) return;
    const linkedBudgetIds = budgetLinksByPosition.get(position) || new Set();
    linkedBudgetIds.add(link.budget_item_id);
    budgetLinksByPosition.set(position, linkedBudgetIds);
  });

  budgetLinksByPosition.forEach((linkedBudgetIds, position) => {
    const counts = byPosition.get(position) || emptyTimelineDayCounts();
    counts.budgetLinks = linkedBudgetIds.size;
    byPosition.set(position, counts);
  });

  return byPosition;
}

function getAffectedTimelineDays({
  alternatives = [],
  itineraryBudgetLinks = [],
  items = [],
  newDayCount,
  oldDayCount,
  oldStartDate,
}) {
  const countsByPosition = buildTimelineDayPreviewMap(items, alternatives, itineraryBudgetLinks);
  const affectedDays = [];
  for (let position = newDayCount; position < oldDayCount; position += 1) {
    const counts = countsByPosition.get(position) || emptyTimelineDayCounts();
    affectedDays.push({
      counts,
      dayKey: `index:${position}`,
      label: `Day ${position + 1}`,
      originalDate: getTimelineDayDate(oldStartDate, position),
      position,
    });
  }
  return affectedDays;
}

function classifyTripDateChange({
  alternatives = [],
  itineraryBudgetLinks = [],
  items = [],
  newEndDate,
  newStartDate,
  oldEndDate,
  oldStartDate,
}) {
  const oldDayCount = dateRangeDayCount(oldStartDate, oldEndDate) || 0;
  const newDayCount = dateRangeDayCount(newStartDate, newEndDate) || 0;
  const base = {
    affectedDays: [],
    hasTimelineRemoval: false,
    newDayCount,
    newEndDate,
    newStartDate,
    oldDayCount,
    oldEndDate,
    oldStartDate,
    removedDayPositions: [],
    type: "unchanged",
  };

  if (!oldStartDate || !oldEndDate || !newStartDate || !newEndDate || !oldDayCount || !newDayCount || newEndDate < newStartDate) {
    return { ...base, type: "invalid" };
  }
  if (oldStartDate === newStartDate && oldEndDate === newEndDate) return base;
  if (newDayCount >= oldDayCount) return { ...base, type: "same-or-extended" };

  const affectedDays = getAffectedTimelineDays({
    alternatives,
    itineraryBudgetLinks,
    items,
    newDayCount,
    oldDayCount,
    oldStartDate,
  });
  const removedDayPositions = affectedDays.map((day) => day.position);
  const hasTimelineRemoval = affectedDays.some((day) => day.counts.timeline > 0);

  return {
    ...base,
    affectedDays,
    hasTimelineRemoval,
    removedDayPositions,
    type: hasTimelineRemoval ? "shortened-with-timeline" : "shortened-empty-tail",
  };
}

export function buildTripDateChangePreview({
  accommodations = [],
  alternatives = [],
  itineraryBudgetLinks = [],
  items = [],
  newEndDate,
  newStartDate,
  todoItems = [],
  trip,
}) {
  const classification = classifyTripDateChange({
    alternatives,
    itineraryBudgetLinks,
    items,
    newEndDate,
    newStartDate,
    oldEndDate: trip?.end_date || "",
    oldStartDate: trip?.start_date || "",
  });
  return {
    ...classification,
    accommodationCount: accommodations.filter((item) => item?.check_in_date || item?.check_out_date).length,
    todoCount: todoItems.filter((item) => item?.due_date).length,
  };
}

export function syncTimelineItemDatesForTripStart(items = [], startDate) {
  return items.map((item) => ({
    ...item,
    date: getTimelineDayDate(startDate, getTimelineDayPosition(item)) || item.date || null,
  }));
}

export function timelineItemIdsRemovedByShortening(items = [], newDayCount) {
  const removedIds = new Set(
    items.filter((item) => getTimelineDayPosition(item) >= newDayCount).map((item) => item.id).filter(Boolean),
  );
  items.forEach((item) => {
    if (!isTransportationCard(item)) return;
    if (removedIds.has(item.from_item_id) || removedIds.has(item.to_item_id)) removedIds.add(item.id);
  });
  return removedIds;
}

export function timelineItemsInTripRange(items = [], trip) {
  const dayCount = dateRangeDayCount(trip?.start_date, trip?.end_date) || 0;
  if (!dayCount) return [];
  return sortScheduleItems(
    items
      .filter((item) => {
        const position = getTimelineDayPosition(item);
        return position >= 0 && position < dayCount;
      })
      .map((item) => ({
        ...item,
        date: getTimelineDayDate(trip.start_date, getTimelineDayPosition(item)) || item.date || null,
      })),
  );
}
