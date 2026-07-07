import {
  GOOGLE_ROUTES_ENDPOINT,
  GOOGLE_ROUTES_FIELD_MASK_DURATION_ONLY,
  normalizeGoogleRoutesTravelMode,
} from "./googleRoutesConfig.js";

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

export function buildGoogleRoutesDurationRequest({ fromItem, mode = "transit", toItem } = {}) {
  const origin = latLngLiteral(fromItem);
  const destination = latLngLiteral(toItem);
  if (!origin || !destination) {
    return { ok: false, errorCode: "missing_coordinates" };
  }

  return {
    ok: true,
    body: {
      destination: { location: { latLng: destination } },
      origin: { location: { latLng: origin } },
      travelMode: normalizeGoogleRoutesTravelMode(mode),
    },
    fieldMask: GOOGLE_ROUTES_FIELD_MASK_DURATION_ONLY,
  };
}

function parseGoogleDurationSeconds(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)s$/);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds : null;
}

export function normalizeGoogleRoutesDuration(response = {}) {
  const durationSeconds = parseGoogleDurationSeconds(response?.routes?.[0]?.duration);
  if (durationSeconds === null) return { ok: false, errorCode: "missing_duration" };
  return {
    ok: true,
    durationMinutes: Math.max(1, Math.round(durationSeconds / 60)),
  };
}

export async function fetchGoogleRoutesDuration({
  apiKey,
  endpoint = GOOGLE_ROUTES_ENDPOINT,
  fetchImpl = globalThis.fetch,
  fromItem,
  mode = "transit",
  toItem,
} = {}) {
  const normalizedKey = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!normalizedKey) return { ok: false, errorCode: "missing_api_key" };
  if (typeof fetchImpl !== "function") return { ok: false, errorCode: "fetch_unavailable" };

  const request = buildGoogleRoutesDurationRequest({ fromItem, mode, toItem });
  if (!request.ok) return request;

  const response = await fetchImpl(endpoint, {
    body: JSON.stringify(request.body),
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": normalizedKey,
      "X-Goog-FieldMask": request.fieldMask,
    },
    method: "POST",
  });

  if (!response?.ok) return { ok: false, errorCode: "routes_request_failed", status: response?.status || null };

  const data = await response.json();
  return normalizeGoogleRoutesDuration(data);
}
