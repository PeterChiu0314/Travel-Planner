import { clearDraft, getDraftKey, loadLatestDraftForEntity } from "../../lib/draftAutosave.js";

export const timelineDraftEntityType = "itinerary_item";

export function hasTimelineDraftForTrip({ tripId, userId }) {
  if (!tripId || !userId) return false;
  return Boolean(loadLatestDraftForEntity({
    entityType: timelineDraftEntityType,
    includeNew: false,
    tripId,
    userId,
  }));
}

export function clearTimelineDraftsForItemIds({ tripId, userId, itemIds }) {
  if (!tripId || !userId) return;
  for (const entityId of itemIds) {
    if (!entityId || entityId === "new") continue;
    clearDraft(getDraftKey({ entityId, entityType: timelineDraftEntityType, tripId, userId }));
  }
}
