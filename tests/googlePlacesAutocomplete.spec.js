import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  fetchPlaceDetailsForPrediction,
  fetchPlaceAutocompletePredictions,
  normalizeAutocompletePrediction,
} from "../src/lib/googlePlacesAdapter.js";
import { PLACE_DETAILS_FIELD_MASK_MINIMAL } from "../src/lib/googlePlacesConfig.js";

const repoRoot = process.cwd();

function readRepoFile(filePath) {
  return fs.readFileSync(path.join(repoRoot, filePath), "utf8");
}

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

test("Phase 5.6b autocomplete adapter skips short input and uses session token", async () => {
  const sessionToken = { id: "session-1" };
  let calls = 0;
  const placesApi = {
    AutocompleteSuggestion: {
      async fetchAutocompleteSuggestions(request) {
        calls += 1;
        expect(request).toMatchObject({ input: "Kyoto", sessionToken });
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
  const predictions = await fetchPlaceAutocompletePredictions({ input: "Kyoto", sessionToken, placesApi });

  expect(calls).toBe(1);
  expect(predictions).toHaveLength(1);
  expect(predictions[0]).toMatchObject({ id: "place-1", description: "Kyoto Station" });
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
          googleMapsUri: "https://www.google.com/maps/place/?q=place_id:place-1",
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

test("Phase 5.6c autocomplete source fetches details before opening the add editor", () => {
  const googleProviderSource = readRepoFile("src/components/map/providers/GoogleMapProvider.lazy.jsx");
  const mapPanelSource = readRepoFile("src/components/map/MapPanel.jsx");
  const appSource = readRepoFile("src/App.jsx");
  const staticProviderSource = readRepoFile("src/components/map/providers/StaticMapProvider.jsx");
  const adapterSource = readRepoFile("src/lib/googlePlacesAdapter.js");
  const stylesSource = readRepoFile("src/styles.css");

  expect(googleProviderSource).toContain("PLACES_AUTOCOMPLETE_DEBOUNCE_MS = 350");
  expect(googleProviderSource).toContain("canSearchPlaces = status === \"ready\"");
  expect(googleProviderSource).toContain("providerConfig.placesEnabled === true");
  expect(googleProviderSource).toContain("placesReady && !isPickingMapPoint");
  expect(googleProviderSource).toContain("input.length < 2");
  expect(googleProviderSource).toContain("window.setTimeout");
  expect(googleProviderSource).toContain("placesSessionManagerRef.current.getOrCreateSessionToken()");
  expect(googleProviderSource).toContain("fetchPlaceAutocompletePredictions");
  expect(googleProviderSource).toContain("fetchPlaceDetailsForPrediction");
  expect(googleProviderSource).toContain("PLACE_DETAILS_FIELD_MASK_MINIMAL");
  expect(googleProviderSource).toContain("onSelectPlaceDetails?.({");
  expect(googleProviderSource).toContain('placesDetailsStatus === "missing-location"');
  expect(googleProviderSource).toContain("selectedPlacePrediction");
  expect(googleProviderSource).toContain("placesSessionManagerRef.current.resetSessionToken()");
  expect(googleProviderSource).toContain("places-search-overlay");
  expect(googleProviderSource).toContain("const placesStatusMessage");
  expect(googleProviderSource).toContain("placeholder=\"\\u641c\\u5c0b\\u5730\\u9ede...\"");
  expect(googleProviderSource).not.toContain("onSaveItem");
  expect(googleProviderSource).not.toContain("supabase");
  expect(mapPanelSource).toContain("onSelectPlaceDetails");
  expect(appSource).toContain('source: "places-details"');
  expect(appSource).toContain('pickedMapPoint.source === "places-details"');
  expect(appSource).toContain("void openNewItem(pickedMapPoint)");
  expect(appSource).toContain("displayName: details.displayName || \"\"");
  expect(appSource).toContain("googleMapsUri: details.googleMapsUri || \"\"");
  expect(appSource).toContain("title: placeName");
  expect(appSource).toContain("location_name: placeName");
  expect(appSource).toContain("map_url: hasPoint ? mapUrl || googleMapsPointUrl(latitude, longitude) : \"\"");
  expect(appSource).not.toContain("provider_place_id");
  expect(staticProviderSource).not.toContain("places-search-overlay");
  expect(adapterSource).toContain("AutocompleteSuggestion");
  expect(adapterSource).toContain("getPlacePredictions");
  expect(adapterSource).toContain("fetchFields({ fields, sessionToken })");
  expect(adapterSource).not.toContain("formattedAddress");
  expect(stylesSource).toContain(".places-search-overlay");
  expect(stylesSource).toContain(".places-prediction-list");
  expect(stylesSource).toContain(".route-panel:has(.places-search-overlay) > .panel-heading");
});
