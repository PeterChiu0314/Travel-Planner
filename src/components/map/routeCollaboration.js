export const routeEditPresenceHeartbeatMs = 32000;

export const routeEditPresenceStaleMs = 70000;

export const routeEditNodeLockStaleMs = 12000;

export const routeEditBroadcastThrottleMs = 120;

function routeEditCollaborationDebugEnabled() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("debugRouteCollab") === "1";
}

export function routeEditCollaborationDebug(label, details) {
  if (!routeEditCollaborationDebugEnabled()) return;
  console.info(`[route-edit-collab] ${label}`, details);
}

export function routeEditCollaborationChannelSummary(channel, ready, status, metadata = null) {
  return {
    channelState: channel?.state || channel?._state || "",
    channelId: metadata?.channelId || null,
    channelName: metadata?.channelName || channel?.topic || "",
    isCurrentRef: Boolean(metadata?.isCurrentRef),
    joinedOnce: Boolean(channel?.joinedOnce),
    ready: Boolean(ready),
    status: status || "",
    topic: channel?.topic || "",
  };
}
