export function buildMapProviderAdapterInput({ markers = [], focusedMapState = null, onFocusItem = null } = {}) {
  return {
    markers: Array.isArray(markers) ? markers : [],
    focusedMarkerId: focusedMapState?.focusedMarkerId || null,
    focusedItemId: focusedMapState?.focusedItemId || null,
    focusedItemType: focusedMapState?.focusedItemType || null,
    transportEndpointMarkerIds: focusedMapState?.transportEndpointMarkerIds || {
      fromItemId: null,
      toItemId: null,
      fromMarkerId: null,
      toMarkerId: null,
      markerIds: [],
    },
    onMarkerFocus: typeof onFocusItem === "function" ? onFocusItem : null,
  };
}
