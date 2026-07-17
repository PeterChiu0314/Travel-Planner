function buildBounds(markers) {
  return markers.reduce(
    (bounds, marker) => ({
      minLat: Math.min(bounds.minLat, marker.latitude),
      maxLat: Math.max(bounds.maxLat, marker.latitude),
      minLng: Math.min(bounds.minLng, marker.longitude),
      maxLng: Math.max(bounds.maxLng, marker.longitude),
    }),
    { minLat: Infinity, maxLat: -Infinity, minLng: Infinity, maxLng: -Infinity },
  );
}

function markerPosition(marker, bounds) {
  const horizontalRange = bounds.maxLng - bounds.minLng;
  const verticalRange = bounds.maxLat - bounds.minLat;
  const left = horizontalRange ? 14 + ((marker.longitude - bounds.minLng) / horizontalRange) * 72 : 50;
  const top = verticalRange ? 14 + ((bounds.maxLat - marker.latitude) / verticalRange) * 72 : 50;

  return { left: `${left}%`, top: `${top}%` };
}

export default function StaticMapProvider({
  markers = [],
  focusedMapState = {},
  missingMapPointCount = 0,
  onFocusItem,
  className = "route-map",
}) {
  const endpointIds = focusedMapState.transportEndpointMarkerIds || {};
  const coordinateMarkers = markers.filter((marker) => marker.hasCoordinates);
  const fallbackMarkers = coordinateMarkers.length ? markers.filter((marker) => !marker.hasCoordinates) : markers;
  const bounds = buildBounds(coordinateMarkers);

  function markerStateClass(marker) {
    const isFocusedStop = focusedMapState.focusedMarkerId === marker.id;
    const isTransportFrom = endpointIds.fromMarkerId === marker.id;
    const isTransportTo = endpointIds.toMarkerId === marker.id;
    const endpointClass = isTransportFrom
      ? " route-stop-transport-endpoint route-stop-transport-from"
      : isTransportTo
        ? " route-stop-transport-endpoint route-stop-transport-to"
        : "";

    return `${isFocusedStop ? " focused" : ""}${endpointClass}`;
  }

  function markerLabel(marker) {
    const index = markers.findIndex((item) => item.id === marker.id);
    return index >= 0 ? index + 1 : "";
  }

  return (
    <div className={className}>
      {coordinateMarkers.length ? (
        <div className="static-map-marker-layer" aria-label="Static map markers">
          {coordinateMarkers.map((marker) => (
            <button
              className={`static-map-marker${markerStateClass(marker)}`}
              key={marker.id}
              style={{
                ...markerPosition(marker, bounds),
                "--route-marker-color": marker.markerColor || undefined,
                "--route-marker-fill-color": marker.markerFillColor || undefined,
                "--route-marker-text-color": marker.markerTextColor || undefined,
              }}
              type="button"
              onClick={() => onFocusItem?.(marker.itemId)}
            >
              <span className="route-dot">{markerLabel(marker)}</span>
              <span className="static-map-marker-label">{marker.locationName}</span>
            </button>
          ))}
        </div>
      ) : null}
      {fallbackMarkers.length ? <div className="route-line" /> : null}
      {fallbackMarkers.length ? (
        <div className={coordinateMarkers.length ? "static-map-fallback-stops" : undefined}>
          {fallbackMarkers.map((marker) => (
            <button
              className={`route-stop${markerStateClass(marker)}`}
              key={marker.id}
              style={{
                "--route-marker-color": marker.markerColor || undefined,
                "--route-marker-fill-color": marker.markerFillColor || undefined,
                "--route-marker-text-color": marker.markerTextColor || undefined,
              }}
              type="button"
              onClick={() => onFocusItem?.(marker.itemId)}
            >
              <span className="route-dot">{markerLabel(marker)}</span>
              <span className="route-name">{marker.locationName}</span>
            </button>
          ))}
        </div>
      ) : coordinateMarkers.length ? null : (
        <div className="timeline-empty">No route stops to display</div>
      )}
      {missingMapPointCount > 0 ? (
        <div className="map-point-warning">尚有 {missingMapPointCount} 個目的地缺少可用座標</div>
      ) : null}
    </div>
  );
}
