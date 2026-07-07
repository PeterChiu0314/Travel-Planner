export const GOOGLE_ROUTES_TRAVEL_MODES = Object.freeze({
  driving: "DRIVE",
  transit: "TRANSIT",
  walking: "WALK",
});

export const GOOGLE_ROUTES_FIELD_MASK_DURATION_ONLY =
  "routes.duration,routes.staticDuration";

export const GOOGLE_ROUTES_TRANSIT_DEBUG_FIELD_MASK =
  "routes.duration,routes.localizedValues,routes.legs,routes.travelAdvisory";

export const GOOGLE_ROUTES_ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";

function normalizeText(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isRoutesQueryEnabled(config = {}) {
  return (
    config.mode === "formal" &&
    config.providerId === "google" &&
    config.apiKeyAvailable === true &&
    config.routesQueryEnabled === true
  );
}

export function getGoogleRoutesConfig(options = {}) {
  const mode = normalizeText(options.mode) === "demo" ? "demo" : "formal";
  const providerId = normalizeText(options.providerId) || "static";
  const apiKey = typeof options.apiKey === "string" ? options.apiKey.trim() : "";
  const config = {
    mode,
    providerId,
    apiKey,
    apiKeyAvailable: Boolean(apiKey),
    routesQueryEnabled: options.enableRoutesQuery === true,
  };
  return {
    ...config,
    canQueryRoutes: isRoutesQueryEnabled(config),
  };
}

export function getGoogleRoutesRuntimeConfig(options = {}) {
  return getGoogleRoutesConfig({
    apiKey: import.meta.env?.VITE_GOOGLE_MAPS_API_KEY || "",
    enableRoutesQuery: options.enableRoutesQuery,
    mode: options.mode,
    providerId: import.meta.env?.VITE_MAP_PROVIDER || "static",
  });
}

export function normalizeGoogleRoutesTravelMode(mode) {
  const normalized = normalizeText(mode);
  if (normalized === "drive") return GOOGLE_ROUTES_TRAVEL_MODES.driving;
  if (normalized === "driving") return GOOGLE_ROUTES_TRAVEL_MODES.driving;
  if (normalized === "walk") return GOOGLE_ROUTES_TRAVEL_MODES.walking;
  if (normalized === "walking") return GOOGLE_ROUTES_TRAVEL_MODES.walking;
  return GOOGLE_ROUTES_TRAVEL_MODES.transit;
}
