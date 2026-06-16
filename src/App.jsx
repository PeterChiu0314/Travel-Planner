import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bed,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  HandCoins,
  LayoutDashboard,
  LogOut,
  Luggage,
  Map as MapIcon,
  Settings,
  Wallet,
} from "lucide-react";
import { clearDraft, findLatestDraftTrip, getDraftKey, loadLatestDraftForEntity, useDraftAutosave } from "./lib/draftAutosave.js";
import { acquireEditLock, isLockedByAnotherUser, releaseEditLock } from "./lib/editLocks.js";
import { hasSupabaseConfig, supabase } from "./lib/supabase.js";

const attachmentBucket = "trip-attachments";

const desktopNavItems = [
  { id: "today", Icon: LayoutDashboard, label: "總覽", shortLabel: "覽" },
  { id: "timeline", Icon: MapIcon, label: "行程", shortLabel: "程" },
  { id: "budget", Icon: Wallet, label: "預算", shortLabel: "錢" },
  { id: "accommodation", Icon: Bed, label: "住宿", shortLabel: "宿" },
  { id: "todo", Icon: ClipboardCheck, label: "待辦", shortLabel: "辦" },
  { id: "luggage", Icon: Luggage, label: "行李", shortLabel: "李" },
  { id: "settlement", Icon: HandCoins, label: "結算", shortLabel: "結" },
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

const transportCategories = [
  { value: "jr", label: "JR", icon: "🚆" },
  { value: "train", label: "電車", icon: "🚆" },
  { value: "bus", label: "公車", icon: "🚌" },
  { value: "walk", label: "步行", icon: "🚶" },
  { value: "drive", label: "自駕", icon: "🚗" },
  { value: "taxi", label: "計程車", icon: "🚗" },
  { value: "ferry", label: "渡輪", icon: "⛴️" },
  { value: "flight", label: "飛機", icon: "✈️" },
  { value: "other", label: "其他", icon: "➡️" },
];

const defaultTransportCategory = "train";

const defaultPackItems = ["護照", "行動電源", "充電線", "轉接頭", "雨具", "常備藥", "票券"];

const emptyItemForm = {
  item_type: "visit",
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
  transport_category: defaultTransportCategory,
  transport_name: "",
  transport_duration_minutes: "",
  transport_note: "",
  from_item_id: null,
  to_item_id: null,
  from_snapshot_start_time: null,
  from_snapshot_end_time: null,
  from_snapshot_destination: null,
  to_snapshot_start_time: null,
  to_snapshot_end_time: null,
  to_snapshot_destination: null,
  is_fixed: false,
  fixed_at: null,
  fixed_by: null,
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

function activeEditorGuardTripId(id) {
  const separatorIndex = id.lastIndexOf(":");
  return separatorIndex >= 0 ? id.slice(separatorIndex + 1) : null;
}

function getActiveEditorGuardEntries({ excludeId, tripId } = {}) {
  return [...activeEditorGuards.entries()].filter(([id]) => {
    if (excludeId && id === excludeId) return false;
    if (tripId && activeEditorGuardTripId(id) !== tripId) return false;
    return true;
  });
}

function getDirtyActiveEditorGuards(options) {
  return getActiveEditorGuardEntries(options)
    .map(([, guard]) => guard)
    .filter((guard) => guard.isDirty);
}

function hasActiveEditorGuard(options) {
  return getActiveEditorGuardEntries(options).length > 0;
}

function showActiveEditorPrompt() {
  if (activeEditorPromptResolve) return Promise.resolve(null);
  return new Promise((resolve) => {
    activeEditorPromptResolve = resolve;
    notifyActiveEditorListeners();
  });
}

async function requestActiveEditorGuardResolution(options) {
  const dirtyGuards = getDirtyActiveEditorGuards(options);
  if (!dirtyGuards.length) return true;
  const choice = await showActiveEditorPrompt();
  if (!choice) return false;
  for (const guard of dirtyGuards) {
    const ok = choice === "save" ? await guard.save() : await guard.discard();
    if (ok === false) return false;
  }
  return true;
}

async function requestActiveEditorHandoff(options) {
  const activeEntries = getActiveEditorGuardEntries(options);
  if (!activeEntries.length) return true;
  const dirtyEntries = activeEntries.filter(([, guard]) => guard.isDirty);
  if (dirtyEntries.length) {
    const canContinue = await requestActiveEditorGuardResolution(options);
    if (!canContinue) return false;
  }
  const cleanEntries = getActiveEditorGuardEntries(options).filter(([, guard]) => !guard.isDirty);
  for (const [, guard] of cleanEntries) {
    const ok = await guard.discard();
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

function parseDateOnly(value) {
  if (!value) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function formatDateKey(date) {
  return dateToInputValue(date);
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(date.getDate() + amount);
  return next;
}

function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function calendarMonthCells(monthDate) {
  const monthStart = startOfMonth(monthDate);
  const leadingDays = monthStart.getDay();
  const totalDays = daysInMonth(monthStart);
  const cells = [];
  for (let index = 0; index < 42; index += 1) {
    const monthDay = index - leadingDays + 1;
    if (monthDay < 1 || monthDay > totalDays) {
      cells.push({ blank: true, key: `blank-${formatDateKey(monthStart)}-${index}` });
      continue;
    }
    const date = new Date(monthStart);
    date.setDate(monthDay);
    cells.push({ date, key: formatDateKey(date), day: date.getDate() });
  }
  return cells;
}

function isSameDate(first, second) {
  return Boolean(first && second && first === second);
}

function isDateBefore(first, second) {
  return Boolean(first && second && first < second);
}

function isDateInRange(value, start, end) {
  return Boolean(value && start && end && value >= start && value <= end);
}

function normalizeDateInput(value) {
  const text = String(value || "").trim();
  let match = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) match = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) return "";
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function parseDateTextInput(value) {
  const normalized = normalizeDateInput(value);
  if (!normalized) return "";
  return parseDateOnly(normalized) ? normalized : "";
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
const timelineDurationOptions = buildDurationOptions(5, 24 * 60 - 5);

function buildDurationOptions(stepMinutes = 5, maxMinutes = 12 * 60) {
  const options = [];
  for (let minutes = stepMinutes; minutes <= maxMinutes; minutes += stepMinutes) {
    options.push(minutes);
  }
  return options;
}

function minutesToTimeValue(totalMinutes) {
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0 || totalMinutes >= 24 * 60) return "";
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function getDurationMinutes(startTime, endTime) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (start === null || end === null || end <= start) return "";
  return String(end - start);
}

function isTransportationCard(item) {
  return item?.item_type === "transport";
}

function transportCategoryMeta(category) {
  return transportCategories.find((item) => item.value === category) || transportCategories[transportCategories.length - 1];
}

function formatDurationMinutes(value) {
  const minutes = Number(value || 0);
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (!hours) return `${remainingMinutes}分鐘`;
  if (!remainingMinutes) return `${hours}小時`;
  return `${hours}小時${remainingMinutes}分鐘`;
}

function transportCardTitle(item) {
  const name = item?.transport_name || item?.title || transportCategoryMeta(item?.transport_category).label;
  const duration = formatDurationMinutes(item?.transport_duration_minutes);
  return duration ? `${name}・${duration}` : name;
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

function sortedVisitItems(items) {
  return sortScheduleItems(items.filter((item) => !isTransportationCard(item)));
}

function transportPairKey(fromItemId, toItemId) {
  return `${fromItemId || ""}->${toItemId || ""}`;
}

function visitSnapshotDestination(item) {
  return item?.location_name || item?.location || item?.title || "";
}

function buildTransportPairSnapshot(fromItem, toItem) {
  return {
    from_snapshot_start_time: fromItem?.start_time || null,
    from_snapshot_end_time: fromItem?.end_time || null,
    from_snapshot_destination: visitSnapshotDestination(fromItem) || null,
    to_snapshot_start_time: toItem?.start_time || null,
    to_snapshot_end_time: toItem?.end_time || null,
    to_snapshot_destination: visitSnapshotDestination(toItem) || null,
  };
}

function transportSnapshotMatchesVisit(transportItem, prefix, visitItem) {
  return (
    (transportItem?.[`${prefix}_snapshot_start_time`] || null) === (visitItem?.start_time || null) &&
    (transportItem?.[`${prefix}_snapshot_end_time`] || null) === (visitItem?.end_time || null) &&
    (transportItem?.[`${prefix}_snapshot_destination`] || null) === (visitSnapshotDestination(visitItem) || null)
  );
}

function buildAdjacentTransportMap(items, visits) {
  const adjacentKeys = new Set();
  visits.forEach((item, index) => {
    const nextItem = visits[index + 1];
    if (nextItem) adjacentKeys.add(transportPairKey(item.id, nextItem.id));
  });
  const next = {};
  items
    .filter((item) => isTransportationCard(item) && item.from_item_id && item.to_item_id)
    .forEach((item) => {
      const key = transportPairKey(item.from_item_id, item.to_item_id);
      if (adjacentKeys.has(key) && !next[key]) next[key] = item;
    });
  return next;
}

function buildTransportPairState(items, visits) {
  const adjacentKeys = new Set();
  const visitIds = new Set(visits.map((item) => item.id));
  visits.forEach((item, index) => {
    const nextItem = visits[index + 1];
    if (nextItem) adjacentKeys.add(transportPairKey(item.id, nextItem.id));
  });

  const adjacentTransportByPair = {};
  const invalidTransportItems = [];
  items
    .filter((item) => isTransportationCard(item))
    .forEach((item) => {
      const hasPair = item.from_item_id && item.to_item_id;
      const pairKey = hasPair ? transportPairKey(item.from_item_id, item.to_item_id) : "";
      const pairExists = hasPair && visitIds.has(item.from_item_id) && visitIds.has(item.to_item_id);
      const pairIsAdjacent = pairExists && adjacentKeys.has(pairKey);

      if (pairIsAdjacent) {
        if (!adjacentTransportByPair[pairKey]) adjacentTransportByPair[pairKey] = item;
        return;
      }

      invalidTransportItems.push(item);
    });

  return { adjacentTransportByPair, invalidTransportItems };
}

function transportPairNeedsReview(transportItem, fromItem, toItem) {
  return !transportSnapshotMatchesVisit(transportItem, "from", fromItem) || !transportSnapshotMatchesVisit(transportItem, "to", toItem);
}

function transportTimeShortageMinutes(transportItem, fromItem, toItem) {
  if (!isTransportationCard(transportItem) || !fromItem || !toItem) return 0;
  if (!fromItem.start_time || !fromItem.end_time || !toItem.start_time || !toItem.end_time) return 0;
  const transportMinutes = Number(transportItem.transport_duration_minutes || 0);
  if (!Number.isFinite(transportMinutes) || transportMinutes <= 0) return 0;
  const previousEnd = timeToMinutes(fromItem.end_time);
  const nextStart = timeToMinutes(toItem.start_time);
  if (previousEnd === null || nextStart === null) return 0;
  const gapMinutes = nextStart - previousEnd;
  return Math.max(0, transportMinutes - gapMinutes);
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

function formatHeaderDate(value) {
  if (!value) return "";
  const date = parseDateOnly(value);
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function dateRangeDayCount(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!start || !end || end < start) return null;
  return Math.round((end - start) / 86400000) + 1;
}

function getTodayDateKey() {
  return todayInput();
}

function normalizeDateOnlyKey(value) {
  const date = parseDateOnly(value);
  return date ? formatDateKey(date) : "";
}

function initialDateSelectionStep(startDate, endDate) {
  return startDate && !endDate ? "end" : "start";
}

function deriveTripStage(startDate, endDate, todayDate = getTodayDateKey()) {
  const startKey = normalizeDateOnlyKey(startDate);
  const endKey = normalizeDateOnlyKey(endDate);
  const todayKey = normalizeDateOnlyKey(todayDate);
  if (!startKey || !endKey || !todayKey || endKey < startKey) return "unset";
  if (todayKey < startKey) return "planning";
  if (todayKey > endKey) return "settled";
  return "traveling";
}

function tripStageLabel(stage) {
  return {
    unset: "階段未設定",
    planning: "規劃階段",
    traveling: "旅行階段",
    settled: "結算階段",
  }[stage || "unset"] || "階段未設定";
}

function splitTripDestinationFallback(destination) {
  const value = String(destination || "").trim();
  if (!value) return { city: "", country: "" };
  const dotParts = value
    .split(" · ")
    .map((part) => part.trim())
    .filter(Boolean);
  if (dotParts.length === 2) return { country: dotParts[0], city: dotParts[1] };
  const parts = value
    .split(/[,，]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 2) return { country: parts[1], city: parts[0] };
  return { city: value, country: "" };
}

function tripDestinationParts(trip) {
  const country = String(trip?.destination_country || "").trim();
  const city = String(trip?.destination_city || "").trim();
  if (country || city) return { country, city };
  return splitTripDestinationFallback(trip?.destination);
}

function combineTripDestination(country, city) {
  return [country, city].map((part) => String(part || "").trim()).filter(Boolean).join(" · ");
}

function tripDestinationLabel(trip) {
  const { country, city } = tripDestinationParts(trip);
  return combineTripDestination(country, city) || "目的地未設定";
}

function destinationPatchFromParts(country, city) {
  const nextCountry = String(country || "").trim();
  const nextCity = String(city || "").trim();
  return {
    destination: combineTripDestination(nextCountry, nextCity),
    destination_city: nextCity || null,
    destination_country: nextCountry || null,
  };
}

function destinationPatchFromText(destination) {
  const parts = splitTripDestinationFallback(destination);
  return destinationPatchFromParts(parts.country, parts.city);
}

function buildTripHeaderMeta(trip, members, days) {
  if (!trip) return {};
  const approvedMemberCount = members.filter((member) => member.status === "approved").length;
  const destinationLabel = tripDestinationLabel(trip);
  const startDate = formatHeaderDate(trip.start_date);
  const endDate = formatHeaderDate(trip.end_date);
  const stage = deriveTripStage(trip.start_date, trip.end_date);
  return {
    destinationLabel,
    dateRangeLabel: startDate && endDate ? `${startDate} - ${endDate}` : "",
    dayCountLabel: days.length ? `${days.length} 天` : "",
    stage,
    statusLabel: tripStageLabel(stage),
    membersLabel: `${approvedMemberCount} 位成員`,
  };
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

function getTimelineDayPosition(item) {
  const position = Number(item?.day_index);
  return Number.isInteger(position) && position >= 0 ? position : 0;
}

function getTimelineDayDate(startDate, position) {
  const start = parseDateOnly(startDate);
  if (!start || !Number.isInteger(position) || position < 0) return "";
  return dateToInputValue(addDays(start, position));
}

function emptyTimelineDayCounts() {
  return {
    alternatives: 0,
    budgetLinks: 0,
    fixed: 0,
    timeline: 0,
    transports: 0,
    visits: 0,
  };
}

function buildTimelineDayPreviewMap(items = [], alternatives = [], itineraryBudgetLinks = []) {
  const byPosition = new Map();
  const itemPositionById = new Map();

  items.forEach((item) => {
    const position = getTimelineDayPosition(item);
    const counts = byPosition.get(position) || emptyTimelineDayCounts();
    counts.timeline += 1;
    if (isTransportationCard(item)) counts.transports += 1;
    else counts.visits += 1;
    if (item?.is_fixed) counts.fixed += 1;
    byPosition.set(position, counts);
    if (item?.id) itemPositionById.set(item.id, position);
  });

  alternatives.forEach((alternative) => {
    const position = itemPositionById.get(alternative?.itinerary_item_id);
    if (position === undefined) return;
    const counts = byPosition.get(position) || emptyTimelineDayCounts();
    counts.alternatives += 1;
    byPosition.set(position, counts);
  });

  const budgetLinksByPosition = new Map();
  itineraryBudgetLinks.forEach((link) => {
    const position = itemPositionById.get(link?.itinerary_item_id);
    if (position === undefined || !link?.budget_item_id) return;
    const linkedBudgetIds = budgetLinksByPosition.get(position) || new Set();
    linkedBudgetIds.add(link.budget_item_id);
    budgetLinksByPosition.set(position, linkedBudgetIds);
  });

  budgetLinksByPosition.forEach((linkedBudgetIds, position) => {
    const counts = byPosition.get(position) || emptyTimelineDayCounts();
    counts.budgetLinks = linkedBudgetIds.size;
    byPosition.set(position, counts);
  });

  return byPosition;
}

function getAffectedTimelineDays({
  alternatives = [],
  itineraryBudgetLinks = [],
  items = [],
  newDayCount,
  oldDayCount,
  oldStartDate,
}) {
  const countsByPosition = buildTimelineDayPreviewMap(items, alternatives, itineraryBudgetLinks);
  const affectedDays = [];
  for (let position = newDayCount; position < oldDayCount; position += 1) {
    const counts = countsByPosition.get(position) || emptyTimelineDayCounts();
    affectedDays.push({
      counts,
      dayKey: `index:${position}`,
      label: `Day ${position + 1}`,
      originalDate: getTimelineDayDate(oldStartDate, position),
      position,
    });
  }
  return affectedDays;
}

function classifyTripDateChange({
  alternatives = [],
  itineraryBudgetLinks = [],
  items = [],
  newEndDate,
  newStartDate,
  oldEndDate,
  oldStartDate,
}) {
  const oldDayCount = dateRangeDayCount(oldStartDate, oldEndDate) || 0;
  const newDayCount = dateRangeDayCount(newStartDate, newEndDate) || 0;
  const base = {
    affectedDays: [],
    hasTimelineRemoval: false,
    newDayCount,
    newEndDate,
    newStartDate,
    oldDayCount,
    oldEndDate,
    oldStartDate,
    removedDayPositions: [],
    type: "unchanged",
  };

  if (!oldStartDate || !oldEndDate || !newStartDate || !newEndDate || !oldDayCount || !newDayCount || newEndDate < newStartDate) {
    return { ...base, type: "invalid" };
  }
  if (oldStartDate === newStartDate && oldEndDate === newEndDate) return base;
  if (newDayCount >= oldDayCount) return { ...base, type: "same-or-extended" };

  const affectedDays = getAffectedTimelineDays({
    alternatives,
    itineraryBudgetLinks,
    items,
    newDayCount,
    oldDayCount,
    oldStartDate,
  });
  const removedDayPositions = affectedDays.map((day) => day.position);
  const hasTimelineRemoval = affectedDays.some((day) => day.counts.timeline > 0);

  return {
    ...base,
    affectedDays,
    hasTimelineRemoval,
    removedDayPositions,
    type: hasTimelineRemoval ? "shortened-with-timeline" : "shortened-empty-tail",
  };
}

function buildTripDateChangePreview({
  accommodations = [],
  alternatives = [],
  itineraryBudgetLinks = [],
  items = [],
  newEndDate,
  newStartDate,
  todoItems = [],
  trip,
}) {
  const classification = classifyTripDateChange({
    alternatives,
    itineraryBudgetLinks,
    items,
    newEndDate,
    newStartDate,
    oldEndDate: trip?.end_date || "",
    oldStartDate: trip?.start_date || "",
  });
  return {
    ...classification,
    accommodationCount: accommodations.filter((item) => item?.check_in_date || item?.check_out_date).length,
    todoCount: todoItems.filter((item) => item?.due_date).length,
  };
}

function syncTimelineItemDatesForTripStart(items = [], startDate) {
  return items.map((item) => ({
    ...item,
    date: getTimelineDayDate(startDate, getTimelineDayPosition(item)) || item.date || null,
  }));
}

function timelineItemIdsRemovedByShortening(items = [], newDayCount) {
  const removedIds = new Set(
    items.filter((item) => getTimelineDayPosition(item) >= newDayCount).map((item) => item.id).filter(Boolean),
  );
  items.forEach((item) => {
    if (!isTransportationCard(item)) return;
    if (removedIds.has(item.from_item_id) || removedIds.has(item.to_item_id)) removedIds.add(item.id);
  });
  return removedIds;
}

function timelineItemsInTripRange(items = [], trip) {
  const dayCount = dateRangeDayCount(trip?.start_date, trip?.end_date) || 0;
  if (!dayCount) return [];
  return sortScheduleItems(
    items
      .filter((item) => {
        const position = getTimelineDayPosition(item);
        return position >= 0 && position < dayCount;
      })
      .map((item) => ({
        ...item,
        date: getTimelineDayDate(trip.start_date, getTimelineDayPosition(item)) || item.date || null,
      })),
  );
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
  destination: "東京,日本",
  destination_city: "東京",
  destination_country: "日本",
  start_date: "2026-06-12",
  end_date: "2026-06-14",
  status: "planning",
};

const demoTrips = [
  {
    ...demoTrip,
    id: "demo-trip-kyoto",
    title: "京都琵琶湖之旅-TEST",
    destination: "京都・琵琶湖, 日本",
    start_date: "2027-04-05",
    end_date: "2027-04-10",
    updated_at: "2026-06-15T10:00:00.000Z",
  },
  {
    ...demoTrip,
    id: "demo-trip-system",
    title: "系統測試專用",
    destination: "日本・京都",
    start_date: "2026-07-08",
    end_date: "2026-07-12",
    updated_at: "2026-06-14T10:00:00.000Z",
  },
  {
    ...demoTrip,
    id: "demo-trip-wild",
    title: "野人沒有日記",
    destination: "綠野山林",
    start_date: "2026-05-30",
    end_date: "2026-06-02",
    updated_at: "2026-06-13T10:00:00.000Z",
  },
  {
    ...demoTrip,
    id: "demo-trip-a-test",
    title: "A_TEST",
    destination: "Taiwan・Yilan",
    start_date: "2026-06-23",
    end_date: "2026-06-25",
    updated_at: "2026-06-12T10:00:00.000Z",
  },
];

const demoMembers = [
  { user_id: "demo-peter", display_name: "Peter", email: "peter@example.com", role: "owner", status: "approved" },
  { user_id: "demo-a", display_name: "小安", email: "ariel@example.com", role: "editor", status: "approved" },
  { user_id: "demo-b", display_name: "阿班", email: "ben@example.com", role: "viewer", status: "approved" },
  { user_id: "demo-c", display_name: "Chloe", email: "chloe@example.com", role: "editor", status: "approved" },
  { user_id: "demo-d", display_name: "Dora", email: "dora@example.com", role: "viewer", status: "approved" },
];

function createDemoTimelineItems() {
  return [
    {
      id: "demo-itinerary-1",
      day_index: 0,
      sort_order: 10,
      item_type: "visit",
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
      id: "demo-transport-1",
      day_index: 0,
      sort_order: 15,
      item_type: "transport",
      type: "transport",
      start_time: "10:25",
      end_time: null,
      title: "JR奈良線",
      location: null,
      location_name: null,
      address: null,
      map_url: "",
      description: "新宿站轉乘前往下一站，先確認月台。",
      transportation_note: "新宿站轉乘前往下一站，先確認月台。",
      transport_category: "jr",
      transport_name: "JR奈良線",
      transport_duration_minutes: 25,
      transport_note: "新宿站轉乘前往下一站，先確認月台。",
      from_item_id: "demo-itinerary-1",
      to_item_id: "demo-itinerary-2",
      from_snapshot_start_time: "09:10",
      from_snapshot_end_time: "10:25",
      from_snapshot_destination: "成田機場",
      to_snapshot_start_time: "12:30",
      to_snapshot_end_time: "13:30",
      to_snapshot_destination: "新宿",
      cost: 0,
      updated_at: "2026-05-20T08:00:00.000Z",
    },
    {
      id: "demo-itinerary-2",
      day_index: 0,
      sort_order: 20,
      item_type: "visit",
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
      item_type: "visit",
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
  { id: "demo-link-transport-1", itinerary_item_id: "demo-transport-1", budget_item_id: "demo-budget-1" },
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
  const [isMembersDialogOpen, setIsMembersDialogOpen] = useState(false);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [shareLinks, setShareLinks] = useState([]);
  const [shareSnapshot, setShareSnapshot] = useState(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState("");
  const [activeSection, setActiveSection] = useState("today");
  const [luggageTab, setLuggageTab] = useState("personal");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
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
  const activeTripStage = deriveTripStage(activeTrip?.start_date, activeTrip?.end_date);
  const isTripFinalizedStatus = activeTrip?.status === "settled";
  const isTripInSettlementPhase = activeTripStage === "settled";
  const isTripDateLocked = isTripFinalizedStatus || isTripInSettlementPhase;
  const canEditActiveTripContent = canEdit && !isTripDateLocked;
  const canManageActiveTrip = isOwner && !isTripDateLocked;
  const canChangeTripDates = isOwner && !isTripDateLocked;
  const canInviteMembers = isOwner && !isTripDateLocked;
  const canOpenMembersDialog = activeMembership?.status === "approved";
  const userEmail = session?.user?.email || "";
  const userDisplayName = session?.user?.user_metadata?.full_name || userEmail;
  const userInitial = (userDisplayName.trim()[0] || "?").toUpperCase();
  const canOpenShareDialog = isOwner || (activeMembership?.status === "approved" && activeMembership?.role === "editor");
  const canManageShareLinks = isOwner;
  const canRenameActiveTrip = (canEdit || activeTrip?.owner_id === session?.user?.id) && !isTripDateLocked;
  const isPending = activeMembership?.status === "pending";
  const pendingMemberCount = isOwner ? members.filter((member) => member.status === "pending").length : 0;

  useEffect(() => {
    setIsAccountMenuOpen(false);
  }, [activeSection, activeTripId, isSidebarCollapsed]);
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
  const tripDateChangePreviewData = useMemo(
    () => ({ accommodations, alternatives, itineraryBudgetLinks, items, todoItems }),
    [accommodations, alternatives, itineraryBudgetLinks, items, todoItems],
  );

  const loadTrips = useCallback(
    async (preferredTripId = activeTripId) => {
      if (!session?.user) return;
      const canRestoreSessionContext = !preferredTripId || preferredTripId === activeTripId;
      setLoading(true);
      const { data, error } = await supabase
        .from("trip_members")
        .select(
          "role,status,trip_id,trips(id,title,name,status,destination,destination_country,destination_city,start_date,end_date,owner_id,updated_at)",
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
    if (activeTripId && canOpenShareDialog) {
      loadShareLinks(activeTripId);
    } else {
      setShareLinks([]);
    }
  }, [activeTripId, canOpenShareDialog, loadShareLinks]);

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
    const destinationPatch = destinationPatchFromText(tripForm.destination);
    const { error: tripError } = await supabase.from("trips").insert({
      id: tripId,
      title: tripForm.title.trim(),
      name: tripForm.title.trim(),
      ...destinationPatch,
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
      setNotice(error.message);
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
      setNotice(message);
      return { ok: false, permissionDenied: true, message };
    }
    if (isTripDateLocked && !canOverrideSettlementLock) {
      const message = "旅程已進入結算階段，無法修改日期。";
      setNotice(message);
      return { ok: false, dateLocked: true, message };
    }
    if (!startDate || !endDate || endDate < startDate) {
      setNotice("Invalid trip date range");
      return { ok: false };
    }
    if (hasActiveEditorGuard({ tripId: activeTrip.id })) {
      const message = "目前有未儲存的編輯內容，請先儲存或放棄後再修改旅程日期。";
      setNotice(message);
      return { ok: false, dirtyDraft: true, message };
    }
    const latestTripDraft = session?.user?.id
      ? findLatestDraftTrip({ entityTypes: activeEditDraftEntityTypes, userId: session.user.id })
      : null;
    if (latestTripDraft?.tripId === activeTrip.id) {
      const message = "目前有未儲存的編輯內容，請先儲存或放棄後再修改旅程日期。";
      setNotice(message);
      return { ok: false, dirtyDraft: true, message };
    }
    const preview = buildTripDateChangePreview({
      ...tripDateChangePreviewData,
      newEndDate: endDate,
      newStartDate: startDate,
      trip: activeTrip,
    });
    if (preview.hasTimelineRemoval && !confirmTimelineRemoval) {
      setNotice("This date change would remove Timeline data. Please handle it in the shortening cleanup flow.");
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
    if (error) {
      setNotice(error.message);
      return { ok: false, error };
    }
    if (removedTimelineDraftIds.size && session?.user?.id) {
      removedTimelineDraftIds.forEach((itemId) => {
        clearDraft(
          getDraftKey({
            entityId: itemId,
            entityType: "timeline",
            tripId: activeTrip.id,
            userId: session.user.id,
          }),
        );
      });
    }
    setActiveDay((current) => Math.min(current, Math.max((preview.newDayCount || 1) - 1, 0)));
    await Promise.all([loadTrips(activeTrip.id), loadTripData(activeTrip.id)]);
    return { ok: true, data };
  }

  async function deleteTrip() {
    if (!activeTrip || !canManageActiveTrip) return;
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

  async function ensureItineraryItemEditable(itemId) {
    const localItem = items.find((item) => item.id === itemId);
    if (localItem && isTransportationCard(localItem)) return true;
    if (localItem?.is_fixed) {
      setNotice("此行程已固定，請先解鎖後再修改。");
      return false;
    }
    const { data, error } = await supabase
      .from("itinerary_items")
      .select("is_fixed")
      .eq("id", itemId)
      .eq("trip_id", activeTrip.id)
      .maybeSingle();
    if (error) {
      setNotice(error.message);
      return false;
    }
    if (data?.is_fixed) {
      setNotice("此行程已固定，請先解鎖後再修改。");
      return false;
    }
    return true;
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
    if (!activeTrip || !canEditActiveTripContent) return;
    if (!isCurrentTripContext(meta)) return rejectCrossTripSave();
    const editingItem = editingId ? items.find((item) => item.id === editingId) : null;
    if (editingItem?.is_fixed && !isTransportationCard(editingItem)) {
      setNotice("此行程已固定，請先解鎖後再修改。");
      return { ok: false, fixed: true };
    }
    if (editingId && !(await ensureItineraryItemEditable(editingId))) return { ok: false, fixed: true };
    const normalizedPayload = normalizeItemPayload(payload);
    const invalidTimeRange = !isTransportationCard(normalizedPayload) && isInvalidTimeRange(normalizedPayload.start_time, normalizedPayload.end_time);
    if (invalidTimeRange) {
      setNotice("結束時間必須晚於開始時間。");
      return { ok: false };
    }
    const overlapItem = findOverlappingVisitItem({
      dayIndex: activeDay,
      editingId,
      items,
      payload: normalizedPayload,
    });
    if (overlapItem) {
      const overlapError = formatTimelineOverlapError(overlapItem);
      return { ok: false, overlapError };
    }
    if (editingId) {
      const result = await updateWithConflictCheck("itinerary_items", normalizedPayload, editingId, meta);
      if (result.error) setNotice(result.error.message);
      else if (result.conflict) setNotice("此資料在你編輯期間已被其他人更新。");
      else await loadTripData(activeTrip.id);
      return result;
    }

    const sortOrder = (dayItems.filter((item) => !isTransportationCard(item)).length + 1) * 10;
    const { error } = await supabase.from("itinerary_items").insert({
      ...normalizedPayload,
      trip_id: activeTrip.id,
      day_index: activeDay,
      date: days[activeDay] ? dateToInputValue(days[activeDay]) : null,
      sort_order: sortOrder,
    });
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
    return { ok: !error, error };
  }

  async function saveAlternative(itemId, payload, editingId) {
    if (!activeTrip || !canEditActiveTripContent) return { ok: false };
    const item = items.find((currentItem) => currentItem.id === itemId);
    if (item?.is_fixed) {
      setNotice("此行程已固定，請先解鎖後再修改。");
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
      description: payload.description.trim() || null,
      transportation_note: payload.transportation_note.trim() || null,
    };

    if (editingId) {
      const { error } = await supabase.from("itinerary_alternatives").update(nextPayload).eq("id", editingId);
      if (error) setNotice(error.message);
      else await loadTripData(activeTrip.id);
      return { ok: !error, error };
    }

    const { error } = await supabase.from("itinerary_alternatives").insert({
      ...nextPayload,
      itinerary_item_id: itemId,
    });
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
    return { ok: !error, error };
  }

  async function deleteAlternative(alternativeId) {
    if (!activeTrip || !canEditActiveTripContent) return { ok: false };
    const alternative = alternatives.find((item) => item.id === alternativeId);
    const parentItem = alternative ? items.find((item) => item.id === alternative.itinerary_item_id) : null;
    if (parentItem?.is_fixed) {
      setNotice("此行程已固定，請先解鎖後再修改。");
      return { ok: false, error: { message: "此行程已固定，請先解鎖後再修改。" } };
    }
    if (parentItem && !(await ensureItineraryItemEditable(parentItem.id))) {
      return { ok: false, error: { message: "此行程已固定，請先解鎖後再修改。" } };
    }
    const { error } = await supabase.from("itinerary_alternatives").delete().eq("id", alternativeId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
    return { ok: !error, error };
  }

  async function applyAlternative(item, alternative) {
    if (!activeTrip || !canEditActiveTripContent) return { ok: false };
    if (item?.is_fixed) {
      setNotice("此行程已固定，請先解鎖後再修改。");
      return { ok: false, error: { message: "此行程已固定，請先解鎖後再修改。" } };
    }
    if (!(await ensureItineraryItemEditable(item.id))) {
      return { ok: false, error: { message: "此行程已固定，請先解鎖後再修改。" } };
    }
    const oldMainPayload = {
      title: item.title,
      type: item.type || "attraction",
      start_time: item.start_time || null,
      end_time: item.end_time || null,
      cost: Number(item.cost || 0),
      location_name: item.location_name || item.location || null,
      address: item.address || null,
      map_url: item.map_url || null,
      description: item.description || item.note || null,
      transportation_note: item.transportation_note || null,
    };
    const nextPayload = normalizeItemPayload({
      ...item,
      title: alternative.title,
      type: alternative.type || item.type,
      start_time: item.start_time || "",
      end_time: item.end_time || "",
      location: alternative.location_name || "",
      location_name: alternative.location_name || "",
      address: alternative.address || "",
      map_url: alternative.map_url || "",
      note: alternative.description || "",
      description: alternative.description || "",
      transportation_note: alternative.transportation_note || "",
      cost: alternative.cost || 0,
    });
    const invalidTimeRange = isInvalidTimeRange(nextPayload.start_time, nextPayload.end_time);
    if (invalidTimeRange) {
      setNotice("結束時間必須晚於開始時間。");
      return { ok: false };
    }
    const { error: itemError } = await supabase
      .from("itinerary_items")
      .update(nextPayload)
      .eq("id", item.id);
    if (itemError) {
      setNotice(itemError.message);
      return { ok: false, error: itemError };
    }
    const { error: alternativeError } = await supabase
      .from("itinerary_alternatives")
      .update(oldMainPayload)
      .eq("id", alternative.id);
    if (alternativeError) setNotice(alternativeError.message);
    else await loadTripData(activeTrip.id);
    return { ok: !alternativeError, error: alternativeError };
  }

  async function saveBudget(payload, editingId, meta = {}) {
    if (!activeTrip || !canEditActiveTripContent) return;
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
    if (!activeTrip || !canEditActiveTripContent) return;
    const { error } = await supabase.from("budget_items").delete().eq("id", budgetId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function saveActualExpense(payload, editingId, meta = {}) {
    if (!activeTrip || !canEditActiveTripContent) return;
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
    if (!activeTrip || !canEditActiveTripContent) return;
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
    if (!activeTrip || !canEditActiveTripContent) return;
    const { error } = await supabase.from("actual_expenses").delete().eq("id", expenseId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function saveAccommodation(payload, editingId, meta = {}) {
    if (!activeTrip || !canEditActiveTripContent) return;
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
    if (!activeTrip || !canEditActiveTripContent) return;
    const { error } = await supabase.from("accommodations").delete().eq("id", accommodationId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function saveGuide(payload, editingId, meta = {}) {
    if (!activeTrip || !canEditActiveTripContent) return;
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
    if (!activeTrip || !canEditActiveTripContent) return;
    const { error } = await supabase.from("guide_items").delete().eq("id", guideId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function saveTodo(payload, editingId, meta = {}) {
    if (!activeTrip || !canEditActiveTripContent) return;
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
    if (!canEditActiveTripContent) return;
    const { error } = await supabase.from("todo_items").update({ completed: !todo.completed }).eq("id", todo.id);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function deleteTodo(todoId) {
    if (!activeTrip || !canEditActiveTripContent) return;
    const { error } = await supabase.from("todo_items").delete().eq("id", todoId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function saveLuggageItem(payload, editingId, meta = {}) {
    if (!activeTrip || !session?.user || !canEditActiveTripContent) return;
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
    if (!session?.user || !canEditActiveTripContent) return;
    const { error } = await supabase.from("luggage_items").update({ packed: !item.packed }).eq("id", item.id);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function deleteLuggageItem(itemId) {
    if (!session?.user || !canEditActiveTripContent) return;
    const { error } = await supabase.from("luggage_items").delete().eq("id", itemId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function saveSharedLuggageItem(payload, editingId, meta = {}) {
    if (!activeTrip || !canEditActiveTripContent) return;
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
    if (!activeTrip || !session?.user || !canEditActiveTripContent) return;
    const { error } = await supabase.from("shared_luggage_items").update(patch).eq("id", itemId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function deleteSharedLuggageItem(itemId) {
    if (!canEditActiveTripContent) return;
    const { error } = await supabase.from("shared_luggage_items").delete().eq("id", itemId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function uploadAttachment(targetType, targetId, file) {
    if (!activeTrip || !canEditActiveTripContent || !file) return;
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
    if (!activeTrip || !canEditActiveTripContent) return;
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
    if (!activeTrip || !canEditActiveTripContent) return;
    const item = items.find((currentItem) => currentItem.id === itemId);
    if (item?.is_fixed && !isTransportationCard(item)) {
      setNotice("此行程已固定，請先解鎖後再修改。");
      return;
    }
    if (item && !isTransportationCard(item) && !(await ensureItineraryItemEditable(itemId))) return;
    if (item && !isTransportationCard(item)) {
      const relatedDeleteResults = await Promise.all([
        supabase
          .from("itinerary_items")
          .delete()
          .eq("trip_id", activeTrip.id)
          .eq("from_item_id", itemId),
        supabase
          .from("itinerary_items")
          .delete()
          .eq("trip_id", activeTrip.id)
          .eq("to_item_id", itemId),
      ]);
      const relatedError = relatedDeleteResults.find((result) => result.error)?.error;
      if (relatedError) {
        setNotice(relatedError.message);
        return;
      }
    }
    const { error } = await supabase.from("itinerary_items").delete().eq("id", itemId).eq("trip_id", activeTrip.id);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function toggleItemFixed(item) {
    if (!activeTrip || !canEditActiveTripContent || !item || isTransportationCard(item)) return { ok: false };
    if (!item.is_fixed && item.locked_by) {
      setNotice("此行程目前有人正在編輯，暫時無法鎖定。");
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
      setNotice(error.message);
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
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function reorderItem(draggedId, targetId) {
    if (!canEditActiveTripContent || draggedId === targetId) return;
    const nextItems = [...dayItems];
    const from = nextItems.findIndex((item) => item.id === draggedId);
    const to = nextItems.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    if (nextItems[from]?.is_fixed || nextItems[to]?.is_fixed) {
      setNotice("固定行程不可拖曳或作為排序目標。");
      return;
    }
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
    if (!activeTrip || !canEditActiveTripContent || !title.trim()) return;
    const { error } = await supabase
      .from("pack_items")
      .insert({ trip_id: activeTrip.id, title: title.trim() });
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function togglePackItem(item) {
    if (!canEditActiveTripContent) return;
    const { error } = await supabase
      .from("pack_items")
      .update({ done: !item.done })
      .eq("id", item.id);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function deletePackItem(itemId) {
    if (!canEditActiveTripContent) return;
    const { error } = await supabase.from("pack_items").delete().eq("id", itemId);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function approveMember(memberId) {
    if (!activeTrip || !canInviteMembers) return;
    const { error } = await supabase
      .from("trip_members")
      .update({ status: "approved" })
      .eq("id", memberId)
      .eq("trip_id", activeTrip.id);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function rejectMember(memberId) {
    if (!activeTrip || !canInviteMembers) return;
    const { error } = await supabase.from("trip_members").delete().eq("id", memberId).eq("trip_id", activeTrip.id);
    if (error) setNotice(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function createMemberInviteToken() {
    if (!activeTrip || !canInviteMembers) {
      const message = isTripDateLocked
        ? "旅程已進入結算階段，無法邀請或管理成員。"
        : "You do not have permission to invite members.";
      setNotice(message);
      return { ok: false, message };
    }
    const token = crypto.randomUUID();
    const { error } = await supabase.from("trip_invites").insert({
      trip_id: activeTrip.id,
      token,
    });
    if (error) {
      setNotice(error.message);
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
      setNotice(error.message);
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
      setNotice(error.message);
      return { ok: false, error };
    }
    await loadTripData(activeTrip.id);
    return { ok: true };
  }

function exportTrip() {
    if (!activeTrip) return;
    const exportedItems = timelineItemsInTripRange(items, activeTrip);
    const payload = {
      ...activeTrip,
      itinerary_items: exportedItems,
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
    return <DemoApp initialSection={demoSection} />;
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
    <Shell appLayout collapsed={isSidebarCollapsed}>
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
              setActiveSection("today");
            }}
          >
            TP
          </button>
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
        <nav className="section-nav" aria-label="功能導覽">
          {desktopNavItems.map((item) => {
            const Icon = item.Icon;
            return (
              <button
                className={`section-nav-button${activeSection === item.id ? " active" : ""}`}
                key={item.id}
                type="button"
                title={item.label}
                aria-label={item.label}
                aria-current={activeSection === item.id ? "page" : undefined}
                onClick={() => setActiveSection(item.id)}
              >
                <span className="section-nav-icon" aria-hidden="true">
                  <Icon size={15} strokeWidth={2.2} />
                </span>
                <span className="nav-label">{item.label}</span>
              </button>
            );
          })}
        </nav>
        <section className="sidebar-trip-section" aria-labelledby="sidebar-trips-title">
          <div className="sidebar-trip-heading">
            <h2 id="sidebar-trips-title">我的旅程</h2>
            <button
              className="mini-button sidebar-create-trip"
              type="button"
              title="新增旅程"
              aria-label="新增旅程"
              onClick={() => setIsTripDialogOpen(true)}
            >
              +
            </button>
          </div>
          <div className="sidebar-trip-list-region">
            <TripList trips={trips} activeTripId={activeTripId} compact={isSidebarCollapsed} onCreate={() => setIsTripDialogOpen(true)} onSelect={selectTrip} />
          </div>
        </section>
        <SidebarAccountMenu
          collapsed={isSidebarCollapsed}
          email={userEmail}
          initial={userInitial}
          isOpen={isAccountMenuOpen}
          name={userDisplayName}
          onClose={() => setIsAccountMenuOpen(false)}
          onSettings={() => setActiveSection("settings")}
          onSignOut={signOut}
          onToggle={() => setIsAccountMenuOpen((value) => !value)}
        />
      </aside>

      <main className="workspace">
        <TripHeader
          activeSection={activeSection}
          trip={activeTrip}
          members={members}
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
          onExport={exportTrip}
          onInvite={() => {
            if (canOpenMembersDialog) setIsMembersDialogOpen(true);
          }}
          onOpenMembers={() => {
            if (canOpenMembersDialog) setIsMembersDialogOpen(true);
          }}
          onShare={() => {
            if (canOpenShareDialog) setIsShareDialogOpen(true);
          }}
          onUpdateTrip={updateTrip}
          onUpdateTripDateRange={updateTripDateRange}
          showDeveloperTools={isOwner}
        />

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
            canEdit={canEditActiveTripContent}
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
            onConfirmTransportWarning={confirmTransportWarning}
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

function normalizeItemPayload(payload) {
  if (payload.item_type === "transport") {
    const transportName = String(payload.transport_name || payload.title || "").trim();
    const transportNote = String(payload.transport_note || payload.transportation_note || payload.description || payload.note || "").trim();
    const durationMinutes = Number(payload.transport_duration_minutes || 0);
    return {
      ...payload,
      item_type: "transport",
      type: "transport",
      title: transportName,
      location: null,
      location_name: null,
      note: transportNote || null,
      description: transportNote || null,
      transportation_note: transportNote || null,
      transport_category: payload.transport_category || defaultTransportCategory,
      transport_name: transportName,
      transport_duration_minutes: Number.isFinite(durationMinutes) && durationMinutes > 0 ? Math.round(durationMinutes) : null,
      transport_note: transportNote || null,
      from_item_id: payload.from_item_id || null,
      to_item_id: payload.to_item_id || null,
      from_snapshot_start_time: payload.from_snapshot_start_time || null,
      from_snapshot_end_time: payload.from_snapshot_end_time || null,
      from_snapshot_destination: payload.from_snapshot_destination || null,
      to_snapshot_start_time: payload.to_snapshot_start_time || null,
      to_snapshot_end_time: payload.to_snapshot_end_time || null,
      to_snapshot_destination: payload.to_snapshot_destination || null,
      start_time: payload.start_time || null,
      end_time: null,
      address: null,
      map_url: null,
    };
  }
  const locationName = payload.location_name || payload.location;
  const description = payload.description || payload.note;
  return {
    ...payload,
    item_type: payload.item_type || "visit",
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
    transport_category: null,
    transport_name: null,
    transport_duration_minutes: null,
    transport_note: null,
    from_item_id: null,
    to_item_id: null,
    from_snapshot_start_time: null,
    from_snapshot_end_time: null,
    from_snapshot_destination: null,
    to_snapshot_start_time: null,
    to_snapshot_end_time: null,
    to_snapshot_destination: null,
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

function formatTimelineOverlapError(item) {
  const label = visitSnapshotDestination(item) || item?.title || "行程";
  return `此行程時間與「${label} ${formatTimeDisplay(item?.start_time)}~${formatTimeDisplay(item?.end_time)}」重疊，請調整時間。`;
}

function findOverlappingVisitItem({ dayIndex, editingId, items, payload }) {
  if (isTransportationCard(payload)) return null;
  const newStart = timeToMinutes(payload?.start_time);
  const newEnd = timeToMinutes(payload?.end_time);
  if (newStart === null || newEnd === null) return null;

  return sortScheduleItems(items || []).find((item) => {
    if (isTransportationCard(item)) return false;
    if (editingId && item.id === editingId) return false;
    if (Number(item.day_index) !== Number(dayIndex)) return false;
    const otherStart = timeToMinutes(item.start_time);
    const otherEnd = timeToMinutes(item.end_time);
    if (otherStart === null || otherEnd === null) return false;
    return newStart < otherEnd && newEnd > otherStart;
  });
}

function Shell({ appLayout = false, children, collapsed = false }) {
  return <div className={`app-shell${appLayout ? " app-shell-workspace" : ""}${collapsed ? " sidebar-collapsed" : ""}`}>{children}</div>;
}

function SidebarAccountMenu({
  collapsed = false,
  email = "",
  initial = "?",
  isOpen,
  name,
  onClose,
  onSettings,
  onSignOut,
  onToggle,
  settingsDisabled = false,
  signOutDisabled = false,
}) {
  const menuRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    function handlePointerDown(event) {
      if (!menuRef.current || menuRef.current.contains(event.target)) return;
      onClose();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isOpen, onClose]);

  return (
    <div className="user-box" ref={menuRef}>
      {isOpen ? (
        <div className="account-menu" role="menu" aria-label="帳號選單">
          <button
            className="account-menu-item"
            type="button"
            role="menuitem"
            disabled={settingsDisabled}
            onClick={() => {
              onClose();
              onSettings();
            }}
          >
            <Settings size={16} aria-hidden="true" strokeWidth={2.2} />
            <span>設定</span>
          </button>
          <div className="account-menu-separator" aria-hidden="true" />
          <button
            className="account-menu-item"
            type="button"
            role="menuitem"
            disabled={signOutDisabled}
            onClick={() => {
              onClose();
              onSignOut();
            }}
          >
            <LogOut size={16} aria-hidden="true" strokeWidth={2.2} />
            <span>登出</span>
          </button>
        </div>
      ) : null}
      <button
        className="user-box-card"
        type="button"
        title="帳號選單"
        aria-label="帳號選單"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={onToggle}
      >
        <span className="user-avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="user-account">
          <strong className="nav-label">{name}</strong>
          {email ? <span className="user-email nav-label">{email}</span> : null}
        </span>
        <span className="account-menu-arrow" aria-hidden="true">
          {collapsed ? null : isOpen ? <ChevronDown size={16} strokeWidth={2.2} /> : <ChevronUp size={16} strokeWidth={2.2} />}
        </span>
      </button>
    </div>
  );
}

function TripDateRangeSelector({
  activeStep,
  disabled = false,
  endDate,
  endInput,
  errorId,
  minDateKey = "",
  onCommitInput,
  onEndInputChange,
  onHoverDate,
  onInputKeyDown,
  onSelectDate,
  onStartInputChange,
  onVisibleMonthChange,
  previewEndDate = "",
  startDate,
  startInput,
  startInputRef,
  visibleMonth,
}) {
  const monthFormat = useMemo(() => new Intl.DateTimeFormat("zh-TW", { month: "long", year: "numeric" }), []);
  const fullDateFormat = useMemo(
    () => new Intl.DateTimeFormat("zh-TW", { day: "numeric", month: "long", year: "numeric" }),
    [],
  );

  function renderMonth(monthDate, controls = {}) {
    const cells = calendarMonthCells(monthDate);
    const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
    return (
      <section className="trip-date-range-month" key={formatDateKey(monthDate)}>
        <div className="trip-date-range-month-header">
          {controls.previous ? (
            <button
              type="button"
              className="mini-button"
              disabled={disabled}
              aria-label="上一個月份"
              onClick={() => onVisibleMonthChange(addMonths(visibleMonth, -1))}
            >
              &lt;
            </button>
          ) : (
            <span />
          )}
          <strong>{monthFormat.format(monthDate)}</strong>
          {controls.next ? (
            <button
              type="button"
              className="mini-button"
              disabled={disabled}
              aria-label="下一個月份"
              onClick={() => onVisibleMonthChange(addMonths(visibleMonth, 1))}
            >
              &gt;
            </button>
          ) : (
            <span />
          )}
        </div>
        <div className="trip-date-range-weekdays" aria-hidden="true">
          {weekdays.map((weekday) => (
            <span key={weekday}>{weekday}</span>
          ))}
        </div>
        <div className="trip-date-range-grid">
          {cells.map((cell) => {
            if (cell.blank) {
              return <span className="trip-date-range-day-blank" key={cell.key} aria-hidden="true" />;
            }
            const isDisabledDate = Boolean(minDateKey && isDateBefore(cell.key, minDateKey));
            const isRangeStart = isSameDate(cell.key, startDate);
            const isRangeEnd = isSameDate(cell.key, endDate);
            const isSingleDay = Boolean(startDate && endDate && isSameDate(startDate, endDate) && isRangeStart);
            const isInRange = isDateInRange(cell.key, startDate, endDate) && !isRangeStart && !isRangeEnd;
            const isPreviewRange =
              !isDisabledDate && Boolean(previewEndDate) && isDateInRange(cell.key, startDate, previewEndDate) && !isRangeStart;
            const classNames = [
              "trip-date-range-day",
              isDisabledDate ? "is-disabled" : "",
              isSameDate(cell.key, todayInput()) ? "is-today" : "",
              isRangeStart ? "is-range-start" : "",
              isInRange ? "is-in-range" : "",
              isRangeEnd ? "is-range-end" : "",
              isSingleDay ? "is-single-day" : "",
              isPreviewRange ? "is-preview-range" : "",
            ]
              .filter(Boolean)
              .join(" ");
            const selectionLabel = isRangeStart
              ? "，開始日期"
              : isRangeEnd
                ? "，結束日期"
                : isInRange || isPreviewRange
                  ? "，行程範圍內"
                  : "";
            return (
              <button
                className={classNames}
                key={cell.key}
                type="button"
                disabled={disabled || isDisabledDate}
                aria-label={`${fullDateFormat.format(cell.date)}${selectionLabel}`}
                aria-disabled={isDisabledDate ? "true" : undefined}
                aria-selected={isRangeStart || isRangeEnd || isInRange}
                onClick={() => onSelectDate(cell.key)}
                onMouseEnter={() => {
                  if (!disabled && !isDisabledDate && activeStep === "end" && startDate && !endDate) onHoverDate(cell.key);
                }}
                onFocus={() => {
                  if (!disabled && !isDisabledDate && activeStep === "end" && startDate && !endDate) onHoverDate(cell.key);
                }}
              >
                <span>{cell.day}</span>
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <>
      <div className="trip-date-range-summary" aria-live="polite">
        <label className={`trip-date-range-summary-item${activeStep === "start" ? " is-active" : ""}`}>
          <span>開始日期</span>
          <input
            ref={startInputRef}
            type="text"
            inputMode="numeric"
            placeholder="YYYYMMDD"
            value={startInput}
            disabled={disabled}
            aria-describedby={errorId}
            onBlur={() => onCommitInput("start")}
            onChange={(event) => onStartInputChange(event.target.value)}
            onKeyDown={(event) => onInputKeyDown(event, "start")}
          />
        </label>
        <label className={`trip-date-range-summary-item${activeStep === "end" ? " is-active" : ""}`}>
          <span>結束日期</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="YYYYMMDD"
            value={endInput}
            disabled={disabled}
            aria-describedby={errorId}
            onBlur={() => onCommitInput("end")}
            onChange={(event) => onEndInputChange(event.target.value)}
            onKeyDown={(event) => onInputKeyDown(event, "end")}
          />
        </label>
      </div>
      <div className="trip-date-range-picker">
        <div className="trip-date-range-months" onMouseLeave={() => onHoverDate("")}>
          {renderMonth(visibleMonth, { previous: true })}
          {renderMonth(addMonths(visibleMonth, 1), { next: true })}
        </div>
      </div>
    </>
  );
}

function TripHeaderIcon({ name }) {
  if (name === "invite") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M15 20a6 6 0 0 0-12 0" />
        <circle cx="9" cy="8" r="4" />
        <path d="M19 8v6" />
        <path d="M22 11h-6" />
      </svg>
    );
  }
  if (name === "share") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <path d="m8.6 10.6 6.8-4.2" />
        <path d="m8.6 13.4 6.8 4.2" />
      </svg>
    );
  }
  if (name === "more") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="12" cy="5" r="1.5" />
        <circle cx="12" cy="12" r="1.5" />
        <circle cx="12" cy="19" r="1.5" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m4 20 4.4-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" />
      <path d="m14 6 4 4" />
    </svg>
  );
}

function TripDateChangePreview({ isRemovalConfirmed = false, onConfirmRemoval, preview }) {
  if (!preview || preview.type === "unchanged" || preview.type === "invalid") return null;
  const addedDayCount = Math.max(0, preview.newDayCount - preview.oldDayCount);
  const isBlocked = preview.type === "shortened-with-timeline";
  const isShortened = preview.type === "shortened-empty-tail" || preview.type === "shortened-with-timeline";
  const reviewCount = preview.accommodationCount + preview.todoCount;

  return (
    <div className={`trip-date-change-preview${isBlocked ? " is-blocked" : ""}`} aria-live="polite">
      {preview.type === "same-or-extended" ? (
        <p>
          Day 1 會對齊新的開始日期
          {addedDayCount ? `，並新增 ${addedDayCount} 個空白 Day。` : "，既有 Day 順序維持不變。"}
        </p>
      ) : null}
      {preview.type === "shortened-empty-tail" ? (
        <p>將移除 {preview.removedDayPositions.length} 個尾端空白 Day，未發現 Timeline 資料。</p>
      ) : null}
      {isBlocked ? <p>此變更會移除含有 Timeline 資料的 Day，本階段先阻擋儲存。</p> : null}
      {isShortened && preview.affectedDays.length ? (
        <ul className="trip-date-change-days">
          {preview.affectedDays.map((day) => (
            <li key={day.dayKey}>
              <strong>
                {day.label}
                {day.originalDate ? ` · ${formatHeaderDate(day.originalDate)}` : ""}
              </strong>
              {day.counts.timeline ? (
                <span>
                  {day.counts.visits} 個行程、{day.counts.transports} 個交通
                  {day.counts.fixed ? `、${day.counts.fixed} 個固定項目` : ""}
                  {day.counts.alternatives ? `、${day.counts.alternatives} 個備案` : ""}
                  {day.counts.budgetLinks ? `、${day.counts.budgetLinks} 個預算連結` : ""}
                </span>
              ) : (
                <span>空白 Day</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {reviewCount ? (
        <p className="trip-date-change-note">
          住宿 {preview.accommodationCount} 筆、待辦 {preview.todoCount} 筆不會自動調整，儲存後請人工確認。
        </p>
      ) : null}
      {isBlocked ? (
        <div className="trip-date-change-confirm">
          <span>
            {isRemovalConfirmed
              ? "已確認縮短旅程，儲存後會刪除上述 Timeline 資料。"
              : "請先確認縮短旅程，確認不會立即儲存。"}
          </span>
          {!isRemovalConfirmed ? (
            <button type="button" className="ghost-button compact" onClick={onConfirmRemoval}>
              確認縮短旅程
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function HeaderMemberPreview({ disabled, members = [], onOpen, pendingCount = 0 }) {
  const approvedMembers = members.filter((member) => member.status === "approved");
  const visibleMembers = approvedMembers.slice(0, 4);
  const overflowCount = Math.max(approvedMembers.length - visibleMembers.length, 0);
  return (
    <button
      className="trip-header-member-preview"
      type="button"
      title="成員與邀請"
      aria-label="成員與邀請"
      disabled={disabled}
      onClick={onOpen}
    >
      <span className="trip-header-member-avatars" aria-hidden="true">
        {visibleMembers.map((member) => (
          <span className="member-avatar compact" key={member.id || member.user_id} title={memberName(member)}>
            {memberInitial(member)}
          </span>
        ))}
        {overflowCount > 0 ? <span className="member-avatar compact more">+{overflowCount}</span> : null}
      </span>
      {pendingCount > 0 ? <span className="trip-header-member-pending">待審 {pendingCount}</span> : null}
      <TripHeaderIcon name="invite" />
    </button>
  );
}

function TripHeader({
  activeSection,
  trip,
  members = [],
  days = [],
  dateChangePreviewData = {},
  demoNotice = "",
  canEditTrip = false,
  canChangeTripDates = canEditTrip,
  canOpenMembers = canEditTrip,
  canRenameTrip = canEditTrip,
  canShare = canEditTrip,
  canViewDatePopover = canChangeTripDates,
  pendingMemberCount = 0,
  onDelete,
  onExport,
  onInvite,
  onOpenMembers,
  onShare,
  onUpdateTrip,
  onUpdateTripDateRange,
  showDeveloperTools = false,
}) {
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isDeveloperToolsOpen, setIsDeveloperToolsOpen] = useState(false);
  const [developerStartDateDraft, setDeveloperStartDateDraft] = useState("");
  const [developerEndDateDraft, setDeveloperEndDateDraft] = useState("");
  const [developerToolsError, setDeveloperToolsError] = useState("");
  const [isApplyingDeveloperDates, setIsApplyingDeveloperDates] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleError, setTitleError] = useState("");
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [isDestinationPopoverOpen, setIsDestinationPopoverOpen] = useState(false);
  const [countryDraft, setCountryDraft] = useState("");
  const [cityDraft, setCityDraft] = useState("");
  const [destinationError, setDestinationError] = useState("");
  const [isSavingDestination, setIsSavingDestination] = useState(false);
  const [isDatePopoverOpen, setIsDatePopoverOpen] = useState(false);
  const [startDateDraft, setStartDateDraft] = useState("");
  const [endDateDraft, setEndDateDraft] = useState("");
  const [originalStartDate, setOriginalStartDate] = useState("");
  const [originalEndDate, setOriginalEndDate] = useState("");
  const [startDateInput, setStartDateInput] = useState("");
  const [endDateInput, setEndDateInput] = useState("");
  const [dateSelectionStep, setDateSelectionStep] = useState("start");
  const [isDateRemovalConfirmed, setIsDateRemovalConfirmed] = useState(false);
  const [hoveredDate, setHoveredDate] = useState("");
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(parseDateOnly(todayInput()) || new Date()));
  const [dateError, setDateError] = useState("");
  const [isSavingDates, setIsSavingDates] = useState(false);
  const menuRef = useRef(null);
  const developerStartDateRef = useRef(null);
  const developerDateSaveRef = useRef(false);
  const destinationPopoverRef = useRef(null);
  const destinationButtonRef = useRef(null);
  const countryInputRef = useRef(null);
  const cityInputRef = useRef(null);
  const datePopoverRef = useRef(null);
  const dateButtonRef = useRef(null);
  const dateDialogRef = useRef(null);
  const startDateTextInputRef = useRef(null);
  const titleInputRef = useRef(null);
  const titleSaveRef = useRef(false);
  const destinationSaveRef = useRef(false);
  const dateSaveRef = useRef(false);
  const meta = useMemo(() => buildTripHeaderMeta(trip, members, days), [days, members, trip]);
  const hasTrip = Boolean(trip);
  const canEditTitle = hasTrip && canRenameTrip && typeof onUpdateTrip === "function";
  const canOpenTripEditor = hasTrip && canEditTrip && typeof onUpdateTrip === "function";
  const canViewTripDateRange = hasTrip && canViewDatePopover && typeof onUpdateTripDateRange === "function";
  const canUpdateTripDateRange = canViewTripDateRange && canChangeTripDates;
  const canOpenDestinationPopover = canOpenTripEditor;
  const canOpenDatePopover = canViewTripDateRange;
  const canOpenDeveloperTools = hasTrip && showDeveloperTools && typeof onUpdateTripDateRange === "function";
  const isDateRangeEmpty = !startDateDraft && !endDateDraft;
  const dateDraftDayCount = dateRangeDayCount(startDateDraft, endDateDraft);
  const todayDateKey = todayInput();
  const previewEndDate =
    dateSelectionStep === "end" &&
    startDateDraft &&
    !endDateDraft &&
    hoveredDate &&
    !isDateBefore(hoveredDate, startDateDraft) &&
    !isDateBefore(hoveredDate, todayDateKey)
      ? hoveredDate
      : "";
  const previewDayCount = previewEndDate ? dateRangeDayCount(startDateDraft, previewEndDate) : null;
  const dateChangePreview = useMemo(
    () =>
      buildTripDateChangePreview({
        ...dateChangePreviewData,
        newEndDate: endDateDraft,
        newStartDate: startDateDraft,
        trip,
      }),
    [dateChangePreviewData, endDateDraft, startDateDraft, trip],
  );
  useEffect(() => {
    if (!dateChangePreview.hasTimelineRemoval) setIsDateRemovalConfirmed(false);
  }, [dateChangePreview.hasTimelineRemoval]);
  const metaItems = [
    meta.destinationLabel
      ? {
          action: canOpenDestinationPopover,
          key: "destination",
          label: meta.destinationLabel,
          onClick: () => toggleDestinationPopover(),
          title: canOpenDestinationPopover ? "編輯目的地" : undefined,
        }
      : null,
    meta.dateRangeLabel
      ? {
          action: canOpenDatePopover,
          key: "dates",
          label: meta.dateRangeLabel,
          onClick: () => toggleDatePopover(),
          title: canOpenDatePopover ? "編輯旅程日期" : undefined,
        }
      : null,
    meta.dayCountLabel ? { key: "days", label: meta.dayCountLabel } : null,
    meta.statusLabel
      ? {
          className: `trip-header-stage is-${meta.stage}`,
          key: "status",
          label: meta.statusLabel,
          title: "系統會依旅程日期自動判斷目前階段",
        }
      : null,
    meta.membersLabel
      ? {
          action: canOpenMembers && typeof onOpenMembers === "function",
          key: "members",
          label: meta.membersLabel,
          onClick: () => openMembers(),
          title: canOpenMembers && typeof onOpenMembers === "function" ? "成員與邀請" : undefined,
        }
      : null,
    demoNotice ? { key: "demo-notice", label: demoNotice } : null,
  ].filter(Boolean);

  useEffect(() => {
    if (!isMoreOpen) return undefined;
    function closeOnEscape(event) {
      if (event.key === "Escape") setIsMoreOpen(false);
    }
    function closeOnOutsidePointer(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) setIsMoreOpen(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [isMoreOpen]);

  useEffect(() => {
    if (!isEditingTitle) return;
    requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });
  }, [isEditingTitle]);

  useEffect(() => {
    if (!isDestinationPopoverOpen) return undefined;
    requestAnimationFrame(() => {
      countryInputRef.current?.focus();
    });
    function closeOnEscape(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDestinationPopover();
      }
    }
    function closeOnOutsidePointer(event) {
      if (destinationPopoverRef.current && !destinationPopoverRef.current.contains(event.target)) {
        closeDestinationPopover();
      }
    }
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [isDestinationPopoverOpen]);

  useEffect(() => {
    if (!isDestinationPopoverOpen) return;
    closeDestinationPopover({ restoreFocus: false });
  }, [activeSection, trip?.id]);

  useEffect(() => {
    if (!isDeveloperToolsOpen) return;
    requestAnimationFrame(() => {
      developerStartDateRef.current?.focus();
    });
  }, [isDeveloperToolsOpen]);

  useEffect(() => {
    if (!isDeveloperToolsOpen) return;
    closeDeveloperTools();
  }, [activeSection, trip?.id]);

  useEffect(() => {
    if (!isDatePopoverOpen) return undefined;
    requestAnimationFrame(() => {
      startDateTextInputRef.current?.focus();
    });
    function closeOnEscape(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDatePopover();
      }
    }
    function closeOnOutsidePointer(event) {
      if (datePopoverRef.current && !datePopoverRef.current.contains(event.target)) {
        closeDatePopover();
      }
    }
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [isDatePopoverOpen]);

  useEffect(() => {
    if (!isDatePopoverOpen) return;
    closeDatePopover({ restoreFocus: false });
  }, [activeSection, trip?.id]);

  function chooseMenuAction(action) {
    setIsMoreOpen(false);
    closeDestinationPopover({ restoreFocus: false });
    action();
  }

  function closeDeveloperTools() {
    setIsDeveloperToolsOpen(false);
    setDeveloperToolsError("");
    setIsApplyingDeveloperDates(false);
    developerDateSaveRef.current = false;
  }

  async function toggleDeveloperTools() {
    if (isDeveloperToolsOpen) {
      closeDeveloperTools();
      return;
    }
    await openDeveloperTools();
  }

  async function openDeveloperTools() {
    if (!canOpenDeveloperTools || isApplyingDeveloperDates) return;
    setIsMoreOpen(false);
    closeDestinationPopover({ restoreFocus: false });
    closeDatePopover({ restoreFocus: false });
    if (isEditingTitle) {
      const canContinue = await saveTitleDraft();
      if (!canContinue) return;
    }
    setDeveloperStartDateDraft(trip?.start_date || "");
    setDeveloperEndDateDraft(trip?.end_date || "");
    setDeveloperToolsError("");
    setIsDeveloperToolsOpen(true);
  }

  function validateDeveloperDateDrafts() {
    const nextStartDate = developerStartDateDraft.trim();
    const nextEndDate = developerEndDateDraft.trim();
    if (!nextStartDate || !nextEndDate) return "請選擇開始日期與結束日期";
    const start = parseDateOnly(nextStartDate);
    const end = parseDateOnly(nextEndDate);
    if (!start || !end) return "請選擇開始日期與結束日期";
    if (isDateBefore(nextEndDate, nextStartDate)) return "結束日期不能早於開始日期";
    return "";
  }

  async function applyDeveloperDates() {
    if (!canOpenDeveloperTools || developerDateSaveRef.current) return false;
    const nextStartDate = developerStartDateDraft.trim();
    const nextEndDate = developerEndDateDraft.trim();
    const validationError = validateDeveloperDateDrafts();
    if (validationError) {
      setDeveloperToolsError(validationError);
      return false;
    }
    setDeveloperToolsError("");
    developerDateSaveRef.current = true;
    setIsApplyingDeveloperDates(true);
    let result;
    try {
      result = await onUpdateTripDateRange({
        allowSettlementOverride: true,
        source: "developer-date-tool",
        startDate: nextStartDate,
        endDate: nextEndDate,
      });
    } catch (error) {
      result = { ok: false, error };
    }
    if (result?.ok === false) {
      developerDateSaveRef.current = false;
      setIsApplyingDeveloperDates(false);
      setDeveloperToolsError(result.message || "套用失敗，請再試一次");
      return false;
    }
    developerDateSaveRef.current = false;
    setIsApplyingDeveloperDates(false);
    closeDeveloperTools();
    return true;
  }

  function closeDestinationPopover({ restoreFocus = true } = {}) {
    setIsDestinationPopoverOpen(false);
    setDestinationError("");
    setIsSavingDestination(false);
    destinationSaveRef.current = false;
    if (restoreFocus) {
      requestAnimationFrame(() => {
        destinationButtonRef.current?.focus();
      });
    }
  }

  async function toggleDestinationPopover() {
    if (isDestinationPopoverOpen) {
      closeDestinationPopover();
      return;
    }
    await openDestinationPopover();
  }

  async function openDestinationPopover() {
    if (!canOpenDestinationPopover || isSavingDestination) return;
    setIsMoreOpen(false);
    closeDatePopover({ restoreFocus: false });
    closeDeveloperTools();
    if (isEditingTitle) {
      const canContinue = await saveTitleDraft();
      if (!canContinue) return;
    }
    const { country, city } = tripDestinationParts(trip);
    setCountryDraft(country);
    setCityDraft(city);
    setDestinationError("");
    setIsDestinationPopoverOpen(true);
  }

  async function saveDestinationDrafts() {
    if (!canOpenDestinationPopover || destinationSaveRef.current) return false;
    const nextCountry = countryDraft.trim();
    const nextCity = cityDraft.trim();
    const patch = destinationPatchFromParts(nextCountry, nextCity);
    const currentParts = tripDestinationParts(trip);
    const currentDestination = combineTripDestination(currentParts.country, currentParts.city);
    if (
      patch.destination_country === (currentParts.country || null) &&
      patch.destination_city === (currentParts.city || null) &&
      patch.destination === currentDestination
    ) {
      closeDestinationPopover();
      return true;
    }
    setDestinationError("");
    destinationSaveRef.current = true;
    setIsSavingDestination(true);
    let result;
    try {
      result = await onUpdateTrip(patch);
    } catch (error) {
      result = { ok: false, error };
    }
    if (result?.ok === false) {
      destinationSaveRef.current = false;
      setIsSavingDestination(false);
      setDestinationError("儲存失敗，請再試一次");
      return false;
    }
    destinationSaveRef.current = false;
    setIsSavingDestination(false);
    closeDestinationPopover();
    return true;
  }

  function handleDestinationKeyDown(event, field) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    if (field === "country") {
      cityInputRef.current?.focus();
      return;
    }
    saveDestinationDrafts();
  }

  function closeDatePopover({ restoreFocus = true } = {}) {
    setIsDatePopoverOpen(false);
    setDateError("");
    setHoveredDate("");
    setIsDateRemovalConfirmed(false);
    setIsSavingDates(false);
    dateSaveRef.current = false;
    if (restoreFocus) {
      requestAnimationFrame(() => {
        dateButtonRef.current?.focus();
      });
    }
  }

  async function toggleDatePopover() {
    if (isDatePopoverOpen) {
      closeDatePopover();
      return;
    }
    await openDatePopover();
  }

  async function openDatePopover() {
    if (!canOpenDatePopover || isSavingDates) return;
    setIsMoreOpen(false);
    closeDestinationPopover({ restoreFocus: false });
    closeDeveloperTools();
    if (isEditingTitle) {
      const canContinue = await saveTitleDraft();
      if (!canContinue) return;
    }
    const nextOriginalStartDate = trip?.start_date || "";
    const nextOriginalEndDate = trip?.end_date || "";
    setOriginalStartDate(nextOriginalStartDate);
    setOriginalEndDate(nextOriginalEndDate);
    setStartDateDraft(nextOriginalStartDate);
    setEndDateDraft(nextOriginalEndDate);
    setStartDateInput(formatHeaderDate(nextOriginalStartDate) || "");
    setEndDateInput(formatHeaderDate(nextOriginalEndDate) || "");
    setDateSelectionStep(initialDateSelectionStep(nextOriginalStartDate, nextOriginalEndDate));
    setHoveredDate("");
    setIsDateRemovalConfirmed(false);
    setVisibleMonth(startOfMonth(parseDateOnly(nextOriginalStartDate) || parseDateOnly(todayInput()) || new Date()));
    setDateError(canUpdateTripDateRange ? "" : "旅程已進入結算階段，無法修改日期。");
    setIsDatePopoverOpen(true);
  }

  function validateDateDrafts() {
    if (!startDateDraft || !endDateDraft) return "請選擇開始日期與結束日期";
    const start = parseDateOnly(startDateDraft);
    const end = parseDateOnly(endDateDraft);
    if (!start || !end) {
      return "請選擇開始日期與結束日期";
    }
    if (isDateBefore(startDateDraft, todayDateKey) || isDateBefore(endDateDraft, todayDateKey)) {
      return "不可選擇早於今日的日期";
    }
    if (isDateBefore(endDateDraft, startDateDraft)) return "結束日期不能早於開始日期";
    return "";
  }

  async function saveDateDrafts() {
    if (!canOpenDatePopover || dateSaveRef.current) return false;
    if (!canUpdateTripDateRange) {
      setDateError("旅程已進入結算階段，無法修改日期。");
      return false;
    }
    const validationError = validateDateDrafts();
    if (validationError) {
      setDateError(validationError);
      return false;
    }
    const currentStartDate = trip?.start_date || "";
    const currentEndDate = trip?.end_date || "";
    if (startDateDraft === currentStartDate && endDateDraft === currentEndDate) {
      closeDatePopover();
      return true;
    }
    if (dateChangePreview.hasTimelineRemoval && !isDateRemovalConfirmed) {
      setDateError("請先確認縮短旅程會刪除尾端 Timeline 資料。");
      return false;
    }
    setDateError("");
    dateSaveRef.current = true;
    setIsSavingDates(true);
    let result;
    try {
      result = await onUpdateTripDateRange({
        confirmTimelineRemoval: dateChangePreview.hasTimelineRemoval && isDateRemovalConfirmed,
        startDate: startDateDraft,
        endDate: endDateDraft,
      });
    } catch (error) {
      result = { ok: false, error };
    }
    if (result?.ok === false) {
      dateSaveRef.current = false;
      setIsSavingDates(false);
      setDateError(result.message || "儲存失敗，請再試一次");
      return false;
    }
    dateSaveRef.current = false;
    setIsSavingDates(false);
    closeDatePopover();
    return true;
  }

  function selectDateFromCalendar(dateKey) {
    if (isSavingDates || !canUpdateTripDateRange) {
      if (!canUpdateTripDateRange) setDateError("旅程已進入結算階段，無法修改日期。");
      return;
    }
    if (isDateBefore(dateKey, todayDateKey)) {
      setDateError("不可選擇早於今日的日期");
      return;
    }
    setDateError("");
    setHoveredDate("");
    setIsDateRemovalConfirmed(false);
    if (dateSelectionStep === "start" || !startDateDraft) {
      setStartDateDraft(dateKey);
      setStartDateInput(formatHeaderDate(dateKey));
      setEndDateDraft("");
      setEndDateInput("");
      setDateSelectionStep("end");
      return;
    }
    if (isDateBefore(dateKey, startDateDraft)) {
      setStartDateDraft(dateKey);
      setStartDateInput(formatHeaderDate(dateKey));
      setEndDateDraft("");
      setEndDateInput("");
      setDateSelectionStep("end");
      return;
    }
    setEndDateDraft(dateKey);
    setEndDateInput(formatHeaderDate(dateKey));
    setDateSelectionStep("start");
  }

  function clearDateDrafts() {
    if (!canUpdateTripDateRange) {
      setDateError("旅程已進入結算階段，無法修改日期。");
      return;
    }
    setStartDateDraft("");
    setEndDateDraft("");
    setStartDateInput("");
    setEndDateInput("");
    setDateSelectionStep("start");
    setHoveredDate("");
    setIsDateRemovalConfirmed(false);
    setDateError("");
    requestAnimationFrame(() => {
      startDateTextInputRef.current?.focus();
    });
  }

  function restoreOriginalDateDrafts() {
    setStartDateDraft(originalStartDate);
    setEndDateDraft(originalEndDate);
    setStartDateInput(formatHeaderDate(originalStartDate) || "");
    setEndDateInput(formatHeaderDate(originalEndDate) || "");
    setDateSelectionStep(initialDateSelectionStep(originalStartDate, originalEndDate));
    setHoveredDate("");
    setIsDateRemovalConfirmed(false);
    setDateError("");
    setVisibleMonth(startOfMonth(parseDateOnly(originalStartDate) || parseDateOnly(todayInput()) || new Date()));
    requestAnimationFrame(() => {
      startDateTextInputRef.current?.focus();
    });
  }

  function commitDateTextInput(field) {
    if (!canUpdateTripDateRange) {
      setDateError("旅程已進入結算階段，無法修改日期。");
      return false;
    }
    const rawValue = field === "start" ? startDateInput : endDateInput;
    if (!String(rawValue || "").trim()) {
      if (field === "start") {
        setStartDateDraft("");
        setEndDateDraft("");
        setEndDateInput("");
        setDateSelectionStep("start");
      } else {
        setEndDateDraft("");
        setDateSelectionStep(initialDateSelectionStep(startDateDraft, ""));
      }
      setIsDateRemovalConfirmed(false);
      setDateError("");
      return true;
    }
    const normalized = parseDateTextInput(rawValue);
    if (!normalized) {
      setDateError("請輸入有效日期");
      return false;
    }
    if (isDateBefore(normalized, todayDateKey)) {
      setDateError("不可選擇早於今日的日期");
      return false;
    }
    const currentDraft = field === "start" ? startDateDraft : endDateDraft;
    if (normalized === currentDraft) {
      if (field === "start") {
        setStartDateInput(formatHeaderDate(normalized));
      } else {
        setEndDateInput(formatHeaderDate(normalized));
      }
      setDateError("");
      return true;
    }
    setDateError("");
    setHoveredDate("");
    setIsDateRemovalConfirmed(false);
    setVisibleMonth(startOfMonth(parseDateOnly(normalized)));
    if (field === "start") {
      setStartDateDraft(normalized);
      setStartDateInput(formatHeaderDate(normalized));
      if (endDateDraft && isDateBefore(endDateDraft, normalized)) {
        setEndDateDraft("");
        setEndDateInput("");
      }
      setDateSelectionStep("end");
      return true;
    }
    if (startDateDraft && isDateBefore(normalized, startDateDraft)) {
      setStartDateDraft(normalized);
      setStartDateInput(formatHeaderDate(normalized));
      setEndDateDraft("");
      setEndDateInput("");
      setDateSelectionStep("end");
      return true;
    }
    setEndDateDraft(normalized);
    setEndDateInput(formatHeaderDate(normalized));
    setDateSelectionStep("start");
    return true;
  }

  function handleDateInputKeyDown(event, field) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    commitDateTextInput(field);
  }

  function handleDatePopoverKeyDown(event) {
    if ((event.key === "Enter" || event.key === " ") && event.target === dateDialogRef.current) {
      event.preventDefault();
      if (isDateRangeEmpty) {
        restoreOriginalDateDrafts();
      } else {
        saveDateDrafts();
      }
    }
  }

  async function openMembers() {
    if (typeof onOpenMembers !== "function") return;
    closeDestinationPopover({ restoreFocus: false });
    closeDeveloperTools();
    if (isEditingTitle) {
      const canContinue = await saveTitleDraft();
      if (!canContinue) return;
    }
    onOpenMembers();
  }

  function startTitleEdit() {
    if (!canEditTitle || isSavingTitle) return;
    closeDestinationPopover({ restoreFocus: false });
    closeDatePopover({ restoreFocus: false });
    closeDeveloperTools();
    setTitleDraft(trip?.title || "");
    setTitleError("");
    setIsEditingTitle(true);
  }

  function cancelTitleEdit() {
    setTitleDraft(trip?.title || "");
    setTitleError("");
    setIsEditingTitle(false);
    setIsSavingTitle(false);
    titleSaveRef.current = false;
  }

  async function saveTitleDraft() {
    if (!canEditTitle || titleSaveRef.current) return false;
    const nextTitle = titleDraft.trim();
    const currentTitle = String(trip?.title || "").trim();
    if (!nextTitle) {
      setTitleError("旅程名稱不能為空白");
      return false;
    }
    if (nextTitle === currentTitle) {
      setTitleError("");
      setIsEditingTitle(false);
      return true;
    }
    setTitleError("");
    titleSaveRef.current = true;
    setIsSavingTitle(true);
    let result;
    try {
      result = await onUpdateTrip({ title: nextTitle });
    } catch (error) {
      result = { ok: false, error };
    }
    if (result?.ok === false) {
      titleSaveRef.current = false;
      setIsSavingTitle(false);
      setTitleError("儲存失敗，請再試一次");
      return false;
    }
    titleSaveRef.current = false;
    setIsSavingTitle(false);
    setIsEditingTitle(false);
    setTitleDraft("");
    return true;
  }

  function handleTitleKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      saveTitleDraft();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelTitleEdit();
    }
  }

  function handleTitleBlur() {
    saveTitleDraft();
  }

  return (
    <header className="trip-header">
      <div className="trip-header-main">
        <div className="trip-header-title-row">
          <div className="trip-header-title-wrap">
            {isEditingTitle ? (
              <>
                <input
                  ref={titleInputRef}
                  className="trip-header-title-input"
                  type="text"
                  aria-label="旅程名稱"
                  aria-describedby={titleError ? "trip-header-title-error" : undefined}
                  disabled={isSavingTitle}
                  value={titleDraft}
                  onBlur={handleTitleBlur}
                  onChange={(event) => {
                    setTitleDraft(event.target.value);
                    if (titleError) setTitleError("");
                  }}
                  onKeyDown={handleTitleKeyDown}
                />
                {titleError ? (
                  <span className="trip-header-title-error" id="trip-header-title-error">
                    {titleError}
                  </span>
                ) : null}
              </>
            ) : canEditTitle ? (
              <button
                className="trip-header-title-button"
                type="button"
                title="點擊修改旅程名稱"
                onClick={startTitleEdit}
              >
                <span>{trip?.title || "選擇或建立旅程"}</span>
              </button>
            ) : (
              <h2 className="trip-header-title" title={trip?.title || "選擇或建立旅程"}>
                {trip?.title || "選擇或建立旅程"}
              </h2>
            )}
          </div>
        </div>
        {metaItems.length ? (
          <div className="trip-header-meta" aria-label="旅程摘要">
            {metaItems.map((item, index) => (
              <Fragment key={item.key}>
                {index > 0 ? (
                  <span className="trip-header-meta-separator" aria-hidden="true">
                    ·
                  </span>
                ) : null}
                {item.action ? (
                  item.key === "destination" ? (
                    <span className="trip-header-meta-popover-anchor" ref={destinationPopoverRef}>
                      <button
                        ref={destinationButtonRef}
                        className="trip-header-meta-action"
                        type="button"
                        title={item.title}
                        aria-haspopup="dialog"
                        aria-expanded={isDestinationPopoverOpen}
                        onClick={item.onClick}
                      >
                        {item.label}
                      </button>
                      {isDestinationPopoverOpen ? (
                        <div
                          className="trip-header-destination-popover"
                          role="dialog"
                          aria-label="編輯旅程目的地"
                        >
                          <div className="trip-header-destination-fields">
                            <label className="trip-header-destination-field" htmlFor="trip-destination-country">
                              <span>國家</span>
                              <input
                                id="trip-destination-country"
                                ref={countryInputRef}
                                type="text"
                                aria-label="國家"
                                aria-describedby={destinationError ? "trip-header-destination-error" : undefined}
                                disabled={isSavingDestination}
                                value={countryDraft}
                                onChange={(event) => {
                                  setCountryDraft(event.target.value);
                                  if (destinationError) setDestinationError("");
                                }}
                                onKeyDown={(event) => handleDestinationKeyDown(event, "country")}
                              />
                            </label>
                            <label className="trip-header-destination-field" htmlFor="trip-destination-city">
                              <span>城市</span>
                              <input
                                id="trip-destination-city"
                                ref={cityInputRef}
                                type="text"
                                aria-label="城市"
                                aria-describedby={destinationError ? "trip-header-destination-error" : undefined}
                                disabled={isSavingDestination}
                                value={cityDraft}
                                onChange={(event) => {
                                  setCityDraft(event.target.value);
                                  if (destinationError) setDestinationError("");
                                }}
                                onKeyDown={(event) => handleDestinationKeyDown(event, "city")}
                              />
                            </label>
                          </div>
                          <p className="trip-header-destination-hint">
                            使用 Map 編輯第一天行程時，系統將自動填入目的地。
                          </p>
                          {destinationError ? (
                            <div
                              className="trip-header-destination-error"
                              id="trip-header-destination-error"
                              role="alert"
                            >
                              {destinationError}
                            </div>
                          ) : null}
                          <div className="trip-header-destination-actions">
                            <button
                              type="button"
                              className="ghost-button compact"
                              disabled={isSavingDestination}
                              onClick={() => closeDestinationPopover()}
                            >
                              取消
                            </button>
                            <button
                              type="button"
                              className="primary-button compact"
                              disabled={isSavingDestination}
                              onClick={saveDestinationDrafts}
                            >
                              {isSavingDestination ? "儲存中..." : "儲存"}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </span>
                  ) : item.key === "dates" ? (
                    <span className="trip-header-meta-popover-anchor" ref={datePopoverRef}>
                      <button
                        ref={dateButtonRef}
                        className="trip-header-meta-action"
                        type="button"
                        title={item.title}
                        aria-haspopup="dialog"
                        aria-expanded={isDatePopoverOpen}
                        onClick={item.onClick}
                      >
                        {item.label}
                      </button>
                      {isDatePopoverOpen ? (
                        <div
                          ref={dateDialogRef}
                          className="trip-header-date-popover"
                          role="dialog"
                          aria-label="編輯旅程日期"
                          tabIndex={-1}
                          onKeyDown={handleDatePopoverKeyDown}
                        >
                          <TripDateRangeSelector
                            activeStep={dateSelectionStep}
                            disabled={isSavingDates || !canUpdateTripDateRange}
                            endDate={endDateDraft}
                            endInput={endDateInput}
                            errorId={dateError ? "trip-header-date-error" : undefined}
                            minDateKey={todayDateKey}
                            onCommitInput={commitDateTextInput}
                            onEndInputChange={(value) => {
                              setEndDateInput(value);
                              if (dateError) setDateError("");
                            }}
                            onHoverDate={setHoveredDate}
                            onInputKeyDown={handleDateInputKeyDown}
                            onSelectDate={selectDateFromCalendar}
                            onStartInputChange={(value) => {
                              setStartDateInput(value);
                              if (dateError) setDateError("");
                            }}
                            onVisibleMonthChange={setVisibleMonth}
                            previewEndDate={previewEndDate}
                            startDate={startDateDraft}
                            startInput={startDateInput}
                            startInputRef={startDateTextInputRef}
                            visibleMonth={visibleMonth}
                          />
                          {canUpdateTripDateRange ? (
                            <TripDateChangePreview
                              isRemovalConfirmed={isDateRemovalConfirmed}
                              onConfirmRemoval={() => {
                                setIsDateRemovalConfirmed(true);
                                setDateError("");
                              }}
                              preview={dateChangePreview}
                            />
                          ) : null}
                          {dateError ? (
                            <div
                              className="trip-header-date-error"
                              id="trip-header-date-error"
                              role="alert"
                            >
                              {dateError}
                            </div>
                          ) : null}
                          <div className="trip-date-range-footer">
                            <div className="trip-header-date-summary" aria-live="polite">
                              旅程天數：
                              {dateDraftDayCount
                                ? `${dateDraftDayCount} 天`
                                : previewDayCount
                                  ? `${previewDayCount} 天（預覽）`
                                  : "—"}
                            </div>
                            <div className="trip-header-date-actions">
                              <button
                                type="button"
                                className="ghost-button compact"
                                disabled={isSavingDates || !canUpdateTripDateRange || isDateRangeEmpty}
                                onClick={clearDateDrafts}
                              >
                                清除
                              </button>
                              <button
                                type="button"
                                className="primary-button compact"
                                disabled={
                                  isSavingDates ||
                                  !canUpdateTripDateRange ||
                                  (!isDateRangeEmpty && (!startDateDraft || !endDateDraft || isDateBefore(endDateDraft, startDateDraft)))
                                }
                                onClick={isDateRangeEmpty ? restoreOriginalDateDrafts : saveDateDrafts}
                              >
                                {isSavingDates ? "儲存中..." : isDateRangeEmpty ? "取消" : "儲存"}
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </span>
                  ) : (
                    <button
                      className="trip-header-meta-action"
                      type="button"
                      title={item.title}
                      onClick={item.onClick}
                    >
                      {item.label}
                    </button>
                  )
                ) : (
                  <span
                    className={item.className ? `trip-header-meta-item ${item.className}` : "trip-header-meta-item"}
                    title={item.title}
                  >
                    {item.label}
                  </span>
                )}
              </Fragment>
            ))}
          </div>
        ) : null}
      </div>

      <div className="trip-header-actions">
        <HeaderMemberPreview
          disabled={!hasTrip || !canOpenMembers}
          members={members}
          pendingCount={pendingMemberCount}
          onOpen={onInvite}
        />
        <button
          className="trip-header-icon-button"
          type="button"
          title="唯讀分享"
          aria-label="唯讀分享"
          disabled={!hasTrip || !canShare}
          onClick={onShare}
        >
          <TripHeaderIcon name="share" />
        </button>
        <div className="trip-header-more" ref={menuRef}>
          <button
            className="trip-header-icon-button"
            type="button"
            title="更多操作"
            aria-label="更多操作"
            aria-haspopup="menu"
            aria-expanded={isMoreOpen}
            disabled={!hasTrip}
            onClick={() => {
              closeDestinationPopover({ restoreFocus: false });
              setIsMoreOpen((value) => !value);
            }}
          >
            <TripHeaderIcon name="more" />
          </button>
          {isMoreOpen ? (
            <div className="trip-header-more-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => chooseMenuAction(onExport)}>
                匯出 JSON
              </button>
              {canOpenDeveloperTools ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => chooseMenuAction(toggleDeveloperTools)}
                >
                  開發者工具
                </button>
              ) : null}
              <button
                className="danger"
                type="button"
                role="menuitem"
                disabled={!canEditTrip}
                onClick={() => chooseMenuAction(onDelete)}
              >
                刪除旅程
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {isDeveloperToolsOpen && hasTrip && canOpenDeveloperTools ? (
        <div className="trip-header-developer-tools">
          <div>
            <h3 className="trip-header-developer-tools-heading">開發者工具</h3>
            <p className="trip-header-developer-tools-hint">
              開發者日期工具可覆寫結算階段日期鎖，僅供測試使用。
            </p>
          </div>
          <div className="trip-header-developer-tools-fields">
            <label>
              開始日期
              <input
                ref={developerStartDateRef}
                disabled={isApplyingDeveloperDates}
                type="date"
                value={developerStartDateDraft}
                onChange={(event) => {
                  setDeveloperStartDateDraft(event.target.value);
                  if (developerToolsError) setDeveloperToolsError("");
                }}
              />
            </label>
            <label>
              結束日期
              <input
                disabled={isApplyingDeveloperDates}
                type="date"
                value={developerEndDateDraft}
                onChange={(event) => {
                  setDeveloperEndDateDraft(event.target.value);
                  if (developerToolsError) setDeveloperToolsError("");
                }}
              />
            </label>
          </div>
          {developerToolsError ? (
            <div className="trip-header-developer-tools-error" role="alert">
              {developerToolsError}
            </div>
          ) : null}
          <div className="trip-header-developer-tools-actions">
            <button
              type="button"
              className="ghost-button compact"
              disabled={isApplyingDeveloperDates}
              onClick={closeDeveloperTools}
            >
              取消
            </button>
            <button
              type="button"
              className="primary-button compact"
              disabled={isApplyingDeveloperDates}
              onClick={applyDeveloperDates}
            >
              {isApplyingDeveloperDates ? "套用中..." : "套用測試日期"}
            </button>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function DemoApp({ initialSection }) {
  const [activeSection, setActiveSection] = useState(initialSection || "timeline");
  const [activeDay, setActiveDay] = useState(0);
  const [isDemoMembersDialogOpen, setIsDemoMembersDialogOpen] = useState(false);
  const [demoActiveTrip, setDemoActiveTrip] = useState(() => demoTrips[0]);
  const [isDemoSidebarCollapsed, setIsDemoSidebarCollapsed] = useState(false);
  const [isDemoAccountMenuOpen, setIsDemoAccountMenuOpen] = useState(false);
  const [timelineItems, setTimelineItems] = useState(() => createDemoTimelineItems());
  const [timelineAlternatives, setTimelineAlternatives] = useState([]);
  const [budgetItems, setBudgetItems] = useState(() => createDemoBudgetItems());
  const [budgetParticipants, setBudgetParticipants] = useState(() => createDemoBudgetParticipants());
  const [actualExpenses, setActualExpenses] = useState(() => createDemoActualExpenses());
  const [actualParticipants, setActualParticipants] = useState(() => createDemoActualParticipants());
  const [itineraryBudgetLinks, setItineraryBudgetLinks] = useState(() => demoItineraryBudgetLinks);
  const [luggageItems, setLuggageItems] = useState(() => createDemoLuggageItems());
  const [sharedLuggageItems, setSharedLuggageItems] = useState(() => createDemoSharedLuggageItems());
  const [focusedItemId, setFocusedItemId] = useState(null);
  const [isRouteCollapsed, setIsRouteCollapsed] = useState(false);
  const days = useMemo(() => tripDays(demoActiveTrip), [demoActiveTrip]);
  useEffect(() => {
    setIsDemoAccountMenuOpen(false);
  }, [activeSection, demoActiveTrip.id, isDemoSidebarCollapsed]);
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
  const alternativesByItem = useMemo(() => {
    const next = {};
    timelineAlternatives.forEach((alternative) => {
      next[alternative.itinerary_item_id] = [...(next[alternative.itinerary_item_id] || []), alternative];
    });
    return next;
  }, [timelineAlternatives]);
  const tripDateChangePreviewData = useMemo(
    () => ({
      accommodations: [],
      alternatives: timelineAlternatives,
      itineraryBudgetLinks,
      items: timelineItems,
      todoItems: [],
    }),
    [itineraryBudgetLinks, timelineAlternatives, timelineItems],
  );

  function changeSection(section) {
    setActiveSection(section);
    window.history.pushState({}, "", `/demo/${section}`);
  }

  function selectTimelineDay(dayIndex) {
    setActiveDay(dayIndex);
    if (isRouteCollapsed) dayBoardNavigation.scrollToDay(dayIndex);
  }

  function updateDemoTripDateRange({ confirmTimelineRemoval = false, startDate, endDate }) {
    if (!startDate || !endDate || endDate < startDate) return { ok: false };
    const preview = buildTripDateChangePreview({
      ...tripDateChangePreviewData,
      newEndDate: endDate,
      newStartDate: startDate,
      trip: demoActiveTrip,
    });
    if (preview.hasTimelineRemoval && !confirmTimelineRemoval) return { ok: false, unsafeShortening: true };
    const removedIds = confirmTimelineRemoval
      ? timelineItemIdsRemovedByShortening(timelineItems, preview.newDayCount)
      : new Set();
    setDemoActiveTrip((current) => ({ ...current, start_date: startDate, end_date: endDate }));
    setTimelineItems((current) =>
      syncTimelineItemDatesForTripStart(
        current.filter((item) => !removedIds.has(item.id)),
        startDate,
      ),
    );
    if (removedIds.size) {
      setTimelineAlternatives((current) =>
        current.filter((alternative) => !removedIds.has(alternative.itinerary_item_id)),
      );
      setItineraryBudgetLinks((current) =>
        current.filter((link) => !removedIds.has(link.itinerary_item_id)),
      );
    }
    setActiveDay((current) => Math.min(current, Math.max((preview.newDayCount || 1) - 1, 0)));
    return { ok: true };
  }

  function saveTimelineItem(payload, editingId, meta = {}) {
    const nextPayload = normalizeItemPayload(payload);
    if (!nextPayload.title.trim()) return;
    const editingItem = editingId ? timelineItems.find((item) => item.id === editingId) : null;
    if (editingItem?.is_fixed && !isTransportationCard(editingItem)) {
      return { ok: false, fixed: true };
    }
    const invalidTimeRange = nextPayload.item_type !== "transport" && isInvalidTimeRange(nextPayload.start_time, nextPayload.end_time);
    if (invalidTimeRange) return { ok: false };
    const overlapItem = findOverlappingVisitItem({
      dayIndex: activeDay,
      editingId,
      items: timelineItems,
      payload: nextPayload,
    });
    if (overlapItem) return { ok: false, overlapError: formatTimelineOverlapError(overlapItem) };
    if (editingId) {
      setTimelineItems((current) =>
        current.map((item) =>
          item.id === editingId
            ? {
                ...item,
                ...nextPayload,
                updated_at: new Date().toISOString(),
              }
            : item,
        ),
      );
      return { ok: true };
    }
    setTimelineItems((current) => {
      const currentDayVisits = sortedVisitItems(current.filter((item) => item.day_index === activeDay));
      const sortOrder = (currentDayVisits.length + 1) * 10;
      return [
        ...current,
        {
          ...emptyItemForm,
          ...nextPayload,
          id: demoId(nextPayload.item_type === "transport" ? "demo-transport" : "demo-itinerary"),
          day_index: activeDay,
          sort_order: sortOrder,
          updated_at: new Date().toISOString(),
        },
      ];
    });
    return { ok: true };
  }

  function confirmTimelineTransportWarning(itemId) {
    setTimelineItems((current) =>
      current.map((item) => {
        if (item.id !== itemId) return item;
        return {
          ...item,
          ...buildTransportPairSnapshot(
            current.find((currentItem) => currentItem.id === item.from_item_id),
            current.find((currentItem) => currentItem.id === item.to_item_id),
          ),
          updated_at: new Date().toISOString(),
        };
      }),
    );
  }

  function saveTimelineAlternative(itemId, payload, editingId) {
    const item = timelineItems.find((currentItem) => currentItem.id === itemId);
    if (item?.is_fixed) return { ok: false, error: { message: "此行程已固定，請先解鎖後再修改。" } };
    const nextPayload = {
      title: payload.title.trim(),
      type: payload.type || "attraction",
      start_time: payload.start_time || null,
      end_time: payload.end_time || null,
      cost: Number(payload.cost || 0),
      location_name: payload.location_name.trim() || null,
      address: payload.address.trim() || null,
      map_url: payload.map_url.trim() || null,
      description: payload.description.trim() || null,
      transportation_note: payload.transportation_note.trim() || null,
      updated_at: new Date().toISOString(),
    };
    if (!nextPayload.title) return { ok: false };
    if (editingId) {
      setTimelineAlternatives((current) =>
        current.map((alternative) => (alternative.id === editingId ? { ...alternative, ...nextPayload } : alternative)),
      );
      return { ok: true };
    }
    setTimelineAlternatives((current) => [
      ...current.filter((alternative) => alternative.itinerary_item_id !== itemId),
      { ...nextPayload, id: demoId("demo-alternative"), itinerary_item_id: itemId },
    ]);
    return { ok: true };
  }

  function deleteTimelineAlternative(alternativeId) {
    const alternative = timelineAlternatives.find((item) => item.id === alternativeId);
    const parentItem = alternative ? timelineItems.find((item) => item.id === alternative.itinerary_item_id) : null;
    if (parentItem?.is_fixed) return { ok: false, error: { message: "此行程已固定，請先解鎖後再修改。" } };
    setTimelineAlternatives((current) => current.filter((alternative) => alternative.id !== alternativeId));
    return { ok: true };
  }

  function deleteTimelineItem(itemId) {
    const deletedIds = new Set([itemId]);
    const deletedItem = timelineItems.find((item) => item.id === itemId);
    if (deletedItem?.is_fixed && !isTransportationCard(deletedItem)) return;
    if (deletedItem && !isTransportationCard(deletedItem)) {
      timelineItems.forEach((item) => {
        if (isTransportationCard(item) && (item.from_item_id === itemId || item.to_item_id === itemId)) {
          deletedIds.add(item.id);
        }
      });
    }
    setTimelineItems((current) => current.filter((item) => !deletedIds.has(item.id)));
    setItineraryBudgetLinks((current) => current.filter((link) => !deletedIds.has(link.itinerary_item_id)));
  }

  function toggleTimelineItemFixed(item) {
    if (!item || isTransportationCard(item)) return { ok: false };
    setTimelineItems((current) =>
      current.map((currentItem) =>
        currentItem.id === item.id
          ? {
              ...currentItem,
              is_fixed: !currentItem.is_fixed,
              fixed_at: currentItem.is_fixed ? null : new Date().toISOString(),
              fixed_by: currentItem.is_fixed ? null : "demo-peter",
              updated_at: new Date().toISOString(),
            }
          : currentItem,
      ),
    );
    return { ok: true };
  }

  function applyTimelineAlternative(item, alternative) {
    if (item?.is_fixed) return { ok: false };
    const oldMainPayload = {
      title: item.title,
      type: item.type || "attraction",
      start_time: item.start_time || null,
      end_time: item.end_time || null,
      cost: Number(item.cost || 0),
      location_name: item.location_name || item.location || null,
      address: item.address || null,
      map_url: item.map_url || null,
      description: item.description || item.note || null,
      transportation_note: item.transportation_note || null,
      updated_at: new Date().toISOString(),
    };
    const nextPayload = normalizeItemPayload({
      ...item,
      title: alternative.title,
      type: alternative.type || item.type,
      start_time: item.start_time || "",
      end_time: item.end_time || "",
      location: alternative.location_name || "",
      location_name: alternative.location_name || "",
      address: alternative.address || "",
      map_url: alternative.map_url || "",
      note: alternative.description || "",
      description: alternative.description || "",
      transportation_note: alternative.transportation_note || "",
      cost: alternative.cost || 0,
    });
    if (nextPayload.item_type !== "transport" && isInvalidTimeRange(nextPayload.start_time, nextPayload.end_time)) return { ok: false };
    setTimelineItems((current) =>
      current.map((currentItem) => (currentItem.id === item.id ? { ...currentItem, ...nextPayload, updated_at: new Date().toISOString() } : currentItem)),
    );
    setTimelineAlternatives((current) =>
      current.map((currentAlternative) => (currentAlternative.id === alternative.id ? { ...currentAlternative, ...oldMainPayload } : currentAlternative)),
    );
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
    <Shell appLayout collapsed={isDemoSidebarCollapsed}>
      <aside className={`sidebar demo-sidebar${isDemoSidebarCollapsed ? " collapsed" : ""}`}>
        <div className="brand">
          <button
            className="brand-mark"
            type="button"
            title={isDemoSidebarCollapsed ? "展開 Demo 側欄" : "回到 Demo 行程"}
            aria-label={isDemoSidebarCollapsed ? "展開 Demo 側欄" : "回到 Demo 行程"}
            onClick={() => {
              if (isDemoSidebarCollapsed) {
                setIsDemoSidebarCollapsed(false);
                return;
              }
              changeSection("timeline");
            }}
          >
            TP
          </button>
          <div className="brand-copy">
            <h1>旅遊規劃</h1>
            <p>展示模式</p>
          </div>
          <button
            className="mini-button sidebar-toggle"
            type="button"
            title={isDemoSidebarCollapsed ? "展開側欄" : "收合側欄"}
            aria-label={isDemoSidebarCollapsed ? "展開側欄" : "收合側欄"}
            aria-expanded={!isDemoSidebarCollapsed}
            onClick={() => setIsDemoSidebarCollapsed((value) => !value)}
          >
            {isDemoSidebarCollapsed ? ">" : "<"}
          </button>
        </div>
        <nav className="section-nav" aria-label="Demo 導覽">
          {["timeline", "budget", "luggage"].map((section) => {
            const navItem = desktopNavItems.find((item) => item.id === section);
            const Icon = navItem?.Icon;
            return (
              <button
                className={`section-nav-button${activeSection === section ? " active" : ""}`}
                key={section}
                type="button"
                title={demoSectionLabel(section)}
                aria-label={demoSectionLabel(section)}
                aria-current={activeSection === section ? "page" : undefined}
                onClick={() => changeSection(section)}
              >
                <span className="section-nav-icon" aria-hidden="true">
                  {Icon ? <Icon size={15} strokeWidth={2.2} /> : navItem?.shortLabel}
                </span>
                <span className="nav-label">{demoSectionLabel(section)}</span>
              </button>
            );
          })}
        </nav>
        <section className="sidebar-trip-section" aria-labelledby="demo-sidebar-trips-title">
          <div className="sidebar-trip-heading">
            <h2 id="demo-sidebar-trips-title">我的旅程</h2>
            <button
              className="mini-button sidebar-create-trip"
              type="button"
              title="Demo 模式不支援新增旅程"
              aria-label="Demo 模式不支援新增旅程"
              disabled
            >
              +
            </button>
          </div>
          <div className="sidebar-trip-list-region">
            <TripList
              trips={demoTrips.map((trip) => ({
                ...trip,
                membership: { role: "owner", status: "approved" },
              }))}
              activeTripId={demoActiveTrip.id}
              compact={isDemoSidebarCollapsed}
              onCreate={() => {}}
              onSelect={(tripId) => {
                const nextTrip = demoTrips.find((trip) => trip.id === tripId);
                if (nextTrip) setDemoActiveTrip(nextTrip);
              }}
            />
          </div>
        </section>
        <SidebarAccountMenu
          collapsed={isDemoSidebarCollapsed}
          email="demo@example.com"
          initial="D"
          isOpen={isDemoAccountMenuOpen}
          name="Demo User"
          onClose={() => setIsDemoAccountMenuOpen(false)}
          onSettings={() => {}}
          onSignOut={() => {}}
          onToggle={() => setIsDemoAccountMenuOpen((value) => !value)}
          settingsDisabled
          signOutDisabled
        />
      </aside>
      <main className="workspace demo-workspace">
        <TripHeader
          activeSection={activeSection}
          trip={demoActiveTrip}
          members={demoMembers}
          days={days}
          dateChangePreviewData={tripDateChangePreviewData}
          demoNotice="Demo Mode 資料不會永久保存。"
          canEditTrip
          canOpenMembers
          onDelete={() => {}}
          onExport={() => {}}
          onInvite={() => setIsDemoMembersDialogOpen(true)}
          onOpenMembers={() => setIsDemoMembersDialogOpen(true)}
          onShare={() => {}}
          onUpdateTrip={(patch) => {
            setDemoActiveTrip((current) => ({ ...current, ...patch }));
            return { ok: true };
          }}
          onUpdateTripDateRange={updateDemoTripDateRange}
        />
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
                  activeTrip={demoActiveTrip}
                  alternativesByItem={alternativesByItem}
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
                  onApplyAlternative={applyTimelineAlternative}
                  onConfirmTransportWarning={confirmTimelineTransportWarning}
                  onDeleteAlternative={deleteTimelineAlternative}
                  onDeleteItem={deleteTimelineItem}
                  onFocusItem={setFocusedItemId}
                  onReorderItem={() => {}}
                  onSaveAlternative={saveTimelineAlternative}
                  onSaveItem={saveTimelineItem}
                  onToggleItemFixed={toggleTimelineItemFixed}
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
            activeTrip={demoActiveTrip}
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
      {isDemoMembersDialogOpen ? (
        <MembersInviteDialog
          canManageMembers={false}
          currentRole="owner"
          currentUserId="demo-peter"
          isTripDateLocked={false}
          members={demoMembers}
          onApprove={() => {}}
          onClose={() => setIsDemoMembersDialogOpen(false)}
          onCreateInvite={() => ({ ok: false, message: "Demo 不會產生正式邀請連結。" })}
          onReject={() => {}}
          onRemoveMember={() => {}}
          onUpdateRole={() => {}}
        />
      ) : null}
    </Shell>
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

  function updatePersonalForm(nextForm) {
    setPersonalForm(nextForm);
  }

  function updateSharedForm(nextForm) {
    setSharedForm(nextForm);
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
          <form autoComplete="off" className="inline-form" onSubmit={submitPersonal}>
            <input
              autoComplete="off"
              placeholder="新增個人行李"
              value={personalForm.title}
              onChange={(event) => void updatePersonalForm({ ...personalForm, title: event.target.value })}
            />
            <input
              autoComplete="off"
              placeholder="分類"
              value={personalForm.category}
              onChange={(event) => void updatePersonalForm({ ...personalForm, category: event.target.value })}
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
          <form autoComplete="off" className="shared-luggage-form" onSubmit={submitShared}>
            <input
              autoComplete="off"
              placeholder="新增團隊公物"
              value={sharedForm.title}
              onChange={(event) => setSharedForm({ ...sharedForm, title: event.target.value })}
            />
            <input
              autoComplete="off"
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
          <form autoComplete="off" className="inline-form" onSubmit={submitPersonal}>
            <input
              autoComplete="off"
              placeholder="新增個人行李"
              value={personalForm.title}
              onChange={(event) => setPersonalForm({ ...personalForm, title: event.target.value })}
            />
            <input
              autoComplete="off"
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
          <form autoComplete="off" className="shared-luggage-form" onSubmit={submitShared}>
            <input
              autoComplete="off"
              placeholder="新增團隊公物"
              value={sharedForm.title}
              onChange={(event) => setSharedForm({ ...sharedForm, title: event.target.value })}
            />
            <input
              autoComplete="off"
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

function getTripInitials(title = "") {
  const compactTitle = title.trim();
  if (!compactTitle) return "旅";
  return Array.from(compactTitle).slice(0, 2).join("");
}

function TripList({ trips, activeTripId, compact = false, onCreate, onSelect }) {
  if (!trips.length) {
    return (
      <button className="trip-empty-card" type="button" onClick={onCreate}>
        + 建立第一個旅程
      </button>
    );
  }

  return (
    <div className="trip-list" aria-label="旅程列表">
      {trips.map((trip) => (
        <button
          className={`trip-card${trip.id === activeTripId ? " active" : ""}`}
          key={trip.id}
          type="button"
          title={trip.title}
          aria-label={`${trip.title}${trip.id === activeTripId ? "，目前旅程" : ""}`}
          onClick={() => onSelect(trip.id)}
        >
          <strong>{compact ? getTripInitials(trip.title) : trip.title}</strong>
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
    onConfirmTransportWarning,
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
    onToggleItemFixed,
    onUpdateSharedLuggageItem,
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

      {isTodayMode || isBudgetMode || isAccommodationMode || isTodoMode || isLuggageMode || isSettlementMode ? null : (
        <div className="timeline-top-row">
          <DayTabs activeDay={activeDay} days={days} onActiveDay={selectTimelineDay} />
          <button className="ghost-button compact" type="button" onClick={() => setIsRouteCollapsed((value) => !value)}>
            {isRouteCollapsed ? "顯示地圖" : "隱藏地圖"}
          </button>
        </div>
      )}

      <div className={isBudgetMode ? "" : "hidden-section"}>
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
          restoreDrafts={isBudgetMode}
        />
      </div>

      <div className={isAccommodationMode ? "" : "hidden-section"}>
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
          restoreDrafts={isAccommodationMode}
        />
      </div>

      <div className={isTodoMode ? "" : "hidden-section"}>
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
          restoreDrafts={isTodoMode}
        />
      </div>

      <div className={isLuggageMode ? "" : "hidden-section"}>
        <LuggagePanel
          activeTrip={activeTrip}
          activeTab={luggageTab}
          canEdit={canEdit}
          currentUserId={currentUserId}
          isOwner={isOwner}
          luggageItems={luggageItems}
          members={members}
          restoreDrafts={isLuggageMode}
          sharedLuggageItems={sharedLuggageItems}
          onDeletePersonal={onDeleteLuggageItem}
          onDeleteShared={onDeleteSharedLuggageItem}
          onSavePersonal={onSaveLuggageItem}
          onSaveShared={onSaveSharedLuggageItem}
          onTabChange={onLuggageTabChange}
          onTogglePersonal={onToggleLuggageItem}
          onUpdateShared={onUpdateSharedLuggageItem}
        />
      </div>

      <div className={isSettlementMode ? "" : "hidden-section"}>
        <SettlementPanel
          actualExpenses={actualExpenses}
          actualParticipants={actualParticipants}
          budgetItems={budgetItems}
          members={members}
        />
      </div>

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
                onConfirmTransportWarning={onConfirmTransportWarning}
                onDeleteAlternative={onDeleteAlternative}
                onDeleteItem={onDeleteItem}
                onFocusItem={setFocusedItemId}
                onReorderItem={onReorderItem}
                onSaveAlternative={onSaveAlternative}
                onSaveItem={onSaveItem}
                onToggleItemFixed={onToggleItemFixed}
                restoreDrafts={activeSection === "timeline"}
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
  onConfirmTransportWarning,
  onDeleteAlternative,
  onDeleteItem,
  onFocusItem,
  onReorderItem,
  onSaveAlternative,
  onSaveItem,
  onToggleItemFixed,
  restoreDrafts = true,
  useEditLocks = true,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formSeed, setFormSeed] = useState(emptyItemForm);
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(null);
  const [editorTripId, setEditorTripId] = useState(null);
  const [insertionPair, setInsertionPair] = useState(null);
  const [restoredDraftKey, setRestoredDraftKey] = useState(null);
  const [conflict, setConflict] = useState(false);
  const [timeError, setTimeError] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [alternativeFaceByItem, setAlternativeFaceByItem] = useState({});
  const [alternativeFormsByItem, setAlternativeFormsByItem] = useState({});
  const [editingAlternativeByItem, setEditingAlternativeByItem] = useState({});
  const [alternativeErrorByItem, setAlternativeErrorByItem] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [fixedNotice, setFixedNotice] = useState("");
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
  const activeEditorGuardId = `timeline:${activeTrip?.id || "no-trip"}`;
  const activeEditorGuard = useMemo(
    () => ({
      discard: () => closeEditor(true),
      isActive: isOpen,
      isDirty: hasUnsavedChanges,
      save: () => saveCurrentEditor(),
    }),
    [form, hasUnsavedChanges, isOpen, editingId, baseUpdatedAt, draftKey],
  );

  useActiveEditorGuard(activeEditorGuardId, activeEditorGuard);

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
    setInsertionPair(null);
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
    if (matchingItem?.is_fixed && !isTransportationCard(matchingItem)) return;
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
    setInsertionPair(null);
    setRestoredDraftKey(latest.key);
    setIsOpen(true);
  }, [activeTrip?.id, currentUserId, dayItems, isOpen, restoreDrafts]);

  async function openNewItem() {
    const canOpenEditor = await requestActiveEditorHandoff({
      excludeId: activeEditorGuardId,
      tripId: activeTrip?.id,
    });
    if (!canOpenEditor) return;
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
    setInsertionPair(null);
    setRestoredDraftKey(null);
    setIsOpen(true);
  }

  async function openNewTransport(previousItem, nextItem) {
    const canOpenEditor = await requestActiveEditorHandoff({
      excludeId: activeEditorGuardId,
      tripId: activeTrip?.id,
    });
    if (!canOpenEditor) return;
    if (isOpen) {
      const canContinue = hasUnsavedChanges ? await requestActiveEditorGuardResolution() : true;
      if (!canContinue) return;
      if (!hasUnsavedChanges) await closeEditor(true);
    }
    const nextForm = {
      ...emptyItemForm,
      item_type: "transport",
      type: "transport",
      start_time: "",
      transport_category: defaultTransportCategory,
      transport_name: "",
      transport_duration_minutes: "",
      transport_note: "",
      transportation_note: "",
      from_item_id: previousItem?.id || null,
      to_item_id: nextItem?.id || null,
      ...buildTransportPairSnapshot(previousItem, nextItem),
      title: "",
    };
    flushDraft();
    replaceForm(nextForm);
    setFormSeed(nextForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setTimeError("");
    setEditingId(null);
    setEditorTripId(activeTrip?.id || null);
    setInsertionPair(previousItem && nextItem ? { fromId: previousItem.id, toId: nextItem.id } : null);
    setRestoredDraftKey(null);
    setIsOpen(true);
    onFocusItem(nextItem?.id || previousItem?.id);
  }

  async function openEditItem(item) {
    if (item.is_fixed && !isTransportationCard(item)) {
      setFixedNotice("此行程已固定，請先解鎖後再修改。");
      return;
    }
    if (useEditLocks && isLockedByAnotherUser(item, currentUserId)) return;
    const canOpenEditor = await requestActiveEditorHandoff({
      excludeId: activeEditorGuardId,
      tripId: activeTrip?.id,
    });
    if (!canOpenEditor) return;
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
      item_type: item.item_type || "visit",
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
      transport_category: item.transport_category || defaultTransportCategory,
      transport_name: item.transport_name || item.title || "",
      transport_duration_minutes: item.transport_duration_minutes || "",
      transport_note: item.transport_note || item.transportation_note || item.description || item.note || "",
      from_item_id: item.from_item_id || null,
      to_item_id: item.to_item_id || null,
      from_snapshot_start_time: item.from_snapshot_start_time || null,
      from_snapshot_end_time: item.from_snapshot_end_time || null,
      from_snapshot_destination: item.from_snapshot_destination || null,
      to_snapshot_start_time: item.to_snapshot_start_time || null,
      to_snapshot_end_time: item.to_snapshot_end_time || null,
      to_snapshot_destination: item.to_snapshot_destination || null,
      is_fixed: Boolean(item.is_fixed),
      fixed_at: item.fixed_at || null,
      fixed_by: item.fixed_by || null,
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
    setInsertionPair(null);
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
    setInsertionPair(null);
    setRestoredDraftKey(null);
    setIsOpen(false);
  }

  async function saveCurrentEditor(formData = new FormData()) {
    const itemType = String(formData.get("item_type") ?? form.item_type ?? "visit");
    const editingItem = editingId ? dayItems.find((item) => item.id === editingId) : null;
    if (editingItem?.is_fixed && !isTransportationCard(editingItem)) {
      setTimeError("此行程已固定，請先解鎖後再修改。");
      return false;
    }
    const destination = String(formData.get("location_name") ?? form.location_name ?? form.location ?? "").trim();
    const submittedForm = {
      ...form,
      item_type: itemType,
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
      transport_category: String(formData.get("transport_category") ?? form.transport_category ?? defaultTransportCategory),
      transport_name: String(formData.get("transport_name") ?? form.transport_name ?? form.title ?? ""),
      transport_duration_minutes: String(formData.get("transport_duration_minutes") ?? form.transport_duration_minutes ?? ""),
      transport_note: String(formData.get("transport_note") ?? form.transport_note ?? form.transportation_note ?? ""),
      from_item_id: String(formData.get("from_item_id") ?? form.from_item_id ?? "") || null,
      to_item_id: String(formData.get("to_item_id") ?? form.to_item_id ?? "") || null,
      from_snapshot_start_time: String(formData.get("from_snapshot_start_time") ?? form.from_snapshot_start_time ?? "") || null,
      from_snapshot_end_time: String(formData.get("from_snapshot_end_time") ?? form.from_snapshot_end_time ?? "") || null,
      from_snapshot_destination: String(formData.get("from_snapshot_destination") ?? form.from_snapshot_destination ?? "") || null,
      to_snapshot_start_time: String(formData.get("to_snapshot_start_time") ?? form.to_snapshot_start_time ?? "") || null,
      to_snapshot_end_time: String(formData.get("to_snapshot_end_time") ?? form.to_snapshot_end_time ?? "") || null,
      to_snapshot_destination: String(formData.get("to_snapshot_destination") ?? form.to_snapshot_destination ?? "") || null,
      cost: String(formData.get("cost") ?? form.cost ?? 0),
    };
    if (submittedForm.item_type === "transport") {
      submittedForm.title = submittedForm.transport_name.trim();
      submittedForm.transportation_note = submittedForm.transport_note.trim();
      submittedForm.note = submittedForm.transport_note.trim();
      submittedForm.description = submittedForm.transport_note.trim();
    } else {
      submittedForm.address = "";
      submittedForm.transportation_note = "";
      submittedForm.cost = "0";
    }
    const currentPairSnapshot =
      submittedForm.item_type === "transport"
        ? buildTransportPairSnapshot(
            dayItems.find((item) => item.id === submittedForm.from_item_id),
            dayItems.find((item) => item.id === submittedForm.to_item_id),
          )
        : {};
    const invalidTimeRange =
      submittedForm.item_type !== "transport" && isInvalidTimeRange(submittedForm.start_time, submittedForm.end_time);
    if (invalidTimeRange) {
      setTimeError("結束時間必須晚於開始時間。");
      setForm(submittedForm);
      return false;
    }
    setTimeError("");
    const result = await onSaveItem(
      {
        ...submittedForm,
        title:
          submittedForm.item_type === "transport"
            ? submittedForm.transport_name.trim()
            : (submittedForm.location_name || submittedForm.location || submittedForm.title).trim(),
        location: (submittedForm.location_name || submittedForm.location).trim(),
        location_name: (submittedForm.location_name || submittedForm.location).trim(),
        address: submittedForm.address.trim(),
        map_url: submittedForm.map_url.trim(),
        note: (submittedForm.description || submittedForm.note).trim(),
        description: (submittedForm.description || submittedForm.note).trim(),
        transportation_note: submittedForm.transportation_note.trim(),
        transport_category: submittedForm.transport_category || defaultTransportCategory,
        transport_name: submittedForm.transport_name.trim(),
        transport_duration_minutes: Number(submittedForm.transport_duration_minutes || 0),
        transport_note: submittedForm.transport_note.trim(),
        from_item_id: submittedForm.from_item_id,
        to_item_id: submittedForm.to_item_id,
        ...currentPairSnapshot,
        cost: Number(submittedForm.cost || 0),
      },
      editingId,
      { baseUpdatedAt, tripId: editorTripId },
    );
    if (!result?.ok) {
      if (result?.fixed) {
        setTimeError("此行程已固定，請先解鎖後再修改。");
        setForm(submittedForm);
      }
      if (result?.overlapError) {
        setTimeError(result.overlapError);
        setForm(submittedForm);
      }
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
    setInsertionPair(null);
    setRestoredDraftKey(null);
    setIsOpen(false);
    return true;
  }

  async function submit(event) {
    event.preventDefault();
    await saveCurrentEditor(new FormData(event.currentTarget));
  }

  const isTransportEditor = form.item_type === "transport";
  const visitItems = useMemo(() => sortedVisitItems(dayItems), [dayItems]);
  const { adjacentTransportByPair, invalidTransportItems } = useMemo(
    () => buildTransportPairState(dayItems, visitItems),
    [dayItems, visitItems],
  );

  function alternativeDestination(alternative) {
    return alternative?.location_name || alternative?.title || alternative?.address || "未命名備案";
  }

  function visitDestination(item) {
    return item?.location_name || item?.location || item?.title || "未命名行程";
  }

  function alternativeToForm(alternative = {}) {
    return {
      type: alternative.type || "attraction",
      cost: alternative.cost || 0,
      location_name: alternative.location_name || alternative.title || "",
      description: alternative.description || "",
      address: alternative.address || "",
      map_url: alternative.map_url || "",
      transportation_note: alternative.transportation_note || "",
    };
  }

  function emptyAlternativeForm(item) {
    return {
      type: item.type || "attraction",
      cost: 0,
      location_name: "",
      description: "",
      address: item.address || "",
      map_url: item.map_url || "",
      transportation_note: item.transportation_note || "",
    };
  }

  function setAlternativeForm(itemId, patch) {
    setAlternativeFormsByItem((current) => ({
      ...current,
      [itemId]: {
        ...(current[itemId] || {}),
        ...patch,
      },
    }));
  }

  function resetAlternativeError(itemId) {
    setAlternativeErrorByItem((current) => {
      if (!current[itemId]) return current;
      const next = { ...current };
      delete next[itemId];
      return next;
    });
  }

  function cancelAlternativeFace(itemId, hasAlternative) {
    setEditingAlternativeByItem((current) => ({ ...current, [itemId]: false }));
    resetAlternativeError(itemId);
    if (!hasAlternative) {
      setAlternativeFaceByItem((current) => ({ ...current, [itemId]: false }));
      setAlternativeFormsByItem((current) => {
        const next = { ...current };
        delete next[itemId];
        return next;
      });
    }
  }

  async function flipAlternativeFace(item, alternative) {
    if (item?.is_fixed) {
      setFixedNotice("此行程已固定，請先解鎖後再修改。");
      return;
    }
    resetAlternativeError(item.id);
    if (!alternative) {
      setAlternativeFaceByItem((current) => ({ ...current, [item.id]: true }));
      setEditingAlternativeByItem((current) => ({ ...current, [item.id]: false }));
      setAlternativeFormsByItem((current) => ({ ...current, [item.id]: current[item.id] || emptyAlternativeForm(item) }));
      return;
    }
    if (typeof onApplyAlternative !== "function") return;
    const result = await onApplyAlternative(item, alternative);
    if (result?.ok === false) {
      setAlternativeErrorByItem((current) => ({
        ...current,
        [item.id]: result.error?.message || "Alternative apply failed. Please try again.",
      }));
      return;
    }
    setAlternativeFaceByItem((current) => ({ ...current, [item.id]: false }));
    setEditingAlternativeByItem((current) => ({ ...current, [item.id]: false }));
    setAlternativeFormsByItem((current) => ({ ...current, [item.id]: alternativeToForm(item) }));
  }

  async function saveAlternativeForm(item, alternative) {
    if (item?.is_fixed) {
      setAlternativeErrorByItem((current) => ({
        ...current,
        [item.id]: "此行程已固定，請先解鎖後再修改。",
      }));
      return;
    }
    const formValue = alternativeFormsByItem[item.id] || alternativeToForm(alternative);
    resetAlternativeError(item.id);
    if (isInvalidTimeRange(item.start_time, item.end_time)) {
      setTimeError("結束時間必須晚於開始時間。");
      return;
    }
    setTimeError("");
    const result = await onSaveAlternative(
      item.id,
      {
        title: formValue.location_name,
        type: item.type || "attraction",
        start_time: item.start_time || "",
        end_time: item.end_time || "",
        cost: 0,
        location_name: formValue.location_name,
        description: formValue.description,
        address: "",
        map_url: formValue.map_url,
        transportation_note: "",
      },
      alternative?.id || null,
    );
    if (result?.ok === false) {
      setAlternativeErrorByItem((current) => ({
        ...current,
        [item.id]: result.error?.message || "Alternative save failed. Please try again.",
      }));
      return;
    }
    setAlternativeFaceByItem((current) => ({ ...current, [item.id]: false }));
    setEditingAlternativeByItem((current) => ({ ...current, [item.id]: false }));
    resetAlternativeError(item.id);
  }

  async function deleteAlternative(itemId, alternativeId) {
    const parentItem = dayItems.find((item) => item.id === itemId);
    if (parentItem?.is_fixed) {
      setAlternativeErrorByItem((current) => ({
        ...current,
        [itemId]: "此行程已固定，請先解鎖後再修改。",
      }));
      return;
    }
    resetAlternativeError(itemId);
    const result = await onDeleteAlternative(alternativeId);
    if (result?.ok === false) {
      setAlternativeErrorByItem((current) => ({
        ...current,
        [itemId]: result.error?.message || "Alternative delete failed. Please try again.",
      }));
      return;
    }
    setAlternativeFaceByItem((current) => ({ ...current, [itemId]: false }));
    setEditingAlternativeByItem((current) => ({ ...current, [itemId]: false }));
    setAlternativeFormsByItem((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });
  }

  function relatedTransportItemsFor(item) {
    if (!item || isTransportationCard(item)) return [];
    return dayItems.filter(
      (dayItem) => isTransportationCard(dayItem) && (dayItem.from_item_id === item.id || dayItem.to_item_id === item.id),
    );
  }

  function requestDeleteItem(item) {
    if (item?.is_fixed && !isTransportationCard(item)) {
      setFixedNotice("此行程已固定，請先解鎖後再修改。");
      return;
    }
    setDeleteTarget(item);
  }

  async function toggleItemFixed(item) {
    if (!item || isTransportationCard(item) || typeof onToggleItemFixed !== "function") return;
    if (!item.is_fixed) {
      if (editingId === item.id || (isOpen && form.item_type !== "transport" && editingId === item.id)) {
        setFixedNotice("此行程正在編輯中，請結束編輯後再鎖定。");
        return;
      }
      if (useEditLocks && item.locked_by) {
        setFixedNotice("此行程目前有人正在編輯，暫時無法鎖定。");
        return;
      }
    }
    setFixedNotice("");
    await onToggleItemFixed(item);
  }

  async function confirmDeleteTarget() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    await onDeleteItem(target.id);
  }

  function renderTransportEditorForm() {
    const category = form.transport_category || defaultTransportCategory;
    return (
      <form autoComplete="off" className="item-form transport-editor-form" onSubmit={submit}>
        <input name="item_type" type="hidden" value="transport" />
        <input name="type" type="hidden" value="transport" />
        <input name="start_time" type="hidden" value={form.start_time || ""} />
        <input name="from_item_id" type="hidden" value={form.from_item_id || ""} />
        <input name="to_item_id" type="hidden" value={form.to_item_id || ""} />
        <input name="from_snapshot_start_time" type="hidden" value={form.from_snapshot_start_time || ""} />
        <input name="from_snapshot_end_time" type="hidden" value={form.from_snapshot_end_time || ""} />
        <input name="from_snapshot_destination" type="hidden" value={form.from_snapshot_destination || ""} />
        <input name="to_snapshot_start_time" type="hidden" value={form.to_snapshot_start_time || ""} />
        <input name="to_snapshot_end_time" type="hidden" value={form.to_snapshot_end_time || ""} />
        <input name="to_snapshot_destination" type="hidden" value={form.to_snapshot_destination || ""} />
        {conflict ? <ConflictNotice onKeep={() => setConflict(false)} onLatest={() => closeEditor(true)} /> : null}
        <div className="transport-editor-heading">
          <span className="transport-icon" aria-hidden="true">
            {transportCategoryMeta(category).icon}
          </span>
          <strong>{transportCardTitle(form) || "新增交通資訊"}</strong>
          <div className="transport-editor-actions">
            <button className="primary-button compact" type="submit">
              ✓ 保存
            </button>
            <button className="mini-button" type="button" onClick={() => closeEditor()}>
              X
            </button>
          </div>
        </div>
        <div className="field-group form-grid wide">
          <label>
            交通類別
            <select
              name="transport_category"
              value={category}
              onChange={(event) => setForm({ ...form, transport_category: event.target.value })}
            >
              {transportCategories.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            交通時間
            <input
              autoComplete="off"
              min="1"
              name="transport_duration_minutes"
              placeholder="25"
              required
              step="1"
              type="number"
              value={form.transport_duration_minutes}
              onChange={(event) => setForm({ ...form, transport_duration_minutes: event.target.value })}
            />
          </label>
        </div>
        <label className="full-label">
          交通名稱
          <input
            autoComplete="off"
            maxLength="12"
            name="transport_name"
            placeholder="JR奈良線"
            required
            value={form.transport_name}
            onChange={(event) => setForm({ ...form, transport_name: event.target.value, title: event.target.value })}
          />
        </label>
        <label className="full-label">
          備註
          <textarea
            autoComplete="off"
            name="transport_note"
            rows="3"
            value={form.transport_note}
            onChange={(event) =>
              setForm({
                ...form,
                transport_note: event.target.value,
                transportation_note: event.target.value,
                note: event.target.value,
                description: event.target.value,
              })
            }
          />
        </label>
      </form>
    );
  }

  function transportPairLabel(item) {
    const fromItem = dayItems.find((dayItem) => dayItem.id === item.from_item_id);
    const toItem = dayItems.find((dayItem) => dayItem.id === item.to_item_id);
    const fromLabel = fromItem?.location_name || fromItem?.location || fromItem?.title || "已移除景點";
    const toLabel = toItem?.location_name || toItem?.location || toItem?.title || "已移除景點";
    return `${fromLabel} → ${toLabel}`;
  }

  function renderTransportCard(item, lockedByOther, options = {}) {
    const { hasTimeShortage = false, warningType = "" } = options;
    const isInvalidWarning = warningType === "invalid";
    const isGeneralWarning = warningType === "general";
    const isShortageWarning = hasTimeShortage && !isInvalidWarning;
    const hasWarning = Boolean(warningType) || isShortageWarning;
    const warningClass = isInvalidWarning ? "invalid" : isGeneralWarning ? "general" : isShortageWarning ? "shortage" : warningType;
    const expanded = expandedId === item.id;
    const budgets = budgetsByItem[item.id] || [];
    const category = item.transport_category || defaultTransportCategory;
    const note = item.transport_note || item.transportation_note || item.description || item.note;
    return (
      <article
        className={`transport-card${focusedItemId === item.id ? " focused" : ""}${expanded ? " expanded" : ""}${
          hasWarning ? ` warning ${warningClass}-warning` : ""
        }`}
        onClick={() => {
          setExpandedId(expanded ? null : item.id);
          onFocusItem(item.id);
        }}
      >
        <span className="transport-card-icon" aria-hidden="true">
          <span className="transport-icon" aria-hidden="true">
            {transportCategoryMeta(category).icon}
          </span>
        </span>
        <div className="transport-card-main">
          <strong>{transportCardTitle(item)}</strong>
          {hasWarning ? (
            <span className="transport-warning-badge" aria-label="交通資訊需確認">
              <span aria-hidden="true">⚠</span>
            </span>
          ) : null}
        </div>
        {expanded ? (
          <>
            {isInvalidWarning ? (
              <p className="transport-warning-detail">
                {transportPairLabel(item)} 的交通資訊已不符合目前行程順序
              </p>
            ) : null}
            {isShortageWarning ? (
              <p className="transport-warning-detail">交通時間不足，請注意交通時間或行程時間。</p>
            ) : null}
            {isGeneralWarning ? (
              <p className="transport-warning-detail">
                {isShortageWarning
                  ? "行程時間或目的地已變更，請確認交通資訊。"
                  : `${transportPairLabel(item)} 的行程時間或目的地已變更，請確認交通資訊。`}
              </p>
            ) : null}
            <div className="transport-card-details">
              <p className="transport-note-detail">{note || "尚未填寫"}</p>
              <div className="transport-budget-links">
                {budgets.length ? (
                  budgets.map((budget) => (
                    <span className="pill" key={budget.id}>
                      {budget.title} {formatMoney(budget.twd_amount || budget.amount)}
                    </span>
                  ))
                ) : (
                  <span className="muted-text">尚未連結預算</span>
                )}
              </div>
            </div>
            <div className="transport-card-actions">
              {isGeneralWarning ? (
                <button
                  className="mini-button"
                  disabled={!canEdit || lockedByOther}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onConfirmTransportWarning?.(item.id);
                  }}
                >
                  確認
                </button>
              ) : null}
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
                  requestDeleteItem(item);
                }}
              >
                X
              </button>
            </div>
          </>
        ) : null}
      </article>
    );
  }

  function renderTransportInsert(previousItem, nextItem) {
    if (!canEdit || isOpen || !nextItem || isTransportationCard(previousItem) || isTransportationCard(nextItem)) return null;
    if (adjacentTransportByPair[transportPairKey(previousItem.id, nextItem.id)]) return null;
    return (
      <button className="transport-insert-zone" type="button" onClick={() => openNewTransport(previousItem, nextItem)}>
        <span className="transport-insert-icon">+</span>
        <span className="transport-insert-label">新增交通資訊</span>
        <span className="transport-insert-line" aria-hidden="true" />
      </button>
    );
  }

  function renderVisitEditorForm() {
    return (
      <form autoComplete="off" className="item-form" onSubmit={submit}>
        <input name="item_type" type="hidden" value="visit" />
        {editingId ? <div className="form-mode-label">編輯主行程</div> : null}
        {conflict ? (
          <ConflictNotice onKeep={() => setConflict(false)} onLatest={() => closeEditor(true)} />
        ) : null}
        {timeError ? (
          <div className="notice inline-error" role="alert">
            <span>{timeError}</span>
          </div>
        ) : null}
        <div className="field-group form-grid wide single destination-field">
          <label>
            目的地
            <input
              autoComplete="off"
              placeholder="請輸入目的地名稱"
              name="location_name"
              required
              value={form.location_name || form.location}
              onChange={(event) =>
                setForm({ ...form, title: event.target.value, location: event.target.value, location_name: event.target.value })
              }
            />
          </label>
        </div>
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
                const nextStart = event.target.value;
                const duration = Number(getDurationMinutes(form.start_time, form.end_time));
                const startMinutes = timeToMinutes(nextStart);
                const nextEnd =
                  startMinutes !== null && Number.isFinite(duration) && duration > 0
                    ? minutesToTimeValue(startMinutes + duration)
                    : form.end_time;
                setForm({ ...form, start_time: nextStart, end_time: nextEnd || form.end_time });
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
            停留時長
            <select
              value={getDurationMinutes(form.start_time, form.end_time)}
              disabled={!form.start_time}
              onChange={(event) => {
                setTimeError("");
                const start = timeToMinutes(form.start_time);
                const duration = Number(event.target.value);
                if (start === null || !Number.isFinite(duration) || duration <= 0) return;
                const nextEnd = minutesToTimeValue(start + duration);
                if (nextEnd) setForm({ ...form, end_time: nextEnd });
              }}
            >
              <option value="">未設定</option>
              {timelineDurationOptions.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {formatDurationMinutes(minutes)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="full-label">
          備註
          <textarea
            autoComplete="off"
            name="description"
            rows="3"
            value={form.description || form.note}
            onChange={(event) => setForm({ ...form, note: event.target.value, description: event.target.value })}
          />
        </label>
        <div className="field-group form-grid wide single">
          <label>
            Map URL
            <input
              autoComplete="off"
              name="map_url"
              placeholder="https://maps.google.com/..."
              value={form.map_url}
              onChange={(event) => setForm({ ...form, map_url: event.target.value })}
            />
          </label>
        </div>
        <div className="form-actions">
          <button className="ghost-button" type="button" onClick={() => closeEditor()}>
            取消
          </button>
          <button className="primary-button compact" type="submit">
            儲存
          </button>
        </div>
      </form>
    );
  }

  function renderAlternativeForm(item, alternative) {
    const formValue = alternativeFormsByItem[item.id] || alternativeToForm(alternative);
    const alternativeError = alternativeErrorByItem[item.id];
    return (
      <form
        autoComplete="off"
        className="alternative-card-form"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          saveAlternativeForm(item, alternative);
        }}
      >
        {timeError ? (
          <div className="notice inline-error" role="alert">
            <span>{timeError}</span>
          </div>
        ) : null}
        {alternativeError ? (
          <div className="notice inline-error" role="alert">
            <span>{alternativeError}</span>
          </div>
        ) : null}
        <label className="full-label">
          目的地
          <input
            autoComplete="off"
            placeholder="備案目的地或店名"
            required
            value={formValue.location_name}
            onChange={(event) => setAlternativeForm(item.id, { location_name: event.target.value })}
          />
        </label>
        <label className="full-label">
          備註
          <textarea
            autoComplete="off"
            rows="3"
            value={formValue.description}
            onChange={(event) => setAlternativeForm(item.id, { description: event.target.value })}
          />
        </label>
        <div className="field-group form-grid wide single">
          <label>
            Map URL
            <input
              autoComplete="off"
              placeholder="https://maps.google.com/..."
              value={formValue.map_url}
              onChange={(event) => setAlternativeForm(item.id, { map_url: event.target.value })}
            />
          </label>
        </div>
        <div className="form-actions">
          <button className="ghost-button compact" type="button" onClick={() => cancelAlternativeFace(item.id, Boolean(alternative))}>
            取消
          </button>
          <button className="primary-button compact" disabled={!canEdit || !formValue.location_name.trim()} type="submit">
            儲存備案
          </button>
        </div>
      </form>
    );
  }

  function renderAlternativeSummary(item, alternative, isAlternativeFace) {
    const alternativeError = alternativeErrorByItem[item.id];
    return (
      <div className="alternative-list compact">
        {alternativeError ? (
          <div className="notice inline-error" role="alert">
            <span>{alternativeError}</span>
          </div>
        ) : null}
        {isAlternativeFace && alternative ? (
          <div className="alternative-relation-row">
            <span>{`原行程：${visitDestination(item)}`}</span>
          </div>
        ) : (
          <div className="alternative-relation-row">
            <span>{alternative ? `備案：${alternativeDestination(alternative)}` : "點擊右下角翻卡建立備案"}</span>
            {alternative && !item.is_fixed ? (
              <button
                className="mini-button"
                disabled={!canEdit}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  deleteAlternative(item.id, alternative.id);
                }}
              >
                X
              </button>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  const deleteRelatedTransports = relatedTransportItemsFor(deleteTarget);
  const deleteTargetIsTransport = isTransportationCard(deleteTarget);
  const deleteTitle = deleteTargetIsTransport ? "確認刪除交通資訊？" : "確認刪除行程？";
  const deleteMessage = deleteTargetIsTransport
    ? "此操作無法復原。"
    : deleteRelatedTransports.length
      ? "關聯的交通卡將被一併移除，此操作無法復原。"
      : "此操作無法復原。";

  return (
    <>
    {deleteTarget ? (
      <div className="modal-backdrop">
        <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="delete-confirm-title">
          <h2 id="delete-confirm-title">{deleteTitle}</h2>
          <p>{deleteMessage}</p>
          <div className="form-actions">
            <button className="ghost-button" type="button" onClick={() => setDeleteTarget(null)}>
              取消
            </button>
            <button className="primary-button compact" type="button" onClick={confirmDeleteTarget}>
              確認刪除
            </button>
          </div>
        </div>
      </div>
    ) : null}
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

      {fixedNotice ? (
        <div className="notice inline-error" role="alert">
          <span>{fixedNotice}</span>
          <button type="button" onClick={() => setFixedNotice("")}>
            X
          </button>
        </div>
      ) : null}

      {invalidTransportItems.length ? (
        <div className="transport-warning-stack" aria-label="需確認交通資訊">
          {invalidTransportItems.map((item) => (
            <div className="timeline-flow-entry" key={item.id}>
              {isOpen && isTransportEditor && editingId === item.id
                ? renderTransportEditorForm()
                : renderTransportCard(item, useEditLocks && isLockedByAnotherUser(item, currentUserId), { warningType: "invalid" })}
            </div>
          ))}
          <div className="transport-warning-divider" aria-hidden="true" />
        </div>
      ) : null}

      {isOpen && isTransportEditor && !editingId && !insertionPair ? renderTransportEditorForm() : null}

      {isOpen && !isTransportEditor && !editingId ? renderVisitEditorForm() : null}

      <div className="timeline">
        {visitItems.length ? (
          visitItems.map((item, index) => {
            const lockedByOther = useEditLocks && isLockedByAnotherUser(item, currentUserId);
            const locker = memberById.get(item.locked_by);
            const alternative = (alternativesByItem[item.id] || [])[0] || null;
            const isExpanded = expandedId === item.id;
            const isItemFixed = Boolean(item.is_fixed);
            const isAlternativeFace = isExpanded && Boolean(alternativeFaceByItem[item.id]);
            const isEditingAlternative = Boolean(editingAlternativeByItem[item.id]);
            const isAlternativeFormFace = isAlternativeFace && (!alternative || isEditingAlternative);
            const displayItem =
              isAlternativeFace && alternative && !isEditingAlternative
                ? {
                    ...item,
                    ...alternative,
                    item_type: "visit",
                    type: alternative.type || item.type,
                    cost: alternative.cost || 0,
                    start_time: item.start_time || "",
                    end_time: item.end_time || "",
                    location: alternative.location_name || "",
                    note: alternative.description || "",
                    description: alternative.description || "",
                    transportation_note: alternative.transportation_note || "",
                  }
                : item;
            const destination = isAlternativeFormFace
              ? alternative
                ? "編輯備案"
                : "建立備案"
              : visitDestination(displayItem);
            const secondaryText = isAlternativeFormFace
              ? `原行程：${visitDestination(item)}`
              : displayItem.note || displayItem.description || displayItem.transportation_note;
            const linkedBudgetTotal = (budgetsByItem[item.id] || []).reduce(
              (sum, budget) => sum + Number(budget.twd_amount || budget.amount || 0),
              0,
            );
            const displayCost = linkedBudgetTotal || Number(displayItem.cost || 0);
            const nextItem = visitItems[index + 1];
            const pairKey = nextItem ? transportPairKey(item.id, nextItem.id) : "";
            const transportItem = pairKey ? adjacentTransportByPair[pairKey] : null;
            const hasTransportTimeShortage = transportItem ? transportTimeShortageMinutes(transportItem, item, nextItem) > 0 : false;
            const transportNeedsReview = transportItem && transportPairNeedsReview(transportItem, item, nextItem);
            const transportWarningType = transportNeedsReview ? "general" : hasTransportTimeShortage ? "shortage" : "";
            const isAddingTransportHere =
              isOpen && isTransportEditor && !editingId && insertionPair?.fromId === item.id && insertionPair?.toId === nextItem?.id;
            const isEditingVisitHere = isOpen && !isTransportEditor && editingId === item.id;
            return (
            <div className="timeline-flow-entry" key={item.id}>
            {isEditingVisitHere ? (
              renderVisitEditorForm()
            ) : (
            <article
              className={`timeline-item${focusedItemId === item.id ? " focused" : ""}${isExpanded ? " expanded" : ""}${
                isItemFixed ? " fixed" : ""
              }`}
              onClick={() => {
                setExpandedId(expandedId === item.id ? null : item.id);
                onFocusItem(item.id);
              }}
            >
              <div className="time-block">
                <span>{formatTimeDisplay(item.start_time) || "--:--"}</span>
                <span className="time-connector" aria-hidden="true" />
                <span>{formatTimeDisplay(item.end_time)}</span>
              </div>
              <div className="item-main">
                <h4>{destination}</h4>
                {isAlternativeFormFace ? (
                  <>
                    {secondaryText ? <p className="item-summary">{secondaryText}</p> : null}
                    {renderAlternativeForm(item, alternative)}
                  </>
                ) : (
                  <>
                {secondaryText ? (
                  <p className="item-summary">{secondaryText}</p>
                ) : (
                  <p className="item-summary item-summary-placeholder" aria-hidden="true">
                    &nbsp;
                  </p>
                )}
                <div className="item-meta">
                  <span
                    className="pill"
                    style={{ background: `${typeColors[displayItem.type]}22`, color: typeColors[displayItem.type] }}
                  >
                    {typeLabels[displayItem.type]}
                  </span>
                  {displayCost > 0 ? <span className="pill">{formatMoney(displayCost)}</span> : null}
                  {alternative ? (
                    <span className="pill">備案</span>
                  ) : null}
                </div>
                {lockedByOther ? <div className="lock-note">{memberName(locker)} 正在編輯這筆資料</div> : null}
                {isExpanded ? (
                  <div className="item-details">
                    {displayItem.description || displayItem.note ? <p>{displayItem.description || displayItem.note}</p> : null}
                    {displayItem.address ? <p>地址：{displayItem.address}</p> : null}
                    {displayItem.transportation_note ? <p>交通：{displayItem.transportation_note}</p> : null}
                    {displayItem.map_url ? (
                      <a href={displayItem.map_url} rel="noreferrer" target="_blank">
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
                  </div>
                ) : null}
                    {isExpanded ? renderAlternativeSummary(item, alternative, isAlternativeFace) : null}
                  </>
                )}
              </div>
              <div className="item-actions">
                {(!isAlternativeFace || isItemFixed) ? (
                  <button
                    className="mini-button lock-button"
                    disabled={!canEdit || (!isItemFixed && (lockedByOther || Boolean(item.locked_by)))}
                    type="button"
                    title={isItemFixed ? "解鎖" : "鎖定"}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleItemFixed(item);
                    }}
                  >
                    {isItemFixed ? "🔒" : "🔓"}
                  </button>
                ) : null}
                {!isAlternativeFace && !isItemFixed ? (
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
                ) : null}
                {isAlternativeFace && alternative && !isAlternativeFormFace && !isItemFixed ? (
                  <button
                    className="mini-button"
                    disabled={!canEdit || lockedByOther}
                    type="button"
                    title="Edit alternative"
                    onClick={(event) => {
                      event.stopPropagation();
                      setEditingAlternativeByItem((current) => ({ ...current, [item.id]: true }));
                      setAlternativeFormsByItem((current) => ({ ...current, [item.id]: alternativeToForm(alternative) }));
                      resetAlternativeError(item.id);
                    }}
                  >
                    E
                  </button>
                ) : null}
                {!isItemFixed ? (
                  <button
                    className="mini-button"
                    disabled={!canEdit}
                    type="button"
                    title="刪除"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (isAlternativeFormFace) {
                        cancelAlternativeFace(item.id, Boolean(alternative));
                      } else if (isAlternativeFace) {
                        if (alternative) {
                          deleteAlternative(item.id, alternative.id);
                        } else {
                          cancelAlternativeFace(item.id, false);
                        }
                      } else {
                        requestDeleteItem(item);
                      }
                    }}
                  >
                    X
                  </button>
                ) : null}
              </div>
              {isExpanded && !isItemFixed ? (
                <div className="alternative-card-footer">
                  <button
                    className="alternative-flip-button"
                    disabled={!canEdit}
                    type="button"
                    title={alternative ? "Toggle primary / alternative" : "Create alternative"}
                    onClick={(event) => {
                      event.stopPropagation();
                      flipAlternativeFace(item, alternative);
                    }}
                  >
                    ↻
                  </button>
                </div>
              ) : null}
            </article>
            )}
            {isAddingTransportHere ? renderTransportEditorForm() : null}
            {!isAddingTransportHere && transportItem ? (
              <div className="timeline-flow-entry" key={transportItem.id}>
                {isOpen && isTransportEditor && editingId === transportItem.id
                  ? renderTransportEditorForm()
                  : renderTransportCard(transportItem, useEditLocks && isLockedByAnotherUser(transportItem, currentUserId), {
                      hasTimeShortage: hasTransportTimeShortage,
                      warningType: transportWarningType,
                    })}
              </div>
            ) : null}
            {!isAddingTransportHere && !transportItem ? renderTransportInsert(item, nextItem) : null}
            </div>
            );
          })
        ) : (
          <div className="timeline-empty">這一天還沒有行程</div>
        )}
      </div>
    </div>
    </>
  );
}

function MultiDayTimelineColumns({ activeDay, days, focusedItemId, itemsByDay, onActiveDay, onFocusItem }) {
  const otherDays = days
    .map((date, index) => ({ date, index, items: itemsByDay[index] || [] }))
    .filter((day) => day.index !== activeDay);
  if (!otherDays.length) return null;

  return (
    <>
      {otherDays.map((day) => {
        const visits = sortedVisitItems(day.items);
        const adjacentTransportByPair = buildAdjacentTransportMap(day.items, visits);
        return (
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
            {visits.length ? (
              visits.map((item, index) => {
                const destination = item.location_name || item.location || item.title;
                const secondaryText = item.note || item.description || item.transportation_note;
                const nextItem = visits[index + 1];
                const pairKey = nextItem ? transportPairKey(item.id, nextItem.id) : "";
                const transportItem = pairKey ? adjacentTransportByPair[pairKey] : null;
                return (
                  <Fragment key={item.id}>
                  <button
                    className={`timeline-preview-card${focusedItemId === item.id ? " focused" : ""}`}
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
                  {transportItem ? (
                    <button
                      className={`timeline-preview-card transport-preview-card${focusedItemId === transportItem.id ? " focused" : ""}`}
                      type="button"
                      onClick={() => {
                        onActiveDay(day.index);
                        onFocusItem(transportItem.id);
                      }}
                    >
                      <span className="transport-icon" aria-hidden="true">
                        {transportCategoryMeta(transportItem.transport_category).icon}
                      </span>
                      <span>
                        <strong>{transportCardTitle(transportItem)}</strong>
                      </span>
                    </button>
                  ) : null}
                  </Fragment>
                );
              })
            ) : (
              <div className="timeline-empty compact">這一天還沒有行程</div>
            )}
          </div>
        </section>
        );
      })}
    </>
  );
}

function RoutePanel({ dayItems, focusedItemId, headingEyebrow = "Route", onFocusItem }) {
  const stops = sortedVisitItems(dayItems).filter((item) => item.location_name || item.location);
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
  const activeEditorGuardId = `budget:${activeTrip?.id || "no-trip"}`;
  const activeEditorGuard = useMemo(
    () => ({
      discard: () => closeBudgetForm(true),
      isActive: isOpen,
      isDirty: hasUnsavedChanges,
      save: () => saveCurrentBudget(),
    }),
    [form, hasUnsavedChanges, isOpen, editingId, baseUpdatedAt, draftKey],
  );

  useActiveEditorGuard(activeEditorGuardId, activeEditorGuard);

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
    const canOpenEditor = await requestActiveEditorHandoff({
      excludeId: activeEditorGuardId,
      tripId: activeTrip?.id,
    });
    if (!canOpenEditor) return;
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
    const canOpenEditor = await requestActiveEditorHandoff({
      excludeId: activeEditorGuardId,
      tripId: activeTrip?.id,
    });
    if (!canOpenEditor) return;
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
        <form autoComplete="off" className="item-form budget-form" onSubmit={submit}>
          {conflict ? (
            <ConflictNotice onKeep={() => setConflict(false)} onLatest={() => closeBudgetForm(true)} />
          ) : null}
          <div className="field-group form-grid">
            <label>
              大項
              <input
                autoComplete="off"
                required
                value={form.category}
                onChange={(event) => setForm({ ...form, category: event.target.value })}
              />
            </label>
            <label>
              細項
              <input
                autoComplete="off"
                value={form.subcategory}
                onChange={(event) => setForm({ ...form, subcategory: event.target.value })}
              />
            </label>
            <label>
              金額
              <input
                autoComplete="off"
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
                autoComplete="off"
                value={form.currency}
                onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })}
              />
            </label>
          </div>
          <div className="field-group form-grid wide">
            <label>
              標題
              <input
                autoComplete="off"
                required
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </label>
            <label>
              匯率
              <input
                autoComplete="off"
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
              <input autoComplete="off" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
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
  const activeEditorGuardId = `actual:${activeTrip?.id || "no-trip"}`;
  const activeEditorGuard = useMemo(
    () => ({
      discard: () => closeExpenseForm(true),
      isActive: isOpen,
      isDirty: hasUnsavedChanges,
      save: () => saveCurrentExpense(),
    }),
    [form, hasUnsavedChanges, isOpen, editingId, baseUpdatedAt, draftKey],
  );

  useActiveEditorGuard(activeEditorGuardId, activeEditorGuard);

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
    const canOpenEditor = await requestActiveEditorHandoff({
      excludeId: activeEditorGuardId,
      tripId: activeTrip?.id,
    });
    if (!canOpenEditor) return;
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
    const canOpenEditor = await requestActiveEditorHandoff({
      excludeId: activeEditorGuardId,
      tripId: activeTrip?.id,
    });
    if (!canOpenEditor) return;
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
        <form autoComplete="off" className="item-form budget-form" onSubmit={submit}>
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
              <input autoComplete="off" required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
            </label>
          </div>
          <div className="field-group form-grid">
            <label>
              金額
              <input
                autoComplete="off"
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
                autoComplete="off"
                value={form.currency}
                onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })}
              />
            </label>
            <label>
              匯率
              <input
                autoComplete="off"
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
                autoComplete="off"
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
              <input autoComplete="off" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
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
  restoreDrafts = true,
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
  const activeEditorGuardId = `accommodation:${activeTrip?.id || trip?.id || "no-trip"}`;
  const activeEditorGuard = useMemo(
    () => ({
      discard: () => closeAccommodationForm(true),
      isActive: isOpen,
      isDirty: hasUnsavedChanges,
      save: () => saveCurrentAccommodation(),
    }),
    [form, hasUnsavedChanges, isOpen, editingId, baseUpdatedAt, draftKey],
  );

  useActiveEditorGuard(activeEditorGuardId, activeEditorGuard);

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
    if (!restoreDrafts || isOpen || !(activeTrip?.id || trip?.id) || !currentUserId) return;
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
  }, [accommodations, activeTrip?.id, currentUserId, isOpen, restoreDrafts, trip?.id]);

  async function openNewAccommodation() {
    const canOpenEditor = await requestActiveEditorHandoff({
      excludeId: activeEditorGuardId,
      tripId: activeTrip?.id || trip?.id,
    });
    if (!canOpenEditor) return;
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
    const canOpenEditor = await requestActiveEditorHandoff({
      excludeId: activeEditorGuardId,
      tripId: activeTrip?.id || trip?.id,
    });
    if (!canOpenEditor) return;
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
        <form autoComplete="off" className="item-form accommodation-form" onSubmit={submit}>
          {conflict ? (
            <ConflictNotice onKeep={() => setConflict(false)} onLatest={() => closeAccommodationForm(true)} />
          ) : null}
          <div className="field-group form-grid wide">
            <label>
              住宿名稱
              <input autoComplete="off" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
            <label>
              預約代碼
              <input
                autoComplete="off"
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
              <input autoComplete="off" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
            </label>
            <label>
              Map URL
              <input autoComplete="off" value={form.map_url} onChange={(event) => setForm({ ...form, map_url: event.target.value })} />
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
              autoComplete="off"
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
  restoreDrafts = true,
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
            restoreDrafts={restoreDrafts}
          />
        </div>
        <div className={`todo-guide-column${activeTab === "guide" ? " active" : ""}`}>
          <GuidePanel
            activeTrip={activeTrip}
            canEdit={canEdit}
            currentUserId={currentUserId}
            guideItems={guideItems}
            onDelete={onDeleteGuide}
            onSave={onSaveGuide}
            restoreDrafts={restoreDrafts}
          />
        </div>
      </div>
    </section>
  );
}

function TodoPanel({
  activeTrip,
  canEdit,
  currentUserId,
  guideItems,
  members,
  onDelete,
  onSave,
  onToggle,
  restoreDrafts = true,
  todoItems,
}) {
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
  const activeEditorGuardId = `todo:${activeTrip?.id || "no-trip"}`;
  const activeEditorGuard = useMemo(
    () => ({
      discard: () => closeTodoForm(true),
      isActive: isOpen,
      isDirty: hasUnsavedChanges,
      save: () => saveCurrentTodo(),
    }),
    [form, hasUnsavedChanges, isOpen, editingId, baseUpdatedAt, draftKey],
  );

  useActiveEditorGuard(activeEditorGuardId, activeEditorGuard);

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
    if (!restoreDrafts || isOpen || !activeTrip?.id || !currentUserId) return;
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
  }, [activeTrip?.id, currentUserId, isOpen, restoreDrafts, todoItems]);

  async function openNewTodo() {
    const canOpenEditor = await requestActiveEditorHandoff({
      excludeId: activeEditorGuardId,
      tripId: activeTrip?.id,
    });
    if (!canOpenEditor) return;
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
    const canOpenEditor = await requestActiveEditorHandoff({
      excludeId: activeEditorGuardId,
      tripId: activeTrip?.id,
    });
    if (!canOpenEditor) return;
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
        <form autoComplete="off" className="item-form" onSubmit={submit}>
          {conflict ? (
            <ConflictNotice onKeep={() => setConflict(false)} onLatest={() => closeTodoForm(true)} />
          ) : null}
          <div className="field-group form-grid wide">
            <label>
              標題
              <input autoComplete="off" required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
            </label>
            <label>
              截止日
              <input
                autoComplete="off"
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
              autoComplete="off"
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

function GuidePanel({ activeTrip, canEdit, currentUserId, guideItems, onDelete, onSave, restoreDrafts = true }) {
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
  const activeEditorGuardId = `guide:${activeTrip?.id || "no-trip"}`;
  const activeEditorGuard = useMemo(
    () => ({
      discard: () => closeGuideForm(true),
      isActive: isOpen,
      isDirty: hasUnsavedChanges,
      save: () => saveCurrentGuide(),
    }),
    [form, hasUnsavedChanges, isOpen, editingId, baseUpdatedAt, draftKey],
  );

  useActiveEditorGuard(activeEditorGuardId, activeEditorGuard);

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
    if (!restoreDrafts || isOpen || !activeTrip?.id || !currentUserId) return;
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
  }, [activeTrip?.id, currentUserId, guideItems, isOpen, restoreDrafts]);

  async function openNewGuide() {
    const canOpenEditor = await requestActiveEditorHandoff({
      excludeId: activeEditorGuardId,
      tripId: activeTrip?.id,
    });
    if (!canOpenEditor) return;
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
    const canOpenEditor = await requestActiveEditorHandoff({
      excludeId: activeEditorGuardId,
      tripId: activeTrip?.id,
    });
    if (!canOpenEditor) return;
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
        <form autoComplete="off" className="item-form" onSubmit={submit}>
          {conflict ? (
            <ConflictNotice onKeep={() => setConflict(false)} onLatest={() => closeGuideForm(true)} />
          ) : null}
          <label>
            標題
            <input autoComplete="off" required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </label>
          <label className="full-label">
            URL
            <input autoComplete="off" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} />
          </label>
          <label className="full-label">
            說明
            <textarea
              autoComplete="off"
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
  restoreDrafts = true,
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
  const personalEditorGuardId = `luggage-personal:${activeTrip?.id || "no-trip"}`;
  const sharedEditorGuardId = `luggage-shared:${activeTrip?.id || "no-trip"}`;
  const personalEditorGuard = useMemo(
    () => ({
      discard: () => discardPersonalEdit(),
      isActive: Boolean(editingPersonalId || personalDraft.hasUnsavedChanges),
      isDirty: personalDraft.hasUnsavedChanges,
      save: () => saveCurrentPersonal(),
    }),
    [personalForm, personalDraft.hasUnsavedChanges, editingPersonalId, personalUpdatedAt],
  );
  const sharedEditorGuard = useMemo(
    () => ({
      discard: () => discardSharedEdit(),
      isActive: Boolean(editingSharedId || sharedDraft.hasUnsavedChanges),
      isDirty: sharedDraft.hasUnsavedChanges,
      save: () => saveCurrentShared(),
    }),
    [sharedForm, sharedDraft.hasUnsavedChanges, editingSharedId, sharedUpdatedAt],
  );

  useActiveEditorGuard(personalEditorGuardId, personalEditorGuard);
  useActiveEditorGuard(sharedEditorGuardId, sharedEditorGuard);

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
    if (!restoreDrafts || !activeTrip?.id || !currentUserId || editingPersonalId) return;
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
  }, [activeTrip?.id, currentUserId, editingPersonalId, luggageItems, restoreDrafts]);

  useEffect(() => {
    if (!restoreDrafts || !activeTrip?.id || !currentUserId || editingSharedId) return;
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
  }, [activeTrip?.id, currentUserId, editingSharedId, restoreDrafts, sharedLuggageItems]);

  async function saveCurrentPersonal() {
    if (!personalForm.title.trim()) return false;
    const canOpenEditor = await requestActiveEditorHandoff({
      excludeId: personalEditorGuardId,
      tripId: activeTrip?.id,
    });
    if (!canOpenEditor) return false;
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
    const canOpenEditor = await requestActiveEditorHandoff({
      excludeId: sharedEditorGuardId,
      tripId: activeTrip?.id,
    });
    if (!canOpenEditor) return false;
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
    const canOpenEditor = await requestActiveEditorHandoff({
      excludeId: personalEditorGuardId,
      tripId: activeTrip?.id,
    });
    if (!canOpenEditor) return;
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
    const canOpenEditor = await requestActiveEditorHandoff({
      excludeId: sharedEditorGuardId,
      tripId: activeTrip?.id,
    });
    if (!canOpenEditor) return;
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

  async function updatePersonalForm(nextForm) {
    const canOpenEditor = await requestActiveEditorHandoff({
      excludeId: personalEditorGuardId,
      tripId: activeTrip?.id,
    });
    if (canOpenEditor) setPersonalForm(nextForm);
  }

  async function updateSharedForm(nextForm) {
    const canOpenEditor = await requestActiveEditorHandoff({
      excludeId: sharedEditorGuardId,
      tripId: activeTrip?.id,
    });
    if (canOpenEditor) setSharedForm(nextForm);
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
          <form autoComplete="off" className="inline-form" onSubmit={submitPersonal}>
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
          <form autoComplete="off" className="shared-luggage-form" onSubmit={submitShared}>
            <input
              autoComplete="off"
              disabled={!canEdit}
              placeholder="新增團隊公物"
              value={sharedForm.title}
              onChange={(event) => setSharedForm({ ...sharedForm, title: event.target.value })}
            />
            <input
              autoComplete="off"
              disabled={!canEdit}
              placeholder="分類"
              value={sharedForm.category}
              onChange={(event) => setSharedForm({ ...sharedForm, category: event.target.value })}
            />
            <select
              disabled={!canEdit}
              value={sharedForm.assigned_to}
              onChange={(event) => void updateSharedForm({ ...sharedForm, assigned_to: event.target.value })}
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
                const canToggleAssigned = canEdit && (item.assigned_to === currentUserId || canEdit);
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
        autoComplete="off"
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          onAdd(title);
          setTitle("");
        }}
      >
        <input
          autoComplete="off"
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

function memberRoleLabel(role) {
  return {
    owner: "擁有者",
    editor: "編輯者",
    viewer: "檢視者",
  }[role] || "成員";
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
                {memberRoleLabel(member.role)} ·{" "}
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
  const [dateSelectionStep, setDateSelectionStep] = useState(() => initialDateSelectionStep(form.start_date, form.end_date));
  const [startDateInput, setStartDateInput] = useState(() => formatHeaderDate(form.start_date) || "");
  const [endDateInput, setEndDateInput] = useState(() => formatHeaderDate(form.end_date) || "");
  const [visibleMonth, setVisibleMonth] = useState(() =>
    startOfMonth(parseDateOnly(form.start_date) || parseDateOnly(todayInput()) || new Date()),
  );
  const [hoveredDate, setHoveredDate] = useState("");
  const [dateError, setDateError] = useState("");
  const startDateInputRef = useRef(null);
  const tripDayCount = dateRangeDayCount(form.start_date, form.end_date);
  const previewEndDate =
    dateSelectionStep === "end" &&
    form.start_date &&
    !form.end_date &&
    hoveredDate &&
    !isDateBefore(hoveredDate, form.start_date)
      ? hoveredDate
      : "";
  const previewDayCount = previewEndDate ? dateRangeDayCount(form.start_date, previewEndDate) : null;
  const canSubmitDates = Boolean(form.start_date && form.end_date && !isDateBefore(form.end_date, form.start_date));

  function updateDates(startDate, endDate) {
    onChange({ ...form, end_date: endDate, start_date: startDate });
  }

  function selectDialogDate(dateKey) {
    setDateError("");
    setHoveredDate("");
    if (dateSelectionStep === "start" || !form.start_date) {
      updateDates(dateKey, "");
      setStartDateInput(formatHeaderDate(dateKey));
      setEndDateInput("");
      setDateSelectionStep("end");
      return;
    }
    if (isDateBefore(dateKey, form.start_date)) {
      updateDates(dateKey, "");
      setStartDateInput(formatHeaderDate(dateKey));
      setEndDateInput("");
      setDateSelectionStep("end");
      return;
    }
    updateDates(form.start_date, dateKey);
    setEndDateInput(formatHeaderDate(dateKey));
    setDateSelectionStep("start");
  }

  function clearDialogDates() {
    updateDates("", "");
    setStartDateInput("");
    setEndDateInput("");
    setDateSelectionStep("start");
    setHoveredDate("");
    setDateError("");
    requestAnimationFrame(() => {
      startDateInputRef.current?.focus();
    });
  }

  function commitDialogDateInput(field) {
    const rawValue = field === "start" ? startDateInput : endDateInput;
    if (!String(rawValue || "").trim()) {
      if (field === "start") {
        updateDates("", "");
        setEndDateInput("");
        setDateSelectionStep("start");
      } else {
        updateDates(form.start_date, "");
        setDateSelectionStep(initialDateSelectionStep(form.start_date, ""));
      }
      setDateError("");
      return true;
    }
    const normalized = parseDateTextInput(rawValue);
    if (!normalized) {
      setDateError("請輸入有效日期");
      return false;
    }
    setDateError("");
    setHoveredDate("");
    setVisibleMonth(startOfMonth(parseDateOnly(normalized)));
    if (field === "start") {
      const nextEndDate = form.end_date && isDateBefore(form.end_date, normalized) ? "" : form.end_date;
      updateDates(normalized, nextEndDate);
      setStartDateInput(formatHeaderDate(normalized));
      if (!nextEndDate) setEndDateInput("");
      setDateSelectionStep("end");
      return true;
    }
    if (form.start_date && isDateBefore(normalized, form.start_date)) {
      updateDates(normalized, "");
      setStartDateInput(formatHeaderDate(normalized));
      setEndDateInput("");
      setDateSelectionStep("end");
      return true;
    }
    updateDates(form.start_date, normalized);
    setEndDateInput(formatHeaderDate(normalized));
    setDateSelectionStep("start");
    return true;
  }

  function handleDialogDateInputKeyDown(event, field) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    commitDialogDateInput(field);
  }

  return (
    <div className="modal-backdrop">
      <form autoComplete="off" className="dialog-card create-trip-dialog" onSubmit={onSubmit}>
        <h2>新增旅程</h2>
        <label>
          旅程名稱
          <input
            autoComplete="off"
            required
            value={form.title}
            onChange={(event) => onChange({ ...form, title: event.target.value })}
          />
        </label>
        <label>
          目的地
          <input
            autoComplete="off"
            required
            value={form.destination}
            onChange={(event) => onChange({ ...form, destination: event.target.value })}
          />
        </label>
        <div className="create-trip-date-picker">
          <TripDateRangeSelector
            activeStep={dateSelectionStep}
            endDate={form.end_date}
            endInput={endDateInput}
            errorId={dateError ? "create-trip-date-error" : undefined}
            onCommitInput={commitDialogDateInput}
            onEndInputChange={(value) => {
              setEndDateInput(value);
              if (dateError) setDateError("");
            }}
            onHoverDate={setHoveredDate}
            onInputKeyDown={handleDialogDateInputKeyDown}
            onSelectDate={selectDialogDate}
            onStartInputChange={(value) => {
              setStartDateInput(value);
              if (dateError) setDateError("");
            }}
            onVisibleMonthChange={setVisibleMonth}
            previewEndDate={previewEndDate}
            startDate={form.start_date}
            startInput={startDateInput}
            startInputRef={startDateInputRef}
            visibleMonth={visibleMonth}
          />
          {dateError ? (
            <div className="trip-header-date-error" id="create-trip-date-error" role="alert">
              {dateError}
            </div>
          ) : null}
          <div className="trip-date-range-footer">
            <div className="trip-header-date-summary" aria-live="polite">
              旅程天數：
              {tripDayCount ? `${tripDayCount} 天` : previewDayCount ? `${previewDayCount} 天（預覽）` : "—"}
            </div>
            <button
              type="button"
              className="ghost-button compact"
              disabled={!form.start_date && !form.end_date}
              onClick={clearDialogDates}
            >
              清除
            </button>
          </div>
        </div>
        <div className="form-actions">
          <button className="ghost-button" type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary-button compact" type="submit" disabled={!canSubmitDates}>
            建立
          </button>
        </div>
      </form>
    </div>
  );
}

function MembersInviteDialog({
  canManageMembers,
  currentRole,
  currentUserId,
  isTripDateLocked,
  members,
  onApprove,
  onClose,
  onCreateInvite,
  onReject,
  onRemoveMember,
  onUpdateRole,
}) {
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [openRoleMenuMemberId, setOpenRoleMenuMemberId] = useState(null);
  const approvedMembers = members.filter((member) => member.status === "approved");
  const pendingMembers = canManageMembers ? members.filter((member) => member.status === "pending") : [];
  const hasOnlyOneApprovedMember = approvedMembers.length === 1;

  useEffect(() => {
    if (!openRoleMenuMemberId) return undefined;

    function closeRoleMenuOnOutsideClick(event) {
      if (event.target instanceof Element && event.target.closest(".member-role-menu")) return;
      setOpenRoleMenuMemberId(null);
    }

    function closeRoleMenuOnEscape(event) {
      if (event.key === "Escape") {
        setOpenRoleMenuMemberId(null);
      }
    }

    document.addEventListener("pointerdown", closeRoleMenuOnOutsideClick);
    document.addEventListener("keydown", closeRoleMenuOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeRoleMenuOnOutsideClick);
      document.removeEventListener("keydown", closeRoleMenuOnEscape);
    };
  }, [openRoleMenuMemberId]);

  function chooseMemberRole(member, nextRole) {
    setOpenRoleMenuMemberId(null);
    if (member.role !== nextRole) {
      onUpdateRole(member.id, nextRole);
    }
  }

  function removeMemberFromMenu(member) {
    setOpenRoleMenuMemberId(null);
    onRemoveMember(member.id);
  }

  async function createInvite() {
    if (!canManageMembers || busy) return;
    setBusy(true);
    setError("");
    let nextToken = token;
    if (!nextToken && typeof onCreateInvite === "function") {
      const result = await onCreateInvite();
      if (!result?.ok) {
        setBusy(false);
        setError(result?.message || "無法產生邀請連結。");
        return;
      }
      nextToken = result.token;
      setToken(nextToken);
    }
    const url = `${window.location.origin}?invite=${nextToken}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError("無法複製邀請連結，請手動複製網址。");
    }
    setBusy(false);
  }

  const inviteUrl = token ? `${window.location.origin}?invite=${token}` : "";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="dialog-card members-dialog" onClick={(event) => event.stopPropagation()}>
        <h2>成員與邀請</h2>
        {isTripDateLocked ? (
          <div className="notice">旅程已進入結算階段，無法邀請或管理成員。</div>
        ) : null}
        {error ? <div className="notice danger">{error}</div> : null}

        <section className="members-dialog-section">
          <div className="panel-heading tight">
            <div>
              <p className="eyebrow">Members</p>
              <h3>目前成員</h3>
            </div>
            <span className="pill">{approvedMembers.length} 位</span>
          </div>
          <div className="member-list">
            {approvedMembers.map((member) => {
              const canEditRole = canManageMembers && member.role !== "owner" && member.user_id !== currentUserId;
              return (
                <div className="member-row detailed" key={member.id || member.user_id || member.email}>
                  <span className="member-avatar">{memberInitial(member)}</span>
                  <div>
                    <strong>{memberName(member)}</strong>
                    <span className="member-email">{member.email || member.user_id}</span>
                  </div>
                  <div className="member-actions">
                    {canEditRole ? (
                      <div className="member-role-menu">
                        <button
                          className="member-role-pill member-role-menu-trigger"
                          type="button"
                          aria-haspopup="menu"
                          aria-expanded={openRoleMenuMemberId === member.id}
                          aria-label={`${memberName(member)} 角色操作`}
                          onClick={() =>
                            setOpenRoleMenuMemberId((currentMemberId) => (currentMemberId === member.id ? null : member.id))
                          }
                        >
                          {memberRoleLabel(member.role)}
                          <span className="member-role-menu-caret" aria-hidden="true">
                            ▾
                          </span>
                        </button>
                        {openRoleMenuMemberId === member.id ? (
                          <div className="member-role-menu-popover" role="menu">
                            {["editor", "viewer"].map((role) => (
                              <button
                                className={`member-role-menu-item${member.role === role ? " active" : ""}`}
                                type="button"
                                role="menuitemradio"
                                aria-checked={member.role === role}
                                key={role}
                                onClick={() => chooseMemberRole(member, role)}
                              >
                                <span className="member-role-menu-check" aria-hidden="true">
                                  {member.role === role ? "✓" : ""}
                                </span>
                                {memberRoleLabel(role)}
                              </button>
                            ))}
                            <div className="member-role-menu-separator" />
                            <button
                              className="member-role-menu-item danger"
                              type="button"
                              role="menuitem"
                              onClick={() => removeMemberFromMenu(member)}
                            >
                              <span className="member-role-menu-check" aria-hidden="true" />
                              移除成員
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <span className="member-role-pill">{memberRoleLabel(member.role)}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {pendingMembers.length ? (
          <section className="members-dialog-section">
            <div className="panel-heading tight">
              <div>
                <p className="eyebrow">Pending</p>
                <h3>待審核</h3>
              </div>
              <span className="pill">{pendingMembers.length} 位</span>
            </div>
            <div className="member-list">
              {pendingMembers.map((member) => (
                <div className="member-row detailed" key={member.id || member.user_id || member.email}>
                  <span className="member-avatar">{memberInitial(member)}</span>
                  <div>
                    <strong>{memberName(member)}</strong>
                    <span className="member-email">{member.email || member.user_id}</span>
                  </div>
                  <div className="member-actions">
                    <button className="mini-button" type="button" onClick={() => onApprove(member.id)}>
                      核准
                    </button>
                    <button className="mini-button" type="button" onClick={() => onReject(member.id)}>
                      拒絕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="members-dialog-section">
          <div className="panel-heading tight">
            <div>
              <p className="eyebrow">Invite</p>
              <h3>邀請成員</h3>
            </div>
          </div>
          <p>{hasOnlyOneApprovedMember ? "邀請朋友一起規劃這趟旅程。" : "朋友使用連結登入後會送出加入申請，核准後即可共同編輯。"}</p>
          {inviteUrl ? <input readOnly value={inviteUrl} /> : null}
          {copied ? <div className="notice">邀請連結已複製。</div> : null}
          <button className="primary-button compact" type="button" disabled={!canManageMembers || busy} onClick={createInvite}>
            {busy ? "產生中..." : "產生並複製連結"}
          </button>
        </section>

        <section className="members-dialog-section">
          <div className="panel-heading tight">
            <div>
              <p className="eyebrow">Permission</p>
              <h3>權限說明</h3>
            </div>
          </div>
          <p>
            你目前是{memberRoleLabel(currentRole)}。
            {currentRole === "owner"
              ? "擁有者可管理成員、邀請與分享連結。"
              : currentRole === "editor"
                ? "編輯者可共同編輯旅程，並可複製既有啟用的分享連結。"
                : "檢視者可查看旅程與成員資訊，但不可編輯或管理分享。"}
          </p>
        </section>

        <div className="form-actions">
          <button className="ghost-button" type="button" onClick={onClose}>
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}

function ShareDialog({ canManage = false, links, onClose, onRefresh, trip }) {
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState("");
  const [error, setError] = useState("");
  const primaryLink = useMemo(
    () =>
      [...links].sort((a, b) => {
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
        return (b.created_at || "").localeCompare(a.created_at || "");
      })[0] || null,
    [links],
  );

  async function copyShareUrl(token, id) {
    const url = `${window.location.origin}?share=${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setError("");
    } catch {
      setError("無法複製分享連結，請手動複製網址。");
    }
  }

  async function createShareLink() {
    if (!canManage) return;
    setBusy(true);
    setError("");
    if (primaryLink) {
      if (!primaryLink.is_active) {
        const { error: updateError } = await supabase
          .from("share_links")
          .update({ is_active: true })
          .eq("id", primaryLink.id);
        if (updateError) {
          setBusy(false);
          setError(updateError.message);
          return;
        }
        await onRefresh();
      }
      setBusy(false);
      await copyShareUrl(primaryLink.token, primaryLink.id);
      return;
    }
    const token = crypto.randomUUID();
    const { error } = await supabase.from("share_links").insert({
      trip_id: trip.id,
      token,
      is_active: true,
    });
    setBusy(false);

    if (error) {
      setError(error.message);
      return;
    }

    await onRefresh();
    await copyShareUrl(token, token);
  }

  async function toggleShareLink(link) {
    if (!canManage) return;
    setBusy(true);
    setError("");
    const { error } = await supabase
      .from("share_links")
      .update({ is_active: !link.is_active })
      .eq("id", link.id);
    setBusy(false);

    if (error) {
      setError(error.message);
      return;
    }

    await onRefresh();
  }

  return (
    <div className="modal-backdrop">
      <div className="dialog-card share-dialog">
        <h2>唯讀分享</h2>
        <p>分享頁不需要登入，只會顯示行程、住宿與指南；預算、實付、結算、行李與成員資料不會公開。</p>
        {error ? <div className="notice danger">{error}</div> : null}
        <div className="share-link-list">
          {primaryLink ? (
            <div className="share-link-row" key={primaryLink.id}>
              <div>
                <strong>{primaryLink.is_active ? "分享連結已啟用" : "分享連結已停用"}</strong>
                <span>{`${window.location.origin}?share=${primaryLink.token}`}</span>
              </div>
              <div className="share-link-actions">
                {primaryLink.is_active ? (
                  <button className="mini-button" type="button" onClick={() => copyShareUrl(primaryLink.token, primaryLink.id)}>
                    {copiedId === primaryLink.id ? "已複製" : "複製"}
                  </button>
                ) : null}
                {canManage ? (
                  <button className="mini-button" type="button" disabled={busy} onClick={() => toggleShareLink(primaryLink)}>
                    {primaryLink.is_active ? "停用" : "啟用"}
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="empty-inline">尚未建立唯讀分享連結。</div>
          )}
        </div>
        <div className="form-actions">
          <button className="ghost-button" type="button" onClick={onClose}>
            關閉
          </button>
          {canManage ? (
            <button className="primary-button compact" type="button" disabled={busy} onClick={createShareLink}>
              建立並複製連結
            </button>
          ) : null}
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
  const sortedItineraryItems = useMemo(() => sortScheduleItems(itineraryItems), [itineraryItems]);

  const groupedItems = sortedItineraryItems.reduce((groups, item) => {
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
