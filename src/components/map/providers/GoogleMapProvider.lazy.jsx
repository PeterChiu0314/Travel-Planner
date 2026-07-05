import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import {
  createPlacesAutocompleteSessionManager,
  fetchPlaceDetailsForPrediction,
  fetchPlaceAutocompletePredictions,
} from "../../../lib/googlePlacesAdapter.js";
import { PLACE_DETAILS_FIELD_MASK_MINIMAL } from "../../../lib/googlePlacesConfig.js";
import { loadGoogleMapsApi } from "../../../lib/googleMapsLoader.js";
import { shouldLogMapProviderDiagnostics } from "../../../lib/mapProviderDiagnostics.js";
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
const DEFAULT_MARKER_LABEL_COLOR = "#1f2937";
const FOCUSED_MARKER_LABEL_COLOR = "#ffffff";

function googleMapsPointUrl(latitude, longitude) {
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}

function focusedMarkerIcon(mapsNamespace) {
  const symbolPath = mapsNamespace?.SymbolPath?.CIRCLE;
  if (!symbolPath) return null;
  return {
    path: symbolPath,
    fillColor: "#2f8f72",
    fillOpacity: 1,
    scale: 12,
    strokeColor: "#ffffff",
    strokeOpacity: 1,
    strokeWeight: 4,
  };
}

function markerSequenceNumber(marker, fallbackIndex) {
  const sequenceNumber = Number(marker?.sequenceNumber);
  return Number.isFinite(sequenceNumber) && sequenceNumber > 0 ? sequenceNumber : fallbackIndex + 1;
}

function markerLabel(marker, fallbackIndex, isFocusedMarker = false) {
  return {
    text: String(markerSequenceNumber(marker, fallbackIndex)),
    color: isFocusedMarker ? FOCUSED_MARKER_LABEL_COLOR : DEFAULT_MARKER_LABEL_COLOR,
    fontWeight: "800",
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

function coordinateKey(markers) {
  return markers
    .map((marker) => `${marker.id}:${marker.latitude}:${marker.longitude}:${marker.title || marker.locationName || ""}`)
    .join("|");
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
    onSelectPlaceDetails,
    onStartMapPointPick,
    providerConfig = {},
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
  const placesPreviewMarkerRef = useRef(null);
  const placesPreviewOverlayRef = useRef(null);
  const pendingPoiMarkerRef = useRef(null);
  const pendingPoiHintOverlayRef = useRef(null);
  const routeLineRef = useRef(null);
  const viewportListenersRef = useRef([]);
  const mapPointClickListenerRef = useRef(null);
  const viewportSuppressionTimerRef = useRef(null);
  const suppressViewportChangeRef = useRef(false);
  const userChangedViewportRef = useRef(false);
  const autoViewportSignatureRef = useRef(null);
  const placesSearchComposingRef = useRef(false);
  const placesAutocompleteRequestSeqRef = useRef(0);
  const lastRequestedPlacesQueryRef = useRef("");
  const [status, setStatus] = useState("idle");
  const [containerReady, setContainerReady] = useState(false);
  const [loadAttempted, setLoadAttempted] = useState(false);
  const [loadSucceeded, setLoadSucceeded] = useState(false);
  const [mapCreated, setMapCreated] = useState(false);
  const [placesReady, setPlacesReady] = useState(false);
  const [placesSearchInput, setPlacesSearchInput] = useState("");
  const [placesSearchIsComposing, setPlacesSearchIsComposing] = useState(false);
  const [placesPredictions, setPlacesPredictions] = useState([]);
  const [selectedPlacePrediction, setSelectedPlacePrediction] = useState(null);
  const [pendingPoi, setPendingPoi] = useState(null);
  const [pendingPoiHintPosition, setPendingPoiHintPosition] = useState(null);
  const [placesPreview, setPlacesPreview] = useState(null);
  const [placesPreviewDialogPosition, setPlacesPreviewDialogPosition] = useState(null);
  const [placesSearchStatus, setPlacesSearchStatus] = useState("idle");
  const [placesDetailsStatus, setPlacesDetailsStatus] = useState("idle");
  const [renderFailed, setRenderFailed] = useState(false);
  const [fallbackReason, setFallbackReason] = useState(null);
  const markersKey = coordinateKey(coordinateMarkers);
  const viewportSignature = `${viewportKey}:${markersKey}`;
  const apiKey = typeof providerConfig.apiKey === "string" ? providerConfig.apiKey.trim() : "";
  const placesLibraries = Array.isArray(providerConfig.placesLibraries) ? providerConfig.placesLibraries : [];
  const canSearchPlaces = status === "ready" && providerConfig.placesEnabled === true && placesReady && !isPickingMapPoint;

  const handleMapElementRef = useCallback((element) => {
    mapElementRef.current = element;
    setContainerReady(Boolean(element));
  }, []);

  function markUserViewportChange() {
    if (!suppressViewportChangeRef.current) {
      userChangedViewportRef.current = true;
    }
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
    ];
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
    const selectedPlaceText = prediction.description || prediction.mainText || "";
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
      lastRequestedPlacesQueryRef.current = selectedPlaceText.trim();
      setPlacesSearchInput(selectedPlaceText);
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
    if (!canPickMapPoint) return;
    clearPendingPoi();
    clearPlacesPreview();
    resetPlacesSearch();
    if (isPickingMapPoint) {
      onCancelMapPointPick?.();
      return;
    }
    onStartMapPointPick?.(hasActiveMapPointEditor ? "editor" : "map-add");
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

      routeLineRef.current?.setMap(null);
      routeLineRef.current = null;
      markerInstancesRef.current.forEach((marker) => marker.setMap(null));
      markerInstancesRef.current = new Map();

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
          routeLineRef.current?.setMap(null);
          routeLineRef.current = null;
          markerInstancesRef.current.forEach((marker) => marker.setMap(null));
          markerInstancesRef.current = new Map();
        };
      }

      const bounds = new BoundsConstructor();
      coordinateMarkers.forEach((marker, index) => {
        const position = { lat: marker.latitude, lng: marker.longitude };
        const googleMarker = new MarkerConstructor({
          map: mapRef.current,
          position,
          title: marker.title || marker.locationName || "",
          label: markerLabel(marker, index),
          zIndex: index + 1,
        });

        googleMarker.addListener("click", () => {
          if (!isPickingMapPoint) onFocusItem?.(marker.itemId);
        });
        markerInstancesRef.current.set(marker.id, googleMarker);
        bounds.extend(position);
      });

      if (coordinateMarkers.length > 1 && mapsNamespace?.Polyline) {
        routeLineRef.current = new mapsNamespace.Polyline({
          clickable: false,
          geodesic: false,
          map: mapRef.current,
          path: coordinateMarkers.map((marker) => ({ lat: marker.latitude, lng: marker.longitude })),
          strokeColor: "#2f8f72",
          strokeOpacity: 0.7,
          strokeWeight: 3,
          zIndex: 10,
        });
      }

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
      routeLineRef.current?.setMap(null);
      routeLineRef.current = null;
      markerInstancesRef.current.forEach((marker) => marker.setMap(null));
      markerInstancesRef.current = new Map();
    };
  }, [isPickingMapPoint, markersKey, onFocusItem, status, viewportSignature]);

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

    const mapsNamespace = window.google?.maps;
    const focusIcon = focusedMarkerIcon(mapsNamespace);

    markerInstancesRef.current.forEach((marker, markerId) => {
      const markerIndex = coordinateMarkers.findIndex((candidate) => candidate.id === markerId);
      const markerRecord = markerIndex >= 0 ? coordinateMarkers[markerIndex] : null;
      const isFocusedMarker = focusedMapState.focusedMarkerId === markerId;
      marker.setZIndex(isFocusedMarker ? 1000 : Math.max(markerIndex + 1, 1));
      marker.setIcon(isFocusedMarker ? focusIcon : null);
      marker.setLabel(markerLabel(markerRecord, markerIndex >= 0 ? markerIndex : 0, isFocusedMarker));
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
  }, [focusedMapState.focusedMarkerId, isPickingMapPoint, markersKey, status]);

  useEffect(() => {
    if (mapPointClickListenerRef.current) {
      mapPointClickListenerRef.current.remove?.();
      mapPointClickListenerRef.current = null;
    }
    if (status !== "ready" || !mapRef.current) return undefined;

    mapPointClickListenerRef.current = mapRef.current.addListener("click", (event) => {
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
  }, [isPickingMapPoint, onPickMapPoint, pendingPoi, placesPreview, status]);

  useEffect(() => {
    clearPendingPoi();
    clearPlacesPreview();
    setPlacesPredictions([]);
    setPlacesSearchStatus("idle");
  }, [isPickingMapPoint, viewportKey]);

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

  if (status === "failed" || renderFailed) {
    return <StaticMapProvider {...props} />;
  }

  return (
    <div
      className={`${className} google-map-surface${isPickingMapPoint ? " is-picking-map-point" : ""}`}
      aria-label="Google map destination markers"
    >
      <div className="google-map-canvas" ref={handleMapElementRef} />
      {!coordinateMarkers.length ? (
        <div className="google-map-empty-hint">This day has no coordinate markers yet</div>
      ) : null}
      {missingMapPointCount > 0 ? (
        <div className="map-point-warning">尚有 {missingMapPointCount} 個目的地缺少可用座標</div>
      ) : null}
      {canSearchPlaces ? (
        <div
          className="places-search-overlay"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="places-search-control">
            <input
              autoComplete="off"
              className="places-search-input"
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
              type="button"
              onClick={() => {
                if (placesSearchComposingRef.current) return;
                void requestPlacesAutocomplete(placesSearchInput);
              }}
            >
              <Search aria-hidden="true" size={16} strokeWidth={2.2} />
            </button>
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
      {canPickMapPoint ? (
        <button
          className={`mini-button map-area-point-button${isPickingMapPoint ? " active" : ""}`}
          type="button"
          title={isPickingMapPoint ? "\u53d6\u6d88\u9078\u9ede" : hasActiveMapPointEditor ? "\u8a2d\u5b9a\u4f4d\u7f6e" : "\u65b0\u589e\u5730\u9ede"}
          aria-label={isPickingMapPoint ? "\u53d6\u6d88\u9078\u9ede" : hasActiveMapPointEditor ? "\u8a2d\u5b9a\u4f4d\u7f6e" : "\u65b0\u589e\u5730\u9ede"}
          onClick={toggleMapAreaPointPick}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {isPickingMapPoint ? <span aria-hidden="true">x</span> : <span aria-hidden="true">+</span>}
          <span>
            {isPickingMapPoint ? "\u53d6\u6d88" : hasActiveMapPointEditor ? "\u8a2d\u5b9a\u4f4d\u7f6e" : "\u65b0\u589e\u5730\u9ede"}
          </span>
        </button>
      ) : null}
      {mapPointPickFeedback ? (
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
