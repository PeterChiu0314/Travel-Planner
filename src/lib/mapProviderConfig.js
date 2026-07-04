import { getPlacesLibraries, isPlacesEnvEnabled } from "./googlePlacesConfig.js";

export const MAP_PROVIDER_IDS = Object.freeze({
  STATIC: "static",
  GOOGLE: "google",
});

export const DEFAULT_MAP_PROVIDER_ID = MAP_PROVIDER_IDS.STATIC;

function normalizeText(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function getMapProviderConfig(options = {}) {
  const mode = normalizeText(options.mode) === "demo" ? "demo" : "formal";
  const apiKey = typeof options.apiKey === "string" ? options.apiKey.trim() : "";
  const requestedPlacesEnabled = isPlacesEnvEnabled(options.placesEnabled);
  if (mode === "demo") {
    return {
      mode,
      providerId: MAP_PROVIDER_IDS.STATIC,
      requestedProviderId: normalizeText(options.providerId) || DEFAULT_MAP_PROVIDER_ID,
      loadMode: "eager",
      canLoadRealMap: false,
      apiKeyAvailable: false,
      placesEnabled: false,
      placesLibraries: [],
      fallbackReason: "demo-static",
      fallbackProviderId: MAP_PROVIDER_IDS.STATIC,
    };
  }

  const requestedProviderId = normalizeText(options.providerId) || DEFAULT_MAP_PROVIDER_ID;
  const providerId = Object.values(MAP_PROVIDER_IDS).includes(requestedProviderId)
    ? requestedProviderId
    : DEFAULT_MAP_PROVIDER_ID;

  const config = {
    mode,
    providerId,
    requestedProviderId,
    loadMode: providerId === MAP_PROVIDER_IDS.GOOGLE ? "lazy" : "eager",
    canLoadRealMap: providerId === MAP_PROVIDER_IDS.GOOGLE && options.enableRealMap === true && Boolean(apiKey),
    apiKeyAvailable: Boolean(apiKey),
    apiKey,
    placesEnabled: providerId === MAP_PROVIDER_IDS.GOOGLE && options.enableRealMap === true && Boolean(apiKey) && requestedPlacesEnabled,
    fallbackReason:
      providerId === MAP_PROVIDER_IDS.GOOGLE && options.enableRealMap === true && !apiKey
        ? "missing-api-key"
        : null,
    fallbackProviderId: MAP_PROVIDER_IDS.STATIC,
  };
  return {
    ...config,
    placesLibraries: getPlacesLibraries(config),
  };
}
