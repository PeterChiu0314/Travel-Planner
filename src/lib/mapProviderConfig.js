export const MAP_PROVIDER_IDS = Object.freeze({
  STATIC: "static",
  GOOGLE: "google",
});

export const DEFAULT_MAP_PROVIDER_ID = MAP_PROVIDER_IDS.STATIC;

export function getMapProviderConfig(options = {}) {
  const requestedProviderId = options.providerId || DEFAULT_MAP_PROVIDER_ID;
  const providerId = Object.values(MAP_PROVIDER_IDS).includes(requestedProviderId)
    ? requestedProviderId
    : DEFAULT_MAP_PROVIDER_ID;

  return {
    providerId,
    loadMode: providerId === MAP_PROVIDER_IDS.GOOGLE ? "lazy" : "eager",
    canLoadRealMap: providerId === MAP_PROVIDER_IDS.GOOGLE && options.enableRealMap === true,
    fallbackProviderId: MAP_PROVIDER_IDS.STATIC,
  };
}
