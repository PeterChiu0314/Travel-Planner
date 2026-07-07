const GOOGLE_MAPS_DIRECTIONS_BASE_URL = "https://www.google.com/maps/dir/";

const travelModeByTransportCategory = Object.freeze({
  bus: "transit",
  driving: "driving",
  drive: "driving",
  ferry: "transit",
  flight: "transit",
  jr: "transit",
  taxi: "driving",
  train: "transit",
  transit: "transit",
  walk: "walking",
  walking: "walking",
});

function readFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function travelModeForTransportCategory(category) {
  return travelModeByTransportCategory[String(category || "").trim().toLowerCase()] || "transit";
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

  const travelMode = mode || travelModeForTransportCategory(transportCategory);
  const url = new URL(GOOGLE_MAPS_DIRECTIONS_BASE_URL);
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", `${readFiniteNumber(fromItem.latitude)},${readFiniteNumber(fromItem.longitude)}`);
  url.searchParams.set("destination", `${readFiniteNumber(toItem.latitude)},${readFiniteNumber(toItem.longitude)}`);
  url.searchParams.set("travelmode", travelModeForTransportCategory(travelMode));
  return url.toString();
}
