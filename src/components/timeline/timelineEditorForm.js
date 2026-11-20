import { formatTimeDisplay } from "../../lib/displayFormat.js";
import { googleMapsPointUrl, normalizeMapPointFields } from "../../lib/mapPoint.js";
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

export function buildTimelineItemSubmission({ itemSubmittedForm, currentPairSnapshot, defaultTransportCategory }) {
  return {
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
  };
}

export function normalizeTimelineItemPayload(payload, defaultTransportCategory) {
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
