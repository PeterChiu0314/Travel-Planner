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
  expect(googleProviderSource).not.toContain("Places");
  expect(googleProviderSource).not.toContain("Geocoding");
  expect(googleProviderSource).not.toContain("Polyline");
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
  expect(googleProviderSource).toContain("loadGoogleMapsApi({ apiKey })");
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

test("Phase 5.1a wires Demo RoutePanel through explicit demo mode", () => {
  const appSource = readRepoFile("src/App.jsx");

  expect(appSource).toContain('mode="demo"');
  expect(appSource).toContain('mode="formal"');
  expect(appSource).toContain("mode={mode}");
});
