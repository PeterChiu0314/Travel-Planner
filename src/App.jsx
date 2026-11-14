import ShareDialog from "./components/share/ShareDialog.jsx";
import ShareView from "./components/share/ShareView.jsx";
import AccommodationPanel from "./components/AccommodationPanel.jsx";
import ConflictNotice from "./components/ConflictNotice.jsx";
import TodoGuidePanel from "./components/TodoGuidePanel.jsx";
import {
  ActiveEditorGuardDialog,
  getDirtyActiveEditorGuards,
  requestActiveEditorGuardResolution,
  requestActiveEditorHandoff,
  useActiveEditorGuard,
} from "./app/activeEditorGuard.jsx";
import SettlementPanel from "./components/SettlementPanel.jsx";
import { memberInitial, memberName, memberRoleLabel } from "./lib/memberName.js";
import TodayMode from "./components/TodayMode.jsx";
import { dateToInputValue, formatDate, formatMoney, formatTimeDisplay, todayInput } from "./lib/displayFormat.js";
import {
  dateRangeDayCount,
  formatDateKey,
  formatHeaderDate,
  initialDateSelectionStep,
  isDateBefore,
  parseDateOnly,
  parseDateTextInput,
  startOfMonth,
} from "./lib/tripDateUi.js";
import ExpenseWorkspace from './components/budget/ExpenseWorkspace.jsx';
import {expenseFinancialSnapshot,expenseTimelineCosts,olderExpenseSnapshot} from './lib/expenseSnapshot.js';
import {createDemoExpenseService} from './demo/expenseService.js';
import {budgetReceiptsDisabled,budgetReceiptUnavailableMessage,isBudgetReceiptTarget} from './lib/budgetReceiptConfig.js';
import { readOfflineTrips, writeOfflineTrips, readOfflineTripData, writeOfflineTripData, updateOfflineSharedLuggage, updateOfflineBudget, clearOfflineAccount } from "./lib/offlineCache.js";
import { createBudgetRefresh, emptyBudgetSnapshot, cachedExpenseGraph, nonFinancialAttachments, readBudgetSnapshot } from "./lib/budgetSync.js";
import { getMapProviderConfig } from "./lib/mapProviderConfig.js";
import { submitTimelineSchedule } from "./lib/timelineScheduleService.js";
import { onPostgresChangesReady } from "./lib/realtimePostgresReadiness.js";
import { createRequestGuard, createLuggageRefresh, subscribeSharedLuggage, applyLuggageMutation, applyLuggageOrder } from "./lib/luggageSync.js";
import { useSiteDialog } from "./components/SiteDialog.jsx";
import { notify } from "./lib/notifications.js";
import { createSyncNotifications } from "./lib/syncNotifications.js";
import { createContext, Fragment, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { createDemoGuides, createDemoStays, createDemoTodos } from "./components/workspace/demoWorkspaceData.js";
import MenuSelect from "./components/MenuSelect.jsx";
import { LuggagePanel } from "./components/luggage/LuggagePanel.jsx";
import { createDemoLuggageItems, createDemoSharedLuggageItems } from "./demo/luggageFixtures.js";
import { reorderLuggageItems, reorderLuggageSnapshot, privatizeLuggageItem, privatizeLuggageSnapshot, assignLuggageItem, assignLuggageSnapshot, mutateLuggageItem, transitionSharedLuggage, luggageErrorMessage } from "./lib/luggageService.js";
import { budgetStage } from "./lib/budgetFinance.js";
import { collaboratorColors as timelineCardSelectionColors, timelineCardSelectionColor } from "./lib/collaboratorColors.js";
import { budgetAuthorityTimeoutMs } from "./lib/budgetMetadataService.js";
import { fetchBudgetQuote, getCachedBudgetQuote } from "./lib/tripBudgetRates.js";
import { tripPresencePageKey } from "./lib/tripPresenceDisplay.js";
import { demoBudgetMembers } from "./demo/budgetFixtures.js";
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
  Bed,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ExternalLink,
  Files,
  HandCoins,
  LayoutDashboard,
  Lock,
  LockOpen,
  LogIn,
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
  Plus,
  Repeat2,
  Search,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { clearDraft, findLatestDraftTrip, getDraftKey, loadLatestDraftForEntity, useDraftAutosave } from "./lib/draftAutosave.js";
import {
  planDestinationPackageReorder,
} from "./lib/destinationPackages.js";
import { acquireEditLock, isLockedByAnotherUser, releaseEditLock } from "./lib/editLocks.js";
import { resolveGoogleMapsShortUrl } from "./lib/googleMapsShortLinkResolver.js";
import { buildGoogleMapsDirectionsUrl, travelModeForTransportCategory } from "./lib/googleMapsNavigation.js";
import { hasValidMapPoint, normalizeMapPointFields, resolveDestinationMapUrlPoint } from "./lib/mapPoint.js";
import { hasSupabaseConfig, supabase } from "./lib/supabase.js";
import {
  applyTimelineSchedulePlanToItems,
  attachTimelineScheduleSortOrders,
  planTimelineSchedule,
  remapTimelineSchedulePlanItemIds,
  timelineScheduleOperationTypes,
} from "./lib/timelineSchedulePlanner.js";
import {
  isEstablishedTransportPair,
  isTransportationCard,
  normalizeTransportSnapshotTime,
} from "./lib/timelineTransportationRoles.js";
import { buildRoutePanelStops } from "./lib/timelineMapMarkers.js";
import { timelineTypeColors, timelineTypeLabels as typeLabels } from "./lib/timelineTypeStyles.js";
import {
  formatDurationMinutes,
  formatTransportDurationMinutes,
  minutesToTimeValue,
  normalizeTimelineTimeInput,
  parseDurationMinutes,
  timeToMinutes,
  tripDays,
} from "./lib/timelineTime.js";
import { transportCategories } from "./lib/timelineTransportCategories.js";
import {
  normalizeRouteOverridePoints,
  routeOverridePointsEqual,
  routeOverrideSegmentKey,
  routeOverridesToSegmentMap,
  validRouteSegmentKeysFromItems,
} from "./lib/routeOverrides.js";
import { buildTripImportPersistencePayload, serializeTripToJson } from "./lib/tripJsonAdapters.js";
import { buildTripJsonPreview } from "./lib/tripJsonContract.js";
import { parseUnifiedTripJsonText } from "./lib/unifiedTripJsonImport.js";
import {
  aiItineraryBlankTemplateFileName,
  aiItineraryExchangeModes,
  buildBlankAiItineraryTemplate,
  serializeTripToAiItinerary,
} from "./lib/aiItineraryAdapters.js";
import RoutePanel from "./components/map/RoutePanel.jsx";
import MembersInviteDialog from "./components/members/MembersInviteDialog.jsx";
import SidebarAccountMenu from "./components/sidebar/SidebarAccountMenu.jsx";
import SidebarTripSection from "./components/sidebar/SidebarTripSection.jsx";
import DayTabs from "./components/timeline/DayTabs.jsx";
import {
  OutlinedField,
  TimelineDurationField,
  TimelineSegmentedTimeField,
  TimelineTypeField,
  TransportCategoryField,
  TransportDurationField,
} from "./components/timeline/TimelineFormFields.jsx";
import TripDateRangeSelector from "./components/trip/TripDateRangeSelector.jsx";
import { HeaderMemberPresencePreview, TripDateChangePreview, TripHeaderIcon } from "./components/trip/TripHeaderParts.jsx";
import TripDialog from "./components/trip/TripDialog.jsx";
import TripImportPreviewDialog from "./components/trip-import/TripImportPreviewDialog.jsx";
import AiTripExchangeDialog from "./components/trip-import/AiTripExchangeDialog.jsx";
import {
  buildTimelineVisitDisplayOrder,
  isTimedVisit,
  isUntimedVisit,
  sortScheduleItems,
  planMixedTimedVisitReorder,
  planUntimedVisitReorder,
  untimedOrderingErrorMessage,
} from "./lib/timelineUntimedOrdering.js";
import kyotoDemoTrip from "./demo-kyoto-trip.json";

const attachmentBucket = "trip-attachments";
const appVersion = "0.1.6";
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
const timelineCardSelectionColorKeys = Object.keys(timelineCardSelectionColors);

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

const typeColors = timelineTypeColors;

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


function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(date.getDate() + amount);
  return next;
}

const defaultVisitDurationMinutes = 60;

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

function sortedVisitItems(items) {
  return buildTimelineVisitDisplayOrder(items);
}

function destinationReorderErrorMessage(error) {
  const message = String(error?.message || "");
  if (message.includes("itinerary_items_transport_pair_unique_idx")) {
    return "交通資訊重新連接時發生衝突，行程未移動，請重新整理後再試。";
  }
  if (message.includes("fixed_boundary_crossed")) return "固定行程是排程邊界，無法跨越拖曳。";
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

function alternativeApplyErrorMessage(error) {
  const message = String(error?.message || "");
  if (message.includes("stale_item") || message.includes("stale_alternative")) {
    return "行程或備案已由其他成員更新，已重新載入最新資料，請再試一次。";
  }
  if (message.includes("fixed_item")) return "此行程已固定，請先解鎖後再切換備案。";
  if (message.includes("item_locked")) return "此行程目前正由其他成員編輯，請稍後再切換備案。";
  if (message.includes("permission_denied")) return "你沒有切換此行程備案的權限。";
  if (message.includes("item_not_found") || message.includes("alternative_not_found")) {
    return "找不到這筆行程或備案，已重新載入最新資料。";
  }
  if (message.includes("visit_required")) return "交通卡不能套用景點備案。";
  return message || "備案切換失敗，行程未變更，請稍後再試。";
}

function timelineScheduleErrorMessage(plan) {
  if (plan?.validationError === "earlier_conflict") {
    return plan.earliestStart ? `此行程最早可從 ${plan.earliestStart} 開始。` : "此行程時間會侵犯前方行程。";
  }
  if (plan?.validationError === "partial_time") return "開始與結束時間必須同時設定，或同時清除。";
  if (plan?.validationError === "invalid_range") return "結束時間必須晚於開始時間。";
  if (plan?.validationError === "fixed_item") return "固定行程無法調整時間。";
  if (plan?.validationError === "fixed_boundary_crossed") return "固定行程是排程邊界，無法跨越拖曳。";
  if (plan?.validationError === "fixed_boundary_conflict") return "交通時間無法排入固定行程前。";
  if (plan?.validationError === "invalid_transport") return "交通卡必須連接兩張相鄰行程，並設定有效交通時間。";
  return "目前無法安全重新排程，請重新整理後再試。";
}

function timelineScheduleMajorEffect(plan) {
  return {
    automaticUntimedItemIds: [...(plan?.automaticUntimedItemIds || [])].sort(),
    removedTransportIds: [...(plan?.removedTransportIds || [])].sort(),
  };
}

function timelineScheduleEffectKey(plan) {
  const stableUpdate = (item) => Object.fromEntries(Object.entries(item || {}).sort(([left], [right]) => left.localeCompare(right)));
  return JSON.stringify({
    automaticUntimedItemIds: [...(plan?.automaticUntimedItemIds || [])].sort(),
    orderedVisitIds: [...(plan?.orderedVisitIds || [])],
    overflowReason: plan?.overflowReason || null,
    removedTransportIds: [...(plan?.removedTransportIds || [])].sort(),
    stoppedAtFixedItemId: plan?.stoppedAtFixedItemId || null,
    suspendedTransportIds: [...(plan?.suspendedTransportIds || [])].sort(),
    updatedItems: [...(plan?.updatedItems || [])]
      .map(stableUpdate)
      .sort((left, right) => String(left.id || "").localeCompare(String(right.id || ""))),
  });
}

function timelineScheduleUpdatedAtBaselines(items = [], overrides = {}) {
  return Object.fromEntries(
    items.map((item) => [
      item.id,
      Object.hasOwn(overrides, item.id) ? overrides[item.id] : item.updated_at || null,
    ]),
  );
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
    from_snapshot_start_time: normalizeTransportSnapshotTime(fromItem?.start_time),
    from_snapshot_end_time: normalizeTransportSnapshotTime(fromItem?.end_time),
    from_snapshot_destination: visitSnapshotDestination(fromItem) || null,
    to_snapshot_start_time: normalizeTransportSnapshotTime(toItem?.start_time),
    to_snapshot_end_time: normalizeTransportSnapshotTime(toItem?.end_time),
    to_snapshot_destination: visitSnapshotDestination(toItem) || null,
  };
}

function transportSnapshotMatchesVisit(transportItem, prefix, visitItem) {
  return (
    normalizeTransportSnapshotTime(transportItem?.[`${prefix}_snapshot_start_time`]) ===
      normalizeTransportSnapshotTime(visitItem?.start_time) &&
    normalizeTransportSnapshotTime(transportItem?.[`${prefix}_snapshot_end_time`]) ===
      normalizeTransportSnapshotTime(visitItem?.end_time) &&
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
  const invalidTransportItems = [];
  const visitById = new Map(visits.map((item) => [item.id, item]));
  const visitIndexById = new Map(visits.map((item, index) => [item.id, index]));
  items
    .filter((item) => isTransportationCard(item))
    .forEach((item) => {
      const hasPair = isEstablishedTransportPair(item) && item.from_item_id && item.to_item_id;
      const pairKey = hasPair ? transportPairKey(item.from_item_id, item.to_item_id) : "";
      const pairExists = hasPair && visitIds.has(item.from_item_id) && visitIds.has(item.to_item_id);
      const pairIsAdjacent = pairExists && adjacentKeys.has(pairKey);
      const fromVisit = visitById.get(item.from_item_id) || null;
      const toVisit = visitById.get(item.to_item_id) || null;
      const fromIndex = visitIndexById.get(item.from_item_id);
      const toIndex = visitIndexById.get(item.to_item_id);
      const blockedByUntimed =
        Number.isInteger(fromIndex) &&
        Number.isInteger(toIndex) &&
        toIndex > fromIndex + 1 &&
        visits.slice(fromIndex + 1, toIndex).some(isUntimedVisit);
      const hasPassiveUntimedEndpoint =
        Boolean(fromVisit) &&
        hasPair &&
        Boolean(toVisit) &&
        (!isTimedVisit(fromVisit) || !isTimedVisit(toVisit) || blockedByUntimed);

      if (hasPassiveUntimedEndpoint) {
        passiveUntimedTransportByFrom[item.from_item_id] = [
          ...(passiveUntimedTransportByFrom[item.from_item_id] || []),
          item,
        ];
        return;
      }

      if (pairIsAdjacent) {
        if (!adjacentTransportByPair[pairKey]) adjacentTransportByPair[pairKey] = item;
        return;
      }

      invalidTransportItems.push(item);
    });

  return { adjacentTransportByPair, invalidTransportItems, passiveUntimedTransportByFrom };
}

function transportPairNeedsReview(transportItem, fromItem, toItem) {
  return !transportSnapshotMatchesVisit(transportItem, "from", fromItem) || !transportSnapshotMatchesVisit(transportItem, "to", toItem);
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

function getTodayDateKey() {
  return todayInput();
}

function normalizeDateOnlyKey(value) {
  const date = parseDateOnly(value);
  return date ? formatDateKey(date) : "";
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
  if (path === "/demo/accommodation") return "accommodation";
  if (path === "/demo/todo") return "todo";
  if (path === "/demo/settlement") return "settlement";
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
    accommodation: "住宿資訊",
    todo: "待辦指南",
    luggage: "行李",
    settlement: "分帳結算",
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

const demoMembers = demoBudgetMembers;

function normalizeDemoTime(value) {
  return value ? String(value).slice(0, 5) : "";
}

function normalizeDemoTimePair(startTime, endTime) {
  const normalizedStartTime = normalizeDemoTime(startTime);
  const normalizedEndTime = normalizeDemoTime(endTime);
  if (!normalizedStartTime || !normalizedEndTime) return { start_time: "", end_time: "" };
  return { start_time: normalizedStartTime, end_time: normalizedEndTime };
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
  title,
  toId,
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
    transport_role: "normal_pair",
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
      title: "F・20分鐘",
      toId: "8e3cd404-f6fe-4116-829d-5f218613b96d",
    }),
    createDemoTransportFixture(items, {
      category: "walk",
      durationMinutes: 12,
      fromId: "f3973db2-8a80-444f-8108-7fe00c5c3f2a",
      id: "demo-transport-day4-lunch-school",
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
      ...normalizeDemoTimePair(item.start_time, item.end_time),
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
      transport_role: item.item_type === "transport" ? "normal_pair" : null,
      fixed_at: demoFixedVisitIds.has(item.id) ? item.fixed_at || "2026-06-30T00:00:00.000Z" : item.fixed_at || null,
      fixed_by: demoFixedVisitIds.has(item.id) ? item.fixed_by || "demo-peter" : item.fixed_by || null,
      is_fixed: demoFixedVisitIds.has(item.id) || Boolean(item.is_fixed),
      locked_by: null,
      locked_at: null,
    }))
    .sort((a, b) => a.day_index - b.day_index || a.sort_order - b.sort_order || (a.start_time || "").localeCompare(b.start_time || ""));
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
  const [budgetSnapshotState, setBudgetSnapshotState] = useState(null);
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
    if (!isDemoMode) syncFeedback.configure(session?.user?.id || null, activeTripId);
  }, [isDemoMode, session?.user?.id, activeTripId, syncFeedback]);
  useEffect(() => {
    if (isDemoMode || !session?.user) return;
    return notify.onTransportError(error => { syncFeedback.failure("action", error); });
  }, [isDemoMode, session?.user?.id, syncFeedback]);
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
  const [shareSnapshot, setShareSnapshot] = useState(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState("");
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
  const accountRef = useRef({ userId: null, generation: 0 });
  const requestGuard = useRef(createRequestGuard()).current;
  requestGuard.setContext(session?.user?.id && activeTripId ? JSON.stringify([session.user.id, activeTripId]) : null);
  const tripDataContext = requestGuard.context();
  const tripReadAccessRef = useRef(null);
  const membershipStatus = activeTrip?.membership?.status;
  if (tripReadAccessRef.current?.key !== tripDataContext.key || tripReadAccessRef.current?.status !== membershipStatus) tripReadAccessRef.current = { key: tripDataContext.key, status: membershipStatus };
  const canReadTrip = key => Boolean(key && tripReadAccessRef.current?.key === key && tripReadAccessRef.current?.status === "approved");
  const budgetSnapshot = canReadTrip(tripDataContext.key) && budgetSnapshotState
    && requestGuard.sameContext(budgetSnapshotState.context) ? budgetSnapshotState.data : null;
  const { budgetItems, budgetParticipants, actualExpenses, actualParticipants, itineraryBudgetLinks } = budgetSnapshot ?? emptyBudgetSnapshot();
  const budgetSnapshotRef = useRef({ context: tripDataContext, data: emptyBudgetSnapshot() });
  if (!requestGuard.sameContext(budgetSnapshotRef.current.context)) {
    budgetSnapshotRef.current = { context: tripDataContext, data: emptyBudgetSnapshot() };
  }
  function applyBudgetSnapshot(data, key, cache = true) {
    const context = requestGuard.context();
    if (context.key !== key) return;
    if (olderExpenseSnapshot(budgetSnapshotRef.current.data.expenseGraph, data.expenseGraph)) return;
    const verifiedAt = data.expenseVerified ? Date.now() : undefined;
    const snapshot = { context, data, verifiedAt };
    budgetSnapshotRef.current = snapshot;
    setBudgetSnapshotState(snapshot);
    if (key && cache) {
      const [userId, tripId] = JSON.parse(key);
      updateOfflineBudget(tripId, userId, cachedExpenseGraph(data.expenseGraph, tripId), localStorage, verifiedAt);
    }
    if (data.expenseVerified && data.tripBudgetRates) {
      setTrips(current => current.map(t => t.id === data.tripId ? { ...t, budget_exchange_rates: data.tripBudgetRates } : t));
    }
  }
  const budgetRefreshRef = useRef(null);
  if (!budgetRefreshRef.current) budgetRefreshRef.current = createBudgetRefresh({
    guard: requestGuard,
    timeoutMs: budgetAuthorityTimeoutMs,
    read: async key => {
      const feedbackCheckpoint = syncFeedback.checkpoint();
      const access = tripReadAccessRef.current;
      if (!canReadTrip(key)) return { data: emptyBudgetSnapshot(), feedbackCheckpoint };
      const result = await readBudgetSnapshot(supabase, JSON.parse(key)[1]);
      return { ...(tripReadAccessRef.current === access && canReadTrip(key) ? result : { data: emptyBudgetSnapshot() }), feedbackCheckpoint };
    },
    apply: applyBudgetSnapshot,
    onVerified: result => syncFeedback.verified("budget", result.feedbackCheckpoint),
    onError: error => {
      const { context, data } = budgetSnapshotRef.current;
      const { key } = context;
      if (!requestGuard.sameContext(context) || !canReadTrip(key)) return;
      if (error.code === "42501") {
        applyBudgetSnapshot({ ...emptyBudgetSnapshot(), expenseUnavailable: true }, key);
      } else {
        let visible = data;
        if (!data.expenseGraph && !data.expenseUnavailable) {
          const [userId, tripId] = JSON.parse(key);
          const cached = readOfflineTripData(tripId, userId);
          const graph = cachedExpenseGraph(cached?.expenseGraph ?? cached?.budgetSnapshot?.expenseGraph, tripId);
          if (graph) visible = expenseFinancialSnapshot(graph);
        }
        applyBudgetSnapshot({ ...visible, expenseVerified: false, expenseUnavailable: true }, key, false);
      }
      syncFeedback.failure("budget", error.code === "PGRST202" ? "目前無法讀取支出，請稍後重試。" : error);
    },
  });
  const refreshBudget = useCallback((tripId) => {
    if (!requestGuard.sameContext(tripDataContext) || !tripDataContext.key || JSON.parse(tripDataContext.key)[1] !== tripId) return Promise.resolve({ ok: false, stale: true });
    return budgetRefreshRef.current.committed();
  }, [tripDataContext.key, tripDataContext.generation]);
  const sharedSnapshotRef = useRef({ key: null, rows: [] });
  if (sharedSnapshotRef.current.key !== requestGuard.context().key) sharedSnapshotRef.current = { key: requestGuard.context().key, rows: [] };
  function updateSharedCache(tripId, userId, update) {
    sharedSnapshotRef.current.rows = update(sharedSnapshotRef.current.rows);
    updateOfflineSharedLuggage(tripId, userId, () => sharedSnapshotRef.current.rows);
  }
  const luggageRefreshRef = useRef(null);
  if (!luggageRefreshRef.current) luggageRefreshRef.current = createLuggageRefresh({
    guard: requestGuard,
    read: async (scope, key) => {
      const feedbackCheckpoint = syncFeedback.checkpoint();
      const [userId, tripId] = JSON.parse(key);
      const access = tripReadAccessRef.current;
      if (!canReadTrip(key)) return { data: [], feedbackCheckpoint };
      let query = supabase.from(scope === "personal" ? "luggage_items" : "shared_luggage_items").select("*").eq("trip_id", tripId);
      if (scope === "personal") query = query.eq("owner_id", userId);
      const result = await query.order("created_at");
      return { ...(tripReadAccessRef.current === access && canReadTrip(key) ? result : { data: [] }), feedbackCheckpoint };
    },
    apply: (scope, rows) => {
      (scope === "personal" ? setLuggageItems : setSharedLuggageItems)(rows);
      if (scope === "shared") {
        const [userId, tripId] = JSON.parse(requestGuard.context().key);
        sharedSnapshotRef.current.rows = rows;
        updateOfflineSharedLuggage(tripId, userId, () => rows);
      }
    },
    onError: (error, scope) => syncFeedback.failure(`luggage:${scope}`, error),
    onVerified: (scope, result) => syncFeedback.verified(`luggage:${scope}`, result.feedbackCheckpoint),
  });
  const refreshLuggage = useCallback((tripId, scopes = ["personal", "shared"]) => {
    const key = requestGuard.context().key;
    if (!key || JSON.parse(key)[1] !== tripId) return Promise.resolve();
    return luggageRefreshRef.current.refresh(scopes);
  }, [requestGuard]);
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
    if (isDemoMode || !isPending || !activeTripId || !session?.user?.id) return;
    const id = `trip-membership-pending:${session.user.id}:${activeTripId}`;
    notify.info("你已送出加入申請，旅程擁有者核准後即可共同編輯。", { id });
    return () => notify.dismiss(id);
  }, [isDemoMode, isPending, activeTripId, session?.user?.id]);
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

  const loadTripData = useCallback(async (tripId) => {
    const userId = accountRef.current.userId;
    // A queued callback must belong to this context's generation before it can
    // advance any scope. Comparing IDs alone would accept an A -> B -> A callback.
    if (tripId) {
      if (!userId || !requestGuard.sameContext(tripDataContext) || tripDataContext.key !== JSON.stringify([userId, tripId])) return;
    } else if (requestGuard.context().key !== null) return;
    // Auth resets the guard to null before clearing, even through an older closure.
    const token = requestGuard.begin("trip");
    const personalToken = requestGuard.begin("personal"), sharedToken = requestGuard.begin("shared");
    const access = tripReadAccessRef.current;
    if (!tripId || !canReadTrip(tripDataContext.key)) {
      setItems([]);
      setAlternatives([]);
      applyBudgetSnapshot(emptyBudgetSnapshot(), token.key, false);
      sharedSnapshotRef.current.rows = [];
      setAccommodations([]);
      setGuideItems([]);
      setTodoItems([]);
      setLuggageItems([]);
      setSharedLuggageItems([]);
      setAttachments([]);
      setRouteOverrides([]);
      setPackItems([]);
      setMembers([]);
      return;
    }

    // A financial read can fail or wait independently of the trip workspace.
    void budgetRefreshRef.current.committed();
    const feedbackCheckpoint = syncFeedback.checkpoint();
    const [itemsResult, alternativesResult, accommodationsResult, guideResult, todoResult, luggageResult, sharedLuggageResult,
      attachmentsResult, packResult, membersResult] = await Promise.all([
      supabase.from("itinerary_items").select("*").eq("trip_id", tripId),
      supabase.from("itinerary_alternatives").select("*"),
      supabase.from("accommodations").select("*").eq("trip_id", tripId).order("check_in_date"),
      supabase.from("guide_items").select("*").eq("trip_id", tripId).order("created_at"),
      supabase.from("todo_items").select("*").eq("trip_id", tripId).order("due_date", { nullsFirst: false }),
      supabase.from("luggage_items").select("*").eq("trip_id", tripId).eq("owner_id", userId).order("created_at"),
      supabase.from("shared_luggage_items").select("*").eq("trip_id", tripId).order("created_at"),
      supabase.from("attachments").select("*").eq("trip_id", tripId).order("created_at"),
      supabase.from("pack_items").select("*").eq("trip_id", tripId).order("created_at"),
      supabase.from("trip_members").select("id,trip_id,user_id,role,status,created_at,display_name,email").eq("trip_id", tripId).order("created_at"),
    ]);
    if (!requestGuard.valid(token) || tripReadAccessRef.current !== access || !canReadTrip(token.key)) return;
    const error = itemsResult.error || alternativesResult.error || accommodationsResult.error || guideResult.error || todoResult.error
      || luggageResult.error || sharedLuggageResult.error || attachmentsResult.error || packResult.error || membersResult.error;
    if (error) {
      const cached = readOfflineTripData(tripId, userId);
      if (cached) {
        setItems(cached.items || []); setAlternatives(cached.alternatives || []);
        setAccommodations(cached.accommodations || []); setGuideItems(cached.guideItems || []); setTodoItems(cached.todoItems || []);
        if (requestGuard.valid(sharedToken)) { sharedSnapshotRef.current.rows = cached.sharedLuggageItems || []; setSharedLuggageItems(sharedSnapshotRef.current.rows); }
        setAttachments(nonFinancialAttachments(cached.attachments || [])); setPackItems(cached.packItems || []); setMembers(cached.members || []);
        syncFeedback.failure("trip-data", error, { cached: true }); return { ok: false, error };
      }
      syncFeedback.failure("trip-data", error); return { ok: false, error };
    }
    const nextItems = itemsResult.data || [];
    const itemIds = new Set(nextItems.map(item => item.id));
    const nextAlternatives = (alternativesResult.data || []).filter(alternative => itemIds.has(alternative.itinerary_item_id));

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
    setAccommodations(accommodationsResult.data || []);
    setGuideItems(guideResult.data || []);
    setTodoItems(todoResult.data || []);
    if (requestGuard.valid(personalToken)) setLuggageItems(luggageResult.data || []);
    if (requestGuard.valid(sharedToken)) {
      sharedSnapshotRef.current.rows = sharedLuggageResult.data || [];
      setSharedLuggageItems(sharedLuggageResult.data || []);
    }
    const nextAttachments = nonFinancialAttachments(attachmentsResult.data || []);
    setAttachments(nextAttachments);
    setPackItems(packResult.data || []);
    setMembers(membersResult.data || []);
    const { data: finance, verifiedAt } = budgetSnapshotRef.current;
    // A successful core load can finish before the independent expense read.
    // Keep its scoped cache until that read supplies a graph or clears access.
    const prior = !finance.expenseVerified && (finance.expenseGraph || !finance.expenseUnavailable)
      ? readOfflineTripData(tripId, userId) : null;
    const expenseGraph = cachedExpenseGraph(finance.expenseVerified
      ? finance.expenseGraph : prior?.expenseGraph ?? prior?.budgetSnapshot?.expenseGraph, tripId);
    writeOfflineTripData(tripId, userId, {
      expenseGraph,
      expenseGraphCachedAt: expenseGraph ? verifiedAt ?? prior?.expenseGraphCachedAt : undefined,
      items: nextItems,
      alternatives: nextAlternatives,
      accommodations: accommodationsResult.data || [],
      guideItems: guideResult.data || [],
      todoItems: todoResult.data || [],
      luggageItems: luggageResult.data || [],
      sharedLuggageItems: sharedSnapshotRef.current.rows,
      attachments: nextAttachments,
      packItems: packResult.data || [],
      members: membersResult.data || [],
    });
    syncFeedback.verified(["trip-data", "connection", "action",
      ...(requestGuard.valid(personalToken) ? ["luggage:personal"] : []),
      ...(requestGuard.valid(sharedToken) ? ["luggage:shared"] : [])], feedbackCheckpoint);
    return { ok: true };
  }, [tripDataContext.key, tripDataContext.generation, activeMembership?.status]);

  useEffect(() => {
    if (isDemoMode || !session?.user) return;
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
  }, [isDemoMode, session?.user?.id, activeTripId, loadTrips, loadTripData, syncFeedback]);

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

    let alive = true, authEvent = 0;
    function acceptSession(nextSession) {
      if (!alive) return;
      const nextId = nextSession?.user?.id || null, previous = accountRef.current;
      if (previous.userId !== nextId) {
        clearOfflineAccount(previous.userId);
        accountRef.current = { userId: nextId, generation: previous.generation + 1 };
        requestGuard.setContext(null);
        luggageRefreshRef.current.cancel();
        budgetRefreshRef.current.cancel();
        setTrips([]); setActiveTripId(null);
        void loadTripData(null);
      }
      setSession(nextSession);
      setAuthReady(true);
    }
    supabase.auth.getSession().then(({ data }) => { if (!authEvent) acceptSession(data.session); });
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      authEvent++;
      acceptSession(nextSession);
      if (event === "SIGNED_OUT" || !nextSession) clearOfflineAccount(accountRef.current.userId);
    });

    return () => { alive = false; data.subscription.unsubscribe(); };
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
    let subscriptionActive = true;
    const invalidateBudget = () => { if (requestGuard.sameContext(tripDataContext)) budgetRefreshRef.current.schedule(); };
    const channel = supabase
      // A fresh topic avoids reusing the old channel while unsubscribe is in flight.
      .channel(`trip-${activeTripId}${tripRealtimeAttempt ? `-retry-${tripRealtimeAttempt}` : ""}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trips", filter: `id=eq.${activeTripId}` },
        () => { invalidateBudget(); loadTrips(activeTripId); },
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
        { event: "*", schema: "public", table: "attachments", filter: `trip_id=eq.${activeTripId}` },
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
      );
    channel.on("postgres_changes", { event: "*", schema: "public", table: "expense_signals", filter: `trip_id=eq.${activeTripId}` }, invalidateBudget);
    subscribeSharedLuggage(channel, activeTripId, luggageRefreshRef.current);
    // JOIN can succeed before Postgres Changes is live. Re-read through the
    // existing guarded/coalesced path when CDC becomes ready, including rejoin.
    onPostgresChangesReady(channel, () => {
      if (subscriptionActive && requestGuard.sameContext(tripDataContext)) invalidateBudget();
    });
    channel.subscribe(status => {
      if (!subscriptionActive || !requestGuard.sameContext(tripDataContext)) return;
      if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) syncFeedback.failure("realtime", "即時連線暫時中斷，資料同步尚未確認。");
      if (status === "SUBSCRIBED" && syncFeedback.pending().includes("realtime")) {
        // Existing subscription recovery already schedules these scoped reads.
        for (const source of ["budget", "luggage:personal", "luggage:shared"]) syncFeedback.failure(source, "正在重新核對資料，請稍候。");
        syncFeedback.verified("realtime");
      }
      if (status === "SUBSCRIBED") { luggageRefreshRef.current.schedule(["personal", "shared"]); invalidateBudget(); }
    });
    return () => { subscriptionActive = false; budgetRefreshRef.current.cancel(); luggageRefreshRef.current.cancel(); supabase.removeChannel(channel); };
  }, [activeDay, activeTripId, loadRouteOverrides, loadTripData, loadTrips, session?.user, tripRealtimeAttempt]);

  useEffect(() => {
    if (isDemoMode || !session?.user || !activeTripId || activeSection !== "luggage") return;
    const refresh = () => { if (document.visibilityState !== "hidden") luggageRefreshRef.current.schedule(["personal", "shared"]); };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [isDemoMode, session?.user?.id, activeTripId, activeSection]);

  useEffect(() => {
    if (isDemoMode || !session?.user || !activeTripId || !["budget", "settlement"].includes(activeSection)) return;
    const context = tripDataContext;
    const refresh = () => { if (document.visibilityState !== "hidden" && requestGuard.sameContext(context)) budgetRefreshRef.current.schedule(); };
    refresh();
    window.addEventListener("focus", refresh); window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [isDemoMode, session?.user?.id, activeTripId, activeSection, tripDataContext.generation]);

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
    const latestTripDraft = session?.user?.id
      ? findLatestDraftTrip({ entityTypes: ["itinerary_item"], userId: session.user.id })
      : null;
    if (latestTripDraft?.tripId === activeTrip.id) {
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
    if (error) {
      notify.error(error.message);
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
      confirmed_major_effect: confirmedMajorEffect,
      expected_visit_ids: expectedVisitIds || sortedVisitItems(sourceItems).map((item) => item.id),
      item_updated_at_baselines: itemUpdatedAtBaselines,
      operation_intent: operation,
      package_source_item_ids: packageSourceItemIds,
      preview_result: plan,
      slot_item_ids: slotItemIds,
      target_day_index: dayIndex,
      target_item_id: targetItemId,
      target_payload: targetPayload,
      target_trip_id: activeTrip.id,
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
    const normalizedPayload = normalizeItemPayload(payload);
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
      expense_id: payload.expense_id || null,
      custom_notes: payload.custom_notes.trim() || null,
    };
    const result = editingId
      ? await updateWithConflictCheck("accommodations", nextPayload, editingId, meta)
      : await supabase.from("accommodations").insert(nextPayload);
    if (result.error) notify.error(result.error.message);
    else if (result.conflict) notify.warning("此資料在你編輯期間已被其他人更新。");
    else await loadTripData(activeTrip.id);
    return result.conflict ? { ok: false, conflict: true } : { ok: !result.error, error: result.error };
  }

  async function deleteAccommodation(accommodationId) {
    if (!activeTrip || !canEditActiveTripContent) return;
    const { error } = await supabase.from("accommodations").delete().eq("id", accommodationId);
    if (error) notify.error(error.message);
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
    if (result.error) notify.error(result.error.message);
    else if (result.conflict) notify.warning("此資料在你編輯期間已被其他人更新。");
    else await loadTripData(activeTrip.id);
    return result.conflict ? { ok: false, conflict: true } : { ok: !result.error, error: result.error };
  }

  async function deleteGuide(guideId) {
    if (!activeTrip || !canEditActiveTripContent) return;
    const { error } = await supabase.from("guide_items").delete().eq("id", guideId);
    if (error) notify.error(error.message);
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
    if (result.error) notify.error(result.error.message);
    else if (result.conflict) notify.warning("此資料在你編輯期間已被其他人更新。");
    else await loadTripData(activeTrip.id);
    return result.conflict ? { ok: false, conflict: true } : { ok: !result.error, error: result.error };
  }

  async function toggleTodo(todo) {
    if (!canEditActiveTripContent) return;
    const { error } = await supabase.from("todo_items").update({ completed: !todo.completed }).eq("id", todo.id);
    if (error) notify.error(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function deleteTodo(todoId) {
    if (!activeTrip || !canEditActiveTripContent) return;
    const { error } = await supabase.from("todo_items").delete().eq("id", todoId);
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
            canEditBudget={canEdit}
            canEdit={canEditActiveTripContent}
            dayItems={dayItems}
            days={days}
            isOwner={isOwner}
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
      transport_role: "normal_pair",
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

function TripHeader({
  activeSection,
  trip,
  members = [],
  currentUserId,
  days = [],
  dateChangePreviewData = {},
  demoNotice = "",
  demoStage,
  canEditTrip = false,
  canChangeTripDates = canEditTrip,
  canOpenMembers = canEditTrip,
  canRenameTrip = canEditTrip,
  canShare = canEditTrip,
  canViewDatePopover = canChangeTripDates,
  pendingMemberCount = 0,
  onDelete,
  onAiExchange,
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
  const meta = useMemo(() => {
    const value = buildTripHeaderMeta(trip, members, days);
    return demoStage ? { ...value, stage: demoStage, statusLabel: tripStageLabel(demoStage) } : value;
  }, [days, members, trip, demoStage]);
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
              {onAiExchange ? (
                <button type="button" role="menuitem" onClick={() => chooseMenuAction(onAiExchange)}>
                  給 AI 調整
                </button>
              ) : null}
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
  const { ask: askDemo, dialog: demoDialog } = useSiteDialog();
  const [activeSection, setActiveSection] = useState(initialSection || "timeline");
  const [activeDay, setActiveDay] = useState(0);
  const [isDemoMembersDialogOpen, setIsDemoMembersDialogOpen] = useState(false);
  const [demoActiveTrip, setDemoActiveTrip] = useState(() => demoTrips[0]);
  const [isDemoSidebarCollapsed, setIsDemoSidebarCollapsed] = useState(false);
  const [isDemoSidebarTripMenuOpen, setIsDemoSidebarTripMenuOpen] = useState(false);
  const [timelineItems, setTimelineItems] = useState(() => createDemoTimelineItems());
  const [timelineAlternatives, setTimelineAlternatives] = useState([]);
  const demoExpenseItems = useRef(timelineItems); demoExpenseItems.current = timelineItems;
  const [demoExpenseServices, setDemoExpenseServices] = useState(() => Object.fromEntries(demoTrips.map(trip => [trip.id,
    createDemoExpenseService({trip,members:demoMembers,getItems:()=>demoExpenseItems.current.filter(item=>item.trip_id===trip.id)})])));
  const [demoExpenseSnapshots, setDemoExpenseSnapshots] = useState(() => Object.fromEntries(Object.entries(demoExpenseServices).map(([id,service])=>[id,service.snapshot()])));
  const [demoScenario, setDemoScenario] = useState("live");
  const [demoClock, setDemoClock] = useState(Date.now);
  const demoStage = demoScenario === "live" ? budgetStage(demoActiveTrip, new Date(demoClock)) : demoScenario;
  const finance = expenseFinancialSnapshot(demoExpenseSnapshots[demoActiveTrip.id]);
  const { budgetItems, budgetParticipants, actualExpenses, actualParticipants, itineraryBudgetLinks } = finance;
  useEffect(() => {
    const timer = window.setInterval(() => setDemoClock(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const [demoSupportByTrip, setDemoSupportByTrip] = useState(() => Object.fromEntries(demoTrips.map((trip, index) => [trip.id, {
    accommodations: index === 0 ? createDemoStays(trip) : [],
    todoItems: index === 0 ? createDemoTodos(trip) : [],
    guideItems: index === 0 ? createDemoGuides() : [],
    luggageItems: index === 0 ? createDemoLuggageItems(trip.id) : [],
    sharedLuggageItems: index === 0 ? createDemoSharedLuggageItems(trip.id) : [],
  }])));
  const support = demoSupportByTrip[demoActiveTrip.id];
  const { accommodations, todoItems, guideItems, luggageItems, sharedLuggageItems } = support;
  function setSupportField(key, update) {
    const tripId = demoActiveTrip.id;
    setDemoSupportByTrip((current) => ({ ...current, [tripId]: { ...current[tripId],
      [key]: typeof update === "function" ? update(current[tripId][key]) : update } }));
  }
  const setAccommodations = (update) => setSupportField("accommodations", update);
  const setTodoItems = (update) => setSupportField("todoItems", update);
  const setGuideItems = (update) => setSupportField("guideItems", update);
  const setLuggageItems = (update) => setSupportField("luggageItems", update);
  const setSharedLuggageItems = (update) => setSupportField("sharedLuggageItems", update);
  const [luggageTab, setLuggageTab] = useState("personal");
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
    const byId = new Map(expenseTimelineCosts(finance.expenseGraph).map(item=>[item.id,item]));
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

  async function changeSection(section) {
    if (section === activeSection) return;
    if (!(await requestActiveEditorHandoff({ tripId: demoActiveTrip.id }))) return;
    setActiveSection(section);
    window.history.pushState({}, "", `/demo/${section}`);
  }

  async function changeDemoTrip(tripId) {
    const nextTrip = demoTrips.find((trip) => trip.id === tripId);
    if (!nextTrip || tripId === demoActiveTrip.id || !(await requestActiveEditorHandoff({ tripId: demoActiveTrip.id }))) return;
    setActiveDay(tripTodayIndex(nextTrip));
    setFocusedItemId(null);
    setDemoScenario("live");
    setDemoActiveTrip(nextTrip);
  }

  async function changeDemoScenario(scenario) {
    if (!(await requestActiveEditorHandoff({ tripId: demoActiveTrip.id, workspace: "budget" }))) return;
    setDemoScenario(scenario);
  }

  async function resetDemoBudget() {
    if (!(await requestActiveEditorHandoff({ tripId: demoActiveTrip.id, workspace: "budget" }))) return;
    if (!await askDemo({ title: "重設 Demo 預算？", message: "將重設這個旅程的 Demo 預算、實付與附件。", confirmLabel: "重設", danger: true })) return;
    const service=createDemoExpenseService({trip:demoActiveTrip,members:demoMembers,getItems:()=>demoExpenseItems.current.filter(item=>item.trip_id===demoActiveTrip.id)});
    setDemoExpenseServices(current=>({...current,[demoActiveTrip.id]:service}));
    setDemoExpenseSnapshots(current=>({...current,[demoActiveTrip.id]:service.snapshot()}));
    setDemoScenario("live");
  }

  async function returnToLogin() {
    if (!(await requestActiveEditorHandoff({ tripId: demoActiveTrip.id }))) return;
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
    if (!nextPayload.title.trim()) return { ok: false };
    if (nextPayload.item_type !== "transport" && Boolean(nextPayload.start_time) !== Boolean(nextPayload.end_time)) {
      return { ok: false, errorMessage: "開始與結束時間必須同時設定，或同時清除。" };
    }
    const editingItem = editingId ? timelineItems.find((item) => item.id === editingId) : null;
    if (isEffectiveFixedVisit(editingItem)) return { ok: false, fixed: true };

    const timelineScheduleTargetId = meta.timelineScheduleTargetId || editingId;
    if (timelineScheduleTargetId && meta.timelineSchedulePlan?.ok) {
      const schedulePlan = meta.timelineSchedulePlan.upsertedTransport
        ? {
            ...meta.timelineSchedulePlan,
            upsertedTransport: {
              ...meta.timelineSchedulePlan.upsertedTransport,
              day_index: activeDay,
              sort_order: meta.timelineSchedulePlan.upsertedTransport.sort_order ?? 0,
              trip_id: demoActiveTrip.id,
            },
          }
        : meta.timelineSchedulePlan;
      const updatedAt = new Date().toISOString();
      setTimelineItems((current) =>
        applyTimelineSchedulePlanToItems({
          items: current,
          plan: schedulePlan,
          targetItemId: timelineScheduleTargetId,
          targetPayload: nextPayload,
          updatedAt,
        }),
      );
      return {
        data: { ...(editingItem || {}), ...nextPayload, id: timelineScheduleTargetId, updated_at: updatedAt },
        ok: true,
      };
    }

    if (nextPayload.item_type !== "transport" && isInvalidTimeRange(nextPayload.start_time, nextPayload.end_time)) {
      return { ok: false };
    }
    const overlapItem = findOverlappingVisitItem({
      dayIndex: activeDay,
      editingId,
      items: timelineItems,
      payload: nextPayload,
    });
    if (overlapItem && !editingId) {
      return { ok: false, overlapError: formatTimelineOverlapError(overlapItem) };
    }
    if (isTransportationCard(nextPayload) && (!nextPayload.from_item_id || !nextPayload.to_item_id)) {
      return { ok: false };
    }
    if (editingId) {
      setTimelineItems((current) =>
        current.map((item) =>
          item.id === editingId ? { ...item, ...nextPayload, updated_at: new Date().toISOString() } : item,
        ),
      );
      return { ok: true };
    }

    const newItemId = demoId(nextPayload.item_type === "transport" ? "demo-transport" : "demo-itinerary");
    setTimelineItems((current) => {
      const currentDayVisits = sortedVisitItems(current.filter((item) => item.day_index === activeDay));
      const sortOrder = demoSortOrderForNewTimelineItem({ currentDayVisits, item: nextPayload });
      return [
        ...current,
        {
          ...emptyItemForm,
          ...nextPayload,
          id: newItemId,
          trip_id: demoActiveTrip.id,
          day_index: activeDay,
          sort_order: sortOrder,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];
    });
    return { ok: true, data: { id: newItemId } };
  }
  function reorderTimelineDestinationPackages({
    dayIndex,
    orderedTimedItemIds,
    orderedVisitItemIds,
    packageSourceItemIds,
    slotItemIds,
    timelineSchedulePlan = null,
  }) {
    if (dayIndex !== activeDay || !timelineSchedulePlan?.ok) return { ok: false };
    const packagePlan = planDestinationPackageReorder({
      alternatives: timelineAlternatives,
      itineraryBudgetLinks,
      items: timelineItems,
      orderedTimedItemIds,
      orderedVisitItemIds,
      packageSourceItemIds,
      slotItemIds,
    });
    if (!packagePlan.ok) {
      return { ok: false, errorMessage: destinationReorderErrorMessage({ message: packagePlan.errorCode }) };
    }
    const sourceToSlotIds = new Map(packageSourceItemIds.map((sourceId, index) => [sourceId, slotItemIds[index]]));
    const mappedSchedulePlan = remapTimelineSchedulePlanItemIds({ plan: timelineSchedulePlan, sourceToSlotIds });
    const updatedAt = new Date().toISOString();
    setTimelineItems(
      applyTimelineSchedulePlanToItems({ items: packagePlan.items, plan: mappedSchedulePlan, updatedAt }),
    );
    setTimelineAlternatives(packagePlan.alternatives);
    setItineraryBudgetLinks(packagePlan.itineraryBudgetLinks);
    return { ok: true, data: { packagePlan, schedulePlan: mappedSchedulePlan } };
  }

  function reorderTimelineUntimedVisit({ dayIndex, timelineSchedulePlan = null }) {
    if (dayIndex !== activeDay || !timelineSchedulePlan?.ok) return { ok: false };
    setTimelineItems((current) =>
      applyTimelineSchedulePlanToItems({
        items: current,
        plan: timelineSchedulePlan,
        updatedAt: new Date().toISOString(),
      }),
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
    if (deletedItem && isTransportationCard(deletedItem)) {
      const currentDayItems = timelineItems.filter((item) => Number(item.day_index) === Number(activeDay));
      const expectedVisitIds = sortedVisitItems(currentDayItems).map((visit) => visit.id);
      const plan = attachTimelineScheduleSortOrders({
        items: currentDayItems,
        plan: planTimelineSchedule({
          items: currentDayItems,
          operation: { transportId: deletedItem.id, type: timelineScheduleOperationTypes.deleteTransport },
          orderedVisitIds: expectedVisitIds,
        }),
      });
      if (!plan.ok) return;
      setTimelineItems((current) =>
        applyTimelineSchedulePlanToItems({ items: current, plan, updatedAt: new Date().toISOString() }),
      );
      return;
    }
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

  const demoLuggageRef = useRef(support);
  demoLuggageRef.current = support;
  function mutateDemoLuggage(scope, action, payload, id, meta = {}) {
    if (meta.tripId && meta.tripId !== demoActiveTrip.id) return { ok: false, crossTrip: true };
    const key = scope === "personal" ? "luggageItems" : "sharedLuggageItems";
    const list = demoLuggageRef.current[key];
    const old = list.find(row => row.id === id);
    if (id && (!old || old.trip_id !== demoActiveTrip.id)) return { ok: false, error: new Error("找不到此旅程的物品。") };
    if (old && old.updated_at !== meta.baseUpdatedAt) return { ok: false, conflict: true };
    try {
      const normalized = action === "save" ? { title: payload.title.trim(), category: payload.category.trim(), notes: (payload.notes || "").trim(), ...(scope === "shared" ? { assigned_to: payload.assigned_to || null } : {}) } : payload;
      if (action === "save" && !normalized.title) return { ok: false };
      const next = action === "delete" ? null : { ...(scope === "shared" ? transitionSharedLuggage(old || { packed_by_assignee: false }, normalized, {
        userId: "demo-peter", isOwner: true, approvedMemberIds: demoMembers.filter(row => row.status === "approved").map(row => row.user_id),
      }) : { ...old, ...normalized, owner_id: "demo-peter", packed: action === "save" ? Boolean(old?.packed) : payload.packed }),
        id: id || demoId("demo-luggage"), trip_id: demoActiveTrip.id, updated_at: new Date(Math.max(Date.now(), Date.parse(old?.updated_at || 0) + 1)).toISOString() };
      const nextList = action === "delete" ? list.filter(row => row.id !== id) : id ? list.map(row => row.id === id ? next : row) : [...list, next];
      demoLuggageRef.current = { ...demoLuggageRef.current, [key]: nextList };
      setSupportField(key, nextList);
      return { ok: true, data: next };
    } catch(error) { return { ok: false, error: new Error(luggageErrorMessage(error)) }; }
  }
  function savePersonalLuggage(payload, editingId, meta) { return mutateDemoLuggage("personal", "save", payload, editingId, meta); }

  function saveSharedLuggage(payload, editingId, meta) { return mutateDemoLuggage("shared", "save", payload, editingId, meta); }

  function assignDemoLuggage(scope, item, assignedTo) {
    try {
      const next = assignLuggageSnapshot(demoLuggageRef.current, { scope, item, assignedTo, tripId: demoActiveTrip.id, userId: "demo-peter", approvedMemberIds: demoMembers.filter(member => member.status === "approved").map(member => member.user_id) });
      demoLuggageRef.current = next;
      setDemoSupportByTrip(current => ({ ...current, [demoActiveTrip.id]: next }));
      return { ok: true, data: next.sharedLuggageItems.find(row => row.id === item.id) };
    } catch (error) { return { ok: false, error: new Error(luggageErrorMessage(error)) }; }
  }

  function privatizeDemoLuggage(item, category) {
    try {
      const next = privatizeLuggageSnapshot(demoLuggageRef.current, { item, category, tripId: demoActiveTrip.id, userId: "demo-peter", approvedMemberIds: demoMembers.filter(member => member.status === "approved").map(member => member.user_id) });
      demoLuggageRef.current = next;
      setDemoSupportByTrip(current => ({ ...current, [demoActiveTrip.id]: next }));
      return { ok: true, data: next.luggageItems.find(row => row.id === item.id) };
    } catch (error) { return { ok: false, error: new Error(luggageErrorMessage(error)) }; }
  }

  function reorderDemoLuggage(scope, item, target, placement, items) {
    try {
      const next = reorderLuggageSnapshot(demoLuggageRef.current, { scope, item, target, placement, items, tripId: demoActiveTrip.id,
        userId: "demo-peter", approvedMemberIds: demoMembers.filter(member => member.status === "approved").map(member => member.user_id) });
      demoLuggageRef.current = next;
      setDemoSupportByTrip(current => ({ ...current, [demoActiveTrip.id]: next }));
      return { ok: true };
    } catch (error) { return { ok: false, error: new Error(luggageErrorMessage(error)) }; }
  }

  function saveDemoRecord(key, form, editingId, meta = {}) {
    if (!(form.title || form.name || "").trim() || (meta.tripId && meta.tripId !== demoActiveTrip.id)) return { ok: false };
    if (editingId && !support[key].some((item) => item.id === editingId)) return { ok: false };
    const record = { ...form, updated_at: new Date().toISOString() };
    setSupportField(key, (current) => editingId
      ? current.map((item) => item.id === editingId ? { ...item, ...record } : item)
      : [...current, { ...record, id: demoId(`demo-${key}`), completed: false }]);
    return { ok: true };
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
          {desktopNavItems.map((navItem) => {
            const section = navItem.id;
            const available = ["timeline", "budget", "accommodation", "todo", "luggage", "settlement"].includes(section);
            const Icon = navItem ? desktopNavIcons[navItem.id] : null;
            return (
              <button
                className={`section-nav-button${activeSection === section ? " active" : ""}`}
                key={section}
                type="button"
                title={available ? navItem.label : `${navItem.label}（此 Demo 尚未提供）`}
                aria-label={navItem.label}
                disabled={!available}
                aria-current={activeSection === section ? "page" : undefined}
                onClick={() => changeSection(section)}
              >
                <span className="section-nav-icon" aria-hidden="true">
                  {Icon ? <Icon size={15} strokeWidth={2.2} /> : navItem?.shortLabel}
                </span>
                <span className="nav-label">{navItem.label}</span>
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
          onSelect={changeDemoTrip}
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
          demoStage={activeSection === "budget" || activeSection === "settlement" ? demoStage : undefined}
          canShare={false}
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
        {new URLSearchParams(window.location.search).get("budgetTools") === "1" && (activeSection === "budget" || activeSection === "settlement") ? <div className="demo-budget-controls">
          <div className="demo-budget-scenario"><span>Demo 情境</span><MenuSelect label="Demo 情境" value={demoScenario} onValueChange={(value)=>void changeDemoScenario(value)} options={[{value:"live",label:"依目前日期"},{value:"planning",label:"行前規劃"},{value:"traveling",label:"行程中"},{value:"settled",label:"旅程結算"}]} /></div>
          <span>{demoMembers.length} 位成員 · {budgetItems.length} 筆預算</span>
          <button className="ghost-button compact" type="button" onClick={() => void resetDemoBudget()}>重設預算案例</button>
        </div> : null}
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
          <ExpenseWorkspace key={demoExpenseServices[demoActiveTrip.id].instanceId} demo activeTrip={demoActiveTrip} demoStage={demoStage}
            metadataSnapshot={finance} expenseService={demoExpenseServices[demoActiveTrip.id]}
            onExpenseSnapshot={data=>setDemoExpenseSnapshots(current=>({...current,[data.tripId]:data}))}
            canEdit currentUserId="demo-peter" services={budgetEditorServices}/>

        ) : null}
        {activeSection === "accommodation" ? <AccommodationPanel
          activeTrip={demoActiveTrip} trip={demoActiveTrip} accommodations={accommodations} attachments={[]} expenseGraph={finance.expenseGraph}
          canEdit currentUserId="demo-peter" disableDraftAutosave useEditLocks={false} restoreDrafts={false} enableAttachments={false}
          onSave={(form, id, meta) => saveDemoRecord("accommodations", form, id, meta)}
          onDelete={(id) => setAccommodations((current) => current.filter((item) => item.id !== id))}
        /> : null}
        {activeSection === "todo" ? <TodoGuidePanel
          activeTrip={demoActiveTrip} canEdit currentUserId="demo-peter" members={demoMembers} todoItems={todoItems} guideItems={guideItems}
          disableDraftAutosave useEditLocks={false} restoreDrafts={false}
          onSaveTodo={(form, id, meta) => saveDemoRecord("todoItems", form, id, meta)}
          onSaveGuide={(form, id, meta) => saveDemoRecord("guideItems", form, id, meta)}
          onDeleteTodo={(id) => setTodoItems((current) => current.filter((item) => item.id !== id))}
          onDeleteGuide={(id) => { setGuideItems((current) => current.filter((item) => item.id !== id)); setTodoItems((current) => current.map((item) => item.guide_id === id ? { ...item, guide_id: "" } : item)); }}
          onToggleTodo={(item) => setTodoItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, completed: !entry.completed } : entry))}
        /> : null}
        {activeSection === "settlement" ? <SettlementPanel expenseGraph={finance.expenseGraph}
          actualExpenses={actualExpenses} actualParticipants={actualParticipants} budgetItems={budgetItems} members={demoMembers} /> : null}
        {activeSection === "luggage" ? (
          <LuggagePanel key={`${demoActiveTrip.id}:demo-peter`}
            activeTrip={demoActiveTrip} activeTab={luggageTab} onTabChange={setLuggageTab}
            canEdit isOwner disableDraftAutosave useEditLocks={false} restoreDrafts={false}
            currentUserId="demo-peter"
            luggageItems={luggageItems}
            members={demoMembers}
            sharedLuggageItems={sharedLuggageItems}
            onDeletePersonal={(id, item) => mutateDemoLuggage("personal", "delete", {}, id, { tripId: item.trip_id, baseUpdatedAt: item.updated_at })}
            onDeleteShared={(id, item) => mutateDemoLuggage("shared", "delete", {}, id, { tripId: item.trip_id, baseUpdatedAt: item.updated_at })}
            onSavePersonal={savePersonalLuggage}
            onSaveShared={saveSharedLuggage}
            onAssign={assignDemoLuggage}
            onPrivatize={privatizeDemoLuggage}
            onReorder={reorderDemoLuggage}
            onTogglePersonal={(item) => mutateDemoLuggage("personal", "patch", { packed: !item.packed }, item.id, { tripId: item.trip_id, baseUpdatedAt: item.updated_at })}
            onUpdateShared={(id, patch, item) => mutateDemoLuggage("shared", "patch", patch, id, { tripId: item.trip_id, baseUpdatedAt: item.updated_at })}
          />
        ) : null}
      </main>
      <nav className="bottom-nav" aria-label="Demo 手機導覽">
        {["timeline", "budget", "luggage", "settlement"].map((section) => (
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
      <ActiveEditorGuardDialog />
      {demoDialog}
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

function LoginView({ onSignIn }) {
  return (
    <section className="login-view">
      <div className="login-panel">
        <p className="eyebrow">Travel Planner</p>
        <h1>一起把旅程排好</h1>
        <p>使用 Google 登入後，就能建立旅程、邀請朋友、等待擁有者核准並即時共同編輯。</p>
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
    budgetSnapshot,
    onRefreshBudget,
    canEditBudget,
    canEdit,
    dayItems,
    days,
    isOwner,
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
    onConfirmTransportWarning,
    onApproveMember,
    onDeleteAlternative,
    onDeleteAccommodation,
    onDeleteAttachment,
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
    onSaveAccommodation,
    onSaveGuide,
    onSaveItem,
    onSaveRouteOverride,
    onRouteEditCollaborationEvent,
    onRouteEditPresenceChange,
    onSaveLuggageItem,
    onSaveSharedLuggageItem,
    onAssignLuggage,
    onPrivatizeLuggage,
    onReorderLuggage,
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
    const native=props.budgetSnapshot?.expenseGraph;
    const byId = new Map(native ? expenseTimelineCosts(native).map(item => [item.id, item]) : []);
    const next = {};
    itineraryBudgetLinks.forEach((link) => {
      const budget = byId.get(link.budget_item_id);
      if (!budget) return;
      next[link.itinerary_item_id] = [...(next[link.itinerary_item_id] || []), budget];
    });
    return next;
  }, [itineraryBudgetLinks, props.budgetSnapshot?.expenseGraph]);
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
    onStartMapAddLocation: getMapProviderConfig({
      providerId: import.meta.env.VITE_MAP_PROVIDER,
      apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
      enableRealMap: true,
    }).canLoadRealMap ? startMapAddLocation : undefined,
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

      {isTodayMode ? (
        <TodayMode
          canEdit={canEdit}
          dayIndex={todayDayIndex}
          days={days}
          items={todayItems}
          packItems={packItems}
          trip={activeTrip}
          onGoBudget={() => onSectionChange("budget")}
          onGoTimeline={async () => {
            if (await onSectionChange("timeline")) selectTimelineDay(todayDayIndex);
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
          workspaceActive={isBudgetMode}
          activeTrip={activeTrip}
          metadataSnapshot={budgetSnapshot}
          onRefreshBudget={onRefreshBudget}
          canEdit={canEditBudget ?? canEdit}
          members={members}
          currentUserId={currentUserId}
        />
      </div>

      <div className={isAccommodationMode ? "" : "hidden-section"}>
        <AccommodationPanel
          activeTrip={activeTrip}
          accommodations={accommodations}
          attachments={attachments}
          expenseGraph={budgetSnapshot?.expenseGraph}
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
        <LuggagePanel key={`${activeTrip.id}:${currentUserId}`}
          activeTrip={activeTrip}
          activeTab={luggageTab}
          canEdit={members.some(member => member.user_id === currentUserId && member.status === "approved")}
          currentUserId={currentUserId}
          isOwner={activeTrip.owner_id === currentUserId}
          luggageItems={luggageItems}
          members={members}
          restoreDrafts={isLuggageMode}
          sharedLuggageItems={sharedLuggageItems}
          onDeletePersonal={onDeleteLuggageItem}
          onDeleteShared={onDeleteSharedLuggageItem}
          onSavePersonal={onSaveLuggageItem}
          onSaveShared={onSaveSharedLuggageItem}
          onAssign={onAssignLuggage}
          onPrivatize={onPrivatizeLuggage}
          onReorder={onReorderLuggage}
          onTabChange={onLuggageTabChange}
          onTogglePersonal={onToggleLuggageItem}
          onUpdateShared={onUpdateSharedLuggageItem}
        />
      </div>

      <div className={isSettlementMode ? "" : "hidden-section"}>
        <SettlementPanel
          activeTrip={activeTrip}
          expenseGraph={budgetSnapshot?.expenseGraph}
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

function VersionInfoDialog({ onClose }) {
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop version-dialog-backdrop" onClick={onClose}>
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
          <h2 id="version-dialog-title">旅程工房 | Travel Studio</h2>
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

function ExpandedBudgetRow({ budgets = [], emptyLabel = "尚未連動預算" }) {
  return (
    <div className="linked-budget-list">
      <div className="item-expanded-budget-heading">
        <Wallet aria-hidden="true" />
        <strong>{budgets.some(item=>item.expenseScope)?'支出':'預算'}</strong>
      </div>
      <div className="item-expanded-budget-content">
        <span className="item-expanded-section-divider" aria-hidden="true" />
        <div className="item-expanded-budget-tags">
          {budgets.length ? (
            budgets.map((budget) => (
              <span className="pill" key={budget.id}>
                {budget.title} · {formatMoney(budget.twd_amount ?? budget.amount)}
              </span>
            ))
          ) : (
            <span className="pill muted-text">{emptyLabel}</span>
          )}
        </div>
      </div>
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
      needsHandoff: true,
      save: () => saveCurrentEditor(),
    }),
    [form, hasUnsavedChanges, isOpen, editingId, baseUpdatedAt, draftKey],
  );

  useActiveEditorGuard(activeEditorGuardId, { tripId: editorTripId || activeTrip?.id, workspace: "timeline" }, activeEditorGuard);

  useEffect(() => {
    setExpandedId(null);
  }, [activeDay, activeTrip?.id]);

  useEffect(() => {
    setExpandedId((current) => (current && current !== focusedItemId ? null : current));
  }, [focusedItemId]);

  const hasBlockingTimelineEditor = isOpen;
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
    return canDragVisit(source);
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
    if (isOpen) {
      setFixedNotice("請先儲存或放棄目前編輯，再重排行程。");
      clearVisitDrag("commit-editor-blocked");
      return;
    }
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
      const timelineScheduleOperation = {
        orderedVisitIds: plan.nextVisitIds,
        type: timelineScheduleOperationTypes.reorder,
      };
      const timelineScheduleExpectedVisitIds = visitItems.map((visit) => visit.id);
      const timelineSchedulePlan = attachTimelineScheduleSortOrders({
        items: dayItems,
        plan: planTimelineSchedule({
          items: dayItems,
          operation: timelineScheduleOperation,
          orderedVisitIds: timelineScheduleExpectedVisitIds,
        }),
      });
      if (!timelineSchedulePlan.ok) {
        setUntimedDropNotice(timelineScheduleErrorMessage(timelineSchedulePlan));
        return;
      }
      const removedTransportIds = new Set(timelineSchedulePlan.removedTransportIds || []);
      const transportBaselines = dayItems
        .filter((item) => isTransportationCard(item) && removedTransportIds.has(item.id))
        .map((transport) => ({ id: transport.id, updatedAt: transport.updated_at }));
      const untimedReorder = {
        dayIndex: activeDay,
        itemId: sourceItem.id,
        itemUpdatedAtBaselines: timelineScheduleUpdatedAtBaselines(dayItems),
        kind: "untimed",
        timelineScheduleExpectedVisitIds,
        timelineScheduleOperation,
        timelineSchedulePlan,
        transportBaselines,
        updatedAt: sourceItem.updated_at,
      };
      if (timelineSchedulePlan.requiresConfirmation) {
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
    const { packageSourceItemIds, slotItemIds } = mixedPlan;
    const packagePreview = planDestinationPackageReorder({
      items: dayItems,
      orderedTimedItemIds: mixedPlan.orderedTimedItemIds,
      orderedVisitItemIds: mixedPlan.orderedVisitItemIds,
      slotItemIds,
      packageSourceItemIds,
    });
    if (!packagePreview.ok) {
      setFixedNotice(destinationReorderErrorMessage({ message: packagePreview.errorCode }));
      timelineDragPresenceDebug("drag end branch name", { branch: "timed-preview-blocked", errorCode: packagePreview.errorCode });
      clearVisitDrag("commit-timed-preview-blocked");
      return;
    }
    const timelineScheduleOperation = {
      orderedVisitIds: mixedPlan.orderedVisitItemIds,
      type: timelineScheduleOperationTypes.reorder,
    };
    const timelineScheduleExpectedVisitIds = visitItems.map((visit) => visit.id);
    const baseSchedulePlan = attachTimelineScheduleSortOrders({
      items: dayItems,
      plan: planTimelineSchedule({
        items: dayItems,
        operation: timelineScheduleOperation,
        orderedVisitIds: timelineScheduleExpectedVisitIds,
      }),
    });
    if (!baseSchedulePlan.ok) {
      setFixedNotice(timelineScheduleErrorMessage(baseSchedulePlan));
      clearVisitDrag("commit-timed-schedule-blocked");
      return;
    }
    const removedTransportIds = [...new Set([
      ...(baseSchedulePlan.removedTransportIds || []),
      ...(packagePreview.deletedTransportIds || []),
    ])].sort();
    const timelineSchedulePlan = {
      ...baseSchedulePlan,
      affectedItemIds: [...new Set([...(baseSchedulePlan.affectedItemIds || []), ...removedTransportIds])],
      removedTransportIds,
      requiresConfirmation: baseSchedulePlan.automaticUntimedItemIds.length > 0 || removedTransportIds.length > 0,
    };
    const explicitTransportBaselines = removedTransportIds
      .map((transportId) => {
        const transport = dayItems.find((item) => item.id === transportId);
        return transport ? { id: transport.id, updatedAt: transport.updated_at } : null;
      })
      .filter(Boolean);
    const timedReorder = {
      dayIndex: activeDay,
      itemUpdatedAtBaselines: timelineScheduleUpdatedAtBaselines(dayItems),
      kind: "timed",
      orderedTimedItemIds: mixedPlan.orderedTimedItemIds,
      orderedVisitItemIds: mixedPlan.orderedVisitItemIds,
      packageSourceItemIds,
      slotItemIds,
      timelineScheduleExpectedVisitIds,
      timelineScheduleOperation,
      timelineSchedulePlan,
      transportBaselines: explicitTransportBaselines,
    };
    if (timelineSchedulePlan.requiresConfirmation) {
      timelineDragPresenceDebug("drag end branch name", {
        branch: "timed-confirmation",
        deletedTransportCount: removedTransportIds.length,
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
    if (isOpen) {
      setFixedNotice("請先儲存或放棄目前編輯，再重排行程。");
      return;
    }
    if (foreignSameDayDragActive) {
      setFixedNotice(foreignDragSaveBlockedMessage);
      return;
    }
    if (reorderPreview.kind === "untimed") {
      if (typeof onReorderUntimedVisit !== "function") return;
      setIsReorderingUntimed(true);
      const result = await onReorderUntimedVisit({
        ...reorderPreview,
        confirmedScheduleEffect: timelineScheduleMajorEffect(reorderPreview.timelineSchedulePlan),
      });
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
    const result = await onReorderDestinationPackages({
      ...reorderPreview,
      confirmedScheduleEffect: timelineScheduleMajorEffect(reorderPreview.timelineSchedulePlan),
    });
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
    setAutoContinuationPrompt(null);
    setEditingId(latest.entityId === "new" ? null : latest.entityId);
    setEditorTripId(activeTrip.id);
    setInsertionPair(null);
    setRestoredDraftKey(latest.key);
    setIsOpen(true);
  }, [activeTrip?.id, currentUserId, dayItems, isOpen, restoreDrafts]);

  function buildNewVisitForm(initialPoint = null) {
    const lastItem = sortedVisitItems(dayItems).at(-1);
    const defaultStartTime = lastItem?.end_time ? formatTimeDisplay(lastItem.end_time) : "";
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
      workspace: "timeline",
      excludeId: activeEditorGuardId,
      tripId: activeTrip?.id,
    });
    if (!canOpenEditor) return;
    if (isOpen) {
      const canContinue = hasUnsavedChanges ? await requestActiveEditorGuardResolution({ tripId: editorTripId, onlyId: activeEditorGuardId }) : true;
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
      workspace: "timeline",
      excludeId: activeEditorGuardId,
      tripId: activeTrip?.id,
    });
    if (!canOpenEditor) return;
    if (isOpen) {
      const canContinue = hasUnsavedChanges ? await requestActiveEditorGuardResolution({ tripId: editorTripId, onlyId: activeEditorGuardId }) : true;
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
      workspace: "timeline",
      excludeId: activeEditorGuardId,
      tripId: activeTrip?.id,
    });
    if (!canOpenEditor) return;
    if (isOpen && editingId !== item.id) {
      const canContinue = hasUnsavedChanges ? await requestActiveEditorGuardResolution({ tripId: editorTripId, onlyId: activeEditorGuardId }) : true;
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
    const existingAlternative = (alternativesByItem[item.id] || [])[0] || null;
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
      if (Boolean(submittedForm.start_time) !== Boolean(submittedForm.end_time)) {
        setTimeError("開始與結束時間必須同時設定，或同時清除。");
        setForm(submittedForm);
        return false;
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
    if (overlapItem && !editingId) {
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
    let timelineScheduleOperation = null;
    let timelineSchedulePlan = null;
    let timelineScheduleExpectedVisitIds = null;
    let timelineScheduleItemBaselines = null;
    let timelineScheduleTargetId = editingId;
    if (editingId && submittedForm.item_type !== "transport") {
      const original = dayItems.find((item) => item.id === editingId);
      const originalTimed = isTimedVisit(original);
      const candidateTimed = Boolean(submittedForm.start_time && submittedForm.end_time);
      const timeChanged =
        (original?.start_time ? formatTimeDisplay(original.start_time) : null) !== (submittedForm.start_time || null) ||
        (original?.end_time ? formatTimeDisplay(original.end_time) : null) !== (submittedForm.end_time || null);
      if (timeChanged) {
        timelineScheduleOperation = {
          end_time: submittedForm.end_time || null,
          start_time: submittedForm.start_time || null,
          targetItemId: editingId,
          type: originalTimed && !candidateTimed
            ? timelineScheduleOperationTypes.clearTime
            : !originalTimed && candidateTimed
              ? timelineScheduleOperationTypes.restoreTime
              : timelineScheduleOperationTypes.editTime,
        };
      }
    } else if (submittedForm.item_type === "transport") {
      timelineScheduleTargetId = options.timelineScheduleTargetId || editingId || crypto.randomUUID();
      timelineScheduleOperation = {
        transport: {
          ...submittedForm,
          ...currentPairSnapshot,
          id: timelineScheduleTargetId,
          item_type: "transport",
          transport_role: "normal_pair",
        },
        type: timelineScheduleOperationTypes.upsertTransport,
      };
    }
    if (timelineScheduleOperation) {
      timelineScheduleExpectedVisitIds = visitItems.map((item) => item.id);
      timelineScheduleItemBaselines = timelineScheduleUpdatedAtBaselines(
        dayItems,
        editingId && baseUpdatedAt ? { [editingId]: baseUpdatedAt } : {},
      );
      timelineSchedulePlan = attachTimelineScheduleSortOrders({
        items: dayItems,
        plan: planTimelineSchedule({
          items: dayItems,
          operation: timelineScheduleOperation,
          orderedVisitIds: timelineScheduleExpectedVisitIds,
        }),
      });
      if (!timelineSchedulePlan.ok) {
        setTimeError(timelineScheduleErrorMessage(timelineSchedulePlan));
        setForm(submittedForm);
        return false;
      }
      const hasForeignLock = (timelineSchedulePlan.affectedItemIds || []).some((itemId) => {
        const item = dayItems.find((candidate) => candidate.id === itemId);
        return useEditLocks && item?.id !== editingId && isLockedByAnotherUser(item, currentUserId);
      });
      if (hasForeignLock) {
        setTimeError("後續行程目前由其他成員編輯，無法重新排程。");
        setForm(submittedForm);
        return false;
      }
      const effectKey = timelineScheduleEffectKey(timelineSchedulePlan);
      if (timelineSchedulePlan.requiresConfirmation && options.confirmedScheduleEffectKey !== effectKey) {
        setTimeError("");
        setForm(submittedForm);
        setAutoContinuationPrompt({
          effectKey,
          plan: timelineSchedulePlan,
          timelineScheduleTargetId,
          title: submittedForm.item_type === "transport"
            ? submittedForm.transport_name || submittedForm.title
            : submittedForm.location_name || submittedForm.location || submittedForm.title,
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
        confirmedScheduleEffect: options.confirmedScheduleEffectKey
          ? timelineScheduleMajorEffect(timelineSchedulePlan)
          : null,
        timelineScheduleExpectedVisitIds,
        timelineScheduleItemBaselines,
        timelineScheduleOperation,
        timelineSchedulePlan,
        timelineScheduleTargetId,
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
    setAutoContinuationPrompt(null);
    setEditingId(null);
    setEditorTripId(null);
    setInsertionPair(null);
    setRestoredDraftKey(null);
    onCancelMapPointPick?.();
    setIsOpen(false);
    return true;
  }

  function cancelAutoContinuation() {
    if (isSavingAutoContinuation) return;
    setTimeError("");
    setAutoContinuationPrompt(null);
  }

  async function saveWithAutoContinuation() {
    if (!autoContinuationPrompt?.plan?.ok || isSavingAutoContinuation) return;
    if (foreignSameDayDragActive) {
      setTimeError(foreignDragSaveBlockedMessage);
      return;
    }
    setIsSavingAutoContinuation(true);
    await saveCurrentEditor(new FormData(), {
      confirmedScheduleEffectKey: autoContinuationPrompt.effectKey,
      timelineScheduleTargetId: autoContinuationPrompt.timelineScheduleTargetId,
    });
    setIsSavingAutoContinuation(false);
  }

  async function submit(event) {
    event.preventDefault();
    if (isAlternativeEditorOpen) return;
    await saveCurrentEditor(new FormData(event.currentTarget));
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
      autoContinuationPrompt ||
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
    isSavingAutoContinuation,
    isTransportEditor,
    reorderPreview,
  ]);
  useEffect(() => {
    if (!focusedItemId || !activeTimelineListRef.current) return;
    if (!visitItemIds.includes(focusedItemId)) return;
    if (
      isOpen ||
      draggedVisitId ||
      foreignSameDayDragActive ||
      reorderPreview ||
      autoContinuationPrompt ||
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
    isSavingAutoContinuation,
    reorderPreview,
    visitItemIds,
  ]);
  const activeDragItem = draggedVisitId ? visitItems.find((item) => item.id === draggedVisitId) || null : null;
  const timedVisitItems = useMemo(() => visitItems.filter(isTimedVisit), [visitItems]);
  const { adjacentTransportByPair, invalidTransportItems, passiveUntimedTransportByFrom } = useMemo(
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
    const { warningType = "" } = options;
    const isInvalidWarning = warningType === "invalid";
    const isGeneralWarning = warningType === "general";
    const isUntimedWarning = warningType === "untimed";
    const hasWarning = Boolean(warningType);
    const warningClass = isInvalidWarning ? "invalid" : isGeneralWarning ? "general" : warningType;
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
            {isGeneralWarning ? (
              <p className="transport-warning-detail">
                {`${transportPairLabel(item)} 的行程時間或目的地已變更，請確認交通資訊。`}
              </p>
            ) : null}
            {isUntimedWarning ? (
              <p className="transport-warning-detail">目的地時間未設定，請重新確認交通卡。</p>
            ) : null}
            <div className="transport-card-details">
              <p className="transport-note-detail">{note || "尚未填寫"}</p>
              <ExpandedBudgetRow budgets={budgets} emptyLabel="尚未連結預算" />
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
          <h2 id="auto-continuation-title">套用重大排程變更？</h2>
          {autoContinuationPrompt.plan.automaticUntimedItemIds?.length ? (
            <p>部分後續行程無法排入固定行程前或當日 24:00 前，將改為未設定時間。</p>
          ) : null}
          {autoContinuationPrompt.plan.removedTransportIds?.length ? (
            <p>這次變更會移除不再連接相鄰行程的交通卡。</p>
          ) : null}
          <p>固定行程與不受影響的前後區段不會移動。</p>
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
              disabled={!canMutateThisDay || isSavingAutoContinuation || !autoContinuationPrompt.plan.ok}
              type="button"
              onClick={saveWithAutoContinuation}
            >
              確定套用
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
          onClick={onStartMapAddLocation || (() => void openNewItem())}
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
              (sum, budget) => sum + Number(budget.twd_amount ?? budget.amount ?? 0),
              0,
            );
            const displayCost = (budgetsByItem[item.id] || []).length ? linkedBudgetTotal : Number(displayItem.cost || 0);
            const nextItem = visitItems[index + 1];
            const isTimedPair = isTimedVisit(item) && isTimedVisit(nextItem);
            const pairKey = isTimedPair ? transportPairKey(item.id, nextItem.id) : "";
            const transportItem = pairKey ? adjacentTransportByPair[pairKey] : null;
            const transportNeedsReview = transportItem && transportPairNeedsReview(transportItem, item, nextItem);
            const transportWarningType = transportNeedsReview ? "general" : "";
            const passiveUntimedTransportItems = passiveUntimedTransportByFrom[item.id] || [];
            const isAddingTransportHere =
              isTimedPair &&
              isOpen &&
              isTransportEditor &&
              !editingId &&
              insertionPair?.fromId === item.id &&
              insertionPair?.toId === nextItem.id;
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
              passiveUntimedTransportItems.length > 0;
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
                    <ExpandedBudgetRow budgets={budgetsByItem[item.id] || []} />
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
            {!isAddingTransportHere && transportItem ? (
              <TimelineFlowAttachment>
                {isOpen && isTransportEditor && editingId === transportItem.id
                  ? renderTransportEditorForm()
                  : renderTransportCard(transportItem, useEditLocks && isLockedByAnotherUser(transportItem, currentUserId), {
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
            {foreignDragOverItemId === item.id && foreignDragPlacement === "after" ? (
              <div className="timeline-remote-insertion-line" aria-hidden="true" style={foreignDragStyle} />
            ) : null}
            </SortableTimelineEntry>
            {isAddingTransportHere ? renderTransportEditorForm() : null}
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
                  (sum, budget) => sum + Number(budget.twd_amount ?? budget.amount ?? 0),
                  0,
                );
                const displayCost = (budgetsByItem[item.id] || []).length ? linkedBudgetTotal : Number(item.cost || 0);
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

const budgetEditorServices = {
  useGuard: useActiveEditorGuard,
  handoff: requestActiveEditorHandoff,
};

function BudgetPanel(props) {
  if (props.activeTrip.membership && props.activeTrip.membership.status !== "approved") return null;
  return <ExpenseWorkspace key={`${props.currentUserId}:${props.activeTrip.id}`} {...props} supabase={supabase} services={budgetEditorServices} />;
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
