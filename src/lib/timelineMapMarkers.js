function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

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
    const latitude = finiteNumber(item.latitude);
    const longitude = finiteNumber(item.longitude);
    const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);

    markers.push({
      id: `map-marker:${itemId}`,
      itemId,
      itemType: "destination",
      title,
      locationName,
      address: nullableText(item.address) || "",
      mapUrl: nullableText(item.map_url) || "",
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
