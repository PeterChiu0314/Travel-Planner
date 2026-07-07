import {
  GOOGLE_ROUTES_ENDPOINT,
  GOOGLE_ROUTES_FIELD_MASK_DURATION_ONLY,
  normalizeGoogleRoutesTravelMode,
} from "./googleRoutesConfig.js";

const TRANSIT_ALLOWED_TRAVEL_MODES = Object.freeze({
  bus: "BUS",
  "公車": "BUS",
  lightRail: "LIGHT_RAIL",
  "電車及輕軌電車": "LIGHT_RAIL",
  subway: "SUBWAY",
  "地鐵": "SUBWAY",
  train: "TRAIN",
  "火車": "TRAIN",
});

const DRIVE_ROUTE_MODIFIERS = Object.freeze({
  avoidFerries: "avoidFerries",
  avoidHighways: "avoidHighways",
  avoidTolls: "avoidTolls",
  "避開渡輪": "avoidFerries",
  "避開高速": "avoidHighways",
  "避開收費": "avoidTolls",
});

const DEFAULT_TRANSIT_ALLOWED_TRAVEL_MODES = Object.freeze(["BUS", "SUBWAY", "TRAIN", "LIGHT_RAIL"]);

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

function normalizeRouteOptions(routeOptions) {
  if (!Array.isArray(routeOptions)) return [];
  return routeOptions.map((option) => String(option || "").trim()).filter(Boolean);
}

function buildTransitPreferences(routeOptions) {
  const selectedModes = normalizeRouteOptions(routeOptions)
    .map((option) => TRANSIT_ALLOWED_TRAVEL_MODES[option])
    .filter(Boolean);
  const uniqueModes = [...new Set(selectedModes)];
  if (uniqueModes.length === 0 || uniqueModes.length === DEFAULT_TRANSIT_ALLOWED_TRAVEL_MODES.length) return null;
  return { allowedTravelModes: uniqueModes };
}

function buildDriveRouteModifiers(routeOptions) {
  const modifiers = {};
  normalizeRouteOptions(routeOptions).forEach((option) => {
    const modifier = DRIVE_ROUTE_MODIFIERS[option];
    if (modifier) modifiers[modifier] = true;
  });
  return Object.keys(modifiers).length ? modifiers : null;
}

function isRoutesDebugEnabled() {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debugRoutes") === "1";
}

function summarizeRoutesRequest(request) {
  const body = request?.body || {};
  return {
    allowedTravelModes: body.transitPreferences?.allowedTravelModes || null,
    departureTime: body.departureTime || "",
    fieldMask: request?.fieldMask || "",
    hasDepartureTime: Boolean(body.departureTime),
    hasRouteModifiers: Boolean(body.routeModifiers),
    hasRoutingPreference: Boolean(body.routingPreference || body.transitPreferences?.routingPreference),
    travelMode: body.travelMode || "",
  };
}

function summarizeRoutesResponse(response, data) {
  const normalized = normalizeGoogleRoutesDuration(data || {});
  return {
    durationSource: normalized.ok ? normalized.durationSource : "",
    errorMessage: data?.error?.message || "",
    errorStatus: data?.error?.status || "",
    routesLength: Array.isArray(data?.routes) ? data.routes.length : 0,
    status: response?.status || null,
  };
}

function debugRoutesRequestResponse({ data, request, response }) {
  if (!isRoutesDebugEnabled()) return;
  console.debug("[Routes debug]", {
    request: summarizeRoutesRequest(request),
    response: summarizeRoutesResponse(response, data),
  });
}

async function readRoutesJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function buildGoogleRoutesDurationRequest({ fromItem, mode = "transit", routeOptions = [], toItem } = {}) {
  const origin = latLngLiteral(fromItem);
  const destination = latLngLiteral(toItem);
  if (!origin || !destination) {
    return { ok: false, errorCode: "missing_coordinates" };
  }

  const travelMode = normalizeGoogleRoutesTravelMode(mode);
  const body = {
    destination: { location: { latLng: destination } },
    origin: { location: { latLng: origin } },
    travelMode,
  };

  if (travelMode === "TRANSIT") {
    const transitPreferences = buildTransitPreferences(routeOptions);
    if (transitPreferences) body.transitPreferences = transitPreferences;
  }

  if (travelMode === "DRIVE") {
    const routeModifiers = buildDriveRouteModifiers(routeOptions);
    if (routeModifiers) body.routeModifiers = routeModifiers;
  }

  return {
    ok: true,
    body,
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

function firstRouteDuration(response = {}) {
  const route = response?.routes?.[0];
  const candidates = [
    ["routes.duration", route?.duration],
    ["routes.staticDuration", route?.staticDuration],
  ];
  for (const [source, value] of candidates) {
    const seconds = parseGoogleDurationSeconds(value);
    if (seconds !== null) return { seconds, source };
  }
  return null;
}

export function normalizeGoogleRoutesDuration(response = {}) {
  const duration = firstRouteDuration(response);
  if (!duration) return { ok: false, errorCode: "missing_duration" };
  return {
    ok: true,
    durationMinutes: Math.max(1, Math.round(duration.seconds / 60)),
    durationSource: duration.source,
  };
}

export async function fetchGoogleRoutesDuration({
  apiKey,
  endpoint = GOOGLE_ROUTES_ENDPOINT,
  fetchImpl = globalThis.fetch,
  fromItem,
  mode = "transit",
  routeOptions = [],
  toItem,
} = {}) {
  const normalizedKey = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!normalizedKey) return { ok: false, errorCode: "missing_api_key" };
  if (typeof fetchImpl !== "function") return { ok: false, errorCode: "fetch_unavailable" };

  const request = buildGoogleRoutesDurationRequest({ fromItem, mode, routeOptions, toItem });
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

  const data = await readRoutesJson(response);
  debugRoutesRequestResponse({ data, request, response });

  if (!response?.ok) {
    return {
      ok: false,
      errorCode: "routes_request_failed",
      message: data?.error?.message || "",
      status: response?.status || null,
    };
  }
  return normalizeGoogleRoutesDuration(data);
}
