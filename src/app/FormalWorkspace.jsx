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
import { todayInput } from "../lib/displayFormat.js";
import { budgetReceiptsDisabled, budgetReceiptUnavailableMessage, isBudgetReceiptTarget } from "../lib/budgetReceiptConfig.js";
import { readOfflineTrips, writeOfflineTrips, clearOfflineAccount } from "../lib/offlineCache.js";
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
import { fetchBudgetQuote, getCachedBudgetQuote } from "../lib/tripBudgetRates.js";
import { tripPresencePageKey } from "../lib/tripPresenceDisplay.js";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { findLatestDraftTrip } from "../lib/draftAutosave.js";
import { releaseEditLock } from "../lib/editLocks.js";
import { supabase } from "../lib/supabase.js";
import { isTransportationCard } from "../lib/timelineTransportationRoles.js";
import { deleteTripStay, saveTripStay } from "../features/stays/formalStays.js";
import { tripDays } from "../lib/timelineTime.js";
import { transportCardTitle } from "../lib/timelineTransportCategories.js";
import { buildTripImportPersistencePayload, serializeTripToJson } from "../lib/tripJsonAdapters.js";
import { buildTripJsonPreview } from "../lib/tripJsonContract.js";
import { parseUnifiedTripJsonText } from "../lib/unifiedTripJsonImport.js";
import { aiItineraryBlankTemplateFileName, aiItineraryExchangeModes, buildBlankAiItineraryTemplate, serializeTripToAiItinerary } from "../lib/aiItineraryAdapters.js";
import MembersInviteDialog from "../components/members/MembersInviteDialog.jsx";
import SidebarAccountMenu from "../components/sidebar/SidebarAccountMenu.jsx";
import SidebarTripSection from "../components/sidebar/SidebarTripSection.jsx";
import { clearTimelineDraftsForItemIds, hasTimelineDraftForTrip } from "../components/timeline/timelineDrafts.js";
import TripDialog from "../components/trip/TripDialog.jsx";
import TripImportPreviewDialog from "../components/trip-import/TripImportPreviewDialog.jsx";
import AiTripExchangeDialog from "../components/trip-import/AiTripExchangeDialog.jsx";
import { sortScheduleItems } from "../lib/timelineUntimedOrdering.js";
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
  tripPresenceHeartbeatMs,
  tripPresenceStaleMs,
  tripPresenceRecoverableStatuses,
  tripPresencePageToSection,
  tripPresenceDebug,
  tripPresenceDebugPayload,
} from "./tripPresence.js";
import { desktopNavItems, desktopNavIcons, mobileNavItems } from "./navigation.js";
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
import { createTimelineCommands } from "../features/timeline/formalTimelineCommands.js";
import { useRouteWorkspace } from "../components/map/useRouteWorkspace.js";

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

  const [tripForm, setTripForm] = useState({
    title: "京都五日散策",
    destination_country: "日本",
    destination_city: "京都",
    start_date: todayInput(),
    end_date: todayInput(2),
  });
  const [tripPresenceChannelVersion, setTripPresenceChannelVersion] = useState(0);
  const [timelineDragPresenceChannelVersion, setTimelineDragPresenceChannelVersion] = useState(0);

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
  const {
    clearRouteOverrides,
    routeOverrideSaveError,
    invalidateChangedEndpoints,
    activeRouteOverridePointsBySegment,
    routeEditCollaboration,
    onRouteEditPresenceChange,
    onRouteEditCollaborationEvent,
    loadRouteOverrides,
    saveRouteOverrideChange,
  } = useRouteWorkspace({
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
  });

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
    clearRouteOverrides,
    setPackItems,
    setMembers,
    syncFeedback,
    invalidateChangedEndpoints,
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

  const {
    saveItem,
    saveAlternative,
    deleteAlternative,
    applyAlternative,
    deleteItem,
    toggleItemFixed,
    confirmTransportWarning,
    reorderDestinationPackages,
    reorderUntimedVisit,
  } = createTimelineCommands({
    session,
    activeDay,
    items,
    alternatives,
    activeTrip,
    requestGuard,
    tripDataContext,
    canEditActiveTripContent,
    days,
    dayItems,
    loadTripData,
    rejectCrossTripSave,
    isCurrentTripContext,
    updateWithConflictCheck,
  });

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
