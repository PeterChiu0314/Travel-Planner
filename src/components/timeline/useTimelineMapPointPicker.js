import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { googleMapsPointUrl } from "../../lib/mapPoint.js";

export default function useTimelineMapPointPicker({
  activeDay,
  activeTripId,
  activeSection,
  canEdit,
  canLoadRealMap,
  isMapClosing,
  isRouteCollapsed,
  isRouteLayoutCollapsed,
  openRouteMap,
  sidePanelsRef,
  toggleRouteMap,
}) {
  const [mapPickingMode, setMapPickingMode] = useState(null);
  const [mapPointPickFeedback, setMapPointPickFeedback] = useState("");
  const [pickedMapPoint, setPickedMapPoint] = useState(null);
  const [mapPointEditorState, setMapPointEditorState] = useState({ canPick: false, isOpen: false });
  const [isMapSearchReplaceActive, setIsMapSearchReplaceActive] = useState(false);
  const [isMapAddLocationActive, setIsMapAddLocationActive] = useState(false);
  const [isMapAddLocationPending, setIsMapAddLocationPending] = useState(false);
  const [mapAddLocationRequestId, setMapAddLocationRequestId] = useState(0);
  const mapAddLocationPendingRef = useRef(false);

  function startMapPointPick(mode = "editor") {
    setMapPointPickFeedback("picking");
    setMapPickingMode(mode === "map-add" ? "map-add" : "editor");
  }

  function cancelMapPointPick() {
    setMapPickingMode(null);
    setMapPointPickFeedback("");
  }

  function startMapSearchReplace() {
    if (isRouteLayoutCollapsed || !mapPointEditorState.canPick) return;
    cancelMapPointPick();
    setIsMapSearchReplaceActive(true);
  }

  function cancelMapSearchReplace() {
    setIsMapSearchReplaceActive(false);
  }

  const activateMapAddLocation = useCallback(() => {
    if (!mapAddLocationPendingRef.current) return;
    mapAddLocationPendingRef.current = false;
    setIsMapAddLocationPending(false);
    setIsMapAddLocationActive(true);
    setMapAddLocationRequestId((current) => current + 1);
  }, []);

  function startMapAddLocation() {
    cancelMapPointPick();
    cancelMapSearchReplace();
    setPickedMapPoint(null);
    mapAddLocationPendingRef.current = true;
    setIsMapAddLocationPending(true);
    if (isRouteLayoutCollapsed || isMapClosing) {
      openRouteMap();
      return;
    }
    activateMapAddLocation();
  }

  function cancelMapAddLocation() {
    mapAddLocationPendingRef.current = false;
    setIsMapAddLocationPending(false);
    setIsMapAddLocationActive(false);
    setPickedMapPoint(null);
    cancelMapPointPick();
  }

  function toggleRouteMapWithAddLocationCleanup() {
    if (!isRouteCollapsed && (isMapAddLocationActive || isMapAddLocationPending)) cancelMapAddLocation();
    toggleRouteMap();
  }

  function finishMapAddLocation() {
    mapAddLocationPendingRef.current = false;
    setIsMapAddLocationPending(false);
    setIsMapAddLocationActive(false);
  }

  function pickMapPoint(point) {
    if (!point) return;
    setPickedMapPoint({ ...point, pickedAt: Date.now(), source: mapPickingMode || "editor" });
    setMapPickingMode(null);
    setMapPointPickFeedback("picked");
    if (isMapAddLocationActive) finishMapAddLocation();
    window.setTimeout(() => {
      setMapPointPickFeedback((current) => (current === "picked" ? "" : current));
    }, 1500);
  }

  function selectPlaceDetails(details) {
    const latitude = Number(details?.latitude);
    const longitude = Number(details?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    const isMapUrlPoint = details.source === "map-url";
    setPickedMapPoint({
      displayName: details.displayName || "",
      googleMapsUri: isMapUrlPoint
        ? details.googleMapsUri || googleMapsPointUrl(latitude, longitude)
        : googleMapsPointUrl(latitude, longitude),
      latitude,
      longitude,
      pickedAt: Date.now(),
      placeId: details.id || "",
      source: isMapUrlPoint || !isMapSearchReplaceActive ? "places-details" : "places-replace",
    });
    if (isMapAddLocationActive) finishMapAddLocation();
  }

  useLayoutEffect(() => {
    if (!isMapAddLocationPending || isRouteLayoutCollapsed) return undefined;
    const sidePanels = sidePanelsRef.current;
    if (!sidePanels) return undefined;
    const revealAnimations = typeof sidePanels.getAnimations === "function"
      ? sidePanels.getAnimations().filter((animation) => animation.animationName === "timeline-map-reveal")
      : [];
    if (!revealAnimations.length) {
      activateMapAddLocation();
      return undefined;
    }
    let cancelled = false;
    Promise.allSettled(revealAnimations.map((animation) => animation.finished)).then(() => {
      if (!cancelled) activateMapAddLocation();
    });
    return () => {
      cancelled = true;
    };
  }, [activateMapAddLocation, isMapAddLocationPending, isRouteLayoutCollapsed]);

  useEffect(() => {
    cancelMapAddLocation();
  }, [activeDay, activeTripId, activeSection]);

  useEffect(() => {
    if (!mapPickingMode) return undefined;

    function handleDocumentPointerDown(event) {
      const target = event.target;
      if (target?.closest?.(".google-map-surface") || target?.closest?.(".map-point-picker-button")) return;
      if (target?.closest?.(".map-area-point-button")) return;
      cancelMapPointPick();
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
    };
  }, [mapPickingMode]);

  useEffect(() => {
    if (isRouteLayoutCollapsed && mapPickingMode) cancelMapPointPick();
    if (isRouteLayoutCollapsed && isMapSearchReplaceActive) cancelMapSearchReplace();
  }, [isMapSearchReplaceActive, isRouteLayoutCollapsed, mapPickingMode]);

  const mapPointPicker = {
    canPickMapPoint: !isRouteLayoutCollapsed && canEdit && (!mapPointEditorState.isOpen || mapPointEditorState.canPick),
    hasActiveMapPointEditor: mapPointEditorState.canPick,
    isPickingMapPoint: Boolean(mapPickingMode),
    isMapSearchReplaceActive,
    isMapAddLocationActive,
    mapAddLocationRequestId,
    mapPickingMode,
    mapPointPickFeedback,
    pickedMapPoint,
    previewMapPoint: mapPointEditorState.previewMapPoint || null,
    onCancelMapPointPick: cancelMapPointPick,
    onCancelMapAddLocation: cancelMapAddLocation,
    onCancelMapSearchReplace: cancelMapSearchReplace,
    onMapPointEditorActiveChange: setMapPointEditorState,
    onPickMapPoint: pickMapPoint,
    onSelectPlaceDetails: selectPlaceDetails,
    onStartMapAddLocation: canLoadRealMap ? startMapAddLocation : undefined,
    onStartMapSearchReplace: startMapSearchReplace,
    onStartMapPointPick: startMapPointPick,
  };

  return { mapPointPicker, toggleRouteMapWithAddLocationCleanup };
}
