import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  fetchPlaceAutocompletePredictions,
  normalizeAutocompletePrediction,
} from "../src/lib/googlePlacesAdapter.js";

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

test("Phase 5.6b autocomplete source is gated, debounced, and selection-only", () => {
  const googleProviderSource = readRepoFile("src/components/map/providers/GoogleMapProvider.lazy.jsx");
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
  expect(googleProviderSource).toContain("selectedPlacePrediction");
  expect(googleProviderSource).toContain("placesSessionManagerRef.current.resetSessionToken()");
  expect(googleProviderSource).toContain("places-search-overlay");
  expect(googleProviderSource).toContain('["loading", "empty", "error"].includes(placesSearchStatus)');
  expect(googleProviderSource).toContain("placeholder=\"\\u641c\\u5c0b\\u5730\\u9ede...\"");
  expect(googleProviderSource).not.toContain("fetchFields");
  expect(googleProviderSource).not.toContain("normalizePlaceDetailsResult");
  expect(staticProviderSource).not.toContain("places-search-overlay");
  expect(adapterSource).toContain("AutocompleteSuggestion");
  expect(adapterSource).toContain("getPlacePredictions");
  expect(stylesSource).toContain(".places-search-overlay");
  expect(stylesSource).toContain(".places-prediction-list");
});
