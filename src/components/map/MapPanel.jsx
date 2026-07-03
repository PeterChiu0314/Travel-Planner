import { useEffect, useState } from "react";
import StaticMapProvider from "./providers/StaticMapProvider.jsx";
import { buildMapProviderAdapterInput } from "../../lib/mapProviderAdapter.js";
import { DEFAULT_MAP_PROVIDER_ID, getMapProviderConfig } from "../../lib/mapProviderConfig.js";
import {
  buildMapProviderDiagnostics,
  shouldLogMapProviderDiagnostics,
} from "../../lib/mapProviderDiagnostics.js";

export function loadGoogleMapProviderModule() {
  return import("./providers/GoogleMapProvider.lazy.jsx");
}

export default function MapPanel({
  markers = [],
  focusedMapState,
  onFocusItem,
  providerId,
  enableRealMap = true,
  mode = "formal",
  viewportKey = "default",
  missingMapPointCount = 0,
  isPickingMapPoint = false,
  mapPointPickFeedback = "",
  onPickMapPoint,
  className = "route-map",
}) {
  const envProviderId = import.meta.env?.VITE_MAP_PROVIDER || DEFAULT_MAP_PROVIDER_ID;
  const apiKey = import.meta.env?.VITE_GOOGLE_MAPS_API_KEY || "";
  const providerConfig = getMapProviderConfig({
    providerId: providerId || envProviderId,
    enableRealMap,
    mode,
    apiKey,
  });
  const adapterInput = buildMapProviderAdapterInput({ markers, focusedMapState, onFocusItem });
  const [GoogleProvider, setGoogleProvider] = useState(null);
  const [googleProviderLoadFailed, setGoogleProviderLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!providerConfig.canLoadRealMap || providerConfig.providerId !== "google") {
      setGoogleProvider(null);
      setGoogleProviderLoadFailed(false);
      return () => {
        cancelled = true;
      };
    }

    setGoogleProviderLoadFailed(false);
    loadGoogleMapProviderModule()
      .then((module) => {
        if (!cancelled) setGoogleProvider(() => module.default);
      })
      .catch(() => {
        if (!cancelled) {
          setGoogleProvider(null);
          setGoogleProviderLoadFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [providerConfig.canLoadRealMap, providerConfig.providerId]);

  useEffect(() => {
    const search = typeof window === "undefined" ? "" : window.location.search;
    if (!shouldLogMapProviderDiagnostics(search)) return;

    console.info(
      "[MapPanel] provider diagnostics",
      buildMapProviderDiagnostics(providerConfig, { loaderFailed: googleProviderLoadFailed }),
    );
  }, [
    googleProviderLoadFailed,
    providerConfig.apiKeyAvailable,
    providerConfig.canLoadRealMap,
    providerConfig.fallbackProviderId,
    providerConfig.fallbackReason,
    providerConfig.mode,
    providerConfig.providerId,
    providerConfig.requestedProviderId,
  ]);

  const providerProps = {
    markers: adapterInput.markers,
    focusedMapState: {
      focusedItemId: adapterInput.focusedItemId,
      focusedItemType: adapterInput.focusedItemType,
      focusedMarkerId: adapterInput.focusedMarkerId,
      transportEndpointMarkerIds: adapterInput.transportEndpointMarkerIds,
    },
    onFocusItem: adapterInput.onMarkerFocus,
    className,
    providerConfig,
    viewportKey,
    missingMapPointCount,
    isPickingMapPoint,
    mapPointPickFeedback,
    onPickMapPoint,
  };

  if (GoogleProvider) {
    return <GoogleProvider {...providerProps} />;
  }

  return (
    <StaticMapProvider {...providerProps} />
  );
}
