import { isTimedVisit } from "./timelineUntimedOrdering.js";

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

function compareTimedVisits(a, b) {
  const timeSort = String(a?.start_time || "99:99").localeCompare(String(b?.start_time || "99:99"));
  const orderSort = Number(a?.sort_order || 0) - Number(b?.sort_order || 0);
  return timeSort || orderSort || String(a?.id || "").localeCompare(String(b?.id || ""));
}

export function planTimelineAutoContinuation({ candidate, dayIndex, editedItemId, items = [] }) {
  const timedVisits = items
    .filter(
      (item) =>
        item?.item_type !== "transport" &&
        isTimedVisit(item) &&
        Number(item?.day_index) === Number(dayIndex),
    )
    .sort(compareTimedVisits);
  const editedIndex = timedVisits.findIndex((item) => item.id === editedItemId);
  if (editedIndex < 0 || !candidate || candidate.item_type === "transport") {
    return { shouldPrompt: false, canAutoContinue: false, updates: [] };
  }

  const editedItem = timedVisits[editedIndex];
  const originalStart = timeToMinutes(editedItem.start_time);
  const originalEnd = timeToMinutes(editedItem.end_time);
  const candidateStart = timeToMinutes(candidate.start_time);
  const candidateEnd = timeToMinutes(candidate.end_time);
  const timeChanged = originalStart !== candidateStart || originalEnd !== candidateEnd;
  if (!timeChanged || originalStart === null || originalEnd === null || candidateStart === null || candidateEnd === null) {
    return { shouldPrompt: false, canAutoContinue: false, updates: [] };
  }

  const followingVisits = timedVisits.slice(editedIndex + 1);
  if (!followingVisits.length) return { shouldPrompt: false, canAutoContinue: false, updates: [] };

  const fixedVisitIndex = followingVisits.findIndex((item) => item.is_fixed);
  const fixedVisit = fixedVisitIndex >= 0 ? followingVisits[fixedVisitIndex] : null;
  const movableVisits = fixedVisit ? followingVisits.slice(0, fixedVisitIndex) : followingVisits;
  const fixedStart = fixedVisit ? timeToMinutes(fixedVisit.start_time) : null;

  const updates = [];
  let previousOriginal = editedItem;
  let previousNewEnd = candidateEnd;
  for (const [visitIndex, visit] of movableVisits.entries()) {
    const previousOriginalEnd = timeToMinutes(previousOriginal.end_time);
    const originalVisitStart = timeToMinutes(visit.start_time);
    const originalVisitEnd = timeToMinutes(visit.end_time);
    const isFinalOpenEndedVisit = originalVisitEnd === null && visitIndex === movableVisits.length - 1 && !fixedVisit;
    if (previousOriginalEnd === null || originalVisitStart === null || (originalVisitEnd === null && !isFinalOpenEndedVisit)) {
      return {
        shouldPrompt: true,
        canAutoContinue: false,
        blockReason: "incomplete_time",
        followingVisitIds: movableVisits.map((item) => item.id),
        updates: [],
      };
    }
    const gapMinutes = originalVisitStart - previousOriginalEnd;
    const durationMinutes = isFinalOpenEndedVisit ? null : originalVisitEnd - originalVisitStart;
    const nextStartMinutes = previousNewEnd + gapMinutes;
    const nextEndMinutes = isFinalOpenEndedVisit ? null : nextStartMinutes + durationMinutes;
    if (fixedStart !== null && nextEndMinutes > fixedStart) {
      for (const overflowVisit of movableVisits.slice(visitIndex)) {
        updates.push({
          id: overflowVisit.id,
          start_time: null,
          end_time: null,
          original_start_time: overflowVisit.start_time,
          original_end_time: overflowVisit.end_time,
          updated_at: overflowVisit.updated_at || null,
        });
      }
      break;
    }
    const nextStartTime = minutesToTime(nextStartMinutes);
    const nextEndTime = isFinalOpenEndedVisit ? null : minutesToTime(nextEndMinutes);
    if (gapMinutes < 0 || (!isFinalOpenEndedVisit && durationMinutes <= 0) || !nextStartTime || (!isFinalOpenEndedVisit && !nextEndTime)) {
      return {
        shouldPrompt: true,
        canAutoContinue: false,
        blockReason: "invalid_result",
        followingVisitIds: movableVisits.map((item) => item.id),
        updates: [],
      };
    }
    updates.push({
      id: visit.id,
      start_time: nextStartTime,
      end_time: nextEndTime,
      original_start_time: visit.start_time,
      original_end_time: visit.end_time,
      updated_at: visit.updated_at || null,
    });
    previousOriginal = visit;
    previousNewEnd = nextEndMinutes;
  }

  return {
    shouldPrompt: true,
    canAutoContinue: true,
    fixedVisitId: fixedVisit?.id || null,
    followingVisitIds: movableVisits.map((item) => item.id),
    updates,
  };
}
