const GOOGLE_MAPS_DIRECTIONS_BASE_URL = "https://www.google.com/maps/dir/";

const travelModeByTransportCategory = Object.freeze({
  bus: "transit",
  driving: "driving",
  drive: "driving",
  ferry: "transit",
  flight: "",
  jr: "transit",
  taxi: "driving",
  train: "transit",
  transit: "transit",
  walk: "walking",
  walking: "walking",
});

function readFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function travelModeForTransportCategory(category) {
  const normalized = String(category || "").trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(travelModeByTransportCategory, normalized)) {
    return travelModeByTransportCategory[normalized];
  }
  return "transit";
}

export function transportEndpointsHaveCoordinates({ fromItem, toItem } = {}) {
  return Boolean(
    readFiniteNumber(fromItem?.latitude) !== null &&
      readFiniteNumber(fromItem?.longitude) !== null &&
      readFiniteNumber(toItem?.latitude) !== null &&
      readFiniteNumber(toItem?.longitude) !== null,
  );
}

export function buildGoogleMapsDirectionsUrl({ fromItem, mode, toItem, transportCategory } = {}) {
  if (!transportEndpointsHaveCoordinates({ fromItem, toItem })) return "";

  const transportMode = travelModeForTransportCategory(transportCategory);
  const travelMode = mode === undefined || mode === null ? transportMode : mode;
  const normalizedTravelMode = travelMode === "" ? "" : travelModeForTransportCategory(travelMode);
  const url = new URL(GOOGLE_MAPS_DIRECTIONS_BASE_URL);
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", `${readFiniteNumber(fromItem.latitude)},${readFiniteNumber(fromItem.longitude)}`);
  url.searchParams.set("destination", `${readFiniteNumber(toItem.latitude)},${readFiniteNumber(toItem.longitude)}`);
  url.searchParams.set("travelmode", normalizedTravelMode);
  return url.toString();
}
