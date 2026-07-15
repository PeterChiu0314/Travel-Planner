import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapPin, Route, Search, X } from "lucide-react";
import {
  createPlacesAutocompleteSessionManager,
  fetchPlaceDetailsForPrediction,
  fetchPlaceAutocompletePredictions,
} from "../../../lib/googlePlacesAdapter.js";
import { PLACE_DETAILS_FIELD_MASK_MINIMAL } from "../../../lib/googlePlacesConfig.js";
import { loadGoogleMapsApi } from "../../../lib/googleMapsLoader.js";
import {
  DESTINATION_MARKER_ANCHOR_X,
  DESTINATION_MARKER_ANCHOR_Y,
  DESTINATION_MARKER_HEIGHT,
  DESTINATION_MARKER_WIDTH,
  buildDestinationMarkerSvg,
} from "../../../lib/mapMarkerVisuals.js";
import { shouldLogMapProviderDiagnostics } from "../../../lib/mapProviderDiagnostics.js";
import { MAX_CUSTOM_ROUTE_POINTS_PER_SEGMENT } from "../../../lib/routeOverrides.js";
import {
  timelineTypeMarkerColor,
  timelineTypeMarkerFillColor,
  timelineTypeMarkerTextColor,
} from "../../../lib/timelineTypeStyles.js";
import StaticMapProvider from "./StaticMapProvider.jsx";

const DEFAULT_CENTER = { lat: 35.0116, lng: 135.7681 };
const DEFAULT_ZOOM = 11;
const FOCUSED_MARKER_ZOOM = 15;
const PLACES_PREVIEW_ZOOM = 15;
const PLACES_AUTOCOMPLETE_DEBOUNCE_MS = 700;
const PLACES_PREVIEW_DIALOG_WIDTH = 300;
const PLACES_PREVIEW_DIALOG_HEIGHT = 178;
const PLACES_PREVIEW_DIALOG_GAP = 18;
const PLACES_PREVIEW_DIALOG_EDGE_GAP = 12;
const PENDING_POI_HINT_WIDTH = 108;
const PENDING_POI_HINT_HEIGHT = 26;
const PENDING_POI_HINT_GAP = 43;
const ROUTE_EDIT_ACTIVE_TOP_INSET_PX = 6;
const ROUTE_EDIT_HIT_STROKE_WEIGHT = 22;
const ROUTE_EDIT_SUPPRESS_LINE_CLICK_MS = 250;
function googleMapsPointUrl(latitude, longitude) {
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}

function markerSequenceNumber(marker, fallbackIndex) {
  const sequenceNumber = Number(marker?.sequenceNumber);
  return Number.isFinite(sequenceNumber) && sequenceNumber > 0 ? sequenceNumber : fallbackIndex + 1;
}

function destinationMarkerIcon(
  mapsNamespace,
  marker,
  fallbackIndex,
  isFocusedMarker = false,
  isDimmed = false,
  isHovered = false,
) {
  const PointConstructor = mapsNamespace?.Point;
  const SizeConstructor = mapsNamespace?.Size;
  const svg = buildDestinationMarkerSvg({
    order: markerSequenceNumber(marker, fallbackIndex),
    color: marker?.markerColor || timelineTypeMarkerColor(marker?.category),
    fillColor: marker?.markerFillColor || timelineTypeMarkerFillColor(marker?.category),
    textColor: marker?.markerTextColor || timelineTypeMarkerTextColor(marker?.category),
    focused: isFocusedMarker,
    dimmed: isDimmed,
    hovered: isHovered,
  });
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    anchor:
      typeof PointConstructor === "function"
        ? new PointConstructor(DESTINATION_MARKER_ANCHOR_X, DESTINATION_MARKER_ANCHOR_Y)
        : undefined,
    scaledSize:
      typeof SizeConstructor === "function"
        ? new SizeConstructor(DESTINATION_MARKER_WIDTH, DESTINATION_MARKER_HEIGHT)
        : undefined,
  };
}

function placesPreviewMarkerIcon(mapsNamespace) {
  const symbolPath = mapsNamespace?.SymbolPath?.CIRCLE;
  if (!symbolPath) return null;
  return {
    path: symbolPath,
    fillColor: "#2f8f72",
    fillOpacity: 1,
    scale: 12,
    strokeColor: "#ffffff",
    strokeOpacity: 1,
    strokeWeight: 3,
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function anchoredDialogPosition(pixel, container, dialogWidth = PLACES_PREVIEW_DIALOG_WIDTH, dialogHeight = PLACES_PREVIEW_DIALOG_HEIGHT) {
  const width = container?.clientWidth || 0;
  const height = container?.clientHeight || 0;
  if (!pixel || !width || !height) return null;

  const maxLeft = Math.max(PLACES_PREVIEW_DIALOG_EDGE_GAP, width - dialogWidth - PLACES_PREVIEW_DIALOG_EDGE_GAP);
  const maxTop = Math.max(PLACES_PREVIEW_DIALOG_EDGE_GAP, height - dialogHeight - PLACES_PREVIEW_DIALOG_EDGE_GAP);
  const topCandidate = pixel.y - dialogHeight - PLACES_PREVIEW_DIALOG_GAP;
  const sideCandidate = pixel.x + PLACES_PREVIEW_DIALOG_GAP;
  const placement = topCandidate >= PLACES_PREVIEW_DIALOG_EDGE_GAP ? "above" : "side";
  const left = placement === "above"
    ? pixel.x - dialogWidth / 2
    : sideCandidate;
  const top = placement === "above"
    ? topCandidate
    : pixel.y - dialogHeight / 2;

  return {
    left: clamp(left, PLACES_PREVIEW_DIALOG_EDGE_GAP, maxLeft),
    top: clamp(top, PLACES_PREVIEW_DIALOG_EDGE_GAP, maxTop),
    placement,
  };
}

function anchoredHintPosition(pixel, container, hintWidth = PENDING_POI_HINT_WIDTH, hintHeight = PENDING_POI_HINT_HEIGHT) {
  const width = container?.clientWidth || 0;
  const height = container?.clientHeight || 0;
  if (!pixel || !width || !height) return null;

  const halfWidth = hintWidth / 2;
  const left = clamp(
    pixel.x,
    PLACES_PREVIEW_DIALOG_EDGE_GAP + halfWidth,
    Math.max(PLACES_PREVIEW_DIALOG_EDGE_GAP + halfWidth, width - PLACES_PREVIEW_DIALOG_EDGE_GAP - halfWidth),
  );
  const top = clamp(
    pixel.y - PENDING_POI_HINT_GAP - hintHeight,
    PLACES_PREVIEW_DIALOG_EDGE_GAP,
    Math.max(PLACES_PREVIEW_DIALOG_EDGE_GAP, height - hintHeight - PLACES_PREVIEW_DIALOG_EDGE_GAP),
  );

  return { left, top };
}

function readBoundsLocationBias(bounds) {
  const northEast = bounds?.getNorthEast?.();
  const southWest = bounds?.getSouthWest?.();
  const north = typeof northEast?.lat === "function" ? northEast.lat() : northEast?.lat;
  const east = typeof northEast?.lng === "function" ? northEast.lng() : northEast?.lng;
  const south = typeof southWest?.lat === "function" ? southWest.lat() : southWest?.lat;
  const west = typeof southWest?.lng === "function" ? southWest.lng() : southWest?.lng;
  const nextBias = { north: Number(north), east: Number(east), south: Number(south), west: Number(west) };
  return Object.values(nextBias).every(Number.isFinite) ? nextBias : null;
}

function coordinateKey(markers) {
  return markers
    .map(
      (marker) =>
        `${marker.id}:${marker.latitude}:${marker.longitude}:${marker.title || marker.locationName || ""}:${marker.category || ""}:${marker.sequenceNumber || ""}`,
    )
    .join("|");
}

function routeSegmentKey(fromMarker, toMarker) {
  return `${fromMarker.itemId}:${toMarker.itemId}`;
}

function buildRouteSegments(markers) {
  const segments = [];
  for (let index = 0; index < markers.length - 1; index += 1) {
    const fromMarker = markers[index];
    const toMarker = markers[index + 1];
    if (!fromMarker?.itemId || !toMarker?.itemId) continue;
    segments.push({
      key: routeSegmentKey(fromMarker, toMarker),
      from: { lat: fromMarker.latitude, lng: fromMarker.longitude },
      fromItemId: fromMarker.itemId,
      to: { lat: toMarker.latitude, lng: toMarker.longitude },
      toItemId: toMarker.itemId,
    });
  }
  return segments;
}

function routeSegmentPath(segment, customRoutePointsBySegment) {
  return [
    segment.from,
    ...(customRoutePointsBySegment[segment.key] || []),
    segment.to,
  ];
}

function routeSubSegments(segment, customPoints = []) {
  const path = [segment.from, ...customPoints, segment.to];
  return path.slice(0, -1).map((point, index) => ({
    insertIndex: index,
    path: [point, path[index + 1]],
  }));
}

function fullRoutePath(routeSegments, customRoutePointsBySegment) {
  return routeSegments.reduce((path, segment, index) => {
    const segmentPath = routeSegmentPath(segment, customRoutePointsBySegment);
    return index === 0 ? segmentPath : [...path, ...segmentPath.slice(1)];
  }, []);
}

function routeEditHandleIcon(mapsNamespace, remoteUserColor = "") {
  const PointConstructor = mapsNamespace?.Point;
  const SizeConstructor = mapsNamespace?.Size;
  const safeRemoteColor = /^#[0-9a-f]{6}$/i.test(remoteUserColor) ? remoteUserColor : "";
  const canvasSize = safeRemoteColor ? 20 : 14;
  const center = canvasSize / 2;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasSize}" height="${canvasSize}" viewBox="0 0 ${canvasSize} ${canvasSize}">`,
    safeRemoteColor
      ? `<defs><filter id="remote-glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="2.1"/></filter></defs><circle cx="${center}" cy="${center}" r="7" fill="none" stroke="${safeRemoteColor}" stroke-width="3" opacity="0.48" filter="url(#remote-glow)"/><circle cx="${center}" cy="${center}" r="6.4" fill="#2f8f72" stroke="${safeRemoteColor}" stroke-width="2.6"/><circle cx="${center}" cy="${center}" r="4.9" fill="#2f8f72"/>`
      : "",
    safeRemoteColor
      ? ""
      : `<circle cx="${center}" cy="${center}" r="5" fill="#2f8f72" stroke="#ffffff" stroke-width="2"/>`,
    "</svg>",
  ].join("");
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    anchor: typeof PointConstructor === "function" ? new PointConstructor(center, center) : undefined,
    scaledSize: typeof SizeConstructor === "function" ? new SizeConstructor(canvasSize, canvasSize) : undefined,
  };
}

export function getGoogleMapProviderStatus() {
  return {
    providerId: "google",
    loadMode: "lazy",
    sdkLoaded: false,
    sdkPackageBundled: true,
    ready: false,
  };
}

export default function GoogleMapProvider(props) {
  const {
    className = "route-map",
    focusedMapState = {},
    markers = [],
    missingMapPointCount = 0,
    canPickMapPoint = false,
    hasActiveMapPointEditor = false,
    isPickingMapPoint = false,
    mapPickingMode = null,
    mapPointPickFeedback = "",
    onCancelMapPointPick,
    onFocusItem,
    onPickMapPoint,
    onRouteOverrideChange,
    onRouteEditCollaborationEvent,
    onRouteEditPresenceChange,
    onSelectPlaceDetails,
    onStartMapPointPick,
    providerConfig = {},
    routeOverridePointsBySegment = {},
    routeOverrideSaveError = "",
    routeEditCollaboration = {},
    viewportKey = "default",
  } = props;
  const coordinateMarkers = useMemo(() => markers.filter((marker) => marker.hasCoordinates), [markers]);
  const mapElementRef = useRef(null);
  const mapRef = useRef(null);
  const mapsLibraryRef = useRef(null);
  const placesLibraryRef = useRef(null);
  const placesSessionManagerRef = useRef(createPlacesAutocompleteSessionManager(() => placesLibraryRef.current));
  const placeDetailsCacheRef = useRef(new Map());
  const markerInstancesRef = useRef(new Map());
  const markerHoverStateRef = useRef(new Map());
  const placesPreviewMarkerRef = useRef(null);
  const placesPreviewOverlayRef = useRef(null);
  const pendingPoiMarkerRef = useRef(null);
  const pendingPoiHintOverlayRef = useRef(null);
  const routeLineRef = useRef(null);
  const routeSegmentHitLineRefsRef = useRef([]);
  const routeEditHandleRefsRef = useRef([]);
  const routeEditNodeLocksRef = useRef({});
  const routeEditChannelReadyRef = useRef(routeEditCollaboration.isChannelReady !== false);
  const remoteRoutePreviewBySegmentRef = useRef({});
  const routeEditRemoteAppliedReceiptRef = useRef(new Map());
  const routeEditPendingCommitsRef = useRef(new Map());
  const routeEditAuthoritativeSegmentKeysRef = useRef(new Set());
  const routeEditDragRef = useRef({ commitId: null, isCommitPending: false, isDragging: false, lastDragEndedAt: 0, node: null, nodeId: null, segmentKey: null });
  const isPickingMapPointRef = useRef(isPickingMapPoint);
  const onCancelMapPointPickRef = useRef(onCancelMapPointPick);
  const onRouteEditPresenceChangeRef = useRef(onRouteEditPresenceChange);
  const routeEditSuppressLineClickUntilRef = useRef(0);
  const customRoutePointsRef = useRef({});
  const viewportListenersRef = useRef([]);
  const mapPointClickListenerRef = useRef(null);
  const viewportSuppressionTimerRef = useRef(null);
  const suppressViewportChangeRef = useRef(false);
  const userChangedViewportRef = useRef(false);
  const autoViewportSignatureRef = useRef(null);
  const placesSearchComposingRef = useRef(false);
  const placesAutocompleteRequestSeqRef = useRef(0);
  const lastRequestedPlacesQueryRef = useRef("");
  const latestPlacesLocationBiasRef = useRef(null);
  const [status, setStatus] = useState("idle");
  const [containerReady, setContainerReady] = useState(false);
  const [loadAttempted, setLoadAttempted] = useState(false);
  const [loadSucceeded, setLoadSucceeded] = useState(false);
  const [mapCreated, setMapCreated] = useState(false);
  const [placesReady, setPlacesReady] = useState(false);
  const [placesSearchInput, setPlacesSearchInput] = useState("");
  const [placesSearchIsComposing, setPlacesSearchIsComposing] = useState(false);

  useEffect(() => {
    isPickingMapPointRef.current = isPickingMapPoint;
    onCancelMapPointPickRef.current = onCancelMapPointPick;
    onRouteEditPresenceChangeRef.current = onRouteEditPresenceChange;
  }, [isPickingMapPoint, onCancelMapPointPick, onRouteEditPresenceChange]);
  const [placesPredictions, setPlacesPredictions] = useState([]);
  const [selectedPlacePrediction, setSelectedPlacePrediction] = useState(null);
  const [pendingPoi, setPendingPoi] = useState(null);
  const [pendingPoiHintPosition, setPendingPoiHintPosition] = useState(null);
  const [placesPreview, setPlacesPreview] = useState(null);
  const [placesPreviewDialogPosition, setPlacesPreviewDialogPosition] = useState(null);
  const [placesSearchStatus, setPlacesSearchStatus] = useState("idle");
  const [placesDetailsStatus, setPlacesDetailsStatus] = useState("idle");
  const [isRouteEditMode, setIsRouteEditMode] = useState(false);
  const [routeEditOverlayRect, setRouteEditOverlayRect] = useState(null);
  const [customRoutePointsBySegment, setCustomRoutePointsBySegment] = useState({});
  const [renderFailed, setRenderFailed] = useState(false);
  const [fallbackReason, setFallbackReason] = useState(null);
  const markersKey = coordinateKey(coordinateMarkers);
  const routeSegments = useMemo(() => buildRouteSegments(coordinateMarkers), [markersKey]);
  const routeSegmentByKey = useMemo(
    () => new Map(routeSegments.map((segment) => [segment.key, segment])),
    [routeSegments],
  );
  const viewportSignature = `${viewportKey}:${markersKey}`;
  const apiKey = typeof providerConfig.apiKey === "string" ? providerConfig.apiKey.trim() : "";
  const placesLibraries = Array.isArray(providerConfig.placesLibraries) ? providerConfig.placesLibraries : [];
  const placesSearchAvailable = status === "ready" && providerConfig.placesEnabled === true && placesReady;
  const canSearchPlaces = placesSearchAvailable && !isPickingMapPoint && !isRouteEditMode;
  const showPlacesSearchOverlay = placesSearchAvailable;
  const disableMapAreaPointPick = isRouteEditMode || !canPickMapPoint;

  const handleMapElementRef = useCallback((element) => {
    mapElementRef.current = element;
    setContainerReady(Boolean(element));
  }, []);

  function markUserViewportChange() {
    if (!suppressViewportChangeRef.current) {
      userChangedViewportRef.current = true;
    }
  }

  function updatePlacesLocationBias(map = mapRef.current) {
    latestPlacesLocationBiasRef.current = readBoundsLocationBias(map?.getBounds?.());
  }

  function runProgrammaticViewportUpdate(update) {
    if (viewportSuppressionTimerRef.current) {
      window.clearTimeout(viewportSuppressionTimerRef.current);
    }
    suppressViewportChangeRef.current = true;
    update();
    viewportSuppressionTimerRef.current = window.setTimeout(() => {
      suppressViewportChangeRef.current = false;
      viewportSuppressionTimerRef.current = null;
    }, 300);
  }

  function attachViewportListeners(map) {
    if (!map?.addListener || viewportListenersRef.current.length) return;
    viewportListenersRef.current = [
      map.addListener("dragstart", markUserViewportChange),
      map.addListener("zoom_changed", markUserViewportChange),
      map.addListener("heading_changed", markUserViewportChange),
      map.addListener("tilt_changed", markUserViewportChange),
      map.addListener("bounds_changed", () => updatePlacesLocationBias(map)),
      map.addListener("idle", () => updatePlacesLocationBias(map)),
    ];
    updatePlacesLocationBias(map);
  }

  function resetPlacesSearch() {
    setPlacesSearchInput("");
    setPlacesSearchIsComposing(false);
    setPlacesPredictions([]);
    setSelectedPlacePrediction(null);
    setPlacesSearchStatus("idle");
    setPlacesDetailsStatus("idle");
    placesSearchComposingRef.current = false;
    lastRequestedPlacesQueryRef.current = "";
    placesSessionManagerRef.current.resetSessionToken();
  }

  function clearPlacesPreview() {
    placesPreviewMarkerRef.current?.setMap?.(null);
    placesPreviewMarkerRef.current = null;
    placesPreviewOverlayRef.current?.setMap?.(null);
    placesPreviewOverlayRef.current = null;
    setPlacesPreview(null);
    setPlacesPreviewDialogPosition(null);
  }

  function clearPendingPoi() {
    pendingPoiMarkerRef.current?.setMap?.(null);
    pendingPoiMarkerRef.current = null;
    pendingPoiHintOverlayRef.current?.setMap?.(null);
    pendingPoiHintOverlayRef.current = null;
    setPendingPoiHintPosition(null);
    setPendingPoi(null);
  }

  function showPlacesPreview(details, fallbackName = "") {
    const latitude = Number(details?.latitude);
    const longitude = Number(details?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
    const nextPreview = {
      displayName: details.displayName || fallbackName || "",
      googleMapsUri: details.googleMapsUri || "",
      id: details.id || "",
      latitude,
      longitude,
      mapUrl: googleMapsPointUrl(latitude, longitude),
    };
    setPlacesPreview(nextPreview);
    runProgrammaticViewportUpdate(() => {
      mapRef.current?.setZoom?.(PLACES_PREVIEW_ZOOM);
      mapRef.current?.panTo?.({ lat: latitude, lng: longitude });
    });
    return true;
  }

  async function requestPlacesAutocomplete(rawInput) {
    const input = rawInput.trim();
    if (!canSearchPlaces) return false;
    if (input.length < 2) {
      lastRequestedPlacesQueryRef.current = "";
      setPlacesPredictions([]);
      setPlacesSearchStatus("idle");
      return false;
    }
    if (input === lastRequestedPlacesQueryRef.current) return false;

    lastRequestedPlacesQueryRef.current = input;
    const requestId = placesAutocompleteRequestSeqRef.current + 1;
    placesAutocompleteRequestSeqRef.current = requestId;
    setPlacesSearchStatus("loading");

    let sessionToken;
    try {
      sessionToken = placesSessionManagerRef.current.getOrCreateSessionToken();
    } catch {
      if (placesAutocompleteRequestSeqRef.current === requestId) {
        setPlacesPredictions([]);
        setPlacesSearchStatus("error");
      }
      return false;
    }

    try {
      const predictions = await fetchPlaceAutocompletePredictions({
        input,
        locationBias: latestPlacesLocationBiasRef.current,
        placesApi: placesLibraryRef.current,
        sessionToken,
      });
      if (placesAutocompleteRequestSeqRef.current !== requestId) return false;
      setPlacesPredictions(predictions);
      setPlacesSearchStatus(predictions.length ? "ready" : "empty");
      return true;
    } catch {
      if (placesAutocompleteRequestSeqRef.current === requestId) {
        setPlacesPredictions([]);
        setPlacesSearchStatus("error");
      }
      return false;
    }
  }

  async function selectPlacePrediction(prediction) {
    if (!prediction?.id) return;
    const originalSearchText = placesSearchInput;
    setSelectedPlacePrediction(prediction);
    setPlacesDetailsStatus("loading");

    let sessionToken;
    try {
      sessionToken = placesSessionManagerRef.current.getOrCreateSessionToken();
      const details = await fetchPlaceDetailsForPrediction({
        fields: PLACE_DETAILS_FIELD_MASK_MINIMAL,
        placesApi: placesLibraryRef.current,
        prediction,
        sessionToken,
      });
      if (!showPlacesPreview(details, prediction.mainText || prediction.description || "")) {
        clearPlacesPreview();
        setPlacesDetailsStatus("missing-location");
        return;
      }
      const selectedDisplayText = details.displayName || prediction.mainText || originalSearchText;
      lastRequestedPlacesQueryRef.current = selectedDisplayText.trim();
      setPlacesSearchInput(selectedDisplayText);
      setPlacesPredictions([]);
      setSelectedPlacePrediction(null);
      setPlacesSearchStatus("idle");
      setPlacesDetailsStatus("idle");
    } catch {
      clearPlacesPreview();
      setPlacesDetailsStatus("error");
    } finally {
      placesSessionManagerRef.current.resetSessionToken();
    }
  }

  function confirmPlacesPreviewAdd() {
    if (!placesPreview) return;
    onSelectPlaceDetails?.(placesPreview);
    clearPlacesPreview();
    resetPlacesSearch();
  }

  function cancelPlacesPreview() {
    clearPlacesPreview();
    resetPlacesSearch();
  }

  async function confirmPendingPoi() {
    if (!pendingPoi?.placeId) return;
    const cachedDetails = placeDetailsCacheRef.current.get(pendingPoi.placeId);
    if (cachedDetails) {
      if (showPlacesPreview(cachedDetails, pendingPoi.displayName)) {
        clearPendingPoi();
      }
      return;
    }

    try {
      const details = await fetchPlaceDetailsForPrediction({
        fields: PLACE_DETAILS_FIELD_MASK_MINIMAL,
        placesApi: placesLibraryRef.current,
        prediction: { id: pendingPoi.placeId },
      });
      placeDetailsCacheRef.current.set(pendingPoi.placeId, details);
      if (showPlacesPreview(details, pendingPoi.displayName)) {
        clearPendingPoi();
      }
    } catch {
      clearPendingPoi();
    } finally {
      placesSessionManagerRef.current.resetSessionToken();
    }
  }

  function toggleMapAreaPointPick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (disableMapAreaPointPick) return;
    clearPendingPoi();
    clearPlacesPreview();
    resetPlacesSearch();
    if (isPickingMapPoint) {
      onCancelMapPointPick?.();
      return;
    }
    onStartMapPointPick?.(hasActiveMapPointEditor ? "editor" : "map-add");
  }

  function toggleRouteEditMode(event) {
    event.preventDefault();
    event.stopPropagation();
    setIsRouteEditMode((current) => !current);
  }

  function exitRouteEditMode() {
    setIsRouteEditMode(false);
  }

  function updateRouteEditOverlayRect() {
    const mapRect = mapElementRef.current?.parentElement?.getBoundingClientRect?.();
    if (!mapRect) {
      setRouteEditOverlayRect(null);
      return;
    }
    const workbench = mapElementRef.current?.closest?.(".timeline-workbench");
    const dayBoardRect = !workbench?.classList?.contains("route-collapsed")
      ? workbench?.querySelector?.(".itinerary-panel")?.getBoundingClientRect?.()
      : null;
    const left = Math.min(
      mapRect.right,
      Math.max(mapRect.left, dayBoardRect?.width > 0 ? dayBoardRect.right : mapRect.left),
    );
    const top = Math.min(mapRect.bottom, mapRect.top + ROUTE_EDIT_ACTIVE_TOP_INSET_PX);
    setRouteEditOverlayRect({
      bottom: Math.max(0, window.innerHeight - mapRect.bottom),
      height: Math.max(0, mapRect.bottom - top),
      left: Math.max(0, left),
      right: Math.max(0, window.innerWidth - mapRect.right),
      top: Math.max(0, top),
      width: Math.max(0, mapRect.right - left),
    });
  }

  function applyRouteLinePath(nextCustomRoutePointsBySegment = customRoutePointsRef.current) {
    const nextPath = fullRoutePath(routeSegments, nextCustomRoutePointsBySegment);
    routeLineRef.current?.setPath?.(nextPath);
  }

  function mergeRemoteRoutePreview(pointsBySegment = {}) {
    const merged = { ...pointsBySegment };
    Object.entries(remoteRoutePreviewBySegmentRef.current).forEach(([segmentKey, nodePreviews]) => {
      let segmentPoints = [...(merged[segmentKey] || [])];
      Object.values(nodePreviews || {}).forEach((preview) => {
        if (!preview?.nodeId) return;
        if (preview.deleted) {
          segmentPoints = segmentPoints.filter((point) => point.id !== preview.nodeId);
          return;
        }
        if (!preview.node) return;
        const existingIndex = segmentPoints.findIndex((point) => point.id === preview.nodeId);
        if (existingIndex >= 0) {
          segmentPoints[existingIndex] = preview.node;
          return;
        }
        const afterIndex = preview.afterNodeId
          ? segmentPoints.findIndex((point) => point.id === preview.afterNodeId)
          : -1;
        segmentPoints.splice(afterIndex + 1, 0, preview.node);
      });
      if (segmentPoints.length) merged[segmentKey] = segmentPoints;
      else delete merged[segmentKey];
    });
    return merged;
  }

  function mergeLocalRouteDragPreview(pointsBySegment = {}) {
    let merged = pointsBySegment;
    routeEditPendingCommitsRef.current.forEach((pendingCommit) => {
      if (!pendingCommit.segmentKey || !pendingCommit.nodeId || !pendingCommit.node) return;
      const segmentPoints = merged[pendingCommit.segmentKey] || [];
      if (!segmentPoints.some((point) => point.id === pendingCommit.nodeId)) return;
      merged = {
        ...merged,
        [pendingCommit.segmentKey]: segmentPoints.map((point) =>
          point.id === pendingCommit.nodeId ? pendingCommit.node : point),
      };
    });
    const activeDrag = routeEditDragRef.current;
    if (!activeDrag.isDragging || !activeDrag.segmentKey || !activeDrag.nodeId || !activeDrag.node) {
      return merged;
    }
    const segmentPoints = merged[activeDrag.segmentKey] || [];
    if (!segmentPoints.some((point) => point.id === activeDrag.nodeId)) return merged;
    return {
      ...merged,
      [activeDrag.segmentKey]: segmentPoints.map((point) =>
        point.id === activeDrag.nodeId ? activeDrag.node : point),
    };
  }

  async function persistRouteCustomPoints(segmentKey, points, operation = null) {
    if (typeof onRouteOverrideChange !== "function") return { ok: true, points };
    const segment = routeSegmentByKey.get(segmentKey);
    if (!segment) return { ok: false, points: [] };
    const result = await onRouteOverrideChange({
      fromItemId: segment.fromItemId,
      points,
      operation,
      segmentKey,
      toItemId: segment.toItemId,
    });
    return result || { ok: true, points };
  }

  function setRouteSegmentPoints(segmentKey, points) {
    const nextPoints = Array.isArray(points) ? points : [];
    const nextPointsBySegment = { ...customRoutePointsRef.current };
    if (nextPoints.length) nextPointsBySegment[segmentKey] = nextPoints;
    else delete nextPointsBySegment[segmentKey];
    // Promise completions run outside the render that created the optimistic
    // edit.  Keep the imperative source of truth aligned before broadcasting
    // an inverse event, otherwise a failed delete can restore React state but
    // leave the next merge operating on the already-deleted ref snapshot.
    customRoutePointsRef.current = nextPointsBySegment;
    setCustomRoutePointsBySegment((current) => {
      if (!nextPoints.length) {
        const next = { ...current };
        delete next[segmentKey];
        return next;
      }
      return {
        ...current,
        [segmentKey]: nextPoints,
      };
    });
  }

  function suppressRouteLineClick() {
    routeEditSuppressLineClickUntilRef.current = Date.now() + ROUTE_EDIT_SUPPRESS_LINE_CLICK_MS;
  }

  function newRouteNodeId() {
    if (typeof crypto?.randomUUID === "function") return `node-${crypto.randomUUID()}`;
    return `node-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function insertRouteCustomPoint(segmentKey, insertIndex, point) {
    const currentPoints = customRoutePointsRef.current[segmentKey] || [];
    if (currentPoints.length >= MAX_CUSTOM_ROUTE_POINTS_PER_SEGMENT) return;
    const safeInsertIndex = clamp(Math.floor(insertIndex), 0, currentPoints.length);
    const node = { id: newRouteNodeId(), ...point };
    const nextPoints = [
      ...currentPoints.slice(0, safeInsertIndex),
      node,
      ...currentPoints.slice(safeInsertIndex),
    ];
    const afterNodeId = currentPoints[safeInsertIndex - 1]?.id || null;
    customRoutePointsRef.current = { ...customRoutePointsRef.current, [segmentKey]: nextPoints };
    setCustomRoutePointsBySegment((current) => ({ ...current, [segmentKey]: nextPoints }));
    onRouteEditCollaborationEvent?.({ afterNodeId, phase: "node-add", segmentKey, node, nodeId: node.id });
    void persistRouteCustomPoints(segmentKey, nextPoints, {
      afterNodeId,
      node,
      type: "add",
    }).then((result) => {
      if (result?.points) setRouteSegmentPoints(segmentKey, result.points);
      if (result?.ok === false) {
        onRouteEditCollaborationEvent?.({ phase: "node-delete", segmentKey, nodeId: node.id });
      }
    });
  }

  function updateRouteCustomPoint(segmentKey, nodeId, point) {
    const currentPoints = customRoutePointsRef.current[segmentKey] || [];
    const currentNode = currentPoints.find((candidate) => candidate.id === nodeId);
    if (!currentNode) return Promise.resolve({ ok: false, points: currentPoints });
    const node = { ...currentNode, ...point };
    const nextPoints = currentPoints.map((currentPoint) => (currentPoint.id === nodeId ? node : currentPoint));
    customRoutePointsRef.current = { ...customRoutePointsRef.current, [segmentKey]: nextPoints };
    setCustomRoutePointsBySegment((current) => ({ ...current, [segmentKey]: nextPoints }));
    return persistRouteCustomPoints(segmentKey, nextPoints, { node, type: "update" }).then((result) => {
      // A delete can follow a drag-end before this save response returns.  In
      // that case the delete owns the node now; an older update response must
      // not restore the removed handle or emit an inverse collaboration event.
      const nodeStillExists = (customRoutePointsRef.current[segmentKey] || []).some(
        (candidate) => candidate.id === nodeId,
      );
      if (!nodeStillExists) return result;
      if (result?.points) setRouteSegmentPoints(segmentKey, result.points);
      if (result?.ok === false) {
        const restoredNode = result.points?.find((candidate) => candidate.id === nodeId) || null;
        if (restoredNode) {
          onRouteEditCollaborationEvent?.({
            phase: "node-drag-end",
            node: restoredNode,
            nodeId,
            segmentKey,
          });
        } else {
          onRouteEditCollaborationEvent?.({ phase: "node-delete", segmentKey, nodeId });
        }
      }
      return result;
    });
  }

  function removeRouteCustomPoint(segmentKey, nodeId) {
    const currentPoints = customRoutePointsRef.current[segmentKey] || [];
    const nodeIndex = currentPoints.findIndex((point) => point.id === nodeId);
    if (nodeIndex < 0) return;
    const node = currentPoints[nodeIndex];
    const afterNodeId = currentPoints[nodeIndex - 1]?.id || null;
    const nextPoints = currentPoints.filter((point) => point.id !== nodeId);
    const commitKey = `${segmentKey}:${nodeId}`;
    // Deletion supersedes any unacknowledged drag final for this node.  Keeping
    // the pending commit would let mergeLocalRouteDragPreview reapply the old
    // position and make the deleted handle jump back into view.
    routeEditPendingCommitsRef.current.delete(commitKey);
    const remoteSegmentPreviews = remoteRoutePreviewBySegmentRef.current[segmentKey];
    if (remoteSegmentPreviews?.[nodeId]) {
      const nextRemoteSegmentPreviews = { ...remoteSegmentPreviews };
      delete nextRemoteSegmentPreviews[nodeId];
      remoteRoutePreviewBySegmentRef.current = { ...remoteRoutePreviewBySegmentRef.current };
      if (Object.keys(nextRemoteSegmentPreviews).length) {
        remoteRoutePreviewBySegmentRef.current[segmentKey] = nextRemoteSegmentPreviews;
      } else {
        delete remoteRoutePreviewBySegmentRef.current[segmentKey];
      }
    }
    const nextPointsBySegment = { ...customRoutePointsRef.current };
    if (nextPoints.length) nextPointsBySegment[segmentKey] = nextPoints;
    else delete nextPointsBySegment[segmentKey];
    customRoutePointsRef.current = nextPointsBySegment;
    setCustomRoutePointsBySegment((current) => {
      if (!nextPoints.length) {
        const next = { ...current };
        delete next[segmentKey];
        return next;
      }
      return {
        ...current,
        [segmentKey]: nextPoints,
      };
    });
    onRouteEditCollaborationEvent?.({ phase: "node-delete", segmentKey, nodeId });
    void persistRouteCustomPoints(segmentKey, nextPoints, { nodeId, type: "delete" }).then((result) => {
      if (result?.points) setRouteSegmentPoints(segmentKey, result.points);
      if (result?.ok === false) {
        onRouteEditCollaborationEvent?.({ afterNodeId, phase: "node-add", segmentKey, node, nodeId });
      }
    });
  }

  useEffect(() => {
    let cancelled = false;

    if (!containerReady) return undefined;

    if (!apiKey) {
      setFallbackReason("missing-api-key");
      setStatus("failed");
      return undefined;
    }

    setStatus("loading");
    setLoadAttempted(true);
    setFallbackReason(null);

    loadGoogleMapsApi({ apiKey, libraries: placesLibraries })
      .then((mapsLibrary) => {
        if (cancelled) return;
        mapsLibraryRef.current = mapsLibrary;
        placesLibraryRef.current = mapsLibrary?.libraries?.places || null;
        setPlacesReady(Boolean(mapsLibrary?.libraries?.places));
        setLoadSucceeded(true);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) {
          placesLibraryRef.current = null;
          setPlacesReady(false);
          setLoadSucceeded(false);
          setFallbackReason("loader-failure");
          setStatus("failed");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apiKey, containerReady, placesLibraries.join("|")]);

  useEffect(() => {
    if (!canSearchPlaces) {
      setPlacesPredictions([]);
      setPlacesSearchStatus("idle");
      return undefined;
    }
    if (placesSearchIsComposing) return undefined;

    const input = placesSearchInput.trim();
    if (input.length < 2) {
      lastRequestedPlacesQueryRef.current = "";
      setPlacesPredictions([]);
      setPlacesSearchStatus("idle");
      return undefined;
    }

    const timerId = window.setTimeout(() => {
      void requestPlacesAutocomplete(input);
    }, PLACES_AUTOCOMPLETE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [canSearchPlaces, placesSearchInput, placesSearchIsComposing]);

  useEffect(() => {
    if (!isRouteEditMode) return undefined;

    onRouteEditPresenceChangeRef.current?.({ isEditing: true });

    return () => {
      onRouteEditPresenceChangeRef.current?.({ isEditing: false });
    };
  }, [isRouteEditMode]);

  useEffect(() => {
    if (!isRouteEditMode) return undefined;

    clearPendingPoi();
    clearPlacesPreview();
    resetPlacesSearch();
    if (isPickingMapPointRef.current) onCancelMapPointPickRef.current?.();
    updateRouteEditOverlayRect();

    function handleRouteEditKeyDown(event) {
      if (event.key === "Escape") {
        setIsRouteEditMode(false);
      }
    }

    function handleRouteEditViewportChange() {
      updateRouteEditOverlayRect();
    }

    document.addEventListener("keydown", handleRouteEditKeyDown);
    window.addEventListener("resize", handleRouteEditViewportChange);
    window.addEventListener("scroll", handleRouteEditViewportChange, true);
    return () => {
      document.removeEventListener("keydown", handleRouteEditKeyDown);
      window.removeEventListener("resize", handleRouteEditViewportChange);
      window.removeEventListener("scroll", handleRouteEditViewportChange, true);
    };
  }, [isRouteEditMode]);

  useEffect(() => {
    if (status !== "ready" || !mapElementRef.current) return undefined;

    try {
      const mapsNamespace = window.google?.maps;
      const MapConstructor = mapsLibraryRef.current?.Map || mapsNamespace?.Map;
      const MarkerConstructor = mapsNamespace?.Marker;
      const BoundsConstructor = mapsLibraryRef.current?.LatLngBounds || mapsNamespace?.LatLngBounds;

      if (!MapConstructor || !MarkerConstructor || (coordinateMarkers.length > 1 && !BoundsConstructor)) {
        throw new Error("Google Maps constructors unavailable");
      }

      const firstMarker = coordinateMarkers[0];
      const initialCenter = firstMarker
        ? { lat: firstMarker.latitude, lng: firstMarker.longitude }
        : DEFAULT_CENTER;

      if (!mapRef.current) {
        mapRef.current = new MapConstructor(mapElementRef.current, {
          center: initialCenter,
          clickableIcons: true,
          fullscreenControl: false,
          mapTypeControl: false,
          streetViewControl: false,
          zoom: coordinateMarkers.length > 1 ? DEFAULT_ZOOM : 14,
        });
        attachViewportListeners(mapRef.current);
        setMapCreated(true);
      }

      if (autoViewportSignatureRef.current !== viewportSignature) {
        userChangedViewportRef.current = false;
        autoViewportSignatureRef.current = viewportSignature;
      }

      markerInstancesRef.current.forEach((marker) => marker.setMap(null));
      markerInstancesRef.current = new Map();
      markerHoverStateRef.current.clear();

      if (!coordinateMarkers.length) {
        if (!userChangedViewportRef.current) {
          runProgrammaticViewportUpdate(() => {
            mapRef.current.setCenter(DEFAULT_CENTER);
            mapRef.current.setZoom(DEFAULT_ZOOM);
          });
        }
        setRenderFailed(false);
        setFallbackReason(null);
        return () => {
          markerInstancesRef.current.forEach((marker) => marker.setMap(null));
          markerInstancesRef.current = new Map();
          markerHoverStateRef.current.clear();
        };
      }

      const bounds = new BoundsConstructor();
      coordinateMarkers.forEach((marker, index) => {
        const position = { lat: marker.latitude, lng: marker.longitude };
        const googleMarker = new MarkerConstructor({
          icon: destinationMarkerIcon(mapsNamespace, marker, index, false, false),
          map: mapRef.current,
          position,
          title: marker.title || marker.locationName || "",
          zIndex: index + 1,
        });

        googleMarker.addListener("click", () => {
          if (!isPickingMapPoint && !isRouteEditMode) onFocusItem?.(marker.itemId);
        });
        const hoverState = { focused: false, hovered: false };
        markerHoverStateRef.current.set(marker.id, hoverState);
        googleMarker.addListener("mouseover", () => {
          if (isPickingMapPoint || isRouteEditMode || hoverState.hovered) return;
          hoverState.hovered = true;
          googleMarker.setIcon(destinationMarkerIcon(mapsNamespace, marker, index, hoverState.focused, false, true));
        });
        googleMarker.addListener("mouseout", () => {
          if (!hoverState.hovered) return;
          hoverState.hovered = false;
          googleMarker.setIcon(destinationMarkerIcon(mapsNamespace, marker, index, hoverState.focused, false, false));
        });
        markerInstancesRef.current.set(marker.id, googleMarker);
        bounds.extend(position);
      });

      if (coordinateMarkers.length === 1) {
        if (!userChangedViewportRef.current) {
          runProgrammaticViewportUpdate(() => {
            mapRef.current.setCenter(initialCenter);
            mapRef.current.setZoom(14);
          });
        }
      } else {
        if (!userChangedViewportRef.current) {
          runProgrammaticViewportUpdate(() => {
            mapRef.current.fitBounds(bounds);
          });
        }
      }

      setRenderFailed(false);
      setFallbackReason(null);
    } catch {
      setFallbackReason("render-failure");
      setRenderFailed(true);
    }

    return () => {
      markerInstancesRef.current.forEach((marker) => marker.setMap(null));
      markerInstancesRef.current = new Map();
      markerHoverStateRef.current.clear();
    };
  }, [isPickingMapPoint, isRouteEditMode, markersKey, onFocusItem, status, viewportSignature]);

  useEffect(() => {
    const nextPoints = mergeLocalRouteDragPreview(mergeRemoteRoutePreview(customRoutePointsBySegment));
    customRoutePointsRef.current = nextPoints;
    applyRouteLinePath(nextPoints);
  }, [customRoutePointsBySegment, markersKey]);

  useEffect(() => {
    remoteRoutePreviewBySegmentRef.current = {};
    routeEditRemoteAppliedReceiptRef.current.clear();
  }, [viewportKey]);

  useEffect(() => {
    if (!routeEditCollaboration.recoveryGeneration) return;
    remoteRoutePreviewBySegmentRef.current = {};
    routeEditRemoteAppliedReceiptRef.current.clear();
  }, [routeEditCollaboration.recoveryGeneration]);

  useEffect(() => {
    const authoritativePoints = routeOverridePointsBySegment || {};
    const authoritativeSegmentKeys = new Set(Object.keys(authoritativePoints));
    const invalidatedSegmentKeys = new Set(
      [...routeEditAuthoritativeSegmentKeysRef.current].filter(
        (segmentKey) => !authoritativeSegmentKeys.has(segmentKey),
      ),
    );
    routeEditAuthoritativeSegmentKeysRef.current = authoritativeSegmentKeys;
    if (invalidatedSegmentKeys.size) {
      const nextRemotePreviews = { ...remoteRoutePreviewBySegmentRef.current };
      invalidatedSegmentKeys.forEach((segmentKey) => delete nextRemotePreviews[segmentKey]);
      remoteRoutePreviewBySegmentRef.current = nextRemotePreviews;
      routeEditPendingCommitsRef.current.forEach((pendingCommit, commitKey) => {
        if (invalidatedSegmentKeys.has(pendingCommit.segmentKey)) {
          routeEditPendingCommitsRef.current.delete(commitKey);
        }
      });
    }
    const acknowledgedLocalCommits = [];
    routeEditPendingCommitsRef.current.forEach((pendingCommit, commitKey) => {
      const formalAcknowledged = pendingCommit.segmentKey && pendingCommit.nodeId && pendingCommit.node &&
        (authoritativePoints[pendingCommit.segmentKey] || []).some(
          (point) => point.id === pendingCommit.nodeId &&
            point.lat === pendingCommit.node.lat &&
            point.lng === pendingCommit.node.lng,
        );
      if (!formalAcknowledged) return;
      routeEditPendingCommitsRef.current.delete(commitKey);
      acknowledgedLocalCommits.push(pendingCommit);
    });
    Object.entries(remoteRoutePreviewBySegmentRef.current).forEach(([segmentKey, nodePreviews]) => {
      const formalPoints = authoritativePoints[segmentKey] || [];
      Object.entries(nodePreviews || {}).forEach(([nodeId, preview]) => {
        const formalNode = formalPoints.find((point) => point.id === nodeId);
        const formalMatchesPreview = preview.deleted
          ? !formalNode
          : formalNode && preview.node && formalNode.lat === preview.node.lat && formalNode.lng === preview.node.lng;
        if (preview.phase !== "node-drag-move" && formalMatchesPreview) delete nodePreviews[nodeId];
      });
      if (!Object.keys(nodePreviews || {}).length) delete remoteRoutePreviewBySegmentRef.current[segmentKey];
    });
    const nextPoints = mergeLocalRouteDragPreview(mergeRemoteRoutePreview(authoritativePoints));
    customRoutePointsRef.current = nextPoints;
    if (!routeEditDragRef.current.isDragging && routeEditPendingCommitsRef.current.size === 0) {
      setCustomRoutePointsBySegment(authoritativePoints);
    }
    applyRouteLinePath(nextPoints);

    // A remote user can begin the next drag before this client has received
    // the formal acknowledgement for its own previous drag.  Keep that newer
    // preview while local-final priority is active, then apply it as soon as
    // the acknowledgement releases the local node.  Dropping it here makes
    // same-node handoff appear to stop synchronizing until another event is
    // received.
    acknowledgedLocalCommits.forEach((pendingCommit) => {
      const deferredPreview = remoteRoutePreviewBySegmentRef.current[pendingCommit.segmentKey]?.[pendingCommit.nodeId];
      if (deferredPreview?.node && !deferredPreview.deleted) {
        const deferredHandle = routeEditHandleRefsRef.current.find(
          (record) => record.segmentKey === pendingCommit.segmentKey && record.nodeId === pendingCommit.nodeId,
        );
        deferredHandle?.marker?.setPosition?.({ lat: deferredPreview.node.lat, lng: deferredPreview.node.lng });
      }
    });
  }, [markersKey, routeOverridePointsBySegment]);

  useEffect(() => {
    const updates = Object.values(routeEditCollaboration.remoteUpdates || {}).sort(
      (left, right) => Number(left?.receiptId || 0) - Number(right?.receiptId || 0),
    );
    updates.forEach((update) => {
      if (!update?.segmentKey || !update.nodeId) return;
      const receiptKey = `${update.sessionId}:${update.segmentKey}:${update.nodeId}`;
      const previousReceiptId = routeEditRemoteAppliedReceiptRef.current.get(receiptKey) || 0;
      if (!Number.isFinite(update.receiptId) || update.receiptId <= previousReceiptId) return;
      routeEditRemoteAppliedReceiptRef.current.set(receiptKey, update.receiptId);

      if (update.phase === "node-drag-start") {
        const commitKey = `${update.segmentKey}:${update.nodeId}`;
        const remoteOwnerTookOverPendingNode = routeEditPendingCommitsRef.current.has(commitKey);
        if (remoteOwnerTookOverPendingNode) {
          // A new remote drag owns this node now.  The previous local final is
          // still persisted, but it must no longer suppress the new owner's
          // preview while its formal acknowledgement is in flight.
          routeEditPendingCommitsRef.current.delete(commitKey);
        }
        return;
      }

      const activeDrag = routeEditDragRef.current;
      const commitKey = `${update.segmentKey}:${update.nodeId}`;
      // A remote delete is a newer ownership decision than this client's
      // unacknowledged drag final.  Release that final immediately so the
      // delete preview and the following authoritative reload can remove the
      // handle instead of being hidden behind local-final priority.
      if (update.phase === "node-delete") {
        routeEditPendingCommitsRef.current.delete(commitKey);
      }
      const ownsNodePosition = (activeDrag.isDragging &&
        activeDrag.segmentKey === update.segmentKey && activeDrag.nodeId === update.nodeId) ||
        routeEditPendingCommitsRef.current.has(commitKey);

      const segmentPreviews = remoteRoutePreviewBySegmentRef.current[update.segmentKey] || {};
      remoteRoutePreviewBySegmentRef.current = {
        ...remoteRoutePreviewBySegmentRef.current,
        [update.segmentKey]: {
          ...segmentPreviews,
          [update.nodeId]: {
            afterNodeId: update.afterNodeId || null,
            deleted: update.phase === "node-delete",
            node: update.node || null,
            nodeId: update.nodeId,
            phase: update.phase,
            updatedAt: update.updatedAt,
          },
        },
      };

      // Do not let an older local drag visually overwrite itself.  The remote
      // preview is still retained above so it can be applied immediately once
      // the local final commit is acknowledged.
      if (ownsNodePosition) return;

      const nextCustomPoints = mergeLocalRouteDragPreview(mergeRemoteRoutePreview(customRoutePointsRef.current));
      customRoutePointsRef.current = nextCustomPoints;
      applyRouteLinePath(nextCustomPoints);

      if (update.phase === "node-add" || update.phase === "node-delete") {
        setRouteSegmentPoints(update.segmentKey, nextCustomPoints[update.segmentKey] || []);
        return;
      }

      const changedHandle = routeEditHandleRefsRef.current.find(
        (record) => record.segmentKey === update.segmentKey && record.nodeId === update.nodeId,
      );
      if (changedHandle && update.node) {
        changedHandle.marker?.setPosition?.({ lat: update.node.lat, lng: update.node.lng });
      }
    });
  }, [routeEditCollaboration.remoteUpdates]);

  useEffect(() => {
    const nodeLocks = routeEditCollaboration.nodeLocks || {};
    const isChannelReady = routeEditCollaboration.isChannelReady !== false;
    routeEditNodeLocksRef.current = nodeLocks;
    routeEditChannelReadyRef.current = isChannelReady;
    routeEditHandleRefsRef.current.forEach((record) => {
      const nodeLock = nodeLocks[`${record.segmentKey}:${record.nodeId}`];
      const isLockedByRemote = Boolean(nodeLock);
      record.markerState.isLockedByRemote = isLockedByRemote;
      record.marker?.setDraggable?.(isChannelReady && !isLockedByRemote);
      record.marker?.setIcon?.(routeEditHandleIcon(window.google?.maps, isLockedByRemote ? nodeLock.color : ""));
      record.marker?.setTitle?.(isLockedByRemote ? `${nodeLock.userName} 正在編輯` : "拖曳路線節點，點擊可刪除");
    });
  }, [routeEditCollaboration.isChannelReady, routeEditCollaboration.nodeLocks]);

  useEffect(() => {
    routeLineRef.current?.setMap(null);
    routeLineRef.current = null;

    if (status !== "ready" || !mapRef.current || routeSegments.length < 1) return undefined;

    const mapsNamespace = window.google?.maps;
    if (typeof mapsNamespace?.Polyline !== "function") return undefined;

    routeLineRef.current = new mapsNamespace.Polyline({
      clickable: false,
      geodesic: false,
      map: mapRef.current,
      path: fullRoutePath(routeSegments, customRoutePointsRef.current),
      strokeColor: "#2f8f72",
      strokeOpacity: 0.7,
      strokeWeight: 3,
      zIndex: 10,
    });
    applyRouteLinePath(customRoutePointsRef.current);

    return () => {
      routeLineRef.current?.setMap(null);
      routeLineRef.current = null;
    };
  }, [markersKey, status]);

  useEffect(() => {
    routeSegmentHitLineRefsRef.current.forEach((record) => record.line?.setMap?.(null));
    routeSegmentHitLineRefsRef.current = [];
    routeEditHandleRefsRef.current.forEach((record) => record.marker?.setMap?.(null));
    routeEditHandleRefsRef.current = [];

    if (!isRouteEditMode || status !== "ready" || !mapRef.current || routeSegments.length < 1) return undefined;

    const mapsNamespace = window.google?.maps;
    const PolylineConstructor = mapsNamespace?.Polyline;
    const MarkerConstructor = mapsNamespace?.Marker;
    if (typeof PolylineConstructor !== "function" || typeof MarkerConstructor !== "function") return undefined;

    routeSegmentHitLineRefsRef.current = routeSegments.flatMap((segment) => {
      const customPoints = customRoutePointsRef.current[segment.key] || [];
      return routeSubSegments(segment, customPoints).map((subSegment) => {
        const line = new PolylineConstructor({
          clickable: true,
          geodesic: false,
          map: mapRef.current,
          path: subSegment.path,
          strokeColor: "#ffffff",
          strokeOpacity: 0.01,
          strokeWeight: ROUTE_EDIT_HIT_STROKE_WEIGHT,
          zIndex: 20,
        });

        line.addListener?.("click", (event) => {
          event?.stop?.();
          if (Date.now() < routeEditSuppressLineClickUntilRef.current) return;
          const lat = typeof event?.latLng?.lat === "function" ? event.latLng.lat() : null;
          const lng = typeof event?.latLng?.lng === "function" ? event.latLng.lng() : null;
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
          insertRouteCustomPoint(segment.key, subSegment.insertIndex, { lat, lng });
        });

        return { line, segmentKey: segment.key, insertIndex: subSegment.insertIndex };
      });
    });

    routeEditHandleRefsRef.current = routeSegments.flatMap((segment) => {
      const customPoints = customRoutePointsRef.current[segment.key] || [];
      return customPoints.map((point) => {
        const nodeLock = routeEditNodeLocksRef.current[`${segment.key}:${point.id}`];
        const isLockedByRemote = Boolean(nodeLock);
        const markerState = { isLockedByRemote };
        const marker = new MarkerConstructor({
          clickable: true,
          draggable: !isLockedByRemote && routeEditChannelReadyRef.current,
          icon: routeEditHandleIcon(mapsNamespace, isLockedByRemote ? nodeLock.color : ""),
          map: mapRef.current,
          position: point,
          title: isLockedByRemote ? `${nodeLock.userName} 正在編輯` : "拖曳路線節點，點擊可刪除",
          zIndex: 4000,
        });

        marker.addListener?.("dragstart", () => {
          if (markerState.isLockedByRemote || !routeEditChannelReadyRef.current) return;
          suppressRouteLineClick();
          onRouteEditCollaborationEvent?.({ phase: "node-drag-start", nodeId: point.id, segmentKey: segment.key });
          routeEditPendingCommitsRef.current.delete(`${segment.key}:${point.id}`);
          routeEditDragRef.current = {
            commitId: null,
            isCommitPending: false,
            isDragging: true,
            lastDragEndedAt: routeEditDragRef.current.lastDragEndedAt || 0,
            node: point,
            nodeId: point.id,
            segmentKey: segment.key,
          };
        });

        marker.addListener?.("drag", (event) => {
          const lat = typeof event?.latLng?.lat === "function" ? event.latLng.lat() : null;
          const lng = typeof event?.latLng?.lng === "function" ? event.latLng.lng() : null;
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
          const currentSegmentPoints = customRoutePointsRef.current[segment.key] || [];
          const currentNode = currentSegmentPoints.find((candidate) => candidate.id === point.id) || point;
          const node = { ...currentNode, lat, lng };
          routeEditDragRef.current = { ...routeEditDragRef.current, isDragging: true, node };
          const nextSegmentPoints = currentSegmentPoints.map((candidate) => candidate.id === point.id ? node : candidate);
          const nextCustomPoints = {
            ...customRoutePointsRef.current,
            [segment.key]: nextSegmentPoints,
          };
          customRoutePointsRef.current = nextCustomPoints;
          applyRouteLinePath(nextCustomPoints);
          onRouteEditCollaborationEvent?.({ phase: "node-drag-move", node, nodeId: point.id, segmentKey: segment.key });
        });

        marker.addListener?.("dragend", (event) => {
          suppressRouteLineClick();
          const lat = typeof event?.latLng?.lat === "function" ? event.latLng.lat() : null;
          const lng = typeof event?.latLng?.lng === "function" ? event.latLng.lng() : null;
          const lastDragEndedAt = Date.now();
          let finalNode = routeEditDragRef.current.node || point;
          let savePromise = Promise.resolve({ ok: true, points: customRoutePointsRef.current[segment.key] || [] });
          const commitId = `route-node-commit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const hasFinalPosition = Number.isFinite(lat) && Number.isFinite(lng);
          if (hasFinalPosition) {
            finalNode = { ...finalNode, lat, lng };
            savePromise = updateRouteCustomPoint(segment.key, point.id, { lat, lng });
          }
          const commitKey = `${segment.key}:${point.id}`;
          if (hasFinalPosition) {
            routeEditPendingCommitsRef.current.set(commitKey, {
              commitId,
              lastDragEndedAt,
              node: finalNode,
              nodeId: point.id,
              segmentKey: segment.key,
            });
          }
          routeEditDragRef.current = {
            commitId: null,
            isCommitPending: false,
            isDragging: false,
            lastDragEndedAt,
            node: null,
            nodeId: null,
            segmentKey: null,
          };
          onRouteEditCollaborationEvent?.({
            phase: "node-drag-end",
            node: finalNode,
            nodeId: point.id,
            segmentKey: segment.key,
          });
          void Promise.resolve(savePromise).catch(() => ({
            ok: false,
            points: customRoutePointsRef.current[segment.key] || [],
          })).then((result) => {
            const pendingCommit = routeEditPendingCommitsRef.current.get(commitKey);
            if (pendingCommit?.commitId !== commitId) return;
            if (result?.ok === false || !hasFinalPosition) {
              routeEditPendingCommitsRef.current.delete(commitKey);
            }
            if (result?.points) setRouteSegmentPoints(segment.key, result.points);
          });
        });

        marker.addListener?.("click", (event) => {
          event?.stop?.();
          suppressRouteLineClick();
          const recentlyDragged = Date.now() - (routeEditDragRef.current.lastDragEndedAt || 0) < 250;
          if (routeEditDragRef.current.isDragging || recentlyDragged) {
            routeEditDragRef.current.isDragging = false;
            return;
          }
          if (markerState.isLockedByRemote) return;
          removeRouteCustomPoint(segment.key, point.id);
        });

        marker.addListener?.("mousedown", (event) => {
          event?.stop?.();
          suppressRouteLineClick();
        });

        return { marker, markerState, nodeId: point.id, segmentKey: segment.key };
      });
    });

    return () => {
      routeSegmentHitLineRefsRef.current.forEach((record) => record.line?.setMap?.(null));
      routeSegmentHitLineRefsRef.current = [];
      routeEditHandleRefsRef.current.forEach((record) => record.marker?.setMap?.(null));
      routeEditHandleRefsRef.current = [];
    };
  }, [customRoutePointsBySegment, isRouteEditMode, markersKey, onRouteEditCollaborationEvent, status]);

  useEffect(() => {
    if (status !== "ready" || !mapRef.current || !placesPreview) {
      placesPreviewMarkerRef.current?.setMap?.(null);
      placesPreviewMarkerRef.current = null;
      placesPreviewOverlayRef.current?.setMap?.(null);
      placesPreviewOverlayRef.current = null;
      setPlacesPreviewDialogPosition(null);
      return undefined;
    }

    const mapsNamespace = window.google?.maps;
    const MarkerConstructor = mapsNamespace?.Marker;
    const OverlayViewConstructor = mapsNamespace?.OverlayView;
    const LatLngConstructor = mapsNamespace?.LatLng;
    if (typeof MarkerConstructor !== "function" || typeof OverlayViewConstructor !== "function") return undefined;

    const position = { lat: placesPreview.latitude, lng: placesPreview.longitude };
    placesPreviewMarkerRef.current?.setMap?.(null);
    placesPreviewMarkerRef.current = new MarkerConstructor({
      map: mapRef.current,
      position,
      title: placesPreview.displayName || "",
      label: { text: "+", color: "#ffffff", fontSize: "18px", fontWeight: "900" },
      icon: placesPreviewMarkerIcon(mapsNamespace),
      zIndex: 3000,
    });

    placesPreviewOverlayRef.current?.setMap?.(null);
    const overlay = new OverlayViewConstructor();
    overlay.onAdd = function onAdd() {};
    overlay.draw = function draw() {
      const projection = overlay.getProjection?.();
      const anchor = typeof LatLngConstructor === "function"
        ? new LatLngConstructor(placesPreview.latitude, placesPreview.longitude)
        : position;
      const pixel =
        projection?.fromLatLngToContainerPixel?.(anchor) ||
        projection?.fromLatLngToDivPixel?.(anchor);
      setPlacesPreviewDialogPosition(anchoredDialogPosition(pixel, mapElementRef.current));
    };
    overlay.onRemove = function onRemove() {
      setPlacesPreviewDialogPosition(null);
    };
    overlay.setMap(mapRef.current);
    placesPreviewOverlayRef.current = overlay;

    return () => {
      placesPreviewMarkerRef.current?.setMap?.(null);
      placesPreviewMarkerRef.current = null;
      placesPreviewOverlayRef.current?.setMap?.(null);
      placesPreviewOverlayRef.current = null;
    };
  }, [placesPreview, status]);

  useEffect(() => {
    if (status !== "ready" || !mapRef.current || !pendingPoi) {
      pendingPoiMarkerRef.current?.setMap?.(null);
      pendingPoiMarkerRef.current = null;
      pendingPoiHintOverlayRef.current?.setMap?.(null);
      pendingPoiHintOverlayRef.current = null;
      setPendingPoiHintPosition(null);
      return undefined;
    }

    const mapsNamespace = window.google?.maps;
    const MarkerConstructor = mapsNamespace?.Marker;
    const OverlayViewConstructor = mapsNamespace?.OverlayView;
    const LatLngConstructor = mapsNamespace?.LatLng;
    if (typeof MarkerConstructor !== "function") return undefined;

    const position = Number.isFinite(pendingPoi.latitude) && Number.isFinite(pendingPoi.longitude)
      ? { lat: pendingPoi.latitude, lng: pendingPoi.longitude }
      : null;

    pendingPoiMarkerRef.current?.setMap?.(null);
    if (position) {
      pendingPoiMarkerRef.current = new MarkerConstructor({
        map: mapRef.current,
        position,
        title: pendingPoi.displayName || "",
        label: { text: "i", color: "#ffffff", fontSize: "16px", fontWeight: "900" },
        icon: placesPreviewMarkerIcon(mapsNamespace),
        zIndex: 2500,
      });
      pendingPoiMarkerRef.current.addListener?.("click", (markerEvent) => {
        markerEvent?.stop?.();
        void confirmPendingPoi();
      });

      pendingPoiHintOverlayRef.current?.setMap?.(null);
      if (typeof OverlayViewConstructor === "function") {
        const overlay = new OverlayViewConstructor();
        overlay.onAdd = function onAdd() {};
        overlay.draw = function draw() {
          const projection = overlay.getProjection?.();
          const anchor = typeof LatLngConstructor === "function"
            ? new LatLngConstructor(position.lat, position.lng)
            : position;
          const pixel =
            projection?.fromLatLngToContainerPixel?.(anchor) ||
            projection?.fromLatLngToDivPixel?.(anchor);
          setPendingPoiHintPosition(anchoredHintPosition(pixel, mapElementRef.current));
        };
        overlay.onRemove = function onRemove() {
          setPendingPoiHintPosition(null);
        };
        overlay.setMap(mapRef.current);
        pendingPoiHintOverlayRef.current = overlay;
      }
    }

    return () => {
      pendingPoiMarkerRef.current?.setMap?.(null);
      pendingPoiMarkerRef.current = null;
      pendingPoiHintOverlayRef.current?.setMap?.(null);
      pendingPoiHintOverlayRef.current = null;
    };
  }, [pendingPoi, status]);

  useEffect(() => {
    if (status !== "ready" || !mapRef.current) return;
    if (isPickingMapPoint) return;
    if (isRouteEditMode) return;

    const mapsNamespace = window.google?.maps;

    markerInstancesRef.current.forEach((marker, markerId) => {
      const markerIndex = coordinateMarkers.findIndex((candidate) => candidate.id === markerId);
      const markerRecord = markerIndex >= 0 ? coordinateMarkers[markerIndex] : null;
      const isFocusedMarker = focusedMapState.focusedMarkerId === markerId;
      const hoverState = markerHoverStateRef.current.get(markerId) || { focused: false, hovered: false };
      hoverState.focused = isFocusedMarker;
      markerHoverStateRef.current.set(markerId, hoverState);
      marker.setZIndex(isFocusedMarker ? 1000 : Math.max(markerIndex + 1, 1));
      marker.setIcon(
        destinationMarkerIcon(
          mapsNamespace,
          markerRecord,
          markerIndex >= 0 ? markerIndex : 0,
          isFocusedMarker,
          false,
          Boolean(hoverState?.hovered),
        ),
      );
    });

    const focusedMarker = focusedMapState.focusedMarkerId
      ? markerInstancesRef.current.get(focusedMapState.focusedMarkerId)
      : null;

    if (focusedMarker?.getPosition) {
      runProgrammaticViewportUpdate(() => {
        mapRef.current.setZoom(FOCUSED_MARKER_ZOOM);
        mapRef.current.panTo(focusedMarker.getPosition());
      });
    }
  }, [focusedMapState.focusedMarkerId, isPickingMapPoint, isRouteEditMode, markersKey, status]);

  useEffect(() => {
    if (mapPointClickListenerRef.current) {
      mapPointClickListenerRef.current.remove?.();
      mapPointClickListenerRef.current = null;
    }
    if (status !== "ready" || !mapRef.current) return undefined;

    mapPointClickListenerRef.current = mapRef.current.addListener("click", (event) => {
      if (isRouteEditMode) {
        event?.stop?.();
        return;
      }
      const latLng = event?.latLng;
      const latitude = typeof latLng?.lat === "function" ? latLng.lat() : null;
      const longitude = typeof latLng?.lng === "function" ? latLng.lng() : null;
      const placeId = typeof event?.placeId === "string" ? event.placeId : "";

      if (placeId) {
        event.stop?.();
        if (isPickingMapPoint) {
          if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
            onPickMapPoint?.({ latitude, longitude });
          }
          return;
        }
        clearPlacesPreview();
        setPlacesPredictions([]);
        setPlacesSearchStatus("idle");
        setPendingPoi({
          displayName: event.name || event.feature?.displayName || "",
          latitude: Number.isFinite(latitude) ? latitude : null,
          longitude: Number.isFinite(longitude) ? longitude : null,
          pickedAt: Date.now(),
          placeId,
        });
        return;
      }

      if (placesPreview) {
        cancelPlacesPreview();
        return;
      }
      if (pendingPoi) {
        clearPendingPoi();
        return;
      }
      if (!isPickingMapPoint) return;
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        onPickMapPoint?.({ latitude, longitude });
      }
    });

    return () => {
      mapPointClickListenerRef.current?.remove?.();
      mapPointClickListenerRef.current = null;
    };
  }, [isPickingMapPoint, isRouteEditMode, onPickMapPoint, pendingPoi, placesPreview, status]);

  useEffect(() => {
    clearPendingPoi();
    clearPlacesPreview();
    setPlacesPredictions([]);
    setPlacesSearchStatus("idle");
  }, [isPickingMapPoint, isRouteEditMode, viewportKey]);

  useEffect(() => {
    if (!placesPreview && !pendingPoi) return undefined;

    function handleDocumentPointerDown(event) {
      const target = event.target;
      if (target?.closest?.(".google-map-surface")) return;
      clearPendingPoi();
      if (placesPreview) {
        cancelPlacesPreview();
      } else {
        clearPlacesPreview();
      }
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
    };
  }, [pendingPoi, placesPreview]);

  useEffect(() => () => {
    if (viewportSuppressionTimerRef.current) {
      window.clearTimeout(viewportSuppressionTimerRef.current);
    }
    viewportListenersRef.current.forEach((listener) => listener.remove?.());
    viewportListenersRef.current = [];
    routeLineRef.current?.setMap(null);
    routeLineRef.current = null;
    routeSegmentHitLineRefsRef.current.forEach((record) => record.line?.setMap?.(null));
    routeSegmentHitLineRefsRef.current = [];
    routeEditHandleRefsRef.current.forEach((record) => record.marker?.setMap?.(null));
    routeEditHandleRefsRef.current = [];
    pendingPoiMarkerRef.current?.setMap?.(null);
    pendingPoiMarkerRef.current = null;
    pendingPoiHintOverlayRef.current?.setMap?.(null);
    pendingPoiHintOverlayRef.current = null;
    placesPreviewMarkerRef.current?.setMap?.(null);
    placesPreviewMarkerRef.current = null;
    placesPreviewOverlayRef.current?.setMap?.(null);
    placesPreviewOverlayRef.current = null;
    mapPointClickListenerRef.current?.remove?.();
    mapPointClickListenerRef.current = null;
  }, []);

  useEffect(() => {
    const search = typeof window === "undefined" ? "" : window.location.search;
    if (!shouldLogMapProviderDiagnostics(search)) return;

    console.info("[GoogleMapProvider] diagnostics", {
      hasApiKey: Boolean(apiKey),
      totalMarkers: markers.length,
      coordinateMarkers: coordinateMarkers.length,
      containerReady,
      loadAttempted,
      loadSucceeded,
      mapCreated,
      fallbackReason,
      placesEnabled: providerConfig.placesEnabled === true,
      placesReady,
    });
  }, [
    apiKey,
    containerReady,
    coordinateMarkers.length,
    fallbackReason,
    loadAttempted,
    loadSucceeded,
    mapCreated,
    markers.length,
    providerConfig.placesEnabled,
    placesReady,
  ]);

  const placesStatusMessage =
    placesDetailsStatus === "loading"
      ? "\u8f09\u5165\u5730\u9ede\u8cc7\u6599\u4e2d..."
      : placesDetailsStatus === "missing-location"
        ? "\u9019\u500b\u5730\u9ede\u6c92\u6709\u53ef\u7528\u7684\u5ea7\u6a19"
        : placesDetailsStatus === "error"
          ? "\u5730\u9ede\u8cc7\u6599\u66ab\u6642\u7121\u6cd5\u4f7f\u7528"
          : placesSearchStatus === "loading"
            ? "\u641c\u5c0b\u4e2d..."
            : placesSearchStatus === "empty"
              ? "\u627e\u4e0d\u5230\u7b26\u5408\u7684\u5730\u9ede"
              : placesSearchStatus === "error"
                ? "\u641c\u5c0b\u66ab\u6642\u7121\u6cd5\u4f7f\u7528"
                : "";
  const routeEditOverlayPanes = routeEditOverlayRect
    ? [
        { name: "top", style: { height: `${routeEditOverlayRect.top}px`, left: 0, right: 0, top: 0 } },
        {
          name: "bottom",
          style: { bottom: 0, height: `${routeEditOverlayRect.bottom}px`, left: 0, right: 0 },
        },
        {
          name: "left",
          style: {
            bottom: `${routeEditOverlayRect.bottom}px`,
            left: 0,
            top: `${routeEditOverlayRect.top}px`,
            width: `${routeEditOverlayRect.left}px`,
          },
        },
        {
          name: "right",
          style: {
            bottom: `${routeEditOverlayRect.bottom}px`,
            right: 0,
            top: `${routeEditOverlayRect.top}px`,
            width: `${routeEditOverlayRect.right}px`,
          },
        },
      ]
    : [];
  const routeEditOverlay =
    isRouteEditMode && routeEditOverlayPanes.length && typeof document !== "undefined"
      ? createPortal(
          routeEditOverlayPanes.map((pane) => (
            <button
              aria-label="離開路線編輯模式"
              className={`route-edit-page-overlay-pane ${pane.name}`}
              key={pane.name}
              style={pane.style}
              type="button"
              onClick={exitRouteEditMode}
            />
          )),
          document.body,
        )
      : null;

  const renderMapAreaTools = (extraClassName = "") => (
    <div className={`map-area-tools${extraClassName ? ` ${extraClassName}` : ""}`}>
      <button
        className={`mini-button map-route-edit-button${isRouteEditMode ? " active" : ""}`}
        type="button"
        title="編輯地圖路線"
        aria-label="編輯地圖路線"
        onClick={toggleRouteEditMode}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Route aria-hidden="true" />
      </button>
      {canPickMapPoint ? (
        <button
          className={`mini-button map-area-point-button${isPickingMapPoint ? " active" : ""}`}
          type="button"
          title={isPickingMapPoint ? "取消選點" : "在地圖選點新增景點"}
          aria-label={isPickingMapPoint ? "取消選點" : "在地圖選點新增景點"}
          disabled={isRouteEditMode}
          onClick={toggleMapAreaPointPick}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {isPickingMapPoint ? <X aria-hidden="true" /> : <MapPin aria-hidden="true" />}
        </button>
      ) : null}
    </div>
  );

  if (status === "failed" || renderFailed) {
    return <StaticMapProvider {...props} />;
  }

  return (
    <div
      className={`${className} google-map-surface${isPickingMapPoint ? " is-picking-map-point" : ""}${isRouteEditMode ? " is-route-edit-mode" : ""}`}
      aria-label="Google map destination markers"
    >
      {routeEditOverlay}
      <div className="google-map-canvas" ref={handleMapElementRef} />
      {!coordinateMarkers.length ? (
        <div className="google-map-empty-hint">This day has no coordinate markers yet</div>
      ) : null}
      {missingMapPointCount > 0 ? (
        <div className="map-point-warning">尚有 {missingMapPointCount} 個目的地缺少可用座標</div>
      ) : null}
      {isRouteEditMode ? (
        <div className="route-edit-mode-banner" role="status">
          {routeEditCollaboration.editorLabel || "路線編輯模式"}
        </div>
      ) : null}
      {routeOverrideSaveError ? (
        <div className="route-edit-save-error" role="status">
          {routeOverrideSaveError}
        </div>
      ) : null}
      {showPlacesSearchOverlay ? (
        <div
          className="places-search-overlay"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="places-search-row">
            <div className="places-search-control">
            <input
              autoComplete="off"
              className="places-search-input"
              disabled={isRouteEditMode || isPickingMapPoint}
              placeholder="搜尋地點"
              value={placesSearchInput}
              onChange={(event) => {
                setSelectedPlacePrediction(null);
                setPlacesDetailsStatus("idle");
                setPlacesSearchInput(event.target.value);
              }}
              onCompositionStart={() => {
                placesSearchComposingRef.current = true;
                setPlacesSearchIsComposing(true);
              }}
              onCompositionEnd={(event) => {
                placesSearchComposingRef.current = false;
                setPlacesSearchIsComposing(false);
                setPlacesSearchInput(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                if (placesSearchComposingRef.current || event.nativeEvent?.isComposing) return;
                event.preventDefault();
                void requestPlacesAutocomplete(placesSearchInput);
              }}
            />
            <button
              aria-label="搜尋地點"
              className="places-search-button"
              disabled={isRouteEditMode || isPickingMapPoint}
              type="button"
              onClick={() => {
                if (placesSearchComposingRef.current) return;
                void requestPlacesAutocomplete(placesSearchInput);
              }}
            >
              <Search aria-hidden="true" size={16} strokeWidth={2.2} />
            </button>
            </div>
            {renderMapAreaTools("in-search-row")}
          </div>
          {placesStatusMessage ? (
            <div className="places-search-message" role="status">
              {placesStatusMessage}
            </div>
          ) : null}
          {placesPredictions.length ? (
            <div className="places-prediction-list" role="listbox">
              {placesPredictions.map((prediction) => (
                <button
                  className={`places-prediction-option${selectedPlacePrediction?.id === prediction.id ? " selected" : ""}`}
                  disabled={placesDetailsStatus === "loading"}
                  key={prediction.id}
                  type="button"
                  onClick={() => void selectPlacePrediction(prediction)}
                >
                  <span>{prediction.mainText}</span>
                  {prediction.secondaryText ? <em>{prediction.secondaryText}</em> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {pendingPoi && pendingPoiHintPosition && !placesPreview && !isPickingMapPoint ? (
        <button
          className="places-pending-hint"
          type="button"
          style={{
            left: `${pendingPoiHintPosition.left}px`,
            top: `${pendingPoiHintPosition.top}px`,
          }}
          onClick={(event) => {
            event.stopPropagation();
            void confirmPendingPoi();
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {"\u9ede\u64ca\u52a0\u5165\u5730\u9ede"}
        </button>
      ) : null}
      {placesPreview ? (
        <div
          className={`places-preview-dialog anchored-${placesPreviewDialogPosition?.placement || "pending"}`}
          role="dialog"
          aria-label="\u78ba\u8a8d\u5730\u9ede"
          style={placesPreviewDialogPosition ? {
            left: `${placesPreviewDialogPosition.left}px`,
            top: `${placesPreviewDialogPosition.top}px`,
          } : undefined}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            className="places-preview-close"
            type="button"
            aria-label="\u95dc\u9589\u5730\u9ede\u9810\u89bd"
            onClick={cancelPlacesPreview}
          >
            x
          </button>
          <strong>{placesPreview.displayName || "\u9078\u53d6\u7684\u5730\u9ede"}</strong>
          <a
            className="places-preview-map-link"
            href={placesPreview.googleMapsUri || placesPreview.mapUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            {"\u5728 Google Map \u4e2d\u6aa2\u8996"}
          </a>
          <p>{"\u5df2\u53d6\u5f97\u5730\u9ede\u5ea7\u6a19"}</p>
          <button className="primary-button places-preview-add-button" type="button" onClick={confirmPlacesPreviewAdd}>
            {"\u52a0\u5165\u884c\u7a0b"}
          </button>
        </div>
      ) : null}
      <div className={`map-area-tools${showPlacesSearchOverlay ? " without-search-hidden" : " without-search"}`}>
        <button
          className={`mini-button map-route-edit-button${isRouteEditMode ? " active" : ""}`}
          type="button"
          title="編輯地圖路線"
          aria-label="編輯地圖路線"
          onClick={toggleRouteEditMode}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Route aria-hidden="true" />
        </button>
        {canPickMapPoint ? (
          <button
            className={`mini-button map-area-point-button${isPickingMapPoint ? " active" : ""}`}
            type="button"
            title={isPickingMapPoint ? "取消選點" : "在地圖選點新增景點"}
            aria-label={isPickingMapPoint ? "取消選點" : "在地圖選點新增景點"}
            disabled={isRouteEditMode}
            onClick={toggleMapAreaPointPick}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {isPickingMapPoint ? <X aria-hidden="true" /> : <MapPin aria-hidden="true" />}
          </button>
        ) : null}
      </div>      {mapPointPickFeedback ? (
        <div className="map-point-picker-hint">
          {mapPointPickFeedback === "picked"
            ? "\u5df2\u8a2d\u5b9a\u5730\u5716\u4f4d\u7f6e"
            : mapPickingMode === "map-add"
              ? "\u9ede\u64ca\u5730\u5716\u65b0\u589e\u5730\u9ede"
              : "\u9ede\u64ca\u5730\u5716\u8a2d\u5b9a\u4f4d\u7f6e"}
        </div>
      ) : null}
    </div>
  );
}
