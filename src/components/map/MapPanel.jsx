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
  providerId = DEFAULT_MAP_PROVIDER_ID,
  enableRealMap = false,
  className = "route-map",
}) {
  const providerConfig = getMapProviderConfig({ providerId, enableRealMap });
  const adapterInput = buildMapProviderAdapterInput({ markers, focusedMapState, onFocusItem });

  return (
    <StaticMapProvider
      markers={adapterInput.markers}
      focusedMapState={{
        focusedItemId: adapterInput.focusedItemId,
        focusedItemType: adapterInput.focusedItemType,
        focusedMarkerId: adapterInput.focusedMarkerId,
        transportEndpointMarkerIds: adapterInput.transportEndpointMarkerIds,
      }}
      onFocusItem={adapterInput.onMarkerFocus}
      className={className}
      providerConfig={providerConfig}
    />
  );
}
