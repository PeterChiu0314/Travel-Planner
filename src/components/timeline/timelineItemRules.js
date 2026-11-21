import { formatTimeDisplay } from "../../lib/displayFormat.js";
import { isTransportationCard } from "../../lib/timelineTransportationRoles.js";
import { visitSnapshotDestination } from "../../lib/timelineTransportPairs.js";
import { timelineTypeColors } from "../../lib/timelineTypeStyles.js";
import { timeToMinutes } from "../../lib/timelineTime.js";
import { buildTimelineVisitDisplayOrder, isTimedVisit, sortScheduleItems } from "../../lib/timelineUntimedOrdering.js";

export const typeColors = timelineTypeColors;

export const defaultTransportCategory = "train";

export const emptyItemForm = {
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

export const defaultVisitDurationMinutes = 60;

export function getDurationMinutes(startTime, endTime) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (start === null || end === null || end <= start) return "";
  return String(end - start);
}

function dateTimeLocalInput(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function sortedVisitItems(items) {
  return buildTimelineVisitDisplayOrder(items);
}

export function destinationReorderErrorMessage(error) {
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

export function alternativeApplyErrorMessage(error) {
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

export function timelineScheduleErrorMessage(plan) {
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

export function timelineScheduleMajorEffect(plan) {
  return {
    automaticUntimedItemIds: [...(plan?.automaticUntimedItemIds || [])].sort(),
    removedTransportIds: [...(plan?.removedTransportIds || [])].sort(),
  };
}

export function timelineScheduleEffectKey(plan) {
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

export function timelineScheduleUpdatedAtBaselines(items = [], overrides = {}) {
  return Object.fromEntries(
    items.map((item) => [
      item.id,
      Object.hasOwn(overrides, item.id) ? overrides[item.id] : item.updated_at || null,
    ]),
  );
}

export function isEffectiveFixedVisit(item) {
  return Boolean(item?.is_fixed) && isTimedVisit(item);
}

export function isInvalidTimeRange(startTime, endTime) {
  if (!startTime || !endTime) return false;
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (start === null || end === null) return false;
  return start >= end;
}

export function formatTimelineOverlapError(item) {
  const label = visitSnapshotDestination(item) || item?.title || "行程";
  return `此行程時間與「${label} ${formatTimeDisplay(item?.start_time)}~${formatTimeDisplay(item?.end_time)}」重疊，請調整時間。`;
}

export function findOverlappingVisitItem({ dayIndex, editingId, items, payload }) {
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
