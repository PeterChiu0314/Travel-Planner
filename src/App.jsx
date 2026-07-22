import { createContext, Fragment, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  defaultAnimateLayoutChanges,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS as DndCSS } from "@dnd-kit/utilities";
import {
  BadgeInfo,
  Bed,
  BusFront,
  CarFront,
  CarTaxiFront,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardCheck,
  CircleEllipsis,
  ExternalLink,
  Files,
  Footprints,
  HandCoins,
  LayoutDashboard,
  LayoutList,
  Lock,
  LockOpen,
  LogIn,
  LogOut,
  Luggage,
  Map as MapIcon,
  MapPin,
  MapPinPen,
  MessageCircleWarning,
  Navigation,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  Pencil,
  Plane,
  Plus,
  Repeat2,
  Search,
  Settings,
  Ship,
  Trash2,
  TrainFront,
  TramFront,
  Wallet,
  X,
} from "lucide-react";
import { clearDraft, findLatestDraftTrip, getDraftKey, loadLatestDraftForEntity, useDraftAutosave } from "./lib/draftAutosave.js";
import {
  hasTimedDragOrderChange,
  isSamePackageOrder,
  planDestinationPackageReorder,
} from "./lib/destinationPackages.js";
import { acquireEditLock, isLockedByAnotherUser, releaseEditLock } from "./lib/editLocks.js";
import { resolveGoogleMapsShortUrl } from "./lib/googleMapsShortLinkResolver.js";
import { buildGoogleMapsDirectionsUrl, travelModeForTransportCategory } from "./lib/googleMapsNavigation.js";
import { countMissingMapPoints, hasValidMapPoint, normalizeMapPointFields, resolveDestinationMapUrlPoint } from "./lib/mapPoint.js";
import { hasSupabaseConfig, supabase } from "./lib/supabase.js";
import { planTimelineAutoContinuation } from "./lib/timelineAutoContinuation.js";
import { findBrokenTransportationPair } from "./lib/timelineTransportationConflicts.js";
import {
  isEstablishedTransportPair,
  isTailPendingTransport,
  isTailPromotedTransportPair,
  isTransportationCard,
  normalizeTransportRole,
  transportRoleForPayload,
  transportRoles,
} from "./lib/timelineTransportationRoles.js";
import { buildRoutePanelStops, getFocusedMapState } from "./lib/timelineMapMarkers.js";
import { timelineTypeColors } from "./lib/timelineTypeStyles.js";
import {
  normalizeRouteOverridePoints,
  routeOverridePointsEqual,
  routeOverrideSegmentKey,
  routeOverridesToSegmentMap,
  validRouteSegmentKeysFromItems,
} from "./lib/routeOverrides.js";
import MapPanel from "./components/map/MapPanel.jsx";
import { roundMinutesUpToStep } from "./lib/timelineTime.js";
import {
  buildTimelineVisitDisplayOrder,
  isTimedVisit,
  isUntimedVisit,
  planMixedTimedVisitReorder,
  planTailPendingPromotionUntimedBypass,
  planTimelineTimingChangeSortOrders,
  planUntimedVisitReorder,
  untimedOrderingErrorMessage,
} from "./lib/timelineUntimedOrdering.js";
import kyotoDemoTrip from "./demo-kyoto-trip.json";

const attachmentBucket = "trip-attachments";
const appVersion = "0.1.0";
const TimelineDragHandleContext = createContext(null);
const timelineDragPresenceHeartbeatMs = 3000;
const timelineDragPresenceStaleMs = 12000;
const routeEditPresenceHeartbeatMs = 32000;
const routeEditPresenceStaleMs = 70000;
const routeEditNodeLockStaleMs = 12000;
const timelineDragPresenceMaxMs = 75000;
const timelineDragPresenceRefreshMs = 1000;
const routeEditBroadcastThrottleMs = 120;
const timelineCardSelectionStaleMs = 30000;
const tripPresenceHeartbeatMs = 28000;
const tripPresenceStaleMs = 55000;
const tripPresenceRecoverableStatuses = new Set(["CLOSED", "CHANNEL_ERROR", "TIMED_OUT"]);
const timelineCardSelectionColors = {
  blue: "#2f6df6",
  purple: "#7c4dff",
  orange: "#e57a1f",
  pink: "#d94d8c",
  cyan: "#1598b7",
  yellow: "#c99a00",
};
const timelineCardSelectionColorKeys = Object.keys(timelineCardSelectionColors);

const tripPresencePageLabels = {
  accommodation: "Accommodation",
  budget: "Budget",
  overview: "Overview",
  packing: "Packing",
  settings: "Settings",
  settlement: "Settlement",
  timeline: "Timeline",
  todo: "Todo",
};

const tripPresencePageToSection = {
  accommodation: "accommodation",
  budget: "budget",
  overview: "today",
  packing: "luggage",
  settings: "settings",
  settlement: "settlement",
  timeline: "timeline",
  todo: "todo",
};

function BodyPortal({ children }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

function timelineDragPresenceDebugEnabled() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("debugPresence") === "1";
}

function timelineDragPresenceDebug(label, details) {
  if (!timelineDragPresenceDebugEnabled()) return;
  console.info(`[drag-presence] ${label}`, details);
}

function tripPresenceDebug(label, details) {
  if (!timelineDragPresenceDebugEnabled()) return;
  console.info(`[trip-presence] ${label}`, details);
}

function routeEditCollaborationDebugEnabled() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("debugRouteCollab") === "1";
}

function routeEditCollaborationDebug(label, details) {
  if (!routeEditCollaborationDebugEnabled()) return;
  console.info(`[route-edit-collab] ${label}`, details);
}

function routeEditCollaborationChannelSummary(channel, ready, status, metadata = null) {
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

function timelineDragPresenceDebugPayload(payload) {
  if (!payload) return null;
  return {
    userId: payload.userId,
    userName: payload.userName,
    sessionId: payload.sessionId,
    dragId: payload.dragId,
    tripId: payload.tripId,
    dayIndex: payload.dayIndex,
    itemId: payload.itemId,
    itemTitle: payload.itemTitle,
    startedAt: payload.startedAt,
    lastSeenAt: payload.lastSeenAt,
    sentAt: payload.sentAt,
    clearReason: payload.clearReason,
    overItemId: payload.overItemId,
    placement: payload.placement,
  };
}

function timelineCardSelectionColorKey(seed = "") {
  const source = String(seed || "");
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return timelineCardSelectionColorKeys[hash % timelineCardSelectionColorKeys.length] || "blue";
}

// Phase 4.8's remote visuals must use one stable color per user. A session
// is only a fallback for unauthenticated or legacy payloads that lack userId.
function timelineCollaboratorColorKey(userId, sessionId) {
  return timelineCardSelectionColorKey(userId || sessionId);
}

function timelineCardSelectionColor(colorKey) {
  return timelineCardSelectionColors[colorKey] || timelineCardSelectionColors.blue;
}

function tripPresencePageKey(section) {
  if (section === "today") return "overview";
  if (section === "luggage") return "packing";
  return tripPresencePageLabels[section] ? section : "";
}

function tripPresencePageLabel(payload) {
  const pageLabel = tripPresencePageLabels[payload?.pageKey] || payload?.pageKey || "Unknown";
  if (payload?.pageKey === "timeline" && Number.isInteger(Number(payload.dayIndex))) {
    return `${pageLabel} · Day ${Number(payload.dayIndex) + 1}`;
  }
  return pageLabel;
}

function tripPresenceDebugPayload(payload) {
  if (!payload) return null;
  return {
    tripId: payload.tripId,
    userId: payload.userId,
    userName: payload.userName,
    sessionId: payload.sessionId,
    colorKey: payload.colorKey,
    pageKey: payload.pageKey,
    dayIndex: payload.dayIndex,
    selectedItemId: payload.selectedItemId,
    selectedItemType: payload.selectedItemType,
    selectedItemTitle: payload.selectedItemTitle,
    updatedAt: payload.updatedAt,
  };
}

function timelineCardSelectionDebugPayload(payload) {
  if (!payload) return null;
  return {
    tripId: payload.tripId,
    dayIndex: payload.dayIndex,
    itemId: payload.itemId,
    itemType: payload.itemType,
    itemTitle: payload.itemTitle,
    userId: payload.userId,
    userName: payload.userName,
    sessionId: payload.sessionId,
    colorKey: payload.colorKey,
    selectedAt: payload.selectedAt,
    sentAt: payload.sentAt,
  };
}

function timelineDragPresenceDebugState(state) {
  return Object.fromEntries(
    Object.entries(state || {}).map(([key, payloads]) => [
      key,
      (payloads || []).map((payload) => timelineDragPresenceDebugPayload(payload)),
    ]),
  );
}

function timelineDragPresenceChannelSummary(channel, ready, status) {
  return {
    ready: Boolean(ready),
    status: status || "",
    channelState: channel?.state || channel?._state || "",
    joinedOnce: Boolean(channel?.joinedOnce),
    topic: channel?.topic || "",
  };
}

function timelineDragPresenceBasePayload(payload) {
  if (!payload) return null;
  return {
    userId: payload.userId,
    userName: payload.userName,
    sessionId: payload.sessionId,
    dragId: payload.dragId,
    tripId: payload.tripId,
    dayIndex: payload.dayIndex,
    itemId: payload.itemId,
    itemTitle: payload.itemTitle,
    startedAt: payload.startedAt,
  };
}

function trackTimelineDragPresence(channel, payload, label) {
  if (!channel || !payload) return;
  const presencePayload = timelineDragPresenceBasePayload(payload);
  timelineDragPresenceDebug(label, timelineDragPresenceDebugPayload(presencePayload));
  Promise.resolve(channel.track(presencePayload))
    .then((result) => {
      if (result && result !== "ok") {
        timelineDragPresenceDebug("track error", { result, payload: timelineDragPresenceDebugPayload(presencePayload) });
      }
    })
    .catch((error) => {
      timelineDragPresenceDebug("track error", {
        message: error?.message || String(error),
        payload: timelineDragPresenceDebugPayload(presencePayload),
      });
    });
}

function broadcastTimelineDragPresence(channel, event, payload, label) {
  if (!channel || !payload) return;
  timelineDragPresenceDebug(label, timelineDragPresenceDebugPayload(payload));
  Promise.resolve(channel.send({ type: "broadcast", event, payload }))
    .then((result) => {
      if (result && result !== "ok") {
        timelineDragPresenceDebug("broadcast error", {
          event,
          result,
          payload: timelineDragPresenceDebugPayload(payload),
        });
      }
    })
    .catch((error) => {
      timelineDragPresenceDebug("broadcast error", {
        event,
        message: error?.message || String(error),
        payload: timelineDragPresenceDebugPayload(payload),
      });
    });
}

function timelineAnimateLayoutChanges(args) {
  return args.isSorting ? defaultAnimateLayoutChanges(args) : false;
}

const desktopNavItems = [
  { id: "today", label: "旅程總覽", shortLabel: "覽" },
  { id: "timeline", label: "行程路線", shortLabel: "程" },
  { id: "budget", label: "預算管理", shortLabel: "錢" },
  { id: "accommodation", label: "住宿資訊", shortLabel: "宿" },
  { id: "todo", label: "待辦指南", shortLabel: "辦" },
  { id: "luggage", label: "行李清單", shortLabel: "李" },
  { id: "settlement", label: "分帳結算", shortLabel: "結" },
];

const desktopNavIcons = {
  accommodation: Bed,
  budget: Wallet,
  luggage: Luggage,
  settlement: HandCoins,
  timeline: MapIcon,
  today: LayoutDashboard,
  todo: ClipboardCheck,
};

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

const typeColors = timelineTypeColors;

const transportCategories = [
  { value: "jr", label: "JR", icon: TrainFront },
  { value: "train", label: "電車", icon: TramFront },
  { value: "bus", label: "公車", icon: BusFront },
  { value: "walk", label: "步行", icon: Footprints },
  { value: "drive", label: "自駕", icon: CarFront },
  { value: "taxi", label: "計程車", icon: CarTaxiFront },
  { value: "ferry", label: "渡輪", icon: Ship },
  { value: "flight", label: "飛機", icon: Plane },
  { value: "other", label: "其他", icon: CircleEllipsis },
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
  latitude: null,
  longitude: null,
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
  alternative_id: null,
  alternative_draft: null,
  alternative_deleted: false,
  alternative_map_url_baseline: "",
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

function normalizeTimelineTimeInput(value) {
  const text = String(value || "").trim();
  if (!text) return { ok: true, value: "" };
  const compact = text.replace(/\s+/g, "");
  let hours;
  let minutes;
  if (/^\d{1,2}:\d{1,2}$/.test(compact)) {
    [hours, minutes] = compact.split(":").map(Number);
  } else if (/^\d{3,4}$/.test(compact)) {
    hours = Number(compact.slice(0, -2));
    minutes = Number(compact.slice(-2));
  } else {
    return { ok: false, value: text };
  }
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return { ok: false, value: text };
  }
  const rounded = ((hours * 60 + Math.round(minutes / 5) * 5) % (24 * 60) + 24 * 60) % (24 * 60);
  return { ok: true, value: minutesToTimeValue(rounded) };
}

function wrapTimelineMinutes(totalMinutes) {
  return ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
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
const defaultVisitDurationMinutes = 60;

function buildDurationOptions(maxMinutes = 24 * 60 - 5, stepMinutes = 5) {
  const safeMaximum = Math.floor(Number(maxMinutes) / stepMinutes) * stepMinutes;
  const options = [];
  for (let minutes = stepMinutes; minutes <= safeMaximum; minutes += stepMinutes) options.push(minutes);
  return options;
}

function OutlinedField({ children, className = "", fieldRef = null, invalid = false, label, ...fieldsetProps }) {
  return (
    <fieldset
      {...fieldsetProps}
      className={`outlined-field${className ? ` ${className}` : ""}${invalid ? " invalid" : ""}`}
      ref={fieldRef}
    >
      <legend>{label}</legend>
      <div className="outlined-field-control">{children}</div>
    </fieldset>
  );
}

function FloatingOutlinedField({ children, className = "", label }) {
  return (
    <div className={`floating-outlined-field${className ? ` ${className}` : ""}`}>
      {children}
      <span aria-hidden="true" className="floating-outlined-label">{label}</span>
    </div>
  );
}

function AutoGrowingTextarea({ value, ...textareaProps }) {
  const textareaRef = useRef(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const textareaStyle = window.getComputedStyle(textarea);
    const minimumHeight = Number.parseFloat(textareaStyle.minHeight) || 60;
    const maximumHeight = Number.parseFloat(textareaStyle.maxHeight) || 118;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, minimumHeight), maximumHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maximumHeight ? "auto" : "hidden";
  }, [value]);

  return <textarea {...textareaProps} ref={textareaRef} value={value} />;
}

function OutlinedMenuField({ className = "", label, listboxLabel, name, onValueChange, options, required = false, value }) {
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    if (!isMenuOpen) return undefined;
    window.requestAnimationFrame(() => menuRef.current?.querySelector(".selected")?.scrollIntoView({ block: "nearest" }));
    const closeMenu = (event) => {
      if (!rootRef.current?.contains(event.target)) setIsMenuOpen(false);
    };
    const closeMenuWithKeyboard = (event) => {
      if (event.key === "Escape") setIsMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeMenu, true);
    document.addEventListener("keydown", closeMenuWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeMenu, true);
      document.removeEventListener("keydown", closeMenuWithKeyboard);
    };
  }, [isMenuOpen]);

  return (
    <OutlinedField
      className={`outlined-menu-field${className ? ` ${className}` : ""}${isMenuOpen ? " menu-open" : ""}`}
      fieldRef={rootRef}
      label={label}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsMenuOpen(false);
      }}
    >
      <input name={name} required={required} type="hidden" value={value} />
      <button
        aria-expanded={isMenuOpen}
        aria-haspopup="listbox"
        aria-label={label}
        aria-required={required || undefined}
        className="timeline-type-select-trigger"
        role="combobox"
        type="button"
        onClick={() => setIsMenuOpen((current) => !current)}
      >
        <span className="timeline-type-select-value">
          {options.find((option) => option.value === value)?.label || options[0]?.label}
        </span>
        <span className="timeline-time-menu-toggle" aria-hidden="true">
          <ChevronDown />
        </span>
      </button>
      {isMenuOpen ? (
        <div className="timeline-time-menu timeline-type-menu" ref={menuRef} role="listbox" aria-label={listboxLabel}>
          {options.map((option) => (
            <button
              aria-selected={option.value === value}
              className={option.value === value ? "selected" : ""}
              key={option.value}
              role="option"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onValueChange(option.value);
                setIsMenuOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </OutlinedField>
  );
}

function TimelineTypeField({ onValueChange, value }) {
  return (
    <OutlinedMenuField
      className="visit-type-field"
      label="類型"
      listboxLabel="類型選項"
      name="type"
      onValueChange={onValueChange}
      options={Object.entries(typeLabels).map(([optionValue, label]) => ({ label, value: optionValue }))}
      value={value}
    />
  );
}

function TransportCategoryField({ onValueChange, value }) {
  return (
    <OutlinedMenuField
      className="transport-category-field"
      label="交通類別"
      listboxLabel="交通類別選項"
      name="transport_category"
      onValueChange={onValueChange}
      options={transportCategories}
      required
      value={value}
    />
  );
}

function TimelineSegmentedTimeField({ disabled = false, label, name, onValueChange, value }) {
  const initialSegments = String(value || "").split(":");
  const rootRef = useRef(null);
  const hourRef = useRef(null);
  const minuteRef = useRef(null);
  const menuRef = useRef(null);
  const draftRef = useRef({ hour: initialSegments[0] || "", minute: initialSegments[1] || "" });
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [draftHour, setDraftHour] = useState(initialSegments[0] || "");
  const [draftMinute, setDraftMinute] = useState(initialSegments[1] || "");

  useLayoutEffect(() => {
    const [hour = "", minute = ""] = String(value || "").split(":");
    draftRef.current = { hour, minute };
    setDraftHour(hour);
    setDraftMinute(minute);
  }, [value]);

  useEffect(() => {
    if (!isMenuOpen) return undefined;
    window.requestAnimationFrame(() => menuRef.current?.querySelector(".selected")?.scrollIntoView({ block: "center" }));
    const closeMenu = (event) => {
      if (!rootRef.current?.contains(event.target)) setIsMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeMenu);
    return () => document.removeEventListener("pointerdown", closeMenu);
  }, [isMenuOpen]);

  function commitDraft(hour = draftRef.current.hour, minute = draftRef.current.minute) {
    if (!hour && !minute) {
      onValueChange("");
      return;
    }
    const normalized = normalizeTimelineTimeInput(`${hour || "0"}:${minute || "0"}`);
    if (normalized.ok) onValueChange(normalized.value);
    else {
      const [currentHour = "", currentMinute = ""] = String(value || "").split(":");
      setDraftHour(currentHour);
      setDraftMinute(currentMinute);
    }
  }

  function adjustSegment(segment, direction) {
    const current = timeToMinutes(value || `${draftHour || "0"}:${draftMinute || "0"}`);
    const nextValue = minutesToTimeValue(wrapTimelineMinutes((current ?? 0) + direction * (segment === "hour" ? 60 : 5)));
    onValueChange(nextValue);
  }

  function handleSegmentKeyDown(event, segment) {
    if (event.key === "ArrowDown" && event.altKey) {
      event.preventDefault();
      setIsMenuOpen(true);
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      adjustSegment(segment, event.key === "ArrowUp" ? 1 : -1);
    } else if (event.key === "ArrowRight" && segment === "hour") {
      event.preventDefault();
      minuteRef.current?.focus();
      minuteRef.current?.select();
    } else if (event.key === "ArrowLeft" && segment === "minute") {
      event.preventDefault();
      hourRef.current?.focus();
      hourRef.current?.select();
    }
  }

  function handleWholeTimePaste(event) {
    const normalized = normalizeTimelineTimeInput(event.clipboardData.getData("text"));
    if (!normalized.ok || !normalized.value) return;
    event.preventDefault();
    onValueChange(normalized.value);
  }

  useEffect(() => {
    const bindings = [
      [hourRef.current, (event) => { event.preventDefault(); adjustSegment("hour", event.deltaY < 0 ? 1 : -1); }],
      [minuteRef.current, (event) => { event.preventDefault(); adjustSegment("minute", event.deltaY < 0 ? 1 : -1); }],
    ].filter(([element]) => Boolean(element));
    bindings.forEach(([element, handler]) => element.addEventListener("wheel", handler, { passive: false }));
    return () => bindings.forEach(([element, handler]) => element.removeEventListener("wheel", handler));
  });

  return (
    <OutlinedField
      className={`visit-time-field timeline-segmented-time-field${isMenuOpen ? " menu-open" : ""}`}
      data-name={name}
      fieldRef={rootRef}
      label={label}
    >
        <input name={name} type="hidden" value={value || ""} />
        <div className="timeline-time-segments" role="group" aria-label={`${label}時間`}>
          <input
            aria-label={`${label}小時`}
            className="timeline-time-segment hour"
            disabled={disabled}
            inputMode="numeric"
            maxLength="2"
            placeholder="時"
            ref={hourRef}
            value={draftHour}
            onBlur={(event) => { if (!rootRef.current?.contains(event.relatedTarget)) commitDraft(); }}
            onChange={(event) => {
              const next = event.target.value.replace(/\D/g, "").slice(0, 2);
              draftRef.current.hour = next;
              setDraftHour(next);
            }}
            onClick={(event) => event.currentTarget.select()}
            onKeyDown={(event) => handleSegmentKeyDown(event, "hour")}
            onPaste={handleWholeTimePaste}
          />
          <span className="timeline-time-separator" aria-hidden="true">:</span>
          <input
            aria-label={`${label}分鐘`}
            className="timeline-time-segment minute"
            disabled={disabled}
            inputMode="numeric"
            maxLength="2"
            placeholder="分"
            ref={minuteRef}
            value={draftMinute}
            onBlur={() => commitDraft()}
            onChange={(event) => {
              const next = event.target.value.replace(/\D/g, "").slice(0, 2);
              draftRef.current.minute = next;
              setDraftMinute(next);
            }}
            onClick={(event) => event.currentTarget.select()}
            onKeyDown={(event) => handleSegmentKeyDown(event, "minute")}
            onPaste={handleWholeTimePaste}
          />
        </div>
        <button
          aria-label={`開啟${label}時間選單`}
          aria-expanded={isMenuOpen}
          className="timeline-time-menu-toggle"
          disabled={disabled}
          type="button"
          onClick={() => setIsMenuOpen((current) => !current)}
        >
          <ChevronDown aria-hidden="true" />
        </button>
        {isMenuOpen ? (
          <div className="timeline-time-menu" ref={menuRef} role="listbox" aria-label={`${label}時間選項`}>
            {timelineTimeOptions.map((time) => (
              <button
                aria-selected={time === value}
                className={time === value ? "selected" : ""}
                key={time}
                role="option"
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => { onValueChange(time); setIsMenuOpen(false); }}
              >
                {time}
              </button>
            ))}
          </div>
        ) : null}
    </OutlinedField>
  );
}

function TimelineDurationField({ disabled = false, inputRef, maxMinutes, onCommit, onInputChange, value }) {
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const options = useMemo(() => buildDurationOptions(maxMinutes), [maxMinutes]);
  const selectedMinutes = parseDurationMinutes(value);

  useEffect(() => {
    if (!isMenuOpen) return undefined;
    window.requestAnimationFrame(() => menuRef.current?.querySelector(".selected")?.scrollIntoView({ block: "center" }));
    const closeMenu = (event) => {
      if (!rootRef.current?.contains(event.target)) setIsMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeMenu);
    return () => document.removeEventListener("pointerdown", closeMenu);
  }, [isMenuOpen]);

  return (
    <OutlinedField
      className={`visit-time-field duration${isMenuOpen ? " menu-open" : ""}`}
      fieldRef={rootRef}
      label="停留時間"
    >
      <input
        aria-label="停留時間"
        autoComplete="off"
        disabled={disabled}
        inputMode="numeric"
        name="duration_minutes"
        placeholder="分鐘"
        ref={inputRef}
        value={value}
        onBlur={(event) => onCommit(event.target.value)}
        onChange={(event) => onInputChange(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
      />
      <button
        aria-label="開啟停留時間選單"
        aria-expanded={isMenuOpen}
        className="timeline-time-menu-toggle"
        disabled={disabled}
        type="button"
        onClick={() => setIsMenuOpen((current) => !current)}
      >
        <ChevronDown aria-hidden="true" />
      </button>
      {isMenuOpen ? (
        <div className="timeline-time-menu duration-menu" ref={menuRef} role="listbox" aria-label="停留時間選項">
          {options.map((minutes) => {
            const label = formatDurationMinutes(minutes);
            return (
              <button
                aria-selected={minutes === selectedMinutes || label === value}
                className={minutes === selectedMinutes || label === value ? "selected" : ""}
                key={minutes}
                role="option"
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => { onCommit(label); setIsMenuOpen(false); }}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : null}
    </OutlinedField>
  );
}

function TransportDurationField({ onValueChange, value }) {
  const inputRef = useRef(null);
  const [isEditing, setIsEditing] = useState(false);
  const rawValue = String(value ?? "");
  const displayValue = isEditing ? rawValue : formatTransportDurationMinutes(rawValue);

  function adjustDuration(step, showNaturalFormat = false) {
    const current = Number(rawValue);
    const baseMinutes = Number.isInteger(current) && current > 0 ? current : 0;
    setIsEditing(!showNaturalFormat);
    onValueChange(String(Math.max(1, baseMinutes + step)));
  }

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return undefined;
    const handleWheel = (event) => {
      event.preventDefault();
      adjustDuration(event.deltaY < 0 ? 5 : -5, true);
    };
    input.addEventListener("wheel", handleWheel, { passive: false });
    return () => input.removeEventListener("wheel", handleWheel);
  }, [rawValue, onValueChange]);

  return (
    <OutlinedField className="transport-duration-field" label="交通時間">
      <input
        aria-label="交通時間"
        autoComplete="off"
        inputMode="numeric"
        name="transport_duration_minutes"
        placeholder="分鐘"
        ref={inputRef}
        required
        value={displayValue}
        onBlur={() => setIsEditing(false)}
        onChange={(event) => {
          setIsEditing(true);
          onValueChange(event.target.value.replace(/\D/g, ""));
        }}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          adjustDuration(event.key === "ArrowUp" ? 5 : -5);
        }}
      />
    </OutlinedField>
  );
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

function googleMapsPointUrl(latitude, longitude) {
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}

function transportCategoryMeta(category) {
  return transportCategories.find((item) => item.value === category) || transportCategories[transportCategories.length - 1];
}

function TransportCategoryIcon({ category }) {
  const Icon = transportCategoryMeta(category).icon;
  return <Icon aria-hidden="true" />;
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

function formatTransportDurationMinutes(value) {
  const minutes = Number(value || 0);
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (!hours) return `${remainingMinutes} 分鐘`;
  if (!remainingMinutes) return `${hours} 小時`;
  return `${hours} 小時 ${remainingMinutes} 分鐘`;
}

function parseDurationMinutes(value) {
  const text = String(value || "").trim();
  const hourMatch = text.match(/(\d+)\s*小時/);
  const minuteMatch = text.match(/(\d+)\s*分鐘/);
  return /^\d+$/.test(text)
    ? Number(text)
    : Number(hourMatch?.[1] || 0) * 60 + Number(minuteMatch?.[1] || 0);
}

function transportNameValue(item) {
  const explicitName = String(item?.transport_name || "").trim();
  if (explicitName) return explicitName;
  const legacyTitle = String(item?.title || "").trim();
  const categoryLabel = transportCategoryMeta(item?.transport_category).label;
  return legacyTitle && legacyTitle !== categoryLabel ? legacyTitle : "";
}

function transportCardTitle(item) {
  const name = transportNameValue(item) || transportCategoryMeta(item?.transport_category).label;
  const duration = formatTransportDurationMinutes(item?.transport_duration_minutes);
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
    const timeSort = (isTimedVisit(a) ? a.start_time : "99:99").localeCompare(isTimedVisit(b) ? b.start_time : "99:99");
    const orderSort = Number(a.sort_order || 0) - Number(b.sort_order || 0);
    return timeSort || orderSort;
  });
}

function sortedVisitItems(items) {
  return buildTimelineVisitDisplayOrder(items);
}

function lastTimedVisit(items) {
  return [...sortedVisitItems(items)].reverse().find(isTimedVisit) || null;
}

function tailTransportContext(items) {
  const fromItem = lastTimedVisit(items);
  if (!fromItem) return { fromItem: null, transportItem: null };
  const transportItem =
    items.find(
      (item) =>
        isTransportationCard(item) &&
        isTailPendingTransport(item) &&
        item.from_item_id === fromItem.id &&
        !item.to_item_id,
    ) || null;
  return { fromItem, transportItem };
}

function suggestedStartTimeFromTailTransport(items) {
  const { fromItem, transportItem } = tailTransportContext(items);
  if (!fromItem?.end_time || !transportItem) return "";
  const previousEnd = timeToMinutes(fromItem.end_time);
  const durationMinutes = Number(transportItem.transport_duration_minutes || 0);
  if (previousEnd === null || !Number.isFinite(durationMinutes) || durationMinutes < 0) return "";
  return minutesToTimeValue(roundMinutesUpToStep(previousEnd + durationMinutes, 5));
}

function suggestedStartTimeForUntimedAfterTailTransport(items, targetItem) {
  if (!targetItem || isTransportationCard(targetItem) || isTimedVisit(targetItem)) return "";
  const visits = sortedVisitItems(items);
  const targetIndex = visits.findIndex((item) => item.id === targetItem.id);
  const previousVisit = targetIndex > 0 ? visits[targetIndex - 1] : null;
  if (!isTimedVisit(previousVisit)) return "";
  const tailTransport = items.find(
    (item) =>
      isTransportationCard(item) &&
      isTailPendingTransport(item) &&
      item.from_item_id === previousVisit.id &&
      !item.to_item_id,
  );
  if (!previousVisit.end_time || !tailTransport) return "";
  const previousEnd = timeToMinutes(previousVisit.end_time);
  const durationMinutes = Number(tailTransport.transport_duration_minutes || 0);
  if (previousEnd === null || !Number.isFinite(durationMinutes) || durationMinutes < 0) return "";
  return minutesToTimeValue(roundMinutesUpToStep(previousEnd + durationMinutes, 5));
}

function destinationReorderErrorMessage(error) {
  const message = String(error?.message || "");
  if (message.includes("fixed_segment_no_space")) return "此區段沒有可插入的時間空間，請先調整固定行程，或改放到其他位置。";
  if (message.includes("permission_denied")) return "你沒有重排行程的權限。";
  if (message.includes("invalid_day") || message.includes("different_trip_or_day")) return "只能重排同一天的有時間行程。";
  if (message.includes("invalid_manifest") || message.includes("duplicate_item") || message.includes("manifest_not_permutation")) {
    return "重排資料不完整，請重新整理後再試。";
  }
  if (message.includes("timed_visit_required")) return "只有同一天的有時間景點可參與重排。";
  if (message.includes("fixed_item")) return "當天包含固定行程，無法進行插入式重排。";
  if (message.includes("item_locked")) return "當天其中一個行程目前正由其他成員編輯。";
  if (message.includes("transport_state_changed")) return "交通資訊已被其他成員更新，請重新整理後再試。";
  if (message.includes("stale_item") || message.includes("stale_manifest")) return "行程內容已變更，請重新整理後再試。";
  return message || "目的地內容重排失敗，請稍後再試。";
}

function isEffectiveFixedVisit(item) {
  return Boolean(item?.is_fixed) && isTimedVisit(item);
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
    .filter((item) => isTransportationCard(item) && isEstablishedTransportPair(item) && item.from_item_id && item.to_item_id)
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
  const passiveUntimedTransportByFrom = {};
  const tailTransportByFrom = {};
  const invalidTransportItems = [];
  const visitById = new Map(visits.map((item) => [item.id, item]));
  const finalTimedVisit = [...visits].reverse().find(isTimedVisit) || null;
  const visitIndexById = new Map(visits.map((item, index) => [item.id, index]));
  items
    .filter((item) => isTransportationCard(item))
    .forEach((item) => {
      const role = normalizeTransportRole(item);
      const hasPair = isEstablishedTransportPair(item) && item.from_item_id && item.to_item_id;
      const isTail = role === transportRoles.tailPending && item.from_item_id && !item.to_item_id;
      const pairKey = hasPair ? transportPairKey(item.from_item_id, item.to_item_id) : "";
      const pairExists = hasPair && visitIds.has(item.from_item_id) && visitIds.has(item.to_item_id);
      const pairIsAdjacent = pairExists && adjacentKeys.has(pairKey);
      const fromVisit = visitById.get(item.from_item_id) || null;
      const toVisit = visitById.get(item.to_item_id) || null;
      const hasPassiveUntimedEndpoint =
        Boolean(fromVisit) &&
        ((hasPair && Boolean(toVisit) && (!isTimedVisit(fromVisit) || !isTimedVisit(toVisit))) ||
          (isTail && !isTimedVisit(fromVisit)));

      if (hasPassiveUntimedEndpoint) {
        passiveUntimedTransportByFrom[item.from_item_id] = [
          ...(passiveUntimedTransportByFrom[item.from_item_id] || []),
          item,
        ];
        return;
      }

      if (isTail && isTimedVisit(fromVisit)) {
        const nextVisit = visits[visitIndexById.get(item.from_item_id) + 1] || null;
        if (isUntimedVisit(nextVisit)) {
          passiveUntimedTransportByFrom[item.from_item_id] = [
            ...(passiveUntimedTransportByFrom[item.from_item_id] || []),
            item,
          ];
          return;
        }
      }

      if (isTail && isTimedVisit(fromVisit) && item.from_item_id === finalTimedVisit?.id) {
        if (!tailTransportByFrom[item.from_item_id]) {
          tailTransportByFrom[item.from_item_id] = item;
          return;
        }
      }

      if (pairIsAdjacent) {
        if (!adjacentTransportByPair[pairKey]) adjacentTransportByPair[pairKey] = item;
        return;
      }

      invalidTransportItems.push(item);
    });

  return { adjacentTransportByPair, invalidTransportItems, passiveUntimedTransportByFrom, tailTransportByFrom };
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

function planTransportationRoleUpdatesForTimingChange({ dayIndex, editingId, items = [], normalizedPayload }) {
  if (!editingId || isTransportationCard(normalizedPayload)) return [];
  const editingItem = items.find((item) => item.id === editingId);
  if (!editingItem) return [];
  const dayVisits = items
    .filter((item) => Number(item.day_index) === Number(dayIndex) && !isTransportationCard(item))
    .map((item) => (item.id === editingId ? { ...item, ...normalizedPayload, id: editingId } : item));
  const timedVisits = dayVisits.filter(isTimedVisit).sort((a, b) => {
    const timeSort = String(a.start_time || "").localeCompare(String(b.start_time || ""));
    const orderSort = Number(a.sort_order || 0) - Number(b.sort_order || 0);
    return timeSort || orderSort || String(a.id || "").localeCompare(String(b.id || ""));
  });
  const timedIndexById = new Map(timedVisits.map((item, index) => [item.id, index]));
  const currentById = new Map(items.map((item) => [item.id, item]));
  const updates = [];

  items
    .filter(
      (item) =>
        isTransportationCard(item) &&
        Number(item.day_index) === Number(dayIndex) &&
        (item.from_item_id === editingId ||
          item.to_item_id === editingId ||
          (isTailPendingTransport(item) && !item.to_item_id)),
    )
    .forEach((transportItem) => {
      if (isTailPromotedTransportPair(transportItem) && transportItem.to_item_id === editingId) {
        const fromIndex = timedIndexById.get(transportItem.from_item_id);
        const toIndex = timedIndexById.get(transportItem.to_item_id);
        const fromVisit = timedVisits[fromIndex];
        const toVisit = timedVisits[toIndex];
        const remainsPromoted =
          Number.isInteger(fromIndex) &&
          Number.isInteger(toIndex) &&
          toIndex === fromIndex + 1 &&
          timeToMinutes(toVisit?.start_time) !== null &&
          (timeToMinutes(fromVisit?.end_time) === null || timeToMinutes(toVisit.start_time) >= timeToMinutes(fromVisit.end_time));
        if (!remainsPromoted) {
          updates.push({
            id: transportItem.id,
            original: {
              to_item_id: transportItem.to_item_id || null,
              to_snapshot_start_time: transportItem.to_snapshot_start_time || null,
              to_snapshot_end_time: transportItem.to_snapshot_end_time || null,
              to_snapshot_destination: transportItem.to_snapshot_destination || null,
              transport_role: normalizeTransportRole(transportItem),
              updated_at: transportItem.updated_at || null,
            },
            payload: {
              to_item_id: null,
              to_snapshot_start_time: null,
              to_snapshot_end_time: null,
              to_snapshot_destination: null,
              transport_role: transportRoles.tailPending,
              updated_at: new Date().toISOString(),
            },
            updated_at: transportItem.updated_at || null,
          });
        }
      }

      if (isTailPendingTransport(transportItem) && !transportItem.to_item_id && isTimedVisit(normalizedPayload)) {
        const fromIndex = timedIndexById.get(transportItem.from_item_id);
        const toIndex = timedIndexById.get(editingId);
        const fromVisit = timedVisits[fromIndex];
        const toVisit = timedVisits[toIndex];
        const shouldPromote =
          Number.isInteger(fromIndex) &&
          Number.isInteger(toIndex) &&
          toIndex === fromIndex + 1 &&
          timeToMinutes(toVisit?.start_time) !== null &&
          (timeToMinutes(fromVisit?.end_time) === null || timeToMinutes(toVisit.start_time) >= timeToMinutes(fromVisit.end_time));
        if (shouldPromote) {
          updates.push({
            id: transportItem.id,
            original: {
              to_item_id: transportItem.to_item_id || null,
              to_snapshot_start_time: transportItem.to_snapshot_start_time || null,
              to_snapshot_end_time: transportItem.to_snapshot_end_time || null,
              to_snapshot_destination: transportItem.to_snapshot_destination || null,
              transport_role: normalizeTransportRole(transportItem),
              updated_at: transportItem.updated_at || null,
            },
            payload: {
              to_item_id: editingId,
              transport_role: transportRoles.tailPromotedPair,
              ...buildTransportPairSnapshot(currentById.get(transportItem.from_item_id), toVisit),
              updated_at: new Date().toISOString(),
            },
            updated_at: transportItem.updated_at || null,
          });
        }
      }
    });

  return updates;
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
    weekday: "long",
  }).format(date);
}

function formatDayTabDate(date) {
  return new Intl.DateTimeFormat("zh-TW", {
    month: "numeric",
    day: "numeric",
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
    const hasVerticalScrollbar = board.scrollHeight > board.clientHeight + 1;
    const measuredScrollbarWidth = Math.max(0, board.offsetWidth - board.clientWidth);
    const scrollbarWidth = hasVerticalScrollbar ? Math.max(12, measuredScrollbarWidth) : 0;
    board.closest(".timeline-workbench")?.style.setProperty("--board-scrollbar-width", `${scrollbarWidth}px`);
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
          left: Math.max(0, column.offsetLeft - board.offsetLeft - 340),
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
    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(board);
    updateScrollState();
    return () => {
      board.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
      resizeObserver.disconnect();
    };
  }, [isEnabled, updateScrollState]);

  return { boardRef, scrollByDirection, scrollState, scrollToDay };
}

const timelineMapTransitionMs = 220;

function useTimelineMapTransition() {
  const [isRouteCollapsed, setIsRouteCollapsed] = useState(false);
  const [isMapClosing, setIsMapClosing] = useState(false);
  const closeTimeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) window.clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  const toggleRouteMap = useCallback(() => {
    if (isMapClosing) return;
    if (isRouteCollapsed) {
      setIsRouteCollapsed(false);
      return;
    }

    setIsMapClosing(true);
    const closeDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : timelineMapTransitionMs;
    closeTimeoutRef.current = window.setTimeout(() => {
      setIsRouteCollapsed(true);
      setIsMapClosing(false);
      closeTimeoutRef.current = null;
    }, closeDelay);
  }, [isMapClosing, isRouteCollapsed]);

  const openRouteMap = useCallback(() => {
    if (closeTimeoutRef.current) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setIsMapClosing(false);
    setIsRouteCollapsed(false);
  }, []);

  return {
    isMapClosing,
    isRouteCollapsed,
    isRouteLayoutCollapsed: isRouteCollapsed,
    openRouteMap,
    toggleRouteMap,
  };
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
    if (isEffectiveFixedVisit(item)) counts.fixed += 1;
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
    title: kyotoDemoTrip.title,
    destination: kyotoDemoTrip.destination,
    destination_city: kyotoDemoTrip.destination_city,
    destination_country: kyotoDemoTrip.destination_country,
    start_date: kyotoDemoTrip.start_date,
    end_date: kyotoDemoTrip.end_date,
    updated_at: kyotoDemoTrip.updated_at,
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

function normalizeDemoTime(value) {
  return value ? String(value).slice(0, 5) : "";
}

const demoFixedVisitIds = new Set([
  "1afc6297-cf0d-453f-ae3f-2b4e049508f4",
  "926fe5ee-1973-44bb-ab63-634892943aa6",
]);

function createDemoTransportFixture(items, {
  category = defaultTransportCategory,
  durationMinutes = 20,
  fromId,
  id,
  role = transportRoles.normalPair,
  title,
  toId = null,
}) {
  const fromItem = items.find((item) => item.id === fromId);
  const toItem = toId ? items.find((item) => item.id === toId) : null;
  if (!fromItem || (toId && !toItem)) return null;
  return {
    id,
    trip_id: fromItem.trip_id,
    day_index: fromItem.day_index,
    sort_order: Number(fromItem.sort_order || 0) + 0.5,
    item_type: "transport",
    type: "transport",
    title,
    location: null,
    note: null,
    cost: 0,
    created_by: "demo-peter",
    created_at: "2026-06-30T00:00:00.000Z",
    updated_at: "2026-06-30T00:00:00.000Z",
    date: fromItem.date || null,
    location_name: null,
    address: null,
    map_url: null,
    latitude: null,
    longitude: null,
    description: null,
    transportation_note: null,
    locked_by: null,
    locked_at: null,
    transport_category: category,
    transport_name: title,
    transport_duration_minutes: durationMinutes,
    transport_note: null,
    from_item_id: fromId,
    to_item_id: toId,
    transport_role: role,
    ...buildTransportPairSnapshot(fromItem, toItem),
    is_fixed: false,
    fixed_at: null,
    fixed_by: null,
  };
}

function createDemoTransportFixtures(items) {
  return [
    createDemoTransportFixture(items, {
      category: "car",
      durationMinutes: 20,
      fromId: "92b182ce-302c-469f-907b-14acda01aa1e",
      id: "demo-transport-day3-napoli-kasahara",
      role: transportRoles.normalPair,
      title: "F・20分鐘",
      toId: "8e3cd404-f6fe-4116-829d-5f218613b96d",
    }),
    createDemoTransportFixture(items, {
      category: "car",
      durationMinutes: 25,
      fromId: "1ceb3a41-4633-4dee-9035-7085d0d7b4d2",
      id: "demo-transport-day3-hachiman-tail",
      role: transportRoles.tailPending,
      title: "尾端交通・25分鐘",
    }),
    createDemoTransportFixture(items, {
      category: "train",
      durationMinutes: 15,
      fromId: "a633aa05-d1e7-4027-a046-5674108c6040",
      id: "demo-transport-day2-tail-promoted-yamashina-rest",
      role: transportRoles.tailPromotedPair,
      title: "尾端延伸・15分鐘",
      toId: "3e62a2fc-244b-4774-8b9d-f0f45cf32ac5",
    }),
    createDemoTransportFixture(items, {
      category: "walk",
      durationMinutes: 12,
      fromId: "f3973db2-8a80-444f-8108-7fe00c5c3f2a",
      id: "demo-transport-day4-lunch-school",
      role: transportRoles.normalPair,
      title: "步行・12分鐘",
      toId: "4b9e4e09-b699-45af-9545-79f13f0d522d",
    }),
  ].filter(Boolean);
}

function demoSortOrderForNewTimelineItem({ currentDayVisits = [], item }) {
  if (isTransportationCard(item)) {
    const fromItem = currentDayVisits.find((candidate) => candidate.id === item.from_item_id);
    const toItem = currentDayVisits.find((candidate) => candidate.id === item.to_item_id);
    const fromOrder = Number(fromItem?.sort_order);
    const toOrder = Number(toItem?.sort_order);
    if (Number.isFinite(fromOrder) && Number.isFinite(toOrder) && fromOrder !== toOrder) {
      return (fromOrder + toOrder) / 2;
    }
    if (Number.isFinite(fromOrder)) return fromOrder + 0.5;
  }
  return (currentDayVisits.length + 1) * 10;
}

function createDemoTimelineItems() {
  const baseItems = [
    ...(kyotoDemoTrip.itinerary_items || []),
    {
      id: "demo-untimed-philosophers-path",
      trip_id: "demo-trip-kyoto",
      day_index: 5,
      sort_order: -1_998_500_000,
      item_type: "visit",
      type: "attraction",
      title: "未排時間・哲學之道散步",
      location_name: "哲學之道",
      start_time: null,
      end_time: null,
      description: "可拖曳安排到沒有交通卡連接的時段",
      is_fixed: false,
      updated_at: "2026-06-24T00:00:00.000Z",
    },
  ];
  const demoTransportFixtures = createDemoTransportFixtures(baseItems);
  const demoTransportFixtureIds = new Set(demoTransportFixtures.map((item) => item.id));
  return [
    ...baseItems.filter((item) => !demoTransportFixtureIds.has(item.id)),
    ...demoTransportFixtures,
  ]
    .map((item, index) => ({
      ...item,
      trip_id: "demo-trip-kyoto",
      sort_order: Number.isFinite(Number(item.sort_order)) ? Number(item.sort_order) : index,
      item_type: item.item_type || "visit",
      start_time: normalizeDemoTime(item.start_time),
      end_time: normalizeDemoTime(item.end_time),
      from_snapshot_start_time: normalizeDemoTime(item.from_snapshot_start_time),
      from_snapshot_end_time: normalizeDemoTime(item.from_snapshot_end_time),
      to_snapshot_start_time: normalizeDemoTime(item.to_snapshot_start_time),
      to_snapshot_end_time: normalizeDemoTime(item.to_snapshot_end_time),
      note: item.note || "",
      description: item.description || item.note || "",
      transportation_note: item.transportation_note || item.transport_note || "",
      cost: Number(item.cost || 0),
      transport_category: item.item_type === "transport" ? item.transport_category || defaultTransportCategory : item.transport_category || null,
      transport_name: item.item_type === "transport" ? transportNameValue(item) : item.transport_name || null,
      transport_duration_minutes:
        item.item_type === "transport" && Number.isFinite(Number(item.transport_duration_minutes))
          ? Number(item.transport_duration_minutes)
          : item.item_type === "transport"
            ? null
            : item.transport_duration_minutes || null,
      transport_note: item.item_type === "transport" ? item.transport_note || item.transportation_note || item.description || item.note || "" : item.transport_note || null,
      from_item_id: item.item_type === "transport" ? item.from_item_id || null : item.from_item_id || null,
      to_item_id: item.item_type === "transport" ? item.to_item_id || null : item.to_item_id || null,
      transport_role: item.item_type === "transport" ? normalizeTransportRole({ ...item, item_type: "transport" }) : item.transport_role || null,
      fixed_at: demoFixedVisitIds.has(item.id) ? item.fixed_at || "2026-06-30T00:00:00.000Z" : item.fixed_at || null,
      fixed_by: demoFixedVisitIds.has(item.id) ? item.fixed_by || "demo-peter" : item.fixed_by || null,
      is_fixed: demoFixedVisitIds.has(item.id) || Boolean(item.is_fixed),
      locked_by: null,
      locked_at: null,
    }))
    .sort((a, b) => a.day_index - b.day_index || a.sort_order - b.sort_order || (a.start_time || "").localeCompare(b.start_time || ""));
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
  const [routeOverrides, setRouteOverrides] = useState([]);
  const [routeOverrideSaveError, setRouteOverrideSaveError] = useState("");
  const [routeEditLocalState, setRouteEditLocalState] = useState({ isEditing: false, activeNodeId: null, activeSegmentKey: null });
  const [remoteRouteEditPresences, setRemoteRouteEditPresences] = useState([]);
  const [remoteRouteEditUpdates, setRemoteRouteEditUpdates] = useState({});
  const [remoteRouteEditNodeLocks, setRemoteRouteEditNodeLocks] = useState({});
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
  const routeOverrideLoadTargetRef = useRef({ dayIndex: null, isDemoMode: false, tripId: null });
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

  const navigateToTripPresence = useCallback(
    (presence) => {
      if (!presence || presence.sessionId === timelineDragPresenceSessionIdRef.current || presence.userId === activeUserId) return;
      const section = tripPresencePageToSection[presence.pageKey];
      tripPresenceDebug("avatar click navigation", { payload: tripPresenceDebugPayload(presence), section });
      if (!section) return;
      setActiveSection(section);
      if (presence.pageKey === "timeline" && Number.isInteger(Number(presence.dayIndex))) {
        setActiveDay(Number(presence.dayIndex));
      }
    },
    [activeUserId],
  );

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
      setRouteOverrides([]);
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

  const loadRouteOverrides = useCallback(async (tripId, dayIndex) => {
    const normalizedDayIndex = Number(dayIndex);
    if (!tripId || !Number.isInteger(Number(dayIndex))) {
      setRouteOverrides([]);
      return [];
    }

    const requestedTarget = routeOverrideLoadTargetRef.current;
    if (requestedTarget.tripId !== tripId || requestedTarget.dayIndex !== normalizedDayIndex || requestedTarget.isDemoMode) {
      return [];
    }

    const requestId = ++routeOverrideLoadRequestRef.current;

    const isCurrentRouteOverrideRequest = () => {
      const target = routeOverrideLoadTargetRef.current;
      return requestId === routeOverrideLoadRequestRef.current &&
        target.tripId === tripId && target.dayIndex === normalizedDayIndex && !target.isDemoMode;
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
    routeOverrideLoadTargetRef.current = {
      dayIndex: Number.isInteger(Number(activeDay)) ? Number(activeDay) : null,
      isDemoMode,
      tripId: activeTripId || null,
    };
    if (!activeTripId || isDemoMode) {
      setRouteOverrides([]);
      return;
    }
    void loadRouteOverrides(activeTripId, activeDay);
  }, [activeDay, activeTripId, isDemoMode, loadRouteOverrides]);

  useEffect(() => {
    if (isDemoMode || !activeTripId || !activeUserId || activeMembership?.status !== "approved") {
      routeEditCollaborationDebug("channel skipped", {
        activeTripId: activeTripId || null,
        dayIndex: activeDay,
        reason: isDemoMode ? "demo-mode" : "missing-approved-scope",
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
  }, [activeDay, activeMembership?.status, activeTripId, activeUserId, ensureRouteEditChannelHealth, isDemoMode, loadRouteOverrides, publishRouteEditPresence, requestRouteEditChannelRecovery, routeEditChannelVersion, sendRouteEditBroadcast]);

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
    if (!activeTrip?.id || isDemoMode) {
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
  }, [activeTrip?.id, canEditActiveTripContent, isDemoMode, items]);

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
        { event: "*", schema: "public", table: "itinerary_route_overrides", filter: `trip_id=eq.${activeTripId}` },
        () => loadRouteOverrides(activeTripId, activeDay),
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
  }, [activeDay, activeTripId, loadRouteOverrides, loadTripData, loadTrips, session?.user]);

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
    const destinationPatch = destinationPatchFromParts(
      tripForm.destination_country,
      tripForm.destination_city,
    );
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
      destination_country: "日本",
      destination_city: "京都",
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
    const result = await query.select("id, updated_at").maybeSingle();
    if (result.error) return { ok: false, error: result.error };
    if (!result.data) return { ok: false, conflict: true };
    if (!meta.deferEditLockRelease) {
      await releaseEditLock({ recordId: editingId, supabase, table, userId: session?.user?.id });
    }
    return { ok: true, data: result.data };
  }

  async function deleteBrokenTransportationPair(transportConflict) {
    if (!transportConflict?.id || !transportConflict?.updated_at) {
      return { ok: false, error: { message: "交通卡資料不完整，請重新整理後再試。" } };
    }
    const deleteResult = await supabase
      .from("itinerary_items")
      .delete()
      .eq("id", transportConflict.id)
      .eq("trip_id", activeTrip.id)
      .eq("item_type", "transport")
      .eq("updated_at", transportConflict.updated_at)
      .select("id")
      .maybeSingle();
    if (deleteResult.error) return { ok: false, error: deleteResult.error };
    if (deleteResult.data) return { ok: true };

    const currentTransport = await supabase
      .from("itinerary_items")
      .select("id")
      .eq("id", transportConflict.id)
      .eq("trip_id", activeTrip.id)
      .eq("item_type", "transport")
      .maybeSingle();
    if (currentTransport.error) return { ok: false, error: currentTransport.error };
    if (!currentTransport.data) return { ok: true };
    return { ok: false, error: { message: "這張交通卡已由其他成員更新，請重新整理後再試。" } };
  }

  async function applyItineraryTimeContinuation(updates = []) {
    const applied = [];
    for (const update of updates) {
      const updatePayload = {};
      if (Object.hasOwn(update, "start_time")) updatePayload.start_time = update.start_time;
      if (Object.hasOwn(update, "end_time")) updatePayload.end_time = update.end_time;
      if (Number.isInteger(update.sort_order)) updatePayload.sort_order = update.sort_order;
      const result = await supabase
        .from("itinerary_items")
        .update(updatePayload)
        .eq("id", update.id)
        .eq("trip_id", activeTrip.id)
        .eq("day_index", activeDay)
        .neq("item_type", "transport")
        .eq("is_fixed", false)
        .eq("updated_at", update.updated_at)
        .select("id, updated_at")
        .maybeSingle();
      if (result.error || !result.data) {
        return {
          ok: false,
          applied,
          error: result.error || { message: "後續行程已由其他成員更新，請重新整理後再試。" },
        };
      }
      applied.push({ ...update, applied_updated_at: result.data.updated_at });
    }
    return { ok: true, applied };
  }

  async function rollbackItineraryTimeContinuation(applied = []) {
    let rollbackFailed = false;
    let latestUpdatedAt = null;
    for (const update of [...applied].reverse()) {
      const rollbackPayload = {};
      if (Object.hasOwn(update, "original_start_time")) rollbackPayload.start_time = update.original_start_time;
      if (Object.hasOwn(update, "original_end_time")) rollbackPayload.end_time = update.original_end_time;
      if (Number.isInteger(update.original_sort_order)) rollbackPayload.sort_order = update.original_sort_order;
      const result = await supabase
        .from("itinerary_items")
        .update(rollbackPayload)
        .eq("id", update.id)
        .eq("trip_id", activeTrip.id)
        .eq("day_index", activeDay)
        .eq("updated_at", update.applied_updated_at)
        .select("id, updated_at")
        .maybeSingle();
      if (result.error || !result.data) rollbackFailed = true;
      else latestUpdatedAt = result.data.updated_at;
    }
    return { ok: !rollbackFailed, latestUpdatedAt };
  }

  async function applyTransportationRoleUpdates(updates = []) {
    const applied = [];
    for (const update of updates) {
      const result = await supabase
        .from("itinerary_items")
        .update(update.payload)
        .eq("id", update.id)
        .eq("trip_id", activeTrip.id)
        .eq("day_index", activeDay)
        .eq("item_type", "transport")
        .eq("updated_at", update.updated_at)
        .select("id, updated_at")
        .maybeSingle();
      if (result.error || !result.data) {
        return {
          applied,
          error: result.error || { message: "transport_role_update_conflict" },
          ok: false,
        };
      }
      applied.push({ ...update, applied_updated_at: result.data.updated_at });
    }
    return { applied, ok: true };
  }

  async function rollbackTransportationRoleUpdates(applied = []) {
    let rollbackFailed = false;
    for (const update of [...applied].reverse()) {
      const result = await supabase
        .from("itinerary_items")
        .update({
          to_item_id: update.original.to_item_id,
          to_snapshot_start_time: update.original.to_snapshot_start_time,
          to_snapshot_end_time: update.original.to_snapshot_end_time,
          to_snapshot_destination: update.original.to_snapshot_destination,
          transport_role: update.original.transport_role,
        })
        .eq("id", update.id)
        .eq("trip_id", activeTrip.id)
        .eq("updated_at", update.applied_updated_at)
        .select("id")
        .maybeSingle();
      if (result.error || !result.data) rollbackFailed = true;
    }
    return { ok: !rollbackFailed };
  }

  async function rollbackEditedItineraryItem({ editingId, editingItem, normalizedPayload, updatedAt }) {
    const rollbackPayload = Object.fromEntries(
      Object.keys(normalizedPayload).map((field) => [field, editingItem?.[field] ?? null]),
    );
    const rollback = await supabase
      .from("itinerary_items")
      .update(rollbackPayload)
      .eq("id", editingId)
      .eq("trip_id", activeTrip.id)
      .eq("updated_at", updatedAt)
      .select("id, updated_at")
      .maybeSingle();
    return { ok: !rollback.error && Boolean(rollback.data), data: rollback.data, error: rollback.error };
  }

  async function saveItem(payload, editingId, meta = {}) {
    if (!activeTrip || !canEditActiveTripContent) return;
    if (!isCurrentTripContext(meta)) return rejectCrossTripSave();
    const editingItem = editingId ? items.find((item) => item.id === editingId) : null;
    if (isEffectiveFixedVisit(editingItem)) {
      setNotice("此行程已固定，請先解鎖後再修改。");
      return { ok: false, fixed: true };
    }
    if (editingId && !(await ensureItineraryItemEditable(editingId))) return { ok: false, fixed: true };
    const normalizedPayload = normalizeItemPayload(payload);
    let passiveUntimedPositionUpdates = [];
    if (editingItem && isTimedVisit(editingItem) !== isTimedVisit(normalizedPayload)) {
      const conversionPlan = planTimelineTimingChangeSortOrders({
        items: dayItems,
        replacements: [{ id: editingItem.id, start_time: normalizedPayload.start_time, end_time: normalizedPayload.end_time }],
      });
      if (!conversionPlan.ok) {
        const errorMessage = "目前無法保留這張未設定時間行程的位置，請重新整理後再試。";
        setNotice(errorMessage);
        return { ok: false, errorMessage };
      }
      if (Number.isInteger(conversionPlan.sortOrders[editingItem.id])) {
        normalizedPayload.sort_order = conversionPlan.sortOrders[editingItem.id];
      }
      passiveUntimedPositionUpdates = Object.entries(conversionPlan.sortOrders)
        .filter(([itemId, sortOrder]) => itemId !== editingItem.id && items.find((item) => item.id === itemId)?.sort_order !== sortOrder)
        .map(([itemId, sortOrder]) => {
          const item = items.find((candidate) => candidate.id === itemId);
          return {
            id: itemId,
            original_sort_order: item?.sort_order,
            sort_order: sortOrder,
            updated_at: item?.updated_at || null,
          };
        });
    }
    if (!editingId && isTransportationCard(normalizedPayload) && normalizedPayload.from_item_id && !normalizedPayload.to_item_id) {
      const { fromItem, transportItem } = tailTransportContext(dayItems);
      if (!fromItem || normalizedPayload.from_item_id !== fromItem.id) {
        setNotice("尾端交通只能新增在最後一個有時間行程之後。");
        return { ok: false };
      }
      if (transportItem) {
        setNotice("最後一個行程後方已經有尾端交通資訊。");
        return { ok: false };
      }
    }
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
    const transportConflict = meta.transportConflict || null;
    const autoContinuationUpdates = Array.isArray(meta.autoContinuationUpdates) ? meta.autoContinuationUpdates : [];
    const followUpUpdates = [...autoContinuationUpdates, ...passiveUntimedPositionUpdates];
    const transportationRoleUpdates = planTransportationRoleUpdatesForTimingChange({
      dayIndex: activeDay,
      editingId,
      items,
      normalizedPayload,
    });
    if (editingId) {
      const invalidContinuationItem = followUpUpdates.find((update) => {
        const item = items.find((candidate) => candidate.id === update.id);
        return (
          !item ||
          item.trip_id !== activeTrip.id ||
          Number(item.day_index) !== Number(activeDay) ||
          isTransportationCard(item) ||
          isEffectiveFixedVisit(item) ||
          isLockedByAnotherUser(item, session?.user?.id) ||
          !update.updated_at
        );
      });
      if (invalidContinuationItem) {
        const errorMessage = "後續行程包含固定、鎖定或已變更的資料，無法自動接續時間。";
        setNotice(errorMessage);
        return { ok: false, errorMessage };
      }
      const requiresDeferredCompletion = Boolean(transportConflict) || followUpUpdates.length > 0 || transportationRoleUpdates.length > 0;
      const result = await updateWithConflictCheck("itinerary_items", normalizedPayload, editingId, {
        ...meta,
        deferEditLockRelease: requiresDeferredCompletion,
      });
      if (result.error) setNotice(result.error.message);
      else if (result.conflict) setNotice("此資料在你編輯期間已被其他人更新。");
      else if (requiresDeferredCompletion) {
        const continuationResult = await applyItineraryTimeContinuation(followUpUpdates);
        if (!continuationResult.ok) {
          const continuationRollback = await rollbackItineraryTimeContinuation(continuationResult.applied);
          const editedRollback = await rollbackEditedItineraryItem({
            editingId,
            editingItem,
            normalizedPayload,
            updatedAt: result.data?.updated_at,
          });
          const rollbackSucceeded = continuationRollback.ok && editedRollback.ok;
          const failureLabel = passiveUntimedPositionUpdates.length ? "未設定時間行程位置更新" : "後續行程自動接續";
          const errorMessage = rollbackSucceeded
            ? `${failureLabel}失敗，本次時間變更未儲存：${continuationResult.error.message}`
            : `${failureLabel}失敗，且部分資料無法自動回復：${continuationResult.error.message}`;
          setNotice(errorMessage);
          return {
            ok: false,
            error: continuationResult.error,
            errorMessage,
            baseUpdatedAt: editedRollback.data?.updated_at || result.data?.updated_at || null,
            rollbackFailed: !rollbackSucceeded,
          };
        }
        const roleUpdateResult = await applyTransportationRoleUpdates(transportationRoleUpdates);
        if (!roleUpdateResult.ok) {
          const continuationRollback = await rollbackItineraryTimeContinuation(continuationResult.applied);
          const roleRollback = await rollbackTransportationRoleUpdates(roleUpdateResult.applied);
          const editedRollback = await rollbackEditedItineraryItem({
            editingId,
            editingItem,
            normalizedPayload,
            updatedAt: result.data?.updated_at,
          });
          const rollbackSucceeded = continuationRollback.ok && roleRollback.ok && editedRollback.ok;
          const errorMessage = rollbackSucceeded
            ? `transport role update failed and itinerary change was rolled back: ${roleUpdateResult.error.message}`
            : `transport role update failed and rollback needs review: ${roleUpdateResult.error.message}`;
          setNotice(errorMessage);
          return {
            ok: false,
            error: roleUpdateResult.error,
            errorMessage,
            baseUpdatedAt: editedRollback.data?.updated_at || result.data?.updated_at || null,
            rollbackFailed: !rollbackSucceeded,
          };
        }
        if (transportConflict) {
          const transportDelete = await deleteBrokenTransportationPair(transportConflict);
          if (!transportDelete.ok) {
            const continuationRollback = await rollbackItineraryTimeContinuation(continuationResult.applied);
            const roleRollback = await rollbackTransportationRoleUpdates(roleUpdateResult.applied);
            const editedRollback = await rollbackEditedItineraryItem({
              editingId,
              editingItem,
              normalizedPayload,
              updatedAt: result.data?.updated_at,
            });
            const rollbackSucceeded = continuationRollback.ok && roleRollback.ok && editedRollback.ok;
            const errorMessage = rollbackSucceeded
              ? `交通卡刪除失敗，行程變更未儲存：${transportDelete.error.message}`
              : `交通卡刪除失敗，且部分行程時間無法自動回復：${transportDelete.error.message}`;
            setNotice(errorMessage);
            return {
              ok: false,
              error: transportDelete.error,
              errorMessage,
              baseUpdatedAt: editedRollback.data?.updated_at || result.data?.updated_at || null,
              rollbackFailed: !rollbackSucceeded,
            };
          }
        }
        await releaseEditLock({
          recordId: editingId,
          supabase,
          table: "itinerary_items",
          userId: session?.user?.id,
        });
        await loadTripData(activeTrip.id);
      } else await loadTripData(activeTrip.id);
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
      setNotice(insertResult.error.message);
      return { ok: false, error: insertResult.error };
    }

    if (transportConflict) {
      const transportDelete = await deleteBrokenTransportationPair(transportConflict);
      if (!transportDelete.ok) {
        const rollback = await supabase
          .from("itinerary_items")
          .delete()
          .eq("id", insertResult.data.id)
          .eq("trip_id", activeTrip.id);
        const errorMessage = rollback.error
          ? `交通卡刪除失敗，且新增行程無法回復：${transportDelete.error.message}`
          : `交通卡刪除失敗，新增行程未儲存：${transportDelete.error.message}`;
        setNotice(errorMessage);
        await loadTripData(activeTrip.id);
        return { ok: false, error: transportDelete.error, errorMessage, rollbackFailed: Boolean(rollback.error) };
      }
    }

    const { fromItem: tailFromItem, transportItem: tailTransportItem } = tailTransportContext(dayItems);
    const newVisitStart = timeToMinutes(insertResult.data?.start_time);
    const tailFromEnd = timeToMinutes(tailFromItem?.end_time);
    const shouldCompleteTailPair =
      !isTransportationCard(insertResult.data) &&
      tailTransportItem &&
      newVisitStart !== null &&
      (tailFromEnd === null || newVisitStart >= tailFromEnd);
    const tailBypassPlan = shouldCompleteTailPair
      ? planTailPendingPromotionUntimedBypass({
          items: [...dayItems, insertResult.data],
          promotedFromItemId: tailFromItem.id,
          promotedToItemId: insertResult.data.id,
          tailTransportItem,
        })
      : { ok: true, untimedSortOrderUpdates: [] };
    if (!tailBypassPlan.ok) {
      const rollback = await supabase
        .from("itinerary_items")
        .delete()
        .eq("id", insertResult.data.id)
        .eq("trip_id", activeTrip.id);
      const errorMessage = rollback.error
        ? `tail pending untimed bypass failed and inserted item rollback failed: ${tailBypassPlan.errorCode || "order_space_exhausted"}`
        : `tail pending untimed bypass failed: ${tailBypassPlan.errorCode || "order_space_exhausted"}`;
      setNotice(errorMessage);
      await loadTripData(activeTrip.id);
      return { ok: false, errorMessage, rollbackFailed: Boolean(rollback.error) };
    }
    const tailBypassUpdates = tailBypassPlan.untimedSortOrderUpdates || [];
    const tailBypassResult = tailBypassUpdates.length
      ? await applyItineraryTimeContinuation(tailBypassUpdates)
      : { ok: true, applied: [] };
    if (!tailBypassResult.ok) {
      const bypassRollback = await rollbackItineraryTimeContinuation(tailBypassResult.applied);
      const insertRollback = await supabase
        .from("itinerary_items")
        .delete()
        .eq("id", insertResult.data.id)
        .eq("trip_id", activeTrip.id);
      const rollbackFailed = !bypassRollback.ok || Boolean(insertRollback.error);
      const errorMessage = rollbackFailed
        ? `tail pending untimed bypass failed and rollback needs review: ${tailBypassResult.error.message}`
        : `tail pending untimed bypass failed and inserted item was rolled back: ${tailBypassResult.error.message}`;
      setNotice(errorMessage);
      await loadTripData(activeTrip.id);
      return { ok: false, error: tailBypassResult.error, errorMessage, rollbackFailed };
    }

    if (shouldCompleteTailPair) {
      const tailUpdate = await supabase
        .from("itinerary_items")
        .update({
          to_item_id: insertResult.data.id,
          transport_role: transportRoles.tailPromotedPair,
          ...buildTransportPairSnapshot(tailFromItem, insertResult.data),
          updated_at: new Date().toISOString(),
        })
        .eq("id", tailTransportItem.id)
        .eq("trip_id", activeTrip.id);
      if (tailUpdate.error) {
        const rollback = await supabase
          .from("itinerary_items")
          .delete()
          .eq("id", insertResult.data.id)
          .eq("trip_id", activeTrip.id);
        const bypassRollback = await rollbackItineraryTimeContinuation(tailBypassResult.applied);
        const rollbackFailed = !bypassRollback.ok || Boolean(rollback.error);
        setNotice(
          rollbackFailed
            ? `新增行程後無法完成尾端交通配對，且復原失敗：${tailUpdate.error.message}`
            : `無法完成尾端交通配對：${tailUpdate.error.message}`,
        );
        await loadTripData(activeTrip.id);
        return { ok: false, error: tailUpdate.error, rollbackFailed };
      }
    }

    await loadTripData(activeTrip.id);
    return { ok: true, data: insertResult.data };
  }

  async function saveAlternative(itemId, payload, editingId) {
    if (!activeTrip || !canEditActiveTripContent) return { ok: false };
    const item = items.find((currentItem) => currentItem.id === itemId);
    if (isEffectiveFixedVisit(item)) {
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
      latitude: payload.latitude ?? null,
      longitude: payload.longitude ?? null,
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
    if (isEffectiveFixedVisit(parentItem)) {
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
    if (isEffectiveFixedVisit(item)) {
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
      latitude: item.latitude ?? null,
      longitude: item.longitude ?? null,
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
      latitude: alternative.latitude ?? null,
      longitude: alternative.longitude ?? null,
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
    if (isEffectiveFixedVisit(item)) {
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
    if (!isTimedVisit(item)) {
      setNotice("未設定完整時間的行程不能固定。");
      return { ok: false };
    }
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
    dayIndex,
    orderedTimedItemIds = null,
    orderedVisitItemIds = null,
    packageSourceItemIds,
    slotItemIds,
    timedAutoContinuation = false,
    transportBaselines = [],
    untimedSortOrderUpdates = [],
  }) {
    if (!activeTrip || !canEditActiveTripContent || dayIndex !== activeDay) return { ok: false };
    const timedVisits = sortedVisitItems(
      items.filter(
        (item) => item.day_index === dayIndex && isTimedVisit(item),
      ),
    );
    const hasTimedReorder = hasTimedDragOrderChange({
      currentTimedItemIds: timedVisits.map((item) => item.id),
      orderedTimedItemIds,
      packageSourceItemIds,
      slotItemIds,
    });
    if (!hasTimedReorder && !untimedSortOrderUpdates.length && !transportBaselines.length) return { ok: true, noOp: true };
    const movableTimedVisitIds = timedVisits.filter((item) => !isEffectiveFixedVisit(item)).map((item) => item.id);
    if (!isSamePackageOrder(movableTimedVisitIds, slotItemIds)) {
      const errorMessage = "行程順序已變更，請重新整理後再試。";
      setNotice(errorMessage);
      return { ok: false, errorMessage };
    }
    if (timedVisits.some((item) => !isEffectiveFixedVisit(item) && isLockedByAnotherUser(item, session?.user?.id))) {
      const errorMessage = "當天其中一個行程目前正由其他成員編輯。";
      setNotice(errorMessage);
      return { ok: false, errorMessage };
    }
    const invalidUntimedUpdate = untimedSortOrderUpdates.find((update) => {
      const item = items.find((candidate) => candidate.id === update.id);
      return (
        !item ||
        item.trip_id !== activeTrip.id ||
        Number(item.day_index) !== Number(dayIndex) ||
        !isUntimedVisit(item) ||
        isLockedByAnotherUser(item, session?.user?.id) ||
        item.updated_at !== update.updated_at
      );
    });
    if (invalidUntimedUpdate) {
      const errorMessage = "未設定時間行程已被更新，請重新整理後再試。";
      setNotice(errorMessage);
      await loadTripData(activeTrip.id);
      return { ok: false, errorMessage };
    }
    const explicitTransportIds = transportBaselines.map((transport) => transport.id);
    const explicitTransports = explicitTransportIds.length
      ? items.filter(
          (item) =>
            item.trip_id === activeTrip.id &&
            Number(item.day_index) === Number(dayIndex) &&
            isTransportationCard(item) &&
            explicitTransportIds.includes(item.id),
        )
      : [];
    const expectedExplicitTransportById = new Map(
      transportBaselines.map((transport) => [transport.id, transport.updatedAt]),
    );
    const explicitTransportManifestMatches =
      explicitTransports.length === expectedExplicitTransportById.size &&
      explicitTransports.every(
        (transport) => expectedExplicitTransportById.get(transport.id) === transport.updated_at,
      );
    if (!explicitTransportManifestMatches) {
      const errorMessage = "transport_state_changed";
      setNotice(errorMessage);
      await loadTripData(activeTrip.id);
      return { ok: false, errorMessage };
    }

    const shouldApplyUntimedBeforeRpc = !timedAutoContinuation || !hasTimedReorder;
    const untimedUpdateResult = shouldApplyUntimedBeforeRpc
      ? await applyItineraryTimeContinuation(untimedSortOrderUpdates)
      : { ok: true, applied: [] };
    if (!untimedUpdateResult.ok) {
      const errorMessage = untimedUpdateResult.error?.message || "untimed_sort_order_update_failed";
      setNotice(errorMessage);
      await loadTripData(activeTrip.id);
      return { ok: false, error: untimedUpdateResult.error, errorMessage };
    }
    if (!hasTimedReorder) {
      if (explicitTransportIds.length) {
        const deleteResult = await supabase
          .from("itinerary_items")
          .delete()
          .eq("trip_id", activeTrip.id)
          .eq("day_index", dayIndex)
          .eq("item_type", "transport")
          .in("id", explicitTransportIds)
          .select("id");
        if (deleteResult.error || deleteResult.data?.length !== explicitTransportIds.length) {
          const rollback = await rollbackItineraryTimeContinuation(untimedUpdateResult.applied);
          const errorMessage = deleteResult.error?.message || "transport_delete_failed";
          setNotice(rollback.ok ? errorMessage : `${errorMessage} / untimed_rollback_failed`);
          await loadTripData(activeTrip.id);
          return { ok: false, error: deleteResult.error, errorMessage, rollbackFailed: !rollback.ok };
        }
      }
      await loadTripData(activeTrip.id);
      return { ok: true, data: { updatedUntimedCount: untimedSortOrderUpdates.length } };
    }

    const baselineRows = items.filter(
      (item) =>
        item.day_index === dayIndex &&
        (isTransportationCard(item) ||
          isTimedVisit(item) ||
          untimedSortOrderUpdates.some((update) => update.id === item.id)),
    );
    const itemUpdatedAtBaselines = Object.fromEntries(
      baselineRows.map((item) => [item.id, item.updated_at]),
    );
    const reorderRpc = timedAutoContinuation
      ? "reorder_itinerary_fixed_anchor_continuation"
      : "reorder_itinerary_destination_packages";
    const reorderArgs = {
      target_trip_id: activeTrip.id,
      target_day_index: dayIndex,
      slot_item_ids: slotItemIds,
      package_source_item_ids: packageSourceItemIds,
      item_updated_at_baselines: itemUpdatedAtBaselines,
    };
    if (timedAutoContinuation) {
      reorderArgs.ordered_timed_item_ids = orderedTimedItemIds;
      reorderArgs.ordered_visit_item_ids = orderedVisitItemIds;
      reorderArgs.untimed_sort_order_updates = untimedSortOrderUpdates;
    }
    const { data, error } = await supabase.rpc(reorderRpc, reorderArgs);
    if (error) {
      const rollback = await rollbackItineraryTimeContinuation(untimedUpdateResult.applied);
      const errorMessage = destinationReorderErrorMessage(error);
      setNotice(rollback.ok ? errorMessage : `${errorMessage} / untimed_rollback_failed`);
      if (/stale_|transport_state_changed/.test(error.message || "")) await loadTripData(activeTrip.id);
      return { ok: false, error, errorMessage, rollbackFailed: !rollback.ok };
    }
    if (!timedAutoContinuation && explicitTransportIds.length) {
      const deleteResult = await supabase
        .from("itinerary_items")
        .delete()
        .eq("trip_id", activeTrip.id)
        .eq("day_index", dayIndex)
        .eq("item_type", "transport")
        .in("id", explicitTransportIds)
        .select("id");
      if (deleteResult.error || deleteResult.data?.length !== explicitTransportIds.length) {
        const errorMessage = deleteResult.error?.message || "transport_delete_failed";
        setNotice(errorMessage);
        await loadTripData(activeTrip.id);
        return { ok: false, error: deleteResult.error, errorMessage };
      }
    }
    await loadTripData(activeTrip.id);
    return { ok: true, data };
  }

  async function reorderUntimedVisit({ dayIndex, itemId, sortOrder, transportBaselines = [], updatedAt }) {
    if (!activeTrip || !canEditActiveTripContent || dayIndex !== activeDay) return { ok: false };
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item || !isUntimedVisit(item) || isLockedByAnotherUser(item, session?.user?.id)) {
      const errorMessage = "這張未設定時間行程目前無法移動。";
      setNotice(errorMessage);
      return { ok: false, errorMessage };
    }
    const expectedTransportById = new Map(
      transportBaselines.map((transport) => [transport.id, transport.updatedAt]),
    );
    const requestedTransportIds = transportBaselines.map((transport) => transport.id);
    const requestedTransports = requestedTransportIds.length
      ? items.filter(
          (candidate) =>
            candidate.trip_id === activeTrip.id &&
            Number(candidate.day_index) === Number(dayIndex) &&
            isTransportationCard(candidate) &&
            requestedTransportIds.includes(candidate.id),
        )
      : [];
    const transportManifestMatches =
      requestedTransports.length === expectedTransportById.size &&
      requestedTransports.every(
        (transport) => expectedTransportById.get(transport.id) === transport.updated_at,
      );
    if (!transportManifestMatches) {
      const errorMessage = "交通資訊已由其他成員更新，請重新整理後再試。";
      setNotice(errorMessage);
      await loadTripData(activeTrip.id);
      return { conflict: true, errorMessage, ok: false };
    }
    if (transportBaselines.length) {
      const baselineResult = await supabase
        .from("itinerary_items")
        .select("id, updated_at")
        .eq("trip_id", activeTrip.id)
        .eq("day_index", dayIndex)
        .eq("item_type", "transport")
        .in("id", requestedTransportIds);
      const baselineById = new Map((baselineResult.data || []).map((transport) => [transport.id, transport.updated_at]));
      const baselineMatches =
        !baselineResult.error &&
        baselineById.size === expectedTransportById.size &&
        transportBaselines.every((transport) => baselineById.get(transport.id) === transport.updatedAt);
      if (!baselineMatches) {
        const errorMessage = baselineResult.error?.message || "交通資訊已由其他成員更新，請重新整理後再試。";
        setNotice(errorMessage);
        await loadTripData(activeTrip.id);
        return { conflict: !baselineResult.error, error: baselineResult.error, errorMessage, ok: false };
      }
    }
    const result = await supabase
      .from("itinerary_items")
      .update({ sort_order: sortOrder })
      .eq("id", itemId)
      .eq("trip_id", activeTrip.id)
      .eq("day_index", dayIndex)
      .neq("item_type", "transport")
      .or("start_time.is.null,end_time.is.null")
      .eq("is_fixed", false)
      .eq("updated_at", updatedAt)
      .select("id, sort_order, updated_at")
      .maybeSingle();
    if (result.error || !result.data) {
      const errorMessage = result.error?.message || "行程位置已由其他成員更新，請重新整理後再試。";
      setNotice(errorMessage);
      await loadTripData(activeTrip.id);
      return { conflict: !result.error, error: result.error, errorMessage, ok: false };
    }
    if (transportBaselines.length) {
      const deleteResult = await supabase
        .from("itinerary_items")
        .delete()
        .eq("trip_id", activeTrip.id)
        .eq("day_index", dayIndex)
        .eq("item_type", "transport")
        .in("id", transportBaselines.map((transport) => transport.id))
        .select("id");
      if (deleteResult.error || deleteResult.data?.length !== transportBaselines.length) {
        const compensationResult = await supabase
          .from("itinerary_items")
          .update({ sort_order: item.sort_order })
          .eq("id", itemId)
          .eq("trip_id", activeTrip.id)
          .eq("updated_at", result.data.updated_at);
        const errorMessage =
          deleteResult.error?.message ||
          compensationResult.error?.message ||
          "交通卡未能完整移除，已重新載入最新行程。";
        setNotice(errorMessage);
        await loadTripData(activeTrip.id);
        return { error: deleteResult.error || compensationResult.error, errorMessage, ok: false };
      }
    }
    await loadTripData(activeTrip.id);
    return { data: result.data, ok: true };
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
    if (canContinue) {
      const nextTrip = trips.find((trip) => trip.id === nextTripId);
      setActiveDay(tripTodayIndex(nextTrip));
      setActiveTripId(nextTripId);
    }
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
              setActiveSection("today");
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
          onSettings={() => setActiveSection("settings")}
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
            onClearCardSelection={clearCardSelection}
            onClearDragPresence={clearDragPresence}
            onRejectMember={rejectMember}
            onReorderDestinationPackages={reorderDestinationPackages}
            onReorderUntimedVisit={reorderUntimedVisit}
            onPublishDragPresence={publishDragPresence}
            onPublishCardSelection={publishCardSelection}
            onSaveAlternative={saveAlternative}
            onSaveActualExpense={saveActualExpense}
            onSaveAccommodation={saveAccommodation}
            onSaveBudget={saveBudget}
            onSaveGuide={saveGuide}
            onSaveItem={saveItem}
            onSaveRouteOverride={saveRouteOverrideChange}
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
    const transportName = transportNameValue(payload);
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
      transport_role: transportRoleForPayload(payload),
      from_snapshot_start_time: payload.from_snapshot_start_time || null,
      from_snapshot_end_time: payload.from_snapshot_end_time || null,
      from_snapshot_destination: payload.from_snapshot_destination || null,
      to_snapshot_start_time: payload.to_snapshot_start_time || null,
      to_snapshot_end_time: payload.to_snapshot_end_time || null,
      to_snapshot_destination: payload.to_snapshot_destination || null,
      start_time: payload.start_time || null,
      end_time: null,
      is_fixed: false,
      fixed_at: null,
      fixed_by: null,
      address: null,
      map_url: null,
      latitude: null,
      longitude: null,
    };
  }
  const locationName = payload.location_name || payload.location;
  const description = payload.description || payload.note;
  const hasCompleteTime = Boolean(payload.start_time) && Boolean(payload.end_time);
  const mapPointFields = normalizeMapPointFields(payload);
  return {
    ...payload,
    item_type: payload.item_type || "visit",
    title: locationName || payload.title,
    location: locationName,
    location_name: locationName,
    note: description,
    description,
    start_time: hasCompleteTime ? payload.start_time : null,
    end_time: hasCompleteTime ? payload.end_time : null,
    is_fixed: hasCompleteTime ? Boolean(payload.is_fixed) : false,
    fixed_at: hasCompleteTime && payload.is_fixed ? payload.fixed_at || null : null,
    fixed_by: hasCompleteTime && payload.is_fixed ? payload.fixed_by || null : null,
    address: payload.address || null,
    map_url: payload.map_url || null,
    latitude: mapPointFields.latitude,
    longitude: mapPointFields.longitude,
    transportation_note: payload.transportation_note || null,
    transport_category: null,
    transport_name: null,
    transport_duration_minutes: null,
    transport_note: null,
    from_item_id: null,
    to_item_id: null,
    transport_role: null,
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

function SidebarTripSection({
  activeTripId,
  collapsed = false,
  createDisabled = false,
  createTitle = "新增旅程",
  flyoutId,
  headingId,
  isFlyoutOpen,
  onCloseFlyout,
  onCreate,
  onSelect,
  onToggleFlyout,
  trips,
}) {
  const flyoutRef = useRef(null);

  useEffect(() => {
    if (!collapsed || !isFlyoutOpen) return undefined;
    function handlePointerDown(event) {
      if (!flyoutRef.current || flyoutRef.current.contains(event.target)) return;
      onCloseFlyout();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [collapsed, isFlyoutOpen, onCloseFlyout]);

  function handleCreate() {
    if (createDisabled) return;
    onCloseFlyout();
    onCreate();
  }

  function handleSelect(tripId) {
    onCloseFlyout();
    onSelect(tripId);
  }

  if (!collapsed) {
    return (
      <section className="sidebar-trip-section" aria-labelledby={headingId}>
        <div className="sidebar-trip-heading">
          <div className="sidebar-trip-heading-copy">
            <h2 id={headingId}>我的旅程</h2>
            <p>{trips.length} 個旅程</p>
          </div>
          <button className="mini-button sidebar-create-trip" type="button" title={createTitle} aria-label={createTitle} disabled={createDisabled} onClick={handleCreate}>
            +
          </button>
        </div>
        <div className="sidebar-trip-list-region">
          <TripList trips={trips} activeTripId={activeTripId} compact={false} onCreate={handleCreate} onSelect={handleSelect} />
        </div>
      </section>
    );
  }

  return (
    <section className="sidebar-trip-section sidebar-trip-section-collapsed" aria-label="旅程操作" ref={flyoutRef}>
      <div className="sidebar-trip-menu-divider" aria-hidden="true" />
      <button
        className={`mini-button sidebar-trip-menu-button${isFlyoutOpen ? " active" : ""}`}
        type="button"
        title="我的旅程"
        aria-label="我的旅程"
        aria-controls={flyoutId}
        aria-expanded={isFlyoutOpen}
        onClick={onToggleFlyout}
      >
        <LayoutList size={19} strokeWidth={2.2} aria-hidden="true" />
      </button>
      {isFlyoutOpen ? (
        <div className="sidebar-trip-flyout" id={flyoutId}>
          <div className="sidebar-trip-heading">
            <div className="sidebar-trip-heading-copy">
              <h2 id={headingId}>我的旅程</h2>
              <p>{trips.length} 個旅程</p>
            </div>
            <button className="mini-button sidebar-create-trip" type="button" title={createTitle} aria-label={createTitle} disabled={createDisabled} onClick={handleCreate}>
              +
            </button>
          </div>
          <div className="sidebar-trip-list-region">
            <TripList trips={trips} activeTripId={activeTripId} compact={false} onCreate={handleCreate} onSelect={handleSelect} />
          </div>
        </div>
      ) : null}
    </section>
  );
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
  onVersion,
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
            onClick={() => {
              onClose();
              onVersion();
            }}
          >
            <BadgeInfo size={16} aria-hidden="true" strokeWidth={2.2} />
            <span>版本</span>
          </button>
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
      <span className="trip-header-member-open-button" aria-hidden="true">
        <TripHeaderIcon name="invite" />
      </span>
    </button>
  );
}

function HeaderMemberPresencePreview({
  currentUserId,
  disabled,
  members = [],
  onOpen,
  onPresenceNavigate,
  pendingCount = 0,
  remotePresenceByUser = new Map(),
}) {
  const approvedMembers = members.filter((member) => member.status === "approved");
  const visibleMembers = approvedMembers.slice(0, 4);
  const overflowCount = Math.max(approvedMembers.length - visibleMembers.length, 0);
  return (
    <div className={`trip-header-member-preview${disabled ? " disabled" : ""}`} title="成員與邀請" aria-label="成員與邀請">
      <span className="trip-header-member-avatars">
        {visibleMembers.map((member) => {
          const presence = remotePresenceByUser.get(member.user_id) || null;
          const isRemoteOnline = Boolean(presence && member.user_id !== currentUserId);
          const pageLabel = presence ? tripPresencePageLabel(presence) : "";
          const avatarTitle = presence ? `${presence.userName || memberName(member)} · ${pageLabel}` : memberName(member);
          return (
            <button
              className={`member-avatar compact trip-header-member-avatar${isRemoteOnline ? " remote-online" : ""}`}
              disabled={disabled}
              key={member.id || member.user_id}
              style={isRemoteOnline ? { "--trip-presence-color": timelineCardSelectionColor(presence.colorKey) } : undefined}
              title={avatarTitle}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (isRemoteOnline && typeof onPresenceNavigate === "function") {
                  onPresenceNavigate(presence);
                } else if (!disabled && typeof onOpen === "function") {
                  onOpen();
                }
              }}
            >
              {memberInitial(member)}
            </button>
          );
        })}
        {overflowCount > 0 ? <span className="member-avatar compact more">+{overflowCount}</span> : null}
      </span>
      {pendingCount > 0 ? <span className="trip-header-member-pending">待審 {pendingCount}</span> : null}
      <button
        className="trip-header-member-open-button"
        disabled={disabled}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (!disabled && typeof onOpen === "function") onOpen();
        }}
      >
        <TripHeaderIcon name="invite" />
      </button>
    </div>
  );
}

function TripHeader({
  activeSection,
  trip,
  members = [],
  currentUserId,
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
  onPresenceNavigate,
  onShare,
  onUpdateTrip,
  onUpdateTripDateRange,
  remotePresenceByUser = new Map(),
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
        <HeaderMemberPresencePreview
          currentUserId={currentUserId}
          disabled={!hasTrip || !canOpenMembers}
          members={members}
          onPresenceNavigate={onPresenceNavigate}
          pendingCount={pendingMemberCount}
          remotePresenceByUser={remotePresenceByUser}
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
  const [isDemoSidebarTripMenuOpen, setIsDemoSidebarTripMenuOpen] = useState(false);
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
  const { isMapClosing, isRouteCollapsed, isRouteLayoutCollapsed, toggleRouteMap } = useTimelineMapTransition();
  const demoMapPointPicker = {
    canPickMapPoint: false,
    isPickingMapPoint: false,
    mapPointPickFeedback: "",
    pickedMapPoint: null,
    onCancelMapPointPick: null,
    onPickMapPoint: null,
    onStartMapPointPick: null,
  };
  const days = useMemo(() => tripDays(demoActiveTrip), [demoActiveTrip]);
  useEffect(() => {
    setIsDemoSidebarTripMenuOpen(false);
  }, [activeSection, demoActiveTrip.id, isDemoSidebarCollapsed]);
  const dayItems = useMemo(
    () => sortScheduleItems(timelineItems.filter((item) => item.day_index === activeDay)),
    [activeDay, timelineItems],
  );
  const itemsByDay = useMemo(
    () => days.map((_, index) => sortScheduleItems(timelineItems.filter((item) => item.day_index === index))),
    [days, timelineItems],
  );
  const dayBoardNavigation = useDayBoardNavigation(activeDay, isRouteLayoutCollapsed);
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

  function returnToLogin() {
    window.location.assign("/");
  }

  function selectTimelineDay(dayIndex) {
    if (Number(dayIndex) !== Number(activeDay)) setFocusedItemId(null);
    setActiveDay(dayIndex);
    if (isRouteLayoutCollapsed) dayBoardNavigation.scrollToDay(dayIndex);
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
    let passiveUntimedSortOrders = {};
    const brokenTransportId = meta.transportConflict?.id || null;
    const continuationById = new Map(
      (meta.autoContinuationUpdates || []).map((update) => [update.id, update]),
    );
    if (!nextPayload.title.trim()) return;
    const editingItem = editingId ? timelineItems.find((item) => item.id === editingId) : null;
    if (isEffectiveFixedVisit(editingItem)) {
      return { ok: false, fixed: true };
    }
    if (editingItem && isTimedVisit(editingItem) !== isTimedVisit(nextPayload)) {
      const conversionPlan = planTimelineTimingChangeSortOrders({
        items: dayItems,
        replacements: [{ id: editingItem.id, start_time: nextPayload.start_time, end_time: nextPayload.end_time }],
      });
      if (!conversionPlan.ok) return { ok: false, errorMessage: "目前無法保留這張未設定時間行程的位置，請重新整理後再試。" };
      if (Number.isInteger(conversionPlan.sortOrders[editingItem.id])) {
        nextPayload.sort_order = conversionPlan.sortOrders[editingItem.id];
      }
      passiveUntimedSortOrders = conversionPlan.sortOrders;
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
    const transportationRoleUpdates = planTransportationRoleUpdatesForTimingChange({
      dayIndex: activeDay,
      editingId,
      items: timelineItems,
      normalizedPayload: nextPayload,
    });
    if (!editingId && isTransportationCard(nextPayload) && nextPayload.from_item_id && !nextPayload.to_item_id) {
      const { fromItem, transportItem } = tailTransportContext(dayItems);
      if (!fromItem || nextPayload.from_item_id !== fromItem.id || transportItem) return { ok: false };
    }
    if (editingId) {
      const transportationRoleUpdateById = new Map(
        transportationRoleUpdates.map((update) => [update.id, update.payload]),
      );
      setTimelineItems((current) =>
        current.filter((item) => item.id !== brokenTransportId).map((item) => {
          const continuation = continuationById.get(item.id);
          const transportationRoleUpdate = transportationRoleUpdateById.get(item.id);
          if (item.id === editingId) {
            return {
              ...item,
              ...nextPayload,
              updated_at: new Date().toISOString(),
            };
          }
          if (transportationRoleUpdate) {
            return {
              ...item,
              ...transportationRoleUpdate,
              updated_at: new Date().toISOString(),
            };
          }
          if (continuation) {
            return {
              ...item,
              start_time: continuation.start_time,
              end_time: continuation.end_time,
              ...(Number.isInteger(continuation.sort_order)
                ? { sort_order: continuation.sort_order }
                : Number.isInteger(passiveUntimedSortOrders[item.id])
                  ? { sort_order: passiveUntimedSortOrders[item.id] }
                  : {}),
              updated_at: new Date().toISOString(),
            };
          }
          if (Number.isInteger(passiveUntimedSortOrders[item.id]) && item.sort_order !== passiveUntimedSortOrders[item.id]) {
            return {
              ...item,
              sort_order: passiveUntimedSortOrders[item.id],
              updated_at: new Date().toISOString(),
            };
          }
          return item;
        }),
      );
      return { ok: true };
    }
    const newItemId = demoId(nextPayload.item_type === "transport" ? "demo-transport" : "demo-itinerary");
    setTimelineItems((current) => {
      const currentWithoutBrokenTransport = current.filter((item) => item.id !== brokenTransportId);
      const currentDayVisits = sortedVisitItems(currentWithoutBrokenTransport.filter((item) => item.day_index === activeDay));
      const sortOrder = demoSortOrderForNewTimelineItem({ currentDayVisits, item: nextPayload });
      const newItem = {
        ...emptyItemForm,
        ...nextPayload,
        id: newItemId,
        trip_id: demoActiveTrip.id,
        day_index: activeDay,
        sort_order: sortOrder,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const currentDayItems = currentWithoutBrokenTransport.filter((item) => item.day_index === activeDay);
      const { fromItem: tailFromItem, transportItem: tailTransportItem } = tailTransportContext(currentDayItems);
      const newVisitStart = timeToMinutes(newItem.start_time);
      const tailFromEnd = timeToMinutes(tailFromItem?.end_time);
      const shouldCompleteTailPair =
        !isTransportationCard(newItem) &&
        tailTransportItem &&
        newVisitStart !== null &&
        (tailFromEnd === null || newVisitStart >= tailFromEnd);
      const tailBypassPlan = shouldCompleteTailPair
        ? planTailPendingPromotionUntimedBypass({
            items: [...currentWithoutBrokenTransport, newItem],
            promotedFromItemId: tailFromItem.id,
            promotedToItemId: newItem.id,
            tailTransportItem,
          })
        : { ok: true, untimedSortOrderUpdates: [] };
      if (!tailBypassPlan.ok) return current;
      const tailBypassSortOrderById = new Map(
        (tailBypassPlan.untimedSortOrderUpdates || []).map((update) => [update.id, update.sort_order]),
      );
      const nextItems = shouldCompleteTailPair
        ? currentWithoutBrokenTransport.map((item) =>
            item.id === tailTransportItem.id
              ? {
                  ...item,
                  to_item_id: newItem.id,
                  transport_role: transportRoles.tailPromotedPair,
                  ...buildTransportPairSnapshot(tailFromItem, newItem),
                  updated_at: new Date().toISOString(),
                }
              : tailBypassSortOrderById.has(item.id)
                ? {
                    ...item,
                    sort_order: tailBypassSortOrderById.get(item.id),
                    updated_at: new Date().toISOString(),
                  }
              : item,
          )
        : currentWithoutBrokenTransport;
      return [
        ...nextItems,
        newItem,
      ];
    });
    return { ok: true, data: { id: newItemId } };
  }

  function reorderTimelineDestinationPackages({
    dayIndex,
    orderedTimedItemIds = null,
    orderedVisitItemIds = null,
    packageSourceItemIds,
    slotItemIds,
    timedAutoContinuation = false,
    transportBaselines = [],
    untimedSortOrderUpdates = [],
  }) {
    if (dayIndex !== activeDay) return { ok: false };
    const currentTimedItemIds = sortedVisitItems(
      timelineItems.filter((item) => item.day_index === dayIndex && isTimedVisit(item)),
    ).map((item) => item.id);
    const hasTimedReorder = hasTimedDragOrderChange({
      currentTimedItemIds,
      orderedTimedItemIds,
      packageSourceItemIds,
      slotItemIds,
    });
    if (!hasTimedReorder && !untimedSortOrderUpdates.length && !transportBaselines.length) {
      return { ok: true, noOp: true };
    }
    const plan = hasTimedReorder
      ? planDestinationPackageReorder({
          items: timelineItems,
          alternatives: timelineAlternatives,
          itineraryBudgetLinks,
          orderedTimedItemIds,
          orderedVisitItemIds,
          slotItemIds,
          packageSourceItemIds,
          timedAutoContinuation,
        })
      : { ok: true, alternatives: timelineAlternatives, itineraryBudgetLinks, items: timelineItems };
    if (!plan.ok) return { ok: false, errorMessage: destinationReorderErrorMessage({ message: plan.errorCode }) };
    const untimedSortOrderById = new Map(untimedSortOrderUpdates.map((update) => [update.id, update.sort_order]));
    const deletedTransportIds = new Set(transportBaselines.map((transport) => transport.id));
    setTimelineItems(
      plan.items
        .filter((item) => !deletedTransportIds.has(item.id))
        .map((item) =>
          untimedSortOrderById.has(item.id)
            ? { ...item, sort_order: untimedSortOrderById.get(item.id), updated_at: new Date().toISOString() }
            : item,
        ),
    );
    setTimelineAlternatives(plan.alternatives);
    setItineraryBudgetLinks(plan.itineraryBudgetLinks);
    return { ok: true, data: plan };
  }

  function reorderTimelineUntimedVisit({ dayIndex, itemId, sortOrder, transportBaselines = [], updatedAt }) {
    if (dayIndex !== activeDay) return { ok: false };
    const item = timelineItems.find((candidate) => candidate.id === itemId);
    if (!item || !isUntimedVisit(item) || item.updated_at !== updatedAt) return { ok: false, conflict: true };
    const requestedTransportIds = transportBaselines.map((transport) => transport.id);
    const currentTransportById = new Map(
      timelineItems
        .filter(
          (candidate) =>
            isTransportationCard(candidate) &&
            candidate.day_index === dayIndex &&
            requestedTransportIds.includes(candidate.id),
        )
        .map((transport) => [transport.id, transport]),
    );
    if (
      currentTransportById.size !== requestedTransportIds.length ||
      transportBaselines.some((transport) => currentTransportById.get(transport.id)?.updated_at !== transport.updatedAt)
    ) {
      return { ok: false, conflict: true };
    }
    const deletedTransportIds = new Set(requestedTransportIds);
    setTimelineItems((current) =>
      current
        .filter((candidate) => !deletedTransportIds.has(candidate.id))
        .map((candidate) =>
          candidate.id === itemId
            ? { ...candidate, sort_order: sortOrder, updated_at: new Date().toISOString() }
            : candidate,
        ),
    );
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
    if (isEffectiveFixedVisit(item)) return { ok: false, error: { message: "此行程已固定，請先解鎖後再修改。" } };
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
    if (isEffectiveFixedVisit(parentItem)) return { ok: false, error: { message: "此行程已固定，請先解鎖後再修改。" } };
    setTimelineAlternatives((current) => current.filter((alternative) => alternative.id !== alternativeId));
    return { ok: true };
  }

  function deleteTimelineItem(itemId) {
    const deletedIds = new Set([itemId]);
    const deletedItem = timelineItems.find((item) => item.id === itemId);
    if (isEffectiveFixedVisit(deletedItem)) return;
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
    if (!isTimedVisit(item)) return { ok: false };
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
    if (isEffectiveFixedVisit(item)) return { ok: false };
    const oldMainPayload = {
      title: item.title,
      type: item.type || "attraction",
      start_time: item.start_time || null,
      end_time: item.end_time || null,
      cost: Number(item.cost || 0),
      location_name: item.location_name || item.location || null,
      address: item.address || null,
      map_url: item.map_url || null,
      latitude: item.latitude ?? null,
      longitude: item.longitude ?? null,
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
      latitude: alternative.latitude ?? null,
      longitude: alternative.longitude ?? null,
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
            title={isDemoSidebarCollapsed ? "展開 Demo 側欄" : "回到登入介面"}
            aria-label={isDemoSidebarCollapsed ? "展開 Demo 側欄" : "回到登入介面"}
            onClick={() => {
              if (isDemoSidebarCollapsed) {
                setIsDemoSidebarCollapsed(false);
                return;
              }
              returnToLogin();
            }}
          >
            <span className="brand-logo-text">TP</span>
            {isDemoSidebarCollapsed ? (
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
            title={isDemoSidebarCollapsed ? "展開側欄" : "收合側欄"}
            aria-label={isDemoSidebarCollapsed ? "展開側欄" : "收合側欄"}
            aria-expanded={!isDemoSidebarCollapsed}
            onClick={() => setIsDemoSidebarCollapsed((value) => !value)}
          >
            <PanelLeftClose size={18} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
        <nav className="section-nav" aria-label="Demo 導覽">
          {["timeline", "budget", "luggage"].map((section) => {
            const navItem = desktopNavItems.find((item) => item.id === section);
            const Icon = navItem ? desktopNavIcons[navItem.id] : null;
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
        <SidebarTripSection
          activeTripId={demoActiveTrip.id}
          collapsed={isDemoSidebarCollapsed}
          createDisabled
          createTitle="Demo 模式不支援新增旅程"
          flyoutId="demo-sidebar-trips-flyout"
          headingId="demo-sidebar-trips-title"
          isFlyoutOpen={isDemoSidebarTripMenuOpen}
          onCloseFlyout={() => setIsDemoSidebarTripMenuOpen(false)}
          onCreate={() => {}}
          onSelect={(tripId) => {
            const nextTrip = demoTrips.find((trip) => trip.id === tripId);
            if (nextTrip) {
              setActiveDay(tripTodayIndex(nextTrip));
              setFocusedItemId(null);
              setDemoActiveTrip(nextTrip);
            }
          }}
          onToggleFlyout={() => setIsDemoSidebarTripMenuOpen((value) => !value)}
          trips={demoTrips.map((trip) => ({
            ...trip,
            membership: { role: "owner", status: "approved" },
          }))}
        />
        <div className="user-box demo-login-return">
          <button
            className="user-box-card"
            type="button"
            title="回到登入介面"
            aria-label="Return to login"
            onClick={returnToLogin}
          >
            <span className="user-avatar" aria-hidden="true">
              <LogIn size={17} strokeWidth={2.1} />
            </span>
            <span className="user-account">
              <strong className="nav-label">回到登入</strong>
              <span className="user-email nav-label">Click to return to login</span>
            </span>
          </button>
        </div>
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
            <div className={`timeline-top-row${isRouteLayoutCollapsed ? " route-collapsed" : ""}`}>
              <DayTabs
                activeDay={activeDay}
                dayPrefix="第"
                daySuffix="天"
                days={days}
                layoutMode={isRouteLayoutCollapsed ? "collapsed" : "expanded"}
                onActiveDay={selectTimelineDay}
              />
              <button
                className="ghost-button compact timeline-map-toggle"
                type="button"
                title={isRouteCollapsed ? "顯示地圖" : "隱藏地圖"}
                aria-label={isRouteCollapsed ? "顯示地圖" : "隱藏地圖"}
                onClick={toggleRouteMap}
              >
                {isRouteCollapsed ? (
                  <MapIcon size={18} strokeWidth={2.2} aria-hidden="true" />
                ) : (
                  <PanelRightClose size={18} strokeWidth={2.2} aria-hidden="true" />
                )}
              </button>
            </div>
            <div className={`content-grid timeline-workbench${isRouteLayoutCollapsed ? " route-collapsed" : ""}`}>
              {isRouteLayoutCollapsed ? (
                <button
                  className="board-scroll-button left"
                  disabled={!dayBoardNavigation.scrollState.left}
                  type="button"
                  aria-label="前一天"
                  onClick={() => dayBoardNavigation.scrollByDirection(-1)}
                >
                  <ChevronLeft aria-hidden="true" />
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
                  dayTitle={`DAY ${activeDay + 1}`}
                  disableDraftAutosave
                  focusedItemId={focusedItemId}
                  {...demoMapPointPicker}
                  headingEyebrow="行程"
                  members={demoMembers}
                  onApplyAlternative={applyTimelineAlternative}
                  onConfirmTransportWarning={confirmTimelineTransportWarning}
                  onDeleteAlternative={deleteTimelineAlternative}
                  onDeleteItem={deleteTimelineItem}
                  onFocusItem={setFocusedItemId}
                  onReorderDestinationPackages={reorderTimelineDestinationPackages}
                  onReorderUntimedVisit={reorderTimelineUntimedVisit}
                  onSaveAlternative={saveTimelineAlternative}
                  onSaveItem={saveTimelineItem}
                  onToggleItemFixed={toggleTimelineItemFixed}
                  restoreDrafts={false}
                  useEditLocks={false}
                />
                {isRouteLayoutCollapsed ? (
                  <MultiDayTimelineColumns
                    activeDay={activeDay}
                    alternativesByItem={alternativesByItem}
                    budgetsByItem={budgetsByItem}
                    days={days}
                    itemsByDay={itemsByDay}
                    onActiveDay={selectTimelineDay}
                    onFocusItem={setFocusedItemId}
                  />
              ) : null}
              </section>
              {isRouteLayoutCollapsed ? (
                <button
                  className="board-scroll-button right"
                  disabled={!dayBoardNavigation.scrollState.right}
                  type="button"
                  aria-label="後一天"
                  onClick={() => dayBoardNavigation.scrollByDirection(1)}
                >
                  <ChevronRight aria-hidden="true" />
                </button>
              ) : null}
              {isRouteLayoutCollapsed ? null : (
                <aside className={`side-panels${isMapClosing ? " is-closing" : ""}`}>
                  <RoutePanel
                    dayItems={dayItems}
                    focusedItemId={focusedItemId}
                    {...demoMapPointPicker}
                    headingEyebrow="路線"
                    mode="demo"
                    viewportKey={`demo-day:${activeDay}`}
                    onFocusItem={setFocusedItemId}
                  />
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
  return Array.from(compactTitle).slice(0, 1).join("");
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
    foreignCardSelection,
    foreignDragPresence,
    foreignSameDayDragActive,
    luggageItems,
    luggageTab,
    members,
    packItems,
    routeOverridePointsBySegment = {},
    routeOverrideSaveError = "",
    routeEditCollaboration = {},
    sharedLuggageItems,
    todayDayIndex,
    todayItems,
    todoItems,
    timelineDayTabPresenceByDay,
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
    onClearCardSelection,
    onClearDragPresence,
    onRejectMember,
    onReorderDestinationPackages,
    onReorderUntimedVisit,
    onPublishDragPresence,
    onPublishCardSelection,
    onSaveAlternative,
    onSaveActualExpense,
    onSaveAccommodation,
    onSaveBudget,
    onSaveGuide,
    onSaveItem,
    onSaveRouteOverride,
    onRouteEditCollaborationEvent,
    onRouteEditPresenceChange,
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
  const [mapPickingMode, setMapPickingMode] = useState(null);
  const [mapPointPickFeedback, setMapPointPickFeedback] = useState("");
  const [pickedMapPoint, setPickedMapPoint] = useState(null);
  const [mapPointEditorState, setMapPointEditorState] = useState({ canPick: false, isOpen: false });
  const [isMapSearchReplaceActive, setIsMapSearchReplaceActive] = useState(false);
  const [isMapAddLocationActive, setIsMapAddLocationActive] = useState(false);
  const [isMapAddLocationPending, setIsMapAddLocationPending] = useState(false);
  const [mapAddLocationRequestId, setMapAddLocationRequestId] = useState(0);
  const mapAddLocationPendingRef = useRef(false);
  const sidePanelsRef = useRef(null);
  const { isMapClosing, isRouteCollapsed, isRouteLayoutCollapsed, openRouteMap, toggleRouteMap } = useTimelineMapTransition();
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
  const dayBoardNavigation = useDayBoardNavigation(activeDay, isRouteLayoutCollapsed);

  function startMapPointPick(mode = "editor") {
    setMapPointPickFeedback("picking");
    setMapPickingMode(mode === "map-add" ? "map-add" : "editor");
  }

  function cancelMapPointPick() {
    setMapPickingMode(null);
    setMapPointPickFeedback("");
  }

  function startMapSearchReplace() {
    if (isRouteLayoutCollapsed || !mapPointEditorState.canPick) return;
    cancelMapPointPick();
    setIsMapSearchReplaceActive(true);
  }

  function cancelMapSearchReplace() {
    setIsMapSearchReplaceActive(false);
  }

  const activateMapAddLocation = useCallback(() => {
    if (!mapAddLocationPendingRef.current) return;
    mapAddLocationPendingRef.current = false;
    setIsMapAddLocationPending(false);
    setIsMapAddLocationActive(true);
    setMapAddLocationRequestId((current) => current + 1);
  }, []);

  function startMapAddLocation() {
    cancelMapPointPick();
    cancelMapSearchReplace();
    setPickedMapPoint(null);
    mapAddLocationPendingRef.current = true;
    setIsMapAddLocationPending(true);
    if (isRouteLayoutCollapsed || isMapClosing) {
      openRouteMap();
      return;
    }
    activateMapAddLocation();
  }

  function cancelMapAddLocation() {
    mapAddLocationPendingRef.current = false;
    setIsMapAddLocationPending(false);
    setIsMapAddLocationActive(false);
    setPickedMapPoint(null);
    cancelMapPointPick();
  }

  function toggleRouteMapWithAddLocationCleanup() {
    if (!isRouteCollapsed && (isMapAddLocationActive || isMapAddLocationPending)) cancelMapAddLocation();
    toggleRouteMap();
  }

  function finishMapAddLocation() {
    mapAddLocationPendingRef.current = false;
    setIsMapAddLocationPending(false);
    setIsMapAddLocationActive(false);
  }

  function pickMapPoint(point) {
    if (!point) return;
    setPickedMapPoint({ ...point, pickedAt: Date.now(), source: mapPickingMode || "editor" });
    setMapPickingMode(null);
    setMapPointPickFeedback("picked");
    if (isMapAddLocationActive) finishMapAddLocation();
    window.setTimeout(() => {
      setMapPointPickFeedback((current) => (current === "picked" ? "" : current));
    }, 1500);
  }

  function selectPlaceDetails(details) {
    const latitude = Number(details?.latitude);
    const longitude = Number(details?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    const isMapUrlPoint = details.source === "map-url";
    setPickedMapPoint({
      displayName: details.displayName || "",
      googleMapsUri: isMapUrlPoint
        ? details.googleMapsUri || googleMapsPointUrl(latitude, longitude)
        : googleMapsPointUrl(latitude, longitude),
      latitude,
      longitude,
      pickedAt: Date.now(),
      placeId: details.id || "",
      source: isMapUrlPoint || !isMapSearchReplaceActive ? "places-details" : "places-replace",
    });
    if (isMapAddLocationActive) finishMapAddLocation();
  }

  useLayoutEffect(() => {
    if (!isMapAddLocationPending || isRouteLayoutCollapsed) return undefined;
    const sidePanels = sidePanelsRef.current;
    if (!sidePanels) return undefined;
    const revealAnimations = typeof sidePanels.getAnimations === "function"
      ? sidePanels.getAnimations().filter((animation) => animation.animationName === "timeline-map-reveal")
      : [];
    if (!revealAnimations.length) {
      activateMapAddLocation();
      return undefined;
    }
    let cancelled = false;
    Promise.allSettled(revealAnimations.map((animation) => animation.finished)).then(() => {
      if (!cancelled) activateMapAddLocation();
    });
    return () => {
      cancelled = true;
    };
  }, [activateMapAddLocation, isMapAddLocationPending, isRouteLayoutCollapsed]);

  useEffect(() => {
    cancelMapAddLocation();
  }, [activeDay, activeTrip?.id, activeSection]);

  useEffect(() => {
    if (!mapPickingMode) return undefined;

    function handleDocumentPointerDown(event) {
      const target = event.target;
      if (target?.closest?.(".google-map-surface") || target?.closest?.(".map-point-picker-button")) return;
      if (target?.closest?.(".map-area-point-button")) return;
      cancelMapPointPick();
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
    };
  }, [mapPickingMode]);

  useEffect(() => {
    if (isRouteLayoutCollapsed && mapPickingMode) cancelMapPointPick();
    if (isRouteLayoutCollapsed && isMapSearchReplaceActive) cancelMapSearchReplace();
  }, [isMapSearchReplaceActive, isRouteLayoutCollapsed, mapPickingMode]);

  const mapPointPicker = {
    canPickMapPoint: !isRouteLayoutCollapsed && canEdit && (!mapPointEditorState.isOpen || mapPointEditorState.canPick),
    hasActiveMapPointEditor: mapPointEditorState.canPick,
    isPickingMapPoint: Boolean(mapPickingMode),
    isMapSearchReplaceActive,
    isMapAddLocationActive,
    mapAddLocationRequestId,
    mapPickingMode,
    mapPointPickFeedback,
    pickedMapPoint,
    previewMapPoint: mapPointEditorState.previewMapPoint || null,
    onCancelMapPointPick: cancelMapPointPick,
    onCancelMapAddLocation: cancelMapAddLocation,
    onCancelMapSearchReplace: cancelMapSearchReplace,
    onMapPointEditorActiveChange: setMapPointEditorState,
    onPickMapPoint: pickMapPoint,
    onSelectPlaceDetails: selectPlaceDetails,
    onStartMapAddLocation: startMapAddLocation,
    onStartMapSearchReplace: startMapSearchReplace,
    onStartMapPointPick: startMapPointPick,
  };

  function selectTimelineDay(dayIndex) {
    if (Number(dayIndex) !== Number(activeDay)) setFocusedItemId(null);
    onActiveDay(dayIndex);
    if (isRouteLayoutCollapsed) dayBoardNavigation.scrollToDay(dayIndex);
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
            selectTimelineDay(todayDayIndex);
            onSectionChange("timeline");
          }}
        />
      ) : null}

      {isTodayMode || isBudgetMode || isAccommodationMode || isTodoMode || isLuggageMode || isSettlementMode ? null : (
        <div className={`timeline-top-row${isRouteLayoutCollapsed ? " route-collapsed" : ""}`}>
          <DayTabs
            activeDay={activeDay}
            days={days}
            layoutMode={isRouteLayoutCollapsed ? "collapsed" : "expanded"}
            onActiveDay={selectTimelineDay}
            dayTabPresenceByDay={timelineDayTabPresenceByDay}
          />
          <button
            className="ghost-button compact timeline-map-toggle"
            type="button"
            title={isRouteCollapsed ? "顯示地圖" : "隱藏地圖"}
            aria-label={isRouteCollapsed ? "顯示地圖" : "隱藏地圖"}
            onClick={toggleRouteMapWithAddLocationCleanup}
          >
            {isRouteCollapsed ? (
              <MapIcon size={18} strokeWidth={2.2} aria-hidden="true" />
            ) : (
              <PanelRightClose size={18} strokeWidth={2.2} aria-hidden="true" />
            )}
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
        className={`content-grid timeline-workbench${isRouteLayoutCollapsed ? " route-collapsed" : ""}${
          isTodayMode || isBudgetMode || isAccommodationMode || isTodoMode || isLuggageMode || isSettlementMode
            ? " hidden-section"
            : ""
        }`}
      >
        {isRouteLayoutCollapsed ? (
          <button
            className="board-scroll-button left"
            disabled={!dayBoardNavigation.scrollState.left}
            type="button"
            aria-label="前一天"
            onClick={() => dayBoardNavigation.scrollByDirection(-1)}
          >
            <ChevronLeft aria-hidden="true" />
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
                foreignCardSelection={foreignCardSelection}
                foreignDragPresence={foreignDragPresence}
                foreignSameDayDragActive={foreignSameDayDragActive}
                members={members}
                dayItems={dayItems}
                dayDateLabel={days[activeDay] ? formatDate(days[activeDay]) : ""}
                dayLabel={days[activeDay] ? `Day ${activeDay + 1} · ${formatDate(days[activeDay])}` : ""}
                dayTitle={`DAY ${activeDay + 1}`}
                focusedItemId={focusedItemId}
                {...mapPointPicker}
                onApplyAlternative={onApplyAlternative}
                onClearDragPresence={onClearDragPresence}
                onConfirmTransportWarning={onConfirmTransportWarning}
                onDeleteAlternative={onDeleteAlternative}
                onDeleteItem={onDeleteItem}
                onClearCardSelection={onClearCardSelection}
                onFocusItem={setFocusedItemId}
                onPublishCardSelection={onPublishCardSelection}
                onPublishDragPresence={onPublishDragPresence}
                onReorderDestinationPackages={onReorderDestinationPackages}
                onReorderUntimedVisit={onReorderUntimedVisit}
                onSaveAlternative={onSaveAlternative}
                onSaveItem={onSaveItem}
                onToggleItemFixed={onToggleItemFixed}
                restoreDrafts={activeSection === "timeline"}
              />
              {isRouteLayoutCollapsed ? (
                <MultiDayTimelineColumns
                  activeDay={activeDay}
                  alternativesByItem={alternativesByItem}
                  budgetsByItem={budgetsByItem}
                  days={days}
                  itemsByDay={itemsByDay}
                  dayBoardPresenceByDay={timelineDayTabPresenceByDay}
                  onActiveDay={selectTimelineDay}
                  onFocusItem={setFocusedItemId}
                />
              ) : null}
            </section>

            {isRouteLayoutCollapsed ? (
              <button
                className="board-scroll-button right"
                disabled={!dayBoardNavigation.scrollState.right}
                type="button"
                aria-label="後一天"
                onClick={() => dayBoardNavigation.scrollByDirection(1)}
              >
                <ChevronRight aria-hidden="true" />
              </button>
            ) : null}
            {isRouteLayoutCollapsed ? null : (
              <aside className={`side-panels${isMapClosing ? " is-closing" : ""}`} ref={sidePanelsRef}>
                <RoutePanel
                  dayItems={dayItems}
                  focusedItemId={focusedItemId}
                  {...mapPointPicker}
                  mode="formal"
                  routeOverridePointsBySegment={routeOverridePointsBySegment}
                  routeOverrideSaveError={routeOverrideSaveError}
                  routeEditCollaboration={routeEditCollaboration}
                  viewportKey={`formal-day:${activeDay}`}
                  onFocusItem={setFocusedItemId}
                  onRouteOverrideChange={onSaveRouteOverride}
                  onRouteEditCollaborationEvent={onRouteEditCollaborationEvent}
                  onRouteEditPresenceChange={onRouteEditPresenceChange}
                />
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
    items.find((item) => !isCalendarToday || !isTimedVisit(item) || item.start_time >= currentTime) || items[0] || null;
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
                  <time>{isTimedVisit(item) ? formatTimeDisplay(item.start_time) : "--:--"}</time>
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
          <p>{nextStop?.location || (isTimedVisit(nextStop) ? formatTimeDisplay(nextStop.start_time) : "") || "新增行程後會顯示"}</p>
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

function DayTabs({ activeDay, days, layoutMode = "expanded", onActiveDay, dayTabPresenceByDay = new Map() }) {
  const dragStateRef = useRef({ isDragging: false, startX: 0, scrollLeft: 0, moved: false, lastX: 0, lastTime: 0, velocity: 0 });
  const momentumFrameRef = useRef(null);
  const navRef = useRef(null);
  const suppressClickRef = useRef(false);
  const [tabScrollState, setTabScrollState] = useState({ left: false, right: false });

  function updateTabScrollState() {
    const nav = navRef.current;
    if (!nav) return;
    const maxScrollLeft = Math.max(0, nav.scrollWidth - nav.clientWidth);
    setTabScrollState({
      left: nav.scrollLeft > 1,
      right: nav.scrollLeft < maxScrollLeft - 1,
    });
  }

  function stopMomentum() {
    if (momentumFrameRef.current) {
      window.cancelAnimationFrame(momentumFrameRef.current);
      momentumFrameRef.current = null;
    }
  }

  function glideTabs(nav, velocity) {
    if (Math.abs(velocity) < 0.02) {
      momentumFrameRef.current = null;
      return;
    }
    nav.scrollLeft -= velocity * 16;
    momentumFrameRef.current = window.requestAnimationFrame(() => glideTabs(nav, velocity * 0.92));
  }

  function startDrag(event) {
    const nav = event.currentTarget;
    stopMomentum();
    dragStateRef.current = {
      isDragging: true,
      startX: event.clientX,
      scrollLeft: nav.scrollLeft,
      moved: false,
      lastX: event.clientX,
      lastTime: performance.now(),
      velocity: 0,
    };
    nav.setPointerCapture(event.pointerId);
  }

  function dragTabs(event) {
    const dragState = dragStateRef.current;
    if (!dragState.isDragging) return;
    const now = performance.now();
    const distance = event.clientX - dragState.startX;
    const elapsed = Math.max(now - dragState.lastTime, 1);
    if (Math.abs(distance) > 12) dragState.moved = true;
    dragState.velocity = (event.clientX - dragState.lastX) / elapsed;
    dragState.lastX = event.clientX;
    dragState.lastTime = now;
    event.currentTarget.scrollLeft = dragState.scrollLeft - distance;
  }

  function endDrag(event) {
    const nav = event.currentTarget;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (dragStateRef.current.moved) {
      suppressClickRef.current = true;
      glideTabs(nav, dragStateRef.current.velocity);
    } else {
      const hitTarget = document.elementFromPoint(event.clientX, event.clientY);
      const tab = hitTarget ? hitTarget.closest(".day-tab") : null;
      const dayIndex = tab ? Number(tab.dataset.dayIndex) : NaN;
      if (Number.isInteger(dayIndex)) onActiveDay(dayIndex);
    }
    dragStateRef.current.isDragging = false;
  }

  function selectDay(index) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onActiveDay(index);
  }

  function scrollTabs(direction) {
    const nav = navRef.current;
    if (!nav) return;
    stopMomentum();
    nav.scrollBy({ left: direction * Math.max(nav.clientWidth * 0.72, 160), behavior: "smooth" });
  }

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    function alignActiveTab() {
      if (activeDay === 0) {
        nav.scrollLeft = 0;
        return;
      }
      if (activeDay === days.length - 1) {
        nav.scrollLeft = nav.scrollWidth - nav.clientWidth;
        return;
      }
      const activeTab = nav.querySelector(`[data-day-index="${activeDay}"]`);
      activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    alignActiveTab();
    updateTabScrollState();
    const frame = window.requestAnimationFrame(() => {
      alignActiveTab();
      updateTabScrollState();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeDay, days.length, layoutMode]);

  useEffect(() => {
    updateTabScrollState();
    window.addEventListener("resize", updateTabScrollState);
    return () => window.removeEventListener("resize", updateTabScrollState);
  }, [days.length, layoutMode]);

  return (
    <div
      className={`day-tabs-shell ${layoutMode === "collapsed" ? "is-collapsed" : "is-expanded"}${
        tabScrollState.left ? " has-left-edge" : ""
      }${tabScrollState.right ? " has-right-edge" : ""}`}
    >
      {tabScrollState.left ? (
        <button className="day-tabs-edge left" type="button" aria-label="向左滑動日期" onClick={() => scrollTabs(-1)}>
          ‹
        </button>
      ) : null}
      <nav
      className="day-tabs"
      ref={navRef}
      aria-label="日期切換"
      onPointerDown={startDrag}
      onPointerMove={dragTabs}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onScroll={updateTabScrollState}
      onPointerLeave={(event) => {
        if (dragStateRef.current.isDragging) endDrag(event);
      }}
    >
      {days.map((date, index) => {
        const presences = dayTabPresenceByDay.get(index) || [];
        const firstPresence = presences[0] || null;
        return (
          <button
            className={`day-tab${index === activeDay ? " active" : ""}${firstPresence ? " has-remote-presence" : ""}`}
            data-day-index={index}
            key={date.toISOString()}
            style={firstPresence ? { "--trip-presence-color": timelineCardSelectionColor(firstPresence.colorKey) } : undefined}
            type="button"
            onClick={() => selectDay(index)}
          >
          <span className="day-tab-index">DAY {index + 1}</span>
          <span className="day-tab-separator" aria-hidden="true">
            ·
          </span>
          <span className="day-tab-date">{formatDayTabDate(date)}</span>
          </button>
        );
      })}
      </nav>
      {tabScrollState.right ? (
        <button className="day-tabs-edge right" type="button" aria-label="向右滑動日期" onClick={() => scrollTabs(1)}>
          ›
        </button>
      ) : null}
    </div>
  );
}

function VersionInfoDialog({ onClose }) {
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="dialog-card version-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="version-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="version-dialog-logo" aria-hidden="true">TP</div>
        <div className="version-dialog-heading">
          <span className="version-dialog-stage">Development Preview</span>
          <h2 id="version-dialog-title">旅程工房</h2>
          <p>Travel Studio</p>
        </div>
        <dl className="version-dialog-facts">
          <div>
            <dt>當前版本</dt>
            <dd>v{appVersion}</dd>
          </div>
          <div>
            <dt>產品類型</dt>
            <dd>Collaborative Travel Web App</dd>
          </div>
          <div>
            <dt>開發者</dt>
            <dd>PeterChiu</dd>
          </div>
        </dl>
        <button className="ghost-button version-dialog-close" type="button" onClick={onClose}>
          關閉
        </button>
      </div>
    </div>
  );
}

function SortableTimelineEntry({ children, disabled = false, hasFlowAttachments = false, id }) {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    animateLayoutChanges: timelineAnimateLayoutChanges,
    disabled: { draggable: disabled, droppable: false },
    id,
  });
  const style = {
    transform: DndCSS.Transform.toString(transform),
    transition,
  };
  return (
    <div
      className={`timeline-flow-entry timeline-sortable-entry${hasFlowAttachments ? " has-flow-attachments" : ""}${
        isDragging ? " sortable-active-placeholder" : ""
      }`}
      data-sortable-visit-id={id}
      ref={setNodeRef}
      style={style}
    >
      <TimelineDragHandleContext.Provider value={disabled ? null : { attributes, listeners }}>
        {children}
      </TimelineDragHandleContext.Provider>
    </div>
  );
}

function TimelineDragHandle({ children, className = "" }) {
  const dragHandle = useContext(TimelineDragHandleContext);
  return (
    <div
      className={className}
      data-drag-handle={dragHandle ? "true" : undefined}
      {...(dragHandle?.attributes || {})}
      {...(dragHandle?.listeners || {})}
    >
      {children}
    </div>
  );
}

function TimelineFlowAttachment({ children }) {
  return (
    <div
      className="timeline-flow-attachment"
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
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
  canPickMapPoint = false,
  isPickingMapPoint = false,
  isMapSearchReplaceActive = false,
  pickedMapPoint = null,
  foreignCardSelection = null,
  foreignDragPresence = null,
  foreignSameDayDragActive = false,
  headingEyebrow = "行程",
  members,
  onApplyAlternative,
  onClearDragPresence,
  onConfirmTransportWarning,
  onDeleteAlternative,
  onDeleteItem,
  onClearCardSelection,
  onFocusItem,
  onCancelMapPointPick,
  onCancelMapSearchReplace,
  onMapPointEditorActiveChange,
  onStartMapAddLocation,
  onStartMapSearchReplace,
  onStartMapPointPick,
  onPublishCardSelection,
  onPublishDragPresence,
  onReorderDestinationPackages,
  onReorderUntimedVisit,
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
  const [mapUrlError, setMapUrlError] = useState("");
  const [isResolvingMapUrl, setIsResolvingMapUrl] = useState(false);
  const [isMapPointExpanded, setIsMapPointExpanded] = useState(false);
  const [durationInput, setDurationInput] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [alternativeFaceByItem, setAlternativeFaceByItem] = useState({});
  const [isAlternativeEditorOpen, setIsAlternativeEditorOpen] = useState(false);
  const [isAlternativeDeleteConfirmOpen, setIsAlternativeDeleteConfirmOpen] = useState(false);
  const [alternativeErrorByItem, setAlternativeErrorByItem] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [fixedNotice, setFixedNotice] = useState("");
  const [draggedVisitId, setDraggedVisitId] = useState(null);
  const [dragOverlaySize, setDragOverlaySize] = useState(null);
  const [dragTarget, setDragTarget] = useState(null);
  const [reorderPreview, setReorderPreview] = useState(null);
  const [isReorderingDestination, setIsReorderingDestination] = useState(false);
  const [isReorderingUntimed, setIsReorderingUntimed] = useState(false);
  const [untimedDropNotice, setUntimedDropNotice] = useState("");
  const [transportPairConflict, setTransportPairConflict] = useState(null);
  const [isResolvingTransportPairConflict, setIsResolvingTransportPairConflict] = useState(false);
  const [autoContinuationPrompt, setAutoContinuationPrompt] = useState(null);
  const [isSavingAutoContinuation, setIsSavingAutoContinuation] = useState(false);
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
  const foreignDragMember = foreignDragPresence?.userId ? memberById.get(foreignDragPresence.userId) : null;
  const foreignDragUserName = foreignDragPresence?.userName || (foreignDragMember ? memberName(foreignDragMember) : "其他成員");
  const foreignDragOverItemId = foreignSameDayDragActive ? foreignDragPresence?.overItemId : null;
  const foreignDragPlacement = foreignSameDayDragActive ? foreignDragPresence?.placement : null;
  const foreignDragSourceItemId = foreignSameDayDragActive ? foreignDragPresence?.itemId : null;
  const foreignDragColor = foreignSameDayDragActive
    ? timelineCardSelectionColor(
        timelineCollaboratorColorKey(
          foreignDragPresence?.userId,
          foreignDragPresence?.sessionId || foreignDragPresence?.dragId,
        ),
      )
    : "";
  const foreignDragStyle = foreignDragColor
    ? {
        "--timeline-remote-drag-color": foreignDragColor,
        "--timeline-remote-drag-color-soft": `${foreignDragColor}22`,
      }
    : undefined;
  const visibleForeignCardSelection =
    !foreignSameDayDragActive &&
    foreignCardSelection &&
    Number(foreignCardSelection.dayIndex) === Number(activeDay)
      ? foreignCardSelection
      : null;
  const canMutateThisDay = canEdit && !foreignSameDayDragActive;
  const foreignDragReadOnlyMessage = foreignSameDayDragActive
    ? `${foreignDragUserName} 正在拖曳，暫時鎖定此日編輯。`
    : "";
  const foreignDragSaveBlockedMessage = "此日行程正在被其他成員調整，請稍後再儲存。";
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
    setExpandedId(null);
  }, [activeDay, activeTrip?.id]);

  useEffect(() => {
    setExpandedId((current) => (current && current !== focusedItemId ? null : current));
  }, [focusedItemId]);

  const hasBlockingTimelineEditor =
    isOpen || hasActiveEditorGuard({ excludeId: activeEditorGuardId, tripId: activeTrip?.id });
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const lastDndOverIdRef = useRef(null);
  const activeDayColumnRef = useRef(null);
  const activeTimelineListRef = useRef(null);
  const newVisitEditorRef = useRef(null);
  const visitDurationRef = useRef(null);
  const mapUrlApplyRef = useRef(false);
  const lastAppliedMapPointPickRef = useRef(null);
  const restrictTimelineDragToDayColumn = useCallback(
    ({ activeNodeRect, overlayNodeRect, transform }) => {
      const columnRect = activeDayColumnRef.current?.getBoundingClientRect();
      const timelineRect = activeTimelineListRef.current?.getBoundingClientRect();
      if (!columnRect || !activeNodeRect) return { ...transform, x: 0 };
      const overlayHeight = overlayNodeRect?.height || dragOverlaySize?.height || activeNodeRect.height || 0;
      const minY = (timelineRect?.top || columnRect.top) - activeNodeRect.top;
      const maxY = columnRect.bottom - activeNodeRect.top - overlayHeight;
      return {
        ...transform,
        x: 0,
        y: Math.min(Math.max(transform.y, minY), Math.max(minY, maxY)),
      };
    },
    [dragOverlaySize?.height],
  );

  useEffect(() => {
    clearVisitDrag("scope-change");
  }, [activeDay, activeTrip?.id]);

  useEffect(() => {
    if (!draggedVisitId) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") clearVisitDrag("escape");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      lastDndOverIdRef.current = null;
    };
  }, [draggedVisitId]);

  function canDragReorderVisit(item) {
    return (
      canMutateThisDay &&
      !hasBlockingTimelineEditor &&
      !isReorderingDestination &&
      isTimedVisit(item) &&
      !isEffectiveFixedVisit(item) &&
      !(useEditLocks && isLockedByAnotherUser(item, currentUserId))
    );
  }

  function canDragUntimedVisit(item) {
    return (
      canMutateThisDay &&
      !hasBlockingTimelineEditor &&
      !isReorderingDestination &&
      !isReorderingUntimed &&
      isUntimedVisit(item) &&
      !(useEditLocks && isLockedByAnotherUser(item, currentUserId))
    );
  }

  function canDragVisit(item) {
    return canDragReorderVisit(item) || canDragUntimedVisit(item);
  }

  function canTargetDraggedVisit(item, sourceId = draggedVisitId) {
    const source = dayItems.find((candidate) => candidate.id === sourceId);
    if (!source || source.id === item?.id || isTransportationCard(item)) return false;
    return isUntimedVisit(source) ? true : canDragReorderVisit(source);
  }

  function sortableDropIntent(sourceItemId, targetItemId) {
    if (!sourceItemId || !targetItemId || sourceItemId === targetItemId) return null;
    const sourceIndex = visitItems.findIndex((item) => item.id === sourceItemId);
    const targetIndex = visitItems.findIndex((item) => item.id === targetItemId);
    if (sourceIndex < 0 || targetIndex < 0) return null;
    return sourceIndex < targetIndex ? "after" : "before";
  }

  function previewSortableDrag(sourceItemId, targetItemId) {
    const source = dayItems.find((candidate) => candidate.id === sourceItemId);
    const target = dayItems.find((candidate) => candidate.id === targetItemId);
    const placement = sortableDropIntent(sourceItemId, targetItemId);
    if (!source || !target || !placement || !canTargetDraggedVisit(target, sourceItemId)) {
      setDragTarget(targetItemId ? { disabled: true, errorCode: "invalid_target", itemId: targetItemId, placement: placement || "after" } : null);
      return false;
    }
    if (isUntimedVisit(source)) {
      const plan = planUntimedVisitReorder({ items: dayItems, placement, sourceItemId: source.id, targetItemId: target.id });
      setUntimedDropNotice(plan.ok ? "" : untimedOrderingErrorMessage(plan.errorCode));
      setDragTarget({ disabled: !plan.ok, errorCode: plan.errorCode || "", itemId: target.id, placement });
      return plan.ok;
    }
    const plan = planMixedTimedVisitReorder({
      items: dayItems,
      placement,
      sourceItemId: source.id,
      targetItemId: target.id,
    });
    if (!plan.ok) {
      setFixedNotice(destinationReorderErrorMessage({ message: plan.errorCode }));
      setDragTarget({ disabled: true, errorCode: plan.errorCode || "", itemId: target.id, placement });
      return false;
    }
    setFixedNotice("");
    setDragTarget({ disabled: false, itemId: target.id, placement });
    return true;
  }

  function handleSortableDragStart(event) {
    const sourceItem = dayItems.find((item) => item.id === event.active.id);
    if (!sourceItem || !canDragVisit(sourceItem)) return;
    if (typeof onClearCardSelection === "function") onClearCardSelection();
    const sourceRect = event.active.rect.current.initial;
    setDragOverlaySize(
      sourceRect?.width && sourceRect?.height ? { height: sourceRect.height, width: sourceRect.width } : null,
    );
    setFixedNotice("");
    setUntimedDropNotice("");
    setDraggedVisitId(sourceItem.id);
    setDragTarget(null);
    if (typeof onPublishDragPresence === "function") {
      onPublishDragPresence({
        resetDrag: true,
        forceTrack: true,
        itemId: sourceItem.id,
        itemTitle: visitDestination(sourceItem),
        overItemId: null,
        placement: null,
      });
    }
    lastDndOverIdRef.current = null;
  }

  function handleSortableDragOver(event) {
    const sourceItemId = event.active?.id;
    const targetItemId = event.over?.id;
    if (!sourceItemId || !targetItemId || sourceItemId === targetItemId) {
      setDragTarget(null);
      if (typeof onPublishDragPresence === "function" && sourceItemId) {
        onPublishDragPresence({ overItemId: null, placement: null });
      }
      lastDndOverIdRef.current = targetItemId || null;
      return;
    }
    if (lastDndOverIdRef.current === targetItemId) return;
    lastDndOverIdRef.current = targetItemId;
    const previewOk = previewSortableDrag(sourceItemId, targetItemId);
    const placement = sortableDropIntent(sourceItemId, targetItemId);
    if (typeof onPublishDragPresence === "function") {
      onPublishDragPresence({
        overItemId: previewOk ? targetItemId : null,
        placement: previewOk ? placement : null,
      });
    }
  }

  function handleSortableDragCancel() {
    timelineDragPresenceDebug("drag end branch name", { branch: "cancel" });
    clearVisitDrag("cancel");
  }

  async function handleSortableDragEnd(event) {
    const sourceItemId = event.active?.id;
    const targetItemId = event.over?.id;
    const targetItem = dayItems.find((item) => item.id === targetItemId);
    const placement = sortableDropIntent(sourceItemId, targetItemId);
    if (!sourceItemId || !targetItem || !placement || sourceItemId === targetItemId) {
      const branch = sourceItemId && sourceItemId === targetItemId ? "noop" : "invalid";
      timelineDragPresenceDebug("drag end branch name", { branch, sourceItemId, targetItemId });
      clearVisitDrag(`drag-end-${branch}`);
      return;
    }
    timelineDragPresenceDebug("drag end branch name", { branch: "drop", placement, sourceItemId, targetItemId });
    clearVisitDrag("drag-end-drop");
    await commitVisitDrop(sourceItemId, targetItem, placement);
  }

  function beginVisitDrag(event, item) {
    if (!canDragVisit(item)) {
      event.preventDefault();
      if (hasBlockingTimelineEditor) setFixedNotice("請先儲存或放棄目前編輯，再重排行程。");
      else if (timedVisitItems.some((visit) => visit.is_fixed)) setFixedNotice("當天包含固定行程，無法進行插入式重排。");
      else if (timedVisitItems.some((visit) => useEditLocks && isLockedByAnotherUser(visit, currentUserId))) {
        setFixedNotice("當天其中一個行程目前正由其他成員編輯。");
      }
      return;
    }
    if (typeof onClearCardSelection === "function") onClearCardSelection();
    setFixedNotice("");
    setUntimedDropNotice("");
    setDraggedVisitId(item.id);
    setDragTarget(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.id);
  }

  function updateVisitDragTarget(event, item) {
    if (!draggedVisitId || !canTargetDraggedVisit(item)) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const placement = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    const source = dayItems.find((candidate) => candidate.id === draggedVisitId);
    if (isUntimedVisit(source)) {
      const plan = planUntimedVisitReorder({ items: dayItems, placement, sourceItemId: source.id, targetItemId: item.id });
      event.dataTransfer.dropEffect = "move";
      setUntimedDropNotice(plan.ok ? "" : untimedOrderingErrorMessage(plan.errorCode));
      setDragTarget({ disabled: !plan.ok, errorCode: plan.errorCode || "", itemId: item.id, placement });
      return;
    }
    event.dataTransfer.dropEffect = "move";
    setDragTarget({ disabled: false, itemId: item.id, placement });
  }

  function clearVisitDrag(reason = "manual") {
    setDraggedVisitId(null);
    setDragOverlaySize(null);
    setDragTarget(null);
    lastDndOverIdRef.current = null;
    if (typeof onClearDragPresence === "function") onClearDragPresence(reason);
  }

  async function commitVisitDrop(sourceItemId, targetItem, placement) {
    if (!sourceItemId || sourceItemId === targetItem.id) {
      clearVisitDrag("commit-noop");
      return;
    }
    const sourceItem = dayItems.find((item) => item.id === sourceItemId);
    if (!sourceItem || !canTargetDraggedVisit(targetItem, sourceItem.id)) {
      timelineDragPresenceDebug("drag end branch name", { branch: "invalid-target", sourceItemId, targetItemId: targetItem.id });
      clearVisitDrag("commit-invalid-target");
      return;
    }
    if (isUntimedVisit(sourceItem)) {
      const plan = planUntimedVisitReorder({
        items: dayItems,
        placement,
        sourceItemId: sourceItem.id,
        targetItemId: targetItem.id,
      });
      clearVisitDrag("commit-untimed-plan");
      if (!plan.ok) {
        timelineDragPresenceDebug("drag end branch name", { branch: "untimed-blocked", errorCode: plan.errorCode });
        setUntimedDropNotice(untimedOrderingErrorMessage(plan.errorCode));
        return;
      }
      if (plan.noOp) {
        timelineDragPresenceDebug("drag end branch name", { branch: "untimed-noop" });
        return;
      }
      if (typeof onReorderUntimedVisit !== "function") {
        setUntimedDropNotice("未設定時間行程移動失敗，請稍後再試。");
        return;
      }
      const brokenTransportIds = new Set(plan.brokenTransportIds || []);
      const transportBaselines = dayItems
        .filter((item) => isTransportationCard(item) && brokenTransportIds.has(item.id))
        .map((transport) => ({ id: transport.id, updatedAt: transport.updated_at }));
      const untimedReorder = {
        dayIndex: activeDay,
        itemId: sourceItem.id,
        kind: "untimed",
        sortOrder: plan.sortOrder,
        transportBaselines,
        updatedAt: sourceItem.updated_at,
      };
      if (transportBaselines.length) {
        timelineDragPresenceDebug("drag end branch name", { branch: "untimed-confirmation", transportCount: transportBaselines.length });
        setReorderPreview(untimedReorder);
        return;
      }
      timelineDragPresenceDebug("drag end branch name", { branch: "untimed-rpc" });
      setIsReorderingUntimed(true);
      const result = await onReorderUntimedVisit(untimedReorder);
      if (!result?.ok) setUntimedDropNotice(result?.errorMessage || "未設定時間行程移動失敗，請稍後再試。");
      else setUntimedDropNotice("");
      setIsReorderingUntimed(false);
      return;
    }
    if (!sourceItem || !canDragReorderVisit(sourceItem) || typeof onReorderDestinationPackages !== "function") {
      timelineDragPresenceDebug("drag end branch name", { branch: "timed-blocked" });
      clearVisitDrag("commit-timed-blocked");
      return;
    }
    const mixedPlan = planMixedTimedVisitReorder({
      items: dayItems,
      placement,
      sourceItemId: sourceItem.id,
      targetItemId: targetItem.id,
    });
    if (!mixedPlan.ok) {
      setFixedNotice(destinationReorderErrorMessage({ message: mixedPlan.errorCode }));
      timelineDragPresenceDebug("drag end branch name", { branch: "timed-mixed-blocked", errorCode: mixedPlan.errorCode });
      clearVisitDrag("commit-timed-mixed-blocked");
      return;
    }
    const { brokenTransportIds = [], packageSourceItemIds, slotItemIds, untimedSortOrderUpdates } = mixedPlan;
    const previewPlan = planDestinationPackageReorder({
      items: dayItems,
      orderedTimedItemIds: mixedPlan.orderedTimedItemIds,
      orderedVisitItemIds: mixedPlan.orderedVisitItemIds,
      slotItemIds,
      packageSourceItemIds,
      timedAutoContinuation: true,
    });
    if (!previewPlan.ok) {
      setFixedNotice(destinationReorderErrorMessage({ message: previewPlan.errorCode }));
      timelineDragPresenceDebug("drag end branch name", { branch: "timed-preview-blocked", errorCode: previewPlan.errorCode });
      clearVisitDrag("commit-timed-preview-blocked");
      return;
    }
    const finalUntimedSortOrderUpdates = previewPlan.convertedSlotIds?.length
      ? previewPlan.untimedSortOrderUpdates || []
      : untimedSortOrderUpdates;
    const previewDeletedTransportIds = new Set(previewPlan.deletedTransportIds);
    const explicitTransportBaselines = [...new Set(brokenTransportIds)]
      .filter((transportId) => !previewDeletedTransportIds.has(transportId))
      .map((transportId) => {
        const transport = dayItems.find((item) => item.id === transportId);
        return transport ? { id: transport.id, updatedAt: transport.updated_at } : null;
      })
      .filter(Boolean);
    const timedReorder = {
      dayIndex: activeDay,
      kind: "timed",
      orderedTimedItemIds: mixedPlan.orderedTimedItemIds,
      orderedVisitItemIds: mixedPlan.orderedVisitItemIds,
      packageSourceItemIds,
      slotItemIds,
      timedAutoContinuation: true,
      transportBaselines: explicitTransportBaselines,
      untimedSortOrderUpdates: finalUntimedSortOrderUpdates,
    };
    if (previewPlan.deletedTransportIds.length || explicitTransportBaselines.length) {
      timelineDragPresenceDebug("drag end branch name", {
        branch: "timed-confirmation",
        deletedTransportCount: previewPlan.deletedTransportIds.length,
        transportCount: explicitTransportBaselines.length,
      });
      setReorderPreview(timedReorder);
      return;
    }
    timelineDragPresenceDebug("drag end branch name", { branch: "timed-rpc" });
    setIsReorderingDestination(true);
    const result = await onReorderDestinationPackages(timedReorder);
    if (!result?.ok) setFixedNotice(result?.errorMessage || destinationReorderErrorMessage(result?.error));
    setIsReorderingDestination(false);
  }

  async function confirmMoveReorder() {
    if (!reorderPreview) return;
    if (foreignSameDayDragActive) {
      setFixedNotice(foreignDragSaveBlockedMessage);
      return;
    }
    if (reorderPreview.kind === "untimed") {
      if (typeof onReorderUntimedVisit !== "function") return;
      setIsReorderingUntimed(true);
      const result = await onReorderUntimedVisit(reorderPreview);
      if (!result?.ok) setUntimedDropNotice(result?.errorMessage || "未設定時間行程移動失敗，請稍後再試。");
      else {
        setUntimedDropNotice("");
        setReorderPreview(null);
      }
      setIsReorderingUntimed(false);
      return;
    }
    if (typeof onReorderDestinationPackages !== "function") return;
    setIsReorderingDestination(true);
    const result = await onReorderDestinationPackages(reorderPreview);
    if (!result?.ok) setFixedNotice(result?.errorMessage || "目的地內容重排失敗，請稍後再試。");
    if (result?.ok) setReorderPreview(null);
    setIsReorderingDestination(false);
  }

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
    setMapUrlError("");
    setIsAlternativeEditorOpen(false);
    setTransportPairConflict(null);
    setAutoContinuationPrompt(null);
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
    if (isEffectiveFixedVisit(matchingItem)) return;
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
    setMapUrlError("");
    setIsAlternativeEditorOpen(false);
    setTransportPairConflict(null);
    setAutoContinuationPrompt(null);
    setEditingId(latest.entityId === "new" ? null : latest.entityId);
    setEditorTripId(activeTrip.id);
    setInsertionPair(null);
    setRestoredDraftKey(latest.key);
    setIsOpen(true);
  }, [activeTrip?.id, currentUserId, dayItems, isOpen, restoreDrafts]);

  function buildNewVisitForm(initialPoint = null) {
    const lastItem = sortedVisitItems(dayItems).at(-1);
    const tailSuggestedStartTime = suggestedStartTimeFromTailTransport(dayItems);
    const defaultStartTime = tailSuggestedStartTime || (lastItem?.end_time ? formatTimeDisplay(lastItem.end_time) : "");
    const defaultStartMinutes = timeToMinutes(defaultStartTime);
    const defaultEndTime = defaultStartMinutes === null
      ? ""
      : minutesToTimeValue(defaultStartMinutes + defaultVisitDurationMinutes);
    const latitude = Number(initialPoint?.latitude);
    const longitude = Number(initialPoint?.longitude);
    const hasPoint = Number.isFinite(latitude) && Number.isFinite(longitude);
    const placeName = String(initialPoint?.displayName || initialPoint?.title || initialPoint?.location_name || "").trim();
    return {
      ...emptyItemForm,
      start_time: defaultStartTime,
      end_time: defaultEndTime,
      title: placeName,
      location: placeName,
      location_name: placeName,
      latitude: hasPoint ? latitude : null,
      longitude: hasPoint ? longitude : null,
      map_url: hasPoint
        ? String(initialPoint?.googleMapsUri || "").trim() || googleMapsPointUrl(latitude, longitude)
        : "",
    };
  }

  async function openNewItem(initialPoint = null) {
    if (foreignSameDayDragActive) {
      setFixedNotice(foreignDragReadOnlyMessage);
      return;
    }
    if (!initialPoint) onCancelMapPointPick?.();
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
    const nextForm = buildNewVisitForm(initialPoint);
    flushDraft();
    replaceForm(nextForm);
    setFormSeed(nextForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setTimeError("");
    setMapUrlError("");
    setIsMapPointExpanded(false);
    setIsAlternativeDeleteConfirmOpen(false);
    setIsAlternativeEditorOpen(false);
    setTransportPairConflict(null);
    setAutoContinuationPrompt(null);
    setEditingId(null);
    setEditorTripId(activeTrip?.id || null);
    setInsertionPair(null);
    setRestoredDraftKey(null);
    setIsOpen(true);
  }

  async function openNewTransport(previousItem, nextItem) {
    if (foreignSameDayDragActive) {
      setFixedNotice(foreignDragReadOnlyMessage);
      return;
    }
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
    setMapUrlError("");
    setIsAlternativeEditorOpen(false);
    setTransportPairConflict(null);
    setAutoContinuationPrompt(null);
    setEditingId(null);
    setEditorTripId(activeTrip?.id || null);
    setInsertionPair(previousItem ? { fromId: previousItem.id, toId: nextItem?.id || null } : null);
    setRestoredDraftKey(null);
    setIsOpen(true);
    onFocusItem(nextItem?.id || previousItem?.id);
  }

  async function openEditItem(item, { openAlternative = false } = {}) {
    if (foreignSameDayDragActive) {
      setFixedNotice(foreignDragReadOnlyMessage);
      return;
    }
    if (isEffectiveFixedVisit(item)) {
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
    const suggestedUntimedStartTime = suggestedStartTimeForUntimedAfterTailTransport(dayItems, item);
    const existingAlternative = (alternativesByItem[item.id] || [])[0] || null;
    const nextForm = {
      item_type: item.item_type || "visit",
      type: item.type,
      start_time: formatTimeDisplay(item.start_time) || suggestedUntimedStartTime,
      end_time: formatTimeDisplay(item.end_time),
      title: item.title,
      location: item.location_name || item.location || "",
      location_name: item.location_name || item.location || "",
      address: item.address || "",
      map_url: item.map_url || "",
      latitude: item.latitude ?? null,
      longitude: item.longitude ?? null,
      note: item.description || item.note || "",
      description: item.description || item.note || "",
      transportation_note: item.transportation_note || "",
      transport_category: item.transport_category || defaultTransportCategory,
      transport_name: transportNameValue(item),
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
      alternative_id: existingAlternative?.id || null,
      alternative_draft: existingAlternative ? alternativeToForm(existingAlternative) : null,
      alternative_deleted: false,
      alternative_map_url_baseline: existingAlternative?.map_url || "",
    };
    flushDraft();
    replaceForm(nextForm);
    setFormSeed(nextForm);
    setBaseUpdatedAt(lockedItem.updated_at || item.updated_at || null);
    setConflict(false);
    setTimeError("");
    setMapUrlError("");
    setIsMapPointExpanded(false);
    setIsAlternativeEditorOpen(Boolean(openAlternative));
    setTransportPairConflict(null);
    setAutoContinuationPrompt(null);
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
    setMapUrlError("");
    setIsMapPointExpanded(false);
    setIsAlternativeDeleteConfirmOpen(false);
    setIsAlternativeEditorOpen(false);
    setTransportPairConflict(null);
    setAutoContinuationPrompt(null);
    setEditingId(null);
    setEditorTripId(null);
    setInsertionPair(null);
    setRestoredDraftKey(null);
    onCancelMapPointPick?.();
    onCancelMapSearchReplace?.();
    setIsOpen(false);
  }

  async function saveCurrentEditor(formData = new FormData(), options = {}) {
    const itemType = String(formData.get("item_type") ?? form.item_type ?? "visit");
    const editingItem = editingId ? dayItems.find((item) => item.id === editingId) : null;
    if (foreignSameDayDragActive) {
      setTimeError(foreignDragSaveBlockedMessage);
      return false;
    }
    if (isEffectiveFixedVisit(editingItem)) {
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
      const transportCategory = submittedForm.transport_category.trim();
      const transportDurationMinutes = parseDurationMinutes(submittedForm.transport_duration_minutes);
      if (!transportCategory) {
        setTimeError("請選擇交通類別。");
        setForm(submittedForm);
        return false;
      }
      if (!Number.isInteger(transportDurationMinutes) || transportDurationMinutes <= 0) {
        setTimeError("交通時間請輸入大於 0 的整數分鐘。");
        setForm(submittedForm);
        return false;
      }
      submittedForm.transport_category = transportCategory;
      submittedForm.transport_duration_minutes = String(transportDurationMinutes);
      submittedForm.transport_name = submittedForm.transport_name.trim();
      submittedForm.title = submittedForm.transport_name;
      submittedForm.transportation_note = submittedForm.transport_note.trim();
      submittedForm.note = submittedForm.transport_note.trim();
      submittedForm.description = submittedForm.transport_note.trim();
    } else {
      const normalizedStart = normalizeTimelineTimeInput(submittedForm.start_time);
      const normalizedEnd = normalizeTimelineTimeInput(submittedForm.end_time);
      if (!normalizedStart.ok || !normalizedEnd.ok) {
        setTimeError("請輸入有效的 24 小時時間，例如 09:45。");
        setForm(submittedForm);
        return false;
      }
      submittedForm.start_time = normalizedStart.value;
      submittedForm.end_time = normalizedEnd.value;
      if (!submittedForm.start_time || !submittedForm.end_time) {
        submittedForm.start_time = "";
        submittedForm.end_time = "";
      }
      submittedForm.address = "";
      submittedForm.transportation_note = "";
      submittedForm.cost = "0";
    }
    const invalidTimeRange =
      submittedForm.item_type !== "transport" && isInvalidTimeRange(submittedForm.start_time, submittedForm.end_time);
    if (invalidTimeRange) {
      setTimeError("結束時間必須晚於開始時間。");
      setForm(submittedForm);
      return false;
    }
    const overlapItem = findOverlappingVisitItem({
      dayIndex: activeDay,
      editingId,
      items: dayItems,
      payload: submittedForm,
    });
    if (overlapItem) {
      setTimeError(formatTimelineOverlapError(overlapItem));
      setForm(submittedForm);
      return false;
    }
    const mapPointChanged =
      !editingItem ||
      String(submittedForm.map_url || "").trim() !== String(editingItem.map_url || "").trim() ||
      Number(submittedForm.latitude) !== Number(editingItem.latitude) ||
      Number(submittedForm.longitude) !== Number(editingItem.longitude);
    if (submittedForm.item_type !== "transport" && mapPointChanged) {
      if (isResolvingMapUrl) return false;
      setIsResolvingMapUrl(true);
      let mapUrlValidation;
      try {
        mapUrlValidation = await resolveDestinationMapUrlPoint(submittedForm.map_url, {
          resolveShortUrl: resolveGoogleMapsShortUrl,
        });
      } finally {
        setIsResolvingMapUrl(false);
      }
      if (!mapUrlValidation.ok) {
        setTimeError("");
        setMapUrlError(mapUrlValidation.errorMessage);
        setForm(submittedForm);
        return false;
      }
      if (mapUrlValidation.resolvedByShortLink && mapUrlValidation.expandedUrl) {
        submittedForm.map_url = mapUrlValidation.expandedUrl;
      }
      if (mapUrlValidation.point) {
        submittedForm.latitude = mapUrlValidation.point.latitude;
        submittedForm.longitude = mapUrlValidation.point.longitude;
      }
      setMapUrlError("");
    }
    const currentPairSnapshot =
      submittedForm.item_type === "transport"
        ? buildTransportPairSnapshot(
            dayItems.find((item) => item.id === submittedForm.from_item_id),
            dayItems.find((item) => item.id === submittedForm.to_item_id),
          )
        : {};
    if (submittedForm.item_type !== "transport" && !options.transportConflict) {
      const brokenPair = findBrokenTransportationPair({
        candidate: submittedForm,
        dayIndex: activeDay,
        editingId,
        items: dayItems,
      });
      if (brokenPair) {
        setTimeError("");
        setForm(submittedForm);
        setTransportPairConflict({
          ...brokenPair,
          continuationRequested: Boolean(options.requestAutoContinuation),
        });
        return false;
      }
    }
    if (editingId && submittedForm.item_type !== "transport" && options.requestAutoContinuation) {
      const continuationPlan = planTimelineAutoContinuation({
        candidate: submittedForm,
        dayIndex: activeDay,
        editedItemId: editingId,
        items: dayItems,
      });
      if (continuationPlan.shouldPrompt) {
        const hasForeignLock = (continuationPlan.followingVisitIds || []).some((itemId) => {
          const item = dayItems.find((candidate) => candidate.id === itemId);
          return useEditLocks && isLockedByAnotherUser(item, currentUserId);
        });
        setTimeError("");
        setForm(submittedForm);
        setTransportPairConflict(null);
        setAutoContinuationPrompt({
          plan: hasForeignLock
            ? { ...continuationPlan, canAutoContinue: false, blockReason: "locked_visit", updates: [] }
            : continuationPlan,
          title: submittedForm.location_name || submittedForm.location || submittedForm.title,
          transportConflict: options.transportConflict || null,
        });
        return false;
      }
    }
    let pendingAlternative = submittedForm.alternative_deleted ? null : submittedForm.alternative_draft;
    if (submittedForm.item_type !== "transport" && pendingAlternative) {
      const alternativeDestinationName = String(pendingAlternative.location_name || "").trim();
      if (!alternativeDestinationName) {
        setTimeError("");
        setAlternativeErrorByItem((current) => ({
          ...current,
          [editingId || "new"]: "請輸入備案目的地。",
        }));
        setForm(submittedForm);
        setIsAlternativeEditorOpen(true);
        return false;
      }
      const alternativeMapUrl = String(pendingAlternative.map_url || "").trim();
      const alternativeMapUrlChanged = alternativeMapUrl !== String(submittedForm.alternative_map_url_baseline || "").trim();
      if (alternativeMapUrl && alternativeMapUrlChanged) {
        if (isResolvingMapUrl) return false;
        setIsResolvingMapUrl(true);
        let alternativeMapValidation;
        try {
          alternativeMapValidation = await resolveDestinationMapUrlPoint(alternativeMapUrl, {
            resolveShortUrl: resolveGoogleMapsShortUrl,
          });
        } finally {
          setIsResolvingMapUrl(false);
        }
        if (!alternativeMapValidation.ok) {
          setTimeError("");
          setMapUrlError(alternativeMapValidation.errorMessage);
          setForm(submittedForm);
          setIsAlternativeEditorOpen(true);
          setIsMapPointExpanded(true);
          return false;
        }
        pendingAlternative = {
          ...pendingAlternative,
          map_url: alternativeMapValidation.expandedUrl || alternativeMapUrl,
          ...(alternativeMapValidation.point
            ? {
                latitude: alternativeMapValidation.point.latitude,
                longitude: alternativeMapValidation.point.longitude,
              }
            : {}),
        };
        submittedForm.alternative_draft = pendingAlternative;
      }
    }
    setTimeError("");
    resetAlternativeError(editingId || "new");
    const {
      alternative_deleted: pendingAlternativeDeleted,
      alternative_draft: ignoredAlternativeDraft,
      alternative_id: pendingAlternativeId,
      alternative_map_url_baseline: ignoredAlternativeMapUrlBaseline,
      ...itemSubmittedForm
    } = submittedForm;
    const result = await onSaveItem(
      {
        ...itemSubmittedForm,
        title:
          itemSubmittedForm.item_type === "transport"
            ? itemSubmittedForm.transport_name.trim()
            : (itemSubmittedForm.location_name || itemSubmittedForm.location || itemSubmittedForm.title).trim(),
        location: (itemSubmittedForm.location_name || itemSubmittedForm.location).trim(),
        location_name: (itemSubmittedForm.location_name || itemSubmittedForm.location).trim(),
        address: itemSubmittedForm.address.trim(),
        map_url: itemSubmittedForm.map_url.trim(),
        latitude: itemSubmittedForm.latitude ?? null,
        longitude: itemSubmittedForm.longitude ?? null,
        note: (itemSubmittedForm.description || itemSubmittedForm.note).trim(),
        description: (itemSubmittedForm.description || itemSubmittedForm.note).trim(),
        transportation_note: itemSubmittedForm.transportation_note.trim(),
        transport_category: itemSubmittedForm.transport_category || defaultTransportCategory,
        transport_name: itemSubmittedForm.transport_name.trim(),
        transport_duration_minutes: Number(itemSubmittedForm.transport_duration_minutes || 0),
        transport_note: itemSubmittedForm.transport_note.trim(),
        from_item_id: itemSubmittedForm.from_item_id,
        to_item_id: itemSubmittedForm.to_item_id,
        ...currentPairSnapshot,
        cost: Number(itemSubmittedForm.cost || 0),
      },
      editingId,
      {
        baseUpdatedAt,
        tripId: editorTripId,
        transportConflict: options.transportConflict
          ? {
              id: options.transportConflict.id,
              updated_at: options.transportConflict.updated_at,
            }
          : null,
        autoContinuationUpdates: options.autoContinuationUpdates || [],
      },
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
      if (result?.baseUpdatedAt) setBaseUpdatedAt(result.baseUpdatedAt);
      if (result?.errorMessage) setTimeError(result.errorMessage);
      if (result?.conflict) setConflict(true);
      return false;
    }
    const savedItemId = editingId || result.data?.id;
    let alternativeResult = { ok: true };
    if (itemSubmittedForm.item_type !== "transport" && savedItemId) {
      if (pendingAlternativeDeleted && pendingAlternativeId) {
        alternativeResult = await onDeleteAlternative(pendingAlternativeId);
      } else if (pendingAlternative) {
        alternativeResult = await onSaveAlternative(
          savedItemId,
          {
            title: String(pendingAlternative.location_name || "").trim(),
            type: pendingAlternative.type || "attraction",
            start_time: itemSubmittedForm.start_time || "",
            end_time: itemSubmittedForm.end_time || "",
            cost: 0,
            location_name: String(pendingAlternative.location_name || "").trim(),
            description: String(pendingAlternative.description || "").trim(),
            address: String(pendingAlternative.address || "").trim(),
            map_url: String(pendingAlternative.map_url || "").trim(),
            latitude: pendingAlternative.latitude ?? null,
            longitude: pendingAlternative.longitude ?? null,
            transportation_note: "",
          },
          pendingAlternativeId || null,
        );
      }
    }
    if (!alternativeResult?.ok) {
      setForm(submittedForm);
      setBaseUpdatedAt(result.data?.updated_at || baseUpdatedAt);
      setAlternativeErrorByItem((current) => ({
        ...current,
        [editingId || "new"]: alternativeResult.error?.message || "備案儲存失敗，請稍後再試。",
      }));
      return false;
    }
    if (!disableDraftAutosave) clearDraft(draftKey);
    resetDraft(emptyItemForm);
    setFormSeed(emptyItemForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setTimeError("");
    setMapUrlError("");
    setTransportPairConflict(null);
    setAutoContinuationPrompt(null);
    setEditingId(null);
    setEditorTripId(null);
    setInsertionPair(null);
    setRestoredDraftKey(null);
    onCancelMapPointPick?.();
    setIsOpen(false);
    return true;
  }

  async function confirmBrokenTransportationPairDeletion() {
    if (!transportPairConflict?.transportItem || isResolvingTransportPairConflict) return;
    if (foreignSameDayDragActive) {
      setTimeError(foreignDragSaveBlockedMessage);
      return;
    }
    setIsResolvingTransportPairConflict(true);
    await saveCurrentEditor(new FormData(), {
      requestAutoContinuation: Boolean(transportPairConflict.continuationRequested),
      transportConflict: transportPairConflict.transportItem,
    });
    setIsResolvingTransportPairConflict(false);
  }

  function cancelAutoContinuation() {
    if (isSavingAutoContinuation) return;
    setTimeError("");
    setAutoContinuationPrompt(null);
  }

  async function saveWithAutoContinuation() {
    if (!autoContinuationPrompt?.plan?.canAutoContinue || isSavingAutoContinuation) return;
    if (foreignSameDayDragActive) {
      setTimeError(foreignDragSaveBlockedMessage);
      return;
    }
    setIsSavingAutoContinuation(true);
    await saveCurrentEditor(new FormData(), {
      skipAutoContinuation: true,
      transportConflict: autoContinuationPrompt.transportConflict,
      autoContinuationUpdates: autoContinuationPrompt.plan.updates,
    });
    setIsSavingAutoContinuation(false);
  }

  async function requestAutoContinuation(event) {
    if (foreignSameDayDragActive) {
      setTimeError(foreignDragSaveBlockedMessage);
      return;
    }
    await saveCurrentEditor(new FormData(event.currentTarget.form), { requestAutoContinuation: true });
  }

  async function submit(event) {
    event.preventDefault();
    if (isAlternativeEditorOpen) return;
    await saveCurrentEditor(new FormData(event.currentTarget), { skipAutoContinuation: true });
  }

  const isTransportEditor = form.item_type === "transport";
  const isAlternativeEditor = Boolean(isOpen && !isTransportEditor && isAlternativeEditorOpen);
  const activeVisitForm = isAlternativeEditor ? form.alternative_draft || {} : form;

  function updateActiveVisitForm(patch) {
    setForm((current) =>
      isAlternativeEditor
        ? { ...current, alternative_draft: { ...(current.alternative_draft || {}), ...patch }, alternative_deleted: false }
        : { ...current, ...patch },
    );
  }

  useEffect(() => {
    onMapPointEditorActiveChange?.({ canPick: Boolean(isOpen && !isTransportEditor), isOpen });
    return () => onMapPointEditorActiveChange?.({ canPick: false, isOpen: false });
  }, [isOpen, isTransportEditor, onMapPointEditorActiveChange]);

  useEffect(() => {
    if (!isOpen || isTransportEditor) return;
    const latitude = Number(activeVisitForm.latitude);
    const longitude = Number(activeVisitForm.longitude);
    const previewMapPoint = Number.isFinite(latitude) && Number.isFinite(longitude)
      ? {
          itemId: editingId,
          latitude,
          locationName: activeVisitForm.location_name || activeVisitForm.location || activeVisitForm.title || "新增地點",
          longitude,
          mapUrl: activeVisitForm.map_url || googleMapsPointUrl(latitude, longitude),
          type: activeVisitForm.type,
        }
      : null;
    onMapPointEditorActiveChange?.({ canPick: true, isOpen: true, previewMapPoint });
  }, [
    editingId,
    activeVisitForm.latitude,
    activeVisitForm.location,
    activeVisitForm.location_name,
    activeVisitForm.longitude,
    activeVisitForm.map_url,
    activeVisitForm.title,
    activeVisitForm.type,
    isOpen,
    isTransportEditor,
    onMapPointEditorActiveChange,
  ]);

  useEffect(() => {
    if (!pickedMapPoint?.pickedAt || lastAppliedMapPointPickRef.current === pickedMapPoint.pickedAt) return;
    if (pickedMapPoint.source === "places-details" && !isMapSearchReplaceActive) {
      lastAppliedMapPointPickRef.current = pickedMapPoint.pickedAt;
      void openNewItem(pickedMapPoint);
      return;
    }
    if (pickedMapPoint.source === "map-add") {
      lastAppliedMapPointPickRef.current = pickedMapPoint.pickedAt;
      void openNewItem(pickedMapPoint);
      return;
    }
    if (!isOpen || isTransportEditor) return;
    lastAppliedMapPointPickRef.current = pickedMapPoint.pickedAt;
    const latitude = Number(pickedMapPoint.latitude);
    const longitude = Number(pickedMapPoint.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    setMapUrlError("");
    updateActiveVisitForm({
      ...(pickedMapPoint.source === "places-replace"
        ? {
            title: pickedMapPoint.displayName || activeVisitForm.title,
            location: pickedMapPoint.displayName || activeVisitForm.location,
            location_name: pickedMapPoint.displayName || activeVisitForm.location_name,
          }
        : {}),
      latitude,
      longitude,
      map_url: googleMapsPointUrl(latitude, longitude),
    });
    if (pickedMapPoint.source === "places-replace") onCancelMapSearchReplace?.();
  }, [activeVisitForm, isAlternativeEditor, isMapSearchReplaceActive, isOpen, isTransportEditor, onCancelMapSearchReplace, pickedMapPoint, setForm]);

  useEffect(() => {
    if (!isOpen || isTransportEditor) return;
    const duration = getDurationMinutes(form.start_time, form.end_time);
    if (document.activeElement?.name !== "duration_minutes") {
      setDurationInput(duration ? formatDurationMinutes(duration) : editingId ? "" : formatDurationMinutes(defaultVisitDurationMinutes));
    }
  }, [editingId, form.end_time, form.start_time, isOpen, isTransportEditor]);

  useEffect(() => {
    if (!isOpen || isTransportEditor) return undefined;
    const bindings = [[visitDurationRef.current, handleDurationWheel]].filter(([element]) => Boolean(element));
    bindings.forEach(([element, handler]) => element.addEventListener("wheel", handler, { passive: false }));
    return () => bindings.forEach(([element, handler]) => element.removeEventListener("wheel", handler));
  }, [form.end_time, form.start_time, isOpen, isTransportEditor]);
  const visitItems = useMemo(() => sortedVisitItems(dayItems), [dayItems]);
  const visitItemIds = useMemo(() => visitItems.map((item) => item.id), [visitItems]);
  useEffect(() => {
    if (!isOpen || isTransportEditor || editingId || !newVisitEditorRef.current) return undefined;
    if (
      draggedVisitId ||
      foreignSameDayDragActive ||
      reorderPreview ||
      transportPairConflict ||
      autoContinuationPrompt ||
      isResolvingTransportPairConflict ||
      isSavingAutoContinuation ||
      isReorderingDestination ||
      isReorderingUntimed
    ) {
      return undefined;
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      newVisitEditorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      const primaryInput = newVisitEditorRef.current?.querySelector('input[name="location_name"]');
      primaryInput?.focus?.({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [
    autoContinuationPrompt,
    draggedVisitId,
    editingId,
    foreignSameDayDragActive,
    isOpen,
    isReorderingDestination,
    isReorderingUntimed,
    isResolvingTransportPairConflict,
    isSavingAutoContinuation,
    isTransportEditor,
    reorderPreview,
    transportPairConflict,
  ]);
  useEffect(() => {
    if (!focusedItemId || !activeTimelineListRef.current) return;
    if (!visitItemIds.includes(focusedItemId)) return;
    if (
      isOpen ||
      draggedVisitId ||
      foreignSameDayDragActive ||
      reorderPreview ||
      transportPairConflict ||
      autoContinuationPrompt ||
      isResolvingTransportPairConflict ||
      isSavingAutoContinuation ||
      isReorderingDestination ||
      isReorderingUntimed
    ) {
      return;
    }

    const focusedCard = activeTimelineListRef.current.querySelector(`[data-timeline-item-id="${focusedItemId}"]`);
    focusedCard?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [
    autoContinuationPrompt,
    draggedVisitId,
    focusedItemId,
    foreignSameDayDragActive,
    isOpen,
    isReorderingDestination,
    isReorderingUntimed,
    isResolvingTransportPairConflict,
    isSavingAutoContinuation,
    reorderPreview,
    transportPairConflict,
    visitItemIds,
  ]);
  const activeDragItem = draggedVisitId ? visitItems.find((item) => item.id === draggedVisitId) || null : null;
  const timedVisitItems = useMemo(() => visitItems.filter(isTimedVisit), [visitItems]);
  const editedTimedVisitIndex = timedVisitItems.findIndex((item) => item.id === editingId);
  const editedTimedVisit = editedTimedVisitIndex >= 0 ? timedVisitItems[editedTimedVisitIndex] : null;
  const editedVisitTimeChanged =
    Boolean(editedTimedVisit) &&
    (formatTimeDisplay(editedTimedVisit.start_time) !== form.start_time ||
      formatTimeDisplay(editedTimedVisit.end_time) !== form.end_time);
  const crossesFixedVisitForContinuation = Boolean(editedTimedVisit) && timedVisitItems.some((fixedVisit) => {
    if (!isEffectiveFixedVisit(fixedVisit) || fixedVisit.id === editedTimedVisit.id) return false;
    const originalStart = timeToMinutes(editedTimedVisit.start_time);
    const originalEnd = timeToMinutes(editedTimedVisit.end_time);
    const candidateStart = timeToMinutes(form.start_time);
    const candidateEnd = timeToMinutes(form.end_time);
    const fixedStart = timeToMinutes(fixedVisit.start_time);
    const fixedEnd = timeToMinutes(fixedVisit.end_time);
    if ([originalStart, originalEnd, candidateStart, candidateEnd, fixedStart, fixedEnd].some((value) => value === null)) {
      return false;
    }
    const movedFromBeforeToAfter = originalEnd <= fixedStart && candidateStart >= fixedEnd;
    const movedFromAfterToBefore = originalStart >= fixedEnd && candidateEnd <= fixedStart;
    return movedFromBeforeToAfter || movedFromAfterToBefore;
  });
  const canRequestAutoContinuation =
    editingId &&
    !isTransportEditor &&
    editedTimedVisitIndex >= 0 &&
    editedTimedVisitIndex < timedVisitItems.length - 1 &&
    editedVisitTimeChanged &&
    Boolean(editedTimedVisit.start_time) &&
    Boolean(editedTimedVisit.end_time) &&
    Boolean(form.start_time) &&
    Boolean(form.end_time) &&
    !crossesFixedVisitForContinuation;
  const lastTimedVisitItem = useMemo(() => lastTimedVisit(dayItems), [dayItems]);
  const { adjacentTransportByPair, invalidTransportItems, passiveUntimedTransportByFrom, tailTransportByFrom } = useMemo(
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
      latitude: alternative.latitude ?? null,
      longitude: alternative.longitude ?? null,
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
      latitude: item.latitude ?? null,
      longitude: item.longitude ?? null,
      transportation_note: item.transportation_note || "",
    };
  }

  function resetAlternativeError(itemId) {
    setAlternativeErrorByItem((current) => {
      if (!current[itemId]) return current;
      const next = { ...current };
      delete next[itemId];
      return next;
    });
  }

  async function flipAlternativeFace(item, alternative) {
    if (foreignSameDayDragActive) {
      setAlternativeErrorByItem((current) => ({
        ...current,
        [item.id]: foreignDragSaveBlockedMessage,
      }));
      return;
    }
    if (isEffectiveFixedVisit(item)) {
      setFixedNotice("此行程已固定，請先解鎖後再修改。");
      return;
    }
    resetAlternativeError(item.id);
    if (!alternative) return;
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
  }

  async function deleteAlternative(itemId, alternativeId) {
    const parentItem = dayItems.find((item) => item.id === itemId);
    if (foreignSameDayDragActive) {
      setAlternativeErrorByItem((current) => ({
        ...current,
        [itemId]: foreignDragSaveBlockedMessage,
      }));
      return;
    }
    if (isEffectiveFixedVisit(parentItem)) {
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
  }

  function relatedTransportItemsFor(item) {
    if (!item || isTransportationCard(item)) return [];
    return dayItems.filter(
      (dayItem) => isTransportationCard(dayItem) && (dayItem.from_item_id === item.id || dayItem.to_item_id === item.id),
    );
  }

  function requestDeleteItem(item) {
    if (foreignSameDayDragActive) {
      setFixedNotice(foreignDragReadOnlyMessage);
      return;
    }
    if (isEffectiveFixedVisit(item)) {
      setFixedNotice("此行程已固定，請先解鎖後再修改。");
      return;
    }
    setDeleteTarget(item);
  }

  async function toggleItemFixed(item) {
    if (!item || isTransportationCard(item) || typeof onToggleItemFixed !== "function") return;
    if (foreignSameDayDragActive) {
      setFixedNotice(foreignDragReadOnlyMessage);
      return;
    }
    if (!isTimedVisit(item)) {
      setFixedNotice("未設定完整時間的行程不能固定。");
      return;
    }
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
    if (foreignSameDayDragActive) {
      setFixedNotice(foreignDragSaveBlockedMessage);
      setDeleteTarget(null);
      return;
    }
    const target = deleteTarget;
    setDeleteTarget(null);
    await onDeleteItem(target.id);
  }

  function renderTransportEditorForm() {
    const category = form.transport_category || defaultTransportCategory;
    const editorRouteItem = { ...form, id: editingId || "transport-editor" };
    const { fromItem, toItem } = transportEndpointItems(editorRouteItem);
    const editorNavigationUrl = buildGoogleMapsDirectionsUrl({
      fromItem,
      toItem,
      transportCategory: category,
    });
    const editorHeadingTitle = transportCardTitle(form) || "新增交通資訊";

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
        {foreignSameDayDragActive ? (
          <div className="notice inline-error" role="alert">
            <span>{foreignDragSaveBlockedMessage}</span>
          </div>
        ) : null}
        <div className="transport-editor-heading">
          <span className="transport-icon" aria-hidden="true">
            <TransportCategoryIcon category={category} />
          </span>
          <strong>{editorHeadingTitle}</strong>
        </div>
        <div className="transport-editor-edit-mode">
          <div className="form-grid wide transport-editor-route-row">
            <TransportCategoryField
              value={category}
              onValueChange={(transportCategory) => setForm({ ...form, transport_category: transportCategory })}
            />
            <TransportDurationField
              value={form.transport_duration_minutes}
              onValueChange={(transportDurationMinutes) =>
                setForm({ ...form, transport_duration_minutes: transportDurationMinutes })
              }
            />
            {renderTransportNavigationControl(editorNavigationUrl, "mini-button transport-navigation-button transport-editor-navigation-button")}
          </div>
          <FloatingOutlinedField className="transport-editor-name-field" label="交通名稱">
            <input
              aria-label="交通名稱"
              autoComplete="off"
              name="transport_name"
              placeholder="交通名稱"
              value={form.transport_name}
              onChange={(event) => setForm({ ...form, transport_name: event.target.value, title: event.target.value })}
            />
          </FloatingOutlinedField>
          <FloatingOutlinedField className="transport-editor-note-field" label="備註">
            <AutoGrowingTextarea
              aria-label="備註"
              autoComplete="off"
              name="transport_note"
              placeholder="備註"
              rows="2"
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
          </FloatingOutlinedField>
          <div className="transport-editor-footer-actions navigation-only">
            <div className="transport-editor-save-actions">
              <button className="primary-button compact transport-editor-action-button" disabled={!canMutateThisDay} type="submit">
                保存
              </button>
              <button className="ghost-button compact transport-editor-action-button item-form-cancel-button" type="button" onClick={() => closeEditor()}>
                取消
              </button>
            </div>
          </div>
        </div>
      </form>
    );
  }
  function transportPairLabel(item) {
    const fromItem = dayItems.find((dayItem) => dayItem.id === item.from_item_id);
    const toItem = dayItems.find((dayItem) => dayItem.id === item.to_item_id);
    const fromLabel = fromItem?.location_name || fromItem?.location || fromItem?.title || "已移除景點";
    const toLabel = item.to_item_id
      ? toItem?.location_name || toItem?.location || toItem?.title || "已移除景點"
      : "下一目的地尚未設定";
    return `${fromLabel} → ${toLabel}`;
  }

  function transportEndpointItems(item) {
    return {
      fromItem: dayItems.find((dayItem) => dayItem.id === item.from_item_id) || null,
      toItem: dayItems.find((dayItem) => dayItem.id === item.to_item_id) || null,
    };
  }

  function renderTransportNavigationControl(navigationUrl, className = "mini-button transport-navigation-button") {
    if (navigationUrl) {
      return (
        <a
          aria-label="導航"
          className={className}
          href={navigationUrl}
          target="_blank"
          rel="noreferrer"
          title="導航"
          onClick={(event) => event.stopPropagation()}
        >
          <Navigation aria-hidden="true" />
        </a>
      );
    }
    return (
      <button
        aria-label="導航"
        className={className}
        disabled
        type="button"
        title="請先設定兩端景點地圖位置"
        onClick={(event) => event.stopPropagation()}
      >
        <Navigation aria-hidden="true" />
      </button>
    );
  }

  function renderTransportCard(item, lockedByOther, options = {}) {
    const { hasTimeShortage = false, isTail = false, warningType = "" } = options;
    const isInvalidWarning = warningType === "invalid";
    const isGeneralWarning = warningType === "general";
    const isUntimedWarning = warningType === "untimed";
    const isShortageWarning = hasTimeShortage && !isInvalidWarning;
    const hasWarning = Boolean(warningType) || isShortageWarning;
    const warningClass = isInvalidWarning ? "invalid" : isGeneralWarning ? "general" : isShortageWarning ? "shortage" : warningType;
    const expanded = expandedId === item.id;
    const budgets = budgetsByItem[item.id] || [];
    const category = item.transport_category || defaultTransportCategory;
    const note = item.transport_note || item.transportation_note || item.description || item.note;
    const { fromItem, toItem } = transportEndpointItems(item);
    const navigationUrl = buildGoogleMapsDirectionsUrl({ fromItem, toItem, transportCategory: category });
    const remoteSelection = visibleForeignCardSelection?.itemId === item.id ? visibleForeignCardSelection : null;
    const remoteSelectionColor = remoteSelection ? timelineCardSelectionColor(remoteSelection.colorKey) : "";
    const remoteSelectionStyle = remoteSelection
      ? {
          "--timeline-remote-selection-color": remoteSelectionColor,
          "--timeline-remote-selection-color-soft": `${remoteSelectionColor}18`,
        }
      : undefined;
    return (
      <article
        className={`transport-card${focusedItemId === item.id ? " focused" : ""}${expanded ? " expanded" : ""}${
          hasWarning ? ` warning ${warningClass}-warning` : ""
        }${remoteSelection ? " timeline-item-remote-selected" : ""}`}
        data-remote-selection-label={remoteSelection?.userName || undefined}
        style={remoteSelectionStyle}
        onClick={() => {
          focusOrToggleTimelineCard(item);
        }}
      >
        <span className="transport-card-icon" aria-hidden="true">
          <span className="transport-icon" aria-hidden="true">
            <TransportCategoryIcon category={category} />
          </span>
        </span>
        <div className="transport-card-main">
          <strong>{transportCardTitle(item)}</strong>
          {isTail ? <span className="muted-text">下一目的地尚未設定</span> : null}
          {hasWarning ? (
            <span className="transport-warning-badge" aria-label="交通資訊需確認">
              <MessageCircleWarning aria-hidden="true" />
            </span>
          ) : null}
        </div>
        <div className="transport-card-nav">
          {renderTransportNavigationControl(navigationUrl)}
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
            {isUntimedWarning ? (
              <p className="transport-warning-detail">目的地時間未設定，請重新確認交通卡。</p>
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
                  disabled={!canMutateThisDay || lockedByOther}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onConfirmTransportWarning?.(item.id);
                  }}
                >
                  確認
                </button>
              ) : null}
              {renderTransportNavigationControl(navigationUrl)}
              <button
                className="mini-button"
                disabled={!canMutateThisDay || lockedByOther}
                type="button"
                title="編輯"
                onClick={(event) => {
                  event.stopPropagation();
                  openEditItem(item);
                }}
              >
                <Pencil aria-hidden="true" />
              </button>
              <button
                className="mini-button"
                disabled={!canMutateThisDay}
                type="button"
                title="刪除"
                onClick={(event) => {
                  event.stopPropagation();
                  requestDeleteItem(item);
                }}
              >
                <Trash2 aria-hidden="true" />
              </button>
            </div>
          </>
        ) : null}
      </article>
    );
  }

  function focusOrToggleTimelineCard(item) {
    setExpandedId((current) =>
      focusedItemId === item.id ? (current === item.id ? null : item.id) : null,
    );
    onFocusItem(item.id);
    if (typeof onPublishCardSelection === "function") onPublishCardSelection(item);
  }

  function renderTransportInsert(previousItem, nextItem) {
    if (!canMutateThisDay || isOpen || !nextItem || isTransportationCard(previousItem) || isTransportationCard(nextItem)) return null;
    if (adjacentTransportByPair[transportPairKey(previousItem.id, nextItem.id)]) return null;
    return (
      <button
        className="transport-insert-zone"
        type="button"
        onClick={() => openNewTransport(previousItem, nextItem)}
        onKeyDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className="transport-insert-icon" aria-hidden="true">
          <Plus />
        </span>
        <span className="transport-insert-label">新增交通資訊</span>
        <span className="transport-insert-line" aria-hidden="true" />
      </button>
    );
  }

  function renderTailTransportInsert(previousItem) {
    if (!canMutateThisDay || isOpen || !previousItem || isTransportationCard(previousItem)) return null;
    if (tailTransportByFrom[previousItem.id]) return null;
    return (
      <button
        className="transport-insert-zone tail"
        type="button"
        onClick={() => openNewTransport(previousItem, null)}
        onKeyDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className="transport-insert-icon" aria-hidden="true">
          <Plus />
        </span>
        <span className="transport-insert-label">新增尾端交通</span>
        <span className="transport-insert-line" aria-hidden="true" />
      </button>
    );
  }

  function toggleMapPointPick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!canPickMapPoint) return;
    if (isPickingMapPoint) onCancelMapPointPick?.();
    else onStartMapPointPick?.();
  }

  function updateVisitTime(field, nextValue, preservedDuration = null) {
    setTimeError("");
    if (field === "start_time") {
      if (!nextValue) {
        setForm({ ...form, start_time: "", end_time: "" });
        return;
      }
      const duration = Number(
        preservedDuration
        || getDurationMinutes(form.start_time, form.end_time)
        || (!editingId ? defaultVisitDurationMinutes : 0),
      );
      const startMinutes = timeToMinutes(nextValue);
      const nextEnd =
        startMinutes !== null && Number.isFinite(duration) && duration > 0
          ? minutesToTimeValue(startMinutes + duration)
          : form.end_time;
      setForm({ ...form, start_time: nextValue, end_time: nextEnd || form.end_time });
      return;
    }
    setForm(nextValue ? { ...form, end_time: nextValue } : { ...form, start_time: "", end_time: "" });
  }

  function commitDurationInput(rawValue) {
    const text = String(rawValue || "").trim();
    const numeric = parseDurationMinutes(text);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setTimeError("停留時間請輸入大於 0 的分鐘數。");
      return false;
    }
    const duration = Math.min(24 * 60 - 5, Math.max(5, Math.round(numeric / 5) * 5));
    const start = timeToMinutes(form.start_time);
    if (start === null) return false;
    const nextEnd = minutesToTimeValue(start + duration);
    if (!nextEnd) {
      setTimeError("停留時間不可超過當日 24:00。");
      return false;
    }
    setTimeError("");
    setDurationInput(formatDurationMinutes(duration));
    setForm({ ...form, end_time: nextEnd });
    return true;
  }

  function handleDurationWheel(event) {
    event.preventDefault();
    const start = timeToMinutes(form.start_time);
    const current = Number(getDurationMinutes(form.start_time, form.end_time));
    if (start === null || !Number.isFinite(current)) return;
    const direction = event.deltaY < 0 ? 1 : -1;
    const nextDuration = Math.min(24 * 60 - 5, Math.max(5, current + direction * 5));
    const nextEnd = minutesToTimeValue(start + nextDuration);
    if (!nextEnd) return;
    setTimeError("");
    setDurationInput(formatDurationMinutes(nextDuration));
    setForm({ ...form, end_time: nextEnd });
  }

  async function applyMapUrlDraft() {
    if (mapUrlApplyRef.current || !String(activeVisitForm.map_url || "").trim()) return;
    mapUrlApplyRef.current = true;
    setIsResolvingMapUrl(true);
    let result;
    try {
      result = await resolveDestinationMapUrlPoint(activeVisitForm.map_url, { resolveShortUrl: resolveGoogleMapsShortUrl });
    } finally {
      mapUrlApplyRef.current = false;
      setIsResolvingMapUrl(false);
    }
    if (!result.ok) {
      setMapUrlError(result.errorMessage);
      return;
    }
    const nextUrl = result.expandedUrl || activeVisitForm.map_url;
    setMapUrlError("");
    setIsAlternativeEditorOpen(false);
    updateActiveVisitForm({ latitude: result.point.latitude, longitude: result.point.longitude, map_url: nextUrl });
  }

  const hasEditorMapPoint = hasValidMapPoint(activeVisitForm);
  const editorMapsUrl = hasEditorMapPoint
    ? activeVisitForm.map_url || googleMapsPointUrl(activeVisitForm.latitude, activeVisitForm.longitude)
    : "";

  function openAlternativeEditor() {
    const parentItem = editingId ? dayItems.find((item) => item.id === editingId) : form;
    if (!form.alternative_draft) {
      const nextAlternative = emptyAlternativeForm(parentItem || form);
      setForm({
        ...form,
        alternative_draft: nextAlternative,
        alternative_deleted: false,
        alternative_map_url_baseline: nextAlternative.map_url || "",
      });
    }
    resetAlternativeError(editingId || "new");
    setMapUrlError("");
    setIsMapPointExpanded(false);
    onCancelMapPointPick?.();
    onCancelMapSearchReplace?.();
    setIsAlternativeDeleteConfirmOpen(false);
    setIsAlternativeEditorOpen(true);
  }

  function returnToMainEditor() {
    setMapUrlError("");
    setIsMapPointExpanded(false);
    onCancelMapPointPick?.();
    onCancelMapSearchReplace?.();
    setIsAlternativeDeleteConfirmOpen(false);
    setIsAlternativeEditorOpen(false);
  }

  function stageAlternativeDeletion() {
    setForm({ ...form, alternative_draft: null, alternative_deleted: Boolean(form.alternative_id) });
    setMapUrlError("");
    setIsMapPointExpanded(false);
    onCancelMapPointPick?.();
    onCancelMapSearchReplace?.();
    setIsAlternativeDeleteConfirmOpen(false);
    setIsAlternativeEditorOpen(false);
  }

  function renderEditorMapSettings({ includeAlternative = false } = {}) {
    const pendingAlternative = form.alternative_deleted ? null : form.alternative_draft;
    const isMapPointBodyVisible = isAlternativeEditor || isMapPointExpanded;
    return (
      <div className={`visit-map-point-section${isMapPointBodyVisible ? " expanded" : ""}${isAlternativeEditor ? " always-expanded" : ""}`}>
        <div className="visit-map-point-header">
          {isAlternativeEditor ? (
            <div className="visit-settings-heading visit-map-point-static-title">
              <MapPin aria-hidden="true" />
              <span>地圖點位</span>
            </div>
          ) : (
            <button className="visit-map-point-toggle" type="button" aria-expanded={isMapPointExpanded} onClick={() => setIsMapPointExpanded((current) => !current)}>
              <ChevronRight aria-hidden="true" />
              <span>{includeAlternative ? "更多設定" : "更改地點"}</span>
            </button>
          )}
          <a
            aria-disabled={!editorMapsUrl}
            className={`ghost-button compact visit-maps-link${editorMapsUrl ? "" : " disabled"}`}
            href={editorMapsUrl || undefined}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => { if (!editorMapsUrl) event.preventDefault(); }}
          >
            <span>Google Map</span>
            <ExternalLink aria-hidden="true" />
          </a>
        </div>
        {isMapPointBodyVisible ? (
          <div className="visit-map-point-body">
            {!isAlternativeEditor ? (
              <div className="visit-settings-heading">
                <MapPin aria-hidden="true" />
                <span>地圖點位</span>
              </div>
            ) : null}
            <div className="visit-map-point-actions">
              <button className={`ghost-button compact map-point-picker-button${isPickingMapPoint ? " active" : ""}`} disabled={!canPickMapPoint} type="button" onClick={toggleMapPointPick}>
                <MapPinPen aria-hidden="true" />
                <span>{isPickingMapPoint ? "取消選點" : "調整點位"}</span>
              </button>
              <button
                className={`ghost-button compact visit-map-search-replace-button${isMapSearchReplaceActive ? " active" : ""}`}
                disabled={!canPickMapPoint}
                type="button"
                onClick={() => {
                  onCancelMapPointPick?.();
                  if (isMapSearchReplaceActive) onCancelMapSearchReplace?.();
                  else onStartMapSearchReplace?.();
                }}
              >
                <Search aria-hidden="true" />
                <span>{isMapSearchReplaceActive ? "取消搜尋" : "搜尋替換"}</span>
              </button>
            </div>
            <OutlinedField className="visit-map-url-editor" invalid={Boolean(mapUrlError)} label="Google Maps URL">
              <input
                aria-invalid={Boolean(mapUrlError)}
                aria-label="Google Maps URL"
                autoComplete="off"
                name={includeAlternative ? "map_url" : undefined}
                placeholder="貼上 Google Maps 連結"
                value={activeVisitForm.map_url || ""}
                onChange={(event) => { setMapUrlError(""); updateActiveVisitForm({ map_url: event.target.value }); }}
                onBlur={() => { if (!isAlternativeEditor) void applyMapUrlDraft(); }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  event.stopPropagation();
                  void applyMapUrlDraft();
                }}
              />
            </OutlinedField>
            {mapUrlError ? <span className="field-inline-error visit-map-url-error" role="alert">{mapUrlError}</span> : null}
            {includeAlternative ? (
              <div className="visit-alternative-settings">
                <div className="visit-settings-divider" />
                <div className="visit-settings-heading">
                  <Files aria-hidden="true" />
                  <span>備案</span>
                </div>
                {pendingAlternative ? (
                  <button className="visit-alternative-summary" type="button" onClick={openAlternativeEditor}>
                    <span>
                      {`${typeLabels[pendingAlternative.type] || typeLabels.attraction} ・ ${alternativeDestination(pendingAlternative)}`}
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                ) : (
                  <button className="visit-alternative-summary visit-alternative-create-summary" type="button" onClick={openAlternativeEditor}>
                    <span><Plus aria-hidden="true" />建立備案</span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                )}
              </div>
            ) : null}
          </div>
        ) : includeAlternative ? <input name="map_url" type="hidden" value={form.map_url} /> : null}
      </div>
    );
  }

  function renderVisitEditorForm() {
    const alternativeError = alternativeErrorByItem[editingId || "new"];
    const originalDestination = form.location_name || form.location || form.title || "未命名行程";
    return (
      <form autoComplete="off" className="item-form" onSubmit={submit}>
        <input name="item_type" type="hidden" value="visit" />
        {isAlternativeEditor ? (
          <>
            <div className="alternative-editor-heading">
              <span className="form-mode-label">{form.alternative_id ? "編輯備案" : "新增備案"}</span>
              <span className="alternative-origin-label">{`原行程：${originalDestination}`}</span>
            </div>
            {alternativeError ? (
              <div className="notice inline-error" role="alert"><span>{alternativeError}</span></div>
            ) : null}
            <div className="visit-editor-primary-row">
              <TimelineTypeField value={activeVisitForm.type || "attraction"} onValueChange={(type) => updateActiveVisitForm({ type })} />
              <OutlinedField className="destination-field" label="備案目的地">
                <input
                  aria-label="備案目的地"
                  autoComplete="off"
                  placeholder="請輸入備案目的地"
                  required
                  value={activeVisitForm.location_name || ""}
                  onChange={(event) => updateActiveVisitForm({ title: event.target.value, location_name: event.target.value })}
                />
              </OutlinedField>
            </div>
            <FloatingOutlinedField className="full-label visit-note-field" label="備註">
              <AutoGrowingTextarea
                aria-label="備註"
                autoComplete="off"
                placeholder="備註"
                rows="2"
                value={activeVisitForm.description || ""}
                onChange={(event) => updateActiveVisitForm({ description: event.target.value })}
              />
            </FloatingOutlinedField>
            {renderEditorMapSettings()}
            <div className="form-actions alternative-editor-actions">
              {form.alternative_id ? (
                <button className="ghost-button danger compact alternative-editor-delete-button" type="button" onClick={() => setIsAlternativeDeleteConfirmOpen(true)}>
                  <Trash2 aria-hidden="true" />
                  <span>刪除備案</span>
                </button>
              ) : null}
              <button className="ghost-button compact alternative-editor-return-button" type="button" onClick={returnToMainEditor}>
                <ChevronLeft aria-hidden="true" />
                <span>返回主行程</span>
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="form-mode-label">{editingId ? "編輯行程" : "新增行程"}</div>
            {conflict ? <ConflictNotice onKeep={() => setConflict(false)} onLatest={() => closeEditor(true)} /> : null}
            {timeError ? <div className="notice inline-error" role="alert"><span>{timeError}</span></div> : null}
            {alternativeError ? <div className="notice inline-error" role="alert"><span>{alternativeError}</span></div> : null}
            {foreignSameDayDragActive ? <div className="notice inline-error" role="alert"><span>{foreignDragSaveBlockedMessage}</span></div> : null}
            <div className="visit-editor-primary-row">
              <TimelineTypeField value={form.type} onValueChange={(type) => setForm({ ...form, type })} />
              <OutlinedField className="destination-field" label="目的地">
                <input aria-label="目的地" autoComplete="off" placeholder="請輸入目的地名稱" name="location_name" required value={form.location_name || form.location} onChange={(event) => setForm({ ...form, title: event.target.value, location: event.target.value, location_name: event.target.value })} />
              </OutlinedField>
            </div>
            <div className="visit-editor-time-row">
              <TimelineSegmentedTimeField label="開始" name="start_time" value={form.start_time} onValueChange={(nextValue) => updateVisitTime("start_time", nextValue, getDurationMinutes(form.start_time, form.end_time))} />
              <span className="visit-time-link" aria-hidden="true" />
              <TimelineSegmentedTimeField label="結束" name="end_time" value={form.end_time} onValueChange={(nextValue) => updateVisitTime("end_time", nextValue)} />
              <span className="visit-time-link" aria-hidden="true" />
              <TimelineDurationField disabled={!form.start_time} inputRef={visitDurationRef} maxMinutes={Math.max(0, 24 * 60 - 5 - (timeToMinutes(form.start_time) || 0))} value={durationInput} onCommit={commitDurationInput} onInputChange={setDurationInput} />
            </div>
            <FloatingOutlinedField className="full-label visit-note-field" label="備註">
              <AutoGrowingTextarea aria-label="備註" autoComplete="off" name="description" placeholder="備註" rows="2" value={form.description || form.note} onChange={(event) => setForm({ ...form, note: event.target.value, description: event.target.value })} />
            </FloatingOutlinedField>
            {renderEditorMapSettings({ includeAlternative: true })}
            <div className="form-actions">
              <button className="ghost-button item-form-cancel-button" type="button" onClick={() => closeEditor()}>取消</button>
              {editingId ? (
                <button className="ghost-button compact" disabled={!canMutateThisDay || !canRequestAutoContinuation} title={crossesFixedVisitForContinuation ? "跨越固定行程時無法接續。" : undefined} type="button" onClick={requestAutoContinuation}>接續</button>
              ) : null}
              <button className="primary-button compact" disabled={!canMutateThisDay || isResolvingMapUrl} type="submit">儲存</button>
            </div>
          </>
        )}
      </form>
    );
  }

  function renderAlternativeSummary(item, alternative, isAlternativeFace) {
    const alternativeError = alternativeErrorByItem[item.id];
    const relatedHeading = isAlternativeFace ? "原行程" : "備案";
    const relatedType = isAlternativeFace
      ? typeLabels[item.type] || typeLabels.attraction
      : typeLabels[alternative?.type] || typeLabels.attraction;
    const relatedDestination = isAlternativeFace ? visitDestination(item) : alternativeDestination(alternative);
    const alternativeFlipButton = !isEffectiveFixedVisit(item) ? (
      <button
        className="alternative-flip-button"
        disabled={!alternative || !canMutateThisDay}
        type="button"
        title={alternative ? "切換原行程與備案" : "尚未建立備案"}
        aria-label={alternative ? "切換原行程與備案" : "尚未建立備案"}
        onClick={(event) => {
          event.stopPropagation();
          flipAlternativeFace(item, alternative);
        }}
      >
        <Repeat2 aria-hidden="true" />
      </button>
    ) : null;
    return (
      <>
        {alternativeError ? (
          <div className="notice inline-error" role="alert">
            <span>{alternativeError}</span>
          </div>
        ) : null}
        {alternative ? (
          <div className="item-expanded-alternative">
            <div className="visit-settings-heading item-expanded-alternative-heading">
              <Files aria-hidden="true" />
              <span>{relatedHeading}</span>
            </div>
            <div className="item-expanded-alternative-content">
              <span className="item-expanded-section-divider" aria-hidden="true" />
              <div className="item-expanded-alternative-summary">
                <span>{`${relatedType}・${relatedDestination}`}</span>
              </div>
            </div>
          </div>
        ) : null}
        {alternativeFlipButton}
      </>
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
    <BodyPortal>
    {isAlternativeDeleteConfirmOpen ? (
      <div className="modal-backdrop">
        <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="alternative-delete-confirm-title">
          <h2 id="alternative-delete-confirm-title">確認刪除備案？</h2>
          <p>刪除狀態會在儲存主行程時一併套用。</p>
          <div className="form-actions">
            <button className="ghost-button" type="button" onClick={() => setIsAlternativeDeleteConfirmOpen(false)}>取消</button>
            <button className="ghost-button danger" type="button" onClick={stageAlternativeDeletion}>刪除備案</button>
          </div>
        </div>
      </div>
    ) : null}
    {deleteTarget ? (
      <div className="modal-backdrop">
        <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="delete-confirm-title">
          <h2 id="delete-confirm-title">{deleteTitle}</h2>
          <p>{deleteMessage}</p>
          <div className="form-actions">
            <button className="ghost-button" type="button" onClick={() => setDeleteTarget(null)}>
              取消
            </button>
            <button className="primary-button compact" disabled={!canMutateThisDay} type="button" onClick={confirmDeleteTarget}>
              確認刪除
            </button>
          </div>
        </div>
      </div>
    ) : null}
    {autoContinuationPrompt ? (
      <div className="modal-backdrop">
        <div
          className="dialog-card"
          data-testid="auto-continuation-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="auto-continuation-title"
        >
          <h2 id="auto-continuation-title">自動接續後續行程？</h2>
          <p>後續有時間的行程會依原本停留時間與間隔自動調整。</p>
          <p>固定行程不會移動，放不下的行程會改為未設定時間。</p>
          {autoContinuationPrompt.plan.blockReason === "locked_visit" ? (
            <p className="notice inline-error">後續行程目前由其他成員編輯，無法自動接續時間。</p>
          ) : null}
          {["incomplete_time", "invalid_result"].includes(autoContinuationPrompt.plan.blockReason) ? (
            <p className="notice inline-error">後續行程的時間資料無法安全接續，請手動調整。</p>
          ) : null}
          {timeError ? <p className="notice inline-error">{timeError}</p> : null}
          <div className="form-actions">
            <button
              className="ghost-button"
              disabled={isSavingAutoContinuation}
              type="button"
              onClick={cancelAutoContinuation}
            >
              取消
            </button>
            <button
              className="primary-button compact"
              disabled={!canMutateThisDay || isSavingAutoContinuation || !autoContinuationPrompt.plan.canAutoContinue}
              type="button"
              onClick={saveWithAutoContinuation}
            >
              確定接續
            </button>
          </div>
        </div>
      </div>
    ) : null}
    {transportPairConflict ? (
      <div className="modal-backdrop">
        <div
          className="dialog-card"
          data-testid="transport-pair-conflict-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="transport-pair-conflict-title"
        >
          <h2 id="transport-pair-conflict-title">這個時間會插入既有交通卡中間</h2>
          <p>
            原本「{visitDestination(transportPairConflict.fromItem)}」到「
            {visitDestination(transportPairConflict.toItem)}」之間已有交通卡。
            如果保留這個時間，該交通卡將不再相鄰。
          </p>
          <p>請選擇要恢復原本時間，或刪除這張交通卡。</p>
          <div className="form-actions">
            <button
              className="ghost-button"
              disabled={isResolvingTransportPairConflict}
              type="button"
              onClick={() => setTransportPairConflict(null)}
            >
              恢復
            </button>
            <button
              className="primary-button compact"
              disabled={!canMutateThisDay || isResolvingTransportPairConflict}
              type="button"
              onClick={confirmBrokenTransportationPairDeletion}
            >
              刪除交通卡
            </button>
          </div>
        </div>
      </div>
    ) : null}
    {reorderPreview ? (
      <div className="modal-backdrop">
        <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="reorder-confirm-title">
          <h2 id="reorder-confirm-title">確認移動行程？</h2>
          <p>移動行程卡後，部分交通卡可能會自動移除</p>
          <div className="form-actions">
            <button
              className="ghost-button"
              disabled={isReorderingDestination || isReorderingUntimed}
              type="button"
              onClick={() => setReorderPreview(null)}
            >
              取消
            </button>
            <button
              className="primary-button compact"
              disabled={!canMutateThisDay || isReorderingDestination || isReorderingUntimed}
              type="button"
              onClick={confirmMoveReorder}
            >
              確定
            </button>
          </div>
        </div>
      </div>
    ) : null}
    </BodyPortal>
    <div className="timeline-day-column active" data-day-index={activeDay} ref={activeDayColumnRef} style={{ order: activeDay }}>
      <div className="panel-heading timeline-column-header">
        <div className="timeline-column-title">
          <p className="eyebrow">{dayTitle || headingEyebrow}</p>
          <h3>{dayDateLabel || dayLabel}</h3>
        </div>
        <button
          className="icon-button timeline-add-button"
          disabled={!canMutateThisDay}
          type="button"
          title="新增行程"
          aria-label="新增行程"
          onClick={onStartMapAddLocation || openNewItem}
        >
          <Plus aria-hidden="true" />
          <MapPin aria-hidden="true" />
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

      {untimedDropNotice ? (
        <p className="timeline-drag-hint" role="status">
          {untimedDropNotice}
        </p>
      ) : null}

      {foreignSameDayDragActive ? (
        <p className="timeline-remote-drag-hint" role="status">
          {foreignDragReadOnlyMessage}
        </p>
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

      <DndContext
        collisionDetection={closestCenter}
        modifiers={[restrictTimelineDragToDayColumn]}
        onDragCancel={handleSortableDragCancel}
        onDragEnd={handleSortableDragEnd}
        onDragOver={handleSortableDragOver}
        onDragStart={handleSortableDragStart}
        sensors={dndSensors}
      >
      <SortableContext items={visitItemIds} strategy={verticalListSortingStrategy}>
      <div
        className="timeline"
        data-dnd-preview={draggedVisitId ? "active" : undefined}
        ref={activeTimelineListRef}
        onClick={(event) => {
          if (event.target === event.currentTarget && typeof onClearCardSelection === "function") onClearCardSelection();
        }}
      >
        {visitItems.length ? (
          visitItems.map((item, index) => {
            const lockedByOther = useEditLocks && isLockedByAnotherUser(item, currentUserId);
            const locker = memberById.get(item.locked_by);
            const alternative = (alternativesByItem[item.id] || [])[0] || null;
            const isExpanded = expandedId === item.id;
            const isItemFixed = isEffectiveFixedVisit(item);
            const isAlternativeFace = isExpanded && Boolean(alternative) && Boolean(alternativeFaceByItem[item.id]);
            const displayItem =
              isAlternativeFace && alternative
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
            const destination = visitDestination(displayItem);
            const secondaryText = displayItem.note || displayItem.description || displayItem.transportation_note;
            const linkedBudgetTotal = (budgetsByItem[item.id] || []).reduce(
              (sum, budget) => sum + Number(budget.twd_amount || budget.amount || 0),
              0,
            );
            const displayCost = linkedBudgetTotal || Number(displayItem.cost || 0);
            const nextItem = visitItems[index + 1];
            const isTimedPair = isTimedVisit(item) && isTimedVisit(nextItem);
            const pairKey = isTimedPair ? transportPairKey(item.id, nextItem.id) : "";
            const transportItem = pairKey ? adjacentTransportByPair[pairKey] : null;
            const hasTransportTimeShortage = transportItem ? transportTimeShortageMinutes(transportItem, item, nextItem) > 0 : false;
            const transportNeedsReview = transportItem && transportPairNeedsReview(transportItem, item, nextItem);
            const transportWarningType = transportNeedsReview ? "general" : hasTransportTimeShortage ? "shortage" : "";
            const tailTransportItem = tailTransportByFrom[item.id] || null;
            const passiveUntimedTransportItems = passiveUntimedTransportByFrom[item.id] || [];
            const hasPassiveTransportAfterItem = passiveUntimedTransportItems.length > 0;
            const isAddingTransportHere =
              isTimedPair &&
              isOpen &&
              isTransportEditor &&
              !editingId &&
              insertionPair?.fromId === item.id &&
              insertionPair?.toId === nextItem.id;
            const isTailPosition = lastTimedVisitItem?.id === item.id;
            const isAddingTailHere =
              isTailPosition &&
              !hasPassiveTransportAfterItem &&
              isOpen &&
              isTransportEditor &&
              !editingId &&
              insertionPair?.fromId === item.id &&
              insertionPair?.toId === null;
            const isEditingVisitHere = isOpen && !isTransportEditor && editingId === item.id;
            const isDragEnabled = canDragVisit(item);
            const isDisabledDragTarget = dragTarget?.itemId === item.id && dragTarget.disabled;
            const isForeignDragSource = foreignDragSourceItemId === item.id;
            const remoteSelection = visibleForeignCardSelection?.itemId === item.id ? visibleForeignCardSelection : null;
            const remoteSelectionColor = remoteSelection ? timelineCardSelectionColor(remoteSelection.colorKey) : "";
            const remoteSelectionStyle = remoteSelection
              ? {
                  "--timeline-remote-selection-color": remoteSelectionColor,
                  "--timeline-remote-selection-color-soft": `${remoteSelectionColor}18`,
                }
              : undefined;
            const hasAttachedTransportFlow =
              (!isAddingTransportHere && Boolean(transportItem)) ||
              passiveUntimedTransportItems.length > 0 ||
              (!isAddingTailHere && isTailPosition && Boolean(tailTransportItem));
            return (
            <Fragment key={item.id}>
            <SortableTimelineEntry disabled={!isDragEnabled} hasFlowAttachments={hasAttachedTransportFlow} id={item.id}>
            {foreignDragOverItemId === item.id && foreignDragPlacement === "before" ? (
              <div className="timeline-remote-insertion-line" aria-hidden="true" style={foreignDragStyle} />
            ) : null}
            {isEditingVisitHere ? (
              renderVisitEditorForm()
            ) : (
            <article
              className={`timeline-item${focusedItemId === item.id ? " focused" : ""}${isExpanded ? " expanded" : ""}${
                isItemFixed ? " fixed" : ""
              }${isDragEnabled ? " drag-enabled" : ""}${draggedVisitId === item.id ? " dragging" : ""}${
                isDisabledDragTarget ? " drag-target-disabled" : ""
              }${remoteSelection ? " timeline-item-remote-selected" : ""}${
                isForeignDragSource ? " timeline-item-remote-drag-source" : ""
              }`}
              data-dnd-overlay-source={draggedVisitId === item.id ? "true" : undefined}
              data-remote-selection-label={remoteSelection?.userName || undefined}
              data-timeline-item-id={item.id}
              data-timing={isTimedVisit(item) ? "timed" : "untimed"}
              style={isForeignDragSource ? foreignDragStyle : remoteSelectionStyle}
              title={hasBlockingTimelineEditor ? "請先儲存或放棄目前編輯，再重排行程" : undefined}
              onClick={() => {
                if (isPickingMapPoint) return;
                focusOrToggleTimelineCard(item);
              }}
            >
              <span className="destination-sequence-badge">{index + 1}</span>
              <TimelineDragHandle className="time-block">
                <span>{isTimedVisit(item) ? formatTimeDisplay(item.start_time) : "--:--"}</span>
                <span className="time-connector" aria-hidden="true" />
                <span>{isTimedVisit(item) ? formatTimeDisplay(item.end_time) : ""}</span>
              </TimelineDragHandle>
              <div className="item-main">
                <h4>{destination}</h4>
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
              </div>
              <div className="item-actions">
                {isTimedVisit(item) && (!isAlternativeFace || isItemFixed) ? (
                  <button
                    className="mini-button lock-button"
                    disabled={!canMutateThisDay || (!isItemFixed && (lockedByOther || Boolean(item.locked_by)))}
                    type="button"
                    title={isItemFixed ? "解鎖" : "鎖定"}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleItemFixed(item);
                    }}
                  >
                    {isItemFixed ? <Lock aria-hidden="true" /> : <LockOpen aria-hidden="true" />}
                  </button>
                ) : null}
                {!isAlternativeFace && !isItemFixed ? (
                  <button
                    className="mini-button"
                    disabled={!canMutateThisDay || lockedByOther}
                    type="button"
                    title="編輯"
                    onClick={(event) => {
                      event.stopPropagation();
                      openEditItem(item);
                    }}
                  >
                    <Pencil aria-hidden="true" />
                  </button>
                ) : null}
                {isAlternativeFace && alternative && !isItemFixed ? (
                  <button
                    className="mini-button"
                    disabled={!canMutateThisDay || lockedByOther}
                    type="button"
                    title="編輯備案"
                    onClick={(event) => {
                      event.stopPropagation();
                      openEditItem(item, { openAlternative: true });
                    }}
                  >
                    <Pencil aria-hidden="true" />
                  </button>
                ) : null}
                {!isItemFixed ? (
                  <button
                    className="mini-button"
                    disabled={!canMutateThisDay}
                    type="button"
                    title="刪除"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (isAlternativeFace && alternative) {
                        deleteAlternative(item.id, alternative.id);
                      } else {
                        requestDeleteItem(item);
                      }
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              {isExpanded ? (
                <div className="item-expanded-content">
                  <div className="item-details">
                    {displayItem.description || displayItem.note ? (
                      <p className="item-detail-note">{displayItem.description || displayItem.note}</p>
                    ) : null}
                    {displayItem.address ? <p>地址：{displayItem.address}</p> : null}
                    {displayItem.transportation_note ? <p>交通：{displayItem.transportation_note}</p> : null}
                    <div className="linked-budget-list">
                      <div className="item-expanded-budget-heading">
                        <Wallet aria-hidden="true" />
                        <strong>連動預算</strong>
                      </div>
                      <div className="item-expanded-budget-content">
                        <span className="item-expanded-section-divider" aria-hidden="true" />
                        <div className="item-expanded-budget-tags">
                          {(budgetsByItem[item.id] || []).length ? (
                            (budgetsByItem[item.id] || []).map((budget) => (
                              <span className="pill" key={budget.id}>
                                {budget.title} · {formatMoney(budget.twd_amount || budget.amount)}
                              </span>
                            ))
                          ) : (
                            <span className="pill muted-text">尚未連動預算</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  {renderAlternativeSummary(item, alternative, isAlternativeFace)}
                  {displayItem.map_url ? (
                    <a className="ghost-button compact visit-maps-link item-expanded-map-link" href={displayItem.map_url} rel="noreferrer" target="_blank">
                      <span>Google Map</span>
                      <ExternalLink aria-hidden="true" />
                    </a>
                  ) : null}
                </div>
              ) : null}
            </article>
            )}
            {!isAddingTransportHere && isTimedPair && !transportItem ? renderTransportInsert(item, nextItem) : null}
            {!isAddingTailHere && isTailPosition && !tailTransportItem && !hasPassiveTransportAfterItem ? renderTailTransportInsert(item) : null}
            {!isAddingTransportHere && transportItem ? (
              <TimelineFlowAttachment>
                {isOpen && isTransportEditor && editingId === transportItem.id
                  ? renderTransportEditorForm()
                  : renderTransportCard(transportItem, useEditLocks && isLockedByAnotherUser(transportItem, currentUserId), {
                      hasTimeShortage: hasTransportTimeShortage,
                      warningType: transportWarningType,
                    })}
              </TimelineFlowAttachment>
            ) : null}
            {passiveUntimedTransportItems.map((passiveTransportItem) => (
              <TimelineFlowAttachment key={passiveTransportItem.id}>
                {isOpen && isTransportEditor && editingId === passiveTransportItem.id
                  ? renderTransportEditorForm()
                  : renderTransportCard(
                      passiveTransportItem,
                      useEditLocks && isLockedByAnotherUser(passiveTransportItem, currentUserId),
                      { warningType: "untimed" },
                    )}
              </TimelineFlowAttachment>
            ))}
            {!isAddingTailHere && isTailPosition && tailTransportItem ? (
              <TimelineFlowAttachment>
                {isOpen && isTransportEditor && editingId === tailTransportItem.id
                  ? renderTransportEditorForm()
                  : renderTransportCard(
                      tailTransportItem,
                      useEditLocks && isLockedByAnotherUser(tailTransportItem, currentUserId),
                      { isTail: true },
                    )}
              </TimelineFlowAttachment>
            ) : null}
            {foreignDragOverItemId === item.id && foreignDragPlacement === "after" ? (
              <div className="timeline-remote-insertion-line" aria-hidden="true" style={foreignDragStyle} />
            ) : null}
            </SortableTimelineEntry>
            {isAddingTransportHere ? renderTransportEditorForm() : null}
            {isAddingTailHere ? renderTransportEditorForm() : null}
            </Fragment>
            );
          })
        ) : (
          <div className="timeline-empty">這一天還沒有行程</div>
        )}
      </div>
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {activeDragItem ? (
          <article
            className="timeline-item timeline-drag-overlay-card"
            data-dnd-drag-overlay="true"
            data-timing={isTimedVisit(activeDragItem) ? "timed" : "untimed"}
            style={
              dragOverlaySize
                ? {
                    "--timeline-drag-overlay-height": `${dragOverlaySize.height}px`,
                    "--timeline-drag-overlay-width": `${dragOverlaySize.width}px`,
                  }
                : undefined
            }
          >
            <div className="time-block">
              <span>{isTimedVisit(activeDragItem) ? formatTimeDisplay(activeDragItem.start_time) : "--:--"}</span>
              <span className="time-connector" aria-hidden="true" />
              <span>{isTimedVisit(activeDragItem) ? formatTimeDisplay(activeDragItem.end_time) : ""}</span>
            </div>
            <div className="item-main">
              <h4>{visitDestination(activeDragItem)}</h4>
              {activeDragItem.note || activeDragItem.description || activeDragItem.transportation_note ? (
                <p className="item-summary">
                  {activeDragItem.note || activeDragItem.description || activeDragItem.transportation_note}
                </p>
              ) : (
                <p className="item-summary item-summary-placeholder" aria-hidden="true">
                  &nbsp;
                </p>
              )}
              <div className="item-meta">
                <span
                  className="pill"
                  style={{ background: `${typeColors[activeDragItem.type]}22`, color: typeColors[activeDragItem.type] }}
                >
                  {typeLabels[activeDragItem.type]}
                </span>
              </div>
            </div>
          </article>
        ) : null}
      </DragOverlay>
      </DndContext>
      {isOpen && !isTransportEditor && !editingId ? (
        <div className="timeline-add-editor-anchor" data-timeline-add-editor="true" ref={newVisitEditorRef}>
          {renderVisitEditorForm()}
        </div>
      ) : null}
    </div>
    </>
  );
}

function MultiDayTimelineColumns({
  activeDay,
  alternativesByItem = {},
  budgetsByItem = {},
  days,
  dayBoardPresenceByDay = new Map(),
  itemsByDay,
  onActiveDay,
  onFocusItem,
}) {
  const otherDays = days
    .map((date, index) => ({ date, index, items: itemsByDay[index] || [] }))
    .filter((day) => day.index !== activeDay);
  if (!otherDays.length) return null;

  return (
    <>
      {otherDays.map((day) => {
        const visits = sortedVisitItems(day.items);
        const adjacentTransportByPair = buildAdjacentTransportMap(day.items, visits);
        const dayBoardPresences = (dayBoardPresenceByDay.get(day.index) || []).slice(0, 3);
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
            <div className="timeline-column-title">
              <p className="eyebrow">Day {day.index + 1}</p>
              <h4>{formatDate(day.date)}</h4>
            </div>
            {dayBoardPresences.length ? (
              <div className="timeline-day-presence-dots" aria-label="Remote members on this day">
                {dayBoardPresences.map((presence) => (
                  <span
                    className="timeline-day-presence-dot"
                    key={presence.sessionId || `${presence.userId}-${presence.colorKey}`}
                    style={{ "--trip-presence-color": timelineCardSelectionColor(presence.colorKey) }}
                    title={presence.userName || "Remote member"}
                  />
                ))}
              </div>
            ) : null}
          </div>
          <div className="timeline-preview-list">
            {visits.length ? (
              visits.map((item, index) => {
                const destination = item.location_name || item.location || item.title;
                const secondaryText = item.note || item.description || item.transportation_note;
                const linkedBudgetTotal = (budgetsByItem[item.id] || []).reduce(
                  (sum, budget) => sum + Number(budget.twd_amount || budget.amount || 0),
                  0,
                );
                const displayCost = linkedBudgetTotal || Number(item.cost || 0);
                const hasAlternative = Boolean((alternativesByItem[item.id] || []).length);
                const nextItem = visits[index + 1];
                const pairKey = nextItem ? transportPairKey(item.id, nextItem.id) : "";
                const transportItem = pairKey ? adjacentTransportByPair[pairKey] : null;
                return (
                  <Fragment key={item.id}>
                  <button
                    className="timeline-preview-card"
                    type="button"
                    onClick={() => {
                      onActiveDay(day.index);
                      onFocusItem(item.id);
                    }}
                  >
                    <span className="time-block">{isTimedVisit(item) ? formatTimeDisplay(item.start_time) : "--:--"}</span>
                    <span className="timeline-preview-content">
                      <strong>{destination}</strong>
                      {secondaryText ? <em>{secondaryText}</em> : null}
                      <span className="timeline-preview-meta">
                        {typeLabels[item.type] ? (
                          <span
                            className="pill"
                            style={{ background: `${typeColors[item.type]}22`, color: typeColors[item.type] }}
                          >
                            {typeLabels[item.type]}
                          </span>
                        ) : null}
                        {displayCost > 0 ? <span className="pill">{formatMoney(displayCost)}</span> : null}
                        {hasAlternative ? <span className="pill">備案</span> : null}
                      </span>
                    </span>
                  </button>
                  {transportItem ? (
                    <button
                      className="timeline-preview-card transport-preview-card"
                      type="button"
                      onClick={() => {
                        onActiveDay(day.index);
                        onFocusItem(transportItem.id);
                      }}
                    >
                      <span className="transport-icon" aria-hidden="true">
                        <TransportCategoryIcon category={transportItem.transport_category} />
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

function RoutePanel({
  dayItems,
  focusedItemId,
  canPickMapPoint = false,
  hasActiveMapPointEditor = false,
  headingEyebrow = "Route",
  isPickingMapPoint = false,
  isMapAddLocationActive = false,
  isMapSearchReplaceActive = false,
  mapAddLocationRequestId = 0,
  mapPickingMode = null,
  mapPointPickFeedback = "",
  previewMapPoint = null,
  mode = "formal",
  routeOverridePointsBySegment = {},
  routeOverrideSaveError = "",
  routeEditCollaboration = {},
  viewportKey,
  onFocusItem,
  onCancelMapPointPick,
  onCancelMapAddLocation,
  onCancelMapSearchReplace,
  onPickMapPoint,
  onRouteOverrideChange,
  onRouteEditCollaborationEvent,
  onRouteEditPresenceChange,
  onSelectPlaceDetails,
  onStartMapSearchReplace,
  onStartMapPointPick,
}) {
  const previewDayItems = previewMapPoint?.itemId
    ? dayItems.map((item) => item.id === previewMapPoint.itemId
      ? {
          ...item,
          latitude: previewMapPoint.latitude,
          longitude: previewMapPoint.longitude,
          map_url: previewMapPoint.mapUrl,
        }
      : item)
    : previewMapPoint
      ? [
          ...dayItems,
          {
            id: "itinerary-editor-preview",
            item_type: "visit",
            latitude: previewMapPoint.latitude,
            location: previewMapPoint.locationName,
            location_name: previewMapPoint.locationName,
            longitude: previewMapPoint.longitude,
            map_url: previewMapPoint.mapUrl,
            title: previewMapPoint.locationName,
            type: previewMapPoint.type || "attraction",
          },
        ]
      : dayItems;
  const stops = buildRoutePanelStops(sortedVisitItems(previewDayItems), { requireLocation: true });
  const focusedMapState = getFocusedMapState(previewDayItems, stops, focusedItemId);
  const missingMapPointCount = countMissingMapPoints(dayItems);
  return (
    <section className="panel route-panel">
      <div className="panel-heading tight">
        <div>
          <p className="eyebrow">{headingEyebrow}</p>
          <h3>路線</h3>
        </div>
      </div>
      <MapPanel
        markers={stops}
        focusedMapState={focusedMapState}
        mode={mode}
        viewportKey={viewportKey}
        missingMapPointCount={missingMapPointCount}
        canPickMapPoint={canPickMapPoint}
        hasActiveMapPointEditor={hasActiveMapPointEditor}
        isPickingMapPoint={isPickingMapPoint}
        isMapAddLocationActive={isMapAddLocationActive}
        isMapSearchReplaceActive={isMapSearchReplaceActive}
        mapAddLocationRequestId={mapAddLocationRequestId}
        mapPickingMode={mapPickingMode}
        mapPointPickFeedback={mapPointPickFeedback}
        onFocusItem={onFocusItem}
        onCancelMapPointPick={onCancelMapPointPick}
        onCancelMapAddLocation={onCancelMapAddLocation}
        onCancelMapSearchReplace={onCancelMapSearchReplace}
        onPickMapPoint={onPickMapPoint}
        onRouteOverrideChange={onRouteOverrideChange}
        onRouteEditCollaborationEvent={onRouteEditCollaborationEvent}
        onRouteEditPresenceChange={onRouteEditPresenceChange}
        onSelectPlaceDetails={onSelectPlaceDetails}
        onStartMapSearchReplace={onStartMapSearchReplace}
        onStartMapPointPick={onStartMapPointPick}
        routeOverridePointsBySegment={routeOverridePointsBySegment}
        routeOverrideSaveError={routeOverrideSaveError}
        routeEditCollaboration={routeEditCollaboration}
      />
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
        <div className="create-trip-destination-fields">
          <label>
            國家
            <input
              autoComplete="off"
              required
              value={form.destination_country}
              onChange={(event) => onChange({ ...form, destination_country: event.target.value })}
            />
          </label>
          <label>
            城市
            <input
              autoComplete="off"
              required
              value={form.destination_city}
              onChange={(event) => onChange({ ...form, destination_city: event.target.value })}
            />
          </label>
        </div>
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
                      <strong>{isTimedVisit(item) ? formatTimeDisplay(item.start_time) : "--:--"}</strong>
                      {isTimedVisit(item) ? <span>{formatTimeDisplay(item.end_time)}</span> : null}
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
