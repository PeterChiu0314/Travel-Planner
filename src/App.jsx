import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearDraft, findLatestDraftTrip, loadLatestDraftForEntity, useDraftAutosave } from "./lib/draftAutosave.js";
import { acquireEditLock, isLockedByAnotherUser, releaseEditLock } from "./lib/editLocks.js";
import { hasSupabaseConfig, supabase } from "./lib/supabase.js";

const attachmentBucket = "trip-attachments";

const desktopNavItems = [
  { id: "today", label: "今日 / 總覽", shortLabel: "今日" },
  { id: "timeline", label: "行程", shortLabel: "程" },
  { id: "budget", label: "預算", shortLabel: "錢" },
  { id: "accommodation", label: "住宿", shortLabel: "宿" },
  { id: "todo", label: "待辦", shortLabel: "辦" },
  { id: "luggage", label: "行李", shortLabel: "李" },
  { id: "settlement", label: "結算", shortLabel: "結" },
  { id: "settings", label: "設定", shortLabel: "設" },
];

const mobileNavItems = [
  { id: "today", label: "今日" },
  { id: "timeline", label: "行程" },
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

const activeEditorGuards = new Map();
const activeEditorListeners = new Set();
let activeEditorPromptResolve = null;

function notifyActiveEditorListeners() {
  activeEditorListeners.forEach((listener) => listener());
}

function registerActiveEditorGuard(id, guard) {
  activeEditorGuards.set(id, guard);
  notifyActiveEditorListeners();
  return () => {
    activeEditorGuards.delete(id);
    notifyActiveEditorListeners();
  };
}

function getDirtyActiveEditorGuards() {
  return [...activeEditorGuards.values()].filter((guard) => guard.isDirty);
}

function showActiveEditorPrompt() {
  if (activeEditorPromptResolve) return Promise.resolve(null);
  return new Promise((resolve) => {
    activeEditorPromptResolve = resolve;
    notifyActiveEditorListeners();
  });
}

async function requestActiveEditorGuardResolution() {
  const dirtyGuards = getDirtyActiveEditorGuards();
  if (!dirtyGuards.length) return true;
  const choice = await showActiveEditorPrompt();
  if (!choice) return false;
  for (const guard of dirtyGuards) {
    const ok = choice === "save" ? await guard.save() : await guard.discard();
    if (ok === false) return false;
  }
  return true;
}

function useActiveEditorGuard(id, guard) {
  useEffect(() => {
    if (!guard.isActive) return undefined;
    return registerActiveEditorGuard(id, guard);
  }, [id, guard]);
}

function ActiveEditorGuardDialog() {
  const [isOpen, setIsOpen] = useState(Boolean(activeEditorPromptResolve));

  useEffect(() => {
    const listener = () => setIsOpen(Boolean(activeEditorPromptResolve));
    activeEditorListeners.add(listener);
    return () => activeEditorListeners.delete(listener);
  }, []);

  useEffect(() => {
    function handleBeforeUnload(event) {
      if (!getDirtyActiveEditorGuards().length) return;
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  if (!isOpen) return null;

  function choose(choice) {
    const resolve = activeEditorPromptResolve;
    activeEditorPromptResolve = null;
    notifyActiveEditorListeners();
    resolve?.(choice);
  }

  return (
    <div className="modal-backdrop">
      <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="active-editor-guard-title">
        <h2 id="active-editor-guard-title">您有未儲存的變更</h2>
        <p>是否儲存後繼續？</p>
        <div className="form-actions">
          <button className="primary-button compact" type="button" onClick={() => choose("save")}>
            儲存
          </button>
          <button className="ghost-button" type="button" onClick={() => choose("discard")}>
            不儲存
          </button>
        </div>
      </div>
    </div>
  );
}

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

function formatTimeDisplay(value) {
  if (!value) return "";
  const [hours = "", minutes = ""] = String(value).split(":");
  if (!hours || !minutes) return value;
  return `${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}`;
}

function buildTimeOptions(stepMinutes = 5) {
  const options = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += stepMinutes) {
    const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mins = String(minutes % 60).padStart(2, "0");
    options.push(`${hours}:${mins}`);
  }
  return options;
}

const timelineTimeOptions = buildTimeOptions(5);

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

function useDayBoardNavigation(activeDay, isEnabled) {
  const boardRef = useRef(null);
  const [scrollState, setScrollState] = useState({ left: false, right: false });

  const updateScrollState = useCallback(() => {
    const board = boardRef.current;
    if (!board || !isEnabled) {
      setScrollState({ left: false, right: false });
      return;
    }
    setScrollState({
      left: board.scrollLeft > 4,
      right: board.scrollLeft + board.clientWidth < board.scrollWidth - 4,
    });
  }, [isEnabled]);

  const scrollToDay = useCallback(
    (dayIndex) => {
      if (!isEnabled) return;
      requestAnimationFrame(() => {
        const board = boardRef.current;
        const column = board?.querySelector(`[data-day-index="${dayIndex}"]`);
        if (!board || !column) return;
        board.scrollTo({
          left: column.offsetLeft - board.offsetLeft,
          behavior: "smooth",
        });
        requestAnimationFrame(updateScrollState);
      });
    },
    [isEnabled, updateScrollState],
  );

  const scrollByDirection = useCallback(
    (direction) => {
      const board = boardRef.current;
      if (!board || !isEnabled) return;
      const column = board.querySelector(".timeline-day-column, .timeline-day-preview");
      const distance = column ? column.getBoundingClientRect().width + 14 : 360;
      board.scrollBy({ left: direction * distance, behavior: "smooth" });
      requestAnimationFrame(updateScrollState);
    },
    [isEnabled, updateScrollState],
  );

  useEffect(() => {
    if (!isEnabled) return;
    scrollToDay(activeDay);
    updateScrollState();
  }, [activeDay, isEnabled, scrollToDay, updateScrollState]);

  useEffect(() => {
    const board = boardRef.current;
    if (!board || !isEnabled) return;
    board.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);
    updateScrollState();
    return () => {
      board.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
    };
  }, [isEnabled, updateScrollState]);

  return { boardRef, scrollByDirection, scrollState, scrollToDay };
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

function demoSectionFromPath() {
  const path = window.location.pathname.replace(/\/+$/, "");
  if (path === "/demo" || path === "/demo/") return "timeline";
  if (path === "/demo/timeline") return "timeline";
  if (path === "/demo/budget") return "budget";
  if (path === "/demo/luggage") return "luggage";
  return null;
}

function demoId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function demoSectionLabel(section) {
  return {
    timeline: "行程",
    budget: "預算",
    luggage: "行李",
  }[section] || section;
}

const demoTrip = {
  id: "demo-trip",
  title: "東京家庭旅行 Demo",
  destination: "東京",
  start_date: "2026-06-12",
  end_date: "2026-06-14",
};

const demoMembers = [
  { user_id: "demo-peter", display_name: "Peter", email: "peter@example.com", role: "owner", status: "approved" },
  { user_id: "demo-a", display_name: "小安", email: "ariel@example.com", role: "editor", status: "approved" },
  { user_id: "demo-b", display_name: "阿班", email: "ben@example.com", role: "viewer", status: "approved" },
];

function createDemoTimelineItems() {
  return [
    {
      id: "demo-itinerary-1",
      day_index: 0,
      type: "transport",
      start_time: "09:10",
      end_time: "10:25",
      title: "成田特快前往新宿",
      location: "成田機場",
      location_name: "成田機場",
      address: "日本千葉縣成田市古込1-1",
      map_url: "https://maps.google.com/?q=Narita+Airport",
      description: "搭車前先領取 IC 卡，確認票券與座位。",
      transportation_note: "NEX 指定席，建議提早 15 分鐘到月台。",
      cost: 9600,
      updated_at: "2026-05-20T08:00:00.000Z",
    },
    {
      id: "demo-itinerary-2",
      day_index: 0,
      type: "food",
      start_time: "12:30",
      end_time: "13:30",
      title: "新宿車站附近午餐",
      location: "新宿",
      location_name: "新宿",
      address: "日本東京都新宿區",
      map_url: "https://maps.google.com/?q=Shinjuku+Tokyo",
      description: "依抵達時間彈性調整餐廳。",
      transportation_note: "從車站東口步行前往。",
      cost: 2400,
      updated_at: "2026-05-20T08:00:00.000Z",
    },
    {
      id: "demo-itinerary-3",
      day_index: 1,
      type: "attraction",
      start_time: "10:00",
      end_time: "12:00",
      title: "明治神宮散步",
      location: "原宿",
      location_name: "明治神宮",
      address: "日本東京都澀谷區代代木神園町1-1",
      map_url: "https://maps.google.com/?q=Meiji+Shrine",
      description: "早上散步與拍照，節奏放慢一點。",
      transportation_note: "搭 JR 山手線到原宿站。",
      cost: 0,
      updated_at: "2026-05-20T08:00:00.000Z",
    },
  ];
}

function createDemoBudgetItems() {
  return [
    {
      id: "demo-budget-1",
      trip_id: demoTrip.id,
      category: "交通",
      subcategory: "機場交通",
      title: "成田特快",
      amount: 9600,
      currency: "JPY",
      exchange_rate: 0.22,
      twd_amount: 2112,
      payer_id: "demo-peter",
      is_fixed: true,
      auto_created_actual_expense_id: "demo-actual-1",
      note: "三人指定席，已預先估算。",
      updated_at: "2026-05-20T08:00:00.000Z",
    },
    {
      id: "demo-budget-2",
      trip_id: demoTrip.id,
      category: "餐飲",
      subcategory: "午餐",
      title: "新宿午餐",
      amount: 7200,
      currency: "JPY",
      exchange_rate: 0.22,
      twd_amount: 1584,
      payer_id: "demo-a",
      is_fixed: false,
      auto_created_actual_expense_id: null,
      note: "先抓預算，現場點餐後可調整。",
      updated_at: "2026-05-20T08:00:00.000Z",
    },
  ];
}

function createDemoBudgetParticipants() {
  return [
    { id: "demo-budget-participant-1", budget_item_id: "demo-budget-1", user_id: "demo-peter" },
    { id: "demo-budget-participant-2", budget_item_id: "demo-budget-1", user_id: "demo-a" },
    { id: "demo-budget-participant-3", budget_item_id: "demo-budget-1", user_id: "demo-b" },
    { id: "demo-budget-participant-4", budget_item_id: "demo-budget-2", user_id: "demo-peter" },
    { id: "demo-budget-participant-5", budget_item_id: "demo-budget-2", user_id: "demo-a" },
  ];
}

function createDemoActualExpenses() {
  return [
    {
      id: "demo-actual-1",
      trip_id: demoTrip.id,
      budget_item_id: "demo-budget-1",
      title: "成田特快",
      amount: 9600,
      currency: "JPY",
      exchange_rate: 0.22,
      twd_amount: 2112,
      payer_id: "demo-peter",
      paid_at: "2026-06-12T09:00:00.000Z",
      note: "由 Demo 預算轉成實付。",
      updated_at: "2026-05-20T08:00:00.000Z",
    },
  ];
}

function createDemoActualParticipants() {
  return [
    { id: "demo-actual-participant-1", actual_expense_id: "demo-actual-1", user_id: "demo-peter" },
    { id: "demo-actual-participant-2", actual_expense_id: "demo-actual-1", user_id: "demo-a" },
    { id: "demo-actual-participant-3", actual_expense_id: "demo-actual-1", user_id: "demo-b" },
  ];
}

const demoItineraryBudgetLinks = [
  { id: "demo-link-1", itinerary_item_id: "demo-itinerary-1", budget_item_id: "demo-budget-1" },
  { id: "demo-link-2", itinerary_item_id: "demo-itinerary-2", budget_item_id: "demo-budget-2" },
];

function createDemoLuggageItems() {
  return [
    { id: "demo-luggage-1", title: "護照", category: "證件", packed: true },
    { id: "demo-luggage-2", title: "充電器", category: "電子用品", packed: false },
    { id: "demo-luggage-3", title: "薄外套", category: "衣物", packed: false },
  ];
}

function createDemoSharedLuggageItems() {
  return [
    {
      id: "demo-shared-luggage-1",
      title: "隨身 Wi-Fi",
      category: "團隊公物",
      assigned_to: "demo-a",
      packed_by_assignee: true,
      confirmed_by_owner: false,
    },
    {
      id: "demo-shared-luggage-2",
      title: "常備藥包",
      category: "健康用品",
      assigned_to: "demo-peter",
      packed_by_assignee: false,
      confirmed_by_owner: false,
    },
  ];
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

const activeEditDraftEntityTypes = ["itinerary_item", "budget_item", "accommodation", "todo_item"];
const sessionContextStoragePrefix = "travel-planner-session-context";
const sessionContextSections = new Set([...desktopNavItems, ...mobileNavItems].map((item) => item.id));
const luggageTabs = new Set(["personal", "shared"]);

function sessionContextKey(userId) {
  return `${sessionContextStoragePrefix}:${userId || "anonymous"}`;
}

function readSessionContext(userId) {
  try {
    const raw = localStorage.getItem(sessionContextKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSessionContext(userId, context) {
  try {
    localStorage.setItem(
      sessionContextKey(userId),
      JSON.stringify({
        ...context,
        updatedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // Session context restore is best effort; storage can be unavailable in private windows.
  }
}

function normalizeSessionContext(context, trip) {
  if (!context || !trip) return null;
  const dayCount = tripDays(trip).length;
  const activeDay = Number.isInteger(context.activeDay)
    ? Math.min(Math.max(context.activeDay, 0), Math.max(dayCount - 1, 0))
    : null;
  return {
    activeDay,
    activeSection: sessionContextSections.has(context.activeSection) ? context.activeSection : null,
    luggageTab: luggageTabs.has(context.luggageTab) ? context.luggageTab : null,
  };
}

export default function App() {
  const demoSection = demoSectionFromPath();
  const isDemoMode = Boolean(demoSection);
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
  const [luggageTab, setLuggageTab] = useState("personal");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const restoredDayRef = useRef(null);
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
      const canRestoreSessionContext = !preferredTripId || preferredTripId === activeTripId;
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
    if (isDemoMode) return;
    if (!hasSupabaseConfig) {
      setAuthReady(true);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === "SIGNED_OUT" || !nextSession) {
        setTrips([]);
        setActiveTripId(null);
      }
    });

    return () => data.subscription.unsubscribe();
  }, [isDemoMode]);

  useEffect(() => {
    if (isDemoMode) return;
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
  }, [isDemoMode]);

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
    if (isDemoMode || !session?.user || !activeTripId) return;
    writeSessionContext(session.user.id, {
      activeDay,
      activeSection,
      activeTripId,
      luggageTab,
    });
  }, [activeDay, activeSection, activeTripId, isDemoMode, luggageTab, session?.user]);

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

  function rejectCrossTripSave() {
    setNotice("偵測到跨旅程編輯狀態，已阻止儲存。請回到原旅程或重新開啟編輯器。");
    return { ok: false, crossTrip: true };
  }

  function isCurrentTripContext(meta = {}) {
    return !meta.tripId || meta.tripId === activeTrip?.id;
  }

  async function updateWithConflictCheck(table, payload, editingId, meta = {}) {
    let query = supabase.from(table).update(payload).eq("id", editingId);
    if (meta.tripId) query = query.eq("trip_id", meta.tripId);
    if (meta.baseUpdatedAt) query = query.eq("updated_at", meta.baseUpdatedAt);
    const result = await query.select("id").maybeSingle();
    if (result.error) return { ok: false, error: result.error };
    if (!result.data) return { ok: false, conflict: true };
    await releaseEditLock({ recordId: editingId, supabase, table, userId: session?.user?.id });
    return { ok: true };
  }

  async function saveItem(payload, editingId, meta = {}) {
    if (!activeTrip || !canEdit) return;
    if (!isCurrentTripContext(meta)) return rejectCrossTripSave();
    const invalidTimeRange = isInvalidTimeRange(payload.start_time, payload.end_time);
    if (invalidTimeRange) {
      setNotice("結束時間必須晚於開始時間。");
      return { ok: false };
    }
    if (editingId) {
      const result = await updateWithConflictCheck("itinerary_items", normalizeItemPayload(payload), editingId, meta);
      if (result.error) setNotice(result.error.message);
      else if (result.conflict) setNotice("此資料在你編輯期間已被其他人更新。");
      else await loadTripData(activeTrip.id);
      return result;
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
    return { ok: !error, error };
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
    const nextPayload = normalizeItemPayload({
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
    });
    const invalidTimeRange = isInvalidTimeRange(nextPayload.start_time, nextPayload.end_time);
    if (invalidTimeRange) {
      setNotice("結束時間必須晚於開始時間。");
      return;
    }
    const { error } = await supabase
      .from("itinerary_items")
      .update(nextPayload)
      .eq("id", item.id);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function saveBudget(payload, editingId, meta = {}) {
    if (!activeTrip || !canEdit) return;
    if (!isCurrentTripContext(meta)) return rejectCrossTripSave();
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
      ? await updateWithConflictCheck("budget_items", budgetPayload, editingId, meta)
      : await supabase.from("budget_items").insert(budgetPayload).select("id").single();

    if (result.error || result.conflict) {
      if (result.conflict) setNotice("此資料在你編輯期間已被其他人更新。");
      else setNotice(result.error.message);
      return result;
    }

    const budgetId = editingId || result.data.id;
    const [clearParticipantsResult, clearLinksResult] = await Promise.all([
      supabase.from("budget_item_participants").delete().eq("budget_item_id", budgetId),
      supabase.from("itinerary_budget_items").delete().eq("budget_item_id", budgetId),
    ]);
    const clearError = clearParticipantsResult.error || clearLinksResult.error;
    if (clearError) {
      setNotice(clearError.message);
      return { ok: false, error: clearError };
    }

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
    if (error) {
      setNotice(error.message);
      return { ok: false, error };
    }
    await loadTripData(activeTrip.id);
    return { ok: true };
  }

  async function deleteBudget(budgetId) {
    if (!activeTrip || !canEdit) return;
    const { error } = await supabase.from("budget_items").delete().eq("id", budgetId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function saveActualExpense(payload, editingId, meta = {}) {
    if (!activeTrip || !canEdit) return;
    if (!isCurrentTripContext(meta)) return rejectCrossTripSave();
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
      ? await updateWithConflictCheck("actual_expenses", expensePayload, editingId, meta)
      : await supabase.from("actual_expenses").insert(expensePayload).select("id").single();

    if (result.error || result.conflict) {
      if (result.conflict) setNotice("此資料在你編輯期間已被其他人更新。");
      else setNotice(result.error.message);
      return result;
    }

    const actualExpenseId = editingId || result.data.id;
    const clearResult = await supabase.from("actual_expense_participants").delete().eq("actual_expense_id", actualExpenseId);
    if (clearResult.error) {
      setNotice(clearResult.error.message);
      return { ok: false, error: clearResult.error };
    }
    const participantRows = participantIds.map((userId) => ({ actual_expense_id: actualExpenseId, user_id: userId }));
    const participantsResult = participantRows.length
      ? await supabase.from("actual_expense_participants").insert(participantRows)
      : { error: null };
    if (participantsResult.error) {
      setNotice(participantsResult.error.message);
      return { ok: false, error: participantsResult.error };
    }
    await loadTripData(activeTrip.id);
    return { ok: true };
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

  async function saveAccommodation(payload, editingId, meta = {}) {
    if (!activeTrip || !canEdit) return;
    if (!isCurrentTripContext(meta)) return rejectCrossTripSave();
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
      ? await updateWithConflictCheck("accommodations", nextPayload, editingId, meta)
      : await supabase.from("accommodations").insert(nextPayload);
    if (result.error) setNotice(result.error.message);
    else if (result.conflict) setNotice("此資料在你編輯期間已被其他人更新。");
    else await loadTripData(activeTrip.id);
    return result.conflict ? { ok: false, conflict: true } : { ok: !result.error, error: result.error };
  }

  async function deleteAccommodation(accommodationId) {
    if (!activeTrip || !canEdit) return;
    const { error } = await supabase.from("accommodations").delete().eq("id", accommodationId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function saveGuide(payload, editingId, meta = {}) {
    if (!activeTrip || !canEdit) return;
    if (!isCurrentTripContext(meta)) return rejectCrossTripSave();
    const nextPayload = {
      trip_id: activeTrip.id,
      title: payload.title.trim(),
      description: payload.description.trim() || null,
      url: payload.url.trim() || null,
    };
    const result = editingId
      ? await updateWithConflictCheck("guide_items", nextPayload, editingId, meta)
      : await supabase.from("guide_items").insert(nextPayload);
    if (result.error) setNotice(result.error.message);
    else if (result.conflict) setNotice("此資料在你編輯期間已被其他人更新。");
    else await loadTripData(activeTrip.id);
    return result.conflict ? { ok: false, conflict: true } : { ok: !result.error, error: result.error };
  }

  async function deleteGuide(guideId) {
    if (!activeTrip || !canEdit) return;
    const { error } = await supabase.from("guide_items").delete().eq("id", guideId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function saveTodo(payload, editingId, meta = {}) {
    if (!activeTrip || !canEdit) return;
    if (!isCurrentTripContext(meta)) return rejectCrossTripSave();
    const nextPayload = {
      trip_id: activeTrip.id,
      title: payload.title.trim(),
      description: payload.description.trim() || null,
      due_date: payload.due_date || null,
      assignee_id: payload.assignee_id || null,
      guide_id: payload.guide_id || null,
    };
    const result = editingId
      ? await updateWithConflictCheck("todo_items", nextPayload, editingId, meta)
      : await supabase.from("todo_items").insert(nextPayload);
    if (result.error) setNotice(result.error.message);
    else if (result.conflict) setNotice("此資料在你編輯期間已被其他人更新。");
    else await loadTripData(activeTrip.id);
    return result.conflict ? { ok: false, conflict: true } : { ok: !result.error, error: result.error };
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

  async function saveLuggageItem(payload, editingId, meta = {}) {
    if (!activeTrip || !session?.user) return;
    if (!isCurrentTripContext(meta)) return rejectCrossTripSave();
    const nextPayload = {
      trip_id: activeTrip.id,
      owner_id: session.user.id,
      title: payload.title.trim(),
      category: payload.category.trim() || null,
      is_shared_assigned_item: false,
    };
    const result = editingId
      ? await updateWithConflictCheck("luggage_items", nextPayload, editingId, meta)
      : await supabase.from("luggage_items").insert(nextPayload);
    if (result.error) setNotice(result.error.message);
    else if (result.conflict) setNotice("此資料在你編輯期間已被其他人更新。");
    else await loadTripData(activeTrip.id);
    return result.conflict ? { ok: false, conflict: true } : { ok: !result.error, error: result.error };
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

  async function saveSharedLuggageItem(payload, editingId, meta = {}) {
    if (!activeTrip || !canEdit) return;
    if (!isCurrentTripContext(meta)) return rejectCrossTripSave();
    const nextPayload = {
      trip_id: activeTrip.id,
      title: payload.title.trim(),
      category: payload.category.trim() || null,
      assigned_to: payload.assigned_to || null,
    };
    const result = editingId
      ? await updateWithConflictCheck("shared_luggage_items", nextPayload, editingId, meta)
      : await supabase.from("shared_luggage_items").insert(nextPayload);
    if (result.error) setNotice(result.error.message);
    else if (result.conflict) setNotice("此資料在你編輯期間已被其他人更新。");
    else await loadTripData(activeTrip.id);
    return result.conflict ? { ok: false, conflict: true } : { ok: !result.error, error: result.error };
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
    const invalidItem = nextItems.find((item) => isInvalidTimeRange(item.start_time, item.end_time));
    if (invalidItem) {
      setNotice("結束時間必須晚於開始時間。");
      return;
    }
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

  async function selectTrip(nextTripId) {
    if (nextTripId === activeTripId) return;
    const canContinue = await requestActiveEditorGuardResolution();
    if (canContinue) setActiveTripId(nextTripId);
  }

  if (isDemoMode) {
    return (
      <Shell>
        <DemoApp initialSection={demoSection} />
      </Shell>
    );
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
        <TripList trips={trips} activeTripId={activeTripId} onSelect={selectTrip} />
        <div className="user-box">
          {activeTrip ? (
            <MembersPanel
              className="sidebar-members"
              isOwner={isOwner}
              members={members}
              onApprove={approveMember}
              onReject={rejectMember}
            />
          ) : null}
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
            luggageTab={luggageTab}
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
            onLuggageTabChange={setLuggageTab}
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
      <ActiveEditorGuardDialog />
    </Shell>
  );
}

function normalizeItemPayload(payload) {
  const locationName = payload.location_name || payload.location;
  const description = payload.description || payload.note;
  return {
    ...payload,
    title: locationName || payload.title,
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

function timeToMinutes(value) {
  if (!value) return null;
  const [hours, minutes] = String(value).split(":");
  const parsedHours = Number(hours);
  const parsedMinutes = Number(minutes);
  if (!Number.isFinite(parsedHours) || !Number.isFinite(parsedMinutes)) return null;
  return parsedHours * 60 + parsedMinutes;
}

function isInvalidTimeRange(startTime, endTime) {
  if (!startTime || !endTime) return false;
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (start === null || end === null) return false;
  return start >= end;
}

function Shell({ children, collapsed = false }) {
  return <div className={`app-shell${collapsed ? " sidebar-collapsed" : ""}`}>{children}</div>;
}

function DemoApp({ initialSection }) {
  const [activeSection, setActiveSection] = useState(initialSection || "timeline");
  const [activeDay, setActiveDay] = useState(0);
  const [timelineItems, setTimelineItems] = useState(() => createDemoTimelineItems());
  const [budgetItems, setBudgetItems] = useState(() => createDemoBudgetItems());
  const [budgetParticipants, setBudgetParticipants] = useState(() => createDemoBudgetParticipants());
  const [actualExpenses, setActualExpenses] = useState(() => createDemoActualExpenses());
  const [actualParticipants, setActualParticipants] = useState(() => createDemoActualParticipants());
  const [itineraryBudgetLinks, setItineraryBudgetLinks] = useState(() => demoItineraryBudgetLinks);
  const [luggageItems, setLuggageItems] = useState(() => createDemoLuggageItems());
  const [sharedLuggageItems, setSharedLuggageItems] = useState(() => createDemoSharedLuggageItems());
  const [focusedItemId, setFocusedItemId] = useState(null);
  const [isRouteCollapsed, setIsRouteCollapsed] = useState(false);
  const days = useMemo(() => tripDays(demoTrip), []);
  const dayItems = useMemo(
    () => sortScheduleItems(timelineItems.filter((item) => item.day_index === activeDay)),
    [activeDay, timelineItems],
  );
  const itemsByDay = useMemo(
    () => days.map((_, index) => sortScheduleItems(timelineItems.filter((item) => item.day_index === index))),
    [days, timelineItems],
  );
  const dayBoardNavigation = useDayBoardNavigation(activeDay, isRouteCollapsed);
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

  function changeSection(section) {
    setActiveSection(section);
    window.history.pushState({}, "", `/demo/${section}`);
  }

  function selectTimelineDay(dayIndex) {
    setActiveDay(dayIndex);
    if (isRouteCollapsed) dayBoardNavigation.scrollToDay(dayIndex);
  }

  function saveTimelineItem(payload, editingId) {
    if (!payload.title.trim()) return;
    const invalidTimeRange = isInvalidTimeRange(payload.start_time, payload.end_time);
    if (invalidTimeRange) return { ok: false };
    if (editingId) {
      setTimelineItems((current) =>
        current.map((item) =>
          item.id === editingId
            ? {
                ...item,
                ...payload,
                location: payload.location_name || payload.location,
                location_name: payload.location_name || payload.location,
                updated_at: new Date().toISOString(),
              }
            : item,
        ),
      );
      return { ok: true };
    }
    setTimelineItems((current) => [
      ...current,
      {
        ...emptyItemForm,
        ...payload,
        id: demoId("demo-itinerary"),
        day_index: activeDay,
        location: payload.location_name || payload.location,
        location_name: payload.location_name || payload.location,
        updated_at: new Date().toISOString(),
      },
    ]);
    return { ok: true };
  }

  function saveBudgetItem(payload, editingId) {
    if (!payload.title.trim()) return;
    const participantIds = payload.participantIds?.length ? payload.participantIds : demoMembers.map((member) => member.user_id);
    const amount = Number(payload.amount || 0);
    const exchangeRate = Number(payload.exchange_rate || 1);
    const nextBudget = {
      category: payload.category || "其他",
      subcategory: payload.subcategory || "",
      title: payload.title.trim(),
      amount,
      currency: payload.currency || "TWD",
      exchange_rate: exchangeRate,
      twd_amount: Math.round(amount * exchangeRate),
      payer_id: payload.payer_id || demoMembers[0].user_id,
      is_fixed: Boolean(payload.is_fixed),
      note: payload.note || "",
      updated_at: new Date().toISOString(),
    };

    if (editingId) {
      setBudgetItems((current) => current.map((item) => (item.id === editingId ? { ...item, ...nextBudget } : item)));
      setBudgetParticipants((current) => [
        ...current.filter((participant) => participant.budget_item_id !== editingId),
        ...participantIds.map((userId) => ({
          id: demoId("demo-budget-participant"),
          budget_item_id: editingId,
          user_id: userId,
        })),
      ]);
      setItineraryBudgetLinks((current) => [
        ...current.filter((link) => link.budget_item_id !== editingId),
        ...(payload.linkedItemIds || []).map((itemId) => ({
          id: demoId("demo-link"),
          itinerary_item_id: itemId,
          budget_item_id: editingId,
        })),
      ]);
      return { ok: true };
    }

    const budgetId = demoId("demo-budget");
    setBudgetItems((current) => [...current, { ...nextBudget, id: budgetId, trip_id: demoTrip.id }]);
    setBudgetParticipants((current) => [
      ...current,
      ...participantIds.map((userId) => ({
        id: demoId("demo-budget-participant"),
        budget_item_id: budgetId,
        user_id: userId,
      })),
    ]);
    setItineraryBudgetLinks((current) => [
      ...current,
      ...(payload.linkedItemIds || []).map((itemId) => ({
        id: demoId("demo-link"),
        itinerary_item_id: itemId,
        budget_item_id: budgetId,
      })),
    ]);
    return { ok: true };
  }

  function savePersonalLuggage(payload, editingId) {
    if (!payload.title.trim()) return;
    if (editingId) {
      setLuggageItems((current) =>
        current.map((item) =>
          item.id === editingId ? { ...item, title: payload.title.trim(), category: payload.category.trim() } : item,
        ),
      );
      return;
    }
    setLuggageItems((current) => [
      ...current,
      { id: demoId("demo-luggage"), title: payload.title.trim(), category: payload.category.trim(), packed: false },
    ]);
  }

  function saveActualExpense(payload, editingId) {
    if (!payload.title.trim()) return { ok: false };
    const participantIds = payload.participantIds?.length ? payload.participantIds : demoMembers.map((member) => member.user_id);
    const amount = Number(payload.amount || 0);
    const exchangeRate = Number(payload.exchange_rate || 1);
    const nextExpense = {
      trip_id: demoTrip.id,
      budget_item_id: payload.budget_item_id || null,
      title: payload.title.trim(),
      amount,
      currency: payload.currency || "TWD",
      exchange_rate: exchangeRate,
      twd_amount: Math.round(amount * exchangeRate),
      payer_id: payload.payer_id || demoMembers[0].user_id,
      paid_at: payload.paid_at ? new Date(payload.paid_at).toISOString() : new Date().toISOString(),
      note: payload.note || "",
      updated_at: new Date().toISOString(),
    };

    if (editingId) {
      setActualExpenses((current) => current.map((expense) => (expense.id === editingId ? { ...expense, ...nextExpense } : expense)));
      setActualParticipants((current) => [
        ...current.filter((participant) => participant.actual_expense_id !== editingId),
        ...participantIds.map((userId) => ({
          id: demoId("demo-actual-participant"),
          actual_expense_id: editingId,
          user_id: userId,
        })),
      ]);
      return { ok: true };
    }

    const expenseId = demoId("demo-actual");
    setActualExpenses((current) => [...current, { ...nextExpense, id: expenseId }]);
    setActualParticipants((current) => [
      ...current,
      ...participantIds.map((userId) => ({
        id: demoId("demo-actual-participant"),
        actual_expense_id: expenseId,
        user_id: userId,
      })),
    ]);
    return { ok: true };
  }

  function convertBudgetToActual(budget) {
    const expenseId = demoId("demo-actual");
    const participantIds = budgetParticipants
      .filter((participant) => participant.budget_item_id === budget.id)
      .map((participant) => participant.user_id);
    setActualExpenses((current) => [
      ...current,
      {
        id: expenseId,
        trip_id: demoTrip.id,
        budget_item_id: budget.id,
        title: budget.title,
        amount: budget.amount,
        currency: budget.currency,
        exchange_rate: budget.exchange_rate,
        twd_amount: budget.twd_amount,
        payer_id: budget.payer_id,
        paid_at: new Date().toISOString(),
        note: budget.note || "由 Demo 預算轉成實付。",
        updated_at: new Date().toISOString(),
      },
    ]);
    setActualParticipants((current) => [
      ...current,
      ...(participantIds.length ? participantIds : demoMembers.map((member) => member.user_id)).map((userId) => ({
        id: demoId("demo-actual-participant"),
        actual_expense_id: expenseId,
        user_id: userId,
      })),
    ]);
    setBudgetItems((current) =>
      current.map((item) => (item.id === budget.id ? { ...item, auto_created_actual_expense_id: expenseId } : item)),
    );
  }

  function saveSharedLuggage(payload, editingId) {
    if (!payload.title.trim()) return;
    if (editingId) {
      setSharedLuggageItems((current) =>
        current.map((item) =>
          item.id === editingId
            ? { ...item, title: payload.title.trim(), category: payload.category.trim(), assigned_to: payload.assigned_to }
            : item,
        ),
      );
      return;
    }
    setSharedLuggageItems((current) => [
      ...current,
      {
        id: demoId("demo-shared-luggage"),
        title: payload.title.trim(),
        category: payload.category.trim(),
        assigned_to: payload.assigned_to,
        packed_by_assignee: false,
        confirmed_by_owner: false,
      },
    ]);
  }

  return (
    <section className="demo-shell">
      <aside className="demo-sidebar">
        <div className="brand">
          <div className="brand-mark">TP</div>
          <div className="brand-copy">
            <h1>旅遊規劃</h1>
            <p>展示模式</p>
          </div>
        </div>
        <nav className="section-nav" aria-label="Demo 導覽">
          {["timeline", "budget", "luggage"].map((section) => (
            <button
              className={`section-nav-button${activeSection === section ? " active" : ""}`}
              key={section}
              type="button"
              onClick={() => changeSection(section)}
            >
              <span className="section-nav-icon" aria-hidden="true">
                {section === "timeline" ? "程" : section === "budget" ? "$" : "李"}
              </span>
              <span className="nav-label">{demoSectionLabel(section)}</span>
            </button>
          ))}
        </nav>
      </aside>
      <main className="workspace demo-workspace">
        <div className="demo-banner">Demo Mode：這是展示資料，操作不會永久保存。</div>
        <header className="topbar">
          <div>
            <p className="eyebrow">展示資料沙盒</p>
            <h2>{demoTrip.title}</h2>
          </div>
        </header>
        {activeSection === "timeline" ? (
          <>
            <div className="timeline-top-row">
              <DayTabs activeDay={activeDay} dayPrefix="第" daySuffix="天" days={days} onActiveDay={selectTimelineDay} />
              <button className="ghost-button compact" type="button" onClick={() => setIsRouteCollapsed((value) => !value)}>
                {isRouteCollapsed ? "顯示地圖" : "隱藏地圖"}
              </button>
            </div>
            <div className={`content-grid timeline-workbench${isRouteCollapsed ? " route-collapsed" : ""}`}>
              {isRouteCollapsed ? (
                <button
                  className="board-scroll-button left"
                  disabled={!dayBoardNavigation.scrollState.left}
                  type="button"
                  aria-label="前一天"
                  onClick={() => dayBoardNavigation.scrollByDirection(-1)}
                >
                  ←
                </button>
              ) : null}
              <section className="panel itinerary-panel" ref={dayBoardNavigation.boardRef}>
                <ItineraryTimeline
                  activeDay={activeDay}
                  activeTrip={demoTrip}
                  alternativesByItem={{}}
                  budgetsByItem={budgetsByItem}
                  canEdit
                  currentUserId="demo-peter"
                  dayItems={dayItems}
                  dayDateLabel={days[activeDay] ? formatDate(days[activeDay]) : ""}
                  dayLabel={days[activeDay] ? `第 ${activeDay + 1} 天 / ${formatDate(days[activeDay])}` : ""}
                  dayTitle={`Day ${activeDay + 1}`}
                  disableDraftAutosave
                  focusedItemId={focusedItemId}
                  headingEyebrow="行程"
                  members={demoMembers}
                  onApplyAlternative={() => {}}
                  onDeleteAlternative={() => {}}
                  onDeleteItem={(itemId) => {
                    setTimelineItems((current) => current.filter((item) => item.id !== itemId));
                    setItineraryBudgetLinks((current) => current.filter((link) => link.itinerary_item_id !== itemId));
                  }}
                  onFocusItem={setFocusedItemId}
                  onReorderItem={() => {}}
                  onSaveAlternative={() => ({ ok: true })}
                  onSaveItem={saveTimelineItem}
                  restoreDrafts={false}
                  useEditLocks={false}
                />
                {isRouteCollapsed ? (
                  <MultiDayTimelineColumns
                    activeDay={activeDay}
                    days={days}
                    focusedItemId={focusedItemId}
                    itemsByDay={itemsByDay}
                    onActiveDay={setActiveDay}
                  onFocusItem={setFocusedItemId}
                />
              ) : null}
              </section>
              {isRouteCollapsed ? (
                <button
                  className="board-scroll-button right"
                  disabled={!dayBoardNavigation.scrollState.right}
                  type="button"
                  aria-label="後一天"
                  onClick={() => dayBoardNavigation.scrollByDirection(1)}
                >
                  →
                </button>
              ) : null}
              {isRouteCollapsed ? null : (
                <aside className="side-panels">
                  <RoutePanel dayItems={dayItems} focusedItemId={focusedItemId} headingEyebrow="路線" onFocusItem={setFocusedItemId} />
                </aside>
              )}
            </div>
          </>
        ) : null}
        {activeSection === "budget" ? (
          <BudgetPanel
            activeTrip={demoTrip}
            actualExpenses={actualExpenses}
            actualParticipants={actualParticipants}
            attachments={[]}
            budgetItems={budgetItems}
            budgetParticipants={budgetParticipants}
            canEdit
            currentUserId="demo-peter"
            disableDraftAutosave
            enableAttachments={false}
            headingEyebrow="預算"
            itineraryBudgetLinks={itineraryBudgetLinks}
            items={timelineItems}
            members={demoMembers}
            onConvertToActual={convertBudgetToActual}
            onDelete={(budgetId) => {
              setBudgetItems((current) => current.filter((item) => item.id !== budgetId));
              setBudgetParticipants((current) => current.filter((participant) => participant.budget_item_id !== budgetId));
              setItineraryBudgetLinks((current) => current.filter((link) => link.budget_item_id !== budgetId));
            }}
            onDeleteActual={(expenseId) => {
              setActualExpenses((current) => current.filter((expense) => expense.id !== expenseId));
              setActualParticipants((current) => current.filter((participant) => participant.actual_expense_id !== expenseId));
              setBudgetItems((current) =>
                current.map((item) =>
                  item.auto_created_actual_expense_id === expenseId
                    ? { ...item, auto_created_actual_expense_id: null }
                    : item,
                ),
              );
            }}
            onDeleteAttachment={() => {}}
            onOpenAttachment={() => {}}
            onSave={saveBudgetItem}
            onSaveActual={saveActualExpense}
            onUploadAttachment={() => {}}
            restoreDrafts={false}
            useEditLocks={false}
          />
        ) : null}
        {activeSection === "luggage" ? (
          <DemoLuggageView
            currentUserId="demo-peter"
            luggageItems={luggageItems}
            members={demoMembers}
            sharedLuggageItems={sharedLuggageItems}
            onDeletePersonal={(itemId) => setLuggageItems((current) => current.filter((item) => item.id !== itemId))}
            onDeleteShared={(itemId) =>
              setSharedLuggageItems((current) => current.filter((item) => item.id !== itemId))
            }
            onSavePersonal={savePersonalLuggage}
            onSaveShared={saveSharedLuggage}
            onTogglePersonal={(item) =>
              setLuggageItems((current) =>
                current.map((entry) => (entry.id === item.id ? { ...entry, packed: !entry.packed } : entry)),
              )
            }
            onUpdateShared={(itemId, patch) =>
              setSharedLuggageItems((current) =>
                current.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
              )
            }
          />
        ) : null}
      </main>
      <nav className="bottom-nav" aria-label="Demo 手機導覽">
        {["timeline", "budget", "luggage"].map((section) => (
          <button
            className={`bottom-nav-button${activeSection === section ? " active" : ""}`}
            key={section}
            type="button"
            onClick={() => changeSection(section)}
          >
            {demoSectionLabel(section)}
          </button>
        ))}
      </nav>
    </section>
  );
}

function DemoLuggageView({
  currentUserId,
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
  const [editingPersonalId, setEditingPersonalId] = useState(null);
  const [editingSharedId, setEditingSharedId] = useState(null);
  const [personalForm, setPersonalForm] = useState(emptyLuggageForm);
  const [sharedForm, setSharedForm] = useState(emptySharedLuggageForm);
  const memberById = new Map(members.map((member) => [member.user_id, member]));
  const assignedSharedItems = sharedLuggageItems.filter((item) => item.assigned_to === currentUserId);

  function resetPersonal() {
    setEditingPersonalId(null);
    setPersonalForm(emptyLuggageForm);
  }

  function resetShared() {
    setEditingSharedId(null);
    setSharedForm(emptySharedLuggageForm);
  }

  function submitPersonal(event) {
    event.preventDefault();
    onSavePersonal(personalForm, editingPersonalId);
    resetPersonal();
  }

  function submitShared(event) {
    event.preventDefault();
    onSaveShared(sharedForm, editingSharedId);
    resetShared();
  }

  return (
    <section className="panel luggage-panel demo-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">行李 Demo</p>
          <h3>行李</h3>
        </div>
      </div>
      <div className="mobile-tabs">
        <button className={activeTab === "personal" ? "active" : ""} type="button" onClick={() => setActiveTab("personal")}>
          個人行李
        </button>
        <button className={activeTab === "shared" ? "active" : ""} type="button" onClick={() => setActiveTab("shared")}>
          團隊公物
        </button>
      </div>
      <div className="luggage-layout">
        <section className={`luggage-column${activeTab === "personal" ? " active" : ""}`}>
          <div className="panel-heading tight">
            <div>
              <p className="eyebrow">個人</p>
              <h3>個人行李</h3>
            </div>
            <span className="pill">
              {luggageItems.filter((item) => item.packed).length}/{luggageItems.length}
            </span>
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
            <button className="icon-button small" disabled={!personalForm.title.trim()} type="submit">
              {editingPersonalId ? "S" : "+"}
            </button>
            {editingPersonalId ? (
              <button className="mini-button" type="button" onClick={resetPersonal}>
                取消
              </button>
            ) : null}
          </form>
          <div className="luggage-list">
            {luggageItems.map((item) => (
              <article className={`luggage-row${item.packed ? " packed" : ""}`} key={item.id}>
                <input checked={item.packed} type="checkbox" onChange={() => onTogglePersonal(item)} />
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.category || "未分類"}</span>
                </div>
                <div className="member-actions">
                  <button
                    className="mini-button"
                    type="button"
                    onClick={() => {
                      setEditingPersonalId(item.id);
                      setPersonalForm({ title: item.title || "", category: item.category || "" });
                    }}
                  >
                    E
                  </button>
                  <button className="mini-button" type="button" onClick={() => onDeletePersonal(item.id)}>
                    X
                  </button>
                </div>
              </article>
            ))}
          </div>
          <div className="assigned-shared-list">
            <div className="panel-heading tight">
              <div>
                <p className="eyebrow">指派</p>
                <h3>指派給我的公物</h3>
              </div>
            </div>
            {assignedSharedItems.map((item) => (
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
                <span className="pill">{item.confirmed_by_owner ? "總召已確認" : "等待總召確認"}</span>
              </article>
            ))}
          </div>
        </section>
        <section className={`luggage-column${activeTab === "shared" ? " active" : ""}`}>
          <div className="panel-heading tight">
            <div>
              <p className="eyebrow">團隊</p>
              <h3>團隊公物</h3>
            </div>
            <span className="pill">{sharedLuggageItems.length} 件</span>
          </div>
          <form className="shared-luggage-form" onSubmit={submitShared}>
            <input
              placeholder="新增團隊公物"
              value={sharedForm.title}
              onChange={(event) => setSharedForm({ ...sharedForm, title: event.target.value })}
            />
            <input
              placeholder="分類"
              value={sharedForm.category}
              onChange={(event) => setSharedForm({ ...sharedForm, category: event.target.value })}
            />
            <select value={sharedForm.assigned_to} onChange={(event) => setSharedForm({ ...sharedForm, assigned_to: event.target.value })}>
              <option value="">未指派</option>
              {members.map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {memberName(member)}
                </option>
              ))}
            </select>
            <button className="icon-button small" disabled={!sharedForm.title.trim()} type="submit">
              {editingSharedId ? "S" : "+"}
            </button>
            {editingSharedId ? (
              <button className="mini-button" type="button" onClick={resetShared}>
                取消
              </button>
            ) : null}
          </form>
          <div className="luggage-list">
            {sharedLuggageItems.map((item) => {
              const assignee = memberById.get(item.assigned_to);
              return (
                <article className="shared-luggage-row" key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>
                      {item.category || "未分類"} / {assignee ? memberName(assignee) : "未指派"}
                    </span>
                  </div>
                  <label className="checkbox-label">
                    <input
                      checked={item.packed_by_assignee}
                      type="checkbox"
                      onChange={() => onUpdateShared(item.id, { packed_by_assignee: !item.packed_by_assignee })}
                    />
                    已打包
                  </label>
                  <label className="checkbox-label">
                    <input
                      checked={item.confirmed_by_owner}
                      type="checkbox"
                      onChange={() => onUpdateShared(item.id, { confirmed_by_owner: !item.confirmed_by_owner })}
                    />
                    總召確認
                  </label>
                  <div className="member-actions">
                    <button
                      className="mini-button"
                      type="button"
                      onClick={() => {
                        setEditingSharedId(item.id);
                        setSharedForm({
                          title: item.title || "",
                          category: item.category || "",
                          assigned_to: item.assigned_to || "",
                        });
                      }}
                    >
                      E
                    </button>
                    <button className="mini-button" type="button" onClick={() => onDeleteShared(item.id)}>
                      X
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </section>
  );
}

function LuggageView({
  currentUserId,
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
  const [editingPersonalId, setEditingPersonalId] = useState(null);
  const [editingSharedId, setEditingSharedId] = useState(null);
  const [personalForm, setPersonalForm] = useState(emptyLuggageForm);
  const [sharedForm, setSharedForm] = useState(emptySharedLuggageForm);
  const memberById = new Map(members.map((member) => [member.user_id, member]));
  const assignedSharedItems = sharedLuggageItems.filter((item) => item.assigned_to === currentUserId);

  function resetPersonal() {
    setEditingPersonalId(null);
    setPersonalForm(emptyLuggageForm);
  }

  function resetShared() {
    setEditingSharedId(null);
    setSharedForm(emptySharedLuggageForm);
  }

  function submitPersonal(event) {
    event.preventDefault();
    onSavePersonal(personalForm, editingPersonalId);
    resetPersonal();
  }

  function submitShared(event) {
    event.preventDefault();
    onSaveShared(sharedForm, editingSharedId);
    resetShared();
  }

  return (
    <section className="panel luggage-panel demo-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">行李 Demo</p>
          <h3>行李</h3>
        </div>
      </div>
      <div className="mobile-tabs">
        <button className={activeTab === "personal" ? "active" : ""} type="button" onClick={() => setActiveTab("personal")}>
          個人行李
        </button>
        <button className={activeTab === "shared" ? "active" : ""} type="button" onClick={() => setActiveTab("shared")}>
          團隊公物
        </button>
      </div>
      <div className="luggage-layout">
        <section className={`luggage-column${activeTab === "personal" ? " active" : ""}`}>
          <div className="panel-heading tight">
            <div>
              <p className="eyebrow">個人</p>
              <h3>個人行李</h3>
            </div>
            <span className="pill">
              {luggageItems.filter((item) => item.packed).length}/{luggageItems.length}
            </span>
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
            <button className="icon-button small" disabled={!personalForm.title.trim()} type="submit">
              {editingPersonalId ? "S" : "+"}
            </button>
            {editingPersonalId ? (
              <button className="mini-button" type="button" onClick={resetPersonal}>
                取消
              </button>
            ) : null}
          </form>
          <div className="luggage-list">
            {luggageItems.map((item) => (
              <article className={`luggage-row${item.packed ? " packed" : ""}`} key={item.id}>
                <input checked={item.packed} type="checkbox" onChange={() => onTogglePersonal(item)} />
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.category || "未分類"}</span>
                </div>
                <div className="member-actions">
                  <button
                    className="mini-button"
                    type="button"
                    onClick={() => {
                      setEditingPersonalId(item.id);
                      setPersonalForm({ title: item.title || "", category: item.category || "" });
                    }}
                  >
                    E
                  </button>
                  <button className="mini-button" type="button" onClick={() => onDeletePersonal(item.id)}>
                    X
                  </button>
                </div>
              </article>
            ))}
          </div>
          <div className="assigned-shared-list">
            <div className="panel-heading tight">
              <div>
                <p className="eyebrow">指派</p>
                <h3>指派給我的公物</h3>
              </div>
            </div>
            {assignedSharedItems.map((item) => (
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
                <span className="pill">{item.confirmed_by_owner ? "總召已確認" : "等待總召確認"}</span>
              </article>
            ))}
          </div>
        </section>
        <section className={`luggage-column${activeTab === "shared" ? " active" : ""}`}>
          <div className="panel-heading tight">
            <div>
              <p className="eyebrow">團隊</p>
              <h3>團隊公物</h3>
            </div>
            <span className="pill">{sharedLuggageItems.length} 件</span>
          </div>
          <form className="shared-luggage-form" onSubmit={submitShared}>
            <input
              placeholder="新增團隊公物"
              value={sharedForm.title}
              onChange={(event) => setSharedForm({ ...sharedForm, title: event.target.value })}
            />
            <input
              placeholder="分類"
              value={sharedForm.category}
              onChange={(event) => setSharedForm({ ...sharedForm, category: event.target.value })}
            />
            <select value={sharedForm.assigned_to} onChange={(event) => setSharedForm({ ...sharedForm, assigned_to: event.target.value })}>
              <option value="">未指派</option>
              {members.map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {memberName(member)}
                </option>
              ))}
            </select>
            <button className="icon-button small" disabled={!sharedForm.title.trim()} type="submit">
              {editingSharedId ? "S" : "+"}
            </button>
            {editingSharedId ? (
              <button className="mini-button" type="button" onClick={resetShared}>
                取消
              </button>
            ) : null}
          </form>
          <div className="luggage-list">
            {sharedLuggageItems.map((item) => {
              const assignee = memberById.get(item.assigned_to);
              return (
                <article className="shared-luggage-row" key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>
                      {item.category || "未分類"} / {assignee ? memberName(assignee) : "未指派"}
                    </span>
                  </div>
                  <label className="checkbox-label">
                    <input
                      checked={item.packed_by_assignee}
                      type="checkbox"
                      onChange={() => onUpdateShared(item.id, { packed_by_assignee: !item.packed_by_assignee })}
                    />
                    已打包
                  </label>
                  <label className="checkbox-label">
                    <input
                      checked={item.confirmed_by_owner}
                      type="checkbox"
                      onChange={() => onUpdateShared(item.id, { confirmed_by_owner: !item.confirmed_by_owner })}
                    />
                    總召確認
                  </label>
                  <div className="member-actions">
                    <button
                      className="mini-button"
                      type="button"
                      onClick={() => {
                        setEditingSharedId(item.id);
                        setSharedForm({
                          title: item.title || "",
                          category: item.category || "",
                          assigned_to: item.assigned_to || "",
                        });
                      }}
                    >
                      E
                    </button>
                    <button className="mini-button" type="button" onClick={() => onDeleteShared(item.id)}>
                      X
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </section>
  );
}

function ConflictNotice({ onKeep, onLatest }) {
  return (
    <div className="draft-conflict" role="alert">
      <strong>此資料在你編輯期間已被其他人更新。</strong>
      <span>你可以保留目前草稿，或查看最新版本。</span>
      <div className="conflict-actions">
        <button className="mini-button" type="button" onClick={onKeep}>
          保留我的草稿
        </button>
        <button className="mini-button" type="button" onClick={onLatest}>
          查看最新版本
        </button>
      </div>
    </div>
  );
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
        <div className="demo-login-entry">
          <a className="ghost-button demo-login-link" href="/demo/timeline">
            查看 Demo 頁面
          </a>
          <span>不需登入，使用展示資料。</span>
        </div>
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
    luggageTab,
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
    onLuggageTabChange,
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
  const [isRouteCollapsed, setIsRouteCollapsed] = useState(false);
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
  const itemsByDay = useMemo(
    () => days.map((_, index) => sortScheduleItems(items.filter((item) => item.day_index === index))),
    [days, items],
  );
  const dayBoardNavigation = useDayBoardNavigation(activeDay, isRouteCollapsed);

  function selectTimelineDay(dayIndex) {
    onActiveDay(dayIndex);
    if (isRouteCollapsed) dayBoardNavigation.scrollToDay(dayIndex);
  }

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
        <div className="timeline-top-row">
          <DayTabs activeDay={activeDay} days={days} onActiveDay={selectTimelineDay} />
          <button className="ghost-button compact" type="button" onClick={() => setIsRouteCollapsed((value) => !value)}>
            {isRouteCollapsed ? "顯示地圖" : "隱藏地圖"}
          </button>
        </div>
      )}

      {isBudgetMode ? (
        <BudgetPanel
          activeTrip={activeTrip}
          budgetItems={budgetItems}
          budgetParticipants={budgetParticipants}
          canEdit={canEdit}
          actualExpenses={actualExpenses}
          actualParticipants={actualParticipants}
          attachments={attachments}
          itineraryBudgetLinks={itineraryBudgetLinks}
          items={items}
          members={members}
          currentUserId={currentUserId}
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
          activeTrip={activeTrip}
          accommodations={accommodations}
          attachments={attachments}
          budgetItems={budgetItems}
          canEdit={canEdit}
          currentUserId={currentUserId}
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
          activeTrip={activeTrip}
          canEdit={canEdit}
          currentUserId={currentUserId}
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
          activeTrip={activeTrip}
          activeTab={luggageTab}
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
          onTabChange={onLuggageTabChange}
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
        className={`content-grid timeline-workbench${isRouteCollapsed ? " route-collapsed" : ""}${
          isTodayMode || isBudgetMode || isAccommodationMode || isTodoMode || isLuggageMode || isSettlementMode
            ? " hidden-section"
            : ""
        }`}
      >
        {isRouteCollapsed ? (
          <button
            className="board-scroll-button left"
            disabled={!dayBoardNavigation.scrollState.left}
            type="button"
            aria-label="前一天"
            onClick={() => dayBoardNavigation.scrollByDirection(-1)}
          >
            ←
          </button>
        ) : null}
        <section className="panel itinerary-panel" ref={dayBoardNavigation.boardRef}>
          <ItineraryTimeline
                activeTrip={activeTrip}
                activeDay={activeDay}
                alternativesByItem={alternativesByItem}
                budgetsByItem={budgetsByItem}
                canEdit={canEdit}
                currentUserId={currentUserId}
                members={members}
                dayItems={dayItems}
                dayDateLabel={days[activeDay] ? formatDate(days[activeDay]) : ""}
                dayLabel={days[activeDay] ? `Day ${activeDay + 1} · ${formatDate(days[activeDay])}` : ""}
                dayTitle={`Day ${activeDay + 1}`}
                focusedItemId={focusedItemId}
                onApplyAlternative={onApplyAlternative}
                onDeleteAlternative={onDeleteAlternative}
                onDeleteItem={onDeleteItem}
                onFocusItem={setFocusedItemId}
                onReorderItem={onReorderItem}
                onSaveAlternative={onSaveAlternative}
                onSaveItem={onSaveItem}
              />
              {isRouteCollapsed ? (
                <MultiDayTimelineColumns
                  activeDay={activeDay}
                  days={days}
                  focusedItemId={focusedItemId}
                  itemsByDay={itemsByDay}
                  onActiveDay={onActiveDay}
                  onFocusItem={setFocusedItemId}
                />
              ) : null}
            </section>

            {isRouteCollapsed ? (
              <button
                className="board-scroll-button right"
                disabled={!dayBoardNavigation.scrollState.right}
                type="button"
                aria-label="後一天"
                onClick={() => dayBoardNavigation.scrollByDirection(1)}
              >
                →
              </button>
            ) : null}
            {isRouteCollapsed ? null : (
              <aside className="side-panels">
                <RoutePanel dayItems={dayItems} focusedItemId={focusedItemId} onFocusItem={setFocusedItemId} />
              </aside>
            )}
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
          看行程
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
                  <time>{formatTimeDisplay(item.start_time) || "--:--"}</time>
                  <div>
                    <strong>{item.title}</strong>
                    {item.location ? <span>{item.location}</span> : null}
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
          <p>{nextStop?.location || formatTimeDisplay(nextStop?.start_time) || "新增行程後會顯示"}</p>
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
          <p>{hotelItem?.location || "可在行程加入住宿"}</p>
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

function DayTabs({ activeDay, dayPrefix = "Day", daySuffix = "", days, onActiveDay }) {
  return (
    <nav className="day-tabs" aria-label="日期切換">
      {days.map((date, index) => (
        <button
          className={`day-tab${index === activeDay ? " active" : ""}`}
          key={date.toISOString()}
          type="button"
          onClick={() => onActiveDay(index)}
        >
          {dayPrefix} {index + 1} {daySuffix} {formatDate(date)}
        </button>
      ))}
    </nav>
  );
}

function ItineraryTimeline({
  activeDay = 0,
  activeTrip,
  alternativesByItem,
  budgetsByItem,
  canEdit,
  currentUserId,
  dayItems,
  dayDateLabel,
  dayLabel,
  dayTitle,
  disableDraftAutosave = false,
  focusedItemId,
  headingEyebrow = "行程",
  members,
  onApplyAlternative,
  onDeleteAlternative,
  onDeleteItem,
  onFocusItem,
  onReorderItem,
  onSaveAlternative,
  onSaveItem,
  restoreDrafts = true,
  useEditLocks = true,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formSeed, setFormSeed] = useState(emptyItemForm);
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(null);
  const [editorTripId, setEditorTripId] = useState(null);
  const [restoredDraftKey, setRestoredDraftKey] = useState(null);
  const [conflict, setConflict] = useState(false);
  const [timeError, setTimeError] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const { draftKey, flushDraft, form, hasUnsavedChanges, replaceForm, resetDraft, setForm } = useDraftAutosave({
    defaultForm: formSeed,
    disabled: disableDraftAutosave,
    editingId,
    entityType: "itinerary_item",
    forceDirtyOnOpen: Boolean(restoredDraftKey),
    isOpen,
    serverUpdatedAt: baseUpdatedAt,
    tripId: activeTrip?.id,
    userId: currentUserId,
  });
  const memberById = new Map((members || []).map((member) => [member.user_id, member]));
  const activeEditorGuard = useMemo(
    () => ({
      discard: () => closeEditor(true),
      isActive: isOpen,
      isDirty: hasUnsavedChanges,
      save: () => saveCurrentEditor(),
    }),
    [form, hasUnsavedChanges, isOpen, editingId, baseUpdatedAt, draftKey],
  );

  useActiveEditorGuard(`timeline:${activeTrip?.id || "no-trip"}`, activeEditorGuard);

  useEffect(() => {
    if (!isOpen || !editorTripId || !activeTrip?.id || editorTripId === activeTrip.id) return;
    if (useEditLocks && editingId) {
      void releaseEditLock({ recordId: editingId, supabase, table: "itinerary_items", userId: currentUserId });
    }
    replaceForm(emptyItemForm);
    setFormSeed(emptyItemForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setTimeError("");
    setEditingId(null);
    setEditorTripId(null);
    setRestoredDraftKey(null);
    setIsOpen(false);
  }, [activeTrip?.id, currentUserId, editingId, editorTripId, isOpen, replaceForm, useEditLocks]);

  useEffect(() => {
    if (!restoreDrafts || isOpen || !activeTrip?.id || !currentUserId) return;
    const latest = loadLatestDraftForEntity({
      entityType: "itinerary_item",
      tripId: activeTrip.id,
      userId: currentUserId,
    });
    if (!latest) return;
    const matchingItem = dayItems.find((item) => item.id === latest.entityId);
    if (latest.entityId !== "new" && !matchingItem) return;
    const nextForm = {
      ...latest.draft.form,
      start_time: formatTimeDisplay(latest.draft.form?.start_time),
      end_time: formatTimeDisplay(latest.draft.form?.end_time),
    };
    flushDraft();
    replaceForm(nextForm);
    setFormSeed(nextForm);
    setBaseUpdatedAt(latest.entityId === "new" ? latest.draft.serverUpdatedAt || null : matchingItem?.updated_at || null);
    setConflict(false);
    setTimeError("");
    setEditingId(latest.entityId === "new" ? null : latest.entityId);
    setEditorTripId(activeTrip.id);
    setRestoredDraftKey(latest.key);
    setIsOpen(true);
  }, [activeTrip?.id, currentUserId, dayItems, isOpen, restoreDrafts]);

  async function openNewItem() {
    if (isOpen) {
      const canContinue = hasUnsavedChanges ? await requestActiveEditorGuardResolution() : true;
      if (!canContinue) return;
      if (!hasUnsavedChanges) await closeEditor(true);
    }
    const lastItem = dayItems[dayItems.length - 1];
    const defaultStartTime = lastItem?.end_time ? formatTimeDisplay(lastItem.end_time) : "";
    const nextForm = { ...emptyItemForm, start_time: defaultStartTime };
    flushDraft();
    replaceForm(nextForm);
    setFormSeed(nextForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setTimeError("");
    setEditingId(null);
    setEditorTripId(activeTrip?.id || null);
    setRestoredDraftKey(null);
    setIsOpen(true);
  }

  async function openEditItem(item) {
    if (useEditLocks && isLockedByAnotherUser(item, currentUserId)) return;
    if (isOpen && editingId !== item.id) {
      const canContinue = hasUnsavedChanges ? await requestActiveEditorGuardResolution() : true;
      if (!canContinue) return;
      if (!hasUnsavedChanges) await closeEditor(true);
    }
    let lockedItem = item;
    if (useEditLocks) {
      const lockResult = await acquireEditLock({ record: item, supabase, table: "itinerary_items", userId: currentUserId });
      if (lockResult.error) return;
      if (lockResult.lockedByAnotherUser) return;
      lockedItem = lockResult.data || item;
    }
    const nextForm = {
      type: item.type,
      start_time: formatTimeDisplay(item.start_time),
      end_time: formatTimeDisplay(item.end_time),
      title: item.title,
      location: item.location_name || item.location || "",
      location_name: item.location_name || item.location || "",
      address: item.address || "",
      map_url: item.map_url || "",
      note: item.description || item.note || "",
      description: item.description || item.note || "",
      transportation_note: item.transportation_note || "",
      cost: item.cost || 0,
    };
    flushDraft();
    replaceForm(nextForm);
    setFormSeed(nextForm);
    setBaseUpdatedAt(lockedItem.updated_at || item.updated_at || null);
    setConflict(false);
    setTimeError("");
    setEditingId(item.id);
    setEditorTripId(activeTrip?.id || null);
    setRestoredDraftKey(null);
    setIsOpen(true);
  }

  async function closeEditor(force = false) {
    if (!force && hasUnsavedChanges && !window.confirm("放棄尚未儲存的變更？")) return;
    if (useEditLocks && editingId) await releaseEditLock({ recordId: editingId, supabase, table: "itinerary_items", userId: currentUserId });
    if (!disableDraftAutosave) clearDraft(draftKey);
    resetDraft(emptyItemForm);
    setFormSeed(emptyItemForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setTimeError("");
    setEditingId(null);
    setEditorTripId(null);
    setRestoredDraftKey(null);
    setIsOpen(false);
  }

  async function saveCurrentEditor(formData = new FormData()) {
    const destination = String(formData.get("location_name") ?? form.location_name ?? form.location ?? "").trim();
    const submittedForm = {
      ...form,
      type: String(formData.get("type") ?? form.type ?? ""),
      start_time: String(formData.get("start_time") ?? form.start_time ?? ""),
      end_time: String(formData.get("end_time") ?? form.end_time ?? ""),
      title: destination || String(form.title ?? ""),
      location: destination,
      location_name: destination,
      address: String(formData.get("address") ?? form.address ?? ""),
      map_url: String(formData.get("map_url") ?? form.map_url ?? ""),
      note: String(formData.get("note") ?? form.note ?? form.description ?? ""),
      description: String(formData.get("description") ?? form.description ?? form.note ?? ""),
      transportation_note: String(formData.get("transportation_note") ?? form.transportation_note ?? ""),
      cost: String(formData.get("cost") ?? form.cost ?? 0),
    };
    const invalidTimeRange = isInvalidTimeRange(submittedForm.start_time, submittedForm.end_time);
    if (invalidTimeRange) {
      setTimeError("結束時間必須晚於開始時間。");
      setForm(submittedForm);
      return false;
    }
    setTimeError("");
    const result = await onSaveItem(
      {
        ...submittedForm,
        title: (submittedForm.location_name || submittedForm.location || submittedForm.title).trim(),
        location: (submittedForm.location_name || submittedForm.location).trim(),
        location_name: (submittedForm.location_name || submittedForm.location).trim(),
        address: submittedForm.address.trim(),
        map_url: submittedForm.map_url.trim(),
        note: (submittedForm.description || submittedForm.note).trim(),
        description: (submittedForm.description || submittedForm.note).trim(),
        transportation_note: submittedForm.transportation_note.trim(),
        cost: Number(submittedForm.cost || 0),
      },
      editingId,
      { baseUpdatedAt, tripId: editorTripId },
    );
    if (!result?.ok) {
      if (result?.conflict) setConflict(true);
      return false;
    }
    if (!disableDraftAutosave) clearDraft(draftKey);
    resetDraft(emptyItemForm);
    setFormSeed(emptyItemForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setTimeError("");
    setEditingId(null);
    setEditorTripId(null);
    setRestoredDraftKey(null);
    setIsOpen(false);
    return true;
  }

  async function submit(event) {
    event.preventDefault();
    await saveCurrentEditor(new FormData(event.currentTarget));
  }

  return (
    <div className="timeline-day-column active" data-day-index={activeDay} style={{ order: activeDay }}>
      <div className="panel-heading timeline-column-header">
        <div>
          <p className="eyebrow">{dayTitle || headingEyebrow}</p>
          <h3>{dayDateLabel || dayLabel}</h3>
        </div>
        <button className="icon-button" disabled={!canEdit} type="button" title="新增行程" onClick={openNewItem}>
          +
        </button>
      </div>

      {isOpen ? (
        <form className="item-form" onSubmit={submit}>
          {conflict ? (
            <ConflictNotice onKeep={() => setConflict(false)} onLatest={() => closeEditor(true)} />
          ) : null}
          {timeError ? (
            <div className="notice inline-error" role="alert">
              <span>{timeError}</span>
            </div>
          ) : null}
          <div className="field-group form-grid">
            <label>
              類型
              <select name="type" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
                {Object.entries(typeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              開始
              <select
                name="start_time"
                value={form.start_time}
                onChange={(event) => {
                  setTimeError("");
                  setForm({ ...form, start_time: event.target.value });
                }}
              >
                <option value="">未設定</option>
                {timelineTimeOptions.map((time) => (
                  <option key={time} value={time}>
                    {time}
                  </option>
                ))}
              </select>
            </label>
            <label>
              結束
              <select
                name="end_time"
                value={form.end_time}
                onChange={(event) => {
                  setTimeError("");
                  setForm({ ...form, end_time: event.target.value });
                }}
              >
                <option value="">未設定</option>
                {timelineTimeOptions.map((time) => (
                  <option key={time} value={time}>
                    {time}
                  </option>
                ))}
              </select>
            </label>
            <label>
              費用
              <input
                min="0"
                name="cost"
                step="1"
                type="number"
                value={form.cost}
                onChange={(event) => setForm({ ...form, cost: event.target.value })}
              />
            </label>
          </div>
          <div className="field-group form-grid wide single">
            <label>
              目的地
              <input
                placeholder="目的地或店名"
                name="location_name"
                required
                value={form.location_name || form.location}
                onChange={(event) =>
                  setForm({ ...form, title: event.target.value, location: event.target.value, location_name: event.target.value })
                }
              />
            </label>
          </div>
          <label className="full-label">
            備註
            <textarea
              name="description"
              rows="3"
              value={form.description || form.note}
              onChange={(event) => setForm({ ...form, note: event.target.value, description: event.target.value })}
            />
          </label>
          <div className="field-group form-grid wide">
            <label>
              地址
              <input
                name="address"
                value={form.address}
                onChange={(event) => setForm({ ...form, address: event.target.value })}
              />
            </label>
            <label>
              Map URL
              <input
                name="map_url"
                placeholder="https://maps.google.com/..."
                value={form.map_url}
                onChange={(event) => setForm({ ...form, map_url: event.target.value })}
              />
            </label>
          </div>
          <label className="full-label">
            交通備註
            <textarea
              name="transportation_note"
              rows="2"
              value={form.transportation_note}
              onChange={(event) => setForm({ ...form, transportation_note: event.target.value })}
            />
          </label>
          <div className="form-actions">
            <button className="ghost-button" type="button" onClick={() => closeEditor()}>
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
          dayItems.map((item) => {
            const lockedByOther = useEditLocks && isLockedByAnotherUser(item, currentUserId);
            const locker = memberById.get(item.locked_by);
            const destination = item.location_name || item.location || item.title;
            const secondaryText = item.note || item.description || item.transportation_note;
            const linkedBudgetTotal = (budgetsByItem[item.id] || []).reduce(
              (sum, budget) => sum + Number(budget.twd_amount || budget.amount || 0),
              0,
            );
            const displayCost = linkedBudgetTotal || Number(item.cost || 0);
            return (
            <article
              className={`timeline-item${focusedItemId === item.id ? " focused" : ""}${expandedId === item.id ? " expanded" : ""}`}
              key={item.id}
              onClick={() => {
                setExpandedId(expandedId === item.id ? null : item.id);
                onFocusItem(item.id);
              }}
            >
              <div className="time-block">
                {formatTimeDisplay(item.start_time) || "--:--"}
                <br />
                {formatTimeDisplay(item.end_time)}
              </div>
              <div className="item-main">
                <h4>{destination}</h4>
                {secondaryText ? <p className="item-summary">{secondaryText}</p> : null}
                <div className="item-meta">
                  <span
                    className="pill"
                    style={{ background: `${typeColors[item.type]}22`, color: typeColors[item.type] }}
                  >
                    {typeLabels[item.type]}
                  </span>
                  {displayCost > 0 ? <span className="pill">{formatMoney(displayCost)}</span> : null}
                  {(alternativesByItem[item.id] || []).length ? (
                    <span className="pill">{(alternativesByItem[item.id] || []).length} 個備案</span>
                  ) : null}
                </div>
                {lockedByOther ? <div className="lock-note">{memberName(locker)} 正在編輯這筆資料</div> : null}
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
                  disabled={!canEdit || lockedByOther}
                  type="button"
                  title="編輯"
                  onClick={(event) => {
                    event.stopPropagation();
                    openEditItem(item);
                  }}
                >
                  E
                </button>
                <button
                  className="mini-button"
                  disabled={!canEdit}
                  type="button"
                  title="刪除"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteItem(item.id);
                  }}
                >
                  X
                </button>
              </div>
            </article>
            );
          })
        ) : (
          <div className="timeline-empty">這一天還沒有行程</div>
        )}
      </div>
    </div>
  );
}

function MultiDayTimelineColumns({ activeDay, days, focusedItemId, itemsByDay, onActiveDay, onFocusItem }) {
  const otherDays = days
    .map((date, index) => ({ date, index, items: itemsByDay[index] || [] }))
    .filter((day) => day.index !== activeDay);
  if (!otherDays.length) return null;

  return (
    <>
      {otherDays.map((day) => (
        <section
          className="timeline-day-preview"
          data-day-index={day.index}
          key={day.date.toISOString()}
          role="button"
          tabIndex={0}
          style={{ order: day.index }}
          onClick={() => onActiveDay(day.index)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onActiveDay(day.index);
            }
          }}
        >
          <div className="timeline-day-preview-heading timeline-column-header">
            <div>
              <p className="eyebrow">Day {day.index + 1}</p>
              <h4>{formatDate(day.date)}</h4>
            </div>
          </div>
          <div className="timeline-preview-list">
            {day.items.length ? (
              day.items.map((item) => {
                const destination = item.location_name || item.location || item.title;
                const secondaryText = item.note || item.description || item.transportation_note;
                return (
                  <button
                    className={`timeline-preview-card${focusedItemId === item.id ? " focused" : ""}`}
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onActiveDay(day.index);
                      onFocusItem(item.id);
                    }}
                  >
                    <span className="time-block">{formatTimeDisplay(item.start_time) || "--:--"}</span>
                    <span>
                      <strong>{destination}</strong>
                      {secondaryText ? <em>{secondaryText}</em> : null}
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="timeline-empty compact">這一天還沒有行程</div>
            )}
          </div>
        </section>
      ))}
    </>
  );
}

function AlternativeList({ alternatives, canEdit, item, onApply, onDelete, onSave }) {
  function promptAlternative(alternative = null) {
    const title = window.prompt("備案標題", alternative?.title || "");
    if (!title?.trim()) return;
    const locationName = window.prompt("備案目的地", alternative?.location_name || "") || "";
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
              {alternative.location_name || alternative.address ? (
                <span>{alternative.location_name || alternative.address}</span>
              ) : null}
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

function RoutePanel({ dayItems, focusedItemId, headingEyebrow = "Route", onFocusItem }) {
  const stops = dayItems.filter((item) => item.location_name || item.location);
  return (
    <section className="panel">
      <div className="panel-heading tight">
        <div>
          <p className="eyebrow">{headingEyebrow}</p>
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
              <span className="route-name">{item.location_name || item.location}</span>
            </button>
          ))
        ) : (
          <div className="timeline-empty">尚無路線</div>
        )}
      </div>
    </section>
  );
}

function BudgetSummaryPanel({ budgetItems, headingEyebrow = "Budget", items }) {
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
          <p className="eyebrow">{headingEyebrow}</p>
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
  activeTrip,
  actualExpenses,
  actualParticipants,
  attachments,
  budgetItems,
  budgetParticipants,
  canEdit,
  currentUserId,
  disableDraftAutosave = false,
  enableAttachments = true,
  headingEyebrow = "Budget",
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
  restoreDrafts = true,
  useEditLocks = true,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formSeed, setFormSeed] = useState(emptyBudgetForm);
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(null);
  const [editorTripId, setEditorTripId] = useState(null);
  const [restoredDraftKey, setRestoredDraftKey] = useState(null);
  const [conflict, setConflict] = useState(false);
  const { draftKey, flushDraft, form, hasUnsavedChanges, replaceForm, resetDraft, setForm } = useDraftAutosave({
    defaultForm: formSeed,
    disabled: disableDraftAutosave,
    editingId,
    entityType: "budget_item",
    forceDirtyOnOpen: Boolean(restoredDraftKey),
    isOpen,
    serverUpdatedAt: baseUpdatedAt,
    tripId: activeTrip?.id,
    userId: currentUserId,
  });
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
  const activeEditorGuard = useMemo(
    () => ({
      discard: () => closeBudgetForm(true),
      isActive: isOpen,
      isDirty: hasUnsavedChanges,
      save: () => saveCurrentBudget(),
    }),
    [form, hasUnsavedChanges, isOpen, editingId, baseUpdatedAt, draftKey],
  );

  useActiveEditorGuard(`budget:${activeTrip?.id || "no-trip"}`, activeEditorGuard);

  useEffect(() => {
    if (!isOpen || !editorTripId || !activeTrip?.id || editorTripId === activeTrip.id) return;
    if (useEditLocks && editingId) {
      void releaseEditLock({ recordId: editingId, supabase, table: "budget_items", userId: currentUserId });
    }
    replaceForm(emptyBudgetForm);
    setFormSeed(emptyBudgetForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setEditingId(null);
    setEditorTripId(null);
    setRestoredDraftKey(null);
    setIsOpen(false);
  }, [activeTrip?.id, currentUserId, editingId, editorTripId, isOpen, replaceForm, useEditLocks]);

  useEffect(() => {
    if (!restoreDrafts || isOpen || !activeTrip?.id || !currentUserId) return;
    const latest = loadLatestDraftForEntity({
      entityType: "budget_item",
      tripId: activeTrip.id,
      userId: currentUserId,
    });
    if (!latest) return;
    const matchingItem = budgetItems.find((item) => item.id === latest.entityId);
    if (latest.entityId !== "new" && !matchingItem) return;
    setFormSeed(latest.draft.form);
    setBaseUpdatedAt(latest.entityId === "new" ? latest.draft.serverUpdatedAt || null : matchingItem?.updated_at || null);
    setConflict(false);
    setEditingId(latest.entityId === "new" ? null : latest.entityId);
    setEditorTripId(activeTrip.id);
    setRestoredDraftKey(latest.key);
    setIsOpen(true);
  }, [activeTrip?.id, budgetItems, currentUserId, isOpen, restoreDrafts]);

  async function openNewBudget() {
    if (isOpen) {
      const canContinue = hasUnsavedChanges ? await requestActiveEditorGuardResolution() : true;
      if (!canContinue) return;
      if (!hasUnsavedChanges) await closeBudgetForm(true);
    }
    const nextForm = {
      ...emptyBudgetForm,
      participantIds: approvedMembers.map((member) => member.user_id),
    };
    flushDraft();
    replaceForm(nextForm);
    setFormSeed(nextForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setEditingId(null);
    setEditorTripId(activeTrip?.id || null);
    setRestoredDraftKey(null);
    setIsOpen(true);
  }

  async function openEditBudget(item) {
    if (useEditLocks && isLockedByAnotherUser(item, currentUserId)) return;
    if (isOpen && editingId !== item.id) {
      const canContinue = hasUnsavedChanges ? await requestActiveEditorGuardResolution() : true;
      if (!canContinue) return;
      if (!hasUnsavedChanges) await closeBudgetForm(true);
    }
    let lockedItem = item;
    if (useEditLocks) {
      const lockResult = await acquireEditLock({ record: item, supabase, table: "budget_items", userId: currentUserId });
      if (lockResult.error || lockResult.lockedByAnotherUser) return;
      lockedItem = lockResult.data || item;
    }
    const nextForm = {
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
    };
    flushDraft();
    replaceForm(nextForm);
    setFormSeed(nextForm);
    setBaseUpdatedAt(lockedItem.updated_at || item.updated_at || null);
    setConflict(false);
    setEditingId(item.id);
    setEditorTripId(activeTrip?.id || null);
    setRestoredDraftKey(null);
    setIsOpen(true);
  }

  function toggleListValue(key, value) {
    const current = form[key] || [];
    setForm({
      ...form,
      [key]: current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    });
  }

  async function saveCurrentBudget() {
    const result = await onSave(form, editingId, { baseUpdatedAt, tripId: editorTripId });
    if (!result?.ok) {
      if (result?.conflict) setConflict(true);
      return false;
    }
    if (!disableDraftAutosave) clearDraft(draftKey);
    resetDraft(emptyBudgetForm);
    setFormSeed(emptyBudgetForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setIsOpen(false);
    setEditingId(null);
    setEditorTripId(null);
    setRestoredDraftKey(null);
    return true;
  }

  async function submit(event) {
    event.preventDefault();
    await saveCurrentBudget();
  }

  async function closeBudgetForm(force = false) {
    if (!force && hasUnsavedChanges && !window.confirm("放棄尚未儲存的變更？")) return;
    if (useEditLocks && editingId) await releaseEditLock({ recordId: editingId, supabase, table: "budget_items", userId: currentUserId });
    if (!disableDraftAutosave) clearDraft(draftKey);
    resetDraft(emptyBudgetForm);
    setFormSeed(emptyBudgetForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setIsOpen(false);
    setEditingId(null);
    setEditorTripId(null);
    setRestoredDraftKey(null);
  }

  return (
    <section className="panel budget-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{headingEyebrow}</p>
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
          {conflict ? (
            <ConflictNotice onKeep={() => setConflict(false)} onLatest={() => closeBudgetForm(true)} />
          ) : null}
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
            <button className="ghost-button" type="button" onClick={() => closeBudgetForm()}>
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
            const lockedByOther = useEditLocks && isLockedByAnotherUser(item, currentUserId);
            const locker = approvedMembers.find((member) => member.user_id === item.locked_by);
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
                  <button className="mini-button" disabled={!canEdit || lockedByOther} type="button" onClick={() => openEditBudget(item)}>
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
        activeTrip={activeTrip}
        actualExpenses={actualExpenses}
        actualParticipants={actualParticipants}
        attachments={attachments}
        budgetItems={budgetItems}
        canEdit={canEdit}
        currentUserId={currentUserId}
        disableDraftAutosave={disableDraftAutosave}
        enableAttachments={enableAttachments}
        headingEyebrow={headingEyebrow === "預算" ? "實付" : "Actual"}
        members={members}
        onDeleteAttachment={onDeleteAttachment}
        onDelete={onDeleteActual}
        onOpenAttachment={onOpenAttachment}
        onSave={onSaveActual}
        onUploadAttachment={onUploadAttachment}
        restoreDrafts={restoreDrafts}
        useEditLocks={useEditLocks}
      />
    </section>
  );
}

function ActualExpensePanel({
  activeTrip,
  actualExpenses,
  actualParticipants,
  attachments,
  budgetItems,
  canEdit,
  currentUserId,
  disableDraftAutosave = false,
  enableAttachments = true,
  headingEyebrow = "Actual",
  members,
  onDelete,
  onDeleteAttachment,
  onOpenAttachment,
  onSave,
  onUploadAttachment,
  restoreDrafts = true,
  useEditLocks = true,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formSeed, setFormSeed] = useState(emptyActualForm);
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(null);
  const [editorTripId, setEditorTripId] = useState(null);
  const [conflict, setConflict] = useState(false);
  const { draftKey, flushDraft, form, hasUnsavedChanges, replaceForm, resetDraft, setForm } = useDraftAutosave({
    defaultForm: formSeed,
    disabled: disableDraftAutosave,
    editingId,
    entityType: "actual_expense",
    isOpen,
    serverUpdatedAt: baseUpdatedAt,
    tripId: activeTrip?.id,
    userId: currentUserId,
  });
  const approvedMembers = members.filter((member) => member.status === "approved");
  const participantsByExpense = useMemo(() => {
    const next = {};
    actualParticipants.forEach((participant) => {
      next[participant.actual_expense_id] = [...(next[participant.actual_expense_id] || []), participant.user_id];
    });
    return next;
  }, [actualParticipants]);
  const total = actualExpenses.reduce((sum, expense) => sum + Number(expense.twd_amount || 0), 0);
  const activeEditorGuard = useMemo(
    () => ({
      discard: () => closeExpenseForm(true),
      isActive: isOpen,
      isDirty: hasUnsavedChanges,
      save: () => saveCurrentExpense(),
    }),
    [form, hasUnsavedChanges, isOpen, editingId, baseUpdatedAt, draftKey],
  );

  useActiveEditorGuard(`actual:${activeTrip?.id || "no-trip"}`, activeEditorGuard);

  useEffect(() => {
    if (!isOpen || !editorTripId || !activeTrip?.id || editorTripId === activeTrip.id) return;
    if (useEditLocks && editingId) {
      void releaseEditLock({ recordId: editingId, supabase, table: "actual_expenses", userId: currentUserId });
    }
    replaceForm(emptyActualForm);
    setFormSeed(emptyActualForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setEditingId(null);
    setEditorTripId(null);
    setIsOpen(false);
  }, [activeTrip?.id, currentUserId, editingId, editorTripId, isOpen, replaceForm, useEditLocks]);

  useEffect(() => {
    if (!restoreDrafts || isOpen || !activeTrip?.id || !currentUserId) return;
    const latest = loadLatestDraftForEntity({
      entityType: "actual_expense",
      tripId: activeTrip.id,
      userId: currentUserId,
    });
    if (!latest) return;
    const matchingExpense = actualExpenses.find((expense) => expense.id === latest.entityId);
    if (latest.entityId !== "new" && !matchingExpense) return;
    setFormSeed(latest.draft.form);
    setBaseUpdatedAt(latest.entityId === "new" ? latest.draft.serverUpdatedAt || null : matchingExpense?.updated_at || null);
    setConflict(false);
    setEditingId(latest.entityId === "new" ? null : latest.entityId);
    setEditorTripId(activeTrip.id);
    setIsOpen(true);
  }, [activeTrip?.id, actualExpenses, currentUserId, isOpen, restoreDrafts]);

  async function openNewExpense() {
    if (isOpen) {
      const canContinue = hasUnsavedChanges ? await requestActiveEditorGuardResolution() : true;
      if (!canContinue) return;
      if (!hasUnsavedChanges) await closeExpenseForm(true);
    }
    const nextForm = {
      ...emptyActualForm,
      paid_at: dateTimeLocalInput(),
      participantIds: approvedMembers.map((member) => member.user_id),
    };
    flushDraft();
    replaceForm(nextForm);
    setFormSeed(nextForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setEditingId(null);
    setEditorTripId(activeTrip?.id || null);
    setIsOpen(true);
  }

  async function openEditExpense(expense) {
    if (useEditLocks && isLockedByAnotherUser(expense, currentUserId)) return;
    if (isOpen && editingId !== expense.id) {
      const canContinue = hasUnsavedChanges ? await requestActiveEditorGuardResolution() : true;
      if (!canContinue) return;
      if (!hasUnsavedChanges) await closeExpenseForm(true);
    }
    let lockedExpense = expense;
    if (useEditLocks) {
      const lockResult = await acquireEditLock({ record: expense, supabase, table: "actual_expenses", userId: currentUserId });
      if (lockResult.error || lockResult.lockedByAnotherUser) return;
      lockedExpense = lockResult.data || expense;
    }
    const paidAt = expense.paid_at ? dateTimeLocalInput(new Date(expense.paid_at)) : dateTimeLocalInput();
    const nextForm = {
      budget_item_id: expense.budget_item_id || "",
      title: expense.title || "",
      amount: expense.amount || 0,
      currency: expense.currency || "TWD",
      exchange_rate: expense.exchange_rate || 1,
      payer_id: expense.payer_id || "",
      paid_at: paidAt,
      note: expense.note || "",
      participantIds: participantsByExpense[expense.id] || approvedMembers.map((member) => member.user_id),
    };
    flushDraft();
    replaceForm(nextForm);
    setFormSeed(nextForm);
    setBaseUpdatedAt(lockedExpense.updated_at || expense.updated_at || null);
    setConflict(false);
    setEditingId(expense.id);
    setEditorTripId(activeTrip?.id || null);
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

  async function saveCurrentExpense() {
    const result = await onSave(form, editingId, { baseUpdatedAt, tripId: editorTripId });
    if (!result?.ok) {
      if (result?.conflict) setConflict(true);
      return false;
    }
    if (!disableDraftAutosave) clearDraft(draftKey);
    resetDraft(emptyActualForm);
    setFormSeed(emptyActualForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setIsOpen(false);
    setEditingId(null);
    setEditorTripId(null);
    return true;
  }

  async function submit(event) {
    event.preventDefault();
    await saveCurrentExpense();
  }

  async function closeExpenseForm(force = false) {
    if (!force && hasUnsavedChanges && !window.confirm("放棄尚未儲存的變更？")) return;
    if (useEditLocks && editingId) await releaseEditLock({ recordId: editingId, supabase, table: "actual_expenses", userId: currentUserId });
    if (!disableDraftAutosave) clearDraft(draftKey);
    resetDraft(emptyActualForm);
    setFormSeed(emptyActualForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setIsOpen(false);
    setEditingId(null);
    setEditorTripId(null);
  }

  return (
    <section className="actual-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{headingEyebrow}</p>
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
          {conflict ? (
            <ConflictNotice onKeep={() => setConflict(false)} onLatest={() => closeExpenseForm(true)} />
          ) : null}
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
            <button className="ghost-button" type="button" onClick={() => closeExpenseForm()}>
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
                {enableAttachments ? (
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
                ) : null}
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
  activeTrip,
  accommodations,
  attachments,
  budgetItems,
  canEdit,
  currentUserId,
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
  const [formSeed, setFormSeed] = useState(emptyAccommodationForm);
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(null);
  const [editorTripId, setEditorTripId] = useState(null);
  const [restoredDraftKey, setRestoredDraftKey] = useState(null);
  const [conflict, setConflict] = useState(false);
  const { draftKey, flushDraft, form, hasUnsavedChanges, replaceForm, resetDraft, setForm } = useDraftAutosave({
    defaultForm: formSeed,
    editingId,
    entityType: "accommodation",
    forceDirtyOnOpen: Boolean(restoredDraftKey),
    isOpen,
    serverUpdatedAt: baseUpdatedAt,
    tripId: activeTrip?.id || trip?.id,
    userId: currentUserId,
  });
  const selected = accommodations.find((item) => item.id === selectedId) || accommodations[0] || null;
  const activeEditorGuard = useMemo(
    () => ({
      discard: () => closeAccommodationForm(true),
      isActive: isOpen,
      isDirty: hasUnsavedChanges,
      save: () => saveCurrentAccommodation(),
    }),
    [form, hasUnsavedChanges, isOpen, editingId, baseUpdatedAt, draftKey],
  );

  useActiveEditorGuard(`accommodation:${activeTrip?.id || trip?.id || "no-trip"}`, activeEditorGuard);

  useEffect(() => {
    const currentTripId = activeTrip?.id || trip?.id || null;
    if (!isOpen || !editorTripId || !currentTripId || editorTripId === currentTripId) return;
    if (editingId) {
      void releaseEditLock({ recordId: editingId, supabase, table: "accommodations", userId: currentUserId });
    }
    replaceForm(emptyAccommodationForm);
    setFormSeed(emptyAccommodationForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setEditingId(null);
    setEditorTripId(null);
    setRestoredDraftKey(null);
    setIsOpen(false);
  }, [activeTrip?.id, currentUserId, editingId, editorTripId, isOpen, replaceForm, trip?.id]);

  useEffect(() => {
    if (isOpen || !(activeTrip?.id || trip?.id) || !currentUserId) return;
    const latest = loadLatestDraftForEntity({
      entityType: "accommodation",
      tripId: activeTrip?.id || trip?.id,
      userId: currentUserId,
    });
    if (!latest) return;
    const matchingItem = accommodations.find((item) => item.id === latest.entityId);
    if (latest.entityId !== "new" && !matchingItem) return;
    setFormSeed(latest.draft.form);
    setBaseUpdatedAt(latest.entityId === "new" ? latest.draft.serverUpdatedAt || null : matchingItem?.updated_at || null);
    setConflict(false);
    setEditingId(latest.entityId === "new" ? null : latest.entityId);
    setEditorTripId(activeTrip?.id || trip?.id || null);
    setRestoredDraftKey(latest.key);
    setIsOpen(true);
  }, [accommodations, activeTrip?.id, currentUserId, isOpen, trip?.id]);

  async function openNewAccommodation() {
    if (isOpen) {
      const canContinue = hasUnsavedChanges ? await requestActiveEditorGuardResolution() : true;
      if (!canContinue) return;
      if (!hasUnsavedChanges) await closeAccommodationForm(true);
    }
    const nextForm = {
      ...emptyAccommodationForm,
      check_in_date: trip.start_date || todayInput(),
      check_out_date: trip.start_date || todayInput(),
    };
    flushDraft();
    replaceForm(nextForm);
    setFormSeed(nextForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setEditingId(null);
    setEditorTripId(activeTrip?.id || trip?.id || null);
    setRestoredDraftKey(null);
    setIsOpen(true);
  }

  async function openEditAccommodation(item) {
    if (isLockedByAnotherUser(item, currentUserId)) return;
    if (isOpen && editingId !== item.id) {
      const canContinue = hasUnsavedChanges ? await requestActiveEditorGuardResolution() : true;
      if (!canContinue) return;
      if (!hasUnsavedChanges) await closeAccommodationForm(true);
    }
    const lockResult = await acquireEditLock({ record: item, supabase, table: "accommodations", userId: currentUserId });
    if (lockResult.error || lockResult.lockedByAnotherUser) return;
    const lockedItem = lockResult.data || item;
    const nextForm = {
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
    };
    flushDraft();
    replaceForm(nextForm);
    setFormSeed(nextForm);
    setBaseUpdatedAt(lockedItem.updated_at || item.updated_at || null);
    setConflict(false);
    setEditingId(item.id);
    setEditorTripId(activeTrip?.id || trip?.id || null);
    setRestoredDraftKey(null);
    setIsOpen(true);
  }

  async function saveCurrentAccommodation() {
    const result = await onSave(form, editingId, { baseUpdatedAt, tripId: editorTripId });
    if (!result?.ok) {
      if (result?.conflict) setConflict(true);
      return false;
    }
    clearDraft(draftKey);
    resetDraft(emptyAccommodationForm);
    setFormSeed(emptyAccommodationForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setIsOpen(false);
    setEditingId(null);
    setEditorTripId(null);
    setRestoredDraftKey(null);
    return true;
  }

  async function submit(event) {
    event.preventDefault();
    await saveCurrentAccommodation();
  }

  async function closeAccommodationForm(force = false) {
    if (!force && hasUnsavedChanges && !window.confirm("放棄尚未儲存的變更？")) return;
    if (editingId) await releaseEditLock({ recordId: editingId, supabase, table: "accommodations", userId: currentUserId });
    clearDraft(draftKey);
    resetDraft(emptyAccommodationForm);
    setFormSeed(emptyAccommodationForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setIsOpen(false);
    setEditingId(null);
    setEditorTripId(null);
    setRestoredDraftKey(null);
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
          {conflict ? (
            <ConflictNotice onKeep={() => setConflict(false)} onLatest={() => closeAccommodationForm(true)} />
          ) : null}
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
            <button className="ghost-button" type="button" onClick={() => closeAccommodationForm()}>
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
  activeTrip,
  canEdit,
  currentUserId,
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
            activeTrip={activeTrip}
            canEdit={canEdit}
            currentUserId={currentUserId}
            guideItems={guideItems}
            members={approvedMembers}
            todoItems={todoItems}
            onDelete={onDeleteTodo}
            onSave={onSaveTodo}
            onToggle={onToggleTodo}
          />
        </div>
        <div className={`todo-guide-column${activeTab === "guide" ? " active" : ""}`}>
          <GuidePanel activeTrip={activeTrip} canEdit={canEdit} currentUserId={currentUserId} guideItems={guideItems} onDelete={onDeleteGuide} onSave={onSaveGuide} />
        </div>
      </div>
    </section>
  );
}

function TodoPanel({ activeTrip, canEdit, currentUserId, guideItems, members, todoItems, onDelete, onSave, onToggle }) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formSeed, setFormSeed] = useState(emptyTodoForm);
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(null);
  const [editorTripId, setEditorTripId] = useState(null);
  const [restoredDraftKey, setRestoredDraftKey] = useState(null);
  const [conflict, setConflict] = useState(false);
  const { draftKey, flushDraft, form, hasUnsavedChanges, replaceForm, resetDraft, setForm } = useDraftAutosave({
    defaultForm: formSeed,
    editingId,
    entityType: "todo_item",
    forceDirtyOnOpen: Boolean(restoredDraftKey),
    isOpen,
    serverUpdatedAt: baseUpdatedAt,
    tripId: activeTrip?.id,
    userId: currentUserId,
  });
  const memberById = new Map(members.map((member) => [member.user_id, member]));
  const guideById = new Map(guideItems.map((guide) => [guide.id, guide]));
  const pendingCount = todoItems.filter((item) => !item.completed).length;
  const activeEditorGuard = useMemo(
    () => ({
      discard: () => closeTodoForm(true),
      isActive: isOpen,
      isDirty: hasUnsavedChanges,
      save: () => saveCurrentTodo(),
    }),
    [form, hasUnsavedChanges, isOpen, editingId, baseUpdatedAt, draftKey],
  );

  useActiveEditorGuard(`todo:${activeTrip?.id || "no-trip"}`, activeEditorGuard);

  useEffect(() => {
    if (!isOpen || !editorTripId || !activeTrip?.id || editorTripId === activeTrip.id) return;
    if (editingId) {
      void releaseEditLock({ recordId: editingId, supabase, table: "todo_items", userId: currentUserId });
    }
    replaceForm(emptyTodoForm);
    setFormSeed(emptyTodoForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setEditingId(null);
    setEditorTripId(null);
    setRestoredDraftKey(null);
    setIsOpen(false);
  }, [activeTrip?.id, currentUserId, editingId, editorTripId, isOpen, replaceForm]);

  useEffect(() => {
    if (isOpen || !activeTrip?.id || !currentUserId) return;
    const latest = loadLatestDraftForEntity({
      entityType: "todo_item",
      tripId: activeTrip.id,
      userId: currentUserId,
    });
    if (!latest) return;
    const matchingItem = todoItems.find((item) => item.id === latest.entityId);
    if (latest.entityId !== "new" && !matchingItem) return;
    setFormSeed(latest.draft.form);
    setBaseUpdatedAt(latest.entityId === "new" ? latest.draft.serverUpdatedAt || null : matchingItem?.updated_at || null);
    setConflict(false);
    setEditingId(latest.entityId === "new" ? null : latest.entityId);
    setEditorTripId(activeTrip.id);
    setRestoredDraftKey(latest.key);
    setIsOpen(true);
  }, [activeTrip?.id, currentUserId, isOpen, todoItems]);

  async function openNewTodo() {
    if (isOpen) {
      const canContinue = hasUnsavedChanges ? await requestActiveEditorGuardResolution() : true;
      if (!canContinue) return;
      if (!hasUnsavedChanges) await closeTodoForm(true);
    }
    flushDraft();
    replaceForm(emptyTodoForm);
    setFormSeed(emptyTodoForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setEditingId(null);
    setEditorTripId(activeTrip?.id || null);
    setRestoredDraftKey(null);
    setIsOpen(true);
  }

  async function openEditTodo(item) {
    if (isLockedByAnotherUser(item, currentUserId)) return;
    if (isOpen && editingId !== item.id) {
      const canContinue = hasUnsavedChanges ? await requestActiveEditorGuardResolution() : true;
      if (!canContinue) return;
      if (!hasUnsavedChanges) await closeTodoForm(true);
    }
    const lockResult = await acquireEditLock({ record: item, supabase, table: "todo_items", userId: currentUserId });
    if (lockResult.error || lockResult.lockedByAnotherUser) return;
    const lockedItem = lockResult.data || item;
    const nextForm = {
      title: item.title || "",
      description: item.description || "",
      due_date: item.due_date || "",
      assignee_id: item.assignee_id || "",
      guide_id: item.guide_id || "",
    };
    flushDraft();
    replaceForm(nextForm);
    setFormSeed(nextForm);
    setBaseUpdatedAt(lockedItem.updated_at || item.updated_at || null);
    setConflict(false);
    setEditingId(item.id);
    setEditorTripId(activeTrip?.id || null);
    setRestoredDraftKey(null);
    setIsOpen(true);
  }

  async function saveCurrentTodo() {
    const result = await onSave(form, editingId, { baseUpdatedAt, tripId: editorTripId });
    if (!result?.ok) {
      if (result?.conflict) setConflict(true);
      return false;
    }
    clearDraft(draftKey);
    resetDraft(emptyTodoForm);
    setFormSeed(emptyTodoForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setIsOpen(false);
    setEditingId(null);
    setEditorTripId(null);
    setRestoredDraftKey(null);
    return true;
  }

  async function submit(event) {
    event.preventDefault();
    await saveCurrentTodo();
  }

  async function closeTodoForm(force = false) {
    if (!force && hasUnsavedChanges && !window.confirm("放棄尚未儲存的變更？")) return;
    if (editingId) await releaseEditLock({ recordId: editingId, supabase, table: "todo_items", userId: currentUserId });
    clearDraft(draftKey);
    resetDraft(emptyTodoForm);
    setFormSeed(emptyTodoForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setIsOpen(false);
    setEditingId(null);
    setEditorTripId(null);
    setRestoredDraftKey(null);
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
          {conflict ? (
            <ConflictNotice onKeep={() => setConflict(false)} onLatest={() => closeTodoForm(true)} />
          ) : null}
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
            <button className="ghost-button" type="button" onClick={() => closeTodoForm()}>
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

function GuidePanel({ activeTrip, canEdit, currentUserId, guideItems, onDelete, onSave }) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formSeed, setFormSeed] = useState(emptyGuideForm);
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(null);
  const [editorTripId, setEditorTripId] = useState(null);
  const [conflict, setConflict] = useState(false);
  const { draftKey, flushDraft, form, hasUnsavedChanges, replaceForm, resetDraft, setForm } = useDraftAutosave({
    defaultForm: formSeed,
    editingId,
    entityType: "guide_item",
    isOpen,
    serverUpdatedAt: baseUpdatedAt,
    tripId: activeTrip?.id,
    userId: currentUserId,
  });
  const activeEditorGuard = useMemo(
    () => ({
      discard: () => closeGuideForm(true),
      isActive: isOpen,
      isDirty: hasUnsavedChanges,
      save: () => saveCurrentGuide(),
    }),
    [form, hasUnsavedChanges, isOpen, editingId, baseUpdatedAt, draftKey],
  );

  useActiveEditorGuard(`guide:${activeTrip?.id || "no-trip"}`, activeEditorGuard);

  useEffect(() => {
    if (!isOpen || !editorTripId || !activeTrip?.id || editorTripId === activeTrip.id) return;
    if (editingId) {
      void releaseEditLock({ recordId: editingId, supabase, table: "guide_items", userId: currentUserId });
    }
    replaceForm(emptyGuideForm);
    setFormSeed(emptyGuideForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setEditingId(null);
    setEditorTripId(null);
    setIsOpen(false);
  }, [activeTrip?.id, currentUserId, editingId, editorTripId, isOpen, replaceForm]);

  useEffect(() => {
    if (isOpen || !activeTrip?.id || !currentUserId) return;
    const latest = loadLatestDraftForEntity({
      entityType: "guide_item",
      tripId: activeTrip.id,
      userId: currentUserId,
    });
    if (!latest) return;
    const matchingItem = guideItems.find((item) => item.id === latest.entityId);
    if (latest.entityId !== "new" && !matchingItem) return;
    setFormSeed(latest.draft.form);
    setBaseUpdatedAt(latest.draft.serverUpdatedAt || matchingItem?.updated_at || null);
    setConflict(false);
    setEditingId(latest.entityId === "new" ? null : latest.entityId);
    setEditorTripId(activeTrip.id);
    setIsOpen(true);
  }, [activeTrip?.id, currentUserId, guideItems, isOpen]);

  async function openNewGuide() {
    if (isOpen) {
      const canContinue = hasUnsavedChanges ? await requestActiveEditorGuardResolution() : true;
      if (!canContinue) return;
      if (!hasUnsavedChanges) await closeGuideForm(true);
    }
    flushDraft();
    replaceForm(emptyGuideForm);
    setFormSeed(emptyGuideForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setEditingId(null);
    setEditorTripId(activeTrip?.id || null);
    setIsOpen(true);
  }

  async function openEditGuide(item) {
    if (isLockedByAnotherUser(item, currentUserId)) return;
    if (isOpen && editingId !== item.id) {
      const canContinue = hasUnsavedChanges ? await requestActiveEditorGuardResolution() : true;
      if (!canContinue) return;
      if (!hasUnsavedChanges) await closeGuideForm(true);
    }
    const lockResult = await acquireEditLock({ record: item, supabase, table: "guide_items", userId: currentUserId });
    if (lockResult.error || lockResult.lockedByAnotherUser) return;
    const lockedItem = lockResult.data || item;
    const nextForm = {
      title: item.title || "",
      description: item.description || "",
      url: item.url || "",
    };
    flushDraft();
    replaceForm(nextForm);
    setFormSeed(nextForm);
    setBaseUpdatedAt(lockedItem.updated_at || item.updated_at || null);
    setConflict(false);
    setEditingId(item.id);
    setEditorTripId(activeTrip?.id || null);
    setIsOpen(true);
  }

  async function saveCurrentGuide() {
    const result = await onSave(form, editingId, { baseUpdatedAt, tripId: editorTripId });
    if (!result?.ok) {
      if (result?.conflict) setConflict(true);
      return false;
    }
    clearDraft(draftKey);
    resetDraft(emptyGuideForm);
    setFormSeed(emptyGuideForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setIsOpen(false);
    setEditingId(null);
    setEditorTripId(null);
    return true;
  }

  async function submit(event) {
    event.preventDefault();
    await saveCurrentGuide();
  }

  async function closeGuideForm(force = false) {
    if (!force && hasUnsavedChanges && !window.confirm("放棄尚未儲存的變更？")) return;
    if (editingId) await releaseEditLock({ recordId: editingId, supabase, table: "guide_items", userId: currentUserId });
    clearDraft(draftKey);
    resetDraft(emptyGuideForm);
    setFormSeed(emptyGuideForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setIsOpen(false);
    setEditingId(null);
    setEditorTripId(null);
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
          {conflict ? (
            <ConflictNotice onKeep={() => setConflict(false)} onLatest={() => closeGuideForm(true)} />
          ) : null}
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
            <button className="ghost-button" type="button" onClick={() => closeGuideForm()}>
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
  activeTrip,
  activeTab = "personal",
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
  onTabChange,
  onTogglePersonal,
  onUpdateShared,
}) {
  const [personalSeed, setPersonalSeed] = useState(emptyLuggageForm);
  const [sharedSeed, setSharedSeed] = useState(emptySharedLuggageForm);
  const [editingPersonalId, setEditingPersonalId] = useState(null);
  const [editingSharedId, setEditingSharedId] = useState(null);
  const [personalUpdatedAt, setPersonalUpdatedAt] = useState(null);
  const [sharedUpdatedAt, setSharedUpdatedAt] = useState(null);
  const previousTripIdRef = useRef(activeTrip?.id || null);
  const personalDraft = useDraftAutosave({
    defaultForm: personalSeed,
    editingId: editingPersonalId,
    entityType: "luggage_item",
    isOpen: true,
    serverUpdatedAt: personalUpdatedAt,
    tripId: activeTrip?.id,
    userId: currentUserId,
  });
  const sharedDraft = useDraftAutosave({
    defaultForm: sharedSeed,
    editingId: editingSharedId,
    entityType: "shared_luggage_item",
    isOpen: true,
    serverUpdatedAt: sharedUpdatedAt,
    tripId: activeTrip?.id,
    userId: currentUserId,
  });
  const personalForm = personalDraft.form;
  const sharedForm = sharedDraft.form;
  const setPersonalForm = personalDraft.setForm;
  const setSharedForm = sharedDraft.setForm;
  const approvedMembers = members.filter((member) => member.status === "approved");
  const memberById = new Map(approvedMembers.map((member) => [member.user_id, member]));
  const assignedSharedItems = sharedLuggageItems.filter((item) => item.assigned_to === currentUserId);
  const personalEditorGuard = useMemo(
    () => ({
      discard: () => discardPersonalEdit(),
      isActive: true,
      isDirty: personalDraft.hasUnsavedChanges,
      save: () => saveCurrentPersonal(),
    }),
    [personalForm, personalDraft.hasUnsavedChanges, editingPersonalId, personalUpdatedAt],
  );
  const sharedEditorGuard = useMemo(
    () => ({
      discard: () => discardSharedEdit(),
      isActive: true,
      isDirty: sharedDraft.hasUnsavedChanges,
      save: () => saveCurrentShared(),
    }),
    [sharedForm, sharedDraft.hasUnsavedChanges, editingSharedId, sharedUpdatedAt],
  );

  useActiveEditorGuard(`luggage-personal:${activeTrip?.id || "no-trip"}`, personalEditorGuard);
  useActiveEditorGuard(`luggage-shared:${activeTrip?.id || "no-trip"}`, sharedEditorGuard);

  useEffect(() => {
    const previousTripId = previousTripIdRef.current;
    const currentTripId = activeTrip?.id || null;
    if (previousTripId === currentTripId) return;
    if (editingPersonalId) {
      void releaseEditLock({ recordId: editingPersonalId, supabase, table: "luggage_items", userId: currentUserId });
    }
    if (editingSharedId) {
      void releaseEditLock({ recordId: editingSharedId, supabase, table: "shared_luggage_items", userId: currentUserId });
    }
    personalDraft.replaceForm(emptyLuggageForm);
    sharedDraft.replaceForm(emptySharedLuggageForm);
    setPersonalSeed(emptyLuggageForm);
    setSharedSeed(emptySharedLuggageForm);
    setPersonalUpdatedAt(null);
    setSharedUpdatedAt(null);
    setEditingPersonalId(null);
    setEditingSharedId(null);
    previousTripIdRef.current = currentTripId;
  }, [activeTrip?.id, currentUserId, editingPersonalId, editingSharedId, personalDraft, sharedDraft]);

  useEffect(() => {
    if (!activeTrip?.id || !currentUserId || editingPersonalId) return;
    const latest = loadLatestDraftForEntity({
      entityType: "luggage_item",
      tripId: activeTrip.id,
      userId: currentUserId,
    });
    if (!latest) return;
    const matchingItem = luggageItems.find((item) => item.id === latest.entityId);
    if (latest.entityId !== "new" && !matchingItem) return;
    setPersonalSeed(latest.draft.form);
    setPersonalUpdatedAt(latest.draft.serverUpdatedAt || matchingItem?.updated_at || null);
    setEditingPersonalId(latest.entityId === "new" ? null : latest.entityId);
  }, [activeTrip?.id, currentUserId, editingPersonalId, luggageItems]);

  useEffect(() => {
    if (!activeTrip?.id || !currentUserId || editingSharedId) return;
    const latest = loadLatestDraftForEntity({
      entityType: "shared_luggage_item",
      tripId: activeTrip.id,
      userId: currentUserId,
    });
    if (!latest) return;
    const matchingItem = sharedLuggageItems.find((item) => item.id === latest.entityId);
    if (latest.entityId !== "new" && !matchingItem) return;
    setSharedSeed(latest.draft.form);
    setSharedUpdatedAt(latest.draft.serverUpdatedAt || matchingItem?.updated_at || null);
    setEditingSharedId(latest.entityId === "new" ? null : latest.entityId);
  }, [activeTrip?.id, currentUserId, editingSharedId, sharedLuggageItems]);

  async function saveCurrentPersonal() {
    if (!personalForm.title.trim()) return false;
    const result = await onSavePersonal(personalForm, editingPersonalId, { baseUpdatedAt: personalUpdatedAt, tripId: activeTrip?.id });
    if (!result?.ok) return false;
    clearDraft(personalDraft.draftKey);
    personalDraft.resetDraft(emptyLuggageForm);
    setPersonalSeed(emptyLuggageForm);
    setPersonalUpdatedAt(null);
    setEditingPersonalId(null);
    return true;
  }

  async function submitPersonal(event) {
    event.preventDefault();
    await saveCurrentPersonal();
  }

  async function saveCurrentShared() {
    const result = await onSaveShared(sharedForm, editingSharedId, { baseUpdatedAt: sharedUpdatedAt, tripId: activeTrip?.id });
    if (!result?.ok) return false;
    clearDraft(sharedDraft.draftKey);
    sharedDraft.resetDraft(emptySharedLuggageForm);
    setSharedSeed(emptySharedLuggageForm);
    setSharedUpdatedAt(null);
    setEditingSharedId(null);
    return true;
  }

  async function submitShared(event) {
    event.preventDefault();
    await saveCurrentShared();
  }

  async function editPersonal(item) {
    if (isLockedByAnotherUser(item, currentUserId)) return;
    if (editingPersonalId !== item.id && personalDraft.hasUnsavedChanges) {
      const canContinue = await requestActiveEditorGuardResolution();
      if (!canContinue) return;
    } else if (editingPersonalId && editingPersonalId !== item.id) {
      await discardPersonalEdit();
    }
    const lockResult = await acquireEditLock({ record: item, supabase, table: "luggage_items", userId: currentUserId });
    if (lockResult.error || lockResult.lockedByAnotherUser) return;
    const nextForm = { title: item.title || "", category: item.category || "" };
    personalDraft.flushDraft();
    setPersonalSeed(nextForm);
    personalDraft.replaceForm(nextForm, { dirty: false });
    setPersonalUpdatedAt(lockResult.data?.updated_at || item.updated_at || null);
    setEditingPersonalId(item.id);
  }

  async function discardPersonalEdit() {
    if (editingPersonalId) {
      await releaseEditLock({ recordId: editingPersonalId, supabase, table: "luggage_items", userId: currentUserId });
    }
    clearDraft(personalDraft.draftKey);
    personalDraft.resetDraft(emptyLuggageForm);
    setPersonalSeed(emptyLuggageForm);
    setPersonalUpdatedAt(null);
    setEditingPersonalId(null);
    return true;
  }

  async function cancelPersonalEdit() {
    await discardPersonalEdit();
  }

  async function editShared(item) {
    if (isLockedByAnotherUser(item, currentUserId)) return;
    if (editingSharedId !== item.id && sharedDraft.hasUnsavedChanges) {
      const canContinue = await requestActiveEditorGuardResolution();
      if (!canContinue) return;
    } else if (editingSharedId && editingSharedId !== item.id) {
      await discardSharedEdit();
    }
    const lockResult = await acquireEditLock({ record: item, supabase, table: "shared_luggage_items", userId: currentUserId });
    if (lockResult.error || lockResult.lockedByAnotherUser) return;
    const nextForm = {
      title: item.title || "",
      category: item.category || "",
      assigned_to: item.assigned_to || "",
    };
    sharedDraft.flushDraft();
    setSharedSeed(nextForm);
    sharedDraft.replaceForm(nextForm, { dirty: false });
    setSharedUpdatedAt(lockResult.data?.updated_at || item.updated_at || null);
    setEditingSharedId(item.id);
  }

  async function discardSharedEdit() {
    if (editingSharedId) {
      await releaseEditLock({ recordId: editingSharedId, supabase, table: "shared_luggage_items", userId: currentUserId });
    }
    clearDraft(sharedDraft.draftKey);
    sharedDraft.resetDraft(emptySharedLuggageForm);
    setSharedSeed(emptySharedLuggageForm);
    setSharedUpdatedAt(null);
    setEditingSharedId(null);
    return true;
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
          onClick={() => onTabChange?.("personal")}
        >
          私物
        </button>
        <button className={activeTab === "shared" ? "active" : ""} type="button" onClick={() => onTabChange?.("shared")}>
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
            {editingPersonalId ? (
              <button className="mini-button" type="button" onClick={cancelPersonalEdit}>
                取消
              </button>
            ) : null}
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

function memberInitial(member) {
  const source = member?.display_name || member?.email || member?.user_id || "?";
  return source.trim().slice(0, 1).toUpperCase();
}

function MembersPanel({ className = "", isOwner, members, onApprove, onReject }) {
  if (!members.length) return null;
  const approvedCount = members.filter((member) => member.status === "approved").length;
  return (
    <section className={`panel members-panel${className ? ` ${className}` : ""}`}>
      <div className="panel-heading tight">
        <div>
          <p className="eyebrow">Members</p>
          <h3>成員</h3>
        </div>
        <span className="pill member-count">{approvedCount}/{members.length}</span>
      </div>
      <div className="member-summary" aria-label={`${members.length} 位成員`}>
        {members.slice(0, 4).map((member) => (
          <span className="member-avatar" key={member.id || member.user_id} title={memberName(member)}>
            {memberInitial(member)}
          </span>
        ))}
        {members.length > 4 ? <span className="member-avatar more">+{members.length - 4}</span> : null}
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
        <p>分享頁不需要登入，只會顯示行程、住宿與指南；預算、實付、結算、行李與成員資料不會公開。</p>
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
              <p className="eyebrow">Itinerary</p>
              <h2>行程</h2>
            </div>
          </div>
          {Object.entries(groupedItems).length ? (
            Object.entries(groupedItems).map(([date, dayItemsForShare]) => (
              <div className="share-day" key={date}>
                <h3>{date.includes("-") ? formatDate(new Date(`${date}T00:00:00`)) : date}</h3>
                {dayItemsForShare.map((item) => (
                  <article className="share-card" key={item.id}>
                    <div className="share-time">
                      <strong>{formatTimeDisplay(item.start_time) || "--:--"}</strong>
                      {item.end_time ? <span>{formatTimeDisplay(item.end_time)}</span> : null}
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
