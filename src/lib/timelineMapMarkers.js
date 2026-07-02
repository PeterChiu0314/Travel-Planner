import { finiteNumber, hasValidMapPoint } from "./mapPoint.js";

function nullableText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function isTransportationItem(item) {
  if (!item) return false;
  const itemType = nullableText(item.item_type)?.toLowerCase();
  const type = nullableText(item.type)?.toLowerCase();
  if (itemType === "transport" || type === "transport") return true;
  return Boolean(item.transport_role || item.transport_name || item.transport_duration_minutes);
}

function providerFromItem(item) {
  return nullableText(item.map_provider) || nullableText(item.provider) || null;
}

function providerPlaceIdFromItem(item) {
  return (
    nullableText(item.provider_place_id) ||
    nullableText(item.map_provider_place_id) ||
    nullableText(item.place_id) ||
    null
  );
}

export function buildDayMapMarkers(dayItems = [], options = {}) {
  const { requireLocation = false } = options;
  if (!Array.isArray(dayItems)) return [];

  return dayItems.reduce((markers, item) => {
    if (!item || isTransportationItem(item)) return markers;

    const itemId = nullableText(item.id);
    if (!itemId) return markers;

    const locationName = nullableText(item.location_name) || nullableText(item.location) || "";
    if (requireLocation && !locationName) return markers;

    const title = nullableText(item.title) || locationName || "Untitled destination";
    const hasCoordinates = hasValidMapPoint(item);
    const mapUrl = nullableText(item.map_url) || "";
    if (!mapUrl && !hasCoordinates) return markers;

    const latitude = hasCoordinates ? finiteNumber(item.latitude) : null;
    const longitude = hasCoordinates ? finiteNumber(item.longitude) : null;

    markers.push({
      id: `map-marker:${itemId}`,
      itemId,
      itemType: "destination",
      title,
      locationName,
      address: nullableText(item.address) || "",
      mapUrl,
      latitude,
      longitude,
      hasCoordinates,
      coordinateSource: hasCoordinates ? "stored" : "missing",
      provider: providerFromItem(item),
      providerPlaceId: providerPlaceIdFromItem(item),
      dayIndex: finiteNumber(item.day_index),
      sortOrder: finiteNumber(item.sort_order),
    });
    return markers;
  }, []);
}

export function buildRoutePanelStops(dayItems = [], options = {}) {
  return buildDayMapMarkers(dayItems, options);
}

export function getTransportEndpointMarkerIds(dayItems = [], markers = [], transportItemOrId = null) {
  const safeDayItems = Array.isArray(dayItems) ? dayItems : [];
  const safeMarkers = Array.isArray(markers) ? markers : [];
  const transportItem =
    typeof transportItemOrId === "string"
      ? safeDayItems.find((item) => nullableText(item?.id) === transportItemOrId)
      : transportItemOrId;

  if (!transportItem || !isTransportationItem(transportItem)) {
    return {
      fromItemId: null,
      toItemId: null,
      fromMarkerId: null,
      toMarkerId: null,
      markerIds: [],
    };
  }

  const markerByItemId = new Map(safeMarkers.map((marker) => [marker.itemId, marker.id]));
  const fromItemId = nullableText(transportItem.from_item_id);
  const toItemId = nullableText(transportItem.to_item_id);
  const fromMarkerId = fromItemId ? markerByItemId.get(fromItemId) || null : null;
  const toMarkerId = toItemId ? markerByItemId.get(toItemId) || null : null;
  const markerIds = [fromMarkerId, toMarkerId].filter(Boolean);

  return {
    fromItemId,
    toItemId,
    fromMarkerId,
    toMarkerId,
    markerIds,
  };
}

export function getFocusedMapState(dayItems = [], markers = [], focusedItemId = null) {
  const safeDayItems = Array.isArray(dayItems) ? dayItems : [];
  const safeMarkers = Array.isArray(markers) ? markers : [];
  const itemId = nullableText(focusedItemId);

  if (!itemId) {
    return {
      focusedItemId: null,
      focusedItemType: null,
      focusedMarkerId: null,
      transportEndpointMarkerIds: getTransportEndpointMarkerIds(safeDayItems, safeMarkers, null),
    };
  }

  const focusedItem = safeDayItems.find((item) => nullableText(item?.id) === itemId);
  if (isTransportationItem(focusedItem)) {
    return {
      focusedItemId: itemId,
      focusedItemType: "transport",
      focusedMarkerId: null,
      transportEndpointMarkerIds: getTransportEndpointMarkerIds(safeDayItems, safeMarkers, focusedItem),
    };
  }

  const focusedMarker = safeMarkers.find((marker) => marker.itemId === itemId) || null;
  return {
    focusedItemId: itemId,
    focusedItemType: focusedMarker ? "destination" : null,
    focusedMarkerId: focusedMarker?.id || null,
    transportEndpointMarkerIds: getTransportEndpointMarkerIds(safeDayItems, safeMarkers, null),
  };
}
