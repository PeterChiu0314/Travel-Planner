import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { timelineCardSelectionColor } from "../../lib/collaboratorColors.js";
import { supabase } from "../../lib/supabase.js";
import { isTransportationCard } from "../../lib/timelineTransportationRoles.js";
import { buildRoutePanelStops } from "../../lib/timelineMapMarkers.js";
import {
  normalizeRouteOverridePoints,
  routeOverridePointsEqual,
  routeOverrideSegmentKey,
  routeOverridesToSegmentMap,
  validRouteSegmentKeysFromItems,
} from "../../lib/routeOverrides.js";
import {
  routeEditPresenceHeartbeatMs,
  routeEditPresenceStaleMs,
  routeEditNodeLockStaleMs,
  routeEditBroadcastThrottleMs,
  routeEditCollaborationDebug,
  routeEditCollaborationChannelSummary,
} from "./routeCollaboration.js";
import { timelineCollaboratorColorKey } from "../timeline/timelinePresence.js";
import { sortedVisitItems } from "../timeline/timelineItemRules.js";

export function useRouteWorkspace({
    session,
    activeTripId,
    activeDay,
    items,
    activeTrip,
    activeMembership,
    canEditActiveTripContent,
    activeUserId,
    timelineDragPresenceUserName,
    dayItems,
  }) {
  const [routeOverrides, setRouteOverrides] = useState([]);

  const [routeOverrideSaveError, setRouteOverrideSaveError] = useState("");

  const [routeEditLocalState, setRouteEditLocalState] = useState({ isEditing: false, activeNodeId: null, activeSegmentKey: null });

  const [remoteRouteEditPresences, setRemoteRouteEditPresences] = useState([]);

  const [remoteRouteEditUpdates, setRemoteRouteEditUpdates] = useState({});

  const [remoteRouteEditNodeLocks, setRemoteRouteEditNodeLocks] = useState({});

  const routeOverrideCoordinateSnapshotRef = useRef(new Map());

  const routeEditPresenceChannelRef = useRef(null);

  const routeEditPresenceReadyRef = useRef(false);

  const routeEditPresenceStatusRef = useRef("idle");

  const routeEditChannelRecoveryRef = useRef(false);

  const routeEditChannelMetadataRef = useRef(new WeakMap());

  const routeEditChannelSequenceRef = useRef(0);

  const routeEditLocalStateRef = useRef({ isEditing: false, activeNodeId: null, activeSegmentKey: null });

  const routeEditSessionIdRef = useRef(`route-edit-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const routeEditBroadcastRef = useRef({ activeDragId: null, eventVersion: 0, lastSentAt: 0, pendingEvent: null, pendingReplayEvent: null, sequence: 0, timerId: null });

  const routeEditRemoteMoveVersionRef = useRef(new Map());

  const routeEditRemoteUpdateReceiptRef = useRef(0);

  const routeEditRemoteNodeLockSeenAtRef = useRef(new Map());

  const routeOverrideLoadRequestRef = useRef(0);

  const routeOverrideLoadTargetRef = useRef({ dayIndex: null, tripId: null });

  const [routeEditChannelVersion, setRouteEditChannelVersion] = useState(0);

  const [routeEditChannelReady, setRouteEditChannelReady] = useState(false);

  const [routeEditRecoveryGeneration, setRouteEditRecoveryGeneration] = useState(0);

  const activeDayRouteStops = useMemo(
    () => buildRoutePanelStops(sortedVisitItems(dayItems), { requireLocation: true }),
    [dayItems],
  );

  const activeDayRouteSegmentKeys = useMemo(
    () => validRouteSegmentKeysFromItems(sortedVisitItems(dayItems)),
    [dayItems],
  );

  const activeRouteOverridePointsBySegment = useMemo(
    () => routeOverridesToSegmentMap(routeOverrides, activeDayRouteSegmentKeys),
    [activeDayRouteSegmentKeys, routeOverrides],
  );

  const routeEditCollaboration = useMemo(() => {
    const foreignEditors = remoteRouteEditPresences.filter((presence) => presence?.routeEditMode);
    const editorUsers = new Map();
    foreignEditors.forEach((presence) => {
      const userKey = presence.userId || `session:${presence.sessionId}`;
      const previous = editorUsers.get(userKey);
      if (!previous || Date.parse(presence.updatedAt || "") >= Date.parse(previous.updatedAt || "")) {
        editorUsers.set(userKey, presence);
      }
    });
    if (routeEditLocalState.isEditing) {
      editorUsers.set(activeUserId || `session:${routeEditSessionIdRef.current}`, {
        sessionId: routeEditSessionIdRef.current,
        updatedAt: new Date().toISOString(),
        userId: activeUserId,
        userName: timelineDragPresenceUserName,
      });
    }
    const editorCount = editorUsers.size;
    const firstEditor = editorUsers.values().next().value || null;
    return {
      editorLabel: editorCount === 1
        ? `${firstEditor?.userName || "成員"} 正在編輯地圖路線`
        : editorCount > 1 ? `${editorCount} 位成員正在編輯地圖路線` : "",
      nodeLocks: remoteRouteEditNodeLocks,
      remoteUpdates: remoteRouteEditUpdates,
      isChannelReady: routeEditChannelReady,
      recoveryGeneration: routeEditRecoveryGeneration,
    };
  }, [activeUserId, remoteRouteEditNodeLocks, remoteRouteEditPresences, remoteRouteEditUpdates, routeEditChannelReady, routeEditLocalState.isEditing, routeEditRecoveryGeneration, timelineDragPresenceUserName]);

  const publishRouteEditPresence = useCallback((nextState) => {
    const channel = routeEditPresenceChannelRef.current;
    const metadata = routeEditChannelMetadataRef.current.get(channel) || null;
    if (!channel || !routeEditPresenceReadyRef.current || !activeTripId || !activeUserId) {
      routeEditCollaborationDebug("presence skipped", {
        reason: !channel ? "missing-channel" : !routeEditPresenceReadyRef.current ? "channel-not-ready" : "missing-scope",
        summary: routeEditCollaborationChannelSummary(channel, routeEditPresenceReadyRef.current, routeEditPresenceStatusRef.current, {
          ...metadata,
          isCurrentRef: routeEditPresenceChannelRef.current === channel,
        }),
      });
      return;
    }
    const payload = {
      activeNodeId: null,
      activeSegmentKey: null,
      dayIndex: activeDay,
      routeEditMode: Boolean(nextState.isEditing),
      sessionId: routeEditSessionIdRef.current,
      tripId: activeTripId,
      updatedAt: new Date().toISOString(),
      userId: activeUserId,
      userName: timelineDragPresenceUserName,
    };
    if (!payload.routeEditMode) {
      Promise.resolve(channel.untrack()).catch(() => {});
      return;
    }
    Promise.resolve(channel.track(payload)).catch(() => {});
  }, [activeDay, activeTripId, activeUserId, timelineDragPresenceUserName]);

  const onRouteEditPresenceChange = useCallback((next = {}) => {
    const state = { activeNodeId: null, activeSegmentKey: null, isEditing: Boolean(next.isEditing) };
    const channel = routeEditPresenceChannelRef.current;
    const metadata = routeEditChannelMetadataRef.current.get(channel) || null;
    routeEditCollaborationDebug(state.isEditing ? "route edit enter" : "route edit exit", {
      summary: routeEditCollaborationChannelSummary(channel, routeEditPresenceReadyRef.current, routeEditPresenceStatusRef.current, {
        ...metadata,
        isCurrentRef: routeEditPresenceChannelRef.current === channel,
      }),
    });
    routeEditLocalStateRef.current = state;
    setRouteEditLocalState(state);
    publishRouteEditPresence(state);
  }, [publishRouteEditPresence]);

  const queueRouteEditBroadcastReplay = useCallback((event = {}, reason) => {
    const broadcast = routeEditBroadcastRef.current;
    const existing = broadcast.pendingReplayEvent;
    if (event.phase === "node-drag-end" || existing?.phase !== "node-drag-end") {
      broadcast.pendingReplayEvent = event;
    }
    routeEditCollaborationDebug("broadcast queued", {
      event: event.phase || "",
      reason,
      retainedEvent: broadcast.pendingReplayEvent?.phase || "",
    });
  }, []);

  const requestRouteEditChannelRecovery = useCallback((reason) => {
    if (routeEditChannelRecoveryRef.current) {
      routeEditCollaborationDebug("recovery deduplicated", { reason });
      return;
    }
    const channel = routeEditPresenceChannelRef.current;
    const metadata = routeEditChannelMetadataRef.current.get(channel) || null;
    routeEditChannelRecoveryRef.current = true;
    routeEditPresenceReadyRef.current = false;
    routeEditPresenceStatusRef.current = "recovering";
    setRouteEditChannelReady(false);
    setRemoteRouteEditUpdates({});
    setRemoteRouteEditNodeLocks({});
    routeEditRemoteNodeLockSeenAtRef.current.clear();
    setRouteEditRecoveryGeneration((generation) => generation + 1);
    if (channel) routeEditPresenceChannelRef.current = null;
    routeEditCollaborationDebug("recovery requested", {
      reason,
      summary: routeEditCollaborationChannelSummary(channel, false, "recovering", {
        ...metadata,
        isCurrentRef: false,
      }),
    });
    routeEditCollaborationDebug("stale channel cleared", {
      reason,
      channelId: metadata?.channelId || null,
    });
    setRouteEditChannelVersion((version) => version + 1);
  }, []);

  const ensureRouteEditChannelHealth = useCallback((reason) => {
    if (!routeEditLocalStateRef.current.isEditing || !activeTripId) return;
    const channel = routeEditPresenceChannelRef.current;
    const status = routeEditPresenceStatusRef.current;
    const channelState = String(channel?.state || channel?._state || "").toLowerCase();
    const isUnusable = !channel || ["CLOSED", "CHANNEL_ERROR", "TIMED_OUT"].includes(status) ||
      ["closed", "errored"].includes(channelState);
    routeEditCollaborationDebug("channel health check", {
      reason,
      shouldRecover: isUnusable,
      summary: routeEditCollaborationChannelSummary(channel, routeEditPresenceReadyRef.current, status, {
        ...(routeEditChannelMetadataRef.current.get(channel) || {}),
        isCurrentRef: routeEditPresenceChannelRef.current === channel,
      }),
    });
    if (isUnusable) requestRouteEditChannelRecovery(reason);
  }, [activeTripId, requestRouteEditChannelRecovery]);

  const sendRouteEditBroadcast = useCallback((event = {}) => {
    const channel = routeEditPresenceChannelRef.current;
    const metadata = routeEditChannelMetadataRef.current.get(channel) || null;
    const summary = routeEditCollaborationChannelSummary(channel, routeEditPresenceReadyRef.current, routeEditPresenceStatusRef.current, {
      ...metadata,
      isCurrentRef: routeEditPresenceChannelRef.current === channel,
    });
    const channelState = String(channel?.state || channel?._state || "").toLowerCase();
    const isUsable = Boolean(channel && activeTripId && routeEditPresenceReadyRef.current &&
      routeEditPresenceStatusRef.current === "SUBSCRIBED" && !["closed", "errored"].includes(channelState));
    if (!isUsable) {
      const reason = !channel ? "missing-channel" : !activeTripId ? "missing-trip" :
        !routeEditPresenceReadyRef.current ? "channel-not-ready" :
          routeEditPresenceStatusRef.current !== "SUBSCRIBED" ? "channel-not-subscribed" : "channel-closed";
      routeEditCollaborationDebug("broadcast skipped", {
        event: event.phase || "",
        reason,
        summary,
      });
      queueRouteEditBroadcastReplay(event, reason);
      const channelState = String(channel?.state || channel?._state || "").toLowerCase();
      const channelStatus = routeEditPresenceStatusRef.current;
      if (["CLOSED", "CHANNEL_ERROR", "TIMED_OUT"].includes(channelStatus) || ["closed", "errored"].includes(channelState)) {
        requestRouteEditChannelRecovery(reason);
      }
      return;
    }
    const payload = {
      ...event,
      dayIndex: activeDay,
      sessionId: routeEditSessionIdRef.current,
      tripId: activeTripId,
      updatedAt: new Date().toISOString(),
      userId: activeUserId,
      userName: timelineDragPresenceUserName,
    };
    routeEditCollaborationDebug("broadcast send", {
      dragId: payload.dragId || null,
      event: payload.phase || "",
      nodeId: payload.nodeId || null,
      segmentKey: payload.segmentKey || null,
      sequence: payload.sequence ?? null,
      summary,
    });
    Promise.resolve(channel.send({ event: "route-edit-update", type: "broadcast", payload }))
      .then((result) => routeEditCollaborationDebug("broadcast result", {
        event: payload.phase || "",
        result: result || "ok",
        summary,
      }))
      .catch((error) => {
        routeEditCollaborationDebug("broadcast error", {
          event: payload.phase || "",
          message: error?.message || String(error),
          summary,
        });
        queueRouteEditBroadcastReplay(event, "broadcast-send-error");
        requestRouteEditChannelRecovery("broadcast-send-error");
      });
  }, [activeDay, activeTripId, activeUserId, queueRouteEditBroadcastReplay, requestRouteEditChannelRecovery, timelineDragPresenceUserName]);

  const onRouteEditCollaborationEvent = useCallback((event = {}) => {
    const isDragMove = event.phase === "node-drag-move";
    const isDragStart = event.phase === "node-drag-start";
    const isDragEnd = event.phase === "node-drag-end";
    const broadcast = routeEditBroadcastRef.current;
    const channel = routeEditPresenceChannelRef.current;
    const metadata = routeEditChannelMetadataRef.current.get(channel) || null;
    routeEditCollaborationDebug("drag event", {
      event: event.phase || "",
      nodeId: event.nodeId || null,
      segmentKey: event.segmentKey || null,
      summary: routeEditCollaborationChannelSummary(channel, routeEditPresenceReadyRef.current, routeEditPresenceStatusRef.current, {
        ...metadata,
        isCurrentRef: routeEditPresenceChannelRef.current === channel,
      }),
    });
    if (isDragStart) {
      broadcast.activeDragId = `route-node-${routeEditSessionIdRef.current}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      broadcast.sequence = 0;
    }
    const dragId = broadcast.activeDragId;
    const sequence = isDragMove ? ++broadcast.sequence : broadcast.sequence;
    const enrichedEvent = {
      ...event,
      dragId,
      eventVersion: ++broadcast.eventVersion,
      sequence,
    };
    const nextState = {
      activeNodeId: isDragStart ? event.nodeId : null,
      activeSegmentKey: isDragStart ? event.segmentKey : null,
      isEditing: true,
    };
    if (!isDragMove) {
      routeEditLocalStateRef.current = nextState;
      setRouteEditLocalState(nextState);
    }
    if (!isDragMove) {
      if (isDragEnd && broadcast.timerId) {
        window.clearTimeout(broadcast.timerId);
        broadcast.timerId = null;
        broadcast.pendingEvent = null;
      }
      sendRouteEditBroadcast(enrichedEvent);
      if (isDragEnd) {
        broadcast.activeDragId = null;
        broadcast.sequence = 0;
      }
      return;
    }

    broadcast.pendingEvent = enrichedEvent;
    const elapsed = Date.now() - broadcast.lastSentAt;
    const flushLatestMove = () => {
      const latest = broadcast.pendingEvent;
      broadcast.pendingEvent = null;
      broadcast.timerId = null;
      if (!latest) return;
      broadcast.lastSentAt = Date.now();
      sendRouteEditBroadcast(latest);
    };
    if (elapsed >= routeEditBroadcastThrottleMs && !broadcast.timerId) {
      flushLatestMove();
    } else if (!broadcast.timerId) {
      broadcast.timerId = window.setTimeout(flushLatestMove, Math.max(0, routeEditBroadcastThrottleMs - elapsed));
    }
  }, [sendRouteEditBroadcast]);

  const loadRouteOverrides = useCallback(async (tripId, dayIndex) => {
    const normalizedDayIndex = Number(dayIndex);
    if (!tripId || !Number.isInteger(Number(dayIndex))) {
      setRouteOverrides([]);
      return [];
    }

    const requestedTarget = routeOverrideLoadTargetRef.current;
    if (requestedTarget.tripId !== tripId || requestedTarget.dayIndex !== normalizedDayIndex) {
      return [];
    }

    const requestId = ++routeOverrideLoadRequestRef.current;

    const isCurrentRouteOverrideRequest = () => {
      const target = routeOverrideLoadTargetRef.current;
      return requestId === routeOverrideLoadRequestRef.current &&
        target.tripId === tripId && target.dayIndex === normalizedDayIndex;
    };

    const { data, error } = await supabase
      .from("itinerary_route_overrides")
      .select("id,trip_id,day_index,from_item_id,to_item_id,points_json,updated_at")
      .eq("trip_id", tripId)
      .eq("day_index", dayIndex);
    if (!isCurrentRouteOverrideRequest()) return [];
    if (error) {
      setRouteOverrides([]);
      return [];
    }
    const rawRows = data || [];
    const overrideIds = rawRows.map((row) => row.id).filter(Boolean);
    let rows = rawRows;
    if (overrideIds.length) {
      const { data: nodeRows, error: nodeError } = await supabase
        .from("itinerary_route_override_nodes")
        .select("id,route_override_id,node_key,order_key,lat,lng,updated_at")
        .in("route_override_id", overrideIds)
        .order("order_key", { ascending: true })
        .order("node_key", { ascending: true });
      if (!isCurrentRouteOverrideRequest()) return [];
      if (!nodeError) {
        const nodesByOverrideId = (nodeRows || []).reduce((map, node) => {
          const current = map.get(node.route_override_id) || [];
          current.push({
            id: node.node_key,
            lat: node.lat,
            lng: node.lng,
            orderKey: Number(node.order_key),
          });
          map.set(node.route_override_id, current);
          return map;
        }, new Map());
        rows = rawRows.map((row) => ({ ...row, points_json: nodesByOverrideId.get(row.id) || [] }));
      }
    }
    setRouteOverrides(rows);
    return rows;
  }, []);

  useEffect(() => {
    routeOverrideLoadTargetRef.current = {
      dayIndex: Number.isInteger(Number(activeDay)) ? Number(activeDay) : null,
      tripId: activeTripId || null,
    };
    if (!activeTripId ) {
      setRouteOverrides([]);
      return;
    }
    void loadRouteOverrides(activeTripId, activeDay);
  }, [activeDay, activeTripId, loadRouteOverrides]);

  useEffect(() => {
    if (!activeTripId || !activeUserId || activeMembership?.status !== "approved") {
      routeEditCollaborationDebug("channel skipped", {
        activeTripId: activeTripId || null,
        dayIndex: activeDay,
        reason: "missing-approved-scope",
        sessionId: routeEditSessionIdRef.current,
      });
      routeEditPresenceChannelRef.current = null;
      routeEditPresenceReadyRef.current = false;
      routeEditPresenceStatusRef.current = "idle";
      setRouteEditChannelReady(false);
      setRemoteRouteEditPresences([]);
      setRemoteRouteEditUpdates({});
      setRemoteRouteEditNodeLocks({});
      routeEditRemoteNodeLockSeenAtRef.current.clear();
      routeEditRemoteMoveVersionRef.current.clear();
      return undefined;
    }

    const channelName = `timeline-route-edit:${activeTripId}:${activeDay}`;
    const sessionId = routeEditSessionIdRef.current;
    const channel = supabase.channel(channelName, { config: { presence: { key: sessionId } } });
    const metadata = {
      channelId: ++routeEditChannelSequenceRef.current,
      channelName,
      dayIndex: activeDay,
      sessionId,
      tripId: activeTripId,
    };
    routeEditChannelMetadataRef.current.set(channel, metadata);
    const isReplacementChannel = routeEditChannelRecoveryRef.current;
    routeEditPresenceChannelRef.current = channel;
    routeEditPresenceReadyRef.current = false;
    routeEditPresenceStatusRef.current = "creating";
    setRouteEditChannelReady(false);
    routeEditChannelRecoveryRef.current = false;
    const matchingChannels = (supabase.getChannels?.() || []).filter((candidate) => candidate?.topic === channel.topic);
    routeEditCollaborationDebug("channel created", {
      dayIndex: activeDay,
      duplicateTopicCount: matchingChannels.length,
      sessionId,
      summary: routeEditCollaborationChannelSummary(channel, false, "creating", { ...metadata, isCurrentRef: true }),
      tripId: activeTripId,
    });
    if (isReplacementChannel) {
      routeEditCollaborationDebug("replacement channel created", {
        summary: routeEditCollaborationChannelSummary(channel, false, "creating", { ...metadata, isCurrentRef: true }),
      });
    }

    const syncPresence = () => {
      const staleBefore = Date.now() - routeEditPresenceStaleMs;
      const rawPresences = Object.values(channel.presenceState())
        .flat()
        .filter((presence) => {
          const updatedAt = Date.parse(presence?.updatedAt || "");
          return presence?.routeEditMode && presence.sessionId !== sessionId &&
            presence.tripId === activeTripId && Number(presence.dayIndex) === Number(activeDay) &&
            Number.isFinite(updatedAt) && updatedAt >= staleBefore;
        });
      const latestPresenceBySession = new Map();
      rawPresences.forEach((presence) => {
        const presenceKey = presence.sessionId || presence.userId;
        if (!presenceKey) return;
        const previous = latestPresenceBySession.get(presenceKey);
        if (!previous || Date.parse(presence.updatedAt || "") >= Date.parse(previous.updatedAt || "")) {
          latestPresenceBySession.set(presenceKey, presence);
        }
      });
      const presences = [...latestPresenceBySession.values()];
      const editorUserKeys = new Set(presences.map((presence) => presence.userId || `session:${presence.sessionId}`));
      if (routeEditLocalStateRef.current.isEditing) editorUserKeys.add(activeUserId || `session:${routeEditSessionIdRef.current}`);
      const uniqueUserCount = editorUserKeys.size;
      routeEditCollaborationDebug("presence synced", {
        displayedEditorCount: uniqueUserCount,
        rawMetaCount: rawPresences.length,
        uniqueSessionCount: presences.length,
        uniqueUserCount,
      });
      setRemoteRouteEditPresences(presences);
    };

    channel
      .on("presence", { event: "sync" }, syncPresence)
      .on("broadcast", { event: "route-edit-update" }, ({ payload }) => {
        const isCurrentChannel = routeEditPresenceChannelRef.current === channel;
        const summary = routeEditCollaborationChannelSummary(channel, routeEditPresenceReadyRef.current, routeEditPresenceStatusRef.current, {
          ...metadata,
          isCurrentRef: isCurrentChannel,
        });
        routeEditCollaborationDebug("broadcast received", {
          dragId: payload?.dragId || null,
          nodeId: payload?.nodeId || null,
          phase: payload?.phase || null,
          segmentKey: payload?.segmentKey || null,
          sequence: payload?.sequence ?? null,
          summary,
        });
        if (!isCurrentChannel) {
          routeEditCollaborationDebug("broadcast ignored", { reason: "stale-channel", summary });
          return;
        }
        if (!payload || payload.sessionId === sessionId || payload.tripId !== activeTripId || Number(payload.dayIndex) !== Number(activeDay)) {
          routeEditCollaborationDebug("broadcast ignored", {
            reason: !payload ? "missing-payload" : payload.sessionId === sessionId ? "self" : payload.tripId !== activeTripId ? "trip-mismatch" : "day-mismatch",
            summary,
          });
          return;
        }
        if (payload.segmentKey && payload.nodeId) {
          const moveKey = `${payload.sessionId}:${payload.segmentKey}:${payload.nodeId}`;
          const sequence = Number(payload.sequence);
          const eventVersion = Number(payload.eventVersion);
          const updatedAt = Date.parse(payload.updatedAt || "");
          const incomingVersion = Number.isFinite(eventVersion) ? eventVersion : updatedAt;
          const previousVersion = routeEditRemoteMoveVersionRef.current.get(moveKey);
          if (Number.isFinite(incomingVersion) && Number.isFinite(previousVersion) && incomingVersion <= previousVersion) {
            routeEditCollaborationDebug("broadcast ignored", { incomingVersion, previousVersion, reason: "stale-sequence", summary });
            return;
          }
          if (Number.isFinite(incomingVersion)) {
            routeEditRemoteMoveVersionRef.current.set(moveKey, incomingVersion);
          }
          const node = normalizeRouteOverridePoints(payload.node ? [payload.node] : [])[0] || null;
          if (payload.phase !== "node-delete" && payload.phase !== "node-drag-start" && !node) {
            routeEditCollaborationDebug("broadcast ignored", { reason: "invalid-node", summary });
            return;
          }
          const remoteUpdate = {
            afterNodeId: payload.afterNodeId || null,
            dragId: payload.dragId || null,
            eventVersion: Number.isFinite(eventVersion) ? eventVersion : null,
            node,
            nodeId: payload.nodeId || null,
            phase: payload.phase || "",
            receiptId: ++routeEditRemoteUpdateReceiptRef.current,
            segmentKey: payload.segmentKey,
            sessionId: payload.sessionId,
            sequence: Number.isFinite(sequence) ? sequence : null,
            updatedAt: payload.updatedAt || new Date().toISOString(),
            userId: payload.userId || null,
            userName: payload.userName || "",
          };
          const lockKey = `${payload.segmentKey}:${payload.nodeId}`;
          const hadSeenLock = routeEditRemoteNodeLockSeenAtRef.current.has(lockKey);
          if (["node-drag-start", "node-drag-move"].includes(payload.phase)) {
            routeEditRemoteNodeLockSeenAtRef.current.set(lockKey, Date.now());
            if (payload.phase === "node-drag-start" || !hadSeenLock) {
              setRemoteRouteEditNodeLocks((current) => ({
                ...current,
                [lockKey]: {
                  color: timelineCardSelectionColor(
                    timelineCollaboratorColorKey(payload.userId, payload.sessionId),
                  ),
                  dragId: payload.dragId || null,
                  nodeId: payload.nodeId,
                  segmentKey: payload.segmentKey,
                  sessionId: payload.sessionId,
                  updatedAt: remoteUpdate.updatedAt,
                  userId: payload.userId || null,
                  userName: payload.userName || "",
                },
              }));
            }
          } else if (["node-drag-end", "node-delete"].includes(payload.phase)) {
            routeEditRemoteNodeLockSeenAtRef.current.delete(lockKey);
            setRemoteRouteEditNodeLocks((current) => {
              const existing = current[lockKey];
              if (!existing || existing.sessionId !== payload.sessionId) return current;
              const next = { ...current };
              delete next[lockKey];
              return next;
            });
          }
          // Keep ownership transfer separate from position updates. React may
          // batch a rapid drag-start/move/end sequence; using one node key can
          // overwrite drag-start before the provider releases the previous
          // owner's pending final. Two bounded slots per node preserve that
          // causal edge without retaining an unbounded event queue.
          const remoteUpdateSlot = payload.phase === "node-drag-start" ? "ownership" : "position";
          setRemoteRouteEditUpdates((current) => ({
            ...current,
            [`${payload.segmentKey}:${payload.nodeId}:${remoteUpdateSlot}`]: remoteUpdate,
          }));
        }
      })
      .subscribe((status, error) => {
        const isCurrentChannel = routeEditPresenceChannelRef.current === channel;
        if (isCurrentChannel) routeEditPresenceStatusRef.current = status;
        routeEditCollaborationDebug("subscribe status", {
          error: error || null,
          status,
          summary: routeEditCollaborationChannelSummary(channel, routeEditPresenceReadyRef.current, status, {
            ...metadata,
            isCurrentRef: isCurrentChannel,
          }),
        });
        if (!isCurrentChannel) {
          routeEditCollaborationDebug("subscribe status ignored", { reason: "stale-channel", status, channelId: metadata.channelId });
          return;
        }
        if (status !== "SUBSCRIBED") {
          if (["CLOSED", "CHANNEL_ERROR", "TIMED_OUT"].includes(status)) {
            routeEditPresenceReadyRef.current = false;
            setRouteEditChannelReady(false);
            routeEditCollaborationDebug("channel unusable", {
              error: error || null,
              status,
              summary: routeEditCollaborationChannelSummary(channel, false, status, { ...metadata, isCurrentRef: true }),
            });
            requestRouteEditChannelRecovery(`subscribe-${String(status).toLowerCase()}`);
          }
          return;
        }
        routeEditPresenceReadyRef.current = true;
        publishRouteEditPresence(routeEditLocalStateRef.current);
        syncPresence();
        const finishRouteEditChannelSync = () => {
          if (routeEditPresenceChannelRef.current !== channel || routeEditPresenceStatusRef.current !== "SUBSCRIBED") {
            routeEditCollaborationDebug("replacement resync ignored", {
              reason: "stale-channel",
              summary: routeEditCollaborationChannelSummary(channel, false, status, { ...metadata, isCurrentRef: false }),
            });
            return;
          }
          setRouteEditChannelReady(true);
          const pendingReplayEvent = routeEditBroadcastRef.current.pendingReplayEvent;
          if (pendingReplayEvent) {
            routeEditBroadcastRef.current.pendingReplayEvent = null;
            routeEditCollaborationDebug("pending broadcast replayed", {
              event: pendingReplayEvent.phase || "",
              summary: routeEditCollaborationChannelSummary(channel, true, status, { ...metadata, isCurrentRef: true }),
            });
            sendRouteEditBroadcast(pendingReplayEvent);
          }
        };
        if (!isReplacementChannel) {
          finishRouteEditChannelSync();
          return;
        }
        setRouteEditChannelReady(false);
        routeEditCollaborationDebug("replacement resync started", {
          summary: routeEditCollaborationChannelSummary(channel, false, status, { ...metadata, isCurrentRef: true }),
        });
        void loadRouteOverrides(activeTripId, activeDay).finally(() => {
          routeEditCollaborationDebug("replacement resync complete", {
            summary: routeEditCollaborationChannelSummary(channel, true, status, {
              ...metadata,
              isCurrentRef: routeEditPresenceChannelRef.current === channel,
            }),
          });
          finishRouteEditChannelSync();
        });
      });

    const refreshId = window.setInterval(() => {
      syncPresence();
      const staleBefore = Date.now() - routeEditNodeLockStaleMs;
      setRemoteRouteEditNodeLocks((current) => {
        const next = Object.fromEntries(Object.entries(current).filter(([lockKey]) => {
          const seenAt = routeEditRemoteNodeLockSeenAtRef.current.get(lockKey);
          const isFresh = Number.isFinite(seenAt) && seenAt >= staleBefore;
          if (!isFresh) routeEditRemoteNodeLockSeenAtRef.current.delete(lockKey);
          return isFresh;
        }));
        return Object.keys(next).length === Object.keys(current).length ? current : next;
      });
    }, 5000);
    const heartbeatId = window.setInterval(() => {
      if (routeEditLocalStateRef.current.isEditing) {
        ensureRouteEditChannelHealth("presence-heartbeat");
        publishRouteEditPresence(routeEditLocalStateRef.current);
      }
    }, routeEditPresenceHeartbeatMs);
    const recoverOnForeground = (reason) => {
      ensureRouteEditChannelHealth(reason);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") recoverOnForeground("visibility-visible");
    };
    const onWindowFocus = () => recoverOnForeground("window-focus");
    const onWindowOnline = () => recoverOnForeground("window-online");
    window.addEventListener("focus", onWindowFocus);
    window.addEventListener("online", onWindowOnline);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      const isRecoveryCleanup = routeEditChannelRecoveryRef.current;
      window.clearInterval(refreshId);
      window.clearInterval(heartbeatId);
      window.removeEventListener("focus", onWindowFocus);
      window.removeEventListener("online", onWindowOnline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      routeEditCollaborationDebug("channel remove", {
        reason: isRecoveryCleanup ? "recovery-replacement" : "scope-or-unmount",
        summary: routeEditCollaborationChannelSummary(channel, routeEditPresenceReadyRef.current, routeEditPresenceStatusRef.current, {
          ...metadata,
          isCurrentRef: routeEditPresenceChannelRef.current === channel,
        }),
      });
      const isCurrentChannel = routeEditPresenceChannelRef.current === channel;
      if (isCurrentChannel) {
        routeEditPresenceChannelRef.current = null;
        routeEditPresenceReadyRef.current = false;
        routeEditPresenceStatusRef.current = "idle";
        setRouteEditChannelReady(false);
      }
      if (!isRecoveryCleanup) {
        const broadcast = routeEditBroadcastRef.current;
        if (broadcast.pendingReplayEvent) {
          routeEditCollaborationDebug("pending payload dropped", {
            event: broadcast.pendingReplayEvent.phase || "",
            reason: "scope-or-unmount",
          });
        }
        if (broadcast.timerId) window.clearTimeout(broadcast.timerId);
        broadcast.timerId = null;
        broadcast.pendingEvent = null;
        broadcast.pendingReplayEvent = null;
        setRemoteRouteEditPresences([]);
        setRemoteRouteEditUpdates({});
        setRemoteRouteEditNodeLocks({});
        routeEditRemoteNodeLockSeenAtRef.current.clear();
        routeEditRemoteMoveVersionRef.current.clear();
      }
      Promise.resolve(channel.untrack()).catch(() => {});
      void supabase.removeChannel(channel);
    };
  }, [activeDay, activeMembership?.status, activeTripId, activeUserId, ensureRouteEditChannelHealth, loadRouteOverrides, publishRouteEditPresence, requestRouteEditChannelRecovery, routeEditChannelVersion, sendRouteEditBroadcast]);

  useEffect(() => () => {
    const broadcast = routeEditBroadcastRef.current;
    if (broadcast.timerId) window.clearTimeout(broadcast.timerId);
    broadcast.timerId = null;
    broadcast.pendingEvent = null;
    broadcast.pendingReplayEvent = null;
  }, []);

  useEffect(() => {
    if (!activeTrip?.id || !canEditActiveTripContent || !routeOverrides.length) return;
    const invalidOverrides = routeOverrides.filter((override) => (
      !activeDayRouteSegmentKeys.has(routeOverrideSegmentKey(override.from_item_id, override.to_item_id))
    ));
    if (!invalidOverrides.length) return;
    const invalidIds = invalidOverrides.map((override) => override.id).filter(Boolean);
    if (!invalidIds.length) return;
    setRouteOverrides((current) => current.filter((override) => !invalidIds.includes(override.id)));
    void supabase
      .from("itinerary_route_overrides")
      .delete()
      .eq("trip_id", activeTrip.id)
      .eq("day_index", activeDay)
      .in("id", invalidIds);
  }, [activeDay, activeDayRouteSegmentKeys, activeTrip?.id, canEditActiveTripContent, routeOverrides]);

  useEffect(() => {
    if (!activeTrip?.id ) {
      routeOverrideCoordinateSnapshotRef.current = new Map();
      return;
    }

    const nextSnapshot = new Map(
      items
        .filter((item) => item.trip_id === activeTrip.id && !isTransportationCard(item))
        .map((item) => [item.id, `${item.latitude ?? ""}:${item.longitude ?? ""}`]),
    );
    const previousSnapshot = routeOverrideCoordinateSnapshotRef.current;
    const changedItemIds = [];
    nextSnapshot.forEach((signature, itemId) => {
      if (previousSnapshot.has(itemId) && previousSnapshot.get(itemId) !== signature) {
        changedItemIds.push(itemId);
      }
    });
    routeOverrideCoordinateSnapshotRef.current = nextSnapshot;

    if (!canEditActiveTripContent || !changedItemIds.length) return;
    setRouteOverrides((current) =>
      current.filter(
        (override) =>
          !changedItemIds.includes(override.from_item_id) &&
          !changedItemIds.includes(override.to_item_id),
      ),
    );
    void Promise.all([
      supabase
        .from("itinerary_route_overrides")
        .delete()
        .eq("trip_id", activeTrip.id)
        .in("from_item_id", changedItemIds),
      supabase
        .from("itinerary_route_overrides")
        .delete()
        .eq("trip_id", activeTrip.id)
        .in("to_item_id", changedItemIds),
    ]);
  }, [activeTrip?.id, canEditActiveTripContent, items]);

  function showRouteOverrideSaveError() {
    setRouteOverrideSaveError("路線保存失敗，已還原。");
    window.setTimeout(() => setRouteOverrideSaveError(""), 3600);
  }

  async function saveRouteOverrideChange({ fromItemId, operation = null, points = [], segmentKey, toItemId }) {
    const baselinePoints = activeRouteOverridePointsBySegment[segmentKey] || [];
    let failurePoints = baselinePoints;
    if (!activeTrip || !canEditActiveTripContent || !fromItemId || !toItemId) {
      return { ok: false, points: baselinePoints };
    }

    const requestedPoints = normalizeRouteOverridePoints(points);
    // A remote node-add preview can be visible before this client has loaded
    // that node into its authoritative baseline.  Deleting the preview then
    // produces requested=[] and baseline=[], but must still issue the
    // idempotent node DELETE instead of reporting a false local success.
    if (operation?.type !== "delete" && routeOverridePointsEqual(requestedPoints, baselinePoints)) {
      return { ok: true, points: baselinePoints };
    }
    if (!operation?.type) {
      showRouteOverrideSaveError();
      return { ok: false, points: baselinePoints };
    }

    const nodeRowsToPoints = (rows = []) => normalizeRouteOverridePoints(rows.map((row) => ({
      id: row.node_key,
      lat: row.lat,
      lng: row.lng,
      orderKey: Number(row.order_key),
    })));
    const loadNodeRows = async (routeOverrideId) => {
      const { data, error } = await supabase
        .from("itinerary_route_override_nodes")
        .select("id,route_override_id,node_key,order_key,lat,lng,updated_at")
        .eq("route_override_id", routeOverrideId)
        .order("order_key", { ascending: true })
        .order("node_key", { ascending: true });
      if (error) throw error;
      return data || [];
    };

    try {
      let { data: routeOverride, error: routeOverrideError } = await supabase
        .from("itinerary_route_overrides")
        .select("id,trip_id,day_index,from_item_id,to_item_id,points_json,updated_at")
        .eq("trip_id", activeTrip.id)
        .eq("day_index", activeDay)
        .eq("from_item_id", fromItemId)
        .eq("to_item_id", toItemId)
        .maybeSingle();
      if (routeOverrideError) throw routeOverrideError;

      if (!routeOverride && operation.type === "add" && operation.node?.id) {
        const insertResult = await supabase
          .from("itinerary_route_overrides")
          .insert({
            trip_id: activeTrip.id,
            day_index: activeDay,
            from_item_id: fromItemId,
            to_item_id: toItemId,
            points_json: [],
            created_by: session?.user?.id || null,
            updated_by: session?.user?.id || null,
          })
          .select("id,trip_id,day_index,from_item_id,to_item_id,points_json,updated_at")
          .single();
        if (insertResult.error && insertResult.error.code !== "23505") throw insertResult.error;
        routeOverride = insertResult.data || null;
        if (!routeOverride) {
          const retryResult = await supabase
            .from("itinerary_route_overrides")
            .select("id,trip_id,day_index,from_item_id,to_item_id,points_json,updated_at")
            .eq("trip_id", activeTrip.id)
            .eq("day_index", activeDay)
            .eq("from_item_id", fromItemId)
            .eq("to_item_id", toItemId)
            .single();
          if (retryResult.error) throw retryResult.error;
          routeOverride = retryResult.data;
        }
      }

      if (!routeOverride) {
        return { ok: true, points: [] };
      }

      const latestNodeRows = await loadNodeRows(routeOverride.id);
      // A node may have arrived through Realtime/Broadcast before React's
      // route-override baseline catches up.  Preserve the authoritative rows
      // read immediately before the mutation so a failed DELETE can restore
      // the node locally and publish the inverse node-add to collaborators.
      failurePoints = nodeRowsToPoints(latestNodeRows);
      if (operation.type === "update" && operation.node?.id) {
        const { error } = await supabase
          .from("itinerary_route_override_nodes")
          .update({
            lat: operation.node.lat,
            lng: operation.node.lng,
            updated_by: session?.user?.id || null,
          })
          .eq("route_override_id", routeOverride.id)
          .eq("node_key", operation.node.id);
        if (error) throw error;
      } else if (operation.type === "add" && operation.node?.id) {
        const nodeAlreadyExists = latestNodeRows.some((row) => row.node_key === operation.node.id);
        if (!nodeAlreadyExists) {
          const afterIndex = operation.afterNodeId
            ? latestNodeRows.findIndex((row) => row.node_key === operation.afterNodeId)
            : -1;
          const previousOrder = afterIndex >= 0 ? Number(latestNodeRows[afterIndex]?.order_key) : null;
          const nextOrder = Number(latestNodeRows[afterIndex + 1]?.order_key);
          const firstOrder = Number(latestNodeRows[0]?.order_key);
          const orderKey = previousOrder === null
            ? (Number.isFinite(firstOrder) ? firstOrder - 1000 : 1000)
            : (Number.isFinite(nextOrder) ? (previousOrder + nextOrder) / 2 : previousOrder + 1000);
          const { error } = await supabase
            .from("itinerary_route_override_nodes")
            .insert({
              route_override_id: routeOverride.id,
              node_key: operation.node.id,
              order_key: orderKey,
              lat: operation.node.lat,
              lng: operation.node.lng,
              created_by: session?.user?.id || null,
              updated_by: session?.user?.id || null,
            });
          if (error) throw error;
        }
      } else if (operation.type === "delete" && operation.nodeId) {
        const { error } = await supabase
          .from("itinerary_route_override_nodes")
          .delete()
          .eq("route_override_id", routeOverride.id)
          .eq("node_key", operation.nodeId);
        if (error) throw error;
      } else {
        throw new Error("Unsupported route node operation");
      }

      const nextNodeRows = await loadNodeRows(routeOverride.id);
      const nextPoints = nodeRowsToPoints(nextNodeRows);
      const nextRouteOverride = {
        ...routeOverride,
        points_json: nextPoints,
        updated_at: new Date().toISOString(),
      };
      setRouteOverrides((current) => [
        ...current.filter(
          (override) =>
            !(
              override.from_item_id === fromItemId &&
              override.to_item_id === toItemId &&
              Number(override.day_index) === Number(activeDay)
            ),
        ),
        nextRouteOverride,
      ]);
      return { ok: true, points: nextPoints };
    } catch {
      showRouteOverrideSaveError();
      return { ok: false, points: failurePoints };
    }
  }

  function clearRouteOverrides() {
    setRouteOverrides([]);
  }

  function invalidateChangedEndpoints(nextItems) {
    // Apply itinerary-primary route invalidation in the same authoritative
    // load that receives changed endpoint coordinates.  Waiting for a later
    // route-override reload can race the writer's follow-up DELETE and read
    // the old segment back into this client.
    const previousCoordinateSnapshot = routeOverrideCoordinateSnapshotRef.current;
    const changedRouteEndpointIds = nextItems.reduce((changedIds, item) => {
      if (isTransportationCard(item) || !previousCoordinateSnapshot.has(item.id)) return changedIds;
      const signature = `${item.latitude ?? ""}:${item.longitude ?? ""}`;
      if (previousCoordinateSnapshot.get(item.id) !== signature) changedIds.push(item.id);
      return changedIds;
    }, []);
    if (changedRouteEndpointIds.length) {
      setRouteOverrides((current) => current.filter(
        (override) =>
          !changedRouteEndpointIds.includes(override.from_item_id) &&
          !changedRouteEndpointIds.includes(override.to_item_id),
      ));
    }
  }

  return {
    clearRouteOverrides,
    routeOverrideSaveError,
    invalidateChangedEndpoints,
    activeRouteOverridePointsBySegment,
    routeEditCollaboration,
    onRouteEditPresenceChange,
    onRouteEditCollaborationEvent,
    loadRouteOverrides,
    saveRouteOverrideChange,
  };
}
