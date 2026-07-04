import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  createPlacesAutocompleteSessionManager,
  normalizePlaceDetailsResult,
} from "../src/lib/googlePlacesAdapter.js";
import {
  assertAllowedPlaceDetailsFields,
  getPlacesLibraries,
  isPlacesEnabled,
  PLACE_DETAILS_FIELD_MASK_MINIMAL,
  PLACE_DETAILS_HIGH_COST_FIELDS,
} from "../src/lib/googlePlacesConfig.js";
import { getMapProviderConfig, MAP_PROVIDER_IDS } from "../src/lib/mapProviderConfig.js";

const repoRoot = process.cwd();

function readRepoFile(filePath) {
  return fs.readFileSync(path.join(repoRoot, filePath), "utf8");
}

test("Phase 5.6a gates Places behind formal Google provider, API key, and env flag", () => {
  const enabledConfig = getMapProviderConfig({
    mode: "formal",
    providerId: MAP_PROVIDER_IDS.GOOGLE,
    enableRealMap: true,
    apiKey: "fake-test-key",
    placesEnabled: "true",
  });

  expect(enabledConfig).toMatchObject({
    mode: "formal",
    providerId: MAP_PROVIDER_IDS.GOOGLE,
    canLoadRealMap: true,
    apiKeyAvailable: true,
    placesEnabled: true,
    placesLibraries: ["places"],
  });
  expect(isPlacesEnabled(enabledConfig)).toBe(true);
  expect(getPlacesLibraries(enabledConfig)).toEqual(["places"]);

  [
    getMapProviderConfig({ mode: "demo", providerId: MAP_PROVIDER_IDS.GOOGLE, enableRealMap: true, apiKey: "fake", placesEnabled: "true" }),
    getMapProviderConfig({ mode: "formal", providerId: MAP_PROVIDER_IDS.STATIC, enableRealMap: true, apiKey: "fake", placesEnabled: "true" }),
    getMapProviderConfig({ mode: "formal", providerId: MAP_PROVIDER_IDS.GOOGLE, enableRealMap: true, placesEnabled: "true" }),
    getMapProviderConfig({ mode: "formal", providerId: MAP_PROVIDER_IDS.GOOGLE, enableRealMap: true, apiKey: "fake", placesEnabled: "" }),
    getMapProviderConfig({ mode: "formal", providerId: MAP_PROVIDER_IDS.GOOGLE, enableRealMap: true, apiKey: "fake", placesEnabled: "false" }),
  ].forEach((config) => {
    expect(isPlacesEnabled(config)).toBe(false);
    expect(getPlacesLibraries(config)).toEqual([]);
  });
});

test("Phase 5.6a keeps Place Details field mask minimal and blocks high-cost fields", () => {
  expect(PLACE_DETAILS_FIELD_MASK_MINIMAL).toEqual(["id", "displayName", "location", "googleMapsURI"]);
  expect(assertAllowedPlaceDetailsFields(PLACE_DETAILS_FIELD_MASK_MINIMAL)).toBe(PLACE_DETAILS_FIELD_MASK_MINIMAL);
  expect(PLACE_DETAILS_HIGH_COST_FIELDS).toEqual(
    expect.arrayContaining([
      "rating",
      "formattedAddress",
      "reviews",
      "photos",
      "regularOpeningHours",
      "currentOpeningHours",
      "internationalPhoneNumber",
      "nationalPhoneNumber",
      "websiteUri",
      "priceLevel",
      "businessStatus",
      "editorialSummary",
      "generativeSummary",
    ]),
  );
  expect(() => assertAllowedPlaceDetailsFields(["id", "rating"])).toThrow("Disallowed Place Details fields: rating");
});

test("Phase 5.6a session manager reuses one autocomplete token until reset", () => {
  let createdCount = 0;
  class FakeAutocompleteSessionToken {
    constructor() {
      createdCount += 1;
      this.id = `token-${createdCount}`;
    }
  }
  const manager = createPlacesAutocompleteSessionManager(() => ({
    AutocompleteSessionToken: FakeAutocompleteSessionToken,
  }));

  const first = manager.getOrCreateSessionToken();
  const second = manager.getOrCreateSessionToken();
  expect(second).toBe(first);
  expect(createdCount).toBe(1);

  manager.resetSessionToken();
  const third = manager.getOrCreateSessionToken();
  expect(third).not.toBe(first);
  expect(createdCount).toBe(2);
});

test("Phase 5.6a normalizes only minimal Place Details result fields", () => {
  const normalized = normalizePlaceDetailsResult({
    id: "place-1",
    displayName: { text: "Kyoto Station" },
    location: { lat: () => 35.0116, lng: () => 135.7681 },
    googleMapsURI: "https://www.google.com/maps/place/?q=place_id:place-1",
    rating: 4.7,
    reviews: [{ text: "not allowed" }],
  });

  expect(normalized).toEqual({
    id: "place-1",
    displayName: "Kyoto Station",
    latitude: 35.0116,
    longitude: 135.7681,
    googleMapsUri: "https://www.google.com/maps/place/?q=place_id:place-1",
  });
  expect(JSON.stringify(normalized)).not.toContain("rating");
  expect(JSON.stringify(normalized)).not.toContain("reviews");
});

test("Phase 5.6c normalizes Google Maps URI casing and location fallback", () => {
  expect(
    normalizePlaceDetailsResult({
      id: "place-upper",
      displayName: "Upper URI",
      location: { lat: 35.0116, lng: 135.7681 },
      googleMapsURI: "https://www.google.com/maps/place/upper",
    }).googleMapsUri,
  ).toBe("https://www.google.com/maps/place/upper");

  expect(
    normalizePlaceDetailsResult({
      id: "place-lower",
      displayName: "Lower Uri",
      location: { lat: 35.0116, lng: 135.7681 },
      googleMapsUri: "https://www.google.com/maps/place/lower",
    }).googleMapsUri,
  ).toBe("https://www.google.com/maps/place/lower");

  expect(
    normalizePlaceDetailsResult({
      id: "place-fallback",
      displayName: "Fallback URI",
      location: { lat: 35.0116, lng: 135.7681 },
    }).googleMapsUri,
  ).toBe("https://www.google.com/maps?q=35.0116,135.7681");
});

test("Phase 5.6a source keeps Places prep UI-free and request-free", () => {
  const loaderSource = readRepoFile("src/lib/googleMapsLoader.js");
  const mapPanelSource = readRepoFile("src/components/map/MapPanel.jsx");
  const googleProviderSource = readRepoFile("src/components/map/providers/GoogleMapProvider.lazy.jsx");
  const staticProviderSource = readRepoFile("src/components/map/providers/StaticMapProvider.jsx");

  expect(mapPanelSource).toContain("VITE_GOOGLE_MAPS_PLACES_ENABLED");
  expect(googleProviderSource).toContain("loadGoogleMapsApi({ apiKey, libraries: placesLibraries })");
  expect(loaderSource).toContain("requestedLibraries");
  expect(loaderSource).toContain("extraLibraries[library] = await importLibrary(library)");
  expect(googleProviderSource).not.toContain("Place Details");
  expect(googleProviderSource).not.toContain("fetchFields");
  expect(staticProviderSource).not.toContain("places");
});
