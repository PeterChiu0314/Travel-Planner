import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { buildDayMapMarkers } from "../src/lib/timelineMapMarkers.js";

const repoRoot = process.cwd();

function readDemoTrip() {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, "src/demo-kyoto-trip.json"), "utf8"));
}

test("Phase 4.9a builds provider-neutral markers for destination items", () => {
  const markers = buildDayMapMarkers([
    {
      id: "visit-a",
      item_type: "visit",
      title: "Fushimi Inari",
      location_name: "Fushimi Inari Taisha",
      address: "68 Fukakusa Yabunouchicho",
      map_url: "https://maps.example/visit-a",
      latitude: "34.9671",
      longitude: "135.7727",
      day_index: "1",
      sort_order: "20",
    },
  ]);

  expect(markers).toEqual([
    {
      id: "map-marker:visit-a",
      itemId: "visit-a",
      itemType: "destination",
      title: "Fushimi Inari",
      locationName: "Fushimi Inari Taisha",
      address: "68 Fukakusa Yabunouchicho",
      mapUrl: "https://maps.example/visit-a",
      latitude: 34.9671,
      longitude: 135.7727,
      hasCoordinates: true,
      coordinateSource: "stored",
      provider: null,
      providerPlaceId: null,
      dayIndex: 1,
      sortOrder: 20,
    },
  ]);
});

test("Phase 4.9a excludes transportation cards and keeps marker order", () => {
  const markers = buildDayMapMarkers([
    { id: "visit-a", item_type: "visit", location_name: "A" },
    { id: "transport-a-b", item_type: "transport", title: "Train", from_item_id: "visit-a", to_item_id: "visit-b" },
    { id: "visit-b", item_type: "visit", location_name: "B" },
    { id: "legacy-transport", type: "transport", title: "Bus" },
    { id: "visit-c", type: "hotel", title: "Hotel C", location: "C" },
  ]);

  expect(markers.map((marker) => marker.itemId)).toEqual(["visit-a", "visit-b", "visit-c"]);
});

test("Phase 4.9a handles missing and invalid coordinates without throwing", () => {
  expect(() =>
    buildDayMapMarkers([
      { id: "visit-a", item_type: "visit", location_name: "A", latitude: "", longitude: null },
      { id: "visit-b", item_type: "visit", location_name: "B", latitude: "north", longitude: "135.7" },
    ]),
  ).not.toThrow();

  const markers = buildDayMapMarkers([
    { id: "visit-a", item_type: "visit", location_name: "A", latitude: "", longitude: null },
    { id: "visit-b", item_type: "visit", location_name: "B", latitude: "north", longitude: "135.7" },
  ]);

  expect(markers).toMatchObject([
    { itemId: "visit-a", latitude: null, longitude: null, hasCoordinates: false, coordinateSource: "missing" },
    { itemId: "visit-b", latitude: null, longitude: 135.7, hasCoordinates: false, coordinateSource: "missing" },
  ]);
});

test("Phase 4.9a preserves neutral provider fields without binding to Google", () => {
  const markers = buildDayMapMarkers([
    {
      id: "visit-a",
      item_type: "visit",
      title: "Provider-backed place",
      location_name: "Provider Place",
      map_provider: "maptiler",
      provider_place_id: "provider-place-1",
    },
  ]);

  expect(markers[0]).toMatchObject({
    provider: "maptiler",
    providerPlaceId: "provider-place-1",
  });
});

test("Phase 4.9a does not mutate input items", () => {
  const items = [
    {
      id: "visit-a",
      item_type: "visit",
      title: "A",
      location_name: "A",
      latitude: "35",
      longitude: "135",
    },
  ];
  const snapshot = structuredClone(items);

  buildDayMapMarkers(items);

  expect(items).toEqual(snapshot);
});

test("Phase 5.1a Demo fixture includes mock coordinates for static map markers", () => {
  const demoTrip = readDemoTrip();
  const dayOneMarkers = buildDayMapMarkers(
    demoTrip.itinerary_items.filter((item) => item.day_index === 1),
    { requireLocation: true },
  );

  expect(dayOneMarkers.length).toBeGreaterThan(0);
  expect(dayOneMarkers.some((marker) => marker.hasCoordinates)).toBe(true);
  expect(dayOneMarkers.filter((marker) => marker.hasCoordinates).length).toBeGreaterThanOrEqual(4);
});
