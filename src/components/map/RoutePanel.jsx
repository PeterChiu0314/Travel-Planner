import MapPanel from "./MapPanel.jsx";
import { countMissingMapPoints } from "../../lib/mapPoint.js";
import { buildRoutePanelStops, getFocusedMapState } from "../../lib/timelineMapMarkers.js";
import { buildTimelineVisitDisplayOrder } from "../../lib/timelineUntimedOrdering.js";

export default function RoutePanel({
  dayItems,
  focusedItemId,
  canPickMapPoint = false,
  hasActiveMapPointEditor = false,
  headingEyebrow = "Route",
  isPickingMapPoint = false,
  isMapAddLocationActive = false,
  isMapSearchReplaceActive = false,
  mapAddLocationRequestId = 0,
  mapPickingMode = null,
  mapPointPickFeedback = "",
  previewMapPoint = null,
  mode = "formal",
  routeOverridePointsBySegment = {},
  routeOverrideSaveError = "",
  routeEditCollaboration = {},
  viewportKey,
  onFocusItem,
  onCancelMapPointPick,
  onCancelMapAddLocation,
  onCancelMapSearchReplace,
  onPickMapPoint,
  onRouteOverrideChange,
  onRouteEditCollaborationEvent,
  onRouteEditPresenceChange,
  onSelectPlaceDetails,
  onStartMapSearchReplace,
  onStartMapPointPick,
}) {
  const previewDayItems = previewMapPoint?.itemId
    ? dayItems.map((item) => item.id === previewMapPoint.itemId
      ? {
          ...item,
          latitude: previewMapPoint.latitude,
          longitude: previewMapPoint.longitude,
          map_url: previewMapPoint.mapUrl,
        }
      : item)
    : previewMapPoint
      ? [
          ...dayItems,
          {
            id: "itinerary-editor-preview",
            item_type: "visit",
            latitude: previewMapPoint.latitude,
            location: previewMapPoint.locationName,
            location_name: previewMapPoint.locationName,
            longitude: previewMapPoint.longitude,
            map_url: previewMapPoint.mapUrl,
            title: previewMapPoint.locationName,
            type: previewMapPoint.type || "attraction",
          },
        ]
      : dayItems;
  const stops = buildRoutePanelStops(buildTimelineVisitDisplayOrder(previewDayItems), { requireLocation: true });
  const focusedMapState = getFocusedMapState(previewDayItems, stops, focusedItemId);
  const missingMapPointCount = countMissingMapPoints(dayItems);
  return (
    <section className="panel route-panel">
      <div className="panel-heading tight">
        <div>
          <p className="eyebrow">{headingEyebrow}</p>
          <h3>路線</h3>
        </div>
      </div>
      <MapPanel
        markers={stops}
        focusedMapState={focusedMapState}
        mode={mode}
        viewportKey={viewportKey}
        missingMapPointCount={missingMapPointCount}
        canPickMapPoint={canPickMapPoint}
        hasActiveMapPointEditor={hasActiveMapPointEditor}
        isPickingMapPoint={isPickingMapPoint}
        isMapAddLocationActive={isMapAddLocationActive}
        isMapSearchReplaceActive={isMapSearchReplaceActive}
        mapAddLocationRequestId={mapAddLocationRequestId}
        mapPickingMode={mapPickingMode}
        mapPointPickFeedback={mapPointPickFeedback}
        onFocusItem={onFocusItem}
        onCancelMapPointPick={onCancelMapPointPick}
        onCancelMapAddLocation={onCancelMapAddLocation}
        onCancelMapSearchReplace={onCancelMapSearchReplace}
        onPickMapPoint={onPickMapPoint}
        onRouteOverrideChange={onRouteOverrideChange}
        onRouteEditCollaborationEvent={onRouteEditCollaborationEvent}
        onRouteEditPresenceChange={onRouteEditPresenceChange}
        onSelectPlaceDetails={onSelectPlaceDetails}
        onStartMapSearchReplace={onStartMapSearchReplace}
        onStartMapPointPick={onStartMapPointPick}
        routeOverridePointsBySegment={routeOverridePointsBySegment}
        routeOverrideSaveError={routeOverrideSaveError}
        routeEditCollaboration={routeEditCollaboration}
      />
    </section>
  );
}
