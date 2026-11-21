import ShareDialog from "../components/share/ShareDialog.jsx";
import {
  deleteGuide as deleteFormalGuide,
  deleteTodo as deleteFormalTodo,
  saveGuide as saveFormalGuide,
  saveTodo as saveFormalTodo,
  toggleTodo as toggleFormalTodo,
} from "../features/todo-guide/formalCommands.js";
import { ActiveEditorGuardDialog, getDirtyActiveEditorGuards, requestActiveEditorHandoff } from "./activeEditorGuard.jsx";
import { memberName } from "../lib/memberName.js";
import { dateToInputValue, todayInput } from "../lib/displayFormat.js";
import { budgetReceiptsDisabled, budgetReceiptUnavailableMessage, isBudgetReceiptTarget } from "../lib/budgetReceiptConfig.js";
import { readOfflineTrips, writeOfflineTrips, clearOfflineAccount } from "../lib/offlineCache.js";
import { submitTimelineSchedule } from "../lib/timelineScheduleService.js";
import { createRequestGuard, applyLuggageMutation, applyLuggageOrder } from "../lib/luggageSync.js";
import { notify } from "../lib/notifications.js";
import { createSyncNotifications } from "../lib/syncNotifications.js";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  reorderLuggageItems,
  privatizeLuggageItem,
  assignLuggageItem,
  mutateLuggageItem,
  luggageErrorMessage,
} from "../lib/luggageService.js";
import { timelineCardSelectionColor } from "../lib/collaboratorColors.js";
import { fetchBudgetQuote, getCachedBudgetQuote } from "../lib/tripBudgetRates.js";
import { tripPresencePageKey } from "../lib/tripPresenceDisplay.js";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { findLatestDraftTrip } from "../lib/draftAutosave.js";
import { releaseEditLock } from "../lib/editLocks.js";
import { supabase } from "../lib/supabase.js";
import { attachTimelineScheduleSortOrders, planTimelineSchedule, timelineScheduleOperationTypes } from "../lib/timelineSchedulePlanner.js";
import { isTransportationCard } from "../lib/timelineTransportationRoles.js";
import { buildTransportPairSnapshot } from "../lib/timelineTransportPairs.js";
import { deleteTripStay, saveTripStay } from "../features/stays/formalStays.js";
import { buildRoutePanelStops } from "../lib/timelineMapMarkers.js";
import { tripDays } from "../lib/timelineTime.js";
import { transportCardTitle } from "../lib/timelineTransportCategories.js";
import {
  normalizeRouteOverridePoints,
  routeOverridePointsEqual,
  routeOverrideSegmentKey,
  routeOverridesToSegmentMap,
  validRouteSegmentKeysFromItems,
} from "../lib/routeOverrides.js";
import { buildTripImportPersistencePayload, serializeTripToJson } from "../lib/tripJsonAdapters.js";
import { buildTripJsonPreview } from "../lib/tripJsonContract.js";
import { parseUnifiedTripJsonText } from "../lib/unifiedTripJsonImport.js";
import { aiItineraryBlankTemplateFileName, aiItineraryExchangeModes, buildBlankAiItineraryTemplate, serializeTripToAiItinerary } from "../lib/aiItineraryAdapters.js";
import MembersInviteDialog from "../components/members/MembersInviteDialog.jsx";
import SidebarAccountMenu from "../components/sidebar/SidebarAccountMenu.jsx";
import SidebarTripSection from "../components/sidebar/SidebarTripSection.jsx";
import { normalizeTimelineItemPayload } from "../components/timeline/timelineEditorForm.js";
import { clearTimelineDraftsForItemIds, hasTimelineDraftForTrip } from "../components/timeline/timelineDrafts.js";
import TripDialog from "../components/trip/TripDialog.jsx";
import TripImportPreviewDialog from "../components/trip-import/TripImportPreviewDialog.jsx";
import AiTripExchangeDialog from "../components/trip-import/AiTripExchangeDialog.jsx";
import { isTimedVisit, sortScheduleItems } from "../lib/timelineUntimedOrdering.js";
import { attachmentBucket, safeFileName } from "../features/attachments/attachmentFiles.js";
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
} from "../components/timeline/timelinePresence.js";
import {
  routeEditPresenceHeartbeatMs,
  routeEditPresenceStaleMs,
  routeEditNodeLockStaleMs,
  routeEditBroadcastThrottleMs,
  routeEditCollaborationDebug,
  routeEditCollaborationChannelSummary,
} from "../components/map/routeCollaboration.js";
import {
  tripPresenceHeartbeatMs,
  tripPresenceStaleMs,
  tripPresenceRecoverableStatuses,
  tripPresencePageToSection,
  tripPresenceDebug,
  tripPresenceDebugPayload,
} from "./tripPresence.js";
import { desktopNavItems, desktopNavIcons, mobileNavItems } from "./navigation.js";
import {
  defaultTransportCategory,
  sortedVisitItems,
  destinationReorderErrorMessage,
  alternativeApplyErrorMessage,
  timelineScheduleErrorMessage,
  timelineScheduleUpdatedAtBaselines,
  isEffectiveFixedVisit,
  isInvalidTimeRange,
  formatTimelineOverlapError,
  findOverlappingVisitItem,
} from "../components/timeline/timelineItemRules.js";
import { defaultPackItems } from "../features/pack/defaultPackItems.js";
import { tripTodayIndex, deriveTripStage, destinationPatchFromParts, destinationPatchFromText } from "../components/trip/tripDetails.js";
import { buildTripDateChangePreview, timelineItemIdsRemovedByShortening, timelineItemsInTripRange } from "../components/trip/tripDateChange.js";
import { inviteTokenFromUrl, clearInviteTokenFromUrl } from "./entryRoutes.js";
import { activeEditDraftEntityTypes, readSessionContext, writeSessionContext, normalizeSessionContext } from "./sessionContext.js";
import { Shell, LoginView, EmptyState } from "./WorkspaceShell.jsx";
import { TripHeader } from "../components/trip/TripHeader.jsx";
import { TripWorkspace } from "./TripWorkspace.jsx";
import { VersionInfoDialog } from "../components/VersionInfoDialog.jsx";
import { useExpenseSnapshot } from "../features/expense/useExpenseSnapshot.js";
import { useLuggageRefresh } from "../features/luggage/useLuggageRefresh.js";
import { useTripSubscription } from "./useTripSubscription.js";
import { useTripDataLoad } from "./useTripDataLoad.js";
import { useAccountSession } from "./useAccountSession.js";

export function FormalWorkspace() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [trips, setTrips] = useState([]);
  const [activeTripId, setActiveTripId] = useState(null);
  const [activeDay, setActiveDay] = useState(0);
  const [items, setItems] = useState([]);
  const [alternatives, setAlternatives] = useState([]);

  const [accommodations, setAccommodations] = useState([]);
  const [guideItems, setGuideItems] = useState([]);
  const [todoItems, setTodoItems] = useState([]);
  const [luggageItems, setLuggageItems] = useState([]);
  const [sharedLuggageItems, setSharedLuggageItems] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [routeOverrides, setRouteOverrides] = useState([]);
  const [routeOverrideSaveError, setRouteOverrideSaveError] = useState("");
  const [routeEditLocalState, setRouteEditLocalState] = useState({ isEditing: false, activeNodeId: null, activeSegmentKey: null });
  const [remoteRouteEditPresences, setRemoteRouteEditPresences] = useState([]);
  const [remoteRouteEditUpdates, setRemoteRouteEditUpdates] = useState({});
  const [remoteRouteEditNodeLocks, setRemoteRouteEditNodeLocks] = useState({});
  const [packItems, setPackItems] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const syncFeedback = useMemo(() => createSyncNotifications(notify), []);
  const [tripRealtimeAttempt, setTripRealtimeAttempt] = useState(0);
  useEffect(() => {
    syncFeedback.configure(session?.user?.id || null, activeTripId);
  }, [session?.user?.id, activeTripId, syncFeedback]);
  useEffect(() => {
    if (!session?.user) return;
    return notify.onTransportError(error => { syncFeedback.failure("action", error); });
  }, [session?.user?.id, syncFeedback]);
  useEffect(() => () => syncFeedback.dispose(), [syncFeedback]);
  const [isTripDialogOpen, setIsTripDialogOpen] = useState(false);
  const [tripCreating, setTripCreating] = useState(false);
  const tripCreationInFlight = useRef(false);
  useEffect(() => {
    if (isTripDialogOpen) {
      // An available quote can seed the trip. The budget workspace can initialize it later.
      void fetchBudgetQuote().catch(() => {});
    }
  }, [isTripDialogOpen]);
  const [tripImportState, setTripImportState] = useState(null);
  const [aiExchangeState, setAiExchangeState] = useState(null);
  const [isMembersDialogOpen, setIsMembersDialogOpen] = useState(false);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [shareLinks, setShareLinks] = useState([]);

  const [activeSection, setActiveSection] = useState("today");
  const navigationPending = useRef(false);
  async function navigateWithEditorHandoff(action) {
    if (navigationPending.current) return false;
    navigationPending.current = true;
    try {
      if (!await requestActiveEditorHandoff({ tripId: activeTripId }) || !requestGuard.sameContext(tripDataContext)) return false;
      action();
      return true;
    } finally {
      navigationPending.current = false;
    }
  }
  async function changeTripSection(section) {
    return section === activeSection || navigateWithEditorHandoff(() => setActiveSection(section));
  }
  const [luggageTab, setLuggageTab] = useState("personal");
  const routeOverrideCoordinateSnapshotRef = useRef(new Map());
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isVersionDialogOpen, setIsVersionDialogOpen] = useState(false);
  const [isSidebarTripMenuOpen, setIsSidebarTripMenuOpen] = useState(false);
  const [foreignDragPresence, setForeignDragPresence] = useState(null);
  const [foreignCardSelection, setForeignCardSelection] = useState(null);
  const [remoteTripPresences, setRemoteTripPresences] = useState([]);
  const [tripPresenceSelectedItem, setTripPresenceSelectedItem] = useState(null);
  const restoredDayRef = useRef(null);
  const tripPresenceChannelRef = useRef(null);
  const tripPresenceChannelKeyRef = useRef("");
  const tripPresenceReadyRef = useRef(false);
  const tripPresenceStatusRef = useRef("idle");
  const tripPresencePayloadRef = useRef(null);
  const tripPresenceReconnectRef = useRef(false);
  const timelineDragPresenceChannelRef = useRef(null);
  const timelineDragPresenceReadyRef = useRef(false);
  const timelineDragPresenceStatusRef = useRef("idle");
  const timelineDragPresenceReconnectRef = useRef(false);
  const itemsRef = useRef([]);
  const localCardSelectionRef = useRef(null);
  const localDragPresenceRef = useRef(null);
  const localDragStartedAtRef = useRef(null);
  const timelineDragPresenceSessionIdRef = useRef(
    `timeline-drag-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
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
  const [tripForm, setTripForm] = useState({
    title: "京都五日散策",
    destination_country: "日本",
    destination_city: "京都",
    start_date: todayInput(),
    end_date: todayInput(2),
  });
  const [tripPresenceChannelVersion, setTripPresenceChannelVersion] = useState(0);
  const [timelineDragPresenceChannelVersion, setTimelineDragPresenceChannelVersion] = useState(0);
  const [routeEditChannelVersion, setRouteEditChannelVersion] = useState(0);
  const [routeEditChannelReady, setRouteEditChannelReady] = useState(false);
  const [routeEditRecoveryGeneration, setRouteEditRecoveryGeneration] = useState(0);

  const activeTrip = useMemo(
    () => trips.find((trip) => trip.id === activeTripId) || null,
    [activeTripId, trips],
  );
  const accountRef = useRef({ userId: null, generation: 0 });
  const requestGuard = useRef(createRequestGuard()).current;
  requestGuard.setContext(session?.user?.id && activeTripId ? JSON.stringify([session.user.id, activeTripId]) : null);
  const tripDataContext = requestGuard.context();
  const tripReadAccessRef = useRef(null);
  const membershipStatus = activeTrip?.membership?.status;
  if (tripReadAccessRef.current?.key !== tripDataContext.key || tripReadAccessRef.current?.status !== membershipStatus) tripReadAccessRef.current = { key: tripDataContext.key, status: membershipStatus };
  const canReadTrip = key => Boolean(key && tripReadAccessRef.current?.key === key && tripReadAccessRef.current?.status === "approved");
  const {
    budgetSnapshot,
    budgetItems,
    budgetParticipants,
    actualExpenses,
    actualParticipants,
    itineraryBudgetLinks,
    budgetsByItem,
    budgetSnapshotRef,
    applyBudgetSnapshot,
    budgetRefreshRef,
    refreshBudget,
  } = useExpenseSnapshot({
    setTrips,
    syncFeedback,
    requestGuard,
    tripDataContext,
    tripReadAccessRef,
    canReadTrip,
  });

  const { sharedSnapshotRef, updateSharedCache, luggageRefreshRef, refreshLuggage } = useLuggageRefresh({
    setLuggageItems,
    setSharedLuggageItems,
    syncFeedback,
    requestGuard,
    tripReadAccessRef,
    canReadTrip,
  });

  const activeMembership = activeTrip?.membership;
  const isOwner = activeMembership?.role === "owner" && activeMembership?.status === "approved";
  const canEdit =
    activeMembership?.status === "approved" &&
    (activeMembership?.role === "owner" || activeMembership?.role === "editor");
  const activeTripStage = deriveTripStage(activeTrip?.start_date, activeTrip?.end_date);
  const isTripFinalizedStatus = activeTrip?.status === "settled";
  const isTripInSettlementPhase = activeTripStage === "settled";
  const isTripDateLocked = isTripFinalizedStatus || isTripInSettlementPhase;
  const canEditActiveTripContent = canEdit && !isTripDateLocked;
  const canManageActiveTrip = isOwner && !isTripDateLocked;
  const canChangeTripDates = isOwner && !isTripDateLocked;
  const canInviteMembers = isOwner && !isTripDateLocked;
  const canOpenMembersDialog = activeMembership?.status === "approved";
  const activeUserId = session?.user?.id || null;
  const userEmail = session?.user?.email || "";
  const userDisplayName = session?.user?.user_metadata?.full_name || userEmail;
  const userInitial = (userDisplayName.trim()[0] || "?").toUpperCase();
  const currentTripMember = useMemo(
    () => members.find((member) => member.user_id === activeUserId) || null,
    [activeUserId, members],
  );
  const timelineDragPresenceUserName = currentTripMember ? memberName(currentTripMember) : userDisplayName || userEmail || "?";
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
  const canOpenShareDialog = isOwner || (activeMembership?.status === "approved" && activeMembership?.role === "editor");
  const canManageShareLinks = isOwner;
  const canRenameActiveTrip = (canEdit || activeTrip?.owner_id === session?.user?.id) && !isTripDateLocked;
  const isPending = activeMembership?.status === "pending";
  useEffect(() => {
    if (!isPending || !activeTripId || !session?.user?.id) return;
    const id = `trip-membership-pending:${session.user.id}:${activeTripId}`;
    notify.info("你已送出加入申請，旅程擁有者核准後即可共同編輯。", { id });
    return () => notify.dismiss(id);
  }, [isPending, activeTripId, session?.user?.id]);
  const pendingMemberCount = isOwner ? members.filter((member) => member.status === "pending").length : 0;
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
    setIsAccountMenuOpen(false);
    setIsSidebarTripMenuOpen(false);
  }, [activeSection, activeTripId, isSidebarCollapsed]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

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

  const days = useMemo(() => tripDays(activeTrip), [activeTrip]);
  const todayDayIndex = useMemo(() => tripTodayIndex(activeTrip), [activeTrip]);

  const dayItems = useMemo(
    () => sortScheduleItems(items.filter((item) => item.day_index === activeDay)),
    [activeDay, items],
  );
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

  const todayItems = useMemo(
    () => sortScheduleItems(items.filter((item) => item.day_index === todayDayIndex)),
    [items, todayDayIndex],
  );
  const tripDateChangePreviewData = useMemo(
    () => ({ accommodations, alternatives, itineraryBudgetLinks, items, todoItems }),
    [accommodations, alternatives, itineraryBudgetLinks, items, todoItems],
  );

  const loadTrips = useCallback(
    async (preferredTripId = activeTripId) => {
      if (!session?.user || accountRef.current.userId !== session.user.id) return;
      const account = { ...accountRef.current };
      const feedbackCheckpoint = syncFeedback.checkpoint();
      const listToken = requestGuard.begin("trips");
      const canRestoreSessionContext = !preferredTripId || preferredTripId === activeTripId;
      setLoading(true);
      const { data, error } = await supabase
        .from("trip_members")
        .select(
          "role,status,trip_id,trips(id,title,name,status,destination,destination_country,destination_city,start_date,end_date,owner_id,updated_at,budget_exchange_rates)",
        )
        .eq("user_id", session.user.id);

      if (account.userId !== accountRef.current.userId || account.generation !== accountRef.current.generation || !requestGuard.valid(listToken)) return;
      if (error) {
        const cachedTrips = readOfflineTrips(session.user.id);
        if (cachedTrips?.trips?.length) {
          setTrips(cachedTrips.trips);
          const savedContext = canRestoreSessionContext ? readSessionContext(session.user.id) : null;
          const savedTrip = savedContext
            ? cachedTrips.trips.find((trip) => trip.id === savedContext.activeTripId) || null
            : null;
          const latestEditDraft = findLatestDraftTrip({
            entityTypes: activeEditDraftEntityTypes,
            userId: session.user.id,
          });
          const nextActive =
            savedTrip?.id ||
            cachedTrips.trips.find((trip) => trip.id === preferredTripId)?.id ||
            cachedTrips.trips.find((trip) => trip.id === latestEditDraft?.tripId)?.id ||
            cachedTrips.activeTripId ||
            cachedTrips.trips[0]?.id ||
            null;
          if (savedTrip?.id === nextActive) {
            const normalizedContext = normalizeSessionContext(savedContext, savedTrip);
            if (normalizedContext?.activeSection) setActiveSection(normalizedContext.activeSection);
            if (normalizedContext?.luggageTab) setLuggageTab(normalizedContext.luggageTab);
            if (normalizedContext?.activeDay !== null) {
              restoredDayRef.current = { activeDay: normalizedContext.activeDay, tripId: nextActive };
              setActiveDay(normalizedContext.activeDay);
            }
          }
          setActiveTripId(nextActive);
          syncFeedback.failure("trips", error, { cached: true });
          setLoading(false);
          return;
        }
        syncFeedback.failure("trips", error);
        setLoading(false);
        return;
      }

      const nextTrips = (data || [])
        .filter((row) => row.trips)
        .map((row) => ({
          ...row.trips,
          title: row.trips.title || row.trips.name,
          name: row.trips.name || row.trips.title,
          membership: {
            role: row.role,
            status: row.status,
          },
        }))
        .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));

      setTrips(nextTrips);
      syncFeedback.verified(nextTrips.length ? "trips" : ["trips", "connection", "action"], feedbackCheckpoint);
      const savedContext = canRestoreSessionContext ? readSessionContext(session.user.id) : null;
      const savedTrip = savedContext ? nextTrips.find((trip) => trip.id === savedContext.activeTripId) || null : null;
      const latestEditDraft = findLatestDraftTrip({
        entityTypes: activeEditDraftEntityTypes,
        userId: session.user.id,
      });
      const nextActive =
        savedTrip?.id ||
        nextTrips.find((trip) => trip.id === preferredTripId)?.id ||
        nextTrips.find((trip) => trip.id === latestEditDraft?.tripId)?.id ||
        nextTrips[0]?.id ||
        null;
      if (savedTrip?.id === nextActive) {
        const normalizedContext = normalizeSessionContext(savedContext, savedTrip);
        if (normalizedContext?.activeSection) setActiveSection(normalizedContext.activeSection);
        if (normalizedContext?.luggageTab) setLuggageTab(normalizedContext.luggageTab);
        if (normalizedContext?.activeDay !== null) {
          restoredDayRef.current = { activeDay: normalizedContext.activeDay, tripId: nextActive };
          setActiveDay(normalizedContext.activeDay);
        }
      }
      setActiveTripId(nextActive);
      writeOfflineTrips(session.user.id, { trips: nextTrips, activeTripId: nextActive });
      setLoading(false);
    },
    [activeTripId, session?.user],
  );

  const { loadTripData } = useTripDataLoad({
    setItems,
    setAlternatives,
    setAccommodations,
    setGuideItems,
    setTodoItems,
    setLuggageItems,
    setSharedLuggageItems,
    setAttachments,
    setRouteOverrides,
    setPackItems,
    setMembers,
    syncFeedback,
    routeOverrideCoordinateSnapshotRef,
    accountRef,
    requestGuard,
    tripDataContext,
    tripReadAccessRef,
    canReadTrip,
    budgetSnapshotRef,
    applyBudgetSnapshot,
    budgetRefreshRef,
    sharedSnapshotRef,
    activeMembership,
  });

  useEffect(() => {
    if (!session?.user) return;
    const retry = async ({ manual = false } = {}) => {
      const pending = syncFeedback.pending();
      if (!pending.length || navigator.onLine === false) { syncFeedback.online({ offlineRetry: manual }); return; }
      const reconnect = manual && activeTripId && pending.includes("realtime");
      if (reconnect) {
        syncFeedback.failure("realtime", "正在重新連線，請稍候。");
        setTripRealtimeAttempt(attempt => attempt + 1);
      }
      const work = [];
      if (pending.includes("trips")) work.push(loadTrips(activeTripId));
      if (pending.some(source => ["connection", "action", "trip-data"].includes(source))) {
        if (activeTripId) work.push(loadTripData(activeTripId));
        else if (!pending.includes("trips")) work.push(loadTrips());
      } else {
        if (pending.includes("budget") || !reconnect && pending.includes("realtime")) budgetRefreshRef.current.schedule();
        const scopes = ["personal", "shared"].filter(scope => pending.includes(`luggage:${scope}`) || !reconnect && pending.includes("realtime"));
        if (scopes.length) luggageRefreshRef.current.schedule(scopes);
      }
      await Promise.allSettled(work);
      syncFeedback.online();
    };
    const offline = () => syncFeedback.failure("connection", "offline");
    const foreground = () => { if (document.visibilityState !== "hidden") void retry(); };
    syncFeedback.setRetry(() => retry({ manual: true }));
    window.addEventListener("offline", offline); window.addEventListener("online", foreground); window.addEventListener("focus", foreground);
    if (navigator.onLine === false) offline();
    return () => { window.removeEventListener("offline", offline); window.removeEventListener("online", foreground); window.removeEventListener("focus", foreground); };
  }, [session?.user?.id, activeTripId, loadTrips, loadTripData, syncFeedback]);

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

  const loadShareLinks = useCallback(async (tripId) => {
    if (!tripId) {
      setShareLinks([]);
      return;
    }

    const { data, error } = await supabase
      .from("share_links")
      .select("*")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false });

    if (!error) setShareLinks(data || []);
  }, []);

  useAccountSession({
    setSession,
    setAuthReady,
    setTrips,
    setActiveTripId,
    accountRef,
    requestGuard,
    budgetRefreshRef,
    luggageRefreshRef,
    loadTripData,
  });

  useEffect(() => {
    if (session?.user) loadTrips();
  }, [loadTrips, session?.user]);

  useEffect(() => {
    if (!session?.user) return;
    const token = inviteTokenFromUrl();
    if (!token) return;

    async function joinInvite() {
      const user = session.user;
      const { data: tripId, error } = await supabase.rpc("request_trip_membership", {
        invite_token: token,
        member_display_name: user.user_metadata?.full_name || user.email,
        member_email: user.email,
      });

      if (error || !tripId) {
        notify.error(error?.message || "邀請連結無效或已失效。");
        clearInviteTokenFromUrl();
        return;
      }

      await loadTrips(tripId);
      clearInviteTokenFromUrl();
    }

    joinInvite();
  }, [loadTrips, session]);

  useEffect(() => {
    const restoredDay = restoredDayRef.current;
    if (restoredDay?.tripId === activeTripId) {
      setActiveDay(restoredDay.activeDay);
      restoredDayRef.current = null;
    } else {
      setActiveDay(todayDayIndex);
    }
    loadTripData(activeTripId);
  }, [activeTripId, loadTripData, todayDayIndex]);

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

  useEffect(() => {
    if (!session?.user || !activeTripId) return;
    writeSessionContext(session.user.id, {
      activeDay,
      activeSection,
      activeTripId,
      luggageTab,
    });
  }, [activeDay, activeSection, activeTripId, luggageTab, session?.user]);

  useEffect(() => {
    if (activeTripId && canOpenShareDialog) {
      loadShareLinks(activeTripId);
    } else {
      setShareLinks([]);
    }
  }, [activeTripId, canOpenShareDialog, loadShareLinks]);

  useTripSubscription({
    session,
    activeTripId,
    activeDay,
    syncFeedback,
    tripRealtimeAttempt,
    requestGuard,
    tripDataContext,
    budgetRefreshRef,
    luggageRefreshRef,
    loadTrips,
    loadTripData,
    loadRouteOverrides,
  });

  useEffect(() => {
    if (!session?.user || !activeTripId || activeSection !== "luggage") return;
    const refresh = () => { if (document.visibilityState !== "hidden") luggageRefreshRef.current.schedule(["personal", "shared"]); };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [session?.user?.id, activeTripId, activeSection]);

  useEffect(() => {
    if (!session?.user || !activeTripId || !["budget", "settlement"].includes(activeSection)) return;
    const context = tripDataContext;
    const refresh = () => { if (document.visibilityState !== "hidden" && requestGuard.sameContext(context)) budgetRefreshRef.current.schedule(); };
    refresh();
    window.addEventListener("focus", refresh); window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [session?.user?.id, activeTripId, activeSection, tripDataContext.generation]);

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

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      // Using `origin` avoids accumulating query params (e.g. invite tokens) and
      // prevents redirect loops when using custom domains + OAuth allowlists.
      options: { redirectTo: window.location.origin },
    });
    if (error) notify.error(error.message);
  }

  async function signOut() {
    clearOfflineAccount(session?.user?.id);
    const { error } = await supabase.auth.signOut();
    if (error) notify.error(error.message);
  }

  async function createTrip(event) {
    event.preventDefault();
    if (tripCreationInFlight.current) return;
    tripCreationInFlight.current = true;
    setTripCreating(true);
    const account = accountRef.current;
    const isCurrent = () => accountRef.current === account && requestGuard.sameContext(tripDataContext);
    try {
      if (!await requestActiveEditorHandoff({ tripId: activeTripId }) || !isCurrent()) return;
      const user = session.user;
      const safeEndDate =
        tripForm.end_date < tripForm.start_date ? tripForm.start_date : tripForm.end_date;
      const tripId = crypto.randomUUID();
      const destinationPatch = destinationPatchFromParts(
        tripForm.destination_country,
        tripForm.destination_city,
      );
      const initialRates = getCachedBudgetQuote();
      const { error: tripError } = await supabase.from("trips").insert({
        id: tripId,
        title: tripForm.title.trim(),
        name: tripForm.title.trim(),
        ...destinationPatch,
        start_date: tripForm.start_date,
        end_date: safeEndDate,
        status: "planning",
        owner_id: user.id,
        ...(initialRates ? { budget_exchange_rates: initialRates } : {}),
      });

      if (tripError) {
        if (isCurrent()) notify.error(tripError.message);
        return;
      }

      const { error: memberError } = await supabase.from("trip_members").insert({
        trip_id: tripId,
        user_id: user.id,
        role: "owner",
        status: "approved",
        display_name: user.user_metadata?.full_name || user.email,
        email: user.email,
      });

      if (memberError) {
        if (isCurrent()) notify.error(memberError.message);
        return;
      }

      const packRows = defaultPackItems.map((title) => ({ trip_id: tripId, title }));
      await supabase.from("pack_items").insert(packRows);
      if (!isCurrent()) return;

      setIsTripDialogOpen(false);
      setTripForm({
        title: "京都五日散策",
        destination_country: "日本",
        destination_city: "京都",
        start_date: todayInput(),
        end_date: todayInput(2),
      });
      await loadTrips(tripId);
    } finally {
      tripCreationInFlight.current = false;
      setTripCreating(false);
    }
  }

  async function previewTripImport(file) {
    if (!file) return;
    let text;
    try {
      text = await file.text();
    } catch {
      const preview = buildTripJsonPreview(null, {
        errors: [{
          code: "file_read_failed",
          message: "無法讀取這個 JSON 檔案，請確認檔案後再試一次。",
          path: "$",
        }],
        fileName: file.name,
      });
      setIsTripDialogOpen(false);
      setAiExchangeState(null);
      setTripImportState({ busy: false, document: null, error: "", preview });
      return;
    }
    const parsed = parseUnifiedTripJsonText(text);
    const preview = {
      ...buildTripJsonPreview(parsed.document, {
        errors: parsed.errors || [],
        fileName: file.name,
        migrations: parsed.migrations || [],
        warnings: parsed.warnings || [],
      }),
      sourceDocumentType: parsed.sourceDocumentType,
    };
    setIsTripDialogOpen(false);
    setAiExchangeState(null);
    setTripImportState({ busy: false, document: parsed.document || null, error: "", preview });
  }

  async function confirmTripImport() {
    if (!tripImportState?.document || tripImportState.preview?.errors?.length || tripImportState.busy) return;
    const persistence = buildTripImportPersistencePayload(tripImportState.document);
    if (!persistence.ok || !persistence.payload) {
      setTripImportState((current) => ({
        ...current,
        error: persistence.errors?.[0]?.message || "無法建立匯入資料，請重新檢查 JSON 檔案。",
      }));
      return;
    }
    setTripImportState((current) => ({ ...current, busy: true, error: "" }));
    const { data, error } = await supabase.rpc("import_trip_timeline_v1", { payload: persistence.payload });
    if (error || !data?.trip_id) {
      setTripImportState((current) => ({
        ...current,
        busy: false,
        error: error?.message || "匯入沒有回傳新旅程 ID，資料未建立。",
      }));
      return;
    }
    const importedTitle = tripImportState.document.trip.title;
    setTripImportState(null);
    setActiveDay(0);
    notify.success(`已匯入「${importedTitle}」。`);
    await loadTrips(data.trip_id);
  }

  async function updateTrip(patch) {
    if (!activeTrip || !canRenameActiveTrip) return { ok: false };
    const nextPatch = { ...patch };
    const hasStartDatePatch = Object.prototype.hasOwnProperty.call(nextPatch, "start_date");
    const hasEndDatePatch = Object.prototype.hasOwnProperty.call(nextPatch, "end_date");
    if (hasStartDatePatch || hasEndDatePatch) {
      const nextStartDate = hasStartDatePatch ? nextPatch.start_date : activeTrip.start_date;
      const nextEndDate = hasEndDatePatch ? nextPatch.end_date : activeTrip.end_date;
      return updateTripDateRange({ endDate: nextEndDate, startDate: nextStartDate });
    }
    if (Object.prototype.hasOwnProperty.call(nextPatch, "title")) {
      nextPatch.name = nextPatch.title;
    }
    if (
      Object.prototype.hasOwnProperty.call(nextPatch, "destination") &&
      !Object.prototype.hasOwnProperty.call(nextPatch, "destination_country") &&
      !Object.prototype.hasOwnProperty.call(nextPatch, "destination_city")
    ) {
      Object.assign(nextPatch, destinationPatchFromText(nextPatch.destination));
    }
    const { error } = await supabase.from("trips").update(nextPatch).eq("id", activeTrip.id);
    if (error) {
      notify.error(error.message);
      return { ok: false, error };
    }
    await loadTrips(activeTrip.id);
    return { ok: true };
  }

  async function updateTripDateRange({
    allowSettlementOverride = false,
    confirmTimelineRemoval = false,
    source = "trip-date-popover",
    startDate,
    endDate,
  }) {
    const canOverrideSettlementLock = allowSettlementOverride === true && source === "developer-date-tool";
    if (!activeTrip || !isOwner) {
      const message = "You do not have permission to change trip dates.";
      notify.error(message);
      return { ok: false, permissionDenied: true, message };
    }
    if (isTripDateLocked && !canOverrideSettlementLock) {
      const message = "旅程已進入結算階段，無法修改日期。";
      notify.error(message);
      return { ok: false, dateLocked: true, message };
    }
    if (!startDate || !endDate || endDate < startDate) {
      notify.error("Invalid trip date range");
      return { ok: false };
    }
    if (getDirtyActiveEditorGuards({ tripId: activeTrip.id, workspace: "timeline" }).length) {
      const message = "目前有未儲存的編輯內容，請先儲存或放棄後再修改旅程日期。";
      notify.error(message);
      return { ok: false, dirtyDraft: true, message };
    }
    const draftScope = { tripId: activeTrip.id, userId: session?.user?.id };
    if (hasTimelineDraftForTrip(draftScope)) {
      const message = "目前有未儲存的編輯內容，請先儲存或放棄後再修改旅程日期。";
      notify.error(message);
      return { ok: false, dirtyDraft: true, message };
    }
    const preview = buildTripDateChangePreview({
      ...tripDateChangePreviewData,
      newEndDate: endDate,
      newStartDate: startDate,
      trip: activeTrip,
    });
    if (preview.hasTimelineRemoval && !confirmTimelineRemoval) {
      notify.error("This date change would remove Timeline data. Please handle it in the shortening cleanup flow.");
      return { ok: false, unsafeShortening: true };
    }
    const removedTimelineDraftIds =
      preview.hasTimelineRemoval && confirmTimelineRemoval
        ? timelineItemIdsRemovedByShortening(items, preview.newDayCount)
        : new Set();
    const { data, error } = await supabase.rpc("apply_trip_date_change", {
      confirm_timeline_removal: Boolean(confirmTimelineRemoval),
      trip_id: activeTrip.id,
      new_start_date: startDate,
      new_end_date: endDate,
    });
    if (error || data?.ok !== true) {
      if (error) notify.error(error.message);
      return { ok: false, error };
    }
    if (removedTimelineDraftIds.size) {
      clearTimelineDraftsForItemIds({ ...draftScope, itemIds: removedTimelineDraftIds });
    }
    setActiveDay((current) => Math.min(current, Math.max((preview.newDayCount || 1) - 1, 0)));
    await Promise.all([loadTrips(activeTrip.id), loadTripData(activeTrip.id)]);
    return { ok: true, data };
  }

  async function deleteTrip() {
    if (!activeTrip || !canManageActiveTrip) return;
    const ok = window.confirm(`刪除「${activeTrip.title}」？`);
    if (!ok) return;
    const { data, error } = await supabase.rpc("delete_trip_with_expenses", { p_trip_id: activeTrip.id });
    if (error || data !== activeTrip.id) notify.error(
      error?.code === "55P03" ? "此旅程有資料正在儲存，請稍後再試。"
        : error?.code === "42501" ? "無法刪除這個旅程，請確認擁有者權限。"
          : error?.code === "PGRST202" ? "旅程刪除功能正在更新，請稍後再試。"
            : error?.message || "無法確認旅程已刪除，請重新整理。",
    );
    else await loadTrips();
  }

  function rejectCrossTripSave() {
    notify.warning("偵測到跨旅程編輯狀態，已阻止儲存。請回到原旅程或重新開啟編輯器。");
    return { ok: false, crossTrip: true };
  }

  function isCurrentTripContext(meta = {}) {
    return !meta.tripId || meta.tripId === activeTrip?.id;
  }

  async function ensureItineraryItemEditable(itemId) {
    const localItem = items.find((item) => item.id === itemId);
    if (localItem && isTransportationCard(localItem)) return true;
    if (localItem?.is_fixed) {
      notify.warning("此行程已固定，請先解鎖後再修改。");
      return false;
    }
    const { data, error } = await supabase
      .from("itinerary_items")
      .select("is_fixed")
      .eq("id", itemId)
      .eq("trip_id", activeTrip.id)
      .maybeSingle();
    if (error) {
      notify.error(error.message);
      return false;
    }
    if (data?.is_fixed) {
      notify.warning("此行程已固定，請先解鎖後再修改。");
      return false;
    }
    return true;
  }

  async function updateWithConflictCheck(table, payload, editingId, meta = {}) {
    let query = supabase.from(table).update(payload).eq("id", editingId);
    if (meta.tripId) query = query.eq("trip_id", meta.tripId);
    if (meta.baseUpdatedAt) query = query.eq("updated_at", meta.baseUpdatedAt);
    const result = await query.select("id, updated_at").maybeSingle();
    if (result.error) return { ok: false, error: result.error };
    if (!result.data) return { ok: false, conflict: true };
    if (!meta.deferEditLockRelease) {
      await releaseEditLock({ recordId: editingId, supabase, table, userId: session?.user?.id });
    }
    return { ok: true, data: result.data };
  }

  async function applyTimelineScheduleOperation({
    inlineFeedback = false,
    confirmedMajorEffect = null,
    dayIndex = activeDay,
    expectedVisitIds = null,
    itemUpdatedAtBaselines = null,
    operation,
    packageSourceItemIds = null,
    plan,
    slotItemIds = null,
    targetItemId = null,
    targetPayload = null,
  }) {
    if (!activeTrip || !plan?.ok || !operation || !itemUpdatedAtBaselines) return { ok: false };
    const sourceItems = items.filter((item) => Number(item.day_index) === Number(dayIndex));
    const result = await submitTimelineSchedule(supabase, {
      confirmedMajorEffect,
      expectedVisitIds: expectedVisitIds || sortedVisitItems(sourceItems).map((item) => item.id),
      itemUpdatedAtBaselines,
      operation,
      packageSourceItemIds,
      plan,
      slotItemIds,
      dayIndex,
      targetItemId,
      targetPayload,
      tripId: activeTrip.id,
    }, () => requestGuard.sameContext(tripDataContext));
    if (result.blocked) return { ok: false, errorMessage: result.blocked };
    const responseStatus = result.data?.status || null;
    if (result.error || responseStatus === "repreview_required") {
      const message = String(result.error?.message || responseStatus || "");
      const conflict = /stale_|repreview_required|transport_state_changed/.test(message);
      const errorMessage = conflict
        ? "此日行程已由其他成員更新，請重新載入最新資料後再試。"
        : destinationReorderErrorMessage(result.error || { message });
      if (!inlineFeedback) notify.error(errorMessage);
      if (conflict) await loadTripData(activeTrip.id);
      return { conflict, error: result.error, errorMessage, ok: false, preview: result.data?.preview || null };
    }
    await loadTripData(activeTrip.id);
    return { data: result.data, ok: true };
  }

  async function saveItem(payload, editingId, meta = {}) {
    if (!activeTrip || !canEditActiveTripContent) return;
    if (!isCurrentTripContext(meta)) return rejectCrossTripSave();
    const editingItem = editingId ? items.find((item) => item.id === editingId) : null;
    if (isEffectiveFixedVisit(editingItem)) {
      notify.warning("此行程已固定，請先解鎖後再修改。");
      return { ok: false, fixed: true };
    }
    if (editingId && !(await ensureItineraryItemEditable(editingId))) return { ok: false, fixed: true };
    if (payload?.item_type !== "transport" && Boolean(payload?.start_time) !== Boolean(payload?.end_time)) {
      const errorMessage = "開始與結束時間必須同時設定，或同時清除。";
      notify.error(errorMessage);
      return { ok: false, errorMessage };
    }
    const normalizedPayload = normalizeTimelineItemPayload(payload, defaultTransportCategory);
    if (
      isTransportationCard(normalizedPayload) &&
      (!normalizedPayload.from_item_id || !normalizedPayload.to_item_id)
    ) {
      notify.error("交通卡必須連接兩張相鄰行程。");
      return { ok: false };
    }
    const invalidTimeRange = !isTransportationCard(normalizedPayload) && isInvalidTimeRange(normalizedPayload.start_time, normalizedPayload.end_time);
    if (invalidTimeRange) {
      notify.error("結束時間必須晚於開始時間。");
      return { ok: false };
    }
    const overlapItem = findOverlappingVisitItem({
      dayIndex: activeDay,
      editingId,
      items,
      payload: normalizedPayload,
    });
    if (overlapItem && !editingId) {
      const overlapError = formatTimelineOverlapError(overlapItem);
      return { ok: false, overlapError };
    }
    const timelineSchedulePlan = meta.timelineSchedulePlan?.ok ? meta.timelineSchedulePlan : null;
    const timelineScheduleOperation = meta.timelineScheduleOperation || null;
    const timelineScheduleTargetId = meta.timelineScheduleTargetId || editingId;
    if (timelineScheduleTargetId && timelineSchedulePlan && timelineScheduleOperation) {
      const result = await applyTimelineScheduleOperation({
        inlineFeedback: true,
        confirmedMajorEffect: meta.confirmedScheduleEffect || null,
        expectedVisitIds: meta.timelineScheduleExpectedVisitIds,
        itemUpdatedAtBaselines: meta.timelineScheduleItemBaselines,
        operation: timelineScheduleOperation,
        plan: timelineSchedulePlan,
        targetItemId: timelineScheduleTargetId,
        targetPayload: normalizedPayload,
      });
      if (!result.ok) return result;
      await releaseEditLock({
        recordId: timelineScheduleTargetId,
        supabase,
        table: "itinerary_items",
        userId: session?.user?.id,
      });
      return {
        data: (result.data?.items || []).find((item) => item.id === timelineScheduleTargetId) || result.data,
        ok: true,
      };
    }
    if (editingId) {
      const result = await updateWithConflictCheck("itinerary_items", normalizedPayload, editingId, meta);
      if (result.error) notify.error(result.error.message);
      else if (result.conflict) notify.warning("此資料在你編輯期間已被其他人更新。");
      else await loadTripData(activeTrip.id);
      return result;
    }

    const sortOrder = (dayItems.filter((item) => !isTransportationCard(item)).length + 1) * 10;
    const insertResult = await supabase
      .from("itinerary_items")
      .insert({
        ...normalizedPayload,
        trip_id: activeTrip.id,
        day_index: activeDay,
        date: days[activeDay] ? dateToInputValue(days[activeDay]) : null,
        sort_order: sortOrder,
      })
      .select("*")
      .single();
    if (insertResult.error) {
      notify.error(insertResult.error.message);
      return { ok: false, error: insertResult.error };
    }
    await loadTripData(activeTrip.id);
    return { ok: true, data: insertResult.data };
  }
  async function saveAlternative(itemId, payload, editingId) {
    if (!activeTrip || !canEditActiveTripContent) return { ok: false };
    const item = items.find((currentItem) => currentItem.id === itemId);
    if (isEffectiveFixedVisit(item)) {
      notify.warning("此行程已固定，請先解鎖後再修改。");
      return { ok: false, error: { message: "此行程已固定，請先解鎖後再修改。" } };
    }
    if (!(await ensureItineraryItemEditable(itemId))) {
      return { ok: false, error: { message: "此行程已固定，請先解鎖後再修改。" } };
    }
    const nextPayload = {
      title: payload.title.trim(),
      type: payload.type || "attraction",
      start_time: payload.start_time || null,
      end_time: payload.end_time || null,
      cost: Number(payload.cost || 0),
      location_name: payload.location_name.trim() || null,
      address: payload.address.trim() || null,
      map_url: payload.map_url.trim() || null,
      latitude: payload.latitude ?? null,
      longitude: payload.longitude ?? null,
      description: payload.description.trim() || null,
      transportation_note: payload.transportation_note.trim() || null,
    };

    if (editingId) {
      const { error } = await supabase.from("itinerary_alternatives").update(nextPayload).eq("id", editingId);
      if (error) notify.error(error.message);
      else await loadTripData(activeTrip.id);
      return { ok: !error, error };
    }

    const { error } = await supabase.from("itinerary_alternatives").insert({
      ...nextPayload,
      itinerary_item_id: itemId,
    });
    if (error) notify.error(error.message);
    else await loadTripData(activeTrip.id);
    return { ok: !error, error };
  }

  async function deleteAlternative(alternativeId) {
    if (!activeTrip || !canEditActiveTripContent) return { ok: false };
    const alternative = alternatives.find((item) => item.id === alternativeId);
    const parentItem = alternative ? items.find((item) => item.id === alternative.itinerary_item_id) : null;
    if (isEffectiveFixedVisit(parentItem)) {
      notify.warning("此行程已固定，請先解鎖後再修改。");
      return { ok: false, error: { message: "此行程已固定，請先解鎖後再修改。" } };
    }
    if (parentItem && !(await ensureItineraryItemEditable(parentItem.id))) {
      return { ok: false, error: { message: "此行程已固定，請先解鎖後再修改。" } };
    }
    const { error } = await supabase.from("itinerary_alternatives").delete().eq("id", alternativeId);
    if (error) notify.error(error.message);
    else await loadTripData(activeTrip.id);
    return { ok: !error, error };
  }

  async function applyAlternative(item, alternative) {
    if (!activeTrip || !canEditActiveTripContent) return { ok: false };
    if (isEffectiveFixedVisit(item)) {
      notify.warning("此行程已固定，請先解鎖後再修改。");
      return { ok: false, error: { message: "此行程已固定，請先解鎖後再修改。" } };
    }
    const result = await supabase.rpc("apply_itinerary_alternative", {
      alternative_updated_at_baseline: alternative.updated_at,
      item_updated_at_baseline: item.updated_at,
      target_alternative_id: alternative.id,
      target_item_id: item.id,
    });
    if (result.error || !result.data?.ok) {
      const error = result.error || { message: "invalid_result" };
      const conflict = /stale_|item_not_found|alternative_not_found/.test(String(error.message || ""));
      const errorMessage = alternativeApplyErrorMessage(error);
      notify.error(errorMessage);
      if (conflict) await loadTripData(activeTrip.id);
      return { conflict, error, errorMessage, ok: false };
    }
    await loadTripData(activeTrip.id);
    return { data: result.data, ok: true };
  }

  async function saveAccommodation(payload, editingId, meta = {}) {
    if (!activeTrip || !canEditActiveTripContent) return;
    if (!isCurrentTripContext(meta)) return rejectCrossTripSave();
    const result = await saveTripStay({
      client: supabase, trip: activeTrip, payload, editingId, meta, updateWithConflictCheck,
    });
    if (result.error) notify.error(result.error.message);
    else if (result.conflict) notify.warning("此資料在你編輯期間已被其他人更新。");
    else await loadTripData(activeTrip.id);
    return result.conflict ? { ok: false, conflict: true } : { ok: !result.error, error: result.error };
  }

  async function deleteAccommodation(accommodationId) {
    if (!activeTrip || !canEditActiveTripContent) return;
    const { error } = await deleteTripStay(supabase, accommodationId);
    if (error) notify.error(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function saveGuide(payload, editingId, meta = {}) {
    if (!activeTrip || !canEditActiveTripContent) return;
    if (!isCurrentTripContext(meta)) return rejectCrossTripSave();
    const result = await saveFormalGuide({
      client: supabase,
      tripId: activeTrip.id,
      payload,
      editingId,
      meta,
      updateWithConflictCheck,
    });
    if (result.error) notify.error(result.error.message);
    else if (result.conflict) notify.warning("此資料在你編輯期間已被其他人更新。");
    else await loadTripData(activeTrip.id);
    return result.conflict ? { ok: false, conflict: true } : { ok: !result.error, error: result.error };
  }

  async function deleteGuide(guideId) {
    if (!activeTrip || !canEditActiveTripContent) return;
    const { error } = await deleteFormalGuide({ client: supabase, guideId });
    if (error) notify.error(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function saveTodo(payload, editingId, meta = {}) {
    if (!activeTrip || !canEditActiveTripContent) return;
    if (!isCurrentTripContext(meta)) return rejectCrossTripSave();
    const result = await saveFormalTodo({
      client: supabase,
      tripId: activeTrip.id,
      payload,
      editingId,
      meta,
      updateWithConflictCheck,
    });
    if (result.error) notify.error(result.error.message);
    else if (result.conflict) notify.warning("此資料在你編輯期間已被其他人更新。");
    else await loadTripData(activeTrip.id);
    return result.conflict ? { ok: false, conflict: true } : { ok: !result.error, error: result.error };
  }

  async function toggleTodo(todo) {
    if (!canEditActiveTripContent) return;
    const { error } = await toggleFormalTodo({ client: supabase, todo });
    if (error) notify.error(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function deleteTodo(todoId) {
    if (!activeTrip || !canEditActiveTripContent) return;
    const { error } = await deleteFormalTodo({ client: supabase, todoId });
    if (error) notify.error(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function persistLuggage(scope, action, payload, itemId, meta = {}) {
    if (!activeTrip || !session?.user || activeMembership?.status !== "approved") return { ok: false, error: new Error("你不是此旅程的已核准成員。") };
    if (!isCurrentTripContext(meta)) return rejectCrossTripSave();
    const tripId = activeTrip.id;
    const context = requestGuard.context();
    requestGuard.invalidate([scope]);
    const result = await mutateLuggageItem({ client: supabase, tripId, scope, action, payload,
      itemId: itemId || null, baseUpdatedAt: meta.baseUpdatedAt || null });
    if (!requestGuard.sameContext(context)) return { ok: false, contextChanged: true };
    requestGuard.invalidate([scope]);
    if (result.error) {
      const error = new Error(luggageErrorMessage(result.error));
      if (result.conflict) await refreshLuggage(tripId, [scope]);
      notify.error(error.message);
      return { ...result, error };
    }
    if (requestGuard.sameContext(context)) {
      const setter = scope === "personal" ? setLuggageItems : setSharedLuggageItems;
      const update = current => applyLuggageMutation(current, { action, itemId, data: result.data });
      if (scope === "shared") updateSharedCache(tripId, session.user.id, update);
      setter(update);
    }
    return result;
  }
  function saveLuggageItem(payload, editingId, meta = {}) {
    return persistLuggage("personal", "save", { title: payload.title.trim(), category: payload.category.trim(), notes: (payload.notes || "").trim() }, editingId, meta);
  }
  function toggleLuggageItem(item) {
    return persistLuggage("personal", "patch", { packed: !item.packed }, item.id, { tripId: item.trip_id, baseUpdatedAt: item.updated_at });
  }
  function deleteLuggageItem(itemId, item) {
    return persistLuggage("personal", "delete", {}, itemId, { tripId: item?.trip_id, baseUpdatedAt: item?.updated_at });
  }
  function saveSharedLuggageItem(payload, editingId, meta = {}) {
    return persistLuggage("shared", "save", { title: payload.title.trim(), category: payload.category.trim(), notes: (payload.notes || "").trim(), assigned_to: payload.assigned_to || null }, editingId, meta);
  }
  function updateSharedLuggageItem(itemId, patch, item) {
    return persistLuggage("shared", "patch", patch, itemId, { tripId: item?.trip_id, baseUpdatedAt: item?.updated_at });
  }
  function deleteSharedLuggageItem(itemId, item) {
    return persistLuggage("shared", "delete", {}, itemId, { tripId: item?.trip_id, baseUpdatedAt: item?.updated_at });
  }

  async function assignTripLuggage(scope, item, assignedTo) {
    if (!activeTrip || !session?.user || activeMembership?.status !== "approved" || item.trip_id !== activeTrip.id) return { ok: false, error: new Error("luggage_forbidden") };
    const tripId = activeTrip.id;
    const context = requestGuard.context();
    requestGuard.invalidate(["personal", "shared"]);
    const result = await assignLuggageItem({ client: supabase, tripId, scope, item, assignedTo });
    if (!requestGuard.sameContext(context)) return { ok: false, contextChanged: true };
    requestGuard.invalidate(["personal", "shared"]);
    if (!result.ok) {
      const error = new Error(luggageErrorMessage(result.error));
      if (result.conflict) await refreshLuggage(tripId);
      return { ...result, error };
    }
    if (requestGuard.sameContext(context)) {
      if (scope === "personal") setLuggageItems(current => current.filter(row => row.id !== item.id));
      const update = current => applyLuggageMutation(current, { action: "save", itemId: scope === "shared" ? item.id : null, data: result.data });
      updateSharedCache(tripId, session.user.id, update);
      setSharedLuggageItems(update);
    }
    return result;
  }

  async function privatizeTripLuggage(item, category) {
    if (!activeTrip || !session?.user || activeMembership?.status !== "approved" || item.trip_id !== activeTrip.id) return { ok: false, error: new Error("luggage_forbidden") };
    const tripId = activeTrip.id;
    const context = requestGuard.context();
    requestGuard.invalidate(["personal", "shared"]);
    const result = await privatizeLuggageItem({ client: supabase, tripId, item, category });
    if (!requestGuard.sameContext(context)) return { ok: false, contextChanged: true };
    requestGuard.invalidate(["personal", "shared"]);
    if (!result.ok) {
      if (result.conflict) await refreshLuggage(tripId);
      return { ...result, error: new Error(luggageErrorMessage(result.error)) };
    }
    if (requestGuard.sameContext(context)) {
      updateSharedCache(tripId, session.user.id, current => current.filter(row => row.id !== item.id));
      setSharedLuggageItems(current => current.filter(row => row.id !== item.id));
      setLuggageItems(current => current.some(row => row.id === result.data.id) ? current : [...current, result.data]);
    }
    return result;
  }

  async function reorderTripLuggage(scope, item, target, placement, items) {
    if (!activeTrip || activeMembership?.status !== "approved" || item.trip_id !== activeTrip.id || target.trip_id !== activeTrip.id) return { ok: false, error: new Error("luggage_forbidden") };
    const tripId = activeTrip.id;
    const context = requestGuard.context();
    requestGuard.invalidate([scope]);
    const result = await reorderLuggageItems({ client: supabase, tripId, scope, item, target, placement, items });
    if (!requestGuard.sameContext(context)) return { ok: false, contextChanged: true };
    requestGuard.invalidate([scope]);
    if (!result.ok) {
      if (result.conflict) await refreshLuggage(tripId, [scope]);
      return { ...result, error: new Error(luggageErrorMessage(result.error)) };
    }
    if (requestGuard.sameContext(context)) {
      const setter = scope === "personal" ? setLuggageItems : setSharedLuggageItems;
      const update = current => applyLuggageOrder(current, result.data);
      if (scope === "shared") updateSharedCache(tripId, session.user.id, update);
      setter(update);
    }
    return result;
  }

  async function uploadAttachment(targetType, targetId, file, meta = {}) {
    if (budgetReceiptsDisabled && isBudgetReceiptTarget(targetType)) return { ok: false, error: new Error(budgetReceiptUnavailableMessage) };
    if (!activeTrip || !(targetType === "actual_expense" ? canEdit : canEditActiveTripContent) || !file) return;
    if (file.size > 10 * 1024 * 1024) {
      const error = new Error("附件大小需小於 10MB");
      if (!meta.leaseProtocol) notify.error(error);
      return { ok: false, error };
    }
    const fileName = safeFileName(file.name) || `attachment-${Date.now()}`;
    const path = `trips/${activeTrip.id}/attachments/${targetType}/${targetId}/${Date.now()}-${fileName}`;
    const uploadResult = await supabase.storage.from(attachmentBucket).upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (uploadResult.error) {
      if (!meta.leaseProtocol) notify.error(uploadResult.error);
      return { ok: false, error: uploadResult.error };
    }
    const receipt = {
      trip_id: activeTrip.id,
      target_type: targetType,
      target_id: targetId,
      file_name: file.name,
      file_url: path,
      file_type: file.type || null,
      file_size: file.size,
      uploaded_by: session.user.id,
    };
    const { error } = meta.leaseProtocol ? await supabase.rpc("mutate_budget_receipt", {
      p_trip_id: activeTrip.id, p_actual_id: targetId, p_action: "insert", p_receipt: receipt,
      p_edit_session_id: meta.editLease?.sessionId, p_edit_token: meta.editLease?.token,
    }) : await supabase.from("attachments").insert(receipt);
    if (error) {
      if (meta.leaseProtocol) await supabase.storage.from(attachmentBucket).remove([path]);
      if (!meta.leaseProtocol) notify.error(error);
      return { ok: false, error };
    }
    if (meta.leaseProtocol) await refreshBudget(activeTrip.id); else await loadTripData(activeTrip.id);
    return { ok: true };
  }

  async function openAttachment(attachment) {
    if (budgetReceiptsDisabled && isBudgetReceiptTarget(attachment.target_type)) { notify.warning(budgetReceiptUnavailableMessage); return; }
    const { data, error } = await supabase.storage.from(attachmentBucket).createSignedUrl(attachment.file_url, 600);
    if (error) {
      notify.error(error.message);
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function deleteAttachment(attachment, meta = {}) {
    if (budgetReceiptsDisabled && isBudgetReceiptTarget(attachment.target_type)) return { ok: false, error: new Error(budgetReceiptUnavailableMessage) };
    if (!activeTrip || !(attachment.target_type === "actual_expense" ? canEdit : canEditActiveTripContent)) return;
    const storageResult = await supabase.storage.from(attachmentBucket).remove([attachment.file_url]);
    if (storageResult.error) {
      notify.error(storageResult.error.message);
      return;
    }
    const { error } = await supabase.from("attachments").delete().eq("id", attachment.id);
    if (error) notify.error(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function deleteItem(itemId) {
    if (!activeTrip || !canEditActiveTripContent) return;
    const item = items.find((currentItem) => currentItem.id === itemId);
    if (isEffectiveFixedVisit(item)) {
      notify.warning("此行程已固定，請先解鎖後再修改。");
      return;
    }
    if (item && !isTransportationCard(item) && !(await ensureItineraryItemEditable(itemId))) return;
    if (item && isTransportationCard(item)) {
      const expectedVisitIds = sortedVisitItems(dayItems).map((visit) => visit.id);
      const operation = { transportId: item.id, type: timelineScheduleOperationTypes.deleteTransport };
      const plan = attachTimelineScheduleSortOrders({
        items: dayItems,
        plan: planTimelineSchedule({ items: dayItems, operation, orderedVisitIds: expectedVisitIds }),
      });
      if (!plan.ok) {
        notify.error(timelineScheduleErrorMessage(plan));
        return;
      }
      await applyTimelineScheduleOperation({
        expectedVisitIds,
        itemUpdatedAtBaselines: timelineScheduleUpdatedAtBaselines(dayItems),
        operation,
        plan,
        targetItemId: item.id,
      });
      return;
    }
    if (item && !isTransportationCard(item)) {
      const { error } = await supabase.rpc("delete_itinerary_item_budget_safe", { p_trip_id: activeTrip.id, p_id: itemId });
      if (error) notify.error(error.message);
      else await loadTripData(activeTrip.id);
      return;
    }
    const { error } = await supabase.from("itinerary_items").delete().eq("id", itemId).eq("trip_id", activeTrip.id);
    if (error) notify.error(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function toggleItemFixed(item) {
    if (!activeTrip || !canEditActiveTripContent || !item || isTransportationCard(item)) return { ok: false };
    if (!isTimedVisit(item)) {
      notify.error("未設定完整時間的行程不能固定。");
      return { ok: false };
    }
    if (!item.is_fixed && item.locked_by) {
      notify.warning("此行程目前有人正在編輯，暫時無法鎖定。");
      return { ok: false };
    }
    const nextFixed = !item.is_fixed;
    const { error } = await supabase
      .from("itinerary_items")
      .update({
        is_fixed: nextFixed,
        fixed_at: nextFixed ? new Date().toISOString() : null,
        fixed_by: nextFixed ? session.user.id : null,
      })
      .eq("id", item.id)
      .eq("trip_id", activeTrip.id);
    if (error) {
      notify.error(error.message);
      return { ok: false, error };
    }
    await loadTripData(activeTrip.id);
    return { ok: true };
  }

  async function confirmTransportWarning(itemId) {
    if (!activeTrip || !canEditActiveTripContent) return;
    const transportItem = items.find((item) => item.id === itemId);
    if (!transportItem) return;
    const snapshot = buildTransportPairSnapshot(
      items.find((item) => item.id === transportItem.from_item_id),
      items.find((item) => item.id === transportItem.to_item_id),
    );
    const { error } = await supabase
      .from("itinerary_items")
      .update({ ...snapshot, updated_at: new Date().toISOString() })
      .eq("id", itemId)
      .eq("trip_id", activeTrip.id);
    if (error) notify.error(error.message);
    else await loadTripData(activeTrip.id);
  }

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

  async function reorderDestinationPackages({
    confirmedScheduleEffect = null,
    dayIndex,
    itemUpdatedAtBaselines = null,
    packageSourceItemIds,
    slotItemIds,
    timelineScheduleExpectedVisitIds = null,
    timelineScheduleOperation = null,
    timelineSchedulePlan = null,
  }) {
    if (!activeTrip || !canEditActiveTripContent || dayIndex !== activeDay) return { ok: false };
    if (!timelineSchedulePlan?.ok || !timelineScheduleOperation) {
      return { ok: false, errorMessage: "目前無法安全重新排程，請重新整理後再試。" };
    }
    return applyTimelineScheduleOperation({
      confirmedMajorEffect: confirmedScheduleEffect,
      dayIndex,
      expectedVisitIds: timelineScheduleExpectedVisitIds,
      itemUpdatedAtBaselines,
      operation: timelineScheduleOperation,
      packageSourceItemIds,
      plan: timelineSchedulePlan,
      slotItemIds,
    });
  }

  async function reorderUntimedVisit({
    confirmedScheduleEffect = null,
    dayIndex,
    itemUpdatedAtBaselines = null,
    timelineScheduleExpectedVisitIds = null,
    timelineScheduleOperation = null,
    timelineSchedulePlan = null,
  }) {
    if (!activeTrip || !canEditActiveTripContent || dayIndex !== activeDay) return { ok: false };
    if (!timelineSchedulePlan?.ok || !timelineScheduleOperation) {
      return { ok: false, errorMessage: "目前無法安全重新排程，請重新整理後再試。" };
    }
    return applyTimelineScheduleOperation({
      confirmedMajorEffect: confirmedScheduleEffect,
      dayIndex,
      expectedVisitIds: timelineScheduleExpectedVisitIds,
      itemUpdatedAtBaselines,
      operation: timelineScheduleOperation,
      plan: timelineSchedulePlan,
    });
  }
  async function addPackItem(title) {
    if (!activeTrip || !canEditActiveTripContent || !title.trim()) return;
    const { error } = await supabase
      .from("pack_items")
      .insert({ trip_id: activeTrip.id, title: title.trim() });
    if (error) notify.error(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function togglePackItem(item) {
    if (!canEditActiveTripContent) return;
    const { error } = await supabase
      .from("pack_items")
      .update({ done: !item.done })
      .eq("id", item.id);
    if (error) notify.error(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function deletePackItem(itemId) {
    if (!canEditActiveTripContent) return;
    const { error } = await supabase.from("pack_items").delete().eq("id", itemId);
    if (error) notify.error(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function approveMember(memberId) {
    if (!activeTrip || !canInviteMembers) return;
    const { error } = await supabase
      .from("trip_members")
      .update({ status: "approved" })
      .eq("id", memberId)
      .eq("trip_id", activeTrip.id);
    if (error) notify.error(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function rejectMember(memberId) {
    if (!activeTrip || !canInviteMembers) return;
    const { error } = await supabase.from("trip_members").delete().eq("id", memberId).eq("trip_id", activeTrip.id);
    if (error) notify.error(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function createMemberInviteToken() {
    if (!activeTrip || !canInviteMembers) {
      const message = isTripDateLocked
        ? "旅程已進入結算階段，無法邀請或管理成員。"
        : "You do not have permission to invite members.";
      notify.error(message);
      return { ok: false, message };
    }
    const token = crypto.randomUUID();
    const { error } = await supabase.from("trip_invites").insert({
      trip_id: activeTrip.id,
      token,
    });
    if (error) {
      notify.error(error.message);
      return { ok: false, error, message: error.message };
    }
    return { ok: true, token };
  }

  async function updateMemberRole(memberId, nextRole) {
    if (!activeTrip || !canInviteMembers) return { ok: false };
    if (!["editor", "viewer"].includes(nextRole)) return { ok: false };
    const targetMember = members.find((member) => member.id === memberId);
    if (
      !targetMember ||
      targetMember.trip_id !== activeTrip.id ||
      targetMember.status !== "approved" ||
      targetMember.role === "owner"
    ) {
      return { ok: false };
    }
    if (targetMember.user_id === session?.user?.id) return { ok: false };
    const { error } = await supabase
      .from("trip_members")
      .update({ role: nextRole })
      .eq("id", memberId)
      .eq("trip_id", activeTrip.id);
    if (error) {
      notify.error(error.message);
      return { ok: false, error };
    }
    await loadTripData(activeTrip.id);
    return { ok: true };
  }

  async function removeMember(memberId) {
    if (!activeTrip || !canInviteMembers) return { ok: false };
    const targetMember = members.find((member) => member.id === memberId);
    if (
      !targetMember ||
      targetMember.trip_id !== activeTrip.id ||
      targetMember.role === "owner" ||
      targetMember.user_id === session?.user?.id
    ) {
      return { ok: false };
    }
    const ok = window.confirm(`移除「${memberName(targetMember)}」？`);
    if (!ok) return { ok: false, cancelled: true };
    const { error } = await supabase.from("trip_members").delete().eq("id", memberId).eq("trip_id", activeTrip.id);
    if (error) {
      notify.error(error.code === '55P03' ? '目前有支出或旅程資料正在更新，請稍後再移除成員。' : luggageErrorMessage(error));
      return { ok: false, error };
    }
    await loadTripData(activeTrip.id);
    return { ok: true };
  }

  function exportTrip() {
    if (!activeTrip) return;
    const exportedItems = timelineItemsInTripRange(items, activeTrip);
    const result = serializeTripToJson({ alternatives, items: exportedItems, trip: activeTrip });
    if (!result.ok) {
      notify.error(result.errors?.[0]?.message || "旅程資料不符合 JSON 匯出契約，未建立檔案。");
      return;
    }
    const blob = new Blob([result.json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = result.fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  function openAiTripRevisionExchange() {
    if (!activeTrip) return;
    const exportedItems = timelineItemsInTripRange(items, activeTrip);
    const result = serializeTripToAiItinerary({ alternatives, items: exportedItems, trip: activeTrip });
    if (!result.ok) {
      notify.error(result.errors?.[0]?.message || "旅程資料不符合 AI 交換契約，無法建立交換資料。");
      return;
    }
    setAiExchangeState({ document: result.document, fileName: result.fileName, mode: aiItineraryExchangeModes.reviseCopy });
  }

  function openAiTripCreateExchange() {
    setIsTripDialogOpen(false);
    setAiExchangeState({
      document: buildBlankAiItineraryTemplate(),
      fileName: aiItineraryBlankTemplateFileName,
      mode: aiItineraryExchangeModes.create,
    });
  }

  function returnFromAiTripCreateExchange() {
    setAiExchangeState(null);
    setIsTripDialogOpen(true);
  }

  async function selectTrip(nextTripId) {
    const nextTrip = trips.find((trip) => trip.id === nextTripId);
    if (!nextTrip || nextTripId === activeTripId) return;
    await navigateWithEditorHandoff(() => {
      setActiveDay(tripTodayIndex(nextTrip));
      setActiveTripId(nextTripId);
    });
  }

  if (!authReady) {
    return (
      <Shell>
        <div className="center-state">載入中...</div>
      </Shell>
    );
  }

  if (!session) {
    return (
      <Shell>
        <LoginView onSignIn={signInWithGoogle} />
      </Shell>
    );
  }

  return (
    <Shell appLayout collapsed={isSidebarCollapsed}>
      {isVersionDialogOpen ? <VersionInfoDialog onClose={() => setIsVersionDialogOpen(false)} /> : null}
      <aside className={`sidebar${isSidebarCollapsed ? " collapsed" : ""}`}>
        <div className="brand">
          <button
            className="brand-mark"
            type="button"
            title={isSidebarCollapsed ? "展開側欄" : "回到總覽"}
            aria-label={isSidebarCollapsed ? "展開側欄" : "回到總覽"}
            onClick={() => {
              if (isSidebarCollapsed) {
                setIsSidebarCollapsed(false);
                return;
              }
              void changeTripSection("today");
            }}
          >
            <span className="brand-logo-text">TP</span>
            {isSidebarCollapsed ? (
              <PanelLeftOpen className="brand-logo-action" size={22} strokeWidth={2.2} aria-hidden="true" />
            ) : null}
          </button>
          <div className="brand-copy">
            <h1>旅程工房</h1>
            <p>Travel Studio</p>
          </div>
          <button
            className="mini-button sidebar-toggle"
            type="button"
            title={isSidebarCollapsed ? "展開側欄" : "收合側欄"}
            onClick={() => setIsSidebarCollapsed((value) => !value)}
          >
            <PanelLeftClose size={18} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
        <nav className="section-nav" aria-label="功能導覽">
          {desktopNavItems.map((item) => {
            const Icon = desktopNavIcons[item.id];
            return (
              <button
                className={`section-nav-button${activeSection === item.id ? " active" : ""}`}
                key={item.id}
                type="button"
                title={item.label}
                aria-label={item.label}
                aria-current={activeSection === item.id ? "page" : undefined}
                onClick={() => void changeTripSection(item.id)}
              >
                <span className="section-nav-icon" aria-hidden="true">
                  <Icon size={15} strokeWidth={2.2} />
                </span>
                <span className="nav-label">{item.label}</span>
              </button>
            );
          })}
        </nav>
        <SidebarTripSection
          activeTripId={activeTripId}
          collapsed={isSidebarCollapsed}
          createTitle="新增旅程"
          flyoutId="sidebar-trips-flyout"
          headingId="sidebar-trips-title"
          isFlyoutOpen={isSidebarTripMenuOpen}
          onCloseFlyout={() => setIsSidebarTripMenuOpen(false)}
          onCreate={() => setIsTripDialogOpen(true)}
          onSelect={selectTrip}
          onToggleFlyout={() => setIsSidebarTripMenuOpen((value) => !value)}
          trips={trips}
        />
        <SidebarAccountMenu
          collapsed={isSidebarCollapsed}
          email={userEmail}
          initial={userInitial}
          isOpen={isAccountMenuOpen}
          name={userDisplayName}
          onClose={() => setIsAccountMenuOpen(false)}
          onSettings={() => void changeTripSection("settings")}
          onSignOut={signOut}
          onToggle={() => setIsAccountMenuOpen((value) => !value)}
          onVersion={() => setIsVersionDialogOpen(true)}
        />
      </aside>

      <main className="workspace">
        <TripHeader
          activeSection={activeSection}
          trip={activeTrip}
          members={members}
          currentUserId={session.user.id}
          days={days}
          dateChangePreviewData={tripDateChangePreviewData}
          canChangeTripDates={canChangeTripDates}
          canEditTrip={canManageActiveTrip}
          canOpenMembers={canOpenMembersDialog}
          canRenameTrip={canRenameActiveTrip}
          canShare={canOpenShareDialog}
          canViewDatePopover={isOwner}
          pendingMemberCount={pendingMemberCount}
          onDelete={deleteTrip}
          onAiExchange={openAiTripRevisionExchange}
          onExport={exportTrip}
          onInvite={() => {
            if (canOpenMembersDialog) setIsMembersDialogOpen(true);
          }}
          onOpenMembers={() => {
            if (canOpenMembersDialog) setIsMembersDialogOpen(true);
          }}
          onPresenceNavigate={navigateToTripPresence}
          onShare={() => {
            if (canOpenShareDialog) setIsShareDialogOpen(true);
          }}
          remotePresenceByUser={remoteTripPresenceByUser}
          onUpdateTrip={updateTrip}
          onUpdateTripDateRange={updateTripDateRange}
          showDeveloperTools={isOwner}
        />

        {loading ? <div className="center-state">同步資料中...</div> : null}

        {!activeTrip && !loading ? (
          <EmptyState onCreate={() => setIsTripDialogOpen(true)} />
        ) : null}

        {activeTrip ? (
          <TripWorkspace
            activeTrip={activeTrip}
            activeDay={activeDay}
            activeSection={activeSection}
            actualExpenses={actualExpenses}
            actualParticipants={actualParticipants}
            accommodations={accommodations}
            alternatives={alternatives}
            attachments={attachments}
            budgetSnapshot={budgetSnapshot}
            onRefreshBudget={refreshBudget}
            budgetItems={budgetItems}
            budgetParticipants={budgetParticipants}
            budgetsByItem={budgetsByItem}
            canEditBudget={canEdit}
            canEdit={canEditActiveTripContent}
            dayItems={dayItems}
            days={days}
            isOwner={isOwner}
            items={items}
            guideItems={guideItems}
            currentUserId={session.user.id}
            foreignCardSelection={foreignCardSelection}
            foreignDragPresence={foreignDragPresence}
            foreignSameDayDragActive={Boolean(foreignDragPresence)}
            luggageItems={luggageItems}
            luggageTab={luggageTab}
            members={members}
            packItems={packItems}
            routeOverridePointsBySegment={activeRouteOverridePointsBySegment}
            routeOverrideSaveError={routeOverrideSaveError}
            routeEditCollaboration={routeEditCollaboration}
            sharedLuggageItems={sharedLuggageItems}
            todayDayIndex={todayDayIndex}
            todayItems={todayItems}
            todoItems={todoItems}
            timelineDayTabPresenceByDay={timelineDayTabPresenceByDay}
            onActiveDay={setActiveDay}
            onRouteEditCollaborationEvent={onRouteEditCollaborationEvent}
            onRouteEditPresenceChange={onRouteEditPresenceChange}
            onAddPackItem={addPackItem}
            onApplyAlternative={applyAlternative}
            onConfirmTransportWarning={confirmTransportWarning}
            onApproveMember={approveMember}
            onDeleteAlternative={deleteAlternative}
            onDeleteAccommodation={deleteAccommodation}
            onDeleteAttachment={deleteAttachment}
            onDeleteGuide={deleteGuide}
            onDeleteItem={deleteItem}
            onDeleteLuggageItem={deleteLuggageItem}
            onDeletePackItem={deletePackItem}
            onDeleteSharedLuggageItem={deleteSharedLuggageItem}
            onDeleteTodo={deleteTodo}
            onClearCardSelection={clearCardSelection}
            onClearDragPresence={clearDragPresence}
            onRejectMember={rejectMember}
            onReorderDestinationPackages={reorderDestinationPackages}
            onReorderUntimedVisit={reorderUntimedVisit}
            onPublishDragPresence={publishDragPresence}
            onPublishCardSelection={publishCardSelection}
            onSaveAlternative={saveAlternative}
            onSaveAccommodation={saveAccommodation}
            onSaveGuide={saveGuide}
            onSaveItem={saveItem}
            onSaveRouteOverride={saveRouteOverrideChange}
            onSaveLuggageItem={saveLuggageItem}
            onSaveSharedLuggageItem={saveSharedLuggageItem}
            onAssignLuggage={assignTripLuggage}
            onPrivatizeLuggage={privatizeTripLuggage}
            onReorderLuggage={reorderTripLuggage}
            onSaveTodo={saveTodo}
            onLuggageTabChange={setLuggageTab}
            onSectionChange={changeTripSection}
            onToggleLuggageItem={toggleLuggageItem}
            onToggleTodo={toggleTodo}
            onTogglePackItem={togglePackItem}
            onToggleItemFixed={toggleItemFixed}
            onUpdateSharedLuggageItem={updateSharedLuggageItem}
            onOpenAttachment={openAttachment}
            onUploadAttachment={uploadAttachment}
          />
        ) : null}
      </main>

      <nav className="bottom-nav" aria-label="手機功能導覽">
        {mobileNavItems.map((item) => (
          <button
            className={`bottom-nav-button${activeSection === item.id ? " active" : ""}`}
            key={item.id}
            type="button"
            onClick={() => void changeTripSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {isTripDialogOpen ? (
        <TripDialog
          busy={tripCreating}
          form={tripForm}
          onChange={setTripForm}
          onClose={() => setIsTripDialogOpen(false)}
          onImportAi={openAiTripCreateExchange}
          onImportFile={previewTripImport}
          onSubmit={createTrip}
        />
      ) : null}

      {tripImportState ? (
        <TripImportPreviewDialog
          busy={tripImportState.busy}
          error={tripImportState.error}
          onClose={() => setTripImportState(null)}
          onConfirm={confirmTripImport}
          preview={tripImportState.preview}
        />
      ) : null}

      {aiExchangeState ? (
        <AiTripExchangeDialog
          document={aiExchangeState.document}
          fileName={aiExchangeState.fileName}
          mode={aiExchangeState.mode}
          onBack={aiExchangeState.mode === aiItineraryExchangeModes.create ? returnFromAiTripCreateExchange : undefined}
          onClose={() => setAiExchangeState(null)}
          onImportFile={previewTripImport}
        />
      ) : null}

      {isMembersDialogOpen && activeTrip && canOpenMembersDialog ? (
        <MembersInviteDialog
          canManageMembers={canInviteMembers}
          currentRole={activeMembership?.role}
          currentUserId={session.user.id}
          isTripDateLocked={isTripDateLocked}
          members={members}
          onApprove={approveMember}
          onClose={() => setIsMembersDialogOpen(false)}
          onCreateInvite={createMemberInviteToken}
          onReject={rejectMember}
          onRemoveMember={removeMember}
          onUpdateRole={updateMemberRole}
          trip={activeTrip}
        />
      ) : null}

      {isShareDialogOpen && activeTrip && canOpenShareDialog ? (
        <ShareDialog
          canManage={canManageShareLinks}
          links={shareLinks}
          onClose={() => setIsShareDialogOpen(false)}
          onRefresh={() => loadShareLinks(activeTrip.id)}
          trip={activeTrip}
        />
      ) : null}
      <ActiveEditorGuardDialog />
    </Shell>
  );
}
