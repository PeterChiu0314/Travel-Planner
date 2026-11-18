import { formatTimeDisplay } from "../../lib/displayFormat.js";
import { googleMapsPointUrl } from "../../lib/mapPoint.js";
import { minutesToTimeValue, timeToMinutes } from "../../lib/timelineTime.js";
import { transportNameValue } from "../../lib/timelineTransportCategories.js";

export function buildNewVisitForm({ defaultForm, defaultVisitDurationMinutes, initialPoint, lastItem }) {
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
    ...defaultForm,
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

export function buildNewTransportForm({ defaultForm, defaultTransportCategory, previousItem, nextItem, pairSnapshot }) {
  return {
    ...defaultForm,
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
    ...pairSnapshot,
    title: "",
  };
}

export function buildExistingItemForm({ item, existingAlternative, defaultTransportCategory }) {
  return {
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
