import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadGoogleMapsApi } from "../../../lib/googleMapsLoader.js";
import { shouldLogMapProviderDiagnostics } from "../../../lib/mapProviderDiagnostics.js";
import StaticMapProvider from "./StaticMapProvider.jsx";

const DEFAULT_CENTER = { lat: 35.0116, lng: 135.7681 };
const DEFAULT_ZOOM = 11;

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
  const { className = "route-map", focusedMapState = {}, markers = [], onFocusItem, providerConfig = {} } = props;
  const coordinateMarkers = useMemo(() => markers.filter((marker) => marker.hasCoordinates), [markers]);
  const mapElementRef = useRef(null);
  const mapRef = useRef(null);
  const mapsLibraryRef = useRef(null);
  const markerInstancesRef = useRef(new Map());
  const [status, setStatus] = useState("idle");
  const [containerReady, setContainerReady] = useState(false);
  const [loadAttempted, setLoadAttempted] = useState(false);
  const [loadSucceeded, setLoadSucceeded] = useState(false);
  const [mapCreated, setMapCreated] = useState(false);
  const [renderFailed, setRenderFailed] = useState(false);
  const [fallbackReason, setFallbackReason] = useState(null);
  const markersKey = coordinateKey(coordinateMarkers);
  const apiKey = typeof providerConfig.apiKey === "string" ? providerConfig.apiKey.trim() : "";

  const handleMapElementRef = useCallback((element) => {
    mapElementRef.current = element;
    setContainerReady(Boolean(element));
  }, []);

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

    loadGoogleMapsApi({ apiKey })
      .then((mapsLibrary) => {
        if (cancelled) return;
        mapsLibraryRef.current = mapsLibrary;
        setLoadSucceeded(true);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setLoadSucceeded(false);
          setFallbackReason("loader-failure");
          setStatus("failed");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apiKey, containerReady]);

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
        setMapCreated(true);
      }

      markerInstancesRef.current.forEach((marker) => marker.setMap(null));
      markerInstancesRef.current = new Map();

      if (!coordinateMarkers.length) {
        mapRef.current.setCenter(DEFAULT_CENTER);
        mapRef.current.setZoom(DEFAULT_ZOOM);
        setRenderFailed(false);
        setFallbackReason(null);
        return () => {
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
          label: String(index + 1),
          zIndex: focusedMapState.focusedMarkerId === marker.id ? 1000 : index + 1,
        });

        googleMarker.addListener("click", () => onFocusItem?.(marker.itemId));
        markerInstancesRef.current.set(marker.id, googleMarker);
        bounds.extend(position);
      });

      if (coordinateMarkers.length === 1) {
        mapRef.current.setCenter(initialCenter);
        mapRef.current.setZoom(14);
      } else {
        mapRef.current.fitBounds(bounds);
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
    };
  }, [coordinateMarkers, focusedMapState.focusedMarkerId, markersKey, onFocusItem, status]);

  useEffect(() => {
    if (status !== "ready" || !mapRef.current) return;

    markerInstancesRef.current.forEach((marker, markerId) => {
      marker.setZIndex(focusedMapState.focusedMarkerId === markerId ? 1000 : 1);
    });

    const focusedMarker = focusedMapState.focusedMarkerId
      ? markerInstancesRef.current.get(focusedMapState.focusedMarkerId)
      : null;

    if (focusedMarker?.getPosition) {
      mapRef.current.panTo(focusedMarker.getPosition());
    }
  }, [focusedMapState.focusedMarkerId, status]);

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
  ]);

  if (status === "failed" || renderFailed) {
    return <StaticMapProvider {...props} />;
  }

  return (
    <div className={`${className} google-map-surface`} aria-label="Google map destination markers">
      <div className="google-map-canvas" ref={handleMapElementRef} />
      {!coordinateMarkers.length ? (
        <div className="google-map-empty-hint">This day has no coordinate markers yet</div>
      ) : null}
    </div>
  );
}
