import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
const PLACES_AUTOCOMPLETE_DEBOUNCE_MS = 350;
const DEFAULT_MARKER_LABEL_COLOR = "#1f2937";
const FOCUSED_MARKER_LABEL_COLOR = "#ffffff";

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
  const markerInstancesRef = useRef(new Map());
  const routeLineRef = useRef(null);
  const viewportListenersRef = useRef([]);
  const mapPointClickListenerRef = useRef(null);
  const viewportSuppressionTimerRef = useRef(null);
  const suppressViewportChangeRef = useRef(false);
  const userChangedViewportRef = useRef(false);
  const autoViewportSignatureRef = useRef(null);
  const [status, setStatus] = useState("idle");
  const [containerReady, setContainerReady] = useState(false);
  const [loadAttempted, setLoadAttempted] = useState(false);
  const [loadSucceeded, setLoadSucceeded] = useState(false);
  const [mapCreated, setMapCreated] = useState(false);
  const [placesReady, setPlacesReady] = useState(false);
  const [placesSearchInput, setPlacesSearchInput] = useState("");
  const [placesPredictions, setPlacesPredictions] = useState([]);
  const [selectedPlacePrediction, setSelectedPlacePrediction] = useState(null);
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
    setPlacesPredictions([]);
    setSelectedPlacePrediction(null);
    setPlacesSearchStatus("idle");
    setPlacesDetailsStatus("idle");
    placesSessionManagerRef.current.resetSessionToken();
  }

  async function selectPlacePrediction(prediction) {
    if (!prediction?.id) return;
    setSelectedPlacePrediction(prediction);
    setPlacesSearchInput(prediction.description || prediction.mainText);
    setPlacesPredictions([]);
    setPlacesSearchStatus("idle");
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
      const latitude = Number(details?.latitude);
      const longitude = Number(details?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        setPlacesDetailsStatus("missing-location");
        return;
      }
      onSelectPlaceDetails?.({
        displayName: details.displayName || prediction.mainText || prediction.description || "",
        googleMapsUri: details.googleMapsUri || "",
        id: details.id || prediction.id,
        latitude,
        longitude,
      });
      setPlacesDetailsStatus("idle");
      resetPlacesSearch();
    } catch {
      setPlacesDetailsStatus("error");
    } finally {
      placesSessionManagerRef.current.resetSessionToken();
    }
  }

  function toggleMapAreaPointPick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!canPickMapPoint) return;
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

    const input = placesSearchInput.trim();
    if (input.length < 2) {
      setPlacesPredictions([]);
      setPlacesSearchStatus("idle");
      return undefined;
    }

    let cancelled = false;
    setPlacesSearchStatus("loading");
    const timerId = window.setTimeout(() => {
      let sessionToken;
      try {
        sessionToken = placesSessionManagerRef.current.getOrCreateSessionToken();
      } catch {
        if (!cancelled) {
          setPlacesPredictions([]);
          setPlacesSearchStatus("error");
        }
        return;
      }

      fetchPlaceAutocompletePredictions({
        input,
        placesApi: placesLibraryRef.current,
        sessionToken,
      })
        .then((predictions) => {
          if (cancelled) return;
          setPlacesPredictions(predictions);
          setPlacesSearchStatus(predictions.length ? "ready" : "empty");
        })
        .catch(() => {
          if (cancelled) return;
          setPlacesPredictions([]);
          setPlacesSearchStatus("error");
        });
    }, PLACES_AUTOCOMPLETE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [canSearchPlaces, placesSearchInput]);

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
          clickableIcons: false,
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
    if (status !== "ready" || !mapRef.current || !isPickingMapPoint) return undefined;

    mapPointClickListenerRef.current = mapRef.current.addListener("click", (event) => {
      const latLng = event?.latLng;
      const latitude = typeof latLng?.lat === "function" ? latLng.lat() : null;
      const longitude = typeof latLng?.lng === "function" ? latLng.lng() : null;
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        onPickMapPoint?.({ latitude, longitude });
      }
    });

    return () => {
      mapPointClickListenerRef.current?.remove?.();
      mapPointClickListenerRef.current = null;
    };
  }, [isPickingMapPoint, onPickMapPoint, status]);

  useEffect(() => () => {
    if (viewportSuppressionTimerRef.current) {
      window.clearTimeout(viewportSuppressionTimerRef.current);
    }
    viewportListenersRef.current.forEach((listener) => listener.remove?.());
    viewportListenersRef.current = [];
    routeLineRef.current?.setMap(null);
    routeLineRef.current = null;
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
          <input
            autoComplete="off"
            className="places-search-input"
            placeholder="\u641c\u5c0b\u5730\u9ede..."
            value={placesSearchInput}
            onChange={(event) => {
              setSelectedPlacePrediction(null);
              setPlacesSearchInput(event.target.value);
            }}
          />
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
