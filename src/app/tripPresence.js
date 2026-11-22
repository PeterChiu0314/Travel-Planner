import { timelineDragPresenceDebugEnabled } from "../components/timeline/timelinePresence.js";

export const tripPresenceHeartbeatMs = 28000;

export const tripPresenceStaleMs = 55000;

export const tripPresenceRecoverableStatuses = new Set(["CLOSED", "CHANNEL_ERROR", "TIMED_OUT"]);

export const tripPresencePageToSection = {
  accommodation: "accommodation",
  budget: "budget",
  overview: "today",
  packing: "luggage",
  settings: "settings",
  settlement: "settlement",
  timeline: "timeline",
  todo: "todo",
};

export function tripPresenceDebug(label, details) {
  if (!timelineDragPresenceDebugEnabled()) return;
  console.info(`[trip-presence] ${label}`, details);
}

export function tripPresenceDebugPayload(payload) {
  if (!payload) return null;
  return {
    tripId: payload.tripId,
    userId: payload.userId,
    userName: payload.userName,
    sessionId: payload.sessionId,
    colorKey: payload.colorKey,
    pageKey: payload.pageKey,
    dayIndex: payload.dayIndex,
    selectedItemId: payload.selectedItemId,
    selectedItemType: payload.selectedItemType,
    selectedItemTitle: payload.selectedItemTitle,
    updatedAt: payload.updatedAt,
  };
}
