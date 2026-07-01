export default function StaticMapProvider({
  markers = [],
  focusedMapState = {},
  onFocusItem,
  className = "route-map",
}) {
  const endpointIds = focusedMapState.transportEndpointMarkerIds || {};

  return (
    <div className={className}>
      {markers.length ? <div className="route-line" /> : null}
      {markers.length ? (
        markers.map((marker, index) => {
          const isFocusedStop = focusedMapState.focusedMarkerId === marker.id;
          const isTransportFrom = endpointIds.fromMarkerId === marker.id;
          const isTransportTo = endpointIds.toMarkerId === marker.id;
          const endpointClass = isTransportFrom
            ? " route-stop-transport-endpoint route-stop-transport-from"
            : isTransportTo
              ? " route-stop-transport-endpoint route-stop-transport-to"
              : "";

          return (
            <button
              className={`route-stop${isFocusedStop ? " focused" : ""}${endpointClass}`}
              key={marker.id}
              type="button"
              onClick={() => onFocusItem?.(marker.itemId)}
            >
              <span className="route-dot">{index + 1}</span>
              <span className="route-name">{marker.locationName}</span>
            </button>
          );
        })
      ) : (
        <div className="timeline-empty">撠頝舐?</div>
      )}
    </div>
  );
}
