import { MAP_PROVIDER_IDS } from "./mapProviderConfig.js";

export function shouldLogMapProviderDiagnostics(search = "") {
  if (typeof search !== "string") return false;

  try {
    return new URLSearchParams(search).get("debugMap") === "1";
  } catch {
    return false;
  }
}

export function buildMapProviderDiagnostics(providerConfig, options = {}) {
  const shouldUseGoogleProvider =
    providerConfig?.providerId === MAP_PROVIDER_IDS.GOOGLE && providerConfig?.canLoadRealMap === true;
  const loaderFailed = options.loaderFailed === true;
  const fallbackReason = loaderFailed && shouldUseGoogleProvider
    ? "loader-failure"
    : providerConfig?.fallbackReason ?? null;

  return {
    mode: providerConfig?.mode ?? "formal",
    requestedProvider: providerConfig?.requestedProviderId ?? MAP_PROVIDER_IDS.STATIC,
    resolvedProvider: shouldUseGoogleProvider && !loaderFailed
      ? MAP_PROVIDER_IDS.GOOGLE
      : providerConfig?.fallbackProviderId ?? MAP_PROVIDER_IDS.STATIC,
    hasGoogleMapsKey: providerConfig?.apiKeyAvailable === true,
    shouldUseGoogleProvider: shouldUseGoogleProvider && !loaderFailed,
    fallbackReason,
  };
}
