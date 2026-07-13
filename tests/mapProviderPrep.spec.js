import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { getGoogleMapsLoaderErrorMetadata, loadGoogleMapsApi } from "../src/lib/googleMapsLoader.js";
import { buildMapProviderAdapterInput } from "../src/lib/mapProviderAdapter.js";
import { getMapProviderConfig, MAP_PROVIDER_IDS } from "../src/lib/mapProviderConfig.js";
import {
  buildMapProviderDiagnostics,
  shouldLogMapProviderDiagnostics,
} from "../src/lib/mapProviderDiagnostics.js";
import {
  MAX_CUSTOM_ROUTE_POINTS_PER_SEGMENT,
  routeOverrideSegmentKey,
  routeOverridesToSegmentMap,
  validRouteSegmentKeysFromItems,
  validRouteSegmentKeysFromStops,
} from "../src/lib/routeOverrides.js";

const repoRoot = process.cwd();

function readRepoFile(filePath) {
  return fs.readFileSync(path.join(repoRoot, filePath), "utf8");
}

test("Phase 4.9c keeps the default map provider static and Google lazy-only", () => {
  expect(getMapProviderConfig()).toEqual({
    mode: "formal",
    providerId: MAP_PROVIDER_IDS.STATIC,
    requestedProviderId: MAP_PROVIDER_IDS.STATIC,
    loadMode: "eager",
    canLoadRealMap: false,
    apiKeyAvailable: false,
    apiKey: "",
    placesEnabled: false,
    placesLibraries: [],
    fallbackReason: null,
    fallbackProviderId: MAP_PROVIDER_IDS.STATIC,
  });

  expect(getMapProviderConfig({ providerId: MAP_PROVIDER_IDS.GOOGLE })).toMatchObject({
    mode: "formal",
    providerId: MAP_PROVIDER_IDS.GOOGLE,
    loadMode: "lazy",
    canLoadRealMap: false,
    fallbackProviderId: MAP_PROVIDER_IDS.STATIC,
  });
});

test("Phase 5.1a forces Demo map provider config to static", () => {
  expect(
    getMapProviderConfig({
      mode: "demo",
      providerId: MAP_PROVIDER_IDS.GOOGLE,
      enableRealMap: true,
    }),
  ).toEqual({
    mode: "demo",
    providerId: MAP_PROVIDER_IDS.STATIC,
    requestedProviderId: MAP_PROVIDER_IDS.GOOGLE,
    loadMode: "eager",
    canLoadRealMap: false,
    apiKeyAvailable: false,
    placesEnabled: false,
    placesLibraries: [],
    fallbackReason: "demo-static",
    fallbackProviderId: MAP_PROVIDER_IDS.STATIC,
  });
});

test("Phase 5.1b keeps Formal Google provider behind API key availability", () => {
  expect(
    getMapProviderConfig({
      mode: "formal",
      providerId: MAP_PROVIDER_IDS.GOOGLE,
      enableRealMap: true,
    }),
  ).toMatchObject({
    mode: "formal",
    providerId: MAP_PROVIDER_IDS.GOOGLE,
    canLoadRealMap: false,
    apiKeyAvailable: false,
    fallbackReason: "missing-api-key",
  });

  expect(
    getMapProviderConfig({
      mode: "formal",
      providerId: MAP_PROVIDER_IDS.GOOGLE,
      enableRealMap: true,
      apiKey: "fake-test-key",
    }),
  ).toMatchObject({
    mode: "formal",
    providerId: MAP_PROVIDER_IDS.GOOGLE,
    loadMode: "lazy",
    canLoadRealMap: true,
    apiKeyAvailable: true,
    fallbackReason: null,
  });

  expect(getMapProviderConfig({ mode: "formal", providerId: "unknown" })).toMatchObject({
    providerId: MAP_PROVIDER_IDS.STATIC,
    canLoadRealMap: false,
  });
});

test("Phase 5.1d normalizes provider and mode env-style values", () => {
  ["google", "google ", " GOOGLE "].forEach((providerId) => {
    expect(
      getMapProviderConfig({
        mode: " FORMAL ",
        providerId,
        enableRealMap: true,
        apiKey: " fake-test-key ",
      }),
    ).toMatchObject({
      mode: "formal",
      providerId: MAP_PROVIDER_IDS.GOOGLE,
      requestedProviderId: MAP_PROVIDER_IDS.GOOGLE,
      canLoadRealMap: true,
      apiKeyAvailable: true,
      fallbackReason: null,
    });
  });

  expect(
    getMapProviderConfig({
      mode: " DEMO ",
      providerId: " GOOGLE ",
      enableRealMap: true,
      apiKey: "fake-test-key",
    }),
  ).toMatchObject({
    mode: "demo",
    providerId: MAP_PROVIDER_IDS.STATIC,
    requestedProviderId: MAP_PROVIDER_IDS.GOOGLE,
    canLoadRealMap: false,
    fallbackReason: "demo-static",
  });
});

test("Phase 5.1d logs gated map provider diagnostics without exposing API keys", () => {
  expect(shouldLogMapProviderDiagnostics("?debugMap=1")).toBe(true);
  expect(shouldLogMapProviderDiagnostics("?debugMap=0")).toBe(false);
  expect(shouldLogMapProviderDiagnostics("?other=1")).toBe(false);

  const providerConfig = getMapProviderConfig({
    mode: "formal",
    providerId: " GOOGLE ",
    enableRealMap: true,
    apiKey: "secret-test-key",
  });
  const diagnostics = buildMapProviderDiagnostics(providerConfig);

  expect(diagnostics).toEqual({
    mode: "formal",
    requestedProvider: MAP_PROVIDER_IDS.GOOGLE,
    resolvedProvider: MAP_PROVIDER_IDS.GOOGLE,
    hasGoogleMapsKey: true,
    shouldUseGoogleProvider: true,
    fallbackReason: null,
  });
  expect(JSON.stringify(diagnostics)).not.toContain("secret-test-key");

  expect(buildMapProviderDiagnostics(providerConfig, { loaderFailed: true })).toMatchObject({
    resolvedProvider: MAP_PROVIDER_IDS.STATIC,
    shouldUseGoogleProvider: false,
    fallbackReason: "loader-failure",
  });
});

test("Phase 5.1d Formal Google provider path does not depend on route markers", () => {
  const providerConfig = getMapProviderConfig({
    mode: "formal",
    providerId: MAP_PROVIDER_IDS.GOOGLE,
    enableRealMap: true,
    apiKey: "fake-test-key",
  });
  const adapterInput = buildMapProviderAdapterInput({ markers: [] });

  expect(adapterInput.markers).toEqual([]);
  expect(providerConfig).toMatchObject({
    mode: "formal",
    providerId: MAP_PROVIDER_IDS.GOOGLE,
    canLoadRealMap: true,
    fallbackReason: null,
  });
  expect(buildMapProviderDiagnostics(providerConfig)).toMatchObject({
    resolvedProvider: MAP_PROVIDER_IDS.GOOGLE,
    shouldUseGoogleProvider: true,
  });
});

test("Phase 5.1b Google Maps loader fails safely without an API key", async () => {
  await expect(loadGoogleMapsApi()).rejects.toThrow("Missing Google Maps API key");
});

test("Phase 5.1d Google Maps loader uses basic Maps library and safe diagnostics", () => {
  const loaderSource = readRepoFile("src/lib/googleMapsLoader.js");
  const secretKey = "secret-test-key";
  const metadata = getGoogleMapsLoaderErrorMetadata({
    name: "TypeError",
    message: `Failed to fetch https://maps.googleapis.com/maps/api/js?key=${secretKey}&v=weekly`,
    code: "ERR_TEST",
    stack: `TypeError: Failed to fetch https://maps.googleapis.com/maps/api/js?key=${secretKey}&v=weekly\n    at sw.js:42`,
  });

  expect(loaderSource).toContain("setOptions");
  expect(loaderSource).toContain('importLibrary("maps")');
  expect(loaderSource).toContain("libraries = []");
  expect(loaderSource).toContain("normalizeLibraries");
  expect(loaderSource).not.toContain("new Loader");
  expect(loaderSource).not.toContain('importLibrary("places")');
  expect(loaderSource).not.toContain('importLibrary("routes")');
  expect(loaderSource).not.toContain('importLibrary("geocoding")');
  expect(loaderSource).toContain("[GoogleMapsLoader] diagnostics");
  expect(loaderSource).toContain("shouldLogMapProviderDiagnostics(search)");
  expect(metadata).toMatchObject({
    name: "TypeError",
    code: "ERR_TEST",
  });
  expect(JSON.stringify(metadata)).not.toContain(secretKey);
  expect(metadata.message).toContain("key=[redacted]");
  expect(metadata.stackFirstLine).toContain("key=[redacted]");
});

test("Phase 5.1d service worker leaves Google Maps external loading network-only", () => {
  const serviceWorkerSource = readRepoFile("public/sw.js");

  expect(serviceWorkerSource).toContain('"maps.googleapis.com"');
  expect(serviceWorkerSource).toContain('"maps.gstatic.com"');
  expect(serviceWorkerSource).toContain("if (isGoogleMapsRequest(url)) return");
  expect(serviceWorkerSource).toContain("if (url.origin !== self.location.origin) return");
  expect(serviceWorkerSource).toContain("caches.match(request)");
});

test("Phase 4.9c adapter passes provider-neutral marker and focus input", () => {
  const marker = { id: "map-marker:visit-a", itemId: "visit-a", latitude: 35, longitude: 135 };
  const onFocusItem = () => {};
  const adapterInput = buildMapProviderAdapterInput({
    markers: [marker],
    focusedMapState: {
      focusedItemId: "visit-a",
      focusedItemType: "destination",
      focusedMarkerId: "map-marker:visit-a",
      transportEndpointMarkerIds: { fromMarkerId: null, toMarkerId: null, markerIds: [] },
    },
    onFocusItem,
  });

  expect(adapterInput).toMatchObject({
    markers: [marker],
    focusedItemId: "visit-a",
    focusedItemType: "destination",
    focusedMarkerId: "map-marker:visit-a",
    transportEndpointMarkerIds: { markerIds: [] },
  });
  expect(adapterInput.onMarkerFocus).toBe(onFocusItem);
  expect(JSON.stringify(adapterInput).toLowerCase()).not.toContain("google");
});

test("Phase 5.1c keeps Google code isolated to the lazy provider and rejects unapproved map packages", () => {
  const appSource = readRepoFile("src/App.jsx");
  const packageJson = readRepoFile("package.json");
  const mapPanelSource = readRepoFile("src/components/map/MapPanel.jsx");
  const googleProviderSource = readRepoFile("src/components/map/providers/GoogleMapProvider.lazy.jsx");

  expect(mapPanelSource).toContain('import("./providers/GoogleMapProvider.lazy.jsx")');
  expect(appSource).not.toContain("VITE_GOOGLE_MAPS_API_KEY");
  expect(appSource).not.toContain("@googlemaps");
  expect(appSource).not.toContain("google.maps");
  expect(mapPanelSource).not.toContain("@googlemaps");
  expect(mapPanelSource).not.toContain("google.maps");
  expect(googleProviderSource).toContain("loadGoogleMapsApi");
  expect(googleProviderSource).toContain("window.google?.maps");
  expect(packageJson).toContain("@googlemaps/js-api-loader");
  expect(packageJson).not.toContain("@react-google-maps");
  expect(packageJson).not.toContain("leaflet");
  expect(packageJson).not.toContain("maplibre");
});

test("Phase 5.1c Google provider stays markers-only and provider-neutral", () => {
  const googleProviderSource = readRepoFile("src/components/map/providers/GoogleMapProvider.lazy.jsx");

  expect(googleProviderSource).toContain("marker.hasCoordinates");
  expect(googleProviderSource).toContain("new MapConstructor");
  expect(googleProviderSource).toContain("new MarkerConstructor");
  expect(googleProviderSource).toContain("onFocusItem?.(marker.itemId)");
  expect(googleProviderSource).toContain("marker.setMap(null)");
  expect(googleProviderSource).toContain("fitBounds");
  expect(googleProviderSource).toContain("panTo");
  expect(googleProviderSource).not.toContain("Directions");
  expect(googleProviderSource).not.toContain("Routes");
  expect(googleProviderSource).not.toContain("fetchFields");
  expect(googleProviderSource).not.toContain("normalizePlaceDetailsResult");
  expect(googleProviderSource).not.toContain("Geocoding");
  expect(googleProviderSource).not.toContain("AdvancedMarkerElement");
});

test("Phase 5.1d Google provider keeps base map for empty or no-coordinate days", () => {
  const googleProviderSource = readRepoFile("src/components/map/providers/GoogleMapProvider.lazy.jsx");

  expect(googleProviderSource).toContain("DEFAULT_ZOOM");
  expect(googleProviderSource).toContain("This day has no coordinate markers yet");
  expect(googleProviderSource).toContain("!coordinateMarkers.length");
  expect(googleProviderSource).toContain("mapRef.current.setCenter(DEFAULT_CENTER)");
  expect(googleProviderSource).not.toContain("renderFailed || !coordinateMarkers.length");
});

test("Phase 5.1d Google provider attempts loader from its own ready container", () => {
  const googleProviderSource = readRepoFile("src/components/map/providers/GoogleMapProvider.lazy.jsx");

  expect(googleProviderSource).toContain('const [status, setStatus] = useState("idle")');
  expect(googleProviderSource).toContain("const [containerReady, setContainerReady] = useState(false)");
  expect(googleProviderSource).toContain("if (!containerReady) return undefined");
  expect(googleProviderSource).toContain("loadGoogleMapsApi({ apiKey, libraries: placesLibraries })");
  expect(googleProviderSource).toContain("setLoadAttempted(true)");
  expect(googleProviderSource).toContain("setLoadSucceeded(true)");
  expect(googleProviderSource).toContain("setMapCreated(true)");
  expect(googleProviderSource).not.toContain('if (status !== "ready")');
});

test("Phase 5.1d Google provider diagnostics are gated and key-safe", () => {
  const googleProviderSource = readRepoFile("src/components/map/providers/GoogleMapProvider.lazy.jsx");

  expect(googleProviderSource).toContain('console.info("[GoogleMapProvider] diagnostics"');
  expect(googleProviderSource).toContain("hasApiKey: Boolean(apiKey)");
  expect(googleProviderSource).toContain("totalMarkers: markers.length");
  expect(googleProviderSource).toContain("coordinateMarkers: coordinateMarkers.length");
  expect(googleProviderSource).toContain("containerReady");
  expect(googleProviderSource).toContain("loadAttempted");
  expect(googleProviderSource).toContain("loadSucceeded");
  expect(googleProviderSource).toContain("mapCreated");
  expect(googleProviderSource).toContain("fallbackReason");
  expect(googleProviderSource).not.toContain("apiKey:");
});

test("Phase 5.1e Google map layout fills the route map surface", () => {
  const stylesSource = readRepoFile("src/styles.css");

  expect(stylesSource).toContain(".google-map-surface");
  expect(stylesSource).toContain("display: grid");
  expect(stylesSource).toContain(".google-map-canvas");
  expect(stylesSource).toContain("position: absolute");
  expect(stylesSource).toContain("inset: 0");
  expect(stylesSource).toContain("width: 100%");
  expect(stylesSource).toContain("height: 100%");
  expect(stylesSource).toContain(".google-map-canvas .gm-style");
  expect(stylesSource).toContain(".timeline-workbench .side-panels > .route-panel > .google-map-surface");
  expect(stylesSource).toContain("inset: 0");
  expect(stylesSource).toContain(".google-map-empty-hint");
  expect(stylesSource).toContain("pointer-events: none");
  expect(stylesSource).toContain(".route-map");
  expect(stylesSource).toContain("min-height: 220px");
});

test("Phase 5.2 map point warning overlays without resizing the map canvas", () => {
  const appSource = readRepoFile("src/App.jsx");
  const mapPanelSource = readRepoFile("src/components/map/MapPanel.jsx");
  const googleProviderSource = readRepoFile("src/components/map/providers/GoogleMapProvider.lazy.jsx");
  const staticProviderSource = readRepoFile("src/components/map/providers/StaticMapProvider.jsx");
  const stylesSource = readRepoFile("src/styles.css");

  expect(appSource).toContain("countMissingMapPoints(dayItems)");
  expect(mapPanelSource).toContain("missingMapPointCount = 0");
  expect(googleProviderSource).toContain("missingMapPointCount > 0");
  expect(staticProviderSource).toContain("missingMapPointCount > 0");
  expect(stylesSource).toContain(".map-point-warning");
  expect(stylesSource).toContain("position: absolute");
  expect(stylesSource).toContain("pointer-events: none");
  expect(stylesSource).toContain(".google-map-canvas");
  expect(stylesSource).toContain("height: 100%");
});

test("Phase 5.2 map URL parsing is wired into hidden coordinate persistence only", () => {
  const appSource = readRepoFile("src/App.jsx");

  expect(appSource).toContain("normalizeMapPointFields(payload)");
  expect(appSource).toContain("latitude: mapPointFields.latitude");
  expect(appSource).toContain("longitude: mapPointFields.longitude");
  expect(appSource).not.toContain('name="latitude"');
  expect(appSource).not.toContain('name="longitude"');
});

test("Phase 5.2b destination editor blocks invalid Map URLs with label-level feedback", () => {
  const appSource = readRepoFile("src/App.jsx");
  const mapPointSource = readRepoFile("src/lib/mapPoint.js");
  const stylesSource = readRepoFile("src/styles.css");

  expect(appSource).toContain("resolveDestinationMapUrlPoint(submittedForm.map_url");
  expect(appSource).toContain('const [mapUrlError, setMapUrlError] = useState("")');
  expect(appSource).toContain("setMapUrlError(mapUrlValidation.errorMessage)");
  expect(appSource).toContain("setForm(submittedForm)");
  expect(appSource).toContain("return false");
  expect(appSource).toContain("field-label-row");
  expect(appSource).toContain("field-inline-error");
  expect(mapPointSource).toContain("請貼上有效 Map URL");
  expect(mapPointSource).toContain("無法取得有效點位");
  expect(stylesSource).toContain(".field-label-row");
  expect(stylesSource).toContain("justify-content: space-between");
  expect(stylesSource).toContain(".field-inline-error");
});

test("Phase 5.2c Google Maps short-link resolver is edge-only and host-limited", () => {
  const appSource = readRepoFile("src/App.jsx");
  const mapPointSource = readRepoFile("src/lib/mapPoint.js");
  const resolverSource = readRepoFile("src/lib/googleMapsShortLinkResolver.js");
  const edgeFunctionSource = readRepoFile("supabase/functions/resolve-google-maps-url/index.ts");
  const packageJson = readRepoFile("package.json");

  expect(mapPointSource).toContain("isGoogleMapsShortUrl");
  expect(mapPointSource).toContain('hostname === "maps.app.goo.gl"');
  expect(mapPointSource).toContain('hostname === "goo.gl"');
  expect(mapPointSource).toContain('startsWith("/maps")');
  expect(appSource).toContain("resolveGoogleMapsShortUrl");
  expect(appSource).toContain("setIsResolvingMapUrl(true)");
  expect(appSource).toContain("mapUrlValidation.resolvedByShortLink");
  expect(appSource).toContain("submittedForm.map_url = mapUrlValidation.expandedUrl");
  expect(resolverSource).toContain('GOOGLE_MAPS_SHORT_LINK_FUNCTION = "resolve-google-maps-url"');
  expect(resolverSource).toContain("supabase.functions.invoke");
  expect(edgeFunctionSource).toContain('allowedShortHosts = new Set(["maps.app.goo.gl"])');
  expect(edgeFunctionSource).toContain('"maps.google.com"');
  expect(edgeFunctionSource).toContain('redirect: "manual"');
  expect(edgeFunctionSource).toContain("isAllowedFetchUrl(currentUrl)");
  expect(edgeFunctionSource).not.toContain("service_role");
  expect(edgeFunctionSource).not.toContain("Deno.env");
  expect(packageJson).not.toContain("node-fetch");
});

test("Phase 5.2 focused marker can scroll the active Timeline card without drag rewrites", () => {
  const appSource = readRepoFile("src/App.jsx");

  expect(appSource).toContain("data-timeline-item-id={item.id}");
  expect(appSource).toContain("scrollIntoView({ block: \"nearest\", behavior: \"smooth\" })");
  expect(appSource).toContain("foreignSameDayDragActive");
  expect(appSource).toContain("transportPairConflict");
  expect(appSource).toContain("autoContinuationPrompt");
  expect(appSource).not.toContain("onDragStart={(event) => onFocusItem");
});

test("Phase 5.3 destination add editor renders after the timeline flow", () => {
  const appSource = readRepoFile("src/App.jsx");
  const addEditorRender = 'data-timeline-add-editor="true"';

  expect(appSource.indexOf(addEditorRender)).toBeGreaterThan(appSource.indexOf("</DndContext>"));
  expect(appSource.indexOf(addEditorRender)).toBeGreaterThan(appSource.indexOf("tailTransportItem ? ("));
  expect(appSource.indexOf(addEditorRender)).toBeGreaterThan(appSource.indexOf("renderTailTransportInsert(item)"));
  expect(appSource.indexOf("renderVisitEditorForm()", appSource.indexOf(addEditorRender))).toBeGreaterThan(
    appSource.indexOf(addEditorRender),
  );
});

test("Phase 5.3 hotfix scrolls and spaces the bottom add editor", () => {
  const appSource = readRepoFile("src/App.jsx");
  const stylesSource = readRepoFile("src/styles.css");

  expect(appSource).toContain("newVisitEditorRef");
  expect(appSource).toContain('data-timeline-add-editor="true"');
  expect(appSource).toContain("newVisitEditorRef.current?.scrollIntoView({ block: \"nearest\", behavior: \"smooth\" })");
  expect(appSource).toContain('querySelector(\'input[name="location_name"]\')');
  expect(appSource).toContain("primaryInput?.focus?.({ preventScroll: true })");
  expect(appSource).toContain("transportPairConflict");
  expect(appSource).toContain("autoContinuationPrompt");
  expect(stylesSource).toContain(".timeline-add-editor-anchor");
  expect(stylesSource).toContain("margin-top: 12px");
});

test("Phase 5.3 destination editor exposes one map point picker icon button", () => {
  const appSource = readRepoFile("src/App.jsx");
  const stylesSource = readRepoFile("src/styles.css");

  expect(appSource).toContain("map-point-picker-button");
  expect(appSource).toContain("onStartMapPointPick?.()");
  expect(appSource).toContain("onCancelMapPointPick?.()");
  expect(appSource).toContain("<MapPin aria-hidden=\"true\" />");
  expect(appSource).toContain("<X aria-hidden=\"true\" />");
  expect(appSource).toContain("canPickMapPoint: !isRouteLayoutCollapsed && canEdit");
  expect(appSource).toContain("canPickMapPoint: false");
  expect(stylesSource).toContain(".map-point-picker-button");
  expect(stylesSource).toContain(".field-label-actions");
});

test("Phase 5.3 Formal Google map point picker stays lazy-provider scoped", () => {
  const appSource = readRepoFile("src/App.jsx");
  const mapPanelSource = readRepoFile("src/components/map/MapPanel.jsx");
  const googleProviderSource = readRepoFile("src/components/map/providers/GoogleMapProvider.lazy.jsx");
  const staticProviderSource = readRepoFile("src/components/map/providers/StaticMapProvider.jsx");
  const stylesSource = readRepoFile("src/styles.css");

  expect(appSource).toContain("googleMapsPointUrl(latitude, longitude)");
  expect(appSource).toContain("pickedMapPoint?.pickedAt");
  expect(appSource).toContain("setForm({");
  expect(appSource).toContain("document.addEventListener(\"pointerdown\", handleDocumentPointerDown, true)");
  expect(appSource).toContain(".google-map-surface");
  expect(appSource).toContain(".map-point-picker-button");
  expect(mapPanelSource).toContain("isPickingMapPoint = false");
  expect(mapPanelSource).toContain("mapPointPickFeedback = \"\"");
  expect(mapPanelSource).toContain("onPickMapPoint");
  expect(googleProviderSource).toContain("mapRef.current.addListener(\"click\"");
  expect(googleProviderSource).toContain("onPickMapPoint?.({ latitude, longitude })");
  expect(googleProviderSource).toContain("map-point-picker-hint");
  expect(googleProviderSource).toContain('mapPointPickFeedback === "picked"');
  expect(googleProviderSource).toContain('isPickingMapPoint ? " is-picking-map-point" : ""');
  expect(staticProviderSource).not.toContain("onPickMapPoint");
  expect(staticProviderSource).not.toContain("google.maps");
  expect(stylesSource).toContain(".map-point-picker-hint");
  expect(stylesSource).toContain(".google-map-surface.is-picking-map-point .gm-style *");
  expect(stylesSource).toContain("cursor: crosshair !important");
  expect(stylesSource).toContain("bottom: 24px");
  expect(stylesSource).toContain("pointer-events: none");
});

test("Phase 5.3 destination editor save keeps validated hidden map coordinates in payload", () => {
  const appSource = readRepoFile("src/App.jsx");

  expect(appSource).toContain("submittedForm.latitude = mapUrlValidation.point.latitude");
  expect(appSource).toContain("submittedForm.longitude = mapUrlValidation.point.longitude");
  expect(appSource).toContain("latitude: submittedForm.latitude ?? null");
  expect(appSource).toContain("longitude: submittedForm.longitude ?? null");
});

test("Phase 5.3b Google marker focus pans with fixed zoom and focused marker styling", () => {
  const appSource = readRepoFile("src/App.jsx");
  const googleProviderSource = readRepoFile("src/components/map/providers/GoogleMapProvider.lazy.jsx");
  const staticProviderSource = readRepoFile("src/components/map/providers/StaticMapProvider.jsx");

  expect(appSource).toContain("if (isPickingMapPoint) return;");
  expect(googleProviderSource).toContain("FOCUSED_MARKER_ZOOM = 15");
  expect(googleProviderSource).toContain("mapRef.current.setZoom(FOCUSED_MARKER_ZOOM)");
  expect(googleProviderSource.indexOf("mapRef.current.setZoom(FOCUSED_MARKER_ZOOM)")).toBeLessThan(
    googleProviderSource.indexOf("mapRef.current.panTo(focusedMarker.getPosition())"),
  );
  expect(googleProviderSource).toContain("buildDestinationMarkerSvg");
  expect(googleProviderSource).toContain("markerSequenceNumber");
  expect(googleProviderSource).toContain("destinationMarkerIcon");
  expect(googleProviderSource).toContain("marker.setIcon(");
  expect(googleProviderSource).toContain("marker.setZIndex(isFocusedMarker ? 1000");
  expect(googleProviderSource).toContain("if (!isPickingMapPoint && !isRouteEditMode) onFocusItem?.(marker.itemId)");
  expect(googleProviderSource).toContain("}, [isPickingMapPoint, isRouteEditMode, markersKey, onFocusItem, status, viewportSignature])");
  expect(googleProviderSource).not.toContain("AdvancedMarkerElement");
  expect(googleProviderSource).not.toContain("markerCluster");
  expect(staticProviderSource).not.toContain("FOCUSED_MARKER_ZOOM");
});

test("Phase 5.7b-1 Google provider exposes route edit mode skeleton only in Google map", () => {
  const googleProviderSource = readRepoFile("src/components/map/providers/GoogleMapProvider.lazy.jsx");
  const staticProviderSource = readRepoFile("src/components/map/providers/StaticMapProvider.jsx");
  const stylesSource = readRepoFile("src/styles.css");

  expect(googleProviderSource).toContain('const [isRouteEditMode, setIsRouteEditMode] = useState(false)');
  expect(googleProviderSource).toContain("function toggleRouteEditMode(event)");
  expect(googleProviderSource).toContain('title="編輯地圖路線"');
  expect(googleProviderSource).toContain('aria-label="編輯地圖路線"');
  expect(googleProviderSource).toContain("map-route-edit-button");
  expect(googleProviderSource).toContain("路線編輯模式");
  expect(googleProviderSource).toContain("routeEditOverlayRect");
  expect(googleProviderSource).toContain("ROUTE_EDIT_ACTIVE_TOP_INSET_PX = 6");
  expect(googleProviderSource).toContain("route-edit-page-overlay-pane");
  expect(googleProviderSource).toContain("createPortal(");
  expect(googleProviderSource).toContain("document.body");
  expect(googleProviderSource).toContain("updateRouteEditOverlayRect");
  expect(googleProviderSource).toContain('aria-label="離開路線編輯模式"');
  expect(googleProviderSource).toContain("onClick={exitRouteEditMode}");
  expect(googleProviderSource).not.toContain("route-edit-interaction-layer");
  expect(googleProviderSource).toContain('event.key === "Escape"');
  expect(googleProviderSource).toContain("disabled={isRouteEditMode}");
  expect(googleProviderSource).toContain('title={isPickingMapPoint ? "取消選點" : "在地圖選點新增景點"}');
  expect(googleProviderSource).toContain('aria-label={isPickingMapPoint ? "取消選點" : "在地圖選點新增景點"}');
  expect(googleProviderSource).toContain("if (!isPickingMapPoint && !isRouteEditMode) onFocusItem?.(marker.itemId)");
  expect(googleProviderSource).toContain("if (isRouteEditMode) {");
  expect(googleProviderSource).toContain("event?.stop?.();");
  expect(googleProviderSource).toContain("clearPendingPoi();");
  expect(googleProviderSource).toContain("clearPlacesPreview();");
  expect(googleProviderSource).toContain("resetPlacesSearch();");
  expect(googleProviderSource).toContain("if (isPickingMapPointRef.current) onCancelMapPointPickRef.current?.();");
  expect(staticProviderSource).not.toContain("map-route-edit-button");
  expect(staticProviderSource).not.toContain("路線編輯模式");
  expect(staticProviderSource).not.toContain("route-edit-page-overlay-pane");
  expect(stylesSource).toContain(".map-area-tools");
  expect(stylesSource).toContain(".map-route-edit-button.active");
  expect(stylesSource).toContain(".route-edit-page-overlay-pane");
  expect(stylesSource).toContain("position: fixed");
  expect(stylesSource).not.toContain(".google-map-surface.is-route-edit-mode .google-map-canvas");
  expect(stylesSource).not.toContain(".route-edit-interaction-layer");
  expect(stylesSource).toContain(".route-edit-mode-banner");
});

test("Phase 5.5 Google map area custom point add flow stays provider scoped", () => {
  const appSource = readRepoFile("src/App.jsx");
  const mapPanelSource = readRepoFile("src/components/map/MapPanel.jsx");
  const googleProviderSource = readRepoFile("src/components/map/providers/GoogleMapProvider.lazy.jsx");
  const staticProviderSource = readRepoFile("src/components/map/providers/StaticMapProvider.jsx");
  const stylesSource = readRepoFile("src/styles.css");

  expect(appSource).toContain("const [mapPickingMode, setMapPickingMode] = useState(null)");
  expect(appSource).toContain('setMapPickingMode(mode === "map-add" ? "map-add" : "editor")');
  expect(appSource).toContain("source: mapPickingMode || \"editor\"");
  expect(appSource).toContain("pickedMapPoint.source === \"map-add\" && !isOpen");
  expect(appSource).toContain("void openNewItem(pickedMapPoint)");
  expect(appSource).toContain("buildNewVisitForm(initialPoint = null)");
  expect(appSource).toContain("map_url: hasPoint ? googleMapsPointUrl(latitude, longitude) : \"\"");
  expect(appSource).toContain("onMapPointEditorActiveChange?.({ canPick: Boolean(isOpen && !isTransportEditor), isOpen })");
  expect(appSource).toContain("!mapPointEditorState.isOpen || mapPointEditorState.canPick");
  expect(mapPanelSource).toContain("hasActiveMapPointEditor = false");
  expect(mapPanelSource).toContain("mapPickingMode = null");
  expect(mapPanelSource).toContain("onStartMapPointPick");
  expect(googleProviderSource).toContain("map-area-tools");
  expect(googleProviderSource).toContain("map-area-point-button");
  expect(googleProviderSource).toContain('onStartMapPointPick?.(hasActiveMapPointEditor ? "editor" : "map-add")');
  expect(googleProviderSource).toContain('mapPickingMode === "map-add"');
  expect(staticProviderSource).not.toContain("map-area-point-button");
  expect(staticProviderSource).not.toContain("map-area-tools");
  expect(staticProviderSource).not.toContain("onStartMapPointPick");
  expect(stylesSource).toContain(".map-area-point-button");
  expect(stylesSource).toContain(".map-area-tools");
  expect(stylesSource).toContain("top: 68px");
  expect(stylesSource).toContain("left: 20px");
});

test("Phase 5.4 renders simple Google route lines and Timeline sequence badges", () => {
  const appSource = readRepoFile("src/App.jsx");
  const markerSource = readRepoFile("src/lib/timelineMapMarkers.js");
  const googleProviderSource = readRepoFile("src/components/map/providers/GoogleMapProvider.lazy.jsx");
  const staticProviderSource = readRepoFile("src/components/map/providers/StaticMapProvider.jsx");
  const stylesSource = readRepoFile("src/styles.css");

  expect(markerSource).toContain("destinationSequence += 1");
  expect(markerSource).toContain("sequenceNumber: destinationSequence");
  expect(markerSource).toContain("isTransportationCard(item)");
  expect(markerSource).not.toContain('type === "transport"');
  expect(appSource).toContain("destination-sequence-badge");
  expect(appSource).toContain("{index + 1}");
  expect(stylesSource).toContain(".destination-sequence-badge");
  expect(stylesSource).toContain("position: absolute");
  expect(stylesSource).toContain("top: 5px");
  expect(stylesSource).toContain("left: 7px");
  expect(stylesSource).toContain("color: rgb(83 83 83 / 55%)");
  expect(stylesSource).toContain("font-size: 12px");
  expect(stylesSource).toContain("font-weight: 500");
  expect(stylesSource).toContain("pointer-events: none");
  expect(appSource).not.toContain("timeline-destination-sequence");
  expect(googleProviderSource).toContain("routeLineRef");
  expect(googleProviderSource).toContain("new mapsNamespace.Polyline");
  expect(googleProviderSource).toContain("path: fullRoutePath(routeSegments, customRoutePointsRef.current)");
  expect(googleProviderSource).toContain("clickable: false");
  expect(googleProviderSource).toContain("markerSequenceNumber(marker");
  expect(staticProviderSource).not.toContain("Polyline");
  expect(googleProviderSource).not.toContain("Directions");
  expect(googleProviderSource).not.toContain("Routes");
});

test("Phase 5.8a uses a compact custom numbered destination marker", () => {
  const googleProviderSource = readRepoFile("src/components/map/providers/GoogleMapProvider.lazy.jsx");
  const markerVisualSource = readRepoFile("src/lib/mapMarkerVisuals.js");
  const markerSource = readRepoFile("src/lib/timelineMapMarkers.js");

  expect(googleProviderSource).toContain("destinationMarkerIcon");
  expect(googleProviderSource).toContain("buildDestinationMarkerSvg");
  expect(googleProviderSource).toContain("marker?.markerColor");
  expect(googleProviderSource).toContain("setIcon(");
  expect(markerVisualSource).toContain("DESTINATION_MARKER_TRIANGLE_PATH");
  expect(markerVisualSource).toContain('M 4.5 25.2 L 27.5 25.2 L 16 38 Z');
  expect(markerVisualSource).toContain("const DESTINATION_MARKER_RADIUS = 14");
  expect(markerVisualSource).toContain("const DESTINATION_MARKER_CENTER_Y = 19");
  expect(markerVisualSource).toContain("fillColor = \"#dcefe8\"");
  expect(markerVisualSource).toContain("stroke=\"${borderColor}\"");
  expect(markerVisualSource).toContain("fill=\"${innerColor}\"");
  expect(markerVisualSource).toContain("font-size=\"${fontSize}\"");
  expect(markerVisualSource).toContain('font-weight=\"900\"');
  expect(markerVisualSource).toContain('stroke-width=\"0.2\"');
  expect(markerSource).toContain("markerColor: timelineTypeMarkerColor(category)");
  expect(markerSource).toContain("markerFillColor: timelineTypeMarkerFillColor(category)");
  expect(googleProviderSource).not.toContain("focusedMarkerIcon");
});

test("Phase 5.7b-2 Google route edit mode supports local segment custom points only", () => {
  const googleProviderSource = readRepoFile("src/components/map/providers/GoogleMapProvider.lazy.jsx");
  const staticProviderSource = readRepoFile("src/components/map/providers/StaticMapProvider.jsx");
  const packageJson = readRepoFile("package.json");

  expect(MAX_CUSTOM_ROUTE_POINTS_PER_SEGMENT).toBe(5);
  expect(googleProviderSource).toContain("MAX_CUSTOM_ROUTE_POINTS_PER_SEGMENT");
  expect(googleProviderSource).toContain("ROUTE_EDIT_HIT_STROKE_WEIGHT = 22");
  expect(googleProviderSource).toContain("ROUTE_EDIT_SUPPRESS_LINE_CLICK_MS = 250");
  expect(googleProviderSource).toContain("function routeSegmentKey(fromMarker, toMarker)");
  expect(googleProviderSource).toContain("return `${fromMarker.itemId}:${toMarker.itemId}`");
  expect(googleProviderSource).toContain("function buildRouteSegments(markers)");
  expect(googleProviderSource).toContain("function routeSegmentPath(segment, customRoutePointsBySegment)");
  expect(googleProviderSource).toContain("function routeSubSegments(segment, customPoints = [])");
  expect(googleProviderSource).toContain("insertIndex: index");
  expect(googleProviderSource).toContain('function routeEditHandleIcon(mapsNamespace, remoteUserColor = "")');
  expect(googleProviderSource).toContain('const safeRemoteColor = /^#[0-9a-f]{6}$/i.test(remoteUserColor) ? remoteUserColor : ""');
  expect(googleProviderSource).toContain('stroke="${safeRemoteColor}"');
  expect(googleProviderSource).toContain('filter="url(#remote-glow)"');
  expect(googleProviderSource).toContain("const canvasSize = safeRemoteColor ? 20 : 14");
  expect(googleProviderSource).toContain("const center = canvasSize / 2");
  expect(googleProviderSource).toContain('fill="#2f8f72"');
  expect(googleProviderSource).toContain("encodeURIComponent(svg)");
  expect(googleProviderSource).toContain("new PointConstructor(center, center)");
  expect(googleProviderSource).toContain("new SizeConstructor(canvasSize, canvasSize)");
  expect(googleProviderSource).toContain('const [customRoutePointsBySegment, setCustomRoutePointsBySegment] = useState({})');
  expect(googleProviderSource).toContain("if (currentPoints.length >= MAX_CUSTOM_ROUTE_POINTS_PER_SEGMENT) return");
  expect(googleProviderSource).toContain("function insertRouteCustomPoint(segmentKey, insertIndex, point)");
  expect(googleProviderSource).toContain("...currentPoints.slice(0, safeInsertIndex)");
  expect(googleProviderSource).toContain("...currentPoints.slice(safeInsertIndex)");
  expect(googleProviderSource).toContain("routeSubSegments(segment, customPoints).map((subSegment)");
  expect(googleProviderSource).toContain("path: subSegment.path");
  expect(googleProviderSource).toContain("strokeOpacity: 0.01");
  expect(googleProviderSource).toContain("insertRouteCustomPoint(segment.key, subSegment.insertIndex, { lat, lng })");
  expect(googleProviderSource).toContain("draggable: !isLockedByRemote");
  expect(googleProviderSource).toContain('marker.addListener?.("mousedown"');
  expect(googleProviderSource).toContain("function suppressRouteLineClick()");
  expect(googleProviderSource).toContain("if (Date.now() < routeEditSuppressLineClickUntilRef.current) return");
  expect(googleProviderSource).toContain('marker.addListener?.("drag"');
  expect(googleProviderSource).toContain("applyRouteLinePath(nextCustomPoints)");
  expect(googleProviderSource).toContain('marker.addListener?.("dragend"');
  expect(googleProviderSource).toContain("const lastDragEndedAt = Date.now()");
  expect(googleProviderSource).toContain("updateRouteCustomPoint(segment.key, point.id, { lat, lng })");
  expect(googleProviderSource).toContain('marker.addListener?.("click"');
  expect(googleProviderSource).toContain("removeRouteCustomPoint(segment.key, point.id)");
  expect(googleProviderSource).toContain("if (!isRouteEditMode || status !== \"ready\"");
  expect(staticProviderSource).not.toContain("map-route-edit-button");
  expect(staticProviderSource).not.toContain("customRoutePointsBySegment");
  expect(packageJson).not.toContain("@react-google-maps");
});

test("Phase 5.7b-3 persists route overrides with guarded cleanup and Google-only editing", () => {
  const appSource = readRepoFile("src/App.jsx");
  const mapPanelSource = readRepoFile("src/components/map/MapPanel.jsx");
  const googleProviderSource = readRepoFile("src/components/map/providers/GoogleMapProvider.lazy.jsx");
  const staticProviderSource = readRepoFile("src/components/map/providers/StaticMapProvider.jsx");
  const stylesSource = readRepoFile("src/styles.css");
  const migrationSource = readRepoFile("supabase/migrations/20260708063744_add_itinerary_route_overrides.sql");

  expect(migrationSource).toContain("create table if not exists public.itinerary_route_overrides");
  expect(migrationSource).toContain("points_json jsonb not null default '[]'::jsonb");
  expect(migrationSource).toContain("unique (trip_id, day_index, from_item_id, to_item_id)");
  expect(migrationSource).toContain("alter table public.itinerary_route_overrides enable row level security");
  expect(migrationSource).toContain("app_private.can_read_trip(trip_id, auth.uid())");
  expect(migrationSource).toContain("app_private.can_edit_trip(trip_id, auth.uid())");
  expect(migrationSource).toContain("touch_itinerary_route_overrides_updated_at");

  const stops = [
    { itemId: "visit-a" },
    { itemId: "visit-b" },
    { itemId: "visit-c" },
  ];
  const validKeys = validRouteSegmentKeysFromStops(stops);
  expect(validKeys.has(routeOverrideSegmentKey("visit-a", "visit-b"))).toBe(true);
  expect(validKeys.has(routeOverrideSegmentKey("visit-b", "visit-c"))).toBe(true);
  expect(routeOverridesToSegmentMap([
    { from_item_id: "visit-a", to_item_id: "visit-b", points_json: [{ lat: 1, lng: 2 }] },
    { from_item_id: "visit-a", to_item_id: "visit-c", points_json: [{ lat: 3, lng: 4 }] },
    { from_item_id: "visit-b", to_item_id: "visit-c", points_json: [] },
  ], validKeys)).toEqual({
    "visit-a:visit-b": [{ id: "legacy-0-1-2", lat: 1, lng: 2 }],
  });

  expect(appSource).toContain('const [routeOverrides, setRouteOverrides] = useState([])');
  expect(appSource).toContain("loadRouteOverrides(activeTripId, activeDay)");
  expect(appSource).toContain("const changedRouteEndpointIds = nextItems.reduce((changedIds, item) =>");
  expect(appSource).toContain("if (changedRouteEndpointIds.length)");
  expect(appSource).toContain("!changedRouteEndpointIds.includes(override.from_item_id)");
  expect(appSource).toContain("const routeOverrideLoadRequestRef = useRef(0)");
  expect(appSource).toContain("const routeOverrideLoadTargetRef = useRef({ dayIndex: null, isDemoMode: false, tripId: null })");
  expect(appSource).toContain("const requestId = ++routeOverrideLoadRequestRef.current");
  expect(appSource).toContain("if (!isCurrentRouteOverrideRequest()) return []");
  expect(appSource).toContain('from("itinerary_route_overrides")');
  expect(appSource).toContain('from("itinerary_route_override_nodes")');
  expect(appSource).toContain('.eq("node_key", operation.node.id)');
  expect(appSource).toContain('.eq("node_key", operation.nodeId)');
  expect(appSource).toContain('points_json: nextPoints');
  expect(appSource).not.toContain('{ onConflict: "trip_id,day_index,from_item_id,to_item_id" }');
  expect(appSource).not.toContain("points_json: [segment.from");
  expect(appSource).toContain("routeOverridePointsEqual(requestedPoints, baselinePoints)");
  expect(appSource).toContain("return { ok: false, points: baselinePoints }");
  expect(appSource).toContain("路線保存失敗，已還原。");
  expect(appSource).toContain("!activeDayRouteSegmentKeys.has(routeOverrideSegmentKey");
  expect(appSource).toContain('in("from_item_id", changedItemIds)');
  expect(appSource).toContain('in("to_item_id", changedItemIds)');
  expect(appSource).toContain("routeOverrideCoordinateSnapshotRef");
  expect(appSource).toContain("routeOverridePointsBySegment={activeRouteOverridePointsBySegment}");
  expect(appSource).toContain("onSaveRouteOverride={saveRouteOverrideChange}");

  expect(mapPanelSource).toContain("routeOverridePointsBySegment = {}");
  expect(mapPanelSource).toContain("onRouteOverrideChange");
  expect(googleProviderSource).toContain("routeOverridePointsBySegment = {}");
  expect(googleProviderSource).toContain("persistRouteCustomPoints");
  expect(googleProviderSource).toContain("if (result?.points) setRouteSegmentPoints(segmentKey, result.points)");
  expect(googleProviderSource).toContain("routeOverrideSaveError");
  expect(stylesSource).toContain(".route-edit-save-error");
  expect(staticProviderSource).not.toContain("routeOverridePointsBySegment");
  expect(staticProviderSource).not.toContain("itinerary_route_overrides");
});

test("Phase 5.7b-3 keeps an override when a reordered day preserves its adjacent item IDs", () => {
  const appSource = readRepoFile("src/App.jsx");
  const routeOverridesSource = readRepoFile("src/lib/routeOverrides.js");
  const reorderedItems = [{ id: "visit-d" }, { id: "visit-a" }, { id: "visit-b" }, { id: "visit-c" }];
  const validKeys = validRouteSegmentKeysFromItems(reorderedItems);
  const overrides = [
    { from_item_id: "visit-b", to_item_id: "visit-c", points_json: [{ id: "node-p1", lat: 35.01, lng: 135.77 }] },
    { from_item_id: "visit-c", to_item_id: "visit-d", points_json: [{ id: "node-p2", lat: 35.02, lng: 135.78 }] },
  ];

  expect(validKeys.has(routeOverrideSegmentKey("visit-b", "visit-c"))).toBe(true);
  expect(validKeys.has(routeOverrideSegmentKey("visit-c", "visit-d"))).toBe(false);
  expect(routeOverridesToSegmentMap(overrides, validKeys)).toEqual({
    "visit-b:visit-c": [{ id: "node-p1", lat: 35.01, lng: 135.77 }],
  });
  expect(routeOverridesSource).toContain("function validRouteSegmentKeysFromItems(items = [])");
  expect(appSource).toContain("validRouteSegmentKeysFromItems(sortedVisitItems(dayItems))");
  expect(appSource).not.toContain("validRouteSegmentKeysFromStops(activeDayRouteStops)");
});

test("Phase 5.7c-1 collaborates on Google route nodes without a same-day Timeline lock", () => {
  const appSource = readRepoFile("src/App.jsx");
  const mapPanelSource = readRepoFile("src/components/map/MapPanel.jsx");
  const googleProviderSource = readRepoFile("src/components/map/providers/GoogleMapProvider.lazy.jsx");
  const routeOverridesSource = readRepoFile("src/lib/routeOverrides.js");
  const nodeMigrationSource = readRepoFile("supabase/migrations/20260710125337_add_itinerary_route_override_nodes.sql");
  const routeRealtimeMigrationSource = readRepoFile("supabase/migrations/20260712033758_add_route_tables_to_realtime.sql");

  expect(appSource).toContain("timeline-route-edit:${activeTripId}:${activeDay}");
  expect(appSource).toContain('event: "route-edit-update"');
  expect(appSource).toContain("routeEditMode");
  expect(appSource).toContain("routeEditCollaboration");
  expect(appSource).toContain("remoteRouteEditUpdates");
  expect(appSource).toContain("routeEditBroadcastThrottleMs = 120");
  expect(appSource).toContain("routeEditPresenceHeartbeatMs = 32000");
  expect(appSource).toContain("routeEditNodeLockStaleMs = 12000");
  expect(appSource).toContain('get("debugRouteCollab") === "1"');
  expect(appSource).toContain("[route-edit-collab]");
  expect(appSource).toContain("routeEditPresenceStatusRef");
  expect(appSource).toContain("routeEditChannelReady");
  expect(appSource).toContain("routeEditRecoveryGeneration");
  expect(appSource).toContain("routeEditChannelMetadataRef");
  expect(appSource).toContain("routeEditChannelRecoveryRef");
  expect(appSource).toContain("routeEditChannelVersion");
  expect(appSource).toContain("requestRouteEditChannelRecovery");
  expect(appSource).toContain("pendingReplayEvent");
  expect(appSource).toContain('routeEditCollaborationDebug("channel created"');
  expect(appSource).toContain('routeEditCollaborationDebug("recovery requested"');
  expect(appSource).toContain('routeEditCollaborationDebug("replacement channel created"');
  expect(appSource).toContain('routeEditCollaborationDebug("pending broadcast replayed"');
  expect(appSource).toContain('routeEditCollaborationDebug("broadcast send"');
  expect(appSource).toContain('routeEditCollaborationDebug("subscribe status"');
  expect(appSource).toContain('routeEditCollaborationDebug("presence synced"');
  expect(appSource).toContain("latestPresenceBySession");
  expect(appSource).toContain("editorUsers");
  expect(appSource).toContain('ensureRouteEditChannelHealth("presence-heartbeat")');
  expect(appSource).toContain('recoverOnForeground("visibility-visible")');
  expect(appSource).toContain('recoverOnForeground("window-focus")');
  expect(appSource).toContain('recoverOnForeground("window-online")');
  expect(appSource).toContain('routeEditCollaborationDebug("replacement resync started"');
  expect(appSource).toContain('routeEditCollaborationDebug("replacement resync complete"');
  expect(appSource).toContain("void loadRouteOverrides(activeTripId, activeDay).finally");
  expect(appSource).toContain("routeEditRemoteMoveVersionRef");
  expect(appSource).toContain("incomingVersion <= previousVersion");
  expect(appSource).toContain("eventVersion: ++broadcast.eventVersion");
  expect(appSource).toContain("setRemoteRouteEditUpdates((current) => ({");
  expect(appSource).toContain("setRemoteRouteEditNodeLocks((current) => ({");
  expect(appSource).toContain('["node-drag-start", "node-drag-move"].includes(payload.phase)');
  expect(appSource).toContain('["node-drag-end", "node-delete"].includes(payload.phase)');
  expect(appSource).toContain('const remoteUpdateSlot = payload.phase === "node-drag-start" ? "ownership" : "position"');
  expect(appSource).toContain("[`${payload.segmentKey}:${payload.nodeId}:${remoteUpdateSlot}`]: remoteUpdate");
  expect(appSource).toContain("const isDragMove = event.phase === \"node-drag-move\"");
  expect(appSource).toContain("if (!isDragMove) {");
  expect(appSource).toContain("if (routeEditLocalStateRef.current.isEditing) {");
  expect(appSource).toContain("publishRouteEditPresence(routeEditLocalStateRef.current)");
  expect(appSource).not.toContain("publishRouteEditPresence(nextState)");
  expect(appSource).not.toContain("routeEditSameDayReadonly");
  expect(mapPanelSource).toContain("onRouteEditCollaborationEvent");
  expect(mapPanelSource).toContain("onRouteEditPresenceChange");
  expect(googleProviderSource).toContain("function newRouteNodeId()");
  expect(googleProviderSource).toContain("node-drag-start");
  expect(googleProviderSource).toContain("node-drag-move");
  expect(googleProviderSource).toContain("node-drag-end");
  expect(googleProviderSource).toContain("node-add");
  expect(googleProviderSource).toContain("node-delete");
  expect(googleProviderSource).toContain("draggable: !isLockedByRemote && routeEditChannelReadyRef.current");
  expect(googleProviderSource).toContain('record.marker?.setIcon?.(routeEditHandleIcon(window.google?.maps, isLockedByRemote ? nodeLock.color : ""))');
  expect(googleProviderSource).toContain('icon: routeEditHandleIcon(mapsNamespace, isLockedByRemote ? nodeLock.color : "")');
  expect(appSource).toContain("timelineCollaboratorColorKey(payload.userId, payload.sessionId)");
  expect(googleProviderSource).toContain("const routeEditNodeLocksRef = useRef({})");
  expect(googleProviderSource).toContain("const routeEditChannelReadyRef");
  expect(googleProviderSource).toContain("routeEditCollaboration.recoveryGeneration");
  expect(googleProviderSource).toContain("isChannelReady && !isLockedByRemote");
  expect(googleProviderSource).toContain("const remoteRoutePreviewBySegmentRef = useRef({})");
  expect(googleProviderSource).toContain("function mergeRemoteRoutePreview(pointsBySegment = {})");
  expect(googleProviderSource).toContain("function mergeLocalRouteDragPreview(pointsBySegment = {})");
  expect(googleProviderSource).toContain("routeEditCollaboration.remoteUpdates || {}");
  expect(googleProviderSource).toContain("Number(left?.receiptId || 0) - Number(right?.receiptId || 0)");
  expect(googleProviderSource).toContain("routeEditRemoteAppliedReceiptRef");
  expect(googleProviderSource).toContain("const ownsNodePosition = (activeDrag.isDragging &&");
  expect(googleProviderSource).toContain("const routeEditPendingCommitsRef = useRef(new Map())");
  expect(googleProviderSource).toContain("routeEditPendingCommitsRef.current.forEach((pendingCommit, commitKey)");
  expect(googleProviderSource).toContain("const routeEditAuthoritativeSegmentKeysRef = useRef(new Set())");
  expect(googleProviderSource).toContain("const invalidatedSegmentKeys = new Set(");
  expect(googleProviderSource).toContain("invalidatedSegmentKeys.forEach((segmentKey) => delete nextRemotePreviews[segmentKey])");
  expect(googleProviderSource).toContain("invalidatedSegmentKeys.has(pendingCommit.segmentKey)");
  expect(googleProviderSource).toContain("point.lat === pendingCommit.node.lat");
  expect(googleProviderSource).toContain("const deferredPreview = remoteRoutePreviewBySegmentRef.current[pendingCommit.segmentKey]?.[pendingCommit.nodeId]");
  expect(googleProviderSource).toContain("const remoteOwnerTookOverPendingNode = routeEditPendingCommitsRef.current.has(commitKey)");
  expect(googleProviderSource).toContain("if (remoteOwnerTookOverPendingNode)");
  expect(googleProviderSource).toContain("routeEditPendingCommitsRef.current.set(commitKey");
  expect(googleProviderSource).toContain("const pendingCommit = routeEditPendingCommitsRef.current.get(commitKey)");
  expect(googleProviderSource).toContain("routeEditPendingCommitsRef.current.delete(commitKey)");
  expect(googleProviderSource).toContain('if (update.phase === "node-delete")');
  expect(googleProviderSource).toContain("if (!nodeStillExists) return result");
  expect(googleProviderSource).toContain("customRoutePointsRef.current = nextPointsBySegment");
  expect(googleProviderSource).toContain("if (ownsNodePosition) return;");
  expect(googleProviderSource).toContain("if (result?.ok === false || !hasFinalPosition)");
  expect(googleProviderSource).toContain("const onRouteEditPresenceChangeRef = useRef(onRouteEditPresenceChange)");
  expect(googleProviderSource).toContain("onRouteEditPresenceChangeRef.current?.({ isEditing: true })");
  expect(googleProviderSource).toContain("onRouteEditPresenceChangeRef.current?.({ isEditing: false })");
  expect(googleProviderSource).not.toContain("}, [isPickingMapPoint, isRouteEditMode, onCancelMapPointPick, onRouteEditPresenceChange]);");
  expect(googleProviderSource).toContain("changedHandle.marker?.setPosition?.({ lat: update.node.lat, lng: update.node.lng })");
  expect(googleProviderSource).toContain('update.phase === "node-add" || update.phase === "node-delete"');
  expect(googleProviderSource).toContain("const customPoints = customRoutePointsRef.current[segment.key] || []");
  expect(googleProviderSource).not.toContain("routeEditCollaboration.nodeLocks, status]);");
  expect(googleProviderSource).not.toContain("nodes: nextPoints");
  expect(googleProviderSource).not.toContain("nodes: nextSegmentPoints");
  expect(googleProviderSource).toContain('{ phase: "node-drag-move", node, nodeId: point.id');
  expect(appSource).toContain("正在編輯地圖路線");
  expect(routeOverridesSource).toContain("legacy-${normalized.length}-${lat}-${lng}");
  expect(routeOverridesSource).toContain("point?.orderKey ?? point?.order_key");
  expect(appSource).toContain("operation?.type");
  expect(appSource).toContain('operation?.type !== "delete" && routeOverridePointsEqual(requestedPoints, baselinePoints)');
  expect(appSource).toContain("must still issue the");
  expect(appSource).toContain("idempotent node DELETE");
  expect(appSource).toContain("failurePoints = nodeRowsToPoints(latestNodeRows)");
  expect(appSource).toContain("return { ok: false, points: failurePoints }");
  expect(appSource).toContain('from("itinerary_route_override_nodes")');
  expect(appSource).toContain("nodeRowsToPoints");
  expect(appSource).not.toContain("latestPoints.map");
  expect(nodeMigrationSource).toContain("create table if not exists public.itinerary_route_override_nodes");
  expect(nodeMigrationSource).toContain("unique (route_override_id, node_key)");
  expect(routeRealtimeMigrationSource).toContain("alter table public.itinerary_route_overrides replica identity full");
  expect(routeRealtimeMigrationSource).toContain("alter table public.itinerary_route_override_nodes replica identity full");
  expect(routeRealtimeMigrationSource).toContain("alter publication supabase_realtime add table public.itinerary_route_overrides");
  expect(routeRealtimeMigrationSource).toContain("alter publication supabase_realtime add table public.itinerary_route_override_nodes");
  expect(nodeMigrationSource).toContain("enforce_itinerary_route_override_node_limit");
  expect(nodeMigrationSource).toContain("pg_advisory_xact_lock");
  expect(nodeMigrationSource).toContain("alter table public.itinerary_route_override_nodes enable row level security");
  expect(nodeMigrationSource).toContain("app_private.can_read_trip(route_override.trip_id, (select auth.uid()))");
  expect(nodeMigrationSource).toContain("app_private.can_edit_trip(route_override.trip_id, (select auth.uid()))");
  expect(nodeMigrationSource).toContain("itinerary_route_override_nodes_created_by_idx");
  expect(nodeMigrationSource).toContain("itinerary_route_override_nodes_updated_by_idx");
  expect(nodeMigrationSource).toContain("jsonb_array_elements(route_override.points_json) with ordinality");
  expect(nodeMigrationSource).toContain("touch_itinerary_route_override_from_node");
});

test("Phase 5.1e Google map preserves user-adjusted viewport until the day or markers change", () => {
  const appSource = readRepoFile("src/App.jsx");
  const mapPanelSource = readRepoFile("src/components/map/MapPanel.jsx");
  const googleProviderSource = readRepoFile("src/components/map/providers/GoogleMapProvider.lazy.jsx");

  expect(appSource).toContain("viewportKey={`formal-day:${activeDay}`}");
  expect(mapPanelSource).toContain('viewportKey = "default"');
  expect(mapPanelSource).toContain("viewportKey,");
  expect(googleProviderSource).toContain("userChangedViewportRef");
  expect(googleProviderSource).toContain("autoViewportSignatureRef");
  expect(googleProviderSource).toContain("map.addListener(\"dragstart\"");
  expect(googleProviderSource).toContain("map.addListener(\"zoom_changed\"");
  expect(googleProviderSource).toContain("if (!userChangedViewportRef.current)");
  expect(googleProviderSource).toContain("runProgrammaticViewportUpdate");
  expect(googleProviderSource).toContain("autoViewportSignatureRef.current !== viewportSignature");
});

test("Phase 5.1a wires Demo RoutePanel through explicit demo mode", () => {
  const appSource = readRepoFile("src/App.jsx");

  expect(appSource).toContain('mode="demo"');
  expect(appSource).toContain('mode="formal"');
  expect(appSource).toContain("mode={mode}");
});
