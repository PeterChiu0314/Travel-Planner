import { useCallback, useEffect, useMemo, useState } from "react";
import { hasSupabaseConfig, supabase } from "./lib/supabase.js";

const attachmentBucket = "trip-attachments";

const desktopNavItems = [
  { id: "today", label: "今日 / 總覽", shortLabel: "今日" },
  { id: "timeline", label: "時間軸", shortLabel: "軸" },
  { id: "budget", label: "預算", shortLabel: "錢" },
  { id: "accommodation", label: "住宿", shortLabel: "宿" },
  { id: "todo", label: "待辦", shortLabel: "辦" },
  { id: "luggage", label: "行李", shortLabel: "李" },
  { id: "settlement", label: "結算", shortLabel: "結" },
  { id: "settings", label: "設定", shortLabel: "設" },
];

const mobileNavItems = [
  { id: "today", label: "今日" },
  { id: "timeline", label: "時間軸" },
  { id: "budget", label: "預算" },
  { id: "luggage", label: "行李" },
  { id: "settings", label: "更多" },
];

const typeLabels = {
  attraction: "景點",
  food: "餐飲",
  hotel: "住宿",
  transport: "交通",
  note: "備註",
};

const typeColors = {
  attraction: "#2f8f72",
  food: "#d85f49",
  hotel: "#7865a8",
  transport: "#5f8fb8",
  note: "#f3b64b",
};

const defaultPackItems = ["護照", "行動電源", "充電線", "轉接頭", "雨具", "常備藥", "票券"];

const emptyItemForm = {
  type: "attraction",
  start_time: "",
  end_time: "",
  title: "",
  location: "",
  location_name: "",
  address: "",
  map_url: "",
  note: "",
  description: "",
  transportation_note: "",
  cost: 0,
};

const emptyBudgetForm = {
  category: "餐飲",
  subcategory: "",
  title: "",
  amount: 0,
  currency: "TWD",
  exchange_rate: 1,
  payer_id: "",
  is_fixed: false,
  note: "",
  participantIds: [],
  linkedItemIds: [],
};

const emptyActualForm = {
  budget_item_id: "",
  title: "",
  amount: 0,
  currency: "TWD",
  exchange_rate: 1,
  payer_id: "",
  paid_at: "",
  note: "",
  participantIds: [],
};

const emptyAccommodationForm = {
  name: "",
  check_in_date: "",
  check_out_date: "",
  check_in_time: "",
  check_out_time: "",
  address: "",
  map_url: "",
  booking_code: "",
  payment_status: "unpaid",
  budget_item_id: "",
  custom_notes: "",
};

const emptyGuideForm = {
  title: "",
  description: "",
  url: "",
};

const emptyTodoForm = {
  title: "",
  description: "",
  due_date: "",
  assignee_id: "",
  guide_id: "",
};

const emptyLuggageForm = {
  title: "",
  category: "",
};

const emptySharedLuggageForm = {
  title: "",
  category: "",
  assigned_to: "",
};

function todayInput(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return dateToInputValue(date);
}

function dateToInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentTimeInput() {
  const date = new Date();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function dateTimeLocalInput(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function sortScheduleItems(items) {
  return [...items].sort((a, b) => {
    const timeSort = (a.start_time || "99:99").localeCompare(b.start_time || "99:99");
    const orderSort = Number(a.sort_order || 0) - Number(b.sort_order || 0);
    return timeSort || orderSort;
  });
}

function memberName(member) {
  return member?.display_name || member?.email || member?.user_id || "未指定";
}

function buildParticipantsMap(participants, foreignKey) {
  const next = {};
  participants.forEach((participant) => {
    next[participant[foreignKey]] = [...(next[participant[foreignKey]] || []), participant.user_id];
  });
  return next;
}

function simplifyTransfers(balances) {
  const debtors = balances
    .filter((entry) => entry.balance < -0.5)
    .map((entry) => ({ ...entry, amount: Math.abs(entry.balance) }))
    .sort((a, b) => b.amount - a.amount);
  const creditors = balances
    .filter((entry) => entry.balance > 0.5)
    .map((entry) => ({ ...entry, amount: entry.balance }))
    .sort((a, b) => b.amount - a.amount);
  const transfers = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = Math.min(debtor.amount, creditor.amount);
    if (amount > 0.5) {
      transfers.push({ from: debtor.user_id, to: creditor.user_id, amount: Math.round(amount) });
    }
    debtor.amount -= amount;
    creditor.amount -= amount;
    if (debtor.amount <= 0.5) debtorIndex += 1;
    if (creditor.amount <= 0.5) creditorIndex += 1;
  }

  return transfers;
}

function safeFileName(name) {
  return name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

function tripTodayIndex(trip) {
  const days = tripDays(trip);
  if (!days.length) return 0;
  const today = todayInput();
  const index = days.findIndex((date) => dateToInputValue(date) === today);
  if (index >= 0) return index;
  if (today < dateToInputValue(days[0])) return 0;
  return days.length - 1;
}

function formatDate(date) {
  return new Intl.DateTimeFormat("zh-TW", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function formatMoney(value) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function tripDays(trip) {
  if (!trip?.start_date || !trip?.end_date) return [];
  const start = new Date(`${trip.start_date}T00:00:00`);
  const end = new Date(`${trip.end_date}T00:00:00`);
  const diff = Math.max(0, Math.round((end - start) / 86400000));
  return Array.from({ length: diff + 1 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function inviteTokenFromUrl() {
  return new URLSearchParams(window.location.search).get("invite");
}

function clearInviteTokenFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("invite");
  window.history.replaceState({}, "", url.toString());
}

function shareTokenFromUrl() {
  return new URLSearchParams(window.location.search).get("share");
}

function offlineTripKey(tripId) {
  return `travel-planner-offline-${tripId}`;
}

function offlineTripsKey(userId) {
  return `travel-planner-offline-trips-${userId}`;
}

function readOfflineTrips(userId) {
  try {
    const raw = localStorage.getItem(offlineTripsKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeOfflineTrips(userId, payload) {
  try {
    localStorage.setItem(offlineTripsKey(userId), JSON.stringify(payload));
  } catch {
    // Offline read is best effort; storage can be unavailable in private windows.
  }
}

function readOfflineTripData(tripId) {
  try {
    const raw = localStorage.getItem(offlineTripKey(tripId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeOfflineTripData(tripId, payload) {
  try {
    localStorage.setItem(
      offlineTripKey(tripId),
      JSON.stringify({
        ...payload,
        cached_at: new Date().toISOString(),
      }),
    );
  } catch {
    // Offline read is best effort; storage can be unavailable in private windows.
  }
}

export default function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [trips, setTrips] = useState([]);
  const [activeTripId, setActiveTripId] = useState(null);
  const [activeDay, setActiveDay] = useState(0);
  const [items, setItems] = useState([]);
  const [alternatives, setAlternatives] = useState([]);
  const [budgetItems, setBudgetItems] = useState([]);
  const [budgetParticipants, setBudgetParticipants] = useState([]);
  const [actualExpenses, setActualExpenses] = useState([]);
  const [actualParticipants, setActualParticipants] = useState([]);
  const [accommodations, setAccommodations] = useState([]);
  const [guideItems, setGuideItems] = useState([]);
  const [todoItems, setTodoItems] = useState([]);
  const [luggageItems, setLuggageItems] = useState([]);
  const [sharedLuggageItems, setSharedLuggageItems] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [itineraryBudgetLinks, setItineraryBudgetLinks] = useState([]);
  const [packItems, setPackItems] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [isTripDialogOpen, setIsTripDialogOpen] = useState(false);
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [shareLinks, setShareLinks] = useState([]);
  const [shareSnapshot, setShareSnapshot] = useState(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState("");
  const [activeSection, setActiveSection] = useState("today");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [tripForm, setTripForm] = useState({
    title: "京都五日散策",
    destination: "京都, 日本",
    start_date: todayInput(),
    end_date: todayInput(2),
  });

  const activeTrip = useMemo(
    () => trips.find((trip) => trip.id === activeTripId) || null,
    [activeTripId, trips],
  );
  const activeMembership = activeTrip?.membership;
  const isOwner = activeMembership?.role === "owner" && activeMembership?.status === "approved";
  const canEdit =
    activeMembership?.status === "approved" &&
    (activeMembership?.role === "owner" || activeMembership?.role === "editor");
  const isPending = activeMembership?.status === "pending";
  const days = useMemo(() => tripDays(activeTrip), [activeTrip]);
  const todayDayIndex = useMemo(() => tripTodayIndex(activeTrip), [activeTrip]);

  const dayItems = useMemo(
    () => sortScheduleItems(items.filter((item) => item.day_index === activeDay)),
    [activeDay, items],
  );

  const todayItems = useMemo(
    () => sortScheduleItems(items.filter((item) => item.day_index === todayDayIndex)),
    [items, todayDayIndex],
  );

  const loadTrips = useCallback(
    async (preferredTripId = activeTripId) => {
      if (!session?.user) return;
      setLoading(true);
      const { data, error } = await supabase
        .from("trip_members")
        .select(
          "role,status,trip_id,trips(id,title,name,status,destination,start_date,end_date,owner_id,updated_at)",
        )
        .eq("user_id", session.user.id);

      if (error) {
        const cachedTrips = readOfflineTrips(session.user.id);
        if (cachedTrips?.trips?.length) {
          setTrips(cachedTrips.trips);
          const nextActive =
            cachedTrips.trips.find((trip) => trip.id === preferredTripId)?.id ||
            cachedTrips.activeTripId ||
            cachedTrips.trips[0]?.id ||
            null;
          setActiveTripId(nextActive);
          setNotice("目前使用已快取的離線旅程清單；重新連線後會自動更新。");
          setLoading(false);
          return;
        }
        setNotice(error.message);
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
      const nextActive =
        nextTrips.find((trip) => trip.id === preferredTripId)?.id || nextTrips[0]?.id || null;
      setActiveTripId(nextActive);
      writeOfflineTrips(session.user.id, { trips: nextTrips, activeTripId: nextActive });
      setLoading(false);
    },
    [activeTripId, session?.user],
  );

  const loadTripData = useCallback(async (tripId) => {
    if (!tripId) {
      setItems([]);
      setAlternatives([]);
      setBudgetItems([]);
      setBudgetParticipants([]);
      setActualExpenses([]);
      setActualParticipants([]);
      setAccommodations([]);
      setGuideItems([]);
      setTodoItems([]);
      setLuggageItems([]);
      setSharedLuggageItems([]);
      setAttachments([]);
      setItineraryBudgetLinks([]);
      setPackItems([]);
      setMembers([]);
      return;
    }

    const [
      itemsResult,
      alternativesResult,
      budgetResult,
      budgetParticipantsResult,
      actualResult,
      actualParticipantsResult,
      accommodationsResult,
      guideResult,
      todoResult,
      luggageResult,
      sharedLuggageResult,
      attachmentsResult,
      budgetLinksResult,
      packResult,
      membersResult,
    ] = await Promise.all([
      supabase.from("itinerary_items").select("*").eq("trip_id", tripId),
      supabase.from("itinerary_alternatives").select("*"),
      supabase.from("budget_items").select("*").eq("trip_id", tripId),
      supabase.from("budget_item_participants").select("*"),
      supabase.from("actual_expenses").select("*").eq("trip_id", tripId),
      supabase.from("actual_expense_participants").select("*"),
      supabase.from("accommodations").select("*").eq("trip_id", tripId).order("check_in_date"),
      supabase.from("guide_items").select("*").eq("trip_id", tripId).order("created_at"),
      supabase.from("todo_items").select("*").eq("trip_id", tripId).order("due_date", { nullsFirst: false }),
      supabase.from("luggage_items").select("*").eq("trip_id", tripId).order("created_at"),
      supabase.from("shared_luggage_items").select("*").eq("trip_id", tripId).order("created_at"),
      supabase.from("attachments").select("*").eq("trip_id", tripId).order("created_at"),
      supabase.from("itinerary_budget_items").select("*"),
      supabase.from("pack_items").select("*").eq("trip_id", tripId).order("created_at"),
      supabase
        .from("trip_members")
        .select("id,trip_id,user_id,role,status,created_at,display_name,email")
        .eq("trip_id", tripId)
        .order("created_at"),
    ]);

    const error =
      itemsResult.error ||
      alternativesResult.error ||
      budgetResult.error ||
      budgetParticipantsResult.error ||
      actualResult.error ||
      actualParticipantsResult.error ||
      accommodationsResult.error ||
      guideResult.error ||
      todoResult.error ||
      luggageResult.error ||
      sharedLuggageResult.error ||
      attachmentsResult.error ||
      budgetLinksResult.error ||
      packResult.error ||
      membersResult.error;
    if (error) {
      const cached = readOfflineTripData(tripId);
      if (cached) {
        setItems(cached.items || []);
        setAlternatives(cached.alternatives || []);
        setBudgetItems(cached.budgetItems || []);
        setBudgetParticipants(cached.budgetParticipants || []);
        setActualExpenses(cached.actualExpenses || []);
        setActualParticipants(cached.actualParticipants || []);
        setAccommodations(cached.accommodations || []);
        setGuideItems(cached.guideItems || []);
        setTodoItems(cached.todoItems || []);
        setLuggageItems(cached.luggageItems || []);
        setSharedLuggageItems(cached.sharedLuggageItems || []);
        setAttachments(cached.attachments || []);
        setItineraryBudgetLinks(cached.itineraryBudgetLinks || []);
        setPackItems(cached.packItems || []);
        setMembers(cached.members || []);
        setNotice("目前使用已快取的離線資料；重新連線後會自動更新。");
        return;
      }
      setNotice(error.message);
      return;
    }

    const nextItems = itemsResult.data || [];
    const itemIds = new Set(nextItems.map((item) => item.id));
    const budgetIds = new Set((budgetResult.data || []).map((budget) => budget.id));
    const actualIds = new Set((actualResult.data || []).map((expense) => expense.id));
    const nextAlternatives = (alternativesResult.data || []).filter((alternative) =>
      itemIds.has(alternative.itinerary_item_id),
    );
    const nextBudgetParticipants = (budgetParticipantsResult.data || []).filter((participant) =>
      budgetIds.has(participant.budget_item_id),
    );
    const nextActualParticipants = (actualParticipantsResult.data || []).filter((participant) =>
      actualIds.has(participant.actual_expense_id),
    );
    const nextItineraryBudgetLinks = (budgetLinksResult.data || []).filter(
      (link) => itemIds.has(link.itinerary_item_id) && budgetIds.has(link.budget_item_id),
    );

    setItems(nextItems);
    setAlternatives(nextAlternatives);
    setBudgetItems(budgetResult.data || []);
    setBudgetParticipants(nextBudgetParticipants);
    setActualExpenses(actualResult.data || []);
    setActualParticipants(nextActualParticipants);
    setAccommodations(accommodationsResult.data || []);
    setGuideItems(guideResult.data || []);
    setTodoItems(todoResult.data || []);
    setLuggageItems(luggageResult.data || []);
    setSharedLuggageItems(sharedLuggageResult.data || []);
    setAttachments(attachmentsResult.data || []);
    setItineraryBudgetLinks(nextItineraryBudgetLinks);
    setPackItems(packResult.data || []);
    setMembers(membersResult.data || []);
    writeOfflineTripData(tripId, {
      items: nextItems,
      alternatives: nextAlternatives,
      budgetItems: budgetResult.data || [],
      budgetParticipants: nextBudgetParticipants,
      actualExpenses: actualResult.data || [],
      actualParticipants: nextActualParticipants,
      accommodations: accommodationsResult.data || [],
      guideItems: guideResult.data || [],
      todoItems: todoResult.data || [],
      luggageItems: luggageResult.data || [],
      sharedLuggageItems: sharedLuggageResult.data || [],
      attachments: attachmentsResult.data || [],
      itineraryBudgetLinks: nextItineraryBudgetLinks,
      packItems: packResult.data || [],
      members: membersResult.data || [],
    });
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

  useEffect(() => {
    if (!hasSupabaseConfig) {
      setAuthReady(true);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setTrips([]);
      setActiveTripId(null);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!hasSupabaseConfig) return;
    const token = shareTokenFromUrl();
    if (!token) return;

    async function loadShareSnapshot() {
      setShareLoading(true);
      setShareError("");
      const { data, error } = await supabase.rpc("get_share_snapshot", { share_token: token });
      if (error) {
        setShareError(error.message);
        setShareSnapshot(null);
      } else if (!data) {
        setShareError("這個分享連結已停用、過期，或不存在。");
        setShareSnapshot(null);
      } else {
        setShareSnapshot(data);
      }
      setShareLoading(false);
    }

    loadShareSnapshot();
  }, []);

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
        setNotice(error?.message || "邀請連結無效或已失效。");
        clearInviteTokenFromUrl();
        return;
      }

      setNotice("已送出加入申請，等待旅程擁有者核准。");
      await loadTrips(tripId);
      clearInviteTokenFromUrl();
    }

    joinInvite();
  }, [loadTrips, session]);

  useEffect(() => {
    setActiveDay(todayDayIndex);
    loadTripData(activeTripId);
  }, [activeTripId, loadTripData, todayDayIndex]);

  useEffect(() => {
    if (activeTripId && isOwner) {
      loadShareLinks(activeTripId);
    } else {
      setShareLinks([]);
    }
  }, [activeTripId, isOwner, loadShareLinks]);

  useEffect(() => {
    if (!activeTripId || !session?.user) return undefined;
    const channel = supabase
      .channel(`trip-${activeTripId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trips", filter: `id=eq.${activeTripId}` },
        () => loadTrips(activeTripId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "itinerary_items", filter: `trip_id=eq.${activeTripId}` },
        () => loadTripData(activeTripId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "itinerary_alternatives" },
        () => loadTripData(activeTripId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "budget_items", filter: `trip_id=eq.${activeTripId}` },
        () => loadTripData(activeTripId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "budget_item_participants" },
        () => loadTripData(activeTripId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "actual_expenses", filter: `trip_id=eq.${activeTripId}` },
        () => loadTripData(activeTripId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "actual_expense_participants" },
        () => loadTripData(activeTripId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "accommodations", filter: `trip_id=eq.${activeTripId}` },
        () => loadTripData(activeTripId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "guide_items", filter: `trip_id=eq.${activeTripId}` },
        () => loadTripData(activeTripId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "todo_items", filter: `trip_id=eq.${activeTripId}` },
        () => loadTripData(activeTripId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "luggage_items", filter: `trip_id=eq.${activeTripId}` },
        () => loadTripData(activeTripId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shared_luggage_items", filter: `trip_id=eq.${activeTripId}` },
        () => loadTripData(activeTripId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "attachments", filter: `trip_id=eq.${activeTripId}` },
        () => loadTripData(activeTripId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "itinerary_budget_items" },
        () => loadTripData(activeTripId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pack_items", filter: `trip_id=eq.${activeTripId}` },
        () => loadTripData(activeTripId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trip_members", filter: `trip_id=eq.${activeTripId}` },
        () => {
          loadTrips(activeTripId);
          loadTripData(activeTripId);
        },
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [activeTripId, loadTripData, loadTrips, session?.user]);

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      // Using `origin` avoids accumulating query params (e.g. invite tokens) and
      // prevents redirect loops when using custom domains + OAuth allowlists.
      options: { redirectTo: window.location.origin },
    });
    if (error) setNotice(error.message);
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function createTrip(event) {
    event.preventDefault();
    const user = session.user;
    const safeEndDate =
      tripForm.end_date < tripForm.start_date ? tripForm.start_date : tripForm.end_date;
    const tripId = crypto.randomUUID();
    const { error: tripError } = await supabase.from("trips").insert({
      id: tripId,
      title: tripForm.title.trim(),
      name: tripForm.title.trim(),
      destination: tripForm.destination.trim(),
      start_date: tripForm.start_date,
      end_date: safeEndDate,
      status: "planning",
      owner_id: user.id,
    });

    if (tripError) {
      setNotice(tripError.message);
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
      setNotice(memberError.message);
      return;
    }

    const packRows = defaultPackItems.map((title) => ({ trip_id: tripId, title }));
    await supabase.from("pack_items").insert(packRows);

    setIsTripDialogOpen(false);
    setTripForm({
      title: "京都五日散策",
      destination: "京都, 日本",
      start_date: todayInput(),
      end_date: todayInput(2),
    });
    await loadTrips(tripId);
  }

  async function updateTrip(patch) {
    if (!activeTrip || !isOwner) return;
    const nextPatch = { ...patch };
    if (Object.prototype.hasOwnProperty.call(nextPatch, "title")) {
      nextPatch.name = nextPatch.title;
    }
    if (nextPatch.start_date && activeTrip.end_date < nextPatch.start_date) {
      nextPatch.end_date = nextPatch.start_date;
    }
    if (nextPatch.end_date && nextPatch.end_date < activeTrip.start_date) {
      nextPatch.start_date = nextPatch.end_date;
    }
    const { error } = await supabase.from("trips").update(nextPatch).eq("id", activeTrip.id);
    if (error) setNotice(error.message);
    else await loadTrips(activeTrip.id);
  }

  async function deleteTrip() {
    if (!activeTrip || !isOwner) return;
    const ok = window.confirm(`刪除「${activeTrip.title}」？`);
    if (!ok) return;
    const { error } = await supabase.from("trips").delete().eq("id", activeTrip.id);
    if (error) setNotice(error.message);
    else await loadTrips();
  }

  async function saveItem(payload, editingId) {
    if (!activeTrip || !canEdit) return;
    if (editingId) {
      const { error } = await supabase
        .from("itinerary_items")
        .update(normalizeItemPayload(payload))
        .eq("id", editingId);
      if (error) setNotice(error.message);
      else await loadTripData(activeTrip.id);
      return;
    }

    const { error } = await supabase.from("itinerary_items").insert({
      ...normalizeItemPayload(payload),
      trip_id: activeTrip.id,
      day_index: activeDay,
      date: days[activeDay] ? dateToInputValue(days[activeDay]) : null,
      sort_order: dayItems.length,
    });
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function saveAlternative(itemId, payload, editingId) {
    if (!activeTrip || !canEdit) return;
    const nextPayload = {
      title: payload.title.trim(),
      location_name: payload.location_name.trim() || null,
      address: payload.address.trim() || null,
      map_url: payload.map_url.trim() || null,
      description: payload.description.trim() || null,
      transportation_note: payload.transportation_note.trim() || null,
    };

    if (editingId) {
      const { error } = await supabase.from("itinerary_alternatives").update(nextPayload).eq("id", editingId);
      if (error) setNotice(error.message);
      else await loadTripData(activeTrip.id);
      return;
    }

    const { error } = await supabase.from("itinerary_alternatives").insert({
      ...nextPayload,
      itinerary_item_id: itemId,
    });
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function deleteAlternative(alternativeId) {
    if (!activeTrip || !canEdit) return;
    const { error } = await supabase.from("itinerary_alternatives").delete().eq("id", alternativeId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function applyAlternative(item, alternative) {
    if (!activeTrip || !canEdit) return;
    const { error } = await supabase
      .from("itinerary_items")
      .update(
        normalizeItemPayload({
          ...item,
          title: alternative.title,
          location: alternative.location_name || "",
          location_name: alternative.location_name || "",
          address: alternative.address || "",
          map_url: alternative.map_url || "",
          note: alternative.description || "",
          description: alternative.description || "",
          transportation_note: alternative.transportation_note || "",
          cost: item.cost || 0,
        }),
      )
      .eq("id", item.id);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function saveBudget(payload, editingId) {
    if (!activeTrip || !canEdit) return;
    const amount = Number(payload.amount || 0);
    const exchangeRate = payload.currency === "TWD" ? 1 : Number(payload.exchange_rate || 1);
    const twdAmount = Math.round(amount * exchangeRate);
    const participantIds = payload.participantIds?.length
      ? payload.participantIds
      : members.filter((member) => member.status === "approved").map((member) => member.user_id);
    const budgetPayload = {
      trip_id: activeTrip.id,
      category: payload.category.trim() || "其他",
      subcategory: payload.subcategory.trim() || null,
      title: payload.title.trim(),
      amount,
      currency: payload.currency.trim() || "TWD",
      exchange_rate: payload.currency === "TWD" ? null : exchangeRate,
      twd_amount: twdAmount,
      payer_id: payload.payer_id || null,
      split_type: "equal",
      is_fixed: Boolean(payload.is_fixed),
      note: payload.note.trim() || null,
    };

    const result = editingId
      ? await supabase.from("budget_items").update(budgetPayload).eq("id", editingId).select("id").single()
      : await supabase.from("budget_items").insert(budgetPayload).select("id").single();

    if (result.error) {
      setNotice(result.error.message);
      return;
    }

    const budgetId = result.data.id;
    await Promise.all([
      supabase.from("budget_item_participants").delete().eq("budget_item_id", budgetId),
      supabase.from("itinerary_budget_items").delete().eq("budget_item_id", budgetId),
    ]);

    const participantRows = participantIds.map((userId) => ({ budget_item_id: budgetId, user_id: userId }));
    const linkRows = (payload.linkedItemIds || []).map((itemId) => ({
      budget_item_id: budgetId,
      itinerary_item_id: itemId,
    }));
    const [participantsResult, linksResult] = await Promise.all([
      participantRows.length
        ? supabase.from("budget_item_participants").insert(participantRows)
        : Promise.resolve({ error: null }),
      linkRows.length ? supabase.from("itinerary_budget_items").insert(linkRows) : Promise.resolve({ error: null }),
    ]);
    const error = participantsResult.error || linksResult.error;
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function deleteBudget(budgetId) {
    if (!activeTrip || !canEdit) return;
    const { error } = await supabase.from("budget_items").delete().eq("id", budgetId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function saveActualExpense(payload, editingId) {
    if (!activeTrip || !canEdit) return;
    const amount = Number(payload.amount || 0);
    const exchangeRate = payload.currency === "TWD" ? 1 : Number(payload.exchange_rate || 1);
    const twdAmount = Math.round(amount * exchangeRate);
    const participantIds = payload.participantIds?.length
      ? payload.participantIds
      : members.filter((member) => member.status === "approved").map((member) => member.user_id);
    const expensePayload = {
      trip_id: activeTrip.id,
      budget_item_id: payload.budget_item_id || null,
      title: payload.title.trim(),
      amount,
      currency: payload.currency.trim() || "TWD",
      exchange_rate: payload.currency === "TWD" ? null : exchangeRate,
      twd_amount: twdAmount,
      payer_id: payload.payer_id || null,
      paid_at: payload.paid_at ? new Date(payload.paid_at).toISOString() : new Date().toISOString(),
      note: payload.note.trim() || null,
    };

    const result = editingId
      ? await supabase.from("actual_expenses").update(expensePayload).eq("id", editingId).select("id").single()
      : await supabase.from("actual_expenses").insert(expensePayload).select("id").single();

    if (result.error) {
      setNotice(result.error.message);
      return;
    }

    const actualExpenseId = result.data.id;
    await supabase.from("actual_expense_participants").delete().eq("actual_expense_id", actualExpenseId);
    const participantRows = participantIds.map((userId) => ({ actual_expense_id: actualExpenseId, user_id: userId }));
    const participantsResult = participantRows.length
      ? await supabase.from("actual_expense_participants").insert(participantRows)
      : { error: null };
    if (participantsResult.error) setNotice(participantsResult.error.message);
    else await loadTripData(activeTrip.id);
  }

  async function convertBudgetToActual(budget) {
    if (!activeTrip || !canEdit) return;
    const participantIds = budgetParticipants
      .filter((participant) => participant.budget_item_id === budget.id)
      .map((participant) => participant.user_id);
    const result = await supabase
      .from("actual_expenses")
      .insert({
        trip_id: activeTrip.id,
        budget_item_id: budget.id,
        title: budget.title,
        amount: budget.amount,
        currency: budget.currency,
        exchange_rate: budget.exchange_rate,
        twd_amount: budget.twd_amount,
        payer_id: budget.payer_id,
        paid_at: new Date().toISOString(),
        note: budget.note,
      })
      .select("id")
      .single();
    if (result.error) {
      setNotice(result.error.message);
      return;
    }
    const actualExpenseId = result.data.id;
    const participantRows = participantIds.map((userId) => ({ actual_expense_id: actualExpenseId, user_id: userId }));
    const [participantsResult, budgetResult] = await Promise.all([
      participantRows.length
        ? supabase.from("actual_expense_participants").insert(participantRows)
        : Promise.resolve({ error: null }),
      supabase
        .from("budget_items")
        .update({ auto_created_actual_expense_id: actualExpenseId })
        .eq("id", budget.id),
    ]);
    const error = participantsResult.error || budgetResult.error;
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function deleteActualExpense(expenseId) {
    if (!activeTrip || !canEdit) return;
    const { error } = await supabase.from("actual_expenses").delete().eq("id", expenseId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function saveAccommodation(payload, editingId) {
    if (!activeTrip || !canEdit) return;
    const safeCheckOut =
      payload.check_out_date && payload.check_out_date < payload.check_in_date
        ? payload.check_in_date
        : payload.check_out_date;
    const nextPayload = {
      trip_id: activeTrip.id,
      name: payload.name.trim(),
      check_in_date: payload.check_in_date || activeTrip.start_date,
      check_out_date: safeCheckOut || payload.check_in_date || activeTrip.start_date,
      check_in_time: payload.check_in_time || null,
      check_out_time: payload.check_out_time || null,
      address: payload.address.trim() || null,
      map_url: payload.map_url.trim() || null,
      booking_code: payload.booking_code.trim() || null,
      payment_status: payload.payment_status || "unpaid",
      budget_item_id: payload.budget_item_id || null,
      custom_notes: payload.custom_notes.trim() || null,
    };
    const result = editingId
      ? await supabase.from("accommodations").update(nextPayload).eq("id", editingId)
      : await supabase.from("accommodations").insert(nextPayload);
    if (result.error) setNotice(result.error.message);
    else await loadTripData(activeTrip.id);
  }

  async function deleteAccommodation(accommodationId) {
    if (!activeTrip || !canEdit) return;
    const { error } = await supabase.from("accommodations").delete().eq("id", accommodationId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function saveGuide(payload, editingId) {
    if (!activeTrip || !canEdit) return;
    const nextPayload = {
      trip_id: activeTrip.id,
      title: payload.title.trim(),
      description: payload.description.trim() || null,
      url: payload.url.trim() || null,
    };
    const result = editingId
      ? await supabase.from("guide_items").update(nextPayload).eq("id", editingId)
      : await supabase.from("guide_items").insert(nextPayload);
    if (result.error) setNotice(result.error.message);
    else await loadTripData(activeTrip.id);
  }

  async function deleteGuide(guideId) {
    if (!activeTrip || !canEdit) return;
    const { error } = await supabase.from("guide_items").delete().eq("id", guideId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function saveTodo(payload, editingId) {
    if (!activeTrip || !canEdit) return;
    const nextPayload = {
      trip_id: activeTrip.id,
      title: payload.title.trim(),
      description: payload.description.trim() || null,
      due_date: payload.due_date || null,
      assignee_id: payload.assignee_id || null,
      guide_id: payload.guide_id || null,
    };
    const result = editingId
      ? await supabase.from("todo_items").update(nextPayload).eq("id", editingId)
      : await supabase.from("todo_items").insert(nextPayload);
    if (result.error) setNotice(result.error.message);
    else await loadTripData(activeTrip.id);
  }

  async function toggleTodo(todo) {
    if (!canEdit) return;
    const { error } = await supabase.from("todo_items").update({ completed: !todo.completed }).eq("id", todo.id);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function deleteTodo(todoId) {
    if (!activeTrip || !canEdit) return;
    const { error } = await supabase.from("todo_items").delete().eq("id", todoId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function saveLuggageItem(payload, editingId) {
    if (!activeTrip || !session?.user) return;
    const nextPayload = {
      trip_id: activeTrip.id,
      owner_id: session.user.id,
      title: payload.title.trim(),
      category: payload.category.trim() || null,
      is_shared_assigned_item: false,
    };
    const result = editingId
      ? await supabase.from("luggage_items").update(nextPayload).eq("id", editingId)
      : await supabase.from("luggage_items").insert(nextPayload);
    if (result.error) setNotice(result.error.message);
    else await loadTripData(activeTrip.id);
  }

  async function toggleLuggageItem(item) {
    if (!session?.user) return;
    const { error } = await supabase.from("luggage_items").update({ packed: !item.packed }).eq("id", item.id);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function deleteLuggageItem(itemId) {
    if (!session?.user) return;
    const { error } = await supabase.from("luggage_items").delete().eq("id", itemId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function saveSharedLuggageItem(payload, editingId) {
    if (!activeTrip || !canEdit) return;
    const nextPayload = {
      trip_id: activeTrip.id,
      title: payload.title.trim(),
      category: payload.category.trim() || null,
      assigned_to: payload.assigned_to || null,
    };
    const result = editingId
      ? await supabase.from("shared_luggage_items").update(nextPayload).eq("id", editingId)
      : await supabase.from("shared_luggage_items").insert(nextPayload);
    if (result.error) setNotice(result.error.message);
    else await loadTripData(activeTrip.id);
  }

  async function updateSharedLuggageItem(itemId, patch) {
    if (!activeTrip || !session?.user) return;
    const { error } = await supabase.from("shared_luggage_items").update(patch).eq("id", itemId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function deleteSharedLuggageItem(itemId) {
    if (!canEdit) return;
    const { error } = await supabase.from("shared_luggage_items").delete().eq("id", itemId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function uploadAttachment(targetType, targetId, file) {
    if (!activeTrip || !canEdit || !file) return;
    if (file.size > 10 * 1024 * 1024) {
      setNotice("附件大小需小於 10MB");
      return;
    }
    const fileName = safeFileName(file.name) || `attachment-${Date.now()}`;
    const path = `trips/${activeTrip.id}/attachments/${targetType}/${targetId}/${Date.now()}-${fileName}`;
    const uploadResult = await supabase.storage.from(attachmentBucket).upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (uploadResult.error) {
      setNotice(uploadResult.error.message);
      return;
    }
    const { error } = await supabase.from("attachments").insert({
      trip_id: activeTrip.id,
      target_type: targetType,
      target_id: targetId,
      file_name: file.name,
      file_url: path,
      file_type: file.type || null,
      file_size: file.size,
      uploaded_by: session.user.id,
    });
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function openAttachment(attachment) {
    const { data, error } = await supabase.storage.from(attachmentBucket).createSignedUrl(attachment.file_url, 600);
    if (error) {
      setNotice(error.message);
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function deleteAttachment(attachment) {
    if (!activeTrip || !canEdit) return;
    const storageResult = await supabase.storage.from(attachmentBucket).remove([attachment.file_url]);
    if (storageResult.error) {
      setNotice(storageResult.error.message);
      return;
    }
    const { error } = await supabase.from("attachments").delete().eq("id", attachment.id);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function deleteItem(itemId) {
    if (!canEdit) return;
    const { error } = await supabase.from("itinerary_items").delete().eq("id", itemId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function reorderItem(draggedId, targetId) {
    if (!canEdit || draggedId === targetId) return;
    const nextItems = [...dayItems];
    const from = nextItems.findIndex((item) => item.id === draggedId);
    const to = nextItems.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    const [dragged] = nextItems.splice(from, 1);
    nextItems.splice(to, 0, dragged);
    const updates = nextItems.map((item, index) =>
      supabase.from("itinerary_items").update({ sort_order: index }).eq("id", item.id),
    );
    const results = await Promise.all(updates);
    const error = results.find((result) => result.error)?.error;
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function addPackItem(title) {
    if (!activeTrip || !canEdit || !title.trim()) return;
    const { error } = await supabase
      .from("pack_items")
      .insert({ trip_id: activeTrip.id, title: title.trim() });
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function togglePackItem(item) {
    if (!canEdit) return;
    const { error } = await supabase
      .from("pack_items")
      .update({ done: !item.done })
      .eq("id", item.id);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function deletePackItem(itemId) {
    if (!canEdit) return;
    const { error } = await supabase.from("pack_items").delete().eq("id", itemId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function approveMember(memberId) {
    if (!isOwner) return;
    const { error } = await supabase
      .from("trip_members")
      .update({ status: "approved" })
      .eq("id", memberId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function rejectMember(memberId) {
    if (!isOwner) return;
    const { error } = await supabase.from("trip_members").delete().eq("id", memberId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

function exportTrip() {
    if (!activeTrip) return;
    const payload = {
      ...activeTrip,
      itinerary_items: items,
      pack_items: packItems,
      members,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activeTrip.title || "trip"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!hasSupabaseConfig) {
    return (
      <Shell>
        <ConfigMissing />
      </Shell>
    );
  }

  if (shareTokenFromUrl()) {
    return (
      <Shell>
        <ShareView error={shareError} loading={shareLoading} snapshot={shareSnapshot} />
      </Shell>
    );
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
        <LoginView onSignIn={signInWithGoogle} notice={notice} />
      </Shell>
    );
  }

  return (
    <Shell collapsed={isSidebarCollapsed}>
      <aside className={`sidebar${isSidebarCollapsed ? " collapsed" : ""}`}>
        <div className="brand">
          <div className="brand-mark">TP</div>
          <div className="brand-copy">
            <h1>旅程規劃室</h1>
            <p>{trips.length} 個旅程</p>
          </div>
          <button
            className="mini-button sidebar-toggle"
            type="button"
            title={isSidebarCollapsed ? "展開側欄" : "收合側欄"}
            onClick={() => setIsSidebarCollapsed((value) => !value)}
          >
            {isSidebarCollapsed ? ">" : "<"}
          </button>
        </div>
        <button className="primary-button create-trip-button" type="button" onClick={() => setIsTripDialogOpen(true)}>
          <span aria-hidden="true">+</span>
          新增旅程
        </button>
        <nav className="section-nav" aria-label="功能導覽">
          {desktopNavItems.map((item) => (
            <button
              className={`section-nav-button${activeSection === item.id ? " active" : ""}`}
              key={item.id}
              type="button"
              title={item.label}
              onClick={() => setActiveSection(item.id)}
            >
              <span className="section-nav-icon" aria-hidden="true">
                {item.shortLabel}
              </span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>
        <TripList trips={trips} activeTripId={activeTripId} onSelect={setActiveTripId} />
        <div className="user-box">
          <strong className="nav-label">{session.user.user_metadata?.full_name || session.user.email}</strong>
          <button className="ghost-button" type="button" onClick={signOut}>
            登出
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Collaborative Travel Planner</p>
            <h2>{activeTrip?.title || "選擇或建立旅程"}</h2>
          </div>
          <div className="topbar-actions">
            <button className="ghost-button" type="button" disabled={!activeTrip} onClick={exportTrip}>
              匯出 JSON
            </button>
            <button
              className="ghost-button"
              type="button"
              disabled={!isOwner}
              onClick={() => setIsInviteDialogOpen(true)}
            >
              邀請朋友
            </button>
            <button
              className="ghost-button"
              type="button"
              disabled={!isOwner}
              onClick={() => setIsShareDialogOpen(true)}
            >
              唯讀分享
            </button>
            <button className="ghost-button danger" type="button" disabled={!isOwner} onClick={deleteTrip}>
              刪除旅程
            </button>
          </div>
        </header>

        {notice ? (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice("")}>
              X
            </button>
          </div>
        ) : null}

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
            budgetItems={budgetItems}
            budgetParticipants={budgetParticipants}
            canEdit={canEdit}
            dayItems={dayItems}
            days={days}
            isOwner={isOwner}
            isPending={isPending}
            items={items}
            itineraryBudgetLinks={itineraryBudgetLinks}
            guideItems={guideItems}
            currentUserId={session.user.id}
            luggageItems={luggageItems}
            members={members}
            packItems={packItems}
            sharedLuggageItems={sharedLuggageItems}
            todayDayIndex={todayDayIndex}
            todayItems={todayItems}
            todoItems={todoItems}
            onActiveDay={setActiveDay}
            onAddPackItem={addPackItem}
            onApplyAlternative={applyAlternative}
            onConvertBudgetToActual={convertBudgetToActual}
            onApproveMember={approveMember}
            onDeleteAlternative={deleteAlternative}
            onDeleteActualExpense={deleteActualExpense}
            onDeleteAccommodation={deleteAccommodation}
            onDeleteAttachment={deleteAttachment}
            onDeleteBudget={deleteBudget}
            onDeleteGuide={deleteGuide}
            onDeleteItem={deleteItem}
            onDeleteLuggageItem={deleteLuggageItem}
            onDeletePackItem={deletePackItem}
            onDeleteSharedLuggageItem={deleteSharedLuggageItem}
            onDeleteTodo={deleteTodo}
            onRejectMember={rejectMember}
            onReorderItem={reorderItem}
            onSaveAlternative={saveAlternative}
            onSaveActualExpense={saveActualExpense}
            onSaveAccommodation={saveAccommodation}
            onSaveBudget={saveBudget}
            onSaveGuide={saveGuide}
            onSaveItem={saveItem}
            onSaveLuggageItem={saveLuggageItem}
            onSaveSharedLuggageItem={saveSharedLuggageItem}
            onSaveTodo={saveTodo}
            onSectionChange={setActiveSection}
            onToggleLuggageItem={toggleLuggageItem}
            onToggleTodo={toggleTodo}
            onTogglePackItem={togglePackItem}
            onUpdateSharedLuggageItem={updateSharedLuggageItem}
            onUpdateTrip={updateTrip}
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
            onClick={() => setActiveSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {isTripDialogOpen ? (
        <TripDialog
          form={tripForm}
          onChange={setTripForm}
          onClose={() => setIsTripDialogOpen(false)}
          onSubmit={createTrip}
        />
      ) : null}

      {isInviteDialogOpen && activeTrip ? (
        <InviteDialog trip={activeTrip} onClose={() => setIsInviteDialogOpen(false)} />
      ) : null}

      {isShareDialogOpen && activeTrip ? (
        <ShareDialog
          links={shareLinks}
          onClose={() => setIsShareDialogOpen(false)}
          onRefresh={() => loadShareLinks(activeTrip.id)}
          trip={activeTrip}
        />
      ) : null}
    </Shell>
  );
}

function normalizeItemPayload(payload) {
  const locationName = payload.location_name || payload.location;
  const description = payload.description || payload.note;
  return {
    ...payload,
    location: locationName,
    location_name: locationName,
    note: description,
    description,
    start_time: payload.start_time || null,
    end_time: payload.end_time || null,
    address: payload.address || null,
    map_url: payload.map_url || null,
    transportation_note: payload.transportation_note || null,
  };
}

function Shell({ children, collapsed = false }) {
  return <div className={`app-shell${collapsed ? " sidebar-collapsed" : ""}`}>{children}</div>;
}

function ConfigMissing() {
  return (
    <section className="login-view">
      <div className="login-panel">
        <p className="eyebrow">Setup Required</p>
        <h1>需要 Supabase 設定</h1>
        <p>
          請複製 <code>.env.example</code> 為 <code>.env</code>，填入
          <code> VITE_SUPABASE_URL</code> 與 <code> VITE_SUPABASE_ANON_KEY</code>。
        </p>
      </div>
    </section>
  );
}

function LoginView({ onSignIn, notice }) {
  return (
    <section className="login-view">
      <div className="login-panel">
        <p className="eyebrow">Travel Planner</p>
        <h1>一起把旅程排好</h1>
        <p>使用 Google 登入後，就能建立旅程、邀請朋友、等待擁有者核准並即時共同編輯。</p>
        {notice ? <div className="notice">{notice}</div> : null}
        <button className="primary-button" type="button" onClick={onSignIn}>
          使用 Google 登入
        </button>
      </div>
    </section>
  );
}

function TripList({ trips, activeTripId, onSelect }) {
  return (
    <div className="trip-list" aria-label="旅程列表">
      {trips.map((trip) => (
        <button
          className={`trip-card${trip.id === activeTripId ? " active" : ""}`}
          key={trip.id}
          type="button"
          onClick={() => onSelect(trip.id)}
        >
          <strong>{trip.title}</strong>
          <span>
            {trip.destination} · {trip.start_date}
          </span>
          {trip.membership.status === "pending" ? <em>等待核准</em> : null}
        </button>
      ))}
    </div>
  );
}

function EmptyState({ onCreate }) {
  return (
    <section className="empty-state">
      <div className="empty-visual" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <h2>開始安排下一趟旅程</h2>
      <p>建立旅程後，就能邀請朋友加入，並一起編輯每天的景點、餐廳、交通、住宿和預算。</p>
      <button className="primary-button compact" type="button" onClick={onCreate}>
        建立第一個旅程
      </button>
    </section>
  );
}

function TripWorkspace(props) {
  const {
    activeTrip,
    activeDay,
    activeSection,
    actualExpenses,
    actualParticipants,
    accommodations,
    alternatives,
    attachments,
    budgetItems,
    budgetParticipants,
    canEdit,
    dayItems,
    days,
    isOwner,
    isPending,
    items,
    itineraryBudgetLinks,
    guideItems,
    currentUserId,
    luggageItems,
    members,
    packItems,
    sharedLuggageItems,
    todayDayIndex,
    todayItems,
    todoItems,
    onActiveDay,
    onAddPackItem,
    onApplyAlternative,
    onConvertBudgetToActual,
    onApproveMember,
    onDeleteAlternative,
    onDeleteActualExpense,
    onDeleteAccommodation,
    onDeleteAttachment,
    onDeleteBudget,
    onDeleteGuide,
    onDeleteItem,
    onDeleteLuggageItem,
    onDeletePackItem,
    onDeleteSharedLuggageItem,
    onDeleteTodo,
    onRejectMember,
    onReorderItem,
    onSaveAlternative,
    onSaveActualExpense,
    onSaveAccommodation,
    onSaveBudget,
    onSaveGuide,
    onSaveItem,
    onSaveLuggageItem,
    onSaveSharedLuggageItem,
    onSaveTodo,
    onSectionChange,
    onToggleLuggageItem,
    onToggleTodo,
    onTogglePackItem,
    onUpdateSharedLuggageItem,
    onUpdateTrip,
    onOpenAttachment,
    onUploadAttachment,
  } = props;
  const isTodayMode = activeSection === "today";
  const isBudgetMode = activeSection === "budget";
  const isAccommodationMode = activeSection === "accommodation";
  const isTodoMode = activeSection === "todo";
  const isLuggageMode = activeSection === "luggage";
  const isSettlementMode = activeSection === "settlement";
  const [focusedItemId, setFocusedItemId] = useState(null);
  const alternativesByItem = useMemo(() => {
    const next = {};
    alternatives.forEach((alternative) => {
      next[alternative.itinerary_item_id] = [...(next[alternative.itinerary_item_id] || []), alternative];
    });
    return next;
  }, [alternatives]);
  const budgetsByItem = useMemo(() => {
    const byId = new Map(budgetItems.map((budget) => [budget.id, budget]));
    const next = {};
    itineraryBudgetLinks.forEach((link) => {
      const budget = byId.get(link.budget_item_id);
      if (!budget) return;
      next[link.itinerary_item_id] = [...(next[link.itinerary_item_id] || []), budget];
    });
    return next;
  }, [budgetItems, itineraryBudgetLinks]);

  return (
    <section className="trip-editor">
      {isPending ? (
        <div className="pending-banner">你已送出加入申請，旅程擁有者核准後即可共同編輯。</div>
      ) : null}

      {isTodayMode ? (
        <TodayMode
          canEdit={canEdit}
          dayIndex={todayDayIndex}
          days={days}
          items={todayItems}
          packItems={packItems}
          trip={activeTrip}
          onGoBudget={() => onSectionChange("budget")}
          onGoTimeline={() => {
            onActiveDay(todayDayIndex);
            onSectionChange("timeline");
          }}
        />
      ) : null}

      <div
        className={`field-group trip-fields${
          isTodayMode || isBudgetMode || isAccommodationMode || isTodoMode || isLuggageMode || isSettlementMode
            ? " hidden-section"
            : ""
        }`}
      >
        <label>
          旅程名稱
          <input
            key={`${activeTrip.id}-${activeTrip.updated_at}-title`}
            disabled={!isOwner}
            defaultValue={activeTrip.title}
            onBlur={(event) => onUpdateTrip({ title: event.target.value })}
          />
        </label>
        <label>
          目的地
          <input
            key={`${activeTrip.id}-${activeTrip.updated_at}-destination`}
            disabled={!isOwner}
            defaultValue={activeTrip.destination}
            onBlur={(event) => onUpdateTrip({ destination: event.target.value })}
          />
        </label>
        <label>
          開始日期
          <input
            disabled={!isOwner}
            type="date"
            value={activeTrip.start_date}
            onChange={(event) => onUpdateTrip({ start_date: event.target.value })}
          />
        </label>
        <label>
          結束日期
          <input
            disabled={!isOwner}
            type="date"
            value={activeTrip.end_date}
            onChange={(event) => onUpdateTrip({ end_date: event.target.value })}
          />
        </label>
      </div>

      {isTodayMode || isBudgetMode || isAccommodationMode || isTodoMode || isLuggageMode || isSettlementMode ? null : (
        <DayTabs activeDay={activeDay} days={days} onActiveDay={onActiveDay} />
      )}

      {isBudgetMode ? (
        <BudgetPanel
          budgetItems={budgetItems}
          budgetParticipants={budgetParticipants}
          canEdit={canEdit}
          actualExpenses={actualExpenses}
          actualParticipants={actualParticipants}
          attachments={attachments}
          itineraryBudgetLinks={itineraryBudgetLinks}
          items={items}
          members={members}
          onConvertToActual={onConvertBudgetToActual}
          onDeleteActual={onDeleteActualExpense}
          onDeleteAttachment={onDeleteAttachment}
          onDelete={onDeleteBudget}
          onOpenAttachment={onOpenAttachment}
          onSaveActual={onSaveActualExpense}
          onSave={onSaveBudget}
          onUploadAttachment={onUploadAttachment}
        />
      ) : null}

      {isAccommodationMode ? (
        <AccommodationPanel
          accommodations={accommodations}
          attachments={attachments}
          budgetItems={budgetItems}
          canEdit={canEdit}
          trip={activeTrip}
          onDeleteAttachment={onDeleteAttachment}
          onDelete={onDeleteAccommodation}
          onOpenAttachment={onOpenAttachment}
          onSave={onSaveAccommodation}
          onUploadAttachment={onUploadAttachment}
        />
      ) : null}

      {isTodoMode ? (
        <TodoGuidePanel
          canEdit={canEdit}
          guideItems={guideItems}
          members={members}
          todoItems={todoItems}
          onDeleteGuide={onDeleteGuide}
          onDeleteTodo={onDeleteTodo}
          onSaveGuide={onSaveGuide}
          onSaveTodo={onSaveTodo}
          onToggleTodo={onToggleTodo}
        />
      ) : null}

      {isLuggageMode ? (
        <LuggagePanel
          canEdit={canEdit}
          currentUserId={currentUserId}
          isOwner={isOwner}
          luggageItems={luggageItems}
          members={members}
          sharedLuggageItems={sharedLuggageItems}
          onDeletePersonal={onDeleteLuggageItem}
          onDeleteShared={onDeleteSharedLuggageItem}
          onSavePersonal={onSaveLuggageItem}
          onSaveShared={onSaveSharedLuggageItem}
          onTogglePersonal={onToggleLuggageItem}
          onUpdateShared={onUpdateSharedLuggageItem}
        />
      ) : null}

      {isSettlementMode ? (
        <SettlementPanel
          actualExpenses={actualExpenses}
          actualParticipants={actualParticipants}
          budgetItems={budgetItems}
          members={members}
        />
      ) : null}

      <div
        className={`content-grid${
          isTodayMode || isBudgetMode || isAccommodationMode || isTodoMode || isLuggageMode || isSettlementMode
            ? " hidden-section"
            : ""
        }`}
      >
        <section className="panel itinerary-panel">
          <ItineraryTimeline
                activeDay={activeDay}
                alternativesByItem={alternativesByItem}
                budgetsByItem={budgetsByItem}
                canEdit={canEdit}
                dayItems={dayItems}
                dayLabel={days[activeDay] ? `Day ${activeDay + 1} · ${formatDate(days[activeDay])}` : ""}
                focusedItemId={focusedItemId}
                onApplyAlternative={onApplyAlternative}
                onDeleteAlternative={onDeleteAlternative}
                onDeleteItem={onDeleteItem}
                onFocusItem={setFocusedItemId}
                onReorderItem={onReorderItem}
                onSaveAlternative={onSaveAlternative}
                onSaveItem={onSaveItem}
              />
            </section>

            <aside className="side-panels">
              <RoutePanel dayItems={dayItems} focusedItemId={focusedItemId} onFocusItem={setFocusedItemId} />
          <BudgetSummaryPanel budgetItems={budgetItems} items={items} />
          <PackList
            canEdit={canEdit}
            items={packItems}
            onAdd={onAddPackItem}
            onDelete={onDeletePackItem}
            onToggle={onTogglePackItem}
          />
          <MembersPanel
            isOwner={isOwner}
            members={members}
            onApprove={onApproveMember}
            onReject={onRejectMember}
          />
        </aside>
      </div>
    </section>
  );
}

function TodayMode({ canEdit, dayIndex, days, items, packItems, trip, onGoBudget, onGoTimeline }) {
  const day = days[dayIndex];
  const currentTime = currentTimeInput();
  const isCalendarToday = day ? dateToInputValue(day) === todayInput() : false;
  const nextStop =
    items.find((item) => !isCalendarToday || !item.start_time || item.start_time >= currentTime) || items[0] || null;
  const hotelItem = [...items].reverse().find((item) => item.type === "hotel");
  const todayBudget = items.reduce((sum, item) => sum + Number(item.cost || 0), 0);
  const pendingPackItems = packItems.filter((item) => !item.done);
  const packedCount = packItems.length - pendingPackItems.length;

  return (
    <section className="today-mode" aria-label="今日模式">
      <div className="today-hero panel">
        <div>
          <p className="eyebrow">Today</p>
          <h3>{day ? `Day ${dayIndex + 1} · ${formatDate(day)}` : trip.title}</h3>
          <p>{trip.destination || "目的地未設定"}</p>
        </div>
        <button className="primary-button compact" type="button" onClick={onGoTimeline}>
          看時間軸
        </button>
      </div>

      <div className="today-grid">
        <article className="today-card today-card-wide">
          <div className="today-card-heading">
            <span>今日行程</span>
            <strong>{items.length}</strong>
          </div>
          {items.length ? (
            <ol className="today-schedule">
              {items.slice(0, 4).map((item) => (
                <li key={item.id}>
                  <time>{item.start_time || "--:--"}</time>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.location || "地點未設定"}</span>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="today-empty">今天還沒有行程</p>
          )}
        </article>

        <article className="today-card">
          <span>下一站</span>
          <strong>{nextStop?.title || "尚未安排"}</strong>
          <p>{nextStop?.location || nextStop?.start_time || "新增行程後會顯示"}</p>
        </article>

        <article className="today-card">
          <span>今日預算</span>
          <strong>{formatMoney(todayBudget)}</strong>
          <button className="ghost-button compact" disabled={!canEdit} type="button" onClick={onGoBudget}>
            快速記帳
          </button>
        </article>

        <article className="today-card">
          <span>待辦提醒</span>
          <strong>{pendingPackItems.length}</strong>
          <p>{pendingPackItems[0]?.title || "目前沒有提醒"}</p>
        </article>

        <article className="today-card">
          <span>今日住宿</span>
          <strong>{hotelItem?.title || "尚未設定"}</strong>
          <p>{hotelItem?.location || "可在時間軸加入住宿"}</p>
        </article>

        <article className="today-card">
          <span>行李提醒</span>
          <strong>
            {packedCount}/{packItems.length}
          </strong>
          <p>{pendingPackItems[0] ? `未完成：${pendingPackItems[0].title}` : "行李已完成"}</p>
        </article>
      </div>
    </section>
  );
}

function DayTabs({ activeDay, days, onActiveDay }) {
  return (
    <nav className="day-tabs" aria-label="日期切換">
      {days.map((date, index) => (
        <button
          className={`day-tab${index === activeDay ? " active" : ""}`}
          key={date.toISOString()}
          type="button"
          onClick={() => onActiveDay(index)}
        >
          Day {index + 1} {formatDate(date)}
        </button>
      ))}
    </nav>
  );
}

function ItineraryTimeline({
  alternativesByItem,
  budgetsByItem,
  canEdit,
  dayItems,
  dayLabel,
  focusedItemId,
  onApplyAlternative,
  onDeleteAlternative,
  onDeleteItem,
  onFocusItem,
  onReorderItem,
  onSaveAlternative,
  onSaveItem,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyItemForm);
  const [expandedId, setExpandedId] = useState(null);

  function openNewItem() {
    setForm(emptyItemForm);
    setEditingId(null);
    setIsOpen(true);
  }

  function openEditItem(item) {
    setForm({
      type: item.type,
      start_time: item.start_time || "",
      end_time: item.end_time || "",
      title: item.title,
      location: item.location_name || item.location || "",
      location_name: item.location_name || item.location || "",
      address: item.address || "",
      map_url: item.map_url || "",
      note: item.description || item.note || "",
      description: item.description || item.note || "",
      transportation_note: item.transportation_note || "",
      cost: item.cost || 0,
    });
    setEditingId(item.id);
    setIsOpen(true);
  }

  async function submit(event) {
    event.preventDefault();
    await onSaveItem(
      {
        ...form,
        title: form.title.trim(),
        location: (form.location_name || form.location).trim(),
        location_name: (form.location_name || form.location).trim(),
        address: form.address.trim(),
        map_url: form.map_url.trim(),
        note: (form.description || form.note).trim(),
        description: (form.description || form.note).trim(),
        transportation_note: form.transportation_note.trim(),
        cost: Number(form.cost || 0),
      },
      editingId,
    );
    setForm(emptyItemForm);
    setEditingId(null);
    setIsOpen(false);
  }

  return (
    <>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Schedule</p>
          <h3>{dayLabel}</h3>
        </div>
        <button className="icon-button" disabled={!canEdit} type="button" title="新增行程" onClick={openNewItem}>
          +
        </button>
      </div>

      {isOpen ? (
        <form className="item-form" onSubmit={submit}>
          <div className="field-group form-grid">
            <label>
              類型
              <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
                {Object.entries(typeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              開始
              <input
                type="time"
                value={form.start_time}
                onChange={(event) => setForm({ ...form, start_time: event.target.value })}
              />
            </label>
            <label>
              結束
              <input
                type="time"
                value={form.end_time}
                onChange={(event) => setForm({ ...form, end_time: event.target.value })}
              />
            </label>
            <label>
              費用
              <input
                min="0"
                step="1"
                type="number"
                value={form.cost}
                onChange={(event) => setForm({ ...form, cost: event.target.value })}
              />
            </label>
          </div>
          <div className="field-group form-grid wide">
            <label>
              名稱
              <input
                required
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </label>
            <label>
              地點
              <input
                value={form.location_name || form.location}
                onChange={(event) => setForm({ ...form, location: event.target.value, location_name: event.target.value })}
              />
            </label>
          </div>
          <label className="full-label">
            備註
            <textarea
              rows="3"
              value={form.description || form.note}
              onChange={(event) => setForm({ ...form, note: event.target.value, description: event.target.value })}
            />
          </label>
          <div className="field-group form-grid wide">
            <label>
              地址
              <input
                value={form.address}
                onChange={(event) => setForm({ ...form, address: event.target.value })}
              />
            </label>
            <label>
              Map URL
              <input
                placeholder="https://maps.google.com/..."
                value={form.map_url}
                onChange={(event) => setForm({ ...form, map_url: event.target.value })}
              />
            </label>
          </div>
          <label className="full-label">
            交通備註
            <textarea
              rows="2"
              value={form.transportation_note}
              onChange={(event) => setForm({ ...form, transportation_note: event.target.value })}
            />
          </label>
          <div className="form-actions">
            <button className="ghost-button" type="button" onClick={() => setIsOpen(false)}>
              取消
            </button>
            <button className="primary-button compact" type="submit">
              儲存
            </button>
          </div>
        </form>
      ) : null}

      <div className="timeline">
        {dayItems.length ? (
          dayItems.map((item) => (
            <article
              className={`timeline-item${focusedItemId === item.id ? " focused" : ""}`}
              key={item.id}
              onClick={() => onFocusItem(item.id)}
            >
              <div className="time-block">
                {item.start_time || "--:--"}
                <br />
                {item.end_time || ""}
              </div>
              <div className="item-main">
                <h4>{item.title}</h4>
                <p>{item.location || "未設定地點"}</p>
                {item.note ? <p>{item.note}</p> : null}
                <div className="item-meta">
                  <span
                    className="pill"
                    style={{ background: `${typeColors[item.type]}22`, color: typeColors[item.type] }}
                  >
                    {typeLabels[item.type]}
                  </span>
                  <span className="pill">
                    {formatMoney(
                      (budgetsByItem[item.id] || []).reduce(
                        (sum, budget) => sum + Number(budget.twd_amount || budget.amount || 0),
                        0,
                      ) || item.cost,
                    )}
                  </span>
                  {(alternativesByItem[item.id] || []).length ? (
                    <span className="pill">{(alternativesByItem[item.id] || []).length} 個備案</span>
                  ) : null}
                </div>
                <button
                  className="ghost-button compact detail-toggle"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setExpandedId(expandedId === item.id ? null : item.id);
                    onFocusItem(item.id);
                  }}
                >
                  {expandedId === item.id ? "收合" : "詳細"}
                </button>
                {expandedId === item.id ? (
                  <div className="item-details">
                    {item.description || item.note ? <p>{item.description || item.note}</p> : null}
                    {item.address ? <p>地址：{item.address}</p> : null}
                    {item.transportation_note ? <p>交通：{item.transportation_note}</p> : null}
                    {item.map_url ? (
                      <a href={item.map_url} rel="noreferrer" target="_blank">
                        開啟地圖
                      </a>
                    ) : null}
                    <div className="linked-budget-list">
                      <strong>連動預算</strong>
                      {(budgetsByItem[item.id] || []).length ? (
                        (budgetsByItem[item.id] || []).map((budget) => (
                          <span className="pill" key={budget.id}>
                            {budget.title} · {formatMoney(budget.twd_amount || budget.amount)}
                          </span>
                        ))
                      ) : (
                        <span className="muted-text">尚未連動預算</span>
                      )}
                    </div>
                    <AlternativeList
                      alternatives={alternativesByItem[item.id] || []}
                      canEdit={canEdit}
                      item={item}
                      onApply={onApplyAlternative}
                      onDelete={onDeleteAlternative}
                      onSave={onSaveAlternative}
                    />
                  </div>
                ) : null}
              </div>
              <div className="item-actions">
                <button
                  className="mini-button"
                  disabled={!canEdit}
                  type="button"
                  title="編輯"
                  onClick={() => openEditItem(item)}
                >
                  E
                </button>
                <button
                  className="mini-button"
                  disabled={!canEdit}
                  type="button"
                  title="刪除"
                  onClick={() => onDeleteItem(item.id)}
                >
                  X
                </button>
              </div>
            </article>
          ))
        ) : (
          <div className="timeline-empty">這一天還沒有行程</div>
        )}
      </div>
    </>
  );
}

function AlternativeList({ alternatives, canEdit, item, onApply, onDelete, onSave }) {
  function promptAlternative(alternative = null) {
    const title = window.prompt("備案標題", alternative?.title || "");
    if (!title?.trim()) return;
    const locationName = window.prompt("備案地點", alternative?.location_name || "") || "";
    const mapUrl = window.prompt("Map URL", alternative?.map_url || "") || "";
    onSave(
      item.id,
      {
        title,
        location_name: locationName,
        address: alternative?.address || "",
        map_url: mapUrl,
        description: alternative?.description || "",
        transportation_note: alternative?.transportation_note || "",
      },
      alternative?.id || null,
    );
  }

  return (
    <div className="alternative-list">
      <div className="alternative-heading">
        <strong>備案</strong>
        <button className="mini-button" disabled={!canEdit} type="button" onClick={() => promptAlternative()}>
          +
        </button>
      </div>
      {alternatives.length ? (
        alternatives.map((alternative) => (
          <div className="alternative-row" key={alternative.id}>
            <div>
              <strong>{alternative.title}</strong>
              <span>{alternative.location_name || alternative.address || "地點未設定"}</span>
              {alternative.description ? <p>{alternative.description}</p> : null}
            </div>
            <div className="alternative-actions">
              {alternative.map_url ? (
                <a className="mini-button" href={alternative.map_url} rel="noreferrer" target="_blank">
                  Map
                </a>
              ) : null}
              <button className="mini-button" disabled={!canEdit} type="button" onClick={() => onApply(item, alternative)}>
                用
              </button>
              <button className="mini-button" disabled={!canEdit} type="button" onClick={() => promptAlternative(alternative)}>
                E
              </button>
              <button className="mini-button" disabled={!canEdit} type="button" onClick={() => onDelete(alternative.id)}>
                X
              </button>
            </div>
          </div>
        ))
      ) : (
        <span className="muted-text">尚未建立備案</span>
      )}
    </div>
  );
}

function RoutePanel({ dayItems, focusedItemId, onFocusItem }) {
  const stops = dayItems.filter((item) => item.location_name || item.location || item.title);
  return (
    <section className="panel">
      <div className="panel-heading tight">
        <div>
          <p className="eyebrow">Route</p>
          <h3>路線</h3>
        </div>
      </div>
      <div className="route-map">
        {stops.length ? <div className="route-line" /> : null}
        {stops.length ? (
          stops.map((item, index) => (
            <button
              className={`route-stop${focusedItemId === item.id ? " focused" : ""}`}
              key={item.id}
              type="button"
              onClick={() => onFocusItem(item.id)}
            >
              <span className="route-dot">{index + 1}</span>
              <span className="route-name">{item.location_name || item.location || item.title}</span>
            </button>
          ))
        ) : (
          <div className="timeline-empty">尚無路線</div>
        )}
      </div>
    </section>
  );
}

function BudgetSummaryPanel({ budgetItems, items }) {
  const totals = useMemo(() => {
    const next = {};
    if (budgetItems.length) {
      budgetItems.forEach((item) => {
        next[item.category] = (next[item.category] || 0) + Number(item.twd_amount || 0);
      });
      return next;
    }
    items.forEach((item) => {
      next[typeLabels[item.type] || item.type] = (next[typeLabels[item.type] || item.type] || 0) + Number(item.cost || 0);
    });
    return next;
  }, [budgetItems, items]);
  const total = Object.values(totals).reduce((sum, value) => sum + value, 0);
  const labels = Object.keys(totals);

  return (
    <section className="panel">
      <div className="panel-heading tight">
        <div>
          <p className="eyebrow">Budget</p>
          <h3>預算</h3>
        </div>
      </div>
      <div className="budget-total">{formatMoney(total)}</div>
      <div className="budget-list">
        {labels.length ? (
          labels.map((label) => {
          const amount = totals[label] || 0;
          const percent = total ? Math.round((amount / total) * 100) : 0;
          return (
            <div className="budget-row" key={label}>
              <strong>{label}</strong>
              <div className="budget-bar">
                <span style={{ width: `${percent}%`, background: "var(--mint)" }} />
              </div>
              <span>{formatMoney(amount)}</span>
            </div>
          );
        })
        ) : (
          <span className="muted-text">尚未建立預算</span>
        )}
      </div>
    </section>
  );
}

function BudgetPanel({
  actualExpenses,
  actualParticipants,
  attachments,
  budgetItems,
  budgetParticipants,
  canEdit,
  itineraryBudgetLinks,
  items,
  members,
  onConvertToActual,
  onDelete,
  onDeleteActual,
  onDeleteAttachment,
  onOpenAttachment,
  onSave,
  onSaveActual,
  onUploadAttachment,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyBudgetForm);
  const approvedMembers = members.filter((member) => member.status === "approved");
  const participantsByBudget = useMemo(() => {
    const next = {};
    budgetParticipants.forEach((participant) => {
      next[participant.budget_item_id] = [...(next[participant.budget_item_id] || []), participant.user_id];
    });
    return next;
  }, [budgetParticipants]);
  const linksByBudget = useMemo(() => {
    const next = {};
    itineraryBudgetLinks.forEach((link) => {
      next[link.budget_item_id] = [...(next[link.budget_item_id] || []), link.itinerary_item_id];
    });
    return next;
  }, [itineraryBudgetLinks]);
  const total = budgetItems.reduce((sum, item) => sum + Number(item.twd_amount || 0), 0);
  const categoryTotals = useMemo(() => {
    const next = {};
    budgetItems.forEach((item) => {
      next[item.category] = (next[item.category] || 0) + Number(item.twd_amount || 0);
    });
    return next;
  }, [budgetItems]);

  function openNewBudget() {
    setForm({
      ...emptyBudgetForm,
      participantIds: approvedMembers.map((member) => member.user_id),
    });
    setEditingId(null);
    setIsOpen(true);
  }

  function openEditBudget(item) {
    setForm({
      category: item.category || "其他",
      subcategory: item.subcategory || "",
      title: item.title || "",
      amount: item.amount || 0,
      currency: item.currency || "TWD",
      exchange_rate: item.exchange_rate || 1,
      payer_id: item.payer_id || "",
      is_fixed: Boolean(item.is_fixed),
      note: item.note || "",
      participantIds: participantsByBudget[item.id] || approvedMembers.map((member) => member.user_id),
      linkedItemIds: linksByBudget[item.id] || [],
    });
    setEditingId(item.id);
    setIsOpen(true);
  }

  function toggleListValue(key, value) {
    const current = form[key] || [];
    setForm({
      ...form,
      [key]: current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    });
  }

  async function submit(event) {
    event.preventDefault();
    await onSave(form, editingId);
    setIsOpen(false);
    setEditingId(null);
    setForm(emptyBudgetForm);
  }

  return (
    <section className="panel budget-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Budget</p>
          <h3>預算</h3>
        </div>
        <button className="icon-button" disabled={!canEdit} type="button" title="新增預算" onClick={openNewBudget}>
          +
        </button>
      </div>

      <div className="budget-overview">
        <div>
          <span>總預算</span>
          <strong>{formatMoney(total)}</strong>
        </div>
        {Object.entries(categoryTotals).map(([category, amount]) => (
          <div key={category}>
            <span>{category}</span>
            <strong>{formatMoney(amount)}</strong>
          </div>
        ))}
      </div>

      {isOpen ? (
        <form className="item-form budget-form" onSubmit={submit}>
          <div className="field-group form-grid">
            <label>
              大項
              <input
                required
                value={form.category}
                onChange={(event) => setForm({ ...form, category: event.target.value })}
              />
            </label>
            <label>
              細項
              <input
                value={form.subcategory}
                onChange={(event) => setForm({ ...form, subcategory: event.target.value })}
              />
            </label>
            <label>
              金額
              <input
                min="0"
                step="1"
                type="number"
                value={form.amount}
                onChange={(event) => setForm({ ...form, amount: event.target.value })}
              />
            </label>
            <label>
              幣別
              <input
                value={form.currency}
                onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })}
              />
            </label>
          </div>
          <div className="field-group form-grid wide">
            <label>
              標題
              <input
                required
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </label>
            <label>
              匯率
              <input
                min="0"
                step="0.0001"
                type="number"
                value={form.exchange_rate}
                onChange={(event) => setForm({ ...form, exchange_rate: event.target.value })}
              />
            </label>
          </div>
          <div className="field-group form-grid wide">
            <label>
              付款人
              <select value={form.payer_id} onChange={(event) => setForm({ ...form, payer_id: event.target.value })}>
                <option value="">未指定</option>
                {approvedMembers.map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {member.display_name || member.email || member.user_id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              備註
              <input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
            </label>
          </div>
          <label className="checkbox-label">
            <input
              checked={form.is_fixed}
              type="checkbox"
              onChange={(event) => setForm({ ...form, is_fixed: event.target.checked })}
            />
            固定費用
          </label>

          <div className="budget-picker">
            <strong>分攤成員（equal split）</strong>
            <div>
              {approvedMembers.map((member) => (
                <label className="checkbox-chip" key={member.user_id}>
                  <input
                    checked={form.participantIds.includes(member.user_id)}
                    type="checkbox"
                    onChange={() => toggleListValue("participantIds", member.user_id)}
                  />
                  {member.display_name || member.email || member.user_id}
                </label>
              ))}
            </div>
          </div>

          <div className="budget-picker">
            <strong>連動行程</strong>
            <div>
              {items.map((item) => (
                <label className="checkbox-chip" key={item.id}>
                  <input
                    checked={form.linkedItemIds.includes(item.id)}
                    type="checkbox"
                    onChange={() => toggleListValue("linkedItemIds", item.id)}
                  />
                  {item.title}
                </label>
              ))}
            </div>
          </div>

          <div className="form-actions">
            <button className="ghost-button" type="button" onClick={() => setIsOpen(false)}>
              取消
            </button>
            <button className="primary-button compact" type="submit">
              儲存
            </button>
          </div>
        </form>
      ) : null}

      <div className="budget-cards">
        {budgetItems.length ? (
          budgetItems.map((item) => {
            const participantIds = participantsByBudget[item.id] || [];
            const linkedItemIds = linksByBudget[item.id] || [];
            const participantNames = participantIds
              .map((userId) => approvedMembers.find((member) => member.user_id === userId))
              .filter(Boolean)
              .map((member) => member.display_name || member.email || member.user_id);
            const linkedNames = linkedItemIds
              .map((itemId) => items.find((itineraryItem) => itineraryItem.id === itemId)?.title)
              .filter(Boolean);
            const payer = approvedMembers.find((member) => member.user_id === item.payer_id);
            return (
              <article className="budget-card" key={item.id}>
                <div>
                  <span>
                    {item.category}
                    {item.subcategory ? `｜${item.subcategory}` : ""}
                  </span>
                  <h4>{item.title}</h4>
                </div>
                <strong>
                  {item.currency} {Number(item.amount || 0).toLocaleString("zh-TW")} → {formatMoney(item.twd_amount)}
                </strong>
                <p>付款人：{payer?.display_name || payer?.email || "未指定"}</p>
                <p>分攤：{participantNames.length ? participantNames.join("、") : "未指定"}</p>
                <p>連動行程：{linkedNames.length ? linkedNames.join("、") : "未連動"}</p>
                {item.note ? <p>備註：{item.note}</p> : null}
                <div className="item-meta">
                  <span className="pill">{item.split_type === "equal" ? "均分" : "自訂"}</span>
                  {item.is_fixed ? <span className="pill">固定費用</span> : null}
                  {item.auto_created_actual_expense_id ? <span className="pill">已轉實付</span> : null}
                </div>
                <div className="budget-actions">
                  <button
                    className="ghost-button compact"
                    disabled={!canEdit || Boolean(item.auto_created_actual_expense_id)}
                    type="button"
                    onClick={() => onConvertToActual(item)}
                  >
                    轉實付
                  </button>
                  <button className="mini-button" disabled={!canEdit} type="button" onClick={() => openEditBudget(item)}>
                    E
                  </button>
                  <button className="mini-button" disabled={!canEdit} type="button" onClick={() => onDelete(item.id)}>
                    X
                  </button>
                </div>
              </article>
            );
          })
        ) : (
          <div className="timeline-empty">尚未建立預算</div>
        )}
      </div>

      <ActualExpensePanel
        actualExpenses={actualExpenses}
        actualParticipants={actualParticipants}
        attachments={attachments}
        budgetItems={budgetItems}
        canEdit={canEdit}
        members={members}
        onDeleteAttachment={onDeleteAttachment}
        onDelete={onDeleteActual}
        onOpenAttachment={onOpenAttachment}
        onSave={onSaveActual}
        onUploadAttachment={onUploadAttachment}
      />
    </section>
  );
}

function ActualExpensePanel({
  actualExpenses,
  actualParticipants,
  attachments,
  budgetItems,
  canEdit,
  members,
  onDelete,
  onDeleteAttachment,
  onOpenAttachment,
  onSave,
  onUploadAttachment,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyActualForm);
  const approvedMembers = members.filter((member) => member.status === "approved");
  const participantsByExpense = useMemo(() => {
    const next = {};
    actualParticipants.forEach((participant) => {
      next[participant.actual_expense_id] = [...(next[participant.actual_expense_id] || []), participant.user_id];
    });
    return next;
  }, [actualParticipants]);
  const total = actualExpenses.reduce((sum, expense) => sum + Number(expense.twd_amount || 0), 0);

  function openNewExpense() {
    setForm({
      ...emptyActualForm,
      paid_at: dateTimeLocalInput(),
      participantIds: approvedMembers.map((member) => member.user_id),
    });
    setEditingId(null);
    setIsOpen(true);
  }

  function openEditExpense(expense) {
    const paidAt = expense.paid_at ? dateTimeLocalInput(new Date(expense.paid_at)) : dateTimeLocalInput();
    setForm({
      budget_item_id: expense.budget_item_id || "",
      title: expense.title || "",
      amount: expense.amount || 0,
      currency: expense.currency || "TWD",
      exchange_rate: expense.exchange_rate || 1,
      payer_id: expense.payer_id || "",
      paid_at: paidAt,
      note: expense.note || "",
      participantIds: participantsByExpense[expense.id] || approvedMembers.map((member) => member.user_id),
    });
    setEditingId(expense.id);
    setIsOpen(true);
  }

  function fillFromBudget(budgetId) {
    const budget = budgetItems.find((item) => item.id === budgetId);
    if (!budget) {
      setForm({ ...form, budget_item_id: "" });
      return;
    }
    setForm({
      ...form,
      budget_item_id: budget.id,
      title: form.title || budget.title,
      amount: budget.amount,
      currency: budget.currency,
      exchange_rate: budget.exchange_rate || 1,
      payer_id: form.payer_id || budget.payer_id || "",
      note: form.note || budget.note || "",
    });
  }

  function toggleParticipant(userId) {
    const current = form.participantIds || [];
    setForm({
      ...form,
      participantIds: current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    });
  }

  async function submit(event) {
    event.preventDefault();
    await onSave(form, editingId);
    setIsOpen(false);
    setEditingId(null);
    setForm(emptyActualForm);
  }

  return (
    <section className="actual-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Actual</p>
          <h3>實付</h3>
        </div>
        <button className="icon-button" disabled={!canEdit} type="button" title="新增實付" onClick={openNewExpense}>
          +
        </button>
      </div>

      <div className="budget-overview">
        <div>
          <span>實付總額</span>
          <strong>{formatMoney(total)}</strong>
        </div>
        <div>
          <span>筆數</span>
          <strong>{actualExpenses.length}</strong>
        </div>
      </div>

      {isOpen ? (
        <form className="item-form budget-form" onSubmit={submit}>
          <div className="field-group form-grid wide">
            <label>
              來源預算
              <select value={form.budget_item_id} onChange={(event) => fillFromBudget(event.target.value)}>
                <option value="">直接新增</option>
                {budgetItems.map((budget) => (
                  <option key={budget.id} value={budget.id}>
                    {budget.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              標題
              <input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
            </label>
          </div>
          <div className="field-group form-grid">
            <label>
              金額
              <input
                min="0"
                step="1"
                type="number"
                value={form.amount}
                onChange={(event) => setForm({ ...form, amount: event.target.value })}
              />
            </label>
            <label>
              幣別
              <input
                value={form.currency}
                onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })}
              />
            </label>
            <label>
              匯率
              <input
                min="0"
                step="0.0001"
                type="number"
                value={form.exchange_rate}
                onChange={(event) => setForm({ ...form, exchange_rate: event.target.value })}
              />
            </label>
            <label>
              付款時間
              <input
                type="datetime-local"
                value={form.paid_at}
                onChange={(event) => setForm({ ...form, paid_at: event.target.value })}
              />
            </label>
          </div>
          <div className="field-group form-grid wide">
            <label>
              付款人
              <select value={form.payer_id} onChange={(event) => setForm({ ...form, payer_id: event.target.value })}>
                <option value="">未指定</option>
                {approvedMembers.map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {member.display_name || member.email || member.user_id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              備註
              <input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
            </label>
          </div>
          <div className="budget-picker">
            <strong>分攤成員（equal split）</strong>
            <div>
              {approvedMembers.map((member) => (
                <label className="checkbox-chip" key={member.user_id}>
                  <input
                    checked={form.participantIds.includes(member.user_id)}
                    type="checkbox"
                    onChange={() => toggleParticipant(member.user_id)}
                  />
                  {member.display_name || member.email || member.user_id}
                </label>
              ))}
            </div>
          </div>
          <div className="form-actions">
            <button className="ghost-button" type="button" onClick={() => setIsOpen(false)}>
              取消
            </button>
            <button className="primary-button compact" type="submit">
              儲存
            </button>
          </div>
        </form>
      ) : null}

      <div className="budget-cards">
        {actualExpenses.length ? (
          actualExpenses.map((expense) => {
            const participantIds = participantsByExpense[expense.id] || [];
            const participantNames = participantIds
              .map((userId) => approvedMembers.find((member) => member.user_id === userId))
              .filter(Boolean)
              .map((member) => member.display_name || member.email || member.user_id);
            const payer = approvedMembers.find((member) => member.user_id === expense.payer_id);
            const budget = budgetItems.find((item) => item.id === expense.budget_item_id);
            return (
              <article className="budget-card" key={expense.id}>
                <div>
                  <span>{budget ? `來自預算｜${budget.category}` : "直接新增"}</span>
                  <h4>{expense.title}</h4>
                </div>
                <strong>
                  {expense.currency} {Number(expense.amount || 0).toLocaleString("zh-TW")} →{" "}
                  {formatMoney(expense.twd_amount)}
                </strong>
                <div>
                  <p>付款人：{payer?.display_name || payer?.email || "未指定"}</p>
                  <p>分攤：{participantNames.length ? participantNames.join("、") : "未指定"}</p>
                  <p>付款時間：{expense.paid_at ? new Date(expense.paid_at).toLocaleString("zh-TW") : "未設定"}</p>
                  {expense.note ? <p>備註：{expense.note}</p> : null}
                </div>
                <AttachmentList
                  attachments={attachments.filter(
                    (attachment) => attachment.target_type === "actual_expense" && attachment.target_id === expense.id,
                  )}
                  canEdit={canEdit}
                  targetId={expense.id}
                  targetType="actual_expense"
                  onDelete={onDeleteAttachment}
                  onOpen={onOpenAttachment}
                  onUpload={onUploadAttachment}
                />
                <div className="budget-actions">
                  <button className="mini-button" disabled={!canEdit} type="button" onClick={() => openEditExpense(expense)}>
                    E
                  </button>
                  <button className="mini-button" disabled={!canEdit} type="button" onClick={() => onDelete(expense.id)}>
                    X
                  </button>
                </div>
              </article>
            );
          })
        ) : (
          <div className="timeline-empty">尚未建立實付</div>
        )}
      </div>
    </section>
  );
}

function SettlementPanel({ actualExpenses, actualParticipants, budgetItems, members }) {
  const approvedMembers = members.filter((member) => member.status === "approved");
  const memberById = new Map(approvedMembers.map((member) => [member.user_id, member]));
  const participantsByExpense = useMemo(
    () => buildParticipantsMap(actualParticipants, "actual_expense_id"),
    [actualParticipants],
  );
  const actualBudgetIds = new Set(actualExpenses.map((expense) => expense.budget_item_id).filter(Boolean));
  const pendingBudgetItems = budgetItems.filter((budget) => !actualBudgetIds.has(budget.id));
  const plannedTotal = budgetItems.reduce((sum, item) => sum + Number(item.twd_amount || 0), 0);
  const actualTotal = actualExpenses.reduce((sum, expense) => sum + Number(expense.twd_amount || 0), 0);
  const balances = approvedMembers.map((member) => {
    let shouldPay = 0;
    let paid = 0;
    actualExpenses.forEach((expense) => {
      const amount = Number(expense.twd_amount || 0);
      if (expense.payer_id === member.user_id) paid += amount;
      const participants = participantsByExpense[expense.id]?.length
        ? participantsByExpense[expense.id]
        : approvedMembers.map((entry) => entry.user_id);
      if (participants.includes(member.user_id) && participants.length) {
        shouldPay += amount / participants.length;
      }
    });
    return {
      user_id: member.user_id,
      name: memberName(member),
      shouldPay,
      paid,
      balance: paid - shouldPay,
    };
  });
  const transfers = simplifyTransfers(balances);

  return (
    <section className="panel settlement-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Settlement</p>
          <h3>結算</h3>
        </div>
      </div>

      <div className="budget-overview">
        <div>
          <span>規劃金額</span>
          <strong>{formatMoney(plannedTotal)}</strong>
        </div>
        <div>
          <span>實際金額</span>
          <strong>{formatMoney(actualTotal)}</strong>
        </div>
        <div>
          <span>尚未轉實付</span>
          <strong>{formatMoney(pendingBudgetItems.reduce((sum, item) => sum + Number(item.twd_amount || 0), 0))}</strong>
        </div>
        <div>
          <span>差額</span>
          <strong>{formatMoney(actualTotal - plannedTotal)}</strong>
        </div>
      </div>

      <div className="settlement-grid">
        <section className="settlement-section">
          <div className="panel-heading tight">
            <div>
              <p className="eyebrow">People</p>
              <h3>每人差額</h3>
            </div>
          </div>
          <div className="settlement-table">
            <div className="settlement-row settlement-header">
              <span>成員</span>
              <span>應付</span>
              <span>已付</span>
              <span>差額</span>
            </div>
            {balances.map((entry) => (
              <div className="settlement-row" key={entry.user_id}>
                <strong>{entry.name}</strong>
                <span>{formatMoney(entry.shouldPay)}</span>
                <span>{formatMoney(entry.paid)}</span>
                <span className={entry.balance >= 0 ? "positive-balance" : "negative-balance"}>
                  {formatMoney(entry.balance)}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="settlement-section">
          <div className="panel-heading tight">
            <div>
              <p className="eyebrow">Transfers</p>
              <h3>付款路徑</h3>
            </div>
          </div>
          <div className="transfer-list">
            {transfers.length ? (
              transfers.map((transfer, index) => (
                <div className="transfer-row" key={`${transfer.from}-${transfer.to}-${index}`}>
                  <strong>{memberName(memberById.get(transfer.from))}</strong>
                  <span>付給</span>
                  <strong>{memberName(memberById.get(transfer.to))}</strong>
                  <span>{formatMoney(transfer.amount)}</span>
                </div>
              ))
            ) : (
              <div className="timeline-empty">目前沒有需要互相付款的差額</div>
            )}
          </div>
        </section>
      </div>

      <section className="settlement-section">
        <div className="panel-heading tight">
          <div>
            <p className="eyebrow">Actual Expenses</p>
            <h3>實付明細</h3>
          </div>
        </div>
        <div className="budget-cards">
          {actualExpenses.length ? (
            actualExpenses.map((expense) => {
              const payer = memberById.get(expense.payer_id);
              const participants = participantsByExpense[expense.id] || [];
              return (
                <article className="settlement-expense" key={expense.id}>
                  <div>
                    <strong>{expense.title}</strong>
                    <span>{expense.paid_at ? new Date(expense.paid_at).toLocaleDateString("zh-TW") : "未設定日期"}</span>
                  </div>
                  <span>{formatMoney(expense.twd_amount)}</span>
                  <span>付款人：{memberName(payer)}</span>
                  <span>
                    分攤：
                    {participants.length
                      ? participants.map((userId) => memberName(memberById.get(userId))).join("、")
                      : "全部成員"}
                  </span>
                </article>
              );
            })
          ) : (
            <div className="timeline-empty">尚未建立實付，結算會在有實付後開始計算</div>
          )}
        </div>
      </section>

      <section className="settlement-section">
        <div className="panel-heading tight">
          <div>
            <p className="eyebrow">Pending Budget</p>
            <h3>尚未轉實付的預算</h3>
          </div>
        </div>
        <div className="budget-cards">
          {pendingBudgetItems.length ? (
            pendingBudgetItems.map((budget) => (
              <article className="settlement-expense" key={budget.id}>
                <div>
                  <strong>{budget.title}</strong>
                  <span>
                    {budget.category}
                    {budget.subcategory ? `｜${budget.subcategory}` : ""}
                  </span>
                </div>
                <span>{formatMoney(budget.twd_amount)}</span>
                <span>{budget.is_fixed ? "固定費用" : "預估費用"}</span>
              </article>
            ))
          ) : (
            <div className="timeline-empty">所有預算都已轉入實付或沒有待處理預算</div>
          )}
        </div>
      </section>
    </section>
  );
}

function AttachmentList({ attachments, canEdit, targetId, targetType, onDelete, onOpen, onUpload }) {
  async function handleUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    await onUpload(targetType, targetId, file);
    event.target.value = "";
  }

  return (
    <div className="attachment-list">
      <div className="attachment-heading">
        <strong>附件</strong>
        <label className={`attachment-upload${!canEdit ? " disabled" : ""}`}>
          上傳
          <input
            accept="image/jpeg,image/png,image/webp,application/pdf"
            disabled={!canEdit}
            type="file"
            onChange={handleUpload}
          />
        </label>
      </div>
      {attachments.length ? (
        attachments.map((attachment) => (
          <div className="attachment-row" key={attachment.id}>
            <button type="button" onClick={() => onOpen(attachment)}>
              {attachment.file_name}
            </button>
            <span>{attachment.file_size ? `${Math.round(attachment.file_size / 1024)} KB` : ""}</span>
            <button className="mini-button" disabled={!canEdit} type="button" onClick={() => onDelete(attachment)}>
              X
            </button>
          </div>
        ))
      ) : (
        <span className="muted-text">尚未上傳附件</span>
      )}
    </div>
  );
}

function AccommodationPanel({
  accommodations,
  attachments,
  budgetItems,
  canEdit,
  trip,
  onDelete,
  onDeleteAttachment,
  onOpenAttachment,
  onSave,
  onUploadAttachment,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [selectedId, setSelectedId] = useState(accommodations[0]?.id || null);
  const [form, setForm] = useState(emptyAccommodationForm);
  const selected = accommodations.find((item) => item.id === selectedId) || accommodations[0] || null;

  function openNewAccommodation() {
    setForm({
      ...emptyAccommodationForm,
      check_in_date: trip.start_date || todayInput(),
      check_out_date: trip.start_date || todayInput(),
    });
    setEditingId(null);
    setIsOpen(true);
  }

  function openEditAccommodation(item) {
    setForm({
      name: item.name || "",
      check_in_date: item.check_in_date || trip.start_date || todayInput(),
      check_out_date: item.check_out_date || item.check_in_date || trip.start_date || todayInput(),
      check_in_time: item.check_in_time || "",
      check_out_time: item.check_out_time || "",
      address: item.address || "",
      map_url: item.map_url || "",
      booking_code: item.booking_code || "",
      payment_status: item.payment_status || "unpaid",
      budget_item_id: item.budget_item_id || "",
      custom_notes: item.custom_notes || "",
    });
    setEditingId(item.id);
    setIsOpen(true);
  }

  async function submit(event) {
    event.preventDefault();
    await onSave(form, editingId);
    setIsOpen(false);
    setEditingId(null);
    setForm(emptyAccommodationForm);
  }

  return (
    <section className="panel accommodation-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Accommodation</p>
          <h3>住宿</h3>
        </div>
        <button className="icon-button" disabled={!canEdit} type="button" title="新增住宿" onClick={openNewAccommodation}>
          +
        </button>
      </div>

      {isOpen ? (
        <form className="item-form accommodation-form" onSubmit={submit}>
          <div className="field-group form-grid wide">
            <label>
              住宿名稱
              <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
            <label>
              預約代碼
              <input
                value={form.booking_code}
                onChange={(event) => setForm({ ...form, booking_code: event.target.value })}
              />
            </label>
          </div>
          <div className="field-group form-grid">
            <label>
              入住日期
              <input
                required
                type="date"
                value={form.check_in_date}
                onChange={(event) => setForm({ ...form, check_in_date: event.target.value })}
              />
            </label>
            <label>
              退房日期
              <input
                required
                type="date"
                value={form.check_out_date}
                onChange={(event) => setForm({ ...form, check_out_date: event.target.value })}
              />
            </label>
            <label>
              入住時間
              <input
                type="time"
                value={form.check_in_time}
                onChange={(event) => setForm({ ...form, check_in_time: event.target.value })}
              />
            </label>
            <label>
              退房時間
              <input
                type="time"
                value={form.check_out_time}
                onChange={(event) => setForm({ ...form, check_out_time: event.target.value })}
              />
            </label>
          </div>
          <div className="field-group form-grid wide">
            <label>
              地址
              <input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
            </label>
            <label>
              Map URL
              <input value={form.map_url} onChange={(event) => setForm({ ...form, map_url: event.target.value })} />
            </label>
          </div>
          <div className="field-group form-grid wide">
            <label>
              付款狀態
              <select
                value={form.payment_status}
                onChange={(event) => setForm({ ...form, payment_status: event.target.value })}
              >
                <option value="unpaid">未付款</option>
                <option value="partial">部分付款</option>
                <option value="paid">已付款</option>
              </select>
            </label>
            <label>
              連動預算
              <select
                value={form.budget_item_id}
                onChange={(event) => setForm({ ...form, budget_item_id: event.target.value })}
              >
                <option value="">未連動</option>
                {budgetItems.map((budget) => (
                  <option key={budget.id} value={budget.id}>
                    {budget.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="full-label">
            自訂備註
            <textarea
              rows="3"
              value={form.custom_notes}
              onChange={(event) => setForm({ ...form, custom_notes: event.target.value })}
            />
          </label>
          <div className="form-actions">
            <button className="ghost-button" type="button" onClick={() => setIsOpen(false)}>
              取消
            </button>
            <button className="primary-button compact" type="submit">
              儲存
            </button>
          </div>
        </form>
      ) : null}

      <div className="accommodation-layout">
        <div className="accommodation-list">
          {accommodations.length ? (
            accommodations.map((item) => (
              <button
                className={`accommodation-list-item${selected?.id === item.id ? " active" : ""}`}
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
              >
                <strong>{item.name}</strong>
                <span>
                  {item.check_in_date} → {item.check_out_date}
                </span>
                <span>{item.payment_status === "paid" ? "已付款" : item.payment_status === "partial" ? "部分付款" : "未付款"}</span>
              </button>
            ))
          ) : (
            <div className="timeline-empty">尚未建立住宿</div>
          )}
        </div>

        <div className="accommodation-detail">
          {selected ? (
            <>
              <div className="panel-heading tight">
                <div>
                  <p className="eyebrow">Stay</p>
                  <h3>{selected.name}</h3>
                </div>
                <div className="member-actions">
                  <button className="mini-button" disabled={!canEdit} type="button" onClick={() => openEditAccommodation(selected)}>
                    E
                  </button>
                  <button className="mini-button" disabled={!canEdit} type="button" onClick={() => onDelete(selected.id)}>
                    X
                  </button>
                </div>
              </div>
              <div className="accommodation-facts">
                <div>
                  <span>入住</span>
                  <strong>
                    {selected.check_in_date} {selected.check_in_time || ""}
                  </strong>
                </div>
                <div>
                  <span>退房</span>
                  <strong>
                    {selected.check_out_date} {selected.check_out_time || ""}
                  </strong>
                </div>
                <div>
                  <span>付款狀態</span>
                  <strong>
                    {selected.payment_status === "paid"
                      ? "已付款"
                      : selected.payment_status === "partial"
                        ? "部分付款"
                        : "未付款"}
                  </strong>
                </div>
                <div>
                  <span>預約代碼</span>
                  <strong>{selected.booking_code || "未填寫"}</strong>
                </div>
              </div>
              <div className="accommodation-notes">
                {selected.address ? <p>地址：{selected.address}</p> : null}
                {selected.map_url ? (
                  <a href={selected.map_url} rel="noreferrer" target="_blank">
                    開啟地圖
                  </a>
                ) : null}
                {selected.budget_item_id ? (
                  <p>連動預算：{budgetItems.find((budget) => budget.id === selected.budget_item_id)?.title || "已連動"}</p>
                ) : (
                  <p>尚未連動預算</p>
                )}
                {selected.custom_notes ? <p>{selected.custom_notes}</p> : null}
                <AttachmentList
                  attachments={attachments.filter(
                    (attachment) => attachment.target_type === "accommodation" && attachment.target_id === selected.id,
                  )}
                  canEdit={canEdit}
                  targetId={selected.id}
                  targetType="accommodation"
                  onDelete={onDeleteAttachment}
                  onOpen={onOpenAttachment}
                  onUpload={onUploadAttachment}
                />
              </div>
            </>
          ) : (
            <div className="timeline-empty">選擇一筆住宿查看詳細資料</div>
          )}
        </div>
      </div>
    </section>
  );
}

function TodoGuidePanel({
  canEdit,
  guideItems,
  members,
  todoItems,
  onDeleteGuide,
  onDeleteTodo,
  onSaveGuide,
  onSaveTodo,
  onToggleTodo,
}) {
  const [activeTab, setActiveTab] = useState("todo");
  const approvedMembers = members.filter((member) => member.status === "approved");
  return (
    <section className="panel todo-guide-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Todo / Guide</p>
          <h3>待辦與指南</h3>
        </div>
      </div>
      <div className="mobile-tabs">
        <button className={activeTab === "todo" ? "active" : ""} type="button" onClick={() => setActiveTab("todo")}>
          待辦
        </button>
        <button className={activeTab === "guide" ? "active" : ""} type="button" onClick={() => setActiveTab("guide")}>
          指南
        </button>
      </div>
      <div className="todo-guide-layout">
        <div className={`todo-guide-column${activeTab === "todo" ? " active" : ""}`}>
          <TodoPanel
            canEdit={canEdit}
            guideItems={guideItems}
            members={approvedMembers}
            todoItems={todoItems}
            onDelete={onDeleteTodo}
            onSave={onSaveTodo}
            onToggle={onToggleTodo}
          />
        </div>
        <div className={`todo-guide-column${activeTab === "guide" ? " active" : ""}`}>
          <GuidePanel canEdit={canEdit} guideItems={guideItems} onDelete={onDeleteGuide} onSave={onSaveGuide} />
        </div>
      </div>
    </section>
  );
}

function TodoPanel({ canEdit, guideItems, members, todoItems, onDelete, onSave, onToggle }) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyTodoForm);
  const memberById = new Map(members.map((member) => [member.user_id, member]));
  const guideById = new Map(guideItems.map((guide) => [guide.id, guide]));
  const pendingCount = todoItems.filter((item) => !item.completed).length;

  function openNewTodo() {
    setForm(emptyTodoForm);
    setEditingId(null);
    setIsOpen(true);
  }

  function openEditTodo(item) {
    setForm({
      title: item.title || "",
      description: item.description || "",
      due_date: item.due_date || "",
      assignee_id: item.assignee_id || "",
      guide_id: item.guide_id || "",
    });
    setEditingId(item.id);
    setIsOpen(true);
  }

  async function submit(event) {
    event.preventDefault();
    await onSave(form, editingId);
    setIsOpen(false);
    setEditingId(null);
    setForm(emptyTodoForm);
  }

  return (
    <section className="todo-panel">
      <div className="panel-heading tight">
        <div>
          <p className="eyebrow">Todo</p>
          <h3>待辦</h3>
        </div>
        <div className="member-actions">
          <span className="pill">{pendingCount} 未完成</span>
          <button className="icon-button small" disabled={!canEdit} type="button" title="新增待辦" onClick={openNewTodo}>
            +
          </button>
        </div>
      </div>

      {isOpen ? (
        <form className="item-form" onSubmit={submit}>
          <div className="field-group form-grid wide">
            <label>
              標題
              <input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
            </label>
            <label>
              截止日
              <input
                type="date"
                value={form.due_date}
                onChange={(event) => setForm({ ...form, due_date: event.target.value })}
              />
            </label>
          </div>
          <div className="field-group form-grid wide">
            <label>
              負責人
              <select value={form.assignee_id} onChange={(event) => setForm({ ...form, assignee_id: event.target.value })}>
                <option value="">未指定</option>
                {members.map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {memberName(member)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              連結指南
              <select value={form.guide_id} onChange={(event) => setForm({ ...form, guide_id: event.target.value })}>
                <option value="">未連結</option>
                {guideItems.map((guide) => (
                  <option key={guide.id} value={guide.id}>
                    {guide.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="full-label">
            說明
            <textarea
              rows="3"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </label>
          <div className="form-actions">
            <button className="ghost-button" type="button" onClick={() => setIsOpen(false)}>
              取消
            </button>
            <button className="primary-button compact" type="submit">
              儲存
            </button>
          </div>
        </form>
      ) : null}

      <div className="todo-list">
        {todoItems.length ? (
          todoItems.map((item) => {
            const assignee = memberById.get(item.assignee_id);
            const guide = guideById.get(item.guide_id);
            return (
              <article className={`todo-row${item.completed ? " completed" : ""}`} key={item.id}>
                <input checked={item.completed} disabled={!canEdit} type="checkbox" onChange={() => onToggle(item)} />
                <div>
                  <strong>{item.title}</strong>
                  {item.description ? <p>{item.description}</p> : null}
                  <div className="item-meta">
                    {item.due_date ? <span className="pill">{item.due_date}</span> : null}
                    <span className="pill">{assignee ? memberName(assignee) : "未指定負責人"}</span>
                    {guide ? <span className="pill">指南：{guide.title}</span> : null}
                  </div>
                </div>
                <div className="member-actions">
                  <button className="mini-button" disabled={!canEdit} type="button" onClick={() => openEditTodo(item)}>
                    E
                  </button>
                  <button className="mini-button" disabled={!canEdit} type="button" onClick={() => onDelete(item.id)}>
                    X
                  </button>
                </div>
              </article>
            );
          })
        ) : (
          <div className="timeline-empty">尚未建立待辦</div>
        )}
      </div>
    </section>
  );
}

function GuidePanel({ canEdit, guideItems, onDelete, onSave }) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyGuideForm);

  function openNewGuide() {
    setForm(emptyGuideForm);
    setEditingId(null);
    setIsOpen(true);
  }

  function openEditGuide(item) {
    setForm({
      title: item.title || "",
      description: item.description || "",
      url: item.url || "",
    });
    setEditingId(item.id);
    setIsOpen(true);
  }

  async function submit(event) {
    event.preventDefault();
    await onSave(form, editingId);
    setIsOpen(false);
    setEditingId(null);
    setForm(emptyGuideForm);
  }

  return (
    <section className="guide-panel">
      <div className="panel-heading tight">
        <div>
          <p className="eyebrow">Guide</p>
          <h3>指南</h3>
        </div>
        <button className="icon-button small" disabled={!canEdit} type="button" title="新增指南" onClick={openNewGuide}>
          +
        </button>
      </div>

      {isOpen ? (
        <form className="item-form" onSubmit={submit}>
          <label>
            標題
            <input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </label>
          <label className="full-label">
            URL
            <input value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} />
          </label>
          <label className="full-label">
            說明
            <textarea
              rows="3"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </label>
          <div className="form-actions">
            <button className="ghost-button" type="button" onClick={() => setIsOpen(false)}>
              取消
            </button>
            <button className="primary-button compact" type="submit">
              儲存
            </button>
          </div>
        </form>
      ) : null}

      <div className="guide-list">
        {guideItems.length ? (
          guideItems.map((item) => (
            <article className="guide-card" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                {item.description ? <p>{item.description}</p> : null}
                {item.url ? (
                  <a href={item.url} rel="noreferrer" target="_blank">
                    開啟連結
                  </a>
                ) : null}
              </div>
              <div className="member-actions">
                <button className="mini-button" disabled={!canEdit} type="button" onClick={() => openEditGuide(item)}>
                  E
                </button>
                <button className="mini-button" disabled={!canEdit} type="button" onClick={() => onDelete(item.id)}>
                  X
                </button>
              </div>
            </article>
          ))
        ) : (
          <div className="timeline-empty">尚未建立指南</div>
        )}
      </div>
    </section>
  );
}

function LuggagePanel({
  canEdit,
  currentUserId,
  isOwner,
  luggageItems,
  members,
  sharedLuggageItems,
  onDeletePersonal,
  onDeleteShared,
  onSavePersonal,
  onSaveShared,
  onTogglePersonal,
  onUpdateShared,
}) {
  const [activeTab, setActiveTab] = useState("personal");
  const [personalForm, setPersonalForm] = useState(emptyLuggageForm);
  const [sharedForm, setSharedForm] = useState(emptySharedLuggageForm);
  const [editingPersonalId, setEditingPersonalId] = useState(null);
  const [editingSharedId, setEditingSharedId] = useState(null);
  const approvedMembers = members.filter((member) => member.status === "approved");
  const memberById = new Map(approvedMembers.map((member) => [member.user_id, member]));
  const assignedSharedItems = sharedLuggageItems.filter((item) => item.assigned_to === currentUserId);

  async function submitPersonal(event) {
    event.preventDefault();
    await onSavePersonal(personalForm, editingPersonalId);
    setPersonalForm(emptyLuggageForm);
    setEditingPersonalId(null);
  }

  async function submitShared(event) {
    event.preventDefault();
    await onSaveShared(sharedForm, editingSharedId);
    setSharedForm(emptySharedLuggageForm);
    setEditingSharedId(null);
  }

  function editPersonal(item) {
    setPersonalForm({ title: item.title || "", category: item.category || "" });
    setEditingPersonalId(item.id);
  }

  function editShared(item) {
    setSharedForm({
      title: item.title || "",
      category: item.category || "",
      assigned_to: item.assigned_to || "",
    });
    setEditingSharedId(item.id);
  }

  return (
    <section className="panel luggage-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Luggage</p>
          <h3>行李</h3>
        </div>
      </div>
      <div className="mobile-tabs">
        <button
          className={activeTab === "personal" ? "active" : ""}
          type="button"
          onClick={() => setActiveTab("personal")}
        >
          私物
        </button>
        <button className={activeTab === "shared" ? "active" : ""} type="button" onClick={() => setActiveTab("shared")}>
          公物
        </button>
      </div>

      <div className="luggage-layout">
        <section className={`luggage-column${activeTab === "personal" ? " active" : ""}`}>
          <div className="panel-heading tight">
            <div>
              <p className="eyebrow">Personal</p>
              <h3>私物</h3>
            </div>
            <span className="pill">{luggageItems.filter((item) => item.packed).length}/{luggageItems.length}</span>
          </div>
          <form className="inline-form" onSubmit={submitPersonal}>
            <input
              placeholder="新增個人行李"
              value={personalForm.title}
              onChange={(event) => setPersonalForm({ ...personalForm, title: event.target.value })}
            />
            <input
              placeholder="分類"
              value={personalForm.category}
              onChange={(event) => setPersonalForm({ ...personalForm, category: event.target.value })}
            />
            <button className="icon-button small" type="submit" disabled={!personalForm.title.trim()}>
              {editingPersonalId ? "S" : "+"}
            </button>
          </form>
          <div className="luggage-list">
            {luggageItems.length ? (
              luggageItems.map((item) => (
                <article className={`luggage-row${item.packed ? " packed" : ""}`} key={item.id}>
                  <input checked={item.packed} type="checkbox" onChange={() => onTogglePersonal(item)} />
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.category || "未分類"}</span>
                  </div>
                  <div className="member-actions">
                    <button className="mini-button" type="button" onClick={() => editPersonal(item)}>
                      E
                    </button>
                    <button className="mini-button" type="button" onClick={() => onDeletePersonal(item.id)}>
                      X
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <div className="timeline-empty">尚未建立個人行李</div>
            )}
          </div>

          <div className="assigned-shared-list">
            <div className="panel-heading tight">
              <div>
                <p className="eyebrow">Assigned</p>
                <h3>指派給我的公物</h3>
              </div>
            </div>
            {assignedSharedItems.length ? (
              assignedSharedItems.map((item) => (
                <article className="luggage-row shared-assigned" key={item.id}>
                  <input
                    checked={item.packed_by_assignee}
                    type="checkbox"
                    onChange={() => onUpdateShared(item.id, { packed_by_assignee: !item.packed_by_assignee })}
                  />
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.category || "未分類"}</span>
                  </div>
                  <span className="pill">{item.confirmed_by_owner ? "總召已確認" : "待總召確認"}</span>
                </article>
              ))
            ) : (
              <div className="timeline-empty">目前沒有指派公物</div>
            )}
          </div>
        </section>

        <section className={`luggage-column${activeTab === "shared" ? " active" : ""}`}>
          <div className="panel-heading tight">
            <div>
              <p className="eyebrow">Team</p>
              <h3>公物</h3>
            </div>
            <span className="pill">{sharedLuggageItems.length} 件</span>
          </div>
          <form className="shared-luggage-form" onSubmit={submitShared}>
            <input
              disabled={!canEdit}
              placeholder="新增團隊公物"
              value={sharedForm.title}
              onChange={(event) => setSharedForm({ ...sharedForm, title: event.target.value })}
            />
            <input
              disabled={!canEdit}
              placeholder="分類"
              value={sharedForm.category}
              onChange={(event) => setSharedForm({ ...sharedForm, category: event.target.value })}
            />
            <select
              disabled={!canEdit}
              value={sharedForm.assigned_to}
              onChange={(event) => setSharedForm({ ...sharedForm, assigned_to: event.target.value })}
            >
              <option value="">未指派</option>
              {approvedMembers.map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {memberName(member)}
                </option>
              ))}
            </select>
            <button className="icon-button small" disabled={!canEdit || !sharedForm.title.trim()} type="submit">
              {editingSharedId ? "S" : "+"}
            </button>
          </form>
          <div className="luggage-list">
            {sharedLuggageItems.length ? (
              sharedLuggageItems.map((item) => {
                const assignee = memberById.get(item.assigned_to);
                const canToggleAssigned = item.assigned_to === currentUserId || canEdit;
                return (
                  <article className="shared-luggage-row" key={item.id}>
                    <div>
                      <strong>{item.title}</strong>
                      <span>
                        {item.category || "未分類"} · 指派：
                        {assignee ? memberName(assignee) : "未指派"}
                      </span>
                    </div>
                    <label className="checkbox-label">
                      <input
                        checked={item.packed_by_assignee}
                        disabled={!canToggleAssigned}
                        type="checkbox"
                        onChange={() => onUpdateShared(item.id, { packed_by_assignee: !item.packed_by_assignee })}
                      />
                      已打包
                    </label>
                    <label className="checkbox-label">
                      <input
                        checked={item.confirmed_by_owner}
                        disabled={!isOwner}
                        type="checkbox"
                        onChange={() => onUpdateShared(item.id, { confirmed_by_owner: !item.confirmed_by_owner })}
                      />
                      總召確認
                    </label>
                    <div className="member-actions">
                      <button className="mini-button" disabled={!canEdit} type="button" onClick={() => editShared(item)}>
                        E
                      </button>
                      <button className="mini-button" disabled={!canEdit} type="button" onClick={() => onDeleteShared(item.id)}>
                        X
                      </button>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="timeline-empty">尚未建立團隊公物</div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function PackList({ canEdit, items, onAdd, onDelete, onToggle }) {
  const [title, setTitle] = useState("");
  return (
    <section className="panel">
      <div className="panel-heading tight">
        <div>
          <p className="eyebrow">Pack</p>
          <h3>打包清單</h3>
        </div>
      </div>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          onAdd(title);
          setTitle("");
        }}
      >
        <input
          disabled={!canEdit}
          placeholder="新增項目"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <button className="icon-button small" disabled={!canEdit} type="submit" title="新增清單">
          +
        </button>
      </form>
      <div className="pack-list">
        {items.map((item) => (
          <div className={`pack-item${item.done ? " done" : ""}`} key={item.id}>
            <input checked={item.done} disabled={!canEdit} type="checkbox" onChange={() => onToggle(item)} />
            <span>{item.title}</span>
            <button className="mini-button" disabled={!canEdit} type="button" onClick={() => onDelete(item.id)}>
              X
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function MembersPanel({ isOwner, members, onApprove, onReject }) {
  return (
    <section className="panel">
      <div className="panel-heading tight">
        <div>
          <p className="eyebrow">Members</p>
          <h3>成員</h3>
        </div>
      </div>
      <div className="member-list">
        {members.map((member) => (
          <div className="member-row" key={member.id}>
            <div>
              <strong>{member.display_name || member.email || member.user_id}</strong>
              <span>
                {member.role === "owner" ? "擁有者" : "編輯者"} ·{" "}
                {member.status === "approved" ? "已核准" : "等待核准"}
              </span>
            </div>
            {isOwner && member.status === "pending" ? (
              <div className="member-actions">
                <button className="mini-button" type="button" onClick={() => onApprove(member.id)}>
                  OK
                </button>
                <button className="mini-button" type="button" onClick={() => onReject(member.id)}>
                  X
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function TripDialog({ form, onChange, onClose, onSubmit }) {
  return (
    <div className="modal-backdrop">
      <form className="dialog-card" onSubmit={onSubmit}>
        <h2>新增旅程</h2>
        <label>
          旅程名稱
          <input
            required
            value={form.title}
            onChange={(event) => onChange({ ...form, title: event.target.value })}
          />
        </label>
        <label>
          目的地
          <input
            required
            value={form.destination}
            onChange={(event) => onChange({ ...form, destination: event.target.value })}
          />
        </label>
        <div className="field-group form-grid wide">
          <label>
            開始日期
            <input
              required
              type="date"
              value={form.start_date}
              onChange={(event) => onChange({ ...form, start_date: event.target.value })}
            />
          </label>
          <label>
            結束日期
            <input
              required
              type="date"
              value={form.end_date}
              onChange={(event) => onChange({ ...form, end_date: event.target.value })}
            />
          </label>
        </div>
        <div className="form-actions">
          <button className="ghost-button" type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary-button compact" type="submit">
            建立
          </button>
        </div>
      </form>
    </div>
  );
}

function InviteDialog({ trip, onClose }) {
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState(false);

  async function createInvite() {
    let nextToken = token;
    if (!nextToken) {
      nextToken = crypto.randomUUID();
      const { error } = await supabase.from("trip_invites").insert({
        trip_id: trip.id,
        token: nextToken,
      });
      if (error) {
        window.alert(error.message);
        return;
      }
      setToken(nextToken);
    }
    const url = `${window.location.origin}?invite=${nextToken}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
  }

  const inviteUrl = token ? `${window.location.origin}?invite=${token}` : "";

  return (
    <div className="modal-backdrop">
      <div className="dialog-card">
        <h2>邀請朋友</h2>
        <p>朋友使用連結登入後會送出加入申請，核准後即可共同編輯。</p>
        {inviteUrl ? <input readOnly value={inviteUrl} /> : null}
        {copied ? <div className="notice">邀請連結已複製。</div> : null}
        <div className="form-actions">
          <button className="ghost-button" type="button" onClick={onClose}>
            關閉
          </button>
          <button className="primary-button compact" type="button" onClick={createInvite}>
            產生並複製連結
          </button>
        </div>
      </div>
    </div>
  );
}

function ShareDialog({ links, onClose, onRefresh, trip }) {
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState("");

  async function copyShareUrl(token, id) {
    const url = `${window.location.origin}?share=${token}`;
    await navigator.clipboard.writeText(url);
    setCopiedId(id);
  }

  async function createShareLink() {
    setBusy(true);
    const token = crypto.randomUUID();
    const { error } = await supabase.from("share_links").insert({
      trip_id: trip.id,
      token,
      is_active: true,
    });
    setBusy(false);

    if (error) {
      window.alert(error.message);
      return;
    }

    await onRefresh();
    await copyShareUrl(token, token);
  }

  async function toggleShareLink(link) {
    setBusy(true);
    const { error } = await supabase
      .from("share_links")
      .update({ is_active: !link.is_active })
      .eq("id", link.id);
    setBusy(false);

    if (error) {
      window.alert(error.message);
      return;
    }

    await onRefresh();
  }

  return (
    <div className="modal-backdrop">
      <div className="dialog-card share-dialog">
        <h2>唯讀分享</h2>
        <p>分享頁不需要登入，只會顯示時間軸、住宿與指南；預算、實付、結算、行李與成員資料不會公開。</p>
        <div className="share-link-list">
          {links.length ? (
            links.map((link) => {
              const shareUrl = `${window.location.origin}?share=${link.token}`;
              return (
                <div className="share-link-row" key={link.id}>
                  <div>
                    <strong>{link.is_active ? "啟用中" : "已停用"}</strong>
                    <span>{shareUrl}</span>
                  </div>
                  <div className="share-link-actions">
                    <button className="mini-button" type="button" onClick={() => copyShareUrl(link.token, link.id)}>
                      {copiedId === link.id ? "已複製" : "複製"}
                    </button>
                    <button className="mini-button" type="button" disabled={busy} onClick={() => toggleShareLink(link)}>
                      {link.is_active ? "停用" : "啟用"}
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="empty-inline">尚未建立唯讀分享連結。</div>
          )}
        </div>
        <div className="form-actions">
          <button className="ghost-button" type="button" onClick={onClose}>
            關閉
          </button>
          <button className="primary-button compact" type="button" disabled={busy} onClick={createShareLink}>
            建立並複製連結
          </button>
        </div>
      </div>
    </div>
  );
}

function ShareView({ error, loading, snapshot }) {
  const trip = snapshot?.trip;
  const itineraryItems = snapshot?.itinerary_items || [];
  const accommodations = snapshot?.accommodations || [];
  const guideItems = snapshot?.guide_items || [];

  const groupedItems = itineraryItems.reduce((groups, item) => {
    const key = item.date || `Day ${Number(item.day_index || 0) + 1}`;
    groups[key] = [...(groups[key] || []), item];
    return groups;
  }, {});

  if (loading || (!snapshot && !error)) {
    return <div className="center-state share-center">載入分享行程中...</div>;
  }

  if (error) {
    return (
      <section className="share-view">
        <div className="share-hero">
          <p className="eyebrow">Shared Travel Plan</p>
          <h1>無法開啟分享頁</h1>
          <p>{error}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="share-view">
      <div className="share-hero">
        <p className="eyebrow">Shared Travel Plan</p>
        <h1>{trip?.title || trip?.name || "旅程分享"}</h1>
        <p>
          {[trip?.destination, trip?.start_date && trip?.end_date ? `${trip.start_date} - ${trip.end_date}` : ""]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <div className="share-content">
        <section className="share-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Timeline</p>
              <h2>時間軸</h2>
            </div>
          </div>
          {Object.entries(groupedItems).length ? (
            Object.entries(groupedItems).map(([date, dayItemsForShare]) => (
              <div className="share-day" key={date}>
                <h3>{date.includes("-") ? formatDate(new Date(`${date}T00:00:00`)) : date}</h3>
                {dayItemsForShare.map((item) => (
                  <article className="share-card" key={item.id}>
                    <div className="share-time">
                      <strong>{item.start_time || "--:--"}</strong>
                      {item.end_time ? <span>{item.end_time}</span> : null}
                    </div>
                    <div>
                      <h4>{item.title}</h4>
                      {item.location_name ? <p>{item.location_name}</p> : null}
                      {item.transportation_note ? <p>{item.transportation_note}</p> : null}
                      {item.description ? <p>{item.description}</p> : null}
                      {item.map_url ? (
                        <a href={item.map_url} rel="noreferrer" target="_blank">
                          開啟地圖
                        </a>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            ))
          ) : (
            <div className="empty-inline">尚未建立公開行程。</div>
          )}
        </section>

        <section className="share-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Accommodation</p>
              <h2>住宿</h2>
            </div>
          </div>
          <div className="share-card-grid">
            {accommodations.length ? (
              accommodations.map((stay) => (
                <article className="share-card vertical" key={stay.id}>
                  <h4>{stay.name}</h4>
                  <p>
                    {stay.check_in_date} - {stay.check_out_date}
                  </p>
                  {stay.address ? <p>{stay.address}</p> : null}
                  {stay.custom_notes ? <p>{stay.custom_notes}</p> : null}
                  {stay.map_url ? (
                    <a href={stay.map_url} rel="noreferrer" target="_blank">
                      開啟地圖
                    </a>
                  ) : null}
                </article>
              ))
            ) : (
              <div className="empty-inline">尚未建立公開住宿。</div>
            )}
          </div>
        </section>

        <section className="share-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Guide</p>
              <h2>指南</h2>
            </div>
          </div>
          <div className="share-card-grid">
            {guideItems.length ? (
              guideItems.map((guide) => (
                <article className="share-card vertical" key={guide.id}>
                  <h4>{guide.title}</h4>
                  {guide.description ? <p>{guide.description}</p> : null}
                  {guide.url ? (
                    <a href={guide.url} rel="noreferrer" target="_blank">
                      開啟連結
                    </a>
                  ) : null}
                </article>
              ))
            ) : (
              <div className="empty-inline">尚未建立公開指南。</div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
