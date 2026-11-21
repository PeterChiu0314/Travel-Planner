import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase.js";
import { isTransportationCard } from "../../lib/timelineTransportationRoles.js";
import { transportCardTitle } from "../../lib/timelineTransportCategories.js";
import {
  timelineDragPresenceHeartbeatMs,
  timelineDragPresenceStaleMs,
  timelineDragPresenceMaxMs,
  timelineDragPresenceRefreshMs,
  timelineCardSelectionStaleMs,
  timelineDragPresenceDebug,
  timelineDragPresenceDebugPayload,
  timelineCollaboratorColorKey,
  timelineCardSelectionDebugPayload,
  timelineDragPresenceDebugState,
  timelineDragPresenceChannelSummary,
  timelineDragPresenceBasePayload,
  trackTimelineDragPresence,
  broadcastTimelineDragPresence,
} from "../../components/timeline/timelinePresence.js";

export function useTimelinePresence({
    activeTripId,
    activeDay,
    items,
    activeSection,
    setTripPresenceSelectedItem,
    timelineDragPresenceSessionIdRef,
    activeMembership,
    canEditActiveTripContent,
    activeUserId,
    timelineDragPresenceUserName,
  }) {
  const [foreignDragPresence, setForeignDragPresence] = useState(null);

  const [foreignCardSelection, setForeignCardSelection] = useState(null);

  const timelineDragPresenceChannelRef = useRef(null);

  const timelineDragPresenceReadyRef = useRef(false);

  const timelineDragPresenceStatusRef = useRef("idle");

  const timelineDragPresenceReconnectRef = useRef(false);

  const itemsRef = useRef([]);

  const localCardSelectionRef = useRef(null);

  const localDragPresenceRef = useRef(null);

  const localDragStartedAtRef = useRef(null);

  const [timelineDragPresenceChannelVersion, setTimelineDragPresenceChannelVersion] = useState(0);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    if (!activeTripId || !activeUserId || activeMembership?.status !== "approved") {
      setForeignDragPresence(null);
      setForeignCardSelection(null);
      timelineDragPresenceChannelRef.current = null;
      timelineDragPresenceReadyRef.current = false;
      timelineDragPresenceStatusRef.current = "idle";
      localCardSelectionRef.current = null;
      return undefined;
    }
    const sessionId = timelineDragPresenceSessionIdRef.current;
    const channelName = `timeline-drag:${activeTripId}:${activeDay}`;
    const channel = supabase.channel(channelName, {
      config: { presence: { key: sessionId } },
    });
    timelineDragPresenceChannelRef.current = channel;
    timelineDragPresenceReadyRef.current = false;
    timelineDragPresenceStatusRef.current = "creating";
    timelineDragPresenceDebug("subscribe status", {
      channelName,
      sessionId,
      summary: timelineDragPresenceChannelSummary(channel, false, timelineDragPresenceStatusRef.current),
    });

    const isForeignSameDayPayload = (payload, now) => {
      if (!payload) {
        timelineDragPresenceDebug("stale filtered reason", { channelName, reason: "empty-payload" });
        return false;
      }
      if (payload.sessionId === sessionId) return false;
      if (payload.tripId !== activeTripId) {
        timelineDragPresenceDebug("stale filtered reason", {
          channelName,
          expectedTripId: activeTripId,
          payload: timelineDragPresenceDebugPayload(payload),
          reason: "trip-mismatch",
        });
        return false;
      }
      if (Number(payload.dayIndex) !== Number(activeDay)) {
        timelineDragPresenceDebug("stale filtered reason", {
          channelName,
          expectedDayIndex: activeDay,
          payload: timelineDragPresenceDebugPayload(payload),
          reason: "day-mismatch",
        });
        return false;
      }
      const rawLastSeenAt = payload.sentAt || payload.lastSeenAt || payload.startedAt || "";
      const lastSeenAt = typeof rawLastSeenAt === "number" ? rawLastSeenAt : Date.parse(rawLastSeenAt);
      if (!Number.isFinite(lastSeenAt)) {
        timelineDragPresenceDebug("stale filtered reason", {
          channelName,
          payload: timelineDragPresenceDebugPayload(payload),
          reason: "invalid-lastSeenAt",
        });
        return false;
      }
      if (now - lastSeenAt > timelineDragPresenceStaleMs) {
        timelineDragPresenceDebug("stale filtered reason", {
          ageMs: now - lastSeenAt,
          channelName,
          payload: timelineDragPresenceDebugPayload(payload),
          reason: "stale-timeout",
        });
        return false;
      }
      return true;
    };

    const isForeignCardSelectionPayload = (payload, now) => {
      if (!payload) {
        timelineDragPresenceDebug("selection ignored reason", { channelName, reason: "empty-payload" });
        return false;
      }
      if (payload.sessionId === sessionId) {
        timelineDragPresenceDebug("selection ignored reason", {
          channelName,
          reason: "self",
          payload: timelineCardSelectionDebugPayload(payload),
        });
        return false;
      }
      if (payload.tripId !== activeTripId) {
        timelineDragPresenceDebug("selection ignored reason", {
          channelName,
          expectedTripId: activeTripId,
          reason: "trip-mismatch",
          payload: timelineCardSelectionDebugPayload(payload),
        });
        return false;
      }
      if (Number(payload.dayIndex) !== Number(activeDay)) {
        timelineDragPresenceDebug("selection ignored reason", {
          channelName,
          expectedDayIndex: activeDay,
          reason: "day-mismatch",
          payload: timelineCardSelectionDebugPayload(payload),
        });
        return false;
      }
      const rawSelectedAt = payload.selectedAt || payload.sentAt || "";
      const selectedAt = typeof rawSelectedAt === "number" ? rawSelectedAt : Date.parse(rawSelectedAt);
      if (!Number.isFinite(selectedAt) || now - selectedAt > timelineCardSelectionStaleMs) {
        timelineDragPresenceDebug("selection ignored reason", {
          ageMs: Number.isFinite(selectedAt) ? now - selectedAt : null,
          channelName,
          reason: Number.isFinite(selectedAt) ? "stale" : "invalid-selectedAt",
          payload: timelineCardSelectionDebugPayload(payload),
        });
        return false;
      }
      const selectedItem = itemsRef.current.find((item) => item.id === payload.itemId);
      if (!selectedItem) {
        timelineDragPresenceDebug("selection ignored reason", {
          channelName,
          reason: "missing-item",
          payload: timelineCardSelectionDebugPayload(payload),
        });
        return false;
      }
      const selectedItemType = isTransportationCard(selectedItem) ? "transport" : "destination";
      if (payload.itemType !== selectedItemType) {
        timelineDragPresenceDebug("selection ignored reason", {
          channelName,
          expectedItemType: selectedItemType,
          reason: "item-type-mismatch",
          payload: timelineCardSelectionDebugPayload(payload),
        });
        return false;
      }
      return true;
    };

    const mergeForeignPresence = (payload, seenAt) => {
      const nextSeenAt = seenAt || payload.sentAt || payload.lastSeenAt || payload.startedAt || new Date().toISOString();
      const isLiveUpdate = Boolean(payload.sentAt || payload.lastSeenAt);
      setForeignDragPresence((current) => {
        if (current?.dragId === payload.dragId) {
          return {
            ...payload,
            lastSeenAt: isLiveUpdate ? nextSeenAt : current.lastSeenAt || nextSeenAt,
            overItemId: Object.prototype.hasOwnProperty.call(payload, "overItemId")
              ? payload.overItemId
              : current.overItemId || null,
            placement: Object.prototype.hasOwnProperty.call(payload, "placement")
              ? payload.placement
              : current.placement || null,
            sentAt: payload.sentAt || current.sentAt || nextSeenAt,
          };
        }
        return {
          ...payload,
          lastSeenAt: nextSeenAt,
          overItemId: Object.prototype.hasOwnProperty.call(payload, "overItemId") ? payload.overItemId : null,
          placement: Object.prototype.hasOwnProperty.call(payload, "placement") ? payload.placement : null,
          sentAt: payload.sentAt || nextSeenAt,
        };
      });
    };

    const syncForeignPresence = () => {
      const now = Date.now();
      const state = channel.presenceState();
      timelineDragPresenceDebug("sync state", {
        channelName,
        state: timelineDragPresenceDebugState(state),
      });
      const payloads = Object.values(state)
        .flat()
        .filter((payload) => isForeignSameDayPayload(payload, now))
        .sort((left, right) => {
          const rightSeenAt = right.sentAt || right.lastSeenAt || right.startedAt || "";
          const leftSeenAt = left.sentAt || left.lastSeenAt || left.startedAt || "";
          const parsedRight = typeof rightSeenAt === "number" ? rightSeenAt : Date.parse(rightSeenAt);
          const parsedLeft = typeof leftSeenAt === "number" ? leftSeenAt : Date.parse(leftSeenAt);
          return parsedRight - parsedLeft;
        });
      const selectedPresence = payloads[0] || null;
      timelineDragPresenceDebug("selected foreign presence", {
        channelName,
        payload: timelineDragPresenceDebugPayload(selectedPresence),
      });
      if (selectedPresence) mergeForeignPresence(selectedPresence, selectedPresence.startedAt);
    };

    const refreshIntervalId = window.setInterval(syncForeignPresence, timelineDragPresenceRefreshMs);

    channel
      .on("presence", { event: "sync" }, syncForeignPresence)
      .on("presence", { event: "join" }, syncForeignPresence)
      .on("presence", { event: "leave" }, syncForeignPresence)
      .on("broadcast", { event: "timeline-drag-update" }, (message) => {
        const payload = message?.payload || null;
        timelineDragPresenceDebug("broadcast received", {
          channelName,
          event: "timeline-drag-update",
          payload: timelineDragPresenceDebugPayload(payload),
        });
        if (isForeignSameDayPayload(payload, Date.now())) {
          mergeForeignPresence(payload, payload.sentAt || new Date().toISOString());
        }
      })
      .on("broadcast", { event: "timeline-drag-clear" }, (message) => {
        const payload = message?.payload || null;
        timelineDragPresenceDebug("broadcast clear received", {
          channelName,
          event: "timeline-drag-clear",
          payload: timelineDragPresenceDebugPayload(payload),
        });
        if (!payload) {
          timelineDragPresenceDebug("clear ignored reason", { channelName, reason: "empty-payload" });
          return;
        }
        if (payload.sessionId === sessionId) {
          timelineDragPresenceDebug("clear ignored reason", {
            channelName,
            payload: timelineDragPresenceDebugPayload(payload),
            reason: "self",
          });
          return;
        }
        if (payload.tripId !== activeTripId || Number(payload.dayIndex) !== Number(activeDay)) {
          timelineDragPresenceDebug("clear ignored reason", {
            channelName,
            expectedDayIndex: activeDay,
            expectedTripId: activeTripId,
            payload: timelineDragPresenceDebugPayload(payload),
            reason: "scope-mismatch",
          });
          return;
        }
        setForeignDragPresence((current) => {
          if (!current) return null;
          if (current.dragId === payload.dragId || current.sessionId === payload.sessionId) return null;
          timelineDragPresenceDebug("clear ignored reason", {
            channelName,
            current: timelineDragPresenceDebugPayload(current),
            payload: timelineDragPresenceDebugPayload(payload),
            reason: "drag-mismatch",
          });
          return current;
        });
      })
      .on("broadcast", { event: "timeline-card-selection-update" }, (message) => {
        const payload = message?.payload || null;
        timelineDragPresenceDebug("selection received", {
          channelName,
          payload: timelineCardSelectionDebugPayload(payload),
        });
        if (isForeignCardSelectionPayload(payload, Date.now())) {
          setForeignCardSelection(payload);
        }
      })
      .on("broadcast", { event: "timeline-card-selection-clear" }, (message) => {
        const payload = message?.payload || null;
        timelineDragPresenceDebug("selection received", {
          channelName,
          event: "timeline-card-selection-clear",
          payload: timelineCardSelectionDebugPayload(payload),
        });
        if (!payload || payload.sessionId === sessionId) return;
        if (payload.tripId !== activeTripId || Number(payload.dayIndex) !== Number(activeDay)) return;
        setForeignCardSelection((current) => (!current || current.sessionId === payload.sessionId ? null : current));
      })
      .subscribe((status) => {
        timelineDragPresenceStatusRef.current = status;
        timelineDragPresenceDebug("subscribe status", {
          channelName,
          sessionId,
          status,
          summary: timelineDragPresenceChannelSummary(channel, timelineDragPresenceReadyRef.current, status),
        });
        if (status === "SUBSCRIBED") {
          timelineDragPresenceReadyRef.current = true;
          timelineDragPresenceChannelRef.current = channel;
          timelineDragPresenceDebug("subscribed", {
            channelName,
            sessionId,
            summary: timelineDragPresenceChannelSummary(channel, true, status),
          });
          if (localDragPresenceRef.current) {
            trackTimelineDragPresence(channel, localDragPresenceRef.current, "track start payload");
            broadcastTimelineDragPresence(
              channel,
              "timeline-drag-update",
              { ...localDragPresenceRef.current, sentAt: new Date().toISOString() },
              "broadcast update",
            );
          }
          if (localCardSelectionRef.current) {
            broadcastTimelineDragPresence(
              channel,
              "timeline-card-selection-update",
              { ...localCardSelectionRef.current, sentAt: new Date().toISOString() },
              "selection broadcast update",
            );
          }
          syncForeignPresence();
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          const isActiveChannel = timelineDragPresenceChannelRef.current === channel;
          timelineDragPresenceReadyRef.current = false;
          timelineDragPresenceDebug("track skipped reason", {
            channelName,
            reason: isActiveChannel ? "channel-not-usable" : "stale-channel-status",
            status,
            summary: timelineDragPresenceChannelSummary(channel, false, status),
          });
          if (isActiveChannel) {
            timelineDragPresenceChannelRef.current = null;
            timelineDragPresenceReconnectRef.current = true;
            setTimelineDragPresenceChannelVersion((version) => version + 1);
          }
        }
      });

    return () => {
      const isReconnectCleanup = timelineDragPresenceReconnectRef.current;
      const removeReason = isReconnectCleanup ? "channel-reconnect" : "scope-or-unmount";
      window.clearInterval(refreshIntervalId);
      timelineDragPresenceDebug("removeChannel reason", {
        channelName,
        reason: removeReason,
        summary: timelineDragPresenceChannelSummary(channel, timelineDragPresenceReadyRef.current, timelineDragPresenceStatusRef.current),
      });
      if (!isReconnectCleanup && localDragPresenceRef.current && timelineDragPresenceReadyRef.current) {
        broadcastTimelineDragPresence(
          channel,
          "timeline-drag-clear",
          { ...timelineDragPresenceBasePayload(localDragPresenceRef.current), sentAt: new Date().toISOString() },
          "broadcast clear",
        );
      }
      if (!isReconnectCleanup && localCardSelectionRef.current && timelineDragPresenceReadyRef.current) {
        broadcastTimelineDragPresence(
          channel,
          "timeline-card-selection-clear",
          { ...localCardSelectionRef.current, sentAt: new Date().toISOString() },
          "selection broadcast clear",
        );
      }
      if (timelineDragPresenceChannelRef.current === channel) timelineDragPresenceChannelRef.current = null;
      timelineDragPresenceReadyRef.current = false;
      if (!isReconnectCleanup) {
        localDragPresenceRef.current = null;
        localDragStartedAtRef.current = null;
        localCardSelectionRef.current = null;
        setForeignDragPresence(null);
        setForeignCardSelection(null);
      }
      Promise.resolve(channel.untrack()).catch((error) => {
        timelineDragPresenceDebug("track error", { message: error?.message || String(error), phase: "untrack" });
      });
      void supabase.removeChannel(channel);
      if (isReconnectCleanup) timelineDragPresenceReconnectRef.current = false;
    };
  }, [activeDay, activeMembership?.status, activeTripId, activeUserId, timelineDragPresenceChannelVersion]);

  useEffect(() => {
    if (!foreignDragPresence) return undefined;
    const intervalId = window.setInterval(() => {
      const rawLastSeenAt = foreignDragPresence.lastSeenAt || foreignDragPresence.startedAt || "";
      const lastSeenAt = typeof rawLastSeenAt === "number" ? rawLastSeenAt : Date.parse(rawLastSeenAt);
      if (!Number.isFinite(lastSeenAt) || Date.now() - lastSeenAt > timelineDragPresenceStaleMs) {
        timelineDragPresenceDebug("stale filtered reason", {
          ageMs: Number.isFinite(lastSeenAt) ? Date.now() - lastSeenAt : null,
          payload: timelineDragPresenceDebugPayload(foreignDragPresence),
          reason: Number.isFinite(lastSeenAt) ? "state-stale-timeout" : "state-invalid-lastSeenAt",
        });
        setForeignDragPresence(null);
      }
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [foreignDragPresence]);

  useEffect(() => {
    if (!foreignCardSelection) return undefined;
    const intervalId = window.setInterval(() => {
      const rawSelectedAt = foreignCardSelection.selectedAt || foreignCardSelection.sentAt || "";
      const selectedAt = typeof rawSelectedAt === "number" ? rawSelectedAt : Date.parse(rawSelectedAt);
      if (!Number.isFinite(selectedAt) || Date.now() - selectedAt > timelineCardSelectionStaleMs) {
        timelineDragPresenceDebug("selection ignored reason", {
          ageMs: Number.isFinite(selectedAt) ? Date.now() - selectedAt : null,
          payload: timelineCardSelectionDebugPayload(foreignCardSelection),
          reason: Number.isFinite(selectedAt) ? "stale" : "invalid-selectedAt",
        });
        setForeignCardSelection(null);
      }
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [foreignCardSelection]);

  const clearDragPresence = useCallback((reason = "manual") => {
    const currentPayload = localDragPresenceRef.current;
    const channel = timelineDragPresenceChannelRef.current;
    const channelStatus = timelineDragPresenceStatusRef.current;
    const channelReady = timelineDragPresenceReadyRef.current;
    timelineDragPresenceDebug("drag clear requested reason", {
      payload: timelineDragPresenceDebugPayload(currentPayload),
      reason,
      summary: timelineDragPresenceChannelSummary(channel, channelReady, channelStatus),
    });
    if (channel && timelineDragPresenceReadyRef.current && currentPayload) {
      timelineDragPresenceDebug("broadcast clear sent reason", {
        payload: timelineDragPresenceDebugPayload(currentPayload),
        reason,
      });
      broadcastTimelineDragPresence(
        channel,
        "timeline-drag-clear",
        { ...timelineDragPresenceBasePayload(currentPayload), clearReason: reason, sentAt: new Date().toISOString() },
        "broadcast clear",
      );
    } else if (currentPayload) {
      timelineDragPresenceDebug("clear fallback local cleanup", {
        phase: "clear",
        reason: !channel ? "missing-channel" : !channelReady ? "channel-not-ready" : "no-payload",
        requestedReason: reason,
        summary: timelineDragPresenceChannelSummary(channel, channelReady, channelStatus),
      });
    }
    localDragPresenceRef.current = null;
    localDragStartedAtRef.current = null;
    if (channel && channelReady) {
      Promise.resolve(channel.untrack()).catch((error) => {
        timelineDragPresenceDebug("track error", { message: error?.message || String(error), phase: "untrack" });
      });
    }
  }, []);

  const clearCardSelection = useCallback(() => {
    const currentPayload = localCardSelectionRef.current;
    const channel = timelineDragPresenceChannelRef.current;
    const channelReady = timelineDragPresenceReadyRef.current;
    if (channel && channelReady && currentPayload) {
      broadcastTimelineDragPresence(
        channel,
        "timeline-card-selection-clear",
        { ...currentPayload, sentAt: new Date().toISOString() },
        "selection broadcast clear",
      );
    } else if (currentPayload) {
      timelineDragPresenceDebug("selection ignored reason", {
        phase: "clear",
        reason: !channel ? "missing-channel" : "channel-not-ready",
        payload: timelineCardSelectionDebugPayload(currentPayload),
      });
    }
    localCardSelectionRef.current = null;
  }, []);

  const publishCardSelection = useCallback(
    (item) => {
      if (!activeTripId || !activeUserId || activeMembership?.status !== "approved" || activeSection !== "timeline") return;
      if (!item) return;
      const channel = timelineDragPresenceChannelRef.current;
      const channelReady = timelineDragPresenceReadyRef.current;
      const now = new Date().toISOString();
      const sessionId = timelineDragPresenceSessionIdRef.current;
      const colorKey = timelineCollaboratorColorKey(activeUserId, sessionId);
      const itemType = isTransportationCard(item) ? "transport" : "destination";
      const nextPayload = {
        tripId: activeTripId,
        dayIndex: activeDay,
        itemId: item.id,
        itemType,
        itemTitle: itemType === "transport" ? transportCardTitle(item) : item.location_name || item.location || item.title || "",
        userId: activeUserId,
        userName: timelineDragPresenceUserName,
        sessionId,
        colorKey,
        selectedAt: now,
        sentAt: now,
      };
      localCardSelectionRef.current = nextPayload;
      setTripPresenceSelectedItem({
        itemId: nextPayload.itemId,
        itemTitle: nextPayload.itemTitle,
        itemType: nextPayload.itemType,
      });
      if (!channel || !channelReady) {
        timelineDragPresenceDebug("selection ignored reason", {
          reason: !channel ? "missing-channel" : "channel-not-ready",
          payload: timelineCardSelectionDebugPayload(nextPayload),
        });
        return;
      }
      broadcastTimelineDragPresence(channel, "timeline-card-selection-update", nextPayload, "selection broadcast update");
    },
    [activeDay, activeMembership?.status, activeSection, activeTripId, activeUserId, timelineDragPresenceUserName],
  );

  useEffect(() => {
    if (activeSection !== "timeline") {
      clearCardSelection();
      setTripPresenceSelectedItem(null);
    }
  }, [activeSection, clearCardSelection]);

  useEffect(() => {
    setTripPresenceSelectedItem(null);
  }, [activeDay, activeTripId]);

  const publishDragPresence = useCallback(
    (payload = {}) => {
      if (!activeTripId || !activeUserId || !canEditActiveTripContent) return;
      const channel = timelineDragPresenceChannelRef.current;
      const channelStatus = timelineDragPresenceStatusRef.current;
      const channelState = channel?.state || channel?._state || "";
      const channelReady = timelineDragPresenceReadyRef.current;
      const now = new Date().toISOString();
      const existing = localDragPresenceRef.current;
      const resetDrag = Boolean(payload.resetDrag);
      const hasDragOverPayload =
        Object.prototype.hasOwnProperty.call(payload, "overItemId") ||
        Object.prototype.hasOwnProperty.call(payload, "placement");
      const debugLabel = payload.forceTrack ? "heartbeat payload" : hasDragOverPayload ? "drag over payload" : "track start payload";
      const startedAt = resetDrag ? now : existing?.startedAt || payload.startedAt || now;
      const dragId =
        resetDrag || payload.dragId
          ? payload.dragId || `${timelineDragPresenceSessionIdRef.current}:${Date.now()}:${Math.random().toString(36).slice(2)}`
          : existing?.dragId || `${timelineDragPresenceSessionIdRef.current}:${Date.now()}`;
      const nextPayload = {
        userId: activeUserId,
        userName: timelineDragPresenceUserName,
        sessionId: timelineDragPresenceSessionIdRef.current,
        dragId,
        tripId: activeTripId,
        dayIndex: activeDay,
        itemId: payload.itemId || existing?.itemId || null,
        itemTitle: payload.itemTitle || existing?.itemTitle || "",
        startedAt,
        sentAt: now,
        overItemId: Object.prototype.hasOwnProperty.call(payload, "overItemId")
          ? payload.overItemId
          : existing?.overItemId || null,
        placement: Object.prototype.hasOwnProperty.call(payload, "placement")
          ? payload.placement
          : existing?.placement || null,
      };
      localDragPresenceRef.current = nextPayload;
      localDragStartedAtRef.current = Date.parse(startedAt) || Date.now();
      if (resetDrag) {
        timelineDragPresenceDebug("channel status on dragStart", {
          summary: timelineDragPresenceChannelSummary(channel, channelReady, channelStatus),
        });
      }
      const channelClosed =
        !channel ||
        !channelReady ||
        ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(channelStatus) ||
        ["closed", "errored"].includes(String(channelState).toLowerCase());
      if (channelClosed) {
        timelineDragPresenceDebug("track skipped reason", {
          reason: !channel ? "missing-channel" : !channelReady ? "channel-not-ready" : "channel-closed",
          summary: timelineDragPresenceChannelSummary(channel, channelReady, channelStatus),
        });
        if (resetDrag && (!channel || ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(channelStatus))) {
          timelineDragPresenceReconnectRef.current = true;
          setTimelineDragPresenceChannelVersion((version) => version + 1);
        }
        return;
      }
      if (channel && channelReady) {
        if (resetDrag) trackTimelineDragPresence(channel, nextPayload, "track start payload");
        timelineDragPresenceDebug(debugLabel, timelineDragPresenceDebugPayload(nextPayload));
        broadcastTimelineDragPresence(channel, "timeline-drag-update", nextPayload, "broadcast update");
      }
    },
    [activeDay, activeTripId, activeUserId, canEditActiveTripContent, timelineDragPresenceUserName],
  );

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (!localDragPresenceRef.current) return;
      if (localDragStartedAtRef.current && Date.now() - localDragStartedAtRef.current > timelineDragPresenceMaxMs) {
        clearDragPresence();
        return;
      }
      publishDragPresence({ forceTrack: true });
    }, timelineDragPresenceHeartbeatMs);
    return () => window.clearInterval(intervalId);
  }, [clearDragPresence, publishDragPresence]);

  return {
    foreignDragPresence,
    foreignCardSelection,
    clearDragPresence,
    clearCardSelection,
    publishCardSelection,
    publishDragPresence,
  };
}
