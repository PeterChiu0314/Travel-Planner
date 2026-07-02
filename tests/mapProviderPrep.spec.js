import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { buildMapProviderAdapterInput } from "../src/lib/mapProviderAdapter.js";
import { getMapProviderConfig, MAP_PROVIDER_IDS } from "../src/lib/mapProviderConfig.js";

const repoRoot = process.cwd();

function readRepoFile(filePath) {
  return fs.readFileSync(path.join(repoRoot, filePath), "utf8");
}

test("Phase 4.9c keeps the default map provider static and Google lazy-only", () => {
  expect(getMapProviderConfig()).toEqual({
    providerId: MAP_PROVIDER_IDS.STATIC,
    loadMode: "eager",
    canLoadRealMap: false,
    fallbackProviderId: MAP_PROVIDER_IDS.STATIC,
  });

  expect(getMapProviderConfig({ providerId: MAP_PROVIDER_IDS.GOOGLE })).toMatchObject({
    providerId: MAP_PROVIDER_IDS.GOOGLE,
    loadMode: "lazy",
    canLoadRealMap: false,
    fallbackProviderId: MAP_PROVIDER_IDS.STATIC,
  });
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

test("Phase 4.9c does not load Google SDK, env keys, or map packages in the main app path", () => {
  const appSource = readRepoFile("src/App.jsx");
  const packageJson = readRepoFile("package.json");
  const mapPanelSource = readRepoFile("src/components/map/MapPanel.jsx");

  expect(mapPanelSource).toContain('import("./providers/GoogleMapProvider.lazy.jsx")');
  expect(appSource).not.toContain("VITE_GOOGLE_MAPS_API_KEY");
  expect(appSource).not.toContain("@googlemaps");
  expect(appSource).not.toContain("google.maps");
  expect(mapPanelSource).not.toContain("@googlemaps");
  expect(mapPanelSource).not.toContain("google.maps");
  expect(packageJson).not.toContain("@googlemaps");
  expect(packageJson).not.toContain("@react-google-maps");
  expect(packageJson).not.toContain("leaflet");
  expect(packageJson).not.toContain("maplibre");
});
