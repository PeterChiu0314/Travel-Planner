import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  fetchPlaceDetailsForPrediction,
  fetchPlaceAutocompletePredictions,
  normalizeAutocompletePrediction,
} from "../src/lib/googlePlacesAdapter.js";
import { PLACE_DETAILS_FIELD_MASK_MINIMAL } from "../src/lib/googlePlacesConfig.js";
import { isGoogleMapsUrl, parseMapUrlToPoint } from "../src/lib/mapPoint.js";

const repoRoot = process.cwd();

function readRepoFile(filePath) {
  return fs.readFileSync(path.join(repoRoot, filePath), "utf8");
}

test("Dayboard add waits for a ready Map and enters the shared add-location flow", () => {
  const appSource = readRepoFile("src/App.jsx");
  const mapPanelSource = readRepoFile("src/components/map/MapPanel.jsx");
  const googleProviderSource = readRepoFile("src/components/map/providers/GoogleMapProvider.lazy.jsx");

  expect(appSource).toContain("onClick={onStartMapAddLocation || openNewItem}");
  expect(appSource).toContain("if (isRouteLayoutCollapsed || isMapClosing)");
  expect(appSource).toContain("openRouteMap();");
  expect(appSource).toContain('animation.animationName === "timeline-map-reveal"');
  expect(appSource).toContain("Promise.allSettled(revealAnimations.map((animation) => animation.finished))");
  expect(appSource).toContain("function toggleRouteMapWithAddLocationCleanup()");
  expect(appSource).toContain("if (!isRouteCollapsed && (isMapAddLocationActive || isMapAddLocationPending)) cancelMapAddLocation()");
  expect(appSource).toContain("onClick={toggleRouteMapWithAddLocationCleanup}");
  expect(mapPanelSource).toContain("isMapAddLocationActive");
  expect(googleProviderSource).toContain("new ResizeObserver(focusWhenMapHasSize)");
  expect(googleProviderSource).toContain('trigger?.(mapRef.current, "resize")');
  expect(googleProviderSource).toContain("searchInput.focus({ preventScroll: true })");
});

test("add-location cancellation and all point sources keep the existing confirmation handoff", () => {
  const appSource = readRepoFile("src/App.jsx");
  const googleProviderSource = readRepoFile("src/components/map/providers/GoogleMapProvider.lazy.jsx");

  expect(appSource).toContain("setPickedMapPoint(null)");
  expect(appSource).toContain('if (pickedMapPoint.source === "map-add")');
  expect(googleProviderSource).toContain("function exitMapAddLocation()");
  expect(googleProviderSource).toContain("clearPendingPoi();");
  expect(googleProviderSource).toContain("clearPlacesPreview();");
  expect(googleProviderSource).toContain("resetPlacesSearch();");
  expect(googleProviderSource.match(/onPickMapPoint\?\.\(\{ latitude, longitude \}\)/g)).toHaveLength(2);
  expect(googleProviderSource).not.toContain('source: "custom-point"');
  expect(googleProviderSource).toContain("onSelectPlaceDetails?.(placesPreview)");
  expect(googleProviderSource).toContain('placesPreview.source === "map-url" || !isMapSearchReplaceActive');
});

test("custom Map points open a coordinate-backed new editor with an immediate draft marker", () => {
  const appSource = readRepoFile("src/App.jsx");

  expect(appSource).toContain('source: mapPickingMode || "editor"');
  expect(appSource).toContain('if (pickedMapPoint.source === "map-add")');
  expect(appSource).toContain("void openNewItem(pickedMapPoint)");
  expect(appSource).toContain('id: "itinerary-editor-preview"');
  expect(appSource).toContain("locationName: activeVisitForm.location_name || activeVisitForm.location || activeVisitForm.title || \"新增地點\"");
  expect(appSource).toContain("latitude: previewMapPoint.latitude");
  expect(appSource).toContain("longitude: previewMapPoint.longitude");
});

test("new and existing visit editors share the same point editing section", () => {
  const appSource = readRepoFile("src/App.jsx");

  expect(appSource).toContain('const isMapPointBodyVisible = isAlternativeEditor || isMapPointExpanded');
  expect(appSource).toContain('<div className={`visit-map-point-section${isMapPointBodyVisible ? " expanded" : ""}${isAlternativeEditor ? " always-expanded" : ""}`}>');
  expect(appSource).not.toContain('editingId || !useEditLocks ? <div className={`visit-map-point-section');
  expect(appSource).toContain("更改地點");
  expect(appSource).toContain("搜尋替換");
  expect(appSource).toContain("const nextForm = buildNewVisitForm(initialPoint)");
});

test("Phase 5.6b normalizes Places autocomplete predictions without Place Details", () => {
  expect(
    normalizeAutocompletePrediction({
      placePrediction: {
        placeId: "place-1",
        text: { text: "Kyoto Station, Kyoto, Japan" },
        structuredFormat: {
          mainText: { text: "Kyoto Station" },
          secondaryText: { text: "Kyoto, Japan" },
        },
      },
    }),
  ).toMatchObject({
    id: "place-1",
    mainText: "Kyoto Station",
    secondaryText: "Kyoto, Japan",
    description: "Kyoto Station, Kyoto, Japan",
  });
});

test("Map search recognizes supported Google Maps coordinate URLs", () => {
  const url = "https://www.google.com/maps/place/Kyoto/@35.0116,135.7681,15z";

  expect(isGoogleMapsUrl(url)).toBe(true);
  expect(parseMapUrlToPoint(url)).toEqual({ latitude: 35.0116, longitude: 135.7681 });
  expect(isGoogleMapsUrl("Kyoto Station")).toBe(false);
});

test("Phase 5.6b autocomplete adapter skips short input and uses session token", async () => {
  const sessionToken = { id: "session-1" };
  const locationBias = { north: 35.1, east: 135.9, south: 34.9, west: 135.6 };
  let calls = 0;
  const placesApi = {
    AutocompleteSuggestion: {
      async fetchAutocompleteSuggestions(request) {
        calls += 1;
        expect(request).toMatchObject({ input: "Kyoto", locationBias, sessionToken });
        expect(request).not.toHaveProperty("locationRestriction");
        return {
          suggestions: [
            {
              placePrediction: {
                placeId: "place-1",
                text: { text: "Kyoto Station" },
              },
            },
          ],
        };
      },
    },
  };

  await expect(fetchPlaceAutocompletePredictions({ input: "K", sessionToken, placesApi })).resolves.toEqual([]);
  const predictions = await fetchPlaceAutocompletePredictions({ input: "Kyoto", locationBias, sessionToken, placesApi });

  expect(calls).toBe(1);
  expect(predictions).toHaveLength(1);
  expect(predictions[0]).toMatchObject({ id: "place-1", description: "Kyoto Station" });
});

test("Phase 5.6g autocomplete adapter omits location bias when bounds are unavailable", async () => {
  const placesApi = {
    AutocompleteSuggestion: {
      async fetchAutocompleteSuggestions(request) {
        expect(request).toMatchObject({ input: "Kyoto" });
        expect(request).not.toHaveProperty("locationBias");
        expect(request).not.toHaveProperty("locationRestriction");
        return { suggestions: [] };
      },
    },
  };

  await expect(fetchPlaceAutocompletePredictions({ input: "Kyoto", placesApi })).resolves.toEqual([]);
});

test("Phase 5.6c details adapter uses minimal fields and the autocomplete session token", async () => {
  const sessionToken = { id: "session-1" };
  const fetchCalls = [];
  const prediction = normalizeAutocompletePrediction({
    placePrediction: {
      placeId: "place-1",
      text: { text: "Kyoto Station" },
      toPlace() {
        return {
          id: "place-1",
          displayName: { text: "Kyoto Station" },
          location: { lat: () => 35.0116, lng: () => 135.7681 },
          googleMapsURI: "https://www.google.com/maps/place/?q=place_id:place-1",
          async fetchFields(request) {
            fetchCalls.push(request);
          },
        };
      },
    },
  });

  const details = await fetchPlaceDetailsForPrediction({
    fields: PLACE_DETAILS_FIELD_MASK_MINIMAL,
    placesApi: { Place: function Place() {} },
    prediction,
    sessionToken,
  });

  expect(fetchCalls).toEqual([{ fields: PLACE_DETAILS_FIELD_MASK_MINIMAL, sessionToken }]);
  expect(details).toEqual({
    id: "place-1",
    displayName: "Kyoto Station",
    latitude: 35.0116,
    longitude: 135.7681,
    googleMapsUri: "https://www.google.com/maps/place/?q=place_id:place-1",
  });
});

test("Phase 5.6e details adapter can fetch minimal fields from a place id", async () => {
  const fetchCalls = [];
  class FakePlace {
    constructor(options) {
      this.id = options.id;
      this.displayName = { text: "Kyoto University" };
      this.location = { lat: () => 35.0262, lng: () => 135.7809 };
      this.googleMapsURI = "https://maps.google.com/?cid=123";
    }

    async fetchFields(request) {
      fetchCalls.push(request);
    }
  }

  const details = await fetchPlaceDetailsForPrediction({
    fields: PLACE_DETAILS_FIELD_MASK_MINIMAL,
    placesApi: { Place: FakePlace },
    prediction: { id: "poi-place-1" },
  });

  expect(fetchCalls).toEqual([{ fields: PLACE_DETAILS_FIELD_MASK_MINIMAL, sessionToken: undefined }]);
  expect(details).toMatchObject({
    id: "poi-place-1",
    displayName: "Kyoto University",
    latitude: 35.0262,
    longitude: 135.7809,
    googleMapsUri: "https://maps.google.com/?cid=123",
  });
});

test("Phase 5.6c hotfix uses coordinate map URLs for editor validation", () => {
  const latitude = 35.0262;
  const longitude = 135.7809;
  const coordinateMapUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
  const cidGoogleMapsUri = "https://maps.google.com/?cid=123456789&g_mp=CiVnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLkdldFBsYWNl&hl=zh-TW&source=apiv3";

  expect(parseMapUrlToPoint(cidGoogleMapsUri)).toBeNull();
  expect(parseMapUrlToPoint(coordinateMapUrl)).toEqual({ latitude, longitude });
});

test("Phase 5.6c autocomplete source fetches details before opening the add editor", () => {
  const googleProviderSource = readRepoFile("src/components/map/providers/GoogleMapProvider.lazy.jsx");
  const mapPanelSource = readRepoFile("src/components/map/MapPanel.jsx");
  const appSource = readRepoFile("src/App.jsx");
  const staticProviderSource = readRepoFile("src/components/map/providers/StaticMapProvider.jsx");
  const adapterSource = readRepoFile("src/lib/googlePlacesAdapter.js");
  const stylesSource = readRepoFile("src/styles.css");
  const selectPredictionSource =
    googleProviderSource.match(/async function selectPlacePrediction\(prediction\) \{[\s\S]*?\n  \}/)?.[0] || "";
  const confirmPreviewAddSource =
    googleProviderSource.match(/function confirmPlacesPreviewAdd\(\) \{[\s\S]*?\n  \}/)?.[0] || "";
  const cancelPreviewSource =
    googleProviderSource.match(/function cancelPlacesPreview\(\) \{[\s\S]*?\n  \}/)?.[0] || "";

  expect(googleProviderSource).toContain("PLACES_AUTOCOMPLETE_DEBOUNCE_MS = 700");
  expect(googleProviderSource).toContain('placesSearchAvailable = status === "ready"');
  expect(googleProviderSource).toContain("providerConfig.placesEnabled === true");
  expect(googleProviderSource).toContain("placesSearchAvailable && !isPickingMapPoint && !isRouteEditMode");
  expect(googleProviderSource).toContain("const showPlacesSearchOverlay = placesSearchAvailable");
  expect(googleProviderSource).toContain("disabled={isRouteEditMode || isPickingMapPoint}");
  expect(googleProviderSource).toContain("input.length < 2");
  expect(googleProviderSource).toContain("window.setTimeout");
  expect(googleProviderSource).toContain("lastRequestedPlacesQueryRef");
  expect(googleProviderSource).toContain("if (input === lastRequestedPlacesQueryRef.current) return false");
  expect(googleProviderSource).toContain("placesSearchComposingRef");
  expect(googleProviderSource).toContain("placesSearchIsComposing");
  expect(googleProviderSource).toContain("onCompositionStart");
  expect(googleProviderSource).toContain("onCompositionEnd");
  expect(googleProviderSource).toContain("onKeyDown");
  expect(googleProviderSource).toContain("event.nativeEvent?.isComposing");
  expect(googleProviderSource).toContain("submitPlacesSearch(placesSearchInput)");
  expect(googleProviderSource).toContain("placesSessionManagerRef.current.getOrCreateSessionToken()");
  expect(googleProviderSource).toContain("latestPlacesLocationBiasRef");
  expect(googleProviderSource).toContain("readBoundsLocationBias(map?.getBounds?.())");
  expect(googleProviderSource).toContain("map.addListener(\"bounds_changed\", () => updatePlacesLocationBias(map))");
  expect(googleProviderSource).toContain("map.addListener(\"idle\", () => updatePlacesLocationBias(map))");
  expect(googleProviderSource).toContain("locationBias: latestPlacesLocationBiasRef.current");
  expect(googleProviderSource).not.toContain("locationRestriction");
  expect(googleProviderSource).toContain("fetchPlaceAutocompletePredictions");
  expect(googleProviderSource).toContain("fetchPlaceDetailsForPrediction");
  expect(googleProviderSource).toContain("PLACE_DETAILS_FIELD_MASK_MINIMAL");
  expect(adapterSource).toContain("googleMapsURI");
  expect(adapterSource).toContain("googleMapsUri");
  expect(adapterSource).toContain("https://www.google.com/maps?q=");
  expect(googleProviderSource).toContain("setPlacesPreview(nextPreview)");
  expect(googleProviderSource).toContain("onSelectPlaceDetails?.(placesPreview)");
  expect(googleProviderSource).toContain('placesDetailsStatus === "missing-location"');
  expect(googleProviderSource).toContain("selectedPlacePrediction");
  expect(selectPredictionSource).toContain("const originalSearchText = placesSearchInput");
  expect(selectPredictionSource).toContain("const selectedDisplayText = details.displayName || prediction.mainText || originalSearchText");
  expect(selectPredictionSource).toContain("lastRequestedPlacesQueryRef.current = selectedDisplayText.trim()");
  expect(selectPredictionSource).toContain("setPlacesSearchInput(selectedDisplayText)");
  expect(selectPredictionSource).not.toContain("prediction.description || prediction.mainText");
  expect(selectPredictionSource).toContain("setPlacesPredictions([])");
  expect(selectPredictionSource).not.toContain("setPlacesSearchInput(\"\")");
  expect(selectPredictionSource).not.toContain("resetPlacesSearch()");
  expect(confirmPreviewAddSource).toContain("onSelectPlaceDetails?.(placesPreview)");
  expect(confirmPreviewAddSource).toContain("resetPlacesSearch()");
  expect(cancelPreviewSource).toContain("clearPlacesPreview()");
  expect(cancelPreviewSource).toContain("resetPlacesSearch()");
  expect(googleProviderSource).toContain("placesSessionManagerRef.current.resetSessionToken()");
  expect(googleProviderSource).toContain("places-search-overlay");
  expect(googleProviderSource).toContain("places-search-control");
  expect(googleProviderSource).toContain("places-search-button");
  expect(googleProviderSource).toContain("aria-label=\"搜尋地點\"");
  expect(googleProviderSource).toContain("const placesStatusMessage");
  expect(googleProviderSource).toContain("placeholder=\"搜尋地點或貼上 Google Maps 連結\"");
  expect(googleProviderSource).not.toContain("placeholder=\"\\\\u641c\\\\u5c0b\\\\u5730\\\\u9ede\"");
  expect(googleProviderSource).not.toContain("placeholder=\"\\u641c\\u5c0b\\u5730\\u9ede...\"");
  expect(googleProviderSource).not.toContain("onSaveItem");
  expect(googleProviderSource).not.toContain("supabase");
  expect(mapPanelSource).toContain("onSelectPlaceDetails");
  expect(appSource).toContain('? "places-details" : "places-replace"');
  expect(appSource).toContain('pickedMapPoint.source === "places-details"');
  expect(appSource).toContain("void openNewItem(pickedMapPoint)");
  expect(appSource).toContain("displayName: details.displayName || \"\"");
  expect(appSource).toContain("googleMapsUri: isMapUrlPoint");
  expect(appSource).toContain("? details.googleMapsUri || googleMapsPointUrl(latitude, longitude)");
  expect(appSource).toContain(": googleMapsPointUrl(latitude, longitude)");
  expect(appSource).toContain("title: placeName");
  expect(appSource).toContain("location_name: placeName");
  expect(appSource).toContain('String(initialPoint?.googleMapsUri || "").trim() || googleMapsPointUrl(latitude, longitude)');
  expect(appSource).not.toContain("provider_place_id");
  expect(staticProviderSource).not.toContain("places-search-overlay");
  expect(staticProviderSource).not.toContain("map-route-edit-button");
  expect(adapterSource).toContain("AutocompleteSuggestion");
  expect(adapterSource).toContain("getPlacePredictions");
  expect(adapterSource).toContain("fetchFields({ fields, sessionToken })");
  expect(adapterSource).not.toContain("formattedAddress");
  expect(stylesSource).toContain(".places-search-overlay");
  expect(stylesSource).toContain("grid-template-columns: minmax(0, 1fr) auto;");
  expect(stylesSource).toContain("display: contents;");
  expect(stylesSource).toContain("grid-column: 1;");
  expect(stylesSource).toContain("top: 18px;");
  expect(stylesSource).toContain("left: 20px;");
  expect(stylesSource).toContain("width: min(470px, calc(100% - 40px));");
  expect(stylesSource).toContain("min-height: 38px;");
  expect(stylesSource).toContain("padding-left: 24px;");
  expect(stylesSource).toContain("background: var(--map-glass-bg-fallback);");
  expect(stylesSource).toContain("border-radius: 10px;");
  expect(stylesSource).toContain("font-size: 14px;");
  expect(stylesSource).toContain("font-weight: 500;");
  expect(stylesSource).toContain("right: 10px;");
  expect(stylesSource).toContain(".places-search-button");
  expect(stylesSource).toContain(".places-prediction-list");
  expect(stylesSource).toMatch(/\.places-prediction-list,\s*\.places-search-message \{/);
  expect(stylesSource).toContain("padding: 10px 24px;");
  expect(stylesSource).toContain(".route-panel:has(.places-search-overlay) > .panel-heading");
  expect(googleProviderSource.match(/isPickingMapPoint \|\| isMapAddLocationActive/g)).toHaveLength(2);
  expect(appSource).toContain('field-inline-error visit-map-url-error');
});

test("Map add-location tools share the route mask, accent state, order, and search cancel behavior", () => {
  const googleProviderSource = readRepoFile("src/components/map/providers/GoogleMapProvider.lazy.jsx");
  const stylesSource = readRepoFile("src/styles.css");
  const toolsSource = googleProviderSource.match(/const renderMapAreaTools = [\s\S]*?\n  \);/)?.[0] || "";

  expect(googleProviderSource).toContain("mapRect.top + ROUTE_EDIT_ACTIVE_TOP_INSET_PX");
  expect(googleProviderSource).toContain("isMapAddLocationActive || isPickingMapPoint");
  expect(googleProviderSource).toContain('isPickingMapPoint ? "取消選點" : "離開路線編輯模式"');
  expect(googleProviderSource).toContain("isPickingMapPoint ? onCancelMapPointPick : exitRouteEditMode");
  expect(googleProviderSource).toContain("function cancelPlacesSearchInput(event)");
  expect(googleProviderSource).toContain("const showPlacesSearchCancel = !isMapAddLocationActive && hasPlacesSearchInput");
  expect(googleProviderSource).toContain('showPlacesSearchCancel ? "清除搜尋"');
  expect(googleProviderSource).toContain("showPlacesSearchCancel || isPickingMapPoint ? <X");
  expect(toolsSource.indexOf("map-area-point-button")).toBeLessThan(toolsSource.indexOf("map-route-edit-button"));
  expect(toolsSource).toContain('isRouteEditMode ? <X aria-hidden="true" /> : <Route aria-hidden="true" />');
  expect(stylesSource).toContain(".google-map-surface.is-map-add-location .places-search-control");
  expect(stylesSource).toContain(".google-map-surface.is-map-add-location .places-search-button");
  expect(stylesSource).toContain("border-color: var(--color-accent)");
  expect(stylesSource).toContain("color: var(--color-accent)");
});

test("Map search handles Google Maps URLs without Places requests", () => {
  const googleProviderSource = readRepoFile("src/components/map/providers/GoogleMapProvider.lazy.jsx");
  const applyUrlSource =
    googleProviderSource.match(/async function applyGoogleMapsUrlInput\(rawInput\) \{[\s\S]*?\n  \}/)?.[0] || "";
  const requestAutocompleteSource =
    googleProviderSource.match(/async function requestPlacesAutocomplete\(rawInput\) \{[\s\S]*?\n  \}/)?.[0] || "";

  expect(requestAutocompleteSource).toContain("if (isGoogleMapsUrl(input)) return false");
  expect(applyUrlSource).toContain("resolveDestinationMapUrlPoint(input");
  expect(applyUrlSource).toContain("resolveShortUrl: resolveGoogleMapsShortUrl");
  expect(applyUrlSource).toContain("result.expandedUrl || input");
  expect(applyUrlSource).toContain("placesUrlRequestSeqRef.current !== requestId");
  expect(applyUrlSource).toContain('source: "map-url"');
  expect(applyUrlSource).toContain("showPlacesPreview({");
  expect(applyUrlSource).not.toContain("fetchPlaceAutocompletePredictions");
  expect(applyUrlSource).not.toContain("fetchPlaceDetailsForPrediction");
  expect(applyUrlSource).not.toContain("clearPlacesPreview()");
  expect(googleProviderSource).toContain("無法從這個 Google Maps 連結取得座標");
  expect(googleProviderSource).toContain("正在展開 Google Maps 連結...");
  expect(googleProviderSource).toContain('placesPreview.source === "map-url"');
});

test("Phase 5.6d places details show a map preview before opening the add editor", () => {
  const googleProviderSource = readRepoFile("src/components/map/providers/GoogleMapProvider.lazy.jsx");
  const appSource = readRepoFile("src/App.jsx");
  const staticProviderSource = readRepoFile("src/components/map/providers/StaticMapProvider.jsx");
  const stylesSource = readRepoFile("src/styles.css");
  const previewDialogCss = stylesSource.match(/\.places-preview-dialog \{[\s\S]*?\n\}/)?.[0] || "";

  expect(googleProviderSource).toContain("const [placesPreview, setPlacesPreview] = useState(null)");
  expect(googleProviderSource).toContain("placesPreviewMarkerRef");
  expect(googleProviderSource).toContain("placesPreviewOverlayRef");
  expect(googleProviderSource).toContain("const [placesPreviewDialogPosition, setPlacesPreviewDialogPosition] = useState(null)");
  expect(googleProviderSource).toContain("PLACES_PREVIEW_ZOOM = 15");
  expect(googleProviderSource).toContain("setPlacesPreview(nextPreview)");
  expect(googleProviderSource).toContain("mapRef.current?.panTo?.({ lat: latitude, lng: longitude })");
  expect(googleProviderSource).toContain("new MarkerConstructor({");
  expect(googleProviderSource).toContain("zIndex: 3000");
  expect(googleProviderSource).toContain("const OverlayViewConstructor = mapsNamespace?.OverlayView");
  expect(googleProviderSource).toContain("new OverlayViewConstructor()");
  expect(googleProviderSource).toContain("fromLatLngToContainerPixel");
  expect(googleProviderSource).toContain("fromLatLngToDivPixel");
  expect(googleProviderSource).toContain("anchoredDialogPosition(pixel, mapElementRef.current)");
  expect(googleProviderSource).toContain("placesPreviewDialogPosition.left");
  expect(googleProviderSource).toContain("placesPreviewDialogPosition.top");
  expect(googleProviderSource).toContain("anchored-${placesPreviewDialogPosition?.placement");
  expect(googleProviderSource).toContain("map.addListener(\"dragstart\", markUserViewportChange)");
  expect(googleProviderSource).toContain("map.addListener(\"zoom_changed\", markUserViewportChange)");
  expect(googleProviderSource).toContain("if (target?.closest?.(\".google-map-surface\")) return");
  expect(googleProviderSource).toContain("className=\"primary-button places-preview-add-button\"");
  expect(googleProviderSource).toContain("function confirmPlacesPreviewAdd()");
  expect(googleProviderSource).toContain("function cancelPlacesPreview()");
  expect(googleProviderSource).toContain("onClick={cancelPlacesPreview}");
  expect(googleProviderSource).toContain("onSelectPlaceDetails?.(placesPreview)");
  expect(googleProviderSource).toContain("placesPreview.googleMapsUri || placesPreview.mapUrl");
  expect(googleProviderSource).toContain("target=\"_blank\"");
  expect(googleProviderSource).not.toContain("window.open(url");
  expect(googleProviderSource).toContain("clearPlacesPreview();");
  expect(googleProviderSource).toContain("toggleMapAreaPointPick");
  expect(googleProviderSource).toContain("setPlacesPreview(null)");
  expect(googleProviderSource).not.toContain("setPickedMapPoint(nextPreview)");
  expect(appSource).toContain("void openNewItem(pickedMapPoint)");
  expect(appSource).toContain('String(initialPoint?.googleMapsUri || "").trim() || googleMapsPointUrl(latitude, longitude)');
  expect(staticProviderSource).not.toContain("places-preview-dialog");
  expect(stylesSource).toContain(".places-preview-dialog");
  expect(stylesSource).toContain(".places-preview-add-button");
  expect(stylesSource).toContain(".places-preview-dialog.anchored-pending");
  expect(previewDialogCss).toContain("left: 0;");
  expect(previewDialogCss).toContain("top: 0;");
  expect(previewDialogCss).not.toContain("right:");
  expect(previewDialogCss).not.toContain("bottom:");
});

test("Phase 5.6e POI clicks show a pending marker before Place Details", () => {
  const googleProviderSource = readRepoFile("src/components/map/providers/GoogleMapProvider.lazy.jsx");
  const staticProviderSource = readRepoFile("src/components/map/providers/StaticMapProvider.jsx");
  const adapterSource = readRepoFile("src/lib/googlePlacesAdapter.js");
  const stylesSource = readRepoFile("src/styles.css");

  expect(adapterSource).toContain("new placesApi.Place({ id: prediction.id })");
  expect(adapterSource).toContain("await place.fetchFields({ fields, sessionToken })");
  expect(googleProviderSource).toContain("clickableIcons: true");
  expect(googleProviderSource).toContain("const placeId = typeof event?.placeId === \"string\" ? event.placeId : \"\"");
  expect(googleProviderSource).toContain("event.stop?.()");
  expect(googleProviderSource).toContain("if (isPickingMapPoint)");
  expect(googleProviderSource).toContain("setPendingPoi({");
  expect(googleProviderSource).toContain("pendingPoiMarkerRef.current = new MarkerConstructor({");
  expect(googleProviderSource).toContain("label: { text: \"i\", color: \"#ffffff\", fontSize: \"16px\", fontWeight: \"900\" }");
  expect(googleProviderSource).toContain("pendingPoiMarkerRef.current.addListener?.(\"click\"");
  expect(googleProviderSource).toContain("pendingPoiHintOverlayRef");
  expect(googleProviderSource).toContain("setPendingPoiHintPosition(anchoredHintPosition(pixel, mapElementRef.current))");
  expect(googleProviderSource).toContain("className=\"places-pending-hint\"");
  expect(googleProviderSource).toContain("\"\\u9ede\\u64ca\\u52a0\\u5165\\u5730\\u9ede\"");
  expect(googleProviderSource).toContain("function confirmPendingPoi()");
  expect(googleProviderSource).toContain("placeDetailsCacheRef.current.get(pendingPoi.placeId)");
  expect(googleProviderSource).toContain("placeDetailsCacheRef.current.set(pendingPoi.placeId, details)");
  expect(googleProviderSource).toContain("prediction: { id: pendingPoi.placeId }");
  expect(googleProviderSource).toContain("fields: PLACE_DETAILS_FIELD_MASK_MINIMAL");
  expect(googleProviderSource).toContain("clearPendingPoi();");
  expect(googleProviderSource).toContain("showPlacesPreview(details, pendingPoi.displayName)");
  expect(googleProviderSource).not.toContain("pendingPoiStatus");
  expect(googleProviderSource).not.toContain("pendingPoiDialogPosition");
  expect(googleProviderSource).not.toContain("places-poi-mini-dialog");
  expect(googleProviderSource).not.toContain("places-poi-confirm-button");
  expect(googleProviderSource).not.toContain("\\u8981\\u52a0\\u5165\\u9019\\u500b\\u5730\\u9ede");
  expect(googleProviderSource).not.toContain("\\u4f7f\\u7528\\u6b64\\u5730\\u9ede");
  expect(googleProviderSource).not.toContain("TextSearch");
  expect(googleProviderSource).not.toContain("NearbySearch");
  expect(googleProviderSource).not.toContain("Geocoder");
  expect(staticProviderSource).not.toContain("places-poi-mini-dialog");
  expect(staticProviderSource).not.toContain("places-pending-hint");
  expect(stylesSource).toContain(".places-pending-hint");
  expect(stylesSource).not.toContain(".places-poi-mini-dialog");
  expect(stylesSource).not.toContain(".places-poi-confirm-button");
});
