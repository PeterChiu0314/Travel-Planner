import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { tripPresencePageKey } from "../lib/tripPresenceDisplay.js";
import { supabase } from "../lib/supabase.js";
import {
  tripPresenceHeartbeatMs,
  tripPresenceStaleMs,
  tripPresenceRecoverableStatuses,
  tripPresencePageToSection,
  tripPresenceDebug,
  tripPresenceDebugPayload,
} from "./tripPresence.js";
import { timelineCollaboratorColorKey } from "../components/timeline/timelinePresence.js";

export function useTripPresence({
    activeTripId,
    activeDay,
    setActiveDay,
    activeSection,
    changeTripSection,
    timelineDragPresenceSessionIdRef,
    activeMembership,
    activeUserId,
    timelineDragPresenceUserName,
  }) {
  const [remoteTripPresences, setRemoteTripPresences] = useState([]);

  const [tripPresenceSelectedItem, setTripPresenceSelectedItem] = useState(null);

  const tripPresenceChannelRef = useRef(null);

  const tripPresenceChannelKeyRef = useRef("");

  const tripPresenceReadyRef = useRef(false);

  const tripPresenceStatusRef = useRef("idle");

  const tripPresencePayloadRef = useRef(null);

  const tripPresenceReconnectRef = useRef(false);

  const [tripPresenceChannelVersion, setTripPresenceChannelVersion] = useState(0);

  const tripPresencePayload = useMemo(() => {
    const pageKey = tripPresencePageKey(activeSection);
    const selectedItem = pageKey === "timeline" ? tripPresenceSelectedItem : null;
    return {
      tripId: activeTripId,
      userId: activeUserId,
      userName: timelineDragPresenceUserName,
      sessionId: timelineDragPresenceSessionIdRef.current,
      colorKey: timelineCollaboratorColorKey(activeUserId, timelineDragPresenceSessionIdRef.current),
      pageKey,
      dayIndex: pageKey === "timeline" ? activeDay : null,
      selectedItemId: selectedItem?.itemId || null,
      selectedItemType: selectedItem?.itemType || null,
      selectedItemTitle: selectedItem?.itemTitle || "",
      updatedAt: new Date().toISOString(),
    };
  }, [activeDay, activeSection, activeTripId, activeUserId, timelineDragPresenceUserName, tripPresenceSelectedItem]);

  const remoteTripPresenceByUser = useMemo(() => {
    const byUser = new Map();
    remoteTripPresences.forEach((presence) => {
      if (!presence?.userId || presence.userId === activeUserId) return;
      const current = byUser.get(presence.userId);
      const currentUpdatedAt = current ? Date.parse(current.updatedAt || "") : 0;
      const nextUpdatedAt = Date.parse(presence.updatedAt || "");
      if (!current || nextUpdatedAt >= currentUpdatedAt) byUser.set(presence.userId, presence);
    });
    return byUser;
  }, [activeUserId, remoteTripPresences]);

  const timelineDayTabPresenceByDay = useMemo(() => {
    const byDay = new Map();
    remoteTripPresences.forEach((presence) => {
      if (presence?.pageKey !== "timeline" || presence.userId === activeUserId) return;
      const dayIndex = Number(presence.dayIndex);
      if (!Number.isInteger(dayIndex)) return;
      const entries = byDay.get(dayIndex) || [];
      if (!entries.some((entry) => entry.userId === presence.userId) && entries.length < 3) entries.push(presence);
      byDay.set(dayIndex, entries);
    });
    tripPresenceDebug("computed day tab presence", {
      dayTabPresence: Object.fromEntries([...byDay.entries()].map(([dayIndex, entries]) => [dayIndex, entries.map(tripPresenceDebugPayload)])),
    });
    return byDay;
  }, [activeUserId, remoteTripPresences]);

  async function navigateToTripPresence(presence) {
    if (!presence || presence.sessionId === timelineDragPresenceSessionIdRef.current || presence.userId === activeUserId) return;
    const section = tripPresencePageToSection[presence.pageKey];
    tripPresenceDebug("avatar click navigation", { payload: tripPresenceDebugPayload(presence), section });
    if (!section || !await changeTripSection(section)) return;
    if (presence.pageKey === "timeline" && Number.isInteger(Number(presence.dayIndex))) {
      setActiveDay(Number(presence.dayIndex));
    }
  }

  useEffect(() => {
    tripPresencePayloadRef.current = tripPresencePayload;
  }, [tripPresencePayload]);

  const requestTripPresenceReconnect = useCallback((reason = "unknown") => {
    tripPresenceDebug("reconnect requested reason", {
      alreadyPending: tripPresenceReconnectRef.current,
      hasChannel: Boolean(tripPresenceChannelRef.current),
      ready: tripPresenceReadyRef.current,
      reason,
      status: tripPresenceStatusRef.current,
    });
    if (tripPresenceReconnectRef.current) return;
    tripPresenceReconnectRef.current = true;
    setTripPresenceChannelVersion((current) => current + 1);
  }, []);

  const publishTripPresence = useCallback((reason = "update") => {
    const channel = tripPresenceChannelRef.current;
    const channelName = tripPresenceChannelKeyRef.current;
    const payload = tripPresencePayloadRef.current;
    const status = tripPresenceStatusRef.current;
    const expectedChannelName = payload?.tripId ? `trip-presence:${payload.tripId}` : "";
    const channelMatchesPayload = Boolean(channelName && expectedChannelName && channelName === expectedChannelName);
    if (!channel || !tripPresenceReadyRef.current || !payload?.tripId || !payload?.userId || !payload?.pageKey || !channelMatchesPayload) {
      tripPresenceDebug("track skipped", {
        reason,
        channelName,
        expectedChannelName,
        hasChannel: Boolean(channel),
        ready: tripPresenceReadyRef.current,
        status,
        payload: tripPresenceDebugPayload(payload),
      });
      const shouldReconnect =
        !channel || !channelMatchesPayload || tripPresenceRecoverableStatuses.has(status) || (!tripPresenceReadyRef.current && status !== "creating");
      if (payload?.tripId && payload?.userId && payload?.pageKey && shouldReconnect) {
        if (reason === "heartbeat") {
          tripPresenceDebug("heartbeat requested reconnect", {
            channelName,
            expectedChannelName,
            hasChannel: Boolean(channel),
            ready: tripPresenceReadyRef.current,
            status,
          });
        }
        requestTripPresenceReconnect(reason);
      }
      return;
    }
    const nextPayload = { ...payload, updatedAt: new Date().toISOString() };
    tripPresencePayloadRef.current = nextPayload;
    tripPresenceDebug("track latest payload", {
      payload: tripPresenceDebugPayload(nextPayload),
      reason,
    });
    Promise.resolve(channel.track(nextPayload))
      .then((result) => {
        if (result && result !== "ok") {
          tripPresenceDebug("track error", {
            payload: tripPresenceDebugPayload(nextPayload),
            result,
          });
        } else {
          tripPresenceDebug("track result", {
            payload: tripPresenceDebugPayload(nextPayload),
            result: result || "ok",
          });
        }
      })
      .catch((error) => {
        tripPresenceDebug("track error", {
          message: error?.message || String(error),
          payload: tripPresenceDebugPayload(nextPayload),
        });
      });
  }, [requestTripPresenceReconnect]);

  useEffect(() => {
    if (!activeTripId || !activeUserId || activeMembership?.status !== "approved") {
      tripPresenceDebug("subscribe skipped", {
        activeTripId,
        activeUserId,
        membershipStatus: activeMembership?.status || null,
      });
      setRemoteTripPresences([]);
      tripPresenceChannelRef.current = null;
      tripPresenceChannelKeyRef.current = "";
      tripPresenceReadyRef.current = false;
      tripPresenceStatusRef.current = "idle";
      return undefined;
    }
    const sessionId = timelineDragPresenceSessionIdRef.current;
    const channelName = `trip-presence:${activeTripId}`;
    const channel = supabase.channel(channelName, {
      config: { presence: { key: sessionId } },
    });
    tripPresenceChannelRef.current = channel;
    tripPresenceChannelKeyRef.current = channelName;
    tripPresenceReadyRef.current = false;
    tripPresenceStatusRef.current = "creating";
    tripPresenceReconnectRef.current = false;
    tripPresenceDebug("recreate channel", {
      channelName,
      version: tripPresenceChannelVersion,
    });
    tripPresenceDebug("subscribe start", {
      channelName,
      sessionId,
      payload: tripPresenceDebugPayload(tripPresencePayloadRef.current),
    });

    const syncTripPresence = () => {
      const now = Date.now();
      const state = channel.presenceState();
      const bySession = new Map();
      Object.values(state)
        .flat()
        .forEach((payload) => {
          if (!payload || payload.sessionId === sessionId || payload.tripId !== activeTripId) return;
          const rawUpdatedAt = payload.updatedAt || "";
          const updatedAt = typeof rawUpdatedAt === "number" ? rawUpdatedAt : Date.parse(rawUpdatedAt);
          if (!Number.isFinite(updatedAt) || now - updatedAt > tripPresenceStaleMs) {
            tripPresenceDebug("stale filtered", {
              ageMs: Number.isFinite(updatedAt) ? now - updatedAt : null,
              payload: tripPresenceDebugPayload(payload),
            });
            return;
          }
          const current = bySession.get(payload.sessionId);
          const currentUpdatedAt = current ? Date.parse(current.updatedAt || "") : 0;
          if (!current || updatedAt >= currentUpdatedAt) bySession.set(payload.sessionId, payload);
        });
      const nextPresences = [...bySession.values()].sort((left, right) =>
        String(left.userName || left.userId || "").localeCompare(String(right.userName || right.userId || "")),
      );
      tripPresenceDebug("sync state", {
        channelName,
        rawPresenceKeys: Object.keys(state),
        presences: nextPresences.map(tripPresenceDebugPayload),
      });
      tripPresenceDebug("computed online members", {
        count: nextPresences.length,
        users: nextPresences.map((presence) => ({
          userId: presence.userId,
          userName: presence.userName,
          pageKey: presence.pageKey,
          dayIndex: presence.dayIndex,
        })),
      });
      setRemoteTripPresences(nextPresences);
    };

    channel
      .on("presence", { event: "sync" }, syncTripPresence)
      .on("presence", { event: "join" }, syncTripPresence)
      .on("presence", { event: "leave" }, syncTripPresence)
      .subscribe((status) => {
        const isCurrentChannel = tripPresenceChannelRef.current === channel && tripPresenceChannelKeyRef.current === channelName;
        if (isCurrentChannel) tripPresenceStatusRef.current = status;
        tripPresenceDebug("subscribed", { channelName, currentChannel: isCurrentChannel, status });
        if (!isCurrentChannel) {
          if (tripPresenceRecoverableStatuses.has(status)) {
            tripPresenceDebug("stale channel status ignored", { channelName, status });
          }
          return;
        }
        if (status === "SUBSCRIBED") {
          tripPresenceReadyRef.current = true;
          tripPresenceDebug("replay track after subscribed", {
            payload: tripPresenceDebugPayload(tripPresencePayloadRef.current),
            status,
          });
          publishTripPresence("subscribed");
          syncTripPresence();
        }
        if (tripPresenceRecoverableStatuses.has(status)) {
          tripPresenceReadyRef.current = false;
          if (tripPresenceChannelRef.current === channel) tripPresenceChannelRef.current = null;
          requestTripPresenceReconnect(status);
        }
      });

    return () => {
      const preserveRemotePresences = tripPresenceReconnectRef.current;
      tripPresenceDebug("cleanup start", {
        channelName,
        preserveRemotePresences,
        currentChannel: tripPresenceChannelRef.current === channel,
      });
      if (tripPresenceChannelRef.current === channel) {
        tripPresenceChannelRef.current = null;
        tripPresenceChannelKeyRef.current = "";
        tripPresenceReadyRef.current = false;
      }
      if (!preserveRemotePresences) setRemoteTripPresences([]);
      Promise.resolve(channel.untrack()).catch((error) => {
        tripPresenceDebug("track error", { message: error?.message || String(error), phase: "untrack" });
      });
      tripPresenceDebug("removeChannel reason", { channelName, reason: "effect-cleanup" });
      void supabase.removeChannel(channel);
    };
  }, [activeMembership?.status, activeTripId, activeUserId, publishTripPresence, requestTripPresenceReconnect, tripPresenceChannelVersion]);

  useEffect(() => {
    if (!activeTripId || !activeUserId || activeMembership?.status !== "approved") return;
    publishTripPresence("location-change");
  }, [activeDay, activeMembership?.status, activeSection, activeTripId, activeUserId, publishTripPresence, tripPresenceSelectedItem]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      publishTripPresence("heartbeat");
      setRemoteTripPresences((current) => {
        const now = Date.now();
        const next = current.filter((payload) => {
          const rawUpdatedAt = payload.updatedAt || "";
          const updatedAt = typeof rawUpdatedAt === "number" ? rawUpdatedAt : Date.parse(rawUpdatedAt);
          const isFresh = Number.isFinite(updatedAt) && now - updatedAt <= tripPresenceStaleMs;
          if (!isFresh) {
            tripPresenceDebug("stale filtered", {
              ageMs: Number.isFinite(updatedAt) ? now - updatedAt : null,
              payload: tripPresenceDebugPayload(payload),
            });
          }
          return isFresh;
        });
        return next.length === current.length ? current : next;
      });
    }, tripPresenceHeartbeatMs);
    return () => window.clearInterval(intervalId);
  }, [publishTripPresence]);

  useEffect(() => {
    if (!activeTripId || !activeUserId || activeMembership?.status !== "approved") return undefined;
    function recoverTripPresence(trigger) {
      const channel = tripPresenceChannelRef.current;
      const ready = tripPresenceReadyRef.current;
      const status = tripPresenceStatusRef.current;
      const needsReconnect = !channel || !ready || tripPresenceRecoverableStatuses.has(status);
      tripPresenceDebug("focus/visibility recovery", {
        hasChannel: Boolean(channel),
        needsReconnect,
        ready,
        status,
        trigger,
      });
      if (needsReconnect) {
        requestTripPresenceReconnect(trigger);
      } else {
        publishTripPresence(trigger);
      }
    }
    const handleFocus = () => recoverTripPresence("focus");
    const handleOnline = () => recoverTripPresence("online");
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") recoverTripPresence("visible");
    };
    window.addEventListener("focus", handleFocus);
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeMembership?.status, activeTripId, activeUserId, publishTripPresence, requestTripPresenceReconnect]);

  return { setTripPresenceSelectedItem, remoteTripPresenceByUser, timelineDayTabPresenceByDay, navigateToTripPresence };
}
