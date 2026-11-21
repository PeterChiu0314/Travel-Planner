import { collaboratorColors as timelineCardSelectionColors } from "../../lib/collaboratorColors.js";

export const timelineDragPresenceHeartbeatMs = 3000;

export const timelineDragPresenceStaleMs = 12000;

export const timelineDragPresenceMaxMs = 75000;

export const timelineDragPresenceRefreshMs = 1000;

export const timelineCardSelectionStaleMs = 30000;

const timelineCardSelectionColorKeys = Object.keys(timelineCardSelectionColors);

export function timelineDragPresenceDebugEnabled() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("debugPresence") === "1";
}

export function timelineDragPresenceDebug(label, details) {
  if (!timelineDragPresenceDebugEnabled()) return;
  console.info(`[drag-presence] ${label}`, details);
}

export function timelineDragPresenceDebugPayload(payload) {
  if (!payload) return null;
  return {
    userId: payload.userId,
    userName: payload.userName,
    sessionId: payload.sessionId,
    dragId: payload.dragId,
    tripId: payload.tripId,
    dayIndex: payload.dayIndex,
    itemId: payload.itemId,
    itemTitle: payload.itemTitle,
    startedAt: payload.startedAt,
    lastSeenAt: payload.lastSeenAt,
    sentAt: payload.sentAt,
    clearReason: payload.clearReason,
    overItemId: payload.overItemId,
    placement: payload.placement,
  };
}

function timelineCardSelectionColorKey(seed = "") {
  const source = String(seed || "");
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return timelineCardSelectionColorKeys[hash % timelineCardSelectionColorKeys.length] || "blue";
}

export function timelineCollaboratorColorKey(userId, sessionId) {
  return timelineCardSelectionColorKey(userId || sessionId);
}

export function timelineCardSelectionDebugPayload(payload) {
  if (!payload) return null;
  return {
    tripId: payload.tripId,
    dayIndex: payload.dayIndex,
    itemId: payload.itemId,
    itemType: payload.itemType,
    itemTitle: payload.itemTitle,
    userId: payload.userId,
    userName: payload.userName,
    sessionId: payload.sessionId,
    colorKey: payload.colorKey,
    selectedAt: payload.selectedAt,
    sentAt: payload.sentAt,
  };
}

export function timelineDragPresenceDebugState(state) {
  return Object.fromEntries(
    Object.entries(state || {}).map(([key, payloads]) => [
      key,
      (payloads || []).map((payload) => timelineDragPresenceDebugPayload(payload)),
    ]),
  );
}

export function timelineDragPresenceChannelSummary(channel, ready, status) {
  return {
    ready: Boolean(ready),
    status: status || "",
    channelState: channel?.state || channel?._state || "",
    joinedOnce: Boolean(channel?.joinedOnce),
    topic: channel?.topic || "",
  };
}

export function timelineDragPresenceBasePayload(payload) {
  if (!payload) return null;
  return {
    userId: payload.userId,
    userName: payload.userName,
    sessionId: payload.sessionId,
    dragId: payload.dragId,
    tripId: payload.tripId,
    dayIndex: payload.dayIndex,
    itemId: payload.itemId,
    itemTitle: payload.itemTitle,
    startedAt: payload.startedAt,
  };
}

export function trackTimelineDragPresence(channel, payload, label) {
  if (!channel || !payload) return;
  const presencePayload = timelineDragPresenceBasePayload(payload);
  timelineDragPresenceDebug(label, timelineDragPresenceDebugPayload(presencePayload));
  Promise.resolve(channel.track(presencePayload))
    .then((result) => {
      if (result && result !== "ok") {
        timelineDragPresenceDebug("track error", { result, payload: timelineDragPresenceDebugPayload(presencePayload) });
      }
    })
    .catch((error) => {
      timelineDragPresenceDebug("track error", {
        message: error?.message || String(error),
        payload: timelineDragPresenceDebugPayload(presencePayload),
      });
    });
}

export function broadcastTimelineDragPresence(channel, event, payload, label) {
  if (!channel || !payload) return;
  timelineDragPresenceDebug(label, timelineDragPresenceDebugPayload(payload));
  Promise.resolve(channel.send({ type: "broadcast", event, payload }))
    .then((result) => {
      if (result && result !== "ok") {
        timelineDragPresenceDebug("broadcast error", {
          event,
          result,
          payload: timelineDragPresenceDebugPayload(payload),
        });
      }
    })
    .catch((error) => {
      timelineDragPresenceDebug("broadcast error", {
        event,
        message: error?.message || String(error),
        payload: timelineDragPresenceDebugPayload(payload),
      });
    });
}
