import { useEffect, useState } from "react";
import StaticMapProvider from "./providers/StaticMapProvider.jsx";
import { buildMapProviderAdapterInput } from "../../lib/mapProviderAdapter.js";
import { DEFAULT_MAP_PROVIDER_ID, getMapProviderConfig } from "../../lib/mapProviderConfig.js";

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

  useEffect(() => {
    let cancelled = false;

    if (!providerConfig.canLoadRealMap || providerConfig.providerId !== "google") {
      setGoogleProvider(null);
      return () => {
        cancelled = true;
      };
    }

    loadGoogleMapProviderModule()
      .then((module) => {
        if (!cancelled) setGoogleProvider(() => module.default);
      })
      .catch(() => {
        if (!cancelled) setGoogleProvider(null);
      });

    return () => {
      cancelled = true;
    };
  }, [providerConfig.canLoadRealMap, providerConfig.providerId]);

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
  };

  if (GoogleProvider) {
    return <GoogleProvider {...providerProps} />;
  }

  return (
    <StaticMapProvider {...providerProps} />
  );
}
