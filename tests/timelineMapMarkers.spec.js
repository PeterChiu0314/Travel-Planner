import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { buildDayMapMarkers } from "../src/lib/timelineMapMarkers.js";
import { buildDestinationMarkerSvg } from "../src/lib/mapMarkerVisuals.js";
import { timelineTypeMarkerTextColor } from "../src/lib/timelineTypeStyles.js";

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
      category: "attraction",
      markerColor: "#2f8f72",
      markerFillColor: "#dcefe8",
      sequenceNumber: 1,
      dayIndex: 1,
      sortOrder: 20,
    },
  ]);
});

test("Phase 5.8a maps destination marker colors from the existing Timeline card type", () => {
  const markers = buildDayMapMarkers([
    { id: "attraction", item_type: "visit", type: "attraction", location_name: "A", map_url: "https://maps.example/a" },
    { id: "hotel", item_type: "visit", type: "hotel", location_name: "B", map_url: "https://maps.example/b" },
    { id: "transport-place", item_type: "visit", type: "transport", location_name: "C", map_url: "https://maps.example/c" },
    { id: "unknown", item_type: "visit", type: "unknown", location_name: "D", map_url: "https://maps.example/d" },
  ]);

  expect(markers.map((marker) => marker.category)).toEqual(["attraction", "hotel", "transport", "attraction"]);
  expect(markers.map((marker) => marker.markerColor)).toEqual(["#2f8f72", "#7865a8", "#5f8fb8", "#2f8f72"]);
  expect(markers.map((marker) => marker.markerFillColor)).toEqual(["#dcefe8", "#e8e1f2", "#e0edf6", "#dcefe8"]);
});

test("Phase 5.8a deepens only marker number colors by category", () => {
  expect(["attraction", "food", "hotel", "transport", "note"].map(timelineTypeMarkerTextColor)).toEqual([
    "#1a4e3e",
    "#974333",
    "#4a3e67",
    "#3d5c77",
    "#774e10",
  ]);
});

test("Phase 5.8a focused marker uses the category color with white focus styling", () => {
  const svg = buildDestinationMarkerSvg({
    color: "#d85f49",
    fillColor: "#f9dfd8",
    textColor: "#974333",
    focused: true,
  });

  expect(svg).toContain('stroke="#ffffff" stroke-width="2.4" stroke-opacity="0.24"');
  expect(svg).toContain('fill="#d85f49" stroke="#ffffff" stroke-width="2.6"');
  expect(svg).toContain('fill="#ffffff" stroke="#ffffff" stroke-width="0.2"');
  expect(svg).not.toContain('fill="#f9dfd8"');
  expect(svg).not.toContain('fill="#974333"');
});

test("Phase 4.9a excludes transportation cards and keeps marker order", () => {
  const markers = buildDayMapMarkers([
    { id: "visit-a", item_type: "visit", location_name: "A", map_url: "https://maps.example/a" },
    { id: "transport-a-b", item_type: "transport", title: "Train", from_item_id: "visit-a", to_item_id: "visit-b" },
    { id: "visit-b", item_type: "visit", location_name: "B", map_url: "https://maps.example/b" },
    { id: "transport-b-c", item_type: "transport", type: "transport", title: "Bus" },
    { id: "visit-c", type: "hotel", title: "Hotel C", location: "C", map_url: "https://maps.example/c" },
  ]);

  expect(markers.map((marker) => marker.itemId)).toEqual(["visit-a", "visit-b", "visit-c"]);
  expect(markers.map((marker) => marker.sequenceNumber)).toEqual([1, 2, 3]);
});

test("Phase 5.4 hotfix keeps transport-category destinations as markers", () => {
  const markers = buildDayMapMarkers([
    {
      id: "visit-airport",
      item_type: "visit",
      type: "transport",
      title: "Kansai Airport",
      location_name: "Kansai International Airport",
      map_url: "https://maps.example/airport",
      latitude: "34.4347",
      longitude: "135.244",
    },
    {
      id: "transport-airport-hotel",
      item_type: "transport",
      type: "transport",
      title: "Train",
      from_item_id: "visit-airport",
      to_item_id: "visit-hotel",
      map_url: "https://maps.example/train",
      latitude: "34.5",
      longitude: "135.3",
    },
    {
      id: "visit-hotel",
      item_type: "visit",
      type: "hotel",
      title: "Hotel",
      location_name: "Hotel",
      map_url: "https://maps.example/hotel",
      latitude: "34.7",
      longitude: "135.5",
    },
  ]);

  expect(markers.map((marker) => marker.itemId)).toEqual(["visit-airport", "visit-hotel"]);
  expect(markers.map((marker) => marker.sequenceNumber)).toEqual([1, 2]);
  expect(markers[0]).toMatchObject({
    itemId: "visit-airport",
    latitude: 34.4347,
    longitude: 135.244,
    hasCoordinates: true,
  });
});

test("Phase 5.4 keeps marker labels aligned to Timeline destination sequence", () => {
  const markers = buildDayMapMarkers([
    {
      id: "visit-a",
      item_type: "visit",
      location_name: "A",
      map_url: "https://maps.example/a",
      latitude: "35",
      longitude: "135",
    },
    { id: "visit-b", item_type: "visit", location_name: "B", map_url: "", latitude: null, longitude: null },
    { id: "transport-b-c", item_type: "transport", from_item_id: "visit-b", to_item_id: "visit-c" },
    {
      id: "visit-c",
      item_type: "visit",
      location_name: "C",
      map_url: "https://maps.example/c",
      latitude: "36",
      longitude: "136",
    },
  ]);

  expect(markers.map((marker) => marker.itemId)).toEqual(["visit-a", "visit-c"]);
  expect(markers.map((marker) => marker.sequenceNumber)).toEqual([1, 3]);
});

test("Phase 4.9a handles missing and invalid coordinates without throwing", () => {
  expect(() =>
    buildDayMapMarkers([
      { id: "visit-a", item_type: "visit", location_name: "A", map_url: "https://maps.example/a", latitude: "", longitude: null },
      { id: "visit-b", item_type: "visit", location_name: "B", map_url: "https://maps.example/b", latitude: "north", longitude: "135.7" },
    ]),
  ).not.toThrow();

  const markers = buildDayMapMarkers([
    { id: "visit-a", item_type: "visit", location_name: "A", map_url: "https://maps.example/a", latitude: "", longitude: null },
    { id: "visit-b", item_type: "visit", location_name: "B", map_url: "https://maps.example/b", latitude: "north", longitude: "135.7" },
  ]);

  expect(markers).toMatchObject([
    { itemId: "visit-a", latitude: null, longitude: null, hasCoordinates: false, coordinateSource: "missing" },
    { itemId: "visit-b", latitude: null, longitude: null, hasCoordinates: false, coordinateSource: "missing" },
  ]);
});

test("Phase 5.2 rejects out-of-range coordinates for marker input", () => {
  const markers = buildDayMapMarkers([
    { id: "visit-a", item_type: "visit", location_name: "A", map_url: "https://maps.example/a", latitude: "91", longitude: "135.7" },
    { id: "visit-b", item_type: "visit", location_name: "B", map_url: "https://maps.example/b", latitude: "35", longitude: "181" },
  ]);

  expect(markers).toMatchObject([
    { itemId: "visit-a", latitude: null, longitude: null, hasCoordinates: false, coordinateSource: "missing" },
    { itemId: "visit-b", latitude: null, longitude: null, hasCoordinates: false, coordinateSource: "missing" },
  ]);
});

test("Phase 5.2 skips marker output after Map URL and coordinates are cleared", () => {
  const markers = buildDayMapMarkers([
    { id: "visit-a", item_type: "visit", location_name: "A", map_url: "", latitude: null, longitude: null },
    { id: "visit-b", item_type: "visit", location_name: "B", map_url: null, latitude: null, longitude: null },
    { id: "visit-c", item_type: "visit", location_name: "C", map_url: "https://maps.example/c", latitude: null, longitude: null },
  ]);

  expect(markers.map((marker) => marker.itemId)).toEqual(["visit-c"]);
  expect(markers[0]).toMatchObject({ itemId: "visit-c", hasCoordinates: false, coordinateSource: "missing" });
});

test("Phase 4.9a preserves neutral provider fields without binding to Google", () => {
  const markers = buildDayMapMarkers([
    {
      id: "visit-a",
      item_type: "visit",
      title: "Provider-backed place",
      location_name: "Provider Place",
      map_url: "https://maps.example/provider-place",
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
