const GOOGLE_DIRECTIONS_ENDPOINT = "https://maps.googleapis.com/maps/api/directions/json";

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function latLngLiteral(item) {
  const latitude = finiteNumber(item?.latitude);
  const longitude = finiteNumber(item?.longitude);
  if (latitude === null || longitude === null) return null;
  return { latitude, longitude };
}

async function readDirectionsJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function directionsRoutesLength(data) {
  return Array.isArray(data?.routes) ? data.routes.length : 0;
}

export function buildGoogleDirectionsTransitDurationRequest({
  apiKey,
  endpoint = GOOGLE_DIRECTIONS_ENDPOINT,
  fromItem,
  toItem,
} = {}) {
  const normalizedKey = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!normalizedKey) return { ok: false, reason: "missing_api_key", source: "directions-transit-fallback" };

  const origin = latLngLiteral(fromItem);
  const destination = latLngLiteral(toItem);
  if (!origin || !destination) {
    return { ok: false, reason: "missing_coordinates", source: "directions-transit-fallback" };
  }

  const params = new URLSearchParams({
    departure_time: "now",
    destination: `${destination.latitude},${destination.longitude}`,
    key: normalizedKey,
    language: "zh-TW",
    mode: "transit",
    origin: `${origin.latitude},${origin.longitude}`,
    region: "jp",
  });

  return {
    ok: true,
    source: "directions-transit-fallback",
    url: `${endpoint}?${params.toString()}`,
  };
}

export function normalizeGoogleDirectionsTransitDuration(data = {}) {
  const seconds = Number(data?.routes?.[0]?.legs?.[0]?.duration?.value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return {
      ok: false,
      reason: "missing_duration",
      routesLength: directionsRoutesLength(data),
      source: "directions-transit-fallback",
      status: data?.status || "",
    };
  }

  return {
    ok: true,
    durationMinutes: Math.ceil(seconds / 60),
    routesLength: directionsRoutesLength(data),
    source: "directions-transit-fallback",
    status: data?.status || "",
  };
}

export async function fetchGoogleDirectionsTransitDuration({
  apiKey,
  endpoint = GOOGLE_DIRECTIONS_ENDPOINT,
  fetchImpl = globalThis.fetch,
  fromItem,
  toItem,
} = {}) {
  if (typeof fetchImpl !== "function") {
    return { ok: false, reason: "fetch_unavailable", source: "directions-transit-fallback" };
  }

  const request = buildGoogleDirectionsTransitDurationRequest({ apiKey, endpoint, fromItem, toItem });
  if (!request.ok) return request;

  try {
    const response = await fetchImpl(request.url, { method: "GET" });
    const data = await readDirectionsJson(response);
    if (!response?.ok) {
      return {
        ok: false,
        reason: "directions_request_failed",
        routesLength: directionsRoutesLength(data),
        source: "directions-transit-fallback",
        status: data?.status || response?.status || "",
      };
    }
    return normalizeGoogleDirectionsTransitDuration(data || {});
  } catch (error) {
    return {
      ok: false,
      message: error?.message || "",
      reason: "directions_request_failed",
      source: "directions-transit-fallback",
    };
  }
}
