import ShareDialog from "../components/share/ShareDialog.jsx";
import { ActiveEditorGuardDialog, requestActiveEditorHandoff } from "./activeEditorGuard.jsx";
import { memberName } from "../lib/memberName.js";
import { todayInput } from "../lib/displayFormat.js";
import { readOfflineTrips, writeOfflineTrips, clearOfflineAccount } from "../lib/offlineCache.js";
import { createRequestGuard } from "../lib/luggageSync.js";
import { notify } from "../lib/notifications.js";
import { createSyncNotifications } from "../lib/syncNotifications.js";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fetchBudgetQuote } from "../lib/tripBudgetRates.js";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { findLatestDraftTrip } from "../lib/draftAutosave.js";
import { releaseEditLock } from "../lib/editLocks.js";
import { supabase } from "../lib/supabase.js";
import { tripDays } from "../lib/timelineTime.js";
import { aiItineraryExchangeModes } from "../lib/aiItineraryAdapters.js";
import MembersInviteDialog from "../components/members/MembersInviteDialog.jsx";
import SidebarAccountMenu from "../components/sidebar/SidebarAccountMenu.jsx";
import SidebarTripSection from "../components/sidebar/SidebarTripSection.jsx";
import TripDialog from "../components/trip/TripDialog.jsx";
import TripImportPreviewDialog from "../components/trip-import/TripImportPreviewDialog.jsx";
import AiTripExchangeDialog from "../components/trip-import/AiTripExchangeDialog.jsx";
import { sortScheduleItems } from "../lib/timelineUntimedOrdering.js";
import { desktopNavItems, desktopNavIcons, mobileNavItems } from "./navigation.js";
import { tripTodayIndex, deriveTripStage } from "../components/trip/tripDetails.js";
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
import { useTripPresence } from "./useTripPresence.js";
import { useTimelinePresence } from "../features/timeline/useTimelinePresence.js";
import { createTripCommands } from "../features/trip/tripCommands.js";
import { createExchangeCommands } from "../features/trip-import/exchangeCommands.js";
import { createMemberCommands } from "../features/members/memberCommands.js";
import { createAttachmentCommands } from "../features/attachments/attachmentCommands.js";
import { createPackCommands } from "../features/pack/packCommands.js";
import { createLuggageCommands } from "../features/luggage/luggageCommands.js";
import { createStayActions } from "../features/stays/stayActions.js";
import { createTodoGuideActions } from "../features/todo-guide/todoGuideActions.js";

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
  const restoredDayRef = useRef(null);
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

  // Reset the previous trip snapshot before any child can render it under the new trip.
  const [tripRowsAccess, setTripRowsAccess] = useState(null);
  if (tripRowsAccess !== tripReadAccessRef.current) {
    setTripRowsAccess(tripReadAccessRef.current);
    setItems([]);
    setAlternatives([]);
    setAccommodations([]);
    setGuideItems([]);
    setTodoItems([]);
    setLuggageItems([]);
    setSharedLuggageItems([]);
    setAttachments([]);
    setPackItems([]);
    setMembers([]);
    setShareLinks([]);
  }
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
  const { setTripPresenceSelectedItem, remoteTripPresenceByUser, timelineDayTabPresenceByDay, navigateToTripPresence } = useTripPresence({
    activeTripId,
    activeDay,
    setActiveDay,
    activeSection,
    changeTripSection,
    timelineDragPresenceSessionIdRef,
    activeMembership,
    activeUserId,
    timelineDragPresenceUserName,
  });

  useEffect(() => {
    setIsAccountMenuOpen(false);
    setIsSidebarTripMenuOpen(false);
  }, [activeSection, activeTripId, isSidebarCollapsed]);

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
    const scope = requestGuard.context();
    const access = tripReadAccessRef.current;
    if (!tripId) {
      setShareLinks([]);
      return;
    }
    if (!canReadTrip(scope.key) || JSON.parse(scope.key)[1] !== tripId) return;

    const { data, error } = await supabase
      .from("share_links")
      .select("*")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false });

    if (!error && requestGuard.sameContext(scope) && tripReadAccessRef.current === access) setShareLinks(data || []);
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

  const {
    foreignDragPresence,
    foreignCardSelection,
    clearDragPresence,
    clearCardSelection,
    publishCardSelection,
    publishDragPresence,
  } = useTimelinePresence({
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
  });

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

  const { createTrip, updateTrip, updateTripDateRange, deleteTrip } = createTripCommands({
    session,
    activeTripId,
    setActiveDay,
    items,
    setIsTripDialogOpen,
    setTripCreating,
    tripCreationInFlight,
    tripForm,
    setTripForm,
    activeTrip,
    accountRef,
    requestGuard,
    tripDataContext,
    isOwner,
    isTripDateLocked,
    canManageActiveTrip,
    canRenameActiveTrip,
    tripDateChangePreviewData,
    loadTrips,
    loadTripData,
  });

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

  const stayActions = createStayActions({
    activeTrip,
    canEditActiveTripContent,
    loadTripData,
    rejectCrossTripSave,
    isCurrentTripContext,
    updateWithConflictCheck,
  });

  const todoGuideActions = createTodoGuideActions({
    activeTrip,
    canEditActiveTripContent,
    loadTripData,
    rejectCrossTripSave,
    isCurrentTripContext,
    updateWithConflictCheck,
  });

  const luggageCommands = createLuggageCommands({
    session,
    setLuggageItems,
    setSharedLuggageItems,
    activeTrip,
    requestGuard,
    updateSharedCache,
    refreshLuggage,
    activeMembership,
    rejectCrossTripSave,
    isCurrentTripContext,
  });

  const attachmentCommands = createAttachmentCommands({
    session,
    activeTrip,
    refreshBudget,
    canEdit,
    canEditActiveTripContent,
    loadTripData,
  });

  const timelineCommands = createTimelineCommands({
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

  const packCommands = createPackCommands({ activeTrip, canEditActiveTripContent, loadTripData });

  const memberCommands = createMemberCommands({
    session,
    members,
    activeTrip,
    isTripDateLocked,
    canInviteMembers,
    requestGuard,
    tripDataContext,
    loadTripData,
  });

  const {
    previewTripImport,
    confirmTripImport,
    exportTrip,
    openAiTripRevisionExchange,
    openAiTripCreateExchange,
    returnFromAiTripCreateExchange,
  } = createExchangeCommands({
    setActiveDay,
    items,
    alternatives,
    setIsTripDialogOpen,
    tripImportState,
    setTripImportState,
    setAiExchangeState,
    activeTrip,
    loadTrips,
  });

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
            packCommands={packCommands}
            memberCommands={memberCommands}
            onClearCardSelection={clearCardSelection}
            onClearDragPresence={clearDragPresence}
            onPublishDragPresence={publishDragPresence}
            onPublishCardSelection={publishCardSelection}
            stayActions={stayActions}
            todoGuideActions={todoGuideActions}
            timelineCommands={timelineCommands}
            onSaveRouteOverride={saveRouteOverrideChange}
            luggageCommands={luggageCommands}
            onLuggageTabChange={setLuggageTab}
            onSectionChange={changeTripSection}
            attachmentCommands={attachmentCommands}
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
          onApprove={memberCommands.approveMember}
          onClose={() => setIsMembersDialogOpen(false)}
          onCreateInvite={memberCommands.createMemberInviteToken}
          onReject={memberCommands.rejectMember}
          onRemoveMember={memberCommands.removeMember}
          onUpdateRole={memberCommands.updateMemberRole}
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
